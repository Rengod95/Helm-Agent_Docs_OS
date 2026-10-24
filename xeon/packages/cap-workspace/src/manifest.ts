import { WorkspaceFiles, WorkspaceImages, WorkspaceShell } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const WORKSPACE_EXTENSION_NAME = "cap-workspace";

/**
 * 내장 L2 플러그인 매니페스트(L2.workspace.plan §2 manifest.ts). 제공하는 능력은 셋이다:
 * `workspace.files`(read, ls), `workspace.shell`(bash), `workspace.images`(M2 최소형: register, load).
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
      { id: WorkspaceImages.id, version: WorkspaceImages.version },
    ],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
