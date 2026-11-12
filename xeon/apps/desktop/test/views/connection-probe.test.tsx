import { describe, expect, test } from "bun:test";
import {
  preflightActionKey,
  preflightCauseKey,
  preflightFixKey,
  preflightHintKey,
  preflightOkKey,
} from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import type { PreflightEvent, SshHostsReply } from "../../src/transport/ipc.ts";
import { CommandsContext } from "../../src/views/commands.ts";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionAction,
  type ConnectionState,
  type ReconnectLine,
} from "../../src/views/pages/connection/connection-model.ts";
import { timeTextOf } from "../../src/views/pages/connection/connection-text.ts";
import {
  probeReducer,
  PROBE_IDLE,
  type ProbeState,
  type RowProbe,
} from "../../src/views/pages/connection/connection-probe-model.ts";
import { ProbeLines, SshHostList } from "../../src/views/pages/connection/connection-probe.tsx";
import {
  ConnectionScreenView,
  type ConnectionScreenHandlers,
} from "../../src/views/pages/connection/connection-view.tsx";
import { fakeCommands } from "./fake-commands.ts";

// 연결 시험의 서버 렌더. 단계 줄(통과, 실패와 힌트와 명령, 호스트 키 확인), 주소 시험 한 줄, SSH 고르기 목록, 추가 칸의 시험 자리,
// 저장된 줄의 시험(한 번에 한 줄), 알림 줄과 다시 붙기 줄을 문장으로 비교한다. 클릭은 DOM이 없어 못 보고, 채움 값은
// `connection-probe-model.test.ts`가 본다.

const NOOP = (): void => {};

function probeOf(...events: readonly PreflightEvent[]): ProbeState {
  return events.reduce<ProbeState>(
    (state, event) => probeReducer(state, { type: "step", event }),
    probeReducer(PROBE_IDLE, { type: "begin" }),
  );
}

const PASS: PreflightEvent = {
  step: "connect",
  status: "pass",
  code: "ok",
  durationMs: 40,
  actions: [],
};

/** 버튼 글이 `label`인 단추들의 속성 글. `disabled=""`로 잠김을 본다 */
function buttonTagsNamed(markup: string, label: string): string[] {
  return Array.from(markup.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs))
    .filter((match) => match[2]?.replace(/<[^>]*>/g, "") === label)
    .map((match) => match[1] ?? "");
}

/** 단추의 속성 글이 잠김(`disabled` 속성)인가. 클래스 이름의 `disabled:` 꾸밈은 잠김이 아니다 */
const isLocked = (tag: string): boolean => /\sdisabled=""/.test(tag);

describe("the preflight step lines", () => {
  test("a passed step says what it checked and how long it took; the tunnel line carries its own time", () => {
    const markup = renderToString(
      <ProbeLines
        probe={probeOf(PASS, { ...PASS, step: "tunnel", code: "ok", durationMs: 25 })}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(markup).toContain(t(preflightOkKey("connect")));
    expect(markup).toContain(t("desktop.connection.preflight.took", { ms: 40 }));
    expect(markup).toContain(t(preflightOkKey("tunnel"), { ms: 25 }));
    expect(markup.split(t("desktop.connection.preflight.took", { ms: 25 })).length - 1).toBe(0);
  });

  test("a failed step shows its cause, the fix, the hint, and each command with a copy button", () => {
    const markup = renderToString(
      <ProbeLines
        probe={probeOf({
          step: "install",
          status: "fail",
          code: "not_installed",
          durationMs: 80,
          actions: ["retry"],
          fix: { commands: ["ssh-copy-id build"], hint: "path_noninteractive" },
        })}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(markup).toContain(t(preflightCauseKey("not_installed")));
    expect(markup).toContain(t("desktop.connection.preflight.hint.pathNoninteractive"));
    expect(preflightHintKey("path_noninteractive")).toBe(
      "desktop.connection.preflight.hint.pathNoninteractive",
    );
    expect(markup).toContain("<code");
    expect(markup).toContain("ssh-copy-id build");
    expect(markup).toContain(t(preflightActionKey("copy_command")));
    expect(buttonTagsNamed(markup, t(preflightActionKey("retry")))).toHaveLength(1);
  });

  test("an unknown cause code falls back to the unknown sentence and shows no hint", () => {
    const markup = renderToString(
      <ProbeLines
        probe={probeOf({
          step: "connect",
          status: "fail",
          code: "something_new",
          durationMs: 0,
          actions: [],
        })}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(markup).toContain(t(preflightCauseKey("unknown")));
    expect(markup).toContain(t(preflightFixKey("unknown")));
    expect(markup).not.toContain(t("desktop.connection.preflight.hint.pathNoninteractive"));
  });

  test("a new host key shows the host and its fingerprint, with a trust button", () => {
    const markup = renderToString(
      <ProbeLines
        probe={probeOf({
          step: "connect",
          status: "action",
          code: "host_key_new",
          durationMs: 300,
          actions: ["trust_host_key"],
          detail: {
            hostKey: {
              fingerprint: "SHA256:abc123",
              keyType: "ED25519",
              hostname: "build.local",
              port: 22,
              scanned: [],
            },
          },
        })}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(markup).toContain(
      t("desktop.connection.fingerprint.hostKeyPrompt", { host: "build.local" }),
    );
    expect(markup).toContain(t("desktop.connection.fingerprint.label", { type: "ED25519" }));
    expect(markup).toContain("SHA256:abc123");
    expect(buttonTagsNamed(markup, t(preflightActionKey("trust_host_key")))).toHaveLength(1);
    expect(buttonTagsNamed(markup, t(preflightActionKey("replace_host_key")))).toHaveLength(0);
  });

  test("a changed host key offers to replace the saved key instead", () => {
    const markup = renderToString(
      <ProbeLines
        probe={probeOf({
          step: "connect",
          status: "action",
          code: "host_key_changed",
          durationMs: 300,
          actions: ["replace_host_key"],
          detail: {
            hostKey: {
              fingerprint: "SHA256:new",
              keyType: "ED25519",
              hostname: "build.local",
              port: 22,
              scanned: [],
            },
          },
        })}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(buttonTagsNamed(markup, t(preflightActionKey("replace_host_key")))).toHaveLength(1);
    expect(markup).toContain(t(preflightCauseKey("host_key_changed")));
  });

  test("a running step says it is testing, and a failed command says the request failed", () => {
    const running = renderToString(
      <ProbeLines
        probe={probeOf({
          step: "resolve",
          status: "running",
          code: "running",
          durationMs: 0,
          actions: [],
        })}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(running).toContain(t("desktop.connection.test.running"));
    const failed = renderToString(
      <ProbeLines probe={{ ...PROBE_IDLE, failed: true }} onRun={NOOP} onCopy={NOOP} />,
    );
    expect(failed).toContain(t("desktop.connection.actionFailed"));
  });

  test("a tested address says it connected with the time, or gives the cause and the fix", () => {
    const ok = renderToString(
      <ProbeLines
        probe={{ ...PROBE_IDLE, tested: { ok: true, code: "ok", durationMs: 9 } }}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(ok).toContain(t("desktop.connection.test.ok", { ms: 9 }));
    const failed = renderToString(
      <ProbeLines
        probe={{ ...PROBE_IDLE, tested: { ok: false, code: "dns", durationMs: 9 } }}
        onRun={NOOP}
        onCopy={NOOP}
      />,
    );
    expect(failed).toContain(t(preflightCauseKey("dns")));
    expect(failed).toContain(t("desktop.connection.preflight.fix.dns"));
  });
});

describe("the SSH host list", () => {
  const HOSTS: SshHostsReply = {
    hosts: [
      { name: "build", hostName: "build.example.com", user: "me", port: 2222, proxyJump: true },
      { name: "box", hostName: null, user: null, port: null, proxyJump: false },
    ],
    unreadable: null,
  };

  test("each host shows its name, its user@host:port, and a jump badge when it jumps", () => {
    const markup = renderToString(
      <SshHostList picker={{ kind: "ready", reply: HOSTS }} disabled={false} onPick={NOOP} />,
    );
    expect(markup).toContain("build");
    expect(markup).toContain("me@build.example.com:2222");
    expect(markup).toContain("box");
    expect(markup.split(t("desktop.connection.hosts.jump")).length - 1).toBe(1);
  });

  test("an empty config says there are no hosts, an unreadable one says it could not be read", () => {
    expect(
      renderToString(
        <SshHostList
          picker={{ kind: "ready", reply: { hosts: [], unreadable: null } }}
          disabled={false}
          onPick={NOOP}
        />,
      ),
    ).toContain(t("desktop.connection.hosts.none"));
    expect(
      renderToString(
        <SshHostList
          picker={{ kind: "ready", reply: { hosts: [], unreadable: "missing" } }}
          disabled={false}
          onPick={NOOP}
        />,
      ),
    ).toContain(t("desktop.connection.hosts.unreadable"));
    expect(
      renderToString(<SshHostList picker={{ kind: "failed" }} disabled={false} onPick={NOOP} />),
    ).toContain(t("desktop.connection.hosts.unreadable"));
  });

  test("while the list is closed it draws nothing, and while it loads it says so", () => {
    expect(
      renderToString(<SshHostList picker={{ kind: "closed" }} disabled={false} onPick={NOOP} />),
    ).toBe("");
    expect(
      renderToString(<SshHostList picker={{ kind: "loading" }} disabled={false} onPick={NOOP} />),
    ).toContain(t("desktop.connection.targets.loading"));
  });
});

// ── 화면 조립 ─────────────────────────────────────────────────────────

const handlers: ConnectionScreenHandlers = {
  query: NOOP,
  connect: NOOP,
  retry: NOOP,
  backToLocal: NOOP,
  openForm: NOOP,
  closeForm: NOOP,
  formChange: NOOP,
  submitForm: NOOP,
  removeAsk: NOOP,
  removeCancel: NOOP,
  removeConfirm: NOOP,
  renameOpen: NOOP,
  renameField: NOOP,
  renameSubmit: NOOP,
  renameCancel: NOOP,
  dismissNotice: NOOP,
  confirmStop: NOOP,
  restart: NOOP,
  copyDiagnostics: NOOP,
  refresh: NOOP,
  setRemoteRespond: NOOP,
  setStopConfirm: NOOP,
  openExtensions: NOOP,
  retryClients: NOOP,
  testRow: NOOP,
  fillForm: NOOP,
  copyCommand: NOOP,
  switchConfirm: NOOP,
  switchCancel: NOOP,
  dismissTargetNotice: NOOP,
};

function stateAfter(...actions: readonly ConnectionAction[]): ConnectionState {
  return actions.reduce(connectionReducer, INITIAL_CONNECTION_STATE);
}

function screen(
  state: ConnectionState,
  extra: Partial<Parameters<typeof ConnectionScreenView>[0]> = {},
): string {
  return renderToString(
    <CommandsContext value={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1400)}>
        <ConnectionScreenView
          state={state}
          engine={null}
          locale="ko"
          handlers={handlers}
          {...extra}
        />
      </ShellStoreContext>
    </CommandsContext>,
  );
}

const BUILD = { id: "b1", label: "build-box", address: "ssh://me@build/run/fresnel.sock" };
const OTHER = { id: "o1", label: "other-box", address: "unix:/run/other.sock" };

describe("the add form's probe area", () => {
  test("an SSH address shows the pick and the test buttons", () => {
    const markup = screen(
      stateAfter(
        { type: "targetsChanged", items: [], notice: null, added: false },
        { type: "formOpened" },
      ),
    );
    const pick = buttonTagsNamed(markup, t("desktop.connection.hosts.pick"));
    expect(pick).toHaveLength(1);
    expect(buttonTagsNamed(markup, t("desktop.connection.test.action"))).toHaveLength(1);
    expect(markup).not.toContain(t("desktop.connection.fingerprint.read"));
    // 추가 칸은 `<form>` 안에 있다. 단추는 제출이 아니라 `type="button"`이어야 칸을 저장하지 않는다
    expect(pick[0]).toContain('type="button"');
  });

  test("a web address shows the fingerprint check and the connection code row, and asks for the fingerprint first while it has none", () => {
    const markup = screen(
      stateAfter(
        { type: "targetsChanged", items: [], notice: null, added: false },
        { type: "formOpened" },
        {
          type: "formChange",
          value: { label: "", fields: { kind: "wss", address: "example.com", pin: "" } },
        },
      ),
    );
    const read = buttonTagsNamed(markup, t("desktop.connection.fingerprint.read"));
    expect(read).toHaveLength(1);
    expect(read[0]).toContain('type="button"');
    expect(buttonTagsNamed(markup, t("desktop.connection.pair.submit"))).toHaveLength(1);
    expect(markup).toContain(t("desktop.connection.server.pairing.label"));
    expect(markup).toContain(t("desktop.connection.pair.pinFirst"));
    expect(markup).not.toContain(t("desktop.connection.hosts.pick"));
  });
});

describe("a saved host's test line", () => {
  test("a saved SSH row shows the steps under it, and while one row is tested the other rows' buttons are locked", () => {
    const loaded = stateAfter({
      type: "targetsChanged",
      items: [BUILD, OTHER],
      notice: null,
      added: false,
    });
    const rowProbe: RowProbe = {
      id: BUILD.id,
      probe: probeOf({
        step: "resolve",
        status: "running",
        code: "running",
        durationMs: 0,
        actions: [],
      }),
    };
    const markup = screen(loaded, {
      rowProbe: { ...rowProbe, probe: { ...rowProbe.probe, busy: true } },
    });
    const tests = buttonTagsNamed(markup, t("desktop.connection.test.action"));
    expect(tests).toHaveLength(2);
    expect(tests.every(isLocked)).toBe(true);
    expect(markup).toContain(t("desktop.connection.preflight.step.resolve"));
    expect(markup).toContain(t("desktop.connection.test.running"));
  });

  test("with no test running, the saved rows' test buttons are open", () => {
    const loaded = stateAfter({
      type: "targetsChanged",
      items: [BUILD, OTHER],
      notice: null,
      added: false,
    });
    const tests = buttonTagsNamed(screen(loaded), t("desktop.connection.test.action"));
    expect(tests).toHaveLength(2);
    expect(tests.some(isLocked)).toBe(false);
  });
});

describe("the notice and the reconnect lines", () => {
  test("a fell-back notice names the target and can be dismissed", () => {
    const loaded = stateAfter({ type: "targetsChanged", items: [], notice: null, added: false });
    const markup = screen(loaded, { targetNotice: { kind: "fellBack", name: "build-box" } });
    expect(markup).toContain(t("desktop.connection.lastTarget.fellBack", { name: "build-box" }));
    expect(markup).toContain(t("desktop.connection.dismiss"));
    expect(screen(loaded, { targetNotice: null })).not.toContain(
      t("desktop.connection.lastTarget.fellBack", { name: "build-box" }),
    );
  });

  test("the reconnect lines show the attempt, the last seen state, and whether the service is still there", () => {
    const loaded = stateAfter({ type: "targetsChanged", items: [], notice: null, added: false });
    const at = Date.parse("2026-11-12T00:00:00.000Z");
    const reconnect: readonly ReconnectLine[] = [
      { kind: "attempt", attempt: 2, seconds: 5 },
      { kind: "lastSeen", at, turns: 3 },
      { kind: "gone" },
    ];
    const markup = screen(loaded, { reconnect });
    expect(markup).toContain(t("desktop.connection.reconnect.attempt", { attempt: 2, seconds: 5 }));
    expect(markup).toContain(
      t("desktop.connection.reconnect.lastSeen", {
        time: timeTextOf(new Date(at).toISOString(), "ko"),
        turns: 3,
      }),
    );
    expect(markup).toContain(t("desktop.connection.reconnect.gone"));
    expect(markup).not.toContain(t("desktop.connection.reconnect.alive"));
  });
});
