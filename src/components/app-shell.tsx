"use client";

import { useState } from "react";
import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import type { SkillSource, SkillVersionLintSummary } from "@/modules/skill";
import { TopBar } from "./top-bar";
import { SideRail } from "./side-rail";
import { ModelConsole } from "./model-console";
import { AccountPanel } from "./account-panel";
import { HeroPanel } from "./hero-panel";
import { InteractionPanel } from "./interaction-panel";
import { DraftControls } from "./draft-controls";
import { PublishControls } from "./publish-controls";
import { Segmented } from "./ui/segmented";
import { useWorkspace } from "./workspace";

/**
 * The app shell — mobile-first (ARCHITECTURE §7). Compact viewports get the
 * chat drawer as the main window with a Chat | Skill tab pair to swap to the
 * document; from `lg` up the preview-primary arrangement holds (hero centre,
 * slim right panel) and the tabs disappear. Both surfaces stay mounted — the
 * tabs only flip visibility, so no state is lost switching. Composition/JSX
 * only: all protocol + choreography state lives in the workspace module
 * (issue #159); the only React state here is pure chrome.
 */
export function AppShell({
  rendered,
  source,
  initialSkill,
  initialLintSummary = null,
  quotaLabel,
}: {
  rendered: RenderedDoc;
  source: SourceDoc;
  initialSkill: SkillSource;
  initialLintSummary?: SkillVersionLintSummary | null;
  /** The top bar's free-quota chip text, computed server-side at page load. */
  quotaLabel?: string;
}) {
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "skill">("chat");
  const { snapshot, actions } = useWorkspace({ rendered, source, initialSkill, initialLintSummary, quotaLabel });

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        onToggleMenu={() => setMenuExpanded((v) => !v)}
        onQuotaSelect={() => setAccountOpen(true)}
        quotaLabel={snapshot.quotaLabel}
      />
      <div className="flex justify-center border-b border-outline-variant bg-surface px-4 py-2 lg:hidden">
        <Segmented
          options={[
            { value: "chat", label: "Chat" },
            { value: "skill", label: "Skill" },
          ]}
          value={mobileTab}
          onChange={setMobileTab}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <SideRail
          expanded={menuExpanded}
          active={snapshot.mode}
          onCollapse={() => setMenuExpanded(false)}
          onBuild={actions.showBuild}
          onImport={actions.showImport}
          onModels={() => setConsoleOpen(true)}
          onAccount={() => setAccountOpen(true)}
          onSkills={() => void actions.showSkills()}
          onEquipment={actions.showEquipment}
          onHistory={() => void actions.showHistory()}
          onTemplates={() => void actions.showTemplates()}
        />
        <main
          className={`min-w-0 flex-1 flex-col overflow-hidden ${
            mobileTab === "skill" ? "flex" : "hidden lg:flex"
          }`}
        >
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
            onCapabilityClose={actions.closeCapability}
            onEvaluationSurfaceChange={(surface) => void actions.selectEvaluationSurface(surface)}
            onLintSurfaceChange={(surface) => void actions.selectLintSurface(surface)}
            onSafetySurfaceChange={(surface) => actions.selectSafetySurface(surface)}
            onReviseWithFeedback={actions.reviseWithFeedback}
            onApplyMetadataSuggestion={actions.applyMetadataSuggestion}
            feedbackBusy={snapshot.busy || snapshot.toolBusy}
          />
          {snapshot.mode === "build" && snapshot.currentSkillId && snapshot.branchId === null && (
            <PublishControls
              skillName={snapshot.current?.frontmatter.name ?? "skill"}
              busy={snapshot.busy}
              onPublish={(owner, name) => void actions.publish(owner, name)}
            />
          )}
          {snapshot.status && (
            <p className="text-label px-4 pb-3 text-on-surface-variant lg:px-6 lg:pb-4" role="status">
              {snapshot.status}
            </p>
          )}
        </main>
        <InteractionPanel
          entries={snapshot.entries}
          busy={snapshot.busy || snapshot.equipmentBusy}
          mode={snapshot.mode}
          className={mobileTab === "chat" ? "flex" : "hidden lg:flex"}
          onSend={(message) => void actions.send(message)}
          onImport={(raw) => void actions.importSkill(raw)}
          onEquipment={(raw) => void actions.submitEquipment(raw)}
          onTemplates={(query) => void actions.showTemplates(query)}
        />
      </div>
      {consoleOpen && <ModelConsole onClose={() => setConsoleOpen(false)} />}
      {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} />}
    </div>
  );
}
