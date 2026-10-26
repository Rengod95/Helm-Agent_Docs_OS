---
id: adr.0001
layer: adr
domain: stack
kind: adr
status: accepted
depends_on: []
binds: [xeon/package.json, xeon/bunfig.toml, xeon/turbo.json, xeon/tsconfig.base.json, xeon/.oxlintrc.json, xeon/.oxfmtrc.json]
---

# ADR-0001 스택: Bun 1.4, TypeScript 7, 개별 도구 툴체인

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- 개정: 2026-10-22 `review.decisions-2` U-24(§3 스키마 행 TypeBox 판을 1.3.27로 정정, pi-ai 1.3.0·sandbox-runtime 0.0.79 정확 고정). 계열을 바꾸지 않는 보충이라 같은 ADR 안에서 고쳤다(`adr.readme` §1.4).
- [결정] 사용자가 `_research/foundation-plan.md §2` 스택 표를 담은 계획을 승인했다("승인 = 컨펌"). 런타임 Bun 1.4와 개별 도구 툴체인(oxlint·oxfmt·tsgo·bun test·turbo)은 `_research/decisions-log.md` 2026-10-21 결정(3차)의 사용자 지시다.

## 2. 맥락

- 저장소에는 서로 다른 관례가 두 개 있다(`_research/repo-survey.md §0` 2번, `§6.1` 1·2번).
  - Helm 설계 정본(`docs/design/06`)은 Node 24, TypeScript 6.0 strict ESM, pnpm 11, Vitest, ESLint flat config, `tsc -b`, TypeBox, better-sqlite3를 정했다.
  - 현재 미커밋 구현 코드는 JavaScript(`.mjs`), npm workspaces, `node --test`이고 린트·포맷·tsconfig 설정이 없다.
- Xeon은 `xeon/` 독립 워크스페이스로 시작하므로(`_research/foundation-plan.md §1` 코드 위치 행) 두 관례 어느 쪽도 그대로 물려받을 이유가 없다. 스택을 새로 정해야 한다.
- 사용자 지시는 런타임 Bun 1.4와 개별 도구 툴체인이다(`_research/decisions-log.md` 3차).
- 2026-10-21 기준 도구 상태(`_research/stack-status.md`):
  - TypeScript 7.0은 2026-07-08 GA다. npm 최신은 7.0.2다. 7.0에는 안정 programmatic API가 없고 새 API는 7.1 예정이다(`§2`).
  - oxlint type-aware 린트는 2026-07-22 stable 발표다. oxlint 최신은 1.89.0이고 oxlint-tsgolint는 TS 7.0.x 특정 릴리스에 묶인다(`§1-A`, `§2` tsgolint 결합 행).
  - oxfmt는 0.74.0으로 0.x 라인이다. stable/1.0 발표는 찾지 못했다(`§1-A`, `§1-B`).
  - Vitest 5는 Vite ≥6.4와 Node ≥22.12를 요구한다(`§3-A`). Vitest는 Node 위에서 돌기 때문에 `bun:sqlite` 같은 Bun 전용 API를 쓰는 테스트를 실행하지 못한다(`_research/foundation-plan.md §2` 테스트 행).
  - Node SEA는 `.node` 네이티브 애드온을 VFS에서 로드하지 못하고, 생성 Node와 주입 Node 버전이 같아야 한다(`§7-B`). better-sqlite3를 단일 실행 파일에 넣으면 이 제약에 걸린다.
  - `bun build --compile`은 8개 타깃(linux x64/arm64 glibc·musl, windows x64/arm64, darwin x64/arm64)을 공식 지원한다(`§7-C`).
  - Turborepo 2.11은 `--affected`를 지원하고, 층 경계 강제는 기본 기능이 없다. dependency-cruiser가 그 역할을 맡는다(`§5-B`, `§5-E`, `§6`).

## 3. 결정

[결정] 아래 표는 `_research/foundation-plan.md §2`의 스택 표를 버전까지 그대로 옮긴 것이다. "catalog 고정 값" 열은 작성 시점 `xeon/package.json`의 catalog 값이며 정보용이다. 둘이 어긋나면 이 표의 결정 열이 기준이고, catalog를 결정 열 범위 안으로 맞춘다.

| 영역 | 결정 | catalog 고정 값(정보용) |
|---|---|---|
| 런타임·패키지 관리 | Bun 1.4.x, Bun workspaces + catalog. `packageManager: bun@1.4.3` | `bun@1.4.3`, `@types/bun` 1.4.3 |
| 언어·타입 검사 | TypeScript 7.0.x(`tsc` = tsgo), strict. 추가 옵션 `isolatedDeclarations`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` | `typescript` 7.0.2 |
| 린트 | oxlint 1.89 + type-aware(oxlint-tsgolint, TS 7.0.2 대응). `import/no-cycle`, `no-restricted-imports` 사용 | `oxlint` 1.89.0, `oxlint-tsgolint` 7.0.2004 |
| 포맷 | oxfmt 0.74(0.x라 정확 고정). 문제가 생기면 그 파일만 제외한다. Biome로 되돌리지 않는다 | `oxfmt` 0.74.0 |
| 테스트 | `bun test`(패키지별 실행, `--coverage`) | Bun 내장 |
| 태스크 러너 | Turborepo 2.11(`--affected`, 캐시) | `turbo` 2.11.10 |
| 경계·위생 | dependency-cruiser 18(층 순위 규칙), knip 6(미사용 코드), publint와 attw(공개 패키지만), 자체 `scripts/check-layers.ts` | `dependency-cruiser` 18.7.0, `knip` 6.42.1 |
| 빌드 | 내부 패키지는 TS 소스를 그대로 export한다. 바이너리는 `bun build --compile`(CLI, 사이드카). 공개 라이브러리만 tsdown 0.23 | 공개 라이브러리 없음(작성 시점) |
| 스키마 | TypeBox 1.x | `typebox` 1.3.27(pi-ai 고정 판과 같음, `review.decisions-2` U-24) |
| DB | `bun:sqlite`(WAL, 단계 경계 FULL). 세부는 ADR-0004 | Bun 내장 |
| 커밋 전 검사·작업 진입점 | lefthook(pre-commit에서 oxfmt, oxlint, gitleaks), `xeon/justfile`(`just verify`) | — |

이 ADR이 다루지 않는 스택 항목은 다른 ADR과 스펙이 정한다.

- DI·플러그인(Cordis 4.0.0-rc.x vendored): ADR-0002
- DB 사용 방식(이벤트 소싱, 단일 DB): ADR-0004
- 데스크톱 셸(Tauri 2.12 + 사이드카): ADR-0008
- 모델(`@earendil-works/pi-ai` 1.3.0): `L1.models.spec`. 루프는 pi-agent-core 1.3.0을 포크한 자체 루프이고 pi-agent-core에 의존하지 않는다: ADR-0009, `L1.loop.spec`
- MCP(`@modelcontextprotocol/client` 2.3.1): `L2.mcp.spec`
- 샌드박스, 웹, 비밀 도구: `L0.sandbox.spec`, `L2.web.spec`, `L0.secrets.spec`

세부 규칙:

- [결정] tsgolint와 TypeScript 7.0.x는 함께 고정한다. 한쪽만 올리지 않는다(`_research/foundation-plan.md §7`).
- [결정] `isolatedDeclarations`를 켜므로 d.ts 생성에 TypeScript programmatic API가 필요 없다. TS 7.0에 API가 없다는 제약(`_research/stack-status.md §2`)을 이 옵션으로 피한다.
- [제안] 툴체인 사용법(명령, CI job, `just` 레시피)은 `eng.toolchain.guide`가 정한다. 이 ADR은 선택과 버전만 정한다.

## 4. 결과

### 4.1 좋은 점

- 속도: oxlint type-aware는 벤더 측정으로 ESLint+typescript-eslint 대비 12~18배, TS 7은 전체 빌드 8~12배다(`_research/stack-status.md §1-D`, `§2`). 벤더·2차 수치이므로 자체 측정 전까지 방향만 신뢰한다.
- 런타임과 테스트 러너가 같다. `bun test`가 `bun:sqlite`, `Bun.spawn` 같은 Bun API를 그대로 실행하므로 테스트용 Node 경로를 따로 두지 않는다.
- 단일 바이너리: `bun build --compile` 하나로 CLI와 데스크톱 사이드카를 만든다. 네이티브 SQLite 애드온이 없으므로 Node SEA의 `.node` 로딩 제약이 없다(`§7-B`, `§7-C`).
- `isolatedDeclarations` 덕분에 d.ts 생성에 TS API가 필요 없다. 내부 패키지는 TS 소스를 그대로 export하므로 빌드 단계가 없다.
- 각 도구가 한 가지 일을 맡는다(타입 검사 tsgo, 린트 oxlint, 포맷 oxfmt, 경계 dependency-cruiser·check-layers, 미사용 knip, 태스크 turbo). 한 도구를 바꿔도 다른 도구 설정이 바뀌지 않는다.

### 4.2 감수할 점

- oxfmt는 0.x다. 마이너 버전마다 출력이 바뀔 수 있고 `--migrate prettier` 경로가 0.73에서 breaking 변경됐다(`_research/stack-status.md §1-B`). 정확 고정으로 대응하고, 포맷 결과가 깨지는 파일은 그 파일만 제외 목록에 둔다.
- tsgolint가 TS 7.0.x 특정 릴리스에 묶이므로 TypeScript 패치 업그레이드도 tsgolint 릴리스를 기다려야 한다.
- `bun:sqlite`의 FTS5 가용성이 플랫폼마다 다르다.
  - Linux·Windows: Bun 1.4.3 소스가 번들 SQLite에 `SQLITE_ENABLE_FTS5: 1`을 정의한다(`_research/notes/arch-3.md §3.1`).
  - macOS: Apple 시스템 `libsqlite3.dylib`을 쓰며 FTS5 포함 여부는 확인하지 못했다. FTS5가 있는 SQLite(예: Homebrew)를 `Database.setCustomSQLite(path)`로 지정한다. 이 호출은 첫 `Database`를 열기 전에 해야 한다(`_research/notes/arch-3.md §3.2`).
  - 그래서 시작 시 FTS5 검사가 필요하다. 절차는 ADR-0004와 `L0.store.spec`이 정한다.
- Playwright가 Bun에서 동작하지 않으면 브라우저 도구는 Node 자식 프로세스로 우회한다(`_research/foundation-plan.md §7`). 이 경우 배포물에 Node 실행 파일 또는 사용자의 Node 설치가 필요해진다. 세부는 `L2.web.spec`이 정한다.
- Bun 사이드카 크기: 공식 문서가 "still way too big"라고 적고 수치는 없다(`_research/stack-status.md §7-C`). 데스크톱 설치 크기에 그대로 더해진다. 대응은 ADR-0008과 `L4.desktop.plan`이 다룬다.
- Helm 설계 정본(Node 24, pnpm, Vitest, better-sqlite3)과 스택이 다르다. 정본의 코드 예시와 설정을 그대로 옮길 수 없다.
- dependency-cruiser, knip, tsdown은 npm 메타데이터상 Node engines를 선언한다(`_research/stack-status.md §4`, `§6`). Bun으로 실행할 때의 호환은 확인하지 않았다(§5 가정 목록).

### 4.3 되돌림 조건

이 결정은 다음 중 하나가 생기면 새 ADR로 다시 검토한다. Bun 1.4 계열에서 `bun:sqlite`나 `bun build --compile`의 결함이 M1 걸어 다니는 골격(`xeon chat` 한 턴, 강제 종료 후 재개)을 막고 우회가 없을 때, Playwright·MCP SDK·pi-ai 중 둘 이상이 Bun에서 동작하지 않아 Node 자식 프로세스 우회가 런타임 핵심 경로로 번질 때, oxfmt 제외 파일이 워크스페이스의 상당 부분(예: 10% 이상)으로 늘 때, 또는 tsgolint가 TypeScript 7.x 보안 패치를 한 달 넘게 따라오지 못할 때다. 되돌릴 때 우선 후보는 대안 표의 Node 24 + pnpm + Vitest 조합이다. 이 경우 `bun:sqlite` 테스트는 `node:sqlite` 또는 better-sqlite3로 옮겨야 하므로 `L0.store` 구현 교체가 함께 따른다. 결정 뒤 되돌림은 새 ADR을 쓰고 이 ADR을 superseded로 표시하는 절차를 따른다(`adr.readme` §1).

## 5. 대안

| 대안 | 내용 | 채택하지 않은 이유 |
|---|---|---|
| Node 24 + pnpm + Vitest | Helm 설계 정본 스택(`_research/repo-survey.md §0` 2번) | 사용자가 Bun 1.4를 선택했다(`_research/decisions-log.md` 3차). Vitest는 `bun:sqlite` 등 Bun API를 쓰는 테스트를 돌리지 못한다. Node 24는 2026-10-20에 Maintenance로 넘어갔다(2차, `_research/stack-status.md §7-A`) |
| Node SEA 단일 실행 파일 | Node 엔진을 SEA로 묶어 CLI·사이드카 배포 | stability 1.1(Active development). `.node` 네이티브 애드온 VFS 로드 불가, 생성·주입 Node 버전 일치 필요, 크로스 빌드에서 code cache 불가(`§7-B`) |
| Biome 2.x(린트+포맷) | 단일 도구로 린트와 포맷 | 사용자 지시가 oxlint·oxfmt 개별 도구다. oxfmt 문제 시에도 Biome로 되돌리지 않는다(`_research/foundation-plan.md §2` 포맷 행) |
| Nx 23 | 그래프 기반 affected, `enforce-module-boundaries` | 경계 강제는 dependency-cruiser + `check-layers.ts`로 충분하다. language-agnostic conformance는 Enterprise 전용이다(`§5-C`). 설정량이 Turborepo보다 많다 |
| Vite+ 1.x(`vp`) | Vite 8, Vitest, Oxlint, Oxfmt, Rolldown, tsdown 통합 | Node 런타임 전제이고 Vitest를 포함한다. npm 1.3.0이 oxlint `=1.88.0`, oxfmt `=0.73.0`으로 고정해 이 ADR의 버전과 다르다(`§5-D`) |
| better-sqlite3 13 | 네이티브 애드온 SQLite | Bun 런타임에서는 `bun:sqlite`가 내장이다. 단일 실행 파일에 네이티브 애드온을 넣는 제약이 생기고, v13 prebuilt 플랫폼 목록이 확인되지 않았다(`§7-E`) |
| `node:sqlite` | Node 내장 SQLite | stability 1.2 Release candidate, CVE-2026-58041 수정 버전 미확인(`§7-A`). Bun 런타임 결정과 맞지 않는다 |
| pnpm 12 | Rust 재작성 패키지 매니저 | Bun workspaces + catalog로 같은 기능을 얻는다. 도구를 하나 줄인다 |
| Electron(데스크톱) | Chromium 번들 데스크톱 | 이 ADR의 범위가 아니다. Tauri 2 선택은 ADR-0008에서 다룬다 |

## 6. 가정

`_research/stack-status.md`가 [미확인]으로 남긴 항목 중 이 결정에 걸리는 것을 [가정]으로 둔다. 각 항목은 첫 구현 작업에서 확인하고, 깨지면 이 ADR의 감수할 점이나 되돌림 조건으로 옮긴다.

- [가정] Linux x64·arm64와 Windows의 배포된 Bun 1.4.3 바이너리에서 FTS5가 동작한다. 소스 정의(`SQLITE_ENABLE_FTS5: 1`)는 확인했고 실행 결과(`PRAGMA compile_options`, FTS5 가상 테이블 생성)는 확인하지 않았다(`_research/notes/arch-3.md §4` 1·2번).
- [가정] `bun build --compile` 산출물은 Bun 런타임과 같은 SQLite 빌드 정의를 그대로 가진다(`_research/notes/arch-3.md §4` 3번).
- [가정] macOS에서 Homebrew sqlite dylib(`-DSQLITE_ENABLE_FTS5=1`)을 `setCustomSQLite`로 지정하면 FTS5가 동작한다. Apple 시스템 빌드의 FTS5 포함 여부는 확인하지 않았다(`_research/notes/arch-3.md §4` 4·5번).
- [가정] oxfmt 설정 파일은 `.oxfmtrc.json` 형식으로 읽힌다. 공식 포매터 문서에 형식 명시가 없다(`_research/stack-status.md §1-B`).
- [가정] `bun test`는 패키지 디렉터리 단위 실행으로 패키지별 테스트를 나눌 수 있다. workspace/projects 설정 문서는 확인하지 않았다(`§3-C`).
- [가정] Turborepo `--affected`의 기본 세분화는 패키지 단위다. 정식 버전 기본값은 확인하지 않았다(`§5-B`).
- [가정] TypeBox 1.x(`typebox` 패키지)는 0.34(`@sinclair/typebox`)와 다른 패키지다. 판은 pi-ai가 정확 고정한 1.3.27로 맞춘다(`review.decisions-2` U-24). 1.4로 올리는 시점은 pi가 올릴 때다. 1.0 breaking 목록과 이주 가이드는 확인하지 못했다(`§8`).
- [가정] dependency-cruiser 18, knip 6, tsdown 0.23은 Bun으로 실행해도 동작한다. 세 도구 모두 npm engines에 Node만 적는다(`§4`, `§6`).
- [가정] 엔진·UI 경계 밖의 Node 전용 도구(Playwright 등)는 Node 자식 프로세스 우회로 충분하다.
- [가정] `setCustomSQLite`의 반환값으로 플랫폼을 판별하지 않는다. 1.4.3 소스는 비-macOS에서도 `true`를 반환하므로 `_research/stack-status.md §7-D`의 "`false` 반환" 기술은 1.4.3과 맞지 않는다(`_research/notes/arch-3.md §3.2`).

## 7. 미결 사항

- 닫음 [결정: review.m3-design-inputs D-M3-25 행 6]: M3에서 npm에 공개하는 패키지는 없다. tsdown·publint·attw는 공개를 정할 때 다시 본다.
- [미결] 자체 성능 측정 여부. 속도 수치는 벤더·2차 자료다. `hyperfine`으로 oxlint+oxfmt와 tsgo를 측정할지 정한다(`_research/stack-status.md §1-D`).
- [결정: review.m3-design-inputs D-M3-29 행 1] 의존 버전은 현재 버전으로 고정하고 점진 업데이트를 운영 정책으로 둔다. 아래 미결은 그 정책의 Bun 세부다.
- [미결] Bun 1.4.x 패치 업그레이드 정책. `packageManager`는 정확 버전(1.4.3)이고 결정은 1.4.x다. 패치를 올리는 조건(FTS5 탐침 재실행, 바이너리 크기 확인)을 `eng.toolchain.guide`가 정할지 이 ADR에 둘지 정한다.
- [미결] Playwright의 Bun 호환 확인 시점. 기본 브라우저 provider는 Stagehand다 [결정: review.m3-design-inputs D-M3-23]. Stagehand 실행 런타임 확인(M3-new-13)에서 함께 본다.
- [미결] Windows 네이티브 지원 시점의 스택 재확인. 첫 지원 OS는 macOS와 Linux(WSL 포함)다(`_research/decisions-log.md` 2026-10-19).
