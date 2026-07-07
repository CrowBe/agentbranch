"use client";

import { useState, useSyncExternalStore } from "react";
import { createWorkspace } from "./workspace";
import type { WorkspaceActions, WorkspaceInit, WorkspaceSnapshot } from "./workspace.types";

/**
 * The one React touchpoint of the workspace: create the store once, subscribe
 * the component tree to its snapshot. Everything behavioural lives in
 * `workspace.ts`, framework-free.
 */
export function useWorkspace(init: WorkspaceInit): {
  snapshot: WorkspaceSnapshot;
  actions: WorkspaceActions;
} {
  const [workspace] = useState(() => createWorkspace(init));
  const snapshot = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  return { snapshot, actions: workspace.actions };
}
