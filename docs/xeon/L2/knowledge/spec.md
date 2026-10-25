---
id: L2.knowledge.spec
layer: L2
domain: knowledge
kind: spec
status: draft
depends_on: [F.capabilities.spec, F.records.spec, L0.store.spec, L1.persistence.spec, L1.tools.spec, eng.transactions.design, eng.events.design, eng.context-map.design]
binds: [xeon/packages/cap-knowledge/**]
---

# L2 지식과 기억 능력 (knowledge)

패키지: `xeon/packages/cap-knowledge`. 정의 파일: `xeon/packages/contracts/src/capabilities/defs/knowledge.ts`.

## 1. 목적과 범위

L2-d "지식과 기억(저장소)"의 서비스 API, 모델 도구, 저장 규칙을 정한다. 이 층은 저장과 조회만 맡는다(`_research/layer-plan-v2.json` L2-d note).

| 능력 ID | 쓰임 |
|---|---|
| `knowledge.skills` | Agent Skills 규격 `SKILL.md`의 색인, 지연 로딩, 쓰기 |
| `knowledge.memory` | 한도가 있는 상주 메모리 두 저장소(사용자 정보, 환경 사실)의 읽기와 쓰기 |
| `knowledge.search` | 스킬·메모리·과거 세션 전문 검색(FTS5)과 세션 원문 읽기 |
| `knowledge.ledger` | 변경 원장, 롤백, 제안 대기열, 위협 패턴 검사 |

근거: `_research/layer-plan-v2.json` L2-d(다섯 구성요소 모두 1차), `_research/refs/hermes.md` §3.10.1 (라)(마)·§3.10.2·§4, `_research/packages.md` §4.4 L2-d, `_research/session-storage.md`, `eng.context-map.design` 3절 결정 5·4.1 표·5.2.

정하는 것:

- 네 능력의 TypeBox 정의, 모델 도구, 읽기 전용 도구와 쓰기 도구의 구분, 재생 정책
- 스킬의 위치, 탐색, 구조 검증, 인덱스 예산, 지연 로딩, 인덱스 변경 알림
- 메모리 파일 형식, 한도, 세션 시작 스냅샷, 파일 락, 외부 편집 드리프트 처리
- 쓰기 경로: 검증, 위협 패턴 검사, 쓰기 승인 게이트, 제안 대기열, 안전 캡처, 원장 기록
- 변경 원장과 롤백
- 세션 검색 색인 소비자, FTS5 토크나이저, 시작 프로브, 질의 규칙
- `cap_knowledge_` 테이블, 투영기 `cap.knowledge`, 소비자 `cap.knowledge.fts`
- `l2.knowledge.*` 설정 키

다루지 않는 것:

| 대상 | 정하는 곳 | 근거 |
|---|---|---|
| 언제 무엇을 배울지(카운터 트리거, 검토 포크, 제안 도구 `learning_propose`, 큐레이터, 메타인지 피드백) | `L3.learning.spec` | `eng.context-map.design` 3절 결정 5, `_research/layer-plan-v2.json` L2-d note |
| 탐구 정책과 지식 소비 순서 | `L3.helm.spec` | `eng.context-map.design` 3절 결정 4 |
| 승인 프로토콜 자체, 승인 화면 | `L1.tools.spec`, `L4.cli.spec`, `L4.desktop.spec` | `L2.readme` §5.7 |
| 프롬프트 조립 위치(스냅샷과 인덱스를 어디에 넣는지) | `L1.context.spec` | 이 문서는 넣을 내용과 시점만 정한다(§4.2.5, §4.3.4) |
| 세션 이벤트와 투영 저장 | `L1.persistence.spec` | `eng.transactions.design` |
| 데이터 디렉터리와 프로젝트 설정 디렉터리 경로 | `L0.os.spec` | `_research/decisions-log.md` 2026-10-19 설계 규칙 |
| 공유 메모리 저장소 | 보류 | `_research/packages.md` §4.4 L2-d, `_research/item-catalog.md` L2 공유 메모리 행 |

L3 그룹은 이 능력의 서비스 API로만 읽고 쓴다. `cap-knowledge`를 import하지 않고 `g.capability(<ServiceKey>)`로 API를 얻는다(`eng.context-map.design` CM-05, CM-06). 학습 정책을 가진 L3 그룹은 스킬·메모리 파일을 파일 도구로 직접 쓰지 않는다(L3 문서 소관).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 스킬 | `SKILL.md` 하나와 지원 파일(`references/`, `templates/`, `scripts/`, `assets/`)을 담은 디렉터리. Agent Skills 규격 |
| 스킬 루트 | 스킬 디렉터리를 찾는 상위 디렉터리. 사용자, 프로젝트, 확장 제공, 설정 경로 넷 |
| 인덱스 | 스킬 이름과 설명 목록. 모델 컨텍스트에 상시 둔다 |
| 본문 | `SKILL.md`의 frontmatter 뒤 내용. 요청할 때만 읽는다 |
| 메모리 저장소 | 한도가 있는 상주 텍스트 파일 하나. `user`(사용자 정보)와 `env`(환경 사실) 둘 |
| 항목 | 메모리 파일 안에서 `§` 구분 줄로 나눈 단위 |
| 스냅샷 | 세션 시작 때 고정한 메모리와 인덱스. 세션 중 쓰기는 다음 세션에 반영된다 |
| 드리프트 | 이 능력 밖에서 파일이 바뀐 상태 |
| 행위자 | 변경을 일으킨 주체. `KnowledgeActor` |
| 원장 | 모든 스킬·메모리 변경의 기록. 전후 내용을 blob으로 가진다 |
| 안전 캡처 | 변경 직전 현재 내용을 blob으로 저장하는 일. 실패하면 변경하지 않는다 |
| 제안 대기열 | 사람의 결정을 기다리는 에이전트 쓰기 요청 목록 |
| 파괴적 연산 | 기존 내용을 바꾸거나 지우는 연산. §4.4.2 |
| 트리 해시 | 스킬 디렉터리 전체 내용의 해시. 읽기 선행 검사(`baseHash`)에 쓴다 |

## 3. 인터페이스

모든 이름은 `@xeon/contracts/capabilities`의 `defs/knowledge.ts`에서 export한다(`F.capabilities.spec` §3.9 [제안], `L2.readme` §3). 아래 코드는 export 상수의 명시 타입 주석을 줄였다. 실제 파일은 `isolatedDeclarations` 때문에 export마다 명시 타입을 단다.

### 3.1 공통 타입

```ts
import { Type, type Static } from "typebox";
import { defineCapability, serviceKey, type ToolContent } from "../index.ts";
import { localIdPattern } from "../../conversation/index.ts";   // F.conversation §3.2.1 LocalIdPrefix

/** Agent Skills 이름 규칙. pi skills.ts validateName과 같다(소문자, 숫자, 하이픈, 64자) */
export const SkillNameSchema = Type.String({ pattern: "^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$" });
export const SkillScopeSchema = Type.Union([
  Type.Literal("user"), Type.Literal("project"), Type.Literal("extension"), Type.Literal("path"),
]);
export const WritableSkillScopeSchema = Type.Union([Type.Literal("user"), Type.Literal("project")]);
export const MemoryStoreSchema = Type.Union([Type.Literal("user"), Type.Literal("env")]);

/** sha256 hex 64자. L3.learning.spec ProposeInputSchema.baseHash와 같은 형식 */
export const HashHexSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });
/** 메모리 항목 ID. 항목 텍스트(NFC) sha256의 앞 12자 */
export const MemoryEntryIdSchema = Type.String({ pattern: "^[0-9a-f]{12}$" });
/** 원장·제안 ID. LocalIdFactory.next("knl" | "knp")로 만든다 */
export const LedgerIdSchema = Type.String({ pattern: localIdPattern("knl") });
export const ProposalIdSchema = Type.String({ pattern: localIdPattern("knp") });
/** 지원 파일 상대 경로. 허용 하위 디렉터리 넷 중 하나로 시작한다 */
export const SkillFilePathSchema = Type.String({
  pattern: "^(references|templates|scripts|assets)/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+){0,4}$",
  maxLength: 256,
});

/** 행위자. 서비스가 CallOptions.context.caller(CallerInfo, L2.readme §5.8)에서 만든다. 호출자가 입력으로 넘기지 않는다 */
export const KnowledgeActorSchema = Type.Union([
  Type.Object({ kind: Type.Literal("user"), client: Type.Optional(Type.String({ maxLength: 32 })) }),
  Type.Object({
    kind: Type.Literal("agent"),
    sessionId: Type.String({ maxLength: 64 }),
    toolCallId: Type.Optional(Type.String({ maxLength: 64 })),
    agent: Type.Union([Type.Literal("main"), Type.Literal("subagent"), Type.Literal("background")]),
  }),
  Type.Object({ kind: Type.Literal("extension"), extension: Type.String({ maxLength: 64 }) }),
  Type.Object({ kind: Type.Literal("external") }),   // 드리프트로 발견한 바깥 편집
  Type.Object({ kind: Type.Literal("system") }),     // 시작 시 복구, 재색인
]);
export type KnowledgeActor = Static<typeof KnowledgeActorSchema>;

/** 확장(L3 그룹 등)이 자기 대기열에서 사람이 승인했음을 알리는 증거 */
export const ApprovalEvidenceSchema = Type.Object({
  /** "<확장 이름>.<대기열 이름>". 예: "<그룹 이름>.queue". 첫 마디는 F.extensions.spec EXTENSION_NAME_PATTERN(review.decisions-2 U-18) */
  source: Type.String({ pattern: "^[a-z][a-z0-9-]{1,31}\\.[a-z][a-z0-9-]{0,31}$" }),
  /** 예: "<proposalId>:<revision>" */
  ref: Type.String({ minLength: 1, maxLength: 128 }),
  decidedAt: Type.Integer({ minimum: 0 }),   // epoch ms
});

export const ScanFindingSchema = Type.Object({
  rule: Type.String({ pattern: "^[a-z][a-z0-9_.]{1,63}$" }),
  severity: Type.Union([Type.Literal("block"), Type.Literal("warn")]),
  /** 걸린 위치(줄 번호). 걸린 문자열은 담지 않는다(비밀 재노출 방지) */
  line: Type.Optional(Type.Integer({ minimum: 1 })),
});
export const ScanSummarySchema = Type.Object({
  rulesetVersion: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }),
  findings: Type.Array(ScanFindingSchema, { maxItems: 64 }),
});

/** 모든 쓰기 메서드의 출력 */
export const WriteOutcomeSchema = Type.Object({
  status: Type.Union([Type.Literal("applied"), Type.Literal("queued")]),
  ledgerId: Type.Optional(LedgerIdSchema),        // applied일 때
  proposalId: Type.Optional(ProposalIdSchema),    // queued일 때
  /** applied 뒤 대상의 해시(스킬은 트리 해시, 메모리는 파일 해시) */
  afterHash: Type.Optional(HashHexSchema),
  approvedBy: Type.Optional(Type.Union([
    Type.Literal("user"),        // 행위자가 사용자
    Type.Literal("approval"),    // xeon.approvals 승인
    Type.Literal("evidence"),    // ApprovalEvidence
    Type.Literal("policy"),      // 쓰기 승인 꺼짐, 비파괴 연산
  ])),
  scan: ScanSummarySchema,
  /** 인덱스(스킬 이름·설명)가 바뀌었는지. 바뀌면 다음 turn에 델타 알림(§4.2.6) */
  indexChanged: Type.Boolean(),
});
export type WriteOutcome = Static<typeof WriteOutcomeSchema>;

/** 쓰기 메서드의 공통 선택 입력. 모델 도구 파라미터에는 없다 */
const writeExtras = {
  /** caller.kind가 extension일 때만 인정한다 */
  approval: Type.Optional(ApprovalEvidenceSchema),
  /** caller.kind가 host일 때만 인정한다. block 판정을 경고로 낮춘다 */
  overrideScan: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
};

/** 지난 세션 원문과 스킬 본문을 모델에게 보일 때의 경계(L2.readme §5.3 명명 규칙) */
export const UNTRUSTED_SESSION_OPEN = "<untrusted_session_content";
```

- 행위자는 입력 필드가 아니다. 서비스는 `CallOptions.context.caller`(`CallerInfo`, `L2.readme` §5.8의 L2 공통 `F.capabilities.spec` 변경 요청)에서 행위자를 만든다. 이 문서에서 `caller.kind`, `caller.afterUntrusted`로 짧게 쓴 것은 이 필드다. `caller.kind = "model"`이면 `agent`, `extension`이면 `extension`, `host`이면 `user`다. 호출자가 행위자를 꾸며 승인 게이트를 건너뛰지 못하게 하기 위해서다.
- `approval`과 `overrideScan`은 호출자 종류가 맞지 않으면 무시하지 않고 `invalid_input`으로 거부한다. 모델 도구 파라미터에는 두 필드가 없다(§3.6).
- 지원 파일 경로 [결정: KN.1]. `SkillFilePathSchema`의 패턴은 `references/../x`와 `references/.hidden`을 받아들인다. 서비스는 경로를 입력으로 받은 모든 메서드(`view`, `patch`, `writeFile`, `remove`)에서 파일을 열기 전에 F의 `isSkillFilePath`(패턴과 `.`·`..` 마디 거부)를 부른다. 이 패키지는 거기에 점으로 시작하거나 끝나는 마디의 거부를 더한다(`skills/paths.ts` `isAddressableSkillFile`). 트리 해시와 안전 캡처가 점 항목을 보지 않으므로(§4.2.3), 점으로 시작하는 지원 파일을 쓰면 `baseHash`가 그 파일의 변경을 가리지 못하기 때문이다. 끝에 점이 붙은 마디는 Windows가 점을 지워 다른 파일이 되는 것을 막는다.
- 스키마를 좁힌다 [결정: KN.1, 반영됨: m2 F.8]. F가 받아들였다: `SkillFilePathSchema`의 패턴을 `^(references|templates|scripts|assets)/[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?(?:/[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?){0,4}$`로 바꾸고 `isSkillFilePath`는 이 패턴과 같은 규칙만 남긴다. 모델에 보이는 JSON Schema가 거부할 경로를 미리 거절하게 하는 것이 목적이다. F가 받아들이기 전까지 `isAddressableSkillFile`이 같은 규칙을 지키고, 받아들이면 그 함수는 `isSkillFilePath` 호출 한 줄이 된다. 이 패키지는 사용자 입력 경로를 디렉터리 경로에 이어 붙여 열지 않는다. `view`는 트리를 읽은 결과(메모리)에서 경로를 찾으므로 입력 경로가 파일 시스템 호출에 쓰이지 않는다.

### 3.2 `knowledge.skills`

```ts
export const SkillIndexEntrySchema = Type.Object({
  name: SkillNameSchema,
  /** 인덱스 표시용으로 자른 설명. 원문은 view의 description */
  description: Type.String({ maxLength: 1024 }),
  scope: SkillScopeSchema,
  createdBy: Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("unknown")]),
  treeHash: HashHexSchema,
  /** frontmatter disable-model-invocation. 참이면 모델 인덱스에서 뺀다 */
  modelInvocable: Type.Boolean(),
});

export const SkillListInputSchema = Type.Object({
  scopes: Type.Optional(Type.Array(SkillScopeSchema, { minItems: 1, maxItems: 4 })),
  includeHidden: Type.Optional(Type.Boolean()),   // modelInvocable=false 포함
});
export const SkillListOutputSchema = Type.Object({
  skills: Type.Array(SkillIndexEntrySchema, { maxItems: 2_000 }),
  /** 모델 인덱스 예산 사용량 */
  budget: Type.Object({ limitChars: Type.Integer(), usedChars: Type.Integer(), omitted: Type.Integer({ minimum: 0 }) }),
  indexVersion: Type.Integer({ minimum: 0 }),
  diagnostics: Type.Array(Type.Object({
    severity: Type.Union([Type.Literal("warning"), Type.Literal("collision")]),
    message: Type.String({ maxLength: 512 }),
    path: Type.String({ maxLength: 1024 }),
  }), { maxItems: 200 }),
});

export const SkillViewInputSchema = Type.Object({
  name: SkillNameSchema,
  /** 지원 파일 하나를 읽을 때. 없으면 SKILL.md 본문 */
  file: Type.Optional(SkillFilePathSchema),
  scope: Type.Optional(SkillScopeSchema),
});
export const SkillViewOutputSchema = Type.Object({
  name: SkillNameSchema,
  scope: SkillScopeSchema,
  description: Type.String({ maxLength: 1024 }),
  /** file이 없으면 SKILL.md 본문(frontmatter 제외), 있으면 그 파일 내용 */
  content: Type.String({ maxLength: 1_048_576 }),
  files: Type.Array(SkillFilePathSchema, { maxItems: 500 }),
  treeHash: HashHexSchema,
  createdBy: Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("unknown")]),
});

export const SkillCreateInputSchema = Type.Object({
  name: SkillNameSchema,
  description: Type.String({ minLength: 1, maxLength: 1024 }),
  body: Type.String({ minLength: 1, maxLength: 100_000 }),
  scope: Type.Optional(WritableSkillScopeSchema),   // 기본 user
  ...writeExtras,
});
export const SkillEditInputSchema = Type.Object({
  name: SkillNameSchema,
  scope: Type.Optional(WritableSkillScopeSchema),
  baseHash: HashHexSchema,
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  body: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
  ...writeExtras,
});
export const SkillPatchInputSchema = Type.Object({
  name: SkillNameSchema,
  scope: Type.Optional(WritableSkillScopeSchema),
  baseHash: HashHexSchema,
  /** SKILL.md 본문(또는 file)에 차례로 적용하는 정확 일치 치환. oldText는 본문에서 정확히 한 번 나와야 한다 */
  edits: Type.Array(Type.Object({
    oldText: Type.String({ minLength: 1, maxLength: 20_000 }),
    newText: Type.String({ maxLength: 20_000 }),
  }), { minItems: 1, maxItems: 32 }),
  file: Type.Optional(SkillFilePathSchema),
  ...writeExtras,
});
export const SkillWriteFileInputSchema = Type.Object({
  name: SkillNameSchema,
  scope: Type.Optional(WritableSkillScopeSchema),
  path: SkillFilePathSchema,
  content: Type.String({ maxLength: 1_048_576 }),
  /** 기존 파일을 덮어쓸 때 필수 */
  baseHash: Type.Optional(HashHexSchema),
  ...writeExtras,
});
export const SkillRemoveInputSchema = Type.Object({
  name: SkillNameSchema,
  scope: Type.Optional(WritableSkillScopeSchema),
  baseHash: HashHexSchema,
  /** archive가 기본. delete는 행위자가 user일 때만 */
  mode: Type.Optional(Type.Union([Type.Literal("archive"), Type.Literal("delete")])),
  /** 지원 파일 하나만 지울 때 */
  file: Type.Optional(SkillFilePathSchema),
  ...writeExtras,
});

/** 모델 도구 skill_manage용 단일 입력. 루트가 객체여야 하므로(F §4.3) 판별 필드 action과 선택 필드로 둔다 */
export const SkillManageParamsSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create"), Type.Literal("edit"), Type.Literal("patch"),
    Type.Literal("write_file"), Type.Literal("remove"),
  ]),
  name: SkillNameSchema,
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  body: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
  baseHash: Type.Optional(HashHexSchema),
  edits: Type.Optional(Type.Array(Type.Object({
    oldText: Type.String({ minLength: 1, maxLength: 20_000 }),
    newText: Type.String({ maxLength: 20_000 }),
  }), { minItems: 1, maxItems: 32 })),
  path: Type.Optional(SkillFilePathSchema),
  content: Type.Optional(Type.String({ maxLength: 1_048_576 })),
});
export const SkillManageInputSchema = Type.Object({
  ...SkillManageParamsSchema.properties,
  scope: Type.Optional(WritableSkillScopeSchema),
});

const skillWriteErrors = {
  base_stale: { description: "baseHash가 현재 트리 해시와 다름. view로 다시 읽어야 한다", retryable: false },
  name_conflict: { description: "같은 범위에 같은 이름의 스킬이 있음", retryable: false },
  limit_exceeded: { description: "이름·설명·본문·지원 파일 크기 한도를 넘음", retryable: false },
  scan_blocked: { description: "위협 패턴 검사가 block 판정을 냄. detail에 규칙 이름", retryable: false },
  approval_denied: { description: "사용자가 승인 요청을 거부함", retryable: false },
  read_only_scope: { description: "extension·path 범위 스킬은 쓸 수 없음", retryable: false },
  patch_mismatch: { description: "oldText가 본문에 없거나 두 번 이상 나옴", retryable: false },
};

export const KnowledgeSkills = defineCapability({
  id: "knowledge.skills",
  version: "1.0.0",
  description: "Agent Skills 스킬의 색인, 본문 지연 로딩, 승인과 원장을 거친 쓰기.",
  service: {
    methods: {
      list:      { description: "스킬 인덱스를 돌려준다.", input: SkillListInputSchema, output: SkillListOutputSchema, replay: "safe" },
      view:      { description: "스킬 본문이나 지원 파일 하나를 읽는다.", input: SkillViewInputSchema, output: SkillViewOutputSchema, replay: "safe" },
      create:    { description: "새 스킬을 만든다.", input: SkillCreateInputSchema, output: WriteOutcomeSchema, errors: skillWriteErrors },
      edit:      { description: "설명이나 본문 전체를 바꾼다.", input: SkillEditInputSchema, output: WriteOutcomeSchema, errors: skillWriteErrors },
      patch:     { description: "본문이나 지원 파일에 정확 일치 치환을 적용한다.", input: SkillPatchInputSchema, output: WriteOutcomeSchema, errors: skillWriteErrors },
      writeFile: { description: "지원 파일 하나를 쓴다.", input: SkillWriteFileInputSchema, output: WriteOutcomeSchema, errors: skillWriteErrors },
      remove:    { description: "스킬이나 지원 파일을 보관함으로 옮기거나 지운다.", input: SkillRemoveInputSchema, output: WriteOutcomeSchema, errors: skillWriteErrors },
      manage:    { description: "action에 따라 create·edit·patch·writeFile·remove 중 하나로 보낸다.", input: SkillManageInputSchema, output: WriteOutcomeSchema, errors: skillWriteErrors },
      reindex:   { description: "스킬 루트를 다시 훑어 색인과 파일을 맞춘다. 바깥 편집은 원장에 external로 남긴다.",
                   input: Type.Object({}), output: Type.Object({ added: Type.Integer(), changed: Type.Integer(), removed: Type.Integer(), indexVersion: Type.Integer() }),
                   replay: "safe" },
    },
  },
  tools: [
    { name: "skill_view", label: "스킬 읽기",
      description: "스킬 인덱스에 있는 스킬의 본문이나 지원 파일을 읽는다. 쓰기 전에 반드시 읽고 treeHash를 baseHash로 쓴다.",
      method: "view", parameters: SkillViewInputSchema, toContent: renderSkillView,
      replay: "safe", executionMode: "parallel", hints: { readOnly: true, idempotent: true } },
    { name: "skill_manage", label: "스킬 관리",
      description: "스킬을 만들거나 고치거나 지원 파일을 쓰거나 보관함으로 옮긴다. 쓰기는 사용자 승인이나 제안 대기열을 거친다.",
      method: "manage", parameters: SkillManageParamsSchema, toInput: (p) => ({ ...p }), toContent: renderWriteOutcome,
      replay: "unsafe", executionMode: "sequential", hints: { readOnly: false, destructive: true } },
  ],
});
export const KnowledgeSkillsKey = serviceKey(KnowledgeSkills);
```

- 쓰기 메서드의 `replay`는 생략(`"unsafe"`)이다. 같은 `requestId`의 두 번째 호출은 원장에서 첫 결과를 돌려주므로(§4.4.5) 그룹의 재시도는 안전하지만, 결과 불명인 모델 도구 호출을 다시 실행하면 승인 요청이 다시 뜰 수 있어 재생하지 않는다 [제안].
- `manage`는 다른 쓰기 메서드와 같은 경로로 보내는 분배기다. 모델 도구가 메서드 하나에 대응해야 하므로(`F.capabilities.spec` §4.2) 둔다. `action`별 필수 필드 검사(예: `patch`는 `baseHash`, `edits`)는 런타임에서 하고 실패하면 `invalid_input`이다.
- `skill_manage`의 `scope`는 모델 파라미터에 없다. 모델 쓰기는 `user` 범위로 간다. 프로젝트 스킬(`.xeon/skills`)은 사용자나 확장(증거 있음)만 쓴다 [제안]. 저장소에 커밋되는 파일을 에이전트가 승인 없이 바꾸지 않게 하기 위해서다.

### 3.3 `knowledge.memory`

```ts
export const MemoryEntrySchema = Type.Object({
  id: MemoryEntryIdSchema,
  text: Type.String({ maxLength: 20_000 }),
  chars: Type.Integer({ minimum: 0 }),
});
export const MemoryStoreViewSchema = Type.Object({
  store: MemoryStoreSchema,
  entries: Type.Array(MemoryEntrySchema, { maxItems: 500 }),
  usedChars: Type.Integer({ minimum: 0 }),
  limitChars: Type.Integer({ minimum: 0 }),
  /** 파일 전체 해시. replace·remove의 baseHash */
  fileHash: HashHexSchema,
  /** 드리프트로 쓰기를 막은 상태면 참 */
  writeBlocked: Type.Boolean(),
});

export const MemoryReadInputSchema = Type.Object({
  stores: Type.Optional(Type.Array(MemoryStoreSchema, { minItems: 1, maxItems: 2 })),
});
export const MemoryReadOutputSchema = Type.Object({
  stores: Type.Array(MemoryStoreViewSchema, { maxItems: 2 }),
});

export const MemoryAddInputSchema = Type.Object({
  store: MemoryStoreSchema,
  text: Type.String({ minLength: 1, maxLength: 20_000 }),
  ...writeExtras,
});
export const MemoryReplaceInputSchema = Type.Object({
  store: MemoryStoreSchema,
  entryId: MemoryEntryIdSchema,
  text: Type.String({ minLength: 1, maxLength: 20_000 }),
  baseHash: HashHexSchema,
  ...writeExtras,
});
export const MemoryRemoveInputSchema = Type.Object({
  store: MemoryStoreSchema,
  entryId: MemoryEntryIdSchema,
  baseHash: HashHexSchema,
  ...writeExtras,
});

/** 모델 도구 memory_manage용. batch는 한도가 찼을 때 remove와 add를 한 번에 하기 위해 둔다 */
const MemoryOpSchema = Type.Object({
  action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")]),
  entryId: Type.Optional(MemoryEntryIdSchema),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
});
export const MemoryManageParamsSchema = Type.Object({
  store: MemoryStoreSchema,
  action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove"), Type.Literal("batch")]),
  entryId: Type.Optional(MemoryEntryIdSchema),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
  baseHash: Type.Optional(HashHexSchema),
  ops: Type.Optional(Type.Array(MemoryOpSchema, { minItems: 1, maxItems: 8 })),
});
export const MemoryManageInputSchema = Type.Object({ ...MemoryManageParamsSchema.properties, ...writeExtras });

export const MemoryWriteOutputSchema = Type.Object({
  outcome: WriteOutcomeSchema,
  /** 쓰기 뒤 현재 상태. queued면 쓰기 전 상태 */
  view: MemoryStoreViewSchema,
});

const memoryWriteErrors = {
  memory_full: { description: "쓰기 뒤 크기가 한도를 넘음. detail에 현재 항목 목록", retryable: false },
  base_stale: { description: "baseHash가 현재 파일 해시와 다름", retryable: false },
  drift_detected: { description: "파일 구조가 바깥 편집으로 깨져 쓰기를 막음. .bak 사본을 남겼다", retryable: false },
  scan_blocked: { description: "위협 패턴 검사가 block 판정을 냄", retryable: false },
  approval_denied: { description: "사용자가 승인 요청을 거부함", retryable: false },
  duplicate_entry: { description: "같은 텍스트의 항목이 이미 있음", retryable: false },
};

export const KnowledgeMemory = defineCapability({
  id: "knowledge.memory",
  version: "1.0.0",
  description: "사용자 정보(user)와 환경 사실(env) 두 저장소의 한도 있는 상주 메모리.",
  service: {
    methods: {
      read:    { description: "현재 메모리 상태를 읽는다. 세션 스냅샷과 다를 수 있다.", input: MemoryReadInputSchema, output: MemoryReadOutputSchema, replay: "safe" },
      add:     { description: "항목 하나를 더한다.", input: MemoryAddInputSchema, output: MemoryWriteOutputSchema, errors: memoryWriteErrors },
      replace: { description: "항목 하나를 바꾼다.", input: MemoryReplaceInputSchema, output: MemoryWriteOutputSchema, errors: memoryWriteErrors },
      remove:  { description: "항목 하나를 지운다.", input: MemoryRemoveInputSchema, output: MemoryWriteOutputSchema, errors: memoryWriteErrors },
      manage:  { description: "action에 따라 add·replace·remove 또는 batch로 보낸다. batch는 원자적이다.", input: MemoryManageInputSchema, output: MemoryWriteOutputSchema, errors: memoryWriteErrors },
    },
  },
  tools: [
    { name: "memory_manage", label: "메모리 관리",
      description: "상주 메모리에 항목을 더하거나 바꾸거나 지운다. user는 사람에 관한 것, env는 환경 사실이다. 한 사실을 두 곳에 쓰지 않는다. 바꾸거나 지울 때는 스냅샷이나 직전 결과의 fileHash를 baseHash로 쓴다.",
      method: "manage", parameters: MemoryManageParamsSchema, toInput: (p) => ({ ...p }), toContent: renderMemoryWrite,
      replay: "unsafe", executionMode: "sequential", hints: { readOnly: false, destructive: true } },
  ],
});
export const KnowledgeMemoryKey = serviceKey(KnowledgeMemory);
```

- 메모리 읽기 도구는 두지 않는다. 메모리는 세션 시작 스냅샷으로 컨텍스트에 이미 있다(§4.3.4). 스냅샷에는 항목 ID와 `fileHash`가 함께 실린다.
- 저장소 두 개의 쓰임은 Hermes 메모리 검토 프롬프트의 구분을 따른다: `user`는 페르소나·선호·작업 방식, `env`는 도구 특이점·프로젝트 규약·경로(`_research/refs/hermes.md` §3.10.1 (다)).

### 3.4 `knowledge.search`

```ts
export const KnowledgeKindSchema = Type.Union([Type.Literal("skill"), Type.Literal("memory"), Type.Literal("session")]);
export const SessionRoleSchema = Type.Union([Type.Literal("user"), Type.Literal("assistant")]);

export const KnowledgeHitSchema = Type.Object({
  kind: KnowledgeKindSchema,
  /** kind별 참조. skill: name, memory: "<store>:<entryId>", session: "<sessionId>:<seq>" */
  ref: Type.String({ minLength: 1, maxLength: 200 }),
  title: Type.String({ maxLength: 256 }),
  snippet: Type.String({ maxLength: 600 }),
  /** bm25 값(작을수록 잘 맞음). LIKE 경로면 생략 */
  score: Type.Optional(Type.Number()),
  sessionId: Type.Optional(Type.String({ maxLength: 64 })),
  seq: Type.Optional(Type.Integer({ minimum: 1 })),
  role: Type.Optional(SessionRoleSchema),
  at: Type.Optional(Type.Integer({ minimum: 0 })),   // epoch ms
});

const searchQueryFields = {
  query: Type.String({ minLength: 1, maxLength: 256, description: "찾을 낱말이나 구절. 2글자 이하도 된다." }),
  kinds: Type.Optional(Type.Array(KnowledgeKindSchema, { minItems: 1, maxItems: 3, uniqueItems: true })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
  after: Type.Optional(Type.Integer({ minimum: 0 })),
  before: Type.Optional(Type.Integer({ minimum: 0 })),
};
export const KnowledgeQueryInputSchema = Type.Object({
  ...searchQueryFields,
  /** 크론·서브에이전트·백그라운드 세션 포함. 기본 false */
  includeHidden: Type.Optional(Type.Boolean()),
  sessionIds: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 50 })),
  /** "all" 또는 "project"(현재 프로젝트 세션만). 생략하면 설정 l2.knowledge.search.defaultScope */
  scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("project")])),
});
export const KnowledgeQueryToolParamsSchema = Type.Object(searchQueryFields);
export const KnowledgeQueryOutputSchema = Type.Object({
  hits: Type.Array(KnowledgeHitSchema, { maxItems: 50 }),
  /** 쓴 경로. fts(MATCH) 또는 like(3글자 미만 질의) */
  path: Type.Union([Type.Literal("fts"), Type.Literal("like")]),
  degraded: Type.Optional(Type.Array(KnowledgeKindSchema)),   // FTS5 불가로 뺀 종류
});

export const SessionMessageSchema = Type.Object({
  sessionId: Type.String({ maxLength: 64 }),
  seq: Type.Integer({ minimum: 1 }),
  role: SessionRoleSchema,
  at: Type.Integer({ minimum: 0 }),
  text: Type.String({ maxLength: 100_000 }),
  truncated: Type.Boolean(),
});
export const SessionScrollInputSchema = Type.Object({
  sessionId: Type.String({ minLength: 1, maxLength: 64 }),
  aroundSeq: Type.Integer({ minimum: 1 }),
  before: Type.Optional(Type.Integer({ minimum: 0, maximum: 50, default: 5 })),
  after: Type.Optional(Type.Integer({ minimum: 0, maximum: 50, default: 5 })),
});
export const SessionReadInputSchema = Type.Object({
  sessionId: Type.String({ minLength: 1, maxLength: 64 }),
  fromSeq: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});
export const SessionMessagesOutputSchema = Type.Object({
  messages: Type.Array(SessionMessageSchema, { maxItems: 200 }),
  nextSeq: Type.Optional(Type.Integer({ minimum: 1 })),
});
export const SessionListInputSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 20 })),
  before: Type.Optional(Type.Integer({ minimum: 0 })),   // last_at 기준 이전 페이지
  includeHidden: Type.Optional(Type.Boolean()),
  scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("project")])),
});
export const SessionListOutputSchema = Type.Object({
  sessions: Type.Array(Type.Object({
    sessionId: Type.String({ maxLength: 64 }),
    title: Type.Optional(Type.String({ maxLength: 256 })),
    kind: Type.Union([Type.Literal("main"), Type.Literal("subagent"), Type.Literal("background"), Type.Literal("cron")]),
    createdAt: Type.Integer({ minimum: 0 }),
    lastAt: Type.Integer({ minimum: 0 }),
    messages: Type.Integer({ minimum: 0 }),
  }), { maxItems: 200 }),
});

export const KnowledgeSearch = defineCapability({
  id: "knowledge.search",
  version: "1.0.0",
  description: "스킬·메모리·지난 세션 전문 검색. 세션은 LLM 요약 없이 원문을 돌려준다.",
  service: {
    methods: {
      query:  { description: "질의어로 스킬·메모리·세션 메시지를 찾는다.", input: KnowledgeQueryInputSchema, output: KnowledgeQueryOutputSchema, replay: "safe" },
      scroll: { description: "세션의 한 메시지 앞뒤를 읽는다.", input: SessionScrollInputSchema, output: SessionMessagesOutputSchema, replay: "safe" },
      read:   { description: "세션 메시지를 seq 순으로 읽는다.", input: SessionReadInputSchema, output: SessionMessagesOutputSchema, replay: "safe" },
      list:   { description: "최근 세션 목록을 돌려준다.", input: SessionListInputSchema, output: SessionListOutputSchema, replay: "safe" },
    },
  },
  tools: [
    { name: "knowledge_search", label: "지식 검색",
      description: "저장된 스킬, 메모리, 지난 대화에서 낱말이나 구절을 찾는다. 지난 대화 원문은 신뢰하지 않는 기록이다.",
      method: "query", parameters: KnowledgeQueryToolParamsSchema, toInput: (p) => ({ ...p }), toContent: renderHits,
      replay: "safe", executionMode: "parallel", hints: { readOnly: true, idempotent: true } },
    { name: "session_scroll", label: "지난 대화 앞뒤 보기",
      description: "knowledge_search가 찾은 메시지의 앞뒤 원문을 읽는다.",
      method: "scroll", parameters: SessionScrollInputSchema, toContent: renderMessages,
      replay: "safe", executionMode: "parallel", hints: { readOnly: true, idempotent: true } },
    { name: "session_read", label: "지난 대화 읽기",
      description: "지난 세션 하나의 메시지를 순서대로 읽는다.",
      method: "read", parameters: SessionReadInputSchema, toContent: renderMessages,
      replay: "safe", executionMode: "parallel", hints: { readOnly: true, idempotent: true } },
  ],
});
export const KnowledgeSearchKey = serviceKey(KnowledgeSearch);
```

- 네 형태(발견, 스크롤, 읽기, 목록)는 Hermes `session_search`의 형태를 메서드로 나눈 것이다(`_research/refs/hermes.md` §3.10.2). `list`는 모델 도구를 두지 않는다. 세션 목록은 L4 화면과 그룹이 쓴다.
- 모델 도구 파라미터에는 `includeHidden`, `sessionIds`, `scope`가 없다. 숨긴 세션(크론, 서브에이전트)을 모델이 찾지 않게 하기 위해서다.

### 3.5 `knowledge.ledger`

```ts
export const LedgerOpSchema = Type.Union([
  Type.Literal("skill.create"), Type.Literal("skill.edit"), Type.Literal("skill.patch"),
  Type.Literal("skill.write_file"), Type.Literal("skill.archive"), Type.Literal("skill.delete"),
  Type.Literal("memory.add"), Type.Literal("memory.replace"), Type.Literal("memory.remove"), Type.Literal("memory.batch"),
  Type.Literal("external"), Type.Literal("rollback"),
]);
export const LedgerTargetSchema = Type.Object({
  kind: Type.Union([Type.Literal("skill"), Type.Literal("memory")]),
  /** skill: 이름, memory: 저장소 */
  name: Type.String({ minLength: 1, maxLength: 64 }),
  scope: Type.Optional(WritableSkillScopeSchema),
});
export const LedgerEntrySchema = Type.Object({
  ledgerId: LedgerIdSchema,
  at: Type.Integer({ minimum: 0 }),
  actor: KnowledgeActorSchema,
  target: LedgerTargetSchema,
  op: LedgerOpSchema,
  beforeHash: Type.Union([HashHexSchema, Type.Null()]),
  afterHash: Type.Union([HashHexSchema, Type.Null()]),
  approvedBy: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("approval"), Type.Literal("evidence"), Type.Literal("policy")])),
  evidence: Type.Optional(ApprovalEvidenceSchema),
  scan: ScanSummarySchema,
  reason: Type.Optional(Type.String({ maxLength: 500 })),
  proposalId: Type.Optional(ProposalIdSchema),
  rollbackOf: Type.Optional(LedgerIdSchema),
  rolledBackBy: Type.Optional(LedgerIdSchema),
});

export const LedgerListInputSchema = Type.Object({
  target: Type.Optional(LedgerTargetSchema),
  actorKind: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("extension"), Type.Literal("external"), Type.Literal("system")])),
  before: Type.Optional(LedgerIdSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});
export const LedgerShowOutputSchema = Type.Object({
  entry: LedgerEntrySchema,
  /** 바뀐 파일과 통합 diff. 바이너리 파일은 diff 없이 크기만 */
  files: Type.Array(Type.Object({
    path: Type.String({ maxLength: 256 }),
    change: Type.Union([Type.Literal("added"), Type.Literal("modified"), Type.Literal("removed")]),
    diff: Type.Optional(Type.String({ maxLength: 200_000 })),
    bytesBefore: Type.Optional(Type.Integer({ minimum: 0 })),
    bytesAfter: Type.Optional(Type.Integer({ minimum: 0 })),
  }), { maxItems: 500 }),
});

export const ProposalSchema = Type.Object({
  proposalId: ProposalIdSchema,
  createdAt: Type.Integer({ minimum: 0 }),
  actor: KnowledgeActorSchema,
  target: LedgerTargetSchema,
  op: LedgerOpSchema,
  baseHash: Type.Union([HashHexSchema, Type.Null()]),
  status: Type.Union([
    Type.Literal("pending"), Type.Literal("applied"), Type.Literal("rejected"),
    Type.Literal("stale"), Type.Literal("expired"),
  ]),
  /** 사람이 볼 diff(현재 내용 기준) */
  preview: Type.String({ maxLength: 200_000 }),
  scan: ScanSummarySchema,
  ledgerId: Type.Optional(LedgerIdSchema),
});

export const KnowledgeLedger = defineCapability({
  id: "knowledge.ledger",
  version: "1.0.0",
  description: "스킬·메모리 변경 원장, 롤백, 제안 대기열, 위협 패턴 검사.",
  service: {
    methods: {
      list:      { description: "원장 항목을 최신순으로 돌려준다.", input: LedgerListInputSchema,
                   output: Type.Object({ entries: Type.Array(LedgerEntrySchema, { maxItems: 200 }) }), replay: "safe" },
      show:      { description: "원장 항목 하나와 파일별 diff를 돌려준다.", input: Type.Object({ ledgerId: LedgerIdSchema }),
                   output: LedgerShowOutputSchema, replay: "safe" },
      rollback:  { description: "원장 항목 하나를 되돌린다. 되돌림도 원장에 남는다.", input: Type.Object({ ledgerId: LedgerIdSchema, reason: Type.Optional(Type.String({ maxLength: 500 })) }),
                   output: WriteOutcomeSchema,
                   errors: {
                     rollback_conflict: { description: "대상의 현재 해시가 그 항목의 afterHash와 다름(뒤에 다른 변경이 있음)", retryable: false },
                     rollback_unsafe: { description: "현재 내용의 안전 캡처에 실패해 되돌리지 않음", retryable: true },
                     approval_denied: { description: "사용자가 승인 요청을 거부함", retryable: false },
                   } },
      scan:      { description: "쓰기 없이 위협 패턴 검사만 한다.", input: Type.Object({
                     kind: Type.Union([Type.Literal("skill"), Type.Literal("memory")]),
                     text: Type.String({ maxLength: 1_048_576 }),
                   }), output: ScanSummarySchema, replay: "safe" },
      proposals: { description: "제안 대기열을 돌려준다.", input: Type.Object({
                     status: Type.Optional(ProposalSchema.properties.status),
                     limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
                   }), output: Type.Object({ proposals: Type.Array(ProposalSchema, { maxItems: 200 }) }), replay: "safe" },
      decide:    { description: "제안 하나를 승인하거나 거절한다. 승인하면 쓰기 경로로 적용한다.", input: Type.Object({
                     proposalId: ProposalIdSchema,
                     decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
                     note: Type.Optional(Type.String({ maxLength: 500 })),
                   }), output: Type.Object({ proposal: ProposalSchema, outcome: Type.Optional(WriteOutcomeSchema) }),
                   errors: {
                     proposal_closed: { description: "이미 처리된 제안", retryable: false },
                     base_stale: { description: "제안 뒤에 대상이 바뀜. 제안은 stale이 된다", retryable: false },
                   } },
    },
  },
  tools: [],
});
export const KnowledgeLedgerKey = serviceKey(KnowledgeLedger);
```

- `knowledge.ledger`는 모델 도구가 없다. 원장 열람, 되돌림, 대기열 결정은 사람(L4 화면·명령)과 그룹이 한다. 도구 없는 능력의 허용 여부는 `F.capabilities.spec` §10 [미결]을 따른다. 허용되지 않으면 읽기 전용 도구 `knowledge_ledger_list`를 더한다(§10 미결 8).
- `rollback`과 `decide`는 행위자가 `user`일 때 바로 적용한다. 행위자가 `extension`이면 `ApprovalEvidence`가 없을 때 승인 요청을 낸다(§4.5).

### 3.6 도구 요약

| 도구 | 능력.메서드 | 읽기 전용 | 쓰기 승인 대상 | replay | 근거 |
|---|---|---|---|---|---|
| `skill_view` | `knowledge.skills.view` | 예 | 아니오 | safe | Hermes `skill_view`(`_research/refs/hermes.md` §3.10.1 (라)) |
| `skill_manage` | `knowledge.skills.manage` | 아니오 | 예 | unsafe | Hermes `skill_manage` |
| `memory_manage` | `knowledge.memory.manage` | 아니오 | 예 | unsafe | Hermes `memory` |
| `knowledge_search` | `knowledge.search.query` | 예 | 아니오 | safe | Hermes `session_search` 발견 형태 |
| `session_scroll` | `knowledge.search.scroll` | 예 | 아니오 | safe | 스크롤 형태 |
| `session_read` | `knowledge.search.read` | 예 | 아니오 | safe | 읽기 형태 |

- 구현(KN.3): 두 도구는 `risk: "write"`, `classes: ["shared_state_write"]`로 올린다. `memory_manage`는 `l2.knowledge.memory.enabled`가 꺼진 채 시작하면 올리지 않는다(도구 집합은 재시작 없이 바뀌지 않는다. 시작 뒤에 끄면 메서드가 `unavailable`을 돌려준다).
- 쓰기 도구 둘은 L1.tools의 일반 도구 승인 규칙에서 기본 `allow`로 두고, 승인 판단은 이 능력의 쓰기 게이트(§4.5)가 한다 [제안]. 같은 호출에 승인 창이 두 번 뜨지 않게 하고, 승인 창에 diff와 검사 결과를 보이기 위해서다. 이 기본값은 `L1.tools.spec`에 요청한다(§8).
- 서브에이전트와 백그라운드 포크에 쓰기 도구를 줄지는 L1.agents와 L3.learning이 정한다. 주어져도 이 능력의 게이트가 대기열로 보낸다(§4.5.1).

### 3.7 서비스 묶음

`L2.readme` §5.6 대응 규칙을 따른다.

```ts
/** knowledge 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 능력마다 cap:<id> 바인딩이다 */
export interface KnowledgeService {
  readonly skills: CapabilityApi<typeof KnowledgeSkills>;
  readonly memory: CapabilityApi<typeof KnowledgeMemory>;
  readonly search: CapabilityApi<typeof KnowledgeSearch>;
  readonly ledger: CapabilityApi<typeof KnowledgeLedger>;
}
/** 묶음 이름. eng.context-map.design §5.3 표의 이름이고 Cordis 등록 이름이 아니다 */
export const KnowledgeServiceName = "xeon.knowledge";
```

- `eng.context-map.design` CM-06 예시의 `knowledge.search({ query, kinds, limit })`는 이 묶음에서 `knowledge.search.query({ query, kinds, limit })`다. 그룹 코드는 `g.capability(KnowledgeSearchKey).query(...)`로 쓴다.

### 3.8 저장 테이블

`eng.context-map.design` §5.2 `cap_knowledge_`. 세션 밖 상태(스킬 색인, 파일 상태, 원장, 대기열)와 세션 투영·색인(세션 목록, 세션 FTS)으로 나뉜다.

```sql
-- 세션 밖 상태: xeon.store.scoped("cap.knowledge")(소유자 id, 접두 cap_knowledge_)로 쓴다. 재생 대상이 아니다.
-- 마이그레이션은 작업마다 단계를 더한다: 1단계(KN.1)는 files, skills, ledger, 2단계(KN.2)는 proposals, FTS 테이블은 KN.4가 더한다.
CREATE TABLE cap_knowledge_files (
  path        TEXT PRIMARY KEY,         -- 정본 경로. 스킬은 스킬 디렉터리, 메모리는 저장소 파일의 절대 경로
  kind        TEXT NOT NULL CHECK (kind IN ('skill','memory')),
  target      TEXT NOT NULL,            -- 스킬 이름 또는 메모리 저장소
  scope       TEXT NOT NULL,
  hash        TEXT NOT NULL,            -- 마지막으로 이 능력이 확인한 내용 해시
  size        INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE cap_knowledge_skills (
  scope          TEXT NOT NULL,
  name           TEXT NOT NULL,
  dir            TEXT NOT NULL,           -- layout이 dir이면 스킬 디렉터리, file이면 그 .md 파일의 절대 경로
  layout         TEXT NOT NULL CHECK (layout IN ('dir','file')),   -- file: 루트 바로 아래 단일 .md(읽기만)
  description    TEXT NOT NULL,
  model_invocable INTEGER NOT NULL,
  created_by     TEXT NOT NULL CHECK (created_by IN ('user','agent','unknown')),
  tree_hash      TEXT NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (scope, name)
) STRICT;

CREATE VIRTUAL TABLE cap_knowledge_docs_fts USING fts5(
  kind UNINDEXED, ref UNINDEXED, title, body, tokenize = 'trigram'
);                                        -- 스킬(이름+설명+본문)과 메모리 항목. 파일에서 다시 만들 수 있다

CREATE TABLE cap_knowledge_ledger (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id      TEXT NOT NULL UNIQUE,
  at             INTEGER NOT NULL,
  actor          TEXT NOT NULL,           -- KnowledgeActor JSON
  target_kind    TEXT NOT NULL,
  target_name    TEXT NOT NULL,
  target_scope   TEXT,
  target_path    TEXT NOT NULL,           -- 스킬 디렉터리 또는 메모리 파일의 절대 경로. 롤백이 이 경로로 되돌린다
  op             TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('prepared','applied','aborted')),
  before_hash    TEXT,
  after_hash     TEXT,
  before_manifest TEXT,                   -- BlobRef JSON: [{path, blob}] 목록 blob
  after_manifest  TEXT,
  request_id     TEXT UNIQUE,             -- CallOptions.requestId. 멱등 키. 중단(aborted)한 행은 NULL로 비워 같은 키로 다시 부를 수 있다
  approved_by    TEXT,
  evidence       TEXT,                    -- ApprovalEvidence JSON
  scan           TEXT NOT NULL,           -- ScanSummary JSON(규칙 이름만)
  reason         TEXT,
  proposal_id    TEXT,
  rollback_of    TEXT,
  rolled_back_by TEXT,
  index_changed  INTEGER NOT NULL DEFAULT 0,   -- 스킬 인덱스(이름, 설명, 모델 호출 여부, 있고 없음)를 바꾼 항목. 인덱스 버전의 근거
  outcome        TEXT                     -- WriteOutcome JSON(멱등 재응답용)
) STRICT;
CREATE INDEX cap_knowledge_ledger_target ON cap_knowledge_ledger(target_kind, target_name, seq);

CREATE TABLE cap_knowledge_proposals (
  proposal_id  TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  actor        TEXT NOT NULL,
  method       TEXT NOT NULL,             -- 'skills.create' 등
  input        TEXT NOT NULL,             -- 메서드 입력 BlobRef JSON(본문이 클 수 있다)
  target_kind  TEXT NOT NULL,
  target_name  TEXT NOT NULL,
  target_scope TEXT,                      -- 스킬이면 user 또는 project. KN.2가 더했다(목록의 target.scope)
  op           TEXT NOT NULL,
  base_hash    TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending','applied','rejected','stale','expired')),
  scan         TEXT NOT NULL,
  preview      TEXT NOT NULL,             -- 제안할 때 만든 통합 diff(20,000자). KN.2가 더했다
  decided_at   INTEGER,
  ledger_id    TEXT,
  request_id   TEXT UNIQUE
) STRICT;

-- 세션 투영·색인: 투영기 cap.knowledge가 DDL을 선언한다. 세션 삭제 때 session_id 행이 함께 지워진다.
CREATE TABLE cap_knowledge_sessions (
  session_id   TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('main','subagent','background','cron')),
  project      TEXT,                      -- 프로젝트 식별(작업 디렉터리 해시)
  title        TEXT,
  created_at   INTEGER NOT NULL,
  last_at      INTEGER NOT NULL,
  messages     INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE cap_knowledge_session_docs (
  doc_id       INTEGER PRIMARY KEY,       -- FTS rowid와 같다
  event_id     TEXT NOT NULL UNIQUE,      -- 멱등 키
  session_id   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  pos          INTEGER NOT NULL,          -- events.pos
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  recorded_at  INTEGER NOT NULL,
  chars        INTEGER NOT NULL
) STRICT;
CREATE INDEX cap_knowledge_session_docs_session ON cap_knowledge_session_docs(session_id, seq);

CREATE VIRTUAL TABLE cap_knowledge_session_fts USING fts5(
  session_id UNINDEXED, text, tokenize = 'trigram', detail = 'full'
);
```

- 구현(KN.4) 이름과 열 [결정]: 투영기 등록부는 `cap_knowledge_` 뒤 지역 이름에 밑줄을 허용하지 않는다(F.records.spec §3.4, `core-persistence` `ownsTable`). 그래서 위 DDL의 `cap_knowledge_session_docs`·`cap_knowledge_session_fts`·`cap_knowledge_docs_fts`는 `cap_knowledge_sessiondocs`·`cap_knowledge_sessionfts`·`cap_knowledge_docsfts`로 쓴다. 세션 id 열은 `session_id` 대신 `thread_id`로 쓴다. 세션 삭제 정리(`core-persistence`의 `deleteThreadRows`)가 투영 표 가운데 `thread_id` 열이 있는 표의 행을 지우기 때문이다. `sessiondocs`는 `event_seq`(이벤트 전역 seq)를 더 갖고 `pos` 열은 없다. `seq`는 세션 안 메시지 번호(1부터)다. 소비자 커서는 투영 표 `cap_knowledge_sessioncursor(consumer, event_seq)`다. 스킬·메모리 문서 표 `docsfts`는 `scope UNINDEXED` 열을 더 갖는다(같은 이름의 스킬이 범위마다 있을 수 있다). `sessions`를 뺀 나머지 네 표(`sessiondocs`, `sessionfts`, `sessioncursor`, `docsfts`)는 FTS5와 trigram을 쓸 수 있을 때만 선언한다. 쓸 수 없으면 `sessions`만 선언하고 투영 버전이 `1001`이다.
- 투영기 `cap.knowledge`(`eng.events.design` §5.1 규칙 5): `tables`는 `cap_knowledge_sessions`와 색인 표들이고 이벤트 kind는 `thread.started`, `thread.updated`, `agent.spawned`, `item.recorded`다(초안의 `session.created`·`session.retitled`·`message.recorded`는 실제 카탈로그에 없다). `apply`는 `cap_knowledge_sessions`만 갱신한다(커밋 안, 순수). 색인 표는 소비자 `cap.knowledge.fts`가 쓴다. 색인 표를 투영기 DDL에 선언하는 이유는 세션 삭제 정리(`eng.context-map.design` §5.2)와 재생성 때 함께 지우기 위해서다. 같은 컨텍스트의 범위 핸들(`scoped("cap.knowledge")`)이 투영 표에 쓰는 것을 저장소가 허용한다(KN.4가 확인했다).
- 소비자 `cap.knowledge.fts`: 커서는 `consumer_cursors` 대신 투영 표 `cap_knowledge_sessioncursor`(`consumer = 'fts'`)에 둔다 [결정: KN.4]. `consumer_cursors`는 session-core 소유 표라 범위 핸들이 쓸 수 없고, 투영 표에 두면 투영기 재생성이 색인과 커서를 함께 지워 색인이 처음부터 다시 쌓인다.
- FTS 테이블은 본문을 복사해 둔다. 외부 콘텐츠 테이블(`content=`)로 중복을 줄이는 안은 [미결]이다(`_research/notes/L2-3.md` §4 6번, §10 미결 9).
- 내구 이벤트: `knowledge.` 접두사는 예약만 하고 1차에는 type을 두지 않는다(`eng.context-map.design` §5.1). 모델 경로의 쓰기는 도구 3단 기록(`tool.intended`, `tool.settled`)이 남기고, 모든 경로의 쓰기는 원장이 남긴다.

### 3.9 L3 문서의 가정 이름과의 대응

`L3.learning.spec` §3.1과 `L3.helm.spec` §3.8은 능력 ID를 [가정]으로 적었다. 조정 규약(L2 공통 도메인 표)의 ID로 바꾸는 대응표다.

| L3 문서의 가정 이름 | 이 문서 | 비고 |
|---|---|---|
| `knowledge.skill.read`(view, Helm의 스킬 검색 `search({ query, limit })`) | `knowledge.skills.view`, `knowledge.search.query({ kinds: ["skill"] })` | Helm 스킬 검색은 검색 능력으로 간다 |
| `knowledge.memory.read` `read({})` | `knowledge.memory.read({})` | 같은 모양 |
| `knowledge.session.search` `search({ query, limit })` | `knowledge.search.query({ kinds: ["session"] })` | |
| `knowledge.change.apply` `KnowledgeChangeApi.apply` | `knowledge.skills.create`·`edit`·`patch`·`writeFile`·`remove`, `knowledge.memory.add`·`replace`·`remove`. `approval: ApprovalEvidence`, `CallOptions.requestId = idempotencyKey` | 결과 `{ ok, ledgerId, afterHash }`는 `WriteOutcome`, 실패 사유는 오류 코드(`scan_blocked`, `base_stale`, `approval_denied`, `invalid_input`)로 옮긴다 |
| `knowledge.change.scan` | `knowledge.ledger.scan` | |
| `knowledge.ledger.read` | `knowledge.ledger.list`, `show` | |
| `knowledge.ledger.rollback` | `knowledge.ledger.rollback` | 실패 사유 `hash_mismatch` → `rollback_conflict` |
| `KnowledgeChange.createdBy: "agent"` | 행위자가 `agent`나 `extension`이면 `created_by = 'agent'` | 큐레이터 대상 판정(`L3.learning.spec` §4.8.1)에 쓴다 |
| `KnowledgeChange.kind: "script"` | 1차 범위 밖 | 반복 작업 스크립트 제안은 2차(`L3.learning.spec` §4.8.3). 저장 위치는 [미결] |

## 4. 동작 규칙

### 4.1 정본

- [제안] 정본은 파일이다. 스킬은 스킬 디렉터리, 메모리는 저장소 파일 두 개다. DB(`cap_knowledge_`)는 색인, 파일 상태, 원장, 대기열, 세션 검색만 갖는다. 이 안을 "정본 파일 + DB 색인·원장·대기열"이라 부른다.
- 근거: `_research/item-catalog.md` L2 메모리 파일 행은 "파일은 git으로 추적해 사람이 diff로 검토하고 되돌린다"고 적었고, Agent Skills 규격은 디렉터리 형식이다. 반면 `eng.context-map.design` §4.1 표는 `cap_knowledge_*`의 소유 데이터에 "메모리"를 적었다. 두 문서가 어긋나므로 이 제안을 [미결]에도 올린다(§10 미결 1). 이 안을 받으면 context-map 표의 "메모리"는 "메모리 색인과 원장"으로 고친다.
- 파일과 DB가 어긋나는 경우(바깥 편집, 크래시)는 드리프트 검사(§4.3.5)와 재색인(`skills.reindex`, 시작 시 검사)으로 맞춘다.

경로 [제안]. 실제 디렉터리는 `L0.os.spec`의 데이터 디렉터리와 프로젝트 설정 디렉터리를 따른다 [가정: `xeon.os`가 두 경로를 준다].

| 대상 | 경로 |
|---|---|
| 사용자 스킬 | `<사용자 데이터>/skills/<이름>/SKILL.md` |
| 프로젝트 스킬 | `<프로젝트>/.xeon/skills/<이름>/SKILL.md` |
| 보관함 | 같은 루트의 `.archive/<이름>-<UTC 시각>/` |
| 사용자 정보 메모리 | `<사용자 데이터>/memory/USER.md` |
| 환경 사실 메모리 | `<사용자 데이터>/memory/MEMORY.md` |
| 드리프트 사본 | `<사용자 데이터>/memory/.bak/<파일>.<UTC 시각>` |

### 4.2 스킬

#### 4.2.1 탐색

pi `core/skills.ts`의 규칙을 그대로 쓴다(포크, `L2.knowledge.plan` §4).

- 디렉터리에 `SKILL.md`가 있으면 그 디렉터리를 스킬 루트로 보고 더 들어가지 않는다.
- 없으면 루트 바로 아래의 `.md`는 루트 수준에서만 스킬 후보로 보고, 하위 디렉터리로 내려가 `SKILL.md`를 찾는다.
- 점으로 시작하는 항목과 `node_modules`는 건너뛴다. 심볼릭 링크는 따라가고, 같은 실제 경로는 한 번만 싣는다.
- 루트 순서는 프로젝트 → 사용자 → 확장 제공 → 설정 경로(`l2.knowledge.skills.paths`)다 [제안]. 같은 이름이 두 루트에 있으면 앞 루트가 이기고 진단(`collision`)을 남긴다. pi는 사용자 → 프로젝트 순이지만, 프로젝트 규약이 사용자 일반 절차보다 구체적이라 앞에 둔다.
- `.gitignore` 계열 무시 규칙은 1차에 적용하지 않는다 [제안]. 포크 원본의 `ignore` 패키지 결합을 풀기 위해서다(§10 미결 10).
- 확장 제공 루트와 설정 경로 루트의 스킬은 읽기 전용(`extension`, `path` 범위)이다.
- 프로젝트 루트(`.xeon/skills`)는 프로젝트가 신뢰된 뒤에만 싣는다 [결정: M2 검토 4]. 저장소가 낸 스킬의 설명이 첫 turn 인덱스에 들어가고 `skill_view`가 본문을 돌려주므로, 신뢰하지 않은 저장소를 열기만 해도 모델 지시문을 쓸 수 있기 때문이다(`X.loading-trust.spec` §4.7.2 표가 `.xeon/skills`를 신뢰 필요 자원으로 든다). 신뢰 여부는 조립 루트가 `resolveProjectTrust`의 `trusted`로 넘기고(`projectTrust` 옵션), 없거나 거짓이거나 실패하면 싣지 않는다. 싣지 못한 `.xeon/skills`가 있으면 `skill_list`의 진단(`warning`)에 남긴다.
- 구현(KN.1, 포크 패치 KN-01~KN-09, `cap-knowledge/PATCHES.md`):
  - 파일 접근은 `KnowledgeFs` 비동기 포트로 한다. 같은 디렉터리의 항목은 이름 바이트 순으로 처리해 같은 스킬 집합이 같은 순서와 같은 인덱스 블록을 만든다.
  - 설정 경로(`l2.knowledge.skills.paths`)는 절대 경로만 받는다. 상대 경로는 경고 진단이다. 디렉터리나 `.md` 파일을 줄 수 있다.
  - 심볼릭 링크가 조상 디렉터리를 가리키는 순환은 경고 진단과 함께 건너뛴다. 재귀 깊이 상한은 16이다.
  - 루트 바로 아래의 단일 `.md` 파일 스킬(`layout: "file"`)은 읽기만 한다. 쓰기 연산은 디렉터리 스킬(`layout: "dir"`)만 대상으로 한다.
  - 프로젝트 폴더는 대화의 작업 폴더(`thread.workspace`)다 [결정: m2c G2-02, `L2.readme` §5.10]. 조립 루트가 `KnowledgePluginOptions.workspaceOf`(`(threadId) => string | undefined`, `L4.host-service.spec` HS-66의 `threadWorkspaceOf`와 같은 값)를 넘기면 프로젝트 스킬 루트와 신뢰 판정(`projectTrust`)이 그 대화의 작업 폴더를 따른다. 작업 폴더가 없는 대화에는 프로젝트 스킬이 없고 엔진 cwd로 내려가지 않는다. `workspaceOf`가 없으면 옛 동작(`xeon.exec`의 cwd 하나)이다.
  - 프로젝트 스킬 색인은 한 번에 작업 폴더 하나만 담는다. 색인은 마지막으로 맞춘 작업 폴더를 기억하고(`SkillsRuntime.syncFor(threadId)`), 세션 시작·turn 시작·`list`·`view`·쓰기 연산이 부를 때 그 대화의 작업 폴더가 다르면 그 폴더로 다시 색인한다. 같으면 아무것도 하지 않는다.
  - 작업 폴더를 오갈 때 이전 작업 폴더의 프로젝트 행은 지워진 것이 아니라 색인에서 내려간 것이므로 원장에 `external` 삭제를 남기지 않는다. 파일 상태(경로, 내용 해시)는 남겨 두어서, 그 작업 폴더로 돌아왔을 때 내용이 그대로면 `external` 추가를 다시 적지 않고 색인 행만 되살린다. 그 사이 파일이 바뀌었으면 바뀐 내용으로 `external` 항목을 남긴다. 색인 버전은 이 오가기로 바뀌지 않는다.
  - 대화를 지정하지 않는 읽기(시작 때 재색인, 대기열에서 승인된 제안의 재실행)는 마지막으로 읽은 대화의 작업 폴더를 따른다. 엔진을 처음 열 때는 아직 읽은 대화가 없어 프로젝트 스킬이 없다.
  - 작업 폴더가 다른 대화가 번갈아 돌면 그때마다 색인을 다시 맞춘다. 작업 폴더별로 색인을 나누는 구성은 [미결]이다(§10 미결 17).

#### 4.2.2 형식과 구조 검증

| 항목 | 규칙 | 근거 |
|---|---|---|
| 이름 | 소문자·숫자·하이픈, 1~64자, 하이픈으로 시작·끝 금지, 연속 하이픈 금지. frontmatter `name`이 없으면 디렉터리 이름 | pi `validateName`(skills.ts:92-114), Agent Skills |
| 설명 | 필수, 1~1,024자 | pi `validateDescription`(skills.ts:117-127) |
| 본문 | 100,000자 이하 | Hermes `skill_manager_tool.py:108-113`(`_research/refs/hermes.md` §3.10.1 (라)) |
| 지원 파일 | 파일당 1 MiB 이하, 하위 디렉터리 `references`, `templates`, `scripts`, `assets`만, 깊이 5 | 같음 |
| 스킬당 파일 수 | 500개 이하 [제안] | |
| `disable-model-invocation` | 참이면 모델 인덱스에서 뺀다. 이름으로 부르는 명령 경로는 L2.dialog가 쓴다 | pi `formatSkillsForPrompt`(skills.ts:358) |

- 읽기(탐색)에서 규칙을 어긴 스킬은 pi처럼 경고 진단과 함께 로드한다. 설명이 없으면 싣지 않는다. 이름 규칙을 어긴 스킬은 색인에 싣지 않는다 [결정: KN.1]. `SkillNameSchema`를 어기는 이름은 `skill_view`로 부를 수 없고 `SkillIndexEntry.name`에도 담을 수 없기 때문이다. 진단(`cannot be addressed`)은 `list`의 `diagnostics`에 남는다.
- 읽기에서 트리가 한도(파일 500개, 파일 하나 16 MiB, 전체 64 MiB)를 넘으면 그 스킬은 색인에 싣지 않고 경고 진단을 남긴다. 한도가 쓰기 한도(§위 표)보다 넓은 이유는 바깥에서 둔 큰 자원 파일을 받아들이되 메모리를 지키기 위해서다.
- 쓰기에서 규칙을 어기면 `limit_exceeded` 또는 `invalid_input`으로 거부한다. 쓰기는 항상 검증을 통과한 파일만 만든다.
- `create`가 만드는 `SKILL.md`의 frontmatter는 `name`과 `description` 두 키다. `edit`·`patch`는 다른 frontmatter 키를 보존한다.
- 구현(KN.3, `skills/write-model.ts`, `skills/write.ts`):
  - `description`은 YAML 큰따옴표 스칼라(JSON 문자열)로 쓴다. 줄바꿈, 따옴표, 콜론, `#`이 든 설명도 그대로 다시 읽힌다. 쓴 뒤 `SKILL.md`를 다시 읽어 설명이 같은지 확인하고 다르면 `internal`로 실패한다.
  - `edit`이 설명을 바꿀 때는 frontmatter 원문에서 최상위 `description` 키의 줄들만 바꾸고 다른 키와 주석은 글자 그대로 둔다. 설명 없이 본문만 바꾸면 frontmatter 원문을 건드리지 않는다. 읽을 수 없는 frontmatter나 frontmatter가 없는 `SKILL.md`는 `invalid_input`이다.
  - `patch`는 `SKILL.md`의 본문(frontmatter 뒤)에만 적용하고 `file`을 주면 그 지원 파일 전체에 적용한다. 치환은 차례로 적용하며 각 `oldText`는 그 시점의 텍스트에서 정확히 한 번 나와야 한다(`patch_mismatch`, `detail: { edit, matches }`). 본문은 앞뒤 공백을 지워 읽으므로 쓸 때도 끝에 줄바꿈 하나로 맞춘다.
  - 바뀌는 내용이 없는 `edit`과 같은 내용의 `writeFile`은 `invalid_input`이다. 원장에 빈 변경을 남기지 않는다.
  - `writeFile`의 `baseHash`는 스킬의 트리 해시다(파일 하나의 해시가 아니다). 새 파일이면 생략할 수 있고 기존 파일을 덮어쓰면 필수다.
  - `remove`에 `file`을 주면 그 지원 파일만 지운다(원장 연산 `skill.write_file`). `mode: "delete"`는 행위자가 `user`일 때만이다.
  - 쓰기 대상 범위는 `scope`가 있으면 그 범위, 없으면 모델이 보는 이름 해석(프로젝트 → 사용자 → 확장 → 경로)의 승자다. 승자가 확장·경로 범위이거나 단일 파일 스킬이면 `read_only_scope`다. 프로젝트 범위 쓰기는 사용자나 유효한 증거를 가진 확장만 한다. 그 밖(에이전트, 증거 없는 확장)은 `denied`다. 승인된 제안을 다시 실행하는 경우는 사람이 이미 봤으므로 이 검사를 건너뛴다.
  - 위협 검사(§4.6)는 바뀌거나 새로 쓰이는 파일의 전체 텍스트에 건다. 바뀐 조각만 검사하면 `Do not ignore…`에서 `Do not `을 지워 위험한 구절을 완성하는 치환을 놓친다. `scripts/` 아래 파일은 엄격 범위다. 설정 `l2.knowledge.write.scan`이 꺼져 있으면 검사하지 않는다(요약은 비어 있다).

#### 4.2.3 트리 해시

- 스킬 디렉터리 안 모든 파일의 (상대 경로, 내용 sha256)을 경로 바이트 순으로 정렬해 `경로\0해시\n`을 이은 문자열의 sha256이다. 보관함(`.archive`)과 점으로 시작하는 항목은 넣지 않는다. 일반 파일이 아닌 항목(심볼릭 링크 포함)도 넣지 않는다 [결정: KN.1]. 링크가 스킬 밖의 파일을 가리켜 해시와 캡처로 새어 나오는 길을 막는다. 단일 파일 스킬의 트리는 그 파일 하나(경로는 파일 이름)다.
- 안전 캡처와 롤백도 같은 파일 집합을 쓴다. 그래서 점 항목과 링크는 롤백이 건드리지 않는다.
- `view`, `list`가 돌려주는 `treeHash`를 쓰기의 `baseHash`로 쓴다. 다르면 `base_stale`이다. Hermes의 "패치 전 같은 검토 안에서 다시 읽기" 가드를 해시 비교로 옮긴 것이다(`_research/refs/hermes.md` §3.10.1 (다), `L3.learning.spec` §3.5).

#### 4.2.4 지연 로딩

- `list`와 인덱스는 이름·설명·범위·해시만 담는다. 본문은 `view`를 부를 때 파일에서 읽는다.
- `list`는 색인(DB)만 읽는다. 스킬 루트를 다시 훑는 일은 시작 시 재색인, `skills.reindex`, `view`의 해시 불일치 처리가 맡는다. 엔진이 도는 동안 바깥에서 새로 둔 스킬은 이 셋 중 하나나 새 세션의 `session_start`(§7)가 재색인할 때까지 `list`에 나타나지 않는다.
- `view`는 매번 파일을 읽고 트리 해시를 다시 계산한다. 색인의 해시와 다르면 바깥 편집으로 보고 §4.3.5의 스킬 쪽 처리(원장 `external` 기록, 색인 갱신)를 한 뒤 결과를 돌려준다.
- 지원 파일의 상대 경로는 스킬 디렉터리 기준이다. `view({ name, file })`로 읽는다. 모델 렌더링은 "상대 경로는 skill_view의 file로 읽는다"는 안내를 본문 앞에 붙인다(pi `formatSkillsForPrompt`의 상대 경로 안내를 우리 도구로 바꾼 것).

#### 4.2.5 인덱스 주입

- 세션의 첫 turn에서 인덱스 블록을 만든다. 형식은 pi의 `<available_skills>` XML에서 `<location>`을 빼고 `skill_view` 안내를 넣은 것이다.

```text
아래 스킬은 특정 작업의 절차를 담고 있다. 작업이 설명과 맞으면 skill_view로 본문을 읽는다.
<available_skills>
  <skill><name>release-checklist</name><description>배포 전 확인 절차 …</description></skill>
  …
</available_skills>
외 12개 스킬은 knowledge_search(kinds: ["skill"])로 찾는다.
```

- 예산: `l2.knowledge.skills.indexBudgetChars`(기본 8,000자 [가정]). 항목 설명은 `l2.knowledge.skills.indexDescriptionChars`(기본 160자 [가정])에서 자르고 끝에 `…`을 붙인다. Hermes는 60자, Claude Code는 1,536자 상한이다(`_research/refs/hermes.md` §3.10.1 (라)·(바), `_research/item-catalog.md` L2 스킬 행). 기본값은 측정 뒤 정한다.
- 예산을 넘으면 범위 순(프로젝트 → 사용자 → 확장 → 경로), 같은 범위 안에서는 이름 바이트 순으로 넣을 수 있는 만큼만 넣고 남은 개수를 적는다. 순서가 결정적이어야 같은 스킬 집합이 같은 블록을 만든다(프롬프트 캐시).
- 블록 생성은 `skills/prompt-block.ts`의 순수 함수와 `SkillsRuntime.indexBlock(threadId)`로 구현했다(KN.1). 연결은 `turn-context.ts`가 한다(KN.5). `before_agent_start`에서 세션의 첫 turn이면 인덱스 블록과 메모리 스냅샷(§4.3.4)을 이어 붙여 `customType: "knowledge.context"`, `display: false`인 기록 메시지 하나로 더한다. 시스템 프롬프트는 건드리지 않는다. 더한 메시지가 세션 기록에 남는다는 것은 [가정]이다.
- 첫 turn은 세션별 상태가 없는 turn이다. `session_start`의 `reason`이 `startup`·`new`면 상태를 비워 첫 turn으로 만들고, `resume`·`fork`·`reload`면 현재 인덱스를 기준으로 상태를 만든다. 이어받은 세션의 기록에 블록이 이미 있다고 보기 때문이다. 컴팩션이 일어나면 이 가정이 깨지므로 §4.2.8이 다시 넣는다.
- 블록과 인덱스 스냅샷은 같은 시점의 색인에서 만든다. 스킬을 끄면(`l2.knowledge.skills.enabled`) 블록은 비고, 메모리를 끄면 스냅샷이 빈다. 둘 다 비면 메시지를 더하지 않는다.
- 이 블록을 어디에 두는지(시스템 프롬프트 영역, 첫 turn 메시지)는 `L1.context.spec`이 정한다. [제안] 메모리 스냅샷(§4.3.4)과 같은 첫 turn 기록 메시지로 넣는다. 기록 메시지면 재개 때 같은 내용이 다시 쓰여 결정적이다.

#### 4.2.6 인덱스 변경 알림

- 세션 중 인덱스가 바뀌면(이름·설명 추가, 변경, 삭제) 다음 turn 시작 때 델타 메모 하나를 넣는다. 첫 블록은 다시 만들지 않는다. 프롬프트 캐시 접두를 지키기 위해서다(Hermes `agent/skills_index_delta.py:1-14`, `_research/refs/hermes.md` §3.10.1 (라)).

```text
스킬 인덱스 변경: 추가 deploy-rollback(롤백 절차 …), 변경 release-checklist, 삭제 old-notes
```

- 세션마다 마지막으로 알린 인덱스 스냅샷(`indexVersion`과 모델에게 보이는 스킬의 이름 → 잘린 설명)을 메모리에 둔다. 인덱스 버전은 원장 `seq` 중 인덱스를 바꾼 항목(`index_changed = 1`인 `applied` 행)의 최댓값이다. 이름·설명·모델 호출 여부가 바뀌거나 스킬이 생기고 사라진 변경만 센다. 프로세스 재시작 뒤에는 현재 버전으로 시작한다 [가정: 재시작 사이의 변경 알림 한 번을 놓칠 수 있다]. 컴팩션 뒤에는 첫 블록을 다시 넣는다(§4.2.8).
- 본문만 바뀐 변경은 알리지 않는다. 모델은 다음 `view`에서 새 본문을 읽는다.
- 구현은 `before_agent_start`에서 현재 `indexVersion`을 상태의 버전과 비교한다. 같으면 아무것도 하지 않는다. 다르면 이름과 잘린 설명을 비교해(`skills/delta.ts`의 `diffIndex`) 추가·변경·삭제를 정하고, 상태를 현재로 올린 뒤 비어 있지 않을 때만 메모를 더한다. 모델 호출 여부가 바뀌어 목록에 나타나거나 사라지는 스킬은 추가·삭제로 센다. 같은 이름의 범위가 바뀌어도 설명이 같으면 알리지 않는다.
- 메모는 `customType: "knowledge.index-delta"`, `display: false` 메시지 하나다. 목록은 이름 바이트 순이고 한 줄에 10개까지, 넘으면 `외 N개`로 줄인다. 추가한 스킬 옆 설명은 60자(코드 포인트)에서 `…`로 자른다. 예산을 넘어 첫 블록에 싣지 못한 스킬도 인덱스에 있으면 추가로 알린다.
- 상태는 `session_shutdown`에서 지운다. 지운 세션의 다음 turn은 첫 turn으로 본다. 종료 후크 없이 사라진 세션의 항목은 프로세스가 끝날 때까지 남는다(항목 하나는 스킬 수만큼의 문자열이다).

#### 4.2.7 `resources_discover` 지점과의 관계

- `F.extensions.spec` §3.4 #28 `resources_discover`(session, chain)는 확장이 스킬·프롬프트 같은 리소스 경로를 더하는 지점이다. pi에서 확장이 스킬 경로를 더하는 경로다.
- 이 능력은 그 지점을 정의하지 않고 결과만 쓴다. 지점의 합성 결과(확장 이름과 함께 추가된 스킬 경로)를 확장 제공 루트로 받아 읽기 전용 스킬로 싣는다 [가정: X가 합성 결과를 세션 시작 때 `cap-knowledge`에 넘기는 API를 `X.loading-trust.spec`이 정한다].
- 확장 제공 스킬의 쓰기는 `read_only_scope`로 거부한다. 확장을 지우면 그 루트가 빠지고 다음 재색인 때 색인에서 빠진다.

#### 4.2.8 컴팩션 뒤 재주입

- 컴팩션(`L1.context.spec` §4.6)은 앞쪽 기록을 요약으로 바꾸므로, 첫 turn에 넣은 `knowledge.context` 메시지(스킬 인덱스 블록과 메모리 스냅샷)가 모델 입력에서 사라진다. 이 패키지가 `session_compact`(#35, tap, `L1.context.spec` 발화 지점)를 받아 그 대화의 세션별 상태를 비운다. 상태가 없으므로 다음 turn의 `before_agent_start`가 첫 turn처럼 동작해 그때의 인덱스와 메모리로 블록 하나를 다시 넣는다. 델타 메모가 아니라 전체다 [결정: m2c G2-01, C-11].
- 다시 넣는 시점은 컴팩션 직후의 다음 turn 시작이다. 컴팩션이 turn 안에서 일어나 같은 turn의 단계를 재시도하는 경우(`willRetry`)에도 그 turn 안에서는 들어가지 않고 다음 turn 시작에 들어간다. `before_agent_start`가 turn마다 한 번 발화하기 때문이다.
- 다른 대화의 상태는 건드리지 않는다. 한 번 다시 넣은 뒤에는 §4.2.6대로 바뀐 것이 있을 때만 델타를 더한다.
- 컴팩션이 보존 구간에 첫 블록을 남겼는지는 알 수 없어서, 그 경우 블록이 한 번 더 들어가 중복된다 [가정]. 내용이 같아 해가 없고 다음 컴팩션이 정리한다.
- 최근 읽은 파일과 호출된 스킬 본문의 재주입은 `L1.context.spec` §4.10 2차 항목(C-11)이고 이 패키지의 일이 아니다. 컴팩션 호출 배선(`/compact`, 자동 컴팩션)은 L1 쪽이다. 이 핸들러는 `session_compact`만 본다.

### 4.3 메모리

#### 4.3.1 형식

- 저장소 파일은 UTF-8 텍스트다. 항목 사이는 `§` 한 글자만 있는 줄로 나눈다. 직렬화는 `항목1\n§\n항목2\n`이다(Hermes `memory_tool_store.py:25`, `_research/refs/hermes.md` §3.10.1 (라)).
- 항목 텍스트는 앞뒤 공백을 지우고 NFC로 정규화한다. 항목 ID는 그 텍스트 sha256의 앞 12자다. 같은 텍스트의 항목을 두 번 넣으면 `duplicate_entry`다.
- 항목 안에 `§` 한 글자 줄이 있으면 쓰기를 거부한다(`invalid_input`).
- 구현(KN.3, `memory/format.ts`, `memory/store.ts`):
  - 구분 줄은 앞뒤 공백을 지운 뒤 정확히 `§`인 줄이다. 줄을 `§`로 시작하는 항목은 거부한다(`§ 제목`처럼 구분 줄과 헷갈리는 줄은 파일을 깨뜨린다) [제안]. 읽을 때 `§`로 시작하지만 `§` 한 글자가 아닌 줄(`§text`, `§§`)은 구조가 깨진 것으로 본다(§4.3.5).
  - 항목은 20,000자 이하이고 NUL을 담지 못한다. 빈 항목(구분 줄이 연달아 있는 곳)은 읽을 때 건너뛴다. 쓸 때는 항목마다 NFC로 바꾸고 `\n§\n`으로 이어 끝에 줄바꿈 하나를 둔다.
  - `fileHash`는 파일 바이트의 sha256이고 파일이 없으면 빈 내용의 sha256이다. `add`는 `baseHash`가 없으며, 읽은 해시를 실행기에 넘겨 락 안 재확인이 끼어든 쓰기를 잡는다. 호출자가 `baseHash`를 주지 않는 쓰기(`add`, `add`만 있는 `batch`)는 그 재확인이 `base_stale`을 내면 다시 읽고 계산해 최대 5번 다시 시도한다. 그래서 동시에 더한 항목이 모두 반영된다.
  - `memory_full`은 쓴 뒤 크기가 한도를 넘고 지금보다 커질 때만 낸다 [제안]. 한도를 낮춘 뒤에도 항목을 줄이는 쓰기는 막지 않는다. `detail.entries[].preview`는 항목 앞 80자(공백 연속은 하나로)다.
  - `batch`는 항목 ID를 시작 시점의 값으로 가리킨다. 연산은 차례로 적용하고 마지막 상태만 한도를 검사한다. 하나라도 틀리면 아무것도 쓰지 않는다. `replace`·`remove`가 있으면 `baseHash`가 필수다. 원장 연산은 `memory.batch`, 파괴적 여부는 `replace`·`remove` 포함 여부다. `manage`의 `add`·`replace`·`remove`는 같은 이름의 메서드와 같은 경로(원장 연산 `memory.add` 등)다.
  - 위협 검사는 새로 쓰거나 바꾼 항목 텍스트에 건다(스킬과 달리 파일 전체가 아니다. 이미 기록된 항목을 나중에 늘어난 규칙이 막으면 모든 쓰기가 막히기 때문이다). 설정 `write.scan`과 상관없이 항상 한다.
  - 스냅샷 블록(`snapshotBlock`)은 항목 안의 `</memory`를 `&lt;/memory`로 바꾼다. 구조가 깨진 저장소는 `writeBlocked="true"` 속성과 읽을 수 있는 항목만 싣는다.

#### 4.3.2 한도

- 한도는 저장소 파일 전체(구분 줄 포함)의 코드 포인트 수다. 기본 `user` 1,375자, `env` 2,200자다. Hermes의 값을 참고값으로 쓴다(`_research/refs/hermes.md` §3.10.1 (라)) [가정: 한국어 사용 기준의 적정값은 측정하지 않았다].
- 쓰기 뒤 크기가 한도를 넘으면 쓰지 않고 `memory_full`로 거부한다. `detail`에 `{ limit, used, wouldBe, entries: [{ id, chars, preview }] }`를 담는다. `preview`는 항목 앞 80자다. 모델은 `batch`로 지우기와 더하기를 한 번에 해야 한다(Hermes `memory_tool.py:373-400`). 항목을 자동으로 줄이거나 조용히 지우지 않는다.

#### 4.3.3 락과 원자 쓰기

- 쓰기는 저장소별 락 안에서 한다. 프로세스 사이 배타 [결정: KN.1]: `xeon.os`(`OsService`)는 파일 락 API를 제공하지 않는다(Hermes는 fcntl·msvcrt를 직접 쓰지만 Xeon은 OS 분기를 L0에 둔다, `eng.dependency-rules.guide` DR-13). 그래서 `KnowledgeFs.withLock`은 같은 프로세스 안의 키별 직렬화만 한다. 프로세스 사이는 두 장치가 맡는다: 한 데이터 디렉터리에 엔진 하나만 쓰는 임대(ADR-0006)와 락 안에서 하는 해시 재확인(§4.4.1 9단계). 바깥 편집기나 다른 도구가 그 사이에 쓰면 `base_stale`로 거부하고 원장 행을 `aborted`로 한다. L0.os에 파일 락 API가 생기면 `node-fs.ts`가 그것을 부른다(§10 미결 18).
- 같은 프로세스 안에서는 저장소별 메모리 뮤텍스로 먼저 직렬화한다.
- 파일 쓰기는 같은 디렉터리의 임시 파일에 쓰고 fsync한 뒤 rename한다.
- 스킬도 스킬 디렉터리별로 같은 방식의 락을 쓴다(Hermes 스킬별 락, `skill_manager_tool.py:84-106`).

#### 4.3.4 세션 시작 스냅샷

- 세션의 첫 turn에서 두 저장소를 읽어 스냅샷 블록을 만든다. 세션 중의 메모리 쓰기는 그 세션의 스냅샷에 나타나지 않는다(Hermes `memory_tool_store.py:177, 221-253`, `_research/refs/hermes.md` §3.10.1 (라) "메모리는 스냅샷이다"). 프롬프트 캐시를 지키기 위해서다.
- 블록에는 항목마다 ID를, 저장소마다 `fileHash`와 한도를 싣는다. 모델이 `memory_manage`의 `entryId`와 `baseHash`를 이 블록에서 얻는다.

```text
<memory store="user" fileHash="9f2c…" used="812" limit="1375">
[a1b2c3d4e5f6] 답변은 한국어 한다체로 쓴다.
[0f9e8d7c6b5a] 커밋은 사람이 확인한 뒤에만 한다.
</memory>
<memory store="env" fileHash="…" used="1290" limit="2200">
…
</memory>
```

- 블록을 넣는 위치는 §4.2.5와 같이 `L1.context.spec`이 정한다. 구현은 [제안]대로 인덱스 블록과 함께 첫 turn 기록 메시지 하나로 넣는다(§4.2.5). 같은 세션의 이후 turn에는 다시 넣지 않으므로 세션 중 메모리 쓰기는 이 세션의 스냅샷에 나타나지 않는다.
- `l2.knowledge.memory.enabled`가 거짓이면 스냅샷을 넣지 않고 `memory_manage` 도구도 광고하지 않는다.

#### 4.3.5 바깥 편집과 드리프트

쓰기와 읽기 때 파일 해시를 `cap_knowledge_files.hash`와 비교한다.

| 상태 | 판정 | 처리 |
|---|---|---|
| 해시 같음 | 정상 | 계속 |
| 해시 다름, 구조 정상 | 바깥 편집 | 원장에 `op: "external"`, 행위자 `external`, `after_manifest`에 현재 내용을 남기고 색인을 갱신한다. 쓰기 요청의 `baseHash`가 옛 해시면 `base_stale` |
| 구조 깨짐 | 드리프트 | 현재 파일을 `.bak/<파일>.<UTC 시각>`으로 복사하고 쓰기를 거부한다(`drift_detected`). 읽기는 가능한 만큼 항목을 돌려주고 `writeBlocked: true` |

- 구조가 깨진 경우: UTF-8이 아님, NUL 문자 포함, 구분 줄 앞뒤에 다른 글자가 붙은 `§` 줄, 크기가 한도의 2배 초과(Hermes `memory_tool_store.py:49-57, 695`).
- 드리프트 상태는 사람이 파일을 고치거나 L4 명령으로 "현재 파일을 받아들이기"를 해야 풀린다. 받아들이기는 행위자 `user`의 `external` 원장 기록이다.
- 구현(KN.3): 읽기와 쓰기 앞에서 파일을 읽어 `cap_knowledge_files.hash`와 비교한다. 같으면 정상이다. 다르고 구조가 정상이면 `external` 항목을 남기고 파일 상태를 새 해시로 맞춘다. 처음 보는 파일(상태 행이 없음)과 지워진 파일(상태 행이 있고 파일이 없음)도 같은 길이다. 구조가 깨졌으면 `.bak/<파일>.<UTC 시각>`으로 복사하고 쓰기를 `drift_detected`로 거부하며 읽기는 가능한 만큼 항목을 돌려준다. 사본은 같은 내용마다 프로세스당 한 번만 만든다(재시작하면 한 번 더 만든다). "현재 파일 받아들이기" 메서드는 아직 없다(L4 명령 몫).
- 스킬의 바깥 편집도 같은 표를 쓴다. 스킬의 "구조 깨짐"은 §4.2.2 읽기 검증에서 설명이 없어 실리지 않는 경우다. 이때는 `.bak`을 만들지 않고 진단만 남긴다(디렉터리는 사람이 고친다).

### 4.4 쓰기 경로

#### 4.4.1 순서

모든 쓰기 메서드(스킬 다섯, 메모리 넷, `rollback`, `decide`의 적용)는 같은 순서를 지킨다.

1. 입력 검증과 행위자 판정(§3.1). 호출자 종류에 맞지 않는 `approval`·`overrideScan`은 `invalid_input`.
2. 멱등 확인: `CallOptions.requestId`가 있고 원장(`request_id`)이나 대기열에 같은 키가 있으면 저장된 첫 결과를 그대로 돌려준다(§4.4.5).
3. 대상 읽기와 드리프트 검사(§4.3.5), `baseHash` 비교(`base_stale`).
4. 새 내용 계산(순수): 패치 적용(`patch_mismatch`), 구조 검증(§4.2.2), 메모리 한도(§4.3.2).
5. 위협 패턴 검사(§4.6). `block`이면 `scan_blocked`(행위자 `user` + `overrideScan`이면 경고로 낮춤).
6. 쓰기 승인 게이트(§4.5): 바로 적용, 승인 요청, 대기열 중 하나. 대기열이면 제안을 저장하고 `status: "queued"`로 끝난다. 승인 거부면 `approval_denied`.
7. 안전 캡처: 현재 내용(스킬 디렉터리 전체 또는 메모리 파일)을 `xeon.store.putBlob`으로 저장하고 `before_manifest`를 만든다. 실패하면 쓰지 않고 `internal`로 실패한다(닫힌 실패).
8. 원장 `prepared` 행 기록(`StoreDb.write` 하나).
9. 락 안에서 파일 쓰기(§4.3.3). 락을 잡은 뒤 3단계의 해시를 다시 확인한다. 다르면 원장 행을 `aborted`로 바꾸고 `base_stale`.
10. 새 내용을 blob으로 저장해 `after_manifest`를 만든다. 원장 행을 `applied`로 바꾸고, 같은 트랜잭션에서 `cap_knowledge_files`, `cap_knowledge_skills`, `cap_knowledge_docsfts`를 갱신한다.
11. 인덱스가 바뀌었으면 인덱스 버전을 올린다(§4.2.6).

- 트랜잭션 안에서는 파일 I/O와 승인 대기를 하지 않는다(`eng.transactions.design` TX-01, TX-04). 8단계와 10단계는 각각 짧은 쓰기 트랜잭션이다.
- 8단계의 의도 기록이 파일 쓰기보다 앞이다. 효과보다 의도를 먼저 남기는 규칙(TX-02)을 이 능력의 원장에 적용한 것이다.

#### 4.4.2 파괴적 연산

| 연산 | 파괴적 |
|---|---|
| `skills.create` | 아니오 |
| `skills.writeFile`(새 파일) | 아니오 |
| `skills.writeFile`(기존 파일 덮어쓰기), `edit`, `patch`, `remove` | 예 |
| `memory.add` | 아니오 |
| `memory.replace`, `memory.remove`, `batch`(replace·remove 포함) | 예 |
| `ledger.rollback` | 예 |

- `remove`의 기본은 보관함 이동(`archive`)이다. 영구 삭제(`delete`)는 행위자 `user`만 할 수 있다. Hermes 전경 `skill_manage(delete)`의 영구 삭제(`_research/refs/hermes.md` §3.10.1 (마))를 피하는 선택이다.

#### 4.4.3 시작 시 복구

- 시작할 때 `status = 'prepared'`인 원장 행을 찾는다. 대상의 현재 해시가 `after_hash`와 같으면 `applied`로 마감하고(색인과 파일 상태도 같은 트랜잭션에서 맞춘다), 그 밖에는 `aborted`로 바꾼다. `before_hash`와 같으면 쓰기 전에 죽은 것이고, 둘 다 아니면 바깥 편집이라 이어지는 재색인이 `external` 항목으로 남긴다(§4.3.5). 행의 행위자는 원래 값을 유지한다. 복구는 새 행을 만들지 않는다.
- 그 뒤 스킬 루트를 재색인한다(`skills.reindex`와 같은 동작). 재색인은 사용자·프로젝트 범위의 추가, 변경, 삭제를 행위자 `external`, 연산 `external`의 `applied` 항목으로 원장에 남긴다. 처음 본 스킬도 마찬가지다(`created_by`는 처음 만든 `skill.create` 항목이 있으면 그 행위자, 없으면 `unknown`). 변경 항목의 `before_manifest`는 그 해시를 `after_hash`로 가진 이전 항목의 목록 blob이다. 없으면 비어 있어 그 항목은 롤백할 수 없다. 확장·경로 범위는 읽기 전용이라 원장에 남기지 않는다.
- 구현(KN.1)은 재색인마다 모든 스킬의 트리를 읽고 해시한다. mtime·크기로 후보를 줄이는 최적화는 하지 않았다(§10 미결 19).

#### 4.4.4 행위자 표시

- 행위자가 `agent`이거나 `extension`인 `create`는 `created_by = 'agent'`, `user`이면 `'user'`, 재색인으로 처음 본 스킬은 `'unknown'`이다. 이 표시는 관리용 표시다. 출처를 증명하지 않는다. 큐레이터 대상 판정에 쓴다(`_research/refs/hermes.md` §3.10.1 (마), `L3.learning.spec` §4.8.1).
- 사용자가 L4에서 `created_by`를 바꾸는 기능(Hermes `curator adopt`)은 2차다.

#### 4.4.5 멱등

- 쓰기 메서드의 `CallOptions.requestId`는 원장과 대기열의 `request_id`에 저장된다. 같은 키의 두 번째 호출은 저장된 `outcome`을 그대로 돌려준다. 입력이 달라도 첫 결과를 돌려준다. L3 그룹이 승인 증거와 함께 쓰는 적용 키(예: `<그룹 이름>:apply:<proposalId>:<revision>`)가 이 경로를 쓴다.
- `requestId`가 없으면 멱등을 보장하지 않는다.

### 4.5 쓰기 승인과 제안 대기열

#### 4.5.1 게이트 표

[제안] 쓰기 승인과 스캔은 기본으로 켠다(`_research/layer-plan-v2.json` L2-d "기본은 켜 둡니다"). `_research/decisions-log.md`에 이 기본값의 사용자 결정 기록이 없어 [제안]으로 둔다. Hermes의 기본 OFF와 반대다(`_research/refs/hermes.md` §4.3 "우리는 이것을 반대로 해야 한다").

| 행위자 | 연산 | `l2.knowledge.write.approval = true`(기본) | `false` |
|---|---|---|---|
| `user` | 모두 | 바로 적용 | 바로 적용 |
| `extension` + 유효한 `ApprovalEvidence` | 모두 | 바로 적용, 증거를 원장에 기록 | 바로 적용 |
| `extension`, 증거 없음, 세션 안 | 모두 | 승인 요청 | 비파괴는 적용, 파괴는 승인 요청 |
| `extension`, 증거 없음, 세션 없음 | 모두 | 대기열 | 비파괴는 적용, 파괴는 대기열 |
| `agent`(main) | 모두 | 승인 요청 | 비파괴는 적용, 파괴는 승인 요청 |
| `agent`(subagent) | 모두 | 대기열 | 비파괴는 적용, 파괴는 대기열 |
| `agent`(background) | 비파괴 | 대기열 | 적용 |
| `agent`(background) | 파괴 | 대기열(설정 무관) | 대기열(설정 무관) |

- 백그라운드 포크의 파괴적 연산은 설정과 무관하게 대기열로 간다. Hermes가 포크의 메모리 파괴적 연산을 승인 큐로 보내는 장치를 스킬까지 넓힌 것이다(`_research/refs/hermes.md` §3.10.1 (라)).
- `agent`(main)이고 `caller.afterUntrusted = true`이면 설정이 꺼져 있어도 승인을 요청한다 [제안]. 웹 결과를 읽은 turn의 쓰기는 인젝션 경로일 수 있기 때문이다(§4.6.3).
- 승인 요청은 `xeon.approvals`(`ApprovalService`)의 도구 승인(kind `tool`)으로 낸다 [결정: KN.2]. `ports/approvals.ts`의 `createWriteApprovals`가 `open`으로 요청을 커밋하고(같은 `requestKey`면 기존 요청과 현재 해결 상태를 돌려받는다) 해결이 없으면 `wait`로 기다린다. 요청 키는 호출의 `requestId`를 F `requestKeyFor`(`records/commit.ts`, U-13)로 바꾼 값이다(1~48자). 48자 이하이고 키 알파벳(`^[A-Za-z0-9_.-]+$`) 안이며 `h_`로 시작하지 않으면 그대로, 아니면 `h_` + 원문 sha256 앞 40자다 [결정: 통합 검토 L6, 이전 `kw_` 접두 함수를 지움]. `requestId`가 없으면 `knp` ID를 키로 써서 멱등을 보장하지 않는다. 본문은 `{ toolName, capability: { id, method }, risk: "write", args, argsHash, ruleId: null }`이고 `toolName`은 스킬 쓰기면 `skill_manage`, 메모리 쓰기면 `memory_manage`, 롤백이면 `knowledge.ledger`다. `args`는 `{ op, target, baseHash, preview, scan, afterUntrusted }`이고 `preview`는 현재 내용 기준 통합 diff를 20,000자에서 자른 것, `scan`은 규칙 이름과 판정(`<규칙>:<block|warn>`)만 담는다. 사람이 한 허용(`resolvedBy: "user"`의 `allow`)만 허용으로 센다. 취소, 대체, 비대화형 해결은 거부다. 거부의 `answer.feedback`은 오류 `approval_denied`의 `detail.feedback`으로 돌려준다.
- 묻지 못하는 경우 [제안: KN.2]: `ask` 판정이어도 승인 포트가 없거나, 호출 문맥에 `threadId`가 없거나, `interactive`가 `false`(크론·헤드리스)이면 묻지 않고 제안 대기열로 보낸다. 닫힌 쪽으로 실패하고 정본 파일은 바뀌지 않는다.
- 승인 대기는 루프의 승인 대기 상태로 커밋되고 멈춘다. 재개 때 결과 이벤트로 이어진다(`L2.readme` §5.7). 승인 결과 "항상"은 이 능력에 적용하지 않는다 [제안]. 스킬·메모리 쓰기는 매번 내용이 달라서다.
- `ApprovalEvidence`의 유효성: `source`가 `l2.knowledge.write.trustedEvidenceSources`(기본 `[]`)에 있고, `source`의 첫 마디가 호출 확장 이름(`CallOptions.context.caller.extension`)과 같을 때만 유효하다 [제안]. 기본값은 L3 그룹 이름을 쓰지 않는다. 증거를 낼 L3 그룹의 source는 L3가 설정으로 채운다 [결정: review.decisions-2 D-11]. 아무 확장이 증거를 꾸며 게이트를 건너뛰지 못하게 하기 위해서다.

#### 4.5.2 제안 대기열

- 대기열은 `cap_knowledge_proposals`다. 제안은 메서드 이름과 입력 전체(blob), 대상, 연산, `baseHash`, 검사 결과, 미리보기를 갖는다.
- `decide({ approve })`: 행위자 `user`일 때, 저장된 입력을 쓰기 경로 2단계부터 다시 실행한다. 원장 행에 `proposal_id`를 남긴다. 그 사이 대상이 바뀌었으면 제안은 `stale`이 되고 `base_stale` 오류다.
  - [결정: KN.2] 호스트(사용자)만 결정한다. `DecideInput`에 증거(`approval`)를 실을 자리가 없어 확장의 결정은 `denied`다. 확장이 결정하려면 F가 `DecideInput.approval`을 더해야 한다(§8 요구).
  - [결정: KN.2] 승인한 제안은 게이트를 다시 거치지 않는다(사람이 미리보기를 보고 승인했다). 원장 행의 행위자는 제안한 행위자이고(결정한 사용자는 원장에 남지 않는다), `approved_by`는 `approval`이며 `proposal_id`가 제안을 가리킨다. 스킬 `created_by`(§4.4.4)와 감사가 "누가 바꿨나"와 "누가 승인했나"를 구분하기 위해서다. 같은 결정을 두 번 실행해도 원장 `request_id`(`proposal:<제안 ID>`)가 막는다. `decide`의 `note`는 원장 `reason`이 된다.
  - [결정: KN.2] 다시 실행이 `base_stale`, `name_conflict`, `patch_mismatch`, `rollback_conflict`로 실패하면 제안은 `stale`이다. 다른 실패(`scan_blocked`, `internal` 등)는 제안을 `pending`으로 두고 오류만 돌려준다.
  - 같은 `requestId`로 같은 쓰기를 다시 부르면 대기열도 첫 결과(`status: "queued"`, 같은 `proposalId`)를 돌려준다. 제안이 적용된 뒤에도 첫 결과를 돌려준다.
  - 목록은 최신순이다. 목록과 결정 앞에서 만료를 정리하고, 시작 때도 정리한다.
- `decide({ reject })`: 상태를 `rejected`로 바꾸고 파일은 건드리지 않는다.
- 만료: 생성 뒤 `l2.knowledge.write.proposalExpiryDays`(기본 14일)가 지난 `pending`은 시작 정리 때 `expired`가 된다.
- 승인 전에는 파일이 바뀌지 않는다. `pending`, `rejected`, `stale`, `expired` 제안은 정본 파일에 아무 효과가 없다(수용 기준 1, `product.scope.spec` §4.4 M3 UC-3).
- 자기 대기열을 가진 L3 그룹(테이블 접두 `x_<그룹 이름>_`, U-18)은 사람의 결정을 받은 뒤 증거와 함께 쓰기 메서드를 부른다. 그래서 그 그룹의 제안은 이 대기열을 거치지 않는다. 두 대기열을 하나로 합칠지는 [미결]이다(`L3.learning.spec` §10 미결 9, §10 미결 3).

### 4.6 위협 패턴 검사와 인젝션 방어

#### 4.6.1 규칙

검사는 순수 함수 `scanText(kind, text): ScanSummary`(`scan/rules.ts`)다. 규칙 집합은 `rulesetVersion`으로 버전을 매긴다. 걸린 문자열은 결과에 담지 않고 규칙 이름과 줄 번호만 담는다.

| 범주 | 규칙 예 | 판정 |
|---|---|---|
| 지시 주입 | "이전 지시를 무시", "ignore (all )?previous instructions", "you are now", 역할 표지 위조(`<system>`, `</system>`, `<|im_start|>`), 우리 경계 표지(`<untrusted_web_content`, `</untrusted_web_content>`, `<untrusted_session_content`) | block |
| 유출 | 셸 명령으로 비밀 위치를 읽어 네트워크로 보내는 형태(`curl`·`wget`·`nc`와 `~/.ssh`, `~/.aws`, `.env`, `$…_TOKEN`의 조합), 데이터 URL로 보내기 | block |
| 비밀 값 | 키 형태(`sk-…`, `ghp_…`, `AKIA…`, `xox[bp]-…`, `-----BEGIN … PRIVATE KEY-----`, JWT 세 마디), `xeon.secrets` 마스킹 등록부의 값 | block |
| 숨은 문자 | 너비 없는 문자(U+200B~U+200F, U+2060, U+FEFF), 양방향 제어(U+202A~U+202E, U+2066~U+2069) | block |
| 숨은 지시 | HTML 주석 안의 지시형 문장, 접힌 `<details>` 안의 지시 | warn |
| 안전 우회 권유 | "승인 없이", "--no-verify", "검사를 끄고" | warn |

- 규칙 이름과 판정(규칙 집합 버전 `1.0.0`, `scan/rules.ts`). 지시 주입: `injection.ignore_previous`, `injection.ignore_previous_ko`, `injection.role_override`, `injection.role_marker`. 경계 표지: `boundary.untrusted_tag`(`<untrusted_…content` 계열 전부). 유출: `exfil.shell_secret_read`(같은 줄에 네트워크 명령과 비밀 위치), `exfil.url_secret_var`(비밀 변수를 질의에 단 URL), `exfil.data_url`(200자 넘는 base64 데이터 URL, "데이터 URL로 보내기"를 이 뜻으로 읽었다 [제안]). `scripts/` 엄격 범위에서만: `exfil.pipe_to_network`. 비밀 값: `secret.api_key`, `secret.github_token`, `secret.aws_access_key`, `secret.slack_token`, `secret.private_key`, `secret.jwt`, `secret.registered_value`(마스킹 등록부, 줄 번호 없음). 숨은 문자: `hidden.zero_width`, `hidden.bidi_control`, `hidden.tag_chars`(U+E0000~E007F 태그 문자). 경고: `hidden.html_comment_instruction`, `hidden.details_instruction`, `bypass.skip_approval`.
- 파일 맨 앞의 U+FEFF(BOM)는 편집기가 붙이는 표지라 숨은 문자로 세지 않는다. 결과는 같은 (규칙, 줄) 쌍을 한 번만 싣고 64개를 넘으면 block을 먼저 남긴다.
- 메모리 쓰기는 검사를 항상 한다. 메모리는 매 세션 컨텍스트에 상주하므로 오염된 항목이 계속 남는다(Hermes `memory_tool_store.py:28-31`, `_research/refs/hermes.md` §3.10.1 (라)). `l2.knowledge.write.scan`은 스킬 검사만 끌 수 있고 기본은 켬이다.
- 스킬 검사 대상은 `SKILL.md` 전체와 지원 파일 중 텍스트 파일이다. `scripts/` 아래 파일은 유출 규칙을 엄격 범위로 적용한다 [제안].
- 비밀 값 판정은 `xeon.secrets`의 마스킹 등록부를 쓴다 [가정: `L0.secrets.spec`이 값을 노출하지 않는 판정 함수를 제공한다].

#### 4.6.2 검사 결과의 쓰임

- `block`이 하나라도 있으면 쓰기를 거부한다(`scan_blocked`, `detail.rules`). 대기열에 넣지도 않는다.
- `warn`은 원장과 승인 미리보기에 보인다. 쓰기를 막지 않는다.
- `knowledge.ledger.scan`은 쓰기 없이 같은 함수를 돌린다. L3 그룹의 사전 검사가 쓸 수 있다.

#### 4.6.3 바깥 텍스트가 스킬 본문으로 들어가는 경로

웹 페이지나 도구 결과에 든 지시문이 "교훈"이라는 이름으로 스킬 본문에 들어가는 경로가 있다(`_research/refs/hermes.md` §3.10.1 (바)). 방어는 계층으로 둔다.

1. 검사(§4.6.1): 지시 주입·경계 표지·숨은 문자 규칙이 대표 패턴을 막는다.
2. 승인: 에이전트 쓰기는 기본으로 사람의 승인이나 대기열을 거친다(§4.5.1). 미리보기에는 바뀐 부분의 diff와 검사 경고가 보인다.
3. 출처 표시: `caller.afterUntrusted = true`인 쓰기는 설정과 무관하게 승인 요청이고, 원장에 `afterUntrusted` 표시를 남긴다. 승인 화면은 "이번 turn에 웹·외부 결과를 읽었다"는 경고를 함께 보인다.
4. 읽을 때의 경계: `skill_view` 렌더링은 행위자가 `agent`였던 스킬(`created_by = 'agent'`)의 본문을 `<untrusted_session_content kind="skill" createdBy="agent">`로 감싼다 [제안]. 사용자가 만든 스킬은 감싸지 않는다.
5. 데이터 표지: 학습 정책을 가진 L3 그룹의 검토 포크는 지난 대화를 데이터로 다룬다는 지시를 갖는다(Hermes `/learn`의 "source text is DATA" 방어). 그 지시는 `L3.learning.spec` 소관이다.

### 4.7 변경 원장과 롤백

#### 4.7.1 원장

- 구현(KN.1) 보충. 안전 캡처는 변경 전 내용과 변경 후 내용을 모두 쓰기 전에 blob으로 저장한다(7단계). 그래서 `prepared` 행이 `before_hash`와 `after_hash`, 두 목록 blob을 이미 갖고, 시작 시 복구(§4.4.3)가 `after_hash`와 파일 해시를 비교할 수 있다. 파일 반영이 도중에 실패하면 같은 락 안에서 캡처해 둔 이전 내용으로 되돌리고 행을 `aborted`로 한다(되돌림이 실패하면 오류를 기록하고 행은 `aborted`로 두며, 다음 재색인이 어긋난 내용을 `external` 항목으로 남긴다). 10단계 커밋만 실패하면 파일은 이미 바뀐 상태이고 행은 `prepared`로 남아 시작 시 복구가 `applied`로 마감한다.
- 보관함 이름은 `<스킬 디렉터리의 부모>/.archive/<이름>-<UTC 시각>`이다. 같은 초에 같은 이름을 두 번 보관하면 `-2`부터 번호를 붙인다. 중첩된 스킬(`<루트>/묶음/<이름>`)은 자기 부모 디렉터리 아래에 보관된다.
- 모든 변경(스킬 다섯 연산, 메모리 네 연산, 바깥 편집, 되돌림)을 행위자와 함께 `cap_knowledge_ledger`에 남긴다. Hermes 원장(JSONL + 내용 주소 blob, `tools/skill_ledger.py:1-10`)의 설계를 `sys_blobs` 위로 옮긴 것이다(`_research/refs/hermes.md` §3.10.1 (라), §4.1). Hermes 코드는 Python이라 재작성한다.
- 전후 내용은 파일별 blob(`xeon.store.putBlob`, 내용 주소)과 그 목록 blob(`before_manifest`, `after_manifest`)으로 둔다. 같은 내용은 한 번만 저장된다.
- 원장 행은 지우지 않는다. 보존 기간과 오래된 blob 정리는 [미결]이다(§10 미결 6, `L2.knowledge.plan` §7 위험).

#### 4.7.2 롤백

1. 대상 항목의 `status`가 `applied`가 아니거나 이미 `rolled_back_by`가 있으면 `invalid_input`.
2. 대상의 현재 해시가 그 항목의 `after_hash`와 같은지 확인한다. 다르면 `rollback_conflict`. 뒤에 다른 변경이 있으면 그 변경부터 차례로 되돌려야 한다.
3. 쓰기 승인 게이트(§4.5.1). 롤백은 파괴적 연산이다. 구현(KN.2)은 롤백 내용을 계산한 뒤(`planRollback`) 다른 쓰기와 같은 게이트에 태운다: 사용자는 바로 적용하고, 세션 없는 확장 호출은 `ledger.rollback` 제안으로 대기열에 간다. 호출 문맥이 없는 호출은 행위자를 알 수 없어 `denied`다. 같은 `requestId`는 계산 앞에서 확인하므로 두 번째 호출은 "이미 되돌린 항목" 오류 없이 첫 결과를 돌려받는다.
4. 안전 캡처: 현재 내용을 blob으로 저장한다. 실패하면 되돌리지 않고 `rollback_unsafe`로 실패한다(닫힌 실패, Hermes `skill_ledger.py`).
5. `before_manifest`의 내용으로 파일을 되돌린다. 이전 내용을 담지 못한 항목(바깥 편집을 처음 본 항목, 삭제된 파일을 찾지 못한 경우)은 `unsupported`로 거부한다. `before_hash`가 null(생성 연산)이면 그 스킬을 보관함으로 옮긴다. 보관함 이동(`skill.archive`)의 되돌림은 보관함에서 원래 경로로 되돌린다.
6. 새 원장 항목(`op: "rollback"`, `rollback_of`)을 남기고 원래 항목의 `rolled_back_by`를 채운다.

- 되돌림의 되돌림도 같은 규칙이다.
- 쓰기 경로(§4.4.1)의 7~11단계를 그대로 쓰므로 락, 의도 기록, 시작 시 복구가 같게 적용된다.

### 4.8 세션 검색

#### 4.8.1 색인 소비자

- 소비자 `cap.knowledge.fts`는 내구 피드(`xeon.session`의 `subscribe(afterSeq, listener, { kindPrefixes: ["item.recorded"] })`)를 이벤트 `seq` 순으로 받는다 [결정: KN.4. 초안의 `pos` 커서 기반 읽기는 이 구독으로 대신한다. 구독은 커서 뒤의 따라잡기와 실시간을 같은 구간에서 잇는다].
- 처리 단위는 배치(최대 500 이벤트)다. 한 배치마다:
  1. 트랜잭션 밖에서 `item.recorded`의 사용자·어시스턴트 텍스트 파트를 뽑는다(초안의 `message.recorded`). `detached` 필드가 있으면 `session.hydrate`로 blob에서 되돌린 사본을 읽는다. 도구 결과, 사고(thinking), 도구 호출, 이미지는 넣지 않는다 [제안]. 텍스트가 없는 메시지는 건너뛴다.
  2. 텍스트를 NFC로 정규화한다.
  3. `StoreDb.write` 하나 안에서 `cap_knowledge_sessiondocs`(`event_id` 유일)와 `cap_knowledge_sessionfts`에 넣고, 같은 트랜잭션에서 `cap_knowledge_sessioncursor`를 배치 마지막 `seq`로 올린다. 색인할 메시지가 없는 배치도 커서는 올린다.
- 중복 방지: 커서보다 작거나 같은 이벤트 `seq`는 건너뛰고, `event_id`가 이미 있으면 넣지 않는다. 같은 배치를 두 번 받아도 FTS 행이 늘지 않고 세션 안 메시지 번호도 그대로다(수용 기준 3, `eng.events.design` EV-05).
- 실패: 쓰기가 실패하거나 던지면 커서를 올리지 않고 소비자를 멈춘다(뒤 배치를 건너뛰어 틈이 생기지 않게 한다). 원인은 `knowledge.indexer.failed`로 기록한다. 다음 시작이 같은 배치부터 다시 받는다.
- session-core의 투영(`p_*`)을 JOIN하지 않는다. 필요한 값은 이벤트에서 받아 자기 테이블에 둔다(`eng.context-map.design` CM-02 좋은 예).
- 세션 삭제: 색인 표는 투영기 `cap.knowledge`의 DDL에 선언되어 있고 `thread_id` 열이 있으므로 session-core가 그 세션 행을 함께 지운다(`eng.context-map.design` §5.2). FTS 표도 `thread_id UNINDEXED` 열로 `DELETE … WHERE thread_id = ?`가 된다.
- 되감기·분기: 이벤트는 불변이고 되감긴 가지의 메시지도 색인에 남는다. 검색 결과는 원문 기록이므로 가지와 무관하게 보인다 [제안]. 현재 가지만 보이려면 `parentId` 경로 정보가 필요하므로 2차에 정한다.

#### 4.8.2 세션 종류와 숨김

- 투영기 `cap.knowledge`가 세션 종류와 프로젝트를 기록한다 [결정: KN.4]. 프로젝트는 `thread.started.workspace`의 sha256 앞 16자다(워크스페이스가 없으면 null). 종류는 `thread.started` payload에 없어서 부모의 `agent.spawned`가 가리키는 자식 thread에 `background: true`면 `background`, 아니면 `subagent`를 쓰고 나머지는 `main`이다. 자식의 `thread.started`가 `agent.spawned`보다 늦게 와도 종류를 덮어쓰지 않는다. `cron`은 M3 `cap-schedule`부터다.
- 크론·서브에이전트·백그라운드 세션은 기본 검색과 목록에서 숨긴다. 크론 잡의 반복 어휘가 사용자 대화를 밀어내는 "회상 맹점"을 막기 위해서다(`_research/refs/hermes.md` §3.10.2). 서비스 입력 `includeHidden: true`로 포함한다.
- 크론 세션은 M3 `cap-schedule`부터 생긴다.

#### 4.8.3 토크나이저

- FTS5 `trigram` 토크나이저를 쓴다(`case_sensitive=0`, `remove_diacritics=0`, `detail=full`). `unicode61`은 조사가 붙은 한국어 어절에서 `검색`으로 `검색을`을 찾지 못한다(`_research/notes/L2-3.md` §3.1 [측정, Linux]).
- trigram은 SQLite 3.34.0 이상이 필요하다. Bun 1.4.3 Linux 번들은 3.53.4다(`_research/notes/L2-3.md` §3.3).
- [가정] macOS의 시스템 SQLite에도 FTS5와 trigram이 있다. 확인하지 않았다(`_research/notes/L2-3.md` §2.2). 시작 프로브(§4.8.5)가 실제 판정 기준이다.
- 인덱스 크기는 합성 데이터에서 unicode61의 약 3배였다(`_research/notes/L2-3.md` §3.2 [측정, 합성 데이터]). 실제 대화로 다시 잰다(`L2.knowledge.plan` §6).

#### 4.8.4 질의 규칙

1. 질의를 NFC로 정규화하고 앞뒤 공백을 지운다.
2. 따옴표 구절과 공백으로 나눈 토큰을 만든다. FTS5 특수 문자(`"`, `*`, `^`, `:`, `(`, `)`)는 구절 안에서 그대로 쓰도록 각 토큰을 큰따옴표로 감싸고 내부 큰따옴표는 두 번 쓴다.
3. 모든 토큰·구절이 3 코드 포인트 이상이면 FTS 경로: `MATCH`에 토큰 구절들을 AND로 묶어 넣는다. 정렬은 `bm25()` 오름차순, 같으면 `recorded_at` 내림차순(`_research/notes/L2-3.md` §4 5번). `path: "fts"`.
4. 하나라도 3 코드 포인트 미만이면 LIKE 경로: `text LIKE '%' || ? || '%' ESCAPE '\'`로 모든 토큰을 AND한다. 최근 문서부터 `l2.knowledge.search.likeScanLimit`(기본 20,000)개 안에서만 찾는다. `path: "like"`. trigram MATCH는 3글자 미만에서 오류 없이 0건을 내므로 빈 결과를 그대로 돌려주지 않기 위한 경로다(`_research/notes/L2-3.md` §3.2, §6).
5. `kinds` 기본은 셋 모두다. 스킬·메모리는 `cap_knowledge_docsfts`에서, 세션은 `cap_knowledge_sessionfts`에서 같은 규칙으로 찾고, 종류별 결과를 점수 순으로 섞지 않고 종류 순(skill → memory → session)으로 이어 붙인다 [제안]. 종류 사이 bm25 값은 비교할 수 없기 때문이다.
6. 스니펫은 `snippet()` 함수로 만들고 600자에서 자른다. LIKE 경로는 첫 일치 위치 앞뒤 120자다.
7. `scope: "project"`는 현재 세션의 프로젝트와 같은 세션만 찾는다. 기본은 `l2.knowledge.search.defaultScope`(`"all"`)다. 현재 세션을 모르거나 그 세션에 프로젝트가 없으면 세션 결과는 비어 있다 [제안: 모를 때 전체로 넓히지 않는다].
8. 결과는 원문이다. LLM 요약을 하지 않는다(`_research/refs/hermes.md` §3.10.2).
9. 구현(KN.4): 한 호출의 `limit`는 종류 전체의 합이다. 앞 종류가 한도를 채우면 뒤 종류는 찾지 않는다. 스킬·메모리 검색에는 `includeHidden`이 `disable-model-invocation` 스킬을 포함할지를 뜻하고, 같은 이름의 스킬은 모델이 보는 이름 해석의 승자만 낸다. 스킬·메모리 FTS 표가 없으면 `path`는 `like`다. `scroll`·`read`는 세션 종류와 상관없이 ID로 읽고(숨긴 세션 포함) 메시지 하나가 100,000자를 넘으면 자르고 `truncated`를 켠다. `list`는 `last_at` 내림차순이고 `before`는 `last_at` 기준이다. LIKE 경로의 스캔 범위는 FTS 필터 조건(종류·프로젝트·시각)을 적용한 최근 문서 `likeScanLimit`개다.

모델 렌더링: 세션 메시지는 `<untrusted_session_content session="…" seq="…" role="…">`로 감싼다. 지난 대화에도 웹 결과에서 옮겨 적은 지시문이 있을 수 있기 때문이다(`L2.readme` §5.3 표지 명명 규칙).

#### 4.8.5 FTS5 시작 프로브

- 구현(KN.4, `search/probe.ts`, `search/setup.ts`) [결정]: 범위 핸들(`scoped`)은 DDL을 허용하지 않아 자기 범위에서 `CREATE VIRTUAL TABLE temp...`를 돌릴 수 없다. 대신 `StoreService.capabilities`의 FTS5 판정(`platform-store`의 시작 프로브)과 SQLite 버전(3.34.0 이상)으로 판정하고, 실제 `trigram` 표 생성은 투영기 등록의 DDL이 한다. 등록 뒤 표를 한 번씩 읽어 보아 읽히지 않으면 같은 실패로 취급한다. `setCustomSQLite`의 반환값은 판정에 쓰지 않는다(`_research/notes/L2-3.md` §2.3).
- 프로브가 실패하면:
  - 세션 색인 소비자를 시작하지 않는다. FTS 표를 선언하지 않으므로 커서도 없다. 능력이 생기면 투영 버전이 바뀌어 투영이 다시 만들어지고 색인은 처음부터 쌓인다. 세션 목록(`list`)은 투영만 쓰므로 계속 동작한다.
  - `query`에서 `session` 종류는 빼고 `degraded: ["session"]`를 싣는다. 세션만 요청했으면 `unavailable`(`detail.reason: "fts5_unavailable"`).
  - 스킬·메모리 검색은 `cap_knowledge_docsfts` 대신 색인 테이블과 파일 내용에 대한 LIKE 경로로 한다(대상이 작다). 이때 `path`는 `like`다.
  - L4 진단에 원인(FTS5 없음, trigram 없음, SQLite 버전)을 남긴다. 시작을 막지 않는다 [제안]. ADR-0004 §6 [미결] "FTS5 없을 때 시작 중단 또는 기능만 끄기" 중 이 능력은 기능만 끈다.

### 4.9 재생 규칙

| 메서드 | replay | 결과 불명일 때 |
|---|---|---|
| `skills.list`, `skills.view`, `skills.reindex` | safe | 다시 실행한다 |
| `skills.create`·`edit`·`patch`·`writeFile`·`remove`·`manage` | unsafe | 중단 결과를 합성한다. 같은 `requestId`로 다시 부르면 원장의 첫 결과가 돌아온다 |
| `memory.read` | safe | 다시 실행한다 |
| `memory.add`·`replace`·`remove`·`manage` | unsafe | 같음 |
| `search.*` | safe | 다시 실행한다. 색인이 그 사이 늘었으면 결과가 다를 수 있다 |
| `ledger.list`·`show`·`scan`·`proposals` | safe | 다시 실행한다 |
| `ledger.rollback`·`decide` | unsafe | 중단 결과를 합성한다 |

- 렌더러(`renderSkillView`, `renderWriteOutcome`, `renderMemoryWrite`, `renderHits`, `renderMessages`)는 순수 함수다.
- 첫 turn 스냅샷·인덱스 블록은 기록 메시지로 남는다는 제안(§4.2.5, §4.3.4)을 따르면 재개 때 다시 계산하지 않는다. 기록하지 않는 방식이 정해지면 블록은 세션별 저장 사본에서 다시 만들어야 한다(§10 미결 4).

## 5. 실패와 경계 사례

| # | 사례 | 처리 | 오류 코드 |
|---|---|---|---|
| 1 | 모델이 승인 없이 스킬을 고치려 함(기본 설정) | 승인 요청. 거부면 파일 불변 | `approval_denied` |
| 2 | 백그라운드 포크가 메모리 항목 삭제 | 대기열. 파일 불변, `status: "queued"` | — |
| 3 | 서브에이전트가 스킬 생성 | 대기열 | — |
| 4 | L3 그룹이 신뢰 source 증거와 함께 적용 | 바로 적용, 원장에 증거 | — |
| 5 | 다른 확장이 남의 source(`"<그룹 이름>.queue"`) 증거를 보냄 | 증거 무효, 세션 있으면 승인 요청 | — |
| 6 | 같은 `requestId`로 두 번 적용 | 두 번째는 첫 결과, 원장 행 하나 | — |
| 7 | `baseHash`가 옛 해시 | 거부 | `base_stale` |
| 8 | 승인 대기 중 사람이 파일을 편집 | 9단계 락 안 재확인에서 거부, 원장 `aborted` | `base_stale` |
| 9 | 메모리 쓰기 뒤 한도 초과 | 거부, 현재 항목 목록 | `memory_full` |
| 10 | 메모리 파일 `§` 구조가 깨짐 | `.bak` 사본, 쓰기 거부 | `drift_detected` |
| 11 | 메모리 파일이 바깥에서 정상 편집됨 | 원장 `external`, 새 해시로 계속 | — |
| 12 | 스킬 본문에 `ignore previous instructions` | 거부 | `scan_blocked` |
| 13 | 메모리에 `sk-…` 키 형태 | 거부(스캔 설정과 무관) | `scan_blocked` |
| 14 | 안전 캡처 실패(디스크 가득) | 쓰지 않음 | `internal` |
| 15 | 롤백 대상 뒤에 다른 변경 있음 | 거부 | `rollback_conflict` |
| 16 | 롤백 전 안전 캡처 실패 | 되돌리지 않음 | `rollback_unsafe` |
| 17 | 프로세스가 8단계와 10단계 사이에 죽음 | 시작 시 복구가 해시로 `applied`/`aborted` 판정 | — |
| 18 | 확장 제공 스킬에 쓰기 | 거부 | `read_only_scope` |
| 19 | `patch`의 `oldText`가 두 번 나옴 | 거부 | `patch_mismatch` |
| 20 | 사용자·프로젝트에 같은 이름 스킬 | 프로젝트가 이김, `collision` 진단 | — |
| 21 | FTS5·trigram 프로브 실패 | 세션 검색 끔, 스킬·메모리는 LIKE | `unavailable`(세션만 요청 시) |
| 22 | 2글자 한국어 질의 | LIKE 경로, `path: "like"` | — |
| 23 | 같은 이벤트 배치가 두 번 전달됨 | 이벤트 `seq`·`event_id`로 건너뜀 | — |
| 24 | 세션 삭제 | 세션 목록·문서·FTS 행이 함께 지워짐 | — |
| 25 | NFD로 저장된 텍스트를 NFC 질의 | 색인 때 NFC로 바꾸었으므로 찾음 | — |
| 26 | 제안 승인 시점에 대상이 바뀜 | 제안 `stale` | `base_stale` |
| 27 | 14일 지난 `pending` 제안 | 시작 정리 때 `expired` | — |
| 28 | 인덱스 예산 초과 | 정해진 순서로 넣고 "외 N개" 안내 | — |

## 6. 설정 노출

키 문법 `l2.knowledge.<이름>`(`F.wire-settings.spec` §3.8.1, `L2.readme` §7.1). 표 표기는 `L2.readme` §7.1을 따른다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab | secret |
|---|---|---|---|---|---|---|---|
| `l2.knowledge.skills.enabled` | boolean | `true` | — | nextTurn | managed, user, project, local, session | tools | false |
| `l2.knowledge.skills.projectSkills` | boolean | `true` | — | restart | managed, user | tools | false |
| `l2.knowledge.skills.paths` | string[](절대 경로) | `[]` | — | restart | managed, user | tools | false |
| `l2.knowledge.skills.indexBudgetChars` | integer | `8000` | min 1000, max 50000 | nextTurn | managed, user, project, local | tools | false |
| `l2.knowledge.skills.indexDescriptionChars` | integer | `160` | min 40, max 1024 | nextTurn | managed, user, project, local | tools | false |
| `l2.knowledge.memory.enabled` | boolean | `true` | — | nextTurn | managed, user, project, local, session | sessions | false |
| `l2.knowledge.memory.userLimitChars` | integer | `1375` | min 200, max 20000 | nextTurn | managed, user | sessions | false |
| `l2.knowledge.memory.envLimitChars` | integer | `2200` | min 200, max 20000 | nextTurn | managed, user | sessions | false |
| `l2.knowledge.write.approval` | boolean | `true` | — | live | managed, user | tools | false |
| `l2.knowledge.write.scan` | boolean | `true` | — | live | managed, user | tools | false |
| `l2.knowledge.write.proposalExpiryDays` | integer | `14` | min 1, max 365 | live | managed, user | tools | false |
| `l2.knowledge.write.trustedEvidenceSources` | string[] | `[]` | — | restart | managed, user | advanced | false |
| `l2.knowledge.search.enabled` | boolean | `true` | — | nextTurn | managed, user, project, local, session | sessions | false |
| `l2.knowledge.search.defaultScope` | string | `"all"` | enum all, project | nextTurn | managed, user, project, local, session | sessions | false |
| `l2.knowledge.search.includeHiddenDefault` | boolean | `false` | — | nextTurn | managed, user | sessions | false |
| `l2.knowledge.search.likeScanLimit` | integer | `20000` | min 1000, max 1000000 | live | managed, user | advanced | false |

- 쓰기 승인·스캔·증거 출처 키는 관리·사용자 범위만 허용한다. 프로젝트 파일(저장소에 커밋되는 설정)로 승인을 끄는 경로를 막기 위해서다.
- `l2.knowledge.skills.paths`도 같은 이유로 프로젝트 범위를 허용하지 않는다. 프로젝트 스킬은 `.xeon/skills` 한 곳이고 `projectSkills`로 끈다.
- 탭 배치: 스킬과 쓰기 정책은 `tools`, 메모리와 세션 검색은 `sessions`다(`L4.settings-ui.spec` 탭 표 "sessions: L2-d `l2.knowledge.*`(메모리)", "tools: `l2.knowledge.*`(스킬)").
- 화면 기능(L4): 메모리 열람·편집·삭제(행위자 `user` 쓰기), 스킬 목록 켜기·끄기와 인덱스 예산 표시, 제안 대기열 결정, 원장 열람과 되돌리기, 드리프트 상태와 "현재 파일 받아들이기". 화면 구현은 `L4.settings-ui.spec`, `L4.desktop.spec`이 정한다.
- 공유 메모리 저장소는 보류다(`_research/packages.md` §4.4 L2-d). 키를 두지 않는다.

## 7. 확장 지점

- 이 문서는 새 지점을 정의하지 않는다.
- `cap-knowledge`가 거는 지점 [제안]:

| 지점 | fold | 쓰임 |
|---|---|---|
| `session_start`(#30) | tap | 세션별 상태(마지막 인덱스 스냅샷) 초기화. `startup` 말고는 스킬 루트를 다시 훑어 바깥 편집을 반영한다(전체 재색인이며 mtime 검사는 하지 않는다) |
| `before_agent_start`(#3) | chain | 세션 첫 turn: 메모리 스냅샷 + 스킬 인덱스 블록을 메시지로 더한다. 이후 turn: 인덱스가 바뀌었으면 델타 메모를 더한다(§4.2.6). `before_agent_start.message`는 추가 병합이다(`F.extensions.spec` §4.1) [가정: 더한 메시지가 세션 기록에 남는다] |
| `resources_discover`(#28) | chain | 패치를 돌려주지 않는다. 합성 결과의 스킬 경로를 받는 방법은 X가 정한다(§4.2.7) |
| `session_compact`(#35) | tap | 그 대화의 세션별 상태를 비워 다음 turn에 인덱스 블록과 메모리 스냅샷을 다시 넣게 한다(§4.2.8) |
| `session_shutdown`(#39) | tap | 세션별 메모리 상태 정리 |

- 모델 도구 경로는 tool 지점(`tool_call` first, `tool_result` chain)을 지난다. 페이로드 `capability` 필드(`{ id: "knowledge.skills", method: "manage" }`)로 L3 그룹이 특정 단계의 쓰기를 막거나 스킬 쓰기 사건을 셀 수 있다.
- 그룹 코드의 서비스 호출은 tool 지점을 지나지 않는다. 그래서 게이트·검사·원장은 서비스 안에서 적용한다.
- cap-knowledge는 drive와 post를 쓰지 않는다. L2 전체는 drive를 쓰지 않는다(`L2.readme` §4.2).
- 학습 정책(카운터 트리거, 검토 포크 스폰, 큐레이터 주기)은 L3 그룹이 자기 `on` 핸들러로 구현한다. 이 능력은 그 정책을 위한 지점이나 훅을 따로 두지 않는다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `KnowledgeSkills`, `KnowledgeMemory`, `KnowledgeSearch`, `KnowledgeLedger` 정의와 `KnowledgeSkillsKey`, `KnowledgeMemoryKey`, `KnowledgeSearchKey`, `KnowledgeLedgerKey` | `F.capabilities.spec`(defs/knowledge.ts), `L3.helm.spec`, `L3.learning.spec` |
| `WriteOutcome`, `ApprovalEvidence`, `KnowledgeActor`, `ScanSummary`, `LedgerEntry`, `Proposal` | `L3.learning.spec`, `L4.desktop.spec`, `L4.cli.spec` |
| 서비스 `xeon.knowledge`(`KnowledgeService`) | `L2.readme` §5.6, `eng.context-map.design` §5.3 |
| 투영기 `cap.knowledge`, 소비자 `cap.knowledge.fts` | `L1.persistence.spec`, `eng.transactions.design` §7 |
| `l2.knowledge.*` 설정 키 | `L4.settings-ui.spec` |

요구:

| 이름 | 출처 | 상태 |
|---|---|---|
| `defineCapability`, `serviceKey`, `CapabilityError`, `validateCapability` | `F.capabilities.spec` | 있음 |
| `CallOptions.context.caller`(`CallerInfo`, `afterUntrusted` 포함) | `F.capabilities.spec` §3.2(`L2.readme` §5.8) | 있음 |
| `BlobRef`, blob 자리표시 형식 | `F.records.spec` §3.4 | 있음 |
| `StoreService.scoped`, `putBlob`, `readBlob`, temp 가상 테이블 생성 허용 | `L0.store.spec` | 있음(`eng.transactions.design` §4.2), temp 허용은 [가정] |
| `consumer_cursors` 자기 행 쓰기를 범위 핸들에서 허용 | `L0.store.spec`, `L1.persistence.spec` | 없음. 범위 핸들은 session-core 표에 쓸 수 없어 커서를 투영 표로 옮겼다(§4.8.1) |
| 전역 이벤트 `seq` 구독(`subscribe(afterSeq, listener, filter)`, `kindPrefixes`)과 `hydrate` | `L1.persistence.spec`(`xeon.session`) | 있음 |
| 투영기 등록(`projectors.register`)과 같은 컨텍스트 범위 핸들의 투영 표 쓰기 | `L1.persistence.spec`, `L0.store.spec` | 있음(표 이름은 `cap_knowledge_` + 밑줄 없는 지역 이름, 세션 삭제 정리는 `thread_id` 열) |
| 세션 종류·부모·작업 디렉터리 | `thread.started.workspace`, `agent.spawned.background` | 있음. 종류 필드는 없어 `agent.spawned`로 추론한다(§4.8.2) |
| `ApprovalService`(`xeon.approvals`) `open`·`wait`와 요청 kind `tool`, 미리보기 payload(`args.preview`) | `L1.tools.spec` §3.6, F `services/approvals.ts` | 있음(KN.2가 `createWriteApprovals`로 쓴다) |
| `DecideInput.approval`(확장의 제안 결정에 실을 증거), `LedgerEntry.afterUntrusted` | `F.capabilities.spec` | 요청(KN.2, §10 미결 21·22) |
| 쓰기 도구 둘의 일반 도구 승인 기본값 `allow` | `L1.tools.spec` | 요청 |
| 첫 turn 기록 메시지로 스냅샷·인덱스를 넣는 경로 | `L1.context.spec` | 요청 |
| 컴팩션 뒤 다시 넣기 | `L1.context.spec`의 `session_compact` | 있음(§4.2.8). 컴팩션 호출 배선은 L1 쪽(G2-01) |
| 데이터 디렉터리 | `L0.os.spec`(`OsDirs.data`) | 있음 |
| 프로젝트 디렉터리 | 대화의 작업 폴더(`workspaceOf`, 조립 루트가 `threadWorkspaceOf`를 넘긴다). 옵션이 없으면 `xeon.exec`의 `cwd` | 있음(`L2.readme` §5.10) |
| 프로세스 사이 파일 락 | `L0.os.spec` | 없음. 임대와 해시 재확인으로 대신한다(§4.3.3, §10 미결 18) |
| `SkillFilePathSchema`를 점으로 시작하거나 끝나는 마디를 거부하도록 좁히기, `isSkillFilePath`도 같은 규칙 | `F.capabilities.spec` §3.9 | 요청(KN.1, §3.1) |
| 마스킹 등록부 판정(값 노출 없음) | `L0.secrets.spec`(`Redactor.containsKnown`) | 있음. `xeon.secrets`가 없으면 이 판정만 건너뛴다 |
| `resources_discover` 합성 결과 전달 | `X.loading-trust.spec` | [가정] |
| `Clock`, `IdFactory`, `LocalIdFactory`, `localIdPattern` | `F.readme`(주입 인터페이스, 구현은 `platform-os`), `F.conversation.spec` §3.2.1 | 있음 |

## 9. 수용 기준

1. 기본 설정에서 행위자 `agent`(main, subagent, background)와 증거 없는 `extension`의 쓰기는 승인이 나기 전이나 제안이 승인되기 전에는 스킬 디렉터리와 메모리 파일을 한 바이트도 바꾸지 않는다. 승인 거부, 제안 거절·만료·`stale` 뒤에도 파일이 그대로다(`product.scope.spec` §4.4 M3 UC-3 근거).
2. 모든 쓰기(스킬 다섯 연산, 메모리 네 연산)는 원장에 행위자와 함께 `applied` 행을 남긴다. 각 행을 `rollback`하면 대상의 트리 해시나 파일 해시가 그 행의 `before_hash`로 돌아가고, 되돌림도 원장에 남는다. 생성의 되돌림은 보관함 이동이다.
3. 같은 이벤트 배치를 소비자에 두 번 넣어도 `cap_knowledge_sessiondocs`와 `cap_knowledge_sessionfts`의 행 수가 늘지 않는다. 커서 갱신과 행 삽입 사이에 고장을 주입하면 둘 다 반영되지 않는다(같은 트랜잭션).
4. 쓰기 뒤 크기가 한도를 넘는 메모리 쓰기는 `memory_full`로 거부되고 파일이 그대로이며, 오류 `detail`에 현재 항목 목록이 있다.
5. `defs/knowledge.ts`의 네 정의는 각각 `validateCapability` 이슈 0건이고, 네 정의를 함께 넣은 `validateCapabilitySet`도 0건이다(도구 이름 충돌 없음). 도구 없는 능력이 허용되지 않으면 `knowledge.ledger`에 읽기 도구를 더한 뒤 같은 기준을 지킨다.
6. L3 순위 패키지에 `@xeon/cap-knowledge` import가 0이고, L3 그룹은 `KnowledgeSkillsKey` 등 ServiceKey로만 호출한다(`check-layers.ts` DR-02·DR-14 검사와 테스트 그룹 호출 테스트).
7. 백그라운드 포크의 파괴적 연산은 `l2.knowledge.write.approval = false`에서도 대기열로 간다.
8. 2글자 한국어 질의(`검색`)는 LIKE 경로로 `검색을`이 든 메시지를 찾고, 3글자 질의(`검색을`)는 FTS 경로로 찾는다. NFD로 들어온 메시지도 NFC 질의로 찾는다.
9. FTS5 trigram 프로브가 실패하는 가짜 저장소에서 시작이 막히지 않고, `query({ kinds: ["session"] })`는 `unavailable`, 기본 `query`는 `degraded: ["session"]`이다.
10. 안전 캡처가 실패하도록 고장을 넣으면 쓰기와 롤백 모두 파일을 바꾸지 않는다.
11. 메모리 파일의 `§` 구조를 깨면 다음 쓰기가 `drift_detected`이고 `.bak/` 아래 사본이 하나 생긴다.
12. 위협 패턴 규칙의 block 예시마다 스킬·메모리 쓰기가 `scan_blocked`이고, 결과에 걸린 문자열이 없다.
13. 세션을 지우면 그 세션의 `cap_knowledge_sessions`, `cap_knowledge_sessiondocs`, `cap_knowledge_sessionfts` 행이 남지 않는다.

## 10. 미결 사항

1. [미결] 메모리 정본의 위치. 제안은 "정본 파일 + DB 색인·원장·대기열"이다. `eng.context-map.design` §4.1 표는 메모리를 `cap_knowledge_`에 두고, `_research/item-catalog.md`는 git 추적 파일을 권한다(§4.1).
2. 닫힘. 호출자 정보는 `F.capabilities.spec` §3.2 `CallOptions.context.caller`로 받는다(`L2.web.spec` §3.7과 같다).
3. [미결] 제안 대기열의 소유와 중복. 이 문서는 `cap_knowledge_proposals`(에이전트 쓰기용)를 두고 학습 정책을 가진 L3 그룹은 자기 대기열을 갖는다. 하나로 합칠지(`L3.learning.spec` §10 미결 9, `eng.context-map.design` §4.1 "제안 대기열").
4. [미결] 메모리 스냅샷과 스킬 인덱스를 넣는 위치(시스템 프롬프트 영역 또는 첫 turn 기록 메시지)와 컴팩션 뒤 다시 넣는 규칙. `L1.context.spec`과 함께 정한다(§4.2.5, §4.3.4).
5. [미결] 쓰기 도구 승인의 이중화 방지. 일반 도구 승인 기본 `allow` + 능력 게이트(제안) 또는 L1.tools 승인 하나에 diff를 싣는 방식(§3.6).
6. [미결] 원장 보존 기간과 오래된 blob 정리. 지우지 않으면 원장 blob이 계속 늘어난다(`L2.knowledge.plan` §7).
7. [미결] 인덱스 예산과 설명 자르기 기본값(8,000자, 160자). 측정 전 [가정]이다(§4.2.5).
8. [미결] 도구 없는 능력(`knowledge.ledger`)의 허용. `F.capabilities.spec` §10을 따른다.
9. [미결] 세션 FTS의 외부 콘텐츠 테이블(`content=`) 사용. 본문 중복 저장을 줄이는 대신 트리거와 투영의 같은 트랜잭션 관리가 필요하다(`_research/notes/L2-3.md` §4 6번).
10. [미결] 스킬 루트에 `.gitignore` 계열 무시 규칙을 적용할지. 적용하면 `ignore` 7.0.8 의존을 다시 들인다(§4.2.1).
11. [미결] 2글자 질의 LIKE 경로의 탐색 범위(`likeScanLimit`)와 성능 목표(`_research/notes/L2-3.md` §5).
12. [미결] L3 학습 정책의 `kind: "script"(반복 작업 스크립트) 저장 위치. 2차(§3.9).
13. [미결] 프로젝트 스킬(`.xeon/skills`)에 대한 에이전트 쓰기 허용. 제안은 모델 도구 경로에서 금지다(§3.2).
14. [미결] 되감긴 가지의 메시지를 세션 검색에서 숨길지(§4.8.1).
15. [가정] macOS 시스템 SQLite의 FTS5·trigram 포함(`_research/notes/L2-3.md` §2.2). 사용자 Mac에서 `pragma compile_options` 확인이 필요하다.
16. [가정] Hermes 한도 1,375자·2,200자를 한국어 사용에 그대로 쓴다(§4.3.2).
17. [미결] 프로젝트 스킬 색인의 범위. 색인(`cap_knowledge_skills`의 기본 키가 (범위, 이름)이다)은 한 번에 작업 폴더 하나의 프로젝트 스킬만 담고, 대화의 작업 폴더가 다르면 그 폴더로 다시 색인한다(§4.2.1). 작업 폴더가 다른 대화가 번갈아 돌면 재색인이 잦다. 여러 작업 폴더를 동시에 담으려면 프로젝트 식별 열(작업 폴더)을 기본 키에 더해야 한다. 데스크톱 다중 창에서 필요해지면 M3 이후에 정한다.
18. [미결] 프로세스 사이 파일 락. `OsService`에 락 API가 없어 임대와 해시 재확인으로 대신한다(§4.3.3). 데이터 디렉터리를 엔진 밖의 도구가 쓰는 경우의 보장은 해시 재확인까지다.
19. [미결] 재색인 비용. 모든 스킬 트리를 읽고 해시한다. 스킬 수와 크기가 커지면 mtime·크기로 후보를 줄인다(`cap_knowledge_files.mtime_ms`가 그 자리다).
20. [미결] 쓰기 한도(파일 1 MiB, 500개)와 읽기 한도(파일 16 MiB, 전체 64 MiB, 500개)의 차이(§4.2.2). 읽기 한도를 넘는 스킬은 색인에서 빠진다.
21. [미결] 원장 `afterUntrusted` 표시. §4.6.3 3번은 `afterUntrusted = true`인 쓰기를 원장에 표시하라고 하지만 F `LedgerEntry`에 필드가 없다. 구현(KN.2)은 승인 요청의 `args.afterUntrusted`로만 알린다. F가 `LedgerEntry.afterUntrusted?`를 더하면 원장 열을 더한다.
22. [미결] 확장의 제안 결정. `DecideInput`에 `approval` 증거가 없어 `decide`는 호스트 전용이다(§4.5.2). 제안 대기열과 L3 그룹의 자기 대기열(미결 3)을 합칠 때 함께 정한다.
