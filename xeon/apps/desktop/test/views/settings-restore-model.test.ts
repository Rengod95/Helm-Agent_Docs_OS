import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { EngineTarget, RestoreReport } from "../../src/transport/ipc.ts";
import type { RestoreCommands, RestoreRefusal } from "../../src/views/commands.ts";
import {
  createRestoreController,
  restoreBlockOf,
  type RestorePhase,
} from "../../src/views/pages/settings/settings-restore-model.ts";
import { RESTORE_REPORT } from "../transport/fake-ipc.ts";

// 데이터 복원 구역의 컨트롤러. 화면이 부르는 입구(edit, ask, cancel, confirm)로 흐름을 본다.
// 확인하면 명령이 정확히 한 번, 다듬은 경로로 불린다. 취소하거나 막혀 있으면 명령은 한 번도 불리지 않는다.

const LOCAL: EngineTarget = { kind: "local" };
const REMOTE: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
const REFUSAL: RestoreRefusal = { kind: "busy", message: "진행 중", fix: "기다리세요" };
const NOOP = (): void => {};

interface FakePort {
  readonly port: Pick<RestoreCommands, "engineTarget" | "run">;
  /** `run`이 받은 백업 폴더, 호출 순서 */
  readonly calls: string[];
  /** 엔진 대상. 시험 중에 바꿀 수 있다 */
  target: EngineTarget | null;
  /** 다음 `run`이 돌려줄 결과 */
  reply: Result<RestoreReport, RestoreRefusal>;
  /** 설정하면 `run`이 이 약속이 풀릴 때까지 끝나지 않는다 */
  gate: Promise<void> | null;
}

function fakePort(over: Partial<Pick<FakePort, "target" | "reply">> = {}): FakePort {
  const fake: FakePort = {
    port: {
      engineTarget: () => fake.target,
      run: async (backupDir) => {
        fake.calls.push(backupDir);
        if (fake.gate !== null) await fake.gate;
        return fake.reply;
      },
    },
    calls: [],
    target: LOCAL,
    reply: ok(RESTORE_REPORT),
    gate: null,
    ...over,
  };
  return fake;
}

describe("confirm sends the typed folder to the command", () => {
  test("the folder is sent once, trimmed, and the report is kept as the phase", async () => {
    const fake = fakePort();
    const settled: RestorePhase[] = [];
    const controller = createRestoreController(fake.port, {
      settled: (phase) => {
        settled.push(phase);
      },
    });
    controller.edit("  /backups/export-1 \n");
    controller.ask();
    expect(controller.getState().asking).toBe(true);
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups/export-1"]);
    expect(controller.getState()).toMatchObject({
      path: "  /backups/export-1 \n",
      asking: false,
      phase: { kind: "restored", report: RESTORE_REPORT },
    });
    expect(settled).toEqual([{ kind: "restored", report: RESTORE_REPORT }]);
  });

  test("a refused restore is kept as the phase and reported to settled", async () => {
    const fake = fakePort({ reply: err(REFUSAL) });
    const settled: RestorePhase[] = [];
    const controller = createRestoreController(fake.port, {
      settled: (phase) => {
        settled.push(phase);
      },
    });
    controller.edit("/backups/export-1");
    controller.ask();
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups/export-1"]);
    expect(controller.getState().phase).toEqual({ kind: "refused", refusal: REFUSAL });
    expect(settled).toEqual([{ kind: "refused", refusal: REFUSAL }]);
  });

  test("while a restore runs the phase is running, and a second confirm does not call again", async () => {
    let release: () => void = NOOP;
    const fake = fakePort();
    fake.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createRestoreController(fake.port);
    controller.edit("/backups/export-1");
    controller.ask();
    const first = controller.confirm();
    expect(controller.getState().phase).toEqual({ kind: "running" });
    controller.ask();
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups/export-1"]);
    release();
    await first;
    expect(controller.getState().phase.kind).toBe("restored");
  });
});

describe("cancel and the blocked cases call nothing", () => {
  test("cancel closes the dialog and the command is not called", () => {
    const fake = fakePort();
    const controller = createRestoreController(fake.port);
    controller.edit("/backups/export-1");
    controller.ask();
    controller.cancel();
    expect(controller.getState()).toMatchObject({ asking: false, phase: { kind: "idle" } });
    expect(fake.calls).toEqual([]);
  });

  test("a blank folder does not open the dialog, and confirm does not call", async () => {
    const fake = fakePort();
    const controller = createRestoreController(fake.port);
    controller.edit("   ");
    controller.ask();
    expect(controller.getState().asking).toBe(false);
    await controller.confirm();
    expect(fake.calls).toEqual([]);
    expect(controller.getState().phase).toEqual({ kind: "idle" });
  });

  test("a relative folder does not open the dialog, and confirm does not call", async () => {
    const fake = fakePort();
    const controller = createRestoreController(fake.port);
    controller.edit("backups/export-1");
    controller.ask();
    expect(controller.getState().asking).toBe(false);
    await controller.confirm();
    expect(fake.calls).toEqual([]);
    expect(controller.getState().phase).toEqual({ kind: "idle" });
  });

  test("a remote engine target blocks the dialog and the command", async () => {
    const fake = fakePort({ target: REMOTE });
    const controller = createRestoreController(fake.port);
    controller.edit("/backups/export-1");
    controller.ask();
    expect(controller.getState().asking).toBe(false);
    await controller.confirm();
    expect(fake.calls).toEqual([]);
  });

  test("an unknown engine target does not block: the shell default is local and the shell refuses remote", async () => {
    const fake = fakePort({ target: null });
    const controller = createRestoreController(fake.port);
    controller.edit("/backups/export-1");
    controller.ask();
    expect(controller.getState().asking).toBe(true);
    await controller.confirm();
    expect(fake.calls).toEqual(["/backups/export-1"]);
  });

  test("the engine target is read again when the dialog is asked, so a change to remote is seen", () => {
    const fake = fakePort({ target: LOCAL });
    const controller = createRestoreController(fake.port);
    controller.edit("/backups/export-1");
    fake.target = REMOTE;
    controller.ask();
    expect(controller.getState()).toMatchObject({ asking: false, target: REMOTE });
  });

  test("subscribers hear each change and stop after they unsubscribe", () => {
    const fake = fakePort();
    const controller = createRestoreController(fake.port);
    let heard = 0;
    const unsubscribe = controller.subscribe(() => {
      heard += 1;
    });
    controller.edit("/a");
    unsubscribe();
    controller.edit("/b");
    expect(heard).toBe(1);
    expect(controller.getState().path).toBe("/b");
  });
});

describe("restoreBlockOf orders the reasons", () => {
  const idle = { path: "/backups/export-1", target: LOCAL, phase: { kind: "idle" } } as const;

  test("a runnable state has no block", () => {
    expect(restoreBlockOf(idle)).toBeNull();
  });

  test("running is first, then remote, then blank", () => {
    expect(restoreBlockOf({ ...idle, phase: { kind: "running" } })).toBe("running");
    expect(restoreBlockOf({ ...idle, target: null, path: "" })).toBe("blank");
    expect(restoreBlockOf({ ...idle, target: REMOTE, path: "" })).toBe("remote");
    expect(restoreBlockOf({ ...idle, path: "  " })).toBe("blank");
  });

  test("a relative path is a block, and absolute POSIX, drive and UNC paths are not", () => {
    expect(restoreBlockOf({ ...idle, path: "backups/export-1" })).toBe("relative");
    expect(restoreBlockOf({ ...idle, path: "./export-1" })).toBe("relative");
    expect(restoreBlockOf({ ...idle, path: "  /backups/export-1  " })).toBeNull();
    expect(restoreBlockOf({ ...idle, path: "C:\\backups\\export-1" })).toBeNull();
    expect(restoreBlockOf({ ...idle, path: "\\\\server\\share" })).toBeNull();
    // 원격이 먼저다
    expect(restoreBlockOf({ ...idle, target: REMOTE, path: "backups" })).toBe("remote");
  });
});
