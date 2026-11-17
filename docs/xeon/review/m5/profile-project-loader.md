---
id: review.m5-profile-project-loader
layer: meta
domain: review
kind: spec
status: draft
depends_on: [adr.0023, adr.0022, review.m5-drive-isolation, F.extensions.spec, F.wire-settings.spec, F.records.spec, F.conversation.spec, X.primitives.spec, X.loading-trust.spec, X.operations.spec, L0.secrets.spec, L1.context.spec, L1.agents.spec, L1.tools.spec, L2.workspace.spec, L2.knowledge.spec, L2.mcp.spec, L3.authoring.spec, L4.host-service.spec]
binds: []
---


# 프로필, 프로젝트, 플러그인 원본과 로더, 검토 (M5c)

> **마일스톤 설계 스펙(상태 draft).** 프로필, 프로젝트, 플러그인 원본과 로더, 검토, 테스트 대화의 엔진 쪽(M5c, M5f)을 정한다. 층 스펙(`docs/xeon/<층>/<도메인>/spec.md`)은 이 문서를 구현하는 트랙이 코드와 같은 커밋에서 바꾼다. 이 문서는 층 스펙을 대신하지 않고 구현 전에 합의할 내용을 모은 것이다.
>
> **이 문서가 바꿀 층 스펙:** `docs/xeon/F/extensions/spec.md`, `docs/xeon/F/wire-settings/spec.md`, `docs/xeon/F/records/spec.md`, `docs/xeon/F/conversation/spec.md`, `docs/xeon/X/primitives/spec.md`, `docs/xeon/X/loading-trust/spec.md`, `docs/xeon/X/operations/spec.md`, `docs/xeon/L1/context/spec.md`, `docs/xeon/L1/agents/spec.md`, `docs/xeon/L1/tools/spec.md`, `docs/xeon/L2/workspace/spec.md`, `docs/xeon/L2/knowledge/spec.md`, `docs/xeon/L2/mcp/spec.md`, `docs/xeon/L3/authoring/spec.md`, `docs/xeon/L4/host-service/spec.md`.
>
> **원천:** `_notes/design/lc/spec/m5c-profile-project-loader.md`(저장소 밖 메모, 2026-11-17 마지막 맞춤본). 문서 이름 대응: M5c = `docs/xeon/review/m5/profile-project-loader.md`, M5d = `turn-record-metrics.md`, M5e = `hooks-core-boundary.md`, 엔진 설계 = `drive-isolation.md`(모두 같은 폴더), 화면 스펙 = `docs/xeon/review/m6/craft-flows.md`, 요구 = `docs/xeon/review/m5-plan.md`, 일정 = `m5-plan.md`와 `m6-plan.md`, 개념과 결정 = `docs/xeon/decisions/ADR-0023-plugin-profile-core.md`. 옛 이름 대응: "PRD" = `m5-plan.md`(R번호 그대로, "PRD §7"은 §14), "craft-flow"·"flow"·"flow R<n>" = 화면 스펙 제1부(흐름 n), "개념 문서"·"개념 §9" = ADR-0023(대체한 절은 ADR §6), "로드맵" = `m5-plan.md` §7과 `m6-plan.md`. 코드 경로의 `path:line`은 `m4/cyP` 워크트리 읽기 시점의 값이다.

초안 1, 2026-11-17. 결정의 정본은 `docs/xeon/decisions/ADR-0023-plugin-profile-core.md`(§3), `docs/xeon/review/m6/craft-flows.md`(제1부 흐름), `docs/xeon/review/m5-plan.md`, `docs/xeon/review/m5/drive-isolation.md`(2026-11-17 통합본), `_notes/m4-decisions.md` "2026-11-16~17"이다. 이 문서는 그 결정을 코드와 맞춘 스펙 초안이고, 결정이 없는 곳은 [제안]과 기본값을 적었다. 코드 사실은 `cyP 워크트리`(작업 트리, 읽기 전용으로 확인)의 `path:line`으로 인용한다. 번호는 읽은 시점 값이다.

**통합 정리(2026-11-17, `_notes/design/lc/spec/consolidation-log.md`).** 교차 점검 둘의 결과를 반영했다. 이름과 저장 문자열이 겹치는 곳은 엔진 설계 통합본의 "공통 어휘"가 정본이다: 플러그인 정체는 이름(`pluginId`), 버전 정체(`versionId`)는 검토본의 내용 해시와 초안의 `draft:<draftId>:<해시 앞 8자>`다. 훅 위치·결정값·기록된 결과값은 F(`m5e`)와 E(`m5d`)가 정의하고 이 문서는 인용만 한다. Craft 화면이 맡을 것은 `docs/xeon/review/m6/craft-flows.md`를 가리킨다. U1~U6은 2026-11-17에 사용자가 정해 본문에 반영했다. 아직 정해지지 않은 것은 [제안]·[권고: 메인 세션, 확인 대기]·[확인 대기]로 적었고 §10에 모았으며, 아래 규칙은 그 답을 조용히 가정하지 않는다.

`terms.json`의 thread 항목에 금지 별칭이 있어 이 문서는 "대화"를 쓰고, 대화가 시작하는 폴더는 "대화 폴더"로 부른다. 화면 용어는 플러그인, 프로필, Inject / Hook / Drive만 쓴다(확장, 플러그인 그룹은 화면에서 쓰지 않는다). 코드 식별자(`ExtensionManifest`, `ext.*`)는 그대로 인용한다.

## 1. 목적과 범위

### 1.1 정하는 것

| 묶음 | 내용 | 요구 번호 |
|---|---|---|
| 대화와 프로필 | 대화가 프로필 하나를 참조한다. 켜짐은 프로필에서 계산한다. 프로필을 고치면 다음 단계 경계에서 따라 바뀐다. 플러그인별 스위치는 wire와 설정에 없다. 지울 수 없는 내장 기본 프로필. 도중 전환. 서브에이전트 상속 | PRD R1, R2, R3(엔진 쪽), R13(프로필 상속), flow R4, R5(엔진 쪽) |
| 프로필 내용 | 순서 있는 플러그인 목록, 프로필별 플러그인 설정 값, 코어 설정 값, 시작 Drive, 모든 프로필 공통 묶음, 검증, 비용 미리 보기 입력 | R20 |
| 덧씌우기 | 프로필에 없는 검토된 플러그인을 사용자가 직접 불러 그 턴에만(Drive는 반납까지) 얹기. 초안을 실제 대화에서 써 보기 | R15, flow R6 |
| 프로젝트 | 루트 작업 폴더 하나, 대화 폴더, 쓰기 범위, 지침 파일, 프로젝트 없는 대화의 기본 폴더, 같은 폴더 동시 대화 알림 | R14 |
| 테스트 대화와 초안 제출 | Craft 전용 AI 대화의 엔진 쪽(표지, 목록·프로젝트에서 제외, 플러그인에 묶임, 숨은 `craft` 프로필, 쓰기 범위, 맥락 참조, 보관), 테스트 실행의 구성, 초안 목록·제출 경로, 빌더의 초안·제출 요구(§3.6, §4.8, §4.9) | R16, R17(엔진 쪽), R26 |
| 원본과 로더 | 폴더가 플러그인. 발견 위치, 매니페스트와 추론, 공통 스키마 카드, Inject 재료가 코어에 전달되는 길 | R4, flow R1(원본), flow R3(스키마 계산) |
| 검토본과 검토 | 내용 해시로 고정한 검토본만 실행. 원본이 바뀌면 검토함에 새 버전. 손 수정 불실행. 모든 생성·변경·삭제는 검토. 프로젝트 동반 플러그인. 초안 | R5, R6, R24, flow R1, R2 |

### 1.2 다루지 않는 것

| 안 다루는 것 | 맡는 스펙 |
|---|---|
| 단계 함수, 프레임 스택, 플러그인 프로세스, 샌드박스, `handoff`, 한도 | 엔진 설계 스펙(`docs/xeon/review/m5/drive-isolation.md`를 스펙으로 옮긴 것). 이 문서는 그 결과를 전제하고 §9.1에 요구를 적는다 |
| 턴 기록 저장, 지표, 시험 기록 분리의 집계 | 기록과 지표 스펙(R12, R16, R18, R19). 이 문서는 `profile.applied` 레코드와 `draft` 표지만 준다 |
| Hook 정리, 같은 Hook 안의 호출 순서 바꾸기 UI | Hook 정리 스펙(R21) |
| Craft 화면, 프로필 칩, 검토함 화면, 테스트 대화 창, 테스트 화면 | Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`, R16, R17, R23). 테스트 대화의 **엔진 쪽**은 이 문서(§4.8)가 유일한 소유자다 |
| 마켓, 외부 배포, 다른 하네스 형식 읽기 호환 | 하지 않는다(`m5-plan.md` §3 [결정: 2026-11-17 사용자]. 지금 읽는 `.mcp.json`·`.agents/skills`도 제거한다(§4.4.10) |
| 다른 하네스 형식의 변환(마이그레이션 기능) | 별도 항목으로 설계하고 만든다(§7.9, 로드맵 M5g). 이 문서는 그 입구(제거 시점)만 정한다 |
| 플러그인별 네트워크 허용 목록, Windows 샌드박스 | 격리 3단계(`m5-plan.md` §5 P2) |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 프로필 | 플러그인 목록과 설정 값에 이름을 붙인 것. 대화는 프로필 하나를 참조한다 [결정: 2026-11-16] |
| 내장 기본 프로필 | id `default`. 지울 수 없다. 권한 모드 "모두 허용"(`bypass`)을 가진다 [결정: 2026-11-16] |
| 공통 묶음 | 사용자가 두는 "모든 프로필 공통" 플러그인과 설정 값. 모든 프로필에 항상 더해진다 [결정: 2026-11-16 개념 §6] |
| 시작 Drive | 프로필이 가진 "대화를 시작할 때 누가 주도하나"(없음 또는 플러그인 하나). 저장 필드 이름은 `driver` |
| 코어 설정 값 | 코어 블록이 읽는 설정 키(권한 모드, 기본 모델 등)의 프로필별 값. 별도 "블록 설정" 개념은 없다. 화면이 블록별로 나눠 보일 뿐이다 [결정: 2026-11-16] |
| 덧씌우기 (overlay) | 프로필 기록은 그대로 두고 이번 턴(Drive는 반납까지)의 켜짐 집합에만 플러그인을 더하는 것 [결정: 2026-11-17 사용자] |
| 프로젝트 | 루트 작업 폴더 하나에 대화가 묶이는 최소 공통 맥락. 공통 지침, 파일, 플러그인 설정을 공유하지 않는다 [결정: 2026-11-17] |
| 프로젝트 루트 | 프로젝트의 작업 폴더. 쓰기 허용 범위 |
| 대화 폴더 | 대화가 시작하는 폴더. 프로젝트 루트 안의 아무 하위 폴더이고 구성 제약이 없다 [결정: 2026-11-17]. 저장 필드는 `workspace` |
| 지침 파일 | 루트에서 대화 폴더까지 경로의 `AGENTS.md`. 프로젝트의 내용이고 플러그인이 아니다 [결정: 개념 §4] |
| 플러그인 폴더 (원본) | 플러그인의 원본. 담당 AI만 고친다 [결정: 2026-11-17] |
| 검토본 | 승인한 시점의 내용을 내용 해시로 고정해 앱이 따로 보관한 사본. 앱은 검토본만 실행한다 |
| 내용 해시 | 폴더 전체에서 계산한 `sha256:<hex>`(§4.6) |
| 후보 | 아직 승인하지 않은 폴더 내용. 검토 항목이 가리킨다 |
| 초안 (draft) | 사용자 또는 담당 AI가 만든, 승인 전 플러그인 폴더의 스냅샷. 테스트 실행과 명시적 덧씌우기에서만 돈다 |
| 플러그인 정체, 버전 정체 | `pluginId` = 플러그인 이름. `versionId` = 검토본은 `contentHash`(`sha256:<hex>`), 초안은 `draft:<draftId>:<해시 앞 8자>`. 기록(E)과 프레임(C)이 같은 문자열을 쓴다 |
| 테스트 대화, 테스트 실행 | 테스트 대화 = Craft 전용 AI 대화 [결정: 2026-11-17 사용자]. 테스트 실행 = 초안을 얹은 임시 구성으로 에이전트를 돌리는 일 [결정: 2026-11-17 사용자]. 화면의 장소 이름은 "테스트"다 [결정: 2026-11-17 사용자] |
| 카드 | 모든 플러그인이 같은 자리에 보이는 공통 스키마 값(§3.1 `PluginCard`) |
| 검토 항목 | 검토함의 한 줄. 종류는 `new`, `update`, `remove` |

## 3. 인터페이스

소유 패키지를 항목마다 적었다. F는 `xeon/packages/contracts`, X는 `xeon/packages/ext-host`, 호스트는 `xeon/apps/host`다. 저장된 문자열(이벤트 kind, 필드 이름)은 바꾸지 않고 더하기만 한다(2026-11-01 결정). 새 이름은 모두 "추가"로 적었다.

### 3.1 타입

```ts
// F: wire-settings/wire/profile.ts (지금 profile-test-run.ts:34-62의 프로필 부분을 옮기고 바꾼다)
export interface PluginRef { readonly name: string }            // [제안] 버전 핀 없음. 항상 그 이름의 현재 검토본
export interface ProfileSetting { readonly key: string; readonly value: unknown }

export interface Profile {
  readonly id: string;                       // PROFILE_ID_PATTERN 그대로. 내장은 "default"
  readonly title: string;
  readonly builtin: boolean;                 // 추가. 참이면 삭제 불가
  readonly plugins: readonly PluginRef[];    // 순서 있음. enable/disable 목록을 대체한다
  readonly settings: readonly ProfileSetting[]; // 코어 키와 `ext.<name>.<key>`. 미설정은 기본값을 따른다
  readonly driver: string | null;            // 시작 Drive. 저장 이름 유지. 값은 plugins 안의 이름
  readonly updatedAt: string;
  readonly rev: number;
}
export interface CommonSet {                 // 추가. 시작 Drive는 두지 않는다
  readonly plugins: readonly PluginRef[];
  readonly settings: readonly ProfileSetting[];
  readonly updatedAt: string;
  readonly rev: number;
}
export const PROFILE_LIMITS = { plugins: 128, settings: 128, profiles: 200 } as const; // enable/disable 64를 대체

export type ProfileIssueCode =
  | "plugin_unknown" | "plugin_not_reviewed" | "replace_conflict" | "driver_not_in_list"
  | "driver_cannot_drive" | "setting_unknown_key" | "setting_scope_not_allowed" | "setting_invalid_value"
  | "secret_literal" | "secret_missing" | "required_unset" | "requirement_unmet" | "managed_forbidden" | "limit";
export interface ProfileIssue {
  readonly code: ProfileIssueCode;
  readonly severity: "error" | "warning";
  readonly plugin?: string; readonly key?: string; readonly other?: string; // replace_conflict의 상대 플러그인
  readonly tool?: string;
}

// F: 스레드 요약과 대화 생성 (methods.ts)
// ThreadSummary에 추가: profileId, project, overlay
export interface ThreadProfileView {
  readonly profileId: string;
  readonly profileRev: number;
  readonly project: { readonly projectId: string; readonly name: string } | null; // null이면 기본 폴더 대화
  readonly overlay: readonly { readonly plugin: string; readonly draft: boolean; readonly until: "turn" | "release" }[];
}

// F: extensions/plugin-card.ts (추가). craft-flow §5의 공통 스키마
export type HookFold = "tap" | "first" | "chain" | "collect";
export interface PluginCard {
  readonly name: string;
  readonly displayName: string;
  readonly purpose: string | null;                          // 층 1. 한 문장. 없으면 검토에서 승인할 수 없다
  readonly does: {                                          // 층 1. 채워진 칸이 "종류"다
    readonly inject: InjectInventory | null;
    readonly hook: { readonly hooks: readonly { readonly name: string; readonly fold: HookFold;
      readonly position: HookPosition; readonly powers: readonly HookPower[] }[] } | null; // position·powers는 F §4.1 HOOK_POSITIONS에서 계산한다. 막기·묻기·결과 대신 주기를 낼 수 있게 된 변화가 카드와 차이에 보인다
    readonly drive: { readonly start: boolean; readonly commands: readonly string[] } | null;
  };
  readonly enforcement: "advisory" | "enforced";            // 층 1. §4.5.9
  readonly runs: { readonly code: boolean; readonly isolated: boolean | null }; // 층 2. 코드가 없으면 isolated는 null
  readonly cost: CostFigures;                               // 층 2. E §3.3의 정의를 import한다. 카드의 값은 정적이라 basis는 "declared" | "unknown"이다
  readonly health: { readonly state: "ok" | "idle" | "error" | "stopped" | "integrity"; readonly lastActiveAt: string | null; readonly lastError: string | null };
  readonly origin: { readonly kind: "builtin" | "bundled" | "user" | "project" | "managed"; readonly projectId?: string; readonly createdIn?: { readonly threadId: string } };
  readonly review: { readonly state: "approved" | "pending" | "draft" | "none"; readonly currentHash: string | null; readonly pendingItemId: string | null; readonly approvedAt: string | null };
  readonly usedBy: readonly string[];                       // 층 3. 프로필 id. 공통 묶음은 "common"
}
export interface InjectInventory {
  readonly instructions: { readonly always: readonly InstructionEntry[]; readonly skills: readonly SkillEntry[] };
  readonly tools: readonly { readonly name: string; readonly description: string | null }[];
  readonly mcpServers: readonly { readonly name: string; readonly transport: "stdio" | "http" }[];
  readonly agents: readonly string[]; readonly providers: readonly string[]; readonly commands: readonly string[];
  readonly ui: readonly string[]; readonly replaces: readonly string[];
}
export interface InstructionEntry { readonly path: string; readonly bytes: number }
export interface SkillEntry { readonly name: string; readonly path: string; readonly descriptionChars: number }

// F: 검토
export type ReviewKind = "new" | "update" | "remove";
export type ReviewState = "pending" | "approved" | "sent_back" | "discarded" | "superseded" | "withdrawn";
export type Provenance = "assistant" | "project" | "unknown" | "bundled" | "user_instruction"; // unknown = 손으로 고친 것으로 보이는 변경. user_instruction = 사용자가 "지침 추가"로 한 줄을 쓴 것(§4.10)
export interface ReviewItem {
  readonly itemId: string;                 // "rvw_" + 난수
  readonly kind: ReviewKind;
  readonly state: ReviewState;
  readonly name: string;
  readonly candidateHash: string | null;   // remove는 null
  readonly baseHash: string | null;        // 비교 대상(현재 검토본). new는 null
  readonly provenance: Provenance;
  readonly originThreadId: string | null;  // 만든 대화(돌려보내기 사유를 받는 곳, 기본 프로필의 출처)
  readonly originProfileId: string | null; // 승인 때 기본 대상 프로필
  readonly card: PluginCard;               // 후보 기준
  readonly diff: WhatItDoesDiff;
  readonly evidence: readonly EvidenceRef[];
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  readonly createdAt: string; readonly decidedAt: string | null; readonly reason: string | null;
}
export interface WhatItDoesDiff {          // 이전 검토본과의 "하는 일의 차이". new는 전부 added
  readonly added: readonly DiffEntry[]; readonly removed: readonly DiffEntry[]; readonly changed: readonly DiffEntry[];
  readonly enforcementChange: { readonly from: "advisory" | "enforced"; readonly to: "advisory" | "enforced" } | null;
  readonly costDelta: { readonly always: number | null; readonly onDemand: number | null };   // CostFigures와 같은 이름
}
export interface DiffEntry { readonly row: "inject" | "hook" | "drive" | "runs" | "setting" | "replaces"; readonly what: string; readonly detail?: string }
// EvidenceRef는 E §3.5의 정의를 import한다(kind: turn | call | hook | material | skill | backtest). 검토 증거로 붙는 시험 기록은 대화·턴 참조이고,
// 지난 턴에 돌려 본 결과는 { kind: "backtest", backtestRunId }다. 이 문서는 별도 정의를 두지 않는다.
export type ReviewDecision =
  | { readonly kind: "approve"; readonly profileIds: readonly string[]; readonly libraryOnly: boolean }
  | { readonly kind: "sendBack"; readonly reason: string }
  | { readonly kind: "discard" };

// F: 프로젝트
export interface Project { readonly projectId: string; readonly name: string; readonly root: string; readonly createdAt: string; readonly rev: number }

// F: 덧씌우기
export interface OverlayRef { readonly plugin: string; readonly draftId?: string; readonly entry?: string }
```

매니페스트(`contracts/src/extensions/manifest.ts`) 변경 [제안]:

- `entry`(지금 :249 필수)를 선택으로, `plugins`(:250 `minItems: 1`)를 선택으로 바꾼다. 둘 다 없으면 §4.5.4의 추론이 채운다.
- 추가 선택 필드: `purpose`(한 문장, 최대 200자), `components.instructions`(항상 싣는 지침 파일 경로 목록), `tools`(`{name, description}` 선언 목록. 코드가 등록할 도구를 정적으로 알리고 카드와 비용의 근거가 된다), `commands`(`{name, description}`).
- `defaultEnabled`(확장·플러그인 둘 다)는 읽기만 하고 켜짐에 쓰지 않는다(§4.1.9). 새 필드를 만들지 않는다.

### 3.2 레코드, 이벤트, 파일

| 이름 | 종류 | 소유 | 내용 |
|---|---|---|---|
| `thread.started.profileId` | 선택 필드 추가 | F `conversation/lifecycle.ts:52-73` | 생성할 때 고른 프로필 id. 없으면 `default` |
| `thread.updated.profileId` | 선택 필드 추가 | F `conversation/lifecycle.ts:77-95` | 전환. `model`(:93)과 같은 규칙: 활성 가지의 마지막 값이 현재 값 |
| `thread.updated.workspace` | 선택 필드 추가 | 같은 곳 | "대화 시작" 훅이 대화 폴더를 정할 때만. 첫 턴 전에만 쓴다(§4.4.9) |
| `profile.applied` | 새 코어 이벤트 kind | F `records/kind-names.ts:20-` `CORE_EVENT_KINDS`, `records/catalog` | 아래 payload. 대화의 켜짐 집합이 바뀌어 적용된 경계마다 하나. 이 이벤트는 관찰값이 아니라 상태 사건이다(덧씌우기 복원, 켜짐 집합 감사, 재생 결정성): 관찰값을 로그에 더하지 않는다는 E §3.1의 방안 A 거부와 겹치지 않는다. F.records 카탈로그의 종류 목록과 문서 대조 시험(`records/catalog/index.ts`)을 같이 갱신한다 |
| `scope.changed` | 기존, 유지 | F `records/catalog/index.ts:96` | Registration별 켜짐 결과. 계속 남긴다 |
| `lease.acquired.contentHash` | 선택 필드 추가 | 엔진 설계 §2.6이 `parent`, `depth`, `contentHash` 셋을 한 번에 선언한다(전부 선택, `version`을 올리지 않는다) | Drive 프레임이 쌓일 때의 `versionId`. 이 문서는 값의 뜻만 정한다(§9.1) |
| `profiles.json` | 호스트 파일, schemaVersion 2 | 호스트 `assembly/m4/profile-store.ts:156`(지금 v1) | `{schemaVersion: 2, common, profiles}`. 내장 `default` 행은 처음 고칠 때 만든다 |
| `projects.json` | 호스트 파일, 새 파일 | 호스트 | `{schemaVersion: 1, projects: Project[], rev}`. 사용자 설정 폴더(`OsDirs.config`) |
| `plugin-store/` | 호스트 폴더, 새 폴더 | 호스트·X | `OsDirs.data` 아래. 배치는 §4.6.2 |
| `plugin-store/review-log.jsonl` | 추가만 하는 파일 | 호스트 | 결정마다 한 줄(§4.7.8) |

`profile.applied` payload:

```ts
{ reason: "open" | "profile_edited" | "common_edited" | "switched" | "overlay_on" | "overlay_off"
        | "plugin_updated" | "plugin_stopped" | "profile_missing";
  profileId: string; profileRev: number; commonRev: number;
  added: readonly string[]; removed: readonly string[];            // 플러그인 이름
  overlay: readonly { plugin: string; contentHash: string; draftId?: string; until: "turn" | "release" }[];
  permission?: { from: string; to: string };                       // 권한 모드가 바뀐 경우
  toolsChanged?: { added: readonly string[]; removed: readonly string[] };
  updated?: readonly { plugin: string; fromHash: string; toHash: string }[] }
```

### 3.3 설정 키

| 키 | 변경 | 값과 범위 | 비고 |
|---|---|---|---|
| `ext.<name>.enabled` | 사용자 범위에서 제거, 관리 범위만 남김 | boolean, `allowedScopes: ["managed"]`(지금 `settings-keys.ts:30-38`은 `managed,user,project,local,launch`) | 관리자가 플러그인을 막는 잠금으로만 쓴다(§4.1.10). 쓰기 화면과 wire 쓰기 경로는 없다 |
| 새 범위 `profile` | `SettingScope`와 `SCOPE_PRECEDENCE` 추가 | 우선순위: `managed > launch > profile > local > project > user > default` | 지금 `layers.ts:8`은 `managed, launch, local, project, user`. 값은 대화가 참조한 프로필과 공통 묶음의 `settings` 병합 결과. `settings.set`으로 쓸 수 없다(`profile.put`만 쓴다) |
| `l1.tools.permissionMode`, `l1.models.default` | `allowedScopes`에 `profile` 추가 | 기존 값 | 처음 허용하는 코어 키. 다른 키는 정의의 `allowedScopes`에 `profile`을 더해 연다 [제안] |
| `x.primitives.driveDefaultLimits`, 깊이 상한 키(엔진 설계 §2.3, `x.primitives.driveMaxDepth` [제안: 이름]) | `allowedScopes`에 `profile` 추가 | 기존 값 | 프로필이 바꿀 수 있는 주도 한도. 천장 `x.primitives.driveLimits`는 `profile` 범위를 열지 않는다(프로필이 천장을 넘기지 못한다) |
| `l2.*`, `l3.*` 중 소유 플러그인이 있는 키(예: `l2.web.policy.*`, `l2.mcp.*`, `skills.*`, `memory.*`, `commands.advertise`) | 키 정의의 `allowedScopes`에 개별로 `profile` 추가 | 기존 값 | F §12 O-10과 부록 A가 목록의 정본. 키의 소유 플러그인이 `E`에 있어야 프로필에 둘 수 있다(§4.2.2) |
| `ext.<name>.<key>` (userConfig 키) | `allowedScopes`에 `profile` 추가 | 기존 값. `sensitive` 키는 `SecretRef`(`secret://<이름>`)만 | `settingsFromManifest`(`settings-keys.ts:~88-130`) |
| `x.loading-trust.sourceWatch` | 추가 | boolean, 기본 `true`, `runtimeChange: "live"`, `managed,user` | 원본 폴더 감시(§4.5.7) |
| `l1.context.instructionFiles.maxBytes` | 추가 | integer, 기본 65536, 파일 하나당. `managed,user` | 지침 파일 상한(§4.4.7) |
| `l4.host.defaultFolder` | 추가 | string, 기본 빈 값 = `<OsDirs.data>/default-project`. `managed,user` | 프로젝트 없는 대화의 기본 폴더 [제안 이름] |
| `x.primitives.activeDriver` | 엔진 스펙이 제거 | - | 프로필 `driver`는 더 이상 이 키를 쓰지 않는다(§4.2.6) |

설정 정의에 `ui.block?: "context" | "model" | "tools" | "ask" | "agents" | "record"`를 더한다 [제안]. 화면이 코어 설정을 블록별로 나눠 보이는 근거이고 엔진 동작에는 쓰지 않는다.

### 3.4 wire 메서드

이름 규칙은 `METHOD_NAME_PATTERN`(`method-name.ts:6-7`)을 따른다. 아래 변경은 `WIRE_PROTOCOL_VERSION`(`wire/version.ts`)을 올린다. 오류 이름은 `errors.ts:148-153`의 `profile.*` 계열 옆에 더한다.

| 메서드 | 소유 | params | result | 주요 오류 |
|---|---|---|---|---|
| `profile.list` | F 프로필 wire, 호스트 `handlers/m4/profile-test-run.ts` | `{}` | `{ profiles: Profile[]; common: CommonSet; rev }` | `profile.fileCorrupt` |
| `profile.get` | 같음 | `{ id }` | `{ profile }` | `profile.notFound` |
| `profile.put` | 같음 | `{ profile: ProfileInput; baseRev: number \| null }` | `{ profile; issues: ProfileIssue[] }`(경고만) | `profile.conflict`, `profile.invalid`(`details.issues`에 오류), `profile.limit`, `profile.builtinProtected`(내장의 `id`·`builtin` 변경) |
| `profile.delete` | 같음 | `{ id }` | `{ rev; reassignedThreads: number }` | `profile.builtinProtected`, `profile.notFound` |
| `profile.clone` | 같음 | `{ id; newId; title }` | `{ profile }` | `profile.notFound`, `profile.conflict` |
| `profile.common.get` / `profile.common.put` | 같음 | `{}` / `{ common; baseRev }` | `{ common; issues }` | `profile.conflict`, `profile.invalid` |
| `profile.preview` | 같음 (지금 `ProfilePreviewResult` 대체) | `{ id?: string; draft?: ProfileInput; threadId?: string }`(둘 중 하나) | `{ resolved: PluginRef[]; issues; cost: { total: CostFigures; byPlugin: PluginCost[] }; missingRequired: { plugin; key }[]; threadsUsing: number; permission?: { from; to }; toolsChanged?: { added; removed }; cacheImpact?: "none" \| "tool_change_append" \| "readvertise" }` | `profile.notFound` |
| `profile.defaultFor` | 같음 | `{ workspace?: string }` | `{ profileId }` | -. 계산 규칙은 §4.4.8 [결정: 2026-11-17 사용자, U5] |
| `profile.removePlugin` | 같음 | `{ id; plugin; baseRev: number }` | `{ profile; preview: { threadsUsing; permission?; toolsChanged?; dropsDrive: { threadCount: number } | null } }` | `profile.notFound`, `profile.conflict`, `profile.pluginNotInProfile`(공통 묶음에서 온 것이면 `profile.commonPlugin`) |
| `thread.setProfile` | 호스트 `handlers/thread.ts` | `{ threadId; profileId }` | `{ position; preview: { permission?; toolsChanged?; cacheImpact? } }` | `profile.notFound`, `thread.notFound`, `thread.notOwner` |
| `thread.create` (변경) | 같음 | `profileId`를 `testRun` 없이도 받는다(지금 `thread.ts:35-40`은 `testRun: true`일 때만). `workspace`는 프로젝트 안 폴더 | `ThreadCreateResult`에 `project`, `profileId`, `sameFolder: { threadId; status }[]`(같은 폴더의 다른 열린 대화) 추가 | `project.rootInvalid`, `profile.notFound` |
| `turn.start` (변경) | 호스트 | `overlay?: OverlayRef[]`(최대 4) | `TurnStartResult`에 `cacheImpact?` 추가 | `overlay.notReviewed`, `overlay.notFound`, `overlay.limit`, `overlay.noEntry` |
| `plugin.list` | F 플러그인 wire(새 파일), 호스트 | `{ filter?: { profileId?: string; origin?: string; reviewState?: string } }` | `{ plugins: PluginCard[] }` | - |
| `plugin.get` | 같음 | `{ name }` | `{ card; versions: { hash; approvedAt; current: boolean }[]; source: { path: string; matchesReviewed: boolean } \| null; entries: InvocableEntry[] }` | `extension.notFound` |
| `plugin.invocables` | 같음 | `{ threadId }` | `{ entries: InvocableEntry[] }`(프로필 밖 검토된 플러그인의 명령, 스킬, Drive 시작. 모든 검토된 플러그인은 이름으로 얹는 `kind: "plugin"` 항목을 하나 가진다) | `thread.notFound` |
| `plugin.scan` | 같음 | `{ projectId? }` | `{ queued: string[] }`(새 검토 항목 id) | `project.notFound` |
| `plugin.revert` | 같음 | `{ name }` | `{ restored: true }`(원본 폴더를 현재 검토본 내용으로 되돌림) | `extension.notFound`, `plugin.noReviewedCopy` |
| `plugin.requestRemove` | 같음 (`ext.remove`·`ext.removePreview` 대체) | `{ name }` | `{ itemId }` | `extension.notFound`, `plugin.requiredByCore`(E2의 L1 분할이 끝나기 전까지만: §4.1.17. 분할 뒤에는 이 오류가 없고 모든 플러그인을 뺄 수 있다) |
| `plugin.draft.create` | 같음 | `{ dir; originThreadId? }` | `{ draftId; contentHash; card }` | `plugin.invalid`(`details.issues`), `plugin.tooLarge`, `plugin.symlinkRefused` |
| `plugin.draft.discard` | 같음 | `{ draftId }` | `{}` | `draft.notFound` |
| `pluginReview.list` | F 검토 wire(새 파일), 호스트 | `{ state?: ReviewState; name?: string }` | `{ items: ReviewItem[] }`(`files`와 `card`는 요약) | - |
| `pluginReview.get` | 같음 | `{ itemId }` | `{ item: ReviewItem }` | `pluginReview.notFound` |
| `pluginReview.file` | 같음 | `{ itemId; path }` | `{ path; text: string \| null; truncated: boolean }`(후보 스냅샷의 파일) | `pluginReview.notFound`, `pluginReview.pathInvalid` |
| `pluginReview.submitDraft` | 같음 | `{ draftId }` | `{ itemId }` | `draft.notFound` |
| `pluginReview.decide` | 같음 | `{ itemId; decision: ReviewDecision }` | `{ item; appliedTo: string[] }`(적용된 프로필 id) | `pluginReview.notFound`, `pluginReview.notPending`, `pluginReview.handEditNotAllowed`, `pluginReview.purposeRequired`, `pluginReview.profileInvalid`(`details.issues`) |
| `project.list` | F 프로젝트 wire(새 파일), 호스트 | `{}` | `{ projects: Project[] }` | - |
| `project.get` | 같음 | `{ projectId }` | `{ project; pendingReview: number }` | `project.notFound` |
| `project.create` | 같음 | `{ root; name? }` | `{ project }` | `project.rootInvalid`, `project.exists` |
| `project.rename` / `project.delete` | 같음 | `{ projectId; name }` / `{ projectId }` | `{ project }` / `{}`(대화는 지우지 않는다) | `project.notFound` |
| `project.instructions` | 같음 | `{ workspace }` | `{ files: { path; bytes; included: boolean }[] }` | `project.rootInvalid` |

알림(서버 → 클라이언트): `profile.changed`(지금 `ProfileChangedParams`, 유지. `commonChanged: boolean` 추가), `pluginReview.changed {itemId, state}`, `plugin.changed {name}`, `project.changed`.

이름 공간과 오류 코드 배정(교차 점검 §5-C). 검토함 메서드와 알림은 이미 있는 변경 검토 `review.get`(`wire/dialog-area.ts:497`)과 겹치지 않도록 `pluginReview.*`로 쓴다(오류 이름도 같은 접두). `plugin.*`는 지금의 `ext.*` 곁에 두는 새 접두이고, 없는 플러그인은 새 오류를 만들지 않고 기존 `extension.notFound`(3401)를 쓴다. 오류 코드는 프로필 계열이 3300~3399의 남은 자리, 프로젝트·플러그인·덧씌우기·초안이 3600~3649, 검토함(`pluginReview.*`)이 3650~3669이고 3670~3699는 예약이다. 기록·지표(E)는 3500~3599, 블록(F `blocks.*`)은 3700~3719다. `WIRE_PROTOCOL_VERSION`은 M5 트랙이 각자 올리지 않고 통합 담당이 한 번에 올린다.

제거: `profile.apply`, `ProfileApplyParams`, `ProfileLayer`, `PROFILE_LAYERS`(`xeon/packages/contracts/src/wire-settings/wire/profile-test-run.ts:151`), `ext.install`, `ext.installPreview`, `ext.remove`, `ext.removePreview`(`devkit.ts:451-454`). 유지: `ext.list`, `ext.get`, `ext.health`, `ext.timings`, `ext.reload`, `ext.versions`, `ext.rollback`, `ext.reenable`, `ext.disableConfirm`(오류 정지 상태를 풀거나 확정하는 일에만 쓴다. 켜기·끄기 스위치가 아니다), `ext.scaffold`, `ext.validate`, `ext.package`, `ext.test.*`, `ext.ui.*`. `ext.list`의 `enabledSource`(`xeon/packages/contracts/src/wire-settings/wire/ext-read.ts:48`, 지금 `managed, thread, project, user, default`)를 `core | common | profile | overlay | managed | none`으로 바꾼다.

`InvocableEntry`: `{ plugin: string; entry: string; kind: "skill" | "command" | "drive" | "plugin"; title: string; reviewedHash: string }`. `kind: "plugin"`은 이름으로 플러그인 전체를 얹는 입구이고 Hook 전용·도구 전용 플러그인처럼 사용자가 직접 부를 스킬·명령·Drive 시작이 없는 플러그인도 일회 사용으로 얹을 수 있게 한다(§4.3.2).

### 3.5 포트 (엔진 내부)

| 포트 | 소유 | 내용 |
|---|---|---|
| `PluginSetPort` | F `extensions/ports.ts`에 정의, 호스트가 구현해 X에 주입 | `resolve(threadId): { plugins: readonly string[]; profileId; profileRev; commonRev }`. X는 호스트의 프로필 저장소를 import하지 않는다(DR-14) |
| `MaterialPort` | F `extensions/ports.ts`, X가 구현 | `instructions(threadId): { key; text }[]`(문맥 조립이 `sections`로 쓴다), `skillRoots(threadId)`, `agentDefinitions(threadId)`, `mcpServers(threadId)`, `commands(threadId)` |
| `PluginSubmitPort` | F, 호스트 구현 | 담당 AI(플러그인 빌더)만 부른다: `submit({ dir, originThreadId, evidence, purpose? }) → { draftId, itemId }`. 내부에서 `plugin.draft.create`와 `pluginReview.submitDraft`를 한 번에 한다(§4.9). wire 메서드가 아니다 |

### 3.6 테스트 대화, 테스트 실행, 초안 목록, 제출 [M6 요청 M5c-1·2·4·5·6·7·9·10·11·13 반영]

```ts
// F: 초안 (plugin.draft.*)
export interface DraftInfo {
  readonly draftId: string; readonly name: string; readonly contentHash: string;
  readonly parent: string | null;           // 같은 플러그인에서 바로 앞 초안(없으면 null)
  readonly createdAt: string; readonly originThreadId: string | null;
  readonly label: string | null;            // 사용자나 빌더가 붙인 한 줄(최대 80자)
  readonly submittedItemId: string | null;  // 검토함으로 보냈으면 그 항목
}
// plugin.draft.create 결과에 DraftInfo가 합쳐진다: { draftId; contentHash; card; info: DraftInfo }

// 검토 결정과 항목 추가분
export type ReviewDecision = /* §3.1의 것 */
  | { kind: "approve"; profileIds: string[]; libraryOnly: boolean; purpose?: string }   // purpose: 목적 문장이 없을 때 승인하면서 채운다(§4.7.6). 해시에 영향 없음
  | { kind: "sendBack"; reason: string } | { kind: "discard" };
export interface ReviewItemRemoval {         // ReviewItem.removal. kind가 remove일 때만
  readonly affectedProfiles: readonly { profileId: string; title: string }[];   // 공통 묶음은 id "common"
  readonly removes: { readonly state: boolean; readonly records: number | null }; // 같이 지워지는 상태 문서 여부, 턴 기록 수(모르면 null)
  readonly baseCard: PluginCard;             // 지울 플러그인의 지금 카드
}
// ReviewItem에 removal: ReviewItemRemoval | null 을 더한다. update 항목의 baseCard는 diff가 이미 이전 검토본과 비교하므로 두지 않는다

// plugin.get 추가분
export interface SettingDef { readonly key: string; readonly label: string; readonly default: unknown; readonly required: boolean; readonly secret: boolean }
export interface UiDecl { readonly id: string; readonly placement: string; readonly readsState: string | null; readonly modelVisible: "none" | "partial" | "all" }
// plugin.get result에 settingsDefs: SettingDef[]. InjectInventory.ui는 string[]에서 UiDecl[]로 바꾼다(저장된 문자열이 아니라 읽기 전용 계산값이라 더하기 규칙에 걸리지 않는다)

// 프로필 추가분
// Profile.hidden?: boolean — 참이면 profile.list에 나오지 않는다. 숨은 시스템 프로필(§4.8.5)만 쓴다
export interface TestRunStart {
  readonly baseProfileId: string;            // 기준 프로필. 숨은 프로필은 안 된다
  readonly drafts: readonly { plugin: string; draftId: string }[];   // 1~4개. 같은 이름의 검토본이 있으면 이 테스트 대화 안에서 초안이 대신한다
  readonly runGroupId?: string;              // 같은 입력으로 다시 돌릴 때 같은 값
  readonly input?: string;                   // 첫 사용자 입력. 없으면 사용자가 칩에서 입력
}
```

| 메서드 | params | result | 주요 오류 |
|---|---|---|---|
| `plugin.draft.list` | `{ name: string }` | `{ drafts: DraftInfo[] }`(최신 먼저, 보관 상한 §4.9.2) | `extension.notFound` |
| `testRun.start` | `TestRunStart` | `{ threadId; runGroupId; profileId: string }` | `profile.notFound`, `draft.notFound`, `testRun.draftUnavailable`(P1 전), `profile.invalid`(합성 검증 실패, `details.issues`), `overlay.limit` |
| `profile.default.reset` | `{ preview?: boolean }` | `{ profile; changed: { plugins: boolean; settings: boolean }; threadsUsing: number }` (`preview: true`면 바꾸지 않고 변화만 돌려준다) | `profile.conflict` |
| `craftChat.open` | `{ plugin?: string; contexts?: ContextRef[]; intent?: string; reuse?: "last" \| "new" }` | `{ threadId; plugin: string \| null; created: boolean }` | `extension.notFound`, `craftChat.contextInvalid` |
| `craftChat.list` | `{ plugin?: string }` | `{ items: { threadId; plugin: string \| null; title: string \| null; lastActivityAt: string; status: string; draftCount: number; lastDraftId: string \| null; pendingItemId: string \| null }[] }` | - |
| `thread.list` (변경) | `include?: "craft"` | 기존 | - |
| `thread.create` (변경) | `craftChat?: { plugin?: string; contexts?: ContextRef[] }` (`craftChat.open`이 내부에서 쓴다. 클라이언트는 `craftChat.open`만 부른다) | 기존 | `profile.builtinProtected` |
| `profile.preview` (변경) | 결과에 `dropsDrive: { threadCount: number } \| null`(그 변경이 Drive 중인 플러그인을 빼서 프레임을 내리는 열린 대화 수. 없으면 null) | | |
| `project.list` (변경) | 결과의 각 프로젝트에 `threadCount: number`, `runningCount: number` | | |

알림: `craftChat.changed { plugin }`(초안이 생기거나 검토 결과가 오면). 새 오류는 이름만 정하고 숫자는 3600~3649 안에서 구현 때 순서대로 배정한다.

```ts
// F: wire-settings (추가)
export type ContextRef =
  | { kind: "plugin"; name: string }
  | { kind: "finding"; findingId: string }                    // 근거는 호스트가 E의 findings.bundle로 푼다
  | { kind: "turn"; threadId: string; turnId: string }
  | { kind: "call"; threadId: string; turnId: string; toolCallId: string }
  | { kind: "replay"; runId: string }
  | { kind: "review"; itemId: string }
  | { kind: "draft"; draftId: string };
// 저장: thread.started.craftChat?: { plugin: string | null; contexts: ContextRef[] }, thread.updated.craftChat?: { plugin: string }(처음 묶일 때 한 번), 새 기록 종류 craft.context { refs: ContextRef[]; intent: string | null }
```

적용하지 않은 요청과 이유:
- **M5c-2의 덧씌우기 수명 값 `thread` 추가**: 적용하지 않는다. 테스트 실행의 초안은 덧씌우기가 아니라 테스트 대화의 구성이라서(§4.8.8) `until`은 `turn | release`로 둔다. 새 저장 값을 만들지 않으면 E의 `OverlayMark`가 바뀌지 않는다.
- **M5c-12 프로젝트 기본 프로필**: 적용하지 않는다. [결정: 2026-11-17 사용자, U5]와 §4.4.8이 "프로젝트 기본 프로필은 없다"고 정했다. M의 요청은 결정이 아니라 낡은 모순이었다.
- **M5c-3 이름으로 얹기, M5c-8 `profile.removePlugin`**: 이미 이 문서에 있다(§3.4).

## 4. 동작 규칙

### 4.1 대화와 프로필

1. 모든 대화는 프로필 하나를 참조한다. 현재 값은 활성 가지의 마지막 `thread.updated.profileId`, 없으면 `thread.started.profileId`, 그것도 없으면 `default`다. 값이 가리키는 프로필이 없으면 `default`로 읽고 대화를 열 때 `profile.applied { reason: "profile_missing" }`를 남긴다.
2. 내장 기본 프로필(`default`)은 삭제할 수 없고(`profile.builtinProtected`), 공장 값은 권한 모드 `bypass`(`core-tools/src/settings.ts:55`, 2026-11-13 결정), 시작 Drive 없음, 플러그인은 매니페스트 기본이 켜짐인 기본 설치 플러그인(`bundled` 출처와 저장소 패키지 가운데 코어가 아닌 것)이다. 내용은 사용자가 고칠 수 있다. 권한 모드를 프로필이 가진다 [결정: 2026-11-16].
3. 대화 T의 켜짐 집합은 경계마다 `E(T) = 코어 ∪ (공통.plugins ∪ 프로필.plugins ∪ 덧씌우기) − 관리 잠금 − 오류 정지`다. 코어는 tier `guard`, `core`(`tier.ts:assignTier`)이고 프로필에 적지 않으며 항상 켜진다. 순서는 공통, 프로필 순이고 중복은 처음 것을 남긴다.
4. 프로필 저장(`profile.put`, `profile.common.put`)이 커밋되면 호스트가 `profile.changed`를 보내고, 그 프로필을 참조하는 모든 열린 대화에 대해 다음 단계 경계에서 `E(T)`를 다시 계산해 적용한다. 유휴 대화는 다음 매크로태스크에서 적용한다(`X.primitives.spec` §4.5.5). 열려 있지 않은 대화는 열 때 계산한다.
5. 적용은 지금의 대화별 켜짐 요청 경로(`registration.ts:835-871` `toggle`, `:894-899` `request`, `:963` `applyToggles`)를 재사용한다. 계산 결과와 현재 상태의 차이만 켜기·끄기 요청으로 바꾸고, 경계 기여에 `profile.applied`와 `scope.changed`를 넣는다. `profile.applied.added/removed`는 집합 차이다.
6. 실행 중인 턴 안의 프로필 편집이나 전환도 같은 규칙이다: 현재 단계는 끝까지 이전 집합으로 돌고 다음 단계 경계에서 바뀐다. 이미 시작한 도구 호출은 끝나고 결과가 기록된다.
7. 설정 값도 같은 경계에서 바꾼다. 대화의 `profile` 범위 층은 `공통.settings`와 `프로필.settings`의 병합(프로필이 이긴다)이다. `runtimeChange`가 `restart`인 키(예: `ext.<name>.isolation`)는 다음 시작까지 이전 값을 쓰고 `profile.preview`가 경고한다.
8. 대화 전환 `thread.setProfile`은 프로필이 있으면 `thread.updated { profileId }`를 커밋하고 4~6번 규칙으로 적용한다. 전환으로 권한 모드가 넓어지면 결과의 `preview.permission`에 `from`, `to`를 싣고 확인은 받지 않는다 [결정: 2026-11-16]. 승인 카드의 "이 대화에서 계속 허용"은 대화의 실행 상태이고 프로필 전환이 지우지 않는다 [결정: 2026-11-16].
9. 플러그인별 켜기·끄기 조작은 wire와 설정에 없다. `RegistrationHandle.enable()·disable()`(`registration.ts:806-807`)은 엔진 안(자동 끄기, 안전 모드, 프로필 계산)에서만 쓴다. 전역 `record.desired`와 `wantedBy`(`registration.ts:225`)는 "프로필이 원하고(`E(T)`에 있고) 오류 정지가 아닐 때만 켜짐"으로 바뀐다. `defaultEnabled`는 `default` 프로필 공장 값 계산과 마이그레이션(§7)에서만 읽는다.
10. 관리 범위 `ext.<name>.enabled = false`는 `E(T)`에서 그 플러그인을 뺀다(프로필이 넣어도 이긴다). 이때 `ext.list`의 `enabledSource`는 `managed`이고 프로필 저장은 `managed_forbidden` 경고를 낸다. 사용자 범위에 이 키를 쓰는 `settings.set`은 `settings.scopeNotAllowed`로 거절한다.
11. 플러그인의 코드는 `E(T)`에 처음 들어올 때 적재한다(지금 `loading-trust/index.ts:837`, `:1670`의 `enabled` 설정 검사를 `PluginSetPort`의 "어느 열린 대화라도 쓰나"로 바꾼다). 어느 대화도 쓰지 않게 되면 정리(`onDispose`)를 실행한다(`X.primitives.spec` §4.5.3 끄기 4단계).
12. 오류로 멈춘 플러그인은 상태로 보이고 스위치가 없다: `health.state: "stopped"`, `ext.list.autoDisabled: true`. 모든 대화의 `E(T)`에서 빠진다. 사용자는 `ext.reenable`로 재시도하거나 프로필에서 뺀다. 프로필 편집이 정지 상태를 풀지 않는다.
13. 프레임 처리: 플러그인이 `E(T)`에서 빠질 때 그 플러그인이 쥔 Drive 프레임과 그 위의 프레임을 모두 내리고, 아래 프레임에는 `last: { kind: "handoff", status: "aborted" }`를 준다(엔진 설계 §2.4). 맨 아래 프레임이면 코어 루프로 돌아간다. 해제는 경계에서 하지만 진행 중 명령의 취소는 즉시다(주도 함수에 `signal`을 주지 않는다. 엔진이 진행 중 명령을 취소하고 격리된 경우 요청 취소를 보낸다: 엔진 설계 §2.4). 해제 사유는 저장된 `lease.released.reason`의 `disabled`다(엔진 설계 §2.6의 표. 사용자 중지는 `revoked`다).
14. 프로필 삭제는 참조하는 대화를 `default`로 다시 읽게 한다(1번). 삭제 결과의 `reassignedThreads`는 호스트가 아는 열린 대화 수다.
15. 서브에이전트: 자식 대화의 `thread.started.profileId`는 생성 시점의 부모 값이다. 이후 그 프로필의 편집은 자식에게도 적용된다. 부모의 이후 전환은 이미 도는 자식을 바꾸지 않는다 [제안]. 대화 폴더는 부모 것을 물려받고(`core-agents/src/service.ts:1033-1043`이 이미 한다. fork 경로 제외) 권한은 부모 천장을 넘지 못한다(`core-agents/src/permission-ceiling.ts`). 덧씌우기는 물려주지 않는다 [제안].
16. 프로필 변경의 감사 가능성: 한 대화에서 어느 프로필 개정(`profileRev`, `commonRev`)과 어느 검토본 해시로 돌았는지는 `profile.applied`의 `profileRev`, `commonRev`, `updated`로 복원된다.
17. **내장 플러그인을 프로필에서 빼는 일의 순서.** `cap-workspace`와 `cap-dialog`의 코어 부분(F D-27·D-28, 엔진 설계 E2의 L1 분할)이 L1로 내려가기 전에는 이 둘을 프로필에서 뺄 수 없는 필수로 표시한다(빼면 도구 파이프라인의 파일 서비스와 사람에게 묻기가 사라진다). 분할 뒤에는 코어가 아니라 플러그인으로 남는 부분만 뺄 수 있다. 코어는 프로필에 적지 않고 항상 켜져 있다(3번). "뺄 수 없는 플러그인"은 없다 [엔진 설계 §8, 결정: 2026-11-17 사용자, U4 확정]. 이 표시와 오류 `plugin.requiredByCore`는 L1 분할 전의 일시 조치이고 분할 뒤 삭제한다(코어는 코어이고 모든 플러그인은 프로필에서 뺄 수 있다). 쓰기 범위(§4.4.4)가 고치는 `cap-workspace/src/roots.ts`, `shell/run.ts`는 F가 새 코어 서비스로 옮기는 파일이므로 §4.4.4의 구현은 그 이동(F 9절 6단계) 뒤의 경로에서 한다.

### 4.2 프로필 내용과 검증

1. 플러그인 목록은 순서가 있다. 같은 자리(같은 Hook)에 여럿이 걸릴 때 기본 호출 순서는 `E(T)`의 순서(공통 묶음, 프로필, 덧씌우기 순. 중복은 처음 것)다. tier가 먼저이고 같은 tier 안에서 `loadIndex`를 `E(T)` 위치로 정한다 [제안]. tier 체계는 F §5.2 O-2가 정한다: [결정: 2026-11-17 사용자, U3] 등급을 셋으로 줄이고 guard를 맨 앞에 둔다. 등급 이름 `guard` / `plugin`(번들·사용자·프로젝트 전부 한 등급) / `core`(맨 뒤)와 그 순서는 [제안]이다. 줄이면 번들·사용자·프로젝트의 구분이 정렬에서 빠지고 프로필 목록 순서가 그 일을 한다. 구현(M5e-2) 전에는 `tier.ts:orderKeyOf`가 지금 규칙을 쓴다. 블록 상세에서 순서를 바꾸는 방법은 Hook 정리 스펙(F §5.2)이 정한다.
2. 플러그인 설정 값은 `settings`에 `ext.<name>.<key>`로 두고, 소유 플러그인이 정해진 `l2.*`/`l3.*` 키(§3.3 표)도 같다. 정하지 않은 키는 플러그인 기본값을 쓴다(유효 값 계산이 `profile` 층에서 값을 못 찾으면 아래 층으로 내려간다). 키 정의의 소유 플러그인이 `E`(공통 묶음, 프로필)에 없으면 저장할 수 없다(`setting_unknown_key`).
3. 시크릿 값: 정의가 `secret: true`(`SecretRef` 타입)인 키는 `secret://<이름>` 형태만 저장한다. 리터럴이면 `secret_literal` 오류이고 값은 이벤트, 로그, 오류에 싣지 않는다. 시크릿 저장소에 이름이 없으면 `secret_missing` 경고다. 프로필은 참조만 가지고, 값은 사용 때 `fresnel.secrets`가 연다(`L0.secrets.spec` §4.2, §4.3).
4. 코어 설정 값: 키 정의의 `allowedScopes`에 `profile`이 있는 키만 둔다. 검사는 지금의 `checkSettingWrite`(`profile-test-run-port.ts:125`)를 `profile` 범위로 호출한다. 프로필이 권한 모드를 두지 않으면(미설정) 아래 층의 값(사용자 파일, 기본값 `bypass`)이 쓰인다. 새 프로필은 만들 때 `default`의 코어 설정 값을 복사해 시작한다 [제안].
5. 공통 묶음은 같은 검증을 받는다. 시작 Drive는 없다. 공통 묶음에 든 플러그인을 프로필에서 뺄 수 없다 [제안].
6. 시작 Drive는 `driver` 한 필드라서 둘이 겹칠 수 없다. 값은 `E`에 들고 `drives: true`이며 시작 항목(`does.drive.start`)이 있어야 한다. 아니면 `driver_not_in_list`, `driver_cannot_drive`다. 엔진은 새 대화의 첫 턴 앞에서 스택이 비어 있을 때만 그 플러그인의 프레임을 쌓는다(엔진 설계 §2.2). 도중 전환(`thread.setProfile`)은 시작 Drive를 시작하지 않는다 [제안: 미결 3].
7. 검증은 저장과 `profile.preview`에서 같은 함수(`validateProfile(profile, common, library, catalog)`)가 한다. 오류(`error`)가 하나라도 있으면 `profile.put`을 `profile.invalid`로 거절하고 저장하지 않는다. 오류:
   - `plugin_unknown`(라이브러리에 없음), `plugin_not_reviewed`(검토본이 없고 승인 대기뿐)
   - `replace_conflict`: 해소된 목록 안에서 두 플러그인이 `replaces`로 같은 내장 도구를 대체(`PluginDecl.replaces`, `manifest.ts:147`). 플러그인 둘의 이름과 도구 이름을 싣는다
   - `driver_not_in_list`, `driver_cannot_drive`
   - `setting_unknown_key`, `setting_scope_not_allowed`, `setting_invalid_value`, `secret_literal`
   - `limit`(`plugins` 128, `settings` 128, 프로필 200)
   경고: `secret_missing`, `required_unset`(필수 `userConfig`가 비어 있음. 그 플러그인은 대화에서 `waiting`(`config_required`)으로 보이고 켜지지 않는다), `requirement_unmet`(필요한 기능이 목록 안에 없음. 기존 Registration `waiting`), `managed_forbidden`.
8. 비용 미리 보기 입력은 카드의 `cost`(`CostFigures`: `always`, `drive`, `onDemand`, `toolCount`, `basis`)다. `profile.preview.cost`는 해소된 목록의 정적 추정 합계(항상 / 필요할 때 / Drive 중)와 플러그인별 값이고, 측정값과 턴 기록 기반 값은 E의 `profileCost.get`이 낸다(같은 필드명, `basis`가 `measured`·`estimated`). 주도 중에만 싣는 지침은 훅이 넣으므로(§9.1) 정적 `drive` 값의 원천이 없다: 선언이 없으면 `null`, `basis: "unknown"`이고 E가 측정에서만 `inferred`로 채운다. 토큰은 문맥 조립이 쓰는 추정기와 같은 것으로 센다(`core-context/src/assemble.ts:242` `textTokens`). 항상 싣는 양 = 지침 파일 + 선언된 도구 설명. 필요할 때 = 스킬 색인 줄(설명 글자 수)과 본문 크기. 선언이 없는 코드 플러그인의 도구 비용은 `null`이다(`basis: "declared" | "unknown"`. `CostBasis`는 E §3.3이 `measured | estimated | declared | unknown` 넷으로 한 번 정의한다).
9. 같은 프로필의 `settings`에 같은 키가 둘이면 마지막 값이 이긴다(지금 `collapsed`, `profile-test-run-port.ts:66-75`와 같다).

### 4.3 덧씌우기

1. 대상은 검토된 플러그인(현재 검토본이 있는 것)과 초안이다. 검토본이 없는 후보를 이름으로 지정하면 `overlay.notReviewed`다. `draftId`는 `plugin.draft.create`가 만든 스냅샷만 가리킨다.
2. 사용자가 프로필 밖 플러그인의 스킬, 명령, Drive 시작을 직접 부르면 클라이언트가 `plugin.invocables`로 목록을 얻고 `turn.start { overlay: [...] }`로 보낸다. 모든 플러그인 유형(Inject, Hook, Drive, 도구)을 허용한다 [결정: 2026-11-17 사용자]. 스킬·명령·Drive 시작이 없는 Hook 전용·도구 전용 플러그인은 `kind: "plugin"` 항목(이름으로 얹기)으로 부른다(`OverlayRef.entry`를 생략하면 이름으로 얹는다). 사용자가 직접 부른 스킬·명령은 턴 입력(`turn.started`의 선택 필드 `invoked: { plugin; entry; kind }[]` [제안])에 남겨 기록(E)이 `via: "user"`로 읽는다.
3. 적용 시점은 그 턴의 입력 처리 앞이다. `E(T)`에 대화의 덧씌우기가 더해지고 `profile.applied { reason: "overlay_on", overlay }`가 한 번 남는다. 이미 `E(T)`에 있는 플러그인을 지정하면 아무것도 하지 않고 `alreadyInProfile`로 본다.
4. 해제: Inject와 Hook과 도구는 그 턴이 정착할 때, Drive 항목은 그 플러그인 프레임이 어떤 이유로든 해제될 때(`lease.released`, 사용자 중지, 오류)다. 프로필 전환은 해제 사유가 아니다. 해제 때 `profile.applied { reason: "overlay_off" }`를 남긴다. 중지는 스택 전체를 내리므로 모든 덧씌우기가 해제된다(엔진 설계 §2.4).
5. 재시작 복원: 턴 덧씌우기는 활성 가지의 `overlay_on`에 짝 `overlay_off`가 없고 그 턴이 정착하지 않았으면 이어서 쓴다. Drive 덧씌우기는 복원된 프레임 스택에서 프로필 밖 플러그인을 덧씌우기로 되살린다(프레임이 `lease.acquired.contentHash`를 가진다).
6. 덧씌우기는 프로필, 공통 묶음, `usedBy`를 바꾸지 않는다. 검토본의 프로필 설정 값은 프로필 쪽에 있으므로 덧씌우기 플러그인은 플러그인 기본값으로 돈다 [제안]. 덧씌우기 플러그인이 필수 설정을 가졌고 값이 없으면 `waiting`이 되고 흔적에 표시한다.
7. 도구를 더하는 덧씌우기는 그 턴의 도구 목록을 바꾼다. 프롬프트 캐시 처리는 `L1.context.spec` §4.3을 따른다: 모델 캐시 정책의 `midConversationToolChanges`가 참이면 `tool_change` 항목을 덧붙이고(접두는 그대로, 캐시가 깨지는 곳은 덧붙인 위치부터), 거짓이면 명시 재광고(`readvertise(explicit)`)로 그 턴에 한 번 접두 캐시를 다시 쓴다. 해제 때는 제거를 덧붙일 수 있으면 덧붙이고 못 하면 광고 목록을 두며(호출은 디스패치가 거부한다) 두 번째 재광고를 강제하지 않는다. 결과는 `turn.start`의 `cacheImpact`로 알린다. Hook과 지침만 더하는 덧씌우기는 도구 목록을 바꾸지 않는다. 지침을 더하면 `sections`가 바뀌므로 `midConversationSections`가 거짓이면 다음 컴팩션까지 모델에 보이지 않는다. 덧씌우기가 지침을 싣는 경우 이 제약을 흔적에 표시한다 [제안].
8. 초안 덧씌우기: 초안은 스냅샷 폴더에서 격리된 플러그인 프로세스로 돈다(엔진 설계 §3). 격리 프로세스는 격리 1단계(P1)가 있어야 하므로 **P1 전에는 초안 덧씌우기를 켜지 않고 `overlay.draftUnavailable`로 거부한다**(이 규칙은 [권고: 메인 세션, 확인 대기]이고 §10-12가 대안을 적는다). 같은 이름의 검토본이 있으면 이 대화에서는 초안이 그 자리를 대신한다(그래서 같은 이름의 두 `versionId`가 한 대화에서 번갈아 쓰일 수 있고 프로세스 키는 `(이름, draftId)`다). `profile.applied.overlay[].draftId`가 초안 표지의 원천이고, 호스트 기록기가 이로부터 그 턴에 `scope_kind = overlay_draft`를 쓴다(표지의 정본은 E §4.6 규칙 31이다). 지표 집계는 `scope_kind`로 초안 활동을 뺀다(§9.2). 초안은 자동 끄기 장부의 실패 횟수에 넣지 않는다 [제안]. 초안 덧씌우기는 프로젝트 동반 플러그인에는 쓸 수 없다(초안은 사용자 자신의 폴더에서만 만든다).
   - **[결정: 2026-11-17 사용자, U2] 초안이 `bypass` 대화에서 실제 작업에 이를 때.** 프로필 `default`의 권한 모드는 `bypass`이고 플러그인 호출도 대화의 권한 모드로 평가한다(F §5.3 U-6). 그러면 검토 전 코드(초안)가 승인 없이 파일을 쓸 수 있다. 사용자가 정했다: 초안 출신 호출은 모드와 무관하게 항상 승인 카드를 띄우고 "초안" 표시를 단다. 같은 결정이 craft-flow §2 R2의 "[확인 대기]"를 닫는다.
9. 덧씌우기 한도: 한 턴에 4개. 넘으면 `overlay.limit`.
10. **일회 사용의 입구는 입력창의 `/`다** [결정: 2026-11-17 사용자]. 스킬, 명령, Drive 플러그인, Hook 전용·도구 전용 플러그인 모두 `/`로 부른다. 명령이 없는 플러그인(Hook 전용, 도구 전용)은 `/<플러그인 이름>`이 그 플러그인 전체를 그 턴에 덧씌운다(Drive는 프레임이 해제될 때까지, 시작 항목이 있으면 `/<이름>`은 그 시작이다). 대상은 검토된 플러그인뿐이다. 초안은 `/`의 이름 해석에 나오지 않고 사용자가 명시로 고를 때만 얹힌다(T6 카드의 "이 대화에서 써 보기", 또는 정확한 `/draft:<이름>`. 초안 출신 호출은 U2대로 항상 카드).
    - **이름 해석 규칙** [제안, 기본값]: `/<이름>`은 클라이언트가 `plugin.invocables`의 항목(스킬·명령·Drive 시작·`kind: "plugin"`)으로 푼다. 우선순위: (1) 이미 `E(T)`에 든 플러그인의 명령·스킬, (2) 프로필 밖 검토된 플러그인의 명령·스킬, (3) 플러그인 이름(`kind: "plugin"`). 같은 층에서 이름이 둘 이상이면 자동으로 고르지 않고 목록을 보여 사용자가 고르게 한다. 플러그인 이름이 어떤 명령·스킬 이름과 같으면 명령·스킬이 이긴다: 이때 플러그인 전체를 얹으려면 `/plugin:<이름>`, 특정 항목은 `/<플러그인>:<항목>`으로 한정한다. 엔진은 이름을 풀지 않는다: 클라이언트가 푼 `OverlayRef { plugin, entry? }`를 `turn.start.overlay`로 받고 검토본 여부만 검사한다(`overlay.notReviewed`, `overlay.notFound`).

### 4.4 프로젝트

1. 프로젝트는 `projects.json`의 `Project`다. `root`는 존재하는 절대 폴더이고 심볼릭 링크를 푼 정규 경로로 저장한다. 같은 정규 경로가 이미 있으면 `project.exists`, 폴더가 없거나 절대 경로가 아니면 `project.rootInvalid`. 루트가 다른 루트 안에 있는 중첩은 허용한다.
2. 소속은 저장하지 않고 계산한다: 대화 폴더(`thread.started.workspace`)를 포함하는 루트 가운데 가장 깊은 것이 그 대화의 프로젝트다. 프로젝트를 새로 만들면 그 안의 기존 대화가 따라 들어온다. 프로젝트를 지워도 대화는 남고 같은 계산으로 바깥 루트에 속하거나 4번 규칙의 "프로젝트 없음"이 된다. 루트 폴더를 옮기거나 이름을 바꾼 경우는 다루지 않는다(미결 6).
3. 대화 폴더는 루트 안의 아무 하위 폴더다. 구성 제약이 없다 [결정: 2026-11-17]. `thread.create { workspace }`가 어느 루트에도 속하지 않는 폴더를 주면 호스트가 그 폴더를 루트로 하는 프로젝트를 만든다(`result.project`에 알린다) [제안: 미결 2]. 이렇게 하면 `fresnel` CLI의 cwd 시작과 예약 실행(`handlers/schedule.ts:59`)이 그대로 동작한다.
4. 쓰기 허용 범위는 프로젝트 루트 전체다 [결정: 2026-11-17 사용자]. 지금 읽기·쓰기 허용 root는 대화 폴더 하나다(`cap-workspace/src/roots.ts` `defaultRoots`, `scope.ts:21-24`). 바꿀 곳: `scopedDeps`가 `workspaceOf` 대신 프로젝트 루트를 만들고, `env.cwd`는 대화 폴더로 두며, `roots.write = [프로젝트 루트]`, `roots.read = [프로젝트 루트, 출력 사본 폴더]`로 한다 [제안: 읽기도 루트까지]. 샌드박스의 쓰기 root(`shell/run.ts:179` `workspaceRoots`)가 같은 값을 받는다. 보호 경로(`.git/hooks` 등)는 그대로다.
5. 프로젝트가 없는 대화(`workspace` 없이 생성): 기본 폴더 아래에 대화 폴더를 만든다. 경로는 `<기본 폴더>/<threadId>`이고 생성 때 만든다. 기본 폴더는 `l4.host.defaultFolder`(빈 값이면 `<OsDirs.data>/default-project`)다. 지금은 호스트 프로세스의 cwd로 떨어진다(`ThreadStartedPayload.workspace` 주석 `lifecycle.ts:57-60`, `scopedDeps`가 `workspace === null`이면 그대로 둠). 이 대화들의 "프로젝트"는 id `prj_default`의 암묵 프로젝트이고 `projects.json`에 없다. 쓰기 범위는 대화 폴더(`<기본 폴더>/<threadId>`)다(기본 폴더 전체는 아니다) [제안: 서로 무관한 대화가 파일을 섞지 않게. 미결 1].
6. 이미 `workspace`가 null인 기존 대화는 읽기 전용으로 열지 않고 지금처럼 호스트 cwd를 쓴다(저장된 대화의 동작을 바꾸지 않는다) [제안]. 마이그레이션 §7.6.
7. 지침 파일: 대화를 시작한 폴더 F와 프로젝트 루트 R에 대해 R에서 F까지 각 폴더의 `AGENTS.md`를 R이 먼저, F가 마지막인 순서로 모은다. 모델 문맥에 넣는 방법은 `sections`다: 키 `project:<R 기준 상대 경로>`, 값은 파일 내용 그대로(머리말이나 설명 문장을 더하지 않는다. 최소 하네스 [결정: 2026-11-12 사용자, 메모리]). 지금 `core-loop/src/loop/prepare-request.ts:95`가 `sections: {}`로 고정이고 `AGENTS.md`를 읽는 코드는 코어에 없다(`grep` 결과 없음). 문서(`data-privacy.md:121,136`, `loading-trust/spec.md:1246`)는 읽힌다고 적었으므로 이 항목이 그 문서 내용을 실제로 만드는 일이다.
   - 파일 하나가 `l1.context.instructionFiles.maxBytes`를 넘으면 그 파일을 싣지 않고 진단(`instruction_too_large`)만 남긴다.
   - R 밖으로 나가는 심볼릭 링크는 읽지 않는다. 읽기 실패는 건너뛰고 진단을 남긴다.
   - 읽는 시점은 대화를 열 때와 각 턴 시작이다(수정 시각 비교). 바뀌면 `sections` 변경 규칙(`L1.context.spec` §4.2)을 따른다.
   - `CLAUDE.md`는 읽지 않는다 [제안: 사용자 결정은 `AGENTS.md`만 말한다. 미결 5].
8. 프로필은 사용자 수준이고 프로젝트와 독립이다. 프로젝트 레코드에 프로필 필드가 없다("프로젝트 기본 프로필"은 없다 [결정: 2026-11-17 "플러그인과 프로필은 프로젝트가 아니라 대화 단위"]). **[결정: 2026-11-17 사용자, U5]** 선택기의 기본값은 같은 대화 폴더에서 마지막으로 쓴 프로필(저장 없이 계산). 세부 계산 규칙은 [제안]이다: `profile.defaultFor { workspace }`는 `thread.list { workspace }`가 주는 가장 최근 대화의 현재 프로필(전환 반영)을 돌려주고, 없으면 같은 프로젝트의 가장 최근 대화, 그것도 없으면 `default`다 [제안: 계산 규칙. 저장 없음]. `thread.create`에 `profileId`가 없으면 같은 값을 쓴다.
9. 같은 폴더 동시 대화: 코어는 정책이 없고 알리기만 한다. `thread.create`는 같은 정규 대화 폴더에서 `running` 또는 열린 다른 대화를 `sameFolder`에 담아 돌려준다. 막지 않는다. worktree 분리는 플러그인이 하고, 코어는 "대화 시작" 훅이 대화 폴더를 정할 수 있게만 연다. **[결정: 2026-11-17 사용자, U6]** 코어는 알리기만 하고(막지 않고 자동 복사도 없다) 폴더는 대화 시작 훅이 경로 하나로 정하며 worktree는 플러그인이 한다. 훅 결과의 `workspace`가 있으면 호스트가 `thread.updated { workspace }`를 커밋한다. 조건은 첫 턴 전이고, 새 폴더가 같은 프로젝트 루트 안이어야 하며, 아니면 무시하고 진단을 남긴다(`workspace_outside_project`). 받을 훅과 결과 모양은 F §5.1 H-7이 정한다(`thread.start`는 관찰만 하는 tap이라 값을 돌려주지 못한다). 수용 22의 후반은 F H-7이 구현된 뒤 켜진다.
10. 프로젝트 동반 플러그인(R24): `project.create`, 프로젝트 안 대화 생성, `plugin.scan {projectId}`, 원본 감시가 `<루트>/.fresnel/plugins/*`와 기존 `<루트>/.fresnel/extensions/*`, Fresnel 자체 배치의 느슨한 자원(`.fresnel/skills`, `.fresnel/commands`, `.fresnel/agents`, `.fresnel/prompts`, `.fresnel/mcp.json`)을 후보로 만든다. 후보는 `origin: project`로 검토 항목이 된다. 승인 전에는 적재도, 문맥 재료로 쓰는 것도 하지 않는다(§4.7.9).
    - **[결정: 2026-11-17 사용자] 다른 하네스 형식은 인식하지 않는다.** Fresnel은 `.mcp.json`, `.agents/skills`, 그 밖의 다른 하네스 형식을 인식하지 않고 플러그인 폴더는 Fresnel 자체 배치(`.fresnel-plugin/plugin.json`, `skills/`, `instructions.md`, `agents/`, `commands/`, `mcp.json`)만 쓴다. 사용자가 든 예는 `.mcp.json`, `.agents/skills` 등이다: 이 둘은 [결정]이고 "그 밖의 형식"으로 범위를 넓히는 것과 `.fresnel/hooks` 같은 배치 이름을 후보로 만들지 않는 것은 [제안]이다. 이 둘과 루트 `.mcp.json`은 후보로 만들지 않는다. **지금 엔진이 읽는 부분은 제거한다**: MCP 로더의 루트 `.mcp.json` 읽기(`cap-mcp/src/servers/loader.ts:12`)와 폴더 신뢰의 자원 판정이 보는 `.agents/skills`(`ext-host/src/loading-trust/trust/resources.ts:35`)를 없앤다. 제거는 되돌릴 수 없는 동작 변화라서 이 항목은 마이그레이션 기능(§7.9)이 같이 나가거나 그 전에 사용자에게 알리는 릴리스 노트를 먼저 낸다. 아래 §4.5.3의 `.mcp.json` 행과 §7의 느슨한 자원도 같은 결정을 따른다.

### 4.5 플러그인 원본과 로더

1. 플러그인은 폴더다. 이름은 매니페스트 `name`, 없으면 폴더 이름이며 `ExtensionNameSchema`를 만족해야 한다(아니면 진단 `name_invalid`, 후보 아님).
2. 발견 위치(위가 먼저, 이름 충돌 처리는 8번):

| 위치 | 원본 | 비고 |
|---|---|---|
| 사용자 플러그인 폴더 | `<OsDirs.config>/plugins/*` | 새 이름. 기본 생성 위치 [제안] |
| 사용자 기존 위치 | `<OsDirs.config>/extensions/*`(지금 `assemble.ts:1182` `userDir`) | 한 릴리스 동안 읽는다(§7.4). 쓰지 않는다 |
| 추가 경로 | 설정으로 주는 `extraPaths`(`discover.ts:73`, `:85`) | 그대로 |
| 프로젝트 동반 | `<프로젝트 루트>/.fresnel/plugins/*`, 기존 `.fresnel/extensions/*`(지금 `discover.ts:62` `PROJECT_EXTENSIONS_DIR`, `:88`) | 한 단계 깊이. 프로젝트 루트 밖 심볼릭 링크는 거절(`discover.ts:125-` 규칙 유지) |
| 관리 | `<managedDir>/plugins` | 그대로(`discover.ts:80-81`) |
| 기본 제공 번들 | 릴리스 번들 `<bundleDir>/<name>`(`default-plugins.ts:21` `DEFAULT_PLUGIN_NAMES = ["helm"]`) | `bundled` 출처. §7.5 |
| 내장 | 저장소 패키지(`core-*`, `cap-*`, `group-*`) | 코드 모듈이고 폴더 원본이 없다. 검토 대상이 아니다(앱과 함께 배포) |

3. 폴더 인식: 아래 신호 하나라도 있으면 플러그인이다. 매니페스트가 있으면 그것이 우선하고 신호는 매니페스트가 선언하지 않은 `components`를 채운다.

| 신호 | 추론 결과 | 칸 |
|---|---|---|
| 루트의 `SKILL.md` | 스킬 하나. 이름은 SKILL.md 머리말 `name`, 없으면 폴더 이름. 목적은 `description` | Inject(필요할 때 읽는 지침) |
| `skills/*/SKILL.md` | 스킬 여럿 | Inject |
| `instructions.md` 또는 `instructions/*.md` | 항상 싣는 지침 | Inject(항상) |
| `mcp.json`(루트). `.mcp.json`은 인식하지 않는다([결정: 2026-11-17 사용자], §4.4.10) | MCP 서버 정의. 서버 하나가 도구 묶음 하나 | Inject(도구) |
| `agents/*.md` | 서브에이전트 정의(`parseDefinitionFile` 형식) | Inject |
| `commands/*.md` | 프롬프트형 명령(스킬과 같은 재료, 부르는 주체만 다르다) | Inject(명령) |
| 매니페스트의 `entry` 또는 `plugin.ts`·`plugin.js` | 코드 | Hook / Drive 선언 필요 |

   코드 플러그인은 매니페스트가 있어야 한다. Hook·Drive는 `hooks[]`, `drives`를 정적으로 선언해야 하기 때문이다(`validateUsage`). 매니페스트 없는 코드 폴더는 `manifest_required` 진단으로 후보가 아니다. `AGENTS.md`는 신호가 아니다(프로젝트 지침이므로, 플러그인 폴더 안에 있어도 읽지 않는다).
4. 매니페스트 위치는 지금과 같이 `.fresnel-plugin/plugin.json`(`discover.ts:59`)이고 `schemaVersion: 2`다. 매니페스트가 없을 때 추론하는 값: `name`(1번), `version`(`0.0.0+<해시 앞 8자>`), `plugins`(루트 플러그인 하나, `layer: "plugin"`, `hooks: []`), `purpose`(스킬 `description`, 없으면 null), `entry`(없음). 추론한 매니페스트는 파일로 쓰지 않는다. 검토본에는 추론 결과를 `meta.json`에 기록한다.
5. 카드 계산(모든 값은 후보 폴더와 매니페스트에서 정적으로 얻는다. 승인 전 코드는 실행하지 않는다): `does.inject`는 3번의 재료와 `tools`, `commands`, `replaces`, `provides`, `ui` 선언, `does.hook`은 `plugins[].hooks`와 훅 선언의 fold(`F.extensions.spec` 훅 표), `does.drive`는 `drives`와 시작 항목, `runs.code = entry 존재`, `runs.isolated`는 코드가 있고 출처가 사용자·프로젝트·번들(`bundled`)이면 엔진 설계 §3의 기본(격리)을 따른 값(저장소 패키지인 `builtin`만 엔진 안), `health`는 `ext.health`, `origin`과 `review`는 호스트 기록, `usedBy`는 프로필과 공통 묶음의 참조다. 테스트 실행에서 관측한 도구·Hook은 증거(`EvidenceRef`)로 붙고 카드의 `declared` 값을 바꾸지 않는다.
6. 선언 검증: 후보의 매니페스트는 `validateManifest`를 거친다(`F.extensions.spec`). 오류가 있으면 검토 항목을 만들지 않고 `plugin.list`에 진단으로만 보인다. 새 검사: `tools`·`commands` 선언 이름이 중복이면 오류, 필수 `userConfig`가 `sensitive`이면 `secret://`만 받는다는 표시.
7. 감시: `x.loading-trust.sourceWatch`가 참이면 원본 폴더들을 감시하고(디바운스 1초), 시작 때와 프로젝트를 열 때 전체를 훑는다. 폴더 내용 해시가 현재 검토본과 다르면 8번 규칙을 따른다. 감시를 끄면 `plugin.scan`으로만 훑는다.
8. 원본과 검토본: 원본 해시가 현재 검토본 해시와 같으면 아무 일도 없다. 다르면 후보 스냅샷을 `plugin-store/candidates/<해시>/`에 복사하고(§4.6.4) 검토 항목(`update`, 처음이면 `new`)을 만든다. 같은 원본의 대기 항목이 있으면 그 항목을 `superseded`로 닫고 새 항목을 연다. 원본이 검토본 내용으로 되돌아가면 대기 항목은 `withdrawn`이다. 실행 중인 검토본은 어느 경우에도 바뀌지 않는다. 같은 이름이 둘 이상의 출처에서 발견되면 먼저 발견된 것만 후보가 되고 나머지는 진단 `name_conflict`다(담당 AI가 이름을 바꿔야 한다) [제안].
9. 강제력(`enforcement`): `drives: true`이거나 fold가 `first`·`chain`·`collect`인 Hook이 하나라도 있으면 `enforced`, 그 밖(Inject만, 또는 `tap` 훅만)은 `advisory`다 [제안].
10. Inject 재료가 코어에 전달되는 길. 재료는 `E(T)`에 든 플러그인의 검토본에서만 읽는다. 로더는 재료마다 `when`(`always` | `drive` | `on_demand`: 지침 파일은 `always`, 스킬 본문은 `on_demand`, 도구 정의는 `always` 또는 지연이면 `on_demand`)과 소유 플러그인을 낸다. E의 재료 귀속이 이 값을 쓴다.

| 재료 | 받는 곳 | 방법과 필터 | 바꿀 코드 |
|---|---|---|---|
| 지침(항상) | 문맥 조립 | `MaterialPort.instructions(threadId)`가 `sections["plugin:<name>:<경로>"]`로 낸다(`prepare-request.ts:95`) | `core-loop` S |
| 스킬(필요할 때) | `cap-knowledge` 스킬 색인 | 검토본 폴더를 `roots.extension`으로 준다(지금 `plugin.ts:207`, 호스트 `extensions.ts:484`는 가이드 그룹만). `indexBlock(threadId)`(`skills/service.ts:182`)가 `E(T)`에 속한 `extension` 행만 보인다. 느슨한 사용자·프로젝트 스킬 폴더는 §7.5의 플러그인으로 옮긴다 | `cap-knowledge` M |
| 도구(코드) | 도구 등록 | 플러그인 코드가 등록. 대화별 광고는 `E(T)`로 거른다 | X 기존 경로 |
| MCP 서버 | `cap-mcp` | 검토본의 `mcp.json` 서버를 `l2.mcp.servers`와 같은 항목으로 합치되 항목마다 소유 플러그인 이름 `plugin` 필드를 남긴다(합친 뒤에도 기록 E가 `mcp.<서버>`의 소유자를 알아야 한다)(`cap-mcp/src/servers/loader.ts:12`). 연결은 처음 쓰는 대화에서 하고 `E(T)` 밖 대화에는 그 서버의 도구를 광고하지 않는다. 시작 승인은 지금 규칙(프로젝트 출처면 기동 승인, `transport/factory.ts:72`)을 따른다 | `cap-mcp` M |
| 서브에이전트 정의 | `core-agents` | `parseDefinitionFile(..., {kind: "extension"})`(`registry.ts:7`). 지금은 기본 플러그인만 호스트가 읽는다(`default-plugins.ts:259-300`)를 `MaterialPort.agentDefinitions`로 일반화 | `core-agents`·호스트 M |
| 모델 제공자 | 모델 서비스 | 코드가 등록. `E(T)`에 든 제공자의 모델만 그 대화의 `models.list`·`thread.setModel`에 쓴다 [제안] | `core-models` M |
| 명령 | 명령 브리지 | 코드 명령은 지금 경로(`bridgeExtensionCommands`), 프롬프트형 명령은 `commands/*.md`를 읽어 등록. 대화별 목록은 `E(T)`로 거른다. 프로필 밖 플러그인의 명령은 `plugin.invocables`에만 보이고 덧씌우기로 부른다 | 호스트 M |
| 화면 | `ext.ui.list` | `threadId`를 받아 `E(T)`로 거른다 | 호스트 S |

### 4.6 검토본

1. 내용 해시: 폴더를 재귀로 훑어 일반 파일마다 한 줄 `"<상대 경로>\0<x|->\0<sha256 소문자 16진>\n"`을 만든다. 경로는 `/` 구분의 NFC UTF-8이고 줄은 경로의 UTF-8 바이트 순으로 정렬하며 `x`는 실행 비트가 있는 파일이다. 전체 줄의 sha256을 `sha256:<16진>`으로 쓴다. 제외: `.git/`, `.hg/`, `.svn/`, `.DS_Store`. 빈 폴더는 세지 않는다. 심볼릭 링크는 따라가지 않고 `plugin.symlinkRefused`로 거절한다(지금 버전 보관 복사는 링크가 가리키는 내용을 복사한다. `version-history.ts:63` `copyDir` 규약. 해시 일관성을 위해 이 문서는 거절한다). `node_modules/`는 허용하지 않는다(`node_modules_present`). 의존성은 `ext.package`처럼 한 파일로 묶는다. 상한: 파일 2000개, 합계 32 MiB, 깊이 16(`plugin.tooLarge`) [제안]. `ext.installPreview`가 주던 `sha256`은 패키지 파일 해시이고 이 해시와 다른 값이다.
2. 저장소 배치(`OsDirs.data` 아래, 쓰기는 `fileLock`으로 직렬화):

```
plugin-store/
  reviewed/<name>/<해시 16진>/tree/...     # 고정 사본. 읽기 전용 권한(0444/0555)으로 둔다
  reviewed/<name>/<해시 16진>/meta.json    # {name, version, contentHash, approvedAt, decisionId, origin, inferredManifest, card}
  reviewed/<name>/current                  # 현재 해시 16진 한 줄. 임시 파일에 쓰고 rename으로 바꾼다
  candidates/<해시 16진>/tree/...          # 검토 대기 스냅샷
  drafts/<draftId>/{tree,meta.json}        # 초안 스냅샷
  queue/<itemId>.json                      # ReviewItem
  review-log.jsonl                         # 결정 기록(추가만)
```

3. 앱이 실행하고 읽는 것은 항상 `reviewed/<name>/<current>/tree/`다. 원본 폴더는 코드로도 재료로도 읽지 않는다. 격리된 플러그인 프로세스의 읽기 root는 이 `tree/` 하나다(엔진 설계 §3.4 "자기 패키지 폴더").
4. 스냅샷 시점: 검토 항목을 만들 때 원본을 `candidates/<해시>/`에 한 번 복사하고 그 복사본에서 해시를 다시 계산해 항목의 `candidateHash`로 쓴다. 승인은 이 스냅샷을 `reviewed/`로 옮긴다(원본을 다시 읽지 않는다). 그래서 검토자가 본 내용이 실행되는 내용이다.
5. 적재 때마다(프로세스 시작, 플러그인 처음 적재) 검토본 `tree/`의 해시를 다시 계산해 `meta.json`과 비교한다. 다르면 그 플러그인을 적재하지 않고 `health.state: "integrity"`, 진단 `pinned_corrupt`다. 복구는 담당 AI가 새 항목을 만들거나 `ext.rollback`으로 이전 검토본을 고르는 것이다.
6. 보관: 플러그인마다 최근 5개 검토본(지금 `version-history.ts:23` `DEFAULT_KEEP`)과 현재가 가리키는 것, 돌고 있는 대화가 쓰는 세대를 남기고 지운다.
7. 새 검토본이 승인되면 열린 대화는 다음 단계 경계에서 새 세대로 바뀐다(`X.primitives.spec` §4.4.10 `replaceUnit`, 단위 교체). `profile.applied { reason: "plugin_updated", updated }`를 남긴다. 상태 문서의 `stateSchemaVersion`과 `migrateState`가 이전을 맡는다(지금 규칙 그대로).
8. 이전 검토본으로 되돌리기(`ext.rollback`)는 이미 승인된 내용이므로 새 검토 항목을 만들지 않고 `review-log.jsonl`에 `decision: "rollback"`을 남긴다 [제안: 미결 7].
9. 신뢰 등급과 tier의 자리: 지금 4등급(`levels.ts:5-6` `builtin, user, project, untrusted`)은 코드의 판정 기준으로 유지한다. 훅 tier는 F §5.2 O-2의 셋(`guard`, `plugin`, `core`)을 따르고 코드의 다섯 값(`tier.ts:5` `guard, user, project, builtin, core`)은 M5e-2에서 줄인다. 출처 구분은 `assignTier`의 `source`로 유지한다. 대응: 검토본이 있는 사용자 출처는 `user`, 프로젝트 동반 승인본은 `project`, **번들(`bundled`, 지금은 Helm)은 `user` 등급이고 격리 대상이며**(`entry-loader.ts:266`이 이미 `builtin: false`로 적재하고 Helm은 공개 API만 쓴다), 저장소 패키지(`core-*`, `cap-*`, `group-*`)만 `builtin`, 검토본이 없는 후보는 `untrusted`다. `TRUST_MATRIX.untrusted`(`levels.ts:90`)는 이미 `load: false`이므로 "검토 전 실행 금지"는 이 등급이 이미 하는 일을 쓰는 것이다. 폴더 신뢰 카드(`trust.get/decide`)는 플러그인 코드와 플러그인류 자원(`.fresnel/extensions`, 스킬, 명령, 에이전트, `.fresnel/mcp.json`)의 판정에서 물러나고 검토함이 그 일을 한다. 설정 파일(`.fresnel/settings.json`, `settings.local.json`)에 대한 폴더 신뢰는 그대로다(`resources.ts:20-33`). `ext.list.requestedGrade`, `effectiveGrade`, `origin`은 유지한다.

### 4.7 검토

1. 항목을 만드는 일: 담당 AI의 `PluginSubmitPort.submit`(provenance `assistant`, `originThreadId`와 증거 필수), `pluginReview.submitDraft`(초안, 만든 대화가 `originThreadId`), 원본 해시가 검토본과 다름(§4.5.8, 원본 출처가 사용자 폴더면 `unknown`, 프로젝트 동반이면 `project`), `plugin.requestRemove`와 원본 폴더 삭제 감지(`remove`), 번들 갱신(`bundled`. 항목 없이 §7.5가 처리).
2. 항목 내용: 카드(후보 기준), "하는 일의 차이"(`WhatItDoesDiff`: 이전 검토본 카드와 후보 카드의 칸별 비교, 강제력 변화, 비용 변화), 증거 참조, 코드(파일 목록과 `pluginReview.file`로 읽는 내용), 만든 대화.
3. 결정은 셋이다.
   - 승인: `profileIds`(기본은 `originProfileId`)에 넣거나 `libraryOnly`로 보관만 한다. 모든 대상 프로필을 먼저 `validateProfile`로 검사하고 하나라도 오류면 `pluginReview.profileInvalid`로 전체를 거절한다(아무것도 바뀌지 않는다). 통과하면 한 번에 스냅샷 승격, `current` 교체, 프로필 갱신(순서 맨 뒤)을 커밋한다. `update` 항목은 `profileIds`가 비어도 되고(이름으로 든 프로필 모두에 새 검토본이 적용된다 [제안: 미결 4]), `remove` 승인은 이름이 든 모든 프로필·공통 묶음에서 그 이름을 빼고 라이브러리에서 내린다. 지울 때 미리 보기(`pluginReview.get`의 `item.diff.removed`와 영향받는 프로필 id, 같이 지워지는 상태·기록)를 항목에 싣는다.
   - 돌려보내기: `reason`(1~2000자)을 항목에 저장하고 `originThreadId` 대화가 열려 있으면 그 사유를 그 대화의 입력으로 넣는다(`post`, `when: "next"`) [제안]. 대화가 없으면 항목에만 남는다.
   - 버리기: 후보 스냅샷을 지우고 항목을 닫는다. 같은 해시가 원본에서 다시 발견되어도 원본이 바뀔 때까지 항목을 만들지 않는다.
4. 손 수정: 출처가 사용자 폴더이고 `provenance: "unknown"`인 항목은 승인할 수 없다(`pluginReview.handEditNotAllowed`). 선택지는 `plugin.revert`(원본을 검토본으로 되돌림), 담당 AI에게 넘겨 새 버전으로 들여오기(그 AI가 `submit`하면 `provenance: "assistant"`의 새 항목이 된다), 버리기다 [제안: flow §3.3]. 프로젝트 동반 플러그인(`provenance: "project"`)은 저장소에서 온 것이라 이 제한이 없고 승인할 수 있다.
5. 승인 전에는 이전 검토본이 계속 돈다(`new`면 아무것도 돌지 않는다).
6. 목적 문장: `card.purpose`가 비어 있으면 승인할 수 없다(`pluginReview.purposeRequired`). 스킬 폴더는 `description`이 채운다. 담당 AI가 쓰고 사용자가 항목에서 고칠 수 있다 [제안]. 고친 문장은 검토본 `meta.json`에 들어가며 해시에 영향을 주지 않는다.
7. 항목 상태 전이: `pending → approved | sent_back | discarded | superseded | withdrawn`. 닫힌 항목은 다시 열지 않는다(`pluginReview.notPending`).
8. 기록: 결정마다 `review-log.jsonl`에 한 줄 `{ at, itemId, name, kind, candidateHash, baseHash, decision, profileIds, actor: "user" | "migration" | "release", provenance, originThreadId }`를 추가한다. 시크릿 값과 파일 내용은 싣지 않는다.
9. 프로젝트 동반 플러그인은 프로젝트를 열 때 항목이 만들어지고(§4.4.10) 승인 전에는 검토본이 없어 적재되지 않는다. 승인된 뒤에도 출처 표시는 `project`다. 프로젝트 폴더를 다른 위치에서 같은 이름으로 다시 열면 같은 이름의 검토본이 있어도 해시가 다르면 `update` 항목이다.
10. 초안은 검토 없이 쓸 수 있는 곳이 둘이다: 테스트 실행(R16, 다른 스펙)과 §4.3 덧씌우기. 그 밖에는 `E(T)`에 들어갈 수 없다(`plugin_not_reviewed`). 검토 항목이 승인돼야 프로필에 들어간다(flow R2).
11. 재시작: 대기 항목과 검토본, `current`는 파일에서 읽는다. 프로세스를 다시 띄워도 항목은 그대로이고, 시작 때 §4.5.7의 훑기가 원본과 검토본을 다시 비교한다. 승인 도중 중단(스냅샷 승격 후 `current` 교체 전)은 `current`가 바뀌기 전까지 이전 검토본이 쓰이고 승격된 사본은 `candidates/` 취급으로 다음 시작에 정리한다.

### 4.8 테스트 대화 (엔진 쪽의 유일한 소유자) [M6 요청 반영, 로드맵 M5f]

소유: §4.8·§4.9는 M5f(`m5-plan.md`)가 만들고 M5c-1의 범위가 아니다. 단 §4.8.1의 `testRun.start`가 쓰는 덧씌우기(§4.3)와 `plugin.draft.create`·`PluginSubmitPort`는 M5c-1·M5c-2가 먼저 낸다. 테스트 대화는 플러그인을 만들고 고치는 AI와 하는 Craft 전용 대화다. 창과 흐름은 `docs/xeon/review/m6/craft-flows.md`가 정하고 이 절이 엔진 쪽 전부를 정한다. 다른 스펙은 이 절을 인용만 한다(엔진 설계 §1.4는 빌더의 재구현만 맡는다).

1. **표지.** 대화를 만들 때 `thread.started.craftChat { plugin, contexts }`를 한 번 쓴다(선택 필드 추가, `profileId`와 같은 방식). `ThreadSummary.craftChat`로 읽는다. 기존 `testRun` 표지와 별개다.
2. **묶임.** `plugin`은 플러그인 이름이다. 새 플러그인을 만드는 동안은 `null`이고 첫 초안이 생기는 순간 `thread.updated.craftChat { plugin }`으로 한 번 묶는다(이후 바꾸지 않는다). 한 플러그인에 테스트 대화가 여럿일 수 있다. 플러그인이 지워져도 대화는 남고 `plugin`은 그 이름 그대로다(이름으로 이어지는 검토 이력을 위해).
3. **목록과 프로젝트에서 제외.** `thread.list`는 기본으로 `craftChat`이 있는 대화를 뺀다. `include: "craft"`를 받으면 낸다. 프로젝트 소속 계산(§4.4.2), `project.list`의 대화 수, `sameFolder` 알림, 선택기 기본값의 "같은 폴더에서 마지막에 쓴 프로필"([결정: 2026-11-17 사용자, U5], §4.4.8)에서 모두 뺀다. 테스트 대화의 대화 폴더는 프로젝트 루트가 아니라 플러그인 원본 폴더다.
4. **보관(ledger D-070).** 일반 대화와 같은 저장소와 같은 대화 로그에 둔다(별도 저장소를 두지 않는다). 표지만 다르다. 보존 기간과 삭제는 일반 대화와 같고 사용자가 다른 대화처럼 지울 수 있다. `craftChat.list`와 `thread.list { include: "craft" }`가 읽는 길이다. 이유: 로그 복원, 재시작, 턴 기록(E)이 같은 길을 쓰므로 새 저장소가 둘째 정본을 만든다.
5. **숨은 시스템 프로필 `craft`.** 사용자가 고르지 않는다. `Profile.hidden: true`, `builtin: true`, 플러그인은 빌더 하나(내장 이름 `authoring`, 화면 이름 "Plugin Builder"), 시작 Drive는 빌더, 권한 모드 `default`(묻는 모드, `bypass`가 아니다)다. `profile.list`에 나오지 않고 `profile.put`·`delete`는 `profile.builtinProtected`다. 이 대화의 `thread.setProfile`은 `profile.builtinProtected`로 거절한다. 이 대화에는 프로필 칩이 없다. 이 프로필은 공통 묶음을 받지 않는다 [제안: 사용자 공통 플러그인이 빌더를 방해하지 않게].
6. **시작 Drive의 상주.** 첫 턴 앞에서 시작 Drive 규칙(§4.2.6)으로 빌더 프레임이 쌓인다. 테스트 대화는 사용자 입력 사이에 빌더가 `yield`로 기다리고 `done`으로 프레임을 내리지 않는 "상주"다(엔진 설계 §1.4). 사용자 중지나 오류로 스택이 비면 다음 사용자 입력 앞에서 시작 Drive를 다시 쌓는다: `craftChat` 표지가 있는 대화에 한해 §4.2.6의 "첫 턴 앞에서만"을 "스택이 비어 있는 매 턴 앞"으로 넓힌다 [제안].
7. **쓰기 범위.** 이 대화의 쓰기 허용 root는 그 플러그인의 원본 폴더(`<OsDirs.config>/plugins/<name>`) 하나다(§4.4.4의 프로젝트 루트 규칙을 대체한다). 읽기 root는 원본 폴더와 출력 사본 폴더다. 묶이지 않은 동안(`plugin: null`)은 쓰기 root가 없다. 새 플러그인의 이름이 정해지면 빌더가 폴더를 만들고 호스트가 그 폴더를 쓰기 root에 더한다. 빌더의 쓰기 범위 가드(`guard.ts`)는 둘째 방어이고 엔진 root가 첫째다.
8. **맥락은 참조로만 전달한다.** 모델 컨텍스트에 줄을 더하지 않는다. "고치기", "올리기"는 `craftChat.open`에 `ContextRef`와 한 줄 의도를 준다. 호스트가 새 기록 `craft.context`로 참조를 남기고, 빌더의 지연 도구 `authoring_context`가 필요한 만큼 읽는다. 발견(`finding`)이면 E의 `findings.bundle`(근거 묶음, 16 KiB 이하, id·해시·숫자만)을 돌려주고 내용이 필요하면 빌더가 `turnRecord.get`과 대화 읽기로 푼다. 첫 사용자 입력은 사용자에게 보이는 한 줄이다(숨은 모델 전용 문장이 아니다). 도구가 지연 도구라 목록 비용이 0이다. 호스트 내부 포트 `CraftContextPort.read(threadId): ContextRef[]`가 도구에 값을 준다. `craft.context`는 관찰이 아니라 사용자가 연 사실이라 상태 사건이다.
9. **기록 표지.** 이 대화의 턴은 E의 `ScopeKind` 새 값 `craft`로 적어 지표 기본 필터에서 뺀다(E §4.6 규칙 36). 빌더 플러그인과 `craft` 프로필의 지표가 오염되지 않게 한다. 사용자가 C9 필터에서 명시로 켜면 나온다.
10. **다시 열기.** `craftChat.open { plugin, reuse: "last" }`가 그 플러그인의 가장 최근 테스트 대화를 연다. `reuse: "new"`는 새로 만든다. 맥락이 있으면 `craft.context`를 이어 붙인다.
11. **테스트 대화와 테스트 실행은 별개다.** 테스트 대화는 만드는 대화이고 테스트 실행은 만든 초안을 돌려 보는 일이다. 같은 대화가 둘 다이지 않다.
12. 이 절 전부는 엔진 설계 E1(빌더 재구현)과 이 문서의 §4.9가 있어야 쓸 수 있다. 준비되지 않았을 때 화면은 `craftChat.*` 메서드가 없는 오류로 판단한다(Craft 화면 스펙의 NR-5f).

### 4.8.1 테스트 실행의 구성 만들기 (ledger D-074)

`testRun.start`는 "기준 프로필 + 초안"의 임시 구성으로 대화 하나를 만든다. 규칙:

1. 호스트가 새 대화를 만들고 `thread.started`에 `profileId = baseProfileId`와 표지 `testRun { kind: "draft", baseProfileId, drafts: [{ plugin, draftId }], runGroupId }`를 쓴다(선택 필드 추가. E §3.5의 `TestRunMarker`와 같은 필드). 이 대화는 프로필을 참조하지만 프로필 레코드는 바꾸지 않는다.
2. 켜짐 집합은 `E(T) = 코어 ∪ (공통.plugins ∪ 기준.plugins) − 관리 잠금 − 오류 정지`에서 초안과 같은 이름의 검토본을 빼고 초안을 더한 것이다. 초안은 `E(T)`의 뒤쪽에 놓인다(같은 이름의 검토본이 있었으면 그 자리에 놓는다). 초안은 4개까지다(`overlay.limit`과 같은 한도).
3. 구성은 대화의 수명 동안 고정이다. 덧씌우기가 아니라서 `profile.applied`의 `overlay`에 `until` 값을 새로 만들지 않는다. 새 초안 버전을 써 보려면 새 테스트 실행을 만들고 같은 `runGroupId`를 준다. `profile.applied { reason: "open", added }`에 초안 이름이 들어가고 초안 버전 id(`draft:<draftId>:<해시 앞 8자>`)는 E의 `TurnRecord.testRun`이 싣는다.
4. 검증: 합성한 구성을 `validateProfile`로 검사한다(`replace_conflict` 등). 오류가 있으면 `profile.invalid`로 만들지 않는다. 초안 플러그인의 설정 값은 기준 프로필 값 없이 플러그인 기본값이다(덧씌우기와 같은 규칙, §4.3.6). 필수 값이 없으면 `waiting`.
5. 초안은 격리 프로세스에서 돌므로 P1 전에는 `testRun.draftUnavailable`로 거부한다(§4.3.8). 초안이 없는 테스트 실행(`drafts: []`)은 P1 전에도 만들 수 있다.
6. 초안 출신 호출은 권한 모드와 무관하게 항상 승인 카드와 "초안" 표시를 띄운다([결정: 2026-11-17 사용자, U2], F §5.3 U-6).
7. 기록: E의 `scope: test`, `runGroupId`, `draft: true`. 지표 기본에서 뺀다(E §4.6).
8. 일반 대화에서 초안을 바로 써 보는 것(덧씌우기, §4.3.8)과 이 구성은 다르다: 앞은 실제 대화에 턴 단위로 얹고 `overlay_draft`로 기록되며, 이쪽은 새 대화 전체가 시험이고 `test`로 기록된다.
9. 서브에이전트: 자식은 부모의 같은 구성(기준 프로필과 초안)을 물려받는다 [제안: §4.1.15의 덧씌우기는 안 물려주는 규칙과 달리, 테스트 대화는 전체가 한 구성이라서].

### 4.9 초안과 제출 경로, 빌더가 해야 하는 것 [M6 요청 B-1·B-3·B-6 반영]

1. **모든 생성은 초안을 만들고 검토함을 지난다.** 빌더는 원본 폴더에 쓰고 검증을 통과하면 `plugin.draft.create { dir, originThreadId }`로 초안을 만든다. 고칠 때마다 새 `draftId`이고 `DraftInfo.parent`가 앞 초안이다. 검토함으로 보내는 일은 `pluginReview.submitDraft { draftId }`(화면의 단추)나 `PluginSubmitPort.submit`(빌더 도구 `authoring_submit`)이다. 항목의 `originThreadId`는 만든 대화(일반 대화 또는 테스트 대화)이고 `originProfileId`는 그 대화의 프로필(테스트 대화면 `craft`가 아니라 테스트 실행의 기준 프로필이거나 없음)이다. **빌더가 직접 설치하는 길은 없다**: `authoring_install`과 `fresnel.devkit`의 설치 경로(`release.ts`)는 폐기한다(§7.7).
2. 초안 보관: 플러그인마다 최근 20개를 둔다. 검토 항목이 가리키는 초안과 테스트 대화가 쓰는 초안은 지우지 않는다. 넘으면 가장 오래된 것부터 `draft.notFound`가 된다 [제안].
3. **기존 플러그인 고치기(B-1).** 빌더의 시작 도구는 `name`만 받아 그 플러그인의 원본 폴더를 연다(새 플러그인은 `kind`, `name`을 받는다). 원본이 검토본과 다르면(손 수정으로 보이는 변경 포함) 빌더는 원본에서 시작하고, 나온 초안은 검토에서 `update` 항목(`provenance: "assistant"`)이 된다(§4.7.4의 "담당 AI에게 넘기기"가 이 길이다). 원본 폴더가 없는 번들(`bundled`) 플러그인은 고치지 않는다.
4. **세 방식(B-2).** 초안의 종류에 제한이 없다. 카드의 `does`가 Inject, Hook, Drive 어느 칸이든 같은 초안·제출 경로를 쓴다.
5. **`plugin-group` 폐기(B-6).** 스캐폴드와 카탈로그의 종류 값 `plugin-group`과 그 문구를 없앤다. 종류는 플러그인 하나뿐이고 하는 일은 카드의 세 칸으로 드러난다. `ext.scaffold`의 종류 매개변수에서 이 값을 지운다. 기존에 이 종류로 만든 폴더는 플러그인으로 읽는다(§4.5.4의 추론).
6. **목적 한 문장(B-9).** 빌더는 사용자의 말에서 `purpose`를 쓰고 초안의 매니페스트에 싣는다. 사용자는 검토함에서 고친다(`ReviewDecision.approve.purpose`).
7. 시험과 재생(B-7): 빌더의 시험 도구는 `testRun.start`, 재생 도구는 E의 `backtest.run`을 쓴다. 개발 모드 전용인 옛 `authoring_replay`는 폐기한다.
8. 단계 함수로 다시 구현(B-8)과 상주(B-5), 새 도구 `authoring_context`(B-4)는 엔진 설계 §1.4(E1)가 정하고, 도구는 이 절의 §4.8.8이 읽는다.
9. 돌려보내기 사유는 `originThreadId` 대화의 다음 입력으로 간다(§4.7.3). 그 대화가 테스트 대화면 그 대화의 `craft.context`에 `{ kind: "review", itemId }`가 붙는다. 대화가 없으면 항목에만 남고 사용자가 테스트 대화를 다시 열 때 맥락으로 붙는다.

### 4.10 지침 추가 (한 줄 지침 플러그인) [결정: 2026-11-17 사용자 밤]

프로필 화면의 "지침 추가"는 허용된다. 사용자가 지침 한 줄을 쓰면 지침만 든 플러그인 초안이 되고 검토함을 지난다. 사용자가 직접 쓴 것이라 검토는 한 번의 확인이다. 이것은 "손으로 고치지 않는다"(§4.7.4)의 예외가 아니다: 사용자가 원본 폴더 파일을 고치는 것이 아니라 앱이 사용자의 한 줄로 플러그인 폴더를 만든다.

1. 새 wire `plugin.draft.fromInstruction { text: string(1~2000자); name?: string; profileId?: string }` → `{ draftId; itemId }`. 앱이 원본 폴더(`<OsDirs.config>/plugins/<name>`)에 `instructions.md`(그 한 줄 그대로)와 최소 매니페스트(`purpose`는 그 줄의 앞 200자)를 만들고, 초안을 만든 뒤 검토 항목(`provenance: "user_instruction"`, `originThreadId: null`)을 만든다. `name`을 안 주면 `instr-<내용 해시 앞 6자>`다. 오류: `plugin.invalid`, `plugin.exists`(같은 이름, 3600대).
2. 항목은 지침만 든 카드(Inject 칸의 지침 하나, 코드 없음, 권고)다. 승인 대상 프로필은 `profileId`(기본은 지금 프로필)다. 검토함에서 한 번의 확인(`pluginReview.decide approve`)으로 끝난다. `provenance: "user_instruction"`은 손 수정(`unknown`)이 아니라서 승인할 수 있다.
3. 모델 컨텍스트에는 승인된 뒤에만 일반 지침 플러그인처럼 `sections`로 간다(§4.5.10). 다른 문장을 더하지 않는다.
4. 같은 이름의 지침을 고치려면 같은 경로로 새 초안(새 버전)을 만든다. 담당 AI(빌더)를 거치지 않는다.

## 5. 실패와 경계 사례

| 상황 | 처리 |
|---|---|
| 프로필 저장 중 다른 클라이언트가 먼저 저장 | `baseRev` 불일치 → `profile.conflict`(지금 `profile.put`의 `baseRev` 규칙 유지) |
| 프로필 파일이 깨짐 | 파일은 그대로 두고 `profile.fileCorrupt`. 대화는 `default` 공장 값으로 연다(`default`는 파일 없이도 존재) |
| 프로필에 든 플러그인이 지워짐(`remove` 승인) | 승인이 프로필에서 이름을 뺀다. 승인 밖에서 검토본이 사라지면(저장소 손상) `E(T)`에서 빼고 `profile.applied { reason: "plugin_stopped" }` |
| 대화 중에 Drive 플러그인이 프로필에서 빠짐 | §4.1.13. 사용자에게는 한 줄로 알린다(UI) |
| 프로필 전환이 도구 목록을 바꿈 | §4.3.7과 같은 캐시 규칙. `thread.setProfile.preview.cacheImpact`로 미리 알린다 |
| 원본을 편집하는 중에 파일이 반쯤 쓰임 | 디바운스 1초 뒤 해시가 계속 바뀌면 항목을 만들지 않는다. 스냅샷 복사 중 해시가 바뀌면 복사를 버리고 다시 시도한다(최대 3회, 그 뒤 진단 `source_unstable`) |
| 후보가 상한(파일 수, 크기)을 넘음 | 항목을 만들지 않고 진단 `plugin.tooLarge`. 담당 AI에게 알린다 |
| 후보 매니페스트 오류 | 항목 없음. `plugin.list`에 진단 |
| 후보가 `replaces`로 내장 도구를 대체 | 승인은 가능하다. 프로필에 넣을 때 `replace_conflict` 검사와 지금의 사용자 승인 규칙(`F.capabilities.spec` §10)을 거친다 |
| 같은 이름의 사용자 플러그인과 프로젝트 동반 플러그인 | §4.5.8 `name_conflict` |
| 승인 대상 프로필이 그 사이 삭제됨 | `profile.notFound` → `pluginReview.profileInvalid` 안에 포함, 아무것도 바뀌지 않는다 |
| 프로젝트 루트 폴더가 사라짐 | `project.list`는 보이지만 `project.get`에 `rootMissing: true`. 그 프로젝트 대화의 쓰기는 루트가 없으므로 도구가 `not_found`를 낸다. 대화 폴더도 같다(`workspace.status`가 이미 알린다) |
| 지침 파일이 큼, 읽을 수 없음, 루트 밖 링크 | §4.4.7. 문맥에는 아무것도 싣지 않고 진단만 남긴다 |
| 덧씌우기를 요청했는데 그 사이 플러그인이 새 검토본으로 바뀜 | 요청 시점의 현재 검토본을 쓴다. `profile.applied.overlay[].contentHash`로 남긴다 |
| 초안과 같은 이름 검토본이 둘 다 `E(T)`에 있음 | 초안이 그 대화에서 검토본을 대신한다(§4.3.8). 프로필에서는 검토본을 그대로 둔다 |
| 시크릿 이름이 없음 | `secret_missing` 경고. 플러그인이 쓸 때 `secret.denied`가 기록된다(`L0.secrets.spec`) |
| 플러그인 프로세스 격리 불가(Windows) | 이 문서와 무관하다. 카드의 `runs.isolated`에 사실을 적는다(엔진 설계 §3.4) |
| 검토본 보관(5개)을 넘은 버전 | 지워진 검토본을 가리키던 기록(E)은 해시만 남는다. 화면은 "(보관 기간 지남)"으로 보인다 |
| 프로세스가 쓰는 도중 중단 | §4.7.11. `profiles.json`은 임시 파일에 쓰고 rename(지금 `profile-store.ts`가 `fileLock`을 쓰는 방식 유지) |
| 마이그레이션이 일부 실패 | §7. 실패한 항목은 `migration.log`에 남기고 나머지는 진행한다. 원본 파일은 지우지 않는다 |

## 6. 지금 코드와의 차이

크기: S 하루 안쪽, M 며칠, L 한 주 이상(리드 병렬 기준 어림이고 측정값이 아니다).

| 주제 | 지금 | 바꿀 것 | 크기 |
|---|---|---|---|
| 프로필 적용 방식 | `profile.apply`가 `ext.<name>.enabled`와 설정 키를 층에 쓴다(`profile-test-run-port.ts:97-123` `planOf`, `:146-190` `apply`). thread 층은 대화별 켜짐 요청(`:113-118`, `:178`) | 쓰지 않고 참조한다. `apply` 제거, `PluginSetPort`가 `E(T)`를 계산(§4.1) | L |
| 프로필 형식 | `enable`, `disable`, `settings`, `driver`(`profile-test-run.ts:45-62`), 한도 64/64/128(`:34`), 파일 v1(`profile-store.ts:156`) | `plugins`, `settings`, `driver`, `builtin`, 공통 묶음, 파일 v2 | M |
| 프로필 검증 | 설정 키 검사만(`:125` `checkSettingWrite`), 충돌 검사 없음 | `validateProfile`(§4.2.7), 비용·충돌 미리 보기 | M |
| 프로필 층 | `PROFILE_LAYERS = user/project/thread`(`:151`), 범위 `scopeOf`(`:31-41`) | 새 설정 범위 `profile`(`layers.ts:8`), `core-tools/settings.ts:265-275` `pickMode` 순회에 반영 | M |
| 스레드 켜짐 | `thread.want`/`record.desired`(`registration.ts:225`, `:835-871`)가 전역 기본값과 대화별 요청 | 대화별 값이 유일한 원천(`E(T)`), 전역 `desired`는 오류 정지만 | M |
| 켜짐 설정 키 | 사용자·프로젝트·local·launch 범위(`settings-keys.ts:30-38`), 설정 변경을 따라가는 `followExtEnabled`(`ext-enabled.ts:25-60`, 호스트 `assemble.ts:1203-1215`) | 키를 관리 범위로 한정, `followExtEnabled`를 프로필 변경 구독으로 대체 | M |
| 적재 트리거 | `enabled` 설정이 거짓이면 적재 안 함(`loading-trust/index.ts:837`, `:1670`) | `PluginSetPort`가 "열린 대화 중 쓰는 곳 있음"을 알림 | M |
| 클라이언트 스위치 | `threadSwitchOf`, `threadToggleRequestOf`(`client/workbench/thread.ts:38-77`), 프로필 편집 on/off/keep(`compose.ts:139-190`), `profileApplyRequestOf`(`thread.ts:78`) | 스위치 제거, 프로필 편집을 목록 편집으로. Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`)이 소유 | M |
| 스레드의 프로필 필드 | 없음. `ThreadCreateParams.profileId`는 `testRun`만(`methods.ts:584-600`, `handlers/thread.ts:35-40`) | `thread.started/updated.profileId`, `thread.setProfile`, 요약에 노출 | M |
| 시작 Drive | `driver`를 `x.primitives.activeDriver`에 씀(`profile-test-run-port.ts:24`, `:122`) | 시작 때만 프레임을 쌓는다. 키 제거는 엔진 스펙 | S(이 문서 몫) |
| 프로젝트 개념 | 없음. 폴더 기준 "작업 폴더"만 있다. `X.primitives.spec` §4.5.7은 대화 묶음 정의로 쓰여 있고 `ADR-0022` §3.3은 3층 덧씌우기 | 프로젝트 레코드, 소속 계산, `thread.create` 변경. §4.5.7과 ADR-0022 §3.3 1·5번을 이 문서와 새 결정으로 고쳐 쓴다 | M |
| 쓰기 범위 | 읽기·쓰기 root는 대화 폴더 하나(`roots.ts` `defaultRoots`, `scope.ts:21-24`), 샌드박스 쓰기 root가 같은 값(`shell/run.ts:179`) | 루트는 프로젝트 루트, `cwd`는 대화 폴더(§4.4.4) | M |
| 폴더 없는 대화 | 호스트 cwd로 떨어짐(`lifecycle.ts:57-60`, `scope.ts:17`, `assemble.ts:890`, `:1195`) | 기본 폴더 아래 대화별 폴더(§4.4.5) | S |
| 지침 파일 | 코어는 읽지 않음(`prepare-request.ts:95` `sections: {}`, `grep AGENTS` 결과 없음). 문서만 읽힌다고 적음 | 루트→대화 폴더 경로의 `AGENTS.md`를 `sections`로(§4.4.7) | M |
| 서브에이전트 상속 | 대화 폴더는 이미 상속(`core-agents/service.ts:1033-1043`). 프로필 필드 없음 | 자식이 부모 `profileId`를 받는다(`service.ts:1041` 생성 입력). 엔진 설계 F2("상속 안 함")는 커밋 `9ce14f8b0`으로 non-fork 경로에서 이미 고쳐졌다 | S |
| 매니페스트 | `entry`, `plugins` 필수(`manifest.ts:249-250`). `components.skills/commands/mcpServers`는 선언만 있고 읽는 곳이 없다(`components`를 읽는 곳은 `default-plugins.ts:259`의 `agents`뿐) | 선택으로, `purpose`, `components.instructions`, `tools`, `commands` 추가, 추론(§4.5.4) | M |
| 발견 | `<config>/extensions/*`, `.fresnel/extensions/*`, 한 단계, `.fresnel-plugin/plugin.json` 필수(`discover.ts:56-62`, `:121-`) | 새 위치 `plugins/`, 매니페스트 없는 폴더 추론, 느슨한 자원을 후보로 | M |
| 재료 로더 | 스킬은 가이드만(`extensions.ts:484`), MCP는 설정과 루트 `.mcp.json`만(`cap-mcp/servers/loader.ts:12`. `.mcp.json` 읽기는 제거한다, §4.4.10), 에이전트는 기본 플러그인만(`default-plugins.ts:259`), 명령은 코드만 | `MaterialPort`와 §4.5.10 표. `E(T)` 필터 | L |
| 검토본 | 없음. 사용자 설치본은 `<config>/extensions/<name>`에서 바로 실행. 버전 보관은 설치본 복사와 `manifestHash`(`version-history.ts:32-39`) | 내용 해시, `plugin-store/`, 항상 검토본에서 적재, 적재 때 해시 재확인 | L |
| 검토함 | 없음. 설치는 `ext.installPreview`(`sha256`로 `source_changed` 거부) + `ext.install`, 삭제는 `ext.remove` | 검토 항목·결정·기록, `pluginReview.*`, `plugin.*`. 위 `ext.*` 설치·삭제 제거. 플러그인 빌더의 산출 경로(`link` → `ext.install`)는 이 단계에서 `PluginSubmitPort.submit`으로 바꾼다(엔진 설계 E1은 기존 `link`를 그대로 둔다) | L |
| 신뢰 등급 | 4등급과 tier, 폴더 신뢰 카드가 플러그인류 자원도 판정(`trust/resources.ts:20-33`) | 등급은 유지, 검토본 없음 = `untrusted`, 플러그인류는 검토함이 판정(§4.6.9) | M |
| 프로젝트 동반 플러그인 | 폴더 신뢰 뒤 `.fresnel/extensions`를 적재(`discover.ts:62`) | 열 때 항목 생성, 승인 전 미적재 | M |
| 덧씌우기 | 없음 | `turn.start.overlay`, `plugin.invocables`, `plugin.draft.*`, `profile.applied` | L |
| `ext.list` 필드 | `enabledSource`(`xeon/packages/contracts/src/wire-settings/wire/ext-read.ts:48`) | 새 값 집합, 카드 필드 | S |
| 기본 프로필 | 없음(`profile-store.ts`가 시드하지 않음) | `default` 항상 존재, 삭제 불가 | S |
| 권한 칩 | `tools.setMode`가 대화 범위 설정을 쓴다(`contracts/services/tools.ts:681-686`) | UI는 프로필 칩에 흡수(Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`)). 엔진은 `setMode`를 `launch` 범위 덮어쓰기로 남긴다(CLI 플래그용) [제안] | S |

## 7. 옮김(마이그레이션)

모든 옮김은 첫 시작에 한 번 돌고 `migration.log`(호스트 상태 폴더)에 결과를 남긴다. 원본 파일은 지우지 않고 `.bak`로 둔다. 다시 시작해도 같은 결과(멱등)다.

1. **저장된 설정** `ext.<name>.enabled`:
   - `user` 범위 값(참, 거짓)은 다음 7.2의 기본 프로필 계산에 쓴 뒤 사용자 설정 파일에서 지운다(`settings.json.pre-profile`로 백업).
   - `project`, `local` 파일의 값은 저장소 파일이라 지우지 않고 무시한다. 한 번 진단 `legacy_enabled_key_ignored`를 남긴다.
   - `managed` 범위 값은 그대로 둔다(§4.1.10 잠금).
   - `launch` 범위는 메모리뿐이라 옮길 것이 없다.
   - 카탈로그에서 키 정의가 사라지므로 위 파일에 남은 키는 알 수 없는 키 경고만 낸다.
2. **기본 프로필 `default`**: 공장 값은 §4.1.2다. 옮김은 `default.plugins`를 "비코어 플러그인 가운데 user 범위 유효 켜짐이 참인 것(값이 없으면 `defaultEnabled`)"으로 채운다. 권한 모드는 `bypass`로 쓰고, 사용자 파일에 이미 `l1.tools.permissionMode`가 있으면 그 값을 쓴다.
3. **기존 프로필**(`profiles.json` v1): `plugins = 옮긴 default.plugins ∪ enable − disable`. `settings`는 `ext.*.enabled` 키를 뺀 나머지 가운데 `profile` 범위가 허용하는 키만 남기고, 허용하지 않는 키는 `migration.log`의 `rejected`에 적고 버린다. `driver`는 같은 이름으로 유지하고 `plugins`에 없으면 더한다. `id`, `title`, `rev`는 유지하고 `updatedAt`을 새로 쓴다. 공통 묶음은 빈 값으로 만든다. v1 파일은 `profiles.json.v1.bak`로 보존한다. v1 의미("그대로 둠")를 v2("목록에 없으면 꺼짐")로 옮기는 것이라 기존 프로필이 켜는 집합이 달라질 수 있고, `default`를 바탕으로 계산하는 이유가 그것이다.
4. **설치된 사용자 플러그인**(`<config>/extensions/<name>`, `.history`): 각각 현재 내용을 `reviewed/<name>/<해시>/`에 복사하고 `review-log.jsonl`에 `actor: "migration"`, `decision: "migrated"`로 남긴다(사용자가 직접 설치한 것이라 재검토를 강제하지 않는다 [제안]). `.history`의 이전 버전은 해시를 다시 계산해 같은 구조로 옮긴다(최근 5개). 원본 폴더는 제자리에 두고 한 릴리스 동안 `legacy` 표시로 읽는다. 매니페스트가 없는 옛 폴더는 `.fresnel-plugin/plugin.json`이 있어야 설치된 것이므로 해당 없다.
5. **기본 제공 번들(Helm)과 느슨한 자원**: 번들은 `bundled` 출처이고 릴리스가 `reviewed/`에 직접 넣는다(`actor: "release"`). 번들 갱신(`installDefaultPlugin`의 교체, `default-plugins.ts`)은 검토 항목 없이 새 검토본이 된다 [제안: 앱 업데이트와 같은 신뢰. 미결 8]. 사용자 수준의 느슨한 스킬 폴더(`<OsDirs.data>` 아래 스킬 루트, `resolveSkillRoots({dataDir})`)는 스킬 폴더 하나당 플러그인 하나로 보고 4번처럼 `migrated`로 승인한다. 프로젝트의 느슨한 자원은 옮기지 않고 프로젝트를 열 때 검토 항목이 된다. 옮긴 뒤 `cap-knowledge`는 느슨한 루트를 읽지 않고 `MaterialPort`만 쓴다.
6. **기존 대화**: `thread.started.profileId`가 없는 대화는 `default`를 참조한다(1번 규칙). 이벤트를 다시 쓰지 않는다. 대화별로 꺼 두었던 상태(`scope.changed` 이력)는 새 대화 열기에서 쓰지 않고 `default`로 다시 계산한다(켜짐 집합이 달라질 수 있다) [제안: 미결 9]. `workspace`가 있는 기존 대화는 4.4.3 규칙으로 암묵 프로젝트를 만든다. 서로 포함하는 폴더가 있으면 중첩으로 둔다. 쓰기 범위는 가장 깊은 루트이므로 기존보다 넓어지지 않는다. `workspace`가 null인 기존 대화는 지금처럼 호스트 cwd를 쓴다(4.4.6).
7. **제거되는 wire 메서드**: `profile.apply`, `ext.install`, `ext.installPreview`, `ext.remove`, `ext.removePreview`. 알 수 없는 메서드 `-32601`로 응답한다. 클라이언트와 호스트가 같은 릴리스로 올라가므로 한 번에 바꾼다. 대체: `profile.apply` → `thread.setProfile`·`thread.create.profileId`, `ext.install*` → 검토 흐름(빌더의 `link` 산출 경로는 `PluginSubmitPort.submit`), `ext.remove*` → `plugin.requestRemove`. `ThreadSummary`와 `ProfilePreviewResult` 모양이 바뀌므로 `WIRE_PROTOCOL_VERSION`을 올린다.
8. **설치 기록의 이름**: `ext.versions`/`ext.rollback`은 이름을 유지하고 새 저장소를 읽는다.

9. **다른 하네스 형식의 제거와 변환** [결정: 2026-11-17 사용자]. 엔진은 루트 `.mcp.json`(`cap-mcp/src/servers/loader.ts:12`)과 `.agents/skills`(`ext-host/src/loading-trust/trust/resources.ts:35`)를 더 읽지 않는다. 이 제거는 사용자에게 보이는 동작 변화라서 릴리스 노트에 적고, 한 번은 "읽지 않는 형식을 발견했다"는 진단을 `migration.log`에 남긴다(파일은 지우지 않는다). 변환(다른 하네스 형식 → Fresnel 플러그인 폴더 초안)은 별도 마이그레이션 기능이고 이 문서에서 설계하지 않는다. 로드맵 M5g가 설계 단계를 먼저 두고 만든다. 변환 결과는 초안이므로 검토함을 지난다.

## 8. 수용 기준

번호 뒤의 괄호는 추적하는 요구 번호다. PRD R은 `docs/xeon/review/m5-plan.md`, 흐름 규칙은 `docs/xeon/review/m6/craft-flows.md` §2의 R1~R7이다. 둘이 같은 "R" 접두라서 흐름 규칙은 "F-R"로 적는다.

1. 프로필에서 플러그인을 빼면 그 프로필을 참조하는 열린 대화의 다음 단계에서 그 플러그인의 도구와 Hook이 사라진다. 이미 시작한 도구 호출은 끝나고 `profile.applied`와 `scope.changed`가 기록된다(R1).
2. 프로필에 플러그인을 넣고 저장하면 열린 유휴 대화는 다음 매크로태스크에, 실행 중 대화는 다음 단계 경계에 적용된다(R1).
3. wire 메서드 목록과 설정 카탈로그에 플러그인별 켜기·끄기 쓰기 경로가 없다. 사용자 범위에 `ext.<name>.enabled`를 쓰면 `settings.scopeNotAllowed`다(R2).
4. `default` 프로필은 삭제하면 `profile.builtinProtected`이고, 공장 상태의 권한 모드는 `bypass`다(R2).
5. 모든 도구 호출을 막는 Hook이 든 프로필에서 `thread.setProfile { default }`를 부르면 다음 턴이 정상으로 돈다(R3, F-R5).
6. `thread.create { profileId }`가 `testRun` 없이도 프로필을 참조한 대화를 만든다. `profileId`가 없으면 `profile.defaultFor`와 같은 프로필을 쓴다(R3, R14). 선택기 기본값은 [결정: 2026-11-17 사용자, U5]이다.
7. 프로필 전환으로 권한 모드가 넓어지면 `thread.setProfile.preview.permission`이 `from`, `to`를 싣고 확인 질문이 뜨지 않는다. 승인 카드의 "계속 허용" 상태는 전환 뒤에도 남는다(R3, 결정).
8. Drive 프레임을 쥔 플러그인을 프로필에서 빼면 그 프레임과 위 프레임이 내려가고 아래 프레임에 `aborted`가 간다. `lease.released { reason: "disabled" }`가 남는다(R1).
9. 서브에이전트가 만든 자식 대화는 부모 프로필 id, 대화 폴더를 물려받고 권한 천장을 넘지 못한다. 부모의 이후 전환은 이미 도는 자식을 바꾸지 않는다(R13).
10. 프로필에 같은 내장 도구를 `replaces`로 대체하는 플러그인 둘을 넣고 저장하면 `profile.invalid`(`replace_conflict`)이고 저장되지 않는다(R20).
11. 프로필 설정 값 미설정 키는 플러그인 기본값으로 돈다. 프로필 값이 `profile` 층에서 `user`, `project`, `local` 위에, `launch`, `managed` 아래에서 이긴다(R20).
12. 시크릿 키에 리터럴을 넣으면 `profile.invalid`(`secret_literal`)이고 값은 어느 로그와 이벤트에도 없다(R20).
13. 코어 설정(권한 모드, 기본 모델)을 프로필에 두면 그 프로필을 쓰는 대화의 유효 값이 된다. 블록별 UI 구분은 `ui.block`으로 얻는다(R20).
14. `profile.preview`가 해소된 목록의 항상 / 필요할 때 / Drive 중 비용, 충돌, 필수 설정 누락, 사용 중 대화 수, 도구 변화와 캐시 영향을 돌려준다(R19 입력, R20).
15. 프로필에 없는 검토된 플러그인을 `turn.start.overlay`로 지정하면 그 턴에만 도구와 Hook이 있고, 턴이 정착하면 빠진다. `profile.applied`에 `overlay_on`, `overlay_off`가 남고 프로필의 `usedBy`는 그대로다(R15, F-R6).
16. Drive 플러그인을 덧씌우면 프레임이 해제될 때까지 유지되고, 사용자 중지로 모두 해제되며, 재시작 뒤 프레임이 복원되면 덧씌우기도 복원된다(R15).
17. 도구를 더하는 덧씌우기는 `turn.start.cacheImpact`를 돌려주고, 모델이 도구 변경 덧붙이기를 지원하지 않으면 그 턴에 한 번만 재광고한다(R15).
18. 검토본이 없는 후보를 덧씌우려 하면 `overlay.notReviewed`이고, 초안은 `plugin.draft.create`가 만든 `draftId`로만 덧씌울 수 있으며 격리 1단계(P1) 전에는 `overlay.draftUnavailable`이다. 초안 덧씌우기의 `profile.applied.overlay[].draftId`로부터 그 턴이 `scope_kind = overlay_draft`로 기록되어 지표 집계가 뺀다(R15, flow §8). 초안이 `bypass` 대화에서 실제 작업에 이를 때의 카드 여부는 [결정: 2026-11-17 사용자, U2]다.
19. 프로젝트 안 아무 하위 폴더에서 대화를 시작할 수 있고, 도구의 쓰기가 프로젝트 루트 전체에서 허용되며 루트 밖은 거절된다. 샌드박스 쓰기 root도 같다(R14).
20. 루트에서 대화 폴더까지 경로의 `AGENTS.md`가 루트 먼저 순서로 `sections`에 실리고, 다른 문장이 더해지지 않는다. 상한을 넘는 파일은 실리지 않고 진단이 남는다(R14).
21. `workspace` 없이 만든 대화는 기본 폴더 아래 대화별 폴더에서 돌고 호스트 cwd를 쓰지 않는다(R14).
22. 같은 정규 폴더에서 다른 대화가 돌고 있으면 `thread.create.sameFolder`가 알리고 생성은 막지 않는다. [결정: 2026-11-17 사용자, U6] "대화 시작" 훅이 같은 프로젝트 안 폴더를 정하면 `thread.updated.workspace`로 반영된다(R14, 흐름 8).
23. [결정: 2026-11-17 사용자, U5]: 새 대화 선택기 기본값은 같은 대화 폴더에서 마지막으로 쓴 프로필이다(저장 없이 계산, "프로젝트 기본 프로필"은 없다)(R14).
24. 스킬 파일만 든 폴더가 매니페스트 없이 플러그인으로 인식되고, 프로필에 넣으면 스킬 색인에 실린다. 프로필에서 빼면 사라진다(R4).
25. MCP 설정만 든 폴더, 서브에이전트 정의만 든 폴더, 지침만 든 폴더도 같은 방식으로 인식되어 해당 재료가 대화에 전달된다(R4).
26. `plugin.get`/`plugin.list`가 모든 플러그인에 같은 `PluginCard` 모양을 준다. 도구 플러그인과 Drive 플러그인이 같은 필드 집합을 가진다(F-R3, R6).
27. 검토본 `tree/`가 실행 경로이고 원본 폴더는 읽지 않는다. 검토 뒤 원본의 Hook 코드를 바꿔도 다음 턴 동작은 같고, `pluginReview.list`에 `update` 항목이 하나 생긴다(R5, F-R1).
28. 원본이 검토본과 같은 내용으로 되돌아가면 대기 항목이 `withdrawn`이다. 원본이 두 번 바뀌면 앞 항목은 `superseded`다(R5).
29. 사용자 폴더의 손 수정(`provenance: "unknown"`)은 `pluginReview.decide approve`가 `pluginReview.handEditNotAllowed`이고, `plugin.revert`로 되돌릴 수 있다(R5, F-R1).
30. 담당 AI가 `submit`한 새 플러그인은 승인 전에 어느 프로필에도 `E(T)`에도 들어가지 않고(`plugin_not_reviewed`), 승인하면 선택한 프로필에 맨 뒤로 들어간다. 대상 프로필 하나라도 검증에 실패하면 아무것도 바뀌지 않는다(R6, F-R2).
31. 삭제는 `plugin.requestRemove`가 항목을 만들고, 승인 전에는 계속 돈다. 승인하면 프로필·공통 묶음에서 이름이 빠진다(R6).
32. 검토 항목이 카드, 이전 검토본과의 "하는 일의 차이", 증거 참조, 코드 파일 목록을 가진다. 목적 문장이 없으면 승인할 수 없다(R6).
33. 돌려보내기 사유가 `originThreadId` 대화의 다음 입력으로 들어간다. 버리기는 같은 해시를 다시 올리지 않는다(R6).
34. 프로젝트를 열면(생성, 프로젝트 안 대화 생성, `plugin.scan`) 동반 플러그인이 검토 항목이 되고, 승인 전에는 적재도 문맥 재료로 쓰는 것도 하지 않는다(R24).
35. 검토본 해시가 저장된 값과 다르면 그 플러그인을 적재하지 않고 `health.state: "integrity"`가 된다(R5).
36. 승인된 새 검토본이 다음 단계 경계에서 열린 대화에 적용되고 `profile.applied { reason: "plugin_updated" }`가 남는다(R5).
37. 옮김: v1 `profiles.json`과 `ext.<name>.enabled` 사용자 값이 옮겨져 같은 켜짐 집합을 만든다. 옮김은 멱등이다. `profile.apply` 등 제거된 메서드가 `-32601`이다(R1, R2, R20).
38. 사용자 설치 플러그인이 옮김 뒤에도 같은 내용으로 돌고(검토본 = 설치본), 이후 원본 변경은 검토 항목이 된다(R5).
39. 프로필에서 빼기 명령: 대화 안의 명령 `/profile remove <플러그인 이름>`(이름과 문법은 [제안]이고 C0에서 확정)이 `profile.removePlugin`을 불러 프로필에서 그 플러그인을 빼고, 그 프로필을 쓰는 대화의 다음 단계에서 도구와 Hook이 사라진다. Drive 중인 플러그인이면 `preview.dropsDrive`가 비어 있지 않고 프레임이 내려간다(R1, R29, flow R5).
40. 일회 사용의 이름으로 얹기: Hook 전용 플러그인과 도구 전용 플러그인이 `plugin.invocables`에 `kind: "plugin"` 항목으로 보이고 `turn.start.overlay`로 얹을 수 있다(R15).
41. 번들(`bundled`) 플러그인의 카드에서 `runs.isolated`가 참이고 신뢰 등급이 `user`다. 저장소 패키지만 `builtin`이다(R11, 엔진 설계 §3.1).
42. 프로필 설정 키 검사: 소유 플러그인이 프로필에 든 `l2.*`/`l3.*` 키는 저장되고, 소유 플러그인이 없는 키는 `setting_unknown_key`다. `x.primitives.driveDefaultLimits`는 프로필에 둘 수 있고 천장 `driveLimits`는 `setting_scope_not_allowed`다(R20).

43. 테스트 대화: `craftChat.open`이 `thread.started.craftChat`가 있는 대화를 만들고, `thread.list` 기본과 프로젝트 소속·`sameFolder`·선택기 기본값 계산에서 빠지며 `include: "craft"`로만 나온다. 쓰기는 그 플러그인의 원본 폴더에서만 되고 그 밖은 엔진 root가 거절한다(R17, R26).
44. 숨은 `craft` 프로필: `profile.list`에 없고, 고치기·지우기·`thread.setProfile`이 `profile.builtinProtected`다. 시작 Drive가 빌더이고 사용자 중지 뒤 다음 입력에서 다시 쌓인다(R17).
45. 맥락은 모델 컨텍스트에 줄을 더하지 않는다: `craft.context` 기록과 지연 도구 `authoring_context`로만 읽힌다. 시스템 프롬프트와 요청 본문에 새 문장이 없다(R17, R7).
46. 테스트 대화의 턴은 `scope: craft`로 기록되어 지표 기본 필터에서 빠진다(R16, E 규칙 36).
47. `testRun.start`가 기준 프로필 + 초안의 구성으로 대화를 만들고, 같은 `runGroupId`로 새 초안을 다시 돌릴 수 있다. P1 전에는 `testRun.draftUnavailable`이다. 초안 출신 호출은 `bypass`에서도 카드를 띄운다(R16, U2).
48. 빌더는 직접 설치하지 못하고 초안 → `pluginReview.submitDraft`로만 간다. 기존 플러그인을 `name`만으로 열어 고칠 수 있고, 종류 `plugin-group`이 없다(R26).
49. `plugin.draft.list`, `DraftInfo`, `ReviewDecision.approve.purpose`, `ReviewItemRemoval`, `SettingDef`, `UiDecl`, `profile.default.reset`, `profile.preview.dropsDrive`, `project.list`의 대화 수가 §3.6대로 있다(R6, R3, R14). 소유: `plugin.draft.list`·`DraftInfo`는 M5f(`m5-plan.md` Z13), 나머지는 M5c-1(Z7).
50. 다른 하네스 형식: `.mcp.json`과 `.agents/skills`를 엔진이 읽지 않고 후보로도 만들지 않는다(R4).
51. "지침 추가": 한 줄을 쓰면 `plugin.draft.fromInstruction`이 지침만 든 초안과 `provenance: "user_instruction"` 검토 항목을 만들고, 한 번의 승인으로 프로필에 들어간다. 승인 전에는 모델에 안 보인다(R33).
52. 대화 칩의 프로필 복제: `profile.clone`으로 복제한 뒤 `thread.setProfile`로 그 대화만 복제본으로 전환되고 원래 프로필을 쓰는 다른 대화는 그대로다("이 대화만 다르게", R28 g).

## 9. 다른 스펙과 접하는 곳

### 9.1 주도와 격리 (엔진 설계 스펙)

이 문서가 요구한다:
- 프레임 스택이 기록에서 복원되고, `lease.acquired`에 `contentHash`가 있다(§3.2, §4.3.5. 엔진 설계 §2.6이 `parent`, `depth`, `contentHash`를 한 번에 선언한다).
- 플러그인이 `E(T)`에서 빠질 때 그 프레임과 위를 내리고 `last: aborted`를 아래에 준다(엔진 설계 §2.4, 해제 사유 `disabled`). 이 문서는 그 호출 시점만 정한다. 프로필의 시작 Drive, Drive 덧씌우기, 빠질 때의 프레임 내림, 재시작 복원은 프레임 스택(E3)이 있어야 하고 `x.primitives.activeDriver` 제거도 E3이다.
- `replaceUnit`이 새 검토본 세대로 교체한다(`X.primitives.spec` §4.4.10).
- 플러그인 프로세스는 검토본 `tree/`를 읽기 전용 root로 쓴다(엔진 설계 §3.4). 초안은 `drafts/<draftId>/tree/`에서 돈다. 프로세스 키는 `(이름, 내용 해시 | draftId)`이고(엔진 설계 §3.1) 초안과 검토본, 낡은 세대와 새 세대가 동시에 돌 수 있다. P1에서 `tree/`의 위치는 임시 설치 경로를 먼저 쓰고 나중에 `plugin-store/`로 바꾼다.
- 프로필의 시작 Drive는 스택이 빌 때, 새 대화의 첫 턴 앞에서만 쌓는다. `x.primitives.activeDriver`와 중재기는 엔진 스펙이 지운다.
- 턴 시작 훅 입력의 `driver`, `stack`(엔진 설계 §2.5)은 덧씌우기 지침과 무관하다(주도 중에만 실리는 지침은 훅이 넣고, 항상 싣는 지침은 §4.5.10의 `sections`로 간다).

이 문서가 준다:
- 대화별 `E(T)`와 그 순서, 검토본 경로와 해시, `PluginSetPort`, 덧씌우기 해제 이벤트(프레임 해제에 맞춘다), 초안 표지.
- 엔진 설계가 위임한 "프로필 관련 엔진 작업"(통합본 6절)의 3가지(대화가 프로필을 참조, 플러그인 설정 값 프로필별, 로더)는 이 문서가 맡는다.

### 9.2 기록과 지표 (R12, R16, R18, R19)

요구: 턴 기록이 `profile.applied`, `scope.changed`를 읽을 수 있다. 지표는 `scope_kind`가 `overlay_draft`, `test`인 활동을 기본 집계에서 뺀다(E §4.6, 결정 2026-11-17). 초안·덧씌우기 표지의 정본은 E이고 이 문서는 `profile.applied.overlay[]`만 준다.
제공: `profile.applied`(프로필 개정, 공통 개정, 덧씌우기, 도구 변화, 갱신된 해시), 카드의 `cost`와 `usedBy`, `review-log.jsonl`, 플러그인 프로세스 표준 오류를 잇는 경로는 엔진 스펙이 준다.

### 9.3 Hook 정리 (R21)

요구 [결정: 2026-11-17 사용자, U6]: "대화 시작" 훅이 `workspace`(경로 하나)를 돌려줄 수 있다(§4.4.9). 받을 훅과 결과 모양은 F H-7이 정한다. 같은 Hook에 걸린 핸들러의 호출 순서는 `E(T)` 순서가 기본이고(§4.2.1) 블록 상세에서의 재정렬은 그 스펙이 정한다.
제공: 카드의 `does.hook.hooks[]`(이름, fold, 위치, 할 수 있는 일). 훅 이름은 줄지 않으므로(F §4.1) 이 목록의 이름 집합은 바뀌지 않는다. 매니페스트 `hooks[]`의 이름 검증은 지금 `validateUsage`가 하고, 내부 훅 선언 거부(`hook_internal`)와 `hook_not_fired` 경고(F H-4)는 같은 파일(`contracts/src/extensions/validate.ts`, `manifest.ts`)을 고치므로 매니페스트 변경(§3.1)과 한 트랙이 한 번에 한다.

### 9.4 Craft UI (R16, R17, R23)

요구: 프로필 칩, 프로필 편집, 프로필의 코어 설정 블록별 보기, 검토함, 덧씌우기 선택(`plugin.invocables`), 같은 폴더 경고 표시, 지금 `threadSwitchOf` 등 스위치 모델의 제거.
제공: §3.4의 wire와 알림 전체, `ThreadProfileView`, `PluginCard`(공통 스키마 3층), 검토 항목, 흔적에 쓸 `profile.applied`.
테스트 대화(Craft 전용 AI 대화)는 `originThreadId`로 검토 항목과 이어진다. 그 대화의 생성, 보관, 목록 분리, 쓰기 범위는 이 문서의 §4.8이 정한다. Craft 화면 스펙은 창과 흐름만 정한다.

## 10. 미결

각 항목의 기본값은 이 문서가 이미 쓴 값이다. 사용자 확인 전까지 구현은 기본값으로 진행한다.

1. **기본 폴더 대화의 쓰기 범위.** 기본값: 대화 폴더(`<기본 폴더>/<threadId>`)만. 대안: 기본 폴더 전체(프로젝트 루트 규칙과 같음).
2. **프로젝트 밖 폴더로 `thread.create`를 부를 때.** 기본값: 그 폴더를 루트로 프로젝트를 자동 생성한다(CLI와 예약 실행 유지). 대안: 오류로 거절하고 프로젝트를 먼저 만들게 한다.
3. **도중 전환 때 새 프로필의 시작 Drive.** 기본값: 시작하지 않는다(첫 턴 전에만). 대안: 스택이 비어 있으면 전환 직후 시작.
4. **새 검토본 승인이 번지는 범위.** 기본값: 이름으로 든 모든 프로필(프로필은 버전을 고정하지 않는다). 대안: 프로필마다 해시 핀.
5. **지침 파일 이름.** 기본값: `AGENTS.md`만. 문서(`data-privacy.md:121`)에는 `CLAUDE.md`도 읽는다고 적혀 있으나 코드에 읽는 곳이 없다. 대안: 둘 다 읽는다.
6. **프로젝트 루트 이동.** 기본값: 다루지 않는다(루트 없음 상태로 보인다). 대안: `project.relocate`.
7. **이전 검토본으로 되돌리기.** 기본값: 새 검토 없이 기록만 한다. 대안: 되돌리기도 항목으로.
8. **번들(Helm) 갱신의 검토 면제.** 기본값: 앱 업데이트가 신뢰 근거이므로 항목 없음. 대안: 번들 갱신도 항목으로 올림(처음 한 번은 면제).
9. **기존 대화의 켜짐.** 기본값: 대화별로 꺼 두었던 이력은 버리고 `default`로 계산. 대안: 이력을 읽어 그 대화만 `default`에서 뺀 임시 프로필을 만든다.
10. **공통 묶음에서 한 프로필만 빼기.** 기본값: 지원하지 않는다. 대안: 프로필의 `excludeCommon` 목록.
11. **덧씌우기 플러그인의 설정 값.** 기본값: 프로필 값 없이 플러그인 기본값. 대안: 직전에 쓴 프로필 또는 `default`의 값을 빌려 쓴다.

아래 12~15는 사용자가 아직 정하지 않았다. 기본값으로 진행하고 사용자가 정하면 고친다. (U2, U3, U4, U5, U6과 다른 하네스 형식은 2026-11-17에 사용자가 정해 닫혔고 본문 §4.1.17, §4.2.1, §4.3.8, §4.4.8~4.4.10에 있다.)

12. **[권고: 메인 세션, 확인 대기] 격리 1단계 전에는 초안을 돌리지 않는다.** 기본값: P1 전에 초안 덧씌우기는 `overlay.draftUnavailable`로 거부한다(§4.3.8). 대안: P1 전에도 엔진 안에서 허용.
13. **[제안] U3의 세부.** 합치기를 `tool.call.before`·`agent.spawn.before`에만 쓰는 것, 등급 이름(`guard`, `plugin`, `core`)과 순서. 사용자가 정한 것은 `block` > `replace` > `ask`와 등급 셋, guard 맨 앞이다(§4.2.1).
14. **[제안] 배치 이름.** `.fresnel/hooks`와 그 밖의 비인식 형식 범위, `.fresnel/mcp.json` 등 느슨한 자원의 이름(§4.4.10).
15. **[확인 대기] 테스트 대화의 시작 Drive 재쌓기**(§4.8.6)와 숨은 프로필이 공통 묶음을 받지 않는 것. 기본값은 본문대로.
16. **[확인 대기] 초안 보관 20개**(§4.9.2).

## 11. 요구 추적표

| 요구 | 절 |
|---|---|
| PRD R1 | §3.1, §3.2(`thread.*.profileId`, `profile.applied`), §3.4(`thread.setProfile`, `profile.*`), §4.1.1~4.1.6, §4.1.11~4.1.14, §8 수용 1·2·8 |
| PRD R2 | §3.3(`ext.<name>.enabled`), §3.4 제거, §4.1.2, §4.1.9~4.1.10, §8 수용 3·4 |
| PRD R3 (엔진 쪽) | §3.4(`thread.create`, `thread.setProfile`, `profile.defaultFor`), §4.1.8, §4.4.8, §8 수용 5·6·7. 칩 화면은 §9.4의 Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`) |
| PRD R4 | §4.5.1~4.5.4, §4.5.10, §8 수용 24·25 |
| PRD R5 | §4.5.7~4.5.8, §4.6, §4.7.4~4.7.5, §4.7.11, §8 수용 27·28·29·35·36·38 |
| PRD R6 | §4.7, §3.1(`ReviewItem`), §3.4(`pluginReview.*`), §8 수용 26·30~33 |
| PRD R13 (프로필 상속) | §4.1.15, §8 수용 9 |
| PRD R14 | §4.4, §3.4(`project.*`, `thread.create`), §3.3, §8 수용 19~23 |
| PRD R15 (모든 유형, 이름으로 얹기 포함) | §4.3, §3.4(`turn.start.overlay`, `plugin.invocables`, `plugin.draft.*`), §8 수용 15~18, 40 |
| PRD R28 (프로필 규칙: 공통 묶음, 오류 정지 상태, 시작 Drive, 권한 모드, 권한 확대는 표시만, 계속 허용은 대화 상태) | §4.1.2, §4.1.3, §4.1.8, §4.1.12, §4.2.5~4.2.6, §8 수용 4·7 |
| PRD R29 (프로필에서 빼기 명령) | §3.4(`profile.removePlugin`), §8 수용 39 |
| PRD R32 (설정 값의 출처 표시, 입력 부분) | §3.3(`profile` 범위), §4.2.2. 표시는 Craft 화면 스펙과 F `blocks.applied` |
| PRD R20 | §4.2, §3.3(`profile` 범위), §8 수용 10~14 |
| PRD R24 | §4.4.10, §4.7.9, §8 수용 34 |
| flow R1 | §4.5.8, §4.6.3, §4.7.4, §8 수용 27·29 |
| flow R2 | §4.7.10, §4.3.8, §8 수용 30 |
| flow R4 | §4.1.1, §4.1.4, §8 수용 1·2 |
| flow R5 (엔진 쪽) | §3.4(`profile.removePlugin`), §4.1.9, §4.1.13(프로필에서 빼면 프레임 해제), §8 수용 5·39. 막은 카드에 빼기 단추를 두지 않는 일은 Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`) |
| flow R6 | §4.3, §8 수용 15~18, 40 |
| PRD R16 (테스트 실행의 구성) | §3.6, §4.8.1, §8 수용 46·47 |
| PRD R17 (엔진 쪽: 테스트 대화) | §3.6, §4.8, §8 수용 43~46 |
| PRD R26 (빌더의 초안·제출 경로, 기존 플러그인 고치기, plugin-group 폐기) | §4.9, §8 수용 48 |
| PRD R33 ("지침 추가"의 엔진 쪽) | §4.9.1, §4.10 |
| flow R3 (엔진 쪽) | §3.1 `PluginCard`, §4.5.5, §8 수용 26. 화면 배치는 Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`) |

배치하지 못한 요구는 없다. 부분만 이 문서가 맡는 것: PRD R3의 칩 조작, flow R5의 "막은 카드에 단추 없음", flow R3의 정보 계층(화면), PRD R13의 권한 상속(이미 `permission-ceiling.ts`가 있어 이 문서는 확인만 한다), PRD R19(비용의 입력만 제공, 표시와 합계 화면은 기록과 지표 스펙과 Craft 화면 스펙).
