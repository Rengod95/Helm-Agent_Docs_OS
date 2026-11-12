import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Type, type Static, type TSchema } from "typebox";
import { assertNever, attempt, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import { probeTlsFingerprint, type WsError } from "./ws.ts";

// 데스크톱이 다른 컴퓨터의 게이트웨이 `POST /pair`로 기기를 등록하고 토큰을 받는다(apps/desktop-shell/src/web/server/pair.ts).
// - 신뢰는 지문 고정이다(ws.ts와 같다). 지문을 재서 pin과 같을 때만, 그 인증서 하나를 유일한 CA로 요청을 보낸다.
// - 토큰은 성공 값에만 담는다. 오류 값, 로그, 예외 메시지에는 넣지 않는다.
// - Electron(Node)에서 돈다. node:https와 node:tls만 쓴다. 외부 의존은 없다.

export type PairError =
  | { readonly kind: "invalid_pin" }
  | { readonly kind: "invalid_host" }
  | { readonly kind: "invalid_port" }
  | { readonly kind: "invalid_code_format" }
  | { readonly kind: "fingerprint_changed"; readonly expected: string; readonly actual: string }
  | { readonly kind: "invalid_code" }
  /** 시도 횟수 초과로 잠겼다. `retry-after` 헤더 값(초) */
  | { readonly kind: "locked"; readonly retryAfterSeconds: number }
  | { readonly kind: "invalid_device_name" }
  /** 그 밖의 거절: 400 `invalid_body`와 알 수 없는 오류, 403, 421, 그 밖의 상태. status는 HTTP 상태 코드 */
  | { readonly kind: "rejected"; readonly status: number }
  /** 응답 본문이나 헤더가 프로토콜과 다르다. 모양이 틀리거나 64KB를 넘는다 */
  | { readonly kind: "bad_response" }
  | { readonly kind: "refused"; readonly host: string; readonly port: number }
  | { readonly kind: "timeout" }
  /** code: 노드 오류 코드 또는 지문 재기의 io 코드 */
  | { readonly kind: "io"; readonly code: string };

export interface PairGrant {
  readonly token: string;
  readonly deviceId: string;
  readonly deviceName: string;
}

export interface PairOptions {
  /** 호스트 이름, IPv4, IPv6(`::1` 또는 `[::1]`) */
  readonly host: string;
  readonly port: number;
  /** SHA-256 지문 64자리 16진수. 대소문자와 ':' 구분자는 무시한다 */
  readonly pin: string;
  /** 게이트웨이가 화면에 띄운 페어링 코드 */
  readonly code: string;
  readonly deviceName: string;
  /** 기본 10000. 지문 재기와 요청을 합친 시한이다 */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CODE_LENGTH = 64;
const MAX_BODY_BYTES = 64 * 1024;
const PAIR_PATH = "/pair";
const PIN_PATTERN = /^[0-9a-f]{64}$/;
/** 호스트에 들어가면 Origin이나 URL 모양을 깨는 문자 */
const BAD_HOST_CHARS = /[\s/\\?#@[\]]/u;
const DECIMAL_SECONDS = /^\d+$/;

/** 성공 본문. 데스크톱은 토큰을 본문으로 받는다 */
const PairSuccessBody = Type.Object({
  ok: Type.Literal(true),
  device: Type.Object({ id: Type.String(), name: Type.String() }),
  token: Type.String({ minLength: 1 }),
});
/** 오류 본문. 뜻은 상태와 코드로 정하고, 여기서는 모양만 본다 */
const PairErrorBody = Type.Object({ error: Type.String() });

interface Checked {
  /** 괄호를 벗긴 호스트. 소켓 연결과 지문 재기에 쓴다 */
  readonly bare: string;
  readonly port: number;
  /** 정규형(소문자, 구분자 없음) */
  readonly pin: string;
  readonly code: string;
}

/** 응답의 모양만 옮긴다. 본문은 64KB를 넘으면 `null`이다(끝까지 읽지 않았다) */
interface HttpReply {
  readonly status: number;
  readonly retryAfter: string | undefined;
  readonly body: string | null;
}

interface PostInput {
  /** 호출자가 준 호스트. 연결 거부 오류에 그대로 담는다 */
  readonly host: string;
  readonly bare: string;
  readonly port: number;
  /** 지문을 확인한 인증서 PEM. 이것만 CA로 준다 */
  readonly ca: string;
  readonly origin: string;
  readonly body: string;
  readonly timeoutMs: number;
}

/**
 * 게이트웨이에 기기 페어링을 요청하고 토큰을 받는다. 지문이 pin과 다르면 요청을 보내지 않는다.
 * 예상 가능한 실패는 모두 `PairError` 값으로 돌려준다.
 */
export async function pairWithGateway(options: PairOptions): Promise<Result<PairGrant, PairError>> {
  const input = checkInput(options);
  if (!input.ok) return err(input.error);
  const { bare, port, pin, code } = input.value;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const probed = await probeTlsFingerprint({
    host: options.host,
    port,
    timeoutMs: deadline - Date.now(),
  });
  if (!probed.ok) return err(probeFailure(probed.error));
  const { fingerprint, pem } = probed.value;
  if (fingerprint !== pin) {
    return err({ kind: "fingerprint_changed", expected: pin, actual: fingerprint });
  }

  const remaining = deadline - Date.now();
  if (remaining <= 0) return err({ kind: "timeout" });
  const reply = await postPair({
    host: options.host,
    bare,
    port,
    ca: pem,
    origin: `https://${authorityOf(bare, port)}`,
    body: JSON.stringify({ code, deviceName: options.deviceName, kind: "desktop" }),
    timeoutMs: remaining,
  });
  if (!reply.ok) return err(reply.error);
  return classify(reply.value);
}

/** 입력 모양을 서버 호출 전에 검사한다. 순서: pin, host, port, code */
function checkInput(options: PairOptions): Result<Checked, PairError> {
  const pin = options.pin.replace(/:/g, "").toLowerCase();
  if (!PIN_PATTERN.test(pin)) return err({ kind: "invalid_pin" });
  const bare = bareHostOf(options.host);
  if (!isPlausibleHost(bare)) return err({ kind: "invalid_host" });
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    return err({ kind: "invalid_port" });
  }
  if (options.code.length === 0 || options.code.length > MAX_CODE_LENGTH) {
    return err({ kind: "invalid_code_format" });
  }
  return ok({ bare, port: options.port, pin, code: options.code });
}

/** `[::1]` 꼴이면 괄호를 벗긴다 */
function bareHostOf(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** 호스트 이름이나 IP 주소 모양인가. 콜론은 IPv6 주소에만 허용한다(`host:port` 꼴을 막는다) */
function isPlausibleHost(bare: string): boolean {
  if (bare === "" || BAD_HOST_CHARS.test(bare) || hasControlChar(bare)) return false;
  return !bare.includes(":") || isIP(bare) === 6;
}

function hasControlChar(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Origin과 Host에 쓰는 권한부. IPv6는 대괄호로 감싼다 */
function authorityOf(bare: string, port: number): string {
  const host = isIP(bare) === 6 ? `[${bare}]` : bare;
  return `${host}:${String(port)}`;
}

function probeFailure(error: WsError): PairError {
  switch (error.kind) {
    case "refused":
      return { kind: "refused", host: error.host, port: error.port };
    case "timeout":
      return { kind: "timeout" };
    case "io":
      return { kind: "io", code: error.code };
    case "tls_untrusted":
    case "fingerprint_changed":
    case "upgrade_rejected":
    case "plaintext_not_loopback":
      // probeTlsFingerprint는 이 넷을 내지 않는다. 그래도 던지지 않고 kind를 코드로 돌려준다
      return { kind: "io", code: error.kind };
    default:
      // 위에서 모든 kind를 나열했으므로 여기는 never다. WsError에 kind가 늘면 컴파일이 실패한다
      return assertNever(error, "probeFailure");
  }
}

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function requestFailure(caught: unknown, input: PostInput): PairError {
  const code = codeOf(caught);
  if (code === "ECONNREFUSED") return { kind: "refused", host: input.host, port: input.port };
  return { kind: "io", code };
}

/**
 * `POST /pair`를 보내고 응답의 상태, `retry-after`, 본문(64KB 이하)을 받는다.
 * 요청 시한은 전체 기한의 남은 시간이다. 본문을 다 읽기 전에 시한이 지나면 `timeout`이다.
 */
function postPair(input: PostInput): Promise<Result<HttpReply, PairError>> {
  return new Promise((resolve) => {
    const made = attempt(() =>
      httpsRequest({
        host: input.bare,
        port: input.port,
        method: "POST",
        path: PAIR_PATH,
        headers: {
          "Content-Type": "application/json",
          Origin: input.origin,
          "Content-Length": String(Buffer.byteLength(input.body)),
        },
        ca: [input.ca],
        rejectUnauthorized: true,
        // 핀이 신원이다. 호스트 이름과 인증서 이름은 비교하지 않는다(IP나 별칭으로 적어도 같은 인증서면 된다)
        checkServerIdentity: () => undefined,
        // IP 주소에는 servername을 주지 않는다(Bun은 IP servername을 거부한다)
        ...(isIP(input.bare) === 0 ? { servername: input.bare } : {}),
      }),
    );
    if (!made.ok) {
      resolve(err(requestFailure(made.error.cause, input)));
      return;
    }
    const req = made.value;
    let settled = false;
    const settle = (result: Result<HttpReply, PairError>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle(err({ kind: "timeout" }));
      req.destroy();
    }, input.timeoutMs);

    req.on("error", (caught: unknown) => {
      settle(err(requestFailure(caught, input)));
    });
    req.on("response", (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const rawRetryAfter: unknown = res.headers["retry-after"];
      const retryAfter = typeof rawRetryAfter === "string" ? rawRetryAfter : undefined;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          settle(ok({ status, retryAfter, body: null }));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        settle(ok({ status, retryAfter, body: Buffer.concat(chunks).toString("utf8") }));
      });
      res.on("error", (caught: unknown) => {
        settle(err({ kind: "io", code: codeOf(caught) }));
      });
      // 끝까지 읽기 전에 닫혔다(end가 먼저 오면 위에서 이미 해결됐다)
      res.on("close", () => {
        settle(err({ kind: "io", code: "aborted" }));
      });
    });
    req.end(input.body);
  });
}

/** 본문을 JSON으로 읽고 스키마로 검증한다. 없거나(64KB 초과), 읽지 못하거나, 모양이 틀리면 bad_response */
function bodyOf<S extends TSchema>(text: string | null, schema: S): Result<Static<S>, PairError> {
  if (text === null) return err({ kind: "bad_response" });
  const json = parseJson(text);
  if (!json.ok) return err({ kind: "bad_response" });
  const checked = parse(schema, json.value);
  if (!checked.ok) return err({ kind: "bad_response" });
  return ok(checked.value);
}

function classify(reply: HttpReply): Result<PairGrant, PairError> {
  if (reply.status === 200) {
    const body = bodyOf(reply.body, PairSuccessBody);
    if (!body.ok) return err(body.error);
    const { token, device } = body.value;
    return ok({ token, deviceId: device.id, deviceName: device.name });
  }
  if (reply.status === 400 || reply.status === 401 || reply.status === 429) {
    const body = bodyOf(reply.body, PairErrorBody);
    if (!body.ok) return err(body.error);
    return err(failureOf(reply.status, body.value.error, reply.retryAfter));
  }
  return err({ kind: "rejected", status: reply.status });
}

/** 오류 본문의 코드와 상태로 오류 kind를 정한다. 짝이 맞지 않는 것은 rejected다 */
function failureOf(status: number, code: string, retryAfter: string | undefined): PairError {
  if (status === 400 && code === "invalid_device_name") return { kind: "invalid_device_name" };
  if (status === 401 && code === "invalid_code") return { kind: "invalid_code" };
  if (status === 429 && code === "locked") {
    if (retryAfter === undefined || !DECIMAL_SECONDS.test(retryAfter)) {
      return { kind: "bad_response" };
    }
    return { kind: "locked", retryAfterSeconds: Number(retryAfter) };
  }
  return { kind: "rejected", status };
}
