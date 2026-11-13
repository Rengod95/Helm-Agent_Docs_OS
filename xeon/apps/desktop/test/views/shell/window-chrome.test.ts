import { describe, expect, test } from "bun:test";
import {
  applyWindowChrome,
  installWindowChrome,
  zoomPercentOfRoot,
  WINDOW_CHROME_EVENT,
  windowChromeStateOf,
  type WindowChromeRoot,
  type WindowChromeState,
} from "../../../src/views/shell/window-chrome.ts";

// 창 틀 상태(DP-80): 셸 답 읽기, `<html>` 속성 걸기, 이벤트를 받으면 다시 읽기. 값은 `toEqual`로 비교한다.

interface FakeRoot extends WindowChromeRoot {
  readonly props: Map<string, string>;
}

function rootOf(): FakeRoot {
  const props = new Map<string, string>();
  return {
    dataset: {},
    props,
    style: {
      setProperty: (name, value) => {
        props.set(name, value);
      },
      removeProperty: (name) => props.delete(name),
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("window chrome state", () => {
  test("reads the shell answer and rejects wrong shapes", () => {
    expect(windowChromeStateOf({ kind: "mac", fullscreen: false, insetStart: 92 })).toEqual({
      kind: "mac",
      fullscreen: false,
      insetStart: 92,
    });
    expect(windowChromeStateOf({ kind: "overlay", fullscreen: true })).toEqual({
      kind: "overlay",
      fullscreen: true,
      insetStart: 0,
    });
    expect(windowChromeStateOf({ kind: "mac", fullscreen: false, insetStart: 999 })).toEqual({
      kind: "mac",
      fullscreen: false,
      insetStart: 0,
    });
    const none: WindowChromeState = { kind: "none", fullscreen: false, insetStart: 0 };
    expect(windowChromeStateOf({ kind: "none", fullscreen: false })).toEqual(none);
    expect(windowChromeStateOf({ kind: "mac" })).toEqual(none);
    expect(windowChromeStateOf("mac")).toEqual(none);
    expect(windowChromeStateOf(null)).toEqual(none);
  });

  test("applying sets and clears the root attributes", () => {
    const root = rootOf();
    applyWindowChrome(root, { kind: "mac", fullscreen: false, insetStart: 92 });
    expect(root.dataset).toEqual({ windowChrome: "mac" });
    expect([...root.props]).toEqual([["--chrome-inset-start", "92px"]]);
    applyWindowChrome(root, { kind: "mac", fullscreen: true, insetStart: 0 });
    expect(root.dataset).toEqual({ windowChrome: "mac", fullscreen: "" });
    expect([...root.props]).toEqual([]);
    applyWindowChrome(root, { kind: "none", fullscreen: true, insetStart: 0 });
    expect(root.dataset).toEqual({});
  });
});

describe("install", () => {
  test("applies now and again on the chrome event", async () => {
    const root = rootOf();
    const answers = [
      { kind: "mac", fullscreen: false, insetStart: 84 },
      { kind: "mac", fullscreen: true, insetStart: 0 },
    ];
    const asked: string[] = [];
    const listeners = new Map<string, () => void>();
    installWindowChrome({
      invoke: (command, args) => {
        asked.push(`${command} ${String(args.zoom)}`);
        return Promise.resolve(answers.shift());
      },
      listen: (event, onEvent) => {
        listeners.set(event, onEvent);
        return Promise.resolve(() => undefined);
      },
      root,
    });
    await flush();
    expect(root.dataset).toEqual({ windowChrome: "mac" });
    expect([...root.props]).toEqual([["--chrome-inset-start", "84px"]]);
    expect([...listeners.keys()]).toEqual([WINDOW_CHROME_EVENT]);
    listeners.get(WINDOW_CHROME_EVENT)?.();
    await flush();
    expect(root.dataset).toEqual({ windowChrome: "mac", fullscreen: "" });
    expect(asked).toEqual(["window_chrome_state 100", "window_chrome_state 100"]);
  });

  test("sends the app zoom and asks again when it changes (DP-172)", async () => {
    const root = rootOf();
    root.dataset["zoom"] = "125";
    const asked: number[] = [];
    const watchers: (() => void)[] = [];
    const zoomChanged = (): void => {
      for (const watcher of watchers) watcher();
    };
    installWindowChrome({
      invoke: (_command, args) => {
        asked.push(args.zoom);
        return Promise.resolve({ kind: "mac", fullscreen: false, insetStart: 92 });
      },
      listen: () => Promise.resolve(() => undefined),
      root,
      watchZoom: (onChange) => {
        watchers.push(onChange);
      },
    });
    await flush();
    root.dataset["zoom"] = "150";
    zoomChanged();
    // 같은 값이면 다시 묻지 않는다
    zoomChanged();
    await flush();
    delete root.dataset["zoom"];
    zoomChanged();
    await flush();
    expect(asked).toEqual([125, 150, 100]);
    expect(zoomPercentOfRoot({ dataset: { zoom: "abc" } })).toBe(100);
  });

  test("an older shell that does not know the command leaves the root alone", async () => {
    const root = rootOf();
    installWindowChrome({
      invoke: () => Promise.reject(new Error("unknown-command")),
      listen: () => Promise.resolve(() => undefined),
      root,
    });
    await flush();
    expect(root.dataset).toEqual({});
    expect([...root.props]).toEqual([]);
  });
});
