import { describe, expect, test } from "bun:test";
import { CapabilityError, KnowledgeLedger, type Proposal } from "@fresnel/contracts/capabilities";
import type { ExtMethodResourceDef } from "@fresnel/ext-host";
import type { OrchestrationApi } from "@fresnel/orchestration-sdk";
import { registerSuggestMethods } from "../../src/methods.ts";
import type { LedgerReader } from "../../src/queue.ts";
import { fakeService } from "../support/unsafe.ts";

// 처리기 등록과 호출 값의 시험. `g`는 두 연산만 쓰는 대역이고, 기능은 `knowledge.ledger` 가짜 대기열이다.

function proposalOf(proposalId: string, createdAt: number, status: Proposal["status"]): Proposal {
  return {
    proposalId,
    createdAt,
    actor: { kind: "agent", sessionId: "session-1", agent: "main" },
    target: { kind: "memory", name: "user" },
    op: "memory.add",
    baseHash: null,
    status,
    preview: "+ 메모",
    scan: { rulesetVersion: "1", findings: [] },
  };
}

function setup(rows: readonly Proposal[]) {
  const handlers = new Map<string, ExtMethodResourceDef["handler"]>();
  const reads: string[] = [];
  const ledger: LedgerReader = {
    proposals: (input) => {
      reads.push(JSON.stringify(input));
      const statuses = input.statuses;
      const listed = rows.filter((row) => statuses === undefined || statuses.includes(row.status));
      return Promise.resolve({ proposals: listed });
    },
  };
  const g: Pick<OrchestrationApi<never>, "capability" | "registerMethod"> = {
    capability: (key) => fakeService(key, ledger),
    registerMethod: (verb, def) => {
      handlers.set(verb, (params, ctx) => def.handler(params, ctx));
    },
  };
  registerSuggestMethods(g);
  return { handlers, reads };
}

/** 주석의 글(예: `proposal.decide`가 호스트에서 한다)은 뺀다. 코드 줄만 본다 */
function codeOf(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/**");
    })
    .join("\n");
}

function callOf(): { threadId: null; callId: string; signal: AbortSignal; caller: "wire" } {
  return { threadId: null, callId: "call-1", signal: new AbortController().signal, caller: "wire" };
}

describe("suggest method handlers", () => {
  test("registers the list and count methods in that order", () => {
    const { handlers } = setup([]);
    expect([...handlers.keys()]).toEqual(["list", "count"]);
  });

  test("list returns the knowledge rows of the pending queue as the host list does", async () => {
    const { handlers, reads } = setup([
      proposalOf("knp_1", 100, "pending"),
      proposalOf("knp_2", 200, "applied"),
      proposalOf("knp_3", 300, "pending"),
    ]);
    const list = handlers.get("list");
    expect(list).toBeDefined();
    const result = await list?.({ status: ["pending"] }, callOf());
    expect(result).toMatchObject({
      proposals: [
        { source: "knowledge", id: "knp_3", status: "pending", createdAt: 300 },
        { source: "knowledge", id: "knp_1", status: "pending", createdAt: 100 },
      ],
      nextCursor: null,
      unavailable: [],
    });
    expect(reads).toEqual([JSON.stringify({ statuses: ["pending"], limit: 101 })]);
  });

  test("count returns the pending count and its cap flag", async () => {
    const { handlers } = setup([
      proposalOf("knp_1", 100, "pending"),
      proposalOf("knp_2", 200, "rejected"),
    ]);
    const count = handlers.get("count");
    expect(await count?.({}, callOf())).toEqual({ ok: true, count: 1, capped: false });
  });

  test("list reads the first page when the params cannot be read (the host has refused them before the handler)", async () => {
    const { handlers, reads } = setup([proposalOf("knp_1", 100, "pending")]);
    const result = await handlers.get("list")?.({ source: "knowledge" }, callOf());
    expect(result).toMatchObject({ proposals: [{ id: "knp_1" }], nextCursor: null });
    expect(reads).toEqual([JSON.stringify({ limit: 101 })]);
  });

  test("count reports unavailable when the ledger call fails with a capability error", async () => {
    const handlers = new Map<string, ExtMethodResourceDef["handler"]>();
    const ledger: LedgerReader = {
      proposals: () =>
        Promise.reject(
          new CapabilityError({
            capability: KnowledgeLedger.id,
            method: "proposals",
            code: "unavailable",
            message: "down",
            retryable: false,
          }),
        ),
    };
    const g: Pick<OrchestrationApi<never>, "capability" | "registerMethod"> = {
      capability: (key) => fakeService(key, ledger),
      registerMethod: (verb, def) => {
        handlers.set(verb, (params, ctx) => def.handler(params, ctx));
      },
    };
    registerSuggestMethods(g);
    expect(await handlers.get("count")?.({}, callOf())).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("suggest source boundary", () => {
  test("the plugin source never writes its own store, never decides, and never registers tools or commands", async () => {
    const files = ["index.ts", "manifest.ts", "methods.ts", "queue.ts"];
    const sources = await Promise.all(
      files.map(async (file) => ({
        file,
        text: await Bun.file(new URL(`../../src/${file}`, import.meta.url)).text(),
      })),
    );
    expect(
      sources.map(({ file, text }) => {
        const code = codeOf(text);
        return {
          file,
          writes: /pluginStore|\.commit\(|\.record\(|registerTool|registerCommand|\.post\(/.test(
            code,
          ),
          decides: /\bdecide\b/.test(code),
        };
      }),
    ).toEqual(files.map((file) => ({ file, writes: false, decides: false })));
  });
});
