import {
  DialogAsk,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  WorkspaceImages,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const DIALOG_EXTENSION_NAME = "cap-dialog";

/**
 * 내장 L2 플러그인 매니페스트(L2.dialog.spec §7). 제공하는 능력은 `dialog.ask`, `dialog.commands`, `dialog.status`,
 * `dialog.attachments`, `dialog.notify`다. `dialog.aside`, `dialog.styles`는 2차다. `dialog.notify`는 지점을 더하지 않는다
 * (구독은 내구 피드로 받는다).
 */
export function dialogManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: DIALOG_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Dialog",
    description: "Questions, slash commands, status line, attachments and notices (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [DialogAsk, DialogCommands, DialogStatus, DialogAttachments, DialogNotify].map(
      (def) => ({
        id: def.id,
        version: def.version,
      }),
    ),
    requires: [{ id: WorkspaceImages.id, range: "^1.0.0" }],
    points: [
      "input.user.before",
      "tool.execution.before",
      "tool.execution.after",
      "input.agent.before",
    ],
    usesPost: false,
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
