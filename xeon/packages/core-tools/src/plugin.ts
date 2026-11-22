import { attempt, type Clock, type Logger, type Scheduler } from "@fresnel/contracts";
import {
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
  type AnyCapabilityDef,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import type { IdFactory, ThreadId } from "@fresnel/contracts/conversation";
import {
  defineManifest,
  type CapabilityRequirement,
  type ExtensionEntry,
  type ExtensionManifest,
  type RegistrationId,
  type ToolCallTraceSink,
} from "@fresnel/contracts/extensions";
import type { SessionService } from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  ExecPortKey,
  OsPortKey,
  SecretServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
  TaskServicePortKey,
  ToolServicePortKey,
  type DraftMark,
  type ToolOutputFiles,
  type WithHumanDecision,
} from "@fresnel/contracts/services";
import type { ScopeStack } from "@fresnel/contracts/settings";
import { ExtHostPortKey, hostOf, type ExtensionUnit } from "@fresnel/ext-host";
import type { ToolsConfig, ToolsDeps } from "./deps.ts";
import type { CapabilityResolver } from "./entries.ts";
import { collectRules } from "./policy/tiers.ts";
import { createToolRuntime } from "./runtime.ts";
import { readScalarConfig, type ToolsSettingsSource } from "./settings.ts";

// L1.tools.plan TL-8 plugin.ts. ext-host의 내장 확장 단위로 fresnel.tools, fresnel.approvals를 제공한다.
// 이 패키지는 Cordis를 import하지 않는다(DR-11). 서비스 등록은 hostOf(g).providePort로 한다.

/** 도구 어댑터가 서비스 API를 얻도록 매니페스트 optional에 올리는 내장 기능(L2.workspace) */
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
  /** 승인 만료 타이머. 생략하면 `fresnel.os`가 있을 때 그 스케줄러를 쓰고, 없으면 타이머 없이 시계만 본다 */
  readonly scheduler?: Scheduler;
  readonly ids: IdFactory;
  /** 파일 범위(managed, user, project, local) 설정 층. 세션 범위는 fresnel.session에서 읽는다 */
  readonly settings: ToolsSettingsSource;
  readonly logger?: Logger;
  /** 잘린 도구 출력의 파일 사본. 조립 루트가 만들어 넘긴다 */
  readonly outputFiles?: ToolOutputFiles;
  /** 매니페스트 optional에 더할 기능(워크스페이스 기능 밖의 L2 기능 도구를 쓸 때) */
  readonly capabilities?: readonly AnyCapabilityDef[];
  /**
   * 플러그인 기능 호출이 찾을 기능 정의(매니페스트에는 더하지 않는다). 도구 매핑이 없는 메서드의 합성 항목을 만든다(U-1 (다)).
   * 조립 루트가 내장 기능 정의 전체를 넘긴다
   */
  readonly pluginCapabilities?: readonly AnyCapabilityDef[];
  /**
   * 사람의 결정을 실행하는 함수를 조립 루트에 넘긴다(U-11). 포트(`fresnel.tools`)로는 나가지 않는다: 확장과 플러그인이 받을 수 없다.
   * setup 중 한 번 부른다
   */
  readonly onHumanDecision?: (withHumanDecision: WithHumanDecision) => void;
  /** 도구 호출 추적 싱크(읽기 전용). 조립 루트가 턴 기록 쓰는 쪽에 잇는다. 생략하면 추적하지 않는다 */
  readonly callTrace?: ToolCallTraceSink;
  /**
   * 등록 id가 검토되지 않은 플러그인 초안이면 그 표지를 돌려준다(L1.tools.spec §4.6.1). 조립 루트가 초안 목록으로 만든다.
   * 생략하면 초안 호출이 없다
   */
  readonly draftOf?: (scopeId: RegistrationId) => DraftMark | undefined;
  /** 호출한 대화가 드래프트 승인 `auto`인가(`ToolsDeps.draftAutoApproved`). 생략하면 모든 대화가 `ask`다 */
  readonly draftAutoApproved?: (threadId: ThreadId) => boolean;
  /** 대화가 보는 도구 이름 규칙(`ToolsDeps.exposureOf`). 생략하면 `perThread` 도구가 모두 요청한 이름으로 보인다 */
  readonly exposureOf?: ToolsDeps["exposureOf"];
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
    schemaVersion: 2,
    name: TOOLS_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Tool runtime",
    description: "Tool advertising, policy, approvals, effect records and result bounding (L1).",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [{ layer: "L1", hooks: [], optional }],
    trust: { level: "builtin" },
  });
}

/** 파일 범위 층에 스레드의 프로필 층과 세션 범위 층을 더해 현재 설정을 읽는다(M5c §4.1.7: 프로필 층은 세션 층 아래, 파일 층 위) */
export function configReader(
  source: ToolsSettingsSource,
  session: Pick<SessionService, "sessionSettings">,
): (threadId: ThreadId | null) => ToolsConfig {
  return (threadId) => {
    const base = source.layers();
    if (threadId === null) {
      return { ...readScalarConfig(base), rules: collectRules(base).rules };
    }
    const profile = source.profileLayer?.(threadId);
    const layers: ScopeStack = [
      ...base,
      ...(profile === undefined ? [] : [profile]),
      session.sessionSettings.layer(threadId),
    ];
    return { ...readScalarConfig(layers), rules: collectRules(layers).rules };
  };
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function toolsPlugin(options: ToolsPluginOptions): ExtensionUnit {
  // 플러그인 기능 호출이 부르는 기능도 매니페스트 optional에 있어야 core-tools가 공급자를 찾는다(`g.capability`는 선언 밖을 거부한다)
  const manifest = toolsManifest([
    ...(options.capabilities ?? []),
    ...(options.pluginCapabilities ?? []),
  ]);
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
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
        // 승인 상속의 경로 대조는 대화의 작업 폴더 기준으로 푼다(파일 도구와 같은 env). 대화 행을 못 읽으면 상속하지 않는다
        pathEnvOf: (threadId) => {
          const row = session.query.thread(threadId);
          if (!row.ok) return undefined;
          const workspace = row.value?.workspace ?? null;
          return workspace === null ? exec : exec.withCwd(workspace);
        },
        // 출력 절단은 fresnel.exec가 제공한다. core-tools에는 사본을 두지 않는다(review.decisions-2 D-08, B-04)
        truncator: exec,
        ...(options.outputFiles === undefined ? {} : { outputFiles: options.outputFiles }),
        redactor: secrets.redactor,
        secrets,
        ext,
        resolveCapability,
        config: configReader(options.settings, session),
        clock: options.clock,
        ...(scheduler === undefined ? {} : { scheduler }),
        ids: options.ids,
        logger: options.logger,
        ...(options.callTrace === undefined ? {} : { callTrace: options.callTrace }),
        ...(options.draftOf === undefined ? {} : { draftOf: options.draftOf }),
        ...(options.draftAutoApproved === undefined
          ? {}
          : { draftAutoApproved: options.draftAutoApproved }),
        ...(options.exposureOf === undefined ? {} : { exposureOf: options.exposureOf }),
        capabilityDefs: [
          ...BUILTIN_CAPABILITIES,
          ...(options.capabilities ?? []),
          ...(options.pluginCapabilities ?? []),
        ],
      };
      const runtime = createToolRuntime(deps);
      host.providePort(ToolServicePortKey, runtime.tools);
      host.providePort(ApprovalServicePortKey, runtime.approvals);
      options.onHumanDecision?.(runtime.withHumanDecision);
    });
  };
  return {
    manifest,
    entry,
    loadIndex: options.loadIndex ?? 0,
    builtin: true,
  };
}
