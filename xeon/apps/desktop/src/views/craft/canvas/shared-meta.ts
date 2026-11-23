// 시안 F·G·H가 함께 보는 플러그인 메타(AGE-31 둘째 판). 공통 표본(`shared-sample.ts`)에 없는 값을 계약의 이름으로 더한다(값은 표본이다).
// 세 리드가 각자 덧붙인 값 가운데 가장 풍부한 cvG의 것을 바탕으로 하나로 맞췄다. 맞추며 더한 것: 드래프트를 만든 대화
// (`origin.createdIn`, `DraftInfo.originThreadId`)와 리뷰 항목 id(cvF·cvH), MCP 실행 명령(`CardMcpLaunch`, cvH), 노드 30개 장면의
// 플러그인마다 다른 목적(cvF). 시안 F·H는 이 값을 자기 모양으로 바꿔 읽는다(`cvF/sample-ext.ts`, `cvH/sample-ext.ts`).
// 필드 이름은 계약을 따른다: 매니페스트(`ExtensionManifest`의 version·author·license·purpose, `PluginDecl`의 requires·optional·provides·
// readsRecordKinds·replaces, `group.members`), 카드(`PluginCard`의 origin·review·enforcement·runs·cost·health·usedBy), 드래프트(`DraftInfo`).
// 묶음은 매니페스트 `plugins[]` + `group`을 가진 패키지 하나이고 프로필은 그 이름 하나를 참조한다(`PluginRef.name`).
import { t, tKey, type MessageId } from "@fresnel/client/i18n";
import {
  builtinPluginTextKey,
  type CardMcpLaunch,
  type HookName,
  type InternalPluginTextField,
} from "@fresnel/contracts/extensions";
import { SHARED_PROFILES, type SharedProfileId } from "./shared-sample.ts";

/** `PLUGIN_ORIGIN_KINDS` */
export type OriginKind = "builtin" | "bundled" | "user" | "project" | "managed";
/** `CARD_REVIEW_STATES` */
export type ReviewState = "approved" | "pending" | "draft" | "none";
/** `PLUGIN_HEALTH_STATES` */
export type HealthState = "ok" | "idle" | "error" | "stopped" | "integrity";

interface CapabilityNeed {
  readonly id: string;
  readonly range: string;
}

interface CapabilityGive {
  readonly id: string;
  readonly version: string;
}

/** 리뷰 대기 중인 새 판(`DraftInfo` + 리뷰 항목). 승인본을 고친 것이면 `parentVersion`이 있다 */
interface PendingDraft {
  /** `DraftInfo.draftId` */
  readonly draftId: string;
  readonly version: string;
  readonly contentHash: string;
  /** 앞 판(승인본). 새 플러그인이면 null */
  readonly parentVersion: string | null;
  /** `provenance`: 빌더(assistant)가 만들었나, 사람이 고쳤나 */
  readonly provenance: "assistant" | "user";
  /** `DraftInfo.label` */
  readonly label: MessageId;
  /** `DraftInfo.submittedItemId`: 검토함에 올라간 항목 */
  readonly submittedItemId: string;
}

export interface PluginMeta {
  readonly displayName: string;
  /** 매니페스트 `purpose`(한 문장) */
  readonly purpose: MessageId;
  /** 엔진 카드의 목적 글(카드 `purpose`). 있으면 `purpose` 대신 그린다. null이면 카드에 목적이 없다 */
  readonly purposeText?: string | null;
  /** 엔진 카드의 설명(카드 `description`, 매니페스트 `description`). null이면 카드에 설명이 없다. 표본에는 없다 */
  readonly descriptionText?: string | null;
  readonly version: string;
  /** 작성자. 카드에는 없어 엔진 값에서는 null이다 */
  readonly author: string | null;
  readonly license: string | null;
  readonly origin: OriginKind;
  /** 이 플러그인을 담은 패키지(확장) 이름. 등록 id는 패키지와 같거나 `<패키지>/<id>`다 */
  readonly pkg: string;
  readonly review: {
    readonly state: ReviewState;
    readonly currentHash: string | null;
    readonly approvedAt: string | null;
  };
  readonly pending: PendingDraft | null;
  /** 빌더가 테스트 챗에서 만들었다(`origin.createdIn`) */
  readonly createdByBuilder: boolean;
  /** `origin.createdIn.threadId`: 이 플러그인을 만든 대화. 없으면 null */
  readonly createdIn: string | null;
  readonly enforcement: "advisory" | "enforced";
  /** `runs.isolated`. 코드가 없으면 null */
  readonly isolated: boolean | null;
  /** `cost`(토큰, 정적 추정 `declared`) */
  readonly cost: {
    readonly always: number | null;
    readonly drive: number | null;
    readonly onDemand: number | null;
    readonly toolCount: number | null;
  };
  readonly health: HealthState;
  readonly requires: readonly CapabilityNeed[];
  readonly optional: readonly CapabilityNeed[];
  readonly provides: readonly CapabilityGive[];
  readonly readsRecordKinds: readonly string[];
  readonly recordKinds: readonly string[];
  /** 같은 이름으로 대체하는 내장 도구 */
  readonly replaces: readonly string[];
  /** 매니페스트 `hooks`(Hook 이름) */
  readonly hooks: readonly HookName[];
  /** 도구만: 승인하면 실행될 명령(`CardMcpLaunch`) */
  readonly launch: CardMcpLaunch | null;
  /** 카드 `usedBy`(이 플러그인을 쓰는 프로필 id, 공통 묶음은 `"common"`). 표본은 `usedByOf`로 센다 */
  readonly usedBy?: readonly string[];
  /** 카드 `requiredByCore`: 엔진이 이 플러그인에 기대는 코어 부분. 비어 있지 않으면 프로필에서 뺄 수 없다 */
  readonly requiredBy?: readonly string[];
}

/**
 * 엔진이 스스로 싣는 플러그인(내부 부품 21과 내장 그룹 둘)의 글은 클라이언트 카탈로그에 한국어와 영어로 있다(`builtinPluginTextKey`).
 * 매니페스트의 영어 글보다 그것을 먼저 쓴다 [결정: 2026-11-23 사용자, AGE-31]. 카탈로그에 없으면 null
 */
function builtinText(
  meta: Pick<PluginMeta, "origin" | "pkg">,
  field: InternalPluginTextField,
): string | null {
  if (meta.origin !== "builtin") return null;
  const key = builtinPluginTextKey(meta.pkg, field);
  if (key === undefined) return null;
  const text = tKey(key, "").trim();
  return text === "" ? null : text;
}

function filled(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

type TextMeta = Pick<PluginMeta, "purpose" | "purposeText" | "origin" | "pkg">;

/** 목적 한 문장: 내장이면 카탈로그 글, 엔진 카드면 카드의 글, 표본이면 카탈로그 키의 글. 카드에 목적이 없으면 null */
export function purposeTextOf(meta: TextMeta): string | null {
  const builtin = builtinText(meta, "purpose");
  if (builtin !== null) return builtin;
  if (meta.purposeText === undefined) return t(meta.purpose);
  return filled(meta.purposeText);
}

/** 화면에 그릴 목적 한 문장: 목적이 없으면 "목적이 적혀 있지 않아요" */
export function purposeOf(meta: TextMeta): string {
  return purposeTextOf(meta) ?? t("desktop.craft.canvas.cv9.purposeNone");
}

/** 설명(카드 안쪽 면의 글): 내장이면 카탈로그 글, 엔진 카드면 카드의 `description`. 없으면 null(표본의 글은 각 시안이 덧붙인다) */
export function descriptionTextOf(
  meta: Pick<PluginMeta, "descriptionText" | "origin" | "pkg">,
): string | null {
  return builtinText(meta, "description") ?? filled(meta.descriptionText);
}

const APPROVED = (hash: string, at: string): PluginMeta["review"] => ({
  state: "approved",
  currentHash: hash,
  approvedAt: at,
});

const NO_COST = { always: null, drive: null, onDemand: null, toolCount: null } as const;

const PLAIN = {
  license: "MIT",
  pending: null,
  createdByBuilder: false,
  createdIn: null,
  enforcement: "advisory",
  health: "ok",
  requires: [],
  optional: [],
  provides: [],
  readsRecordKinds: [],
  recordKinds: [],
  replaces: [],
  hooks: [],
  launch: null,
} as const;

const META: Readonly<Record<string, PluginMeta>> = {
  "house-style": {
    ...PLAIN,
    displayName: "House Style",
    purpose: "desktop.craft.canvas.sample.purpose.houseStyle",
    version: "1.0.2",
    author: "team",
    origin: "project",
    pkg: "house-style",
    review: APPROVED("9c41e7", "2026-11-12"),
    isolated: null,
    cost: { ...NO_COST, always: 820 },
  },
  "repo-skills": {
    ...PLAIN,
    displayName: "Repo Skills",
    purpose: "desktop.craft.canvas.sample.purpose.repoSkills",
    version: "0.4.0",
    author: "team",
    origin: "project",
    pkg: "repo-skills",
    review: APPROVED("2a7f03", "2026-11-15"),
    isolated: null,
    cost: { ...NO_COST, always: 260, onDemand: 4100 },
  },
  memory: {
    ...PLAIN,
    displayName: "Memory",
    purpose: "desktop.craft.canvas.sample.purpose.memory",
    version: "2.1.0",
    author: "fresnel",
    origin: "bundled",
    pkg: "memory",
    review: APPROVED("51d0be", "2026-11-02"),
    isolated: false,
    cost: { ...NO_COST, always: 1400 },
    // 엔진에서 기억을 내는 쪽(`cap-knowledge`)처럼 `knowledge.memory`를 낸다. helm이 이것을 선택 의존으로 받는다
    provides: [{ id: "knowledge.memory", version: "1.0.0" }],
    hooks: ["request.context.before"],
  },
  "secret-guard": {
    ...PLAIN,
    displayName: "Secret Guard",
    purpose: "desktop.craft.canvas.sample.purpose.secretGuard",
    version: "1.3.1",
    author: "fresnel",
    origin: "bundled",
    pkg: "secret-guard",
    review: APPROVED("e08c22", "2026-11-02"),
    enforcement: "enforced",
    isolated: true,
    cost: NO_COST,
    hooks: ["guard.tool.before"],
  },
  "lint-on-edit": {
    ...PLAIN,
    displayName: "Lint on Edit",
    purpose: "desktop.craft.canvas.sample.purpose.lintOnEdit",
    version: "1.2.0",
    author: "team",
    origin: "user",
    pkg: "quality",
    review: APPROVED("77b9a1", "2026-11-10"),
    // 승인본 1.2.0 위에 빌더가 고친 1.3.0이 리뷰를 기다린다
    pending: {
      draftId: "drf_3m8t1c",
      version: "1.3.0",
      contentHash: "c3e512",
      parentVersion: "1.2.0",
      provenance: "assistant",
      label: "desktop.craft.canvas.sample.draftLabel.lint",
      submittedItemId: "rvw_4p1x8d",
    },
    isolated: true,
    cost: NO_COST,
    provides: [{ id: "lint.report", version: "1.0.0" }],
    recordKinds: ["grp.quality.lint.reported"],
    // 공통 표본의 결정이 "바꿈"이므로 결과를 고칠 수 있는 Hook(fold chain)에 건다
    hooks: ["tool.result"],
  },
  "cost-cap": {
    ...PLAIN,
    displayName: "Cost Cap",
    purpose: "desktop.craft.canvas.sample.purpose.costCap",
    version: "0.9.0",
    author: "you",
    origin: "user",
    pkg: "cost-cap",
    review: APPROVED("0f6d44", "2026-11-08"),
    isolated: true,
    cost: NO_COST,
    hooks: ["guard.model.before"],
  },
  helm: {
    ...PLAIN,
    displayName: "Helm",
    purpose: "desktop.craft.canvas.sample.purpose.helm",
    version: "0.1.1",
    author: "fresnel",
    origin: "bundled",
    pkg: "helm",
    review: APPROVED("a4b9f2", "2026-11-18"),
    isolated: false,
    cost: { ...NO_COST, always: 380, drive: 2300 },
    // 실제 helm 매니페스트(`packages/group-helm/src/manifest.ts`)의 optional과 hooks
    optional: [
      { id: "web.search", range: "^1.0.0" },
      { id: "web.fetch", range: "^1.0.0" },
      { id: "knowledge.search", range: "^1.0.0" },
      { id: "knowledge.skills", range: "^1.0.0" },
      { id: "knowledge.memory", range: "^1.0.0" },
      { id: "work.tasks", range: "^1.0.0" },
    ],
    recordKinds: ["grp.helm.signal.detected", "grp.helm.discovery.recorded"],
    hooks: [
      "input.agent.before",
      "tool.call.before",
      "tool.execution.after",
      "boundary.settle.after",
      "thread.start",
    ],
  },
  verifier: {
    ...PLAIN,
    displayName: "Verifier",
    purpose: "desktop.craft.canvas.sample.purpose.verifier",
    version: "1.2.0",
    author: "team",
    origin: "user",
    pkg: "quality",
    review: APPROVED("77b9a1", "2026-11-10"),
    isolated: true,
    cost: { ...NO_COST, always: 120, drive: 900 },
    requires: [
      { id: "lint.report", range: "^1.0.0" },
      { id: "agents.judge", range: "^1.0.0" },
    ],
    readsRecordKinds: ["grp.helm.discovery.*"],
  },
  "github-mcp": {
    ...PLAIN,
    displayName: "GitHub",
    purpose: "desktop.craft.canvas.sample.purpose.github",
    version: "3.0.1",
    author: "github",
    origin: "user",
    pkg: "github-mcp",
    review: APPROVED("d19e60", "2026-11-05"),
    isolated: true,
    cost: { ...NO_COST, always: 1900, toolCount: 12 },
    requires: [{ id: "mcp.client", range: "^1.0.0" }],
    provides: [{ id: "github.issues", version: "1.2.0" }],
    launch: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      envNames: ["GITHUB_TOKEN"],
      cwd: null,
    },
  },
  "commit-msg": {
    ...PLAIN,
    displayName: "Commit Message",
    purpose: "desktop.craft.canvas.sample.purpose.commitMsg",
    version: "0.1.0",
    author: "you",
    license: null,
    origin: "user",
    pkg: "commit-msg",
    review: { state: "draft", currentHash: null, approvedAt: null },
    pending: {
      draftId: "drf_8k2q",
      version: "0.1.0",
      contentHash: "5be7a0",
      parentVersion: null,
      provenance: "assistant",
      label: "desktop.craft.canvas.sample.draftLabel.commit",
      submittedItemId: "rvw_7k2m9x",
    },
    createdByBuilder: true,
    createdIn: "thr_8q2n4w",
    isolated: true,
    cost: NO_COST,
    health: "idle",
    hooks: ["tool.call.before"],
  },
  "web-research": {
    ...PLAIN,
    displayName: "Web Research",
    purpose: "desktop.craft.canvas.sample.purpose.webResearch",
    version: "0.6.0",
    author: "community",
    origin: "user",
    pkg: "web-research",
    review: APPROVED("4410ac", "2026-10-30"),
    isolated: true,
    cost: { ...NO_COST, always: 210, drive: 1600 },
    requires: [
      { id: "web.search", range: "^1.0.0" },
      { id: "web.fetch", range: "^1.0.0" },
    ],
  },
  changelog: {
    ...PLAIN,
    displayName: "Changelog",
    purpose: "desktop.craft.canvas.sample.purpose.changelog",
    version: "1.0.0",
    author: "team",
    origin: "project",
    pkg: "changelog",
    review: APPROVED("6e2290", "2026-11-01"),
    isolated: null,
    cost: { ...NO_COST, always: 540 },
    health: "idle",
  },
  "test-runner": {
    ...PLAIN,
    displayName: "Test Runner",
    purpose: "desktop.craft.canvas.sample.purpose.testRunner",
    version: "0.3.2",
    author: "team",
    origin: "user",
    pkg: "test-runner",
    review: APPROVED("b8835f", "2026-11-11"),
    enforcement: "enforced",
    isolated: true,
    cost: NO_COST,
    health: "idle",
    requires: [{ id: "workspace.shell", range: "^1.0.0" }],
    hooks: ["boundary.settle.before"],
  },
};

/** 노드 30개 장면의 플러그인 스물: 목적은 하나씩, 관계가 있는 것은 그 값도 */
const SCALE_META: Readonly<Record<string, Partial<PluginMeta>>> = {
  "api-docs": { purpose: "desktop.craft.canvas.sample.purpose.apiDocs" },
  "db-schema": { purpose: "desktop.craft.canvas.sample.purpose.dbSchema" },
  runbooks: { purpose: "desktop.craft.canvas.sample.purpose.runbooks" },
  "design-notes": { purpose: "desktop.craft.canvas.sample.purpose.designNotes" },
  onboarding: { purpose: "desktop.craft.canvas.sample.purpose.onboarding" },
  "ts-style": { purpose: "desktop.craft.canvas.sample.purpose.tsStyle" },
  "pii-mask": {
    purpose: "desktop.craft.canvas.sample.purpose.piiMask",
    enforcement: "enforced",
    hooks: ["tool.call.before"],
  },
  "license-check": {
    purpose: "desktop.craft.canvas.sample.purpose.licenseCheck",
    hooks: ["tool.call.before"],
  },
  "format-on-save": {
    purpose: "desktop.craft.canvas.sample.purpose.formatOnSave",
    hooks: ["tool.result"],
  },
  "bundle-cap": {
    purpose: "desktop.craft.canvas.sample.purpose.bundleCap",
    enforcement: "enforced",
    hooks: ["tool.result"],
  },
  "budget-alert": {
    purpose: "desktop.craft.canvas.sample.purpose.budgetAlert",
    hooks: ["guard.model.before"],
  },
  "deploy-gate": {
    purpose: "desktop.craft.canvas.sample.purpose.deployGate",
    hooks: ["boundary.settle.before"],
  },
  triage: {
    purpose: "desktop.craft.canvas.sample.purpose.triage",
    requires: [{ id: "github.issues", range: "^1.0.0" }],
  },
  planner: { purpose: "desktop.craft.canvas.sample.purpose.planner" },
  refactorer: { purpose: "desktop.craft.canvas.sample.purpose.refactorer", replaces: ["edit"] },
  "doc-writer": { purpose: "desktop.craft.canvas.sample.purpose.docWriter" },
  "jira-mcp": { purpose: "desktop.craft.canvas.sample.purpose.jiraMcp" },
  "slack-mcp": { purpose: "desktop.craft.canvas.sample.purpose.slackMcp" },
  "sentry-mcp": { purpose: "desktop.craft.canvas.sample.purpose.sentryMcp" },
  "figma-mcp": { purpose: "desktop.craft.canvas.sample.purpose.figmaMcp" },
};

/** 표본의 짧은 해시(앞 6자리)를 이름에서 정한다. 같은 이름은 늘 같은 값이다 */
function hashOf(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export function metaOf(name: string, kind: "inject" | "hook" | "drive" | "tool"): PluginMeta {
  const known = META[name];
  if (known !== undefined) return known;
  return {
    ...PLAIN,
    displayName: name,
    purpose: "desktop.craft.canvas.sample.purpose.unknown",
    version: "1.0.0",
    author: "team",
    origin: "user",
    pkg: name,
    review: APPROVED(hashOf(name), "2026-11-14"),
    isolated: kind === "inject" ? null : true,
    cost: kind === "tool" ? { ...NO_COST, always: 420, toolCount: 3 } : NO_COST,
    ...SCALE_META[name],
  };
}

/** 묶음(패키지 하나가 플러그인 여럿을 담고 함께 켜고 끈다) */
export interface BundleMeta {
  readonly id: string;
  readonly displayName: string;
  readonly purpose: MessageId;
  readonly version: string;
  readonly author: string;
  readonly origin: OriginKind;
  readonly hash: string;
}

const BUNDLES: Readonly<Record<string, BundleMeta>> = {
  quality: {
    id: "quality",
    displayName: "Quality",
    purpose: "desktop.craft.canvas.sample.purpose.quality",
    version: "1.2.0",
    author: "team",
    origin: "user",
    hash: "77b9a1",
  },
};

export function bundleMetaOf(id: string): BundleMeta {
  return (
    BUNDLES[id] ?? {
      id,
      displayName: id,
      purpose: "desktop.craft.canvas.sample.purpose.unknown",
      version: "1.0.0",
      author: "team",
      origin: "user",
      hash: hashOf(id),
    }
  );
}

/** 이 플러그인을 쓰는 표본 프로필(`PluginCard.usedBy`). 베이스는 `"base"` */
export function usedByOf(name: string): readonly string[] {
  const out: string[] = [];
  const ids: readonly SharedProfileId[] = ["dev", "scale"];
  if (SHARED_PROFILES.dev.base.includes(name)) out.push("base");
  for (const id of ids) {
    const p = SHARED_PROFILES[id];
    if (p.plugins.includes(name)) out.push(id);
  }
  return out;
}
