import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ScopeStack } from "@fresnel/contracts/settings";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WireError, type WireParams } from "@fresnel/contracts/wire";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// L4.remote.spec §8.9: 다른 기기(hello에 origin "remote")의 approval.respond는 "다른 기기에서 승인하기"가 꺼져 있으면 3009로 거절된다.

const KEY = "l0.process.service.allowRemoteRespond";
const PARAMS: WireParams<"approval.respond"> = { approvalId: "evt_known", decision: "allow" };
const REMOTE_HELLO: WireParams<"host.hello"> = {
  ...HELLO_PARAMS,
  client: { ...HELLO_PARAMS.client, origin: "remote", deviceId: "dev_0123456789abcdef" },
};

interface Seen {
  readonly params: WireParams<"approval.respond">;
  readonly deviceId: string | undefined;
}

function hostWith(layers: ScopeStack, seen: Seen[]) {
  const host = createFakeHost({
    layers,
    overrides: {
      approvals: {
        locate: () => Promise.resolve(ok(undefined)),
        respond: (params, answeredBy) => {
          seen.push({ params, deviceId: answeredBy?.deviceId });
          return Promise.resolve({ applied: true });
        },
      },
    },
  });
  return host;
}

const OFF: ScopeStack = [{ scope: "user", values: new Map([[KEY, false]]) }];

test("remote connection is rejected with 3009 when the switch is off, and the service never sees it", async () => {
  const seen: Seen[] = [];
  const host = hostWith(OFF, seen);
  const { connection } = host.connect();
  await connection.request("host.hello", REMOTE_HELLO);
  const caught = await rejectionOf(connection.request("approval.respond", PARAMS));
  expect(caught).toBeInstanceOf(WireError);
  expect(caught instanceof WireError ? caught.code : null).toBe(3009);
  expect(seen).toEqual([]);
  await connection.close();
});

test("a local connection can still answer when the switch is off", async () => {
  const seen: Seen[] = [];
  const host = hostWith(OFF, seen);
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("approval.respond", PARAMS)).toEqual({
    applied: false,
    reason: "unknown_approval",
  });
  await connection.close();
});

test("with the default (on) a remote answer passes and carries its device id; a local answer carries none", async () => {
  const seen: Seen[] = [];
  const located: { threadId: ThreadId | undefined } = { threadId: undefined };
  const host = createFakeHost({
    layers: [],
    overrides: {
      approvals: {
        locate: () => Promise.resolve(ok(located.threadId)),
        respond: (params, answeredBy) => {
          seen.push({ params, deviceId: answeredBy?.deviceId });
          return Promise.resolve({ applied: true });
        },
      },
    },
  });
  located.threadId = host.fake.seedThread();
  const remote = host.connect().connection;
  await remote.request("host.hello", REMOTE_HELLO);
  expect(await remote.request("approval.respond", PARAMS)).toEqual({ applied: true });
  await remote.close();
  const local = host.connect().connection;
  await local.request("host.hello", HELLO_PARAMS);
  expect(await local.request("approval.respond", PARAMS)).toEqual({ applied: true });
  await local.close();
  expect(seen).toEqual([
    { params: PARAMS, deviceId: "dev_0123456789abcdef" },
    { params: PARAMS, deviceId: undefined },
  ]);
});
