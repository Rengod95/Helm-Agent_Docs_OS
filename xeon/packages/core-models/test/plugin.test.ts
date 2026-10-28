import { describe, expect, test } from "bun:test";
import { createModels } from "@earendil-works/pi-ai";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import {
  ModelServiceName,
  SecretServiceName,
  type ModelService,
  type SecretService,
} from "@xeon/contracts/services";
import type { PortKey } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import {
  createModelsExtension,
  DEFAULT_MODELS_SETTINGS,
  extension,
  manifest,
  type ModelsSettings,
} from "../src/index.ts";
import { memorySecrets, t, tape, tapePlayer, tapeProvider } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { FAKE_KEY } from "./support/harness.ts";

const ModelServiceKey: PortKey<ModelService> = { name: ModelServiceName };
const SecretServiceKey: PortKey<SecretService> = { name: SecretServiceName };

const SETTINGS: ModelsSettings = {
  ...DEFAULT_MODELS_SETTINGS,
  default: "tape/tape-1",
  providers: [{ id: "tape", enabled: true, apiKeyRef: "secret://tape-key", baseUrl: null }],
  retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
};

const PATCHER = defineManifest({
  schemaVersion: 1,
  name: "payload-patcher",
  version: "0.1.0",
  layer: "L3",
  kind: "group",
  entry: "./src/index.ts",
  points: ["request.provider.before"],
  usesDrive: false,
  trust: { level: "builtin" },
});

const patcherEntry: ExtensionEntry = ({ manifest: own, scope }) => {
  scope(own.name, {}, (g) => {
    g.on("request.provider.before", (payload) => ({
      payload: { patched: true, was: payload.payload },
    }));
  });
};

describe("core-models builtin extension", () => {
  test("the default export is a valid manifest and entry", () => {
    expect(manifest.name).toBe("core-models");
    expect(manifest.layer).toBe("L1");
    expect(manifest.points).toEqual([]);
    expect(typeof extension).toBe("function");
  });

  test("installs into ext-host, provides xeon.models, and fires request.provider.before through xeon.ext", async () => {
    const th = await createTestHost();
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    await th.host.registerPlatform({
      name: "test-secrets",
      setup(ctx) {
        ctx.providePort(SecretServiceKey, secrets.service);
      },
    });
    const clock = manualClock();
    const fake = tapeProvider(
      tapePlayer(
        tape("core-models/plugin", [
          {
            role: "main",
            response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
          },
        ]),
        { clock },
      ),
    );
    const models = createModelsExtension({
      clock,
      settings: () => SETTINGS,
      buildModels: (credentials) => {
        const collection = createModels({ credentials });
        collection.setProvider(fake.provider);
        return collection;
      },
    });
    const installed = await th.host.install({
      manifest: models.manifest,
      entry: models.extension,
      loadIndex: 0,
      builtin: true,
    });
    expect(installed.entryError).toBeUndefined();
    expect(installed.issues).toEqual([]);
    await th.settled();

    await th.host.install({ manifest: PATCHER, entry: patcherEntry, loadIndex: 1, builtin: true });
    await th.settled();

    const service = th.host.ports.get(ModelServiceKey);
    expect(service).toBeDefined();
    if (service === undefined) return;

    const threadId = th.newThread();
    await th.host.openThread(threadId);
    const resolved = service.resolve("main");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const message = await service
      .stream({
        threadId,
        turnId: null,
        stepId: null,
        role: "main",
        resolved: resolved.value,
        context: { messages: [{ role: "user", content: "hi", timestamp: clock.now() }] },
      })
      .result();
    expect(message.stopReason).toBe("stop");
    // 핸들러가 바꾼 페이로드가 provider에 도착했고, 해석한 키는 요청으로만 나갔다
    expect(fake.calls()[0]?.payload).toMatchObject({ patched: true, was: { model: "tape-1" } });
    expect(fake.calls()[0]?.apiKey).toBe(FAKE_KEY);
    expect(secrets.leaseCalls()).toBe(1);
    await th.host.dispose();
  });

  test("installing without xeon.secrets surfaces a port_unavailable setup failure", async () => {
    const th = await createTestHost();
    const models = createModelsExtension({ clock: manualClock() });
    const installed = await th.host.install({
      manifest: models.manifest,
      entry: models.extension,
      loadIndex: 0,
      builtin: true,
    });
    await th.settled();
    expect(installed.setups).toHaveLength(1);
    expect(installed.setups[0]?.status).toBe("failed");
    expect(installed.setups[0]?.failure).toMatchObject({ kind: "threw", code: "port_unavailable" });
    expect(th.host.ports.get(ModelServiceKey)).toBeUndefined();
    await th.host.dispose();
  });

  test("handlers on the remaining five request points see the call and a header patch reaches the request", async () => {
    const th = await createTestHost();
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    await th.host.registerPlatform({
      name: "test-secrets",
      setup(ctx) {
        ctx.providePort(SecretServiceKey, secrets.service);
      },
    });
    const clock = manualClock();
    const fake = tapeProvider(
      tapePlayer(
        tape("core-models/plugin-points", [
          {
            role: "main",
            response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
          },
          {
            role: "main",
            response: { type: "message", content: [t.text("again")], stopReason: "stop" },
          },
        ]),
        { clock },
      ),
      {
        response: { status: 200, headers: { "Retry-After": "0", "Set-Cookie": "sid=1" } },
        rawEvents: [{ type: "raw" }],
        models: [{ id: "tape-1", reasoning: true }],
      },
    );
    const models = createModelsExtension({
      clock,
      settings: () => ({ ...SETTINGS, default: "tape/tape-1:low" }),
      buildModels: (credentials) => {
        const collection = createModels({ credentials });
        collection.setProvider(fake.provider);
        return collection;
      },
    });
    await th.host.install({
      manifest: models.manifest,
      entry: models.extension,
      loadIndex: 0,
      builtin: true,
    });
    const seen: string[] = [];
    const spyManifest = defineManifest({
      schemaVersion: 1,
      name: "point-spy",
      version: "0.1.0",
      layer: "L3",
      kind: "group",
      entry: "./src/index.ts",
      points: [
        "request.headers.before",
        "request.provider.after",
        "request.stream",
        "request.model.after",
        "request.thinking.after",
      ],
      usesDrive: false,
      trust: { level: "builtin" },
    });
    await th.host.install({
      manifest: spyManifest,
      entry: ({ manifest: own, scope }) => {
        scope(own.name, {}, (g) => {
          g.on("request.headers.before", (payload) => {
            seen.push(`headers:${Object.keys(payload.headers).join(",")}`);
            return { set: { "x-spy": "1" } };
          });
          g.on("request.provider.after", (payload) => {
            seen.push(`response:${payload.status}:${Object.keys(payload.headers).join(",")}`);
          });
          g.on("request.stream", (payload) => {
            seen.push(`raw:${payload.model}`);
          });
          g.on("request.model.after", (payload) => {
            seen.push(`select:${payload.binding.modelId}:${payload.previous === null}`);
          });
          g.on("request.thinking.after", (payload) => {
            seen.push(`level:${payload.level}`);
          });
        });
      },
      loadIndex: 1,
      builtin: true,
    });
    await th.settled();

    const service = th.host.ports.get(ModelServiceKey);
    expect(service).toBeDefined();
    if (service === undefined) return;
    const threadId = th.newThread();
    await th.host.openThread(threadId);
    const resolved = service.resolve("main");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const message = await service
      .stream({
        threadId,
        turnId: null,
        stepId: null,
        role: "main",
        resolved: resolved.value,
        context: { messages: [{ role: "user", content: "hi", timestamp: clock.now() }] },
      })
      .result();
    expect(message.stopReason).toBe("stop");
    await th.settled();
    expect(seen).toContain("select:tape-1:true");
    expect(seen).toContain("response:200:retry-after");
    expect(seen).toContain("raw:tape-1");
    expect(seen.some((line) => line.startsWith("headers:"))).toBe(true);
    expect(fake.calls()[0]?.headers).toMatchObject({ "x-spy": "1" });
    expect(JSON.stringify(seen)).not.toContain(FAKE_KEY);

    // 레벨만 바꾸면 thinking_level_select가 detached로 발화한다
    const high = service.resolve("main", { thinkingLevel: "high" });
    expect(high.ok).toBe(true);
    if (!high.ok) return;
    await service
      .stream({
        threadId,
        turnId: null,
        stepId: null,
        role: "main",
        resolved: high.value,
        context: { messages: [{ role: "user", content: "again", timestamp: clock.now() }] },
      })
      .result();
    await th.settled();
    expect(seen).toContain("level:high");
    expect(seen.filter((line) => line.startsWith("select:"))).toHaveLength(1);
    await th.host.dispose();
  });

  test("guard.model.before through xeon.ext: a block or a throwing handler stops the request, the guard sees the chained payload", async () => {
    const th = await createTestHost();
    const secrets = memorySecrets({ "tape-key": FAKE_KEY });
    await th.host.registerPlatform({
      name: "test-secrets",
      setup(ctx) {
        ctx.providePort(SecretServiceKey, secrets.service);
      },
    });
    const clock = manualClock();
    const fake = tapeProvider(
      tapePlayer(
        tape("core-models/plugin-guard", [
          {
            role: "main",
            response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
          },
          {
            role: "main",
            response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
          },
        ]),
        { clock },
      ),
    );
    const models = createModelsExtension({
      clock,
      settings: () => SETTINGS,
      buildModels: (credentials) => {
        const collection = createModels({ credentials });
        collection.setProvider(fake.provider);
        return collection;
      },
    });
    await th.host.install({
      manifest: models.manifest,
      entry: models.extension,
      loadIndex: 0,
      builtin: true,
    });
    await th.settled();
    await th.host.install({ manifest: PATCHER, entry: patcherEntry, loadIndex: 1, builtin: true });
    const seen: unknown[] = [];
    let mode: "block" | "throw" = "block";
    await th.host.install({
      manifest: defineManifest({
        schemaVersion: 1,
        name: "model-guard",
        version: "0.1.0",
        layer: "L3",
        kind: "group",
        entry: "./src/index.ts",
        points: ["guard.model.before"],
        usesDrive: false,
        trust: { level: "builtin" },
      }),
      entry: ({ manifest: own, scope }) => {
        scope(own.name, {}, (g) => {
          g.on("guard.model.before", (payload) => {
            seen.push(payload.payload);
            if (mode === "throw") throw new Error("guard exploded");
            return { block: true, reason: "no model calls" };
          });
        });
      },
      loadIndex: 2,
      builtin: true,
    });
    await th.settled();
    const service = th.host.ports.get(ModelServiceKey);
    if (service === undefined) throw new Error("xeon.models is missing");
    const threadId = th.newThread();
    await th.host.openThread(threadId);
    const resolved = service.resolve("main");
    if (!resolved.ok) throw new Error("main role does not resolve");
    const call = () =>
      service
        .stream({
          threadId,
          turnId: null,
          stepId: null,
          role: "main",
          resolved: resolved.value,
          context: { messages: [{ role: "user", content: "hi", timestamp: clock.now() }] },
        })
        .result();
    const blocked = await call();
    expect(blocked.stopReason).toBe("error");
    expect(blocked.errorMessage).toBe("[xeon:denied_by_guard] no model calls");
    expect(seen[0]).toMatchObject({ patched: true, was: { model: "tape-1" } });
    expect(fake.calls()).toEqual([]);
    mode = "throw";
    const thrown = await call();
    expect(thrown.stopReason).toBe("error");
    expect(thrown.errorMessage).toBe("[xeon:denied_by_guard] extension handler failed");
    expect(fake.calls()).toEqual([]);
    await th.host.dispose();
  });
});
