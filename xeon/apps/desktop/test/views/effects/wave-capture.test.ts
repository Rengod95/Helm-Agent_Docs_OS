import { afterEach, describe, expect, test } from "bun:test";
import {
  captureForWave,
  installWaveCapture,
  snapshotOf,
  waveLensAvailable,
} from "../../../src/views/effects/wave-capture.ts";

// 물결 렌즈가 읽을 창 그림(DP-166). 렌즈를 그릴지는 찍는 함수가 들어 있는지 한 곳에서 정한다

afterEach(() => {
  installWaveCapture(null);
});

const reply = { width: 2, height: 1, format: "bgra", bytes: new Uint8Array(8) };

describe("snapshotOf", () => {
  test("셸 답을 그림으로 좁힌다", () => {
    expect(snapshotOf(reply, 12)).toEqual({ width: 2, height: 1, bytes: reply.bytes, ms: 12 });
  });

  test("모양이 다르거나 바이트 수가 크기와 맞지 않으면 null", () => {
    expect(snapshotOf(null, 0)).toBe(null);
    expect(snapshotOf({ ...reply, format: "rgba" }, 0)).toBe(null);
    expect(snapshotOf({ ...reply, width: 3 }, 0)).toBe(null);
    expect(snapshotOf({ ...reply, width: 0, bytes: new Uint8Array(0) }, 0)).toBe(null);
    expect(snapshotOf({ ...reply, bytes: [0, 0, 0, 0, 0, 0, 0, 0] }, 0)).toBe(null);
  });
});

describe("captureForWave", () => {
  test("찍는 함수가 없으면(웹 탭) 렌즈가 없고 그림도 없다", async () => {
    expect(waveLensAvailable()).toBe(false);
    expect(await captureForWave(50)).toBe(null);
  });

  test("Electron 창이면 찍은 그림과 걸린 시간을 돌려준다", async () => {
    installWaveCapture(() => Promise.resolve(reply));
    let clock = 100;
    const now = (): number => {
      clock += 7;
      return clock;
    };
    expect(waveLensAvailable()).toBe(true);
    expect(await captureForWave(50, now)).toEqual({
      width: 2,
      height: 1,
      bytes: reply.bytes,
      ms: 7,
    });
  });

  test("한도 안에 오지 않거나 실패하면 null(굴절 없이 색 물결)", async () => {
    installWaveCapture(() => new Promise(() => {}));
    expect(await captureForWave(5)).toBe(null);
    installWaveCapture(() => Promise.reject(new Error("capture-failed")));
    expect(await captureForWave(50)).toBe(null);
  });
});
