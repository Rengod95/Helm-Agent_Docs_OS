import type { Logger, LogFields } from "@xeon/contracts";
import type { ScopeLayer, ScopeStack } from "@xeon/contracts/settings";
import { openTestStore, type TestStore } from "@xeon/platform-store/testing";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_OWNER } from "../../src/migrations.ts";
import type { BlobPort } from "../../src/ledger/manifest.ts";
import { createChangeExecutor, type ChangeExecutor } from "../../src/ledger/change.ts";
import {
  createKnowledgeRuntime,
  type KnowledgeDeps,
  type KnowledgeRuntime,
} from "../../src/service.ts";
import type { WriteApprovals } from "../../src/ports/approvals.ts";
import { readKnowledgeSettings } from "../../src/settings.ts";
import { resolveSkillRoots } from "../../src/skills/roots.ts";
import { fixedIdFactory, fixedLocalIds, manualClock, type ManualClock } from "./clock.ts";
import { createMemoryFs, type MemoryFs } from "./memory-fs.ts";
import { createSessionKit, type SessionKit } from "./sessions.ts";
import { setupSearch } from "../../src/search/setup.ts";

const DATA_DIR = "/data";
const PROJECT_DIR = "/proj";
export const MEMORY_DIR = "/data/memory";
export const USER_SKILLS = "/data/skills";
export const PROJECT_SKILLS = "/proj/.xeon/skills";

interface LogLine {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields | undefined;
}

export interface World {
  readonly fs: MemoryFs;
  readonly store: TestStore;
  readonly clock: ManualClock;
  readonly deps: KnowledgeDeps;
  readonly runtime: KnowledgeRuntime;
  readonly executor: ChangeExecutor;
  readonly logs: LogLine[];
  /** 안전 캡처(blob 저장)를 실패시키는 스위치 */
  readonly blobFault: { putFails: boolean };
  /** `sessions: true`로 열었을 때의 세션 도우미 */
  readonly sessions: SessionKit | undefined;
  /** 색인 소비자가 받은 배치를 모두 처리하기를 기다린다 */
  settleIndex(): Promise<void>;
  /** 설정 층을 바꾼다. 다음 호출부터 적용된다 */
  setLayers(layers: ScopeStack): void;
}

const opened: TestStore[] = [];

export async function closeWorlds(): Promise<void> {
  await Promise.all(opened.splice(0).map((store) => store[Symbol.asyncDispose]()));
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ level: "debug", event, fields }),
    info: (event, fields) => void lines.push({ level: "info", event, fields }),
    warn: (event, fields) => void lines.push({ level: "warn", event, fields }),
    error: (event, fields) => void lines.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return logger;
}

export function userLayer(values: Record<string, unknown>): ScopeLayer {
  return { scope: "user", values: new Map(Object.entries(values)) };
}

export interface WorldOptions {
  readonly containsKnown?: (text: string) => boolean;
  /** 쓰기 승인 포트. 없으면 승인 대신 제안 대기열로 간다 */
  readonly approvals?: WriteApprovals;
  readonly extensionRoots?: readonly { readonly dir: string; readonly extension: string }[];
  /** true면 실제 세션 서비스(투영기 등록부 포함)를 올리고 검색 표와 색인 소비자를 시작한다 */
  readonly sessions?: boolean;
  /** 저장소 능력 판정을 덮어쓴다(FTS5 없음, 낡은 SQLite 시험) */
  readonly capabilities?: { readonly fts5: boolean; readonly sqliteVersion: string };
}

/** 메모리 파일 시스템 + 실제 SQLite 임시 저장소 + 마이그레이션 적용을 한 번에 만든다 */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const clock = manualClock();
  const fs = createMemoryFs();
  const ids = fixedIdFactory(clock);
  const store = await openTestStore({ clock, ids });
  opened.push(store);
  const migrated = store.service.migrations.apply(KNOWLEDGE_MIGRATIONS);
  if (!migrated.ok) throw new Error(`migration failed: ${migrated.error.kind}`);
  const logs: LogLine[] = [];
  const blobFault = { putFails: false };
  const blobs: BlobPort = {
    putBlob: (bytes, mediaType) =>
      blobFault.putFails
        ? { ok: false, error: { kind: "disk_full" } }
        : store.service.putBlob(bytes, mediaType),
    readBlob: (ref) => store.service.readBlob(ref),
  };
  let layers: ScopeStack = [];
  const logger = recordingLogger(logs);
  const kit =
    options.sessions === true ? createSessionKit({ store, clock, ids, logger }) : undefined;
  const db = store.service.scoped(KNOWLEDGE_OWNER);
  const search = setupSearch({
    capabilities: options.capabilities ?? store.service.capabilities,
    session: kit?.session,
    db,
    logger,
  });
  const deps: KnowledgeDeps = {
    fs,
    db,
    docsFts: search.availability.docs,
    blobs,
    clock,
    ids: fixedLocalIds(),
    logger,
    settings: () => readKnowledgeSettings(layers),
    roots: () => {
      const settings = readKnowledgeSettings(layers);
      return Promise.resolve({
        roots: resolveSkillRoots({
          dataDir: DATA_DIR,
          projectDir: PROJECT_DIR,
          projectSkills: settings.skills.projectSkills,
          projectTrusted: true,
          paths: settings.skills.paths,
          extension: options.extensionRoots ?? [],
        }),
        diagnostics: [],
      });
    },
    containsKnown: options.containsKnown,
    approvals: options.approvals,
    memoryDir: MEMORY_DIR,
    session: kit?.session,
    searchAvailability: search.availability,
  };
  const runtime = createKnowledgeRuntime(deps);
  if (kit !== undefined) {
    const started = await runtime.startup();
    if (!started.ok) throw new Error(`startup failed: ${started.error.message}`);
  }
  return {
    fs,
    store,
    clock,
    deps,
    runtime,
    executor: createChangeExecutor(deps),
    logs,
    blobFault,
    sessions: kit,
    settleIndex: async () => {
      await runtime.indexer()?.settled();
    },
    setLayers(next) {
      layers = next;
    },
  };
}

/** 스킬 하나를 메모리 파일 시스템에 둔다 */
export function putSkill(
  fs: MemoryFs,
  root: string,
  name: string,
  options: {
    readonly description?: string;
    readonly body?: string;
    readonly extra?: Readonly<Record<string, string>>;
    readonly frontmatter?: string;
  } = {},
): string {
  const dir = `${root}/${name}`;
  const description = options.description ?? `Use when working on ${name}.`;
  const front = options.frontmatter ?? "";
  fs.put(
    `${dir}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\n${front}---\n${options.body ?? `# ${name}\n\nSteps.\n`}`,
  );
  for (const [path, content] of Object.entries(options.extra ?? {}))
    fs.put(`${dir}/${path}`, content);
  return dir;
}
