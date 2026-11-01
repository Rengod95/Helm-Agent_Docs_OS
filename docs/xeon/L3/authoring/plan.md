---
id: L3.authoring.plan
layer: L3
domain: authoring
kind: plan
status: draft
depends_on: [L3.authoring.spec, L3.group-sdk.plan, L3.slots.plan, review.m4-plan]
binds: [xeon/packages/plugin-builder/**]
---

# L3 플러그인 제작 확장 구현 계획 (authoring)

`L3.authoring.spec`을 M4에서 만드는 순서입니다. 트랙 배치는 `review.m4-plan` 트랙 T-AUTH입니다.

## 1. 목표와 마일스톤 배치

- M4: 서비스 `xeon.devkit`(host 구현), 그룹 `authoring`(도구, 단계 머신, 가드, 선언형 화면), 카탈로그 첫 판(spec §3.4 표), 검사 AU-001~AU-012, 카탈로그 적합성 시험.
- M4 밖: 묶음 서명, 로컬 카탈로그 공유, `x.hook` 종류(외부 훅 확정 뒤).

## 2. 패키지와 파일 배치

- `xeon/packages/plugin-builder/`: `src/index.ts`(defineGroup), `src/session/`(상태, 단계 머신), `src/tools/`, `src/guard.ts`, `src/checks/`(AU 규칙), `catalog/kinds/*.json`, `views/*.view.json`, `skills/authoring-guide/`.
- 서비스 계약: `xeon/packages/contracts/src/services/devkit.ts` [제안](F 트랙 몫).
- 서비스 구현: `xeon/apps/host/src/devkit/` [제안](L4 트랙 몫). 템플릿은 `group-sdk/templates`를 파일로 읽습니다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| AU-T1 | F: `DevkitService` 계약, `KindEntry`·`CompositionDecl` 스키마. contracts는 T-F만 고치므로 T-F가 만들고 이 트랙은 요구를 넘김 | T-F의 `composition`(X-16) | S |
| AU-T2 | host: `xeon.devkit` 구현(scaffold, validate, validateComposition, trial, pack, link), wire W-27·W-28·W-47·W-49 처리기 | AU-T1, T-WB의 `thread.create { trial }`(W-34) | M |
| AU-T3 | 그룹 골격, 상태 스키마, 단계 머신(drive), `loop.ask` 사용 | AU-T1, X-17 | M |
| AU-T4 | 도구 9개와 `/author` 명령 | AU-T2, AU-T3 | M |
| AU-T5 | 쓰기 범위 가드(`tool.call.before`) | AU-T3 | S |
| AU-T6 | 카탈로그 첫 판과 적합성 시험, AU 규칙 | AU-T2 | M |
| AU-T7 | 선언형 화면 기여(page, well, card)와 스킬 문서 | AU-T4, T-VIEW 선언형 렌더러 | S |
| AU-T8 | `xeon group new`를 서비스 호출로 바꾸고 결과 동일성 시험 | AU-T2 | S |
| AU-T9 | 개발 모드 replay(`replayDrive` 런타임 하니스, X-10) | T-GK의 X-10 | M |

## 4. 채택 코드

- 템플릿과 이름 규칙: `group-sdk/templates`, `GROUP_NAME_PATTERN`, `RESERVED_GROUP_NAMES`를 그대로 씁니다.
- 검사: F `validateManifest`·`validateUsage`·`validateComposition`, group-sdk `scanDriveSource`를 그대로 부릅니다. 규칙을 복사하지 않습니다.

## 5. 단위 테스트 목록

| 시험 | 확인할 동작 |
|---|---|
| `authoring.catalog-conformance` | `stable`·`preview` 항목마다 뼈대 → `validate` 오류 0 |
| `authoring.scaffold-equals-group-new` | 그룹 세 종류의 생성 파일이 `xeon group new`와 바이트 같음 |
| `authoring.guard-blocks-outside-dir` | 세션 대화에서 대상 폴더 밖 `write` 거부, 세션 끝나면 허용 |
| `authoring.package-requires-ask` | 확인 전 파일 쓰기 0, 대기 중 임대 반납(`lease.released { reason: "waiting" }`) |
| `authoring.replay-dev-only` | 배포 형태에서 `dev_mode_required` |
| `authoring.view-mode-checks` | `card`에 `frame`이면 AU-005 오류, `frame.reason` 빈 문자열 오류, `project` + `frame` 경고 |
| `authoring.blocked-kind-refused` | `x.hook` 시작 거부와 사유 |

## 6. 완료 기준

- spec §9 A-1~A-7 통과.
- `review.m4-plan` 종료 조건 Y8 통과.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| X-17(`loop.ask`)이 늦어 단계 머신이 막힘 | 그 전에는 post + 상태 대기로 임시 구현하고 X-17 병합 뒤 1커밋으로 바꿈 |
| 카탈로그 적합성 시험이 F·X 변경마다 깨져 다른 트랙을 막음 | 시험 실패 메시지에 고칠 항목 파일을 적고, F·X 트랙이 같은 커밋에서 카탈로그를 고치게 함 |
| 개발 모드 판정이 배포 앱에서 우회됨 | 판정은 host 한 곳(`xeon.devkit`)에서만, 설정 `l3.authoring.devMode`는 managed·user 범위만 |
