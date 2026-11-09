// 응답 만들기와 본문 읽기. 모든 응답에 `securityHeaders`를 붙이고 CORS 헤더는 내지 않는다(spec §8.5).
// 본문은 한도를 넘는 순간 읽기를 멈춘다(`req.text()`처럼 통째로 모으지 않는다).
import { attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { securityHeaders } from "../auth/headers.ts";

/** `POST /pair` 본문 한도(spec §8.3, 4 KiB) */
export const MAX_PAIR_BODY_BYTES: number = 4 * 1024;
/** `POST /push/subscribe` 본문 한도(spec §6.2, 8 KiB) */
export const MAX_PUSH_BODY_BYTES: number = 8 * 1024;

export type HeaderMap = Readonly<Record<string, string>>;

/** 보안 헤더를 붙인 응답. `body`가 `null`이면 본문 없이 보낸다 */
export function responseWith(
  tls: boolean,
  status: number,
  body: BodyInit | null,
  headers: HeaderMap = {},
): Response {
  return new Response(body, { status, headers: { ...securityHeaders({ tls }), ...headers } });
}

/** JSON 응답. 토큰이 실릴 수 있으므로 저장하지 않게 `no-store`다 */
export function jsonResponse(
  tls: boolean,
  status: number,
  value: unknown,
  headers: HeaderMap = {},
): Response {
  return responseWith(tls, status, JSON.stringify(value), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
}

export function textResponse(tls: boolean, status: number, text: string): Response {
  return responseWith(tls, status, text, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
}

export function redirectTo(tls: boolean, location: string): Response {
  return responseWith(tls, 302, null, { location, "cache-control": "no-store" });
}

export function methodNotAllowed(tls: boolean, allow: readonly string[]): Response {
  return jsonResponse(tls, 405, { error: "method_not_allowed" }, { allow: allow.join(", ") });
}

export type BodyError =
  | { readonly kind: "too_large" }
  | { readonly kind: "read_failed" }
  | { readonly kind: "invalid_utf8" };

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 본문을 UTF-8 글자로 읽는다. `limit` 바이트를 넘으면 `too_large`다(넘는 순간 읽기를 멈춘다) */
export async function readBodyText(
  req: Request,
  limit: number,
): Promise<Result<string, BodyError>> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) return err({ kind: "too_large" });
  const stream = req.body;
  if (stream === null) return ok("");
  // 넘는 순간 `return`으로 빠져나온다. `for await`는 빠져나올 때 스트림을 닫는다
  const collected = await attemptAsync(async (): Promise<Collected> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.byteLength;
      if (size > limit) return { kind: "too_large" };
      chunks.push(chunk);
    }
    return { kind: "bytes", bytes: concat(chunks, size) };
  });
  if (!collected.ok) return err({ kind: "read_failed" });
  const result = collected.value;
  if (result.kind === "too_large") return err({ kind: "too_large" });
  const text = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(result.bytes));
  return text.ok ? ok(text.value) : err({ kind: "invalid_utf8" });
}

type Collected =
  | { readonly kind: "too_large" }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array };

/** 본문 읽기 실패를 응답으로. 본문 내용은 싣지 않는다 */
export function bodyErrorResponse(tls: boolean, error: BodyError): Response {
  if (error.kind === "too_large") return jsonResponse(tls, 413, { error: "body_too_large" });
  return jsonResponse(tls, 400, { error: "invalid_body" });
}
