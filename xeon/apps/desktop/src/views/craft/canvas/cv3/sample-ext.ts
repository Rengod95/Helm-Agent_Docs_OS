// cv3가 공통 표본에 덧붙이는 값: 매니페스트 `description`(긴 설명, `ExtensionManifest.description`, 1024자까지).
// 공통 표본(`shared-sample.ts`, `shared-meta.ts`)은 다른 시안도 보므로 고치지 않고 여기에 둔다. 값은 표본이다.
// 노드 30개 장면의 플러그인처럼 설명이 없으면 상세 패널은 목적 한 문장만 보인다.
import type { MessageId } from "@fresnel/client/i18n";

const DESCRIPTION: Readonly<Record<string, MessageId>> = {
  "house-style": "desktop.craft.canvas.cv3.sample.desc.houseStyle",
  "repo-skills": "desktop.craft.canvas.cv3.sample.desc.repoSkills",
  memory: "desktop.craft.canvas.cv3.sample.desc.memory",
  "secret-guard": "desktop.craft.canvas.cv3.sample.desc.secretGuard",
  "lint-on-edit": "desktop.craft.canvas.cv3.sample.desc.lintOnEdit",
  "cost-cap": "desktop.craft.canvas.cv3.sample.desc.costCap",
  helm: "desktop.craft.canvas.cv3.sample.desc.helm",
  verifier: "desktop.craft.canvas.cv3.sample.desc.verifier",
  "github-mcp": "desktop.craft.canvas.cv3.sample.desc.github",
  "commit-msg": "desktop.craft.canvas.cv3.sample.desc.commitMsg",
  "web-research": "desktop.craft.canvas.cv3.sample.desc.webResearch",
  changelog: "desktop.craft.canvas.cv3.sample.desc.changelog",
  "test-runner": "desktop.craft.canvas.cv3.sample.desc.testRunner",
};

/** 매니페스트 `description`. 없으면 null */
export function descriptionOf(name: string): MessageId | null {
  return DESCRIPTION[name] ?? null;
}
