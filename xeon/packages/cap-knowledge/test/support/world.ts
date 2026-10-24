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
import { readKnowledgeSettings } from "../../src/settings.ts";
import { resolveSkillRoots } from "../../src/skills/roots.ts";
import { fixedIdFactory, fixedLocalIds, manualClock, type ManualClock } from "./clock.ts";
import { createMemoryFs, type MemoryFs } from "./memory-fs.ts";

const DATA_DIR = "/data";
const PROJECT_DIR = "/proj";
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
  readonly extensionRoots?: readonly { readonly dir: string; readonly extension: string }[];
}

/** 메모리 파일 시스템 + 실제 SQLite 임시 저장소 + 마이그레이션 적용을 한 번에 만든다 */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const clock = manualClock();
  const fs = createMemoryFs();
  const store = await openTestStore({ clock, ids: fixedIdFactory(clock) });
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
  const deps: KnowledgeDeps = {
    fs,
    db: store.service.scoped(KNOWLEDGE_OWNER),
    blobs,
    clock,
    ids: fixedLocalIds(),
    logger: recordingLogger(logs),
    settings: () => readKnowledgeSettings(layers),
    roots: () => {
      const settings = readKnowledgeSettings(layers);
      return resolveSkillRoots({
        dataDir: DATA_DIR,
        projectDir: PROJECT_DIR,
        projectSkills: settings.skills.projectSkills,
        paths: settings.skills.paths,
        extension: options.extensionRoots ?? [],
      });
    },
    containsKnown: options.containsKnown,
  };
  return {
    fs,
    store,
    clock,
    deps,
    runtime: createKnowledgeRuntime(deps),
    executor: createChangeExecutor(deps),
    logs,
    blobFault,
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
