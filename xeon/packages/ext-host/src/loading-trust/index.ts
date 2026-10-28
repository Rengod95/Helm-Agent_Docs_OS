// loading-trust 도메인의 모든 export(패키지 내부용 포함). 루트(src/index.ts)는 공개 이름만 다시 내보낸다.
import { basename } from "node:path";
import { attemptAsync, Bug, parseJson } from "@xeon/contracts";
import { isSemVer, type CapabilityId, type SemVer } from "@xeon/contracts/capabilities";
import {
  validateManifest,
  validateManifestSet,
  type ExtensionManifest,
  type ExtensionName,
  type LoaderFs,
  type LoaderPaths,
  type IsolationProcessPort,
  type ManifestIssue,
  type TrustPrompter,
  type TrustStoreBackend,
} from "@xeon/contracts/extensions";
import type { SettingDef, SettingNamespace } from "@xeon/contracts/settings";
import type { AdmitInfo, OperationsPolicy } from "../operations/index.ts";
import { NO_STARTUP_OPTIONS, startupFilter, type StartupOptions } from "../operations/safe-mode.ts";
import { assignTier } from "../operations/tier.ts";
import type { ExtHost, ExtensionUnit } from "../primitives/host.ts";
import {
  candidatesFromBuiltins,
  discoverExternal,
  externalLocations,
  orderKeyOfBuiltin,
  type BuiltinExtensionModule,
  type ExtensionCandidate,
} from "./discover.ts";
import { eachInOrder } from "../primitives/sequence.ts";
import { toCapabilityIds } from "../primitives/services.ts";
import {
  importExternalEntry,
  unitOfBuiltin,
  unitOfExternal,
  verdictOfInstall,
} from "./entry-loader.ts";
import { compareLoadOrder, orderManifests, type OrderKey } from "./load-order.ts";
import type {
  LoadDiagnostic,
  LoadDiagnosticCode,
  LoadedExtensionInfo,
  LoadStage,
  LoadState,
} from "./pipeline.ts";
import { satisfiesRange } from "./semver.ts";
import { RESERVED_EXT_KEYS, reservedExtensionSettings } from "./settings-keys.ts";
import {
  effectiveTrust,
  type InstallSource,
  type LoaderMode,
  type TrustLevel,
} from "./trust/levels.ts";
import { resolveProjectTrust, type ProjectTrustResult } from "./trust/resolve.ts";
import { createProjectTrustStore } from "./trust/store.ts";
import { registerSdkModules, type SdkModules } from "./virtual-modules.ts";

export {
  BUILTIN_LAYER_ORDER,
  compareLoadOrder,
  orderManifests,
  type OrderKey,
} from "./load-order.ts";
export {
  effectiveTrust,
  INSTALL_SOURCES,
  SOURCE_TRUST,
  TRUST_LEVELS,
  TRUST_MATRIX,
  trustRank,
  type InstallSource,
  type TrustLevel,
  type TrustPermissions,
} from "./trust/levels.ts";
export {
  discoverExternal,
  externalLocations,
  type BuiltinExtensionModule,
  type ExtensionCandidate,
  type ExternalLocation,
  type LoaderFs,
  type LoaderPaths,
} from "./discover.ts";
export {
  installDefaultPlugin,
  type DefaultPluginInstallError,
  type DefaultPluginInstallInput,
  type DefaultPluginInstallOutcome,
  type PluginInstallFs,
} from "./default-plugin.ts";
export {
  registerSdkModules,
  SDK_MODULE_SPECIFIERS,
  type SdkModules,
  type SdkRegisterError,
} from "./virtual-modules.ts";
export { compareVersions } from "./semver.ts";
export {
  LoadDiagnosticSchema,
  type LoadDiagnostic,
  type LoadDiagnosticCode,
  type LoadedExtensionInfo,
  type LoadStage,
  type LoadState,
} from "./pipeline.ts";
export {
  loadingTrustSettings,
  RESERVED_EXT_KEYS,
  reservedExtensionSettings,
} from "./settings-keys.ts";
export { satisfiesRange } from "./semver.ts";
export {
  findTrustRequiringResources,
  TRUST_REQUIRING_PROJECT_RESOURCES,
} from "./trust/resources.ts";
export {
  resolveProjectTrust,
  type ProjectTrustResult,
  type ResolveProjectTrustInput,
  type TrustVia,
} from "./trust/resolve.ts";
export {
  createProjectTrustStore,
  trustOptions,
  type ProjectTrustStore,
  type TrustLookup,
  type TrustStoreError,
  type TrustVerdict,
} from "./trust/store.ts";
export { importExternalEntry, verdictOfInstall } from "./entry-loader.ts";

export type { LoaderMode } from "./trust/levels.ts";

export interface LoadOptions {
  readonly builtins: readonly BuiltinExtensionModule[];
  readonly cwd: string;
  readonly mode: LoaderMode;
  /** CLI 일회 지정. 프로젝트 신뢰 판정의 첫 단계다. 프로젝트 확장이 생기는 M2부터 쓴다 */
  readonly trustOverride?: boolean;
  /** 안전 모드와 --disable-ext(X.operations.spec §3.6). 없으면 둘 다 꺼짐 */
  readonly startup?: StartupOptions;
  /** `x.loading-trust.paths` 유효 값. 각 경로는 `extensions/`와 같은 모양의 디렉터리다(그 아래 한 단계가 확장 하나) */
  readonly extraPaths?: readonly string[];
  readonly signal: AbortSignal;
}

export interface LoadReport {
  readonly extensions: readonly LoadedExtensionInfo[];
  readonly diagnostics: readonly LoadDiagnostic[];
  /** 프로젝트 신뢰 판정. 안전 모드라 판정하지 않았으면 null */
  readonly projectTrust: ProjectTrustResult | null;
  /** 거부된 확장을 뺀 설정 그룹. 조립 루트가 buildCatalog에 넣는다 */
  readonly settingGroups: readonly {
    readonly owner: string;
    readonly namespace: SettingNamespace;
    readonly defs: readonly SettingDef[];
  }[];
}

/** 내장 필수 확장이 실패하면 loadAll이 던진다 */
export class LoadAbortError extends Error {
  override readonly name: string = "LoadAbortError";
  readonly diagnostics: readonly LoadDiagnostic[];

  constructor(message: string, diagnostics: readonly LoadDiagnostic[]) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

/** 확장 설정 유효 값 읽기. 조립 루트가 설정 서비스에 연결해 넘긴다 [제안, LoaderDeps에 선택으로 더한다] */
export interface LoaderSettingsSource {
  /** `ext.<name>.enabled`의 유효 값. 정해진 값이 없으면 undefined(매니페스트 기본값을 쓴다) */
  enabled(name: ExtensionName): boolean | undefined;
  /** 설정 키에 유효 값이 있는가. required userConfig 확인에 쓴다 */
  hasValue(key: string): boolean;
  /** `x.loading-trust.defaultProjectTrust` 유효 값. 없으면 "ask" */
  defaultProjectTrust?(): "ask" | "always" | "never";
}

/** 조립 루트가 주입하는 의존. 필수 항목이 없으면 시작 실패다(X.loading-trust.spec §4.3.2) */
export interface LoaderDeps {
  /** 설치 대상. 엔트리 호출과 scope 실행은 ExtHost.install이 한다 */
  readonly host: ExtHost;
  /** 운영 정책. 6a단계 admit, 설치 실패·제거 때 forget */
  readonly policy: Pick<OperationsPolicy, "admit" | "forget">;
  readonly fs: LoaderFs;
  readonly paths: LoaderPaths;
  readonly trustBackend: TrustStoreBackend;
  /** 대화형 프롬프트. headless면 없다 */
  readonly prompter?: TrustPrompter;
  /** 격리(2차). 없으면 격리 설정 확장은 isolation_unavailable */
  readonly process?: IsolationProcessPort;
  readonly clock: { now(): number };
  readonly settings?: LoaderSettingsSource;
  /** 코어가 제공하는 능력과 버전. 6단계가 매니페스트 provides와 함께 본다 [가정: 코어 능력 레지스트리 API는 X.primitives] */
  readonly coreCapabilities?: ReadonlyMap<CapabilityId, SemVer>;
  /**
   * 플러그인 번들이 호스트와 같은 인스턴스를 쓰게 할 SDK 가상 모듈(`@xeon/contracts`, `@xeon/group-kit`, `typebox`).
   * 지정자 → 호스트의 모듈 객체. `@xeon/group-kit`은 L3라 X가 import할 수 없어 조립 루트가 넘긴다(M3-REQ-110)
   */
  readonly sdkModules?: SdkModules;
  /** `session.trust.before` 발화(X.loading-trust.spec §4.7.3 4번). 없으면 결정 없음으로 본다 */
  readonly emitProjectTrust?: (
    cwd: string,
    signal: AbortSignal,
  ) => Promise<{ readonly trusted: "yes" | "no"; readonly remember?: boolean } | undefined>;
}

export interface ExtensionLoader {
  /** 시작 때 한 번. 파이프라인 전체를 실행한다 */
  loadAll(options: LoadOptions): Promise<LoadReport>;
  /** ext.<name>.enabled가 거짓에서 참이 되면 부른다. 아직 로드되지 않은 확장을 로드한다 */
  ensureLoaded(name: ExtensionName, signal: AbortSignal): Promise<LoadedExtensionInfo>;
  /**
   * `ext.<name>.enabled` 유효 값이 바뀌었을 때 조립 루트가 부른다 [제안]. 참이 되면 ensureLoaded 또는 scope 켜기,
   * 거짓이 되면 scope 끄기를 요청한다. 적용은 단계 경계에서 일어난다
   */
  settingChanged(
    name: ExtensionName,
    signal: AbortSignal,
  ): Promise<LoadedExtensionInfo | undefined>;
  list(): readonly LoadedExtensionInfo[];
  diagnostics(): readonly LoadDiagnostic[];
  /** 역순으로 scope를 정리하고 정책 표에서 뺀다 */
  dispose(): Promise<void>;
}

interface ExtRecord {
  name: ExtensionName;
  readonly candidate: ExtensionCandidate;
  manifest: ExtensionManifest | undefined;
  readonly source: InstallSource;
  trust: TrustLevel;
  state: LoadState;
  loadIndex: number | null;
  readonly generation: number;
  readonly essential: boolean;
  readonly diagnostics: LoadDiagnostic[];
}

function versionOf(manifest: ExtensionManifest | undefined): SemVer {
  const version = manifest?.version;
  return version !== undefined && isSemVer(version) ? version : "0.0.0";
}

function fallbackName(candidate: ExtensionCandidate, index: number): string {
  if (candidate.builtin !== null) return candidate.builtin.manifest.name;
  return candidate.root === null ? `unknown-${index}` : basename(candidate.root);
}

function projectDiagnostic(
  code: LoadDiagnosticCode,
  severity: LoadDiagnostic["severity"],
  message: string,
): LoadDiagnostic {
  return {
    extension: null,
    source: "project",
    stage: "trust",
    severity,
    code,
    message,
    generation: 0,
  };
}

function fallbackKey(name: string): OrderKey {
  return { source: "builtin", layerIndex: Number.MAX_SAFE_INTEGER, name };
}

/** 단계 검사 뒤의 현재 상태. 검사 함수가 상태를 바꿨을 수 있어 좁혀진 타입을 쓰지 않는다 */
function currentState(record: ExtRecord): ExtRecord["state"] {
  return record.state;
}

export function createExtensionLoader(deps: LoaderDeps): ExtensionLoader {
  const records = new Map<ExtensionName, ExtRecord>();
  const allDiagnostics: LoadDiagnostic[] = [];
  let order: ExtRecord[] = [];
  /** 이름이 같거나 알 수 없는 후보에 붙이는 일련번호. 묶음이 달라도 겹치지 않게 loadAll마다 0부터 센다 */
  let anonymous = 0;
  let startup: StartupOptions = NO_STARTUP_OPTIONS;
  /** "이번 세션만" 결정은 호스트 프로세스 수명 동안 유지한다(§4.7.3) */
  const sessionTrust = new Map<string, "allow" | "deny">();

  function missingDependency(): string | undefined {
    const required: readonly (readonly [string, unknown])[] = [
      ["host", deps.host],
      ["policy", deps.policy],
      ["fs", deps.fs],
      ["paths", deps.paths],
      ["trustBackend", deps.trustBackend],
      ["clock", deps.clock],
    ];
    return required.find(([, value]) => value === undefined || value === null)?.[0];
  }

  function diag(
    record: Pick<ExtRecord, "name" | "source" | "diagnostics" | "generation">,
    stage: LoadStage,
    severity: LoadDiagnostic["severity"],
    code: LoadDiagnosticCode,
    message: string,
    extra: { readonly issues?: readonly ManifestIssue[] } = {},
  ): void {
    const entry: LoadDiagnostic = {
      extension: record.name,
      source: record.source,
      stage,
      severity,
      code,
      message,
      ...(extra.issues === undefined ? {} : { issues: extra.issues }),
      generation: record.generation,
    };
    record.diagnostics.push(entry);
    allDiagnostics.push(entry);
  }

  function infoOf(record: ExtRecord): LoadedExtensionInfo {
    return {
      name: record.name,
      version: versionOf(record.manifest),
      source: record.source,
      trust: record.trust,
      state: record.state,
      isolation: record.manifest?.isolation ?? "none",
      essential: record.essential,
      loadIndex: record.loadIndex,
      generation: record.generation,
      diagnostics: [...record.diagnostics],
    };
  }

  function fail(
    record: ExtRecord,
    state: "rejected" | "disabled" | "error",
    stage: LoadStage,
    code: LoadDiagnosticCode,
    message: string,
    issues?: readonly ManifestIssue[],
  ): void {
    record.state = state;
    diag(
      record,
      stage,
      state === "disabled" ? "info" : "error",
      code,
      message,
      issues === undefined ? {} : { issues },
    );
  }

  /** 후보의 매니페스트 원본. 내장은 모듈의 상수, 외부는 `plugin.json`을 읽어 파싱한다(2단계 입력) */
  async function readManifestInput(
    candidate: ExtensionCandidate,
  ): Promise<
    | { readonly ok: true; readonly input: unknown }
    | { readonly ok: false; readonly code: LoadDiagnosticCode; readonly message: string }
  > {
    if (candidate.builtin !== null) return { ok: true, input: candidate.builtin.manifest };
    const path = candidate.manifestPath;
    if (path === null) return { ok: false, code: "manifest_missing", message: "no manifest path" };
    const read = await attemptAsync(() => deps.fs.readText(path));
    if (!read.ok) {
      return { ok: false, code: "manifest_missing", message: `cannot read ${path}` };
    }
    if (read.value === null) {
      return { ok: false, code: "manifest_missing", message: `${path} does not exist` };
    }
    const json = parseJson(read.value.startsWith("﻿") ? read.value.slice(1) : read.value);
    if (!json.ok) {
      return { ok: false, code: "manifest_parse", message: `${path} is not valid JSON` };
    }
    return { ok: true, input: json.value };
  }

  function orderKeyOfRecord(record: ExtRecord): OrderKey {
    const manifest = record.manifest;
    if (manifest === undefined) return fallbackKey(record.name);
    if (record.source === "builtin") return orderKeyOfBuiltin(manifest);
    return { source: record.source, layerIndex: 0, name: record.name };
  }

  /**
   * 1~4단계: 후보 → 검증된 매니페스트, 집합 검사, 순서, 신뢰. 한 묶음(내장·관리·사용자, 그 다음 프로젝트)씩 부르고
   * 새로 만든 기록을 돌려준다. 로드 순서 index는 앞 묶음 뒤에서 이어 매긴다
   */
  async function ingest(candidates: readonly ExtensionCandidate[]): Promise<readonly ExtRecord[]> {
    const batch: ExtRecord[] = [];
    // 같은 이름은 builtin > managed > user > project 순서로 앞의 것을 쓴다(§4.2.2). 같은 위치끼리는 입력 순서를 지킨다
    const sorted = candidates.toSorted((a, b) =>
      compareLoadOrder(
        { source: a.source, layerIndex: 0, name: "" },
        { source: b.source, layerIndex: 0, name: "" },
      ),
    );
    const raws = await Promise.all(sorted.map((candidate) => readManifestInput(candidate)));
    for (const [position, candidate] of sorted.entries()) {
      anonymous += 1;
      const raw = raws[position];
      if (raw === undefined) throw new Bug("loader.manifest_read_missing");
      const result = raw.ok ? validateManifest(raw.input) : undefined;
      const name = result?.manifest?.name ?? fallbackName(candidate, anonymous);
      const record: ExtRecord = {
        name,
        candidate,
        manifest: result?.manifest,
        source: candidate.source,
        trust: "untrusted",
        state: "discovered",
        loadIndex: null,
        generation: 0,
        essential: candidate.builtin?.essential === true,
        diagnostics: [],
      };
      const first = records.get(name);
      if (first !== undefined) {
        // 같은 이름이 두 번 들어왔다. 위치가 다르면 뒤의 것만, 같은 위치면 둘 다 거부한다
        record.name = `${name}~${anonymous}`;
        records.set(record.name, record);
        batch.push(record);
        const message = `extension name "${name}" is installed twice`;
        fail(record, "rejected", "set", "name_conflict", message);
        if (first.source === record.source && first.state !== "rejected") {
          fail(first, "rejected", "set", "name_conflict", message);
        }
        continue;
      }
      records.set(name, record);
      batch.push(record);
      if (!raw.ok) {
        fail(record, "rejected", "manifest", raw.code, raw.message);
        continue;
      }
      const warnings = (result?.issues ?? []).filter((issue) => issue.severity === "warning");
      if (result?.manifest === undefined) {
        fail(
          record,
          "rejected",
          "manifest",
          "manifest_invalid",
          `manifest of ${name} is invalid`,
          result?.issues,
        );
        continue;
      }
      if (warnings.length > 0) {
        diag(
          record,
          "manifest",
          "warning",
          "manifest_invalid",
          `manifest of ${name} has warnings`,
          { issues: warnings },
        );
      }
      record.state = "validated";
    }

    // 3단계 집합 검사: 앞 묶음에서 살아 있는 확장도 같이 보지만 거부는 이번 묶음의 확장에만 적용한다
    const valid = batch.filter((record) => record.state === "validated");
    const prior = [...records.values()].filter(
      (record) => !batch.includes(record) && record.state !== "rejected",
    );
    const setIssues = validateManifestSet(
      [...prior, ...valid].flatMap((record) =>
        record.manifest === undefined ? [] : [record.manifest],
      ),
    );
    for (const issue of setIssues) {
      const owner = valid.find((record) => issue.path.startsWith(`${record.name}/`));
      if (owner === undefined) continue;
      if (issue.severity === "error") {
        fail(owner, "rejected", "set", "name_conflict", issue.message, [issue]);
      } else {
        diag(owner, "set", "warning", "manifest_invalid", issue.message, { issues: [issue] });
      }
    }

    // 로드 순서: 입력 순서와 무관하다
    const ordered = orderManifests(
      batch
        .filter((record) => record.state === "validated" && record.manifest !== undefined)
        .map((record) => ({ record, key: orderKeyOfRecord(record) })),
    );
    const base = order.length;
    ordered.forEach((item, index) => {
      item.record.loadIndex = base + index;
    });
    const added = ordered.map((item) => item.record);
    order = [...order, ...added];

    // 4단계 신뢰: 설치 위치 상한과 요청 등급의 낮은 쪽
    for (const record of added) {
      const requested = record.manifest?.trust?.level;
      const effective = effectiveTrust(record.source, requested);
      if (!effective.ok) {
        fail(
          record,
          "rejected",
          "trust",
          "trust_exceeds_source",
          `${record.name} requests trust "${requested ?? "?"}" which source "${record.source}" cannot give`,
        );
        continue;
      }
      record.trust = effective.level;
      record.state = "trusted";
    }
    return batch;
  }

  /** 5단계: userConfig 검증. 예약 키 충돌과 다른 네임스페이스 침범은 거부한다 */
  function checkSettings(record: ExtRecord): void {
    const manifest = record.manifest;
    if (manifest === undefined) return;
    const prefix = `ext.${manifest.name}.`;
    for (const [key, entry] of Object.entries(manifest.userConfig ?? {})) {
      const rest = entry.setting.startsWith(prefix)
        ? entry.setting.slice(prefix.length)
        : undefined;
      if (rest === undefined) {
        fail(
          record,
          "rejected",
          "settings",
          "settings_rejected",
          `userConfig "${key}" points at ${entry.setting}, outside ${prefix}*`,
        );
        return;
      }
      if (RESERVED_EXT_KEYS.some((reserved) => reserved === rest)) {
        fail(
          record,
          "rejected",
          "settings",
          "settings_reserved_key",
          `userConfig "${key}" uses the reserved name "${rest}"`,
        );
        return;
      }
    }
    record.state = "resolved";
  }

  function enabledSettingOf(record: ExtRecord): boolean | undefined {
    return deps.settings?.enabled(record.name);
  }

  /** 안전 모드와 `--disable-ext`로 이번 시작에서 빠지는가(X.operations.spec §4.6). 빠지면 사유를 돌려준다 */
  function startupSkipOf(record: ExtRecord): "safe_mode" | "disabled_flag" | undefined {
    const manifest = record.manifest;
    if (manifest === undefined) return undefined;
    const tier = assignTier({
      name: record.name,
      source: record.source,
      trust: record.trust,
      layer: manifest.layer,
    });
    if (!tier.ok) return undefined;
    const filtered = startupFilter(
      [{ name: record.name, tier: tier.value, layer: manifest.layer }],
      startup,
    );
    return filtered.skipped[0]?.reason;
  }

  /** 5a단계: 안전 모드와 시작 때 끄기, 켜짐 확인, 필수 userConfig */
  function checkEnabled(record: ExtRecord): boolean {
    const manifest = record.manifest;
    if (manifest === undefined) return false;
    const skipped = startupSkipOf(record);
    if (skipped !== undefined) {
      fail(
        record,
        "disabled",
        "settings",
        skipped,
        skipped === "safe_mode"
          ? `${record.name} is not loaded in safe mode`
          : `${record.name} is disabled by --disable-ext`,
      );
      return false;
    }
    const enabled = enabledSettingOf(record) ?? manifest.defaultEnabled ?? true;
    if (!enabled) {
      fail(
        record,
        "disabled",
        "settings",
        "disabled_by_setting",
        `ext.${record.name}.enabled is false`,
      );
      return false;
    }
    for (const [key, entry] of Object.entries(manifest.userConfig ?? {})) {
      if (entry.required === true && deps.settings?.hasValue(entry.setting) !== true) {
        fail(
          record,
          "disabled",
          "settings",
          "config_required",
          `required userConfig "${key}" (${entry.setting}) has no value`,
        );
        return false;
      }
    }
    return true;
  }

  /** 능력 요구 충족: 같은 집합에서 살아 있는 확장의 provides 또는 코어 능력(X.loading-trust.spec §4.8) */
  function checkCapabilities(alive: ExtRecord[]): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of alive.filter((candidate) => candidate.state === "resolved")) {
        const manifest = record.manifest;
        if (manifest === undefined) continue;
        for (const requirement of manifest.requires ?? []) {
          const provided = alive.some(
            (other) =>
              other !== record &&
              (other.state === "resolved" || other.state === "active") &&
              (other.manifest?.provides ?? []).some(
                (provision) =>
                  provision.id === requirement.id &&
                  satisfiesRange(provision.version, requirement.range),
              ),
          );
          const core = [...(deps.coreCapabilities ?? [])].some(
            ([id, version]) => id === requirement.id && satisfiesRange(version, requirement.range),
          );
          if (!provided && !core) {
            fail(
              record,
              "error",
              "capabilities",
              "capability_missing",
              `${record.name} requires ${requirement.id} ${requirement.range}, which nothing provides`,
            );
            changed = true;
            break;
          }
        }
      }
    }
  }

  /** 요구한 능력을 공급하기로 한 확장이 모두 활성화되지 못했으면 그 능력 id를 돌려준다 */
  function deadProvider(record: ExtRecord): CapabilityId | undefined {
    for (const requirement of record.manifest?.requires ?? []) {
      const potential = order.some(
        (other) =>
          other !== record &&
          (other.state === "resolved" || other.state === "loading" || other.state === "active") &&
          (other.manifest?.provides ?? []).some((provision) => provision.id === requirement.id),
      );
      const core = [...(deps.coreCapabilities ?? [])].some(([id]) => id === requirement.id);
      if (!potential && !core) return toCapabilityIds([requirement.id])[0];
    }
    return undefined;
  }

  /** 외부 확장의 엔트리를 import해 설치 단위로 만든다. 실패하면 진단을 남기고 undefined */
  async function unitOfRecord(
    record: ExtRecord,
    manifest: ExtensionManifest,
    loadIndex: number,
  ): Promise<ExtensionUnit | undefined> {
    const module = record.candidate.builtin;
    const initialEnabled = enabledSettingOf(record);
    if (module !== null) return unitOfBuiltin(module, manifest, loadIndex, initialEnabled);
    const root = record.candidate.root;
    if (root === null) return undefined;
    if (deps.sdkModules !== undefined) {
      const registered = registerSdkModules(deps.sdkModules);
      if (!registered.ok) {
        fail(
          record,
          "error",
          "entry",
          "entry_import_failed",
          registered.error.kind === "conflict"
            ? `SDK module ${registered.error.specifier} is already registered with another instance`
            : "SDK virtual modules need the Bun runtime",
        );
        return undefined;
      }
    }
    const loaded = await importExternalEntry(deps.fs, root, manifest);
    if (!loaded.ok) {
      fail(record, "error", "entry", loaded.error.code, loaded.error.message);
      return undefined;
    }
    return unitOfExternal(loaded.value, manifest, loadIndex, initialEnabled);
  }

  /** 6a~9단계 가운데 설치: admit → (외부는 엔트리 import) → install → InstallResult 변환 */
  async function install(record: ExtRecord, signal: AbortSignal): Promise<void> {
    const manifest = record.manifest;
    if (manifest === undefined || record.loadIndex === null) return;
    const dead = deadProvider(record);
    if (dead !== undefined) {
      fail(
        record,
        "error",
        "activate",
        "capability_provider_failed",
        `${record.name} needs ${dead}, whose provider failed to load`,
      );
      return;
    }
    record.state = "loading";
    const info: AdmitInfo = {
      name: record.name,
      source: record.source,
      trust: record.trust,
      essential: record.essential,
    };
    const admitted = deps.policy.admit(info, manifest.layer);
    if (!admitted.ok) {
      fail(
        record,
        "error",
        "admit",
        "tier_rejected",
        `tier assignment failed: ${admitted.error.kind}`,
      );
      return;
    }
    const unit = await unitOfRecord(record, manifest, record.loadIndex);
    if (unit === undefined) {
      deps.policy.forget(record.name);
      return;
    }
    try {
      const result = await deps.host.install(unit, { signal });
      const verdict = verdictOfInstall(result);
      for (const entry of verdict.diagnostics) {
        diag(
          record,
          entry.code === "usage_invalid" || entry.code === "usage_warning" ? "usage" : "entry",
          entry.severity,
          entry.code,
          entry.message,
          entry.issues === undefined ? {} : { issues: entry.issues },
        );
      }
      if (!verdict.ok) {
        record.state = "error";
        await deps.host.uninstall(record.name);
        deps.policy.forget(record.name);
        return;
      }
      record.state = "active";
    } catch (error) {
      fail(
        record,
        "error",
        "entry",
        "setup_threw",
        `install of ${record.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await deps.host.uninstall(record.name);
      deps.policy.forget(record.name);
    }
  }

  /** 9단계 뒤: 능력을 공급하기로 한 확장이 활성화되지 못했으면 그 능력을 요구한 확장도 내린다 */
  async function cascadeProviderFailures(): Promise<void> {
    const orphan = order
      .filter((candidate) => candidate.state === "active")
      .find((record) =>
        (record.manifest?.requires ?? []).some(
          (requirement) => !hasProvider(record, requirement.id),
        ),
      );
    if (orphan === undefined) return;
    const lost = (orphan.manifest?.requires ?? []).find(
      (requirement) => !hasProvider(orphan, requirement.id),
    );
    fail(
      orphan,
      "error",
      "activate",
      "capability_provider_failed",
      `${orphan.name} lost its provider of ${lost?.id ?? "?"}`,
    );
    await deps.host.uninstall(orphan.name);
    deps.policy.forget(orphan.name);
    await cascadeProviderFailures();
  }

  function hasProvider(record: ExtRecord, id: string): boolean {
    const provider = order.some(
      (other) =>
        other !== record &&
        other.state === "active" &&
        (other.manifest?.provides ?? []).some((provision) => provision.id === id),
    );
    return provider || [...(deps.coreCapabilities ?? [])].some(([coreId]) => coreId === id);
  }

  /**
   * 취소 신호는 단계 경계와 확장 하나를 설치하기 직전에 확인하고(TY-22) `ExtHost.install`에도 넘긴다. 설치 중 취소되면
   * 엔트리 실행을 기다리지 않고 `entryError`(`scope_setup_failed`)로 끝나 그 확장이 `entry_threw`가 된다.
   * 단계 경계에서 취소되면 시작을 거부하는 것과 같은 LoadAbortError를 던진다
   */
  function throwIfCancelled(signal: AbortSignal, before: string): void {
    if (!signal.aborted) return;
    throw new LoadAbortError(`extension loading was cancelled before ${before}`, [
      ...allDiagnostics,
    ]);
  }

  function assertNotEssentialFailure(record: ExtRecord): void {
    if (!record.essential) return;
    if (record.state === "rejected" || record.state === "disabled" || record.state === "error") {
      diag(
        record,
        "activate",
        "error",
        "essential_failed",
        `essential extension ${record.name} is ${record.state}`,
      );
      throw new LoadAbortError(`essential extension ${record.name} failed to load`, [
        ...allDiagnostics,
      ]);
    }
  }

  function settingGroupsOf(): LoadReport["settingGroups"] {
    return order
      .filter((record) => record.state !== "rejected" && record.manifest !== undefined)
      .flatMap((record) => {
        if (record.manifest === undefined) return [];
        const group = reservedExtensionSettings(record.manifest, record.source);
        return [{ owner: record.name, namespace: group.namespace, defs: group.defs }];
      });
  }

  async function ensureLoaded(
    name: ExtensionName,
    signal: AbortSignal,
  ): Promise<LoadedExtensionInfo> {
    const record = records.get(name);
    if (record === undefined) throw new Bug(`loader.unknown_extension: ${name}`);
    if (record.state !== "disabled") return infoOf(record);
    throwIfCancelled(signal, `loading ${name}`);
    record.state = "resolved";
    if (checkEnabled(record)) {
      checkCapabilities(
        order.filter((candidate) => candidate.state === "resolved" || candidate.state === "active"),
      );
      if (currentState(record) === "resolved") await install(record, signal);
    }
    assertNotEssentialFailure(record);
    return infoOf(record);
  }

  function listAll(): readonly LoadedExtensionInfo[] {
    return [...records.values()]
      .toSorted(
        (a, b) =>
          (a.loadIndex ?? Number.MAX_SAFE_INTEGER) - (b.loadIndex ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      )
      .map(infoOf);
  }

  /** 한 묶음의 1~9단계. 묶음 안에서 순서대로 설치하고 마지막에 능력 연쇄 실패를 정리한다 */
  async function processBatch(
    candidates: readonly ExtensionCandidate[],
    signal: AbortSignal,
  ): Promise<void> {
    throwIfCancelled(signal, "validation");
    const batch = await ingest(candidates);
    // 거부된 확장도 필수 확장이면 시작 실패다
    for (const record of batch) assertNotEssentialFailure(record);

    throwIfCancelled(signal, "settings");
    for (const record of batch) if (record.state === "trusted") checkSettings(record);
    for (const record of batch) assertNotEssentialFailure(record);

    throwIfCancelled(signal, "enable check");
    const alive: ExtRecord[] = [];
    for (const record of batch) {
      if (record.state === "resolved" && checkEnabled(record)) alive.push(record);
      assertNotEssentialFailure(record);
    }
    checkCapabilities(
      order.filter((record) => record.state === "resolved" || record.state === "active"),
    );
    for (const record of alive) assertNotEssentialFailure(record);

    await eachInOrder(
      order.filter((record) => alive.includes(record)),
      async (record) => {
        if (record.state !== "resolved") return "continue";
        throwIfCancelled(signal, `installing ${record.name}`);
        await install(record, signal);
        assertNotEssentialFailure(record);
        return "continue";
      },
    );
    throwIfCancelled(signal, "provider cascade");
    await cascadeProviderFailures();
  }

  /** 프로젝트 신뢰를 정하고 거부·미결정이면 진단을 남긴다. 판정 자체가 실패하면 불신으로 둔다 */
  async function resolveProject(options: LoadOptions): Promise<ProjectTrustResult | null> {
    const store = createProjectTrustStore(
      deps.trustBackend,
      (path) => deps.fs.realpath(path),
      deps.clock,
    );
    const decided = await attemptAsync(() =>
      resolveProjectTrust({
        projectRoot: options.cwd,
        mode: options.mode,
        ...(options.trustOverride === undefined ? {} : { trustOverride: options.trustOverride }),
        defaultProjectTrust: deps.settings?.defaultProjectTrust?.() ?? "ask",
        store,
        fs: deps.fs,
        homeDir: deps.paths.homeDir,
        ...(deps.prompter === undefined ? {} : { prompter: deps.prompter }),
        emitProjectTrust: deps.emitProjectTrust ?? (() => Promise.resolve(undefined)),
        sessionMemory: sessionTrust,
        signal: options.signal,
      }),
    );
    if (!decided.ok) {
      allDiagnostics.push(
        projectDiagnostic("trust_undecided", "error", "project trust could not be decided"),
      );
      return null;
    }
    const result = decided.value;
    if (result.storeError !== undefined) {
      allDiagnostics.push(
        projectDiagnostic(
          "trust_store_corrupt",
          "error",
          `trust store is ${result.storeError.kind}`,
        ),
      );
    }
    if (!result.trusted && result.resources.length > 0) {
      allDiagnostics.push(
        projectDiagnostic(
          result.verdict === "deny" ? "trust_denied" : "trust_undecided",
          "warning",
          `project ${result.projectRoot} is not trusted (${result.via}); its extensions are not loaded`,
        ),
      );
    }
    return result;
  }

  return {
    async loadAll(options) {
      const missing = missingDependency();
      if (missing !== undefined) throw new Bug(`loader.missing_dependency: ${missing}`);
      throwIfCancelled(options.signal, "validation");
      records.clear();
      allDiagnostics.length = 0;
      order = [];
      anonymous = 0;
      startup = options.startup ?? NO_STARTUP_OPTIONS;
      const safeMode = startup.safeMode.active;
      const extraPaths = options.extraPaths ?? [];

      // 1. 내장, 관리, 사용자 확장. 프로젝트 위치는 신뢰 판정 뒤에만 탐색한다(§4.7.4)
      const external = await discoverExternal(
        deps.fs,
        externalLocations({
          paths: deps.paths,
          extraPaths,
          projectRoot: null,
          sources: ["managed", "user"],
        }),
      );
      allDiagnostics.push(...external.diagnostics);
      await processBatch(
        [...candidatesFromBuiltins(options.builtins), ...external.candidates],
        options.signal,
      );

      // 2. 프로젝트 신뢰와 프로젝트 확장. 안전 모드에서는 프로젝트 확장을 싣지 않으므로 판정(프롬프트)도 하지 않는다
      let projectTrust: ProjectTrustResult | null = null;
      if (safeMode) {
        allDiagnostics.push(
          projectDiagnostic(
            "safe_mode",
            "info",
            "project extensions are not discovered in safe mode",
          ),
        );
      } else {
        throwIfCancelled(options.signal, "project trust");
        projectTrust = await resolveProject(options);
        if (projectTrust?.trusted === true) {
          const project = await discoverExternal(
            deps.fs,
            externalLocations({
              paths: deps.paths,
              extraPaths: [],
              projectRoot: projectTrust.projectRoot,
              sources: ["project"],
            }),
          );
          allDiagnostics.push(...project.diagnostics);
          await processBatch(project.candidates, options.signal);
        }
      }
      for (const record of order) assertNotEssentialFailure(record);
      return {
        extensions: listAll(),
        diagnostics: [...allDiagnostics],
        projectTrust,
        settingGroups: settingGroupsOf(),
      };
    },
    ensureLoaded,
    async settingChanged(name, signal) {
      const record = records.get(name);
      if (record === undefined) return undefined;
      throwIfCancelled(signal, `applying the setting of ${name}`);
      const enabled = enabledSettingOf(record) ?? record.manifest?.defaultEnabled ?? true;
      if (record.state === "disabled" && enabled) return ensureLoaded(name, signal);
      if (record.state === "active") {
        for (const info of deps.host.scopes().filter((scope) => scope.extension === name)) {
          const handle = deps.host.scope(info.id);
          if (enabled) handle?.enable();
          else handle?.disable();
        }
      }
      return infoOf(record);
    },
    list: listAll,
    diagnostics: () => [...allDiagnostics],
    async dispose() {
      await eachInOrder([...order].toReversed(), async (record) => {
        if (record.state !== "active") return "continue";
        await deps.host.uninstall(record.name);
        deps.policy.forget(record.name);
        record.state = "disabled";
        return "continue";
      });
    },
  };
}
