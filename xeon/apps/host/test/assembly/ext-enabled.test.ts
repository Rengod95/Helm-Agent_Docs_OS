import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type { ExtensionLoader, OperationsPolicy } from "@fresnel/ext-host";
import { extNameOfEnabledKey, followExtEnabled } from "../../src/assembly/ext-enabled.ts";
import type { SettingsChange } from "../../src/types.ts";
import { partial } from "../fixtures/unsafe.ts";

// 일반 켜기 스위치(`ext.<이름>.enabled`가 참이 되는 변경)가 로더의 settingChanged와 "다시 켜기"를 부른다.

type OwnerKey = ReturnType<OperationsPolicy["autoDisabler"]["disabled"]>[number];

interface Rig {
  readonly fire: (change: SettingsChange) => void;
  readonly calls: string[];
  readonly warnings: string[];
  readonly settle: () => Promise<void>;
}

function rig(options: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly disabled?: readonly OwnerKey[];
  readonly asked?: readonly OwnerKey[];
  readonly loader?: "none" | "reject";
}): Rig {
  const calls: string[] = [];
  const warnings: string[] = [];
  let listener: ((change: SettingsChange) => void) | undefined;
  const loader = partial<ExtensionLoader>({
    settingChanged: (name) => {
      calls.push(`settingChanged:${name}`);
      return options.loader === "reject"
        ? Promise.reject(new Error("load failed"))
        : Promise.resolve(undefined);
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
      warn: (message: string) => {
        warnings.push(message);
      },
    }),
    signal: new AbortController().signal,
  });
  return {
    fire: (change) => listener?.(change),
    calls,
    warnings,
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

test("a change to false, other keys, and an empty key list do nothing", async () => {
  const r = rig({
    values: { "ext.review.enabled": false, "ext.web.isolation": "process" },
    disabled: ["ext:review"],
  });
  r.fire(CHANGE(["ext.review.enabled", "ext.web.isolation"]));
  r.fire(CHANGE([]));
  await r.settle();
  expect(r.calls).toEqual([]);
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
