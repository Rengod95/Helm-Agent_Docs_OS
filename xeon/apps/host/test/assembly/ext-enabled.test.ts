import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type {
  ExtHost,
  ExtensionLoader,
  LoadedExtensionInfo,
  OperationsPolicy,
} from "@fresnel/ext-host";
import {
  extNameOfEnabledKey,
  followBuiltinEnabled,
  followExtEnabled,
} from "../../src/assembly/ext-enabled.ts";
import type { SettingsChange } from "../../src/types.ts";
import { partial } from "../fixtures/unsafe.ts";

// 일반 켜기 스위치(`ext.<이름>.enabled`가 참이 되는 변경)가 로더의 settingChanged와 "다시 켜기"를 부른다.

type OwnerKey = ReturnType<OperationsPolicy["autoDisabler"]["disabled"]>[number];

interface Rig {
  readonly fire: (change: SettingsChange) => void;
  readonly calls: string[];
  readonly warnings: string[];
  /** 경고 한 건마다 `[문장, 값]` */
  readonly details: unknown[];
  /** `settled`를 부른 횟수만큼 `"settled"`가 쌓인다 */
  readonly settles: string[];
  readonly settle: () => Promise<void>;
}

function rig(options: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly disabled?: readonly OwnerKey[];
  readonly asked?: readonly OwnerKey[];
  readonly loader?: "none" | "reject" | "not-active";
}): Rig {
  const calls: string[] = [];
  const warnings: string[] = [];
  const details: unknown[] = [];
  const settles: string[] = [];
  let listener: ((change: SettingsChange) => void) | undefined;
  const loader = partial<ExtensionLoader>({
    settingChanged: (name) => {
      calls.push(`settingChanged:${name}`);
      if (options.loader === "reject") return Promise.reject(new Error("load failed"));
      if (options.loader === "not-active") {
        // 적재가 실리지 않은 채 돌아온다(시작 조건 불충족). 진단 코드가 사유다
        return Promise.resolve(
          partial<LoadedExtensionInfo>({
            name,
            state: "disabled",
            diagnostics: [
              partial<LoadedExtensionInfo["diagnostics"][number]>({ code: "config_required" }),
            ],
          }),
        );
      }
      // 보통의 켜기는 실린 확장(active)이 돌아온다
      return Promise.resolve(
        partial<LoadedExtensionInfo>({ name, state: "active", diagnostics: [] }),
      );
    },
  });
  followExtEnabled({
    onChange: (next) => {
      listener = next;
      return () => {};
    },
    value: (key) => options.values[key],
    loader: () => (options.loader === "none" ? undefined : loader),
    autoDisabler: partial<OperationsPolicy["autoDisabler"]>({
      disabled: () => options.disabled ?? [],
      questions: () =>
        (options.asked ?? []).map((key) =>
          partial<ReturnType<OperationsPolicy["autoDisabler"]["questions"]>[number]>({ key }),
        ),
      reenable: (key) => {
        calls.push(`reenable:${key}`);
      },
    }),
    logger: partial<Logger>({
      warn: (message: string, fields?: unknown) => {
        warnings.push(message);
        details.push([message, fields]);
      },
    }),
    settled: () => {
      settles.push("settled");
    },
    signal: new AbortController().signal,
  });
  return {
    fire: (change) => listener?.(change),
    calls,
    warnings,
    details,
    settles,
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

const CHANGE = (keys: readonly string[]): SettingsChange => ({
  keys,
  scopes: ["user"],
  threadId: null,
});

test("the key shape picks the extension name out of ext.<name>.enabled only", () => {
  expect(extNameOfEnabledKey("ext.review.enabled")).toBe("review");
  expect(extNameOfEnabledKey("ext.review.isolation")).toBeUndefined();
  expect(extNameOfEnabledKey("l0.process.service.enabled")).toBeUndefined();
});

test("turning an auto-disabled extension on tells the loader and clears the auto-off mark like re-enable", async () => {
  const r = rig({ values: { "ext.review.enabled": true }, disabled: ["ext:review"] });
  r.fire(CHANGE(["ext.review.enabled"]));
  await r.settle();
  expect(r.calls).toEqual(["settingChanged:review", "reenable:ext:review"]);
});

test("a pending keep-off question also gets the re-enable", async () => {
  const r = rig({ values: { "ext.review.enabled": true }, asked: ["ext:review"] });
  r.fire(CHANGE(["ext.review.enabled"]));
  await r.settle();
  expect(r.calls).toEqual(["settingChanged:review", "reenable:ext:review"]);
});

test("a plain turn-on of an extension that was not auto-disabled only tells the loader", async () => {
  const r = rig({ values: { "ext.web.enabled": true }, disabled: ["ext:review"] });
  r.fire(CHANGE(["ext.web.enabled"]));
  await r.settle();
  expect(r.calls).toEqual(["settingChanged:web"]);
});

test("a change to false tells the loader so the stop applies at the next step boundary, without a re-enable", async () => {
  const r = rig({
    values: { "ext.review.enabled": false, "ext.web.isolation": "process" },
    disabled: ["ext:review"],
  });
  r.fire(CHANGE(["ext.review.enabled", "ext.web.isolation"]));
  r.fire(CHANGE([]));
  await r.settle();
  expect(r.calls).toEqual(["settingChanged:review"]);
});

test("a builtin group follows its enabled key into the registration enable and disable", () => {
  const calls: string[] = [];
  let listener: ((change: SettingsChange) => void) | undefined;
  const values: Record<string, unknown> = { "ext.authoring.enabled": true };
  followBuiltinEnabled({
    onChange: (next) => {
      listener = next;
      return () => {};
    },
    value: (key) => values[key],
    host: partial<Pick<ExtHost, "registrations" | "registration">>({
      registrations: () => [
        partial<ReturnType<ExtHost["registrations"]>[number]>({
          id: "authoring",
          extension: "authoring",
        }),
        partial<ReturnType<ExtHost["registrations"]>[number]>({ id: "other", extension: "other" }),
      ],
      registration: (id) =>
        partial<NonNullable<ReturnType<ExtHost["registration"]>>>({
          enable: () => {
            calls.push(`enable:${id}`);
          },
          disable: () => {
            calls.push(`disable:${id}`);
          },
        }),
    }),
    names: () => ["authoring"],
    onEnabled: (name) => {
      calls.push(`ledger:${name}`);
    },
  });
  listener?.(CHANGE(["ext.authoring.enabled"]));
  values["ext.authoring.enabled"] = false;
  listener?.(CHANGE(["ext.authoring.enabled"]));
  listener?.(CHANGE(["ext.core-loop.enabled"]));
  expect(calls).toEqual(["enable:authoring", "ledger:authoring", "disable:authoring"]);
});

test("with no external loader the re-enable still runs, and a loader failure is logged without the re-enable", async () => {
  const none = rig({
    values: { "ext.review.enabled": true },
    disabled: ["ext:review"],
    loader: "none",
  });
  none.fire(CHANGE(["ext.review.enabled"]));
  await none.settle();
  expect(none.calls).toEqual(["reenable:ext:review"]);

  const failing = rig({
    values: { "ext.review.enabled": true },
    disabled: ["ext:review"],
    loader: "reject",
  });
  failing.fire(CHANGE(["ext.review.enabled"]));
  await failing.settle();
  expect(failing.calls).toEqual(["settingChanged:review"]);
  expect(failing.warnings).toEqual(["ext.enable_follow_failed"]);
});

test("an enable the loader does not bring up is logged with its state and reason, and the list is settled", async () => {
  const r = rig({ values: { "ext.review.enabled": true }, loader: "not-active" });
  r.fire(CHANGE(["ext.review.enabled"]));
  await r.settle();
  expect(r.details).toEqual([
    ["ext.enable_not_active", { extension: "review", state: "disabled", code: "config_required" }],
  ]);
  expect(r.settles).toEqual(["settled"]);
});

test("a loader that throws still settles the list, and a turn-on that is active is not logged", async () => {
  const failing = rig({ values: { "ext.review.enabled": true }, loader: "reject" });
  failing.fire(CHANGE(["ext.review.enabled"]));
  await failing.settle();
  expect(failing.settles).toEqual(["settled"]);

  const active = rig({ values: { "ext.web.enabled": true } });
  active.fire(CHANGE(["ext.web.enabled"]));
  await active.settle();
  expect(active.details).toEqual([]);
  expect(active.settles).toEqual(["settled"]);
});
