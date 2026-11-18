import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parse, type Result } from "@fresnel/contracts";
import {
  WorkspaceFilesCapturedPayloadSchema,
  WorkspaceRewindStartedPayloadSchema,
  type DurableEventEnvelope,
  type WorkspaceFilesCapturedPayload,
} from "@fresnel/contracts/records";
import { FILE_SNAPSHOT_MAX_BYTES } from "../src/rewind/limits.ts";
import { openRewind, type Rewind } from "./support/rewind-harness.ts";

// 파일 되감기의 완료 기준(작업 브리프 3절 ①~⑫). 실제 SQLite와 실제 임시 폴더로 확인한다.
// 값 비교만 쓴다. 실패는 `Result`의 kind로 확인하고 본문에 `as`를 쓰지 않는다.

function must<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.error)}`);
  return result.value;
}

function failureOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

function sha(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function read(rw: Rewind, path: string): string {
  return readFileSync(join(rw.folder, path), "utf8");
}

function captures(events: readonly DurableEventEnvelope[]): WorkspaceFilesCapturedPayload[] {
  return events
    .filter((event) => event.kind === "workspace.files_captured")
    .map((event) => must(parse(WorkspaceFilesCapturedPayloadSchema, event.payload)));
}

/** 기록의 모양만 본다(경로, 처음 여부, 옛 상태 종류, 쓴 내용 해시). 파일 내용은 들어 있지 않다 */
function summaryOf(events: readonly DurableEventEnvelope[]) {
  return captures(events).flatMap((payload) =>
    payload.entries.map((entry) => ({
      path: entry.path,
      first: entry.first,
      before: entry.before === null ? null : entry.before.state,
      afterSha256: entry.afterSha256,
    })),
  );
}

describe("file rewind on a real file system", () => {
  test("edited and new files go back to their original state, and a new file is removed (①)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "one\ntwo\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "changed\n");
    await rw.write(threadId, turn, "fresh/new.txt", "made\n");

    const preview = must(await rw.service.preview({ threadId, to: item }));
    expect(preview.files.map((file) => [file.path, file.action, file.reason])).toEqual([
      [join(rw.folder, "a.txt"), "restore", null],
      [join(rw.folder, "fresh/new.txt"), "delete", null],
    ]);

    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_aaaaaaaa",
        oldLeafEventId: null,
      }),
    );
    expect(applied.files.map((file) => [file.path, file.outcome])).toEqual([
      [join(rw.folder, "a.txt"), "restored"],
      [join(rw.folder, "fresh/new.txt"), "deleted"],
    ]);
    expect(read(rw, "a.txt")).toBe("one\ntwo\n");
    expect(existsSync(join(rw.folder, "fresh/new.txt"))).toBe(false);
  });

  test("an edit is undone, and a binary file comes back byte for byte (①)", async () => {
    await using rw = await openRewind();
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3]);
    writeFileSync(join(rw.folder, "blob.bin"), binary);
    writeFileSync(join(rw.folder, "text.txt"), "alpha\nbeta\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "blob.bin", "now text\n");
    const edited = await rw.edit(threadId, turn, "text.txt", "beta", "BETA");
    expect(edited.applied).toBe(1);

    must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "files",
        overwrite: [],
        rewindId: "rwd_bbbbbbbb",
        oldLeafEventId: null,
      }),
    );
    expect(new Uint8Array(readFileSync(join(rw.folder, "blob.bin")))).toEqual(binary);
    expect(read(rw, "text.txt")).toBe("alpha\nbeta\n");
  });

  test("a file deleted from outside is reported and not recreated (①, ②)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "gone.txt"), "original\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "gone.txt", "agent\n");
    rmSync(join(rw.folder, "gone.txt"));

    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_cccccccc",
        oldLeafEventId: null,
      }),
    );
    expect(applied.files).toEqual([
      { path: join(rw.folder, "gone.txt"), outcome: "kept_changed", reason: "deleted_outside" },
    ]);
    expect(applied.kept).toEqual([
      { path: join(rw.folder, "gone.txt"), reason: "deleted_outside" },
    ]);
    expect(existsSync(join(rw.folder, "gone.txt"))).toBe(false);
  });

  test("a file changed outside is kept, and overwrite restores the chosen path (②)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "original\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "agent\n");
    writeFileSync(join(rw.folder, "a.txt"), "typed by hand\n");

    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_dddddddd",
        oldLeafEventId: null,
      }),
    );
    expect(applied.kept).toEqual([{ path: join(rw.folder, "a.txt"), reason: "changed_outside" }]);
    expect(read(rw, "a.txt")).toBe("typed by hand\n");

    const overwritten = must(
      await rw.service.overwrite({
        threadId,
        rewindId: "rwd_dddddddd",
        paths: [join(rw.folder, "a.txt")],
      }),
    );
    expect(overwritten.files).toEqual([
      { path: join(rw.folder, "a.txt"), outcome: "restored", reason: null },
    ]);
    expect(overwritten.kept).toEqual([]);
    expect(read(rw, "a.txt")).toBe("original\n");
  });

  test("a file another conversation changed in the same folder is not overwritten (③)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "shared.txt"), "original\n");
    const first = rw.newThread();
    const second = rw.newThread();
    const firstTurn = rw.newTurn();
    const secondTurn = rw.newTurn();
    const item = rw.seedUserItem(first, firstTurn);
    await rw.write(first, firstTurn, "shared.txt", "from first\n");
    await rw.write(second, secondTurn, "shared.txt", "from second\n");

    const preview = must(await rw.service.preview({ threadId: first, to: item }));
    expect(preview.files).toEqual([
      {
        path: join(rw.folder, "shared.txt"),
        action: "keep",
        reason: "changed_outside",
        turnId: firstTurn,
      },
    ]);
    must(
      await rw.service.apply({
        threadId: first,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_eeeeeeee",
        oldLeafEventId: null,
      }),
    );
    expect(read(rw, "shared.txt")).toBe("from second\n");
  });

  test("a new file changed after the agent wrote it is kept, and an untouched one is removed (④)", async () => {
    await using rw = await openRewind();
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "kept.txt", "agent\n");
    await rw.write(threadId, turn, "removed.txt", "agent\n");
    writeFileSync(join(rw.folder, "kept.txt"), "user edit\n");

    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_ffffffff",
        oldLeafEventId: null,
      }),
    );
    expect(applied.files).toEqual([
      { path: join(rw.folder, "kept.txt"), outcome: "kept_changed", reason: "changed_outside" },
      { path: join(rw.folder, "removed.txt"), outcome: "deleted", reason: null },
    ]);
    expect(read(rw, "kept.txt")).toBe("user edit\n");
    expect(existsSync(join(rw.folder, "removed.txt"))).toBe(false);
  });

  test("the user's .git folder is never touched (⑤)", async () => {
    await using rw = await openRewind();
    mkdirSync(join(rw.folder, ".git"));
    writeFileSync(join(rw.folder, ".git", "config"), "[core]\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, ".git/config", "agent wrote here\n");
    await rw.write(threadId, turn, "a.txt", "agent\n");

    // 기록에는 .git 경로가 없다. 되감기 미리보기에도 나오지 않는다
    const recorded = captures(await rw.events(threadId, "workspace.")).flatMap((payload) =>
      payload.entries.map((entry) => entry.path),
    );
    expect(recorded).toEqual([join(rw.folder, "a.txt")]);
    const preview = must(await rw.service.preview({ threadId, to: item }));
    expect(preview.files.map((file) => file.path)).toEqual([join(rw.folder, "a.txt")]);

    must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_gitgitgi",
        oldLeafEventId: null,
      }),
    );
    expect(read(rw, ".git/config")).toBe("agent wrote here\n");
  });

  test("preview lists targets, skip reasons and untracked shell effects (⑥)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "b.txt"), "b0\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "a1\n");
    await rw.write(threadId, turn, "b.txt", "b1\n");
    // 사용자가 바깥에서 b.txt를 원래 내용으로 되돌렸다
    writeFileSync(join(rw.folder, "b.txt"), "b0\n");
    const bashItem = rw.seedUserItem(threadId, turn);
    rw.seedBashIntent(threadId, turn, bashItem, "tc-bash-1");

    const preview = must(await rw.service.preview({ threadId, to: item }));
    expect(preview.toEventId).toBeTruthy();
    expect(preview.files).toEqual([
      { path: join(rw.folder, "a.txt"), action: "delete", reason: null, turnId: turn },
      { path: join(rw.folder, "b.txt"), action: "skip", reason: "already_original", turnId: turn },
    ]);
    expect(preview.untracked).toEqual([{ turnId: turn, kind: "shell", toolCallId: "tc-bash-1" }]);
    expect(preview.incomplete).toEqual([]);
  });

  test("undo puts the files back to the state before the rewind (⑦)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "orig\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "agent\n");
    await rw.write(threadId, turn, "made.txt", "made by agent\n");
    must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "files",
        overwrite: [],
        rewindId: "rwd_undoundo",
        oldLeafEventId: null,
      }),
    );
    expect(read(rw, "a.txt")).toBe("orig\n");
    expect(existsSync(join(rw.folder, "made.txt"))).toBe(false);

    const undone = must(await rw.service.undoFiles({ threadId, rewindId: "rwd_undoundo" }));
    expect(undone.files).toEqual([
      { path: join(rw.folder, "a.txt"), outcome: "restored", reason: null },
      { path: join(rw.folder, "made.txt"), outcome: "restored", reason: null },
    ]);
    expect(read(rw, "a.txt")).toBe("agent\n");
    expect(read(rw, "made.txt")).toBe("made by agent\n");

    // 두 번째 되돌리기는 처음 결과를 돌려주고 기록을 더하지 않는다
    const again = must(await rw.service.undoFiles({ threadId, rewindId: "rwd_undoundo" }));
    expect(again.files).toEqual(undone.files);
    const undoneEvents = (await rw.events(threadId, "workspace.rewind_undone")).length;
    expect(undoneEvents).toBe(1);
  });

  test("a file over the snapshot limit is unrestorable and preview skips it (⑧)", async () => {
    await using rw = await openRewind({
      limits: { fileMaxBytes: 4, threadQuotaBytes: 1024 * 1024 },
    });
    writeFileSync(join(rw.folder, "big.txt"), "1234567");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "big.txt", "x\n");

    const captured = captures(await rw.events(threadId, "workspace."));
    expect(captured.flatMap((payload) => payload.entries.map((entry) => entry.before))).toEqual([
      { state: "unrestorable", reason: "too_large", size: 7 },
    ]);
    const preview = must(await rw.service.preview({ threadId, to: item }));
    expect(preview.files).toEqual([
      { path: join(rw.folder, "big.txt"), action: "skip", reason: "too_large", turnId: turn },
    ]);
    must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "files",
        overwrite: [],
        rewindId: "rwd_toolarge1",
        oldLeafEventId: null,
      }),
    );
    expect(read(rw, "big.txt")).toBe("x\n");
  });

  test("the default limit is sixteen MiB per file (⑧)", async () => {
    await using rw = await openRewind();
    const over = Buffer.alloc(FILE_SNAPSHOT_MAX_BYTES + 1, 0x61);
    writeFileSync(join(rw.folder, "huge.bin"), over);
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "huge.bin", "small\n");

    const preview = must(await rw.service.preview({ threadId, to: item }));
    expect(preview.files).toEqual([
      { path: join(rw.folder, "huge.bin"), action: "skip", reason: "too_large", turnId: turn },
    ]);
  });

  test("the per-conversation quota refuses new saves once the total is spent (⑧)", async () => {
    await using rw = await openRewind({
      limits: { fileMaxBytes: 100, threadQuotaBytes: 10 },
    });
    writeFileSync(join(rw.folder, "a.txt"), "12345678");
    writeFileSync(join(rw.folder, "b.txt"), "abcdefgh");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "a2\n");
    await rw.write(threadId, turn, "b.txt", "b2\n");

    const preview = must(await rw.service.preview({ threadId, to: item }));
    expect(preview.files).toEqual([
      { path: join(rw.folder, "a.txt"), action: "restore", reason: null, turnId: turn },
      { path: join(rw.folder, "b.txt"), action: "skip", reason: "quota", turnId: turn },
    ]);
  });

  test("a started rewind without its applied record is incomplete, and the same id completes it (⑨)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "orig\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "agent\n");

    rw.faults.commitPrefix = "rewind:applied:";
    const failed = failureOf(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_incomplete",
        oldLeafEventId: null,
      }),
    );
    expect(failed.kind).toBe("store_failed");
    // 파일은 이미 원본으로 돌아갔고 적용 기록만 없다. 시작 기록은 남아 있다
    expect(read(rw, "a.txt")).toBe("orig\n");
    const incomplete = must(await rw.service.incomplete({ threadId }));
    expect(incomplete.map((entry) => entry.rewindId)).toEqual(["rwd_incomplete"]);
    const started = (await rw.events(threadId, "workspace.rewind_started")).map((event) =>
      must(parse(WorkspaceRewindStartedPayloadSchema, event.payload)),
    );
    expect(started.map((payload) => payload.rewindId)).toEqual(["rwd_incomplete"]);

    rw.faults.commitPrefix = null;
    const completed = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_incomplete",
        oldLeafEventId: null,
      }),
    );
    expect(completed.files).toEqual([
      { path: join(rw.folder, "a.txt"), outcome: "already_original", reason: null },
    ]);
    expect(must(await rw.service.incomplete({ threadId }))).toEqual([]);
    expect(read(rw, "a.txt")).toBe("orig\n");
  });

  test("two edits in one turn keep the first before and the last expected hash (⑩)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "orig\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "v1\n");
    await rw.write(threadId, turn, "a.txt", "v2\n");

    const entries = summaryOf(await rw.events(threadId, "workspace.files_captured"));
    expect(entries).toEqual([
      { path: join(rw.folder, "a.txt"), first: true, before: "saved", afterSha256: sha("v1\n") },
      { path: join(rw.folder, "a.txt"), first: false, before: null, afterSha256: sha("v2\n") },
    ]);

    // 마지막 내용(v2)과 같으므로 밖에서 바뀐 것이 아니다. 원본으로 돌아간다
    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "files",
        overwrite: [],
        rewindId: "rwd_twotimes",
        oldLeafEventId: null,
      }),
    );
    expect(applied.files).toEqual([
      { path: join(rw.folder, "a.txt"), outcome: "restored", reason: null },
    ]);
    expect(read(rw, "a.txt")).toBe("orig\n");
  });

  test("a failed capture does not change the tool result, and nothing is recorded for that path (⑪)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "c.txt"), "before\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    rw.seedUserItem(threadId, turn);

    rw.faults.commitPrefix = "rewind:capture:";
    const written = await rw.write(threadId, turn, "c.txt", "after\n");
    rw.faults.commitPrefix = null;
    expect(written.bytes).toBe(Buffer.byteLength("after\n"));
    expect(read(rw, "c.txt")).toBe("after\n");
    expect(rw.logs.filter((line) => line.event === "workspace.rewind_capture_failed")).toEqual([
      {
        level: "warn",
        event: "workspace.rewind_capture_failed",
        fields: { path: join(rw.folder, "c.txt"), reason: "io" },
      },
    ]);

    // 처음 기록이 실패한 경로는 이 턴에서 다시 쓰여도 기록하지 않는다(중간 내용을 원본으로 적지 않는다)
    await rw.write(threadId, turn, "c.txt", "again\n");
    expect(captures(await rw.events(threadId, "workspace.files_captured"))).toEqual([]);
  });

  test("a failed blob save does not block the write, and nothing is recorded (⑪)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "d.txt"), "before\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    rw.seedUserItem(threadId, turn);

    rw.faults.blobsFail = true;
    const written = await rw.write(threadId, turn, "d.txt", "after\n");
    rw.faults.blobsFail = false;
    expect(written.bytes).toBe(Buffer.byteLength("after\n"));
    expect(read(rw, "d.txt")).toBe("after\n");
    expect(rw.logs.map((line) => [line.event, line.fields])).toEqual([
      [
        "workspace.rewind_capture_failed",
        { path: join(rw.folder, "d.txt"), reason: "blob:disk_full" },
      ],
    ]);
    expect(captures(await rw.events(threadId, "workspace."))).toEqual([]);
  });

  test("a write without a conversation and turn records nothing (⑪)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "e.txt"), "before\n");
    const threadId = rw.newThread();
    rw.seedUserItem(threadId, rw.newTurn());

    await rw.writeWithoutTurn(threadId, "e.txt", "after\n");
    expect(read(rw, "e.txt")).toBe("after\n");
    expect(await rw.events(threadId, "workspace.")).toEqual([]);
  });

  test("logs and event payloads carry no file content (⑫)", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "ORIGINAL-SECRET-1\n");
    writeFileSync(join(rw.folder, "c.txt"), "LOG-OLD-4\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "NEW-SECRET-2\n");
    rw.faults.commitPrefix = "rewind:capture:";
    await rw.write(threadId, turn, "c.txt", "LOG-NEW-5\n");
    rw.faults.commitPrefix = null;
    must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "both",
        overwrite: [],
        rewindId: "rwd_nocontent",
        oldLeafEventId: null,
      }),
    );
    const events = await rw.events(threadId, "workspace.");
    const payloads = JSON.stringify(events.map((event) => event.payload));
    const logs = JSON.stringify(rw.logs);
    for (const marker of ["ORIGINAL-SECRET-1", "NEW-SECRET-2", "LOG-OLD-4", "LOG-NEW-5"]) {
      expect(payloads.includes(marker)).toBe(false);
      expect(logs.includes(marker)).toBe(false);
    }
    expect(rw.logs.length).toBe(1);
  });

  test("a file whose folder disappeared is kept, and overwrite recreates the folder (restore write)", async () => {
    await using rw = await openRewind();
    mkdirSync(join(rw.folder, "sub/deep"), { recursive: true });
    writeFileSync(join(rw.folder, "sub/deep/f.txt"), "orig\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "sub/deep/f.txt", "agent\n");
    rmSync(join(rw.folder, "sub"), { recursive: true, force: true });

    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "files",
        overwrite: [],
        rewindId: "rwd_folderback",
        oldLeafEventId: null,
      }),
    );
    // 디렉터리째 사라진 파일은 밖에서 지워진 것이라 건드리지 않는다
    expect(applied.files).toEqual([
      {
        path: join(rw.folder, "sub/deep/f.txt"),
        outcome: "kept_changed",
        reason: "deleted_outside",
      },
    ]);
    expect(existsSync(join(rw.folder, "sub"))).toBe(false);

    const restored = must(
      await rw.service.overwrite({
        threadId,
        rewindId: "rwd_folderback",
        paths: [join(rw.folder, "sub/deep/f.txt")],
      }),
    );
    expect(restored.files).toEqual([
      { path: join(rw.folder, "sub/deep/f.txt"), outcome: "restored", reason: null },
    ]);
    expect(read(rw, "sub/deep/f.txt")).toBe("orig\n");
  });

  test("removing a new file leaves its empty folder in place", async () => {
    await using rw = await openRewind();
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "newdir/n.txt", "agent\n");

    must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "files",
        overwrite: [],
        rewindId: "rwd_keepdir1",
        oldLeafEventId: null,
      }),
    );
    expect(existsSync(join(rw.folder, "newdir/n.txt"))).toBe(false);
    expect(existsSync(join(rw.folder, "newdir"))).toBe(true);
  });

  test("turnFiles reports each turn's files with its first state and touch count", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "orig\n");
    const threadId = rw.newThread();
    const first = rw.newTurn();
    const second = rw.newTurn();
    rw.seedUserItem(threadId, first);
    await rw.write(threadId, first, "a.txt", "one\n");
    await rw.write(threadId, first, "a.txt", "two\n");
    await rw.write(threadId, second, "new.txt", "fresh\n");

    const view = must(await rw.service.turnFiles({ threadId, turnId: null }));
    expect(view.turns).toEqual([
      {
        turnId: first,
        files: [
          {
            path: join(rw.folder, "a.txt"),
            existedBefore: true,
            restorable: true,
            unrestorableReason: null,
            touches: 2,
          },
        ],
      },
      {
        turnId: second,
        files: [
          {
            path: join(rw.folder, "new.txt"),
            existedBefore: false,
            restorable: true,
            unrestorableReason: null,
            touches: 1,
          },
        ],
      },
    ]);
    const only = must(await rw.service.turnFiles({ threadId, turnId: second }));
    expect(only.turns.map((turn) => turn.turnId)).toEqual([second]);
  });

  test("a target that is not in the conversation is refused", async () => {
    await using rw = await openRewind();
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    rw.seedUserItem(threadId, turn);
    const missing = rw.ids.next("itm");
    const failure = failureOf(await rw.service.preview({ threadId, to: missing }));
    expect(failure).toEqual({ kind: "target_not_found", to: missing });
  });

  test("a conversation-only rewind touches no files and records nothing", async () => {
    await using rw = await openRewind();
    writeFileSync(join(rw.folder, "a.txt"), "orig\n");
    const threadId = rw.newThread();
    const turn = rw.newTurn();
    const item = rw.seedUserItem(threadId, turn);
    await rw.write(threadId, turn, "a.txt", "agent\n");

    const applied = must(
      await rw.service.apply({
        threadId,
        to: item,
        scope: "conversation",
        overwrite: [],
        rewindId: "rwd_convonly",
        oldLeafEventId: null,
      }),
    );
    expect(applied).toEqual({ rewindId: "rwd_convonly", files: [], kept: [], untracked: [] });
    expect(read(rw, "a.txt")).toBe("agent\n");
    expect(await rw.events(threadId, "workspace.rewind_")).toEqual([]);
  });
});
