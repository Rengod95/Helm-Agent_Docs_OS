import { describe, expect, test } from "bun:test";
import {
  locationTextOf,
  middleEllipsisOf,
  revealablePathOf,
} from "../src/views/workbench/location-text.ts";

// 설치 위치 칸(AGE-77 S-09 라): 가운데 말줄임과 "폴더에서 보기"를 달 수 있는 경로인지.

describe("middleEllipsisOf", () => {
  test("keeps a text that already fits", () => {
    expect(middleEllipsisOf("short", 48)).toBe("short");
    expect(middleEllipsisOf("abcdefghij", 10)).toBe("abcdefghij");
  });

  test("keeps the head and the tail and joins them with one ellipsis", () => {
    // 상한 12: 말줄임 한 자를 뺀 11자를 앞 6자와 뒤 5자로 나눈다
    expect(middleEllipsisOf("0123456789ABCDEFGHIJ", 12)).toBe("012345…FGHIJ");
    expect(middleEllipsisOf("0123456789ABCDEFGHIJ", 12)).toHaveLength(12);
  });

  test("counts characters, not UTF-16 units, so Korean text is not cut in half", () => {
    expect(middleEllipsisOf("가나다라마바사아", 5)).toBe("가나…사아");
  });
});

describe("revealablePathOf", () => {
  test("an absolute path can be shown in the folder", () => {
    expect(revealablePathOf("/Users/u/Library/Application Support/fresnel/x")).toBe(
      "/Users/u/Library/Application Support/fresnel/x",
    );
  });

  test("a source label such as builtin is not a path", () => {
    expect(revealablePathOf("builtin")).toBeNull();
    expect(revealablePathOf("")).toBeNull();
  });
});

describe("locationTextOf", () => {
  const LABEL = "Fresnel 데이터 폴더";

  test("a path under the data folder reads as the label and the path after it", () => {
    expect(
      locationTextOf(
        "/private/tmp/h/fresnel/data/config/extensions/helm/tree",
        "/private/tmp/h/fresnel/data",
        LABEL,
      ),
    ).toBe("Fresnel 데이터 폴더/config/extensions/helm/tree");
  });

  test("the data folder wins over the home when it lies under the home", () => {
    expect(
      locationTextOf(
        "/Users/u/Library/Application Support/fresnel/config/x",
        "/Users/u/Library/Application Support/fresnel",
        LABEL,
      ),
    ).toBe("Fresnel 데이터 폴더/config/x");
  });

  test("without a known data folder the home is shortened and other paths stay as they are", () => {
    expect(locationTextOf("/Users/u/.fresnel/extensions/x", null, LABEL)).toBe(
      "~/.fresnel/extensions/x",
    );
    expect(locationTextOf("/opt/x/y", null, LABEL)).toBe("/opt/x/y");
  });

  test("the data folder is matched by whole segments, so a sibling with a longer name is not cut", () => {
    expect(locationTextOf("/a/data-old/x", "/a/data", LABEL)).toBe("/a/data-old/x");
  });

  test("a trailing slash on the data folder changes nothing", () => {
    expect(locationTextOf("/a/data/x", "/a/data/", LABEL)).toBe("Fresnel 데이터 폴더/x");
  });
});
