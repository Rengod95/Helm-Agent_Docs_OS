import { describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { mapLimited } from "../../../src/views/workbench/load-details.ts";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("mapLimited: 동시에 도는 수의 상한과 결과 모양", () => {
  test("결과는 입력 순서대로 나오고 값은 그대로다", async () => {
    const got = await mapLimited([3, 1, 2], 2, async (n) => {
      await tick();
      return n * 10;
    });
    expect(got.map((slot) => slot.item)).toEqual([3, 1, 2]);
    expect(got.map((slot) => slot.result)).toEqual([
      { ok: true, value: 30 },
      { ok: true, value: 10 },
      { ok: true, value: 20 },
    ]);
  });

  test("동시에 도는 읽기는 상한을 넘지 않고, 상한까지는 채운다", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapLimited(items, 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(3);
    expect(inFlight).toBe(0);
  });

  test("상한이 항목 수보다 크면 항목 수만큼만 돈다", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimited(["a", "b"], 8, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(2);
  });

  test("거부한 항목은 threw 값이 되고, 나머지 항목은 끝까지 간다", async () => {
    const boom = new Error("boom");
    const got = await mapLimited(["a", "b", "c"], 2, async (name) => {
      await tick();
      if (name === "b") throw boom;
      return name.toUpperCase();
    });
    expect(got.map((slot) => slot.item)).toEqual(["a", "b", "c"]);
    expect(got.map((slot) => slot.result)).toEqual([
      { ok: true, value: "A" },
      { ok: false, error: { kind: "threw", cause: boom } },
      { ok: true, value: "C" },
    ]);
  });

  test("빈 목록은 빈 결과다", async () => {
    expect(await mapLimited([], 4, async () => 1)).toEqual([]);
  });

  test("상한이 1보다 작으면 호출하는 쪽의 실수이므로 Bug다", async () => {
    const reason = await mapLimited([1], 0, async (n) => n).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(reason).toBeInstanceOf(Bug);
  });
});
