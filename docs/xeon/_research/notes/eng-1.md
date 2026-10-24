# 엔지니어링 조사 1: oxlint·oxfmt·TypeScript 7 기능 확인

- 목적: Xeon 금지 구문의 강제 수단, 린트·포맷 설정 형식, tsc 프로젝트 참조를 1차 자료로 확인한다. 결과는 `eng.typescript.guide`와 `eng.toolchain.guide`의 근거로 쓴다.
- 기준 버전(로컬 설치로 확인): oxlint 1.89.0, oxlint-tsgolint 7.0.2004, oxfmt 0.74.0, typescript 7.0.2. `xeon/package.json`의 catalog와 일치한다.
- 경로 표기: 저장소 루트 `/home/user/projects/helm/code/helm` 기준 상대 경로다. 프로브 산출물은 scratchpad `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/` 아래에 있다.
- 표지: [결정] [제안] [가정] [미결]을 쓴다. 확인하지 못한 항목은 [미확인]으로 표시한다.

## 1. 요약

- 린트로 강제할 수 있는 금지 구문은 `any`, `namespace`, `export default`, 순환 import, 금지 import 경로, 금지 전역, 처리되지 않은 Promise다. 각각의 규칙 이름과 옵션은 2절 표에 있다.
- enum 전용 규칙은 1.89에 없다. `no-enum` 계열은 규칙 목록 871개에 없다. 런타임 enum은 `tsconfig.base.json:13`의 `erasableSyntaxOnly`가 tsc 단계에서 막는다. const enum은 `oxc/no-const-enum`이 막는다.
- `no-restricted-syntax`와 `no-restricted-paths`는 1.89에 없다. 층 방향 규칙과 임의 구문 금지는 `scripts/check-layers.ts`로 옮긴다. TS 7.0에는 안정 programmatic API가 없으므로(`_research/stack-status.md` §2) 이 스캔은 TS 컴파일러 API에 기대지 않고 짜야 한다.
- 줄 단위 disable 형식은 `// oxlint-disable-next-line <규칙>`과 `// oxlint-disable-line <규칙>`이다. 쓰이지 않은 지시문은 `options.reportUnusedDisableDirectives: "error"`로 실패시킨다. 현재 설정에 이미 있다(`xeon/.oxlintrc.json:11`).
- 현재 `xeon/.oxlintrc.json`에 적힌 규칙 이름은 전부 1.89 규칙 목록과 일치한다. 추가가 필요한 규칙은 `typescript/no-namespace`, `oxc/no-const-enum`, `no-restricted-globals`다.
- oxfmt 0.74는 `.oxfmtrc.json`을 읽는다. 현재 `xeon/.oxfmtrc.json`은 파싱 오류 없이 검사에 쓰인다. TS 7.0.2는 `tsc -b`와 project references를 지원한다. 확인 범위는 소규모 솔루션까지이며 xeon 규모의 빌드 시간은 [미확인]이다.

## 2. 규칙별 확인 결과

근거: 로컬 규칙 목록은 `oxlint --rules -f json`의 출력이다(scratchpad `oxlint-rules.json`, 871개). 옵션 형식은 `xeon/node_modules/oxlint/configuration_schema.json`의 definitions(`NoNamespace`, `NoCycle`, `NoRestrictedImportsConfig`, `RestrictedPattern`, `RestrictedGlobal`, `NoFloatingPromisesConfig`)에서 읽었다. 공식 문서는 https://oxc.rs/docs/guide/usage/linter/rules/ 아래 각 규칙 페이지다.

| 규칙 | 1.89 존재 | 범주 / 타입 인식 | 옵션과 기본값 | 프로브 결과 |
|---|---|---|---|---|
| `typescript/no-explicit-any` | 있음 | restriction / 비타입 인식 | `ignoreRestArgs`(false), `fixToUnknown`(false) | `: any` 검출. 다음 줄 disable이 적용됨 |
| `typescript/no-namespace` | 있음 | restriction / 비타입 인식 | `allowDeclarations`(false), `allowDefinitionFiles`(true) | `namespace NS {}`와 `declare namespace D {}` 검출. `declare module "ext-mod" {}`는 검출하지 않음 |
| `import/no-default-export` | 있음 | restriction / 비타입 인식 | 없음 | `export default function` 검출 |
| `import/no-cycle` | 있음 | restriction / 비타입 인식(로컬 목록의 type_aware=false) | `ignoreTypes`(true), `maxDepth`(무제한), `ignoreExternal`(false), `allowUnsafeDynamicCyclicDependency`(false) | 값 순환 `c.ts`↔`d.ts`는 검출. 타입 전용 순환 `a.ts`↔`b.ts`는 검출하지 않음 |
| `no-restricted-imports` | 있음 | restriction / 비타입 인식 | `paths`: `name`, `importNames`, `allowImportNames`, `allowTypeImports`(false), `message`. `patterns`: `group` 또는 `regex`, `caseSensitive`(false), `importNames`, `importNamePattern`, `allowImportNames`, `allowImportNamePattern`, `allowTypeImports`, `message` | `group` 패턴과 `message`가 출력됨. 재수출(`export { x }`)도 같은 위치에 한 번 더 보고됨(중복 원인 [미확인]) |
| `no-restricted-globals` | 있음 | restriction / 비타입 인식 | 문자열 또는 `{ name, message }` 항목의 배열. 객체형 `{ globals, checkGlobalObject(false), globalObjects }`도 스키마에 있음 | `{ name, message }` 항목으로 검출되고 message가 출력됨. 객체형은 스키마만 확인 |
| `typescript/no-floating-promises` | 있음 | correctness / 타입 인식 필요 | `ignoreVoid`(true), `checkThenables`(false), `ignoreIIFE`(false), `allowForKnownSafeCalls`([]), `allowForKnownSafePromises`([]) | `--type-aware`와 tsgolint 7.0.2004, TS 7.0.2 조합에서 미await 호출을 검출함. 다음 줄 disable이 적용됨 |
| `no-restricted-syntax` | 없음 | — | — | 1.89 규칙 목록에 없음. 공식 규칙 목록에도 없음 |
| `no-restricted-paths` | 없음 | — | — | 1.89 규칙 목록에 없음. 공식 규칙 목록에도 없음 |
| `oxc/no-const-enum` | 있음 | restriction / 비타입 인식, 자동 수정 가능 | 없음 | 규칙 목록과 공식 규칙 이름으로만 확인. 프로브는 하지 않음 |

enum 관련 규칙은 어느 것도 enum 선언 자체를 금지하지 않는다.

- `typescript/no-mixed-enums`(pedantic, 타입 인식): 값이 섞인 enum만 검출한다.
- `typescript/prefer-literal-enum-member`(restriction): 멤버 초기값을 리터럴로 제한한다.
- `typescript/no-duplicate-enum-values`(correctness, 기본 켜짐): 중복 값을 검출한다.
- 프로브에서 `export enum Color { Red, Green }`만 있는 파일은 oxlint 진단이 없었다.

## 3. enum 금지의 실제 강제 경로

- tsc: `tsconfig.base.json:13`의 `erasableSyntaxOnly: true`가 enum과 값을 가진 namespace를 막는다. 프로브(`probe/tsc`)에서 `export enum Color`와 `export namespace NS { export const x = 1; }` 모두 TS1294 "This syntax is not allowed when 'erasableSyntaxOnly' is enabled."를 냈다. 런타임 enum은 이 옵션만으로 막힌다.
- oxlint: `oxc/no-const-enum`을 추가한다(4절 표 참조). const enum은 erasableSyntaxOnly 판정과 별도로 명시적으로 막힌다.
- 잔여 구문: `declare enum`은 출력이 없어 erasableSyntaxOnly를 통과할 가능성이 있다 [미확인]. `const enum`에 대한 TS1294 여부도 프로브하지 않았다 [미확인]. 이 둘은 `check-layers` 스캔에서 선언 노드를 직접 검출하는 방식으로 보완하는 것을 [제안]한다.

## 4. 줄 단위 disable 주석과 미사용 지시문

- 형식(공식 `ignore-comments` 페이지, https://oxc.rs/docs/guide/usage/linter/ignore-comments.html): `// oxlint-disable-next-line typescript/no-explicit-any`, `console.log(x); // oxlint-disable-line no-console`. 블록형은 `/* oxlint-disable no-console, typescript/no-floating-promises */`로 시작하고 `/* oxlint-enable ... */`로 끝낸다.
- `eslint-disable` 계열 주석도 인식된다(같은 공식 페이지).
- 사유 구문: 공식 문서는 `-- 사유` 형식을 설명하지 않는다 [미확인]. 1.89 프로브(`probe/lint/reason`)에서 `// oxlint-disable-next-line typescript/no-explicit-any -- justified probe`는 오류 없이 종료코드 0으로 끝났고 억제도 적용되었다. 공식 근거가 없으므로 사유 표기를 규약으로 삼으려면 `check-layers` 스캔이나 리뷰 항목으로 강제해야 한다. oxlint에는 사유 존재를 검사하는 규칙이 없다 [제안].
- 미사용 지시문: `options.reportUnusedDisableDirectives`는 root 설정 파일에서만 지원된다(스키마 설명). CLI 플래그가 있으면 그쪽이 우선한다. 프로브(`probe/lint/ta`)에서 쓰이지 않은 `// oxlint-disable-line typescript/no-explicit-any`가 `Unused oxlint-disable directive` 오류가 되었다.

## 5. 설정 파일 형식

oxlint:
- `.oxlintrc.json`과 `.jsonc`를 지원한다(`oxlint --help`).
- `options.typeAware`(boolean)는 `--type-aware`와 같다. `oxlint-tsgolint` 설치가 필요하다(스키마 `OxlintOptions`).
- `xeon/.oxlintrc.json:10-11`에 `typeAware`와 `reportUnusedDisableDirectives`가 있다. 키 이름은 스키마와 일치한다.
- `xeon/.oxlintrc.json`의 모든 `rules` 키를 1.89 규칙 목록과 대조했다. 존재하지 않는 규칙은 0개다.

oxfmt:
- 설정 파일 이름은 `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `oxfmt.config.ts`, `oxfmt.config.mts`다(공식 Configuration 페이지, https://oxc.rs/docs/guide/usage/formatter 와 로컬 `xeon/node_modules/oxfmt/dist/shared-C9Jv6iOu.js` 4~9행이 같다).
- 디렉터리마다 설정 파일은 하나만 둔다. 파일별로 가장 가까운 설정이 적용된다(공식 문서).
- 파일 이름 사이의 우선순위는 공식 문서에 없다 [미확인]. 한 디렉터리에 두 종류를 함께 두지 않는 것을 [제안]한다.
- `$schema` 항목이 문서화되어 있다. `xeon/.oxfmtrc.json:2`가 이 형식을 따른다.
- 최상위 옵션 `printWidth`, `tabWidth`, `trailingComma`(기본 "all"), `singleQuote`, `semi`, `ignorePatterns`가 공식 문서에 있다.
- 로컬 검증: `oxfmt --check -c .oxfmtrc.json <scratch 파일>`이 형식 위반 파일을 보고했고(종료코드 1, `probe-fmt.txt`) 설정 파싱 오류는 없었다.
- 안정성: 공식 문서에 stability 라벨과 1.0 발표가 없다. `foundation-plan.md` §2의 0.x 정확 고정 방침을 유지한다. Prettier 호환은 공식 문서가 "Prettier's own test suite"로 검증한다고 주장하는 수준이며 독립 검증은 아니다. Known divergences 목록의 본문은 [미확인]이다.

TypeScript 7.0.2:
- `tsc -b`를 지원한다. 로컬 `tsc --help`에 `--build, -b`("Build one or more projects and their dependencies, if out of date")가 있다.
- 프로브(`probe/refs`): `files: []`와 두 개의 `references`를 가진 루트 솔루션에서 `tsc -b .`가 종료코드 0으로 끝나고 `dist/index.js`, `dist/index.d.ts`를 냈다. 이 결과는 xeon의 `tsconfig.json`과 같은 형태다(`xeon/tsconfig.json:3`에 references 35개).
- `--builders`와 `--checkers`는 devblog 7.0이 실험 플래그로 설명한다(https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). 로컬 `tsc --help`에는 두 플래그가 보이지 않는다 [미확인: 숨김 플래그인지 확인하지 못함].
- 기본값 변경(`strict`, `rootDir`, `types`)은 `xeon/tsconfig.base.json`이 `types: ["bun"]`과 `strict: true`를 명시해서 영향이 없다(`tsconfig.base.json:7-8`). `composite: true`는 `:21`에 있다.
- `xeon/package.json:19`의 `typecheck:root`(`tsc -b scripts`)는 같은 방식이다.

## 6. stack-status 미확인 항목 해소

| `_research/stack-status.md` 항목 | 결과 |
|---|---|
| §1-B: oxfmt 설정 파일 형식 [미확인] | 해소. `.oxfmtrc.json` 등 4개 이름. 우선순위는 여전히 [미확인] |
| §6: `no-restricted-paths` [미확인/미지원] | 해소. 1.89에 없다. 대체 스캔이 필요하다 |
| §6: `no-restricted-imports` 역할 | 확인. `paths`와 `patterns`(`group`, `regex`)를 가진다 |
| §6: `import/no-cycle` maxDepth 지원 | 확인. 기본 무제한. `ignoreTypes` 기본 true가 추가로 확인됨 |
| §2: `tsc -b`와 project references | 확인. 소규모 솔루션에서 동작 |

## 7. 강제 수단 배치 (제안)

| 금지 구문 | 1차 강제 수단 | 현재 `.oxlintrc.json` | 조치 |
|---|---|---|---|
| `any` | `typescript/no-explicit-any` | 있음(`:31`) | 유지 |
| `namespace`, `module` 키워드 | `typescript/no-namespace` | 없음 | [제안] `"error"` 추가. `allowDeclarations` 기본값 false 유지. 외부 모듈 선언 `declare module "x"`는 기본 허용이므로 그대로 둔다 |
| 런타임 `enum` | `tsc`의 `erasableSyntaxOnly` | `tsconfig.base.json:13`에 있음 | 유지 |
| `const enum` | `oxc/no-const-enum` | 없음 | [제안] `"error"` 추가 |
| `declare enum` 등 잔여 enum 형태 | `check-layers` 스캔 | — | [제안] 스캔으로 보완. 동작은 [미확인] |
| `export default` | `import/no-default-export` | 있음(`:61`) | 유지 |
| 순환 import | `import/no-cycle` | 있음(`:58`) | [미결] 타입 전용 순환 허용 여부. 기본값(`ignoreTypes: true`)은 허용이다 |
| 금지 import 경로 | `no-restricted-imports`의 `patterns` | 있음(`:74`~) | 유지. `group`은 기본 대소문자 무시(`caseSensitive: false`) |
| 금지 전역 | `no-restricted-globals` | 없음 | [미결] 금지할 전역 목록. 목록이 정해지면 추가 |
| 층 방향(F→X→L0→…) | 1.89에 규칙 없음 | — | `check-layers.ts`와 dependency-cruiser 유지(`foundation-plan.md` §3) |
| 임의 구문 금지(선택자형) | 1.89에 `no-restricted-syntax` 없음 | — | `check-layers` 스캔 [제안]. oxlint JS 플러그인은 alpha라 채택하지 않음(`stack-status.md` §1-C) |
| 처리되지 않은 Promise | `typescript/no-floating-promises`(타입 인식) | 있음(`:41`) | 유지. `lint:root`가 `--type-aware`를 쓴다(`xeon/package.json:18`) |

- [제안] `check-layers` 대체 스캔의 파서: TS 7.0에는 안정 programmatic API가 없다(`stack-status.md` §2). 가능한 선택지는 (a) 줄 단위 정규식 검출(단순하지만 오탐 위험), (b) 별도 파서 패키지 추가다. Bun 내장 트랜스파일러로 노드 수준 검출이 되는지는 [미확인]이다. 선택은 구현 단계에서 [미결]로 둔다.

## 8. 미확인 목록

1. `--` 사유 구문의 공식 근거(프로브에서는 동작함).
2. oxfmt 설정 파일 이름 사이의 우선순위.
3. oxfmt의 공식 stability와 Known divergences 목록 본문.
4. `declare enum`과 `const enum`에 대한 `erasableSyntaxOnly` 동작, `oxc/no-const-enum`의 실제 검출 결과(목록 확인만 함).
5. `import/no-cycle`의 타입 인식 여부. 공식 문서에 명시가 없고 로컬 목록은 비타입 인식으로 보인다.
6. `tsc --builders`와 `--checkers`의 로컬 노출 여부.
7. xeon 규모의 `tsc -b` 시간과 증분 빌드 동작. 프로브는 두 프로젝트 솔루션만 했다.
8. `no-restricted-imports`의 `allowTypeImports`(공식 기본값 false)는 프로브하지 않았다.
9. `no-restricted-globals`의 객체형 `globals` 입력은 스키마만 확인했다.

## 9. 검사 기록

- 저장소 파일은 수정하지 않았다. `xeon/`은 읽기만 했다. 이 파일 외에 쓴 것은 scratchpad 프로브뿐이다.
- 로컬 `oxlint`, `oxfmt`, `tsc`는 `xeon/node_modules/.bin`의 프로젝트 고정 도구를 썼다. 조사 지침이 허용한 범위다.
- `oxlint --rules`는 텍스트 모드에서 출력이 없었다. `oxlint --rules -f json <파일>`에서 871개 목록을 얻었다.
- 프로브 목록(scratchpad 아래):
  - `probe/lint/src/`: enum, namespace, declare module, any와 disable, 금지 전역, 금지 import, 순환, default export. 출력은 `probe-lint.txt`.
  - `probe/tsc/`: erasableSyntaxOnly 검사(`tsc -p`, `--noEmit`).
  - `probe/lint/ta/`: type-aware no-floating-promises와 미사용 지시문. 출력은 `probe-ta3.txt`. 이 실행만 `xeon/` 디렉터리를 작업 위치로 썼다(tsgolint 탐색 제약). 저장소 파일 변경은 없었다.
  - `probe/lint/reason/`: `-- 사유` 허용 여부. 출력은 `probe-reason.txt`.
  - `probe/fmt/`: oxfmt `--check`. 출력은 `probe-fmt.txt`.
  - `probe/refs/`: `tsc -b` 두 프로젝트 솔루션.
- 공식 문서 중 `…/linter/disable-directives.html`과 `…/linter/inline-comments.html`은 404였다. 정확한 페이지는 `…/linter/ignore-comments.html`이다.
- 공식 규칙 목록 `…/linter/rules.html`은 본문이 길어 앞 100,000자만 읽었다. 규칙 존재 여부는 로컬 규칙 목록으로 전수 확인했으므로 영향은 없다.
