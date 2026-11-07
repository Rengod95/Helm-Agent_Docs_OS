import { describe, expect, test } from "bun:test";
import { denialStepOf, modelKeyOf, type DenialTrack } from "../../src/views/denied-model-model.ts";
import { summary, thr } from "../state/helpers.ts";

const DENIED = "403 permission_error: forbidden for this key";
const UNAUTHORIZED = "401 authentication_error";
const DEFAULT = "openai/gpt-default";

function start(model?: string) {
  return summary(thr(1), { status: "running", ...(model === undefined ? {} : { model }) });
}

function end(model?: string) {
  return summary(thr(1), { status: "idle", ...(model === undefined ? {} : { model }) });
}

describe("denied model key", () => {
  test("the key is provider/modelId without the thinking level", () => {
    expect(modelKeyOf("anthropic/claude-sonnet-5-5:high")).toBe("anthropic/claude-sonnet-5-5");
    expect(modelKeyOf("anthropic/claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5-5");
    expect(modelKeyOf("no-slash")).toBeNull();
    expect(modelKeyOf(null)).toBeNull();
  });
});

describe("denial step", () => {
  test("a running thread records the model it started with, not a model picked later", () => {
    const first = denialStepOf({
      track: {},
      threads: [start("anthropic/a:high")],
      failures: {},
      defaultModel: DEFAULT,
    });
    expect(first.track).toEqual({ [thr(1)]: "anthropic/a" });
    const mid = denialStepOf({
      track: first.track,
      threads: [start("anthropic/b")],
      failures: {},
      defaultModel: DEFAULT,
    });
    expect(mid.track).toEqual({ [thr(1)]: "anthropic/a" });
    expect(mid.denied).toEqual([]);
    expect(mid.allowed).toEqual([]);
  });

  test("a turn that ends with 403 marks its model as denied", () => {
    const step = denialStepOf({
      track: { [thr(1)]: "anthropic/a" },
      threads: [end("anthropic/a")],
      failures: { [thr(1)]: DENIED },
      defaultModel: DEFAULT,
    });
    expect(step).toEqual({ track: {}, denied: ["anthropic/a"], allowed: [] });
  });

  test("a turn that ends without a failure clears its model", () => {
    const step = denialStepOf({
      track: { [thr(1)]: "anthropic/a" },
      threads: [end("anthropic/a")],
      failures: {},
      defaultModel: DEFAULT,
    });
    expect(step).toEqual({ track: {}, denied: [], allowed: ["anthropic/a"] });
  });

  test("a turn that fails with another kind changes nothing", () => {
    const step = denialStepOf({
      track: { [thr(1)]: "anthropic/a" },
      threads: [end("anthropic/a")],
      failures: { [thr(1)]: UNAUTHORIZED },
      defaultModel: DEFAULT,
    });
    expect(step).toEqual({ track: {}, denied: [], allowed: [] });
  });

  test("a thread without its own model uses the default model", () => {
    const started = denialStepOf({
      track: {},
      threads: [start()],
      failures: {},
      defaultModel: DEFAULT,
    });
    expect(started.track).toEqual({ [thr(1)]: DEFAULT });
    const ended = denialStepOf({
      track: started.track,
      threads: [end()],
      failures: { [thr(1)]: DENIED },
      defaultModel: DEFAULT,
    });
    expect(ended.denied).toEqual([DEFAULT]);
  });

  test("an idle thread that was never seen running is not judged from an old failure", () => {
    const step = denialStepOf({
      track: {},
      threads: [end("anthropic/a")],
      failures: { [thr(1)]: DENIED },
      defaultModel: DEFAULT,
    });
    expect(step).toEqual({ track: {}, denied: [], allowed: [] });
  });

  test("a running thread's track is dropped once the thread leaves the list", () => {
    const track: DenialTrack = { [thr(1)]: "anthropic/a" };
    const step = denialStepOf({ track, threads: [], failures: {}, defaultModel: DEFAULT });
    expect(step.track).toEqual({});
  });
});
