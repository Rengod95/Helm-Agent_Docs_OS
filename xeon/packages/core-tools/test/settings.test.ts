import { expect, test } from "bun:test";
import { eachInOrder } from "../src/util.ts";
import {
  normalizeStoredMode,
  readScalarConfig,
  TOOLS_SETTING_DEFAULTS,
  TOOLS_SETTING_KEYS,
} from "../src/settings.ts";
import { callTool, createHarness, layer, registerWorkspace } from "./support/harness.ts";

test("defaults match the l1.tools settings table", () => {
  expect(readScalarConfig([])).toEqual({
    mode: "bypass",
    modeFromRepository: false,
    bypassAllowed: true,
    output: { maxLines: 2000, maxBytes: 51_200 },
    deferThreshold: 64,
    unattended: { approval: "expire", timeoutSeconds: 3600 },
  });
  expect(TOOLS_SETTING_DEFAULTS.outputMaxBytes).toBe(51_200);
  expect(Object.values(TOOLS_SETTING_KEYS)).toHaveLength(8);
  for (const key of Object.values(TOOLS_SETTING_KEYS))
    expect(key.startsWith("l1.tools.")).toBe(true);
});

test("precedence is managed, session, local, project, user and out-of-range values are skipped", () => {
  const config = readScalarConfig([
    layer("user", { "l1.tools.permissionMode": "acceptEdits", "l1.tools.output.maxLines": 500 }),
    layer("project", { "l1.tools.permissionMode": "acceptEdits" }),
    layer("launch", { "l1.tools.permissionMode": "bypass" }),
    layer("local", { "l1.tools.output.maxLines": 50 }),
  ]);
  // session이 project와 user를 이긴다. 범위 밖 값(maxLines 50 < 100)은 건너뛰고 아래 층을 쓴다
  expect(config.mode).toBe("bypass");
  expect(config.output.maxLines).toBe(500);
});

test("the profile layer sits between launch and local for the permission mode only", () => {
  // managed > launch > profile > local > project > user (M5c §3.3)
  const overUser = readScalarConfig([
    layer("user", { "l1.tools.permissionMode": "acceptEdits" }),
    layer("profile", { "l1.tools.permissionMode": "default" }),
  ]);
  expect(overUser.mode).toBe("default");
  const underLaunch = readScalarConfig([
    layer("profile", { "l1.tools.permissionMode": "default" }),
    layer("launch", { "l1.tools.permissionMode": "bypass" }),
  ]);
  expect(underLaunch.mode).toBe("bypass");
  const overLocal = readScalarConfig([
    layer("local", { "l1.tools.permissionMode": "acceptEdits" }),
    layer("profile", { "l1.tools.permissionMode": "default" }),
  ]);
  expect(overLocal.mode).toBe("default");
  // 프로필은 다른 l1.tools 키를 읽지 않는다
  expect(
    readScalarConfig([layer("profile", { "l1.tools.output.maxLines": 500 })]).output.maxLines,
  ).toBe(2000);
});

test("the scope that set the mode is reported, and a repository scope is flagged", () => {
  const bypass = { "l1.tools.permissionMode": "bypass" };
  expect(readScalarConfig([layer("project", bypass)]).modeFromRepository).toBe(true);
  expect(readScalarConfig([layer("local", bypass)]).modeFromRepository).toBe(true);
  expect(readScalarConfig([layer("user", bypass)]).modeFromRepository).toBe(false);
  expect(readScalarConfig([layer("launch", bypass)]).modeFromRepository).toBe(false);
  // 범위 안이어도 값 검사에 걸리면 건너뛰므로 그 층이 정한 모드가 아니다
  expect(
    readScalarConfig([layer("project", { "l1.tools.permissionMode": "nope" })]).modeFromRepository,
  ).toBe(false);
});

test("bypassAllowed is read from the managed scope only; output limits are not allowed in session scope", () => {
  expect(readScalarConfig([layer("user", { "l1.tools.bypassAllowed": false })]).bypassAllowed).toBe(
    true,
  );
  expect(
    readScalarConfig([layer("managed", { "l1.tools.bypassAllowed": false })]).bypassAllowed,
  ).toBe(false);
  expect(
    readScalarConfig([layer("launch", { "l1.tools.output.maxBytes": 4096 })]).output.maxBytes,
  ).toBe(51_200);
  expect(readScalarConfig([layer("user", { "l1.tools.permissionMode": "nope" })]).mode).toBe(
    "bypass",
  );
  expect(
    readScalarConfig([layer("user", { "l1.tools.exposure.deferThreshold": 129 })]).deferThreshold,
  ).toBe(64);
});

test("mode follows the configured value and setMode writes the session scope for all three modes", async () => {
  const h = await createHarness({
    layers: [layer("user", { "l1.tools.permissionMode": "acceptEdits" })],
  });
  expect(h.runtime.tools.mode(h.thread)).toBe("acceptEdits");
  const modes = ["acceptEdits", "bypass", "default"] as const;
  await eachInOrder(modes, async (mode) => {
    expect(await h.runtime.tools.setMode(h.thread, mode, "user")).toEqual({ ok: true, mode });
    // 세션 범위 쓰기가 파일 설정보다 우선한다
    expect(h.runtime.tools.mode(h.thread)).toBe(mode);
    expect(h.session.sessionValues(h.thread).get("l1.tools.permissionMode")).toBe(mode);
  });
});

test("a saved plan mode from before the plan mode was removed is read as default (옛 대화 보호)", () => {
  // 저장된 값 자체는 그대로다. 읽을 때만 default로 본다
  expect(readScalarConfig([layer("user", { "l1.tools.permissionMode": "plan" })]).mode).toBe(
    "default",
  );
  expect(readScalarConfig([layer("launch", { "l1.tools.permissionMode": "plan" })]).mode).toBe(
    "default",
  );
  // 그 층에서 멈춘다: 옛 plan 층이 아래 층의 bypass를 이기고 default가 된다
  expect(
    readScalarConfig([
      layer("launch", { "l1.tools.permissionMode": "plan" }),
      layer("user", { "l1.tools.permissionMode": "bypass" }),
    ]).mode,
  ).toBe("default");
  // 위 층의 값이 이기면 옛 plan 값은 쓰이지 않는다
  expect(
    readScalarConfig([
      layer("launch", { "l1.tools.permissionMode": "bypass" }),
      layer("user", { "l1.tools.permissionMode": "plan" }),
    ]).mode,
  ).toBe("bypass");
  // 저장소 범위(project)의 옛 plan도 default다
  expect(readScalarConfig([layer("project", { "l1.tools.permissionMode": "plan" })]).mode).toBe(
    "default",
  );
});

test("normalizeStoredMode is the one reading rule: a stored plan is default, known modes are themselves, anything else is unknown", () => {
  expect(normalizeStoredMode("plan")).toBe("default");
  expect(normalizeStoredMode("acceptEdits")).toBe("acceptEdits");
  expect(normalizeStoredMode("bypass")).toBe("bypass");
  expect(normalizeStoredMode("nope")).toBeUndefined();
  expect(normalizeStoredMode(null)).toBeUndefined();
  // 엔진 읽기(pickMode)가 같은 함수를 거친 값을 돌려준다
  expect(readScalarConfig([layer("user", { "l1.tools.permissionMode": "plan" })]).mode).toBe(
    "default",
  );
});

test("a conversation whose session value is a saved plan opens in default, and a later write replaces it", async () => {
  const h = await createHarness({
    layers: [layer("user", { "l1.tools.permissionMode": "bypass" })],
  });
  // 계획 모드 시절에 저장된 세션 값을 흉내 낸다
  expect(
    h.session.sessionSettings.set(
      h.thread,
      "l1.tools.permissionMode",
      "plan",
      `mode:${h.thread}:legacy_plan`,
    ),
  ).toEqual({ ok: true, value: undefined });
  expect(h.runtime.tools.mode(h.thread)).toBe("default");
  expect(await h.runtime.tools.setMode(h.thread, "bypass", "user")).toEqual({
    ok: true,
    mode: "bypass",
  });
  expect(h.runtime.tools.mode(h.thread)).toBe("bypass");
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
  expect(await h.runtime.tools.setMode(h.thread, "acceptEdits", "user")).toEqual({
    ok: false,
    error: { kind: "tools.commit_failed", store: { kind: "disk_full" } },
  });
  expect(h.runtime.tools.mode(h.thread)).toBe("default");
});

test("the unattended approval policy reads its two keys and skips invalid values", () => {
  const config = readScalarConfig([
    layer("user", {
      "l1.tools.unattended.approval": "wait",
      "l1.tools.unattended.timeoutSeconds": 90,
    }),
  ]);
  expect(config.unattended).toEqual({ approval: "wait", timeoutSeconds: 90 });
  const invalid = readScalarConfig([
    layer("user", {
      "l1.tools.unattended.approval": "ask",
      "l1.tools.unattended.timeoutSeconds": 0,
    }),
  ]);
  expect(invalid.unattended).toEqual({ approval: "expire", timeoutSeconds: 3600 });
});
