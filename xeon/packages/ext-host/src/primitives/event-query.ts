import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PortKey, PortLookup } from "@xeon/contracts/extensions";
import type { DurableEventEnvelope, ReadFailure, SessionService } from "@xeon/contracts/records";
import type { ResourceRecord, ResourceRegistry } from "./resources.ts";

/**
 * 내구 이벤트 읽기 포트(서비스 `xeon.session`의 `readBranch` 속성, 제공 core-persistence).
 * 계측·승격 집계가 코어 이벤트(`turn.*`, `lease.*`, `tool.*`)를 접두로 조회하는 데 쓴다(M3-REQ-39)
 */
export const SessionBranchPortKey: PortKey<SessionService["readBranch"]> = {
  name: "xeon.session",
  member: "readBranch",
};

/** `ExtHost.queryEvents`의 질의. kind가 `kindPrefix`로 시작하는 이벤트를 활성 가지 순서로 돌려준다 */
export interface EventPrefixQuery {
  /** 비어 있지 않은 kind 접두. 예: `"lease."`, `"grp.helm.metrics."` */
  readonly kindPrefix: string;
  /** 앞에서부터 잘라 돌려줄 최대 개수 */
  readonly limit?: number;
}

export type EventQueryError =
  | { readonly kind: "port_unavailable" }
  | { readonly kind: "invalid_prefix" }
  | { readonly kind: "read_failed"; readonly failure: ReadFailure };

/**
 * 활성 가지의 내구 이벤트를 kind 접두로 거른다. 이 조회는 호스트 쪽 도구(group-kit 계측, 승격 보고)용이고 확장 scope에는
 * 열지 않는다. 확장 레코드는 `ScopeApi.readRecords`가 `readsRecordKinds` 검사와 함께 맡는다.
 */
export function createEventQuery(
  ports: PortLookup,
): (
  threadId: ThreadId,
  query: EventPrefixQuery,
) => Promise<Result<readonly DurableEventEnvelope[], EventQueryError>> {
  return async (threadId, query) => {
    if (query.kindPrefix === "") return err({ kind: "invalid_prefix" });
    const readBranch = ports.get(SessionBranchPortKey);
    if (readBranch === undefined) return err({ kind: "port_unavailable" });
    const rows: DurableEventEnvelope[] = [];
    for await (const item of readBranch(threadId)) {
      if (!item.ok) return err({ kind: "read_failed", failure: item.error });
      if (!item.value.kind.startsWith(query.kindPrefix)) continue;
      rows.push(item.value);
      if (query.limit !== undefined && rows.length >= query.limit) break;
    }
    return ok(rows);
  };
}

/** 도구를 등록한 scope. `name`은 모델에 보이는 이름(`ResourceRecord.exposed`)이거나 등록 요청 이름이다 */
export function toolOwnerOf(
  resources: Pick<ResourceRegistry, "list">,
  name: string,
): ResourceRecord | undefined {
  const tools = resources.list("tool");
  return (
    tools.find((record) => record.exposed === name) ?? tools.find((record) => record.name === name)
  );
}
