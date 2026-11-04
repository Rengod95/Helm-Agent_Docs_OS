import { describe, expect, test } from "bun:test";
import {
  carriesFiles,
  installFileDropGuard,
  type DropTarget,
} from "../../src/views/file-drop-guard.ts";

type DropLikeEvent = Parameters<Parameters<DropTarget["addEventListener"]>[1]>[0];
type Listener = (event: DropLikeEvent) => void;

function fakeTarget(): {
  readonly target: DropTarget;
  readonly listeners: Map<string, Listener>;
} {
  const listeners = new Map<string, Listener>();
  return {
    listeners,
    target: {
      addEventListener: (type, listener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type) => {
        listeners.delete(type);
      },
    },
  };
}

function fakeDrag(
  type: string,
  types: readonly string[],
  defaultPrevented = false,
): { readonly event: DropLikeEvent; readonly state: { prevented: boolean; dropEffect: string } } {
  const state = { prevented: defaultPrevented, dropEffect: "copy" };
  const event: DropLikeEvent = {
    type,
    get defaultPrevented() {
      return state.prevented;
    },
    preventDefault: () => {
      state.prevented = true;
    },
    dataTransfer: {
      types,
      get dropEffect() {
        return state.dropEffect;
      },
      set dropEffect(value: string) {
        state.dropEffect = value;
      },
    },
  };
  return { event, state };
}

describe("carriesFiles", () => {
  test("only a drag that carries Files counts", () => {
    expect(carriesFiles(["Files"])).toBe(true);
    expect(carriesFiles(["text/plain", "Files"])).toBe(true);
    expect(carriesFiles(["text/uri-list"])).toBe(false);
    expect(carriesFiles(undefined)).toBe(false);
  });
});

describe("installFileDropGuard", () => {
  test("blocks an unhandled file drop and shows no copy cursor on dragover", () => {
    const { target, listeners } = fakeTarget();
    installFileDropGuard(target);
    const over = fakeDrag("dragover", ["Files"]);
    listeners.get("dragover")?.(over.event);
    expect(over.state).toEqual({ prevented: true, dropEffect: "none" });
    const drop = fakeDrag("drop", ["Files"]);
    listeners.get("drop")?.(drop.event);
    expect(drop.state.prevented).toBe(true);
  });

  test("leaves a drag the composer already handled and link or text drags alone", () => {
    const { target, listeners } = fakeTarget();
    installFileDropGuard(target);
    const handled = fakeDrag("dragover", ["Files"], true);
    listeners.get("dragover")?.(handled.event);
    expect(handled.state.dropEffect).toBe("copy");
    const link = fakeDrag("drop", ["text/uri-list"]);
    listeners.get("drop")?.(link.event);
    expect(link.state.prevented).toBe(false);
  });

  test("dispose removes both listeners", () => {
    const { target, listeners } = fakeTarget();
    const dispose = installFileDropGuard(target);
    expect([...listeners.keys()].toSorted()).toEqual(["dragover", "drop"]);
    dispose();
    expect(listeners.size).toBe(0);
  });
});
