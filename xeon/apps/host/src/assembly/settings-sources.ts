import { isId } from "@xeon/contracts/conversation";
import type { AgentsSettingsSource } from "@xeon/core-agents";
import type { DriveLimits } from "@xeon/contracts/extensions";
import {
  modelsSettingsOf,
  type ModelsSettings,
  type ModelsSettingsSource,
} from "@xeon/core-models";
import { DEFAULT_PERSISTENCE_SETTINGS, resolvePersistenceSettings } from "@xeon/core-persistence";
import type { LoopSettingsSource } from "@xeon/core-loop";
import { createLayeredTasksSettings, type TasksSettingsSource } from "@xeon/core-tasks";
import type { ToolsSettingsSource } from "@xeon/core-tools";
import type { WorkspaceSettingsSource } from "@xeon/cap-workspace";
import { withDriveDefaults, type ExtHostDeps, type OperationsSettingsSource } from "@xeon/ext-host";
import {
  DEFAULT_STORE_SETTINGS,
  resolveStoreSettings,
  type StoreSettings,
} from "@xeon/platform-store";
import { readSandboxSettings, type SandboxSettings } from "@xeon/platform-sandbox";
import { DEFAULT_SECRETS_CONFIG, type SecretsConfig } from "@xeon/platform-secrets";
import type { PersistenceSettings } from "@xeon/core-persistence";
import type { HostLimits } from "../connection-types.ts";
import { REPLAY_BATCH_MAX_EVENTS, REPLAY_SCAN_LIMIT, SEND_LOW_WATER_BYTES } from "../connection.ts";
import {
  DEFAULT_MAX_REPLAY_EVENTS,
  DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION,
} from "../settings.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// 각 패키지가 요구하는 "유효 설정 읽기" 모양을 설정 엔진 하나에 연결한다. 조립 루트 코드(DR-14 예외 2).
// 호출 때마다 읽으므로 live 키는 다음 판정부터, nextTurn 키는 다음 turn부터 바뀐 값을 본다.

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** DriveLimits 모양의 설정 값을 읽는다. 숫자가 아닌 필드는 없는 것으로 본다(검증은 설정 엔진이 이미 했다) */
function driveLimitsOf(value: unknown): DriveLimits {
  if (!isRecord(value)) return {};
  const limits: { maxTurns?: number; maxSpawns?: number; maxTokens?: number } = {};
  const turns = value["maxTurns"];
  const spawns = value["maxSpawns"];
  const tokens = value["maxTokens"];
  if (typeof turns === "number") limits.maxTurns = turns;
  if (typeof spawns === "number") limits.maxSpawns = spawns;
  if (typeof tokens === "number") limits.maxTokens = tokens;
  return limits;
}

/** x.primitives.* */
export function primitivesSource(settings: SettingsEngine): ExtHostDeps["settings"] {
  return {
    // 두 상한 키는 session 범위도 받으므로 임대를 받는 thread로 읽는다(review.decisions-2 U-12).
    // 일부 필드만 적은 값은 빠진 필드를 내장 기본 상한으로 채운다(X.primitives.spec §4.4.2)
    driveDefaultLimits(threadId): DriveLimits {
      return withDriveDefaults(
        driveLimitsOf(settings.value("x.primitives.driveDefaultLimits", threadId)),
      );
    },
    driveLimits(threadId): DriveLimits {
      return driveLimitsOf(settings.value("x.primitives.driveLimits", threadId));
    },
    activeDriveGroup(threadId) {
      const value = settings.value("x.primitives.activeDriveGroup", threadId);
      return typeof value === "string" ? value : null;
    },
    capabilityProviders() {
      const value = settings.value("x.primitives.capabilityProviders");
      if (!isRecord(value)) return {};
      const out: Record<string, string> = {};
      for (const [capability, extension] of Object.entries(value)) {
        if (typeof extension === "string") out[capability] = extension;
      }
      return out;
    },
  };
}

/** x.operations.* . 훅 예산(hook)은 설정 키가 없어 문서의 상수 30초를 쓴다(X.operations.spec §6) */
export function operationsSource(settings: SettingsEngine): OperationsSettingsSource {
  const HOOK_BUDGET_MS = 30_000;
  const int = (name: string, fallback: number): number =>
    intOr(settings.value(`x.operations.${name}`), fallback);
  return {
    budgets: () => ({
      first: int("budget.firstMs", 30_000),
      chain: int("budget.chainMs", 10_000),
      tap: int("budget.tapMs", 5_000),
      streamTap: int("budget.streamTapMs", 1_000),
      shutdown: int("budget.shutdownMs", 2_000),
      setup: int("budget.setupMs", 10_000),
      hook: HOOK_BUDGET_MS,
    }),
    autoDisable: () => {
      const rate = settings.value("x.operations.autoDisable.failureRate");
      return {
        enabled: boolOr(settings.value("x.operations.autoDisable.enabled"), true),
        consecutive: int("autoDisable.consecutive", 5),
        windowSize: int("autoDisable.windowSize", 50),
        minFailures: int("autoDisable.minFailures", 10),
        failureRate: typeof rate === "number" ? rate : 0.5,
      };
    },
  };
}

export function tasksSource(settings: SettingsEngine): TasksSettingsSource {
  return createLayeredTasksSettings(() => settings.layers(undefined));
}

/** l1.models.* . 검사는 core-models의 modelsSettingsOf가 선언한 스키마로 다시 한다 */
export function modelsSource(settings: SettingsEngine): ModelsSettingsSource {
  return (): ModelsSettings => modelsSettingsOf((key) => settings.value(key));
}

export function loopSource(settings: SettingsEngine): LoopSettingsSource {
  return {
    maxSteps: (threadId) => intOr(settings.value("l1.loop.maxSteps", threadId), 0),
    gateMaxContinues: (threadId) => intOr(settings.value("l1.loop.gate.maxContinues", threadId), 8),
  };
}

/** l1.agents.* . 호출 때마다 읽는다(nextTurn 키) */
export function agentsSource(settings: SettingsEngine): AgentsSettingsSource {
  return {
    maxDepth: () => intOr(settings.value("l1.agents.maxDepth"), 1),
    maxConcurrent: () => intOr(settings.value("l1.agents.maxConcurrent"), 8),
    resultMaxChars: () => intOr(settings.value("l1.agents.resultMaxChars"), 24_000),
  };
}

export function toolsSource(settings: SettingsEngine): ToolsSettingsSource {
  return { layers: () => settings.layers(undefined) };
}

export function workspaceSource(settings: SettingsEngine): WorkspaceSettingsSource {
  return {
    layers: (threadId) => settings.layers(isId("thr", threadId) ? threadId : undefined),
  };
}

/** l1.persistence.* (선언 없는 키). 잘못된 값은 기본값으로 두고 진단을 남긴다 */
export function persistenceSource(
  settings: SettingsEngine,
  report: (message: string) => void,
): () => PersistenceSettings {
  return () => {
    const resolved = resolvePersistenceSettings(settings.raw("l1.persistence."));
    if (resolved.ok) return resolved.value;
    for (const issue of resolved.error) report(`l1.persistence.${issue.name}: ${issue.message}`);
    return DEFAULT_PERSISTENCE_SETTINGS;
  };
}

/** l0.store.* (선언 없는 키). 열기 전에 한 번 읽는다 */
export function storeSettingsOf(
  settings: SettingsEngine,
  report: (message: string) => void,
): StoreSettings {
  const resolved = resolveStoreSettings(settings.raw("l0.store."));
  if (resolved.ok) return resolved.value;
  for (const issue of resolved.error) report(`l0.store.${issue.name}: ${issue.message}`);
  return DEFAULT_STORE_SETTINGS;
}

export function sandboxSource(settings: SettingsEngine): () => SandboxSettings {
  return () => readSandboxSettings((key) => settings.value(key));
}

/** l0.secrets.* (선언 없는 키). 모양이 맞지 않는 값은 기본값을 쓴다. 호출 때마다 읽는다(live 키) */
export function secretsSource(settings: SettingsEngine): () => SecretsConfig {
  const base = DEFAULT_SECRETS_CONFIG;
  return () => {
    const raw = settings.raw("l0.secrets.");
    const files = raw["sops.files"];
    const sopsFiles = Array.isArray(files)
      ? files.flatMap((entry: unknown) =>
          isRecord(entry) && typeof entry["env"] === "string" && typeof entry["path"] === "string"
            ? [{ env: entry["env"], path: entry["path"] }]
            : [],
        )
      : base.sops.files;
    const source = raw["ageKey.source"];
    const approvalDefault = raw["approval.default"];
    const writeHosts = raw["approval.writeHosts"];
    return {
      ...base,
      sops: { files: sopsFiles, binary: stringOrNull(raw["sops.binary"]) },
      ageKey: {
        source:
          source === "keychain" || source === "file" || source === "auto"
            ? source
            : base.ageKey.source,
        filePath: stringOrNull(raw["ageKey.filePath"]),
      },
      approval: {
        default:
          approvalDefault === "none" ||
          approvalDefault === "per-session" ||
          approvalDefault === "per-use"
            ? approvalDefault
            : base.approval.default,
        writeHosts:
          writeHosts === "per-session" || writeHosts === "per-use"
            ? writeHosts
            : base.approval.writeHosts,
      },
      lease: {
        ttlSeconds: intOr(raw["lease.ttlSeconds"], base.lease.ttlSeconds),
        maxUses: intOr(raw["lease.maxUses"], base.lease.maxUses),
      },
    };
  };
}

export interface ExecOptionsValues {
  readonly cwd: string;
  readonly shellPath: string | undefined;
  readonly defaultTimeoutMs: number;
  readonly outputSpillBytes: number;
  readonly envExtra: readonly string[];
}

/** l0.exec.* (선언 없는 키). 기본값은 L0.exec.spec §6 표다 */
export function execOptionsOf(settings: SettingsEngine, cwd: string): ExecOptionsValues {
  const raw = settings.raw("l0.exec.");
  const shell = raw["shell"];
  const extra = raw["envAllowlist.extra"];
  return {
    cwd,
    shellPath: typeof shell === "string" ? shell : undefined,
    defaultTimeoutMs: intOr(raw["defaultTimeoutMs"], 0),
    outputSpillBytes: intOr(raw["outputSpillBytes"], 10_485_760),
    envExtra: isStringArray(extra) ? extra : [],
  };
}

/** 키 하나의 유효 값을 돌려주는 함수. 엔진 안(설정 엔진)과 밖(Engine의 카탈로그와 SettingsStorePort) 어느 쪽에서도 만든다 */
export type SettingReader = (key: string) => unknown;

/** l0.process.shutdown.timeoutMs 유효 값(ms). 기본 3000 */
export function shutdownTimeoutOf(read: SettingReader): number {
  return intOr(read("l0.process.shutdown.timeoutMs"), 3000);
}

export function shutdownTimeoutMs(settings: SettingsEngine): number {
  return shutdownTimeoutOf((key) => settings.value(key));
}

/** 연결 한도. 구독 때마다 그때의 값을 읽는다(l4.host-service.* 는 live) */
export function hostLimitsOf(read: SettingReader): HostLimits {
  return {
    get maxReplayEvents() {
      return intOr(read("l4.host-service.maxReplayEvents"), DEFAULT_MAX_REPLAY_EVENTS);
    },
    get maxSubscriptionsPerConnection() {
      return intOr(
        read("l4.host-service.maxSubscriptionsPerConnection"),
        DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION,
      );
    },
    replayBatchMaxEvents: REPLAY_BATCH_MAX_EVENTS,
    scanLimit: REPLAY_SCAN_LIMIT,
    sendLowWaterBytes: SEND_LOW_WATER_BYTES,
  };
}
