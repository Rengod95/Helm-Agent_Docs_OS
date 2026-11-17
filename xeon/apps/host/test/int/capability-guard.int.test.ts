import { expect, test } from "bun:test";
import {
  defineCapability,
  isCapabilityError,
  type CallOptions,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import { defineManifest } from "@fresnel/contracts/extensions";
import { ExtHostPortKey, hostOf, type ExtHost } from "@fresnel/ext-host";
import { Type } from "typebox";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 기능 래퍼(X.primitives.spec §4.4.7)가 실제 조립에서 도는지 본다. drive 함수가 읽기 기능을 부르면 공급자까지 닿고,
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
  const isGroup = kind === "group";
  return defineManifest({
    schemaVersion: 2,
    name,
    version: "0.1.0",
    displayName: name,
    description: "capability guard test",
    defaultEnabled: true,
    entry: "./src/index.ts",
    ...(isGroup ? { group: {} } : {}),
    plugins: [
      {
        layer: isGroup ? "L3" : "plugin",
        hooks: [],
        ...(isGroup ? { drives: true } : {}),
        ...(name === "cg-provider"
          ? { provides: [{ id: "demo.probe", version: "1.0.0" }] }
          : { requires: [{ id: "demo.probe", range: "^1.0.0" }] }),
      },
    ],
    trust: { level: "builtin" },
  });
}

async function probeRun(
  settings: Readonly<Record<string, unknown>> | undefined,
  expected: Readonly<Record<string, string>>,
  expectedCalls: string[],
): Promise<void> {
  const home = useEngineHome();
  if (settings !== undefined) writeUserSettings(home, settings);
  const calls: string[] = [];
  const provider: HostPluginModule = {
    manifest: manifestOf("cg-provider", "plugin"),
    extension: ({ register }) => {
      register("cg-provider", {}, (g) => {
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
  let ext: ExtHost | undefined;
  const group: HostPluginModule = {
    manifest: manifestOf("cg-group", "group"),
    extension: ({ register }) => {
      register("cg-group", {}, (g) => {
        ext = hostOf(g).port(ExtHostPortKey);
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
          return { do: "yield" };
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
  const created = await connection.request("thread.create", {});
  // 주도 시작 요청을 넣는다. 그룹을 켠 것만으로는 주도하지 않는다(drive-isolation.md 2.2)
  expect(ext?.startDrive(created.threadId, "cg-group").ok).toBe(true);
  expect(await outcome.promise).toEqual(expected);
  expect(calls).toEqual(expectedCalls);
  await connection.close();
  await host.close();
  home.dispose();
}

// 설정 `l1.tools.pluginCalls`를 끈 조립은 옛 직접 경로다: 선언 없는 쓰기와 키 없는 멱등 쓰기는 공급자를 부르지 않고 거부된다
realTest(
  "with plugin calls off, a drive function's read call reaches the provider; undeclared and keyless writes do not",
  () =>
    probeRun(
      { "l1.tools.pluginCalls": false },
      { read: "peeked", undeclared: "effect_not_allowed", keyless: "invalid_input", keyed: "put" },
      ["peek", "put"],
    ),
  30_000,
);

// 기본값(켜짐)은 도구 파이프라인 경로다: 쓰기는 파이프라인의 정책, 승인, 효과 기록이 맡고 호출 키는 흐름과 순번에서 만든다(U-5)
realTest(
  "by default a drive function's writes go through the tool pipeline and reach the provider",
  () =>
    probeRun(undefined, { read: "peeked", undeclared: "poked", keyless: "put", keyed: "put" }, [
      "peek",
      "poke",
      "put",
      "put",
    ]),
  30_000,
);
