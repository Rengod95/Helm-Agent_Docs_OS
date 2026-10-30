---
id: eng.anti-patterns.guide
layer: eng
domain: anti-patterns
kind: guide
status: draft
depends_on: [eng.dependency-rules.guide, eng.typescript.guide, eng.events.design]
binds: [xeon/**]
---

# 안티패턴

Xeon 코드에서 반복해서 나오기 쉬운 잘못된 구조를 모은 구속 문서다. 항목마다 증상, 문제가 되는 이유와 근거, 나쁜 예와 좋은 예, 감지 방법을 둔다. 같은 주제의 "기본 선택"은 `eng.best-practices.guide`(`../best-practices/guide.md`)에 있고, 짝이 되는 규칙은 항목마다 링크한다.

## 1. 적용 범위

- 대상 코드: `xeon/**` 전부다. 패키지(`packages/*`), 앱(`apps/*`), 플러그인(`plugins/*`), 스크립트(`scripts/*`), 테스트 파일을 포함한다. `xeon/vendor/**`는 원본을 고치지 않으므로 대상에서 뺀다. 다만 vendored 코드를 감싸는 래퍼는 대상이다.
- 대상 작업: `routes.yaml`의 `by_task.implement`에 속하는 모든 작업(코드를 쓰거나 고치는 작업)과 리뷰다.
- 다른 구속 문서와의 관계:
  - 층 순위와 import 규칙 자체는 `eng.dependency-rules.guide`(`../dependency-rules/guide.md`)가 정한다. 이 문서의 AP-A 항목은 그 규칙을 어기는 전형적인 모양과 감지법만 다룬다.
  - 타입 규칙(브랜드 ID, `Result`, 금지 구문)은 `eng.typescript.guide`(`../typescript/guide.md`)가 정한다. AP-C 항목은 그 규칙을 어긴 코드의 모양을 보인다.
  - 이벤트 종류, 내구·휘발 구분, 재생 규칙은 `eng.events.design`(`../events/design.md`)이, 원자성과 트랜잭션 경계는 `eng.transactions.design`(`../transactions/design.md`)이 정한다. AP-S의 저장 항목은 그 설계를 어기는 모양이다.
  - 도구 설정과 버전 고정은 `eng.toolchain.guide`(`../toolchain/guide.md`), 테스트 작성법은 `eng.testing.guide`(`../testing/guide.md`)가 정한다.
- 규칙이 서로 다르게 읽히면 위 문서들의 규칙이 이 문서보다 앞선다. 이 문서의 예제는 그 규칙의 사례다.
- 예제의 확장 지점 이름(`tool.call.before`, `tool.result`, `boundary.step.after` 등)은 `F.extensions.spec` §3.4 표의 이름이다. 지점 목록은 `F.extensions.spec`이 확정한다(ADR-0007 §3.3).
- 예제의 `Result`, `ok`, `err`, 브랜드 타입, `Clock`, `IdFactory`, `RandomSource`는 `eng.typescript.guide` 1.2절과 `eng.domain-types.guide` DT-06의 이름이다. 이벤트 kind와 envelope 필드(`DurableEventEnvelope`, `kind`, `version`, `payload`, `recordedAt`)는 `F.records.spec`과 `eng.events.design`, 세션 쓰기 경로(`SessionService.commit`, `CommitRequest`)는 `eng.transactions.design`과 `L1.persistence.spec` §3.2~§3.3, 서비스 이름은 `eng.context-map.design` 5.3절의 이름이다.

## 2. 안티패턴

번호 형식은 `AP-<단위>-NN`이다. 단위는 A(아키텍처), C(코드), S(스택) 셋이다. 번호는 한 번 쓰면 바꾸지 않는다. 항목을 없앨 때는 번호를 비워 두고 "폐기"로 표시한다.

### 2.1 요약 표

| ID | 이름 | 짝 규칙 | 주 감지 수단 |
|---|---|---|---|
| [AP-A-01](#ap-a-01) | 같은 층 패키지 import | BP-09, BP-11 | `check-layers.ts`, dependency-cruiser |
| [AP-A-02](#ap-a-02) | 상향 의존 | BP-11 | `check-layers.ts`, dependency-cruiser |
| [AP-A-03](#ap-a-03) | 그룹 간 직접 호출 | BP-03 | `check-layers.ts`, 리뷰 질문 |
| [AP-A-04](#ap-a-04) | 구 설계 전제 복귀: 커널만 상태 변경 | BP-03, BP-08 | 리뷰 질문 |
| [AP-A-05](#ap-a-05) | 구 설계 전제 복귀: 홈서버 데몬 필수 | BP-06 | 리뷰 질문, M1 스모크 |
| [AP-A-06](#ap-a-06) | Effect와 Cordis 이중 DI | BP-05 | `no-restricted-imports`, 리뷰 질문 |
| [AP-A-07](#ap-a-07) | 확장의 상태 변경 우회 경로 | BP-03 | `no-restricted-imports`, `check-layers.ts` |
| [AP-A-08](#ap-a-08) | 격리 없이 신뢰 등급만 선언 | BP-03 | 리뷰 질문 |
| [AP-A-09](#ap-a-09) | `drive` 남용과 클로저 상태 | BP-03 | 재생 테스트, 리뷰 질문 |
| [AP-C-01](#ap-c-01) | `any`와 타입 단언 남발 | BP-01 | oxlint |
| [AP-C-02](#ap-c-02) | 광역 try/catch로 오류 삼킴 | BP-04 | oxlint `no-empty`, `preserve-caught-error`, 검사 스크립트 [제안], 리뷰 질문 |
| [AP-C-03](#ap-c-03) | throw를 흐름 제어에 사용 | BP-04 | 리뷰 질문 |
| [AP-C-04](#ap-c-04) | 모듈 전역 가변 상태 | BP-02, BP-05 | oxlint 일부, 리뷰 질문 |
| [AP-C-05](#ap-c-05) | `Date.now`·`Math.random` 직접 호출 | BP-05 | 검사 스크립트 [제안] |
| [AP-C-06](#ap-c-06) | 트랜잭션 안에서 외부 호출 await | BP-02, BP-08 | 리뷰 질문, 검사 스크립트 [제안] |
| [AP-C-07](#ap-c-07) | 테스트 안 sleep | (eng.testing.guide) | 검사 스크립트 [제안] |
| [AP-C-08](#ap-c-08) | 비밀 값 출력·로그 | BP-07 | gitleaks, 리뷰 질문 |
| [AP-C-09](#ap-c-09) | L0·L1에서 console이나 로거 직접 생성 | BP-12 | oxlint `no-console`, `no-restricted-imports` |
| [AP-C-10](#ap-c-10) | 단언을 다른 모양으로 감춘 typed programming 안티패턴 | BP-01, BP-04 | oxlint `no-unnecessary-type-parameters`, `ban-ts-comment`, 리뷰 질문 |
| [AP-C-11](#ap-c-11) | 예상 가능한 실패를 `Bug`로 던짐 | BP-04 | 검사 스크립트 [제안], 리뷰 질문 |
| [AP-S-01](#ap-s-01) | fsync 없는 JSONL 세션 쓰기 | BP-08 | `no-restricted-imports`, 리뷰 질문 |
| [AP-S-02](#ap-s-02) | 토큰마다 이벤트 저장 | BP-08 | 단위 테스트, 리뷰 질문 |
| [AP-S-03](#ap-s-03) | 확장별 DB 파일로 원자성 상실 | BP-08 | `no-restricted-imports`, 리뷰 질문 |
| [AP-S-04](#ap-s-04) | provider 위장 경로 본체 혼입 | BP-09 | 검사 스크립트 [제안], 배포 매니페스트 |
| [AP-S-05](#ap-s-05) | 검증 없는 바이너리 자동 다운로드 | BP-02 | 리뷰 질문 |
| [AP-S-06](#ap-s-06) | 저장소 오류 시 프로세스 전체 종료 | BP-04 | 리뷰 질문, 단위 테스트 |
| [AP-S-07](#ap-s-07) | Vitest 도입 | (eng.testing.guide) | `no-restricted-imports` |
| [AP-S-08](#ap-s-08) | 버전 범위(`^`, `~`) 사용 | (eng.toolchain.guide) | 검사 스크립트 [제안] |
| [AP-S-09](#ap-s-09) | oxfmt 문제 시 Biome 복귀 | (eng.toolchain.guide) | 리뷰 질문 |
| [AP-S-10](#ap-s-10) | FTS5 가용성 가정 | BP-02 | 시작 검사, 리뷰 질문 |

### 2.2 아키텍처 (AP-A)

<a id="ap-a-01"></a>
#### AP-A-01 같은 층 패키지 import

- 증상: `core-loop`가 `core-models`를 import하거나, `cap-web`이 `cap-knowledge`의 함수를 직접 부른다.
- 왜 문제인가:
  - [결정] 같은 층의 패키지끼리는 import하지 않는다. 같은 층 협력은 F 정의와 Cordis 서비스로만 한다(`_research/foundation-plan.md §3` "층 순위와 의존 방향", `architecture.layers.spec §3` 규칙 2).
  - 같은 층 간선이 생기면 패키지 교체와 그룹 단위 켜고 끄기가 어려워진다. 사용자가 층마다 플러그인을 교체할 수 있어야 한다는 결정(`_research/decisions-log.md` 2026-10-21 배포 단위 정정)과 맞지 않는다.
  - 같은 층 예외는 두 개뿐이다. `group-*` → `group-kit`(`DR-02/group-kit`)과 `apps/cli` → `apps/host`(`DR-10/cli-host`)다([결정: review.decisions-2 U-15], `eng.dependency-rules.guide` 4절 허용 목록). `plugins/*`는 L1 순위이고 같은 층 예외가 없다([결정: review.decisions-2 U-16]).
- 나쁜 예:

  ```ts
  // xeon/packages/core-loop/src/run.ts
  import { createModelClient } from "@xeon/core-models"; // L1 → L1

  const client = createModelClient({ provider: "anthropic" });
  ```

- 좋은 예:

  ```ts
  // xeon/packages/core-loop/src/run.ts
  import type { ModelService } from "@xeon/contracts/capabilities"; // F 정의만 안다(eng.context-map.design 5.3절)

  export function createRunner(deps: { readonly models: ModelService }) {
    return async (input: TurnInput) => deps.models.stream(input.request);
  }
  // 플러그인 등록부(ext-host 래퍼)가 Cordis 서비스 "xeon.models"를 주입한다.
  ```

- 감지 방법: `just check-layers`(같은 층 import와 선언되지 않은 워크스페이스 import를 거부), `just depcruise`. 규칙 원본은 `eng.dependency-rules.guide`다.

<a id="ap-a-02"></a>
#### AP-A-02 상향 의존

- 증상: L0 `platform-store`가 L1 `core-persistence`의 타입을 import하거나, `contracts`(F)가 `ext-host`(X)를 import한다. 순환 import로 드러나기도 한다.
- 왜 문제인가:
  - [결정] 층 순위는 F → X → L0 → L1 → L2 → L3 → L4이고, 패키지는 자기보다 낮은 순위만 import한다(`_research/foundation-plan.md §3`).
  - 위층 타입을 아래층이 알면 아래층을 단독으로 테스트하거나 교체할 수 없다. OS별 구현만 바꾼다는 설계 규칙(`_research/decisions-log.md` 2026-10-19 "설계 규칙")도 L0가 위층에 묶이면 지킬 수 없다.
- 나쁜 예:

  ```ts
  // xeon/packages/platform-store/src/append.ts  (L0)
  import type { TurnState } from "@xeon/core-loop"; // L0 → L1

  export function appendTurn(state: TurnState) { /* ... */ }
  ```

- 좋은 예:

  ```ts
  // xeon/packages/platform-store/src/rows.ts  (L0)
  import type { DurableEventEnvelope } from "@xeon/contracts/records"; // L0 → F

  export function toEventRow(event: DurableEventEnvelope): EventRow { /* ... */ }
  // core-loop(L1)가 turn 상태를 DurableEventDraft로 만들어 SessionService.commit에 넘긴다. L0은 F 타입만 안다.
  ```

- 감지 방법: `just check-layers`, `just depcruise`, oxlint `import/no-cycle`. 아래층에 위층 개념이 필요해 보이면 그 개념의 타입을 F로 내리는 변경을 먼저 한다(`eng.best-practices.guide` BP-01).

<a id="ap-a-03"></a>
#### AP-A-03 그룹 간 직접 호출

- 증상: `group-helm`이 `group-learning`을 import해 학습 결과를 읽거나, 학습 그룹의 내부 상태를 Cordis 서비스로 꺼내 Helm이 직접 바꾼다.
- 왜 문제인가:
  - [결정] 그룹끼리는 직접 참조하지 않는다(`architecture.layers.spec §3.1` 3행, `_research/layer-plan-v2-notes.md` "층 사이 규칙"). 그룹 사이 정보는 L2 능력의 레코드와 서비스(예: L2 knowledge 검색)로만 주고받는다(`eng.context-map.design` 3절 협력 규칙 7, CM-06).
  - [결정: review.decisions-2 D-10] 그룹 사이 레코드의 스키마는 F에 두지 않는다. 그룹은 다른 그룹의 비공개 레코드(`grp.<다른 그룹>.*`)를 읽지 않는다.
  - 사용자가 그룹 간 강결합을 우려했다(`_research/decisions-log.md` 2026-10-21 사용자 의중). Helm과 학습 그룹은 따로 켜고 끌 수 있어야 하고, 학습 그룹은 Helm 없이도 동작해야 한다.
- 나쁜 예:

  ```ts
  // xeon/packages/group-helm/src/lens.ts
  import { pendingSkills } from "@xeon/group-learning"; // L3 → L3

  export const lensFor = () => pendingSkills().map((s) => s.title);
  ```

- 좋은 예:

  ```ts
  // xeon/packages/group-helm/src/lens.ts
  // 학습 결과는 L2 knowledge가 저장한다. Helm은 그 검색 서비스로만 읽는다. 학습 그룹이 꺼져 있으면 결과가 비어 있을 뿐이다.
  const hits = await knowledge.search({ query: topic, kinds: ["skill", "memory"], limit: 5 });
  ```

  학습 그룹의 `grp.learning.*` 이벤트를 Helm이 구독하지 않는다(D-10).

- 감지 방법: `just check-layers`(L3 같은 층 import 거부). 리뷰 질문: "이 그룹은 다른 그룹이 꺼져 있어도 시작하고 동작하는가?"

<a id="ap-a-04"></a>
#### AP-A-04 구 설계 전제 복귀: 커널만 상태 변경

- 증상: 모든 상태 변경을 한 곳의 "커널 리듀서"로 모으고, 확장·도구·그룹이 상태를 바꾸려면 커널 명령을 만들어 보내도록 하는 구조를 다시 만든다. `docs/design/10-kernel.md`의 지시(`Directive`)나 커널 상태 검사를 옮겨 온다.
- 왜 문제인가:
  - [결정] 사용자가 "커널만 상태 변경"에 이견을 밝혔고, 제품 방향을 대화형 런타임으로 바꿨다(`_research/decisions-log.md` 2026-10-19 이견 목록). 기존 `docs/design/01~26`은 커널·홈서버 데몬 전제라 그대로 따르지 않는다(`_research/README.md`).
  - Xeon의 상태 변경 경로는 확장 지점 4연산과 서비스다(ADR-0007). 원자성은 단일 DB 트랜잭션이 보장한다(ADR-0004). 별도의 커널 관문을 두면 같은 보장을 두 번 구현하게 된다.
- 나쁜 예:

  ```ts
  // xeon/packages/core-loop/src/kernel.ts
  export function kernelApply(state: World, cmd: KernelCommand): World {
    switch (cmd.type) {
      case "tool.approve": return { ...state, approvals: [...state.approvals, cmd.id] };
      case "helm.phase":   return { ...state, helm: { phase: cmd.phase } }; // 그룹 상태까지 커널이 소유
      // ... 모든 변경이 여기를 지난다
    }
  }
  ```

- 좋은 예:

  ```ts
  // 그룹 상태는 그룹 scope의 상태 레코드가 소유하고, 커밋은 단일 DB 트랜잭션이 원자성을 맡는다.
  export const Helm = scope("helm", { state: doc<HelmState>() }, (g) => {
    g.on("boundary.step.after", async (t, st) => { await g.commit(nextPhase(st, t)); }); // [가정] 지점 이름
  });
  ```

- 감지 방법: 감지 도구 없음. 리뷰 질문: "이 변경은 Xeon 문서(ADR-0004, ADR-0007)에 없는 중앙 상태 관문을 새로 만드는가? `docs/design/` 절을 근거로 들었다면 Xeon 문서가 같은 결정을 했는가?"

<a id="ap-a-05"></a>
#### AP-A-05 구 설계 전제 복귀: 홈서버 데몬 필수

- 증상: CLI가 시작하면서 고정 주소의 서버에 연결을 시도하고, 연결이 없으면 실패한다. 또는 엔진 코드가 `/srv/...` 같은 서버 경로, 상주 프로세스 존재, 단일 사용자 홈서버를 전제한다.
- 왜 문제인가:
  - [결정] 사용자가 "나만 쓰는 로컬 홈서버 전제"에 이견을 밝혔다(`_research/decisions-log.md` 2026-10-19).
  - [결정] 프로세스 구조는 엔진 라이브러리 + 단일 호스트 계약 + 전송 교체다. CLI는 in-process로 돌고, 데스크톱은 자식 엔진을 쓴다. 데몬은 `xeon service`(자동 기동, 유휴 종료)이고 예약·원격·알림 범위에서만 쓴다(`_research/foundation-plan.md §1` 2번, `_research/decisions-log.md` 계획 v2·3차, ADR-0006).
  - M1 스모크는 데몬 없이 `xeon chat` 한 턴과 강제 종료 후 재개를 확인한다(`_research/foundation-plan.md §6`).
- 나쁜 예:

  ```ts
  // xeon/apps/cli/src/main.ts
  const ws = new WebSocket("ws://127.0.0.1:7777/helmd"); // 데몬이 없으면 CLI가 동작하지 않는다
  ws.addEventListener("error", () => process.exit(1));
  ```

- 좋은 예:

  ```ts
  // xeon/apps/cli/src/main.ts
  // 엔진 조립 코드는 apps/host에 있다. apps/cli → apps/host는 허용 목록 DR-10/cli-host다(review.decisions-2 U-15).
  import { createEngine, inProcessTransport } from "@xeon/host";

  const engine = await createEngine({ transport: inProcessTransport() });   // 데몬 없이 같은 프로세스에서 엔진을 띄운다
  // 서비스 모드(1차)는 사용자가 예약·원격·알림 기능을 쓸 때만 따로 붙는다. 원격은 로컬 서비스 소켓을 SSH 터널이나 사설망으로 연결한다(review.decisions-2 U-11).
  ```

- 감지 방법: M1 스모크(데몬 없이 한 턴). 리뷰 질문: "이 기능은 상주 프로세스가 없을 때 무엇을 하는가? 데몬이 꼭 필요한 기능이면 ADR-0006의 서비스 모드 범위 안인가?"

<a id="ap-a-06"></a>
#### AP-A-06 Effect와 Cordis 이중 DI

- 증상: opencode의 `@opencode/ai`처럼 Effect `Layer`로 의존을 묶는 패키지를 그대로 가져와 Cordis 서비스와 함께 쓴다. 또는 pi durable의 Chord, `tsyringe`·`inversify` 같은 다른 컨테이너를 들인다.
- 왜 문제인가:
  - [결정] DI는 Cordis 하나다(`_research/decisions-log.md` 3차, ADR-0002 §3).
  - Effect 기반 패키지를 Cordis와 함께 쓰면 의존성 주입과 수명 관리 체계가 둘이 된다(`_research/ref-synthesis.md` "피할 것"). 수명이 둘이면 그룹을 끌 때 정리(dispose)가 한쪽에서만 일어난다.
- 나쁜 예:

  ```ts
  import { Effect, Layer } from "effect";
  import { SessionProjector } from "@opencode/ai/session"; // Effect Layer에 묶인 투영기

  const live = Layer.provide(SessionProjector.Live, DbLayer);
  ctx.provide("projector", Effect.runSync(Effect.provide(SessionProjector, live))); // 수명이 두 곳
  ```

- 좋은 예:

  ```ts
  // opencode는 설계만 채택하고(ref-synthesis "층별 채택안" 세션 로그 행), 투영기는 F 타입 위에 직접 쓴다.
  export function projectItemRecorded(tx: ProjectionTx, ev: DurableEventEnvelope, p: ItemRecordedPayload): void {
    tx.run("INSERT INTO p_items (item_id, event_id, thread_id, kind, seq) VALUES (?, ?, ?, ?, ?)",
      [p.item.itemId, ev.id, ev.threadId, p.item.kind, ev.seq]);
  }
  // 서비스 등록과 dispose는 ext-host의 Cordis 래퍼 하나로만 한다.
  ```

- 감지 방법: `no-restricted-imports`에 `effect`, `effect/*`, `@opencode/*`, `tsyringe`, `inversify`를 추가한다 [제안]. knip과 `package.json` 리뷰로 새 DI 패키지 유입을 본다. 리뷰 질문: "이 의존은 자기 수명 관리(Layer, Scope, container)를 갖는가?"

<a id="ap-a-07"></a>
#### AP-A-07 확장의 상태 변경 우회 경로

- 증상: 그룹이나 플러그인이 `platform-store`를 직접 열어 세션 이벤트를 쓰거나, 루프 객체의 내부 배열에 메시지를 push하거나, 다른 그룹의 상태 레코드를 바꾼다.
- 왜 문제인가:
  - [결정] 확장이 루프에 개입하는 연산은 `on`, `post`, `drive`, `scope` 넷뿐이다. `drive`의 효과도 `loop.turn`, `loop.spawn`, `post`로만 낸다(ADR-0007 §3.1).
  - 우회 경로로 쓴 기록은 `requestId` 멱등, 단계 경계 토글, 재생 규칙을 거치지 않는다. 재개 때 같은 입력이 두 번 들어가거나, 꺼진 그룹이 상태를 계속 바꾼다.
  - 확장 기록은 단일 DB의 확장 접두사 테이블(`x_<확장 id의 '-'를 '_'로>_`, `eng.context-map.design` 5.2절)에 두고 코어 테이블과 섞지 않는다(ADR-0004 §3.3).
- 나쁜 예:

  ```ts
  // xeon/packages/group-helm/src/inject.ts
  import { openStore } from "@xeon/platform-store";

  export async function injectHint(threadId: ThreadId, text: string) {
    const db = openStore();
    db.run("INSERT INTO events (thread_id, seq, envelope) VALUES (?, ?, ?)", [threadId, nextSeq, hintEnvelope(text)]);   // item.recorded를 위조
  }
  ```

- 좋은 예:

  ```ts
  export function setup(g: GroupApi<HelmState>) {
    g.on("boundary.step.after", (t, st) => {
      if (!needsHint(st)) return undefined;
      g.post(hintMessage(st), { when: "next", requestId: requestIdFor("helm", st.turn) }); // 멱등 주입
      return undefined;
    });
  }
  ```

- 감지 방법: `check-layers.ts`의 DR-14 검사(컨텍스트가 다른 구현 패키지 import 금지, M1부터)가 그룹의 `@xeon/platform-store` import를 거부한다(`eng.dependency-rules.guide` DR-14). 편집기 안 즉시 피드백으로 `no-restricted-imports`에 `@xeon/platform-store`를 조립 루트(`apps/host`) 밖에서 금지하는 패턴을 둔다 [제안]. `check-layers.ts`가 선언되지 않은 import를 거부한다. 리뷰 질문: "이 그룹 코드의 효과는 `on` 반환값, `post`, `drive`, `g.commit` 중 어디로 나가는가?"

<a id="ap-a-08"></a>
#### AP-A-08 격리 없이 신뢰 등급만 선언

- 증상: 매니페스트에 신뢰 등급 2·3을 적은 외부 확장을 같은 프로세스, 같은 권한, 같은 Cordis 컨텍스트에 그대로 올린다. 능력 선언(필수·선택 능력)과 실제 접근 검사가 연결되어 있지 않다.
- 왜 문제인가:
  - 확장이 같은 프로세스·같은 권한으로 격리 없이 도는 구조를 신뢰 등급 2·3에 쓰지 않는다(`_research/ref-synthesis.md` "피할 것").
  - [결정] 확장 프로세스 격리는 기본값으로 두지 않는다(`_research/decisions-log.md` 2차). 그래서 in-process 확장에는 등급이 실제 능력 범위를 줄여야 한다. 등급이 표시용이면 사용자는 보호를 받는다고 오해한다.
  - 학습 산출물 쓰기도 같은 문제다. Hermes는 쓰기 승인과 스캔이 기본 꺼져 있어 학습 결과가 확인 없이 디스크에 쓰인다(`_research/ref-synthesis.md` "확장 지점" 5번).
- 나쁜 예:

  ```ts
  export async function loadExtension(manifest: ExtensionManifest, ctx: Context) {
    const mod = await import(manifest.entry);
    mod.default(ctx); // 등급과 무관하게 루트 컨텍스트 전체를 넘긴다
  }
  ```

- 좋은 예:

  ```ts
  export async function loadExtension(manifest: ExtensionManifest, host: ExtHost) {
    const granted = host.trust.grant(manifest.trust, manifest.capabilities); // 등급 → 허용 능력 집합
    if (!granted.ok) return granted;                                         // Result로 거부를 보고
    const mod: unknown = await import(manifest.entry);
    return host.activate(manifest.id, mod, granted.value);                   // 허용된 서비스만 보이는 하위 컨텍스트
  }
  ```

- 감지 방법: 감지 도구 없음. 리뷰 질문: "신뢰 등급 2·3 확장이 받는 컨텍스트에서 선언하지 않은 능력(파일 쓰기, 네트워크, 비밀 lease)에 접근할 수 있는가?" 세부 등급 정의는 `X.loading-trust.spec`이 정한다.

<a id="ap-a-09"></a>
#### AP-A-09 `drive` 남용과 클로저 상태

- 증상: 관찰이나 차단만 하면 되는 그룹이 `drive`를 잡는다. 학습 그룹이 `drive`를 쓴다. `drive` 함수가 진행 상태를 클로저 지역 변수에 두어, 재개 때 처음부터 다시 돈다.
- 왜 문제인가:
  - [결정] `drive`는 배타 임대이고 한 번에 그룹 하나만 가진다. 학습 그룹은 `drive`를 쓰지 않고 Helm과 함께 켤 수 있어야 한다(`_research/decisions-log.md` 계획 v2, ADR-0007 §3.6).
  - [제안] `drive` 함수는 마지막으로 커밋된 scope 상태로 다시 호출되어도 같은 진행을 내야 한다. 상태는 scope 상태 레코드에만 둔다(`_research/ext-points.md §5` 안 1 "재생·토글 보장", §6 판단 근거). 클로저에 둔 상태는 재개 때 사라지고, 이 위반은 타입으로 막지 못한다.
- 나쁜 예:

  ```ts
  export const Learning = scope("learning", { state: doc<LearnState>() }, (g) => {
    let reviewed = 0;                       // 클로저 상태: 재개하면 0으로 돌아간다
    g.drive(async (loop) => {               // 학습 그룹이 임대를 잡아 Helm과 공존할 수 없다
      while (reviewed < 3) { await loop.turn({ input: reviewPrompt() }); reviewed += 1; }
    });
  });
  ```

- 좋은 예:

  ```ts
  export const Learning = scope("learning", { state: doc<LearnState>() }, (g) => {
    g.on("boundary.step.after", async (t, st) => {     // 관찰 + 커밋. 검토 포크는 L1 백그라운드 위임으로 돌린다
      await g.commit(countTurn(st, t));
    });
  });

  export const Helm = scope("helm", { state: doc<HelmState>() }, (g) => {
    g.drive(async (loop, st) => {           // 진행 상태는 st에만 있다
      while (st.phase !== "done" && loop.budget.turns > 0) {
        const r = await loop.turn({ input: stepPrompt(st) });
        st = await g.commit(reduce(st, r));
      }
    });
  });
  ```

- 감지 방법: 재생 테스트(`drive`를 임의 경계에서 끊고 마지막 커밋 상태로 다시 호출해 같은 `loop.turn` 순서가 나오는지)를 `eng.testing.guide`의 형식으로 둔다. 리뷰 질문: "`drive` 안에서 `let`으로 선언한 진행 변수가 있는가? 이 그룹은 `on`과 `post`만으로 같은 일을 할 수 있는가?"

### 2.3 코드 (AP-C)

<a id="ap-c-01"></a>
#### AP-C-01 `any`와 타입 단언 남발

- 증상: 외부 입력을 `as ToolCall`로 단언하거나, 타입 오류를 `any`, `as unknown as T`, `!`로 지운다.
- 왜 문제인가:
  - 단언은 검증 없이 타입만 바꾼다. 도구 인자, 이벤트 `data`, 설정 파일처럼 경계에서 들어오는 값은 TypeBox 스키마 검증을 거쳐야 한다. 이벤트 `data`는 타입별 TypeBox 스키마로 검증한다(ADR-0004 §3.2 이벤트 레코드 초안).
  - 단언을 허용하는 곳은 `eng.typescript.guide` TY-06 허용 목록뿐이다. A1 `@xeon/contracts`의 `parse` 구현, A2 `IdFactory` 구현(`platform-os`의 `createIdFactory`, [결정: review.decisions-2 U-03])과 테스트 대역 `fixedIdFactory`, A3 타입 키 레지스트리 조회 함수 한 곳 [제안]이다. 경계 검증은 `parse` 하나로 한다(`eng.domain-types.guide` DT-05). `typebox/value`의 `Value.Check`는 contracts base 밖에서 import하지 않는다(DT-01).
- 나쁜 예:

  ```ts
  export function onToolArgs(raw: unknown) {
    const args = raw as { path: string };        // 검증 없는 단언
    const id = (raw as any).id as ToolCallId;    // any + 브랜드 위조
    return readFile(args.path!);
  }
  ```

- 좋은 예:

  ```ts
  import { err, parse, type ParseIssue, type Result } from "@xeon/contracts";
  import { ReadArgsSchema, type ReadArgs } from "@xeon/contracts/capabilities"; // [가정] 도구 인자 스키마

  export type ToolArgError = { readonly kind: "invalid_args"; readonly issues: readonly ParseIssue[] };

  export function parseReadArgs(raw: unknown): Result<ReadArgs, ToolArgError> {
    const args = parse(ReadArgsSchema, raw);                  // 검증 진입점은 parse 하나(DT-05)
    return args.ok ? args : err({ kind: "invalid_args", issues: args.error.issues });
  }
  ```

- 감지 방법: oxlint `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/no-unsafe-*`, `typescript/no-unnecessary-type-assertion`(현재 `xeon/.oxlintrc.json`에 있다). `as` 단언 자체는 `typescript/consistent-type-assertions`(`assertionStyle: "never"`)가 막고, 단언 disable 주석이 TY-06 허용 목록 경로 밖에 있으면 스캔 `xeon/as-location`이 실패시킨다(`eng.typescript.guide` TY-06, 3.1절 [제안]). 리뷰 질문: "이 `as`는 TY-06 허용 목록(A1 `parse` 구현, A2 브랜드 생성 함수, A3 타입 키 레지스트리 조회) 안에 있는가?"

<a id="ap-c-02"></a>
#### AP-C-02 광역 try/catch로 오류 삼킴

- 증상: 함수 본문 전체를 `try { ... } catch {}`로 감싸고 빈 catch나 `console.log`로 끝낸다. 실패가 기본값으로 바뀌어 호출자가 실패를 알 수 없다.
- 왜 문제인가:
  - 저장소 오류를 삼키면 커밋 여부를 모른 채 다음 단계로 간다. 재개 규칙은 "결과 불명"을 기록하고 `requestId`로 다시 제출하는 것이다(`_research/notes/F-3.md §6`, durable spec 4826-4834).
  - 확장 지점의 실패 정책은 fold가 정한다. `tap`은 기록 후 계속, `first`는 거부, `chain`은 그 핸들러만 건너뛴다(ADR-0007 §3.2). 핸들러 안에서 오류를 삼키면 `first` 지점의 fail-closed가 fail-open으로 바뀐다.
- 나쁜 예:

  ```ts
  g.on("tool.call.before", (call, st) => {
    try {
      return policy.check(call, st);   // 정책 검사 실패 = 허용으로 바뀐다
    } catch {
      return undefined;
    }
  });
  ```

- 좋은 예:

  ```ts
  g.on("tool.call.before", (call, st) => {
    const verdict = policy.check(call, st);          // 예상 가능한 실패는 Result로 받는다
    if (!verdict.ok) return { deny: verdict.error.kind };
    return verdict.value.allowed ? undefined : { deny: verdict.value.reason };
    // 예상하지 못한 예외는 잡지 않는다. first fold가 거부로 환산한다.
  });
  ```

- 규칙: `catch`는 변환(받은 값을 `cause`로 담은 오류 값), 근거 문서가 있는 기록 후 계속(주입된 Logger), 다시 던지기 중 하나만 한다(`eng.typescript.guide` TY-25). 빈 `catch`, 바인딩 없는 `catch`, `void caught`, `.catch(() => undefined)`, 실패를 기본값으로 바꾸는 반환은 금지다.
- 감지 방법: oxlint `no-empty` `{ "allowEmptyCatch": false }`와 `preserve-caught-error` `{ "requireCatchParameter": true }`(추가 [제안], 1.89 프로브로 동작 확인. `no-empty`는 restriction 범주라 지금 설정에서는 꺼져 있다), `no-unused-vars`(받고 쓰지 않은 값), 스캔 `xeon/catch-swallow` [제안](`void <식별자>`, 빈 `.catch` 콜백). 리뷰 질문: "이 catch는 무엇을 복구하는가? 복구하지 않으면 왜 잡는가?"

<a id="ap-c-03"></a>
#### AP-C-03 throw를 흐름 제어에 사용

- 증상: "찾지 못함", "권한 거부", "이미 처리됨" 같은 예상 가능한 결과를 예외로 던지고 호출자가 `instanceof`로 분기한다.
- 왜 문제인가:
  - 예상 가능한 실패는 `Result`로 돌려준다(`eng.best-practices.guide` BP-04). 던진 예외는 타입 시그니처에 나타나지 않아 호출자가 처리를 빠뜨린다.
  - 예외는 확장 지점의 fold 규칙(`first`는 거부로 환산)과 섞여 의도와 다른 결과를 낸다(ADR-0007 §3.2).
- 나쁜 예:

  ```ts
  class AlreadySubmitted extends Error {}

  export function submit(tx: StoreTx, req: PostItem, requestId: string) {
    if (tx.hasRequest(requestId)) throw new AlreadySubmitted(); // 멱등 처리가 예외 경로
    tx.insertInput(req, requestId);
  }
  ```

- 좋은 예:

  ```ts
  export type SubmitOutcome = { readonly kind: "accepted"; readonly inputId: EventId }
                            | { readonly kind: "duplicate"; readonly inputId: EventId };

  export function submit(tx: StoreTx, req: PostItem, requestId: string): SubmitOutcome {
    const existing = tx.findInput(requestId);
    if (existing) return { kind: "duplicate", inputId: existing.id };
    return { kind: "accepted", inputId: tx.insertInput(req, requestId) };
  }
  ```

- 감지 방법: 감지 도구 없음. 리뷰 질문: "이 throw는 호출자가 정상 흐름에서 처리해야 하는 결과인가? 그렇다면 판별자(`kind`)가 있는 반환 타입으로 바꿨는가?"

<a id="ap-c-04"></a>
#### AP-C-04 모듈 전역 가변 상태

- 증상: 모듈 최상위의 `let`, 모듈 수준 `Map` 캐시, `getInstance()` 싱글턴, `export let`로 상태를 공유한다.
- 왜 문제인가:
  - 그룹을 단계 경계에서 끄고 켜면 정리는 Cordis dispose로 실행된다(ADR-0007 §3.6). 모듈 전역 상태는 dispose 대상이 아니어서 끈 뒤에도 남는다.
  - CLI in-process와 서비스 모드는 한 프로세스에 세션 여러 개를 둘 수 있다(ADR-0006). 전역 상태는 세션 사이에 섞인다.
  - 테스트 파일 사이에도 상태가 샌다. `mock.module`이 기본 실행에서 파일 사이로 누수되는 것과 같은 종류의 문제다(`_research/notes/eng-3.md` 2번).
  - pi-agent-core 포크에서 `setDefaultStreamFn` 같은 전역 상태를 없앤 선례가 있다(`docs/design/12-runtime-engine.md §3.4.1` F-5).
- 나쁜 예:

  ```ts
  // xeon/packages/core-tools/src/registry.ts
  const tools = new Map<string, ToolDef>();          // 모든 세션과 그룹이 공유
  export function registerTool(def: ToolDef) { tools.set(def.name, def); }
  ```

- 좋은 예:

  ```ts
  // 레지스트리는 인스턴스로 만들고 Cordis 서비스로 등록한다. 등록 해제 함수는 scope dispose에 묶인다.
  export function createToolRegistry() {
    const tools = new Map<ToolName, ToolDef>();
    return {
      register(def: ToolDef): () => void { tools.set(def.name, def); return () => tools.delete(def.name); },
      get(name: ToolName): ToolDef | undefined { return tools.get(name); },
    };
  }
  ```

- 감지 방법: oxlint `import/no-mutable-exports`가 `export let`을 잡는다. 모듈 최상위 `let`과 가변 컬렉션은 리뷰 질문으로 본다: "이 값은 누가 언제 지우는가? dispose 경로가 있는가?"

<a id="ap-c-05"></a>
#### AP-C-05 `Date.now`·`Math.random` 직접 호출

- 증상: 이벤트 시각, ID, 재시도 지터, 임시 파일 이름을 `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`로 바로 만든다.
- 왜 문제인가:
  - 재생과 테스트가 결정적이지 않게 된다. Claude Code 워크플로가 `Date.now()`·`Math.random()`을 금지해 결정적 재생으로 재개하는 규칙은 Helm 구동 프로그램에 그대로 쓸 수 있다(`_research/ref-synthesis.md` "확장 지점" 4번).
  - `drive` 함수는 마지막 커밋 상태로 다시 호출되어도 같은 진행을 내야 한다(ADR-0007 §3.6). 함수 안의 난수와 현재 시각은 이 규율을 깨뜨린다.
  - 구 설계도 커널에서 같은 호출을 금지했다(`docs/design/06-system-architecture.md §3.5.1` R5). Xeon은 대상을 L0·L1·L3 `drive`로 넓힌다 [제안].
- 나쁜 예:

  ```ts
  export function stamp(): { readonly id: string; readonly recordedAt: number } {
    return { id: crypto.randomUUID(), recordedAt: Date.now() };
  }
  ```

- 좋은 예:

  ```ts
  export function stamp(deps: { readonly clock: Clock; readonly ids: IdFactory }): { readonly id: EventId; readonly recordedAt: number } {
    return { id: deps.ids.next("evt"), recordedAt: deps.clock.now() };
  }
  // 테스트는 manualClock과 fixedIdFactory를 넣는다(eng.testing.guide TS-03). bun test의 setSystemTime에 기대지 않는다.
  ```

- 감지 방법: oxlint `no-restricted-properties`(`Date.now`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `performance.now`)와 스캔 `xeon/no-ambient-time`(인자 없는 `new Date()`)이다(`eng.typescript.guide` TY-21, 3.1절 [제안]). 허용 위치는 `Clock`·`RandomSource`·`Scheduler` 구현(L0 `platform-os`, TY 4.3절)뿐이다. `IdFactory` 구현은 주입받은 `Clock`·`RandomSource`로 ID를 만든다(구현 위치는 `eng.domain-types.guide` DT-06 [미결]).

<a id="ap-c-06"></a>
#### AP-C-06 트랜잭션 안에서 외부 호출 await

- 증상: `db.transaction(async () => { ... await fetch(...) ... })`처럼 쓰기 트랜잭션을 연 채 모델 호출, 네트워크, 도구 실행, 사용자 승인 대기를 한다.
- 왜 문제인가:
  - bun:sqlite의 `.immediate()` 트랜잭션은 BEGIN 시점에 쓰기 잠금을 잡는다(`_research/notes/eng-3.md` 1번). WAL은 쓰기 하나만 허용하므로(`_research/session-storage.md` 기준별 비교) 잠금을 쥔 채 기다리면 앱·CLI·서비스의 다른 쓰기가 모두 막힌다.
  - bun:sqlite 트랜잭션 함수는 동기 함수를 전제한다. async 콜백을 넘기면 첫 await에서 커밋되어 원자성이 사라진다 [가정: `L0.store.spec`에서 확인].
  - 도구 실행은 의도 → 실행 → 결과 세 이벤트로 기록한다(ADR-0004 §3.2 규칙 3). 의도(E1), 실행 시작(E2), 결과(E3)는 각각 짧은 트랜잭션이고 실행은 그 사이 트랜잭션 밖에서 한다(`eng.transactions.design` 4.1절).
- 나쁜 예:

  ```ts
  storeDb.write(async (tx) => {                          // 동기 콜백 자리에 async
    tx.run("INSERT INTO events …", [/* effect.intent */]);
    const out = await tools.execute(call.args, signal);   // 잠금을 쥔 채 도구 실행
    tx.run("INSERT INTO events …", [/* effect.result */]);
  });
  ```

- 좋은 예:

  ```ts
  const intent = session.commit(intentRequest(call));            // 커밋 E1: effect.intent
  if (!intent.ok || intent.value.status !== "committed") return intent;
  session.commit(execRequest(call));                             // 커밋 E2: effect.exec
  const out = await tools.execute(call.args, signal);            // 트랜잭션 밖
  return session.commit(resultRequest(call.toolCallId, out));    // 커밋 E3: effect.result + toolResult item. 투영은 commit 안에서 투영기가 갱신
  // 세션 쓰기는 SessionService.commit 한 경로뿐이다(eng.transactions.design TX-07)
  ```

- 감지 방법: oxlint `typescript/no-misused-promises`가 동기 콜백 자리에 async 함수를 넘기는 경우 일부를 잡는다 [가정: 트랜잭션 API 타입이 동기 콜백으로 선언된 경우]. 트랜잭션 API를 `(tx) => T` 동기 시그니처로 선언해 타입으로 막는다 [제안]. 리뷰 질문: "트랜잭션 콜백 안에 `await`가 있는가?"

<a id="ap-c-07"></a>
#### AP-C-07 테스트 안 sleep

- 증상: 비동기 결과를 기다리려고 테스트에서 `await Bun.sleep(100)`, `setTimeout` 프라미스, 재시도 루프를 쓴다.
- 왜 문제인가:
  - 느린 CI에서 간헐적으로 실패하고, 빠른 기기에서는 시간을 낭비한다.
  - bun test는 `setSystemTime`과 `jest.useFakeTimers`(setTimeout 포함)가 동작한다(`_research/notes/eng-3.md` 2번). 주입한 `Clock`과 가짜 타이머로 시간을 진행시킬 수 있다.
  - 테스트 작성 규칙은 `eng.testing.guide`가 정한다.
- 나쁜 예:

  ```ts
  test("drive가 단계 경계에서 꺼진다", async () => {
    runtime.scope("helm").disable();
    await Bun.sleep(200);                       // 경계가 지나기를 바란다
    expect(loop.owner()).toBe("user");
  });
  ```

- 좋은 예:

  ```ts
  test("drive가 단계 경계에서 꺼진다", async () => {
    runtime.scope("helm").disable();
    await harness.untilBoundary("step");    // 테스트 하네스가 경계 이벤트를 기다린다 [가정]
    expect(loop.owner()).toBe("user");
  });
  ```

- 감지 방법: 테스트 파일(`**/*.test.ts`)에서 `Bun.sleep`, `setTimeout(` 프라미스 래퍼를 찾는 검사 스크립트 [제안]. 리뷰 질문: "이 테스트는 시간이 아닌 어떤 사건을 기다리는가?"

<a id="ap-c-08"></a>
#### AP-C-08 비밀 값 출력·로그

- 증상: 디버그 로그에 요청 헤더 전체를 남기거나, 오류 메시지에 API 키를 넣거나, 모델 컨텍스트에 비밀 값을 넣는다.
- 왜 문제인가:
  - [결정] 비밀 기본값은 SOPS(age)이고 에이전트는 값을 모른 채 참조로 쓴다(`_research/decisions-log.md` 2차).
  - 참조 형식은 `secret://<name>`이고 값은 lease 안에서만 다룬다(`_research/secrets.md §6.1`, 공급자 인터페이스 초안).
  - 작업 규칙도 비밀 값을 출력하지 않는다.
- 나쁜 예:

  ```ts
  const key = await secrets.read("anthropic-key");
  logger.debug("request", { headers: { authorization: `Bearer ${key}` } });
  ```

- 좋은 예:

  ```ts
  const lease = await secrets.lease("secret://anthropic-key", useCtx);   // 값은 lease 안에만
  logger.debug("request", { secretRef: "secret://anthropic-key", provider: "anthropic" });
  await models.stream(request, { auth: lease });
  ```

- 감지 방법: lefthook pre-commit의 gitleaks(`_research/foundation-plan.md §2` 저장소 위생 행)가 커밋된 값을 잡는다. 런타임 로그는 Logger 구현의 마스킹으로 막는다(`L0.secrets.spec`). 리뷰 질문: "이 로그 필드나 오류 문자열에 lease 값이 들어갈 수 있는가?"

<a id="ap-c-09"></a>
#### AP-C-09 L0·L1에서 console이나 로거 직접 생성

- 증상: L0·L1 패키지에서 `console.log`를 쓰거나 로거 라이브러리를 import해 모듈마다 로거를 만든다. 문자열 보간으로 메시지를 만든다.
- 왜 문제인가:
  - L0~L1 패키지는 로거를 import하지 않고 주입받은 `Logger` 인터페이스만 쓴다(`eng.best-practices.guide` BP-12). 구 설계도 같은 규칙을 두었다(`docs/design/06-system-architecture.md §3.5.1` R6).
  - CLI in-process, 데스크톱 사이드카, 서비스 모드는 출력 위치가 다르다. stdio JSON-RPC를 쓰는 사이드카에서 `console.log`는 프로토콜 출력과 섞인다(`_research/foundation-plan.md §1` 3번).
- 나쁜 예:

  ```ts
  // xeon/packages/core-loop/src/turn.ts
  console.log(`turn ${turnIndex} done in ${ms}ms`);
  ```

- 좋은 예:

  ```ts
  export function finishTurn(deps: { readonly logger: Logger }, turnIndex: number, ms: number) {
    deps.logger.info("turn.finished", { turnIndex, durationMs: ms });
  }
  ```

- 감지 방법: oxlint `no-console`(현재 설정, `scripts/**`, `apps/cli/**`, `apps/host/**`만 예외). 로거 라이브러리는 `no-restricted-imports`로 L4 진입점 밖에서 막는다 [제안].

<a id="ap-c-10"></a>
#### AP-C-10 단언을 다른 모양으로 감춘 typed programming 안티패턴

- 증상: `as`를 직접 쓰지 않고 같은 효과를 내는 코드를 쓴다.
  - 반환 타입에만 나오는 타입 매개변수: `function getState<T>(key: string): T`, `call<R>(method): Promise<R>`.
  - 판별자 하나만 보고 전체 모양을 약속하는 손 타입 가드: `(v: unknown): v is ToolCall => v.type === "toolCall"`.
  - `Function`, `Object`, `{}` 타입으로 받고 호출 지점에서 다시 단언.
  - 빈 컨테이너를 단언으로 초기화: `{} as Record<K, V>`, `[] as Item[]`.
  - `Object.keys(o) as (keyof T)[]`, `JSON.parse(x) as T`.
  - 운영 코드의 `@ts-expect-error`로 타입 오류 한 줄을 넘기기.
- 왜 문제인가:
  - TypeScript 타입은 런타임에 지워진다. 위 모양은 모두 런타임 검사 없이 타입만 정하므로 `as`와 같은 결과를 낸다. 린트 `consistent-type-assertions`를 통과해도 잘못된 데이터가 도메인 타입 이름을 달고 들어간다.
  - 단언을 허용 목록(TY-06) 밖으로 흩어 놓으면 리뷰가 단언 위치를 찾을 수 없다.
- 나쁜 예:

  ```ts
  export function getState<T>(store: ScopeStore, key: string): T {
    const raw: unknown = store.read(key);
    // @ts-expect-error -- 저장한 쪽이 T로 썼음
    return raw;
  }

  export function isToolCall(v: unknown): v is ToolCall {
    return typeof v === "object" && v !== null && "type" in v && v.type === "toolCall";
  }
  ```

- 좋은 예:

  ```ts
  export function getState<S extends TSchema>(store: ScopeStore, key: string, schema: S): Result<Static<S>, StateReadError> {
    const raw: unknown = store.read(key);
    const state = parse(schema, raw);
    return state.ok ? state : err({ kind: "state_invalid", key, issues: state.error.issues });
  }
  ```

- 감지 방법: oxlint `typescript/no-unnecessary-type-parameters`(반환에만 나오는 타입 매개변수), `typescript/no-unsafe-function-type`, `typescript/ban-ts-comment`(운영 코드 `ts-expect-error: true`), `typescript/consistent-type-assertions`(`eng.typescript.guide` 3.1.1절). 손 타입 가드는 리뷰 질문: "이 타입 가드는 술어 타입의 필드를 모두 검사하는가? 경계 값이면 `parse`로 바꿨는가?" 짝 규칙: `eng.typescript.guide` TY-06, TY-08, TY-23.

<a id="ap-c-11"></a>
#### AP-C-11 예상 가능한 실패를 `Bug`로 던짐

- 증상: I/O 오류, `SQLITE_BUSY`, 디스크 가득 참, 읽기 전용 파일 시스템, 취소, 찾지 못함, 검증 실패, lease·잠금 상실, 시간 초과를 `throw new Bug("store.io: ...")`처럼 `Bug`로 던진다. 하위 함수가 `Result`로 돌려준 실패를 상위에서 `Bug`로 바꾼다. 실패 종류를 `kind` 대신 `Bug` 메시지 문자열 접두어로 표시한다.
- 왜 문제인가:
  - `Bug`는 코드를 고쳐야 사라지는 상태를 뜻한다(`eng.typescript.guide` TY-24). 운영 중 정상적으로 생기는 실패를 `Bug`로 던지면 호출자가 재시도, 세션 정지, 사용자 안내 중 하나를 고를 수 없다.
  - 메시지 문자열은 판별자가 아니므로 호출자가 `switch`와 `assertNever`로 처리할 수 없다(TY-12, TY-13).
  - 확장 지점 fold에서 던진 예외는 거부로 환산되고(ADR-0007 §3.2), 저장소 실패가 런타임 전체 실패로 번진다(AP-S-06).
- 나쁜 예:

  ```ts
  const put = store.putBlob(bytes);
  if (!put.ok) throw new Bug(`store.blob_unavailable: putBlob returned ${put.error.kind}`);

  if (code === "SQLITE_BUSY") throw new Bug("store.busy");
  ```

- 좋은 예:

  ```ts
  export type CommitError =
    | { readonly kind: "blob_unavailable"; readonly cause: BlobError }
    | { readonly kind: "busy"; readonly retryAfterMs: number }
    | { readonly kind: "disk_full" };

  const put = store.putBlob(bytes);
  if (!put.ok) return err({ kind: "blob_unavailable", cause: put.error });
  ```

- 감지 방법: 스캔 `xeon/bug-for-expected` [제안]: `new Bug(` 메시지에 예상 가능한 실패 단어(`io`, `busy`, `disk_full`, `read_only`, `timeout`, `cancel`, `not_found`, `corrupt`, `lease`, `ownership`)가 있으면 실패. 리뷰 질문: "코드와 설정이 올바라도 이 실패가 일어날 수 있는가?" 테스트가 예상 가능한 실패를 `toThrow`로 확인하면 같은 안티패턴이다. 짝 규칙: `eng.typescript.guide` TY-11, TY-24, `eng.best-practices.guide` BP-04.

### 2.4 스택 (AP-S)

<a id="ap-s-01"></a>
#### AP-S-01 fsync 없는 JSONL 세션 쓰기

- 증상: 세션이나 확장 기록을 `appendFile`로 JSONL에 한 줄씩 덧붙인다. 읽을 때 파싱되지 않는 마지막 줄을 조용히 버린다.
- 왜 문제인가:
  - 조사한 pi, oh-my-pi, Claude Code 모두 fsync를 호출하지 않고, pi는 잘린 줄을 경고 없이 버린다(`_research/session-storage.md` 방식별 장단점, `_research/ref-synthesis.md` "피할 것").
  - JSONL은 커밋 단위가 줄 하나라 도구 의도·확장 기록·작업 상태를 함께 커밋할 수 없다.
  - [결정] 세션 저장은 SQLite 이벤트 소싱 + 투영, 단일 DB다. 단계 경계 커밋은 `synchronous=FULL`이다(ADR-0004 §3.1, §3.2 규칙 5).
  - JSONL은 내보내기 명령으로만 쓴다(ADR-0004 §3.2 규칙 7).
- 나쁜 예:

  ```ts
  import { appendFile } from "node:fs/promises";

  export async function saveEntry(path: string, entry: SessionEntry) {
    await appendFile(path, JSON.stringify(entry) + "\n"); // fsync 없음, 원자적 묶음 없음
  }
  ```

- 좋은 예:

  ```ts
  export function commitStep(session: SessionService, request: CommitRequest): Result<CommitResult, StoreError> {
    return session.commit(request);     // 단일 DB, 한 트랜잭션, synchronous=FULL. build()가 초안과 체크포인트를 함께 낸다
  }
  // request.build = (view) => ({ kind: "append", drafts: [...stepDrafts], checkpoint: stepCheckpoint(view) })
  ```

- 감지 방법: 리뷰 질문: "세션·확장 기록을 SQLite 밖 파일에 쓰는가? 내보내기 명령 외의 JSONL 쓰기가 있는가?" `node:fs`의 `appendFile`을 L1 `core-persistence`와 L0 `platform-store` 밖에서 막는 `no-restricted-imports` 패턴 [제안].

<a id="ap-s-02"></a>
#### AP-S-02 토큰마다 이벤트 저장

- 증상: 스트리밍 응답의 `text_delta`마다 이벤트 행을 추가하거나 투영을 갱신한다.
- 왜 문제인가:
  - [결정] 스트리밍 토큰 델타는 휘발 이벤트로 UI에만 흘리고 저장하지 않는다. 완성된 메시지 파트만 저장한다(ADR-0004 §3.2 규칙 6, `_research/session-storage.md` 방식별 장단점).
  - 토큰마다 쓰면 쓰기 잠금 경합과 fsync 비용이 커지고, 재생 때 의미 없는 행이 쌓인다. 크래시 때 진행 중 응답은 버리고 다시 요청한다(`docs/design/12-runtime-engine.md §3.7.1` CR-7과 같은 규칙).
  - 내구·휘발 구분은 `eng.events.design`이 정한다.
- 나쁜 예:

  ```ts
  for await (const ev of stream) {
    if (ev.type === "text_delta") session.commit(deltaRequest(ev));  // 토큰마다 커밋
  }
  ```

- 좋은 예:

  ```ts
  for await (const ev of stream) {
    if (ev.type === "text_delta") {                                           // 휘발: UI로만(eng.events.design 4.3절)
      session.emitVolatile({ durable: false, kind: "item.updated", threadId, turnId, n: n++, afterSeq: head,
        payload: { itemId, update: { kind: "part_delta", delta: ev.delta } } /* … */ });
    }
    if (ev.type === "done") session.commit(responseRequest(turnId, stepIndex, ev.message)); // 완성본만 저장(item.recorded + part.recorded, C3)
  }
  ```

- 감지 방법: 단위 테스트로 한 응답 스트림이 끝난 뒤 저장된 이벤트 수를 확인한다(`eng.testing.guide`). 리뷰 질문: "스트림 루프 안에 저장 호출이 있는가?"

<a id="ap-s-03"></a>
#### AP-S-03 확장별 DB 파일로 원자성 상실

- 증상: 확장이나 그룹마다 `new Database("helm.sqlite")`처럼 별도 SQLite 파일을 만들고, 세션 기록과 그룹 기록을 따로 커밋하거나 `ATTACH`로 묶는다.
- 왜 문제인가:
  - WAL 모드에서는 `ATTACH`로 묶어도 파일 하나하나의 원자성만 보장하고 여러 파일에 걸친 원자성은 보장하지 않는다(`_research/session-storage.md` "놓치기 쉬운 제약").
  - [결정] DB 파일은 하나이고 확장 기록은 확장 접두사 테이블에 둔다. outbox는 별도 프로세스로 격리한 확장에만 쓴다(ADR-0004 §3.1, §3.3).
- 나쁜 예:

  ```ts
  // xeon/packages/group-helm/src/store.ts
  import { Database } from "bun:sqlite";
  const helmDb = new Database(join(dataDir, "helm.sqlite"));     // 세션 DB와 따로 커밋된다
  ```

- 좋은 예:

  ```ts
  // 그룹 기록은 grp.helm.* 이벤트로 남긴다. x_helm_* 테이블은 확장 투영기만 쓴다(eng.context-map.design 5.2절).
  // 투영기는 SessionService.commit 안에서 돌므로 세션 이벤트와 같은 트랜잭션에 들어간다.
  export const helmLensProjector: Projector = {
    name: "ext.helm", version: 1, tables: ["x_helm_lenses"], ddl: [HELM_LENSES_DDL], kinds: ["grp.helm.lens.added"],
    apply: (tx, ev) => tx.run("INSERT INTO x_helm_lenses (thread_id, lens_id, title) VALUES (?, ?, ?)",
      [ev.threadId, lensIdOf(ev), lensTitleOf(ev)]),
  };
  ```

- 감지 방법: oxlint `no-restricted-imports`가 `better-sqlite3`, `node:sqlite`, `sqlite3`를 막는다(현재 설정). `bun:sqlite`도 `platform-store` 밖에서 막는 패턴을 더한다 [제안]. 리뷰 질문: "새 `.sqlite` 파일 경로가 생기는가?"

<a id="ap-s-04"></a>
#### AP-S-04 provider 위장 경로 본체 혼입

- 증상: pi-ai의 Anthropic OAuth 위장 경로를 `core-models`나 기본 provider 목록에 넣는다. 설정 플래그 하나로 켜지게 하고 같은 패키지에 둔다.
- 왜 문제인가:
  - provider 위장 코드를 본체에 섞어 두지 않는다. 약관·계정 제재 위험이 있다(`_research/ref-synthesis.md` "피할 것").
  - [결정] 위장 경로는 유지하되 별도 커스텀 플러그인으로 제공하고 릴리즈에서 제외한다(`_research/decisions-log.md` 2차). 위치는 `plugins/provider-anthropic-oauth`이고 배포판에서 제외한다(`_research/foundation-plan.md §2` 모델·루프 행, `routes.yaml` `layout.plugins`).
- 나쁜 예:

  ```ts
  // xeon/packages/core-models/src/providers.ts
  import { anthropicOAuth } from "./vendor/pi-ai/anthropic-oauth";
  export const builtinProviders = [anthropicApi, openaiApi, anthropicOAuth]; // 배포판에 포함
  ```

- 좋은 예:

  ```ts
  // xeon/plugins/provider-anthropic-oauth/src/index.ts  (배포 제외, 사용자가 직접 설치)
  import type { ProviderPlugin } from "@xeon/contracts/capabilities";
  export const plugin: ProviderPlugin = { id: "anthropic-oauth", register: (host) => host.registerProvider(provider) };
  ```

- 감지 방법: 배포 빌드 매니페스트가 `plugins/provider-anthropic-oauth`를 포함하지 않는지 확인하는 검사 [제안: L4 빌드 단계]. `packages/**`에서 `anthropic-oauth`, `oauth` 위장 헤더 문자열을 찾는 검사 스크립트 [제안]. 리뷰 질문: "이 provider 코드는 `plugins/` 아래에 있는가?"

<a id="ap-s-05"></a>
#### AP-S-05 검증 없는 바이너리 자동 다운로드

- 증상: `rg`, `fd`, `sops`, 브라우저 바이너리가 없으면 GitHub 릴리스에서 내려받아 바로 실행한다. 해시나 서명을 확인하지 않는다.
- 왜 문제인가:
  - pi `tools-manager`의 rg·fd 자동 다운로드가 피할 사례로 꼽혔다(`_research/ref-synthesis.md` "피할 것").
  - 런타임은 공개 배포를 전제한다(`_research/decisions-log.md` 2026-10-19 답). 사용자 기기에서 검증 없는 코드를 실행하면 공급망 공격 경로가 된다.
- 나쁜 예:

  ```ts
  const res = await fetch(`https://github.com/BurntSushi/ripgrep/releases/latest/download/${asset}`);
  await Bun.write(binPath, res);
  await chmod(binPath, 0o755);              // 버전도 해시도 확인하지 않는다
  ```

- 좋은 예:

  ```ts
  // 고정 버전과 기대 해시는 저장소 안 매니페스트에 둔다. 다운로드는 사용자 승인 뒤에만 한다.
  const pin = binaryPins.ripgrep;           // { version: "14.1.1", sha256: { "linux-x64": "…" } }
  const bytes = new Uint8Array(await (await fetch(pin.url(platform))).arrayBuffer());
  if (sha256Hex(bytes) !== pin.sha256[platform]) return err({ kind: "binary_hash_mismatch", binary: "ripgrep", platform });
  await Bun.write(binPath, bytes);
  ```

- 감지 방법: 감지 도구 없음. 리뷰 질문: "내려받은 실행 파일을 실행하기 전에 고정 버전과 해시를 확인하는가? 사용자가 다운로드를 승인했는가?"

<a id="ap-s-06"></a>
#### AP-S-06 저장소 오류 시 프로세스 전체 종료

- 증상: SQLite 쓰기 오류(`SQLITE_BUSY`, 디스크 가득 참)가 나면 `process.exit(1)`을 부르거나, 잡히지 않은 예외나 `Bug`로 던져 런타임이 내려간다([AP-C-11](#ap-c-11)).
- 왜 문제인가:
  - 저장소 오류가 나면 런타임 전체를 종료하는 구조(pi durable)는 피할 사례다(`_research/ref-synthesis.md` "피할 것").
  - 서비스 모드는 세션 여러 개와 예약 작업을 함께 돌린다(ADR-0006). 한 세션의 쓰기 실패가 다른 세션을 끝내면 안 된다.
  - bun:sqlite 오류는 `SQLiteError`(code, errno)로 온다. 기본 `busy_timeout`이 0이라 5000을 명시해야 한다(`_research/notes/eng-3.md` 1번). 일시적 실패는 재시도할 수 있다.
- 나쁜 예:

  ```ts
  try {
    commitStep(writer, request);
  } catch (e) {
    logger.error("store failed", { e });
    process.exit(1);                        // 모든 세션과 서비스가 함께 내려간다
  }
  ```

- 좋은 예:

  ```ts
  const r = writer.commit(request);         // Result<CommitResult, StoreError> (eng.transactions.design 4.2절)
  if (!r.ok) {
    session.markUncertain(r.error);         // 이 세션만 "결과 불명"으로 멈추고 같은 requestId로 재제출을 기다린다
    return r;
  }
  ```

- 감지 방법: 리뷰 질문: "`process.exit`가 L4 진입점(`apps/*`) 밖에 있는가?" `packages/**`에서 `process.exit` 호출을 찾는 검사 스크립트 [제안]. 저장소 실패 주입 단위 테스트로 다른 세션이 계속 도는지 확인한다.

<a id="ap-s-07"></a>
#### AP-S-07 Vitest 도입

- 증상: 테스트 편의를 위해 `vitest`를 devDependency로 넣거나 `vitest.config.ts`를 추가한다. Jest 호환 API를 별도 패키지로 들인다.
- 왜 문제인가:
  - [결정] 테스트는 `bun test`다. Vitest는 Node 위에서 돌아 `bun:sqlite` 같은 Bun API를 쓰는 테스트를 돌리지 못해 제외했다(`_research/foundation-plan.md §2` 테스트 행, ADR-0001).
  - 테스트 러너가 둘이면 커버리지 임계(`bunfig.toml`의 `coverageThreshold`)와 CI job이 둘로 나뉜다.
- 나쁜 예:

  ```ts
  import { describe, it, expect, vi } from "vitest";
  vi.useFakeTimers();
  ```

- 좋은 예:

  ```ts
  import { describe, it, expect, jest, setSystemTime } from "bun:test";
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-21T00:00:00Z"));
  ```

- 감지 방법: oxlint `no-restricted-imports`가 `vitest`, `jest`, `@jest/*`를 막는다(현재 설정). knip이 쓰이지 않는 devDependency를 보고한다.

<a id="ap-s-08"></a>
#### AP-S-08 버전 범위(`^`, `~`) 사용

- 증상: `package.json`이나 catalog에 `"typebox": "^1.3.27"`, `"oxfmt": "~0.74.0"`처럼 범위를 쓴다.
- 왜 문제인가:
  - [결정] 스택 표는 모든 도구를 정확 버전으로 고정한다(`_research/foundation-plan.md §2` "정확 버전 고정"). oxfmt는 0.x라 정확 고정이고, tsgolint는 TS 7.0.x에 묶여 두 버전을 함께 고정한다(같은 문서 §7).
  - 공개 API가 안정된 레퍼런스가 하나도 없다. pi·omp·opencode는 매주나 마이너 버전에서 계약이 깨진다(`_research/ref-synthesis.md` 대상 한눈 비교 아래 문단). 범위는 이 변경을 예고 없이 들인다.
- 나쁜 예:

  ```json
  { "dependencies": { "@earendil-works/pi-ai": "^1.3.0", "typebox": "^1.3.27" } }
  ```

- 좋은 예:

  ```json
  { "dependencies": { "@earendil-works/pi-ai": "catalog:", "typebox": "catalog:" } }
  ```

  루트 `package.json`의 catalog에 `"typebox": "1.3.27"`처럼 정확 버전을 둔다.

- 감지 방법: 모든 `package.json`의 의존 값이 정확 버전, `catalog:`, `workspace:*` 중 하나인지 확인하는 검사 스크립트 [제안: `check-layers.ts`가 이미 `package.json`을 읽으므로 같은 스크립트에 넣는다]. 세부는 `eng.toolchain.guide`가 정한다.

<a id="ap-s-09"></a>
#### AP-S-09 oxfmt 문제 시 Biome 복귀

- 증상: oxfmt가 어떤 파일을 잘못 포맷하자 저장소 전체를 Biome나 Prettier로 되돌리거나, 두 포매터를 함께 돌린다.
- 왜 문제인가:
  - [결정] 포맷은 oxfmt 0.74다. 문제가 생기면 그 파일만 제외한다. Biome로 되돌리지 않는다(`_research/foundation-plan.md §2` 포맷 행, ADR-0001).
  - 되돌림 조건은 ADR-0001이 정한다(oxfmt 제외 파일이 워크스페이스의 상당 부분으로 늘 때 새 ADR로 재검토).
- 나쁜 예:

  ```json
  { "scripts": { "fmt": "biome format --write . && oxfmt ." } }
  ```

- 좋은 예:

  ```json
  { "ignorePatterns": ["packages/core-loop/src/vendor-shim.ts"] }
  ```

  `.oxfmtrc.json`의 제외 목록에 해당 파일만 넣고, 커밋 메시지에 oxfmt 이슈 번호를 적는다. 키 이름은 `eng.toolchain.guide`가 정한다 [가정].

- 감지 방법: 감지 도구 없음. 리뷰 질문: "이 변경이 새 포매터 의존이나 설정 파일(`biome.json`, `.prettierrc`)을 추가하는가?" knip이 쓰이지 않는 포매터 의존을 보고한다.

<a id="ap-s-10"></a>
#### AP-S-10 FTS5 가용성 가정

- 증상: 검색 기능이 `CREATE VIRTUAL TABLE ... USING fts5`를 바로 실행하고 실패를 처리하지 않는다. `Database.setCustomSQLite`의 반환값으로 macOS 여부를 판단한다.
- 왜 문제인가:
  - bun:sqlite는 macOS에서 시스템 SQLite를 써서 FTS5 유무가 다르다. 시작할 때 FTS5를 확인하는 검사를 둔다(`_research/foundation-plan.md §2` DB 행, §7 위험).
  - `setCustomSQLite`는 Linux에서도 `true`를 반환해 공식 문서와 다르다. 반환값으로 플랫폼을 판별하지 않는다(`_research/notes/eng-3.md` 3번, `_research/notes/arch-3.md`).
- 나쁜 예:

  ```ts
  if (Database.setCustomSQLite(bundledPath)) {
    // macOS라고 가정하고 FTS5가 있다고 본다
  }
  db.run("CREATE VIRTUAL TABLE cap_knowledge_fts USING fts5(body)");
  ```

- 좋은 예:

  ```ts
  // L0 platform-store 시작 검사. 절차는 eng.toolchain.guide TC-11(생성, 한 행 삽입, MATCH 질의). 플랫폼 판별은 L0 구현 안에서 한다.
  export function probeFts5(db: Database): Result<void, { readonly kind: "fts5_missing" }> {
    try {
      db.run("CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x)");
      db.run("INSERT INTO temp.fts5_probe(x) VALUES ('xeon')");
      const row: unknown = db.query("SELECT count(*) AS n FROM temp.fts5_probe WHERE fts5_probe MATCH 'xeon'").get();
      db.run("DROP TABLE temp.fts5_probe");
      return typeof row === "object" && row !== null && "n" in row && row.n === 1 ? ok(undefined) : err({ kind: "fts5_missing" });
    } catch {
      return err({ kind: "fts5_missing" });
    }
  }
  ```

  이 try/catch는 외부 라이브러리의 예외를 경계에서 `Result`로 바꾸는 좁은 catch라 [AP-C-02](#ap-c-02)에 해당하지 않는다.

- 감지 방법: 시작 검사(`L0.store.spec`)와 플랫폼별 CI 탐침. 리뷰 질문: "FTS5를 쓰는 코드가 시작 검사 결과를 확인하는가?"

## 3. 감지 수단

### 3.1 린트 규칙 (oxlint 1.89)

현재 `xeon/.oxlintrc.json`에 있는 규칙과, 이 문서가 추가를 [제안]하는 규칙이다. 규칙 이름의 존재는 `_research/notes/eng-1.md §1`이 1.89 규칙 목록으로 확인했다. 설정의 정본은 `eng.toolchain.guide`다.

| 규칙 | 상태 | 대상 항목 |
|---|---|---|
| `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/no-unsafe-*`, `typescript/no-unnecessary-type-assertion` | 있음 | AP-C-01 |
| `typescript/consistent-type-assertions`(`assertionStyle: "never"`), `typescript/no-unsafe-type-assertion`, `typescript/no-non-null-asserted-nullish-coalescing` | [제안](`eng.typescript.guide` TY-06, 3.1.1절) | AP-C-01 |
| `typescript/no-unnecessary-type-parameters`, `typescript/no-unsafe-function-type`, `typescript/ban-ts-comment`(운영 코드 `ts-expect-error: true`, 테스트만 `allow-with-description`) | [제안](`eng.typescript.guide` TY-08, TY-23, 3.1.1절) | AP-C-10 |
| `no-empty`(`allowEmptyCatch: false`), `preserve-caught-error`(`requireCatchParameter: true`), `typescript/use-unknown-in-catch-callback-variable` | [제안](`eng.typescript.guide` TY-25, 3.1.1절) | AP-C-02 |
| `typescript/no-floating-promises`, `typescript/no-misused-promises` | 있음 | AP-C-06 일부 |
| `import/no-cycle` | 있음 | AP-A-02 |
| `import/no-mutable-exports` | 있음 | AP-C-04 일부 |
| `no-console` | 있음 | AP-C-09 |
| `no-restricted-imports`: `vitest`, `jest`, `better-sqlite3`, `node:sqlite`, `cordis`(ext-host 밖), 다른 패키지 `src`·`dist` | 있음 | AP-S-07, AP-S-03, AP-A-06 일부, AP-A-01 |
| `no-restricted-imports`: `effect`, `@opencode/*`, `tsyringe`, `inversify` | [제안] | AP-A-06 |
| `no-restricted-imports`: `@xeon/platform-store`(조립 루트 `apps/host` 밖, `eng.dependency-rules.guide` DR-14), `bun:sqlite`(`platform-store` 밖), 로거 라이브러리(L4 밖) | [제안] | AP-A-07, AP-S-03, AP-C-09 |
| `no-restricted-properties`: `Date.now`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `performance.now` | [제안](`eng.typescript.guide` TY-21) | AP-C-05 |

### 3.2 검사 스크립트

| 수단 | 상태 | 확인하는 것 | 대상 항목 |
|---|---|---|---|
| `just check-layers` (`xeon/scripts/check-layers.ts`) | 있음(DR-14 검사는 M1 [제안]) | 같은 층·상위 층 import, 선언되지 않은 워크스페이스 import, 패키지 밖 상대 경로, 컨텍스트가 다른 구현 패키지 import(DR-14) | AP-A-01, AP-A-02, AP-A-03, AP-A-07 |
| `just depcruise` (dependency-cruiser 18) | 있음 | 층 순위 규칙 | AP-A-01, AP-A-02 |
| `just knip` | 있음 | 쓰이지 않는 의존(Vitest, 포매터 등) | AP-S-07, AP-S-09 |
| gitleaks (lefthook pre-commit) | 있음 | 커밋된 비밀 값 | AP-C-08 |
| 금지 호출 목록: `Date.now`, `new Date()`(인자 없음), `Math.random`, `process.exit`(apps 밖), 테스트 안 `Bun.sleep` | [제안] `check-layers.ts`에 추가 | 소스 텍스트 검사 | AP-C-05, AP-S-06, AP-C-07 |
| `scripts/check-ts-rules.ts` 스캔 `xeon/as-location`, `xeon/catch-swallow`, `xeon/bug-for-expected` | [제안] `eng.typescript.guide` 3.2절 | 허용 목록 밖 단언 주석, 삼킨 catch, 예상 가능한 실패 단어가 든 `Bug` 메시지 | AP-C-01, AP-C-02, AP-C-11 |
| 의존 버전 형식 검사: 정확 버전, `catalog:`, `workspace:*`만 허용 | [제안] `check-layers.ts`에 추가 | `package.json` | AP-S-08 |
| 배포 매니페스트 검사: `plugins/provider-anthropic-oauth` 제외 | [제안] L4 빌드 단계 | 배포 산출물 목록 | AP-S-04 |
| 재생 테스트: `drive`를 경계에서 끊고 재호출 | [제안] `eng.testing.guide` 형식 | `loop.turn` 순서 | AP-A-09 |

TS 7.0에는 안정 programmatic API가 없으므로(`_research/notes/eng-1.md §1`) 위 텍스트 검사는 TypeScript 컴파일러 API에 기대지 않는다. 오탐을 줄이려고 주석과 문자열 리터럴을 건너뛰는 단순 토크나이저를 쓴다 [제안].

### 3.3 리뷰 질문

리뷰어는 변경 파일에 해당하는 질문을 확인한다. 도구로 잡지 못하는 항목은 이 표가 유일한 감지 수단이다.

| 질문 | 항목 |
|---|---|
| 이 그룹은 다른 그룹이 꺼져 있어도 시작하고 동작하는가? | AP-A-03 |
| Xeon 문서에 없는 중앙 상태 관문(커널 리듀서, 지시 계산)을 새로 만드는가? | AP-A-04 |
| 상주 프로세스가 없을 때 이 기능은 무엇을 하는가? | AP-A-05 |
| 새 의존이 자기 수명 관리(Layer, Scope, container)를 갖는가? | AP-A-06 |
| 그룹 코드의 효과는 `on` 반환값, `post`, `drive`, `g.commit` 중 어디로 나가는가? | AP-A-07 |
| 신뢰 등급 2·3 확장이 선언하지 않은 능력에 접근할 수 있는가? | AP-A-08 |
| `drive` 안에 `let` 진행 변수가 있는가? `on`과 `post`로 같은 일을 할 수 있는가? | AP-A-09 |
| 이 `as`는 TY-06 허용 목록(A1 `parse` 구현, A2 브랜드 생성 함수, A3 타입 키 레지스트리 조회) 안에 있는가? 밖이면 타입 가드, `satisfies`, `parse`로 바꿨는가? | AP-C-01, AP-C-10 |
| 이 catch는 무엇을 복구하는가? 받은 값을 `cause`로 넘기거나 Logger로 남기는가? | AP-C-02 |
| 이 타입 매개변수는 인자에서 오는가? 이 타입 가드는 술어 타입의 필드를 모두 검사하는가? | AP-C-10 |
| 이 `Bug`는 코드와 설정이 올바라도 일어날 수 있는 실패인가? | AP-C-11 |
| 이 throw는 호출자가 정상 흐름에서 처리해야 하는 결과인가? | AP-C-03 |
| 이 값은 누가 언제 지우는가? dispose 경로가 있는가? | AP-C-04 |
| 트랜잭션 콜백 안에 `await`가 있는가? | AP-C-06 |
| 이 테스트는 시간이 아닌 어떤 사건을 기다리는가? | AP-C-07 |
| 로그 필드나 오류 문자열에 lease 값이 들어갈 수 있는가? | AP-C-08 |
| 세션·확장 기록을 SQLite 밖 파일에 쓰는가? | AP-S-01 |
| 스트림 루프 안에 저장 호출이 있는가? | AP-S-02 |
| 새 `.sqlite` 파일 경로가 생기는가? | AP-S-03 |
| provider 코드가 `plugins/` 아래에 있는가? | AP-S-04 |
| 내려받은 실행 파일을 실행하기 전에 버전과 해시를 확인하는가? | AP-S-05 |
| `process.exit`가 `apps/*` 밖에 있는가? | AP-S-06 |
| 새 포매터 의존이나 설정 파일을 추가하는가? | AP-S-09 |
| FTS5를 쓰는 코드가 시작 검사 결과를 확인하는가? | AP-S-10 |

## 4. 예외 절차

### 4.1 줄 단위 예외 (린트)

- 형식의 정본은 `eng.typescript.guide` 4.1절이다. oxlint 규칙은 `// oxlint-disable-next-line <규칙> -- <이유> (<이슈 URL>)` 또는 같은 줄 끝 `// oxlint-disable-line <규칙> -- <이유> (<이슈 URL>)`으로만 끈다. 파일 전체나 규칙 없는 disable은 쓰지 않는다(`_research/notes/eng-1.md §1`).
- 이 문서가 미리 허용한 예외는 이슈 URL 대신 항목 ID를 인용한다. 예: `// oxlint-disable-next-line no-restricted-properties -- Clock 구현 자체 (eng.anti-patterns.guide AP-C-05)`. `-- <이유>` 접미는 oxlint 1.89에서 억제가 적용됨을 프로브로 확인했다(`eng.typescript.guide` 4.1절). 형식은 스캔 `xeon/directive-format`이 검사한다.
- 쓰이지 않은 disable은 `reportUnusedDisableDirectives: "error"`가 실패시킨다(현재 설정).

### 4.2 규칙별 허용 목록

- 검사 스크립트 항목(AP-C-05, AP-S-06, AP-S-08 등)의 예외는 스크립트의 허용 목록에 파일 경로와 항목 ID, 이유를 적는다 [제안]. 예: `Clock`·`RandomSource`·`Scheduler` 구현 파일, `apps/*` 진입점의 `process.exit`.
- 허용 목록 변경은 그 자체로 리뷰 대상이다. 같은 PR에서 허용 목록과 기능 코드를 함께 바꾸면 리뷰어가 허용 목록 변경을 따로 승인한다.

### 4.3 ADR이 필요한 예외

- 아키텍처 항목(AP-A-*)과 스택 결정에 걸린 항목(AP-S-03, AP-S-04, AP-S-07, AP-S-08, AP-S-09)의 예외는 ADR로 승인한다. 이 항목들은 사용자 결정에서 나왔으므로 사용자 확인이 필요하다.
- ADR이 승인되면 이 문서의 해당 항목에 "예외: adr.NNNN" 줄을 더한다.

### 4.4 항목 추가 절차 [제안]

- Xeon 구현 중 같은 실수가 두 번 나오면 이 문서에 항목 한 줄을 추가한다. 출처는 `docs/design/06-system-architecture.md §3.5`가 인용한 AGENTS.md 규칙("같은 실수가 두 번 나오면 한 줄 추가")이다.
- 처음에는 요약 표에 한 줄(ID, 이름, 짝 규칙, 감지 수단 "리뷰 질문")과 3.3절 리뷰 질문 한 줄만 둔다. 본문(증상, 이유, 나쁜 예, 좋은 예, 감지)은 세 번째 발생 전까지 채운다.
- 감지 도구를 만들 수 있으면 3.2절에 [제안]으로 올리고, 도구가 들어오면 표지를 지운다.
- 새 항목에 짝이 되는 기본 선택이 없으면 `eng.best-practices.guide`에도 규칙을 추가하거나, 짝 규칙 칸을 비워 둔다.

## 5. 미결 사항

- [미결] 3.1절과 3.2절의 [제안] 린트 패턴과 검사 스크립트 항목을 `eng.toolchain.guide`와 `check-layers.ts`에 넣을지. 코드는 다른 작업자가 만드는 중이므로 이 문서는 목록만 둔다.
- [결정: review.decisions-2 U-15] 같은 층 예외(`DR-02/group-kit`, `DR-10/cli-host`)를 AP-A-01에 반영했다.
- [미결] 4.4절 항목 추가 절차를 채택할지, 채택하면 누가 추가를 승인하는지.
