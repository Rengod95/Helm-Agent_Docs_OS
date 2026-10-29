import { expect, test } from "bun:test";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { DEFAULT_WEB_SETTINGS, describeWebSettings } from "@xeon/cap-web";
import type { WireResult } from "@xeon/contracts/wire";

// M3-REQ-96. `web.providers`는 엔진 웹 포트의 값을 그대로 낸다. 쓰기 소유를 얻지 않고, 신호를 포트에 넘긴다.

const ROW: WireResult<"web.providers">["providers"][number] = {
  id: "builtin-wrapper",
  capability: "web.search",
  origin: "builtin",
  displayName: "Built-in search",
  auth: "none",
  status: { kind: "unavailable", reason: "no_model", detail: "no hosted search" },
  pricingAsOf: null,
  pricingStale: false,
  firstUseNoticed: true,
  autoRank: 0,
};
const SETTINGS = describeWebSettings(DEFAULT_WEB_SETTINGS);

test("web.providers returns the port's rows and settings as they are, and the port gets the request signal", async () => {
  const seen: AbortSignal[] = [];
  const host = createFakeHost({
    overrides: {
      web: {
        providers: (signal) => {
          seen.push(signal);
          return Promise.resolve({ providers: [ROW], settings: SETTINGS });
        },
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  expect(await connection.request("web.providers", {})).toEqual({
    providers: [ROW],
    settings: SETTINGS,
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.aborted).toBe(false);
  await connection.close();
});

test("host.hello lists web.providers now that it has a handler", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("web.providers");
  await connection.close();
});
