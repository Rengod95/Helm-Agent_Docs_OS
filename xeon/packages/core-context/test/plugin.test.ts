import { expect, test } from "bun:test";
import { validateManifest, type PortKey } from "@xeon/contracts/extensions";
import { ContextPortKey } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import {
  createContextExtension,
  DEFAULT_CONTEXT_SETTINGS,
  extension,
  manifest,
} from "../src/index.ts";
import { fakeModels, type FakeModels } from "./support/fake-models.ts";
import { memoryLog, type BranchReader } from "./support/log.ts";
import {
  assembleOptions,
  tokenEstimator,
  userItem,
  type TokenOnlyModels,
} from "./support/builders.ts";
import { present, valueOf } from "./support/result.ts";

// 플러그인은 서비스 전체 모양의 포트를 조회한다. 시험에서는 필요한 부분만 가진 대역을 같은 이름으로 제공한다
const sessionKey: PortKey<BranchReader> = { name: "xeon.session" };
const modelsKey: PortKey<TokenOnlyModels> = { name: "xeon.models" };
const fakeModelsKey: PortKey<FakeModels["models"]> = { name: "xeon.models" };

function unitOf(loadIndex: number): ExtensionUnit {
  return { manifest, entry: extension, loadIndex, builtin: true };
}

async function withPorts(
  host: TestHost,
  provide: { readonly session: boolean; readonly models: boolean },
  reader: BranchReader,
): Promise<void> {
  await host.host.registerPlatform({
    name: "test-context-ports",
    setup(ctx) {
      if (provide.session) ctx.providePort(sessionKey, reader);
      if (provide.models) ctx.providePort(modelsKey, { tokens: tokenEstimator });
    },
  });
}

test("manifest_is_a_valid_builtin_l1_plugin", () => {
  const checked = validateManifest(manifest);
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(checked.manifest).toEqual(manifest);
  expect(manifest.layer).toBe("L1");
  expect(manifest.name).toBe("core-context");
  expect(manifest.points).toEqual([]);
});

test("plugin_provides_xeon_context_and_assembles_through_the_port", async () => {
  const host = await createTestHost({ without: ["records"] });
  const log = memoryLog();
  await withPorts(host, { session: true, models: true }, log);
  const installed = await host.host.install(unitOf(0));
  expect(installed.setups.map((setup) => setup.status)).toEqual(["applied"]);
  await host.settled();

  const service = present(host.host.ports.get(ContextPortKey));
  log.append("thread.started", {});
  log.append("item.recorded", userItem(log, "hello"));
  const assembled = valueOf(
    await service.assemble(log.threadId, log.leaf(), assembleOptions(log.ids)),
  );
  expect(assembled.messages.map((message) => message.role)).toEqual(["system", "user"]);
  expect(assembled.pendingItems.map((item) => item.purpose)).toEqual(["prefix"]);
});

test("plugin_setup_fails_without_the_session_port", async () => {
  const host = await createTestHost({ without: ["records"] });
  await withPorts(host, { session: false, models: true }, memoryLog());
  const installed = await host.host.install(unitOf(0));
  expect(installed.setups.map((setup) => setup.status)).toEqual(["failed"]);
  expect(host.host.ports.get(ContextPortKey)).toBeUndefined();
});

test("plugin_setup_fails_without_the_models_port", async () => {
  const host = await createTestHost({ without: ["records"] });
  await withPorts(host, { session: true, models: false }, memoryLog());
  const installed = await host.host.install(unitOf(0));
  expect(installed.setups.map((setup) => setup.status)).toEqual(["failed"]);
  expect(host.host.ports.get(ContextPortKey)).toBeUndefined();
});

test("plugin_with_ids_and_settings_compacts_through_the_port", async () => {
  const host = await createTestHost({ without: ["records"] });
  const log = memoryLog();
  const fake = fakeModels();
  await host.host.registerPlatform({
    name: "test-context-ports",
    setup(ctx) {
      ctx.providePort(sessionKey, log);
      ctx.providePort(fakeModelsKey, fake.models);
    },
  });
  const module = createContextExtension({
    ids: log.ids,
    settings: () => ({ ...DEFAULT_CONTEXT_SETTINGS, keepRecentTokens: 250, reserveTokens: 1024 }),
  });
  const installed = await host.host.install({
    manifest: module.manifest,
    entry: module.extension,
    loadIndex: 0,
    builtin: true,
  });
  expect(installed.setups.map((setup) => setup.status)).toEqual(["applied"]);
  await host.settled();
  const service = present(host.host.ports.get(ContextPortKey));

  log.append("thread.started", {});
  for (let i = 0; i < 6; i += 1) {
    const turnId = log.ids.next("trn");
    log.append("item.recorded", userItem(log, `question ${i} ${"x".repeat(400)}`), { turnId });
  }
  fake.replies.push({ kind: "text", text: "FROM THE PORT" });
  const outcome = await service.compact(log.threadId, {
    reason: "manual",
    binding: { role: "main", provider: "anthropic", modelId: "claude-x", thinkingLevel: "off" },
    contextWindow: 200_000,
    willRetry: false,
  });
  expect(outcome).toMatchObject({ ok: true, value: { status: "compacted" } });
  expect(log.events.at(-1)?.kind).toBe("thread.compacted");
});

test("the default extension has no id source, so compaction stays off", async () => {
  const host = await createTestHost({ without: ["records"] });
  const log = memoryLog();
  await withPorts(host, { session: true, models: true }, log);
  await host.host.install(unitOf(0));
  await host.settled();
  const service = present(host.host.ports.get(ContextPortKey));
  const outcome = await service.compact(log.threadId, {
    reason: "manual",
    binding: { role: "main", provider: "anthropic", modelId: "claude-x", thinkingLevel: "off" },
    contextWindow: 200_000,
    willRetry: false,
  });
  expect(outcome).toEqual({ ok: true, value: { status: "skipped", why: "disabled" } });
});
