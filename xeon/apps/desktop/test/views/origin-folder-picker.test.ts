import { describe, expect, test } from "bun:test";
import {
  createOriginFolderPicker,
  folderPickWith,
  listingOf,
  type OriginFolderListing,
  type OriginFolderPicker,
} from "../../src/views/origin-folder-picker.ts";
import {
  readShellCapabilities,
  type ShellCapabilities,
} from "../../src/views/shell-capabilities.ts";

// 서버 폴더 고르기의 상태와 동작, 기능 감지를 값으로 비교한다. 가짜 invoke는 호출을 기록하고 답을 늦게 줄 수 있다.

interface Pending {
  readonly args: unknown;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

function fakeInvoke(): {
  readonly invoke: (command: string, args?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly calls: Array<readonly [string, unknown]>;
  readonly pending: Pending[];
} {
  const calls: Array<readonly [string, unknown]> = [];
  const pending: Pending[] = [];
  return {
    calls,
    pending,
    invoke: (command, args) => {
      calls.push([command, args]);
      return new Promise<unknown>((resolve, reject) => {
        pending.push({ args, resolve, reject });
      });
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const HOME_REPLY = {
  path: "/home/me",
  parent: "/home",
  home: "/home/me",
  entries: [
    { name: "alpha", path: "/home/me/alpha" },
    { name: "beta", path: "/home/me/beta" },
  ],
  truncated: false,
};

const HOME_LISTING: OriginFolderListing = { kind: "ready", ...HOME_REPLY };

async function opened(): Promise<{
  readonly picker: OriginFolderPicker;
  readonly fake: ReturnType<typeof fakeInvoke>;
  readonly result: Promise<string | undefined>;
}> {
  const fake = fakeInvoke();
  const picker = createOriginFolderPicker(fake.invoke);
  const result = picker.open();
  fake.pending[0]?.resolve(HOME_REPLY);
  await settle();
  return { picker, fake, result };
}

describe("서버 폴더 선택기", () => {
  test("열면 홈을 읽고 목록이 준비된다", async () => {
    const fake = fakeInvoke();
    const picker = createOriginFolderPicker(fake.invoke);
    void picker.open();
    expect(fake.calls).toEqual([["origin_folder_list", {}]]);
    expect(picker.getState()).toEqual({ open: true, listing: { kind: "loading", path: null } });
    fake.pending[0]?.resolve(HOME_REPLY);
    await settle();
    expect(picker.getState()).toEqual({ open: true, listing: HOME_LISTING });
  });

  test("폴더로 가면 그 경로를 보내고 홈은 빈 인자다", async () => {
    const { picker, fake } = await opened();
    picker.navigate("/home/me/alpha");
    picker.navigate(null);
    expect(fake.calls).toEqual([
      ["origin_folder_list", {}],
      ["origin_folder_list", { path: "/home/me/alpha" }],
      ["origin_folder_list", {}],
    ]);
  });

  test("고르면 지금 경로로 끝나고 닫힌다", async () => {
    const { picker, result } = await opened();
    picker.choose();
    expect(await result).toBe("/home/me");
    expect(picker.getState()).toEqual({ open: false });
  });

  test("읽는 중에는 고를 수 없다", async () => {
    const fake = fakeInvoke();
    const picker = createOriginFolderPicker(fake.invoke);
    void picker.open();
    picker.choose();
    expect(picker.getState()).toEqual({ open: true, listing: { kind: "loading", path: null } });
  });

  test("취소하면 undefined다", async () => {
    const { picker, result } = await opened();
    picker.cancel();
    expect(await result).toBeUndefined();
    expect(picker.getState()).toEqual({ open: false });
  });

  test("거절 사유가 종류별로 남고 다시 시도는 같은 경로를 보낸다", async () => {
    const { picker, fake } = await opened();
    picker.navigate("/x");
    fake.pending[1]?.reject("read_failed");
    await settle();
    expect(picker.getState()).toEqual({
      open: true,
      listing: { kind: "failed", reason: "read_failed", path: "/x" },
    });
    picker.retry();
    expect(fake.calls[2]).toEqual(["origin_folder_list", { path: "/x" }]);
    fake.pending[2]?.reject(new Error("bad-request"));
    await settle();
    expect(picker.getState()).toEqual({
      open: true,
      listing: { kind: "failed", reason: "bad-request", path: "/x" },
    });
    picker.retry();
    fake.pending[3]?.reject(42);
    await settle();
    expect(picker.getState()).toEqual({
      open: true,
      listing: { kind: "failed", reason: "other", path: "/x" },
    });
  });

  test("모양이 틀린 답은 other 실패다", async () => {
    const fake = fakeInvoke();
    const picker = createOriginFolderPicker(fake.invoke);
    void picker.open();
    fake.pending[0]?.resolve({ path: "/p", parent: null, home: "/p", truncated: false });
    await settle();
    expect(picker.getState()).toEqual({
      open: true,
      listing: { kind: "failed", reason: "other", path: null },
    });
  });

  test("더 새로운 이동이 있으면 늦은 답은 버린다", async () => {
    const { picker, fake } = await opened();
    picker.navigate("/a");
    picker.navigate("/b");
    fake.pending[2]?.resolve({ ...HOME_REPLY, path: "/b", entries: [] });
    await settle();
    fake.pending[1]?.resolve({ ...HOME_REPLY, path: "/a", entries: [] });
    await settle();
    expect(picker.getState()).toEqual({
      open: true,
      listing: { kind: "ready", ...HOME_REPLY, path: "/b", entries: [] },
    });
  });

  test("열려 있을 때 다시 열면 앞의 것은 취소로 끝난다", async () => {
    const { picker, result } = await opened();
    void picker.open();
    expect(await result).toBeUndefined();
    expect(picker.getState()).toEqual({ open: true, listing: { kind: "loading", path: null } });
  });

  test("구독은 상태가 바뀔 때마다 알리고 해제하면 멈춘다", async () => {
    const fake = fakeInvoke();
    const picker = createOriginFolderPicker(fake.invoke);
    let count = 0;
    const off = picker.subscribe(() => {
      count += 1;
    });
    void picker.open();
    expect(count).toBe(1);
    off();
    picker.cancel();
    expect(count).toBe(1);
  });

  test("listingOf는 맞는 답을 받고 틀린 칸마다 거절한다", () => {
    expect(listingOf(HOME_REPLY)).toEqual(HOME_LISTING);
    const bad: unknown[] = [
      null,
      { ...HOME_REPLY, path: 1 },
      { ...HOME_REPLY, home: null },
      { ...HOME_REPLY, truncated: "no" },
      { ...HOME_REPLY, parent: 5 },
      { ...HOME_REPLY, entries: "x" },
      { ...HOME_REPLY, entries: [{ name: "a" }] },
    ];
    for (const value of bad) expect(listingOf(value)).toBeNull();
    expect(listingOf({ ...HOME_REPLY, parent: null })).toEqual({ ...HOME_LISTING, parent: null });
  });
});

const stub = (chosen: string | undefined): OriginFolderPicker => ({
  getState: () => ({ open: false }),
  subscribe: () => () => {},
  open: () => Promise.resolve(chosen),
  navigate: () => {},
  choose: () => {},
  cancel: () => {},
  retry: () => {},
});

describe("폴더 고르기 연결", () => {
  test("웹이면 pick_folder가 대화 상자로 가고 취소는 null이다", async () => {
    const seen: string[] = [];
    const invoke = (command: string): Promise<unknown> => {
      seen.push(command);
      return Promise.resolve("os");
    };
    expect(
      await folderPickWith(invoke, stub("/srv/w"), () => Promise.resolve(true))("pick_folder"),
    ).toBe("/srv/w");
    expect(
      await folderPickWith(invoke, stub(undefined), () => Promise.resolve(true))("pick_folder"),
    ).toBeNull();
    expect(seen).toEqual([]);
  });

  test("데스크톱이거나 pick_file이면 셸로 넘긴다", async () => {
    const seen: string[] = [];
    const invoke = (command: string): Promise<unknown> => {
      seen.push(command);
      return Promise.resolve("os");
    };
    expect(
      await folderPickWith(invoke, stub("/x"), () => Promise.resolve(false))("pick_folder"),
    ).toBe("os");
    expect(await folderPickWith(invoke, stub("/x"), () => Promise.resolve(true))("pick_file")).toBe(
      "os",
    );
    expect(seen).toEqual(["pick_folder", "pick_file"]);
  });
});

describe("셸 기능 감지", () => {
  test("웹이면 폴더 고르기와 푸시를 읽는다", async () => {
    expect(
      await readShellCapabilities(() =>
        Promise.resolve({ kind: "web", folderPicker: "origin", fileDownload: true, push: true }),
      ),
    ).toEqual({ kind: "web", folderPicker: "origin", push: true });
    expect(
      await readShellCapabilities(() => Promise.resolve({ kind: "web", push: "yes" })),
    ).toEqual({
      kind: "web",
      folderPicker: "none",
      push: false,
    });
  });

  test("거절과 틀린 모양은 데스크톱이다", async () => {
    const desktop: ShellCapabilities = { kind: "desktop" };
    expect(await readShellCapabilities(() => Promise.reject(new Error("unknown-command")))).toEqual(
      desktop,
    );
    const replies = await Promise.all(
      [undefined, null, 3, { kind: "other" }].map((reply) =>
        readShellCapabilities(async () => reply),
      ),
    );
    expect(replies).toEqual([desktop, desktop, desktop, desktop]);
  });
});
