import { describe, expect, test } from "bun:test";
import {
  idPattern,
  isId,
  localIdPattern,
  isLocalId,
  ULID_PATTERN,
  type IdPrefix,
  type LocalIdPrefix,
} from "@xeon/contracts/conversation";
import { Bug } from "@xeon/contracts";
import { createIdFactory, createLocalIdFactory } from "../src/ids.ts";
import { systemRandom } from "../src/time/random.ts";
import { manualClock, seededRandom } from "./support/clock.ts";

const PREFIXES: readonly IdPrefix[] = ["thr", "trn", "stp", "itm", "prt", "evt", "efx", "ckp"];

describe("createIdFactory", () => {
  test("접두와 단조 증가: 같은 시각에서 연속 발급한 ID가 사전순으로 증가하고 idPattern을 통과한다", () => {
    const clock = manualClock();
    const ids = createIdFactory(clock, seededRandom(1));
    const issued: string[] = [];
    for (let i = 0; i < 500; i += 1) issued.push(ids.next("evt"));
    for (const id of issued) expect(new RegExp(idPattern("evt")).test(id)).toBe(true);
    const sorted = issued.toSorted();
    expect(issued).toEqual(sorted);
    expect(new Set(issued).size).toBe(issued.length);
  });

  test("8종 접두 모두 발급되고 isId를 통과한다", () => {
    const ids = createIdFactory(manualClock(), seededRandom(2));
    for (const prefix of PREFIXES) {
      const id = ids.next(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(id.length).toBe(30);
      expect(isId(prefix, id)).toBe(true);
    }
  });

  test("접두가 달라도 같은 발급기 안에서는 ULID 부분이 단조 증가한다", () => {
    const ids = createIdFactory(manualClock(), seededRandom(3));
    const ulids = PREFIXES.map((prefix) => ids.next(prefix).slice(4));
    expect(ulids.toSorted()).toEqual(ulids);
  });

  test("시각이 앞서면 앞선 ID보다 크다. 시각 부분은 epoch ms의 Crockford base32다", async () => {
    const clock = manualClock(1_767_571_200_000);
    const ids = createIdFactory(clock, seededRandom(4));
    const a = ids.next("thr");
    await clock.advance(1);
    const b = ids.next("thr");
    expect(b > a).toBe(true);
    // 1767571200000 = 0x19_..: 10자 인코딩을 직접 디코딩해 확인한다
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const decoded = a
      .slice(4, 14)
      .split("")
      .reduce((acc, ch) => acc * 32 + alphabet.indexOf(ch), 0);
    expect(decoded).toBe(1_767_571_200_000);
  });

  test("시계가 뒤로 가도 단조 증가한다", async () => {
    const clock = manualClock();
    const ids = createIdFactory(clock, seededRandom(5));
    const a = ids.next("itm");
    await clock.set(clock.now() - 60_000);
    const b = ids.next("itm");
    expect(b > a).toBe(true);
  });

  test("난수 부분이 80비트 끝까지 차면 시각을 1ms 올려 계속 단조 증가한다", () => {
    const clock = manualClock();
    // 난수가 항상 최대(31)인 공급원: 첫 ID의 난수 부분은 ZZZZ... 이다
    const ids = createIdFactory(clock, () => 0.999_999);
    const a = ids.next("stp");
    const b = ids.next("stp");
    expect(a.slice(14)).toBe("Z".repeat(16));
    expect(b > a).toBe(true);
    expect(isId("stp", b)).toBe(true);
  });

  test("같은 시각·같은 난수열이면 같은 ID열이다(D0)", () => {
    const a = createIdFactory(manualClock(), seededRandom(7));
    const b = createIdFactory(manualClock(), seededRandom(7));
    expect([a.next("thr"), a.next("trn")]).toEqual([b.next("thr"), b.next("trn")]);
  });

  test("운영 난수로도 ULID 패턴을 지킨다", () => {
    const ids = createIdFactory(manualClock(), systemRandom());
    for (let i = 0; i < 100; i += 1) {
      expect(new RegExp(`^thr_${ULID_PATTERN}$`).test(ids.next("thr"))).toBe(true);
    }
  });

  test("범위 밖 난수나 시계는 Bug", () => {
    expect(() => createIdFactory(manualClock(), () => 1).next("thr")).toThrow(Bug);
    expect(() => createIdFactory(manualClock(), () => Number.NaN).next("thr")).toThrow(Bug);
    const badClock = { now: () => 2 ** 48 };
    expect(() => createIdFactory(badClock, seededRandom(1)).next("thr")).toThrow(Bug);
    const fractional = { now: () => 1.5 };
    expect(() => createIdFactory(fractional, seededRandom(1)).next("thr")).toThrow(Bug);
  });
});

describe("createLocalIdFactory", () => {
  test("sls·bgp ID가 localIdPattern을 통과한다", () => {
    const ids = createLocalIdFactory(manualClock(), seededRandom(11));
    const prefixes: readonly LocalIdPrefix[] = ["sls", "bgp", "art", "lop", "knl"];
    for (const prefix of prefixes) {
      const id = ids.next(prefix);
      expect(new RegExp(localIdPattern(prefix)).test(id)).toBe(true);
      expect(isLocalId(prefix, id)).toBe(true);
    }
  });

  test("같은 시각에서 단조 증가한다", () => {
    const ids = createLocalIdFactory(manualClock(), seededRandom(12));
    const issued = Array.from({ length: 100 }, () => ids.next("sls"));
    expect(issued.toSorted()).toEqual(issued);
  });
});
