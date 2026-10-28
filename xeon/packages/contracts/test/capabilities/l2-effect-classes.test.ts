import { describe, expect, test } from "bun:test";
import {
  DialogAside,
  DialogAsk,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  DialogStyles,
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
  McpClient,
  validateCapability,
  WebBrowse,
  WebFetch,
  WebResearch,
  WebSearch,
  WorkGoals,
  WorkPlans,
  WorkReports,
  WorkTasks,
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
  type AnyCapabilityDef,
} from "../../src/capabilities/index.ts";

// M3-REQ-88, ADR-0015 §3.3. 모든 L2 메서드의 분류를 값으로 고정한다. 바뀌면 L2 spec의 분류 표와 공급자 적합성 시험을 함께 고친다.
// readOnly: 읽기. idempotent: `requestId`로 내구 멱등을 지키는 쓰기. none: 선언 없음(replay unsafe).

type EffectClass = "readOnly" | "idempotent" | "none";

function classOf(def: AnyCapabilityDef, name: string): string {
  const method = def.service.methods[name];
  if (method === undefined) return `${def.id}.${name}: missing`;
  const effect: EffectClass =
    method.readOnly === true ? "readOnly" : method.idempotent === true ? "idempotent" : "none";
  return `${def.id}.${name} ${effect} ${method.replay ?? "unsafe"}`;
}

const DEFS: readonly AnyCapabilityDef[] = [
  DialogAsk,
  DialogAside,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  DialogStyles,
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
  McpClient,
  WebBrowse,
  WebFetch,
  WebResearch,
  WebSearch,
  WorkGoals,
  WorkPlans,
  WorkReports,
  WorkTasks,
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
];

const EXPECTED: readonly string[] = [
  "dialog.ask.ask idempotent safe",
  "dialog.aside.ask readOnly safe",
  "dialog.attachments.add none unsafe",
  "dialog.commands.register none unsafe",
  "dialog.commands.list readOnly safe",
  "dialog.commands.expand readOnly safe",
  "dialog.commands.run none unsafe",
  "dialog.notify.emit idempotent safe",
  "dialog.notify.list readOnly safe",
  "dialog.status.setItem none unsafe",
  "dialog.status.clearItem none unsafe",
  "dialog.status.list readOnly safe",
  "dialog.styles.register none unsafe",
  "dialog.styles.select none unsafe",
  "knowledge.ledger.list readOnly safe",
  "knowledge.ledger.show readOnly safe",
  "knowledge.ledger.rollback idempotent safe",
  "knowledge.ledger.scan readOnly safe",
  "knowledge.ledger.proposals readOnly safe",
  "knowledge.ledger.decide none unsafe",
  "knowledge.memory.read readOnly safe",
  "knowledge.memory.add idempotent safe",
  "knowledge.memory.replace idempotent safe",
  "knowledge.memory.remove idempotent safe",
  "knowledge.memory.manage idempotent safe",
  "knowledge.search.query readOnly safe",
  "knowledge.search.scroll readOnly safe",
  "knowledge.search.read readOnly safe",
  "knowledge.search.list readOnly safe",
  "knowledge.skills.list readOnly safe",
  "knowledge.skills.view readOnly safe",
  "knowledge.skills.create idempotent safe",
  "knowledge.skills.edit idempotent safe",
  "knowledge.skills.patch idempotent safe",
  "knowledge.skills.writeFile idempotent safe",
  "knowledge.skills.remove idempotent safe",
  "knowledge.skills.manage idempotent safe",
  "knowledge.skills.reindex none unsafe",
  "mcp.client.listServers readOnly safe",
  "mcp.client.status readOnly safe",
  "mcp.client.connect none unsafe",
  "mcp.client.reconnect none unsafe",
  "mcp.client.disable none unsafe",
  "mcp.client.listTools readOnly safe",
  "mcp.client.callTool none unsafe",
  "mcp.client.listPrompts readOnly safe",
  "mcp.client.getPrompt readOnly safe",
  "mcp.client.listResources readOnly safe",
  "mcp.client.readResource readOnly safe",
  "web.browse.open none unsafe",
  "web.browse.act none unsafe",
  "web.browse.read readOnly safe",
  "web.browse.close none unsafe",
  "web.fetch.fetch readOnly safe",
  "web.research.start none unsafe",
  "web.research.get readOnly safe",
  "web.research.cancel none unsafe",
  "web.research.run none unsafe",
  "web.search.search readOnly safe",
  "work.goals.set idempotent safe",
  "work.goals.status readOnly safe",
  "work.goals.clear idempotent safe",
  "work.goals.judge idempotent safe",
  "work.plans.enterMode none unsafe",
  "work.plans.exitMode none unsafe",
  "work.plans.submit idempotent safe",
  "work.plans.approve idempotent safe",
  "work.plans.reject idempotent safe",
  "work.plans.revise idempotent safe",
  "work.plans.versions readOnly safe",
  "work.reports.build idempotent safe",
  "work.tasks.create idempotent safe",
  "work.tasks.update idempotent safe",
  "work.tasks.link idempotent safe",
  "work.tasks.list readOnly safe",
  "work.tasks.write idempotent safe",
  "workspace.files.read readOnly safe",
  "workspace.files.write none unsafe",
  "workspace.files.edit none unsafe",
  "workspace.files.list readOnly safe",
  "workspace.files.grep readOnly safe",
  "workspace.files.find readOnly safe",
  "workspace.images.load readOnly safe",
  "workspace.images.resize readOnly safe",
  "workspace.images.register none unsafe",
  "workspace.shell.run none unsafe",
];

describe("L2 method effect classes (M3-REQ-88)", () => {
  test("every method of every L2 definition has the expected class and replay", () => {
    const actual = DEFS.flatMap((def) =>
      Object.keys(def.service.methods).map((name) => classOf(def, name)),
    );
    expect(actual).toEqual([...EXPECTED]);
  });

  test("no L2 definition has the effect_class_missing warning or any other issue", () => {
    for (const def of DEFS) expect(validateCapability(def)).toEqual([]);
  });
});
