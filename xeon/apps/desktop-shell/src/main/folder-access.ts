// 플러그인 화면이 사용자가 고른 폴더 안을 보는 길(ADR-0021 §3.4.3). 폴더 선택 창, 목록, 파일 읽기 세 명령이다.
// 프레임에는 IPC가 없다. 앱 본 화면이 다리 요청을 받아 이 명령을 대신 부른다(main.ts의 발신 검사를 거친 호출만 온다).
//
// 접근 범위는 "그 창에서 그 화면이 고른 폴더들 안"뿐이다:
// - 고른 폴더는 불투명 핸들 id로만 가리킨다. 핸들은 (발신 창, 화면 scope)별로 기억하고 앱을 다시 켜면 잊는다.
//   다른 창이나 다른 화면이 만든 핸들은 모르는 핸들이다.
// - 안쪽 경로는 상대 경로(`/` 구분)이고 `..`, `.`, 빈 마디, 역슬래시, NUL을 거부한다(글자 검사, `view-scheme.ts`와 같은 규칙).
// - 글자 검사 뒤에 실제 경로(심볼릭 링크를 푼 것)가 폴더 실제 경로 안인지 한 번 더 본다. 밖으로 나가는 링크는 목록에서 빼고 읽지 않는다.
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { attempt, attemptAsync } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { IpcCaller, ShellContext } from "./context.ts";
import { ownField } from "./lib/narrow.ts";

/** 파일 읽기 상한(바이트, 64 MiB). `UI_LIMITS.fileBytes`와 같다 */
export const PICK_READ_MAX_BYTES = 67_108_864;
/** 목록 한 번의 항목 수 상한. `UI_LIMITS.folderListEntries`와 같다 */
export const FOLDER_LIST_MAX_ENTRIES = 10_000;
/** 목록이 내려가는 깊이 상한. `UI_LIMITS.folderListDepth`와 같다 */
export const FOLDER_LIST_MAX_DEPTH = 16;
/** 창 하나가 한꺼번에 기억하는 핸들 수 상한. 넘으면 가장 오래된 것을 잊는다 */
export const MAX_FOLDER_HANDLES = 64;

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 읽은 파일. UTF-8 글이면 `utf8`과 문자열, 아니면 `base64`와 바이트의 base64 문자열이다 */
export interface ReadFileReply {
  readonly name: string;
  /** 읽은 파일의 절대 경로 */
  readonly path: string;
  readonly size: number;
  readonly encoding: "utf8" | "base64";
  readonly content: string;
}

/** 절대 경로의 파일 하나를 읽는다. 상한(64 MiB)을 넘으면 읽지 않고 `too-large`, 읽을 수 없으면 `read_failed`다 */
export function readFileReply(target: string): ReadFileReply {
  const size = attempt(() => statSync(target));
  if (!size.ok || !size.value.isFile()) throw new ShellError("read_failed");
  if (size.value.size > PICK_READ_MAX_BYTES) throw new ShellError("too-large");
  const bytes = attempt(() => readFileSync(target));
  if (!bytes.ok) throw new ShellError("read_failed");
  if (bytes.value.byteLength > PICK_READ_MAX_BYTES) throw new ShellError("too-large");
  const name = path.basename(target);
  const text = attempt(() => STRICT_UTF8.decode(bytes.value));
  if (text.ok) {
    return {
      name,
      path: target,
      size: bytes.value.byteLength,
      encoding: "utf8",
      content: text.value,
    };
  }
  return {
    name,
    path: target,
    size: bytes.value.byteLength,
    encoding: "base64",
    content: bytes.value.toString("base64"),
  };
}

/** 목록 항목 하나. `path`는 고른 폴더 기준 상대 경로(`/` 구분)다 */
export interface FolderEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "dir";
  /** 파일 크기(바이트). 폴더는 없다 */
  readonly size?: number;
}

export interface FolderListReply {
  readonly entries: readonly FolderEntry[];
  /** 항목 수 상한에서 멈췄으면 참 */
  readonly truncated: boolean;
}

interface FolderHandle {
  readonly scope: string;
  readonly root: string;
}

/** 창(발신 WebContents)별 핸들. 창이 사라지면 같이 사라진다 */
const handlesByWindow = new WeakMap<object, Map<string, FolderHandle>>();

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 상대 경로를 마디로 나눈다. 빈 문자열은 폴더 자신(마디 없음)이다. `..`, `.`, 빈 마디, 역슬래시, NUL, 절대 경로는 거부한다.
 * 거부면 undefined다
 */
export function relativeSegments(relative: string): readonly string[] | undefined {
  if (relative === "") return [];
  if (relative.includes("\\") || relative.includes("\0") || relative.startsWith("/")) {
    return undefined;
  }
  const segments = relative.split("/");
  if (segments.some((part) => part === "" || part === "." || part === "..")) return undefined;
  return segments;
}

function realpathOf(target: string): string | undefined {
  const real = attempt(() => realpathSync(target));
  return real.ok ? real.value : undefined;
}

/** 핸들이 이 창과 이 화면의 것이면 그 폴더, 아니면 `unknown-folder` */
function handleOf(caller: IpcCaller, args: unknown): FolderHandle {
  const scope = ownField(args, "scope");
  const handle = ownField(args, "handle");
  if (typeof scope !== "string" || typeof handle !== "string") throw new ShellError("bad-request");
  const found = handlesByWindow.get(caller.sender)?.get(handle);
  if (found === undefined || found.scope !== scope) throw new ShellError("unknown-folder");
  return found;
}

function relativeOf(args: unknown): readonly string[] {
  const relative = ownField(args, "path") ?? "";
  if (typeof relative !== "string") throw new ShellError("bad-request");
  const segments = relativeSegments(relative);
  if (segments === undefined) throw new ShellError("outside-folder");
  return segments;
}

/** 폴더 안의 실제 경로로 푼다. 폴더가 사라졌으면 `read_failed`, 밖으로 나가면 `outside-folder`다 */
function resolveInside(folder: FolderHandle, segments: readonly string[]): string {
  const root = realpathOf(folder.root);
  if (root === undefined) throw new ShellError("read_failed");
  const real = realpathOf(path.join(root, ...segments));
  if (real === undefined) throw new ShellError("read_failed");
  if (!isInside(root, real)) throw new ShellError("outside-folder");
  return real;
}

function listFolder(
  root: string,
  startReal: string,
  startSegments: readonly string[],
  recursive: boolean,
): FolderListReply {
  const entries: FolderEntry[] = [];
  let truncated = false;
  const walk = (dirReal: string, prefix: readonly string[], depth: number): void => {
    const names = attempt(() => readdirSync(dirReal, { withFileTypes: true }));
    if (!names.ok) return;
    const sorted = names.value.toSorted((left, right) => left.name.localeCompare(right.name));
    for (const dirent of sorted) {
      if (entries.length >= FOLDER_LIST_MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const full = path.join(dirReal, dirent.name);
      const linked = dirent.isSymbolicLink();
      let target = full;
      if (linked) {
        // 링크는 푼 곳이 폴더 안일 때만 보인다. 링크 폴더로는 내려가지 않는다(고리를 막는다)
        const real = realpathOf(full);
        if (real === undefined || !isInside(root, real)) continue;
        target = real;
      }
      const info = attempt(() => statSync(target));
      if (!info.ok) continue;
      const segments = [...prefix, dirent.name];
      const entryPath = segments.join("/");
      if (info.value.isDirectory()) {
        entries.push({ path: entryPath, name: dirent.name, kind: "dir" });
        if (recursive && !linked && depth + 1 < FOLDER_LIST_MAX_DEPTH) {
          walk(full, segments, depth + 1);
          if (truncated) return;
        }
      } else if (info.value.isFile()) {
        entries.push({ path: entryPath, name: dirent.name, kind: "file", size: info.value.size });
      }
    }
  };
  walk(startReal, startSegments, 0);
  return { entries, truncated };
}

/** 폴더 선택 창 명령 `pick_folder_open`, 목록 `folder_list`, 읽기 `folder_read`를 등록한다. `dialogsModule`이 부른다 */
export function registerFolderAccess(ctx: ShellContext): void {
  // 사용자가 이 창에서 고른 폴더를 이 창·이 화면의 핸들로 기억하고 전체 경로와 함께 돌려준다. 취소면 null이다
  ctx.handle("pick_folder_open", async (caller, args) => {
    const scope = ownField(args, "scope");
    if (typeof scope !== "string" || scope === "") throw new ShellError("bad-request");
    const answer = await attemptAsync(() => ctx.dialogs.openFolder());
    if (!answer.ok) throw new ShellError("dialog_unavailable");
    const picked = answer.value;
    if (picked === null || !path.isAbsolute(picked)) return null;
    const root = realpathOf(picked);
    if (root === undefined || !attempt(() => statSync(root).isDirectory()).ok) {
      throw new ShellError("read_failed");
    }
    const handles = handlesByWindow.get(caller.sender) ?? new Map<string, FolderHandle>();
    handlesByWindow.set(caller.sender, handles);
    const handle = `fld_${crypto.randomUUID()}`;
    handles.set(handle, { scope, root });
    while (handles.size > MAX_FOLDER_HANDLES) {
      const oldest = handles.keys().next();
      if (oldest.done === true) break;
      handles.delete(oldest.value);
    }
    return { handle, path: picked, name: path.basename(root) };
  });
  ctx.handle("folder_list", (caller, args) => {
    const folder = handleOf(caller, args);
    const segments = relativeOf(args);
    const real = resolveInside(folder, segments);
    if (!attempt(() => statSync(real).isDirectory()).ok) throw new ShellError("not-a-folder");
    const recursive = ownField(args, "recursive") === true;
    return listFolder(realpathOf(folder.root) ?? folder.root, real, segments, recursive);
  });
  ctx.handle("folder_read", (caller, args) => {
    const folder = handleOf(caller, args);
    const segments = relativeOf(args);
    if (segments.length === 0) throw new ShellError("outside-folder");
    return readFileReply(resolveInside(folder, segments));
  });
}
