import type {
  AgentComponentKind,
  AgentConfigurationSnapshot,
  SecretRequirement,
  SourceSpan,
} from "@/modules/agent-configuration";
import type { Artifact } from "@/modules/skill-analysis";

export type SourceSnapshotFile = {
  readonly path: string;
  /** A private copy of the source bytes. Adapters must never mutate it. */
  readonly bytes: Uint8Array;
};

export type SourceSnapshot = {
  readonly files: readonly SourceSnapshotFile[];
};

export type ImportEvidence = {
  readonly path: string;
  readonly span: SourceSpan;
};

export type RuntimeIdentity = "claude-code" | "codex" | "openclaw" | "agents";

export type RuntimeDetection = {
  readonly runtime: RuntimeIdentity;
  readonly adapter: {
    readonly id: string;
    readonly version: string;
  };
  readonly evidence: readonly ImportEvidence[];
};

export type AdapterWarning = {
  readonly code: string;
  readonly message: string;
  readonly evidence: ImportEvidence;
};

export type ImportedComponent = {
  readonly kind: AgentComponentKind;
  readonly evidence: ImportEvidence;
};

export type AdapterProbe = {
  readonly detected: boolean;
  readonly evidence: readonly ImportEvidence[];
};

export type AdapterImport = {
  readonly components: readonly ImportedComponent[];
  readonly warnings: readonly AdapterWarning[];
  readonly secretRequirements?: readonly SecretRequirement[];
};

/**
 * Runtime boundary for lossless, parsing-only import. Implementations inspect
 * immutable source bytes and return only source-backed classifications.
 */
export interface AgentConfigurationImportAdapter {
  readonly id: string;
  readonly version: string;
  readonly runtime: RuntimeIdentity;
  probe(snapshot: SourceSnapshot): AdapterProbe;
  import(snapshot: SourceSnapshot, probe: AdapterProbe): AdapterImport;
}

export type ImportRedaction = {
  readonly name: string;
  readonly purpose: string;
  readonly evidence: ImportEvidence;
};

export type ImportCollision = {
  readonly path: string;
  readonly componentKind: AgentComponentKind;
  readonly runtimes: readonly RuntimeIdentity[];
  readonly evidence: readonly ImportEvidence[];
};

export type ImportPreviewSourceFile = {
  readonly path: string;
  readonly encoding: "utf8" | "base64";
  readonly byteLength: number;
  readonly contentHash: string;
  readonly componentIds: readonly string[];
  readonly classification: "classified" | "unclassified";
};

export type AgentConfigurationImportPreviewArtifact =
  Artifact<"agent-configuration-import-preview"> & {
    readonly snapshot: AgentConfigurationSnapshot;
    readonly runtimes: readonly RuntimeDetection[];
    readonly sourceFiles: readonly ImportPreviewSourceFile[];
    readonly redactions: readonly ImportRedaction[];
    readonly warnings: readonly AdapterWarning[];
    readonly collisions: readonly ImportCollision[];
  };

export type AgentConfigurationImportPreview = AgentConfigurationImportPreviewArtifact;
