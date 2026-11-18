// 턴 기록이 받는 읽기 전용 싱크(정본 docs/xeon/review/m5/turn-record-metrics.md §8 cap-knowledge 행, §4.5 규칙 29).
// 플러그인(P층)은 턴 기록 수집기를 import하지 않으므로 이 포트로만 알린다. 한 방향 호출이고 반환값은 호출 경로로 돌아가지 않는다.
// 턴은 플러그인이 모른다. 수집기가 그 대화의 열린 턴에 붙인다(가벼운 길의 `PluginCallTraceSink`와 같은 방식).
// 색인과 기억 블록의 내용은 싣지 않는다. 이름, 수, 어림 토큰만 싣는다.

/** 턴 기록에 알리는 사건. 대화 id와 소유 이름, 그리고 블록이 요청에 실린 사실만 담는다 */
export type TurnBlockEvent =
  | {
      readonly kind: "skill_index";
      /** 블록을 실은 대화 */
      readonly threadId: string;
      /** 소유 이름(기능 id 앞 이름. 조립의 `pluginOfCapability`와 같은 규칙) */
      readonly plugin: string;
      /** 색인에 실린 스킬 이름(싣는 순서) */
      readonly listed: readonly string[];
      /** 예산 때문에 싣지 못한 스킬 수 */
      readonly omitted: number;
      /** 색인 블록 전체의 어림 토큰(글자 수 / 4 올림) */
      readonly tokens: number;
    }
  | {
      readonly kind: "memory";
      readonly threadId: string;
      readonly plugin: string;
      /** 기억 스냅샷 블록의 어림 토큰(글자 수 / 4 올림) */
      readonly tokens: number;
    };

/**
 * 턴 기록 싱크. 구현은 호출 경로의 값을 바꾸지 않는다. 실패는 호출자가 진단으로 흡수한다.
 * 싱크가 없으면 호출자는 아무것도 알리지 않는다
 */
export interface TurnRecordSink {
  record(event: TurnBlockEvent): void;
}
