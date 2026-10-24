import type { JsonValue } from "@xeon/contracts/conversation";
import type { GroupModule } from "../../types.ts";

/**
 * 그룹 테스트 파일이 만든다. 호스트·테이프·정규화는 하니스 안에 있다
 * (다른 패키지의 testing 서브패스는 테스트 파일만 import한다. DR-08, review.decisions-2 U-17).
 */
export interface ReplayHarness {
  /**
   * 새 테스트 호스트에 그룹 하나를 holder로 올린다. restore가 null이면 처음부터,
   * 값이 있으면 그 이벤트열의 앞 commits개 커밋만 복원하고 재개 절차로 시작한다. 같은 테이프로 끝까지 실행한다.
   * events는 복원한 앞부분을 포함한 전체 내구 이벤트열이다
   */
  run(
    group: GroupModule,
    restore: { readonly events: readonly JsonValue[]; readonly commits: number } | null,
  ): Promise<{ readonly events: readonly JsonValue[]; readonly commitPoints: readonly number[] }>;
  /** 정규화한 이벤트열의 digest. 같은 의미면 같은 문자열 */
  digest(events: readonly JsonValue[]): string;
  /** 두 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  firstDiff(a: readonly JsonValue[], b: readonly JsonValue[]): number | null;
}

/** M2 최소형. 지점 목록 지정, 사용자 입력 시작은 M3(G-20)에서 더한다 */
export interface ReplayDriveOptions {
  readonly group: GroupModule;
  readonly harness: ReplayHarness;
  /** 기준 실행의 커밋 수 상한. 넘으면 실패한다. 기본 200 */
  readonly maxCommits?: number;
}

export interface ReplayCut {
  /** 앞에서 몇 개의 커밋을 복원했는가(1부터) */
  readonly commitIndex: number;
  readonly equal: boolean;
  /** 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  readonly firstDiff: number | null;
  readonly digest: string;
}

export interface ReplayDriveReport {
  readonly commits: number;
  readonly baselineDigest: string;
  readonly cuts: readonly ReplayCut[];
  readonly ok: boolean;
  /** ok가 false인데 절단 비교가 아닌 이유가 있으면 채운다: 커밋 수 초과, 커밋 0개 */
  readonly failure?: "max-commits-exceeded" | "no-commits";
}

const DEFAULT_MAX_COMMITS = 200;

/**
 * drive 재생 규율 검사(L3.group-kit.spec §3.10, eng.events.design EV-09).
 * 기준 실행의 모든 커밋 지점에서 프로세스를 끊은 것처럼 앞부분만 복원해 다시 실행하고 같은 이벤트열이 나오는지 본다.
 * 협조적 코드만 잡는 한계가 있다. 커밋이 하나도 없는 실행은 확인할 것이 없으므로 실패로 본다.
 */
export async function replayDrive(options: ReplayDriveOptions): Promise<ReplayDriveReport> {
  const { group, harness } = options;
  const baseline = await harness.run(group, null);
  const baselineDigest = harness.digest(baseline.events);
  const commits = baseline.commitPoints.length;
  if (commits > (options.maxCommits ?? DEFAULT_MAX_COMMITS)) {
    return { commits, baselineDigest, cuts: [], ok: false, failure: "max-commits-exceeded" };
  }
  if (commits === 0) return { commits, baselineDigest, cuts: [], ok: false, failure: "no-commits" };

  const cutAt = async (commitIndex: number): Promise<ReplayCut> => {
    const rerun = await harness.run(group, { events: baseline.events, commits: commitIndex });
    const digest = harness.digest(rerun.events);
    const equal = digest === baselineDigest;
    return {
      commitIndex,
      equal,
      firstDiff: equal ? null : harness.firstDiff(baseline.events, rerun.events),
      digest,
    };
  };
  const cuts = await cutsFrom(1, commits, cutAt, []);
  return { commits, baselineDigest, cuts, ok: cuts.every((cut) => cut.equal) };
}

/** 지점을 차례로 실행한다. 한 호스트씩 만들고 버리므로 병렬로 돌리지 않는다 */
async function cutsFrom(
  next: number,
  last: number,
  cutAt: (commitIndex: number) => Promise<ReplayCut>,
  done: readonly ReplayCut[],
): Promise<readonly ReplayCut[]> {
  if (next > last) return done;
  const cut = await cutAt(next);
  return cutsFrom(next + 1, last, cutAt, [...done, cut]);
}
