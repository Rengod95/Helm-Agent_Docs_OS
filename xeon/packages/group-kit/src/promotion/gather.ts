import { parse } from "@xeon/contracts";
import type { ToolName } from "@xeon/contracts/capabilities";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import { TurnStartedPayloadSchema } from "@xeon/contracts/conversation";
import type { GroupId, ScopeId } from "@xeon/contracts/extensions";
import { EffectIntentSchema } from "@xeon/contracts/records";
import type { ExtHost } from "@xeon/ext-host";
import type { PromotionInput } from "./report.ts";

/** 승격 집계가 ExtHost에서 읽는 부분. 서비스의 `GroupHostView`가 이 부분을 포함한다 */
export type PromotionHostView = Pick<ExtHost, "scopes" | "queryEvents" | "toolOwner">;

type PromotionCall = PromotionInput["calls"][number];

/**
 * turn 시작 이벤트의 출처. drive turn은 임대한 scope id다. scopeId가 null이고 출처가 사용자 입력(`user`, 또는 옛 기록에 없음)이면 `"user"`다.
 * 위임·예약·원격·기타 turn은 호출을 만든 scope를 이벤트에서 알 수 없어 `null`로 두고 집계에서 뺀다(L3.group-kit.spec §10).
 */
function turnOriginOf(payload: unknown): ScopeId | null {
  const checked = parse(TurnStartedPayloadSchema, payload);
  if (!checked.ok) return null;
  if (checked.value.scopeId !== null) return checked.value.scopeId;
  return (checked.value.origin ?? "user") === "user" ? "user" : null;
}

/** 도구를 설치된 그룹이 등록했을 때만 그 그룹을 돌려준다. 그룹 scope id는 그룹 이름이다 */
function owningGroup(
  host: PromotionHostView,
  installed: ReadonlySet<ScopeId>,
  tool: ToolName,
): GroupId | undefined {
  const record = host.toolOwner(tool);
  if (record === undefined || !installed.has(record.scopeId)) return undefined;
  return record.extension;
}

/**
 * 승격 집계 입력을 X 이벤트에서 모은다(L3.group-kit.spec §3.12, G-18).
 * 호출 한 건은 `effect.intent` 하나다. 도구 실행 전에 한 번 커밋되고 같은 요청 키(`tool:<키>:intent`)로는 다시 쓰이지 않는다.
 * `turn.started`로 그 turn의 출처를 알고, `toolOwner`로 설치된 그룹이 등록한 도구만 고른다.
 * 한 thread의 조회가 실패하면(Result err) 그 thread는 건너뛰고 나머지를 모은다.
 */
export async function gatherPromotionInput(
  host: PromotionHostView,
  threadIds: readonly ThreadId[],
): Promise<PromotionInput> {
  const installed: ReadonlySet<ScopeId> = new Set(host.scopes().map((scope) => scope.id));
  const reads = await Promise.all(
    threadIds.map(async (threadId) => ({
      threadId,
      turns: await host.queryEvents(threadId, { kindPrefix: "turn.started" }),
      intents: await host.queryEvents(threadId, { kindPrefix: "effect.intent" }),
    })),
  );
  const toolOwners = new Map<ToolName, GroupId>();
  const calls: PromotionCall[] = [];
  for (const { threadId, turns, intents } of reads) {
    if (!turns.ok || !intents.ok) continue;
    const origins = new Map<TurnId, ScopeId>();
    for (const event of turns.value) {
      if (event.turnId === null) continue;
      const origin = turnOriginOf(event.payload);
      if (origin !== null) origins.set(event.turnId, origin);
    }
    for (const event of intents.value) {
      if (event.turnId === null) continue;
      const origin = origins.get(event.turnId);
      if (origin === undefined) continue;
      const checked = parse(EffectIntentSchema, event.payload);
      if (!checked.ok) continue;
      const tool = checked.value.toolName;
      const owner = owningGroup(host, installed, tool);
      if (owner === undefined) continue;
      toolOwners.set(tool, owner);
      calls.push({ tool, seq: event.seq, threadId, origin });
    }
  }
  return { toolOwners, calls };
}
