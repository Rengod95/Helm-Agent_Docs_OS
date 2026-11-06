import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  createTrayBridge,
  trayLabelsOf,
  type TrayInvoke,
  type TrayLabels,
  type TraySnapshot,
} from "../../src/views/tray-bridge.ts";

// 트레이 다리(B-10). 가짜 invoke는 부른 인자를 기록하고 답을 준다. 같은 글과 같은 개수는 다시 부르지 않는다.

type Call = { readonly labels: TrayLabels; readonly running: number };

function fakeInvoke(answer: () => Promise<unknown>): { invoke: TrayInvoke; calls: Call[] } {
  const calls: Call[] = [];
  const invoke: TrayInvoke = (_command, args) => {
    calls.push({ labels: args.labels, running: args.running });
    return answer();
  };
  return { invoke, calls };
}

const LABELS: TrayLabels = {
  open: "Fresnel 열기",
  newThread: "새 대화",
  running: "진행 중 {count}",
  quit: "끝내기",
};
const START: TraySnapshot = { labels: LABELS, running: 0 };

describe("tray bridge sends", () => {
  test("the first update sends the labels and the running count", async () => {
    const fake = fakeInvoke(() => Promise.resolve({ kind: "updated" }));
    const bridge = createTrayBridge(fake.invoke);
    expect(await bridge.update(START)).toBe("updated");
    expect(fake.calls).toEqual([{ labels: LABELS, running: 0 }]);
  });

  test("the same labels and count are not sent again", async () => {
    const fake = fakeInvoke(() => Promise.resolve({ kind: "updated" }));
    const bridge = createTrayBridge(fake.invoke);
    await bridge.update(START);
    expect(await bridge.update({ labels: { ...LABELS }, running: 0 })).toBe("skipped");
    expect(fake.calls).toHaveLength(1);
  });

  test("a changed running count is sent with the same labels", async () => {
    const fake = fakeInvoke(() => Promise.resolve({ kind: "updated" }));
    const bridge = createTrayBridge(fake.invoke);
    await bridge.update(START);
    await bridge.update({ labels: LABELS, running: 3 });
    expect(fake.calls).toEqual([
      { labels: LABELS, running: 0 },
      { labels: LABELS, running: 3 },
    ]);
  });

  test("changed labels, as after a language change, are sent", async () => {
    const fake = fakeInvoke(() => Promise.resolve({ kind: "updated" }));
    const bridge = createTrayBridge(fake.invoke);
    await bridge.update(START);
    const korean: TrayLabels = { ...LABELS, open: "열기", quit: "끝내기" };
    await bridge.update({ labels: korean, running: 0 });
    expect(fake.calls.at(-1)).toEqual({ labels: korean, running: 0 });
    expect(fake.calls).toHaveLength(2);
  });
});

describe("tray bridge replies", () => {
  test("an unavailable tray is a value, not an error", async () => {
    const fake = fakeInvoke(() => Promise.resolve({ kind: "unavailable" }));
    expect(await createTrayBridge(fake.invoke).update(START)).toBe("unavailable");
  });

  test("a failed menu call is a failure value, and so is a rejected call", async () => {
    const failed = fakeInvoke(() => Promise.resolve({ kind: "failed", reason: "set_text" }));
    expect(await createTrayBridge(failed.invoke).update(START)).toBe("failed");
    const rejected = fakeInvoke(() => Promise.reject(new Error("too long")));
    expect(await createTrayBridge(rejected.invoke).update(START)).toBe("failed");
  });
});

describe("tray labels", () => {
  test("the labels are the catalog sentences, and the running line keeps its count marker", () => {
    const labels = trayLabelsOf();
    expect(labels).toEqual({
      open: t("desktop.tray.open"),
      newThread: t("desktop.tray.newThread"),
      running: t("desktop.tray.running"),
      quit: t("desktop.tray.quit"),
    });
    expect(labels.running).toContain("{count}");
    expect(labels.running.replaceAll("{count}", "")).not.toContain("{");
  });
});
