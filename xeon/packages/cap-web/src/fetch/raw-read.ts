import { err, ok, type Result } from "@xeon/contracts";
import type { WebFetchOutput, WebFetchPage, WebFetchInput } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SourceIdTable } from "../contract/source-ids.ts";
import { buildMeta } from "../contract/meta.ts";
import { computeCost } from "../cost/meter.ts";
import type { WebDeps } from "../deps.ts";
import type { WebFailure } from "../errors.ts";
import { buildSource } from "./source.ts";
import { sliceText } from "./truncate.ts";

// L2.web.spec §4.9.2. `fetch({ rawRef, range })`는 네트워크 요청을 하지 않는다. 저장한 변환 본문을 `range`로 자르고
// `maxChars`로 줄여 돌려준다. session 원문은 같은 세션에서만 읽는다.

export interface RawReadEnv {
  readonly threadId: ThreadId | undefined;
  readonly table: SourceIdTable;
  readonly maxChars: number;
  readonly startedAt: number;
}

export function readByRawRef(
  deps: WebDeps,
  rawRef: string,
  input: WebFetchInput,
  env: RawReadEnv,
): Result<WebFetchOutput, WebFailure> {
  if (deps.cache === undefined) {
    return err({
      code: "unavailable",
      message: "Raw page storage is not available.",
      retryable: false,
      detail: { reason: "no_store" },
    });
  }
  const read = deps.cache.readRaw(rawRef, env.threadId);
  if (!read.ok) {
    deps.logger.warn("web.raw_read_failed", { kind: read.error.kind });
    return err({
      code: "unavailable",
      message: "The stored page could not be read.",
      retryable: read.error.kind === "read" || read.error.kind === "write",
      detail: { reason: read.error.kind },
    });
  }
  const raw = read.value;
  if (raw === undefined) {
    return err({
      code: "not_found",
      message: "No stored page matches this rawRef. Fetch the URL again.",
      retryable: false,
    });
  }
  const sliced = sliceText(raw.text, input.range, env.maxChars);
  if (!sliced.ok) return sliced;
  const id = env.table.idFor(raw.url);
  if (!id.ok)
    return err({ code: "internal", message: "Source ids are exhausted.", retryable: false });
  if (raw.finalUrl !== undefined) env.table.seed([{ id: id.value, url: raw.finalUrl }]);
  const source = buildSource({
    id: id.value,
    url: raw.url,
    finalUrl: raw.finalUrl,
    title: raw.title,
    publishedAt: raw.publishedAt,
    provider: raw.provider,
    cache: raw.retention,
    rawSha256: rawRef.slice("webraw:".length),
    rawRef,
    retrievedAtMs: raw.createdAt,
  });
  const slice = sliced.value;
  const page: WebFetchPage = {
    source,
    status: raw.status,
    contentType: raw.contentType.slice(0, 128),
    bytes: new TextEncoder().encode(raw.text).byteLength,
    content: slice.content,
    truncated: {
      shown: slice.shown,
      total: slice.total,
      ...(slice.nextOffset === undefined ? {} : { nextOffset: slice.nextOffset }),
    },
    method: raw.method,
  };
  const cost = computeCost(
    { provider: "local", pricing: "free", units: [], contextChars: slice.content.length },
    deps.clock.now(),
  );
  return ok({
    pages: [page],
    meta: buildMeta({
      ids: deps.ids,
      clock: deps.clock,
      startedAt: env.startedAt,
      provider: "local",
      selectedBy: "call",
      fallbacks: [],
      cache: "hit",
      cost: cost.cost,
      warnings: [],
    }),
  });
}
