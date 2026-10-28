import { Type } from "typebox";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
} from "@xeon/contracts/settings";

// L2.knowledge.spec §6. 키 문법 `l2.knowledge.<이름>`. 쓰기 승인·스캔·증거 출처 키와 `skills.paths`는 관리·사용자 범위만
// 허용한다. 저장소에 커밋되는 프로젝트 파일로 승인을 끄거나 스킬 경로를 더하는 길을 막기 위해서다.

const FILE_AND_SESSION = ["managed", "user", "project", "local", "session"] as const;
const FILE_ONLY = ["managed", "user", "project", "local"] as const;
const OWNER_ONLY = ["managed", "user"] as const;

const knowledgeSettings = defineSettings("l2.knowledge", {
  "skills.enabled": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: FILE_AND_SESSION,
    ui: { tab: "tools", widget: "toggle", order: 300, label: "스킬 사용" },
    since: "0.1.0",
  },
  "skills.projectSkills": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "restart",
    allowedScopes: OWNER_ONLY,
    ui: { tab: "tools", widget: "toggle", order: 301, label: "프로젝트 스킬 사용" },
    since: "0.1.0",
  },
  "skills.paths": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
    default: [],
    runtimeChange: "restart",
    allowedScopes: OWNER_ONLY,
    ui: {
      tab: "tools",
      widget: "list",
      order: 302,
      label: "추가 스킬 경로",
      help: "절대 경로. 디렉터리나 .md 파일. 읽기 전용으로 싣는다",
    },
    since: "0.1.0",
  },
  "skills.indexBudgetChars": {
    type: Type.Integer(),
    default: 8000,
    range: { min: 1000, max: 50000 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_ONLY,
    ui: {
      tab: "tools",
      widget: "number",
      order: 303,
      label: "스킬 인덱스 예산",
      unit: "자",
    },
    since: "0.1.0",
  },
  "skills.indexDescriptionChars": {
    type: Type.Integer(),
    default: 160,
    range: { min: 40, max: 1024 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_ONLY,
    ui: {
      tab: "tools",
      widget: "number",
      order: 304,
      label: "인덱스 설명 길이",
      unit: "자",
    },
    since: "0.1.0",
  },
  "memory.enabled": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: FILE_AND_SESSION,
    ui: { tab: "sessions", widget: "toggle", order: 310, label: "메모리 사용" },
    since: "0.1.0",
  },
  "memory.userLimitChars": {
    type: Type.Integer(),
    default: 1375,
    range: { min: 200, max: 20000 },
    runtimeChange: "nextTurn",
    allowedScopes: OWNER_ONLY,
    ui: { tab: "sessions", widget: "number", order: 311, label: "사용자 정보 한도", unit: "자" },
    since: "0.1.0",
  },
  "memory.envLimitChars": {
    type: Type.Integer(),
    default: 2200,
    range: { min: 200, max: 20000 },
    runtimeChange: "nextTurn",
    allowedScopes: OWNER_ONLY,
    ui: { tab: "sessions", widget: "number", order: 312, label: "환경 사실 한도", unit: "자" },
    since: "0.1.0",
  },
  "write.approval": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: OWNER_ONLY,
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 320,
      label: "에이전트 쓰기 승인",
      help: "끄면 비파괴 연산은 승인 없이 적용한다. 백그라운드 포크의 파괴적 연산은 항상 대기열이다",
    },
    since: "0.1.0",
  },
  "write.scan": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: OWNER_ONLY,
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 321,
      label: "스킬 쓰기 위협 검사",
      help: "메모리 쓰기 검사는 이 설정과 무관하게 항상 한다",
    },
    since: "0.1.0",
  },
  "write.proposalExpiryDays": {
    type: Type.Integer(),
    default: 14,
    range: { min: 1, max: 365 },
    runtimeChange: "live",
    allowedScopes: OWNER_ONLY,
    ui: { tab: "tools", widget: "number", order: 322, label: "제안 만료", unit: "일" },
    since: "0.1.0",
  },
  "write.trustedEvidenceSources": {
    type: Type.Array(Type.String({ minLength: 3, maxLength: 64 }), { maxItems: 32 }),
    default: [],
    runtimeChange: "restart",
    allowedScopes: OWNER_ONLY,
    ui: {
      tab: "advanced",
      widget: "list",
      order: 323,
      label: "신뢰하는 승인 증거 출처",
      help: "<확장 이름>.<대기열 이름> 형식",
    },
    since: "0.1.0",
  },
  "search.enabled": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: FILE_AND_SESSION,
    ui: { tab: "sessions", widget: "toggle", order: 330, label: "지식 검색 사용" },
    since: "0.1.0",
  },
  "search.defaultScope": {
    type: Type.String(),
    default: "all",
    range: { enum: ["all", "project"] },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_AND_SESSION,
    ui: { tab: "sessions", widget: "select", order: 331, label: "검색 기본 범위" },
    since: "0.1.0",
  },
  "search.includeHiddenDefault": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: OWNER_ONLY,
    ui: { tab: "sessions", widget: "toggle", order: 332, label: "숨긴 세션 기본 포함" },
    since: "0.1.0",
  },
  "search.likeScanLimit": {
    type: Type.Integer(),
    default: 20000,
    range: { min: 1000, max: 1000000 },
    runtimeChange: "live",
    allowedScopes: OWNER_ONLY,
    ui: { tab: "advanced", widget: "number", order: 333, label: "짧은 질의 탐색 한도", unit: "개" },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const KNOWLEDGE_SETTING_DEFS: readonly SettingDef[] = Object.values(knowledgeSettings.defs);

export interface KnowledgeSettings {
  readonly skills: {
    readonly enabled: boolean;
    readonly projectSkills: boolean;
    readonly paths: readonly string[];
    readonly indexBudgetChars: number;
    readonly indexDescriptionChars: number;
  };
  readonly memory: {
    readonly enabled: boolean;
    readonly userLimitChars: number;
    readonly envLimitChars: number;
  };
  readonly write: {
    readonly approval: boolean;
    readonly scan: boolean;
    readonly proposalExpiryDays: number;
    readonly trustedEvidenceSources: readonly string[];
  };
  readonly search: {
    readonly enabled: boolean;
    readonly defaultScope: "all" | "project";
    readonly includeHiddenDefault: boolean;
    readonly likeScanLimit: number;
  };
}

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  skills: {
    enabled: true,
    projectSkills: true,
    paths: [],
    indexBudgetChars: 8000,
    indexDescriptionChars: 160,
  },
  memory: { enabled: true, userLimitChars: 1375, envLimitChars: 2200 },
  write: { approval: true, scan: true, proposalExpiryDays: 14, trustedEvidenceSources: [] },
  search: { enabled: true, defaultScope: "all", includeHiddenDefault: false, likeScanLimit: 20000 },
};

/**
 * 조립 루트가 선언하는 신뢰 증거 출처를 설정 값에 합친다(M3-REQ-104, D-11). 내장 그룹이 자기 대기열의 사람 승인을 증거로
 * 실을 때 L2가 승인 요청을 한 번 더 내지 않게 하려는 것이다. 이 패키지는 그룹 이름을 알지 못하고 조립 루트가 `<확장 이름>.<대기열 이름>`을
 * 넘긴다. 합쳐도 증거의 유효성 규칙(첫 마디가 호출 확장 이름과 같아야 한다)은 그대로다.
 */
export function withTrustedEvidence(
  settings: KnowledgeSettings,
  sources: readonly string[] | undefined,
): KnowledgeSettings {
  if (sources === undefined || sources.length === 0) return settings;
  const merged = [...new Set([...settings.write.trustedEvidenceSources, ...sources])];
  return { ...settings, write: { ...settings.write, trustedEvidenceSources: merged } };
}

/** 설정 층을 돌려준다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface KnowledgeSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

type Name = keyof typeof knowledgeSettings.defs;

function valueOf(name: Name, layers: ScopeStack): unknown {
  return resolveSetting(knowledgeSettings.defs[name], layers).setting.value;
}

function booleanOf(name: Name, layers: ScopeStack, fallback: boolean): boolean {
  const value = valueOf(name, layers);
  return typeof value === "boolean" ? value : fallback;
}

function integerOf(name: Name, layers: ScopeStack, fallback: number): number {
  const value = valueOf(name, layers);
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function stringsOf(name: Name, layers: ScopeStack, fallback: readonly string[]): readonly string[] {
  const value = valueOf(name, layers);
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : fallback;
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readKnowledgeSettings(layers: ScopeStack): KnowledgeSettings {
  const d = DEFAULT_KNOWLEDGE_SETTINGS;
  const scope = valueOf("search.defaultScope", layers);
  return {
    skills: {
      enabled: booleanOf("skills.enabled", layers, d.skills.enabled),
      projectSkills: booleanOf("skills.projectSkills", layers, d.skills.projectSkills),
      paths: stringsOf("skills.paths", layers, d.skills.paths),
      indexBudgetChars: integerOf("skills.indexBudgetChars", layers, d.skills.indexBudgetChars),
      indexDescriptionChars: integerOf(
        "skills.indexDescriptionChars",
        layers,
        d.skills.indexDescriptionChars,
      ),
    },
    memory: {
      enabled: booleanOf("memory.enabled", layers, d.memory.enabled),
      userLimitChars: integerOf("memory.userLimitChars", layers, d.memory.userLimitChars),
      envLimitChars: integerOf("memory.envLimitChars", layers, d.memory.envLimitChars),
    },
    write: {
      approval: booleanOf("write.approval", layers, d.write.approval),
      scan: booleanOf("write.scan", layers, d.write.scan),
      proposalExpiryDays: integerOf("write.proposalExpiryDays", layers, d.write.proposalExpiryDays),
      trustedEvidenceSources: stringsOf(
        "write.trustedEvidenceSources",
        layers,
        d.write.trustedEvidenceSources,
      ),
    },
    search: {
      enabled: booleanOf("search.enabled", layers, d.search.enabled),
      defaultScope: scope === "project" ? "project" : "all",
      includeHiddenDefault: booleanOf(
        "search.includeHiddenDefault",
        layers,
        d.search.includeHiddenDefault,
      ),
      likeScanLimit: integerOf("search.likeScanLimit", layers, d.search.likeScanLimit),
    },
  };
}
