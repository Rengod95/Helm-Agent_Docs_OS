import { mkdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { attemptAsync, Bug, detach, err, ok, type Clock, type Result } from "@fresnel/contracts";
import {
  createInstructionSections,
  DEFAULT_INSTRUCTION_FILES_MAX_BYTES,
  nodeInstructionFs,
  type InstructionSections,
} from "@fresnel/core-context";
import {
  isId,
  type LocalIdFactory,
  type ThreadId,
  type ThreadStatus,
} from "@fresnel/contracts/conversation";
import {
  PROJECT_LIMITS,
  type Project,
  type ProjectCreateParams,
  type ProjectInstructionsResult,
  type ProjectListItem,
  type ProjectListResult,
  type ProjectRenameParams,
  type ThreadProjectRef,
  type Unsubscribe,
} from "@fresnel/contracts/wire";
import type { FileLock } from "@fresnel/platform-os";
import type {
  ProjectPort,
  ProjectPortFailure,
  ProjectRuleFailure,
} from "../../handlers/m4/project.ts";
import { canonicalWorkspace, workspaceFilterOf } from "../workspace.ts";
import { DEFAULT_PROJECT_FOLDER_NAME, PROJECT_DEFAULT_FOLDER_KEY } from "../../settings.ts";
import {
  DEFAULT_PROJECT_ID,
  deepestRoot,
  projectIdOf,
  recentThreadOf,
  type RecentThread,
  type ScopeRoot,
} from "./project-scope.ts";
import {
  createProjectStore,
  type ProjectStoreFailure,
  type ProjectsChange,
} from "./project-store.ts";

// 프로젝트 포트(review m5 §4.4). `projects.json`(저장소)과 대화 목록(읽기 원천)으로 소속과 기본값을 계산한다.
// 기본 폴더 대화의 대화 폴더 만들기와 지침 파일 목록도 여기서 한다. 대화 저장은 하지 않는다.

/** 지침 파일 이름. 사용자 결정은 `AGENTS.md`만 말한다(§4.4.7, 미결 5) */
const INSTRUCTION_FILE = "AGENTS.md";
const DEFAULT_FOLDER_KEY = PROJECT_DEFAULT_FOLDER_KEY;
const INSTRUCTION_MAX_BYTES_KEY = "l1.context.instructionFiles.maxBytes";

/** 대화 하나의 프로젝트 계산 입력. 닫힌 대화도 포함하고(목록은 `includeClosed`로 읽는다), Test run 표지를 붙인다 */
export interface ProjectThreadRow {
  readonly threadId: ThreadId;
  /** 정규 작업 폴더. 없으면 null */
  readonly workspace: string | null;
  readonly status: ThreadStatus;
  /** 저장된 프로필 id. 없으면 null */
  readonly profileId: string | null;
  readonly updatedAt: number;
  readonly testRun: boolean;
}

export interface ProjectPortDeps {
  readonly configDir: string;
  /** `OsDirs.data`. 기본 폴더 설정이 비었을 때 `default-project`를 이 아래에 둔다 */
  readonly dataDir: string;
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  /** 프로젝트 id 발급(지역 접두 `prj`, ULID) */
  readonly ids: LocalIdFactory;
  /** 설정의 유효 값. 모르는 키는 undefined */
  readonly settingValue: (key: string) => unknown;
  /** 모든 대화를 최근순으로 준다. 읽기 실패는 빈 목록이 아니라 호출자가 알 수 없으므로 원천이 맡는다 */
  readonly threadRows: () => readonly ProjectThreadRow[];
  /** 배경 읽기(동기 원천의 값 갱신)가 실패했을 때 남긴다 */
  readonly report: (message: string, fields: Readonly<Record<string, unknown>>) => void;
  /** 프로젝트를 등록한 뒤 부른다(조립이 그 루트의 동반 플러그인을 훑는다). 기다린다 */
  readonly onRegistered?: () => Promise<void>;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** 이름을 정한다. 없으면 폴더 이름이고, 폴더 이름도 없으면(루트) 경로다. 128자까지 */
function nameOf(name: string | undefined, root: string): string {
  const text = name ?? (basename(root) || root);
  return text.slice(0, 128);
}

/** 정규 경로면 실제 경로, 없으면 절대 경로로 정리한 값. 기본 폴더가 아직 없을 때 소속을 계산하려고 쓴다 */
async function canonicalOrResolved(path: string): Promise<string> {
  const real = await attemptAsync(() => realpath(path));
  return real.ok ? real.value : resolve(path);
}

/** `project.instructions` 목록의 한 항목 */
type InstructionFile = ProjectInstructionsResult["files"][number];

/**
 * `createInstructionSections`는 대화 id로 값을 묻는다. 여기서는 폴더로 읽으므로 콜백이 이 값을 무시한다.
 * 같은 모양의 형식 검사를 통과하는 상수 id다
 */
const PROBE_THREAD_ID: ThreadId = probeThreadId();

function probeThreadId(): ThreadId {
  const text = `thr_${"0".repeat(26)}`;
  // 상수가 대화 id 모양이 아니면 코드가 틀린 것이다(불변 조건)
  if (!isId("thr", text)) throw new Bug("the probe thread id constant must match the id pattern");
  return text;
}

/** 루트 기준 `/`로 이은 상대 경로 */
function relPathOf(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function depthOf(path: string): number {
  return path.split("/").length;
}

/**
 * 지침 읽기 결과를 목록으로 바꾼다. 포함된 파일은 절 내용의 바이트 수를, 상한을 넘은 파일은 진단의 바이트 수를 싣는다.
 * 루트 밖으로 나간 파일은 읽지 않았으므로 바이트 0이다. 읽기 실패는 목록에 싣지 않는다. 루트 파일이 먼저다.
 */
function instructionFilesOf(root: string, read: InstructionSections): InstructionFile[] {
  const files: InstructionFile[] = [];
  for (const [key, text] of Object.entries(read.sections)) {
    const rel = key.slice("project:".length);
    const path = rel === "." ? INSTRUCTION_FILE : `${rel}/${INSTRUCTION_FILE}`;
    files.push({ path, bytes: new TextEncoder().encode(text).byteLength, included: true });
  }
  for (const diagnostic of read.diagnostics) {
    if (diagnostic.code === "instruction_too_large") {
      files.push({
        path: relPathOf(root, diagnostic.path),
        bytes: diagnostic.bytes,
        included: false,
      });
    } else if (diagnostic.code === "instruction_outside_root") {
      files.push({ path: relPathOf(root, diagnostic.path), bytes: 0, included: false });
    }
  }
  return files.toSorted(
    (left, right) =>
      depthOf(left.path) - depthOf(right.path) || left.path.localeCompare(right.path),
  );
}

/** 저장소 실패와 규칙 실패를 포트의 실패로 옮긴다 */
function failureOf(error: ProjectRuleFailure | ProjectStoreFailure): ProjectPortFailure {
  return error.kind === "corrupt" || error.kind === "io"
    ? { kind: "store", failure: error }
    : error;
}

export function createProjectPort(deps: ProjectPortDeps): ProjectPort {
  /** 마지막으로 읽은 루트 목록. 지침 원천의 동기 호출(`rootOfWorkspace`)이 쓴다 */
  let known: readonly ScopeRoot[] = [];
  const store = createProjectStore({
    path: join(deps.configDir, "projects.json"),
    fileLock: deps.fileLock,
    clock: deps.clock,
    signal: deps.signal,
  });

  function nowIso(): string {
    return new Date(deps.clock.now()).toISOString();
  }

  /** 기본 폴더의 절대 경로. 빈 설정이면 `<dataDir>/default-project`다. 절대 경로가 아니면 루트가 잘못된 것이다 */
  function defaultFolder(): Result<string, ProjectPortFailure> {
    const value = deps.settingValue(DEFAULT_FOLDER_KEY);
    const configured = typeof value === "string" ? value : "";
    const folder = configured === "" ? join(deps.dataDir, DEFAULT_PROJECT_FOLDER_NAME) : configured;
    return isAbsolute(folder) ? ok(folder) : err({ kind: "root_invalid" });
  }

  function maxInstructionBytes(): number {
    const value = deps.settingValue(INSTRUCTION_MAX_BYTES_KEY);
    return typeof value === "number" ? value : DEFAULT_INSTRUCTION_FILES_MAX_BYTES;
  }

  /** 루트 목록. 명시 프로젝트를 먼저 두고 암묵 기본 폴더 루트를 뒤에 둔다. 같은 폴더를 가리키면 명시 프로젝트가 이긴다(`deepestRoot`) */
  async function rootsOf(
    projects: readonly Project[],
  ): Promise<Result<readonly ScopeRoot[], ProjectPortFailure>> {
    const folder = defaultFolder();
    if (!folder.ok) return folder;
    const explicit: ScopeRoot[] = projects.map((project) => ({
      projectId: project.projectId,
      root: project.root,
      name: project.name,
    }));
    const implicit: ScopeRoot = {
      projectId: DEFAULT_PROJECT_ID,
      root: await canonicalOrResolved(folder.value),
      name: null,
    };
    return ok([...explicit, implicit]);
  }

  async function roots(): Promise<Result<readonly ScopeRoot[], ProjectPortFailure>> {
    const snapshot = await store.read();
    if (!snapshot.ok) return err({ kind: "store", failure: snapshot.error });
    const computed = await rootsOf(snapshot.value.projects);
    if (computed.ok) known = computed.value;
    return computed;
  }

  /** 루트 목록을 배경에서 다시 읽는다. 결과는 `known`에 남는다 */
  function refreshKnown(): void {
    detach(roots(), (cause) => {
      deps.report("project.roots_refresh_failed", {
        reason: cause instanceof Error ? cause.message : "unknown error",
      });
    });
  }

  refreshKnown();

  return {
    async list(): Promise<Result<ProjectListResult, ProjectPortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return err({ kind: "store", failure: snapshot.error });
      const all = await rootsOf(snapshot.value.projects);
      if (!all.ok) return all;
      const counts = new Map<string, { threads: number; running: number }>();
      for (const row of deps.threadRows()) {
        if (row.testRun || row.workspace === null || row.status === "closed") continue;
        const deepest = deepestRoot(row.workspace, all.value);
        // 암묵 기본 폴더 대화는 명시 프로젝트 묶음에 들지 않는다
        if (deepest === undefined || deepest.name === null) continue;
        const count = counts.get(deepest.projectId) ?? { threads: 0, running: 0 };
        count.threads += 1;
        if (row.status === "running") count.running += 1;
        counts.set(deepest.projectId, count);
      }
      const items: ProjectListItem[] = [];
      for (const project of snapshot.value.projects) {
        const count = counts.get(project.projectId);
        items.push({
          ...project,
          threadCount: count?.threads ?? 0,
          runningCount: count?.running ?? 0,
        });
      }
      return ok({ projects: items });
    },

    async get(projectId): Promise<Result<Project, ProjectPortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return err({ kind: "store", failure: snapshot.error });
      const found = snapshot.value.projects.find((project) => project.projectId === projectId);
      return found === undefined ? err({ kind: "not_found", projectId }) : ok(found);
    },

    async create(params: ProjectCreateParams): Promise<Result<Project, ProjectPortFailure>> {
      const canonical = await canonicalWorkspace(params.root);
      if (!canonical.ok) return err({ kind: "root_invalid" });
      const root = canonical.value;
      const done = await store.transact<Project, ProjectRuleFailure>((snapshot) => {
        if (snapshot.projects.some((project) => project.root === root)) {
          return err({ kind: "exists" });
        }
        if (snapshot.projects.length >= PROJECT_LIMITS.projects) {
          return err({ kind: "limit", max: PROJECT_LIMITS.projects });
        }
        const project: Project = {
          projectId: deps.ids.next("prj"),
          name: nameOf(params.name, root),
          root,
          createdAt: nowIso(),
          rev: 1,
        };
        return ok({ projects: [...snapshot.projects, project], value: project });
      });
      if (!done.ok) return err(failureOf(done.error));
      await deps.onRegistered?.();
      return ok(done.value.value);
    },

    async rename(params: ProjectRenameParams): Promise<Result<Project, ProjectPortFailure>> {
      const done = await store.transact<Project, ProjectRuleFailure>((snapshot) => {
        const current = snapshot.projects.find((project) => project.projectId === params.projectId);
        if (current === undefined) return err({ kind: "not_found", projectId: params.projectId });
        const updated: Project = { ...current, name: params.name, rev: current.rev + 1 };
        return ok({
          projects: snapshot.projects.map((project) =>
            project.projectId === params.projectId ? updated : project,
          ),
          value: updated,
        });
      });
      if (!done.ok) return err(failureOf(done.error));
      return ok(done.value.value);
    },

    async remove(projectId): Promise<Result<void, ProjectPortFailure>> {
      // 프로젝트 기록만 지운다. 대화와 작업 폴더는 그대로다(§3.4)
      const done = await store.transact<void, ProjectRuleFailure>((snapshot) => {
        if (!snapshot.projects.some((project) => project.projectId === projectId)) {
          return err({ kind: "not_found", projectId });
        }
        return ok({
          projects: snapshot.projects.filter((project) => project.projectId !== projectId),
          value: undefined,
        });
      });
      if (!done.ok) return err(failureOf(done.error));
      return ok(undefined);
    },

    async instructions(workspace): Promise<Result<ProjectInstructionsResult, ProjectPortFailure>> {
      const folder = await canonicalWorkspace(workspace);
      if (!folder.ok) return err({ kind: "root_invalid" });
      const all = await roots();
      if (!all.ok) return all;
      const deepest = deepestRoot(folder.value, all.value);
      // 루트가 없으면 지침을 모을 곳이 없다. 루트 폴더가 사라졌으면 그것도 루트가 없는 것이다
      if (deepest === undefined) return err({ kind: "root_invalid" });
      const rootReal = await attemptAsync(() => realpath(deepest.root));
      if (!rootReal.ok) return err({ kind: "root_invalid" });
      // 읽기, 상한, 루트 밖 링크 판정은 core-context의 지침 절 원천이 한다(M5c §4.4.7)
      const read = createInstructionSections({
        workspaceOf: () => folder.value,
        projectRootOf: () => rootReal.value,
        maxBytes: () => maxInstructionBytes(),
        fs: nodeInstructionFs,
      });
      const result = await read(PROBE_THREAD_ID);
      return ok({ files: instructionFilesOf(rootReal.value, result) });
    },

    async roots(): Promise<Result<readonly ScopeRoot[], ProjectPortFailure>> {
      return roots();
    },

    rootOfWorkspace(workspace: string): string | undefined {
      refreshKnown();
      return deepestRoot(workspace, known)?.root;
    },

    async attach(workspace): Promise<Result<ThreadProjectRef | null, ProjectPortFailure>> {
      const all = await roots();
      if (!all.ok) return all;
      const deepest = deepestRoot(workspace, all.value);
      if (deepest !== undefined) {
        return ok(
          deepest.name === null ? null : { projectId: deepest.projectId, name: deepest.name },
        );
      }
      // 어느 루트에도 없으면 그 폴더를 루트로 프로젝트를 만든다(§4.4.3, 미결 2의 기본값). 잠금 안에서 한 번 더 본다
      const done = await store.transact<ThreadProjectRef, ProjectRuleFailure>((snapshot) => {
        const explicit = snapshot.projects.map((project) => ({
          projectId: project.projectId,
          root: project.root,
          name: project.name,
        }));
        const existing = deepestRoot(workspace, explicit);
        if (existing !== undefined && existing.name !== null) {
          return ok({
            projects: snapshot.projects,
            value: { projectId: existing.projectId, name: existing.name },
          });
        }
        if (snapshot.projects.length >= PROJECT_LIMITS.projects) {
          return err({ kind: "limit", max: PROJECT_LIMITS.projects });
        }
        const project: Project = {
          projectId: deps.ids.next("prj"),
          name: nameOf(undefined, workspace),
          root: workspace,
          createdAt: nowIso(),
          rev: 1,
        };
        return ok({
          projects: [...snapshot.projects, project],
          value: { projectId: project.projectId, name: project.name },
        });
      });
      if (!done.ok) return err(failureOf(done.error));
      return ok(done.value.value);
    },

    async defaultWorkspace(threadId): Promise<Result<string, ProjectPortFailure>> {
      const folder = defaultFolder();
      if (!folder.ok) return folder;
      const target = join(folder.value, threadId);
      const made = await attemptAsync(() => mkdir(target, { recursive: true }));
      if (!made.ok) return err({ kind: "folder_io", code: errorCode(made.error.cause) });
      const real = await attemptAsync(() => realpath(target));
      if (!real.ok) return err({ kind: "folder_io", code: errorCode(real.error.cause) });
      return ok(real.value);
    },

    async recentThread(workspace): Promise<Result<RecentThread | undefined, ProjectPortFailure>> {
      const threads = [...deps.threadRows()].toSorted(
        (left, right) => right.updatedAt - left.updatedAt,
      );
      if (workspace === undefined) {
        return ok(recentThreadOf({ threads, workspace: undefined, projectIdOf: () => null }));
      }
      const folder = await workspaceFilterOf(workspace);
      if (!folder.ok) return err({ kind: "workspace", failure: folder.error });
      const all = await roots();
      if (!all.ok) return all;
      const scope = all.value;
      return ok(
        recentThreadOf({
          threads,
          workspace: folder.value,
          projectIdOf: (path) => projectIdOf(path, scope),
        }),
      );
    },

    onChange(listener: (change: ProjectsChange) => void): Unsubscribe {
      return store.onChange(listener);
    },
  };
}
