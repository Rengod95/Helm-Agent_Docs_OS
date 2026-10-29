import { ArtifactsReviews, WorkspaceFiles } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const ARTIFACTS_EXTENSION_NAME = "cap-artifacts";

/**
 * 내장 L2 플러그인 매니페스트(L2.artifacts.spec §7). M3b는 `artifacts.reviews`만 제공한다.
 * 거절 적용은 선택 의존 `workspace.files`의 `edit`를 쓴다(spec §4.2.5 후보 A).
 */
export function artifactsManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: ARTIFACTS_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Artifacts and reviews",
    description: "Approve or reject file changes hunk by hunk (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [{ id: ArtifactsReviews.id, version: ArtifactsReviews.version }],
    optional: [{ id: WorkspaceFiles.id, range: `^${WorkspaceFiles.version}` }],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
