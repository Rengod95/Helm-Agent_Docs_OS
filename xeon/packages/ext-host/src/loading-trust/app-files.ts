// Plugin App 파일 경로 풀이(X.loading-trust.spec §4.3.4, ADR-0021 §3.6.2). desktop의 전용 URL 스킴이 요청 경로를 이 함수로 풀어
// 확장 패키지의 app root 안 파일 하나만 내준다. 파일 내용은 읽지 않고 LoaderFs의 존재·실제 경로·나열만 쓴다.
import { basename, dirname, join, sep } from "node:path";
import { attempt, attemptAsync } from "@fresnel/contracts";
import { isEntryInsideRoot, type AppDecl, type LoaderFs } from "@fresnel/contracts/extensions";

/** 풀이가 거부된 이유. `outside_root`는 app root 밖을 가리키거나 경로 모양이 잘못된 요청이다 */
type AppFileRejection = "outside_root" | "not_found" | "not_a_file" | "forbidden_type";

export type AppFileResult =
  | { readonly ok: true; readonly path: string; readonly contentType: string }
  | { readonly ok: false; readonly reason: AppFileRejection };

export interface ResolveAppFileInput {
  /** 확장 루트 절대 경로. `app.root`는 이 아래 상대 경로다 */
  readonly extensionRoot: string;
  readonly app: AppDecl;
  /** app root 안의 URL 경로. 한 번만 퍼센트 디코딩한다. 빈 문자열이면 `app.entry`다 */
  readonly requestPath: string;
  readonly fs: LoaderFs;
}

/** 허용 확장자와 응답 Content-Type. 목록에 없는 것(wasm 포함)은 `forbidden_type`이다 */
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

/** `path`가 `base` 안이거나 `base` 자체인가. 둘 다 실제 경로(심볼릭 링크를 푼 것)여야 한다 */
export function within(path: string, base: string): boolean {
  return path === base || path.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/**
 * 상대 경로 모양 검사. 빈 문자열, 백슬래시, NUL, 절대 경로, 드라이브 문자, 빈 마디, `.`과 `..` 마디를 거부한다.
 * 퍼센트 디코딩 뒤의 문자열에도 같은 검사를 한다
 */
function isSafeRelative(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** 요청 경로를 app root 기준 상대 경로로 바꾼다. 모양이 틀리면 undefined다 */
function relativeOf(requestPath: string, entry: string): string | undefined {
  if (requestPath === "") return isSafeRelative(entry) ? entry : undefined;
  // 한 번만 푼다. `%252e%252e`는 `%2e%2e`가 되고 `..`이 되지 않는다. 깨진 퍼센트 부호열은 던지지 않고 거부한다
  const decoded = attempt(() => decodeURIComponent(requestPath));
  if (!decoded.ok) return undefined;
  return isSafeRelative(decoded.value) ? decoded.value : undefined;
}

/** 파일 이름의 확장자로 Content-Type을 고른다. 목록에 없거나 확장자가 없으면 undefined다 */
function contentTypeOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  return CONTENT_TYPES.get(name.slice(dot + 1).toLowerCase());
}

/**
 * 실제 경로 하나가 파일인지 폴더인지 본다. LoaderFs에 종류를 묻는 함수가 없으므로 부모 폴더 나열로 구한다.
 * 없으면 undefined다. 실제 경로는 심볼릭 링크가 아니므로 링크 종류는 나오지 않는다
 */
export async function kindOf(fs: LoaderFs, path: string): Promise<"file" | "dir" | undefined> {
  const listed = await attemptAsync(() => fs.listDir(dirname(path)));
  if (!listed.ok || listed.value === null) return undefined;
  const name = basename(path);
  const found = listed.value.find((entry) => entry.name === name);
  if (found?.kind === "dir") return "dir";
  if (found?.kind === "file") return "file";
  return undefined;
}

/**
 * Plugin App 요청 경로 하나를 파일로 풀어 준다. 순서는 모양 검사, app root 실제 경로(확장 루트 안인지 포함),
 * 요청 파일의 존재, 실제 경로가 app root 안인지, 파일인지, 확장자 허용 목록이다. fs 포트가 던지면 찾지 못한 것으로 본다
 */
export async function resolveAppFile(input: ResolveAppFileInput): Promise<AppFileResult> {
  const { fs } = input;
  const relative = relativeOf(input.requestPath, input.app.entry);
  if (relative === undefined || !isEntryInsideRoot(input.app.root)) {
    return { ok: false, reason: "outside_root" };
  }
  const appRoot = join(input.extensionRoot, input.app.root);
  const extensionReal = await attemptAsync(() => fs.realpath(input.extensionRoot));
  const rootReal = await attemptAsync(() => fs.realpath(appRoot));
  if (!extensionReal.ok || !rootReal.ok) return { ok: false, reason: "not_found" };
  // app root 자체가 심볼릭 링크로 확장 밖을 가리키면 그 안의 파일도 밖이다
  if (!within(rootReal.value, extensionReal.value)) return { ok: false, reason: "outside_root" };

  const declared = join(appRoot, relative);
  const present = await attemptAsync(() => fs.exists(declared));
  if (!present.ok || !present.value) return { ok: false, reason: "not_found" };
  const real = await attemptAsync(() => fs.realpath(declared));
  if (!real.ok) return { ok: false, reason: "not_found" };
  if (!within(real.value, rootReal.value)) return { ok: false, reason: "outside_root" };

  const kind = await kindOf(fs, real.value);
  if (kind === undefined) return { ok: false, reason: "not_found" };
  if (kind === "dir") return { ok: false, reason: "not_a_file" };
  const contentType = contentTypeOf(basename(real.value));
  if (contentType === undefined) return { ok: false, reason: "forbidden_type" };
  return { ok: true, path: real.value, contentType };
}
