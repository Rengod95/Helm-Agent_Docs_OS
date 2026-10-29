import { describe, expect, test } from "bun:test";
import { parse, parseJson } from "@xeon/contracts";
import { CapabilityError, ScheduleEntries } from "@xeon/contracts/capabilities";
import { createScheduleApi } from "../src/index.ts";
import { createHarness, MemoryStore, SECOND, type Harness } from "./support/harness.ts";

/** 거부를 기다려 CapabilityError를 돌려준다. 거부하지 않거나 다른 값으로 거부하면 시험이 실패한다 */
async function rejectionOf(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected the call to reject with a CapabilityError");
}

/** 와이어를 흉내 낸다: JSON으로 보냈다가 받은 값 */
function overTheWire(value: unknown): unknown {
  const parsed = parseJson(JSON.stringify(value));
  if (!parsed.ok) throw new Error("the value is not JSON");
  return parsed.value;
}

/** 정착 뒤의 기록이 끝나도록 마이크로태스크를 비운다 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function apiOf(h: Harness) {
  return createScheduleApi(h.service);
}

describe("create", () => {
  test("returns the entry in the F view, and the input and the output satisfy the schemas over JSON", async () => {
    const h = createHarness();
    const api = apiOf(h);
    const input = {
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "check mail",
      title: "mail",
    } as const;
    const out = await api.create(input);
    expect(out.entry).toEqual({
      id: "sch_1",
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "check mail",
      workspace: null,
      title: "mail",
      sessionKind: "cron",
      enabled: true,
      createdAt: h.clock.now,
      nextDueAt: h.clock.now + 600 * SECOND,
      lastStartedAt: null,
      iterations: 0,
      stoppedReason: null,
    });
    expect(parse(ScheduleEntries.service.methods.create.input, overTheWire(input))).toEqual({
      ok: true,
      value: input,
    });
    expect(parse(ScheduleEntries.service.methods.create.output, overTheWire(out))).toEqual({
      ok: true,
      value: out,
    });
  });

  test("interval_too_short carries the minimum seconds as detail", async () => {
    const api = apiOf(createHarness());
    const error = await rejectionOf(
      api.create({ trigger: { kind: "interval", everySeconds: 299 }, prompt: "x" }),
    );
    expect(error).toBeInstanceOf(CapabilityError);
    expect(error.data).toEqual({
      capability: "schedule.entries",
      method: "create",
      code: "interval_too_short",
      message: "The interval is shorter than the minimum.",
      retryable: false,
      detail: { minSeconds: 300 },
    });
  });

  test("at_in_past has no detail", async () => {
    const h = createHarness();
    const error = await rejectionOf(
      apiOf(h).create({ trigger: { kind: "at", atMs: h.clock.now - 1 }, prompt: "x" }),
    );
    expect({ code: error.data.code, method: error.data.method, detail: error.data.detail }).toEqual(
      { code: "at_in_past", method: "create", detail: undefined },
    );
  });

  test("invalid_trigger carries the engine reason as detail", async () => {
    const error = await rejectionOf(
      apiOf(createHarness()).create({
        trigger: { kind: "file_watch", paths: [], debounceMs: 0 },
        prompt: "x",
      }),
    );
    expect({ code: error.data.code, detail: error.data.detail }).toEqual({
      code: "invalid_trigger",
      detail: { reason: "paths_empty" },
    });
  });

  test("limit_reached carries the maximum as detail", async () => {
    const api = apiOf(createHarness({ policy: { maxActive: 1 } }));
    expect((await api.create({ trigger: { kind: "remote" }, prompt: "a" })).entry.id).toBe("sch_1");
    const error = await rejectionOf(api.create({ trigger: { kind: "remote" }, prompt: "b" }));
    expect({ code: error.data.code, method: error.data.method, detail: error.data.detail }).toEqual(
      { code: "limit_reached", method: "create", detail: { max: 1 } },
    );
  });
});

describe("list", () => {
  test("filters by enabled and attaches the last run: null before a run, the fired run after a remote fire", async () => {
    const h = createHarness();
    const api = apiOf(h);
    await api.create({ trigger: { kind: "interval", everySeconds: 600 }, prompt: "timer" });
    const remote = await api.create({ trigger: { kind: "remote" }, prompt: "go" });
    await api.create({ trigger: { kind: "remote" }, prompt: "later", enabled: false });

    const all = await api.list({});
    expect(all.items.map((item) => [item.entry.id, item.lastRun])).toEqual([
      ["sch_1", null],
      ["sch_2", null],
      ["sch_3", null],
    ]);
    const off = await api.list({ enabled: false });
    expect(off.items.map((item) => item.entry.id)).toEqual(["sch_3"]);
    expect(off.items[0]?.entry.enabled).toBe(false);
    const on = await api.list({ enabled: true });
    expect(on.items.map((item) => item.entry.id)).toEqual(["sch_1", "sch_2"]);

    const fired = await api.fire({ scheduleId: remote.entry.id });
    expect(fired.run).toMatchObject({
      scheduleId: "sch_2",
      firedBy: "remote",
      status: "started",
      threadId: "thr_1",
      outcome: null,
      reason: null,
    });
    expect((await api.list({})).items[1]?.lastRun).toEqual(fired.run);

    h.runner.started[0]?.settle("completed");
    await flush();
    const after = await api.list({});
    expect(after.items[1]?.lastRun).toMatchObject({
      runId: fired.run.runId,
      status: "finished",
      outcome: "completed",
    });
    expect(parse(ScheduleEntries.service.methods.list.output, overTheWire(after))).toEqual({
      ok: true,
      value: after,
    });
    expect(parse(ScheduleEntries.service.methods.list.input, overTheWire({}))).toEqual({
      ok: true,
      value: {},
    });
  });

  test("a file watch entry's paths are a copy, not the engine's array", async () => {
    const h = createHarness();
    const api = apiOf(h);
    await api.create({
      trigger: { kind: "file_watch", paths: ["/work/notes"], debounceMs: 0 },
      prompt: "watch",
    });
    const listed = await api.list({});
    expect(listed.items[0]?.entry.trigger).toEqual({
      kind: "file_watch",
      paths: ["/work/notes"],
      debounceMs: 0,
    });
    const first = listed.items[0]?.entry.trigger;
    if (first?.kind !== "file_watch") throw new Error("expected a file watch trigger");
    first.paths.push("/elsewhere");
    expect((await api.list({})).items[0]?.entry.trigger).toEqual({
      kind: "file_watch",
      paths: ["/work/notes"],
      debounceMs: 0,
    });
  });
});

describe("cancel and fire", () => {
  test("cancel turns the entry off with cancelled, and an unknown id is not_found", async () => {
    const api = apiOf(createHarness());
    const made = await api.create({
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "x",
    });
    const cancelled = await api.cancel({ scheduleId: made.entry.id });
    expect(cancelled.entry).toMatchObject({
      id: "sch_1",
      enabled: false,
      nextDueAt: null,
      stoppedReason: "cancelled",
    });
    expect(parse(ScheduleEntries.service.methods.cancel.output, overTheWire(cancelled))).toEqual({
      ok: true,
      value: cancelled,
    });

    const error = await rejectionOf(api.cancel({ scheduleId: "sch_999" }));
    expect({ code: error.data.code, method: error.data.method }).toEqual({
      code: "not_found",
      method: "cancel",
    });
  });

  test("fire refuses an unknown id, a non-remote entry and a disabled one with their codes", async () => {
    const api = apiOf(createHarness());
    const timer = await api.create({
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "x",
    });
    const off = await api.create({ trigger: { kind: "remote" }, prompt: "y", enabled: false });

    const missing = await rejectionOf(api.fire({ scheduleId: "sch_404" }));
    expect({ code: missing.data.code, method: missing.data.method }).toEqual({
      code: "not_found",
      method: "fire",
    });
    const notRemote = await rejectionOf(api.fire({ scheduleId: timer.entry.id }));
    expect({ code: notRemote.data.code, method: notRemote.data.method }).toEqual({
      code: "not_remote",
      method: "fire",
    });
    const disabled = await rejectionOf(api.fire({ scheduleId: off.entry.id }));
    expect({ code: disabled.data.code, method: disabled.data.method }).toEqual({
      code: "disabled",
      method: "fire",
    });
  });
});

describe("failures at the boundary", () => {
  test("a store failure is store_failed with the store message, for a read and for a write", async () => {
    const store = new MemoryStore();
    const api = apiOf(createHarness({ store }));
    store.loadFailure = { kind: "store_failed", message: "state file is not valid JSON" };
    const read = await rejectionOf(api.list({}));
    expect(read.data).toMatchObject({
      code: "store_failed",
      method: "list",
      detail: { message: "state file is not valid JSON" },
    });

    store.loadFailure = null;
    store.failSaves = true;
    const write = await rejectionOf(api.create({ trigger: { kind: "remote" }, prompt: "x" }));
    expect({ code: write.data.code, method: write.data.method, detail: write.data.detail }).toEqual(
      { code: "store_failed", method: "create", detail: { message: "disk full" } },
    );
  });

  test("an aborted signal rejects with aborted before the service is touched", async () => {
    const store = new MemoryStore();
    const h = createHarness({ store });
    const api = apiOf(h);
    const controller = new AbortController();
    controller.abort();
    const signal = controller.signal;

    const created = await rejectionOf(
      api.create({ trigger: { kind: "remote" }, prompt: "x" }, { signal }),
    );
    expect({ code: created.data.code, method: created.data.method }).toEqual({
      code: "aborted",
      method: "create",
    });
    const listed = await rejectionOf(api.list({}, { signal }));
    expect(listed.data.code).toBe("aborted");
    expect(store.loads).toBe(0);
    expect(store.saves).toBe(0);
    expect(h.service.list()).toEqual([]);
  });
});
