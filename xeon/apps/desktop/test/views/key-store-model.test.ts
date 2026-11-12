import { describe, expect, test } from "bun:test";
import type { SecretKeyStatusResult } from "@fresnel/contracts/wire";
import {
  INITIAL_KEY_STORE,
  keyStoreDoneOf,
  keyStoreReducer,
  keyStoreSelectedOf,
  keyStoreViewOf,
  type KeyStoreMove,
  type KeyStoreRead,
} from "../../src/views/pages/secrets/key-store-model.ts";

// 열쇠 보관 줄의 판정(L0.secrets.spec §4.7 (b)·(c)). 경로는 가짜다. 값과 식별자는 이 모델에 없다.

const PATH = "/fake/fresnel/secrets/age/keys.txt";

function statusOf(overrides: Partial<SecretKeyStatusResult>): SecretKeyStatusResult {
  return {
    source: "auto",
    in: "none",
    filePath: PATH,
    keychainUsable: true,
    fallbackUnconfirmed: false,
    fileMissing: false,
    ...overrides,
  };
}

const READY = (status: SecretKeyStatusResult): KeyStoreRead => ({ kind: "ready", status });
const IDLE: KeyStoreMove = { kind: "idle" };

describe("which way the line shows as chosen", () => {
  test("an explicit choice is the choice, whatever the key is", () => {
    expect(keyStoreSelectedOf(statusOf({ source: "file", in: "keychain" }))).toBe("file");
    expect(keyStoreSelectedOf(statusOf({ source: "keychain", in: "file" }))).toBe("keychain");
  });

  test("automatic follows where the key is, and with no key the usable store", () => {
    expect(keyStoreSelectedOf(statusOf({ source: "auto", in: "keychain" }))).toBe("keychain");
    expect(keyStoreSelectedOf(statusOf({ source: "auto-file", in: "file" }))).toBe("file");
    expect(keyStoreSelectedOf(statusOf({ in: "none", keychainUsable: true }))).toBe("keychain");
    expect(keyStoreSelectedOf(statusOf({ in: "none", keychainUsable: false }))).toBe("file");
  });
});

describe("the line's view", () => {
  test("a ready read shows where the key is and no note when nothing is wrong", () => {
    const view = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: IDLE,
      remote: false,
      live: true,
    });
    expect(view.status).toEqual({
      id: "desktop.secrets.keyStore.inFile",
      args: { path: PATH },
    });
    expect(view.notes).toEqual([]);
    expect(view.disabled).toBe(false);
    expect(view.readOnly).toBe(false);
  });

  test("with no key yet, the line says the first key will be made this way", () => {
    const view = keyStoreViewOf({
      read: READY(statusOf({ in: "none" })),
      move: IDLE,
      remote: false,
      live: true,
    });
    expect(view.status?.id).toBe("desktop.secrets.keyStore.none");
  });

  test("a key file the setting points to but that is missing is a danger note with its path", () => {
    const view = keyStoreViewOf({
      read: READY(statusOf({ in: "none", fileMissing: true })),
      move: IDLE,
      remote: false,
      live: true,
    });
    expect(view.notes).toEqual([
      {
        tone: "danger",
        text: { id: "desktop.secrets.keyStore.fileMissing", args: { path: PATH } },
        fix: null,
      },
    ]);
  });

  test("a remote connection is read-only, disabled and says it can only change here", () => {
    const view = keyStoreViewOf({
      read: READY(statusOf({ in: "keychain" })),
      move: IDLE,
      remote: true,
      live: true,
    });
    expect(view.readOnly).toBe(true);
    expect(view.disabled).toBe(true);
    expect(view.notes).toEqual([
      { tone: "warning", text: { id: "desktop.secrets.keyStore.readOnly", args: {} }, fix: null },
    ]);
  });

  test("an offline or unread line is disabled; an unread status shows the reason", () => {
    const offline = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: IDLE,
      remote: false,
      live: false,
    });
    expect(offline.disabled).toBe(true);
    const failed = keyStoreViewOf({
      read: { kind: "failed", error: { kind: "unsupported" } },
      move: IDLE,
      remote: false,
      live: true,
    });
    expect(failed.disabled).toBe(true);
    expect(failed.selected).toBeNull();
    expect(failed.status?.id).toBe("desktop.secrets.unsupported");
  });

  test("while a move runs the line is disabled, says so, and shows the target as chosen", () => {
    const view = keyStoreViewOf({
      read: READY(statusOf({ in: "keychain" })),
      move: { kind: "moving", to: "file" },
      remote: false,
      live: true,
    });
    expect(view.disabled).toBe(true);
    expect(view.status?.id).toBe("desktop.secrets.keyStore.moving");
    expect(view.selected).toBe("file");
  });

  test("a move that left the key in the old place warns; one that ran clean does not", () => {
    const left = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: {
        kind: "done",
        result: { moved: true, created: true, oldRemoved: false, source: "file" },
      },
      remote: false,
      live: true,
    });
    expect(left.notes.map((note) => note.text.id)).toEqual(["desktop.secrets.keyStore.oldKept"]);
    const clean = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: {
        kind: "done",
        result: { moved: true, created: true, oldRemoved: true, source: "file" },
      },
      remote: false,
      live: true,
    });
    expect(clean.notes).toEqual([]);
  });

  test("a failed move shows the cause and a fix line where one is known", () => {
    const write = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: { kind: "failed", error: { kind: "writeFailed" } },
      remote: false,
      live: true,
    });
    expect(write.notes).toEqual([
      {
        tone: "danger",
        text: { id: "desktop.secrets.error.writeFailed", args: {} },
        fix: { id: "desktop.secrets.keyStore.fix.writeFailed", args: {} },
      },
    ]);
    const keychain = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: { kind: "failed", error: { kind: "keyUnavailable" } },
      remote: false,
      live: true,
    });
    expect(keychain.notes[0]?.fix).toBeNull();
  });

  test("a move the host refuses as local-only makes the line read-only", () => {
    const view = keyStoreViewOf({
      read: READY(statusOf({ in: "file" })),
      move: { kind: "failed", error: { kind: "localOnly" } },
      remote: false,
      live: true,
    });
    expect(view.readOnly).toBe(true);
    expect(view.disabled).toBe(true);
    expect(view.notes.map((note) => note.text.id)).toEqual(["desktop.secrets.keyStore.readOnly"]);
  });
});

describe("the success sentence and the reducer", () => {
  test("a move that moved the key says so; one that only set the setting says the next key goes there", () => {
    expect(
      keyStoreDoneOf({ moved: true, created: true, oldRemoved: true, source: "keychain" }).id,
    ).toBe("desktop.secrets.keyStore.moved");
    expect(
      keyStoreDoneOf({ moved: false, created: false, oldRemoved: false, source: "file" }).id,
    ).toBe("desktop.secrets.keyStore.setOnly");
  });

  test("the reducer keeps the read and the move apart", () => {
    const read = keyStoreReducer(INITIAL_KEY_STORE, {
      type: "read",
      read: READY(statusOf({ in: "file" })),
    });
    expect(read.read.kind).toBe("ready");
    expect(read.move).toEqual({ kind: "idle" });
    const moving = keyStoreReducer(read, {
      type: "move",
      move: { kind: "moving", to: "keychain" },
    });
    expect(moving.read).toBe(read.read);
    expect(moving.move).toEqual({ kind: "moving", to: "keychain" });
  });
});
