import { defineManifest } from "@fresnel/contracts/extensions";
import { orchestrationManifest, type OrchestrationManifest } from "@fresnel/orchestration-sdk";

// L3.guide.spec §3.1 매니페스트. 내장 그룹이고 기본은 꺼짐이다([결정: 2026-11-13 사용자]). 개발 모드(`l3.authoring.devMode`)에서는 항상 켜진다.
// 이 그룹이 모델에게 내는 것은 스킬뿐이다(`skills/`). 도구·훅·drive는 없다. 켜짐 여부는 호스트가 스킬 루트를 싣는 데만 쓴다.

export const GUIDE_ORCHESTRATION_NAME = "guide";

export const guideManifest: OrchestrationManifest = orchestrationManifest(
  defineManifest({
    schemaVersion: 2,
    name: GUIDE_ORCHESTRATION_NAME,
    version: "0.1.0",
    displayName: "Fresnel Guide",
    description:
      "Skills that teach the model how Fresnel works: plugins, settings, assets, data and diagnostics",
    entry: "./src/index.ts",
    defaultEnabled: false,
    trust: { level: "builtin" },
    plugins: [{ layer: "L3", hooks: ["thread.shutdown"], requires: [], optional: [] }],
    orchestration: {},
  }),
);
