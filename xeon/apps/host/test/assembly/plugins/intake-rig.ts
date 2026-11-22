import { join } from "node:path";
import { ok, parse, type Logger, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { Profile, ProfileListResult } from "@fresnel/contracts/wire";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import {
  createMaterialPort,
  createPluginReview,
  createPluginService,
  createPluginStore,
  readPluginFolder,
  type PluginDraftIntake,
  type PluginReview,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { approvalHooksOf, type ApprovalHookDeps } from "../../../src/assembly/plugins/approval.ts";
import type { PluginEditRequest } from "../../../src/assembly/m4/plugin-edit.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// 검토 서비스와 공유 입구, 마이그레이션 제출 시험의 공통 설정. 프로필 `work` 하나와 승인 훅의 기록용 가짜를 둔다.

export const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

/** 시험의 시각. 호출마다 1초씩 나아간다 */
let tick = 0;
function isoNow(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 18, 2, 0, 0) + tick * 1000).toISOString();
}

/** 목록에 든 프로필 `work` 하나 */
const WORK: Profile = {
  id: "work",
  title: "Work",
  builtin: false,
  plugins: [],
  settings: [],
  startDrive: null,
  updatedAt: "2026-11-18T00:00:00.000Z",
  rev: 1,
};

export const PROFILES: ProfileListResult = {
  profiles: [WORK],
  common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
  rev: 1,
};

export const APPROVE_TO_WORK = {
  kind: "approve",
  profileIds: ["work"],
  libraryOnly: false,
} as const;

export interface PluginRig {
  readonly root: string;
  /** 사용자 플러그인 폴더(`<config>/plugins`) */
  readonly userDir: string;
  readonly store: PluginStore;
  readonly review: PluginReview;
  /** 공유 입구. 검토 서비스가 만든 것과 같은 것이다 */
  readonly intake: PluginDraftIntake;
  /** 승인 훅이 프로필에 보낸 요청 */
  readonly edits: PluginEditRequest[];
}

const createdRoots: string[] = [];

/** 시험이 끝나면 부른다. 만든 임시 폴더를 모두 지운다 */
export function removeRigs(): void {
  for (const root of createdRoots.splice(0)) removeTree(root);
}

/** 승인 훅을 실제 훅 묶음으로 잇되 프로필은 기록만 한다 */
function hooksFor(edits: PluginEditRequest[]): ApprovalHookDeps {
  return {
    profiles: {
      checkPluginEdit: () => Promise.resolve(ok(undefined)),
      applyPluginEdit: (request) => {
        edits.push(request);
        return Promise.resolve(
          ok({
            profileIds: request.kind === "add" ? request.profileIds : [],
            missingPlugins: [],
          }),
        );
      },
    },
    loader: () => undefined,
    refreshPluginSet: () => Promise.resolve(),
    facts: () => [],
    log: SILENT,
  };
}

/** 새 임시 세계를 만든다. 검토 서비스, 공유 입구, 프로필 `work` 하나가 있다 */
export function pluginRigOf(): PluginRig {
  const root = tempRoot("plugin-intake-");
  createdRoots.push(root);
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const service = createPluginService({
    configDir: join(root, "config"),
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(PROFILES)) },
    store,
    log: { info() {} },
  });
  const edits: PluginEditRequest[] = [];
  const review = createPluginReview({
    store,
    plugins: service,
    profiles: { list: () => Promise.resolve(ok(PROFILES)) },
    userDir: join(root, "config", "plugins"),
    ids: createLocalIdFactory({ now: () => 1_800_000_000_000 }, systemRandom()),
    now: isoNow,
    log: SILENT,
    approvalHooks: approvalHooksOf(hooksFor(edits)),
  });
  return {
    root,
    userDir: join(root, "config", "plugins"),
    store,
    review,
    intake: review.intake,
    edits,
  };
}

/** 결과가 값이면 값을 준다. 실패면 시험을 실패시킨다 */
export function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** 결과가 실패면 실패를 준다. 값이면 시험을 실패시킨다 */
export function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("expected a failure, got a value");
  return result.error;
}

/** 재료 포트가 읽을 대화 id. 형식이 맞는 고정 값이다 */
const THREAD: ThreadId = valueOf(parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV"));

/** 검토본의 지침 본문(재료 포트가 읽는 그대로). 검토본이 없으면 빈 목록이다 */
export async function instructionTextsOf(rig: PluginRig, name: string): Promise<string[]> {
  const reviewed = valueOf(await rig.store.current(name));
  const port = createMaterialPort({
    pluginSet: () => [name],
    treeOf: () => reviewed?.treePath ?? null,
    read: (dir) => readPluginFolder(dir, { origin: "user" }),
    report: () => {},
  });
  return port.instructions(THREAD).map((material) => material.text);
}

/** 스킬 하나만 든 원본 폴더 `<root>/<name>/`을 쓴다. 이름은 폴더 이름이자 스킬 이름이다 */
export function writeSkillFolder(root: string, name: string): string {
  writeFiles(root, {
    [`${name}/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: 메모를 정리한다\n---\n본문\n`,
  });
  return join(root, name);
}
