import { createHash } from "node:crypto";
import {
  CapabilityError,
  KnowledgeLedgerKey,
  KnowledgeMemoryKey,
  KnowledgeSearchKey,
  KnowledgeSkills,
  KnowledgeSkillsKey,
  type CallOptions,
  type CapabilityApi,
  type KnowledgeLedger,
  type KnowledgeMemory,
  type KnowledgeSearch,
  type WriteOutcome,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { hostOf, type ExtensionUnit } from "@xeon/ext-host";
import { partial, widen } from "./unsafe.ts";

// L2.knowledge의 시험 대역(L3.learning.plan §5 "L1-g·L2-d는 각 패키지 testing 서브패스의 가짜"; cap-knowledge에는 그 서브패스가 없어 이 패키지 test/ 안에 둔다).
// 같은 requestId의 두 번째 쓰기는 첫 결과를 돌려주고 효과를 늘리지 않는다(멱등).

interface FakeWrite {
  readonly method: string;
  readonly requestId: string | undefined;
  readonly approvalSource: string | undefined;
  readonly approvalRef: string | undefined;
  readonly threadId: string | undefined;
  readonly scope: string | undefined;
}

export interface FakeKnowledge {
  readonly skills: Map<string, { description: string; body: string }>;
  readonly memory: { user: string[]; env: string[] };
  /** 쓰기 메서드 호출 전부(중복 포함) */
  readonly writes: FakeWrite[];
  /** 멱등 키마다 한 번 센 새 효과 수 */
  effects(): number;
  readonly scans: string[];
  readonly rollbacks: string[];
  /** 모든 메서드 호출 수(읽기 포함). on 핸들러가 능력을 부르지 않는지 센다(ADR-0015) */
  calls(): number;
  /** 비어 있지 않으면 `ledger.scan`이 이 규칙으로 block 판정을 낸다 */
  scanBlocks: string[];
  /** 거짓이면 승인 증거를 믿지 않아 쓰기가 `queued`로 간다 */
  trustEvidence: boolean;
  /** 참이면 skills.view·memory.read가 `unavailable`로 거부한다 */
  down: boolean;
  /** 스킬과 메모리 전체의 해시. 파일이 바뀌지 않았는지 비교한다 */
  snapshot(): string;
  treeHash(name: string): string | undefined;
  memoryHash(store: "user" | "env"): string;
  unit(loadIndex: number): ExtensionUnit;
}

type AnyFn = (...args: readonly unknown[]) => unknown;

function isFn(value: unknown): value is AnyFn {
  return typeof value === "function";
}

/** 모든 메서드 호출을 센다 */
function counted<T extends Readonly<Record<string, unknown>>>(api: T, hit: () => void): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, member] of Object.entries<unknown>(api)) {
    wrapped[name] = isFn(member)
      ? (...args: readonly unknown[]) => {
          hit();
          return member(...args);
        }
      : member;
  }
  return widen(api, wrapped);
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const SCAN = { rulesetVersion: "1.0.0", findings: [] };

function failure(
  _capability: string,
  method: string,
  code: string,
  message: string,
): CapabilityError {
  return new CapabilityError({
    capability: KnowledgeSkills.id,
    method,
    code,
    message,
    retryable: false,
  });
}

export function fakeKnowledge(): FakeKnowledge {
  const skills = new Map<string, { description: string; body: string }>();
  const memory: { user: string[]; env: string[] } = { user: [], env: [] };
  const writes: FakeWrite[] = [];
  const results = new Map<string, WriteOutcome>();
  const scans: string[] = [];
  const rollbacks: string[] = [];
  let ledgerCounter = 0;
  let callCount = 0;
  const self: FakeKnowledge = {
    skills,
    memory,
    writes,
    effects: () => results.size,
    calls: () => callCount,
    scans,
    rollbacks,
    scanBlocks: [],
    trustEvidence: true,
    down: false,
    snapshot: () => JSON.stringify({ skills: [...skills.entries()], memory }),
    treeHash: (name) => {
      const skill = skills.get(name);
      return skill === undefined ? undefined : sha(`${skill.description}\n${skill.body}`);
    },
    memoryHash: (store) => sha(memory[store].join("\n")),
    unit: () => unit,
  };

  function record(
    method: string,
    input: { approval?: { source: string; ref: string }; scope?: string },
    options?: CallOptions,
  ): void {
    writes.push({
      scope: input.scope,
      method,
      requestId: options?.requestId,
      approvalSource: input.approval?.source,
      approvalRef: input.approval?.ref,
      threadId: options?.context?.threadId,
    });
  }

  /** 멱등 쓰기: 같은 키는 첫 결과를 돌려주고 효과를 늘리지 않는다 */
  function write(method: string, key: string | undefined, apply: () => WriteOutcome): WriteOutcome {
    const known = key === undefined ? undefined : results.get(key);
    if (known !== undefined) return known;
    if (!self.trustEvidence) {
      return {
        status: "queued",
        proposalId: "knp_00000000000000000000000001",
        scan: SCAN,
        indexChanged: false,
      };
    }
    const outcome = apply();
    results.set(key ?? `${method}:${String(results.size)}`, outcome);
    return outcome;
  }

  function applied(after: string): WriteOutcome {
    ledgerCounter += 1;
    return {
      status: "applied",
      ledgerId: `knl_${ledgerCounter.toString(32).toUpperCase().padStart(26, "0")}`,
      afterHash: after,
      approvedBy: "evidence",
      scan: SCAN,
      indexChanged: true,
    };
  }

  const memoryView = (store: "user" | "env") => ({
    store,
    entries: memory[store].map((text) => ({
      id: sha(text).slice(0, 12),
      text,
      chars: text.length,
    })),
    usedChars: 0,
    limitChars: 10_000,
    fileHash: self.memoryHash(store),
    writeBlocked: false,
  });

  const skillsApi = partial<CapabilityApi<typeof KnowledgeSkills>>({
    view: (input) => {
      if (self.down)
        return Promise.reject(failure("knowledge.skills", "view", "unavailable", "down"));
      const skill = skills.get(input.name);
      if (skill === undefined)
        return Promise.reject(failure("knowledge.skills", "view", "not_found", "no such skill"));
      return Promise.resolve({
        name: input.name,
        scope: "user",
        description: skill.description,
        content: skill.body,
        files: [],
        treeHash: self.treeHash(input.name) ?? "",
        createdBy: "agent",
      });
    },
    create: (input, options) => {
      record("create", input, options);
      if (skills.has(input.name))
        return Promise.reject(failure("knowledge.skills", "create", "name_conflict", "exists"));
      return Promise.resolve(
        write("create", options?.requestId, () => {
          skills.set(input.name, { description: input.description, body: input.body });
          return applied(self.treeHash(input.name) ?? "");
        }),
      );
    },
    patch: (input, options) => {
      record("patch", input, options);
      const skill = skills.get(input.name);
      if (skill === undefined)
        return Promise.reject(failure("knowledge.skills", "patch", "not_found", "no such skill"));
      if (self.treeHash(input.name) !== input.baseHash) {
        return Promise.reject(failure("knowledge.skills", "patch", "base_stale", "stale"));
      }
      return Promise.resolve(
        write("patch", options?.requestId, () => {
          let body = skill.body;
          for (const edit of input.edits) body = body.replace(edit.oldText, edit.newText);
          skills.set(input.name, { ...skill, body });
          return applied(self.treeHash(input.name) ?? "");
        }),
      );
    },
    writeFile: (input, options) => {
      record("writeFile", input, options);
      return Promise.resolve(
        write("writeFile", options?.requestId, () => applied(sha(input.content))),
      );
    },
    remove: (input, options) => {
      record("remove", input, options);
      return Promise.resolve(
        write("remove", options?.requestId, () => {
          skills.delete(input.name);
          return applied(sha("archived"));
        }),
      );
    },
  });

  const memoryApi = partial<CapabilityApi<typeof KnowledgeMemory>>({
    read: (input) => {
      if (self.down)
        return Promise.reject(failure("knowledge.memory", "read", "unavailable", "down"));
      return Promise.resolve({ stores: (input.stores ?? ["user", "env"]).map(memoryView) });
    },
    add: (input, options) => {
      record("memory.add", input, options);
      return Promise.resolve({
        outcome: write("memory.add", options?.requestId, () => {
          memory[input.store].push(input.text);
          return applied(self.memoryHash(input.store));
        }),
        view: memoryView(input.store),
      });
    },
    replace: (input, options) => {
      record("memory.replace", input, options);
      return Promise.resolve({
        outcome: write("memory.replace", options?.requestId, () => {
          const index = memory[input.store].findIndex(
            (text) => sha(text).slice(0, 12) === input.entryId,
          );
          if (index >= 0) memory[input.store][index] = input.text;
          return applied(self.memoryHash(input.store));
        }),
        view: memoryView(input.store),
      });
    },
    remove: (input, options) => {
      record("memory.remove", input, options);
      return Promise.resolve({
        outcome: write("memory.remove", options?.requestId, () => {
          memory[input.store] = memory[input.store].filter(
            (text) => sha(text).slice(0, 12) !== input.entryId,
          );
          return applied(self.memoryHash(input.store));
        }),
        view: memoryView(input.store),
      });
    },
  });

  const searchApi = partial<CapabilityApi<typeof KnowledgeSearch>>({
    query: (input) => {
      const words = input.query.toLowerCase().split(/\s+/u);
      const hits = [...skills.entries()]
        .filter(([name]) => words.some((word) => name.includes(word) && word.length > 2))
        .map(([name, skill]) => ({
          kind: "skill" as const,
          ref: name,
          title: name,
          snippet: skill.description,
        }));
      return Promise.resolve({ hits, path: "like" as const });
    },
  });

  const ledgerApi = partial<CapabilityApi<typeof KnowledgeLedger>>({
    scan: (input) => {
      scans.push(input.text);
      return Promise.resolve({
        rulesetVersion: "1.0.0",
        findings: self.scanBlocks.map((rule) => ({ rule, severity: "block" as const })),
      });
    },
    rollback: (input, options) => {
      rollbacks.push(options?.requestId ?? "");
      return Promise.resolve(applied(sha(`rollback:${input.ledgerId}`)));
    },
  });

  const manifest = defineManifest({
    schemaVersion: 1,
    name: "fake-knowledge",
    version: "0.1.0",
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
    provides: [
      { id: "knowledge.skills", version: "1.0.0" },
      { id: "knowledge.memory", version: "1.0.0" },
      { id: "knowledge.search", version: "1.0.0" },
      { id: "knowledge.ledger", version: "1.0.0" },
    ],
    trust: { level: "builtin" },
  });
  const hit = (): void => {
    callCount += 1;
  };
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, {}, (g) => {
      const host = hostOf(g);
      host.provide(KnowledgeSkillsKey, counted(skillsApi, hit));
      host.provide(KnowledgeMemoryKey, counted(memoryApi, hit));
      host.provide(KnowledgeSearchKey, counted(searchApi, hit));
      host.provide(KnowledgeLedgerKey, counted(ledgerApi, hit));
    });
  };
  const unit: ExtensionUnit = { manifest, entry, loadIndex: 0, builtin: true };
  return self;
}
