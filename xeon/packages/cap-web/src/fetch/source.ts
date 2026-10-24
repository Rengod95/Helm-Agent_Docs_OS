import { parse } from "@xeon/contracts";
import {
  IsoTimeSchema,
  type CacheUsage,
  type Source,
  type SourceId,
} from "@xeon/contracts/capabilities";
import { sha256Hex } from "../util/hash.ts";

// Source 한 건을 만든다(L2.web.spec §3.1, §4.2.3). 스키마 상한을 넘는 값은 자른다.

export interface SourceInput {
  readonly id: SourceId;
  readonly url: string;
  readonly finalUrl: string | undefined;
  readonly title: string | undefined;
  readonly publishedAt: string | undefined;
  readonly provider: string;
  readonly cache: CacheUsage;
  /** 원문 바이트의 sha256(hex). 원문을 저장하지 않아도 해시는 남긴다 */
  readonly rawSha256: string | undefined;
  readonly rawRef: string | undefined;
  readonly retrievedAtMs: number;
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

export function contentHashOf(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

export function buildSource(input: SourceInput): Source {
  const finalUrl =
    input.finalUrl !== undefined && input.finalUrl !== input.url ? input.finalUrl : undefined;
  const published =
    input.publishedAt === undefined ? undefined : parse(IsoTimeSchema, input.publishedAt);
  const title = input.title?.trim();
  return {
    id: input.id,
    url: input.url.slice(0, 4096),
    ...(finalUrl === undefined ? {} : { finalUrl: finalUrl.slice(0, 4096) }),
    ...(title === undefined || title === "" ? {} : { title: title.slice(0, 512) }),
    ...(published?.ok === true ? { publishedAt: published.value } : {}),
    retrievedAt: isoTime(input.retrievedAtMs),
    provider: input.provider,
    ...(input.rawSha256 === undefined ? {} : { contentHash: `sha256:${input.rawSha256}` }),
    ...(input.rawRef === undefined ? {} : { rawRef: input.rawRef }),
    usage: { cache: input.cache },
  };
}
