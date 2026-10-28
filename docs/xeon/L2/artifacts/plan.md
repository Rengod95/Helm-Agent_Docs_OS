---
id: L2.artifacts.plan
layer: L2
domain: artifacts
kind: plan
status: draft
depends_on: [L2.artifacts.spec, F.capabilities.plan, F.records.plan, L0.store.plan, L1.persistence.plan]
binds: [xeon/packages/cap-artifacts/**]
---

# L2 산출물과 세션 구현 계획 (artifacts)

`L2.artifacts.spec`을 `xeon/packages/cap-artifacts`(`@xeon/cap-artifacts`)와 F 정의 파일로 옮기는 계획이다. 절 번호(§)는 따로 적지 않으면 그 스펙의 것이다.

## 1. 목표와 마일스톤 배치

마일스톤 정의는 `product.scope.spec` §4.3을 따른다. M0·M1은 [결정: `_research/foundation-plan.md` §5 P4], M2·M3 배치는 [제안]이다.

계획 v2의 단계 표기(`_research/layer-plan-v2.json` L2-g)는 다음과 같다. 산출물 등록과 미리보기, 리뷰와 diff 승인, 세션 제목과 메타는 1차다. 세션 핸드오프와 내보내기는 2차, 공유 링크는 보류다. `product.scope.spec` §4.3 M3 행이 "나머지 1차 구성요소(`cap-artifacts` 등)"를 M3에 두므로 1차 항목은 M3에 만든다.

### 1.1 M0·M1

- 이 패키지의 구현 작업은 없다. 스캐폴드(`package.json`, `src/index.ts`, `test/smoke.test.ts`)는 P0에서 이미 있다.
- 선행 조건(다른 계획의 산출물):
  - `@xeon/contracts`의 `capabilities`(`defineCapability`, `validateCapability`), `records`(`BlobRef`, `CatalogEntry`, `Projector`), `conversation`(ID 스키마) M0 범위(`F.capabilities.plan`, `F.records.plan`).
  - `platform-store`의 blob API와 `openTestStore`(`L0.store.plan`).
  - `core-persistence`의 `SessionWriter.commit`, 투영기 등록, `expectProjectionsRebuildable`(`L1.persistence.plan`).

### 1.2 M2: 최소 registry를 당길지 [제안 비교]

`work.plans`(M2, `cap-work`)는 제출된 계획의 각 판을 `artifacts.registry`에 등록한다(`L2.work.spec` §4.2.4). 이 의존은 선택(`optional`)이다(`L2.readme` §6). 그래서 artifacts가 없어도 `work.plans`는 동작한다. 두 안을 비교한다.

| 안 | M2에 넣는 것 | 장점 | 단점 |
|---|---|---|---|
| 1. 당기지 않음 | A1(F 정의·카탈로그)만 | M2 범위가 늘지 않는다. `cap-work`는 정의(`ArtifactsRegistryKey`)로 컴파일되고, 실행 때 provider가 없으면 등록을 건너뛴다 | M2의 Helm 탐구에서 계획이 산출물 목록에 보이지 않는다. M3에 기존 계획을 소급 등록하는 경로가 없다 |
| 2. 최소 registry | A1 + A2 + A3(`register`, `update`, `get`, `list`. 도구·리뷰·세션 메타 없음) | M2부터 계획·탐구 노트가 산출물로 남는다. M3에서 투영 재생성 없이 이어진다 | M2 작업 3개가 늘어난다. 산출물 화면(L4)이 M3라 M2에서는 등록만 되고 볼 곳이 서비스 API뿐이다 |

- [제안] 안 1을 기본으로 한다. 다만 `L2.work.plan`이 M2 완료 기준에 "계획이 산출물로 등록된다"를 넣으면 안 2로 바꾼다. 어느 쪽이든 A1은 M2에 둔다. `cap-work`와 Helm이 정의를 참조해 컴파일되어야 하기 때문이다.
- 안 2를 택해도 이벤트 모양과 투영 버전은 M3와 같다. M2에 쓴 `artifact.registered`는 M3 코드가 그대로 읽는다.

### 1.3 M3: 1차

- registry 전체(도구 `artifact_create`, `artifact_update` 포함), 투영과 재생성 검증.
- reviews 전체(diff 수집, hunk 모델, 승인 답 반영, 코멘트 전달, 거절 적용). 거절 적용 경로(spec §4.2.5 [미결])가 M3 착수 전에 정해져야 한다. 정해지지 않으면 A8만 M3 이후로 미루고 거절은 "기록만 하고 파일은 바꾸지 않음"(`method: "none"`, `result: "skipped"`)으로 낸다.
- sessions의 `setMeta`, `list`, `search`, 자동 제목, 라벨.
- 설정 키(1차 키).

### 1.4 M3 이후(2차)

- A11 핸드오프, A12 Markdown·HTML 내보내기, 도구 `handoff`.
- 공유 링크: 보류(spec §4.6). 작업 항목을 두지 않는다.

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/src/
  capabilities/defs/artifacts.ts        # A1. 정의 3개와 공통 스키마(spec §3.1~§3.4), ReviewAnswerSchema
  records/catalog/artifacts.ts          # A1. ARTIFACT_EVENT_CATALOG, payload 스키마(spec §3.6)

xeon/packages/cap-artifacts/
  package.json             # exports ".", "./testing". xeon { layer: "L2", domain: "artifacts" }
  tsconfig.json
  src/
    index.ts               # 플러그인 진입: 매니페스트, provider 등록, 투영기 등록, 설정 그룹
    manifest.ts            # provides 3개, optional [workspace.files], usesPost: false(xeon.tasks 경유)
    settings.ts            # defineSettings("l2.artifacts", …)  (A13)
    context.ts             # CallContext 해석(spec §3.5), requestId 파생 도우미
    registry/
      model.ts             # kind 판정, 메타 검사(16 KiB), 미리보기 메타 계산(lines, rows, columns)  (A2)
      content.ts           # inline/blob/file → BlobRef  (A3)
      service.ts           # register, update, list, get, archive  (A2, A3)
      tools.ts             # artifact_create, artifact_update 어댑터 확인용(정의는 F)  (A4)
      retention.ts         # 보관 기한 판정(순수)  (A2)
    reviews/
      collect.ts           # turn/toolCalls/checkpoint/patch → 원시 diff 목록  (A5)
      unified-diff.ts      # 통합 diff 해석·정규화·hunk ID·patchSha256  (A5)
      model.ts             # hunk 상태 머신, 라운드 규칙(순수)  (A6)
      answer.ts            # ReviewAnswer → 결정·코멘트 이벤트 초안(순수)  (A6)
      deliver.ts           # 전달 본문 렌더(순수), post 호출, requestId  (A7)
      revert.ts            # 역패치 계산(순수)과 적용 포트  (A8)
      service.ts           # open, get, approve, reject, comment, submit, close
    sessions/
      meta.ts              # 라벨 정규화·집합 연산(순수)  (A10)
      title.ts             # 자동 제목 프롬프트·후처리(순수), agent_settled 핸들러  (A9)
      service.ts           # setMeta, list, search
    handoff/
      package.ts           # HandoffPackage 조립(순수)  (A11, 2차)
      service.ts           # handoff
    export/
      markdown.ts          # 이벤트 → Markdown(순수)  (A12, 2차)
      html.ts              # Markdown → 단일 HTML(순수)  (A12, 2차)
      filter.ts            # Source.usage.cache 필터(순수)  (A12, 2차)
    projection/
      ddl.ts               # cap_artifacts_* DDL(spec §3.7)  (A3)
      projector.ts         # Projector "cap.artifacts" apply  (A3)
      queries.ts           # 목록·커서·검색 SELECT  (A3, A10)
    testing/
      index.ts             # fakeArtifactsDeps(가짜 session·tasks·approvals·models 포트), 샘플 diff
  test/
    *.test.ts              # §5 목록
```

- 같은 층 패키지(`cap-workspace`, `cap-work`)를 import하지 않는다(DR-02). workspace 결과 `details`는 F 타입(있으면) 또는 이 패키지의 로컬 스키마로 읽는다.
- `src/testing/`은 다른 패키지가 테스트에서만 import한다(`eng.testing.guide` TS-06).

## 3. 작업 분해

규모: S(1일 이하), M(2~3일), L(4일 이상). 단계는 §1의 배치다.

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| A1 | F `defs/artifacts.ts`에 정의 3개와 공통 스키마, `ReviewAnswerSchema`, 서비스 묶음 `ArtifactService`·`ArtifactServiceName`·`ARTIFACTS_CAPABILITIES`(spec §3.9)를 둔다. F `records/catalog/artifact.ts`에 `artifact.*` 12종 카탈로그(`CatalogEntry`, `F.records.spec` §3.3.2)와 payload 스키마를 둔다. ID 접두 `art`·`rvw`·`cmt`·`hof`는 F.conversation §3.2.1 `LocalIdPrefix`를 쓴다. `artifact` 영역, `TYPE_PREFIX_OWNERS` 행, `CallOptions.context`는 F에 이미 있으므로 확인만 한다. `validateCapability` 0건 테스트 | `F.capabilities.plan` M0, `F.records.plan` M0 | M | M2 |
| A2 | 산출물 모델: kind 판정, 메타 검사, 버전 규칙(`baseVersion`), 보관 기한 판정, 미리보기 메타 계산 | A1 | S | M3(안 2면 M2) |
| A3 | blob 등록(`xeon.store` blob API, `sys_blobs`)과 커밋 순서, 투영기 `cap.artifacts`와 DDL, 목록 커서. `register`·`update`·`list`·`get`·`archive` 서비스 | A2, `L0.store.plan` blob API, `L1.persistence.plan` 투영기 등록 | M | M3(안 2면 M2) |
| A4 | `artifact_create`, `artifact_update` 도구 등록과 도구 경로 메타 병합 규칙(spec §3.2 둘째 항목), `CallContext` 해석과 다른 세션 거부 | A3, A1의 `CallContext` 확정 | S | M3 |
| A5 | diff 수집: `tool.settled`에서 workspace 결과 `details.diff` 추출(파서), 체크포인트 기준 diff 계산, 통합 diff 정규화와 hunk ID, 같은 파일 다중 diff 병합, 상한 | A1, `L2.workspace.spec` 결과 `details` 계약 | M | M3 |
| A6 | hunk 단위 승인 모델과 상태 머신(open/submitted/closed, 라운드), `ReviewAnswer` 반영, `open`의 changeset 등록·승인 요청 | A3, A5, L1.tools `review` kind 결정(spec §10 미결 4) | M | M3 |
| A7 | 코멘트 → 입력 큐 전달: 본문 렌더, `xeon.tasks.post`(`when` 선택), `requestId = review:<reviewId>:r<round>`, 제출 절차 6단계 | A6, `L1.tasks` post | S | M3 |
| A8 | 거절 적용: 역패치 계산(순수), 적용 전 확인(fuzz), 파일 단위 원자성, 결과 기록. 적용 포트 구현은 [미결] 해소 후 하나만 만든다(후보 A `workspace.files` 또는 B L1 복원) | A6, spec §10 미결 6 해소 | M | M3(미해소 시 M3 이후) |
| A9 | 자동 제목: `boundary.settle.after` 핸들러(detached), 프롬프트·후처리, `xeon.models` 용도 호출, `xeon.session.retitle(onlyIfUntitled)` 호출과 requestId. `setMeta.title`의 제목 변경 호출 | A3, `L1.persistence` 제목 API, `L1.models` 용도 라우팅 | S | M3 |
| A10 | 라벨: 정규화, `artifact.session_labeled`, 세션 메타 투영(L1 세션 이벤트 복사), `list`·`search` | A3 | S | M3 |
| A11 | (2차) 핸드오프: 컴팩션 요약 재사용 판정, 요약 생성, `HandoffPackage`, 새 세션 생성과 양쪽 기록, 입력 post, 도구 `handoff` | A3, A10 | M | M3 이후 |
| A12 | (2차) Markdown·HTML 내보내기: 이벤트 렌더러, 도구 출력 옵션, 산출물 부록, `Source.usage.cache` 필터, 결과 위치 | A3, `L2.web.spec` Source 모양 | M | M3 이후 |
| A13 | 설정 그룹 `l2.artifacts`(spec §6)와 도구 노출 키 연결 | A1 | S | M3 |

순서: A1 → A2 → A3 → (A4, A5, A9, A10, A13 병렬) → A6 → A7 → A8. 2차는 A11, A12.

## 4. 채택 코드

### 4.1 그대로 쓰는 패키지

| 패키지 | 버전 | 라이선스 | 쓰는 곳 | 비고 |
|---|---|---|---|---|
| `typebox` | 1.3.27 (워크스페이스 catalog) | MIT | 정의(F), 입력 검사 | 이미 catalog에 있다 |
| `diff` (jsdiff) | `cap-workspace`와 같은 catalog 항목 [가정: pi durable 포크가 쓰는 버전. 2026-10-21 npm 최신은 9.0.0] | BSD-3-Clause | A5 체크포인트 기준 diff 계산(`structuredPatch`), A8 역패치 적용(`applyPatch`) | [제안] `cap-workspace`를 import하지 않고 같은 외부 패키지를 직접 의존한다. 같은 층 import 금지(DR-02)를 지키면서 줄 단위 diff 알고리즘을 다시 만들지 않기 위해서다. 버전은 catalog 한 줄로 두 패키지가 공유한다. 9.x가 자체 타입 선언을 싣는지 확인한다 [가정] |

- 통합 diff 텍스트 해석(A5 `unified-diff.ts`)은 `diff`의 `parsePatch`를 쓸 수 있다. [제안] 그래도 hunk ID·정렬·`patchSha256` 규칙은 이 패키지의 순수 함수로 둔다. `parsePatch`의 결과 모양을 경계에서 로컬 타입으로 바꾼다(`eng.context-map.design` CM-03).
- 대안: `diff`를 쓰지 않고 해석기만 직접 쓰는 소형 구현(약 200줄). 체크포인트 기준 diff 계산(`changes.type: "checkpoint"`)이 필요하므로 diff 알고리즘까지 직접 쓰게 된다. 채택하지 않는다.
- 외부 패키지를 더 추가할 때는 정확 버전과 라이선스를 이 표에 먼저 적는다. HTML 내보내기(A12)의 Markdown 렌더러는 2차 착수 때 고른다. 후보는 이미 다른 패키지가 채택한 렌더러(L4 데스크톱 쪽)이고, 없으면 조사 항목으로 둔다.

### 4.2 설계 이식(코드를 가져오지 않음)

| 원본 | 경로 | 가져오는 것 | 바꿀 점 |
|---|---|---|---|
| oh-my-pi `artifact://` 저장소 | omp `packages/coding-agent` 내부 URL 프로토콜(`_research/refs/oh-my-pi.md` 231행) | 산출물을 ID로 참조하는 방식 | 파일 저장소 대신 이벤트 + blob + 투영. URL 스킴은 두지 않는다 |
| oh-my-pi `/handoff` | `_research/l2e.md` §3.3 C3 참고 구현 | 요약 후 새 세션 시작 흐름 | 컴팩션 요약 재사용 판정을 더함(spec §4.4) |
| oh-my-pi hunk stage·discard | `_research/l2e.md` §3.2 B6 참고 구현 | hunk 단위 결정 | git 인덱스 대신 리뷰 이벤트 |
| opencode 세션 제목 | oc `session/title.ts`(`_research/packages.md` §4.4 L2-e "세션 제목과 메타" 행) | 첫 턴 뒤 소형 모델로 제목 생성, 요청 종류 `title` | 이벤트는 L1 소유. 이 패키지는 호출만 한다 |
| Zed 체크포인트와 개별·전체 수락·거부 | `_research/l2e.md` §3.2 B6, §3.3 C1(Zed 변경 파일 목록), 부록 Zed URL | 변경 파일 목록, 개별 수락 UI 흐름 | 화면은 L4. 이 층은 상태만 |

## 5. 단위 테스트 목록

모든 테스트는 `eng.testing.guide`를 따른다. 시계는 `manualClock`, ID는 `fixedIdFactory`, 저장은 `openTestStore`(실제 `bun:sqlite`), 파일 시스템은 `fakeExec`(`@xeon/platform-exec/testing`, ExecutionEnv 가짜), 모델은 테이프(`@xeon/core-models/testing`)다. L1 서비스(session·tasks·approvals·models)는 `src/testing`의 가짜 포트로 주입한다.

### 5.1 정의 (A1)

| 테스트 | 확인할 동작 |
|---|---|
| `defs.validate.test.ts` › 세 정의 이슈 0건 | `validateCapability`가 경고 포함 0건(수용 기준 6) |
| › 정의 집합 충돌 없음 | 다른 L2 정의와 함께 `validateCapabilitySet`에 `tool_name_conflict`가 없다 |
| › toInput 순수성 | 같은 입력 1,000회가 같은 출력. 시계·난수를 쓰지 않는다 |
| › 라벨 정규식 | `한글 라벨`, `ml/ops`는 통과, 앞 공백·49자는 실패. JSON Schema 검사기와 `Value.Check` 결과가 같다 |
| `catalog.test.ts` › kind 형식 | 12종이 `<영역>.<이름>` 형식이고 `artifact.` 접두이며 `owns("cap.artifacts", kind)`가 참 |

### 5.2 등록·갱신·버전 (A2, A3, A4)

| 테스트 | 확인할 동작 |
|---|---|
| `registry.service.test.ts` › 등록은 버전 1 | `register` 뒤 `artifact.registered` 하나, 요약의 `version: 1` |
| › inline 본문은 blob이 된다 | 이벤트 payload에 텍스트가 없고 `BlobRef`만 있다 |
| › file 본문 | `fakeExec`의 파일을 읽어 blob을 만들고 `sourcePath`를 남긴다. 없는 경로는 `file_unreadable` |
| › 갱신은 버전을 1 늘린다 | `update(baseVersion: 1)` → 버전 2, 바뀌지 않은 필드는 payload `null` |
| › 낡은 baseVersion | `version_conflict`, `detail.latestVersion` |
| › 보관된 산출물 갱신 | `artifact_archived` |
| › 같은 requestId 재등록 | 이벤트 수가 늘지 않고 같은 `artifactId`를 돌려준다 |
| › 상한 | `maxPerSession` 2에서 세 번째 `register`가 `artifact_limit_reached` |
| › 본문 크기 상한 | `maxContentBytes` 초과가 `content_too_large`이고 blob을 쓰지 않는다 |
| › 메타 16 KiB 초과 | `invalid_input` |
| › 보관 기한 | `manualClock`으로 기한을 넘기고 세션을 열면 `artifact.archived { reason: "retention" }` |
| `registry.tools.test.ts` › 도구 경로 메타 병합 | `artifact_update`의 `summary`만 바뀌고 기존 `sources`가 남는다 |
| › 도구 경로 다른 세션 거부 | `context.toolCallId`가 있고 입력 `threadId`가 다르면 `denied` |
| › CallContext 없음 | 입력 `threadId`도 없으면 `invalid_input` |

### 5.3 투영 재생성 동일성 (A3, A10)

| 테스트 | 확인할 동작 |
|---|---|
| `projection.rebuild.test.ts` › 재생성 뒤 목록 동일 | 등록 3, 갱신 2, 보관 1 뒤 테이블을 지우고 재생 → `list({status:"all"})` 결과와 커서가 같다(수용 기준 1) |
| › `expectProjectionsRebuildable` | 리뷰·라벨 이벤트를 섞은 세션에서 통과 |
| › 투영기 버전 변경 | `version`을 올리면 이 투영기 테이블만 다시 만든다 |
| › 세션 메타 복사 | L1 세션 생성·제목 이벤트에서 `cap_artifacts_sessions.title`, `title_source`가 채워진다 |
| › 커서 안정성 | 같은 `updated_at`의 항목들이 `artifact_id` 순으로 끊김 없이 이어진다 |

### 5.4 hunk 분할·승인·거절 경계 사례 (A5, A6, A8)

| 테스트 | 확인할 동작 |
|---|---|
| `unified-diff.test.ts` › hunk ID 결정성 | 같은 diff를 파일 순서를 바꿔 넣어도 같은 `hunkId`와 `patchSha256` |
| › 새 파일, 삭제 파일, 이름 바꾸기 | `change`가 `added`/`deleted`/`renamed`, `oldPath` 채움 |
| › 이진 파일 | `binary: true`, hunk 없음 |
| › 줄 끝 개행 없음 표시 | `\ No newline at end of file`을 보존 |
| › 해석 실패 | 깨진 헤더에서 `diff_unparsable`, `detail.line` |
| › 같은 파일 다중 diff 병합 | 두 번 편집한 파일이 기준→최종 diff 하나가 된다 |
| › 상한 | 257개 파일에서 `review_too_large` |
| `collect.test.ts` › turn 수집 | 가짜 `tool.settled`(edit 2, bash 1)에서 edit 2개의 diff만 모은다 |
| › checkpoint 수집 | 가짜 체크포인트 파일과 `fakeExec` 현재 파일로 diff를 계산한다 |
| `review.model.test.ts` › 상태 머신 | open → submitted → (새 코멘트) open(round 2) → closed |
| › 닫힌 리뷰 | `approve`가 `review_closed` |
| › 없는 hunk | `hunk_unknown` |
| › 되돌린 hunk 재승인 | `invalid_input` |
| › pending 남은 제출 | `decisions_pending`, `approveRemaining: true`면 통과 |
| `answer.test.ts` › 승인 답 반영 | `ReviewAnswer`가 `review_decided` 1개와 `review_commented` n개 초안이 된다 |
| `revert.test.ts` › 가운데 hunk만 거절 | 3 hunk 중 f0h1만 old로 돌아가고 나머지는 new 유지(수용 기준 3) |
| › 뒤에서부터 적용 | 앞 hunk의 줄 수가 바뀌어도 뒤 hunk 적용 위치가 맞다 |
| › fuzz 범위 | 위쪽에 2줄이 추가된 파일에서 적용, 4줄이면 `conflict` |
| › 파일 단위 원자성 | 한 파일의 거절 hunk 둘 중 하나가 충돌하면 그 파일을 쓰지 않고 둘 다 `conflict` |
| › 다른 파일 무영향 | 거절이 없는 파일에는 쓰기 호출이 없다(`fakeExec` 호출 기록) |
| › 이진 파일 거절 | `skipped` |

### 5.5 코멘트 멱등 전달 (A7)

| 테스트 | 확인할 동작 |
|---|---|
| `deliver.test.ts` › 본문 렌더 | 거절·충돌·승인 요약과 코멘트 목록이 정해진 형식. 코드 원문이 없다 |
| › requestId | `review:<reviewId>:r<round>`, 64자 이하 |
| › 재제출 멱등 | post 뒤 `review_submitted` 커밋 전에 실패를 주입하고 다시 `submit` → post 호출 둘의 키가 같고 큐 항목 하나(수용 기준 4) |
| › when 선택 | 입력 → 리뷰 → 설정 순 |
| › 전달할 것 없음 | 모두 승인·코멘트 없음이면 post를 부르지 않고 `delivery: null` |

### 5.6 제목 변경 호출 경계 (A9, A10)

| 테스트 | 확인할 동작 |
|---|---|
| `title.test.ts` › setMeta는 retitle만 부른다 | 가짜 session의 `retitle` 호출 1회, `commit`에 제목 kind 초안이 없다(수용 기준 2) |
| › 생산자 소유 검사 | `cap.artifacts`로 제목 이벤트 kind를 커밋하면 실제 `SessionWriter`(테스트 저장소)가 거부한다 |
| › 자동 제목 트리거 | 첫 `boundary.settle.after`에서만 모델을 부른다. 두 번째 턴에서는 부르지 않는다 |
| › 자동 제목 후처리 | 따옴표·마침표 제거, 60자 자르기, 빈 결과는 호출하지 않음 |
| › onlyIfUntitled | 사용자 제목이 먼저 붙으면 `applied: false` |
| › 모델 실패 | 테이프 오류에서 예외 없이 건너뛴다 |
| › session_info_changed 미발사 | 이 패키지 코드가 #31을 디스패치하지 않는다(가짜 ext-host 기록) |
| `meta.test.ts` › 라벨 집합 연산 | set → add → remove 순, NFC 정규화, 32개 상한 `too_many_labels` |
| › 메타 검색 | 제목·라벨 부분 문자열, 대소문자 무시(ASCII), 본문은 찾지 않는다 |

### 5.7 내보내기 cache 정책 필터 (A12, 2차)

| 테스트 | 확인할 동작 |
|---|---|
| `export.filter.test.ts` › none 발췌 제외 | `cache: "none"` Source의 발췌가 출력에 없고 URL·제목은 있다(수용 기준 5) |
| › session 발췌 제외 | spec §4.5.3 제안대로 제외(미결 확정 시 표 갱신) |
| › persist 포함 | 그대로 들어간다 |
| › 산출물 부록 필터 | `meta.sources`에 `none`이 있으면 본문 대신 제목·출처만 |
| › omitted 개수 | 걸러 낸 수가 정확하다 |
| `export.markdown.test.ts` › 버려진 가지 제외 | 되감기 뒤 leaf 경로만 나온다 |
| › 도구 출력 옵션 | `none`/`summary`(20줄)/`full` |
| `export.html.test.ts` › 스크립트 없음 | 출력에 `<script`가 없다 |

### 5.8 핸드오프 데이터 왕복 (A11, 2차)

| 테스트 | 확인할 동작 |
|---|---|
| `handoff.package.test.ts` › 스키마 왕복 | 만든 패키지를 JSON 직렬화·역직렬화하면 `HandoffPackageSchema`를 통과하고 값이 같다 |
| › 컴팩션 재사용 | 컴팩션 뒤 2턴이면 `compaction+tail`, 0턴이면 `compaction`, 4턴이면 `generated` |
| › 산출물 고정 | 최신 버전 번호가 패키지에 고정되고 이후 갱신이 패키지를 바꾸지 않는다 |
| › 양쪽 기록 | 새 세션에 `handoff_received`(원본 leaf 포함), 원본에 `handoff_sent` |
| › 재시도 멱등 | 같은 requestId 재호출이 새 세션을 하나만 만든다 |

## 6. 완료 기준

- M3 종료 조건(`product.scope.spec` §4.4 M3)의 공통 항목: `cd xeon && just verify`가 종료코드 0이다.
- spec §9 수용 기준 1~6이 위 테스트로 확인된다. 대응: 1 → §5.3, 2 → §5.6, 3 → §5.4 `revert.test.ts`, 4 → §5.5, 5 → §5.7(2차 작업이지만 필터 함수 `filter.ts`와 그 테스트는 M3에 먼저 만든다 [제안]), 6 → §5.1.
- `bunfig.toml` 커버리지 기준(줄 0.8, 함수 0.8)을 넘는다 [제안]. 순수 함수 비중이 커서 높게 둔다.
- `check-layers`와 dependency-cruiser가 `cap-artifacts`의 같은 층 import 0건을 확인한다.
- spec §10 미결 1·4·6이 M3 착수 전에 정해지지 않으면, 해당 작업(A4의 다른 세션 거부, A6의 승인 경로, A8)을 대안으로 구현하고 완료 기준에서 그 항목을 "대안 구현"으로 표시한다.

## 7. 위험과 대응

| # | 위험 | 영향 | 대응 |
|---|---|---|---|
| 1 | 거절 적용 경로와 L1 복원의 책임 중복 | 후보 B를 고르면 되감기와 리뷰가 같은 파일 상태를 두 경로로 바꾼다. 대화 leaf가 리뷰 때문에 움직일 수 있다 | spec §4.2.5에서 A를 제안. B를 고르면 L1.persistence에 "leaf를 움직이지 않는 파일 복원" API를 요구한다. A8을 [미결] 해소 뒤로 미루는 배치(§1.3) |
| 2 | diff 포맷 의존(workspace 결과 `details` 계약 변경) | workspace가 `details.diff` 모양을 바꾸면 리뷰 수집이 깨진다 | F에 `WorkspaceDiffDetailsSchema`를 두자는 요청(spec §10 미결 6). 그 전에는 수집기가 모르는 모양을 건너뛰고 경고하며, `collect.test.ts`에 workspace 샘플 결과를 고정 데이터로 둔다 |
| 3 | 산출물 blob 증가 | 버전마다 blob이 남고 보관으로 공간이 줄지 않는다 | 크기·개수 상한 설정, 내용 주소 blob이라 같은 내용은 한 번만 저장. 공간 회수는 세션 삭제와 L0.store 정리에 맡기고, 필요하면 L1.persistence에 이벤트 압밀(snapshot) 2차 항목을 요청 |
| 4 | 미리보기 종류 확장 시 L4 결합 | 새 kind마다 L4 렌더러가 필요해지면 L2 변경이 L4 배포를 끌고 간다 | 확장 kind는 `mediaType` 기본 미리보기로 떨어지는 규칙(spec §3.1). 내장 kind 추가는 minor 버전과 L4 렌더러를 같은 릴리즈에 넣는다 |
| 5 | 승인 프로토콜의 `review` kind 미수용 | 사용자 결정이 들어올 경로가 없다 | 대안 (b) `question` + `answerSchema`, (c) F wire 메서드. A6의 답 반영 함수는 경로와 무관한 순수 함수로 만들어 두 경로 모두에 쓴다 |
| 6 | `CallContext` 미수용 | 도구 경로에서 대상 세션을 알 수 없다 | L1.tools 어댑터가 입력에 `threadId`를 끼우는 대안(spec §3.5 마지막 항목). `context.ts` 한 곳에서 해석해 바꾸기 쉽게 둔다 |
| 7 | 자동 제목 비용 | 세션마다 소형 모델 호출 1회 | 첫 턴만, 입력 3,000자 상한, 끌 수 있는 설정 |
| 8 | 같은 파일 다중 diff 병합의 기준 복원 실패 | 한 턴에 같은 파일을 여러 번 고친 경우 리뷰를 못 연다 | 실패 시 `diff_unparsable` 대신 `checkpoint` 근거로 다시 여는 안내를 detail에 싣는다 [제안] |
