import { assertNever } from "@xeon/contracts";
import {
  InputQueuePortKey,
  type EnqueueError,
  type PostItem,
  type PostOptions,
  type PostReceipt,
  type ScopeId,
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

/** 입력 큐가 받지 않은 이유를 확장이 받는 오류로 옮긴다. 저장소 실패는 storage_unavailable이다 */
function postFailure(error: EnqueueError, scopeId: ScopeId): Error {
  switch (error.kind) {
    case "invalid_request_id":
      return new TypeError(`post requestId is invalid: ${error.requestId}`);
    case "mode_not_supported":
      return new TypeError(`post when is not supported: ${error.mode}`);
    case "thread_closed":
    case "thread_not_found":
      return new PrimitiveError("no_thread", `post target thread is not open: ${error.kind}`, {
        scopeId,
        cause: error,
      });
    case "busy":
    case "disk_full":
    case "io":
    case "ownership_lost":
    case "read_only":
      return new PrimitiveError("storage_unavailable", `input queue rejected post: ${error.kind}`, {
        scopeId,
        cause: error,
      });
    default:
      return assertNever(error, "EnqueueError");
  }
}

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
      if (!result.ok) throw postFailure(result.error, record.id);
      if (!result.value.duplicate && amb.drive !== null) amb.drive.effects += 1;
      return { requestId: options.requestId, duplicate: result.value.duplicate };
    },
  };
}
