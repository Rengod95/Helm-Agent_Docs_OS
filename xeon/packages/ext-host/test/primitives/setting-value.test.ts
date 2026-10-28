import { expect, test } from "bun:test";
import type { PortKey } from "@xeon/contracts/extensions";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// 설정 읽기: builtin은 모든 키, 그 밖의 확장은 자기 ext.<이름>. 키만(X.primitives.spec §3.8 settingValue)

const settingsKey: PortKey<{ value(key: string): unknown }> = { name: "xeon.settings" };
const VALUES: Readonly<Record<string, unknown>> = {
  "ext.mine.limit": 7,
  "ext.mine.nested.flag": true,
  "ext.other.limit": 9,
  "ext.minefield.limit": 11,
  "l3.helm.driveLimits": { maxTurns: 2 },
};
const KEYS = Object.keys(VALUES);

async function readAll(builtin: boolean, withPort: boolean): Promise<Record<string, unknown>> {
  const t = await createTestHost();
  if (withPort) {
    await t.host.registerPlatform({
      name: "test-settings",
      setup(ctx) {
        ctx.providePort(settingsKey, { value: (key) => VALUES[key] });
      },
    });
  }
  const seen: Record<string, unknown> = {};
  await t.host.install(
    makeUnit({ name: "mine", builtin }, (g) => {
      for (const key of KEYS) seen[key] = hostOf(g).settingValue(key);
      seen["ext.mine.missing"] = hostOf(g).settingValue("ext.mine.missing");
    }),
  );
  return seen;
}

test("a user-trust extension reads only keys in its own ext namespace", async () => {
  expect(await readAll(false, true)).toEqual({
    "ext.mine.limit": 7,
    "ext.mine.nested.flag": true,
    "ext.other.limit": undefined,
    "ext.minefield.limit": undefined,
    "l3.helm.driveLimits": undefined,
    "ext.mine.missing": undefined,
  });
});

test("a built-in extension reads every key", async () => {
  expect(await readAll(true, true)).toEqual({
    "ext.mine.limit": 7,
    "ext.mine.nested.flag": true,
    "ext.other.limit": 9,
    "ext.minefield.limit": 11,
    "l3.helm.driveLimits": { maxTurns: 2 },
    "ext.mine.missing": undefined,
  });
});

test("without the settings port every key reads as undefined", async () => {
  const seen = await readAll(false, false);
  expect(Object.values(seen).every((value) => value === undefined)).toBe(true);
});
