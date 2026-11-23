import { describe, expect, test } from "bun:test";
import { catalogOf } from "@fresnel/client/i18n";

// 플러그인 상세 탭의 한국어 글(AGE-77 S-09 다): 설정 설명은 번역이 있어야 하고, 상태 탭의 "Turn"은 용어 `turn`의 한국어 "턴"이다.

const PLUGIN_STATE_KEYS = [
  "desktop.workbench.metrics.plugin.empty",
  "desktop.workbench.metrics.plugin.unused",
  "desktop.workbench.metrics.plugin.range",
  "desktop.workbench.metrics.plugin.note",
] as const;

describe("plugin detail copy", () => {
  test("the isolation setting help has a Korean text and an English text that is the fallback", () => {
    const ko = catalogOf("ko")["settings.ext.isolation.help"];
    const en = catalogOf("en")["settings.ext.isolation.help"];
    expect(en).toBe(
      "none = allow running inside the engine. process = run in its own plugin process (default).",
    );
    expect(ko).toBe(
      "격리 안 함은 엔진 안에서 실행하고, 별도 프로세스는 플러그인 전용 프로세스에서 실행해요(기본).",
    );
  });

  test("the plugin state tab says 턴 in Korean, never the English Turn", () => {
    const ko = catalogOf("ko");
    for (const key of PLUGIN_STATE_KEYS) {
      const text = ko[key] ?? "";
      expect(text.includes("Turn")).toBe(false);
      expect(text.includes("턴")).toBe(true);
    }
    expect(ko["desktop.workbench.metrics.plugin.unused"]).toBe(
      "최근 턴 {turns}개에서 이 플러그인이 한 일이 기록에 없어요.",
    );
  });
});
