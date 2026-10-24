import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  checkSettingDef,
  type ScopeLayer,
  type ScopeStack,
} from "@xeon/contracts/settings";
import { createAskService } from "../src/ask/service.ts";
import {
  DEFAULT_DIALOG_SETTINGS,
  DIALOG_SETTING_DEFS,
  readDialogSettings,
} from "../src/settings.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

const KEYS = [
  "l2.dialog.ask.timeoutSec",
  "l2.dialog.commands.dirs",
  "l2.dialog.commands.advertise",
  "l2.dialog.commands.shellInjection",
  "l2.dialog.status.segments",
  "l2.dialog.attachments.maxBytes",
  "l2.dialog.styles.active",
  "l2.dialog.notify.os",
  "l2.dialog.notify.completed",
  "l2.dialog.notify.approvalWaiting",
  "l2.dialog.notify.questionWaiting",
  "l2.dialog.notify.error",
  "l2.dialog.notify.backgroundCompleted",
];

describe("설정 키 13개", () => {
  test("선언이 spec §6 표와 같고 규칙 D1~D9를 통과한다", () => {
    expect(DIALOG_SETTING_DEFS.map((def) => def.key)).toEqual(KEYS);
    for (const def of DIALOG_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L2");
      expect(def.since).toBe("0.1.0");
      expect(def.secret).toBeUndefined();
    }
    const built = buildCatalog([
      { owner: "cap-dialog", namespace: "l2.dialog", defs: DIALOG_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("기본값, 범위, 변경 시점, 허용 범위가 표와 같다", () => {
    const byKey = new Map(DIALOG_SETTING_DEFS.map((def) => [def.key, def]));
    const get = (key: string) => {
      const def = byKey.get(key);
      if (def === undefined) throw new Error(`missing ${key}`);
      return def;
    };
    expect(get("l2.dialog.ask.timeoutSec")).toMatchObject({
      default: 0,
      range: { min: 0, max: 86400 },
      runtimeChange: "nextTurn",
      allowedScopes: ["user", "project", "local", "session"],
    });
    expect(get("l2.dialog.commands.dirs")).toMatchObject({
      default: [],
      allowedScopes: ["user", "project", "local"],
    });
    expect(get("l2.dialog.commands.advertise").default).toBe(true);
    expect(get("l2.dialog.commands.shellInjection")).toMatchObject({
      default: "confirm",
      range: { enum: ["confirm", "off"] },
      allowedScopes: ["managed", "user", "project", "local"],
    });
    expect(get("l2.dialog.status.segments")).toMatchObject({
      default: ["core.turn", "core.tools", "core.usage", "*"],
      runtimeChange: "live",
    });
    expect(get("l2.dialog.attachments.maxBytes")).toMatchObject({
      default: 20971520,
      range: { min: 1024, max: 104857600 },
    });
    expect(get("l2.dialog.styles.active").default).toBe("default");
    expect(get("l2.dialog.notify.os")).toMatchObject({
      default: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
    });
    for (const key of KEYS.filter((candidate) => candidate.startsWith("l2.dialog.notify."))) {
      expect(get(key).default).toBe(true);
    }
  });

  test("값이 없으면 기본값이다", () => {
    expect(readDialogSettings([])).toEqual(DEFAULT_DIALOG_SETTINGS);
  });

  test("범위 우선순위를 따르고 틀린 값은 건너뛴다", () => {
    const stack: ScopeStack = [
      layer("user", {
        "l2.dialog.ask.timeoutSec": 60,
        "l2.dialog.commands.shellInjection": "off",
        "l2.dialog.commands.dirs": ["~/a"],
      }),
      layer("session", { "l2.dialog.ask.timeoutSec": 5 }),
      // 범위 밖과 모르는 enum 값은 건너뛴다
      layer("project", {
        "l2.dialog.attachments.maxBytes": 10,
        "l2.dialog.commands.shellInjection": "always",
      }),
    ];
    const settings = readDialogSettings(stack);
    expect(settings.ask.timeoutSec).toBe(5);
    expect(settings.commands.shellInjection).toBe("off");
    expect(settings.commands.dirs).toEqual(["~/a"]);
    expect(settings.attachments.maxBytes).toBe(DEFAULT_DIALOG_SETTINGS.attachments.maxBytes);
  });

  test("변경은 다음 호출부터 적용된다", async () => {
    let layers: ScopeStack = [layer("user", { "l2.dialog.ask.timeoutSec": 10 })];
    const h = harness();
    const deps = { ...h.deps, settings: () => readDialogSettings(layers) };
    const { api } = createAskService(deps);
    const thread = newThread();
    await api.ask(
      { questions: [{ id: "q", question: "?" }] },
      callOptions(thread, { requestId: "a" }),
    );
    expect(h.timers.pending()).toBe(1);
    layers = [layer("user", { "l2.dialog.ask.timeoutSec": 0 })];
    await api.ask(
      { questions: [{ id: "q", question: "?" }] },
      callOptions(thread, { requestId: "b" }),
    );
    expect(h.timers.pending()).toBe(1);
  });
});
