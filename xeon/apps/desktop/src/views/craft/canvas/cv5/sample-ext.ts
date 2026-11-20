// cv5가 공통 표본에 덧붙이는 값. 공통 표본(`shared-sample.ts`, `shared-meta.ts`)은 다른 시안도 보므로 고치지 않고 여기에 둔다. 값은 표본이다.
// 1) 매니페스트 `description`(긴 설명, `ExtensionManifest.description`, 1024자까지). 노드 30개 장면의 플러그인처럼 설명이 없으면 상세 패널은 목적 한 문장만 보인다.
// 2) "한 자리에 여럿" 장면: 도구 실행 앞(`tool.call.before`)에 Hook이 1·5·20개 붙은 프로필. 루프 한 지점에 플러그인이 많이 붙을 때의 문법(버스와 순서)을 보이려는 표본이다.
//    베이스의 secret-guard가 1번이고 나머지는 이 프로필이 고른 순서대로 2번부터다. 수는 개발 빌드의 저장 키로 고른다(찍기 도구가 1·5·20을 정한다).
import type { MessageId } from "@fresnel/client/i18n";
import type { SharedPlugin } from "../shared-sample.ts";

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

/** 도구 실행 앞에 붙는 표본 Hook 열아홉(베이스의 secret-guard와 합쳐 스물) */
const GUARD_NAMES: readonly string[] = [
  "shell-guard",
  "path-guard",
  "net-allow",
  "rm-confirm",
  "push-guard",
  "pkg-guard",
  "env-guard",
  "sudo-block",
  "big-write",
  "binary-guard",
  "lockfile-guard",
  "migrate-guard",
  "prod-guard",
  "rate-limit",
  "audit-log",
  "tool-timer",
  "dry-run",
  "sandbox-check",
  "quota-guard",
];

export const ATTACH_PLUGINS: readonly SharedPlugin[] = GUARD_NAMES.map((name, i) => ({
  name,
  kind: "hook",
  point: "tools.before",
  decision: i % 3 === 1 ? "ask" : "block",
  code: true,
  instructions: [],
  skills: [],
  memory: [],
  settings: [],
  risk: "read",
  lastUsedMin: 12 + i * 37,
}));

/** 표본 Hook의 목적 한 문장(이름마다 따로 짓지 않는다) */
export const ATTACH_PURPOSE: MessageId = "desktop.craft.canvas.cv4.sample.guardPurpose";

const ATTACH_KEY = "fresnel.craft.canvas.cv4.attachN";

/** "한 자리에 여럿" 장면의 수(1, 5, 20). 저장된 값이 없으면 20 */
export function attachCount(): number {
  if (typeof localStorage === "undefined") return 20;
  const n = Number(localStorage.getItem(ATTACH_KEY));
  return n === 1 || n === 5 ? n : 20;
}

/** 그 장면에서 도구 실행 앞에 붙는 이름(베이스의 secret-guard 다음 차례). n은 secret-guard를 센 수다 */
export function attachNames(n: number): readonly string[] {
  return GUARD_NAMES.slice(0, Math.max(0, n - 1));
}
