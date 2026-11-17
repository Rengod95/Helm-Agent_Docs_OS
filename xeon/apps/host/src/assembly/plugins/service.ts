import { err, ok, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type {
  PluginGetResult,
  PluginListFilter,
  PluginListResult,
  PluginVersion,
  ProfileListResult,
} from "@fresnel/contracts/wire";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { PluginPort, PluginPortFailure } from "../../handlers/m5/plugins.ts";
import type { ExtensionRecord } from "../m4/ext-read-port.ts";
import { compareUtf8 } from "./content-hash.ts";
import { buildPluginCard, type CardSubject } from "./card.ts";
import { discoverPluginFolders } from "./discover.ts";
import { readPluginFolder, type FolderDiagnostic, type PluginMaterials } from "./folder-reader.ts";
import type { PluginStore, PluginStoreError, ReviewedVersion } from "./store.ts";

// 플러그인 읽기 서비스(M5c §3.4 `plugin.list`, `plugin.get`, `plugin.scan`, §4.5). 원본 폴더와 로드된 레코드와 검토본 저장소에서 카드를 만든다.
// 카드의 검토 칸과 무결성은 저장소에서 온다. 원본 폴더는 카드의 내용(후보 기준)이고, 원본 해시가 검토본과 다르면 `matchesReviewed`가 거짓이다.
// 목록과 상세는 캐시를 읽는다. 캐시는 `scan()`이 바꾼다(감시가 없으므로 `plugin.scan`만 훑는다, §4.5.7).
// 사용처(`usedBy`)는 캐시하지 않고 읽을 때 프로필에서 계산한다.

/** 로드된 확장 한 줄에서 카드에 필요한 것(내장 포함). `ExtReadAssembly.extensions()`가 준다 */
export type PluginRecordSource = Pick<ExtensionRecord, "manifest" | "origin" | "location">;

interface PluginDiagnostic {
  /** 발견 단계(`name_conflict`, `outside_root`, `unreadable_entry`)나 폴더 읽기 단계(`manifest_invalid` 등)의 코드 */
  readonly code: string;
  /** 진단이 가리키는 폴더 또는 위치 */
  readonly dir: string;
  readonly message: string;
}

/** 검토본 저장소의 읽기 면. 서비스는 쓰지 않는다 */
export type PluginStoreReader = Pick<
  PluginStore,
  "names" | "current" | "versions" | "verifyIntegrity"
>;

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
  /** 검토본 저장소. 검토 칸, 무결성, 보관 목록을 여기서 읽는다 */
  readonly store: PluginStoreReader;
  /** 진단을 남기는 로그 */
  readonly log: { info(message: string, fields: Readonly<Record<string, unknown>>): void };
}

export interface PluginService extends PluginPort {
  /** 마지막 훑기에서 나온 진단. `plugin.list`의 결과에는 넣을 자리가 없어 이 함수로만 본다(§3.4) */
  diagnostics(): Promise<Result<readonly PluginDiagnostic[], PluginPortFailure>>;
  /** 원본 폴더가 검토본과 다른 이름들(검토본이 없는 원본 포함). 다음 층이 검토 항목을 만들 때 쓴다 */
  changedSources(): Promise<Result<readonly string[], PluginPortFailure>>;
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
  /** 원본 폴더의 내용 해시. 원본이 없으면 null */
  readonly sourceHash: string | null;
  /** 현재 검토본의 내용 해시. 검토본이 없으면 null */
  readonly reviewedHash: string | null;
}

interface Index {
  /** 이름 순 */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

function storeFailure(error: PluginStoreError): PluginPortFailure {
  return { kind: "store", code: error.kind };
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

function approvedReview(version: ReviewedVersion): PluginCard["review"] {
  return {
    state: "approved",
    currentHash: version.contentHash,
    pendingItemId: null,
    approvedAt: version.meta.approvedAt,
  };
}

/** 이름 하나의 항목을 모은다. 같은 이름이 이미 있으면 `name_conflict`로 버린다 */
function claimInto(
  byName: Map<string, Entry>,
  diagnostics: PluginDiagnostic[],
  entry: Entry,
  dir: string,
): void {
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
}

/**
 * 카드 후보를 모은다. 출처 순서는 내장 레코드, 폴더 원본, 검토본 저장소, 나머지 레코드다.
 * 같은 이름은 앞의 것이 쥔다. 폴더 원본이 있는 이름은 원본 폴더가 카드 내용을 주고, 검토본이 있으면 검토 칸과 무결성만 저장소에서 덮는다.
 * 원본 폴더가 없고 검토본만 있으면 검토본 메타의 카드를 쓴다.
 */
async function buildIndex(deps: PluginServiceDeps): Promise<Result<Index, PluginPortFailure>> {
  const diagnostics: PluginDiagnostic[] = [];
  const byName = new Map<string, Entry>();

  const records = deps.records();
  for (const record of records) {
    if (record.origin !== "builtin") continue;
    claimInto(
      byName,
      diagnostics,
      {
        card: buildPluginCard({
          folder: manifestSubject(record),
          origin: { kind: "builtin" },
          review: BUILTIN_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        source: null,
        sourceHash: null,
        reviewedHash: null,
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
    claimInto(
      byName,
      diagnostics,
      {
        card: buildPluginCard({
          folder: read.value,
          origin: { kind: candidate.origin },
          review: NO_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        source: candidate.dir,
        sourceHash: read.value.contentHash,
        reviewedHash: null,
      },
      candidate.dir,
    );
  }

  // 검토본 저장소: 원본 폴더가 있는 이름이면 검토 칸과 무결성을 덮고, 없으면 검토본 메타의 카드로 항목을 만든다
  const names = await deps.store.names();
  if (!names.ok) return err(storeFailure(names.error));
  // 이름마다 현재 검토본과 무결성을 읽는다. 서로 독립이라 함께 읽는다
  const loaded = await Promise.all(
    names.value.map(async (name) => {
      const current = await deps.store.current(name);
      if (!current.ok || current.value === null) return { name, current, integrity: null };
      const integrity = await deps.store.verifyIntegrity(name, current.value.contentHash);
      return { name, current, integrity };
    }),
  );
  for (const item of loaded) {
    const name = item.name;
    if (!item.current.ok) return err(storeFailure(item.current.error));
    const version = item.current.value;
    if (version === null || item.integrity === null) continue;
    const integrity = item.integrity;
    let health: PluginCard["health"] = IDLE_HEALTH;
    if (!integrity.ok) {
      if (integrity.error.kind !== "pinned_corrupt") return err(storeFailure(integrity.error));
      health = {
        state: "integrity",
        lastActiveAt: null,
        lastError: "the reviewed copy no longer matches its recorded hash",
      };
      diagnostics.push({
        code: "pinned_corrupt",
        dir: `reviewed/${name}`,
        message: `the reviewed copy of ${name} no longer matches its recorded hash`,
      });
    }
    const existing = byName.get(name);
    if (existing !== undefined) {
      if (existing.card.origin.kind === "builtin") {
        diagnostics.push({
          code: "name_conflict",
          dir: `reviewed/${name}`,
          message: `plugin name "${name}" is already claimed`,
        });
        continue;
      }
      byName.set(name, {
        ...existing,
        card: { ...existing.card, review: approvedReview(version), health },
        reviewedHash: version.contentHash,
      });
      continue;
    }
    claimInto(
      byName,
      diagnostics,
      {
        card: { ...version.meta.card, review: approvedReview(version), health, usedBy: [] },
        source: null,
        sourceHash: null,
        reviewedHash: version.contentHash,
      },
      `reviewed/${name}`,
    );
  }

  for (const record of records) {
    if (record.origin === "builtin") continue;
    // 원본 폴더나 검토본이 있는 이름은 그 쪽이 카드다. 레코드는 조용히 뺀다
    if (byName.has(record.manifest.name)) continue;
    claimInto(
      byName,
      diagnostics,
      {
        card: buildPluginCard({
          folder: manifestSubject(record),
          origin: { kind: record.origin },
          review: NO_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        source: null,
        sourceHash: null,
        reviewedHash: null,
      },
      record.location,
    );
  }

  const entries = [...byName.values()].toSorted((a, b) => compareUtf8(a.card.name, b.card.name));
  return ok({ entries, diagnostics });
}

/** 원본이 있는데 검토본과 내용이 다른 이름(검토본이 없는 원본 포함). 원본이 없는 항목은 빠진다 */
function changedOf(entries: readonly Entry[]): string[] {
  return entries
    .filter((entry) => entry.sourceHash !== null && entry.sourceHash !== entry.reviewedHash)
    .map((entry) => entry.card.name);
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
 * 플러그인 읽기 서비스를 만든다. 캐시는 `scan()`이 바꾼다. 캐시가 없을 때 처음 부르는 `list`·`get`이 한 번 읽는다.
 * 저장소를 읽지 못하면 그 호출이 `store` 실패를 돌려준다(기본값으로 바꾸지 않는다).
 */
export function createPluginService(deps: PluginServiceDeps): PluginService {
  let index: Index | undefined;

  async function rebuild(): Promise<Result<Index, PluginPortFailure>> {
    const next = await buildIndex(deps);
    if (!next.ok) return next;
    index = next.value;
    for (const item of next.value.diagnostics) {
      deps.log.info("plugin.scan.diagnostic", {
        code: item.code,
        dir: item.dir,
        message: item.message,
      });
    }
    return next;
  }

  async function current(): Promise<Result<Index, PluginPortFailure>> {
    if (index !== undefined) return ok(index);
    return rebuild();
  }

  async function list(
    filter: PluginListFilter,
  ): Promise<Result<PluginListResult, PluginPortFailure>> {
    const read = await current();
    if (!read.ok) return read;
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profiles", failure: listed.error });
    const plugins = read.value.entries
      .map((entry) => withUsedBy(entry.card, listed.value))
      .filter((card) => matches(card, filter));
    return ok({ plugins });
  }

  async function get(name: string): Promise<Result<PluginGetResult, PluginPortFailure>> {
    const read = await current();
    if (!read.ok) return read;
    const entry = read.value.entries.find((item) => item.card.name === name);
    if (entry === undefined) return err({ kind: "unknown_plugin", name });
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profiles", failure: listed.error });
    const versions = await deps.store.versions(name);
    if (!versions.ok) return err(storeFailure(versions.error));
    const shaped: readonly PluginVersion[] = versions.value.map((item) => ({
      hash: item.contentHash,
      approvedAt: item.approvedAt,
      current: item.current,
    }));
    return ok({
      card: withUsedBy(entry.card, listed.value),
      versions: shaped,
      source:
        entry.source === null
          ? null
          : {
              path: entry.source,
              matchesReviewed: entry.sourceHash !== null && entry.sourceHash === entry.reviewedHash,
            },
      entries: [],
      settingsDefs: [],
    });
  }

  return {
    // 원본 폴더와 레코드와 저장소를 다시 읽어 캐시를 바꾼다. 새 검토 항목은 다음 층이 만든다. 지금은 빈 목록이다
    scan: async () => {
      const next = await rebuild();
      if (!next.ok) return next;
      return ok({ queued: [] });
    },
    list,
    get,
    diagnostics: async () => {
      const read = await current();
      if (!read.ok) return read;
      return ok(read.value.diagnostics);
    },
    changedSources: async () => {
      const read = await current();
      if (!read.ok) return read;
      return ok(changedOf(read.value.entries));
    },
  };
}
