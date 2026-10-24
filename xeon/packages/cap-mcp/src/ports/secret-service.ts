import { eachAsync, err, ok, type Result } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import type { SecretError, SecretLease, UseCtx } from "@xeon/contracts/services";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import type { McpHeaderRequest, McpHeaderSecrets, McpSecretError } from "./secrets.ts";

// `xeon.secrets`(SecretService)를 `McpHeaderSecrets`로 감싼다. HTTP·SSE 서버 헤더의 `secret://` 값을 요청 직전에
// runtime-http 모드 lease로 열어 값만 헤더에 넣고 바로 닫는다(L0.secrets.spec §4.3).

/** `SecretService.lease`의 부분형. 이 패키지는 lease에서 `use`와 `dispose`만 쓴다 */
export interface LeasingSecrets {
  lease(
    handle: SecretHandle,
    ctx: UseCtx,
  ): Promise<Result<Pick<SecretLease, "use" | "dispose">, SecretError>>;
}

export function createSecretServiceHeaders(secrets: LeasingSecrets): McpHeaderSecrets {
  return {
    async resolveHeaders(
      request: McpHeaderRequest,
    ): Promise<Result<Readonly<Record<string, string>>, McpSecretError>> {
      const resolved: Record<string, string> = {};
      const failed = await eachAsync<[string, string], McpSecretError>(
        Object.entries(request.refs),
        async ([header, ref]) => {
          const parsed = parseSecretRef(ref);
          if (!parsed.ok) return { value: { kind: "secret_missing", ref } };
          const leased = await secrets.lease(parsed.value.handle, {
            mode: "runtime-http",
            purpose: `mcp.header:${request.server}`,
            target: { kind: "host", host: request.target.host, port: request.target.port },
            actor: "runtime",
            threadId: null,
            toolCallId: null,
            projectId: null,
            approval: null,
          });
          if (!leased.ok) {
            const reason = leased.error.kind;
            if (reason === "secret_missing") return { value: { kind: "secret_missing", ref } };
            if (reason === "denied") return { value: { kind: "secret_denied", ref } };
            return { value: { kind: "secret_unavailable", ref } };
          }
          const lease = leased.value;
          const used = await lease.use((value) => value.text());
          lease.dispose();
          if (!used.ok) return { value: { kind: "secret_unavailable", ref } };
          resolved[header] = used.value;
          return undefined;
        },
      );
      return failed === undefined ? ok(resolved) : err(failed.value);
    },
  };
}
