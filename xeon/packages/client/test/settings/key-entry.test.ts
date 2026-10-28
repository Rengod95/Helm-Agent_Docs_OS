import { describe, expect, test } from "bun:test";
import { err, ok, parse } from "@xeon/contracts";
import { SecretNameSchema } from "@xeon/contracts/capabilities";
import {
  keyErrorText,
  submitKey,
  type KeyField,
  type KeyRegisterError,
  type KeyRegistrar,
} from "../../src/settings/index.ts";

// L4.desktop.spec §4.14.1. 값은 입력란을 읽는 즉시 비워지고, 바이트 배열로만 건너가고, 보낸 뒤 0으로 덮인다.
// 값은 가짜다(실제 키를 쓰지 않는다).

const FAKE = "fake-key-for-tests-0001";
const NAME = (() => {
  const parsed = parse(SecretNameSchema, "anthropic-api-key");
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
})();

/** 보낸 바이트가 모두 0으로 덮였는지. 받은 적이 없으면 거짓이다 */
function wiped(bytes: Uint8Array | null): boolean {
  return bytes !== null && bytes.every((byte) => byte === 0);
}

function field(initial: string): { field: KeyField; shown: () => string; takes: () => number } {
  const state = { value: initial, takes: 0 };
  return {
    field: {
      take: () => {
        state.takes += 1;
        const typed = state.value;
        state.value = "";
        return typed;
      },
    },
    shown: () => state.value,
    takes: () => state.takes,
  };
}

describe("submitKey", () => {
  test("the field is already empty while the register call is still pending, and the bytes are wiped after", async () => {
    const input = field(`  ${FAKE}\n`);
    const seen: { bytes: Uint8Array | null } = { bytes: null };
    let seenByRegistrar = "";
    let fieldWhilePending = "unset";
    const release = Promise.withResolvers<void>();
    const registrar: KeyRegistrar = {
      async registerKey(name, action, value) {
        seen.bytes = value;
        seenByRegistrar = `${action} ${name} ${new TextDecoder().decode(value)}`;
        fieldWhilePending = input.shown();
        await release.promise;
        return ok(null);
      },
    };
    const pending = submitKey(registrar, NAME, "add", input.field);
    // take()는 첫 await 전에 불렸다: 등록 호출이 끝나기 전에 이미 입력란이 비어 있다
    expect(input.takes()).toBe(1);
    expect(input.shown()).toBe("");
    await Promise.resolve();
    expect(fieldWhilePending).toBe("");
    // 앞뒤 공백과 줄바꿈은 지워서 보낸다
    expect(seenByRegistrar).toBe(`add anthropic-api-key ${FAKE}`);
    release.resolve();
    const outcome = await pending;
    expect(outcome).toEqual({ kind: "registered" });
    // 보낸 바이트는 0으로 덮였다
    expect(wiped(seen.bytes)).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain(FAKE);
  });

  test("an empty or blank field sends nothing", async () => {
    let calls = 0;
    const registrar: KeyRegistrar = {
      registerKey: () => {
        calls += 1;
        return Promise.resolve(ok(null));
      },
    };
    expect(await submitKey(registrar, NAME, "add", field("").field)).toEqual({ kind: "empty" });
    expect(await submitKey(registrar, NAME, "add", field(" \n ").field)).toEqual({
      kind: "empty",
    });
    expect(calls).toBe(0);
  });

  test("a failure keeps the field empty, wipes the bytes and never carries the value in its text", async () => {
    const input = field(FAKE);
    const seen: { bytes: Uint8Array | null } = { bytes: null };
    const registrar: KeyRegistrar = {
      registerKey: (_name, _action, value) => {
        seen.bytes = value;
        return Promise.resolve(
          err<KeyRegisterError>({
            kind: "rejected",
            exitCode: 1,
            detail: "비밀 제공자(sops)를 쓸 수 없다 (not_registered)",
          }),
        );
      },
    };
    const outcome = await submitKey(registrar, NAME, "set", input.field);
    expect(outcome).toEqual({
      kind: "failed",
      text: "키를 저장하지 못했습니다. 비밀 제공자(sops)를 쓸 수 없다 (not_registered)",
    });
    expect(input.shown()).toBe("");
    expect(wiped(seen.bytes)).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain(FAKE);
  });

  test("a shell without the route falls back to the terminal hint", async () => {
    const registrar: KeyRegistrar = {
      registerKey: () => Promise.resolve(err<KeyRegisterError>({ kind: "unavailable" })),
    };
    expect(await submitKey(registrar, NAME, "add", field(FAKE).field)).toEqual({
      kind: "terminal",
    });
  });
});

describe("keyErrorText", () => {
  test("every kind has its own sentence, with the exit code when there is no detail", () => {
    const kinds: KeyRegisterError[] = [
      { kind: "unavailable" },
      { kind: "empty" },
      { kind: "too-large" },
      { kind: "busy" },
      { kind: "timeout" },
      { kind: "rejected", exitCode: 3, detail: "" },
      { kind: "failed" },
    ];
    const texts = kinds.map(keyErrorText);
    expect(new Set(texts).size).toBe(kinds.length);
    expect(keyErrorText({ kind: "rejected", exitCode: 3, detail: "" })).toBe(
      "키를 저장하지 못했습니다 (종료 코드 3).",
    );
  });
});
