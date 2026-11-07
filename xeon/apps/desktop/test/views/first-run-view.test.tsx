import { describe, expect, test } from "bun:test";
import { toolsWebViewOf } from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import type { BinaryView, SetupSnapshot } from "@fresnel/client/settings";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type {
  WebProviderStatus,
  WebProvidersResult,
  WebSettingsWire,
} from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import type { GroupsSnapshot, SearchSnapshot } from "../../src/views/commands.ts";
import {
  firstRunModelOf,
  type FirstRunKeyEntry,
  type FirstRunModel,
} from "../../src/views/pages/first-run/first-run-model.ts";
import {
  FirstRunView,
  type FirstRunViewHandlers,
  type FirstRunViewProps,
} from "../../src/views/pages/first-run/first-run-view.tsx";

// 첫 실행 화면의 서버 렌더. 읽는 중, 오류, 오프라인, 안전 모드 그룹, 긴 도구 표, 키 칸, 잠긴 기본 모델, 바닥글, 검색 권장을 그린다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 first-run-model.test.ts가 본다). 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: FirstRunViewHandlers = {
  open: NOOP,
  recheck: NOOP,
  retry: NOOP,
  provider: NOOP,
  model: NOOP,
  register: NOOP,
  submitKey: NOOP,
  cancelKey: NOOP,
  retryKey: NOOP,
  connect: NOOP,
  saveModel: NOOP,
  setGroup: NOOP,
  dismissSearch: NOOP,
  registerSecret: NOOP,
  openLightCraft: NOOP,
  startChat: NOOP,
  openSettings: NOOP,
};

const SETUP: SetupSnapshot = {
  providers: [],
  defaultModel: null,
  secrets: [],
  toolsReady: true,
  binaries: null,
};

const GROUPS: GroupsSnapshot = { enabled: { helm: null, learning: null }, safeMode: false };

function modelOf(setup: SetupSnapshot | null, groups: GroupsSnapshot | null): FirstRunModel | null {
  if (setup === null) return null;
  return firstRunModelOf({ setup, search: null, groups });
}

/** 화면 props. 값을 주지 않은 칸은 키 없는 설치, 읽은 설정, 기본 그룹으로 채운다 */
function propsOf(over: Partial<FirstRunViewProps> = {}): FirstRunViewProps {
  const setup: SetupSnapshot | null = over.setup === undefined ? SETUP : over.setup;
  const model: FirstRunModel | null =
    over.model === undefined ? modelOf(setup, GROUPS) : over.model;
  const keyEntry: FirstRunKeyEntry = { state: "idle" };
  return {
    status: "ready",
    reason: null,
    locked: false,
    open: "tools",
    providerInput: "anthropic",
    modelInput: "",
    modelChoices: [],
    keyEntry,
    notice: null,
    engineState: "엔진 실행 중 · 연결됨",
    settingsProblem: null,
    handlers,
    ...over,
    setup,
    model,
  };
}

const WEB_SETTINGS: WebSettingsWire = {
  searchProvider: "auto",
  searchOrder: [],
  searchParallel: 1,
  browseProvider: "auto",
  browseOrder: [],
  robots: "never",
};

function webRow(id: string, status: WebProviderStatus["status"]): WebProviderStatus {
  return {
    id,
    capability: "web.search",
    origin: "plugin",
    displayName: id,
    auth: "bearer",
    status,
    pricingAsOf: null,
    pricingStale: false,
    firstUseNoticed: true,
    autoRank: null,
  };
}

/** 검색 권장을 읽은 결과. 행을 주지 않은 권장 플러그인은 "설치 안 됨"이다 */
function searchOf(rows: readonly WebProviderStatus[]): SearchSnapshot {
  const result: WebProvidersResult = { providers: [...rows], settings: WEB_SETTINGS };
  return { web: toolsWebViewOf(result), dismissed: false };
}

function html(props: FirstRunViewProps): string {
  return renderToString(<FirstRunView {...props} />);
}

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

/** 도구 점검 결과 `total`개 중 앞의 `required`개가 필수다 */
function binaries(total: number, required: number): BinaryView {
  return {
    platform: "darwin",
    ready: true,
    rows: Array.from({ length: total }, (_, i) => ({
      name: `tool-${i}`,
      need: i < required ? "required" : "optional",
      usedBy: "shell",
      ok: true,
      note: "1.0.0",
      impact: "",
    })),
  };
}

describe("first-run screen server render", () => {
  test("the five steps are one accordion list, the done step is marked, and the open step shows its body", () => {
    const page = html(propsOf({ open: "tools" }));
    expect(page.match(/data-slot="accordion-item"/g)?.length).toBe(5);
    expect(page).toContain(t("desktop.firstRun.step.tools"));
    expect(page).toContain(t("desktop.firstRun.step.groups"));
    expect(page).toContain('data-status="done"');
    expect(page).toContain(t("desktop.firstRun.chat.start"));
  });

  test("loading shows a progress indicator on the steps and no error", () => {
    const page = html(propsOf({ status: "loading", setup: null, model: null }));
    expect(page).toContain('role="progressbar"');
    expect(page).not.toContain(t("desktop.firstRun.loadFailed"));
  });

  test("a failed read says the settings could not be read, shows the reason, and offers a retry", () => {
    const page = html(
      propsOf({ status: "error", reason: "engine busy", setup: null, model: null }),
    );
    expect(page).toContain(t("desktop.firstRun.loadFailed"));
    expect(page).toContain("engine busy");
    expect(page).toContain(t("desktop.firstRun.retry"));
  });

  test("offline keeps the last read values, says the writes are locked, and disables the switches", () => {
    const page = html(propsOf({ status: "offline", locked: true, open: "groups" }));
    expect(page).toContain(t("desktop.firstRun.offline"));
    // helm, learning, review 세 줄의 스위치가 모두 잠긴다(review는 원래 바꿀 수 없다)
    expect(page.match(/role="switch"[^>]*disabled=""/g)?.length).toBe(3);
  });

  test("the safe mode line shows at the top of the default groups step, with helm and learning on and review off", () => {
    const groups: GroupsSnapshot = { enabled: { helm: null, learning: null }, safeMode: true };
    const page = html(propsOf({ open: "groups", model: modelOf(SETUP, groups) }));
    expect(page).toContain(t("desktop.firstRun.groups.safeMode"));
    expect(page.match(/role="switch"[^>]*data-state="checked"/g)?.length).toBe(2);
    expect(page).toContain(t("desktop.firstRun.group.review.name"));
    expect(page).toContain(t("desktop.firstRun.groups.lightCraft"));
    expect(page).not.toContain("group new");
  });

  test("a long tool list shows the required tools and folds the optional ones behind a count", () => {
    const page = html(propsOf({ open: "tools", setup: { ...SETUP, binaries: binaries(10, 3) } }));
    expect(page).toContain("tool-0");
    expect(page).toContain(t("desktop.firstRun.tools.optionalFold", { count: 7 }));
  });

  test("a short tool list shows every tool without folding", () => {
    const page = html(propsOf({ open: "tools", setup: { ...SETUP, binaries: binaries(3, 1) } }));
    expect(page).toContain("tool-2");
    expect(page).not.toContain(t("desktop.firstRun.tools.optionalFold", { count: 2 }));
  });

  test("the key step shows a password field for the value", () => {
    const page = html(
      propsOf({
        open: "key",
        keyEntry: {
          state: "form",
          name: nameOf("anthropic-api-key"),
          action: "add",
          providerId: "anthropic",
        },
      }),
    );
    expect(page).toContain('type="password"');
    expect(page).toContain(t("desktop.firstRun.key.valueLabel"));
  });

  test("the footer shows the engine line as given", () => {
    const page = html(propsOf({ engineState: "엔진 실행 중 · 연결됨" }));
    expect(page).toContain("엔진 실행 중 · 연결됨");
  });

  test("a recommendation that is not installed or has no key offers the install help link, and a ready one offers nothing", () => {
    const missingModel = firstRunModelOf({
      setup: SETUP,
      search: searchOf([webRow("plugin:web-exa", { kind: "unavailable", reason: "no-key" })]),
      groups: GROUPS,
    });
    const missing = html(propsOf({ open: "search", model: missingModel }));
    // Exa는 키 없음, Brave는 행이 없어 설치 안 됨이다. 둘 다 설치 방법 보기 링크가 있다
    expect(missing.split(t("desktop.firstRun.search.installHelp")).length - 1).toBe(2);
    const ready = firstRunModelOf({
      setup: SETUP,
      search: searchOf([
        webRow("plugin:web-exa", { kind: "ok" }),
        webRow("plugin:web-brave", { kind: "ok" }),
      ]),
      groups: GROUPS,
    });
    expect(html(propsOf({ open: "search", model: ready }))).not.toContain(
      t("desktop.firstRun.search.installHelp"),
    );
  });

  test("a plugin with no key shows a key button, and its key form names the recommended secret", () => {
    const model = firstRunModelOf({
      setup: SETUP,
      search: searchOf([webRow("plugin:web-exa", { kind: "unavailable", reason: "no-key" })]),
      groups: GROUPS,
    });
    const page = html(
      propsOf({
        open: "search",
        model,
        keyEntry: {
          state: "form",
          name: nameOf("exa-api-key"),
          action: "add",
          providerId: null,
        },
      }),
    );
    expect(page).toContain(t("desktop.settings.key.register.button"));
    expect(page).toContain("<code>exa-api-key</code>");
    expect(page).toContain('type="password"');
  });

  test("the install note stays closed until the help link is opened", () => {
    const model = firstRunModelOf({
      setup: SETUP,
      search: searchOf([]),
      groups: GROUPS,
    });
    expect(html(propsOf({ open: "search", model }))).not.toContain(
      t("desktop.firstRun.search.installNote"),
    );
  });

  test("the default model step is locked until a key is registered", () => {
    const page = html(propsOf({ open: "model" }));
    expect(page).toContain(t("desktop.firstRun.model.locked"));
  });

  test("a key failure text shows in the key step", () => {
    const page = html(
      propsOf({ open: "key", keyEntry: { state: "failed", text: "the keychain is locked" } }),
    );
    expect(page).toContain("the keychain is locked");
    expect(page).not.toContain(t("desktop.firstRun.key.retry"));
  });

  test("a key store failure shows the sentence with retry and help buttons and no terminal command", () => {
    const page = html(
      propsOf({
        open: "key",
        keyEntry: {
          state: "failed",
          text: t("client.settings.key.keystore"),
          keystore: { name: nameOf("anthropic-api-key"), action: "add", providerId: "anthropic" },
        },
      }),
    );
    expect(page).toContain(t("client.settings.key.keystore"));
    expect(page).toContain(t("desktop.firstRun.key.retry"));
    expect(page).toContain(t("desktop.firstRun.key.help"));
    expect(page).not.toContain("fresnel config");
  });

  test("a technical detail such as an exit code stays behind the details button, after the sentence that says what to do", () => {
    const page = html(
      propsOf({
        open: "key",
        keyEntry: {
          state: "failed",
          text: t("client.settings.key.rejected"),
          detail: "종료 코드 3",
        },
      }),
    );
    expect(page).toContain("키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    expect(page).toContain(t("desktop.firstRun.key.details"));
    expect(page).not.toContain("종료 코드");
  });

  test("a start button that is off says why in one visible line, key first and then the default model", () => {
    const noKey = html(propsOf());
    expect(noKey).toContain(t("desktop.firstRun.chat.blockedKey"));
    expect(noKey).not.toContain(t("desktop.firstRun.chat.blockedModel"));
    const keyed: SetupSnapshot = {
      ...SETUP,
      providers: [
        { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
      ],
      secrets: [{ name: "anthropic-api-key", registered: true }],
    };
    const noModel = html(propsOf({ setup: keyed, model: modelOf(keyed, GROUPS) }));
    expect(noModel).toContain(t("desktop.firstRun.chat.blockedModel"));
    expect(noModel).not.toContain(t("desktop.firstRun.chat.blockedKey"));
    const ready: SetupSnapshot = { ...keyed, defaultModel: "anthropic/claude-haiku-5-5" };
    const done = html(propsOf({ setup: ready, model: modelOf(ready, GROUPS) }));
    expect(done).not.toContain(t("desktop.firstRun.chat.blockedKey"));
    expect(done).not.toContain(t("desktop.firstRun.chat.blockedModel"));
  });

  test("the default model step lists the host catalog and has no free text box", () => {
    const keyed: SetupSnapshot = {
      ...SETUP,
      providers: [
        { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
      ],
      secrets: [{ name: "anthropic-api-key", registered: true }],
    };
    const page = html(
      propsOf({
        open: "model",
        setup: keyed,
        model: modelOf(keyed, GROUPS),
        modelChoices: [
          {
            ref: "anthropic/claude-haiku-5-5",
            name: "Haiku 5.5",
            contextWindow: 200000,
            reasoning: true,
            inputPrice: null,
            outputPrice: null,
          },
        ],
        modelInput: "anthropic/claude-nonexistent-9",
      }),
    );
    expect(page).toContain(t("desktop.firstRun.model.missing"));
    expect(page).not.toContain(t("desktop.firstRun.model.locked"));
  });
});

describe("first run settings problem banner", () => {
  test("a settings file the engine could not read shows the banner above everything else", () => {
    const page = html(
      propsOf({
        settingsProblem: {
          scope: "user",
          path: "/home/me/.fresnel/settings.json",
          reason: "invalid_json",
          line: 3,
          column: 5,
        },
      }),
    );
    expect(page).toContain(t("desktop.settings.problem.title"));
    expect(page).toContain("~/.fresnel/settings.json (3줄 5칸)");
    expect(page).toContain(t("desktop.settings.problem.openFile"));
    expect(page.indexOf(t("desktop.settings.problem.title"))).toBeLessThan(
      page.indexOf(t("desktop.firstRun.step.tools")),
    );
  });

  test("without a problem the first run screen draws no banner", () => {
    expect(html(propsOf())).not.toContain(t("desktop.settings.problem.title"));
  });
});
