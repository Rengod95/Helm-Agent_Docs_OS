import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, catalogOf, setActiveLocale, type Locale } from "@xeon/client/i18n";
import { WIRE_ERRORS, type TrustStatus } from "@xeon/contracts/wire";
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
// 영어를 보는 시험은 로케일을 바꾸고 끝나면 되돌린다. 설정 항목의 ko 문장은 옮기기 전 원문과 같아야 한다.

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
  // 옮기기 전 ko 원문과 영어 대체 문구. 설정 화면은 labelKey·helpKey로 카탈로그 문장을 읽는다
  const SETTING_KO: Readonly<Record<string, readonly [string, string]>> = {
    "l4.desktop.window.closeBehavior": [
      "창 닫기 동작",
      "tray이면 창을 닫아도 엔진과 진행 중 turn이 남는다. 창은 다시 실행하거나 Dock을 눌러 다시 연다",
    ],
    "l4.desktop.engine.restartLimit": [
      "엔진 자동 재기동 횟수",
      "10분 안에서 엔진이 비정상 종료하면 자동으로 다시 띄우는 횟수다. 0이면 자동 재기동을 끈다",
    ],
    "l4.desktop.engine.shutdownGraceMs": [
      "엔진 종료 대기 시간",
      "종료를 요청한 뒤 엔진이 끝나기를 기다리는 시간이다. 엔진의 종료 시한보다 2000 ms 이상 길어야 한다",
    ],
  };

  test("every desktop setting has a label and help id, ko keeps the original sentence", () => {
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
