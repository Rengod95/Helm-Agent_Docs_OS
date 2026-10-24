import type { EventId, Message, TurnId, Usage } from "@xeon/contracts/conversation";

// L1.context.spec §3.2, §4.6 2번, plan C-4. pi compaction.ts의 컷 포인트 계산(findValidCutPoints, findCutPoint,
// isCutPointMessage, isTurnStartMessage)을 session-manager 타입 없이 포크했다. 입력은 컴팩션 후보 목록이고
// 턴 시작 판정은 turnId 비교로 바꿨다. 토큰 추정은 주입한다(xeon.models.tokens).

/** 컷 후보 하나. 이벤트 하나가 모델에 보이는 메시지 조각이다 */
export interface CutCandidate {
  /** 이 항목부터 남기면 firstKeptEventId가 되는 이벤트 */
  readonly eventId: EventId;
  readonly kind: "user" | "assistant" | "custom" | "toolResult" | "system";
  readonly turnId: TurnId | null;
  readonly messages: readonly Message[];
  /** assistant만 */
  readonly usage: Usage | null;
}

export interface CutPointResult {
  readonly firstKeptIndex: number;
  /** 분할 턴이 아니면 -1 */
  readonly turnStartIndex: number;
  readonly isSplitTurn: boolean;
}

/** 컷이 놓일 수 있는 항목: user, assistant, custom. toolResult는 호출 뒤에 붙어야 하므로 아니고 system은 메시지가 아니다 */
function isCutKind(candidate: CutCandidate): boolean {
  return candidate.kind === "user" || candidate.kind === "assistant" || candidate.kind === "custom";
}

/**
 * 턴 시작 항목: user나 custom은 항상 시작이다. assistant는 같은 turnId의 앞 항목이 없을 때(승인 뒤 재개처럼 사용자
 * 메시지 없이 시작한 턴) 시작이다. turnId가 null인 항목은 앞 항목과 비교할 수 없어 user·custom만 시작으로 본다
 */
function isTurnStart(candidates: readonly CutCandidate[], index: number): boolean {
  const candidate = candidates[index];
  if (candidate === undefined) return false;
  if (candidate.kind === "user" || candidate.kind === "custom") return true;
  if (candidate.kind !== "assistant" || candidate.turnId === null) return false;
  return candidates[index - 1]?.turnId !== candidate.turnId;
}

function findTurnStartIndex(candidates: readonly CutCandidate[], from: number): number {
  for (let index = from; index >= 0; index -= 1) {
    if (isTurnStart(candidates, index)) return index;
  }
  return -1;
}

/** assistant 항목이 부른 도구 호출 id 목록 */
function toolCallIds(candidate: CutCandidate): readonly string[] {
  return candidate.messages.flatMap((message) =>
    message.role === "assistant"
      ? message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []))
      : [],
  );
}

/** 컷 뒤에 남는 도구 결과 가운데 호출이 컷 앞에 있는 것(고아)이 있는지 */
function orphansAt(candidates: readonly CutCandidate[], cutIndex: number): boolean {
  const calledBefore = new Set(candidates.slice(0, cutIndex).flatMap(toolCallIds));
  return candidates
    .slice(cutIndex)
    .some((candidate) =>
      candidate.messages.some(
        (message) => message.role === "toolResult" && calledBefore.has(message.toolCallId),
      ),
    );
}

/**
 * 뒤에서부터 토큰을 누적하다가 `keepRecentTokens` 이상이면 멈춘다. 컷은 그 위치 이후 첫 후보이고, 없으면 마지막 후보다.
 * 토큰 0 항목은 건너뛴다. 후보가 없으면 첫 항목을 컷으로 둔다(남기는 것이 전부).
 * 컷 뒤에 도구 호출이 컷 앞에 있는 결과가 남으면(사용자 끼어들기) 다음 후보로 옮기고, 더 없으면 그 호출 항목으로 당긴다
 */
export function findCutPoint(
  candidates: readonly CutCandidate[],
  keepRecentTokens: number,
  estimate: (message: Message) => number,
): CutPointResult {
  const cutPoints: number[] = [];
  candidates.forEach((candidate, index) => {
    if (isCutKind(candidate)) cutPoints.push(index);
  });
  const first = cutPoints[0];
  if (first === undefined) return { firstKeptIndex: 0, turnStartIndex: -1, isSplitTurn: false };

  let accumulated = 0;
  let cutIndex = first;
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const tokens = candidate.messages.reduce((sum, message) => sum + estimate(message), 0);
    if (tokens === 0) continue;
    accumulated += tokens;
    if (accumulated >= keepRecentTokens) {
      cutIndex = cutPoints.find((point) => point >= i) ?? cutPoints[cutPoints.length - 1] ?? first;
      break;
    }
  }

  if (orphansAt(candidates, cutIndex)) {
    const later = cutPoints.find((point) => point > cutIndex && !orphansAt(candidates, point));
    if (later !== undefined) {
      cutIndex = later;
    } else {
      const earlier = cutPoints.findLast(
        (point) => point < cutIndex && !orphansAt(candidates, point),
      );
      if (earlier !== undefined) cutIndex = earlier;
    }
  }

  const startsTurn = isTurnStart(candidates, cutIndex);
  const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(candidates, cutIndex);
  return {
    firstKeptIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !startsTurn && turnStartIndex !== -1,
  };
}
