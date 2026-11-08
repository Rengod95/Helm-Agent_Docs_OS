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
  canStartService,
  canStopService,
  checkForm,
  choiceOfValue,
  clientRowOf,
  clientsReasonOf,
  clientsShown,
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  LOCAL_CHOICE,
  NO_FORM_ERRORS,
  sameChoice,
  searchShown,
  stepsOf,
  valueOfChoice,
  visibleTargets,
  type ConnectionAction,
  type ConnectionState,
  type TargetChoice,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  addressMessageOf,
  transportMessageOf,
} from "../../src/views/pages/connection/connection-text.ts";

// 연결 화면(P-08)의 상태 기계. 대상 고르기, 추가 칸 검사, 진행 단계, 실패 종류, 셸 거절 되돌리기를 값으로 비교한다.

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
    added: null,
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

describe("target choice values", () => {
  test("the local target is the local value and a saved target is its id", () => {
    expect(valueOfChoice(LOCAL_CHOICE)).toBe("local");
    expect(valueOfChoice(REMOTE_BUILD)).toBe("remote:a");
  });

  test("a radio value maps back to the saved target, and an unknown one maps to nothing", () => {
    expect(choiceOfValue([BUILD], "local")).toEqual(LOCAL_CHOICE);
    expect(choiceOfValue([BUILD], "remote:a")).toEqual(REMOTE_BUILD);
    expect(choiceOfValue([BUILD], "remote:zz")).toBeNull();
  });

  test("the same target is the same choice by id, whatever its label", () => {
    expect(
      sameChoice(REMOTE_BUILD, { kind: "remote", entry: { ...BUILD, label: "renamed" } }),
    ).toBe(true);
    expect(sameChoice(REMOTE_BUILD, LOCAL_CHOICE)).toBe(false);
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

describe("address and label check for the add form", () => {
  test("a non-loopback TCP address is refused with the non-loopback reason and no entry is made", () => {
    const checked = checkForm([], { label: "mini", address: "tcp://192.168.0.5:7421" }, "n1");
    expect(checked).toEqual({ ok: false, errors: { label: false, address: "non_loopback" } });
  });

  test("an empty label and an empty address are both reported together", () => {
    const checked = checkForm([], { label: "  ", address: "" }, "n1");
    expect(checked).toEqual({ ok: false, errors: { label: true, address: "empty" } });
  });

  test("a duplicate address is refused as duplicate", () => {
    const checked = checkForm([BUILD], { label: "again", address: BUILD.address }, "n2");
    expect(checked).toEqual({ ok: false, errors: { label: false, address: "duplicate" } });
  });

  test("a valid entry is added with the trimmed label and the id it was given", () => {
    const checked = checkForm(
      [BUILD],
      { label: "  mac-mini  ", address: "unix:/run/user/501/fresnel.sock" },
      "n3",
    );
    expect(checked).toEqual({
      ok: true,
      list: [BUILD, { id: "n3", label: "mac-mini", address: "unix:/run/user/501/fresnel.sock" }],
      entry: { id: "n3", label: "mac-mini", address: "unix:/run/user/501/fresnel.sock" },
    });
  });

  test("the non-loopback reason shows the SSH tunnel or private network guidance", () => {
    const ko = catalogOf("ko");
    expect(ko[addressMessageOf("non_loopback")]).toContain("SSH 터널이나 사설망을 써요");
  });
});

describe("connect button", () => {
  test("it is off while the selected target is the one the engine already points at", () => {
    const state = withItems([BUILD]);
    expect(canConnect(state)).toBe(false);
    expect(canConnect({ ...state, selected: REMOTE_BUILD })).toBe(true);
  });

  test("it is off while a connect is pending or a write is busy", () => {
    const selected = { ...withItems([BUILD]), selected: REMOTE_BUILD };
    expect(canConnect(run(selected, started(REMOTE_BUILD)))).toBe(false);
    expect(canConnect({ ...selected, busy: true })).toBe(false);
  });
});

describe("connect progress follows the engine state", () => {
  test("starting a connect records the target and what the engine pointed at before", () => {
    const state = run(
      withItems([BUILD]),
      { type: "select", choice: REMOTE_BUILD },
      started(REMOTE_BUILD),
    );
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

  test("the auth failure's cause says the token is missing or wrong, and its fix line names the environment variable", () => {
    expect(catalogOf("ko")[attachErrorKey("auth")]).toBe(
      "원격 서비스가 접속을 거절했어요. 토큰이 없거나 맞지 않아요.",
    );
    expect(catalogOf("ko")[attachFixKey("auth")]).toContain("FRESNEL_REMOTE_TOKEN");
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
  test("removing the selected remote target selects this computer again", () => {
    const selected = run(withItems([BUILD, MINI]), { type: "select", choice: REMOTE_BUILD });
    const after = connectionReducer(selected, {
      type: "targetsChanged",
      items: [MINI],
      notice: null,
      added: null,
    });
    expect(after.selected).toEqual(LOCAL_CHOICE);
    expect(after.items).toEqual([MINI]);
  });

  test("adding a target closes the form, selects the new target and clears the query", () => {
    const opened = run(withItems([BUILD]), { type: "formOpened" }, { type: "query", text: "x" });
    const added = connectionReducer(opened, {
      type: "targetsChanged",
      items: [BUILD, MINI],
      notice: { tone: "success", id: "desktop.connection.targets.added" },
      added: MINI,
    });
    expect(added.form).toBeNull();
    expect(added.query).toBe("");
    expect(added.selected).toEqual({ kind: "remote", entry: MINI });
    expect(added.notice).toEqual({ tone: "success", id: "desktop.connection.targets.added" });
  });

  test("editing a form field clears its errors", () => {
    const failed = run(
      withItems([]),
      { type: "formOpened" },
      { type: "formFailed", errors: { label: true, address: "empty" } },
    );
    expect(failed.form?.errors).toEqual({ label: true, address: "empty" });
    const typed = connectionReducer(failed, { type: "formField", field: "label", value: "mac" });
    expect(typed.form).toEqual({ label: "mac", address: "", errors: NO_FORM_ERRORS });
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
        serviceEnabled: true,
        restartPending: true,
        remoteAllowRespond: null,
      },
    });
    expect(loaded.restartNeeded).toBe(true);
  });

  test("a service mode change applies at once, so the change itself needs no restart", () => {
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
        serviceEnabled: false,
        restartPending: false,
        remoteAllowRespond: true,
      },
    });
    expect(loaded.serviceEnabled).toBe(false);
    expect(loaded.restartNeeded).toBe(false);
    const changed = connectionReducer(loaded, { type: "serviceModeSet", enabled: true });
    expect(changed.serviceEnabled).toBe(true);
    expect(changed.restartNeeded).toBe(false);
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
      serviceEnabled: true,
      restartPending: false,
      remoteAllowRespond,
    },
  });
}

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

  test("a named client keeps its name and version, and a client that has not said hello has neither", () => {
    expect(clientRowOf(NAMED)).toEqual({
      id: "c-1",
      name: "fresnel-cli",
      transport: "stdio",
      version: "1.2.0",
      self: false,
      writeThreads: 2,
      observedThreads: 1,
    });
    expect(clientRowOf(BARE)).toEqual({
      id: "c-2",
      name: null,
      transport: "socket",
      version: null,
      self: true,
      writeThreads: 0,
      observedThreads: 3,
    });
  });

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

  test("the section is drawn while loading, ready or failed, and hidden for offline and unsupported", () => {
    expect(clientsShown({ kind: "loading" })).toBe(true);
    expect(clientsShown({ kind: "ready", clients: [] })).toBe(true);
    expect(clientsShown({ kind: "failed" })).toBe(true);
    expect(clientsShown({ kind: "offline" })).toBe(false);
    expect(clientsShown({ kind: "unsupported" })).toBe(false);
  });
});

describe("the screen opens on the engine's current target", () => {
  const OTHER: TargetEntry = { id: "c", label: "old-box", address: "tcp://10.0.0.9:7421" };

  test("a remote target the engine is on is selected, and the connect button stays off", () => {
    const state = run(
      INITIAL_CONNECTION_STATE,
      { type: "targetsChanged", items: [BUILD, MINI], notice: null, added: null },
      {
        type: "engineTargetSeen",
        target: { kind: "remote", address: BUILD.address, label: "build-box" },
      },
    );
    expect(state.selected).toEqual(REMOTE_BUILD);
    expect(state.engineTarget).toEqual(REMOTE_BUILD);
    expect(canConnect(state)).toBe(false);
  });

  test("a remote target that is no longer in the list falls back to this computer", () => {
    const state = run(
      INITIAL_CONNECTION_STATE,
      { type: "targetsChanged", items: [BUILD], notice: null, added: null },
      { type: "engineTargetSeen", target: { kind: "remote", address: OTHER.address, label: "x" } },
    );
    expect(state.selected).toEqual(LOCAL_CHOICE);
    expect(state.engineTarget).toEqual(LOCAL_CHOICE);
  });

  test("this computer as the engine's target keeps the local choice", () => {
    const state = run(
      INITIAL_CONNECTION_STATE,
      { type: "targetsChanged", items: [BUILD], notice: null, added: null },
      { type: "engineTargetSeen", target: { kind: "local" } },
    );
    expect(state.selected).toEqual(LOCAL_CHOICE);
    expect(state.engineTarget).toEqual(LOCAL_CHOICE);
    expect(canConnect(state)).toBe(false);
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

/** 상태를 읽은 뒤의 화면 상태. 이 기기의 서비스 카드를 정한다. 서비스 모드는 켜져 있고 원격 응답은 허용이다 */
function statusWithService(service: ServiceCard, pending = false): ConnectionState {
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
      serviceEnabled: true,
      restartPending: pending,
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

describe("the local service card follows the shell and its own actions", () => {
  test("a loaded status carries the card as the shell reported it", () => {
    expect(statusWithService(RUNNING_CARD).service).toEqual(RUNNING_CARD);
    expect(statusWithService(STOPPED_CARD).service).toEqual(STOPPED_CARD);
  });

  test("before the status is read the card is unknown", () => {
    expect(INITIAL_CONNECTION_STATE.service).toEqual({ kind: "unknown" });
    expect(INITIAL_CONNECTION_STATE.serviceBusy).toBeNull();
    expect(INITIAL_CONNECTION_STATE.serviceError).toBeNull();
  });

  test("a status that fails to load turns a running card into unknown instead of keeping it", () => {
    const offline = run(statusWithService(RUNNING_CARD), {
      type: "statusFailed",
      reason: "offline",
    });
    expect(offline.service).toEqual({ kind: "unknown" });
    expect(offline.status).toEqual({ kind: "offline" });
  });

  test("start is for a service that is not running, and stop is for one that is", () => {
    expect(canStartService(statusWithService(STOPPED_CARD))).toBe(true);
    expect(canStopService(statusWithService(STOPPED_CARD))).toBe(false);
    expect(canStartService(statusWithService(RUNNING_CARD))).toBe(false);
    expect(canStopService(statusWithService(RUNNING_CARD))).toBe(true);
  });

  test("a card that could not be read lets start through and keeps stop locked", () => {
    const unknown = statusWithService({ kind: "unknown" });
    expect(canStartService(unknown)).toBe(true);
    expect(canStopService(unknown)).toBe(false);
  });

  test("neither button works before the status is read, while a card action is going, while busy, or while connecting", () => {
    const stopped = statusWithService(STOPPED_CARD);
    expect(canStartService(INITIAL_CONNECTION_STATE)).toBe(false);
    expect(canStopService(INITIAL_CONNECTION_STATE)).toBe(false);
    const acting = run(stopped, { type: "serviceBusy", action: "start" });
    expect(canStartService(acting)).toBe(false);
    expect(
      canStopService(run(statusWithService(RUNNING_CARD), { type: "serviceBusy", action: "stop" })),
    ).toBe(false);
    expect(canStartService({ ...stopped, busy: true })).toBe(false);
    const connecting = run(stopped, started(LOCAL_CHOICE, RUNNING, "offline"));
    expect(canStartService(connecting)).toBe(false);
    expect(
      canStopService(
        run(statusWithService(RUNNING_CARD), started(LOCAL_CHOICE, RUNNING, "offline")),
      ),
    ).toBe(false);
  });

  test("a card action marks itself busy until it ends, and a failure stays on the card until the next try", () => {
    const busy = run(statusWithService(STOPPED_CARD), { type: "serviceBusy", action: "start" });
    expect(busy.serviceBusy).toBe("start");
    const failed = run(
      busy,
      { type: "serviceBusy", action: null },
      { type: "serviceError", action: "start" },
    );
    expect(failed.serviceBusy).toBeNull();
    expect(failed.serviceError).toBe("start");
    const retried = run(failed, { type: "serviceError", action: null });
    expect(retried.serviceError).toBeNull();
  });

  test("a service mode change applies at once: it clears a waiting restart and the card stays as the shell last said", () => {
    const waiting = statusWithService(STOPPED_CARD, true);
    expect(waiting.restartNeeded).toBe(true);
    const changed = connectionReducer(waiting, { type: "serviceModeSet", enabled: true });
    expect(changed.serviceEnabled).toBe(true);
    expect(changed.restartNeeded).toBe(false);
    expect(changed.service).toEqual(STOPPED_CARD);
  });
});
