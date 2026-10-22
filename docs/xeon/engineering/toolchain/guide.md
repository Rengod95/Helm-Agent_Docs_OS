---
id: eng.toolchain.guide
layer: eng
domain: toolchain
kind: guide
status: draft
depends_on: [eng.dependency-rules.guide]
binds: [xeon/package.json, xeon/bunfig.toml, xeon/turbo.json, xeon/tsconfig.base.json, xeon/.oxlintrc.json, xeon/.oxfmtrc.json, xeon/lefthook.yml, xeon/justfile, .github/workflows/xeon-ci.yml]
---

# 툴체인 가이드

Xeon 워크스페이스의 런타임, 패키지 관리, 타입 검사, 린트, 포맷, 테스트 실행기, 태스크 러너, CI를 정한다. 규칙마다 ID(`TC-NN`)를 붙인다. 의존 방향 규칙(`DR-NN`)은 `eng.dependency-rules.guide`, 테스트 작성 규칙(`TS-NN`)은 `eng.testing.guide`가 정한다.

## 1. 적용 범위

- 대상 파일: `xeon/package.json`(workspaces, catalog, 루트 scripts), `xeon/bunfig.toml`, `xeon/turbo.json`, `xeon/tsconfig.base.json`과 각 패키지 `tsconfig.json`, `xeon/.oxlintrc.json`, `xeon/.oxfmtrc.json`, `xeon/knip.json`, `xeon/.dependency-cruiser.cjs`, `xeon/lefthook.yml`(루트 `lefthook.yml`이 extends), `xeon/justfile`(루트 `justfile`이 `cd xeon && just <레시피>`로 부른다), `xeon/mise.toml`, `.github/workflows/xeon-ci.yml`.
- 대상 작업: 도구 추가·갱신, 버전 변경, 검사 단계 변경, CI 변경, 새 패키지 생성(설정 파일 복사).
- 이 문서가 다루지 않는 것:
  - 타입 금지 구문의 규칙 본문은 `eng.typescript.guide`. 여기서는 그 규칙을 켜는 oxlint·tsconfig 설정 위치만 적는다.
  - 테스트 계층, 가짜, 결정성 규칙은 `eng.testing.guide`.

### 1.1 스택과 정확 버전

[결정] `_research/foundation-plan.md §2`(스택 표, "승인 = 컨펌"), adr.0001. 버전 값은 2026-10-21 `xeon/package.json` catalog와 `xeon/mise.toml`에서 옮겼다.

| 영역 | 도구 | 고정 버전 | 고정 위치 | 비고 |
|---|---|---|---|---|
| 런타임·패키지 관리 | Bun | 1.4.3 | `package.json` `packageManager: "bun@1.4.3"`, `mise.toml` `bun = "1.4.3"` | workspaces + catalog |
| 타입 검사 | TypeScript(`tsc` = tsgo) | 7.0.2 | catalog `typescript` | strict + TC-08 옵션 |
| 린트 | oxlint | 1.89.0 | catalog `oxlint` | `--type-aware` |
| 린트 타입 인식 | oxlint-tsgolint | 7.0.2004 | catalog `oxlint-tsgolint` | TS 7.0.2 대응(TC-03) |
| 포맷 | oxfmt | 0.74.0 | catalog `oxfmt` | 0.x라 정확 고정 |
| 테스트 | `bun test` | Bun과 같음 | — | 패키지별 실행, `--coverage` |
| 태스크 러너 | Turborepo | 2.11.10 | catalog `turbo` | `--affected`, 로컬 캐시 |
| 의존 경계 | dependency-cruiser | 18.7.0 | catalog `dependency-cruiser` | 파서 `@swc/core` 1.16.18 |
| 미사용 코드 | knip | 6.42.1 | catalog `knip` | |
| 공개 패키지 검사 | publint, @arethetypeswrong/cli(attw) | 0.3.25, 0.18.5 | 공개 패키지가 생길 때 catalog에 더한다 | 공개 패키지만 |
| 공개 라이브러리 빌드 | tsdown | 0.23.1 | 공개 패키지가 생길 때 catalog에 더한다 | 공개 라이브러리만 |
| 바이너리 | `bun build --compile` | Bun과 같음 | — | `apps/cli`, `apps/host`(사이드카) |
| 스키마 | typebox | 1.3.27 | catalog `typebox` | pi-ai 1.3.0이 고정한 판과 같다(review.decisions-2 U-24). pi가 올릴 때 함께 올린다 |
| Bun 타입 | @types/bun | 1.4.3 | catalog `@types/bun` | Bun 버전과 같은 값 |
| 모델 provider | @earendil-works/pi-ai | 1.3.0 | catalog `@earendil-works/pi-ai` | 정확 고정(review.decisions-2 U-24). typebox 판을 함께 맞춘다 |
| OS 샌드박스 | @anthropic-ai/sandbox-runtime | 0.0.79 | catalog `@anthropic-ai/sandbox-runtime` | 0.x라 정확 고정(review.decisions-2 U-24). 올릴 때는 `L0.sandbox.plan` 업그레이드 점검을 거친다 |
| 레시피 | just | 1.58.0 | CI `extractions/setup-just` | 로컬 버전은 [미결] |
| 훅 | lefthook, gitleaks | [미결] | `mise.toml`에 더한다 [제안] | 현재 고정 위치 없음 |

- publint·attw·tsdown은 지금 catalog에 없다. 현재 모든 패키지가 `"private": true`이므로 들일 이유가 없다. 첫 공개 패키지를 만드는 변경에서 catalog와 `just verify`에 함께 더한다(TC-04 절차).
- Vitest는 쓰지 않는다. Vitest는 Node 위에서 돌아 `bun:sqlite` 같은 Bun API를 쓰는 테스트를 실행하지 못한다(`_research/foundation-plan.md §2` 테스트 행). Jest, ESLint, Prettier, Biome, pnpm, Nx도 들이지 않는다.

## 2. 규칙

### TC-01 버전은 정확히 고정한다

[결정] `_research/foundation-plan.md §2` "정확 버전 고정".

- `^`, `~`, `>=`, `*`, `latest`, 태그 이름을 버전 값으로 쓰지 않는다.
- `bunfig.toml`의 `[install] exact = true`를 유지한다. `bun add`가 `^`를 붙이지 않게 한다.
- 잠금 파일 `bun.lock`(텍스트, `saveTextLockfile = true`)을 커밋한다. 설치는 `just setup`(`bun install --frozen-lockfile`)으로만 한다.
- 런타임 버전은 `mise.toml`과 `packageManager`가 같은 값이어야 한다.

이유: 0.x 도구(oxfmt)와 버전 결합이 있는 도구(tsgolint ↔ TS)는 패치 업데이트에서도 출력이 바뀐다. 범위 버전이면 같은 커밋이 날짜에 따라 다르게 검사된다.

좋은 예:

```json
"catalog": { "oxfmt": "0.74.0", "typescript": "7.0.2" }
```

나쁜 예:

```json
"catalog": { "oxfmt": "^0.74.0", "typescript": "~7.0.2" }
```

### TC-02 버전은 루트 catalog 한 곳에서만 선언한다

[결정] `_research/foundation-plan.md §2`: Bun workspaces + catalog.

- 외부 의존의 버전 값은 `xeon/package.json`의 `"catalog"`에만 적는다.
- 패키지의 `package.json`은 외부 의존에 `"catalog:"`, 워크스페이스 의존에 `"workspace:*"`만 쓴다.
- 한 외부 모듈의 두 버전을 동시에 쓰지 않는다. 필요하면 ADR로 이유를 남긴다.

이유: 패키지마다 버전을 적으면 한 저장소에 같은 라이브러리의 여러 판이 설치된다. 버전 올림이 파일 여러 개를 고치는 일이 되고, 한 곳을 빠뜨리기 쉽다.

좋은 예:

```json
// packages/core-models/package.json
"dependencies": { "@earendil-works/pi-ai": "catalog:", "@xeon/contracts": "workspace:*" }
```

나쁜 예:

```json
// packages/core-models/package.json
"dependencies": { "@earendil-works/pi-ai": "1.3.0" }
```

### TC-03 oxlint-tsgolint와 TypeScript 7.0.x는 함께 고정하고 함께 올린다

[결정] `_research/foundation-plan.md §7` 첫 항목: tsgolint는 TS 7.0.x에 묶여 있으므로 두 버전을 함께 고정한다.

- 현재 짝: `typescript` 7.0.2 ↔ `oxlint-tsgolint` 7.0.2004(태그 v7.0.2000이 TS 7.0.2 대응, `_research/stack-status.md §1-A`).
- 한쪽만 올리는 커밋을 만들지 않는다. 두 값을 같은 커밋에서 바꾸고 `just lint`가 type-aware 규칙을 실제로 돌렸는지 확인한다(위반 샘플 하나로 `typescript/no-floating-promises`가 실패하는지 본다).
- oxlint 자체(1.89.0)를 올릴 때도 tsgolint 호환 범위를 확인한다.

이유: 짝이 맞지 않으면 type-aware 규칙이 조용히 꺼지거나 tsgolint가 시작하지 못한다. 앞의 경우 검사는 통과하지만 규칙은 돌지 않는다.

좋은 예:

```diff
-    "typescript": "7.0.2",
-    "oxlint-tsgolint": "7.0.2004",
+    "typescript": "7.0.3",
+    "oxlint-tsgolint": "7.0.3001",
```

나쁜 예:

```diff
-    "typescript": "7.0.2",
+    "typescript": "7.0.3",
```

(위 diff의 새 버전 번호는 형식 예시다.)

### TC-04 새 도구는 승인 절차 없이 더하지 않는다

[제안]

- 1.1 표에 없는 개발 도구(린터, 포매터, 테스트 실행기, 번들러, 코드 생성기, 훅 관리자)를 더하려면:
  1. ADR을 쓴다. 기존 도구로 안 되는 이유, 버전, `just verify`에서의 위치, 실행 시간 추정을 적는다.
  2. 사람이 승인한다.
  3. catalog, 이 문서 1.1 표, `just verify` 표(3.1절), CI를 같은 커밋에서 바꾼다.
- oxlint JS 플러그인(alpha)은 쓰지 않는다(`_research/stack-status.md §1-C`).
- oxfmt에 문제가 생기면 그 파일만 `.oxfmtrc.json`의 `ignorePatterns`로 뺀다. Biome나 Prettier로 되돌리지 않는다(`_research/foundation-plan.md §2` 포맷 행). 뺀 파일과 이유는 `eng.dependency-rules.guide` 4절의 허용 목록과 같은 방식으로 한 곳에 기록한다: `.oxfmtrc.json`은 JSON이라 주석을 둘 수 없으므로 같은 커밋의 커밋 메시지와 이 문서 4절 "oxfmt 제외 목록"에 적는다.

이유: 도구가 늘면 `just verify` 시간과 버전 결합이 함께 늘어난다. 같은 일을 하는 도구가 두 개면 설정이 서로 어긋난다.

좋은 예:

```text
docs/xeon/decisions/ADR-0009-add-publint.md 작성 → 승인 → catalog "publint": "0.3.25" + justfile publint 레시피 + verify 단계 추가(한 커밋)
```

나쁜 예:

```json
"devDependencies": { "prettier": "3.6.2" }   // TC-04: 포맷은 oxfmt 하나
```

### TC-05 빌드 산출물을 커밋하지 않고, 내부 패키지는 TS 소스를 export한다

[결정] `_research/foundation-plan.md §2` 빌드 행.

- 내부 패키지(`"private": true`)의 `exports`는 `./src/*.ts`를 가리킨다. 다른 패키지는 빌드 없이 소스를 읽는다.
- `tsc -b`의 출력(`dist/`, `dist/.tsbuildinfo`, 선언 파일)은 타입 검사 캐시이며 런타임이 쓰지 않는다. `emitDeclarationOnly: true`로 JS를 내지 않는다.
- 커밋 금지: `dist/`, `.turbo/`, `coverage/`, `node_modules/`, `*.tsbuildinfo`, `bun build --compile` 산출 바이너리, `*.db`, `*.db-wal`, `*.db-shm`. 현재 `xeon/.gitignore`가 바이너리 출력 위치를 빼고 다 다룬다. 바이너리 출력 위치는 `apps/*/dist/`로 정해 같은 규칙에 넣는다 [제안].
- 공개 라이브러리만 tsdown 0.23으로 `dist/`를 만들고 `exports`가 `dist`를 가리킨다. 이 경우에도 `dist/`는 커밋하지 않고 배포 때 만든다.

이유: 산출물을 커밋하면 소스와 산출물이 어긋난 커밋이 생기고, diff 리뷰가 커진다. 내부 패키지에 빌드 단계가 없으면 편집 직후 다른 패키지가 바로 새 코드를 쓴다.

좋은 예:

```json
"exports": { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" }
```

나쁜 예:

```json
"exports": { ".": "./dist/index.js" }   // TC-05: 내부 패키지가 빌드 산출물을 가리킨다
```

### TC-06 Cordis는 `vendor/cordis`에 커밋 고정으로 두고 고치지 않는다

[결정] `_research/foundation-plan.md §2` DI·플러그인 행: Cordis 4.0.0-rc.x를 `xeon/vendor/cordis`에 커밋 고정으로 둔다. adr.0002.

- 출처 커밋과 버전은 `xeon/vendor/cordis/UPSTREAM.json`에 둔다.
- `vendor/cordis` 안 파일을 손으로 고치지 않는다. 갱신은 새 커밋의 파일을 통째로 다시 복사하고 `UPSTREAM.json`을 고친다. 이 작업은 사람 확인이 필요한 작업으로 본다(종료코드 3, 3.2절).
- `vendor/**`는 oxlint, oxfmt, check-layers 대상에서 뺀다. 현재 `.oxlintrc.json`과 `.oxfmtrc.json`의 `ignorePatterns`, `lefthook.yml`의 `exclude`에 있다.
- Cordis 동작을 바꿔야 하면 `ext-host` 안에서 감싼다(`eng.dependency-rules.guide` DR-11).

이유: rc 버전 API는 판마다 바뀐다. 손으로 고친 vendor 코드는 다음 갱신에서 고친 내용이 사라지거나 충돌한다.

좋은 예:

```json
// vendor/cordis/UPSTREAM.json
{ "repo": "https://github.com/cordiverse/cordis", "commit": "<40자 커밋>", "version": "4.0.0-rc.11" }
```

나쁜 예:

```ts
// vendor/cordis/src/fiber.ts 직접 수정
```

### TC-07 검사를 끄거나 우회하지 않는다

[제안] 사용자 전역 작업 규칙(`~/.claude/CLAUDE.md`: 검사가 실패하면 메시지에 적힌 대로 고친다. 검사를 끄거나 우회(`--no-verify`)하지 않는다)을 옮긴 것이다. `decisions-log`나 ADR 근거가 없으므로 [제안]으로 둔다.

- 금지: `git commit --no-verify`, lefthook 건너뛰기(`LEFTHOOK=0`), `just verify` 단계 삭제·약화, `.oxlintrc.json`의 규칙을 `"off"`로 바꾸기, `tsconfig`의 strict 옵션 끄기, 파일 전체 disable 주석(`/* oxlint-disable */`), `// @ts-ignore`, `// @ts-nocheck`.
- 줄 단위 disable은 `eng.typescript.guide` 4.1절 형식만 쓴다: `// oxlint-disable-next-line <규칙> -- <이유> (<이슈 URL>)`. 구속 문서가 미리 허용한 예외는 이슈 URL 대신 `(<문서 id> <규칙 ID>)`를 쓴다. `-- <이유>` 접미는 oxlint 1.89에서 억제가 적용됨을 프로브로 확인했다(`eng.typescript.guide` 4.1절, `_research/notes/eng-1.md §4`). 형식은 스캔 `xeon/directive-format`이 검사한다. 쓰지 않는 disable 주석은 `options.reportUnusedDisableDirectives: "error"`로 실패한다.
- `// @ts-expect-error`는 테스트 파일에서만 이유를 달아 쓴다. 운영 코드에서는 `typescript/ban-ts-comment`가 `ts-expect-error: true`로 막는다(`eng.typescript.guide` TY-08, 3.1.1절). 이유 형식은 스캔 `xeon/directive-format`이 검사한다.
- typed programming 안티패턴(`as` 단언, `!`, `any`, ts 억제 주석, 삼킨 `catch`)을 막는 oxlint 규칙 목록의 정본은 `eng.typescript.guide` 3.1.1절이다. `.oxlintrc.json`은 그 목록을 모두 담는다.
- 패키지 `tsconfig.json`은 `tsconfig.base.json`을 extends하고 TC-08 옵션을 덮어쓰지 않는다.
- `verify`에서 단계를 빼거나 약하게 바꾸려면 사람 확인을 받는다(루트 `justfile` 머리 주석 5번).

이유: 꺼 둔 검사는 다시 켜기 어렵고, 한 번 우회한 커밋 뒤의 커밋은 모두 검사 결과를 믿을 수 없다.

좋은 예:

```ts
// oxlint-disable-next-line typescript/no-floating-promises -- Cordis dispose 콜백은 동기 반환만 받음 (https://github.com/<owner>/<repo>/issues/31)
ctx.on("dispose", () => { flushLater(); });
```

나쁜 예:

```ts
/* oxlint-disable */                // TC-07: 파일 전체 끄기
```

```bash
git commit --no-verify -m "wip"     # TC-07
```

### TC-08 tsconfig 옵션은 기반 파일 하나에서 정한다

[결정] `_research/foundation-plan.md §2` 언어·타입 검사 행: strict, `isolatedDeclarations`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.

- 이 옵션들과 현재 `tsconfig.base.json`의 나머지 옵션(`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `composite`, `declaration`, `emitDeclarationOnly`, `types: ["bun"]`)은 `xeon/tsconfig.base.json` 한 곳에 둔다.
- 패키지 `tsconfig.json`이 두는 것: `extends`, `rootDir`, `outDir`, `tsBuildInfoFile`, `include`, `references`. 그 밖의 `compilerOptions`를 두지 않는다.
- 루트 `xeon/tsconfig.json`은 모든 패키지를 `references`로 묶는 솔루션 파일이다. `tsc -b`가 이 파일로 전체를 검사한다. TS 7.0.2의 `tsc -b`와 project references 동작은 소규모 솔루션에서 확인했다(`_research/notes/eng-1.md §5`).
- TS 7.0에는 안정 programmatic API가 없다. TS API에 기대는 도구(typescript-eslint, `ts.preProcessFile`을 쓰는 스크립트)를 들이지 않는다(`_research/stack-status.md §2`).
- [미결] `isolatedDeclarations`를 모든 패키지에 둘지, 공개 패키지에만 둘지. TypeBox 스키마 export에 명시 타입이 필요하다(`_research/notes/eng-2.md`, TS9010). 결정 전까지 현재 설정(전체 적용)을 유지한다.

이유: 패키지마다 옵션이 다르면 같은 코드가 패키지에 따라 다르게 검사되고, 패키지 사이로 코드를 옮길 때 오류가 새로 생긴다.

좋은 예:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src", "test"],
  "references": [{ "path": "../contracts" }]
}
```

나쁜 예:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": false, "noUncheckedIndexedAccess": false } }
```

### TC-09 명령은 just 레시피로 실행한다

[제안] 사용자 전역 작업 규칙(`~/.claude/CLAUDE.md`: 실행·빌드·검증·비밀은 justfile 레시피로 한다)을 옮긴 것이다. `decisions-log`나 ADR 근거가 없으므로 [제안]으로 둔다.

- 도구를 직접 부르지 않고 `just <레시피>`로 부른다. 레시피는 `mise exec -- bun`으로 고정 버전 Bun을 쓴다.
- 레시피는 10줄 이하로 둔다. 길면 `xeon/scripts/*.sh`로 뺀다(`xeon/justfile` 머리 주석).
- 앱 스크립트(`package.json` scripts)를 바꾸면 그것을 부르는 레시피도 같은 커밋에서 고친다(루트 `justfile` 머리 주석 6번).
- 레시피 목록은 `just --list`로 본다. 환경 상태는 `just status`, `ws help`로 본다.

이유: 전역에 설치된 다른 버전의 bun이나 tsc가 쓰이면 로컬과 CI 결과가 달라진다. 레시피 하나가 로컬, 훅, CI에서 같은 명령을 부른다.

좋은 예:

```bash
just lint
just ci-layer L1
```

나쁜 예:

```bash
npx oxlint packages      # TC-09: 버전 고정 밖의 도구, 레시피 우회
```

### TC-10 공개 패키지만 publint·attw·tsdown을 쓰고, 바이너리는 `bun build --compile`로 만든다

[결정] `_research/foundation-plan.md §2` 경계·위생 행, 빌드 행.

- 공개 패키지: `package.json`에 `"private": true`가 없는 패키지. 현재 없다.
- 공개 패키지가 생기면 `just verify`에 `publint`, `attw --pack`을 더하고 tsdown 0.23으로 빌드한다(TC-04 절차).
- 배포 바이너리: `apps/cli`(CLI), `apps/host`(데스크톱 사이드카, 서비스 모드)를 `bun build --compile`로 만든다. 대상 OS는 macOS와 Linux(WSL 포함)이고 Windows 네이티브는 나중이다(`_research/decisions-log.md` 2026-10-19). 아키텍처 목록(macOS arm64·x64, Linux x64·arm64)은 [제안]이다.
- `plugins/provider-anthropic-oauth`는 바이너리 진입점 그래프에 들어가지 않는다(`eng.dependency-rules.guide` DR-09).

이유: 내부 패키지에 tsdown·publint를 걸면 쓰이지 않는 산출물과 검사가 생긴다. 바이너리는 Bun 런타임과 `bun:sqlite`를 함께 넣어야 하므로 Bun 컴파일러를 쓴다.

좋은 예:

```bash
bun build --compile --target=bun-darwin-arm64 apps/cli/src/main.ts --outfile apps/cli/dist/xeon
```

나쁜 예:

```json
// packages/core-loop/package.json (내부 패키지)
"scripts": { "build": "tsdown" }    // TC-10: 내부 패키지는 소스를 export한다
```

### TC-11 bun:sqlite는 시작할 때 FTS5를 검사하고, macOS는 FTS5가 든 SQLite를 지정한다

[결정] `_research/foundation-plan.md §2` DB 행, §7: macOS는 `Database.setCustomSQLite`로 FTS5가 포함된 SQLite를 지정하고 시작할 때 FTS5를 확인한다.

- 이 환경 처리는 `platform-store` 안에서만 한다(`eng.dependency-rules.guide` DR-07, DR-13).
- `Database.setCustomSQLite(path)`는 첫 `new Database()` 전에 한 번 부른다. 반환값으로 성공을 판정하지 않는다. Linux x64 실측에서 존재하지 않는 경로도 `true`를 반환했다(`_research/notes/eng-3.md §4.1`).
- FTS5 검사 절차(`_research/notes/eng-3.md §4.2`):
  1. `SELECT sqlite_compileoption_used('ENABLE_FTS5')`
  2. `PRAGMA compile_options`에 `ENABLE_FTS5`가 있는지
  3. `:memory:` 연결에서 `CREATE VIRTUAL TABLE p USING fts5(x)`, 한 행 삽입, `MATCH` 질의. 이 단계를 필수로 둔다.
- 연결마다 `PRAGMA busy_timeout = 5000`을 명시한다. Bun 기본값은 0이다(`_research/notes/eng-3.md §2.2`).
- 생성자 옵션 `fileMustExist`는 쓰지 않는다. Bun 1.4.3에서 오류를 낸다. 대신 열기 전에 파일 존재를 검사한다.
- 검사 실패의 처리: 개발 환경 검사(`just status`, 테스트 준비)에서 FTS5가 없으면 종료코드 2(환경 문제)로 끝낸다 [제안]. 운영 시작에서의 처리(시작 거부 또는 검색 기능 비활성)는 `L0.store.spec`이 정한다 [미결].
- Linux x64의 번들 SQLite 3.53.4는 FTS5를 포함한다(실측). macOS의 dylib 경로와 FTS5 포함 여부는 확인하지 않았다 [가정].

이유: macOS의 Bun은 Apple 시스템 SQLite를 쓰고, 그 빌드의 FTS5 포함 여부가 보장되지 않는다(`_research/stack-status.md §7-D`). 세션 검색(L2 knowledge)이 FTS5에 기댄다.

좋은 예:

```ts
// packages/platform-store/src/sqlite-env.ts  (L0)
import { Database } from "bun:sqlite";

export function probeFts5(): boolean {
  const db = new Database(":memory:");
  try {
    db.run("CREATE VIRTUAL TABLE p USING fts5(x)");
    db.run("INSERT INTO p(x) VALUES ('xeon')");
    const row: unknown = db.query("SELECT count(*) AS n FROM p WHERE p MATCH 'xeon'").get();
    // count(*)는 일치가 0건이어도 한 행(n = 0)을 돌려준다. 그래서 n === 1을 본다
    return typeof row === "object" && row !== null && "n" in row && row.n === 1;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
```

나쁜 예:

```ts
if (Database.setCustomSQLite(path)) { /* 교체됐다고 가정 */ }   // TC-11: 반환값을 믿는다
```

### TC-12 Playwright는 Bun 호환을 확인한 뒤 쓰고, 안 되면 Node 자식 프로세스로 돌린다

[결정] `_research/foundation-plan.md §2` 웹 행, §7.

- `playwright-core`는 `cap-web`만 import한다(`eng.dependency-rules.guide` DR-07).
- Bun에서 `playwright-core`가 동작하지 않으면 브라우저 제어 코드를 Node 자식 프로세스로 실행하고 stdio로 연결한다. 이 경우 Node 버전 고정 방법(`mise.toml`)과 실행 경로는 `L2.web.spec`이 정한다.
- 우회 방식이 정해지기 전까지 브라우저 테스트는 `just verify`에 넣지 않는다.

이유: Playwright의 Bun 호환은 확인하지 않았다 [가정]. 호환이 안 되는 상태로 verify에 넣으면 verify가 환경 문제로 늘 실패한다.

좋은 예:

```ts
// packages/cap-web/src/browse/runner.ts
const child = execService.spawn({ cmd: ["node", browseWorkerPath], stdio: "pipe" });   // L0 exec 서비스로 실행
```

나쁜 예:

```ts
// packages/core-tools/src/browse.ts  (L1)
import { chromium } from "playwright-core";   // DR-07: cap-web 밖
```

## 3. 강제 수단

### 3.1 `just verify` 순서

[제안] `_research/foundation-plan.md §5` P3의 순서를 따른다. 루트 `justfile`의 `verify`가 아래 단계를 차례로 부르고, 한 단계라도 실패하면 거기서 멈춘다. 끝에 `ws check`가 붙는다.

| # | 단계 | 레시피 | 실제 명령 | 실패할 때 고치는 법 | 소요 목표 | 종료코드 |
|---|---|---|---|---|---|---|
| 0 | 설치 | `just setup` | `bun install --frozen-lockfile` | 잠금 파일과 `package.json`이 다르면 `bun install`로 잠금 파일을 갱신하고 같이 커밋한다. 네트워크·레지스트리 오류는 환경 문제다 | 10초(캐시 있음) | 1: 잠금 불일치, 2: 네트워크·mise |
| 1 | 포맷 | `just fmt-check` | `oxfmt --check -c .oxfmtrc.json` (루트 설정 파일 + 패키지별 `src`, `test`) | 출력된 파일 경로에 `just fmt`를 적용한다 | 5초 | 1 |
| 2 | 린트 | `just lint` | `oxlint --type-aware --deny-warnings -c .oxlintrc.json` (scripts + 패키지별 turbo) | `파일:행:열`과 규칙 이름이 나온다. 그 줄을 고친다. 메시지가 `DR-NN`으로 시작하면 `eng.dependency-rules.guide`의 해당 규칙을 본다 | 30초 | 1: 위반, 2: tsgolint 시작 실패 |
| 3 | 타입 | `just typecheck` | `tsc -b scripts` + 패키지별 `tsc -b`(turbo, `dependsOn: ["^typecheck"]`) | `파일(행,열): error TSnnnn`이 나온다. 참조 순환 오류는 DR-06, 해석 실패는 DR-04·DR-05 | 60초(첫 실행), 15초(증분) | 1 |
| 4 | 층 | `just check-layers` | `bun scripts/check-layers.ts` | `파일:행 DR-NN 설명`. 규칙 ID의 좋은 예를 따른다 | 3초 | 1: 위반, 2: 파일을 읽을 수 없음 |
| 5 | 경계 | `just depcruise` | `depcruise packages apps plugins --config .dependency-cruiser.cjs` | 규칙 이름 `DR-NN-...`과 `from → to` 경로가 나온다 | 20초 | 1 |
| 6 | 미사용 | `just knip` | `knip` | 미사용 파일·export·의존 목록. 지우거나 `knip.json`의 `entry`가 빠졌는지 본다 | 20초 | 1 |
| 7 | 문서 | `just docs-route --check --allow-missing` | `bun scripts/docs-route.ts --check --allow-missing` | `문서경로: 오류`. 프런트매터, `depends_on`, `binds`를 고친다 | 3초 | 1 |
| 8 | 테스트 | `just test` | `bun test scripts` + `turbo run test --affected` (각 패키지 cwd에서 `bun test`) | 실패한 테스트 파일과 기대·실제 값. 커버리지 임계 미달은 메시지 없이 1로 끝난다(`_research/notes/eng-3.md §3.2`) | 60초(영향 범위) | 1 |
| 9 | 환경 | `ws check` | 사용자 환경 검사 | `ws help`를 본다 | — | 2 |

- 소요 목표 열은 실측 전 추정이다 [가정].
- 순서 근거: 싸고 빠른 검사를 앞에 둔다. 포맷 차이가 린트 오류를 가리지 않게 포맷을 먼저 본다. 타입 검사가 통과해야 depcruise와 knip이 해석한 그래프를 믿을 수 있다. 테스트를 마지막에 둔다.
- 목표 합계는 3분 이하(첫 실행 제외)다 [제안]. 넘으면 단계를 빼지 않고 원인(캐시 미적중, 느린 테스트)을 먼저 줄인다.
- 현재 `xeon/justfile`의 `test`는 `bun run test`(turbo 전체)이고 `--affected`가 없다. 8단계를 `--affected`로 바꾸고, `main` 브랜치 CI는 전체를 돈다 [제안]. 로컬 `--affected`의 기준 커밋은 `TURBO_SCM_BASE`(기본 `main`)다.

### 3.2 종료코드 규약

[제안] 사용자 전역 규칙(1 고침, 2 환경 문제, 3 사람 확인 뒤 `--yes`)을 레시피와 검사 스크립트에 이렇게 적용한다.

| 종료코드 | 뜻 | 받은 사람이 하는 일 | 내는 곳 |
|---|---|---|---|
| 0 | 통과 | — | 모든 단계 |
| 1 | 코드나 설정의 위반 | 메시지의 파일과 규칙 ID를 보고 고친다 | 검사 도구의 위반, 테스트 실패, 잠금 불일치 |
| 2 | 환경 문제 | 코드를 고치지 않고 보고한다 | `mise`·`bun` 실행 실패(예: "No version is set for shim: bun", `_research/notes/eng-3.md §3.2`), 네트워크 실패, tsgolint 시작 실패, FTS5 없음(TC-11), `check-layers.ts`가 파일을 읽지 못함, `ws check` 실패 |
| 3 | 사람 확인 필요 | 사람이 확인한 뒤 같은 레시피를 `--yes`로 다시 부른다 | 잠금 파일·catalog 버전을 바꾸는 레시피, vendor 갱신(TC-06), 테이프 재녹화(`eng.testing.guide` TS-04) |

- `just verify` 자체는 파일을 바꾸지 않으므로 3을 내지 않는다.
- 외부 도구는 자체 종료코드를 낸다. 대부분 위반에 1을 낸다. 도구가 실행되지 못한 경우(셸 126·127)를 2로 바꾸는 감싸개는 `xeon/scripts/`에 둔다 [제안. 이름은 구현 때 정한다].
- `check-layers.ts`는 위반이면 1, 패키지 디렉터리나 `package.json`을 읽지 못하면 2를 낸다. 현재 구현은 읽기 실패 때 예외로 끝나 종료코드 1이 된다. 구분을 더한다.

### 3.3 lefthook (커밋 전 검사)

[결정] `_research/foundation-plan.md §2` 저장소 위생 행: pre-commit에서 oxfmt, oxlint, gitleaks.

| 명령 | 대상 | 실행 |
|---|---|---|
| `gitleaks` | 스테이징된 변경 | `gitleaks git --pre-commit --staged --redact --no-banner` |
| `oxfmt-check` | `xeon/` 아래 스테이징된 `*.{ts,tsx,js,mjs,cjs,json,jsonc}`, `vendor/**` 제외 | `mise exec -- bunx oxfmt --check -c .oxfmtrc.json {staged_files}` |
| `oxlint` | `xeon/` 아래 스테이징된 `*.{ts,tsx,js,mjs,cjs}`, `vendor/**` 제외 | `mise exec -- bunx oxlint --type-aware --deny-warnings -c .oxlintrc.json {staged_files}` |

- 루트 `lefthook.yml`이 `xeon/lefthook.yml`을 extends한다. 설치는 한 번 `lefthook install`.
- pre-commit에는 빠른 검사만 둔다. `tsc -b`, check-layers, depcruise, knip, 테스트는 `just verify`와 CI가 돈다.
- 훅 실패를 `--no-verify`로 넘기지 않는다(TC-07).

### 3.4 CI (`.github/workflows/xeon-ci.yml`)

[결정] `_research/foundation-plan.md §5` P3: 층별 job matrix, 각 job은 turbo `--affected`의 lint·typecheck·test, 통합 테스트는 모델 테이프 기반 스모크 1개.

| job | 내용 | 로컬 재현 |
|---|---|---|
| `layer` (matrix F, X, L0, L1, L2, L3, L4) | `just setup` 뒤 `just ci-layer <층> <main이 아니면 true>`. `scripts/ci-layer.sh`가 층의 패키지 디렉터리로 `turbo run lint typecheck test --filter=<dir>`를 만든다. `true`이면 `--affected`를 더한다 | `just ci-layer L1`, `just ci-layer L1 true` |
| `hygiene` | `fmt-check`, `check-layers`, `depcruise`, `knip` | 같은 레시피 |
| `docs` | `docs-route --check --allow-missing` | 같은 레시피 |
| `smoke` [제안] | 모델 테이프로 `xeon chat` 한 턴과 강제 종료 뒤 재개(`eng.testing.guide` TS-01 `scenario`). M1에서 더한다 | `just smoke` [제안] |

- 체크아웃은 `fetch-depth: 0`이다. `--affected`는 기준 커밋이 있어야 한다. 얕은 체크아웃이면 turbo가 모든 패키지를 바뀐 것으로 본다(`_research/stack-status.md §5-B`, §9).
- 기준 커밋: PR은 `origin/<base_ref>`, push는 `origin/main`(`TURBO_SCM_BASE`).
- 각 job은 `jdx/mise-action`으로 `mise.toml`의 Bun 1.4.3을 설치하고 just 1.58.0을 쓴다.
- 원격 캐시는 쓰지 않는다 [제안]. 필요해지면 TC-04 절차로 더한다.
- macOS job: FTS5와 `setCustomSQLite` 검사(TC-11)를 위해 `macos-latest`에서 `platform-store` 테스트만 도는 job을 더한다 [제안]. 현재 없다.

### 3.5 규칙과 도구 행렬

| 규칙 | 강제 수단 |
|---|---|
| TC-01 정확 고정 | `bunfig.toml` `exact = true`, `bun install --frozen-lockfile`. [제안] `check-layers.ts`에 catalog 값이 숫자 버전인지 검사를 더한다 |
| TC-02 catalog 한 곳 | [제안] `check-layers.ts`: 패키지 `package.json`의 외부 의존 값이 `catalog:` 또는 `workspace:*`인지 |
| TC-03 tsgolint↔TS | 리뷰 항목. [제안] `check-layers.ts`: `typescript`와 `oxlint-tsgolint`의 major.minor.patch 짝 표 |
| TC-04 새 도구 금지 | knip(선언했지만 안 쓰는 도구 검출), 리뷰(ADR 유무), oxlint `no-restricted-imports` 패턴(`vitest`, `jest`) |
| TC-05 산출물 커밋 금지 | `.gitignore`, `knip`, 리뷰 |
| TC-06 vendor 고정 | 리뷰(`vendor/**` diff는 `UPSTREAM.json` 변경과 함께만), `ignorePatterns` |
| TC-07 우회 금지 | `reportUnusedDisableDirectives`, `typescript/ban-ts-comment`, CI가 같은 검사를 다시 돈다 |
| TC-08 tsconfig 기반 하나 | [제안] `check-layers.ts`: 패키지 tsconfig의 `compilerOptions` 키가 허용 목록 안인지 |
| TC-09 just 레시피 | 리뷰, CI가 레시피만 부른다 |
| TC-10 공개 패키지 도구 | 리뷰, 첫 공개 패키지 때 verify 단계 |
| TC-11 FTS5 | `platform-store` 단위 테스트, macOS CI job [제안] |
| TC-12 Playwright | `cap-web` 계획의 호환 확인 테스트 |

## 4. 예외와 승인 절차

- 버전 예외(두 판 공존, 범위 버전): ADR로만 둔다.
- 도구 추가: TC-04 절차(ADR, 사람 승인, 같은 커밋 변경).
- oxfmt 제외 파일: `.oxfmtrc.json` `ignorePatterns`에 더하고 아래 "oxfmt 제외 목록"에 경로와 이유를 적는다.
- oxfmt 제외 목록: `vendor/**`, `**/dist/**`, `**/node_modules/**`, `**/.turbo/**`, `**/coverage/**`, `bun.lock`. 모두 생성물이나 외부 코드다. 이 밖의 항목은 아직 없다.
- verify 단계 변경: 사람 확인을 받는다. 단계를 더하는 변경도 이 문서 3.1 표와 같은 커밋에서 한다.
- 의존 규칙 예외는 `eng.dependency-rules.guide` 4절의 허용 목록을 쓴다.

## 5. 수용 기준

- 새 작업자가 저장소를 받은 뒤 `just setup`과 `just verify` 두 명령으로 3.1 표의 모든 검사를 돌린다. 도구를 전역에 따로 설치할 필요가 없다(`mise`, `just`, `lefthook`, `gitleaks` 제외).
- 각 단계가 실패하면 출력에 고칠 파일 경로가 나온다. check-layers와 depcruise는 규칙 ID(`DR-NN`)도 함께 낸다(`eng.dependency-rules.guide` 5절의 위반 샘플 5종).
- 환경 문제(mise shim 실패, 네트워크, FTS5 없음)는 종료코드 2로 끝나고, 코드 위반과 구분된다.
- `just ci-layer L1`이 CI의 `layer (L1)` job과 같은 명령을 돈다.
- catalog의 모든 값이 정확 버전이고 패키지 `package.json`에 숫자 버전이 없다.

## 6. 미결 사항

- [미결] oxfmt 0.x 설정 형식: `.oxfmtrc.json`을 읽는 것은 확인했다. 같은 디렉터리에 설정 파일 이름이 여러 개 있을 때의 우선순위와 공식 stability는 확인하지 못했다(`_research/notes/eng-1.md §5`, §8). 한 디렉터리에 설정 파일 하나만 둔다 [제안].
- [미결] Playwright의 Bun 호환. 안 되면 Node 자식 프로세스로 우회하며, 이때 Node 버전 고정 방법을 `L2.web.spec`이 정한다(TC-12).
- [미결] `isolatedDeclarations` 적용 범위(전체 또는 공개 패키지만)와 TypeBox 1.3.27·1.3.27 선택(`_research/notes/eng-2.md`).
- [미결] lefthook, gitleaks, 로컬 just의 버전 고정 위치. `mise.toml`에 더하는 안을 제안한다.
- [미결] FTS5 검사 실패 시 운영 시작 동작(시작 거부 또는 기능 비활성). `L0.store.spec`이 정한다. macOS 실측 담당과 시점도 정해야 한다(`_research/notes/eng-3.md §6` M-1, M-3).
- [미결] 도구가 실행되지 못한 경우를 종료코드 2로 바꾸는 감싸개 스크립트의 이름과 범위.
