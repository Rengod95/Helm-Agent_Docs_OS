import { classifyTurnFailure } from "@fresnel/client";
import { parseModelRef } from "@fresnel/contracts/services";
import type { ThreadSummary } from "@fresnel/contracts/wire";

// 403(권한 없음)으로 실패한 모델을 이 앱 실행 동안 기억하는 판정. 입력창 모델 고르기가 그 행에 "이 키로 못 써요"를 단다.
// 턴이 도는 동안 쓰는 모델을 대화마다 시작 때 든다(턴 중에 고른 모델은 다음 턴부터 적용된다). 턴이 끝나면 403이면 기억하고,
// 실패가 없으면 성공으로 보고 지운다. 화면 없이 시험한다.
// 한계: 거울은 중단(`interrupted`)과 완료를 가르지 않아 중단된 턴도 성공으로 본다. 그때 표시가 한 번 사라질 수 있다.

/** 모델 참조를 `provider/modelId` 키로 바꾼다. 추론 레벨(`:high` 같은 끝)은 뗀다. 참조가 없거나 틀리면 null이다 */
export function modelKeyOf(ref: string | null): string | null {
  if (ref === null) return null;
  const parsed = parseModelRef(ref);
  return parsed.ok ? `${parsed.value.provider}/${parsed.value.modelId}` : null;
}

/** 도는 대화마다 턴 시작 때 쓴 모델 키(모르면 null). 지금 도는 대화만 든다 */
export type DenialTrack = Readonly<Record<string, string | null>>;

export interface DenialStep {
  readonly track: DenialTrack;
  /** 이번 걸음에 403으로 끝난 턴의 모델 키 */
  readonly denied: readonly string[];
  /** 이번 걸음에 실패 없이 끝난 턴의 모델 키 */
  readonly allowed: readonly string[];
}

/**
 * 대화 목록 한 걸음의 판정. 턴이 도는 대화는 시작 때 모델을 든다. 도는 대화가 멈추면 그 모델을 실패 문장으로 가른다.
 * 모델을 정하지 않은 대화는 기본 모델로 센다(`useThreadModel`과 같은 기준)
 */
export function denialStepOf(input: {
  readonly track: DenialTrack;
  readonly threads: readonly Pick<ThreadSummary, "threadId" | "status" | "model">[];
  readonly failures: Readonly<Record<string, string>>;
  readonly defaultModel: string | null;
}): DenialStep {
  const track: Record<string, string | null> = {};
  const denied: string[] = [];
  const allowed: string[] = [];
  for (const thread of input.threads) {
    const id = thread.threadId;
    if (thread.status === "running") {
      // 이미 든 대화는 시작 때 값을 그대로 둔다. 처음 보는 도는 대화는 지금 모델을 든다
      const known: string | null | undefined = input.track[id];
      track[id] = known === undefined ? modelKeyOf(thread.model ?? input.defaultModel) : known;
      continue;
    }
    const started: string | null | undefined = input.track[id];
    if (started === undefined || started === null) continue;
    const failure: string | undefined = input.failures[id];
    if (failure === undefined) allowed.push(started);
    else if (classifyTurnFailure(failure).kind === "permission_denied") denied.push(started);
  }
  return { track, denied, allowed };
}
