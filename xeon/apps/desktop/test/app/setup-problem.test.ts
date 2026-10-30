import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_KEY, PROVIDERS_KEY, readyToChat, setupSteps } from "@xeon/client/settings";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// HS-80의 앱 쪽: 호스트가 `l1.models.default`에 `problem`(unknownModel)을 실으면 첫 실행 안내의 "기본 모델 선택" 단계는 끝나지 않는다.
// 가짜 엔진의 settings.get 응답으로 setup.load가 만든 스냅샷을 본다.

const MODEL = "anthropic/no-such-model-xyz";
const PROBLEM = { kind: "unknownModel", args: { id: MODEL } };
const PROVIDERS = [
  { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
];
const SECRETS = { secrets: [{ name: "anthropic-api-key", status: "valid" }] };

const setting = (key: string, value: unknown, problem?: unknown) => ({
  key,
  value,
  source: { scope: "user" },
  locked: false,
  shadowed: [],
  runtimeChange: "live",
  pendingUntil: null,
  deprecated: false,
  ...(problem === undefined ? {} : { problem }),
});

async function loadWithModel(model: unknown) {
  const engine = engineFake([summary(thr(1))], undefined, {
    results: {
      "settings.get": { settings: [model, setting(PROVIDERS_KEY, PROVIDERS)] },
      "secret.list": SECRETS,
    },
  });
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  const loaded = await app.commands.setup.load({ binaries: false });
  await app.stop();
  if (!loaded.ok) throw new Error("setup.load failed");
  return loaded.value;
}

describe("first-run guide and a saved default model the catalog lacks", () => {
  test("a default model with the unknownModel problem leaves the model step undone and the app not ready", async () => {
    const snapshot = await loadWithModel(setting(DEFAULT_MODEL_KEY, MODEL, PROBLEM));
    expect(snapshot.defaultModel).toBeNull();
    expect(setupSteps(snapshot).find((step) => step.id === "model")?.done).toBe(false);
    expect(readyToChat(snapshot)).toBe(false);
  });

  test("the same saved id without a problem counts as chosen and the app is ready", async () => {
    const id = "anthropic/claude-sonnet-5-5";
    const snapshot = await loadWithModel(setting(DEFAULT_MODEL_KEY, id));
    expect(snapshot.defaultModel).toBe(id);
    expect(setupSteps(snapshot).find((step) => step.id === "model")?.done).toBe(true);
    expect(readyToChat(snapshot)).toBe(true);
  });
});
