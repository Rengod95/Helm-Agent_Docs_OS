import type { JsonValue } from "@xeon/contracts/conversation";
import type { GroupModule } from "../../types.ts";

/**
 * 가짜 포트가 센 외부 효과 수(L3.group-kit.spec §3.10, ADR-0015 §3.6). 중복 응답(`duplicate`, 재생된 `loop.turn`·`loop.spawn`,
 * 처음 결과를 돌려준 멱등 능력 호출)과 읽기 호출은 세지 않는다
 */
export interface EffectCounts {
  readonly turn: number;
  readonly spawn: number;
  readonly delegate: number;
  /** `idempotent: true` 능력 메서드의 새 효과 수 */
  readonly capabilityWrite: number;
  readonly post: number;
}

export const NO_EFFECTS: EffectCounts = {
  turn: 0,
  spawn: 0,
  delegate: 0,
  capabilityWrite: 0,
  post: 0,
};

const EFFECT_KINDS: readonly (keyof EffectCounts)[] = [
  "turn",
  "spawn",
  "delegate",
  "capabilityWrite",
  "post",
];

/** 효과 수 두 값을 항목마다 더하거나 뺀다. 계수기 둘을 합칠 때와 실행 사이의 증가분을 낼 때 쓴다 */
export function diffEffects(after: EffectCounts, before: EffectCounts): EffectCounts {
  return {
    turn: after.turn - before.turn,
    spawn: after.spawn - before.spawn,
    delegate: after.delegate - before.delegate,
    capabilityWrite: after.capabilityWrite - before.capabilityWrite,
    post: after.post - before.post,
  };
}

/** 효과가 하나라도 난 항목의 이름. 보고 메시지에 쓴다 */
export function effectKindsOf(counts: EffectCounts): readonly (keyof EffectCounts)[] {
  return EFFECT_KINDS.filter((kind) => counts[kind] !== 0);
}

/**
 * 그룹 테스트 파일이 만든다. 호스트·테이프·정규화는 하니스 안에 있다
 * (다른 패키지의 testing 서브패스는 테스트 파일만 import한다. DR-08, review.decisions-2 U-17).
 */
export interface ReplayHarness {
  /**
   * 새 테스트 호스트에 그룹 하나를 holder로 올린다. restore가 null이면 처음부터,
   * 값이 있으면 그 이벤트열의 앞 commits개 커밋만 복원하고 재개 절차로 시작한다. 같은 테이프로 끝까지 실행한다.
   * events는 복원한 앞부분을 포함한 전체 내구 이벤트열이다.
   * effects는 효과 계수기를 가진 하니스만 채운다(M3, G-20): 이 실행이 새로 낸 효과 수다. 복원 실행(restore가 있는 호출)은
   * 기준 실행과 같은 가짜 포트의 멱등 기억을 이어 써야 하고, 그러면 같은 상태·입력의 재실행은 새 효과가 0이다
   */
  run(
    group: GroupModule,
    restore: { readonly events: readonly JsonValue[]; readonly commits: number } | null,
  ): Promise<{
    readonly events: readonly JsonValue[];
    readonly commitPoints: readonly number[];
    readonly effects?: EffectCounts;
  }>;
  /** 정규화한 이벤트열의 digest. 같은 의미면 같은 문자열 */
  digest(events: readonly JsonValue[]): string;
  /** 두 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  firstDiff(a: readonly JsonValue[], b: readonly JsonValue[]): number | null;
}

/** 지점 목록 지정, 사용자 입력 시작은 아직 없다(G-20 남은 몫) */
export interface ReplayDriveOptions {
  readonly group: GroupModule;
  readonly harness: ReplayHarness;
  /** 기준 실행의 커밋 수 상한. 넘으면 실패한다. 기본 200 */
  readonly maxCommits?: number;
  /**
   * 기준 실행의 효과 수가 이 값과 같은지 확인한다(주어진 항목만). 하니스가 `effects`를 채워야 한다.
   * 다르면 `effects-mismatch`다. 효과가 정확히 한 번 났다는 확인에 쓴다
   */
  readonly expectEffects?: Partial<EffectCounts>;
}

export interface ReplayCut {
  /** 앞에서 몇 개의 커밋을 복원했는가(1부터) */
  readonly commitIndex: number;
  readonly equal: boolean;
  /** 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  readonly firstDiff: number | null;
  readonly digest: string;
  /** 이 절단 실행이 새로 낸 효과 수. 하니스가 계수기를 가진 경우만 */
  readonly effects?: EffectCounts;
}

export interface ReplayDriveReport {
  readonly commits: number;
  readonly baselineDigest: string;
  readonly cuts: readonly ReplayCut[];
  readonly ok: boolean;
  /** 기준 실행의 효과 수. 하니스가 계수기를 가진 경우만 */
  readonly effects?: EffectCounts;
  /**
   * ok가 false인데 절단 비교가 아닌 이유가 있으면 채운다: 커밋 수 초과, 커밋 0개,
   * 이벤트열은 같은데 절단 실행이 새 효과를 냈다(`effects-doubled`), 기준 효과 수가 `expectEffects`와 다르다(`effects-mismatch`)
   */
  readonly failure?: "max-commits-exceeded" | "no-commits" | "effects-doubled" | "effects-mismatch";
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
  const withEffects = baseline.effects === undefined ? {} : { effects: baseline.effects };
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
      ...(rerun.effects === undefined ? {} : { effects: rerun.effects }),
    };
  };
  const cuts = await cutsFrom(1, commits, cutAt, []);
  const eventsOk = cuts.every((cut) => cut.equal);
  const failure = eventsOk
    ? effectFailureOf(baseline.effects, cuts, options.expectEffects)
    : undefined;
  return {
    commits,
    baselineDigest,
    cuts,
    ok: eventsOk && failure === undefined,
    ...withEffects,
    ...(failure === undefined ? {} : { failure }),
  };
}

/**
 * 효과 계수 확인(ADR-0015 §3.6). 이벤트열이 같아도 절단 실행이 새 효과를 냈으면 재생이 효과를 두 번 낸 것이다.
 * 기준 효과 수 확인은 하니스가 계수기를 주었을 때만 한다
 */
function effectFailureOf(
  baseline: EffectCounts | undefined,
  cuts: readonly ReplayCut[],
  expected: Partial<EffectCounts> | undefined,
): "effects-doubled" | "effects-mismatch" | undefined {
  if (cuts.some((cut) => cut.effects !== undefined && effectKindsOf(cut.effects).length > 0)) {
    return "effects-doubled";
  }
  if (expected === undefined || baseline === undefined) return undefined;
  const mismatch = EFFECT_KINDS.some((kind) => {
    const want = expected[kind];
    return want !== undefined && baseline[kind] !== want;
  });
  return mismatch ? "effects-mismatch" : undefined;
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
