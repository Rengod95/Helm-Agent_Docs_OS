import { describe, expect, test } from "bun:test";
import type { HostBinaryReport } from "@xeon/contracts/wire";
import { binaryViewOf } from "../../src/settings/index.ts";

// host.status의 binaries(HostBinaryReport): platform-os BinaryCheckReport에서 실행 파일 경로만 뺀 모양
const REPORT: HostBinaryReport = {
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
      status: { kind: "ok", version: "14.1.0", source: "system" },
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

  test("a result without binaries (old host, nothing asked) is no view", () => {
    expect(binaryViewOf(undefined)).toBeNull();
  });

  test("a ready report with only usable tools lists them all as usable", () => {
    const view = binaryViewOf({
      platform: "darwin",
      ready: true,
      blocking: [],
      degraded: [],
      items: [
        {
          name: "rg",
          need: "required",
          usedBy: "검색",
          impact: "검색 불가",
          status: { kind: "ok", version: "14.1.0", source: "bundled" },
        },
      ],
    });
    expect(view).toEqual({
      platform: "darwin",
      ready: true,
      rows: [
        {
          name: "rg",
          need: "required",
          usedBy: "검색",
          ok: true,
          note: "14.1.0",
          impact: "검색 불가",
        },
      ],
    });
  });
});
