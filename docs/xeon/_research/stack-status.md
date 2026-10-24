# 스택 후보 상태 (2026-10-21 조사)

정본 아님. Explore 에이전트 조사 결과 원문.

# 2026-10-21 기준 TypeScript 에이전트 런타임 모노레포 스택 조사

## 조사 방법과 표기

- 1차 출처(GitHub 릴리스, npm registry 메타데이터, 공식 문서/블로그)를 우선했다. 2차 출처(기사, 블로그)에 의존한 내용은 "(2차)"로 표시했다.
- 릴리스 페이지가 "10 Oct"처럼 연도 없이 날짜를 표기한 경우 2026으로 추정했고, 추정 표시를 붙였다.
- npm registry는 publish 날짜를 주지 않는 패키지가 많아 버전 번호만 확인했다.
- [미확인]은 이번 조사에서 확인하지 못한 항목이다.

## 한눈에 보기

- oxlint type-aware 린트는 2026-07-22에 stable로 발표됐다. oxlint 최신은 1.89.0(2026-10-19)이다.
- oxfmt는 npm 기준 0.74.0(2026-10-19)으로 아직 0.x 라인이다. beta(2026-02-24) 이후 stable/1.0 발표는 찾지 못했다.
- TypeScript 7.0은 2026-07-08 GA다. npm `typescript@latest`는 7.0.2다. 7.0에는 안정 programmatic API가 없고, 7.1에서 새 API가 나올 예정이다. Vue·Astro·Svelte·MDX는 에디터 지원이 아직 없다.
- Vitest 5.0.0 stable이 2026-09-03에 나왔다. 최신은 5.0.5(10-15)이고, 4.1.12도 같은 날 유지보수 릴리스가 나왔다. Vitest 5는 Vite ≥6.4, Node ≥22.12를 요구한다.
- Rolldown 1.0 stable은 2026-05-07이다. tsdown 최신은 0.23.1이다.
- Vite+ 1.0 발표 기사는 2026-10-14자이며, npm `vite-plus` 최신은 1.3.0이다. 내부 스택은 Vite 8, Vitest, Oxlint, Oxfmt, Rolldown, tsdown이다.
- pnpm 최신(npm latest)은 12.14.0이다. pnpm 12는 Rust 재작성 버전이며 2차 출처로 2026-08 말에 stable이 됐다. 질문에 있던 pnpm 10/11은 이미 이전 세대다.
- Node 24는 2026-10-20에 Active LTS가 끝나 Maintenance 단계로 들어간 것으로 보인다(2차). Node 26은 2026-10-28 Active LTS 전환이 예정돼 있다(2차, 공식 일정 [미확인]).
- node:sqlite는 공식 문서 기준 Stability 1.2 "Release candidate"다.
- Electrobun 최신 stable은 2.0.4(2026-10-18)다. "v1"이라는 표기는 구식이다.
- Bun npm 최신은 1.4.3이다. bun:sqlite의 FTS5 포함 여부는 공식 문서에서 확인하지 못했다([미확인]).
- better-sqlite3 최신은 13.0.3(engines node ≥22)이다. v13부터 prebuilt 바이너리를 패키지에 직접 포함해 배포한다. 플랫폼 목록은 [미확인]이다.

---

## 1. 린트·포맷

### 1-A. 버전과 성숙도

| 도구 | 최신 버전 (확인일) | 성숙도 | 핵심 사실 | 출처 |
|---|---|---|---|---|
| oxlint | 1.89.0 (2026-10-19, GitHub Latest) | stable. 1.0은 2025-06-10 | 공식 규칙 페이지 기준 총 871개, 기본 활성 111개, 자동수정 가능 334개 | [releases](https://github.com/oxc-project/oxc/releases), [1.0 발표](https://oxc.rs/blog/2025-06-10-oxlint-stable), [rules](https://oxc.rs/docs/guide/usage/linter/rules.html) |
| oxlint type-aware (tsgolint) | oxlint-tsgolint 7.0.2004 (npm). 태그 v7.0.2000 = TS 7.0.2 대응 | stable (2026-07-22 발표) | typescript-eslint type-aware 규칙 61개 중 59개 구현. alpha(2025-12)는 43개 | [발표](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable), [npm](https://registry.npmjs.org/oxlint-tsgolint/latest) |
| oxfmt | 0.74.0 (2026-10-19, npm 0.74.0) | 0.x 라인. alpha 2025-12-01, beta 2026-02-24. stable/1.0 발표 [미확인] | 공식 문서에 stability 라벨 없음 | [GitHub](https://github.com/oxc-project/oxc/releases), [beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta), [npm](https://registry.npmjs.org/oxfmt/latest) |
| Biome | 2.5.15 (npm) | stable (2.x) | 2.x는 TypeScript 컴파일러 없이 동작하는 type-aware 규칙을 제공. 포매터 번들 | [npm](https://registry.npmjs.org/@biomejs/biome/latest), [Biome 2 블로그](https://biomejs.dev/blog/biome-v2/) |

### 1-B. oxfmt 세부

- Prettier 호환률:
  - alpha(2025-12) 시점 약 95%였다.
  - beta(2026-02-24)는 "Prettier JS/TS 적합성 테스트 100% 통과"를 주장한다. 벤더 주장이며 독립 검증은 아니다.
  - 공식 문서는 "Known divergences"를 문서화하고, 의도적으로 다르게 동작하는 부분을 밝힌다. 불일치는 버그로 취급한다고 밝힌다.
- 설정 파일 형식: 공식 포매터 문서에 명시가 없다([미확인]). oxlint 설정은 `oxlint.config.ts` 또는 `.oxlintrc.json`이다.
- 플러그인:
  - 2026-02 beta 기준 1.0 전 미완 항목으로 "네이티브 Prettier 플러그인 지원"이 꼽혔다.
  - 내장 기능은 import 정렬, Tailwind 클래스 정렬, package.json 정렬, 임베디드 포맷팅이다.
- 마이그레이션: `oxfmt --migrate prettier` 경로가 v0.73에서 breaking 변경됐다(GitHub 릴리스 노트).
- 속도 주장:
  - alpha 발표는 Prettier 대비 약 30배를 주장했다.
  - Cloudflare 측 업데이트(2차)는 7배로 기술했다. 벤치 조건이 달라 직접 비교할 수 없다.

### 1-C. oxlint JS 플러그인

- 상태: 공식 문서가 "JS plugins are currently in alpha"라고 명시한다. 2026-03-11 alpha 발표 이후 stable 발표는 찾지 못했다([미확인]).
- ESLint v9+ 플러그인 API와 호환을 목표로 한다.
- 호환 한계:
  - Vue, Svelte, Angular 같은 커스텀 파일 포맷·파서는 미지원이다.
  - TypeScript 타입 정보가 필요한 규칙은 미지원이다.
- 커스텀 규칙 작성은 가능하다(공식 "Writing JS Plugins" 페이지 참조).

### 1-D. 속도·메모리 비교 (Biome 2.x 대비)

공식 비교 벤치마크는 찾지 못했다. 아래 수치는 모두 벤더 또는 3차 자료다.

| 비교 | 조건 | 수치 | 신뢰도 |
|---|---|---|---|
| oxlint type-aware vs ESLint+typescript-eslint | Apple M4 Pro 12코어, 4개 레포 | vscode 83.2s→6.96s(12x), typescript 27.2s→1.94s(14x), typeorm 13.2s→0.75s(18x), vuejs/core 12.3s→0.95s(13x) | 벤더, 단일 실행 |
| oxc(lint) vs Biome | 벤치 레포 BenchJavaScriptLinter, M2 Max / M4 Max | 약 2.7x / 약 3.3x 빠름 | 3차, Biome 버전·규칙셋 불명 |
| biome check vs oxlint --type-aware | peterbe 블로그 hyperfine | 269ms vs 560ms | 3차, 두 명령의 작업 범위가 다름 |
| Biome vs oxlint/oxfmt (10k 파일) | botmonster 표 | Biome 0.8–2s, oxlint 0.3–0.9s | 3차, 방법론 없음 |
| 메모리 | — | 공식·독립 측정 [미확인]. 3차 기사의 "100–300MB RSS" 주장은 근거가 없다 | 신뢰 불가 |

- 판단: 속도 우위는 여러 출처에서 방향이 같지만, 정확한 배수와 메모리 차이는 자체 측정이 필요하다. 측정 방법은 `hyperfine`과 `/usr/bin/time -v`로 같은 레포에서 `biome check`와 `oxlint + oxfmt`를 맞춰 돌리는 것이다.

---

## 2. 타입 검사 (TypeScript 7)

| 항목 | 상태 | 출처 |
|---|---|---|
| GA 날짜 | 2026-07-08 (공식 devblog). RC는 2026-06-18, beta는 2026-04-21 | [devblog 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/), [InfoQ (2차)](https://infoq.com/news/2026/08/typescript-7-released/) |
| npm 최신 | typescript 7.0.2 (Node ≥16.20, bin: `tsc`) | [npm](https://registry.npmjs.org/typescript/latest) |
| 속도 | 전체 빌드 8–12배 (Microsoft/2차). VS Code 11.9배는 3차 측정 | [devblog](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [VSM (2차)](https://visualstudiomagazine.com/articles/2026/07/08/typescript-7-arrives-to-rock-vs-code-with-go-powered-speed.aspx) |
| tsc 6.x 호환 | 공식: "type-checking과 CLI 동작을 6.0과 호환하도록 설계". `stableTypeOrdering`을 켜고 `ignoreDeprecations` 없이 6.0에서 깨끗하게 컴파일되면 7.0에서도 동일하게 컴파일된다 | 위 devblog |
| 6.0 deprecation | 6.0에서 deprecated된 플래그와 구문은 7.0에서 hard error. 예: `target: es5`, `downlevelIteration`, `baseUrl`, `moduleResolution: node/node10/classic`, `alwaysStrict: false` | 위 devblog |
| 기본값 변경 | `strict`(켜짐), `module`(esnext), `rootDir`(`./`), `types`(`[]`). 공식은 `rootDir`과 `types`를 가장 자주 깨지는 지점으로 지목 | 위 devblog |
| programmatic API | 7.0에는 API가 없다. 7.1에 새 API(기존과 다름) 예정, 날짜 미정. typescript-eslint 등은 `@typescript/typescript6`(npm alias, tsc6 bin 포함)로 6.0 API를 사용 | 위 devblog |
| 에디터 | LSP 기반. VS Code는 TS7 전용 확장이 설치되면 기본값이 된다. 내장 지원은 "coming weeks"라고만 됨([미확인] 현재 시점). Visual Studio는 워크스페이스 기준 자동 활성화 | 위 devblog |
| 에디터 미지원 | Vue, MDX, Astro, Svelte는 7.0 미지원(공식). Angular는 CLI는 7.0, 에디터는 6.0 조합을 안내 | 위 devblog |
| project references | `--build`(`-b`) 지원. 여러 프로젝트를 동시에 빌드하는 `--builders`(experimental), 타입체크 워커 `--checkers`(기본 4), `--singleThreaded` 제공. `--builders` 수는 결과를 바꾸지 않으며 빌드는 프로젝트 의존 그래프에 제약됨. 두 플래그를 함께 올리면 워커 수가 곱해짐 | 위 devblog |
| tsgolint 결합 | oxlint type-aware는 TS 7.0.x 특정 릴리스에 묶인다(공식). tsgolint npm 패키지에는 typescript peer 의존성이 없다 | oxc 발표, npm |

---

## 3. 테스트

### 3-A. Vitest

| 항목 | 상태 | 출처 |
|---|---|---|
| 5.0.0 stable | 2026-09-03 (GitHub 릴리스, 연도 표기 없음이어서 2026 추정) | [releases](https://github.com/vitest-dev/vitest/releases) |
| 최신 | 5.0.5 (2026-10-15, Latest). 5.1.0-beta.1 (2026-10-19) | 위 releases |
| 4.x | 4.1.12 (2026-10-15, stable, Latest 아님). 유지보수 라인으로 보임 | 위 releases |
| 요구 사항 | Vite ≥6.4.0, Node ≥22.12.0. npm peer `vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0`. engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | [blog](https://vitest.dev/blog/vitest-5), [npm](https://registry.npmjs.org/vitest/latest) |
| projects | `test.projects`가 공식 용어. inline project가 root config를 기본 상속한다(Vitest 4는 project마다 `extends: true` 필요). 설정 파일을 project로 지정하고 그 안에 중첩 project를 둘 수 있다. root에서 패키지별 config를 glob으로 묶을 수 있다. `--project`/`-p` 필터가 계층을 따른다. Vite config가 같으면 root Vite 서버를 재사용한다 | 위 blog |
| 성능(벤더) | M4 10코어, Node 24, 중앙값 3회. Vitest 4.1 대비 deps-heavy 1.59s→0.74s(−53%), long-haul 5.43s→4.06s(−25%), enterprise-monolith 7.24s→5.83s(−19%) | 위 blog |
| 메모리 | 공식 메모리 수치는 없음([미확인]). 관련 변경: `fsModuleCache`(변환 모듈 디스크 캐시), v8 커버리지 "bounded memory" 병합, 5.0.4의 "V8 browser memory leak between test files" 수정 | 위 blog, releases |
| breaking (5.0) | `clearMocks` 기본 on, `resolves`/`rejects`/`toMatchFileSnapshot` 미await 시 실패, strict locator(`getByText('Item')`이 `Item 1`과 불일치), Temporal 기본 fake | 위 blog |

### 3-B. node:test

- 모듈 stability: `Stability: 2 - Stable` (v20.0.0부터 stable).
- mock API(함수 spy, 타이머 mock, `t.mock`)가 있다. 테스트 파일은 기본적으로 파일별 child process에서 실행된다(`isolation` 옵션, v22.8.0).
- 커버리지(`--experimental-test-coverage`)와 워치(`--watch`)는 `Stability: 1 - Experimental`이다.
- snapshot은 v23.4.0부터 stable이다.
- 26.x에 추가된 test tags(26.2.0)와 `--test-randomize`(26.1.0)는 "1.0 Early development"다.
- 출처: [nodejs.org/api/test](https://nodejs.org/api/test.html)

### 3-C. bun test

- Jest 호환 API를 표방하지만 "not everything is implemented"라고 명시한다.
- `--parallel`은 파일별 격리 실행을 한다. `--parallel --no-isolate`는 워커당 import를 한 번만 평가한다. `--shard=i/n`과 `--timings`로 CI 분산을 지원한다.
- 커버리지(`--coverage`, text/lcov), snapshot, JUnit 리포터가 있다.
- workspace/projects 설정 문서는 이 페이지에 없다([미확인]).
- 출처: [bun.com/docs/test](https://bun.com/docs/test/index)

### 3-D. 패키지별 단위 테스트 관점

- 문서화된 "패키지별 project 설정"은 Vitest 5 `projects`가 가장 직접적이다.
- node:test는 런타임 의존이 없고 기본 API가 stable이다. 다만 커버리지와 워치가 experimental이다.
- bun test는 Bun을 런타임으로 쓸 때만 의미가 있다.

---

## 4. 빌드와 번들

| 항목 | 상태 | 출처 |
|---|---|---|
| Rolldown 1.0 | stable, 2026-05-07 발표. `^1.0.0` 공개 API는 semver 보장 | [발표](https://voidzero.dev/posts/announcing-rolldown-1-0) |
| Rolldown 예외 | experimental 기능(watch 모드, native MagicString, lazy barrel 최적화)은 보장 제외. 출력 최적화 휴리스틱(DCE, chunking, inlining)은 바뀔 수 있다고 명시 | 위 발표 |
| Rolldown 최신 | npm 1.2.14 (engines `^20.19.0 \|\| >=22.12.0`) | [npm](https://registry.npmjs.org/rolldown/latest) |
| Rolldown 성능 | Rollup 대비 10–30배 주장(벤더). Vite 8의 기본 번들러 | 위 발표 |
| minification | 공식 발표에 전체 minify 상태 명시 없음. DCE 전용 minify 모드를 언급. 2차 출처는 alpha라고 함([미확인]) | 위 발표, [certificates.dev (2차)](https://certificates.dev/blog/rolldown-and-vite-8-what-changed) |
| Vite 8 | stable, 2026-03 (2차 기준). Rolldown이 기본 번들러 | 위 발표 |
| tsdown 최신 | 0.23.1 (GitHub Latest, 10-10, 연도 추정 2026). npm latest 0.23.1 | [releases](https://github.com/rolldown/tsdown/releases), [npm](https://registry.npmjs.org/tsdown/latest) |
| tsdown 의존성 | `rolldown ~1.2.13` (dependency). engines `^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0` (Node 25 제외) | 위 npm |
| tsdown 0.23.0 breaking | 설정 이름 변경(outExtension, publicDir, removeNodeProtocol, injectStyle 등). deps 옵션 네임스페이스 이동. `build()` 반환 형태 변경(`bundles`, `watch`). 레거시 `types`/`typesVersions` 제거. 마이그레이션 가이드는 0.22.14에서 먼저 경고 제거 후 진행 권장 | [releases](https://github.com/rolldown/tsdown/releases) |
| tsc 단독 빌드와 비교 | 번들 없이 emit만 한다. 성능 비교 수치는 찾지 못함([미확인]) | — |

- 참고: Vite+ 1.0 스택에 tsdown이 포함된다. 비교 목적이면 tsdown은 라이브러리 번들+d.ts 생성 도구이고, tsc 단독은 타입 생성만 한다는 차이가 있다.

---

## 5. 모노레포 도구

### 5-A. pnpm

| 항목 | 상태 | 출처 |
|---|---|---|
| 최신 | npm latest 12.14.0. engines `node >=18.*` | [npm](https://registry.npmjs.org/pnpm/latest) |
| pnpm 12 | Rust 재작성. 2차 출처 기준 stable은 2026-08-26/27. 명령·설정·lockfile 형식은 11과 호환을 목표 | [pnpm 12.0 블로그](https://pnpm.io/blog/releases/12.0), [2차](https://nesbitt.io/2026/08/29/this-week-in-package-management.html) |
| pnpm 12 breaking | `--frozen-lockfile false` 미지원(`--no-frozen-lockfile` 사용). git dependency는 GitHub/GitLab/Bitbucket에서 HTTPS 정규형으로만 기록. `pnpm-workspace.yaml`의 알 수 없는 키는 오류(버전 고정 시 `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`). `engineStrict`가 optionalDependencies 하위에서도 실패 처리 | 위 블로그 |
| catalog | 12.0.0-rc.4에서 `cleanupUnusedCatalogs`가 `catalogPrune`으로 이름 변경(구 이름 동작). 12.2.0에서 catalog 항목이 `workspace:` 프로토콜로 워크스페이스 패키지를 가리킬 수 있게 됨. 12.x 공식 페이지에는 catalog breaking 변경이 없다고 확인됨 | [npm 12.2.0 노트](https://newreleases.io/project/npm/pnpm/release/12.2.0), 위 블로그 |
| 11.x 릴리스 관리 | 11.13.0에서 `pnpm change`(intent 파일, .changeset 형식 호환), `pnpm version -r`, `pnpm lane`(레인별 prerelease)이 추가됨. 기본 changelog 저장소는 레지스트리. `versioning` 설정은 `pnpm-workspace.yaml`에 있다 | [pnpm 11.11–11.14 블로그](https://pnpm.io/blog/releases/11.11-11.14) |

### 5-B. Turborepo

| 항목 | 상태 | 출처 |
|---|---|---|
| 최신 | npm `turbo` 2.11.10 | [npm](https://registry.npmjs.org/turbo/latest) |
| `--affected` | 공식 reference: 기본 base는 `main`, `TURBO_SCM_BASE`/`TURBO_SCM_HEAD`로 변경. 내부적으로 `--filter=...[main...HEAD]`와 같다. 얕은 checkout이면 base까지의 커밋이 없어 모든 패키지가 변경된 것으로 간주된다 | [run 레퍼런스](https://turborepo.dev/docs/reference/run) (2차 검색 결과) |
| affected 세분화 | 공식 canary 문서(v2.8.19) 기준 기본은 패키지 단위. `futureFlags.affectedUsingTaskInputs`로 태스크 input glob 단위 가능. 정식 버전에서의 기본값은 [미확인] | 위 run 레퍼런스 |
| git 필터 | `--filter=[HEAD^1]`, `--filter=[main...my-feature]`처럼 대괄호로 감싸야 한다. `...ui`는 의존자 포함, `web...`는 의존성 포함 | [running tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) |
| GitHub Actions 샘플 | 공식 샘플은 `fetch-depth: 2`, `node-version: 20`, `pnpm/action-setup@v3`(version 8)로 구식 흔적이 있다. 권장 설정으로 쓰기 전에 최신 확인 필요([미확인]) | [GH Actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) |
| 원격 캐시 인증 | OIDC(`vercel/setup-turborepo-remote-cache-action`) 권장. 대안은 `TURBO_TOKEN`/`TURBO_TEAM` 시크릿 | 위 문서 |

### 5-C. Nx

| 항목 | 상태 | 출처 |
|---|---|---|
| 최신 | npm `nx` 23.3.0. Nx 23은 2026-06-16 메이저 (2차) | [npm](https://registry.npmjs.org/nx/latest) |
| affected | 2차 자료는 Nx의 affected가 TypeScript import 그래프 분석을 쓰므로 Turborepo의 파일 해시 기반보다 정교하다고 평가한다. 공식 affected 문서는 이번에 확인하지 못함([미확인]) | 2차 (PkgPulse) |
| module boundaries | `@nx/enforce-module-boundaries` 규칙. `depConstraints`에 `sourceTag`/`allSourceTags`, `onlyDependOnLibsWithTags`/`notDependOnLibsWithTags`. 태그는 `project.json` 또는 `package.json`에 둔다. 여러 제약이 매칭되면 AND로 적용 | [docs](https://nx.dev/docs/features/enforce-module-boundaries.md) |
| language-agnostic conformance | Nx Enterprise 플랜 전용 | 위 docs |

### 5-D. vite-plus (VoidZero 통합 툴체인)

| 항목 | 상태 | 출처 |
|---|---|---|
| 1.0 | 2026-10 기사에서 1.0 발표를 보도. 베타(2026-08) 이후 약 3개월 (정확한 일자 [미확인]). MIT 라이선스 | [InfoQ (2차)](https://infoq.com/news/2026/10/cloudflare-viteplus-stable), [heise](https://heise.de/-11212433) |
| 최신 | npm `vite-plus` 1.3.0. engines `^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0` | [npm](https://registry.npmjs.org/vite-plus/latest) |
| 구성 | `vp` 단일 명령으로 Node 런타임과 패키지 매니저를 관리. 프론트엔드 스택은 Vite 8, Vitest, Oxlint, Oxfmt, Rolldown, tsdown을 `vite.config.ts` 하나로 설정 | 위 InfoQ |
| 의존성 고정 | npm 1.3.0 기준 oxlint `=1.88.0`, oxfmt `=0.73.0`, vitest `5.0.5`, tsdown `^0.23.1` (devDependency) | 위 npm |
| 로드맵 | 원격 캐시, 모노레포 진단 강화, `vp release`, `vp docs`는 향후 버전 예정 | 위 InfoQ |
| 채택 수치 | 주간 다운로드 약 200만, 2,600개 이상 공개 레포가 의존(VoidZero 주장) | 위 InfoQ |

### 5-E. Turborepo vs Nx 요약

| 항목 | Turborepo 2.x | Nx 23.x |
|---|---|---|
| 태스크 캐시·오케스트레이션 | 단순, 설정 적음 | 기능 풍부 |
| affected | 파일/패키지 해시 기반 (공식 문서로 확인) | 그래프 기반 (2차 평가) |
| 경계 강제 | 기본 제공 없음 | `enforce-module-boundaries` |
| 2차 권장 | 소·중형 레포 | 다수 팀·아키텍처 경계 강제 필요 시 |

- 다운로드 수는 2차 출처마다 달라 신뢰하기 어렵다. 제외했다.

---

## 6. 의존 방향 강제와 패키지 검증

| 도구 | 최신 버전 | engines | 역할 | 오xlint 대체 가능성 |
|---|---|---|---|---|
| dependency-cruiser | 18.7.0 | `^22 \|\| ^24 \|\| >=26` | 규칙 기반 의존성 검증·시각화 | oxlint로 대체 불가. 레이어 규칙은 별도 도구 필요 |
| eslint-plugin-boundaries | 7.2.0 | peer `eslint >=6.0.0`, node ≥18.18 | 요소 간 아키텍처 경계 규칙 | ESLint 자체가 필요. oxlint는 JS 플러그인(alpha)으로만 간접 실행 가능하며, 이 플러그인의 호환은 [미확인] |
| oxlint 내장 import 규칙 | oxlint 1.89.0 | — | `import/no-cycle`(maxDepth 옵션 지원), `no-restricted-imports`(모듈 지정자 금지) | 순환 참조와 특정 모듈 금지는 가능. 디렉터리 간 방향 규칙(`no-restricted-paths` 형태)은 공식 문서 페이지가 404여서 [미확인]/미지원으로 간주 |
| Nx enforce-module-boundaries | nx 23.3.0 | — | 태그 기반 의존 제약 | Nx 워크스페이스 한정 |
| knip | 6.42.1 | `^20.19 \|\| >=22.12` | 미사용 파일·export·의존성 검출 | 대체재 없음(별도 도구) |
| publint | 0.3.25 | node ≥18 | package.json exports/files 오류 검출 | — |
| @arethetypeswrong/cli (attw) | 0.18.5 | node ≥20 | 타입 해석 문제(exports, CJS/ESM) 검출 | — |

- 링크: [dependency-cruiser](https://registry.npmjs.org/dependency-cruiser/latest), [eslint-plugin-boundaries](https://registry.npmjs.org/eslint-plugin-boundaries/latest), [knip](https://registry.npmjs.org/knip/latest), [publint](https://registry.npmjs.org/publint/latest), [attw](https://registry.npmjs.org/@arethetypeswrong%2Fcli/latest), [oxlint import no-cycle](https://oxc.rs/docs/guide/usage/linter/rules/import/no-cycle), [no-restricted-imports](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports)

---

## 7. 런타임과 데스크톱

### 7-A. Node.js

| 항목 | 상태 | 출처 |
|---|---|---|
| Node 24 | LTS "Krypton". 최신 24.22.0(공식 "Latest LTS") | [nodejs.org](https://nodejs.org/en/about/previous-releases) |
| Node 24 단계 | Active LTS가 2026-10-20에 끝나 Maintenance로 이행(2차). EOL은 2028-04-30(2차) | [DevX (2차)](https://www.devx.com/coding/nodejs-26-lts-new-features-release-date/) |
| Node 26 | Current, 최신 26.12.0 (공식). 2026-05-05 출시(2차 일부는 4월로 표기). Active LTS 전환 2026-10-28 (2차) | 위 공식, DevX |
| Node 22 | 최신 22.23.3. 지원 종료 2027-04-30(2차) | 위 공식 |
| node:sqlite | 공식 문서 stability `1.2 - Release candidate`. v25.7.0에서 RC로 바뀜. v22.5.0에 추가 | [sqlite](https://nodejs.org/api/sqlite.html) |
| node:sqlite (Node 24 LTS) | 2차 릴리스 요약(24.15.0)은 SQLite 모듈을 RC로 표기. Node 24 LTS 문서의 라벨은 [미확인] | 2차 (traeai) |
| node:sqlite 알려진 문제 | 24.15.0에서 text decoder가 embedded null에서 값을 자름. 수정은 24.16.0과 26.1.0 (2차) | [OpenClaw 호환 페이지 (2차)](https://docs.openclaw.ai/install/node-compatibility) |
| node:sqlite 보안 | CVE-2026-58041: `createTagStore()`로 만든 stale iterator가 reset·재바인딩 뒤에도 캐시된 statement를 실행할 수 있음. 영향 22.x/24.x/26.x. 수정 버전 [미확인] | [TuxCare](https://tuxcare.com/cve-tracker/cve/details/cve-2026-58041/) |

### 7-B. Node SEA (single executable application)

| 항목 | 내용 | 출처 |
|---|---|---|
| 공식 stability | `1.1 - Active development` (현재 문서) | [SEA](https://nodejs.org/api/single-executable-applications.html) |
| 빌드 방식 | v25.5.0부터 `node --build-sea sea-config.json`. Node 24에는 없어 `--experimental-sea-config` 후 postject로 주입하는 구 절차가 필요 | 위 문서 |
| 기능 | CJS(기본)와 ESM(`mainFormat: "module"`), assets, `sea.getAsset*`, `getAssetKeys`(v22.20.0, v24.8.0), VFS(`useVfs`, 26.9.0) | 위 문서 |
| 제약 | `useVfs`는 `useSnapshot`/`useCodeCache`와 함께 쓸 수 없음. `.node` 네이티브 애드온은 VFS에서 로드 불가(임시 파일에 써서 `process.dlopen` 필요). 생성 Node 버전과 주입 Node 버전이 같아야 함. 크로스 플랫폼 빌드에서 code cache·snapshot 불가 | 위 문서 |
| 플랫폼 | CI 검증 대상은 Windows, macOS(arm64만), Linux(Alpine 제외) | 위 문서 |
| 서명 | macOS는 `codesign` 필요. Windows 서명은 선택 | 위 문서 |

- 추론: better-sqlite3(네이티브 애드온)를 SEA 단일 실행 파일에 넣으면 `.node` 로딩 제약에 걸린다. 이 점은 엔진 선택에 영향을 준다.

### 7-C. Bun

| 항목 | 내용 | 출처 |
|---|---|---|
| npm 최신 | bun 1.4.3 | [npm](https://registry.npmjs.org/bun/latest) |
| `bun build --compile` 타깃 | bun-linux-x64/arm64 (glibc·musl), bun-windows-x64/arm64, bun-darwin-x64/arm64 (8개) | [executables](https://bun.com/docs/bundler/executables) |
| 바이너리 구성 | 번들 코드와 Bun 런타임 사본을 포함. Bun·Node API 지원 | 위 문서 |
| 크기 | 공식 문서가 "still way too big"라고 인정. 구체 수치는 없음 | 위 문서 |
| 플래그 | `--minify`, `--sourcemap`(zstd), `--bytecode`(시작 속도), `--bytecode-order`(한 CLI 사례: 콜드 스타트 1.0s→0.53s, 시작 메모리 40MB 감소) | 위 문서 |
| 제한 | `--target=node`, `--outdir`, `--public-path`, `--no-bundle` 불가. 크로스 컴파일 시 Windows 메타데이터 플래그 불가. 워커 파일은 entrypoint로 명시 | 위 문서 |
| 임베디드 SQLite | 읽기/쓰기 가능하지만 프로그램 종료 시 변경 사항이 사라짐 | 위 문서 |

### 7-D. bun:sqlite와 FTS5

| 항목 | 내용 | 출처 |
|---|---|---|
| FTS5 명시 | 공식 `bun:sqlite` 문서에 FTS5 지원 명시 없음. 문서는 FTS5 가상 테이블의 update hook 동작만 언급 | [bun:sqlite](https://bun.com/docs/runtime/sqlite) |
| Linux/Windows | Bun이 SQLite를 정적 링크하며 "upstream defaults"를 따른다고 함. 이 기본값에 FTS5가 포함되는지는 [미확인] | 위 문서 |
| macOS | Apple 시스템 SQLite 사용. extension 미지원. `sqlite_version()`과 `PRAGMA compile_options`가 Apple 값을 보고 | 위 문서 |
| 커스텀 SQLite | `Database.setCustomSQLite(path)`는 macOS에서만 효과가 있고, 그 외에서는 `false`를 반환 | 위 문서 |
| 확인 방법 | `PRAGMA compile_options;`에 `ENABLE_FTS5`가 있는지 보고, 타깃 플랫폼마다 `CREATE VIRTUAL TABLE ... USING fts5(...)`를 실행해 검증 | SQLite 문서 (2차 검색) |

- 결론: FTS5 가용성은 공식 문서로 단정할 수 없다. 플랫폼별 스파이크 테스트가 필요하다.

### 7-E. better-sqlite3

| 항목 | 내용 | 출처 |
|---|---|---|
| 최신 | npm 13.0.3 (engines `node >=22`). GitHub 13.0.3 2026-08-05 (연도 추정) | [npm](https://registry.npmjs.org/better-sqlite3/latest), [releases](https://github.com/WiseLibs/better-sqlite3/releases) |
| v13.0.0 (2026-07-21) | prebuilt 바이너리를 패키지 코드와 함께 배포. `prebuild-install` 의존 제거. N-API 기반이라 "이론적으로 Node·Electron 여러 버전에서 동작"이라고 표기. 지원 플랫폼·아키텍처 목록은 [미확인]. 미지원 플랫폼은 설치 시 컴파일(툴체인 필요) | [v13.0.0 릴리스](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) |
| 구버전 참고 | v9.4.1 노트(구버전)에 darwin-arm64와 win32-arm64 prebuild 추가 기록. 현재 v13 매트릭스로 재확인 필요 | 2차 (newreleases) |
| 참고 | Windows arm64 prebuild가 `sqlite3`(node-sqlite3) 패키지에는 없다는 기록은 better-sqlite3와 무관 | — |

### 7-F. Tauri 2

| 항목 | 내용 | 출처 |
|---|---|---|
| CLI | `@tauri-apps/cli` 2.12.3 | [npm](https://registry.npmjs.org/@tauri-apps/cli/latest) |
| 사이드카 등록 | `tauri.conf.json`의 `bundle.externalBin`에 `binaries/my-sidecar`처럼 쓰고, 실제 파일은 `src-tauri/binaries/my-sidecar-<target-triple>`로 둔다(Windows는 `.exe`). triple은 `rustc --print host-tuple`(Rust 1.84+) | [sidecar](https://v2.tauri.app/develop/sidecar/) |
| 권한 | `capabilities`에 `shell:allow-execute`(execute) 또는 `shell:allow-spawn`(spawn)과 `"sidecar": true`를 명시. args는 검증 패턴 가능 | 위 문서 |
| 호출 | Rust는 `app.shell().sidecar("name")`(파일명만). JS는 `Command.sidecar('binaries/name')`(externalBin 전체 문자열) | 위 문서 |
| Node 엔진 묶기 (공식) | `@yao-pkg/pkg`로 Node 앱을 단일 바이너리로 만드는 방식을 공식 가이드가 안내. 다른 컴파일러도 가능하다고 함. Node 런타임을 넣고 JS를 리소스로 두는 대안은 더 크고 JS가 노출됨 | [Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) |
| Bun 엔진 묶기 | 공식 문서에 없음. 커뮤니티 스킬 문서는 `bun build --compile`로 `src-tauri/binaries/`에 triple 접미사를 붙여 쓰는 방식을 설명([미확인], 공식 아님) | 커뮤니티 |
| 3개 플랫폼 빌드 | triple마다 바이너리가 필요하다. 공식 스크립트는 호스트 아키텍처에서만 동작한다고 경고. 실질적으로 플랫폼별 CI 러너가 필요 | 위 sidecar |
| 종료 시 자식 프로세스 정리 | 공식 문서에 설명 없음([미확인]) | — |
| 웹뷰 엔진 | Windows는 WebView2, macOS는 WKWebView, Linux는 WebKitGTK | [process model](https://v2.tauri.app/concept/process-model/) (fetch 실패. 엔진명은 Tauri 공통 사실로 표기) |

### 7-G. Windows 주의점

- WebView2 설치 방식(Tauri 공식 Windows installer 문서):
  - `downloadBootstrapper`(기본): 설치 크기 +0MB. 설치 시 인터넷 필요.
  - `embedBootstrapper`: +약 1.8MB. 인터넷 필요. Windows 7 MSI 호환성 개선.
  - `offlineInstaller`: +약 127MB. 오프라인 설치 가능.
  - `fixedRuntime`: +약 180MB. 오프라인 가능. 웹뷰 보안 패치를 직접 관리해야 함(공식은 시스템 런타임이 보안 패치에 유리하다고 명시).
- 코드 서명 (Tauri 공식 Windows sign 문서):
  - SSL 인증서는 쓸 수 없고 code signing 인증서가 필요하다.
  - OV 인증서는 PFX 변환 또는 Azure Key Vault(`relic`) 또는 Azure Artifact Signing으로 서명한다. 가이드는 2023-06-01 이전 발급 OV 기준이라고 명시.
  - Microsoft Store 등록에는 서명이 필요하다. 서명하지 않으면 SmartScreen 경고가 뜬다.
  - 2024년 이후 EV 인증서도 즉시 평판을 주지 않는다는 공식 언급이 있다.
  - Linux나 macOS에서 Windows 설치 파일을 만들면 기본 서명 구현이 동작하지 않으므로 커스텀 sign command가 필요하다.
  - 출처: [sign/windows](https://v2.tauri.app/distribute/sign/windows/), [windows-installer](https://v2.tauri.app/distribute/windows-installer/)

### 7-H. Tauri vs Electron vs Electrobun

| 항목 | Tauri 2 | Electron | Electrobun |
|---|---|---|---|
| 최신 | @tauri-apps/cli 2.12.3 | npm electron 45.0.0 | GitHub Latest v2.0.4 (2026-10-18, stable) |
| 메모리 (자체 주장) | 30–50MB (Electrobun 문서의 표, 벤더) | 100–200MB (동일 표) | 15–30MB (프로젝트 문서, 벤더) |
| 메모리 (3차) | idle 42MB | idle 168MB (Electron 34.x) | [미확인] |
| 번들 (3차) | Hello World 3.2MB, 스크린 레코더 57MB | Hello World 85MB, 스크린 레코더 323MB | 스크린 레코더 418MB (시스템 WebView에 화면 캡처 API가 없어 Chromium을 번들한 결과, 약 200MB 증가) |
| 기동 (3차) | 380ms | 1,420ms | [미확인] |
| 공개 측정 신뢰도 | Tauri 공식 v1 벤치를 두고 "Chromium 공유 메모리를 빼지 않았다"는 논쟁이 깃허브에 있음(tauri#5889). 독립 측정 결론은 아직 확정되지 않음 | 공식 측정 없음. 3차 수치는 버전 기준이 다름 | 대부분 프로젝트 자체 수치 |
| 플랫폼 | Windows, macOS, Linux 지원 | 3개 OS | macOS 14+ 공식, Windows 11 x64 공식, Windows 11 ARM64 beta, Ubuntu 24.04+ 공식, 그 외 Linux 커뮤니티 |
| 렌더링 엔진 | 시스템 WebView | Chromium 번들 | 기본 시스템 WebView, `bundleCEF` 옵션으로 Chromium 번들 |
| 코드 서명·노타리제이션 | 공식 문서 있음 | 공식 문서 있음 | 공식 페이지에 언급 없음([미확인]) |
| 안정성 | stable (2.x) | stable | v2.0.4 stable. 한국어 기사의 "v1" 표기는 구식 |

- 출처: [Better Stack 2026-07 비교](https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/), [Tech Insider 2026-07 (2차)](https://tech-insider.org/tauri-vs-electron-2026/), [Electrobun 릴리스](https://github.com/blackboardsh/electrobun/releases), [Electrobun 저장소](https://github.com/blackboardsh/electrobun)

---

## 8. 스키마 (TypeBox)

| 항목 | 상태 | 출처 |
|---|---|---|
| npm 최신 | `typebox` 1.4.2 (publish 날짜 메타데이터 없음) | [npm](https://registry.npmjs.org/typebox/latest) |
| 패키지명 | 1.x는 `typebox`, 0.34.x는 `@sinclair/typebox`. 1.x 이주 가이드는 찾지 못함([미확인]) | [bestofjs (2차)](https://bestofjs.org/projects/typebox) |
| GitHub 릴리스 | `sinclairzx81/typebox`의 Releases 페이지가 비어 있다("There aren't any releases here") | [releases](https://github.com/sinclairzx81/typebox/releases) |
| 엔진·피어 | npm 메타데이터에 engines와 peerDependencies 없음 | 위 npm |
| 1.0 breaking | [미확인] | — |
| 주의 | Socket 페이지 스냅샷마다 최신 버전 표기가 다르다(1.3.x 계열). JSR `@wok/typebox`는 다른 패키지 | [Socket (2차)](https://socket.dev/npm/package/typebox/overview/1.3.30) |

---

## 9. CI: GitHub Actions에서 pnpm + turbo 영향 범위 테스트

일반 패턴(공식 문서 근거와 추론을 구분했다):

1. 체크아웃: `actions/checkout`에 `fetch-depth: 0`(추론: `--affected`와 `[origin/main...HEAD]`는 base 커밋이 있어야 함. 공식 turbo 샘플은 `fetch-depth: 2`인데 이는 base가 얕으면 모든 패키지가 변경된 것으로 간주되는 공식 경고와 맞지 않는다).
2. pnpm 설치: `pnpm/action-setup`은 `packageManager` 필드나 버전을 지정한다. 공식 turbo 샘플의 버전 8 고정은 구식이다.
3. Node 설치: `actions/setup-node`에 `cache: pnpm`. Node 버전은 24(Maintenance)나 26(Active LTS 예정)을 고려한다.
4. 영향 범위 실행: `pnpm turbo run test --affected`(공식: 기본 base `main`, `TURBO_SCM_BASE`로 변경). 또는 `turbo run test --filter=...[origin/main]`. base 이름이 `main`이 아니면 `TURBO_SCM_BASE`를 설정한다.
5. 원격 캐시: OIDC(`vercel/setup-turborepo-remote-cache-action`)를 쓰면 `id-token: write` 권한이 필요하다. 대안은 `TURBO_TOKEN`/`TURBO_TEAM` 시크릿이다.
6. Vitest 프로젝트 단위 실행: `vitest --project <name>`은 Vitest 5 projects 기능으로 가능하다([미확인] 명령 문법은 이번에 확인 안 함).
7. pnpm 자체 필터 `--filter "...[origin/main]"`은 pnpm 문서 확인을 하지 못했다([미확인]).
8. Nx를 쓴다면 `nx affected -t test --base=origin/main` 계열 명령을 쓰지만, 이번 조사에서 공식 명령을 확인하지 못했다([미확인]).

참고 문서: [Turborepo running-tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks), [Turborepo run](https://turborepo.dev/docs/reference/run), [Turborepo GH Actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions).

---

## 종합 시사점 (사실 기준)

- 린트: oxlint 1.89 + type-aware 안정 상태는 공식으로 확인됐다. oxfmt는 아직 0.x이고 stable 발표를 찾지 못했다. oxfmt를 채택하면 Prettier 불일치 목록과 설정 형식 확인이 필요하다.
- 타입 체크: TS 7.0은 GA지만 programmatic API가 없다. typescript-eslint나 Vue·Astro·Svelte 에디터 지원을 쓴다면 6.0을 병행해야 한다.
- 테스트: 패키지별 설정을 문서화된 방식으로 쓸 수 있는 것은 Vitest 5 `projects`다. Vitest 5는 Vite ≥6.4와 Node ≥22.12가 필요하다.
- 빌드: Rolldown 1.0과 tsdown 0.23 조합은 Vite+ 스택과 맞는다. tsdown 0.23은 설정 이름 breaking이 있다.
- 런타임: Node 24는 Maintenance로 넘어가고 Node 26이 Active LTS로 간다. node:sqlite는 RC라서 프로덕션 의존으로는 리스크가 있다.
- 단일 바이너리: Bun은 공식으로 8개 타깃을 지원하지만 FTS5는 플랫폼별 검증이 필요하다. Node SEA는 `.node` 네이티브 애드온 로딩 제약이 있다.
- 데스크톱: Tauri의 sidecar는 공식으로 Node 엔진을 `@yao-pkg/pkg`로 묶는 방식을 안내한다. Bun 엔진 묶기는 공식 문서에 없다. Windows는 WebView2 설치 모드와 OV/Artifact Signing 준비가 필요하다.

[미확인] 항목 요약: oxfmt stable 발표와 설정 형식, oxlint `no-restricted-paths`, Biome 대비 공식 속도·메모리 수치, Vitest 메모리 공식 수치, node:sqlite의 Node 24 LTS 라벨, Node 26 Active LTS 공식 일정, better-sqlite3 플랫폼 매트릭스, bun:sqlite의 FTS5 포함 여부, Tauri sidecar 종료 시 프로세스 정리, Electrobun 코드 서명, TypeBox 1.0 breaking 목록, pnpm 12 stable의 공식 날짜, Turborepo `--affected`의 정식 버전 기본값, Nx affected 공식 문서.