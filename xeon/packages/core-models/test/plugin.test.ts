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
  points: ["before_provider_request"],
  usesDrive: false,
  trust: { level: "builtin" },
});

const patcherEntry: ExtensionEntry = ({ manifest: own, scope }) => {
  scope(own.name, {}, (g) => {
    g.on("before_provider_request", (payload) => ({
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

  test("installs into ext-host, provides xeon.models, and fires before_provider_request through xeon.ext", async () => {
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
});
