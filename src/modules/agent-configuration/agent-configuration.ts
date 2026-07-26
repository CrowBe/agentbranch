import { createHash } from "node:crypto";
import { AgentConfigurationId, AgentConfigurationVersionId, type UserId } from "@/shared";
import type {
  AgentComponent,
  AgentConfiguration,
  AgentConfigurationSnapshot,
  SecretRequirement,
  SourceFile,
} from "./agent-configuration.types";

const SECRET_ASSIGNMENT =
  /(^|[\s"'`{,])([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',}\]]+)\4/gim;

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
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new InvalidAgentConfiguration(`Source path must be a normalized relative path: ${path}`);
  }
  return normalized;
}

function redactSecrets(content: string): string {
  return content.replace(
    SECRET_ASSIGNMENT,
    (
      _match,
      prefix: string,
      name: string,
      assignment: string,
      quote: string,
    ) => `${prefix}${name}${assignment}${quote}<redacted>${quote}`,
  );
}

function sourceFile(input: { path: string; content: string }): SourceFile {
  const path = safeRelativePath(input.path);
  const content = redactSecrets(input.content);
  return { path, content, contentHash: hashSource(content) };
}

function secretRequirement(input: SecretRequirement): SecretRequirement {
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || purpose.length === 0) {
    throw new InvalidAgentConfiguration("Secret requirements need an environment-style name and purpose.");
  }
  return { name, purpose };
}

export function makeAgentConfigurationSnapshot(input: {
  files: readonly { path: string; content: string }[];
  components?: readonly Omit<AgentComponent, "contentHash">[];
  secretRequirements?: readonly SecretRequirement[];
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
  return { files, components, secretRequirements };
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
