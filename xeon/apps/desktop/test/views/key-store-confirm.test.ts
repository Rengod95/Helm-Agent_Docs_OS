import { describe, expect, test } from "bun:test";
import { ok, parse, type Result } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import type { SecretKeyStatusResult } from "@fresnel/contracts/wire";
import { submitKey, type KeyField, type KeyRegistrar } from "@fresnel/client/settings";
import type { SecretCommandError, SecretCommands } from "../../src/views/commands.ts";
import { confirmFallbackOf } from "../../src/views/pages/secrets/key-store-confirm.tsx";

// 등록 전 열쇠 보관 확인(L0.secrets.spec §4.7 (c)). 확인 대화 상자는 linkedom이 그리지 못하므로, 판정 함수와
// 그것을 `submitKey`에 넘긴 흐름을 가짜 명령으로 시험한다. 값은 가짜다.

const FAKE = "fake-key-for-tests-0002";
const NAME = (() => {
  const parsed = parse(SecretNameSchema, "anthropic-api-key");
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
})();

const FALLBACK: SecretKeyStatusResult = {
  source: "auto",
  in: "none",
  filePath: "/fake/fresnel/secrets/age/keys.txt",
  keychainUsable: false,
  fallbackUnconfirmed: true,
  fileMissing: false,
};

type Keys = Pick<SecretCommands, "keyStatus" | "keyMove">;

/** 위치 읽기와 옮기기의 가짜. 부른 순서를 `calls`에 쌓는다 */
function keysOf(status: Result<SecretKeyStatusResult, SecretCommandError>, calls: string[]): Keys {
  return {
    keyStatus: () => {
      calls.push("status");
      return Promise.resolve(status);
    },
    keyMove: (to) => {
      calls.push(`move ${to}`);
      return Promise.resolve(ok({ moved: true, created: true, oldRemoved: true, source: to }));
    },
  };
}

function field(initial: string): { field: KeyField; shown: () => string } {
  let value = initial;
  return {
    field: {
      take: () => {
        const typed = value;
        value = "";
        return typed;
      },
    },
    shown: () => value,
  };
}

describe("confirmFallbackOf", () => {
  test("no question when the key store is usable or the status cannot be read", async () => {
    const calls: string[] = [];
    let asked = 0;
    const ask = (): Promise<boolean> => {
      asked += 1;
      return Promise.resolve(true);
    };
    const usable = keysOf(ok({ ...FALLBACK, fallbackUnconfirmed: false }), calls);
    expect(await confirmFallbackOf(usable, ask)).toBe("proceed");
    const unreadable = keysOf({ ok: false, error: { kind: "unsupported" } }, calls);
    expect(await confirmFallbackOf(unreadable, ask)).toBe("proceed");
    expect(asked).toBe(0);
    expect(calls).toEqual(["status", "status"]);
  });

  test("declining moves nothing and cancels", async () => {
    const calls: string[] = [];
    const keys = keysOf(ok(FALLBACK), calls);
    expect(await confirmFallbackOf(keys, () => Promise.resolve(false))).toBe("cancel");
    expect(calls).toEqual(["status"]);
  });

  test("accepting moves the key to the file first, then proceeds", async () => {
    const calls: string[] = [];
    const keys = keysOf(ok(FALLBACK), calls);
    const ask = (): Promise<boolean> => {
      calls.push("ask");
      return Promise.resolve(true);
    };
    expect(await confirmFallbackOf(keys, ask)).toBe("proceed");
    expect(calls).toEqual(["status", "ask", "move file"]);
  });
});

describe("the registration after the question", () => {
  test("accepting registers the same bytes the field held, after the move", async () => {
    const calls: string[] = [];
    const keys = keysOf(ok(FALLBACK), calls);
    const registrar: KeyRegistrar = {
      registerKey: (name, action, value) => {
        calls.push(`register ${action} ${name} ${new TextDecoder().decode(value)}`);
        return Promise.resolve(ok(null));
      },
    };
    const input = field(`  ${FAKE}\n`);
    const outcome = await submitKey(registrar, NAME, "add", input.field, () =>
      confirmFallbackOf(keys, () => Promise.resolve(true)),
    );
    expect(outcome).toEqual({ kind: "registered" });
    expect(calls).toEqual(["status", "move file", `register add anthropic-api-key ${FAKE}`]);
    expect(input.shown()).toBe("");
  });

  test("declining sends nothing, and the field keeps the value for another try", async () => {
    const calls: string[] = [];
    const keys = keysOf(ok(FALLBACK), calls);
    const registrar: KeyRegistrar = {
      registerKey: (name) => {
        calls.push(`register ${name}`);
        return Promise.resolve(ok(null));
      },
    };
    const input = field(FAKE);
    const outcome = await submitKey(registrar, NAME, "add", input.field, () =>
      confirmFallbackOf(keys, () => Promise.resolve(false)),
    );
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(calls).toEqual(["status"]);
    expect(input.shown()).toBe(FAKE);
  });
});
