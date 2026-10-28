import { attempt, type Clock, type Logger, type Scheduler } from "@xeon/contracts";
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
} from "@xeon/contracts/extensions";
import type { SessionService } from "@xeon/contracts/records";
import {
  ApprovalServicePortKey,
  ExecPortKey,
  OsPortKey,
  SecretServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
  TaskServicePortKey,
  ToolServicePortKey,
} from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import { ExtHostPortKey, hostOf, type ExtensionUnit } from "@xeon/ext-host";
import type { ToolsConfig, ToolsDeps } from "./deps.ts";
import type { CapabilityResolver } from "./entries.ts";
import { collectRules } from "./policy/tiers.ts";
import { createToolRuntime } from "./runtime.ts";
import { readScalarConfig, type ToolsSettingsSource } from "./settings.ts";

// L1.tools.plan TL-8 plugin.ts. ext-host의 내장 확장 단위로 xeon.tools, xeon.approvals를 제공한다.
// 이 패키지는 Cordis를 import하지 않는다(DR-11). 서비스 등록은 hostOf(g).providePort로 한다.

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
  /** 승인 만료 타이머. 생략하면 `xeon.os`가 있을 때 그 스케줄러를 쓰고, 없으면 타이머 없이 시계만 본다 */
  readonly scheduler?: Scheduler;
  readonly ids: IdFactory;
  /** 파일 범위(managed, user, project, local) 설정 층. 세션 범위는 xeon.session에서 읽는다 */
  readonly settings: ToolsSettingsSource;
  readonly logger?: Logger;
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
      const store = host.port(StoreServicePortKey);
      const tasks = host.port(TaskServicePortKey);
      const exec = host.port(ExecPortKey);
      const secrets = host.port(SecretServicePortKey);
      const ext = host.port(ExtHostPortKey);
      const resolveCapability: CapabilityResolver = (key: ServiceKey<unknown>) => {
        const resolved = attempt(() => g.capability(key));
        // 선언하지 않았거나 공급자가 없으면 도구 호출이 unavailable 결과가 된다
        return resolved.ok ? resolved.value : undefined;
      };
      const scheduler = options.scheduler ?? ext.ports.get(OsPortKey)?.time.scheduler;
      const deps: ToolsDeps = {
        session,
        producer: session.producer("core.tools"),
        store,
        tasks,
        lockEnv: exec,
        // 출력 절단은 xeon.exec가 제공한다. core-tools에는 사본을 두지 않는다(review.decisions-2 D-08, B-04)
        truncator: exec,
        redactor: secrets.redactor,
        secrets,
        ext,
        resolveCapability,
        config: configReader(options.settings, session),
        clock: options.clock,
        ...(scheduler === undefined ? {} : { scheduler }),
        ids: options.ids,
        logger: options.logger,
      };
      const runtime = createToolRuntime(deps);
      host.providePort(ToolServicePortKey, runtime.tools);
      host.providePort(ApprovalServicePortKey, runtime.approvals);
    });
  };
  return {
    manifest,
    entry,
    loadIndex: options.loadIndex ?? 0,
    builtin: true,
  };
}
