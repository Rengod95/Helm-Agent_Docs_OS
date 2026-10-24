# cap-dialog 포크 패치 기록

`src/upstream/pi/prompt-templates.ts`는 pi coding-agent의 프롬프트 템플릿 코드의 포크다(인자 분리, 치환, 파일 읽기, 앞머리 해석). 원본 저장소, 커밋, 복사 경로, 파일별 sha256은 `UPSTREAM.json`에 있다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스와 테스트의 `// XEON-PATCH: <id>` 표지.
`test/fork-records.test.ts`가 이를 검사한다. 근거 문서는 `L2.dialog.plan` §4.2, `adr.0003` §3.4다.
고친 줄 위에 표지를 단다. 줄 번호는 원본(커밋 `cdaf6c2`, `packages/coding-agent/`) 기준이다.

## 패치 표

| 패치 id | 파일:줄                                                           | 바꾸는 점과 이유                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 확인 테스트                                                                         |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| P1      | `src/core/prompt-templates.ts:1-8,103-243`                        | `fs`의 `existsSync`, `readdirSync`, `readFileSync`, `statSync` 직접 호출을 주입한 비동기 파일 포트(`CommandFiles`, 구현은 `xeon.exec`의 파일 시스템)로 바꾼다. `ResourceDiagnostic`은 로컬 타입 `CommandDiagnostic`이다. `loadTemplateFromFile`은 읽기와 해석을 나누어 해석부(`loadTemplateFromContent`)만 남기고, 디렉터리 읽기는 파일을 한꺼번에 읽은 뒤 이름 순으로 처리한다. 디렉터리가 없으면 빈 결과이고, 끊어진 심볼릭 링크는 조용히 건너뛴다(pi 동작). 함수가 `async`가 된다 | `prompt-templates.test.ts`, `commands-loader.test.ts`                               |
| P2      | `src/core/prompt-templates.ts:11-19`                              | `PromptTemplate`에서 `sourceInfo`(`../source-info.ts`)를 뺀다. 출처 등급은 `commands/` 모듈이 디렉터리로 정한다. 앞머리 `args`의 원본 값 `rawArgs`를 더한다                                                                                                                                                                                                                                                                                                                          | `tsc -b`                                                                            |
| P3      | `src/core/prompt-templates.ts:28-46,70-100`                       | `eng.typescript.guide`에 맞춘 형 보정이다. `parseCommandArgs`의 인덱스 순회(`argsString[i]`는 `noUncheckedIndexedAccess`에서 `undefined`가 될 수 있다)를 문자열 순회로 바꾼다. 인용 부호와 공백만 비교하므로 결과는 같다. `substituteArgs`의 `replace` 콜백 매개변수에 타입을 달고 `defaultValue`가 없을 때 빈 문자열로 둔다. 정규식과 치환 규칙은 손대지 않았다                                                                                                                     | `prompt-templates.test.ts`의 `substituteArgs`, `parseCommandArgs` 묶음 전부         |
| P4      | `src/utils/frontmatter.ts` 전체, `src/utils/text.ts`의 `stripBom` | `yaml` 패키지를 쓰지 않고 `Bun.YAML.parse`를 쓴다(L2.dialog.plan §4.1). `stripBom`은 같은 파일에 한 줄로 옮긴다. 앞머리가 매핑이 아니면(문자열, 배열) 던져 그 파일만 건너뛰게 한다. 반환은 `unknown`을 걸러낸 `Readonly<Record<string, unknown>>`이다. BOM 제거와 줄바꿈 정규화, `---` 경계 찾기는 원본 그대로다                                                                                                                                                                     | `prompt-templates.test.ts`의 `loadTemplatesFromDir` 묶음, `commands-loader.test.ts` |
| P5      | `src/core/prompt-templates.ts:157`                                | 앞머리 `args` 필드를 읽는다(Xeon 추가 필드, L2.dialog.spec §4.2.1). 이 파일은 값을 해석하지 않고 `rawArgs`로 넘긴다. 검사는 `commands/loader.ts`가 한다                                                                                                                                                                                                                                                                                                                              | `commands-loader.test.ts`                                                           |
| P6      | `src/core/prompt-templates.ts:246-320`                            | `loadPromptTemplates`(전역·프로젝트·명시 경로 순회와 `CONFIG_DIR_NAME`)는 지운다. 디렉터리 목록과 출처 우선순위는 `commands/service.ts`가 정한다(L2.dialog.spec §4.2.3, pi와 달리 프로젝트가 사용자보다 앞선다). `expandPromptTemplate`의 첫 일치 방식도 지우고 구문 분해만 `parseCommandLine`으로 남긴다(정규식은 원본 그대로)                                                                                                                                                      | `prompt-templates.test.ts`의 `parseCommandLine` 묶음, `commands-priority.test.ts`   |
| P7      | `test/prompt-templates.test.ts` 전체                              | `vitest` import를 `bun:test`로 바꾼다. `substituteArgs`, `parseCommandArgs`, 통합 묶음은 그대로 옮겼다. 파일 시스템을 쓰는 `loadPromptTemplates` 테스트는 메모리 파일 원천(`test/support/memory-command-files.ts`) 위의 `loadTemplatesFromDir` 테스트로, `expandPromptTemplate` 테스트는 `parseCommandLine` 테스트로 다시 썼다. 진단 테스트는 YAML 오류의 줄·열 문구(`yaml` 패키지의 메시지) 대신 진단이 하나이고 메시지가 비지 않음을 본다. 들여쓰기는 탭에서 공백 2칸으로 바꾸었다 | `bun test`                                                                          |

## 복사 범위(패치가 아니라 선택)

- `core/prompt-templates.ts`: 치환 함수 둘(`parseCommandArgs`, `substituteArgs`)은 본문 그대로다. `L2.dialog.plan` §7이 정한 대로 손대지 않고 pi 테스트를 그대로 옮겨 회귀를 잡는다.
- `core/slash-commands.ts`(44줄)는 복사하지 않았다. `SlashCommandSource`는 F `CommandSourceSchema`, `SlashCommandInfo`는 F `CommandInfo`가 이미 같은 구조로 갖고 있고 `BUILTIN_SLASH_COMMANDS`는 쓰지 않는다. 클라이언트 고유 명령은 L4가 `builtin` 출처로 선언한다(`declareBuiltin`). pi 목록은 참고로도 가져오지 않았다.
- `utils/frontmatter.ts`: 위 P4.

## 서식

`bun run fmt-check`(oxfmt, 공백 2칸, 100열)가 `src`와 `test` 전체를 검사하므로 복사한 뒤 포크 파일도 같은 서식으로 다시 찍었다. 원본은 탭 들여쓰기라 줄 단위 diff가 크다.

## 린트 예외 주석

포크 코드에는 `oxlint-disable` 주석을 두지 않는다. `eng.typescript.guide` §1은 업스트림 병합 비용을 억제 주석의 사유로 인정하지 않는다. 린트가 걸리는 줄은 P3처럼 고쳐 쓰고 `XEON-PATCH` 표지를 단다.

## 확인 기록

- 2026-10-24 원본 대조: 로컬 사본(`~/projects/_ref/pi-src`)의 `HEAD`가 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`이고 복사한 파일 둘과 테스트, `LICENSE`의 sha256을 `UPSTREAM.json`에 적었다. 원격 대조는 하지 않았다. npm 1.3.0과 로컬 1.1.0의 두 파일 차이는 확인하지 않았다 [가정: 치환 함수는 같다](L2.dialog.plan §4.2).
