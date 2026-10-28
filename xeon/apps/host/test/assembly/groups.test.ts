import { expect, test } from "bun:test";
import { Bug, err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DriveHolderSettingsPort } from "@xeon/group-kit";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { holderSettings, type HostGroupsOptions } from "../../src/assembly/groups.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";
import type { SettingsStorePort, SettingsWriteFailure } from "../../src/types.ts";
import { partial } from "../fixtures/unsafe.ts";

// 구동 그룹 설정 쓰기 실패가 그룹 오류로 어떻게 옮겨지는지(통합 검토 L5 후속 N-1, N-4).

const THREAD: ThreadId = fixedIdFactory(700).next("thr");

function portOver(written: Result<void, SettingsWriteFailure>): DriveHolderSettingsPort {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const store: SettingsStorePort = partial<SettingsStorePort>({
    layers: () => [],
    write: () => Promise.resolve(written),
  });
  return holderSettings(
    partial<HostGroupsOptions>({
      catalog: built.catalog,
      settings: createSettingsEngine(built.catalog),
      store: () => store,
      heldThreads: () => [THREAD],
    }),
  );
}

test("a store that reports key_reused is a Bug carrying the failure, not an unwritable storage reason", async () => {
  const port = portOver(err({ kind: "key_reused", requestKey: "k1" }));
  const outcome = port.write("grp", "session", THREAD).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  const thrown = await outcome;
  expect(thrown).toBeInstanceOf(Bug);
  expect(thrown instanceof Bug && thrown.message).toBe(
    "groups.holder.write: the host builds a fresh request key per call",
  );
});

test("a scope the setting does not allow is an invalid_value request error; only the managed scope is locked", async () => {
  const port = portOver(ok(undefined));
  expect(await port.write("grp", "local", THREAD)).toEqual({
    ok: false,
    error: { kind: "unwritable", key: "x.primitives.activeDriveGroup", reason: "invalid_value" },
  });
  expect(await port.write("grp", "managed", null)).toEqual({
    ok: false,
    error: { kind: "locked", key: "x.primitives.activeDriveGroup" },
  });
});
