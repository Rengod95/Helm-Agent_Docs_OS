import { assertNever, attempt, err, ok, type Result } from "@xeon/contracts";
import type { FetchFormat } from "@xeon/contracts/capabilities";
import type { WebFailure } from "../errors.ts";
import type { AccessContext, ApprovedTarget } from "../policy/access.ts";
import type { WebDeps } from "../deps.ts";
import {
  decodeBody,
  isNegotiatedMarkdown,
  passMarkdown,
  type ConvertResult,
  type Extractor,
} from "./convert/convert.ts";
import type { ConvertFailure } from "./convert-runner.ts";

// ProviderId "local"(L2.web.spec §3.6.2, §4.9.1 3~5단계). guarded 전송으로 GET을 보내고 응답을 형식에 맞게 변환한다.
// 정책 검사는 호출 앞에서 끝나 있다(`Access.authorize`).

/** 응답 바이트 상한 10 MiB, 내용 인코딩을 푼 뒤 상한 20 MiB */
const MAX_RESPONSE_BYTES: number = 10 * 1024 * 1024;
export const MAX_DECODED_BYTES: number = 20 * 1024 * 1024;

const ACCEPT = "text/markdown, text/html;q=0.9, text/plain;q=0.8, application/pdf;q=0.5, */*;q=0.1";

export interface LocalFetchOptions {
  readonly format: FetchFormat;
  readonly extractor: Extractor;
  readonly timeoutMs: number;
}

export type LocalFetchOutcome =
  | {
      readonly kind: "page";
      readonly finalUrl: string;
      readonly status: number;
      readonly contentType: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly rawBytes: Uint8Array;
      /** 형식이 markdown·text일 때만 있다. html·raw는 변환하지 않는다 */
      readonly converted: ConvertResult | undefined;
      /** format이 html·raw일 때 본문 문자열 */
      readonly literal: string | undefined;
    }
  | {
      readonly kind: "redirect";
      readonly from: string;
      readonly to: string;
      readonly status: number;
    };

function convertFailure(failure: ConvertFailure): WebFailure {
  switch (failure.kind) {
    case "aborted":
      return { code: "aborted", message: "The operation was aborted." };
    case "timeout":
      return { code: "timeout", message: "Converting the page timed out.", retryable: false };
    case "worker_failed":
      return {
        code: "internal",
        message: `Converting the page failed: ${failure.message}`,
        retryable: false,
      };
    default:
      return assertNever(failure, "ConvertFailure");
  }
}

function tooLarge(limit: number): WebFailure {
  return {
    code: "too_large",
    message: `The response is larger than ${limit} bytes.`,
    retryable: false,
    detail: { maxBytes: limit },
  };
}

export async function fetchLocal(
  deps: WebDeps,
  target: ApprovedTarget,
  ctx: AccessContext,
  options: LocalFetchOptions,
): Promise<Result<LocalFetchOutcome, WebFailure>> {
  const fetched = await deps.content.get(
    target,
    {
      headers: { accept: ACCEPT, "user-agent": deps.userAgent },
      timeoutMs: options.timeoutMs,
      maxBytes: MAX_DECODED_BYTES,
    },
    ctx,
  );
  if (!fetched.ok) return fetched;
  if (fetched.value.kind === "redirect_not_followed") {
    const { from, to, status } = fetched.value;
    return ok({ kind: "redirect", from, to, status });
  }
  const { response, finalUrl } = fetched.value;
  const encoded = response.headers["content-encoding"];
  const declared = Number(response.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    return err(tooLarge(MAX_RESPONSE_BYTES));
  const identity = encoded === undefined || encoded === "" || encoded === "identity";
  if (identity && response.body.byteLength > MAX_RESPONSE_BYTES)
    return err(tooLarge(MAX_RESPONSE_BYTES));

  const contentType = response.headers["content-type"] ?? "";
  const page = {
    kind: "page",
    finalUrl,
    status: response.status,
    contentType,
    headers: response.headers,
    rawBytes: response.body,
  } as const;

  if (options.format === "html") {
    return ok({ ...page, converted: undefined, literal: decodeBody(response.body, contentType) });
  }
  if (options.format === "raw") {
    const strict = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(response.body));
    if (!strict.ok) {
      return err({
        code: "unsupported",
        message: "The response is binary and cannot be read as text.",
        detail: { contentType },
      });
    }
    return ok({ ...page, converted: undefined, literal: strict.value });
  }
  if (isNegotiatedMarkdown(contentType)) {
    // 협상 Markdown은 변환 실행기를 거치지 않는다(파서가 없다)
    const passed = passMarkdown({ bytes: response.body, contentType, baseUrl: finalUrl });
    return ok({ ...page, converted: passed, literal: undefined });
  }
  const converted = await deps.convert.convert(
    { bytes: response.body, contentType, baseUrl: finalUrl, extractor: options.extractor },
    ctx.signal,
  );
  if (!converted.ok) return err(convertFailure(converted.error));
  return ok({ ...page, converted: converted.value, literal: undefined });
}
