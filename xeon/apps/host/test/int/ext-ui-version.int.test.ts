import { expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// T-XV(HS-108): 조립된 호스트가 확장 목록과 버전 처리기에 실제 wire로 답한다. 기본 그룹을 끈 호스트에는 확장이 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "ext.ui.list is an empty list without extensions, and ext.versions names an unknown extension as the exact JSON-RPC error",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      expect(await connection.request("ext.ui.list", {})).toEqual({ items: [] });
      const caught = await rejectionOf(connection.request("ext.versions", { name: "nope" }));
      expect(caught).toBeInstanceOf(WireError);
      if (caught instanceof WireError) {
        expect({ code: caught.code, message: caught.message, data: caught.data }).toEqual({
          code: -32602,
          message: "jsonrpc.invalidParams",
          data: {
            kind: "jsonrpc.invalidParams",
            retryable: false,
            details: { issues: [{ path: "/name", message: "unknown_extension: nope" }] },
          },
        });
      }
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);
