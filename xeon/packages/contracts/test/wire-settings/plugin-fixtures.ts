import type { PluginCard } from "../../src/extensions/index.ts";

/** 형식이 맞는 내용 해시(`sha256:<64자 16진>`) */
export const HASH: string = `sha256:${"a".repeat(64)}`;
export const AT: string = "2026-11-17T00:00:00.000Z";

/**
 * 검사를 모두 통과하는 카드 한 장. 테스트는 필드를 덮어써 규칙을 하나씩 어긴다.
 * 타입 주석으로 모양을 확인한다(단언은 쓰지 않는다)
 */
export const PLUGIN_CARD: PluginCard = {
  name: "acme-notes",
  displayName: "Acme notes",
  purpose: "Keep notes about the current project.",
  does: {
    inject: {
      instructions: {
        always: [{ path: "instructions.md", bytes: 120 }],
        skills: [{ name: "notes", path: "skills/notes/SKILL.md", descriptionChars: 80 }],
      },
      tools: [{ name: "note_add", description: "Add a note" }],
      mcpServers: [{ name: "notes-db", transport: "stdio" }],
      agents: [],
      providers: [],
      commands: ["review-notes"],
      ui: [{ id: "panel", placement: "side", readsState: null, modelVisible: "none" }],
      replaces: [],
    },
    hook: {
      hooks: [{ name: "turn.before", fold: "chain", position: "turn-start", powers: ["modify"] }],
    },
    drive: null,
  },
  enforcement: "enforced",
  runs: { code: true, isolated: true },
  cost: { always: 120, drive: null, onDemand: 80, toolCount: 1, basis: "declared" },
  health: { state: "ok", lastActiveAt: AT, lastError: null },
  origin: { kind: "user" },
  review: { state: "approved", currentHash: HASH, pendingItemId: null, approvedAt: AT },
  usedBy: ["default", "common"],
};
