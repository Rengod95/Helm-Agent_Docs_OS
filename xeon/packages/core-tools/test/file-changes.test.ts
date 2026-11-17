import { expect, test } from "bun:test";
import {
  fileChangesOf,
  type FileChangeEntry,
  type ToolName,
} from "@fresnel/contracts/capabilities";
import type {
  ReportedFileChange,
  ToolReplaceClaim,
  ToolResourceDef,
} from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { observedEntriesOf, reportedEntriesOf, withFileChanges } from "../src/file-changes.ts";
import { TOOLS_SETTING_KEYS } from "../src/settings.ts";
import {
  EDITED_FILE_CHANGE,
  callTool,
  createHarness,
  expectOk,
  installHandlers,
  layer,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// M5e 스펙 §4.7(변경 기록), §5.4 F-1·F-3·F-4·F-6, §10 A-12·A-13. 도구 결과 `details`의 `fileChanges`가 파이프라인을 지나는 시험.

/** 내장 `edit`이 코어 파일 서비스로 쓴 변경(관찰). 옛 `FileChange` 한 건이 `details`로 온다 */
const OBSERVED: FileChangeEntry = {
  path: "a.txt",
  op: "modify",
  existed: true,
  diff: EDITED_FILE_CHANGE.diff,
  added: 1,
  removed: 1,
  firstChangedLine: 1,
  source: "observed",
};

/** 플러그인 대체 도구가 `ctx.changes.report`로 알린 새 파일(보고) */
const REPORTED_FILE: ReportedFileChange = {
  path: "notes.md",
  op: "create",
  existed: false,
  diff: "--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1 @@\n+hi\n",
  added: 1,
  removed: 0,
};
const REPORTED: FileChangeEntry = { ...REPORTED_FILE, source: "reported" };

const USER: ToolReplaceClaim = { extension: "acme-files", trust: "user" };

/** 이름이 `edit`인 확장 대체 도구. 실행하면 `report`로 알린 변경을 돌려준다 */
function editReplacement(report: readonly ReportedFileChange[]): ToolResourceDef {
  return {
    name: "edit",
    description: "edit by an extension",
    parameters: Type.Object({}, { additionalProperties: true }),
    replay: "unsafe",
    replaces: USER,
    execute: (_args, ctx) => {
      ctx.changes?.report(report);
      return Promise.resolve("edited");
    },
  };
}

const ALLOW_EDIT = layer("user", {
  [TOOLS_SETTING_KEYS.rules]: [
    { id: "user.allow-edit", action: "tool.call", resource: { tool: "edit" }, effect: "allow" },
  ],
});

const EDIT_ARGS = { path: "a.txt", oldText: "hello", newText: "bye" } as const;

/** 대체 도구를 등록하고 사용자가 허용해 활성으로 만든다 */
async function activate(h: Harness, def: ToolResourceDef): Promise<void> {
  expectOk(h.runtime.tools.register("acme-files/main", def));
  expectOk(
    await h.runtime.tools.advertise({
      run: { threadId: h.thread, caller: "main", depth: 0 },
      activated: new Set<ToolName>(),
    }),
  );
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  await until(() => h.runtime.tools.replacements()[0]?.status === "active");
}

test("a builtin edit keeps its details as the single FileChange when no hook touches the result (F-2)", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  const out = await callTool(h.runtime.tools, h.run(), { id: "e0", name: "edit", args: EDIT_ARGS });
  expect(out.blocked).toBeUndefined();
  expect(out.result?.details).toEqual(EDITED_FILE_CHANGE);
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([OBSERVED]);
});

test("a tool.result patch that sets details to null does not remove the builtin edit's observed change (F-3)", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  await installHandlers(h, "stripper", ["tool.result"], (g) => {
    g.on("tool.result", () => ({ details: null }));
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "e1", name: "edit", args: EDIT_ARGS });
  expect(out.blocked).toBeUndefined();
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([OBSERVED]);
  expect(out.result?.details).toEqual({ resultPatchedBy: ["stripper"], fileChanges: [OBSERVED] });
});

test("a tool.result patch that marks the result as an error keeps the observed change (F-6)", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  await installHandlers(h, "failer", ["tool.result"], (g) => {
    g.on("tool.result", () => ({ isError: true }));
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "e2", name: "edit", args: EDIT_ARGS });
  expect(out.result?.isError).toBe(true);
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([OBSERVED]);
});

test("a replacement edit's reported change reaches the result as a reported entry; the builtin does not run (A-12)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  await activate(h, editReplacement([REPORTED_FILE]));
  const out = await callTool(h.runtime.tools, h.run(), { id: "r1", name: "edit", args: EDIT_ARGS });
  expect(out.blocked).toBeUndefined();
  expect(out.result?.details).toEqual({ fileChanges: [REPORTED] });
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([REPORTED]);
  expect(probe.calls).toEqual([]);
});

test("a tool.result patch cannot remove the reported change of a replacement edit (F-3)", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  await activate(h, editReplacement([REPORTED_FILE]));
  await installHandlers(h, "clearer", ["tool.result"], (g) => {
    g.on("tool.result", () => ({ details: { fileChanges: [] } }));
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "r2", name: "edit", args: EDIT_ARGS });
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([REPORTED]);
  expect(out.result?.details).toEqual({ resultPatchedBy: ["clearer"], fileChanges: [REPORTED] });
});

test("a replacement that reports nothing cannot gain a fileChanges entry from a tool.result patch", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  await activate(h, editReplacement([]));
  await installHandlers(h, "forger", ["tool.result"], (g) => {
    g.on("tool.result", () => ({ details: { fileChanges: [REPORTED] } }));
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "r3", name: "edit", args: EDIT_ARGS });
  expect(out.result?.details).toEqual({ resultPatchedBy: ["forger"] });
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([]);
});

test("a reported entry that breaks the schema is dropped and the valid ones are kept", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.setLayers([ALLOW_EDIT]);
  const broken: ReportedFileChange = { ...REPORTED_FILE, path: "bad.md", added: -1 };
  await activate(h, editReplacement([REPORTED_FILE, broken]));
  const out = await callTool(h.runtime.tools, h.run(), { id: "r4", name: "edit", args: EDIT_ARGS });
  expect(fileChangesOf(out.result?.details ?? null)).toEqual([REPORTED]);
});

// 순수 함수의 규칙(F-2, F-4)은 파이프라인을 거치지 않고 값으로 본다

test("an observed change wins over a reported change for the same path; other reported paths are kept (F-4)", () => {
  const other: FileChangeEntry = { ...REPORTED, path: "other.md" };
  const sameAsObserved: FileChangeEntry = { ...REPORTED, path: "a.txt", added: 9 };
  expect(withFileChanges(null, [OBSERVED], [sameAsObserved, other])).toEqual({
    fileChanges: [OBSERVED, other],
  });
});

test("a single observed FileChange that equals the entries keeps the legacy details shape (F-2)", () => {
  expect(withFileChanges(EDITED_FILE_CHANGE, [OBSERVED], [])).toEqual(EDITED_FILE_CHANGE);
});

test("observed changes are read only from core capability results", () => {
  expect(observedEntriesOf(EDITED_FILE_CHANGE, false)).toEqual([]);
  expect(observedEntriesOf(EDITED_FILE_CHANGE, true)).toEqual([OBSERVED]);
  expect(observedEntriesOf(undefined, true)).toEqual([]);
});

test("reportedEntriesOf stamps valid entries as reported and counts the rejected ones", () => {
  const broken = { ...REPORTED_FILE, added: -1 };
  expect(reportedEntriesOf([REPORTED_FILE, broken, "not an object"])).toEqual({
    entries: [REPORTED],
    rejected: 2,
  });
});
