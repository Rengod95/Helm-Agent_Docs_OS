import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { BinaryView, SetupSnapshot } from "@fresnel/client/settings";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import { renderToString } from "react-dom/server";
import type { GroupsSnapshot } from "../../src/views/commands.ts";
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

// 첫 실행 화면의 서버 렌더. 읽는 중, 오류, 오프라인, 안전 모드 그룹, 긴 도구 표, 키 칸, 잠긴 기본 모델을 그린다.
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
  connect: NOOP,
  saveModel: NOOP,
  setGroup: NOOP,
  dismissSearch: NOOP,
  openLightCraft: NOOP,
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
    keyEntry,
    notice: null,
    handlers,
    ...over,
    setup,
    model,
  };
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
  test("the five steps are a checklist, the done step is marked, and the open step's heading shows", () => {
    const page = html(propsOf({ open: "tools" }));
    expect(page.match(/data-slot="stepper-item"/g)?.length).toBe(5);
    expect(page).toContain(t("desktop.firstRun.step.tools"));
    expect(page).toContain(t("desktop.firstRun.step.groups"));
    expect(page).toContain('data-status="done"');
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
    expect(page.match(/role="switch"[^>]*disabled=""/g)?.length).toBe(2);
  });

  test("the safe mode line shows at the top of the default groups step, with helm and learning on and review off", () => {
    const groups: GroupsSnapshot = { enabled: { helm: null, learning: null }, safeMode: true };
    const page = html(propsOf({ open: "groups", model: modelOf(SETUP, groups) }));
    expect(page).toContain(t("desktop.firstRun.groups.safeMode"));
    expect(page.match(/role="switch"[^>]*data-state="checked"/g)?.length).toBe(2);
    expect(page).toContain(t("desktop.firstRun.group.off"));
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
        keyEntry: { state: "form", name: nameOf("anthropic-api-key"), action: "add" },
      }),
    );
    expect(page).toContain('type="password"');
    expect(page).toContain(t("desktop.firstRun.key.valueLabel"));
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
  });
});
