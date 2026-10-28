import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { secretRef } from "@xeon/contracts/capabilities";
import type { SecretError, UseCtx } from "@xeon/contracts/services";
import { createSecretServiceHeaders, type LeasingSecrets } from "../src/index.ts";

const signal = new AbortController().signal;

interface Leased {
  readonly handle: string;
  readonly ctx: UseCtx;
  disposed: boolean;
}

function fakeService(outcomes: Readonly<Record<string, SecretError | string>>) {
  const leased: Leased[] = [];
  const service: LeasingSecrets = {
    lease(handle, ctx) {
      const outcome = outcomes[handle];
      if (outcome === undefined) {
        return Promise.resolve(err({ kind: "secret_missing", handle, where: "meta" }));
      }
      if (typeof outcome !== "string") return Promise.resolve(err(outcome));
      const record: Leased = { handle, ctx, disposed: false };
      leased.push(record);
      return Promise.resolve(
        ok({
          use: async (fn) =>
            ok(await fn({ bytes: new TextEncoder().encode(outcome), text: () => outcome })),
          dispose: () => {
            record.disposed = true;
          },
        }),
      );
    },
  };
  return { service, leased };
}

describe("SecretService header adapter", () => {
  test("leases in runtime-http mode, reads the value once and disposes", async () => {
    const { service, leased } = fakeService({ "secret://auth": "Bearer abc12345" });
    const headers = createSecretServiceHeaders(service);
    const resolved = await headers.resolveHeaders({
      server: "remote",
      refs: { Authorization: "secret://auth" },
      target: { host: "mcp.example.com", port: 8443 },
      signal,
    });
    expect(resolved).toEqual({ ok: true, value: { Authorization: "Bearer abc12345" } });
    expect(leased[0]?.disposed).toBe(true);
    expect(leased[0]?.ctx).toMatchObject({
      mode: "runtime-http",
      purpose: "mcp.header:remote",
      target: { kind: "host", host: "mcp.example.com", port: 8443 },
      actor: "runtime",
    });
  });

  test("maps secret errors to the port's error kinds", async () => {
    const { service } = fakeService({
      "secret://denied": {
        kind: "denied",
        handle: secretRef("denied"),
        reason: "approval_missing",
      },
    });
    const headers = createSecretServiceHeaders(service);
    const request = (ref: string) =>
      headers.resolveHeaders({
        server: "s",
        refs: { H: ref },
        target: { host: "h", port: null },
        signal,
      });
    expect(await request("secret://absent")).toEqual({
      ok: false,
      error: { kind: "secret_missing", ref: "secret://absent" },
    });
    expect(await request("secret://denied")).toEqual({
      ok: false,
      error: { kind: "secret_denied", ref: "secret://denied" },
    });
    expect(await request("not-a-ref")).toEqual({
      ok: false,
      error: { kind: "secret_missing", ref: "not-a-ref" },
    });
  });
});
