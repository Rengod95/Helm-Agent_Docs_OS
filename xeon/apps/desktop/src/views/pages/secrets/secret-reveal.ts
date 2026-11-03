import {
  assertNever,
  attemptAsync,
  detach,
  err,
  ok,
  rethrow,
  type Result,
  type Scheduler,
} from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import {
  createClipboardClear,
  createSecretReveal,
  REVEAL_VISIBLE_MS,
  type RevealFailure,
  type RevealGrant,
  type SecretRevealPort,
} from "@fresnel/client/settings";
import { gatedRevealPort, type RevealGate } from "../../../app/secret-reveal-gate.ts";
import type { SecretCommandError, SecretCommands } from "../../commands.ts";

// 값 보기 세션. `createSecretReveal`(hidden → reauth → revealed | failed)과 클립보드 지우기 시한을 묶는다.
// 값은 세션 안의 `RevealedValue`에만 있다. 화면 상태(`RevealView`)에는 이름, 종류, 남은 초만 들어간다.
// 글자는 `shownText()`로 그리는 순간에만 만들고, 상태나 뷰 모델에 넣지 않는다.
// 숨기기(`hide`)와 화면을 떠날 때는 클립보드도 지금 지운다(`createClipboardClear.flush`).

/** 화면이 그리는 값 보기 상태. 값은 없다 */
export type RevealView =
  | { readonly status: "hidden" }
  | { readonly status: "reauth"; readonly name: SecretName }
  /** `hostShown`이면 호스트가 자기 창에 보였고 이 화면은 값을 갖지 않는다 */
  | {
      readonly status: "revealed";
      readonly name: SecretName;
      readonly hostShown: boolean;
      readonly remainingSec: number;
    }
  | { readonly status: "failed"; readonly name: SecretName; readonly failure: RevealFailure };

export const HIDDEN_REVEAL: RevealView = { status: "hidden" };

export interface RevealSessionDeps {
  readonly gate: RevealGate;
  /** 재인증을 통과한 뒤에만 불리는 값 경로(wire 어댑터) */
  readonly valuePort: SecretRevealPort;
  readonly scheduler: Scheduler;
  readonly clock: { now(): number };
  readonly clipboard: { writeText(text: string): Promise<void> };
}

export interface RevealSession {
  /** 지금 상태. 값은 없다 */
  view(): RevealView;
  /** 상태가 바뀌면 부른다. 돌려주는 함수로 구독을 끊는다 */
  subscribe(listener: () => void): () => void;
  /** 값이 보일 때만 그 글자. 그리는 데만 쓰고 저장하지 않는다. 가려져 있으면 `null` */
  shownText(): string | null;
  /** 재인증을 시작해 값을 연다. 다른 이름이면 앞의 값을 지운다 */
  reveal(name: SecretName): Promise<void>;
  /** 값을 지우고 숨긴다. 클립보드 지우기 시한이 걸려 있으면 지금 지운다 */
  hide(): void;
  /** 보이는 값을 클립보드에 쓰고 30초 뒤 비우기를 건다. 보이지 않거나 쓰지 못하면 `false` */
  copy(): Promise<boolean>;
}

/** 남은 초. 시각이 지나면 0이다 */
function remainingSecOf(shownAt: number, now: number): number {
  const left = Math.ceil((shownAt + REVEAL_VISIBLE_MS - now) / 1000);
  return Math.min(REVEAL_VISIBLE_MS / 1000, Math.max(0, left));
}

/** 바이트를 글자로 바꾸고 바이트 사본은 0으로 덮는다. 글자는 호출자가 쓴다 */
function textOf(bytes: Uint8Array): string {
  try {
    return new TextDecoder().decode(bytes);
  } finally {
    bytes.fill(0);
  }
}

export function createRevealSession(deps: RevealSessionDeps): RevealSession {
  const valueReveal = createSecretReveal({
    port: gatedRevealPort(deps.gate, deps.valuePort),
    scheduler: deps.scheduler,
  });
  const clip = createClipboardClear({
    scheduler: deps.scheduler,
    clear: () => deps.clipboard.writeText(""),
  });
  const listeners = new Set<() => void>();
  let shownAt = 0;

  // 값이 가려지는 모든 길(숨기기, 시한, 다른 이름, 실패)에서 클립보드 시한도 푼다. 시한이 없으면 아무 일도 없다
  valueReveal.subscribe((state) => {
    if (state.status === "revealed") shownAt = deps.clock.now();
    else detach(clip.flush(), rethrow);
    for (const listener of Array.from(listeners)) listener();
  });

  return {
    view(): RevealView {
      const state = valueReveal.state();
      switch (state.status) {
        case "hidden":
          return HIDDEN_REVEAL;
        case "reauth":
          return { status: "reauth", name: state.name };
        case "revealed":
          return {
            status: "revealed",
            name: state.name,
            hostShown: state.value === null,
            remainingSec: remainingSecOf(shownAt, deps.clock.now()),
          };
        case "failed":
          return { status: "failed", name: state.name, failure: state.failure };
        default:
          return assertNever(state, "RevealState");
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shownText() {
      const state = valueReveal.state();
      if (state.status !== "revealed" || state.value === null) return null;
      return textOf(state.value.read());
    },
    reveal(name) {
      return valueReveal.reveal(name);
    },
    hide() {
      valueReveal.hide();
      detach(clip.flush(), rethrow);
    },
    async copy() {
      const state = valueReveal.state();
      if (state.status !== "revealed" || state.value === null) return false;
      const text = textOf(state.value.read());
      const written = await attemptAsync(() => deps.clipboard.writeText(text));
      if (!written.ok) return false;
      clip.arm();
      return true;
    },
  };
}

/** 값 경로: `secret.beginReveal`. 호스트가 자기 창에 보였으면 값 없는 `shown_by_host`다 */
export function revealPortOf(secrets: Pick<SecretCommands, "beginReveal">): SecretRevealPort {
  return {
    async reveal(name): Promise<Result<RevealGrant, RevealFailure>> {
      const begun = await secrets.beginReveal(name);
      if (!begun.ok) return err(revealFailureOf(begun.error));
      if (!begun.value) return err({ kind: "not_started" });
      const grant: RevealGrant = { kind: "shown_by_host" };
      return ok(grant);
    },
  };
}

function revealFailureOf(error: SecretCommandError): RevealFailure {
  switch (error.kind) {
    case "offline":
    case "failed":
    case "inUse":
      return { kind: "failed" };
    case "unsupported":
      return { kind: "unavailable" };
    case "reauthRequired":
      return { kind: "reauth_expired" };
    case "notFound":
      return { kind: "not_found" };
    default:
      return assertNever(error, "SecretCommandError");
  }
}
