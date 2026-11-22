import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobStreamSource } from "@fresnel/contracts/records";
import { sha256Hex } from "../src/hash.ts";
import {
  storeFaultAt,
  openTestStore,
  type ArmedFault,
  type StoreFaultInjector,
  type StoreFaultPoint,
} from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("blob streamed under fault injection");

/** 두 조각으로 나눠 넘기는 원천. 조각 사이에서도 장애가 나야 하므로 조각마다 한 번 부른다 */
const STREAM: BlobStreamSource = {
  size: BYTES.byteLength,
  produce(sink) {
    const half = Math.floor(BYTES.byteLength / 2);
    sink(BYTES.subarray(0, half));
    sink(BYTES.subarray(half));
  },
};

/** 지점 하나에서 디스크 가득(ENOSPC)과 같은 모양의 fs 오류를 던진다 */
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

// 목적 파일은 rename 뒤에만 생기고(같은 해시가 이미 있으면 그 파일이 남는다), 행은 파일이 다 쓰인 뒤에만 생긴다.
// putBlobStream은 실패하면 임시 파일을 지우므로 남는 임시 파일은 없다
const CASES: readonly (readonly [StoreFaultPoint, boolean])[] = [
  ["blob_after_tmp_write", false],
  ["blob_after_fsync", false],
  ["blob_after_rename", true],
  ["blob_before_row", true],
];

describe("partial blob writes through putBlobStream", () => {
  for (const [point, destExists] of CASES) {
    test(`${point} leaves no temporary file, no row, and a destination only when it is complete`, async () => {
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

      expect(() => store.service.putBlobStream(STREAM, null)).toThrow(`fault:${point}`);
      expect(existsSync(dest)).toBe(destExists);
      if (destExists) expect(sha256Hex(readFileSync(dest))).toBe(sha);
      // 행은 파일이 다 쓰인 뒤에만 생긴다
      expect((await store.rowCounts())["sys_blobs"]).toBe(0);
      expect(store.root.read((tx) => tx.get("PRAGMA integrity_check"))).toEqual({
        ok: true,
        value: { integrity_check: "ok" },
      });
      // 실패한 쓰기는 임시 파일을 남기지 않는다
      expect(readdirSync(join(dirname(store.path), "blobs", "tmp"))).toEqual([]);
      // 행이 없으니 읽기는 블롭을 찾지 못한다(부분 파일을 참조하지 않는다)
      if (!destExists) {
        expect(store.service.readBlobByHash(sha)).toEqual({
          ok: false,
          error: { kind: "blob_missing", sha256: sha },
        });
      }

      fault.armed = false;
      const retried = store.service.putBlobStream(STREAM, null);
      expect(retried.ok).toBe(true);
      expect(sha256Hex(readFileSync(dest))).toBe(sha);
      expect((await store.rowCounts())["sys_blobs"]).toBe(1);
    });
  }
});

describe("ENOSPC while streaming a blob", () => {
  const ENOSPC_CASES: readonly (readonly [StoreFaultPoint, boolean])[] = [
    ["blob_after_tmp_write", false],
    ["blob_after_fsync", false],
    ["blob_after_rename", true],
  ];
  for (const [point, destExists] of ENOSPC_CASES) {
    test(`${point} reports disk_full, writes no row, and removes the temporary file`, async () => {
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

      expect(store.service.putBlobStream(STREAM, null)).toEqual({
        ok: false,
        error: { kind: "disk_full" },
      });
      expect(existsSync(dest)).toBe(destExists);
      if (destExists) expect(sha256Hex(readFileSync(dest))).toBe(sha);
      expect(await store.rowDigests()).toEqual(before);
      expect((await store.rowCounts())["sys_blobs"]).toBe(0);
      expect(readdirSync(join(dirname(store.path), "blobs", "tmp"))).toEqual([]);

      fault.armed = false;
      expect(store.service.putBlobStream(STREAM, null).ok).toBe(true);
      expect(sha256Hex(readFileSync(dest))).toBe(sha);
      expect((await store.rowCounts())["sys_blobs"]).toBe(1);
    });
  }
});
