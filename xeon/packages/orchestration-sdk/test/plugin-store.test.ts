import { PrimitiveError } from "@fresnel/ext-host";
import { createTestHost, memoryPluginStore } from "@fresnel/ext-host/testing";
import { expect, test } from "bun:test";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { defineOrchestration, type OrchestrationApi } from "../src/index.ts";
import { install } from "./support/host.ts";
import { orchestrationManifestOf } from "./support/manifests.ts";

// `g.pluginStore`가 SDK를 거쳐 같은 저장소에 닿고, 쓰기 규칙을 그대로 지키는지 본다(X.primitives.spec §4.6.7)

const NAME = "ps-group";

function verb(name: string, readOnly: boolean): ExtMethodDecl {
  return { verb: name, params: {}, result: {}, readOnly };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : "not_primitive_error";
  }
}

test("a group method without a conversation writes and reads the plugin store, and the write rules hold", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const codes: Record<string, string> = {};
  const seen: { load?: unknown; ro?: string } = {};
  const sink: { api?: OrchestrationApi<never> } = {};
  const group = defineOrchestration({
    manifest: {
      ...orchestrationManifestOf({ name: NAME }),
      methods: [verb("save", false), verb("load", true), verb("roWrite", true)],
    },
    setup(g) {
      sink.api = g;
      g.registerMethod("save", {
        handler: async () => {
          const result = await g.pluginStore.put("k.one", { n: 1 });
          codes.save = result.ok ? "ok" : result.error.kind;
          return null;
        },
      });
      g.registerMethod("load", {
        handler: async () => {
          seen.load = await g.pluginStore.get("k.one");
          return null;
        },
      });
      g.registerMethod("roWrite", {
        handler: async () => {
          seen.ro = await codeOf(() => g.pluginStore.delete("k.one"));
          return null;
        },
      });
    },
  });
  await install(t, group);
  const outside = sink.api;
  if (outside === undefined) throw new Error("the group setup did not run");
  // setup 본문에서는 쓸 수 없다(메서드 문맥이 아니다)
  codes.setup = await codeOf(() => outside.pluginStore.put("k.setup", { n: 0 }));
  expect(codes.setup).toBe("store_outside_method");

  const call = (name: string) =>
    t.host.methods.call({
      extension: NAME,
      verb: name,
      params: {},
      threadId: null,
      signal: new AbortController().signal,
      caller: "ui",
    });
  await call("save");
  expect(codes.save).toBe("ok");
  expect(await port.get(NAME, "k.one")).toEqual({ ok: true, value: '{"n":1}' });
  await call("load");
  expect(seen.load).toEqual({ ok: true, value: { n: 1 } });
  await call("roWrite");
  expect(seen.ro).toBe("read_only_method");
  expect(await port.get(NAME, "k.one")).toEqual({ ok: true, value: '{"n":1}' });
});
