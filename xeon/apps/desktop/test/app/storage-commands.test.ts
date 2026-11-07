import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { err, ok } from "@fresnel/contracts";
import { createStorageCommands } from "../../src/app/storage.ts";
import type { DbRestoreReply, EngineTarget, IpcError } from "../../src/transport/ipc.ts";
import { BACKUP_REPORT, PREVIOUS_REMOVED, STORAGE_USAGE, fakeIpc } from "../transport/fake-ipc.ts";

// 저장 공간 명령(백업 만들기, 사용량 보기, 복원 전 사본 지우기, 데이터 폴더 열기)의 결과를 화면의 실패로 바꾸는 명령 본체를 시험한다.
// 종료 코드마다 종류와 문장과 해결 줄을 값으로 비교한다. stderr는 CLI가 쓰는 모양(머리말 `fresnel: `, 해결 줄)을 그대로 만든다.

function replyOf(exitCode: number, stderr = "", stdout = ""): DbRestoreReply {
  return { exitCode, stdout, stderr };
}

/** 가짜 셸과 저장 공간 명령을 짝지어 만든다. 가짜 셸이 돌려줄 결과는 옵션으로 정한다 */
function commandsWith(options: Parameters<typeof fakeIpc>[0] = {}) {
  const fake = fakeIpc(options);
  const commands = createStorageCommands({
    ipc: fake.ipc,
    engineSwitch: { current: () => null },
  });
  return { fake, commands };
}

describe("usage", () => {
  test("gives the usage report the shell printed, exactly", async () => {
    const { fake, commands } = commandsWith();
    expect(await commands.usage()).toEqual(ok(STORAGE_USAGE));
    expect(fake.dbUsageCalls).toBe(1);
  });

  test("a stdout that is not a usage report is bad_reply with the bad-reply sentence", async () => {
    const { commands } = commandsWith({ dbUsageResult: ok(replyOf(0, "", "{}")) });
    expect(await commands.usage()).toEqual(
      err({
        kind: "bad_reply",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });

  test("a stdout that is not JSON is bad_reply", async () => {
    const { commands } = commandsWith({ dbUsageResult: ok(replyOf(0, "", "not json")) });
    expect(await commands.usage()).toEqual(
      err({
        kind: "bad_reply",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });

  test("a negative byte count in the previous copies is bad_reply", async () => {
    const stdout = JSON.stringify({
      ...STORAGE_USAGE,
      previous: [{ name: "20261104T000000000Z", bytes: -1 }],
    });
    const { commands } = commandsWith({ dbUsageResult: ok(replyOf(0, "", stdout)) });
    expect(await commands.usage()).toEqual(
      err({
        kind: "bad_reply",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });

  test("a notice on stderr with exit 0 is not a failure", async () => {
    const stdout = JSON.stringify(STORAGE_USAGE);
    const { commands } = commandsWith({
      dbUsageResult: ok(replyOf(0, "경고: 로그 파일을 읽지 못했다\n", stdout)),
    });
    expect(await commands.usage()).toEqual(ok(STORAGE_USAGE));
  });

  test("a shell rejection is the shell kind and names the code", async () => {
    const { commands } = commandsWith({
      dbUsageResult: err({ kind: "command", command: "db_usage", code: "busy" }),
    });
    expect(await commands.usage()).toEqual(
      err({
        kind: "shell",
        message: t("desktop.settings.restore.refused.reject", { code: "busy" }),
        fix: null,
      }),
    );
  });
});

describe("backup", () => {
  test("sends the parent folder once and gives the report the shell printed, exactly", async () => {
    const { fake, commands } = commandsWith();
    expect(await commands.backup("/Users/me/Desktop")).toEqual(ok(BACKUP_REPORT));
    expect(fake.dbExportCalls).toEqual(["/Users/me/Desktop"]);
  });

  test("exit 2 is usage, with the Korean message and its fix line", async () => {
    const stderr =
      "fresnel: 백업을 넣을 폴더가 비어 있지 않아요\n  해결: 비어 있는 폴더를 고르세요\n";
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(2, stderr)) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "usage",
        message: "백업을 넣을 폴더가 비어 있지 않아요",
        fix: "비어 있는 폴더를 고르세요",
      }),
    );
  });

  test("exit 2 in English keeps the English message and the Fix line", async () => {
    const stderr = "fresnel: The backup folder is not empty\n  Fix: Choose an empty folder\n";
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(2, stderr)) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "usage",
        message: "The backup folder is not empty",
        fix: "Choose an empty folder",
      }),
    );
  });

  test("exit 3 is environment, with the Korean message and its fix line", async () => {
    const stderr = "fresnel: 디스크 공간이 부족해요\n  해결: 공간을 확보한 뒤 다시 시도하세요\n";
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(3, stderr)) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "environment",
        message: "디스크 공간이 부족해요",
        fix: "공간을 확보한 뒤 다시 시도하세요",
      }),
    );
  });

  test("exit 3 in English is environment with the English message and Fix line", async () => {
    const stderr =
      "fresnel: Permission denied while writing the backup\n  Fix: Check the folder permissions\n";
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(3, stderr)) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "environment",
        message: "Permission denied while writing the backup",
        fix: "Check the folder permissions",
      }),
    );
  });

  test("exit 1 is declined, with the message and its fix line", async () => {
    const stderr = "fresnel: The backup was not confirmed\n  Fix: Run it again and confirm\n";
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(1, stderr)) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "declined",
        message: "The backup was not confirmed",
        fix: "Run it again and confirm",
      }),
    );
  });

  test("a stderr with no fix line has a null fix", async () => {
    const stderr = "fresnel: 알 수 없는 환경 문제\n";
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(3, stderr)) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({ kind: "environment", message: "알 수 없는 환경 문제", fix: null }),
    );
  });

  test("exit 3 with nothing on stderr shows the exit code and has no fix", async () => {
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(3, "")) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "environment",
        message: t("desktop.settings.restore.refused.exit", { code: 3 }),
        fix: null,
      }),
    );
  });

  test("an unknown exit code with nothing on stderr shows that code and is environment", async () => {
    const { commands } = commandsWith({ dbExportResult: ok(replyOf(4, "")) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "environment",
        message: t("desktop.settings.restore.refused.exit", { code: 4 }),
        fix: null,
      }),
    );
  });

  test("exit 0 with a stdout that is not a backup report is bad_reply", async () => {
    const { commands } = commandsWith({
      dbExportResult: ok(replyOf(0, "", JSON.stringify({ destDir: "/x" }))),
    });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "bad_reply",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });

  test("a shell rejection is the shell kind and names the code", async () => {
    const error: IpcError = { kind: "command", command: "db_export", code: "remote-target" };
    const { commands } = commandsWith({ dbExportResult: err(error) });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "shell",
        message: t("desktop.settings.restore.refused.reject", { code: "remote-target" }),
        fix: null,
      }),
    );
  });

  test("a reply the shell sent in a shape the app does not know is bad_reply", async () => {
    const { commands } = commandsWith({
      dbExportResult: err({ kind: "invalid", command: "db_export" }),
    });
    expect(await commands.backup("/Users/me/Desktop")).toEqual(
      err({
        kind: "bad_reply",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });
});

describe("removePrevious", () => {
  test("sends the copy name once and gives the removal report, exactly", async () => {
    const { fake, commands } = commandsWith();
    expect(await commands.removePrevious("20261104T000000000Z")).toEqual(ok(PREVIOUS_REMOVED));
    expect(fake.dbPreviousRemoveCalls).toEqual(["20261104T000000000Z"]);
  });

  test("exit 2 for a name that is not a copy is usage, with its message and fix", async () => {
    const stderr = "fresnel: 복원 전 사본이 아니에요\n  해결: 목록에서 고르세요\n";
    const { commands } = commandsWith({ dbPreviousRemoveResult: ok(replyOf(2, stderr)) });
    expect(await commands.removePrevious("20261104T000000000Z")).toEqual(
      err({ kind: "usage", message: "복원 전 사본이 아니에요", fix: "목록에서 고르세요" }),
    );
  });

  test("exit 1 is declined when the removal was not confirmed", async () => {
    const stderr = "fresnel: The removal was not confirmed\n  Fix: Run it again and confirm\n";
    const { commands } = commandsWith({ dbPreviousRemoveResult: ok(replyOf(1, stderr)) });
    expect(await commands.removePrevious("20261104T000000000Z")).toEqual(
      err({
        kind: "declined",
        message: "The removal was not confirmed",
        fix: "Run it again and confirm",
      }),
    );
  });

  test("exit 0 with a negative freed size is bad_reply", async () => {
    const stdout = JSON.stringify({ removed: "20261104T000000000Z", freedBytes: -4 });
    const { commands } = commandsWith({ dbPreviousRemoveResult: ok(replyOf(0, "", stdout)) });
    expect(await commands.removePrevious("20261104T000000000Z")).toEqual(
      err({
        kind: "bad_reply",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });
});

describe("openDataDir", () => {
  test("is true when the shell opened the data folder", async () => {
    const { fake, commands } = commandsWith();
    expect(await commands.openDataDir()).toBe(true);
    expect(fake.openDataDirCalls).toBe(1);
  });

  test("is false when the shell refused to open it", async () => {
    const { commands } = commandsWith({
      openDataDirResult: err({ kind: "command", command: "open_data_dir", code: "open_failed" }),
    });
    expect(await commands.openDataDir()).toBe(false);
  });
});

describe("engineTarget", () => {
  test("reads the target the engine switch remembers", () => {
    const target: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
    const commands = createStorageCommands({
      ipc: fakeIpc().ipc,
      engineSwitch: { current: () => target },
    });
    expect(commands.engineTarget()).toEqual(target);
  });
});
