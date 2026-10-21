import { WorkspaceFiles, WorkspaceShell } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const WORKSPACE_EXTENSION_NAME = "cap-workspace";

/**
 * 내장 L2 플러그인 매니페스트(L2.workspace.plan §2 manifest.ts). 제공하는 능력은 M1에서 두 개다:
 * `workspace.files`(read, ls)와 `workspace.shell`(bash). `workspace.images`는 M2(plan W7)에서 `provides`에 더한다.
 */
export function workspaceManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: WORKSPACE_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Workspace tools",
    description: "File, shell and (later) image tools over the execution environment (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [
      { id: WorkspaceFiles.id, version: WorkspaceFiles.version },
      { id: WorkspaceShell.id, version: WorkspaceShell.version },
    ],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
