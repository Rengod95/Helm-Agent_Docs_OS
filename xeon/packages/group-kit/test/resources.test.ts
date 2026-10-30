import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import {
  ModelsPortKey,
  ToolsPortKey,
  type ProviderResourceDef,
  type ToolResourceDef,
} from "@xeon/contracts/extensions";
import { createTestHost } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { defineGroup } from "../src/index.ts";
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
  t.host.scope("tooled")?.disable();
  await t.settled();
  expect(t.host.scope("tooled")?.status).toBe("disabled");
  expect(tools.size).toBe(0);
  expect(t.host.resources.list("tool")).toEqual([]);
  expect(t.host.resources.list("command")).toEqual([]);

  // 다시 켜면 setup이 다시 돌아 등록이 돌아온다
  t.host.scope("tooled")?.enable();
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
  t.host.scope("provided")?.disable();
  await t.settled();
  expect(t.host.scope("provided")?.status).toBe("disabled");
  expect(providers.size).toBe(0);
  expect(t.host.resources.list("provider")).toEqual([]);

  // 다시 켜면 setup이 다시 돌아 provider 등록이 돌아온다
  t.host.scope("provided")?.enable();
  await t.settled();
  expect([...providers.keys()]).toEqual(["provided-model"]);
});
