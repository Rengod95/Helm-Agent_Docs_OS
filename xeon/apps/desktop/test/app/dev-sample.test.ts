import { describe, expect, test } from "bun:test";
import {
  isSampleToggle,
  SAMPLE_STATE_KEY,
  sampleStateOn,
  sampleView,
  withSampleMirror,
} from "../../src/app/dev-sample.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import {
  selectApprovalUrgent,
  selectThreadApprovals,
  selectUnlistedApprovals,
} from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { STORE, summary, thr } from "../state/helpers.ts";

// 개발 빌드의 표본 보기(lcMk2): 거울에 표본 대화 둘(하나는 시한 있는 승인)을 겹친다. 실제 거울 값은 바꾸지 않는다

const NOW = Date.parse("2026-11-18T09:00:00.000Z");

function realMirror(): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "subscribed", sub: "s1", storeId: STORE, start: 5, live: true, from: "head" },
    { type: "threads", threads: [summary(thr(1), { workspace: "/w/helm", title: "real" })] },
  ];
  return inputs.reduce((state, input) => reduceMirror(state, input).state, INITIAL_MIRROR);
}

describe("withSampleMirror", () => {
  test("adds two waiting threads in front, one with a deadline, in the first real folder", () => {
    const real = realMirror();
    const shown = withSampleMirror(real, NOW);
    const ids = shown.threads.ids;
    expect([ids.length, ids[2]]).toEqual([3, thr(1)]);
    const a = ids[0] ?? thr(9);
    const b = ids[1] ?? thr(9);
    expect([
      selectThreadApprovals(shown, a),
      selectThreadApprovals(shown, b),
      selectUnlistedApprovals(shown, a),
      selectUnlistedApprovals(shown, b),
      selectApprovalUrgent(shown, a),
      selectApprovalUrgent(shown, b),
      shown.threads.byId[a]?.workspace,
      shown.threads.byId[b]?.workspace,
    ]).toEqual([1, 2, 0, 0, false, true, "/w/helm", "/w/helm"]);
    expect(shown.approvals.ids.map((id) => shown.approvals.byId[id]?.request.expiresAt)).toEqual([
      undefined,
      NOW + 30 * 60_000,
      NOW + 30 * 60_000,
    ]);
  });

  test("leaves the real mirror untouched and does not add twice", () => {
    const real = realMirror();
    const shown = withSampleMirror(real, NOW);
    expect([real.threads.ids, real.approvals.ids]).toEqual([[thr(1)], []]);
    expect(withSampleMirror(shown, NOW)).toBe(shown);
  });

  test("an empty mirror still lists the sample threads (no folder)", () => {
    const shown = withSampleMirror(INITIAL_MIRROR, NOW);
    expect([
      shown.threads.status,
      shown.threads.ids.length,
      shown.threads.ids.map((id) => shown.threads.byId[id]?.workspace),
    ]).toEqual(["ready", 2, [null, null]]);
  });
});

describe("sampleView", () => {
  test("returns the same object for the same mirror and follows real changes", () => {
    const api = manualStore(realMirror());
    const view = sampleView(api.read, () => NOW);
    const first = view.getState();
    expect(view.getState()).toBe(first);
    const seen: number[] = [];
    const stop = view.subscribe((state) => {
      seen.push(state.threads.ids.length);
    });
    api.set(
      reduceMirror(api.read.getState(), {
        type: "threads",
        threads: [summary(thr(1)), summary(thr(2))],
      }).state,
    );
    stop();
    expect([seen, view.getState().threads.ids.length]).toEqual([[4], 4]);
  });
});

describe("toggle", () => {
  test("is off outside a dev build even when stored as on", () => {
    const storage = localStorageLike();
    storage.setItem(SAMPLE_STATE_KEY, "1");
    expect([storage.getItem(SAMPLE_STATE_KEY), sampleStateOn(() => storage)]).toEqual(["1", false]);
  });

  test("shortcut is ⌘⌥⇧S on macOS and Ctrl+Alt+Shift+S elsewhere", () => {
    expect([
      isSampleToggle(key({ metaKey: true }), true),
      isSampleToggle(key({ ctrlKey: true }), true),
      isSampleToggle(key({ ctrlKey: true }), false),
      isSampleToggle(key({ metaKey: true, shiftKey: false }), true),
      isSampleToggle({ ...key({ metaKey: true }), code: "KeyD" }, true),
    ]).toEqual([true, false, true, false, false]);
  });
});

function localStorageLike(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

type Mods = Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>;
function key(
  over: Mods,
): Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> {
  return { code: "KeyS", metaKey: false, ctrlKey: false, altKey: true, shiftKey: true, ...over };
}

/** 거울 읽기 면 하나(시험용). `set`이 구독자에게 새 값과 옛 값을 넘긴다 */
function manualStore(initial: EngineMirror): {
  readonly read: ReadonlyStore<EngineMirror>;
  readonly set: (next: EngineMirror) => void;
} {
  let state = initial;
  const listeners = new Set<(state: EngineMirror, previous: EngineMirror) => void>();
  return {
    read: {
      getState: () => state,
      getInitialState: () => initial,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set: (next) => {
      const previous = state;
      state = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}
