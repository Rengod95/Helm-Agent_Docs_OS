import { expect, test } from "bun:test";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// models.list(F wire §3.3.1, M4 T-MODEL). 가짜 엔진의 카탈로그에는 `tape/tape-1` 하나가 있다.

test("models.list gives the selectable models with their context windows and takes no write ownership", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("models.list", {})).toEqual({
    models: [{ ref: "tape/tape-1", name: "Tape One", contextWindow: 8192, reasoning: false }],
  });
  expect(host.fake.acquisitions).toEqual([]);
  await connection.close();
});
