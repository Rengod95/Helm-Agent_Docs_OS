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
- `console`(scripts와 apps/cli, apps/host 제외), default export는 lint가 막는다. 검사를 끄거나 우회하지 않는다.

### 타입과 실패 처리 (구속, `xeon-ts` 스킬)

정본은 `../docs/xeon/engineering/typescript/guide.md`(eng.typescript.guide) 1.3절 체크리스트와 2절 규칙이다. 구현·리뷰 작업자는 코드를 쓰기 전에 읽는다.

- `as` 단언 금지. `as unknown as T`, `<T>x`, `JSON.parse(s) as T`도 같다. `as const`만 허용. 예외는 TY-06 허용 목록 위치뿐이고, 줄마다 `// oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 <행 ID> <이유> (eng.typescript.guide TY-06)`를 단다.
- 비null 단언 `!`, `any`, `@ts-ignore`, `@ts-nocheck` 금지. `@ts-expect-error`는 테스트 파일의 타입 테스트에서만 이유를 달아 쓴다 (TY-02, TY-07, TY-08).
- 단언 대신 `parse`(TypeBox), 타입 가드, `satisfies`, 브랜드 생성 함수, 판별 유니온 + `assertNever`를 쓴다. 타입은 런타임에 지워지므로 경계 값은 항상 `parse`로 검증한다 (TY-10, TY-23).
- 예상 가능한 실패(I/O, busy, disk_full, read_only, cancelled, not_found, 검증 실패, ownership_lost, timeout, 저장 데이터 손상)는 `kind`가 있는 오류 값을 `Result`로 돌려준다. `throw`하지 않고 `Bug`로 던지지 않는다. `Bug`는 불변 조건 위반에만 쓴다 (TY-11, TY-24).
- `catch`는 오류를 조용히 삼키지 않는다. `cause`를 담은 오류 값으로 바꾸거나, 근거 문서가 있는 자리에서 주입된 Logger로 기록하거나, 그대로 다시 던진다 (TY-25).
- 던질 수 있는 외부 호출 하나는 `attempt`/`attemptAsync`, JSON 문자열은 `parseJson`, 기다리지 않는 비동기 호출은 `detach(work, onFailure)`로 받는다(`@xeon/contracts`, guide 1.2절). `try`/`catch`를 새로 쓰기 전에 먼저 이 도구를 쓸 수 있는지 본다. `catch`에서 받은 값을 `cause`로 담지 않으면 `preserve-caught-error`가 실패한다.
- 단언 허용 위치는 guide TY-06 표의 A1~A6뿐이다(예: ext-host의 `src/erase.ts`, 시험의 `unsafe.ts`·`fixtures/support.ts`). 시험의 부분 대역과 어긴 입력은 이 파일의 함수를 거치고 시험 본문에 `as`를 쓰지 않는다. 행을 더하려면 guide 표를 먼저 고치고 승인을 받는다.
- `just check-ts-rules`(`just verify`에 포함)가 단언 위치, `Bug` 메시지의 예상 가능한 실패 단어, 오류 삼킴, disable 주석 형식을 검사한다.
- 지킬 수 없는 줄이 있으면 주석으로 넘기지 말고 작업 보고에 `[미결] TY-NN <파일:줄> <이유>`로 적는다.
- 강제 lint 규칙 목록은 eng.typescript.guide 3.1.1절, 안티패턴 설명은 `eng.anti-patterns.guide` AP-C-01, AP-C-02, AP-C-10, AP-C-11이다.
- `vendor/cordis`는 고치지 않는다. 갱신은 새 커밋을 다시 복사하고 `UPSTREAM.json`을 고친다.

## 검사 명령

루트에서 `just <레시피>`로 부른다(`xeon/justfile`이 실제 명령).

| 레시피                                                                    | 내용                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `just setup`                                                              | `bun install --frozen-lockfile`                                                    |
| `just fmt` / `just fmt-check`                                             | oxfmt 적용 / 검사                                                                  |
| `just lint`                                                               | oxlint type-aware, `--deny-warnings`                                               |
| `just typecheck`                                                          | `tsc -b` (project references)                                                      |
| `just test [패키지 경로…]`                                                | `bun test`를 scripts와 패키지마다 하나씩, `guard.sh run` 상한(1.5GB, 5분) 아래에서 |
| `just check <패키지 경로>`                                                | 패키지 하나의 lint, typecheck, test를 차례로, 각각 `guard.sh run` 1.5GB 아래에서. turbo는 `--concurrency=1`이라 의존이 많은 패키지도 빈 캐시에서 상한 안에 든다 |
| `just check-layers`, `just check-ts-rules`, `just depcruise`, `just knip` | 층 순위, TS 작성 규칙 스캔, 의존 경계, 미사용 코드                                 |
| `just docs-route --check [--allow-missing]`                               | 문서 프런트매터, id, depends_on, binds 검사                                        |
| `just ci-layer <F\|X\|L0\|L1\|L2\|L3\|L4> [true]`                         | 한 층만 lint, typecheck, test (`true`는 turbo `--affected`)                        |
| `just verify`                                                             | 위 전부 + `ws check`. 기기에서 한 번에 하나, 단계마다 따로 2G, 시험은 패키지마다 1.5G |

### 병렬 작업 중 규칙

- 에이전트를 여럿 돌리는 동안에는 `just check <패키지>`와 `just test <패키지>`만 돌린다(예: `just check packages/core-tools`). 저장소 전체를 도는 `just verify`, `just lint`, `just typecheck`는 마지막 병합 단계 한 곳에서만 돌린다.
- 모든 무거운 명령은 `scripts/guard.sh run` scope(기본 1.5G, 공용 예산 `ws-dev.slice`) 안에서 돈다. 한도를 넘으면 그 실행만 종료되고(137) 기기는 살아 있다. `just verify`는 기기에서 하나만 돌고(슬롯 1) 단계를 차례로, 단계마다 따로 상한(2G, `XEON_VERIFY_STEP_MAX`)을 건다. 시험 단계는 감싸지 않고 `test-capped.sh`가 패키지마다 1.5G를 건다.
- pre-commit의 oxfmt, oxlint도 `guard.sh run` 1.5G 아래에서 돈다. cargo(`just desktop-*`)는 2G(`XEON_CARGO_MAX`).

종료코드 1은 고친다. 2는 환경 문제이므로 코드를 고치지 말고 보고한다. 3은 사람 확인 뒤 `--yes`.

## 문서 쓰기

`../docs/xeon/_templates/README.md`의 프런트매터와 문체 규칙을 따른다. 새 문서는 `docs-route --check`를 통과해야 한다.
