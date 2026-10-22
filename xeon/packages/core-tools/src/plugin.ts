import { Bug, type Clock, type Logger } from "@xeon/contracts";
import {
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
  type AnyCapabilityDef,
  type ServiceKey,
} from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type CapabilityRequirement,
  type ExtensionEntry,
  type ExtensionManifest,
  type PortKey,
} from "@xeon/contracts/extensions";
import { StoreServiceName, type SessionService, type StoreService } from "@xeon/contracts/records";
import {
  ApprovalServiceName,
  ExecPortKey,
  SecretServiceName,
  SessionPortKey,
  TaskServiceName,
  ToolServiceName,
  type ApprovalService,
  type SecretService,
  type TaskService,
  type ToolService,
} from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import { ExtHostPortKey, hostOf, type ExtensionUnit } from "@xeon/ext-host";
import type { ToolsConfig, ToolsDeps } from "./deps.ts";
import type { CapabilityResolver } from "./entries.ts";
import { collectRules } from "./policy/tiers.ts";
import { createToolRuntime } from "./runtime.ts";
import { readScalarConfig, type ToolsSettingsSource } from "./settings.ts";
import type { OutputTruncator, TruncationOutcome } from "./types.ts";

// L1.tools.plan TL-8 plugin.ts. ext-host의 내장 확장 단위로 xeon.tools, xeon.approvals를 제공한다.
// 이 패키지는 Cordis를 import하지 않는다(DR-11). 서비스 등록은 hostOf(g).providePort로 한다.

const StorePortKey: PortKey<StoreService> = { name: StoreServiceName };
const TasksPortKey: PortKey<TaskService> = { name: TaskServiceName };
const SecretsPortKey: PortKey<SecretService> = { name: SecretServiceName };
export const ToolsServicePortKey: PortKey<ToolService> = { name: ToolServiceName };
export const ApprovalsServicePortKey: PortKey<ApprovalService> = { name: ApprovalServiceName };

/** 도구 어댑터가 서비스 API를 얻도록 매니페스트 optional에 올리는 내장 능력(L2.workspace) */
const BUILTIN_CAPABILITIES: readonly AnyCapabilityDef[] = [
  WorkspaceFiles,
  WorkspaceShell,
  WorkspaceImages,
];

function requirementOf(def: AnyCapabilityDef): CapabilityRequirement {
  return { id: def.id, range: `^${def.version}` };
}

export const TOOLS_EXTENSION_NAME = "core-tools";

export interface ToolsPluginOptions {
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** 파일 범위(managed, user, project, local) 설정 층. 세션 범위는 xeon.session에서 읽는다 */
  readonly settings: ToolsSettingsSource;
  readonly logger?: Logger;
  /**
   * 출력 절단 함수. 생략하면 `xeon.exec`가 truncateHead·formatSize를 제공할 때 그것을 쓰고, 없으면 setup이 실패한다
   * (review.decisions-2 D-08: 절단 함수는 platform-exec에 있고 core-tools에는 사본을 두지 않는다)
   */
  readonly truncator?: OutputTruncator;
  /** 매니페스트 optional에 더할 능력(워크스페이스 능력 밖의 L2 능력 도구를 쓸 때) */
  readonly capabilities?: readonly AnyCapabilityDef[];
  readonly loadIndex?: number;
}

export function toolsManifest(extra: readonly AnyCapabilityDef[] = []): ExtensionManifest {
  const defs = [...BUILTIN_CAPABILITIES, ...extra];
  const seen = new Set<string>();
  const optional: CapabilityRequirement[] = [];
  for (const def of defs) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    optional.push(requirementOf(def));
  }
  return defineManifest({
    schemaVersion: 1,
    name: TOOLS_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Tool runtime",
    description: "Tool advertising, policy, approvals, effect records and result bounding (L1).",
    defaultEnabled: true,
    layer: "L1",
    kind: "plugin",
    entry: "./src/index.ts",
    optional,
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}

function isTruncationOutcome(value: unknown): value is TruncationOutcome {
  if (typeof value !== "object" || value === null) return false;
  return (
    "content" in value &&
    typeof value.content === "string" &&
    "truncated" in value &&
    typeof value.truncated === "boolean" &&
    "truncatedBy" in value &&
    (value.truncatedBy === "lines" ||
      value.truncatedBy === "bytes" ||
      value.truncatedBy === null) &&
    "totalLines" in value &&
    typeof value.totalLines === "number" &&
    "totalBytes" in value &&
    typeof value.totalBytes === "number" &&
    "outputLines" in value &&
    typeof value.outputLines === "number" &&
    "outputBytes" in value &&
    typeof value.outputBytes === "number"
  );
}

/** `xeon.exec`가 절단 함수를 제공하면 OutputTruncator로 감싼다. 메서드 이름은 L0.exec.spec이 정한다 [미결] */
export function truncatorOf(exec: unknown): OutputTruncator | undefined {
  if (typeof exec !== "object" || exec === null) return undefined;
  const truncateHead: unknown = Reflect.get(exec, "truncateHead");
  const formatSize: unknown = Reflect.get(exec, "formatSize");
  if (typeof truncateHead !== "function" || typeof formatSize !== "function") return undefined;
  return {
    truncateHead(content, options) {
      const cut: unknown = Reflect.apply(truncateHead, exec, [content, options]);
      if (!isTruncationOutcome(cut)) {
        throw new Bug(
          "tools.truncate_invalid: xeon.exec truncateHead returned an unexpected shape",
        );
      }
      return cut;
    },
    formatSize(bytes) {
      const text: unknown = Reflect.apply(formatSize, exec, [bytes]);
      return typeof text === "string" ? text : `${bytes} B`;
    },
  };
}

/** 파일 범위 층에 스레드의 세션 범위 층을 더해 현재 설정을 읽는다 */
export function configReader(
  source: ToolsSettingsSource,
  session: Pick<SessionService, "sessionSettings">,
): (threadId: ThreadId | null) => ToolsConfig {
  return (threadId) => {
    const base = source.layers();
    const layers: ScopeStack =
      threadId === null ? base : [...base, session.sessionSettings.layer(threadId)];
    return { ...readScalarConfig(layers), rules: collectRules(layers).rules };
  };
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function toolsPlugin(options: ToolsPluginOptions): ExtensionUnit {
  const manifest = toolsManifest(options.capabilities);
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const session = host.port(SessionPortKey);
      const store = host.port(StorePortKey);
      const tasks = host.port(TasksPortKey);
      const exec = host.port(ExecPortKey);
      const secrets = host.port(SecretsPortKey);
      const ext = host.port(ExtHostPortKey);
      const truncator = options.truncator ?? truncatorOf(exec);
      if (truncator === undefined) {
        throw new Bug(
          "core-tools needs an output truncator: pass options.truncator or let xeon.exec provide truncateHead/formatSize (L0.exec.spec, review.decisions-2 D-08)",
        );
      }
      const resolveCapability: CapabilityResolver = (key: ServiceKey<unknown>) => {
        try {
          return g.capability(key);
        } catch {
          // 선언하지 않았거나 공급자가 없으면 도구 호출이 unavailable 결과가 된다
          return undefined;
        }
      };
      const deps: ToolsDeps = {
        session,
        producer: session.producer("core.tools"),
        store,
        tasks,
        lockEnv: exec,
        truncator,
        redactor: secrets.redactor,
        ext,
        resolveCapability,
        config: configReader(options.settings, session),
        clock: options.clock,
        ids: options.ids,
        logger: options.logger,
      };
      const runtime = createToolRuntime(deps);
      host.providePort(ToolsServicePortKey, runtime.tools);
      host.providePort(ApprovalsServicePortKey, runtime.approvals);
    });
  };
  return {
    manifest,
    entry,
    loadIndex: options.loadIndex ?? 0,
    builtin: true,
  };
}
