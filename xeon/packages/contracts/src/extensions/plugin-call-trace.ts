// 가벼운 길(읽기 전용 기능 메서드, `capability-guard.ts`의 `light`)의 호출 추적 싱크(정본 docs/xeon/review/m5/turn-record-metrics.md §3.2 `PluginCallLine`, §4.3).
// X(ext-host)가 호출이 정해진 뒤 한 줄을 넘긴다. 읽기 전용 한 방향 호출이고 반환값은 호출 경로로 돌아가지 않는다.
// 턴은 가드가 모른다. 싱크를 받는 쪽(턴 기록)이 그 대화의 열린 턴에 붙인다. 인자 값은 싣지 않고 정규화 JSON의 SHA-256 hex만 싣는다.

import type { PluginCallVia } from "../capabilities/index.ts";

/** 가벼운 길의 플러그인 호출 한 건이 정해졌을 때의 사실 */
export interface PluginCallTraceEvent {
  /** 호출이 일어난 대화 */
  readonly threadId: string;
  /** 호출한 플러그인(확장 이름) */
  readonly plugin: string;
  /** 기능 id */
  readonly capability: string;
  /** 기능 메서드 이름 */
  readonly method: string;
  /** 인자 정규화 JSON의 SHA-256 hex(파이프라인의 argsHash와 같다). 인자가 JSON이 아니면 null. 원본 인자는 싣지 않는다 */
  readonly argsHash: string | null;
  /** 공급자 호출이 결과를 돌려주면 참, 거부되거나 던지면 거짓 */
  readonly ok: boolean;
  /** 호출을 시작해서 결과가 정해질 때까지의 시간(ms) */
  readonly ms: number;
  /** 호출이 시작된 길(`PluginCallRequest.via`와 같은 어휘) */
  readonly via: PluginCallVia;
  /** 바깥 도구 실행 안에서 불린 호출이면 그 도구 호출 id */
  readonly toolCallId: string | null;
}

/**
 * 가벼운 길의 호출 줄을 받는 싱크. 구현은 호출 경로의 값을 바꾸지 않는다. 실패는 호출자가 진단으로 흡수한다.
 * 싱크가 없으면 가드는 기록 값을 만들지도 않는다
 */
export interface PluginCallTraceSink {
  record(event: PluginCallTraceEvent): void;
}
