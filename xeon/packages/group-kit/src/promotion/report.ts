import type { ToolName } from "@xeon/contracts/capabilities";
import type { GroupId, ScopeId } from "@xeon/contracts/extensions";

/** 한 도구를 한 scope가 호출한 집계(L3.group-kit.spec §3.12). 소유 그룹 밖의 scope만 든다 */
export interface ToolConsumer {
  /** 호출이 일어난 turn을 시작한 쪽. 임대 holder scope, 또는 위임·spawn 자식을 만든 scope */
  readonly scopeId: ScopeId;
  readonly calls: number;
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface PromotionCandidate {
  readonly tool: ToolName;
  readonly owner: GroupId;
  /** 소유 그룹을 뺀 소비자. scopeId 순 */
  readonly consumers: readonly ToolConsumer[];
  /** 그룹이 시작하지 않은 turn(사용자 입력 turn)에서의 호출 수. 소비자로 세지 않는다 */
  readonly userCalls: number;
  /** consumers가 1개 이상이면 참 */
  readonly candidate: boolean;
}

export interface PromotionReport {
  /** 집계에 쓴 마지막 이벤트 seq: 소유 그룹이 있는 도구의 호출 가운데 최대 seq. 호출이 없으면 0 */
  readonly throughSeq: number;
  /** 집계에 쓴 호출이 든 thread 수 */
  readonly threads: number;
  /** 소유 그룹이 있는 도구마다 하나씩, 도구 이름순 */
  readonly candidates: readonly PromotionCandidate[];
}

export interface PromotionInput {
  /** 도구 이름 → 등록한 그룹 [가정: X 리소스 등록부] */
  readonly toolOwners: ReadonlyMap<ToolName, GroupId>;
  /**
   * 도구 호출 하나마다 한 항목. `origin`은 그 호출의 turn을 시작한 scope이고, 사용자 입력 turn이면 `"user"`다.
   * `"user"`는 `ScopeId`(string)와 같은 타입이라 유니온으로 따로 적지 않는다(lint no-redundant-type-constituents).
   * 호출 이벤트와 turn 시작 이벤트의 해석은 `gatherPromotionInput`이 맡는다.
   */
  readonly calls: readonly {
    readonly tool: ToolName;
    readonly seq: number;
    readonly threadId: string;
    readonly origin: ScopeId;
  }[];
}

/** 사용자 입력 turn의 출처 표지(L3.group-kit.spec §3.12) */
const USER_ORIGIN = "user";

interface Tally {
  readonly scopeId: ScopeId;
  calls: number;
  firstSeq: number;
  lastSeq: number;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** 한 도구의 호출을 scope별로 센다. 소유 그룹 자신의 호출과 사용자 입력 호출은 소비자가 아니다 */
function consumersOf(calls: PromotionInput["calls"], owner: GroupId): readonly ToolConsumer[] {
  const tally = new Map<ScopeId, Tally>();
  for (const call of calls) {
    if (call.origin === USER_ORIGIN || call.origin === owner) continue;
    const current = tally.get(call.origin);
    if (current === undefined) {
      tally.set(call.origin, {
        scopeId: call.origin,
        calls: 1,
        firstSeq: call.seq,
        lastSeq: call.seq,
      });
    } else {
      current.calls += 1;
      current.firstSeq = Math.min(current.firstSeq, call.seq);
      current.lastSeq = Math.max(current.lastSeq, call.seq);
    }
  }
  return [...tally.values()].toSorted((left, right) => compareText(left.scopeId, right.scopeId));
}

/**
 * 그룹 전용 도구의 호출로 승격 후보를 고른다(L3.group-kit.spec §3.12). 순수 함수이고 시계와 저장소를 읽지 않는다.
 * 소유 그룹이 없는 도구의 호출은 어디에도 세지 않는다. 그래서 `throughSeq`와 `threads`도 소유 도구의 호출만 본다.
 */
export function buildPromotionReport(input: PromotionInput): PromotionReport {
  const owned = input.calls.filter((call) => input.toolOwners.has(call.tool));
  const owners = [...input.toolOwners.entries()].toSorted(([left], [right]) =>
    compareText(left, right),
  );
  const candidates = owners.map(([tool, owner]): PromotionCandidate => {
    const calls = owned.filter((call) => call.tool === tool);
    const consumers = consumersOf(calls, owner);
    return {
      tool,
      owner,
      consumers,
      userCalls: calls.filter((call) => call.origin === USER_ORIGIN).length,
      candidate: consumers.length > 0,
    };
  });
  return {
    throughSeq: owned.reduce((max, call) => Math.max(max, call.seq), 0),
    threads: new Set(owned.map((call) => call.threadId)).size,
    candidates,
  };
}
