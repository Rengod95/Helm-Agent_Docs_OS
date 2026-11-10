// 요청 하나의 처리(spec §5.2, §8.4, §8.5). 순서는 고정이다: Host(421) → Origin(403, 상태를 바꾸는 요청과 업그레이드) → 경로.
// 모든 응답은 `securityHeaders`를 달고, CORS 헤더를 내지 않는다. 쿠키는 HTTPS면 `__Host-`, 루프백이면 평문 이름이다.
import path from "node:path";
import {
  attemptAsync,
  err,
  ok,
  parseJson,
  type Clock,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import { clearDeviceCookie, deviceTokenOf, serializeDeviceCookie } from "../auth/cookies.ts";
import type { AuthPort, RedeemError } from "../auth/auth-port.ts";
import type { DeviceInfo } from "../auth/devices.ts";
import { securityHeaders } from "../auth/headers.ts";
import { checkHost, checkOrigin } from "../auth/origin.ts";
import { appCsp, loginCsp } from "./csp.ts";
import {
  bodyErrorResponse,
  jsonResponse,
  MAX_PAIR_BODY_BYTES,
  MAX_PUSH_BODY_BYTES,
  methodNotAllowed,
  readBodyText,
  redirectTo,
  responseWith,
  textResponse,
  type HeaderMap,
} from "./http.ts";
import { parsePairRequest } from "./pair.ts";
import type { PushService } from "./ports.ts";
import { locateFile, pathSegments } from "./static.ts";
import type { SocketData } from "./link.ts";
import { respondView, VIEW_PREFIX } from "../view/route.ts";
import type { ViewTokens } from "../view/tokens.ts";

export interface ListenerConfig {
  readonly kind: "loopback" | "tls";
  /** TLS 리스너가 받는 `Host` 이름(루프백은 `localhost`, `127.0.0.1`, `[::1]`으로 정해져 있다) */
  readonly allowedHosts: readonly string[];
}

export interface RouteDeps {
  readonly auth: AuthPort;
  readonly push: PushService | null;
  readonly uiDir: string;
  readonly staticDir: string;
  /** 시작 때 한 번 만든 shim 번들 글자(`/shell/shim.js`) */
  readonly shimBody: string;
  /** 시작 때 한 번 묶은 로그인 화면 스크립트(`/login.js`) */
  readonly loginBody: string;
  /** 시작 때 한 번 받은 서비스 워커 스크립트(`/sw.js`). 파일을 직접 읽지 않는다 */
  readonly serviceWorkerBody: string;
  /** 플러그인 프레임의 권한 토큰(`/view/<토큰>/…`) */
  readonly views: ViewTokens;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface Ctx {
  readonly req: Request;
  readonly server: Bun.Server<SocketData>;
  readonly tls: boolean;
  /** Host 검사를 통과한 `Host` 헤더 값(포트 포함). CSP의 연결 출처로 쓴다 */
  readonly host: string;
  readonly listener: ListenerConfig;
  readonly deps: RouteDeps;
}

type Caller = Result<DeviceInfo, { readonly kind: "unauthenticated" }>;

/** `POST`만 받는 경로. 다른 방법이면 405 */
const POST_PATHS: ReadonlySet<string> = new Set(["/pair", "/push/subscribe", "/logout"]);

/** 페이지 `<head>`의 첫 요소로 넣는 shim 태그. 파일 참조뿐이라 CSP `script-src 'self'`로 충족된다(spec §8.7) */
export const SHIM_TAG = '<script src="/shell/shim.js"></script>';
const HEAD_OPEN = /<head(?:\s[^>]*)?>/iu;

/** `<head>` 바로 뒤에 shim 태그를 넣는다. `<head>`가 없으면 `null` */
export function injectShim(html: string): string | null {
  const match = HEAD_OPEN.exec(html);
  if (match === null) return null;
  const at = match.index + match[0].length;
  return `${html.slice(0, at)}${SHIM_TAG}${html.slice(at)}`;
}

/** 요청 하나를 처리한다. 업그레이드에 성공하면 `undefined`(Bun이 연결을 넘겨받는다) */
export function handleRequest(
  req: Request,
  server: Bun.Server<SocketData>,
  listener: ListenerConfig,
  deps: RouteDeps,
): Response | Promise<Response> | undefined {
  const tls = listener.kind === "tls";
  const hostHeader = req.headers.get("host");
  const port = server.port;
  const host = checkHost({
    host: hostHeader,
    loopback: !tls,
    allowedHosts: listener.allowedHosts,
    ...(port === undefined ? {} : { port }),
  });
  if (!host.ok) {
    deps.logger.warn("gateway.host_rejected", { listener: listener.kind });
    return jsonResponse(tls, 421, { error: "host_not_allowed" });
  }
  const upgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
  const stateChanging = (req.method !== "GET" && req.method !== "HEAD") || upgrade;
  // 프레임은 sandbox라 출처가 불투명하다. 모듈 스크립트와 글꼴 요청이 `Origin: null`을 싣는다.
  // `/view/`의 GET과 HEAD는 읽기뿐이고 경로의 권한 토큰으로 인증하므로 Origin 검사를 하지 않는다(spec §6.3)
  const frameRead = !stateChanging && new URL(req.url).pathname.startsWith(VIEW_PREFIX);
  const origin = checkOrigin({
    origin: frameRead ? null : req.headers.get("origin"),
    host: hostHeader ?? "",
    scheme: tls ? "https" : "http",
    stateChanging,
  });
  if (!origin.ok) {
    deps.logger.warn("gateway.origin_rejected", {
      listener: listener.kind,
      reason: origin.error.kind,
    });
    return jsonResponse(tls, 403, { error: origin.error.kind });
  }
  const ctx: Ctx = { req, server, tls, host: hostHeader ?? "", listener, deps };
  return route(ctx, new URL(req.url).pathname, upgrade);
}

function route(
  ctx: Ctx,
  pathname: string,
  upgrade: boolean,
): Response | Promise<Response> | undefined {
  const { req, tls } = ctx;
  if (pathname === "/wire" || pathname === "/shell") {
    if (req.method !== "GET") return methodNotAllowed(tls, ["GET"]);
    if (!upgrade)
      return jsonResponse(tls, 426, { error: "upgrade_required" }, { upgrade: "websocket" });
    return upgradeSocket(ctx, pathname === "/wire" ? "wire" : "shell");
  }
  if (pathname.startsWith(VIEW_PREFIX)) {
    const url = new URL(req.url);
    return respondView(ctx.deps.views, {
      method: req.method,
      pathname,
      search: url.search,
      tls,
      host: ctx.host,
    });
  }
  if (POST_PATHS.has(pathname)) {
    if (req.method !== "POST") return methodNotAllowed(tls, ["POST"]);
    return postRoute(ctx, pathname);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return methodNotAllowed(tls, ["GET", "HEAD"]);
  }
  return getRoute(ctx, pathname);
}

function getRoute(ctx: Ctx, pathname: string): Response | Promise<Response> {
  const { deps, tls } = ctx;
  if (pathname === "/login") return serveStatic(ctx, deps.staticDir, ["login.html"], {}, "login");
  if (pathname === "/login.css") return serveStatic(ctx, deps.staticDir, ["login.css"], {}, "app");
  if (pathname === "/login.js") return assetRoute(ctx, deps.loginBody, {});
  if (pathname === "/sw.js") {
    return assetRoute(ctx, deps.serviceWorkerBody, { "service-worker-allowed": "/" });
  }
  if (pathname === "/" || pathname === "/index.html") return indexRoute(ctx);
  if (pathname === "/shell/shim.js") return assetRoute(ctx, deps.shimBody, {});
  if (pathname === "/push/vapid-key") return vapidRoute(ctx);
  if (pathname === "/api/session") return sessionRoute(ctx);
  const segments = pathSegments(pathname);
  if (segments === null) return notFound(tls);
  return serveStatic(ctx, deps.uiDir, segments, {}, "app");
}

function postRoute(ctx: Ctx, pathname: string): Promise<Response> | Response {
  if (pathname === "/pair") return pairRoute(ctx);
  if (pathname === "/push/subscribe") return pushSubscribeRoute(ctx);
  return logoutRoute(ctx);
}

function addressOf(ctx: Ctx): string {
  return ctx.server.requestIP(ctx.req)?.address ?? "unknown";
}

/** 요청의 기기 토큰(`Authorization: Bearer`가 먼저, 없으면 쿠키)을 검증한다. 실패 사유는 `AuthPort`가 로그로 남긴다 */
function authenticate(ctx: Ctx): Caller {
  const token = deviceTokenOf(
    {
      cookie: ctx.req.headers.get("cookie"),
      authorization: ctx.req.headers.get("authorization"),
    },
    ctx.tls,
  );
  const verified = ctx.deps.auth.verifyToken(token, addressOf(ctx));
  if (!verified.ok) return err({ kind: "unauthenticated" });
  return ok(verified.value);
}

function notFound(tls: boolean): Response {
  return textResponse(tls, 404, "not found");
}

function upgradeSocket(ctx: Ctx, kind: "wire" | "shell"): Response | undefined {
  const caller = authenticate(ctx);
  // 인증이 실패하면 업그레이드하지 않는다. 서비스 연결은 업그레이드 뒤(`open`)에서만 만든다
  if (!caller.ok) return jsonResponse(ctx.tls, 401, { error: "unauthenticated" });
  const upgraded = ctx.server.upgrade(ctx.req, {
    data: { kind, device: caller.value, link: null },
    headers: securityHeaders({ tls: ctx.tls }),
  });
  return upgraded ? undefined : jsonResponse(ctx.tls, 400, { error: "upgrade_failed" });
}

async function indexRoute(ctx: Ctx): Promise<Response> {
  const { tls, deps, req } = ctx;
  const caller = authenticate(ctx);
  if (!caller.ok) return redirectTo(tls, "/login");
  const read = await attemptAsync(() => Bun.file(path.join(deps.uiDir, "index.html")).text());
  if (!read.ok) {
    deps.logger.error("gateway.ui_unavailable");
    return textResponse(tls, 500, "ui bundle unavailable");
  }
  const html = injectShim(read.value);
  if (html === null) {
    deps.logger.error("gateway.ui_head_missing");
    return textResponse(tls, 500, "ui bundle unavailable");
  }
  return responseWith(tls, 200, req.method === "HEAD" ? null : html, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    "content-security-policy": appCsp({ tls, host: ctx.host }),
  });
}

/** 메모리에 든 스크립트 글자를 내준다(shim, 로그인 스크립트, 서비스 워커). 인증 없이 받는다(시크릿이 없다) */
function assetRoute(ctx: Ctx, body: string, extra: HeaderMap): Response {
  return responseWith(ctx.tls, 200, ctx.req.method === "HEAD" ? null : body, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
    ...extra,
  });
}

function sessionRoute(ctx: Ctx): Response {
  const caller = authenticate(ctx);
  if (!caller.ok) return jsonResponse(ctx.tls, 401, { error: "unauthenticated" });
  const { id, name, kind } = caller.value;
  return jsonResponse(ctx.tls, 200, { device: { id, name, kind } });
}

function vapidRoute(ctx: Ctx): Response {
  const caller = authenticate(ctx);
  if (!caller.ok) return jsonResponse(ctx.tls, 401, { error: "unauthenticated" });
  const push = ctx.deps.push;
  if (push === null) return notFound(ctx.tls);
  return jsonResponse(ctx.tls, 200, { publicKey: push.vapidPublicKey() });
}

/** 정적 파일 응답. 찾지 못하면 404다. `document`는 HTML일 때 붙일 CSP를 고른다 */
async function serveStatic(
  ctx: Ctx,
  root: string,
  segments: readonly string[],
  extra: HeaderMap,
  document: "app" | "login",
): Promise<Response> {
  const { tls, req } = ctx;
  const located = await locateFile(root, segments);
  if (!located.ok) return notFound(tls);
  const file = located.value;
  const headers: Record<string, string> = {
    "content-type": file.contentType,
    etag: file.etag,
    "cache-control": "no-cache",
    ...extra,
  };
  if (file.contentType.startsWith("text/html")) {
    headers["content-security-policy"] =
      document === "login" ? loginCsp({ tls, host: ctx.host }) : appCsp({ tls, host: ctx.host });
  }
  if (req.headers.get("if-none-match") === file.etag) return responseWith(tls, 304, null, headers);
  if (req.method === "HEAD") {
    return responseWith(tls, 200, null, { ...headers, "content-length": String(file.size) });
  }
  return responseWith(tls, 200, Bun.file(file.path), headers);
}

async function pairRoute(ctx: Ctx): Promise<Response> {
  const { req, tls, deps } = ctx;
  const body = await readBodyText(req, MAX_PAIR_BODY_BYTES);
  if (!body.ok) return bodyErrorResponse(tls, body.error);
  const parsed = parsePairRequest(body.value);
  if (!parsed.ok) return jsonResponse(tls, 400, { error: "invalid_body" });
  const { code, deviceName, kind } = parsed.value;
  const paired = deps.auth.redeemPairingCode({ code, deviceName, kind, address: addressOf(ctx) });
  if (!paired.ok) return pairFailure(tls, paired.error);
  const { device, token } = paired.value;
  const summary = { id: device.id, name: device.name };
  // 데스크톱은 토큰을 응답 본문으로 받아 OS 보안 저장소에 둔다. 웹은 쿠키로만 받는다(본문에 토큰을 싣지 않는다)
  if (kind === "desktop") return jsonResponse(tls, 200, { ok: true, device: summary, token });
  const expiresAt = device.sessionExpiresAt;
  if (expiresAt === null) {
    deps.logger.error("gateway.pair_without_expiry", { deviceId: device.id });
    return jsonResponse(tls, 500, { error: "store_failed" });
  }
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - deps.clock.now()) / 1000));
  return jsonResponse(
    tls,
    200,
    { ok: true, device: summary },
    { "set-cookie": serializeDeviceCookie(token, { secure: tls, maxAgeSeconds }) },
  );
}

/** 페어링 실패를 상태 코드로. 저장 실패는 세부를 싣지 않는다 */
function pairFailure(tls: boolean, error: RedeemError): Response {
  if (error.kind === "invalid_code") return jsonResponse(tls, 401, { error: "invalid_code" });
  if (error.kind === "locked") {
    const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return jsonResponse(tls, 429, { error: "locked" }, { "retry-after": String(seconds) });
  }
  if (error.kind === "invalid_device_name") {
    return jsonResponse(tls, 400, { error: "invalid_device_name" });
  }
  return jsonResponse(tls, 500, { error: "store_failed" });
}

async function pushSubscribeRoute(ctx: Ctx): Promise<Response> {
  const { req, tls, deps } = ctx;
  const caller = authenticate(ctx);
  if (!caller.ok) return jsonResponse(tls, 401, { error: "unauthenticated" });
  const push = deps.push;
  if (push === null) return notFound(tls);
  const body = await readBodyText(req, MAX_PUSH_BODY_BYTES);
  if (!body.ok) return bodyErrorResponse(tls, body.error);
  const json = parseJson(body.value);
  if (!json.ok) return jsonResponse(tls, 400, { error: "invalid_body" });
  const subscribed = push.subscribe(caller.value.id, json.value);
  if (subscribed.ok) return jsonResponse(tls, 200, { ok: true });
  if (subscribed.error.kind === "store_failed") {
    return jsonResponse(tls, 500, { error: "store_failed" });
  }
  return jsonResponse(tls, 400, { error: subscribed.error.kind });
}

/** 로그아웃: 쿠키만 지운다. 기기는 폐기하지 않는다(폐기는 데스크톱의 기기 목록에서) */
function logoutRoute(ctx: Ctx): Response {
  const caller = authenticate(ctx);
  if (!caller.ok) return jsonResponse(ctx.tls, 401, { error: "unauthenticated" });
  return jsonResponse(ctx.tls, 200, { ok: true }, { "set-cookie": clearDeviceCookie(ctx.tls) });
}
