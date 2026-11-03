import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import {
  ModelsPortKey,
  ToolsPortKey,
  type ProviderResourceDef,
  type ToolReplaceClaim,
  type ToolResourceDef,
} from "@fresnel/contracts/extensions";
import { createTestHost } from "@fresnel/ext-host/testing";
import { Type } from "typebox";
import { defineGroup, groupManifest, type GroupManifest } from "../src/index.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

test("resources.tool-and-command-released-on-disable", async () => {
  const t = await createTestHost();
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "fake-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "tooled" }),
      setup(g) {
        g.registerTool({
          name: "tooled_probe",
          description: "probe",
          parameters: Type.Object({}),
          replay: "safe",
          execute: () => Promise.resolve("ok"),
        });
        g.registerCommand("tooled", { handler: () => Promise.resolve() });
      },
    }),
  );
  // 켜기·끄기는 열린 thread의 경계에 적용되므로 thread를 하나 연다
  await t.host.openThread(t.newThread());
  await t.settled();
  expect([...tools.keys()]).toEqual(["tooled_probe"]);
  expect(t.host.resources.list("tool").map((record) => record.scopeId)).toEqual(["tooled"]);
  expect(t.host.resources.list("command").map((record) => record.name)).toEqual(["tooled"]);

  // 그룹을 끄면 도구 포트 등록과 명령 등록이 함께 풀린다
  t.host.registration("tooled")?.disable();
  await t.settled();
  expect(t.host.registration("tooled")?.status).toBe("disabled");
  expect(tools.size).toBe(0);
  expect(t.host.resources.list("tool")).toEqual([]);
  expect(t.host.resources.list("command")).toEqual([]);

  // 다시 켜면 setup이 다시 돌아 등록이 돌아온다
  t.host.registration("tooled")?.enable();
  await t.settled();
  expect([...tools.keys()]).toEqual(["tooled_probe"]);
  expect(t.host.resources.list("command")).toHaveLength(1);
});

test("resources.provider-released-on-disable", async () => {
  const t = await createTestHost();
  const providers = new Map<string, ProviderResourceDef>();
  await t.host.registerPlatform({
    name: "fake-models",
    setup(ctx) {
      ctx.providePort(ModelsPortKey, {
        registerProvider(_owner, name, config) {
          providers.set(name, config);
          return () => {
            providers.delete(name);
          };
        },
      });
    },
  });
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "provided" }),
      setup(g) {
        g.registerProvider("provided-model", {
          api: "openai-completions",
          baseUrl: "https://example.invalid",
        });
      },
    }),
  );
  // 켜기·끄기는 열린 thread의 경계에 적용되므로 thread를 하나 연다
  await t.host.openThread(t.newThread());
  await t.settled();
  expect([...providers.keys()]).toEqual(["provided-model"]);
  expect(t.host.resources.list("provider").map((record) => record.scopeId)).toEqual(["provided"]);

  // 그룹을 끄면 provider 등록이 풀린다
  t.host.registration("provided")?.disable();
  await t.settled();
  expect(t.host.registration("provided")?.status).toBe("disabled");
  expect(providers.size).toBe(0);
  expect(t.host.resources.list("provider")).toEqual([]);

  // 다시 켜면 setup이 다시 돌아 provider 등록이 돌아온다
  t.host.registration("provided")?.enable();
  await t.settled();
  expect([...providers.keys()]).toEqual(["provided-model"]);
});

test("resources.group-registerMethod-is-callable-and-released-with-the-group", async () => {
  const t = await createTestHost();
  const manifest: GroupManifest = {
    ...groupManifestOf({ name: "methoded" }),
    methods: [
      {
        verb: "echo",
        params: {
          type: "object",
          properties: { word: { type: "string" } },
          required: ["word"],
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: { echoed: { type: "string" } },
          required: ["echoed"],
          additionalProperties: false,
        },
        readOnly: true,
      },
    ],
  };
  await install(
    t,
    defineGroup({
      manifest,
      setup(g) {
        g.registerMethod("echo", {
          handler: (params) => {
            const word =
              typeof params === "object" && params !== null && "word" in params ? params.word : "";
            return Promise.resolve({ echoed: `${String(word)}!` });
          },
        });
      },
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  const call = (params: unknown) =>
    t.host.methods.call({
      extension: "methoded",
      verb: "echo",
      params,
      threadId: thread,
      signal: new AbortController().signal,
      caller: "wire",
    });
  expect(await call({ word: "hi" })).toEqual({ kind: "ok", value: { echoed: "hi!" } });
  const bad = await call({ word: 1 });
  expect(bad.kind).toBe("params_invalid");
  expect(t.host.methods.list().map((info) => `${info.extension}.${info.verb}`)).toEqual([
    "methoded.echo",
  ]);
  t.host.registration("methoded")?.disable();
  await t.settled();
  expect(t.host.methods.list()).toEqual([]);
});

// F.capabilities.spec §10 [결정: 2026-11-03 사용자]: 외부 그룹도 plugin.json의 루트 L3 플러그인 `replaces`로 내장 도구를 대체한다
test("an external group from plugin.json replaces a built-in tool through g.registerTool with its loaded trust", async () => {
  const manifest = groupManifest({
    schemaVersion: 2,
    name: "ext-files",
    version: "0.1.0",
    entry: "./src/index.ts",
    plugins: [{ layer: "L3", hooks: [], replaces: ["read"] }],
    group: {},
  });
  expect(manifest.plugins[0]?.replaces).toEqual(["read"]);
  const t = await createTestHost();
  const claims: ToolReplaceClaim[] = [];
  await t.host.registerPlatform({
    name: "claim-recorder",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        register(_owner, def) {
          if (def.replaces !== undefined) claims.push(def.replaces);
          return ok(() => {});
        },
      });
    },
  });
  const group = defineGroup({
    manifest,
    setup(g) {
      g.registerTool({
        name: "read",
        description: "read files my way",
        parameters: Type.Object({ path: Type.String() }),
        replay: "safe",
        execute: () => Promise.resolve("from the group"),
      });
    },
  });
  // 로더를 거치지 않으므로 신뢰 등급은 로더가 정할 값을 직접 준다(설치 위치가 user)
  await t.host.install({
    manifest: group.manifest,
    entry: group.entry,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  await t.host.openThread(t.newThread());
  await t.settled();
  expect(claims).toEqual([{ extension: "ext-files", trust: "user" }]);
  expect(t.host.resources.list("tool")).toMatchObject([
    { name: "read", exposed: "read", extension: "ext-files" },
  ]);
});
