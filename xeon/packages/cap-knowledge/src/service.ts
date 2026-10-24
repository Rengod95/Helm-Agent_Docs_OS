import { err, ok, type Result } from "@xeon/contracts";
import {
  KnowledgeLedger,
  KnowledgeSkills,
  type CapabilityApi,
  type CapabilityId,
} from "@xeon/contracts/capabilities";
import { failure, toCapabilityError, type KnowledgeFailure } from "./errors.ts";
import { createChangeExecutor } from "./ledger/change.ts";
import { recoverPrepared, type RecoverReport } from "./ledger/recover.ts";
import { createLedgerRuntime } from "./ledger/service.ts";
import { createSkills, type SkillsDeps, type SkillsRuntime } from "./skills/service.ts";
import type { ReindexResult } from "./skills/reindex.ts";

// 능력별 API 객체를 조립한다. 묶음(KnowledgeService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 능력마다 한다
// (L2.readme §5.6). 이 단계(KN.1)가 제공하는 능력은 knowledge.skills(읽기)와 knowledge.ledger다.

export interface KnowledgeDeps extends SkillsDeps {
  /** `xeon.secrets` 마스킹 등록부 판정. 서비스가 없으면 undefined */
  readonly containsKnown: ((text: string) => boolean) | undefined;
}

export interface KnowledgeRuntime {
  readonly skillsApi: CapabilityApi<typeof KnowledgeSkills>;
  readonly ledgerApi: CapabilityApi<typeof KnowledgeLedger>;
  readonly skills: SkillsRuntime;
  /** 시작 시 복구와 재색인(spec §4.4.3) */
  startup(): Promise<
    Result<{ recovered: RecoverReport; reindexed: ReindexResult }, KnowledgeFailure>
  >;
}

/** 안쪽 Result를 서비스 경계 규약(실패는 CapabilityError로 거부)에 맞춘다 */
async function settled<T>(
  capability: CapabilityId,
  method: string,
  work: Result<T, KnowledgeFailure> | Promise<Result<T, KnowledgeFailure>>,
): Promise<T> {
  const result = await work;
  if (result.ok) return result.value;
  throw toCapabilityError(capability, method, result.error);
}

function notYet(capability: CapabilityId, method: string, task: string): Promise<never> {
  return settled(
    capability,
    method,
    err(
      failure(
        "unsupported",
        `${capability}.${method} is not available yet (L2.knowledge.plan ${task})`,
      ),
    ),
  );
}

export function createKnowledgeRuntime(deps: KnowledgeDeps): KnowledgeRuntime {
  const skills = createSkills(deps);
  const executor = createChangeExecutor(deps);
  const ledger = createLedgerRuntime({ ...deps, executor, containsKnown: deps.containsKnown });
  const skillsId = KnowledgeSkills.id;
  const ledgerId = KnowledgeLedger.id;

  const skillsApi: CapabilityApi<typeof KnowledgeSkills> = {
    list: (input, options) => settled(skillsId, "list", skills.list(input, options)),
    view: (input, options) => settled(skillsId, "view", skills.view(input, options)),
    reindex: async () => {
      const result = await skills.reindex();
      return settled(
        skillsId,
        "reindex",
        result.ok
          ? ok({
              added: result.value.added,
              changed: result.value.changed,
              removed: result.value.removed,
              indexVersion: result.value.indexVersion,
            })
          : result,
      );
    },
    create: () => notYet(skillsId, "create", "K3"),
    edit: () => notYet(skillsId, "edit", "K3"),
    patch: () => notYet(skillsId, "patch", "K3"),
    writeFile: () => notYet(skillsId, "writeFile", "K3"),
    remove: () => notYet(skillsId, "remove", "K3"),
    manage: () => notYet(skillsId, "manage", "K3"),
  };

  const ledgerApi: CapabilityApi<typeof KnowledgeLedger> = {
    list: (input) => settled(ledgerId, "list", ledger.list(input)),
    show: (input) => settled(ledgerId, "show", ledger.show(input)),
    rollback: (input, options) => settled(ledgerId, "rollback", ledger.rollback(input, options)),
    scan: (input) => Promise.resolve(ledger.scan(input)),
    proposals: (input) => Promise.resolve(ledger.proposals(input)),
    decide: (input) => settled(ledgerId, "decide", ledger.decide(input)),
  };

  return {
    skillsApi,
    ledgerApi,
    skills,
    startup: async () => {
      const recovered = await recoverPrepared(deps);
      if (!recovered.ok) return recovered;
      const reindexed = await skills.reindex();
      if (!reindexed.ok) return reindexed;
      return ok({ recovered: recovered.value, reindexed: reindexed.value });
    },
  };
}
