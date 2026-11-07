import { describe, expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import {
  activeLocale,
  setActiveLocale,
  t,
  type Locale,
  type MessageId,
} from "../../src/i18n/index.ts";
import {
  keyErrorDetail,
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
            // 맞는 CLI 문장이 없는 출력이라 일반 문장과 종료 코드만 나온다
            detail: "fresnel: 알 수 없는 실패다\n  해결: 없다",
          }),
        );
      },
    };
    const outcome = await submitKey(registrar, NAME, "set", input.field);
    expect(outcome).toEqual({
      kind: "failed",
      // 사이드카의 원문은 보이지 않는다
      text: "키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      keystore: false,
      detail: "종료 코드 1",
    });
    expect(input.shown()).toBe("");
    expect(wiped(seen.bytes)).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain(FAKE);
  });

  test("a key store failure is a Korean sentence without a terminal command and asks for the retry and help buttons", async () => {
    const registrar: KeyRegistrar = {
      registerKey: () => Promise.resolve(err<KeyRegisterError>({ kind: "keystore" })),
    };
    const outcome = await submitKey(registrar, NAME, "add", field(FAKE).field);
    expect(outcome).toEqual({
      kind: "failed",
      text: "이 기기의 키체인에 키를 저장하지 못했어요. 키체인 접근을 허용했는지, 로그인 키체인이 잠겨 있지 않은지 확인하고 다시 시도해 주세요.",
      keystore: true,
    });
    expect(JSON.stringify(outcome)).not.toContain("fresnel config");
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
      { kind: "keystore" },
      { kind: "rejected", exitCode: 3, detail: "" },
      { kind: "failed" },
    ];
    const texts = kinds.map(keyErrorText);
    expect(new Set(texts).size).toBe(kinds.length);
    expect(keyErrorText({ kind: "rejected", exitCode: 3, detail: "" })).toBe(
      "키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    );
    expect(keyErrorDetail({ kind: "rejected", exitCode: 3, detail: "" })).toBe("종료 코드 3");
    expect(keyErrorDetail({ kind: "rejected", exitCode: null, detail: "" })).toBeNull();
    expect(keyErrorDetail({ kind: "failed" })).toBeNull();
  });
});

/** 화면 로케일을 잠시 바꿔 읽고 되돌린다(messages.test.ts와 같은 방식) */
function inLocale<T>(locale: Locale, read: () => T): T {
  const before = activeLocale();
  setActiveLocale(locale);
  try {
    return read();
  } finally {
    setActiveLocale(before);
  }
}

const SCREEN_LOCALES: readonly Locale[] = ["ko", "en"];

/**
 * 사이드카의 한 실패를 두 로케일의 출력(`stderr`)으로 두고, 화면 로케일마다 기대하는 문장과 "자세히" 문구를 적는다.
 * 사이드카가 쓴 로케일과 화면 로케일이 같은 경우와 다른 경우를 모두 돈다
 */
interface RejectionCase {
  readonly exitCode: number | null;
  readonly stderr: Readonly<Record<Locale, string>>;
  readonly expected: Readonly<
    Record<Locale, { readonly text: string; readonly detail: string | null }>
  >;
}

function expectRejectionCase(item: RejectionCase): void {
  for (const screen of SCREEN_LOCALES) {
    for (const child of SCREEN_LOCALES) {
      const error: KeyRegisterError = {
        kind: "rejected",
        exitCode: item.exitCode,
        detail: item.stderr[child],
      };
      inLocale(screen, () => {
        expect(keyErrorText(error)).toBe(item.expected[screen].text);
        expect(keyErrorDetail(error)).toBe(item.expected[screen].detail);
      });
    }
  }
}

describe("a rejection whose first line is a CLI failure sentence", () => {
  test("a provider that cannot be used says which one and why, in the screen locale, whatever locale the child wrote", () => {
    expectRejectionCase({
      exitCode: 3,
      stderr: {
        ko: "fresnel: 시크릿 제공자(sops)를 쓸 수 없다 (binary_missing)\n  해결: sops와 age를 설치하고 fresnel doctor로 확인한다",
        en: "fresnel: The secret provider (sops) is unavailable (binary_missing)\n  Fix: Install sops and age, then check with fresnel doctor",
      },
      expected: {
        ko: {
          text: "시크릿 제공자(sops)를 쓸 수 없다 (binary_missing)",
          detail: "sops와 age를 설치하고 fresnel doctor로 확인한다\n종료 코드 3",
        },
        en: {
          text: "The secret provider (sops) is unavailable (binary_missing)",
          detail: "Install sops and age, then check with fresnel doctor\nExit code 3",
        },
      },
    });
  });

  test("a key file that cannot be created shows its code, and its fix behind the details", () => {
    expectRejectionCase({
      exitCode: 1,
      stderr: {
        ko: "fresnel: age 키 파일을 만들지 못했다 (permission_denied)\n  해결: fresnel 설정 디렉터리의 secrets/age 폴더 권한을 확인한다. 이미 있는 키 파일은 덮어쓰지 않는다",
        en: "fresnel: Could not create the age key file (permission_denied)\n  Fix: Check the permissions of the secrets/age folder in the fresnel config directory. An existing key file is never overwritten",
      },
      expected: {
        ko: {
          text: "age 키 파일을 만들지 못했다 (permission_denied)",
          detail:
            "fresnel 설정 디렉터리의 secrets/age 폴더 권한을 확인한다. 이미 있는 키 파일은 덮어쓰지 않는다\n종료 코드 1",
        },
        en: {
          text: "Could not create the age key file (permission_denied)",
          detail:
            "Check the permissions of the secrets/age folder in the fresnel config directory. An existing key file is never overwritten\nExit code 1",
        },
      },
    });
  });

  test("a write failure has no fix sentence of its own, so the detail is only the exit code", () => {
    expectRejectionCase({
      exitCode: 1,
      stderr: {
        ko: "fresnel: 시크릿 저장소에 쓰지 못했다\n  해결: 설정 디렉터리 권한과 디스크 상태를 확인한다",
        en: "fresnel: Could not write to the secret store\n  Fix: Check the permissions of the config directory and the disk state",
      },
      expected: {
        ko: { text: "시크릿 저장소에 쓰지 못했다", detail: "종료 코드 1" },
        en: { text: "Could not write to the secret store", detail: "Exit code 1" },
      },
    });
  });

  test("a first line that matches no sentence keeps the general text and the exit code", () => {
    expectRejectionCase({
      exitCode: 3,
      stderr: {
        ko: "fresnel: 알 수 없는 실패다\n  해결: 없다",
        en: "fresnel: Something unexpected failed\n  Fix: None",
      },
      expected: {
        ko: { text: "키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.", detail: "종료 코드 3" },
        en: { text: "The key couldn't be saved. Try again in a moment.", detail: "Exit code 3" },
      },
    });
  });

  test("an empty detail keeps the old behavior: the general text, and the exit code only when there is one", () => {
    expectRejectionCase({
      exitCode: 1,
      stderr: { ko: "", en: "" },
      expected: {
        ko: { text: "키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.", detail: "종료 코드 1" },
        en: { text: "The key couldn't be saved. Try again in a moment.", detail: "Exit code 1" },
      },
    });
    const noExitCode: KeyRegisterError = { kind: "rejected", exitCode: null, detail: "" };
    expect(keyErrorText(noExitCode)).toBe("키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    expect(keyErrorDetail(noExitCode)).toBeNull();
  });

  test("the provider reason picks its own fix sentence, and the sentence is the catalog one for that id", () => {
    const cases: readonly { readonly reason: string; readonly fix: MessageId }[] = [
      { reason: "version_too_old", fix: "cli.errors.secret.providerUnavailable.versionTooOld.fix" },
      { reason: "not_registered", fix: "cli.errors.secret.providerUnavailable.notRegistered.fix" },
      { reason: "binary_missing", fix: "cli.errors.secret.providerUnavailable.fix" },
    ];
    for (const { reason, fix } of cases) {
      const error: KeyRegisterError = {
        kind: "rejected",
        exitCode: 1,
        detail: `fresnel: 시크릿 제공자(sops)를 쓸 수 없다 (${reason})\n  해결: 없다`,
      };
      expect(keyErrorDetail(error)).toBe(`${t(fix)}\n종료 코드 1`);
    }
    expect(t("cli.errors.secret.providerUnavailable.fix")).toBe(
      "sops와 age를 설치하고 fresnel doctor로 확인한다",
    );
  });

  test("a provider message without a reason gets the general provider fix, and no exit line without a code", () => {
    const error: KeyRegisterError = {
      kind: "rejected",
      exitCode: null,
      detail: "fresnel: 시크릿 제공자(sops)를 쓸 수 없다\n  해결: 없다",
    };
    expect(keyErrorText(error)).toBe("시크릿 제공자(sops)를 쓸 수 없다");
    expect(keyErrorDetail(error)).toBe("sops와 age를 설치하고 fresnel doctor로 확인한다");
  });
});
