import { describe, expect, test } from "bun:test";
import {
  pickAttachmentFile,
  pickWorkspaceFolder,
  type FolderPickInvoke,
} from "../../src/views/folder-pick.ts";

/** 명령의 답을 흉내 낸다. 부른 명령 이름을 기록해 `pick_folder` 하나만 불렸는지 본다 */
function replying(reply: () => Promise<unknown>): {
  readonly invoke: FolderPickInvoke;
  readonly calls: readonly string[];
} {
  const calls: string[] = [];
  const invoke: FolderPickInvoke = (command) => {
    calls.push(command);
    return reply();
  };
  return { invoke, calls };
}

/** 셸은 오류 코드 문자열로 거절한다. 이유는 `unknown`으로 받아 그 값을 그대로 던진다 */
function rejectingWith(reason: unknown): ReturnType<typeof replying> {
  return replying(async () => {
    throw reason;
  });
}

describe("pickWorkspaceFolder", () => {
  test("returns the chosen absolute path after one pick_folder call", async () => {
    const fake = replying(async () => "/Users/me/project");
    expect(await pickWorkspaceFolder(fake.invoke)).toEqual({
      ok: true,
      value: "/Users/me/project",
    });
    expect(fake.calls).toEqual(["pick_folder"]);
  });

  test("a cancelled dialog replies null and gives no path", async () => {
    expect(await pickWorkspaceFolder(replying(async () => null).invoke)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test("a reply that is not a non-empty string gives no path", async () => {
    const replies: readonly unknown[] = ["", 42, { path: "/Users/me/project" }, ["/a"]];
    const results = await Promise.all(
      replies.map((reply) => pickWorkspaceFolder(replying(async () => reply).invoke)),
    );
    expect(results).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: undefined },
      { ok: true, value: undefined },
      { ok: true, value: undefined },
    ]);
  });

  test("a rejected invoke is an error value that keeps the reason", async () => {
    expect(await pickWorkspaceFolder(rejectingWith("dialog_unavailable").invoke)).toEqual({
      ok: false,
      error: { kind: "threw", cause: "dialog_unavailable" },
    });
  });
});

describe("pickAttachmentFile", () => {
  test("calls only pick_file and returns the chosen path", async () => {
    const fake = replying(async () => "/Users/me/a.png");
    expect(await pickAttachmentFile(fake.invoke)).toEqual({ ok: true, value: "/Users/me/a.png" });
    expect(fake.calls).toEqual(["pick_file"]);
  });

  test("a cancelled or empty answer is undefined and a rejection is an error", async () => {
    expect(await pickAttachmentFile(replying(async () => null).invoke)).toEqual({
      ok: true,
      value: undefined,
    });
    expect((await pickAttachmentFile(rejectingWith("dialog_unavailable").invoke)).ok).toBe(false);
  });
});
