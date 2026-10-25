---
id: L2.knowledge.plan
layer: L2
domain: knowledge
kind: plan
status: draft
depends_on: [L2.knowledge.spec, F.capabilities.plan, L0.store.plan, L1.persistence.plan]
binds: [xeon/packages/cap-knowledge/**]
---

# L2 지식과 기억 구현 계획 (knowledge)

## 1. 목표와 마일스톤 배치

목표: `L2.knowledge.spec`의 네 능력(`knowledge.skills`, `knowledge.memory`, `knowledge.search`, `knowledge.ledger`)과 쓰기 경로(검사, 승인 게이트, 제안 대기열, 원장)를 만든다. 스킬 자기 작성 정책과 백그라운드 학습은 `L3.learning`으로 넘어갔으므로 이 계획 범위 밖이다(`_research/layer-plan-v2.json` L2-d note, `eng.context-map.design` 3절 결정 5). 이 계획은 그 정책이 쓰는 저장과 조회만 만든다.

### 1.1 M0·M1·M2

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 없음. `cap-knowledge` 스캐폴드(`package.json`의 `xeon` 필드, 빈 `src/index.ts`)는 이미 있다 | `_research/foundation-plan.md` §5 P4 |
| M1 | 없음. 지식 능력은 걸어 다니는 골격 범위 밖이다 | `product.scope.spec` §4.3 M1 |
| M2 | K1~K11 전부 | 아래 |

[제안] 다섯 구성요소(스킬, 메모리 파일, 세션 검색, 변경 원장과 롤백, 쓰기 승인과 스캔)는 모두 `_research/layer-plan-v2.json` L2-d 단계 1차다. `product.scope.spec` §4.3은 M2에 "`cap-knowledge`의 1차 구성요소"를 둔다. 그래서 웹(`L2.web.plan`)과 같은 M2에 넣는다.

M2 안의 순서와 근거:

1. 읽기 경로 먼저(K1, K2, K4, K9의 스킬·메모리 부분): Helm(M2)이 `knowledge.skills.view`, `knowledge.memory.read`, `knowledge.search.query`를 `optional`로 쓴다(`L3.helm.spec` §3.8). Helm의 M2 종료 조건은 이 능력 없이도 `degraded`로 끝나지만, 실제 탐구 품질에는 읽기 경로가 필요하다.
2. 원장(K5)과 승인 게이트(K6)와 검사(K7)를 쓰기 도구 광고보다 먼저 만든다. 쓰기 도구(`skill_manage`, `memory_manage`)는 K5~K7이 끝난 뒤에 광고를 켠다. 승인 없는 쓰기 경로가 한 번도 배포되지 않게 하기 위해서다(`_research/refs/hermes.md` §4.3 "기본 무승인 자기 수정"을 피함).
3. 학습 그룹(M3, `product.scope.spec` §4.1 I8)이 이 능력에 의존하는 것은 원장(`ledger.list`·`rollback`), 승인 증거를 받는 쓰기 경로(K6), 세션 검색(K8, K9), 검사(`ledger.scan`)다(`L3.learning.spec` §3.1 requires, §4.5, §4.6). 그래서 이 넷은 M2 안에서 끝내고 M3 시작 전에 학습 그룹의 테스트 그룹 호출로 확인한다(§6 완료 기준 4).
4. 인덱스 델타 알림(K11)은 마지막이다. 첫 turn 블록(K2, K4)이 먼저 있어야 델타의 기준이 생긴다.

### 1.2 M3 이후

| 항목 | 마일스톤 | 내용 | 근거 |
|---|---|---|---|
| L3 그룹 연계 확인 | M3 | 테스트 그룹 source를 `trustedEvidenceSources`에 넣고 `ApprovalEvidence`로 적용, `ledger.scan` 사전 검사, `rollback`의 `rollback_conflict` 경로를 통합 테스트에서 확인 | `product.scope.spec` §4.4 M3 UC-3 |
| L4 화면 연계 | M3 | 메모리 열람·편집, 제안 대기열 결정, 원장 열람·되돌리기, 드리프트 "현재 파일 받아들이기" | `product.scope.spec` §4.1 I14(설정 화면 M3), `L4.settings-ui.spec` |
| `created_by` 바꾸기(Hermes `curator adopt`) | 2차 | 큐레이터(학습 그룹 2차)와 함께 | `L3.learning.spec` §4.8.1 |
| 반복 작업 스크립트 저장(`kind: "script"`) | 2차 | 저장 위치 [미결] | `L3.learning.spec` §4.8.3 |
| 세션 FTS 외부 콘텐츠 테이블 | 2차 | 인덱스 크기 실측 뒤 판단 | `L2.knowledge.spec` §10 미결 9 |
| 스킬 루트 `.gitignore` 규칙 | 2차 | `ignore` 의존 재도입 여부 | `L2.knowledge.spec` §10 미결 10 |
| 공유 메모리 저장소 | 보류 | — | `_research/layer-plan-v2.json` L2-d, `_research/packages.md` §4.4 L2-d |

## 2. 패키지와 파일 배치

`L2.readme` §3 공통 골격과 ADR-0003 §3.4 포크 배치를 따른다.

```
xeon/packages/contracts/src/capabilities/defs/knowledge.ts   # K1: 4개 정의, 공통 타입, ServiceKey

xeon/packages/cap-knowledge/
  package.json            # "xeon": { "layer": "L2", "domain": "knowledge" }
  UPSTREAM.json           # pi skills.ts 포크 출처(ADR-0003 §3.4)
  PATCHES.md              # XEON-PATCH 목록
  LICENSE.pi              # pi MIT 고지
  src/
    index.ts              # 엔트리: manifest, apply(ctx)
    manifest.ts           # provides: knowledge.skills, knowledge.memory, knowledge.search, knowledge.ledger
    service.ts            # xeon.knowledge 묶음(KnowledgeService)
    settings.ts           # defineSettings("l2.knowledge", …)  K10
    actor.ts              # CallOptions.context.caller(CallerInfo, L2.readme §5.8) → KnowledgeActor
    fs/                   # 파일 포트. 운영 구현과 테스트 가짜를 바꿔 끼운다
      port.ts             #   KnowledgeFs: read, list, stat, writeAtomic, rename, remove, lock
      node-fs.ts          #   운영 구현(node:fs/promises + xeon.os 파일 락)
    upstream/
      skills.ts           # K2: pi core/skills.ts 포크(XEON-PATCH 표지)
    skills/               # K2, K3, K11
      roots.ts            #   스킬 루트 해석(L0.os 경로, resources_discover 결과, 설정 경로)
      index.ts            #   색인 갱신, 트리 해시, 재색인
      prompt-block.ts     #   첫 turn 인덱스 블록, 예산, 델타 메모
      validate.ts         #   구조 검증(이름·설명·본문·지원 파일 한도)
      write.ts            #   create, edit, patch, writeFile, remove, manage 분배
    memory/               # K4
      format.ts           #   § 직렬화·파싱, 항목 ID, 구조 깨짐 판정(순수)
      store.ts            #   한도, 락, 원자 쓰기, 드리프트·.bak
      snapshot.ts         #   첫 turn 스냅샷 블록
    ledger/               # K5
      ledger.ts           #   prepared → applied/aborted, 멱등 재응답
      capture.ts          #   안전 캡처(manifest blob)
      rollback.ts
      recover.ts          #   시작 시 prepared 정리
      diff.ts             #   show용 통합 diff
    approval/             # K6
      gate.ts             #   게이트 표(L2.knowledge.spec §4.5.1)
      queue.ts            #   cap_knowledge_proposals, decide, 만료
      evidence.ts         #   ApprovalEvidence 유효성
    scan/                 # K7
      rules.ts            #   scanText(순수), rulesetVersion
    search/               # K8, K9
      projector.ts        #   투영기 cap.knowledge(세션 목록) + 세 테이블 DDL
      indexer.ts          #   소비자 cap.knowledge.fts(pos 커서, 배치, 멱등)
      probe.ts            #   trigram 프로브
      query.ts            #   NFC, 토큰, MATCH/LIKE 분기, bm25 정렬, 스니펫
      docs-index.ts       #   스킬·메모리 docs FTS 재구성
    render.ts             # 렌더러(순수)
    migrations/
      0001_cap_knowledge.sql   # 세션 밖 상태 테이블(files, skills, docs_fts, ledger, proposals)
    testing/
      memory-fs.ts        # KnowledgeFs 메모리 가짜(락, 실패 주입 포함)
      event-fixtures.ts   # message.recorded·session.created 픽스처 만들기
      fake-approvals.ts   # xeon.approvals 가짜(승인·거부 각본)
  test/
    *.test.ts
    fixtures/skills/**    # 포크 회귀용 스킬 디렉터리 예시
```

- 세션 투영·색인 테이블 셋(`cap_knowledge_sessions`, `cap_knowledge_session_docs`, `cap_knowledge_session_fts`)의 DDL은 마이그레이션 파일에 두지 않고 투영기 `cap.knowledge`의 `ddl`에 둔다. 투영 재생성 규칙(`eng.events.design` §5.1 규칙 4)을 따르기 위해서다.
- 세션 밖 상태 테이블의 마이그레이션 위치와 적용 방식은 `L0.store.plan`을 따른다 [가정: `cap-*` 패키지의 `migrations/`를 접두사별로 적용한다].
- 정본 파일 경로(사용자 데이터 디렉터리, 프로젝트 `.xeon/skills`)는 코드에 상수로 두지 않고 `xeon.os`의 경로 API에서 받는다(`L0.os.spec`, `eng.dependency-rules.guide` DR-13).
- `cap-knowledge`는 `bun:sqlite`를 import하지 않는다. SQL은 `xeon.store.scoped("cap_knowledge_")` 핸들로만 실행한다(DR-07).

## 3. 작업 분해

규모: S(1일 이하), M(2~3일), L(4~6일).

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| K1 | F `defs/knowledge.ts`: 네 정의(`KnowledgeSkills`, `KnowledgeMemory`, `KnowledgeSearch`, `KnowledgeLedger`), 공통 타입(`KnowledgeActor`, `ApprovalEvidence`, `WriteOutcome`, `ScanSummary`, `LedgerEntry`, `Proposal`), ServiceKey 넷, `validateCapability`·`validateCapabilitySet` 이슈 0건 테스트 | F.capabilities.plan의 `defineCapability`·`validateCapability` | M |
| K2 | pi `core/skills.ts` 포크(§4 결합 3곳 해소와 `ignore` 제거), 스킬 루트 해석, 색인 테이블, 트리 해시, 재색인(`skills.reindex`), 첫 turn 인덱스 블록과 예산, `list`·`view`(지연 로딩) | K1, `KnowledgeFs` 포트 | L |
| K3 | 스킬 쓰기 연산 `create`·`edit`·`patch`·`writeFile`·`remove`·`manage`와 구조 검증(이름 64자, 설명 1,024자, 본문 100,000자, 지원 파일 1 MiB, 하위 디렉터리 허용 목록, 파일 수 500). 보관함 이동. 쓰기 경로 1~6단계 뼈대 | K2, K5, K6, K7 | M |
| K4 | 메모리 스토어: § 형식, 항목 ID, 한도 거절(`memory_full` detail), 파일 락, 원자 쓰기, 드리프트 판정과 `.bak`, 바깥 편집 `external` 기록, 첫 turn 스냅샷 블록, `read`·`add`·`replace`·`remove`·`manage`(batch 원자) | K1, K5, K6, K7 | M |
| K5 | 변경 원장과 롤백: 안전 캡처(manifest blob), `prepared`→`applied`/`aborted`, `request_id` 멱등 재응답, 시작 시 복구, `list`·`show`(diff)·`rollback`(`rollback_conflict`, `rollback_unsafe`) | K1, L0.store.plan의 `putBlob`·`scoped` | L |
| K6 | 쓰기 승인 게이트(행위자 × 연산 × 설정 표), `xeon.approvals` 요청과 결과 처리, `ApprovalEvidence` 유효성(`trustedEvidenceSources`, 소유 확장), 제안 대기열(`cap_knowledge_proposals`, `proposals`, `decide`, 만료, `stale`) | K1, K5, L1.tools.plan의 `ApprovalService` | M |
| K7 | 위협 패턴 검사: 규칙 표(지시 주입, 경계 표지, 유출, 비밀 형태, 숨은 문자, 숨은 지시, 우회 권유), `rulesetVersion`, 걸린 문자열 비노출, 마스킹 등록부 연결, `ledger.scan` | K1 | M |
| K8 | FTS5 trigram 프로브, 투영기 `cap.knowledge`(세션 목록, 세 테이블 DDL), 소비자 `cap.knowledge.fts`(pos 커서, 배치 500, `event_id` 멱등, 커서와 행 같은 트랜잭션, blob 자리표시 해석, NFC), 프로브 실패 시 비활성 | K1, L1.persistence.plan의 투영기 등록·전역 피드·`consumer_cursors` | L |
| K9 | 검색 질의 `query`(토큰화, MATCH/LIKE 분기, bm25·최신순, 종류 순 결합, 스니펫, scope, includeHidden), `scroll`, `read`, `list`, 스킬·메모리 docs FTS 재구성 | K2, K4, K8 | M |
| K10 | 설정 키 `l2.knowledge.*`(`L2.knowledge.spec` §6), 범위 제한(승인·스캔·경로는 managed, user), `checkSettingDef` 통과 테스트 | K1 | S |
| K11 | 인덱스 델타 알림: 세션별 마지막 `indexVersion`, `before_agent_start` 핸들러의 델타 메모, `session_start`·`session_shutdown` 정리 | K2, K3 | S |

순서: K1 → (K2, K5, K7, K10) → K6 → (K3, K4) → K8 → K9 → K11. 쓰기 도구 광고는 K3·K4 완료 시점에 켠다(그 전 커밋에서는 `tools` 배열에 정의가 있어도 `cap-knowledge` 매니페스트가 그 능력의 도구 노출을 끈 상태로 둔다 [가정: 능력 단위 도구 노출 끄기는 `L1.tools.spec`]).

### 3.1 구현 기록: KN.1 (K2, K5, K7, K10)

`m2/kn` 브랜치의 첫 구현(`m2-plan` KN.1)이다. 쓰기 승인 게이트와 제안 대기열(K6), 스킬·메모리 쓰기 연산(K3, K4), 검색(K8, K9), 델타 알림(K11)은 뒤 작업이다.

| 작업 | 상태 | 구현 위치와 범위 |
|---|---|---|
| K2 | 완료(후크 연결은 §3.5) | `upstream/skills.ts`(포크, 패치 KN-01~KN-09), `fs/`(포트, node 구현, 키별 직렬화), `skills/`(`roots`, `tree`, `document`, `store`, `index-update`, `reindex`, `service`, `prompt-block`, `paths`). `list`, `view`(지연 로딩, 바깥 편집 감지), `reindex`, 인덱스 블록 순수 함수와 `SkillsRuntime.indexBlock`. `before_agent_start` 연결은 K11이 한다(§3.5) |
| K5 | 완료(게이트 제외) | `ledger/`(`change` 실행기, `rows`, `manifest`, `target`, `rollback`, `recover`, `show`, `diff`, `service`). `prepared` → `applied`/`aborted`, `requestId` 멱등, 시작 시 복구, `list`·`show`·`rollback`. 롤백은 게이트(K6) 전까지 행위자 `user`만 허용한다. `proposals`는 빈 목록, `decide`는 `unsupported`다 |
| K7 | 완료 | `scan/rules.ts`(규칙 집합 `1.0.0`), `ledger.scan`, 마스킹 등록부(`Redactor.containsKnown`) 연결. 쓰기 경로에 거는 일은 K3, K4다 |
| K10 | 완료 | `settings.ts`: spec §6의 16개 키 전부, `readKnowledgeSettings`, `KNOWLEDGE_SETTING_DEFS` |

플러그인(`plugin.ts`, `manifest.ts`)은 `knowledge.skills`와 `knowledge.ledger`만 `provides`에 두고 `skill_view` 도구만 광고한다. `skill_manage`는 K3가 끝날 때까지 광고하지 않고 쓰기 메서드는 `unsupported`로 거부한다.

계획 §2 배치와 다른 점:

- 마이그레이션은 SQL 파일이 아니라 `src/migrations.ts`의 `MigrationSet`이다(`store.migrations.apply`가 SQL 배열을 받는다). 1단계는 `files`, `skills`, `ledger`이고 `proposals`(K6)와 문서 FTS(K8, K9)는 뒤 단계로 더한다.
- 시험 가짜는 `src/testing/`이 아니라 `test/support/`에 둔다(`memory-fs.ts`, `world.ts`, `clock.ts`, `helpers.ts`). `cap-workspace`와 같은 배치이고 배포 소스에 시험 코드가 들어가지 않는다.
- `skills/index.ts`와 `skills/validate.ts`는 만들지 않았다. 색인 읽기·쓰기는 `store.ts`와 `reindex.ts`, 구조 검증은 쓰기 연산(K3)과 함께 `validate.ts`로 온다.
- 원장 실행기는 새 내용(`next`)을 호출자가 미리 계산해 넘기는 모양이다(spec §4.4.1 4단계가 순수 계산이므로). K3, K4, K6의 쓰기 메서드는 이 실행기를 부른다.
- 테이블 DDL에 열을 더했다: `cap_knowledge_ledger.target_path`, `index_changed`, `cap_knowledge_skills.layout`(spec §3.8 반영).
- 프로세스 사이 파일 락은 `OsService`에 없어 임대와 락 안 해시 재확인으로 대신한다(spec §4.3.3 [결정: KN.1]). 그래서 `node-fs.int.test.ts`의 락 시험은 두 프로세스가 아니라 같은 프로세스 안의 직렬화를 확인한다.
- 프로젝트 스킬은 신뢰 판정 뒤에만 싣는다(M2 검토 4). `knowledgePlugin`의 `projectTrust(projectDir)` 옵션을 조립 루트가 `resolveProjectTrust`로 채운다. 아직 채우는 쪽이 없으므로 기본은 싣지 않음이다 [미결: 조립 루트(L4 host)가 옵션을 채울 때까지 프로젝트 스킬은 로드되지 않는다].
- 인덱스 블록 끝 안내문은 `knowledge_search`가 광고될 때만 그 도구를 안내한다(`SkillsDeps.searchToolAdvertised`, KN.2에서 켠다). 광고하지 않으면 예산 때문에 싣지 못했다는 문장만 남는다.
- `skill_view`의 에이전트 작성 스킬 경계(`<untrusted_session_content kind="skill" createdBy="agent">`)는 서비스의 `view`가 아니라 도구 렌더(`renderSkillView`, `toContent`)가 감싼다. `view`는 원문을 돌려준다.
- 원장 행을 읽을 때 열이 없거나 셀 타입이 다르면 `Bug`를 던지는 자리(`ledger/rows.ts` `textCell`, `intCell`)는 그대로다 [미결: 저장된 행 불일치는 `row_invalid` 값으로 돌려줘야 한다. `db.read` 콜백 안의 호출처가 많아 별도 작업으로 한다].
- 지원 파일 경로 규칙은 F에 `SkillFilePathSchema` 좁히기를 요청했다(spec §3.1). 그 전까지 `skills/paths.ts`가 같은 규칙을 지킨다.

### 3.2 구현 기록: KN.2 (K6)

`m2/webkn` 브랜치의 구현이다. 스킬·메모리 쓰기 연산(K3, K4)은 뒤 작업이라 대기열이 다시 실행하는 메서드 가운데 지금 동작하는 것은 `ledger.rollback`이다. 나머지 아홉은 `unsupported`를 돌려주는 자리만 있다.

| 작업 | 상태 | 구현 위치와 범위 |
|---|---|---|
| K6 게이트 | 완료 | `approval/gate.ts`(`decideGate` 순수 함수로 §4.5.1 표 전체, `isEvidenceValid`), `write/pipeline.ts`(`createWriter`: 멱등 확인 → 게이트 → 바로 적용·승인 요청·대기열 → 원장 실행기), `write/preview.ts`(미리보기 diff) |
| K6 승인 요청 | 완료 | `ports/approvals.ts`(`createWriteApprovals(ApprovalService)`: `open` 뒤 `wait`, 사람의 허용만 허용으로 센다), `plugin.ts`가 `ApprovalServicePortKey`를 선택 포트로 받아 연결한다 |
| K6 대기열 | 완료 | `approval/proposals.ts`(행 입출력, TY-24에 따라 맞지 않는 행은 `internal` 값), `approval/queue.ts`(`proposals`, `decide`, 만료), 마이그레이션 2단계 |
| K6 롤백 게이트 | 완료 | `ledger/rollback.ts`가 `planRollback`으로 계산만 하고 `ledger/service.ts`가 쓰기 경로에 태운다. KN.1의 "사용자만" 닫힌 실패를 걷었다 |

계획 §2 배치와 다른 점:

- `approval/evidence.ts`는 만들지 않았다. 증거 유효성은 순수 함수 하나(`isEvidenceValid`)라 `gate.ts`에 있다. `approval/queue.ts`는 `proposals.ts`(행)와 `queue.ts`(결정)로 나눴고, 쓰기 경로 본체는 `write/pipeline.ts`다.
- 승인 포트는 `ApprovalService`의 `open`·`wait`를 직접 쓰고 `L2ApprovalsPort`는 거치지 않는다. 쓰기 승인 하나는 kind `tool` 요청 하나이고 도메인 대상을 JSON으로 옮길 필요가 없어서다(spec §4.5.1). 같은 규칙의 기준 어댑터는 core-tools `testing/l2-port.ts`다.
- 대기열 DDL에 `target_scope`와 `preview`를 더했다(spec §3.8). 목록(`Proposal`)이 대상 범위와 미리보기를 돌려주기 때문이다. 미리보기는 제안할 때 만든 것을 저장한다(현재 내용 기준이지만 그 시점의 현재다).
- 승인한 제안은 제안한 행위자로 원장에 남고 `approved_by`는 `approval`이다(spec §4.5.2). `decide`는 호스트(사용자)만 부른다.
- 새 오류 코드 `proposal_closed`(`decide`의 선언 오류)를 `KnowledgeFailureKind`에 더했다.

시험:

| 파일 | 내용 |
|---|---|
| `gate.test.ts` | 게이트 표(행위자 × 파괴적 여부 × 설정), 세션 없음, `afterUntrusted`, 증거 유효성 |
| `approval.test.ts` | `files unchanged before approval`, 거부와 피드백, 승인 대기 중 바깥 편집은 `base_stale`, 같은 `requestId`는 한 번만 묻고 첫 결과를 돌려줌, `background destructive always queued`, 설정 끔, `after untrusted forces approval`, 비대화형·포트 없음은 대기열, 증거 유효성, 제안 생애(승인, 거절, `stale`, 만료, 닫힌 제안, 호스트만 결정) |
| `approval-service.int.test.ts` | 실제 `ApprovalService`(core-tools `fakeApprovals`) 위에서 요청 본문 모양, 허용·거부(피드백), 같은 `requestId`는 승인 요청 이벤트 하나, 기다림 취소는 요청을 남김 |

### 3.3 구현 기록: KN.3 (K3, K4)

`m2/webkn` 브랜치의 구현이다. 쓰기 도구 `skill_manage`와 `memory_manage`의 광고를 이 작업에서 켠다. 두 도구는 게이트와 원장을 거친 쓰기 경로(KN.2)가 있어야 켤 수 있으므로 KN.2 뒤에 둔다.

| 작업 | 상태 | 구현 위치와 범위 |
|---|---|---|
| K3 스킬 쓰기 | 완료 | `skills/write-model.ts`(`SKILL.md` 조합·분해, frontmatter 키 치환, 정확 일치 치환; 순수), `skills/write.ts`(create, edit, patch, writeFile, remove, manage와 승인된 제안 재실행). 연산마다 새 내용 계산 → 위협 검사 → `Writer`(게이트, 원장 실행기) |
| K3 구조 검증 | 완료 | 이름·설명·본문·지원 파일 1 MiB·파일 500개·허용 하위 디렉터리, 쓴 `SKILL.md`를 다시 읽어 설명이 같은지 확인 |
| K4 메모리 스토어 | 완료 | `memory/format.ts`(§ 형식, 항목 ID, 구조 판정; 순수), `memory/store.ts`(read, add, replace, remove, manage·batch, 스냅샷 블록, 바깥 편집·드리프트), `ledger/external.ts`(`external` 항목 기록). 마이그레이션 변경 없음 |
| 도구 광고 | 완료 | `plugin.ts`가 `skill_manage`와 `memory_manage`를 `risk: write`, `classes: [shared_state_write]`로 올린다. `knowledge.memory`를 `provides`와 서비스 키에 더했다 |

계획 §2 배치와 다른 점:

- `skills/validate.ts`는 `write-model.ts`(순수 계산)와 `write.ts`(검증과 흐름)로 나눴다. `memory/snapshot.ts`는 `store.ts`의 `snapshotBlock`이다. 첫 turn 기록 메시지로 넣는 연결(`before_agent_start`)은 K11(KN.5, §3.5)에서 했다.
- 쓰기 계산은 연산마다 `Built`(대상, 연산, 파괴적 여부, 현재·새 트리, 위협 검사 대상)를 내고, 공통 흐름이 검사와 `Writer`를 맡는다. 메모리는 같은 모양의 `Planned`(새 항목 목록)를 낸다.
- 새 오류 코드 `memory_full`, `drift_detected`, `duplicate_entry`(spec §3.3 선언 오류)를 `KnowledgeFailureKind`에 더했다.
- `KnowledgeDeps`에 `memoryDir`(`<사용자 데이터>/memory`)를 더했다. 조립은 `os.dirs.data`에서 만든다.
- `LedgerDeps`용 `ledger/external.ts`는 메모리의 바깥 편집만 쓴다. 스킬 재색인(`reindex.ts`)은 자기 트랜잭션 안에서 같은 항목을 만들어 그대로 두었다.

시험:

| 파일 | 내용 |
|---|---|
| `skill-write.test.ts` | 만들기와 frontmatter 모양, 따옴표·콜론·줄바꿈이 든 설명, 이름 충돌(색인에 없는 디렉터리 포함), 구조 한도, 파일 500개, 다른 frontmatter 키 보존, `patch_mismatch`, 순서대로 치환, `base_stale`, `writeFile`의 `baseHash`, 보관함 이동과 삭제 권한, 지원 파일 하나 지우기, `read_only_scope`, `manage` 분배, 증거·`overrideScan`의 호출자 검사, 프로젝트 범위 규칙, 에이전트 승인·거부·대기열·제안 승인(에이전트 표시 유지)·`stale`, `requestId` 멱등, 원장 왕복(스킬 다섯 연산) |
| `memory.test.ts` | 빈 저장소, 구분 줄 형식과 ID, NFC 중복, 구분 줄 모양 항목 거부, `memory_full`과 `detail.entries`, replace·remove의 `baseHash`, batch 원자성, 바깥 편집 기록, 드리프트 `.bak`(한 번), UTF-8·NUL·크기 초과, 처음 보는 파일, 동시 쓰기, 스냅샷 결정성과 표지 무력화, 메모리 끔, 에이전트 승인·대기열, 원장 왕복(메모리 네 연산) |
| `write-scan.test.ts` | 범주별 차단과 걸린 문자열 비노출, 경계 표지, 전체 파일 검사(경계에서 완성되는 구절), `scripts/` 엄격 규칙, 경고는 통과, 스킬 검사 설정은 메모리 검사에 영향 없음, `overrideScan`, 마스킹 등록부, 막힌 쓰기는 대기열에 들지 않음 |

### 3.4 구현 기록: KN.4 (K8, K9)

`m2/webkn` 브랜치의 구현이다. 실제 측정(개발자 세션 DB 사본의 trigram 인덱스 크기, 완료 기준 8)은 하지 않았다. 사용자 승인 뒤에 한다(m2-plan 결정 D11). 측정 전까지 인덱스 크기 값은 [가정]이다.

| 작업 | 상태 | 구현 위치와 범위 |
|---|---|---|
| K8 프로브 | 완료(방식 변경) | `search/probe.ts`(능력 판정: FTS5 + SQLite 3.34.0 이상), `search/setup.ts`(투영기 등록과 표 접근 확인으로 가용성 결정). 범위 핸들이 DDL을 허용하지 않아 `temp` 표 프로브는 하지 않는다(spec §4.8.5) |
| K8 투영기 | 완료 | `search/ddl.ts`(표 선언, FTS 가능 여부에 따라 버전 1 또는 1001), `search/projector.ts`(`thread.started`, `thread.updated`, `agent.spawned`, `item.recorded` → 세션 목록). 실제 `session.projectors.register`로 등록한다 |
| K8 소비자 | 완료 | `search/indexer.ts`(`session.subscribe` 구독, 배치 500, `hydrate`, 이벤트 `seq` 커서와 행을 한 트랜잭션, 실패하면 멈춤) |
| K9 질의 | 완료 | `search/query-model.ts`(정규화, 토큰, MATCH·LIKE 식, 스니펫; 순수), `search/service.ts`(`query`, `scroll`, `read`, `list`), `search/docs-index.ts`(스킬·메모리 문서 FTS: 쓰기와 같은 트랜잭션에서 갱신, 시작 때 재구성, FTS가 없으면 문서 목록을 LIKE로) |
| 도구 광고 | 완료 | `plugin.ts`가 `knowledge_search`, `session_scroll`, `session_read`를 `risk: read`로 올린다(검색을 끄고 시작하면 올리지 않는다). 올리면 스킬 인덱스 블록 끝 안내문이 `knowledge_search`를 가리킨다 |

계획 §2 배치와 다른 점:

- `search/indexer.ts`가 `projector.ts`와 소비자를 나눈다. 계획의 `search/probe.ts`(trigram 프로브)는 능력 판정으로, `search/query.ts`는 `query-model.ts`(순수)와 `service.ts`로 나눴다. `docs-index.ts`는 계획 위치 그대로다.
- 표 이름과 열은 spec §3.8 구현 메모를 따른다(`sessiondocs`, `sessionfts`, `docsfts`, `sessioncursor`, `thread_id`, `event_seq`).
- 마이그레이션(`CAP_KNOWLEDGE` 세션 밖 상태)은 바꾸지 않았다. 검색 표는 모두 투영기가 선언한다.
- 세션 포트는 `SessionService` 전체다 [결정: 통합 검토 L3]. 부분 구현을 걸러내는 덕 타이핑 검사(`isKnowledgeSessionPort`)와 `ports/session.ts`를 지웠다. `xeon.session`이 없으면(포트 미제공) 세션 검색 없이 시작하고, 있는데 완전한 `SessionService`가 아니면 플러그인 setup이 실패한다. 시험 호스트의 부분 구현(`RecordCommitPort` 대역)은 `without: ["records"]`로 빼고 완전한 세션(`createSessionKit`)이나 아무것도 주지 않는다.
- 투영기 이벤트 kind와 세션 종류 추론은 spec §4.8.1·§4.8.2에 적었다.

시험(모두 실제 SQLite와 실제 `core-persistence` 세션 서비스 위에서 돈다):

| 파일 | 내용 |
|---|---|
| `fts-indexer.test.ts` | 세션 행(제목, 프로젝트 해시, 메시지 수), 숨김 종류(`agent.spawned` 순서 두 가지), 텍스트만 색인, 색인하지 않는 이벤트에도 커서가 감, `idempotent on redelivery`, `cursor and rows in one transaction`(쓰기 도중 예외 주입), 세션 삭제, blob으로 옮겨진 긴 메시지 |
| `query.test.ts` | 질의 모델(토큰, 경로, MATCH·LIKE 식, 스니펫), `korean short query uses like`, `three char query uses fts`, `nfc normalization`, `bm25 then recency`, `fts special chars quoted`, LIKE 와일드카드 리터럴, 숨김·ID·시각·한도·프로젝트 범위, scroll·read·list, `kind order concatenation`, 쓰기와 같은 트랜잭션의 색인 갱신, 가려진 스킬 |
| `probe.test.ts` | 능력 판정 표, `probe failure disables session search`(FTS5 없음), `degraded: ["session"]`와 스킬·메모리 LIKE 대체, 세션 서비스 없이 시작 |
| `fts-trigram.int.test.ts` | 실제 `bun:sqlite`에서 3글자 MATCH, 2글자 0건, 대소문자 무시, 조사 앞뒤 일치, bm25 순서 |
| `plugin.test.ts` | 세션 서비스가 있을 때 투영기 등록·색인·검색·목록이 플러그인 경로로 동작, 없을 때 `unavailable`, 부분 `xeon.session`이면 setup 실패 |

완료 기준 9(macOS FTS5·trigram 확인)는 이 기기에서 할 수 없다. `desktop-macos` CI job이나 실기에서 `fts-trigram.int.test.ts`를 한 번 돌려 기록한다.

### 3.5 구현 기록: KN.5 (K11)

`m2/webkn` 브랜치의 구현이다. 확장 지점 세 개(`session_start`, `before_agent_start`, `session_shutdown`)를 매니페스트 `points`에 올렸다.

| 작업 | 상태 | 구현 위치와 범위 |
|---|---|---|
| K11 델타 | 완료 | `skills/delta.ts`(`diffIndex`, `formatIndexDelta`; 순수), `SkillsRuntime.indexSnapshot`(모델에게 보이는 스킬의 이름 → 잘린 설명과 `indexVersion`), `turn-context.ts`(세션별 상태, 첫 turn 메시지, 델타 메모) |
| 첫 turn 연결 | 완료 | 인덱스 블록(K2)과 메모리 스냅샷(K4)을 `customType: "knowledge.context"` 기록 메시지 하나로 더한다. 시스템 프롬프트는 바꾸지 않는다 |
| 후크 | 완료 | `plugin.ts`가 세 지점에 거는 핸들러가 `turn-context.ts`를 부른다. `startup` 말고 시작하는 세션은 `session_start`에서 스킬 루트를 다시 훑는다 |

계획 §2 배치와 다른 점:

- 델타 계산은 `skills/delta.ts`에, 후크 연결과 세션 상태는 `turn-context.ts`에 두었다. 순수 계산과 상태를 나누려는 배치다.
- `session_start`의 mtime 검사는 하지 않고 전체 재색인을 한다. 재색인 비용(스킬 수에 비례)은 측정 전이라 [가정]이다.
- 상태는 프로세스 메모리에만 있다. 재시작 뒤 이어받은 세션은 현재 인덱스를 기준으로 시작한다(spec §4.2.6).
- `L1.context`가 같은 블록을 시스템 프롬프트 쪽에 넣기로 정하면 이 메시지는 `HOST.6` 조립에서 끈다. 두 곳에 들어가지 않게 하는 일은 `L1.context.spec`과 조립이 맡는다.

시험:

| 파일 | 내용 |
|---|---|
| `delta.test.ts` | 비교와 문장(정렬, 10개 상한, 60자 설명), 첫 turn 메시지, `index delta next turn`(추가·변경·삭제가 다음 turn 메모 하나, 같은 변경은 한 번만), 본문만 바꾼 변경은 메모 없음, 모델 호출 여부 전환, 세션 독립과 `shutdown`, 재개한 세션, `startup` 말고는 재색인, 스킬·메모리를 끄면 메시지 없음 |
| `plugin.test.ts` | 후크 경로: `session_start` → 첫 turn 블록 → 변경 뒤 델타 → `session_shutdown` 뒤 첫 turn으로 돌아감. 매니페스트 `points`. `session_compact` 뒤 다음 turn에 인덱스 블록과 메모리 스냅샷이 현재 인덱스로 다시 들어가고 다른 대화는 그대로(G2-01, spec §4.2.8). 대화의 작업 폴더가 프로젝트 폴더: 대화마다 자기 작업 폴더의 프로젝트 스킬만 보이고 신뢰도 그 폴더로 묻는다, 작업 폴더가 없는 대화는 프로젝트 스킬이 없다, 작업 폴더를 오가도 원장에 `external` 항목이 늘지 않는다, 신뢰하지 않은 작업 폴더의 스킬은 싣지 않는다, 대화 안에서 쓴 프로젝트 스킬은 그 대화의 작업 폴더에 만들어진다(G2-02, spec §4.2.1) |

## 4. 채택 코드

### 4.1 포크: pi `core/skills.ts`

| 항목 | 값 |
|---|---|
| 원본 경로 | `~/projects/_ref/pi-src/packages/coding-agent/src/core/skills.ts` (514줄) |
| 원본 패키지 | `@earendil-works/pi-coding-agent` 1.1.0(로컬 소스, 커밋 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`, 2026-10-11). 계약 대상 npm 1.3.0과 이 파일의 차이는 확인하지 않았다 [가정: 같다. K2 착수 때 npm tarball과 diff한다] |
| 라이선스 | MIT(`packages/coding-agent/package.json` license). `LICENSE.pi`로 고지를 유지한다 |
| 포크 위치 | `xeon/packages/cap-knowledge/src/upstream/skills.ts` |
| 그대로 두는 부분 | 탐색 규칙(`loadSkillsFromDirInternal`: SKILL.md 루트에서 멈춤, 점·`node_modules` 건너뜀, 심볼릭 링크 추적), `validateName`, `validateDescription`, 실제 경로 중복 제거, 이름 충돌 진단, `escapeXml` |

바꿀 점(`XEON-PATCH` 표지, `PATCHES.md`에 같은 id로 기록):

| 패치 id | 원본 결합 | 바꾸는 방식 |
|---|---|---|
| `KN-01 config` | `import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts"`(skills.ts:4, config.ts:581·605) | 함수 인자 `SkillRoots { project?: string; user: string; extension: readonly { dir: string; extension: string }[]; paths: readonly string[] }`로 받는다. 경로는 `skills/roots.ts`가 `xeon.os`에서 만든다 |
| `KN-02 frontmatter` | `import { parseFrontmatter } from "../utils/frontmatter.ts"`(yaml 2.9.0 의존) | 같은 경계 규칙(`---` 줄, BOM 제거, 줄바꿈 정규화)의 40줄 함수를 포크 안에 옮기고, YAML 파싱은 `Bun.YAML.parse`로 바꾼다(`bun-types` 1.4.3 `bun.d.ts:1494` `namespace YAML`). 결과가 일반 객체가 아니거나 순환이면(같은 줄 주석: 별칭이 순환을 만들 수 있음) frontmatter 오류로 본다 |
| `KN-03 paths` | `import { canonicalizePath, resolvePath } from "../utils/paths.ts"`(paths.ts:28, 103) | `KnowledgeFs.realpath`와 `node:path`의 `resolve`로 바꾼다. 동기 `fs` 호출(`existsSync`, `readdirSync`, `readFileSync`, `statSync`)은 `KnowledgeFs` 비동기 포트로 바꾼다. 테스트에서 메모리 가짜를 쓰기 위해서다 |
| `KN-04 ignore` | `import ignore from "ignore"`(7.0.8), `addIgnoreRules` | 제거한다. 스킬 루트에 `.gitignore` 계열 규칙을 적용하지 않는다(`L2.knowledge.spec` §4.2.1, §10 미결 10) |
| `KN-05 types` | `ResourceDiagnostic`(./diagnostics.ts), `SourceInfo`, `createSyntheticSourceInfo`(./source-info.ts) | 로컬 타입 `SkillDiagnostic`, `SkillSource { scope; root; extension? }`로 바꾼다 |
| `KN-06 prompt` | `formatSkillsForPrompt`(읽기 도구 안내와 `<location>`) | 쓰지 않고 `skills/prompt-block.ts`가 대신한다(예산, `skill_view` 안내, `<location>` 없음). 원본 함수는 포크에서 지운다 |
| `KN-07 root order` | `loadSkills`의 사용자 → 프로젝트 순서 | 프로젝트 → 사용자 → 확장 → 경로 순으로 바꾼다(`L2.knowledge.spec` §4.2.1) |

- `_research/packages.md` §4.4 L2-d는 결합을 "config·frontmatter·paths·ignore"로 적었다. 이 계획은 앞의 셋을 결합 해소(KN-01~03)로, `ignore`는 제거(KN-04)로 처리한다.
- `UPSTREAM.json`: `upstream: "pi-mono"`, `commit`, `version: "1.1.0"`, `license: "MIT"`, `copiedPaths: { "packages/coding-agent/src/core/skills.ts": "src/upstream/skills.ts" }`, `notCopied: ["utils/frontmatter.ts", "utils/paths.ts", "config.ts", "diagnostics.ts", "source-info.ts"]`, `modifications: ["KN-01", …, "KN-09"]`(ADR-0003 §3.4 형식). 구현 중 KN-08(항목 순서 고정과 병렬 처리)과 KN-09(심볼릭 링크 순환·깊이 방어)를 더했다.

### 4.2 그대로 쓰는 것과 쓰지 않는 것

| 대상 | 판정 | 비고 |
|---|---|---|
| `bun:sqlite` FTS5 | 간접 사용 | `platform-store`가 소유한다(DR-07). macOS에서 FTS5가 든 SQLite를 `Database.setCustomSQLite`로 지정하는 일도 `platform-store`의 시작 검사다(ADR-0004 §3.5). 이 패키지는 자기 trigram 프로브만 한다(`L2.knowledge.spec` §4.8.5) |
| 외부 npm 패키지 | 없음 | 새 의존을 들이지 않는다. 포크 원본의 `yaml` 2.9.0과 `ignore` 7.0.8은 KN-02, KN-04로 없앤다 |
| Hermes 원장(`tools/skill_ledger.py`)과 메모리 스토어(`tools/memory_tool_store.py`) | 설계 이식, 재작성 | Python 코드라 그대로 가져올 수 없다. JSONL + 내용 주소 blob 원장을 `cap_knowledge_ledger` + `sys_blobs`로, § 항목·파일 락·드리프트 `.bak`·한도 거절을 TypeScript로 새로 쓴다(`_research/refs/hermes.md` §4.1, §4.2). MIT 고지 대상 코드는 없다 |
| Hermes 세션 검색(`hermes_state_fts.py`) | 설계 참고 | 네 형태(발견, 스크롤, 읽기, 목록)와 숨김 규칙만 가져온다(`_research/refs/hermes.md` §3.10.2) |
| omp `manage_skill`, mnemopi | 참고하지 않음 | `_research/packages.md` §4.4 L2-d 후보지만 이 계획은 Hermes 설계로 충분하다 |

## 5. 단위 테스트 목록

방침: `eng.testing.guide` TS-01(단위 우선), TS-03(시계·ID 주입), TS-05(가짜 포트). 단위 테스트는 인메모리 SQLite(`@xeon/platform-store/testing`의 `openTestStore(":memory:")`), 이벤트 픽스처(`src/testing/event-fixtures.ts`), 메모리 파일 가짜(`src/testing/memory-fs.ts`)만 쓴다. 실제 파일 시스템을 쓰는 검사는 `int` 태그 하나로 둔다.

| 파일 | 테스트 이름 | 확인할 동작 |
|---|---|---|
| `test/defs.test.ts` | `four knowledge capabilities validate with zero issues` | 네 정의 `validateCapability` 0건, 집합 `validateCapabilitySet` 0건 |
| 같음 | `write tool params exclude approval and overrideScan` | `skill_manage`, `memory_manage` 파라미터에 두 필드가 없음 |
| `test/upstream-skills.test.ts` | `discovery rules match pi` | 픽스처 트리에서 SKILL.md 루트 정지, 점·`node_modules` 건너뜀, 루트 `.md` 처리, 이름 검증 경고가 pi 원본 규칙과 같음 |
| 같음 | `frontmatter parse via Bun.YAML` | BOM·CRLF 처리, 순환 별칭 frontmatter는 오류 진단 |
| 같음 | `root order project first` | 같은 이름이 프로젝트·사용자에 있으면 프로젝트가 이기고 `collision` 진단 |
| `test/skill-index.test.ts` | `index budget` | 예산을 넘는 스킬 집합에서 정해진 순서로 넣고 "외 N개" 문구, 같은 집합은 같은 블록(바이트 동일) |
| 같음 | `description truncation` | 설명이 `indexDescriptionChars`에서 잘리고 `…` |
| 같음 | `disable model invocation hidden` | `modelInvocable=false` 스킬이 블록에 없음 |
| 같음 | `lazy body loading` | `list`와 블록 생성 중 SKILL.md 본문 읽기 0(메모리 FS 읽기 기록), `view` 때만 읽음 |
| 같음 | `tree hash stable` | 파일 순서와 무관하게 같은 해시, 내용 한 바이트 변경 시 다른 해시 |
| `test/skill-write.test.ts` | `structure limits` | 이름 65자, 설명 1,025자, 본문 100,001자, 지원 파일 1 MiB+1, 허용 밖 하위 디렉터리 → 각각 거부 |
| 같음 | `patch exact match` | `oldText` 0회·2회 → `patch_mismatch` |
| 같음 | `base stale` | 옛 `baseHash` → `base_stale`, 파일 불변 |
| 같음 | `remove archives by default` | `remove`가 `.archive/<이름>-<시각>/`로 옮김. 행위자 agent의 `delete`는 `invalid_input` |
| 같음 | `read only scope` | 확장 제공 스킬 쓰기 → `read_only_scope` |
| `test/memory.test.ts` | `limit exceeded rejected with entries` | 한도 초과 `add` → `memory_full`, `detail.entries`에 현재 항목, 파일 불변 |
| 같음 | `batch is atomic` | remove + add batch에서 add가 한도 초과면 둘 다 반영 안 됨 |
| 같음 | `entry id and duplicate` | 같은 텍스트 두 번 → `duplicate_entry`, NFC/NFD 같은 텍스트는 같은 ID |
| 같음 | `external edit drift bak` | 메모리 가짜 FS에서 `§` 구조를 깨뜨리면 다음 쓰기 `drift_detected`, `.bak/` 사본 하나, 읽기는 `writeBlocked: true` |
| 같음 | `valid external edit recorded` | 구조 정상 바깥 편집 → 원장 `external` 행, 옛 `baseHash` 쓰기는 `base_stale` |
| 같음 | `lock serializes writers` | 동시에 두 `add` → 둘 다 반영, 파일 손상 없음 |
| 같음 | `snapshot block deterministic` | 같은 파일 내용 → 같은 스냅샷 블록, 항목 ID·`fileHash`·한도 포함 |
| `test/approval.test.ts` | `files unchanged before approval` | 기본 설정에서 agent(main) 쓰기: 가짜 승인 대기 중 파일 불변, 거부 → `approval_denied`·불변, 승인 → 적용 |
| 같음 | `gate table` | 행위자(user, extension+증거, extension 무증거 세션 유무, agent main/subagent/background) × 연산(비파괴/파괴) × 설정(on/off) 표 전체가 §4.5.1과 같음 |
| 같음 | `background destructive always queued` | 설정 off에서도 background의 `replace`·`remove`는 `queued` |
| 같음 | `after untrusted forces approval` | 설정 off, `afterUntrusted = true` main 쓰기 → 승인 요청 |
| 같음 | `evidence validity` | 설정에 `"test-group.queue"`를 넣으면 `test-group` 확장의 증거는 유효, 다른 확장이 같은 source를 쓰면 무효, 기본값 `[]`에서는 모두 무효 |
| 같음 | `proposal lifecycle` | `queued` → `decide(approve)` 적용·원장 `proposal_id`, `reject`는 불변, 대상 변경 뒤 승인은 `stale`, 수동 시계 14일 뒤 `expired` |
| `test/ledger.test.ts` | `ledger round trip` | 스킬 다섯 연산·메모리 네 연산마다 원장 `applied` 행(행위자 포함), 각 행 `rollback` 뒤 해시가 `before_hash`, 되돌림도 원장에 남음 |
| 같음 | `rollback refused when safe capture fails` | 메모리 FS 가짜의 캡처 읽기 실패 주입 → `rollback_unsafe`, 파일 불변 |
| 같음 | `write refused when safe capture fails` | 같은 주입으로 일반 쓰기 → `internal`, 원장 `prepared` 행 없음 |
| 같음 | `rollback conflict` | 대상 뒤에 다른 변경이 있으면 `rollback_conflict` |
| 같음 | `idempotent request id` | 같은 `requestId` 두 번 → 같은 `WriteOutcome`, 원장 행 하나 |
| 같음 | `recover prepared rows` | 8단계 뒤·10단계 전 중단을 흉내 낸 `prepared` 행: 파일 해시가 after면 `applied`, before면 `aborted` |
| `test/scan.test.ts` | `injection patterns rejected` | 규칙 범주마다 예시 텍스트 → 스킬·메모리 쓰기 `scan_blocked`, 결과·오류·원장에 걸린 문자열 없음 |
| 같음 | `boundary tag in skill body` | 본문의 `</untrusted_web_content>` → block |
| 같음 | `memory scan cannot be disabled` | `write.scan = false`에서도 메모리의 `sk-…` 키 형태 → block |
| 같음 | `warn does not block` | warn 규칙만 걸리면 적용되고 원장 `scan`에 규칙 이름 |
| `test/fts-indexer.test.ts` | `idempotent on redelivery` | 같은 이벤트 배치 두 번 → docs·FTS 행 수 같음 |
| 같음 | `cursor and rows in one transaction` | `@xeon/platform-store/testing` 고장 주입(`before_commit`) → 커서·행 모두 반영 안 됨, 재시작 뒤 같은 배치 처리 |
| 같음 | `session delete removes index` | 투영기 DDL 선언 테이블의 세션 행 삭제를 흉내 냄 → 그 세션의 sessions·docs·FTS 행 0 |
| 같음 | `hidden kinds` | cron·subagent·background 세션 메시지는 기본 `query`에 없고 `includeHidden`에서 보임 |
| 같음 | `tool results not indexed` | 도구 결과·thinking 파트는 색인 0 |
| `test/query.test.ts` | `korean short query uses like` | `검색` → `path: "like"`로 `검색을` 메시지를 찾음 |
| 같음 | `three char query uses fts` | `검색을` → `path: "fts"` |
| 같음 | `nfc normalization` | NFD 저장 텍스트를 NFC 질의로 찾음 |
| 같음 | `bm25 then recency` | 같은 점수면 최신 메시지가 앞 |
| 같음 | `kind order concatenation` | skill → memory → session 순 |
| 같음 | `fts special chars quoted` | `"`, `*`, `:` 든 질의가 문법 오류 없이 동작 |
| `test/probe.test.ts` | `probe failure disables session search` | trigram 생성이 실패하도록 한 가짜 store → 시작 성공, 세션만 요청 `unavailable`, 기본 질의 `degraded: ["session"]` |
| `test/delta.test.ts` | `index delta next turn` | 스킬 추가·설명 변경·삭제 뒤 다음 turn 델타 메모 1개, 본문만 바꾼 변경은 메모 없음 |
| | `after a compaction the next turn re-adds the index block and memory snapshot once…` | `afterCompaction` 뒤 다음 turn은 델타가 아닌 전체 블록과 메모리 스냅샷이고 그다음 turn은 비어 있다(G2-01) |
| `test/settings.test.ts` | `knowledge settings pass checkSettingDef` | 키 집합이 spec §6 표와 같고 승인·스캔·경로 키의 `allowedScopes`가 `managed`, `user`뿐 |

`int` 태그:

| 파일 | 테스트 | verify |
|---|---|---|
| `test/node-fs.int.test.ts` | 실제 임시 디렉터리(`@xeon/platform-os/testing` `tempDir`)에서 원자 쓰기(임시 파일 → rename), 락 두 프로세스 직렬화, 보관함 이동 | 넣는다(10초 이하) |
| `test/fts-trigram.int.test.ts` | 실제 `bun:sqlite`(임시 파일 DB)에서 trigram 테이블 생성, bm25 정렬, 2글자 MATCH 0건 확인 | 넣는다 |

## 6. 완료 기준

M2 종료 조건에는 knowledge의 직접 항목이 없다(`product.scope.spec` §4.4 M2). 그래서 이 계획이 정한다 [제안].

spec §9 수용 기준과 테스트의 대응:

| spec §9 | 테스트 파일 · 이름 |
|---|---|
| 1 | `test/approval.test.ts` · `files unchanged before approval`, `proposal lifecycle` |
| 2 | `test/ledger.test.ts` · `ledger round trip` |
| 3 | `test/fts-indexer.test.ts` · `idempotent on redelivery`, `cursor and rows in one transaction` |
| 4 | `test/memory.test.ts` · `limit exceeded rejected with entries` |
| 5 | `test/defs.test.ts` · `four knowledge capabilities validate with zero issues` |
| 6 | 테스트 그룹 호출 테스트(아래 4항)와 `check-layers.ts` DR-02·DR-14 검사 |
| 7 | `test/approval.test.ts` · `background destructive always queued` |
| 8 | `test/query.test.ts` · `korean short query uses like`, `three char query uses fts`, `nfc normalization` |
| 9 | `test/probe.test.ts` · `probe failure disables session search` |
| 10 | `test/ledger.test.ts` · `rollback refused when safe capture fails`, `write refused when safe capture fails` |
| 11 | `test/memory.test.ts` · `external edit drift bak` |
| 12 | `test/scan.test.ts` · `injection patterns rejected` |
| 13 | `test/fts-indexer.test.ts` · `session delete removes index` |


1. 승인 전 불변: `L2.knowledge.spec` §9 수용 기준 1, 7이 단위 테스트(`approval.test.ts`)로 통과한다.
2. 원장 롤백: 수용 기준 2, 10이 통과한다(`ledger.test.ts`).
3. FTS 멱등: 수용 기준 3, 13이 통과한다(`fts-indexer.test.ts`).
4. 학습 그룹 대비: 테스트 그룹이 `KnowledgeSkillsKey`, `KnowledgeMemoryKey`, `KnowledgeSearchKey`, `KnowledgeLedgerKey`를 `cap-knowledge` import 없이 호출하고, `ApprovalEvidence`를 단 적용과 `requestId` 멱등을 확인한다(수용 기준 6).
5. 네 정의 `validateCapability` 이슈 0건(수용 기준 5).
6. 위 표의 나머지 수용 기준 4, 8, 9, 11, 12가 표의 테스트로 통과한다.
7. `cd xeon && just verify` 종료코드 0.
8. 실제 대화 코퍼스(개발자 세션 DB 사본, 사람 확인 뒤 레시피 `just knowledge-fts-measure --yes`)로 trigram 인덱스 크기를 재고 결과를 이 계획 §7 위험 표에 기록한다(`_research/notes/L2-3.md` §6 완료 기준 초안).
9. macOS에서 `fts-trigram.int.test.ts`를 한 번 돌려 FTS5·trigram 포함 여부를 기록한다(`L2.knowledge.spec` §10 미결 15).

## 7. 위험과 대응

| 위험 | 영향 | 대응 | 근거 |
|---|---|---|---|
| FTS5 또는 trigram이 없는 SQLite 빌드(macOS 시스템 SQLite 미확인) | 세션 검색 불가 | 자기 trigram 프로브로 판정하고 세션 검색만 끈다. 스킬·메모리는 LIKE. `platform-store`의 `setCustomSQLite` 경로 안내를 진단에 남긴다 | `_research/notes/L2-3.md` §2.2, ADR-0004 §3.5·§6 |
| 한국어 토큰화 품질 | trigram은 2글자 질의를 MATCH로 못 찾고 형태소 분석이 없다 | 3글자 미만 LIKE 경로, NFC 정규화, 구절 따옴표. 실제 질의 로그로 재현율을 본다 | `_research/notes/L2-3.md` §3 |
| trigram 인덱스 크기(합성 데이터 약 3배) | DB 크기 증가 | 실제 코퍼스 측정(완료 기준 8), 필요하면 외부 콘텐츠 테이블(2차) | `_research/notes/L2-3.md` §3.2 |
| 원장 blob 증가 | 스킬 본문 변경마다 전후 blob이 쌓임 | 내용 주소로 같은 내용은 한 번만 저장. 보존 기간과 정리 정책은 [미결](`L2.knowledge.spec` §10 미결 6). 원장 blob 총량을 L4 진단에 보인다 | `_research/refs/hermes.md` §3.10.1 (라) |
| 정본 파일과 DB 색인 불일치(바깥 편집, 크래시) | 오래된 인덱스, 잘못된 `base_stale` | 시작 시 복구와 재색인, `view`의 해시 재확인, 재색인 명령(`skills.reindex`, L4 명령) | `L2.knowledge.spec` §4.3.5, §4.4.3 |
| 스킬 인덱스 비대화 | 매 세션 컨텍스트 비용 증가 | 인덱스 예산과 설명 자르기, 초과분은 검색 안내. 큐레이터(학습 그룹 2차)가 정리 | `_research/refs/hermes.md` §3.10.1 (바) |
| pi `skills.ts` 포크와 upstream 차이 | 규격 변경을 놓침 | `UPSTREAM.json` 커밋 고정, pi 업그레이드 때 diff 검토, 탐색 규칙 회귀 테스트 | ADR-0003 §4 |
| `Bun.YAML.parse` 결과의 순환 객체 | frontmatter 처리 중 무한 순회 | 일반 객체 검사와 순환 검출 뒤 오류 진단 | `bun-types` 1.4.3 `bun.d.ts:1494` 주석 |
| 승인 창 이중화(L1.tools 일반 승인 + 이 능력 게이트) | 사용자 피로 | 쓰기 도구의 일반 승인 기본 `allow` 요청(`L2.knowledge.spec` §10 미결 5) | `L2.knowledge.spec` §3.6 |
| 위협 패턴 규칙의 오탐 | 정상 스킬 쓰기 거부 | 사용자 행위자는 `overrideScan`으로 경고로 낮출 수 있음. 규칙 집합 버전 관리와 회귀 예시 테스트 | `L2.knowledge.spec` §4.6 |
| 두 제안 대기열(knowledge, learning) | 사용자 혼란 | 학습 그룹 제안은 증거로 바로 적용하고 이 대기열에는 에이전트 직접 쓰기만 둔다. 통합 여부는 [미결] | `L2.knowledge.spec` §10 미결 3 |
| `consumer_cursors`·투영기 선언 테이블에 대한 저장소 권한 가정 | K8 구현 막힘 | K8 착수 전 `L0.store.plan`, `L1.persistence.plan`과 확인. 막히면 FTS 테이블을 세션 밖 상태로 두고 세션 삭제 이벤트 구독으로 지운다 | `L2.knowledge.spec` §3.8, §8 |
