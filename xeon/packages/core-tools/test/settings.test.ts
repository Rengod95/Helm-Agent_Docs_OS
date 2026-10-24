import { expect, test } from "bun:test";
import { readScalarConfig, TOOLS_SETTING_DEFAULTS, TOOLS_SETTING_KEYS } from "../src/settings.ts";
import { createHarness, layer } from "./support/harness.ts";

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

test("mode follows the configured value and setMode only accepts default in M1", async () => {
  const h = await createHarness({ layers: [layer("user", { "l1.tools.permissionMode": "plan" })] });
  expect(h.runtime.tools.mode(h.thread)).toBe("plan");
  expect(await h.runtime.tools.setMode(h.thread, "bypass", "user")).toEqual({
    ok: false,
    error: { kind: "tools.mode_forbidden", mode: "bypass" },
  });
  expect(await h.runtime.tools.setMode(h.thread, "plan", "plan_approval")).toMatchObject({
    ok: false,
  });
  expect(await h.runtime.tools.setMode(h.thread, "default", "user")).toEqual({
    ok: true,
    mode: "default",
  });
  // 세션 범위 쓰기가 파일 설정보다 우선한다
  expect(h.runtime.tools.mode(h.thread)).toBe("default");
  expect(h.session.sessionValues(h.thread).get("l1.tools.permissionMode")).toBe("default");
});

test("M2 service methods fail loudly instead of pretending to work", async () => {
  const h = await createHarness();
  expect(() => h.runtime.tools.registerRules("core:agents", [])).toThrow("arrives in M2");
  expect(() =>
    h.runtime.tools.runUserShell({ command: "ls", includeInContext: false }, h.run()),
  ).toThrow("arrives in M2");
});
