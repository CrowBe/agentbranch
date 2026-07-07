"use client";

import { useState } from "react";
import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import type { SkillSource, SkillVersionLintSummary } from "@/modules/skill";
import { TopBar } from "./top-bar";
import { SideRail } from "./side-rail";
import { ModelConsole } from "./model-console";
import { HeroPanel } from "./hero-panel";
import { InteractionPanel } from "./interaction-panel";
import { DraftControls } from "./draft-controls";
import { useWorkspace } from "./workspace";

/**
 * The app shell — composes the chrome top bar, collapsible left rail,
 * preview-primary hero, and slim right interaction panel (ARCHITECTURE §7).
 * Composition/JSX only: all protocol + choreography state lives in the
 * workspace module (issue #159); the shell renders its snapshot and wires the
 * controls to its actions. The only React state here is pure chrome.
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
  const { snapshot, actions } = useWorkspace({ rendered, source, initialSkill, initialLintSummary });

  return (
    <div className="flex h-dvh flex-col">
      <TopBar onToggleMenu={() => setMenuExpanded((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <SideRail
          expanded={menuExpanded}
          active={snapshot.mode}
          onBuild={actions.showBuild}
          onImport={actions.showImport}
          onModels={() => setConsoleOpen(true)}
          onSkills={() => void actions.showSkills()}
          onEquipment={actions.showEquipment}
          onHistory={() => void actions.showHistory()}
        />
        <main className="min-w-0 flex-1 overflow-hidden">
          <HeroPanel
            rendered={snapshot.heroDocs.rendered}
            source={snapshot.heroDocs.source}
            view={snapshot.view}
            onViewChange={actions.setView}
            capability={snapshot.capability}
            activeTool={snapshot.activeTool}
            toolBusy={snapshot.toolBusy}
            lintSummary={snapshot.lintSummary}
            lintBusy={snapshot.lintBusy}
            banner={
              snapshot.mode === "build" && snapshot.current ? (
                <DraftControls
                  onDraft={snapshot.branchId !== null}
                  canStartDraft={snapshot.currentSkillId !== null}
                  openDrafts={snapshot.openDrafts}
                  busy={snapshot.busy || snapshot.toolBusy || snapshot.lintBusy || snapshot.draftBusy}
                  onStartDraft={() => void actions.startDraft()}
                  onOpenDraft={(id) => void actions.openDraft(id)}
                  onPromote={() => void actions.promote()}
                  onDiscard={() => void actions.discardDraft()}
                />
              ) : undefined
            }
            onToolSelect={(action) => void actions.runTool(action)}
            onLintSelect={() => void actions.selectLintSurface("insights")}
            onEvaluationSurfaceChange={(surface) => void actions.selectEvaluationSurface(surface)}
            onLintSurfaceChange={(surface) => void actions.selectLintSurface(surface)}
            onReviseWithFeedback={actions.reviseWithFeedback}
            feedbackBusy={snapshot.busy || snapshot.toolBusy}
          />
          {snapshot.status && (
            <p className="text-label px-6 pb-4 text-on-surface-variant" role="status">
              {snapshot.status}
            </p>
          )}
        </main>
        <InteractionPanel
          entries={snapshot.entries}
          busy={snapshot.busy || snapshot.equipmentBusy}
          mode={snapshot.mode}
          onSend={(message) => void actions.send(message)}
          onImport={(raw) => void actions.importSkill(raw)}
          onEquipment={(raw) => void actions.submitEquipment(raw)}
        />
      </div>
      {consoleOpen && <ModelConsole onClose={() => setConsoleOpen(false)} />}
    </div>
  );
}
