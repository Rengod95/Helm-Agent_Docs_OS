import { Bug, err, ok, parse, type Clock } from "@xeon/contracts";
import type {
  AgentMessage,
  EventId,
  Message,
  SystemMessage,
  ThreadId,
} from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { ItemRecordedPayloadSchema, type SessionService } from "@xeon/contracts/records";
import type {
  AssembledContext,
  CompactCheck,
  CompactRequest,
  ContextService,
  OverflowRecovery,
} from "@xeon/contracts/services";

// 테스트 대역: core-context의 `assemble`(커밋된 item으로 메시지를 다시 만든다)과 `convertToLlm`만 흉내 낸다.

/** 컴팩션 대역의 대본과 호출 기록 */
interface FakeCompaction {
  /** `shouldCompact`가 차례로 낼 판정. 비면 거짓 */
  shouldQueue: boolean[];
  /** `compact`의 결과: 커밋(기본), 건너뜀, 실패 */
  compactMode: "commit" | "skipped" | "fail";
  /** `recoverOverflow`가 차례로 낼 결과. "retry"는 컴팩션 이벤트를 커밋하고 retry를 낸다. 비면 fail(disabled) */
  overflowQueue: (OverflowRecovery | "retry")[];
  /** 호출 순서 기록: `should`, `compact`, `overflow`, `assemble` */
  readonly order: string[];
  readonly compactCalls: CompactRequest[];
  readonly overflowCalls: { readonly stepId: string; readonly errorMessage: string | undefined }[];
}

export interface FakeContext {
  readonly service: ContextService;
  readonly compaction: FakeCompaction;
  /** assemble이 낸 요청별 메시지 수 */
  readonly assembled: readonly {
    readonly stepId: string;
    readonly messages: readonly Message[];
    /** 조립이 읽은 가지의 끝 */
    readonly leaf: EventId;
    /** 조립 옵션 중 루프가 채우는 값 */
    readonly basePrompt: string;
    readonly volatile: Readonly<Record<string, string>>;
  }[];
}

function convertToLlm(messages: readonly AgentMessage[]): Message[] {
  return messages.map((message): Message => {
    if (message.role === "custom") {
      return { role: "user", content: message.content, timestamp: message.timestamp };
    }
    return message;
  });
}

function notImplemented(name: string): never {
  throw new Bug(`fake-context: ${name} is not implemented`);
}

export function createFakeContext(options: {
  readonly session: Pick<SessionService, "readBranch" | "commit" | "producer">;
  readonly clock: Clock;
}): FakeContext {
  const compaction: FakeCompaction = {
    shouldQueue: [],
    compactMode: "commit",
    overflowQueue: [],
    order: [],
    compactCalls: [],
    overflowCalls: [],
  };
  let compactions = 0;
  const ids = fixedIdFactory(9_500_000);
  const producer = options.session.producer("core.context");

  /** 컴팩션 이벤트 하나를 커밋한다. 커밋 피드가 루프의 leaf를 이 이벤트로 옮긴다 */
  async function commitCompaction(threadId: ThreadId): Promise<EventId> {
    compactions += 1;
    let leaf: EventId | null = null;
    for await (const read of options.session.readBranch(threadId)) {
      if (read.ok) leaf = read.value.id;
    }
    if (leaf === null) throw new Bug("fake-context: compaction on an empty thread");
    const committed = options.session.commit({
      threadId,
      requestId: `fake-compact:${String(compactions)}`,
      fingerprintSource: { n: compactions },
      build: () => ({
        kind: "append",
        drafts: [
          producer.draft({
            id: ids.next("evt"),
            kind: "thread.compacted",
            version: 1,
            causationId: null,
            correlationId: null,
            threadId,
            turnId: null,
            stepId: null,
            payload: {
              summary: "fake summary",
              firstKeptEventId: leaf,
              tokensBefore: 1000,
              details: null,
              usage: null,
              fromExtension: null,
            },
          }),
        ],
        checkpoint: null,
      }),
    });
    if (!committed.ok || committed.value.status !== "committed") {
      throw new Bug("fake-context: the compaction commit failed");
    }
    const id = committed.value.eventIds[0];
    if (id === undefined) throw new Bug("fake-context: the compaction commit had no event");
    return id;
  }

  const assembled: {
    stepId: string;
    leaf: EventId;
    messages: readonly Message[];
    basePrompt: string;
    volatile: Readonly<Record<string, string>>;
  }[] = [];

  async function assemble(
    threadId: ThreadId,
    leaf: EventId,
    opts: Parameters<ContextService["assemble"]>[2],
  ): Promise<ReturnType<typeof ok<AssembledContext>>> {
    const messages: AgentMessage[] = [];
    let prefix: SystemMessage | null = null;
    for await (const read of options.session.readBranch(threadId)) {
      if (!read.ok) throw new Bug(`fake context: read failed: ${read.error.kind}`);
      const event = read.value;
      if (event.kind === "item.recorded") {
        const payload = parse(ItemRecordedPayloadSchema, event.payload);
        if (!payload.ok) continue;
        const item = payload.value.item;
        if (item.kind === "system" && prefix === null) {
          prefix = item.message;
          continue;
        }
        if (
          item.kind === "assistant" &&
          (item.message.stopReason === "aborted" || item.message.stopReason === "error")
        ) {
          continue;
        }
        messages.push(item.message);
      }
      if (event.id === leaf) break;
    }
    const pendingItems: AssembledContext["pendingItems"][number][] = [];
    if (prefix === null) {
      prefix = {
        role: "system",
        content: opts.basePrompt,
        toolsAdded: opts.tools.map((tool) => tool.wire),
        timestamp: options.clock.now(),
      };
      pendingItems.push({ purpose: "prefix", message: prefix });
    }
    const all: Message[] = [prefix, ...convertToLlm(messages)];
    compaction.order.push("assemble");
    assembled.push({
      stepId: opts.stepId,
      leaf,
      messages: all,
      basePrompt: opts.basePrompt,
      volatile: opts.volatile,
    });
    return ok({
      messages: all,
      prefix: { prefixHash: "fake", toolset: "sha256:fake", recordedAt: null },
      toolChange: null,
      cacheMarks: { policy: opts.cachePolicy, marks: [] },
      estimate: { tokens: 0, usageTokens: 0, trailingTokens: 0, lastUsageIndex: null },
      compactionHead: null,
      pendingItems,
      warnings: [],
    });
  }

  const service: ContextService = {
    assemble,
    async compact(threadId, request) {
      await Promise.resolve();
      compaction.order.push("compact");
      compaction.compactCalls.push(request);
      if (compaction.compactMode === "fail") {
        return err({ kind: "summary_failed", message: "fake summary failure" });
      }
      if (compaction.compactMode === "skipped") {
        return ok({ status: "skipped", why: "nothing_to_summarize" });
      }
      const eventId = await commitCompaction(threadId);
      return ok({ status: "compacted", eventId, tokensBefore: 1000, fromExtension: null });
    },
    async shouldCompact(): Promise<CompactCheck> {
      await Promise.resolve();
      compaction.order.push("should");
      const should = compaction.shouldQueue.shift() === true;
      return { should, tokens: should ? 190_000 : 10, threshold: 100_000 };
    },
    estimate: () => ({ tokens: 0, usageTokens: 0, trailingTokens: 0, lastUsageIndex: null }),
    convertToLlm,
    async recoverOverflow(threadId, stepId, failed): Promise<OverflowRecovery> {
      await Promise.resolve();
      compaction.order.push("overflow");
      compaction.overflowCalls.push({ stepId, errorMessage: failed.errorMessage });
      const next = compaction.overflowQueue.shift();
      if (next === undefined) return { action: "fail", reason: "disabled" };
      if (next !== "retry") return next;
      return { action: "retry", compactedEventId: await commitCompaction(threadId) };
    },
    summarizeBranch: () => notImplemented("summarizeBranch"),
  };
  return { service, assembled, compaction };
}
