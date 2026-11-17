import { err, ok, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type {
  PluginGetResult,
  PluginListFilter,
  PluginListResult,
  ProfileListResult,
} from "@fresnel/contracts/wire";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { PluginPort, PluginPortFailure } from "../../handlers/m5/plugins.ts";
import type { ExtensionRecord } from "../m4/ext-read-port.ts";
import { compareUtf8 } from "./content-hash.ts";
import { buildPluginCard, type CardSubject } from "./card.ts";
import { discoverPluginFolders } from "./discover.ts";
import { readPluginFolder, type FolderDiagnostic, type PluginMaterials } from "./folder-reader.ts";

// 플러그인 읽기 서비스(M5c §3.4 `plugin.list`, `plugin.get`, §4.5). 원본 폴더와 로드된 레코드에서 카드를 만들고 캐시한다.
// 검토본 저장소가 아직 없으므로 폴더 원본은 모두 검토 대기 전(`none`)이고, 내장 패키지만 `approved`다(§4.5.2 마지막 줄).
// 사용처(`usedBy`)는 캐시하지 않고 읽을 때 프로필 목록에서 계산한다. 프로필을 고치면 바로 보인다.

/** 로드된 확장 한 줄에서 카드에 필요한 것(내장 포함). `ExtReadAssembly.extensions()`가 준다 */
export type PluginRecordSource = Pick<ExtensionRecord, "manifest" | "origin" | "location">;

interface PluginDiagnostic {
  /** 발견 단계(`name_conflict`, `outside_root`, `unreadable_entry`)나 폴더 읽기 단계(`manifest_invalid` 등)의 코드 */
  readonly code: string;
  /** 진단이 가리키는 폴더 또는 위치 */
  readonly dir: string;
  readonly message: string;
}

export interface PluginServiceDeps {
  /** 사용자 설정 폴더(`env.configDir`). 아래 `plugins/`와 기존 `extensions/`를 본다 */
  readonly configDir: string;
  /** 프로젝트 루트 목록. 프로젝트 개념(enC2 트랙)이 주입한다. 지금은 빈 목록을 넘긴다 */
  readonly projectRoots: () => readonly string[];
  /** 관리 폴더. 조립에 아직 없으면 null */
  readonly managedDir: string | null;
  /** 기본 제공 번들 폴더(`defaultPluginsDir()`). 없으면 null */
  readonly bundleDir: string | null;
  /** 로드된 확장 목록(내장 포함) */
  readonly records: () => readonly PluginRecordSource[];
  /** 프로필 목록. `usedBy` 계산에 쓴다. 읽지 못하면 그 실패를 호출자에게 준다 */
  readonly profiles: Pick<ProfileTestRunPort, "list">;
  /** 진단을 남기는 로그 */
  readonly log: { info(message: string, fields: Readonly<Record<string, unknown>>): void };
}

export interface PluginService extends PluginPort {
  /** 원본 폴더와 레코드를 다시 훑어 캐시를 바꾼다 */
  scan(): void;
  /** 마지막 훑기에서 나온 진단. `plugin.list`의 결과에는 넣을 자리가 없어 이 함수로만 본다(§3.4) */
  diagnostics(): readonly PluginDiagnostic[];
}

/** 사용처 목록에서 공통 묶음을 가리키는 값(§3.1) */
const COMMON = "common";

const IDLE_HEALTH: PluginCard["health"] = { state: "idle", lastActiveAt: null, lastError: null };
const NO_REVIEW: PluginCard["review"] = {
  state: "none",
  currentHash: null,
  pendingItemId: null,
  approvedAt: null,
};
const BUILTIN_REVIEW: PluginCard["review"] = {
  state: "approved",
  currentHash: null,
  pendingItemId: null,
  approvedAt: null,
};
/** 원본 폴더가 없는 플러그인의 재료는 비어 있다. 카드는 매니페스트만으로 계산한다 */
const NO_MATERIALS: PluginMaterials = {
  instructions: [],
  skills: [],
  mcpServers: [],
  agents: [],
  commands: [],
};

interface Entry {
  /** 사용처(`usedBy`)를 뺀 카드. 사용처는 읽을 때 채운다 */
  readonly card: PluginCard;
  /** 폴더 원본 경로. 원본 폴더가 없으면 null */
  readonly source: string | null;
}

interface Index {
  /** 이름 순 */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

function diagnosticOf(dir: string, item: FolderDiagnostic): PluginDiagnostic {
  return {
    code: item.code,
    dir,
    message: item.path === "" ? item.message : `${item.path}: ${item.message}`,
  };
}

function manifestSubject(record: PluginRecordSource): CardSubject {
  return { name: record.manifest.name, manifest: record.manifest, materials: NO_MATERIALS };
}

/**
 * 카드 후보를 모은다. 출처 순서는 내장 레코드, 폴더 원본, 나머지 레코드다.
 * 내장이 이름을 먼저 잡고, 폴더 원본이 그다음이며(같은 이름은 `name_conflict`), 폴더 원본이 있는 이름의 레코드는 버린다(원본이 카드다).
 */
function buildIndex(deps: PluginServiceDeps): Index {
  const diagnostics: PluginDiagnostic[] = [];
  const byName = new Map<string, Entry>();
  const claim = (entry: Entry, dir: string): void => {
    const name = entry.card.name;
    if (byName.has(name)) {
      diagnostics.push({
        code: "name_conflict",
        dir,
        message: `plugin name "${name}" is already claimed`,
      });
      return;
    }
    byName.set(name, entry);
  };

  const records = deps.records();
  for (const record of records) {
    if (record.origin !== "builtin") continue;
    claim(
      {
        card: buildPluginCard({
          folder: manifestSubject(record),
          origin: { kind: "builtin" },
          review: BUILTIN_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        source: null,
      },
      record.location,
    );
  }

  const found = discoverPluginFolders({
    configDir: deps.configDir,
    extraPaths: [],
    projectRoots: deps.projectRoots(),
    managedDir: deps.managedDir,
    bundleDir: deps.bundleDir,
  });
  for (const item of found.diagnostics) {
    diagnostics.push({ code: item.code, dir: item.dir, message: item.message });
  }
  for (const candidate of found.candidates) {
    const read = readPluginFolder(candidate.dir, { origin: candidate.origin });
    if (!read.ok) {
      for (const item of read.error.diagnostics) {
        diagnostics.push(diagnosticOf(candidate.dir, item));
      }
      continue;
    }
    for (const item of read.value.diagnostics) {
      diagnostics.push(diagnosticOf(candidate.dir, item));
    }
    claim(
      {
        card: buildPluginCard({
          folder: read.value,
          origin: { kind: candidate.origin },
          review: NO_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        source: candidate.dir,
      },
      candidate.dir,
    );
  }

  for (const record of records) {
    if (record.origin === "builtin") continue;
    // 폴더 원본이 있는 이름은 그 원본이 카드다. 레코드는 조용히 뺀다
    if (byName.has(record.manifest.name)) continue;
    claim(
      {
        card: buildPluginCard({
          folder: manifestSubject(record),
          origin: { kind: record.origin },
          review: NO_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        source: null,
      },
      record.location,
    );
  }

  const entries = [...byName.values()].toSorted((a, b) => compareUtf8(a.card.name, b.card.name));
  return { entries, diagnostics };
}

function usedByOf(name: string, listed: ProfileListResult): string[] {
  const profileIds = listed.profiles
    .filter((profile) => profile.plugins.some((ref) => ref.name === name))
    .map((profile) => profile.id);
  return listed.common.plugins.some((ref) => ref.name === name)
    ? [...profileIds, COMMON]
    : profileIds;
}

function withUsedBy(card: PluginCard, listed: ProfileListResult): PluginCard {
  return { ...card, usedBy: usedByOf(card.name, listed) };
}

/** 필터: 프로필은 그 프로필에 든 것과 공통 묶음에 든 것을 보인다(§3.4) */
function matches(card: PluginCard, filter: PluginListFilter): boolean {
  if (filter.origin !== undefined && card.origin.kind !== filter.origin) return false;
  if (filter.reviewState !== undefined && card.review.state !== filter.reviewState) return false;
  if (
    filter.profileId !== undefined &&
    !card.usedBy.includes(filter.profileId) &&
    !card.usedBy.includes(COMMON)
  ) {
    return false;
  }
  return true;
}

/**
 * 플러그인 읽기 서비스를 만든다. 캐시는 `scan()`이 채운다. 캐시가 없을 때 처음 부르는 `list`·`get`·`diagnostics`가
 * 한 번 훑는다. 검토본 저장소와 감시가 없으므로 원본이 바뀌어도 `scan()`을 부르기 전까지는 캐시가 그대로다 [제안: plugin.scan에서 부른다]
 */
export function createPluginService(deps: PluginServiceDeps): PluginService {
  let index: Index | undefined;

  function rebuild(): Index {
    const next = buildIndex(deps);
    index = next;
    for (const item of next.diagnostics) {
      deps.log.info("plugin.scan.diagnostic", {
        code: item.code,
        dir: item.dir,
        message: item.message,
      });
    }
    return next;
  }

  function current(): Index {
    return index ?? rebuild();
  }

  async function list(
    filter: PluginListFilter,
  ): Promise<Result<PluginListResult, PluginPortFailure>> {
    const entries = current().entries;
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profiles", failure: listed.error });
    const plugins = entries
      .map((entry) => withUsedBy(entry.card, listed.value))
      .filter((card) => matches(card, filter));
    return ok({ plugins });
  }

  async function get(name: string): Promise<Result<PluginGetResult, PluginPortFailure>> {
    const entry = current().entries.find((item) => item.card.name === name);
    if (entry === undefined) return err({ kind: "unknown_plugin", name });
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profiles", failure: listed.error });
    return ok({
      card: withUsedBy(entry.card, listed.value),
      versions: [],
      source: entry.source === null ? null : { path: entry.source, matchesReviewed: false },
      entries: [],
      settingsDefs: [],
    });
  }

  return {
    scan: () => {
      rebuild();
    },
    list,
    get,
    diagnostics: () => current().diagnostics,
  };
}
