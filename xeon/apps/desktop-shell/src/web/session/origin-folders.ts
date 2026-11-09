// 웹 셸의 서버 폴더 목록(`origin_folder_list`, L4.remote.spec §6.1 [제안]). 웹 화면이 게이트웨이 컴퓨터의 폴더를 고를 때 쓴다.
// - 디렉터리만 돌려준다. 파일은 목록에도 읽기에도 없다. 심볼릭 링크는 푼 곳이 디렉터리일 때만 보이고, 깨졌거나 고리면 건너뛴다.
// - 경로는 절대 경로이고 NUL이 없어야 한다. 실제 경로(링크를 푼 것)로 바꾼 뒤 디렉터리인지 본다.
// - 목록은 이름순(`localeCompare`)이고 점으로 시작하는 이름은 뒤로 간다. 상한에서 멈추면 `truncated`가 참이다.
import { readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

/** 목록 항목 수 상한. 넘는 디렉터리는 담지 않고 `truncated`만 참으로 둔다 */
const ORIGIN_FOLDER_MAX_ENTRIES = 2000;

/** 거절 이유. `bad-request`는 인자 모양이 틀린 것, `read_failed`는 없거나 폴더가 아니거나 읽을 수 없는 것이다 */
export type OriginFolderError = "bad-request" | "read_failed";

interface OriginFolderEntry {
  readonly name: string;
  /** 항목의 절대 경로다. 심볼릭 링크면 링크 자신의 경로다 */
  readonly path: string;
}

export interface OriginFolderListing {
  /** 목록을 낸 폴더의 실제 절대 경로(심볼릭 링크를 푼 것) */
  readonly path: string;
  /** 상위 폴더의 절대 경로. 루트면 null */
  readonly parent: string | null;
  /** 이 게이트웨이 사용자의 홈 디렉터리 */
  readonly home: string;
  readonly entries: readonly OriginFolderEntry[];
  /** 상한에서 멈췄으면 참 */
  readonly truncated: boolean;
}

export interface OriginFolderOptions {
  /** 사용자 홈 디렉터리(절대 경로). 요청한 경로가 없거나 비었을 때 여기서 시작한다 */
  readonly home: string;
  /** 항목 수 상한. 시험이 작은 값을 넣는다 */
  readonly maxEntries?: number;
}

/**
 * 요청한 폴더의 목록을 만든다. `requested`(요청의 `path`)가 없거나 빈 값이면 홈이다.
 * 문자열이 아니거나, 절대 경로가 아니거나, NUL이 있으면 `bad-request`다.
 * 없거나, 폴더가 아니거나, 읽을 수 없으면 `read_failed`다.
 */
export function listOriginFolders(
  requested: unknown,
  options: OriginFolderOptions,
): Result<OriginFolderListing, OriginFolderError> {
  const wanted = requestedPath(requested, options.home);
  if (!wanted.ok) return err(wanted.error);
  const real = attempt(() => realpathSync(wanted.value));
  if (!real.ok) return err("read_failed");
  const dir = real.value;
  const info = attempt(() => statSync(dir));
  if (!info.ok || !info.value.isDirectory()) return err("read_failed");
  const names = attempt(() => readdirSync(dir, { withFileTypes: true }));
  if (!names.ok) return err("read_failed");

  const max = options.maxEntries ?? ORIGIN_FOLDER_MAX_ENTRIES;
  const entries: OriginFolderEntry[] = [];
  let truncated = false;
  // 이름순으로 훑어 디렉터리만 담는다. 상한에 닿았는데 디렉터리가 하나 더 남았으면 `truncated`다
  for (const dirent of names.value.toSorted(byName)) {
    const entry = directoryEntryOf(dir, dirent);
    if (entry === null) continue;
    if (entries.length === max) {
      truncated = true;
      break;
    }
    entries.push(entry);
  }
  const parent = path.dirname(dir);
  return ok({
    path: dir,
    parent: parent === dir ? null : parent,
    home: options.home,
    entries,
    truncated,
  });
}

/** 요청한 경로를 검사한다. 없거나 빈 값이면 홈이다 */
function requestedPath(requested: unknown, home: string): Result<string, "bad-request"> {
  if (requested === undefined || requested === "") return ok(home);
  if (typeof requested !== "string") return err("bad-request");
  if (requested.includes("\0") || !path.isAbsolute(requested)) return err("bad-request");
  return ok(requested);
}

/** 디렉터리 항목 하나. 디렉터리가 아니면 null이다. 심볼릭 링크는 푼 곳이 디렉터리일 때만 든다(깨진 링크와 고리는 `statSync`가 던져 빠진다) */
function directoryEntryOf(dir: string, dirent: Dirent): OriginFolderEntry | null {
  const full = path.join(dir, dirent.name);
  if (dirent.isDirectory()) return { name: dirent.name, path: full };
  if (!dirent.isSymbolicLink()) return null;
  const linked = attempt(() => statSync(full).isDirectory());
  return linked.ok && linked.value ? { name: dirent.name, path: full } : null;
}

/** 점으로 시작하는 이름을 뒤로 보내고, 나머지는 `localeCompare` 순서다 */
function byName(left: Dirent, right: Dirent): number {
  const leftHidden = left.name.startsWith(".");
  if (leftHidden !== right.name.startsWith(".")) return leftHidden ? 1 : -1;
  return left.name.localeCompare(right.name);
}
