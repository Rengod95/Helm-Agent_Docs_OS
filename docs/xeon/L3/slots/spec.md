---
id: L3.slots.spec
layer: L3
domain: slots
kind: spec
status: draft
depends_on: [L3.group-kit.spec, F.extensions.spec, adr.0017, F.wire-settings.spec, eng.testing.guide, eng.context-map.design]
binds: []
---

# L3 추가 그룹 슬롯 (slots)

`_routing/routes.yaml` layout L3는 slots를 "코드 없음(템플릿 문서만)"으로 둔다. 그래서 `binds`는 비어 있다. 템플릿 파일의 물리적 위치는 3.3.1절의 [제안]이다.

## 1. 목적과 범위

계획 v2 L3-d의 구성요소 3개(제2의 의도 그룹, 정책 플러그인, 그룹 템플릿)를 정한다(`_research/layer-plan-v2.json` L3-d, 세 항목 모두 2차).

근거:

- [결정] 사용자의 요구는 제2의 Helm 같은 사상도 루프에 붙였다 뗄 수 있는 것이다(`_research/decisions-log.md` 2026-10-21 사용자 의중).
- [결정] 배포 단위는 층(F~L3) 전체를 제공하는 런타임이고, 사용자가 층별 플러그인과 그룹을 추가·수정·교체할 수 있어야 한다. 설계 노력은 제2의 Helm을 쉽게 추가하는 펀더멘탈과 스키마에 집중한다(`_research/decisions-log.md` 2026-10-21 배포 단위 정정).
- 세 구성요소는 모두 `group-kit` 위에서 코어 diff 0으로 추가되어야 한다(`product.vision.spec` §9.1 S1).

정하는 것:

- 새 사상을 그룹으로 만들지 판정하는 기준, 그룹 추가 체크리스트, 외부 그룹의 공존·신뢰·설정 규칙(3.1절, 4.1절)
- 정책 플러그인의 구조 규칙과 정식 예 3종: 검토 강제(`reviewgate`), 커밋 전 검증(`commitguard`), 가드레일 지점 예(`guardrail`)(3.2절, 4.2절)
- 그룹 템플릿의 파일 목록, 종류 3개(drive, policy, observe)와 골격 코드, 이름 규칙, 템플릿 색인 형식, 생성 명령의 요구 인터페이스(3.3절, 4.3절)

다루지 않는 것:

- `defineGroup`, `GroupApi<S>`, `GroupService`, `DriveArbiter`, `replayDrive`의 정의: `L3.group-kit.spec`
- 4연산 타입, 지점 표, 매니페스트 스키마, 검증 함수: `F.extensions.spec`
- 확장 로딩, 신뢰 등급, 예약 키 `ext.<id>.enabled`·`ext.<id>.isolation`의 정의: `X.loading-trust.spec`
- `xeon group new` 명령의 실행(인자 해석, 파일 쓰기, 출력): `L4.cli.spec`
- Helm과 학습 그룹의 내부: `L3.helm.spec`, `L3.learning.spec`

정식 예의 위치:

- [제안] 정책 예 3종은 제품 기능이 아니다. 템플릿과 `group-kit`의 정책 경로를 검증하는 테스트 fixture다. 기본 배포에 넣지 않고 `group-kit`의 `testing` 서브패스 아래에 둔다(`L3.slots.plan` §2).
- [결정: review.m3-design-inputs D-M3-30] 코어에 내장 콘텐츠 검사는 두지 않는다. 대신 F·X가 fail-closed 가드레일 지점 셋(모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전)을 둔다(ADR-0017). 검사는 이 지점에 붙는 플러그인이 한다. 이 문서의 `guardrail`은 그 지점을 쓰는 예다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 의도 그룹 | `kind: "group"`, `layer: "L3"`인 확장. scope 하나로 지점 핸들러, post, drive, 상태를 묶어 켜고 끈다(`F.extensions.spec` §2) |
| 제2의 의도 그룹 | Helm, 학습 그룹 밖에 사용자가 추가하는 의도 그룹 |
| 외부 그룹 | 저장소의 `xeon/packages` 밖에서 설치되는 그룹. 설정 네임스페이스는 `ext.<id>.`다 |
| 정책 플러그인 | drive 없이 `on`과 `post`만 쓰는 작은 확장. 상태·레코드·토글 필요에 따라 `kind: "group"` 또는 `kind: "plugin"`이다(4.2절) |
| 정책 그룹 | `kind: "group"`인 정책 플러그인 |
| 정식 예 | 이 문서가 정한 정책 플러그인 3종. 템플릿 검증용 fixture |
| 그룹 템플릿 | 새 그룹 패키지의 최소 골격 파일 묶음. 종류는 drive, policy, observe |
| 템플릿 색인 | 템플릿 종류별 파일 목록과 치환 자리를 적은 JSON(`templates/index.json`) |
| 단계 경계 | Xeon step 종료 직후(도구 결과 커밋 뒤). 켜기·끄기와 임대 교대가 적용되는 시점이다(`F.extensions.spec` §4.5) [결정: review.decisions-2 U-01] |

## 3. 인터페이스

### 3.1 제2의 의도 그룹

#### 3.1.1 그룹으로 만들지 판정하는 기준

[결정] 스킬이나 일반 플러그인으로 충분한 기능은 의도 그룹으로 만들지 않는다. 모델의 행동을 코드로 막거나 구동해야 할 때만 그룹을 쓴다(`product.vision.spec` §5, §7.1).

[제안] 판정 순서:

| 순서 | 질문 | 예이면 |
|---|---|---|
| 1 | 모델에게 알려 주기만 하면 되는가(지시, 절차, 참고 지식) | 스킬. 그룹을 만들지 않는다 |
| 2 | 새 도구나 서비스 API(다른 그룹도 쓸 수 있는 능력)가 필요한가 | L2 능력 provider 플러그인. 그룹 안에 능력을 두지 않는다(`eng.context-map.design` 3절 협력 규칙 6, CM-06) |
| 3 | 도구 호출을 막거나(first), 모델 요청·결과를 바꾸거나(chain), 입력을 넣어야(post) 하는가. drive는 쓰지 않는가 | 정책 플러그인(3.2절). 상태·레코드·토글 필요로 group과 plugin을 고른다(4.2.1) |
| 4 | 여러 턴에 걸친 진행(단계, 병렬 서브에이전트, 결과 커밋 뒤 적용 턴)을 런타임이 구동해야 하는가 | drive 의도 그룹(drive 템플릿) |
| 5 | 관찰과 기록만 하는가(카운터, 신호, 레코드 공개) | 관찰 전용 그룹(observe 템플릿). 토글과 레코드가 필요 없으면 plugin |

#### 3.1.2 그룹 추가 체크리스트

[제안] 새 그룹을 추가하는 변경은 아래 항목을 모두 갖춘다. 템플릿(3.3절)은 각 항목의 자리를 미리 만든다.

| # | 항목 | 확인 방법 |
|---|---|---|
| C1 | 매니페스트 `kind: "group"`, `layer: "L3"`, `usesDrive`를 명시한다. 이름은 3.3.4절 규칙을 따른다 | `validateManifest`(`layer_kind_mismatch`, `drive_requires_group`, `name_invalid`, `name_reserved`) |
| C2 | 상태 스키마(`StateDecl<S>`: TypeBox 스키마, 초기값, `version`)를 둔다. 상태가 없으면 생략한다 | `group-kit` 로드 테스트 |
| C3 | drive 사용 여부를 정한다. 쓰면 상한을 `DriveOptions.limits`로 요청하고, 재생 테스트(C7)를 갖춘다 | `validateUsage`(`drive_undeclared`) |
| C4 | 쓰는 레코드 kind를 `recordKinds`에 `RecordKindDecl`로 선언한다. 형식은 `grp.<id>.<영역>.<이름>`이다. 읽는 kind는 `readsRecordKinds`에 둔다 | `validateManifest`(`record_kind_prefix`), `validateUsage`(`record_kind_undeclared`, `read_kind_undeclared`) |
| C5 | 설정 키는 `ext.<id>.<이름>`만 쓴다. `enabled`, `isolation`은 선언하지 않는다(X 로더 예약) | `buildCatalog`(`foreignNamespace`, `duplicateKey`) |
| C6 | 단위 테스트: 각 핸들러의 결정·패치, 켜기·끄기, 설정 기본값 | `bun test` |
| C7 | 재생 테스트: drive 그룹이면 `replayDrive`로 모든 커밋 지점에서 끊고 재개한다 | `replayDrive`(`L3.group-kit.spec`) |
| C8 | 다른 그룹 패키지를 import하지 않는다. 능력은 `requires`·`optional`과 `g.capability(ServiceKey)`로 쓴다 | check-layers `DR-02`, `validateUsage`(`capability_undeclared`) |
| C9 | `contracts`, `ext-host`, `platform-*`, `core-*`를 수정하지 않는다 | 변경 diff 검사(`product.vision.spec` S1) |

#### 3.1.3 공존 규칙

- [결정] drive 임대는 한 번에 그룹 하나만 가진다. on, post, 백그라운드 위임은 여러 그룹이 함께 쓴다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 4).
- [제안] drive 그룹이 둘 이상 켜지면 임대는 `DriveArbiter`(`L3.group-kit.spec`)의 정책과 `x.primitives.activeDriveGroup` 설정에 따라 한 그룹에 간다. 임대를 받지 못한 그룹은 대기하고, 그동안 on 핸들러와 post는 동작한다. 대기와 거부 가운데 기본 동작의 확정은 `L3.group-kit.spec`의 [미결]을 따른다.
- [결정] 그룹 사이 통신은 F4 스키마가 있는 레코드로만 한다(`F.extensions.spec` §4.8). 다른 그룹의 비공개 상태와 기록(`x_<id>_*` 테이블, `grp.<id>.state.committed`, `recordPrivate`로 쓴 `grp.<id>.*`)은 읽지 않는다.
- 핸들러 실행 순서(tier)는 `X.primitives.spec`이 정한다. 새 그룹은 순서에 기대는 동작을 만들지 않는다 [제안]. 예: first 지점에서 다른 그룹보다 먼저 결정해야 동작하는 정책.

#### 3.1.4 외부 그룹의 신뢰와 설정 네임스페이스

- 신뢰 등급, 설치 출처 판정, 프로세스 격리는 `X.loading-trust.spec`이 정한다. 매니페스트 `trust.level` 값 집합은 [가정] `builtin`, `user`, `project`, `untrusted`다(`F.extensions.spec` §3.1).
- 외부 그룹은 `trust.level`이 `builtin`이 아니다. 그래서 예약 이름과 L2 도메인 이름을 쓸 수 없다(`F.extensions.spec` §4.7 `name_reserved`).
- 외부 그룹의 설정 키는 `ext.<id>.<이름>`이다. 코어 네임스페이스(`l3.` 등)와 다른 확장의 `ext.<다른 id>.`에는 키를 더할 수 없다(`F.wire-settings.spec` §3.8.3 규칙 2). 기본 그룹(Helm, 학습 그룹)만 `l3.<도메인>.`을 쓴다(같은 절 규칙 3).

#### 3.1.5 제2의 Helm 예시

[제안] 가상 그룹 `focuslens`는 긴 작업 중 목표에서 벗어난 탐색을 줄이는 사상이다. `input.agent.before`(collect)로 현재 목표 요약을 시스템 프롬프트 끝에 더하고, `tool.execution.after`(tap)로 목표와 무관한 도구 사용 횟수를 메모리에 세어 `boundary.settle.after`(tap)에서 turn당 한 번 상태에 커밋하며(L3.helm.spec §4.3, §7과 같은 관찰 권장안), 그 수가 `ext.focuslens.driftLimit`를 넘으면 `post`(`when: "next"`)로 목표 재확인 입력을 한 번 넣는다. drive는 쓰지 않으므로 policy 템플릿에서 시작하고, Helm이 켜져 있어도 임대 경쟁 없이 함께 동작한다. 레코드 `grp.focuslens.drift.detected`를 공개하면 Helm은 `readsRecordKinds`로 읽을 수 있다. 이 변경은 `group-focuslens` 패키지(또는 외부 디렉터리) 하나만 더하고 코어 diff는 0이다.

### 3.2 정책 플러그인

#### 3.2.1 구조 규칙

[제안] 정책 플러그인은 다음을 지킨다.

| 규칙 | 내용 |
|---|---|
| P1 | 매니페스트 `usesDrive: false`. `drive`를 호출하지 않는다 |
| P2 | 상태는 선택이다. 상태가 있으면 `kind: "group"`으로 둔다(4.2.1) |
| P3 | 쓰는 연산은 `on`과 `post`다. 레코드 공개가 필요하면 `record`를 더한다 |
| P4 | 지점 fold별 용도: tap은 관찰, first는 차단, chain은 형성(`F.extensions.spec` §2, `_research/layer-plan-v2-notes.md` 확장 지점 절) |
| P5 | 지점 종류 5종(input, request, tool, boundary, session) 모두 쓸 수 있다. 정식 예는 input, tool, boundary 지점을 쓴다 |
| P6 | 핸들러는 다시 실행해도 되는 질의다. 외부 효과는 `post`(멱등 키 필수), `commit`, `record`로만 낸다(`F.extensions.spec` §4.3) |
| P7 | first 핸들러의 예외는 그 지점의 거부값(`FIRST_DENY`)이 된다. 정책은 의도하지 않은 거부를 막으려면 예외를 안에서 잡고 결정으로 바꾼다 |

#### 3.2.2 정식 예 1: 검토 강제 (`reviewgate`)

턴에서 쓰기 도구를 쓴 뒤 모델이 정착하려 하면, 정착 전에 검토 입력을 한 번 넣고 모델 요청을 한 번 더 일으킨다. `_research/item-catalog.md`의 "완료 게이트(계속 주입과 상한)" 행을 정책 플러그인으로 옮긴 것이다.

| 항목 | 값 |
|---|---|
| 매니페스트 | `name: "reviewgate"`, `kind: "group"`, `layer: "L3"`, `usesDrive: false`, `usesPost: true`, `points: ["tool.result", "boundary.settle.before", "boundary.settle.after"]` |
| 지점과 fold | `tool.result`(chain, 패치 없음: 쓰기 도구 결과 관찰 후 상태 커밋), `boundary.settle.before`(chain: `{ continue: true }` 패치), `boundary.settle.after`(tap: 상태 초기화 커밋) |
| post | `kind: "context"`, `customType: "grp.reviewgate.review.requested"`, `when: "steer"`, `requestId: "reviewgate:<turnId>"` |
| 실패 정책 | chain 예외는 그 핸들러의 패치만 버린다(skip). 그 턴은 검토 없이 정착한다. tap 예외는 기록 후 계속한다 |
| 설정 키 | `ext.reviewgate.writeTools`(문자열 목록, 기본 `["write", "edit"]`), `ext.reviewgate.prompt`(문자열), `ext.reviewgate.mode`(`"continue"`\|`"followUp"`, 기본 `"continue"`) |
| 수용 기준 | 쓰기 도구를 쓴 테이프 턴에서 검토 입력이 정확히 한 번 들어가고 모델 요청이 한 번 더 일어난다. 같은 턴의 두 번째 정착에서는 post가 `duplicate: true`이고 `continue`를 요청하지 않는다. 쓰기가 없는 턴은 그대로 정착한다 |

```ts
// group-kit/src/testing/policies/reviewgate.ts  (fixture, 4.2.2)
import { Type, type Static } from "typebox";
import { defineSettings } from "@xeon/contracts/settings";
import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";

const reviewgateManifest = groupManifest({                          // 저장소 안 fixture라 매니페스트 객체를 직접 정의한다
  schemaVersion: 1, name: "reviewgate", version: "0.1.0", displayName: "검토 강제",
  layer: "L3", kind: "group", entry: "./src/testing/policies/reviewgate.ts",
  usesDrive: false, usesPost: true, points: ["tool.result", "boundary.settle.before", "boundary.settle.after"],
  defaultEnabled: false, trust: { level: "builtin" },
});

const ReviewState = Type.Object({ writes: Type.Integer({ minimum: 0 }) });
type ReviewState = Static<typeof ReviewState>;

const reviewgateSettings = defineSettings("ext.reviewgate", {      // 내보내지 않으므로 타입 주석이 필요 없다
  writeTools: { type: Type.Array(Type.String()), default: ["write", "edit"], runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "session"], ui: { tab: "plugins", widget: "list", order: 10, label: "검토 대상 도구" }, since: "0.1.0" },
  prompt: { type: Type.String(), default: "방금 바꾼 내용을 검토하고 문제가 있으면 고쳐라.", runtimeChange: "nextTurn",
    allowedScopes: ["user", "project"], ui: { tab: "plugins", widget: "text", order: 20, label: "검토 지시문" }, since: "0.1.0" },
  mode: { type: Type.String(), default: "continue", range: { enum: ["continue", "followUp"] }, runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "session"], ui: { tab: "plugins", widget: "select", order: 30, label: "검토 방식" }, since: "0.1.0" },
});

export const reviewgate: GroupModule = defineGroup<ReviewState>({
  manifest: reviewgateManifest,
  state: { schema: ReviewState, initial: { writes: 0 }, version: 1 },
  settings: reviewgateSettings,
  setup(g) {
    g.on("tool.result", async (p, current) => {
      if (!current.isError && g.settings().writeTools.includes(p.toolName)) {
        await g.commit({ writes: g.state().writes + 1 });
      }
      return undefined;                                   // 관찰만. 패치 없음
    });
    g.on("boundary.settle.before", async (p, current, ctx) => {
      if (p.outcome !== "completed" || ctx.state.writes === 0 || current.continue) return undefined;
      const s = g.settings();
      const receipt = await g.post(
        { kind: "context", customType: "grp.reviewgate.review.requested", content: s.prompt, display: true },
        { when: s.mode === "continue" ? "steer" : "followUp", requestId: `reviewgate:${p.turnId}` },
      );
      return receipt.duplicate || s.mode !== "continue" ? undefined : { continue: true };
    });
    g.on("boundary.settle.after", async () => { await g.commit({ writes: 0 }); });
  },
});
```

- `defineGroup`의 입력(`manifest`, `state`, `settings`, `setup`)과 `g.settings()`의 반환 타입(설정 그룹에서 유도한 값 객체)은 `L3.group-kit.spec` §3.2의 `GroupDef<S>`, `GroupApi<S>`다. 그룹 이름은 매니페스트 `name`에서만 온다. 저장소 안 fixture는 매니페스트 객체를 `groupManifest(…)`로 직접 정의하고, 외부 그룹 템플릿은 `plugin.json`을 읽어 넘긴다(3.3.5).
- `continue`는 L1이 `canContinue`로 다시 승인한다(`F.extensions.spec` §4.1 boundary 최종 검증). 승인되지 않으면 검토 입력은 큐에 남고 다음 입력과 함께 들어간다.
- 커밋 수 대신 `AgentBeforeSettlePayload.context`에서 이번 턴의 도구 호출을 세면 상태 없이도 같은 판정을 할 수 있다. 그러면 `kind: "plugin"`이 된다(4.2.1). fixture는 상태 경로를 검증하려고 상태를 쓴다 [제안].

#### 3.2.3 정식 예 2: 커밋 전 검증 (`commitguard`)

검증 명령이 성공한 뒤 쓰기가 없을 때만 `git commit` 계열 bash 호출을 허용한다. 사용자 지침의 "끝내기 전에 `just verify`"를 코드로 강제하는 예다.

| 항목 | 값 |
|---|---|
| 매니페스트 | `name: "commitguard"`, `kind: "group"`, `layer: "L3"`, `usesDrive: false`, `points: ["tool.call.before", "tool.result"]` |
| 지점과 fold | `tool.call.before`(first: 커밋 호출 거부), `tool.result`(chain, 패치 없음: 검증 성공과 쓰기 관찰 후 상태 커밋) |
| post | 쓰지 않는다. 거부 사유는 `ToolCallDecision.reason`으로 모델에 돌아간다 |
| 실패 정책 | first 예외는 거부(`FIRST_DENY.tool_call`, fail-closed). 그래서 판정 함수가 던지면 커밋은 막힌다. chain 예외는 그 관찰만 버린다(검증 성공을 놓치면 다음 커밋도 거부된다. 안전한 쪽으로 실패한다) |
| 설정 키 | `ext.commitguard.verifyCommand`(문자열, 기본 `"just verify"`), `ext.commitguard.commitPattern`(정규식 문자열, 기본 `"^\\s*git\\s+commit\\b"`), `ext.commitguard.invalidateOn`(문자열 목록, 기본 `["write", "edit"]`) |
| 수용 기준 | 검증 전 커밋 호출은 거부되고 사유가 모델에 돌아간다. 검증 성공 뒤 커밋은 실행된다. 검증 성공 뒤 `write`가 있으면 다시 거부된다. 판정 함수 예외 시 거부된다 |

```ts
// group-kit/src/testing/policies/commitguard.ts  (fixture, 4.2.3)
const GuardState = Type.Object({ verified: Type.Boolean() });
type GuardState = Static<typeof GuardState>;

const commandOf = (input: Readonly<Record<string, JsonValue>>): string =>
  typeof input["command"] === "string" ? input["command"] : "";

const commitguardManifest = groupManifest({
  schemaVersion: 1, name: "commitguard", version: "0.1.0", displayName: "커밋 전 검증",
  layer: "L3", kind: "group", entry: "./src/testing/policies/commitguard.ts",
  usesDrive: false, points: ["tool.call.before", "tool.result"],
  defaultEnabled: false, trust: { level: "builtin" },
});

export const commitguard: GroupModule = defineGroup<GuardState>({
  manifest: commitguardManifest,
  state: { schema: GuardState, initial: { verified: false }, version: 1 },
  settings: commitguardSettings,                         // defineSettings("ext.commitguard", { verifyCommand, commitPattern, invalidateOn })
  setup(g) {
    g.on("tool.call.before", (p, ctx) => {                      // 질의만. 상태는 디스패치 시작 시점의 커밋 값
      if (p.toolName !== "bash") return undefined;
      if (!new RegExp(g.settings().commitPattern).test(commandOf(p.input))) return undefined;
      return ctx.state.verified ? undefined
        : { block: true, reason: `커밋 전에 \`${g.settings().verifyCommand}\`를 성공시켜라.` };
    });
    g.on("tool.result", async (p, current) => {
      const s = g.settings();
      if (p.toolName === "bash" && commandOf(p.input).trim() === s.verifyCommand) {
        await g.commit({ verified: !current.isError });
      } else if (s.invalidateOn.includes(p.toolName) && !current.isError) {
        await g.commit({ verified: false });
      }
      return undefined;
    });
  },
});
```

- `tool.call.before` 핸들러는 재실행 가능한 질의다. 상태를 읽고 결정만 돌려준다. 상태 변경은 `tool.result`에서 `commit`으로만 한다(P6).
- 한계 [가정]: `bash`로 파일을 바꾸는 경우는 `invalidateOn`에 잡히지 않는다. fixture는 이 한계를 테스트로 고정하지 않는다. 실제 정책으로 쓰려면 작업 트리 지문을 상태에 두는 방식이 필요하다.
- 상태가 필요하므로 `kind: "group"`이다(4.2.1).

#### 3.2.4 정식 예 3: 가드레일 지점 예 (`guardrail`)

[결정: review.m3-design-inputs D-M3-30] 입출력 가드레일은 내장 검사 없이 지점만 둔다. 지점 셋의 이름, fold, 실패 정책은 ADR-0017과 `F.extensions.spec` §3.4가 정한다. 이 절은 그 지점을 쓰는 플러그인의 설계 골격과 fixture 수준 동작만 정한다.

| 가드레일 지점 | 시점 | fold | 실패 |
|---|---|---|---|
| 모델 요청 가드 | provider 요청을 보내기 직전. 다른 `request` 지점의 패치가 모두 적용된 최종 요청을 받는다 | first(차단 결정) | fail-closed |
| 도구 호출 가드 | 도구 실행 직전. `tool.call.before` 지점의 결정 뒤 실행이 남은 호출만 받는다 [제안] | first(차단 결정) | fail-closed |
| 출력 가드 | 모델 출력이 사용자에게 표시되거나 다른 실행 경로(명령, 산출물 적용)로 넘어가기 직전 | first(차단 결정) | fail-closed |

- 지점 이름은 ADR-0017의 자체 이름 규칙으로 M3 F 첫 작업이 정한다. 아래 코드는 F 상수 `GUARD_POINTS`(`request`, `tool`, `output`) [제안]로 이름을 가리킨다.
- 가드 지점의 결정은 차단 하나다(`{ block: true, reason }`). 값을 바꾸지 않는다. 핸들러 예외와 결정 스키마 위반은 차단으로 처리한다.

참고한 사실과 판정 모델(`_research/item-catalog.md` 121~123행, `_research/ext-points.md` §4.5):

- pi, Claude Code, Codex CLI에는 내장 콘텐츠 가드레일이 없다. 훅·확장 이벤트와 권한·샌드박스로 막는다. OpenAI Agents SDK는 가드레일 프레임워크를 둔다.
- Agents SDK 가드레일 종류는 input, output, tool-input, tool-output 넷이다. 이 문서의 지점 셋은 input을 모델 요청 가드, tool-input을 도구 호출 가드, output을 출력 가드에 대응시킨다. tool-output은 도구 결과가 다음 모델 요청에 들어가므로 모델 요청 가드에서 본다.
- 판정은 통과, 트립와이어, 불명 3값이다. 검사기 예외는 거부와 구분해 "불명"으로 둔다(item-catalog 123행).
- 도구를 쓰는 에이전트는 선행 차단을 기본으로 한다(item-catalog 121행). Xeon의 on 디스패치는 순차 await이므로 가드 지점의 검사는 선행 차단이다.

| 항목 | 값 |
|---|---|
| 매니페스트 | `name: "guardrail"`, `kind: "plugin"`, `layer: "plugin"`, `usesDrive: false`, `usesPost: true`, `points`: 가드 지점 셋 |
| 지점과 fold | 세 가드 지점 모두 first. 트립와이어면 차단 |
| post | 모델 요청 차단 때 `kind: "context"`, `customType: "x.guardrail.request.blocked"`, `when: "next"`, `requestId: "guardrail:request:<요청 해시>"`로 차단 사유를 알린다 [제안] |
| 실패 정책 | 검사 함수 예외는 핸들러 안에서 `unknown` 판정으로 바꾼다. `unknown`의 처리는 `ext.guardrail.onUnknown`(기본 `"deny"`)이다. 핸들러 자체가 던지면 지점 규칙대로 차단이다 |
| 설정 키 | `ext.guardrail.patterns`(정규식 문자열 목록), `ext.guardrail.onUnknown`(`"deny"`\|`"allow"`, 기본 `"deny"`), `ext.guardrail.checkRequest`, `ext.guardrail.checkTool`, `ext.guardrail.checkOutput`(불리언, 기본 `true`) |
| 수용 기준 | 패턴에 걸린 모델 요청은 보내지 않는다. 패턴에 걸린 도구 호출은 실행되지 않는다. 패턴에 걸린 출력은 표시·실행되지 않는다. 검사 함수 예외 시 `onUnknown: "deny"`이면 차단, `"allow"`이면 통과한다 |

```ts
// group-kit/src/testing/policies/guardrail.ts  (fixture 골격, 4.2.4)
import { GUARD_POINTS, type ExtensionEntry, type GuardDecision } from "@xeon/contracts/extensions";   // GUARD_POINTS, GuardDecision은 [제안] 이름(ADR-0017)

export type GuardVerdict =
  | { readonly kind: "pass" }
  | { readonly kind: "tripwire"; readonly reason: string }
  | { readonly kind: "unknown"; readonly error: string };

export type GuardSite = "request" | "tool" | "output";

/** 순수 검사 함수. 입출력·시계·난수를 쓰지 않는다(P6) */
export type GuardCheck = (text: string, site: GuardSite) => GuardVerdict;

export const patternCheck = (patterns: readonly string[]): GuardCheck => (text) => {
  for (const p of patterns) if (new RegExp(p).test(text)) return { kind: "tripwire", reason: `pattern ${p}` };
  return { kind: "pass" };
};

const judge = (check: GuardCheck, text: string, site: GuardSite): GuardVerdict => {
  try { return check(text, site); } catch (e) { return { kind: "unknown", error: String(e) }; }
};

export const guardrail: ExtensionEntry = ({ scope }) => {
  scope("guardrail", {}, (g) => {
    const blocked = (v: GuardVerdict, onUnknown: "deny" | "allow"): boolean =>
      v.kind === "tripwire" || (v.kind === "unknown" && onUnknown === "deny");
    const decide = (site: GuardSite, text: string): GuardDecision | undefined =>
      blocked(judge(check(), text, site), onUnknown()) ? { block: true, reason: `guardrail: ${site} 차단` } : undefined;
    g.on(GUARD_POINTS.request, (p) => decide("request", requestText(p)));
    g.on(GUARD_POINTS.tool, (p) => decide("tool", JSON.stringify(p.input)));
    g.on(GUARD_POINTS.output, (p) => decide("output", outputText(p)));
  });
};
// check(), onUnknown()은 ext.guardrail.* 설정에서 읽는 지역 함수다. 설정 읽기 API는 X가 정한다 [가정]
// requestText(), outputText()는 페이로드에서 검사할 텍스트를 모으는 순수 함수다. 페이로드 모양은 F가 정한다
// 모델 요청 차단 알림 post(표의 post 행)는 골격에서 생략했다
```

- 검사 함수는 순수 함수로 둔다. 모델 기반 분류기를 on 핸들러에서 부르면 재실행 때 결과가 달라질 수 있다(P6). 모델 분류기는 플러그인 작성자가 고를 수 있으나 재실행 결정성 규칙(4.2.4)을 따른다.
- 모델 요청 가드의 차단은 그 요청을 보내지 않고 turn을 실패로 끝낸다. 차단 사유 알림은 post로만 한다. turn 실패의 모양은 L1.loop이 정한다.
- 상태가 없고 `/group` 토글이 필요 없으므로 `kind: "plugin"`이다(4.2.1). 그래서 `defineGroup` 대신 F `ExtensionEntry`와 `scope`를 직접 쓴다.

### 3.3 그룹 템플릿

#### 3.3.1 템플릿 위치

- [제안] 템플릿 파일은 `xeon/packages/group-kit/templates/` 아래에 둔다. `eng.context-map.design` C-2([미결] slots의 위치)에 대한 이 문서의 답이다. 이유: (1) 템플릿 골격이 `defineGroup`, `replayDrive`와 같은 변경에서 함께 바뀐다. (2) `group-kit` 테스트가 템플릿을 생성·로드해 깨짐을 바로 잡는다. (3) context-map이 slots를 이미 `group-kit` 컨텍스트에 두었다.
- 템플릿 디렉터리는 `group-kit`의 `src/` 밖이므로 패키지 진입점(`exports`)에 들어가지 않는다. `templates/**/*.ts`는 그대로 컴파일하지 않고, 테스트가 임시 디렉터리에 생성한 뒤 컴파일한다(4.3절).
- 그래도 routes.yaml의 slots `binds`는 비워 둔다. 템플릿 파일은 `L3.group-kit.spec`의 `binds`(`xeon/packages/group-kit/**`) 아래에 있기 때문이다. 이 문서는 템플릿의 내용 규칙만 구속한다.

#### 3.3.2 파일 목록

| 파일 | drive | policy | observe | 내용 |
|---|---|---|---|---|
| `.xeon-plugin/plugin.json` | ● | ● | ● | 외부 그룹 매니페스트(`ExtensionManifest`). 외부 그룹의 기본 형식 |
| `src/manifest.ts` | 선택 | 선택 | 선택 | 저장소 안 그룹이면 `defineManifest`로 쓴다. `plugin.json`과 둘 중 하나만 둔다 |
| `src/index.ts` | ● | ● | ● | `defineGroup` 골격. default export는 `GroupModule` |
| `src/state.ts` | ● | 선택 | ● | 상태 스키마, 초기값, `version` |
| `src/settings.ts` | ● | ● | ● | `defineSettings("ext.__ID__", …)` |
| `test/unit.test.ts` | ● | ● | ● | 핸들러·토글·설정 단위 테스트 |
| `test/replay.test.ts` | ● | | | `replayDrive` 골격 |
| `test/manifest.test.ts` | ● | ● | ● | `validateManifest` 통과 확인 |
| `package.json` | ● | ● | ● | `name`, `exports`, `xeon` 필드 |
| `tsconfig.json` | ● | ● | ● | `tsconfig.base.json` 확장 |
| `README.md` | ● | ● | ● | 그룹의 의도, 판정 기준(3.1.1) 답, 설정 키 표 |

- [제안] 매니페스트 형식: 템플릿은 외부 그룹을 기본 대상으로 하므로 `.xeon-plugin/plugin.json`을 만든다(`F.extensions.spec` §3.1 파일 위치). 저장소 안에 기본 그룹으로 넣는 경우만 `src/manifest.ts`로 바꾼다. 이 선택을 생성 명령의 옵션으로 둘지는 `L4.cli.spec`이 정한다.

#### 3.3.3 템플릿 색인과 치환 자리

```ts
// group-kit/templates/index.json 의 스키마 (group-kit/test에서 검사)
import { Type, type TLiteral, type TObject, type TUnion } from "typebox";

export type TemplateKind = "drive" | "policy" | "observe";
export const TemplateKindSchema: TUnion<[TLiteral<"drive">, TLiteral<"policy">, TLiteral<"observe">]> =
  Type.Union([Type.Literal("drive"), Type.Literal("policy"), Type.Literal("observe")]);

export const TEMPLATE_PLACEHOLDERS: readonly ["__ID__", "__TITLE__", "__VERSION__"] = ["__ID__", "__TITLE__", "__VERSION__"];

export interface TemplateEntry {
  readonly description: string;
  readonly files: readonly string[];
  readonly usesDrive: boolean;
}
export interface TemplateIndex {
  readonly schemaVersion: 1;
  readonly templates: { readonly [K in TemplateKind]: TemplateEntry };
}

/** TemplateIndex와 같은 모양. 정적 타입과의 일치는 타입 테스트로 확인한다(isolatedDeclarations 때문에 Static 유도 대신 짝으로 쓴다) */
export const TemplateIndexSchema: TObject = Type.Object({
  schemaVersion: Type.Literal(1),
  templates: Type.Record(
    Type.Union([Type.Literal("drive"), Type.Literal("policy"), Type.Literal("observe")]),
    Type.Object({
      description: Type.String({ maxLength: 200 }),
      /** templates/ 기준 상대 경로. 공통 파일은 "common/…" */
      files: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      usesDrive: Type.Boolean(),
    }),
  ),
});
```

- 치환 자리는 `__ID__`(그룹 이름), `__TITLE__`(표시 이름, 기본은 이름), `__VERSION__`(기본 `"0.1.0"`) 셋이다. 파일 내용과 경로 모두에 적용한다. 그 밖의 템플릿 엔진 문법은 쓰지 않는다 [제안].
- 이 스키마는 생성 명령(L4)이 읽는 데이터 형식이다. 코드 import 없이 JSON으로 읽는다(4.3.3).

#### 3.3.4 이름 규칙

- [결정: review.decisions-2 U-18] 그룹 이름은 확장 id 규칙 `^[a-z][a-z0-9-]{1,31}$`(소문자, 숫자, 하이픈)이다. 밑줄은 쓰지 않는다. 테이블 접두는 이름의 하이픈을 밑줄로 바꾼 `x_<id>_`이고 지역 테이블 이름에 밑줄을 쓰지 않으므로 접두의 경계를 하나로 읽는다. 정본 상수는 `L3.group-kit.spec` §3.2 `GROUP_NAME_PATTERN`이다.
- 쓸 수 없는 이름: 예약 이름의 정본은 `L3.group-kit.spec` §3.2 `RESERVED_GROUP_NAMES`다(`RESERVED_EXT_IDS`, `grp`·`x`·`xeon`, L2 도메인 이름, `auto`·`all`·`none`·`group`·`groups`·`kit`). 생성 명령(R2)과 `defineGroup`은 같은 상수로 거부한다. 설치된 확장 이름(`helm`, `learning` 포함)과 겹치는 이름은 설치 목록으로 거부한다(R2, `validateManifestSet`의 `name_conflict`). 이 경우는 상수에 넣지 않는다.
- 패키지 이름은 저장소 안이면 `@xeon/group-<id>`, 외부면 제한하지 않는다 [제안].
- 그룹 이름에서 파생되는 이름: scope id `<id>`, 레코드 kind `grp.<id>.<영역>.<이름>`, 설정 키 `ext.<id>.<이름>`, 테이블 `x_<id의 하이픈을 밑줄로>_*`, 비공개 기록 kind `grp.<id>.*`(`recordPrivate`), 명령 `/<id>`(선택).

#### 3.3.5 템플릿 골격 코드

매니페스트 전달 [제안]: 템플릿은 외부 그룹이 기본 대상이라 매니페스트가 `.xeon-plugin/plugin.json`에만 있다. `src/index.ts`는 이 파일을 JSON import로 읽어 `groupManifest`(`L3.group-kit.spec` §3.2)로 검증·좁힌 값을 `defineGroup`의 `manifest`에 넘긴다. 저장소 안 그룹으로 바꿀 때는 `src/manifest.ts`의 `defineManifest` 상수를 넘긴다(3.3.2).

drive 템플릿 `src/index.ts`:

```ts
import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };
import { __ID__State, initialState, type State } from "./state.ts";
import { __ID__Settings } from "./settings.ts";

const group: GroupModule = defineGroup<State>({
  manifest: groupManifest(manifestJson),
  state: { schema: __ID__State, initial: initialState, version: 1 },
  settings: __ID__Settings,
  setup(g) {
    g.on("boundary.settle.after", () => {});                  // 관찰 자리(tap). 커밋은 turn당 한 번, 효과는 commit·record·post만
    g.drive(async (loop, st) => {
      // 재생 규율: 진행 상태는 st(커밋된 상태)에만 둔다. Date.now·Math.random·직접 I/O 금지
      if (st.phase === "done" || loop.budget.turns === 0) return;
      const out = await loop.turn({ input: { kind: "user", content: `__TITLE__ 단계 ${st.round}` } });
      await g.commit({ ...st, round: st.round + 1, phase: out.status === "completed" ? st.phase : "done" });
    }, { limits: { maxTurns: 4 } });
  },
});
export default group;
```

drive 템플릿 `src/state.ts`:

```ts
import { Type, type TInteger, type TLiteral, type TObject, type TUnion } from "typebox";

export interface State {
  readonly phase: "run" | "done";
  readonly round: number;
}
export const __ID__State: TObject<{ phase: TUnion<[TLiteral<"run">, TLiteral<"done">]>; round: TInteger }> = Type.Object({
  phase: Type.Union([Type.Literal("run"), Type.Literal("done")]),
  round: Type.Integer({ minimum: 0 }),
});
export const initialState: State = { phase: "run", round: 0 };
```

- observe 템플릿의 `src/state.ts`는 같은 형식으로 `State { count: number }`, 초기값 `{ count: 0 }`을 둔다.

policy 템플릿 `src/index.ts`(상태 없는 그룹. `state`를 생략한다, `L3.group-kit.spec` §3.2):

```ts
import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };
import { __ID__Settings } from "./settings.ts";

const group: GroupModule = defineGroup({
  manifest: groupManifest(manifestJson),
  settings: __ID__Settings,
  setup(g) {
    g.on("tool.call.before", (p) => {                        // first: 차단. 예외는 거부가 된다
      return g.settings().blockedTools.includes(p.toolName)
        ? { block: true, reason: "__TITLE__ 정책이 이 도구를 막았다" }
        : undefined;
    });
  },
});
export default group;
```

observe 템플릿 `src/index.ts`:

```ts
import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };
import { __ID__State, initialState, type State } from "./state.ts";
import { __ID__Settings } from "./settings.ts";

const group: GroupModule = defineGroup<State>({
  manifest: groupManifest(manifestJson),
  state: { schema: __ID__State, initial: initialState, version: 1 },
  settings: __ID__Settings,
  setup(g) {
    g.on("boundary.settle.after", async (p) => {              // tap: 관찰. 반환값은 쓰지 않는다
      const next = { count: g.state().count + 1 };
      await g.commit(next);
      await g.record("grp.__ID__.turn.counted", { type: "turn", id: p.turnId }, next);
    });
  },
});
export default group;
```

공통 `src/settings.ts`(policy 예):

```ts
import { Type, type TArray, type TString } from "typebox";
import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";

export const __ID__Settings: SettingGroup<"ext.__ID__", { blockedTools: SettingDefInput<TArray<TString>> }> = defineSettings("ext.__ID__", {
  blockedTools: {
    type: Type.Array(Type.String()),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "session"],
    ui: { tab: "plugins", widget: "list", order: 10, label: "막을 도구" },
    since: "__VERSION__",
  },
});
```

공통 `.xeon-plugin/plugin.json`(policy 예):

```json
{
  "schemaVersion": 1,
  "name": "__ID__",
  "version": "__VERSION__",
  "displayName": "__TITLE__",
  "layer": "L3",
  "kind": "group",
  "entry": "./src/index.ts",
  "points": ["tool.call.before"],
  "usesDrive": false,
  "defaultEnabled": false,
  "trust": { "level": "user" }
}
```

- drive 템플릿은 `"usesDrive": true`, `"points": ["boundary.settle.after"]`, observe 템플릿은 `"points": ["boundary.settle.after"]`, `"recordKinds"`에 `grp.__ID__.turn.counted` 선언을 둔다.
- 관찰 지점 권장안 [제안]: 관찰은 tap 지점(`boundary.settle.after`, 도구 단위가 필요하면 `tool.execution.after`)에서 하고 상태 커밋은 turn당 한 번(`boundary.settle.after`)으로 둔다. `boundary.step.after`는 chain이고 경계 엔트리를 다루는 지점이라 관찰 자리로 쓰지 않는다(`L3.helm.spec` §7, `L3.group-kit.spec` §4.5 4번).
- `plugin.json` JSON import에는 템플릿 `tsconfig.json`의 `resolveJsonModule`이 필요하다 [가정: `tsconfig.base.json`이 켜 두지 않으면 템플릿 쪽에서 켠다].
- [제안] 템플릿의 `defaultEnabled`는 `false`다. 새 그룹은 사용자가 켜기 전에는 루프에 영향을 주지 않는다.

`test/replay.test.ts`(drive 템플릿):

```ts
import { test, expect } from "bun:test";
import { replayDrive } from "@xeon/group-kit/testing";
import { t, tape } from "@xeon/core-models/testing";
import group from "../src/index.ts";

test("__ID__.drive-replays-at-every-commit", async () => {
  const report = await replayDrive({
    group,
    tape: tape("__ID__/two-rounds", [t.text("round 1"), t.text("round 2")]),
    cutAt: "every-commit",
  });
  expect(report.ok).toBe(true);
});
```

- `replayDrive`의 입력(`ReplayDriveOptions`: `group`, `tape`, `cutAt` 등)과 결과(`ReplayDriveReport`: `commits`, `baselineDigest`, `cuts`, `ok`)는 `L3.group-kit.spec` §3.10이 정한다. 모든 커밋 지점에서 끊고 재개했을 때 정규화 이벤트열이 끊지 않은 실행과 같으면 `ok`가 참이다. 테이프 도우미 `t`, `tape`는 `eng.testing.guide` TS-04의 이름이다.

`package.json`:

```json
{
  "name": "@xeon/group-__ID__",
  "version": "__VERSION__",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "xeon": { "layer": "L3", "domain": "__ID__" }
}
```

- `xeon` 필드는 저장소 안 그룹일 때 check-layers가 쓴다(`architecture.layers.spec` §3 규칙 3). 저장소 안에 넣으면 routes.yaml layout L3에 도메인을 더해야 `xeon.domain` 검사를 통과한다. 이것은 문서 변경이고 코어 코드 변경은 아니다 [제안].

#### 3.3.6 생성 명령의 요구 인터페이스

명령 `xeon group new <이름> [--drive|--policy]`의 실행은 `L4.cli.spec`이 소유한다. 이 문서는 요구만 정한다.

| 요구 | 내용 |
|---|---|
| R1 | 옵션이 없으면 observe, `--drive`는 drive, `--policy`는 policy 템플릿을 쓴다. 두 옵션을 함께 주면 오류다 |
| R2 | 이름을 3.3.4절 규칙으로 검사한다. 설치된 확장 이름과 겹치면 거부한다 |
| R3 | `group-kit/templates/index.json`을 읽어 해당 종류의 파일을 복사하고 치환 자리를 바꾼다. 대상 디렉터리가 비어 있지 않으면 거부한다 |
| R4 | 생성한 매니페스트를 F `validateManifest`로 검사하고 오류가 있으면 생성 결과를 지운다 |
| R5 | 생성은 코드 실행 없이 파일 복사와 치환만 한다. 의존 설치는 하지 않고 다음 명령을 안내한다 |
| R6 | 종료코드는 `eng.toolchain.guide` 규칙(1 입력 오류, 2 환경 문제)을 따른다 [가정] |

- [제안] L4는 `group-kit`을 import하지 않는다. 템플릿은 파일로 읽고, 검사는 F 함수만 쓴다. `apps/cli`의 컨텍스트(`clients`)가 다른 컨텍스트의 구현을 import하지 않는 규칙(`eng.dependency-rules.guide` DR-14)을 지키기 위해서다.
- `create-cordis` 0.3.1(MIT)의 스캐폴딩 방식(템플릿 디렉터리 복사와 이름 치환)을 참고한다. 코드는 채택하지 않는다(`_research/packages.md` §4.6 L3-c 행. 그 행의 판정은 추측이다).

## 4. 동작 규칙

### 4.1 제2의 의도 그룹

- 새 그룹은 3.1.2 체크리스트 C1~C9를 모두 통과해야 기본 그룹과 같은 경로로 로드된다.
- [결정] 켜기·끄기는 단계 경계에서 적용되고 정리는 Cordis dispose로 실행된다(`F.extensions.spec` §4.5). 새 그룹도 예외가 없다.
- 새 그룹의 drive 등록만으로 임대가 생기지 않는다(`F.extensions.spec` §4.6). 임대는 `DriveArbiter`와 `x.primitives.activeDriveGroup`으로 정해진다.
- 새 그룹을 제거하면 그 그룹의 `x_<id>_*` 테이블은 DROP되고 `grp.<id>.*` 이벤트(상태 이벤트, 비공개 기록, 공개 레코드)는 이벤트 로그에 남는다(`eng.context-map.design` §5.2). 다른 그룹의 `readRecords`는 기존 레코드를 계속 읽는다(`F.extensions.spec` §5 8).

### 4.2 정책 플러그인

#### 4.2.1 group과 plugin의 구분

[제안] 다음 셋 가운데 하나라도 필요하면 `kind: "group"`(`layer: "L3"`), 아니면 `kind: "plugin"`(`layer: "plugin"`)으로 둔다(`F.extensions.spec` §3.1).

| 필요 | 이유 |
|---|---|
| scope 상태 | 상태 문서와 마이그레이션은 그룹 기반(`defineGroup`)의 `StateDecl` 경로로 다룬다 |
| 그룹 레코드 공개 | `recordKinds`의 접두가 `grp.<id>.`이어야 다른 그룹이 의도 그룹 레코드로 읽는다 |
| `/group` 토글과 상태줄 표시 | `GroupService`(`xeon.groups`)는 `kind: "group"`만 목록에 올린다 [가정] |

- 플러그인도 scope를 하나 만들고 `ext.<id>.enabled`로 켜고 끈다(`F.extensions.spec` §3.2 마지막 항목). 차이는 그룹 기반 기능(`GroupApi`의 `settings()`, `delegate`, `metrics`, `/group` 명령)을 쓰는지다.
- [미결] 이 기준의 최종 확정. 정식 예 셋은 이 기준으로 `reviewgate`·`commitguard`를 group, `guardrail`을 plugin으로 두었다.

#### 4.2.2 reviewgate 동작

1. `tool.result`에서 쓰기 도구 결과가 오류가 아니면 `writes`를 하나 늘려 커밋한다.
2. `boundary.settle.before`에서 outcome이 `completed`이고 `writes > 0`이고 다른 핸들러가 아직 `continue`를 요청하지 않았으면 검토 입력을 post한다. `requestId`는 `reviewgate:<turnId>`다.
3. post가 새로 들어갔고 `mode`가 `continue`면 `{ continue: true }`를 돌려준다. 같은 턴의 다음 정착에서는 같은 `requestId`가 `duplicate: true`이므로 더 요청하지 않는다. 그래서 한 턴에 검토 요청은 최대 한 번이다.
4. `boundary.settle.after`에서 `writes`를 0으로 커밋한다.

- 재실행: 2단계가 재실행되면 post는 `duplicate: true`를 돌려주고 패치를 내지 않는다. 같은 입력이 두 번 들어가지 않는다.

#### 4.2.3 commitguard 동작

1. `tool.result`: bash 명령이 `verifyCommand`와 같으면 결과 성공 여부를 `verified`로 커밋한다. `invalidateOn` 도구가 성공하면 `verified: false`를 커밋한다.
2. `tool.call.before`: bash 명령이 `commitPattern`에 맞고 `ctx.state.verified`가 거짓이면 거부한다.
3. 판정은 디스패치 시작 시점의 커밋 상태(`HandlerContext.state`)로만 한다.

#### 4.2.4 guardrail 동작

1. 각 가드 지점에서 대상 텍스트를 검사 함수에 넘기고 판정 3값을 얻는다. 예외는 `unknown`으로 바꾼다.
2. `tripwire`, 또는 `unknown`이면서 `onUnknown: "deny"`인 경우 차단한다. 모델 요청은 보내지 않고, 도구 호출은 실행하지 않고, 출력은 표시·실행하지 않는다.
3. 검사는 순차 await 디스패치 안에서 실행되므로 선행 차단이다. 병렬 모드(Agents SDK `runInParallel`)는 두지 않는다 [제안]. 병렬 실행은 지점 필드로 새어 나오는 설정이라 4연산 단순화 결정과 맞지 않기 때문이다(`_research/ext-points.md` §4.5 시사점).
4. 가드 지점은 fail-closed다 [결정: review.m3-design-inputs D-M3-30, adr.0017]. 핸들러 예외나 시간 초과는 차단으로 처리한다.
5. 모델 분류기를 가드 핸들러에서 부를 수 있다. 핸들러는 재실행될 수 있으므로 같은 입력에 같은 판정을 내도록 판정 결과를 입력 해시로 기억해 두는 방식을 권한다 [제안].

기본 경로 비용: 가드 지점에 핸들러가 없으면 비용이 없다. 플러그인을 켜면 모델 요청, 도구 호출, 출력마다 검사 함수가 실행된다. 패턴 검사는 텍스트 길이에 비례한다. 모델 분류기를 쓰면 지점마다 모델 호출이 더해진다.

### 4.3 템플릿 생성 규칙

1. 템플릿은 최소 골격만 담는다. 실제 정책 로직, 렌즈, 프롬프트 문구를 넣지 않는다 [제안].
2. 생성된 그룹은 수정 없이 `bun test`가 통과해야 한다. 각 템플릿의 단위 테스트, 매니페스트 테스트, (drive면) 재생 테스트가 포함된다.
3. 생성은 파일 복사와 치환만 한다(R5). 템플릿 안의 코드를 생성 중에 실행하지 않는다.
4. `group-kit` 테스트는 세 종류를 임시 디렉터리에 생성하고 로드·토글·재생을 확인한다(`L3.slots.plan` §5). 그래서 `defineGroup`이나 `GroupApi`가 바뀌면 같은 변경에서 템플릿이 함께 고쳐진다.

### 4.4 재생

- drive 템플릿의 drive 함수는 진행 상태를 커밋된 상태에만 둔다. 클로저 지역 변수에 진행 상태를 두면 재개 뒤 다르게 동작한다(`F.extensions.spec` §4.6).
- 정책·관찰 템플릿의 핸들러는 재실행 가능한 질의다. 효과는 `post`(고정 `requestId`), `commit`, `record`로만 낸다.
- `scanDriveSource`(2차)는 drive 템플릿 본문에 `Date.now`, `Math.random`, 직접 I/O가 없음을 확인한다 [가정: `L3.group-kit.spec`].

## 5. 실패와 경계 사례

| # | 상황 | 결과 |
|---|---|---|
| 1 | 템플릿으로 만든 그룹이 다른 그룹 패키지(`@xeon/group-helm` 등)를 import함 | 저장소 안이면 check-layers가 `DR-02`로 실패한다. 허용 목록에는 `group-kit`만 있다. 외부 그룹이면 X 로더가 거부할지는 `X.loading-trust.spec`이 정한다 [가정] |
| 2 | 그룹 이름이 설치된 확장과 같음 | `validateManifestSet`이 `name_conflict` 오류를 낸다. 생성 명령은 R2에서 미리 거부한다 |
| 3 | 그룹 이름에 밑줄이나 대문자가 있거나, 예약 이름임 | 생성 명령이 거부한다. 직접 쓴 매니페스트는 X 로더가 확장 id 규칙(review.decisions-2 U-18)과 `RESERVED_EXT_IDS`로 거부한다(CM-07) |
| 4 | 정책 플러그인(`kind: "plugin"`)이 `usesDrive: true`를 선언함 | `validateManifest`가 `drive_requires_group` 오류를 낸다 |
| 5 | 정책 그룹이 `usesDrive: false`인데 `g.drive`를 호출함 | `validateUsage`가 `drive_undeclared` 오류를 낸다. 로드가 실패한다 |
| 6 | 정책이 first 지점(`tool.call.before`)에서 예외를 냄 | 그 도구 호출은 `FIRST_DENY.tool_call`로 거부된다(fail-closed). 뒤 핸들러는 실행되지 않는다 |
| 7 | 정책이 chain 지점에서 예외를 냄 | 그 핸들러의 패치만 버린다. reviewgate면 그 턴은 검토 없이 정착한다 |
| 8 | `reviewgate`의 `continue`를 L1이 승인하지 않음(`canContinue` 거짓) | 검토 입력은 큐에 남는다. 다음 입력과 함께 모델에 들어간다 |
| 9 | 두 정책 그룹이 같은 `tool.call.before`에 first 핸들러를 둠 | 순서상 먼저 결정한 쪽이 결과를 정한다. 순서는 `X.primitives.spec`의 tier 규칙이다 |
| 10 | 템플릿의 설정 파일이 `ext.__ID__.enabled`를 선언함 | 예약 키라 거부된다(`F.wire-settings.spec` §3.8.3 규칙 1). 템플릿은 이 키를 두지 않는다 |
| 11 | 외부 그룹이 `l3.` 키를 선언함 | `buildCatalog`가 `foreignNamespace`로 그 그룹의 설정 전체를 거부한다 |
| 12 | 대상 디렉터리가 비어 있지 않음 | 생성 명령이 파일을 쓰지 않고 거부한다(R3) |

## 6. 설정 노출

| 대상 | 키 | 정의 방법 | L4 노출 |
|---|---|---|---|
| 외부 그룹·정책 플러그인 켜기·끄기 | `ext.<id>.enabled` | X 로더 예약 키. 기본값은 매니페스트 `defaultEnabled`(`F.extensions.spec` §6) | 설정 화면 `plugins` 탭 토글, `/group on|off <id>`(group만), 설정 파일 |
| 격리 | `ext.<id>.isolation` | X 로더 예약 키(2차) | `plugins` 탭 |
| 그룹별 설정 | `ext.<id>.<이름>` | `defineSettings("ext.<id>", …)`를 `src/settings.ts`에 둔다. JSON 매니페스트만 있는 확장은 `userConfig`로 선언한다(`F.wire-settings.spec` §3.8.3 규칙 1) | `plugins` 탭의 그룹 항목 아래 |
| 정식 예 설정 | `ext.reviewgate.*`, `ext.commitguard.*`, `ext.guardrail.*` | 3.2절 표 | fixture라 기본 배포 카탈로그에 없다 |

- `SettingDef.ui.tab`은 `"plugins"`로 고정한다. `layer`는 매니페스트 `layer`를 따른다(group은 `"L3"`, plugin은 [가정] `"L2"`)(`F.wire-settings.spec` §3.8.3).
- 정책 설정의 `runtimeChange`는 `"nextTurn"`을 기본으로 한다 [제안]. 핸들러가 디스패치마다 `g.settings()`를 읽으므로 다음 턴부터 반영된다.

## 7. 확장 지점

| 구성요소 | on (지점, fold) | post | drive | scope |
|---|---|---|---|---|
| drive 템플릿 | `boundary.settle.after`(tap, 관찰 자리) | 선택 | 씀 | 상태 있음 |
| policy 템플릿 | `tool.call.before`(first) | 선택 | 안 씀 | 상태 없음(생략 가능, `L3.group-kit.spec` §3.2) |
| observe 템플릿 | `boundary.settle.after`(tap) | 안 씀 | 안 씀 | 상태 있음, 레코드 씀 |
| reviewgate | `tool.result`(chain), `boundary.settle.before`(chain), `boundary.settle.after`(tap) | 씀 | 안 씀 | 상태 있음 |
| commitguard | `tool.call.before`(first), `tool.result`(chain) | 안 씀 | 안 씀 | 상태 있음 |
| guardrail | 가드 지점 셋(first, fail-closed) | 씀 | 안 씀 | 상태 없음(plugin) |

- 지점 이름과 fold는 `F.extensions.spec` §3.4 표를 따른다. 정식 예가 쓰는 지점은 `boundary.settle.after`를 빼면 모두 M1 정확화 지점이다(`input.user.before`, `tool.call.before`, `tool.result`, `boundary.settle.before`; `boundary.settle.after`도 M1 ●). `guardrail`이 쓰는 가드 지점 셋은 M3 F 작업이 더한다(ADR-0017).

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| 그룹 판정 기준(3.1.1), 추가 체크리스트 C1~C9(3.1.2) | `L3.readme`, 외부 그룹 작성자 |
| `TemplateKind`, `TemplateIndexSchema`, `TEMPLATE_PLACEHOLDERS`, `templates/index.json` | `L3.group-kit.plan`(파일 배치), `L4.cli.spec`(생성 명령) |
| 생성 명령 요구 R1~R6 | `L4.cli.spec` |
| 정식 예 fixture `reviewgate`, `commitguard`, `guardrail`과 `GuardVerdict`, `GuardSite`, `GuardCheck`, `patternCheck` | `L3.group-kit.plan`(테스트), `L3.slots.plan` |

요구:

| 이름 | 출처 |
|---|---|
| `defineGroup`, `GroupDef<S>`(상태 생략 허용), `groupManifest`, `RESERVED_GROUP_NAMES`, `GroupApi<S>`(`settings()` 포함), `GroupModule`, `GroupService`, `DriveArbiter`, `replayDrive`(`ReplayDriveOptions`, `ReplayDriveReport`), `scanDriveSource`, `@xeon/group-kit/testing` | `L3.group-kit.spec` §3.2, §3.10, §3.11 |
| `ExtensionManifest`, `ExtensionEntry`, `ScopeApi`, `PostItem`, `ToolCallDecision`, `BoundaryPatch`, `InputPatch`, `ToolResultPatch`, `validateManifest`, `validateUsage`, `validateManifestSet`, `FIRST_DENY` | `F.extensions.spec` |
| `defineSettings`, `SettingDef`, `SettingsTab`, 키 문법, 예약 키 규칙 | `F.wire-settings.spec` |
| 테스트 계층, 테이프 도우미 `t`·`tape`, `testing` 서브패스 규칙 | `eng.testing.guide` |
| `EXT_ID_PATTERN`, `RESERVED_EXT_IDS`, 접두 소유, slots의 컨텍스트 배치(C-2) | `eng.context-map.design` |
| 신뢰 등급과 외부 그룹 로딩 | `X.loading-trust.spec` |
| 핸들러 순서 tier | `X.primitives.spec` |
| `xeon group new` 실행 | `L4.cli.spec` |

## 9. 수용 기준

1. policy 템플릿으로 만든 그룹이 `contracts`·`ext-host` 수정 없이 로드되고, `ext.<id>.enabled`로 켜고 끌 수 있다. 끈 다음 단계 경계 뒤에는 그 그룹의 first 핸들러가 호출되지 않는다.
2. drive 템플릿으로 만든 그룹의 `test/replay.test.ts`가 통과한다. 모든 커밋 지점에서 끊고 재개한 효과 열이 끊지 않은 실행과 같다.
3. 세 템플릿이 만든 매니페스트가 모두 `validateManifest`를 오류 없이 통과한다.
4. 정식 예 3종이 테이프 시나리오(fixture 수준)로 동작한다.
   - reviewgate: 쓰기 도구를 쓴 턴에서 검토 post가 정확히 한 번 들어가고, 같은 `requestId`의 두 번째 post는 `duplicate: true`다.
   - commitguard: 검증 성공 전 `git commit` bash 호출은 거부되고, 검증 성공 뒤에는 실행된다.
   - guardrail: 패턴에 걸린 도구 호출은 도구 호출 가드에서 차단되고, 검사 함수 예외는 `onUnknown: "deny"`에서 차단된다. 핸들러가 던지면 차단된다.
5. policy 그룹의 first 핸들러가 예외를 던지면 도구 호출이 거부된다.
6. 템플릿으로 만든 그룹 소스에 `@xeon/group-helm` import를 넣으면 check-layers가 `DR-02`로 실패한다.
7. 템플릿으로 만든 가짜 그룹을 추가하는 변경에서 `contracts`와 `ext-host`의 diff가 0이다(`product.vision.spec` S1).

## 10. 미결 사항

- [미결] 템플릿 파일 위치(`eng.context-map.design` C-2). 이 문서는 `group-kit/templates/`를 [제안]한다(3.3.1).
- [미결] 정책 플러그인의 group/plugin 구분 기준의 최종 확정(4.2.1).
- (닫힘) [결정: review.m3-design-inputs D-M3-30] 입출력 가드레일 보류는 내장 검사 없음과 fail-closed 가드 지점 셋으로 바꿨다(ADR-0017, 3.2.4절, 4.2.4절). 모델 분류기 사용은 4.2.4 5번의 [제안]이다.
- [미결] 외부 그룹의 신뢰 등급 값 집합과 다른 그룹 import를 X 로더가 거부할지(`X.loading-trust.spec`, `F.extensions.spec` §10).
- [미결] 생성 명령 `xeon group new`의 소유 문서. 이 문서는 실행을 `L4.cli.spec`에 두고 요구 R1~R6만 정한다. 매니페스트 형식(`plugin.json` 또는 `manifest.ts`) 선택 옵션도 함께 정한다.
- [결정: review.decisions-2 U-18] 새 그룹 이름 규칙: `^[a-z][a-z0-9-]{1,31}$`(밑줄 없음). `eng.context-map.design` CM-07·C-6과 F `ExtensionName` 정정은 그 문서 쪽 변경이다.
- [결정: review.decisions-2 T-21] 공통 모순 (1) 그룹 kind 접두는 공개·비공개 모두 `grp.<id>.*`다. 템플릿은 공개 레코드에 `g.record`, 비공개 기록에 `recordPrivate`를 쓴다(`L3.readme` §10.2).
- [미결] 공통 모순 (2) on 핸들러 외부 효과 금지와 `delegate`의 `requestId` 멱등 예외. 템플릿은 핸들러에서 `delegate`를 쓰지 않는다.
  - 결정됨: ADR-0015(C안, 2026-10-25). on 핸들러의 결정적 `requestId` `delegate`는 허용된다. 템플릿은 그대로 핸들러에서 `delegate`를 쓰지 않는다. 쓰는 예는 L3.learning.spec §4.3·§4.10이다.
