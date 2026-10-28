---
id: L3.slots.plan
layer: L3
domain: slots
kind: plan
status: draft
depends_on: [L3.slots.spec, L3.group-kit.plan]
binds: []
---

# L3 추가 그룹 슬롯 구현 계획 (slots)

slots는 코드 없는 도메인이다(`_routing/routes.yaml` layout L3). 그래서 `binds`는 비어 있고, 이 계획의 산출물은 두 가지다.

- 문서: `L3.slots.spec`과 이 계획
- 파일 초안: `xeon/packages/group-kit/templates/` 아래 템플릿 3종과 `xeon/packages/group-kit/src/testing/policies/` 아래 정식 예 fixture 3종. 경로는 `L3.group-kit.plan`의 패키지 안이다. 파일 생성은 다음 단계(2차 구현)에서 한다. 이 단계에서는 코드를 만들지 않는다.

## 1. 목표와 마일스톤 배치

목표: 사용자가 제2의 의도 그룹과 정책 플러그인을 코어 수정 없이 만들 수 있게 템플릿, 판정 기준, 정식 예를 갖춘다(`L3.slots.spec` §1).

| 마일스톤 | slots 작업 | 근거 |
|---|---|---|
| M0 | 없음 | `_research/foundation-plan.md` §5 P4 범위 밖 |
| M1 | 없음. 단 `group-kit` 테스트 그룹(on·post·drive)이 drive 템플릿의 원형이 된다 | `L3.group-kit.plan` M1 |
| M2 | 없음. 단 Helm(`group-helm`)이 drive 그룹 골격의 실사용 예가 된다 | `product.scope.spec` §4.3 M2 |
| M3 | 없음. 학습 그룹(`group-learning`)이 drive 없는 그룹(관찰·정책) 골격의 실사용 예가 된다 | `product.scope.spec` §4.3 M3 |
| 2차 | S-01~S-08 전부 | [결정] `_research/layer-plan-v2.json` L3-d 세 항목(제2의 의도 그룹, 정책 플러그인, 그룹 템플릿) 모두 단계 "2차" |

- group-kit 쪽 작업 id: S-01은 L3.group-kit.plan G-24, S-02는 G-25, S-03은 G-26, S-04는 G-27과 짝이다. 파일은 group-kit 패키지에 생기므로 group-kit 계획에도 같은 항목을 둔다.
- [제안] 템플릿 추출은 M3 학습 그룹 완료 뒤에 한다. M1 테스트 그룹, M2 Helm, M3 학습 그룹 세 구현에서 공통으로 남은 골격만 템플릿으로 옮긴다. 먼저 템플릿을 만들면 아직 검증되지 않은 `defineGroup` 사용 방식이 템플릿에 고정된다.
- [제안] 2차 안의 순서: 템플릿 추출(S-01) → 재생·매니페스트 테스트(S-03, S-04) → 정식 예(S-02) → 생성 명령 계약 전달(S-05) → 문서 정리(S-06~S-08).

## 2. 패키지와 파일 배치

### 2.1 템플릿 파일 위치 후보

| 후보 | 위치 | 좋은 점 | 감수할 점 |
|---|---|---|---|
| a | `xeon/packages/group-kit/templates/` | `defineGroup`이 바뀌면 같은 변경에서 템플릿이 고쳐진다. `group-kit` 테스트가 템플릿을 생성·로드한다. context-map이 slots를 이미 `group-kit` 컨텍스트에 두었다 | `group-kit` 패키지가 데이터 파일을 더 갖는다. 템플릿 `.ts`를 패키지 typecheck에서 빼야 한다 |
| b | 독립 템플릿 저장소 | 외부 사용자가 `git clone`만으로 쓴다. 런타임 판과 따로 배포한다 | 런타임 판과 템플릿 판이 어긋나기 쉽다. CI가 두 저장소를 맞춰야 한다. layout에서 slots를 빼야 한다(`eng.context-map.design` C-2) |
| c | 문서 안 코드 블록만 | 파일이 없다 | 생성 명령이 쓸 원천이 없다. 코드 블록은 테스트되지 않아 쉽게 깨진다 |

[제안] a를 택한다. `L3.slots.spec` §3.3.1과 같다. 확정은 `eng.context-map.design` C-2 [미결]과 함께 한다.

### 2.2 템플릿 디렉터리 트리

```text
xeon/packages/group-kit/
  templates/
    index.json                      # TemplateIndex (L3.slots.spec §3.3.3)
    common/
      package.json
      tsconfig.json
      README.md
      test/manifest.test.ts
    drive/
      .xeon-plugin/plugin.json      # usesDrive: true, points: ["boundary.settle.after"]
      src/index.ts                  # defineGroup + g.drive 골격
      src/state.ts
      src/settings.ts
      test/unit.test.ts
      test/replay.test.ts           # replayDrive 골격
    policy/
      .xeon-plugin/plugin.json      # usesDrive: false, points: ["tool.call.before"]
      src/index.ts                  # tool.call.before first 골격(상태 없음)
      src/settings.ts
      test/unit.test.ts
    observe/
      .xeon-plugin/plugin.json      # usesDrive: false, points: ["boundary.settle.after"], recordKinds 1개
      src/index.ts                  # boundary.settle.after tap + record 골격
      src/state.ts
      src/settings.ts
      test/unit.test.ts
```

- `templates/`는 `group-kit`의 `exports`와 `tsconfig.json` `include`에서 뺀다 [제안]. 템플릿 `.ts`에는 치환 자리(`__ID__`)가 있어 그대로 컴파일하지 않는다. 대신 테스트가 임시 디렉터리에 생성한 뒤 컴파일·로드한다(S-03, S-04).
- oxlint·oxfmt 대상에서도 뺀다. 생성 결과는 테스트 안에서 검사한다.

### 2.3 정식 예 fixture 위치

```text
xeon/packages/group-kit/
  src/testing/
    index.ts                        # "./testing" 진입점. 아래를 다시 export
    policies/
      reviewgate.ts                 # 검토 강제 (L3.slots.spec §3.2.2)
      commitguard.ts                # 커밋 전 검증 (§3.2.3)
      guardrail.ts                  # 가드레일 지점 예 (§3.2.4)
  test/
    tapes/
      slots/reviewgate-write-then-settle.tape.jsonl
      slots/commitguard-commit-before-verify.tape.jsonl
      slots/guardrail-blocked-tool-call.tape.jsonl
    slots/
      templates.test.ts
      policies.test.ts
```

- [제안] fixture는 `src/testing/policies/`에 둔다. `testing` 서브패스는 테스트 파일에서만 import된다(`eng.dependency-rules.guide` DR-08). 그래서 정식 예가 기본 배포 카탈로그에 들어가지 않는다.
- 테이프는 `test/tapes/` 아래 `*.tape.jsonl`이다(`eng.testing.guide` TS-04, TS-06).
- 이 단계에서는 위 파일을 만들지 않는다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| S-01 | 템플릿 3종 골격 추출. M1 테스트 그룹, Helm, 학습 그룹의 공통 골격을 `templates/{drive,policy,observe}`와 `common/`로 옮기고 `index.json`을 쓴다 | `L3.group-kit.plan` M1 테스트 그룹, `L3.helm.plan` M2 구현, `L3.learning.plan` M3 구현 | 중 |
| S-02 | 정식 예 3종 구현: `reviewgate`(검토 강제), `commitguard`(커밋 전 검증), `guardrail`(가드 지점 셋을 쓰는 예)과 테이프 3개 | S-01, F 가드 지점(ADR-0017, M3 F 작업), `group-kit/testing`의 그룹 하네스(`L3.group-kit.plan`) | 중 |
| S-03 | 재생 테스트 골격: drive 템플릿을 생성해 `replayDrive`로 모든 커밋 지점에서 끊고 재개하는 테스트 | S-01, `replayDrive`(`L3.group-kit.plan` 2차 재생 검사) | 소 |
| S-04 | 매니페스트 검증 테스트: 세 템플릿 생성 결과가 `validateManifest`·`validateUsage`를 통과하고, 잘못된 이름·kind 조합이 거부되는지 확인 | S-01, F `validateManifest`(`F.extensions.plan`) | 소 |
| S-05 | `xeon group new <이름> [--drive\|--policy]` 계약(요구 R1~R6, `templates/index.json` 형식)을 `L4.cli.spec`·`L4.cli.plan`에 전달하고 반영을 확인 | S-01, S-04 | 소 |
| S-06 | (닫힘) 가드레일 보류 해제 조건. [결정: review.m3-design-inputs D-M3-30] 내장 검사 없이 fail-closed 가드 지점 셋을 둔다(ADR-0017). 남은 일은 S-02의 `guardrail` 예를 가드 지점으로 쓰는 것뿐이다 | 없음 | — |
| S-07 | 교차 import 거부 테스트: 생성한 그룹에 `@xeon/group-helm` import를 넣은 가짜 워크스페이스로 check-layers `DR-02` 실패 확인 | S-01, `check-layers.ts`의 허용 목록 구현(`eng.dependency-rules.guide` 4절) | 소 |
| S-08 | 코어 diff 0 확인: 템플릿으로 만든 가짜 그룹을 워크스페이스에 더하는 변경에서 `packages/contracts`, `packages/ext-host` diff가 0인지 검사하는 스크립트 단계 | S-01, S-04 | 소 |

- 규모: 소는 하루 이내, 중은 2~3일이다 [가정].
- S-02의 `guardrail`은 골격과 fixture 테스트까지만 만든다. 기본 배포와 설정 카탈로그에 넣지 않는다. 내장 콘텐츠 검사를 두지 않는 결정(D-M3-30)과 같다.

## 4. 채택 코드

| 대상 | 버전·출처 | 쓰는 방식 | 바꿀 점 |
|---|---|---|---|
| `create-cordis` | 0.3.1, MIT(`_research/packages.md` §4.6 L3-c) | 스캐폴딩 방식(템플릿 디렉터리 복사, 이름 치환)만 참고한다. 코드 채택 없음 | 해당 없음 |

- [가정] 버전 0.3.1은 `_research/packages.md` §4.6의 기록이고, 그 행의 판정 자체가 추측이다. 코드를 채택하지 않으므로 의존성에 넣지 않는다. 참고할 때 npm 레지스트리의 실제 판과 라이선스를 다시 확인한다.
- 그 밖의 채택 코드는 없다. L3 구성요소는 21개다(`_research/layer-plan-v2.json` L3-a 7, L3-b 5, L3-c 6, L3-d 3). 코드를 채택한 것은 없다. L3-c 학습 그룹 6개 가운데 4개(학습 트리거, 검토 포크, 큐레이터, 학습 이력 보기)는 출처 표기가 '설계'이고 Hermes 자기 개선 루프의 설계를 차용한다(L3.learning.plan §4). 나머지 17개는 선례가 없어 자체 구현이다. `_research/packages.md` §4.6 제목의 "17개 모두 자체"는 학습 그룹을 L3로 옮기기 전 집계이고 L3-c 행이 지금의 L3-d(추가 그룹 슬롯) 구성요소를 적고 있으므로 갱신이 필요하다.
- 템플릿이 쓰는 패키지(`typebox`, `@xeon/contracts`, `@xeon/group-kit`)의 판은 워크스페이스 catalog를 따른다. `typebox`는 1.3.27다(L3.group-kit.plan §4 표). 템플릿 `package.json`에 판을 직접 적지 않는다 [제안].

## 5. 단위 테스트 목록

모두 `group-kit`의 테스트 도우미(그룹 하네스, `replayDrive`)와 테이프 가짜(`@xeon/core-models/testing`의 `tape`, `tapePlayer`)를 쓴다. 파일은 `xeon/packages/group-kit/test/slots/`에 둔다.

| 테스트 이름 | 확인할 동작 | 작업 |
|---|---|---|
| `template.drive-group-loads-and-toggles` | drive 템플릿으로 생성한 그룹이 로드되고, 켜면 다음 단계 경계 뒤 drive 함수가 호출되며, 끄면 다음 단계 경계 뒤 임대가 반납된다 | S-01 |
| `template.policy-group-denies-via-first` | policy 템플릿 그룹이 `blockedTools`에 있는 도구의 `tool.call.before`을 거부하고, 사유가 도구 결과로 모델에 돌아간다 | S-01 |
| `template.policy-exception-becomes-deny` | policy 그룹의 first 핸들러가 던지면 `FIRST_DENY.tool_call`로 거부되고 뒤 핸들러는 실행되지 않는다 | S-01 |
| `template.policy-group-disable-stops-first-handler` | policy 템플릿 그룹이 `contracts`·`ext-host` 수정 없이 로드되고, `ext.<id>.enabled`를 거짓으로 바꾸면 다음 단계 경계 뒤 그 그룹의 `tool.call.before` 핸들러 호출 수가 0이며 `blockedTools`의 도구가 실행된다 | S-01 |
| `template.manifest-passes-validateManifest` | 세 템플릿 생성 결과의 `plugin.json`이 `validateManifest` 오류 0, setup 뒤 `validateUsage` 오류 0이다. `focus_lens`(밑줄), `core`(예약 이름)는 생성 단계에서 거부되고, 하이픈 이름은 통과한다(review.decisions-2 U-18) | S-04 |
| `template.replay-test-cuts-at-every-commit` | drive 템플릿의 `test/replay.test.ts`가 생성 직후 통과한다. 커밋 지점 수만큼 끊어 재개한 효과 열이 끊지 않은 실행과 같다 | S-03 |
| `policy.verify-before-commit-blocks-until-verified` | `commitguard`: 검증 전 `git commit` bash 호출 거부 → `just verify` 성공 → 커밋 실행 → `write` 성공 → 다시 거부 | S-02 |
| `policy.review-enforced-posts-once-with-requestid` | `reviewgate`: 쓰기 턴에서 `reviewgate:<turnId>` post가 한 번 들어가고 `continue`가 한 번 요청되며, 두 번째 정착에서 post는 `duplicate: true`이고 턴이 정착한다 | S-02 |
| `template.rejects-cross-group-import` | 생성한 그룹에 `@xeon/group-helm` import를 넣은 가짜 워크스페이스에서 check-layers가 `DR-02`로 실패한다 | S-07 |

추가로 두는 테스트 [제안]:

| 테스트 이름 | 확인할 동작 | 작업 |
|---|---|---|
| `template.observe-group-records-turn-count` | observe 템플릿 그룹이 `boundary.settle.after`마다 `grp.<id>.turn.counted` 레코드를 쓰고, 다른 그룹의 `readRecords`로 읽힌다 | S-01 |
| `template.index-matches-files` | `templates/index.json`의 파일 목록과 실제 파일 집합이 같고, `TemplateIndexSchema`를 통과한다 | S-01 |
| `policy.guardrail-unknown-follows-setting` | `guardrail`: 검사 함수 예외 시 `onUnknown: "deny"`면 거부, `"allow"`면 통과 | S-02 |
| `policy.plugin-kind-rejects-drive` | `kind: "plugin"` 정책 매니페스트에 `usesDrive: true`면 `drive_requires_group` 오류 | S-04 |

## 6. 완료 기준

| `L3.slots.spec` §9 수용 기준 | 테스트 |
|---|---|
| 1. policy 템플릿 그룹이 코어 수정 없이 로드되고 켜고 끌 수 있다. 끈 뒤 first 핸들러가 호출되지 않는다 | `template.policy-group-disable-stops-first-handler`, `template.policy-group-denies-via-first` |
| 2. drive 템플릿의 replay 테스트가 통과한다 | `template.replay-test-cuts-at-every-commit` |
| 3. 세 템플릿 매니페스트가 `validateManifest`를 통과한다 | `template.manifest-passes-validateManifest` |
| 4. 정식 예 3종이 테이프 시나리오로 동작한다 | `policy.review-enforced-posts-once-with-requestid`, `policy.verify-before-commit-blocks-until-verified`, `policy.guardrail-unknown-follows-setting` |
| 5. first 예외는 도구 호출 거부가 된다 | `template.policy-exception-becomes-deny` |
| 6. 다른 그룹 import는 `DR-02`로 실패한다 | `template.rejects-cross-group-import` |
| 7. 가짜 그룹 추가 시 `contracts`·`ext-host` diff 0 | S-08 스크립트 단계 |

- 템플릿으로 만든 가짜 그룹을 워크스페이스에 추가하는 변경에서 `xeon/packages/contracts`와 `xeon/packages/ext-host`의 diff가 0이다(`product.vision.spec` S1).
- `cd xeon && just verify`가 종료코드 0이다(`product.scope.spec` §4.4 공통 조건).
- `L3.slots.spec`의 [미결] 가운데 템플릿 위치(C-2)와 생성 명령 소유가 정해졌거나, 정해지지 않은 채 남은 이유가 문서에 적혀 있다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 템플릿이 커지면 `group-kit`의 구조가 템플릿 모양에 굳어 바꾸기 어려워진다 | 템플릿은 최소 골격만 담는다(`L3.slots.spec` §4.3 규칙 1). 정책 로직, 렌즈, 프롬프트 문구를 넣지 않는다. 템플릿 추출은 세 그룹 구현 뒤에 한다(1절) |
| 정식 예(`reviewgate`, `commitguard`, `guardrail`)가 제품 기능으로 오해된다 | `src/testing/policies/`에 두고 기본 배포·설정 카탈로그에 넣지 않는다. 각 파일 머리 주석과 spec에 "템플릿 검증용 fixture"임을 적는다 |
| 가드레일 플러그인을 켜면 기본 경로에 비용이 생긴다 | 가드 지점에 핸들러가 없으면 비용이 없다. 켜면 모델 요청·도구 호출·출력마다 검사가 돈다. 예는 패턴 검사만 쓰고, 모델 분류기는 재실행 결정성 규칙(`L3.slots.spec` 4.2.4 5번)을 따른다 |
| `defineGroup`·`replayDrive` 시그니처가 2차 전에 바뀐다 | 템플릿 테스트가 `group-kit` 테스트에 들어 있으므로 시그니처 변경이 같은 변경에서 템플릿 실패로 드러난다 |
| 생성 명령 소유가 정해지지 않아 S-05가 막힌다 | 템플릿은 생성 명령 없이도 쓸 수 있다(디렉터리 복사와 치환). S-05는 다른 작업을 막지 않는다 |
| 외부 그룹이 신뢰 등급 없이 다른 그룹을 import한다 | 저장소 안은 check-layers가 막는다. 외부 그룹은 `X.loading-trust.spec`의 결정을 따른다([미결]) |
