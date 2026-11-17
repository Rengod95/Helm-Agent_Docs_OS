import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { attemptAsync, ok, type Clock, type Result } from "@fresnel/contracts";
import type { LocalIdFactory, ThreadStatus } from "@fresnel/contracts/conversation";
import { PROJECT_LIMITS, type Project } from "@fresnel/contracts/wire";
import { deepestRoot, type ScopeRoot } from "./project-scope.ts";
import type { ProjectStore, ProjectStoreFailure } from "./project-store.ts";

// 첫 시작 옮김의 암묵 프로젝트 부분(M5c §4.4.3, §7.6). 대화 폴더가 옮김 시작 때의 어느 루트에도 속하지 않으면
// 그 폴더를 루트로 프로젝트를 하나 만든다. 서로 포함하는 폴더는 각각 프로젝트로 두고(중첩 허용), 소속은 가장 깊은 루트가 정한다.
// 같은 루트의 프로젝트가 이미 있으면 만들지 않는다(잠금 안에서 다시 본다). 대화 기록은 건드리지 않는다.
// `ProjectPort.attach`는 한 번에 한 폴더를 보고 이미 생긴 루트 안의 폴더는 그 루트에 속하므로 중첩을 만들지 못해 쓰지 않는다.

/** 옮김이 보는 대화 한 개. Test run 대화는 프로젝트 묶음에서 뺀다(§4.8) */
export interface MigrationThread {
  /** 정규 작업 폴더. 없으면 null이고 옮김이 건드리지 않는다(§7.6) */
  readonly workspace: string | null;
  readonly status: ThreadStatus;
  /** Test run 대화인가 */
  readonly testRun: boolean;
}

export interface ImplicitProjectInput {
  readonly threads: readonly MigrationThread[];
  /** 옮김 시작 때의 루트(명시 프로젝트와 암묵 기본 폴더 루트). 이 목록으로 "어느 루트에도 없다"를 판정한다 */
  readonly roots: readonly ScopeRoot[];
  readonly projects: ProjectStore;
  readonly ids: LocalIdFactory;
  readonly clock: Clock;
}

interface ImplicitProjectSkip {
  readonly folder: string;
  /** missing: 폴더가 없다. not_directory: 폴더가 아니다. limit: 프로젝트 상한을 넘었다 */
  readonly reason: "missing" | "not_directory" | "limit";
}

/** 폴더 하나를 본 결과: 프로젝트를 만들 정규 경로이거나 건너뛸 사유다 */
type FolderCheck =
  | { readonly kind: "ok"; readonly real: string }
  | {
      readonly kind: "skip";
      readonly folder: string;
      readonly reason: ImplicitProjectSkip["reason"];
    };

export interface ImplicitProjectOutcome {
  readonly created: readonly { readonly projectId: string; readonly root: string }[];
  readonly skipped: readonly ImplicitProjectSkip[];
}

/** 프로젝트 이름은 폴더 이름이다(`project-port.ts`의 `nameOf`와 같다). 128자까지 */
function nameOfFolder(folder: string): string {
  return (basename(folder) || folder).slice(0, 128);
}

export async function migrateImplicitProjects(
  input: ImplicitProjectInput,
): Promise<Result<ImplicitProjectOutcome, ProjectStoreFailure>> {
  const skipped: ImplicitProjectSkip[] = [];
  const named = new Set<string>();
  for (const thread of input.threads) {
    if (thread.workspace === null || thread.testRun || thread.status === "closed") continue;
    named.add(thread.workspace);
  }
  const checks = await Promise.all(
    [...named].toSorted().map(async (folder): Promise<FolderCheck> => {
      const real = await attemptAsync(() => realpath(folder));
      if (!real.ok) return { kind: "skip", folder, reason: "missing" };
      const info = await attemptAsync(() => stat(real.value));
      if (!info.ok) return { kind: "skip", folder, reason: "missing" };
      if (!info.value.isDirectory()) return { kind: "skip", folder, reason: "not_directory" };
      return { kind: "ok", real: real.value };
    }),
  );
  const folders = new Set<string>();
  for (const check of checks) {
    if (check.kind === "ok") folders.add(check.real);
    else skipped.push({ folder: check.folder, reason: check.reason });
  }
  // 옮김 시작 때의 루트로 본다. 암묵 기본 폴더 안의 대화는 이미 암묵 프로젝트에 속한다(deepestRoot가 그 루트를 준다)
  const candidates = [...folders]
    .toSorted()
    .filter((folder) => deepestRoot(folder, input.roots) === undefined);
  const done = await input.projects.transact<
    { readonly created: ImplicitProjectOutcome["created"]; readonly overLimit: string[] },
    never
  >((snapshot) => {
    const projects: Project[] = [...snapshot.projects];
    const created: { projectId: string; root: string }[] = [];
    const overLimit: string[] = [];
    const nowIso = new Date(input.clock.now()).toISOString();
    for (const folder of candidates) {
      // 같은 루트의 프로젝트가 있으면 만들지 않는다(project.exists와 같은 판정이다)
      if (projects.some((project) => project.root === folder)) continue;
      if (projects.length >= PROJECT_LIMITS.projects) {
        overLimit.push(folder);
        continue;
      }
      const project: Project = {
        projectId: input.ids.next("prj"),
        name: nameOfFolder(folder),
        root: folder,
        createdAt: nowIso,
        rev: 1,
      };
      projects.push(project);
      created.push({ projectId: project.projectId, root: folder });
    }
    return ok({ projects, value: { created, overLimit } });
  });
  if (!done.ok) return done;
  return ok({
    created: done.value.value.created,
    skipped: [
      ...skipped,
      ...done.value.value.overLimit.map((folder) => ({ folder, reason: "limit" as const })),
    ],
  });
}
