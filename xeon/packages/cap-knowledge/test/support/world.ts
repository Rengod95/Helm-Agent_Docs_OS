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
import { readKnowledgeSettings, withTrustedEvidence } from "../../src/settings.ts";
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

/** 블롭 저장과 고정 호출의 기록. 시험이 고정과 해제가 어떤 값으로 불렸는지 본다 */
type BlobEvent =
  | { readonly op: "put"; readonly sha256: string }
  | { readonly op: "pin"; readonly owner: string; readonly sha256: string; readonly refKey: string }
  | { readonly op: "unpin"; readonly owner: string; readonly refKey: string };

export interface World {
  readonly fs: MemoryFs;
  readonly store: TestStore;
  readonly clock: ManualClock;
  readonly deps: KnowledgeDeps;
  readonly runtime: KnowledgeRuntime;
  readonly executor: ChangeExecutor;
  readonly logs: LogLine[];
  /** 안전 캡처(blob 저장)와 고정(pin)을 실패시키는 스위치 */
  readonly blobFault: { putFails: boolean; pinFails: boolean };
  /** 블롭 호출 기록. 고정 실패로 시도한 호출도 남는다 */
  readonly blobEvents: BlobEvent[];
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
  /** 있으면 이 경로의 파일 저장소를 연다. 닫고 다시 여는 시험이 쓴다. 닫는 일은 시험이 한다(`closeWorlds`가 닫지 않는다) */
  readonly path?: string;
  /** 있으면 이 파일 시스템을 쓴다. 저장소를 다시 열어도 정본 파일이 남아 있게 한다 */
  readonly fs?: MemoryFs;
  /** 조립 루트가 선언하는 신뢰 증거 출처(`KnowledgePluginOptions.trustedEvidenceSources`와 같다) */
  readonly trustedEvidenceSources?: readonly string[];
  /** 저장소 능력 판정을 덮어쓴다(FTS5 없음, 낡은 SQLite 시험) */
  readonly capabilities?: { readonly fts5: boolean; readonly sqliteVersion: string };
  /** blob 유예 기간(ms). GC 시험이 시계를 조금 넘겨 지운다 */
  readonly blobGraceMs?: number;
}

/** 메모리 파일 시스템 + 실제 SQLite 임시 저장소 + 마이그레이션 적용을 한 번에 만든다 */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const clock = manualClock();
  const fs = options.fs ?? createMemoryFs();
  const ids = fixedIdFactory(clock);
  const store = await openTestStore({
    clock,
    ids,
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.blobGraceMs === undefined
      ? {}
      : { settings: { blobGraceMs: options.blobGraceMs } }),
  });
  if (options.path === undefined) opened.push(store);
  const migrated = store.service.migrations.apply(KNOWLEDGE_MIGRATIONS);
  if (!migrated.ok) throw new Error(`migration failed: ${migrated.error.kind}`);
  const logs: LogLine[] = [];
  const blobFault = { putFails: false, pinFails: false };
  const blobEvents: BlobEvent[] = [];
  const blobs: BlobPort = {
    putBlob: (bytes, mediaType) => {
      if (blobFault.putFails) return { ok: false, error: { kind: "disk_full" } };
      const stored = store.service.putBlob(bytes, mediaType);
      if (stored.ok) blobEvents.push({ op: "put", sha256: stored.value.sha256 });
      return stored;
    },
    readBlob: (ref) => store.service.readBlob(ref),
    pinBlob: (owner, sha256, refKey) => {
      blobEvents.push({ op: "pin", owner, sha256, refKey });
      if (blobFault.pinFails) return { ok: false, error: { kind: "disk_full" } };
      return store.service.pinBlob(owner, sha256, refKey);
    },
    unpinBlob: (owner, refKey) => {
      blobEvents.push({ op: "unpin", owner, refKey });
      return store.service.unpinBlob(owner, refKey);
    },
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
    settings: () =>
      withTrustedEvidence(readKnowledgeSettings(layers), options.trustedEvidenceSources),
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
    blobEvents,
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
