import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { toggleReasonOf, unmetToggleOf } from "../../src/views/workbench/toggle-outcome.ts";

// 켜기·끄기 결과 판정(F9). 설정은 저장됐어도 목록이 목표 값에 닿지 못한 대기 항목만 골라 사유 코드를 붙인다.

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isOrchestration: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "disabled",
    plugins: [
      { registrationId: `${name}#root`, layer: "L2", status: "disabled", inOrchestration: false },
    ],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...over,
  };
}

const CONFIG_REQUIRED = {
  severity: "error",
  code: "config_required",
  message: "review requires a setting",
} as const;

describe("unmet toggles after the list settles", () => {
  test("an enable that did not reach the list is unmet, with the last diagnostic code", () => {
    const entries = [entry("review", { diagnostics: [CONFIG_REQUIRED] })];
    expect(unmetToggleOf(entries, { review: true })).toEqual([
      { name: "review", target: true, code: "config_required" },
    ]);
  });

  test("a toggle that reached its target is not unmet, and a missing extension is unmet without a code", () => {
    expect(unmetToggleOf([entry("web", { status: "enabled" })], { web: true })).toEqual([]);
    expect(unmetToggleOf([entry("web", { status: "enabled" })], { web: false })).toEqual([
      { name: "web", target: false, code: null },
    ]);
    expect(unmetToggleOf([], { gone: true })).toEqual([{ name: "gone", target: true, code: null }]);
  });

  test("an enabling extension counts as on, so an enable on its way is not unmet", () => {
    expect(unmetToggleOf([entry("web", { status: "enabling" })], { web: true })).toEqual([]);
  });
});

describe("the reason text", () => {
  test("a known code gets its sentence, a trust code the trust sentence, and an unknown code is shown", () => {
    expect(toggleReasonOf(null)).toBe("사유가 기록되지 않았어요");
    expect(toggleReasonOf("config_required")).toBe(
      "필수 설정이 비어 있어요. 채운 뒤 다시 켜 주세요",
    );
    expect(toggleReasonOf("trust_denied")).toBe("신뢰하지 않은 플러그인이라 실을 수 없어요");
    expect(toggleReasonOf("capability_missing")).toBe("사유: capability_missing");
  });
});
