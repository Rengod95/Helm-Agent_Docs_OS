import { t } from "@fresnel/client/i18n";
import { assertNever, err, ok, type Result } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { RevealFailure, SecretRevealPort } from "@fresnel/client/settings";
import { requestOsReauth, type OsReauthError, type OsReauthInvoke } from "../views/os-reauth.ts";

// 값 보기 재인증 관문(DECISION B8 2안 [결정: 2026-11-04 사용자]). 값은 사람이 기기 인증(Touch ID, 기기 암호)을 마친 뒤에만 보인다.
// 재인증 창은 Rust `os_reauth`(L4.desktop.spec §4.17)가 띄운다. `createOsReauthGate`가 그 명령을 부르고, 통과했을 때만 값 경로를 연다.
// 이 명령이 없는 곳(macOS가 아닌 OS, 웹)은 `UNAVAILABLE_GATE`다: 재인증을 할 수 없으므로 값 경로(`value` 포트)는 한 번도 불리지 않고,
// 값은 가져오지도 상태에 두지도 않는다.

export interface RevealGate {
  /** 이 기기에서 재인증을 띄울 수 있는가. 거짓이면 화면은 값 보기를 잠그고 이유를 보인다 */
  readonly available: boolean;
  /** 사람이 재인증을 마치면 `ok`다. 거절, 만료, 수단 없음은 `RevealFailure`로 돌려준다. 값은 다루지 않는다 */
  reauth(name: SecretName): Promise<Result<void, RevealFailure>>;
}

const UNAVAILABLE_REAUTH: Result<void, RevealFailure> = err({ kind: "unavailable" });

/** 출하 구현. 재인증 수단이 없으므로 항상 `unavailable`이다 */
export const UNAVAILABLE_GATE: RevealGate = {
  available: false,
  reauth: () => Promise.resolve(UNAVAILABLE_REAUTH),
};

/** Rust 오류 종류를 값 보기 실패로 옮긴다. 사람이 닫거나 거절한 것은 모두 "취소했어요"로 보인다 */
function failureOf(error: OsReauthError): RevealFailure {
  switch (error.kind) {
    case "cancelled":
    case "denied":
      return { kind: "reauth_denied" };
    case "unavailable":
      return { kind: "unavailable" };
    case "failed":
      return { kind: "failed" };
    default:
      return assertNever(error.kind, "OsReauthKind");
  }
}

/**
 * 운영 구현. 이름마다 사람 재인증 창(`os_reauth`)을 띄운다. 창이 떠 있는 동안 같은 이름의 호출은 그 결과를 함께 기다리고
 * (창이 두 번 뜨지 않는다), 다른 이름의 호출은 앞의 창이 닫힌 뒤에 자기 창을 띄운다(창은 한 번에 하나다).
 * 성공 증거 시각은 여기서 쓰지 않는다: 호스트의 값 보기(`secret.beginReveal`)는 자기 창에 보이는 경로라 증거를 받지 않는다.
 */
export function createOsReauthGate(invoke: OsReauthInvoke): RevealGate {
  interface Running {
    readonly id: number;
    readonly name: SecretName;
    readonly promise: Promise<Result<void, RevealFailure>>;
  }
  const state: { running: Running | null; seq: number } = { running: null, seq: 0 };
  const prompt = async (name: SecretName): Promise<Result<void, RevealFailure>> => {
    const granted = await requestOsReauth(
      invoke,
      t("desktop.secrets.reveal.reauthReason", { name }),
    );
    return granted.ok ? ok(undefined) : err(failureOf(granted.error));
  };
  return {
    available: true,
    reauth(name) {
      const before = state.running;
      if (before !== null && before.name === name) return before.promise;
      state.seq += 1;
      const id = state.seq;
      const promise = (async (): Promise<Result<void, RevealFailure>> => {
        try {
          if (before !== null) await before.promise;
          return await prompt(name);
        } finally {
          // 끝나면 자리를 비워 다음 호출이 새 창을 띄운다(그 사이 다른 호출이 자리를 이어받았으면 그대로 둔다)
          if (state.running?.id === id) state.running = null;
        }
      })();
      state.running = { id, name, promise };
      return promise;
    },
  };
}

/** 재인증을 먼저 부르고, 통과했을 때만 값 경로를 부른다. 재인증이 실패하면 값 경로는 건드리지 않는다 */
export function gatedRevealPort(gate: RevealGate, value: SecretRevealPort): SecretRevealPort {
  return {
    async reveal(name) {
      const reauthed = await gate.reauth(name);
      if (!reauthed.ok) return reauthed;
      return value.reveal(name);
    },
  };
}
