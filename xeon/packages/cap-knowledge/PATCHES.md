# cap-knowledge 포크 패치 기록

`src/upstream/skills.ts`는 pi `packages/coding-agent/src/core/skills.ts`의 포크다. 원본 저장소, 커밋, 복사 경로, 파일별 sha256은 `UPSTREAM.json`에 있다.
세 기록의 패치 id 집합이 같아야 한다: 이 표, `UPSTREAM.json`의 `modifications`, 소스의 `// XEON-PATCH: <id>` 표지.
`test/fork-records.test.ts`가 이를 검사한다. 근거 문서는 `L2.knowledge.plan` §4.1, `adr.0003` §3.4다.
고친 줄 위에 표지를 단다. 줄 번호는 원본(커밋 `cdaf6c2`) 기준이다. 뺀 코드(KN-04, KN-06)는 뺀 자리에 표지를 단다.

## 패치 표

| 패치 id | 파일:줄 | 바꾸는 점과 이유 | 확인 테스트 |
|---|---|---|---|
| KN-01 | `skills.ts:4`, `loadSkills` 전체 | `config.ts`의 `CONFIG_DIR_NAME`, `getAgentDir`를 가져오던 import를 없애고 `loadSkills(fs, roots)`가 `SkillRoots { project?, user, extension, paths }`를 인자로 받는다. 경로는 `skills/roots.ts`가 `xeon.os`가 준 디렉터리와 설정에서 만든다(DR-13). `skillPaths` 항목은 절대 경로만 받고 상대 경로는 경고 진단이다(`resolvePath`의 `~` 확장과 cwd 기준 해석을 없앴다). `includeDefaults`, `cwd`, `agentDir` 옵션도 없앴다 | `upstream-skills.test.ts` |
| KN-02 | `skills.ts:5`, `utils/frontmatter.ts` | `parseFrontmatter`(yaml 2.9.0 의존)를 같은 경계 규칙(`---` 줄, BOM 제거, 줄바꿈 정규화)의 함수로 포크 안에 옮기고 YAML 파싱은 `Bun.YAML.parse`로 바꿨다. 던지지 않고 `Result`를 돌려준다. YAML 오류, 매핑이 아닌 값, 순환·과도한 중첩(별칭이 순환 객체를 만든다)은 각각 `frontmatter_yaml`, `frontmatter_not_object`, `frontmatter_cyclic`이다. 순환 검사는 방문을 끝낸 노드를 다시 보지 않아 별칭 폭발에도 선형이다 | `upstream-skills.test.ts` |
| KN-03 | `skills.ts:1`, `skills.ts:6`, `skills.ts:151-258`, `utils/paths.ts` | 동기 `fs` 호출(`existsSync`, `readdirSync`, `readFileSync`, `statSync`)과 `canonicalizePath`를 `KnowledgeFs` 비동기 포트(`list`, `readFile`, `stat`, `realpath`)로 바꿨다. 시험에서 메모리 가짜를 쓰기 위해서다. 읽을 수 없는 디렉터리와 UTF-8이 아닌 파일은 조용히 넘기지 않고 경고 진단을 남긴다(원본은 빈 `catch`). 심볼릭 링크는 가리키는 종류로 본다 | `upstream-skills.test.ts` |
| KN-04 | `skills.ts:7`, `skills.ts:14-55`, `skills.ts:151-258` | `ignore` 패키지와 `.gitignore`·`.ignore`·`.fdignore` 규칙(`addIgnoreRules`, `prefixIgnorePattern`)을 뺐다. 스킬 루트에 무시 규칙을 적용하지 않는다(`L2.knowledge.spec` §4.2.1, §10 미결 10) | `upstream-skills.test.ts` |
| KN-05 | `skills.ts:8-9`, `skills.ts:57-79`, `skills.ts:164-190` | `ResourceDiagnostic`, `SourceInfo`, `createSyntheticSourceInfo`를 로컬 타입 `SkillDiagnostic`, `SkillSource { scope, root, extension? }`로 바꿨다. `Skill`에 `layout`(`dir`: SKILL.md를 가진 디렉터리, `file`: 루트 바로 아래 단일 `.md`)을 더했다. 충돌 진단에서 `ResourceCollision`을 없애고 이긴 경로를 메시지에 싣는다 | `upstream-skills.test.ts` |
| KN-06 | `skills.ts:332-376` | `formatSkillsForPrompt`와 `escapeXml`을 뺐다. 인덱스 블록은 `skills/prompt-block.ts`가 만든다(예산, `skill_view` 안내, `<location>` 없음). `<location>`을 빼는 이유는 모델이 스킬을 `skill_view`로만 읽게 하기 위해서다 | `skill-index.test.ts` |
| KN-07 | `skills.ts:398-405` | 루트 순서를 사용자 → 프로젝트에서 프로젝트 → 사용자 → 확장 제공 → 설정 경로로 바꿨다. 같은 이름은 앞 루트가 이기고 `collision` 진단을 남긴다(`L2.knowledge.spec` §4.2.1) | `upstream-skills.test.ts` |
| KN-08 | `skills.ts:178-258` | 항목 처리를 `Promise.all`로 병렬로 하되 결과를 항목 순서에 따라 이어 붙인다. 항목은 이름 바이트 순으로 정렬되어 들어온다(`KnowledgeFs.list`). 원본은 `readdirSync` 순서(파일 시스템 의존)였다. 같은 스킬 집합이 같은 순서와 같은 인덱스 블록을 만든다. `no-await-in-loop` 예외 주석 없이 쓰기 위한 모양이기도 하다 | `upstream-skills.test.ts` |
| KN-09 | `skills.ts:151-258` | 심볼릭 링크 순환 방어와 깊이 상한(16)을 더했다. 조상 실제 경로 집합에 든 디렉터리로 들어가는 링크는 경고 진단과 함께 건너뛴다. 원본은 링크가 부모를 가리키면 경로가 길어져 실패할 때까지 내려갔다 | `upstream-skills.test.ts` |

## 복사 범위(선택 사항)

- `skills.ts`의 `Skill.sourceInfo`와 `LoadSkillsFromDirOptions`는 옮기지 않았다(KN-05, KN-01).
- `loadSkillsFromDir`는 export하고 `fs`를 첫 인자로 받는다. 원본의 옵션 객체 `{ dir, source }`는 `(fs, dir, source)`가 되었다(KN-03).

## 서식

`bun run fmt-check`(oxfmt, 공백 2칸, 100열)가 `src`와 `test` 전체를 검사하므로 복사한 뒤 포크 파일도 같은 서식으로 다시 찍었다. 원본은 탭 들여쓰기라 줄 단위 diff가 크다.
패치만 보려면 원본도 같은 설정으로 포맷해서 비교한다.

## 린트 예외 주석

포크 코드에는 `oxlint-disable` 주석을 두지 않는다. `eng.typescript.guide` §1은 업스트림 병합 비용을 억제 주석의 사유로 인정하지 않는다. 린트가 걸리는 줄은 KN-08처럼 고쳐 쓰고 `XEON-PATCH` 표지를 단다.

## 확인 기록

- 2026-10-24 원본 대조: 로컬 사본(`~/projects/_ref/pi-src`)의 `HEAD`가 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`이고 `skills.ts`와 `LICENSE`의 sha256을 `UPSTREAM.json`에 적었다. 원격 대조와 npm 1.3.0 tarball과의 diff는 하지 않았다(`L2.knowledge.plan` §4.1 [가정]은 그대로다).
