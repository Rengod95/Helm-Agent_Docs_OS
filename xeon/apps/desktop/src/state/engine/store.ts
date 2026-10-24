// src/state/engine/store.ts
import type { Clock, Logger } from "@xeon/contracts";
import { createStore } from "zustand/vanilla";
import type { FrameClock } from "../shared/frame.ts";
import type { Journal } from "../shared/journal.ts";
import {
  guardStage,
  invariantStage,
  journalStage,
  pipeline,
  type Stage,
} from "../shared/pipeline.ts";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";
import { describeInput, journalLabel } from "./describe.ts";
import type { MirrorInput } from "./input.ts";
import { checkMirror } from "./invariants.ts";
import { enterReset, MAX_SYNC_ATTEMPTS, reduceMirror, type ApplyNote } from "./reduce.ts";
import { INITIAL_MIRROR, type EngineMirror } from "./state.ts";

export type EngineStoreDeps = {
  readonly clock: Clock;
  readonly frames: FrameClock;
  readonly logger: Logger;
  readonly journal: Journal<ApplyNote>;
  /** 개발·시험 빌드에서 true. 불변식 검사 단계를 넣는다 */
  readonly checks: boolean;
  /** 경과 시간 측정용 단조 시계(ms). 운영은 performance.now */
  readonly monotonic: () => number;
  /** 시험은 rethrow를 넘겨 reducer 실패를 드러낸다. 운영은 기록만 한다 */
  readonly onReducerFailure?: (cause: unknown) => void;
};

export interface EngineStore {
  readonly read: ReadonlyStore<EngineMirror>;
  /** 연결 컨트롤러만 부른다. 다음 프레임에 모아서 한 번 커밋한다 */
  ingest(input: MirrorInput): void;
  /** 대기 중인 입력을 지금 커밋한다(시험, thread 전환 직전) */
  flush(): void;
}

/** 이 시간 안에 reducer가 MAX_SYNC_ATTEMPTS번을 넘어 던지면 재설정을 멈추고 failed로 둔다 */
const REDUCER_FAILURE_WINDOW_MS = 60_000;

/** 델타만 있던 커밋이 이 시간(ms)보다 오래 걸렸을 때만 journal에 flush 항목을 남긴다 */
const SLOW_COMMIT_MS = 8;

export function createEngineStore(deps: EngineStoreDeps): EngineStore {
  const api = createStore<EngineMirror>()(() => INITIAL_MIRROR);
  // 재설정에 성공해도 같은 입력이 다시 던지면 link의 attempt가 사라진다. 그래서 던진 시각을 따로 센다
  const failedAt: number[] = [];
  const recover = (
    state: EngineMirror,
  ): { readonly state: EngineMirror; readonly note: ApplyNote } => {
    const now = deps.clock.now();
    failedAt.push(now);
    while (failedAt.length > 0 && now - (failedAt[0] ?? now) > REDUCER_FAILURE_WINDOW_MS)
      failedAt.shift();
    return failedAt.length > MAX_SYNC_ATTEMPTS
      ? { state: { ...state, link: { phase: "failed", reason: "reducer_failed" } }, note: "failed" }
      : { state: enterReset(state, "reducer_failed"), note: "failed" };
  };
  const stages: Stage<EngineMirror, MirrorInput, ApplyNote>[] = [
    journalStage(deps.journal, deps.clock, journalLabel),
    guardStage<EngineMirror, MirrorInput, ApplyNote>(recover, (cause, input) => {
      deps.logger.error("desktop.mirror.reduce_failed", {
        input: describeInput(input).input,
        error: cause instanceof Error ? cause.name : "unknown",
      });
      deps.onReducerFailure?.(cause);
    }),
  ];
  if (deps.checks) stages.push(invariantStage(checkMirror));
  const reduce = pipeline(reduceMirror, stages);

  let queue: MirrorInput[] = [];
  let cancel: (() => void) | undefined;

  const commit = (): void => {
    cancel = undefined;
    const inputs = queue;
    queue = [];
    if (inputs.length === 0) return;
    const started = deps.monotonic();
    const before = api.getState();
    let state = before;
    for (const input of inputs) state = reduce(state, input).state;
    if (state !== before) api.setState(state, true);
    const ms = deps.monotonic() - started;
    // 델타만 있는 빠른 커밋은 프레임마다 생긴다. 모두 남기면 17초 만에 1,000칸이 차서 중요한 항목이 밀려난다
    if (ms > SLOW_COMMIT_MS || inputs.some((input) => input.type !== "chunk")) {
      deps.journal.record({ kind: "flush", at: deps.clock.now(), count: inputs.length, ms });
    }
  };

  return {
    read: readonlyView(api),
    ingest(input) {
      queue.push(input);
      cancel ??= deps.frames.request(commit);
    },
    flush() {
      cancel?.();
      commit();
    },
  };
}
