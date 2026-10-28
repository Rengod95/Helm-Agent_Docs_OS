import type { Message } from "@xeon/contracts/conversation";
import type { CacheMarks, CachePolicy, CacheSite } from "@xeon/contracts/services";
import { COMPACTION_SUMMARY_PREFIX } from "./convert.ts";

// L1.context.spec §4.5, plan C-3. 정책(`CachePolicy.sites`)의 우선순위대로 표식 위치를 고르고 상한(`maxBreakpoints`)을 넘으면
// 뒤쪽 위치부터 버린다. 요청에 적용하는 일은 core-models가 한다.

function textOf(message: Message): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/** 컴팩션 요약 메시지의 인덱스. 없으면 -1 */
function summaryIndexOf(messages: readonly Message[]): number {
  return messages.findIndex(
    (message) => message.role === "user" && textOf(message).startsWith(COMPACTION_SUMMARY_PREFIX),
  );
}

/** 마지막 사용자 메시지 또는 마지막 system 메시지의 인덱스. 없으면 -1 */
function tailIndexOf(messages: readonly Message[]): number {
  return messages.findLastIndex((message) => message.role === "user" || message.role === "system");
}

/**
 * 표식 위치를 계산한다. `messages`는 volatile 메시지를 붙이기 전 최종 배열이다(volatile은 표식 뒤에 놓인다).
 * - system, tools: 인덱스 없이 표시만 한다(적용은 provider 어댑터).
 * - summary: 컴팩션 요약 메시지의 인덱스. 머리가 없으면 쓰지 않는다.
 * - tail: 마지막 사용자 또는 system 메시지. summary와 같은 메시지면 중복이라 쓰지 않는다.
 */
export function computeCacheMarks(policy: CachePolicy, messages: readonly Message[]): CacheMarks {
  const summary = summaryIndexOf(messages);
  const tail = tailIndexOf(messages);
  const marks: { site: CacheSite; messageIndex: number | null }[] = [];
  for (const site of policy.sites) {
    if (marks.length >= policy.maxBreakpoints) break;
    if (site === "system" || site === "tools") {
      marks.push({ site, messageIndex: null });
    } else if (site === "summary") {
      if (summary >= 0) marks.push({ site, messageIndex: summary });
    } else if (tail >= 0 && tail !== summary) {
      marks.push({ site, messageIndex: tail });
    }
  }
  return { policy, marks };
}
