import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/hash.ts";
import { openTestStore, storeFaultAt, type StoreFaultPoint } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("blob under fault injection");

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
