import { err, ok, type Result } from "@xeon/contracts";
import {
  KnowledgeLedger,
  KnowledgeSkills,
  type CapabilityApi,
  type CapabilityId,
} from "@xeon/contracts/capabilities";
import { createProposalQueue, type Replayer, type Replayers } from "./approval/queue.ts";
import { failure, toCapabilityError, type KnowledgeFailure } from "./errors.ts";
import { createChangeExecutor } from "./ledger/change.ts";
import { recoverPrepared, type RecoverReport } from "./ledger/recover.ts";
import { createLedgerRuntime } from "./ledger/service.ts";
import type { WriteApprovals } from "./ports/approvals.ts";
import { createSkills, type SkillsDeps, type SkillsRuntime } from "./skills/service.ts";
import { createWriter, type Writer } from "./write/pipeline.ts";
import type { ReindexResult } from "./skills/reindex.ts";

// 능력별 API 객체를 조립한다. 묶음(KnowledgeService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 능력마다 한다
// (L2.readme §5.6). 이 단계(KN.1)가 제공하는 능력은 knowledge.skills(읽기)와 knowledge.ledger다.

export interface KnowledgeDeps extends SkillsDeps {
  /** `xeon.secrets` 마스킹 등록부 판정. 서비스가 없으면 undefined */
  readonly containsKnown: ((text: string) => boolean) | undefined;
  /** 사람에게 쓰기 승인을 묻는 포트(`xeon.approvals`). 없으면 묻는 대신 제안 대기열로 보낸다 */
  readonly approvals: WriteApprovals | undefined;
}

export interface KnowledgeRuntime {
  readonly skillsApi: CapabilityApi<typeof KnowledgeSkills>;
  readonly ledgerApi: CapabilityApi<typeof KnowledgeLedger>;
  readonly skills: SkillsRuntime;
  /** 쓰기 경로의 게이트(spec §4.4.1 6단계). 스킬·메모리 쓰기와 롤백이 같은 경로를 쓴다 */
  readonly writer: Writer;
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

function notYetReplay(task: string): Replayer {
  return () =>
    Promise.resolve(
      err(
        failure(
          "unsupported",
          `this proposal method is not available yet (L2.knowledge.plan ${task})`,
        ),
      ),
    );
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
  const writer = createWriter({ ...deps, executor });
  // 승인된 제안을 다시 실행하는 메서드별 함수. 스킬·메모리 쓰기(K3, K4)가 들어오기 전에는 롤백만 있다
  const replayers: Replayers = {
    "skills.create": notYetReplay("K3"),
    "skills.edit": notYetReplay("K3"),
    "skills.patch": notYetReplay("K3"),
    "skills.writeFile": notYetReplay("K3"),
    "skills.remove": notYetReplay("K3"),
    "memory.add": notYetReplay("K4"),
    "memory.replace": notYetReplay("K4"),
    "memory.remove": notYetReplay("K4"),
    "memory.manage": notYetReplay("K4"),
    "ledger.rollback": (call) => rollbackReplay(call),
  };
  const queue = createProposalQueue({ ...deps, replayers });
  const ledger = createLedgerRuntime({
    ...deps,
    writer,
    queue,
    containsKnown: deps.containsKnown,
  });
  const rollbackReplay: Replayer = (call) => ledger.replayRollback(call);
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
    proposals: (input) => settled(ledgerId, "proposals", ledger.proposals(input)),
    decide: (input, options) => settled(ledgerId, "decide", ledger.decide(input, options)),
  };

  return {
    skillsApi,
    ledgerApi,
    skills,
    writer,
    startup: async () => {
      const recovered = await recoverPrepared(deps);
      if (!recovered.ok) return recovered;
      const expired = queue.expire();
      if (!expired.ok) return expired;
      const reindexed = await skills.reindex();
      if (!reindexed.ok) return reindexed;
      return ok({ recovered: recovered.value, reindexed: reindexed.value });
    },
  };
}
