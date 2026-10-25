import { describe, expect, test } from "bun:test";
import { binaryViewOf } from "../../src/settings/index.ts";

// platform-os BinaryCheckReport의 JSON 모양 그대로
const REPORT = {
  platform: "linux",
  ready: false,
  blocking: ["sops"],
  degraded: ["socat"],
  items: [
    {
      name: "socat",
      need: "optional",
      usedBy: "샌드박스 네트워크 프록시",
      impact: "샌드박스를 쓸 수 없다",
      status: { kind: "missing", hint: "apt install socat" },
    },
    {
      name: "rg",
      need: "required",
      usedBy: "검색",
      impact: "검색 불가",
      status: { kind: "ok", path: "/usr/bin/rg", version: "14.1.0", source: "path" },
    },
    {
      name: "sops",
      need: "required",
      usedBy: "비밀 저장소",
      impact: "키를 저장할 수 없다",
      status: { kind: "too_old", found: "3.7.0", required: "3.8.0" },
    },
    {
      name: "age",
      need: "required",
      usedBy: "비밀 저장소",
      impact: "복호화 불가",
      status: { kind: "unusable", reason: "not_executable" },
    },
  ],
};

describe("binaryViewOf", () => {
  test("rows put required before optional and unusable before usable, with a note per status kind", () => {
    const view = binaryViewOf(REPORT);
    expect(view?.platform).toBe("linux");
    expect(view?.ready).toBe(false);
    expect(view?.rows.map((r) => [r.name, r.need, r.ok, r.note])).toEqual([
      ["age", "required", false, "쓸 수 없음 (not_executable)"],
      ["sops", "required", false, "3.7.0 (필요 3.8.0 이상)"],
      ["rg", "required", true, "14.1.0"],
      ["socat", "optional", false, "apt install socat"],
    ]);
  });

  test("anything that is not a report is no view", () => {
    expect(binaryViewOf(null)).toBeNull();
    expect(binaryViewOf({ platform: "linux" })).toBeNull();
    expect(binaryViewOf({ ...REPORT, items: [{ name: "x" }] })).toBeNull();
  });
});
