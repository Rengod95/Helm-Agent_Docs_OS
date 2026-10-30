import {
  assertNever,
  attemptAsync,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@xeon/contracts";
import type { SecretName } from "@xeon/contracts/capabilities";
import { WireError, type WireParams, type WireResult } from "@xeon/contracts/wire";

// 비밀 값 열람 view-model(M3-REQ-17, L4.settings-ui.spec §4.6.3 "값 보기", §4.6.4). 열람은 사람 전용이고 재인증을 거친다.
// 상태는 hidden → reauth → revealed | failed 한 줄이다. 값은 `revealed` 상태에서만 존재하고, 숨기거나 시한이 지나거나
// 다른 이름을 열면 0으로 덮어 지운다. 값은 `RevealedValue` 안에만 있고 직렬화(JSON.stringify), 로그, 오류에는 실리지 않는다.
// 값을 화면이 받는 길은 셸 포트(`SecretRevealPort`)가 정한다. wire만 쓰는 연결은 `secret.beginReveal`로 호스트가 값을 OS 창에 보이고
// (값 없는 `shown_by_host`), 이 view-model에는 값이 없다.

/** 값이 화면에 머무는 시간. 지나면 자동으로 숨긴다 */
export const REVEAL_VISIBLE_MS = 30_000;

/** 열람이 끝나지 않은 이유. 값은 들어 있지 않다 */
export type RevealFailure =
  /** 사람이 재인증을 거절하거나 취소했다 */
  | { readonly kind: "reauth_denied" }
  /** 재인증 확인이 만료되었다 */
  | { readonly kind: "reauth_expired" }
  /** 이 연결에는 열람 수단이 없다(서비스 연결, 셸 포트 없음) */
  | { readonly kind: "unavailable" }
  /** 호스트가 열람을 시작하지 않았다(`started: false`): 재인증을 끝내지 않았거나 호스트에 열람 수단이 없다. wire는 둘을 가르지 않는다 */
  | { readonly kind: "not_started" }
  | { readonly kind: "not_found" }
  | { readonly kind: "failed" };

/** 포트가 돌려주는 결과: 값을 이 화면이 받거나, 호스트가 자기 창에 보였다 */
export type RevealGrant =
  | { readonly kind: "value"; readonly bytes: Uint8Array }
  | { readonly kind: "shown_by_host" };

/** 재인증을 거쳐 값을 여는 수단. 셸(Tauri 명령, OS 인증)이나 wire 어댑터가 구현한다 */
export interface SecretRevealPort {
  reveal(name: SecretName): Promise<Result<RevealGrant, RevealFailure>>;
}

/** 열린 값. 읽은 뒤 화면이 바로 그리고 `clear()`로 지운다. 직렬화하면 가려진 표시만 나온다 */
export interface RevealedValue {
  readonly length: number;
  /** 값 바이트의 사본. 쓴 뒤 호출자가 0으로 덮는다 */
  read(): Uint8Array;
  clear(): void;
  toJSON(): string;
}

export type RevealState =
  | { readonly status: "hidden" }
  | { readonly status: "reauth"; readonly name: SecretName }
  /** `value`가 null이면 호스트가 값을 자기 창에 보였다 */
  | {
      readonly status: "revealed";
      readonly name: SecretName;
      readonly value: RevealedValue | null;
    }
  | { readonly status: "failed"; readonly name: SecretName; readonly failure: RevealFailure };

export interface SecretReveal {
  state(): RevealState;
  /** 상태가 바뀔 때마다 부른다. 돌려주는 함수로 푼다 */
  subscribe(listener: (state: RevealState) => void): () => void;
  /** 재인증을 시작해 값을 연다. 재인증이 진행 중이면 무시한다. 다른 이름이 열려 있으면 먼저 지운다 */
  reveal(name: SecretName): Promise<void>;
  /** 값을 지우고 숨긴다 */
  hide(): void;
}

export interface SecretRevealDeps {
  readonly port: SecretRevealPort;
  readonly scheduler: Scheduler;
  readonly visibleMs?: number;
}

function valueHolder(bytes: Uint8Array): RevealedValue {
  const held = bytes;
  return {
    length: held.length,
    read: () => held.slice(),
    clear: () => {
      held.fill(0);
    },
    toJSON: () => "[hidden]",
  };
}

export function createSecretReveal(deps: SecretRevealDeps): SecretReveal {
  const visibleMs = deps.visibleMs ?? REVEAL_VISIBLE_MS;
  const listeners = new Set<(state: RevealState) => void>();
  const cell: { state: RevealState; timer: TimerHandle | null } = {
    state: { status: "hidden" },
    timer: null,
  };

  function dropValue(): void {
    if (cell.timer !== null) {
      deps.scheduler.clearTimeout(cell.timer);
      cell.timer = null;
    }
    if (cell.state.status === "revealed") cell.state.value?.clear();
  }

  function set(next: RevealState): void {
    cell.state = next;
    for (const listener of Array.from(listeners)) listener(next);
  }

  function hide(): void {
    dropValue();
    if (cell.state.status !== "hidden") set({ status: "hidden" });
  }

  return {
    state: () => cell.state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hide,
    async reveal(name) {
      if (cell.state.status === "reauth") return;
      dropValue();
      set({ status: "reauth", name });
      const outcome = await attemptAsync(() => deps.port.reveal(name));
      // 포트가 던지면 값이 어떤 상태인지 알 수 없다: 값 없이 실패로 둔다
      if (!outcome.ok) {
        set({ status: "failed", name, failure: { kind: "failed" } });
        return;
      }
      if (!outcome.value.ok) {
        set({ status: "failed", name, failure: outcome.value.error });
        return;
      }
      const grant = outcome.value.value;
      switch (grant.kind) {
        case "shown_by_host":
          set({ status: "revealed", name, value: null });
          break;
        case "value":
          set({ status: "revealed", name, value: valueHolder(grant.bytes) });
          cell.timer = deps.scheduler.setTimeout(hide, visibleMs);
          break;
        default:
          assertNever(grant, "RevealGrant");
      }
    },
  };
}

/** 열람 wire 호출 하나만 쓰는 연결. `HostConnection`이 이 모양을 만족한다 */
export interface RevealConnection {
  request(
    method: "secret.beginReveal",
    params: WireParams<"secret.beginReveal">,
  ): Promise<WireResult<"secret.beginReveal">>;
}

/** wire 어댑터: `secret.beginReveal`로 호스트가 값을 자기 창에 보인다. 값은 이 쪽에 오지 않는다(`started: false`는 재인증이 끝나지 않은 것) */
export function revealViaWire(connection: RevealConnection): SecretRevealPort {
  return {
    async reveal(name) {
      const called = await attemptAsync(() => connection.request("secret.beginReveal", { name }));
      if (called.ok) {
        return called.value.started
          ? { ok: true, value: { kind: "shown_by_host" } }
          : { ok: false, error: { kind: "not_started" } };
      }
      const cause = called.error.cause;
      if (cause instanceof WireError && cause.data.kind === "secret.notFound") {
        return { ok: false, error: { kind: "not_found" } };
      }
      return { ok: false, error: { kind: "failed" } };
    },
  };
}
