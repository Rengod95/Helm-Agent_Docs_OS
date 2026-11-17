import { expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// `turnRecord.watch`와 `unwatch`의 처리기(정본 §3.5). 구독은 연결에 묶이고, 모르는 구독을 끊어도 `{}`다.

test("turnRecord.watch answers the sub and the record level, and unwatch answers {} even for an unknown sub", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const threadId = host.fake.seedThread();

  const watched = await connection.request("turnRecord.watch", { threadId });
  expect(watched).toEqual({ sub: expect.any(String), level: "none" });
  expect(await connection.request("turnRecord.unwatch", { sub: watched.sub })).toEqual({});
  expect(await connection.request("turnRecord.unwatch", { sub: "neverWatched" })).toEqual({});
  await connection.close();
});

test("turnRecord.watch on an unknown thread is thread.notFound (3001)", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const unknown = fixedIdFactory(91).next("thr");
  let failure: unknown;
  try {
    await connection.request("turnRecord.watch", { threadId: unknown });
  } catch (caught) {
    failure = caught;
  }
  expect(failure instanceof WireError ? [failure.code, failure.data.kind] : failure).toEqual([
    3001,
    "thread.notFound",
  ]);
  await connection.close();
});
