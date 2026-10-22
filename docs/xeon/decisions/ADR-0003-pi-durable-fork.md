---
id: adr.0003
layer: adr
domain: pi-durable
kind: adr
status: accepted
depends_on: [adr.0002]
binds: [xeon/packages/platform-exec/**, xeon/packages/cap-workspace/**, xeon/packages/core-tasks/**, xeon/packages/core-persistence/**, xeon/packages/core-agents/**]
---

# ADR-0003 pi durable 부분 포크와 커널 직접 구현

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] "pi durable은 그대로 쓰지 않고 env·tools·images·truncate만 Chord 제거 포크, DI는 Cordis 하나"(`_research/decisions-log.md` 2026-10-21 결정(3차)). 세부는 `_research/foundation-plan.md §1` 표 1번 "권고안을 따른다"이고, 스파이크는 하지 않는다.
- `_research/layer-plan-v2-notes.md`는 이 항목을 "남은 결정"으로 적었다. 그 뒤 `_research/foundation-plan.md §1`과 `_research/decisions-log.md` 3차에서 결정으로 바뀌었으므로 이 ADR은 후자를 따른다.
- 개정: 2026-10-21 `review.decisions-2` §3 D-08(§3.1 `truncate.ts` 포크 위치를 `platform-exec`로 정함, §6 위치 미결 해소). 포크 대상은 그대로이고 위치만 정한 보충이라 같은 ADR 안에서 고쳤다(`adr.readme` §1.4). 사용자 확인을 거친 [결정]이다(2026-10-22).
- 부분 대체: 2026-10-22 ADR-0009. §3.2 마지막 항목(L1-b 루프의 `pi-agent-core` 1.3.0 정확 고정 + 훅 래핑)은 ADR-0009가 대체한다. pi-agent-core 루프는 core-loop로 포크해 자체 루프로 다시 설계하고 pi-agent-core 의존은 없앤다. 나머지 결정은 그대로라 상태는 accepted로 둔다(`adr.readme` §1.4 부분 번복).

## 2. 맥락

- 패키지 조사에서 pi durable(`@earendil-works/pi-durable`, MIT, 22.8k줄, "Experimental... changes without notice")이 계획의 여러 항목을 이미 구현했다는 것이 드러났다(`_research/packages.md §0` 4번, `§3`).
  - L1-a 소유 트리와 아래→위 abort, L1-b phase 체크포인트 루프, L1-f 원자 커밋·requestId 멱등·결과 불명 합성·fork, L1-g 자식 task 대화
  - X-b tasks 구동, L0-a `ExecutionEnv`, L2-a 도구 본문
- 그대로 쓰기 어려운 점이 넷이다(`_research/layer-plan-v2-notes.md` 남은 결정, `_research/packages.md §3` B안).
  1. Chord 전면 의존. Cordis와 DI가 둘이 된다(ADR-0002).
  2. 이벤트 저널이 없다. "no public semantic event channel"이 비목표로 적혀 있다(S:2657). ADR-0004의 이벤트 소싱과 모양이 다르다.
  3. SQLite `synchronous=NORMAL`이다(`sqlite/node.ts:191`). 단계 경계 FULL 결정(`_research/foundation-plan.md §2` DB 행)과 다르다.
  4. 실험 API이고 단일 프로세스 소유를 전제한다. 앱·CLI·서비스가 같은 세션을 여는 구조(ADR-0006)에 소유 규칙이 없다(`_research/refs/pi-durable.md §5.3` 1번).
- `_research/packages.md §3`의 선택지 표는 A(계획 그대로), B(durable 전체 포크), C(혼합)를 비교했고 잠정 판정은 C였다.
- Chord 의존 깊이 조사(`_research/durable-and-search-facts.md §A`):
  - env·tools·images·truncate의 import 폐포에 Chord 값 import는 0건이다. 타입 import는 8줄이고 모두 `import type`이다. `Context` 7곳, `JsonValue` 1곳이다(`§A-1`).
  - `Context`는 `{ readonly abortSignal }` 하나를 담는 취소 토큰이다. 런타임 접근은 `context.abortSignal` 38줄뿐이고 Chord의 service/inject/provide API 사용은 0건이다(`§A-1`, `§A-2`).
  - 대상은 25파일 4,792줄이다(env 5파일 2,250줄, tools 11파일 1,562줄, images 6파일 390줄, `truncate.ts` 205줄, `harness/define.ts` 44줄과 `harness/output.ts` 341줄)(`§A-3`).
  - 실제 결합은 타입 경로 `tools → harness/define.ts → harness/types.ts`(786줄, 타입 전용)에 있다. 도구 쪽 타입만 추출하면 100~200줄로 줄어든다고 추정한다(`§A-3`, [추정, 미측정]).
  - 값 치환이 필요한 테스트·헬퍼는 6파일이다(`§A-3`).

## 3. 결정

### 3.1 포크하는 것 (4개 모듈)

[결정] 다음 4개를 Chord를 제거해 포크한다(`_research/foundation-plan.md §1` 표 1번).

| 원본(`D/` = `packages/durable`) | 규모 | 포크 위치 [제안] | 바꾸는 점 |
|---|---|---|---|
| `D/src/env/*` (index, node, node-watch, decode, line-scan) | 5파일 2,250줄 | `xeon/packages/platform-exec` (L0-a, `_research/foundation-plan.md §3` "exec = pi durable env 포크") | `Context` import type 3줄을 `CancelScope`로 치환 |
| `D/src/tools/*` | 11파일 1,562줄 | `xeon/packages/cap-workspace` (L2-a 도구 본문) | `Context` import type 4줄 치환. `harness/define.ts`·`harness/types.ts` 의존을 추출한 도구 타입으로 교체 |
| `D/src/images/*` | 6파일 390줄 | `xeon/packages/cap-workspace` | Chord import 없음. 그대로 복사 |
| `D/src/truncate.ts` | 205줄 | `xeon/packages/platform-exec` [결정: review.decisions-2 §3 D-08] | import 없음. 그대로 복사. L1 `core-tools`와 L2 `cap-workspace`는 F 서비스(`ExecutionEnv` 계열)로 호출하고 구현을 import하지 않는다 |

- [결정] Chord `Context`(7곳)는 로컬 타입 `CancelScope`로 치환한다. Chord `JsonValue`(1곳, `harness/define.ts:1`)는 로컬 JSON 타입으로 치환한다.
- [결정] `harness/types.ts`(786줄)에서 도구 타입만 100~200줄 추출한다. 대상은 `ToolRegistration`, `ToolExecutionApi`, `ToolExecutionResult`, `ToolDiagnostic`과 이들이 참조하는 타입이다(`_research/durable-and-search-facts.md §A-3`).
- [제안] `CancelScope`의 형태는 아래와 같다. 이름과 필드는 Chord `Context`(`chord/src/types.ts:15-16`)와 같은 모양이라 포크 본문을 고치지 않는다.

  ```ts
  /** 취소 신호만 전달한다. DI 기능은 없다. */
  export interface CancelScope {
    readonly abortSignal: AbortSignal | undefined;
  }
  ```

  - [제안] `CancelScope`와 추출한 도구 타입은 F 층(`xeon/packages/contracts`)에 둔다. 포크 위치가 L0(`platform-exec`)와 L2(`cap-workspace`)로 나뉘므로 두 층이 공유할 수 있는 곳은 F뿐이다. 서브패스는 `F.capabilities.spec`이 정한다.
  - [제안] 테스트·헬퍼 6파일의 `BACKGROUND_CONTEXT`는 `{ abortSignal: undefined }`로, `withAbortSignal`은 직접 객체 조합으로 바꾼다(`_research/durable-and-search-facts.md §A-3`).
- [결정] 포크하지 않는 것: durable의 Harness, Session, Storage, scheduler. 이 부분은 Chord 값 import(`session/session.ts:1-3`, `harness/scheduler.ts:1-2` 등 41파일)가 있고 커널 결정과 모양이 다르다.

### 3.2 직접 구현하는 것 (커널 4개 하위 층)

[결정] 커널은 계획대로 직접 구현한다. durable `docs/spec.md`를 설계 근거로 인용한다(`_research/foundation-plan.md §1` 표 1번).

| 하위 층 | 패키지 | 주로 인용할 durable spec 범위 |
|---|---|---|
| L1-a 태스크 엔진 | `xeon/packages/core-tasks` | 소유 트리 1972-2200 |
| L1-b 루프 | `xeon/packages/core-loop` | 훅 표 2636-2660, 재생 3136-3170 |
| L1-f 영속성 | `xeon/packages/core-persistence` | requestId 2288-2301, 결과 불명 1917-1927·2082-2108, 재생 3136-3170 |
| L1-g 서브에이전트 | `xeon/packages/core-agents` | 소유 트리 1972-2200, requestId 2288-2301 |

durable `docs/spec.md` 인용 범위:

| 주제 | 줄 범위 | 내용(`_research/durable-and-search-facts.md §A-6`) |
|---|---|---|
| 소유 트리 | 1972-2200 | §5.4 소유 순회와 abort 전파, §5.5 구조적 동시성 |
| requestId 멱등 | 2288-2301 | 제출 상태표, 2300-2301행 dedupe 규칙 |
| 결과 불명 | 1917-1927, 2082-2108 | §5.2 효과 샌드위치(intent 단계 재오픈 시 효과가 났을 수 있음), orphaned·replay-unsafe |
| 훅 표 | 2636-2660 | §7.2 본문, 훅 합성 표(hook / composition / ordinary throw) |
| 재생 | 3136-3170 | 재생 시 정책 해석, 재생 때 beforeTool을 다시 실행하지 않음(3162-3163) |

- [가정] 줄 번호는 `~/projects/_ref/pi-src/packages/durable/docs/spec.md`(5,123줄) 사본 기준이다. 이 사본은 패키지 조사 기준 커밋 `cdaf6c2`(패키지 1.1.0)와 같다고 가정한다(`_research/packages.md` 머리말). `.helm-design-work/P4/pi-v1.1.0/packages/durable/docs/spec.md` 사본과는 574줄이 다르다(`documentRetentionMs`, `modelTools`, `closed` 관련 절이 한쪽에만 있음). 다른 사본으로 읽으면 줄 범위가 맞지 않는다.
- [결정] 커널 저장은 ADR-0004(SQLite 이벤트 소싱 + 투영, 단일 DB)를 따른다. durable의 체크포인트 모델과 `synchronous=NORMAL`은 따르지 않는다.
- L1-b 루프의 모델 호출부는 `pi-agent-core` 1.3.0 정확 고정 + 훅 래핑을 쓴다(`_research/foundation-plan.md §2` 모델·루프 행). "직접 구현"은 durable의 phase 루프를 포크하지 않는다는 뜻이다. 세부는 `L1.loop.spec`이 정한다. (2026-10-22 ADR-0009가 이 항목을 대체: pi-agent-core 루프를 core-loop로 포크한 자체 루프를 쓰고 pi-agent-core에 의존하지 않는다.)

### 3.3 DI

- [결정] DI는 Cordis 하나다(ADR-0002). 포크 코드는 Cordis를 import하지 않는다. 포크한 env 구현은 L0 `platform-exec`가 Cordis 서비스로 등록하고, 도구는 `ToolExecutionApi.env`로 env를 받는다(`_research/durable-and-search-facts.md §A-4`). 서비스 등록은 ext-host API로 한다.

### 3.4 포크 기록 규칙 [제안]

`docs/design/07 §3.3.1`의 vendor 배치(`UPSTREAM.json`, `PATCHES.md`, `LICENSES/`, 패치 표지)를 참고한다. 그대로 따르지는 않는다. Xeon은 포크 코드를 `vendor/` 대신 포크를 소비하는 패키지 안에 둔다(`_research/foundation-plan.md §3` "exec = pi durable env 포크").

- 포크 원본 경로와 고정 커밋: `https://github.com/earendil-works/pi`(원문 URL은 `L0.exec.plan`에서 확인), 경로 `packages/durable/src/{env,tools,images,truncate.ts}`, 커밋 `cdaf6c2`.
- 포크 코드 위치: 각 패키지의 `src/upstream/` 아래. 우리가 새로 쓴 연결 코드(`index.ts`, 타입 재export)는 `src/upstream/` 밖에 둔다.
- 기록 파일: 각 패키지 루트에 둔다.
  - `UPSTREAM.json`: `xeon/vendor/cordis/UPSTREAM.json`과 같은 형식. `upstream`, `commit`, `version`, `license`, `copiedPaths`(원본 → 포크 경로), `notCopied`, `modifications`.
  - `PATCHES.md`: 바꾼 점 목록. 패치 id, 파일, 바꾼 이유, 확인한 테스트.
  - `LICENSE.pi`: pi 저장소 MIT LICENSE 원문 사본.
- 패치 표지: 고친 줄 근처에 `// XEON-PATCH: <패치 id>` 주석을 단다. `PATCHES.md`, `UPSTREAM.json`, 표지 셋이 일치해야 한다.
- 라이선스 고지: 배포물의 서드파티 고지 파일에 pi(MIT) 항목을 넣는다. 고지 파일 위치는 `eng.toolchain.guide`가 정한다.

## 4. 결과

### 4.1 좋은 점

- 검증된 도구·env 본문을 재사용한다. `ExecutionEnv`는 프로세스 그룹 kill(`node.ts:278-295`), 출력 spill, watch를 포함하고(`_research/packages.md §2.2`), 적합성 스위트(`src/testing/env-conformance.ts`)가 함께 온다.
- 편집량이 작다. import 약 10줄 치환, 타입 추출 100~200줄, 헬퍼 수정 수십 줄이다(`_research/durable-and-search-facts.md §A-3`).
- Chord가 런타임과 타입 양쪽에서 사라진다. DI가 Cordis 하나로 유지된다(ADR-0002).
- 커널은 ADR-0004의 C안(이벤트 소싱 + 투영)과 처음부터 같은 모양으로 만든다. durable 커널을 포크해 구조를 뜯어고치는 비용(`_research/packages.md §3` 잠정 판정 이유)이 없다.
- durable spec의 소유 트리, requestId 멱등, 결과 불명 합성, 훅 합성 규칙을 설계 근거로 쓰므로 커널 설계가 검증된 선례를 따른다(`_research/refs/pi-durable.md §5.2`).

### 4.2 감수할 점

- 포크 유지 비용. upstream 변경을 자동으로 받지 않는다. 업그레이드할 때마다 `UPSTREAM.json` 기준으로 diff를 보고 다시 적용해야 한다.
- durable 실험 API의 변경을 추적하지 않는다. 포크 시점 이후의 버그 수정과 개선은 필요할 때만 수동으로 가져온다.
- 커널 자체 구현량. L1-a·b·f·g를 처음부터 만든다. durable의 36k줄 테스트 자산(`_research/packages.md §3` B안)은 설계 참고로만 쓴다.
- 타입 추출 규모는 추정이다. `harness/types.ts` 786줄에서 100~200줄만 필요하다는 것은 측정하지 않았다(`_research/durable-and-search-facts.md §A-3` [추정, 미측정]). 본문을 바꿀 필요가 없다는 것도 [추정]이고 타입체크로 확인한다.
- Chord 타입 의존이 남지 않았는지 지속적으로 확인해야 한다. [제안] 검증 방법:
  1. import 폐포 grep: 포크 패키지의 `src/`와 `test/`에서 `chord`를 import하는 줄이 0건인지 확인한다. 예: `grep -rnE "from ['\"][^'\"]*chord" xeon/packages/platform-exec xeon/packages/cap-workspace` 결과가 비어야 한다.
  2. 의존 목록 확인: 두 패키지의 `package.json` dependencies·devDependencies에 chord 계열 패키지가 없어야 한다.
  3. 타입체크: chord가 설치되지 않은 상태에서 `tsc -b`가 통과해야 한다. 타입 전용 import는 런타임에서 지워지므로 1·2번만으로는 남은 타입 의존을 놓칠 수 있다.
  4. 지속 강제: dependency-cruiser 규칙과 oxlint `no-restricted-imports`에 chord 금지를 넣는다(`eng.dependency-rules.guide`).
- 외부 의존이 따라온다. typebox(도구 4파일), diff(`tools/edit-diff.ts:5`), `@silvia-odwyer/photon`(images, wasm), pi-ai(`harness/define.ts:2`, 타입 전용)(`_research/durable-and-search-facts.md §A-3`). photon wasm이 `bun build --compile` 산출물에서 로드되는지는 확인하지 않았다([가정], `L2.workspace.plan`에서 확인).
- durable tools는 read·write·edit·bash·image뿐이다. grep·find·ls는 없다(`_research/packages.md §2.2`). 이 도구들은 cap-workspace에서 따로 만든다.

## 5. 대안

| 안 | 내용 | 채택하지 않은 이유 |
|---|---|---|
| A. 계획 그대로 | agent-core 훅 래핑 + 자체 이벤트 소싱·task 트리 + Cordis. durable 코드 미사용 | env·도구 본문까지 새로 만들어야 한다. durable의 env가 계획보다 낫고 경계가 깨끗하다(`_research/packages.md §3` 잠정 판정 이유) |
| B. durable 전체 포크 | Harness·Session·Storage·scheduler를 포크해 L1 커널로 | Chord 전면 채택으로 Cordis와 이중 DI, 이벤트 저널 비목표(S:2657), `synchronous=NORMAL`, 단일 프로세스 소유, 23k+8.8k줄 유지 부담(`_research/packages.md §3`) |
| C. 혼합 (채택) | A 기반 + env·tools·images·truncate 포크 + 소유 트리·requestId·결과 불명 규격은 설계 인용 | — (`_research/packages.md §3`의 C안은 env를 "그대로" 쓰고 Chord `Context`를 경계 타입으로 남겼다. 채택안은 env도 포크하고 Chord를 타입까지 제거한다) |
| D. npm 그대로 사용 | `@earendil-works/pi-durable`을 npm 정확 고정 의존으로 | Chord가 의존으로 따라오고, 실험 API라 무고지 변경이 있다. `/tools`는 Harness 확장 객체로만 노출된다(`_research/packages.md §1.1`, `§2.2`) |
| E. 1~2일 스파이크 후 결정 | "durable Session을 이벤트 저널 위에 얹을 수 있는가"를 확인 | 사용자가 하지 않기로 했다(`_research/foundation-plan.md §1` 표 1번 "스파이크는 하지 않는다") |

## 6. 미결 사항

- [미결] `CancelScope`와 추출한 도구 타입의 F 서브패스. `F.capabilities.spec`과 `F.conversation.spec` 중 어디에 둘지 F 문서가 정한다.
- [미결] tools·images의 위치. 이 ADR은 `cap-workspace`를 제안했다. truncate는 L1 도구 디스패치(`core-tools`)의 출력 절단에도 쓰이므로 `platform-exec`에 두고 F 서비스로 부른다 [결정: review.decisions-2 §3 D-08].
- [미결] pi 저장소 원문 URL과 `cdaf6c2`가 원본 커밋으로 맞는지 확인. `_ref/pi-src` 사본 기준이다.
- [미결] 포크 업그레이드 정책. 정기 diff 확인을 할지, 보안·버그 수정이 있을 때만 할지.
- [미결] durable 적합성 스위트(`env-conformance.ts`, 저장소 `registerStorageConformance`)를 포크해 커널 테스트에 쓸지. 저장소 스위트는 Session 커밋 API에 묶여 있다(`_research/refs/pi-durable.md §5.1`).
