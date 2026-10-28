import { err, ok } from "@xeon/contracts";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import type { SecretError, UseCtx, UseDecision } from "@xeon/contracts/services";
import type { SecretChecker } from "../secret-gate.ts";

// `xeon.secrets.check` 대역. 참조("secret://name") → 판정을 표로 받는다. 승인 증거(`ctx.approval`)가 있으면 allow를 낸다(L0.secrets.spec §4.2).

export interface FakeSecretChecker extends SecretChecker {
  /** check 호출 기록 */
  readonly calls: { readonly handle: SecretHandle; readonly ctx: UseCtx }[];
}

export function fakeSecretChecker(
  table: Readonly<Record<string, UseDecision | SecretError>>,
): FakeSecretChecker {
  const calls: FakeSecretChecker["calls"][number][] = [];
  return {
    calls,
    check: (handle, ctx) => {
      calls.push({ handle, ctx });
      const entry = table[handle];
      if (entry === undefined) {
        return Promise.resolve(err({ kind: "secret_missing", handle, where: "meta" }));
      }
      if (isDecision(entry)) {
        if (entry.kind === "needs_approval" && ctx.approval !== null) {
          return Promise.resolve(ok({ kind: "allow" }));
        }
        return Promise.resolve(ok(entry));
      }
      return Promise.resolve(err(entry));
    },
  };
}

function isDecision(value: UseDecision | SecretError): value is UseDecision {
  return value.kind === "allow" || value.kind === "needs_approval" || value.kind === "deny";
}
