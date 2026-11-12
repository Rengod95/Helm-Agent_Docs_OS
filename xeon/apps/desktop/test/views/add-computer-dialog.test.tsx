import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { PreflightOutcome, SshHostsReply } from "../../src/transport/ipc.ts";
import {
  AddComputerBody,
  AddComputerFooter,
  type HostsRead,
} from "../../src/views/pages/connection/add-computer-dialog.tsx";
import {
  addReducer,
  initialAddState,
  type AddAction,
  type AddMethod,
  type AddState,
} from "../../src/views/pages/connection/add-computer-model.ts";

// "컴퓨터 추가" wizard의 서버 렌더(시안 §5.2). Dialog 안은 서버 렌더에 나오지 않으므로 본문(`AddComputerBody`)과
// 바닥(`AddComputerFooter`)을 따로 그린다. 상태는 `addReducer`로 만든다.

const NOOP = (): void => {};

const HOSTS: SshHostsReply = {
  hosts: [
    { name: "work-mac", hostName: "10.0.0.5", user: "dev", port: 2222, proxyJump: false },
    { name: "lab", hostName: null, user: null, port: null, proxyJump: true },
  ],
  unreadable: null,
};
const READY: HostsRead = { kind: "ready", reply: HOSTS };

function stateOf(method: AddMethod, ...actions: readonly AddAction[]): AddState {
  return actions.reduce(addReducer, initialAddState(method));
}

function body(state: AddState, hosts: HostsRead = READY): string {
  return renderToString(
    <AddComputerBody
      state={state}
      hosts={hosts}
      dispatch={NOOP}
      onStart={NOOP}
      onRun={NOOP}
      onReadFingerprint={NOOP}
      onPair={NOOP}
      onSave={NOOP}
      onCopy={NOOP}
    />,
  );
}

function footer(state: AddState, canConnectNow = true, hosts: HostsRead = READY): string {
  return renderToString(
    <AddComputerFooter
      state={state}
      hosts={hosts}
      canConnectNow={canConnectNow}
      dispatch={NOOP}
      onCancel={NOOP}
      onStart={NOOP}
      onPair={NOOP}
      onSave={NOOP}
    />,
  );
}

function buttonTagsNamed(markup: string, label: string): string[] {
  return Array.from(markup.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs))
    .filter((match) => match[2]?.replace(/<[^>]*>/g, "") === label)
    .map((match) => match[1] ?? "");
}

const isLocked = (tag: string): boolean => /\sdisabled=""/.test(tag);

function stop(outcome: Omit<Extract<PreflightOutcome, { ok: false }>, "ok">): AddAction {
  return { type: "probe", action: { type: "stopped", outcome: { ok: false, ...outcome } } };
}

const SSH_CHECK: readonly AddAction[] = [{ type: "pick", name: "work-mac" }, { type: "start" }];

describe("method step", () => {
  test("offers the two ways in two cards with SSH chosen first", () => {
    const markup = body(initialAddState("ssh"));
    expect(markup).toContain('data-slot="add-computer" data-step="method"');
    expect(markup).toContain(t("desktop.connection.add.method.ssh.title"));
    expect(markup).toContain(t("desktop.connection.add.method.web.title"));
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain(t("desktop.connection.add.step.method"));
    expect(markup).toContain(t("desktop.connection.add.step.save"));
  });

  test("while the ssh config is read it shows three skeleton lines", () => {
    const markup = body(initialAddState("ssh"), { kind: "loading" });
    expect(markup).toContain('data-slot="ssh-hosts-loading"');
    expect(markup).toContain(t("desktop.connection.add.ssh.hostsLoading"));
  });

  test("a missing ssh config says so", () => {
    const markup = body(initialAddState("ssh"), {
      kind: "ready",
      reply: { hosts: [], unreadable: "missing" },
    });
    expect(markup).toContain(t("desktop.connection.add.ssh.missing"));
    expect(markup).not.toContain('role="listbox"');
  });

  test("a config without hosts says so", () => {
    const markup = body(initialAddState("ssh"), {
      kind: "ready",
      reply: { hosts: [], unreadable: null },
    });
    expect(markup).toContain(t("desktop.connection.add.ssh.none"));
  });

  test("hosts are a listbox with the alias, the resolved address and a jump badge", () => {
    const markup = body(stateOf("ssh", { type: "pick", name: "work-mac" }));
    expect(markup).toContain('role="listbox"');
    expect(markup.split('role="option"').length - 1).toBe(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("dev@10.0.0.5:2222");
    expect(markup).toContain(t("desktop.connection.add.ssh.jump"));
    expect(markup).toContain('placeholder="user@host"');
  });

  test("start is locked until a host is picked or typed", () => {
    const label = t("desktop.connection.add.start");
    expect(buttonTagsNamed(footer(initialAddState("ssh")), label).map(isLocked)).toEqual([true]);
    const picked = stateOf("ssh", { type: "pick", name: "lab" });
    expect(buttonTagsNamed(footer(picked), label).map(isLocked)).toEqual([false]);
    const typed = stateOf("ssh", { type: "typed", text: "dev@10.0.0.5 -p 2222" });
    expect(buttonTagsNamed(footer(typed), label).map(isLocked)).toEqual([false]);
    const bad = stateOf("ssh", { type: "typed", text: "dev@ bad host" });
    expect(buttonTagsNamed(footer(bad), label).map(isLocked)).toEqual([true]);
    expect(body(bad)).toContain(t("desktop.connection.add.ssh.typedInvalid"));
  });

  test("the web way asks for one address and goes on with Next", () => {
    const state = stateOf("web", { type: "web", text: "https://my-mac.ts.net" });
    const markup = body(state);
    expect(markup).toContain(t("desktop.connection.add.web.addressHint"));
    expect(markup).not.toContain('role="listbox"');
    const tags = buttonTagsNamed(footer(state), t("desktop.connection.add.next"));
    expect(tags.map(isLocked)).toEqual([false]);
  });
});

describe("check step over SSH", () => {
  test("a running check shows six lines and no save button", () => {
    const state = stateOf("ssh", ...SSH_CHECK, {
      type: "probe",
      action: {
        type: "step",
        event: { step: "resolve", status: "pass", code: "ok", durationMs: 8, actions: [] },
      },
    });
    const markup = body(state);
    expect(markup).toContain('data-step="check"');
    expect(markup).toContain('data-slot="check-steps" data-state="running"');
    expect(markup.split('data-slot="check-step"').length - 1).toBe(6);
    const foot = footer(state);
    expect(buttonTagsNamed(foot, t("desktop.connection.add.save.connect"))).toHaveLength(0);
    expect(buttonTagsNamed(foot, t("desktop.connection.add.back")).map(isLocked)).toEqual([true]);
  });

  test("a new host key shows the trust box inside the panel", () => {
    const state = stateOf(
      "ssh",
      ...SSH_CHECK,
      stop({
        step: "connect",
        status: "action",
        code: "host_key_new",
        actions: ["trust_host_key"],
        detail: {
          hostKey: {
            fingerprint: "SHA256:xyz",
            keyType: "ED25519",
            hostname: "h",
            port: 22,
            scanned: [],
          },
        },
      }),
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="host-key-box" data-tone="neutral"');
    expect(markup).toContain(t("desktop.connection.add.hostKey.new"));
    expect(markup).toContain(t("desktop.connection.add.hostKey.label", { type: "ED25519" }));
    expect(buttonTagsNamed(markup, t("desktop.connection.add.hostKey.trust"))).toHaveLength(1);
  });

  test("a changed host key is a danger box with the replace button", () => {
    const state = stateOf(
      "ssh",
      ...SSH_CHECK,
      stop({
        step: "connect",
        status: "action",
        code: "host_key_changed",
        actions: ["replace_host_key"],
        detail: {
          hostKey: {
            fingerprint: "SHA256:new",
            keyType: "RSA",
            hostname: "h",
            port: 22,
            scanned: [],
          },
        },
      }),
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="host-key-box" data-tone="danger"');
    expect(markup).toContain(t("desktop.connection.add.hostKey.changed"));
    expect(buttonTagsNamed(markup, t("desktop.connection.add.hostKey.replace"))).toHaveLength(1);
  });

  test("password-only gives the ssh-copy-id line to copy", () => {
    const state = stateOf(
      "ssh",
      ...SSH_CHECK,
      stop({
        step: "connect",
        status: "fail",
        code: "auth_password_only",
        actions: ["copy_command"],
        fix: { commands: ["ssh-copy-id -p 2222 dev@10.0.0.5"] },
      }),
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="password-only"');
    expect(markup).toContain('data-slot="command-line"');
    expect(markup).toContain("ssh-copy-id -p 2222 dev@10.0.0.5");
  });

  test("Fresnel missing says so without a command line", () => {
    const state = stateOf(
      "ssh",
      ...SSH_CHECK,
      stop({
        step: "install",
        status: "fail",
        code: "not_installed",
        actions: ["retry"],
        fix: { commands: [], hint: "path_noninteractive", installPath: null },
      }),
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="not-installed"');
    expect(markup).toContain(t("desktop.connection.add.notInstalled"));
    expect(markup).not.toContain('data-slot="command-line"');
  });

  test("a version mismatch shows both versions and which side to update", () => {
    const state = stateOf(
      "ssh",
      ...SSH_CHECK,
      stop({
        step: "install",
        status: "fail",
        code: "version_mismatch",
        actions: ["upgrade_remote"],
        detail: { local: "0.4.1", remote: "0.3.9", lower: "remote" },
      }),
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="version-mismatch"');
    expect(markup).toContain(
      t("desktop.connection.add.version.values", { local: "0.4.1", remote: "0.3.9" }),
    );
    expect(markup).toContain(t("desktop.connection.add.version.fixRemote"));
  });

  test("passing goes to the save step with the suggested name and both save buttons", () => {
    const state = stateOf("ssh", ...SSH_CHECK, {
      type: "passed",
      ready: { address: "ssh://dev@w/run/f.sock", suggested: "work-mac", version: "0.4.1", ms: 42 },
    });
    const markup = body(state);
    expect(markup).toContain('data-step="save"');
    expect(markup).toContain(t("desktop.connection.add.save.ready", { name: "work-mac" }));
    expect(markup).toContain("0.4.1");
    expect(markup).toContain("42ms");
    expect(markup).toContain('value="work-mac"');
    const foot = footer(state);
    expect(buttonTagsNamed(foot, t("desktop.connection.add.save.only")).map(isLocked)).toEqual([
      false,
    ]);
    expect(buttonTagsNamed(foot, t("desktop.connection.add.save.connect")).map(isLocked)).toEqual([
      false,
    ]);
    // 연결 진행 중이면 [저장하고 연결]을 잠근다
    const blocked = footer(state, false);
    expect(
      buttonTagsNamed(blocked, t("desktop.connection.add.save.connect")).map(isLocked),
    ).toEqual([true]);
  });

  test("a duplicate address keeps the save step with the error under the name", () => {
    const state = stateOf(
      "ssh",
      ...SSH_CHECK,
      {
        type: "passed",
        ready: { address: "ssh://a/run/f.sock", suggested: "a", version: null, ms: null },
      },
      { type: "save", read: { kind: "failed", key: "desktop.connection.add.save.duplicate" } },
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="save-error"');
    expect(markup).toContain(t("desktop.connection.add.save.duplicate"));
  });
});

describe("check step over the web", () => {
  const start: readonly AddAction[] = [
    { type: "web", text: "https://my-mac.ts.net" },
    { type: "start" },
  ];
  const FP = "ab".repeat(32);

  test("reading the value is a running inline check", () => {
    const markup = body(stateOf("web", ...start));
    expect(markup).toContain('data-slot="check-inline" data-state="running"');
    expect(markup).not.toContain('data-slot="cert-box"');
  });

  test("the read value is grouped by four and the code field follows", () => {
    const state = stateOf("web", ...start, {
      type: "fingerprint",
      read: { kind: "read", fingerprint: FP },
    });
    const markup = body(state);
    expect(markup).toContain('data-slot="cert-box"');
    expect(markup).toContain("ABAB ABAB");
    expect(markup).toContain('placeholder="ABCDE-12345"');
    const pair = t("desktop.connection.add.web.pair");
    expect(buttonTagsNamed(footer(state), pair).map(isLocked)).toEqual([true]);
    const typed = addReducer(state, { type: "code", text: "abcde12345" });
    expect(typed.code).toBe("ABCDE-12345");
    expect(buttonTagsNamed(footer(typed), pair).map(isLocked)).toEqual([false]);
  });

  test("a wrong code shows the error under the field and clears the field", () => {
    const state = stateOf(
      "web",
      ...start,
      { type: "fingerprint", read: { kind: "read", fingerprint: FP } },
      { type: "code", text: "ABCDE12345" },
      { type: "pair", read: { kind: "failed", key: "desktop.connection.pair.error.invalidCode" } },
    );
    const markup = body(state);
    expect(markup).toContain('data-slot="pair-error"');
    expect(markup).toContain(t("desktop.connection.pair.error.invalidCode"));
    expect(state.code).toBe("");
  });

  test("a locked pairing says how many seconds to wait", () => {
    const state = stateOf(
      "web",
      ...start,
      { type: "fingerprint", read: { kind: "read", fingerprint: FP } },
      {
        type: "pair",
        read: { kind: "failed", key: "desktop.connection.pair.error.locked", seconds: 30 },
      },
    );
    expect(body(state)).toContain(t("desktop.connection.pair.error.locked", { seconds: 30 }));
  });
});
