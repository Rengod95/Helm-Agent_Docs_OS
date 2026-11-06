import { describe, expect, test } from "bun:test";
import { sharedIntents } from "../src/main/intents.ts";
import { createShellIntentsModule, shellIntentsModule } from "../src/main/shell-intents.ts";
import { createFakeContext } from "./fake-context.ts";

describe("shell intent commands", () => {
  test("shell_take_intents hands over the shared queue in order and empties it", async () => {
    // 앞 시험이 남긴 의도를 비운다
    sharedIntents.take(Date.now());
    const fake = createFakeContext();
    createShellIntentsModule().register(fake.ctx);
    sharedIntents.push({ kind: "newThread" }, Date.now());
    sharedIntents.push({ kind: "openThread", threadId: "t-1" }, Date.now());
    expect(await fake.dispatch("shell_take_intents", null)).toEqual({
      ok: true,
      value: [{ kind: "newThread" }, { kind: "openThread", threadId: "t-1" }],
    });
    expect(await fake.dispatch("shell_take_intents", null)).toEqual({ ok: true, value: [] });
  });

  test("shell_take_intents drops intents older than thirty seconds", async () => {
    sharedIntents.take(Date.now());
    const fake = createFakeContext();
    createShellIntentsModule().register(fake.ctx);
    const now = Date.now();
    sharedIntents.push({ kind: "openThread", threadId: "old" }, now - 60_000);
    sharedIntents.push({ kind: "newThread" }, now);
    expect(await fake.dispatch("shell_take_intents", null)).toEqual({
      ok: true,
      value: [{ kind: "newThread" }],
    });
  });

  test("notify_take_target answers null and leaves the queue alone", async () => {
    sharedIntents.take(Date.now());
    const fake = createFakeContext();
    createShellIntentsModule().register(fake.ctx);
    sharedIntents.push({ kind: "newThread" }, Date.now());
    expect(await fake.dispatch("notify_take_target", null)).toEqual({ ok: true, value: null });
    expect(await fake.dispatch("shell_take_intents", null)).toEqual({
      ok: true,
      value: [{ kind: "newThread" }],
    });
  });

  test("the exported module registers the same two commands", async () => {
    sharedIntents.take(Date.now());
    const fake = createFakeContext();
    shellIntentsModule.register(fake.ctx);
    expect(await fake.dispatch("notify_take_target", null)).toEqual({ ok: true, value: null });
    expect(await fake.dispatch("shell_take_intents", null)).toEqual({ ok: true, value: [] });
  });
});
