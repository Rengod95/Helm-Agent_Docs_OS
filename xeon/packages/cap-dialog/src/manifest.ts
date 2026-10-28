import {
  DialogAsk,
  DialogAttachments,
  DialogCommands,
  DialogStatus,
  WorkspaceImages,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const DIALOG_EXTENSION_NAME = "cap-dialog";

/**
 * 내장 L2 플러그인 매니페스트(L2.dialog.spec §7). 제공하는 능력은 M2에서 넷이다: `dialog.ask`, `dialog.commands`,
 * `dialog.status`, `dialog.attachments`. `dialog.aside`, `dialog.styles`는 2차, `dialog.notify`는 M3에서 `provides`와
 * `points`에 더한다.
 */
export function dialogManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: DIALOG_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Dialog",
    description: "Questions, slash commands, status line and attachments (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [DialogAsk, DialogCommands, DialogStatus, DialogAttachments].map((def) => ({
      id: def.id,
      version: def.version,
    })),
    requires: [{ id: WorkspaceImages.id, range: "^1.0.0" }],
    points: ["input", "tool_execution_start", "tool_execution_end", "before_agent_start"],
    usesPost: false,
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
