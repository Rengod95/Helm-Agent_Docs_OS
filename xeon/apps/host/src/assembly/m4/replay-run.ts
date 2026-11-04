import { assertNever, type Result } from "@fresnel/contracts";
import type { ExtensionManifest } from "@fresnel/contracts/extensions";
import type { DevkitError, ReplayFailure, ReplayReport } from "@fresnel/contracts/services";
import { runInstalledReplay } from "@fresnel/plugin-builder";

// 개발 모드 replay(W-29)의 실행 자리와 보고 변환. group-sdk `replayDrive`의 보고(`ReplayDriveReport`)를 와이어 `ReplayReport`로 옮긴다.
// 실행기(`ReplayRunner`)는 설치된 그룹을 실어 재생하는 쪽이다. 기본 실행기(`installedReplayRunner`)는 `@fresnel/plugin-builder`의
// `runInstalledReplay`다. 재생기가 `@fresnel/group-sdk/testing`을 쓰므로 운영 호스트 코드는 그 서브패스를 직접 import하지 않는다(DR-08).
// 그래서 보고 모양은 필요한 칸만 구조로 적는다.

interface ReplayRunCut {
  readonly commitIndex: number;
  readonly equal: boolean;
  readonly firstDiff: number | null;
}

/** `replayDrive`의 실패 이유 가운데 `thread-mismatch`까지 포함한다. 와이어에는 이 중 네 값만 있다 */
type ReplayRunFailure =
  | "max-commits-exceeded"
  | "no-commits"
  | "thread-mismatch"
  | "effects-doubled"
  | "effects-mismatch";

/** group-sdk `ReplayDriveReport`와 구조가 맞는 보고. 실행기는 이 모양을 돌려준다 */
export interface ReplayRunReport {
  readonly ok: boolean;
  readonly commits: number;
  readonly cuts: readonly ReplayRunCut[];
  readonly effects?: {
    readonly turn: number;
    readonly spawn: number;
    readonly delegate: number;
    readonly post: number;
  };
  readonly failure?: ReplayRunFailure;
}

export interface ReplayRunInput {
  /** 설치된 확장 이름 */
  readonly target: string;
  /** 설치된 확장 폴더의 절대 경로 */
  readonly dir: string;
  /** 설치된 매니페스트(`group`이 있는 것만 넘어온다) */
  readonly manifest: ExtensionManifest;
  /** 기준 실행의 커밋 수 상한(1~1000) */
  readonly maxCommits: number;
}

/**
 * 설치된 그룹을 실어 재생한다. 실행 자체가 실패하면(그룹을 싣지 못함, 던짐) `err`이고, 재생이 끝났으면 `ok`의 보고다
 * (통과든 실패든). 포트는 실행기를 바꿔 끼울 수 있다(시험). 기본은 `installedReplayRunner`다.
 */
export interface ReplayRunner {
  run(input: ReplayRunInput): Promise<Result<ReplayRunReport, DevkitError>>;
}

/** 기본 실행기: 설치 폴더를 `runInstalledReplay`로 재생한다. 구조가 `ReplayRunReport`와 같아 값을 그대로 넘긴다 */
export const installedReplayRunner: ReplayRunner = {
  run: (input) => runInstalledReplay({ dir: input.dir, maxCommits: input.maxCommits }),
};

/** 와이어 failure로 옮긴다. `thread-mismatch`는 와이어에 값이 없어 null로 둔다(아래 주석) */
function failureOf(failure: ReplayRunFailure | undefined): ReplayFailure | null {
  switch (failure) {
    case undefined:
      return null;
    case "effects-doubled":
    case "effects-mismatch":
    case "max-commits-exceeded":
    case "no-commits":
      return failure;
    case "thread-mismatch":
      // 와이어 failure에 이 값이 없다. 실패는 `ok: false`로만 드러난다. 칸은 모두 같을 수 있어(`equal`) 칸만 봐서는 보이지 않는다
      return null;
    default:
      return assertNever(failure, "ReplayRunFailure");
  }
}

/** 실행 보고를 와이어 `ReplayReport`로 옮긴다. `passed`는 같은 칸의 수, `firstDiff`는 처음 다른 칸의 값이다. 효과가 없으면 0이다 */
export function replayReportOf(run: ReplayRunReport): ReplayReport {
  const cuts = run.cuts.map((cut) => ({
    commitIndex: cut.commitIndex,
    equal: cut.equal,
    firstDiff: cut.firstDiff,
  }));
  const firstDiff = cuts.find((cut) => cut.firstDiff !== null)?.firstDiff ?? null;
  return {
    ok: run.ok,
    commits: run.commits,
    passed: cuts.filter((cut) => cut.equal).length,
    firstDiff,
    cuts,
    effects: run.effects ?? { turn: 0, spawn: 0, delegate: 0, post: 0 },
    failure: failureOf(run.failure),
  };
}
