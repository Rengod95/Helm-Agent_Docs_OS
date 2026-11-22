// 대화 영역 왼쪽 패널의 프로젝트(craft-flows C10, AGE-34). 실제 엔진의 `project.list`가 준 루트 폴더 아래에 하위 폴더별 대화를 두고,
// 어느 프로젝트에도 들지 않는 대화를 맨 아래 "프로젝트 없는 대화"로 모은다. 대화 줄은 예전 폴더 묶음의 줄 그대로다(`renderRow`):
// 최근 차례, 하위 대화 들여쓰기, 승인 수, 진행 구슬, ⋯ 메뉴, 찾기, 끌어 옮김 없음.
// 프로젝트 머리는 접을 수 있고(기기마다 남는다), 펼친 프로젝트는 최근 대화 다섯 개만 먼저 보인다(대화 수백 개, 프로젝트 스무 개에서도 머리가
// 한 화면에 들게). 찾는 동안에는 접기와 줄임을 풀고 맞는 대화가 있는 프로젝트만 보인다.
// 꼴은 둘이다(`panel-variant.ts`): 폴더 나무(권함)와 최근 목록. 지우는 동작은 없다: "목록에서 빼기"는 폴더와 대화를 남긴다.
import { t } from "@fresnel/client/i18n";
import { attempt, detach, parseJson, rethrow } from "@fresnel/contracts";
import type { ProjectListItem } from "@fresnel/contracts/wire";
import {
  Button,
  IconButton,
  ListNavigation,
  ListNavigationGroup,
  Menu,
  MenuItem,
  MenuSeparator,
} from "@caustic/react";
import { ChevronRight, Ellipsis, Plus } from "@caustic/react/icons";
import { Fragment, lazy, Suspense, useState, type ReactNode } from "react";
import { BUILD_CHECKS } from "../../app/build.ts";
import { useCommands } from "../commands.ts";
import { ProgressOrb } from "../effects/progress-orb.tsx";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../folder-pick.ts";
import type { SidebarRow } from "../thread-groups.ts";
import { usePanelVariant, type PanelVariant } from "./panel-variant.ts";
import {
  capRows,
  isProjectCollapsed,
  folderBlocksOf,
  isWithinRoot,
  pathSplitOf,
  PROJECT_ROW_LIMIT,
  projectPanelOf,
  type FolderRow,
  type PlacedRow,
  type PanelProject,
} from "./project-model.ts";
import {
  projectFailureText,
  ProjectSettingsDialog,
  RemoveProjectDialog,
} from "./project-settings.tsx";

const PanelSwitch = BUILD_CHECKS
  ? lazy(() => import("./project-panel-dev.tsx").then((m) => ({ default: m.PanelSwitch })))
  : null;

/** 폴더 나무에서 하위 폴더의 대화가 들어가는 칸(하위 대화 줄 `CHILD_ROW`와 같은 한 칸) */
export const NESTED_ROW = "ms-4 w-auto max-w-[calc(100%-1rem)]";
/** 폴더 나무 안의 하위 대화(두 칸) */
export const NESTED_CHILD_ROW = "ms-8 w-auto max-w-[calc(100%-2rem)]";

const COLLAPSED_KEY = "fresnel.projects.collapsed";
/** "더 보기"를 편 묶음 모음에서 프로젝트 없는 대화 묶음의 자리(프로젝트 id와 겹치지 않는다) */
const LOOSE_KEY = "loose";

/** 사람이 접거나 편 프로젝트(id → 접힘). 고르지 않은 프로젝트는 `isProjectCollapsed`의 기본을 따른다 */
function readCollapsed(): ReadonlyMap<string, boolean> {
  const got = attempt(() => localStorage.getItem(COLLAPSED_KEY));
  if (!got.ok || got.value === null) return new Map();
  const parsed = parseJson(got.value);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return new Map();
  return new Map(
    Object.entries(parsed.value).filter((e): e is [string, boolean] => typeof e[1] === "boolean"),
  );
}

function writeCollapsed(choices: ReadonlyMap<string, boolean>): void {
  attempt(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Object.fromEntries(choices)));
  });
}

export interface ProjectPanelProps {
  /** 찾기로 거른 사이드바 줄(최근 활동 먼저) */
  readonly rows: readonly PlacedRow[];
  readonly projects: readonly ProjectListItem[];
  readonly pending: ReadonlyMap<string, number>;
  readonly searching: boolean;
  readonly selected: string | null;
  /** 대화 줄 하나. `folder`는 최근 목록 꼴의 줄 끝 하위 폴더(없으면 null), `nested`는 폴더 나무의 들인 줄 */
  readonly renderRow: (row: SidebarRow, folder: string | null, nested: boolean) => ReactNode;
  /** 새 대화. 글은 그 폴더, null은 프로젝트 없는 대화 */
  readonly onStart: (path: string | null) => void;
  readonly folderPick: FolderPickInvoke | undefined;
  readonly onError: (text: string | null) => void;
}

export function ProjectPanel(props: ProjectPanelProps): ReactNode {
  const variant = usePanelVariant();
  const commands = useCommands();
  const [collapsed, setCollapsed] = useState<ReadonlyMap<string, boolean>>(readCollapsed);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [settings, setSettings] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProjectListItem | null>(null);
  const model = projectPanelOf(props.rows, props.projects, !props.searching);

  // 프로젝트 없는 대화도 프로젝트와 같이 다섯 줄까지 보이고 나머지는 "더 보기" 뒤다
  const looseOpened = props.searching || opened.has(LOOSE_KEY);
  const looseShown = looseOpened
    ? { shown: model.loose, hidden: 0 }
    : capRows(model.loose, PROJECT_ROW_LIMIT, props.selected);

  const toggle = (id: string, now: boolean): void => {
    const next = new Map(collapsed);
    next.set(id, !now);
    setCollapsed(next);
    writeCollapsed(next);
  };
  const toggleMore = (id: string): void => {
    const next = new Set(opened);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpened(next);
  };

  // 새 프로젝트: OS 폴더 고르기로 루트를 고른다(새 대화의 폴더 고르기와 같은 창). 고른 폴더가 이미 프로젝트면 엔진이 거절한다
  const createProject = (): void => {
    const pick = props.folderPick;
    if (pick === undefined) return;
    const run = async (): Promise<void> => {
      props.onError(null);
      const picked = await pickWorkspaceFolder(pick);
      if (!picked.ok) {
        props.onError(t("desktop.workspace.pickFailed"));
        return;
      }
      if (picked.value === undefined) return;
      const created = await commands.projects.create(picked.value);
      if (!created.ok) props.onError(projectFailureText(created.error));
    };
    detach(run(), rethrow);
  };

  // 하위 폴더에서 새 대화: 고른 폴더가 루트 밖이면 만들지 않는다(엔진은 밖의 폴더로 새 프로젝트를 만든다)
  const startInSubfolder = (project: ProjectListItem): void => {
    const pick = props.folderPick;
    if (pick === undefined) return;
    const run = async (): Promise<void> => {
      props.onError(null);
      const picked = await pickWorkspaceFolder(pick);
      if (!picked.ok) {
        props.onError(t("desktop.workspace.pickFailed"));
        return;
      }
      if (picked.value === undefined) return;
      if (!isWithinRoot(picked.value, project.root)) {
        props.onError(t("desktop.projects.outside", { name: project.name }));
        return;
      }
      props.onStart(picked.value);
    };
    detach(run(), rethrow);
  };

  const settingsProject = props.projects.find((p) => p.projectId === settings);
  return (
    <>
      <div
        data-project-panel={variant}
        className="flex h-control-sm items-center justify-between ps-2 pe-2"
      >
        <span className="text-caption text-text-tertiary">{t("desktop.projects.heading")}</span>
        {/* 묶음 머리의 동작 칸(caustic sessions)과 같은 끝선: 아이콘 여백만큼 끝으로 당긴다 */}
        <span className="-me-[calc((var(--cs-control-xs)-var(--cs-icon-sm))/2)] flex items-center gap-0.5">
          {PanelSwitch === null ? null : (
            <Suspense fallback={null}>
              <PanelSwitch />
            </Suspense>
          )}
          {props.folderPick === undefined ? null : (
            <IconButton
              size="xs"
              variant="ghost"
              label={t("desktop.projects.new")}
              data-project-new=""
              onClick={createProject}
            >
              <Plus />
            </IconButton>
          )}
        </span>
      </div>
      {props.projects.length === 0 && props.folderPick !== undefined && !props.searching ? (
        <Button
          size="xs"
          variant="ghost"
          className="justify-self-start"
          data-project-empty=""
          onClick={createProject}
        >
          {t("desktop.projects.newFromFolder")}
        </Button>
      ) : null}
      <ListNavigation
        aria-label={t("desktop.threads.listLabel")}
        kind="sessions"
        size="sm"
        as="div"
      >
        {model.projects.map((entry, index) => {
          const shut =
            !props.searching &&
            isProjectCollapsed(
              collapsed.get(entry.project.projectId),
              index,
              entry.rows.some((row) => row.thread.threadId === props.selected),
            );
          return (
            <ProjectGroup
              key={entry.project.projectId}
              entry={entry}
              variant={variant}
              collapsed={shut}
              opened={props.searching || opened.has(entry.project.projectId)}
              searching={props.searching}
              pending={props.pending.get(entry.project.projectId)}
              selected={props.selected}
              canPick={props.folderPick !== undefined}
              renderRow={props.renderRow}
              onToggle={() => {
                toggle(entry.project.projectId, shut);
              }}
              onMore={() => {
                toggleMore(entry.project.projectId);
              }}
              onStart={props.onStart}
              onStartInSubfolder={() => {
                startInSubfolder(entry.project);
              }}
              onSettings={() => {
                setSettings(entry.project.projectId);
              }}
              onRemove={() => {
                setRemoving(entry.project);
              }}
            />
          );
        })}
        {model.loose.length === 0 ? null : (
          <ListNavigationGroup
            heading={
              <span className="min-w-0 truncate text-ui font-medium text-text-secondary">
                {t("desktop.projects.loose")}
              </span>
            }
            addLabel={t("desktop.projects.newLoose")}
            onAdd={() => {
              props.onStart(null);
            }}
          >
            {looseShown.shown.map((row) => props.renderRow(row, null, false))}
            <MoreRow
              hidden={looseShown.hidden}
              canFold={
                !props.searching &&
                looseOpened &&
                model.loose.filter((row) => !row.child).length > PROJECT_ROW_LIMIT
              }
              onMore={() => {
                toggleMore(LOOSE_KEY);
              }}
            />
          </ListNavigationGroup>
        )}
      </ListNavigation>
      {settingsProject === undefined ? null : (
        <ProjectSettingsDialog
          project={settingsProject}
          pending={props.pending.get(settingsProject.projectId)}
          onClose={() => {
            setSettings(null);
          }}
          onRemove={() => {
            setSettings(null);
            setRemoving(settingsProject);
          }}
        />
      )}
      {removing === null ? null : (
        <RemoveProjectDialog
          project={removing}
          onDone={() => {
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}

function ProjectGroup(props: {
  readonly entry: PanelProject;
  readonly variant: PanelVariant;
  readonly collapsed: boolean;
  readonly opened: boolean;
  /** 찾는 중에는 모두 펼쳐 "줄이기"를 두지 않는다 */
  readonly searching: boolean;
  readonly pending: number | undefined;
  readonly selected: string | null;
  readonly canPick: boolean;
  readonly renderRow: ProjectPanelProps["renderRow"];
  readonly onToggle: () => void;
  readonly onMore: () => void;
  readonly onStart: (path: string | null) => void;
  readonly onStartInSubfolder: () => void;
  readonly onSettings: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const { project, rows, running } = props.entry;
  const capped = props.opened
    ? { shown: rows, hidden: 0 }
    : capRows(rows, PROJECT_ROW_LIMIT, props.selected);
  const extra = rows.filter((row) => !row.child).length - PROJECT_ROW_LIMIT;
  return (
    <ListNavigationGroup
      data-project={project.projectId}
      heading={
        <ProjectHeading
          project={project}
          collapsed={props.collapsed}
          running={running}
          pending={props.pending ?? 0}
          onToggle={props.onToggle}
        />
      }
      headingAction={
        <span className="flex items-center gap-0.5">
          <ProjectMenu
            name={project.name}
            canPick={props.canPick}
            onStartInSubfolder={props.onStartInSubfolder}
            onSettings={props.onSettings}
            onRemove={props.onRemove}
          />
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.projects.newIn", { name: project.name })}
            onClick={() => {
              props.onStart(project.root);
            }}
          >
            <Plus />
          </IconButton>
        </span>
      }
    >
      {props.collapsed ? null : props.variant === "tree" ? (
        <TreeRows
          rows={capped.shown}
          root={project.root}
          renderRow={props.renderRow}
          onStart={props.onStart}
        />
      ) : (
        capped.shown.map((row) => props.renderRow(row, row.rel === "" ? null : row.rel, false))
      )}
      {props.collapsed ? null : (
        <MoreRow
          hidden={capped.hidden}
          canFold={!props.searching && props.opened && extra > 0}
          onMore={props.onMore}
        />
      )}
    </ListNavigationGroup>
  );
}

/** 묶음 끝의 "n개 더 보기" 또는 펼친 뒤 "줄이기". 둘 다 아니면 비운다 */
function MoreRow(props: {
  readonly hidden: number;
  readonly canFold: boolean;
  readonly onMore: () => void;
}): ReactNode {
  if (props.hidden === 0 && !props.canFold) return null;
  return (
    <li className="grid">
      <Button
        size="xs"
        variant="ghost"
        className="justify-self-start text-text-tertiary"
        data-project-more=""
        onClick={props.onMore}
      >
        {props.hidden > 0
          ? t("desktop.projects.more", { count: props.hidden })
          : t("desktop.projects.less")}
      </Button>
    </li>
  );
}

/** 폴더 나무: 루트 폴더의 대화가 먼저, 그 아래 하위 폴더마다 작은 머리와 한 칸 들인 대화 */
function TreeRows(props: {
  readonly rows: readonly FolderRow[];
  readonly root: string;
  readonly renderRow: ProjectPanelProps["renderRow"];
  readonly onStart: (path: string | null) => void;
}): ReactNode {
  const blocks = folderBlocksOf(props.rows, props.root);
  return blocks.map((block) =>
    block.rel === "" ? (
      <Fragment key="">{block.rows.map((row) => props.renderRow(row, null, false))}</Fragment>
    ) : (
      <FolderBlockRows key={block.rel} block={block} {...props} />
    ),
  );
}

function FolderBlockRows(props: {
  readonly block: ReturnType<typeof folderBlocksOf>[number];
  readonly renderRow: ProjectPanelProps["renderRow"];
  readonly onStart: (path: string | null) => void;
}): ReactNode {
  const { block } = props;
  const split = pathSplitOf(block.rel);
  return (
    <>
      <li data-project-folder={block.rel} className="flex h-control-sm items-center ps-2 pe-2">
        {/* 가운데 줄임: 앞 경로는 끝을 줄이고 마지막 폴더 이름은 남긴다. 전체 경로는 툴팁 */}
        <span
          className="flex min-w-0 flex-1 text-footnote text-text-tertiary contain-inline-size"
          title={block.path}
        >
          {split.head === "" ? null : <span className="min-w-0 truncate">{split.head}</span>}
          <span className="max-w-full shrink-0 truncate">{split.tail}</span>
        </span>
        <IconButton
          size="xs"
          variant="ghost"
          label={t("desktop.projects.newIn", { name: block.rel })}
          className="-me-[calc((var(--cs-control-xs)-var(--cs-icon-sm))/2)]"
          onClick={() => {
            props.onStart(block.path);
          }}
        >
          <Plus />
        </IconButton>
      </li>
      {block.rows.map((row) => props.renderRow(row, null, true))}
    </>
  );
}

/** 프로젝트 머리: 이름(누르면 접거나 펼친다), 접혔을 때 도는 대화의 구슬, 리뷰 대기 수. 올리면 루트 경로. 크기가 다른 이름과 "리뷰 n"은 한 기준선, 구슬은 세로 가운데(DP-227) */
function ProjectHeading(props: {
  readonly project: ProjectListItem;
  readonly collapsed: boolean;
  readonly running: number;
  readonly pending: number;
  readonly onToggle: () => void;
}): ReactNode {
  // 긴 이름이 묶음 머리 칸의 최소 폭을 늘려 사이드바가 옆으로 밀리지 않게(`contain-inline-size`) 한다. 이름은 끝을 줄이고 루트 경로는 툴팁
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 contain-inline-size">
      <button
        type="button"
        aria-expanded={!props.collapsed}
        aria-label={t(props.collapsed ? "desktop.projects.expand" : "desktop.projects.collapse", {
          name: props.project.name,
        })}
        title={props.project.root}
        data-slot="project-toggle"
        className="flex min-w-0 cursor-pointer items-center gap-1 self-baseline rounded-xs border-0 bg-transparent p-0 text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
        onClick={props.onToggle}
      >
        <span className="min-w-0 truncate text-ui font-medium">{props.project.name}</span>
        <ChevronRight
          aria-hidden
          data-expanded={!props.collapsed}
          className="size-3 shrink-0 text-text-tertiary transition-transform data-[expanded=true]:rotate-90"
        />
      </button>
      {props.collapsed && props.running > 0 ? (
        <span className="inline-flex shrink-0 items-center">
          <ProgressOrb />
          <span className="sr-only">{t("desktop.projects.running", { count: props.running })}</span>
        </span>
      ) : null}
      {props.pending > 0 ? (
        <span
          className="shrink-0 self-baseline text-footnote text-text-tertiary tabular-nums"
          title={t("desktop.projects.pendingTitle", { count: props.pending })}
        >
          {t("desktop.projects.pending", { count: props.pending })}
        </span>
      ) : null}
    </span>
  );
}

function ProjectMenu(props: {
  readonly name: string;
  readonly canPick: boolean;
  readonly onStartInSubfolder: () => void;
  readonly onSettings: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  return (
    <Menu
      size="sm"
      align="end"
      aria-label={t("desktop.projects.menu.label", { name: props.name })}
      trigger={
        <IconButton
          size="xs"
          variant="ghost"
          data-project-menu=""
          label={t("desktop.projects.menu.label", { name: props.name })}
        >
          <Ellipsis aria-hidden />
        </IconButton>
      }
    >
      {props.canPick ? (
        <MenuItem onSelect={props.onStartInSubfolder}>
          {t("desktop.projects.menu.newInFolder")}
        </MenuItem>
      ) : null}
      <MenuItem onSelect={props.onSettings}>{t("desktop.projects.menu.settings")}</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onRemove}>{t("desktop.projects.menu.remove")}</MenuItem>
    </Menu>
  );
}
