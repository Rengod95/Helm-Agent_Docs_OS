import { describe, expect, test } from "bun:test";
import {
  attachErrorKey,
  attachFixKey,
  type AttachFailureKind,
  LAST_TARGET_KEY,
  lastTargetOf,
  pairErrorKey,
  PREFLIGHT_CAUSE_CODES,
  PREFLIGHT_STEPS,
  preflightActionKey,
  preflightCauseKey,
  preflightFixKey,
  preflightHintKey,
  preflightOkKey,
  preflightStepKey,
  sshTargetOfAddress,
} from "../../src/connection-targets/index.ts";
import { catalogOf, type MessageId } from "../../src/i18n/index.ts";

// 사전 점검과 붙기 명령의 번역 키 선택, 마지막 대상 값, ssh 점검 주소. 키 목록은 en·ko 카탈로그와 맞아야 한다.

const en = catalogOf("en");
const ko = catalogOf("ko");

/** 키 함수의 반환 타입이 번역 키 집합(en.json 키)에 들어가는지 컴파일 시점에 본다 */
function messageIdOf(key: MessageId): MessageId {
  return key;
}

/** 모든 연결 실패 종류. 종류가 늘면 아래 타입 검사가 컴파일을 실패시킨다 */
const ATTACH_KINDS = [
  "tunnel",
  "hostKey",
  "fingerprint",
  "certUntrusted",
  "auth",
  "tokenMissing",
  "protocol",
  "socketMissing",
  "refused",
  "timeout",
  "permission",
  "other",
] as const satisfies readonly AttachFailureKind[];
type UnlistedAttachKind = Exclude<AttachFailureKind, (typeof ATTACH_KINDS)[number]>;
const everyAttachKindListed: [UnlistedAttachKind] extends [never] ? true : false = true;

describe("preflight step keys", () => {
  test("the six steps come in run order", () => {
    expect([...PREFLIGHT_STEPS]).toEqual([
      "resolve",
      "connect",
      "install",
      "service",
      "socket",
      "tunnel",
    ]);
  });

  test("each step has a name key and an ok key", () => {
    expect(preflightStepKey("connect")).toBe("desktop.connection.preflight.step.connect");
    expect(preflightStepKey("tunnel")).toBe("desktop.connection.preflight.step.tunnel");
    expect(preflightOkKey("install")).toBe("desktop.connection.preflight.ok.install");
    expect(preflightOkKey("socket")).toBe("desktop.connection.preflight.ok.socket");
  });

  test("every step's keys exist in both catalogs", () => {
    for (const step of PREFLIGHT_STEPS) {
      for (const key of [messageIdOf(preflightStepKey(step)), messageIdOf(preflightOkKey(step))]) {
        expect(en[key]).toBeDefined();
        expect(ko[key]).toBeDefined();
      }
    }
  });
});

describe("cause and fix keys follow the known codes", () => {
  test("a known code maps to its own cause and fix keys", () => {
    // 코드는 snake_case이고 키 조각은 catalog 규칙(카멜 케이스)이다
    expect(preflightCauseKey("host_key_changed")).toBe(
      "desktop.connection.preflight.cause.hostKeyChanged",
    );
    expect(preflightFixKey("auth_password_only")).toBe(
      "desktop.connection.preflight.fix.authPasswordOnly",
    );
  });

  test("an unknown code, and codes that carry no sentence, fall back to the unknown keys", () => {
    expect(preflightCauseKey("never_seen")).toBe("desktop.connection.preflight.cause.unknown");
    expect(preflightFixKey("never_seen")).toBe("desktop.connection.preflight.fix.unknown");
    // 성공과 진행 중 이벤트는 원인 문장이 없다
    expect(preflightCauseKey("ok")).toBe("desktop.connection.preflight.cause.unknown");
    expect(preflightCauseKey("running")).toBe("desktop.connection.preflight.cause.unknown");
  });

  test("every listed cause code has a cause and a fix sentence in en and ko", () => {
    for (const code of PREFLIGHT_CAUSE_CODES) {
      for (const key of [
        messageIdOf(preflightCauseKey(code)),
        messageIdOf(preflightFixKey(code)),
      ]) {
        expect(en[key]).toBeDefined();
        expect(ko[key]).toBeDefined();
      }
    }
  });

  test("the code list maps to exactly the cause keys of en.json (unknown is a shell code too)", () => {
    const fromCatalog = Object.keys(en)
      .filter((key) => key.startsWith("desktop.connection.preflight.cause."))
      .toSorted();
    const mapped: string[] = PREFLIGHT_CAUSE_CODES.map((code) =>
      preflightCauseKey(code),
    ).toSorted();
    expect(mapped).toEqual(fromCatalog);
  });
});

describe("action and hint keys", () => {
  test("a known action has its own key, an unknown one becomes retry", () => {
    expect(preflightActionKey("trust_host_key")).toBe(
      "desktop.connection.preflight.action.trustHostKey",
    );
    expect(preflightActionKey("upgrade_local")).toBe(
      "desktop.connection.preflight.action.upgradeLocal",
    );
    expect(preflightActionKey("delete_everything")).toBe(
      "desktop.connection.preflight.action.retry",
    );
  });

  test("a known hint has its key, an unknown one has none", () => {
    expect(preflightHintKey("path_noninteractive")).toBe(
      "desktop.connection.preflight.hint.pathNoninteractive",
    );
    expect(preflightHintKey("run_once_in_terminal")).toBe(
      "desktop.connection.preflight.hint.runOnceInTerminal",
    );
    expect(preflightHintKey("something_new")).toBeNull();
  });

  test("every action and hint key exists in both catalogs", () => {
    for (const action of [
      "trust_host_key",
      "replace_host_key",
      "copy_command",
      "upgrade_remote",
      "upgrade_local",
      "retry",
    ]) {
      const key = messageIdOf(preflightActionKey(action));
      expect(en[key]).toBeDefined();
      expect(ko[key]).toBeDefined();
    }
    for (const hint of [
      "path_noninteractive",
      "upgrade_remote",
      "upgrade_local",
      "run_once_in_terminal",
    ]) {
      const key = preflightHintKey(hint);
      expect(key).not.toBeNull();
      if (key === null) continue;
      expect(en[messageIdOf(key)]).toBeDefined();
      expect(ko[messageIdOf(key)]).toBeDefined();
    }
  });
});

describe("pair error keys", () => {
  test("the server's own kinds keep their key", () => {
    expect(pairErrorKey("fingerprint_changed")).toBe(
      "desktop.connection.pair.error.fingerprintChanged",
    );
    expect(pairErrorKey("invalid_code")).toBe("desktop.connection.pair.error.invalidCode");
    expect(pairErrorKey("locked")).toBe("desktop.connection.pair.error.locked");
    expect(pairErrorKey("vault_failed")).toBe("desktop.connection.pair.error.vaultFailed");
  });

  test("the four input checks all read as invalid input", () => {
    for (const code of ["invalid_pin", "invalid_host", "invalid_port", "invalid_code_format"]) {
      expect(pairErrorKey(code)).toBe("desktop.connection.pair.error.invalidInput");
    }
  });

  test("an unknown code reads as the io sentence", () => {
    expect(pairErrorKey("something_else")).toBe("desktop.connection.pair.error.io");
    expect(pairErrorKey("")).toBe("desktop.connection.pair.error.io");
  });

  test("every pair key the function can return exists in both catalogs", () => {
    for (const code of [
      "fingerprint_changed",
      "invalid_code",
      "locked",
      "invalid_device_name",
      "rejected",
      "bad_response",
      "refused",
      "timeout",
      "io",
      "vault_failed",
      "invalid_input",
    ]) {
      const key = messageIdOf(pairErrorKey(code));
      expect(en[key]).toBeDefined();
      expect(ko[key]).toBeDefined();
    }
  });
});

describe("the last target value", () => {
  test("the key sits under the window prefix the shell accepts", () => {
    expect(LAST_TARGET_KEY).toBe("l4.desktop.window.lastTarget");
  });

  test("an empty value, a missing value, and a non-string mean this computer", () => {
    expect(lastTargetOf("")).toBeNull();
    expect(lastTargetOf("   ")).toBeNull();
    expect(lastTargetOf(undefined)).toBeNull();
    expect(lastTargetOf(5)).toBeNull();
    expect(lastTargetOf(null)).toBeNull();
  });

  test("a saved address that parses comes back, trimmed", () => {
    expect(lastTargetOf("unix:/run/user/1000/fresnel/fresnel.sock")).toEqual({
      address: "unix:/run/user/1000/fresnel/fresnel.sock",
    });
    expect(lastTargetOf("  ssh://me@build.local/run/fresnel.sock  ")).toEqual({
      address: "ssh://me@build.local/run/fresnel.sock",
    });
  });

  test("a saved address that no longer parses, or is not loopback, is dropped", () => {
    expect(lastTargetOf("unix:run/fresnel.sock")).toBeNull();
    expect(lastTargetOf("tcp://192.168.0.5:7421")).toBeNull();
    expect(lastTargetOf("http://build.local")).toBeNull();
  });
});

describe("the ssh check address", () => {
  test("an ssh address gives user, host and port for the preflight", () => {
    expect(sshTargetOfAddress("ssh://me@build.local:2222/run/fresnel.sock")).toBe(
      "me@build.local:2222",
    );
  });

  test("the user and the port are optional", () => {
    expect(sshTargetOfAddress("ssh://build.local/run/fresnel.sock")).toBe("build.local");
    expect(sshTargetOfAddress("ssh://me@build.local/run/fresnel.sock")).toBe("me@build.local");
    expect(sshTargetOfAddress("ssh://build.local:22/run/fresnel.sock")).toBe("build.local:22");
  });

  test("a non-ssh or unreadable address gives null", () => {
    expect(sshTargetOfAddress("unix:/run/user/1000/fresnel/fresnel.sock")).toBeNull();
    expect(sshTargetOfAddress("tcp://127.0.0.1:7421")).toBeNull();
    expect(sshTargetOfAddress("ssh://build.local")).toBeNull();
    expect(sshTargetOfAddress("")).toBeNull();
  });
});

describe("attach failure sentences exist for every kind", () => {
  test("every kind has a cause and a fix sentence in en and ko", () => {
    expect(everyAttachKindListed).toBe(true);
    for (const kind of ATTACH_KINDS) {
      for (const key of [messageIdOf(attachErrorKey(kind)), messageIdOf(attachFixKey(kind))]) {
        expect(en[key]).toBeDefined();
        expect(ko[key]).toBeDefined();
      }
    }
  });

  test("the certificate-not-yet-trusted kind has its cause and fix", () => {
    expect(attachErrorKey("certUntrusted")).toBe("desktop.connection.error.certUntrusted");
    expect(attachFixKey("certUntrusted")).toBe("desktop.connection.error.certUntrusted.fix");
    expect(en["desktop.connection.error.certUntrusted"]).toBeDefined();
    expect(ko["desktop.connection.error.certUntrusted.fix"]).toBeDefined();
  });
});
