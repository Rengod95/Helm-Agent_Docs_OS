import { describe, expect, test } from "bun:test";
import type { ApprovalEvidence } from "@xeon/contracts/services";
import {
  createMcpStartApprovals,
  mcpDefinitionHash,
  mcpStartContext,
  type McpStartDefinition,
} from "../src/mcp-start.ts";
import { memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// M3-REQ-58. 비밀 env MCP 서버의 기동 승인은 정의 해시마다 한 번이고, 정의가 바뀌면 다시 받는다.

const HANDLE = handleOf("search-api-key");

const DEF: McpStartDefinition = {
  serverId: "search",
  source: "mcpjson:project",
  command: "npx",
  args: ["-y", "search-mcp@1.2.0"],
  cwd: null,
  env: { REGION: "eu" },
  secretEnv: { SEARCH_API_KEY: HANDLE },
};

const BASE = { actor: "runtime", threadId: null, toolCallId: null, projectId: null } as const;

function evidence(id: string, scope: ApprovalEvidence["scope"] = "per-session"): ApprovalEvidence {
  return { approvalId: id, scope, grantedAt: 0, expiresAt: null };
}

describe("mcpDefinitionHash", () => {
  test("is stable across key order and changes with every part of the definition", () => {
    const same = mcpDefinitionHash({
      ...DEF,
      env: { REGION: "eu" },
      secretEnv: { SEARCH_API_KEY: HANDLE },
    });
    expect(same).toBe(mcpDefinitionHash(DEF));
    expect(mcpDefinitionHash(DEF)).toMatch(/^[0-9a-f]{64}$/);
    const variants: McpStartDefinition[] = [
      { ...DEF, command: "bunx" },
      { ...DEF, args: ["-y", "search-mcp@1.3.0"] },
      { ...DEF, args: [...DEF.args, "--flag"] },
      { ...DEF, cwd: "/work" },
      { ...DEF, env: { REGION: "us" } },
      { ...DEF, secretEnv: { SEARCH_API_KEY: handleOf("other-key") } },
      { ...DEF, secretEnv: { OTHER_NAME: HANDLE } },
      { ...DEF, source: "settings:user" },
    ];
    const hashes = new Set([mcpDefinitionHash(DEF), ...variants.map(mcpDefinitionHash)]);
    expect(hashes.size).toBe(variants.length + 1);
  });
});

describe("start approvals bound to the definition hash", () => {
  test("evidence is returned for the same definition and dropped when the definition changes", () => {
    const clock = manualClock();
    const approvals = createMcpStartApprovals(clock);
    expect(approvals.evidenceFor(DEF)).toBeNull();
    approvals.record(DEF, evidence("apr_1"));
    expect(approvals.evidenceFor({ ...DEF, env: { REGION: "eu" } })?.approvalId).toBe("apr_1");
    expect(approvals.evidenceFor({ ...DEF, args: ["-y", "search-mcp@2.0.0"] })).toBeNull();
    // 정의를 되돌리면 같은 승인이 다시 맞는다(해시가 같다)
    expect(approvals.evidenceFor(DEF)?.approvalId).toBe("apr_1");
    // 새 승인이 이전 것을 대체한다
    const changed = { ...DEF, args: ["-y", "search-mcp@2.0.0"] };
    approvals.record(changed, evidence("apr_2"));
    expect(approvals.evidenceFor(changed)?.approvalId).toBe("apr_2");
    expect(approvals.evidenceFor(DEF)).toBeNull();
    approvals.forget("search");
    expect(approvals.evidenceFor(changed)).toBeNull();
  });

  test("an expired approval is not returned", () => {
    const clock = manualClock();
    const approvals = createMcpStartApprovals(clock);
    approvals.record(DEF, { ...evidence("apr_1"), expiresAt: clock.now() + 1000 });
    expect(approvals.evidenceFor(DEF)).not.toBeNull();
    clock.advance(1000);
    expect(approvals.evidenceFor(DEF)).toBeNull();
  });
});

function setup() {
  const clock = manualClock();
  const secret = fakeValue(seededRandom(5), 24, true);
  const service = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [
      {
        meta: metaOf({
          name: "search-api-key",
          ref: "dev/SEARCH_API_KEY",
          modes: ["env"],
          tools: ["mcp.start:*"],
          commands: ["mcp:search"],
          approval: "per-use",
        }),
        value: secret,
      },
    ],
  });
  return { clock, service, approvals: createMcpStartApprovals(clock) };
}

describe("secret env lease for MCP server start", () => {
  test("one approval opens the lease on every start while the definition is unchanged, a changed definition needs approval again", async () => {
    const { service, approvals } = setup();
    // 승인 전: 거부
    const before = await service.withEnv(
      HANDLE,
      mcpStartContext(DEF, BASE, approvals.evidenceFor(DEF)),
    );
    expect(before.ok).toBe(false);
    if (!before.ok)
      expect(before.error).toMatchObject({ kind: "denied", reason: "approval_missing" });

    approvals.record(DEF, evidence("apr_1"));
    // 같은 정의로 두 번 기동: 둘 다 같은 승인으로 열린다(일반 env 모드의 실행마다 승인과 다르다)
    const first = await service.withEnv(
      HANDLE,
      mcpStartContext(DEF, BASE, approvals.evidenceFor(DEF)),
    );
    const second = await service.withEnv(
      HANDLE,
      mcpStartContext(DEF, BASE, approvals.evidenceFor(DEF)),
    );
    expect([first.ok, second.ok]).toEqual([true, true]);

    // 정의가 바뀌면 증거가 없어 다시 거부된다
    const changed = { ...DEF, args: ["-y", "search-mcp@2.0.0"] };
    const after = await service.withEnv(
      HANDLE,
      mcpStartContext(changed, BASE, approvals.evidenceFor(changed)),
    );
    expect(after.ok).toBe(false);
    if (!after.ok)
      expect(after.error).toMatchObject({ kind: "denied", reason: "approval_missing" });
  });

  test("the start context only fits a meta that allows mcp.start and the server command line", async () => {
    const { service } = setup();
    const other = { ...DEF, serverId: "other" };
    const denied = await service.withEnv(HANDLE, mcpStartContext(other, BASE, evidence("apr_9")));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatchObject({ kind: "denied" });
  });

  test("an ordinary env call (not an MCP start) still needs per-use evidence", async () => {
    const clock = manualClock();
    const service = memorySecrets({
      clock,
      scheduler: clock,
      ids: fixedLocalIds(),
      secrets: [
        {
          meta: metaOf({
            name: "search-api-key",
            ref: "dev/SEARCH_API_KEY",
            modes: ["env"],
            tools: ["bash:*"],
            commands: ["gh api *"],
          }),
          value: fakeValue(seededRandom(6), 24, true),
        },
      ],
    });
    const result = await service.withEnv(HANDLE, {
      ...BASE,
      purpose: "bash:gh",
      target: { kind: "command", argv0: "gh", commandLine: "gh api user" },
      approval: evidence("apr_1", "per-session"),
    });
    expect(result.ok).toBe(false);
  });
});
