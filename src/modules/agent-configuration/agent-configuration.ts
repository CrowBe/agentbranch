import { createHash } from "node:crypto";
import { AgentConfigurationId, AgentConfigurationVersionId, type UserId } from "@/shared";
import type {
  AgentComponent,
  AgentConfiguration,
  AgentConfigurationImportProvenance,
  AgentConfigurationSnapshot,
  SecretRequirement,
  SourceFile,
} from "./agent-configuration.types";

const SENSITIVE_SETTING_NAME =
  "(?:(?:[A-Za-z][A-Za-z0-9_-]*)?(?:key|token|secret|password|credential|authorization|auth[_-]?header|dsn|connection[_-]?string|(?:database|db|postgres(?:ql)?|redis|mongo(?:db)?|mysql|mariadb|amqp|broker)[_-]?(?:url|uri))[A-Za-z0-9_-]*)";
const QUOTED_SECRET_ASSIGNMENT =
  new RegExp(`(^|[\\s{,])(["']?)(${SENSITIVE_SETTING_NAME})\\2(\\s*[:=]\\s*)(["'])((?:\\\\.|[^\\\\\\r\\n])*?)\\5`, "gim");
const BARE_SECRET_ASSIGNMENT =
  new RegExp(`(^|[\\s{,])(["']?)(${SENSITIVE_SETTING_NAME})\\2(\\s*[:=]\\s*)(?!\\s*["'])([^\\r\\n,}\\]]+)`, "gim");
const PEM_PRIVATE_KEY =
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g;
const URL_WITH_USERINFO =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s"'<>]+/gi;
const ENVIRONMENT_REFERENCE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export class InvalidAgentConfiguration extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAgentConfiguration";
  }
}

export const hashSource = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

function safeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new InvalidAgentConfiguration(`Source path must be a normalized relative path: ${path}`);
  }
  return normalized;
}

function redactSecrets(content: string): string {
  const privateKeys = content
    .replace(PEM_PRIVATE_KEY, "<redacted>")
    .replace(URL_WITH_USERINFO, "<redacted>");
  const quoted = privateKeys.replace(
    QUOTED_SECRET_ASSIGNMENT,
    (
      _match,
      prefix: string,
      keyQuote: string,
      name: string,
      assignment: string,
      valueQuote: string,
      value: string,
    ) => `${prefix}${keyQuote}${name}${keyQuote}${assignment}${valueQuote}${
      ENVIRONMENT_REFERENCE.test(value) ? value : "<redacted>"
    }${valueQuote}`,
  );
  return quoted.replace(
    BARE_SECRET_ASSIGNMENT,
    (
      _match,
      prefix: string,
      keyQuote: string,
      name: string,
      assignment: string,
      value: string,
    ) => `${prefix}${keyQuote}${name}${keyQuote}${assignment}${
      ENVIRONMENT_REFERENCE.test(value.trim()) ? value : "<redacted>"
    }`,
  );
}

function sourceFile(input: {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}): SourceFile {
  const path = safeRelativePath(input.path);
  const encoding = input.encoding ?? "utf8";
  if (encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) {
    throw new InvalidAgentConfiguration(`Source ${path} is not valid base64.`);
  }
  const content = encoding === "utf8" ? redactSecrets(input.content) : input.content;
  return { path, content, encoding, contentHash: hashSource(content) };
}

function secretRequirement(input: SecretRequirement): SecretRequirement {
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || purpose.length === 0) {
    throw new InvalidAgentConfiguration("Secret requirements need an environment-style name and purpose.");
  }
  return { name, purpose };
}

function importProvenance(
  input: AgentConfigurationImportProvenance,
): AgentConfigurationImportProvenance {
  const runtime = input.runtime.trim();
  const id = input.adapter.id.trim();
  const version = input.adapter.version.trim();
  if (runtime.length === 0 || id.length === 0 || version.length === 0) {
    throw new InvalidAgentConfiguration(
      "Import provenance needs a runtime, adapter ID, and adapter version.",
    );
  }
  return { runtime, adapter: { id, version } };
}

export function makeAgentConfigurationSnapshot(input: {
  files: readonly {
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
  }[];
  components?: readonly Omit<AgentComponent, "contentHash">[];
  secretRequirements?: readonly SecretRequirement[];
  importProvenance?: readonly AgentConfigurationImportProvenance[];
}): AgentConfigurationSnapshot {
  const files = input.files.map(sourceFile).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new InvalidAgentConfiguration("Source snapshot contains duplicate paths.");
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const components = (input.components ?? []).map((component): AgentComponent => {
    const path = safeRelativePath(component.path);
    const file = byPath.get(path);
    if (!file) throw new InvalidAgentConfiguration(`Component ${component.id} references missing source ${path}.`);
    if (component.span && (
      component.span.startLine < 1 ||
      component.span.startColumn < 1 ||
      component.span.endLine < component.span.startLine ||
      (component.span.endLine === component.span.startLine &&
        component.span.endColumn < component.span.startColumn)
    )) throw new InvalidAgentConfiguration(`Component ${component.id} has an invalid source span.`);
    return { ...component, path, contentHash: file.contentHash };
  });
  if (new Set(components.map((component) => component.id)).size !== components.length) {
    throw new InvalidAgentConfiguration("Components need stable, unique IDs.");
  }
  const secretRequirements = (input.secretRequirements ?? []).map(secretRequirement);
  const provenance = (input.importProvenance ?? [])
    .map(importProvenance)
    .sort((a, b) =>
      a.runtime.localeCompare(b.runtime)
      || a.adapter.id.localeCompare(b.adapter.id)
      || a.adapter.version.localeCompare(b.adapter.version)
    );
  return { files, components, secretRequirements, importProvenance: provenance };
}

export function makeAgentConfiguration(input: {
  id: AgentConfigurationId;
  versionId: AgentConfigurationVersionId;
  userId: UserId;
  name: string;
  snapshot: AgentConfigurationSnapshot;
  revision?: number;
  createdAt: Date;
  updatedAt: Date;
}): AgentConfiguration {
  const mainVersion = {
    id: input.versionId,
    configurationId: input.id,
    revision: input.revision ?? 1,
    snapshot: input.snapshot,
    createdAt: input.updatedAt,
  };
  return {
    id: input.id,
    userId: input.userId,
    name: input.name,
    mainVersionId: input.versionId,
    mainVersion,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export const newAgentConfigurationId = (): AgentConfigurationId =>
  AgentConfigurationId(crypto.randomUUID());
export const newAgentConfigurationVersionId = (): AgentConfigurationVersionId =>
  AgentConfigurationVersionId(crypto.randomUUID());
