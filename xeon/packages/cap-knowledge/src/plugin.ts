import { err, ok } from "@xeon/contracts";
import {
  KnowledgeLedgerKey,
  KnowledgeSkills,
  KnowledgeSkillsKey,
  type AnyCapabilityDef,
} from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type { ExtensionEntry, PortKey } from "@xeon/contracts/extensions";
import {
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
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_OWNER } from "./migrations.ts";
import { createKnowledgeRuntime, type KnowledgeDeps } from "./service.ts";
import { readKnowledgeSettings, type KnowledgeSettingsSource } from "./settings.ts";
import { resolveSkillRoots } from "./skills/roots.ts";

// L2.knowledge.plan K2 조립. 구현 패키지(platform-store, platform-os, core-tools)를 import하지 않고 F 서비스 인터페이스를
// 포트로만 받는다. Cordis는 import하지 않는다(DR-11).

const SecretsPortKey: PortKey<SecretService> = { name: SecretServiceName };
const ToolsPortKey: PortKey<ToolService> = { name: ToolServiceName };

/**
 * KN.1이 L1.tools에 올리는 `knowledge.skills` 도구 이름. 쓰기 도구(skill_manage)는 K3의 쓰기 경로가 끝날 때까지 광고하지
 * 않는다(plan §1.1 순서 2, §3 순서 문단): 승인 없는 쓰기 경로가 한 번도 배포되지 않게 하기 위해서다.
 */
export const IMPLEMENTED_SKILL_TOOLS: readonly string[] = ["skill_view"];

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
      const logger = os.logger("knowledge");

      const migrated = store.migrations.apply(KNOWLEDGE_MIGRATIONS);
      if (!migrated.ok) return err({ reason: migrated.error.kind, cause: migrated.error });

      const deps: KnowledgeDeps = {
        fs: options.fs ?? createNodeFs(),
        db: store.scoped(KNOWLEDGE_OWNER),
        blobs: store,
        clock: os.time.clock,
        ids: options.ids,
        logger,
        settings: (threadId) => readKnowledgeSettings(options.settings.layers(threadId)),
        roots: () => {
          const settings = readKnowledgeSettings(options.settings.layers(undefined));
          return resolveSkillRoots({
            dataDir: os.dirs.data,
            projectDir: exec?.cwd,
            projectSkills: settings.skills.projectSkills,
            paths: settings.skills.paths,
            extension: options.extensionSkillRoots?.() ?? [],
          });
        },
        containsKnown:
          secrets === undefined ? undefined : (text) => secrets.redactor.containsKnown(text),
      };
      const runtime = createKnowledgeRuntime(deps);
      host.provide(KnowledgeSkillsKey, runtime.skillsApi);
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
      const registrations: readonly ToolRegistration[] = [
        {
          kind: "capability",
          def: advertisedSkillsDef(),
          key: KnowledgeSkillsKey,
          policy: { skill_view: { risk: "read" } },
        },
      ];
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
