import { expect, test } from "bun:test";
import {
  defineCapability,
  isCapabilityError,
  type CallOptions,
  type ServiceKey,
} from "@xeon/contracts/capabilities";
import { defineManifest } from "@xeon/contracts/extensions";
import { hostOf } from "@xeon/ext-host";
import { Type } from "typebox";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 능력 래퍼(X.primitives.spec §4.4.7)가 실제 조립에서 도는지 본다. drive 함수가 읽기 능력을 부르면 공급자까지 닿고,
// 선언 없는 쓰기와 키 없는 멱등 쓰기는 공급자를 부르지 않고 거부된다. 정의 표는 조립 루트가 넘긴다(ExtHostDeps.capabilityDefs).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const text = Type.Object({ q: Type.Optional(Type.String()) }, { additionalProperties: false });
const probeDef = defineCapability({
  id: "demo.probe",
  version: "1.0.0",
  description: "probe",
  service: {
    methods: {
      peek: {
        description: "read",
        input: text,
        output: Type.String(),
        replay: "safe",
        readOnly: true,
      },
      poke: { description: "write", input: text, output: Type.String(), replay: "unsafe" },
      put: {
        description: "idempotent write",
        input: text,
        output: Type.String(),
        replay: "safe",
        idempotent: true,
      },
    },
  },
  tools: [],
});

interface Probe {
  peek(input: { q?: string }, options?: CallOptions): Promise<string>;
  poke(input: { q?: string }, options?: CallOptions): Promise<string>;
  put(input: { q?: string }, options?: CallOptions): Promise<string>;
}
const probeKey: ServiceKey<Probe> = { capability: "demo.probe", version: "1.0.0" };

function manifestOf(name: string, kind: "plugin" | "group") {
  return defineManifest({
    schemaVersion: 1,
    name,
    version: "0.1.0",
    displayName: name,
    description: "capability guard test",
    defaultEnabled: true,
    layer: kind === "group" ? "L3" : "plugin",
    kind,
    entry: "./src/index.ts",
    points: [],
    usesDrive: kind === "group",
    ...(name === "cg-provider"
      ? { provides: [{ id: "demo.probe", version: "1.0.0" }] }
      : { requires: [{ id: "demo.probe", range: "^1.0.0" }] }),
    trust: { level: "builtin" },
  });
}

realTest(
  "a drive function's read capability call reaches the provider; undeclared and keyless writes do not",
  async () => {
    const home = useEngineHome();
    const calls: string[] = [];
    const provider: HostPluginModule = {
      manifest: manifestOf("cg-provider", "plugin"),
      extension: ({ scope }) => {
        scope("cg-provider", {}, (g) => {
          hostOf(g).provide(probeKey, {
            peek: () => {
              calls.push("peek");
              return Promise.resolve("peeked");
            },
            poke: () => {
              calls.push("poke");
              return Promise.resolve("poked");
            },
            put: () => {
              calls.push("put");
              return Promise.resolve("put");
            },
          });
        });
      },
    };
    const outcome = Promise.withResolvers<Record<string, string>>();
    const group: HostPluginModule = {
      manifest: manifestOf("cg-group", "group"),
      extension: ({ scope }) => {
        scope("cg-group", {}, (g) => {
          g.drive(async () => {
            const probe = g.capability(probeKey);
            const attempts: [string, () => Promise<string>][] = [
              ["read", () => probe.peek({})],
              ["undeclared", () => probe.poke({})],
              ["keyless", () => probe.put({})],
              ["keyed", () => probe.put({}, { requestId: "cg:1" })],
            ];
            const results: Record<string, string> = {};
            for (const [label, run] of attempts) {
              // oxlint-disable-next-line no-await-in-loop -- 호출 순서가 결과를 정한다 (X.primitives.spec §4.4.7)
              results[label] = await run().then(
                (value) => value,
                (cause: unknown) => (isCapabilityError(cause) ? cause.data.code : "unexpected"),
              );
            }
            outcome.resolve(results);
          });
        });
      },
    };
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [provider, group],
      extraCapabilityDefs: [probeDef],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    await connection.request("thread.create", {});
    expect(await outcome.promise).toEqual({
      read: "peeked",
      undeclared: "effect_not_allowed",
      keyless: "invalid_input",
      keyed: "put",
    });
    expect(calls).toEqual(["peek", "put"]);
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
