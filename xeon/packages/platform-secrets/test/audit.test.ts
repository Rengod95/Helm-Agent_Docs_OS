import { describe, expect, test } from "bun:test";
import {
  approvedRecord,
  commandHash,
  createAuditBus,
  deniedRecord,
  maskedRecord,
  usedRecord,
} from "../src/audit.ts";
import { APPROVAL_PER_USE, envCtx, httpCtx } from "./support/ctx.ts";
import { handleOf } from "./support/names.ts";
import { recordingLogger } from "./support/os.ts";

const HANDLE = handleOf("github-token");

describe("audit records (spec §3.9)", () => {
  test("commandHash is 16 hex chars of sha256 and stable", () => {
    expect(commandHash("gh api user")).toMatch(/^[0-9a-f]{16}$/);
    expect(commandHash("gh api user")).toBe(commandHash("gh api user"));
    expect(commandHash("gh api user")).not.toBe(commandHash("gh api users"));
  });

  test("used records carry host or command hash, never both", () => {
    const http = usedRecord({ handle: HANDLE, ctx: httpCtx(), leaseId: "sls_1", at: 5 });
    expect(http).toMatchObject({ host: "api.example.test", commandHash: null, at: 5 });
    const env = usedRecord({ handle: HANDLE, ctx: envCtx("gh api user"), leaseId: "sls_2", at: 6 });
    expect(env).toMatchObject({ host: null, commandHash: commandHash("gh api user") });
  });

  test("denied, approved and masked records have the F shapes", () => {
    expect(
      deniedRecord({
        handle: HANDLE,
        mode: "env",
        reason: "command_mismatch",
        ctx: envCtx("x"),
        at: 1,
      }),
    ).toEqual({
      type: "secret.denied",
      handle: HANDLE,
      mode: "env",
      reason: "command_mismatch",
      purpose: "bash:gh",
      toolCallId: "call_2",
      threadId: "thr_test",
      at: 1,
    });
    expect(
      approvedRecord({ handle: HANDLE, approval: APPROVAL_PER_USE, threadId: "thr_x", at: 2 }),
    ).toEqual({
      type: "secret.approved",
      handle: HANDLE,
      scope: "per-use",
      approvalId: "apr_test_1",
      expiresAt: null,
      threadId: "thr_x",
      at: 2,
    });
    expect(
      maskedRecord({ hits: [{ kind: "kv", count: 2 }], layer: "ops-log", threadId: null, at: 3 }),
    ).toEqual({
      type: "secret.masked",
      hits: [{ kind: "kv", count: 2 }],
      layer: "ops-log",
      threadId: null,
      at: 3,
    });
  });

  test("a throwing sink is logged by name only and does not block other sinks", () => {
    const logger = recordingLogger();
    const bus = createAuditBus({ logger });
    const seen: string[] = [];
    bus.onAudit(() => {
      throw new TypeError("contains hunter2hunter2");
    });
    bus.onAudit((record) => seen.push(record.type));
    bus.emit(maskedRecord({ hits: [], layer: "ops-log", threadId: null, at: 1 }));
    expect(seen).toEqual(["secret.masked"]);
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]?.event).toBe("secrets.audit.sink_failed");
    expect(JSON.stringify(logger.lines)).not.toContain("hunter2hunter2");
  });
});
