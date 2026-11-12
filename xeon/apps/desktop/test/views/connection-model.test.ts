import { describe, expect, test } from "bun:test";
import {
  attachErrorKey,
  attachFixKey,
  TARGET_SEARCH_THRESHOLD,
  type AttachFailureKind,
  type TargetEntry,
} from "@fresnel/client";
import { catalogOf } from "@fresnel/client/i18n";
import { updateLineKey } from "@fresnel/client/settings";
import type { HostClientView } from "@fresnel/contracts/wire";
import type { EngineState, Link } from "../../src/state/engine/index.ts";
import type { ServiceCard } from "../../src/views/commands.ts";
import {
  attachFailureOf,
  attachFailureOfExit,
  canConnect,
  canSetRemoteRespond,
  canStopService,
  clientsReasonOf,
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  LOCAL_CHOICE,
  reconnectStatusOf,
  renamedList,
  sameChoice,
  searchShown,
  stepsOf,
  visibleTargets,
  type ConnectionAction,
  type ConnectionState,
  type TargetChoice,
} from "../../src/views/pages/connection/connection-model.ts";
import { transportMessageOf } from "../../src/views/pages/connection/connection-text.ts";

// 연결 화면(P-08)의 상태 기계. 대상 고르기, 진행 단계, 실패 종류, 셸 거절 되돌리기를 값으로 비교한다.

const BUILD: TargetEntry = {
  id: "a",
  label: "build-box",
  address: "ssh://me@build/run/fresnel.sock",
};
const MINI: TargetEntry = {
  id: "b",
  label: "mac-mini",
  address: "unix:/run/user/501/fresnel.sock",
};
const REMOTE_BUILD: TargetChoice = { kind: "remote", entry: BUILD };

function withItems(items: readonly TargetEntry[]): ConnectionState {
  return connectionReducer(INITIAL_CONNECTION_STATE, {
    type: "targetsChanged",
    items,
    notice: null,
    added: false,
  });
}

function run(state: ConnectionState, ...actions: readonly ConnectionAction[]): ConnectionState {
  return actions.reduce(connectionReducer, state);
}

/** 엔진 관찰 한 줄을 만든다. 연결 실패는 없다고 본다 */
function seen(
  engine: EngineState | null,
  link: "offline" | "connecting" | "syncing" | "live" | "failed" = "offline",
  connectError: string | null = null,
): ConnectionAction {
  return { type: "engineSeen", observed: { engine, link, connectError } };
}

const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 42 };

/** 요청을 보낼 때의 관찰. 기본은 엔진이 떠 있고 연결은 아직 없는 상태다 */
function started(
  target: TargetChoice,
  engine: EngineState | null = RUNNING,
  link: Link["phase"] = "offline",
): ConnectionAction {
  return { type: "connectStarted", target, observed: { engine, link, connectError: null } };
}

describe("host identity", () => {
  test("the same host is the same choice by id, whatever its label, and this computer is only itself", () => {
    expect(
      sameChoice(REMOTE_BUILD, { kind: "remote", entry: { ...BUILD, label: "renamed" } }),
    ).toBe(true);
    expect(sameChoice(REMOTE_BUILD, LOCAL_CHOICE)).toBe(false);
    expect(sameChoice(LOCAL_CHOICE, { kind: "local" })).toBe(true);
  });
});

/** `count`개의 대상. 네 번째만 검색어 "needle"을 이름에 가진다 */
function many(count: number): TargetEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: i === 3 ? "needle-box" : `box-${i}`,
    address: `unix:/run/box${i}.sock`,
  }));
}

describe("the search box appears only past the threshold", () => {
  test("the threshold is twenty and twenty targets show no search", () => {
    expect(TARGET_SEARCH_THRESHOLD).toBe(20);
    expect(searchShown(many(TARGET_SEARCH_THRESHOLD))).toBe(false);
    expect(searchShown(many(TARGET_SEARCH_THRESHOLD + 1))).toBe(true);
  });

  test("with the search shown, the query filters the list; without it the query is ignored", () => {
    const long = { ...withItems(many(21)), query: "needle" };
    expect(visibleTargets(long).map((item) => item.id)).toEqual(["n3"]);
    const short = { ...withItems(many(20)), query: "needle" };
    expect(visibleTargets(short)).toHaveLength(20);
  });
});

describe("connect button on each host row", () => {
  test("a row's connect is off for the host the engine already points at, and on for another host", () => {
    const state = withItems([BUILD]);
    expect(canConnect(state, LOCAL_CHOICE)).toBe(false);
    expect(canConnect(state, REMOTE_BUILD)).toBe(true);
  });

  test("every row's connect is off while a connect is pending or a write is busy", () => {
    const pending = run(withItems([BUILD]), started(REMOTE_BUILD));
    expect(canConnect(pending, LOCAL_CHOICE)).toBe(false);
    expect(canConnect(pending, REMOTE_BUILD)).toBe(false);
    const busy = { ...withItems([BUILD]), busy: true };
    expect(canConnect(busy, REMOTE_BUILD)).toBe(false);
  });
});

describe("connect progress follows the engine state", () => {
  test("starting a connect records the target and what the engine pointed at before", () => {
    const state = run(withItems([BUILD]), started(REMOTE_BUILD));
    expect(state.pending).toEqual({
      target: REMOTE_BUILD,
      prior: LOCAL_CHOICE,
      stage: "requested",
      attempt: 0,
      from: { engine: "running", link: "offline" },
      moved: false,
    });
    expect(state.engineTarget).toEqual(REMOTE_BUILD);
  });

  test("the stages move with stopping, restarting and starting, and the restart carries its attempt", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const stopping = connectionReducer(start, seen({ kind: "stopping" }));
    expect(stopping.pending?.stage).toBe("stopping");
    const restarting = connectionReducer(
      stopping,
      seen({
        kind: "restarting",
        attempt: 2,
        retryAt: "2026-11-04T01:00:00.000Z",
        lastExit: { code: 1, signal: null, at: "2026-11-04T01:00:00.000Z" },
      }),
    );
    expect(restarting.pending).toEqual({
      target: REMOTE_BUILD,
      prior: LOCAL_CHOICE,
      stage: "restarting",
      attempt: 2,
      from: { engine: "running", link: "offline" },
      moved: true,
    });
    expect(
      connectionReducer(restarting, seen({ kind: "starting", source: "sidecar", attempt: 0 }))
        .pending?.stage,
    ).toBe("starting");
  });

  test("a running engine that is not yet linked is the sync stage, and the live link finishes the connect", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const syncing = connectionReducer(start, seen(RUNNING, "connecting"));
    expect(syncing.pending?.stage).toBe("syncing");
    const done = connectionReducer(syncing, seen(RUNNING, "live"));
    expect(done.pending).toBeNull();
    expect(done.failure).toBeNull();
    expect(done.notice).toEqual({ tone: "success", id: "desktop.connection.connected" });
    expect(done.engineTarget).toEqual(REMOTE_BUILD);
  });

  test("an engine that still reads failed when the request is sent does not fail the new attempt", () => {
    const failedEngine: EngineState = {
      kind: "failed",
      attempts: 3,
      lastExit: { code: 1, signal: null, at: "2026-11-04T01:00:00.000Z" },
    };
    const start = run(withItems([BUILD]), started(REMOTE_BUILD, failedEngine));
    // 낡은 실패 관찰(요청 때와 같은 값)은 무시한다
    const stale = connectionReducer(start, seen(failedEngine));
    expect(stale).toBe(start);
    // 다시 띄우기가 시작되면 진행이고, 그 뒤 연결이 맞으면 끝난다
    const starting = connectionReducer(
      stale,
      seen({ kind: "starting", source: "sidecar", attempt: 0 }),
    );
    expect(starting.pending?.stage).toBe("starting");
    expect(starting.failure).toBeNull();
    const done = connectionReducer(starting, seen(RUNNING, "live"));
    expect(done.pending).toBeNull();
    expect(done.notice).toEqual({ tone: "success", id: "desktop.connection.connected" });
  });

  test("a connect error raised after the request fails the attempt even before any engine change", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const refused = connectionReducer(start, {
      type: "engineSeen",
      observed: { engine: RUNNING, link: "offline", connectError: "hello:1004" },
    });
    expect(refused.failure).toEqual({ kind: "auth", target: REMOTE_BUILD, retry: "restart" });
  });

  test("an observation with no connect in progress changes nothing", () => {
    const state = withItems([BUILD]);
    expect(
      connectionReducer(
        state,
        seen({
          kind: "failed",
          attempts: 3,
          lastExit: { code: 1, signal: null, at: "2026-11-04T01:00:00.000Z" },
        }),
      ),
    ).toBe(state);
  });

  test("a second connect is not started while one is pending", () => {
    const first = run(withItems([BUILD]), started(REMOTE_BUILD));
    expect(connectionReducer(first, started(LOCAL_CHOICE))).toBe(first);
  });

  test("the steps mark the done ones before the current one", () => {
    expect(stepsOf("requested")).toEqual([
      { id: "stop", status: "now" },
      { id: "start", status: "todo" },
      { id: "sync", status: "todo" },
    ]);
    expect(stepsOf("starting")).toEqual([
      { id: "stop", status: "done" },
      { id: "start", status: "now" },
      { id: "sync", status: "todo" },
    ]);
    expect(stepsOf("syncing")).toEqual([
      { id: "stop", status: "done" },
      { id: "start", status: "done" },
      { id: "sync", status: "now" },
    ]);
  });
});

describe("failures keep the target and say how to retry", () => {
  test("a failed engine is an other failure to restart from", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const failed = connectionReducer(
      start,
      seen({
        kind: "failed",
        attempts: 3,
        lastExit: { code: 1, signal: null, at: "2026-11-04T01:00:00.000Z" },
      }),
    );
    expect(failed.pending).toBeNull();
    expect(failed.failure).toEqual({ kind: "other", target: REMOTE_BUILD, retry: "restart" });
  });

  test("an auth refusal from hello is the auth failure, and the remote engine is still there to go back from", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const refused = connectionReducer(start, seen(RUNNING, "offline", "hello:1004"));
    expect(refused.failure).toEqual({ kind: "auth", target: REMOTE_BUILD, retry: "restart" });
  });

  test("a failed engine whose exit line names the cause fails with that kind and keeps the target", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const socket = connectionReducer(
      start,
      seen({
        kind: "failed",
        attempts: 3,
        lastExit: {
          code: 3,
          signal: null,
          at: "2026-11-04T01:00:00.000Z",
          detail: "The service socket does not exist",
        },
      }),
    );
    expect(socket.pending).toBeNull();
    expect(socket.failure).toEqual({
      kind: "socketMissing",
      target: REMOTE_BUILD,
      retry: "restart",
    });
    const token = connectionReducer(
      start,
      seen({
        kind: "failed",
        attempts: 3,
        lastExit: {
          code: 3,
          signal: null,
          at: "2026-11-04T01:00:00.000Z",
          detail: "The remote access token is missing",
        },
      }),
    );
    expect(token.failure).toEqual({ kind: "tokenMissing", target: REMOTE_BUILD, retry: "restart" });
  });

  test("a link that failed is an other failure", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    expect(connectionReducer(start, seen(RUNNING, "failed")).failure).toEqual({
      kind: "other",
      target: REMOTE_BUILD,
      retry: "restart",
    });
  });

  test("a refused retarget puts the engine back on the prior target and retries as a connect", () => {
    const start = run(withItems([BUILD]), started(REMOTE_BUILD));
    const rejected = connectionReducer(start, { type: "connectRejected", kind: "other" });
    expect(rejected.pending).toBeNull();
    expect(rejected.engineTarget).toEqual(LOCAL_CHOICE);
    expect(rejected.failure).toEqual({ kind: "other", target: REMOTE_BUILD, retry: "connect" });
  });

  test("starting again clears the failure", () => {
    const failed = connectionReducer(
      run(withItems([BUILD]), started(REMOTE_BUILD)),
      seen({
        kind: "failed",
        attempts: 1,
        lastExit: { code: 1, signal: null, at: "2026-11-04T01:00:00.000Z" },
      }),
    );
    expect(connectionReducer(failed, started(LOCAL_CHOICE)).failure).toBeNull();
  });

  test("the connect error codes map to the attach failure kinds, and anything else is other", () => {
    expect(attachFailureOf(null)).toBeNull();
    expect(attachFailureOf("hello:1004")).toBe("auth");
    expect(attachFailureOf("hello:1003")).toBe("protocol");
    expect(attachFailureOf("hello:1001")).toBe("protocol");
    expect(attachFailureOf("hello:9999")).toBe("other");
    expect(attachFailureOf("hello:unknown")).toBe("other");
    expect(attachFailureOf("attach:engine-not-running")).toBe("other");
    expect(attachFailureOf("engine_not_running")).toBe("other");
  });

  test("the auth failure's cause says the token is missing or wrong, and its fix line asks for a new connection code", () => {
    expect(catalogOf("ko")[attachErrorKey("auth")]).toBe(
      "원격 서비스가 접속을 거절했어요. 토큰이 없거나 맞지 않아요.",
    );
    expect(catalogOf("ko")[attachFixKey("auth")]).toBe(
      "호스트에서 새 연결 코드를 받아 다시 연결해요. 이전 토큰이 폐기됐을 수 있어요.",
    );
  });
});

/** 종료 코드 3(환경 문제)으로 죽은 엔진의 첫 줄을 종류로 바꾼다 */
function kindOf(detail: string | null): AttachFailureKind {
  return attachFailureOfExit({ code: 3, detail });
}

describe("the exit detail names the failure cause", () => {
  test("each known engine stderr first line maps to its failure kind", () => {
    expect(kindOf("The service socket does not exist")).toBe("socketMissing");
    expect(kindOf("The service refused the connection")).toBe("refused");
    expect(kindOf("The service socket cannot be accessed")).toBe("permission");
    expect(kindOf("The service did not respond in time")).toBe("timeout");
    expect(kindOf("The remote access token is missing")).toBe("tokenMissing");
    expect(kindOf("The remote access token does not match")).toBe("auth");
    expect(kindOf("This build does not include remote access (ssh tunnel)")).toBe("tunnel");
  });

  test("a host key line inside the ssh tunnel line is the host key kind, not the tunnel kind", () => {
    expect(kindOf("Could not open the ssh tunnel: Host key verification failed")).toBe("hostKey");
    expect(kindOf("Could not open the ssh tunnel: closed by remote host")).toBe("tunnel");
  });

  test("a refused ssh connection is the tunnel kind, not the refused service kind", () => {
    expect(
      kindOf("Could not open the ssh tunnel: connect to host build port 22: Connection refused"),
    ).toBe("tunnel");
  });

  test("the match ignores case, and a line nobody has seen or no line at all is other", () => {
    expect(kindOf("THE SERVICE SOCKET DOES NOT EXIST")).toBe("socketMissing");
    expect(kindOf("The service connection closed before it responded")).toBe("other");
    expect(kindOf("A line nobody has seen")).toBe("other");
    expect(kindOf("")).toBe("other");
    expect(kindOf(null)).toBe("other");
    expect(attachFailureOfExit({ code: null })).toBe("other");
  });

  test("the lines reach every kind except protocol, which only the hello codes give", () => {
    const reached = [
      kindOf("The service socket does not exist"),
      kindOf("The service refused the connection"),
      kindOf("The service socket cannot be accessed"),
      kindOf("The service did not respond in time"),
      kindOf("Could not open the ssh tunnel: Host key verification failed"),
      kindOf("Could not open the ssh tunnel: closed by remote host"),
      kindOf("The remote access token is missing"),
      kindOf("The remote access token does not match"),
      kindOf("A line nobody has seen"),
    ];
    expect(reached.toSorted()).toEqual([
      "auth",
      "hostKey",
      "other",
      "permission",
      "refused",
      "socketMissing",
      "timeout",
      "tokenMissing",
      "tunnel",
    ]);
    expect(attachFailureOf("hello:1001")).toBe("protocol");
  });
});

describe("the list, selection and status follow their actions", () => {
  test("saving a list that no longer has the engine's host keeps the engine on that host", () => {
    const seen = run(withItems([BUILD, MINI]), {
      type: "engineTargetSeen",
      target: { kind: "remote", address: BUILD.address, label: "build-box" },
    });
    const after = connectionReducer(seen, {
      type: "targetsChanged",
      items: [MINI],
      notice: null,
      added: false,
    });
    expect(after.engineTarget).toEqual(REMOTE_BUILD);
    expect(after.items).toEqual([MINI]);
  });

  test("adding a host clears the query and leaves the engine target alone", () => {
    const opened = run(withItems([BUILD]), { type: "query", text: "x" });
    const added = connectionReducer(opened, {
      type: "targetsChanged",
      items: [BUILD, MINI],
      notice: { tone: "success", id: "desktop.connection.targets.added" },
      added: true,
    });
    expect(added.query).toBe("");
    expect(added.items).toEqual([BUILD, MINI]);
    expect(added.engineTarget).toEqual(LOCAL_CHOICE);
    expect(added.notice).toEqual({ tone: "success", id: "desktop.connection.targets.added" });
  });

  test("a service mode left pending a restart by the schedule screen shows the restart badge on load", () => {
    const loaded = connectionReducer(withItems([]), {
      type: "statusLoaded",
      snapshot: {
        host: {
          mode: "in-process",
          pid: 1,
          startedAt: "2026-11-04T01:00:00.000Z",
          connections: 0,
          liveTurns: 0,
          idleShutdownAt: null,
        },
        service: { kind: "unknown" },
        restartPending: true,
        remoteAllowRespond: null,
      },
    });
    expect(loaded.restartNeeded).toBe(true);
  });

  test("the restart flag comes from the shell's reading, so a change that already restarted the engine reads as no restart", () => {
    const loaded = connectionReducer(withItems([]), {
      type: "statusLoaded",
      snapshot: {
        host: {
          mode: "service",
          pid: 1,
          startedAt: "2026-11-04T01:00:00.000Z",
          connections: 0,
          liveTurns: 0,
          idleShutdownAt: null,
        },
        service: { kind: "unknown" },
        restartPending: false,
        remoteAllowRespond: true,
      },
    });
    expect(loaded.restartNeeded).toBe(false);
  });

  test("the update line with no data source is the unchecked line", () => {
    expect(updateLineKey({ state: "unchecked" })).toBe("desktop.update.unchecked");
    expect(catalogOf("ko")["desktop.update.unchecked"]).toBe("업데이트를 아직 확인하지 않았어요.");
  });
});

/** 상태를 읽은 뒤의 화면 상태. 원격 응답 허용 값을 정한다(null이면 엔진이 알리지 않는다) */
function statusWith(remoteAllowRespond: boolean | null): ConnectionState {
  return run(withItems([]), {
    type: "statusLoaded",
    snapshot: {
      host: {
        mode: "service",
        pid: 1,
        startedAt: "2026-11-04T01:00:00.000Z",
        connections: 0,
        liveTurns: 0,
        idleShutdownAt: null,
      },
      service: { kind: "unknown" },
      restartPending: false,
      remoteAllowRespond,
    },
  });
}

describe("renaming and removing a host", () => {
  const MINI_RENAMED: TargetEntry = { id: "b", label: "office", address: MINI.address };

  test("renaming opens on the host's current name, and typing changes only the dialog's name", () => {
    const opened = run(withItems([BUILD, MINI]), { type: "renameOpened", entry: MINI });
    expect(opened.rename).toEqual({ entry: MINI, label: "mac-mini", error: null });
    const typed = connectionReducer(opened, { type: "renameField", label: "office" });
    expect(typed.rename).toEqual({ entry: MINI, label: "office", error: null });
  });

  test("the saved list renames only the chosen host and keeps the others as they were", () => {
    expect(renamedList([BUILD, MINI], "b", "office")).toEqual([BUILD, MINI_RENAMED]);
    expect(renamedList([BUILD, MINI], "zz", "office")).toEqual([BUILD, MINI]);
  });

  test("an empty name or a failed save is an error on the dialog, and typing again clears it", () => {
    const opened = run(withItems([BUILD, MINI]), { type: "renameOpened", entry: MINI });
    const empty = connectionReducer(opened, { type: "renameFailed", reason: "empty" });
    expect(empty.rename?.error).toBe("empty");
    expect(connectionReducer(empty, { type: "renameField", label: "x" }).rename?.error).toBeNull();
    const failed = connectionReducer(opened, { type: "renameFailed", reason: "failed" });
    expect(failed.rename).toEqual({ entry: MINI, label: "mac-mini", error: "failed" });
  });

  test("a saved list closes an open rename and a removal confirmation, and shows its notice", () => {
    const open = run(
      withItems([BUILD, MINI]),
      { type: "renameOpened", entry: MINI },
      { type: "removeAsked", entry: BUILD },
    );
    const saved = connectionReducer(open, {
      type: "targetsChanged",
      items: [BUILD, MINI_RENAMED],
      notice: { tone: "success", id: "desktop.connection.targets.renamed" },
      added: false,
    });
    expect(saved.rename).toBeNull();
    expect(saved.removing).toBeNull();
    expect(saved.items).toEqual([BUILD, MINI_RENAMED]);
    expect(saved.notice).toEqual({ tone: "success", id: "desktop.connection.targets.renamed" });
  });

  test("asking to remove holds that host until the confirmation is answered, and cancelling leaves the list alone", () => {
    const asked = run(withItems([BUILD, MINI]), { type: "removeAsked", entry: MINI });
    expect(asked.removing).toEqual(MINI);
    expect(asked.items).toEqual([BUILD, MINI]);
    expect(connectionReducer(asked, { type: "removeAsked", entry: null }).removing).toBeNull();
  });
});

describe("the remote answer setting", () => {
  test("the loaded value is kept, and a change shows at once with no restart needed", () => {
    const loaded = statusWith(false);
    expect(loaded.remoteAllowRespond).toBe(false);
    const changed = connectionReducer(loaded, { type: "remoteRespondSet", enabled: true });
    expect(changed.remoteAllowRespond).toBe(true);
    expect(changed.restartNeeded).toBe(false);
  });

  test("the row is locked while the status is not read, while the engine does not report the setting, and while busy or connecting", () => {
    expect(canSetRemoteRespond(INITIAL_CONNECTION_STATE)).toBe(false);
    expect(canSetRemoteRespond(statusWith(null))).toBe(false);
    expect(canSetRemoteRespond({ ...statusWith(true), busy: true })).toBe(false);
    expect(canSetRemoteRespond(run(statusWith(true), started(REMOTE_BUILD, null, "offline")))).toBe(
      false,
    );
  });

  test("the row is open once the status is read, the value is known, and nothing else is going on", () => {
    expect(canSetRemoteRespond(statusWith(true))).toBe(true);
    expect(canSetRemoteRespond(statusWith(false))).toBe(true);
  });

  test("with no connection the status is offline and the row stays locked", () => {
    const offline = run(statusWith(true), { type: "statusFailed", reason: "offline" });
    expect(canSetRemoteRespond(offline)).toBe(false);
    expect(offline.remoteAllowRespond).toBe(true);
  });
});

describe("the connected clients list", () => {
  const NAMED: HostClientView = {
    connectionId: "c-1",
    transport: "stdio",
    name: "fresnel-cli",
    version: "1.2.0",
    writeThreads: 2,
    observedThreads: 1,
    self: false,
  };
  const BARE: HostClientView = {
    connectionId: "c-2",
    transport: "socket",
    writeThreads: 0,
    observedThreads: 3,
    self: true,
  };

  test("the transport label that stands in for a missing name is the Korean catalog's", () => {
    const ko = catalogOf("ko");
    expect(ko[transportMessageOf("in-process")]).toBe("같은 프로세스");
    expect(ko[transportMessageOf("stdio")]).toBe("표준 입출력(stdio)");
    expect(ko[transportMessageOf("socket")]).toBe("서비스 연결");
  });

  test("a loaded list is kept in the order the engine gave, and a later read replaces it", () => {
    const loaded = run(INITIAL_CONNECTION_STATE, {
      type: "clientsLoaded",
      clients: [BARE, NAMED],
    });
    expect(loaded.clients).toEqual({ kind: "ready", clients: [BARE, NAMED] });
    const again = run(loaded, { type: "clientsLoaded", clients: [] });
    expect(again.clients).toEqual({ kind: "ready", clients: [] });
  });

  test("a failed read keeps its reason, and a new read starts loading again", () => {
    const failed = run(INITIAL_CONNECTION_STATE, { type: "clientsFailed", reason: "failed" });
    expect(failed.clients).toEqual({ kind: "failed" });
    const retried = run(failed, { type: "clientsLoading" });
    expect(retried.clients).toEqual({ kind: "loading" });
  });

  test("the client list and the status card move independently", () => {
    const statusFailed = run(INITIAL_CONNECTION_STATE, { type: "statusFailed", reason: "failed" });
    const withClients = run(statusFailed, { type: "clientsLoaded", clients: [NAMED] });
    expect(withClients.status).toEqual({ kind: "failed" });
    expect(withClients.clients).toEqual({ kind: "ready", clients: [NAMED] });
    const clientsFailed = run(INITIAL_CONNECTION_STATE, {
      type: "clientsFailed",
      reason: "failed",
    });
    expect(clientsFailed.status).toEqual({ kind: "loading" });
  });

  test("no connection and an old engine each keep their own reason, and any other failure is failed", () => {
    expect(clientsReasonOf({ kind: "offline" })).toBe("offline");
    expect(clientsReasonOf({ kind: "unsupported" })).toBe("unsupported");
    expect(clientsReasonOf({ kind: "failed" })).toBe("failed");
    expect(clientsReasonOf({ kind: "rejected", code: 3102 })).toBe("failed");
    expect(clientsReasonOf({ kind: "locked", ownerKind: "unknown", options: [] })).toBe("failed");
  });
});

describe("the screen opens on the engine's current target", () => {
  const OTHER: TargetEntry = { id: "c", label: "old-box", address: "tcp://10.0.0.9:7421" };

  test("a remote target the engine is on is its current host, and its row's connect stays off", () => {
    const state = run(
      INITIAL_CONNECTION_STATE,
      { type: "targetsChanged", items: [BUILD, MINI], notice: null, added: false },
      {
        type: "engineTargetSeen",
        target: { kind: "remote", address: BUILD.address, label: "build-box" },
      },
    );
    expect(state.engineTarget).toEqual(REMOTE_BUILD);
    expect(canConnect(state, REMOTE_BUILD)).toBe(false);
    expect(canConnect(state, { kind: "remote", entry: MINI })).toBe(true);
  });

  test("a remote target that is no longer in the list falls back to this computer", () => {
    const state = run(
      INITIAL_CONNECTION_STATE,
      { type: "targetsChanged", items: [BUILD], notice: null, added: false },
      { type: "engineTargetSeen", target: { kind: "remote", address: OTHER.address, label: "x" } },
    );
    expect(state.engineTarget).toEqual(LOCAL_CHOICE);
  });

  test("this computer as the engine's target keeps the local choice, and its row's connect is off", () => {
    const state = run(
      INITIAL_CONNECTION_STATE,
      { type: "targetsChanged", items: [BUILD], notice: null, added: false },
      { type: "engineTargetSeen", target: { kind: "local" } },
    );
    expect(state.engineTarget).toEqual(LOCAL_CHOICE);
    expect(canConnect(state, LOCAL_CHOICE)).toBe(false);
  });

  test("a seen target does not move a connection that is already in progress", () => {
    const inProgress = run(withItems([BUILD, MINI]), started({ kind: "remote", entry: MINI }));
    const after = run(inProgress, {
      type: "engineTargetSeen",
      target: { kind: "remote", address: BUILD.address, label: "build-box" },
    });
    expect(after).toBe(inProgress);
    expect(after.engineTarget).toEqual({ kind: "remote", entry: MINI });
  });
});

/** 상태를 읽은 뒤의 화면 상태. 이 기기의 서비스 카드를 정한다. 다시 시작 대기는 없고 원격 응답은 허용이다 */
function statusWithService(service: ServiceCard): ConnectionState {
  return run(withItems([]), {
    type: "statusLoaded",
    snapshot: {
      host: {
        mode: "service",
        pid: 1,
        startedAt: "2026-11-04T01:00:00.000Z",
        connections: 0,
        liveTurns: 0,
        idleShutdownAt: null,
      },
      service,
      restartPending: false,
      remoteAllowRespond: true,
    },
  });
}

const RUNNING_CARD: ServiceCard = {
  kind: "running",
  pid: 4321,
  version: "1.2.3",
  startedAt: 1_700_000_000_000,
  attached: true,
};
const STOPPED_CARD: ServiceCard = { kind: "stopped", reason: "no registration" };

describe("the local service card follows the shell and the stop rule", () => {
  test("a loaded status carries the card as the shell reported it", () => {
    expect(statusWithService(RUNNING_CARD).service).toEqual(RUNNING_CARD);
    expect(statusWithService(STOPPED_CARD).service).toEqual(STOPPED_CARD);
  });

  test("before the status is read the card is unknown", () => {
    expect(INITIAL_CONNECTION_STATE.service).toEqual({ kind: "unknown" });
  });

  test("a status that fails to load turns a running card into unknown instead of keeping it", () => {
    const offline = run(statusWithService(RUNNING_CARD), {
      type: "statusFailed",
      reason: "offline",
    });
    expect(offline.service).toEqual({ kind: "unknown" });
    expect(offline.status).toEqual({ kind: "offline" });
  });

  test("stop is for a service that is running, and never for one that is off or unread", () => {
    expect(canStopService(statusWithService(RUNNING_CARD))).toBe(true);
    expect(canStopService(statusWithService(STOPPED_CARD))).toBe(false);
    expect(canStopService(statusWithService({ kind: "unknown" }))).toBe(false);
  });

  test("stop is locked before the status is read, while busy, and while connecting", () => {
    const running = statusWithService(RUNNING_CARD);
    expect(canStopService(INITIAL_CONNECTION_STATE)).toBe(false);
    expect(canStopService({ ...running, busy: true })).toBe(false);
    expect(canStopService(run(running, started(LOCAL_CHOICE, RUNNING, "offline")))).toBe(false);
  });
});

/** 문구 한 줄을 en.json 원문에서 가져와 값을 채운다. 엔진 stderr의 첫 줄이 이 영어 문구다 */
function engineSentence(key: string, values: Readonly<Record<string, string>>): string {
  const template = catalogOf("en")[key];
  if (template === undefined) throw new Error(`missing message ${key}`);
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template,
  );
}

describe("the TLS sentences from the engine name their own failure kind", () => {
  test("a changed fingerprint is the fingerprint kind, and an untrusted certificate is certUntrusted", () => {
    const changed = engineSentence(
      "cli.errors.engineStart.service.connect.fingerprintChanged.message",
      {
        expected: "SHA256:aa",
        actual: "SHA256:bb",
      },
    );
    const untrusted = engineSentence(
      "cli.errors.engineStart.service.connect.tlsUntrusted.message",
      {
        fingerprint: "SHA256:cc",
      },
    );
    expect(attachFailureOfExit({ code: 3, detail: changed })).toBe("fingerprint");
    expect(attachFailureOfExit({ code: 3, detail: untrusted })).toBe("certUntrusted");
  });
});

const EXIT_AT = "2026-11-12T00:00:00.000Z";
const NOW_MS = Date.parse(EXIT_AT);

function restartingAt(retryAt: string): EngineState {
  return {
    kind: "restarting",
    attempt: 2,
    retryAt,
    lastExit: { code: 3, signal: null, at: EXIT_AT },
  };
}

describe("the reconnect status follows the engine state", () => {
  test("restarting gives the attempt and the seconds to the next try, rounded up and never negative", () => {
    expect(reconnectStatusOf(restartingAt("2026-11-12T00:00:04.000Z"), NOW_MS)).toEqual({
      kind: "retrying",
      attempt: 2,
      secondsUntilNext: 4,
    });
    expect(reconnectStatusOf(restartingAt("2026-11-12T00:00:03.200Z"), NOW_MS)).toEqual({
      kind: "retrying",
      attempt: 2,
      secondsUntilNext: 4,
    });
    expect(reconnectStatusOf(restartingAt("2026-11-11T23:59:00.000Z"), NOW_MS)).toEqual({
      kind: "retrying",
      attempt: 2,
      secondsUntilNext: 0,
    });
  });

  test("failed gives up with the attempt count", () => {
    const failed: EngineState = {
      kind: "failed",
      attempts: 3,
      lastExit: { code: 3, signal: null, at: EXIT_AT },
    };
    expect(reconnectStatusOf(failed, NOW_MS)).toEqual({ kind: "gave_up", attempts: 3 });
  });

  test("the other states, and no engine yet, have no reconnect status", () => {
    const others: EngineState[] = [
      { kind: "starting", source: "sidecar", attempt: 1 },
      { kind: "running", source: "service", pid: 4242 },
      { kind: "stopping" },
      { kind: "stopped" },
    ];
    for (const state of others) {
      expect(reconnectStatusOf(state, NOW_MS)).toBeNull();
    }
    expect(reconnectStatusOf(null, NOW_MS)).toBeNull();
  });
});

describe("the switch confirm in the screen state", () => {
  test("a switch that needs a confirm waits in the state until it is confirmed or dropped", () => {
    const impact = { liveTurns: 1, waitingApprovals: 0, keepsRunning: true };
    const asked = connectionReducer(INITIAL_CONNECTION_STATE, {
      type: "switchAsked",
      ask: { choice: LOCAL_CHOICE, impact },
    });
    expect(asked.switchAsk).toEqual({ choice: LOCAL_CHOICE, impact });
    expect(connectionReducer(asked, { type: "switchClosed" }).switchAsk).toBeNull();
  });
});
