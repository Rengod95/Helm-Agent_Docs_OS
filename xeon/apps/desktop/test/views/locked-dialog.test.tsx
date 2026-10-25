import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createUiStore } from "../../src/state/ui/store.ts";
import { LockedDialogView, ownerText } from "../../src/views/locked-dialog.tsx";
import { thr } from "../state/helpers.ts";

const noop = (): void => {};

describe("LockedDialogView", () => {
  test("offers observe and fork for the options the host gave, never delegate", () => {
    const out = renderToString(
      <LockedDialogView
        locked={{ threadId: thr(1), ownerKind: "cli", options: ["observe", "fork"] }}
        busy={false}
        failed={false}
        onObserve={noop}
        onFork={noop}
        onClose={noop}
      />,
    );
    expect(out).toContain("터미널(xeon CLI)");
    expect(out).toContain("관찰만 하기");
    expect(out).toContain("분기해서 이어 쓰기");
    expect(out).not.toContain("위임");
  });

  test("omits a choice the host did not offer and names an unknown owner generically", () => {
    const out = renderToString(
      <LockedDialogView
        locked={{ threadId: thr(1), ownerKind: "weird", options: [] }}
        busy={false}
        failed={true}
        onObserve={noop}
        onFork={noop}
        onClose={noop}
      />,
    );
    expect(out).not.toContain("관찰만 하기");
    expect(out).not.toContain("분기해서");
    expect(out).toContain("다른 프로세스");
    expect(out).toContain("실행하지 못했습니다");
    expect(ownerText("desktop")).toBe("다른 데스크톱 창");
  });
});

describe("ui store locked and observing", () => {
  test("showLocked then dismiss; observing flags are per thread", () => {
    const ui = createUiStore();
    ui.actions.showLocked({ threadId: thr(1), ownerKind: "cli", options: ["fork"] });
    expect(ui.read.getState().locked).toEqual({
      threadId: thr(1),
      ownerKind: "cli",
      options: ["fork"],
    });
    ui.actions.dismissLocked();
    expect(ui.read.getState().locked).toBeNull();
    ui.actions.setObserving(thr(1), true);
    ui.actions.setObserving(thr(2), true);
    ui.actions.setObserving(thr(1), false);
    expect(ui.read.getState().observing).toEqual({ [thr(2)]: true });
  });
});
