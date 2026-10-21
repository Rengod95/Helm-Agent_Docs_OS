import type { Clock } from "@xeon/contracts";
import type {
  AgentMessage,
  EventId,
  IdFactory,
  ImageContent,
  ItemId,
  ItemRecord,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import type { LoopTurnRequest, PostContent } from "@xeon/contracts/extensions";
import type { CommitRequest, StampedDraft } from "@xeon/contracts/records";
import type { QueuedInput, TaskService } from "@xeon/contracts/services";
import { commitKeys, placedMessageOf } from "./commits.ts";
import type { Drafter } from "./drafts.ts";

// L1.loop.spec §3.5 T1, §4.8 runTurn 2단계. 입력 item을 먼저 기록한 뒤 `input.placed`, `turn.started` 순서다.

export type TurnStartSource =
  | { readonly kind: "queue" }
  | { readonly kind: "drive"; readonly request: LoopTurnRequest };

/** T1 `build`가 정한 값. 마지막 `build` 호출의 것을 돌려준다 */
export interface TurnStartPlanned {
  readonly turnId: TurnId;
  readonly itemIds: readonly ItemId[];
  /** 입력 메시지(모델에 들어갈 모양). before_agent_start 페이로드와 steer가 아닌 turn 입력 */
  readonly messages: readonly AgentMessage[];
  /** 큐 입력 turn이면 고른 입력. drive turn이면 빈 배열 */
  readonly inputs: readonly QueuedInput[];
  readonly requestId: string | null;
  readonly scopeId: string | null;
  /** 사람이 승인 요청에 답할 수 있는가(L1.tools.spec §3.2 interactive) */
  readonly interactive: boolean;
  readonly prompt: string;
  readonly images: readonly ImageContent[];
  readonly consumedSeq: number;
  readonly leaseRefs: readonly EventId[];
  readonly scopeRef: EventId | null;
}

export function textAndImages(content: PostContent): {
  readonly text: string;
  readonly images: readonly ImageContent[];
} {
  if (typeof content === "string") return { text: content, images: [] };
  const texts: string[] = [];
  const images: ImageContent[] = [];
  for (const block of content) {
    if (block.type === "text") texts.push(block.text);
    else images.push(block);
  }
  return { text: texts.join("\n"), images };
}

export function turnStartRequest(
  deps: {
    readonly drafter: Drafter;
    readonly clock: Clock;
    readonly ids: IdFactory;
    readonly tasks: Pick<TaskService, "inputs">;
  },
  params: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly source: TurnStartSource;
  },
): { readonly request: CommitRequest; readonly planned: () => TurnStartPlanned | undefined } {
  const { threadId, turnId, source } = params;
  let captured: TurnStartPlanned | undefined;
  const scope = { threadId, turnId, stepId: null } as const;

  const request: CommitRequest = {
    threadId,
    requestId: commitKeys.turnStart(turnId),
    fingerprintSource:
      source.kind === "queue"
        ? { kind: "turn_start", threadId, turnId, source: "queue" }
        : {
            kind: "turn_start",
            threadId,
            turnId,
            source: "drive",
            scopeId: source.request.scopeId,
            requestId: source.request.requestId,
          },
    build: (view) => {
      if (view.threadStatus === "absent") {
        return { kind: "reject", code: "thread_absent", detail: null };
      }
      const timestamp = deps.clock.now();
      const previous = view.lastCheckpoint(threadId);
      const leaseRefs = previous?.leaseRefs ?? [];
      const scopeRef = previous?.scopeRef ?? null;
      const priorConsumed = previous?.inputCursor.consumedSeq ?? 0;

      if (source.kind === "queue") {
        const selection = deps.tasks.inputs.drain(view, threadId, "turnStart", {
          continuing: false,
        });
        const first = selection.inputs[0];
        if (first === undefined) return { kind: "reject", code: "no_input", detail: null };
        const itemIds: ItemId[] = [];
        const messages: AgentMessage[] = [];
        const drafts: StampedDraft[] = [];
        const placements: { inputId: EventId; itemId: ItemId; turnId: TurnId }[] = [];
        for (const input of selection.inputs) {
          const itemId = deps.ids.next("itm");
          placements.push({ inputId: input.inputId, itemId, turnId });
          const placed = placedMessageOf(itemId, input.item, input.requestId, timestamp);
          itemIds.push(itemId);
          messages.push(placed.message);
          drafts.push(deps.drafter.make("item.recorded", { item: placed.record }, scope));
        }
        drafts.push(...selection.drafts(placements));
        drafts.push(
          deps.drafter.make(
            "turn.started",
            { inputItemIds: itemIds, requestId: first.requestId, scopeId: null },
            scope,
          ),
        );
        const firstText = textAndImages(first.item.content);
        captured = {
          turnId,
          itemIds,
          messages,
          inputs: selection.inputs,
          requestId: first.requestId,
          scopeId: null,
          interactive: first.source.type === "user",
          prompt: firstText.text,
          images: firstText.images,
          consumedSeq: Math.max(priorConsumed, selection.consumedSeq),
          leaseRefs,
          scopeRef,
        };
        return { kind: "append", drafts, checkpoint: null };
      }

      const req = source.request;
      // 펜싱: 임대가 더 높은 차수로 넘어간 뒤 늦게 도착한 요청은 turn을 열지 않는다
      const epoch = view.scopeLeaseEpoch(threadId, req.scopeId);
      if (epoch > req.leaseEpoch) {
        return { kind: "reject", code: "stale_lease", detail: String(epoch) };
      }
      // 멱등: (scopeId, requestId)의 turn이 이미 있으면 새 turn을 열지 않는다
      const existing = view.turnByRequestId(threadId, req.scopeId, req.requestId);
      if (existing !== undefined) {
        return { kind: "reject", code: "turn_exists", detail: existing.turnId };
      }
      const itemId = deps.ids.next("itm");
      const placed = placedMessageOf(itemId, req.input, null, timestamp);
      const { text, images } = textAndImages(req.input.content);
      const drafts: StampedDraft[] = [
        deps.drafter.make("item.recorded", { item: placed.record }, scope),
        deps.drafter.make(
          "turn.started",
          { inputItemIds: [itemId], requestId: req.requestId, scopeId: req.scopeId },
          scope,
        ),
      ];
      captured = {
        turnId,
        itemIds: [itemId],
        messages: [placed.message],
        inputs: [],
        requestId: req.requestId,
        scopeId: req.scopeId,
        interactive: false,
        prompt: text,
        images,
        consumedSeq: priorConsumed,
        leaseRefs,
        scopeRef,
      };
      return { kind: "append", drafts, checkpoint: null };
    },
  };

  return { request, planned: () => captured };
}

/** `before_agent_start`가 추가한 custom item을 기록하는 C2b 커밋(turn:<turnId>:prestart) */
export function prestartRequest(
  drafter: Drafter,
  scope: { readonly threadId: ThreadId; readonly turnId: TurnId },
  records: readonly ItemRecord[],
): CommitRequest {
  return {
    threadId: scope.threadId,
    requestId: commitKeys.turnPrestart(scope.turnId),
    fingerprintSource: { kind: "turn_prestart", threadId: scope.threadId, turnId: scope.turnId },
    build: () => ({
      kind: "append",
      drafts: records.map((item) =>
        drafter.make("item.recorded", { item }, { ...scope, stepId: null }),
      ),
      checkpoint: null,
    }),
  };
}
