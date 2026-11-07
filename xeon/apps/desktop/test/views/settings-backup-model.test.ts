import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { BackupReport, EngineTarget } from "../../src/transport/ipc.ts";
import type { StorageCommands, StorageFailure } from "../../src/views/commands.ts";
import {
  backupBlockOf,
  createBackupController,
  sharedBackupController,
  type BackupPhase,
} from "../../src/views/pages/settings/settings-backup-model.ts";
import { BACKUP_REPORT } from "../transport/fake-ipc.ts";

// 백업 만들기 구역의 컨트롤러. 화면이 부르는 입구(edit, ask, cancel, confirm)로 흐름을 본다.
// 확인하면 명령이 정확히 한 번, 다듬은 상위 폴더로 불린다. 취소하거나 막혀 있으면 명령은 한 번도 불리지 않는다.

const LOCAL: EngineTarget = { kind: "local" };
const REMOTE: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
const FAILURE: StorageFailure = {
  kind: "environment",
  message: "디스크가 가득 찼어요",
  fix: "공간을 비운 뒤 다시 시도해 주세요",
};
const NOOP = (): void => {};

interface FakePort {
  readonly port: Pick<StorageCommands, "engineTarget" | "backup">;
  /** `backup`이 받은 상위 폴더, 호출 순서 */
  readonly calls: string[];
  /** 엔진 대상. 시험 중에 바꿀 수 있다 */
  target: EngineTarget | null;
  /** 다음 `backup`이 돌려줄 결과 */
  reply: Result<BackupReport, StorageFailure>;
  /** 설정하면 `backup`이 이 약속이 풀릴 때까지 끝나지 않는다 */
  gate: Promise<void> | null;
}

function fakePort(over: Partial<Pick<FakePort, "target" | "reply">> = {}): FakePort {
  const fake: FakePort = {
    port: {
      engineTarget: () => fake.target,
      backup: async (parentDir) => {
        fake.calls.push(parentDir);
        if (fake.gate !== null) await fake.gate;
        return fake.reply;
      },
    },
    calls: [],
    target: LOCAL,
    reply: ok(BACKUP_REPORT),
    gate: null,
    ...over,
  };
  return fake;
}

describe("confirm sends the trimmed parent folder to the command", () => {
  test("the parent is sent once, trimmed, and the report is kept as the phase", async () => {
    const fake = fakePort();
    const settled: BackupPhase[] = [];
    const controller = createBackupController(fake.port, {
      settled: (phase) => {
        settled.push(phase);
      },
    });
    controller.edit("  /backups \n");
    controller.ask();
    expect(controller.getState().asking).toBe(true);
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups"]);
    expect(controller.getState()).toMatchObject({
      parent: "  /backups \n",
      asking: false,
      phase: { kind: "done", report: BACKUP_REPORT },
    });
    expect(settled).toEqual([{ kind: "done", report: BACKUP_REPORT }]);
  });

  test("a refused backup is kept as the phase and reported to settled", async () => {
    const fake = fakePort({ reply: err(FAILURE) });
    const settled: BackupPhase[] = [];
    const controller = createBackupController(fake.port, {
      settled: (phase) => {
        settled.push(phase);
      },
    });
    controller.edit("/backups");
    controller.ask();
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups"]);
    expect(controller.getState().phase).toEqual({ kind: "refused", failure: FAILURE });
    expect(settled).toEqual([{ kind: "refused", failure: FAILURE }]);
  });

  test("while a backup runs the phase is running, and a second confirm does not call again", async () => {
    let release: () => void = NOOP;
    const fake = fakePort();
    fake.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createBackupController(fake.port);
    controller.edit("/backups");
    controller.ask();
    const first = controller.confirm();
    expect(controller.getState().phase).toEqual({ kind: "running" });
    controller.ask();
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups"]);
    release();
    await first;
    expect(controller.getState().phase.kind).toBe("done");
  });
});

describe("cancel and the blocked cases call nothing", () => {
  test("cancel closes the dialog and the command is not called", () => {
    const fake = fakePort();
    const controller = createBackupController(fake.port);
    controller.edit("/backups");
    controller.ask();
    controller.cancel();
    expect(controller.getState()).toMatchObject({ asking: false, phase: { kind: "idle" } });
    expect(fake.calls).toEqual([]);
  });

  test("a blank parent does not open the dialog, and confirm does not call", async () => {
    const fake = fakePort();
    const controller = createBackupController(fake.port);
    controller.edit("   ");
    controller.ask();
    expect(controller.getState().asking).toBe(false);
    await controller.confirm();
    expect(fake.calls).toEqual([]);
    expect(controller.getState().phase).toEqual({ kind: "idle" });
  });

  test("a relative parent does not open the dialog, and confirm does not call", async () => {
    const fake = fakePort();
    const controller = createBackupController(fake.port);
    controller.edit("backups");
    controller.ask();
    expect(controller.getState().asking).toBe(false);
    await controller.confirm();
    expect(fake.calls).toEqual([]);
    expect(controller.getState().phase).toEqual({ kind: "idle" });
  });

  test("a remote engine target blocks the dialog and the command", async () => {
    const fake = fakePort({ target: REMOTE });
    const controller = createBackupController(fake.port);
    controller.edit("/backups");
    controller.ask();
    expect(controller.getState().asking).toBe(false);
    await controller.confirm();
    expect(fake.calls).toEqual([]);
  });

  test("an unknown engine target does not block: the shell default is local", async () => {
    const fake = fakePort({ target: null });
    const controller = createBackupController(fake.port);
    controller.edit("/backups");
    controller.ask();
    expect(controller.getState().asking).toBe(true);
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups"]);
  });

  test("the engine target is read again when the dialog is asked, so a change to remote is seen", () => {
    const fake = fakePort({ target: LOCAL });
    const controller = createBackupController(fake.port);
    controller.edit("/backups");
    fake.target = REMOTE;
    controller.ask();
    expect(controller.getState()).toMatchObject({ asking: false, target: REMOTE });
  });
});

describe("backupBlockOf orders the reasons", () => {
  const idle = { parent: "/backups", target: LOCAL, phase: { kind: "idle" } } as const;

  test("a runnable state has no block", () => {
    expect(backupBlockOf(idle)).toBeNull();
  });

  test("running is first, then remote, then blank", () => {
    expect(backupBlockOf({ ...idle, phase: { kind: "running" } })).toBe("running");
    expect(backupBlockOf({ ...idle, target: REMOTE, parent: "" })).toBe("remote");
    expect(backupBlockOf({ ...idle, target: null, parent: "" })).toBe("blank");
    expect(backupBlockOf({ ...idle, parent: "  " })).toBe("blank");
  });

  test("a relative path is a block, and absolute POSIX, drive and UNC paths are not", () => {
    expect(backupBlockOf({ ...idle, parent: "backups" })).toBe("relative");
    expect(backupBlockOf({ ...idle, parent: "./export" })).toBe("relative");
    expect(backupBlockOf({ ...idle, parent: "  /backups  " })).toBeNull();
    expect(backupBlockOf({ ...idle, parent: "C:\\backups" })).toBeNull();
    expect(backupBlockOf({ ...idle, parent: "\\\\server\\share" })).toBeNull();
  });
});

describe("the shared controller survives a remount", () => {
  test("the same port gives the same controller, so a made backup is still there after the screen is rebuilt", async () => {
    const fake = fakePort();
    const first = sharedBackupController(fake.port);
    first.edit("/backups");
    first.ask();
    await first.confirm();
    const second = sharedBackupController(fake.port);
    expect(second).toBe(first);
    expect(second.getState().phase).toEqual({ kind: "done", report: BACKUP_REPORT });
    expect(sharedBackupController(fakePort().port)).not.toBe(first);
  });

  test("a refusal stays in the state and the command ran once", async () => {
    const fake = fakePort({ reply: err(FAILURE) });
    const controller = sharedBackupController(fake.port);
    controller.edit("/backups/bad");
    controller.ask();
    await controller.confirm();
    expect(sharedBackupController(fake.port).getState().phase).toEqual({
      kind: "refused",
      failure: FAILURE,
    });
    expect(fake.calls).toEqual(["/backups/bad"]);
  });
});
