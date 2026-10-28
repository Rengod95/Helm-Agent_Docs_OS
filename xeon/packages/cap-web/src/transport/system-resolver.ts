import { lookup } from "node:dns/promises";
import { attemptAsync, err, ok } from "@xeon/contracts";
import type { DnsResolver } from "../ports/resolver.ts";

/** 운영 DNS 해석기: OS 해석기로 모든 A/AAAA 주소를 얻는다. 연결 시점 재검증은 전송이 따로 한다 */
export function createSystemResolver(): DnsResolver {
  return {
    async resolve(host, signal) {
      if (signal.aborted) return err({ kind: "unresolvable", message: "aborted" });
      const looked = await attemptAsync(() => lookup(host, { all: true, order: "verbatim" }));
      if (!looked.ok) {
        const cause = looked.error.cause;
        return err({
          kind: "unresolvable",
          message: cause instanceof Error ? cause.message : "lookup failed",
        });
      }
      if (looked.value.length === 0) return err({ kind: "unresolvable", message: "no addresses" });
      return ok(looked.value.map((entry) => entry.address));
    },
  };
}
