import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkSettingDef,
  validateSettingValue,
  type SettingDef,
} from "@fresnel/contracts/settings";
import { DESKTOP_SETTING_DEFS } from "../src/settings-store/defs.ts";

// 셸이 읽는 `l4.desktop.*` 키 세 개의 선언을 spec §6 표에 맞춘다 (L4.desktop.spec §6, plan M3-38).

const root = join(import.meta.dir, "..");

function defOf(key: string): SettingDef {
  const def = DESKTOP_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`no setting definition for ${key}`);
  return def;
}

const close = defOf("l4.desktop.window.closeBehavior");
const restart = defOf("l4.desktop.engine.restartLimit");
const grace = defOf("l4.desktop.engine.shutdownGraceMs");

function accepts(def: SettingDef, value: unknown): boolean {
  return validateSettingValue(def, value).ok;
}

test("the group declares exactly the three l4.desktop keys of spec §6", () => {
  expect(DESKTOP_SETTING_DEFS.map((def) => def.key).toSorted()).toEqual([
    "l4.desktop.engine.restartLimit",
    "l4.desktop.engine.shutdownGraceMs",
    "l4.desktop.window.closeBehavior",
  ]);
});

test("each key has the spec layer, version, scopes, runtime change, and no secret", () => {
  for (const def of [close, restart, grace]) {
    expect(def.layer).toBe("L4");
    expect(def.since).toBe("0.1.0");
    expect(def.secret).toBeUndefined();
    expect(def.runtimeChange).toBe("live");
    expect(def.allowedScopes).toEqual(["managed", "user"]);
  }
  expect(close.key).toBe("l4.desktop.window.closeBehavior");
  expect(restart.key).toBe("l4.desktop.engine.restartLimit");
  expect(grace.key).toBe("l4.desktop.engine.shutdownGraceMs");
});

test("defaults and ranges match the spec §6 rows", () => {
  expect(close.default).toBe("tray");
  expect(restart.default).toBe(3);
  expect(grace.default).toBe(7000);
  expect(close.range).toEqual({ enum: ["quit", "tray"] });
  expect(restart.range).toEqual({ min: 0, max: 10 });
  expect(grace.range).toEqual({ min: 1000, max: 180000 });
});

test("types accept the values the range allows and reject the rest", () => {
  expect(accepts(close, "tray")).toBe(true);
  expect(accepts(close, "exit")).toBe(false);
  expect(accepts(close, "Tray")).toBe(false);
  expect(accepts(close, 1)).toBe(false);

  expect(accepts(restart, 0)).toBe(true);
  expect(accepts(restart, 10)).toBe(true);
  expect(accepts(restart, 11)).toBe(false);
  expect(accepts(restart, -1)).toBe(false);
  expect(accepts(restart, 2.5)).toBe(false);
  expect(accepts(restart, "2")).toBe(false);

  expect(accepts(grace, 1000)).toBe(true);
  expect(accepts(grace, 180000)).toBe(true);
  expect(accepts(grace, 999)).toBe(false);
  expect(accepts(grace, 180001)).toBe(false);
  expect(accepts(grace, 5000.5)).toBe(false);
});

test("each declaration passes the contract's definition rules", () => {
  for (const def of DESKTOP_SETTING_DEFS) {
    expect(checkSettingDef(def)).toEqual([]);
  }
});

// Electron 셸의 기본값은 이 패키지의 bun test가 부를 수 없어서 소스 글자로 맞춘다(sidecar-config.test.ts와 같은 방식).
// 두 쪽이 어긋나면 셸이 쓰는 값과 설정 화면이 보이는 기본값이 달라진다.
test("the defaults and ranges equal the Electron shell constants", () => {
  const policy = readFileSync(join(root, "../desktop-shell/src/main/engine/policy.ts"), "utf8");
  const settings = readFileSync(
    join(root, "../desktop-shell/src/main/desktop-settings.ts"),
    "utf8",
  );
  const closeBehavior = readFileSync(
    join(root, "../desktop-shell/src/main/close-behavior.ts"),
    "utf8",
  );

  expect(policy).toContain("DEFAULT_SHUTDOWN_GRACE_MS: number = 7_000;");
  expect(policy).toContain("DEFAULT_RESTART_LIMIT: number = 3;");
  expect(grace.default).toBe(7000);
  expect(restart.default).toBe(3);

  expect(closeBehavior).toContain('const state: CloseState = { configured: "tray"');
  expect(close.default).toBe("tray");

  expect(settings).toContain("SHUTDOWN_GRACE_MS_RANGE: IntRange = { min: 1000, max: 180_000 };");
  expect(settings).toContain("RESTART_LIMIT_RANGE: IntRange = { min: 0, max: 10 };");
});
