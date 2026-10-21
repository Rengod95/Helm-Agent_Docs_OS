import type { ApprovalEvidence, UseCtx } from "@xeon/contracts/services";

export const APPROVAL_PER_USE: ApprovalEvidence = {
  approvalId: "apr_test_1",
  scope: "per-use",
  grantedAt: 0,
  expiresAt: null,
};

export const APPROVAL_PER_SESSION: ApprovalEvidence = {
  approvalId: "apr_test_2",
  scope: "per-session",
  grantedAt: 0,
  expiresAt: null,
};

export function httpCtx(overrides: Partial<UseCtx> = {}): UseCtx {
  return {
    mode: "runtime-http",
    purpose: "http.request",
    target: { kind: "host", host: "api.example.test", port: 443 },
    actor: "runtime",
    threadId: "thr_test",
    toolCallId: "call_1",
    projectId: null,
    approval: null,
    ...overrides,
  };
}

export function envCtx(commandLine: string, overrides: Partial<UseCtx> = {}): UseCtx {
  const argv0 = commandLine.split(" ")[0] ?? "";
  return {
    mode: "env",
    purpose: "bash:gh",
    target: { kind: "command", argv0, commandLine },
    actor: "agent",
    threadId: "thr_test",
    toolCallId: "call_2",
    projectId: null,
    approval: APPROVAL_PER_USE,
    ...overrides,
  };
}
