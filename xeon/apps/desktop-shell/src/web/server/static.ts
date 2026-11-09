// 정적 파일 찾기(UI 번들과 로그인 화면 폴더). 경로 검사는 두 겹이다.
// 1) URL 경로를 먼저 디코드한 뒤 나눈다(`%2F`도 나눈다). 빈 조각, 점으로 시작하는 조각(`.`, `..`, 숨김 파일), `\`, NUL은 거절한다.
// 2) 찾은 파일의 실제 경로(심볼릭 링크를 따라간 뒤)가 루트 폴더 안에 있어야 한다. 밖을 가리키는 링크도 거절한다.
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";

export interface StaticFile {
  /** 심볼릭 링크를 풀고 루트 안인지 확인한 실제 경로 */
  readonly path: string;
  readonly contentType: string;
  /** 약한 ETag: 크기와 수정 시각으로 만든다 */
  readonly etag: string;
  readonly size: number;
}

export interface NotFound {
  readonly kind: "not_found";
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

export function contentTypeOf(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** URL 경로(`/assets/app.js`)를 파일 조각 목록으로. 거절하면 `null` */
export function pathSegments(pathname: string): readonly string[] | null {
  const decoded = attempt(() => decodeURIComponent(pathname));
  if (!decoded.ok) return null;
  const text = decoded.value;
  if (!text.startsWith("/") || text.includes("\\") || text.includes("\0")) return null;
  const segments = text.slice(1).split("/");
  if (segments.some((segment) => segment === "" || segment.startsWith("."))) return null;
  return segments;
}

/** 루트 폴더 안의 파일 하나를 찾는다. 없거나, 디렉터리이거나, 루트 밖이면 `not_found` */
export async function locateFile(
  root: string,
  segments: readonly string[],
): Promise<Result<StaticFile, NotFound>> {
  const notFound = err({ kind: "not_found" } satisfies NotFound);
  const real = await attemptAsync(() => realpath(path.join(root, ...segments)));
  if (!real.ok) return notFound;
  const base = await attemptAsync(() => realpath(root));
  if (!base.ok) return notFound;
  const prefix = base.value.endsWith(path.sep) ? base.value : `${base.value}${path.sep}`;
  if (!real.value.startsWith(prefix)) return notFound;
  const info = await attemptAsync(() => stat(real.value));
  if (!info.ok || !info.value.isFile()) return notFound;
  const { size, mtimeMs } = info.value;
  return ok({
    path: real.value,
    contentType: contentTypeOf(real.value),
    etag: `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`,
    size,
  });
}
