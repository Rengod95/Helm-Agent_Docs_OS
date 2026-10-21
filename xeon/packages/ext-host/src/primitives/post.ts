import {
  InputQueuePortKey,
  type PostItem,
  type PostOptions,
  type PostReceipt,
} from "@xeon/contracts/extensions";
import { ambient } from "./ambient.ts";
import type { Generation, HostCore, ScopeRecord } from "./core.ts";
import { PrimitiveError } from "./errors.ts";

export interface PostQueue {
  post(
    record: ScopeRecord,
    generation: Generation,
    item: PostItem,
    options: PostOptions,
  ): Promise<PostReceipt>;
}

const MAX_REQUEST_ID = 64;

/**
 * post(X.primitives.spec §4.7): usesPost 검사, requestId 길이 검사, InputQueuePort 위임.
 * 큐 위치(when)와 멱등((scopeId, requestId))은 L1.tasks가 정한다. X는 값을 넘기기만 한다
 */
export function createPostQueue(core: HostCore): PostQueue {
  return {
    async post(record, generation, item, options) {
      if (generation.closed) {
        throw new PrimitiveError("scope_inactive", `scope ${record.id} generation is closed`, {
          scopeId: record.id,
        });
      }
      generation.usage.post = true;
      if (record.manifest.usesPost !== true) {
        throw new PrimitiveError("post_undeclared", `${record.id} used post without usesPost`, {
          scopeId: record.id,
        });
      }
      if (options.requestId.length < 1 || options.requestId.length > MAX_REQUEST_ID) {
        throw new TypeError(`post requestId must be 1..${MAX_REQUEST_ID} characters`);
      }
      const amb = ambient();
      if (amb === undefined || !core.threads.has(amb.threadId)) {
        throw new PrimitiveError("no_thread", "post needs a thread context (handler or drive)", {
          scopeId: record.id,
        });
      }
      const port = core.ports.get(InputQueuePortKey);
      if (port === undefined) {
        throw new PrimitiveError(
          "port_unavailable",
          "xeon.tasks (InputQueuePort) is not provided",
          {
            scopeId: record.id,
          },
        );
      }
      const result = await port.enqueue({
        threadId: amb.threadId,
        scopeId: record.id,
        requestId: options.requestId,
        when: options.when,
        item,
      });
      if (!result.duplicate && amb.drive !== null) amb.drive.effects += 1;
      return { requestId: options.requestId, duplicate: result.duplicate };
    },
  };
}
