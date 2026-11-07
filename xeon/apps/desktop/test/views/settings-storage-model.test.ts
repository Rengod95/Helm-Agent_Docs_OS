import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { EngineTarget, PreviousRemoved, StorageUsage } from "../../src/transport/ipc.ts";
import type { StorageCommands, StorageFailure } from "../../src/views/commands.ts";
import {
  createStorageController,
  previousLabelOf,
  previousTimeOf,
  sharedStorageController,
  storageRowsOf,
} from "../../src/views/pages/settings/settings-storage-model.ts";
import { PREVIOUS_REMOVED, STORAGE_USAGE } from "../transport/fake-ipc.ts";

// 저장 공간 구역의 컨트롤러와 사본 이름 읽기. 화면이 부르는 입구(load, ask, cancel, confirm)로 흐름을 본다.
// 지우기는 고른 사본의 이름으로 `removePrevious`를 정확히 한 번 부르고, 지운 뒤에는 사용량을 다시 읽는다.

const LOCAL: EngineTarget = { kind: "local" };
const REMOTE: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
const NAME = "20261104T000000000Z";
const FAILURE: StorageFailure = { kind: "environment", message: "디스크 오류", fix: null };

interface FakeStorage {
  readonly port: Pick<StorageCommands, "engineTarget" | "usage" | "removePrevious">;
  /** `usage`를 부른 횟수 */
  usageCalls: number;
  /** `removePrevious`가 받은 이름, 호출 순서 */
  readonly removed: string[];
  target: EngineTarget | null;
  usageReply: Result<StorageUsage, StorageFailure>;
  removeReply: Result<PreviousRemoved, StorageFailure>;
}

function fakeStorage(
  over: Partial<Pick<FakeStorage, "target" | "usageReply" | "removeReply">> = {},
): FakeStorage {
  const fake: FakeStorage = {
    port: {
      engineTarget: () => fake.target,
      usage: async () => {
        fake.usageCalls += 1;
        return fake.usageReply;
      },
      removePrevious: async (name) => {
        fake.removed.push(name);
        return fake.removeReply;
      },
    },
    usageCalls: 0,
    removed: [],
    target: LOCAL,
    usageReply: ok(STORAGE_USAGE),
    removeReply: ok(PREVIOUS_REMOVED),
    ...over,
  };
  return fake;
}

describe("usage maps to the rows in view order", () => {
  test("each byte count lands on its row", () => {
    expect(storageRowsOf(STORAGE_USAGE)).toEqual([
      { key: "conversations", bytes: 4 },
      { key: "attachments", bytes: 2 },
      { key: "measurements", bytes: 0 },
      { key: "logs", bytes: 12 },
      { key: "restorePrevious", bytes: 1 },
    ]);
  });
});

describe("a copy name reads as its UTC time, or stays as it is", () => {
  test("the folder name parses to the UTC instant it names, with milliseconds", () => {
    expect(previousTimeOf(NAME)?.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(previousTimeOf("20261107T093015123Z")?.toISOString()).toBe("2026-11-07T09:30:15.123Z");
  });

  test("a name of another shape, or a date that does not exist, does not parse", () => {
    expect(previousTimeOf("backup-1")).toBeNull();
    expect(previousTimeOf("20261104T000000000")).toBeNull();
    expect(previousTimeOf("2026110T000000000Z")).toBeNull();
    expect(previousTimeOf("20261332T000000000Z")).toBeNull();
    expect(previousTimeOf("20260230T000000000Z")).toBeNull();
  });

  test("a readable name shows the year, and an unreadable one shows the raw name", () => {
    expect(previousLabelOf(NAME, "en-US")).toContain("2026");
    expect(previousLabelOf(NAME, "en-US")).not.toBe(NAME);
    expect(previousLabelOf("backup-1", "en-US")).toBe("backup-1");
  });
});

describe("loading the usage", () => {
  test("a local engine reads the usage once and shows it as ready", async () => {
    const fake = fakeStorage();
    const controller = createStorageController(fake.port);
    await controller.load();
    expect(fake.usageCalls).toBe(1);
    expect(controller.getState().load).toEqual({ kind: "ready", usage: STORAGE_USAGE });
  });

  test("a remote engine does not read the usage and shows the remote state", async () => {
    const fake = fakeStorage({ target: REMOTE });
    const controller = createStorageController(fake.port);
    await controller.load();
    expect(fake.usageCalls).toBe(0);
    expect(controller.getState().load).toEqual({ kind: "remote" });
  });

  test("a failed read is kept as the failed state", async () => {
    const fake = fakeStorage({ usageReply: err(FAILURE) });
    const controller = createStorageController(fake.port);
    await controller.load();
    expect(controller.getState().load).toEqual({ kind: "failed", failure: FAILURE });
  });
});

describe("ask and cancel", () => {
  test("a name that is not in the copy list does not open the dialog", async () => {
    const fake = fakeStorage();
    const controller = createStorageController(fake.port);
    await controller.load();
    controller.ask("not-a-copy");
    expect(controller.getState().removing).toBeNull();
  });

  test("asking before the usage is read does not open the dialog", () => {
    const fake = fakeStorage();
    const controller = createStorageController(fake.port);
    controller.ask(NAME);
    expect(controller.getState().removing).toBeNull();
    expect(fake.removed).toEqual([]);
  });

  test("a copy in the list opens the dialog, and cancel closes it without a call", async () => {
    const fake = fakeStorage();
    const controller = createStorageController(fake.port);
    await controller.load();
    controller.ask(NAME);
    expect(controller.getState().removing).toBe(NAME);
    controller.cancel();
    expect(controller.getState().removing).toBeNull();
    expect(fake.removed).toEqual([]);
  });
});

describe("the remove flow calls removePrevious with the exact name, then reloads", () => {
  test("confirm removes the asked copy once, reports it, and reads the usage again", async () => {
    const fake = fakeStorage();
    const removed: PreviousRemoved[] = [];
    const controller = createStorageController(fake.port, {
      removed: (value) => {
        removed.push(value);
      },
    });
    await controller.load();
    controller.ask(NAME);
    await controller.confirm();
    expect(fake.removed).toEqual([NAME]);
    expect(removed).toEqual([PREVIOUS_REMOVED]);
    expect(fake.usageCalls).toBe(2);
    expect(controller.getState()).toMatchObject({
      removing: null,
      removeBusy: false,
      removeFailure: null,
    });
  });

  test("a failed removal keeps the failure, closes the dialog, and does not reload", async () => {
    const fake = fakeStorage({ removeReply: err(FAILURE) });
    const controller = createStorageController(fake.port);
    await controller.load();
    controller.ask(NAME);
    await controller.confirm();
    expect(fake.removed).toEqual([NAME]);
    expect(fake.usageCalls).toBe(1);
    expect(controller.getState()).toMatchObject({
      removing: null,
      removeBusy: false,
      removeFailure: FAILURE,
    });
  });

  test("confirm with no dialog open does not call removePrevious", async () => {
    const fake = fakeStorage();
    const controller = createStorageController(fake.port);
    await controller.load();
    await controller.confirm();
    expect(fake.removed).toEqual([]);
  });
});

describe("the shared controller survives a remount", () => {
  test("the same port gives the same controller, so the loaded usage is still there", async () => {
    const fake = fakeStorage();
    const first = sharedStorageController(fake.port);
    await first.load();
    const second = sharedStorageController(fake.port);
    expect(second).toBe(first);
    expect(second.getState().load).toEqual({ kind: "ready", usage: STORAGE_USAGE });
    expect(sharedStorageController(fakeStorage().port)).not.toBe(first);
  });
});
