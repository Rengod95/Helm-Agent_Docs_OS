---
id: eng.dependency-rules.guide
layer: eng
domain: dependency-rules
kind: guide
status: draft
depends_on: []
binds: [xeon/packages/**, xeon/apps/**, xeon/plugins/**, xeon/scripts/check-layers.ts, xeon/.dependency-cruiser.cjs]
---

# 의존 규칙 가이드

Xeon 워크스페이스의 패키지가 무엇을 import할 수 있는지 정한다. 규칙마다 ID(`DR-NN`)를 붙이고, 위반 메시지에 이 ID가 나오게 한다. 도구 버전, `just verify` 순서, 종료코드 규약은 `eng.toolchain.guide`가 정한다. 테스트 파일의 배치와 가짜 규칙은 `eng.testing.guide`가 정한다.

## 1. 적용 범위

- 대상 코드: `xeon/packages/*`, `xeon/apps/*`, `xeon/plugins/*`의 모든 소스(`src/**`, `test/**`)와 `package.json`, `tsconfig.json`.
- 대상 도구 설정: `xeon/scripts/check-layers.ts`, `xeon/.dependency-cruiser.cjs`, `xeon/.oxlintrc.json`의 `no-restricted-imports`·`import/no-cycle` 항목, `xeon/knip.json`.
- 제외: `xeon/vendor/*`(층 검사, lint, 포맷 대상이 아니다. DR-11만 적용), `xeon/scripts/*`(층에 속하지 않는 저장소 도구. 패키지를 import하지 않는다).
- 이 문서가 다루지 않는 것:
  - 타입 금지 구문(`any`, `enum`, `namespace` 등)의 규칙 본문은 `eng.typescript.guide`가 소유한다. 여기서는 oxlint 설정 연결만 적는다.
  - 이벤트·트랜잭션 규칙은 `eng.events.design`, `eng.transactions.design`이 소유한다. 이 문서는 "SQLite 접근은 `platform-store`만"이라는 모듈 소유 규칙(DR-07)만 둔다.
  - 바운디드 컨텍스트별 소유 경계(테이블, 이벤트 type 접두사, 서비스 이름)는 `eng.context-map.design`이 소유한다. 컨텍스트가 다른 패키지 사이의 import 금지(DR-14)는 이 문서가 소유하고, 어떤 패키지가 어느 컨텍스트에 속하는지는 그 문서 4.1절 표를 쓴다.

### 1.1 층 순위

[결정] 순위와 의존 방향은 `_research/foundation-plan.md §3`(층 순위와 의존 방향)을 따른다.

| 순위 | 층 | 패키지 디렉터리 | `"xeon".layer` 값 |
|---|---|---|---|
| 0 | F 계약 | `packages/contracts` | `F` |
| 1 | X 확장 호스트 | `packages/ext-host` | `X` |
| 2 | L0 플랫폼 | `packages/platform-*` | `L0` |
| 3 | L1 코어 | `packages/core-*`, `plugins/*` | `L1` |
| 4 | L2 능력 | `packages/cap-*` | `L2` |
| 5 | L3 의도 그룹 | `packages/group-*` | `L3` |
| 6 | L4 배포 런타임 | `apps/*` | `L4` |
| 제외 | 고정 외부 코드 | `vendor/*` | 없음 |

- 숫자가 작을수록 아래 층이다. 화살표 F → X → L0 → L1 → L2 → L3 → L4는 "왼쪽이 오른쪽에 쓰인다"는 뜻이다.
- [결정: review.decisions-2 U-16] `plugins/*`는 L1 순위로 센다. 현재 `scripts/check-layers.ts`의 `expectedLayer()`와 `.dependency-cruiser.cjs`의 `LAYERS`가 이 값을 쓴다. 플러그인이 import할 수 있는 범위는 DR-09가 정한다.
- [결정: review.decisions-2 U-14] X는 L0 아래(순위 1)에 둔다. 판정과 근거는 `architecture.layers.spec` 4.3.3절이다. 이 순위에서 `ext-host`는 OS 기능(프로세스 실행, 파일 잠금, 저장)을 L0에서 import할 수 없고, 다음 세 조건을 지킨다.
  1. X 소스와 테스트에서 L0·L1 import가 0건이다(DR-01. 테스트도 대상이다).
  2. X가 받는 포트와 각 층의 서비스 인터페이스는 F에 정의한다.
  3. L0는 `ExtHost.registerPlatform`으로 등록한다.
- 세 조건을 지킬 수 없는 X 구성요소가 나오면 순위 변경(X를 L0 위로)을 ADR로 다시 정한다.

### 1.2 위반 메시지 형식

[제안] 모든 검사 도구는 위반을 다음 형식 한 줄로 낸다. `eng.toolchain.guide`의 종료코드 규약(1 고침, 2 환경 문제, 3 사람 확인)과 함께 쓴다.

```text
<파일>:<행> <규칙ID> <설명>
packages/core-loop/src/turn.ts:3 DR-01 L1 package @xeon/core-loop imports higher layer L2 (@xeon/cap-web)
```

- `check-layers.ts`는 이 형식을 직접 출력한다. 현재 구현은 `FAIL <규칙이름> <패키지>: <설명>` 형식이고 행 번호가 없다. 규칙 이름을 아래 대응표의 DR ID로 바꾸고 행 번호를 더하는 작업이 남아 있다(`eng.toolchain.guide` 수용 기준).
- dependency-cruiser와 oxlint는 자기 출력 형식을 바꿀 수 없다. 그래서 규칙 이름(depcruise `name`)과 메시지(oxlint `message`)가 `DR-NN`으로 시작하게 한다. 그러면 출력 어딘가에 규칙 ID가 나온다.

| 현재 `check-layers` 규칙 이름 | DR ID | 현재 depcruise 규칙 이름 | 바꿀 이름 [제안] |
|---|---|---|---|
| `upward-dependency` | DR-01 | `no-upward-import-from-<층>` | `DR-01-no-upward-import-from-<층>` |
| `same-layer-dependency` | DR-02 | `no-same-layer-import-<층>` | `DR-02-no-same-layer-import-<층>` |
| `layer-invalid`, `layer-location` | DR-03 | — | — |
| `undeclared-dependency`, `unknown-package` | DR-04 | `no-non-package-json` | `DR-04-no-undeclared-dependency` |
| `relative-escape` | DR-05 | — | — |
| — | DR-06 | `no-circular` | `DR-06-no-circular` |
| — | DR-11 | `cordis-only-in-ext-host` | `DR-11-cordis-only-in-ext-host` |

## 2. 규칙

### DR-01 패키지는 자기보다 낮은 순위만 import한다

[결정] `_research/foundation-plan.md §3`.

- 대상: 값 import, `import type`, 재수출(`export ... from`), 동적 `import()`, `package.json`의 `dependencies`·`devDependencies`·`peerDependencies`·`optionalDependencies`에 적힌 워크스페이스 패키지.
- `import type`도 예외가 아니다. 타입만 쓰더라도 상위 층의 타입을 아래 층이 알면, 상위 층을 바꿀 때 아래 층의 타입 검사가 함께 깨진다.

이유:

- 아래 층은 위 층보다 덜 바뀐다. 의존이 한 방향이면 위 층을 고치거나 교체해도 아래 층은 다시 빌드하거나 다시 테스트할 필요가 없다. 사용자가 L2 능력과 L3 그룹을 추가·교체할 수 있어야 한다는 결정(`_research/decisions-log.md` 2026-10-21 배포 단위 정정)이 이 성질을 전제한다.
- `tsc -b` 프로젝트 참조와 turbo `--affected`가 패키지 그래프를 따라 일을 줄인다. 방향이 섞이면 영향 범위가 커진다.

좋은 예:

```ts
// packages/core-loop/src/turn.ts  (L1, 순위 3)
import type { TurnId } from "@xeon/contracts";                       // F(0)
import { StoreServiceName, type StoreService } from "@xeon/contracts"; // L0 기능은 F 서비스 타입으로 주입받는다(DR-14)
```

```ts
// apps/host/src/assemble.ts  (L4, 순위 6, 조립 루트)
import { storePlugin } from "@xeon/platform-store";     // L0(2). 조립 루트라 DR-14 예외
import { loopPlugin } from "@xeon/core-loop";           // L1(3)
```

- DR-01은 순위만 본다. 순위상 허용되는 하위 층 import라도 컨텍스트가 다르면 DR-14가 다시 막는다. 그래서 F와 조립 루트 밖에서 실제로 남는 하위 층 import는 같은 컨텍스트 안의 import, `@xeon/ext-host`의 서비스 등록·주입 API, 테스트 파일의 `testing` 서브패스뿐이다(DR-14 예외).

나쁜 예:

```ts
// packages/core-loop/src/turn.ts  (L1, 순위 3)
import type { SearchResult } from "@xeon/cap-web";    // DR-01: L2(4)는 L1보다 위다
```

```ts
// packages/contracts/src/index.ts  (F, 순위 0)
export type { ExtHost } from "@xeon/ext-host";  // DR-01: F는 어떤 워크스페이스 패키지도 import하지 않는다
```

### DR-02 같은 층 패키지끼리 import하지 않는다

[결정] `_research/foundation-plan.md §3`. 같은 층의 협력은 F에 둔 정의(타입, 스키마, 서비스 이름)와 Cordis 서비스로만 한다. L3 그룹(`group-helm`, `group-learning`)끼리도 같다.

- L1 코어끼리(`core-loop`와 `core-models` 등), L2 능력끼리, L3 그룹끼리, L4 앱끼리(DR-10) 모두 해당한다.
- 협력 방법:
  1. 주고받을 타입과 서비스 이름을 F(`packages/contracts`)에 정의한다.
  2. 제공하는 쪽은 그 서비스를 Cordis 컨텍스트에 등록한다(`X.primitives.spec`이 등록 API를 정한다).
  3. 쓰는 쪽은 F의 타입으로 서비스를 주입받는다. 제공 패키지를 import하지 않는다.

이유:

- 같은 층 패키지를 사용자가 교체할 수 있어야 한다. 직접 import가 있으면 교체한 패키지가 원래 패키지의 export 모양을 그대로 흉내 내야 한다. F 정의와 서비스 주입이면 F 계약만 맞추면 된다.
- 학습 그룹과 Helm 그룹은 공존한다(`_research/decisions-log.md` 2026-10-21 계획 v2). 둘 사이에 import가 있으면 한쪽을 끌 때 다른 쪽이 깨진다.

좋은 예:

```ts
// packages/contracts/src/services/models.ts  (F, 서브패스 @xeon/contracts/services)
import { Type, type Static } from "typebox";
export const ModelServiceName = "xeon.models" as const;
export interface ModelService {
  resolve(ref: ModelRef): ResolvedModel;
}
```

```ts
// packages/core-loop/src/turn.ts  (L1)
import { ModelServiceName, type ModelService } from "@xeon/contracts/services";
// ModelService 구현은 core-models가 Cordis 서비스로 등록한다. core-loop는 F 타입으로만 받는다.
```

- [결정: review.decisions-2 D-04] L1·L0 서비스 인터페이스(`TaskService`, `LoopService`, `ExecutionEnv`, `SandboxService`, `ProcessService`, `OsService`, `ModelService`, `ToolService`, `ContextService`)와 서비스 이름 상수는 F `@xeon/contracts/services` 서브패스에 둔다. 위 예의 메서드 모양은 설명용이고, 실제 시그니처는 F 문서와 `L1.models.spec`이 정한다 [가정].

나쁜 예:

```ts
// packages/core-loop/src/turn.ts  (L1)
import { resolveModel } from "@xeon/core-models";     // DR-02: 같은 L1
```

```ts
// packages/group-learning/src/index.ts  (L3)
import { helmSignals } from "@xeon/group-helm";       // DR-02: L3 그룹끼리
```

- [결정: review.decisions-2 U-15] `group-kit`(L3 그룹 정의 API)은 그룹이 공통으로 쓰는 정의 도우미다. `group-*` → `group-kit` 한 방향만 허용하고 허용 목록(4절)에 `DR-02/group-kit` 한 항목으로 기록한다. 그 항목의 `from`은 `packages/group-*` 패턴이고, 대상 진입점은 `.`와 `./testing`뿐이다. 다른 그룹과 `group-kit`의 나머지 경로는 위반이다. `group-kit`은 다른 그룹을 import하지 않는다. 그룹 공통 기반을 그룹마다 중복하지 않기 위해서다.

### DR-03 모든 패키지는 `package.json`에 `"xeon": {"layer", "domain"}`을 두고, 값은 위치와 맞아야 한다

[결정] `_research/foundation-plan.md §3`: `check-layers.ts`와 dependency-cruiser가 이 값으로 위반을 거부한다.

- `layer`는 `F`, `X`, `L0`, `L1`, `L2`, `L3`, `L4` 중 하나다. 디렉터리에서 나온 층(1.1 표)과 같아야 한다.
- `domain`은 `_routing/routes.yaml`의 `layout.<층>.domains`에 있는 이름이어야 한다. 디렉터리 이름의 접두사를 뺀 값과 같다. 예: `packages/core-loop` → `"domain": "loop"`. [제안] `plugins/*`는 디렉터리 이름 전체를 쓴다(`"domain": "provider-anthropic-oauth"`). 현재 `check-layers.ts`는 `domain`을 검사하지 않으므로 검사를 더해야 한다.
- `vendor/*`는 `xeon` 필드를 두지 않는다.

이유: 층 판정의 근거가 디렉터리 이름 하나뿐이면, 새 패키지를 잘못된 위치에 만들었을 때 아무 검사도 실패하지 않는다. 선언과 위치가 서로 확인하게 하면 둘 중 하나가 틀렸을 때 바로 드러난다. `domain`은 문서 라우팅(`docs-route`)이 코드 경로에서 문서를 고를 때 쓰는 이름과 같다.

좋은 예:

```json
{
  "name": "@xeon/core-loop",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "xeon": { "layer": "L1", "domain": "loop" }
}
```

나쁜 예:

```json
{
  "name": "@xeon/core-web-cache",
  "xeon": { "layer": "L2", "domain": "web" }
}
```

`packages/core-*`는 L1이어야 한다. 웹 능력이면 `packages/cap-web` 안에 두거나 `cap-` 이름으로 만든다(DR-03 `layer-location`).

### DR-04 워크스페이스 의존은 선언하고, `tsconfig.json`의 `references`와 맞춘다

[제안] `docs/design/06-system-architecture.md §3.5.1` R1·R11을 옮긴다.

- 소스에서 `@xeon/<이름>`을 import하면 그 패키지의 `package.json`에 `"@xeon/<이름>": "workspace:*"`가 있어야 한다. 테스트에서만 쓰면 `devDependencies`에 둔다.
- 같은 대상을 그 패키지 `tsconfig.json`의 `references`에 `{ "path": "<대상 패키지 디렉터리의 상대 경로>" }`로 둔다. `references`와 워크스페이스 의존 목록은 같은 집합이다.
- 외부 npm 패키지도 선언 없이 import하지 않는다. 버전 값은 `"catalog:"`만 쓴다(`eng.toolchain.guide` TC-02).

이유:

- Bun 워크스페이스는 의존을 루트 `node_modules`로 끌어올릴 수 있다. 그러면 선언하지 않은 패키지도 import가 해석된다 [가정: Bun 1.4.3의 기본 링크 방식은 확인하지 않았다]. pnpm처럼 해석 단계에서 막히지 않으므로 검사로 막는다.
- `references`가 빠지면 `tsc -b`가 빌드 순서를 정할 수 없다. 참조 순환 검사(DR-06)도 `references`에 기댄다.

좋은 예:

```jsonc
// apps/host/package.json  (조립 루트, DR-14 예외)
"dependencies": { "@xeon/contracts": "workspace:*", "@xeon/platform-store": "workspace:*" }
// apps/host/tsconfig.json
"references": [{ "path": "../../packages/contracts" }, { "path": "../../packages/platform-store" }]
```

나쁜 예:

```ts
// apps/host/src/assemble.ts. package.json에 @xeon/platform-store가 없다
import { storePlugin } from "@xeon/platform-store"; // DR-04 undeclared-dependency
```

### DR-05 다른 패키지는 `exports`에 적힌 진입점으로만 import한다

[제안] 06 §3.5.1 R9를 옮긴다.

- 금지: `@xeon/<이름>/src/...`, `@xeon/<이름>/dist/...`, 상대 경로로 패키지 디렉터리를 벗어나는 import(`../../platform-store/src/db.ts`).
- 각 패키지의 `exports`는 명시한 진입점만 둔다. 와일드카드(`"./*"`)는 쓰지 않는다.
- 서브패스는 `exports`에 이름을 적어 연다. 예: `"./testing": "./src/testing/index.ts"`(DR-08).
- 내부 패키지는 TS 소스를 그대로 export한다(`eng.toolchain.guide` TC-05). `exports` 값은 `./src/*.ts` 경로다.

이유: 공개 진입점 뒤의 파일 구조는 패키지가 마음대로 바꿀 수 있어야 한다. 깊은 import가 하나라도 있으면 파일 이름 변경이 다른 패키지를 깨뜨린다. 같은 층 협력을 서비스로 제한한 DR-02도 깊은 import로 우회할 수 있으므로 함께 막는다.

좋은 예:

```ts
// apps/host/src/assemble.ts  (조립 루트, DR-14 예외)
import { storePlugin } from "@xeon/platform-store";
// packages/core-persistence/test/commit.int.test.ts  (테스트 파일, DR-14 예외 3)
import { openTestStore } from "@xeon/platform-store/testing";   // exports에 "./testing"이 있다. 테스트 파일에서만(DR-08)
```

나쁜 예:

```ts
import { openDb } from "@xeon/platform-store/src/db.ts";     // DR-05: src로 들어감
import { openDb } from "../../platform-store/src/db.ts";     // DR-05 relative-escape
```

### DR-06 순환 의존을 두지 않는다

[제안] 06 §3.5.1 R10을 옮긴다.

- 패키지 사이: DR-01·DR-02를 지키면 생기지 않는다. 그래도 `tsc -b`의 참조 순환 오류와 depcruise `DR-06-no-circular`가 다시 확인한다.
- 패키지 안 파일 사이: 값 import 순환을 금지한다. oxlint `import/no-cycle`과 depcruise `DR-06-no-circular`가 검사한다.
- 타입 전용 순환(`import type`끼리의 순환): oxlint `import/no-cycle`의 기본값 `ignoreTypes: true`는 이를 허용한다(`_research/notes/eng-1.md §2`). depcruise는 `tsPreCompilationDeps: true`라 타입 import도 그래프에 넣는다. 두 도구의 판정이 다르다 [미결: 타입 전용 순환을 허용할지 정한다. 이 문서는 depcruise 판정(금지)을 기준으로 둔다].

이유: 순환이 있으면 모듈 초기화 순서에 따라 값이 `undefined`로 보이는 오류가 생기고, 빌드 순서도 정해지지 않는다.

좋은 예:

```ts
// src/turn-state.ts: 두 파일이 함께 쓰는 타입을 세 번째 파일로 뺀다
export interface TurnState { readonly step: number }
// src/turn.ts
import type { TurnState } from "./turn-state.ts";
// src/step.ts
import type { TurnState } from "./turn-state.ts";
```

나쁜 예:

```ts
// src/turn.ts
import { runStep } from "./step.ts";
export const MAX_STEPS = 32;
// src/step.ts
import { MAX_STEPS } from "./turn.ts";   // DR-06: turn.ts ↔ step.ts
```

### DR-07 외부 모듈은 소유 패키지만 import한다

[제안] 06 §3.5.1 R6·R7을 Xeon 패키지로 옮긴다. 소유 근거는 `_research/packages.md §4.2`(L0), `§4.3`(L1), `§4.4`(L2), `§4.5`(X)의 채택 판정이다.

| 외부 모듈·바이너리 | 소유 패키지(이 패키지 밖에서 금지) | 근거 |
|---|---|---|
| `bun:sqlite` | `platform-store` | packages.md §4.2 L0-e, foundation-plan §2 DB 행 |
| `better-sqlite3`, `node:sqlite`, `sqlite3` | 없음(전부 금지) | foundation-plan §2. 현재 `.oxlintrc.json` 패턴에 있다 |
| `@earendil-works/pi-ai` | `core-models`, `plugins/provider-anthropic-oauth`(DR-09). F는 아래 예외 | packages.md §4.3 L1-c, foundation-plan §2 모델·루프 행, review.decisions-2 U-16 |
| `@earendil-works/pi-agent-core` | 없음(전부 금지, 타입 import 포함). 루프는 그 1.3.0 루프를 포크한 core-loop 자체 코드다 | adr.0009 |
| pi durable env 포크(`platform-exec` 안 소스) | `platform-exec` | foundation-plan §1 결정 1, §3 배치 |
| `sops`, `age` 바이너리 호출 | `platform-secrets` | foundation-plan §2 비밀 행 |
| `@anthropic-ai/sandbox-runtime` | `platform-sandbox` | packages.md §4.2 L0-b |
| `bun:ffi` | `platform-store`(`lock/posix.ts`, M2 이후 `lock/win32.ts`) | `L0.store.plan` §4 채택 코드 표(쓰기 잠금 `flock`) [결정: review.decisions-2 U-17] |
| `node:child_process`, `Bun.spawn`, `Bun.spawnSync` | `platform-exec`, `platform-process`, `platform-sandbox`, `platform-secrets`, `platform-os` | 프로세스 실행은 L0 인터페이스 뒤에 둔다(DR-13). `platform-os`는 바이너리 `--version` 확인, 알림 명령, `mount` 조회에 쓴다(`L0.os.plan` §4) [결정: review.decisions-2 U-17] |
| `node:child_process`, `Bun.spawn`, `Bun.spawnSync`(테스트 한정) | 허용 목록에 `scope: "test"` 항목이 있는 패키지의 테스트 파일(`test/**`). 운영 소스(`src/**`)는 위 행 그대로 L0만 | 엔진·CLI·자식 프로세스 장애를 실제 프로세스로 시험한다(SIGKILL 재개, stdio 적합성, 포크 기록 검사). `check-layers.ts`가 항목의 `from` 패키지와 테스트 파일 경로를 함께 검사한다 [결정: review.decisions-2 B-06] |
| `@vscode/ripgrep`, `@parcel/watcher` | `platform-os` | packages.md §4.2 L0-f, `L0.os.plan` §4 채택 코드 표 [결정: review.decisions-2 U-17]. `@vscode/ripgrep`은 `platform-os`가 import해 `rg` 바이너리 경로를 제공하고(`resolveBinary`), `cap-workspace`는 그 경로로 `rg`를 실행만 한다(`ExecutionEnv.exec`). `cap-workspace`는 이 모듈을 import하지 않는다 [결정: review.m2-plan §8] |
| `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `pi-telemetry` | `platform-os`. F는 `@opentelemetry/api`를 `import type`으로만 쓴다 | packages.md §4.2 L0-f, `L0.os.plan` §4, `F.readme` §1 [결정: review.decisions-2 U-17] |
| `@modelcontextprotocol/client` | `cap-mcp` | packages.md §4.4 L2-b |
| `playwright-core` | `cap-web` | packages.md §4.4 L2-c web.browse |
| `guarded-fetch`, `defuddle`, `turndown`, `@mozilla/readability`, `linkedom` | `cap-web` | packages.md §4.4 L2-c web.fetch, `L2.web.spec` §4.9.3(변환 모듈이 쓰는 라이브러리). `fetch/convert/**`는 WEB-R16이 추가로 제한한다 |
| `age-encryption` | `platform-secrets` | `L0.secrets.plan` SC-13(파일 폴백 키 생성) |
| `cordis`, `@cordisjs/*`, `vendor/cordis` | `ext-host` | DR-11 |
| `@swc/core` | `group-kit`의 `src/testing/**`(`./testing` 하위 경로, `scanDriveSource`)와 dependency-cruiser 파서. group-kit의 다른 운영 소스는 import하지 않고, 사이드카·데스크톱·플러그인 번들에 넣지 않는다(번들 확인은 M3-27) | `L3.group-kit.plan` §2(G-19, H-14·H-18 drive 정적 검사) [결정: 2026-10-28 사용자 승인] |
| `@tauri-apps/*` | `apps/desktop` | foundation-plan §2 데스크톱 행 |
| `react`, `react-dom`, `zustand` | `apps/desktop`. 앱 안 import 위치는 `eng.frontend-state.guide` FS-06이 더 좁힌다 | adr.0010 §3.3 [결정: 2026-10-24 사용자 지시] |
| `node:*`, `bun:*`, Bun 전역 | F(`contracts`)에서 금지 | 06 R4를 F에 한정해 옮긴다. F는 데스크톱 WebView에서도 import되므로 런타임 중립이어야 한다 [제안] |

- [결정: review.decisions-2 U-17] F의 pi 타입 재노출 예외: `contracts`는 `@earendil-works/pi-ai`를 `import type`과 `export type`으로만 쓸 수 있다. 값 import는 금지다. 근거는 `F.readme` §1 허용 외부 의존과 `F.conversation.spec` §3.1 규칙 1이다. `check-layers.ts`는 F에서 이 모듈의 값 import를 `DR-07`로 거부한다. `@earendil-works/pi-agent-core`는 F에서도 타입 import까지 금지다(adr.0009).
- `typebox`는 소유 제한이 없다. 모든 층이 스키마를 쓴다. 단 `@sinclair/typebox`(0.x 계열)는 금지다(현재 `.oxlintrc.json` 패턴).
- 표에 없는 새 외부 의존을 들일 때는 이 표에 행을 더하는 변경과 함께 한다. 소유를 정하지 않은 외부 모듈은 여러 층에 퍼진다.

이유:

- 외부 라이브러리의 API가 바뀌거나 교체될 때 고칠 곳을 한 패키지로 줄인다. pi-ai는 정확 버전으로 고정하고 부족분만 포크한다(`_research/decisions-log.md` 2026-10-21 결정 2차). 포크 범위를 관리하려면 import 위치가 한 곳이어야 한다.
- `bun:sqlite`를 `platform-store` 밖에서 열면 단일 DB·단일 쓰기 규칙(`eng.transactions.design`)을 검사로 확인할 수 없다.
- OS 바이너리(`sops`) 호출 위치가 하나면 OS별 경로와 오류 처리를 L0 한 곳에서 바꾼다(DR-13).

좋은 예:

```ts
// packages/core-tools/src/read.ts  (L1)
import { SecretServiceName, type SecretService } from "@xeon/contracts/services";   // 서비스 이름은 eng.context-map.design 5.3절(xeon.secrets), 위치는 L0.secrets.spec §8.3 R1-a
// 비밀 값은 platform-secrets가 등록한 서비스로 참조만 받는다. sops를 직접 부르지 않는다.
```

나쁜 예:

```ts
// packages/cap-knowledge/src/index.ts  (L2)
import { Database } from "bun:sqlite";                  // DR-07: SQLite는 platform-store만
```

```ts
// packages/core-tools/src/secrets.ts  (L1)
const out = Bun.spawnSync(["sops", "-d", path]);        // DR-07: sops 호출과 Bun.spawn은 L0만
```

```ts
// packages/core-loop/src/model.ts  (L1)
import { streamSimple } from "@earendil-works/pi-ai";   // DR-07: pi-ai는 core-models만
```

### DR-08 테스트 전용 모듈은 테스트 파일에서만 import한다

[제안] 06 §3.5.1 R3을 옮긴다. testing 정의는 [결정: review.decisions-2 U-17]로 DR-14 예외 3과 하나로 맞춘다.

- 테스트 전용 모듈: `testing` 서브패스가 있는 패키지의 `testing` 서브패스(`@xeon/<이름>/testing`), `bun:test`. F(`contracts`)는 `testing` 서브패스를 두지 않고, 시계·난수·ID 대역(`manualClock`, `seededRandom`, `fixedIdFactory`)은 각 패키지 `test/` 안에 둔다([결정: review.decisions-2 U-03]).
- 테스트 파일: `src/**/*.test.ts`, `test/**`. 다른 패키지의 `testing` 서브패스를 import할 수 있는 파일은 테스트 파일뿐이다. 패키지 자신의 `src/testing/**`도 테스트 파일이 아니므로 다른 패키지의 `testing` 서브패스를 import하지 않는다.
- 다른 패키지의 `testing` 서브패스를 쓰는 패키지는 그 패키지를 `devDependencies`에 둔다. 이미 `dependencies`에 있으면 그대로 쓴다. DR-01 순위는 테스트 파일에도 적용된다.

이유: 가짜 구현(`ManualClock`, 메모리 비밀 저장소, 테이프 모델)이 운영 경로로 들어가면 실제 시각·비밀·모델 대신 가짜가 쓰이는 결함이 생긴다. 빌드된 바이너리 크기도 늘어난다. `src/testing/**`이 다른 패키지의 대역을 다시 내보내면 테스트 파일만 교차 import한다는 경계가 흐려진다.

좋은 예:

```ts
// packages/core-persistence/test/commit.int.test.ts
import { test, expect } from "bun:test";
import { openTestStore } from "@xeon/platform-store/testing";
import { manualClock } from "./support/clock.ts";   // 시계·난수·ID 대역은 자기 패키지 test/ 안에 둔다(U-03)
```

나쁜 예:

```ts
// packages/core-persistence/src/open.ts. 운영 코드
import { openTestStore } from "@xeon/platform-store/testing";   // DR-08
```

```ts
// packages/core-models/src/testing/index.ts. 테스트 파일이 아니다
export { openTestStore } from "@xeon/platform-store/testing";   // DR-08: testing 서브패스 소스의 교차 import
```

### DR-09 `plugins/*`는 F, X, L0, 외부 패키지만 import하고 `core-*`는 import하지 않는다. `plugins/provider-anthropic-oauth`는 배포판에 들어가지 않는다

[결정] provider 위장 경로는 유지하되 별도 플러그인으로 분리하고 릴리즈에서 제외한다(`_research/decisions-log.md` 2026-10-21 결정 2차, `_research/foundation-plan.md §2` 모델·루프 행).

[결정: review.decisions-2 U-16] import 범위와 등록 경로:

- import 허용: `@xeon/contracts`의 공개 진입점, `@xeon/ext-host`의 서비스 등록·주입 API(DR-14 예외 4), 외부 패키지 `@earendil-works/pi-ai`(DR-07 표). L0 패키지 import는 DR-01 순위상 허용되지만 컨텍스트가 다르므로 DR-14에 따라 F 서비스 타입으로 주입받는다.
- import 금지: `core-*`를 포함한 L1 패키지 전부. `plugins/*`는 L1 순위이므로 L1 import는 DR-02(같은 층)에 걸리고, 같은 층 예외는 두지 않는다.
- 등록 경로: 위장 provider는 F의 provider 인터페이스(`ProviderDef`)로 `core-models` 서비스에 등록한다. 플러그인은 setup에서 X가 주입한 `xeon.models`(F `ModelService`)의 `addProvider(owner, name, def)`를 부른다(`L1.models.spec` §3.11). 플러그인은 X `ModelsPort`(`hostOf(g).registerProvider`)를 쓰지 않는다. 이 포트는 확장의 등록 경로다(`X.primitives.spec` §3.9).
- 배포 제외:
  - 어떤 패키지와 앱도 `@xeon/provider-anthropic-oauth`를 `dependencies`에 두지 않는다.
  - `bun build --compile` 진입점(`apps/cli`, `apps/host`)의 import 그래프에 이 패키지가 없어야 한다.
  - 사용자는 확장 로딩(`X.loading-trust.spec`)으로 별도 설치한다.

이유: 약관과 계정 제재 위험이 있는 코드를 본체에서 떼어 둔다(`_research/ref-synthesis.md` "피할 것" 세 번째 항목). 본체 코드가 이 플러그인을 몰라야 공개 릴리즈에서 빼도 본체 빌드가 바뀌지 않는다.

좋은 예:

```ts
// plugins/provider-anthropic-oauth/src/index.ts
import type { SecretRef } from "@xeon/contracts";
import { anthropicMessages } from "@earendil-works/pi-ai";   // DR-07 표의 소유 패키지
// setup에서 주입받은 xeon.models(F ModelService)의 addProvider(owner, "anthropic-oauth", { kind: "runtime", provider, credential })
```

나쁜 예:

```ts
// plugins/provider-anthropic-oauth/src/index.ts
import type { ProviderRegistration } from "@xeon/core-models";   // DR-09: core-* import
import { runTurn } from "@xeon/core-loop";                        // DR-09: L1 import
```

```jsonc
// apps/cli/package.json
"dependencies": { "@xeon/provider-anthropic-oauth": "workspace:*" }   // DR-09: 배포판 의존
```

### DR-10 앱(`apps/*`)끼리 import하지 않는다

[제안] DR-02를 L4에 적용한 것이다. 별도 ID를 두는 이유는 앱 사이 연결 방식이 다르기 때문이다.

- `apps/desktop`은 엔진을 `apps/host`에서 만든 사이드카 바이너리로 실행하고 stdio JSON-RPC로 연결한다(`_research/foundation-plan.md §1` 결정 3). `@xeon/host`를 import하지 않는다.
- `apps/cli`는 엔진 라이브러리를 in-process로 쓴다.
- [결정: review.decisions-2 U-15] 엔진 조립 코드는 `apps/host` 한 곳에 둔다. `apps/cli` → `apps/host` 한 방향만 허용 목록 항목 `DR-10/cli-host`로 허용한다(4절). `apps/host`는 다른 앱을 import하지 않고, `apps/desktop`은 어떤 앱도 import하지 않는다.
- [결정: adr.0020] CLI와 데스크톱이 함께 쓰는 연결 코드(`createHostConnection`), 설정 view-model, 공유 로직, i18n 카탈로그는 L4 공유 패키지 `xeon/packages/client`(`@xeon/client`)에 둔다. 이 패키지는 F(`@xeon/contracts`)만 import한다. `apps/cli` → `@xeon/client`, `apps/desktop` → `@xeon/client` 두 간선을 허용 목록 항목 `DR-10/cli-client`, `DR-10/desktop-client`로 허용한다(4절). `@xeon/client`는 앱이나 엔진 패키지를 import하지 않는다. `check-layers.ts`는 `apps/*` → `packages/client`를 DR-10으로 보고하고, `expectedLayer`는 디렉터리 이름 `client`를 L4로 본다. `.dependency-cruiser.cjs`는 L4 경로에 `packages/client/`를 넣고 `client` → `apps/*` 간선을 막는다.
- `apps/host` → `@xeon/client`는 호스트의 `./client` 재노출과 시험 때문에 `DR-10/host-client`로 열었다. [미결] adr.0020 §3.5는 이 간선을 두지 않는 안이다.

이유: 앱끼리 import하면 데스크톱 번들에 CLI 코드가 섞이고, 사이드카 경계(프로세스 분리)가 무너진다. 조립 코드를 두 앱에 나눠 두면 플러그인 등록 순서가 두 벌이 된다.

좋은 예:

```ts
// apps/desktop/src/engine.ts
const engine = Bun.spawn([sidecarPath, "--stdio"]);   // 바이너리 실행. 단 OS 분기는 DR-13
```

나쁜 예:

```ts
// apps/desktop/src/engine.ts
import { startHost } from "@xeon/host";                 // DR-10
```

### DR-11 `vendor/cordis`와 Cordis 패키지는 `ext-host`만 import한다

[결정] Cordis는 rc 버전이라 vendored로 고정하고 ext-host 뒤에 숨긴다(`_research/foundation-plan.md §7`, adr.0002).

- `cordis`, `cordis/*`, `@cordisjs/*`, `@xeon/vendor-cordis`, `vendor/cordis/**`는 `packages/ext-host`만 import한다.
- 다른 패키지는 X가 F 타입으로 내보낸 API를 쓴다. Cordis의 `Context`, `Fiber` 같은 타입을 F나 다른 층의 공개 타입에 노출하지 않는다.

이유: Cordis API는 불안정하다(`_research/decisions-log.md` 2026-10-19 확장 호스트 후보). 갱신할 때 고칠 곳을 `ext-host` 하나로 줄인다.

좋은 예:

```ts
// packages/core-models/src/register.ts  (L1)
import type { ExtensionContext } from "@xeon/contracts";   // F가 정의한 중립 타입
```

나쁜 예:

```ts
// packages/core-models/src/register.ts
import type { Context } from "cordis";                      // DR-11
```

### DR-12 L1의 확장 지점 선언은 F `extensions`에 두고, L1과 X가 공유한다

[결정] `_research/foundation-plan.md §3`: 지점 이름, fold, 페이로드 타입을 F4에 둔다.

- 선언 위치: `packages/contracts/src/extensions/**`(`F.extensions.spec`). 선언 객체의 모양은 adr.0007 §3.7의 `PointDecl`(`name`, `kind`, `fold`, `payload`, `result`)이다. 지점 이름은 `<종류>.<대상>[.<시점>]` 규칙(`tool.call.before`, `boundary.step.after` 등, adr.0017 §3.2)을 따르고 목록은 `F.extensions.spec`이 정한다.
- L1은 선언 객체를 import해 지점을 연다. X(`ext-host`)는 같은 선언을 import해 등록과 실행을 검사한다. 확장(L2·L3·플러그인)은 adr.0007 §3.7의 `g.on(<지점 이름>, handler)`로 처리기를 단다. 지점 이름 인자의 타입은 F 선언에서 만든 `PointName` 유니온이므로 선언에 없는 이름은 컴파일 오류다.
- 금지: L1 패키지 안에서 지점 선언 객체나 지점 이름 문자열을 새로 만들기, X가 L1을 import해 지점 목록을 얻기(DR-01 위반이기도 하다).

이유: X(순위 1)는 L1(순위 3)을 import할 수 없다. 지점 정의가 L1에 있으면 X가 지점의 fold와 페이로드를 검사할 방법이 없다. 정의를 둘 모두보다 아래인 F에 두면 두 쪽이 같은 값을 쓴다.

좋은 예:

```ts
// packages/contracts/src/extensions/points.ts  (F)
export const ToolCallPoint = {
  name: "tool.call.before",
  kind: "tool",
  fold: "first",
  payload: ToolCallPayloadSchema,      // TypeBox 스키마
  result: ToolCallResultSchema,        // Deny를 포함한다(adr.0007 §3.7)
} as const satisfies PointDecl<"tool.call.before", typeof ToolCallPayloadSchema, typeof ToolCallResultSchema>;
```

```ts
// packages/core-tools/src/pipeline.ts  (L1): 선언 객체로 지점을 연다
import { ToolCallPoint } from "@xeon/contracts/extensions";
const verdict = await ext.dispatch(ToolCallPoint, payload);
```

```ts
// packages/group-helm/src/setup.ts  (L3): adr.0007 §3.7 모양으로 처리기를 단다
g.on("tool.call.before", (call, st) => (st.phase === "diverge" && isWrite(call) ? { deny: "helm.readonly_phase" } : undefined));
```

나쁜 예:

```ts
// packages/core-tools/src/pipeline.ts  (L1)
await ext.dispatch({ name: "tool.call.before", fold: "first" }, payload);   // DR-12: L1에서 지점 선언을 새로 만든다
```

`PointDecl`, `PointName`, `g.on`은 adr.0007 §3.7 초안의 이름이다. `ToolCallPoint`, `ext.dispatch`(L1이 지점을 여는 호출)의 정확한 이름과 시그니처는 `F.extensions.spec`과 `X.primitives.spec`이 정한다. 위 예시의 이름은 설명용이다 [가정].

### DR-13 OS·환경 분기는 L0 구현 안에만 둔다

[결정] OS·환경마다 달라지는 내부 부분은 공통 인터페이스를 정의하고 OS·환경별로 구현만 바꾼다. 소비자 코드에 OS 분기를 두지 않는다(`_research/decisions-log.md` 2026-10-19 설계 규칙).

- 분기 표현: `process.platform`, `process.arch`, `os.platform()`, `os.type()`, `os.release()`, `navigator.platform`, WSL 판정(`WSL_DISTRO_NAME`, `/proc/version` 읽기), 플랫폼별 경로 상수(`"/usr/lib"`, `"C:\\"`, `"~/Library"`).
- 허용 위치: `packages/platform-*/src/**`. 인터페이스는 F에 두고, L0 패키지가 OS별 구현을 고른다.
- 소비자(X, L1~L4)는 인터페이스만 쓴다. 예: 경로는 `platform-os`의 서비스로, 프로세스는 `platform-exec`로, 비밀은 `platform-secrets`로 받는다.
- `apps/desktop`의 Tauri Rust 코드(`src-tauri/`)는 이 규칙 밖이다. TS 쪽 UI 코드는 이 규칙을 따른다.

이유: 첫 지원 OS는 macOS와 Linux(WSL 포함)이고 Windows 네이티브는 나중이다(`_research/decisions-log.md` 2026-10-19). OS 분기가 L0 밖에 흩어지면 Windows를 더할 때 고칠 곳을 찾을 수 없다.

좋은 예:

```ts
// packages/platform-os/src/paths.ts  (L0)
export type DataDirError = { readonly kind: "unsupported_platform"; readonly platform: string };

export function dataDir(env: EnvReader): Result<string, DataDirError> {
  switch (process.platform) {
    case "darwin": return ok(join(env.home(), "Library", "Application Support", "xeon"));
    case "linux": return ok(join(env.xdgDataHome(), "xeon"));
    // xeon-disable-next-line xeon/switch-default-never -- 지원 목록 밖 OS는 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default: return err({ kind: "unsupported_platform", platform: process.platform });
  }
}
```

```ts
// packages/core-persistence/src/open.ts  (L1)
import { OsServiceName, type OsService } from "@xeon/contracts/services";   // 서비스 이름은 eng.context-map.design 5.3절(xeon.os)
const dir = os.dataDir();
```

- `process.platform`은 지원 OS보다 넓은 외부 값이다. 지원 목록 밖 값은 예상 가능한 실패이므로 `Result`로 돌려준다(`eng.typescript.guide` TY-11, TY-14의 열린 외부 값 예외).

나쁜 예:

```ts
// packages/core-persistence/src/open.ts  (L1)
const dir = process.platform === "darwin"
  ? `${home}/Library/Application Support/xeon`
  : `${home}/.local/share/xeon`;                  // DR-13
```

### DR-14 컨텍스트가 다른 패키지의 구현을 import하지 않는다

[제안] `eng.context-map.design` 3절 협력 규칙 2와 CM-05를 이 문서의 규칙으로 옮긴 것이다. 패키지가 속한 컨텍스트는 그 문서 4.1절 표이고, 코드 상수는 `xeon/packages/contracts/src/records/owners.ts`의 `CONTEXTS`다.

- 대상: DR-01이 순위상 허용하는 하위 층 import 가운데, import하는 패키지와 대상 패키지의 컨텍스트가 다른 것. 값 import, `import type`, 재수출, 동적 `import()`, `package.json`의 워크스페이스 의존을 모두 센다.
- 협력 방법: DR-02와 같다. 주고받을 타입과 서비스 이름을 F에 두고, 구현은 Cordis 서비스로 주입받는다.
- 예외 [결정: review.decisions-2 U-15·U-16·U-17]:
  1. F(`contracts`)는 공유 커널이다. 모든 패키지가 import한다.
  2. 조립 루트 `apps/host`는 플러그인을 등록하려고 모든 패키지를 import한다. `apps/cli`는 엔진 조립 코드를 `apps/host`에서 가져온다(DR-10, 허용 목록 `DR-10/cli-host`).
  3. 테스트 파일(DR-08의 정의: `src/**/*.test.ts`, `test/**`)만 다른 컨텍스트 패키지의 `testing` 서브패스를 import한다. 공용 가짜가 L0 인터페이스 구현이기 때문이다(`eng.testing.guide` TS-05, TS-07). 패키지의 `src/testing/**` 소스는 이 예외에 들지 않는다.
  4. X 위의 패키지(L0~L4, `plugins/*`)는 `@xeon/ext-host`를 import할 수 있다. 쓸 수 있는 것은 서비스 등록·주입 API(`ExtHost.registerPlatform`, `PlatformModule`, `hostOf`, 포트 제공 등 `X.primitives.spec` §3.2가 공개한 이름)뿐이다. 확장 지점 디스패치와 4연산은 F 타입(DR-12)으로 쓴다.
  5. 4절 허용 목록의 `DR-02/group-kit` 항목은 DR-14도 허용한 것으로 본다.

이유:

- L0 구현은 OS마다, L2 능력은 provider마다 바뀐다. 소비자가 구현 패키지를 import하면 교체한 패키지가 원래 export 모양을 흉내 내야 한다. F 정의와 서비스 주입이면 F 계약만 맞추면 된다(DR-02와 같은 이유).
- OS·환경별 구현만 바꾸는 설계 규칙(`_research/decisions-log.md` 2026-10-19 설계 규칙)을 하위 층 구현 패키지에도 적용한다.

좋은 예:

```ts
// packages/core-persistence/src/plugin.ts  (L1, 컨텍스트 session-core)
import { StoreServiceName, type StoreService } from "@xeon/contracts";
export const inject: readonly string[] = [StoreServiceName];   // platform-store 구현은 주입받는다
```

나쁜 예:

```ts
// packages/core-persistence/src/open.ts  (L1, 컨텍스트 session-core)
import { openEventStore } from "@xeon/platform-store";   // DR-14: 컨텍스트 platform-store의 구현 import
```

```ts
// packages/group-helm/src/inject.ts  (L3, 컨텍스트 helm)
import { openStore } from "@xeon/platform-store";        // DR-14: 확장이 저장소 구현을 직접 연다
```

## 3. 강제 수단

### 3.1 도구별 역할

| 도구 | 버전 | 검사하는 것 | 실행 |
|---|---|---|---|
| `scripts/check-layers.ts` | 저장소 코드 | `package.json`의 `xeon` 필드와 의존 목록, 소스 import 문자열 스캔(정규식), 상대 경로 이탈, 외부 모듈 소유표, 테스트 전용 모듈 위치, OS 분기 표현, 허용 목록 | `just check-layers` |
| dependency-cruiser | 18.7.0 | 경로 기반 층 순위 `forbidden` 규칙, 동층 금지, 순환, vendor/cordis 접근, 선언되지 않은 npm 의존 | `just depcruise` |
| oxlint | 1.89.0 | `no-restricted-imports`(깊은 import, 금지 모듈, 소유 모듈), `import/no-cycle`(파일 순환), `no-restricted-globals` | `just lint` |
| `tsc -b` | TypeScript 7.0.2 | 프로젝트 참조 순환, 참조 누락으로 인한 타입 해석 실패 | `just typecheck` |
| knip | 6.42.1 | 선언했지만 쓰지 않는 의존, 쓰지 않는 export와 파일 | `just knip` |

- oxlint 1.89에는 `no-restricted-paths`와 `no-restricted-syntax`가 없다(`_research/notes/eng-1.md §1`, §2 표). 디렉터리 방향 규칙과 구문 패턴 금지는 `check-layers.ts`와 dependency-cruiser가 맡는다.
- TS 7.0에는 안정 programmatic API가 없다(`_research/stack-status.md §2`). `check-layers.ts`는 TypeScript API 없이 정규식으로 import 지정자를 뽑는다(현재 `extractSpecifiers()`). dependency-cruiser는 `@swc/core` 파서를 쓴다(현재 `.dependency-cruiser.cjs`의 `parser: "swc"`).
- [제안] `check-layers.ts`에 더할 검사: `domain` 값(DR-03), `tsconfig.json` `references` 일치(DR-04), `MODULE_OWNERS` 표(DR-07), 테스트 전용 모듈 위치(DR-08), 배포 제외(DR-09), OS 분기 표현(DR-13), 컨텍스트 사이 import(DR-14, `CONTEXTS` 표를 읽는다. M1부터), 허용 목록 읽기(4절), 출력 형식(1.2절).
- [제안] `MODULE_OWNERS`는 `check-layers.ts`가 export하는 상수다. 2절 DR-07 표를 코드로 옮긴 것이고, 이 표를 바꿀 때는 이 문서와 `check-layers.ts`를 같은 커밋에서 고친다.

```ts
// xeon/scripts/check-layers.ts (추가분 개요)
export interface ModuleOwner {
  /** 외부 모듈 지정자. 끝이 "/*"이면 접두사 일치 */
  readonly module: string;
  /** 소유 패키지 디렉터리(xeon 루트 기준). 빈 배열이면 전부 금지 */
  readonly owners: readonly string[];
  readonly rule: "DR-07" | "DR-11";
}
export const MODULE_OWNERS: readonly ModuleOwner[] = [
  { module: "bun:sqlite", owners: ["packages/platform-store"], rule: "DR-07" },
  { module: "better-sqlite3", owners: [], rule: "DR-07" },
  { module: "@earendil-works/pi-ai", owners: ["packages/core-models"], rule: "DR-07" },
  { module: "@earendil-works/pi-agent-core", owners: [], rule: "DR-07" },   // adr.0009: 전부 금지
  { module: "playwright-core", owners: ["packages/cap-web"], rule: "DR-07" },
  { module: "cordis", owners: ["packages/ext-host"], rule: "DR-11" },
  // … DR-07 표 전체
];
/** 소스 문자열에서 찾는 호출 패턴. 지정자가 아닌 실행 호출(sops 등)과 OS 분기 표현을 잡는다 */
export interface SourcePattern {
  readonly pattern: RegExp;
  readonly owners: readonly string[];   // 접두사 일치하는 패키지 디렉터리
  readonly rule: "DR-07" | "DR-13" | "WEB-R16";
  readonly message: string;
}
```

- 구현된 `SourcePattern`(`check-layers.ts`)은 `owners` 대신 검사 대상 디렉터리 `dir`을 가진다. 지금 등록된 규칙은 WEB-R16 하나이고 대상은 `packages/cap-web/src/fetch/convert`다. 이 디렉터리의 소스(테스트 제외)에서 `fetch(`·`WebSocket(`·`EventSource(`·`XMLHttpRequest(` 호출, `Bun.` 접근, `new WebSocket`·`new EventSource`·`new XMLHttpRequest`를 찾으면 `WEB-R16`으로 실패한다. import 금지는 oxlint override가 맡는다.

### 3.2 규칙과 도구 행렬

○는 그 도구가 위반을 실패로 만든다는 뜻이다. △는 일부만 잡는다는 뜻이다.

| 규칙 | check-layers | depcruise | oxlint | tsc -b | knip | 리뷰 |
|---|---|---|---|---|---|---|
| DR-01 하향만 | ○ `package.json`과 import | ○ 경로 규칙 | | △ 참조 순환일 때 | | |
| DR-02 동층 금지 | ○ | ○ | | | | |
| DR-03 `xeon` 필드 | ○ | | | | | |
| DR-04 선언·references | ○ | ○ `npm-no-pkg`, `npm-unknown` | | △ 참조 누락 시 타입 오류 | ○ 미사용 의존 | |
| DR-05 exports만 | ○ 상대 경로 이탈 | △ `exportsFields` 해석 실패 | ○ `no-restricted-imports` 패턴 | △ 해석 실패 | | |
| DR-06 순환 금지 | △ 패키지 그래프 [제안] | ○ `no-circular` | ○ `import/no-cycle`(값 import) | ○ 참조 순환 | | |
| DR-07 외부 모듈 소유 | ○ `MODULE_OWNERS`, 호출 패턴 [제안] | | ○ `no-restricted-imports` + `overrides` | | | |
| DR-08 테스트 전용 | ○ 파일 위치 [제안] | | △ `bun:test` 금지 패턴(운영 파일) | | ○ devDependencies 오용 | |
| DR-09 플러그인 import·배포 제외 | ○ 허용 import, 배포 의존 [제안] | ○ 동층 금지(L1) | | | | ○ 릴리즈 빌드 목록 |
| DR-10 앱끼리 | ○ | ○ `DR-02-no-same-layer-import-L4` | | | | |
| DR-11 cordis는 ext-host | ○ `MODULE_OWNERS` | ○ `DR-11-cordis-only-in-ext-host` | ○ 현재 패턴 | | | |
| DR-12 확장 지점 선언 | △ 지점 선언 함수 이름이 정해지면 스캔 [제안] | | | | | ○ |
| DR-13 OS 분기 | ○ 호출 패턴 [제안] | | △ `no-restricted-globals`로는 `process` 전체만 막을 수 있다 | | | ○ |
| DR-14 컨텍스트 사이 | ○ `CONTEXTS` 대조 [제안, M1부터] | | | | | ○ |

- oxlint `overrides`로 소유 패키지만 `no-restricted-imports`를 다르게 둘 때, override의 옵션은 기본 설정의 패턴 목록을 대체한다 [가정: 병합하지 않는다고 보고 쓴다]. 그래서 소유 패키지용 override에도 나머지 금지 패턴을 다시 적는다. 이 중복이 틀리기 쉬우므로 DR-07의 1차 강제는 `check-layers.ts`로 두고 oxlint는 편집기 안 즉시 피드백 용도로 둔다 [제안].
- [미결] oxlint에 `no-restricted-paths`가 없을 때의 보완: 현재 안은 `check-layers.ts`의 정규식 스캔과 dependency-cruiser 경로 규칙의 이중 검사다. 정규식 스캔은 문자열 안의 `import` 같은 오탐이 생길 수 있다(`_research/notes/eng-1.md §7` 마지막 항목). 별도 파서 패키지를 더할지, Bun 내장 트랜스파일러(`Bun.Transpiler#scanImports`)로 바꿀지 구현 단계에서 정한다. `Bun.Transpiler`로 노드 수준 검출이 되는지는 확인하지 않았다.

### 3.3 06 §3.5 R1~R16 번역표

기존 Helm 설계(`docs/design/06-system-architecture.md §3.5.1`)는 pnpm, ESLint, Node, TypeScript 컴파일러 API를 전제한다. Xeon은 Bun workspaces, oxlint, Bun, 정규식 스캔을 쓴다.

| 06 규칙 | 내용 요약 | 처리 | Xeon 규칙 | 도구 번역 |
|---|---|---|---|---|
| R1 | 워크스페이스 의존은 허용 표의 부분집합 | 대체 | DR-01, DR-02, DR-04 | 패키지별 허용 표 대신 순위 비교. `architecture-rules.ts` → `check-layers.ts`의 `RANK` |
| R2 | 하위 경로 제한(`store/write` 등) | 대체 | DR-05, DR-02 | 같은 층 협력은 서비스로 하므로 하위 경로로 쓰기 권한을 나누지 않는다. 필요해지면 해당 spec이 `exports` 서브패스와 허용 목록을 정한다 |
| R3 | `testing` 하위 경로는 dev·테스트 파일만 | 채택 | DR-08 | `check-layers.ts`의 파일 위치 검사 |
| R4 | 순수 패키지는 `node:*`·Node 전역 금지 | 채택(F 한정) | DR-07 마지막 행 | ESLint `no-restricted-imports`·`no-restricted-globals` → oxlint 같은 이름 규칙(1.89에 있음) |
| R5 | 커널은 시각·난수·타이머 금지 | 대체 | `eng.testing.guide` TS-03, `eng.typescript.guide` | 커널이 없다. 결정성은 주입으로 확보한다. ESLint `no-restricted-syntax`는 oxlint에 없으므로 필요하면 `check-layers.ts` 패턴으로 옮긴다 |
| R6 | 외부 모듈 소유 | 채택 | DR-07 | 소유표를 Xeon 패키지로 다시 쓴다. `better-sqlite3` → `bun:sqlite` |
| R7 | pi 코드 소유 | 채택 | DR-07(pi-ai, durable env 포크 행. agent-core는 adr.0009로 전부 금지) | 07 §3.9.1 표 대신 DR-07 표 |
| R8 | 런타임 어댑터 폴더 제한 | 폐기 | — | Xeon에 외부 런타임 어댑터 구조가 없다 |
| R9 | 깊은 import 금지 | 채택 | DR-05 | pnpm `exports` 해석 거부 → Bun도 `exports`를 따르지만 상대 경로 이탈은 막지 않으므로 `check-layers.ts` `relative-escape`와 oxlint 패턴을 둔다 |
| R10 | 패키지 순환 금지 | 채택 | DR-06 | `tsc -b` 참조 순환 + depcruise `no-circular` + oxlint `import/no-cycle` |
| R11 | `references` = 워크스페이스 의존 | 채택 | DR-04 | `check-layers.ts` 검사로 옮긴다 [제안] |
| R12 | 앱은 커널·엔진·데몬 금지 | 대체 | DR-01, DR-10 | 순위 규칙이 같은 효과를 낸다 |
| R13 | 이벤트 append는 엔진만 | 대체 | DR-07(`bun:sqlite` 소유) + `eng.transactions.design` | 쓰기 경로 규칙은 트랜잭션 문서가 소유한다 |
| R14 | 데스크톱 앱 안 층(`import/no-restricted-paths`) | 대체 | `L4.desktop.spec`에서 정한다 | oxlint에 `no-restricted-paths`가 없다. 필요하면 `check-layers.ts`에 앱 내부 경로 규칙을 더한다 |
| R15 | 관찰 프로세스 fs 감싸개 | 폐기 | — | 관찰 프로세스가 없다 |
| R16 | 웹 변환 작업자 네트워크 금지 | 대체 | WEB-R16(`L2.web.spec` §4.9.3) | `.oxlintrc.json`의 `packages/cap-web/src/fetch/convert/**` override(`no-restricted-imports`, `no-restricted-globals`)와 `check-layers.ts`의 `SOURCE_PATTERNS`(`rule: "WEB-R16"`)가 함께 강제한다 |

도구 전제의 번역:

| 06 전제 | Xeon |
|---|---|
| pnpm 11, `pnpm-workspace.yaml`, 엄격한 `node_modules` | Bun 1.4.3 workspaces(`package.json`의 `workspaces`), catalog. 선언 안 된 import는 검사로 막는다(DR-04) |
| ESLint flat config, typescript-eslint `strictTypeChecked` | oxlint 1.89.0 + oxlint-tsgolint 7.0.2004(type-aware) |
| ESLint `no-restricted-syntax`, `no-restricted-properties`, `import/no-restricted-paths` | 1.89에 없다. `check-layers.ts` 패턴 스캔과 dependency-cruiser로 옮긴다 |
| `ts.preProcessFile`로 import 추출 | TS 7.0에 API가 없다. 정규식 추출(현재) [미결: 파서 교체] |
| Node 24 타입 제거 실행 | `bun scripts/check-layers.ts` |
| `scripts/check-architecture.ts` + `architecture-rules.ts` | `scripts/check-layers.ts` 한 파일(`RANK`, `MODULE_OWNERS`) |

## 4. 예외와 승인 절차

[제안] 예외는 두 곳 중 한 곳에만 기록한다.

1. 규칙 자체를 바꾸는 예외(순위 변경, 소유표 변경, 새 층): ADR(`docs/xeon/decisions/ADR-NNNN-*.md`)을 쓰고 이 문서를 같은 커밋에서 고친다.
2. 특정 import 한 쌍의 예외: 허용 목록 파일 `xeon/scripts/dependency-allowlist.json` 한 곳에 둔다. 코드 주석이나 도구별 설정(oxlint `overrides`, depcruise `pathNot`)에 예외를 따로 적지 않는다. 도구 설정은 허용 목록에서 생성하거나 같은 커밋에서 맞춘다.

```ts
// xeon/scripts/check-layers.ts가 읽는 허용 목록 형식
import { Type, type Static } from "typebox";

export const AllowEntry = Type.Object({
  /** "<규칙ID>/<이름>" 꼴. 예: "DR-02/group-kit", "TS-05/<모듈 이름>" */
  id: Type.String({ pattern: "^(?:DR|TS)-\\d{2}/[a-z0-9-]+$" }),
  rule: Type.String({ pattern: "^(?:DR|TS)-\\d{2}$" }),
  /** 예외가 적용되는 import 쪽 패키지 디렉터리. 끝에 `*`가 붙으면 `packages/group-*`처럼 가족 패턴이다(마지막 이름 한 단계) */
  from: Type.String(),
  /** 허용하는 대상: 워크스페이스 패키지 이름 또는 외부 모듈 지정자 */
  to: Type.String(),
  /** 대상 안에서 허용하는 진입점. 생략하면 "." 하나 */
  entries: Type.Optional(Type.Array(Type.String())),
  reason: Type.String({ minLength: 10 }),
  /** 근거 문서 id 또는 ADR id */
  approvedBy: Type.String(),
  /** "test"이면 from 패키지의 테스트 파일(test/**, *.test.ts)에서만 허용한다. 운영 소스의 같은 import는 위반이다 */
  scope: Type.Optional(Type.Literal("test")),
});
export type AllowEntry = Static<typeof AllowEntry>;
export const AllowList = Type.Array(AllowEntry);
```

```json
[
  {
    "id": "DR-02/group-kit",
    "rule": "DR-02",
    "from": "packages/group-*",
    "to": "@xeon/group-kit",
    "entries": [".", "./testing"],
    "reason": "Every L3 group uses the shared group definition helpers of group-kit through its entries \".\" and \"./testing\" only (review.decisions-2 U-15).",
    "approvedBy": "review.decisions-2"
  },
  {
    "id": "DR-10/cli-host",
    "rule": "DR-10",
    "from": "apps/cli",
    "to": "@xeon/host",
    "entries": [".", "./client"],
    "reason": "The CLI reuses the single engine assembly code in apps/host (review.decisions-2 U-15).",
    "approvedBy": "review.decisions-2"
  },
  {
    "id": "DR-10/cli-client",
    "rule": "DR-10",
    "from": "apps/cli",
    "to": "@xeon/client",
    "entries": ["."],
    "reason": "Clients share host connection code, settings view-models and message catalogs in packages/client (adr.0020).",
    "approvedBy": "adr.0020"
  },
  {
    "id": "DR-10/desktop-client",
    "rule": "DR-10",
    "from": "apps/desktop",
    "to": "@xeon/client",
    "entries": [".", "./stdio", "./settings"],
    "reason": "Clients share host connection code, settings view-models and message catalogs in packages/client (adr.0020).",
    "approvedBy": "adr.0020"
  },
  {
    "id": "DR-10/host-client",
    "rule": "DR-10",
    "from": "apps/host",
    "to": "@xeon/client",
    "entries": ["."],
    "reason": "apps/host keeps the @xeon/host/client re-export and its tests drive the host through the client connection (adr.0020; open: adr.0020 section 3.5 says host does not import client).",
    "approvedBy": "adr.0020"
  },
  {
    "id": "DR-07/cli-test-spawn",
    "rule": "DR-07",
    "from": "apps/cli",
    "to": "Bun.spawn",
    "reason": "CLI scenario tests run the real xeon process and kill it to check resume (review.decisions-2 B-06).",
    "approvedBy": "review.decisions-2",
    "scope": "test"
  }
]
```

- 위 다섯 항목(DR-02 하나, DR-10 넷. `DR-10/*-client` 셋은 [결정: adr.0020]으로 더했다)과 테스트 한정 `DR-07/*-test-spawn` 항목이 이 문서가 미리 승인하는 예외의 전부다. `plugins/*`의 같은 층 예외는 두지 않는다([결정: review.decisions-2 U-16]).
- 테스트 한정 프로세스 실행 [결정: review.decisions-2 B-06]: `scope: "test"`, `rule: "DR-07"`, `to: "Bun.spawn"`(같은 항목이 `Bun.spawnSync`, `node:child_process`도 덮는다) 항목을 미리 승인한다. 대상 패키지는 `apps/cli`(`DR-07/cli-test-spawn`), `packages/core-persistence`(`DR-07/persistence-test-spawn`), `packages/cap-workspace`(`DR-07/workspace-test-spawn`, `test/fork-records.test.ts`), `apps/desktop`(`DR-07/desktop-test-spawn`, `L4.desktop.plan` D1)이다. 위 JSON은 그중 하나만 보인다. L0 소유 패키지(`platform-*`)는 원래 소유자라 항목이 필요 없다. `check-layers.ts`는 `scope: "test"` 항목을 테스트 파일에만 적용하고, 같은 패키지의 `src/**`에서 쓰면 `DR-07`로 실패한다. 검사는 `Bun.spawn`·`Bun.spawnSync` 호출과 `node:child_process` import를 주석을 뺀 소스에서 찾는다. 운영 소스는 소유 표의 다섯 패키지(`platform-exec`, `platform-process`, `platform-sandbox`, `platform-secrets`, `platform-os`)만 쓴다. 테스트 파일은 모든 `platform-*` 패키지와 항목이 있는 패키지만 쓴다(`platform-store` 테스트 보조 파일이 자식 프로세스로 잠금을 시험하기 때문이다) [구현: review.decisions-2 B-06].
- `TS-NN` 항목은 `eng.testing.guide` TS-05의 `mock.module` 예외를 같은 파일에 기록하는 형식이다. `from`은 테스트 파일이 있는 패키지 디렉터리, `to`는 바꾸는 외부 npm 모듈 지정자다. 미리 승인한 `TS-05` 항목은 없다.
- 새 항목을 더하는 절차:
  1. 작업자는 항목을 더하지 않고 `[미결]`로 보고한다.
  2. 사람이 승인하면 `approvedBy`에 ADR id 또는 근거 문서 id를 적고 같은 커밋에 넣는다.
  3. 리뷰는 허용 목록 diff를 따로 확인한다.
- 줄 단위 `// oxlint-disable-next-line`으로 DR 규칙을 끄지 않는다. 쓰지 않는 disable 주석은 `reportUnusedDisableDirectives: "error"`로 실패한다(`_research/notes/eng-1.md §4`).

## 5. 수용 기준

[제안] 다음 다섯 가지 위반 샘플을 각각 하나씩 넣으면 `just verify`가 종료코드 1로 실패하고, 출력에 괄호 안의 규칙 ID가 나온다. 확인한 뒤 샘플을 지운다(`_research/foundation-plan.md §6` 코드 검사).

| # | 샘플 | 넣는 곳 | 기대 실패 단계와 규칙 ID |
|---|---|---|---|
| 1 | 상향: `import type { X } from "@xeon/cap-web";` | `packages/core-loop/src/index.ts`, `package.json`에 의존 추가 | check-layers `DR-01`, depcruise `DR-01-no-upward-import-from-L1` |
| 2 | 동층: `import { y } from "@xeon/core-models";` | `packages/core-loop/src/index.ts`, `package.json`에 의존 추가 | check-layers `DR-02`, depcruise `DR-02-no-same-layer-import-L1-core` |
| 3 | 깊은 경로: `import { z } from "@xeon/platform-store/src/index.ts";` | `packages/core-loop/src/index.ts` | oxlint 메시지 `DR-05: ...`, check-layers `DR-05` |
| 4 | 순환: `a.ts` ↔ `b.ts` 값 import | `packages/core-loop/src/` | oxlint `import/no-cycle`(메시지에 ID 없음), depcruise `DR-06-no-circular` |
| 5 | 소유 모듈 위반: `import { Database } from "bun:sqlite";` | `packages/core-loop/src/index.ts` | check-layers `DR-07`, oxlint 메시지 `DR-07: ...` |

- 4번에서 oxlint `import/no-cycle`은 메시지를 바꿀 수 없으므로 규칙 ID는 depcruise 출력으로 확인한다.
- 이 다섯 경우는 `xeon/scripts/check-layers.test.ts`에 가짜 워크스페이스 픽스처로도 둔다. `just verify`의 `bun test scripts` 단계가 매번 다시 확인한다.
- 현재 상태와의 차이(구현 작업으로 넘긴다):
  - `check-layers.ts`의 출력이 1.2절 형식(DR ID, 행 번호)이 아니다.
  - depcruise 규칙 이름과 oxlint 메시지에 DR ID가 없다.
  - `MODULE_OWNERS`, 허용 목록, `domain` 검사, `references` 검사가 없다.
  - 컨텍스트 사이 import 검사(DR-14)가 없다. M1에서 `CONTEXTS` 상수와 함께 더한다(`eng.context-map.design` 6절 마일스톤).

## 6. 미결 사항

- [결정: review.decisions-2 U-14] X를 L0 아래(순위 1)에 두는 순위는 유지한다. 1.1절의 세 조건을 지킨다.
- [미결] oxlint에 `no-restricted-paths`가 없을 때의 보완 방식. 현재는 `check-layers.ts` 정규식 스캔 + dependency-cruiser 경로 규칙이다. 파서 교체(별도 패키지 또는 `Bun.Transpiler`) 여부를 구현 단계에서 정한다(`_research/notes/eng-1.md §7`).
- [미결] 타입 전용 순환(`import type` 순환)의 허용 여부. oxlint 기본값은 허용, depcruise 현재 설정은 금지다.
- [결정: review.decisions-2 U-15] `group-kit`은 L3 안의 공용 기반으로 두고 허용 목록 `DR-02/group-kit`(`from`은 `packages/group-*`)로 허용한다. 엔진 조립 코드는 `apps/host`에 두고 `apps/cli` → `apps/host`를 `DR-10/cli-host`로 허용한다.
- [결정: review.decisions-2 U-16] `plugins/*`는 L1 순위이고 `core-*`를 import하지 않는다. 같은 층 예외는 두지 않는다(DR-09).
