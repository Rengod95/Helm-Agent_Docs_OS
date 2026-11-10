import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  createRemoteAdapter,
  type RemoteRequester,
} from "../../../src/app/remote/remote-adapter.ts";
import type {
  RemoteAdapter,
  RemoteDevice,
  RemoteStatus,
} from "../../../src/app/remote/remote-types.ts";
import type { CommandError } from "../../../src/views/commands.ts";

// 원격 접속 어댑터를 가짜 요청 자리 위에서 돌린다. 요청 자리는 정해 둔 답 하나를 주고, 보낸 메서드와 인자를 쌓는다.
// 꺼짐은 `rejected.issue`가 `remote-off`로 온 것으로 본다. 나머지 실패는 `failed`로 모이고, 응답 모양이 틀리면 `bad-reply`다.
// 값은 `toEqual`로 비교한다.

const STATUS: RemoteStatus = {
  enabled: true,
  state: "starting",
  loopbackPort: null,
  tlsPort: null,
  hosts: [],
  fingerprint: "cd34".repeat(16),
  certSource: "user",
  pushAvailable: false,
  error: null,
};

const OFF: CommandError = { kind: "rejected", code: null, issue: "remote-off" };

type Sent = { readonly method: string; readonly params: unknown };

/** 어댑터와, 그 어댑터가 보낸 요청 목록. 요청 자리는 언제나 `reply`로 답한다 */
function adapterReplying(reply: Result<unknown, CommandError>): {
  readonly adapter: RemoteAdapter;
  readonly sent: () => readonly Sent[];
} {
  const sent: Sent[] = [];
  const requester: RemoteRequester = {
    request: (method, params) => {
      sent.push({ method, params });
      return Promise.resolve(reply);
    },
  };
  return { adapter: createRemoteAdapter(requester), sent: () => [...sent] };
}

describe("remote adapter: calls and replies", () => {
  test("status sends the status method with empty params and reads the status", async () => {
    const { adapter, sent } = adapterReplying(ok(STATUS));
    expect(await adapter.status()).toEqual(ok(STATUS));
    expect(sent()).toEqual([{ method: "host.remote.status", params: {} }]);
  });

  test("setEnabled sends the flag and reads the status it gets back", async () => {
    const { adapter, sent } = adapterReplying(ok(STATUS));
    expect(await adapter.setEnabled(true)).toEqual(ok(STATUS));
    expect(sent()).toEqual([{ method: "host.remote.setEnabled", params: { enabled: true } }]);
  });

  test("pair reads the code and its expiry", async () => {
    const { adapter, sent } = adapterReplying(ok({ code: "481920", expiresAt: 1_800_000_300_000 }));
    expect(await adapter.pair()).toEqual(ok({ code: "481920", expiresAt: 1_800_000_300_000 }));
    expect(sent()).toEqual([{ method: "host.remote.pair", params: {} }]);
  });

  test("devices reads the list in the order the engine gave it", async () => {
    const device: RemoteDevice = {
      id: "d1",
      name: "Phone",
      kind: "web",
      createdAt: 1_800_000_000_000,
      lastSeenAt: null,
      address: null,
    };
    const { adapter, sent } = adapterReplying(ok({ devices: [device] }));
    expect(await adapter.devices()).toEqual(ok([device]));
    expect(sent()).toEqual([{ method: "host.remote.devices", params: {} }]);
  });

  test("revoke sends the id for one device and the all flag for every device", async () => {
    const one = adapterReplying(ok({ revoked: 1 }));
    expect(await one.adapter.revoke({ id: "d1" })).toEqual(ok({ revoked: 1 }));
    expect(one.sent()).toEqual([{ method: "host.remote.revoke", params: { id: "d1" } }]);

    const all = adapterReplying(ok({ revoked: 3 }));
    expect(await all.adapter.revoke({ all: true })).toEqual(ok({ revoked: 3 }));
    expect(all.sent()).toEqual([{ method: "host.remote.revoke", params: { all: true } }]);
  });
});

describe("remote adapter: errors", () => {
  const calls: readonly (readonly [string, (adapter: RemoteAdapter) => Promise<unknown>])[] = [
    ["status", (adapter) => adapter.status()],
    ["setEnabled", (adapter) => adapter.setEnabled(false)],
    ["pair", (adapter) => adapter.pair()],
    ["devices", (adapter) => adapter.devices()],
    ["revoke", (adapter) => adapter.revoke({ id: "d1" })],
  ];

  for (const [name, call] of calls) {
    test(`${name} maps the remote-off wire error to remote-off`, async () => {
      const { adapter } = adapterReplying(err(OFF));
      expect(await call(adapter)).toEqual(err({ kind: "remote-off" }));
    });

    test(`${name} keeps a bad reply as bad-reply`, async () => {
      const { adapter } = adapterReplying(ok({ unexpected: true }));
      expect(await call(adapter)).toEqual(err({ kind: "bad-reply" }));
    });

    test(`${name} maps a transport failure to failed without a message`, async () => {
      const { adapter } = adapterReplying(err({ kind: "offline" }));
      expect(await call(adapter)).toEqual(err({ kind: "failed", message: null }));
    });
  }

  test("a rejection keeps the host's sentence as the failure message", async () => {
    const { adapter } = adapterReplying(
      err({ kind: "rejected", code: 3102, detail: "포트가 사용 중이다" }),
    );
    expect(await adapter.setEnabled(true)).toEqual(
      err({ kind: "failed", message: "포트가 사용 중이다" }),
    );
  });

  test("a rejection with only a code is a failure without a message", async () => {
    const coded = adapterReplying(err({ kind: "rejected", code: 3002 }));
    expect(await coded.adapter.pair()).toEqual(err({ kind: "failed", message: null }));
  });

  test("an old service without host.remote.* is unsupported, apart from offline and timeout", async () => {
    const old = adapterReplying(err({ kind: "unsupported" }));
    expect(await old.adapter.status()).toEqual(err({ kind: "unsupported" }));
    const offline = adapterReplying(err({ kind: "offline" }));
    expect(await offline.adapter.status()).toEqual(err({ kind: "failed", message: null }));
    const slow = adapterReplying(err({ kind: "rejected", code: null, issue: "timeout" }));
    expect(await slow.adapter.status()).toEqual(err({ kind: "failed", message: "timeout" }));
  });

  test("a reply whose shape is wrong for the method is bad-reply, not a crash", async () => {
    const { adapter } = adapterReplying(ok({ devices: "d1" }));
    expect(await adapter.devices()).toEqual(err({ kind: "bad-reply" }));
  });
});
