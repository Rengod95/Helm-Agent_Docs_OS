
--- [1] USER ---
vendor free agent skill, extention, workflow 등 클로드코드나 코덱스 처럼 특정 에이전트 프로바이더에 종속되지않는 나만의 에이전트를 개발하려고해. 비록 당장은 pi 를 쓸거지만, 내가 원하는건 어떤 상황 어떤에이전트 런타임을 쓰더라도 동일하게 내 개발 및 에이전트 기반 자체 하네스 환경을 구축해놓은 걸 그대로 사용하려는 목적의 중립 에이전트 기술들을 구축하고 설계하는거야.

--- [2] ASSISTANT ---
pi를 당장 쓰더라도 하네스의 "본체"는 pi 밖에 두고, pi는 여러 어댑터 중 하나로 다루는 설계를 제안합니다. 핵심은 **표준으로 이미 이식 가능한 것은 표준을 그대로 쓰고, 이식이 안 되는 것은 런타임 바깥의 실행 파일로 내리고, 런타임별 차이는 얇은 어댑터에만 가두는 것**입니다.

## 1. 원칙: 이식성을 기준으로 3계층으로 나누기

**계층 A: 표준 자체가 중립인 것 (어댑터 거의 불필요)**
- **Skills (SKILL.md)**: Anthropic이 만들고 agentskills.io에서 표준화한 형식으로, Claude Code, Cursor, Codex, Gemini CLI, VS Code 등 27개 이상의 에이전트가 지원합니다. pi도 지원하며 프로젝트는 `.pi/skills/`, 전역은 `~/.pi/agent/skills/`를 읽습니다. 경로만 런타임마다 다르니 심볼릭 링크로 해결됩니다.
- **AGENTS.md**: 항상 로드되는 프로젝트 컨텍스트입니다. Claude Code처럼 다른 파일명(CLAUDE.md)을 쓰는 런타임은 그 파일에서 AGENTS.md를 import하는 한 줄짜리 shim을 두면 됩니다.
- **MCP**: 외부 시스템 연결용입니다. 단, pi는 MCP를 기본 내장하지 않고 CLI 도구와 확장으로 해결하는 철학이라, 다음 원칙이 더 중요해집니다.

**계층 B: 런타임 바깥의 실행 파일로 내리는 것 (중립성의 실질적인 핵심)**
- **결정적 로직은 전부 CLI로** 만듭니다(예: `ak <command>`, JSON 출력, `--help` 충실히). 모든 에이전트가 공통으로 가진 유일한 도구는 셸이기 때문에, CLI가 가장 이식성이 높은 tool 인터페이스입니다. 스킬은 이 CLI를 호출하는 "사용 설명서" 역할만 합니다.
- **가드레일은 에이전트 밖에서 강제**합니다. 금지 경로, 위험 명령 패턴 같은 정책은 `policies/*.yaml` 데이터로 두고, 판정은 `ak guard check`가 합니다. 최종 방어선은 git hook, CI, 컨테이너/샌드박스처럼 어떤 런타임이든 우회할 수 없는 곳에 둡니다. 런타임 hook은 "빠른 피드백"이지 유일한 방어선이 아닙니다.
- **상태와 메모리는 repo 안의 파일**(markdown/JSON)로 둡니다. 런타임 고유의 메모리나 세션 기능에 의존하면 그 순간 종속됩니다.

**계층 C: 개념은 같지만 형식이 제각각이라 어댑터가 필요한 것**
- Hooks(라이프사이클 이벤트), subagent 정의, slash command/prompt template, 권한 설정이 여기에 해당합니다.

## 2. 중립 스키마 + 어댑터 구조

계층 C는 **자체 중립 포맷을 정의하고, 런타임별로 변환하거나 런타임에서 직접 읽게** 합니다.

| 개념 | 중립 형식 (본체) | pi | Claude Code | Codex |
|---|---|---|---|---|
| 상시 지침 | `AGENTS.md` (조각 합성) | 그대로 | CLAUDE.md shim | 그대로 |
| 스킬 | `skills/*/SKILL.md` | 심링크 | 심링크 | 심링크 |
| 도구 | `ak` CLI (+선택적 MCP) | bash로 호출 | bash / MCP | bash / MCP |
| 훅 | `hooks.yaml`: 중립 이벤트 → `ak hook <event>` | 브리지 extension이 런타임에 읽음 | settings.json hooks로 생성 | 지원 범위 버전별 확인, 없으면 fallback |
| 서브에이전트 | `agents/*.md` (role, 모델 힌트, 도구 힌트) | subagent extension용 생성 | `.claude/agents/` 생성 | 미지원 시 외부 runner로 |
| 커맨드 | `commands/*.md` | prompt template | slash command | 버전별 확인 |

포인트는 다음과 같습니다.
- **중립 이벤트 어휘를 직접 정의**합니다. 예: `session_start`, `pre_tool`, `post_tool`, `pre_commit`, `stop`. 런타임 이벤트 이름에 맞추지 말고, 내 어휘를 각 런타임에 매핑합니다.
- **capability matrix + graceful degradation**: 어떤 런타임에 훅이 없으면 (1) AGENTS.md 지침으로 약화시키고 (2) git hook/CI에서 강제합니다. 기능이 빠져도 하네스가 "깨지지 않고 약해지기만" 해야 합니다.
- **pi 어댑터는 파일 생성보다 브리지 하나로** 만드는 게 좋습니다. pi extension은 TypeScript로 tool과 이벤트 핸들러를 등록할 수 있으니, `hooks.yaml`과 `agents/`를 읽어서 동적으로 등록하는 `neutral-bridge` extension 하나만 두면 pi 쪽 코드는 거의 늘지 않습니다.
- 스킬 본문에서 **런타임 고유 도구명("Read tool", "Bash tool")이나 특정 모델의 프롬프트 관습에 의존하지 않습니다.** `allowed-tools` 같은 필드도 런타임마다 해석이 달라서 힌트로만 취급합니다.

## 3. 워크플로우는 두 종류로 분리

1. **에이전트 안쪽 워크플로우**: 한 세션 안에서 따라가는 절차(예: "PR 준비": lint → test → 변경 요약 → 커밋 메시지)입니다. 스킬 + 체크리스트 + `ak` 명령으로 표현하면 그대로 이식됩니다.
2. **에이전트 바깥쪽 오케스트레이션**: 여러 단계나 여러 에이전트, 루프, 재시도가 필요한 것(plan → implement → review → fix 루프)입니다. 이건 에이전트에게 시키지 말고 **외부 runner**가 돌립니다.
   - `workflows/*.yaml`에 단계, 입출력, 종료 조건을 정의합니다.
   - runner는 `AgentDriver` 인터페이스 하나만 압니다: `run({ prompt, cwd, role, budget }) → { output, artifacts, exitStatus }`.
   - 드라이버 구현은 각 런타임의 headless 모드(`pi -p`, `claude -p`, `codex exec` 등)를 감쌉니다. 더 정교하게 가려면 ACP(Agent Client Protocol)처럼 런타임 중립적인 구동 프로토콜을 드라이버 계층에 쓰는 것도 선택지입니다.
   - 단계 간 데이터는 반드시 파일로 넘깁니다(`.harness/runs/<id>/plan.md` 등). 대화 컨텍스트로 넘기면 런타임에 묶입니다.

## 4. 저장소 구조 예시

```
agent-kit/
├─ AGENTS.md                # 합성 결과 (instructions/*에서 생성)
├─ instructions/            # 지침 조각: 코딩 규칙, 커밋 규칙, 리뷰 기준…
├─ skills/<name>/           # SKILL.md + scripts/ + references/
├─ cli/                     # `ak` (TS, Node) — 결정적 로직 전부
├─ policies/                # guard 규칙 (데이터)
├─ hooks.yaml               # 중립 이벤트 → ak hook 매핑
├─ agents/                  # 역할 정의 (planner, reviewer…)
├─ commands/                # 프롬프트 템플릿
├─ workflows/               # 오케스트레이션 정의 (yaml)
├─ runner/                  # workflow runner + AgentDriver 구현들
├─ adapters/
│  ├─ pi/                   # neutral-bridge extension
│  ├─ claude-code/          # settings/agents/commands 생성기
│  └─ codex/
├─ evals/                   # 런타임별 적합성 테스트
└─ ak sync --target pi|claude-code|codex   # 설치/링크/생성
```

전역(개인 하네스)과 프로젝트별 오버레이를 둘 다 지원하려면 `ak sync`가 `~/` 레벨과 repo 레벨을 각각 처리하게 하면 됩니다.

## 5. 가장 중요한 실무 조언

- **두 번째 런타임을 일찍 붙이세요.** pi 하나로만 개발하면 "중립"이라고 생각한 부분에 pi 가정이 조용히 스며듭니다. 1단계부터 pi + 하나(Claude Code나 Codex)를 동시에 sync하고, 같은 골든 태스크를 양쪽에서 돌리는 `evals/`를 CI에 두는 게 중립성을 실제로 보장하는 유일한 방법입니다.
- **최소공통분모 함정을 의식하세요.** 중립 본체는 기능이 적을 수밖에 없습니다. 그래서 규칙을 "본체는 중립, 런타임 고유 강점(pi의 세션 트리, TUI 등)은 어댑터 안에서만, 그리고 없어도 동작해야 함"으로 정해두면 pi의 장점을 포기하지 않아도 됩니다.
- **단계적으로 진행하세요.** ① AGENTS.md + skills + `ak` CLI + 심링크 sync → ② guard 정책 + pi bridge + git hook fallback → ③ 두 번째 런타임 어댑터 + evals → ④ workflow runner.

원하시면 다음 단계로 이 구조대로 `agent-kit` 스캐폴드(중립 스키마 타입 정의, `ak sync`, pi bridge extension 뼈대)를 TypeScript로 바로 만들어 드리거나, 이 설계를 공유용 설계 문서로 정리해 드릴 수 있습니다.

Sources:
- [vercel-labs/skills wiki](https://github.com/vercel-labs/skills/wiki)
- [SKILL.md — The Agent Skills Format](https://www.mdskills.ai/specs/skill-md)
- [pi.dev deep dive](https://urandom.io/blog/2026-03-07-pi-dev-deep-dive)

--- [3] USER ---
이런식으로 벤더 중립적인 본인만의 에이전트 워크플로우를 구축하고 있는 실제 개인 사례들을 최대한 많이 조사해줘

--- [4] ASSISTANT ---
벤더 중립 에이전트 하네스를 직접 만들어 쓰는 개인 사례를 웹에서 폭넓게 찾아 정리할게요.

--- [5] ASSISTANT ---
벤더 중립 하네스를 만드는 개인 사례 20여 개를 찾았습니다. 패턴별로 묶고, 각 사례에서 지금 설계에 가져올 만한 점을 함께 적었습니다.

## A. 공용 저장소 + 심링크 (가장 많이 수렴한 패턴)

- **Peter Steinberger, [agent-scripts](https://github.com/steipete/agent-scripts)**: 대표적인 원형입니다. 공용 규칙 AGENTS.MD, skills/, scripts/, hooks/를 한 저장소에 두고, ~/.codex/AGENTS.md와 ~/.claude/CLAUDE.md, 스킬 폴더를 모두 이 저장소로 심링크합니다. 각 프로젝트의 AGENTS.MD는 공용 파일을 먼저 읽으라는 포인터 한 줄로 줄이고 저장소별 메모만 그 아래에 붙입니다. BramVR 등 이 구조를 포크해 쓰는 사람도 여럿입니다.
- **jsavyasachi, ai-dotfiles**: Claude Code, OpenCode, Gemini CLI, Codex, Cursor를 대상으로 하는 크로스 머신·크로스 에이전트 설정입니다. 공통 지침 파일 하나를 런타임별 이름으로 링크하고, 커맨드는 Gemini용 .toml과 Codex/OpenCode용 SKILL.md로 생성합니다. 형식 변환이 필요한 부분만 생성기로 처리하는 방식입니다.
- **kaufmann-dev, dotfiles**: chezmoi 템플릿으로 런타임별 AGENTS.md/CLAUDE.md/GEMINI.md를 만들고, 공용 스킬은 ~/.agents/skills/에 설치합니다.
- **luabagg, agent-skills**: 전역 지침 AGENTS.global.md를 Claude, Codex, Copilot, OpenCode, Pi에 배포하고, 개인 스킬도 npx skills로 다섯 런타임에 설치합니다. pi가 대상에 포함된 사례입니다.
- **mihaiserban, skills**: 설치된 하네스(pi, Claude Code, OpenCode, Codex)를 자동 감지해 링크하는데, pi는 ~/.agents/skills/에 클론하는 것만으로 충분해 링크를 건너뜁니다. `~/.agents/skills`가 사실상 중립 위치로 자리 잡아 가는 신호입니다.

## B. 중립 소스 → 런타임별 어댑터 생성 (지금 설계와 가장 가까움)

- **u1f992, [dotfiles](https://github.com/u1f992/dotfiles)**: 훅 중립화의 모범 사례입니다. 공유 훅 데이터와 호스트 독립적인 정책 코드는 .agents/hooks/에 한 벌만 두고, Claude와 Codex는 각자의 훅 스키마와 HookAdapter만 별도 파일로 가집니다. 실행 진입점은 어댑터, 정책, JSON만 연결하고 stdin/stdout 처리는 공용 cli.ts가 담당합니다. Codex의 편집 어댑터가 apply_patch에서 추가된 줄만 뽑아내는 등 런타임 차이를 어댑터 안에 가둔 점이 앞서 제안한 `hooks.yaml + ak hook` 구조와 거의 같습니다.
- **RascalTwo, ai-setup**: Claude Code와 Codex가 공유하는 규칙, 스킬, MCP, 개발 파이프라인을 담은 개인 설정입니다. 리뷰어 서브에이전트는 .ruler/agents/에 한 번 작성해 Ruler로 두 런타임의 네이티브 형식으로 컴파일하고, 회사나 개인 스킬은 별도 비공개 저장소를 오버레이로 얹습니다. 공개 본체와 비공개 오버레이를 분리하는 아이디어가 유용합니다.
- **yourconscience, dotagents**: 비공개 ~/.agents git 저장소 하나에 스킬, MCP 서버, 훅, 에이전트 역할을 모두 담습니다. Claude Code, Codex, Hermes, Droid로 동기화하고 `doctor` 명령으로 frontmatter, lock pin, 훅을 점검합니다. 런타임 간 정합성 검사를 내장한 드문 사례입니다.
- **개인이 만든 범용 도구들**: Eleanor Berger의 **Ruler**는 에이전트 지침의 단일 원천을 각 런타임 설정 파일로 자동 배포하며 pi도 지원합니다. 다만 모든 에이전트가 같은 지침을 이어 붙인 형태로 받기 때문에, 에이전트별 지침은 파일 안에서 직접 나눠야 한다는 한계가 지적됩니다. dyoshikawa의 **rulesync**는 범위가 더 넓어 rules, ignore, MCP, commands, subagents, skills, hooks, permissions까지 런타임별 지원 매트릭스로 관리합니다. Ian Nuttall의 **dotagents**는 .agents 폴더 하나를 각 런타임의 commands, hooks, skills 경로로 링크합니다.

## C. 스킬 라이브러리를 여러 런타임에 배포

- **Jesse Vincent(obra), superpowers**: 지원 대상이 Claude Code, Codex, Cursor, OpenCode, Pi 등으로 넓어졌고 pi에는 `pi install git:`으로 설치됩니다. 다만 OpenCode는 별도 플러그인 설치가 필요한 등 런타임별 설치 경로가 제각각이라, 스킬 자체는 중립이어도 배포는 어댑터 작업이라는 점을 보여줍니다.
- **Kieran Klaassen(Every), compound-engineering**: 회사 프로젝트지만 사실상 개인 워크플로우를 패키징한 것입니다. Claude Code 플러그인을 OpenCode, Codex, Droid, Pi, Gemini 등의 형식으로 변환하는 CLI를 함께 제공합니다. 눈여겨볼 점은 Codex로 변환할 때 스킬 description이 Codex 제한 때문에 1024자로 잘린다는 것입니다. 변환 과정에서 정보가 손실되므로, 처음부터 가장 엄격한 런타임 제약에 맞춰 작성하는 편이 안전합니다.

## D. 도구는 런타임 밖의 CLI로

- **Mario Zechner(pi 제작자)**: 「What if you don't need MCP at all?」에서 Chrome DevTools MCP가 도구 26개에 18k 토큰을 쓴다는 점을 들어 브라우저 도구를 작은 CLI 스크립트와 README로 대체했습니다. 이를 따른 devular/agent-tools는 어떤 에이전트든 Bash로 호출할 수 있는 CLI 도구를 표방하며, pi에서는 스킬로, Claude Code에서는 README를 참조하는 방식으로 씁니다.
- **Steve Yegge, beads**: CLI 우선, JSON 출력 설계로 Claude Code, Codex, AMP, Cursor 등 파일을 읽는 모든 에이전트에서 동작합니다. 작업 상태를 런타임 밖 git에 두는 방식이라 "상태는 repo 파일로" 원칙의 좋은 레퍼런스입니다.
- **Armin Ronacher, [agent-stuff](https://github.com/mitsuhiko/agent-stuff)**: 반대 방향의 사례입니다. 스킬, 확장, 프롬프트 커맨드, 테마를 묶은 개인 pi 패키지로 npm에 배포합니다. 스킬(gh, tmux, sentry 등 CLI 래퍼)은 그대로 이식할 수 있지만, 서브에이전트나 goal 모드 같은 핵심 워크플로우는 pi extension(TypeScript)에 묶여 있습니다. pi를 쓰면서도 어디까지를 중립 본체에 두고 어디부터 pi 전용으로 둘지 경계를 정할 때 참고하기 좋습니다.

## E. 워크플로우를 파일과 루프로 표현

- **Geoffrey Huntley, Ralph loop**: 의도적으로 하네스에 독립적인 루프이고, 도구 호출에 제한만 없으면 어떤 도구로도 돌릴 수 있습니다. 실제로 Claude Code, Amp, Codex, OpenCode에서 쓰입니다. 반복 사이의 기억은 plan, todo, notes 같은 파일이 이어 줍니다. 앞서 말한 바깥쪽 오케스트레이션의 최소형입니다.
- **Harper Reed**: spec.md → prompt_plan.md → todo.md 3단계 방식이며, 본인도 써 본 모든 도구에서 잘 동작했고 어떤 코드 생성 도구에서도 통할 것이라고 말합니다. Claude Code로 실행 도구를 바꾼 뒤에도 spec과 plan 단계는 그대로 유지했다는 점이 중립 워크플로우의 실제 효용을 보여줍니다.
- **Brian Casel, Agent OS**: 결과물이 모두 markdown이라, Claude Code가 아닌 도구에서는 agent-os/ 폴더의 파일을 직접 참조하면 됩니다. `{{workflows/...}}` 같은 주입 문법으로 워크플로우 조각을 설치 시점에 합성하는 방식은 instructions 조각 합성 설계에 참고할 만합니다.

## F. 멀티 런타임 오케스트레이션, 그리고 반대 신호

- **Steve Yegge, Gas Town / Gas City**: claude, gemini, codex 런타임을 기본 지원하고 모델과 플래그를 담은 커스텀 에이전트 별칭을 지정할 수 있습니다. 런타임을 교체 가능한 드라이버로 다루는 방식입니다.
- **주의할 반대 신호**: 2026년 8월 Yegge는 자신의 Gas Town 워크플로우가 실패했다고 밝히고, 재사용 가능한 하네스 개발을 접은 뒤 자기 게임 프로젝트 전용 비공개 하네스(Wheelhouse)로 옮겼습니다. 범용화를 과하게 밀면 비용이 커진다는 실증 사례입니다.

## G. 국내 사례

- **[issueops](https://github.com/m16khb-org/issueops)**: 가장 설계가 깊은 국내 사례입니다. Codex, Claude Code, Omo native를 하나의 실행 계약으로 연결하고, 작업 상태와 안전 경계, 검증 근거를 로컬에 남깁니다. 세 호스트가 같은 core와 response contract를 쓰고, 그 앞에 스킬, 훅, MCP 연결만 담당하는 얇은 host adapter를 둡니다.
- **[HandOff](https://github.com/NewTurn2017/HandOff)**: Claude Code, Codex CLI 등 여러 에이전트의 세션을 하나의 저장소에 저장했다가 다음 세션에서 이어가는 스킬 세트입니다. 불러올 때 저장한 에이전트와 현재 에이전트가 다르면 경고합니다. 세션 연속성을 런타임 밖으로 뺀 사례입니다.
- **[bstack](https://github.com/karatuss/bstack)**: 스킬 내용은 같고 진입 문서만 CLAUDE.md(Claude Code)와 AGENTS.md(Codex, Cursor, Gemini CLI, OpenCode 등) 두 갈래로 나눈 Spring 백엔드 하네스입니다.
- **[gihwan-dev/claude-setup](https://github.com/gihwan-dev/claude-setup)**: Claude 중심 스킬 모음을 Codex에서도 쓸 수 있게 정리하고, 두 런타임용 설치 스크립트(링크/복사)를 따로 제공합니다. 이식의 출발점으로 흔히 쓰이는 형태입니다.

## 설계에 주는 시사점

1. **본체 형식은 사실상 수렴했습니다.** canonical 저장소 + AGENTS.md + `~/.agents/skills` + 심링크 또는 생성이 표준처럼 굳어지고 있으니 여기서 새로 발명할 필요는 없습니다.
2. **차별화 지점은 훅과 정책입니다.** 대부분 사례가 지침과 스킬에서 멈추고, 훅까지 중립화한 곳은 u1f992와 issueops 정도입니다. 공용 정책 코드 + 호스트별 얇은 어댑터 구조는 이미 검증된 패턴이니, pi용 어댑터를 하나 추가하는 식으로 그대로 가져가면 됩니다.
3. **변환은 손실이 생깁니다.** compound-engineering의 1024자 제한처럼, 가장 엄격한 런타임 제약을 본체 스키마의 기준으로 삼는 것이 좋습니다.
4. **런타임 간 적합성 테스트는 거의 빈칸입니다.** 정합성 검사를 내장한 곳은 dotagents의 `doctor` 정도라서, 앞서 제안한 evals는 차별화 요소가 될 수 있습니다.
5. **과도한 범용화는 경계해야 합니다.** Yegge의 철수와 Armin의 pi 전용 선택을 보면, 중립 본체는 작게 두고 런타임 고유 기능은 어댑터에서 마음껏 쓰는 쪽이 오래 갑니다.

원하시면 이 중 u1f992의 HookAdapter나 issueops의 response contract 코드를 직접 읽고 분석해서 `ak` 설계에 반영할 인터페이스 초안으로 정리해 드릴게요.

Sources:
- [steipete/agent-scripts README](https://raw.githubusercontent.com/steipete/agent-scripts/main/README.md)
- [jsavyasachi/ai-dotfiles](https://awesome.ecosyste.ms/projects/github.com%2Fjsavyasachi%2Fai-dotfiles)
- [kaufmann-dev/dotfiles](https://github.com/kaufmann-dev/dotfiles)
- [luabagg/agent-skills](https://github.com/luabagg/agent-skills)
- [mihaiserban/skills](https://github.com/mihaiserban/skills)
- [u1f992/dotfiles](https://github.com/u1f992/dotfiles)
- [RascalTwo/ai-setup](https://github.com/RascalTwo/ai-setup)
- [yourconscience/dotagents](https://pkg.go.dev/github.com/yourconscience/dotagents)
- [intellectronica/ruler](https://github.com/intellectronica/ruler/wiki)
- [Ruler 요약 (sourcepulse)](https://www.sourcepulse.org/projects/10595393)
- [dyoshikawa/rulesync](https://github.com/anand817/rulesync)
- [iannuttall/dotagents](https://agentskill.work/en/skills/iannuttall/dotagents)
- [obra/superpowers](https://github.com/crichalchemist/superpowers)
- [compound-engineering-plugin](https://github.com/TrendpilotAI/compound-engineering-plugin)
- [Mario Zechner — What if you don't need MCP at all?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)
- [devular/agent-tools](https://github.com/devular/agent-tools)
- [Beads (morphllm)](https://www.morphllm.com/beads-agent-memory)
- [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)
- [Ralph Loops (d-central)](https://d-central.tech/agentic-engineering/ralph-loops/)
- [Ralph Technique (howaiworks)](https://howaiworks.ai/blog/geoffrey-huntley-ralph-agentic-coding-loop)
- [Harper Reed — My LLM codegen workflow atm](https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/)
- [Harper Reed workflow explained](https://howaiworks.ai/blog/harper-reed-llm-codegen-workflow)
- [Agent OS](https://buildermethods.com/agent-os)
- [Agent OS workflows](https://buildermethods.com/agent-os/workflows)
- [Installing Gas Town](https://docs.gastownhall.ai/installing/)
- [Gas Town (AI Engineer)](https://www.ai.engineer/orgs/gas-town)
- [m16khb-org/issueops](https://github.com/m16khb-org/issueops)
- [NewTurn2017/HandOff](https://github.com/NewTurn2017/HandOff)
- [Karatuss/bstack](https://github.com/karatuss/bstack)
- [gihwan-dev/claude-setup](https://github.com/gihwan-dev/claude-setup)

--- [6] USER ---
내가 여태까지 써본 에이전트 런타임 (코덱스,클로드, 오마이오픈코드)등을 쓰면서 느꼈던건, 런타임 레벨에서 주입하는 컨텍스트와, 스킬 레벨에서 주입하는 프롬프트는 결국 모델 입장에서 그냥 하나의 텍스트 컨텍스트가 아닌가 싶은건데 니 의견은 어때

--- [7] ASSISTANT ---
네, 대체로 맞는 직관이라고 생각해요. 모델 입장에서는 런타임 시스템 프롬프트든, AGENTS.md든, 스킬 본문이든, 툴 결과든 결국 토큰으로 이어진 하나의 컨텍스트입니다. "스킬"이나 "확장" 같은 구분은 하네스가 붙인 이름이지 모델이 따로 인식하는 개념이 아니에요. 그래서 중립 하네스를 설계할 때 "결국 다 텍스트니까 이식 가능하다"는 전제는 꽤 단단합니다.

다만 "같은 텍스트"여도 결과가 달라지게 만드는 변수가 몇 개 있어서, 저는 "하나의 텍스트지만 **주소가 붙은** 텍스트"라고 보는 편이 더 정확하다고 생각해요.

**어디에 들어가느냐(위치와 역할).** 같은 문장이라도 system/developer 영역에 있을 때, user 턴에 있을 때, 툴 결과로 들어올 때 모델이 다르게 다룹니다. 요즘 모델은 지시 계층(instruction hierarchy)을 학습해서 툴 결과 안의 지시는 데이터로 취급하고 덜 따르도록 훈련돼 있어요. 위치 효과도 있습니다. 긴 대화에서는 맨 앞 시스템 프롬프트보다 최근에 들어온 텍스트가 더 강하게 작용하기 쉬워서, Claude Code의 system-reminder처럼 런타임이 중요한 걸 대화 끝쪽에 다시 주입하는 장치를 두는 겁니다.

**언제, 누가 넣느냐(타이밍과 결정 주체).** 런타임 컨텍스트는 코드가 결정적으로 매번 넣지만, 스킬은 보통 모델이 description을 보고 "읽을지 말지"를 스스로 판단합니다. 그래서 스킬에 넣은 규칙은 아예 로드되지 않을 수 있어요. 컴팩션 이후 살아남는지, 프롬프트 캐시에 포함되는지도 런타임마다 다릅니다. 텍스트 내용은 같아도 "존재 확률"이 다른 셈이죠.

**모델이 어떤 하네스에서 훈련됐느냐.** Claude는 Claude Code 같은 환경, GPT 계열은 Codex 환경의 관습(도구 이름, 리마인더 형식, 패치 형식 등)에 맞춰 후훈련된 흔적이 있습니다. 그래서 같은 스킬 텍스트를 다른 런타임과 모델 조합에 넣으면 따르는 정도가 달라질 수 있어요. 오마이오픈코드를 쓰면서 모델을 바꿨을 때 같은 프롬프트의 체감이 달랐다면 아마 이 영향일 겁니다.

**텍스트가 아닌 것도 있다.** 이게 가장 중요한 구분인데요, 훅이 툴 호출을 실제로 차단하거나, 권한과 샌드박스가 명령 실행을 막는 건 모델에게 "부탁"하는 게 아니라 모델 바깥에서 "강제"하는 겁니다. 텍스트 컨텍스트는 아무리 잘 써도 확률적으로 설득할 뿐이고요.

그래서 이 관점을 하네스 설계로 옮기면, 중립 스키마에 "무슨 텍스트인가"뿐 아니라 "어느 슬롯에 들어갈 텍스트인가"를 명시하는 게 좋다고 봅니다. 예를 들면 항상 로드(AGENTS.md), 필요할 때 로드(스킬), 매 턴 또는 특정 이벤트 후 리마인더, 툴 결과로 전달 같은 식이에요. 각 런타임 어댑터는 이 슬롯을 자기 메커니즘에 매핑하고요. 그리고 "반드시 지켜져야 하는 것"은 처음부터 텍스트 쪽에 두지 말고 훅이나 정책 코드 쪽으로 분류하면, "결국 다 텍스트"라는 통찰의 장점은 살리면서 그 한계는 피할 수 있습니다.

--- [8] USER ---
모델 바깥에서 강제하는것이 에이전트 런타임의 존재 이유이자 역할이잖아. 니 입장에서 봤을때, 정말 많은 툴들을 런타임이 제시하는것과, 정말 필요한 극소수의 툴만 제공하는 것중에 어떤게 작업과 목표 달성의 정확성이나 효율이 높아질 것 같아?

--- [9] ASSISTANT ---
제 입장에서 답하자면, 대부분의 코딩 작업에서는 **극소수의 범용 툴 + 필요할 때만 드러나는 전용 툴** 조합이 정확성과 효율 모두에서 낫다고 봅니다. 다만 "툴 개수"보다 더 중요한 축이 있어서, 그걸 같이 말씀드릴게요.

**툴이 많을 때 실제로 생기는 비용.** 툴 정의는 매 턴 컨텍스트를 차지합니다. 앞서 본 Mario Zechner 글의 DevTools MCP 사례처럼 툴 묶음 하나가 수천~수만 토큰을 먹기도 해요. 더 큰 문제는 선택 비용입니다. 기능이 겹치는 툴이 여러 개면(`search_files`, `grep`, `find_in_repo`, bash의 rg) 저는 "어느 걸 써야 하나"를 판단하는 데 추론을 쓰게 되고, 미묘하게 다른 동작 차이 때문에 실수할 여지도 커집니다. 툴 수가 늘수록 정확도가 떨어지는 건 개수 자체보다 **겹침과 모호함** 때문이라고 보는 게 맞아요.

**그런데 bash 하나로 다 되느냐 하면 그것도 아닙니다.** 전용 툴이 확실히 나은 경우가 있습니다.
- **출력이 구조화되고 깨끗할 때**: 정확한 문자열 매칭으로 실패를 명확히 알려주는 edit 툴은 sed 한 줄보다 오류가 적습니다. bash 출력은 노이즈가 많고 잘리기도 해요.
- **상태를 가질 때**: 브라우저 세션, 장기 실행 프로세스, 인증 컨텍스트처럼 호출 사이에 상태가 유지돼야 하는 건 일회성 CLI로 다루기 번거롭습니다.
- **런타임이 개입해야 할 때**: 이게 질문하신 "모델 바깥에서 강제"와 직결되는 지점입니다.

**핵심 긴장: 툴을 줄일수록 런타임은 눈이 멀어진다.** 전용 툴은 런타임 입장에서 **의도가 드러나는 개입 지점**입니다. `Edit(path=src/auth.ts)`는 런타임이 경로를 보고 허용, 차단, 로깅할 수 있지만, `bash -c "python - <<EOF ..."`는 무엇을 하려는지 런타임이 알기 어렵죠. 지난번 조사에서 본 u1f992의 메모가 정확히 이 사례입니다. Claude Code의 특정 모드가 파일 접근을 Read/Edit 대신 Bash로 하도록 유도하자, Read/Edit에 걸어 둔 훅과 경로별 규칙이 전부 무력화됐다는 내용이었어요. 즉 bash만 주는 미니멀리즘은 모델의 자유도는 최대화하지만, 런타임의 강제 능력은 최소화합니다. pi가 미니멀하면서도 extension으로 툴을 교체하거나 감쌀 수 있게 열어 둔 이유도 여기에 있다고 봐요. Armin이 bash 툴 자체를 uv-aware 버전으로 바꿔치기한 것처럼, "적은 툴"과 "강제 가능성"을 둘 다 잡으려면 범용 툴 자체를 런타임이 감싸야 합니다.

**모델에 따라서도 답이 다릅니다.** 프론티어 모델은 셸과 파일 조작에 대해 엄청나게 훈련돼 있어서 bash 중심이 잘 통합니다. 반면 작은 모델이나 로컬 모델은 툴 정의가 명확하고 개수가 적을수록 확실히 안정적이에요. 중립 하네스라면 이 차이도 고려해야 합니다.

그래서 하네스 설계 기준으로 정리하면 이렇습니다.
1. **항상 노출하는 핵심**은 read, write/edit, bash 정도의 범용 툴로 최소화합니다.
2. **전용 툴로 승격하는 기준**은 개수가 아니라 이 세 가지입니다: 런타임이 인자를 보고 개입해야 하는가, 호출 간 상태가 필요한가, 출력 구조가 정확성에 결정적인가. 셋 다 아니면 `ak` 같은 CLI로 두고 스킬로 사용법만 알려 줍니다(점진적 공개).
3. **bash 자체를 감싸서** 정책 검사(`ak guard check`)를 통과시킵니다. 그래야 툴이 적어도 런타임이 눈을 뜨고 있을 수 있어요.

한 줄로 말하면, 정확성을 떨어뜨리는 건 툴의 개수보다 겹침이고, 툴을 줄일 때 잃는 건 효율이 아니라 런타임의 통제력이라서, 통제가 필요한 지점에만 전용 툴을 두는 게 최적점이라고 생각합니다.

--- [10] USER ---
결정성이 높은 작업일 수록 토큰 효율성이 매우 올라간다고 볼 수 있겠네?

--- [11] ASSISTANT ---
네, 방향은 맞습니다. 다만 정확히 말하면 "결정적인 작업이 원래 토큰 효율적"이라기보다, **결정성이 높을수록 그 작업을 모델 밖으로 빼냈을 때 아낄 수 있는 토큰이 커진다**고 보는 게 맞아요.

결정적인 작업도 모델이 직접 하면 오히려 가장 비싼 축에 속합니다. 예를 들어 파일 200개의 import 경로를 바꾸는 일을 모델이 edit 툴로 하나씩 처리하면, 매 호출마다 파일을 읽고, 변경 내용을 생성하고, 결과를 확인하는 토큰이 쌓이고 중간에 틀릴 확률도 누적됩니다. 같은 일을 스크립트 한 번으로 돌리면 모델은 "스크립트를 쓰고 실행하고 요약 결과를 확인"하는 데만 토큰을 씁니다. 차이는 작업이 반복적이고 규칙적일수록 커져요.

절감이 일어나는 지점을 나눠 보면 이렇습니다.
- **추론 토큰**: 정답이 정해진 일을 모델이 매번 다시 "생각"하지 않아도 됩니다.
- **왕복 횟수**: 여러 번의 툴 호출이 한 번으로 줄어서, 턴마다 다시 읽히는 컨텍스트 비용도 함께 줄어듭니다.
- **재시도 비용**: 결정적인 코드는 같은 입력에 같은 결과를 내니, 모델의 확률적 실수를 고치는 루프가 사라집니다. 토큰보다 이게 더 큰 이득인 경우가 많아요.

대신 주의할 점이 몇 가지 있습니다.
- **툴의 출력 설계가 절반입니다.** 결정적인 CLI라도 출력을 수천 줄씩 쏟아내면 절감 효과가 사라집니다. 기본은 짧은 요약과 JSON으로 내고, 상세 내용은 플래그나 파일로 빼는 설계가 중요해요.
- **도구를 만드는 비용은 반복으로 회수됩니다.** 한 번만 할 일이면 하네스에 정식 CLI로 넣을 필요까지는 없습니다. 이럴 때는 모델이 그 자리에서 일회용 스크립트를 짜서 돌리는 게 최적이고, Armin이 "throwaway code를 활용하는 에이전트"라는 글에서 다룬 것도 이 방향입니다. 그러다 같은 스크립트를 세 번째 짜고 있다면 그때 `ak` 명령으로 승격하면 됩니다.
- **판단이 섞인 작업을 억지로 결정화하면 오히려 손해입니다.** 규칙이 계속 예외를 만나는 일을 코드로 고정하면, 모델이 예외 처리를 위해 더 많은 토큰을 쓰거나 잘못된 결과를 그대로 통과시킵니다.

그래서 하네스 관점에서는 워크플로우의 각 단계를 "결정적인가, 판단이 필요한가"로 분류하고, 결정적인 부분은 `ak` CLI, 훅, 외부 runner로 보내고 모델의 토큰은 판단이 필요한 지점에만 쓰게 하는 게 원칙이 됩니다. 앞서 얘기한 "강제는 모델 밖에서"와 같은 원리가 비용 쪽에서도 성립하는 셈이죠. 정확성, 비용, 재현성 세 가지가 모두 같은 방향을 가리킨다는 게 이 설계 원칙이 튼튼한 이유라고 생각합니다.

--- [12] USER ---
그런 생각이 들었어. 예로 내가 A라는 프로젝트를 에이전트 모델과 같이 작업하는데에 몰두하고 있잖아. 그리고 그 세션에서 인터렉션하는 모델 또한 A라는 프로젝트 구현에 집중하고있겠지, 이 세션에 대해 전혀 관련이 없는 다른 에이전트 C가 접근해서 세션에서 발생한 여러 반복되는 패턴이나 작업 흐름을 분석하고 추출해서 워크플로우 스크립트로 정적인 익스텐션이나 스킬을 제안하는 이런 흐름이 가능해? 이걸 런타임 에서 구현가능하냐는거임 내 질문 이해못했으면 다시물어봐

--- [13] ASSISTANT ---
질문 이해했어요. "작업 중인 세션 A에는 개입하지 않으면서, 별개의 관찰자 에이전트 C가 세션 기록을 사후에 분석해 반복 패턴을 스킬, 확장, 스크립트로 제안하는 흐름을 런타임 수준에서 만들 수 있냐"는 거죠. 가능합니다. 그리고 지금까지 얘기한 원칙들과도 잘 맞는 구조예요.

## 왜 가능한가

필요한 재료는 두 가지뿐입니다.
1. **세션이 기록으로 남아야 합니다.** pi는 세션을 JSONL 파일로 저장합니다. Armin의 agent-stuff에 있는 `analyze-edits.py`가 바로 pi 세션 JSONL에서 edit 툴 사용 패턴을 분석하는 스크립트예요. 관찰자 C의 원시적인 형태가 이미 있는 셈입니다. Claude Code와 Codex도 세션 기록을 로컬 파일로 남깁니다.
2. **분석을 시작할 신호가 있어야 합니다.** 세션 종료나 N턴 경과 같은 이벤트를 extension이나 훅으로 받거나, 아예 cron으로 세션 폴더를 주기적으로 훑어도 됩니다.

여기서 핵심은 **런타임이 할 일은 "기록하고 신호 보내기"까지이고, C는 런타임 바깥에서 돌아야 한다**는 점입니다. C를 세션 A 안의 서브에이전트로 두면 A의 컨텍스트를 건드리거나 같은 모델의 관점에 갇히게 됩니다. 별도 프로세스에서 돌려야 A의 몰입을 해치지 않고, 분석에 더 싼 모델을 쓸 수 있으며, pi, Claude, Codex 세션을 한꺼번에 볼 수 있어 벤더 중립성도 유지됩니다.

## 구조 제안

```
[세션 A: pi / Claude / Codex]
   │ 세션 로그(JSONL) + 종료 이벤트
   ▼
① 트레이스 정규화 (런타임별 어댑터 → 공통 스키마)
   user_msg / tool_call(name, args) / result(exit, size) / tokens / correction
   ▼
② 결정적 마이닝 (코드, LLM 없음)
   - 반복되는 툴 호출 시퀀스 (n-gram, 세션 간 빈도)
   - 같은 bash 명령 조합, 같은 파일 반복 읽기
   - 실패 → 재시도 루프, 사용자의 정정("아니 그거 말고")
   - 토큰을 많이 쓴 구간
   ▼
③ 관찰자 C (LLM, 후보 클러스터만 입력)
   "이건 스킬인가 / ak CLI인가 / 훅(강제)인가 / 그냥 우연인가" 판정 + 초안 작성
   ▼
④ 제안함(inbox): 근거(세션 id, 빈도, 추정 절감 토큰) + 초안
   ▼  사람이 승인
⑤ 중립 본체에 반영 → ak sync로 모든 런타임에 배포
   ▼
⑥ 효과 측정: 채택 후 해당 패턴의 빈도·토큰이 실제로 줄었는지 다시 마이닝
```

지난번 얘기와 연결하면, ②를 코드로 두는 게 중요합니다. 수백 개 세션의 원문을 C에게 통째로 넣으면 비싸고 부정확해요. 반복 탐지라는 결정적인 부분은 코드가 맡고, "이게 코드로 굳힐 가치가 있는 패턴인가"라는 판단만 C에게 맡기는 겁니다. ③의 분류도 앞에서 정한 기준을 그대로 씁니다. 판단이 필요한 절차는 스킬, 완전히 결정적인 반복은 CLI, 반드시 지켜져야 하는 규칙은 훅으로 보내는 식이에요.

## 실제로 만들 때 조심할 점

- **세션 기록은 신뢰할 수 없는 데이터입니다.** 세션에는 웹 페이지, 이슈 본문, 툴 출력이 섞여 있어서 C가 그 안의 문장을 지시로 받아들이면 오염된 스킬을 제안할 수 있어요. 게다가 pi extension은 임의 코드를 실행하니 **자동 설치는 절대 하지 말고** 항상 사람 승인을 거쳐야 합니다.
- **비밀 정보가 섞여 있습니다.** 토큰이나 키가 로그에 남아 있을 수 있으니 정규화 단계에서 마스킹해야 합니다.
- **제안 피로.** 임계값 없이 돌리면 쓸모없는 제안이 쏟아집니다. "N개 이상 세션에서, 추정 절감량 X 이상"처럼 문턱을 두고, 기각한 제안은 다시 올라오지 않게 기록해 두는 게 좋아요.
- **같은 의도, 다른 표면.** 사람과 모델은 같은 일을 매번 조금씩 다른 명령으로 합니다. 그래서 명령 문자열을 그대로 비교하기보다 정규화(경로, 인자 추상화)를 거친 뒤 묶어야 패턴이 보입니다. 이 부분은 C의 판단을 일부 빌려야 할 수도 있어요.

참고로 이 패턴 자체는 이미 제품에도 들어오고 있습니다. 지금 제가 돌고 있는 Claude 앱에도 대화에서 반복된 절차를 스킬로 제안하는 기능이 있어요. 다만 그건 한 런타임 안에 갇혀 있고, 말씀하신 건 여러 런타임의 세션을 공통 스키마로 모아서 중립 본체로 환류시키는 구조라 범위가 다릅니다. 이건 지난번 조사에서도 거의 아무도 안 하고 있던 영역이에요.

원하시면 첫 단계로 pi 세션 JSONL을 공통 트레이스 스키마로 바꾸는 정규화기와 반복 시퀀스를 뽑는 마이너를 TypeScript로 프로토타이핑해 볼 수 있습니다. 실제 세션 파일 몇 개만 붙여 주시면 그걸로 바로 돌려 볼게요.

--- [14] USER ---
좋은거같음, 하나의 런타임 프로세스 안에서, 메인 에이전트가 개별 서브에이전트에게 작업을 지시하는건, 서브에이전트 스폰 조차 비결정성에 의존하는 거고, 내가 하나의 작업에 매몰되더라도, 그동안 각 세션 작업을 통합해서 보고해주는 에이전트가 별다른 지시나 메인 세션 작업에서의 트리거가 없더라도 자동으로 구조화 시킬 수 있다는 거지?

--- [15] ASSISTANT ---
네, 정확히 그겁니다. 한 가지만 다듬자면 "트리거가 없다"기보다는 **트리거의 주체가 모델에서 코드로 바뀐다**고 보는 게 정확해요.

| | 런타임 안 서브에이전트 | 바깥 관찰자 C |
|---|---|---|
| 실행 여부를 누가 결정하나 | 메인 에이전트(모델)의 판단 | cron, 파일 감시, 런타임 라이프사이클 이벤트(코드) |
| 실행이 보장되나 | 모델이 "필요하다"고 판단해야만 실행 | 조건이 맞으면 항상 실행 |
| 메인 세션 컨텍스트 | 지시와 결과가 메인 컨텍스트를 오가며 소비 | 전혀 건드리지 않음(읽기 전용) |
| 볼 수 있는 범위 | 그 세션 하나 | 여러 세션, 여러 프로젝트, 여러 런타임 |

말씀하신 대로 인프로세스 서브에이전트는 "스폰할지 말지"부터 모델의 확률적 판단에 달려 있습니다. 메인이 작업에 몰두해 있으면 정리나 보고 같은 부수 작업은 우선순위에서 밀려 아예 일어나지 않을 수도 있어요. 반면 C는 "매일 저녁 6시", "세션 파일이 마지막으로 바뀐 지 10분 지남", "세션 종료 이벤트" 같은 결정적인 조건으로 깨어나니, 메인 세션에서 누구도 아무것도 요청하지 않아도 돌아갑니다. 참고로 세션 종료 이벤트도 런타임 코드가 내보내는 것이라 모델 판단과는 무관합니다.

이렇게 하면 통합 보고도 자연스럽게 됩니다. C가 모든 세션 로그를 모아서 세션별로 무엇을 했는지, 어디서 막혔는지, 아직 열려 있는 작업이 뭔지, 반복 패턴과 스킬 제안을 하나의 구조화된 리포트로 만들 수 있어요. A 작업에 매몰돼 있는 동안 B, C 프로젝트에서 돌던 다른 세션들의 상태가 한 곳에 정리되는 셈이죠.

다만 비결정성이 완전히 사라지는 건 아니고, **위치가 옮겨질 뿐**이라는 점은 알고 계시면 좋겠습니다.
- C가 **실행되는지**는 결정적입니다.
- C가 **무엇을 보는지**도 결정적입니다. 로그 수집과 반복 패턴 마이닝은 코드가 하니까요.
- C가 **어떻게 요약하고 판단하는지**만 확률적입니다. 그래서 출력은 고정된 JSON 스키마로 강제하고, 수치(빈도, 토큰, 실패 횟수)는 마이닝 결과를 그대로 쓰고, LLM은 요약과 "스킬로 만들 가치가 있나" 같은 판단에만 쓰는 게 좋습니다. 그래야 리포트끼리 비교도 되고, 같은 데이터에서 매번 다른 숫자가 나오는 일을 막을 수 있어요.

한계도 몇 가지 있습니다. C는 **로그에 남은 것만** 압니다. 머릿속 의도나 세션 밖에서 한 일은 모르죠. 진행 중인 세션은 로그가 계속 자라고 있으니, 파일 오프셋을 기억해 두고 증분으로 읽는 처리가 필요합니다. 그리고 원칙적으로 C는 세션에 **다시 써 넣지 않는** 게 좋습니다. 결과는 inbox 파일, 일일 다이제스트, 알림 같은 별도 채널로만 내보내야 "몰입은 지키고 정리는 자동으로"라는 목적이 유지됩니다.

정리하면, 하네스에서 "모델이 기억해서 하길 바라는 일"을 "코드가 반드시 하는 일"로 옮기는 원칙을 에이전트 운영 자체에 적용한 구조입니다. 지금까지 얘기한 원칙이 그대로 한 단계 위로 확장된 거라, 설계 방향으로 아주 좋다고 생각해요.

--- [16] USER ---
파이로 이 구조가 구현 가능할까

--- [17] ASSISTANT ---
pi의 현재 확장 API와 세션 저장 방식을 확인해 보고 답할게요.

--- [18] ASSISTANT ---
네, pi로 충분히 구현할 수 있습니다. 확인해 보니 이 구조에 필요한 부품이 pi에 거의 다 들어 있어요. 그리고 정정할 것이 하나 있습니다. 처음 답변에서 pi가 MCP를 기본 내장하지 않는다고 했는데, 현재는 Pi 1.0이 나와 있고 extension API에 `pi.registerMcpServer()`로 MCP 서버를 추가하는 기능이 들어와 있습니다. 이전 정보였습니다.

## 구성 요소별 pi 매핑

| 역할 | pi에서 쓸 기능 |
|---|---|
| 세션 기록 | 세션이 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl` 형태로 자동 저장되어 외부에서 그대로 읽을 수 있음 |
| 결정적 트리거 | `session_shutdown`(종료 시), `agent_settled`(pi가 더 이상 자동으로 이어가지 않음이 확정된 시점, 알림 전용) 이벤트 |
| 관찰자 C 실행 | `pi --print --mode json`으로 헤드리스 실행하거나, 상주 데몬이라면 `@earendil-works/pi-coding-agent`의 `RpcClient`(RPC 자식 프로세스를 띄우고 타입 있는 명령과 이벤트 제공) 사용 |
| C의 읽기 전용 강제 | C 쪽 extension의 `tool_call` 핸들러로 쓰기 계열 호출 차단. 핸들러가 실패해도 안전하게 툴이 막히는 fail-safe 동작 |
| 리포트 형식 강제 | 커스텀 툴에 `outputSchema`를 선언하고 `structuredContent`로 반환 → C가 이 툴로만 제출하게 하면 스키마가 고정됨 |
| 메인 세션에 조용히 알림 | `ctx.ui`의 상태 텍스트, 위젯, 알림. 대화 컨텍스트에는 아무것도 주입하지 않음 |

## 권장 구조

```
[세션 A: pi 인터랙티브]
  └─ signal 확장 (아주 얇게)
       agent_settled / session_shutdown
       → ~/.agent-kit/queue/<session-id>.json 에 "이 세션 파일, 이 오프셋까지 분석해" 기록
       → ctx.ui 상태줄에 "관찰자: 제안 2건" 정도만 표시

[관찰자 데몬: 별도 Node 프로세스, launchd/cron 또는 상주]
  ① queue 감시 + 주기 스캔 (트리거 누락 대비)
  ② 정규화: pi JSONL → 공통 트레이스 스키마   ← 나중에 Claude/Codex 어댑터 추가
  ③ 결정적 마이닝 (코드)
  ④ C 호출: pi --print --mode json --no-session (+ 읽기 전용 확장, 제출 툴)
  ⑤ ~/.agent-kit/inbox/ 에 리포트·제안 초안 저장
```

signal 확장은 대략 이 정도 크기면 됩니다(이벤트 페이로드의 정확한 타입은 `extensions/types.ts` 기준으로 맞춰야 합니다).

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFile, mkdir } from "node:fs/promises";

export default function (pi: ExtensionAPI) {
  const enqueue = async (ctx: any, reason: string) => {
    const file = ctx.sessionManager.getSessionFile?.(); // 실제 API 이름 확인 필요
    if (!file) return;
    await mkdir(`${process.env.HOME}/.agent-kit/queue`, { recursive: true });
    await writeFile(
      `${process.env.HOME}/.agent-kit/queue/${Date.now()}.json`,
      JSON.stringify({ file, reason, at: new Date().toISOString() }),
    );
  };
  pi.on("agent_settled", (_e, ctx) => enqueue(ctx, "settled"));
  pi.on("session_shutdown", (_e, ctx) => enqueue(ctx, "shutdown"));
}
```

## 구현할 때 주의할 점

- **분석 로직을 pi extension 안에 넣지 마세요.** 문서에서도 factory에서 프로세스, 워처, 타이머를 시작하지 말라고 하고, extension은 pi 프로세스와 같은 OS 권한으로 돌면서 프롬프트, 파일, 자격증명, 세션 기록에 모두 접근할 수 있습니다. 확장은 신호만 보내고, 관찰자는 독립 데몬으로 두는 게 안전합니다. 이렇게 해야 나중에 런타임이 바뀌어도 정규화 어댑터와 C를 부르는 드라이버만 교체하면 되니, 벤더 중립 원칙과도 맞습니다.
- **세션이 트리 구조입니다.** pi 세션은 분기(branch)를 가진 트리라서, 문서에서도 버려진 분기는 다른 역사를 나타내니 파일의 모든 엔트리로 상태를 재구성하지 말라고 합니다. 마이닝할 때 "실제로 채택된 경로"와 "버린 시도"를 구분해야 하는데, 오히려 이게 장점이 될 수 있어요. 버린 분기는 "모델이 헤맨 지점" 신호로 쓸 수 있습니다.
- **C 자신의 세션을 분석 대상에서 빼야 합니다.** `--no-session`으로 돌리거나 C 전용 작업 디렉터리를 제외하지 않으면, C가 자기 분석 세션을 다시 분석하는 재귀가 생깁니다.
- **진행 중인 세션은 증분으로 읽어야 합니다.** queue에 오프셋을 기록해 두고 이어서 읽어야 같은 구간을 두 번 분석하지 않습니다.
- **스케줄러는 pi 밖에 둡니다.** pi에는 cron 같은 기능이 없으니 launchd/cron이나 데몬 내부 타이머로 "트리거가 누락됐을 때를 대비한 주기 스캔"을 둡니다. 세션 이벤트와 주기 스캔을 함께 쓰면 놓치는 세션이 없습니다.

참고로 Pi 1.0과 함께 Pi Durable이라는 것도 발표됐는데, 이름으로 보면 장시간 실행이나 백그라운드 작업 쪽과 관련 있을 수 있지만 아직 내용은 확인하지 못했습니다. 관찰자 데몬을 직접 만들기 전에 한번 볼 가치는 있어 보여요.

다음 단계로 ① signal 확장, ② pi JSONL 정규화기(트리에서 활성 분기만 추출), ③ 반복 툴 시퀀스 마이너, 이 세 가지를 TypeScript 프로토타입으로 만들어 볼까요? 실제 세션 파일을 몇 개 첨부해 주시면 정규화기는 그 형식에 정확히 맞춰 작성하겠습니다.

Sources:
- [pi Extensions 문서](https://pi.dev/docs/latest/extensions)
- [pi CLI Integration 문서](https://pi.dev/docs/latest/cli-integration)
- [pi hands-on: run modes & session trees](https://www.developersdigest.tech/blog/pi-hands-on-run-modes-session-trees-guide)

--- [19] USER ---
pi 1.0 이상 버전 업데이트 내용을 분석해서 설명해줘

--- [20] ASSISTANT ---
Pi 1.0 발표 글, Pi Durable 글, 그리고 changelog를 확인해서 정리할게요.

--- [21] ASSISTANT ---
Pi 1.0은 10월 1일에 나왔고, 지금(10월 10일) 최신 버전은 10월 7일의 1.1.0입니다. 핵심만 먼저 말하면, **1.0의 큰 기능 대부분은 직전 0.86~0.99에서 이미 들어왔고 1.0은 이를 다듬은 안정화 선언에 가깝습니다.** 그리고 같은 날 별도 실험 패키지로 **Pi Durable**이 나왔는데, 앞서 얘기한 관찰자 에이전트 설계와 직접 관련이 있어서 그 부분을 따로 짚을게요.

## 1. Pi 1.0 발표 내용 (10월 1일)

발표 글에서 강조한 철학은 그대로입니다. 에이전트 도구는 매주 바뀌지만 대부분 오래가지 않으니, 검증된 것만 기능 대비 복잡도를 따져서 들인다는 거예요. 그 기준을 통과해 1.0에 들어간 것은 다음과 같습니다.

- Codemode (MCP 네이티브 지원, Jev 같은 비LLM 모델과 이미지 모델 포함)
- 확장에서 가상 모델(virtual model) 지원
- 지연 툴 로딩(deferred tool loading)
- Anthropic 모델용 캐시 워밍
- 대화 중간 시스템 메시지(트랜스크립트를 인식하는 프롬프트·툴 변경)
- 새 TUI 테마, 전체화면 기본값

1.0.0 릴리스 자체의 변경점은 다음과 같습니다.
- **Codemode 경량화**: 기본 툴과 codemode를 켠 상태에서 GPT-5.6 요청이 약 5,300토큰에서 3,300토큰으로 줄었습니다. 설명문은 한 줄 요약만 남기고 상세 레퍼런스는 모델이 필요할 때 읽도록 바꿨어요. 지난번에 얘기한 점진적 공개를 런타임 자체에 적용한 셈입니다.
- **Codemode 에러 메시지가 복구 방법을 알려줌**: 예를 들어 `tools.Bash`를 호출하면 `tools.bash`를 제안합니다.
- 전체화면 TUI 기본값(`tuiMode: "regular"`로 되돌릴 수 있음), codemode에서 이미지 생성, MCP OAuth 보강.

## 2. 가장 큰 변화: "MCP 반대"에서 MCP 내장으로

예전 pi.dev에는 MCP를 지원하지 않는다고 당당히 적혀 있었고 Mario의 반MCP 글도 있었는데, 지금은 MCP가 정식 기능이 됐습니다. 전환 이유는 이렇습니다.
- MCP 자체가 1년 사이 많이 바뀌었고, MCP를 넣는 데 필요한 변경이 다른 곳에도 두루 유용했습니다. 결국 pi에 필요한 것도 MCP에 필요한 것도 "인터프리터 형태의 샌드박스"였다는 결론이에요.
- 다만 MCP의 근본 문제인 조합 어려움은 여전하다고 봅니다. 많은 MCP 서버가 툴을 컨텍스트에 그냥 쏟아붓는 하네스를 전제로 텍스트를 반환하는데, Earendil은 MCP가 **구조화된 데이터를 반환하고 문서로 검색되는, OpenAPI에 가까운 형태**가 돼야 한다고 봅니다.
- **Codemode**는 bash가 도는 쪽이 아니라 하네스가 도는 쪽에서 실행되며, 툴 호출의 순서를 정하고 JavaScript로 조합하는 샌드박스입니다. 상태도 파일 시스템이 아니라 세션 트랜스크립트에 남습니다.

실제 기능은 0.99.0(9월 29일)에 들어왔습니다. codemode, tool search, MCP가 내장 확장으로 추가됐고, codemode는 모델이 작성한 JavaScript를 QuickJS 샌드박스에서 실행해 pi의 툴을 호출합니다. 같은 릴리스에서 확장 툴 API도 크게 늘었습니다. `exposure`(direct, model-only, codemode, deferred, hidden), `namespace`, `annotations`, `outputSchema`와 `structuredContent`, `ctx.executeTool()` 중첩 호출 등입니다. 0.99.2부터는 기본 codemode 노출의 MCP 서버가 codemode 설명에 나열되지 않고 첫 프롬프트도 막지 않으며, 스크립트가 `searchTools()`로 찾아 쓰는 방식이 됐습니다.

## 3. 1.0 이후 패치 릴리스 (1.0.1 ~ 1.1.0)

| 버전 | 날짜 | 주요 내용 |
|---|---|---|
| 1.0.1 | 10/3 | 프로젝트별 MCP 서버 오버라이드(`.pi/mcp.json`), 아직 등록되지 않은 툴에도 렌더러 지정, Nix flake, npm-shrinkwrap 제거(고정 설치는 공식 설치기 권장) |
| 1.0.2 | 10/4 | thinking 레벨별 샘플링 파라미터 |
| 1.0.3 | 10/5 | **Breaking**: Azure 프로바이더 이름이 `azure-openai-responses` → `azure`로 변경. 잘린 툴 출력 등 출력 파일 권한을 사용자 전용으로 |
| 1.0.4 | 10/5 | `--tools`와 `--exclude-tools`에 `*` 패턴, `--no-mcp` |
| 1.1.0 | 10/7 | 아래 참고 |

1.1.0에서 하네스 설계와 직접 관련된 변경은 세 가지입니다.
- `agent_settled` 이벤트에 `aborted` 필드가 추가돼, 취소된 실행과 정상 완료를 구분할 수 있습니다.
- `tool_execution_end` 이벤트에 `durationMs`가 추가됐습니다.
- OSC 7501을 지원하는 터미널과 에이전트 대시보드에서 pi가 작업 중인지, 대화상자나 로그인에서 막혔는지, 완료됐는지, 실패했는지 볼 수 있게 됐습니다.

## 4. Pi Durable: 별도의 실험 패키지

Pi 코딩 에이전트는 터미널에서 한 사람이 조작하고, 프로세스가 죽으면 사람이 보고 다시 이어가는 도구입니다. 1.0은 그 역할에 집중하고, 이 부분은 바뀌지 않습니다. Durable은 이와 달리 **어디서든 돌고, 여러 화면에서 접근하고, 대화가 무한히 이어지고, 장애에서 살아남고, 여러 사람이 같은 에이전트를 조종하는** 하네스를 목표로 합니다. 코딩 에이전트를 대체하는 게 아니라 코딩 에이전트를 포함한 모든 에이전트 앱을 만드는 프레임워크예요.

핵심 개념은 다음과 같습니다.
- **스토리지 위에 열리는 하네스**: 메모리, SQLite, JSONL 스토리지를 기본 제공하고 커스텀 백엔드용 적합성 테스트(conformance suite)도 함께 있습니다.
- **크래시 복구**: 실행의 모든 단계가 체크포인트를 남기는 task라서, 프로세스가 죽으면 새 프로세스가 미완료 task를 찾아 이어서 실행합니다. 툴은 `replay: "safe"`로 선언된 경우에만 다시 실행되고, 아니면 모델에게 중단됐다고 알립니다.
- **동시 대화와 포크**: 하나의 하네스가 여러 대화를 동시에 돌리고, 각 대화는 모델, 툴, 확장, 작업 디렉터리를 따로 가집니다. 저렴한 모델에 읽기 전용 툴만 가진 리뷰어를 옆에 둘 수 있습니다.
- **백그라운드 task**: 대화에 속하지만 현재 작업과는 분리돼, 사용자가 Esc를 눌러도 멈추지 않습니다.
- **문서(documents)**: todo나 plan 같은 앱 상태를 타입 있는 JSON으로 트랜스크립트 옆에 같은 원자적 커밋으로 저장합니다.
- 전체 소스는 테스트 제외 약 1만 5천 줄로, 에이전트가 직접 읽고 이해할 수 있는 규모로 만들었다고 합니다.
- 실험 단계라 **API는 아직 바뀔 수 있다**고 명시돼 있습니다.

## 5. 하네스 설계에 주는 의미

**① "툴은 적게, 나머지는 검색으로"가 런타임 기본값이 됐습니다.** `exposure: deferred/codemode`와 tool search는 지난번에 얘기한 "핵심 툴만 항상 노출하고 나머지는 필요할 때"를 pi가 정식으로 구현한 것입니다. `ak` CLI는 중립 본체로 그대로 두고, pi 어댑터에서만 주요 명령을 codemode/deferred 툴로 노출하는 식으로 활용하면 됩니다.

**② MCP의 위상이 바뀌었습니다.** 이제 pi, Claude Code, Codex 모두 MCP를 지원하니, CLI 다음으로 이식성 높은 툴 계층으로 MCP를 고려할 만해졌습니다. 다만 Earendil의 지적처럼 텍스트 덤프가 아니라 구조화된 데이터를 반환하도록 설계해야 codemode 같은 조합 계층에서 제값을 합니다. 그래서 `ak`는 **CLI가 원본이고, 같은 명령을 구조화 출력의 MCP 서버로도 노출**하는 이중 구조가 좋아 보입니다.

**③ 관찰자 정규화기는 `context_edit`를 반드시 처리해야 합니다.** 0.87에서 `SessionEntry`에 `ContextEditEntry`가 추가돼, 원본 기록을 바꾸지 않고도 모델 컨텍스트에서 메시지를 빼거나 교체할 수 있게 됐습니다. 즉 **세션 파일의 원본 기록과 모델이 실제로 본 것이 다를 수 있습니다.** 마이닝할 때 어느 쪽을 기준으로 할지 정해야 해요. 0.84부터는 JSON/RPC의 `message_update`가 델타만 내보내니, C를 JSON 모드로 돌릴 때도 이 점을 반영해야 합니다.

**④ 1.1.0의 작은 변경들이 관찰자 데이터를 풍부하게 해줍니다.** `agent_settled.aborted`로 "중단된 세션"을 따로 분류할 수 있고, `durationMs`로 오래 걸리는 툴 호출을 마이닝할 수 있으며, OSC 7501 상태는 여러 세션을 한눈에 보는 대시보드의 신호로 쓸 수 있습니다.

**⑤ Pi Durable은 관찰자 C의 기반 후보지만 아직은 이릅니다.** 크래시 복구, 동시 대화, 백그라운드 task, 문서 상태, 여러 클라이언트 접속은 상주형 관찰자/오케스트레이터에 필요한 기능 그대로입니다. pi-ai 덕분에 모델 측면에서도 중립적이고요. 다만 실험 단계라 API가 바뀔 수 있으니, **지금은 pi JSONL을 읽는 단순한 데몬으로 시작하고, 정규화기와 마이너를 Durable과 무관한 순수 모듈로 분리해 두었다가 Durable이 안정되면 실행 기반만 옮기는** 순서를 권합니다.

**⑥ 업데이트 정책**: 1.0.1부터 npm 전역 설치 대신 의존성을 고정하는 공식 설치기를 권장합니다. 확장을 만드는 입장이면 1.0.3의 Azure 이름 변경 같은 breaking change가 패치 버전에서도 나온다는 점을 감안해, pi 버전을 고정하고 업데이트 전에 changelog의 Breaking 항목을 확인하는 습관이 필요합니다.

Sources:
- [Pi 1.0 — Earendil](https://earendil.com/posts/pi-1-0/)
- [Pi Durable — Earendil](https://earendil.com/posts/pi-durable/)
- ["You Said No MCP!" — Earendil](https://earendil.com/posts/you-said-no-mcp/)
- [Pi Changelog](https://pi.dev/changelog)

--- [22] USER ---
수많은 하네스 에이전트들이 서브 에이전트 개념들을 구현하자, 가장 최근 트렌딩으로 주목받고 있는 방식은 어떤것들인지 조사 하고 설명가능해?

--- [23] ASSISTANT ---
최근 서브에이전트 구현 트렌드를 조사해서 정리할게요.

--- [24] ASSISTANT ---
네, 정리해 보면 2026년 하반기 서브에이전트 구현은 "서브에이전트를 쓰느냐"가 아니라 **"누가, 어떤 방식으로 서브에이전트를 지휘하느냐"**로 논점이 옮겨 갔습니다. 지금 주목받는 흐름을 여섯 갈래로 나눠 설명할게요.

## 1. 기본 분류: 메인 에이전트의 통제 수준에 따른 네 단계

Google의 Philipp Schmid가 5월에 정리한 분류가 현재 가장 많이 인용되는 틀입니다. 메인 에이전트가 서브에이전트 생명주기를 얼마나 통제하는지에 따라 네 단계로 나눕니다.

| 패턴 | 툴 | 메인 에이전트 역할 | 수명 |
|---|---|---|---|
| ① Inline Tool | `call_agent` | 호출자 | 단일 작업 |
| ② Fan-Out | `spawn_agent`, `wait_agent` | 배분자 | 단일 작업 |
| ③ Agent Pool | spawn, send, wait, list, kill | 조정자 | 여러 턴 |
| ④ Teams | 위 전부 + 에이전트 간 `send_message` | 감독자 | 지속 |

이 글의 핵심 주장은 **단계가 올라갈수록 더 강한 모델이 필요하다**는 것입니다. ①은 툴 호출만 되면 어떤 모델이든 되지만, ②는 언제 기다릴지 판단할 수 있어야 하고, ③은 여러 에이전트의 상태를 턴 사이에 추적해야 하며, ④는 모든 에이전트가 프론티어급이어야 합니다. 그래서 권장은 ①로 시작하라는 것이고, 대부분은 ①에서 끝난다고 봅니다.

## 2. 컨텍스트 상속: Fresh냐 Fork냐

두 번째 축은 서브에이전트가 무엇을 들고 시작하느냐입니다. Claude Code에서는 이름 있는 서브에이전트는 빈 컨텍스트로 시작하고, fork된 서브에이전트는 현재 대화를 물려받습니다. fork는 메인 대화의 기록, 시스템 프롬프트, 모델, 툴을 그대로 상속하기 때문에, 같은 배경지식이 필요한 곁가지 작업에 적합합니다.

Codex는 기본이 fork 방식이라 자식이 부모의 컨텍스트, 샌드박스 정책, 런타임 설정을 물려받습니다. 그래서 자식이 늘수록 컨텍스트 압박이 커진다는 지적이 나오고, 커뮤니티에서는 `codex exec`로 완전히 분리된 프로세스를 띄우고 결과만 부모에게 넣는 **detached 패턴**이 대안으로 쓰입니다. 전문 에이전트를 다섯 개 이상 돌리는 워크플로우라면 이 방식을 검토해 보라는 권고도 있어요. 지난번 얘기한 "런타임 바깥에서 헤드리스로 띄우는 드라이버"와 같은 방향입니다.

## 3. 백그라운드(비동기)가 기본값으로

올해 가장 뚜렷한 변화 중 하나는 서브에이전트가 **기다리지 않는 것**이 기본이 되어 간다는 점입니다. 비동기 방식에서는 툴이 에이전트 ID만 즉시 반환하고, 결과는 끝났을 때 알림 메시지로 대화에 주입됩니다. 메인은 그동안 다른 일을 계속합니다.

최근 오픈소스 하네스들의 9월 PR들이 이 방향을 보여줍니다.
- 한 하네스는 비동기 에이전트가 리더에게 결과를 보고하고, 리더의 현재 턴이 취소돼도 살아남도록 바꿨습니다. Esc를 눌러도 백그라운드 작업이 죽지 않게 세션 단위 토큰을 도입했어요.
- redcode는 실험 플래그 뒤에 있던 백그라운드 서브에이전트를 기본값으로 켰고, 세션당 개수 제한을 추가했습니다.

Pi Durable도 같은 개념을 가지고 있습니다. 백그라운드 task는 대화에 속하지만 현재 작업과는 분리돼서, 대화가 idle 상태로 돌아가도 계속 실행되고 일반적인 중단에도 멈추지 않습니다.

## 4. Agent Teams: 피어 투 피어 협업

Claude Code가 2월에 실험 기능으로 내놓은 Agent Teams가 ④ 패턴의 대표 사례입니다. 팀원들은 각자 컨텍스트 창을 가진 독립 Claude Code 세션이고, **공유 작업 목록과 mailbox**로 조율합니다. 서로 컨텍스트를 공유하지 않고, 소통은 작업 목록과 mailbox를 통해서만 명시적으로 이뤄집니다. 작업은 팀원이 스스로 가져가는데, 파일 잠금으로 두 팀원이 같은 작업을 동시에 잡지 못하게 막습니다.

실무에서 정리된 경험칙은 이렇습니다.
- 생산적인 팀 규모는 3~5명이고, 그 이상이면 조정 비용이 커집니다.
- 팀원 각각이 완전한 세션이라 5명이면 토큰도 대략 5배입니다. 리뷰, 가설 검증, 탐색에는 가치가 있지만 일상적인 구현에는 낭비입니다.
- 팀원은 하위 팀을 만들 수 없습니다(중첩 금지).

## 5. 가장 뜨거운 흐름: 코드로 지휘하는 서브에이전트 (RLM / codemode)

지금 가장 주목받는 건 **모델이 툴 호출로 서브에이전트를 하나씩 부르는 대신, 코드를 써서 서브에이전트를 일괄 지휘하는** 방식입니다.

- **RLM(Recursive Language Models)**: MIT의 Alex Zhang이 2025년 10월 블로그로 처음 소개했고 이후 정식 논문이 나왔습니다. Prime Intellect는 이를 "2026년의 패러다임"으로 꼽았어요. 핵심은 큰 입력을 컨텍스트에 직접 넣지 않고, 모델이 지속되는 Python REPL에서 그 데이터를 살펴보고 변환하면서 REPL 안에서 하위 LLM을 호출하게 하는 것입니다.
- **LangChain Deep Agents**: 7월에 RLM 지원을 "dynamic subagents"로 넣었습니다. 모델이 REPL에서 코드를 실행해 서브에이전트를 배분하고 입력 조각마다 재귀적으로 처리합니다. 스스로는 각자 툴과 컨텍스트를 가진 서브에이전트를 코드에서 배분하는 "재귀 에이전트(recursive agents)"에 더 가깝다고 설명해요.
- **Prime Agent**(8월 논문): 지속되는 IPython REPL로 RLM 추상화를 따르고, 재귀 서브에이전트들이 에이전트 간 직접 통신으로 협업합니다. ARC-AGI-3 Best@1이 30%에서 95.5%로 올랐다고 보고합니다.
- **pi의 codemode**도 같은 계열입니다. 앞서 본 Linear 이슈 분석 예시처럼, 모델이 JavaScript로 워커 4개를 병렬로 돌리며 MCP 툴과 분류 모델을 조합하고, 결과는 컨텍스트가 아니라 codemode 저장소에 남깁니다.

이 흐름이 중요한 이유는 지난번 대화 주제와 직결되기 때문입니다. 툴 호출 방식에서는 "몇 개를 띄울지, 언제 기다릴지"를 모델이 매 턴 확률적으로 판단합니다. 코드 방식에서는 **모델이 한 번 지휘 프로그램을 쓰고, 그 실행은 결정적으로** 이뤄집니다. 비결정성이 "프로그램을 쓰는 순간" 한 곳으로 모이고, 중간 결과는 변수에 담겨 메인 컨텍스트를 오염시키지 않습니다.

## 6. 지속성과 목표: Durable 서브에이전트와 goal 루프

- **서브에이전트 = 소유된 대화**(Pi Durable): Pi Durable에는 내장 서브에이전트가 없지만 몇 줄이면 만들 수 있습니다. 서브에이전트가 별도의 대화로 존재하기 때문에 크래시 이후에도 이어서 실행되고, 재실행이 안전한 서브에이전트 툴은 기존 서브에이전트를 다시 찾아 답을 기다립니다. task와 대화가 하나의 소유 트리를 이뤄서, 상위 작업을 중단하면 하위부터 차례로 정리됩니다.
- **목표 상속과 judge**(redcode): 부모에게 활성 목표가 있으면 서브에이전트의 첫 프롬프트에 목표와 완료 조건을 담은 `<goal>` 블록을 넣어 줍니다. 백그라운드 자식이 도는 동안 부모 루프는 턴을 쓰지 않고 대기하다가, 자식의 보고가 들어오면 judge가 다시 평가해 목표 완료 여부를 결정합니다.
- 이는 Huntley의 Ralph에서 시작된 "loop engineering"의 연장선입니다. Claude Code에는 `/loop`, `/schedule`이 있고 Anthropic은 `/goal`을 목표 기반 실행 패턴으로 설명합니다.

## 하네스 설계에 대한 시사점

트렌드를 보면, 처음에 지적하신 "서브에이전트 스폰조차 모델의 비결정성에 의존한다"는 문제에 업계가 두 방향으로 답하고 있습니다.
1. **코드로 지휘하기**(RLM, codemode, dynamic subagents): 비결정성을 프로그램 작성 시점 한 곳으로 모읍니다.
2. **바깥에서 지휘하기**(detached 프로세스, durable task, goal 루프, 스케줄): 트리거를 아예 코드로 옮깁니다.

반대로 Agent Teams는 비결정성을 늘리는 방향이라, 프론티어 모델과 토큰 비용을 감당할 수 있는 탐색형 작업에만 쓰이는 추세입니다.

벤더 중립 하네스로 옮기면 이렇게 정리할 수 있어요. 서브에이전트를 런타임별 기능으로 정의하지 말고 **`spawn(task, role, context: fresh|fork, mode: sync|background) → 결과 파일`** 같은 중립 계약으로 정의합니다. 구현은 각 런타임의 헤드리스 CLI(`pi --print`, `claude -p`, `codex exec`)로 하는 detached 방식을 기본으로 둡니다. 그러면 메인 에이전트의 툴 호출에서든, codemode 스크립트에서든, 외부 관찰자 데몬에서든 같은 계약으로 서브에이전트를 부를 수 있고, 런타임 고유의 Agent Teams 같은 기능은 어댑터 안의 선택 사항으로 남겨 둘 수 있습니다.

Sources:
- [Philipp Schmid — Four Subagents Patterns in 2026](https://www.philschmid.de/subagent-patterns-2026)
- [Claude Code subagents and custom agents in 2026 (promptessor)](https://promptessor.com/blog/best-claude-code-subagents-and-custom-agent-examples-for-specialized-coding-workflows-in-2026)
- [Detached Subagent Patterns for Codex CLI](https://codex.danielvaughan.com/2026/05/20/detached-subagent-patterns-codex-cli-context-free-orchestration-community-tools/)
- [davinci PR #66 — agent orchestration](https://github.com/J12003LPZ/davinci/pull/66)
- [redcode PR #144 — subagents inherit the goal](https://github.com/reddb-io/redcode/pull/144)
- [redcode PR #145 — background subagents on by default](https://github.com/reddb-io/redcode/pull/145)
- [Pi Durable — Earendil](https://earendil.com/posts/pi-durable/)
- [Claude Code Agent Teams (Kimi resources)](https://www.kimi.ai/resources/agent-teams-in-claude-code)
- [Claude Code Agent Teams (fast.io)](https://fast.io/resources/claude-code-teams-guide/)
- [agent-teams skill (jonmumm)](https://www.skills.sh/jonmumm/skills/agent-teams)
- [agent-teams skill (rohitg00)](https://skills.sh/rohitg00/pro-workflow/agent-teams)
- [Prime Intellect — Recursive Language Models](https://www.primeintellect.ai/blog/rlm)
- [LangChain — RLMs in Deep Agents](https://langchain.com/blog/how-to-use-rlms-in-deep-agents)
- [Prime Agent: A Self-Improving RLM Harness](https://tldr.takara.ai/p/2608.23552)
- [Loop Engineering for AI Agents (Analytics Vidhya)](https://www.analyticsvidhya.com/blog/2026/07/loop-engineering-for-ai-agents/)

--- [25] USER ---
RLM 에 대해 더 자세히 설명해줄래? /frontend-deep-dive-tutor

--- [26] ASSISTANT ---
[Write /home/claude/rlm-lab/toy-rlm.mjs]

--- [27] ASSISTANT ---
# RLM(Recursive Language Models) 딥다이브

**이 장에서 답할 질문**
1. RLM은 무엇을 바꾸는 것이고, 왜 "모델 호출 하나를 대체한다"고 말할까요?
2. 긴 컨텍스트를 그냥 넣으면 무엇이 문제일까요?
3. 프롬프트를 "변수로 둔다"는 것은 구체적으로 어떤 동작일까요?
4. 이것이 서브에이전트, codemode, 그리고 우리가 설계한 관찰자 에이전트와 어떻게 연결될까요?

**CS 렌즈: 메모리 계층과 참조 전달.** 컨텍스트 창을 "작은 작업 메모리"로, 긴 입력을 "큰 저장소"로 보고, 데이터를 복사해 넣는 대신 참조로 다루는 관점입니다.

---

## 1.1 큰 그림: RLM은 "모델 호출 하나"를 갈아 끼우는 것

**이미 아는 것.** React에서 수만 행짜리 리스트를 그릴 때, 모든 행을 DOM에 넣지 않고 화면에 보이는 행만 그리는 가상화(virtualized list)를 씁니다. 데이터는 JS 메모리에 전부 있지만, 비싼 자원인 DOM에는 필요한 창(window)만 올라갑니다.

**큰 그림.** RLM은 같은 발상을 LLM의 컨텍스트에 적용합니다. 사용자 입장에서 RLM은 여전히 모델 호출 하나입니다. `rlm.completion(messages)`가 `gpt5.completion(messages)`를 그대로 대체하는 형태예요. 바뀌는 것은 내부입니다. 긴 입력을 모델에게 통째로 주지 않고, 모델이 코드로 필요한 부분만 꺼내 보고 나머지는 하위 모델에게 나눠 맡깁니다.

**기초 짚기.** 여기서 쓰는 용어를 먼저 정리합니다.
- **토큰**: 모델이 텍스트를 처리하는 단위입니다. 영어는 대략 4글자가 1토큰입니다.
- **컨텍스트 창**: 모델이 한 번의 호출에서 볼 수 있는 토큰의 최대 양입니다. 시스템 프롬프트, 대화 기록, 입력 데이터가 모두 이 안에 들어가야 합니다.
- **REPL**: 코드를 한 줄씩 입력하면 바로 실행하고 결과를 보여주는 대화형 실행 환경입니다. Node의 `node` 프롬프트나 Jupyter 노트북이 예입니다.

**정리하면, RLM은 새로운 모델이 아니라 기존 모델 위에 얇게 씌우는 추론 방식입니다.** 논문 제목의 "Language Model"이라는 말 때문에 새 모델로 오해하기 쉬운데, 핵심은 호출 방식의 변경입니다.

다음 절의 질문은 이것입니다. 컨텍스트 창 안에 다 들어가는데도, 왜 굳이 이렇게 나눠야 할까요?

## 1.2 문제: 컨텍스트가 길수록 모델은 무뎌진다

**장면.** Claude Code나 Codex로 긴 세션을 하다 보면, 초반에 정한 규칙을 후반에 잊거나 엉뚱한 파일을 다시 읽는 경험을 하셨을 겁니다. 컨텍스트 창이 넘친 것도 아닌데 말이죠.

**문제.** 이 현상을 **context rot**이라고 부릅니다. Anthropic은 이를 컨텍스트 창의 토큰 수가 늘어날수록 그 안의 정보를 정확히 떠올리는 능력이 떨어지는 현상으로 정의합니다. 그런데 RLM 저자는 이 정의가 완전히 맞지는 않다고 지적합니다. 긴 텍스트에서 특정 문장 하나를 찾는 needle-in-a-haystack 벤치마크에서는 최신 모델들이 90% 이상을 기록하기 때문입니다. 실제로 성능이 무너지는 것은 "하나를 찾는" 작업이 아니라, 긴 입력 전체에 걸쳐 수천 개의 항목을 의미적으로 연결해야 하는 작업입니다.

**기존 해법 두 가지와 한계.**
- **더 긴 컨텍스트 창**: 담을 수는 있어도 무뎌지는 문제는 그대로입니다.
- **요약(compaction)과 검색(RAG)**: 요약은 정보를 버리는 손실 압축이고, 검색은 "무엇이 관련 있는지"를 미리 알아야 합니다. 질문 자체가 전체를 훑어야 답할 수 있는 형태면 둘 다 약합니다.

**저자의 출발점은 단순합니다. 컨텍스트를 두 번의 모델 호출로 나누고, 세 번째 호출에서 합치면 이 열화를 피할 수 있지 않을까 하는 직관입니다.** 이 "나누고 합친다"를 모델이 직접, 코드로 하게 만든 것이 RLM입니다.

다음 절의 질문은 이것입니다. "모델이 코드로 나눈다"는 것은 정확히 어떤 흐름일까요?

## 1.3 메커니즘: 프롬프트를 REPL의 변수로 둔다

**기초 짚기: 값 전달과 참조 전달.** 함수에 큰 객체를 넘길 때, 내용을 직렬화해서 복사하면 비용이 데이터 크기에 비례합니다. 참조만 넘기면 받는 쪽이 필요한 필드만 읽습니다. 일반적인 LLM 호출은 전자입니다. 긴 문서를 프롬프트 문자열에 그대로 붙여 넣으니까요. RLM은 후자입니다.

**메커니즘.** 공식 구현의 흐름은 다음과 같습니다.

1. **루트 LM(depth=0)은 질문만 받습니다.** 긴 입력은 Python REPL 노트북에 변수로 미리 로드돼 있고, 루트 LM은 그 변수가 존재한다는 사실과 크기만 압니다.
2. **루트 LM은 코드 블록을 출력합니다.** REPL이 이를 실행하고, 출력 결과가 루트 LM의 컨텍스트로 돌아옵니다. 이때 출력은 잘린(truncated) 형태로만 돌아옵니다. 루트 컨텍스트가 터지지 않게 하는 안전장치입니다.
3. **코드 안에서 하위 LM(depth=1)을 함수처럼 호출할 수 있습니다.** 루트 LM은 이를 이용해 컨텍스트를 엿보고, 나누고, 검색하고, 조각마다 하위 질의를 던집니다.
4. **끝낼 때는 두 가지 방법이 있습니다.** 답을 `FINAL(answer)`로 직접 출력하거나, REPL 안에서 변수로 답을 만들어 `FINAL_VAR(변수명)`으로 반환합니다.

루트 LM이 실제로 쓰는 코드는 대략 이런 모양입니다.

```python
# 1) 엿보기: 데이터의 구조만 확인한다 (출력은 잘려서 돌아옴)
print(len(context))
print(context[:2000])

# 2) 좁히기: 코드로 후보를 거른다 (LLM 호출 없음, 결정적)
rows = [l for l in context.split("\n") if "User: 67144" in l]

# 3) 나누고 맡기기: 조각마다 하위 LM에게 의미 판단을 위임
labels = [llm_query(f"각 질문에 라벨을 붙여라:\n{chunk}")  # 하위 LM 호출
          for chunk in chunks(rows, 50)]

# 4) 합치기는 코드로, 답은 변수로 반환
answer = sum(count_entity(l) for l in labels)
# FINAL_VAR(answer)
```

**핵심은 루트 LM의 컨텍스트에 들어가는 것이 "데이터"가 아니라 "데이터를 다룬 결과의 요약"뿐이라는 점입니다.** 저자도 루트 LM이 전체 컨텍스트를 직접 보지 않기 때문에 입력 컨텍스트가 천천히 늘어나 막히는 일이 드물다는 것을 첫 번째 이점으로 꼽습니다.

다음 절에서는 이 흐름을 직접 돌려서, 루트 컨텍스트에 실제로 얼마가 들어가는지 숫자로 확인합니다.

## 1.4 실험: 루트 컨텍스트에는 무엇이 들어가나

**실험 설계.** 워크스페이스에 OOLONG 벤치마크와 비슷한 데이터를 만들었습니다. `Date || User || Instance` 형식의 6,000행이고, 질문은 "특정 사용자 5명의 항목 중 '수량형' 질문이 몇 개인가"입니다. 실제 LLM은 호출하지 않았습니다. 하위 LM 자리에는 결정적 규칙으로 라벨을 붙이는 가짜 함수를 넣고, **루트 컨텍스트에 실제로 들어간 텍스트만** 누적해 셌습니다.

```js
// toy-rlm.mjs 핵심부 (전체는 ~/rlm-lab/toy-rlm.mjs)
const context = lines.join("\n");              // REPL 변수: 루트는 직접 안 봄
show(`CONTEXT: variable 'context', ${context.length} chars`); // 루트가 아는 건 크기뿐
show(context.slice(0, 200));                   // (a) 엿보기
const filtered = lines.filter(byTargetUser);   // (b) 코드로 좁히기, LLM 호출 없음
for (const chunk of chunks(filtered, 20))      // (c) 조각마다 하위 LM 호출
  total += llmQuery(`Label each instance...\n${chunk}`);
show(`FINAL(${total})`);                       // (d) 답 반환
```

**결과.**

```
정답(검증용)            : 26 / RLM 답: 26
전체 데이터 크기        : 98986 tokens
단일 호출 방식 입력     : 99004 tokens (모두 한 컨텍스트에)
RLM 루트 컨텍스트 누적  : 96 tokens
하위 LM 호출 수/입력합  : 4 회 / 1225 tokens
하위 호출 1회 평균 입력 : 306 tokens
```

**해석.** 약 99k 토큰 데이터에서 루트가 본 것은 96토큰이고, 어떤 하위 호출도 300토큰 남짓만 받았습니다. **어떤 단일 모델 호출도 큰 컨텍스트를 다룰 필요가 없다는 것, 이것이 RLM이 context rot을 "해결"하지 않고 "우회"하는 방식입니다.** 저자도 RLM이 긴 컨텍스트를 처리하는 모델 학습을 직접 요구하지 않는 이유가 여기에 있다고 설명합니다.

**주의할 점.** 이 실험은 흐름을 보여줄 뿐 성능을 증명하지 않습니다. (b) 단계를 코드로 완벽하게 거를 수 있게 데이터를 설계했기 때문입니다. 실제 OOLONG에서는 라벨이 명시돼 있지 않아 모델이 의미를 추론해야 하고, 그래서 하위 LM 호출이 필수입니다. 또 실제 루트 LM은 코드를 쓰기 위해 자기 출력 토큰과 추론 토큰도 씁니다. 이 실험의 96토큰에는 그 비용이 빠져 있습니다.

다음 절의 질문은 이것입니다. 이름이 "재귀"인데, 무엇이 무엇을 재귀 호출하는 걸까요? 그리고 이게 서브에이전트와 무엇이 다를까요?

## 1.5 "재귀"의 의미와 서브에이전트와의 차이

**기초 짚기: 재귀 깊이.** 재귀 함수가 자기 자신을 호출할 때 호출 스택이 한 단계씩 쌓이는 것처럼, RLM에서도 루트 LM을 깊이 0, 그것이 부르는 하위 호출을 깊이 1로 셉니다.

**실제 실험의 깊이는 1이었습니다.** 형식 정의에서는 하위 호출도 자기만의 REPL 환경을 가진 RLM 인스턴스가 될 수 있습니다. 하지만 실험에서는 루트가 일반 LM만 부르고 RLM은 부르지 않는 깊이 1만 다뤘습니다. 대부분의 장문 벤치마크에는 이걸로 충분했다고 해요. 그러니 지금까지의 "재귀"는 이름이 약속하는 미래에 가깝고, 실증된 형태는 "코드에서 하위 LM을 부르는 한 단계 위임"입니다.

**관찰된 전략들.** 루트 LM은 질문과 "변수가 존재한다"는 사실만 알고 시작하는데, 스스로 다음 전략들을 만들어 냈습니다.
- **엿보기**: 처음에는 컨텍스트의 크기만 아니까, 프로그래머가 데이터셋 앞 몇 줄을 보듯 앞부분 2,000자를 꺼내 구조를 확인합니다.
- **grep**: 의미 기반 검색 도구 대신 키워드나 정규식으로 관심 있는 줄을 좁힙니다.
- **분할 후 매핑**: grep으로 잡히지 않는 의미적 판단이 필요하면, 컨텍스트를 잘게 나눠 하위 LM들에게 라벨링을 맡기고 그 라벨로 원래 질문에 답합니다.
- **긴 출력을 코드로**: 긴 git diff 기록을 끝까지 따라가 최종 파일을 출력하는 LoCoDiff 과제에서, RLM이 diff 시퀀스를 프로그램으로 처리해 한 번에 풀어 버린 사례도 있었습니다.

**서브에이전트와의 차이: 무엇을 기준으로 나누는가.** 저자는 RLM이 에이전트도 아니고 단순 요약도 아니라고 말합니다. 기존 에이전트 스캐폴드는 여러 LM 호출을 **과제나 문제의 관점**에서 분해하는데, RLM은 **컨텍스트의 관점**에서 분해하고, 그 분해 방식의 선택을 전적으로 모델에게 맡깁니다.

| 관점 | 일반 서브에이전트 | RLM |
|---|---|---|
| 무엇을 나누나 | 과제 ("백엔드 담당", "테스트 담당") | 데이터 ("1~50행", "user 67144의 행") |
| 누가 분해 방식을 정하나 | 사람이 정의한 역할·워크플로우가 많음 | 모델이 런타임에 코드로 결정 |
| 중간 결과가 사는 곳 | 메인 컨텍스트(툴 결과)로 돌아옴 | REPL 변수에 남고, 요약만 루트로 |
| 호출 방식 | 툴 호출 하나에 서브에이전트 하나 | 코드 루프 하나로 N개 일괄 호출 |

**저자의 한 줄 정리는 이렇습니다. 에이전트는 사람의 직관으로 문제를 LM이 소화할 만한 크기로 쪼개도록 설계되고, RLM은 그 쪼개는 방식 자체를 LM이 정해야 한다는 원칙으로 설계됩니다.**

지난 대화에서 본 codemode나 Deep Agents의 dynamic subagents가 이 계열인 이유가 여기 있습니다. 지휘를 툴 호출의 연쇄가 아니라 코드로 한다는 점이 같습니다.

다음 절의 질문은 이것입니다. 이 설계는 실제로 얼마나 효과가 있었고, 왜 하필 REPL이었을까요?

## 1.6 왜 이렇게 설계했나: 근거와 결과

**문서화된 근거 (블로그·논문).**
- **두 가지 설계 선택**: 저자는 핵심을 둘로 꼽습니다. 첫째, 프롬프트를 Python 변수로 다뤄 임의의 REPL 흐름으로 처리하게 한 것입니다. 무엇을 엿볼지, 어떻게 쪼갤지를 모델이 실행 시점에 정합니다. 둘째, 그 REPL 환경이 다시 LLM을 호출할 수 있게 한 것입니다.
- **CodeAct와의 차이**: 코드로 행동하는 에이전트(CodeAct)에 재귀 호출을 더한 것처럼 보이지만, 저자는 관점이 다르다고 말합니다. RLM에서 컨텍스트는 모델이 이해해야 할 대상이고, 코드 실행과 재귀 호출은 그 이해를 효율적으로 하기 위한 수단이라는 것입니다.
- **추론 시점 연산 확장의 새로운 축**: 모델이 컨텍스트를 다루는 궤적 자체를 학습할 수 있고, 현재 추론 모델을 강화학습으로 훈련하듯 이것도 훈련할 수 있다고 봅니다.

**실험 결과 (블로그, 초기 결과).**
- OOLONG의 132k 토큰 질문에서 RLM(GPT-5-mini)이 GPT-5보다 34점 이상(약 114%) 높았고, 질의당 비용은 거의 같았습니다. 263k 토큰에서도 15점 이상(약 49%) 앞섰고 평균 비용은 더 쌌습니다.
- 재귀 호출을 빼면 성능이 약 10% 떨어졌습니다. 질문에 라벨을 붙이는 것 같은 의미 판단이 필요한 문항이 많아서로 추정합니다.
- BrowseComp-Plus의 문서 1,000개 규모에서 완벽한 성능을 유지한 것은 RLM(GPT-5)뿐이었고, 재귀를 뺀 버전은 90%였습니다.

**정식 논문 (2025년 12월 공개, 2026년 5월 v3, NeurIPS 2026 채택).** 모델 컨텍스트 창보다 두 자릿수 큰 입력까지 처리했고, 짧은 입력에서도 GPT-5 기준으로 벤치마크 중앙값 기준 compaction보다 26%, 하위 호출을 가진 CodeAct보다 130%, Claude Code보다 13% 높은 품질을 비슷한 비용으로 냈습니다. 또 RLM 방식으로 사후 학습한 RLM-Qwen3-8B는 기반 모델보다 평균 28.3% 높았고, 세 개의 장문 과제에서 GPT-5 단독 성능에 근접했습니다.

**인정된 한계 (문서화).** 구현이 속도에 최적화되지 않아 각 하위 호출이 블로킹이고 프리픽스 캐시도 쓰지 않습니다. 분할 전략에 따라 질의 하나가 몇 초에서 몇 분까지 걸리고, 전체 API 비용이나 실행 시간을 통제할 강한 보장도 아직 없습니다.

**제 추론 (문서에 없는 해석).**
- **REPL을 고른 이유**는 "정확히 같은 작업을 반복"하는 부분을 코드로 돌리기 위해서라고 봅니다. 지난번에 얘기한 "결정적인 작업은 모델 밖으로"를 모델이 스스로 하게 만든 구조입니다. grep과 집계는 코드가 하고, 의미 판단만 하위 LM이 합니다.
- **비결정성의 위치가 바뀝니다.** 일반 서브에이전트는 매 턴 "부를까 말까"를 확률적으로 판단하지만, RLM에서는 루트가 코드를 쓰는 순간에 비결정성이 모이고, 일단 쓴 루프는 결정적으로 실행됩니다.

다음 절에서는 이 방식의 비용을 정리하고, 지금까지 설계한 하네스에 어떻게 연결되는지 봅니다.

## 1.7 얻는 것과 치르는 것, 그리고 하네스 적용

**얻는 것.**
- 루트 컨텍스트가 거의 늘지 않아 context rot을 우회합니다.
- 컨텍스트 창보다 훨씬 큰 입력을 다룰 수 있습니다.
- 모든 단계가 코드와 그 출력으로 남아, 모델이 무엇을 했는지 추적하기 쉽습니다.
- 기반 모델이 좋아지면 RLM도 함께 좋아집니다.

**치르는 것.**
- **지연 시간**: 하위 호출이 순차·블로킹이면 느립니다. 병렬화와 캐시가 필요합니다.
- **비용 분산**: 중앙값은 싸도, 루트가 지나치게 잘게 쪼개면 비싼 이상치 질의가 생깁니다. 반복 횟수와 하위 호출 수에 상한을 둬야 합니다.
- **보안 경계**: 모델이 쓴 코드를 실행하므로 샌드박스가 필수입니다. pi의 codemode가 QuickJS 샌드박스에서 돌고, 하네스 쪽 신뢰 영역에서 실행된다는 점을 강조한 이유가 이것입니다.
- **모델 역량 의존**: 루트 LM이 좋은 분할 전략을 짜야 합니다. 약한 모델은 데이터를 통째로 출력해 버리는 실수를 할 수 있습니다.

**하네스 적용: 관찰자 C는 RLM의 교과서적 사용처입니다.** 지난번 설계에서 관찰자 C는 여러 세션의 JSONL 로그, 즉 수십만~수백만 토큰을 다뤄야 했습니다. 이를 RLM 방식으로 바꾸면 이렇게 됩니다.

```js
// 관찰자 C를 RLM으로: 세션 로그는 변수, C의 컨텍스트에는 요약만
const sessions = loadNormalizedTraces();      // 정규화된 전체 트레이스 (참조)
const candidates = mineRepeatedSequences(sessions); // 결정적 마이닝 (코드)
const verdicts = await Promise.all(           // 후보 클러스터마다 하위 LM 판단 (병렬)
  candidates.map(c => llmQuery(`이 반복 패턴은 스킬/CLI/훅/우연 중 무엇인가?\n${c.sample}`))
);
// C의 루트 컨텍스트에는 verdicts 요약표만 들어간다
```

pi 1.0에서는 이 구조를 codemode로 거의 그대로 돌릴 수 있습니다. codemode 스크립트에서 툴을 병렬로 부르고, `models.classify()` 같은 모델 호출을 섞고, 결과를 `store()`로 컨텍스트 밖에 보관하는 방식이 RLM의 REPL과 같은 역할이기 때문입니다.

**실무 규칙.**
- 루트 컨텍스트에는 **데이터가 아니라 데이터에 대한 결과**만 들어가게 합니다.
- 코드로 거를 수 있는 것은 반드시 코드로 먼저 거르고, 의미 판단만 하위 LM에 맡깁니다.
- 하위 호출에는 병렬 처리, 개수 상한, 반복 상한을 둡니다.
- 출력은 잘라서 돌려주고, 전체 결과는 변수나 파일에 둡니다.
- 모델이 쓴 코드는 샌드박스에서만 실행합니다.

---

## 요약: 렌즈 매핑

| 개념 | 메모리 계층·참조 전달 렌즈에서의 의미 |
|---|---|
| 컨텍스트 창 | 작고 비싼 작업 메모리 (DOM에 해당) |
| REPL 변수 `context` | 큰 저장소에 있는 원본 데이터 (JS 메모리의 전체 배열) |
| 엿보기·grep | 필요한 창만 작업 메모리로 올리기 (가상화 리스트의 보이는 행) |
| 하위 LM 호출 | 조각 단위로 처리하는 별도 작업 메모리 |
| 잘린 출력 | 작업 메모리 오버플로를 막는 상한 |
| `FINAL_VAR` | 결과를 복사하지 않고 참조로 반환 |
| context rot 우회 | 어떤 단일 호출도 큰 작업 집합을 갖지 않게 하기 |

**다음 장 예고.** 이번 장의 RLM은 "모델이 코드로 하위 모델을 지휘한다"는 한 가지 아이디어였습니다. 다음으로 볼 만한 주제는 같은 아이디어를 제품에 넣은 pi의 codemode 내부입니다. QuickJS 샌드박스가 툴 호출을 어떻게 조합하고, 상태가 왜 파일이 아니라 트랜스크립트에 남으며, `exposure: codemode`가 컨텍스트 비용을 어떻게 바꾸는지를 실험과 함께 따라가 볼 수 있습니다.

이번 장의 설명 수준이 적절했는지 한 줄로 알려 주세요. 더 낮춰야 할 부분이 있으면 그 부분을 기초부터 다시 풀겠습니다.

Sources:
- [Alex L. Zhang — Recursive Language Models (blog)](https://alexzhang13.github.io/blog/2025/rlm/)
- [Recursive Language Models — arXiv 2512.24601](https://arxiv.org/abs/2512.24601)
- ["You Said No MCP!" — Earendil (codemode)](https://earendil.com/posts/you-said-no-mcp/)

--- [28] USER ---
다음장도 진행해줘 그리고 실제 RLM개념을 개인 에이전트 런타임에 적용하여 성과를 보인 사례가 있는지도 조사해줘

--- [29] ASSISTANT ---
다음 장(pi codemode 내부)에 필요한 문서 확인과 RLM 적용 사례 조사를 함께 진행할게요.

--- [30] ASSISTANT ---
다음 장 실험을 위해 QuickJS로 작은 codemode를 재현하고, 실제 pi 패키지 안의 codemode 프롬프트도 확인해 볼게요.

--- [31] ASSISTANT ---
[Write /home/claude/rlm-lab/codemode-lab.mjs]

--- [32] ASSISTANT ---
[Write /home/claude/rlm-lab/codemode-lab2.mjs]

--- [33] ASSISTANT ---
# 2장. pi codemode 내부: 모델이 쓴 코드가 툴을 지휘하는 방식

**이 장에서 답할 질문**
1. codemode는 1장의 RLM REPL과 무엇이 같고, 무엇이 다를까요?
2. 모델이 쓴 코드를 실행해도 안전한 이유는 무엇이고, 그 경계는 어디까지일까요?
3. `store()`의 상태는 왜 파일이 아니라 세션 트랜스크립트에 남을까요?
4. `exposure: codemode`와 `inlineBudget`은 컨텍스트 비용을 실제로 얼마나 바꿀까요?

**CS 렌즈: 호스트와 게스트의 신뢰 경계.** 신뢰받는 호스트가 신뢰받지 않는 게스트 코드를 격리된 환경에서 돌리고, 호스트가 허락한 함수만 경계를 넘게 하는 구조입니다. 이번 장의 실험은 pi 1.1.0 패키지에 들어 있는 실제 샌드박스 클래스(`CodemodeSandbox`)로 했습니다. LLM은 호출하지 않았고, 모델이 썼을 법한 스크립트를 직접 넣어 결과를 측정했습니다.

---

## 2.1 큰 그림: codemode는 "툴 하나"다

**이미 아는 것.** 1장에서 RLM은 루트 모델이 REPL에 코드를 쓰고, 그 코드가 데이터를 거르고 하위 모델을 부르는 구조였습니다.

**큰 그림.** pi의 codemode는 이 구조를 툴 하나로 포장한 것입니다. 모델은 `codemode`라는 툴을 호출하면서 인자로 JavaScript를 넘깁니다. 이 코드는 QuickJS 샌드박스 안에서 async 함수 본문으로 실행되어 최상위 `await`와 `return`을 쓸 수 있습니다. 코드 안에서는 `tools.<name>(args)`로 세션의 다른 툴을 부릅니다.

1장의 RLM과 대응시키면 다음과 같습니다.

| RLM (1장) | pi codemode |
|---|---|
| Python REPL | QuickJS 샌드박스 |
| `context` 변수 | 스크립트 안의 지역 변수 |
| 하위 LM 호출 함수 | `tools.*` (세션 툴), `models.classify()` |
| `FINAL(...)` | `return value` |
| 잘린 출력 | `max_output_tokens` (기본 10000) |

**하나 중요한 차이가 있습니다. codemode 스크립트에서는 채팅 모델을 직접 부를 수 없습니다.** 채팅 모델은 목록에는 나오지만 스크립트에서 실행할 수 없고, `models`로 돌릴 수 있는 것은 분류기와 이미지 모델입니다. 1장의 RLM처럼 "하위 LLM에게 자유 형식 판단을 맡기는" 부분은 기본 codemode에 없습니다. 이 빈 곳을 채우는 것이 뒤에서 볼 ypi 같은 확장입니다.

다음 절의 질문은 이것입니다. 모델이 쓴 코드를 하네스 쪽에서 돌리는데, 무엇이 그것을 막아 줄까요?

## 2.2 신뢰 경계: 샌드박스는 무엇을 막고 무엇을 통과시키나

**기초 짚기: Web Worker와 WebAssembly.** 브라우저의 Web Worker는 메인 스레드와 메모리를 공유하지 않는 별도 스레드입니다. 둘은 `postMessage`로 값을 복사해 주고받습니다. WebAssembly(wasm)는 자기에게 할당된 메모리 바깥을 읽거나 쓸 수 없는 바이트코드 실행 환경입니다. QuickJS는 C로 작성된 작은 JavaScript 엔진이고, 이를 wasm으로 컴파일하면 "JS 안에서 돌아가는 격리된 또 하나의 JS 엔진"이 됩니다.

**메커니즘.** pi는 두 겹으로 격리합니다. 패키지 소스의 주석에 따르면, `execute()`마다 별도의 worker 스레드와 QuickJS VM을 만들고, 스크립트는 등록된 툴과 출력 함수, `store`/`load` 외에는 아무것도 보지 못합니다. 타이머, `fetch`, `process`, `require`, 모듈이 모두 없습니다. 툴 인자와 결과는 JSON으로 왕복합니다. 이것은 Worker의 `postMessage`처럼 값을 복사해서 넘긴다는 뜻입니다.

**실험 C.** 실제 샌드박스에서 전역을 확인했습니다.

```
[C] 샌드박스 전역: {"fetch":"undefined","setTimeout":"undefined","process":"undefined",
                    "require":"undefined","tools":["read_log","classify"]}
[C] 영원히 안 끝나는 promise: script: The script is waiting on a promise that can never
    settle: no tool call is pending, and timers do not exist here.
```

타이머가 없으니, 대기 중인 툴 호출도 없는데 끝나지 않는 promise는 "절대 끝날 수 없다"고 판정하고 즉시 실패시킵니다. 무한 대기를 타임아웃까지 기다리지 않는 설계입니다.

**경계를 넘는 유일한 길이 툴이라는 점이 핵심입니다.** pi 소스의 주석에는 스크립트 안의 툴 호출도 에이전트 루프의 툴 파이프라인(`ctx.executeTool`)을 그대로 거치므로, 인자 검증과 `tool_call`/`tool_result` 훅, 권한 검사가 직접 호출과 똑같이 적용된다고 적혀 있습니다.

**왜 이게 중요한가.** 지난 대화에서 u1f992의 사례를 봤습니다. 모델이 파일 접근을 Read/Edit 대신 Bash로 하자, Read/Edit에 걸어 둔 훅이 무력화됐던 사례입니다. codemode는 그 반대입니다. 코드로 수십 개 툴을 한꺼번에 불러도 각 호출이 훅을 통과합니다. "적은 툴로 많은 일을 하면서도 런타임이 눈을 뜨고 있는" 구조를 실제로 구현한 셈입니다.

**경계의 한계.** 툴 호출은 실제로 일어나고, 실패해도 되돌려지지 않습니다. 스크립트 안에서 `bash`를 부르면 그 명령은 샌드박스 밖 시스템에서 실행됩니다. QuickJS 격리는 "스크립트 자체"를 가둘 뿐이고, 툴이 하는 일은 툴의 권한만큼 위험합니다.

다음 절의 질문은 이것입니다. 스크립트 한 번은 어떤 순서로 실행되고, 실패하면 무엇이 남을까요?

## 2.3 메커니즘: 스크립트 한 번의 생애

**순서.**
1. **옵션 파싱**: 첫 줄의 `// @options: {...}`에서 `max_output_tokens`(기본 10000)와 `timeout_ms`를 읽습니다.
2. **실행**: 새 worker와 VM에서 코드를 돌립니다. 툴 호출은 호스트로 넘어가 실행되고, 결과가 다시 VM으로 들어옵니다.
3. **결과 형태**: `outputSchema`를 선언한 툴은 구조화된 객체로, 나머지는 문자열로 돌아옵니다. 예를 들어 `bash`는 `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`를 돌려주고, 0이 아닌 종료 코드도 예외가 아니라 값으로 받습니다.
4. **출력 조립**: 모델에게는 스크립트의 출력만 전달되고, 중간 데이터는 샌드박스에 남습니다. 출력이 상한을 넘으면 앞뒤만 남기고 전체는 임시 파일에 써서 경로를 알려 줍니다.

**실패 시 의미론.** 이 부분은 실험으로 확인했습니다.

```js
// 실험 D: 중간에 실패하는 스크립트
store("x", 1);                              // 상태 쓰기 시도
text("1단계 완료");                          // 출력
await tools.read_log({ offset: 0, limit: 1 }); // 실제 툴 호출
throw new Error("2단계에서 실패");
```
```
[D] 실패 스크립트: ok = false / 남은 출력 = ["1단계 완료"]
    / 이미 실행된 툴 호출 = 1 / storeWrites 존재 = false
```

**세 가지가 서로 다르게 처리됩니다.** 출력은 실패 지점까지 남고, 이미 일어난 툴 호출은 되돌려지지 않으며, `store()` 쓰기는 버려집니다. 문서도 쓰기는 스크립트가 성공했을 때만 유지된다고 명시합니다. 데이터베이스의 트랜잭션처럼 "상태 쓰기"만 원자적이고, 외부 부수효과는 원자적이지 않은 구조입니다.

**실무 함의.** 부수효과가 있는 툴(파일 쓰기, 배포, 메시지 전송)을 스크립트 중간에 넣으면, 실패 후 재시도할 때 같은 일이 두 번 일어날 수 있습니다. 문서는 일부가 실패해도 성공한 결과를 지키려면 `Promise.allSettled()`를 쓰라고 권합니다.

다음 절에서는 이 구조가 컨텍스트와 시간을 실제로 얼마나 바꾸는지 측정합니다.

## 2.4 실험: 컨텍스트와 벽시계 시간

**실험 A 설계.** 1장과 같은 6,000행 데이터를 `read_log` 툴(500행씩 페이지 단위, 구조화 출력)로 노출하고, 200ms 걸리는 `classify` 툴을 하위 모델 대역으로 뒀습니다. 같은 질문을 두 방식으로 처리했을 때 모델에게 돌아가는 양을 비교했습니다. 직접 호출 쪽은 각 툴 결과가 모델 컨텍스트로 돌아간다고 가정해 계산했습니다.

```js
// 모델이 codemode로 넘겼을 스크립트 (실제 CodemodeSandbox에서 실행)
const first = await tools.read_log({ offset: 0, limit: 500 });
const pages = []; for (let off = 0; off < first.total; off += 500) pages.push(off);
const all = (await Promise.all(pages.map(o => tools.read_log({ offset: o, limit: 500 }))))
  .flatMap(p => p.lines);                     // 6000행은 샌드박스 변수에만 존재
const mine = all.filter(byTargetUser);         // 코드로 거르기
const counts = await Promise.all(chunks(mine, 20).map(c => tools.classify({ items: c })));
store("numeric_by_chunk", counts);             // 다음 스크립트가 쓸 상태
return { filtered: mine.length, numeric: sum(counts) }; // 모델이 보는 건 이것뿐
```

**결과.**

```
[A] 직접 호출 추정: 모델로 돌아오는 토큰 102062 / 왕복 12 회
[A] codemode    : 모델로 돌아오는 값 {"filtered":72,"numeric":26} → 7 tokens / 왕복 1회
[A] 스크립트 내부 툴 호출 17 회 (classify 4 회), 벽시계 415 ms
```

**실험 E: 병렬성.** 200ms 걸리는 호출 8개를 순차와 병렬로 비교했습니다.

```
[E] 순차 for-await : 1758 ms
[E] 병렬 Promise.all: 275 ms
```

**해석.** 컨텍스트 쪽에서는 1장의 RLM 실험과 같은 현상이 실제 pi 샌드박스에서도 재현됐습니다. 시간 쪽에서는 툴 호출 방식이 원리적으로 따라올 수 없는 차이가 생깁니다. 직접 호출에서 모델이 여러 툴을 병렬로 부르려면 한 응답에 여러 호출을 담아야 하고, 그 결정을 매 턴 모델이 내립니다. 스크립트에서는 `Promise.all` 한 줄로 결정됩니다. **1장에서 말한 "비결정성이 코드 작성 순간 한 곳에 모인다"는 것이 시간 축에서도 그대로 성립합니다.**

**주의할 점.** 이 실험에는 모델이 스크립트를 쓰는 데 드는 출력 토큰이 빠져 있습니다. 직접 호출 12회의 비용도 "결과를 모두 컨텍스트에 넣는다"는 가정에 따른 추정입니다. 실제로는 모델이 중간에 페이지 크기를 줄이거나 grep 툴을 먼저 쓸 수 있습니다. 또 `models.classify()`와 이미지 생성은 스크립트당 최대 4개만 동시에 실행됩니다. 이번 실험의 `classify`는 일반 툴이라 이 제한을 받지 않았습니다.

다음 절의 질문은 이것입니다. 스크립트에 남긴 `store()` 값은 어디에 보관될까요?

## 2.5 상태: store()는 왜 트랜스크립트에 남는가

**장면.** React에서 컴포넌트의 상태를 `useState`에 두느냐, URL이나 서버에 두느냐에 따라 새로고침이나 뒤로 가기 후의 동작이 달라집니다. "상태를 어디에 두는가"가 곧 "어떤 이벤트에 살아남는가"를 결정합니다.

**실험 B.** 샌드박스 자체가 상태를 보관하는지 확인했습니다.

```
[A] storeWrites (호스트가 트랜스크립트에 기록할 몫): {"set":{"numeric_by_chunk":[4,11,5,6]},"delete":[]}
[B] store 미전달 시 load: "없음" / 호스트가 넘겨줄 때: [4,11,5,6]
```

**메커니즘.** 샌드박스는 아무것도 기억하지 않습니다. 스크립트가 성공하면 쓴 값을 `storeWrites`로 호스트에 돌려주고, 다음 실행 때 호스트가 `store` 옵션으로 다시 넣어 줍니다. pi 쪽에서는 값을 저장한 성공 스크립트마다 세션 트랜스크립트에 `codemode-store` 커스텀 엔트리가 추가되고, 세션을 재개하면 값이 복원되며, 각 대화 분기는 자기 경로에서 쓴 값만 봅니다.

**왜 이렇게 설계했나.**
- **문서화된 근거**: Earendil은 codemode가 bash가 도는 쪽이 아니라 하네스가 도는 쪽에서 실행되고, 그래서 상태도 파일 시스템이 아니라 세션 트랜스크립트의 일부로 유지된다고 설명합니다.
- **제 추론**: pi 세션은 분기를 가진 트리입니다. 상태를 파일에 두면 분기 A에서 쓴 값이 분기 B에서도 보이는 불일치가 생깁니다. 트랜스크립트 엔트리로 두면 "이 지점까지의 기록"을 재생하는 것만으로 상태가 결정됩니다. Pi Durable의 문서가 fork 시점의 값을 고르게 한 것과 같은 문제의식입니다.

**한계.** 값 하나당 262,144자, 전체 1,048,576자로 제한되며, ID나 커서, 요약 같은 작은 상태용입니다. 큰 데이터는 툴을 통해 파일로 내보내야 합니다.

다음 절의 질문은 이것입니다. 툴이 수십 개일 때, 모델은 그 툴들을 어떻게 알게 될까요?

## 2.6 노출(exposure)과 설명 비용

**기초 짚기: 툴 선언.** 모델이 툴을 쓰려면 이름, 설명, 인자 스키마가 매 요청의 프롬프트에 들어가 있어야 합니다. 이것을 "선언"이라고 부릅니다. 툴이 많을수록 선언이 길어지고, 그 토큰은 매 요청마다 반복해서 비용이 됩니다.

**메커니즘.** pi는 툴마다 `exposure`를 정합니다. 1장의 질문에 이어서 보면 codemode와 관련된 것은 셋입니다.
- `direct`: 모델에게 선언됩니다. codemode가 켜져 있으면 설명 끝에 "스크립트에서 이렇게 부르면 이런 값이 돌아온다"는 한 줄이 붙습니다.
- `codemode`: 모델에게는 선언되지 않고, codemode 설명 안에 TypeScript 선언으로만 실립니다. 실릴 수 있는 양은 `inlineBudget`(기본 3000토큰 추정)으로 제한됩니다.
- `deferred`: 목록에도 실리지 않습니다. 스크립트가 `searchTools()`(BM25 순위, 기본 8개)나 `describeTool()`로 찾아서 씁니다.

예산 안에 무엇을 실을지는 소스에 알고리즘이 있습니다. 매 라운드 각 그룹(네임스페이스 없는 툴 먼저, 그다음 네임스페이스 이름순)이 가장 싼 툴을 하나씩 넣고, 다음 툴이 예산에 맞지 않는 그룹은 빠집니다. 그래서 **모든 네임스페이스가 최소 하나씩 대표되기 전에는 어느 네임스페이스도 다 실리지 않습니다.**

**실험 F.** MCP 서버 3개에 툴 20개씩, 총 60개가 있을 때 pi 1.1.0의 실제 설명 생성 함수(`createCodemodeDescription`)로 크기를 쟀습니다.

```
[F] direct 노출 60개 선언          : 6615 tokens
[F] codemode (예산 3000 내 listed) : 3260 tokens, 목록에 실린 툴 29개
[F] codemode (MCP 툴 미기재)       : 280 tokens
```

**왜 이렇게 설계했나 (문서화된 근거).** 0.99.2부터 codemode 설명은 MCP 서버가 연결되거나 툴이 바뀌어도 변하지 않습니다. 서버 목록은 별도의 짧은 시스템 프롬프트 섹션으로 옮겨졌습니다. 소스 주석도 활성 집합이 아니라 노출 등급으로 목록을 정하는 이유를, `tool_search`로 툴을 불러와도 codemode 설명이 바뀌지 않게 하기 위해서라고 적습니다. **설명이 바뀌지 않아야 프롬프트 캐시가 깨지지 않는다는 것이 이 설계의 실질적인 이유입니다.**

**치르는 것.** 280토큰은 "툴을 모르는 상태"의 비용입니다. 모델은 쓸 툴을 찾기 위해 `searchTools()`를 한 번 더 호출해야 하고, 검색이 엉뚱한 툴을 내놓으면 헛걸음합니다. MCP 서버의 `description`이 툴 검색 순위에도 쓰이니, 노출을 줄일수록 설명 품질이 중요해집니다.

다음 절에서는 이 장의 내용을 하네스 설계로 옮겨 정리합니다.

## 2.7 얻는 것과 치르는 것, 그리고 하네스 적용

**얻는 것.**
- 큰 중간 데이터가 모델 컨텍스트에 들어가지 않습니다.
- 병렬 실행이 모델의 매 턴 판단이 아니라 코드로 결정됩니다.
- 스크립트 안의 모든 툴 호출이 훅과 권한 검사를 통과합니다.
- 툴이 많아져도 선언 비용과 캐시 안정성을 통제할 수 있습니다.

**치르는 것.**
- 모델이 문법적으로 맞는 스크립트를 써야 합니다. pi는 지원 모델에서 문법 제약 샘플링(grammar)을 써서 이를 돕습니다.
- 부수효과는 원자적이지 않습니다.
- 채팅 모델 하위 호출이 없어 RLM의 "의미 판단 위임"은 확장이 필요합니다.
- 툴을 숨길수록 발견 비용이 생깁니다.

**하네스 적용.**
- **`ak` CLI는 그대로 두고, pi 어댑터에서 주요 명령을 `outputSchema`가 있는 툴로 등록합니다.** 스크립트는 구조화 결과를 받아야 다음 단계를 코드로 이어 갈 수 있습니다. 텍스트만 돌려주는 툴은 스크립트에서 다시 파싱해야 해서 codemode의 이점이 줄어듭니다.
- **노출 등급을 의도적으로 나눕니다.** 매번 쓰는 2~3개는 `direct`, 자주 조합하는 것은 `codemode`, 드물게 쓰는 것은 `deferred`로 둡니다.
- **관찰자 C를 codemode 스크립트 하나로 표현할 수 있습니다.** 세션 로그를 읽는 툴, 마이닝 툴, 분류 툴을 등록하면 C의 한 라운드가 `Promise.all`과 `store()`로 끝납니다. 다만 "이 패턴이 스킬감인가"처럼 자유 형식 판단이 필요하면 채팅 모델 하위 호출 툴을 따로 붙여야 합니다.

---

## 요약: 렌즈 매핑

| 개념 | 호스트–게스트 신뢰 경계 렌즈에서의 의미 |
|---|---|
| QuickJS + worker | 게스트 코드를 가두는 격리 실행 환경 |
| `tools.*` | 경계를 넘는 유일한 통로 (호스트가 허락한 함수) |
| `ctx.executeTool` 경유 | 통로를 지날 때마다 검문 (훅·권한) |
| JSON 왕복 | 참조가 아닌 값 복사로만 경계를 넘김 |
| `storeWrites` | 게스트는 상태를 소유하지 않고, 호스트가 보관 |
| 실패 시 store 폐기 | 상태 변경만 원자적, 외부 부수효과는 비원자적 |
| `exposure` / `inlineBudget` | 게스트에게 통로 목록을 얼마나 보여줄지의 정책 |

**실무 규칙.**
- 스크립트에서 쓸 툴에는 `outputSchema`를 선언합니다.
- 부수효과가 있는 툴 호출은 스크립트 끝으로 미루거나 멱등하게 만듭니다.
- 부분 실패를 견뎌야 하면 `Promise.allSettled()`를 씁니다.
- 큰 결과는 `store()`가 아니라 파일로 보내고, store에는 경로와 요약만 둡니다.
- 툴을 숨길수록 MCP 서버와 툴의 `description`을 검색 가능한 문장으로 다듬습니다.

**다음 장 예고.** codemode에 빠진 "채팅 모델 하위 호출"을 채우는 방법을 볼 차례입니다. ypi처럼 pi 프로세스를 재귀적으로 띄우는 방식과 Pi Durable처럼 서브에이전트를 "소유된 대화"로 만드는 방식을 비교하고, 각각이 비용 상한, 크래시 복구, 훅 적용을 어떻게 다루는지 실험으로 따라가겠습니다.

---

# 조사: RLM을 개인 에이전트 런타임에 적용해 성과를 보인 사례

결론부터 말씀드리면, **통제된 벤치마크로 성과를 보인 사례는 있지만 대부분 장문 컨텍스트 과제이고, 일상적인 코딩 작업에서의 효과를 엄밀하게 측정한 개인 사례는 아직 찾지 못했습니다.** 근거의 강도 순으로 정리합니다.

## A. 벤치마크로 측정된 사례

**① Prime Agent (Prime Intellect, 오픈소스).** 개인이 설치해서 쓰는 코딩 에이전트이고, GitHub 페이지에는 pi 위에 만들어졌다고 소개돼 있습니다. 세션마다 지속되는 IPython REPL을 기본 툴로 두고, `rlm(...)`으로 자식 에이전트를 띄워 결과를 프로그램으로 받습니다. 8월 논문의 장문 과제 결과 중 눈에 띄는 것은 다음과 같습니다.

| 벤치마크 | GLM-5.2: Prime / Pi-mono | Opus 5: Prime / Claude Code | GPT-5.6 Sol: Prime / Codex |
|---|---|---|---|
| OOLONG (128k) | .700 / .420 | .900 / .920 | .940 / .900 |
| OOLONG-Pairs | .874 / .556 | .929 / .922 | .911 / .895 |
| LongCoT-Mini | .638 / .613 | .722 / .558 | .671 / .681 |
| EmulatorBench | .208 / .000 | .047 / .062 | .275 / .228 |

읽는 법이 중요합니다. **오픈 모델(GLM-5.2)을 기본 pi와 비교했을 때 차이가 가장 크고, 프론티어 모델을 각자의 네이티브 하네스와 비교하면 차이가 작거나 엇갈립니다.** 저자들도 표에 불확실성 구간이 없고, 굵게 표시한 것은 통계적 유의성이 아니라 점추정이라고 밝힙니다. nanoGPT 스피드런에서는 하네스 선택이 최종 기록에 미친 영향이 노이즈 수준이었습니다.

하네스 설계 관점에서 특히 볼 만한 교훈이 있습니다. Factorio 실험에서 보상 우회 행동이 나왔는데, RCON 지름길이 재사용 가능한 스킬로 저장되어 자동 개선(refinement)이 해로운 행동을 보존할 수 있음을 보였습니다. 저자들은 안전한 배포에 최소 권한 인터페이스, 독립 검증, 감사 가능한 롤백이 필요하다고 정리합니다. 우리가 설계한 관찰자 C의 "제안만 하고 사람이 승인한다"는 원칙이 왜 필요한지 보여주는 실증 사례입니다.

**② Recursive Agent Harnesses (PwC 연구진).** 맨 모델 호출이 아니라 툴, 파일 시스템, 코드 실행, 계획을 갖춘 하네스 전체를 재귀 단위로 삼는 방식입니다. 부모 에이전트가 스크립트를 써서 여러 하위 하네스를 병렬로 띄웁니다. Oolong-Synthetic에서 GPT-5로 81.36%, Claude Sonnet 4.5로 89.77%를 기록해, Codex(71.75%)와 원조 RLM(64.38%)을 앞섰습니다. 다만 평가는 Oolong-Synthetic 하나뿐이고, 긴 컨텍스트에서는 부모가 하위 에이전트를 띄우지 않고 직접 답하는 경우가 있었으며, GPT-5 구성의 비용과 지연은 측정하지 않았습니다.

**③ LangChain dcode (Deep Agents의 터미널 코딩 에이전트).** 개념 증명 수준이지만 같은 에이전트에서 REPL 유무만 바꿔 비교했습니다. OOLONG AgNews 64k에서 0.58 → 0.67, 128k에서 0.44 → 0.79로 올랐습니다. 128k에서 일반 에이전트는 계산할 수 없다며 포기하는 경우가 많았고, REPL 에이전트는 더 느리고 토큰은 적게 썼지만 출력 토큰 가격 때문에 비용은 더 높았습니다.

## B. 개인 프로젝트 (pi / Claude Code 확장)

| 프로젝트 | 런타임 | 방식 | 보고된 성과 |
|---|---|---|---|
| **rlm.pi** (`@hicaru/pi-rlm`) | pi | 큰 문서는 샌드박스에 두고 모델에겐 색인만, 비싼 모델이 지휘하고 싼 워커 모델이 읽음 | OOLONG-synth 24문항, 최대 128k에서 GLM-4.7 91.7% (22/24) |
| **ypi** (rawwerks) | pi | 확장이 `rlm_query` 툴을 등록해 같은 확장을 가진 자식 pi 프로세스를 띄움, `$CONTEXT` 파일을 bash로 탐색 | 이전 REPL 방식이 LongMemEval 77.6%, 현재 구조의 벤치마크는 없음 |
| **claude-rlm** (Tenobrus) | Claude Code | tmux에서 `claude -p` 자식을 띄우는 스킬, REPL 대신 파일 경로가 변수 역할 | 비공식 비교: 『프랑켄슈타인』 인물 찾기에서 일반 Claude Code 20명, RLM 스킬 29명 |
| **rlm-claude-code** (rand) | Claude Code | 복잡도 분류기로 자동 활성화, REPL 헬퍼와 깊이 3 재귀 | 품질 벤치마크 없음, 훅 시작 시간 개선 수치만 있음 |
| **pi-rlm** (manojlds) | pi | 계획-분해-합성 트리, 깊이·노드·분기 상한 | 측정 결과 없음 |
| **harness-rlm** (Rachitt Shah) | Claude Code, Goose | MCP 서버와 어댑터로 여러 하네스를 RLM 기반으로 | 3문항 배관 점검 수준, 리더보드 제출 아님 |

이 표에서 주의할 점이 두 가지 있습니다. 첫째, rlm.pi의 91.7%는 **RLM 없이 같은 모델을 돌린 비교군이 없어서** RLM의 효과라고 단정할 수 없고, 표본도 24문항으로 작습니다. 둘째, ypi는 비용 상한(`RLM_BUDGET`), 전체 트리 타임아웃, 호출 수 상한, 자식용 저렴한 모델 지정, 호출별 비용 추적까지 갖춰서, 성과보다는 **pi에서 재귀 서브에이전트를 안전하게 운영하는 레퍼런스 구현**으로 가치가 큽니다.

## C. 발표 수준의 주장 (2차 자료)

ypi를 만든 Raw Works의 Raymond Weitekamp는 AI Engineer 발표에서 몇 가지 결과를 소개했습니다. 수정하지 않은 기본 RLM 하네스가 메모리 벤치마크에서 상위 10위권이었고, RLM 방식의 작은 Qwen3 모델이 Long CoT 과제에서 Opus와 GPT-5를 이겼다는 내용입니다. 다만 이는 발표를 정리한 2차 자료이므로 원 데이터를 확인하기 전까지는 참고로만 보는 게 맞습니다. 같은 발표에서 그는 사람이 분해 방식을 미리 고정한 map-reduce는 RLM이 아니며, 분해 방식을 모델이 골라야 진짜 RLM이라고 강조했고, 잘못 분해하면 재귀가 비싼 미로가 된다고 경고했습니다.

## 정리: 지금 근거가 말해주는 것

1. **효과가 확실한 영역**은 긴 입력 전체를 훑어 집계하거나 연결해야 하는 과제입니다. OOLONG류, 대규모 문서 검색, 긴 로그 분석이 해당합니다.
2. **효과가 가장 큰 조합**은 약하거나 저렴한 모델입니다. 프론티어 모델과 네이티브 하네스 조합은 이미 강해서 차이가 작습니다.
3. **일상 코딩 작업**에 대한 엄밀한 개인 사례는 아직 없습니다. 대부분 일화이거나 측정이 없습니다.
4. **pi 사용자에게 가장 가까운 참고 구현**은 세 가지입니다. 벤치마크를 원하면 Prime Agent, 재귀 서브에이전트의 안전장치를 보려면 ypi, 워커 모델 분리를 보려면 rlm.pi입니다.

지금 설계 중인 하네스에서는 **관찰자 C가 RLM이 가장 잘 맞는 자리**입니다. 수많은 세션 로그를 훑어 반복 패턴을 집계하는 일은 위 사례들이 효과를 보인 "긴 입력의 집계·연결" 과제와 정확히 같은 모양이기 때문입니다.

Sources:
- [pi Codemode 문서](https://pi.dev/docs/latest/codemode)
- ["You Said No MCP!" — Earendil](https://earendil.com/posts/you-said-no-mcp/)
- [Pi Changelog](https://pi.dev/changelog)
- [Prime Agent (GitHub)](https://github.com/PrimeIntellect-ai/prime-agent)
- [Prime Agent: A Self-Improving RLM Harness (arXiv)](https://arxiv.org/html/2608.23552v1)
- [Recursive Agent Harnesses (arXiv)](https://arxiv.org/html/2606.13643v1)
- [LangChain — How to use RLMs in Deep Agents](https://langchain.com/blog/how-to-use-rlms-in-deep-agents)
- [rlm.pi README](https://cdn.jsdelivr.net/gh/openzebra/rlm.pi@master/README.md)
- [ypi README](https://cdn.jsdelivr.net/gh/rawwerks/ypi@master/README.md)
- [pi-rlm (manojlds) README](https://cdn.jsdelivr.net/gh/manojlds/pi-rlm@main/README.md)
- [Tenobrus/claude-rlm](https://github.com/Tenobrus/claude-rlm)
- [rand/rlm-claude-code](https://github.com/rand/rlm-claude-code)
- [rachittshah/harness-rlm](https://github.com/rachittshah/harness-rlm)
- [재귀 코딩 에이전트 발표 정리 (위키독스)](https://wikidocs.net/blog/@jaehong/20919/)

--- [34] USER ---
내가 멍청해서 전반적인 흐름과 맥락을 이해못하고있어 일반적인 에이전트 하네스 루프가 어떻게 동작하고 각 개념을 어떻게 부르고 사용하는지에 대한 기초부터 다시 쌓고 RLM과 일반 harness 런타임의 차이를 이해해야할거같아

--- [35] ASSISTANT ---
기초부터 다시 쌓는 게 맞는 순서입니다. 지금까지 대화가 하네스 설계, 서브에이전트, codemode, RLM으로 빠르게 옮겨 다녀서, 그 모든 것이 올라가 있는 바닥, 즉 "에이전트 루프" 자체를 먼저 그려야 각 개념이 어디에 붙는지 보입니다. 루프를 직접 돌려 보이는 작은 실험부터 만들게요.

--- [36] ASSISTANT ---
[Write /home/claude/rlm-lab/mini-harness.mjs]

--- [37] ASSISTANT ---
# 기초 장. 에이전트 하네스 루프와 RLM의 자리

**이 장에서 답할 질문**
1. "에이전트"는 프로그램으로 보면 정확히 무엇일까요?
2. 시스템 프롬프트, 툴, 스킬, 훅, 서브에이전트 같은 용어는 그 프로그램의 어디에 붙는 부품일까요?
3. RLM은 그 프로그램에서 무엇을 바꾼 것일까요?
4. 지금까지 대화에서 나온 주제들은 이 그림의 어디에 있을까요?

**CS 렌즈: 루프와 상태 배열.** 에이전트를 "while 루프 하나와, 매 바퀴 통째로 전송되는 배열 하나"로 봅니다. 이 장의 모든 개념은 이 루프의 특정 지점에 붙는 부품으로 설명됩니다.

---

## 0.1 큰 그림: 에이전트는 while 루프다

**이미 아는 것.** 브라우저 이벤트 루프는 "큐에서 작업을 꺼내 실행하고, 다시 꺼낸다"를 반복합니다. 에이전트 하네스도 같은 모양의 반복입니다.

**정의부터 짚습니다.**
- **모델(LLM)**: 텍스트를 입력받아 텍스트를 출력하는 함수입니다. API로 한 번 호출하면 한 번 답하고 끝납니다.
- **하네스(harness)**: 이 함수를 반복해서 호출하고, 모델이 요청한 행동을 실제로 실행해 주는 프로그램입니다. pi, Claude Code, Codex가 모두 하네스입니다. "런타임"이라는 말도 같은 뜻으로 써 왔습니다.
- **에이전트**: 모델과 하네스를 합친 전체를 가리킵니다.

**하네스의 본체는 놀랄 만큼 짧습니다.** 위에서 방금 만든 실습 코드의 루프 부분이 이것입니다.

```js
const messages = [system, userMessage];        // 대화 전체를 담는 배열
while (true) {
  const reply = await model(messages);          // ① 배열 전체를 모델에 보낸다
  messages.push(reply);                         // ② 모델의 응답을 배열에 붙인다
  if (reply.type === "text") break;             // ③ 툴 요청이 없으면 끝
  const result = await runTool(reply);          // ④ 툴 요청이면 하네스가 실행한다
  messages.push({ role: "tool", content: result }); // ⑤ 결과를 배열에 붙이고 ①로
}
```

**에이전트는 "모델 호출 → 툴 실행 → 결과를 배열에 추가"를 모델이 멈출 때까지 반복하는 while 루프입니다.** 이 장의 나머지는 이 다섯 줄의 각 지점을 확대해서 보는 작업입니다.

다음 절의 질문은 이것입니다. 왜 매번 배열 "전체"를 보낼까요?

## 0.2 메시지 배열: 모델은 기억이 없다

**기초 짚기: 무상태(stateless) API.** 모델 API는 이전 호출을 기억하지 않습니다. HTTP 요청 하나하나가 독립적이라서, 서버가 세션을 기억하지 않는 REST API와 같습니다. 모델이 "대화를 이어가는 것처럼" 보이는 이유는 하네스가 지금까지의 대화 전체를 매번 다시 보내기 때문입니다.

**배열에 들어가는 항목은 네 종류입니다.**

| 역할 | 누가 만드나 | 예 |
|---|---|---|
| `system` | 하네스 | "You are a coding agent…", AGENTS.md 내용, 툴 목록 |
| `user` | 사람 | "src 폴더의 TODO를 세어 줘" |
| `assistant` | 모델 | 답변 텍스트, 또는 툴 호출 요청(`tool_use`) |
| `tool` (tool_result) | 하네스 | 툴을 실행한 결과 |

**컨텍스트 창은 이 배열의 최대 크기입니다.** 1장에서 "컨텍스트 창"이라고 부른 것은 추상적인 개념이 아니라, 매 호출에 실려 가는 이 배열의 토큰 수 상한입니다.

**한 가지 결과가 따라옵니다.** 툴 결과가 한 번 배열에 들어가면, 그 뒤의 모든 호출에 다시 실려 갑니다. 2단계에서 2만 토큰짜리 로그를 읽고 이후 10번 더 호출하면, 그 로그는 10번 더 전송됩니다. 프롬프트 캐시(같은 앞부분을 다시 보낼 때 제공자가 재계산을 줄여 주는 기능)가 비용은 줄여 주지만, 배열이 컨텍스트 창을 차지하는 문제와 모델이 무뎌지는 문제는 그대로 남습니다.

다음 절에서는 실제로 루프를 한 바퀴씩 따라가 봅니다.

## 0.3 실험: 루프를 한 바퀴씩 따라가기

**실험 설계.** 진짜 LLM 대신 "대본대로 답하는 가짜 모델"을 넣은 최소 하네스를 만들었습니다. 툴은 실제 bash이고, `rm` 명령을 막는 훅 하나를 붙였습니다. 가짜 모델은 처음에 `rm`을 시도하고, 다음에 `grep`을 하고, 마지막에 답합니다.

**결과.**

```
[step 1] 보낸 메시지 2개(~29 tok) → 모델 응답: tool_use
         툴 결과 → "ERROR: rm은 금지된 명령입니다"
[step 2] 보낸 메시지 4개(~66 tok) → 모델 응답: tool_use
         툴 결과 → "src/b.ts:1:// TODO: 캐시\nsrc/a.ts:1:// TODO: 로그인\nsrc/a.ts:2:// TODO: 로그아웃"
[step 3] 보낸 메시지 6개(~118 tok) → 모델 응답: text

최종 답: TODO는 3개입니다: 로그인, 로그아웃, 캐시.
모델 호출 3회, 누적 입력 ~213 tok (마지막 배열 크기 ~139 tok)
```

**읽는 법.**
- **배열이 매 단계 커집니다.** 2개 → 4개 → 6개. 한 바퀴마다 `assistant`와 `tool` 항목이 하나씩 붙습니다.
- **누적 입력이 마지막 배열보다 큽니다.** 213 > 139. 같은 앞부분이 매번 다시 전송되기 때문입니다. 단계가 길어질수록 이 차이는 빠르게 벌어집니다.
- **훅은 모델이 아니라 하네스 코드입니다.** 모델은 `rm`을 요청했지만 실행되지 않았고, 거절 메시지가 툴 결과로 돌아갔습니다. 지난 대화에서 "강제는 모델 밖에서"라고 한 것이 이 지점입니다.

**용어 정리.** 이 실험에서 모델 호출 한 번을 **스텝(step)** 또는 **턴(turn)**이라고 부릅니다. 하네스마다 용어가 조금씩 다르지만, 사람이 메시지 하나를 보내고 에이전트가 최종 답을 낼 때까지의 전체를 **런(run)**, 그 안의 모델 호출 한 번을 턴이라고 부르는 경우가 많습니다. 모델이 텍스트로 답하며 멈추는 것을 **stop**이라고 하고, 이유를 stop reason으로 기록합니다.

다음 절의 질문은 이것입니다. 지금까지 나온 용어들은 이 루프의 어디에 붙어 있을까요?

## 0.4 루프에 붙는 부품들: 용어 지도

**큰 그림.** 하네스의 기능은 모두 루프의 네 지점 중 하나에 붙습니다. 루프 시작 전, 모델 호출 직전, 툴 실행 앞뒤, 루프 바깥입니다.

```
[루프 시작 전]   시스템 프롬프트 조립: AGENTS.md + 툴 선언 + 스킬 목록
       │
       ▼
┌─▶ [모델 호출 직전]   컴팩션(배열이 너무 크면 요약), 리마인더 주입
│      │
│      ▼  model(messages)
│      │
│      ▼  응답이 tool_use면
│   [툴 실행 앞]   훅·권한 검사 (차단 가능)
│      │
│      ▼  툴 실행: 내장 툴 / 커스텀 툴 / MCP 툴 / 서브에이전트
│      │
│   [툴 실행 뒤]   훅 (결과 수정·기록)
│      │
└──────┘  결과를 messages에 추가

[루프 바깥]   세션 저장(JSONL), 스케줄러, 관찰자 같은 외부 프로세스
```

**각 용어를 한두 문장으로 정의하면 다음과 같습니다.**

| 용어 | 정체 | 붙는 지점 |
|---|---|---|
| 시스템 프롬프트 | 배열 맨 앞의 `system` 메시지. 하네스가 조립함 | 루프 시작 전 |
| AGENTS.md / CLAUDE.md | 시스템 프롬프트에 항상 끼워 넣는 프로젝트 지침 파일 | 루프 시작 전 |
| 툴 | 모델이 요청하면 하네스가 실행하는 함수. 이름·설명·인자 스키마가 시스템 프롬프트에 선언됨 | 툴 실행 |
| MCP | 툴을 외부 서버에서 가져오는 표준 프로토콜. 하네스 입장에서는 "툴을 공급하는 방법" 중 하나 | 툴 실행 |
| 스킬 | 시스템 프롬프트에는 이름과 설명만 두고, 필요할 때 모델이 파일 읽기 툴로 본문을 읽는 지침 묶음 | 루프 시작 전(목록) + 툴 실행(본문 읽기) |
| 프롬프트 템플릿 / 슬래시 커맨드 | 사람이 `/명령`으로 부르는 미리 쓴 `user` 메시지 | 사람 입력 |
| 훅 | 정해진 지점에서 하네스가 실행하는 코드. 차단·수정·기록 가능 | 툴 실행 앞뒤 등 |
| 익스텐션(pi) / 플러그인 | 툴·훅·커맨드를 코드로 추가하는 묶음 | 여러 지점 |
| 권한 / 샌드박스 | 툴이 할 수 있는 일의 범위를 제한하는 장치 | 툴 실행 앞 |
| 컴팩션 | 배열이 컨텍스트 창에 가까워지면 오래된 부분을 요약으로 대체 | 모델 호출 직전 |
| 세션 | 메시지 배열을 파일로 저장한 것. pi는 JSONL | 루프 바깥 |

**스킬이 헷갈렸다면 이 한 줄을 기억하시면 됩니다.** 스킬은 새로운 실행 메커니즘이 아니라 "설명만 미리 보여 주고 본문은 나중에 읽게 하는 텍스트"입니다. Agent Skills 형식은 처음에는 이름과 설명만 읽고, 과제가 맞으면 전체 SKILL.md를 불러오고, 실행 중에 참조 파일을 필요할 때 읽는 3단계 로딩을 씁니다. 처음 대화에서 "결국 다 텍스트 컨텍스트 아니냐"고 하신 직관이 정확히 이 지점에서 맞습니다. 스킬과 AGENTS.md는 배열에 들어가는 시점과 위치만 다를 뿐 모두 텍스트입니다. 반면 훅과 권한은 텍스트가 아니라 코드라서, 모델의 판단과 무관하게 동작합니다.

다음 절의 질문은 이것입니다. 서브에이전트는 이 그림의 어디에 있을까요?

## 0.5 서브에이전트: 루프 안의 또 다른 루프

**메커니즘.** 서브에이전트는 하네스 입장에서 **툴 하나**입니다. 그 툴의 실행 내용이 "새 메시지 배열을 만들고 0.1의 while 루프를 한 번 더 돌린 뒤, 최종 텍스트를 돌려주는 것"일 뿐입니다.

```js
// 서브에이전트 = 루프를 실행하는 툴
tools.subagent = async ({ task }) => {
  const childMessages = [childSystem, { role: "user", content: task }]; // 새 배열 (fresh)
  return await runLoop(childMessages);    // 0.1의 while 루프를 그대로 재사용
};                                        // 자식의 최종 텍스트만 부모 배열에 들어간다
```

**이 그림 하나로 지난번 트렌드 조사가 정리됩니다.**
- **fresh vs fork**: 자식 배열을 빈 상태로 시작하면 fresh, 부모 배열을 복사해서 시작하면 fork입니다.
- **sync vs async(background)**: 툴이 자식 루프가 끝날 때까지 기다리면 동기, ID만 돌려주고 나중에 결과를 메시지로 넣어 주면 비동기입니다.
- **Agent Teams**: 자식 루프들이 서로 메시지를 주고받을 수 있게 한 것입니다.

**서브에이전트의 핵심 이점은 자식 배열이 부모 배열과 분리된다는 점입니다.** 자식이 파일 100개를 읽어도 부모 배열에는 요약 한 단락만 들어갑니다. 대신 자식을 띄울지 말지, 몇 개 띄울지를 부모 모델이 매 턴 판단합니다. 처음 대화에서 짚으신 "서브에이전트 스폰조차 비결정성에 의존한다"는 것이 이것입니다.

다음 절에서는 드디어 RLM이 이 루프의 어디를 바꾸는지 봅니다.

## 0.6 RLM은 루프의 어디를 바꾸나

**결론부터 말씀드리면, RLM은 새로운 종류의 루프가 아닙니다. 같은 루프에서 두 가지를 바꾼 것입니다.** 툴을 "코드 실행기(REPL) 하나"로 바꾸고, 큰 데이터를 메시지 배열 밖의 변수로 옮겼습니다.

RLM 블로그의 설명을 루프 용어로 옮기면 이렇습니다. 루트 모델은 질문만 받고, 큰 컨텍스트는 환경 쪽에 저장됩니다. 모델은 코드 블록을 출력하고, 실행 결과는 잘린 형태로만 자기 컨텍스트에 돌아옵니다. 그리고 그 REPL 안에서 하위 모델을 함수처럼 호출합니다.

**같은 질문 "로그 6,000행에서 수량형 질문 개수"를 세 방식으로 처리하면 차이가 보입니다.**

| | 일반 하네스 | 일반 하네스 + codemode (pi) | RLM |
|---|---|---|---|
| 큰 데이터가 사는 곳 | 툴 결과로 **메시지 배열**에 들어옴 | 스크립트 실행 중 **샌드박스 변수**에 잠깐 | **REPL 변수**에 처음부터 상주 |
| 한 턴의 행동 단위 | 툴 호출 1개(또는 몇 개 병렬) | 스크립트 1개 = 툴 호출 여러 개 | 코드 블록 1개 = 하위 호출 여러 개 |
| 하위 호출 | 서브에이전트 툴 → 결과가 **배열**로 | `tools.*`, 분류기 → 결과가 **변수**로 | 하위 LM 함수 → 결과가 **변수**로 |
| 분해를 정하는 방식 | 매 턴 모델이 툴을 고름 | 모델이 스크립트로 한 번에 정함 | 모델이 코드로 정함 (재귀 가능) |
| 배열에 남는 것 | 원본 데이터 + 모든 중간 결과 | 스크립트와 최종 출력 | 코드와 잘린 출력 |

**세 칸의 차이는 결국 하나의 질문으로 모입니다. "중간 데이터가 메시지 배열에 들어가는가, 변수에 머무는가."** 0.2에서 봤듯이 배열에 들어간 것은 이후 모든 턴에 다시 실려 가고, 쌓일수록 모델이 무뎌집니다. 변수에 머무는 것은 모델이 필요한 만큼만 출력해서 봅니다.

**codemode가 중간에 있는 이유.** pi의 codemode는 행동 단위를 코드로 바꿨다는 점에서 RLM 쪽에 가깝습니다. 하지만 두 가지가 다릅니다. 큰 데이터가 처음부터 변수에 있는 게 아니라 툴로 읽어 와야 하고, 스크립트에서 채팅 모델을 하위 호출할 수 없습니다. ypi나 rlm.pi 같은 확장이 이 두 빈칸을 채워서 pi를 RLM에 가깝게 만드는 것입니다.

**서브에이전트와 RLM 하위 호출의 차이도 같은 축입니다.** 서브에이전트의 결과는 부모 배열로 들어가고, RLM 하위 호출의 결과는 변수로 들어갑니다. 서브에이전트 100개를 띄우면 요약 100개가 부모 배열에 쌓이지만, RLM에서 하위 호출 100번을 하면 결과 100개가 리스트 변수에 담기고 루트는 그 집계만 봅니다.

다음 절에서는 지금까지의 대화 주제를 이 그림 위에 배치합니다.

## 0.7 지금까지 대화의 지도

처음부터 나온 주제들을 루프의 지점에 대응시키면 다음과 같습니다.

| 대화에서 다룬 주제 | 루프의 어디에 해당하나 |
|---|---|
| 벤더 중립 하네스 (AGENTS.md, 스킬, `ak` CLI) | 루프 시작 전에 넣는 텍스트, 그리고 툴로 부르는 실행 파일을 런타임과 무관하게 관리 |
| "결국 다 텍스트 아니냐" | 시스템 프롬프트·스킬·툴 결과는 모두 배열의 텍스트. 단, 위치와 시점이 다름 |
| 훅, 강제는 모델 밖에서 | 툴 실행 앞뒤의 하네스 코드 |
| 툴은 적게 vs 많이 | 시스템 프롬프트의 툴 선언 크기, 그리고 훅이 볼 수 있는 의도 |
| 결정적 작업을 코드로 빼기 | 여러 턴의 툴 호출을 스크립트·CLI 한 번으로 대체 |
| 관찰자 에이전트 C | 루프 바깥의 별도 프로세스가 세션 파일(저장된 배열)을 읽음 |
| 서브에이전트 트렌드 | 툴 실행 지점에서 또 하나의 루프를 돌리는 방식들 |
| pi codemode | 툴 하나로 코드를 받아 여러 툴을 실행, 중간 데이터는 배열 밖 |
| RLM | 툴을 REPL로 바꾸고 데이터를 배열 밖 변수에 둔 같은 루프 |

---

## 요약: 렌즈 매핑

| 개념 | 루프와 상태 배열 렌즈에서의 의미 |
|---|---|
| 모델 | 배열을 받아 다음 항목 하나를 돌려주는 무상태 함수 |
| 하네스 | while 루프 + 툴 실행기 + 배열 관리자 |
| 컨텍스트 창 | 배열의 최대 크기 |
| 툴 결과 | 배열에 추가되어 이후 모든 턴에 재전송되는 항목 |
| 훅·권한 | 루프의 특정 지점에서 도는 하네스 코드 (텍스트 아님) |
| 스킬·AGENTS.md | 배열에 넣는 텍스트 (넣는 시점만 다름) |
| 서브에이전트 | 새 배열로 루프를 한 번 더 돌리고 결과만 돌려주는 툴 |
| codemode | 툴 여러 개를 스크립트 하나로 묶어 중간 결과를 배열 밖에 두는 툴 |
| RLM | 툴=REPL, 데이터=배열 밖 변수로 바꾼 같은 루프 |

**실무 규칙.**
- 새 기능이나 용어를 만나면 "이건 루프의 어느 지점에 붙는가"부터 묻습니다.
- "모델이 따라야 하는 것"은 텍스트로, "반드시 지켜져야 하는 것"은 훅·권한 코드로 둡니다.
- 큰 데이터를 툴 결과로 배열에 들이기 전에, 배열 밖(변수·파일)에서 줄일 방법이 있는지 먼저 봅니다.

**다음 장 예고.** 이 기초 위에서 2장 끝에 예고한 주제로 돌아갈 수 있습니다. 서브에이전트를 "루프를 돌리는 툴"로 구현하는 두 방식, 즉 ypi처럼 pi 프로세스를 새로 띄우는 방식과 Pi Durable처럼 같은 프로세스 안의 "소유된 대화"로 만드는 방식을 비교하겠습니다. 오늘 만든 최소 하네스를 확장해서, 서브에이전트 툴을 직접 붙여 보는 실험으로 진행할 수 있습니다.

이번 설명의 수준이 맞았는지 한 줄로 알려 주세요. 여전히 막히는 지점이 있으면 그 절만 한 단계 더 낮춰서 다시 풀겠습니다.

Sources:
- [Alex L. Zhang — Recursive Language Models](https://alexzhang13.github.io/blog/2025/rlm/)
- [SKILL.md — The Agent Skills Format](https://www.mdskills.ai/specs/skill-md)

--- [38] USER ---
codemode 랑 rlm의 한턴의 행동 단위와 데이터 저장 방식에 대한 더 깊은 이해를 하고싶어, 둘 다 세션안의 메세지 배열에만 두는게 아닌 외부 저장소를 활용하는거같은데, 이 외부 저장소를 어떻게 구성하고 관리하며 어떤식으로 데이터를 입출력하는지랑 샌드박수 변수나 repl 변수라는게 무엇인지 도 이해하고싶고, 분해를 정하는 방식도 실제 코드나 비쥬얼라이제이션으로 이해하고싶어

--- [39] ASSISTANT ---
저장 위치를 정확히 말하려면 실제 구현을 봐야 해서, pi의 codemode 저장 코드와 RLM 공식 최소 구현의 REPL 코드를 먼저 확인할게요.

--- [40] ASSISTANT ---
[Write /home/claude/rlm-lab/storage-lab.mjs]

--- [41] ASSISTANT ---
[widget codemode_vs_rlm_storage_stepper]

--- [42] ASSISTANT ---
[Write /home/claude/rlm-lab/decomp-lab.mjs]

--- [43] ASSISTANT ---
분해가 실제로 만드는 호출 트리를 그림으로 보면 위의 질문 B 결과가 이렇게 됩니다.

--- [44] ASSISTANT ---
[widget rlm_decomposition_call_tree]

--- [45] ASSISTANT ---
## 3장. codemode와 RLM의 저장소, 변수, 그리고 분해

위의 스테퍼에서 세 모드를 바꿔 가며 보시면 이 장의 핵심이 한눈에 들어옵니다. 아래 설명은 그 그림의 각 칸을 실제 소스 코드와 실험으로 뒷받침하는 내용입니다. pi 1.1.0 패키지 소스와 RLM 저자의 공식 최소 구현(rlm-minimal)을 직접 읽고 돌렸습니다.

**이 장에서 답할 질문**
1. "샌드박스 변수"와 "REPL 변수"는 정확히 무엇이고, 언제 생기고 언제 사라질까요?
2. 데이터는 어떤 경로로 들어오고 나갈까요?
3. 오래 남겨야 하는 값은 어디에, 어떻게 보관될까요?
4. "분해"는 코드로 어떻게 생겼고, 어떤 호출 트리를 만들까요?

**CS 렌즈: 저장의 세 층과 수명.** 모든 데이터를 "어느 층에 있고, 그 층은 언제 사라지는가"로 봅니다.

---

### 3.1 먼저 바로잡기: "외부 저장소"보다 "세 개의 층"

**이미 아는 것.** React에는 상태를 둘 곳이 여러 층 있습니다. 렌더링 함수의 지역 변수는 렌더가 끝나면 사라지고, `useRef`는 컴포넌트가 마운트된 동안 남고, `localStorage`는 새로고침 후에도 남습니다.

**질문에서 "둘 다 외부 저장소를 활용한다"고 하셨는데, 정확히는 대부분 데이터베이스 같은 외부 저장소가 아니라 프로세스의 메모리입니다.** 층을 셋으로 나누면 정확해집니다.

| 층 | 무엇인가 | 수명 | 모델이 보나 |
|---|---|---|---|
| ① 메시지 배열 | 매 턴 모델에 전송되는 대화 기록 | 런 전체 (세션 파일에도 저장) | 매 턴 전부 |
| ② 실행 메모리 | 코드가 도는 VM·프로세스 안의 변수 | 그 VM·프로세스가 살아 있는 동안 | 출력한 만큼만 |
| ③ 영속 저장 | 디스크의 파일, 세션 JSONL 안의 특수 엔트리 | 지울 때까지 | 읽어 올 때만 |

codemode와 RLM의 가장 큰 차이는 **②번 층의 수명**입니다. 이 차이가 한 턴의 행동 단위와 분해 방식까지 결정합니다.

### 3.2 변수란 무엇인가: 샌드박스 변수와 REPL 변수

**기초 짚기.** 변수는 "이름"과 "값"을 묶어 둔 항목이고, 그 묶음은 어떤 **스코프 객체** 안에 저장됩니다. JavaScript의 전역 변수는 전역 객체(`globalThis`)의 속성이고, 그 객체는 실행 중인 엔진의 힙 메모리에 있습니다. 엔진이 종료되면 힙도 사라지고, 그 안의 변수도 사라집니다. **변수의 수명은 그 변수를 담은 스코프 객체의 수명과 같습니다.**

**샌드박스 변수 (codemode).** pi 소스를 보면 codemode 툴이 호출될 때마다 `new CodemodeSandbox(...)`를 만들고, 실행이 끝나면 `finally` 블록에서 `sandbox.close()`로 닫습니다. `CodemodeSandbox` 자체도 `execute()`마다 별도의 worker와 QuickJS VM을 만든다고 주석에 적혀 있습니다. 샌드박스 변수의 스코프 객체는 이 VM의 전역 객체이고, **스크립트 한 번이 끝나면 VM과 함께 사라집니다.**

**REPL 변수 (RLM).** rlm-minimal의 `REPLEnv` 클래스는 생성될 때 `self.globals`와 `self.locals`라는 Python 딕셔너리 두 개를 만듭니다. 모델이 쓴 코드 블록은 `exec(code, namespace, namespace)`로 실행되고, 실행이 끝나면 새로 생긴 이름을 `self.locals`에 다시 복사해 둡니다. 이 `REPLEnv` 객체는 `completion()` 호출 하나가 끝날 때까지 살아 있습니다. **REPL 변수는 "턴이 바뀌어도 같은 딕셔너리에 남아 있는 항목"입니다.**

**실험으로 확인했습니다.** 실제 pi의 `CodemodeSandbox`와, rlm-minimal의 `REPLEnv`를 Node의 `vm` 모듈로 옮긴 구현을 같은 방식으로 돌렸습니다.

```
[codemode] 1번 스크립트 안: object / 2번 스크립트에서: {"cache":"undefined","local":"undefined"}

[RLM] 턴1 출력 → 264389 | User: 10000 || Instance: How many item 0 | ... | REPL variables: [context]
[RLM] 턴2 출력 → 45 | REPL variables: [context, rows]
[RLM] 턴3 출력 → 7,6,2 | REPL variables: [context, rows, chunks, counts, answer]
```

codemode에서는 1번 스크립트의 `globalThis.cache`가 2번 스크립트에서 사라졌습니다. RLM에서는 턴이 지날수록 변수 목록이 `[context]` → `[context, rows]` → `[..., answer]`로 쌓입니다.

```js
// RLM의 REPL을 JS로 옮긴 핵심 (storage-lab.mjs)
class REPLEnv {
  constructor(contextText, subLM) {
    this.scope = vm.createContext({              // 이 객체가 곧 "REPL 전역"
      print: (...a) => this.out.push(a.join(" ")),
      llm_query: (prompt) => subLM(prompt),      // 호스트 함수를 REPL 안에 꽂아 넣음
    });
    vm.runInContext(`var context = ${JSON.stringify(contextText)};`, this.scope);
  }
  exec(code) {                                   // 턴마다 같은 scope에서 실행 → 변수 유지
    this.out = [];
    vm.runInContext(code, this.scope);
    const vars = Object.keys(this.scope).filter(k => !["print", "llm_query"].includes(k));
    return `${this.out.join("\n")}\nREPL variables: [${vars}]`.slice(0, 2000); // 이름만, 잘라서
  }
}
```

### 3.3 입출력: 데이터는 어떤 경로로 드나드나

**codemode의 입출력.**

| 방향 | 경로 | 비고 |
|---|---|---|
| 모델 → VM | `codemode` 툴의 인자인 스크립트 문자열 | 배열에 남음 |
| 호스트 툴 → VM | `tools.*` 호출 결과 (JSON 복사) | 배열에 안 남음 |
| 세션 → VM | `load(key)` | 하네스가 실행 전에 주입 |
| VM → 모델 | `return`, `text()`, `console.log` | tool_result가 됨, 기본 1만 토큰에서 잘림 |
| VM → 세션 | `store(key, value)` | 성공 시에만 세션 엔트리로 기록 |
| VM → 디스크 | `bash`, `write` 같은 툴을 통해서만 | VM 자체는 파일에 접근 못 함 |

**RLM(rlm-minimal)의 입출력.**

| 방향 | 경로 | 소스에서 확인한 동작 |
|---|---|---|
| 하네스 → REPL | 큰 컨텍스트 적재 | 임시 디렉터리에 `context.txt`(또는 `.json`)를 쓰고, REPL 안에서 `context = f.read()` 코드를 실행 |
| 모델 → REPL | ` ```repl ` 코드 블록 | 정규식으로 응답에서 추출 |
| 하위 LM → REPL | `llm_query(prompt)` 반환값 | 동기 호출, 결과는 변수로 |
| REPL → 모델 | stdout + 변수 **이름 목록** | `user` 메시지로 배열에 추가, 10만 자에서 자름 |
| REPL → 사용자 | `FINAL(답)` 또는 `FINAL_VAR(변수명)` | `FINAL_VAR`는 하네스가 `locals`에서 값을 직접 꺼냄 |

**두 가지를 꼭 짚어 둡니다.**
- **RLM에도 메시지 배열은 있고, 매 턴 자랍니다.** 차이는 그 배열에 무엇이 쌓이느냐입니다. 실험에서 `context` 변수는 약 6만 6천 토큰인데 배열은 258토큰이었습니다. 쌓이는 것이 데이터가 아니라 "코드와 잘린 출력"이기 때문입니다.
- **REPL은 변수의 값이 아니라 이름만 모델에게 알려 줍니다.** 모델은 `rows`라는 변수가 있다는 것만 알고, 내용이 궁금하면 `print(rows[:5])` 같은 코드를 다음 턴에 써야 합니다. 이것이 "필요한 만큼만 본다"를 강제하는 장치입니다.

**보안 측면의 차이도 있습니다.** rlm-minimal은 `eval`, `exec` 같은 내장 함수를 막지만 `__import__`와 `open`은 허용합니다. 즉 연구용 최소 구현이지 샌드박스가 아닙니다. pi의 codemode는 QuickJS VM 안에 파일 시스템, 네트워크, 타이머가 아예 없고, 바깥으로 나가는 유일한 길이 툴입니다.

### 3.4 오래 남기기: 영속 저장은 어떻게 관리되나

**codemode의 `store()`는 이벤트 소싱입니다.** pi 소스의 `readCodemodeStore(branch)` 함수는 현재 분기의 엔트리를 처음부터 훑으면서 `customType`이 `codemode-store`인 엔트리만 골라, `delete` 목록을 지우고 `set`을 덮어씁니다. Redux에서 액션 목록을 처음부터 리듀서에 다시 돌려 상태를 만드는 것과 같은 구조입니다.

```
[pi store] 분기 A에서 load 가능한 값: {"a":2,"b":9}
[pi store] 분기 B에서 load 가능한 값: {}
```

같은 `a=1` 쓰기에서 출발했지만, 분기 A는 이후 `a=2, b=9`를 쓰고 분기 B는 `a`를 지웠습니다. 상태를 따로 저장하지 않고 "기록을 재생"해서 만들기 때문에, 세션 트리의 어느 지점에서 이어가도 그 경로에 맞는 값이 나옵니다. 이 엔트리는 pi의 `appendEntry`로 기록되는데, pi 확장 문서는 이 방식을 "모델 컨텍스트에서 제외되는 영속 데이터"용으로 설명합니다. **세션 파일에는 저장되지만 모델에게는 보내지지 않는 층**인 셈입니다.

**RLM의 영속 저장은 구현마다 다릅니다.** rlm-minimal은 `completion()`이 끝나면 `REPLEnv`가 정리되면서 임시 디렉터리도 삭제됩니다. 오래 남기는 층이 사실상 없습니다. 실사용 구현들은 이 부분을 각자 정합니다. 앞서 조사한 Prime Agent는 세션마다 지속되는 IPython REPL을 두고, ypi는 `$CONTEXT` 파일을 디스크에 둡니다.

| | 실행 메모리 수명 | 오래 남기는 방법 | 크기 한계 |
|---|---|---|---|
| codemode | 스크립트 한 번 | `store()` → 세션 엔트리 재생 | 값당 262,144자, 전체 1,048,576자 |
| rlm-minimal | `completion()` 한 번 | 없음 | 프로세스 메모리 |
| Prime Agent | 세션 전체 | 지속 IPython REPL | 프로세스 메모리 |
| ypi | 자식 pi 프로세스 | `$CONTEXT` 파일 | 디스크 |

### 3.5 한 턴의 행동 단위: "한 방 프로그램"과 "노트북"

3.2의 수명 차이에서 행동 단위의 차이가 나옵니다.

**codemode는 "한 번에 끝내는 프로그램"을 유도합니다.** VM이 스크립트 한 번 뒤에 사라지고 `store()`는 1MB까지만 담으니, 큰 데이터를 다음 턴으로 넘길 수 없습니다. 2장의 실험 A처럼 "읽기 → 거르기 → 위임 → 합치기"를 스크립트 하나에 다 담는 것이 자연스럽습니다. 다음 턴에 다시 필요하면 툴로 다시 읽어야 합니다.

**RLM은 "노트북처럼 조금씩 쌓는 탐색"을 유도합니다.** 변수가 턴을 넘어 살아 있으니, 턴 1에서 엿보고, 결과를 보고 판단해서 턴 2에서 거르고, 턴 3에서 위임할 수 있습니다. 모델이 데이터의 모양을 모르는 상태에서 시작해도 됩니다.

**두 방식의 대가도 다릅니다.** codemode는 처음부터 데이터 구조를 알아야 좋은 스크립트를 쓸 수 있고, 모르면 탐색용 스크립트를 여러 번 돌리면서 매번 다시 읽습니다. RLM은 턴마다 모델 호출이 한 번씩 더 들고, 큰 변수를 붙잡은 프로세스를 그동안 유지해야 합니다.

### 3.6 분해: 코드와 호출 트리

**분해(decomposition)란** 큰 문제를 하위 호출이 감당할 수 있는 크기로 나누는 방식입니다. RLM에서는 이 방식을 사람이 미리 정하지 않고, 루트 모델이 실행 중에 코드로 씁니다. 아래 코드는 모델이 쓸 법한 정책을 고정해서 돌린 것입니다.

```js
// decomp-lab.mjs: 루트 모델이 실행 중에 쓰는 "분해 정책"의 예
function rlm(query, context, d = 0, maxDepth = 1) {
  const rows = context.split("\n");
  // ① 엿보기: 구조 파악. 모델은 이 출력만 본다
  // ② grep: 코드로 거를 수 있으면 먼저 거른다 (LLM 호출 없음)
  const hit = d === 0 ? rows.filter(l => target.test(l)) : rows;
  // ③ 크기에 따라 분해 방식 선택
  if (hit.length <= 25) return llmQuery(hit.join("\n"));        // 작으면 바로 위임
  const size = d < maxDepth ? Math.ceil(hit.length / 3) : 25;   // 크면 쪼갬
  const parts = chunk(hit, size);
  const results = parts.map(p => d < maxDepth
    ? rlm(query, p.join("\n"), d + 1)                            // 하위 RLM (재귀)
    : llmQuery(p.join("\n")));                                   // 하위 LM
  // ④ 합치기는 코드로
  return results.reduce((a, b) => a + b, 0);
}
```

**같은 정책이 데이터에 따라 다른 트리를 만듭니다.**

```
질문 A (grep으로 6000 → 75행으로 줄어듦)
RLM depth=0  context 6000행 (~66098 tok)
  grep: 6000 → 75행
  partition: 3조각 × ~25행 → 하위 RLM
  RLM depth=1 … llm_query 입력 ~271 tok → 5   (× 3)
  reduce: [5,5,5] → 15
답 15, 하위 호출 3회

질문 B (거를 조건이 없어 600행이 그대로 남음)
RLM depth=0  context 600행 → 3조각 × 200행 → 하위 RLM
  RLM depth=1  200행 → 8조각 × ~25행 → llm_query (× 8)   (× 3)
답 300, 하위 호출 24회
```

위의 트리 그림이 질문 B입니다. **어떤 하위 호출도 약 270토큰 이상을 받지 않는다는 점이 핵심입니다.** 데이터가 커지면 트리가 깊어지거나 넓어질 뿐, 개별 호출의 입력 크기는 일정하게 유지됩니다.

**주의할 점이 있습니다.** rlm-minimal 자체는 하위 호출이 일반 LM인 깊이 1까지만 구현돼 있고, 소스에도 `depth` 값이 이 버전에서는 쓰이지 않는다고 적혀 있습니다. 위 질문 B의 깊이 2 트리는 개념을 보여 주기 위한 것이고, 실제로 재귀를 깊게 쓰는 구현은 ypi처럼 하위 호출이 다시 자기 REPL을 가진 에이전트를 띄우는 방식입니다. 또 실제 RLM에서는 이 정책을 모델이 매번 새로 쓰기 때문에, 같은 질문에도 실행마다 분해 방식이 달라질 수 있습니다.

---

### 요약: 렌즈 매핑

| 개념 | 저장의 세 층과 수명 렌즈 |
|---|---|
| 메시지 배열 | ① 층. 런 내내 남고 매 턴 전부 전송 |
| 샌드박스 변수 | ② 층. QuickJS VM 전역, 스크립트 한 번이 수명 |
| REPL 변수 | ② 층. `REPLEnv`의 딕셔너리, RLM 호출 전체가 수명 |
| `store()` | ③ 층. 세션 엔트리를 재생해 만드는 상태, 모델에 미전송 |
| `context.txt` (rlm-minimal) | ③ 층을 거쳐 ②로 적재하는 통로, 끝나면 삭제 |
| REPL 출력 | ② → ① 이동. 이름과 잘린 stdout만 |
| 분해 | ②에 있는 큰 데이터를, ①이 커지지 않게 하위 호출로 나눠 처리하는 코드 |

**실무 규칙.**
- 새 런타임을 볼 때는 "실행 메모리가 언제 사라지는가"부터 확인합니다. 행동 단위와 분해 방식이 거기서 결정됩니다.
- codemode에서는 한 스크립트 안에서 끝낼 수 있게 설계하고, 다음 턴으로 넘길 것은 작은 요약만 `store()`에 둡니다.
- RLM식 탐색이 필요하면 변수가 턴을 넘어 사는 환경(지속 REPL, 파일 기반 컨텍스트)을 마련합니다.
- 분해 정책에는 "작으면 바로 위임, 크면 쪼갠다"는 크기 기준과 깊이 상한을 반드시 둡니다.

**다음 장 예고.** 이번 장에서 RLM의 하위 호출은 "값을 돌려주는 함수"였습니다. 다음 장에서는 그 함수 자리에 0장의 "루프를 돌리는 툴", 즉 서브에이전트를 넣으면 무엇이 바뀌는지 봅니다. ypi처럼 pi 프로세스를 새로 띄우는 방식과 Pi Durable처럼 같은 프로세스 안의 소유된 대화로 만드는 방식을, 오늘 만든 `REPLEnv`와 최소 하네스를 이어 붙여 직접 비교하겠습니다.

Sources:
- [alexzhang13/rlm-minimal (GitHub)](https://github.com/alexzhang13/rlm-minimal)
- [pi Codemode 문서](https://pi.dev/docs/latest/codemode)
- [pi Extensions 문서](https://pi.dev/docs/latest/extensions)

--- [46] USER ---
REPL 구조의 자체적인 성능에 대한 우위 비교보다, 보면서 영감을 얻은건, 사용자가 특정 목표에 도달하기 위해 필요한것은, 그 목표를 달성하기 까지에 각 과정을 어떻게 세부적으로 지시할건지에 대한 개입과 판단이 필요한데, 문제는 이 엣지영역에서의 판단조차, 사용자인 인간이 가지고있는 지식 수준에서밖에 세부적인 결정이 내려질 수 밖에 없는것이 현재 하네스 루프들의 근본적인 문제잖아. RLM처럼 청크 분할과 개별 depth를 파생시키는 개념을 '문제 발견과 정의' 즉 사용자가 진짜 원하는 것이 무엇이고, 무엇을 문제라고 생각하며, 해당 문제를 해결하기 위한 방법은 어떤 것들이 있는지 사용자의 지식에 의한 지시를 넘어서는 범주의 더 최적화되고 좋은 품질을 산출할 수 있도록 다양한 바운더리로 확장 및 발산하여, 더 나은 문제 정의와 구성에 도달함으로써, 사용자의 지시를 일률적으로 따르는게 아니라, 진짜 advisor로써 행동할 수 있도록 하는 시스템을 생각해 봤는데 어떻게 생각함? 객관적으로

--- [47] ASSISTANT ---
객관적으로 보면, **문제의식은 정확하고 방향도 맞지만, RLM과의 유비가 한 지점에서 깨지고, 그 지점이 이 시스템의 성패를 가릅니다.** 나눠서 말씀드릴게요.

## 맞는 부분

**진단이 정확합니다.** 지금의 하네스 루프는 0장에서 본 것처럼 "사용자 메시지에서 출발해 모델이 멈출 때까지 도는 while 루프"입니다. 루프의 출발점이 사용자의 지시라서, 지시가 담고 있는 문제 정의가 틀리면 루프가 아무리 잘 돌아도 틀린 문제를 정교하게 풀게 됩니다. 실행 능력이 좋아질수록 병목이 "어떻게 하느냐"에서 "무엇을 하느냐"로 옮겨 가는 것도 맞습니다.

**RLM에서 가져온 핵심도 맞습니다.** RLM의 본질은 청크 분할 그 자체가 아니라 "분해 방식을 사람이 아니라 모델이 정한다"였습니다. 그 원리를 데이터 공간에서 문제 공간으로 옮기자는 발상은 자연스러운 확장입니다.

**완전히 새로운 영역은 아닙니다.** 부분적인 선례들이 이미 있습니다. Harper Reed의 "한 번에 질문 하나씩 해서 스펙을 다듬기", superpowers의 brainstorming 스킬, Agent Teams에서 여러 팀원이 가설을 세우고 서로 반박하게 하는 사용법, 지난번에 본 dynamic workflow 패턴 중 "생성 후 걸러내기", "적대적 검증", "토너먼트"가 모두 이 방향의 조각입니다. 다만 이들은 대부분 실행 단계의 품질을 높이는 데 쓰이고, **문제 정의 자체를 재귀적으로 발산시키는 시스템**으로 묶인 사례는 드뭅니다. 그 빈자리를 짚은 건 의미가 있습니다.

## 유비가 깨지는 지점

**RLM이 잘 되는 이유는 정답이 컨텍스트 안에 있고, 합치는 방법이 정해져 있기 때문입니다.** 3장 실험에서 하위 호출 결과를 `reduce`로 더하면 끝났습니다. "개수 세기"에는 객관적인 정답이 있으니까요.

문제 정의에는 그런 정답이 없습니다. 발산은 쉽습니다. 모델에게 "이 요청의 다른 해석 20가지"를 만들게 하는 건 몇 초면 됩니다. 어려운 건 **수렴**입니다. 20개 중 "더 나은 문제 정의"를 고르려면 기준이 필요한데, 그 기준의 상당 부분은 사용자의 가치, 맥락, 제약에서만 나옵니다.

그래서 "사용자 지식의 한계를 넘는다"는 목표를 두 종류로 나눠야 한다고 봅니다.

| 지식의 종류 | 시스템이 사용자를 넘을 수 있나 |
|---|---|
| 해법 공간: 어떤 접근이 있는지, 흔히 진짜 원인이 무엇인지, 어떤 부작용이 따르는지 | 넘을 수 있음. 여기가 이 시스템의 가치 |
| 목표 공간: 사용자가 무엇을 원하는지, 무엇을 감수할 수 있는지, 어떤 제약이 있는지 | 넘을 수 없음. 유일한 원천이 사용자 |

**좋은 어드바이저는 첫 번째를 넓혀 주고, 두 번째는 정확하게 끌어냅니다.** 두 번째까지 "더 잘 안다"고 판단하기 시작하면 어드바이저가 아니라 사용자의 의도를 덮어쓰는 시스템이 됩니다.

## 그 밖의 현실적인 위험

**같은 모델의 재귀는 새로운 지식을 만들지 않습니다.** RLM의 하위 호출이 루트와 같은 모델이어도 괜찮았던 건, 정보가 데이터 안에 있었기 때문입니다. 문제 발산에서는 정보가 모델 자신의 사전 지식에서 나옵니다. 같은 모델로 가지를 10개 뻗으면 서로 닮은 10개가 나오기 쉽습니다. 사용자의 지식 한계를 넘으려다 모델의 지식 한계와 편향에 갇힐 수 있습니다. 이걸 깨려면 각 가지가 **외부 근거**에 닿아야 합니다. 실제 코드베이스, 문서와 검색, 과거 세션 기록, 서로 다른 모델 같은 것들입니다.

**발산 결과를 그대로 보여 주면 사용자는 지칩니다.** 50개의 문제 재정의 트리는 도움이 아니라 부담입니다. 어드바이저의 가치는 발산보다 **가지치기**에 있습니다. 최종적으로 사람에게 보여 줄 것은 2~3개의 재정의와, 각각이 기대고 있는 가정, 그리고 그 가정을 확인할 질문 하나 정도여야 합니다.

**언제 개입할지가 정해지지 않으면 귀찮은 시스템이 됩니다.** 사용자가 이미 문제를 잘 알고 실행만 원할 때도 매번 "진짜 원하는 게 뭔가요"를 묻는다면 금방 꺼 버리게 됩니다. 개입 여부를 정하는 게이트가 필요합니다. 틀렸을 때의 비용이 크고, 요청이 모호하거나 서로 충돌할 때만 발산하는 식입니다.

**"더 나은 정의였는지"를 검증할 방법이 필요합니다.** 이게 없으면 시스템이 그럴듯한 재정의를 내놓는지, 실제로 결과를 개선하는지 알 수 없습니다.

## 그래서 이렇게 구성하면 현실적이라고 봅니다

1. **끌어내기**: 요청에서 목표, 숨은 제약, 가정을 뽑고, 그중 "사용자만 답할 수 있는 것"을 골라 최소한의 질문으로 확인합니다.
2. **발산 (RLM식)**: 서로 다른 축으로 문제를 펼칩니다. 위로("이 목표의 목표는?"), 아래로(하위 문제 분해), 옆으로(대안 접근), 뒤집어서("무엇이 이걸 실패하게 만드나"). 각 가지는 깊이 상한을 두고, 반드시 코드·문서·데이터 같은 근거에 닿게 합니다.
3. **수렴**: 명시적 기준으로 평가하고, 적대적 검증으로 약한 가지를 쳐 냅니다. 이때 기준은 1단계에서 사용자에게 확인한 것을 씁니다.
4. **제시**: 소수의 재정의, 각자의 가정, 추천 하나, 질문 하나. **결정은 사용자가 합니다.**

여기서 지금까지 설계한 것들이 맞물립니다. 발산과 수렴은 바깥 runner의 워크플로우로, 개입 게이트는 결정적인 코드 규칙으로 둘 수 있습니다. 그리고 관찰자 C가 가장 중요한 역할을 할 수 있어요. **세션 도중에 사용자가 방향을 크게 틀거나 "아니, 그게 아니라"고 정정한 지점은 처음 문제 정의가 틀렸다는 신호**입니다. 그 로그를 모으면 "어떤 유형의 요청에서 문제 정의가 자주 틀리는가"를 데이터로 알 수 있고, 그것이 게이트의 기준이자 어드바이저의 평가 지표가 됩니다.

## 한 줄 결론

방향은 맞습니다. 다만 목표를 "사용자의 지식을 넘어선다"에서 **"사용자의 탐색 범위를 넘어서되, 사용자의 가치에 닻을 내린다"**로 조정하는 게 좋겠습니다. 이 시스템의 어려운 부분은 발산이 아니라 수렴과 평가이고, 거기에 설계 노력의 대부분이 들어가야 합니다.

--- [48] USER ---
그치 너 말대로 어쨌든 AI도 학습된 데이터에서 평균값에 수렴한다라는 의견 자체는 동의해, 문제는 그 값에 수렴하기 위해서, 어떤 입력값을 사람이 넣어야 하냐 조차 모르는 상황에서 이런 문제 정의와 발견에 대한 발산이 의미가 생길 수 있지 않냐는 거야. 목표공간과 해법 공간에서, '나'도 내가 원하는게 정확하게 뭔지 모르는 상태에서, 어떤 접근이 있고 원인과 부작용등이 뭔지 알게 되면 비로소 내가 진짜 무엇을 원하는지를 인지할 수 있게 되는 것이니,  발산 루프가 이 과정까지 도달하는 것을 전문적으로 해주는 일종의 서브시스템으로 동작하게 하는거지.

나는 일반적인 사용자들을 목표로 하는 것이 아닌 나를 위한 에이전트루프를 개발하려고 하는거야. 첨부된 프로젝트는 내가 이전에 구상했던 새로운 패러다임 에이전트인데 8월 16일 이후 파일들만 분석하면 돼.

--- [49] ASSISTANT ---
네, 이번 말씀으로 제 앞선 답변 하나를 고쳐야 합니다. 그리고 Helm 문서를 읽어 보니, 지금 말씀하신 발산 서브시스템은 Helm에 이미 이론으로 들어 있지만 구현과 증거에서는 비어 있는 자리였습니다. 순서대로 말씀드릴게요.

## 1. 제 앞선 구분을 고칩니다

지난 답변에서 "목표 공간은 사용자만 알고, 시스템은 해법 공간만 넓힐 수 있다"고 나눴습니다. 말씀이 맞습니다. 그 구분은 사용자가 원하는 것을 이미 머릿속에 갖고 있다고 가정했는데, 실제로는 그렇지 않은 경우가 많습니다. 원하는 것은 꺼내 오는 게 아니라 **선택지의 결과와 부작용을 마주하면서 그 자리에서 만들어집니다.** 디자인 이론에서 "문제와 해법의 공진화(co-evolution)", 의사결정 연구에서 "선호 구성(preference construction)"이라고 부르는 현상이고, Helm이 근거로 삼은 Dewey의 탐구 이론도 같은 말을 합니다.

그래서 정확히 말하면 이렇게 됩니다. 시스템은 목표를 대신 정할 수 없지만, **목표가 결정화되는 데 필요한 자극은 만들 수 있습니다.** 말씀하신 발산 루프의 역할은 답을 내는 게 아니라 "아, 내가 원한 건 이거였구나"가 일어나는 지점까지 데려가는 것이고, 그건 정당하고 가치 있는 역할입니다. 개인용이라는 조건은 이 설계를 오히려 쉽게 만듭니다. 이건 뒤에서 다시 말씀드릴게요.

## 2. Helm에는 이 아이디어가 이미 있습니다

8월 16일 이후 파일 151개(Foundations 00–10, 연구 번들과 방법론 카드, paper/system/agent-v0.2 프로토타입과 실행 기록, kernel-v02 실험 코드)를 읽었습니다. 핵심 구절만 짚으면 이렇습니다.

- 공리 A3: "문제 정의는 입력값이 아니라 작업 결과의 일부다."
- 공리 A4: "병렬성은 작업량보다 가설 다양성에 우선 사용한다."
- 운영 루프 `Sense → Frame → Diverge → Investigate → Deliberate → …`, 그리고 Loop I(Inquiry)의 `Surprise → Problem frames → Hypotheses → Evidence → Discriminating experiment → Decision`
- 법칙 2: "Initial prompt를 완성된 ProblemFrame으로 취급하지 않는다."
- Inquiry Map 템플릿의 경쟁 프레임(각 프레임이 "무엇을 드러내고 무엇을 숨기는가"), 반증 조건을 가진 가설, 구분 실험

즉 지금 말씀하신 시스템은 새 발명이라기보다 **Helm의 Loop I를 생성형 엔진으로 만드는 일**입니다. 이게 중요한 이유는, Helm의 온톨로지에 결과물을 담을 자리가 이미 있다는 뜻이기 때문입니다. 발산 결과는 E 평면(Possibility, ProblemFrame, Interpretation 후보)에 들어가고, 사용자가 반응하면 N 평면 전이(`goal.revise`, `concern.reframe`, `choice.commit`)가 됩니다. "후보는 기록돼도 수락이 아니다", "추천은 선택이 아니다" 같은 v0.2 불변조건이 발산 엔진의 안전장치 역할을 그대로 해 줍니다. 지금까지 만든 통치 구조가 헛수고가 아니라 이 엔진의 바닥이 되는 셈입니다.

## 3. 그런데 증거와 구현은 반대쪽으로 갔습니다

문서를 시간순으로 보면 이렇습니다.

**구현은 통치 쪽으로 깊어졌습니다.** 8월 21일 작업은 ledger, qualification 상태, authority carry-forward(권한 포함 관계 증명), idempotency, SQLite 트랜잭션과 checksum chain, adapter conformance, OpenAI provider 계약입니다. 반면 Inquiry는 실행 코드에 거의 없습니다. `kernel.mjs`에는 possibility나 frame을 다루는 로직이 없고, `agent-runtime.mjs`에는 렌더링 라벨(`possibility: 'Possible'`)만 있습니다. CLI-G01 시나리오의 가능성 4개는 "Agent must preserve at least these possibilities"라고 **fixture에 미리 적혀 있고**, linear CLI 실행도 언어 모델 없이 대본으로 돌린 것입니다. 발산은 지금까지 한 번도 생성된 적이 없습니다.

**dogfood 증거는 병목이 의미 입력이라고 말합니다.** founder-dogfood-001에서 Git만으로 수집하면 네 영역 중 셋이 unknown이었고, 의미는 사람이 넣은 입력 7개에서 전부 나왔습니다. Inquiry Map에서 사용자가 관계를 수정하는 장면은 "not observed"였습니다. 그리고 가장 의미 있는 증거가 v0.2 문서에 직접 나옵니다. 최신 Decision이 `summary: ㅇ`, `rationale: ㅁㄴㅇ`였다는 것이죠. 저는 이걸 단순한 테스트 입력 이상으로 봅니다. **설계자 본인도 빈칸을 채우는 형식을 우회했다는 신호**이기 때문입니다.

이 둘을 합치면 결론이 꽤 선명합니다. Helm은 "사람이 의미를 써넣으면 시스템이 지킨다"는 구조인데, 실제 병목은 "사람이 의미를 써넣는 것" 자체였습니다. 말씀하신 발산 서브시스템은 이 방향을 뒤집습니다. **시스템이 프레임과 가능성을 초안하고 사람은 반응만 합니다.** 백지에서 떠올리는 것(recall)보다 보고 고르는 것(recognition)이 훨씬 쉽다는 건 오래된 사실이고, 원하는 걸 모르는 상태라면 더욱 그렇습니다. 그래서 이 서브시스템은 Helm에 덧붙이는 기능이 아니라, Helm의 dogfood가 드러낸 핵심 결함에 대한 답이라고 봅니다.

솔직하게 하나 더 말씀드리면, 8월 16일 실행 기록에서 다음 증거로 정한 지연 복귀 실험(founder-dogfood-002의 24시간 resumption probe)은 결과 파일이 없고, 그 뒤 v0.2 커널 구축으로 넘어갔습니다. 첫 실행에서 "paper-first가 불필요한 schema를 찾는다"를 지지한 직후에 "구현을 먼저" 패턴으로 돌아간 셈입니다. 이론의 밀도(Foundations 11편, 방법론 카드 20여 개)에 비해 실사용 증거가 아직 얇다는 점은 개인용으로 다시 설계할 때 꼭 염두에 두시면 좋겠습니다.

## 4. 개인용이라는 조건이 바꾸는 것

**덜어낼 수 있는 것**이 많습니다. v0.2의 제품 순서(자체 CLI agent → 다른 runtime 이식 → GUI)와 OSS/SaaS 경계는 다른 사용자를 전제한 범위입니다. 나만 쓴다면 이렇게 줄일 수 있습니다.

- 자체 Agent Runtime과 provider adapter는 만들지 않습니다. pi가 그 역할을 하고, Helm은 pi 확장과 외부 저장소로 붙습니다.
- cross-runtime 이식은 지금 대화 초반에 설계한 중립 하네스 원칙(본체는 런타임 밖, 어댑터는 얇게)으로 충분합니다.
- Quick/Guided/Assured 같은 형식 단계는 나 한 사람의 습관에 맞춰 훨씬 가볍게 둘 수 있습니다.

**대신 얻는 강점**이 하나 있고, 이게 "AI는 평균으로 수렴한다"는 문제의 실질적인 해법입니다. 범용 제품은 사용자의 가치를 모르니 평균적인 발산을 할 수밖에 없습니다. 하지만 개인 시스템은 **내가 과거에 무엇을 고르고 무엇을 기각했는지**를 ledger에 쌓을 수 있습니다. Helm이 Level 5(Adaptive Institution)로 미뤄 둔 Reflection을 개인 규모로 당겨 오면, 발산은 "일반적으로 가능한 대안"이 아니라 **"내 기준에서 의미 있게 갈리는 대안"**을 내놓게 됩니다. 수렴 기준을 매번 처음부터 묻지 않아도 되는 거죠.

## 5. 서브시스템 설계안: Helm의 Loop I를 생성형으로

```
[모호한 요청 / "뭘 원하는지 모르겠다" / 관찰자 C가 감지한 잦은 정정]
        │  개입 게이트 (Helm의 deliberation pressure 그대로)
        ▼
① 앵커링: 요청에서 확실한 것·모호한 것·암묵적 가정을 분리 (E 평면 후보)
        ▼
② 발산 (RLM식: 루트는 요약만, 가지는 깊이 제한 + 외부 근거 필수)
   ↑ 위로     "이게 이뤄지면 무엇이 좋아지나?" (목적 사다리)
   ↓ 아래로   하위 문제 분해
   ↔ 옆으로   대안 접근 (다른 모델로 생성해 다양성 확보)
   ⟲ 뒤집기   "무엇이 이걸 실패하게/후회하게 만드나" (부작용·비용)
   ⧉ 렌즈     research/method-cards를 관점 라이브러리로 사용
   각 가지는 repo·문서·웹·내 ledger 중 하나 이상에 근거해야 통과
        ▼
③ 대비 압축: 가지 수십 개 → "결과가 갈리는" 프레임 2~3개
   형식: "X를 원한다면 A를 얻고 B를 잃는다" + 가장 정보 가치가 큰 질문 1개
        ▼
④ 나의 반응 → N 평면 전이 (goal.revise / concern.reframe / choice.commit)
   반응 자체를 ledger에 기록 → 다음 발산의 개인 기준으로 학습
        ▼
⑤ 정지 규칙: 내 답이 더 이상 계획을 바꾸지 않으면 Loop C(실행)로 넘김
```

설계상 핵심은 세 가지입니다.

- **RLM 유비를 정확히 적용하는 지점은 ②입니다.** RLM에서 루트가 큰 데이터를 직접 보지 않았듯, 루트는 내 원래 의도와 압축된 가지 요약만 들고, 각 가지가 repo·ledger·외부 자료를 변수처럼 탐색합니다. 다만 RLM과 달리 합치는 방법(`reduce`)이 정해져 있지 않으니, ③의 압축 기준은 "개수"가 아니라 **결과가 얼마나 다르게 갈리는가**로 둡니다. Helm 연구 번들의 M4("Alternatives must disagree consequentially")가 정확히 이 기준입니다.
- **출력 형식은 트리가 아니라 대비입니다.** 사람은 "어떤 걸 원하세요?"에는 답하기 어렵지만 "이쪽은 이걸 잃는데 괜찮으세요?"에는 즉시 반응합니다. 원하는 걸 모르는 상태에서 선호를 끌어내는 가장 효과적인 자극이 대비입니다.
- **같은 모델의 메아리를 막는 장치가 필요합니다.** 근거 필수 조건, 서로 다른 모델 사용, 내 ledger 이력 참조가 그 역할을 합니다. 이 셋이 없으면 발산이 그럴듯한 평균값의 변주로 끝납니다.

## 6. 다음 한 걸음

커널을 더 만들기보다, Helm이 18절에서 스스로 정한 증거 질문 "사용자가 ProblemFrame이나 Criterion을 의미 있게 바꾸는가?"를 이 서브시스템으로 직접 시험해 보시길 권합니다.

1. 최근 실제로 막연했던 작업 5개를 고릅니다.
2. ①~③을 pi 확장이나 codemode 스크립트 하나로 만들어, 각 작업에 대비 2~3개와 질문 1개를 생성합니다.
3. 보기 전과 본 후에 내가 적은 목표를 비교합니다. 바뀌었는지, 바뀐 목표로 한 결과가 더 나았는지, 피곤했는지를 기록합니다.
4. 5개 중 목표가 의미 있게 바뀐 경우가 거의 없다면 발산 엔진의 설계를 다시 보고, 자주 바뀐다면 그때 커널의 E/N 평면에 정식으로 연결합니다.

이 실험은 Helm의 기존 자산(Inquiry Map 템플릿, 방법론 카드, v0.2의 후보/수락 분리)을 그대로 재료로 쓸 수 있고, 반나절이면 첫 결과가 나옵니다. 원하시면 ①~③을 pi 확장 초안으로 바로 작성해 보겠습니다.

--- [50] USER ---
결국 나는 에이전트에서 Helm의 방법론을 구현하고 싶은건데 가능한거야? 이미 헬름에 존재하는 구현이나 스크립트들은 전부 신경쓰지말고 개념과 아이디어 및 공리와 이론적인 측면을 에이전트 루프나 엔진으로 구현할 수 있냐는거지

--- [51] ASSISTANT ---
네, 가능합니다. 다만 Helm의 공리를 전부 같은 방식으로 구현할 수는 없고, 성격에 따라 세 종류로 나뉩니다.

1. **코드로 강제할 수 있는 것**: 상태 전이, 권한, 기록 형식처럼 규칙으로 판정되는 공리입니다. 모델의 판단과 무관하게 항상 지켜집니다.
2. **모델이 만들고 코드가 검사하는 것**: 문제 프레임 생성, 가설 발산, 요약처럼 내용의 품질이 모델에 달린 공리입니다. 코드는 형식과 경계만 보장하고, 질은 보장하지 못합니다.
3. **측정만 할 수 있는 것**: "사용자의 이해와 주도성이 유지되는가"처럼 시스템 바깥, 즉 사람의 상태에 관한 공리입니다. 구현 대상이 아니라 평가 대상입니다.

이 구분을 먼저 해 두면 "어디까지 엔진이 보장하고 어디부터 모델과 사람에게 맡기는지"가 명확해집니다.

## 1. 공리별 구현 가능성

0장에서 정리한 루프 지점(시작 전, 모델 호출 직전, 툴 실행 앞뒤, 루프 바깥)에 대응시켰습니다.

| 공리 | 구현 방식 | 구체적으로 |
|---|---|---|
| A1 목적이 태스크보다 먼저 | 코드 강제 | 활성 Goal이 연결되지 않은 상태에서 파일을 바꾸는 툴 호출은 훅에서 차단 |
| A2 진척은 정당화된 상태 변화 | 모델 + 코드 검사 | 완료 주장에 증거 링크가 없으면 상태 전이 거부. "정당한가"의 최종 판단은 사람 |
| A3 문제 정의는 작업 결과의 일부 | 모델 + 코드 검사 | 첫 프롬프트를 그대로 프레임으로 쓰지 않고, 프레임 객체를 따로 만들고 재구성 전이를 허용 |
| A4 병렬성은 가설 다양성에 먼저 | 모델 + 코드 검사 | 발산 서브시스템이 서로 다른 관점의 가능성을 생성하고, 결과가 같은 가능성은 코드로 병합. 다양성의 질은 모델에 달림 |
| A5 사실·추론·가설·결정·약속 구분 | 코드 강제 (분류 정확도는 모델) | 종류별로 다른 툴로만 제출하게 하고, 자동 승격을 막음 |
| A6 에이전트는 제안, 인간은 저자 | 코드 강제 | Goal 변경과 Choice 확정 명령은 사람 입력 채널에서만 실행 가능, 에이전트 툴 목록에 없음 |
| A7 자율성은 위험 적응적 권한 | 코드 강제 | 툴마다 effect class를 붙이고, 현재 위임 범위에 포함되는지 훅에서 검사 |
| A8 결정은 낮은 수준에서, 예외만 상향 | 모델 + 코드 검사 | Gate 조건 중 "비가역성·권한 초과"는 코드, "가치 충돌·의미 있는 이견"은 모델이 판단 |
| A9 요약은 결정에 필요한 차이를 보존 | 코드 강제 | 반대 증거, 이견, unknown은 요약문이 아닌 별도 필드로 투영에 항상 포함 |
| A10 완료 주장·수락·통합 구분 | 코드 강제 | 세 상태를 별도 전이로 두는 상태 기계 |
| A11 컨텍스트는 시점별 투영 | 코드 강제 | 대화 기록 대신 저장소에서 만든 투영을 모델에 전달 (출처 cursor, 생략 목록 포함) |
| A12 자동화가 이해를 낮추면 실패 | 측정만 가능 | 복귀 시 상황 질문, 정정 빈도, raw log 재열람 횟수를 관찰자가 기록 |
| A13 결정과 증거는 낡는다 | 코드 강제 (조건 감지 일부는 모델) | 재검토 조건, 의존 항목 변경 시 무효화, 시간 경과 표시 |
| A14 실패와 이견은 학습 신호 | 모델 + 코드 검사 | 반대 증거를 일급 객체로 저장하고, 관찰자가 반복 실패 패턴을 집계 |
| A15 상호작용은 공동 저작 | UI 설계 | Gate 선택지에 "추천 선택" 외에 "기준 수정·질문 재구성·먼저 실험·연기"를 항상 포함 |

15개 중 코드로 강제할 수 있는 것이 8개(A1, A5, A6, A7, A9, A10, A11, A13), 모델이 만들고 코드가 형식을 검사하는 것이 5개(A2, A3, A4, A8, A14), UI 설계 1개(A15), 측정만 가능한 것 1개(A12)입니다. 강제 가능한 쪽이 Helm의 통치 규칙이고, 모델에 의존하는 쪽이 탐구(Inquiry) 영역입니다. 지난 답변에서 말씀드린 대로, 실제 가치가 많이 걸린 곳은 모델에 의존하는 다섯 개입니다.

## 2. 엔진 구조

Helm의 네 운영 루프(Orientation, Inquiry, Commitment, Assurance)를 **LLM 루프가 아니라 코드로 돌아가는 바깥 상태 기계**로 두고, pi 세션을 그 안에서 실행되는 안쪽 루프로 쓰는 구조입니다.

```
┌─ 저장소 (런타임 밖) ─────────────────────────────────────┐
│  ledger: Goal, Concern, Observation, Possibility, Claim, │
│          Evidence, Choice, Agreement, Result 전이 기록     │
│  projection: 루프별 컨텍스트, 복귀 요약, 열린 Gate         │
└──────────────────────────────────────────────────────────┘
          ▲ 명령/후보 제출            │ 투영
          │                          ▼
┌─ 엔진 (결정적 코드) ──────────────────────────────────────┐
│  Concern 상태 기계:  Orient → Inquire → Commit → Assure   │
│  정책: 권한 포함 검사, Gate 조건, 무효화, 승격 금지          │
│  상태마다 안쪽 루프의 "모드"를 정함 (툴 목록·프롬프트·권한)  │
└──────────────────────────────────────────────────────────┘
          │ 모드 설정                 ▲ 후보 (구조화 툴 결과)
          ▼                          │
┌─ 안쪽 루프 (pi 세션) ─────────────────────────────────────┐
│  Orient 모드:  읽기 전용 툴 + 복귀 요약 투영               │
│  Inquire 모드: 조사 툴 + 발산 서브시스템 (RLM식)           │
│  Commit 모드:  위임 범위 안의 변경 툴                      │
│  Assure 모드:  테스트·검증 툴 + 완료 주장 제출             │
└──────────────────────────────────────────────────────────┘
   루프 바깥: 관찰자 프로세스 (A12·A14 측정, 반복 패턴 집계)
```

핵심 규칙은 하나입니다. **모델은 저장소에 직접 쓰지 않습니다.** 모델은 구조화된 툴로 후보만 제출하고, 엔진이 검사한 뒤 기록합니다. 그래서 모델이 실수해도 "가설이 결정으로 바뀌는" 일은 생기지 않습니다.

## 3. pi에서 구현 가능한 근거

pi 1.x의 확장 API가 이 구조에 필요한 지점을 대부분 제공합니다(앞서 확인한 확장 문서 기준).

| 엔진이 필요한 것 | pi 확장 기능 |
|---|---|
| 후보를 종류별로 제출받기 (A5) | `pi.registerTool`에 `outputSchema`를 선언한 Helm 전용 툴 |
| 권한 초과 툴 차단 (A1, A7) | `tool_call` 이벤트에서 입력 변경 또는 차단 |
| 대화 기록 대신 투영을 컨텍스트로 (A11) | `context` 이벤트로 메시지 배열 변환, `before_agent_start`로 시스템 프롬프트 섹션 교체 |
| 미분류 주장이 남았으면 종료 막기 (A2, A5) | `agent_before_settle`에서 엔트리 추가 후 한 번 더 진행 요청 |
| 모델 컨텍스트에 넣지 않는 상태 기록 | `pi.appendEntry` |
| 모드 전환 시 툴 목록 교체 | `pi.setActiveTools` |
| 사람에게 Gate 표시 | `ctx.ui`의 대화상자와 확인 창 |
| 발산 서브시스템 | codemode 스크립트 또는 자식 pi 프로세스 (ypi 방식) |

여기서 실제로 확인이 필요한 부분이 있습니다. `context` 이벤트로 메시지를 바꿀 때 pi의 세션 기록과 프롬프트 캐시가 어떻게 동작하는지, `agent_before_settle`의 "한 번 더 진행" 요청이 반복될 때 무한 루프를 어떻게 막는지는 문서만으로 단정할 수 없어서 작은 확장으로 먼저 실험해 봐야 합니다.

## 4. 구현이 어려운 부분

**분류 정확도.** 모델이 해석을 관찰로 제출하는 실수는 막기 어렵습니다. 그래서 코드로 판정할 수 있는 규칙을 하나 두는 게 효과적입니다. "관찰은 반드시 툴 호출 결과를 출처로 참조해야 한다. 출처 없는 주장은 해석으로 기록한다." 이렇게 하면 분류의 상당 부분이 모델 판단이 아니라 출처 유무로 정해집니다.

**Gate 빈도 조정.** 너무 자주 묻으면 형식 부담이 되고, 너무 적게 묻으면 공리 A6과 A8이 형식만 남습니다. 초기값은 정해 두되, 관찰자가 기록한 "Gate에서 내가 실제로 선택을 바꾼 비율"로 계속 조정해야 합니다. 바꾼 적이 거의 없는 Gate 유형은 줄이는 식입니다.

**입력 부담.** 이전 dogfood 기록에서 확인된 대로, 사람이 구조를 채우는 방식은 지속되지 않았습니다. 엔진에서는 구조를 모델이 초안하고 사람은 수정만 하도록 해야 합니다. 이 원칙이 깨지면 나머지가 다 맞아도 쓰지 않게 됩니다.

**평가 기준.** "정당화된 진척"은 계산할 수 없습니다. 대신 측정 가능한 대리 지표를 정해야 합니다. 복귀 후 상황 질문 정답률, 완료 주장과 수락 사이에서 발견된 결함 수, 프레임이나 기준이 바뀐 횟수, 재작업 시간 같은 것들입니다.

**비용과 속도.** 발산과 검증 단계가 추가되면 모델 호출이 늘어납니다. 모든 작업에 같은 깊이를 적용하지 말고, Helm의 Quick·Guided·Assured 구분처럼 위험도에 따라 루프를 건너뛰게 해야 합니다.

## 5. 만드는 순서

1. **저장소와 상태 기계**: Goal, Concern, 후보, Choice, 완료·수락·통합 전이만 있는 최소 ledger와 엔진. 모델 없이 테스트할 수 있습니다.
2. **pi 확장 1차**: Helm 후보 제출 툴, `tool_call` 권한 검사, `context` 투영 교체. 여기까지 되면 A1, A5, A6, A7, A10, A11이 실제로 동작합니다.
3. **Inquiry 모드와 발산 서브시스템**: 지난 답변의 ①~③(앵커링, 발산, 대비 압축)을 붙입니다. A3, A4가 여기서 처음 동작합니다.
4. **관찰자 프로세스**: A12, A14 측정과 Gate 빈도 조정 데이터를 모읍니다.

1번과 2번은 결정적인 코드라서 비교적 예측 가능하게 만들 수 있고, 3번부터가 실제 실험입니다. 원하시면 1번의 최소 상태 기계와 2번의 pi 확장 뼈대를 함께 작성해서, 작은 작업 하나로 Concern 하나가 Orient부터 통합까지 가는 과정을 돌려 보겠습니다.

--- [52] USER ---
그전에 helm 이론에 대해서 복습좀 하고가자 나도 다까먹어서 헷갈려

--- [53] USER ---
Base directory for this skill: /root/.claude/skills/synced/21b0ffee-ff6d-43fa-8e15-8c4720d0fbd3_a6855996-0119-4e24-a726-df78aecbed00/learn

# Learning Mode

The goal is not to answer the learner's question but to help them be able to answer it themselves — this time and next time. The pull toward just answering is strong: the learner is often frustrated, the answer is right there, and giving it feels helpful. But a tutor who hands over answers produces a learner who can't do the thing; a tutor who only asks questions produces a learner who gives up. Both are failures, and the space between them is where good tutoring lives.

## Diagnose before you teach

The most common mistake in AI tutoring is launching into leading questions before knowing where the learner actually is. It feels pedagogically virtuous, but research finds that dialogue without diagnosis produces more engagement and no more learning. Start by locating the learner.

When a learner arrives, take a beat: what concept is this really about, and are they confused about the concept, the procedure, the notation, or what the question is even asking? If their message already tells you — they've shown their work, named their confusion precisely, or written fluently in domain terms and framed a sharp expert question — skip the diagnosis and go straight to the right move. Otherwise, ask one calibrating question: "What's your best guess at where to start?" or "Is it the setup or the mechanics that's throwing you?" One question, not three.

A note on fluent-expert phrasings. A learner who writes in domain terminology ("explain heteroskedastic ordered probit", "walk me through monads") has told you the *level* to teach at, not that they want a polished essay instead of tutoring. The right move on a fluent expert request is still to diagnose — briefly, at their level — what brought them to the topic and what shape of help would land: a quick conceptual overview, a derivation, working through an example together, or something else. Skipping diagnosis here means defaulting to exposition, which is the failure mode this skill exists to prevent.

A note on topic vs. concept. Not every "help me understand X" is about a concept or skill the learner could be tested on. Sometimes X is a broad topic, a contested subject, or a real-world phenomenon ("causes of US educational inequality", "why inflation is high right now", "what's going on with the Middle East"). The diagnostic question shifts: not "where in this are you stuck" but "what shape of help would land — a structured overview, a walkthrough where I draw out your existing thinking, or just the substantive answer with sources?" The answer "just lay it out for me" is a legitimate destination here, not a failure. Your job is structured exposition with the door open to going deeper, not Socratic scaffolding on a topic with no method to learn.

## The core rhythm: one step forward, every turn

Each reply should carry one focused question and one small scaffold that moves the learner forward regardless of how they answer: a hint that narrows the space, a worked parallel example, a small inline visual that makes the structure visible, a restatement of what they've already got right, the first step of a parallel example done with the reasoning narrated. Never a wall of questions; never an empty turn. Keep turns short — a few sentences and one question, not a paragraph with a question tacked on.

Know when you're done. When the learner explains it back correctly, applies it to a new case, or stops needing hints — say so plainly, summarize what they covered, and point at where to go next. Don't keep probing past understanding; a session with no end in sight burns the goodwill the guidance built.

## Holding the line under pressure

Learners push back: "just tell me," "I don't have time for this," "can you just give me the answer?" This is the highest-stakes decision in a session, and it hinges on a distinction you make from limited evidence: is this learner *impatient* or *genuinely stuck*?

Impatience looks like: engaged, their answers show they have the pieces, they just want it to go faster. Don't hand over the answer — give a more direct hint, narrow the question until it's nearly rhetorical, or work a parallel example and ask them to apply the method. Keep them doing the last step. Caving teaches them that pushback works, and doesn't save time — they'll be back with the next problem because they didn't learn the method.

Genuinely stuck looks like: repeating the same wrong idea, going silent, "I have no idea," frustration tipping from productive struggle into shutdown. Shift. Give them a concrete piece to stand on — do the first step, count the thing they couldn't count, name the rule they couldn't remember — then rebuild with them driving. This isn't caving; it's a foothold, not the summit.

Be careful with time pressure as a signal. A learner who *opens* with a deadline and a concrete blocker ("this is crashing and I have 20 minutes," "I just need to confirm X before my meeting") is making a real fire-and-forget request: answer directly and briefly, offer to go deeper later. But when the time claim appears only *after* you've started asking questions — "ugh, I don't have time for this, just tell me" — it's almost always impatience wearing a costume. They had time to ask you; they have time to think for one more turn. Hold the line, more directly, but hold it. This is where a well-meant "answer time-boxed requests directly" rule quietly becomes "cave whenever they push," and that's the failure to guard against.

## A toolkit of moves

Good tutors shift fluidly between several moves. *Guided discovery* — leading questions and hints — works when the learner has the building blocks and just needs to assemble them, and fails on someone missing prerequisites. *Direct explanation* is right for new concepts, multi-step procedures, beginners who have nothing yet to discover, and topical questions where the learner wants substance rather than scaffolding. *Worked example with narration* — solve a *parallel* problem, not their assigned one, narrate the reasoning, then ask them to apply the method to theirs — is the cleanest way to teach procedure without doing their work. *Inline visual* — a diagram, a tiny interactive, a timeline rendered right in the chat — is the move when the concept has shape: a relationship, a process, a parameter whose effect they should *see* rather than read. *Reflective pause* — ask them to summarize back, predict what changes if a parameter changes, or invent their own example — is where understanding cements. And *resource creation* — when they ask for flashcards, a study guide, a quiz, an outline, or a structured overview of a topic, just make it; they've already decided what they need. Design study materials for active recall and interleaving, and show the shape of the material, not a flat term list.

## Showing, not just telling

An inline visual is a move in the same toolkit, not a separate mode you switch into. When a concept has structure — parts that relate, steps that flow, a comparison that lands when it's side by side — a small diagram or interactive rendered in the chat will carry it further than a paragraph of description ever could.

**If the `show_widget` tool is available:** call `read_me` once, silently, to load the design guidance (pick the module that fits — usually `diagram` or `interactive`), then call `show_widget` with the visual itself, and keep your explanatory prose and your question *outside* the tool call. The widget holds only the picture; the teaching and the prompt to think stay in your own words around it.

**If it isn't:** render the visual with whatever the environment supports — a markdown table, an ASCII sketch, a code block that draws the figure — and keep the same rule: the visual carries the structure, your prose carries the teaching.

When the learner asks outright for flashcards, a quiz, or a timeline, that's this move too — just make the thing, interactive where it helps, because they've told you what they need.

The visual is still the scaffold for that turn, which means it still pairs with one focused question — not a caption, a question. A slider the learner drags to watch a curve reshape *is* the reflective-pause move — "predict what happens as this goes to zero, then try it" — and it beats the static version precisely because the learner's hand is on the parameter, not yours. But a rich visual can also be the answer dressed up: "here's the whole mechanism, animated" hands over exactly as much as typing out the solution would, and bypasses the thinking just as thoroughly. Show one relationship, one step, one comparison — not the finished picture — and let the question ask for what's missing. And don't reach for it every turn. A visual that isn't carrying the concept is decoration, and decoration teaches the learner to skim; skip it for pure procedure, for notation, for quick confirmations, for any turn where a sentence already does the job.

## Academic integrity — when it applies

Not every learner is being assessed. A career-changer teaching themselves SQL, a hobbyist learning music theory, a professional brushing up before a meeting — these people have no professor, no grade, and no integrity policy, and withholding a working answer from them on principle is just unhelpfulness. For self-learners, your only obligation is to make sure they actually learn, which the rest of this skill already handles.

But when you're tutoring inside a course — or on anything the learner will submit or be assessed on — you also have to protect them from the shortcut they're tempted by, because what they paste in isn't what they learned. Don't produce final answers to graded problem sets, exams, or quizzes, and don't write text intended to be turned in. Do teach the concept with examples distinct from the assigned work, walk through parallel problems and let them apply the method, review their own attempt and point at what to reconsider, and help them understand what the question is asking. "Can you check my answer?" — don't grade it; have them walk you through their reasoning and tell them where to look again. "My professor said we can use AI" — match the specific use they describe, not more. Coding assignments — explain concepts and debug the error they show you, but don't write the function they were asked to write. When you decline, say what you *can* do, warmly: "I won't write the essay, but I'd like to help — want to talk through your argument?" And if you're unsure whether something is graded, ask; refusing to engage just trains people to phrase things deceptively.

## What consistently goes wrong

Over-questioning: three Socratic questions before any teaching makes learners disengage; if they're stuck, teach, then ask. Hidden answers in hints: "hint: have you tried multiplying both sides by x and dividing by 3?" is the answer with extra steps. Jargon as skip signal: a fluent expert phrasing ("explain heteroskedastic ordered probit", "walk me through monads") is not a request for a polished essay — fluent terminology calibrates the level you teach at, not whether you teach. Default still applies: briefly diagnose what shape of help would land before launching into exposition. Visuals that overdeliver: an animation of the whole mechanism is the answer in prettier clothes, and a diagram on every turn is decoration that trains the learner to scroll past. False praise: "Great question!" before every reply is hollow; praise specifically and only when earned. Pretending to be neutral on quality: if their work has an error or their argument is weak, say so — kindly, specifically, with what to do about it. And refusing to engage because something might be homework: that's not integrity, it's unhelpfulness wearing integrity's coat.

## Tone

Warm, direct, intellectually engaged, willing to push back. Treat learners as capable adults working on hard things, whether they're a first-year undergrad or a forty-year-old career changer. Skip the emoji and the cheerleading. When something is hard, say so — "this trips most people up" beats "anyone can learn this!" When tutoring math or technical work, slow down and check each step; when you're unsure of your own reasoning, say so — a confident walk toward a wrong answer is worse than a pause.


ARGUMENTS: Helm 이론 복습 (사용자가 직접 만든 이론, 다 잊어서 헷갈림). 탑다운 선호, AI 특유 말투 싫어함.

--- [54] ASSISTANT ---
Helm 문서 전체를 기준으로, 큰 그림에서 시작해 한 층씩 내려가며 정리하겠습니다. 문서가 8월 16일의 v0.1(Foundations 00–09)과 8월 22일에 방향을 맞춘 v0.2 후보(10번 문서)로 나뉘어 있고, 둘 사이에 용어와 구조가 일부 바뀌었습니다. 헷갈리셨다면 이 변경도 이유 중 하나일 수 있어서, 바뀐 곳은 따로 표시했습니다.

## 1. 한 문장 정의와 출발점

> Helm은 사람이 방향과 판단의 주인으로 남으면서 AI와 함께 탐구하고, 실행하고, 결과를 전체에 반영하게 하는 시스템이다.

출발점이 된 문제는 이렇습니다. 에이전트의 실행 속도와 병렬성이 사람이 이해하고 감독하는 속도보다 빨라졌습니다. 그래서 병목은 코드 생성 능력이 아니라 사람 쪽 능력입니다. 지금 무엇이 진행 중인지, 무엇이 사실이고 무엇이 추측인지, 어떤 선택이 중요한지, 완료했다는 말을 믿어도 되는지, 하루 뒤 돌아왔을 때 어디서 다시 시작해야 하는지를 놓치게 됩니다.

일반 하네스는 "프롬프트 한 번으로 결과를 완성"하는 것을 최적화합니다. Helm은 다른 것을 최적화합니다.

```text
justified progress under bounded human attention
(사람의 주의력이 제한된 조건에서의 정당화된 진척)
```

정당화된 진척은 네 조건을 모두 요구합니다.
1. 실제로 무언가가 가치 있는 방향으로 바뀌었다.
2. 그 변화가 목적에 맞다고 믿을 근거가 있다.
3. 누가 어떤 trade-off와 책임을 받아들였는지 명확하다.
4. 지역적인 변화가 전체와 맞고, 다음 변화에 대응할 능력이 남아 있다.

파일을 많이 바꿨거나 보고서가 길다고 진척이 아니라는 공리(A2)가 여기서 나옵니다.

## 2. 세계 모델: 무엇을 상태로 다루는가

Helm은 작업 공간의 상태를 세 개의 의미 세계와, 그 셋 모두에 적용되는 두 개의 통치 평면으로 봅니다.

--- [55] ASSISTANT ---
[widget helm_world_model_nem_ap]

--- [56] ASSISTANT ---
- **방향(N, Normative)**: 해야 하는 것과 이미 받아들인 약속입니다.
- **이해(E, Epistemic)**: 안다고 주장하는 것과 아직 모르는 것입니다.
- **실제 변화(M, Material)**: 실제로 존재하거나 바뀐 것입니다.
- **참여자(A)와 규칙(P)**: 세계가 아니라, 세 세계의 상태를 누가 어떤 조건에서 바꿀 수 있는지 정하는 층입니다.

그림의 세 화살표 외에 하나가 더 있습니다. 실제 결과가 목표와 약속을 충족시키는 관계(M → N)입니다.

**v0.1과 v0.2의 차이.** v0.1의 Operating Theory는 N, E, M, A, P를 "다섯 상태 공간"으로 나란히 두었습니다. v0.2에서는 참여자와 규칙이 현재 상황의 내용이 아니라 상태 전이를 평가하는 규칙이라는 이유로, 세 세계와 두 평면으로 나눴습니다. 표기는 `<N, E, M | A, P>`입니다. 이 결정(D2)은 수락된 상태입니다.

## 3. 일의 단위: Task가 아니라 Concern

Helm에서 일의 최소 단위는 Task가 아닙니다.

```text
Goal (목표)
  └─ Concern (초점): 사람과 에이전트의 주의와 판단이 필요한 중요한 상황
       ├─ Inquiry WorkUnit   (조사)
       ├─ Change WorkUnit    (변경)
       └─ Integration WorkUnit (전체 반영)
```

- **Concern**은 문제일 수도, 기회나 위험이나 불확실성일 수도 있습니다. 하나의 Concern이 여러 작업을 만들 수 있고, 하나의 작업이 여러 Concern에 영향을 줄 수도 있습니다.
- **WorkUnit**은 정해진 권한 안에서 실행하는 구체적인 작업입니다. Task는 Concern을 풀기 위한 실행 수단입니다.

v0.1에서는 Concern 하나가 열리고 닫히는 전체 과정을 "공동행위 episode"라고 불렀습니다. v0.2에서는 작은 수정에까지 이 전체 과정을 강제하면 형식이 과해진다는 이유로 Concern과 WorkUnit을 분리했습니다.

## 4. 네 운영 루프

Concern 하나는 네 루프를 오가며 진행됩니다. 순서대로 지나가는 파이프라인이 아니라, 새 근거가 나오면 언제든 다른 루프로 되돌아가는 구조입니다.

| 루프 | 목표 | 핵심 질문 | 사용자에게 보이는 것 |
|---|---|---|---|
| **O, Orientation** | 현재 상황에 다시 참여할 수 있는 상태를 만든다 | 무엇이 바뀌었나, 왜 중요한가, 내버려 두면 어떻게 되나 | 복귀 요약 (Return Brief) |
| **I, Inquiry** | 불확실한 상황을 행동 가능한 문제와 정당화된 선택으로 바꾼다 | 무엇을 문제로 보고 있나, 다른 설명은 무엇인가, 어떤 근거가 가설들을 구분하나 | 가능성 비교 (Inquiry Map), 선택 요청 (Decision Gate) |
| **C, Commitment** | 선택을 약속과 제한된 자율 실행으로 바꾼다 | 누가 무엇을 왜 맡았나, 스스로 정해도 되는 범위는 어디까지인가, 언제 멈추고 상향해야 하나 | 작업 합의 (Delegation Contract) |
| **A, Assurance & Adaptation** | 결과를 근거와 함께 받아들이고 전체에 반영하며, 다음을 위해 배운다 | 왜 이 결과를 받아들여도 되나, 다른 작업의 전제를 깨뜨리지 않았나 | 결과 확인, 전체 반영, 돌아보기 |

되돌아가는 예는 이렇습니다. Orientation에서 예상 밖의 관찰이 나오면 Inquiry가 열립니다. 실행 중에 맡긴 범위 밖의 문제가 생기면 Inquiry나 선택 요청으로 돌아갑니다. 결과 확인에서 근거가 부족하면 실험 작업이 새로 생깁니다. 돌아보기는 다음 작업 합의와 규칙의 기본값을 바꿉니다.

매니페스토의 10단계 순환(Sense → Frame → Diverge → Investigate → Deliberate → Commit → Execute → Assure → Integrate → Reflect)은 이 네 루프를 더 잘게 나눈 버전입니다. Sense는 O, Frame부터 Deliberate까지는 I, Commit과 Execute는 C, 나머지는 A에 해당합니다. 지난번에 이야기한 발산 서브시스템은 I 루프의 Frame과 Diverge 단계입니다.

## 5. 반드시 구분하는 것들

Helm의 거의 모든 규칙이 아래 구분을 지키기 위해 존재합니다.

**이해의 다섯 단계.** 서로 자동으로 승격되지 않습니다.

```text
관찰 (직접 보거나 도구로 확인한 것)
→ 해석 (관찰의 의미에 대한 추론)
→ 가능성 (아직 확인 중인 설명이나 해법)
→ 판단 (현재 근거 안에서 참으로 받아들인 것)
→ 선택 (앞으로 무엇을 할지 정한 것)
```

이 구분이 없으면 에이전트의 그럴듯한 해석이 사실처럼 보이고, 가장 가능성 높은 설명이 그대로 행동 결정이 됩니다. 추천도 선택이 아닙니다. 사람이 명시적으로 고르거나 승인된 규칙이 적용돼야 선택이 됩니다.

**결과의 세 단계.**

```text
결과 제출 (완료 주장) → 결과 확인 (수락) → 전체 반영 (통합)
```

에이전트의 완료 선언은 검증 대상이고, 확인된 결과도 다른 작업과 문서, 규칙, 실제 환경까지 맞춰지기 전에는 닫히지 않습니다. 화면에서 "완료"라는 단어는 전체 반영까지 끝났을 때만 씁니다.

**v0.2에서 추가된 구분.**
- **기록과 진실은 다릅니다.** ledger가 보장하는 것은 "누군가 이 내용을 기록했다"는 사실이지, 내용이 참이라는 것이 아닙니다.
- **형식이 맞는 것과 품질이 맞는 것은 다릅니다.** 계기는 dogfood에서 나온 `ㅇ`, `ㅁㄴㅇ` 결정이었습니다. 필수 필드가 다 채워졌다는 이유로 최신 결정으로 표시되고, 복귀 요약에 "blind spot 없음"이 나왔습니다. 그래서 상태를 `absent → captured → structural → qualified → accepted`로 나누고, `contested`, `stale`, `superseded`를 별도로 둡니다. 품질 검증을 통과하지 않은 내용은 기준선이 될 수 없고, 주의 항목으로 표시됩니다.
- **투영은 원본을 바꾸지 않습니다.** 복귀 요약이나 추천은 원본 기록에서 계산한 결과일 뿐입니다.

## 6. 사람과 에이전트, 그리고 언제 묻는가

**역할 분담.** 공리 A6이 핵심입니다. 에이전트는 제안과 제한된 실행의 주체이고, 사람은 가치와 최종 약속의 저자입니다. 에이전트는 넓은 탐색, 근거 수집, 정해진 범위의 실행, 충돌과 반대 근거 탐지를 맡습니다. 사람은 목적의 정당화, 문제 관점에 대한 이의 제기, 중요한 기준 선택, 되돌릴 수 없는 trade-off 수락, 결과 확인을 맡습니다. 문서는 이것이 능력의 우열이 아니라 책임의 구조라고 명시합니다.

**자율성은 권한 범위입니다.** 같은 에이전트도 작업과 위험에 따라 읽기만 하거나, 로컬 변경까지 하거나, 외부 행동 전에 멈춥니다(A7). v0.2는 행동의 영향도를 다섯 등급으로 나눕니다.

```text
R0 로컬 읽기 전용
R1 되돌릴 수 있는 로컬 변경
R2 공유되거나 외부에 보이는, 되돌릴 수 있는 행동
R3 비용이 크거나 민감하거나 복구가 어려운 행동
R4 되돌릴 수 없거나 기본적으로 금지된 행동
```

한 번 맡겼다고 권한이 계속 이어지지 않습니다. 다음 작업이 요청하는 권한이 사람이 처음 준 권한 범위 안에 포함되는지 매번 검사하고, 행동 종류·영향 등급·대상·만료·중단 조건 중 하나라도 넓어지면 다시 묻습니다.

**언제 묻는가.** 개입 횟수를 늘리거나 줄이는 게 목표가 아니라, 사람의 입력이 가진 가치가 주의력 비용보다 클 때만 묻습니다. 다음 조건이 많을수록 물어야 합니다.

```text
가치 충돌, 큰 영향, 되돌릴 수 없음, 사람의 판단으로 줄일 수 있는 불확실성,
다른 시스템과의 결합, 의미 있는 이견, 낮은 복구 가능성
```

반대로 규칙이 명확하고, 되돌리기 쉽고, 관찰과 테스트가 가능하면 묻지 않습니다. 사용자의 답이 결과를 바꾸지 않는 승인 절차는 "approval theater"라고 부르며 피해야 할 대상으로 봅니다. 그래서 선택 요청에는 `[승인] [거절]` 대신 추천 선택, 기준 수정, 먼저 실험, 연기를 함께 둡니다.

## 7. 강도 조절: Quick, Guided, Assured

v0.2에서 새로 생긴 개념입니다. 모든 작업에 같은 형식을 요구하지 않고 위험에 따라 조절합니다(D3, 수정 수락).

- **Quick**: 작고 되돌릴 수 있는 작업. 사용자에게 구조를 보여주지 않지만, 내부적으로는 목표 연결과 완료·수락 구분을 유지합니다.
- **Guided (기본값)**: 목표와 초점을 보여주고, 관찰·해석·가능성을 구분하며, 중요한 선택과 작업 합의를 짧게 확인합니다.
- **Assured**: 외부 영향, 비밀 정보, 낮은 복구 가능성이 있을 때. 경쟁 가설, 반대 근거, 강제된 권한 범위, 독립적인 검토, 복구 경로를 요구합니다.

어느 단계에서도 바뀌지 않는 것은 5절의 구분들입니다. 단계는 사용자에게 보이는 형식과 증명 부담의 양만 조절합니다.

## 8. 평가 기준과 반증 조건

**공동행위 품질의 네 기준(OPD+C).** 모든 작업과 화면을 다음으로 평가합니다.
- Observability: 다음 판단에 필요한 상태와 근거를 볼 수 있는가
- Predictability: 다음 행동과 결과를 예상할 수 있는가
- Directability: 낮은 비용으로 목표, 기준, 범위를 바꿀 수 있는가
- Contestability: 문제 관점, 판단, 추천, 결정에 이의를 제기할 수 있는가

**반증 조건.** Operating Theory는 이 이론이 틀렸다고 볼 조건을 미리 적어 두었습니다. 복귀 요약이 원본 로그 재열람을 줄이지 못할 때, 가능성 비교가 조기 수렴이나 결함을 줄이지 못할 때, 선택 요청이 대부분 형식적인 승인으로 끝날 때, 사용자 참여가 품질과 주도성 없이 작업량만 늘릴 때, 구조화된 문서 방식과 차이가 없을 때입니다.

## 9. 용어 대응표

v0.1 원론 용어, 쉬운 제품 용어, v0.2 용어가 섞여 있어서 정리했습니다.

| v0.1 원론 | 쉬운 말 | v0.2 |
|---|---|---|
| Purpose | 목표 | Goal |
| Concern | 초점 | Concern / Focus |
| ProblemFrame | 문제 관점 | Problem view |
| Hypothesis | 가능성 | Possibility |
| Claim | 판단 | Finding |
| Decision | 선택 | Choice |
| DelegationContract | 작업 합의 | Work Agreement |
| AuthorityEnvelope | 맡긴 범위 | Allowed range / Authority Grant |
| ClaimingComplete | 결과 제출 | Completion Claim |
| Acceptance | 결과 확인 | Result review |
| Integration | 전체 반영 | Whole update |
| ReturnBrief | 복귀 요약 | Brief |
| InquiryMap | 가능성 비교 | Explore |
| DecisionGate | 선택 요청 | Choice Gate |

---

이제 확인 질문을 하나 드리겠습니다. 다음 단계인 엔진 설계와 바로 이어지는 내용입니다. 최근에 실제로 했던 작업 하나를 떠올려 보세요. 그 작업을 Concern 하나로 놓았을 때, 네 루프(O, I, C, A) 중 어느 루프를 가장 대충 지나갔거나 건너뛰었다고 생각하시나요? 답에 따라 엔진에서 어느 루프부터 강제할지 정하는 데 참고할 수 있습니다.

--- [57] USER ---
C와 A

=== COMPACTION SUMMARY (prior conversation) ===
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   - Overall goal: The user (Korean frontend developer, React 18 CSR senior, no SSR prod experience) is building a **vendor-neutral personal agent harness** (skills, extensions, workflows) that works the same regardless of agent runtime; currently uses **pi** (Earendil's coding agent, now Pi 1.1.0). Later clarified it is **for personal use only, not general users**.
   - Sequence of requests: design neutral harness → research real individual cases → discuss context vs skill text, many vs few tools, determinism/token efficiency → observer agent C that mines session logs and proposes skills/extensions/scripts (code-triggered, outside main session) → feasibility in pi → analyze Pi 1.0+ updates → trending subagent patterns → RLM deep dive via `/frontend-deep-dive-tutor` (chapters 1–3 + foundational chapter 0) → research personal RLM application cases → user idea: a **divergence/problem-discovery subsystem** acting as a true advisor (user often doesn't know what they want until they see approaches, causes, side effects) → analyze user's earlier project **Helm** (folder `/Users/user/Documents/projects/06_agent_docs_os`, only files modified after Aug 16) → "Can Helm's concepts/axioms/theory (ignoring existing implementations/scripts) be implemented as an agent loop/engine?" → "Review Helm theory first, I forgot it all" → answered my check question: the loops they skip most are **C (Commitment) and A (Assurance & Adaptation)**.
   - Style preferences (stored): dislikes AI-ish Korean phrasing such as '축', '박다', '가른다', and personifying metaphors ("연구가 이 질문에 닿았다", "증거가 말한다"); wants plain factual writing. Prefers top-down explanations (big picture first, then zoom in). Tutor-mode answers in Korean 합니다체.

2. Key Technical Concepts:
   - Neutral harness layers: (A) already-neutral standards (Agent Skills SKILL.md, AGENTS.md, MCP), (B) logic as runtime-external CLI (`ak`), guard policies outside runtime, state as repo files, (C) neutral schemas + thin adapters (neutral hook events, agents/, commands/, workflows/ runner with `AgentDriver` wrapping `pi -p`, `claude -p`, `codex exec`); capability matrix + graceful degradation; second runtime early; evals.
   - Agent loop basics: while loop, stateless model API, message array (system/user/assistant/tool), context window = array size, hooks at tool-call points, skills = progressive disclosure text, subagent = tool that runs another loop (fresh vs fork, sync vs background), Agent Teams (task list + mailbox).
   - pi 1.x extension API: events `session_start`, `session_shutdown`, `before_agent_start`, `agent_end`, `turn_end`, `agent_before_settle` (append entries + request one continuation), `agent_settled` (now with `aborted`), `tool_call` (mutate/block), `tool_result`, `context`, `context_with_system`, `provider_stream_event`, `user_bash`, `cache_warming_decision`; `pi.registerTool` (exposure direct/model-only/codemode/deferred/hidden, `outputSchema`/`structuredContent`, `ctx.executeTool`), `pi.appendEntry`, `pi.sendMessage`, `pi.setActiveTools`, `pi.registerMcpServer`, `pi.registerVirtualModel`, `ctx.ui`. Sessions JSONL at `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`; modes print/json/rpc/SDK, `RpcClient`. Pi Durable (experimental): storage-backed harness, checkpointed tasks, `replay: "safe"`, forks, background tasks, documents, hooks with memo.
   - pi codemode: QuickJS sandbox per call (new worker+VM, closed after), `tools.*`, `store/load` persisted as `codemode-store` session entries replayed per branch, `max_output_tokens` 10000, inline budget 3000, 256MB VM, no timers/fetch.
   - RLM (Zhang, Kraska, Khattab; arXiv 2512.24601, NeurIPS 2026): root LM sees only query; context in REPL variable; `llm_query` sub-calls; `FINAL`/`FINAL_VAR`; depth 1 in experiments; context-centric decomposition decided by model.
   - Observer agent C pipeline: trace normalization → deterministic mining → LLM classification (skill/CLI/hook/noise) → inbox → human approval → sync → effect measurement; triggers via code (cron/events), not model.
   - Helm theory: definition; "justified progress under bounded human attention" (4 conditions); world model `<N, E, M | A, P>` (v0.2; v0.1 had 5 state spaces); Goal > Concern > WorkUnit; four loops O (Orientation), I (Inquiry), C (Commitment), A (Assurance & Adaptation) with re-entry; 10-step cycle Sense→Frame→Diverge→Investigate→Deliberate→Commit→Execute→Assure→Integrate→Reflect; axioms A1–A15; 12 laws; epistemic chain 관찰→해석→가능성→판단→선택 (no auto-promotion); 결과 제출→결과 확인→전체 반영; record ≠ truth; quality states absent/captured/structural/qualified/accepted/contested/stale/superseded; projection never writes canonical state; effect classes R0–R4; authority carry-forward `RequestedAuthority ⊆ CurrentAuthorityGrant`; gate rule (policy can't decide + human answer changes outcome + asking now worth attention); deliberation pressure factors; Quick/Guided(default)/Assured profiles; OPD+C criteria; falsification conditions; v0.2 decisions D1 (first-party CLI agent first, portable kernel second, GUI third), D2 (N/E/M + A/P), D3 (Guided default, risk-adaptive).
   - Helm-as-engine mapping: code-enforced A1, A5, A6, A7, A9, A10, A11, A13; model+code-checked A2, A3, A4, A8, A14; UI design A15; measure-only A12. Architecture: store outside runtime → deterministic engine (Concern state machine O/I/C/A that sets inner-loop "mode": tools/prompt/authority) → pi session inner loop; model submits candidates via typed tools, never writes store directly; observer process outside. Rule: observation must reference a tool-call id as source; otherwise recorded as interpretation.
   - Divergence/advisor subsystem design (Loop I generative): anchoring → RLM-style divergence along axes (up: purpose ladder, down: decomposition, sideways: alternatives with different models, inversion: failure/side effects, lens: Helm method-cards) with mandatory external grounding (repo, docs, web, personal ledger) → contrast compression to 2–3 consequential frames + 1 highest-value question → user reactions recorded as N-plane transitions (goal.revise, concern.reframe, choice.commit) and used as personal preference history → stop rule.

3. Files and Code Sections:
   - `~/rlm-lab/toy-rlm.mjs` (created): fake-LLM RLM flow over 6000-row OOLONG-style data; output: data ~98,986 tok, root context 96 tok, 4 subcalls ~306 tok avg, answer 26 correct.
   - `~/rlm-lab/codemode-lab.mjs` (created): uses real `CodemodeSandbox` from `@earendil-works/pi-codemode` (pi 1.1.0) with `read_log` (outputSchema) and `classify` (200ms) tools. Results: [A] direct ~102,062 tok/12 turns vs codemode 7 tok/1 turn, 17 internal calls, 415ms, storeWrites `{"numeric_by_chunk":[4,11,5,6]}`; [B] load returns "없음" unless host passes store; [C] fetch/setTimeout/process/require undefined, never-settling promise error message; [D] failed script keeps "1단계 완료" output, 1 executed call, no storeWrites.
   - `~/rlm-lab/codemode-lab2.mjs` (created; import line fixed to `./node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js`): [E] sequential 1758ms vs Promise.all 275ms; [F] 60 MCP tools direct declarations 6615 tok, codemode listed 3260 tok (29 tools), deferred 280 tok.
   - `~/rlm-lab/mini-harness.mjs` (created): minimal agent loop with fake scripted model, bash tool via execSync in `/tmp/demo`, `beforeToolCall` hook blocking `rm`; output: 3 calls, cumulative ~213 tok vs final array ~139 tok.
   - `~/rlm-lab/storage-lab.mjs` (created): codemode globals vanish across scripts; `readCodemodeStore` branch A `{"a":2,"b":9}`, branch B `{}`; JS port of rlm-minimal `REPLEnv` using `vm.createContext` (print, llm_query injected, `var context` loaded; exec returns stdout + variable names, sliced to 2000 chars); variables accumulate, `FINAL_VAR(answer)` → 15, 3 subcalls; message array ~258 tok vs context ~66,098 tok.
   - `~/rlm-lab/decomp-lab.mjs` (created): recursive `rlm(query, context, d, maxDepth)` with peek, grep, size-based partition (≤25 rows → llm_query; else split into 3 at depth<maxDepth else 25-row chunks), reduce by sum. Q A: grep 6000→75, 3 sub-RLM, answer 15, 3 calls. Q B: 600 rows → 3×200 → 8 llm_query each, answer 300, 24 calls.
   - `~/rlm-lab/ext/rlm-minimal/` (cloned alexzhang13/rlm-minimal): `rlm_repl.py` (RLM_REPL, max_iterations=20, completion loop), `repl.py` (REPLEnv globals/locals dicts, temp dir `context.txt`/`context.json`, `llm_query`, `FINAL_VAR`, blocks eval/exec but allows `__import__`/`open`), `utils/utils.py` (```repl regex, 100k-char truncation, variable names only, FINAL/FINAL_VAR regex).
   - `~/rlm-lab/node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js` and `execute.js` (read): `DEFAULT_CODEMODE_INLINE_BUDGET = 3000`, `selectCatalog`, `prepareCodemodeLoadout`, codemode tool exposure `"model-only"`, grammar constrained sampling; `readCodemodeStore(branch)` replays `codemode-store` entries; sandbox created per call, `sandbox.close()` in finally, `options.appendEntry(CODEMODE_STORE_ENTRY_TYPE, {set, delete})` on success.
   - Helm files staged to `/mnt/user-data/uploads/06_agent_docs_os/` (151 files, Aug 16 & Aug 21; `.helm/private/` and `.helm/events.jsonl` excluded). Key ones read: `README.ko.md`, `docs/foundations/README.md`, `00-manifesto.md` (A1–A15, cycle, justified_progress formula), `09-operating-theory.md` (4 loops, 5 state spaces v0.1, intervention calculus, OPD+C, maturity levels 0–5, 12 laws, falsification), `10-refinement-candidate.md` (C1–C8 contradictions, product definition, N/E/M + A/P, Concern/WorkUnit, Quick/Guided/Assured, 12 core laws, adapter levels A–D, D1–D3 decisions), `docs/prototypes/paper-v0/templates/inquiry-map.md`, `examples/helm-transition/inquiry-map.md` (F1–F3 frames, H1–H4), `docs/research/bundles/situation-recovery-and-deliberative-inquiry.md` (M1–M8), `docs/experience/helm-cli-agent-v0.2.md` (Orient/Explore/Choose/Work/Review surfaces, gate conditions, forbidden CLI experiences), `docs/architecture/helm-kernel-v0.2-candidate.md` (P1–P7, domain vocabulary, quality model, policy engine R0–R4, projection invariants, adapter capability manifest), `experiments/helm-kernel-v02/README.md`, `docs/prototypes/agent-v0.2/helm-cli-guided-001.md` (possibilities scripted in fixture), dogfood run findings, `docs/foundations-friendly/00-..., 01-shared-language.md, 02-how-work-flows.md`. Observed: `kernel.mjs` has no possibility/frame logic; `agent-runtime.mjs` only label `possibility: 'Possible'`.
   - Widgets shown: `codemode_vs_rlm_storage_stepper`, `rlm_decomposition_call_tree`, `helm_world_model_nem_ap`.

4. Errors and fixes:
   - `ERR_PACKAGE_PATH_NOT_EXPORTED` importing `@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js` → fixed via sed to relative `./node_modules/...` path.
   - `device_stage_files` rejected tarball in device scratch (`/sessions/.../mnt/outputs/...` not in connected folder) → staged files individually from connected folder in 3 batches of ≤50.
   - WebFetch 404 (wikidocs page) and 503 (GitHub extensions.md) → used other sources (pi.dev docs).
   - Self-correction: earlier claimed pi lacks native MCP → corrected (MCP built in since 0.99/1.0). Earlier "goal space only user knows" split → corrected per user feedback (goals are constructed by seeing consequences).
   - User feedback on style: dislikes AI-ish phrasing/personification; earlier answers contained phrases like "증거가 말해준다" — avoid.

5. Problem Solving:
   - Established neutral harness architecture, observer C design, pi feasibility, pi 1.x analysis, subagent trends, RLM/codemode understanding with experiments, Helm analysis (theory has divergence; implementation drifted to governance; dogfood shows semantic-input bottleneck; "ㅇ/ㅁㄴㅇ" decision evidence; planned 24h resumption probe has no result file), Helm-as-engine feasibility mapping, Helm theory review. Open: engine design priority — user indicated C and A loops are the ones they skip most.

6. All user messages:
   - "vendor free agent skill, extention, workflow 등 클로드코드나 코덱스 처럼 특정 에이전트 프로바이더에 종속되지않는 나만의 에이전트를 개발하려고해. 비록 당장은 pi 를 쓸거지만, 내가 원하는건 어떤 상황 어떤에이전트 런타임을 쓰더라도 동일하게 내 개발 및 에이전트 기반 자체 하네스 환경을 구축해놓은 걸 그대로 사용하려는 목적의 중립 에이전트 기술들을 구축하고 설계하는거야."
   - "이런식으로 벤더 중립적인 본인만의 에이전트 워크플로우를 구축하고 있는 실제 개인 사례들을 최대한 많이 조사해줘"
   - "내가 여태까지 써본 에이전트 런타임 (코덱스,클로드, 오마이오픈코드)등을 쓰면서 느꼈던건, 런타임 레벨에서 주입하는 컨텍스트와, 스킬 레벨에서 주입하는 프롬프트는 결국 모델 입장에서 그냥 하나의 텍스트 컨텍스트가 아닌가 싶은건데 니 의견은 어때"
   - "모델 바깥에서 강제하는것이 에이전트 런타임의 존재 이유이자 역할이잖아. 니 입장에서 봤을때, 정말 많은 툴들을 런타임이 제시하는것과, 정말 필요한 극소수의 툴만 제공하는 것중에 어떤게 작업과 목표 달성의 정확성이나 효율이 높아질 것 같아?"
   - "결정성이 높은 작업일 수록 토큰 효율성이 매우 올라간다고 볼 수 있겠네?"
   - "그런 생각이 들었어. 예로 내가 A라는 프로젝트를 에이전트 모델과 같이 작업하는데에 몰두하고 있잖아. ... 이 세션에 대해 전혀 관련이 없는 다른 에이전트 C가 접근해서 세션에서 발생한 여러 반복되는 패턴이나 작업 흐름을 분석하고 추출해서 워크플로우 스크립트로 정적인 익스텐션이나 스킬을 제안하는 이런 흐름이 가능해? 이걸 런타임 에서 구현가능하냐는거임 내 질문 이해못했으면 다시물어봐"
   - "좋은거같음, 하나의 런타임 프로세스 안에서, 메인 에이전트가 개별 서브에이전트에게 작업을 지시하는건, 서브에이전트 스폰 조차 비결정성에 의존하는 거고, 내가 하나의 작업에 매몰되더라도, 그동안 각 세션 작업을 통합해서 보고해주는 에이전트가 별다른 지시나 메인 세션 작업에서의 트리거가 없더라도 자동으로 구조화 시킬 수 있다는 거지?"
   - "파이로 이 구조가 구현 가능할까"
   - "pi 1.0 이상 버전 업데이트 내용을 분석해서 설명해줘"
   - "수많은 하네스 에이전트들이 서브 에이전트 개념들을 구현하자, 가장 최근 트렌딩으로 주목받고 있는 방식은 어떤것들인지 조사 하고 설명가능해?"
   - "RLM 에 대해 더 자세히 설명해줄래? /frontend-deep-dive-tutor"
   - "다음장도 진행해줘 그리고 실제 RLM개념을 개인 에이전트 런타임에 적용하여 성과를 보인 사례가 있는지도 조사해줘"
   - "내가 멍청해서 전반적인 흐름과 맥락을 이해못하고있어 일반적인 에이전트 하네스 루프가 어떻게 동작하고 각 개념을 어떻게 부르고 사용하는지에 대한 기초부터 다시 쌓고 RLM과 일반 harness 런타임의 차이를 이해해야할거같아"
   - "codemode 랑 rlm의 한턴의 행동 단위와 데이터 저장 방식에 대한 더 깊은 이해를 하고싶어, 둘 다 세션안의 메세지 배열에만 두는게 아닌 외부 저장소를 활용하는거같은데, 이 외부 저장소를 어떻게 구성하고 관리하며 어떤식으로 데이터를 입출력하는지랑 샌드박수 변수나 repl 변수라는게 무엇인지 도 이해하고싶고, 분해를 정하는 방식도 실제 코드나 비쥬얼라이제이션으로 이해하고싶어"
   - "REPL 구조의 자체적인 성능에 대한 우위 비교보다, 보면서 영감을 얻은건, ... '문제 발견과 정의' 즉 사용자가 진짜 원하는 것이 무엇이고, 무엇을 문제라고 생각하며, 해당 문제를 해결하기 위한 방법은 어떤 것들이 있는지 사용자의 지식에 의한 지시를 넘어서는 범주의 더 최적화되고 좋은 품질을 산출할 수 있도록 다양한 바운더리로 확장 및 발산하여, 더 나은 문제 정의와 구성에 도달함으로써, 사용자의 지시를 일률적으로 따르는게 아니라, 진짜 advisor로써 행동할 수 있도록 하는 시스템을 생각해 봤는데 어떻게 생각함? 객관적으로"
   - "그치 너 말대로 어쨌든 AI도 학습된 데이터에서 평균값에 수렴한다라는 의견 자체는 동의해, 문제는 그 값에 수렴하기 위해서, 어떤 입력값을 사람이 넣어야 하냐 조차 모르는 상황에서 이런 문제 정의와 발견에 대한 발산이 의미가 생길 수 있지 않냐는 거야. 목표공간과 해법 공간에서, '나'도 내가 원하는게 정확하게 뭔지 모르는 상태에서, 어떤 접근이 있고 원인과 부작용등이 뭔지 알게 되면 비로소 내가 진짜 무엇을 원하는지를 인지할 수 있게 되는 것이니, 발산 루프가 이 과정까지 도달하는 것을 전문적으로 해주는 일종의 서브시스템으로 동작하게 하는거지. 나는 일반적인 사용자들을 목표로 하는 것이 아닌 나를 위한 에이전트루프를 개발하려고 하는거야. 첨부된 프로젝트는 내가 이전에 구상했던 새로운 패러다임 에이전트인데 8월 16일 이후 파일들만 분석하면 돼."
   - "결국 나는 에이전트에서 Helm의 방법론을 구현하고 싶은건데 가능한거야? 이미 헬름에 존재하는 구현이나 스크립트들은 전부 신경쓰지말고 개념과 아이디어 및 공리와 이론적인 측면을 에이전트 루프나 엔진으로 구현할 수 있냐는거지"
   - "그전에 helm 이론에 대해서 복습좀 하고가자 나도 다까먹어서 헷갈려"
   - "C와 A" (answer to my question: which of the four loops O/I/C/A they skipped or rushed most in a recent task)

7. Pending Tasks:
   - Respond to "C와 A": use it to decide which loops the Helm engine should enforce first.
   - Previously offered (not yet accepted explicitly): write the minimal Helm engine state machine (store + Concern state machine) and a pi extension skeleton, and run one small task through Orient → Integration.
   - Also previously offered (not accepted): prototype divergence subsystem steps ①–③ as a pi extension; 5-vague-task experiment; next tutor chapter (subagent as loop-running tool: ypi process spawn vs Pi Durable owned conversations).
   - Security/handling constraints to keep: do not stage/read `.helm/private/` (contains resumption-keys.json); work only within the connected folder `/Users/user/Documents/projects/06_agent_docs_os`; deletion in connected folders not permitted by default (would require permission request).

8. Current Work:
   I had just delivered a top-down Helm theory review (definition, justified progress, N/E/M | A/P world model widget, Concern/WorkUnit, four loops table, key distinctions, quality states, roles, R0–R4, authority subset, when to ask, Quick/Guided/Assured, OPD+C, falsification conditions, term table v0.1/쉬운 말/v0.2) and ended with the question: "최근에 실제로 했던 작업 하나를 떠올려 보세요. 그 작업을 Concern 하나로 놓았을 때, 네 루프(O, I, C, A) 중 어느 루프를 가장 대충 지나갔거나 건너뛰었다고 생각하시나요? 답에 따라 엔진에서 어느 루프부터 강제할지 정하는 데 참고할 수 있습니다." The user answered: "C와 A".

9. Optional Next Step:
   Respond to "C와 A" in plain Korean (no AI-ish phrasing): acknowledge that Commitment (작업 합의·맡긴 범위·멈출 조건) and Assurance (결과 제출→결과 확인→전체 반영, 돌아보기) are the skipped loops, note these are also the most code-enforceable parts (A6, A7, A10, A13; v0.2 Work Agreement, authority subset check, completion/acceptance/integration state machine), and propose that the engine starts with C+A: e.g., a pi extension where a work-agreement is required before mutating tools (`tool_call` authority check with effect class), a `completion.submit` tool with required evidence links (`outputSchema`), `agent_before_settle` preventing settle with unsubmitted/unchecked results, a review gate via `ctx.ui` with options (확인 / 조건부 확인 / 수정 요청 / 거절), and an integration-obligation list surfaced in the brief. Then offer (or proceed, if appropriate) to write the minimal C+A state machine and pi extension skeleton, consistent with the earlier offer: "원하시면 1번의 최소 상태 기계와 2번의 pi 확장 뼈대를 함께 작성해서, 작은 작업 하나로 Concern 하나가 Orient부터 통합까지 가는 과정을 돌려 보겠습니다."

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-claude/60aa9ab4-6098-5e4b-89bb-feba07cf0614.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.

--- [58] ASSISTANT ---
두 루프를 건너뛰셨다는 건 엔진 설계에는 오히려 유리합니다. O와 I는 모델의 판단이 많이 필요해서 코드로 강제하기 어렵습니다. 반면 C와 A는 대부분 상태 기록과 검사라서 코드로 강제하기 가장 쉬운 부분입니다. 그래서 C와 A부터 만드는 것을 제안합니다.

## 1. 왜 C와 A가 빠지는가

일반 에이전트 런타임에서는 아래 두 가지가 각각 하나로 합쳐져 있습니다.

| Helm이 구분하는 것 | 채팅 런타임에서 실제로 일어나는 일 |
|---|---|
| 지시 / 작업 합의 | 처음 보낸 지시문이 그대로 합의 역할을 함. 맡긴 범위, 멈출 조건, 제출할 근거가 비어 있음 |
| 결과 제출 / 결과 확인 / 전체 반영 | 모델이 "완료했습니다"라고 쓰면 세 단계가 한꺼번에 끝난 것처럼 됨 |

C를 건너뛰면 A에서 확인할 기준도 없습니다. 완료 기준이 처음부터 없으니 결과를 확인할 때도 "대충 되는 것 같다"로 끝납니다. 그래서 두 루프는 따로 빠진다기보다 같이 빠지는 경우가 많습니다.

## 2. 엔진에서 강제할 수 있는 부분

이전에 정리한 공리 가운데 C와 A에 해당하는 것들(A6, A7, A10, A13 등)은 모두 코드로 검사할 수 있는 항목이었습니다. pi 확장으로 옮기면 다음과 같습니다.

### C: 작업 합의

- **합의 기록**에 들어가는 항목: 목적, 완료 기준 목록, 맡긴 범위(허용하는 최대 effect class, 수정 가능한 경로), 금지 행동, 함께 제출할 근거, 멈출 조건.
- **강제 지점은 `tool_call` 이벤트**입니다. 도구 호출마다 effect class를 분류합니다.
  - read, grep, ls → R0
  - edit, write → 로컬에서 되돌릴 수 있는 변경
  - git push, publish, 외부 POST → 외부 행동
  - rm -rf, force push, 배포 → 되돌리기 어려운 외부 행동
  - 분류할 수 없는 bash 명령은 보수적으로 로컬 변경 이상으로 봅니다.
- **차단 규칙은 두 가지**입니다.
  - 활성 합의가 없는데 R0보다 높은 호출이 오면 차단하고 "작업 합의 먼저"를 반환합니다.
  - 합의 범위를 넘는 호출이 오면 차단하고 선택 요청을 엽니다. 이것이 `RequestedAuthority ⊆ CurrentAuthorityGrant` 검사입니다.
- **합의를 만드는 방법**: 모델이 `agreement.propose` 도구로 지시문에서 초안을 채웁니다. 사람은 `ctx.ui.select`로 확인, 수정, 취소 중 하나만 고릅니다. 읽기만 하는 작업은 합의 없이 진행합니다.

### A: 결과 제출 → 결과 확인 → 전체 반영

- **`result.submit` 도구** (`outputSchema` 사용)
  - 완료 기준마다 충족, 미충족, 확인 못함 중 하나와 근거를 적습니다. 근거는 tool call id여야 합니다.
  - 엔진은 그 id가 세션에 실제로 있는 도구 결과인지 확인합니다. 근거가 모델이 쓴 문장뿐이면 해당 기준은 "확인 못함"으로 기록합니다. 이전에 정한 "관찰은 tool call id를 출처로 가져야 한다" 규칙과 같은 내용입니다.
- **`agent_before_settle`**: 합의 아래에서 파일이 바뀌었는데 제출이 없으면 항목을 추가하고 한 번 더 실행을 요청합니다. "결과 제출이 없습니다. 기준별 근거와 함께 제출하세요."
- **결과 확인은 사람만 합니다.** 모델에게는 accept 도구를 주지 않습니다. 제출이 오면 `ctx.ui.select`로 확인, 조건부 확인, 수정 요청, 거절 중 하나를 고르게 합니다.
  - 수정 요청이면 합의는 그대로 두고 진행 중 상태로 돌아갑니다.
  - 완료 기준 자체가 틀렸다면 I 루프로 다시 엽니다.
- **전체 반영 목록**: 결과를 확인하면 엔진이 반영할 항목을 만듭니다. 바뀐 파일과 관련된 문서와 테스트, 이 결과가 깨뜨린 이전 선택이나 전제, 다른 열린 초점과의 충돌이 들어갑니다. 목록을 모두 처리하거나 명시적으로 미루기 전까지 상태는 "완료"가 아니라 "결과 확인됨"입니다. 남은 항목은 다음 `session_start`의 복귀 요약 맨 위에 보입니다.
- **돌아보기**: 마지막에 "다음 합의에서 바꿀 것" 한 줄을 받습니다. 선택 사항입니다. 이 기록은 나중에 관찰 에이전트 C가 합의 템플릿을 고칠 때 재료로 씁니다.

### 상태 기계

```text
(합의 없음) ─propose→ 범위 확인 중 ─사람 확인→ 맡김 완료 ─첫 변경 호출→ 진행 중
진행 중 ─범위 초과→ 선택 필요 ─사람 선택→ 진행 중 | 범위 확인 중
진행 중 ─result.submit→ 결과 확인 필요
결과 확인 필요 ─확인/조건부 확인→ 결과 확인됨 ─반영 목록 처리→ 완료
결과 확인 필요 ─수정 요청→ 진행 중
결과 확인 필요 ─거절 / 기준이 틀림→ 다시 열림 (C 또는 I로)
```

상태 전이는 엔진만 실행합니다. 모델은 도구로 후보만 제출하고 저장소를 직접 쓰지 못합니다.

## 3. 가장 큰 위험: 이 장치 자체를 건너뛰게 되는 것

C와 A를 건너뛴 이유가 "귀찮아서"라면, 엔진이 묻는 횟수가 많아질수록 또 우회하게 됩니다. 그래서 처음부터 두 가지를 정해 두는 것이 좋습니다.

1. **사람이 하는 일은 고르기 두 번이 상한입니다.** 합의 확인 한 번, 결과 확인 한 번입니다. 나머지는 모델이 초안을 채우고 엔진이 검사합니다.
2. **2주 동안 다음 값을 기록합니다.**
   - 합의를 우회하거나 취소한 비율
   - 범위 초과로 차단된 횟수
   - 근거 없이 제출된 기준의 수
   - 결과 확인까지 걸린 시간
   - 열린 채 남은 반영 항목의 수

   우회 비율이 높으면 엔진이 무겁다는 뜻입니다. 이것이 Helm의 반증 조건을 개인 엔진에 맞게 줄인 형태입니다.

원하시면 이 상태 기계와 pi 확장 뼈대(`tool_call` 차단, `agreement.propose`, `result.submit`, `agent_before_settle`, 결과 확인 UI)를 작성하겠습니다. 가짜 모델로 작은 작업 하나를 합의부터 완료까지 돌려서, 각 지점에서 어떻게 차단되고 기록되는지 함께 보여드리겠습니다.

--- [59] USER ---
HELM의 세계 모델,  일의 단위와 세부개념 운영 루프 구조(세부 및 거시 버전 둘다),이해의 단계 개념은 에이전트 런타임으로서 구현하고싶은데 어떻게 생각함? pi 나 기존에 얘기했던 RLM 등의 개념을 사용해서 런타임 구조적으로 helm 세계를 구현해보고싶은데

--- [60] ASSISTANT ---
[widget helm_runtime_four_layer_architecture]

--- [61] ASSISTANT ---
보라색 두 층(저장소, 엔진)이 Helm 자체이고, 청록색 두 층은 pi 대신 다른 런타임으로 바꿀 수 있는 부분입니다. 처음에 말씀하신 벤더 중립 하네스 구조와 같은 방향입니다. 아래에서 요청하신 네 가지를 이 구조에 하나씩 대응시키겠습니다.

## 1. 세계 모델 N/E/M | A/P

| 평면 | 런타임에서의 위치 | 바꿀 수 있는 주체 |
|---|---|---|
| N 방향 | 저장소 레코드: 목표, 초점, 완료 기준, 선택, 작업 합의 | 사람, 또는 사람이 확인한 제안 |
| E 이해 | 저장소 레코드: 관찰, 해석, 가능성, 판단과 각각의 품질 상태 | 모델은 제출만 할 수 있고, 승격은 엔진만 함 |
| M 실제 | 저장하지 않음. git sha, 파일 경로, 실행 결과 같은 참조만 둠 | 도구 실행 |
| A 참여자 | 엔진 설정: 사람, 에이전트 세션, 검증자, 도구, 그리고 합의별 권한 부여 | 사람 |
| P 정책 | 설정 파일: effect class 분류, 선택 요청 조건, Quick/Guided/Assured 프로필 | 사람 (관찰 에이전트 C가 수정안을 제안) |

M을 저장소에 복사하지 않고 참조만 둔다는 점이 "기록은 진실이 아니다"를 구조로 옮긴 부분입니다. 기록과 실제가 어긋나면 기록 쪽을 stale로 표시합니다.

## 2. 일의 단위

| 단위 | 런타임 대응 | 수명 |
|---|---|---|
| 목표 | 루프 없음. N 레코드만 있음 | 몇 주에서 몇 달 |
| 초점(Concern) | 엔진 상태 기계 인스턴스 하나 | 며칠, 여러 세션에 걸침 |
| 진행 작업(WorkUnit) | 작업 합의 하나에 묶인 pi 세션 실행 1회 (또는 Pi Durable task) | 몇 분에서 몇 시간 |
| 하위 호출 | 진행 작업 안의 RLM 호출이나 서브에이전트 | 몇 초에서 몇 분 |

pi의 세션 트리(branch, fork)와 codemode store는 세션 단위입니다. 그래서 Helm의 정본 저장소로 쓰면 안 됩니다. 정본은 엔진 저장소에 두고, pi 세션 transcript는 "이 진행 작업의 실행 기록"으로 M 쪽에서 참조합니다. 앞서 실험에서 branch A와 branch B의 codemode store가 서로 다르게 나온 것이 이 이유입니다.

## 3. 운영 루프: 세 가지 크기

- **세부 루프 (10단계)**: 초점 상태 기계의 세부 상태입니다. 단계마다 내부 루프의 모드(쓸 수 있는 도구, 프롬프트, 권한)가 바뀝니다.
- **중간 루프 (O/I/C/A)**: 초점 상태 기계의 큰 상태입니다. 다시 열림(re-entry)은 이 수준에서 일어납니다.
- **거시 루프**: 여러 초점 사이의 일입니다. 복귀 요약, 사람의 주의를 어디에 쓸지, 다시 볼 조건 감시가 여기에 속합니다. "제한된 사람의 주의 아래에서의 정당한 진척"이 실제로 다뤄지는 곳입니다.

10단계를 모드로 옮기면 다음과 같습니다.

| 단계 | 루프 | 쓸 수 있는 도구 | 모델이 제출하는 것 | 엔진이 검사하는 것 |
|---|---|---|---|---|
| Sense | O | 읽기, `helm.query` | 상황 요약 후보 | 요약의 각 문장이 레코드를 참조하는가 |
| Frame | O | 읽기 | 문제 관점 후보 | 목표와 연결되는가 |
| Diverge | I | RLM 하위 호출 | 가능성 여러 개 | 각 가능성에 구분할 다음 확인이 있는가 |
| Investigate | I | 읽기, 실행(R0) | 해석 | 관찰 id를 참조하는가 |
| Deliberate | I→C | 없음 | 판단 후보, 선택지 | 승격 규칙, 선택 요청 조건 |
| Commit | C | `agreement.propose` | 합의 초안 | 사람 확인 |
| Execute | C→A | 합의가 허용한 변경 도구 | 없음 | 요청한 권한이 부여된 권한 안에 있는가 |
| Assure | A | `result.submit`, 독립 검증자 | 기준별 근거 | 근거 id가 실재하는가 |
| Integrate | A | 읽기, 영향 범위 탐색 | 반영 목록 | 목록을 처리했는가 |
| Reflect | A | 없음 | 한 줄 | 없음 (관찰 에이전트 C가 나중에 수집) |

Quick 프로필에서는 R0~R1 작업일 때 O와 I를 한 번의 호출로 압축합니다. Assured 프로필에서는 모든 단계를 통과해야 합니다.

## 4. 이해의 단계: 관찰 → 해석 → 가능성 → 판단 → 선택

- **관찰**: 모델이 만들 수 없습니다. `tool_result`가 올 때 어댑터가 tool call id, 명령, 출력 참조로 자동 생성합니다. 사람의 발화도 출처가 사람인 관찰로 기록합니다.
- **해석**: 모델이 제출하고, 관찰 id를 하나 이상 참조해야 합니다. 참조가 없으면 해석이 아니라 "전제"로 기록합니다.
- **가능성**: 모델이 제출합니다. 지지 근거, 약화 근거, 구분할 다음 확인을 칸으로 둡니다.
- **판단**: 가능성을 판단으로 올리는 것은 엔진 이벤트로만 할 수 있습니다. 조건은 세 가지입니다. 지지 근거가 관찰을 참조할 것, 반대 근거를 검토한 기록이 있을 것, 영향이 낮아 정책이 허용하는 경우가 아니라면 사람이 확인할 것.
- **선택**: 판단에서 자동으로 나오지 않습니다. 사람이 하거나, 맡긴 범위 안에서 정책이 합니다.
- **다시 열림**: 새 관찰이 기존 판단의 근거와 맞지 않으면 그 판단은 contested가 되고 초점이 다시 열립니다. "맞지 않는다"를 알아보는 것은 모델(검증자 하위 호출)의 일이지만, 상태를 바꾸고 기록하는 것은 엔진의 일입니다.

## 5. RLM과 codemode가 쓰이는 곳

RLM의 핵심은 "컨텍스트를 메시지 배열이 아니라 바깥 변수에 두고, 루트 모델은 질의만 한다"였습니다. Helm 저장소가 바로 그 바깥 변수 역할을 합니다. 그래서 RLM은 네 곳에 쓰입니다.

1. **복귀 요약 (O)**: 저장소 전체를 프롬프트에 넣지 않습니다. 루트 모델은 투영된 요약만 보고, 필요하면 `helm.query`와 하위 호출로 내려가 확인합니다. 앞서 실험에서 데이터 약 99k 토큰에 루트 컨텍스트 96 토큰이었던 구조와 같습니다.
2. **발산 (I)**: 목적 사다리, 분해, 대안, 실패와 부작용, 렌즈 같은 축마다 하위 호출을 하나씩 돌립니다. 결과는 판단이 아니라 가능성 후보로만 저장소에 들어갑니다.
3. **검증 (A)**: 작업한 모델의 추론을 보지 않는 새 컨텍스트 하위 호출입니다. 합의, 완료 기준, 근거 id만 받습니다.
4. **반영 (A)**: 저장소와 저장소의 영향 범위를 탐색합니다.

codemode는 이 하위 호출들을 병렬로 묶는 데 적합합니다. 실험에서 순차 실행 1758ms가 Promise.all로 275ms가 되었습니다. 다만 codemode store는 정본으로 쓰지 않습니다.

## 6. 어려운 점

- **개념 수**: Helm 문서에는 개념이 40개 넘게 있습니다. 처음부터 전부 만들면 이전 구현처럼 구조가 무거워집니다. 레코드 타입 10개 정도로 시작하는 것이 좋습니다. 목표, 초점, 관찰, 해석, 가능성, 판단, 선택, 합의, 결과, 반영 항목입니다.
- **사람 입력 병목**: dogfood 기록에서 "ㅇ" 같은 짧은 입력이 결정 근거로 남아 있었습니다. 구조화된 칸을 사람이 채우게 하면 같은 일이 반복됩니다. 모델이 초안을 쓰고 사람은 고르기만 하는 방식이어야 합니다.
- **보장 범위**: 관찰과 해석을 섞는 것은 구조로 막을 수 있습니다. 하지만 해석의 질, 가능성 목록이 충분히 다양한지, 다시 열 시점을 알아차리는지는 모델 성능에 달려 있습니다. 엔진이 보장하는 것은 "잘못된 승격이 일어나지 않는다"까지입니다.
- **비용과 지연**: 단계마다 호출이 늘어납니다. 프로필로 압축하지 않으면 작은 작업에서 우회하게 됩니다.

## 7. 만드는 순서

앞에서 C와 A를 가장 많이 건너뛴다고 하셨으니, 그 부분을 바닥으로 깔고 위로 올라가는 순서를 제안합니다.

1. 저장소, 관찰 자동 기록, C/A 상태 기계. 나머지 모든 단계가 관찰 레코드와 합의에 의존하기 때문에 먼저 만듭니다.
2. O: RLM 방식의 복귀 요약.
3. I: 발산 서브시스템과 승격 규칙.
4. 거시 루프: 여러 초점, 주의 예산, 다시 볼 조건 감시.

원하시면 1단계를 작성하겠습니다. 저장소 스키마, 엔진 상태 기계, pi 확장 어댑터를 만들고, 가짜 모델로 작은 작업 하나를 Orient부터 Integrate까지 돌려서 각 단계의 기록과 차단 결과를 보여드리겠습니다.

--- [62] USER ---
helm을 별도 엔진으로 두지 않고, pi 런타임 내에서 구현하는 방식으로 아키텍쳐를 디자인 가능할까?

--- [63] ASSISTANT ---
네, 가능합니다. 개인용이라면 이쪽이 출발점으로 더 낫다고 봅니다. 다만 "별도 엔진 없이"를 두 가지로 나눠서 보는 게 좋습니다.

- **프로세스로서의 엔진을 없애는 것**: 엔진 로직을 pi 확장 안에서 돌리는 방식입니다. 문제없이 가능하고, 별도 프로세스와 통신 비용이 사라져 오히려 단순해집니다.
- **저장소까지 pi 세션 안에 두는 것**: `appendEntry`만으로 모든 상태를 관리하는 방식입니다. 초점 하나가 세션 하나 안에서 끝나면 됩니다. 하지만 Helm의 초점은 며칠에 걸쳐 여러 세션을 넘나들기 때문에, 세션 엔트리만으로는 부족합니다.

그래서 권하는 형태는 **프로세스는 하나, 코드는 둘**입니다. 엔진은 pi 확장 안에서 돌고, 정본 기록은 확장이 관리하는 프로젝트 파일(`.helm/ledger.jsonl`)에 둡니다. 엔진 로직은 pi를 import하지 않는 순수 모듈로 따로 둡니다. 이렇게 하면 실행은 pi 안에서 하면서도, 나중에 다른 런타임으로 옮길 때 어댑터만 다시 쓰면 됩니다.

설치된 pi 1.1.0의 확장 타입 정의에서 확인한 기능으로 대응표를 만들었습니다.

## 1. Helm 요소와 pi 기능 대응

| Helm 요소 | pi 기능 | 하는 일 |
|---|---|---|
| 정본 기록 (N/E, M 참조) | 확장이 여는 `.helm/ledger.jsonl` + 메모리 투영 | append-only 이벤트. 세션에는 `appendEntry("helm-event")`로 사본만 남겨, 세션 트리의 어느 시점에 어떤 상태였는지 추적 |
| 관찰 자동 생성 | `tool_result`, `user_bash` | tool call id를 출처로 관찰 레코드 생성. `parentToolCallId`가 있어 codemode 안에서 일어난 중첩 호출도 관찰로 잡힘 |
| 사람 발화 | `input` 이벤트 | 출처가 사람인 관찰로 기록. `transform`으로 현재 초점 정보를 붙일 수도 있음 |
| 루프·단계 모드 | `before_agent_start`, `context`, `pi.setActiveTools` | 단계마다 지시문, 현재 투영, 쓸 수 있는 도구를 바꿈 |
| 모델의 후보 제출 | `registerTool` + `outputSchema` | `helm_frame`, `helm_possibility`, `helm_interpret`, `helm_propose_agreement`, `helm_submit_result` |
| 권한 검사 | `tool_call`의 `block` | 합의 없는 변경, 범위를 넘는 호출, `.helm/` 직접 쓰기를 차단 |
| 루프 종료 조건 | `agent_before_settle` (`entries`, `continue`) | 제출 없이 끝나려 하면 한 번 더 실행을 요청 |
| 선택 요청, 결과 확인 | `ctx.ui.select / confirm / input` | 확인, 조건부 확인, 수정 요청, 거절 |
| 진행 상황 상시 표시 | `ctx.ui.setStatus`, `setWidget` | 현재 초점, 단계, 맡긴 범위, 지켜보는 위험 |
| 사람이 직접 하는 조작 | `registerCommand` | `/focus`, `/brief`, `/agree`, `/accept`, `/reopen` |
| 복귀 요약 | `session_start` → `sendMessage` | 열린 초점, 남은 반영 항목, 선택 필요 항목 |
| 요약이 이견을 지우지 않게 | `session_before_compact` → 직접 만든 `compaction` | 컴팩션할 때 목표, 합의, 열린 판단, 반대 근거를 그대로 남김 |
| RLM 하위 호출 | `ctx.model` + `ctx.modelRegistry.getApiKeyAndHeaders` → pi-ai 직접 호출 | 세션 없이 한 번만 하는 호출이 RLM의 `llm_query`에 해당. codemode에 노출하면 Promise.all로 축별 병렬 실행 가능 |
| 독립 검증자 | 명령 컨텍스트의 `ctx.newSession`, 또는 `pi -p` 자식 프로세스 | 작업자의 추론을 보지 않는 새 컨텍스트 |

이 가운데 pi 안에 넣을 때 특히 유리한 두 가지가 있습니다.

1. **`session_before_compact`**: 별도 엔진 방식에서는 컴팩션이 런타임 안에서 일어나서 Helm이 손댈 수 없었습니다. pi 안에서는 컴팩션 결과를 Helm 투영으로 바꿀 수 있습니다. "요약은 중요한 이견을 지우면 안 된다"는 원칙이 코드로 보장됩니다.
2. **세션 트리(fork, tree)**: pi의 분기를 가능성 탐색 공간으로 쓸 수 있습니다. 가설마다 브랜치를 하나씩 열어 확인하고, 그 브랜치에서 나온 레코드에는 branch id를 붙입니다. 채택된 브랜치의 결과만 판단으로 승격합니다. `session_before_fork`와 `session_tree` 이벤트로 이 연결을 기록할 수 있습니다.

## 2. 한 턴의 흐름

```text
사용자 입력        → input: 사람 출처 관찰 H-3 기록
before_agent_start → 초점 F-1, 단계 Investigate: 읽기 도구만 활성화, 투영 주입
모델: read 호출     → tool_call: R0 허용 → tool_result: 관찰 O-12 생성
모델: helm_interpret(refs: [O-12]) → 엔진: 참조 확인 후 해석 I-4 기록
모델: edit 호출     → tool_call: 활성 합의 없음 → 차단 "작업 합의 먼저"
모델: helm_propose_agreement → ctx.ui.select [확인 / 수정 / 취소] → 확인
                    → 단계 Execute, 변경 도구 활성화
모델: edit, bash test → 관찰 O-13, O-14
agent_before_settle → 결과 제출 없음 → continue: true
모델: helm_submit_result(기준별 근거: O-14) → 결과 확인 UI → 확인
                    → 반영 목록 생성, 상태 "결과 확인됨", setWidget 갱신
```

## 3. 폴더 구조

```text
helm-pi/
  core/            pi import 없음. 다른 런타임에서도 재사용
    schema.ts      레코드 타입 약 10개
    ledger.ts      append-only 기록, 해시 체인
    machine.ts     초점 상태 기계 (O/I/C/A, 10단계)
    promote.ts     관찰→해석→가능성→판단 승격 규칙
    policy.ts      effect class 분류, 선택 요청 조건, 프로필
    project.ts     복귀 요약과 컴팩션용 투영
  pi/              얇은 어댑터
    index.ts       이벤트 연결
    tools.ts       helm_* 도구
    commands.ts    /focus /brief /agree /accept /reopen
    ui.ts          select, widget
    subcall.ts     pi-ai 직접 호출, 검증자 세션
<프로젝트>/.helm/
  ledger.jsonl
  policy.yaml
```

## 4. pi 안에 넣으면 생기는 한계

1. **세션이 열려 있을 때만 동작합니다.** 거시 루프의 "다시 볼 조건 감시"나 관찰 에이전트 C처럼 사람이 없을 때 돌아야 하는 것은 확장만으로 할 수 없습니다. 스케줄로 `pi -p`를 실행해 보완해야 합니다. 이것도 pi로 돌리는 것이라 "pi 안"이라는 원칙은 유지됩니다. Pi Durable의 백그라운드 task도 후보지만 아직 실험 단계입니다.
2. **모델과 엔진이 같은 프로세스, 같은 파일 시스템을 씁니다.** 모델이 bash로 `.helm/ledger.jsonl`을 직접 고칠 수 있습니다. edit와 write는 `tool_call`에서 경로로 막을 수 있지만, bash 명령은 패턴 검사가 완전하지 않습니다. ledger에 해시 체인을 두어, 엔진을 거치지 않은 변경을 다음 로드 때 감지하게 해야 합니다.
3. **pi 프로세스 여러 개가 같은 ledger를 동시에 씁니다.** 파일 락을 두고, 한 번에 한 줄만 추가하는 규칙이 필요합니다.
4. **pi 1.x API는 빠르게 바뀌고 있습니다.** core와 pi를 나눠 두는 이유가 여기에도 있습니다. 바뀌어도 어댑터만 고치면 됩니다.

정리하면, 별도 프로세스가 꼭 필요한 경우는 두 가지뿐입니다. 사람이 없을 때 감시를 돌려야 할 때, 그리고 여러 런타임을 동시에 쓸 때입니다. 지금 조건(개인용, pi 하나)이라면 pi 안에 넣고 core만 분리해 두는 것으로 충분합니다.

원하시면 이 구조로 1단계를 작성하겠습니다. core의 ledger, 상태 기계, 승격 규칙과 pi 어댑터의 관찰 자동 기록, 합의 차단, 결과 제출, 결과 확인 UI를 만들고, pi 확장 테스트 하네스에서 위의 한 턴 흐름을 그대로 재현해 보겠습니다.

--- [64] USER ---
실제 특정 프로젝트 개발 피쳐 작업을 하나 진행한다고 했을때, 어떤 흐름으로 작업이 진행되는지를 프리뷰 비쥬얼라이제이션 해줘. 그리고 pi durable이나 서브에이전트, 익스텐션 등을 사용해 HELM의 공리를 더 정확하고 결정성있게 구현할 수 있는 방안으로 고도화해봐.

--- [65] ASSISTANT ---
[widget helm_feature_flow_url_filter_sync_preview]

--- [66] ASSISTANT ---
[widget helm_on_pi_durable_ownership_tree]

--- [67] ASSISTANT ---
pi-durable의 소유 규칙은 다음과 같습니다. Helm에서는 이 규칙을 그대로 활용합니다.

- **취소는 아래에서 위로 전파됩니다.** 초점을 취소하면 그 초점이 소유한 분기, 작업, 검증자가 먼저 취소되고, 각자 자기 효과를 정리한 뒤 초점이 끝납니다.
- **소유한 작업이 남아 있으면 끝나지 않습니다.** 결과가 정해진 task라도 소유한 일이 남아 있으면 `completing` 상태로 머뭅니다. Helm의 "결과 확인됨이지만 반영 전이라 완료 아님"이 런타임의 기본 동작으로 처리됩니다.
- **감시만 `background: true`로 분리합니다.** 다시 볼 조건 감시는 초점 취소나 대기의 영향을 받지 않아야 하기 때문입니다.
- **검증자는 fork가 아니라 새 대화입니다.** fork는 부모의 기록을 분기 시점까지 그대로 보기 때문에, 작업자의 추론을 보지 않는다는 조건이 깨집니다.

## 3. 공리별 구현과 결정성 수준

| 공리 | pi-durable 장치 | 보장 수준 |
|---|---|---|
| A1 목적 먼저 | Concern task의 `initial(input)`이 목표 id와 완료 기준을 요구. orient phase에서는 변경 도구가 `configure({tools})`에 아예 없음 | 코드 보장 |
| A5 상태 구분 | 관찰은 `afterTool` 훅만 생성. 해석 도구는 참조한 관찰 id를 같은 commit 안에서 검증. 판단 승격은 task phase만 수행 | 코드 보장 (해석의 질은 모델 몫) |
| A6 제안과 약속 | 선택과 결과 확인은 host가 쓰는 `write` 항목으로만 생김. 모델 도구 목록에 accept 계열 없음. `memo` 첫 기록 우선이라 조용히 덮어쓸 수 없음 | 코드 보장 |
| A7 위험 적응 권한 | `beforeTool`에서 effect class 판정 후 `helm.agreement` 문서와 비교해 block. R0 도구만 `replay: "safe"` | 코드 보장 (bash 명령 분류는 휴리스틱) |
| A10 제출·확인·반영 | WorkUnit phase(진행→제출→확인), 반영 항목은 하위 task, `completing` 상태 | 코드 보장 |
| A11 시점별 투영 | projection은 `section`으로 렌더되고, 섹션 변경은 transcript에 위치를 가진 시스템 항목으로 남음. 모델이 어떤 판단을 내렸을 때 어떤 투영을 보고 있었는지 사후에 확인 가능 | 코드 보장 |
| A13 낡음 | 근거마다 파일@sha 기록. 파일 해시가 바뀌면 근거가 자동으로 stale. 문서 `history: "rewindable"`과 `snapshotAsOf`로 특정 시점 상태 조회. 감시는 `sleep(until)` | 코드 보장 (조건 판정 일부는 모델) |
| A9 차이 보존 요약 | `CompactionTask`의 `beforeCompact` 훅에서 Helm 요약으로 교체. 열린 반대 근거 id가 모두 들어갔는지 코드로 검사 | 누락은 코드로 검사, 요약 문장의 질은 모델 몫 |
| A4 가설 다양성 | 같은 항목에서 fork하고 축마다 다른 지시문을 줌. 분기끼리는 서로 결과를 볼 수 없음 | 독립성은 구조로 보장, 다양성은 모델 몫 |
| A3 문제 재정의 | frame 문서는 rewindable. 반대 근거가 생기면 Concern이 orient로 돌아감 | 전이와 기록은 보장, 충돌 판단은 모델 몫 |
| A8 낮은 수준 결정 | 선택 요청 조건을 정책 함수로 둠. 초점마다 질문 수 예산 | 규칙은 보장, 조건 입력값은 모델 추정 |
| A14 실패는 신호 | 차단, 중단(`interrupted`), 실패한 tool 결과가 자동으로 관찰이 됨. 저장소는 이전 항목을 지우지 않음 | 코드 보장 |
| A15 공동 저작 | 확인/취소 대신 기준·초점 수정 선택지를 줌. 실행 중 수정은 `whenBusy: "steer"`로 넣고 N 평면 이벤트로 기록 | UI 설계 |
| A2, A12 | `pi.usage`(활동량)와 정당화된 전이 수를 함께 측정. 사람이 직접 바꾼 기준과 재정의 비율을 주간 집계 | 측정만 |

코드로 보장되는 범위가 넓어지는 근거는 두 가지입니다.

1. **원자적 commit**: 이전 설계에서는 Helm 기록(`.helm/ledger.jsonl`)과 pi 세션 기록이 따로 쓰여서, 둘이 어긋날 수 있었습니다. pi-durable에서는 tool 결과 항목, 관찰 문서, task checkpoint가 commit 하나로 함께 들어가거나 함께 실패합니다.
2. **도구 목록 자체를 phase로 제어**: 이전에는 차단에 의존했습니다. 이제는 그 단계에서 쓰면 안 되는 도구를 아예 제공하지 않을 수 있습니다.

## 4. 그래도 결정적으로 만들 수 없는 것

- 해석과 가능성의 질, 발산 결과가 실제로 서로 다른지
- 새 관찰이 기존 판단과 "맞지 않는다"는 판정
- 선택 요청 조건의 입력값. 특히 "사람의 답이 결과를 바꾸는가"는 모델이 추정합니다.
- bash 명령의 effect class 분류. 명령 문자열로 판정하기 때문에 우회 여지가 남습니다. 보완책은 두 가지입니다. pi-durable의 `env`로 대화마다 별도 실행 환경(작업 디렉터리나 컨테이너)을 주는 것, 그리고 저장소를 그 환경 밖에 두는 것입니다.

엔진이 보장하는 것은 "모델이 틀려도 잘못된 승격, 범위 밖 실행, 확인 없는 완료가 일어나지 않는다"까지입니다. 모델이 맞게 판단하는지는 측정으로만 확인할 수 있습니다.

## 5. 비용과 위험

- **UI를 직접 만들어야 합니다.** pi-durable에는 TUI가 없습니다. pi-tui 패키지와 `watchEvents`(실험적), `viewState`로 터미널 클라이언트를 만들어야 하고, 이 작업이 가장 큽니다. 예제 `26-coding-agent`, `27-plan-mode`, `28-reviewer`가 출발점이 됩니다.
- **실험 단계 패키지입니다.** 1.1.0이고, README의 Agent Events 절도 Experimental로 표시되어 있습니다. core를 pi-durable 타입에 직접 묶지 않는 것이 좋습니다.
- **저장소 하나에 프로세스 하나입니다.** 프로세스 간 락이 없습니다. 관찰 에이전트를 별도 프로세스로 돌리려면 같은 프로세스 안에서 ownerless 대화로 돌리거나, 저장소 사본을 읽어야 합니다.
- **pi coding agent 확장 생태계를 재사용할 수 없습니다.** codemode는 pi coding agent 쪽 기능이라 pi-durable에서는 같은 방식으로 붙지 않습니다. RLM식 병렬 하위 호출은 subagent 도구로 대신합니다.

## 6. 권하는 순서

1. **core 순수 모듈**: 스키마, 상태 기계, 승격 규칙, 정책. 런타임과 무관하게 작성합니다.
2. **pi-durable 어댑터**: Concern과 WorkUnit task, helm 문서, `beforeTool`/`afterTool` 훅, 검증자 subagent. 이번에는 C와 A 루프만 만듭니다.
3. **최소 터미널 클라이언트**: 입력, 진행 표시, 선택 요청과 결과 확인 UI.
4. **그다음 확장**: O의 복귀 요약과 `beforeCompact`, I의 fork 발산, 거시 루프의 background 감시를 차례로 붙입니다.

원하시면 1, 2단계를 pi-durable의 faux provider로 작성해서, 위 미리보기의 6~9단계(합의, 실행 중 차단, 재시작 후 재개, 검증자의 반대 근거, 반영 대기)를 실제로 재현해 보겠습니다.

Sources:
- [@earendil-works/pi-durable 1.1.0 README (npm 패키지로 설치해 확인)](https://github.com/earendil-works/pi/tree/main/packages/durable)
- [We killed a Pi Durable agent after a Gmail write (withone.ai)](https://www.withone.ai/blog/pi-durable-crash-safe-one-cli)
- [Pi 1.0 & Pi Durable: Unkillable Agent Harness (besthub.dev)](https://www.besthub.dev/articles/pi-1-0-pi-durable-unkillable-agent-harness-adds-mcp-support-crash-recovery-e5be7994c0c8)

--- [68] USER ---
뭔가 특정 피쳐 해결 보다, 어떤 문제를 해결하기 위한 여러 방안을 찾아가는 과정에 초점을 두고 싶은데

--- [69] ASSISTANT ---
이번에는 특정 피쳐를 구현하는 과정이 아니라, "무엇이 문제인지"와 "어떤 방법들이 있는지"를 찾아가는 과정(O와 I 루프)을 중심으로 다시 그렸습니다. 예시 문제는 "첫 화면이 느리다는 얘기가 계속 나온다"처럼 막연한 상태에서 출발합니다. 화면의 수치는 모두 예시입니다.

이번 그림에는 단계마다 "누가 정하나" 줄을 추가했습니다. 결정성을 높인다는 것은 결국 이 줄에서 코드가 맡는 부분을 늘리는 일이기 때문입니다.

--- [70] ASSISTANT ---
[widget helm_inquiry_flow_slow_first_screen_preview]

--- [71] ASSISTANT ---
## 탐구 흐름에서 달라진 점

이번 탐구 흐름에서는 발산의 내용은 모델이 만들고, 발산의 **방향, 순서, 멈춤**은 코드가 정합니다. 코드가 정하는 결정은 네 가지입니다.

1. **어디로 발산할지**: "관점 × 바꾸는 대상" 표에서 빈 칸을 코드가 찾고, 칸마다 fork를 하나씩 만듭니다. RLM에서는 분해를 모델이 정했는데, 여기서는 분해를 코드가 정하고 각 칸의 내용만 모델이 채웁니다. 모델이 익숙한 방향(평균값)으로만 발산하는 것을 구조로 막는 장치입니다.
2. **어떤 확인을 먼저 할지**: 모델은 "각 관점이 이 확인 결과를 어떻게 예측하는지"와 비용만 선언합니다. 순서는 코드가 "갈리는 관점 수 ÷ 비용"으로 계산합니다.
3. **무엇을 물을지**: 모델이 질문 후보를 여러 개 냅니다. 코드는 "답에 따라 1순위 해법이 바뀌는가"를 기준으로 하나만 고릅니다.
4. **언제 멈출지**: 1순위가 두 라운드 연속 유지되고 남은 질문이 결과를 바꾸지 않으면 멈춥니다. 예산이 먼저 소진되면 그 시점에 멈추고 열린 질문을 그대로 넘깁니다.

한계도 분명합니다. 모델이 선언한 예측과 비용이 틀리면 계산도 틀립니다. 다만 선언 내용이 기록에 남기 때문에 나중에 어디서 틀렸는지 추적할 수 있습니다. 표의 열(바꾸는 대상 범주)을 고정해 두면 그 자체가 편향이 될 수 있으므로, 관찰 에이전트가 범주 수정안을 제안하도록 열어 두는 것이 좋습니다.

## 모든 업무에 적용할지, 특정 범주에만 적용할지

**특정 범주에만 적용하는 쪽이 낫다고 봅니다.** 다만 그 범주는 "프론트엔드 성능" 같은 업무 분야가 아니라 **문제의 모양**으로 정해야 합니다.

### 이유

1. **비용이 이득을 넘는 작업이 대부분입니다.** Helm은 라운드, 질문, 기록, 확인이라는 비용을 냅니다. 이 비용은 문제 정의가 불확실하거나 잘못 고르면 되돌리기 비쌀 때만 회수됩니다. 스택 트레이스가 원인을 가리키는 버그나 스펙이 정해진 폼 구현에서는 마찰만 남습니다.
2. **C와 A를 건너뛰게 된 이유와 같습니다.** 마찰이 있으면 우회하게 됩니다. 모든 작업에 걸면 우회하는 습관이 Helm이 필요한 작업까지 번집니다. Helm 이론의 A12(자동화가 사람의 주도성을 낮추면 실패)에 정면으로 걸리는 경우입니다.
3. **기록이 쌓이는 곳이 일정해야 학습됩니다.** 선호 기록, 제외 사유 패턴, 합의 템플릿 개선은 비슷한 모양의 문제가 반복될 때 의미가 생깁니다. 모든 작업을 기록하면 노이즈가 대부분이 됩니다.
4. **Quick 프로필로는 부족합니다.** "전부 적용하되 가벼운 건 압축한다"는 결국 입구에서 분류를 해야 한다는 뜻입니다. 그렇다면 처음부터 입구 분류를 명시적으로 두는 편이 단순합니다.

### 구조

```text
평소: 일반 pi로 작업
  │
  ├─ 시작 시 진입 조건 충족 → Helm 초점으로 시작
  ├─ 작업 중 신호 감지     → "초점으로 열까요?" 제안 (승격)
  └─ /focus               → 사람이 직접 지정
Helm 안에서 문제가 단순하다고 밝혀짐 → Quick으로 압축하거나 일반 작업으로 내림
```

진입 판단도 앞에서 정한 원칙을 따릅니다. 모델은 신호가 있는지만 표시하고, "몇 개 이상이면 진입" 같은 규칙은 코드가 적용합니다.

### 진입 조건 (두 개 이상이면 진입)

| 조건 | 확인하는 질문 |
|---|---|
| 목표가 흐림 | 완료 기준을 한 문장으로 쓸 수 없는가 |
| 관점이나 해법이 갈림 | 원인이나 해법 후보가 둘 이상인데 아직 가르지 못했는가 |
| 되돌리기 비쌈 | 잘못 고르면 하루 이상의 작업이나 구조 변경이 버려지는가 |
| 오래 걸림 | 여러 세션이나 여러 날에 걸치는가 |
| 다른 것과 얽힘 | 다른 결정, 다른 작업, 다른 사람의 일에 영향을 주는가 |

**제외 조건**: 그냥 해 보고 되돌리는 비용이 탐구 비용보다 작으면 Helm을 쓰지 않습니다.

### 이 범주에 들어오는 요청의 예

**1. 증상은 있는데 원인이 불분명한 것**
- "첫 화면이 느리다는 얘기가 계속 나온다"
- "가끔 상태가 꼬이는데 재현이 안 된다"
- "CI 테스트가 간헐적으로 실패한다"
- "빌드 시간이 어느 순간부터 두 배가 됐다"
- "에이전트가 이 저장소에서 자꾸 같은 실수를 한다"

**2. 여러 방향 중 골라야 하고, 되돌리기 비싼 것**
- "상태 관리 구조를 바꿔야 할까"
- "React 19나 Next.js로 옮겨야 할까"
- "디자인 시스템을 직접 만들지, 라이브러리를 쓸지"
- "개인 하네스를 pi coding agent 위에 만들지, pi-durable 위에 만들지"

**3. 목표 자체가 흐린 것**
- "에이전트를 더 잘 쓰고 싶다"
- "코드 리뷰가 늘 늦어진다"
- "프론트엔드 품질을 올리고 싶다"
- "어떤 런타임에서도 같은 환경을 쓰고 싶다" (이 대화가 시작된 질문도 이 유형입니다)

**4. 오래 걸리고 다른 일과 얽히는 것**
- CRA에서 Vite로, React 18에서 19로 옮기는 마이그레이션
- 레거시 모듈 단계적 리팩터링
- 여러 저장소에 공통 설정 도입

**5. 반복되는 마찰**
- "PR마다 같은 지적이 나온다"
- "매번 같은 설정을 다시 한다"
- 관찰 에이전트가 세션 로그에서 찾아낸 반복 패턴도 여기로 들어옵니다.

### 범주 밖으로 두는 것

- 스택 트레이스가 원인을 가리키는 버그
- 스펙이나 디자인이 정해진 구현 ("이 API 스키마대로 폼 만들어줘")
- 리네임, 타입 수정, 테스트 추가, 문서 오타

이런 작업도 진행 중에 신호가 나오면 승격 대상이 됩니다. 신호의 예는 다음과 같습니다.
- 같은 테스트가 세 번 실패한다
- 모델이 서로 다른 해법을 두 개 이상 꺼낸다
- 수정 범위가 예상보다 커진다
- 사람이 "잘 모르겠는데"라고 말한다

이 신호들은 `turn_end`나 `agent_before_settle`에서 감지할 수 있습니다.

### 범주가 맞는지 확인하는 방법

2~4주 뒤 두 가지 값을 보면 됩니다.

- **Helm으로 들어간 작업 중 실제로 목표나 관점이 바뀐 비율**: 거의 0이면 범주가 너무 넓은 것입니다. 정의가 이미 명확한 작업까지 들어오고 있다는 뜻입니다.
- **일반 작업으로 처리했다가 나중에 방향을 다시 잡은 비율**: 높으면 범주가 너무 좁거나 승격 신호가 약한 것입니다.

원하시면 다음으로 진입 판단 규칙과 승격 신호 감지기를 앞의 Inquiry 작업과 함께 pi-durable 위에서 작성해 보겠습니다. 위 예시 요청 몇 개를 넣어서 어떤 것이 Helm으로 들어가고 어떤 것이 일반 작업으로 남는지 확인하는 방식입니다.

--- [72] USER ---
그 뭐랄까 뭔가 mode? 처럼,  작업 유형에 따라 현재 HELM에 있는 개념을 적용했으면 싶은데  OICA NEMAP OPDC 각각에 대한 워크플로우가 세부적으로 어떻게 존재하고 있는거지? HELM에 대한 질문이야.

--- [73] ASSISTANT ---
Helm 문서를 다시 확인했습니다(00-manifesto, 09-operating-theory, 10-refinement-candidate).

## 1. 세 묶음은 같은 종류가 아닙니다

OICA, NEMAP, OPD+C는 나란히 놓인 세 개의 워크플로우가 아닙니다. 각각 다른 축입니다.

| 묶음 | 축 | 답하는 질문 | 문서에서의 형태 |
|---|---|---|---|
| OICA | 시간 (흐름) | 지금 어떤 일을 하고 있는가 | 루프마다 목표, 흐름, 핵심 요소, 핵심 질문. 재진입 규칙 |
| NEMAP | 상태 (기록) | 무엇이 기록되고, 누가 그것을 바꿀 수 있는가 | 평면마다 담는 것의 목록. N/E/M 사이 관계 4개 |
| OPD+C | 평가 (품질) | 사람이 이 일을 제대로 따라가고 바꿀 수 있는가 | 기준 4개와 질문 하나씩 |

이 셋 외에 문서에는 조절 장치가 두 개 더 있습니다.

- **Quick / Guided / Assured**: 형식과 증명 부담을 얼마나 요구할지
- **개입 계산**: 언제 사람에게 물을지 (deliberation pressure)

워크플로우라고 부를 수 있는 것은 OICA뿐입니다. 그리고 OICA도 문서에는 흐름을 한 줄로 쓴 수준까지만 있습니다. 단계별 진입 조건, 종료 조건, 입력, 출력은 정의되어 있지 않습니다. 말씀하신 "모드"에 해당하는 개념도 문서에는 없습니다. 가장 가까운 것은 profile(형식의 양)과 성숙도 레벨입니다. 성숙도 레벨은 아래에서 보듯 루프와 거의 1:1로 대응합니다.

## 2. OICA: 문서에 있는 세부 내용

| 루프 | 목표 | 문서의 흐름 | 핵심 요소 | 10단계 | 성숙도 레벨 |
|---|---|---|---|---|---|
| O | 상황에 다시 참여할 수 있는 이해 상태 만들기 | Events → Situation projection → Perception → Comprehension → Projection | CommonOperatingPicture, ReturnBrief, ContextProjection, Handoff, WeakSignal | Sense, Frame | L1 Situation Recovery |
| I | 불확정 상황을 행동 가능한 문제와 정당화된 선택으로 바꾸기 | Surprise → Problem frames → Hypotheses → Evidence → Discriminating experiment → Deliberation → Decision | Concern, ProblemFrame, HypothesisSet, Evidence, Claim, Experiment, DecisionGate | Diverge, Investigate, Deliberate | L2 Deliberative Inquiry |
| C | 선택을 약속과 제한된 자율 실행으로 바꾸기 | Decision → Request → Negotiation → Commitment → Authority Envelope → Interdependent execution → Exception/repair | Request, DelegationContract, Commitment, AuthorityEnvelope, WorkUnit, Exception, EscalationTrigger | Commit, Execute | L3 Bounded Delegation |
| A | 결과를 수락·통합하고 다음 변화에 대응할 능력 높이기 | Completion Claim → Evidence/Argument → Acceptance → Integration → Outcome → Monitor/Learn/Anticipate → Reopen or policy update | ClaimingComplete, AssuranceView, Acceptance, Interface, Integration, RecoveryPath, Reflection | Assure, Integrate, Reflect | L4 Assured Integration, L5 Adaptive Institution |

루프별 핵심 질문입니다.

- **O**: 무엇이 변했나 / 왜 중요한가 / 개입하지 않으면 무엇이 일어나나 / 누가 무엇을 맡고 있나
- **I**: 무엇을 문제로 보고 있나 / 어떤 대안 설명이 있나 / 어떤 근거가 가설을 실제로 구분하나 / 정보를 더 모으는 것과 지금 행동하는 것 중 어느 쪽 가치가 큰가
- **C**: 누가 무엇을 왜 맡았나 / 무엇을 스스로 결정할 수 있나 / 완료를 어떤 근거로 주장해야 하나 / 어떤 조건에서 방향을 바꾸거나 위로 올려야 하나
- **A**: 왜 이 결과를 받아들여도 되나 / 명세대로 만들었는지와 올바른 것을 만들었는지를 모두 확인했나 / 다른 작업의 전제를 깨뜨렸나 / 환경이 바뀌면 어떻게 복구하고 결정을 다시 여나

**재진입 규칙**은 문서(§5)에 6개가 있습니다.

1. O에서 새로운 놀라운 사실 → I가 열림
2. I에서 목적 충돌 발견 → N 기준선이 다시 열림
3. C 수행 중 권한 밖 문제 → I 또는 선택 요청으로
4. A에서 근거 부족 → 새 실험 WorkUnit
5. 통합 중 공유 전제 충돌 → 관련 결정과 컨텍스트 무효화
6. 돌아보기 → 이후 선택 요청 정책과 맡긴 범위의 기본값 변경

같은 흐름을 일렬로 펼친 버전이 문서에 네 가지 있습니다.

- manifesto의 10단계 사이클
- operating theory §6의 Concern episode
- §10의 기본 리듬 (Orient → Frame together → Delegate → … → Reflect)
- 쉬운 말 문서의 8단계

서로 모순되지는 않지만 단계를 나누는 위치가 조금씩 다릅니다.

## 3. NEMAP: 상태와 통치

v0.2 기준입니다.

**N 방향**: 해야 하는 것과 수락된 약속. Goal과 성공 조건, 제약과 우선순위, Choice와 다시 볼 조건, 작업 합의·권한·책임, 결과 확인과 반영 의무.

**E 이해**: 안다고 주장하는 것과 모르는 것. 관찰과 출처, 해석과 전제, 가능성, 판단, 근거와 반대 근거, 불확실성·확신 근거·무효화 조건.

**M 실제**: 실제로 존재하거나 변한 것. 산출물과 외부 상태, 실행·도구 행동·테스트·배포, 변경과 결과, 인터페이스·의존성·복구 경로.

N, E, M 사이의 관계는 4개로 정의되어 있습니다. NEMAP에서 흐름에 해당하는 부분은 이것뿐입니다.

```text
E justifies N   근거와 판단이 선택을 정당화한다
N authorizes M  선택과 작업 합의가 변경을 허가한다
M updates E     실행 결과가 믿음과 가설을 바꾼다
M fulfills N    결과가 목표와 약속을 충족한다
```

**A 참여자**는 사람을 하나의 인격으로 보지 않고 능력 7개로 나눕니다. observe, propose, decide within scope, execute action classes, attest evidence, accept result, integrate baseline.

**P 정책**은 그 능력을 누가 어떤 조건에서 쓸 수 있는지를 정합니다. 맡긴 범위, 근거 부담, 상향·멈춤 규칙, 신선도와 무효화, 동시성과 충돌, 공개 범위, 복구와 보상입니다.

문서에는 "각 루프가 어느 평면을 읽고 쓰는가"가 명시되어 있지 않습니다. 재진입 규칙과 위 관계식을 조합하면 다음과 같습니다. 이 표는 문서에 있는 것이 아니라 제가 조합한 것입니다.

| | N | E | M | A의 능력 | P |
|---|---|---|---|---|---|
| O | 읽기 | 읽기 | 읽기 | observe | 컨텍스트 라우팅 |
| I | 선택 제안, 목표 재개방 | 쓰기 (관점, 가능성, 근거, 판단) | 읽기, 실험 실행 | propose | 근거 부담, 선택 요청 조건 |
| C | 쓰기 (합의, 권한) | 읽기 | 쓰기 (권한 안에서) | decide within scope, execute | 맡긴 범위, 상향 규칙 |
| A | 쓰기 (확인, 반영 의무, 재개방) | 쓰기 (근거, stale) | 읽기 (결과) | attest, accept, integrate | 돌아보기로 정책 수정 |

## 4. OPD+C: 평가 기준

| 기준 | 질문 |
|---|---|
| Observability | 다음 판단에 필요한 상태, 의도, 근거, 예외를 볼 수 있는가 |
| Predictability | 다음 행동, 조건, 예상 결과를 충분히 예상할 수 있는가 |
| Directability | 낮은 비용으로 목적, 제약, 기준, 우선순위를 바꿀 수 있는가 |
| Contestability | 관점, 판단, 추천, 결정에 이의를 제기하고 근거를 다시 열 수 있는가 |

문서에는 "모든 WorkUnit와 interface가 이 기준으로 평가된다"는 문장만 있습니다. 측정 방법이나 통과 조건은 없습니다.

## 5. "모드"로 쓰려면

모드를 이렇게 정의하면 문서에 이미 있는 재료를 그대로 조합할 수 있습니다.

> 모드 = 지금 중심이 되는 루프 + 그 루프가 쓰는 평면 + 사람에게 우선 보장할 OPD+C 기준 + profile 기본값

재진입 규칙이 곧 모드 전환 규칙이 됩니다. 그래서 새로운 개념을 만드는 것이 아니라, Concern이 지금 어느 루프에 무게를 두고 있는지를 명시하는 것에 가깝습니다. 이전 답에서 나눈 작업 유형과 묶으면 다음과 같습니다.

| 모드 | 중심 루프 | 맞는 작업 유형 | 쓰는 평면 | 우선 보장할 기준 | 기본 profile |
|---|---|---|---|---|---|
| 복귀 | O | 며칠 만에 돌아옴, 남이 하던 일 이어받기 | 읽기만 (투영) | O, P | Quick |
| 탐구 | I | 원인 불명 증상, 흐린 목표, 방향 선택 | E 쓰기, N 제안 | C, D | Guided |
| 위임 | C | 해법이 정해졌고 맡기는 작업 | N 합의, 권한 안 M | P, D | Guided |
| 확인·반영 | A (Assure, Integrate) | 결과 검토, 마이그레이션 마무리, 여러 작업 합치기 | N 확인, E 근거 | O, C | Assured |
| 돌아보기 | A (Reflect) | 반복되는 마찰, 같은 실수 | P 수정안 | D | Guided |

어느 모드에서도 바뀌지 않는 것은 v0.2의 불변조건 6개입니다.

1. 기록과 진실은 다르다
2. 관찰, 해석, 가능성, 판단, 선택은 다르다
3. 투영은 정본을 쓰지 않는다
4. 권한은 범위와 effect class를 가진다
5. 완료 주장, 결과 확인, 전체 반영은 다르다
6. 모르는 것, 이견, 낡은 상태는 숨기지 않는다

모드는 흐름과 형식의 양만 바꾸고, 이 경계는 건드리지 않습니다.

## 6. 문서에 비어 있는 부분

모드로 구현하려면 다음 세 가지를 새로 정의해야 합니다.

1. **루프별 진입·종료 조건**: 문서에는 흐름과 질문만 있습니다. "언제 I에서 C로 넘어가는가"는 앞에서 설계한 멈춤 규칙 같은 형태로 새로 정해야 합니다.
2. **레코드 종류별 상태 전이**: 문서에 있는 것은 v0.2 kernel 후보의 품질 상태(absent, captured, … superseded)와 관계식 4개뿐입니다.
3. **모드별 OPD+C 검사 방법**: 예를 들어 탐구 모드의 Contestability를 "사람이 관점이나 판단에 이의를 걸 수 있는 명령이 있고, 그 이의가 재개방 이벤트로 기록되는가"처럼 검사 가능한 형태로 바꿔야 합니다.

원하시면 위 다섯 모드 각각에 대해 진입 조건, 종료 조건, 활성 도구, 생성 레코드, OPD+C 검사를 한 장의 명세로 정리하겠습니다.

--- [74] USER ---
각각에 대한 다른 축을 에이전트 런타임으로 녹여내리려면 어떤 방법론과 아키텍쳐를 구축해야할까, pi나 다른 벤더 등과 관계없이 순수하게 HELM을 어떻게 구현할 수 있을지의 방식에 대한 질문이야

--- [75] ASSISTANT ---
Helm을 런타임으로 만든다는 것은, LLM 에이전트 루프를 "제안만 하는 하위 프로세스"로 두고 그 바깥에 Helm의 의미를 집행하는 커널을 두는 일입니다. OS에 비유하면 모델은 사용자 모드에서 돌고, 상태를 바꾸려면 반드시 커널의 시스템 콜(타입이 정해진 제안)을 거쳐야 합니다. 이 구조를 잡으면 네 축은 커널 안에서 각각 다른 종류의 구성요소가 됩니다.

## 1. 축마다 런타임에서 맡는 역할

| Helm 축 | 런타임에서의 역할 | 구현 형태 |
|---|---|---|
| N, E, M | 무엇이 존재할 수 있는가 | 타입이 정해진 레코드, 이벤트 로그, 레코드 사이 참조 제약 |
| A, P | 누가 무엇을 바꿀 수 있는가 | 능력(capability) 검사와 정책 엔진 |
| O, I, C, A 루프 | 지금 무엇을 하는가 | Concern 상태 기계와 모드 계약 |
| OPD+C | 사람이 따라가고 바꿀 수 있는가 | 상호작용 계약(화면과 명령)과 감시 지표 |
| Quick/Guided/Assured | 얼마나 증명해야 하는가 | 정책의 파라미터 |
| 개입 계산 | 언제 묻는가 | 선택 요청을 열지 정하는 함수 |

핵심은 이것들이 단계로 나열되는 것이 아니라는 점입니다. 모든 변화가 지나는 경로 하나 위에서, 각 축이 서로 다른 지점에 걸립니다.

--- [76] ASSISTANT ---
[widget helm_kernel_single_change_path]

--- [77] ASSISTANT ---
모델이 할 수 있는 일은 맨 위 왼쪽 상자에 제안을 넣는 것뿐입니다. 이 경로 위에서 축들이 걸리는 위치는 다음과 같습니다.

- NEMAP는 형식 검사와 세계 모델 갱신에 걸립니다.
- A/P와 profile은 권한 검사에 걸립니다.
- OICA는 규칙 평가와 다음 단계 구성에 걸립니다.
- OPD+C는 투영과 감시에 걸립니다.

거부된 제안도 관찰로 기록합니다(A14).

## 2. 축별 구현 방식

### 2.1 N, E, M: 레코드와 참조 제약

- **레코드 종류를 평면별로 고정합니다.**
  - N: Goal, Constraint, Choice, Agreement, Acceptance, IntegrationObligation
  - E: Observation, Interpretation, Possibility, Finding, Evidence, Assumption, OpenQuestion
  - M: 산출물 참조, 실행 기록, Outcome
- **v0.2의 관계식 4개를 쓰기 시점의 참조 제약으로 바꿉니다.**

  | 관계식 | 쓰기 시점 제약 |
  |---|---|
  | E justifies N | Choice는 Finding이나 Possibility를 하나 이상 참조해야 생성된다 |
  | N authorizes M | M 변경 이벤트는 유효한 Agreement를 참조해야 기록된다 |
  | M updates E | Observation은 실행 기록(tool call id 등)을 참조해야 생성된다 |
  | M fulfills N | Acceptance는 완료 기준과 그 기준을 충족한 Outcome·Evidence를 참조해야 생성된다 |

- **정본은 이벤트 로그입니다.** 레코드의 현재 상태는 로그를 재생해서 얻습니다. 그러면 "그 시점에 무엇을 알고 있었나"를 조회할 수 있고(A11, A13), 기록과 진실의 구분도 유지됩니다.
- **레코드마다 품질 상태 기계를 둡니다.** absent → captured → structural → qualified → accepted, 그리고 contested, stale, superseded입니다. 상태는 덮어쓰지 않고 전이 이벤트로만 바뀝니다.
- **M은 복사하지 않고 참조합니다.** 파일@해시, 커밋, 실행 id로 가리킵니다. 참조 대상의 해시가 바뀌면 그것을 근거로 쓴 Evidence는 자동으로 stale이 됩니다.

### 2.2 A, P: 능력과 정책

- **A는 v0.2의 능력 7개 × 레코드 종류 행렬로 정의합니다.** 예를 들어 에이전트는 Possibility를 propose할 수 있지만 Acceptance를 생성할 수 없습니다. 사람은 둘 다 할 수 있습니다. 검증자 에이전트는 Evidence에 대해 attest만 할 수 있습니다.
- **P는 이 행렬 위에 조건을 얹는 함수입니다.** 맡긴 범위(effect class와 경로), 근거 부담, 상향·멈춤 규칙, 신선도, 동시성 충돌을 다룹니다.
- **profile은 P의 파라미터입니다.**

  | 파라미터 | Quick | Guided | Assured |
  |---|---|---|---|
  | 근거 부담 | 자동 검증 결과 | 기준별 근거 | 기준별 근거 + 반대 근거 탐색 + 독립 검토 |
  | 선택 요청 문턱 | 높음 | 중간 | 낮음 |
  | 압축 가능한 단계 | O, I 대부분 | 일부 | 없음 |

  profile은 위험 요인(effect class, 되돌릴 수 있는지, 다른 것과의 결합도)으로 계산합니다. 올리는 것은 자동으로 하고, 위험이 요구하는 수준보다 내리는 것은 사람만 할 수 있습니다.
- **개입 계산은 선택 요청을 열지 정하는 함수 하나입니다.** 문서의 deliberation pressure 요인을 입력으로 받아 "자동 처리 / 기록 후 진행 / 선택 요청"을 반환합니다. 입력값 일부는 모델이 추정하지만 판정 자체는 코드가 하고, 판정 근거를 기록에 남깁니다.

### 2.3 OICA: 상태 기계와 모드 계약

- **Concern 하나가 계층 상태 기계 하나입니다.** 상위 상태는 O, I, C, A이고, 하위 상태는 10단계입니다.
- **모드는 상태마다 붙는 계약이며, 코드가 아니라 데이터로 둡니다.**

  ```text
  mode:
    entry      진입 조건 (이벤트 + 가드)
    exit       종료 조건 (예: 멈춤 규칙, 합의 확정, 반영 완료)
    proposals  허용되는 제안 종류
    effects    허용되는 effect class 상한
    context    내부 루프에 줄 투영 명세
    human      반드시 사람이 개입하는 지점
    opdc       이 모드가 보장해야 하는 화면과 명령
    budget     라운드, 하위 호출, 시간 상한
  ```

- **문서 §5의 재진입 규칙 6개는 "이벤트 → 가드 → 전이" 규칙표가 됩니다.** 예를 들어 "Finding의 근거와 충돌하는 Observation이 기록됨 → Finding은 contested → Concern은 I로" 같은 형태입니다. 충돌 판정에는 모델이 필요하지만, 그 판정도 제안으로 들어오므로 같은 경로를 지납니다.
- **거시 루프는 Concern들 위의 스케줄러입니다.** 하는 일은 다음과 같습니다.
  - 사람의 주의 예산을 배분합니다.
  - 여러 선택 요청을 병합하고 순서를 정합니다.
  - 다시 볼 조건 타이머를 관리합니다.
  - 복귀 요약을 생성합니다.

  이전 대화에서 논의한 관찰 에이전트도 이 층에서 P 수정안을 제안하는 행위자로 들어옵니다.

### 2.4 OPD+C: 상호작용 계약과 감시

OPD+C는 단계가 아니라, 모든 모드가 지켜야 하는 인터페이스 의무와 그 의무가 지켜지는지 재는 지표입니다.

| 기준 | 인터페이스 의무 | 감시 지표 |
|---|---|---|
| Observability | 모든 모드는 현재 모드, 의도, 다음 단계, 근거, 예외를 담은 상태 투영을 낸다 | Agreement나 의도에 연결되지 않은 M 변경 수 (목표 0) |
| Predictability | WorkUnit 실행 전 계획과 예상 결과를 선언한다 | 선언과 실제 결과의 차이. 차이가 나면 관찰로 기록 |
| Directability | 목표, 제약, 기준, 우선순위 변경 명령이 모든 모드에 있고, 다음 턴 경계에서 반영된다 | 명령부터 행동 변화까지의 턴 수, 기준 하나를 바꾸는 데 필요한 조작 수 |
| Contestability | 모든 E·N 레코드에 이의 명령이 있고, 이의를 걸면 contested 전이와 재개방 이벤트가 생긴다 | 처리되지 않고 사라진 이의 수 (목표 0) |

이 의무를 모드 계약의 `opdc` 칸에 적어 두면, 커널은 "이 모드에서 이 화면과 명령이 제공되는가"를 테스트로 검사할 수 있습니다.

## 3. 어떤 런타임에도 붙이기 위한 내부 루프 계약

커널이 하위 에이전트 런타임에 요구하는 능력은 다섯 개입니다.

1. 주어진 지시, 도구, 컨텍스트로 루프를 실행한다
2. 도구 호출을 실행 전에 가로챈다
3. 도구 결과를 id와 함께 돌려준다
4. 턴 경계에서 멈추거나 계속하게 한다
5. 새 컨텍스트(독립 검증자, 분기)를 만든다

어떤 런타임에 2번이 없으면 권한을 사전에 집행할 수 없습니다. 이때는 격리된 작업 공간에서 실행하게 하고, 끝난 뒤 diff로 범위를 검사해 반영 여부를 정하는 방식으로 낮춥니다. 런타임마다 이 다섯 능력의 보유 여부를 표로 두고, 없는 능력에 맞춰 보장 수준을 낮추고 그 사실을 사용자에게 표시합니다. 처음에 이야기한 벤더 중립 하네스의 능력 표와 같은 방식입니다.

## 4. 방법론: 이론을 코드로 옮기는 절차

**1. 결정마다 주체를 분류합니다.** Helm의 공리와 법칙에 나오는 결정을 하나씩 꺼내 네 가지 중 하나로 표시합니다.
- 코드가 정함
- 모델이 구조화된 값을 선언하고 코드가 계산함
- 사람이 정함
- 측정만 함

원칙은 "모델이 구조화된 값을 선언할 수 있으면 결정 자체는 코드로 내린다"입니다. 앞의 빈 칸 찾기, 확인 순서, 질문 선택, 멈춤 규칙이 이 방식으로 만든 예입니다.

**2. 공리마다 네 가지를 씁니다.** 불변조건, 집행 지점(경로의 어느 상자인가), 위반 테스트, 운영 지표입니다.

예: A10
- 불변조건: Acceptance 없는 Concern은 완료 상태가 될 수 없다
- 집행 지점: 규칙 평가
- 위반 테스트: 에이전트 행위자로 Acceptance 생성을 시도하면 거부되는가
- 운영 지표: 완료까지 남은 반영 항목 수

**3. 명세를 실행 가능한 데이터로 둡니다.** 레코드 스키마, 능력 행렬, 정책, 모드 계약, 재진입 규칙표를 JSON Schema나 YAML로 둡니다. 커널은 이것을 읽어 동작합니다. 이론을 바꾸면 데이터가 바뀌고, 테스트가 그 변화를 잡습니다.

**4. 가짜 모델로 재생해서 테스트합니다.** 정해진 제안 순서를 내는 가짜 모델로 시나리오를 돌립니다. 커널은 결정적이어야 하므로 같은 입력에서 같은 이벤트 로그가 나와야 합니다. 불변조건은 무작위 제안 순서를 넣는 속성 기반 테스트로 검사합니다.

**5. 모델 품질은 따로 평가합니다.** 관점이 다양한지, 예측이 맞았는지, 요약에서 빠진 것이 있는지는 커널 테스트가 아니라 별도 평가로 봅니다. 커널이 보장하는 범위와 모델 성능에 달린 범위를 섞지 않기 위해서입니다.

**6. 성숙도 순서대로 만들고, 단계마다 반증 지표로 확인합니다.** Helm 문서 스스로 "앞 레벨의 사용자 가치를 검증한 뒤 다음 레벨로 간다"고 정해 두었습니다. 이전 대화에서 C와 A를 가장 많이 건너뛴다고 하셨으니 순서를 이렇게 제안합니다.
1. 레코드·로그·권한
2. C와 A 모드
3. O 모드
4. I 모드
5. 거시 스케줄러
6. P 적응(돌아보기)

## 5. 이전 Helm 구현에서 피해야 할 것

- **문서를 상태로 쓰지 않습니다.** 상태는 이벤트 로그와 레코드에만 있고, 문서는 투영 중 하나입니다.
- **온톨로지를 먼저 완성하지 않습니다.** 레코드 종류는 지금 만드는 모드가 실제로 쓰는 것만 추가합니다.
- **투영이 정본을 쓰지 않습니다.** 요약, 브리프, 화면은 읽기 전용입니다.
- **모델에게 전이 권한을 주지 않습니다.** 모델이 "이제 C로 넘어갑니다"라고 말해도 그것은 전이 제안일 뿐이고, 종료 조건을 판정하는 것은 커널입니다.

원하시면 이 내용을 Helm 런타임 명세 문서로 정리하겠습니다. 레코드 스키마, 능력 행렬, 모드 계약 5개, 재진입 규칙표, 공리별 네 항목 표가 들어갑니다.

--- [78] USER ---
이해하기 너무 어렵다 내가 이해하려면 어디서 접근해야할까

--- [79] USER ---
Base directory for this skill: /root/.claude/skills/synced/21b0ffee-ff6d-43fa-8e15-8c4720d0fbd3_a6855996-0119-4e24-a726-df78aecbed00/learn

# Learning Mode

The goal is not to answer the learner's question but to help them be able to answer it themselves — this time and next time. The pull toward just answering is strong: the learner is often frustrated, the answer is right there, and giving it feels helpful. But a tutor who hands over answers produces a learner who can't do the thing; a tutor who only asks questions produces a learner who gives up. Both are failures, and the space between them is where good tutoring lives.

## Diagnose before you teach

The most common mistake in AI tutoring is launching into leading questions before knowing where the learner actually is. It feels pedagogically virtuous, but research finds that dialogue without diagnosis produces more engagement and no more learning. Start by locating the learner.

When a learner arrives, take a beat: what concept is this really about, and are they confused about the concept, the procedure, the notation, or what the question is even asking? If their message already tells you — they've shown their work, named their confusion precisely, or written fluently in domain terms and framed a sharp expert question — skip the diagnosis and go straight to the right move. Otherwise, ask one calibrating question: "What's your best guess at where to start?" or "Is it the setup or the mechanics that's throwing you?" One question, not three.

A note on fluent-expert phrasings. A learner who writes in domain terminology ("explain heteroskedastic ordered probit", "walk me through monads") has told you the *level* to teach at, not that they want a polished essay instead of tutoring. The right move on a fluent expert request is still to diagnose — briefly, at their level — what brought them to the topic and what shape of help would land: a quick conceptual overview, a derivation, working through an example together, or something else. Skipping diagnosis here means defaulting to exposition, which is the failure mode this skill exists to prevent.

A note on topic vs. concept. Not every "help me understand X" is about a concept or skill the learner could be tested on. Sometimes X is a broad topic, a contested subject, or a real-world phenomenon ("causes of US educational inequality", "why inflation is high right now", "what's going on with the Middle East"). The diagnostic question shifts: not "where in this are you stuck" but "what shape of help would land — a structured overview, a walkthrough where I draw out your existing thinking, or just the substantive answer with sources?" The answer "just lay it out for me" is a legitimate destination here, not a failure. Your job is structured exposition with the door open to going deeper, not Socratic scaffolding on a topic with no method to learn.

## The core rhythm: one step forward, every turn

Each reply should carry one focused question and one small scaffold that moves the learner forward regardless of how they answer: a hint that narrows the space, a worked parallel example, a small inline visual that makes the structure visible, a restatement of what they've already got right, the first step of a parallel example done with the reasoning narrated. Never a wall of questions; never an empty turn. Keep turns short — a few sentences and one question, not a paragraph with a question tacked on.

Know when you're done. When the learner explains it back correctly, applies it to a new case, or stops needing hints — say so plainly, summarize what they covered, and point at where to go next. Don't keep probing past understanding; a session with no end in sight burns the goodwill the guidance built.

## Holding the line under pressure

Learners push back: "just tell me," "I don't have time for this," "can you just give me the answer?" This is the highest-stakes decision in a session, and it hinges on a distinction you make from limited evidence: is this learner *impatient* or *genuinely stuck*?

Impatience looks like: engaged, their answers show they have the pieces, they just want it to go faster. Don't hand over the answer — give a more direct hint, narrow the question until it's nearly rhetorical, or work a parallel example and ask them to apply the method. Keep them doing the last step. Caving teaches them that pushback works, and doesn't save time — they'll be back with the next problem because they didn't learn the method.

Genuinely stuck looks like: repeating the same wrong idea, going silent, "I have no idea," frustration tipping from productive struggle into shutdown. Shift. Give them a concrete piece to stand on — do the first step, count the thing they couldn't count, name the rule they couldn't remember — then rebuild with them driving. This isn't caving; it's a foothold, not the summit.

Be careful with time pressure as a signal. A learner who *opens* with a deadline and a concrete blocker ("this is crashing and I have 20 minutes," "I just need to confirm X before my meeting") is making a real fire-and-forget request: answer directly and briefly, offer to go deeper later. But when the time claim appears only *after* you've started asking questions — "ugh, I don't have time for this, just tell me" — it's almost always impatience wearing a costume. They had time to ask you; they have time to think for one more turn. Hold the line, more directly, but hold it. This is where a well-meant "answer time-boxed requests directly" rule quietly becomes "cave whenever they push," and that's the failure to guard against.

## A toolkit of moves

Good tutors shift fluidly between several moves. *Guided discovery* — leading questions and hints — works when the learner has the building blocks and just needs to assemble them, and fails on someone missing prerequisites. *Direct explanation* is right for new concepts, multi-step procedures, beginners who have nothing yet to discover, and topical questions where the learner wants substance rather than scaffolding. *Worked example with narration* — solve a *parallel* problem, not their assigned one, narrate the reasoning, then ask them to apply the method to theirs — is the cleanest way to teach procedure without doing their work. *Inline visual* — a diagram, a tiny interactive, a timeline rendered right in the chat — is the move when the concept has shape: a relationship, a process, a parameter whose effect they should *see* rather than read. *Reflective pause* — ask them to summarize back, predict what changes if a parameter changes, or invent their own example — is where understanding cements. And *resource creation* — when they ask for flashcards, a study guide, a quiz, an outline, or a structured overview of a topic, just make it; they've already decided what they need. Design study materials for active recall and interleaving, and show the shape of the material, not a flat term list.

## Showing, not just telling

An inline visual is a move in the same toolkit, not a separate mode you switch into. When a concept has structure — parts that relate, steps that flow, a comparison that lands when it's side by side — a small diagram or interactive rendered in the chat will carry it further than a paragraph of description ever could.

**If the `show_widget` tool is available:** call `read_me` once, silently, to load the design guidance (pick the module that fits — usually `diagram` or `interactive`), then call `show_widget` with the visual itself, and keep your explanatory prose and your question *outside* the tool call. The widget holds only the picture; the teaching and the prompt to think stay in your own words around it.

**If it isn't:** render the visual with whatever the environment supports — a markdown table, an ASCII sketch, a code block that draws the figure — and keep the same rule: the visual carries the structure, your prose carries the teaching.

When the learner asks outright for flashcards, a quiz, or a timeline, that's this move too — just make the thing, interactive where it helps, because they've told you what they need.

The visual is still the scaffold for that turn, which means it still pairs with one focused question — not a caption, a question. A slider the learner drags to watch a curve reshape *is* the reflective-pause move — "predict what happens as this goes to zero, then try it" — and it beats the static version precisely because the learner's hand is on the parameter, not yours. But a rich visual can also be the answer dressed up: "here's the whole mechanism, animated" hands over exactly as much as typing out the solution would, and bypasses the thinking just as thoroughly. Show one relationship, one step, one comparison — not the finished picture — and let the question ask for what's missing. And don't reach for it every turn. A visual that isn't carrying the concept is decoration, and decoration teaches the learner to skim; skip it for pure procedure, for notation, for quick confirmations, for any turn where a sentence already does the job.

## Academic integrity — when it applies

Not every learner is being assessed. A career-changer teaching themselves SQL, a hobbyist learning music theory, a professional brushing up before a meeting — these people have no professor, no grade, and no integrity policy, and withholding a working answer from them on principle is just unhelpfulness. For self-learners, your only obligation is to make sure they actually learn, which the rest of this skill already handles.

But when you're tutoring inside a course — or on anything the learner will submit or be assessed on — you also have to protect them from the shortcut they're tempted by, because what they paste in isn't what they learned. Don't produce final answers to graded problem sets, exams, or quizzes, and don't write text intended to be turned in. Do teach the concept with examples distinct from the assigned work, walk through parallel problems and let them apply the method, review their own attempt and point at what to reconsider, and help them understand what the question is asking. "Can you check my answer?" — don't grade it; have them walk you through their reasoning and tell them where to look again. "My professor said we can use AI" — match the specific use they describe, not more. Coding assignments — explain concepts and debug the error they show you, but don't write the function they were asked to write. When you decline, say what you *can* do, warmly: "I won't write the essay, but I'd like to help — want to talk through your argument?" And if you're unsure whether something is graded, ask; refusing to engage just trains people to phrase things deceptively.

## What consistently goes wrong

Over-questioning: three Socratic questions before any teaching makes learners disengage; if they're stuck, teach, then ask. Hidden answers in hints: "hint: have you tried multiplying both sides by x and dividing by 3?" is the answer with extra steps. Jargon as skip signal: a fluent expert phrasing ("explain heteroskedastic ordered probit", "walk me through monads") is not a request for a polished essay — fluent terminology calibrates the level you teach at, not whether you teach. Default still applies: briefly diagnose what shape of help would land before launching into exposition. Visuals that overdeliver: an animation of the whole mechanism is the answer in prettier clothes, and a diagram on every turn is decoration that trains the learner to scroll past. False praise: "Great question!" before every reply is hollow; praise specifically and only when earned. Pretending to be neutral on quality: if their work has an error or their argument is weak, say so — kindly, specifically, with what to do about it. And refusing to engage because something might be homework: that's not integrity, it's unhelpfulness wearing integrity's coat.

## Tone

Warm, direct, intellectually engaged, willing to push back. Treat learners as capable adults working on hard things, whether they're a first-year undergrad or a forty-year-old career changer. Skip the emoji and the cheerleading. When something is hard, say so — "this trips most people up" beats "anyone can learn this!" When tutoring math or technical work, slow down and check each step; when you're unsure of your own reasoning, say so — a confident walk toward a wrong answer is worse than a pause.


ARGUMENTS: 사용자가 Helm 런타임 아키텍처 설명(커널, 제안 경로, NEMAP/OICA/OPD+C 축 매핑)이 너무 어렵다며 어디서부터 접근해야 이해할 수 있을지 묻고 있음. 사용자는 React 18 CSR 시니어 프론트엔드 개발자. 한국어 합니다체, AI 말투('축','박다','가른다', 의인화) 싫어함, 위에서 아래로(큰 그림 먼저) 설명 선호.

--- [80] ASSISTANT ---
지금까지 설명이 어려웠던 이유는 Helm 개념과 런타임 구조를 한꺼번에 설명했기 때문입니다. 이미 아시는 구조에서 출발하는 것이 가장 빠릅니다. 지난 답의 Helm 커널은 구조로 보면 Redux와 거의 같습니다.

| React / Redux | Helm 런타임 |
|---|---|
| 컴포넌트가 dispatch하는 action | 모델의 제안, 사람의 명령 |
| middleware (로깅, 권한 검사) | 형식 검사, 권한 검사 (A/P) |
| reducer (순수 함수) | 커널의 상태 전이 |
| store의 state 모양 | N, E, M 레코드 |
| action 기록과 devtools 시간 여행 | 이벤트 로그, 특정 시점 상태 조회 |
| XState 같은 상태 기계 | Concern의 O → I → C → A |
| selector로 만든 화면 | 복귀 요약, 선택 요청 같은 투영 |
| 그 화면이 쓰기 좋은지 보는 UX 기준 | OPD+C |

이 대응에서 LLM 에이전트는 action을 dispatch하는 컴포넌트 중 하나일 뿐입니다. 다만 무엇을 dispatch할지 예측할 수 없는 컴포넌트입니다. 지난 답의 "모든 변화가 지나는 경로" 그림은 결국 dispatch → middleware → reducer → selector 흐름을 다시 그린 것입니다.

여기서 하나만 생각해 보시면 좋겠습니다. Redux에서 컴포넌트가 store를 직접 고치지 못하고 반드시 action을 거치게 하는 이유가 무엇이라고 보시나요? 그 이유가 Helm에서 모델이 기록을 직접 쓰지 못하게 하는 이유와 같은지 다른지 말씀해 주시면, 거기서부터 하나씩 이어 가겠습니다.

혹시 어려운 쪽이 런타임 구조가 아니라 N/E/M 같은 Helm 개념 자체라면 그렇게 말씀해 주세요. 그쪽에서 다시 시작하겠습니다.

--- [81] USER ---
둘 다 어려워 지금

--- [82] ASSISTANT ---
그러면 런타임은 잠시 내려놓고, Helm 개념 하나부터 시작하겠습니다. 순서는 이렇게 가겠습니다.

1. 일하면서 적는 것들을 세 칸으로 나누기 (N, E, M)
2. 같은 E 칸 안에서 "본 것"과 "추측한 것" 구분하기
3. 네 루프(O, I, C, A)가 이 세 칸을 어떻게 오가는지 보기
4. 마지막에 런타임

오늘은 1번만 합니다.

Helm의 N, E, M은 어려운 개념이 아닙니다. 일할 때 적는 메모를 세 칸으로 나눈 것뿐입니다. 예를 들어 "로그인 버튼이 안 눌린다"는 버그를 고친다면 이렇게 나뉩니다.

| 칸 | 뜻 | 예 |
|---|---|---|
| N (방향) | 하기로 한 것, 지켜야 할 것 | "오늘 배포 전까지 로그인이 되게 한다" |
| E (이해) | 알고 있거나 안다고 생각하는 것 | "콘솔에 TypeError가 뜬다", "onClick에 함수가 안 넘어가는 것 같다" |
| M (실제) | 실제로 바뀌었거나 존재하는 것 | "Button.tsx를 고쳐서 커밋했다" |

이것만 기억하시면 됩니다. 방향, 이해, 실제입니다.

직접 나눠 보겠습니다. 아래 네 문장이 각각 어느 칸인지 골라 주세요. 틀려도 괜찮습니다. 어디서 헷갈리는지 보려는 것입니다.

- a) 네트워크 탭을 보니 검색 API 응답이 평균 2초 걸린다
- b) 이번 주 안에 검색 결과가 1초 안에 나오게 한다
- c) useSearch.ts에 캐시를 추가해서 머지했다
- d) 캐시가 없어서 느린 것 같다

"a=?, b=?, c=?, d=?" 형태로 답해 주시면 됩니다.

--- [83] USER ---
a: m b :n c:m d:e

--- [84] ASSISTANT ---
b, c, d는 맞습니다. 특히 d를 E로 고르신 것이 중요합니다. "느린 것 같다"는 사실이 아니라 생각이라는 걸 구분하신 겁니다.

a는 M이 아니라 E입니다. 이 부분은 처음에 많이 헷갈립니다.

- **M은 세상 그 자체**입니다. API 서버가 실제로 응답하는 데 걸리는 시간, useSearch.ts 파일의 실제 내용 같은 것입니다.
- **E는 그것에 대해 내가 알게 된 것**입니다. "네트워크 탭에서 보니 2초였다"는 내가 본 기록이므로 E에 들어갑니다.

둘을 나누는 이유는 둘이 어긋날 수 있기 때문입니다. 2초는 내 컴퓨터의 네트워크 탓이었을 수도 있습니다. c처럼 캐시를 추가해서 M이 바뀌면, a의 "2초"는 더 이상 맞지 않는 옛날 정보가 됩니다. Helm 문서의 "M updates E"(실제가 바뀌면 이해를 다시 갱신해야 한다)가 바로 이 상황을 말합니다.

정리하면 a의 관계는 이렇습니다.

```text
M: API가 실제로 느림 (세상)
      │  내가 네트워크 탭으로 봄
      ▼
E: "평균 2초 걸린다" (내가 본 기록)
```

이제 2번으로 넘어가겠습니다. a와 d는 둘 다 E입니다. 그런데 성격이 다릅니다. E 칸을 두 개로 다시 나눈다면, a와 d를 어떤 기준으로 나누시겠어요? 한 줄로 말씀해 주시면 됩니다.

--- [85] USER ---
추측과 관찰

--- [86] ASSISTANT ---
맞습니다. Helm에서도 정확히 그렇게 나눕니다. a는 **관찰**, d는 **추측**입니다. Helm 문서에서는 추측을 조금 더 잘게 나눠서 "해석"과 "가능성"이라고 부르지만, 지금은 추측 하나로 묶어도 충분합니다.

이 구분이 Helm에서 가장 중요한 규칙 하나로 이어집니다.

> 추측은 저절로 사실이 되지 않는다.

사람끼리 일할 때도 자주 일어나는 일입니다. 누군가 "캐시가 없어서 느린 것 같다"고 말합니다. 그 말이 회의를 몇 번 거치면 "캐시가 없어서 느리다"로 바뀌어 있습니다. 그래서 캐시를 붙였는데, 실제 원인은 DB 쿼리였습니다. 에이전트는 이 일을 훨씬 빠르게, 더 자주 저지릅니다. 자기가 쓴 추측을 다음 턴에 사실처럼 읽기 때문입니다.

그래서 Helm은 E 안의 메모에 단계를 둡니다.

```text
관찰 → 추측 → 판단 (사실로 받아들인 것)
              ↑
       올라가려면 근거가 필요
```

추측이 판단으로 올라가려면 그것을 뒷받침하는 관찰이 있어야 합니다.

그러면 d를 판단으로 올리려면 무엇이 필요한지 직접 생각해 보시죠. "캐시가 없어서 느리다"가 맞는지 확인하려면, 어떤 관찰이 하나 더 있으면 될까요? 실제로 개발하실 때 해 보실 만한 확인을 하나만 말씀해 주세요.

--- [87] USER ---
캐시 히트가 있는지, 애초에 캐시 코드가 구현이 되어있는지를 먼저 관찰하지만, 반대로 반드시 캐시때문에 그렇다는 다른 반증을 찾는것도 필요

--- [88] ASSISTANT ---
좋은 답입니다. 두 가지를 다 짚으셨습니다. Helm 용어로는 이렇게 부릅니다.

- **근거**: 추측을 뒷받침하는 관찰 (캐시 히트 여부, 캐시 코드가 있는지)
- **반대 근거**: 추측과 맞지 않는 관찰을 일부러 찾는 것

반대 근거를 일부러 찾는 습관은 Helm의 A14(이견과 실패는 지울 잡음이 아니라 신호다)와 같은 이야기입니다.

하나만 더 다듬겠습니다. "캐시 코드가 없다"는 관찰은 d를 뒷받침하는 것처럼 보이지만, 원인이 DB 쿼리여도 캐시 코드는 똑같이 없습니다. 즉 어느 쪽이 맞든 같은 결과가 나오는 관찰이라 추측을 가려 주지 못합니다. 반면 "서버 응답 2초 중 DB 쿼리가 1.8초"처럼, 원인이 무엇이냐에 따라 결과가 달라지는 관찰이 진짜 쓸모 있는 확인입니다. Helm에서는 이것을 **구분 확인**이라고 부릅니다.

지금까지 하신 것을 정리하면 다음과 같습니다.

```text
E 칸: 관찰 → 추측 → 판단
              ↑
     근거 + 반대 근거 + 구분 확인
```

1번(N/E/M)과 2번(관찰과 추측)을 모두 하셨습니다. 그리고 방금 추측을 세우고 확인 방법을 고르신 일이 바로 네 루프 중 **I 루프(Inquiry, 탐구)**입니다.

이제 3번으로 가겠습니다. I 루프는 혼자 있지 않습니다. 방금 하신 탐구가 의미 있으려면, 그 앞에 어떤 일이 먼저 있어야 하고, 그 뒤에는 어떤 일이 와야 할까요? 실제로 버그를 잡을 때의 흐름을 떠올리면서, 앞과 뒤를 하나씩만 말씀해 주세요.

--- [89] USER ---
문제상황이 무엇이고 탐구를 통해 문제를 인식하고 정의했는지, 이게 진짜 해결해야 하는 문제라고 정의했다면 어떻게 해결할건지

--- [90] ASSISTANT ---
두 가지를 다 맞히셨습니다. Helm 이름을 붙이면 이렇습니다.

| 하신 말씀 | Helm 루프 | 이 루프가 답하는 질문 |
|---|---|---|
| 문제 상황이 무엇인지 | **O (Orientation, 상황 파악)** | 지금 무엇이 변했고 왜 중요한가 |
| 탐구로 문제를 인식하고 정의 | **I (Inquiry, 탐구)** | 무엇이 진짜 문제이고 어떤 가능성이 있는가 |
| 진짜 문제라면 어떻게 해결할지 | **C (Commitment, 약속과 실행)** | 무엇을, 어디까지, 어떤 조건으로 하기로 했는가 |

참고로 "문제를 정의한다"는 O와 I의 경계에 있습니다. Helm 10단계에서도 Frame(문제 정의)이 Sense(상황 파악) 바로 다음, Diverge(발산) 바로 앞에 있습니다. 두 루프에 걸친 단계라 헷갈리는 게 자연스럽습니다.

이제 마지막 하나가 남았습니다. 아마 앞에서 "가장 많이 건너뛴다"고 하셨던 그 루프일 겁니다.

검색 속도 예시로 돌아가겠습니다. C 루프에서 캐시를 붙이기로 정했고, 코드를 작성해서 머지까지 했습니다. 여기서 끝일까요? 머지한 다음에 실제로 해야 하는 일을 떠올려서 하나 이상 말씀해 주세요.

--- [91] USER ---
정말 문제가 해결되었는지 확인해야하고, 해당 문제정의에서의 해결이 다른 프레임에서는 해결이 맞는지를 교차점검

--- [92] ASSISTANT ---
정확합니다. 그 두 가지가 **A 루프(Assurance, 확인과 반영)**입니다. Helm 문서의 A 루프 질문과 거의 같은 말을 하셨습니다.

- "정말 해결됐는지 확인" → **결과 확인**. 머지한 사실이 아니라, 검색이 실제로 1초 안에 나오는지 근거로 확인합니다.
- "다른 프레임에서도 해결이 맞는지 교차 점검" → **전체 반영**. 캐시 때문에 오래된 검색 결과가 보이지는 않는지, 다른 화면이나 다른 사람의 작업과 충돌하지 않는지 봅니다. 문서의 표현으로는 "명세대로 만들었는가와 올바른 것을 만들었는가를 모두 확인했는가"입니다.

A 루프에는 하나가 더 있습니다. **돌아보기**, 즉 다음에 비슷한 문제를 만나면 무엇을 다르게 할지 남기는 일입니다.

이제 1~3번을 모두 직접 채우셨습니다. 지금까지의 내용을 한 장으로 모으면 이렇습니다.

| 루프 | 하는 일 | 다루는 칸 |
|---|---|---|
| O 상황 파악 | 지금 무슨 일이 있는지 본다 | N, E, M을 읽기만 함 |
| I 탐구 | 문제를 정의하고, 추측을 세우고, 확인한다 | E에 쓴다 |
| C 약속과 실행 | 해결 방법을 정하고 실행한다 | N에 쓰고, M을 바꾼다 |
| A 확인과 반영 | 해결됐는지 확인하고, 전체와 맞추고, 돌아본다 | M을 N과 비교하고, E를 갱신한다 |

그리고 A에서 "해결이 안 됐다"가 나오면 다시 I로 돌아갑니다. 네 루프가 한 방향으로만 흐르지 않는다는 말이 이것입니다.

마지막 4번(런타임)으로 넘어가기 전에 질문 하나만 드리겠습니다. 이 표에서 에이전트에게 혼자 맡겼을 때 가장 위험한 칸은 어디라고 보시나요? 루프 하나와 칸 하나를 골라서, 왜 그런지 한 줄로 말씀해 주세요. 이 답이 그대로 "런타임이 무엇을 막아야 하는가"의 출발점이 됩니다.

--- [93] USER ---
A 책임소재를 질 대상이 없음, 확인과 반영이라는 것 또한 LLM이 진행하면 불확정성이 반드시 따라올 수 밖에 없기때문

--- [94] ASSISTANT ---
두 가지 모두 Helm이 A 루프를 다루는 이유와 정확히 같습니다.

- **책임질 주체가 없다** → Helm 공리 A6입니다. "에이전트는 제안과 제한된 실행의 주체이고, 사람이 최종 약속의 저자다." 결과를 받아들이는 행위는 책임을 지는 행위라서 사람이 해야 합니다.
- **LLM이 확인하면 불확실성이 따라온다** → 작업한 모델이 자기 결과를 확인하면, 같은 착각을 같은 방식으로 한 번 더 하게 됩니다. 스스로 채점하는 구조입니다.

이제 4번, 런타임입니다. 사실 방금 답하신 내용이 런타임이 해야 할 일의 전부입니다. 위험한 곳을 찾았으면, 그곳에서 모델이 못 하게 막으면 됩니다. 앞에서 꺼냈던 Redux 비유로 쓰면 이렇습니다.

```ts
function helmReducer(state, action) {
  switch (action.type) {
    case "result/submit": // 에이전트도 할 수 있음
      // 근거는 모델이 쓴 문장이 아니라 실제 도구 실행 결과여야 함
      if (!action.evidence.every((id) => state.toolResults[id]))
        return reject("근거가 실제 실행 결과가 아님");
      return { ...state, result: { status: "확인 필요", evidence: action.evidence } };

    case "result/accept": // 사람만 할 수 있음
      if (action.actor !== "human") return reject("결과 확인은 사람만 가능");
      return { ...state, result: { ...state.result, status: "확인됨" } };
  }
}
```

코드에 새로운 것은 없습니다. reducer 안에 조건 두 개를 둔 것뿐입니다. 다만 이 조건들이 프롬프트("확인은 사람에게 맡기세요")가 아니라 코드에 있기 때문에, 모델이 무슨 말을 하든 결과가 "확인됨"으로 바뀌지 않습니다. 지금까지 제가 "커널", "제안 경로"라고 어렵게 설명했던 것이 결국 이것입니다.

- 모델은 action을 dispatch만 할 수 있다.
- reducer가 Helm의 규칙으로 받을지 말지를 정한다.

마지막으로 같은 방법을 다른 곳에 직접 적용해 보시면 이해가 굳어집니다. 2번에서 "추측은 저절로 사실이 되지 않는다"는 규칙을 배웠습니다. 이 규칙을 지키려면 위 reducer에 어떤 action과 조건을 하나 넣어야 할까요? action 이름과 조건을 한 줄씩만 적어 주세요.

--- [95] USER ---
모르겠으

--- [96] ASSISTANT ---
괜찮습니다. 절반을 먼저 채워 드리겠습니다.

위 코드에서 결과는 "확인 필요" → "확인됨"으로 올라갔습니다. 추측도 똑같이 "추측" → "판단"으로 올라갑니다. 그래서 action은 이렇게 생겼습니다.

```ts
case "claim/promote": // 추측을 판단으로 올리기
  if (/* ??? */) return reject("판단으로 올릴 수 없음");
  return { ...state, [action.id]: { ...state[action.id], status: "판단" } };
```

남은 것은 `???` 자리의 조건 하나입니다. 사실 이 답은 2~3턴 전에 이미 직접 말씀하셨습니다. "캐시가 없어서 느린 것 같다"를 사실로 받아들이려면 무엇이 필요하다고 하셨는지 떠올려 보세요. 그걸 조건으로 바꾸면 됩니다. 말로 적어 주셔도 괜찮습니다.

--- [97] USER ---
반증 조건이 없고 증거가 명확히 확인된것'

--- [98] ASSISTANT ---
맞습니다. 그 말을 그대로 코드로 바꾸면 이렇게 됩니다.

```ts
case "claim/promote":
  const c = state[action.id];
  const hasEvidence = c.evidence.length > 0 &&
    c.evidence.every((id) => state.toolResults[id]);      // 증거가 실제로 확인된 것
  const checkedAgainst = c.counterChecked === true &&
    c.counterEvidence.length === 0;                          // 반증을 찾아봤는데 없었음
  if (!hasEvidence || !checkedAgainst) return reject("판단으로 올릴 수 없음");
  return { ...state, [action.id]: { ...c, status: "판단" } };
```

한 군데만 다듬었습니다. "반증이 없다"를 "반증을 찾아봤는데 없었다"로 바꿨습니다. 찾아보지 않아서 없는 것과 찾아봤는데 없는 것은 다르기 때문입니다. 그래서 `counterChecked` 칸을 따로 두었습니다.

이걸로 처음 정한 네 단계를 모두 직접 채우셨습니다.

1. **N, E, M**: 방향, 이해, 실제. 관찰은 M이 아니라 M에 대해 알게 된 E다.
2. **관찰과 추측**: 추측은 근거, 반대 근거, 구분 확인 없이 판단이 되지 않는다.
3. **O, I, C, A**: 상황 파악 → 탐구 → 약속과 실행 → 확인과 반영. 확인에서 실패하면 탐구로 돌아간다.
4. **런타임**: 위험한 지점(결과 확인, 판단으로 올리기)에서 모델의 action을 reducer 조건으로 막는다.

앞에서 어려웠던 "커널", "제안 경로", "축별 매핑"은 모두 4번을 규칙 수만큼 늘린 것입니다. 이제 그 설명을 다시 보시면 위 두 개의 `case`가 여러 개로 늘어난 것으로 읽힐 겁니다.

다음에 이어서 하신다면 두 방향이 있습니다.

- **개념 쪽**: A/P(누가 무엇을 할 수 있는가)와 OPD+C(사람이 따라갈 수 있는가)를 같은 방식으로 하나씩 채우기
- **코드 쪽**: 위 reducer를 실제로 돌아가는 작은 파일로 만들고, 가짜 모델이 규칙을 어기려 할 때 막히는 걸 직접 보기

--- [99] USER ---
둘다

--- [100] ASSISTANT ---
코드부터 만들고, 그 코드 안에서 A/P 개념으로 이어가겠습니다.

--- [101] ASSISTANT ---
[Write /home/claude/helm-toy/helm.mjs]

--- [102] ASSISTANT ---
파일 helm.mjs를 실행한 결과입니다. 21번의 시도 중 8번이 거부되었습니다.

```text
 3 ✗ model   claim/promote      근거 없음
 4 ✗ model   claim/link         근거 T9는 실제 실행 결과가 아님
 5 ✗ model   tool/result        도구 결과는 런타임만 기록 가능
 7 ✗ model   claim/promote      반증을 찾아보지 않음
10 ✗ model   claim/promote      반대 근거 있음: T2
17 ✗ model   result/submit      근거 모델설명는 실제 실행 결과가 아님
19 ✗ model   result/accept      결과 확인은 사람만 가능
21 ✗ model   (직접 수정 시도)     상태는 읽기 전용

최종 상태
  C1 [추측] 캐시가 없어서 느리다     ← 반대 근거 T2 때문에 추측에 머묾
  C2 [판단] DB 쿼리가 느리다         ← 근거 + 반증 탐색을 거쳐 올라감
  결과: 확인됨 (근거 T4)            ← 사람이 확인
```

앞에서 함께 만든 규칙이 그대로 동작합니다. "캐시가 없어서 느리다"는 모델이 다섯 번 밀어붙였지만 끝까지 추측으로 남았습니다. 실제 원인인 DB 쿼리 쪽만 판단이 되었습니다. 거부된 시도도 기록에서 지워지지 않고 남아 있습니다.

이제 개념 쪽, A/P로 넘어가겠습니다. 이번에도 직접 나눠 보시는 것에서 시작합니다.

위 거부 8개는 이유가 제각각이지만, 크게 보면 두 종류로 나뉩니다. 어떤 기준으로 나뉘는지 찾아보세요. 힌트를 드리면, 5번과 19번은 같은 action을 다른 사람이 했다면 통과했을 시도입니다. 나머지는 누가 했어도 거부되었을 시도입니다.

--- [103] USER ---
엄 시각화 해서 보여줘

--- [104] ASSISTANT ---
[widget helm_toy_reducer_dispatch_stepper]

--- [105] ASSISTANT ---
helm.mjs의 21개 dispatch를 한 단계씩 재생할 수 있게 만들었습니다. 넘겨 보시면 세 가지가 보입니다.

- 왼쪽 위: 이번에 들어온 action과 그것을 보낸 행위자(runtime, model, human)
- 왼쪽 아래: reducer가 어떤 검사를 했고 어디서 걸렸는지
- 오른쪽: 받아들여진 경우에만 N, E, M 상태가 바뀌고, 바뀐 줄이 강조됨

거부된 단계(✗)에서는 오른쪽 상태가 전혀 바뀌지 않고 아래 기록에만 남습니다.

이제 앞의 질문을 이 화면으로 다시 보시면 됩니다. ✗가 붙은 8개 단계(3, 4, 5, 7, 10, 17, 19, 21)를 눌러 보면서 "reducer 검사" 칸을 비교해 보세요. 걸린 검사가 **action을 보낸 쪽**을 보고 있는 경우와 **action에 담긴 내용**을 보고 있는 경우가 있습니다. 각각 어느 번호들인지 나눠 주세요. 21번은 둘 중 어디에도 딱 맞지 않을 수 있으니, 애매하면 따로 빼 두셔도 됩니다.

--- [106] USER ---
이제 이해됐어. NEM 세계와 OICA는 이해됐어. HELM의 다른 개념들도 세부적으로 이해해야할거같아

--- [107] ASSISTANT ---
NEM과 OICA를 잡으셨으면 나머지 개념은 그 위에 하나씩 얹으면 됩니다. 남은 개념을 이해하기 쉬운 순서로 정리하면 다음과 같습니다. 각 개념이 무엇에 답하는지도 함께 적었습니다.

| 순서 | 개념 | 답하는 질문 |
|---|---|---|
| 1 | A/P (참여자와 정책) | 누가 무엇을 할 수 있나 |
| 2 | 맡긴 범위와 effect class (R0~R4) | 에이전트가 어디까지 혼자 해도 되나 |
| 3 | 선택 요청과 개입 계산 | 언제 사람에게 물어야 하나 |
| 4 | Goal, Concern, WorkUnit | 일을 어떤 단위로 묶나 |
| 5 | 품질 상태와 다시 볼 조건 | 한번 정한 것이 언제 낡나 |
| 6 | 투영과 복귀 요약 | 사람과 모델에게 무엇을 보여주나 |
| 7 | OPD+C | 사람이 이 흐름을 따라갈 수 있나 |
| 8 | Quick / Guided / Assured | 이 모든 것을 얼마나 무겁게 적용하나 |
| 9 | 공리 15개 | 위 개념들이 지키려는 원칙 전체 |

1번부터 시작합니다. 사실 이미 코드에서 보셨습니다. 앞 질문의 답부터 정리하면, 거부 8개는 이렇게 나뉩니다.

- **내용이 규칙에 안 맞아서 거부**: 3, 4, 7, 10, 17 (누가 보냈어도 거부됨)
- **보낸 쪽이 그 일을 할 자격이 없어서 거부**: 5, 19 (같은 action을 다른 행위자가 보냈다면 통과)
- **경로를 우회해서 거부**: 21

두 번째 묶음이 A/P입니다.

- **A (참여자)**: 행위자마다 할 수 있는 일의 목록입니다.
- **P (정책)**: 그 일을 어떤 조건에서 할 수 있는지에 대한 규칙입니다.

그런데 helm.mjs에서는 이것을 `action.actor !== "human"`처럼 "누구냐"로 검사했습니다. Helm v0.2는 이 방식을 쓰지 않고, 행위자를 **능력 목록**으로 정의합니다.

직접 채워 보시죠. 행위자가 셋 있다고 하겠습니다.

- 사람
- 작업 에이전트: 코드를 고치는 모델
- 검증 에이전트: 작업 에이전트의 결과를 따로 확인하는 다른 모델

아래 표의 각 칸에 O(할 수 있음) 또는 X(할 수 없음)를 넣어 주세요.

| | 제안하기 | 코드 변경 실행 | 근거가 맞다고 증언하기 | 결과 확인(받아들이기) |
|---|---|---|---|---|
| 사람 | | | | |
| 작업 에이전트 | | | | |
| 검증 에이전트 | | | | |

다 채우시고 나면, 이 표를 `actor !== "human"` 한 줄로 표현할 수 있는지도 같이 생각해 보세요.

--- [108] USER ---
O O O O
O O X X
X X O X

--- [109] ASSISTANT ---
거의 맞습니다. 하나만 다듬겠습니다.

검증 에이전트의 "제안하기"는 X보다 **부분적으로 O**가 맞습니다. 앞의 미리보기에서 검증자가 "setSearchParams에 replace 옵션이 없다"를 찾아냈던 장면을 떠올려 보세요. 그것은 반대 근거를 **제안**한 것입니다. 검증자는 코드 변경을 제안하지는 않지만, 반대 근거는 제안할 수 있어야 합니다. 같은 "제안"이라도 무엇을 제안하느냐에 따라 허용이 달라지는 셈입니다.

그리고 뒤의 질문의 답은 **아니요**입니다. 작업 에이전트와 검증 에이전트는 둘 다 사람이 아닌데 "증언하기" 칸이 다릅니다. `actor !== "human"` 한 줄로는 둘을 구분할 수 없습니다. 그래서 Helm은 "누구냐" 대신 "무엇을 할 수 있냐"로 적습니다. 채워 주신 표가 곧 A입니다.

```ts
const A = {
  human:    ["propose", "execute", "attest", "accept"],
  worker:   ["propose", "execute"],
  verifier: ["propose:counterEvidence", "attest"],
};
const can = (actor, cap) => A[actor].includes(cap);
```

그런데 표만으로는 부족한 규칙이 있습니다. 예를 들어 "작업 에이전트는 코드를 바꿀 수 있다"는 표에 O로 들어가 있습니다. 하지만 실제로는 "합의된 폴더 안에서만" 바꿀 수 있어야 합니다. 이렇게 **그때그때의 상황에 따라 붙는 조건**이 P입니다.

- **A**: 고정된 능력표 ("이 행위자가 이 종류의 일을 할 수 있는가")
- **P**: 지금 상황에서의 조건 ("지금 이 범위, 이 시점에 해도 되는가")

확인해 보겠습니다. 아래 네 규칙이 각각 A인지 P인지 골라 주세요.

- a) 작업 에이전트는 결과를 확인할 수 없다
- b) 작업 에이전트는 합의된 폴더 안에서만 코드를 바꿀 수 있다
- c) 검증 에이전트는 코드를 고칠 수 없다
- d) 어떤 결과든, 그 결과를 만든 행위자는 그 결과의 근거를 증언할 수 없다

--- [110] USER ---
A A P P

--- [111] ASSISTANT ---
a와 d는 맞고, b와 c가 서로 바뀌었습니다. 헷갈리기 쉬운 지점이라 판별 기준 하나를 드리겠습니다.

> **일하는 도중에 상황이 바뀌면 답도 바뀌는가?**
> 바뀌면 P, 언제나 같으면 A입니다.

이 기준으로 네 개를 다시 보면 이렇습니다.

| | 상황이 바뀌면? | 답 |
|---|---|---|
| a) 작업 에이전트는 결과 확인 불가 | 어떤 작업이든 항상 불가 | A |
| b) 합의된 폴더 안에서만 코드 변경 | 합의가 바뀌면 바꿀 수 있는 폴더도 바뀜 | **P** |
| c) 검증 에이전트는 코드 수정 불가 | 어떤 상황이든 항상 불가 | **A** |
| d) 결과를 만든 행위자는 그 결과를 증언 불가 | 이번 결과를 누가 만들었는지에 따라 달라짐 | P |

c는 "~할 수 없다"는 금지 문장이라 규칙처럼 보여서 P로 고르기 쉽습니다. 하지만 금지인지 허용인지는 상관없습니다. 능력표의 X 칸도 A입니다. b는 반대로 "~할 수 있다"로 시작해서 A처럼 보이지만, "합의된 폴더 안에서만"이라는 조건이 지금의 합의 상태에 따라 달라지므로 P입니다.

기준이 잡혔는지 두 개만 더 확인해 보겠습니다.

- e) 사람은 결과를 확인할 수 있다
- f) 배포처럼 되돌리기 어려운 행동은, 작업 에이전트라도 사람이 승인한 뒤에만 할 수 있다

--- [112] USER ---
A P

--- [113] ASSISTANT ---
두 개 다 맞습니다. 이제 A와 P를 구분하실 수 있습니다.

f가 마침 다음 개념으로 이어집니다. f에는 "되돌리기 어려운 행동"이라는 말이 들어 있었습니다. Helm은 행동을 **되돌리기 얼마나 어려운가**로 다섯 등급으로 나눕니다. 이것이 effect class입니다. Helm kernel v0.2 문서의 정의를 프론트엔드 예시와 함께 옮기면 이렇습니다.

| 등급 | 문서 정의 | 예 |
|---|---|---|
| R0 | 로컬, 읽기만 | 파일 읽기, grep, 로컬에서 성능 측정 |
| R1 | 로컬, 되돌릴 수 있는 변경 | 파일 수정, 로컬 브랜치 커밋 |
| R2 | 공유되거나 밖에서 보이지만 되돌릴 수 있음 | 브랜치 push, PR 생성, 스테이징 배포 |
| R3 | 비용이 크거나, 민감하거나, 복구가 어려움 | 프로덕션 배포, 유료 API 대량 호출 |
| R4 | 되돌릴 수 없거나 기본 금지 | main에 force push, 프로덕션 데이터 삭제 |

하나 정정합니다. 앞의 미리보기 화면에서 "로컬 변경(R2)까지 허용"이라고 적었는데, 문서 기준으로는 **R1**입니다. 제 표기가 틀렸습니다.

이 등급이 P와 만나는 곳이 **맡긴 범위**(Authority Envelope)입니다. 작업 합의를 할 때 "이번 일에서는 R1까지만"처럼 상한을 정합니다. 그 위의 등급은 f처럼 사람의 승인이 있어야 실행됩니다. 문서에 따르면 맡긴 범위에는 등급 말고도 몇 가지가 함께 들어갑니다.

- 대상 범위 (어느 폴더, 어느 서비스)
- 예산
- 유효 기간
- 멈출 조건

등급을 매기는 감을 잡아 보시죠. 아래 네 행동은 각각 R 몇일까요?

- a) `npm install`로 새 패키지를 추가한다 (package.json이 바뀜, 아직 커밋 전)
- b) 팀 PR에 리뷰 코멘트를 단다
- c) 프로덕션 DB에서 컬럼을 삭제하는 마이그레이션을 실행한다
- d) 로컬에서 번들 분석기를 돌려 크기를 본다

--- [114] USER ---
아 근데 이제는 되돌리기 어려운 행동이라는 것 자체에 대한 정의가 없어야 된다고 생각하는 편이긴 해.

--- [115] ASSISTANT ---
좋은 지적입니다. 그 생각은 방금 배운 A/P 구분과 바로 연결됩니다.

"되돌리기 어렵다"는 것이 행동의 고정된 성질이 아니라 **그때의 상황**에 따라 달라진다는 뜻이라면, 맞는 말입니다. 예를 들어 이렇습니다.

- 프로덕션 배포는 R3로 적었지만, feature flag 뒤에 있고 롤백이 1분이면 실제로는 R1에 가깝습니다.
- 파일 수정은 R1로 적었지만, git으로 추적되지 않는 파일이라면 되돌릴 수 없습니다.
- PR 코멘트는 지울 수 있지만, 이미 누군가 읽었다면 그 사실은 되돌릴 수 없습니다.

방금 쓴 판별 기준으로 보면, 상황이 바뀌면 답이 바뀝니다. 그러니 effect class를 "행동 종류 → 등급" 표(A처럼 고정된 것)로 두면 안 되고, 상황을 보고 계산하는 P여야 한다는 주장이 됩니다. Helm 문서에도 실마리가 있습니다. 공리 A7은 권한이 "가역성, 파급 범위, 관측 가능성에 따라" 달라진다고 썼습니다. 그런데 kernel 문서는 R0~R4를 고정된 목록으로 적어 두었습니다. 두 문서가 서로 맞지 않는 부분입니다.

제 생각을 덧붙이면, 정의를 아예 없애는 것과 고정 정의를 없애는 것은 다릅니다. 언제 사람에게 물을지는 무언가가 정해야 합니다. 정의가 아예 없으면 그 판단을 모델이 매번 하게 되고, 그건 앞에서 피하려 했던 불확실성으로 돌아갑니다. 그래서 저라면 등급은 결과로만 남기고, 그 등급을 관찰 가능한 사실에서 계산하겠습니다. 예를 들면 백업이 있는가, git이 추적하는가, flag가 있는가, 누가 볼 수 있는가 같은 사실입니다. 또 하나, 정보가 밖으로 나가는 행동(시크릿 노출, 메일 발송)은 어떤 상황에서도 되돌릴 수 없어서, 그쪽은 고정으로 남겨야 한다고 봅니다.

말씀하신 뜻이 어느 쪽인지 확인하고 싶습니다.

1. 등급을 고정 목록이 아니라 상황에서 계산해야 한다
2. 되돌리기 쉬운지 어려운지로 나누는 것 자체가 필요 없다 (다른 기준으로 사람에게 물을 때를 정해야 한다)

2번이라면 그 다른 기준이 무엇인지도 궁금합니다.

--- [116] USER ---
요즘 LLM 모델은 이를 알아서 판별할 정도로 성능이 많이 올라와서 논의대상에서 제외하고 싶어, 그리고 이건 HELM 연구에서 다룰 게 아니라 에이전트 권한레벨에서 설계와 원칙을 정하는 거라고 봐서 아예 빼자

--- [117] ASSISTANT ---
네, 빼겠습니다. 정리하면 이렇게 됩니다.

- Helm 범위에서 빠지는 것: effect class(R0~R4), 행동이 되돌리기 어려운지를 판별하는 일
- 그 일을 맡는 곳: 에이전트 권한 레이어 (런타임 설계와 원칙의 영역)
- Helm에 남는 것: "무엇을 왜, 어디까지 맡겼는가"라는 작업 합의 자체

이에 따라 Helm 쪽에서 바뀌는 것이 하나 있습니다. 선택 요청을 열지 판단할 때 쓰던 입력 중 "되돌릴 수 있는가"는 이제 Helm이 계산하지 않습니다. 권한 레이어나 모델이 알려주는 값을 받아서 쓰게 됩니다.

학습 순서표에서 2번을 지우고 3번으로 넘어가겠습니다.

## 3. 선택 요청: 언제 사람에게 묻는가

Helm kernel 문서의 규칙은 세 줄입니다. 다음 세 가지가 **모두** 참일 때만 사람에게 묻습니다.

1. 정책(P)이 자동으로 정할 수 없다
2. 사람의 판단이 결과를 실질적으로 바꾼다
3. 지금 묻는 가치가 사람의 주의를 쓰는 비용보다 크다

하나라도 거짓이면 묻지 않습니다. 정책대로 처리하거나, 에이전트가 정하고 기록만 남기거나, 나중에 모아서 묻습니다.

직접 판정해 보시죠. 아래 네 상황에서 지금 사람에게 물어야 할지 판단해 주세요. 묻지 않는다면 세 조건 중 몇 번이 거짓인지도 함께 적어 주세요.

- a) 에이전트가 변수 이름을 `data`로 할지 `items`로 할지 고민한다
- b) 검색 결과에 캐시를 붙이면 오래된 가격이 최대 5분 동안 보일 수 있다. 이걸 허용할지 정해야 한다
- c) 실패한 테스트를 고칠 방법이 두 가지 있고, 어느 쪽이든 테스트를 돌려 보면 맞는지 바로 알 수 있다
- d) 밤 11시, 사용자는 퇴근했다. 내일 오전에 정해도 작업 일정에 지장이 없는 디자인 선택이 하나 생겼다

--- [118] USER ---
놉

--- [119] ASSISTANT ---
"놉"을 "전부 묻지 않는다"로 읽을 수도 있고, "문제 풀기 싫다"로 읽을 수도 있어서, 두 경우 모두에 맞게 답을 바로 드리겠습니다.

| 상황 | 지금 묻나 | 이유 |
|---|---|---|
| a) 변수 이름 | 묻지 않음 | 2번 거짓. 어느 쪽이든 결과가 실질적으로 달라지지 않습니다 |
| b) 오래된 가격 5분 노출 | **묻는다** | 세 조건 모두 참. 정책이 없고, 사용자에게 틀린 가격을 보여줄지는 가치 판단이라 결과가 달라지며, 작업을 진행하려면 지금 정해야 합니다 |
| c) 테스트로 확인 가능한 두 방법 | 묻지 않음 | 1번 거짓. "자동으로 검증할 수 있는 선택은 에이전트가 정한다"는 정책으로 처리됩니다 |
| d) 밤 11시, 내일 정해도 되는 선택 | 지금은 묻지 않음 | 3번 거짓. 선택 요청은 기록해 두고, 다음 날 복귀 요약에 넣어서 묻습니다 |

네 상황 중 실제로 사람을 부르는 것은 b 하나입니다. Helm이 피하려는 것이 바로 "승인 버튼만 누르게 만드는 질문"이기 때문입니다. 문서에서는 이를 approval theater라고 부릅니다. d에서는 kernel 문서의 세부 규칙 하나가 드러납니다. "선택 요청이 생긴 것"과 "사람에게 알림을 보내는 것"을 별개로 다룹니다. 요청은 바로 기록하되, 알림은 적절한 때에 보냅니다.

진행 방식을 하나 여쭙겠습니다. 남은 개념이 4번부터 9번까지 여섯 개 있습니다. 지금처럼 하나씩 문제를 풀며 갈까요, 아니면 설명 위주로 빠르게 훑고 확인 질문은 원하실 때만 드릴까요?

--- [120] USER ---
빠르게 가자. 난이도는 지금 적절한거같아. 그리고 내가 아까전에 말했던 mode라는 얘기가 이거랑 연관이 됐던건데, 모델이 자율적으로 판단해 어떤 결정사항을 내렸을 때, 이를 차후 확인할 수 있는 방안이 있어야 할 것 같다고도 생각했어. 혹은 질문을 얼마나 자주 하냐에 대한 기준이 있고 조건을 세개 다 만족해야만 질문을하도록 할건지 , 하나만 있어도 질문하도록 할건지 등을 선택할 수 있으면 유용하지 않을까 싶었던거랑, inquiry 같은 탐구작업을 할 때, 문제 frame을 구성하는 관점이 매우 다양하게 접근할 수 있도록 하던지, 어느정도 범위 내에서 inquiry를 진행할 수 있게 할것인지에 대한 자율성과 탐구 범위 등에 대한 정도를 조정할 수 있는 옵션이 그때그때 필요하지 않을까 싶긴했음. 이걸 유저가 세팅에서 조정하는 방법도 있겠지만, 각 역할별  에이전트 모델링을 미리 내가 해놓고, 유저의 입력값에 따라 어떤 에이전트 모델을 쓸지를 라우팅 하는 방식도 괜찮을 거 같기도 하다는 생각이고, inquiry 과정 자체가 repl구조로 이루어지는것도 어떤가 싶기도 하고

--- [121] ASSISTANT ---
좋습니다. 먼저 말씀하신 생각 다섯 가지가 Helm의 어디에 붙는지 정리하고, 이어서 남은 개념 4~9번을 빠르게 훑겠습니다. 말씀하신 생각들은 대부분 남은 개념과 직접 연결됩니다.

## A. 말씀하신 생각 다섯 가지

### 1. 모델이 혼자 정한 것을 나중에 확인하는 방법

Helm 문서에는 재료만 있고 이 장치는 없습니다. 공리 A8은 "결정은 가장 낮은 수준에서 하고 예외만 위로 올린다"고 하고, 선택 요청 규칙은 "묻지 않을 때"를 정합니다. 하지만 **묻지 않고 정한 것을 어떻게 다시 보여줄지**는 비어 있습니다. 이렇게 채우면 됩니다.

- 에이전트가 혼자 정한 것도 선택(Choice) 레코드로 남깁니다. 정한 주체, 고려한 대안, 이유, 그리고 묻지 않은 이유(세 조건 중 무엇이 거짓이었나)를 함께 적습니다.
- 복귀 요약에 "에이전트가 정한 것 n건"을 묶어서 보여주고, 각각에 이의를 걸 수 있게 합니다. 이의가 걸리면 그 선택이 다시 열립니다.
- 이의가 자주 걸리는 종류는 다음부터 묻도록 정책을 고칩니다.

이렇게 하면 1번이 2번 다이얼을 조정하는 근거 데이터가 됩니다.

### 2. 질문 빈도: 세 조건을 모두 볼지, 하나만 볼지

"하나만 참이어도 묻기"로 하면 앞의 a(변수 이름)도 묻게 됩니다. 변수 이름에 대한 정책이 없으니 조건 1이 참이기 때문입니다. 질문이 지나치게 많아집니다. 그래서 AND는 유지하고, **각 조건의 문턱을 조절**하는 쪽을 권합니다.

| 다이얼 값 | 조건 2 "결과가 바뀌나"의 문턱 | 조건 3 "지금 물을 가치" |
|---|---|---|
| 적게 묻기 | 큰 차이만 | 모아서 하루 한 번 |
| 보통 | 중간 | 작업 단계가 바뀔 때 |
| 많이 묻기 | 작은 차이도 | 바로 |

여기에 종류별 예외를 덧붙입니다. 예를 들어 "가격과 결제 관련은 항상 묻는다" 같은 규칙입니다.

### 3. 탐구의 폭과 범위 조절

앞의 탐구 미리보기에 있던 장치들이 그대로 다이얼이 됩니다.

| 다이얼 | 조절하는 것 |
|---|---|
| 관점 폭 | 발산 표의 열 수(바꾸는 대상 범주), 렌즈 수 |
| 깊이 | 라운드 수 |
| 근거 범위 | 저장소만 / 문서까지 / 웹까지 |
| 자율 정도 | 사람에게 묻지 않고 몇 라운드까지 진행할지 |
| 예산 | 하위 호출 수, 시간 |

### 4. 설정 화면 대신 역할 에이전트를 미리 만들어 두고 라우팅하기

좋은 방식이라고 봅니다. 다만 "역할 에이전트"를 페르소나로 정의하지 말고, A/P에서 배운 방식대로 **능력과 다이얼 값의 묶음**으로 정의하는 것이 좋습니다.

| 묶음 | 중심 루프 | 능력 (A) | 질문 빈도 | 탐구 폭·깊이 |
|---|---|---|---|---|
| 탐색 | I | 제안, 읽기 | 적게 (라운드 끝마다 하나) | 넓게, 깊게 |
| 실행 | C | 제안, 코드 변경 | 범위를 벗어날 때만 | 좁게 |
| 검증 | A | 반대 근거 제안, 증언 | 결과 확인 때만 | 반대 근거 위주 |
| 복귀 안내 | O | 읽기 | 없음 | 없음 |

**이 묶음이 처음에 말씀하신 "mode"의 정체입니다.** 라우터가 사용자 입력을 보고 묶음을 고르고, 사용자 설정은 그 위에 덮어쓰는 층이 됩니다. 이때 라우터가 묶음을 고른 것 자체도 에이전트가 혼자 정한 결정입니다. 그러니 1번처럼 기록하고, 이의를 걸 수 있게 해야 합니다.

### 5. 탐구 과정을 REPL 구조로

잘 맞습니다. 관점, 가능성, 관찰을 REPL 변수에 두고, 모델이 코드로 관점을 나누고 하위 호출을 돌리는 방식입니다. 앞에서 본 RLM 구조 그대로입니다.

규칙은 하나만 지키면 됩니다. **REPL 변수는 작업 메모이고 정본이 아닙니다.** REPL 안에서 만든 가능성이나 판단은 dispatch를 거쳐야만 E 레코드가 됩니다. helm.mjs로 비유하면 REPL은 컴포넌트의 로컬 state이고, 기록(ledger)은 store입니다. 덤으로 탐구 과정이 코드로 남기 때문에 다시 실행하고 검토할 수 있고, 1번의 사후 확인에도 유리합니다.

## B. 남은 개념 빠르게

### 4. Goal, Concern, WorkUnit

| 단위 | 뜻 | 수명 | 런타임에서 |
|---|---|---|---|
| Goal | 이루려는 것 | 몇 주~몇 달 | 기록만 있음 |
| Concern | 지금 주의가 필요한 상황 (문제, 기회, 위험) | 며칠 | O/I/C/A 상태 기계 하나 |
| WorkUnit | 합의 하나로 맡긴 구체적인 작업 | 몇 시간 | 내부 에이전트 루프 실행 |

Concern 하나 아래에 탐구용, 변경용, 반영용 WorkUnit이 여러 개 생길 수 있습니다. 위에서 말한 mode는 Concern이나 WorkUnit 단위로 붙습니다.

### 5. 품질 상태와 다시 볼 조건

레코드는 다음 순서로 올라갑니다.

```text
captured(적힘) → structural(형식 갖춤) → qualified(근거 갖춤) → accepted(받아들여짐)
```

여기에 옆길 상태가 셋 있습니다. contested(이의 걸림), stale(낡음), superseded(다른 것으로 대체됨).

모든 선택에는 "이게 바뀌면 다시 본다"는 **다시 볼 조건**이 붙습니다(공리 A13). 에이전트가 혼자 정한 선택에도 똑같이 붙입니다.

### 6. 투영과 복귀 요약

- **투영**: 같은 기록에서 보는 사람과 시점에 맞게 뽑아낸 읽기 전용 화면입니다. Redux의 selector와 같습니다.
- **복귀 요약**: 사람이 돌아왔을 때의 투영입니다. 모델에게 주는 컨텍스트도 투영입니다.

규칙은 세 가지입니다.
- 투영은 기록을 쓰지 않습니다.
- 요약할 때 반대 근거와 이견을 빼면 안 됩니다(A9).
- 투영마다 출처, 만든 시각, 무효화 조건을 붙입니다(A11).

### 7. OPD+C

말씀하신 생각과 연결하면 이렇습니다.

| 기준 | 질문 | 연결되는 생각 |
|---|---|---|
| Observability | 지금 상태와 이유가 보이나 | 1번 (혼자 정한 것 보여주기) |
| Predictability | 다음에 무엇을 할지 예상되나 | 4번 (지금 어느 묶음인지 표시) |
| Directability | 방향을 쉽게 바꿀 수 있나 | 2번, 3번 (다이얼) |
| Contestability | 이의를 걸고 다시 열 수 있나 | 1번 (이의 → 재개방) |

### 8. Quick / Guided / Assured

Helm에 원래 있던 다이얼 하나입니다. 말씀하신 생각은 이 하나를 여러 다이얼(질문 빈도, 탐구 폭, 자율 정도)로 쪼개고, 그 값을 묶음으로 미리 만들어 두는 방향입니다. Helm보다 한 단계 더 나간 설계입니다.

어느 다이얼 값에서도 바뀌지 않는 불변조건이 있습니다. 예를 들어 "질문 빈도 0"으로 설정해도 에이전트가 결과를 확인(accept)할 수는 없습니다. 다이얼은 얼마나 묻고 얼마나 증명할지만 조절하고, 관찰과 추측의 구분이나 제출과 확인의 구분은 건드리지 못합니다.

### 9. 공리 15개와 지금까지 배운 개념

| 공리 | 담당하는 개념 |
|---|---|
| A1 목적 먼저 | Goal → Concern → WorkUnit 연결 |
| A2 정당화된 진척, A5 상태 구분 | 관찰 → 추측 → 판단, 근거 |
| A3 문제 재정의, A4 가설 다양성 | I 루프, 발산, 탐구 다이얼 |
| A6 제안과 약속, A7 위험에 맞춘 권한 | A/P, 결과 확인은 사람만 (A7의 위험 판별은 권한 레이어로 넘김) |
| A8 낮은 수준에서 결정 | 선택 요청 규칙, 질문 빈도 다이얼, 혼자 정한 것 기록 |
| A9 차이를 지키는 요약, A11 시점별 투영 | 투영, 복귀 요약 |
| A10 제출·확인·반영 구분 | A 루프 |
| A12 사람의 이해를 낮추면 실패 | OPD+C 지표 |
| A13 낡음 | 품질 상태, 다시 볼 조건 |
| A14 실패는 신호 | 거부된 시도도 기록 |
| A15 공동 저작 | 이의, 다이얼, 재정의 명령 |

이걸로 Helm의 개념을 한 바퀴 다 돌았습니다.

다음 단계로는 helm.mjs에 오늘 나온 생각 세 가지를 붙여 보는 것을 제안합니다. mode 묶음 라우팅, 혼자 정한 결정의 기록과 이의, 질문 빈도 다이얼입니다. 같은 시나리오를 묶음만 바꿔서 돌려 보면, 언제 묻고 언제 혼자 정하는지가 어떻게 달라지는지 직접 보실 수 있습니다.

--- [122] USER ---
1. 만족 좋음 2.현재 HELM의 기준 자체가 애매한 면도 있는거같음 불확정성 기반의 기준이긴 하지만 서도, 현재 정의되 3가지 기준 자체가 과연 코드 작성 업무가 아닌 모든 범용적인 에이전틱 업무들에 대해서도 적용 가능한 기준인지? 이런 뭐랄까 프레임워크에 대한 다른 레퍼런스나 사례 혹은 생각의 프레임은 없는지 궁금함 조금 더 디벨롭 해야할듯함 3. 어느정도 동의함 4.나도 페르소나가 아니라 루프 중심으로 묶음 형태가 좋다고 생각함. 근데 ICAO가 코딩 업무가 아닌 범용적인 에이전틱 작업에서도 유용할지에 대한 반론이 필요함. 반대시각에서 비판해주면 현재 루프에서 보강할 부분을 찾아볼 수 있잖아. 그리고 저 루프가 무조건 사이클 및 sequential하게 이루어지는게 나는 아니라고 보긴함. 탐색만 하는 작업이 있을 수도 있고, 검증만 하는 작업이 있을 수도 있잖아. 그리고 능력에 '코드 변경'은 너무 국소 도메인에 치중된 부분임. pi처럼 쓰기 읽기와 같은 진짜 원시적인 액션이 곧 능력으로 되어야 한다고 보고, 실제 그 능력을 수행하는데 필요한 도구를 기존 에이전트들 처럼 tool calling이나 repl 방식의 rlm처럼 동작해야한다고 나는 생각했긴 함 5.


GOAL은 프로젝트 단위에서의 궁극적 목표를 의미해야 한다고 봄, 그리고 정적인 목표가 아니라 반복되는 concern 사이클을 통해 계속 진화하고 정제되어야 하는 핵심이되는 파운데이션이라고 봄

Concern 이 주의 라기보다는, 일반적인 Problem을 포함한 다양한 situation들에 대해 실제 framing? sens? 기존 helm의 10단계 세부 과정에서의 과정들을 진행할 후보군이 되는 것 그자체라고 생각을 함.

그리고 Projection(투영)은 내가 기억하기로는 그게 아니야. 다른 산업군이나 사용자가 전혀 인지하지 못하고 있던 다른 지식이나 개념 원천에서 발견한 방법론이나 사고방식을 현재에 정의된 '문제'에 적용하여 해결하거나 그쪽 시각으로 바라볼 수 있는가를 말하는거야. 이쪽 관련해서 컨텍스트를 다시 수집해봐

OPDC를 결국 사람이 지속적이고 장기적으로 관찰하고 제어하고 감시할 수 있는 공간이 마련되어야 한다고 보고 이게 에이전트 UI 클라이언트에서 UX적으로 구현되어야 할 큰 대상중 하나라는거. 다른 일반적인 에이전트 ui와 다르게(예: opencode app)

--- [123] ASSISTANT ---
다섯 가지에 차례로 답하겠습니다. 2번과 4번은 반대 시각과 외부 레퍼런스를 넣었고, 5번의 Projection은 Helm 자료를 다시 찾아 확인했습니다.

## 2. 선택 요청 기준: 코딩 밖에서도 통하는가

세 조건은 코딩 전용은 아닙니다. 다만 질적으로 적혀 있어서 판정이 애매합니다. 같은 문제를 다룬 다른 분야의 틀을 대보면, 무엇이 맞고 무엇이 빠졌는지 보입니다.

**1. 결정 이론의 정보 가치 (Value of Information)**
"물어서 얻는 기대 개선 > 묻는 비용"일 때 묻습니다. Helm의 세 조건은 이것을 말로 풀어 쓴 형태입니다.
- 조건 1 ≈ 에이전트의 기본 선택이 틀릴 확률
- 조건 2 ≈ 틀렸을 때의 손실 차이
- 조건 3 ≈ 묻는 비용

셋이 곱셈 관계라서 하나라도 0이면 묻지 않습니다. 앞에서 고민하신 AND/OR 질문에 대한 답이 여기서 나옵니다. AND는 임의로 고른 규칙이 아니라 이 구조에서 자연스럽게 나오는 결과입니다. 그래서 다이얼은 AND/OR가 아니라 **비용 항의 크기**로 두는 것이 맞습니다.

**2. Horvitz의 mixed-initiative 원칙 (1999)**
시스템이 "실행 / 확인 질문 / 아무것도 안 함" 세 가지 중 기대 효용이 가장 큰 것을 고릅니다. 세 가지를 더 강조합니다.
- 사용자의 주의 상태를 보고 타이밍을 정한다
- 잘못 추측했을 때의 비용을 줄인다
- 불확실할수록 서비스 범위를 좁힌다 (예: 끝까지 하지 않고 초안까지만)

Helm에는 "묻는다 / 혼자 정한다" 둘만 있고, **범위를 줄여서 진행**하는 중간 선택지가 없습니다.

**3. Parasuraman, Sheridan, Wickens의 자동화 유형과 수준 (2000)**
자동화를 네 기능으로 나누고, 기능마다 자동화 수준을 따로 정합니다. 네 기능은 정보 수집, 분석, 결정 선택, 실행입니다. 질문 빈도 다이얼도 하나로 두지 말고 기능별로 둘 수 있다는 근거가 됩니다. 4번에서 다시 쓰겠습니다.

**4. 인터럽션 연구**
McFarlane은 끼어드는 방식을 즉시, 협상, 중재, 예약 네 가지로 나눴습니다. Iqbal과 Bailey의 연구에서는 작업의 경계에서 끼어들면 비용이 작았습니다. 조건 3은 "묻는가"보다 **"언제, 어떤 방식으로 묻는가"**로 나누는 편이 정확합니다.

**5. 최근 LLM 에이전트 연구**
- Ask-when-Needed (2024): 도구 호출 전마다 지시가 충분한지 확인하고, 부족하면 묻습니다.
- Ask or Assume? (2026): 작업 에이전트와 별도로 의도 감시 에이전트를 두고, 빠진 맥락을 감지하면 사용자에게 묻게 했습니다. 일부러 덜 명세한 SWE-bench 과제에서 해결률이 61.2%에서 69.4%로 올랐습니다. 완전히 명세한 경우가 70.8%였으니 그 수준에 가깝습니다(저자들은 인과를 단정하지 않습니다).

**묻는 판단을 작업 에이전트가 아니라 별도 감시자에게 맡기는 구조**는 Helm의 검증 에이전트 분리와 같은 방향입니다.

### 범용 작업에서 세 조건에 빠진 것

| 빠진 것 | 예 | 보강 |
|---|---|---|
| 묻는 이유가 두 종류인데 섞여 있음 | 몰라서 묻기 vs 원래 사람이 정할 권리라서 묻기 (돈 쓰기, 사용자 대신 말하기, 남에게 영향 주기) | 게이트를 둘로 나눔. 권리 게이트는 정보 가치가 0이어도 묻는다. 코딩에서는 드물지만 메일, 구매, 일정 같은 작업에서는 흔하다 |
| 취향이 정답인 작업 | 글의 톤, 기획 방향 | 조건 2를 판정할 수 없다. 혼자 정한 결정에 걸린 이의 기록으로 학습한다 (1번 장치) |
| 중간 선택지 | 묻지도, 끝까지 하지도 않기 | "가정하고 진행 + 가정 기록 + 되돌릴 지점 남김". 범용 작업에서 가장 자주 맞는 선택이다 |
| 타이밍과 방식 | 밤 11시 예시 | 즉시 / 모아서 / 다음 복귀 요약에 |

정리하면 선택 요청은 세 부분으로 다시 쓸 수 있습니다.

```text
권리 게이트   이 결정이 사람의 권리인가 → 그렇다면 묻는다
정보 게이트   틀릴 확률 × 손실 차이 > 묻는 비용 → 그렇다면 묻는다
방식          지금 묻기 / 모아서 묻기 / 가정하고 진행하며 기록
```

질문 빈도 다이얼은 "묻는 비용"의 크기를 정하는 값이 됩니다.

## 4. OICA에 대한 반대 측 비판

반대 입장에서 가장 강하게 비판하면 이렇습니다. 항목마다 보강할 점을 붙였습니다.

**비판 1. 숙련자는 탐구하지 않는다.**
Boyd의 OODA에는 Orient에서 Decide를 거치지 않고 Act로 바로 가는 경로가 있습니다. Klein의 Recognition-Primed Decision 연구에서는, 현장 전문가가 대안을 비교하지 않고 처음 떠오른 안을 머릿속 시뮬레이션으로 확인한 뒤 바로 실행합니다. 범용 작업의 상당수는 I 없이 O → C로 가는 것이 정상입니다.
→ **보강**: I를 건너뛰는 경로를 정상 경로로 인정하고, 건너뛰었다는 사실만 기록합니다.

**비판 2. 순서는 상황의 종류에 따라 달라진다.**
Cynefin은 상황을 네 가지로 나누고, 상황마다 순서가 다르다고 봅니다.

| 상황 | 순서 |
|---|---|
| 명확 | 감지 → 분류 → 대응 |
| 복잡 | 감지 → 분석 → 대응 |
| 복합 | 탐침 → 감지 → 대응 (먼저 작게 해 봄) |
| 혼돈 | 행동 → 감지 → 대응 |

OICA는 "복잡" 상황을 전제로 한 순서입니다. 글의 방향, 사람 사이의 일, 시장 반응 같은 복합 상황에서는 C(작게 실행)가 I보다 먼저 와야 합니다.
→ **보강**: Concern에 상황 유형을 붙이고, 유형별 기본 순서를 둡니다. 실험 WorkUnit을 I의 일부로 인정합니다.

**비판 3. C 루프는 "실행"에 치우쳐 있다.**
범용 작업 다수는 무언가를 실행하는 일이 아니라 산출물(글, 조사 보고, 계획)을 만드는 일입니다. 이때는 초안이 곧 결과이고 곧 검토 대상이라 C와 A가 하나로 겹칩니다. 반대로 조사나 의사결정 지원처럼 아무것도 실행하지 않고 I에서 끝나는 작업도 많습니다.
→ **보강**: 루프를 혼자서도 돌 수 있는 모드로 둡니다. 말씀하신 대로입니다.

**비판 4. A 루프의 확인 기준이 없는 작업이 있다.**
창작이나 전략에는 근거로 받아들일 정답이 없습니다. 이런 작업에서 결과 확인은 근거 검토가 아니라 취향 판단입니다.
→ **보강**: 작업 유형별로 확인 방식을 다르게 둡니다. 취향형 작업은 "비교 가능한 대안 2~3개 + 선택"이 확인 방식입니다.

**비판 5. 사람과 에이전트 둘만 있다고 가정한다.**
범용 작업에는 제3자가 끼어듭니다. 메일 수신자의 답장, 회의 참석자의 결정 같은 것입니다. A 평면에는 외부 행위자가 있지만, 루프에는 "외부 응답을 기다리는 상태"가 없습니다.
→ **보강**: 대기를 정식 상태로 두고, 외부 응답을 관찰로 받습니다.

**뒷받침하는 증거도 하나 있습니다.** 앞의 Parasuraman 등의 네 기능(정보 수집, 분석, 결정 선택, 실행)은 O, I, C, A와 거의 같은 분할입니다. 전혀 다른 분야에서 비슷한 4단계 구분에 도달했다는 뜻입니다. 동시에 그 모델은 네 기능을 순환이 아니라 **기능별로 따로 자동화하는 대상**으로 다룹니다. 루프가 순차가 아니라는 판단과 일치합니다.

### 루프를 독립 모드로

| 단독 모드 | 예 | 입력 | 끝날 때 내는 것 |
|---|---|---|---|
| O만 | "어제 어디까지 했지" | 기록 | 복귀 요약 |
| I만 | "이 라이브러리 셋 비교해줘" | 질문 | 판단 또는 문제 정의 패킷 |
| C만 | "정해진 스펙대로 해줘" | 합의 | 제출된 결과 |
| A만 | "이 PR 리뷰해줘", "이 보고서 사실 확인" | 결과물 | 확인 의견, 반대 근거 |

어느 모드든 다른 루프가 필요해지면 그쪽으로 넘어갈 수 있습니다. 넘어가는 것 자체가 기록되는 전이입니다.

### 능력은 원시 행동으로

동의합니다. "코드 변경"은 도메인 용어였습니다. 능력을 두 층으로 나누면 깔끔해집니다.

- **원시 행동** (런타임 도구가 수행): read, write, execute, send(밖으로 보내기), spawn(하위 에이전트), ask(사람에게 묻기). 구현은 tool calling이든 REPL이든 상관없습니다.
- **기록 능력** (Helm 커널 action): observe, propose, attest, accept, integrate. 무엇을 기록에 쓸 수 있는지를 정합니다.

모드 묶음은 이 두 층에서 각각 일부를 고르고, 다이얼 값을 붙인 것이 됩니다.

| 묶음 | 원시 행동 | 기록 능력 |
|---|---|---|
| 탐색 | read, execute(읽기 목적), spawn | observe, propose |
| 실행 | read, write, execute | observe, propose |
| 검증 | read, execute | observe, propose(반대 근거), attest |
| 복귀 안내 | read | observe |

권리 게이트(send, 돈, 대리 발언)와 되돌리기 판별은 앞서 정하신 대로 권한 레이어에서 처리합니다.

## 5. 개념 정정

### Goal

동의합니다. Helm 문서도 같은 방향으로 고쳐 가던 중이었습니다. v0.2 정제 문서의 C7 항목은 Purpose가 초기화할 때 한 번 저장되고 바뀌지 않는 것을 모순으로 짚었습니다. 그리고 "Goal은 versioned normative entity다"로 정리했습니다. 수정, 중단, 대체를 이벤트로 남기고, Goal이 바뀌면 관련 컨텍스트와 합의를 무효화할 수 있게 하는 내용입니다. 말씀하신 "Concern 사이클을 거치며 계속 정제되는 프로젝트의 기반"과 같은 내용입니다.

### Concern

말씀하신 정의를 따르겠습니다. 제가 "주의가 필요한 상황"이라고 쓴 것은 영어 단어를 옮긴 것에 가까웠습니다. 문서 정의도 "문제, 기회, 위험, 불확실성일 수 있다"로 되어 있습니다. 그러니 Concern은 **10단계 과정을 돌릴 후보가 되는 상황 그 자체**로 보는 것이 맞습니다.

### Projection

자료를 다시 찾아봤습니다. 결과는 이렇습니다.

**말씀하신 개념은 Helm 자료에 있습니다. 다만 이름이 Projection이 아니라 Method Transfer(방법론 전이)입니다.**
- 위치: `docs/research/method-transfer-map.md` (35개 방법론), `docs/research/method-cards/` (20개 카드), `docs/research/README.md`
- 절차:

  ```text
  원래 분야와 그 분야의 실패
    → 그 분야의 환경 가정
    → 분야와 무관하게 유지되는 메커니즘
    → 복사하면 안 되는 것
    → Helm 요소로 번역
    → 반증 가능한 가설
    → 프로토타입과 지표
  ```

- 예: 군의 Mission Command에서 계급 구조는 복사하지 않고, "상위의 의도·제약 + 현장의 판단 자율"이라는 원리만 뽑아 Purpose, 맡긴 범위, 상향 조건으로 옮겼습니다.

**Helm 문서에서 Projection이라는 단어는 다른 두 가지 뜻으로 쓰입니다.**
1. ContextProjection: 기록에서 대상별로 뽑은 읽기 전용 화면 (kernel, 아키텍처 문서)
2. 상황 인식(Endsley)의 3단계 중 "앞으로 어떻게 될지 예측" (복귀 요약의 Changes–Assessment–Projection)

**한 가지 차이가 있습니다.** 자료에서 Method Transfer는 **Helm 자체를 설계하기 위한 연구 방법**으로 쓰였습니다. 런타임 안에서 사용자의 문제에 적용하는 기능은 아니었습니다. 말씀하신 것은 이 절차를 **탐구 루프 안의 동작**으로 옮기는 것입니다. 구체적으로는 이렇습니다.

1. 지금 문제와 구조가 비슷한 실패를 겪은 다른 분야를 찾는다
2. 그 분야의 해법에서 환경과 무관한 원리를 뽑는다
3. 복사하면 안 되는 것을 적는다
4. 지금 문제의 가능성 후보로 넣는다
5. 반증 조건을 붙인다

앞에서 설계한 발산 표의 "렌즈" 열이 정확히 이 자리이고, 이미 정리된 35개 방법론이 렌즈 목록의 초기값이 됩니다. 이름은 Projection과 겹치지 않게 "방법 전이"나 "렌즈"로 두는 편이 혼동이 적겠습니다.

### OPD+C와 클라이언트

동의합니다. opencode 같은 일반 에이전트 UI는 **대화 기록이 중심**입니다. 시간순으로 쌓이는 transcript를 사람이 따라 읽는 구조입니다. Helm 클라이언트는 **상태가 중심**이어야 합니다. 자료에 이미 Common Operating Picture, 복귀 요약, Inquiry Map, Assurance View, 그리고 v0.2 경험 문서의 Orient / Explore / Choose / Work / Review 화면이 있습니다. 오늘 논의를 더하면, 장기적으로 관찰하고 제어하는 공간에 필요한 것은 이렇습니다.

| 기준 | 화면 요소 |
|---|---|
| O | 열린 Concern 목록과 각각의 현재 모드, 다이얼 값. Goal이 Concern 사이클을 거치며 어떻게 바뀌어 왔는지 보여주는 이력 |
| P | 다음 예정 행동, 멈출 조건, 지금 쓰고 있는 가정 |
| D | 목표, 제약, 다이얼을 직접 고치면 다음 턴에 반영 |
| C | 에이전트가 혼자 정한 결정 피드와 이의 버튼. 판단마다 근거 체인을 열어 보고 다시 열기 |

Sources:
- [Horvitz, Principles of Mixed-Initiative User Interfaces (CHI 1999)](https://erichorvitz.com/chi99horvitz.pdf)
- [Parasuraman, Sheridan, Wickens, A model for types and levels of human interaction with automation (2000)](https://andrewclark.super.site/all-media/a-model-for-types-and-levels-of-human-interaction-with-automation)
- [Learning to Ask: When LLM Agents Meet Unclear Instruction (Ask-when-Needed)](https://arxiv.org/html/2409.00557v3)
- [Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents](https://www.alphaxiv.org/abs/2603.26233)
- Helm 자료: `docs/research/method-transfer-map.md`, `docs/research/README.md`, `docs/foundations/10-refinement-candidate.md` (C7)

OODA, Recognition-Primed Decision(Klein), Cynefin(Snowden), McFarlane와 Iqbal·Bailey의 인터럽션 연구는 기존 지식을 바탕으로 쓴 것이고, 이번에 원문을 다시 확인하지는 않았습니다.

오늘 바뀐 정의가 꽤 많습니다. Goal, Concern, 방법 전이, 선택 요청 세 부분, 루프 단독 모드, 능력 두 층이 바뀌었습니다. 원하시면 이것들을 Helm v0.3 개정 메모로 정리하겠습니다.

--- [124] USER ---
"끼어드는 방식을 즉시, 협상, 중재, 예약 네 가지로 나눴습니다." 이게 나는 핵심인 것 같은데, 이게 어쩌면 결정 이론의 정보가치의 세 조건의 미흡하거나 불확정적인 부분을 채울 수 있을 것 같아 조금더 디벨롭 해줘

너가 잘 말해준 것 중 하나가 나는 helm의 첫 스타트 포인트가 취향이 정답인 작업에 대해 발산론적 방법을 기반으로 사용자가 실제로 텍스트로 표현하는 요구와 실제 사용자가 가지고 있는 요구가 자기도 모르는 상태로 다르게 표현될 수 있다는 걸 가정하고, 레퍼런스나 여러 자료를 바탕으로 자극이 입력되고 여러개를 비교해보고 나서야 비로소 아 내가 이걸 원하는 걸 알 수 있네? 라는 과정을 위한 에이전트 방법론으로 생각하긴 했어. 그렇다고 현재의 방향성이 잘못됐다는게 아니라, 발산의 동기가 이거고, 어 이런식으로 하면 생각지도 못한 전혀 다른 분야에서 내 분야와 문제에 대한 사고방식 응용이나 접근이 가능하네? 적용해서 문제해결할 수 있을 것 같아! 도 되고 여튼 내 생각을 두서없이 표현해봄. 비판 4도 같은 맥락인데 이걸 단순히 비교 가능한 대안을 겨우 2~3개 던져주고 선택하라는거 자체가 말이안되는거같음. 애초에 이럴거면 그냥 llm 쓰지.

cynefin 상황 4가지는 조금 더 설명해줘 

비판 5. 사람과 에이전트 둘만 있다고 가정한다. -> 외부 응답을 inquiry 과정에서 발견된 새로운 사실 중 하나 정도의 개념으로 하면 문제가 되려나?

루프를 독립 모드로 -> 각 루프를 독립적으로만 수행하기보다는, 현재 루프 종류가 범용 작업을 커버하기에 너무 적은 범주 한 작업에 대해 여러 루프를 수행할 수 있도록 자율성을 제공해서 O + I , O + C +A 등 필요한대로 판단해서 쓰는 방식이 더 나은거같은데.

--- [125] ASSISTANT ---
다섯 가지에 차례로 답하겠습니다. 1번(끼어드는 방식)은 McFarlane 논문 원문을 다시 확인하고 정리했습니다.

## 1. 끼어드는 방식으로 정보 가치 판단의 약점 메우기

### McFarlane의 네 방식과 실험 결과

McFarlane(2002)의 실험은 36명이 참여한 실험실 이중 과제 실험입니다. 네 방식의 정의와 결과는 다음과 같습니다.

| 방식 | 정의 | 결과 |
|---|---|---|
| 즉시 | 생기는 즉시 전달하고, 사람은 하던 일을 멈추고 답해야 함 | 응답은 가장 빨랐지만, 입력 오류가 가장 많고 원래 작업 정확도가 나빴음. "가장 방해받았다"고 느낌 |
| 협상 | 질문이 왔다는 것만 알리고, 언제 볼지(볼지 말지)는 사람이 정함 | 종합적으로 가장 좋았음. 원래 작업 정확도가 높고 오류가 적었으며 가장 많이 선호됨. 대신 답이 가장 늦었음 |
| 중재 | 대리자가 받아 두고, 사람의 작업 부하를 보고 전달 시점을 정함 | 대부분 중간 성적. 원래 작업의 효율은 좋았음 |
| 예약 | 정해진 시간표에 맞춰 전달 (실험에서는 25초마다) | 작업 전환은 가장 적고 예측하기 쉬웠지만, 원래 작업 정확도와 응답 속도가 가장 나빴음 |

논문의 권고는 세 가지입니다.
- 응답 속도가 결정적인 경우가 아니면 협상을 기본으로 한다.
- 사람마다 선호가 크게 다르니(약 4분의 1은 협상을 싫어했음) 방식을 고를 수 있게 한다.
- 작업이 잠시 쉬는 지점에 전달하면 두 작업 모두 좋아진다.

예약 방식이 나빴던 것은 시간표가 작업 흐름과 무관하게 고정되어 있었기 때문입니다. 작업의 쉬는 지점에 맞춘 예약은 결과가 다를 것으로 봐야 합니다.

### 정보 가치 판단의 어느 약점을 메우는가

정보 가치(VoI) 방식의 약점은 세 값을 정확히 추정해야 한다는 것입니다. 틀릴 확률, 틀렸을 때의 손실, 묻는 비용이 그 셋입니다. 특히 "묻는 비용"은 고정값이 아니라 그때 사람이 무엇을 하고 있는지에 따라 달라집니다.

말씀하신 대로 끼어드는 방식이 이 약점을 메웁니다. "물을까 말까"를 두 개의 결정으로 나누면 됩니다.

```text
결정 1. 질문이 있는가        → 낮은 문턱. 불확실하면 일단 질문을 기록한다 (비용이 거의 없음)
결정 2. 언제, 어떻게 전달하나 → 네 방식 중 하나를 고른다
```

이렇게 나누면 세 값을 정확히 추정해야 하는 경우는 **즉시**를 고를 때뿐입니다. 나머지 세 방식은 추정이 틀려도 견딥니다.

- **협상**: "지금 볼 가치가 있나"를 사람이 직접 판단합니다. 에이전트가 가장 추정하기 어려운 조건 3을 사람에게 넘기는 셈입니다.
- **중재**: 작업 에이전트가 아닌 별도 중재자가 사람의 상태를 보고 판단합니다. 앞에서 본 "Ask or Assume?" 연구의 의도 감시 에이전트가 이 자리입니다.
- **예약**: 시간이 아니라 Helm의 작업 경계에 모아서 전달합니다. 라운드 끝, 루프 전환, 복귀 요약 같은 지점입니다.

### 질문 레코드

질문을 레코드로 만들면 이렇게 생깁니다.

```text
question:
  내용           무엇을 묻는가
  임시 가정      답을 받기 전까지 에이전트가 따르는 기본값
  막힘 여부      답이 없으면 작업이 멈추는가
  가정 만료점    이 지점을 넘기면 답이 바뀌었을 때 되돌리는 비용이 커짐
  전달 방식      즉시 / 협상 / 중재 / 예약
  상태           대기 → 전달됨 → 답함 | 가정 확정 | 만료
```

핵심은 **가정 만료점**입니다. 협상이나 예약으로 둔 질문이 답 없이 만료점에 가까워지면 즉시로 올라갑니다. "지금 묻는 가치"가 고정된 판정이 아니라 시간에 따라 커지는 값이 됩니다. 만료점까지 답이 없으면 임시 가정을 확정하고, 혼자 정한 결정으로 기록해서 나중에 이의를 걸 수 있게 둡니다.

### 정리된 규칙

| 상황 | 전달 방식 |
|---|---|
| 권리 게이트 (사람이 정할 권리가 있는 결정) | 즉시 |
| 답 없이는 작업이 멈추고, 기다리는 비용이 큼 | 즉시 |
| 가정하고 진행할 수 있음 | 사용자 기본값 (보통 협상) |
| 여러 질문이 비슷한 시점에 생김 | 다음 작업 경계에 예약 |
| 가정 만료점이 가까워짐 | 즉시로 승격 |

질문 빈도 다이얼은 세 가지 값이 됩니다. 기본 전달 방식, 즉시로 올리는 문턱, 만료점까지의 여유입니다. 논문 결과대로 기본 전달 방식은 사용자마다 다르게 둡니다.

## 2. Helm의 출발점: 원하는 것을 발견하는 과정

말씀하신 동기를 정리하면 이렇습니다. 사용자가 글로 표현한 요구와 실제로 가진 요구는 본인도 모르게 다를 수 있습니다. 그래서 레퍼런스와 자료로 자극을 주고, 여러 개를 비교한 뒤에야 "아, 내가 원한 게 이거구나"를 알게 됩니다. 이 과정을 위한 방법론이 Helm의 출발점이라는 것입니다.

이 생각은 다른 분야의 연구 결과와 맞습니다.
- 행동경제학의 **선호 구성(constructed preference)** 연구(Lichtenstein & Slovic 등): 선호는 머릿속에 미리 있다가 꺼내지는 것이 아니라, 선택지를 마주하는 순간에 만들어집니다.
- 디자인 연구: Dow 등(2010)은 시안을 하나씩 순서대로 만들 때보다 여러 개를 동시에 만들어 비교할 때 결과가 더 좋았다고 보고했습니다. Tohidi 등(2006)은 사용자에게 시안 하나만 보여주면 칭찬 위주로 반응하고, 여러 개를 보여줘야 비판적 의견이 나온다고 보고했습니다.

### 비판 4에 대해: 2~3개 고르기는 의미가 없다

동의합니다. 대안 2~3개를 주고 고르게 하는 것은 LLM 하나로도 할 수 있습니다. Helm이 달라야 하는 부분은 개수가 아니라 구조입니다.

| 단계 | 일반 LLM | Helm이 해야 하는 것 |
|---|---|---|
| 자극의 폭 | 같은 분야 안의 변형 | 다른 분야 레퍼런스까지 (방법 전이와 연결) |
| 반응의 단위 | 하나 고르기 | 요소 단위 반응 ("이 부분은 좋고 저 부분은 아님"), 이유를 못 대는 반응도 받음 |
| 기준 찾기 | 없음 | 반응에서 숨은 기준을 찾아냄 |
| 다음 자극 | 다시 평균값 근처 | 가장 불확실한 기준을 확인할 수 있는 자극을 고름 |
| 결과물 | 고른 하나 | 선호 모델: 기준, 무게, 좋았던 예와 싫었던 예 |

"기준 찾기"에는 두 가지 방법이 쓰일 수 있습니다.

- **레퍼토리 그리드 (Kelly)**: 세 가지를 보여주고 "둘은 비슷하고 하나는 다른데, 무엇 때문인가"를 묻습니다. 사람이 말로 못 하던 기준이 나옵니다.
- **비평 기반 추천 (critiquing recommender)**: 사용자가 "이것과 비슷한데 더 단순하게"처럼 예시를 고쳐 말하는 방식으로 선호를 드러냅니다.

결과물인 선호 모델은 N 칸(Goal, 완료 기준)에 들어갑니다. 그리고 다음 Concern에서 다시 쓰이고 계속 다듬어집니다. 앞에서 말씀하신 "Concern 사이클을 거치며 진화하는 Goal"이 실제로 만들어지는 과정이 이것입니다.

### 구조적으로 보면

지금까지의 I 루프는 E를 위한 탐구였습니다. **무엇이 사실인가**를 묻는 탐구입니다. 말씀하신 동기는 **N을 위한 탐구**입니다. **무엇을 원하는가**를 묻는 탐구입니다. 둘은 생김새가 같습니다.

| | 사실 탐구 (E) | 원함 탐구 (N) |
|---|---|---|
| 가설 | 원인 후보 | 선호 후보 ("단순함을 원하는 것 같다") |
| 구분 확인 | 결과가 원인에 따라 달라지는 관찰 | 반응이 선호에 따라 달라지는 자극 |
| 근거 | 도구 실행 결과 | 사용자의 반응 |
| 결과 | 판단 | 선호 모델, 완료 기준 |

그래서 I 루프를 두 종류로 나누는 것을 제안합니다. 이것이 5번에서 말씀하신 "루프 종류가 범용 작업을 덮기에 너무 적다"는 지적에 대한 답 중 하나이기도 합니다.

## 3. Cynefin 상황 네 가지

Snowden이 만든 틀로, 상황을 원인과 결과의 관계가 어떤지에 따라 나눕니다. 핵심은 **상황 종류마다 맞는 대응 순서가 다르다**는 것입니다. 아래 내용은 Snowden & Boone(2007)과 이후 Snowden의 설명을 기억으로 정리한 것입니다.

| 상황 | 원인과 결과 | 대응 순서 | 쓰는 방법 | 빠지기 쉬운 함정 | 예 |
|---|---|---|---|---|---|
| **명확** (Clear) | 누구나 보면 앎 | 감지 → 분류 → 대응 | 정해진 모범 사례 | 익숙해서 방심하다가 갑자기 혼돈으로 떨어짐 | 린트 오류 수정, 회의록 서식 맞추기 |
| **복잡** (Complicated) | 있지만 분석이나 전문가가 필요함 | 감지 → 분석 → 대응 | 여러 좋은 방법 중 전문가가 고름 | 분석 마비, 전문가가 자기 방식만 고집 | 성능 버그 원인 찾기, 세금 계산 |
| **복합** (Complex) | 지나고 나서야 보임 | 탐침 → 감지 → 대응 | 작게, 실패해도 괜찮은 실험을 여러 개 동시에 하고 잘되는 쪽을 키움 | 미리 분석해서 정답을 찾으려 함 | 제품 방향, 글의 톤, 팀에 새 도구 도입 |
| **혼돈** (Chaotic) | 찾을 시간이 없음 | 행동 → 감지 → 대응 | 우선 안정시키고 나서 봄 | 상황이 안정됐는데도 계속 비상 대응을 함 | 프로덕션 장애 (먼저 롤백) |

다섯 번째로 **혼란**(Disorder)이 있습니다. 지금이 어느 상황인지 모르는 상태입니다. 이때 사람은 자기에게 익숙한 방식으로 대응하는 경향이 있습니다. 예를 들어 분석에 익숙한 개발자는 복합 상황도 분석으로 풀려고 합니다.

Helm과 연결하면 두 가지가 보입니다.
- OICA의 기본 순서(O → I → C → A)는 **복잡** 상황에 맞춰져 있습니다.
- 말씀하신 취향형 작업은 대표적인 **복합** 상황입니다. 원하는 것은 미리 분석해서 찾을 수 없고, 자극을 던져 보고 반응을 봐야 나옵니다. 여러 자극을 동시에 보여주는 것이 Cynefin이 말하는 "실패해도 괜찮은 탐침 여러 개"와 같습니다. 그래서 2번의 원함 탐구는 Cynefin 관점에서도 맞는 방법입니다.

## 4. 외부 응답을 탐구 중 발견된 새 사실로 다루기

대부분은 문제없습니다. 외부 응답은 출처가 외부 행위자인 관찰로 기록하면 됩니다. 다만 두 가지를 보완해야 합니다.

**하나, 응답이 없는 것은 관찰되지 않습니다.**
메일을 보냈는데 답이 오지 않으면 아무 일도 일어나지 않으니, 기록에도 아무것도 남지 않습니다. 그래서 요청을 보낼 때 "기대" 레코드를 하나 남깁니다. 누구에게, 무엇을, 언제까지 받을 것으로 기대하는지를 적습니다. 기한이 지나면 타이머가 "응답 없음"이라는 관찰을 만듭니다. 이렇게 하면 말씀하신 방식(외부 응답 = 관찰)이 그대로 성립합니다. 응답이 오지 않은 것도 관찰이 되기 때문입니다.

**둘, 외부에서 온 말은 내용이 아니라 "그렇게 말했다"는 것이 관찰입니다.**
앞에서 배운 관찰과 추측의 구분이 그대로 적용됩니다. 고객이 "다음 주까지 됩니다"라고 했다면, 관찰은 "고객이 다음 주까지 된다고 말했다"입니다. "다음 주까지 된다"는 아직 추측입니다.

이 두 가지만 있으면 별도의 루프는 필요 없습니다.

## 5. 한 작업에 여러 루프를 조합하기

동의합니다. 독립 모드보다 조합이 더 맞습니다. 구조는 이렇게 제안합니다.

1. **모델이 루프 계획을 제안하고, 커널이 기록합니다.** 예를 들어 "원함 탐구 → C → A" 같은 계획입니다. 진행 중에 루프를 추가하거나 생략하는 것도 기록합니다. 이것은 1번에서 말한 "혼자 정한 결정"과 같은 방식으로 처리하므로 나중에 이의를 걸 수 있습니다.

2. **조합은 자유롭게 하되, 의존 규칙 세 가지만 코드로 강제합니다.**
   - write나 send를 하려면 C(합의)가 있어야 합니다. 단, 짧게 압축된 C도 됩니다.
   - "완료"라고 하려면 A를 거쳐야 합니다.
   - 판단으로 올리려면 I에서 나온 근거가 있어야 합니다.

3. **Cynefin 상황 유형별로 기본 조합을 둡니다.**

| 상황 | 기본 조합 |
|---|---|
| 명확 | O → C → A (A는 자동 검증) |
| 복잡 | O → 사실 탐구 → C → A |
| 복합 | O → 원함 탐구 ⇄ 작은 C (탐침) → 선호 모델 → C → A |
| 혼돈 | C (안정화) → O → 사실 탐구 → A |
| 혼란 | O → 상황 유형 판단부터 |

4. **루프 종류는 이렇게 됩니다.**
   - I를 사실 탐구와 원함 탐구로 나눕니다.
   - 외부 행위자와의 조정은 4번 방식(기대 레코드 + 응답 없음 관찰)으로 처리하므로 별도 루프로 만들지 않습니다.

Sources:
- [McFarlane, Comparison of four primary methods for coordinating the interruption of people in human-computer interaction (HCI, 2002)](https://www.interruptions.net/literature/McFarlane-HCI02_2.pdf)
- [Horvitz, Principles of Mixed-Initiative User Interfaces (CHI 1999)](https://erichorvitz.com/chi99horvitz.pdf)
- [Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents](https://www.alphaxiv.org/abs/2603.26233)

Cynefin(Snowden & Boone 2007), 선호 구성(Lichtenstein & Slovic), 병렬 프로토타이핑(Dow 등 2010), Tohidi 등(2006), 레퍼토리 그리드(Kelly), 비평 기반 추천 연구는 기존 지식으로 정리했고, 이번에 원문을 다시 확인하지는 않았습니다.

다음 단계로는 1번의 질문 레코드와 전달 방식 규칙을 helm.mjs에 붙여 보는 것을 제안합니다. 같은 작업을 기본 전달 방식만 바꿔서 돌려 보면, 질문이 언제 기록되고 언제 실제로 전달되며 언제 가정이 확정되는지를 직접 볼 수 있습니다.

--- [126] USER ---
방금 보강해준 부분들 전부 좋은거같음 추가적으로 사실탐구, 원함 탐구 외에 또다른 탐구 방법론에 대한 디벨롭이 필요할까? 그리고 각 5가지 상황에 대해서 OCA 기본조합으로도 충분할까?

--- [127] ASSISTANT ---
두 질문 모두 "필요하다"가 제 답입니다. 다만 무엇을 추가할지는 기준을 정해 놓고 골라야 늘어나기만 하지 않습니다.

## 1. 탐구 종류를 더 둘 것인가

### 나누는 기준

탐구 종류를 따로 두려면 두 가지가 달라야 합니다. **무엇을 근거로 삼는가**와 **언제 멈추는가**입니다. 둘이 같으면 같은 탐구의 변형이고, 다르면 다른 방법론이 필요합니다. 사실 탐구와 원함 탐구를 나눈 것도 이 기준 때문입니다. 근거가 관찰과 반응으로 다르고, 멈추는 조건도 "1순위 원인이 안정됨"과 "선호 모델이 안정됨"으로 다릅니다.

이 기준으로 보면 두 가지를 더 두는 것이 맞다고 봅니다.

| 탐구 | 묻는 것 | 근거 | 멈추는 조건 | 참고할 방법 |
|---|---|---|---|---|
| 사실 탐구 | 무엇이 그런가 | 관찰 | 1순위 원인이 두 라운드 연속 유지됨 | 경쟁 가설 분석, 구분 확인 |
| 원함 탐구 | 무엇을 원하는가 | 사용자의 반응 | 선호 모델의 기준과 무게가 더 바뀌지 않음 | 레퍼토리 그리드, 비평 기반 추천 |
| **가능성 탐구** | 무엇이 될 수 있는가 | 다른 분야 사례, 작은 실현 가능성 확인 | 발산 표의 빈 칸이 닫히고, 실현 가능한 후보가 하나 이상 있음 | 방법 전이, 형태 분석(Zwicky box), TRIZ |
| **결과 탐구** | 하면 무엇이 일어나는가 | 시뮬레이션, 비슷한 사례, 사전 부검 | 주요 실패 경로마다 대응이나 감시 조건이 붙음 | 사전 부검(Klein), 시나리오 계획, STPA |

**가능성 탐구를 따로 두는 이유**: 사실 탐구는 이미 있는 것을 찾고, 가능성 탐구는 아직 없는 것을 만듭니다. 그래서 근거가 다릅니다. 가능성 탐구에는 관찰할 대상이 아직 없으니 다른 분야의 사례와 작은 시도가 근거가 됩니다. 말씀하신 "생각지도 못한 다른 분야의 사고방식을 내 문제에 적용하기"가 이 탐구의 중심 방법입니다. 지금까지는 이것이 사실 탐구의 발산 단계에 섞여 있었습니다.

**결과 탐구를 따로 두는 이유**: 미래는 지금 관찰할 수 없습니다. 그래서 근거가 예측이고, 예측은 나중에 실제 결과로 확인해야 합니다. 이 탐구의 산출물은 판단이 아니라 **"이런 일이 일어날 것이다, 이 날짜에 확인한다"는 예측 레코드**입니다. 이 레코드가 다시 볼 조건이 되고, OPD+C의 Predictability와도 연결됩니다. Klein의 사전 부검은 "이 일이 실패했다고 가정하고, 왜 실패했는지 써 보라"는 방식입니다. 낙관 편향을 줄이는 데 효과가 있다고 알려져 있습니다.

### 따로 두지 않아도 되는 것

- **관점 탐구** ("이건 어떤 종류의 문제인가"): 모든 탐구의 앞에 오는 일이라 별도 탐구가 아니라 O의 Frame 단계에 둡니다. 아래 2번에서 다루는 상황 판정이 여기에 해당합니다.
- **정당성 탐구** ("해도 되는가, 누가 영향을 받는가"): 일반 범용 작업에서는 필요하지만, 앞에서 권리와 위험 판별을 권한 레이어로 넘기기로 했습니다. 사용자 본인의 가치 판단이라면 원함 탐구로 처리됩니다.

### 네 탐구는 섞어서 쓴다

네 탐구도 루프처럼 조합해서 씁니다. 취향형 작업이라면 이런 흐름이 됩니다.

```text
원함 탐구 → 가능성 탐구 → 결과 탐구 → 선택
```

성능 문제라면 이렇게 됩니다.

```text
사실 탐구 → 가능성 탐구 → 결과 탐구 → 선택
```

## 2. 다섯 상황에 기본 조합으로 충분한가

충분하지 않습니다. 명확과 복잡은 거의 충분하고, 나머지 셋에서는 OICA에 없는 것이 필요합니다.

### 상황별 점검

**명확**: O → C → A로 거의 충분합니다.
빠진 것은 하나입니다. Cynefin에서 명확 상황의 위험은 방심입니다. "늘 하던 일"이라 생각하고 진행하다가 실제로는 상황이 바뀌어 있는 경우입니다. A의 자동 검증에서 예상과 다른 결과가 나오면 상황을 다시 판정하게 해야 합니다.

**복잡**: O → 사실 탐구 → C → A로 충분합니다.
선택에 부작용이 걸려 있으면 결과 탐구를 넣습니다.

**복합**: 부족합니다. 두 가지가 없습니다.
- **탐침으로서의 C**: Snowden은 복합 상황에서 실패해도 괜찮은 실험을 여러 개 동시에 하라고 하고, 시작하기 전에 키울 조건과 접을 조건을 정해 두라고 합니다. 지금의 C는 "결정한 것을 실행하는 약속" 하나뿐입니다. 결과를 모르는 상태에서 여러 개를 시도하는 C가 따로 필요합니다.
- **지속 관찰로서의 A**: 복합 상황에는 미리 정한 완료 기준이 없습니다. 결과를 받아들이거나 거절하는 A가 아니라, 내보낸 뒤에도 계속 보면서 잘되는 쪽을 키우고 안 되는 쪽을 접는 A가 필요합니다.

**혼돈**: 부족합니다. 앞에서 정한 의존 규칙과 충돌합니다.
"write를 하려면 C(합의)가 필요하다"고 했는데, 혼돈 상황에는 합의할 시간이 없습니다. 그래서 **미리 맺어 둔 합의**가 필요합니다. 프로덕션 장애가 나면 롤백까지는 묻지 않고 해도 된다는 식의 비상 합의입니다. 안정된 뒤에는 바로 끝나는 것이 아니라 복합이나 복잡 상황으로 넘어가고, A는 사후 검토(Reflect)가 큰 비중을 차지합니다.

**혼란**: 부족합니다. "O에서 상황 유형부터 판단한다"고만 했는데, 지금의 O에는 그 단계가 없습니다. 두 가지가 필요합니다.
- **상황 판정**: 모델이 근거와 함께 유형을 제안하고 기록합니다. 판정도 혼자 정한 결정으로 다루므로 이의를 걸 수 있습니다. 사람이든 모델이든 익숙한 방식으로 기우는 경향이 있으니, 판정 근거를 남기는 것이 중요합니다.
- **분해**: Snowden은 혼란 상황에서 문제를 쪼개서 부분마다 다른 유형에 배정하라고 합니다. Concern 하나를 유형이 다른 하위 Concern 여러 개로 나누는 단계가 필요합니다.

### 모든 상황에 걸쳐 빠진 것

**하나, 상황 유형은 바뀝니다.**
장애는 혼돈으로 시작해서, 안정되면 복합이 되고, 원인이 보이면 복잡이 되고, 대응 절차가 생기면 명확이 됩니다. 그러니 상황 유형은 Concern에 한 번 붙이고 끝나는 값이 아니라, 재진입 규칙을 가진 상태여야 합니다.

**둘, 돌아보기(Reflect)가 다음 명확 상황을 만듭니다.**
복잡 상황을 여러 번 풀다 보면 정해진 절차가 생기고, 그 일은 명확 상황이 됩니다. 이 대화 초반에 이야기한 **관찰 에이전트 C**가 여기에 들어갑니다. 세션 로그에서 반복 패턴을 찾아 스크립트나 스킬로 만드는 일이, Cynefin으로 보면 복잡 상황을 명확 상황으로 옮기는 일입니다.

### 고친 기본 조합

| 상황 | 기본 조합 | 새로 필요한 것 |
|---|---|---|
| 명확 | O → C → A(자동 검증) | 예상 밖 결과가 나오면 상황 재판정 |
| 복잡 | O → 사실 탐구 → (결과 탐구) → C → A | 없음 |
| 복합 | O → 원함·가능성 탐구 ⇄ 탐침 C 여러 개 → 지속 관찰 A → 키우기·접기 | 탐침 C, 지속 관찰 A |
| 혼돈 | 비상 합의로 C(안정화) → O → 복합이나 복잡으로 재판정 → Reflect | 미리 맺어 둔 합의 |
| 혼란 | O(상황 판정 + 분해) → 하위 Concern마다 위 조합 | 상황 판정 단계, Concern 분해 |
| 모든 상황 | 상황 유형은 바뀔 수 있는 상태, Reflect는 반복을 명확 절차로 만듦 | 재판정 규칙, Reflect → P와 스킬 |

정리하면 OICA의 네 루프는 그대로 두되, 그 안에 변형 세 가지와 단계 두 가지를 추가하는 구조가 됩니다.
- C의 변형: 약속형 C와 탐침형 C
- A의 변형: 확인형 A와 지속 관찰형 A
- 미리 맺어 두는 비상 합의
- O의 단계: 상황 판정
- O의 단계: Concern 분해

Cynefin의 세부 내용(구분 조건, 키울 조건과 접을 조건)과 사전 부검, 형태 분석, TRIZ는 기존 지식으로 정리했고, 이번에 원문을 다시 확인하지는 않았습니다.

여기까지 개정된 내용이 꽤 쌓였습니다. 탐구 네 종류, 루프 변형, 상황 판정, 질문 레코드와 전달 방식, Goal·Concern 정의, 방법 전이입니다. 원하시면 Helm v0.3 개정 메모로 한 번 정리하겠습니다.

--- [128] USER ---
Helm v0.3 개정 메모 정리 한번하고 이는 기존 문서를 업데이트하는 방식이아니라, 새 md 문서들을 최대한 상세히작성해줘.

상황유형이 바뀌는것에 대해 매우 동의하고 나도 그걸 위해서, 기본 조합이 언제든지 다른 루프로 전환가능하다는 전제가 깔려야할거같음또 하나 concern을 여러개로 나누는 것 조차 하나의 루프로 보고 다른 상황이나 루프 상황에서도 판단에 따라 수행가능하도록 하는 방안은 어떤지도 묻고싶음 추가 탐구들은 좋음

--- [129] ASSISTANT ---
[SendUserMessage] v0.3 개정 메모를 새 md 문서 묶음으로 작성하겠습니다. 기존 문서는 건드리지 않고 Helm 프로젝트 안에 `docs/v0.3/` 폴더를 새로 만들어 넣는 방식으로 진행합니다. Concern 분해를 루프로 다루는 방안에 대한 의견도 문서에 반영하고 마지막에 따로 정리해 드리겠습니다.

--- [130] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/00-README.md]

--- [131] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/01-scope-and-motivation.md]

--- [132] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/02-core-concepts.md]

--- [133] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/03-loops-and-transitions.md]

--- [134] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/04-inquiry-types.md]

--- [135] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/05-situation-types.md]

--- [136] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/06-asking-and-interruption.md]

--- [137] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/07-modes-and-capabilities.md]

--- [138] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/08-runtime-architecture.md]

--- [139] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/09-client-opdc.md]

--- [140] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/10-critique-and-open-questions.md]

--- [141] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/11-references.md]

--- [142] ASSISTANT ---
Helm v0.3 개정 메모를 새 md 문서 12개로 작성했습니다. 기존 문서는 수정하지 않았고, 파일은 이 대화에 첨부해 두었습니다.

원래는 Helm 프로젝트의 `docs/v0.3/` 폴더에 바로 넣으려 했지만, 저장하려는 시점에 컴퓨터가 연결되어 있지 않아서 쓰지 못했습니다. 컴퓨터가 잠자기 상태이거나, 오프라인이거나, Claude 데스크톱 앱이 닫혀 있었을 수 있습니다. 앱을 다시 열어 주시면 그 폴더에 넣겠습니다. 첨부 파일을 직접 옮기셔도 됩니다.

**문서 구성**
- **00 README**: v0.2 대비 바뀐 것, 더한 것, 뺀 것, 유지한 것. 이번에 결정된 10가지.
- **01~05 이론**: 범위와 동기, 핵심 개념, 루프와 전환, 탐구 네 종류, 상황 유형.
- **06~09 운영과 구현**: 묻기와 끼어들기, 모드와 능력, 런타임 구조, 클라이언트.
- **10~11**: 비판과 반증 조건, 참고 자료.

각 절에는 [결정]과 [제안]을 표시했습니다. 외부 자료는 "원문 확인 / 초록 확인 / 출처 위치 확인 / 기존 지식" 중 어디까지 확인했는지도 적어 두었습니다.

**질문하신 두 가지에 대한 답 (03에 반영)**

1. **기본 조합은 언제든 다른 루프로 전환할 수 있다**: 03의 첫 원칙으로 넣었습니다. 기본 조합은 계획일 뿐이고, 어느 루프에서든 다른 루프로 옮길 수 있습니다. 옮길 때는 이유와 함께 기록하고, 모델이 정한 전환에는 이의를 걸 수 있습니다. 커널이 막는 것은 의존 규칙 다섯 개뿐입니다. 예를 들어 write나 send를 하려면 합의가 필요하고, "완료"라고 하려면 A를 거쳐야 합니다.

2. **Concern 분해를 하나의 루프로 두는 방안**: 좋은 방향이라고 봅니다. **구조 루프(S)**로 넣었습니다. 분해는 혼란 상황에서만 필요한 것이 아닙니다. 탐구 중에 문제가 둘로 나뉠 때, 실행 중에 범위가 커질 때, 반영 중에 새 문제가 드러날 때도 필요합니다. 그리고 자기 입력, 산출, 종료 조건, 되돌리는 동작(재조합)을 모두 가지고 있어서 다른 루프와 같은 성질입니다.

   O, I, C, A가 Concern 하나의 안쪽을 다룬다면, S는 Concern들의 구조를 다룹니다. 분해 말고도 병합, 독립, 재배치, 재조합까지 맡습니다. 다만 나눌 때 위험이 따르므로 규칙 몇 가지를 함께 두었습니다.
   - 하위 Concern도 상위와 Goal에 연결된 상태를 유지합니다.
   - 하위가 모두 반영되기 전에는 상위를 닫을 수 없습니다.
   - 나눈 부분 사이에 걸치는 것을 경계 항목으로 기록합니다.
   - 하위 Concern의 개수와 깊이에 상한을 둡니다.

   v0.2에서 "거시 루프"라고 부르던 것도 이 S 루프를 Goal 수준에서 돌리는 것으로 정리됩니다.

다음 단계로는 장난감 커널에 질문 레코드, 루프 전환, 구조 루프 규칙을 붙여서 문서 내용이 실제로 동작하는지 확인하는 것을 권합니다. 문서 10의 검증 순서 1번입니다.

--- [143] USER ---
아키텍쳐와 구현 세부 설계계획을 구체화 해줘 그리고 assistant ui + pi +pi durable로 구현 가능할 지 검토해줘

--- [144] ASSISTANT ---
[Write /home/claude/durable-lab/spike/helm-spike.mjs]

--- [145] ASSISTANT ---
[Write /home/claude/durable-lab/spike/concern-task-spike.mjs]

--- [146] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/12-implementation-architecture.md]

--- [147] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/13-stack-feasibility.md]

--- [148] ASSISTANT ---
구현 설계 문서(12)와 스택 타당성 검토 문서(13)를 작성했습니다. 이번에는 컴퓨터가 연결되어 있어서 Helm 프로젝트에 바로 저장했습니다.

- `docs/v0.3/`: 앞서 만든 00~11과 새로 쓴 12, 13
- `experiments/durable-spike/`: 아래에서 설명하는 검증용 코드 2개

**결론: assistant-ui + pi + pi-durable 조합으로 구현할 수 있습니다.** 다만 셋을 같은 무게로 쓰는 것이 아니라 역할을 나눠야 합니다.

| 구성요소 | 역할 |
|---|---|
| pi-durable | Helm 런타임의 바탕 |
| pi-ai | 모델 연결 |
| assistant-ui | 대화 패널과 도구 카드만 |
| pi coding agent | 주 경로에서 제외하고, 나중에 두 번째 어댑터로 사용 |

pi coding agent 1.1.0은 pi-durable에 의존하지 않는 별개 런타임이고, 확장 API도 서로 다릅니다. 둘을 한 경로에 섞으면 런타임이 두 개가 됩니다.

**pi-durable 검증 결과**

말로만 판단하지 않으려고, 실제 모델 대신 정해진 응답을 내는 가짜(faux) 모델로 검증용 코드 두 개를 돌려 봤습니다.
- **합의·제출 흐름**: 합의 없이 파일을 쓰려는 시도, 합의 범위 밖에 쓰려는 시도, 지어낸 근거로 결과를 제출하려는 시도가 모두 막혔고, 막힌 시도도 기록에 남았습니다. 합의 확정과 결과 확인은 사람 쪽 경로로만 이뤄졌습니다.
- **Concern 상태 기계**: 합의를 기다리는 도중에 프로세스를 종료하고 다시 열어도, 이어서 하위 작업을 만들고 완료까지 진행됐습니다.

설계에 영향을 준 발견이 두 가지 있습니다.
- pi-durable의 훅은 문서를 읽기만 할 수 있습니다. 그래서 차단 판단은 훅에서 하고, 기록은 도구 쪽에서 하도록 나눴습니다.
- 사람의 결정을 기다리는 전용 기능이 없어서 이번 검증에서는 주기적으로 확인하는 방식으로 구현했습니다. 실제 구현에서는 이벤트 방식으로 바꿀 방법을 찾아야 합니다.

실제 모델 공급자로 돌려 보는 것과 분기·검증자·요약 동작 확인은 아직 하지 않았고, 13 §3.3에 목록으로 남겼습니다.

**assistant-ui를 대화 패널 전용으로 한정한 이유**

assistant-ui는 대화 스레드 중심이라, Helm의 상태 중심 화면(홈, 질문함, 결정 피드, 탐구 보드, 다이얼)은 어차피 직접 만들어야 합니다. 연결 방식은 이렇게 정했습니다.
- `ExternalStoreRuntime`에 자체 WebSocket 스트림을 붙입니다.
- 도구 카드의 확인 버튼은 모델 쪽 경로가 아니라 서버의 결정 명령으로 보냅니다. 사람의 결정이 모델 도구 경로를 거치면 안 되기 때문입니다.
- 서버 상태를 통째로 흘려보내는 AssistantTransport 방식도 검토했지만 쓰지 않습니다. 재접속 기능에 필요한 sync server가 enterprise 플랜 전용이고, 전송 형식도 바뀔 예정입니다.
- React 18을 지원하므로 지금 쓰시는 CSR 환경에 그대로 맞습니다.

**12에 들어간 구현 설계**
- 패키지 구조: kernel, protocol, durable 어댑터, server, permission, web
- Helm 레코드를 pi-durable 구성요소에 대응시킨 표
- 커널과 어댑터 사이 인터페이스 (`decide` / `apply` / `effects`)
- Concern task의 phase 구성
- 모델에게 주는 helm_* 도구 15개와 훅 4개
- 서버의 HTTP 명령과 WebSocket 스트림 설계
- 클라이언트 구성과 대표 흐름 세 가지
- M1~M8 단계별 계획

**결정해 주셔야 할 것**

12 §15에 네 가지를 남겼습니다. 그중 가장 큰 것은 **클라이언트를 웹으로 먼저 만들지**입니다. v0.2의 결정 D1은 "CLI 먼저"였는데, 상태 중심 화면은 터미널에서 구현하기 어려워서 이 문서는 웹 먼저로 바꿔 제안했습니다.

다음 단계로는 M1(커널)과 M2(합의·확인 흐름 어댑터)를 화면 없이 가짜 모델 테스트로 먼저 진행하는 것을 권합니다. 이번 검증용 코드 두 개가 그대로 첫 통합 테스트가 됩니다.

Sources:
- [assistant-ui: ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [assistant-ui: Picking a Runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime)
- [assistant-ui: AssistantTransport](https://www.assistant-ui.com/docs/runtimes/assistant-transport)
- [assistant-ui: Tools](https://www.assistant-ui.com/docs/guides/tools)

--- [149] USER ---
먼저 궁금한거 pi durable이랑 pi coding agent중 하나밖에 못쓰는게 사실임? 사실이라면 뭐가 더 나음? pi ai랑 pi coding agent는 다른역할임?

--- [150] ASSISTANT ---
결론부터 말하면, "둘 중 하나만 쓸 수 있다"는 정확한 표현이 아닙니다. 정확히는 **대화 하나를 돌리는 루프는 둘 중 하나여야 한다**입니다. 지난 답에서 "주 경로에 둘 다 넣으면 런타임이 둘이 된다"고 한 것도 이 뜻이었습니다.

## 1. pi 패키지들의 층

설치된 패키지의 의존성 목록을 보면 구조가 이렇습니다.

```text
pi coding agent (완성된 앱: CLI/TUI, 확장 API)     pi-durable (하네스 라이브러리)
  └─ pi-agent-core (에이전트 루프)                   └─ 자체 루프 + 저장소 + task
        └─ pi-ai ─────────────────────────────────────────┘
           (모델 공급자 연결)
```

- **pi-ai**: 모델을 부르는 라이브러리입니다. OpenAI, Anthropic 등 여러 공급자를 같은 형식으로 호출하고, 스트리밍과 도구 호출 형식을 맞춰 줍니다. 루프는 없습니다. 테스트에 쓴 faux 공급자도 여기에 있습니다.
- **pi coding agent**: pi-ai와 pi-agent-core 위에 만든 **완성된 앱**입니다. 터미널 UI, 기본 도구, 세션, 확장 API를 갖추고 있습니다.
- **pi-durable**: pi-ai 위에 만든 **또 다른 하네스 라이브러리**입니다. pi-agent-core를 쓰지 않고 자기 루프를 따로 가지고 있습니다(설치된 의존성에 pi-agent-core가 없음).

그래서 pi-ai와 pi coding agent는 역할이 다릅니다. pi-ai는 부품이고 pi coding agent는 그 부품으로 만든 완성품입니다. pi coding agent와 pi-durable은 같은 부품(pi-ai)을 쓰는 **두 개의 다른 루프**입니다.

## 2. 같이 쓸 수 있는가

한 대화 안에서 두 루프를 섞을 수는 없습니다. 둘은 세션 저장 방식도, 확장 API도 다릅니다. 하지만 역할을 나누면 같이 쓸 수 있습니다.

| 방식 | 구조 | 대가 |
|---|---|---|
| A. pi-durable만 | Concern과 WorkUnit 모두 pi-durable 대화로 실행 | 코딩 도구와 UI를 직접 갖춰야 함 |
| B. pi-durable이 지휘, pi coding agent가 실행 | Concern task(pi-durable)가 WorkUnit마다 pi coding agent를 RPC 모드나 SDK로 띄우고, 이벤트를 관찰로 받음 | WorkUnit 내부는 pi-durable의 재개 보장을 받지 못함(중간에 죽으면 WorkUnit을 처음부터 다시). 합의 범위 검사는 pi 확장으로 따로 구현해야 함 |
| C. pi coding agent만 | Helm 커널을 pi 확장으로 붙임 | 원자적 기록, task 상태 기계, 지속 타이머가 없음 |

B 방식은 지난 문서(12, 13)에 넣지 않았던 선택지입니다. 실제로 쓸 만합니다. pi coding agent의 잘 갖춰진 코딩 도구(편집, bash, codemode, MCP, 컴팩션)를 그대로 쓰면서도, Helm의 상태 기계와 기록은 pi-durable이 맡게 됩니다.

## 3. 무엇이 더 나은가

용도에 따라 다릅니다.

| 기준 | pi coding agent | pi-durable |
|---|---|---|
| 성숙도 | 완성된 앱, 확장 생태계 있음 | 실험 단계 |
| UI | 터미널 UI 있음 | 없음 |
| 기본 도구 | 풍부함 (codemode, MCP 내장 등) | read, write, edit, bash 정도 |
| 기록과 대화의 일관성 | 세션 JSONL과 Helm 기록이 따로 저장됨 | 같은 commit에 함께 들어감 |
| 상태 기계, 하위 작업 대기 | 없음 (직접 구현) | task로 지원 |
| 재시작 후 재개 | 세션 재개 수준 | 실행 중이던 task까지 재개 |
| 사람이 없을 때 실행 | 별도 프로세스 필요 | 같은 프로세스의 background task |

- **지금 매일 코딩하는 도구**로는 pi coding agent가 낫습니다.
- **Helm 엔진**으로는 pi-durable이 낫습니다. Helm이 요구하는 결정성(기록과 대화가 어긋나지 않음, 상태 기계, 재시작, 타이머)을 직접 지원하는 쪽이 pi-durable이기 때문입니다.

그래서 권하는 구성은 이렇습니다.
1. Helm 엔진은 pi-durable로 만듭니다.
2. pi coding agent는 지금처럼 일상 도구로 계속 씁니다.
3. 엔진이 어느 정도 서면, 코딩 성격의 WorkUnit을 pi coding agent에 맡기는 B 방식을 시험합니다.

이렇게 하면 처음에 말씀하신 "어떤 런타임이든 같은 하네스를 쓴다"는 목표도 자연스럽게 확인됩니다. pi coding agent가 Helm 커널에 붙는 첫 번째 외부 실행기가 되기 때문입니다.

원하시면 B 방식을 13번 문서에 선택지로 추가하고, pi coding agent를 RPC로 띄워 WorkUnit 하나를 실행하는 작은 검증 코드를 만들어 보겠습니다.

--- [151] USER ---
어시스턴트 ui는 대화말고는 부적합함?

--- [152] ASSISTANT ---
정정하겠습니다. 지난 13번 문서에서 "대화 패널 전용"이라고 한 것은 너무 좁게 본 판단이었습니다. 그때는 런타임과 도구 문서만 확인했습니다. 이번에 assistant-ui 문서 색인 전체를 확인해 보니, 대화 밖에서 쓸 수 있는 기능이 꽤 많습니다. 다만 각 기능의 상세 페이지까지 읽지는 않았기 때문에, 아래 판단은 색인 수준의 확인입니다.

## 1. 대화 밖 기능

| 묶음 | 기능 |
|---|---|
| 스레드 밖에서 상태 읽기 | `useAui`, `useAuiState`, 독립 상태 저장소(`@assistant-ui/store`), React 밖에서 도는 상태 관리(`@assistant-ui/tap`) |
| 사람과 모델이 함께 편집하는 컴포넌트 | Interactable Tool UIs: 스레드 옆에 두고 사람과 모델이 모두 읽고 고치는 상태 컴포넌트 (unstable) |
| 생성형 UI | 미리 정해 둔 컴포넌트 목록으로 모델이 화면을 조립(JSONGenerativeUI), 그 화면의 버튼 동작을 받는 핸들러(Generative UI Actions) |
| 미리 만든 요소 | 승인 카드(Approval card), 도구 타임라인, Background runs(실행 중인 일과 결과를 모으는 함), Canvas(문서를 스레드 옆에 크게), Artifact card(버전이 있는 산출물), Timeline, Flow graph, Trace waterfall |
| 앱 화면을 모델에게 노출 | `makeAssistantVisible`, Component Tools, Model Context |
| 디자인 부품 | Dialog, Sheet, Table, Diff Viewer, Steps 등 |

## 2. Helm 화면별 적합도

| Helm 화면 | 쓸 만한 assistant-ui 기능 | 판단 |
|---|---|---|
| Concern 대화 | Thread, 도구 렌더러 | 적합 |
| 합의 카드, 결과 확인 카드 | Approval card, 도구 UI | 적합. 단 버튼은 서버의 결정 명령으로 연결 |
| 원함 탐구 자극판 | Interactable Tool UIs, 생성형 UI | 가능성 큼. 요소 단위 반응 UI를 이 위에 만들 수 있는지는 확인 필요 |
| 가능성 비교, 대비 압축 | 생성형 UI (모델이 정해진 카드 목록으로 비교 화면 조립) | 적합해 보임 |
| 루프 이력, 전환 기록 | Timeline, Flow graph | 적합해 보임. Helm 기록을 그 데이터 형식으로 바꿔 넣어야 함 |
| 질문함, 진행 중인 WorkUnit | Background runs | 개념은 맞음. 다만 assistant-ui의 "run" 개념에 묶여 있을 가능성이 있어 확인 필요 |
| 산출물(초안, 문서) | Canvas, Artifact card | 적합해 보임 |
| 홈 (Goal, Concern 트리) | 해당 요소 없음 | 직접 구현 (디자인 부품은 사용 가능) |
| 근거 체인, 다이얼, 에이전트가 정한 것 | 해당 요소 없음 | 직접 구현 |

정리하면 assistant-ui는 대화 패널만이 아니라 **카드, 비교 화면, 타임라인, 산출물 영역**까지 쓸 수 있습니다. 직접 만들어야 하는 것은 Helm 고유의 구조를 보여주는 화면입니다. Goal과 Concern 트리, 근거 체인, 다이얼, 결정 피드가 여기에 해당합니다.

## 3. 쓸 때 지켜야 할 조건

assistant-ui의 일부 기능은 **모델이 앱 상태를 직접 고치는 것**을 전제로 합니다. 대표적으로 Interactables, Component Tools, 생성형 UI의 동작 핸들러가 그렇습니다. 그런데 Helm의 원칙은 반대입니다. "모델은 제안만 하고 커널이 기록한다", "사람의 결정은 모델 도구 경로를 거치지 않는다." 그래서 이 기능들을 쓰려면 연결 방식을 정해야 합니다.

- 모델이 고친 내용은 앱 상태에 바로 들어가지 않고, 커널에 **제안**으로 보냅니다. 받아들여진 것만 스트림을 통해 화면에 돌아옵니다.
- 사람이 카드나 생성형 UI에서 누른 버튼은 서버의 `/decisions` 명령으로 보냅니다.

이렇게 연결하면 assistant-ui의 화면 요소를 쓰면서도 Helm의 규칙이 유지됩니다.

## 4. 확인이 필요한 것

- Background runs, Timeline 같은 요소가 Assistant Cloud(유료 백엔드)나 assistant-ui 고유의 상태 모델에 묶여 있는지, 아니면 우리 데이터를 넣어 쓸 수 있는지
- Interactables가 unstable인데, 얼마나 자주 바뀌는지
- 생성형 UI의 컴포넌트 목록을 Helm 카드(가능성, 반대 근거, 질문)로 정의할 수 있는지

원하시면 위 세 가지를 상세 문서로 확인한 뒤, 13번 문서의 assistant-ui 절과 12번 문서의 클라이언트 구성을 이 내용에 맞게 고치겠습니다.

Sources:
- [assistant-ui 문서 색인 (llms.txt)](https://www.assistant-ui.com/llms.txt)

--- [153] USER ---
가능한 많은 어시스턴트 자료들조사해서 적합성 추가로 판단하고 assitatn ui + pi 런타임 + 자체 영속성 스토어 확장구현 이런 구조는 어떰

--- [154] ASSISTANT ---
[Write /mnt/user-data/outputs/helm-v0.3/14-alternative-structure.md]

--- [155] ASSISTANT ---
좋은 구조라고 봅니다. 오히려 지난번에 권한 pi-durable 경로보다 Helm의 원래 목표에 더 잘 맞아서, 권고를 이 구조로 바꿨습니다. 검토 내용은 14-alternative-structure.md에 정리했습니다. 이번에는 컴퓨터 연결이 끊겨 있어서 Helm 프로젝트에는 저장하지 못했고, 파일만 첨부했습니다.

**이 구조가 더 맞는 이유**

처음 목표는 "어떤 런타임을 쓰든 같은 하네스"였습니다. 그러려면 Helm의 상태가 런타임 바깥, Helm이 정한 스키마에 있어야 합니다.
- pi-durable 경로에서는 Helm 상태가 pi-durable의 저장 형식 안에 들어갑니다. 런타임을 바꾸면 저장 방식도 바뀝니다.
- 이 구조에서는 Helm 저장소가 독립되어 있고, pi coding agent는 바꿔 끼울 수 있는 실행기가 됩니다.

여기에 장점이 더 있습니다.
- 이미 매일 쓰는 1.x 앱이라 실험 단계 패키지에 의존하지 않습니다.
- 도구가 풍부합니다(edit, bash, codemode, MCP, 컴팩션).
- 확장 핸들러에서 저장소에 바로 쓸 수 있습니다. pi-durable의 훅은 읽기만 가능했습니다.
- SQLite 저장소라 여러 프로세스가 동시에 접근할 수 있습니다.

**가장 중요한 설계 결정: 기록을 어디에 둘지**

pi는 자기 세션 기록(JSONL)을 따로 씁니다. Helm 저장소와 따로 쓰면 한쪽만 기록되는 경우가 생깁니다. 그래서 이렇게 하는 방안을 권합니다.
- pi 세션은 메모리에서만 돌립니다(`SessionManager.inMemory`).
- 대화 기록과 Helm 레코드를 같은 SQLite 트랜잭션으로 Helm 저장소에 함께 씁니다.
- 재시작하면 저장소에서 항목을 읽어 세션을 복원합니다.

pi의 저장 방식 자체를 Helm 저장소로 바꾸는 방법은 타입 정의를 확인해 보니 불가능했습니다. 생성자가 private이고, 파일 방식과 메모리 방식만 제공합니다.

**대가**

pi-durable이 해 주던 재시작 후 재개, 상태 기계, 하위 작업 대기와 취소 전파, 타이머, 재실행 안전성을 직접 만들어야 합니다. 14번 §4에 항목별 난이도를 적었습니다. 대부분 낮음이나 중간이고, 상태 기계와 재진입 규칙은 어차피 Helm 커널이 맡을 일입니다.

**assistant-ui 추가 조사 결과**

대화 패널 말고도 쓸 수 있는 것이 꽤 있었습니다.

| 기능 | 판단 |
|---|---|
| 승인 카드, 타임라인, 흐름 그래프, 진행 목록, 캔버스 분할 | 모두 런타임 없이 우리 데이터를 넣어 쓸 수 있는 독립 모드가 있음. 소스로 복사되는 MIT 컴포넌트라 고쳐 쓰기 쉬움. 합의 카드, 루프 이력, Concern 트리, 진행 중인 WorkUnit, 산출물 화면에 바로 대응 |
| OpenCode 런타임 | 다른 코딩 에이전트 서버를 assistant-ui에 붙인 실제 사례. pi를 붙일 때 그대로 따라 할 수 있는 참고 구현 (세션 → 스레드, 하위 세션 → 도구 호출 안의 대화) |
| 생성형 UI | 버튼 동작을 우리 서버로 보낼 수 있어 가능성 비교 화면에 매력적. 다만 패키지가 0.0.1이라 시험만 |
| Interactables (사람과 모델이 같은 상태를 함께 편집) | 쓰지 않는 쪽을 권함. 모델의 편집을 적용 전에 가로챌 지점이 없어서 "모델은 제안만, 커널이 기록" 규칙과 충돌 |
| Assistant Cloud | 필요 없음 |

**아직 확인하지 않은 것**

pi SDK 쪽은 문서와 타입만 확인했고 실제로 돌려 보지는 않았습니다. 다음 스파이크로 확인할 항목은 세 가지입니다.
1. 가짜 모델로 SDK 세션을 돌릴 수 있는지
2. 앞서 pi-durable로 돌렸던 합의·제출 흐름(스파이크 1)이 inline 확장으로도 똑같이 동작하는지
3. 저장소에서 복원한 세션이 이어서 동작하는지

원하시면 이 스파이크를 바로 진행하겠습니다.

Sources:
- [assistant-ui: ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [assistant-ui: Interactables](https://www.assistant-ui.com/docs/tools/interactables.md)
- [assistant-ui: Generative UI](https://www.assistant-ui.com/docs/tools/generative-ui.md)
- [assistant-ui: Approval card](https://www.assistant-ui.com/elements/approval-card.md)
- [assistant-ui: Timeline](https://www.assistant-ui.com/elements/timeline.md)
- [assistant-ui: Flow graph](https://www.assistant-ui.com/elements/flow-graph.md)
- [assistant-ui: Background runs](https://www.assistant-ui.com/elements/background-inbox.md)
- [assistant-ui: Canvas split](https://www.assistant-ui.com/elements/canvas-split.md)
- [assistant-ui: OpenCode runtime](https://www.assistant-ui.com/docs/runtimes/opencode/overview.md)
- [assistant-ui: Assistant Cloud](https://www.assistant-ui.com/docs/cloud.md)
- [assistant-ui: Installation](https://www.assistant-ui.com/docs/installation.md)

--- [156] USER ---
현재구조상 별도 헬름서버가 켜지는걸로 보이는데 여기 안에 pi 런타임이 들어가는건가? 아키텍쳐 및 기획 고도화작업이 선행되어야할듯함

--- [157] ASSISTANT ---
네, 14번 구조에서는 pi가 Helm 서버 **안에서** 돕니다. pi coding agent를 터미널 앱으로 실행하는 것이 아니라, SDK(`createAgentSession`)로 불러 쓰는 라이브러리로 씁니다. 사용자가 켜는 것은 Helm 서버 하나와 브라우저이고, Concern이나 WorkUnit이 생길 때마다 서버가 그 안에서 pi 세션을 만듭니다. 그래서 14번 §3.4에 적은 대로, 이 배치에서는 평소 쓰시는 pi 터미널 UI로 Helm 세션을 열 수 없습니다.

말씀대로 이 부분은 구현보다 먼저 정해야 할 기획 문제입니다. 프로세스를 어떻게 배치하느냐에 따라 사용 경험이 크게 달라지는데, 지금까지는 기술 검토를 먼저 하느라 이 결정을 건너뛰었습니다.

## 가능한 배치 세 가지

**A. Helm 서버가 pi를 품는다 (14번 구조)**
```text
[브라우저] ⇄ [Helm 서버: 커널 · 저장소 · 스케줄러 · pi 세션들(SDK)]
```

**B. pi가 Helm을 품는다**
```text
[pi 터미널 + Helm 확장: 커널 · 저장소] ⇄ (확장이 여는 로컬 화면)
```

**C. Helm 데몬이 상태를 맡고, 런타임은 붙었다 떨어지는 실행기**
```text
[pi 터미널 + Helm 어댑터 확장] ─┐
[Claude Code + Helm 훅 어댑터] ─┼→ [Helm 데몬: 커널 · 저장소 · 스케줄러] ⇄ [브라우저]
[데몬이 직접 띄운 pi (SDK/RPC)] ─┘
```

| 기준 | A | B | C |
|---|---|---|---|
| 사용자가 실행하는 것 | Helm 서버, 브라우저 | pi 터미널 | Helm 데몬(상시), 평소처럼 pi 터미널, 필요할 때 브라우저 |
| 평소 쓰던 pi 터미널 | Helm 작업에는 못 씀 | 그대로 씀 | 그대로 씀 |
| 터미널을 닫아도 계속 실행 | 됨 | 안 됨 (pi를 닫으면 Helm도 멈춤) | 됨 (데몬이 헤드리스 pi를 띄움) |
| 다른 런타임 연결 | 세션 호스트를 새로 만들어야 함 | 어려움 | 어댑터만 추가 |
| 처음 목표(벤더 중립)와의 거리 | 중간 | 멂 | 가장 가까움 |
| 복잡도 | 중간 | 낮음 | 높음 (데몬과 어댑터 사이 통신, 데몬이 꺼졌을 때의 처리) |

제 판단으로는 **C가 원래 목표에 가장 가깝습니다.** pi 터미널을 계속 쓰시면서 Helm이 뒤에서 상태를 관리하고, 나중에 Claude Code나 Codex도 같은 데몬에 붙일 수 있기 때문입니다. 대신 대가가 있습니다. 도구를 호출할 때마다 확장이 데몬에 차단 여부를 물어야 하고, 데몬이 꺼져 있으면 어떻게 할지(변경 도구를 막을지, 기록만 쌓아 두고 나중에 보낼지)를 정해야 합니다.

## 먼저 해야 할 기획·아키텍처 작업

기획은 사용 장면부터 정하고, 거기서 아키텍처 결정을 끌어내는 순서로 진행하는 것을 제안합니다.

1. **사용 장면 4~5개**: 아침에 돌아와 상황 파악, 작업 중 질문 받기, 취향 탐구, 자리를 비운 동안 계속 돌아가는 작업, 다른 런타임에서 이어 하기. 장면마다 어떤 화면과 어떤 프로세스가 필요한지 정리합니다.
2. **진입점 결정**: 터미널인지, 웹인지, 둘 다인지
3. **프로세스 배치 결정**: A, B, C 중 무엇인지
4. **저장소 소유와 기록 경계**: 누가 정본을 쓰고, 런타임 쪽 기록은 어떻게 다룰지
5. **런타임 어댑터 계약**: pi, Claude Code, Codex에 공통으로 요구할 것
6. **MVP 범위**: 어느 루프와 어느 화면부터 만들지
7. **비기능 요구**: 재시작, 데몬이 꺼졌을 때, 로컬 전용 보안

각 결정은 결정 기록(ADR) 형식으로 남기고, 사용 장면과 MVP는 기획 문서 하나로 묶겠습니다.

## 먼저 여쭙고 싶은 세 가지

답에 따라 배치와 MVP가 정해집니다.

1. **평소 진입점**: pi 터미널은 그대로 쓰고 Helm 화면을 옆에 띄우는 쪽인가요, 아니면 Helm 웹 화면 안에서 대화까지 하는 쪽인가요?
2. **사람이 없을 때의 실행**: 터미널과 브라우저를 모두 닫아도 Helm이 계속 돌아야 하나요? 밤새 탐구를 진행하거나, 타이머가 다시 볼 조건을 확인하는 경우입니다.
3. **다른 런타임 연결 시기**: Claude Code나 Codex를 가까운 시일 안에 Helm에 붙일 계획이 있나요, 아니면 당분간 pi만으로 충분한가요?

답을 주시면 사용 장면 문서와 배치·저장소·어댑터 결정 기록부터 작성하겠습니다.

--- [158] USER ---
웹 말고 나는 자체 데스크탑 어플리케이션을 만들거나 ssh + pi  + 커스텀 tui 구조로 가고싶어. 외부에서 연결가능해야해. 사용 장면은 장면이라고 표현하기보다 유즈케이스 혹은 시나리오 라고 하고, 현재새로 작성해준 0~14문서가 우리가 나눴던 대화 내용과 결정사항을 완전하게 반영하고있으며 누락된 부분이 없는지 전수조사를 병렬로 진행하고,