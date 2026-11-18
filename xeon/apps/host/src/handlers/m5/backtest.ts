import { assertNever } from "@fresnel/contracts";
import { wireError, type WireError, type WireHandlers } from "@fresnel/contracts/wire";
import type { BacktestPort } from "../../assembly/backtest/service.ts";
import type { Engine } from "../../types.ts";

// 지난 턴에 돌려 보기의 처리기(turn-record-metrics.md §3.5, §4.8). `backtest.run`, `status`, `result`, `cancel` 네 개다.
// 실행과 결과는 `engine.ports.backtest`(서비스)가 가진다. 처리기는 서비스가 돌려준 값을 그대로 옮기고 실패만 wire 오류로 바꾼다.
// 예상할 수 있는 실패(후보 없음, 훅, 격리, 바쁨, 없는 실행, 커서)는 모두 wire 오류다. 알림 `backtest.progress`는 `events.ts`가 보낸다.

/** 이 처리기가 채우는 메서드 */
export type BacktestMethods =
  | "backtest.run"
  | "backtest.status"
  | "backtest.result"
  | "backtest.cancel";

/** 실행을 시작하지 못한 이유. 서비스 포트의 실패 값에서 꺼낸다(서비스가 이 타입을 내보내지 않는다) */
type RunStartFailure = Extract<Awaited<ReturnType<BacktestPort["run"]>>, { ok: false }>["error"];
/** 결과 쪽을 읽지 못한 이유(없는 실행이나 맞지 않는 커서) */
type ResultFailure = Extract<ReturnType<BacktestPort["result"]>, { ok: false }>["error"];

function wireErrorOfRunStart(failure: RunStartFailure): WireError {
  switch (failure.kind) {
    case "candidate_not_found":
      return wireError("backtest.candidateNotFound", { message: failure.message });
    case "hook_not_replayable":
      return wireError("backtest.hookNotReplayable");
    case "isolation_unavailable":
      return wireError("backtest.isolationUnavailable");
    case "busy":
      return wireError("backtest.busy");
    default:
      return assertNever(failure, "BacktestRunStartFailure");
  }
}

function wireErrorOfResultRead(failure: ResultFailure): WireError {
  switch (failure.kind) {
    case "run_not_found":
      return wireError("backtest.runNotFound");
    case "invalid_cursor":
      return wireError("jsonrpc.invalidParams", {
        details: {
          issues: [
            { path: "cursor", message: "cursor must be a next value from a previous response" },
          ],
        },
      });
    default:
      return assertNever(failure, "BacktestResultFailure");
  }
}

/** 돌려 보기 처리기. 메서드 하나가 서비스 포트 메서드 하나다 */
export function createBacktestHandlers(engine: Engine): Pick<WireHandlers, BacktestMethods> {
  const port = engine.ports.backtest;
  return {
    "backtest.run": async (params) => {
      const started = await port.run(params);
      if (!started.ok) throw wireErrorOfRunStart(started.error);
      return started.value;
    },

    "backtest.status": (params) => {
      const found = port.status(params.runId);
      if (!found.ok) return Promise.reject(wireError("backtest.runNotFound"));
      return Promise.resolve(found.value);
    },

    "backtest.result": (params) => {
      const read = port.result(params.runId, params.cursor);
      if (!read.ok) return Promise.reject(wireErrorOfResultRead(read.error));
      return Promise.resolve(read.value);
    },

    "backtest.cancel": (params) => {
      const cancelled = port.cancel(params.runId);
      if (!cancelled.ok) return Promise.reject(wireError("backtest.runNotFound"));
      return Promise.resolve({});
    },
  };
}
