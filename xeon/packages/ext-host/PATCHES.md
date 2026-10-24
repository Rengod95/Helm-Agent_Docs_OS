# ext-host 포크 패치 기록

`src/loading-trust/trust/`의 `store.ts`, `resources.ts`, `resolve.ts`는 pi coding-agent 1.1.0(MIT) `core/trust-manager.ts`와 `core/project-trust.ts`의 함수를 옮겨 Xeon 로더 포트(`LoaderFs`, `TrustStoreBackend`, `TrustPrompter`)에 맞게 바꾼 것이다(`X.loading-trust.spec` §4.7.1).
원본 패키지, 판, 커밋, 복사 범위는 `UPSTREAM.json`에 있다. 라이선스 원문은 `LICENSE.pi`다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// XEON-PATCH: <id>` 표지. `test/loading-trust/fork-records.test.ts`가 이를 검사한다.
원본 줄 번호는 pi 1.1.0 기준이다. 새 판은 따라가지 않는다.

## 패치 표

| 패치 id                   | 위치                                                                    | 바꾸는 점과 이유                                                                                                         | 확인 테스트               |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `verdict-type`            | `store.ts` (원본 `ProjectTrustDecision`)                                | `boolean \| null`을 `allow`/`deny`/`undecided` 세 값으로 바꾼다. `undecided`는 저장하지 않는다                           | `trust-resolve.test.ts`   |
| `trust-file-schema`       | `store.ts` (원본 `TrustFile`, `writeTrustFile`)                         | 저장 파일을 `{ version: 1, entries }`로 바꾸고 `decidedAt`, `via`를 남긴다. 키는 사전순으로 쓴다                         | `trust-store.test.ts`     |
| `store-errors`            | `store.ts` (원본 `setMany`의 예외)                                      | 쓰기 실패를 던지지 않고 `Result<void, TrustStoreError>`(`corrupt`, `io`)로 돌려준다. 손상 파일에는 쓰지 않는다(TY-24)    | `trust-store.test.ts`     |
| `strip-bom-local`         | `store.ts` (원본 `../utils/text.ts` `stripBom`)                         | 유틸 결합을 끊고 세 줄 로컬 함수로 둔다                                                                                  | `trust-store.test.ts`     |
| `corrupt-as-value`        | `store.ts` (원본 `readTrustFile`, 85-110)                               | 읽기·파싱·스키마 실패를 던지지 않고 `TrustLookup { kind: "corrupt" }`로 돌려준다. 엔진이 시작하지 못하는 일을 막는다     | `trust-store.test.ts`     |
| `pi-v0-format`            | `store.ts` (원본 `Record<path, boolean \| null>`)                       | 버전 없는 pi 파일을 손상으로 보지 않고 같은 의미로 읽는다. 다음 쓰기에서 버전 1로 바꾼다                                 | `trust-store.test.ts`     |
| `injected-normalize`      | `store.ts` (원본 `normalizeCwd`, `canonicalizePath`)                    | 경로 정규화를 팩토리 `createProjectTrustStore`의 인자 `normalize`(`LoaderFs.realpath` 기반)로 받는다                     | `trust-store.test.ts`     |
| `async-backend`           | `store.ts` (원본 `node:fs` 동기 호출)                                   | 동기 파일 호출을 비동기 `TrustStoreBackend.read`로 바꾼다. 함수 시그니처가 모두 비동기가 된다                            | `trust-store.test.ts`     |
| `no-lockfile`             | `store.ts` (원본 `acquireTrustLockSync`, 138-177)                       | `proper-lockfile`과 바쁜 대기를 지운다. `TrustStoreBackend.update` 한 번으로 잠금과 원자 교체를 맡긴다                   | `trust-store.test.ts`     |
| `options-localized`       | `store.ts` (원본 `getProjectTrustOptions`, 67-97)                       | 영어 라벨 문장 대신 식별자 라벨 다섯 개(`trust-folder` 등)와 F 타입 `TrustOption`을 돌려준다. 표시는 L4가 현지화한다     | `trust-store.test.ts`     |
| `config-dir-constant`     | `resources.ts` (원본 `CONFIG_DIR_NAME`)                                 | `../config.ts` 결합을 끊고 상수 `.xeon`을 둔다                                                                           | `trust-resources.test.ts` |
| `resource-list`           | `resources.ts` (원본 `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`, 30-39) | pi의 여덟 항목을 Xeon 자원 이름 열한 항목(`X.loading-trust.spec` §4.7.2)으로 바꾼다                                      | `trust-resources.test.ts` |
| `find-list`               | `resources.ts` (원본 `hasTrustRequiringProjectResources`, 186-208)      | 불리언을 찾은 자원의 목록으로 바꾼다. 프롬프트와 진단에 보인다. 상위 디렉터리의 `.agents/skills`는 상대 경로로 적는다    | `trust-resources.test.ts` |
| `injected-fs-home`        | `resources.ts` (원본 `existsSync`, `homedir()`)                         | `LoaderFs.exists`와 `homeDir` 인자로 바꾼다. 사용자 홈의 `.agents/skills`는 제외한다                                     | `trust-resources.test.ts` |
| `decision-order`          | `resolve.ts` (원본 `resolveProjectTrusted`, 47-97)                      | pi의 순서를 유지하고 세션 기억, 저장 파일 손상, 비대화형 불신을 더한다. 결과에 `via`, `resources`, `storeError`를 싣는다 | `trust-resolve.test.ts`   |
| `point-fail-closed`       | `resolve.ts` (원본 `emitProjectTrustEvent` 오류 처리)                   | `project_trust` 발화가 던지면 보고하고 넘어가지 않고 불신으로 끝낸다(F fail-closed)                                      | `trust-resolve.test.ts`   |
| `corrupt-store-no-prompt` | `resolve.ts`                                                            | 저장 파일이 손상이면 프롬프트를 띄우지 않는다. 띄워서 저장하면 다른 폴더의 결정이 든 손상 파일을 덮어쓴다                | `trust-resolve.test.ts`   |
| `prompter-port`           | `resolve.ts` (원본 `ctx.ui.select`, `hasUI`)                            | UI 호출을 `TrustPrompter` 포트와 `LoaderMode`로 바꾼다. 안내 문장(`formatProjectTrustPrompt`)은 지우고 L4가 만든다       | `trust-resolve.test.ts`   |

## 복사하지 않은 것

`UPSTREAM.json`의 `notCopied`가 정본이다. 잠금(`acquireTrustLockSync`, `withTrustFileLock`), 안내 문장 만들기와 선택 UI, 확장 결과·UI 컨텍스트 타입은 가져오지 않았다.
