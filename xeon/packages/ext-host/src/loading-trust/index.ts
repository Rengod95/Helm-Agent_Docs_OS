// loading-trust 도메인의 모든 export(패키지 내부용 포함). 루트(src/index.ts)는 공개 이름만 다시 내보낸다.
import { Bug } from "@xeon/contracts";
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
import type { ExtHost } from "../primitives/host.ts";
import {
  candidatesFromBuiltins,
  orderKeyOfBuiltin,
  type BuiltinExtensionModule,
  type ExtensionCandidate,
} from "./discover.ts";
import { eachInOrder } from "../primitives/sequence.ts";
import { toCapabilityIds } from "../primitives/services.ts";
import { unitOfBuiltin, verdictOfInstall } from "./entry-loader.ts";
import { orderManifests, type OrderKey } from "./load-order.ts";
import type {
  LoadDiagnostic,
  LoadDiagnosticCode,
  LoadedExtensionInfo,
  LoadStage,
  LoadState,
} from "./pipeline.ts";
import { satisfiesRange } from "./semver.ts";
import { RESERVED_EXT_KEYS, reservedExtensionSettings } from "./settings-keys.ts";
import { effectiveTrust, type InstallSource, type TrustLevel } from "./trust/levels.ts";

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
export { type BuiltinExtensionModule, type LoaderFs, type LoaderPaths } from "./discover.ts";
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
export { verdictOfInstall } from "./entry-loader.ts";

export type LoaderMode = "interactive" | "headless";

export interface LoadOptions {
  readonly builtins: readonly BuiltinExtensionModule[];
  readonly cwd: string;
  readonly mode: LoaderMode;
  /** CLI 일회 지정. 프로젝트 신뢰 판정의 첫 단계다. 프로젝트 확장이 생기는 M2부터 쓴다 */
  readonly trustOverride?: boolean;
  readonly signal: AbortSignal;
}

export interface LoadReport {
  readonly extensions: readonly LoadedExtensionInfo[];
  readonly diagnostics: readonly LoadDiagnostic[];
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
      origin: record.candidate.origin,
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

  /** 1~4단계: 후보 → 검증된 매니페스트, 집합 검사, 순서, 신뢰 */
  function validateAll(candidates: readonly ExtensionCandidate[]): void {
    let anonymous = 0;
    for (const candidate of candidates) {
      const module = candidate.builtin;
      if (module === null) continue;
      const result = validateManifest(module.manifest);
      const rawName: unknown = Reflect.get(module.manifest, "name");
      anonymous += 1;
      const name =
        result.manifest?.name ?? (typeof rawName === "string" ? rawName : `unknown-${anonymous}`);
      const record: ExtRecord = {
        name,
        candidate,
        manifest: result.manifest,
        source: candidate.source,
        trust: "untrusted",
        state: "discovered",
        loadIndex: null,
        generation: 0,
        essential: module.essential === true,
        diagnostics: [],
      };
      if (records.has(name)) {
        // 같은 이름이 두 번 들어왔다: 뒤의 것은 거부하고 앞의 것은 집합 검사에서 함께 다룬다
        record.name = `${name}~${anonymous}`;
        records.set(record.name, record);
        fail(
          record,
          "rejected",
          "set",
          "name_conflict",
          `extension name "${name}" is installed twice`,
        );
        const first = records.get(name);
        if (first !== undefined && first.state !== "rejected") {
          fail(
            first,
            "rejected",
            "set",
            "name_conflict",
            `extension name "${name}" is installed twice`,
          );
        }
        continue;
      }
      records.set(name, record);
      const warnings = result.issues.filter((issue) => issue.severity === "warning");
      if (result.manifest === undefined) {
        fail(
          record,
          "rejected",
          "manifest",
          "manifest_invalid",
          `manifest of ${name} is invalid`,
          result.issues,
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

    const valid = [...records.values()].filter((record) => record.state === "validated");
    const setIssues = validateManifestSet(
      valid.flatMap((record) => (record.manifest === undefined ? [] : [record.manifest])),
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
      [...records.values()]
        .filter((record) => record.state === "validated" && record.manifest !== undefined)
        .map((record) => ({
          record,
          key:
            record.manifest === undefined
              ? fallbackKey(record.name)
              : orderKeyOfBuiltin(record.manifest),
        })),
    );
    ordered.forEach((item, index) => {
      item.record.loadIndex = index;
    });
    order = ordered.map((item) => item.record);

    // 4단계 신뢰: 설치 위치 상한과 요청 등급의 낮은 쪽
    for (const record of order) {
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

  /** 5a단계: 켜짐 확인과 필수 userConfig */
  function checkEnabled(record: ExtRecord): boolean {
    const manifest = record.manifest;
    if (manifest === undefined) return false;
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
              other.state === "resolved" &&
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

  /** 6a~9단계 가운데 설치: admit → install → InstallResult 변환 */
  async function install(record: ExtRecord): Promise<void> {
    const module = record.candidate.builtin;
    const manifest = record.manifest;
    if (module === null || manifest === undefined || record.loadIndex === null) return;
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
    try {
      const result = await deps.host.install(
        unitOfBuiltin(module, manifest, record.loadIndex, enabledSettingOf(record)),
      );
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
   * 취소 신호는 단계 경계와 확장 하나를 설치하기 직전에 확인한다(TY-22). `ExtHost.install`은 신호를 받지 않아 진행 중인
   * 설치는 끝까지 간다. 취소되면 시작을 거부하는 것과 같은 LoadAbortError를 던진다 [미결: install에 신호를 싣는 일은 X.primitives 몫]
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
      if (currentState(record) === "resolved") await install(record);
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

  return {
    async loadAll(options) {
      const missing = missingDependency();
      if (missing !== undefined) throw new Bug(`loader.missing_dependency: ${missing}`);
      throwIfCancelled(options.signal, "validation");
      records.clear();
      allDiagnostics.length = 0;
      order = [];
      validateAll(candidatesFromBuiltins(options.builtins));
      // 거부된 확장도 필수 확장이면 시작 실패다
      for (const record of records.values()) assertNotEssentialFailure(record);

      throwIfCancelled(options.signal, "settings");
      for (const record of order) if (record.state === "trusted") checkSettings(record);
      for (const record of order) assertNotEssentialFailure(record);

      throwIfCancelled(options.signal, "enable check");
      const alive: ExtRecord[] = [];
      for (const record of order) {
        if (record.state === "resolved" && checkEnabled(record)) alive.push(record);
        assertNotEssentialFailure(record);
      }
      checkCapabilities(alive);
      for (const record of alive) assertNotEssentialFailure(record);

      await eachInOrder(order, async (record) => {
        if (record.state !== "resolved" || !alive.includes(record)) return "continue";
        throwIfCancelled(options.signal, `installing ${record.name}`);
        // 활성이 되지 못한 provider가 이미 있으면 설치 전에 연쇄 실패로 둔다(§4.3.2)
        await install(record);
        assertNotEssentialFailure(record);
        return "continue";
      });
      throwIfCancelled(options.signal, "provider cascade");
      await cascadeProviderFailures();
      for (const record of order) assertNotEssentialFailure(record);
      return {
        extensions: listAll(),
        diagnostics: [...allDiagnostics],
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
