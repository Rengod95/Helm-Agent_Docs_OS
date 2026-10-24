import { assertNever, type Clock } from "@xeon/contracts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import type { CliIo } from "./io.ts";

// L4.cli.spec §4.6. Ctrl+C 계수, SIGTERM·SIGHUP 종료 요청.
//
//   print 모드          1회: 종료 요청(끝나면 130)   2회(2초 안): 강제 종료 130
//   대화형, turn 진행    1회: turn.interrupt(M2) 또는 종료 요청(M1)   2회: 종료 요청   3회: 강제 종료
//   대화형, turn 없음    1회: 안내   2회: 종료 요청(0)   3회: 강제 종료
//   SIGTERM: 종료 요청 → 143   SIGHUP: 종료 요청 → 129

/** Ctrl+C 계수 창 */
export const CTRL_C_WINDOW_MS = 2000;

type CtrlCAction = "interruptTurn" | "requestExit" | "hint" | "forceExit";

interface CtrlCContext {
  readonly interactive: boolean;
  readonly turnActive: boolean;
}

export interface CtrlCCounter {
  press(context: CtrlCContext): CtrlCAction;
}

/**
 * 창 안의 Ctrl+C 횟수로 할 일을 정한다. interruptSupported는 호스트가 turn.interrupt를 제공하는지다
 * (host.hello의 features에 있다. 이 처리기가 없는 호스트에서는 첫 Ctrl+C도 종료 요청이다).
 */
export function createCtrlCCounter(
  clock: Clock,
  options: { readonly interruptSupported: () => boolean },
): CtrlCCounter {
  const presses: number[] = [];
  return {
    press(context) {
      const now = clock.now();
      const kept = presses.filter((at) => now - at < CTRL_C_WINDOW_MS);
      presses.length = 0;
      presses.push(...kept, now);
      const count = presses.length;
      if (!context.interactive) return count === 1 ? "requestExit" : "forceExit";
      if (count >= 3) return "forceExit";
      if (context.turnActive) {
        if (count === 1) return options.interruptSupported() ? "interruptTurn" : "requestExit";
        return "requestExit";
      }
      return count === 1 ? "hint" : "requestExit";
    },
  };
}

interface ExitRequest {
  readonly code: ExitCode;
  /** 체크포인트 없이 바로 끝내라는 요청이다 */
  readonly forced: boolean;
}

/** 종료 요청을 한곳에 모은다. 처음 요청이 이긴다. 강제 요청은 그 뒤에도 올 수 있다 */
export interface ExitCoordinator {
  /** 종료 요청이 오면 이행한다. 강제 요청이 오면 forced: true로 한 번 더 이행하지 않고 forced 약속이 이행한다 */
  readonly requested: Promise<ExitRequest>;
  readonly forced: Promise<ExitRequest>;
  request(code: ExitCode): void;
  force(code: ExitCode): void;
  readonly isRequested: boolean;
}

export function createExitCoordinator(): ExitCoordinator {
  const requested = Promise.withResolvers<ExitRequest>();
  const forced = Promise.withResolvers<ExitRequest>();
  const state = { requested: false };
  return {
    requested: requested.promise,
    forced: forced.promise,
    request(code) {
      if (state.requested) return;
      state.requested = true;
      requested.resolve({ code, forced: false });
    },
    force(code) {
      if (!state.requested) {
        state.requested = true;
        requested.resolve({ code, forced: true });
      }
      forced.resolve({ code, forced: true });
    },
    get isRequested() {
      return state.requested;
    },
  };
}

export interface SignalWiring {
  readonly exit: ExitCoordinator;
  /** 대화형 raw 모드에서 입력 바이트 \x03으로 온 Ctrl+C를 신호와 같은 처리기로 보낸다 */
  onCtrlC(): void;
  dispose(): void;
}

export interface SignalOptions {
  readonly clock: Clock;
  readonly interactive: boolean;
  /** 호스트가 turn.interrupt를 제공하는가. 연결 뒤에야 알 수 있어 눌린 때 묻는다 */
  readonly interruptSupported: () => boolean;
  /** 지금 turn이 진행 중인가 */
  readonly turnActive: () => boolean;
  /** Ctrl+C로 turn.interrupt를 보낸다(M2) */
  readonly interruptTurn: () => void;
  /** 대화형에서 turn이 없을 때의 첫 Ctrl+C 안내 */
  readonly hint: () => void;
}

/** SIGINT·SIGTERM·SIGHUP을 종료 코디네이터에 연결한다. 대화형 raw 모드의 \x03도 같은 처리기(onCtrlC)로 보낸다 */
export function wireSignals(io: Pick<CliIo, "onSignal">, options: SignalOptions): SignalWiring {
  const exit = createExitCoordinator();
  const counter = createCtrlCCounter(options.clock, {
    interruptSupported: options.interruptSupported,
  });
  const onCtrlC = (): void => {
    const action = counter.press({
      interactive: options.interactive,
      turnActive: options.turnActive(),
    });
    switch (action) {
      case "interruptTurn":
        options.interruptTurn();
        return;
      case "hint":
        options.hint();
        return;
      case "requestExit":
        exit.request(options.turnActive() || !options.interactive ? EXIT.interrupted : EXIT.ok);
        return;
      case "forceExit":
        exit.force(EXIT.interrupted);
        return;
      default:
        return assertNever(action, "CtrlCAction");
    }
  };
  const offs = [
    io.onSignal("SIGINT", onCtrlC),
    io.onSignal("SIGTERM", () => {
      exit.request(EXIT.terminated);
    }),
    io.onSignal("SIGHUP", () => {
      exit.request(EXIT.hangup);
    }),
  ];
  return {
    exit,
    onCtrlC,
    dispose() {
      for (const off of offs) off();
    },
  };
}
