import { readdir } from "node:fs/promises";
import { basename } from "node:path";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { PluginCard, PluginOriginKind } from "@fresnel/contracts/extensions";
import type {
  InvocableEntry,
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
import { addsToolsOf, invocablesOf } from "./invocables.ts";
import { buildPluginCard, type CardSubject } from "./card.ts";
import { discoverPluginFolders, type DiscoverProjectRoot } from "./discover.ts";
import {
  readPluginFolder,
  type FolderDiagnostic,
  type FolderRejection,
  type PluginFolder,
  type PluginMaterials,
} from "./folder-reader.ts";
import type { OverlayTarget } from "./overlay.ts";
import { reviewKeyOf } from "./review-key.ts";
import type { PluginStore, PluginStoreError, PluginVersionInfo, ReviewedVersion } from "./store.ts";

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
  "names" | "current" | "versions" | "verifyIntegrity" | "treePath"
>;

export interface PluginServiceDeps {
  /** 사용자 설정 폴더(`env.configDir`). 아래 `plugins/`와 기존 `extensions/`를 본다 */
  readonly configDir: string;
  /**
   * 프로젝트 루트 목록(M5c §4.5.2). 조립이 등록된 프로젝트의 루트와 닫히지 않은 대화의 작업 폴더를 준다(프로젝트 id와 함께).
   * 그 폴더의 `.fresnel/plugins`와 `.fresnel/extensions`가 동반 플러그인 후보다. 읽기는 정적이다(코드는 돌지 않는다)
   */
  readonly projectRoots: () => Promise<readonly DiscoverProjectRoot[]>;
  /** 관리 폴더. 조립에 아직 없으면 null */
  readonly managedDir: string | null;
  /** 기본 제공 번들 폴더(`defaultPluginsDir()`). 없으면 null */
  readonly bundleDir: string | null;
  /** 로드된 확장 목록(내장 포함) */
  readonly records: () => readonly PluginRecordSource[];
  /**
   * 느슨한 사용자 스킬 루트(`<OsDirs.data>/skills`). 그 안의 폴더 이름은 "원본이 아직 있다"는 뜻으로만 쓴다: 옮긴 스킬의 원본이
   * 사라졌다고 보고 제거 항목을 만들지 않게 한다. 이 폴더로는 검토 항목을 만들지 않는다(옮김이 맡는다, M5c §7.5)
   */
  readonly looseSkillsDir?: string;
  /** 프로필 목록. `usedBy` 계산에 쓴다. 읽지 못하면 그 실패를 호출자에게 준다 */
  readonly profiles: Pick<ProfileTestRunPort, "list">;
  /** 검토본 저장소. 검토 칸, 무결성, 보관 목록을 여기서 읽는다 */
  readonly store: PluginStoreReader;
  /** 진단을 남기는 로그 */
  readonly log: { info(message: string, fields: Readonly<Record<string, unknown>>): void };
}

export interface PluginService extends Pick<PluginPort, "list" | "get" | "scan"> {
  /** 호출할 수 있는 항목 전부(검토된 플러그인의 스킬, 명령, Drive 시작, 플러그인 전체). 대화와 무관하게 같다 */
  invocables(): Promise<Result<{ readonly entries: readonly InvocableEntry[] }, PluginPortFailure>>;
  /**
   * 덧씌우기 대상 하나(M5c §4.3.1). 없는 이름이면 undefined다. 검토본이 있으면 항목은 검토본 폴더에서 온다.
   * 검토본이 없으면 항목이 없고 `reviewedHash`가 null이다
   */
  overlayTarget(name: string): Promise<Result<OverlayTarget | undefined, PluginPortFailure>>;
  /** 마지막 훑기에서 나온 진단. `plugin.list`의 결과에는 넣을 자리가 없어 이 함수로만 본다(§3.4) */
  diagnostics(): Promise<Result<readonly PluginDiagnostic[], PluginPortFailure>>;
  /** 원본 폴더가 검토본과 다른 이름들(검토본이 없는 원본 포함). 다음 층이 검토 항목을 만들 때 쓴다 */
  changedSources(): Promise<Result<readonly string[], PluginPortFailure>>;
  /** 검토 항목을 만들 재료: 원본이 읽히는 플러그인과 발견된 폴더 이름(M5c §4.7.1). 캐시를 읽는다 */
  sources(): Promise<Result<PluginSources, PluginPortFailure>>;
}

/** 원본 폴더가 읽히는 플러그인 하나(검토 항목을 만드는 재료). 내장과 번들은 아래 `origin`으로 가린다 */
export interface PluginSourceEntry {
  readonly name: string;
  /** 원본 폴더 경로 */
  readonly dir: string;
  readonly origin: PluginOriginKind;
  /** 원본 폴더의 현재 내용 해시 */
  readonly sourceHash: string;
  /** 현재 검토본의 해시. 검토본이 없으면 null */
  readonly reviewedHash: string | null;
  /** 이 원본의 검토본 키(사용자·번들은 이름, 프로젝트는 `<projectId>/<이름>`). 검토본을 두지 않는 출처와 프로젝트 id가 없으면 null */
  readonly reviewKey: string | null;
  /** 프로젝트 출처 원본의 프로젝트 id. 다른 출처는 null이다 */
  readonly projectId: string | null;
}

/** 원본 폴더의 훑기 결과. `discoveredNames`는 읽지 못한 폴더도 든 폴더 이름이다(원본이 사라졌는지 가린다) */
export interface PluginSources {
  readonly entries: readonly PluginSourceEntry[];
  readonly discoveredNames: readonly string[];
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
  /** 검토본 키. 원본과 검토본이 같은 키일 때만 한 항목으로 합친다(같은 이름이라도 다른 프로젝트의 검토본은 합치지 않는다) */
  readonly reviewKey: string | null;
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
  /** 발견된 사용자·프로젝트 폴더의 이름(폴더 이름). 읽지 못한 폴더도 든다 */
  readonly discoveredNames: readonly string[];
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

/** 느슨한 스킬 루트의 폴더 이름. 없거나 읽지 못하면 빈 목록이다(진단은 옮김이 남긴다) */
async function looseSkillFolderNames(dir: string | undefined): Promise<readonly string[]> {
  if (dir === undefined) return [];
  const listed = await attemptAsync(() => readdir(dir, { withFileTypes: true }));
  if (!listed.ok) return [];
  return listed.value
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

/** 카드의 출처. 프로젝트 id가 있으면 함께 적는다 */
function originOfCandidate(kind: PluginOriginKind, projectId: string | null): PluginCard["origin"] {
  return projectId === null ? { kind } : { kind, projectId };
}

/**
 * 원본 폴더 하나의 검토본 키. 사용자·번들은 이름이고 프로젝트는 `<projectId>/<이름>`이다.
 * 검토본을 두지 않는 출처(내장, 관리)와 프로젝트 id가 없는 프로젝트 폴더는 null이다
 */
function reviewKeyOfOrigin(
  kind: PluginOriginKind,
  name: string,
  projectId: string | null,
): string | null {
  if (kind !== "user" && kind !== "project" && kind !== "bundled") return null;
  const key = reviewKeyOf({ origin: kind, name, projectId });
  return key.ok ? key.value : null;
}

/** 사용자·번들 키(이름)를 프로젝트 키보다 앞에 둔다. 같은 이름이면 앞의 것이 쥔다(로더의 규칙과 같다) */
function userFirst(a: string, b: string): number {
  const aProject = a.includes("/");
  if (aProject !== b.includes("/")) return aProject ? 1 : -1;
  return compareUtf8(a, b);
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
        reviewKey: null,
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
    projectRoots: await deps.projectRoots(),
    managedDir: deps.managedDir,
    bundleDir: deps.bundleDir,
  });
  for (const item of found.diagnostics) {
    diagnostics.push({ code: item.code, dir: item.dir, message: item.message });
  }
  const discoveredNames = [
    ...found.candidates
      .filter((candidate) => candidate.origin !== "bundled")
      .map((candidate) => basename(candidate.dir)),
    ...(await looseSkillFolderNames(deps.looseSkillsDir)),
  ];
  for (const candidate of found.candidates) {
    // 옛 위치(`<config>/extensions`)는 한 릴리스 동안 읽는다(M5c §7.4). 카드의 `origin`은 닫힌 값이라 진단과 로그로만 남긴다
    if (candidate.legacy) {
      diagnostics.push({
        code: "legacy_location",
        dir: candidate.dir,
        message: "read from the legacy location; the startup move copies it to the reviewed store",
      });
    }
    // 프로젝트 id가 없는 프로젝트 폴더는 검토본 키를 만들 수 없어 검토하지 않는다(진단으로만 남긴다)
    if (candidate.origin === "project" && candidate.projectId === null) {
      diagnostics.push({
        code: "project_no_id",
        dir: candidate.dir,
        message: "the project root has no project id; its plugin is not reviewed",
      });
    }
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
          origin: originOfCandidate(candidate.origin, candidate.projectId),
          review: NO_REVIEW,
          usedBy: [],
          health: IDLE_HEALTH,
        }),
        reviewKey: reviewKeyOfOrigin(candidate.origin, read.value.name, candidate.projectId),
        source: candidate.dir,
        sourceHash: read.value.contentHash,
        reviewedHash: null,
      },
      candidate.dir,
    );
  }

  // 검토본 저장소: 키마다 현재 검토본과 무결성을 읽는다. 원본 폴더와 키가 같은 검토본은 그 원본의 검토 칸과 무결성을 덮고,
  // 없으면 검토본 메타의 카드로 항목을 만든다. 사용자·번들 키를 프로젝트 키보다 먼저 본다
  const keys = await deps.store.names();
  if (!keys.ok) return err(storeFailure(keys.error));
  // 키마다 현재 검토본과 무결성을 읽는다. 서로 독립이라 함께 읽는다
  const loaded = await Promise.all(
    keys.value.toSorted(userFirst).map(async (key) => {
      const current = await deps.store.current(key);
      if (!current.ok || current.value === null) return { key, current, integrity: null };
      const integrity = await deps.store.verifyIntegrity(key, current.value.contentHash);
      return { key, current, integrity };
    }),
  );
  for (const item of loaded) {
    const key = item.key;
    if (!item.current.ok) return err(storeFailure(item.current.error));
    const version = item.current.value;
    if (version === null || item.integrity === null) continue;
    // 카드의 이름은 메타의 이름이다. 키의 프로젝트 부분은 메타의 카드가 가진다
    const name = version.meta.name;
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
        dir: `reviewed/${key}`,
        message: `the reviewed copy of ${key} no longer matches its recorded hash`,
      });
    }
    const existing = byName.get(name);
    if (existing !== undefined && existing.card.origin.kind === "builtin") {
      diagnostics.push({
        code: "name_conflict",
        dir: `reviewed/${key}`,
        message: `plugin name "${name}" is already claimed`,
      });
      continue;
    }
    if (existing !== undefined && existing.reviewKey === key) {
      byName.set(name, {
        ...existing,
        card: { ...existing.card, review: approvedReview(version), health },
        reviewedHash: version.contentHash,
      });
      continue;
    }
    // 원본이 없거나 같은 이름의 다른 키(다른 프로젝트의 검토본)면 이 검토본은 따로 항목이 된다. 이름이 겹치면 `name_conflict`다
    claimInto(
      byName,
      diagnostics,
      {
        card: { ...version.meta.card, review: approvedReview(version), health, usedBy: [] },
        reviewKey: key,
        source: null,
        sourceHash: null,
        reviewedHash: version.contentHash,
      },
      `reviewed/${key}`,
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
        reviewKey: null,
        source: null,
        sourceHash: null,
        reviewedHash: null,
      },
      record.location,
    );
  }

  const entries = [...byName.values()].toSorted((a, b) => compareUtf8(a.card.name, b.card.name));
  return ok({ entries, diagnostics, discoveredNames });
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
  /** 검토본 폴더를 읽은 결과. 검토본은 내용 주소라 `이름 + 해시`가 키다(고정 복사본이라 다시 읽지 않는다) */
  const reviewedReads = new Map<string, Result<PluginFolder, FolderRejection>>();

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

  /**
   * 검토본 폴더를 읽는다. 읽지 못하면 null이다(항목은 스킬과 명령을 뺀 것만 남는다). 기록만 남기고 계속한다:
   * 검토본은 적재 때 이미 검사를 거쳤고, 여기서 막으면 목록 전체가 빈다
   */
  async function reviewedFolderOf(
    reviewKey: string,
    reviewedHash: string,
    origin: PluginCard["origin"]["kind"],
  ): Promise<Result<PluginFolder | null, PluginPortFailure>> {
    const cacheKey = `${reviewKey}\0${reviewedHash}`;
    let outcome = reviewedReads.get(cacheKey);
    if (outcome === undefined) {
      const tree = await deps.store.treePath(reviewKey);
      if (!tree.ok) return err(storeFailure(tree.error));
      outcome = readPluginFolder(tree.value, { origin });
      reviewedReads.set(cacheKey, outcome);
    }
    if (!outcome.ok) {
      deps.log.info("plugin.invocables.unreadable", { key: reviewKey, kind: outcome.error.kind });
      return ok(null);
    }
    return ok(outcome.value);
  }

  /** 검토된 플러그인 하나의 호출 항목(M5c §3.4). 검토본이 없으면 빈 목록이다 */
  async function entriesOf(
    entry: Entry,
  ): Promise<Result<readonly InvocableEntry[], PluginPortFailure>> {
    const reviewedHash = entry.reviewedHash;
    const reviewKey = entry.reviewKey;
    if (reviewedHash === null || reviewKey === null) return ok([]);
    const folder = await reviewedFolderOf(reviewKey, reviewedHash, entry.card.origin.kind);
    if (!folder.ok) return folder;
    return ok(
      invocablesOf({
        plugin: entry.card.name,
        reviewedHash,
        card: entry.card,
        folder: folder.value,
      }),
    );
  }

  async function invocables(): Promise<
    Result<{ readonly entries: readonly InvocableEntry[] }, PluginPortFailure>
  > {
    const read = await current();
    if (!read.ok) return read;
    const reviewed = read.value.entries.filter((entry) => entry.reviewedHash !== null);
    const lists = await Promise.all(reviewed.map((entry) => entriesOf(entry)));
    const entries: InvocableEntry[] = [];
    for (const item of lists) {
      if (!item.ok) return item;
      entries.push(...item.value);
    }
    return ok({ entries });
  }

  async function overlayTarget(
    name: string,
  ): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> {
    const read = await current();
    if (!read.ok) return read;
    const entry = read.value.entries.find((item) => item.card.name === name);
    if (entry === undefined) return ok(undefined);
    const addsTools = addsToolsOf(entry.card);
    if (entry.reviewedHash === null) {
      return ok({
        name,
        reviewedHash: null,
        entries: [],
        addsTools,
        origin: entry.card.origin.kind,
      });
    }
    const listed = await entriesOf(entry);
    if (!listed.ok) return listed;
    return ok({
      name,
      reviewedHash: entry.reviewedHash,
      entries: listed.value.map((item) => ({ entry: item.entry, kind: item.kind })),
      addsTools,
      origin: entry.card.origin.kind,
    });
  }

  async function get(name: string): Promise<Result<PluginGetResult, PluginPortFailure>> {
    const read = await current();
    if (!read.ok) return read;
    const entry = read.value.entries.find((item) => item.card.name === name);
    if (entry === undefined) return err({ kind: "unknown_plugin", name });
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profiles", failure: listed.error });
    const entries = await entriesOf(entry);
    if (!entries.ok) return entries;
    // 검토본을 두지 않는 항목(키가 없다)은 보관 목록이 빈 것이다
    let listedVersions: readonly PluginVersionInfo[] = [];
    if (entry.reviewKey !== null) {
      const versions = await deps.store.versions(entry.reviewKey);
      if (!versions.ok) return err(storeFailure(versions.error));
      listedVersions = versions.value;
    }
    const shaped: readonly PluginVersion[] = listedVersions.map((item) => ({
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
      entries: [...entries.value],
      settingsDefs: [],
    });
  }

  return {
    invocables,
    overlayTarget,
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
    sources: async () => {
      const read = await current();
      if (!read.ok) return read;
      const entries: PluginSourceEntry[] = [];
      for (const entry of read.value.entries) {
        if (entry.source === null || entry.sourceHash === null) continue;
        entries.push({
          name: entry.card.name,
          dir: entry.source,
          origin: entry.card.origin.kind,
          sourceHash: entry.sourceHash,
          reviewedHash: entry.reviewedHash,
          reviewKey: entry.reviewKey,
          projectId: entry.card.origin.projectId ?? null,
        });
      }
      return ok({ entries, discoveredNames: read.value.discoveredNames });
    },
  };
}
