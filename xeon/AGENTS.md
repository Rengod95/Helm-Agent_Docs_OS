# Xeon 작업 규칙

Xeon(임시 이름)은 층으로 나뉜 대화형 에이전트 런타임이다. 코드는 이 `xeon/` 워크스페이스에, 문서는 `../docs/xeon/`에 있다. 루트 레거시 파일(`package.json`, `apps/`, `experiments/`, `packages/helm-*`)은 건드리지 않는다.

## 시작하기 전에

1. 읽을 문서를 라우팅으로 고른다. 작업자 프롬프트는 이 목록으로 시작한다.

   ```bash
   cd xeon
   just docs-route --task implement packages/core-loop/src/turn.ts   # 코드 작업
   just docs-route --task implement,data packages/platform-store     # 저장·이벤트를 건드릴 때
   just docs-route --task docs L1/loop                               # 문서 작업, <층>/<도메인> 형식도 된다
   ```

   - 작업 유형은 `implement`, `data`, `extension`, `docs`, `review`다(`docs/xeon/_routing/routes.yaml`의 `by_task`).
   - 출력은 읽을 문서 경로 목록이다. 코드 경로가 문서의 `binds`와 맞는 spec, plan, 층 README와 그 문서의 `depends_on` 한 단계가 따라온다.
   - 문서가 아직 없으면 경고가 나온다. 문서가 틀렸다고 판단되면 고치지 말고 `[미결]`로 보고한다.

2. 문서와 코드가 다르면 코드를 문서에 맞춘다.

## 층 규칙

순위: F(0) → X(1) → L0(2) → L1(3) → L2(4) → L3(5) → L4(6).

| 층   | 패키지                                         |
| ---- | ---------------------------------------------- |
| F    | `packages/contracts`                           |
| X    | `packages/ext-host` (Cordis는 여기서만 import) |
| L0   | `packages/platform-*`                          |
| L1   | `packages/core-*`, `plugins/*`                 |
| L2   | `packages/cap-*`                               |
| L3   | `packages/group-*`                             |
| L4   | `apps/*`                                       |
| 제외 | `vendor/*` (층 검사, lint, 포맷 대상 아님)     |

- 패키지는 자기보다 낮은 순위만 import한다. 같은 층 패키지끼리는 import하지 않는다. 같은 층 협력은 F 정의와 Cordis 서비스로만 한다.
- 각 `package.json`의 `"xeon": {"layer", "domain"}`이 기준이다. 디렉터리 이름과 층이 맞아야 한다.
- 의존을 더하면 `package.json`에 `"@xeon/<이름>": "workspace:*"`를 적고, 그 패키지 `tsconfig.json`의 `references`에 대상 패키지를 더한다.
- 다른 패키지는 `@xeon/<이름>`의 exports로만 import한다. `src`, `dist`, 상대 경로로 들어가지 않는다.
- 강제 수단: `just check-layers`(package.json과 import), `just depcruise`(경로 규칙, 순환), oxlint `no-restricted-imports`와 `import/no-cycle`.

## 코드 규칙

- TypeScript 7(tsgo) strict. `isolatedDeclarations`가 켜져 있으므로 export 선언에 타입을 명시한다. `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`(enum, namespace, parameter property 금지).
- 내부 패키지는 TS 소스를 그대로 export한다(`"exports": {".": "./src/index.ts"}`). 빌드 산출물에 의존하지 않는다.
- 테스트는 `bun test`, 패키지의 `test/*.test.ts`. 단위 테스트를 함께 둔다. vitest, jest를 쓰지 않는다.
- 스키마는 `typebox`(1.x). SQLite는 `bun:sqlite`만 쓴다.
- `any`, 비null 단언(`!`), `console`(scripts와 apps/cli, apps/host 제외), default export는 lint가 막는다. 검사를 끄거나 우회하지 않는다.
- `vendor/cordis`는 고치지 않는다. 갱신은 새 커밋을 다시 복사하고 `UPSTREAM.json`을 고친다.

## 검사 명령

루트에서 `just <레시피>`로 부른다(`xeon/justfile`이 실제 명령).

| 레시피                                             | 내용                                                        |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `just setup`                                       | `bun install --frozen-lockfile`                             |
| `just fmt` / `just fmt-check`                      | oxfmt 적용 / 검사                                           |
| `just lint`                                        | oxlint type-aware, `--deny-warnings`                        |
| `just typecheck`                                   | `tsc -b` (project references)                               |
| `just test`                                        | `bun test` (scripts와 각 패키지)                            |
| `just check-layers`, `just depcruise`, `just knip` | 층 순위, 의존 경계, 미사용 코드                             |
| `just docs-route --check [--allow-missing]`        | 문서 프런트매터, id, depends_on, binds 검사                 |
| `just ci-layer <F\|X\|L0\|L1\|L2\|L3\|L4> [true]`  | 한 층만 lint, typecheck, test (`true`는 turbo `--affected`) |
| `just verify`                                      | 위 전부 + `ws check`. 끝내기 전에 통과시킨다                |

종료코드 1은 고친다. 2는 환경 문제이므로 코드를 고치지 말고 보고한다. 3은 사람 확인 뒤 `--yes`.

## 문서 쓰기

`../docs/xeon/_templates/README.md`의 프런트매터와 문체 규칙을 따른다. 새 문서는 `docs-route --check`를 통과해야 한다.
