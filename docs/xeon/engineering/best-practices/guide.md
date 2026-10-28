---
id: eng.best-practices.guide
layer: eng
domain: best-practices
kind: guide
status: draft
depends_on: [eng.typescript.guide, eng.domain-types.guide, eng.events.design]
binds: [xeon/**]
---

# 모범 사례: 기본 선택 규칙

Xeon 코드를 쓸 때 고민 없이 먼저 고르는 방식을 모은 구속 문서다. 규칙마다 이유, 좋은 예, 나쁜 예를 둔다. 같은 주제의 잘못된 모양은 `eng.anti-patterns.guide`(`../anti-patterns/guide.md`)에 있고, 짝이 되는 항목을 규칙마다 링크한다.

## 1. 적용 범위

- 대상 코드: `xeon/**` 전부다. `xeon/vendor/**`의 원본은 대상에서 빼고, 그것을 감싸는 래퍼는 대상에 넣는다.
- 대상 작업: `routes.yaml`의 `by_task.implement`에 속하는 모든 작업과 리뷰다. 확장·그룹 작업은 `by_task.extension` 문서(`X.readme`, `X.primitives.spec`, `F.extensions.spec`)를 함께 읽는다.
- "기본 선택"은 다른 방법을 쓸 이유가 없을 때 따르는 방식이다. 다른 방법을 쓰려면 4절 절차를 따른다.
- 다른 구속 문서와의 관계:
  - 타입 규칙(브랜드 ID, `Result`, 금지 구문, `isolatedDeclarations` 주석)은 `eng.typescript.guide`(`../typescript/guide.md`)가 정한다.
  - DTO·스키마·도메인 타입 설계와 버전 규칙은 `eng.domain-types.guide`(`../domain-types/guide.md`)가 정한다.
  - 이벤트 종류, 내구·휘발, 순서, 재생은 `eng.events.design`(`../events/design.md`)이, 트랜잭션 경계와 멱등은 `eng.transactions.design`(`../transactions/design.md`)이 정한다.
  - 층 순위와 import 규칙은 `eng.dependency-rules.guide`(`../dependency-rules/guide.md`)가 정한다.
  - 이 문서는 위 규칙을 바꾸지 않는다. 위 문서와 다르게 읽히는 곳이 있으면 위 문서가 앞선다.
- 예제 표기:
  - [가정] 예제의 확장 지점 이름(`tool.call.before`, `tool.result`, `boundary.step.after`, `input.agent.before`, `tool.execution.after`)은 `F.extensions.spec` §3.4 표의 이름이다. 지점 이름 목록과 fold는 `F.extensions.spec`이 정한다(ADR-0007 §3.3).
  - [가정] `scope`, `GroupApi`, `LoopHandle`, `Deny`, `PostWhen`, `ScopeId`는 ADR-0007 §3.7 인터페이스 초안의 이름이다. 최종 이름은 `X.primitives.spec`이 정한다. 멱등 키 `requestId`는 브랜드 없는 문자열이다(`F.conversation.spec` §3.5).
  - [가정] `Result`, `ok`, `err`는 `eng.typescript.guide`가 정한 이름이다. 예제는 `{ ok: true; value } | { ok: false; error }` 모양을 쓴다.
  - 이벤트 kind 이름과 envelope 필드(`kind`, `version`, `threadId`, `payload`, `recordedAt`)는 `F.records.spec` §3.1~§3.3과 `eng.events.design` 4.1·4.4·4.5절을 따른다. 쓰기 경로는 `SessionService.commit`이다(`eng.transactions.design` 4.2절, `L1.persistence.spec` §3.3).

## 2. 기본 선택 규칙

### 2.1 요약 표

| ID | 규칙 | 짝 안티패턴 |
|---|---|---|
| [BP-01](#bp-01) | 계약 먼저: F 타입·스키마부터 정한다 | AP-C-01, AP-C-10, AP-A-02 |
| [BP-02](#bp-02) | 작은 순수 함수 + 얇은 어댑터, 부수효과는 L0 인터페이스 뒤 | AP-C-04, AP-C-06, AP-S-05, AP-S-10 |
| [BP-03](#bp-03) | 확장 지점은 선택 표로 고른다 | AP-A-03, AP-A-04, AP-A-07, AP-A-08, AP-A-09 |
| [BP-04](#bp-04) | 예상 가능한 실패는 `Result`, 오류는 `kind` 판별 유니온 | AP-C-02, AP-C-03, AP-C-10, AP-C-11, AP-S-06 |
| [BP-05](#bp-05) | 의존은 Cordis 서비스로 주입, 시간·ID·난수·Logger도 주입 | AP-A-06, AP-C-04, AP-C-05 |
| [BP-06](#bp-06) | 설정은 F `wire-settings` 스키마 키로 읽고 기본값은 스키마에 둔다 | AP-A-05 |
| [BP-07](#bp-07) | 비밀은 참조로 쓰고 값을 출력·로그에 남기지 않는다 | AP-C-08 |
| [BP-08](#bp-08) | 이벤트는 과거형 사실, 큰 값은 blob 참조, 투영은 같은 트랜잭션 | AP-S-01, AP-S-02, AP-S-03, AP-A-04 |
| [BP-09](#bp-09) | 공개 API는 작게, 서브패스 export로 노출 | AP-A-01, AP-S-04 |
| [BP-10](#bp-10) | 문서와 코드는 같은 변경에서 고친다 | (없음) |
| [BP-11](#bp-11) | 한 PR은 한 층 | AP-A-01, AP-A-02 |
| [BP-12](#bp-12) | L0·L1은 주입된 Logger만, 구조화 필드 | AP-C-09 |

<a id="bp-01"></a>
### BP-01 계약 먼저: F 타입·스키마부터 정한다

- 규칙: 새 기능은 `xeon/packages/contracts`(F)에 TypeBox 스키마와 타입을 먼저 정한다. 구현 패키지는 그 타입을 import해서 쓴다. 경계에서 들어오는 값(도구 인자, 이벤트 `payload`, 설정)은 그 스키마로 검증한다. 그룹의 비공개 레코드(`grp.<그룹>.*`) 스키마는 F에 두지 않고 그 그룹이 소유한다([결정: review.decisions-2 D-10]).
- 이유:
  - 같은 층 협력은 F 정의를 통해서만 한다. 그룹 사이 정보는 L2 능력의 레코드와 서비스로 주고받는다(`_research/foundation-plan.md §3`, `architecture.layers.spec §3.1`). F에 타입이 없으면 같은 층 패키지가 서로를 import하게 된다.
  - 확장 지점 선언(이름, fold, 페이로드 타입)도 F4에 둔다(ADR-0007 §3.3). L1과 X가 같은 선언을 공유한다.
  - `isolatedDeclarations` 아래에서 `export const X = Type.Object(...)`는 TS9010으로 실패한다. 공개 스키마는 명시 타입 주석을 단다(`_research/notes/eng-2.md` Compile 항목). 세부는 `eng.typescript.guide`와 `eng.domain-types.guide`가 정한다.
- 좋은 예:

  ```ts
  // xeon/packages/contracts/src/capabilities/read.ts  (F)
  import { Type, type Static, type TAddOptional, type TInteger, type TObject, type TString } from "typebox";

  export const ReadArgsSchema: TObject<{ path: TString; limit: TAddOptional<TInteger> }> = Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    },
    { additionalProperties: false },
  );
  export type ReadArgs = Static<typeof ReadArgsSchema>;

  // xeon/packages/core-tools/src/read.ts  (L1)
  import { ReadArgsSchema } from "@xeon/contracts/capabilities";
  export const readTool = defineTool({ name: "read", args: ReadArgsSchema, execute: runRead });
  ```

  스키마 이름(`<Name>Schema`), 주석 타입(`TAddOptional`), 닫힌 객체, 문자열 상한은 `eng.domain-types.guide` DT-02, DT-03, DT-15, DT-17이다.

- 나쁜 예:

  ```ts
  // xeon/packages/core-tools/src/read.ts  (L1) — 타입을 구현 안에서 만들고 다른 패키지가 이 파일을 import한다
  export interface ReadArgs { path: string; limit?: number }
  export const readTool = defineTool({ name: "read", execute: (raw) => runRead(raw as ReadArgs) });
  ```

- 짝: [AP-C-01](../anti-patterns/guide.md#ap-c-01), [AP-A-02](../anti-patterns/guide.md#ap-a-02).

<a id="bp-02"></a>
### BP-02 작은 순수 함수 + 얇은 어댑터, 부수효과는 L0 인터페이스 뒤

- 규칙: 판단과 변환은 입력만 보고 값을 돌려주는 작은 함수로 쓴다. 파일, 네트워크, 프로세스, DB, 시계 같은 부수효과는 L0 인터페이스(`platform-*`) 뒤에 두고, 위층은 그 인터페이스를 주입받는 얇은 어댑터로 연결한다.
- 이유:
  - OS·환경마다 달라지는 부분은 공통 인터페이스를 정의하고 OS·환경별로 구현만 바꾼다. 소비자 코드에 OS 분기를 두지 않는다(`_research/decisions-log.md` 2026-10-19 설계 규칙).
  - 순수 함수는 `drive` 재호출과 재생 테스트에서 같은 결과를 낸다(ADR-0007 §3.6).
  - 단위 테스트를 우선하고 통합 테스트를 최소로 두는 방침(`_research/foundation-plan.md §4` testing 줄)은 부수효과가 어댑터에 모여 있어야 지킬 수 있다.
- 좋은 예:

  ```ts
  // 순수: 도구 호출이 쓰기인지 판정 (L3 group-helm)
  export function isWriteCall(call: ToolCall): boolean {
    return call.name === "write" || call.name === "edit" || (call.name === "bash" && !isReadOnlyCommand(call.args));
  }

  // 어댑터: 판정 결과를 확장 지점 반환값으로 바꾼다
  export function setup(g: GroupApi<HelmState>) {
    g.on("tool.call.before", (call, st) => (st.phase === "diverge" && isWriteCall(call) ? { deny: "helm.readonly_phase" } : undefined));
  }
  ```

- 나쁜 예:

  ```ts
  g.on("tool.call.before", async (call, st) => {
    const isMac = process.platform === "darwin";                 // 소비자 코드의 OS 분기
    const stat = await Bun.file(call.args.path).exists();         // 지점 핸들러 안의 파일 I/O
    if (st.phase === "diverge" && stat && !isMac) return { deny: "읽기 전용" };
    return undefined;
  });
  ```

- 짝: [AP-C-04](../anti-patterns/guide.md#ap-c-04), [AP-C-06](../anti-patterns/guide.md#ap-c-06), [AP-S-05](../anti-patterns/guide.md#ap-s-05), [AP-S-10](../anti-patterns/guide.md#ap-s-10).

<a id="bp-03"></a>
### BP-03 확장 지점은 선택 표로 고른다

- 규칙: 확장(L3 그룹, 플러그인)이 루프에 개입할 때는 아래 표에서 목적에 맞는 연산 하나를 고른다. 위 행으로 해결되면 아래 행을 쓰지 않는다. 표에 없는 경로(DB 직접 쓰기, 루프 내부 객체 변경)는 쓰지 않는다.

  | 목적 | 연산 | 규칙 | 근거 |
  |---|---|---|---|
  | 관찰 | `on(point)`, fold `tap` | 반환값은 쓰이지 않는다. 핸들러 오류는 기록 후 계속한다 | ADR-0007 §3.2 |
  | 차단 | `on(point)`, fold `first` | `{ deny: reason }`을 돌려준다. 핸들러 오류는 거부로 환산된다(fail-closed) | ADR-0007 §3.2 |
  | 변형 | `on(point)`, fold `chain` | 앞 핸들러 결과를 받아 교체 값을 돌려준다. 오류는 그 핸들러만 건너뛴다 | ADR-0007 §3.2 |
  | 입력 주입 | `post(item, { when, requestId })` | `when`은 `steer`(다음 도구 라운드 뒤), `followUp`(정착 뒤), `next`(경계 뒤 정확히 한 요청). `requestId`는 필수이고 같은 값은 한 번만 들어간다 | ADR-0007 §3.1 |
  | 루프 구동 | `drive(fn, limits)` | 배타 임대, 그룹당 한 슬롯. `fn`은 마지막 커밋 상태로 다시 호출되어도 같은 진행을 낸다. 효과는 `loop.turn`, `loop.spawn`, `post`로만 낸다. 상한은 `{turns, tokens, spawns}` | ADR-0007 §3.1, §3.6, `_research/ext-points.md §5` 안 1 |
  | 묶음과 토글 | `scope(id, { state })` | 위 등록을 한 단위로 묶는다. `enable`·`disable`은 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에서 적용된다([결정: review.decisions-2 U-01]). 정리는 Cordis dispose | ADR-0007 §3.6 |

- 그룹별 기본:
  - [결정] Helm은 `drive`를 쓸 수 있다. 학습 그룹은 `drive`를 쓰지 않고 `on`과 L1 백그라운드 위임으로 동작해 Helm과 함께 켤 수 있다(`_research/decisions-log.md` 계획 v2, ADR-0007 §3.6).
  - [제안] 새 그룹은 `on`과 `post`로 시작한다. 루프 소유가 꼭 필요한 근거(여러 턴을 그룹이 이어서 진행해야 함)가 있을 때만 `drive`를 쓴다.
- 이유:
  - 연산 넷과 fold 셋이 강제 수준, 실패 정책, 재생 규칙을 대신한다. 정해진 연산을 지나야 `requestId` 멱등, 단계 경계 토글, 재생 규칙이 적용된다(ADR-0007 §3.5).
  - `on` 핸들러는 다시 실행해도 되는 질의로 쓴다. 재생 규칙이 이 계약 하나로 남았다(ADR-0007 §3.5).
- 좋은 예:

  ```ts
  export const Helm = scope("helm", { state: doc<HelmState>() }, (g) => {
    g.on("tool.execution.after", (ev) => { metrics.observe(ev); });                       // 관찰: tap
    g.on("tool.call.before", (call, st) =>                                                     // 차단: first
      st.phase === "diverge" && isWriteCall(call) ? { deny: "helm.readonly_phase" } : undefined);
    g.on("input.agent.before", (req, st) =>                                             // 변형: chain
      ({ ...req, systemPrompt: req.systemPrompt + lensFor(st.phase) }));
    g.on("boundary.step.after", (t, st) => {                                                       // 주입: post
      if (needsFollowUp(st, t)) g.post(followUpPrompt(st), { when: "followUp", requestId: requestIdFor("helm", st.turn) });
      return undefined;
    });
    g.drive(async (loop, st) => {                                                       // 구동: Helm만
      while (st.phase !== "done" && loop.budget.turns > 0) {
        const r = await loop.turn({ input: stepPrompt(st) });
        st = await g.commit(reduce(st, r));
      }
    }, { turns: 12 });
  });
  runtime.scope("helm").disable(); // 다음 단계 경계에서 임대 반납, on 핸들러 제외
  ```

- 나쁜 예:

  ```ts
  export const Learning = scope("learning", { state: doc<LearnState>() }, (g) => {
    g.drive(async (loop) => {                          // 관찰이면 충분한데 임대를 잡는다
      const r = await loop.turn({ input: "지난 턴을 요약해" });
      loop.messages.push(summaryOf(r));                // 루프 내부 객체를 직접 바꾼다
    });
    g.post(nudge(), { when: "next" } as never);        // requestId 없이 단언으로 통과시킨다
  });
  ```

- 짝: [AP-A-03](../anti-patterns/guide.md#ap-a-03), [AP-A-04](../anti-patterns/guide.md#ap-a-04), [AP-A-07](../anti-patterns/guide.md#ap-a-07), [AP-A-08](../anti-patterns/guide.md#ap-a-08), [AP-A-09](../anti-patterns/guide.md#ap-a-09).

<a id="bp-04"></a>
### BP-04 예상 가능한 실패는 `Result`, 오류는 `kind` 판별 유니온

- 규칙:
  - 호출자가 정상 흐름에서 처리해야 하는 실패(찾지 못함, 검증 실패, 중복 제출, 잠금 경합(busy), 권한 거부, I/O 오류, 디스크 가득 참, 읽기 전용, 취소, 시간 초과, 소유권 상실)는 `Result<T, E>`로 돌려준다. 목록과 판정 질문은 `eng.typescript.guide` TY-24가 정한다.
  - `E`는 판별 필드 `kind`를 가진 오류 유니온이다(`eng.typescript.guide` TY-11, TY-12). 사용자에게 보일 수 있는 오류도 같다. `code`, `messageKey` 같은 별도 필드를 두지 않는다.
  - 표시 문구와 메시지 키는 L4가 `kind`와 필드로 만든다. 메시지 문장을 코드에 하드코딩하지 않는다. 유도 규칙은 `eng.typescript.guide` 6절 [미결]이다.
  - `throw`는 버그(`Bug`, `assertNever`)에만 쓴다. 복구할 수 없는 상태도 `kind`가 있는 오류 값으로 L4까지 돌려주고, L4가 세션 정지나 종료 코드를 고른다. 예상 가능한 실패를 `Bug`로 던지지 않는다(TY-24, [AP-C-11](../anti-patterns/guide.md#ap-c-11)).
  - 외부 라이브러리가 던지는 예외는 경계 어댑터에서 실패할 수 있는 호출 하나만 감싸 잡고, 받은 값을 `cause`로 담아 `Result`로 바꾼다. `catch`는 오류를 조용히 삼키지 않는다(TY-25).
  - 저장소 오류는 그 세션만 멈추고 다른 세션과 서비스는 계속 돈다.
- 이유:
  - 던진 예외는 시그니처에 보이지 않아 처리를 빠뜨리기 쉽고, `first` fold에서는 거부로 환산되어 의도와 다른 결과를 낸다(ADR-0007 §3.2).
  - 판별자가 `kind` 하나면 호출자가 `switch`와 `assertNever`로 모든 실패를 처리하고, L4는 같은 판별자로 문구를 고른다(TY-12, TY-13).
  - 저장소 오류 뒤에는 커밋 여부를 알 수 없으므로 같은 `requestId`로 재제출해 이미 받아들여진 제출을 찾는다(`_research/notes/F-3.md §6`). 이 흐름은 값으로 돌려받아야 쓸 수 있다.
  - 저장소 오류로 런타임 전체를 종료하는 구조는 피한다(`_research/ref-synthesis.md` "피할 것").
- 좋은 예:

  ```ts
  export type ReadToolError =
    | { readonly kind: "invalid_args"; readonly issues: readonly ParseIssue[] }
    | { readonly kind: "file_not_found"; readonly path: string };

  export function runRead(raw: unknown, deps: ReadDeps): Promise<Result<ToolOutput, ReadToolError>> {
    const args = parse(ReadArgsSchema, raw);
    if (!args.ok) return Promise.resolve(err({ kind: "invalid_args", issues: args.error.issues }));
    return deps.workspace.read(args.value.path);     // L0 어댑터도 Result를 돌려준다
  }
  ```

- 나쁜 예:

  ```ts
  export async function runRead(raw: unknown, deps: ReadDeps): Promise<ToolOutput> {
    try {
      const args = raw as ReadArgs;
      if (!(await deps.fs.exists(args.path))) throw new Error(`파일이 없습니다: ${args.path}`); // 흐름 제어 throw + 하드코딩 문장
      return await deps.fs.read(args.path);
    } catch {
      return { content: "" };                         // 실패를 빈 결과로 삼킨다
    }
  }
  ```

- 짝: [AP-C-02](../anti-patterns/guide.md#ap-c-02), [AP-C-03](../anti-patterns/guide.md#ap-c-03), [AP-C-11](../anti-patterns/guide.md#ap-c-11), [AP-S-06](../anti-patterns/guide.md#ap-s-06).

<a id="bp-05"></a>
### BP-05 의존은 Cordis 서비스로 주입, 시간·ID·난수·Logger도 주입

- 규칙:
  - 다른 패키지의 기능은 Cordis 서비스로 주입받는다. 서비스 이름과 인터페이스 타입은 F에 둔다.
  - 시간(`Clock`), 지연 실행(`Scheduler`), ID 생성(`IdFactory`), 난수(`RandomSource`), 로깅(`Logger`)도 주입받는다. 순수 함수에는 인자로, 어댑터에는 생성 인자(`deps`)로 넘긴다.
  - Cordis 직접 사용은 `ext-host`에 한정된다. 다른 패키지는 ext-host 래퍼가 넘긴 `deps`만 본다.
- 이유:
  - [결정] DI는 Cordis 하나다(ADR-0002 §3). 현재 lint 설정도 `cordis` import를 `packages/ext-host` 밖에서 막는다(`xeon/.oxlintrc.json`).
  - 주입된 시계와 ID는 재생과 테스트를 결정적으로 만든다. 구동 프로그램에서 `Date.now()`·`Math.random()`을 금지해 결정적 재생으로 재개하는 선례가 있다(`_research/ref-synthesis.md` "확장 지점" 4번).
  - `Clock`, `Scheduler`, `RandomSource`, `IdFactory`의 이름과 위치는 `eng.typescript.guide` 1.2절과 `eng.domain-types.guide` DT-06이 정했다. 운영 구현은 `Clock`·`Scheduler`·`RandomSource`가 L0 `platform-os`다. `IdFactory` 인터페이스는 `F.conversation.spec` §3.2에 있고, 구현(`createIdFactory`)은 `platform-os`다. 테스트 구현 `manualClock`, `seededRandom`, `fixedIdFactory`는 각 패키지 `test/` 안에 둔다(`eng.testing.guide` TS-03, [결정: review.decisions-2 U-03]).
  - `Logger` 인터페이스는 F 루트 base에 둔다(`F.readme` §3). 메서드 모양은 `L0.os.spec`이 확정한다.
- 좋은 예:

  ```ts
  // F (eng.typescript.guide 1.2절, eng.domain-types.guide DT-06)
  export interface Clock { now(): number }
  export interface IdFactory { next<P extends IdPrefix>(prefix: P): IdByPrefix[P] }

  // L1 core-persistence
  export function createStamper(deps: { readonly clock: Clock; readonly ids: IdFactory; readonly logger: Logger }) {
    return (): { readonly id: EventId; readonly recordedAt: number } => ({ id: deps.ids.next("evt"), recordedAt: deps.clock.now() });
  }

  // 테스트
  const clock = manualClock(1_760_000_000_000);
  const stamp = createStamper({ clock, ids: fixedIdFactory(clock), logger: memoryLogger() });
  ```

- 나쁜 예:

  ```ts
  import { Context } from "cordis";                       // ext-host 밖에서 Cordis 직접 사용
  import { Layer } from "effect";                         // 두 번째 DI

  export function createStamper(ctx: Context) {
    return () => ({ id: crypto.randomUUID(), recordedAt: Date.now() });   // 시간·ID 직접 호출
  }
  ```

- 짝: [AP-A-06](../anti-patterns/guide.md#ap-a-06), [AP-C-04](../anti-patterns/guide.md#ap-c-04), [AP-C-05](../anti-patterns/guide.md#ap-c-05).

<a id="bp-06"></a>
### BP-06 설정은 F `wire-settings` 스키마 키로 읽고 기본값은 스키마에 둔다

- 규칙:
  - 설정 값은 F `wire-settings` 도메인(`xeon/packages/contracts/src/wire-settings/**`)에 TypeBox 스키마로 키와 기본값을 선언한 뒤 읽는다.
  - 코드에서 `process.env`나 설정 파일을 직접 읽지 않는다. 설정 서비스가 스키마로 검증한 값을 주입한다.
  - 기본값은 스키마의 `default`에 한 번만 둔다. 사용처에서 `?? 30`처럼 다시 쓰지 않는다.
- 이유:
  - 추론 예산·라우팅·레이트 리밋·계정 회전 같은 값은 L4 설정 화면에서 조작할 수 있어야 한다(`_research/decisions-log.md` 2차). 화면은 스키마에서 키와 기본값을 읽는다.
  - 기본값이 여러 곳에 있으면 화면과 실제 동작이 어긋난다.
  - 설정 키 이름 규칙과 범위(사용자, 프로젝트, 세션)는 `F.wire-settings.spec`이 정한다 [가정].
- 좋은 예:

  ```ts
  // F: xeon/packages/contracts/src/wire-settings/loop.ts
  export const LoopSettingsSchema: TObject<{ maxParallelTools: TInteger }> = Type.Object(
    { maxParallelTools: Type.Integer({ minimum: 1, maximum: 64, default: 4 }) },
    { additionalProperties: false },
  );
  export type LoopSettings = Static<typeof LoopSettingsSchema>;

  // L1: 주입된 설정만 본다
  export function createToolRunner(deps: { readonly settings: Readonly<LoopSettings> }) {
    return (calls: readonly ToolCall[]) => runWithLimit(calls, deps.settings.maxParallelTools);
  }
  ```

- 나쁜 예:

  ```ts
  export function createToolRunner() {
    const limit = Number(process.env.XEON_MAX_TOOLS ?? 4);   // 스키마 밖 키, 기본값 하드코딩
    return (calls: readonly ToolCall[]) => runWithLimit(calls, limit);
  }
  ```

- 짝: [AP-A-05](../anti-patterns/guide.md#ap-a-05)(데몬 주소 같은 환경 전제를 코드에 두는 문제).

<a id="bp-07"></a>
### BP-07 비밀은 참조로 쓰고 값을 출력·로그에 남기지 않는다

- 규칙:
  - 코드, 설정, 모델 컨텍스트, 이벤트에는 비밀 참조(`secret://<name>`)만 둔다.
  - 값이 필요한 곳은 비밀 서비스에서 lease를 받아 그 안에서만 쓴다. 값을 변수에 오래 두거나 다른 객체로 복사하지 않는다.
  - 로그와 오류에는 참조 이름만 남긴다.
  - 새 키 등록은 작업 규칙의 `just secret-add <키> [env]`로 한다.
- 이유:
  - [결정] 비밀 기본값은 SOPS(age)이고, 에이전트는 값을 모른 채 참조로 쓴다(`_research/decisions-log.md` 2차). age 키는 `SOPS_AGE_KEY_CMD`로 OS 키체인에서 읽는다(`_research/foundation-plan.md §2` 비밀 행).
  - 참조 형식과 lease 인터페이스는 `_research/secrets.md §6.1`과 공급자 인터페이스 초안을 따른다. 확정은 `L0.secrets.spec`이 한다.
- 좋은 예:

  ```ts
  export async function callWebSearch(deps: { readonly secrets: SecretService; readonly logger: Logger }, q: string) {
    const ref = secretRef("exa-key");                             // [가정] F의 브랜드 생성 함수, 결과는 "secret://exa-key"
    const lease = await deps.secrets.lease(ref, { purpose: "web.search" });
    deps.logger.info("web.search.requested", { secretRef: ref, queryLength: q.length });
    return exaSearch(q, { auth: lease });                          // 값은 lease 안에서만 쓰인다
  }
  ```

- 나쁜 예:

  ```ts
  export async function callWebSearch(q: string) {
    const key = process.env.EXA_API_KEY!;                          // 값을 직접 읽는다
    console.log("using key", key.slice(0, 8));                    // 일부라도 출력한다
    return exaSearch(q, { apiKey: key });
  }
  ```

- 짝: [AP-C-08](../anti-patterns/guide.md#ap-c-08).

<a id="bp-08"></a>
### BP-08 이벤트·투영 작성 요령

- 규칙:
  - 이벤트는 일어난 사실을 기록한다. 코어 kind 형식은 `<영역>.<이름>`(소문자 snake_case, 점 하나)이다. 예: `item.recorded`, `effect.intent`, `effect.result`, `scope.changed`. 이름 규칙의 정본은 `F.records.spec` §3.2, 코어 카탈로그는 §3.3이고, 운용은 `eng.events.design` 4.5·4.4절이다.
  - 명령(하려는 일)은 이벤트로 저장하지 않는다. 명령을 처리한 결과로 생긴 사실만 저장한다.
  - 이벤트 `payload`는 kind별 TypeBox 스키마와 `version`을 갖는다. 종류 필드는 `kind`, 내구·휘발 판별자는 `durable`이다(`F.records.spec` §3.1, ADR-0004 §3.2 이벤트 레코드 초안).
  - 큰 값(도구 출력, 이미지, 파일 내용)은 blob으로 빼고 이벤트에는 `BlobRef`만 둔다. blob 파일은 커밋 전에 쓴다(`eng.events.design` EV-04, `eng.transactions.design` TX-04).
  - 세션 쓰기는 `SessionService.commit` 한 경로로만 한다(`eng.transactions.design` TX-07). 투영(`p_*`, `cap_*`, `x_*`)은 그 커밋 안에서 투영기가 같은 트랜잭션으로 갱신한다. 코드가 투영 테이블에 직접 쓰지 않는다. 투영은 이벤트에서 다시 만들 수 있어야 한다.
  - 스트리밍 델타는 휘발 이벤트(`session.emitVolatile`, kind `item.updated`)로만 흘린다.
  - 확장 기록은 `x.<extId>.*`(플러그인)·`grp.<groupId>.*`(의도 그룹) 이벤트로 남기고, 같은 DB의 `x_<확장 id의 '-'를 '_'로>_*` 테이블은 그 확장의 투영기만 쓴다(`eng.context-map.design` 5.1·5.2절).
- 이유:
  - [결정] 세션 저장은 SQLite 이벤트 소싱 + 투영, 단일 DB, 확장 접두사 테이블이다. 큰 출력은 blob + 해시, 토큰 델타는 저장하지 않는다(ADR-0004 §3.1~§3.3).
  - 이벤트는 이미 일어난 일의 기록이라 재생 때 다시 실행하지 않는다. 재생 규칙과 내구·휘발 구분은 `eng.events.design`이 정한다.
- 좋은 예:

  ```ts
  // core-tools: 효과 결과(E3)를 커밋 요청으로 만든다. 커밋 키 규칙은 eng.transactions.design 4.8절
  // blobRef는 호출 전에 deps.store.putBlob(out.bytes, out.mediaType)로 얻는다(16 KiB 초과 출력, EV-04). 실패는 그 자리에서 Result로 돌려준다
  export function resultRequest(deps: ResultDeps, call: OpenEffect, out: ToolOutput, blobRef: BlobRef | null): CommitRequest {
    return {
      threadId: call.threadId,
      requestId: `tool:${call.toolCallId}:result`,
      fingerprintSource: { toolCallId: call.toolCallId, status: out.status, sha256: blobRef?.sha256 ?? null },
      build: () => ({
        kind: "append",
        drafts: [
          deps.tools.draft({ kind: "effect.result", causationId: call.intentEventId,
            payload: { effectId: call.effectId, status: out.status, resultItemId: call.resultItemId, output: out.output, blobRef,
              durationMs: out.durationMs, synthesized: false } /* … */ }),
          deps.loopItems.draft({ kind: "item.recorded", payload: { item: out.resultItem } /* … */ }),   // toolResult item, 같은 커밋
        ],
        checkpoint: null,
      }),
    };
  }
  // session.commit(resultRequest(...)): p_effects·p_items 투영은 commit 안에서 core 투영기가 갱신한다
  ```

- 나쁜 예:

  ```ts
  tools.draft({ kind: "runTool", payload: { call } /* … */ });                          // 명령을 이벤트로, 이름 규칙 위반
  tools.draft({ kind: "effect.result", payload: { effectId, output: hugeStdout } /* … */ }); // 큰 값을 그대로 저장
  storeDb.write((tx) => tx.run("UPDATE p_effects SET result_status = 'ok' WHERE effect_id = ?", [effectId]));   // 투영 직접 쓰기(TX-07)
  ```

- 짝: [AP-S-01](../anti-patterns/guide.md#ap-s-01), [AP-S-02](../anti-patterns/guide.md#ap-s-02), [AP-S-03](../anti-patterns/guide.md#ap-s-03), [AP-A-04](../anti-patterns/guide.md#ap-a-04).

<a id="bp-09"></a>
### BP-09 공개 API는 작게, 서브패스 export로 노출

- 규칙:
  - 각 패키지는 `package.json`의 `exports`에 적은 진입점만 공개한다. 기능 묶음마다 서브패스를 둔다. 예: `@xeon/contracts/extensions`, `@xeon/contracts/records`.
  - 진입점은 다른 패키지가 실제로 쓰는 이름만 다시 내보낸다. 내부 도우미와 테스트 도구는 내보내지 않거나 `./testing` 서브패스에 둔다.
  - `export default`를 쓰지 않는다. 이름 있는 export만 쓴다.
  - 배포에서 빠지는 코드(위장 provider 등)는 별도 패키지(`plugins/*`)로 두고 본체 서브패스에 넣지 않는다.
- 이유:
  - 내부 패키지는 TS 소스를 그대로 export한다(`_research/foundation-plan.md §2` 빌드 행). 진입점이 넓으면 내부 파일 이동이 다른 패키지를 깨뜨린다.
  - F는 서브패스(conversation, records, capabilities, extensions, wire, settings)로 나눈다(`_research/foundation-plan.md §3`).
  - 현재 lint 설정은 다른 패키지의 `src`·`dist` 경로 import와 `export default`를 막는다(`xeon/.oxlintrc.json`의 `no-restricted-imports`, `import/no-default-export`).
- 좋은 예:

  ```json
  {
    "name": "@xeon/core-tools",
    "exports": {
      ".": "./src/index.ts",
      "./testing": "./src/testing/index.ts"
    }
  }
  ```

  ```ts
  // xeon/packages/core-tools/src/index.ts
  export { createToolRegistry } from "./registry.ts";
  export type { ToolRegistry } from "./registry.ts";
  ```

- 나쁜 예:

  ```ts
  // 다른 패키지에서
  import { normalizePath } from "@xeon/core-tools/src/internal/path.ts"; // 내부 경로 import
  // core-tools 안에서
  export * from "./internal/index.ts";                                    // 내부 전부 노출
  export default createToolRegistry;
  ```

- 짝: [AP-A-01](../anti-patterns/guide.md#ap-a-01), [AP-S-04](../anti-patterns/guide.md#ap-s-04).

<a id="bp-10"></a>
### BP-10 문서와 코드는 같은 변경에서 고친다

- 규칙:
  - spec·plan의 `binds`가 가리키는 코드의 인터페이스, 동작 규칙, 설정 키를 바꾸면 같은 변경에서 그 문서를 고친다.
  - 패키지나 도메인을 추가·이동·삭제하면 `docs/xeon/_routing/routes.yaml`의 `layout`과 `manifest`를 같은 변경에서 고친다. 문서의 `binds`는 `layout` 경로와 같아야 한다.
  - 문서를 고친 뒤 `just docs-route --check`(`xeon/scripts/docs-route.ts`)로 깨진 `binds`·`depends_on` 참조가 없는지 확인한다.
- 이유:
  - 작업자는 `docs-route`가 고른 문서를 읽고 구현한다(`_research/foundation-plan.md §4` 라우팅). 문서가 코드보다 늦으면 다음 작업자가 옛 계약으로 구현한다.
  - 문서 검사 기준은 `binds`·`depends_on` 깨진 참조 0이다(`_research/foundation-plan.md §6`).
- 좋은 예:

  ```text
  변경 1개 (한 커밋):
    xeon/packages/contracts/src/extensions/points.ts   지점 `before_subagent_spawn` 추가
    docs/xeon/F/extensions/spec.md                      §3 지점 표에 한 행 추가, 수용 기준 1줄 추가
    just docs-route --check                             → 오류 0
  ```

- 나쁜 예:

  ```text
  변경 1: xeon/packages/core-loop/ → xeon/packages/core-runner/ 로 이름 변경
  (routes.yaml layout, L1/loop/spec.md binds는 그대로) → docs-route가 L1.loop.spec을 고르지 못한다
  ```

- 짝: 없음. 문서 쪽 검사는 `docs-route --check`가 맡는다.

<a id="bp-11"></a>
### BP-11 한 PR은 한 층

- 규칙:
  - 한 PR(또는 리뷰 단위의 변경)은 한 층의 패키지만 고친다. F 계약 변경과 그 계약을 쓰는 층 구현은 PR을 나눠 F를 먼저 합친다.
  - 예외는 이름 변경처럼 기계적으로 여러 층에 걸치는 변경이다. 이때 PR 설명에 이유를 적는다.
- 이유:
  - CI는 층별 job matrix(F, X, L0~L4)로 돌고 turbo `--affected`로 범위를 정한다(`_research/foundation-plan.md §5` P3). 한 층 변경은 한 job과 한 리뷰어로 끝난다.
  - 계약을 먼저 합치면 상향 의존이나 같은 층 import 없이 위층을 구현할 수 있다(BP-01).
  - 구현 작업도 층별 병렬로 나눠 진행한다(`_research/foundation-plan.md §5` P4).
- 좋은 예:

  ```text
  PR 1 (F):  contracts/src/extensions — PostItem에 `origin` 필드 추가, 스키마 테스트
  PR 2 (X):  ext-host — post 큐가 origin을 기록
  PR 3 (L3): group-helm — origin "helm"으로 post 호출
  ```

- 나쁜 예:

  ```text
  PR 1: contracts + ext-host + core-loop + group-helm + apps/cli 를 한 번에 수정
        (F 스키마 변경과 4개 층 구현이 섞여 리뷰와 되돌리기가 어렵다)
  ```

- 짝: [AP-A-01](../anti-patterns/guide.md#ap-a-01), [AP-A-02](../anti-patterns/guide.md#ap-a-02).

<a id="bp-12"></a>
### BP-12 L0·L1은 주입된 Logger만, 구조화 필드

- 규칙:
  - L0·L1 패키지는 주입받은 `Logger` 인터페이스만 쓴다. `console`과 로거 라이브러리를 import하지 않는다. L2·L3도 같은 방식을 기본으로 한다 [제안].
  - 로그 메시지는 고정된 이벤트 이름(`turn.finished`)이고, 값은 구조화 필드로 넘긴다. 문자열 보간으로 메시지를 만들지 않는다.
  - 필드에는 세션 ID, 턴 번호, 도구 호출 ID처럼 상관관계를 찾을 수 있는 값을 넣는다. 비밀 값은 넣지 않는다(BP-07).
  - 로거 구현과 출력 위치(파일, stderr, 데스크톱 UI)는 L4 진입점이 정한다.
- 이유:
  - CLI in-process, 데스크톱 사이드카(stdio JSON-RPC), 서비스 모드는 출력 위치가 다르다(`_research/foundation-plan.md §1` 3번, ADR-0006). stdout에 쓰는 `console.log`는 사이드카 프로토콜과 섞인다.
  - 구 설계도 하위 층은 로거를 import하지 않고 주입받은 `Logger`만 쓰게 했다(`docs/design/06-system-architecture.md §3.5.1` R6).
- 좋은 예:

  ```ts
  export interface Logger {                     // [가정] F에 둔다
    debug(event: string, fields?: LogFields): void;
    info(event: string, fields?: LogFields): void;
    warn(event: string, fields?: LogFields): void;
    error(event: string, fields?: LogFields): void;
    child(fields: LogFields): Logger;
  }

  export function onToolDone(deps: { readonly logger: Logger }, call: ToolCall, ms: number) {
    deps.logger.info("tool.finished", { threadId: call.threadId, toolCallId: call.id, tool: call.name, durationMs: ms });
  }
  ```

- 나쁜 예:

  ```ts
  import pino from "pino";
  const log = pino();                                                   // 모듈마다 로거 생성
  export function onToolDone(call: ToolCall, ms: number) {
    log.info(`tool ${call.name} finished in ${ms}ms`);                  // 문자열 보간
    console.log("args", JSON.stringify(call.args));                     // 인자에 비밀 참조가 풀려 있을 수 있다
  }
  ```

- 짝: [AP-C-09](../anti-patterns/guide.md#ap-c-09).

## 3. 확인 방법

| 규칙 | 도구 | 리뷰 질문 |
|---|---|---|
| BP-01 | `just typecheck`(`isolatedDeclarations`), `check-layers.ts` | 새 경계 값의 스키마가 `contracts`에 있는가? |
| BP-02 | 단위 테스트 커버리지(`bunfig.toml` `coverageThreshold`) | 판단 로직이 I/O 없이 테스트되는가? 소비자 코드에 OS 분기가 있는가? |
| BP-03 | 재생 테스트, ext-host 런타임 검사(`requestId` 필수) | 선택 표의 위 행으로 해결되는가? `drive`가 꼭 필요한가? |
| BP-04 | oxlint `typescript/only-throw-error`, `no-throw-literal`, `no-empty`, `preserve-caught-error`, 스캔 `xeon/error-discriminant`(TY-12), `xeon/bug-for-expected`(TY-24), `xeon/catch-swallow`(TY-25) | 이 실패는 호출자가 처리해야 하는가? 이 `Bug`는 코드와 설정이 올바라도 생길 수 있는가? 오류 유니온의 판별자가 `kind`이고 표시 문구가 코드에 없는가? |
| BP-05 | oxlint `no-restricted-imports`(`cordis`), 금지 호출 검사 [제안] | 시간·ID·난수를 주입받는가? |
| BP-06 | 설정 스키마 테스트 | 설정 키가 `wire-settings` 스키마에 있는가? 기본값이 한 곳에 있는가? |
| BP-07 | gitleaks, Logger 마스킹 테스트 | 로그와 오류에 lease 값이 들어갈 수 있는가? |
| BP-08 | 투영 재생성 테스트(이벤트에서 투영을 다시 만들어 비교) | 이벤트 이름이 과거형 사실인가? 큰 값은 blob인가? |
| BP-09 | oxlint `import/no-default-export`, `no-restricted-imports`(src·dist), publint·attw(공개 패키지) | 새 export를 실제로 쓰는 패키지가 있는가? |
| BP-10 | `just docs-route --check` | `binds` 대상 코드를 바꿨는데 문서 변경이 없는가? |
| BP-11 | CI 층별 job | 변경 파일이 두 층 이상에 걸치는가? 걸친다면 PR 설명에 이유가 있는가? |
| BP-12 | oxlint `no-console` | 로그 메시지가 고정 이름이고 값이 필드로 가는가? |

`just verify`가 위 도구를 한 번에 돌린다. 작업을 끝내기 전에 `just verify`를 실행한다.

## 4. 예외 절차

- 기본 선택과 다른 방법이 린트·스캔 규칙에 걸리면 `eng.typescript.guide` 4.1절 형식의 disable 주석을 단다: `// oxlint-disable-next-line <규칙> -- <이유> (<이슈 URL>)`. 이 문서가 미리 허용한 경우는 이슈 URL 대신 `(eng.best-practices.guide BP-NN)`을 쓴다.
- 검사 수단이 없는 기본 선택을 벗어날 때는 코드 주석을 따로 두지 않고 PR 설명에 `BP-NN 예외: <이유>`를 적는다. 리뷰어가 이유를 승인한다.
- 같은 예외가 두 번 이상 나오면 이 문서의 규칙을 고칠지 검토한다. 규칙을 고치는 변경은 짝 안티패턴 항목도 함께 고친다.
- 사용자 결정에서 나온 규칙(BP-03의 Helm·학습 그룹 기본, BP-05의 단일 DI, BP-07의 SOPS 참조, BP-08의 단일 DB)을 벗어나려면 ADR로 승인한다.
- 린트 규칙을 끄는 방식은 `eng.typescript.guide` 4.1절이 정본이다.

## 5. 미결 사항

- [미결] 확장 지점 이름 목록. 예제의 `tool.call.before`, `tool.result`, `boundary.step.after`, `input.agent.before`, `tool.execution.after`는 [가정]이며 `F.extensions.spec`이 확정한다. fold에 `collect`를 더할지도 같은 문서에서 정한다(`_research/notes/F-1.md §7`).
- `Logger` 인터페이스는 F 루트 base(`F.readme` §3 루트 진입점)에 있고 운영 구현은 `platform-os`다. BP-05, BP-12 예제의 메서드 모양은 `L0.os.spec`이 확정한다. `Clock`, `Scheduler`, `IdFactory`, `RandomSource`는 `eng.typescript.guide` 1.2절과 `eng.domain-types.guide` DT-06이 정했다([결정: review.decisions-2 U-03]).
- [미결] BP-12를 L2·L3까지 강제할지(현재 [제안]).
- [미결] BP-11의 "한 PR"이 커밋 단위 로컬 작업(push 전)에도 적용되는지.
