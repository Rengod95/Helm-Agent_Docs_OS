import { Bug, ok, parse, type Clock } from "@xeon/contracts";
import type {
  AgentMessage,
  EventId,
  Message,
  SystemMessage,
  ThreadId,
} from "@xeon/contracts/conversation";
import { ItemRecordedPayloadSchema, type SessionService } from "@xeon/contracts/records";
import type { AssembledContext, ContextService } from "@xeon/contracts/services";

// 테스트 대역: core-context의 `assemble`(커밋된 item으로 메시지를 다시 만든다)과 `convertToLlm`만 흉내 낸다.

export interface FakeContext {
  readonly service: ContextService;
  /** assemble이 낸 요청별 메시지 수 */
  readonly assembled: readonly { readonly stepId: string; readonly messages: readonly Message[] }[];
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
  readonly session: Pick<SessionService, "readBranch">;
  readonly clock: Clock;
}): FakeContext {
  const assembled: { stepId: string; messages: readonly Message[] }[] = [];

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
    assembled.push({ stepId: opts.stepId, messages: all });
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
    compact: () => notImplemented("compact"),
    shouldCompact: () => notImplemented("shouldCompact"),
    estimate: () => ({ tokens: 0, usageTokens: 0, trailingTokens: 0, lastUsageIndex: null }),
    convertToLlm,
    recoverOverflow: () => notImplemented("recoverOverflow"),
    summarizeBranch: () => notImplemented("summarizeBranch"),
  };
  return { service, assembled };
}
