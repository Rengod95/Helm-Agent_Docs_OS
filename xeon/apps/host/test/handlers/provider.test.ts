import { expect, test } from "bun:test";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M4 provider.checkAuth(L1.models.spec §3.10). 처리기는 실제 코드이고 모델 포트만 대역이다.
// 요청과 응답 어디에도 키 값이 없어야 한다. 값은 포트가 이미 가린 글만 돌아온다.

test("provider.checkAuth hands the provider id to the port and returns its result", async () => {
  const calls: string[] = [];
  const host = createFakeHost({
    overrides: {
      models: {
        checkAuth: (provider) => {
          calls.push(provider);
          return Promise.resolve({
            kind: "rejected",
            status: 401,
            reason: "invalid x-api-key: ••••",
          });
        },
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("provider.checkAuth", { provider: "anthropic" })).toEqual({
    kind: "rejected",
    status: 401,
    reason: "invalid x-api-key: ••••",
  });
  expect(calls).toEqual(["anthropic"]);
  await connection.close();
});

test("the default port answers unsupported for a provider with no known check", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("provider.checkAuth", { provider: "local-llm" })).toEqual({
    kind: "unsupported",
  });
  await connection.close();
});

test("provider.checkAuth is listed among the features the host implements", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("provider.checkAuth");
  await connection.close();
});
