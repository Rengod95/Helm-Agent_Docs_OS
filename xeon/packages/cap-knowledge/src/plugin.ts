import { join } from "node:path";
import { attemptAsync, err, ok, type Logger } from "@xeon/contracts";
import {
  KnowledgeLedgerKey,
  KnowledgeMemory,
  KnowledgeMemoryKey,
  KnowledgeSkills,
  KnowledgeSkillsKey,
  type AnyCapabilityDef,
} from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type { ExtensionEntry, PortKey } from "@xeon/contracts/extensions";
import {
  ApprovalServicePortKey,
  ExecPortKey,
  OsPortKey,
  SecretServiceName,
  StoreServicePortKey,
  ToolServiceName,
  type SecretService,
  type ToolRegistration,
  type ToolService,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import { createNodeFs } from "./fs/node-fs.ts";
import type { KnowledgeFs } from "./fs/port.ts";
import { knowledgeManifest } from "./manifest.ts";
import { createWriteApprovals } from "./ports/approvals.ts";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_OWNER } from "./migrations.ts";
import { createKnowledgeRuntime, type KnowledgeDeps } from "./service.ts";
import { readKnowledgeSettings, type KnowledgeSettingsSource } from "./settings.ts";
import type { SkillDiagnostic } from "./upstream/skills.ts";
import { projectSkillsDir, resolveSkillRoots, type RootsResult } from "./skills/roots.ts";

// L2.knowledge.plan K2 조립. 구현 패키지(platform-store, platform-os, core-tools)를 import하지 않고 F 서비스 인터페이스를
// 포트로만 받는다. Cordis는 import하지 않는다(DR-11).

const SecretsPortKey: PortKey<SecretService> = { name: SecretServiceName };
const ToolsPortKey: PortKey<ToolService> = { name: ToolServiceName };

/**
 * L1.tools에 올리는 `knowledge.skills` 도구 이름. 쓰기 도구(`skill_manage`)는 승인 게이트와 원장을 거친 쓰기 경로(K3)가 끝난 뒤에
 * 광고한다(plan §1.1 순서 2): 승인 없는 쓰기 경로가 한 번도 배포되지 않게 하기 위해서다.
 */
export const IMPLEMENTED_SKILL_TOOLS: readonly string[] = ["skill_view", "skill_manage"];

export interface KnowledgePluginOptions {
  /** 설정 층. 파일 범위와 세션 범위를 합친 스택을 호출마다 돌려준다 */
  readonly settings: KnowledgeSettingsSource;
  /** 원장 id(`knl_<ULID>`) 발급. 구현은 platform-os의 createLocalIdFactory다 */
  readonly ids: LocalIdFactory;
  /** 시험이 메모리 가짜를 넣는다. 기본은 node:fs 구현 */
  readonly fs?: KnowledgeFs;
  /** `resources_discover`가 알린 확장 제공 스킬 루트(spec §4.2.7) */
  readonly extensionSkillRoots?: () => readonly {
    readonly dir: string;
    readonly extension: string;
  }[];
  /**
   * 프로젝트 디렉터리가 신뢰되었는가(X.loading-trust `resolveProjectTrust`의 `trusted`). 조립 루트가 신뢰 저장소와
   * 프롬프터를 묶어 넘긴다. 없거나 거짓이거나 거부되면 프로젝트 스킬(`.xeon/skills`)을 싣지 않는다(fail-closed)
   */
  readonly projectTrust?: (projectDir: string) => Promise<boolean>;
  readonly loadIndex?: number;
}

/** 아직 제공되지 않은 포트는 undefined. 그 밖의 오류는 그대로 던진다 */
function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/** 신뢰 판정 콜백을 부른다. 콜백이 없거나 거절하거나 실패하면 신뢰하지 않은 것으로 본다 */
async function isProjectTrusted(
  trust: KnowledgePluginOptions["projectTrust"],
  projectDir: string,
  logger: Logger,
): Promise<boolean> {
  if (trust === undefined) return false;
  const decided = await attemptAsync(() => trust(projectDir));
  if (!decided.ok) {
    logger.warn("knowledge.project_trust_failed", { projectDir });
    return false;
  }
  return decided.value;
}

/** 쓰기 도구 둘이 쓰는 정책 메타: 효과는 쓰기이고 서브에이전트 차단 목록이 공유 상태 쓰기로 볼 수 있게 한다 */
const WRITE_TOOL_POLICY = { risk: "write", classes: ["shared_state_write"] } as const;

/** 구현된 도구만 남긴 `knowledge.skills` 정의 */
export function advertisedSkillsDef(): AnyCapabilityDef {
  return {
    ...KnowledgeSkills,
    tools: KnowledgeSkills.tools.filter((tool) => IMPLEMENTED_SKILL_TOOLS.includes(tool.name)),
  };
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function knowledgePlugin(options: KnowledgePluginOptions): ExtensionUnit {
  const manifest = knowledgeManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, async (g) => {
      const host = hostOf(g);
      const os = host.port(OsPortKey);
      const store = host.port(StoreServicePortKey);
      const exec = optionalPort(host, ExecPortKey);
      const secrets = optionalPort(host, SecretsPortKey);
      const tools = optionalPort(host, ToolsPortKey);
      const approvalService = optionalPort(host, ApprovalServicePortKey);
      const logger = os.logger("knowledge");

      const migrated = store.migrations.apply(KNOWLEDGE_MIGRATIONS);
      if (!migrated.ok) return err({ reason: migrated.error.kind, cause: migrated.error });

      const fs = options.fs ?? createNodeFs();
      const deps: KnowledgeDeps = {
        fs,
        db: store.scoped(KNOWLEDGE_OWNER),
        blobs: store,
        clock: os.time.clock,
        ids: options.ids,
        logger,
        settings: (threadId) => readKnowledgeSettings(options.settings.layers(threadId)),
        roots: async (): Promise<RootsResult> => {
          const settings = readKnowledgeSettings(options.settings.layers(undefined));
          const projectDir = exec?.cwd;
          const wantsProject = settings.skills.projectSkills && projectDir !== undefined;
          const projectTrusted =
            wantsProject && (await isProjectTrusted(options.projectTrust, projectDir, logger));
          const diagnostics: SkillDiagnostic[] = [];
          if (wantsProject && !projectTrusted) {
            // 싣지 않은 스킬이 실제로 있을 때만 알린다
            const skillsDir = projectSkillsDir(projectDir);
            if ((await fs.stat(skillsDir)).ok) {
              diagnostics.push({
                type: "warning",
                message: "project skills are not loaded: the project is not trusted",
                path: skillsDir,
              });
            }
          }
          return {
            roots: resolveSkillRoots({
              dataDir: os.dirs.data,
              projectDir,
              projectSkills: settings.skills.projectSkills,
              projectTrusted,
              paths: settings.skills.paths,
              extension: options.extensionSkillRoots?.() ?? [],
            }),
            diagnostics,
          };
        },
        containsKnown:
          secrets === undefined ? undefined : (text) => secrets.redactor.containsKnown(text),
        approvals:
          approvalService === undefined ? undefined : createWriteApprovals(approvalService),
        memoryDir: join(os.dirs.data, "memory"),
      };
      const runtime = createKnowledgeRuntime(deps);
      host.provide(KnowledgeSkillsKey, runtime.skillsApi);
      host.provide(KnowledgeMemoryKey, runtime.memoryApi);
      host.provide(KnowledgeLedgerKey, runtime.ledgerApi);

      // 시작 시 복구와 재색인. 실패해도 시작을 막지 않는다(색인이 낡을 뿐이다). 원인은 기록한다
      const started = await runtime.startup();
      if (!started.ok) {
        logger.error("knowledge.startup_failed", {
          kind: started.error.kind,
          message: started.error.message,
        });
      }

      if (tools === undefined) {
        logger.warn("knowledge.tools_missing", { effect: "no tool is advertised" });
        return ok(undefined);
      }
      const registrations: ToolRegistration[] = [
        {
          kind: "capability",
          def: advertisedSkillsDef(),
          key: KnowledgeSkillsKey,
          policy: { skill_view: { risk: "read" }, skill_manage: WRITE_TOOL_POLICY },
        },
      ];
      // 메모리를 끈 채 시작하면 `memory_manage`를 광고하지 않는다(`l2.knowledge.memory.enabled`는 재시작 없이는 도구 집합을 바꾸지 않는다)
      if (readKnowledgeSettings(options.settings.layers(undefined)).memory.enabled) {
        registrations.push({
          kind: "capability",
          def: KnowledgeMemory,
          key: KnowledgeMemoryKey,
          policy: { memory_manage: WRITE_TOOL_POLICY },
        });
      }
      const unregisters: (() => void)[] = [];
      for (const registration of registrations) {
        const registered = tools.register(registration);
        if (!registered.ok) {
          for (const unregister of unregisters.toReversed()) unregister();
          return err({ reason: registered.error.kind, cause: registered.error });
        }
        unregisters.push(registered.value);
      }
      g.onDispose(() => {
        for (const unregister of unregisters) unregister();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
