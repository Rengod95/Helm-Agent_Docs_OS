import { expect, test } from "bun:test";
import { eachInOrder } from "../src/util.ts";
import { readScalarConfig, TOOLS_SETTING_DEFAULTS, TOOLS_SETTING_KEYS } from "../src/settings.ts";
import { callTool, createHarness, layer, registerWorkspace } from "./support/harness.ts";

test("defaults match the l1.tools settings table", () => {
  expect(readScalarConfig([])).toEqual({
    mode: "default",
    bypassAllowed: true,
    output: { maxLines: 2000, maxBytes: 51_200 },
    deferThreshold: 64,
  });
  expect(TOOLS_SETTING_DEFAULTS.outputMaxBytes).toBe(51_200);
  expect(Object.values(TOOLS_SETTING_KEYS)).toHaveLength(6);
  for (const key of Object.values(TOOLS_SETTING_KEYS))
    expect(key.startsWith("l1.tools.")).toBe(true);
});

test("precedence is managed, session, local, project, user and out-of-range values are skipped", () => {
  const config = readScalarConfig([
    layer("user", { "l1.tools.permissionMode": "acceptEdits", "l1.tools.output.maxLines": 500 }),
    layer("project", { "l1.tools.permissionMode": "plan" }),
    layer("session", { "l1.tools.permissionMode": "bypass" }),
    layer("local", { "l1.tools.output.maxLines": 50 }),
  ]);
  // session이 project와 user를 이긴다. 범위 밖 값(maxLines 50 < 100)은 건너뛰고 아래 층을 쓴다
  expect(config.mode).toBe("bypass");
  expect(config.output.maxLines).toBe(500);
});

test("bypassAllowed is read from the managed scope only; output limits are not allowed in session scope", () => {
  expect(readScalarConfig([layer("user", { "l1.tools.bypassAllowed": false })]).bypassAllowed).toBe(
    true,
  );
  expect(
    readScalarConfig([layer("managed", { "l1.tools.bypassAllowed": false })]).bypassAllowed,
  ).toBe(false);
  expect(
    readScalarConfig([layer("session", { "l1.tools.output.maxBytes": 4096 })]).output.maxBytes,
  ).toBe(51_200);
  expect(readScalarConfig([layer("user", { "l1.tools.permissionMode": "nope" })]).mode).toBe(
    "default",
  );
  expect(
    readScalarConfig([layer("user", { "l1.tools.exposure.deferThreshold": 129 })]).deferThreshold,
  ).toBe(64);
});

test("mode follows the configured value and setMode writes the session scope for all four modes", async () => {
  const h = await createHarness({ layers: [layer("user", { "l1.tools.permissionMode": "plan" })] });
  expect(h.runtime.tools.mode(h.thread)).toBe("plan");
  const modes = ["acceptEdits", "bypass", "plan", "default"] as const;
  await eachInOrder(modes, async (mode) => {
    expect(await h.runtime.tools.setMode(h.thread, mode, "user")).toEqual({ ok: true, mode });
    // 세션 범위 쓰기가 파일 설정보다 우선한다
    expect(h.runtime.tools.mode(h.thread)).toBe(mode);
    expect(h.session.sessionValues(h.thread).get("l1.tools.permissionMode")).toBe(mode);
  });
  // 계획 승인이 같은 모드를 다시 써도 거부되지 않는다
  expect(await h.runtime.tools.setMode(h.thread, "default", "plan_approval")).toEqual({
    ok: true,
    mode: "default",
  });
});

test("bypass_forbidden_by_managed: setMode refuses bypass, other modes still work, and evaluation falls back to default", async () => {
  const h = await createHarness({
    layers: [layer("managed", { "l1.tools.bypassAllowed": false })],
  });
  expect(await h.runtime.tools.setMode(h.thread, "bypass", "user")).toEqual({
    ok: false,
    error: { kind: "tools.mode_forbidden", mode: "bypass" },
  });
  expect(h.runtime.tools.mode(h.thread)).toBe("default");
  expect(await h.runtime.tools.setMode(h.thread, "acceptEdits", "user")).toMatchObject({
    ok: true,
  });
  // 이미 세션 값이 bypass인 채 managed 금지가 생기면 평가기가 default로 본다(§5 사례 11)
  const open = await createHarness();
  expect(await open.runtime.tools.setMode(open.thread, "bypass", "user")).toMatchObject({
    ok: true,
  });
  open.setLayers([layer("managed", { "l1.tools.bypassAllowed": false })]);
  registerWorkspace(open);
  const out = await callTool(open.runtime.tools, open.run({ interactive: false }), {
    id: "ban_1",
    name: "bash",
    args: { command: "echo hi" },
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
});

test("a failed session write is a commit_failed value and leaves the mode unchanged", async () => {
  const h = await createHarness();
  h.session.failNextSettingsWrite({ kind: "disk_full" });
  expect(await h.runtime.tools.setMode(h.thread, "plan", "user")).toEqual({
    ok: false,
    error: { kind: "tools.commit_failed", store: { kind: "disk_full" } },
  });
  expect(h.runtime.tools.mode(h.thread)).toBe("default");
});

test("M2 user shell still fails loudly until L1A.5", async () => {
  const h = await createHarness();
  expect(() =>
    h.runtime.tools.runUserShell({ command: "ls", includeInContext: false }, h.run()),
  ).toThrow("arrives in M2");
});
