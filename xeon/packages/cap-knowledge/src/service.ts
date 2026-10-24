import { ok, type Result } from "@xeon/contracts";
import {
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSkills,
  type CapabilityApi,
  type CapabilityId,
} from "@xeon/contracts/capabilities";
import { createProposalQueue, type Replayers } from "./approval/queue.ts";
import { toCapabilityError, type KnowledgeFailure } from "./errors.ts";
import { createChangeExecutor } from "./ledger/change.ts";
import { recoverPrepared, type RecoverReport } from "./ledger/recover.ts";
import { createLedgerRuntime } from "./ledger/service.ts";
import { createMemory, type MemoryRuntime } from "./memory/store.ts";
import type { WriteApprovals } from "./ports/approvals.ts";
import { createSkills, type SkillsDeps, type SkillsRuntime } from "./skills/service.ts";
import { createSkillWrites } from "./skills/write.ts";
import { createWriter, type Writer } from "./write/pipeline.ts";
import type { ReindexResult } from "./skills/reindex.ts";

// 능력별 API 객체를 조립한다. 묶음(KnowledgeService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 능력마다 한다
// (L2.readme §5.6). 이 단계(KN.3)가 제공하는 능력은 knowledge.skills(읽기와 쓰기), knowledge.memory, knowledge.ledger다.

export interface KnowledgeDeps extends SkillsDeps {
  /** `xeon.secrets` 마스킹 등록부 판정. 서비스가 없으면 undefined */
  readonly containsKnown: ((text: string) => boolean) | undefined;
  /** 사람에게 쓰기 승인을 묻는 포트(`xeon.approvals`). 없으면 묻는 대신 제안 대기열로 보낸다 */
  readonly approvals: WriteApprovals | undefined;
  /** 메모리 파일 디렉터리 `<사용자 데이터>/memory`(spec §4.1) */
  readonly memoryDir: string;
}

export interface KnowledgeRuntime {
  readonly skillsApi: CapabilityApi<typeof KnowledgeSkills>;
  readonly memoryApi: CapabilityApi<typeof KnowledgeMemory>;
  readonly ledgerApi: CapabilityApi<typeof KnowledgeLedger>;
  readonly skills: SkillsRuntime;
  readonly memory: MemoryRuntime;
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

export function createKnowledgeRuntime(deps: KnowledgeDeps): KnowledgeRuntime {
  const skills = createSkills(deps);
  const executor = createChangeExecutor(deps);
  const writer = createWriter({ ...deps, executor });
  const skillWrites = createSkillWrites({ ...deps, writer });
  const memory = createMemory({ ...deps, writer });
  // 승인된 제안을 다시 실행하는 메서드별 함수. 롤백은 원장 서비스가 만든 뒤에 채운다(대기열과 서로 참조한다)
  const replayers: { -readonly [K in keyof Replayers]: Replayers[K] } = {
    ...skillWrites.replayers,
    ...memory.replayers,
    "ledger.rollback": (call) => ledger.replayRollback(call),
  };
  const queue = createProposalQueue({ ...deps, replayers });
  const ledger = createLedgerRuntime({
    ...deps,
    writer,
    queue,
    containsKnown: deps.containsKnown,
  });
  const skillsId = KnowledgeSkills.id;
  const memoryId = KnowledgeMemory.id;
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
    create: (input, options) => settled(skillsId, "create", skillWrites.create(input, options)),
    edit: (input, options) => settled(skillsId, "edit", skillWrites.edit(input, options)),
    patch: (input, options) => settled(skillsId, "patch", skillWrites.patch(input, options)),
    writeFile: (input, options) =>
      settled(skillsId, "writeFile", skillWrites.writeFile(input, options)),
    remove: (input, options) => settled(skillsId, "remove", skillWrites.remove(input, options)),
    manage: (input, options) => settled(skillsId, "manage", skillWrites.manage(input, options)),
  };

  const memoryApi: CapabilityApi<typeof KnowledgeMemory> = {
    read: (input, options) => settled(memoryId, "read", memory.read(input, options)),
    add: (input, options) => settled(memoryId, "add", memory.add(input, options)),
    replace: (input, options) => settled(memoryId, "replace", memory.replace(input, options)),
    remove: (input, options) => settled(memoryId, "remove", memory.remove(input, options)),
    manage: (input, options) => settled(memoryId, "manage", memory.manage(input, options)),
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
    memoryApi,
    ledgerApi,
    skills,
    memory,
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
