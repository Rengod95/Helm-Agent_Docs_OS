import { posix } from "node:path";
import { requestKeyFor } from "@fresnel/contracts/records";
import type { CallContext } from "@fresnel/contracts/capabilities";
import { createHash } from "node:crypto";
import { matchProtectedPath, type ProtectedPathEntry } from "@fresnel/contracts/services";
import type { WorkspaceDeps } from "./deps.ts";
import type { WriteAccessVia } from "./ports/write-access.ts";
import { isWithin } from "./roots.ts";

// L2.workspace.spec §4.3.1. 작업 폴더 밖 쓰기를 막지 않고 물어본 뒤 허용한다. 승인을 올리는 지점은 `requestWriteAccess` 하나다.
// 보호 경로(~/.ssh, ~/.claude, Fresnel 데이터·시크릿, .env 등)는 묻지도 않고 막는다.

/** 쓰기 루트로 올리면 안 되는 최상위 시스템 폴더. 이 폴더 바로 아래 경로는 묻지 않고 막는다 */
const SYSTEM_DIRS: ReadonlySet<string> = new Set([
  "/",
  "/Users",
  "/home",
  "/private",
  "/var",
  "/etc",
  "/usr",
  "/opt",
  "/System",
  "/Library",
  "/Applications",
  "/bin",
  "/sbin",
]);

/** 홈 아래에서 앱 이름 한 마디까지를 루트로 보는 캐시 폴더(`~/Library/Caches/<앱>` 등) */
const APP_SCOPED = [
  ["Library", "Caches"],
  ["Library", "Logs"],
  ["Library", "Application Support"],
  [".cache"],
  [".local", "share"],
  [".local", "state"],
  [".config"],
] as const;

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function fromSegments(segments: readonly string[]): string {
  return `/${segments.join("/")}`;
}

/**
 * 막힌 경로를 쓰기 루트로 올릴 합리적인 폴더로 바꾼다. 순수 함수.
 * - `$TMPDIR` 꼴(`/private/var/folders/<a>/<b>/T`, `C`, `0`)은 그 폴더
 * - 홈 아래 `Library/Caches/<앱>`, `.cache/<앱>` 등은 앱 폴더, 그 밖의 `~/.<이름>`은 그 폴더(`~/.npm`)
 * - 홈 바로 아래 파일은 홈. 아직 없는 파일 하나만 허용하는 루트는 Seatbelt에서 쓰기를 열지 못해(실측), 홈 전체를 후보로 보인다. 보호 경로는 홈 루트에서도 막힌다
 * - 나머지는 부모 폴더. 부모가 최상위 시스템 폴더(`/etc`, `/usr` 등)면 undefined(묻지 않고 막는다)
 */
export function grantRootFor(path: string, home: string | undefined): string | undefined {
  const segments = segmentsOf(path);
  if (home !== undefined && isWithin(home, path)) {
    const rest = segmentsOf(path).slice(segmentsOf(home).length);
    for (const scope of APP_SCOPED) {
      const matches = scope.every((name, index) => rest[index] === name);
      if (matches && rest.length > scope.length + 1) {
        return fromSegments([...segmentsOf(home), ...rest.slice(0, scope.length + 1)]);
      }
    }
    const first = rest[0];
    if (first !== undefined && first.startsWith(".") && rest.length > 1) {
      return fromSegments([...segmentsOf(home), first]);
    }
    if (rest.length <= 1) return home;
  }
  const head = segments[0] === "private" ? segments.slice(1) : segments;
  if (head[0] === "var" && head[1] === "folders" && head.length >= 5) {
    return fromSegments(segments.slice(0, segments.length - head.length + 5));
  }
  const parent = posix.dirname(path);
  return SYSTEM_DIRS.has(parent) ? undefined : parent;
}

function isProtected(
  entries: readonly ProtectedPathEntry[],
  path: string,
  access: "write",
): boolean {
  return matchProtectedPath(entries, path, access) !== undefined;
}

/** 거부 문구가 든 줄. 위반 보고가 비었을 때만 경로를 찾는 데 쓴다 */
// Seatbelt의 쓰기 거부는 EPERM("Operation not permitted")이다. 일반 권한 오류("Permission denied", EACCES)는 샌드박스 때문이 아니므로 쓰지 않는다
const DENIAL_LINE = /operation not permitted|read-only file system/i;
const ABSOLUTE_PATH = /(?:^|[\s:'"(=])(\/[^\s:'"()]+)/g;
const OUTPUT_PATH_LIMIT = 8;

/**
 * 막힌 경로를 위반 보고에서 얻지 못했을 때의 마지막 수단. 거부 문구가 든 출력 줄의 절대 경로를 후보로 뽑는다.
 * macOS는 위반을 로그 스트림으로 받아 일부 거부가 보고되지 않는다(실측: 쓰기 거부 20번 중 4~6번만 보고). 후보는 사람이 보고 허용을 정하고,
 * 보호 경로 검사와 허용 루트 제한을 그대로 거치므로 잘못 뽑아도 묻는 경로가 틀릴 뿐 보호 경로가 열리지는 않는다. 순수 함수.
 */
export function pathsFromDenialOutput(output: string): readonly string[] {
  const found = new Set<string>();
  for (const line of output.split("\n")) {
    if (!DENIAL_LINE.test(line)) continue;
    for (const match of line.matchAll(ABSOLUTE_PATH)) {
      const path = match[1]?.replace(/[.,;]+$/, "");
      if (path !== undefined && path.length > 1) found.add(path);
      if (found.size >= OUTPUT_PATH_LIMIT) return [...found];
    }
  }
  return [...found];
}

interface WriteAccessEntry {
  /** 막힌 경로 */
  readonly path: string;
  /** 허용하면 쓰기 루트에 더할 경로 */
  readonly root: string;
}

export interface WriteAccessPlan {
  readonly entries: readonly WriteAccessEntry[];
  /** 묻거나 허용할 쓰기 루트 후보(정렬, 중복 없음) */
  readonly roots: readonly string[];
  /** 막힌 경로 중 이미 허용한 루트 밖이고 보호 경로가 아닌 것 */
  readonly paths: readonly string[];
  /** 후보에 사용자 홈 폴더 전체가 들어 있으면 참. 카드가 "홈 폴더 전체"를 드러내는 값이다 */
  readonly homeWide: boolean;
}

function planOf(entries: readonly WriteAccessEntry[], home: string | undefined): WriteAccessPlan {
  const roots = [...new Set(entries.map((entry) => entry.root))].toSorted();
  return {
    entries,
    roots,
    paths: [...new Set(entries.map((entry) => entry.path))].toSorted(),
    homeWide: home !== undefined && roots.includes(home),
  };
}

/**
 * 막힌 경로 목록에서 물어볼 대상을 고른다. 보호 경로(경로 자체나 올릴 루트가 걸리는 것)와 이미 허용된 루트 안의 경로는 뺀다.
 * 보호 경로는 되풀이해 막히므로 물어보지 않는다.
 */
export function planWriteAccess(
  blocked: readonly string[],
  protectedEntries: readonly ProtectedPathEntry[],
  granted: readonly string[],
  home: string | undefined,
): WriteAccessPlan {
  const entries: WriteAccessEntry[] = [];
  for (const path of blocked) {
    if (!path.startsWith("/")) continue;
    if (granted.some((root) => isWithin(root, path))) continue;
    if (isProtected(protectedEntries, path, "write")) continue;
    const root = grantRootFor(path, home);
    if (root === undefined || isProtected(protectedEntries, root, "write")) continue;
    entries.push({ path, root });
  }
  return planOf(entries, home);
}

/**
 * 홈 바로 아래의 **이미 있는** 파일은 홈 전체 대신 그 파일 경로만 후보로 한다(없는 파일은 Seatbelt가 경로 하나로는 열지 못해 홈이 후보로 남는다).
 * 홈이 후보로 남으면 `homeWide`가 참이다.
 */
export async function narrowHomeRoots(
  plan: WriteAccessPlan,
  home: string | undefined,
  exists: (path: string) => Promise<boolean>,
): Promise<WriteAccessPlan> {
  if (home === undefined || !plan.homeWide) return plan;
  const entries = await Promise.all(
    plan.entries.map(async (entry) =>
      entry.root === home && (await exists(entry.path)) ? { ...entry, root: entry.path } : entry,
    ),
  );
  return planOf(entries, home);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface WriteAccessAsk {
  readonly via: WriteAccessVia;
  readonly plan: WriteAccessPlan;
  readonly context: CallContext | undefined;
  /** 같은 호출 안에서 질문을 구분하는 번호 */
  readonly round: number;
  readonly signal: AbortSignal | undefined;
  /** bash면 명령 원문. 카드가 무엇을 하려는지 보여 준다 */
  readonly command?: string;
}

/**
 * 쓰기 허용 승인을 올리는 유일한 지점이다. 허용이면 true. 선택지는 셋이다: 앞으로 전부 허용(이 대화에서 이후 샌드박스 밖 쓰기 전체), 이번만 허용, 거절.
 * 권한 모드와 무관하게 처음 막혔을 때 한 번 묻는다(bypass 포함) [결정: 2026-11-13 사용자]. 이 대화(또는 이 대화를 띄운 부모 대화)에서 이미 "앞으로 전부 허용"을
 * 골랐으면 묻지 않고 true다(하위 대화·무인 실행도 물려받는다). 보호 경로는 호출한 쪽이 계획에서 이미 뺐으므로 이 선택과 무관하게 막힌다.
 * 그 밖에 사람이 없는 실행(`interactive === false`), 대화가 없는 호출, 포트가 없을 때, 요청이 실패하거나 끊길 때는 묻지 않고 false다.
 */
export async function requestWriteAccess(
  deps: WorkspaceDeps,
  ask: WriteAccessAsk,
): Promise<boolean> {
  const { writeAccess } = deps;
  const { context, plan } = ask;
  if (writeAccess === undefined || context === undefined) return false;
  const threadId = context.threadId;
  if (threadId === undefined || plan.roots.length === 0) return false;
  if ((await writeAccess.granted?.(threadId)) === true) return true;
  if (context.interactive === false) return false;
  const raw = `wa-${context.toolCallId ?? sha256Hex(plan.paths.join("|")).slice(0, 12)}-${ask.round}`;
  const answered = await writeAccess.ask(
    {
      threadId,
      via: ask.via,
      paths: plan.paths,
      roots: plan.roots,
      homeWide: plan.homeWide,
      ...(ask.command === undefined ? {} : { command: ask.command }),
      requestKey: requestKeyFor(raw, sha256Hex),
    },
    ask.signal ?? new AbortController().signal,
  );
  return answered.ok && answered.value !== "deny";
}

/**
 * 파일 도구(`write`, `edit`)가 작업 폴더 밖 경로를 받았을 때 `resolveWorkspacePath`가 부르는 질문. 이 호출만 그 경로를 허용한다.
 * 사람에게 물을 수 없는 호출이면 false라 지금처럼 `outside_root`로 거부된다.
 */
export function askOutsideWrite(
  deps: WorkspaceDeps,
  via: "write" | "edit",
  context: CallContext | undefined,
  signal: AbortSignal | undefined,
): (canonical: string) => Promise<boolean> {
  return (canonical) =>
    requestWriteAccess(deps, {
      via,
      plan: planOf([{ path: canonical, root: canonical }], undefined),
      context,
      round: 1,
      signal,
    });
}
