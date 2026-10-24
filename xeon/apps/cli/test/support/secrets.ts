import { wireError, type SecretListEntry } from "@xeon/contracts/wire";
import { secretName } from "./ids.ts";
import type { FakeHandlers } from "./fake-server.ts";
import type { Harness } from "./harness.ts";

// 가짜 비밀 관리 처리기. 맡긴 값 입력·열람 수단(Harness.outOfBand)을 호스트처럼 꺼내 쓴다.
// 값은 이 파일 안의 stored에만 둔다. 와이어 응답에는 싣지 않는다.

export interface FakeSecretStore {
  readonly handlers: FakeHandlers;
  /** 이름 → 저장된 값 바이트(시험이 검사하는 용도) */
  readonly stored: Map<string, Uint8Array>;
  /** 호스트가 source.read()로 받은 배열의 참조. CLI가 쓴 뒤 0으로 덮었는지 본다 */
  readonly received: Uint8Array[];
  readonly metaCalls: Record<string, unknown>[];
  readonly beginEntryCalls: Record<string, unknown>[];
}

export function fakeSecrets(
  harness: () => Harness,
  initial: readonly SecretListEntry[] = [],
  failures: { readonly remove?: Error } = {},
): FakeSecretStore {
  const entries = new Map<string, SecretListEntry>(initial.map((entry) => [entry.name, entry]));
  const stored = new Map<string, Uint8Array>();
  const received: Uint8Array[] = [];
  const metaCalls: Record<string, unknown>[] = [];
  const beginEntryCalls: Record<string, unknown>[] = [];
  const entryOf = (name: unknown): SecretListEntry => {
    const found = typeof name === "string" ? entries.get(name) : undefined;
    if (found === undefined) {
      throw wireError("internal", {
        details: { secret: { kind: "secret_missing", where: "meta" } },
      });
    }
    return found;
  };
  return {
    stored,
    received,
    metaCalls,
    beginEntryCalls,
    handlers: {
      "secret.list": (params) => ({
        secrets: Array.from(entries.values()).map((entry) =>
          params["meta"] === true ? entry : { name: entry.name, status: entry.status },
        ),
      }),
      "secret.meta": (params) => {
        metaCalls.push({ ...params });
        const current = entryOf(params["name"]);
        return { secret: current };
      },
      "secret.remove": (params) => {
        if (failures.remove !== undefined) throw failures.remove;
        const existed = entries.delete(String(params["name"]));
        return { removed: existed };
      },
      "secret.test": (params) => ({
        state: entries.has(String(params["name"])) ? "registered" : "missing",
      }),
      "secret.beginEntry": async (params) => {
        beginEntryCalls.push({ ...params });
        const name = String(params["name"]);
        const action = String(params["action"]);
        const { outOfBand } = harness();
        const offer = outOfBand.entries.find((o) => o.name === name && o.action === action);
        if (offer === undefined) return { started: false };
        const read = await offer.source.read();
        if (!read.ok) return { started: false };
        received.push(read.value);
        // 호스트는 값을 자기 쪽에 복사해 둔다. CLI 쪽 배열은 CLI가 덮는다
        stored.set(name, read.value.slice());
        if (!entries.has(name)) {
          entries.set(name, {
            name: secretName(name),
            status: "valid",
            meta: {
              name: secretName(name),
              desc: "새 비밀",
              provider: "sops",
              ref: `dev/${name.toUpperCase()}`,
              scope: "user",
              expiresAt: null,
              use: { modes: ["runtime-http"], tools: [], hosts: [] },
              approval: "none",
              ttlSeconds: 300,
              maxUses: 10,
            },
          });
        }
        return { started: true };
      },
      "secret.beginReveal": async (params) => {
        const { outOfBand, clock } = harness();
        const offer = outOfBand.reveals.find((o) => o.name === params["name"]);
        const value = stored.get(String(params["name"]));
        if (offer === undefined || value === undefined) return { started: false };
        if (clock.now() - offer.reauth.verifiedAt > 60_000) return { started: false };
        const bytes = value.slice();
        await offer.show({ bytes, text: () => new TextDecoder().decode(bytes) });
        bytes.fill(0);
        return { started: true };
      },
    },
  };
}
