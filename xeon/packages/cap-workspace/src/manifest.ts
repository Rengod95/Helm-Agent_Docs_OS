import {
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceProtection,
  WorkspaceShell,
} from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";

export const WORKSPACE_EXTENSION_NAME = "cap-workspace";

/**
 * 내장 L2 플러그인 매니페스트(L2.workspace.plan §2 manifest.ts). 제공하는 기능은 셋이다:
 * `workspace.files`(read, write, edit, grep), `workspace.shell`(bash), `workspace.images`(M2 최소형: register, load),
 * `workspace.protection`(sandbox_protect, sandbox_protected: 보호 경로 더하기와 목록, AGE-63).
 */
export function workspaceManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 2,
    name: WORKSPACE_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Workspace tools",
    description: "File, shell and (later) image tools over the execution environment (L2).",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L2",
        hooks: [],
        provides: [
          { id: WorkspaceFiles.id, version: WorkspaceFiles.version },
          { id: WorkspaceShell.id, version: WorkspaceShell.version },
          { id: WorkspaceImages.id, version: WorkspaceImages.version },
          { id: WorkspaceProtection.id, version: WorkspaceProtection.version },
        ],
      },
    ],
    trust: { level: "builtin" },
  });
}
