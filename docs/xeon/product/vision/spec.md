---
id: product.vision.spec
layer: product
domain: vision
kind: spec
status: draft
depends_on: [xeon.readme]
binds: []
---

# 제품 비전

## 비전 요약

Xeon(임시 이름)은 CLI와 데스크톱으로 배포하는 대화형 에이전트 런타임이다. 사용자는 pi나 Hermes 같은 일반 대화형 에이전트와 같은 방식으로 대화하고 도구를 쓴다. 배포 단위는 층 F~L3 전체이며, 사용자는 층마다 플러그인과 의도 그룹을 추가하거나 교체한다. 탐구 지원 그룹 Helm과 학습 그룹은 L3 기본 그룹으로 함께 제공된다. Helm은 확장 지점(on, post, drive, scope)을 통해 코드 수준에서 루프를 제어하므로, 모르는 분야의 관점과 지식을 현재 작업에 적용하는 탐구가 대화 안에서 일어난다. 학습 그룹은 세션이 쌓이면 스킬 md와 메타인지 피드백을 제안하고, 반복 작업 스크립트 제안은 2차에 더한다(`product.scope.spec`). F~L2는 검증된 오픈소스를 채택하거나 포크해 만들고, 설계 노력은 L2·L3의 자율 확장과 제2의 Helm을 쉽게 붙이는 스키마에 쓴다.

## 1. 목적과 범위

### 1.1 한 문장 정의

[결정: decisions-log 2026-10-19, 2026-10-21 배포 단위 정정] Xeon(임시 이름)은 대화형 에이전트 런타임이며 CLI와 데스크톱으로 배포한다. 배포 단위는 층 F~L3 전체이고, Helm은 그 안의 L3 기본 그룹이다.

- 사용자는 층별 플러그인과 그룹을 추가, 수정, 교체할 수 있다(decisions-log 2026-10-21 배포 단위 정정).
- Helm은 내장 그룹 또는 기본 플러그인으로 제공된다. 둘 중 어느 형태로 넣을지는 L3 문서가 정한다(`L3.helm.spec`).
- 이름 'Xeon'은 임시다(decisions-log 2026-10-21 3차). [미결] 최종 제품 이름.

### 1.2 이 문서가 정하는 것

- 제품의 정의, 사용감, 차별점
- 의도 그룹에 코드 수준 제어가 필요한 이유
- 대상 사용자와 배포 형태
- 모든 층에 적용되는 설계 원칙 6개
- 비전 수준의 성공 기준

### 1.3 다루지 않는 것

- 유즈케이스의 흐름: `product.usecases.spec`
- 범위, 비범위, 마일스톤: `product.scope.spec`
- 층 구조, 패키지 지도, 런타임 흐름: `architecture.overview.spec`, `architecture.layers.spec`, `architecture.runtime-flow.design`
- 확장 지점의 정확한 타입과 지점 이름: `F.extensions.spec`, `X.primitives.spec`
- Helm과 학습 그룹의 내부 설계: `L3.helm.spec`, `L3.learning.spec`

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 런타임 | 층 F~L3 전체. 엔진 라이브러리, 확장 체계, 코어 플러그인, 능력, 기본 그룹을 포함한다. L4 앱(CLI, 데스크톱, 서비스)은 런타임을 띄우는 진입점이다. |
| 층 | F(계약), X(확장 체계), L0(플랫폼), L1(코어), L2(능력), L3(의도 그룹), L4(배포 런타임). 순위는 F → X → L0 → L1 → L2 → L3 → L4다(`xeon.readme`). |
| 의도 그룹 | 특정 사상이나 작업 방식을 루프에 적용하는 L3 플러그인 묶음. `scope`로 등록하고 단계 경계에서 켜고 끈다. |
| Helm | 탐구 지원 의도 그룹. 새 관점과 모르는 분야의 지식을 현재 작업에 적용한다. L3 기본 그룹이다. |
| 학습 그룹 | 세션 기록에서 스킬, 스크립트, 피드백을 제안하는 의도 그룹. L3 기본 그룹이며 drive를 쓰지 않는다. |
| 확장 지점 4연산 | `on`(fold: tap, first, chain), `post`(when: steer, followUp, next), `drive`(배타 임대), `scope`(그룹 단위 켜기·끄기). ADR-0007. |
| post 큐 모드 | ADR-0007 §3.1 표를 따른다. `steer`는 다음 도구 라운드 뒤, `followUp`은 에이전트 정착 뒤 입력으로 들어간다. `next`는 경계 뒤 정확히 한 요청에 들어가고, 그 요청을 스스로 시작하는지는 [미결](ADR-0007 §6)이다. |
| 지점 종류 | [제안] input, request, tool, boundary, session. 종류 수와 지점 이름은 사용자 합의 전이다(ADR-0007 §3.3). |
| drive 임대 | 그룹 하나가 턴 구동을 독점하는 권한. 상한은 `{maxTurns, maxSpawns, maxTokens}`(`F.extensions.spec`의 `DriveLimits`)다. 상한을 명시하지 않은 임대는 X 설정 `x.primitives.driveDefaultLimits` 기본값 `{maxTurns: 4, maxSpawns: 8, maxTokens: 400000}`을 쓴다. Helm은 `l3.helm.driveLimits`(같은 기본값)로 덮어쓴다. 두 값 모두 설정 화면에서 조정한다. drive는 사용자 입력 없이 턴을 만들기 때문에 이 기본 상한을 pi 방식(기본 상한 없음)의 예외로 둔다 [결정: review.decisions-2 U-12]. |
| 단계 경계 | step(모델 요청 한 번과 그 도구 실행)이 끝나고 다음 step이 시작하기 전의 지점이다. `boundary.step.after` 지점 처리 직후이며 한 턴 안에 여러 번 있다. 그룹 켜기·끄기와 임대 반납이 여기서 적용된다(`F.conversation.spec` §2.1, `F.extensions.spec` §4.5). 사용자 결정 원문의 '턴 경계'는 이 지점으로 읽는다. drive 임대 교대도 같은 시점이다 [결정: review.decisions-2 U-01]. |

## 3. 인터페이스

해당 없음. 제품 문서는 코드 인터페이스를 정하지 않는다. 확장 지점의 시그니처는 `F.extensions.spec`과 `X.primitives.spec`이, 호스트 계약은 `F.wire-settings.spec`이 정한다.

## 4. 동작 규칙: 제품 성질

### 4.1 사용감과 차별점

[결정: decisions-log 2026-10-19] 사용감은 pi, Hermes Agent 같은 일반 대화형 에이전트와 같다. 사용자가 입력하면 모델이 도구를 쓰며 답하고, 실행 중에도 입력을 큐에 넣을 수 있다.

차별점은 두 가지다.

1. [결정: decisions-log 2026-10-19] 탐구와 작업 관리가 대화 안에 섞인다. 사용자는 별도 모드나 앱으로 옮겨 가지 않는다. Helm 그룹이 켜져 있으면 같은 대화에서 관점 탐색, 병렬 탐구, 결과 적용이 이어진다.
2. [결정: decisions-log 2026-10-19, 2026-10-21 계획 v2] 세션이 쌓이면 학습 그룹이 스킬 md, 반복 작업 스크립트, 메타인지 피드백을 학습해 제안한다. 학습 그룹은 drive를 쓰지 않으므로 Helm과 동시에 켤 수 있다. 저장은 L2 지식 능력(L2-d, `cap-knowledge`)이 맡는다.
   - [제안] 첫 동작(M3)의 범위는 스킬 md와 메타인지 피드백 제안이다. 반복 작업 스크립트 제안은 2차다(layer-plan-v2.json L3-c 단계 '2차', `product.scope.spec` 4.5).

### 4.2 대상 사용자와 배포

- [결정: decisions-log 2026-10-19] 본인이 먼저 쓰고, 이후 공개 릴리즈한다. 그래서 설계는 처음부터 배포 가능한 형태를 전제로 한다. 설치 경로, 설정 위치, 비밀 저장이 특정 기기에 묶이면 안 된다.
- [결정: decisions-log 2026-10-19] 첫 지원 OS는 macOS와 Linux(WSL 포함)다. Windows 네이티브는 나중에 지원한다.
- [결정: decisions-log 2026-10-21 3차, ADR-0008] 데스크톱 셸은 Tauri 2다. Tauri 2는 3플랫폼을 지원하지만 첫 지원 OS 범위는 위 결정을 따른다.
- [제안] 배포 형태는 단일 실행 파일(`bun build --compile`)이다. CLI와 데스크톱 사이드카가 같은 엔진 빌드를 쓴다(foundation-plan.md §2 빌드 행).

### 4.3 설계 원칙

| # | 원칙 | 표지와 근거 |
|---|---|---|
| a | 바퀴를 다시 만들지 않는다. F~L2는 검증된 오픈소스(pi, oh-my-pi, opencode, Claude Code, Hermes, pi durable)를 채택하거나 포크한다. 설계 노력은 L2·L3 자율 확장과 제2의 Helm을 쉽게 추가하는 스키마에 둔다. | [결정: decisions-log 2026-10-21 배포 단위 정정, 2차(패키지 사용·포크 적극 채택)] |
| b | OS와 환경마다 달라지는 부분은 L0 공통 인터페이스 뒤에 둔다. 소비자 코드에는 OS 분기를 두지 않는다. | [결정: decisions-log 2026-10-19 설계 규칙] |
| c | 의존은 한 방향(F → X → L0 → L1 → L2 → L3 → L4)으로만 흐른다. 실행은 continuation 규칙(replay, resume)을 따른다. 프로세스가 죽어도 저장된 이벤트에서 이어서 실행한다. | [결정: decisions-log 2026-10-21 구상 변경, ADR-0004] |
| d | 비밀은 에이전트가 값을 모르는 참조(`secret://이름`)로만 쓴다. 값은 모델 컨텍스트, 이벤트, 로그에 넣지 않는다. | [결정: decisions-log 2026-10-21 2차] |
| e | 설정은 F5 설정 스키마 하나에서 L4 화면, 설정 파일, 명령을 함께 생성한다. | [제안: layer-plan-v2-notes.md 층 사이 규칙 6] 사용자 결정(decisions-log 2026-10-21 2차)은 "추론 예산, 라우팅, 레이트 리밋, 계정 회전을 L4 설정 화면에서 조작"까지다. 생성 방식은 계획 v2의 규칙이다. |
| f | 위장 provider(pi-ai Anthropic OAuth 경로)는 릴리즈에서 제외하고 별도 커스텀 플러그인으로 제공한다. | [결정: decisions-log 2026-10-21 2차] 별도 플러그인의 공개 배포 여부는 [미결]이다. |

원칙 c의 단방향 의존은 `eng.dependency-rules.guide`가, 원칙 d의 참조·마스킹 규칙은 `L0.secrets.spec`이, 원칙 e의 스키마는 `F.wire-settings.spec`이 강제 수단을 정한다.

## 5. 실패와 경계 사례

- 스킬이나 일반 플러그인으로 충분한 기능은 의도 그룹으로 만들지 않는다. 모델의 행동을 코드로 막거나 구동해야 할 때만 그룹을 쓴다(7절).
- drive 임대는 한 번에 그룹 하나만 가진다(layer-plan-v2-notes.md 층 사이 규칙 4). 두 그룹이 동시에 drive를 요청하는 경우의 중재는 `L3.group-kit.spec`과 `X.primitives.spec`이 정한다. [미결] 대기와 거부 중 기본 동작.
- 그룹 켜기·끄기는 step 중간에 적용하지 않는다. 사용자가 턴 중에 끄면 다음 단계 경계에서 적용된다. 진행 중인 `loop.turn`은 끊지 않는다(`X.primitives.spec` §4.5.3).
- 비밀 출력 마스킹은 보조 수단이다. 분할, 재인코딩 같은 변형은 마스킹으로 잡지 못하므로 값이 모델 경로에 들어가지 않는 주입 모드를 기본으로 둔다(secrets.md §0, §6.3).

## 6. 설정 노출

해당 없음. 설정 탭 구성은 `L4.settings-ui.spec`이, 설정 키는 `F.wire-settings.spec`이 정한다.

## 7. 확장 지점: 의도 그룹에 코드 수준 제어가 필요한 이유

### 7.1 이유

[결정: decisions-log 2026-10-21 사용자 의중] Helm(탐구, 새 관점, 모르는 분야 지식을 현재 작업에 적용하는 발견 지원)을 스킬이나 일반 플러그인으로 두면 모델에 강제력이 없다. 스킬은 프롬프트에 들어가는 지시문이라 모델이 따르지 않아도 막을 수단이 없다. 그래서 Xeon은 그룹이 다음 세 방식으로 루프를 직접 제어하게 한다.

- `on`(fold first): 도구 호출을 거부한다.
- `on`(fold chain): 모델 요청을 형성한다.
- `drive`: 턴을 직접 구동한다. 서브에이전트를 띄우고 결과를 커밋한 뒤 다음 턴 입력을 만든다.

같은 사용자 의중에 따라 제2의 Helm 같은 사상도 루프에 붙였다 뗄 수 있어야 한다. `scope`가 이 단위를 제공한다(ADR-0007).

### 7.2 Helm 의사코드에서 가져온 예시

아래는 layer-plan-v2-notes.md "Helm이 보이는 모양(의사코드)"에서 가져온 예시다. 지점 이름(`request`, `tool.before`, `turn.end`)은 의사코드의 표기이며, 실제 지점 이름은 `F.extensions.spec`의 지점 선언 표를 따른다.

| 예시 | 연산과 fold | 지점 종류 | 의사코드 | 스킬로 했을 때와의 차이 |
|---|---|---|---|---|
| 탐구 단계에서 쓰기 도구 거부 | `on`, first | tool | `g.on("tool.before", (call, st) => st.phase === "diverge" && isWrite(call) ? { deny: "탐구 단계는 읽기 전용" } : undefined)` | 스킬로는 "쓰지 말라"는 지시문만 프롬프트에 넣을 수 있다. first 핸들러는 도구 실행 전에 호출을 거부하고 거부 사유를 모델에 돌려준다. |
| 단계별 시스템 프롬프트 | `on`, chain | request | `g.on("request", (req, st) => ({ ...req, system: req.system + lensFor(st.phase) }))` | 스킬의 지시문은 모델이 읽고 따를 때만 효과가 있다. chain 핸들러는 매 요청의 system 필드를 그룹 상태(`st.phase`)에 맞게 바꾼다. |
| 병렬 렌즈 spawn 후 현재 작업에 적용 | `drive` (배타 임대) | boundary | `g.drive(async (loop, st) => { const views = await Promise.all(lenses(st).map(l => loop.spawn({ agent: "explorer", task: l }))); st = await g.commit(reduce(st, views)); await loop.turn({ input: applyPrompt(st) }); })` | 스킬을 쓰면 서브에이전트를 띄울지는 모델 판단에 맡겨진다. drive는 렌즈마다 서브에이전트를 병렬로 띄우고, 결과를 그룹 상태로 커밋한 뒤 그 결과를 적용하는 턴을 실행한다. |

관찰(`on`, tap)도 함께 쓴다. 의사코드의 `g.on("turn.end", (t, st) => g.note(signal(t)))`는 턴 결과에서 탐구 신호를 기록할 뿐 루프를 바꾸지 않는다.

drive 함수는 경계마다 마지막으로 커밋된 상태로 다시 호출되고, 효과는 `loop.turn`, `loop.spawn`, `post`로만 낸다(layer-plan-v2-notes.md 확장 지점 4연산). 그래서 프로세스가 중간에 죽어도 커밋된 그룹 상태에서 구동을 이어 갈 수 있다(원칙 c).

### 7.3 제2의 Helm을 붙였다 떼는 시나리오

[제안] 사용자가 "설계 검토 그룹"을 직접 만들어 붙이는 경우의 흐름이다. 그룹 이름 `review`는 예시다. 지점 이름(`request`, `tool.before`)은 7.2와 같은 의사코드 표기이며, 실제 지점 이름은 `F.extensions.spec`의 지점 선언 표를 따른다(ADR-0007 §3.3 [제안]에서는 `input.agent.before`, `tool.call.before`).

1. 사용자가 `group-kit`의 `defineGroup`으로 `review` 그룹 패키지를 만든다. 코어 패키지(`contracts`, `ext-host`, `platform-*`, `core-*`)는 수정하지 않는다.
2. 그룹은 `scope("review", { state })` 안에서 `on("request", …)`(chain)으로 검토 관점을 주입하고, `on("tool.before", …)`(first)로 검토 중 쓰기를 막는다.
3. 사용자가 설정 화면이나 명령에서 그룹을 켠다. 등록은 다음 단계 경계에서 활성화된다.
4. Helm이 켜져 있으면 두 그룹의 chain 핸들러가 정해진 순서로 합성되고, first 핸들러는 먼저 거부한 쪽이 결과를 정한다. 합성 순서는 X 운영 규칙(실행 순서와 tier)을 따른다(`X.operations.spec`).
5. `review`가 drive도 쓰려 하면 임대 중재를 거친다. Helm이 임대를 가진 동안 `review`는 임대를 받지 못한다(층 사이 규칙 4).
6. 사용자가 `runtime.scope("review").disable()`에 해당하는 동작을 실행하면 다음 단계 경계에서 핸들러가 디스패치에서 빠지고, 임대가 있었다면 반납이 기록된다. 진행 중인 `loop.turn`은 정착까지 진행하고, 정리는 Cordis dispose로 실행된다(층 사이 규칙 5, `X.primitives.spec` §4.5.3).
7. 그룹 상태 레코드는 확장 접두사 테이블에 남는다. 다시 켜면 마지막 상태에서 이어진다(ADR-0004).

## 8. 다른 문서와의 인터페이스

### 8.1 기존 Helm 설계와의 관계

`docs/design/01~26`은 홈서버 데몬과 커널 중심 전제로 쓴 Helm 설계 정본이다. Xeon은 이 문서를 참고 자료로 인용만 하고 병합하지 않는다(repo-survey.md §6.1 충돌 3, foundation-plan.md Context). 루프 포크 연결점, 이벤트 envelope, 비밀 마스킹 같은 절은 근거로 쓸 수 있지만, 사용자가 이견을 낸 전제(decisions-log 2026-10-19 이견 목록)는 따르지 않는다. 어느 절을 어떻게 가져오는지는 `architecture.overview.spec`이 정한다.

### 8.2 이 문서를 쓰는 문서

| 문서 id | 가져가는 것 |
|---|---|
| `product.usecases.spec` | 정의, 차별점, Helm·학습 그룹의 역할 |
| `product.scope.spec` | 대상 사용자, 첫 지원 OS, 설계 원칙, 성공 기준 |
| `architecture.overview.spec` | 원칙 a~f, 기존 설계와의 관계 |
| `L3.helm.spec`, `L3.learning.spec` | 7절의 제어 방식과 공존 조건 |

## 9. 수용 기준

### 9.1 비전 수준 성공 기준

모두 테스트로 확인할 수 있는 형태로 쓴다. 근거는 foundation-plan.md §6 M1 스모크다. 측정 시점은 `product.scope.spec`의 마일스톤 종료 조건이 정한다.

| # | 기준 | 확인 방법 |
|---|---|---|
| S1 | 코어 수정 없이 제2 그룹을 추가한다. | 그룹 패키지 하나를 추가하는 변경에서 `contracts`, `ext-host`, `platform-*`, `core-*` 경로의 diff가 0이고, 그 그룹이 쓰는 연산(`on`, `post`, `drive` 가운데 해당하는 것)이 통합 테스트에서 호출된다. [제안] 제2 그룹은 학습 그룹이고 `drive`를 쓰지 않으므로, `drive` 호출은 M1 테스트 그룹이 확인한다(`product.scope.spec` 4.4). |
| S2 | 프로세스를 강제 종료해도 이벤트가 이어져 재개된다. | 모델 테이프로 턴을 실행하던 엔진 프로세스를 SIGKILL로 종료하고 같은 DB를 다시 열면, 마지막 커밋 이벤트 다음 순번부터 기록이 이어지고 재개한 턴이 완료된다. |
| S3 | 그룹 켜기·끄기가 단계 경계에서 적용된다. | drive 그룹을 턴 도중에 끄면 다음 단계 경계 이후의 step에서는 그룹 핸들러가 호출되지 않고, 임대 반납 이벤트(`lease.released`, 사유 `disabled`)가 한 번 기록된다. 진행 중인 `loop.turn`은 중단되지 않고 정착까지 진행한다. |
| S4 | CLI와 데스크톱이 같은 엔진 계약을 쓴다. | 같은 모델 테이프와 입력으로 in-process 전송(CLI)과 stdio 전송(데스크톱 사이드카)을 실행하면 호스트 계약 메시지 열이 같다. |

### 9.2 문서 수용 기준

- 비전이 한 문단으로 요약되어 있다(문서 첫 절).
- 모든 [결정]에 decisions-log 날짜 또는 ADR 번호가 달려 있다.
- 이름 'Xeon'이 임시임을 [미결]로 밝히고 10절에 모았다.
- '커널만 상태 변경', '채팅이 아닌 에이전트', 홈서버 단일 사용자 전제를 확정 사실로 쓰지 않는다.

## 10. 미결 사항

| # | 항목 | 관련 절 | 확인 대상 |
|---|---|---|---|
| 1 | 최종 제품 이름. 'Xeon'은 임시 이름이다(decisions-log 2026-10-21 3차). | 1.1 | 사용자 |
| 2 | 위장 provider 별도 플러그인을 공개 배포할지, 본인 사용에만 둘지. | 4.3 f | 사용자 |
| 3 | 두 그룹이 동시에 drive를 요청할 때 기본 동작(대기 또는 거부). | 5, 7.3 | `X.primitives.spec`, `L3.group-kit.spec` |
| 4 | Helm을 내장 그룹으로 넣을지 기본 플러그인으로 넣을지. | 1.1 | `L3.helm.spec` |
| 5 | Helm 내부 설계 착수 시점. decisions-log 2026-10-21 2차는 "층 구성 계획 보완·합의 뒤 착수"로 적었다. | 7.2 | 사용자 |

- 6번(턴 경계 해석)은 `review.decisions-2` U-01로 정해 지웠다.
