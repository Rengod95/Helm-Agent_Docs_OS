// 프로젝트 패널(craft-flows C10)의 순수 계산. 사이드바 줄(최근 활동 먼저, 하위 대화는 부모 바로 아래)을 프로젝트와 하위 폴더로 나눈다.
// 소속은 엔진과 같은 규칙이다(review m5 §4.4.2 `deepestRoot`): 대화 폴더를 포함하는 루트 가운데 가장 깊은 것. 루트 목록은 `project.list`가 준다.
// 새 대화의 시작 사실(`thread.started`)에는 소속이 없고, 프로젝트를 만들거나 빼면 목록의 `ThreadSummary.project`가 낡는다. 그래서 화면은
// 루트로 다시 계산하고, 루트로 찾지 못했을 때만 목록이 준 소속(지금 목록에 있는 프로젝트일 때)을 쓴다. 저장하지 않는다.
import type { ProjectListItem, ThreadSummary } from "@fresnel/contracts/wire";
import type { SidebarRow } from "../thread-groups.ts";

/** 사이드바 줄 하나와 그 줄이 묶이는 작업 폴더(하위 대화는 부모의 폴더) */
export interface PlacedRow extends SidebarRow {
  readonly workspace: string | null;
}

/** 프로젝트 안의 하위 폴더 하나. `rel`이 빈 글이면 루트 폴더 자신이다 */
export interface FolderBlock {
  readonly rel: string;
  /** 대화를 시작할 절대 경로 */
  readonly path: string;
  readonly rows: readonly FolderRow[];
}

/** 패널의 대화 줄. `rel`은 그 줄의 하위 폴더(루트면 빈 글) */
export interface FolderRow extends SidebarRow {
  readonly rel: string;
}

export interface PanelProject {
  readonly project: ProjectListItem;
  /** 최근 활동 먼저. 하위 대화는 부모 바로 아래 */
  readonly rows: readonly FolderRow[];
  /** 지금 도는 대화 수(목록의 상태로 센다. `project.list`의 `runningCount`는 목록을 다시 읽을 때까지 낡는다) */
  readonly running: number;
}

export interface ProjectPanelModel {
  readonly projects: readonly PanelProject[];
  /** 어느 프로젝트에도 들지 않는 대화(기본 폴더 대화와 폴더 없는 대화) */
  readonly loose: readonly SidebarRow[];
}

/** 끝의 구분자를 뗀다. 루트(`/`)는 그대로 둔다 */
function trimEnd(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed === "" ? path.slice(0, 1) : trimmed;
}

/** `path`가 `root`와 같거나 그 안에 있는가(엔진 `isWithin`과 같다. 끝 구분자는 무시한다) */
export function isWithinRoot(path: string, root: string): boolean {
  const p = trimEnd(path);
  const r = trimEnd(root);
  if (p === r) return true;
  const prefix = r.endsWith("/") || r.endsWith("\\") ? r : `${r}/`;
  const winPrefix = r.endsWith("/") || r.endsWith("\\") ? r : `${r}\\`;
  return p.startsWith(prefix) || p.startsWith(winPrefix);
}

/** 루트에서 본 하위 폴더 경로. 루트 자신은 빈 글, 루트 밖이면 null */
export function relativeFolder(path: string, root: string): string | null {
  if (!isWithinRoot(path, root)) return null;
  const p = trimEnd(path);
  const r = trimEnd(root);
  if (p === r) return "";
  return p.slice(r.length).replace(/^[\\/]+/, "");
}

/** 대화 폴더가 속한 프로젝트: 포함하는 루트 가운데 가장 깊은 것. 깊이가 같으면 먼저 온 것 */
function projectOfWorkspace(
  workspace: string,
  projects: readonly ProjectListItem[],
): ProjectListItem | undefined {
  let best: ProjectListItem | undefined;
  for (const candidate of projects) {
    if (!isWithinRoot(workspace, candidate.root)) continue;
    if (best === undefined || trimEnd(candidate.root).length > trimEnd(best.root).length)
      best = candidate;
  }
  return best;
}

/**
 * 대화 하나의 프로젝트. 루트로 먼저 찾고, 못 찾으면 목록이 준 소속(`ThreadSummary.project`)이 지금 목록에 있는 프로젝트일 때만 쓴다
 * (엔진은 정규 경로로 견주므로 심볼릭 링크를 지난 폴더는 글자로 견주면 빗나갈 수 있다)
 */
export function projectOfThread(
  thread: Pick<ThreadSummary, "project">,
  workspace: string | null,
  projects: readonly ProjectListItem[],
): ProjectListItem | undefined {
  if (workspace !== null) {
    const byRoot = projectOfWorkspace(workspace, projects);
    if (byRoot !== undefined) return byRoot;
  }
  const ref = thread.project ?? null;
  if (ref === null) return undefined;
  return projects.find((project) => project.projectId === ref.projectId);
}

/**
 * 줄을 프로젝트와 "프로젝트 없는 대화"로 나눈다. 프로젝트의 차례는 그 안의 가장 최근 대화 차례이고, 대화가 없는 프로젝트는 뒤에
 * 이름 차례로 둔다. `keepEmpty`가 거짓이면(찾기 중) 대화가 없는 프로젝트는 뺀다
 */
export function projectPanelOf(
  rows: readonly PlacedRow[],
  projects: readonly ProjectListItem[],
  keepEmpty: boolean,
): ProjectPanelModel {
  const byId = new Map<string, FolderRow[]>();
  const loose: SidebarRow[] = [];
  const order: string[] = [];
  let parentProject: ProjectListItem | undefined;
  for (const row of rows) {
    // 하위 대화는 부모 줄의 프로젝트를 따른다(부모 바로 아래에 온다)
    const project = row.child
      ? parentProject
      : projectOfThread(row.thread, row.workspace, projects);
    if (!row.child) parentProject = project;
    if (project === undefined) {
      loose.push({ thread: row.thread, child: row.child });
      continue;
    }
    const rel = row.workspace === null ? "" : (relativeFolder(row.workspace, project.root) ?? "");
    const list = byId.get(project.projectId);
    const placed: FolderRow = { thread: row.thread, child: row.child, rel };
    if (list === undefined) {
      byId.set(project.projectId, [placed]);
      order.push(project.projectId);
    } else list.push(placed);
  }
  const running = (list: readonly FolderRow[]): number =>
    list.filter((row) => row.thread.status === "running").length;
  const withThreads: PanelProject[] = order.flatMap((id) => {
    const project = projects.find((p) => p.projectId === id);
    const list = byId.get(id) ?? [];
    return project === undefined ? [] : [{ project, rows: list, running: running(list) }];
  });
  const empty: PanelProject[] = keepEmpty
    ? projects
        .filter((p) => !byId.has(p.projectId))
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((project) => ({ project, rows: [], running: 0 }))
    : [];
  return { projects: [...withThreads, ...empty], loose };
}

/** 줄을 하위 폴더로 묶는다(폴더 나무 안). 루트 폴더가 먼저, 나머지는 그 폴더의 가장 최근 대화 차례다 */
export function folderBlocksOf(rows: readonly FolderRow[], root: string): readonly FolderBlock[] {
  const byRel = new Map<string, FolderRow[]>();
  for (const row of rows) {
    const list = byRel.get(row.rel);
    if (list === undefined) byRel.set(row.rel, [row]);
    else list.push(row);
  }
  const base = trimEnd(root);
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const join = (rel: string): string =>
    rel === "" ? base : base.endsWith(sep) ? `${base}${rel}` : `${base}${sep}${rel}`;
  const blocks = [...byRel].map(([rel, list]) => ({ rel, path: join(rel), rows: list }));
  return blocks.toSorted((a, b) => (a.rel === "" ? -1 : b.rel === "" ? 1 : 0));
}

/**
 * 긴 하위 폴더 경로를 가운데에서 줄이려고 나눈다: 앞은 끝을 줄이고 구분자와 마지막 폴더 이름(`/src`)은 그대로 둔다.
 * 그래서 왼쪽 끝은 열에 맞고 가장 깊은 폴더 이름이 보인다. 구분자가 없으면 앞이 빈 글이다
 */
export function pathSplitOf(rel: string): { readonly head: string; readonly tail: string } {
  const cut = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"));
  return cut === -1 ? { head: "", tail: rel } : { head: rel.slice(0, cut), tail: rel.slice(cut) };
}

/** 처음 펼쳐 두는 프로젝트 수(최근 활동 차례). 나머지는 머리 한 줄로 접혀 시작한다 [제안: 프로젝트 스무 개에서 머리가 한두 화면에 들게] */
const PROJECT_OPEN_LIMIT = 5;

/** 프로젝트가 접혀 있나. 사람이 고른 값이 먼저고, 고르지 않았으면 최근 다섯 밖은 접는다. 연 대화를 담은 프로젝트는 펼친다 */
export function isProjectCollapsed(
  choice: boolean | undefined,
  index: number,
  holdsSelected: boolean,
): boolean {
  if (choice !== undefined) return choice;
  return index >= PROJECT_OPEN_LIMIT && !holdsSelected;
}

/** 접지 않은 프로젝트가 처음 보이는 대화 수(하위 대화는 부모와 함께 센다) [제안: 프로젝트 스무 개에서도 한 화면에 머리가 보이게] */
export const PROJECT_ROW_LIMIT = 5;

/**
 * 앞에서 `limit`개의 위 줄(하위 대화가 아닌 줄)과 그 하위 대화만 남긴다. `hidden`은 가린 위 줄 수다.
 * 고른 대화가 가려지면 그 대화(와 부모)만 끝에 더 보인다. 사이의 줄은 계속 접혀 있다(열어 둔 대화가 목록에서 사라지지 않게)
 */
export function capRows<T extends SidebarRow>(
  rows: readonly T[],
  limit: number,
  selected: string | null,
): { readonly shown: readonly T[]; readonly hidden: number } {
  // 줄마다 속한 위 줄의 차례(하위 대화는 부모의 차례)
  let top = -1;
  const groupOf = rows.map((row) => (row.child ? Math.max(top, 0) : (top += 1)));
  const tops = top + 1;
  const at = selected === null ? -1 : rows.findIndex((r) => r.thread.threadId === selected);
  const selectedGroup = at === -1 ? -1 : (groupOf[at] ?? -1);
  const keep = (group: number): boolean => group < limit || group === selectedGroup;
  const shown = rows.filter((_, index) => keep(groupOf[index] ?? 0));
  const kept = new Set(groupOf.filter(keep)).size;
  return { shown, hidden: tops - kept };
}

/**
 * 같은 작업 폴더에서 지금 도는 다른 대화(T7, U6). 알리기만 하고 막지 않는다. 테스트 런과 내부 대화는 부르는 쪽이 먼저 뺀다.
 * 하위 대화는 부모와 같은 폴더를 쓰는 것이 정상이라 뺀다(rerun3 T-07). 이 대화가 띄운 하위 대화, 이 대화의 부모(연 대화가
 * 하위 대화일 때), 같은 부모의 다른 하위 대화(형제)가 모두 여기에 든다. 부모를 뺀 것은 하위 대화를 열었을 때 부모 경고가 뜨지 않게 하려는 것이다(rerun4 T-07)
 */
export function sameFolderRunningOf<
  T extends Pick<ThreadSummary, "threadId" | "workspace" | "status" | "spawnedBy">,
>(
  selected: Pick<ThreadSummary, "threadId" | "workspace" | "spawnedBy"> | undefined,
  threads: readonly T[],
): readonly T[] {
  if (selected === undefined || selected.workspace === null) return [];
  const folder = trimEnd(selected.workspace);
  const parent = selected.spawnedBy?.threadId;
  return threads.filter(
    (thread) =>
      thread.threadId !== selected.threadId &&
      thread.spawnedBy?.threadId !== selected.threadId &&
      thread.threadId !== parent &&
      (parent === undefined || thread.spawnedBy?.threadId !== parent) &&
      thread.status === "running" &&
      thread.workspace !== null &&
      trimEnd(thread.workspace) === folder,
  );
}

/** 프로젝트 이름은 1~128자다(`project.rename`). 앞뒤 공백을 뗀 뒤 비면 저장하지 않는다 */
export function checkProjectName(text: string): string | null {
  const name = text.trim();
  return name.length === 0 || name.length > 128 ? null : name;
}

/** 같은 폴더 알림이 한 번에 보이는 대화 단추 수. 넘으면 이만큼만 보이고 "N개 더 보기"로 접는다 */
const NOTICE_ACTIONS_SHOWN = 3;

/** 대화 단추 목록 가운데 보일 것과 접힌 수. 넷 이상이면 셋까지만 보이고, 펼치면 모두 보인다 */
export function noticeActionsOf<T>(
  items: readonly T[],
  expanded: boolean,
): { readonly shown: readonly T[]; readonly hidden: number; readonly canFold: boolean } {
  if (items.length <= NOTICE_ACTIONS_SHOWN) return { shown: items, hidden: 0, canFold: false };
  if (expanded) return { shown: items, hidden: 0, canFold: true };
  return {
    shown: items.slice(0, NOTICE_ACTIONS_SHOWN),
    hidden: items.length - NOTICE_ACTIONS_SHOWN,
    canFold: false,
  };
}
