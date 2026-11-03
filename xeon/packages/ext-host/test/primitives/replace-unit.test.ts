import { expect, test } from "bun:test";
import { Type } from "typebox";
import type { RegistrationDef } from "@fresnel/contracts/extensions";
import type { ExtensionUnit } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeGroupUnit, makeManifest, makeUnit, snapshotOf } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;
type ThreadId = ReturnType<Host["newThread"]>;

const NAME = "rl-ext";

/** 한 번 일어난 핸들러 호출. `tag`가 어느 버전의 핸들러인지 말해 준다 */
function versioned(
  tag: string,
  log: string[],
  extra?: { readonly loadIndex?: number },
): ExtensionUnit {
  return makeUnit({ name: NAME, hooks: ["boundary.settle.after"], ...extra }, (g) => {
    g.on("boundary.settle.after", () => {
      log.push(tag);
    });
  });
}

async function fire(t: Host, thread: ThreadId, key: string): Promise<void> {
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

async function openWith(
  unit: ExtensionUnit,
  threads = 1,
): Promise<{ t: Host; threads: ThreadId[] }> {
  const t = await createTestHost();
  const opened = Array.from({ length: threads }, () => t.newThread());
  await eachInOrder(opened, async (thread) => {
    await t.host.openThread(thread);
    return "continue";
  });
  await t.host.install(unit);
  await t.settled();
  return { t, threads: opened };
}

function generationOf(t: Host): number | undefined {
  return t.host.registrations().find((info) => info.id === NAME)?.generation;
}

function kindsOf(t: Host, thread: ThreadId): string[] {
  return t.records.events(thread).map((event) => event.kind);
}

test("an open idle thread swaps at once and keeps its recorded enable", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log));
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  await fire(t, thread, "k0");
  const before = kindsOf(t, thread);
  const started = await t.host.replaceUnit(versioned("v2", log));
  if (!started.ok) throw new Error(`replace refused: ${started.error.kind}`);
  expect(started.value.appliesAt).toBe("now");
  expect(await started.value.applied).toEqual({ status: "applied", statesCleared: 0 });
  await t.settled();
  await fire(t, thread, "k1");
  expect(log).toEqual(["v1", "v2"]);
  expect(generationOf(t)).toBe(2);
  expect(t.host.registrations().find((info) => info.id === NAME)?.status).toBe("enabled");
  // 교체는 메모리 안의 일이다: 켜짐 기록은 늘지 않는다
  expect(kindsOf(t, thread)).toEqual(before);
});

test("a turn in progress is not cut: the old generation answers until the step boundary", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log));
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  t.loop.setRunning(thread, true);
  const started = await t.host.replaceUnit(versioned("v2", log));
  if (!started.ok) throw new Error("replace refused");
  expect(started.value.appliesAt).toBe("nextStepBoundary");
  // 같은 step 안의 디스패치는 옛 세대가 받는다
  await fire(t, thread, "k0");
  await fire(t, thread, "k1");
  expect(log).toEqual(["v1", "v1"]);
  expect(generationOf(t)).toBe(1);
  await t.boundary(thread).stepEnd();
  await t.settled();
  expect(await started.value.applied).toEqual({ status: "applied", statesCleared: 0 });
  await fire(t, thread, "k2");
  expect(log).toEqual(["v1", "v1", "v2"]);
  expect(generationOf(t)).toBe(2);
});

test("a handler of the old generation that is mid-flight finishes before the swap applies", async () => {
  const log: string[] = [];
  const gate = Promise.withResolvers<void>();
  const slow = makeUnit({ name: NAME, hooks: ["boundary.settle.after"] }, (g) => {
    g.on("boundary.settle.after", async () => {
      await gate.promise;
      log.push("v1-done");
    });
  });
  const { t, threads } = await openWith(slow);
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  t.loop.setRunning(thread, true);
  const running = fire(t, thread, "k0");
  const started = await t.host.replaceUnit(versioned("v2", log));
  if (!started.ok) throw new Error("replace refused");
  expect(started.value.appliesAt).toBe("nextStepBoundary");
  gate.resolve();
  await running;
  expect(log).toEqual(["v1-done"]);
  await t.boundary(thread).stepEnd();
  await t.settled();
  await fire(t, thread, "k1");
  expect(log).toEqual(["v1-done", "v2"]);
});

test("a new version whose entry throws is refused and the old one keeps running", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log));
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  const broken: ExtensionUnit = {
    manifest: makeManifest({ name: NAME, hooks: ["boundary.settle.after"] }),
    entry: () => {
      throw new Error("syntax broke");
    },
    loadIndex: 0,
    builtin: true,
  };
  const before = kindsOf(t, thread);
  const started = await t.host.replaceUnit(broken);
  expect(started.ok).toBe(false);
  if (started.ok) return;
  expect(started.error.kind).toBe("entry_failed");
  await fire(t, thread, "k0");
  expect(log).toEqual(["v1"]);
  expect(generationOf(t)).toBe(1);
  expect(kindsOf(t, thread)).toEqual(before);
});

test("a new version that does not register a declared plugin is refused", async () => {
  const log: string[] = [];
  const { t } = await openWith(versioned("v1", log));
  const empty: ExtensionUnit = {
    manifest: makeManifest({ name: NAME, hooks: ["boundary.settle.after"] }),
    entry: () => {},
    loadIndex: 0,
    builtin: true,
  };
  const started = await t.host.replaceUnit(empty);
  expect(started.ok ? "ok" : started.error).toEqual({
    kind: "plugins_unregistered",
    registrations: [NAME],
  });
});

test("a replace for an extension that is not installed is refused", async () => {
  const { t } = await openWith(versioned("v1", []));
  const other = makeUnit({ name: "rl-other" }, () => {});
  const started = await t.host.replaceUnit(other);
  expect(started.ok ? "ok" : started.error).toEqual({ kind: "not_installed" });
});

test("a setup that fails at the boundary restores the old generation and records nothing", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log));
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  const failing = makeUnit({ name: NAME, hooks: ["boundary.settle.after"] }, () => {
    throw new Error("setup exploded");
  });
  const before = kindsOf(t, thread);
  const started = await t.host.replaceUnit(failing);
  if (!started.ok) throw new Error("replace refused");
  const outcome = await started.value.applied;
  expect(outcome).toMatchObject({
    status: "failed",
    scopeId: NAME,
    restored: true,
    failedToRestore: [],
  });
  await t.settled();
  await fire(t, thread, "k0");
  expect(log).toEqual(["v1"]);
  expect(t.host.registrations().find((info) => info.id === NAME)?.status).toBe("enabled");
  expect(kindsOf(t, thread)).toEqual(before);
  expect(t.diagnostics.filter((entry) => entry.code === "registration_setup_failed")).toEqual([]);
  // 옛 정의로 다시 열렸으므로 다음 교체도 받는다
  const again = await t.host.replaceUnit(versioned("v3", log));
  if (!again.ok) throw new Error("replace refused");
  expect(await again.value.applied).toEqual({ status: "applied", statesCleared: 0 });
  await fire(t, thread, "k1");
  expect(log).toEqual(["v1", "v3"]);
});

test("a swap that cannot reopen the old definition either reports which scopes stayed off", async () => {
  const log: string[] = [];
  let calls = 0;
  const flaky = makeUnit({ name: NAME, hooks: ["boundary.settle.after"] }, (g) => {
    calls += 1;
    // 설치 때의 setup만 성공하고 그 뒤는 환경이 바뀌어 실패한다
    if (calls > 1) throw new Error("environment changed");
    g.on("boundary.settle.after", () => {
      log.push("v1");
    });
  });
  const { t, threads } = await openWith(flaky);
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  const started = await t.host.replaceUnit(
    makeUnit({ name: NAME, hooks: ["boundary.settle.after"] }, () => {
      throw new Error("v2 broke");
    }),
  );
  if (!started.ok) throw new Error("replace refused");
  expect(await started.value.applied).toMatchObject({
    status: "failed",
    restored: false,
    failedToRestore: [NAME],
  });
  await t.settled();
  expect(t.host.registrations().find((info) => info.id === NAME)?.status).toBe("disabled");
  await fire(t, thread, "k0");
  expect(log).toEqual([]);
});

test("a scope the new version drops goes off and a new scope starts at the next boundary", async () => {
  const log: string[] = [];
  const v1 = makeUnit(
    {
      name: NAME,
      hooks: ["boundary.settle.after"],
      extraPlugins: [{ id: "old", layer: "plugin", hooks: ["boundary.settle.after"] }],
    },
    (g) => {
      g.on("boundary.settle.after", () => {
        log.push("root");
      });
    },
  );
  const manifest = makeManifest({
    name: NAME,
    hooks: ["boundary.settle.after"],
    extraPlugins: [{ id: "added", layer: "plugin", hooks: ["boundary.settle.after"] }],
  });
  const v2: ExtensionUnit = {
    manifest,
    entry: ({ register }) => {
      register(NAME, {}, (g) => {
        g.on("boundary.settle.after", () => {
          log.push("root2");
        });
      });
      register(`${NAME}/added`, { defaultEnabled: true }, (g) => {
        g.on("boundary.settle.after", () => {
          log.push("added");
        });
      });
    },
    loadIndex: 0,
    builtin: true,
  };
  const { t, threads } = await openWith(v1);
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  expect(t.host.registrations().map((info) => info.id)).toEqual([NAME]);
  const started = await t.host.replaceUnit(v2);
  if (!started.ok) throw new Error("replace refused");
  await started.value.applied;
  await t.settled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(t.host.registrations().map((info) => info.id)).toEqual([NAME, `${NAME}/added`]);
  await fire(t, thread, "k0");
  expect(log.toSorted()).toEqual(["added", "root2"]);
});

test("two threads: the swap waits while another thread runs and applies at the first free boundary", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log), 2);
  const [a, b] = threads;
  if (a === undefined || b === undefined) throw new Error("no threads");
  t.loop.setRunning(a, true);
  t.loop.setRunning(b, true);
  const started = await t.host.replaceUnit(versioned("v2", log));
  if (!started.ok) throw new Error("replace refused");
  expect(started.value.appliesAt).toBe("nextStepBoundary");
  // 둘 다 실행 중인 동안은 어느 경계도 적용하지 않는다: 반대쪽 thread의 step이 옛 세대를 쓰고 있다
  await t.boundary(a).stepEnd();
  await t.boundary(b).stepEnd();
  await t.settled();
  await fire(t, a, "a0");
  await fire(t, b, "b0");
  expect(log).toEqual(["v1", "v1"]);
  // b의 turn이 끝났다. a의 다음 경계가 적용한다
  t.loop.setRunning(b, false);
  await t.boundary(a).stepEnd();
  await t.settled();
  expect(await started.value.applied).toEqual({ status: "applied", statesCleared: 0 });
  await fire(t, a, "a1");
  await fire(t, b, "b1");
  expect(log).toEqual(["v1", "v1", "v2", "v2"]);
  expect(generationOf(t)).toBe(2);
});

test("two idle threads swap together and both switch", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log), 2);
  const [a, b] = threads;
  if (a === undefined || b === undefined) throw new Error("no threads");
  const started = await t.host.replaceUnit(versioned("v2", log));
  if (!started.ok) throw new Error("replace refused");
  expect(started.value.appliesAt).toBe("now");
  await started.value.applied;
  await t.settled();
  log.length = 0;
  await fire(t, a, "a0");
  await fire(t, b, "b0");
  // 경계 정산이 따로 부르는 같은 지점의 디스패치가 섞일 수 있어 개수가 아니라 어느 세대가 받았는지만 본다
  expect(new Set(log)).toEqual(new Set(["v2"]));
  expect(log.length).toBeGreaterThanOrEqual(2);
});

test("a drive lock held by the old generation continues with the new drive function", async () => {
  const calls: string[] = [];
  const v1 = makeGroupUnit({ name: NAME }, (g) => {
    g.drive(async (loop) => {
      calls.push("v1");
      await loop.turn({ input: { kind: "user", content: "go" } });
    });
  });
  const v2 = makeGroupUnit({ name: NAME }, (g) => {
    g.drive(async (loop) => {
      calls.push("v2");
      await loop.turn({ input: { kind: "user", content: "go" } });
    });
  });
  const { t, threads } = await openWith(v1);
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  await t.settled();
  const held = t.host.leaseOf(thread);
  expect(held?.status).toBe("active");
  expect(calls).toEqual(["v1"]);
  const started = await t.host.replaceUnit(v2);
  if (!started.ok) throw new Error("replace refused");
  expect(await started.value.applied).toEqual({ status: "applied", statesCleared: 0 });
  await t.settled();
  // 임대는 반납되지 않았다
  expect(t.host.leaseOf(thread)?.leaseId).toBe(held?.leaseId);
  expect(t.host.leaseOf(thread)?.status).toBe("active");
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(calls.at(-1)).toBe("v2");
  // 교체가 임대를 거두지 않았다. 반납이 있다면 drive 함수가 두 번 일을 하지 않아 생기는 기존 규칙(idle)이다
  const released = t.records.events(thread).filter((event) => event.kind === "lease.released");
  for (const event of released) expect(event).toMatchObject({ payload: { reason: "idle" } });
  expect(calls).toEqual(["v1", "v2", "v2"]);
});

const stateV1 = {
  state: { schema: Type.Object({ n: Type.Integer() }), initial: { n: 0 }, version: 1 },
};
const stateV2 = {
  state: { schema: Type.Object({ text: Type.String() }), initial: { text: "fresh" }, version: 1 },
};

function counting<S>(def: RegistrationDef<S>, log: string[], tag: string): ExtensionUnit {
  return makeUnit({ name: NAME, hooks: ["boundary.settle.after"], def }, (g) => {
    g.on("boundary.settle.after", () => {
      log.push(tag);
    });
  });
}

test("a new version that cannot read the stored state fails and the old one keeps its state", async () => {
  const log: string[] = [];
  const unit = makeUnit({ name: NAME, hooks: ["boundary.settle.after"], def: stateV1 }, (g) => {
    g.on("boundary.settle.after", async () => {
      await g.commit({ n: 7 });
      log.push("v1");
    });
  });
  const { t, threads } = await openWith(unit);
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  await fire(t, thread, "k0");
  const started = await t.host.replaceUnit(counting(stateV2, log, "v2"));
  if (!started.ok) throw new Error("replace refused");
  expect(await started.value.applied).toMatchObject({
    status: "failed",
    code: "state_schema",
    restored: true,
  });
  await t.settled();
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ doc: { n: 7 } }]);
  await fire(t, thread, "k1");
  expect(log).toEqual(["v1", "v1"]);
});

test("resetRefusedState rewrites the refused state to the new initial and counts it", async () => {
  const log: string[] = [];
  const unit = makeUnit({ name: NAME, hooks: ["boundary.settle.after"], def: stateV1 }, (g) => {
    g.on("boundary.settle.after", async () => {
      await g.commit({ n: 7 });
      log.push("v1");
    });
  });
  const { t, threads } = await openWith(unit);
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  await fire(t, thread, "k0");
  const started = await t.host.replaceUnit(counting(stateV2, log, "v2"), {
    resetRefusedState: true,
  });
  if (!started.ok) throw new Error("replace refused");
  expect(await started.value.applied).toEqual({ status: "applied", statesCleared: 1 });
  await t.settled();
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ doc: { text: "fresh" } }]);
  await fire(t, thread, "k1");
  expect(log).toEqual(["v1", "v2"]);
});

test("a newer replace supersedes a waiting one, and uninstall or dispose cancel it", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log));
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  t.loop.setRunning(thread, true);
  const first = await t.host.replaceUnit(versioned("v2", log));
  const second = await t.host.replaceUnit(versioned("v3", log));
  if (!first.ok || !second.ok) throw new Error("replace refused");
  expect(await first.value.applied).toEqual({ status: "superseded" });
  await t.host.uninstall(NAME);
  expect(await second.value.applied).toEqual({ status: "cancelled" });
  expect(t.host.registrations()).toEqual([]);
});

test("a restart in the middle of a swap comes back to one generation of what is on disk", async () => {
  const log: string[] = [];
  const { t, threads } = await openWith(versioned("v1", log));
  const [thread] = threads;
  if (thread === undefined) throw new Error("no thread");
  t.loop.setRunning(thread, true);
  const started = await t.host.replaceUnit(versioned("v2", log));
  if (!started.ok) throw new Error("replace refused");
  // 적용 전에 프로세스가 죽었다. 디스크에는 v2가 있다(교체 파일이 먼저 놓였다)
  // 다시 시작한 프로세스에는 실행 중인 turn이 없다
  t.loop.setRunning(thread, false);
  const restarted = await t.restart();
  await restarted.host.openThread(thread);
  await restarted.host.install(versioned("v2", log));
  await restarted.settled();
  await restarted.host.dispatch(
    "boundary.settle.after",
    { turnId: restarted.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "after-restart" },
  );
  expect(log).toEqual(["v2"]);
  expect(restarted.host.registrations().filter((info) => info.id === NAME)).toHaveLength(1);
  expect(restarted.host.registrations().find((info) => info.id === NAME)?.generation).toBe(1);
  // 옛 호스트의 기다리던 교체는 호스트가 해제되면 취소로 끝난다
  await t.host.dispose();
  expect(await started.value.applied).toEqual({ status: "cancelled" });
});
