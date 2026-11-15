import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import { watchServiceEngine } from "../../src/app/service-engine.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { ServiceStatusReply } from "../../src/transport/ipc.ts";
import { harness, STORE, SUB } from "../state/helpers.ts";

const AUTOSTART = {
  supported: true,
  registered: false,
  active: false,
  linger: null,
  platform: "darwin",
} as const;

function running(extra: {
  engineOutdated?: boolean;
  engineReplaced?: boolean;
}): ServiceStatusReply {
  return {
    running: true,
    socket: "/tmp/fresnel.sock",
    pid: 10,
    version: "0.0.0",
    startedAt: 1,
    autostart: AUTOSTART,
    ...extra,
  };
}

/** 엔진을 running으로 올리고 연결을 live로 만든 뒤 비동기 읽기가 끝나기를 기다린다 */
async function goLive(h: ReturnType<typeof harness>): Promise<void> {
  h.store.ingest({ type: "engine", state: { kind: "running", source: "service", pid: 1 } });
  h.store.flush();
  h.store.ingest({
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 0,
    live: true,
    from: "head",
  });
  h.store.flush();
  await Promise.resolve();
  await Promise.resolve();
}

function rig(reply: ServiceStatusReply, target: "local" | "remote" = "local") {
  const h = harness();
  const ui = createUiStore();
  if (target === "remote") {
    ui.actions.setEngineTarget({ kind: "remote", address: "ssh://box", label: "box" });
  }
  const reports: unknown[] = [];
  const seen = { replaced: 0, reads: 0, reports };
  const stop = watchServiceEngine({
    engine: h.store.read,
    ui,
    serviceStatus: () => {
      seen.reads += 1;
      return Promise.resolve(ok(reply));
    },
    onReplaced: () => {
      seen.replaced += 1;
    },
    report: (cause) => {
      seen.reports.push(cause);
    },
  });
  return { h, ui, seen, stop };
}

describe("watchServiceEngine", () => {
  test("a service restarted at launch is announced once, and nothing is added to the restart list", async () => {
    const r = rig(running({ engineReplaced: true }));
    await goLive(r.h);
    expect(r.seen.replaced).toBe(1);
    expect(r.ui.read.getState().restartNeeded).toEqual([]);
    r.stop();
  });

  test("a busy older service raises the engine_outdated reason, once even when read again", async () => {
    const r = rig(running({ engineOutdated: true }));
    await goLive(r.h);
    expect(r.seen.replaced).toBe(0);
    expect(r.ui.read.getState().restartNeeded).toEqual([{ kind: "engine_outdated", name: "" }]);
    r.ui.actions.noteRestartNeeded({ kind: "engine_outdated", name: "" });
    expect(r.ui.read.getState().restartNeeded).toHaveLength(1);
    r.stop();
  });

  test("a current service raises nothing", async () => {
    const r = rig(running({}));
    await goLive(r.h);
    expect(r.seen.reads).toBe(1);
    expect(r.seen.replaced).toBe(0);
    expect(r.ui.read.getState().restartNeeded).toEqual([]);
    r.stop();
  });

  test("a remote target never asks about the local service", async () => {
    const r = rig(running({ engineOutdated: true }), "remote");
    await goLive(r.h);
    expect(r.seen.reads).toBe(0);
    expect(r.ui.read.getState().restartNeeded).toEqual([]);
    r.stop();
  });
});
