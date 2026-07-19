import { readSseEvents, type EvaluationEvent } from "@/shared";
import type {
  BuildLoopEvent,
  BuildMessage,
  ResponseSchemaLoopEvent,
  ToolContractLoopEvent,
} from "@/modules/build-loop";
import {
  formatTestRunFeedback,
  formatTriggeringEvalFeedback,
} from "@/modules/build-loop/feedback-formatters";
import {
  applyResponseSchemaEdit,
  responseSchemaName,
  serializeResponseSchema,
  type ResponseSchemaSource,
} from "@/modules/response-schema";
import {
  applyToolContractEdit,
  serializeToolContract,
  type ToolContractSource,
} from "@/modules/tool-contract";
import {
  createHeroArtifact,
  renderedRenderer,
  sourceRenderer,
  type HeroView,
} from "@/modules/hero";
import {
  applySkillEdit,
  SKILL_CATEGORIES,
  isSkillCategory,
  normalizeSkillTags,
  parseSkillMd,
  serializeSkillMd,
  withSkillMetadata,
  type SkillSource,
  type SkillVersionLintSummary,
} from "@/modules/skill";
import {
  createPromptApiLocalSuggestionProvider,
  suggestLocallyOrRoute,
} from "./local-suggestion-provider";
import {
  decodeBranchDetail,
  decodeCapabilityPanel,
  decodeDraftList,
  decodeEquipmentInsight,
  decodeImportResponse,
  decodeLintPanel,
  decodePromotedSkill,
  decodeRunHistory,
  decodeSafetyRating,
  decodeSkillDetail,
  decodeSkillLibrary,
  decodeSkillList,
  errorMessage,
  friendlyError,
  importErrorMessage,
  isEvaluationTool,
  latestLintSummary,
  lintSummaryFromPanel,
  toolErrorMessage,
  type SkillDetail,
} from "./decoders";
import type {
  CapabilityPanel,
  EquipmentKind,
  EquipmentState,
  EvaluationFeedbackResult,
  EvaluationSurface,
  EvaluationToolAction,
  HeroDocs,
  InteractionEntry,
  SafetyRatingState,
  SkillLibraryEntryPanel,
  ToolAction,
  TriggeringCaseProgressPanel,
  Workspace,
  WorkspaceDeps,
  WorkspaceInit,
  WorkspaceSnapshot,
} from "./workspace.types";

/**
 * The client workspace — the framework-free module behind the app shell
 * (issue #159). Owns the HTTP protocol (every fetch + one decoder per route,
 * `decoders.ts`) and the request choreography (guard busy → set status →
 * fetch → decode → apply → append entries → clear busy) over one immutable
 * snapshot. The app shell renders the snapshot and calls the actions; nothing
 * here imports React.
 */
export function createWorkspace(init: WorkspaceInit, deps: WorkspaceDeps = {}): Workspace {
  const fetchImpl: typeof globalThis.fetch = deps.fetch ?? ((...args) => globalThis.fetch(...args));
  const confirmImpl = deps.confirm ?? ((message: string) => window.confirm(message));
  const localSuggestionProvider = deps.localSuggestionProvider ?? createPromptApiLocalSuggestionProvider();

  let snapshot: WorkspaceSnapshot = {
    status: null,
    heroDocs: { rendered: init.rendered, source: init.source },
    view: "rendered",
    mode: "build",
    current: init.initialSkill,
    currentSkillId: null,
    lintSummary: init.initialLintSummary ?? null,
    entries: [],
    capability: null,
    activeTool: null,
    equipment: { contracts: [], schemas: [] },
    safetyRating: null,
    branchId: null,
    openDrafts: [],
    busy: false,
    toolBusy: false,
    lintBusy: false,
    draftBusy: false,
    equipmentBusy: false,
  };

  // The build conversation so far — protocol state the UI never renders
  // directly (the entries carry the visible log), so it stays off the snapshot.
  let messages: readonly BuildMessage[] = [];
  // The equipment authoring conversation and working drafts (ARCHITECTURE
  // §9.2) — same protocol-state split.
  let equipmentMessages: readonly BuildMessage[] = [];
  let responseSchemaDraft: ResponseSchemaSource | null = null;
  let toolContractDraft: ToolContractSource | null = null;
  let entrySeq = 0;

  const listeners = new Set<() => void>();

  function patch(update: Partial<WorkspaceSnapshot>) {
    snapshot = { ...snapshot, ...update };
    for (const listener of listeners) listener();
  }

  function entry(label: string, tone?: InteractionEntry["tone"]): InteractionEntry {
    entrySeq += 1;
    return { id: String(entrySeq), label, tone };
  }

  function appendEntry(item: InteractionEntry) {
    patch({ entries: [...snapshot.entries, item] });
  }

  /** The shared failure tail: surface the message as status + an error entry. */
  function fail(error: string) {
    patch({ status: error });
    appendEntry(entry(error, "error"));
  }

  // -------------------------------------------------------------------------
  // Build loop (the streamed conversation)

  async function send(message: string): Promise<void> {
    if (snapshot.busy) return;
    await sendBuild(message, messages, snapshot.current, snapshot.currentSkillId, true, snapshot.branchId ?? undefined);
  }

  async function sendBuild(
    message: string,
    priorMessages: readonly BuildMessage[],
    startingSource: SkillSource | null,
    startingSkillId: string | null,
    allowLintAutoFeedback: boolean,
    branchId?: string,
  ): Promise<void> {
    const nextMessages: readonly BuildMessage[] = [...priorMessages, { role: "user", content: message }];
    messages = nextMessages;
    patch({
      mode: "build",
      entries: [...snapshot.entries, entry(message)],
      status: "Building…",
      busy: true,
      capability: null,
      activeTool: null,
      lintSummary: null,
    });
    let assistantText = "";
    let latestSource = startingSource;
    let latestSkillId = startingSkillId;
    let completedMessages: readonly BuildMessage[] = nextMessages;
    let pendingLintFeedback: string | null = null;
    let completed = false;

    try {
      const res = await fetchImpl("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          current: latestSource ?? undefined,
          currentSkillId: latestSkillId ?? undefined,
          branchId: branchId ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const error = body?.error ?? `Request failed (${res.status}).`;
        patch({ status: error });
        appendEntry(entry(friendlyError(error), "error"));
        return;
      }
      if (!res.body) {
        patch({ status: "Build stream did not open." });
        return;
      }

      for await (const event of readSseEvents<BuildLoopEvent>(res.body)) {
        if (event.event === "text") {
          assistantText += event.data.delta;
          patch({ entries: upsertAssistant(snapshot.entries, assistantText) });
        } else if (event.event === "tool") {
          patch({
            status: event.data.phase === "call" ? `Running ${event.data.name}…` : "Updating preview…",
          });
        } else if (event.event === "skill") {
          latestSource = event.data.source;
          applyStreamedSkill(latestSource);
        } else if (event.event === "lint-feedback") {
          pendingLintFeedback = event.data.feedback;
        } else if (event.event === "skill-checkpoint") {
          latestSkillId = event.data.skillId;
          patch({ currentSkillId: event.data.skillId });
        } else if (event.event === "skill-edit") {
          if (!latestSource) {
            appendEntry(entry("No draft exists to edit yet.", "error"));
            continue;
          }
          const edited = applySkillEdit(latestSource, event.data.oldStr, event.data.newStr);
          if (!edited.ok) {
            appendEntry(entry(edited.error.message, "error"));
            continue;
          }
          latestSource = edited.value;
          applyStreamedSkill(latestSource);
        } else if (event.event === "error") {
          patch({ status: friendlyError(event.data.message) });
          appendEntry(entry(friendlyError(event.data.message), "error"));
        } else if (event.event === "done") {
          if (event.data.skillId) {
            latestSkillId = event.data.skillId;
            patch({ currentSkillId: event.data.skillId });
          }
          patch({ status: "Build complete." });
          completed = true;
        }
      }

      if (assistantText.trim()) {
        completedMessages = [...nextMessages, { role: "assistant", content: assistantText.trim() }];
        messages = completedMessages;
      }
    } catch (cause) {
      patch({ status: String(cause) });
      appendEntry(entry(String(cause), "error"));
    } finally {
      patch({ busy: false });
    }

    if (completed && pendingLintFeedback && allowLintAutoFeedback && !isLintFeedbackMessage(message)) {
      await sendBuild(pendingLintFeedback, completedMessages, latestSource, latestSkillId, false, branchId);
    }
  }

  function applyStreamedSkill(source: SkillSource) {
    patch({
      current: source,
      heroDocs: renderHeroDocs(source),
      capability: null,
      activeTool: null,
      lintSummary: null,
      // The content changed, so any stored rating no longer describes it.
      safetyRating: null,
    });
  }

  function reviseWithFeedback(result: EvaluationFeedbackResult): void {
    const feedback =
      result.kind === "test-run"
        ? formatTestRunFeedback(result)
        : formatTriggeringEvalFeedback(result);
    void send(feedback);
  }

  // -------------------------------------------------------------------------
  // Rail views

  function setView(view: HeroView) {
    patch({ view });
  }

  function showBuild() {
    patch({ mode: "build", entries: [], status: null });
  }

  function showImport() {
    patch({ mode: "import", entries: [], status: null, branchId: null, openDrafts: [] });
  }

  async function showSkills(): Promise<void> {
    if (snapshot.busy) return;
    patch({ mode: "skills", capability: null, activeTool: null, status: "Loading skills…", entries: [] });

    try {
      const res = await fetchImpl("/api/skills");
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = errorMessage(body, res.status);
        patch({ status: error, entries: [entry(error, "error")] });
        return;
      }
      const skills = decodeSkillList(body);
      patch({
        status: skills.length > 0 ? "Skills loaded." : "No saved skills yet.",
        entries: skills.map((skill) => ({
          id: skill.id,
          label: `${skill.name} - ${skill.description}`,
          actionLabel: "Open",
          onAction: () => void openSkill(skill.id),
        })),
      });
    } catch (cause) {
      const error = friendlyError(String(cause));
      patch({ status: error, entries: [entry(error, "error")] });
    }
  }

  function showEquipment() {
    if (snapshot.busy) return;
    patch({
      mode: "equipment",
      capability: null,
      activeTool: null,
      status:
        snapshot.equipment.contracts.length + snapshot.equipment.schemas.length > 0
          ? "Equipment ready — tool contracts run with your next test run."
          : "Describe the output you want to build a response schema, or paste equipment to check it.",
    });
    refreshEquipmentEntries(snapshot.equipment);
  }

  async function showHistory(): Promise<void> {
    if (snapshot.busy) return;
    patch({ mode: "history", capability: null, activeTool: null, entries: [] });

    const skillId = snapshot.currentSkillId;
    if (!skillId) {
      patch({
        status: "Open a saved skill first.",
        entries: [entry("Open a saved skill to view its run history.", "muted")],
      });
      return;
    }

    patch({ status: "Loading history…" });
    try {
      const [runsRes, skillRes] = await Promise.all([
        fetchImpl(`/api/skills/${encodeURIComponent(skillId)}/runs`),
        fetchImpl(`/api/skills/${encodeURIComponent(skillId)}`),
      ]);
      const runsBody = (await runsRes.json().catch(() => null)) as unknown;
      const skillBody = (await skillRes.json().catch(() => null)) as unknown;
      if (!runsRes.ok) {
        const error = errorMessage(runsBody, runsRes.status);
        patch({ status: error, entries: [entry(error, "error")] });
        return;
      }
      if (!skillRes.ok) {
        const error = errorMessage(skillBody, skillRes.status);
        patch({ status: error, entries: [entry(error, "error")] });
        return;
      }
      const history = decodeRunHistory(runsBody);
      const detail = decodeSkillDetail(skillBody);
      const nextEntries: InteractionEntry[] = [
        ...detail.versions.map((version) => ({
          id: `version-${version.revision}`,
          label: `Revision ${version.revision}${version.revision === detail.skill.latestRevision ? " (current)" : ""}${version.lintSummary ? ` - Quality ${version.lintSummary.grade} ${version.lintSummary.score}/100` : ""}: ${version.source.frontmatter.description}`,
          actionLabel: "Restore",
          onAction:
            version.revision === detail.skill.latestRevision
              ? undefined
              : () => void restoreVersion(detail.skill.id, version.revision),
        })),
        ...history.evalRuns.map((run) =>
          entry(`Triggering eval ${run.status}: ${run.summary}`, run.status === "failed" ? "error" : undefined),
        ),
        ...history.testRuns.map((run) => entry(`Test run ${run.status}: ${run.prompt}`)),
      ];
      patch({
        status: nextEntries.length > 0 ? "History loaded." : "No saved history yet.",
        entries: nextEntries,
      });
    } catch (cause) {
      const error = friendlyError(String(cause));
      patch({ status: error, entries: [entry(error, "error")] });
    }
  }

  async function showTemplates(query = ""): Promise<void> {
    if (snapshot.busy) return;
    const trimmed = query.trim();
    const directSlug = trimmed.includes("/") ? trimmed : "";
    const params = directSlug
      ? new URLSearchParams({ slug: directSlug })
      : new URLSearchParams({ surface: "templates" });
    if (trimmed && !directSlug) params.set("q", trimmed);
    patch({
      mode: "templates",
      capability: null,
      activeTool: null,
      status: "Loading Templates…",
      entries: [],
    });

    try {
      const res = await fetchImpl(`/api/skill-library?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = errorMessage(body, res.status);
        patch({ status: error, entries: [entry(error, "error")] });
        return;
      }
      const items = decodeSkillLibrary(body);
      patch({
        status:
          items.length > 0
            ? directSlug
              ? "Skill library entry loaded."
              : trimmed
              ? "Templates search loaded."
              : "Templates loaded."
            : directSlug
              ? "No Skill library entry found."
              : trimmed
              ? "No matching Templates."
              : "No Templates yet.",
        entries: items.map(templateEntry),
      });
    } catch (cause) {
      const error = friendlyError(String(cause));
      patch({ status: error, entries: [entry(error, "error")] });
    }
  }

  async function publish(owner: string, name: string): Promise<void> {
    if (snapshot.busy) return;
    if (!snapshot.currentSkillId) {
      fail("Open a saved skill first.");
      return;
    }

    patch({ busy: true, status: "Publishing…" });
    try {
      const res = await fetchImpl("/api/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: snapshot.currentSkillId, slug: { owner, name } }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      patch({ status: "Published to the Skill library." });
      appendEntry(entry(`Published at ${owner}/${name}.`, "muted"));
    } catch (cause) {
      fail(String(cause));
    } finally {
      patch({ busy: false });
    }
  }

  // -------------------------------------------------------------------------
  // Import + saved skills

  async function importSkill(raw: string): Promise<void> {
    if (snapshot.busy) return;
    const isUrlImport = isGithubUrl(raw);
    patch({
      busy: true,
      capability: null,
      activeTool: null,
      branchId: null,
      openDrafts: [],
      status: "Importing…",
      entries: [entry(isUrlImport ? "Importing GitHub SKILL.md." : "Importing pasted SKILL.md.", "muted")],
    });

    try {
      const res = await fetchImpl("/api/import", {
        method: "POST",
        headers: isUrlImport
          ? { "Content-Type": "application/json" }
          : { "Content-Type": "text/markdown; charset=utf-8" },
        body: isUrlImport ? JSON.stringify({ url: raw }) : raw,
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(importErrorMessage(body, res.status));
        return;
      }
      const imported = decodeImportResponse(body);

      patch({
        current: imported.skill.source,
        currentSkillId: imported.skill.id,
        lintSummary: imported.skill.lintSummary ?? null,
        heroDocs: { rendered: imported.rendered, source: imported.source },
        view: "rendered",
        safetyRating: null,
        status: "Import complete.",
      });
      appendEntry(entry(`Imported ${imported.rendered.title}.`, "muted"));
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ busy: false });
    }
  }

  async function openSkill(id: string): Promise<void> {
    if (snapshot.busy) return;
    patch({ status: "Opening skill…" });

    try {
      const res = await fetchImpl(`/api/skills/${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      const loaded = decodeSkillDetail(body);
      patch({
        current: loaded.skill.source,
        currentSkillId: loaded.skill.id,
        lintSummary: loaded.skill.lintSummary ?? latestLintSummary(loaded),
        heroDocs: renderHeroDocs(loaded.skill.source),
        view: "rendered",
        capability: null,
        branchId: null,
        safetyRating: null,
        status: "Skill opened.",
        mode: "build",
        entries: [entry(`Opened ${loaded.skill.source.frontmatter.name}.`, "muted")],
      });
      void refreshDrafts(loaded.skill.id);
      void refreshSafetyRating(loaded.skill.id, null);
    } catch (cause) {
      fail(friendlyError(String(cause)));
    }
  }

  async function restoreVersion(id: string, revision: number): Promise<void> {
    if (snapshot.busy) return;
    const confirmed = confirmImpl(`Restore revision ${revision} as the current skill?`);
    if (!confirmed) return;

    patch({ busy: true, status: "Restoring…" });
    try {
      const res = await fetchImpl(`/api/skills/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      const restored = decodeSkillDetail(body);
      patch({
        current: restored.skill.source,
        currentSkillId: restored.skill.id,
        lintSummary: restored.skill.lintSummary ?? latestLintSummary(restored),
        heroDocs: renderHeroDocs(restored.skill.source),
        view: "rendered",
        capability: null,
        branchId: null,
        // Restore lands a fresh head revision, which starts unrated.
        safetyRating: null,
        status: "Version restored.",
        entries: [entry(`Restored revision ${revision} as revision ${restored.skill.latestRevision}.`, "muted")],
        mode: "build",
      });
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ busy: false });
    }
  }

  // -------------------------------------------------------------------------
  // Equipment (ARCHITECTURE §9.2): quality-checked tool contracts + response
  // schemas kept for the session; the next test run bundles them with the skill.

  function refreshEquipmentEntries(state: EquipmentState) {
    const docs = [
      ...state.contracts.map((doc) => ({ doc, kind: "tool-contract" as const })),
      ...state.schemas.map((doc) => ({ doc, kind: "response-schema" as const })),
    ];
    patch({
      entries: docs.map(({ doc, kind }) => ({
        id: `${kind}-${doc.name}`,
        label: `${kind === "tool-contract" ? "Tool contract" : "Response schema"}: ${doc.name}`,
        actionLabel: "Remove",
        onAction: () => {
          const updated = removeEquipment(state, kind, doc.name);
          patch({ equipment: updated });
          refreshEquipmentEntries(updated);
        },
      })),
    });
  }

  async function submitEquipment(raw: string): Promise<void> {
    if (snapshot.equipmentBusy) return;
    const detected = detectEquipmentKind(raw);
    if (!detected.ok) {
      // Not a JSON document — a chat turn for an equipment authoring loop:
      // the agent interviews, then drafts the requested primitive.
      await sendEquipmentAuthoring(selectEquipmentAuthoringKind(raw), raw, true);
      return;
    }

    const isContract = detected.kind === "tool-contract";
    patch({
      equipmentBusy: true,
      status: isContract ? "Checking tool contract…" : "Checking response schema…",
    });
    try {
      const kept = await checkAndKeepEquipment(detected.kind, detected.name, raw);
      if (!kept) return;
      refreshEquipmentEntries(snapshot.equipment);
      patch({
        status: isContract
          ? `Tool contract "${detected.name}" checked — it runs with your next test run.`
          : `Response schema "${detected.name}" checked and kept for tool contracts to reference.`,
      });
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ equipmentBusy: false });
    }
  }

  /** Quality-check a document through its primitive's route and keep it for
   * the session. Shared by the paste path and the authoring loop's finished
   * draft — an authored schema is kept exactly like a pasted one. */
  async function checkAndKeepEquipment(
    kind: EquipmentKind,
    name: string,
    raw: string,
  ): Promise<boolean> {
    const isContract = kind === "tool-contract";
    const res = await fetchImpl(isContract ? "/api/tool-contract" : "/api/response-schema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: raw, surface: "insights" }),
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      fail(errorMessage(body, res.status));
      return false;
    }
    const insight = decodeEquipmentInsight(body);

    const next = storeEquipment(snapshot.equipment, kind, name, raw);
    patch({
      capability: {
        kind: "lint-insights",
        title: isContract ? "Tool contract quality" : "Response schema quality",
        insight,
      },
      equipment: next,
    });
    return true;
  }

  /** One turn of an equipment authoring loop: stream the conversation, track
   * the draft the write/edit tools produce, and on a completed draft
   * quality-check + keep it like a pasted document. */
  async function sendEquipmentAuthoring(
    kind: EquipmentKind,
    message: string,
    allowLintAutoFeedback: boolean,
  ): Promise<void> {
    const nextMessages: readonly BuildMessage[] = [
      ...equipmentMessages,
      { role: "user", content: message },
    ];
    equipmentMessages = nextMessages;
    const isContract = kind === "tool-contract";
    patch({
      entries: [...snapshot.entries, entry(message)],
      status: isContract ? "Building tool contract…" : "Building response schema…",
      equipmentBusy: true,
      capability: null,
    });

    let assistantText = "";
    let pendingLintFeedback: string | null = null;
    let completed = false;

    try {
      const res = await fetchImpl(
        isContract ? "/api/tool-contract/build" : "/api/response-schema/build",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages,
            current: isContract
              ? toolContractDraft
                ? serializeToolContract(toolContractDraft)
                : undefined
              : responseSchemaDraft
                ? serializeResponseSchema(responseSchemaDraft)
                : undefined,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        fail(friendlyError(body?.error ?? `Request failed (${res.status}).`));
        return;
      }
      if (!res.body) {
        patch({ status: "Authoring stream did not open." });
        return;
      }

      for await (const event of readSseEvents<ResponseSchemaLoopEvent | ToolContractLoopEvent>(res.body)) {
        if (event.event === "text") {
          assistantText += event.data.delta;
          patch({ entries: upsertAssistant(snapshot.entries, assistantText) });
        } else if (event.event === "tool") {
          patch({
            status:
              event.data.phase === "call" ? `Running ${event.data.name}…` : "Updating draft…",
          });
        } else if (event.event === "response-schema") {
          responseSchemaDraft = event.data.source;
        } else if (event.event === "response-schema-edit") {
          if (!responseSchemaDraft) {
            appendEntry(entry("No draft exists to edit yet.", "error"));
            continue;
          }
          const edited = applyResponseSchemaEdit(
            responseSchemaDraft,
            event.data.oldStr,
            event.data.newStr,
          );
          if (!edited.ok) {
            appendEntry(entry(edited.error.message, "error"));
            continue;
          }
          responseSchemaDraft = edited.value;
        } else if (event.event === "tool-contract") {
          toolContractDraft = event.data.source;
        } else if (event.event === "tool-contract-edit") {
          if (!toolContractDraft) {
            appendEntry(entry("No draft exists to edit yet.", "error"));
            continue;
          }
          const edited = applyToolContractEdit(
            toolContractDraft,
            event.data.oldStr,
            event.data.newStr,
          );
          if (!edited.ok) {
            appendEntry(entry(edited.error.message, "error"));
            continue;
          }
          toolContractDraft = edited.value;
        } else if (event.event === "lint-feedback") {
          pendingLintFeedback = event.data.feedback;
        } else if (event.event === "error") {
          patch({ status: friendlyError(event.data.message) });
          appendEntry(entry(friendlyError(event.data.message), "error"));
        } else if (event.event === "done") {
          completed = true;
        }
      }

      if (assistantText.trim()) {
        equipmentMessages = [...nextMessages, { role: "assistant", content: assistantText.trim() }];
      }
    } catch (cause) {
      fail(friendlyError(String(cause)));
      return;
    } finally {
      patch({ equipmentBusy: false });
    }

    if (completed && pendingLintFeedback && allowLintAutoFeedback && !isLintFeedbackMessage(message)) {
      // Closeable with eval feedback, like the skill loop: hand the lint
      // findings straight back as the next turn, once.
      await sendEquipmentAuthoring(kind, pendingLintFeedback, false);
      return;
    }

    const finishedRaw = isContract
      ? toolContractDraft
        ? serializeToolContract(toolContractDraft)
        : null
      : responseSchemaDraft
        ? serializeResponseSchema(responseSchemaDraft)
        : null;
    if (completed && finishedRaw) {
      const name = isContract
        ? toolContractDraft?.name || "untitled contract"
        : responseSchemaDraft
          ? responseSchemaName(responseSchemaDraft) || "untitled schema"
          : "untitled schema";
      patch({
        equipmentBusy: true,
        status: isContract ? "Checking tool contract…" : "Checking response schema…",
      });
      try {
        const kept = await checkAndKeepEquipment(kind, name, finishedRaw);
        if (kept) {
          const done = isContract
            ? `Tool contract "${name}" checked — it runs with your next test run.`
            : `Response schema "${name}" checked and kept for tool contracts to reference.`;
          appendEntry(entry(done, "muted"));
          patch({ status: done });
        }
      } catch (cause) {
        fail(friendlyError(String(cause)));
      } finally {
        patch({ equipmentBusy: false });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Branching iteration (ARCHITECTURE §9.3): draft / main version / promote

  async function refreshDrafts(skillId: string): Promise<void> {
    try {
      const res = await fetchImpl(`/api/skills/${encodeURIComponent(skillId)}/branches`);
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) return;
      patch({ openDrafts: decodeDraftList(body) });
    } catch {
      // Non-fatal — the resume affordance just stays empty.
    }
  }

  async function startDraft(): Promise<void> {
    const skillId = snapshot.currentSkillId;
    if (!skillId || snapshot.busy || snapshot.draftBusy) return;
    patch({ draftBusy: true, capability: null, activeTool: null, status: "Starting a draft…" });
    try {
      const res = await fetchImpl(`/api/skills/${encodeURIComponent(skillId)}/branches`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      applyDraft(decodeBranchDetail(body));
      patch({
        status: "Draft started. Your main version is unchanged.",
        entries: [
          entry("Draft started from the main version — iterate and test here, your main version stays put.", "muted"),
        ],
      });
      await refreshDrafts(skillId);
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ draftBusy: false });
    }
  }

  async function openDraft(draftToOpen: string): Promise<void> {
    const skillId = snapshot.currentSkillId;
    if (!skillId || snapshot.busy || snapshot.draftBusy) return;
    patch({ draftBusy: true, capability: null, activeTool: null, status: "Opening draft…" });
    try {
      const res = await fetchImpl(
        `/api/skills/${encodeURIComponent(skillId)}/branches/${encodeURIComponent(draftToOpen)}`,
      );
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      applyDraft(decodeBranchDetail(body));
      patch({
        status: "Draft opened. Your main version is unchanged.",
        entries: [entry("Opened a draft — your main version is unchanged.", "muted")],
      });
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ draftBusy: false });
    }
  }

  async function promote(): Promise<void> {
    const skillId = snapshot.currentSkillId;
    const branchId = snapshot.branchId;
    if (!skillId || !branchId || snapshot.busy || snapshot.draftBusy) return;
    const confirmed = confirmImpl(
      "Set this draft as your main version? It replaces the current main version.",
    );
    if (!confirmed) return;

    // The optional safety-rating step (ARCHITECTURE §9.1): offered only when
    // the draft head is unrated, opt-in (skipping costs nothing), and advisory
    // — a verdict never gates promote, the user decides.
    if (!snapshot.safetyRating) {
      const wantsRating = confirmImpl(
        "Optional: run a safety rating on this draft first? It uses your plan's model credits — cancel to skip and set the main version now.",
      );
      if (wantsRating) {
        const rating = await runSafetyRating();
        if (!rating) return; // the run failed; the error is on screen, the draft is untouched
        if (rating.verdict !== "passed") {
          const proceed = confirmImpl(
            `The safety rating is "${safetyVerdictLabel(rating.verdict)}". Set this draft as your main version anyway?`,
          );
          if (!proceed) return;
        }
      }
    }

    patch({ draftBusy: true, capability: null, activeTool: null, status: "Setting as main version…" });
    try {
      const res = await fetchImpl(
        `/api/skills/${encodeURIComponent(skillId)}/branches/${encodeURIComponent(branchId)}/promote`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      const promoted = decodePromotedSkill(body);
      patch({
        branchId: null,
        current: promoted.source,
        lintSummary: promoted.lintSummary,
        heroDocs: renderHeroDocs(promoted.source),
        view: "rendered",
        status: "This draft is now your main version.",
        entries: [entry("This draft is now your main version.", "muted")],
      });
      await refreshDrafts(skillId);
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ draftBusy: false });
    }
  }

  async function discardDraft(): Promise<void> {
    const skillId = snapshot.currentSkillId;
    const branchId = snapshot.branchId;
    if (!skillId || !branchId || snapshot.busy || snapshot.draftBusy) return;
    const confirmed = confirmImpl("Discard this draft? Your main version is unchanged.");
    if (!confirmed) return;

    patch({ draftBusy: true, capability: null, activeTool: null, status: "Discarding draft…" });
    try {
      const res = await fetchImpl(
        `/api/skills/${encodeURIComponent(skillId)}/branches/${encodeURIComponent(branchId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        fail(errorMessage(body, res.status));
        return;
      }
      patch({ branchId: null, safetyRating: null });
      await reloadMainVersion(skillId);
      await refreshDrafts(skillId);
      void refreshSafetyRating(skillId, null);
      patch({
        status: "Draft discarded. Back to your main version.",
        entries: [entry("Draft discarded — back to your main version.", "muted")],
      });
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ draftBusy: false });
    }
  }

  function applyDraft(draft: { id: string; source: SkillSource; lintSummary: SkillVersionLintSummary | null }) {
    patch({
      branchId: draft.id,
      current: draft.source,
      lintSummary: draft.lintSummary,
      heroDocs: renderHeroDocs(draft.source),
      view: "rendered",
      mode: "build",
      safetyRating: null,
    });
    const skillId = snapshot.currentSkillId;
    if (skillId) void refreshSafetyRating(skillId, draft.id);
  }

  async function reloadMainVersion(skillId: string): Promise<void> {
    const res = await fetchImpl(`/api/skills/${encodeURIComponent(skillId)}`);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) return;
    const detail: SkillDetail = decodeSkillDetail(body);
    patch({
      current: detail.skill.source,
      lintSummary: detail.skill.lintSummary ?? latestLintSummary(detail),
      heroDocs: renderHeroDocs(detail.skill.source),
      view: "rendered",
      capability: null,
    });
  }

  // -------------------------------------------------------------------------
  // Capabilities on the hero (tools + lint)

  async function runToolAction(action: ToolAction): Promise<void> {
    if (action === "metadata") {
      await suggestMetadata();
      return;
    }
    if (action === "safety-review") {
      await runSafetyRating();
      return;
    }
    await runTool(action, "insights");
  }

  async function suggestMetadata(): Promise<void> {
    const skill = snapshot.current;
    if (!skill || snapshot.toolBusy) return;
    patch({ activeTool: "metadata", toolBusy: true, capability: null, status: "Metadata running…" });

    try {
      const result = await suggestLocallyOrRoute({
        provider: localSuggestionProvider,
        request: {
          instruction: METADATA_SUGGESTION_INSTRUCTION,
          source: serializeSkillMd(skill),
          responseSchema: METADATA_SUGGESTION_SCHEMA,
        },
        decode: (value) => decodeMetadataSuggestion(value, true),
        route: async () => {
          const res = await fetchImpl("/api/metadata-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              skill,
              currentSkillId: snapshot.currentSkillId ?? undefined,
              branchId: snapshot.branchId ?? undefined,
            }),
          });
          const body = (await res.json().catch(() => null)) as unknown;
          if (!res.ok) throw new Error(errorMessage(body, res.status));
          const decoded = decodeMetadataSuggestion(body, false);
          if (!decoded) throw new Error("Metadata returned an unexpected response.");
          return decoded;
        },
      });
      patch({
        capability: { kind: "metadata-suggestion", ...result.value, provenance: result.provenance },
        status: "Metadata ready.",
      });
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ toolBusy: false });
    }
  }

  async function applyMetadataSuggestion(): Promise<void> {
    const panel = snapshot.capability;
    const current = snapshot.current;
    if (!current || panel?.kind !== "metadata-suggestion") return;
    const descriptionChanged = panel.description !== current.frontmatter.description;
    const source = withSkillMetadata({
      ...current,
      frontmatter: {
        ...current.frontmatter,
        name: panel.name,
        description: panel.description,
      },
    }, { category: panel.category, tags: panel.tags });

    if (snapshot.currentSkillId) {
      patch({ toolBusy: true, status: "Applying suggestion…" });
      try {
        const res = await fetchImpl(`/api/skills/${encodeURIComponent(snapshot.currentSkillId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill: source, branchId: snapshot.branchId ?? undefined }),
        });
        const body = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) throw new Error(errorMessage(body, res.status));
      } catch (cause) {
        fail(friendlyError(String(cause)));
        patch({ toolBusy: false });
        return;
      }
    }

    patch({
      current: source,
      heroDocs: renderHeroDocs(source),
      capability: null,
      activeTool: null,
      lintSummary: null,
      safetyRating: null,
      toolBusy: false,
      status: snapshot.currentSkillId
        ? descriptionChanged
          ? "Suggestion applied and saved. Run Triggers to validate the new description."
          : "Suggestion applied and saved."
        : descriptionChanged
          ? "Suggestion applied to this unsaved workspace. Run Triggers to validate the new description."
          : "Suggestion applied to this unsaved workspace.",
    });
  }

  // -------------------------------------------------------------------------
  // Safety rating (ARCHITECTURE §9.1) — always a manual, opt-in step. The scan
  // runs only when the user asks for it on an unrated version; a rated version
  // re-renders the stored rating for free.

  /** The version's stored rating, refreshed from the server. Non-fatal: on any
   * failure the version just reads as unrated and the manual offer stands. */
  async function refreshSafetyRating(skillId: string, branchId: string | null): Promise<void> {
    try {
      const params = new URLSearchParams({ skillId });
      if (branchId) params.set("branchId", branchId);
      const res = await fetchImpl(`/api/safety-review?${params.toString()}`);
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as unknown;
      patch({ safetyRating: decodeSafetyRating(body) });
    } catch {
      // Non-fatal — the offer just treats the version as unrated.
    }
  }

  /** Run the opt-in scan (spends the user's credits), or re-show the stored
   * rating at zero cost when the version already carries one. Returns the
   * rating so the promote flow can offer it as its optional step. */
  async function runSafetyRating(): Promise<SafetyRatingState | null> {
    const skill = snapshot.current;
    if (!skill || snapshot.toolBusy) return snapshot.safetyRating;
    if (snapshot.safetyRating) {
      patch({
        activeTool: "safety-review",
        capability: safetyPanel("insights", snapshot.safetyRating),
        status: "Safety rating ready.",
      });
      return snapshot.safetyRating;
    }

    patch({
      activeTool: "safety-review",
      toolBusy: true,
      capability: null,
      status: "Safety rating running…",
    });
    try {
      const res = await fetchImpl("/api/safety-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill,
          currentSkillId: snapshot.currentSkillId ?? undefined,
          branchId: snapshot.branchId ?? undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(toolErrorMessage(body, res.status, "safety-review"));
        return null;
      }
      const rating = decodeSafetyRating(body);
      if (!rating) {
        fail("Safety rating returned an unexpected response.");
        return null;
      }
      patch({
        safetyRating: rating,
        capability: safetyPanel("insights", rating),
        status: "Safety rating ready.",
      });
      return rating;
    } catch (cause) {
      fail(friendlyError(String(cause)));
      return null;
    } finally {
      patch({ toolBusy: false });
    }
  }

  /** Local re-render of the stored rating — switching surfaces never re-spends. */
  function selectSafetySurface(surface: EvaluationSurface): void {
    const rating = snapshot.safetyRating;
    if (!rating) return;
    patch({ activeTool: "safety-review", capability: safetyPanel(surface, rating) });
  }

  async function selectEvaluationSurface(surface: EvaluationSurface): Promise<void> {
    const active = snapshot.activeTool;
    if (!active || !isEvaluationTool(active)) return;
    await runTool(active, surface);
  }

  async function selectLintSurface(surface: EvaluationSurface): Promise<void> {
    const skill = snapshot.current;
    if (!skill || snapshot.lintBusy) return;

    patch({ activeTool: null, lintBusy: true, status: "Quality running…" });

    try {
      const res = await fetchImpl("/api/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill,
          currentSkillId: snapshot.currentSkillId ?? undefined,
          branchId: snapshot.branchId ?? undefined,
          surface,
        }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        fail(errorMessage(body, res.status));
        return;
      }
      const panel = decodeLintPanel(surface, body);
      const summary = lintSummaryFromPanel(panel);
      patch({
        capability: panel,
        ...(summary ? { lintSummary: summary } : {}),
        status: "Quality ready.",
      });
    } catch (cause) {
      fail(friendlyError(String(cause)));
    } finally {
      patch({ lintBusy: false });
    }
  }

  async function runTool(action: ToolAction, surface: EvaluationSurface): Promise<void> {
    const skill = snapshot.current;
    if (!skill || snapshot.toolBusy) return;

    patch({
      activeTool: action,
      toolBusy: true,
      capability: isEvaluationTool(action) ? emptyProgressPanel(action) : null,
      status: `${toolLabel(action)} running…`,
    });

    try {
      const res = await fetchImpl(`/${apiPath(action)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isEvaluationTool(action) ? { Accept: "text/event-stream" } : {}),
        },
        body: JSON.stringify({
          skill,
          currentSkillId: snapshot.currentSkillId ?? undefined,
          branchId: snapshot.branchId ?? undefined,
          surface,
          // A test run bundles the session's checked equipment (ARCHITECTURE
          // §9.2): contracts drive the mock tools + per-call validation.
          ...(action === "test-run" && snapshot.equipment.contracts.length > 0
            ? {
                toolContracts: snapshot.equipment.contracts.map((doc) => doc.raw),
                responseSchemas: snapshot.equipment.schemas.map((doc) => doc.raw),
              }
            : {}),
        }),
      });
      if (
        res.ok &&
        isEvaluationTool(action) &&
        res.body &&
        res.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await consumeEvaluationStream(action, surface, res.body);
        return;
      }

      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        // Return the hero to the document — a progress panel must never
        // outlive its failed run.
        patch({ capability: null });
        fail(toolErrorMessage(body, res.status, action));
        return;
      }
      patch({
        capability: decodeCapabilityPanel(action, surface, body, toolLabel(action)),
        status: `${toolLabel(action)} ready.`,
      });
    } catch (cause) {
      patch({ capability: null });
      fail(friendlyError(String(cause)));
    } finally {
      patch({ toolBusy: false });
    }
  }

  async function consumeEvaluationStream(
    action: EvaluationToolAction,
    surface: EvaluationSurface,
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    let failed = false;
    for await (const event of readSseEvents<EvaluationEvent>(body)) {
      if (event.event === "eval-progress") {
        patch({
          status: event.data.message,
          capability: appendProgressMessage(snapshot.capability, action, event.data.message),
        });
      } else if (event.event === "eval-case") {
        patch({
          status: `Case ${event.data.index}/${event.data.total} checked.`,
          capability: appendProgressCase(snapshot.capability, action, event.data),
        });
      } else if (event.event === "artifact") {
        patch({
          capability: decodeCapabilityPanel(action, surface, event.data.body, toolLabel(action), event.data.result),
          status: `${toolLabel(action)} ready.`,
        });
      } else if (event.event === "error") {
        failed = true;
        fail(toolErrorMessage(event.data, 500, action));
      }
    }

    if (failed) patch({ capability: null });
  }

  const actions = {
    setView,
    showBuild,
    showImport,
    showSkills,
    showEquipment,
    showHistory,
    showTemplates,
    send,
    importSkill,
    submitEquipment,
    openSkill,
    restoreVersion,
    startDraft,
    openDraft,
    promote,
    discardDraft,
    publish,
    runTool: runToolAction,
    selectEvaluationSurface,
    selectLintSurface,
    selectSafetySurface,
    reviseWithFeedback,
    applyMetadataSuggestion,
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers

function renderHeroDocs(source: SkillSource): HeroDocs {
  const artifact = createHeroArtifact(source);
  return {
    rendered: renderedRenderer.render(artifact),
    source: sourceRenderer.render(artifact),
  };
}

type MetadataSuggestionValue = {
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly rationale: string;
};

const METADATA_SUGGESTION_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    category: { anyOf: [{ type: "string", enum: SKILL_CATEGORIES }, { type: "null" }] },
    tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
    rationale: { type: "string" },
  },
  required: ["name", "description", "category", "tags", "rationale"],
  additionalProperties: false,
};

const METADATA_SUGGESTION_INSTRUCTION = `Suggest editable metadata for this Agent Skill.
Return only the constrained JSON response. Use a concise lowercase hyphen-case name; a plain-language description that says what the skill does and when to use it; one allowed category or null; 3 to 6 lowercase hyphen-case tags; and one short rationale. Ground every field in the supplied SKILL.md.`;

function decodeMetadataSuggestion(value: unknown, requireTags: boolean): MetadataSuggestionValue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const description = typeof item.description === "string" ? item.description.trim() : "";
  const rationale = typeof item.rationale === "string" ? item.rationale.trim() : "";
  const category = item.category === null || isSkillCategory(item.category) ? item.category : undefined;
  const tags = Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string")
    ? normalizeSkillTags(item.tags)
    : [];
  if (!name || !description || !rationale || category === undefined || (requireTags && tags.length === 0)) return null;
  const candidate = parseSkillMd(serializeSkillMd({
    frontmatter: { name, description, extra: {} },
    body: "",
  }));
  if (!candidate.ok) return null;
  return { name, description, category, tags, rationale };
}

function upsertAssistant(entries: readonly InteractionEntry[], label: string): InteractionEntry[] {
  const last = entries.at(-1);
  if (last?.id === "assistant-stream") {
    return [...entries.slice(0, -1), { ...last, label }];
  }
  return [...entries, { id: "assistant-stream", label }];
}

function isLintFeedbackMessage(message: string): boolean {
  return message.startsWith("Lint - Quality ");
}

function toolLabel(action: ToolAction): string {
  if (action === "metadata") return "Metadata";
  if (action === "visualise") return "Visualise";
  if (action === "test-run") return "Test run";
  if (action === "triggering-eval") return "Triggering eval";
  if (action === "safety-review") return "Safety rating";
  return "Export";
}

function safetyPanel(surface: EvaluationSurface, rating: SafetyRatingState): CapabilityPanel {
  return surface === "breakdown"
    ? { kind: "safety-breakdown", title: "Safety rating", rating }
    : { kind: "safety-insights", title: "Safety rating", rating };
}

function safetyVerdictLabel(verdict: SafetyRatingState["verdict"]): string {
  if (verdict === "passed") return "passed";
  if (verdict === "needs-review") return "needs review";
  return "blocked";
}

function templateEntry(item: SkillLibraryEntryPanel): InteractionEntry {
  const footprint = `Source ${item.source.path} at ${item.source.ref}; no bundled runnable code.`;
  const details = [
    `${item.name} by ${item.owner}`,
    `${item.safety.label}. ${item.trustLabel}.`,
    `Hash ${item.contentHash}. ${footprint}`,
    "Presentation is guidance, not a guarantee.",
  ].join(" ");
  return {
    id: `template-${item.slug}`,
    label: details,
    actionLabel: "Open details",
    onAction: () => {
      window.open(`/api/skill-library?slug=${encodeURIComponent(item.slug)}`, "_blank", "noopener,noreferrer");
    },
  };
}

function apiPath(action: ToolAction): string {
  if (action === "visualise") return "api/visualise";
  if (action === "test-run") return "api/test-run";
  if (action === "triggering-eval") return "api/triggering-eval";
  return "api/export";
}

function isGithubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "raw.githubusercontent.com")
    );
  } catch {
    return false;
  }
}

function emptyProgressPanel(
  action: EvaluationToolAction,
): Extract<CapabilityPanel, { kind: "evaluation-progress" }> {
  return {
    kind: "evaluation-progress",
    action,
    title: toolLabel(action),
    messages: [],
    cases: [],
  };
}

function appendProgressMessage(
  panel: CapabilityPanel | null,
  action: EvaluationToolAction,
  message: string,
): Extract<CapabilityPanel, { kind: "evaluation-progress" }> {
  const current =
    panel?.kind === "evaluation-progress" && panel.action === action
      ? panel
      : emptyProgressPanel(action);
  return { ...current, messages: [...current.messages, message] };
}

function appendProgressCase(
  panel: CapabilityPanel | null,
  action: EvaluationToolAction,
  item: TriggeringCaseProgressPanel,
): Extract<CapabilityPanel, { kind: "evaluation-progress" }> {
  const current =
    panel?.kind === "evaluation-progress" && panel.action === action
      ? panel
      : emptyProgressPanel(action);
  return { ...current, cases: [...current.cases, item] };
}

/**
 * Decide which primitive a pasted document is. A tool contract carries call
 * shape keys (`input`/`output`/`failureModes`/`safetyNotes`); anything else
 * that parses as a JSON object is treated as a response schema (a JSON Schema
 * document). The server re-parses through the real source models either way.
 */
function selectEquipmentAuthoringKind(message: string): EquipmentKind {
  return /\b(tool|contract|input|output|failure mode|confirmation boundary|confirm before)\b/i.test(
    message,
  )
    ? "tool-contract"
    : "response-schema";
}

function detectEquipmentKind(raw: string):
  | { readonly ok: true; readonly kind: EquipmentKind; readonly name: string }
  | { readonly ok: false; readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Equipment must be a JSON document." };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, error: "Equipment must be a JSON object." };
  }
  const doc = parsed as Record<string, unknown>;

  const contractKeys = ["input", "output", "failureModes", "safetyNotes", "examples"];
  const looksLikeContract =
    typeof doc.name === "string" &&
    typeof doc.description === "string" &&
    (contractKeys.some((key) => key in doc) || !("type" in doc || "properties" in doc));
  if (looksLikeContract) {
    return { ok: true, kind: "tool-contract", name: String(doc.name) };
  }
  const title = typeof doc.title === "string" && doc.title.trim() ? doc.title.trim() : "untitled schema";
  return { ok: true, kind: "response-schema", name: title };
}

function storeEquipment(
  state: EquipmentState,
  kind: EquipmentKind,
  name: string,
  raw: string,
): EquipmentState {
  const doc = { name, raw };
  if (kind === "tool-contract") {
    return {
      ...state,
      contracts: [...state.contracts.filter((item) => item.name !== name), doc],
    };
  }
  return { ...state, schemas: [...state.schemas.filter((item) => item.name !== name), doc] };
}

function removeEquipment(state: EquipmentState, kind: EquipmentKind, name: string): EquipmentState {
  if (kind === "tool-contract") {
    return { ...state, contracts: state.contracts.filter((item) => item.name !== name) };
  }
  return { ...state, schemas: state.schemas.filter((item) => item.name !== name) };
}
