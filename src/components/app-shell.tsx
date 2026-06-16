"use client";

import { useState } from "react";
import { readSseEvents, type EvaluationEvent } from "@/shared";
import type { RenderedDoc, SourceDoc, HeroView } from "@/modules/hero";
import type { SkillSource, SkillVersionLintSummary } from "@/modules/skill";
import { TopBar } from "./top-bar";
import { SideRail, type SideRailView } from "./side-rail";
import { ModelConsole } from "./model-console";
import {
  HeroPanel,
  type CapabilityPanel,
  type EvaluationBreakdown,
  type EvaluationToolAction,
  type InsightPanel,
  type LintBreakdownPanel,
  type LintInsightPanel,
} from "./hero-panel";
import { InteractionPanel } from "./interaction-panel";
import type { ToolAction } from "./tool-chips";
import { entry, friendlyError, renderHeroDocs, toolLabel, useBuildStream } from "./use-build-stream";

/**
 * The app shell — composes the chrome top bar, collapsible left rail,
 * preview-primary hero, and slim right interaction panel (ARCHITECTURE §7).
 * Holds only presentation state; the hero content is computed server-side via
 * the skill-analysis seam and passed in.
 */
export function AppShell({
  rendered,
  source,
  initialSkill,
  initialLintSummary = null,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  initialSkill: SkillSource;
  initialLintSummary?: SkillVersionLintSummary | null;
}) {
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [view, setView] = useState<HeroView>("rendered");
  const [interactionMode, setInteractionMode] = useState<"build" | "import" | "skills" | "history">("build");
  const [toolBusy, setToolBusy] = useState(false);
  const [lintBusy, setLintBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolAction | null>(null);
  const [capability, setCapability] = useState<CapabilityPanel | null>(null);
  const [currentLintSummary, setCurrentLintSummary] = useState<SkillVersionLintSummary | null>(
    initialLintSummary,
  );
  const {
    status,
    setStatus,
    heroDocs,
    setHeroDocs,
    current,
    setCurrent,
    currentSkillId,
    setCurrentSkillId,
    entries,
    setEntries,
    busy,
    setBusy,
    send: handleSend,
  } = useBuildStream({
    rendered,
    source,
    initialSkill,
    onBuildStart: () => setInteractionMode("build"),
    onStreamSkillChange: () => {
      setCapability(null);
      setActiveTool(null);
      setCurrentLintSummary(null);
    },
  });

  return (
    <div className="flex h-dvh flex-col">
      <TopBar onToggleMenu={() => setMenuExpanded((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <SideRail
          expanded={menuExpanded}
          active={activeRailView(interactionMode)}
          onBuild={() => {
            setInteractionMode("build");
            setEntries([]);
            setStatus(null);
          }}
          onImport={() => {
            setInteractionMode("import");
            setEntries([]);
            setStatus(null);
          }}
          onModels={() => setConsoleOpen(true)}
          onSkills={handleSkills}
          onHistory={handleHistory}
        />
        <main className="min-w-0 flex-1 overflow-hidden">
          <HeroPanel
            rendered={heroDocs.rendered}
            source={heroDocs.source}
            view={view}
            onViewChange={setView}
            capability={capability}
            activeTool={activeTool}
            toolBusy={toolBusy}
            lintSummary={currentLintSummary}
            lintBusy={lintBusy}
            onToolSelect={handleToolSelect}
            onLintSelect={() => void handleLintSurfaceSelect("insights")}
            onEvaluationSurfaceChange={handleEvaluationSurfaceSelect}
            onLintSurfaceChange={handleLintSurfaceSelect}
          />
          {status && (
            <p className="text-label px-6 pb-4 text-on-surface-variant" role="status">
              {status}
            </p>
          )}
        </main>
        <InteractionPanel
          entries={entries}
          busy={busy}
          mode={interactionMode}
          onSend={handleSend}
          onImport={handleImport}
        />
      </div>
      {consoleOpen && <ModelConsole onClose={() => setConsoleOpen(false)} />}
    </div>
  );

  async function handleImport(raw: string) {
    if (busy) return;
    setBusy(true);
    setCapability(null);
    setActiveTool(null);
    setStatus("Importing...");
    const isUrlImport = isGithubUrl(raw);
    setEntries([entry(isUrlImport ? "Importing GitHub SKILL.md." : "Importing pasted SKILL.md.", "muted")]);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: isUrlImport
          ? { "Content-Type": "application/json" }
          : { "Content-Type": "text/markdown; charset=utf-8" },
        body: isUrlImport ? JSON.stringify({ url: raw }) : raw,
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = parseImportError(body, res.status);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
        return;
      }
      if (!isImportResponse(body)) {
        throw new Error("Import returned an unexpected response.");
      }

      setCurrent(body.skill.source);
      setCurrentSkillId(body.skill.id);
      setCurrentLintSummary(body.skill.lintSummary ?? null);
      setHeroDocs({ rendered: body.rendered, source: body.source });
      setView("rendered");
      setStatus("Import complete.");
      setEntries((prev) => [...prev, entry(`Imported ${body.rendered.title}.`, "muted")]);
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries((prev) => [...prev, entry(error, "error")]);
    } finally {
      setBusy(false);
    }
  }

  async function handleSkills() {
    if (busy) return;
    setInteractionMode("skills");
    setCapability(null);
    setActiveTool(null);
    setStatus("Loading skills...");
    setEntries([]);

    try {
      const res = await fetch("/api/skills");
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = parseGenericError(body, res.status);
        setStatus(error);
        setEntries([entry(error, "error")]);
        return;
      }
      const skills = toSkillList(body);
      setStatus(skills.length > 0 ? "Skills loaded." : "No saved skills yet.");
      setEntries(
        skills.map((skill) => ({
          id: skill.id,
          label: `${skill.name} - ${skill.description}`,
          actionLabel: "Open",
          onAction: () => void handleOpenSkill(skill.id),
        })),
      );
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries([entry(error, "error")]);
    }
  }

  async function handleOpenSkill(id: string) {
    if (busy) return;
    setStatus("Opening skill...");

    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = parseGenericError(body, res.status);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
        return;
      }
      const loaded = toSkillDetail(body);
      setCurrent(loaded.skill.source);
      setCurrentSkillId(loaded.skill.id);
      setCurrentLintSummary(loaded.skill.lintSummary ?? latestLintSummary(loaded));
      setHeroDocs(renderHeroDocs(loaded.skill.source));
      setView("rendered");
      setCapability(null);
      setStatus("Skill opened.");
      setInteractionMode("build");
      setEntries([entry(`Opened ${loaded.skill.source.frontmatter.name}.`, "muted")]);
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries((prev) => [...prev, entry(error, "error")]);
    }
  }

  async function handleHistory() {
    if (busy) return;
    setInteractionMode("history");
    setCapability(null);
    setActiveTool(null);
    setEntries([]);

    if (!currentSkillId) {
      setStatus("Open a saved skill first.");
      setEntries([entry("Open a saved skill to view its run history.", "muted")]);
      return;
    }

    setStatus("Loading history...");
    try {
      const [runsRes, skillRes] = await Promise.all([
        fetch(`/api/skills/${encodeURIComponent(currentSkillId)}/runs`),
        fetch(`/api/skills/${encodeURIComponent(currentSkillId)}`),
      ]);
      const runsBody = (await runsRes.json().catch(() => null)) as unknown;
      const skillBody = (await skillRes.json().catch(() => null)) as unknown;
      if (!runsRes.ok) {
        const error = parseGenericError(runsBody, runsRes.status);
        setStatus(error);
        setEntries([entry(error, "error")]);
        return;
      }
      if (!skillRes.ok) {
        const error = parseGenericError(skillBody, skillRes.status);
        setStatus(error);
        setEntries([entry(error, "error")]);
        return;
      }
      const history = toRunHistory(runsBody);
      const detail = toSkillDetail(skillBody);
      const nextEntries = [
        ...detail.versions.map((version) => ({
          id: `version-${version.revision}`,
          label: `Revision ${version.revision}${version.revision === detail.skill.latestRevision ? " (current)" : ""}${version.lintSummary ? ` - Quality ${version.lintSummary.grade} ${version.lintSummary.score}/100` : ""}: ${version.source.frontmatter.description}`,
          actionLabel: "Restore",
          onAction:
            version.revision === detail.skill.latestRevision
              ? undefined
              : () => void handleRestoreVersion(detail.skill.id, version.revision),
        })),
        ...history.evalRuns.map((run) =>
          entry(`Triggering eval ${run.status}: ${run.summary}`, run.status === "failed" ? "error" : undefined),
        ),
        ...history.testRuns.map((run) => entry(`Test run ${run.status}: ${run.prompt}`)),
      ];
      setStatus(nextEntries.length > 0 ? "History loaded." : "No saved history yet.");
      setEntries(nextEntries);
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries([entry(error, "error")]);
    }
  }

  async function handleRestoreVersion(id: string, revision: number) {
    if (busy) return;
    const confirmed = window.confirm(`Restore revision ${revision} as the current skill?`);
    if (!confirmed) return;

    setBusy(true);
    setStatus("Restoring...");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = parseGenericError(body, res.status);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
        return;
      }
      const restored = toSkillDetail(body);
      setCurrent(restored.skill.source);
      setCurrentSkillId(restored.skill.id);
      setCurrentLintSummary(restored.skill.lintSummary ?? latestLintSummary(restored));
      setHeroDocs(renderHeroDocs(restored.skill.source));
      setView("rendered");
      setCapability(null);
      setStatus("Version restored.");
      setEntries([entry(`Restored revision ${revision} as revision ${restored.skill.latestRevision}.`, "muted")]);
      setInteractionMode("build");
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries((prev) => [...prev, entry(error, "error")]);
    } finally {
      setBusy(false);
    }
  }

  async function handleToolSelect(action: ToolAction) {
    await runTool(action, "insights");
  }

  async function handleEvaluationSurfaceSelect(surface: "insights" | "breakdown") {
    if (!activeTool || !isEvaluationTool(activeTool)) return;
    await runTool(activeTool, surface);
  }

  async function handleLintSurfaceSelect(surface: "insights" | "breakdown") {
    const skill = current;
    if (!skill || lintBusy) return;

    setActiveTool(null);
    setLintBusy(true);
    setStatus("Quality running...");

    try {
      const res = await fetch("/api/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill,
          currentSkillId: currentSkillId ?? undefined,
          surface,
        }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const error = parseGenericError(body, res.status);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
        return;
      }
      setCapability(toLintPanel(surface, body));
      const summary = lintSummaryFromResponse(surface, body);
      if (summary) setCurrentLintSummary(summary);
      setStatus("Quality ready.");
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries((prev) => [...prev, entry(error, "error")]);
    } finally {
      setLintBusy(false);
    }
  }

  async function runTool(action: ToolAction, surface: "insights" | "breakdown") {
    const skill = current;
    if (!skill || toolBusy) return;

    setActiveTool(action);
    setToolBusy(true);
    setCapability(isEvaluationTool(action) ? emptyProgressPanel(action) : null);
    setStatus(`${toolLabel(action)} running...`);

    try {
      const res = await fetch(`/${apiPath(action)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isEvaluationTool(action) ? { Accept: "text/event-stream" } : {}),
        },
        body: JSON.stringify({
          skill,
          currentSkillId: currentSkillId ?? undefined,
          surface,
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
        const error = parseError(body, res.status, action);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
        return;
      }
      setCapability(toCapabilityPanel(action, surface, body));
      setStatus(`${toolLabel(action)} ready.`);
    } catch (cause) {
      const error = friendlyError(String(cause));
      setStatus(error);
      setEntries((prev) => [...prev, entry(error, "error")]);
    } finally {
      setToolBusy(false);
    }
  }

  async function consumeEvaluationStream(
    action: EvaluationToolAction,
    surface: "insights" | "breakdown",
    body: ReadableStream<Uint8Array>,
  ) {
    let failed = false;
    for await (const event of readSseEvents<EvaluationEvent>(body)) {
      if (event.event === "eval-progress") {
        setStatus(event.data.message);
        setCapability((prev) => appendProgressMessage(prev, action, event.data.message));
      } else if (event.event === "eval-case") {
        setStatus(`Case ${event.data.index}/${event.data.total} checked.`);
        setCapability((prev) => appendProgressCase(prev, action, event.data));
      } else if (event.event === "artifact") {
        setCapability(toCapabilityPanel(action, surface, event.data.body));
        setStatus(`${toolLabel(action)} ready.`);
      } else if (event.event === "error") {
        failed = true;
        const error = parseError(event.data, 500, action);
        setStatus(error);
        setEntries((prev) => [...prev, entry(error, "error")]);
      }
    }

    if (failed) setCapability(null);
  }
}

function activeRailView(mode: "build" | "import" | "skills" | "history"): SideRailView {
  return mode;
}

function isGithubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "github.com" ||
      url.hostname === "raw.githubusercontent.com"
    );
  } catch {
    return false;
  }
}

function apiPath(action: ToolAction): string {
  if (action === "visualise") return "api/visualise";
  if (action === "test-run") return "api/test-run";
  if (action === "triggering-eval") return "api/triggering-eval";
  return "api/export";
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
  item: Extract<EvaluationEvent, { event: "eval-case" }>["data"],
): Extract<CapabilityPanel, { kind: "evaluation-progress" }> {
  const current =
    panel?.kind === "evaluation-progress" && panel.action === action
      ? panel
      : emptyProgressPanel(action);
  return { ...current, cases: [...current.cases, item] };
}

function parseError(body: unknown, status: number, action: ToolAction): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  const code = body && typeof body === "object" && "code" in body ? String(body.code) : "";
  if (code === "cap_reached" && action === "triggering-eval") {
    return "Triggering eval is not available on the free plan.";
  }
  if (code === "cap_reached") return "Out of free usage today.";
  if (code === "model_unavailable" || code === "not_configured") return "No model is configured.";
  return friendlyError(error || `Request failed (${status}).`);
}

function parseImportError(body: unknown, status: number): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  return friendlyError(error || `Import failed (${status}).`);
}

function parseGenericError(body: unknown, status: number): string {
  const error = body && typeof body === "object" && "error" in body ? String(body.error) : "";
  return friendlyError(error || `Request failed (${status}).`);
}

function toCapabilityPanel(
  action: ToolAction,
  surface: "insights" | "breakdown",
  body: unknown,
): CapabilityPanel {
  if (action === "visualise" && isRecord(body) && typeof body.mermaid === "string") {
    return { kind: "visualise", mermaid: body.mermaid };
  }

  if (action === "export" && isRecord(body)) {
    const files = Array.isArray(body.files) ? body.files.filter(isExportFile) : [];
    return {
      kind: "export",
      rootDir: typeof body.rootDir === "string" ? body.rootDir : "skill",
      files,
    };
  }

  if (isEvaluationTool(action) && surface === "breakdown") {
    const breakdown = toEvaluationBreakdown(action, body);
    if (breakdown) {
      return { kind: "breakdown", action, title: toolLabel(action), breakdown };
    }
  }

  if (isEvaluationTool(action) && isInsight(body)) {
    return { kind: "insights", action, title: toolLabel(action), insight: body };
  }

  throw new Error("Capability returned an unexpected response.");
}

function isEvaluationTool(action: ToolAction): action is EvaluationToolAction {
  return action === "test-run" || action === "triggering-eval";
}

function toEvaluationBreakdown(
  action: EvaluationToolAction,
  body: unknown,
): EvaluationBreakdown | null {
  if (action === "test-run" && isTestRunBreakdown(body)) {
    return { kind: "test-run", scenario: body.scenario, transcript: body.transcript };
  }
  if (action === "triggering-eval" && isTriggeringBreakdown(body)) {
    return { kind: "triggering-eval", passed: body.passed, cases: body.cases };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isExportFile(value: unknown): value is { readonly path: string; readonly contents: string } {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.contents === "string"
  );
}

function isInsight(value: unknown): value is InsightPanel {
  return (
    isRecord(value) &&
    (value.verdict === "good" ||
      value.verdict === "needs-attention" ||
      value.verdict === "failing") &&
    typeof value.summary === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every((item) => typeof item === "string") &&
    Array.isArray(value.watch) &&
    value.watch.every((item) => typeof item === "string")
  );
}

function isLintInsight(value: unknown): value is LintInsightPanel {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    isLintGrade(value.grade) &&
    typeof value.summary === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every((item) => typeof item === "string") &&
    Array.isArray(value.watch) &&
    value.watch.every((item) => typeof item === "string")
  );
}

function isLintBreakdown(value: unknown): value is LintBreakdownPanel {
  return (
    isRecord(value) &&
    isLintSummary(value.summary) &&
    Array.isArray(value.findings) &&
    value.findings.every(isLintFinding)
  );
}

function isLintFinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.rule === "string" &&
    (value.severity === "error" || value.severity === "warn" || value.severity === "info") &&
    typeof value.message === "string"
  );
}

function isImportResponse(value: unknown): value is {
  readonly skill: {
    readonly id: string;
    readonly source: SkillSource;
    readonly lintSummary?: SkillVersionLintSummary | null;
  };
  readonly rendered: RenderedDoc;
  readonly source: SourceDoc;
} {
  return (
    isRecord(value) &&
    isRecord(value.skill) &&
    typeof value.skill.id === "string" &&
    isSkillSource(value.skill.source) &&
    (!("lintSummary" in value.skill) ||
      value.skill.lintSummary === null ||
      isLintSummary(value.skill.lintSummary)) &&
    isRenderedDoc(value.rendered) &&
    isSourceDoc(value.source)
  );
}

function isSkillSource(value: unknown): value is SkillSource {
  return (
    isRecord(value) &&
    isRecord(value.frontmatter) &&
    typeof value.frontmatter.name === "string" &&
    typeof value.frontmatter.description === "string" &&
    isRecord(value.frontmatter.extra) &&
    typeof value.body === "string"
  );
}

function toSkillList(value: unknown): readonly {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}[] {
  if (!isRecord(value) || !Array.isArray(value.skills)) {
    throw new Error("Skills returned an unexpected response.");
  }
  return value.skills.map((skill) => {
    if (
      !isRecord(skill) ||
      typeof skill.id !== "string" ||
      typeof skill.name !== "string" ||
      typeof skill.description !== "string"
    ) {
      throw new Error("Skills returned an unexpected response.");
    }
    return { id: skill.id, name: skill.name, description: skill.description };
  });
}

function toSkillDetail(value: unknown): {
  readonly skill: {
    readonly id: string;
    readonly source: SkillSource;
    readonly latestRevision: number;
    readonly lintSummary?: SkillVersionLintSummary | null;
  };
  readonly versions: readonly {
    readonly id: string;
    readonly revision: number;
    readonly source: SkillSource;
    readonly lintSummary?: SkillVersionLintSummary | null;
  }[];
} {
  if (
    !isRecord(value) ||
    !isRecord(value.skill) ||
    typeof value.skill.id !== "string" ||
    !isSkillSource(value.skill.source) ||
    typeof value.skill.latestRevision !== "number"
  ) {
    throw new Error("Skill returned an unexpected response.");
  }
  const versions = Array.isArray(value.versions) ? value.versions.map((version) => {
    if (
      !isRecord(version) ||
      typeof version.id !== "string" ||
      typeof version.revision !== "number" ||
      !isSkillSource(version.source) ||
      ("lintSummary" in version &&
        version.lintSummary !== null &&
        !isLintSummary(version.lintSummary))
    ) {
      throw new Error("Skill returned an unexpected response.");
    }
    const lintSummary =
      "lintSummary" in version && isLintSummary(version.lintSummary)
        ? version.lintSummary
        : null;
    return {
      id: version.id,
      revision: version.revision,
      source: version.source,
      lintSummary,
    };
  }) : [];
  return {
    skill: {
      id: value.skill.id,
      source: value.skill.source,
      latestRevision: value.skill.latestRevision,
      lintSummary:
        "lintSummary" in value.skill && isLintSummary(value.skill.lintSummary)
          ? value.skill.lintSummary
          : null,
    },
    versions,
  };
}

function latestLintSummary(
  detail: ReturnType<typeof toSkillDetail>,
): SkillVersionLintSummary | null {
  return (
    detail.versions.find((version) => version.revision === detail.skill.latestRevision)
      ?.lintSummary ?? null
  );
}

function toLintPanel(surface: "insights" | "breakdown", body: unknown): CapabilityPanel {
  if (surface === "breakdown" && isLintBreakdown(body)) {
    return { kind: "lint-breakdown", title: "Quality", breakdown: body };
  }
  if (surface === "insights" && isLintInsight(body)) {
    return { kind: "lint-insights", title: "Quality", insight: body };
  }
  throw new Error("Quality returned an unexpected response.");
}

function lintSummaryFromResponse(
  surface: "insights" | "breakdown",
  body: unknown,
): SkillVersionLintSummary | null {
  if (surface === "breakdown" && isLintBreakdown(body)) return body.summary;
  return null;
}

function isLintSummary(value: unknown): value is SkillVersionLintSummary {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    isLintGrade(value.grade) &&
    isRecord(value.counts) &&
    typeof value.counts.error === "number" &&
    typeof value.counts.warn === "number" &&
    typeof value.counts.info === "number"
  );
}

function isLintGrade(value: unknown): value is SkillVersionLintSummary["grade"] {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function toRunHistory(value: unknown): {
  readonly testRuns: readonly { readonly status: string; readonly prompt: string }[];
  readonly evalRuns: readonly { readonly status: string; readonly summary: string }[];
} {
  if (!isRecord(value) || !Array.isArray(value.testRuns) || !Array.isArray(value.evalRuns)) {
    throw new Error("History returned an unexpected response.");
  }
  return {
    testRuns: value.testRuns.map((run) => {
      if (!isRecord(run) || typeof run.status !== "string" || !isRecord(run.scenario)) {
        throw new Error("History returned an unexpected response.");
      }
      return {
        status: run.status,
        prompt: typeof run.scenario.prompt === "string" ? run.scenario.prompt : "Untitled scenario",
      };
    }),
    evalRuns: value.evalRuns.map((run) => {
      if (!isRecord(run) || typeof run.status !== "string" || !isRecord(run.result)) {
        throw new Error("History returned an unexpected response.");
      }
      const result = run.result;
      const summary =
        isRecord(result.insight) && typeof result.insight.summary === "string"
          ? result.insight.summary
          : "No summary stored.";
      return { status: run.status, summary };
    }),
  };
}

function isRenderedDoc(value: unknown): value is RenderedDoc {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.sections)
  );
}

function isSourceDoc(value: unknown): value is SourceDoc {
  return isRecord(value) && typeof value.markdown === "string";
}

function isTestRunBreakdown(
  value: unknown,
): value is Extract<EvaluationBreakdown, { kind: "test-run" }> {
  return (
    isRecord(value) &&
    isRecord(value.scenario) &&
    typeof value.scenario.prompt === "string" &&
    Array.isArray(value.transcript) &&
    value.transcript.every(isTranscriptStep)
  );
}

function isTranscriptStep(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "model") return typeof value.text === "string";
  if (value.kind === "tool-call") return typeof value.tool === "string" && "input" in value;
  if (value.kind === "tool-result") return typeof value.tool === "string" && "output" in value;
  return false;
}

function isTriggeringBreakdown(
  value: unknown,
): value is Extract<EvaluationBreakdown, { kind: "triggering-eval" }> {
  return (
    isRecord(value) &&
    typeof value.passed === "boolean" &&
    Array.isArray(value.cases) &&
    value.cases.every(isTriggeringCase)
  );
}

function isTriggeringCase(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    (value.expected === "fire" || value.expected === "silent") &&
    (value.actual === "fire" || value.actual === "silent") &&
    typeof value.pass === "boolean" &&
    typeof value.rationale === "string"
  );
}
