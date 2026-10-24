---
id: L2.workspace.plan
layer: L2
domain: workspace
kind: plan
status: draft
depends_on: [L2.workspace.spec, F.capabilities.plan, L0.exec.plan, L1.tools.plan]
binds: [xeon/packages/cap-workspace/**]
---

# L2 작업 도구 구현 계획

대상 스펙: `L2.workspace.spec`. 패키지: `@xeon/cap-workspace`(`xeon/packages/cap-workspace`). 정의 파일: `@xeon/contracts`의 `src/capabilities/defs/workspace.ts`.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 없음. 선행 조건만 준비된다: `contracts`의 능력 계약(F.capabilities.plan M0), `platform-exec`(durable env 포크) | `_research/foundation-plan.md` §5 P4 M0 |
| M1 | F `defs/workspace.ts`의 정의 3개 전체(도구 7개 선언 포함). 구현은 `read`, `ls`, `bash` 3개. `xeon.workspace` 서비스 등록, L1.tools 어댑터 연결. 걸어 다니는 골격 스모크에서 이 세 도구가 호출된다 | [결정] `_research/foundation-plan.md` §5 P4 M1, `F.capabilities.plan` M1, `product.scope.spec` §4.3 M1 |
| M2 | `workspace.images` 최소형(`register`, `load`. 처리기 없이 형식·크기 검사와 blob 등록). `dialog.attachments`의 필수 의존 | [제안] `L2.readme` §2 각주 ws, §10 미결 10 |
| M3 | `write`, `edit`(정확·퍼지 일치, `edits` 배열), `grep`, `find` | `product.scope.spec` §4.3 M3 "`cap-workspace`의 M1 밖 도구" |

M3 이후(2차·보류) 표:

| 항목 | 단계 | 내용 |
|---|---|---|
| photon 이미지 처리(리사이즈, 방향 보정, 형식 변환), `images.resize` | 2차(`_research/layer-plan-v2.json` L2-a "이미지와 첨부 처리") | durable `images/` 포크 전체와 워커 스레드 |
| 줄 해시 편집 | 2차(L2-a "편집 방식"의 줄 해시 부분) | W9 설계 메모를 바탕으로 TS 재작성 |
| AST·LSP | 보류(L2-a "AST·LSP") | 조건이 생기면 새 능력으로 |
| PowerShell 도구 | 보류 | Windows 네이티브는 나중이다(`product.scope.spec` §4.2 N4). 포크 원본의 `createPowerShellTool`은 복사만 하고 등록하지 않는다 |

- 계획 v2는 "편집 방식"(정확·퍼지·줄 해시)을 통째로 2차로 적었다. 정확·퍼지 일치는 `edit-diff.ts` 한 파일에 함께 있어 `edit` 도구와 분리할 수 없으므로 M3 `edit`과 같이 들어온다 [제안]. 줄 해시만 2차로 남는다.
- `write`, `edit`, `grep`, `find`를 M2로 당길 근거 [제안, 확정 아님]: M2 종료 조건의 Helm 탐구 유즈케이스(`product.scope.spec` §4.4 M2)는 "쓰기 도구 호출을 거부"하는지를 본다. 거부 대상인 `write`·`edit`가 없으면 이 조건을 `bash`로만 확인하게 된다. M2 계획 때 Helm 쪽 테스트가 `write`·`edit` 정의(M1에 이미 F에 있음)만으로 충분한지 보고, 부족하면 W5를 M2로 당긴다.

## 2. 패키지와 파일 배치

```
xeon/packages/cap-workspace/
  package.json            # "name": "@xeon/cap-workspace", "xeon": { "layer": "L2", "domain": "workspace" }
  UPSTREAM.json  PATCHES.md  LICENSE.pi          # ADR-0003 §3.4
  src/
    index.ts              # manifest, apply(ctx): 서비스 xeon.workspace 등록
    manifest.ts           # defineManifest({ name: "cap-workspace", layer: "L2", kind: "plugin",
                          #   provides: [workspace.files, workspace.shell, workspace.images @1.0.0], usesDrive: false, points: [] })
    service.ts            # WorkspaceService 조립
    settings.ts           # defineSettings("l2.workspace", …)  (spec §6)
    roots.ts              # 허용 root 조회와 경로 해석(spec §4.3)
    errors.ts             # FileErrorCode·ExecutionErrorCode → CapabilityError 대응(spec §4.1)
    upstream/
      tool-types.ts       # harness/types.ts에서 추출한 도구 타입(W2)
      output.ts           # harness/output.ts에서 read가 쓰는 함수만(characterEnd 등)
    files/
      read.ts  write.ts  list.ts  grep.ts  find.ts   # 메서드 구현(포크 본문을 메서드 모양으로 감쌈)
      upstream/read.ts  upstream/write.ts  upstream/path-utils.ts  upstream/file-mutation-queue.ts
      upstream/grep.ts  upstream/find.ts  upstream/ls.ts               # pi coding-agent core/tools 포크
    edit/
      edit.ts             # 메서드 구현, 오류 코드 매핑
      upstream/edit.ts  upstream/edit-diff.ts
    shell/
      run.ts              # 샌드박스 래핑, exit_nonzero 규칙
      upstream/bash.ts
    images/
      service.ts          # load, resize, register, 처리기 탐침
      blob.ts             # L0 blob 등록 연결(자체)
      upstream/image.ts  upstream/image-processor.ts                    # M2
      upstream/index.ts  upstream/exif.ts  upstream/node.ts  upstream/node-worker.ts  # 2차
    truncate/
      paging.ts           # read 이어 읽기 계산과 TruncationInfo 조립
  test/
    fixtures/  tapes/
    *.test.ts
```

포크 파일 표. 원본 저장소는 pi(`https://github.com/earendil-works/pi`, URL 확인은 ADR-0003 §6 [미결]), 커밋은 모두 `cdaf6c2`(`cdaf6c227d4718a72b59ccd02152c9614df44cfc`, 2026-10-11)다. `D/` = `packages/durable/src/`, `CA/` = `packages/coding-agent/src/core/tools/`.

| 원본 | 줄 | 포크 위치 | 마일스톤 | 고친 점 |
|---|---|---|---|---|
| `D/tools/read.ts` | 312 | `src/files/upstream/read.ts` | M1 | `Context` import type → `CancelScope`. `defineTool`·`ToolRegistration`·`ToolExecutionApi` → `src/upstream/tool-types.ts`. `requireEnv(api)` → 주입받은 `ExecutionEnv`. 결과를 `ReadOutput`으로 바꾸는 감싸기는 `src/files/read.ts`에 둔다 |
| `D/tools/path-utils.ts` | 30 | `src/files/upstream/path-utils.ts` | M1 | `Context` 치환. 탈출 검사는 넣지 않고 `src/roots.ts`가 결과 경로를 검사한다 |
| `D/tools/bash.ts` | 184 | `src/shell/upstream/bash.ts` | M1 | `Context` 치환. `prepareExecution` 앞에 `xeon.sandbox` 래핑을 넣는다(`src/shell/run.ts`). `api.output`·`retainedOutput` 대신 `ExecutionEnv.exec`의 spill·window 옵션을 직접 쓴다. PowerShell 부분은 복사만 하고 등록하지 않는다 |
| `D/tools/env.ts` | 8 | 복사하지 않음 | — | `requireEnv`는 서비스 주입으로 대체 |
| `D/tools/index.ts` | 39 | 복사하지 않음 | — | Harness 확장 객체(`createCodingTools`)라 쓰지 않는다 |
| `CA/ls.ts` | 175 | `src/files/upstream/ls.ts` | M1 | fs 직접 호출 → `ExecutionEnv.listDir`. 렌더러·TUI 의존 제거. 정렬을 코드 단위 바이트 순으로 고정(`localeCompare` 제거) |
| `D/tools/write.ts` | 39 | `src/files/upstream/write.ts` | M3 | 도구 타입 치환. `FileChange` 계산(이전 내용 읽기 + `generateUnifiedPatch`) 추가 |
| `D/tools/file-mutation-queue.ts` | 55 | `src/files/upstream/file-mutation-queue.ts` | M3 | `Context` 치환 |
| `D/tools/edit.ts` | 144 | `src/edit/upstream/edit.ts` | M3 | 도구 타입 치환. `prepareEditArguments`는 F 정의의 `toEditInput`으로 옮겼으므로 지운다. 오류 메시지 문자열 대신 고유 코드로 던진다(`edit_not_found` 등) |
| `D/tools/edit-diff.ts` | 500 | `src/edit/upstream/edit-diff.ts` | M3 | 오류 생성 함수 5개(`getNotFoundError` 등)가 코드 달린 오류를 만들도록 고친다. 정규화 규칙은 바꾸지 않는다 |
| `CA/grep.ts` | 323 | `src/files/upstream/grep.ts` | M3 | `ensureTool` 내려받기 제거, `@vscode/ripgrep` 경로 또는 `l2.workspace.grep.rgPath`. 실행은 `ExecutionEnv.exec`. 출력 파싱은 `rg --json`으로 고정 |
| `CA/find.ts` | 318 | `src/files/upstream/find.ts` | M3 | `fd` 대신 `rg --files --glob`(spec §10 미결 6). 실행은 `ExecutionEnv.exec` |
| `D/truncate.ts` | 205 | 이 패키지에 두지 않는다. `platform-exec`(L0.exec.plan)가 포크한다 | M1 | spec §4.5 D-08. 이 패키지는 `xeon.exec`(F `ExecutionEnv`)로 호출한다 |
| `D/harness/types.ts` | 786 중 100~200 | `src/upstream/tool-types.ts` | M1 | `ToolRegistration`, `ToolExecutionApi`, `ToolExecutionResult`, `ToolDiagnostic`과 이들이 참조하는 타입만 추출 |
| `D/harness/define.ts` | 44 | `src/upstream/tool-types.ts`에 합침 | M1 | `JsonValue`(Chord) → `@xeon/contracts/conversation`의 `JsonValue` |
| `D/harness/output.ts` | 341 중 일부 | `src/upstream/output.ts` | M1 | `read`가 쓰는 `characterEnd`와 그 의존만 |
| `D/tools/image.ts` | 182 | `src/images/upstream/image.ts` | M2 | 형식 판별(`detectSupportedImageMimeTypeOf`, `imageDimensions`). 수정 없음 [가정] |
| `D/tools/image-processor.ts` | 69 | `src/images/upstream/image-processor.ts` | M2 | 수정 없음 |
| `D/images/index.ts`, `exif.ts` | 140, 70 | `src/images/upstream/` | 2차 | 수정 없음 |
| `D/images/node.ts`, `node-worker.ts` | 130, 35 | `src/images/upstream/` | 2차 | wasm 경로를 `createRequire(...).resolve(...)` 대신 Bun 파일 임베드로 얻는다. `node:fs` `readFile`은 임베드 파일 읽기로 바꾼다 |
| `D/images/cloudflare.ts`, `photon-wasm.d.ts` | 10, 5 | 복사하지 않음 | — | Cloudflare Workers 전용 |

- 도구 타입 위치 [제안]: ADR-0003 §3.1은 `CancelScope`와 추출한 도구 타입을 F에 두자고 제안했다. `CancelScope`는 `platform-exec`(L0)와 이 패키지가 함께 쓰므로 F에 둔다. 추출한 도구 타입(`ToolRegistration` 등)은 포크한 도구 본문만 쓰고 F 계약(`ToolSpec`)과 모양이 다르므로 이 패키지의 `src/upstream/tool-types.ts`에 둔다. F에 두면 durable 하네스 타입이 공용 계약처럼 보이기 때문이다(§7 위험 표, ADR-0003 §6 [미결]).

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| W1 | F `src/capabilities/defs/workspace.ts`: spec §3.1~§3.5의 스키마, `WorkspaceFiles`, `WorkspaceShell`, `WorkspaceImages`, 각 `…Key`, `WorkspaceService`, `WorkspaceServiceName`. 명시 타입 주석(`isolatedDeclarations`). `validateCapability`·`validateCapabilitySet` 테스트 | F.capabilities.plan M0(P1~P7) | M |
| W2 | 도구 타입 추출: `D/harness/types.ts`·`define.ts`에서 `src/upstream/tool-types.ts`(100~200줄), `harness/output.ts`의 필요 함수. `UPSTREAM.json`·`PATCHES.md`·`LICENSE.pi` 골격 | W1과 병렬 가능. `CancelScope`는 L0.exec.plan의 F 추가 작업 | S |
| W3 | `read`, `ls`, `bash` 포크와 `ExecutionEnv` 연결: `src/roots.ts`(경로 해석, M1은 cwd 하나), `src/errors.ts`, `src/files/read.ts`·`list.ts`, `src/shell/run.ts`(샌드박스 래핑, `exit_nonzero`), `src/truncate/paging.ts`. 절단 함수는 L1.tools.plan의 결정 위치에서 import | W1, W2, L0.exec.plan(env 포크), L0.sandbox.plan(래핑 API), L1.tools.plan(절단 함수 위치 결정) | L |
| W4 | provider 등록과 L1.tools 어댑터 연결 확인: `src/index.ts`·`manifest.ts`·`service.ts`, 능력별 `hostOf(g).provide(key, impl)` 등록(X가 `cap:<id>` 바인딩을 만든다), L1.tools가 `ToolSpec` 7개 중 구현된 3개로 `AgentTool`을 만드는지, 미구현 도구는 노출하지 않는지 확인 | W3, X.primitives.plan(서비스 등록 API), L1.tools.plan(도구 어댑터) | M |
| W5 | `write`, `edit`과 `edit-diff` 포크: `FileChange` 계산, 고유 오류 코드, 퍼지 규칙 E1~E17 테스트, 경로별 줄 세우기 | W3 | L |
| W6 | `grep`(ripgrep 연결, `rg --json` 파싱), `find`(`rg --files --glob`) | W3 | M |
| W7 | images 포크와 blob 등록: M2는 `image.ts`·`image-processor.ts`와 `register`·`load` 최소형, blob 연결(`src/images/blob.ts`), `read`의 이미지 분기. 2차는 photon 처리기, 워커, `resize`, 시작 탐침 | W3, L0.store.plan(blob API). 자리표시 치환은 L1.context.plan | M(최소형), L(2차) |
| W8 | 설정 키 선언: `src/settings.ts`에 spec §6 표의 15개 키. `checkSettingDef` D1~D9 통과 테스트. 각 메서드가 설정을 읽는 시점(호출마다 유효 값 조회) | W1. 키별 소비 코드는 W3·W5·W6·W7 | S |
| W9 | 줄 해시 편집 설계 메모(2차): omp `crates/pi-edit` hashline 알고리즘 요약, TS 재작성 범위, `read` 출력 변경과 fingerprint 영향, 새 메서드·도구 모양. 문서로만 남긴다(`L2.workspace.spec` §4.4 보강) | W5 | S |

- M1 범위는 W1~W4, W8(M1 소비 키만: `read.*`, `shell.*`, `list.maxEntries`)이다. W5·W6은 M3, W7 최소형은 M2, W7 처리기와 W9는 2차다.
- W3의 `bash`는 M1 스모크 조건 "샌드박스 `bash`가 작업 폴더 밖 쓰기를 거부한다"(`product.scope.spec` §4.4 M1)를 L0.sandbox와 함께 만족해야 한다.

## 4. 채택 코드

| 대상 | 버전 | 라이선스 | 쓰는 방식 |
|---|---|---|---|
| `typebox` | 1.3.27(워크스페이스 catalog, review.decisions-2 U-24) | MIT | 정의 스키마(F). durable 원본도 1.3.27이라 포크 본문의 `Type.*` 호출이 그대로 맞는다 |
| `diff` | 8.0.4 정확 고정(durable `package.json`과 같은 값) | BSD-3-Clause [가정, 레지스트리 확인] | `edit-diff.ts`의 diff 생성(`generateDiffString`, `generateUnifiedPatch`) |
| `@silvia-odwyer/photon` | 0.3.3 정확 고정(durable `package.json`과 같은 값) | Apache-2.0 [가정, 레지스트리 확인] | 2차 이미지 처리기. wasm 파일 `photon_rs_bg.wasm` |
| `@vscode/ripgrep` | 1.18.0 정확 고정 | MIT | `grep`, `find`의 rg 바이너리. postinstall 다운로드 없음(플랫폼 패키지) (`_research/packages.md` §5) |
| pi durable `tools/`, `images/`, `truncate.ts`, `harness/` 일부 | 커밋 `cdaf6c2` | MIT | 포크(§2 표) |
| pi coding-agent `core/tools/{grep,find,ls}.ts` | 커밋 `cdaf6c2` | MIT | 포크(§2 표) |
| omp `crates/pi-edit` hashline | — | [가정] MIT | 2차. 코드 복사 없이 알고리즘만 참고 |

- 외부 모듈 소유: `diff`, `@silvia-odwyer/photon`, `@vscode/ripgrep`은 이 패키지만 import한다(`eng.dependency-rules.guide` DR-07).
- 라이선스 고지: 배포물 서드파티 고지 파일에 pi(MIT), diff, photon, ripgrep을 넣는다(ADR-0003 §3.4).

Chord 값 import 0건 확인 절차(ADR-0003 §4.2 검증 방법을 이 패키지에 적용):

1. `grep -rnE "from ['\"][^'\"]*chord" xeon/packages/cap-workspace/src xeon/packages/cap-workspace/test` 결과가 비어야 한다. `import type`도 포함해 0건이다.
2. `xeon/packages/cap-workspace/package.json`의 `dependencies`·`devDependencies`에 `@earendil-works/chord`가 없어야 한다.
3. chord를 설치하지 않은 워크스페이스에서 `tsc -b`가 통과해야 한다.
4. `just verify`의 oxlint `no-restricted-imports`와 dependency-cruiser 규칙에 chord 금지가 들어 있는지 확인한다(`eng.dependency-rules.guide`). 규칙이 없으면 L1·L0 담당과 함께 추가를 요청한다.
5. 같은 확인을 `@earendil-works/pi-durable` 패키지 이름에도 한다. 포크는 코드를 복사하므로 원본 패키지 의존이 0건이어야 한다.

## 5. 단위 테스트 목록

외부 호출 없이 `ExecutionEnv` 가짜(`@xeon/platform-exec/testing`의 `fakeExec`와 메모리 파일 시스템), 가짜 `xeon.sandbox`, 가짜 blob 저장소만 쓴다. 통합 스모크는 모델 테이프로 한 턴만 돈다(`eng.testing.guide` TS-01, TS-04, TS-05).

| 파일 | 테스트 | 확인할 동작 |
|---|---|---|
| `test/defs.test.ts` | `workspace defs have no issues` | 정의 3개의 `validateCapability` 이슈 0건, `validateCapabilitySet` 이슈 0건 |
| | `replay and execution policy declared` | `read`·`ls`·`grep`·`find`: 메서드·도구 `replay: "safe"`, `executionMode: "parallel"`, `hints.readOnly: true`. `write`·`edit`·`bash`: `replay: "unsafe"` |
| | `tool order is stable` | `orderTools([WorkspaceShell, WorkspaceImages, WorkspaceFiles])`가 `edit, find, grep, ls, read, write, bash` 순 |
| | `edit toInput repairs shapes` | 문자열 `edits`, 단일 객체 `edits`, 최상위 `oldText`/`newText`가 같은 `EditInput`이 된다 |
| `test/read.test.ts` | `read returns whole small file` | 한도 아래 파일은 `truncated`가 없고 `endLine === totalLines` |
| | `read truncates at line limit` | `maxLines`를 넘으면 `truncated.by === "lines"`, `nextOffset === endLine + 1` |
| | `read truncates at byte limit` | 바이트 한도에서 줄 경계까지만 남고 `by === "bytes"` |
| | `read continues from offset` | `nextOffset`으로 다시 읽으면 다음 줄부터 이어진다. 두 결과를 이으면 원본과 같다 |
| | `read rejects offset beyond end` | `offset_beyond_end`, `detail.totalLines` |
| | `read rejects binary file` | NUL 바이트가 있는 비이미지 파일은 `read_binary` |
| | `read resolves screenshot name variants` | NFD·좁은 공백 이름 파일을 찾는다 |
| `test/roots.test.ts` | `rejects dot-dot escape` | `../outside.txt`는 `denied`, `reason: "outside_root"` |
| | `rejects symlink escape` | root 안의 링크가 root 밖을 가리키면 `denied` |
| | `rejects traversal in missing segments` | 없는 `a/../../x`로 쓰기 시도는 `reason: "parent_traversal"` |
| | `segment-wise containment` | root `/w/a`일 때 `/w/ab/x`는 밖이다 |
| | `rejects protected path` | 가짜 보호 경로 목록의 경로는 root 안이어도 `protected_path` |
| `test/list.test.ts` | `ls sorts by bytes and marks dirs` | 바이트 순, 디렉터리 `/` 접미, 점 파일 포함 |
| | `ls truncates at entry limit` | `by: "entries"`, `shown`, `total` |
| `test/shell.test.ts` | `bash returns output and exit code` | 가짜 exec 응답이 그대로 `RunOutput`이 된다 |
| | `bash nonzero exit is tool error` | 도구 경로 `toInput`으로 `failOnNonZero: true` → `exit_nonzero`, `message`에 출력 꼬리 |
| | `service run without failOnNonZero` | 같은 명령이 오류 없이 `exitCode`를 돌려준다 |
| | `sandbox denial maps to denied` | 가짜 샌드박스 사전 거부 → `CapabilityError` `denied`, `detail.by === "sandbox"`, 어댑터 결과 `isError: true` |
| | `sandbox off runs unwrapped` | 설정상 샌드박스 꺼짐이면 `sandboxed: false` |
| | `bash timeout keeps output` | 가짜 exec `timeout` → `timeout` 오류, `detail`에 출력 |
| | `bash abort` | `signal` 취소 → `aborted` |
| | `tail truncation and spill path` | 출력이 한도를 넘으면 `truncated: true`, `fullOutputPath` 있음 |
| `test/edit.test.ts` | spec §4.4의 E1~E17 테스트 이름 17개 | 표의 각 규칙. 이름은 표와 문자 그대로 같다 |
| | `edit rules table matches tests` | spec 표의 테스트 이름 목록(fixture로 복사)과 이 파일의 테스트 이름 집합이 같다 |
| | `edit reports FileChange` | `diff`, `added`, `removed`, `firstChangedLine` |
| | `concurrent edits on same path serialize` | 같은 경로 두 편집이 차례로 적용된다 |
| `test/write.test.ts` | `write creates parents` | 없는 부모 디렉터리를 만든다. `FileChange.existed: false` |
| | `write overwrites and diffs` | 기존 파일 덮어쓰기, `diff`에 바뀐 줄 |
| `test/grep.test.ts` | `grep parses rg json` | 가짜 `rg --json` 출력 → `matches`(match·context 구분) |
| | `grep invalid pattern` | rg 오류 출력 → `pattern_invalid` |
| | `grep missing rg` | 바이너리 없음 → `unavailable`, `reason: "rg_missing"` |
| | `grep long line cut` | `maxLineLength` 초과 줄 절단 |
| `test/find.test.ts` | `find uses rg files glob` | 가짜 exec에 넘긴 인자가 `--files --glob <pattern>` |
| | `find sorts and truncates` | 바이트 순, `limit` 절단 |
| `test/images.test.ts` | `register passes inline image within limit` | 처리기 없음 상태에서 png·jpeg·gif·webp 한도 안은 그대로 등록 |
| | `register rejects oversize without processor` | `image_too_large` |
| | `register rejects unsupported format` | bmp는 처리기 없음 상태에서 `image_unsupported` |
| | `register rejects input over maxInputBytes` | 처리 전 `invalid_input` |
| | `same bytes same blob` | 같은 데이터 두 번 → 같은 `sha256` |
| | `read image returns placeholder` | 이미지 `read`의 `content`에 `data`가 `blob:sha256:`로 시작 |
| | `blob ref shape matches records` | `ImageBlobRefSchema`의 JSON과 F records `BlobRefSchema`의 JSON이 같다(spec §10 미결 3) |
| `test/settings.test.ts` | `settings defs pass checks` | 15개 키가 D1~D9를 통과하고 키 접두가 `l2.workspace.` |
| | `settings change applies next call` | `read.maxLines` 변경 뒤 다음 호출부터 새 한도 |
| `test/errors.test.ts` | `maps env errors` | spec §4.1 표의 각 행 |
| `test/replay.test.ts` | `unsafe tools are not rerun on unknown outcome` | 의도 기록 뒤 결과가 없을 때 어댑터 정책 표가 `write`·`edit`·`bash`를 재실행 대상에서 뺀다(F records 판정 함수 `decideEffectRecovery`에 정의 값 입력) |
| `apps/cli/test/` 스모크(통합 1개, L4 소유) | `chat turn uses read ls bash` | 모델 테이프가 `read`, `ls`, `bash`를 차례로 호출하고 결과가 테이프와 맞는다 |

## 6. 완료 기준

M1 완료:

1. `xeon chat` 한 턴에서 `read`, `ls`, `bash` 도구 호출이 모델 테이프로 재생되고 결과가 기대값과 같다(`_research/foundation-plan.md` §6 M1 스모크).
2. `cd xeon && just verify`가 종료코드 0이다.
3. F `defs/workspace.ts`의 정의 3개가 `validateCapability` 이슈 0건이다(`F.capabilities.plan` M1).
4. `L2.workspace.spec` §9 수용 기준 2, 4, 5, 6, 7(M1 도구 범위), 10이 테스트로 확인된다.
5. §4의 Chord 확인 절차 1~3이 통과한다.

M2 완료: 위에 더해 §5 `test/images.test.ts`의 최소형 테스트가 통과하고 `dialog.attachments`의 붙여넣기 이미지가 `register`로 등록된다(`L2.dialog.plan`과 함께 확인).

M3 완료: spec §9 수용 기준 1~10 전부. 퍼지 규칙 표와 테스트 이름의 1:1 검사가 통과한다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| photon wasm이 `bun build --compile` 산출물에서 로드되지 않음 | 2차 이미지 처리기가 배포 바이너리에서 동작하지 않는다 | 처리기를 2차로 두고 M2는 처리기 없는 최소형으로 간다. 2차 착수 때 첫 작업으로 임베드 로드를 확인하고, 실패하면 처리기 없음 상태를 기본으로 둔다(spec §4.6 대체 경로) |
| 워커 스레드가 Bun에서 durable 원본과 다르게 동작 | 이미지 처리가 메인 스레드를 막거나 실패한다 | 2차 착수 때 Bun `Worker`로 원본 테스트(`test/tools-images.test.ts` 포크)를 돌려 확인한다. 안 되면 메인 스레드 처리로 바꾼다 |
| 절단 함수 사본이 남음 | 두 구현이 서로 다른 한도로 자른다 | 위치는 `platform-exec`로 정했다(review.decisions-2 D-08). M1에 있던 `cap-workspace/src/truncate/upstream` 사본은 지웠고 `xeon.exec`의 `truncateHeadOf`를 부른다(`L0.exec.plan` EX-21, 구현됨). `truncate/paging.ts`는 이어 읽기 계산만 둔다. `utf8ByteLength`는 `src/upstream/output.ts`의 한 줄 함수다(`PATCHES.md` P3) |
| 퍼지 편집 오적용 | 정규화된 공간에서 엉뚱한 구간이 바뀐다 | 모호 일치(`edit_ambiguous`)를 퍼지 공간에서도 센다(원본 규칙 E14). 바뀌지 않은 줄 원문 보존(E10). 설정으로 퍼지를 끌 수 있다(E17). `FileChange.diff`가 결과에 남아 리뷰할 수 있다 |
| 포크 원본이 실험 API라 upstream이 예고 없이 바뀜 | 업그레이드 때 diff가 크다 | 커밋 `cdaf6c2`로 고정하고 `UPSTREAM.json`·`PATCHES.md`·`XEON-PATCH` 표지로 바꾼 점을 추적한다(ADR-0003 §3.4). upstream 변경은 필요할 때만 수동으로 가져온다 |
| 도구 타입 추출 규모가 추정(100~200줄)보다 큼 | W2가 길어진다 | W2를 W1과 병렬로 먼저 시작하고, 추출 대상이 도구 본문이 실제로 쓰는 타입뿐인지 타입체크로 좁힌다(ADR-0003 §4.2) |
| ripgrep 플랫폼 패키지가 compile 산출물에 들어가지 않음 | 배포판에서 `grep`, `find`가 `unavailable` | 사이드카 빌드에 rg 바이너리를 같이 넣는 방법을 `L4.desktop.plan`에 요청한다. 시스템 rg와 `l2.workspace.grep.rgPath`로 우회할 수 있다 |
| `typebox` 판 차이 | 해소했다. 원본과 catalog가 같은 1.3.27이다(review.decisions-2 U-24) | W2 타입체크로 확인한다 |
| 경로 검사와 샌드박스 정책이 서로 다른 root를 씀 | 파일 도구와 bash의 허용 범위가 달라 사용자가 혼란스럽다 | 허용 root를 L1.tools 한 곳에서 받고 L0.sandbox 쓰기 경로와 같은 값을 쓰도록 L1.tools.plan에 요청한다 |
