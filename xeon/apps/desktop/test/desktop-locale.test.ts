import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { attachErrorKey, attachFixKey, type AttachFailureKind } from "@fresnel/client";
import { activeLocale, catalogOf, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { WIRE_ERRORS, type TrustStatus } from "@fresnel/contracts/wire";
import { DESKTOP_SETTING_DEFS } from "../src/settings-store/defs.ts";
import { unknownFailureText } from "../src/state/engine/failure-text.ts";
import type { DurableFact, MirrorInput } from "../src/state/engine/input.ts";
import { reduceMirror } from "../src/state/engine/reduce.ts";
import { INITIAL_MIRROR } from "../src/state/engine/state.ts";
import { composerDisabledReason } from "../src/views/composer-model.ts";
import { setupRequiredText } from "../src/views/setup-needed.ts";
import { trustCardOf } from "../src/views/trust-model.ts";
import {
  checkWorkspaceInput,
  createFailureText,
  workspaceHint,
} from "../src/views/workspace-model.ts";
import { evt, STORE, SUB, summary, thr, trn } from "./state/helpers.ts";

// 데스크톱 `.ts` 문장을 카탈로그 id로 옮긴 뒤의 시험(B4-I18N D1). 시험 프로세스는 ko로 시작하므로(scripts/test-preload.ts)
// 영어를 보는 시험은 로케일을 바꾸고 끝나면 되돌린다. 설정 항목의 ko 문장은 카탈로그의 ko 문장과 같아야 한다.

const T = thr(1);

function trustStatus(options: TrustStatus["options"]): TrustStatus {
  return {
    projectRoot: "/work/repo",
    required: true,
    verdict: "undecided",
    via: "default",
    resources: [".mcp.json"],
    options,
  };
}

describe("desktop sentences in English", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("en");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("trust card buttons read the English option labels, unknown labels stay as they are", () => {
    const card = trustCardOf(
      trustStatus([
        {
          choice: { kind: "folder", verdict: "allow" },
          label: "trust-folder",
          savedPath: "/work/repo",
        },
        { choice: { kind: "parent", verdict: "allow" }, label: "trust-parent", savedPath: "/work" },
        { choice: { kind: "session", verdict: "allow" }, label: "trust-session", savedPath: null },
        {
          choice: { kind: "folder", verdict: "deny" },
          label: "deny-folder",
          savedPath: "/work/repo",
        },
        { choice: { kind: "session", verdict: "deny" }, label: "deny-session", savedPath: null },
        { choice: { kind: "session", verdict: "deny" }, label: "future-label", savedPath: null },
      ]),
    );
    expect(card?.buttons.map((button) => button.text)).toEqual([
      "Trust this folder",
      "Trust the whole parent folder",
      "Trust for this run only",
      "Do not trust this folder",
      "Deny for this run only",
      "future-label",
    ]);
  });

  test("workspace hints and the create failure text are English", () => {
    expect(workspaceHint(checkWorkspaceInput("relative/x"))).toBe(
      "Enter the working folder as an absolute path. Example: /Users/me/project",
    );
    expect(workspaceHint(checkWorkspaceInput(`/${"a".repeat(4096)}`))).toBe(
      "The working folder path is too long.",
    );
    expect(workspaceHint(checkWorkspaceInput("/Users/me/project"))).toBeNull();

    const refused = { kind: "rejected", code: WIRE_ERRORS["jsonrpc.invalidParams"].code } as const;
    expect(createFailureText(refused, true)).toBe(
      "Could not open the working folder. Check that it is the absolute path of an existing folder.",
    );
    expect(createFailureText(refused, false)).toBe("Could not create the new conversation.");
    expect(createFailureText({ kind: "rejected", code: null, issue: "timeout" }, false)).toBe(
      "The engine did not answer in time. Check the engine status and try again.",
    );
    expect(createFailureText({ kind: "offline" }, true)).toBe(
      "Could not create the new conversation.",
    );
  });

  test("composer lock reasons and the setup sentence are English", () => {
    const ready = {
      engineRunning: true,
      phase: "live",
      observing: false,
      setupNeeded: false,
    } as const;
    expect(composerDisabledReason({ ...ready, engineRunning: false })).toBe(
      "The engine is off, so the message cannot be sent.",
    );
    expect(composerDisabledReason({ ...ready, phase: "resync" })).toBe("Syncing the connection.");
    expect(composerDisabledReason({ ...ready, observing: true })).toBe(
      "Another window is using this conversation, so this one can only watch it.",
    );
    expect(composerDisabledReason({ ...ready, setupNeeded: true })).toBe(setupRequiredText());
    expect(setupRequiredText()).toBe(
      "Set a model key and a default model before starting a conversation.",
    );
    expect(composerDisabledReason(ready)).toBeNull();
  });

  test("a failed turn without a cause gets the English cause text in the mirror", () => {
    const done: DurableFact = {
      type: "turn.completed",
      seq: 6,
      eventId: evt(6),
      threadId: T,
      turnId: trn(1),
      at: "t",
      payload: { status: "failed", stepCount: 1, usage: null, error: null },
    };
    const inputs: MirrorInput[] = [
      { type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } },
      { type: "subscribed", sub: SUB, storeId: STORE, start: 5, live: true, from: "head" },
      { type: "threads", threads: [summary(T)] },
      { type: "batch", sub: SUB, from: 5, to: 6, caughtUp: true, facts: [done] },
    ];
    let state = INITIAL_MIRROR;
    for (const input of inputs) state = reduceMirror(state, input).state;
    expect(state.turnFailures[T]).toBe("The cause is unknown.");
    expect(unknownFailureText()).toBe("The cause is unknown.");
  });
});

describe("desktop setting labels in the catalog", () => {
  // 설정 항목의 ko 문장과 영어 대체 문구. 설정 화면은 labelKey·helpKey로 카탈로그 문장을 읽는다
  const SETTING_KO: Readonly<Record<string, readonly [string, string]>> = {
    "l4.desktop.window.closeBehavior": [
      "창 닫기 동작",
      "트레이로 두면 창을 닫아도 메뉴 막대(트레이) 아이콘이 남고 엔진과 진행 중인 턴이 계속돼요. 아이콘이 열기, 새 대화, 끝내기를 줘요.",
    ],
    "l4.desktop.engine.restartLimit": [
      "엔진 자동 재기동 횟수",
      "10분 안에서 엔진이 비정상 종료하면 자동으로 다시 띄우는 횟수예요. 0이면 자동 재기동을 꺼요.",
    ],
    "l4.desktop.engine.shutdownGraceMs": [
      "엔진 종료 대기 시간",
      "종료를 요청한 뒤 엔진이 끝나기를 기다리는 시간이에요. 엔진의 종료 시한보다 2000 ms 이상 길어야 해요.",
    ],
  };

  test("every desktop setting has a label and help id, and the ko sentences match the catalog", () => {
    const ko = catalogOf("ko");
    expect(DESKTOP_SETTING_DEFS.map((def) => def.key).toSorted()).toEqual(
      Object.keys(SETTING_KO).toSorted(),
    );
    for (const def of DESKTOP_SETTING_DEFS) {
      const ui = def.ui;
      const [koLabel, koHelp] = SETTING_KO[def.key] ?? [];
      expect(ui?.labelKey).toBeString();
      expect(ui?.helpKey).toBeString();
      expect(ko[ui?.labelKey ?? "missing"]).toBe(koLabel);
      expect(ko[ui?.helpKey ?? "missing"]).toBe(koHelp);
    }
  });

  test("the English fallback of each setting equals its English catalog sentence", () => {
    const en = catalogOf("en");
    for (const def of DESKTOP_SETTING_DEFS) {
      const ui = def.ui;
      expect(ui?.label).toBe(en[ui?.labelKey ?? "missing"]);
      expect(ui?.help).toBe(en[ui?.helpKey ?? "missing"]);
    }
  });
});

describe("connection failure cause and fix lines in the catalog", () => {
  // 연결 실패 종류마다 원인 한 줄과 해결 한 줄(`.fix`)을 둔다. 문장은 연결 화면이 `t()`로 만든다
  const KO: Readonly<Record<AttachFailureKind, readonly [string, string]>> = {
    socketMissing: ["서비스 소켓이 없어요.", "원격 서비스가 켜져 있는지, 주소가 맞는지 확인해요."],
    refused: ["서비스가 연결을 거절했어요.", "서비스가 그 주소와 포트에서 듣고 있는지 확인해요."],
    timeout: [
      "서비스가 제때 답하지 않았어요.",
      "서비스가 켜져 있고 네트워크가 이어졌는지 확인한 뒤 다시 해 봐요.",
    ],
    permission: ["서비스 소켓에 접근할 수 없어요.", "소켓 파일과 폴더의 소유자와 권한을 확인해요."],
    tunnel: [
      "SSH 터널을 열지 못했어요.",
      "주소와 SSH 접속을 확인해요. 비밀번호 없이 접속되는 키나 ssh-agent가 필요해요.",
    ],
    hostKey: [
      "SSH 호스트 키를 확인하지 못했어요.",
      "터미널에서 한 번 ssh로 접속해 호스트 키를 믿은 뒤 다시 해 봐요.",
    ],
    tokenMissing: [
      "이 대상은 토큰이 필요해요.",
      "앱을 FRESNEL_REMOTE_TOKEN 환경 변수와 함께 열어요.",
    ],
    auth: [
      "원격 서비스가 접속을 거절했어요. 토큰이 없거나 맞지 않아요.",
      "FRESNEL_REMOTE_TOKEN이 서버의 토큰과 같은지 확인해요.",
    ],
    protocol: ["원격 서비스와 버전이 맞지 않아요.", "두 쪽을 같은 버전으로 맞춰요."],
    other: ["연결하지 못했어요.", "진단 복사로 로그를 모아 두고 엔진을 다시 시작해 봐요."],
  };

  const EN: Readonly<Record<AttachFailureKind, readonly [string, string]>> = {
    socketMissing: [
      "The service socket does not exist.",
      "Check that the remote service is running and the address is right.",
    ],
    refused: [
      "The service refused the connection.",
      "Check that the service is listening on that address and port.",
    ],
    timeout: [
      "The service did not answer in time.",
      "Check that the service is running and the network is connected, then try again.",
    ],
    permission: [
      "The service socket can't be accessed.",
      "Check the owner and permissions of the socket file and its folder.",
    ],
    tunnel: [
      "Couldn't open the SSH tunnel.",
      "Check the address and SSH access. You need a key that logs in without a password, or ssh-agent.",
    ],
    hostKey: [
      "Couldn't verify the SSH host key.",
      "Connect once with ssh in a terminal to trust the host key, then try again.",
    ],
    tokenMissing: [
      "This target needs a token.",
      "Open the app with the FRESNEL_REMOTE_TOKEN environment variable set.",
    ],
    auth: [
      "The remote service refused the connection. The token is missing or doesn't match.",
      "Check that FRESNEL_REMOTE_TOKEN matches the server's token.",
    ],
    protocol: [
      "The remote service's version doesn't match.",
      "Use the same version on both sides.",
    ],
    other: [
      "Couldn't connect.",
      "Use Copy diagnostics to collect the logs, then restart the engine.",
    ],
  };

  const KINDS: readonly AttachFailureKind[] = [
    "socketMissing",
    "refused",
    "timeout",
    "permission",
    "tunnel",
    "hostKey",
    "tokenMissing",
    "auth",
    "protocol",
    "other",
  ];

  test("every failure kind has its Korean cause and fix sentences", () => {
    const ko = catalogOf("ko");
    for (const kind of KINDS) {
      const [cause, fix] = KO[kind];
      expect(ko[attachErrorKey(kind)]).toBe(cause);
      expect(ko[attachFixKey(kind)]).toBe(fix);
    }
  });

  test("every failure kind has its English cause and fix sentences", () => {
    const en = catalogOf("en");
    for (const kind of KINDS) {
      const [cause, fix] = EN[kind];
      expect(en[attachErrorKey(kind)]).toBe(cause);
      expect(en[attachFixKey(kind)]).toBe(fix);
    }
  });
});
