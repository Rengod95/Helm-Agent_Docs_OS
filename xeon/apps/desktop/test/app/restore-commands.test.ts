import { describe, expect, test } from "bun:test";
import { t, type MessageId } from "@fresnel/client/i18n";
import { err, ok } from "@fresnel/contracts";
import {
  createRestoreCommands,
  refusalOfIpcError,
  restoreOutcomeOf,
} from "../../src/app/restore.ts";
import type { DbRestoreReply, EngineTarget, IpcError } from "../../src/transport/ipc.ts";
import type { RestoreRefusalKind } from "../../src/views/commands.ts";
import { fakeIpc, RESTORE_REPORT } from "../transport/fake-ipc.ts";

// 데이터 복원 결과를 화면의 거절 종류로 바꾸는 순수 함수와 명령 본체(`commands.restore`)를 시험한다.
// 종료 코드마다 종류와 문장을 값으로 비교한다. stderr는 CLI가 쓰는 모양(머리말 `fresnel: `, 해결 줄)을 그대로 만든다.

/** CLI 실패 문장(apps/cli/src/errors.ts renderFailure) */
function failureText(message: string, fix: string): string {
  return `fresnel: ${message}\n  ${t("cli.errors.fixLabel")} ${fix}\n`;
}

function replyOf(exitCode: number, stderr = "", stdout = ""): DbRestoreReply {
  return { exitCode, stdout, stderr };
}

describe("exit 0 reads the report the CLI printed", () => {
  test("the report comes back as it was printed, and the notices on stderr are not a failure", () => {
    const notice = "경고: 백업에 없는 블롭이 있다\n";
    expect(restoreOutcomeOf(replyOf(0, notice, JSON.stringify(RESTORE_REPORT)))).toEqual(
      ok(RESTORE_REPORT),
    );
  });

  test("a stdout that is not a report is an io refusal with the bad-reply sentence", () => {
    expect(restoreOutcomeOf(replyOf(0, "", "{}"))).toEqual(
      err({
        kind: "io",
        message: t("desktop.settings.restore.refused.badReply"),
        fix: null,
      }),
    );
  });
});

describe("exit 2 is not a backup folder", () => {
  test("the not-found sentence and its fix come from the CLI catalog", () => {
    const stderr = failureText(
      t("cli.errors.restore.notFound.message"),
      t("cli.errors.restore.notFound.fix"),
    );
    expect(restoreOutcomeOf(replyOf(2, stderr))).toEqual(
      err({
        kind: "not_a_backup",
        message: t("cli.errors.restore.notFound.message"),
        fix: t("cli.errors.restore.notFound.fix"),
      }),
    );
  });
});

describe("exit 3 is classified by the sentence on stderr", () => {
  const cases: readonly {
    readonly name: string;
    readonly kind: RestoreRefusalKind;
    readonly message: MessageId;
    readonly args: Readonly<Record<string, string>>;
    readonly fix: MessageId;
  }[] = [
    {
      name: "a manifest that is broken",
      kind: "invalid",
      message: "cli.errors.restore.backupInvalid.manifest",
      args: {},
      fix: "cli.errors.restore.backupInvalid.fix",
    },
    {
      name: "a backup in an unknown format",
      kind: "invalid",
      message: "cli.errors.restore.backupInvalid.format",
      args: {},
      fix: "cli.errors.restore.backupInvalid.fix",
    },
    {
      name: "a database that fails the integrity check",
      kind: "invalid",
      message: "cli.errors.restore.backupInvalid.integrity",
      args: {},
      fix: "cli.errors.restore.backupInvalid.fix",
    },
    {
      name: "a backup without the Fresnel schema",
      kind: "invalid",
      message: "cli.errors.restore.backupInvalid.schema",
      args: {},
      fix: "cli.errors.restore.backupInvalid.fix",
    },
    {
      name: "a missing blob file",
      kind: "invalid",
      message: "cli.errors.restore.backupInvalid.blobMissing",
      args: {},
      fix: "cli.errors.restore.backupInvalid.fix",
    },
    {
      name: "a blob whose hash differs",
      kind: "invalid",
      message: "cli.errors.restore.backupInvalid.blobHash",
      args: {},
      fix: "cli.errors.restore.backupInvalid.fix",
    },
    {
      name: "another application's database",
      kind: "invalid",
      message: "cli.errors.restore.foreign.message",
      args: { applicationId: "1234" },
      fix: "cli.errors.restore.foreign.fix",
    },
    {
      name: "a file that is not SQLite",
      kind: "invalid",
      message: "cli.errors.restore.notDatabase.message",
      args: {},
      fix: "cli.errors.restore.notDatabase.fix",
    },
    {
      name: "a backup from a newer version",
      kind: "future_version",
      message: "cli.errors.restore.futureVersion.message",
      args: { backupVersion: "9", codeVersion: "7" },
      fix: "cli.errors.restore.futureVersion.fix",
    },
    {
      name: "a running engine",
      kind: "engine_running",
      message: "cli.errors.restore.engineRunning.message",
      args: {},
      fix: "cli.errors.restore.engineRunning.fix",
    },
    {
      name: "a full disk",
      kind: "io",
      message: "cli.errors.common.storageFull.message",
      args: {},
      fix: "cli.errors.common.storageFull.fix",
    },
    {
      name: "an input/output error with its code",
      kind: "io",
      message: "cli.errors.restore.io.message",
      args: { code: "EACCES" },
      fix: "cli.errors.restore.io.fix",
    },
  ];

  for (const item of cases) {
    test(`${item.name} is ${item.kind}, with the CLI sentence and its fix`, () => {
      const stderr = failureText(t(item.message, item.args), t(item.fix));
      expect(restoreOutcomeOf(replyOf(3, stderr))).toEqual(
        err({
          kind: item.kind,
          message: t(item.message, item.args),
          fix: t(item.fix),
        }),
      );
    });
  }

  test("a sentence written in the other locale is recognised and shown in the current one", () => {
    // en.json의 engineRunning 문장(영어 로케일의 카탈로그 값 그대로)
    const english =
      "fresnel: The database is in use by a running engine (nothing was changed)\n  Fix: x\n";
    expect(restoreOutcomeOf(replyOf(3, english))).toEqual(
      err({
        kind: "engine_running",
        message: t("cli.errors.restore.engineRunning.message"),
        fix: t("cli.errors.restore.engineRunning.fix"),
      }),
    );
  });

  test("a sentence that no catalog entry matches is shown as its first line, without a fix", () => {
    expect(restoreOutcomeOf(replyOf(3, "fresnel: 디스크가 이상하다\n  해결: 다시\n"))).toEqual(
      err({ kind: "io", message: "디스크가 이상하다", fix: null }),
    );
  });

  test("exit 3 with nothing on stderr shows the exit code", () => {
    expect(restoreOutcomeOf(replyOf(3, ""))).toEqual(
      err({
        kind: "io",
        message: t("desktop.settings.restore.refused.exit", { code: 3 }),
        fix: null,
      }),
    );
  });
});

describe("other exit codes are io refusals", () => {
  test("a generic failure shows its first stderr line", () => {
    expect(restoreOutcomeOf(replyOf(1, "fresnel: 알 수 없는 실패\n  해결: 없음\n"))).toEqual(
      err({ kind: "io", message: "알 수 없는 실패", fix: null }),
    );
  });

  test("an unknown exit code with nothing on stderr shows the exit code", () => {
    expect(restoreOutcomeOf(replyOf(4, ""))).toEqual(
      err({
        kind: "io",
        message: t("desktop.settings.restore.refused.exit", { code: 4 }),
        fix: null,
      }),
    );
  });
});

describe("the shell's own refusals", () => {
  test("a remote engine target is the remote kind", () => {
    const error: IpcError = { kind: "command", command: "db_restore", code: "remote-target" };
    expect(refusalOfIpcError(error)).toEqual({
      kind: "remote",
      message: t("desktop.settings.restore.refused.remote.message"),
      fix: t("desktop.settings.restore.refused.remote.fix"),
    });
  });

  test("a restore already running is the busy kind", () => {
    const error: IpcError = { kind: "command", command: "db_restore", code: "busy" };
    expect(refusalOfIpcError(error)).toEqual({
      kind: "busy",
      message: t("desktop.settings.restore.refused.busy.message"),
      fix: t("desktop.settings.restore.refused.busy.fix"),
    });
  });

  test("an engine that is still stopping is the engine_running kind", () => {
    const error: IpcError = { kind: "command", command: "db_restore", code: "engine-stopping" };
    expect(refusalOfIpcError(error)).toEqual({
      kind: "engine_running",
      message: t("desktop.settings.restore.refused.engineStopping.message"),
      fix: t("desktop.settings.restore.refused.engineStopping.fix"),
    });
  });

  test("any other shell code is an io refusal that names the code", () => {
    const error: IpcError = { kind: "command", command: "db_restore", code: "bad-request" };
    expect(refusalOfIpcError(error)).toEqual({
      kind: "io",
      message: t("desktop.settings.restore.refused.reject", { code: "bad-request" }),
      fix: null,
    });
  });

  test("a reply the shell sent in a shape the app does not know is an io refusal", () => {
    expect(refusalOfIpcError({ kind: "invalid", command: "db_restore" })).toEqual({
      kind: "io",
      message: t("desktop.settings.restore.refused.badReply"),
      fix: null,
    });
  });
});

describe("the restore command", () => {
  test("run sends the folder once and gives the report the shell printed", async () => {
    const fake = fakeIpc();
    const commands = createRestoreCommands({
      ipc: fake.ipc,
      engineSwitch: { current: () => null },
    });
    expect(await commands.run("/backups/export-1")).toEqual(ok(RESTORE_REPORT));
    expect(fake.restored).toEqual(["/backups/export-1"]);
  });

  test("run gives the refusal of a shell rejection", async () => {
    const fake = fakeIpc({
      dbRestoreResult: err({ kind: "command", command: "db_restore", code: "busy" }),
    });
    const commands = createRestoreCommands({
      ipc: fake.ipc,
      engineSwitch: { current: () => null },
    });
    expect(await commands.run("/backups/export-1")).toEqual(
      err({
        kind: "busy",
        message: t("desktop.settings.restore.refused.busy.message"),
        fix: t("desktop.settings.restore.refused.busy.fix"),
      }),
    );
  });

  test("run gives the refusal of a non-zero exit the shell passed through", async () => {
    const stderr = failureText(
      t("cli.errors.restore.notFound.message"),
      t("cli.errors.restore.notFound.fix"),
    );
    const fake = fakeIpc({ dbRestoreResult: ok(replyOf(2, stderr)) });
    const commands = createRestoreCommands({
      ipc: fake.ipc,
      engineSwitch: { current: () => null },
    });
    expect(await commands.run("/nowhere")).toEqual(
      err({
        kind: "not_a_backup",
        message: t("cli.errors.restore.notFound.message"),
        fix: t("cli.errors.restore.notFound.fix"),
      }),
    );
  });

  test("engineTarget reads the target the engine switch remembers", () => {
    const target: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
    const commands = createRestoreCommands({
      ipc: fakeIpc().ipc,
      engineSwitch: { current: () => target },
    });
    expect(commands.engineTarget()).toEqual(target);
  });
});
