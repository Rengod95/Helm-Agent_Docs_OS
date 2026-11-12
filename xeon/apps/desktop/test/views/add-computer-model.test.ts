import { describe, expect, test } from "bun:test";
import {
  addressSummaryOf,
  addReducer,
  canStart,
  cardStatusOf,
  checkRowsOf,
  formatPairCode,
  initialAddState,
  kindBadgeOf,
  pairCodeReady,
  parseSshInput,
  pickedTargetOf,
  probeNoticeOf,
  saveProblemOf,
  socketTextOk,
  sshSavedAddressOf,
  sshTargetOfDraft,
  webEndpointOf,
} from "../../src/views/pages/connection/add-computer-model.ts";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  PROBE_IDLE,
  probeReducer,
} from "../../src/views/pages/connection/connection-probe-model.ts";

describe("parseSshInput", () => {
  test("takes the usual forms", () => {
    expect(parseSshInput("dev@10.0.0.5")).toEqual({
      ok: true,
      target: "dev@10.0.0.5",
      label: "10.0.0.5",
    });
    expect(parseSshInput("dev@box:2222")).toEqual({
      ok: true,
      target: "dev@box:2222",
      label: "box",
    });
    expect(parseSshInput("ssh dev@box -p 2222")).toEqual({
      ok: true,
      target: "dev@box:2222",
      label: "box",
    });
    expect(parseSshInput("-p2222 box")).toEqual({ ok: true, target: "box:2222", label: "box" });
    expect(parseSshInput("ssh://dev@box:22")).toEqual({
      ok: true,
      target: "dev@box:22",
      label: "box",
    });
    expect(parseSshInput("dev@[::1]:2200")).toEqual({
      ok: true,
      target: "dev@[::1]:2200",
      label: "::1",
    });
  });

  test("refuses empty, two hosts, bad ports and two ports", () => {
    expect(parseSshInput("").ok).toBe(false);
    expect(parseSshInput("a b").ok).toBe(false);
    expect(parseSshInput("box -p 70000").ok).toBe(false);
    expect(parseSshInput("box:22 -p 23").ok).toBe(false);
    expect(parseSshInput("dev@").ok).toBe(false);
    expect(parseSshInput("b/x").ok).toBe(false);
  });
});

describe("wizard inputs", () => {
  const host = { name: "work", hostName: "10.0.0.5", user: "dev", port: 2222, proxyJump: false };

  test("a picked host is checked by its alias", () => {
    expect(pickedTargetOf(host)).toBe("dev@work");
    expect(sshTargetOfDraft({ picked: "work", typed: "", socket: "" }, [host])).toEqual({
      target: "dev@work",
      label: "work",
    });
    // 직접 입력이 있으면 그것이 먼저다
    expect(sshTargetOfDraft({ picked: "work", typed: "me@other", socket: "" }, [host])).toEqual({
      target: "me@other",
      label: "other",
    });
  });

  test("picking clears the typed field and typing clears the pick", () => {
    const typed = addReducer(initialAddState("ssh"), { type: "typed", text: "a@b" });
    const picked = addReducer(typed, { type: "pick", name: "work" });
    expect(picked.ssh).toEqual({ picked: "work", typed: "", socket: "" });
    expect(addReducer(picked, { type: "typed", text: "x" }).ssh.picked).toBeNull();
  });

  test("start needs a target and a valid service address", () => {
    const state = addReducer(initialAddState("ssh"), { type: "typed", text: "a@b" });
    expect(canStart(state, [])).toBe(true);
    expect(canStart(addReducer(state, { type: "socket", text: "relative" }), [])).toBe(false);
    expect(socketTextOk("")).toBe(true);
    expect(socketTextOk("/run/f.sock")).toBe(true);
    expect(canStart(initialAddState("web"), [])).toBe(false);
  });

  test("the service address override replaces the found one", () => {
    expect(sshSavedAddressOf("ssh://dev@box/run/a.sock", "")).toBe("ssh://dev@box/run/a.sock");
    expect(sshSavedAddressOf("ssh://dev@box:2222/run/a.sock", "/tmp/b.sock")).toBe(
      "ssh://dev@box:2222/tmp/b.sock",
    );
  });

  test("a web address gets the default port", () => {
    expect(webEndpointOf("https://my-mac.ts.net")).toEqual({
      host: "my-mac.ts.net",
      port: 8443,
      base: "wss://my-mac.ts.net:8443",
    });
    expect(webEndpointOf("")).toBeNull();
  });

  test("the code field keeps letters and digits, uppercases and adds the dash", () => {
    expect(formatPairCode("abcde")).toBe("ABCDE");
    expect(formatPairCode("abcde1")).toBe("ABCDE-1");
    expect(formatPairCode(" abcde - 12345 xyz")).toBe("ABCDE-12345");
    expect(pairCodeReady("ABCDE-12345")).toBe(true);
    expect(pairCodeReady("ABCDE-1234")).toBe(false);
  });

  test("saving needs a name and a new address", () => {
    const items = [{ id: "a", label: "a", address: "ssh://a/run/f.sock" }];
    expect(saveProblemOf(items, " ", "ssh://b/run/f.sock")).toBe(
      "desktop.connection.add.save.empty",
    );
    expect(saveProblemOf(items, "b", "ssh://a/run/f.sock")).toBe(
      "desktop.connection.add.save.duplicate",
    );
    expect(saveProblemOf(items, "b", "ssh://b/run/f.sock")).toBeNull();
  });

  test("passing fills the name with the suggestion; back clears the check", () => {
    const started = addReducer(initialAddState("ssh"), { type: "start" });
    expect(started.step).toBe("check");
    expect(started.probe.busy).toBe(true);
    const passed = addReducer(started, {
      type: "passed",
      ready: { address: "ssh://a/run/f.sock", suggested: "a", version: null, ms: null },
    });
    expect(passed.step).toBe("save");
    expect(passed.label).toBe("a");
    const back = addReducer(passed, { type: "back" });
    expect(back.step).toBe("method");
    expect(back.ready).toBeNull();
  });
});

describe("check rows", () => {
  test("missing steps wait while running and are skipped after a stop", () => {
    const running = probeReducer(PROBE_IDLE, { type: "begin" });
    expect(checkRowsOf(running).map((row) => row.state)).toEqual([
      "running",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    const stopped = probeReducer(running, {
      type: "stopped",
      outcome: { ok: false, step: "connect", status: "fail", code: "timeout", actions: ["retry"] },
    });
    const rows = checkRowsOf(stopped);
    expect(rows.map((row) => row.state)).toEqual([
      "skipped",
      "failed",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(rows[1]?.detail?.key).toBe("desktop.connection.preflight.cause.timeout");
    expect(rows[1]?.fix?.key).toBe("desktop.connection.preflight.fix.timeout");
    expect(probeNoticeOf(stopped)).toBeNull();
  });

  test("a service the app started says so", () => {
    const probe = probeReducer(probeReducer(PROBE_IDLE, { type: "begin" }), {
      type: "step",
      event: {
        step: "service",
        status: "pass",
        code: "ok",
        durationMs: 30,
        actions: [],
        detail: { action: "started_service" },
      },
    });
    expect(checkRowsOf(probe)[3]?.detail?.key).toBe("desktop.connection.add.serviceStarted");
  });

  test("codes with their own notice drop the generic fix line", () => {
    const probe = probeReducer(probeReducer(PROBE_IDLE, { type: "begin" }), {
      type: "stopped",
      outcome: {
        ok: false,
        step: "install",
        status: "fail",
        code: "not_installed",
        actions: [],
        fix: { commands: [], hint: "path_noninteractive" },
      },
    });
    expect(checkRowsOf(probe)[2]?.fix).toBeNull();
    expect(probeNoticeOf(probe)).toEqual({ kind: "notInstalled" });
  });

  test("a shell failure is a request-failed notice", () => {
    const probe = probeReducer(probeReducer(PROBE_IDLE, { type: "begin" }), { type: "failed" });
    expect(probeNoticeOf(probe)).toEqual({ kind: "requestFailed" });
  });
});

describe("cards", () => {
  test("address summary and kind badge", () => {
    expect(addressSummaryOf("ssh://dev@box:2222/run/f.sock")).toBe("dev@box:2222");
    expect(addressSummaryOf(`wss://h.ts.net:8443/pin/${"a".repeat(64)}`)).toBe("h.ts.net:8443");
    expect(kindBadgeOf("ssh://box/run/f.sock")).toBe("desktop.connection.computers.badge.ssh");
    expect(kindBadgeOf("unix:/run/f.sock")).toBe("desktop.connection.computers.badge.local");
    expect(kindBadgeOf("nope")).toBeNull();
  });

  test("status: in use, connecting, failed or none", () => {
    const entry = { id: "a", label: "a", address: "ssh://a/run/f.sock" };
    const choice = { kind: "remote", entry } as const;
    const listed = connectionReducer(INITIAL_CONNECTION_STATE, {
      type: "targetsChanged",
      items: [entry],
      notice: null,
      added: false,
    });
    expect(cardStatusOf(listed, null, choice)).toBeNull();
    const current = connectionReducer(listed, {
      type: "engineTargetSeen",
      target: { kind: "remote", address: entry.address, label: "a" },
    });
    expect(
      cardStatusOf(current, { kind: "starting", source: "sidecar", attempt: 1 }, choice)?.key,
    ).toBe("desktop.connection.computers.connecting");
    const offline = connectionReducer(current, { type: "statusFailed", reason: "offline" });
    expect(cardStatusOf(offline, null, choice)?.tone).toBe("warning");
  });
});
