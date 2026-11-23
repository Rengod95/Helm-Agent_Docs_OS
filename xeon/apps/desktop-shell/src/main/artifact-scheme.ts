// 아티팩트 프레임 URI 스킴 `fresnel-artifact://<토큰>/<경로>`. 모델이 프로젝트 폴더에 쓴 HTML, SVG, 이미지, 마크다운을 샌드박스 iframe에 보여 준다.
// 모델이 쓴 HTML은 믿지 않는다. 고치기 전에 읽는다.
//
// 보안 메모:
// - 프레임에는 IPC가 닿지 않는다. 명령 세 개는 메인 UI만 부른다. 프레임 토큰은 메인 UI가 받아 iframe 주소로만 쓴다.
// - CSP가 네트워크(connect, frame, worker, form)를 막는다. 프레임은 자기 토큰 주소 안에서만 움직인다(artifactNavigationAllowed).
// - 읽기는 프레임이 연 프로젝트 폴더(root) 안의 파일로만 한다. `..`, 절대 경로, 깨진 부호열은 403이고 프레임 기록에 남는다.
//   심볼릭 링크는 실제 경로로 풀어 root 안인지 한 번 더 본다.
// - 확장자 목록 밖의 파일(실행 파일, wasm 등)은 내주지 않는다. 크기 상한을 넘으면 413이다.
// - WHATWG URL 객체를 쓰지 않는다. Chromium이 주소의 `..`을 정리해도 정리된 주소는 토큰 아래 root 안에 머문다.
// 파일 경로 규칙과 실제 경로 검사는 view-scheme.ts의 함수를 그대로 쓴다.

import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellModule } from "./context.ts";
import {
  decodeOnce,
  isWithin,
  realpathAsync,
  relativeSegments,
  statusOf,
  tooBroad,
  withoutFragment,
  type AppFile,
  type Refusal,
  type Rejection,
} from "./view-scheme.ts";

export const ARTIFACT_SCHEME = "fresnel-artifact";
/** 디스크 파일 하나의 크기 상한. 넘으면 413이다 */
export const MAX_ARTIFACT_FILE_BYTES: number = 16 * 1024 * 1024;
/** 열 때 글로 넘기는 본문의 크기 상한(UTF-8 바이트). 넘으면 too_large다 */
export const MAX_ARTIFACT_TEXT_BYTES: number = 8 * 1024 * 1024;
/** 등록부가 지키는 프레임 수. 넘으면 가장 먼저 연 프레임부터 지운다 */
export const MAX_ARTIFACT_FRAMES = 64;
/** 프레임 하나의 거절 기록 상한. 넘는 기록은 버린다 */
export const MAX_FRAME_REFUSALS = 32;

const PREFIX = `${ARTIFACT_SCHEME}://`;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const encoder = new TextEncoder();

/** 확장자 → Content-Type. 목록에 없는 것(실행 파일, wasm, 지도 파일)은 내주지 않는다 */
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ["html", "text/html; charset=utf-8"],
  ["htm", "text/html; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["txt", "text/plain; charset=utf-8"],
  ["md", "text/plain; charset=utf-8"],
  ["csv", "text/plain; charset=utf-8"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["ico", "image/x-icon"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
]);

// view-scheme.ts와 같은 값이다(권한 정책 글자)
const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()";

/** 확장자로 Content-Type을 고른다. 확장자의 ASCII 글자만 소문자로 바꾼다. 목록에 없으면 undefined다 */
export function artifactContentTypeOf(file: string): string | undefined {
  const ext = path
    .extname(file)
    .slice(1)
    .replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
  return CONTENT_TYPES.get(ext);
}

/**
 * 아티팩트 프레임 문서 CSP. `base`는 `fresnel-artifact://<토큰>/`이다.
 * 네트워크와 중첩 프레임은 막고, 같은 프레임의 자원과 인라인 코드만 허용한다
 */
export function artifactCsp(base: string): string {
  return [
    "default-src 'none'",
    `script-src ${base} 'unsafe-inline'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `media-src ${base} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "manifest-src 'none'",
  ].join("; ");
}

/** 아티팩트 응답 헤더. `base`는 `fresnel-artifact://<토큰>/` 접두다 */
export function artifactHeaders(
  contentType: string,
  base: string,
): Readonly<Record<string, string>> {
  return {
    "Content-Type": contentType,
    // 불투명 origin 프레임이 모듈 스크립트를 CORS 모드로 가져오므로 필요하다(view-scheme과 같다)
    "Access-Control-Allow-Origin": "*",
    "Content-Security-Policy": artifactCsp(base),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
}

/** `image`면 프레임의 루트 주소가 entry를 가운데 맞춘 `<img>` 하나를 담은 작은 HTML을 준다 */
export type FrameWrap = "none" | "image";

export interface ArtifactFrameInput {
  /** 프로젝트 폴더의 절대 경로. `text`만 내줄 때는 null이다 */
  readonly root: string | null;
  /** 주 파일의 상대 경로("/"로 나눈다). root가 null이면 파일 이름만 쓴다 */
  readonly entry: string;
  /** null이 아니면 디스크 대신 이 글을 `entry`로 내준다(대화 기록의 옛 버전) */
  readonly text: string | null;
  readonly wrap: FrameWrap;
}

export type OpenErrorKind =
  | "bad_entry"
  | "forbidden_type"
  | "not_absolute"
  | "not_a_directory"
  | "too_broad"
  | "no_source"
  | "too_large";

export interface OpenedFrame {
  readonly token: string;
  readonly url: string;
}

export interface FrameRefusal {
  /** 요청한 경로(디코딩한 것). 디코딩이 안 되면 원문 꼬리다 */
  readonly path: string;
  readonly kind: Rejection;
}

export interface ArtifactFrames {
  open(input: ArtifactFrameInput): Result<OpenedFrame, { readonly kind: OpenErrorKind }>;
  /** 프레임의 거절 기록. 알 수 없는 토큰(없거나 밀려난 프레임)이면 undefined다 */
  refusals(token: string): readonly FrameRefusal[] | undefined;
  /** 파일 관리자에 보일 실제 경로(root/entry). root 안의 파일이어야 한다 */
  revealTarget(token: string): Promise<Result<string, { readonly kind: "not_found" | "no_root" }>>;
  /** 주소 하나를 파일로 푼다. `wantBody`가 false면(HEAD) 내용을 읽지 않는다 */
  resolve(uri: string, wantBody?: boolean): Promise<Result<AppFile, Refusal>>;
}

/** 프레임 하나의 상태. 등록부만 쥔다 */
interface FrameState {
  /** 열 때 푼 실제 root 경로. root가 없으면 null */
  readonly realRoot: string | null;
  readonly entry: string;
  readonly entrySegments: readonly string[];
  readonly entryType: string;
  /** 디스크 대신 내줄 entry 본문(UTF-8). 없으면 null */
  readonly textBytes: Uint8Array<ArrayBuffer> | null;
  readonly wrap: FrameWrap;
  /** 거절 기록. 같은 경로와 이유는 한 번만, 최대 MAX_FRAME_REFUSALS개 */
  readonly refusals: FrameRefusal[];
}

const defaultToken = (): string => randomBytes(16).toString("hex");

/** 프레임 등록부를 만든다. `home`은 사용자 홈 폴더이고 undefined면 홈 검사만 건너뛴다 */
export function createArtifactFrames(deps: {
  readonly randomToken?: () => string;
  readonly home: string | undefined;
}): ArtifactFrames {
  const randomToken = deps.randomToken ?? defaultToken;
  // Map은 넣은 순서를 지키므로 맨 앞이 가장 먼저 연 프레임이다
  const frames = new Map<string, FrameState>();
  return {
    open(input) {
      const segments = relativeSegments(input.entry);
      if (segments === undefined) return err({ kind: "bad_entry" });
      const entryType = artifactContentTypeOf(input.entry);
      if (entryType === undefined) return err({ kind: "forbidden_type" });
      const rootCheck = input.root === null ? ok(null) : checkRoot(input.root, deps.home);
      if (!rootCheck.ok) return err(rootCheck.error);
      if (input.root === null && input.text === null) return err({ kind: "no_source" });
      const textBytes = input.text === null ? null : encoder.encode(input.text);
      if (textBytes !== null && textBytes.byteLength > MAX_ARTIFACT_TEXT_BYTES) {
        return err({ kind: "too_large" });
      }
      const token = randomToken();
      frames.set(token, {
        realRoot: rootCheck.value,
        entry: input.entry,
        entrySegments: segments,
        entryType,
        textBytes,
        wrap: input.wrap,
        refusals: [],
      });
      if (frames.size > MAX_ARTIFACT_FRAMES) evictOldest(frames);
      const tail =
        input.wrap === "image"
          ? ""
          : segments.map((segment) => encodeURIComponent(segment)).join("/");
      return ok({ token, url: `${PREFIX}${token}/${tail}` });
    },

    refusals(token) {
      const frame = frames.get(token);
      return frame === undefined ? undefined : [...frame.refusals];
    },

    async revealTarget(token) {
      const frame = frames.get(token);
      if (frame === undefined) return err({ kind: "not_found" });
      const realRoot = frame.realRoot;
      if (realRoot === null) return err({ kind: "no_root" });
      const real = await realpathAsync(path.join(realRoot, ...frame.entrySegments));
      if (real === undefined || !isWithin(real, realRoot)) return err({ kind: "not_found" });
      const info = await attemptAsync(() => stat(real));
      if (!info.ok || !info.value.isFile()) return err({ kind: "not_found" });
      return ok(real);
    },

    async resolve(uri, wantBody = true) {
      const parsed = parseArtifactUri(uri);
      if (parsed === undefined) return err({ kind: "bad_request" });
      const frame = frames.get(parsed.token);
      if (frame === undefined) return err({ kind: "not_found" });
      // 이미지 모드의 루트 주소는 entry를 감싼 HTML을 준다
      if (parsed.tail === "" && frame.wrap === "image") {
        const page = encoder.encode(wrapperPage(frame.entrySegments));
        return ok(fileOf(page, "text/html; charset=utf-8", wantBody));
      }
      // 빈 꼬리는 entry다. 그 밖의 꼬리는 퍼센트 디코딩을 한 번만 한다
      const decoded = parsed.tail === "" ? frame.entry : decodeOnce(parsed.tail);
      if (decoded === undefined) return refuseIn(frame, parsed.tail, "outside_root");
      const segments = relativeSegments(decoded);
      if (segments === undefined) return refuseIn(frame, decoded, "outside_root");
      if (frame.textBytes !== null && segments.join("/") === frame.entry) {
        return ok(fileOf(frame.textBytes, frame.entryType, wantBody));
      }
      const realRoot = frame.realRoot;
      if (realRoot === null) return refuseIn(frame, decoded, "not_found");
      const real = await realpathAsync(path.join(realRoot, ...segments));
      if (real === undefined) return refuseIn(frame, decoded, "not_found");
      if (!isWithin(real, realRoot)) return refuseIn(frame, decoded, "outside_root");
      const info = await attemptAsync(() => stat(real));
      if (!info.ok) return refuseIn(frame, decoded, "not_found");
      if (info.value.isDirectory()) return refuseIn(frame, decoded, "not_a_file");
      if (!info.value.isFile()) return refuseIn(frame, decoded, "not_found");
      const contentType = artifactContentTypeOf(real);
      if (contentType === undefined) return refuseIn(frame, decoded, "forbidden_type");
      if (info.value.size > MAX_ARTIFACT_FILE_BYTES) return refuseIn(frame, decoded, "too_large");
      if (!wantBody) return ok({ body: new Uint8Array(), contentType });
      // stat과 읽기 사이에 파일이 커지는 경우는 view-scheme과 같이 허용한다. 본문은 Response용으로 한 번 복사한다
      const body = await attemptAsync(() => readFile(real));
      if (!body.ok) return refuseIn(frame, decoded, "not_found");
      return ok({ body: new Uint8Array(body.value), contentType });
    },
  };
}

/** 프로젝트 폴더를 검사하고 실제 경로를 돌려준다. 검사 순서는 모양, 실제 경로, 폴더 여부, 너무 넓은지다 */
function checkRoot(
  root: string,
  home: string | undefined,
): Result<string, { readonly kind: OpenErrorKind }> {
  if (!path.isAbsolute(root)) return err({ kind: "not_absolute" });
  const real = realpathSyncOrUndefined(root);
  if (real === undefined || !isDirectoryPath(real)) return err({ kind: "not_a_directory" });
  if (tooBroad(real, home)) return err({ kind: "too_broad" });
  return ok(real);
}

function evictOldest(frames: Map<string, FrameState>): void {
  const oldest = frames.keys().next();
  if (!oldest.done) frames.delete(oldest.value);
}

/** 거절을 기록하고 돌려준다. 프레임을 찾은 뒤에만 부른다(알 수 없는 토큰과 bad_request는 기록하지 않는다) */
function refuseIn(frame: FrameState, pathText: string, kind: Rejection): Result<never, Refusal> {
  if (frame.refusals.length < MAX_FRAME_REFUSALS) {
    const seen = frame.refusals.some((entry) => entry.path === pathText && entry.kind === kind);
    if (!seen) frame.refusals.push({ path: pathText, kind });
  }
  return err({ kind });
}

function fileOf(bytes: Uint8Array<ArrayBuffer>, contentType: string, wantBody: boolean): AppFile {
  return { body: wantBody ? bytes : new Uint8Array(), contentType };
}

/** 이미지 모드의 루트 HTML. entry를 가운데 맞춘 `<img>` 하나만 담는다 */
function wrapperPage(segments: readonly string[]): string {
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${encoded}" alt=""></body></html>`;
}

function ownOf(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function realpathSyncOrUndefined(file: string): string | undefined {
  const real = attempt(() => realpathSync(file));
  return real.ok ? real.value : undefined;
}

function isDirectoryPath(dir: string): boolean {
  const info = attempt(() => statSync(dir));
  return info.ok && info.value.isDirectory();
}

/** `fresnel-artifact://` 접두로 시작하는 주소에서 `fresnel-artifact://<토큰>/`을 얻는다. 토큰 모양이 틀리면 undefined다 */
function tokenBaseOf(url: string): string | undefined {
  const rest = url.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return undefined;
  const token = rest.slice(0, slash);
  return TOKEN_PATTERN.test(token) ? `${PREFIX}${token}/` : undefined;
}

interface ArtifactUri {
  readonly token: string;
  /** 토큰 뒤의 나머지. 퍼센트 인코딩 그대로다 */
  readonly tail: string;
}

/** 주소를 `(토큰, 나머지)`로 푼다. 접두, 질의와 조각 없음, 토큰 모양을 문자열 규칙으로 본다 */
function parseArtifactUri(uri: string): ArtifactUri | undefined {
  if (!uri.startsWith(PREFIX) || uri.includes("?") || uri.includes("#")) return undefined;
  const base = tokenBaseOf(uri);
  if (base === undefined) return undefined;
  return { token: base.slice(PREFIX.length, -1), tail: uri.slice(base.length) };
}

/**
 * 응답 하나. 성공은 파일 내용과 보안 헤더(HEAD면 본문 없음), 실패는 상태 코드와 빈 본문이다(이유 글을 내보내지 않는다).
 * 메서드는 GET과 HEAD만 받는다
 */
export async function respondArtifact(
  frames: ArtifactFrames,
  method: string,
  uri: string,
): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return failure("method_not_allowed");
  const parsed = parseArtifactUri(uri);
  if (parsed === undefined) return failure("bad_request");
  const found = await frames.resolve(uri, method === "GET");
  if (!found.ok) return failure(found.error.kind);
  const headers = artifactHeaders(found.value.contentType, `${PREFIX}${parsed.token}/`);
  return new Response(method === "HEAD" ? null : found.value.body, { status: 200, headers });
}

function failure(kind: Rejection): Response {
  return new Response(null, { status: statusOf(kind) });
}

/**
 * 프레임의 탐색을 허용할지 정한다. 아티팩트 프레임이 아니면(about:blank, 다른 스킴) 허용한다.
 * 아티팩트 프레임이면 같은 토큰 주소 안으로만 허용한다. 토큰 모양이 틀린 프레임 주소는 막는다
 */
export function artifactNavigationAllowed(frameUrl: string, targetUrl: string): boolean {
  if (!frameUrl.startsWith(PREFIX)) return true;
  const base = tokenBaseOf(frameUrl);
  return base !== undefined && targetUrl.startsWith(base);
}

const FRAME_OPEN_KEYS: readonly string[] = ["root", "entry", "text", "wrap"];

/** 문자열이면 그대로, null이면 null, 그 밖이면 undefined다. 입력이 `unknown`이라 이렇게 좁힌다 */
function stringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function wrapOf(value: unknown): FrameWrap | undefined {
  return value === "none" || value === "image" ? value : undefined;
}

/** `artifact_frame_open`의 인자를 읽는다. 키는 정확히 네 개여야 하고 값의 형식도 맞아야 한다 */
export function parseFrameOpenArgs(
  args: unknown,
): Result<ArtifactFrameInput, { readonly kind: "bad_shape" }> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return err({ kind: "bad_shape" });
  }
  const keys = Object.keys(args);
  if (
    keys.length !== FRAME_OPEN_KEYS.length ||
    !FRAME_OPEN_KEYS.every((key) => keys.includes(key))
  ) {
    return err({ kind: "bad_shape" });
  }
  const root = stringOrNull(ownOf(args, "root"));
  const entry = ownOf(args, "entry");
  const text = stringOrNull(ownOf(args, "text"));
  const wrap = wrapOf(ownOf(args, "wrap"));
  if (root === undefined || typeof entry !== "string" || text === undefined || wrap === undefined) {
    return err({ kind: "bad_shape" });
  }
  return ok({ root, entry, text, wrap });
}

/** `{ token }` 하나만 받는 명령(`artifact_frame_status`, `artifact_reveal`)의 인자를 읽는다 */
export function parseTokenArgs(args: unknown): Result<string, { readonly kind: "bad_shape" }> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return err({ kind: "bad_shape" });
  }
  const keys = Object.keys(args);
  if (keys.length !== 1 || !keys.includes("token")) return err({ kind: "bad_shape" });
  const token = ownOf(args, "token");
  if (typeof token !== "string") return err({ kind: "bad_shape" });
  return ok(token);
}

/**
 * 아티팩트 스킴 모듈. 명령 세 개와 스킴 처리기를 등록한다.
 * `reveal`은 실제 경로를 파일 관리자에 보이는 함수다(electron 쪽 파일이 준다)
 */
export function createArtifactSchemeModule(reveal: (target: string) => void): ShellModule {
  return {
    name: "artifact-scheme",
    // 권한은 view-scheme과 같은 수준이다. CSP가 실제 제한을 맡는다(bypassCSP 없음)
    schemes: [
      {
        scheme: ARTIFACT_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
      },
    ],
    register(ctx) {
      const frames = createArtifactFrames({ home: homedir() });
      // 메인 UI만 부른다. 프레임은 IPC에 닿지 않는다(main.ts와 frame-check.ts)
      ctx.handle("artifact_frame_open", (_caller, args) => {
        const parsed = parseFrameOpenArgs(args);
        if (!parsed.ok) throw new ShellError(parsed.error.kind);
        const opened = frames.open(parsed.value);
        if (!opened.ok) throw new ShellError(opened.error.kind);
        return { token: opened.value.token, url: opened.value.url };
      });
      ctx.handle("artifact_frame_status", (_caller, args) => {
        const token = parseTokenArgs(args);
        if (!token.ok) throw new ShellError(token.error.kind);
        const refused = frames.refusals(token.value);
        if (refused === undefined) throw new ShellError("not_found");
        return { refused };
      });
      ctx.handle("artifact_reveal", async (_caller, args) => {
        const token = parseTokenArgs(args);
        if (!token.ok) throw new ShellError(token.error.kind);
        const target = await frames.revealTarget(token.value);
        if (!target.ok) throw new ShellError(target.error.kind);
        reveal(target.value);
        return null;
      });
      ctx.handleScheme(ARTIFACT_SCHEME, (request) =>
        respondArtifact(frames, request.method, withoutFragment(request.url)),
      );
    },
  };
}
