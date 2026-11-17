import type { HookRun, TurnElided, TurnRecord } from "@fresnel/contracts/wire";

// 턴 기록 한 건의 크기 상한(정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.1 규칙 8, `x.operations.trace.maxTurnBytes`).
// 순수 함수다. 넘으면 아래 순서로 줄이고, 줄일 때마다 센 수를 `elided`에 더한다.
//   1. 재료의 `ref` 문자열을 `REF_SHRINK_CHARS` 글자로 자른다
//   2. `Advertised.tools`를 비운다
//   3. 훅의 `decisionText`를 비운다
//   4. 결과가 `passed`인 훅 행을 오래된 것부터 뺀다(이진 탐색으로 최소 개수를 정한다)
//   5. 그래도 넘으면 단계를 비우고 요약으로 바꾼다. 요약은 `complete: false`다. 단계 행은 `tr_step`에 그대로 있다

/** `x.operations.trace.maxTurnBytes`의 기본값(바이트). 설정 키의 기본과 같다 */
export const DEFAULT_MAX_TURN_BYTES = 262_144;

/** 재료 `ref`를 자를 때의 글자 수 */
export const REF_SHRINK_CHARS = 32;

export interface FittedRecord {
  readonly record: TurnRecord;
  readonly json: string;
  readonly bytes: number;
  /** 줄이기 5단계로 요약을 썼다. 이때 턴은 불완전하다 */
  readonly summarized: boolean;
}

function jsonOf(record: TurnRecord): { readonly json: string; readonly bytes: number } {
  const json = JSON.stringify(record);
  return { json, bytes: new TextEncoder().encode(json).byteLength };
}

/** 셈을 `elided`에 더한다. 0이면 칸을 만들지 않는다(기존 `elided` 표기와 같다) */
function addElided(elided: TurnElided, key: keyof TurnElided, count: number): TurnElided {
  if (count === 0) return elided;
  return { ...elided, [key]: (elided[key] ?? 0) + count };
}

function allHooks(record: TurnRecord): HookRun[] {
  return [...record.steps.flatMap((step) => step.hooks), ...record.turnHooks];
}

/** 지정한 훅 실행(객체 식별)을 뺀 기록. 단계 안의 것과 턴 밖의 것 모두 본다 */
function withoutHooks(record: TurnRecord, removed: ReadonlySet<HookRun>): TurnRecord {
  return {
    ...record,
    steps: record.steps.map((step) => ({
      ...step,
      hooks: step.hooks.filter((hook) => !removed.has(hook)),
    })),
    turnHooks: record.turnHooks.filter((hook) => !removed.has(hook)),
  };
}

/** 상한 안에 드는 기록을 돌려준다. 이미 들면 그대로 둔다 */
export function fitTurnRecord(record: TurnRecord, maxBytes: number): FittedRecord {
  const first = jsonOf(record);
  if (first.bytes <= maxBytes) {
    return { record, json: first.json, bytes: first.bytes, summarized: false };
  }
  const fits = (candidate: TurnRecord): boolean => jsonOf(candidate).bytes <= maxBytes;

  // 1. 재료의 ref
  let shrunkRefs = 0;
  let current: TurnRecord = {
    ...record,
    steps: record.steps.map((step) => ({
      ...step,
      materials: step.materials.map((material) => {
        if (material.ref.length <= REF_SHRINK_CHARS) return material;
        shrunkRefs += 1;
        return { ...material, ref: material.ref.slice(0, REF_SHRINK_CHARS) };
      }),
    })),
    elided: addElided(record.elided, "materials", shrunkRefs),
  };
  if (fits(current)) return finish(current, false);

  // 2. 광고한 도구 목록
  const droppedTools = current.steps.reduce((sum, step) => sum + step.advertised.tools.length, 0);
  current = {
    ...current,
    steps: current.steps.map((step) => ({
      ...step,
      advertised: { ...step.advertised, tools: [] },
    })),
    elided: addElided(current.elided, "tools", droppedTools),
  };
  if (fits(current)) return finish(current, false);

  // 3. 훅의 결정 문구
  let clearedTexts = 0;
  const clearText = (hook: HookRun): HookRun => {
    if (hook.decisionText === null) return hook;
    clearedTexts += 1;
    return { ...hook, decisionText: null };
  };
  current = {
    ...current,
    steps: current.steps.map((step) => ({ ...step, hooks: step.hooks.map(clearText) })),
    turnHooks: current.turnHooks.map(clearText),
  };
  current = { ...current, elided: addElided(current.elided, "hooks", clearedTexts) };
  if (fits(current)) return finish(current, false);

  // 4. 결과가 passed인 훅 행을 오래된 것부터. 개수는 이진 탐색으로 정한다(뺄수록 작아진다)
  const passed = allHooks(current)
    .filter((hook) => hook.result === "passed")
    .toSorted((a, b) => a.atMs - b.atMs);
  const without = (count: number): TurnRecord =>
    withoutHooks(current, new Set(passed.slice(0, count)));
  let low = 0;
  let high = passed.length;
  if (fits(without(high))) {
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(without(middle))) high = middle;
      else low = middle + 1;
    }
    current = without(low);
    current = { ...current, elided: addElided(current.elided, "hooks", low) };
    return finish(current, false);
  }
  current = without(passed.length);
  current = { ...current, elided: addElided(current.elided, "hooks", passed.length) };

  // 5. 요약. 단계와 턴 밖 훅을 비우고 센 수를 남긴다
  const hooksLeft = allHooks(current).length;
  const callsLeft = current.steps.reduce((sum, step) => sum + step.calls.length, 0);
  const materialsLeft = current.steps.reduce((sum, step) => sum + step.materials.length, 0);
  const summary: TurnRecord = {
    ...current,
    steps: [],
    turnHooks: [],
    complete: false,
    elided: addElided(
      addElided(addElided(current.elided, "hooks", hooksLeft), "calls", callsLeft),
      "materials",
      materialsLeft,
    ),
  };
  return finish(summary, true);
}

function finish(record: TurnRecord, summarized: boolean): FittedRecord {
  const { json, bytes } = jsonOf(record);
  return { record, json, bytes, summarized };
}
