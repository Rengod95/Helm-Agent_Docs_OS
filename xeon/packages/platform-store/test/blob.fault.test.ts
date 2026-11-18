import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/hash.ts";
import {
  openTestStore,
  storeFaultAt,
  type ArmedFault,
  type StoreFaultInjector,
  type StoreFaultPoint,
} from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("blob under fault injection");

/** 지점 하나에서 디스크 가득(ENOSPC)과 같은 모양의 fs 오류를 던진다. 실제 쓰기 실패가 disk_full로 옮겨지는지 본다 */
function enospcAt(point: StoreFaultPoint): ArmedFault<StoreFaultInjector> {
  const state: ArmedFault<StoreFaultInjector> = {
    armed: true,
    injector: {
      hit: (hit: StoreFaultPoint): void => {
        if (!state.armed || hit !== point) return;
        throw Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
          syscall: "write",
        });
      },
    },
  };
  return state;
}

const CASES: readonly (readonly [StoreFaultPoint, boolean])[] = [
  ["blob_after_tmp_write", false],
  ["blob_after_fsync", false],
  ["blob_after_rename", true],
  ["blob_before_row", true],
];

describe("partial blob writes", () => {
  for (const [point, destExists] of CASES) {
    test(`${point} leaves no destination file or a complete one`, async () => {
      const clock = manualClock();
      const fault = storeFaultAt(point);
      const store = own(
        await openTestStore({
          clock,
          ids: fixedIdFactory(clock),
          storeFaults: fault.injector,
        }),
      );
      const sha = sha256Hex(BYTES);
      const dest = join(dirname(store.path), "blobs", sha.slice(0, 2), sha.slice(2));

      expect(() => store.service.putBlob(BYTES, null)).toThrow(`fault:${point}`);
      expect(existsSync(dest)).toBe(destExists);
      if (destExists) expect(sha256Hex(readFileSync(dest))).toBe(sha);
      // 행은 파일이 다 쓰인 뒤에만 생긴다
      expect((await store.rowCounts())["sys_blobs"]).toBe(0);
      expect(store.root.read((tx) => tx.get("PRAGMA integrity_check"))).toEqual({
        ok: true,
        value: { integrity_check: "ok" },
      });
      // 남은 임시 파일은 GC(M2 이후)가 정리한다. 여기서는 목적 파일을 막지 않는지만 본다
      const leftovers = readdirSync(join(dirname(store.path), "blobs", "tmp"));
      expect(leftovers.length).toBeLessThanOrEqual(1);

      fault.armed = false;
      const retried = store.service.putBlob(BYTES, null);
      expect(retried.ok).toBe(true);
      expect(sha256Hex(readFileSync(dest))).toBe(sha);
      expect((await store.rowCounts())["sys_blobs"]).toBe(1);
    });
  }
});

describe("ENOSPC while writing a blob", () => {
  // 목적 파일은 rename 뒤에만 생기고 행은 그 뒤에야 생긴다. rename 앞의 실패는 임시 파일만 남긴다
  const CASES: readonly (readonly [StoreFaultPoint, boolean])[] = [
    ["blob_after_tmp_write", false],
    ["blob_after_fsync", false],
    ["blob_after_rename", true],
  ];
  for (const [point, destExists] of CASES) {
    test(`${point} reports disk_full and writes no row`, async () => {
      const clock = manualClock();
      const fault = enospcAt(point);
      const store = own(
        await openTestStore({
          clock,
          ids: fixedIdFactory(clock),
          storeFaults: fault.injector,
        }),
      );
      const sha = sha256Hex(BYTES);
      const dest = join(dirname(store.path), "blobs", sha.slice(0, 2), sha.slice(2));
      const before = await store.rowDigests();

      expect(store.service.putBlob(BYTES, null)).toEqual({
        ok: false,
        error: { kind: "disk_full" },
      });
      expect(existsSync(dest)).toBe(destExists);
      if (destExists) expect(sha256Hex(readFileSync(dest))).toBe(sha);
      expect(await store.rowDigests()).toEqual(before);
      expect((await store.rowCounts())["sys_blobs"]).toBe(0);
      expect(readdirSync(join(dirname(store.path), "blobs", "tmp")).length).toBeLessThanOrEqual(
        destExists ? 0 : 1,
      );
      // 행이 없으니 읽기는 블롭을 찾지 못한다(부분 파일을 참조하지 않는다)
      if (!destExists) {
        expect(store.service.readBlobByHash(sha)).toEqual({
          ok: false,
          error: { kind: "blob_missing", sha256: sha },
        });
      }

      fault.armed = false;
      expect(store.service.putBlob(BYTES, null).ok).toBe(true);
      expect(sha256Hex(readFileSync(dest))).toBe(sha);
      expect((await store.rowCounts())["sys_blobs"]).toBe(1);
    });
  }
});
