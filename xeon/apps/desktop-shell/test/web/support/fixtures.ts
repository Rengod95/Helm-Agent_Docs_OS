// web 부품 시험의 공용 대역: 수동 시계, 결정적 난수, 기록하는 로거, 임시 폴더.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Clock } from "@fresnel/contracts";

export interface ManualClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

/** 2026-11-08T00:00:00Z에서 시작하는 수동 시계 */
export function manualClock(start: number = Date.UTC(2026, 10, 8)): ManualClock {
  let now = start;
  return {
    now: () => now,
    set(ms) {
      now = ms;
    },
    advance(ms) {
      now += ms;
    },
  };
}

/** 호출마다 다른 바이트를 주는 결정적 난수. 시드가 같으면 같은 순서다 */
export function sequenceBytes(seed = 1): (size: number) => Uint8Array {
  let counter = seed * 7919;
  return (size) => {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      counter = (counter * 1_103_515_245 + 12_345) % 2_147_483_648;
      out[i] = (counter >>> 16) & 0xff;
    }
    return out;
  };
}

const created: string[] = [];

/** 시험이 쓰는 임시 폴더. 실제 홈을 건드리지 않는다. `cleanupTempDirs`가 지운다 */
export function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fresnel-web-test-"));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
