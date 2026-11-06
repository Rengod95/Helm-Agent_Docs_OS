// 프레임 전용 URI 스킴 `fresnel-view://<확장이름>/<버전>/<경로>`(ADR-0021 §3.6.2, §3.6.3, X.loading-trust.spec §4.3.4)와 app root 목록 명령 `app_roots_set`.
// 프레임 파일은 이 스킴으로만 나온다. 앱 자원, 다른 확장의 파일, app root 밖은 나오지 않는다.
//
// 옛 Tauri 구현(커밋 424f338a)의 `view_scheme.rs`와 같은 동작이다. 경로 규칙은 TS `resolveAppFile`과 같다(한 번만 퍼센트 디코딩).
// 응답 헤더와 CSP 글자는 `packages/client/src/views/app/scheme.ts`와 같고, test/view-scheme.test.ts가 그 글자를 맞춰 본다.
//
// 보안 메모(고치기 전에 읽는다):
// - 프레임에는 IPC가 닿지 않는다. main.ts는 발신 프레임이 최상위이고 우리 UI 출처일 때만 명령을 부른다(frame-check.ts).
//   그래서 app_roots_set은 메인 UI만 부를 수 있다. 이 모듈은 프레임이 IPC를 부를 수 있다고 가정하지 않는다.
// - 이 스킴 처리기는 등록된 app root 밖의 파일을 내주지 않는다. 글자 검사 뒤에 실제 경로(심볼릭 링크를 푼 것) 검사가 한 번 더 있다.
// - app root 목록은 설치 폴더 모양을 다시 본다(확장 설치 폴더 안, `/`·홈 거부). 한 항목이 다른 확장의 화면을 막지 못한다.
// - WHATWG URL은 `.`, `..` 마디를 정리한다. Bun에서 확인했고, Chromium도 표준 스킴 요청에 같은 정리를 하는 것으로 본다(Electron 실기로 확인할 것).
//   그러면 프레임이 `..`을 보내도 이 처리기는 정리된 주소를 받는다. 그 주소는 버전 자리가 어긋나 400이 되거나 root 안의 경로로 풀린다. 밖으로 나가지는 못한다.
//   아래 검사는 원문 주소에 대해서도 그대로 둔다(Rust 시험과 같은 글자).

import { realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { assertNever, attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellModule } from "./context.ts";

export const SCHEME = "fresnel-view";
/** 파일 하나의 크기 상한. 넘으면 413이다 */
export const MAX_FILE_BYTES: number = 16 * 1024 * 1024;
/** 한 번에 등록하는 항목 수 상한. 넘으면 목록 전체를 거부한다 */
export const MAX_ROOTS = 256;

/** 확장자 → Content-Type. 목록에 없는 것(wasm 포함)은 내주지 않는다 */
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ["html", "text/html; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["map", "application/json; charset=utf-8"],
  ["txt", "text/plain; charset=utf-8"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["ttf", "font/ttf"],
]);

/** 프레임 문서 CSP. `{base}` 자리에 `fresnel-view://<확장이름>/<버전>/`을 넣는다. TS `appFrameCsp`와 같은 글자다 */
const FRAME_CSP_PARTS: readonly string[] = [
  "default-src 'none'",
  "script-src {base}",
  "style-src {base} 'unsafe-inline'",
  "img-src {base} data: blob:",
  "font-src {base}",
  "media-src {base} blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src {base} blob:",
  "form-action 'none'",
  "base-uri 'none'",
];

const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()";

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]{1,32})?$/;

/** 프레임 문서 CSP 문자열. `base`는 `validExtensionName`과 `validVersion`을 통과한 마디로 만든 `fresnel-view://<확장>/<버전>/`이어야 한다 */
export function frameCsp(base: string): string {
  return FRAME_CSP_PARTS.map((part) => part.replaceAll("{base}", base)).join("; ");
}

/** 확장 이름 마디: `^[a-z][a-z0-9-]{0,63}$` */
export function validExtensionName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** 버전 마디: `숫자.숫자.숫자` 뒤에 선택적 `-<영숫자.->`(최대 32자) */
export function validVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

/** 프레임 응답 헤더. `contentType`은 확장자로 고른 값, `base`는 주소 접두다. Rust `respond`와 같은 이름과 값이다 */
export function frameHeaders(contentType: string, base: string): Readonly<Record<string, string>> {
  return {
    "Content-Type": contentType,
    // 불투명 origin(`null`) 프레임이 `<script type="module">`을 CORS 모드로 가져오므로 필요하다(ADR-0021 §3.6.3)
    "Access-Control-Allow-Origin": "*",
    "Content-Security-Policy": frameCsp(base),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
}

/** 거절 이유. 이름은 Rust `Rejection`과 같다. 응답에는 이유 글을 싣지 않고 상태 코드만 준다 */
export type Rejection =
  | "bad_request"
  | "outside_root"
  | "not_found"
  | "not_a_file"
  | "forbidden_type"
  | "too_large"
  | "method_not_allowed";

export interface Refusal {
  readonly kind: Rejection;
}

/** 거절 이유 하나의 상태 코드. Rust `Rejection::status`와 같다 */
export function statusOf(rejection: Rejection): number {
  switch (rejection) {
    case "bad_request":
      return 400;
    case "outside_root":
    case "forbidden_type":
      return 403;
    case "not_found":
    case "not_a_file":
      return 404;
    case "method_not_allowed":
      return 405;
    case "too_large":
      return 413;
    default:
      return assertNever(rejection, "view-scheme Rejection");
  }
}

/** 주소를 `(확장 이름, 버전, 나머지 경로)`로 푼다. 나머지는 퍼센트 인코딩 그대로다 */
export interface FrameUri {
  readonly extension: string;
  readonly version: string;
  readonly tail: string;
}

/**
 * 주소를 푼다. 스킴, 확장 이름, 버전 모양이 틀리거나 질의·조각·계정 정보가 있으면 undefined다.
 * Rust `parse_uri`와 같은 문자열 규칙이다(URL 객체를 쓰지 않는다)
 */
export function parseUri(uri: string): FrameUri | undefined {
  const prefix = `${SCHEME}://`;
  if (!uri.startsWith(prefix)) return undefined;
  const rest = uri.slice(prefix.length);
  if (rest.includes("?") || rest.includes("#")) return undefined;
  const slash = rest.indexOf("/");
  if (slash < 0) return undefined;
  const authority = rest.slice(0, slash);
  if (authority.includes("@") || authority.includes(":") || !validExtensionName(authority)) {
    return undefined;
  }
  const after = rest.slice(slash + 1);
  const cut = after.indexOf("/");
  const version = cut < 0 ? after : after.slice(0, cut);
  const tail = cut < 0 ? "" : after.slice(cut + 1);
  if (!validVersion(version)) return undefined;
  return { extension: authority, version, tail };
}

/** 상대 경로 모양 검사. 마디로 나눠 돌려준다. 빈 문자열, 백슬래시, NUL, 앞 `/`, 드라이브 문자, 빈 마디, `.`, `..`은 undefined다 */
function relativeSegments(relative: string): readonly string[] | undefined {
  if (relative === "" || relative.includes("\\") || relative.includes("\0")) return undefined;
  if (relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) return undefined;
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments;
}

/** 퍼센트 디코딩을 한 번만 한다. 깨진 부호열이나 UTF-8이 아니면 undefined다(`decodeURIComponent`가 두 경우 모두 던진다) */
function decodeOnce(tail: string): string | undefined {
  const decoded = attempt(() => decodeURIComponent(tail));
  return decoded.ok ? decoded.value : undefined;
}

/** 확장자로 Content-Type을 고른다. 확장자가 없거나 목록에 없으면 undefined다. 확장자의 ASCII 글자만 소문자로 바꾼다 */
function contentTypeOf(file: string): string | undefined {
  const ext = path
    .extname(file)
    .slice(1)
    .replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
  return CONTENT_TYPES.get(ext);
}

/** `child`가 `base`와 같거나 `base` 안인가. 마디 단위로 본다(`/a/bc`는 `/a/b` 안이 아니다) */
function isWithin(child: string, base: string): boolean {
  return child === base || child.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);
}

/** 실제 경로(심볼릭 링크를 푼 것)를 얻는다. 없거나 풀 수 없으면 undefined다 */
function realpathOrUndefined(file: string): string | undefined {
  const real = attempt(() => realpathSync(file));
  return real.ok ? real.value : undefined;
}

async function realpathAsync(file: string): Promise<string | undefined> {
  const real = await attemptAsync(() => realpath(file));
  return real.ok ? real.value : undefined;
}

function isDirectory(dir: string): boolean {
  const info = attempt(() => statSync(dir));
  return info.ok && info.value.isDirectory();
}

/** 설치 등급. 값이 클수록 믿는다. `builtin`은 번들 자원이라 이 명령으로 등록하지 않는다 */
export type Tier = "project" | "user" | "managed";

const TIER_RANK: Readonly<Record<Tier, number>> = { project: 0, user: 1, managed: 2 };

/** `app_roots_set`의 항목 하나. 필드 이름과 값은 renderer의 `AppRootEntry`(app-roots.ts)와 같다 */
export interface AppRootInput {
  readonly extension: string;
  readonly version: string;
  /** app root 폴더의 절대 경로 */
  readonly root: string;
  /** root 안의 HTML 파일 상대 경로 */
  readonly entry: string;
  /** 설치 등급. root가 있어야 할 설치 폴더 모양과 겹침 우선순위가 이 값으로 정해진다 */
  readonly trust: Tier;
}

/** 항목 하나가 건너뛰어진 이유. 항목의 글(이름, 경로)은 옮기지 않는다 */
export type SkipKind =
  | "bad_name"
  | "bad_version"
  | "bad_entry"
  | "not_absolute"
  | "not_a_directory"
  | "too_broad"
  | "outside_install";

/** 건너뛴 항목 하나. `index`는 보낸 목록에서의 자리다 */
export interface SkippedRoot {
  readonly index: number;
  readonly kind: SkipKind;
}

/** 목록 전체가 거부되는 이유. `too_many`만 목록 전체에 해당하고 나머지는 항목별 건너뛰기다 */
export type RootsErrorKind = "too_many" | SkipKind;

export interface RootEntry {
  /** 등록 때 푼 실제 경로. 요청 때 다시 푼다 */
  readonly root: string;
  /** root 안 HTML의 상대 경로 */
  readonly entryPath: string;
  readonly tier: Tier;
}

export interface AppRoots {
  /**
   * 목록을 통째로 바꾼다. 항목 수가 한도를 넘으면 아무것도 바꾸지 않고 거부한다.
   * 나쁜 항목은 그 항목만 건너뛰고 자리와 이유를 돌려준다. `home`은 사용자 홈 폴더이고 undefined면 홈 검사만 건너뛴다.
   * 이 함수는 동기다. 목록 교체가 한 번에 보이도록 실제 경로 풀이도 동기로 한다(Rust `replace`와 같다)
   */
  replace(
    inputs: readonly AppRootInput[],
    home: string | undefined,
  ): Result<readonly SkippedRoot[], { readonly kind: RootsErrorKind }>;
  /** `(확장 이름, 버전)`의 등록을 찾는다. 등록이 없으면 undefined다 */
  lookup(extension: string, version: string): RootEntry | undefined;
}

/** `(확장 이름, 버전)` 키. 두 마디 모두 `/`를 담지 않으므로(검사를 거친다) 한 번만 쪼개진다 */
function keyOf(extension: string, version: string): string {
  return `${extension}/${version}`;
}

/** 등록하려는 `path`에서 위로 올라가며 본 폴더들(자기 자신 포함). Rust `Path::ancestors`와 같다 */
function ancestorsOf(start: string): string[] {
  const out: string[] = [];
  let dir = start;
  let parent = path.dirname(dir);
  out.push(dir);
  while (parent !== dir) {
    dir = parent;
    out.push(dir);
    parent = path.dirname(dir);
  }
  return out;
}

/** `dir`가 `…/extensions/<확장이름>` 폴더인가. 프로젝트 등급은 `.fresnel/extensions/<확장이름>`이어야 한다 */
function isInstallDirOf(dir: string, extension: string, tier: Tier): boolean {
  const parent = path.dirname(dir);
  if (path.basename(dir) !== extension || path.basename(parent) !== "extensions") return false;
  switch (tier) {
    case "project":
      return path.basename(path.dirname(parent)) === ".fresnel";
    case "user":
    case "managed":
      return true;
    default:
      return assertNever(tier, "view-scheme Tier");
  }
}

/** root가 확장의 설치 폴더 안인가. 설치 폴더가 root의 조상이거나 root 자신이어야 한다 */
function insideInstallDir(real: string, extension: string, tier: Tier): boolean {
  return ancestorsOf(real).some((dir) => isInstallDirOf(dir, extension, tier));
}

/** 마디 수(루트 `/`는 0)를 센다. Rust `components().count()`에서 루트 성분을 뺀 값이다 */
function depthOf(real: string): number {
  return real.split(path.sep).filter((segment) => segment !== "").length;
}

/** `/`, 홈 폴더, 홈 폴더를 품은 폴더, 너무 얕은 폴더(마디 둘 미만)인가. 홈은 실제 경로로 풀어 비교한다 */
function tooBroad(real: string, home: string | undefined): boolean {
  if (depthOf(real) < 2) return true;
  const realHome = home === undefined ? undefined : realpathOrUndefined(home);
  return realHome !== undefined && isWithin(realHome, real);
}

interface CheckedRoot {
  readonly key: string;
  readonly registered: RootEntry;
}

/** 항목 하나의 검사. 통과하면 등록할 값을, 아니면 건너뛰는 이유를 돌려준다. 검사 순서는 Rust와 같다 */
function checkEntry(
  input: AppRootInput,
  home: string | undefined,
): Result<CheckedRoot, { readonly kind: SkipKind }> {
  if (!validExtensionName(input.extension)) return err({ kind: "bad_name" });
  if (!validVersion(input.version)) return err({ kind: "bad_version" });
  if (relativeSegments(input.entry) === undefined) return err({ kind: "bad_entry" });
  if (!path.isAbsolute(input.root)) return err({ kind: "not_absolute" });
  const real = realpathOrUndefined(input.root);
  if (real === undefined || !isDirectory(real)) return err({ kind: "not_a_directory" });
  if (tooBroad(real, home)) return err({ kind: "too_broad" });
  if (!insideInstallDir(real, input.extension, input.trust)) {
    return err({ kind: "outside_install" });
  }
  return ok({
    key: keyOf(input.extension, input.version),
    registered: { root: real, entryPath: input.entry, tier: input.trust },
  });
}

/** 빈 `AppRoots`를 만든다. 등록은 통째로 바뀌므로 지난 목록에 남는 항목은 없다 */
export function createAppRoots(): AppRoots {
  let current = new Map<string, RootEntry>();
  return {
    replace(inputs, home) {
      if (inputs.length > MAX_ROOTS) return err({ kind: "too_many" });
      const next = new Map<string, RootEntry>();
      const skipped: SkippedRoot[] = [];
      for (const [index, input] of inputs.entries()) {
        const checked = checkEntry(input, home);
        if (!checked.ok) {
          skipped.push({ index, kind: checked.error.kind });
          continue;
        }
        const { key, registered } = checked.value;
        // 같은 이름과 버전이 여러 등급으로 오면 높은 등급이 이긴다. 프로젝트 확장이 사용자 확장의 root를 바꾸지 못한다
        const old = next.get(key);
        if (old !== undefined && TIER_RANK[old.tier] >= TIER_RANK[registered.tier]) continue;
        next.set(key, registered);
      }
      current = next;
      return ok(skipped);
    },
    lookup(extension, version) {
      return current.get(keyOf(extension, version));
    },
  };
}

/** 프레임 파일 하나. `body`는 HEAD 요청이면 비어 있다 */
export interface AppFile {
  readonly body: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
}

/**
 * 요청 주소 하나를 파일로 푼다. 순서는 주소 모양, 등록 여부, 퍼센트 디코딩과 마디 검사, app root의 실제 경로,
 * 파일 종류, 확장자, 크기다. `wantBody`가 false면(HEAD) 내용을 읽지 않는다
 */
export async function resolve(
  roots: AppRoots,
  uri: string,
  wantBody: boolean = true,
): Promise<Result<AppFile, Refusal>> {
  const parsed = parseUri(uri);
  if (parsed === undefined) return refuse("bad_request");
  const registered = roots.lookup(parsed.extension, parsed.version);
  if (registered === undefined) return refuse("not_found");
  const relative = parsed.tail === "" ? registered.entryPath : decodeOnce(parsed.tail);
  if (relative === undefined) return refuse("outside_root");
  const segments = relativeSegments(relative);
  if (segments === undefined) return refuse("outside_root");
  // 등록 때 푼 실제 경로를 요청 때 한 번 더 푼다. 그 폴더 안의 링크는 아래 실제 경로 검사가 잡는다
  const realRoot = await realpathAsync(registered.root);
  if (realRoot === undefined) return refuse("not_found");
  const real = await realpathAsync(path.join(realRoot, ...segments));
  if (real === undefined) return refuse("not_found");
  // `isWithin`은 마디 단위다. 실제 경로는 `..`을 담지 않는다(realpath가 푼다)
  if (!isWithin(real, realRoot)) return refuse("outside_root");
  const info = await attemptAsync(() => stat(real));
  if (!info.ok) return refuse("not_found");
  if (info.value.isDirectory()) return refuse("not_a_file");
  if (!info.value.isFile()) return refuse("not_found");
  const contentType = contentTypeOf(real);
  if (contentType === undefined) return refuse("forbidden_type");
  if (info.value.size > MAX_FILE_BYTES) return refuse("too_large");
  if (!wantBody) return ok({ body: new Uint8Array(), contentType });
  // stat과 읽기 사이에 파일이 커지는 경우는 Rust와 같이 허용한다. 설치 폴더는 그 확장만 쓴다
  // Response가 받는 본문은 ArrayBuffer 위의 배열이어야 해서 한 번 복사한다(최대 16 MiB)
  const body = await attemptAsync(() => readFile(real));
  return body.ok ? ok({ body: new Uint8Array(body.value), contentType }) : refuse("not_found");
}

function refuse(kind: Rejection): Result<never, Refusal> {
  return err({ kind });
}

function failure(kind: Rejection): Response {
  return new Response(null, { status: statusOf(kind) });
}

/**
 * 응답 하나. 성공은 파일 내용과 보안 헤더(HEAD면 본문 없음), 실패는 상태 코드와 빈 본문이다(이유 글을 내보내지 않는다).
 * `ctx.handleScheme`의 처리기가 이것을 부른다. 메서드는 GET과 HEAD만 받는다
 */
/** URL에서 `#` 뒤 조각을 뗀다 */
export function withoutFragment(url: string): string {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}

export async function respond(roots: AppRoots, method: string, uri: string): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return failure("method_not_allowed");
  const found = await resolve(roots, uri, method === "GET");
  if (!found.ok) return failure(found.error.kind);
  const parsed = parseUri(uri);
  if (parsed === undefined) return failure("bad_request");
  const base = `${SCHEME}://${parsed.extension}/${parsed.version}/`;
  const headers = frameHeaders(found.value.contentType, base);
  return new Response(method === "HEAD" ? null : found.value.body, { status: 200, headers });
}

const INPUT_KEYS: readonly string[] = ["extension", "version", "root", "entry", "trust"];

/** 객체의 자기 속성 값. 프로토타입 사슬은 보지 않는다 */
function ownOf(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

/** 등급 글이면 그 등급을, 아니면 undefined다. 입력이 `unknown`이라 비교로 좁힌다 */
function tierOf(text: unknown): Tier | undefined {
  return text === "project" || text === "user" || text === "managed" ? text : undefined;
}

/**
 * 항목 하나의 모양을 본다. 다섯 필드가 정확히 있어야 하고(Rust `deny_unknown_fields`), 등급은 세 글 중 하나여야 한다.
 * 이름과 버전, 경로의 뜻은 여기서 보지 않는다(항목별 건너뛰기로 `checkEntry`가 본다)
 */
function parseAppRootInput(value: unknown): AppRootInput | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== INPUT_KEYS.length || !INPUT_KEYS.every((key) => keys.includes(key))) {
    return undefined;
  }
  const extension = ownOf(value, "extension");
  const version = ownOf(value, "version");
  const root = ownOf(value, "root");
  const entry = ownOf(value, "entry");
  const trust = tierOf(ownOf(value, "trust"));
  if (
    typeof extension !== "string" ||
    typeof version !== "string" ||
    typeof root !== "string" ||
    typeof entry !== "string" ||
    trust === undefined
  ) {
    return undefined;
  }
  return { extension, version, root, entry, trust };
}

/**
 * `app_roots_set`의 인자 `{ entries }`를 읽는다. 하나라도 모양이 다르면 목록 전체를 `bad_shape`로 거부한다
 * (Rust에서 serde 역직렬화가 실패하는 자리다). 목록 수는 여기서 보지 않는다(`replace`가 본다)
 */
export function parseAppRootEntries(
  args: unknown,
): Result<readonly AppRootInput[], { readonly kind: "bad_shape" }> {
  const list = typeof args === "object" && args !== null ? ownOf(args, "entries") : undefined;
  if (!Array.isArray(list)) return err({ kind: "bad_shape" });
  const rows: readonly unknown[] = list;
  const inputs: AppRootInput[] = [];
  for (const row of rows) {
    const input = parseAppRootInput(row);
    if (input === undefined) return err({ kind: "bad_shape" });
    inputs.push(input);
  }
  return ok(inputs);
}

export const viewSchemeModule: ShellModule = {
  name: "view-scheme",
  // 권한은 필요한 만큼만 준다(스킴 등록은 app.ready 전이라 main.ts가 한 번에 등록한다). 아래 이유는 추정이라 Electron 실기로 확인할 것이다.
  // standard: 프레임 안의 상대 주소(`./app.js`, `../x.css`)가 이 스킴 안에서 풀리려면 표준 URL 스킴으로 등록해야 한다.
  // secure: 앱 문서의 `app://`과 같은 수준(secure)으로 맞춘다. 보안 문맥의 페이지에 든 비보안 스킴 프레임이 혼합 콘텐츠로 막히는 것을 피한다.
  // supportFetchAPI, corsEnabled: 불투명 origin 프레임이 `<script type="module">`을 CORS 모드로 가져온다. 응답의
  //   `Access-Control-Allow-Origin: *`가 읽히려면 이 스킴이 CORS를 쓰는 스킴이어야 한다(ADR-0021 §3.6.3은 WKWebView 실기로 확인했다).
  // bypassCSP, allowServiceWorkers, stream, codeCache, allowExtensions는 주지 않는다. 프레임 CSP가 그대로 적용된다.
  schemes: [
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ],
  register(ctx) {
    const roots = createAppRoots();
    // 메인 UI만 부른다. 프레임은 IPC에 닿지 않는다(main.ts와 frame-check.ts). 목록은 이 명령으로만 바뀐다
    ctx.handle("app_roots_set", (_caller, args) => {
      const parsed = parseAppRootEntries(args);
      if (!parsed.ok) throw new ShellError(parsed.error.kind);
      const result = roots.replace(parsed.value, homedir());
      if (!result.ok) throw new ShellError(result.error.kind);
      return result.value;
    });
    // 프레임 주소의 `#n=<nonce>` 조각은 요청 대상이 아니다. Electron은 request.url에 조각을 남기므로 떼고 넘긴다
    ctx.handleScheme(SCHEME, (request) =>
      respond(roots, request.method, withoutFragment(request.url)),
    );
  },
};
