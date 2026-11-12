import { describe, expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import { FAILURE_KINDS, type FailureKind } from "@fresnel/contracts/services";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import {
  hasEdgeSpace,
  keyErrorDetail,
  keyErrorText,
  submitKey,
  submitSecretValue,
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
    expect(outcome).toEqual({ kind: "registered", trimmed: true });
    // 보낸 바이트는 0으로 덮였다
    expect(wiped(seen.bytes)).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain(FAKE);
  });

  test("with a preflight, the field is read only after the answer; a cancel sends nothing and keeps the field", async () => {
    const input = field(FAKE);
    let registrations = 0;
    const registrar: KeyRegistrar = {
      registerKey: () => {
        registrations += 1;
        return Promise.resolve(ok(null));
      },
    };
    const answer = Promise.withResolvers<"proceed" | "cancel">();
    let asked = false;
    const pending = submitKey(registrar, NAME, "add", input.field, () => {
      asked = true;
      return answer.promise;
    });
    // 확인을 기다리는 동안 값은 입력란에 그대로 있고, 아무것도 읽히지 않았다
    expect(asked).toBe(true);
    expect(input.takes()).toBe(0);
    expect(input.shown()).toBe(FAKE);
    answer.resolve("cancel");
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(registrations).toBe(0);
    expect(input.shown()).toBe(FAKE);
  });

  test("with a preflight that proceeds, the field is read once and registered as usual", async () => {
    const input = field(`  ${FAKE}\n`);
    const sent: string[] = [];
    const registrar: KeyRegistrar = {
      registerKey: (_name, _action, value) => {
        sent.push(new TextDecoder().decode(value));
        return Promise.resolve(ok(null));
      },
    };
    const outcome = await submitKey(registrar, NAME, "add", input.field, () =>
      Promise.resolve<"proceed" | "cancel">("proceed"),
    );
    expect(outcome).toEqual({ kind: "registered", trimmed: true });
    expect(input.takes()).toBe(1);
    expect(sent).toEqual([FAKE]);
    expect(input.shown()).toBe("");
  });

  test("an API key pasted with zero-width marks and quotes is cleaned, and the outcome says it was trimmed", async () => {
    const sent: string[] = [];
    const registrar: KeyRegistrar = {
      registerKey: (_name, _action, value) => {
        sent.push(new TextDecoder().decode(value));
        return Promise.resolve(ok(null));
      },
    };
    const quoted = field(`\u200B"${FAKE}"\u00A0\r\n`);
    expect(await submitKey(registrar, NAME, "add", quoted.field)).toEqual({
      kind: "registered",
      trimmed: true,
    });
    // 안쪽 글자는 그대로다
    const interior = field("fake key-0001");
    expect(await submitKey(registrar, NAME, "add", interior.field)).toEqual({
      kind: "registered",
      trimmed: false,
    });
    expect(sent).toEqual([FAKE, "fake key-0001"]);
  });

  test("a general secret keeps its edges when the answer is keep, and trims only whitespace when the answer is trim", async () => {
    const sent: string[] = [];
    const registrar: KeyRegistrar = {
      registerKey: (_name, _action, value) => {
        sent.push(new TextDecoder().decode(value));
        return Promise.resolve(ok(null));
      },
    };
    const kept = field(` "quoted"\n`);
    expect(await submitSecretValue(registrar, NAME, "add", kept.field, "keep")).toEqual({
      kind: "registered",
      trimmed: false,
    });
    const trimmed = field(` "quoted"\n`);
    expect(await submitSecretValue(registrar, NAME, "add", trimmed.field, "trim")).toEqual({
      kind: "registered",
      trimmed: true,
    });
    expect(sent).toEqual([` "quoted"\n`, `"quoted"`]);
  });

  test("hasEdgeSpace sees only whitespace and line breaks at the edges", () => {
    expect(hasEdgeSpace(` ${FAKE}`)).toBe(true);
    expect(hasEdgeSpace(`${FAKE}\n`)).toBe(true);
    expect(hasEdgeSpace(FAKE)).toBe(false);
    expect(hasEdgeSpace("a b")).toBe(false);
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
            // 종류 코드가 없거나 모르는 출력이라 일반 문장과, 사이드카 출력의 첫 줄과 종료 코드가 나온다
            code: "unknown",
            detail: "fresnel: 알 수 없는 실패다\n  해결: 없다",
          }),
        );
      },
    };
    const outcome = await submitKey(registrar, NAME, "set", input.field);
    expect(outcome).toEqual({
      kind: "failed",
      // 사이드카의 원문 문장은 화면 문장이 되지 않는다. "자세히"에 첫 줄만 보인다
      text: "키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      keystore: false,
      code: "unknown",
      detail: "알 수 없는 실패다\n종료 코드 1",
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
      code: "key_store",
    });
    expect(JSON.stringify(outcome)).not.toContain("fresnel config");
  });

  test("a rejection carries its code to the outcome, and a timeout has no code", async () => {
    const rejected: KeyRegistrar = {
      registerKey: () =>
        Promise.resolve(
          err<KeyRegisterError>({ kind: "rejected", exitCode: 1, code: "store_busy", detail: "" }),
        ),
    };
    expect(await submitKey(rejected, NAME, "add", field(FAKE).field)).toEqual({
      kind: "failed",
      text: "저장소가 다른 쓰기로 바빠요",
      keystore: false,
      code: "store_busy",
      fix: "잠시 뒤 다시 등록해요",
      detail: "잠시 뒤 다시 등록해요\n종료 코드 1",
    });
    const timedOut: KeyRegistrar = {
      registerKey: () => Promise.resolve(err<KeyRegisterError>({ kind: "timeout" })),
    };
    const outcome = await submitKey(timedOut, NAME, "add", field(FAKE).field);
    expect(outcome).toEqual({
      kind: "failed",
      text: "키 등록이 시간 안에 끝나지 않았어요. 다시 시도해 주세요.",
      keystore: true,
    });
    expect(outcome).not.toHaveProperty("code");
  });

  test("a known code gives its fix sentence apart from the exit code, and an unknown code has none", async () => {
    const rows: readonly {
      readonly code: FailureKind;
      readonly text: string;
      readonly fix: string;
    }[] = [
      {
        code: "service_local_only",
        text: "이 컴퓨터에서만 값을 넣을 수 있어요",
        fix: "값을 넣을 컴퓨터의 앱에서 등록하거나 그 컴퓨터에서 `fresnel secret add <이름>`을 실행해요",
      },
      {
        code: "key_store",
        text: "OS 키 저장소를 쓸 수 없어요",
        fix: "키 저장소 잠금을 풀거나 설정의 시크릿에서 열쇠 보관을 '앱 파일'로 바꿔요",
      },
      {
        code: "already_exists",
        text: "이미 있는 이름이에요",
        fix: "값만 바꾸려면 '값 바꾸기'를 써요",
      },
      {
        code: "value_too_short",
        text: "값이 너무 짧아요(8자 이상)",
        fix: "키 전체를 붙여 넣었는지 확인해요",
      },
      { code: "sops_missing", text: "sops가 없어요", fix: "sops 3.10 이상을 설치해요" },
    ];
    const outcomes = await Promise.all(
      rows.map(async (row) => {
        const registrar: KeyRegistrar = {
          registerKey: () =>
            Promise.resolve(
              err<KeyRegisterError>({ kind: "rejected", exitCode: 1, code: row.code, detail: "" }),
            ),
        };
        return { row, outcome: await submitKey(registrar, NAME, "add", field(FAKE).field) };
      }),
    );
    for (const { row, outcome } of outcomes) {
      expect(outcome).toEqual({
        kind: "failed",
        text: row.text,
        keystore: false,
        code: row.code,
        fix: row.fix,
        detail: `${row.fix}\n종료 코드 1`,
      });
    }
    const unknown: KeyRegistrar = {
      registerKey: () =>
        Promise.resolve(
          err<KeyRegisterError>({ kind: "rejected", exitCode: 1, code: "unknown", detail: "" }),
        ),
    };
    expect(await submitKey(unknown, NAME, "add", field(FAKE).field)).not.toHaveProperty("fix");
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
      { kind: "rejected", exitCode: 3, code: "unknown", detail: "" },
      { kind: "failed" },
    ];
    const texts = kinds.map(keyErrorText);
    expect(new Set(texts).size).toBe(kinds.length);
    expect(keyErrorText({ kind: "rejected", exitCode: 3, code: "unknown", detail: "" })).toBe(
      "키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    );
    expect(keyErrorDetail({ kind: "rejected", exitCode: 3, code: "unknown", detail: "" })).toBe(
      "종료 코드 3",
    );
    expect(
      keyErrorDetail({ kind: "rejected", exitCode: null, code: "unknown", detail: "" }),
    ).toBeNull();
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

describe("reason sentences follow the code (L4.desktop.spec §4.14.1)", () => {
  test("every code has its own non-empty reason in both locales, and only unknown has no fix", () => {
    for (const screen of SCREEN_LOCALES) {
      inLocale(screen, () => {
        const texts: string[] = [];
        for (const code of FAILURE_KINDS) {
          const error: KeyRegisterError = { kind: "rejected", exitCode: null, code, detail: "" };
          const text = keyErrorText(error);
          // 카탈로그 id가 빠지면 id 글이 그대로 나온다
          expect(text.startsWith("client.")).toBe(false);
          expect(text).not.toBe("");
          texts.push(text);
          const detail = keyErrorDetail(error);
          if (code === "unknown") {
            // 모르는 원인은 해결 문장이 없고, 출력도 없으면 "자세히"가 비어 있다
            expect(detail).toBeNull();
          } else {
            expect(detail === null || detail === "").toBe(false);
          }
        }
        // 코드마다 자기 원인 문장이 있다. unknown만 일반 문장을 쓴다
        expect(new Set(texts).size).toBe(FAILURE_KINDS.length);
      });
    }
  });

  test("known codes show their own reason and fix, in the screen locale", () => {
    const rows: readonly {
      readonly code: FailureKind;
      readonly ko: readonly [string, string];
      readonly en: readonly [string, string];
    }[] = [
      {
        code: "key_store",
        ko: [
          "OS 키 저장소를 쓸 수 없어요",
          "키 저장소 잠금을 풀거나 설정의 시크릿에서 열쇠 보관을 '앱 파일'로 바꿔요",
        ],
        en: [
          "The OS key store can't be used",
          "Unlock the key store, or change key storage to 'app file' in the secrets settings",
        ],
      },
      {
        code: "key_missing",
        ko: [
          "복호화 키를 찾을 수 없어요",
          "이미 쓰는 시크릿 파일이 있으면 그 키 위치를 확인하고, 처음이면 다시 등록해요",
        ],
        en: [
          "The decryption key was not found",
          "If a secret file is already in use, check where its key is. If this is the first time, register again",
        ],
      },
      {
        code: "key_file",
        ko: [
          "열쇠 파일을 쓸 수 없거나 권한이 맞지 않아요",
          "설정 폴더의 secrets/age 폴더 권한을 확인해요. 있는 키 파일은 덮어쓰지 않아요",
        ],
        en: [
          "The key file can't be written or has the wrong permissions",
          "Check the permissions of the secrets/age folder in the config folder. An existing key file is never overwritten",
        ],
      },
      {
        code: "key_fallback_unconfirmed",
        ko: [
          "이 컴퓨터에서는 키 저장소를 쓸 수 없어요",
          "설정의 시크릿에서 열쇠 보관을 '앱 파일'로 바꿔요",
        ],
        en: [
          "This computer cannot use the key store",
          "In Settings > Secrets, change key storage to 'app file'",
        ],
      },
      {
        code: "service_local_only",
        ko: [
          "이 컴퓨터에서만 값을 넣을 수 있어요",
          "값을 넣을 컴퓨터의 앱에서 등록하거나 그 컴퓨터에서 `fresnel secret add <이름>`을 실행해요",
        ],
        en: [
          "A value can only be entered on this computer",
          "Enter it in the app on the computer that takes the value, or run `fresnel secret add <name>` on that computer",
        ],
      },
      {
        code: "already_exists",
        ko: ["이미 있는 이름이에요", "값만 바꾸려면 '값 바꾸기'를 써요"],
        en: ["That name is already in use", "To change only the value, use 'Change value'"],
      },
      {
        code: "not_found",
        ko: ["그 이름의 키가 없어요", "이름을 확인하거나 새 키로 등록해요"],
        en: ["No key has that name", "Check the name, or register it as a new key"],
      },
      {
        code: "value_too_short",
        ko: ["값이 너무 짧아요(8자 이상)", "키 전체를 붙여 넣었는지 확인해요"],
        en: [
          "The value is too short (at least 8 characters)",
          "Check that you pasted the whole key",
        ],
      },
      {
        code: "value_empty",
        ko: ["키가 비어 있어요", "키를 붙여 넣고 다시 등록해요"],
        en: ["The key is empty", "Paste the key and register it again"],
      },
      {
        code: "cancelled",
        ko: ["입력을 취소했어요", "다시 등록해요"],
        en: ["The input was cancelled", "Register it again"],
      },
      {
        code: "sops_missing",
        ko: ["sops가 없어요", "sops 3.10 이상을 설치해요"],
        en: ["sops is not installed", "Install sops 3.10 or newer"],
      },
      {
        code: "sops_version",
        ko: ["sops 버전이 너무 낮아요", "sops를 3.10 이상(권장 3.12 이상)으로 올려요"],
        en: [
          "The sops version is too old",
          "Upgrade sops to 3.10 or newer (3.12 or newer recommended)",
        ],
      },
      {
        code: "age_missing",
        ko: ["age가 없어요", "age를 설치해요"],
        en: ["age is not installed", "Install age"],
      },
      {
        code: "provider_unavailable",
        ko: ["시크릿 제공자를 쓸 수 없어요", "sops와 age를 설치하고 설정을 확인해요"],
        en: ["The secret provider is unavailable", "Install sops and age, then check the settings"],
      },
      {
        code: "decrypt_failed",
        ko: ["시크릿을 복호화하지 못했어요", "age 키가 이 파일의 수신자인지 확인해요"],
        en: [
          "The secret could not be decrypted",
          "Check that the age key is a recipient of this file",
        ],
      },
      {
        code: "read_only_provider",
        ko: ["읽기 전용 제공자라 쓸 수 없어요", "sops 제공자를 써요"],
        en: ["The provider is read-only, so it can't be written to", "Use the sops provider"],
      },
      {
        code: "write_failed",
        ko: ["시크릿 저장소에 쓰지 못했어요", "데이터 폴더 권한과 디스크 상태를 확인해요"],
        en: [
          "Could not write to the secret store",
          "Check the data folder permissions and the disk",
        ],
      },
      {
        code: "store_busy",
        ko: ["저장소가 다른 쓰기로 바빠요", "잠시 뒤 다시 등록해요"],
        en: ["The store is busy with another write", "Register again shortly"],
      },
      {
        code: "service_unreachable",
        ko: ["엔진 서비스에 연결하지 못했어요", "잠시 뒤 다시 등록해요"],
        en: ["Could not reach the engine service", "Register again shortly"],
      },
    ];
    for (const row of rows) {
      for (const screen of SCREEN_LOCALES) {
        inLocale(screen, () => {
          // 사이드카 출력이 어느 로케일이든 원인은 코드가 정한다
          const error: KeyRegisterError = {
            kind: "rejected",
            exitCode: null,
            code: row.code,
            detail: "fresnel: 다른 문장이다\n  해결: 없다",
          };
          const expected = screen === "ko" ? row.ko : row.en;
          expect(keyErrorText(error)).toBe(expected[0]);
          expect(keyErrorDetail(error)).toBe(expected[1]);
        });
      }
    }
  });

  test("the exit code follows the fix line in the screen locale", () => {
    const error: KeyRegisterError = {
      kind: "rejected",
      exitCode: 3,
      code: "sops_version",
      detail: "",
    };
    inLocale("ko", () => {
      expect(keyErrorDetail(error)).toBe(
        "sops를 3.10 이상(권장 3.12 이상)으로 올려요\n종료 코드 3",
      );
    });
    inLocale("en", () => {
      expect(keyErrorDetail(error)).toBe(
        "Upgrade sops to 3.10 or newer (3.12 or newer recommended)\nExit code 3",
      );
    });
  });

  test("a sentence that matches a CLI failure does not decide the reason: an unknown code keeps the general text", () => {
    const error: KeyRegisterError = {
      kind: "rejected",
      exitCode: 1,
      code: "unknown",
      detail:
        "fresnel: 시크릿 제공자(sops)를 쓸 수 없다 (binary_missing)\n  해결: sops와 age를 설치하고 fresnel doctor로 확인한다",
    };
    inLocale("ko", () => {
      expect(keyErrorText(error)).toBe("키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      // 모르는 원인은 사이드카 출력의 첫 줄(머리말 뗀 글)과 종료 코드를 보인다
      expect(keyErrorDetail(error)).toBe(
        "시크릿 제공자(sops)를 쓸 수 없다 (binary_missing)\n종료 코드 1",
      );
    });
  });

  test("the code decides even when the child's sentence says something else", () => {
    const error: KeyRegisterError = {
      kind: "rejected",
      exitCode: 1,
      code: "sops_version",
      detail: "fresnel: 시크릿 제공자(sops)를 쓸 수 없다 (binary_missing)\n  해결: 없다",
    };
    inLocale("ko", () => {
      expect(keyErrorText(error)).toBe("sops 버전이 너무 낮아요");
    });
  });

  test("an empty detail with an unknown code keeps the general text, and the exit code only when there is one", () => {
    const withCode: KeyRegisterError = {
      kind: "rejected",
      exitCode: 1,
      code: "unknown",
      detail: "",
    };
    inLocale("ko", () => {
      expect(keyErrorText(withCode)).toBe("키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      expect(keyErrorDetail(withCode)).toBe("종료 코드 1");
    });
    const noExitCode: KeyRegisterError = {
      kind: "rejected",
      exitCode: null,
      code: "unknown",
      detail: "",
    };
    expect(keyErrorText(noExitCode)).toBe("키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    expect(keyErrorDetail(noExitCode)).toBeNull();
  });
});
