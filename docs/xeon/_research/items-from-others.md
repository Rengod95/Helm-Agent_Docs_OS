# 타 런타임에서 가져올 만한 층별 항목 (pi, oh-my-pi, opencode, Claude Code, Hermes 제외)

조사일 2026-10-21. 근거는 공식 문서·저장소 README에서 직접 읽은 것만 확정으로 적었다. 웹 페이지 접근에 실패했거나 검색 요약에만 의존한 것은 [추측] 또는 [2차]로 표시했다. 일부 문서(Codex 샌드박스·rules, Amp 매뉴얼, Roo, Goose 일부)는 페이지를 열지 못해 항목 수가 적거나 [추측]이 붙는다.

표기: 필수도는 "새 런타임이 설계 시 반드시 답을 가져야 하는가" 기준이다.

## 층별 표

### F 계약

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| F | thread/turn/item 3계층 프로토콜 프리미티브 | 대화를 thread, 한 번의 에이전트 작업을 turn, 입출력 단위를 item으로 나누고 각각 시작/갱신/완료 알림을 낸다. | item 단위 id가 없으면 클라이언트가 도구 호출 하나의 진행 상태를 갱신 표시할 수 없다. | Codex app-server (https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) | 필수 |
| F | 실험 기능 opt-in + 능력 탐지 | `initialize`에서 `experimentalApi`를 켠 클라이언트에게만 불안정 API를 열고, 신규 능력은 성공적인 프로브 호출로 확인한다. | 서버를 업그레이드하면 구버전 클라이언트가 조용히 깨진다. | Codex app-server (위 URL) | 권장 |
| F | 알림 옵트아웃 | 클라이언트가 `optOutNotificationMethods`로 받지 않을 알림을 지정한다. | 헤드리스 클라이언트가 델타 스트림을 전부 받아 대역폭을 낭비한다. | Codex app-server (위 URL) | 선택 |
| F | 읽음 상태(read-state) 리비전과 충돌 오류 | 불투명 리비전 토큰으로 읽음 상태 쓰기를 비교하고, 충돌 시 현재 상태를 담은 `readStateConflict`를 돌려준다. | 두 클라이언트가 같은 세션을 볼 때 읽음/안읽음 표시가 서로 덮어쓰인다. | Codex app-server (위 URL) | 선택 |
| F | 스레드 첨부(attachment) 레코드 | 외부 리소스를 스레드에 (스레드, 종류, 식별키)로 연결하고 fork 시 복사한다. | 세션에 연결된 PR·티켓 같은 외부 객체가 fork 후 끊어진다. | Codex app-server (위 URL) | 선택 |
| F | 스키마를 JSON Schema 2020-12로 고정 | 도구 입출력 스키마의 방언과 `$ref` 해석 규칙, 합성 키워드의 자원 한도를 명시한다. | 도구 스키마가 구현마다 달라 MCP 서버 호출이 provider별로 거부된다. | MCP 2025-11-25 / 2026-07-28 changelog (https://modelcontextprotocol.io/specification/2026-07-28/changelog) | 필수 |
| F | 결과 타입 태그 `resultType` (complete / input_required) | 모든 결과에 상태 태그를 붙이고, 태그 없는 구버전 결과는 complete로 간주한다. | 도구 호출이 "추가 입력 필요"로 끝났는지 응답 형태로 구분할 수 없다. | MCP 2026-07-28 (위 URL) | 권장 |
| F | 기능 수명주기와 최소 12개월 폐기 창, 폐기 목록 | 기능을 Active/Deprecated/Removed로 분류하고 폐기 레지스트리를 둔다. | 확장 제작자가 언제 기능이 사라질지 알 수 없다. | MCP feature lifecycle (위 changelog) | 권장 |
| F | 오류 코드 구간 할당 정책 | JSON-RPC 서버 오류 범위를 구현 정의(-32000~-32019)와 명세 예약(-32020~-32099)으로 나눈다. | 확장과 코어가 같은 오류 코드를 다른 뜻으로 쓴다. | MCP 2026-07-28 (위 URL) | 선택 |
| F | `_meta` 키 규약과 OpenTelemetry 컨텍스트 전파 | 요청마다 `traceparent`, `tracestate`, `baggage`와 프로토콜 버전, 클라이언트 능력을 `_meta`에 싣는다. | 에이전트-도구서버 경계를 넘는 분산 트레이스가 끊긴다. | MCP 2026-07-28 (위 URL), ACP `_meta` Propagation RFD (https://agentclientprotocol.com/rfds/updates) | 권장 |
| F | 메시지 chunk의 에이전트 발급 ID | 스트리밍 메시지 조각에 id를 붙여 v2에서 필수로 만든다. | 델타 조각을 어느 메시지에 이어붙일지, 재전송 중복인지 판별 못 한다. | ACP Message ID RFD (https://agentclientprotocol.com/rfds/updates) | 권장 |
| F | 열거형 확장 예약(`_` 접두 variant) | 프로토콜 열거형에서 `_` 접두 값을 확장 전용으로 예약한다. | 확장이 만든 새 enum 값이 이후 정식 명세와 충돌한다. | ACP v2 Enum Variant Extension RFD (위 URL) | 선택 |
| F | 도구 호출의 프로그램용 이름과 표시용 제목 분리 | 사람이 읽을 title과 별개로 기계가 쓸 name을 optional로 보낸다. | UI가 도구별 렌더링을 title 문자열 파싱에 의존한다. | ACP Tool Call Name RFD (위 URL) | 선택 |
| F | tools/list 결정적 순서와 `ttlMs`/`cacheScope` 캐시 힌트 | 도구 목록 순서를 안정화하고 결과에 신선도와 공유 가능 여부를 싣는다. | 도구 목록이 호출마다 바뀌어 프롬프트 캐시가 깨지고 폴링이 늘어난다. | MCP 2026-07-28 (위 URL) | 권장 |

### L0 플랫폼

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L0 | OS별 네이티브 샌드박스 (Seatbelt / bubblewrap+Landlock+seccomp / Windows) | 셸 실행을 OS 기능으로 가두는 내장 샌드박스를 플랫폼별로 둔다. | 컨테이너 없이도 에이전트 명령이 작업 디렉터리 밖을 쓰는 것을 막아야 한다. | Codex CLI [2차] (https://codex.danielvaughan.com/2026/05/03/codex-cli-sandbox-internals-seatbelt-bubblewrap-landlock-windows-dacl/) | 필수 |
| L0 | 쓰기 가능 루트 안의 보호 경로(.git, 설정 디렉터리) 읽기 전용 | 쓰기 허용 영역 안에서도 특정 경로를 항상 읽기 전용으로 둔다. | 에이전트가 .git hook이나 자기 설정 파일을 고쳐 샌드박스를 우회한다. | Codex CLI [2차] (https://codex.danielvaughan.com/2026/04/20/configuration-based-sandbox-escape-cbse-codex-cli-defence/) | 필수 |
| L0 | 이름 붙은 권한 프로필과 오프라인 검증 | config의 `[permissions.<name>]`에 파일시스템·도메인 허용/거부를 정의하고 에이전트 없이 검증한다. | 권한 설정 오류를 실제 실행해 보고서야 알게 된다. | Codex CLI [2차] (https://codex.danielvaughan.com/2026/05/21/codex-cli-security-testing-tools-sandbox-execpolicy-offline-policy-validation/) | 권장 |
| L0 | 애플리케이션 네트워크 정책 (HTTP·WebSocket 도메인 규칙) | 샌드박스 안 프로세스의 아웃바운드 트래픽을 프로토콜 계층에서 규칙으로 거른다. | 샌드박스는 파일만 막고 네트워크로 비밀이 유출된다. | Codex app-server README (https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) | 권장 |
| L0 | 워크스페이스 추상(Local/Remote/Docker) + 에이전트 서버 | 같은 에이전트 코드를 로컬·도커·원격 API 워크스페이스에서 그대로 돌리고 REST/WebSocket 서버로 노출한다. | 로컬 개발용 에이전트를 서버 배포용으로 다시 쓰는 비용이 크다. | OpenHands SDK (https://docs.openhands.dev/sdk/arch/overview.md) | 권장 |
| L0 | 매니페스트 기반 샌드박스 워크스페이스 + 스냅샷 재개 | 파일·리포·마운트를 선언한 매니페스트로 새 샌드박스를 만들고 스냅샷으로 이어 간다. | 샌드박스를 매번 손으로 세팅하고 이전 작업 환경을 복원 못 한다. | OpenAI Agents SDK sandbox agents (https://openai.github.io/openai-agents-python/sandbox_agents/) | 권장 |
| L0 | 샌드박스 클라이언트 교체 가능 + "로컬 클라이언트는 격리 아님" 명시 | 샌드박스 백엔드를 인터페이스로 갈아끼우고 신뢰 수준 차이를 문서에 못박는다. | 개발용 백엔드를 운영에서 쓰다 격리가 없는 줄 모른다. | OpenAI Agents SDK (위 URL) | 권장 |
| L0 | 클라우드 머신 단위 스레드(Orb) | 스레드마다 코드·도구·플러그인이 갖춰진 클라우드 머신을 만들어 노트북을 닫아도 작업이 계속된다. | 장시간 작업이 사용자 기기 전원에 묶인다. | Amp (https://ampcode.com/manual) | 선택 |
| L0 | 세션별 shadow git 스냅샷 | 사용자 리포와 분리된 그림자 git에 도구 실행마다 파일 스냅샷을 찍어 복원한다. | 에이전트가 파일을 망쳐도 사용자의 git 이력을 오염시키지 않고 되돌릴 방법이 없다. | Cline (https://docs.cline.bot/features/checkpoints), Gemini CLI (https://www.geminicli.com/docs/cli/checkpointing) | 권장 |
| L0 | 신뢰 폴더(trusted folders) | 폴더별로 프로젝트 설정·훅 로딩을 허용할지 정한다. | 낯선 리포를 열자마자 그 안의 설정이 코드를 실행한다. | Gemini CLI (https://geminicli.com/docs/) | 필수 |
| L0 | 프로세스 모델: 에디터 하위 프로세스 stdio JSON-RPC + 원격 HTTP/WebSocket | 로컬 에이전트는 자식 프로세스 stdio, 원격은 Streamable HTTP에 WebSocket 승격으로 잇는다. | 클라이언트-에이전트 결합이 UI마다 제각각이다. | ACP (https://agentclientprotocol.com/overview/introduction, 전송 RFD https://agentclientprotocol.com/rfds/updates) | 필수 |

### L1a 태스크 엔진

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1a | turn/steer (실행 중 턴에 입력 주입) | 진행 중인 turn에 사용자 입력을 방향 수정으로 밀어 넣는 전용 메서드. | 긴 턴 도중 사용자가 방향을 바꾸려면 취소 후 재시작해야 한다. | Codex app-server (https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) | 필수 |
| L1a | 프롬프트 수락/완료 분리 (state_update) | `session/prompt` 응답은 수락 시점에, 종료·정지 사유는 `state_update` 알림으로 보낸다. | 요청-응답이 턴 전체에 묶여 있으면 큐잉·다중 클라이언트 재생이 불가능하다. | ACP v2 prompting (https://agentclientprotocol.com/rfds/v2/prompt) | 권장 |
| L1a | 요청 취소 `$/cancel_request` | 요청 id 기준으로 미완료 요청을 취소한다. | 취소가 턴 단위뿐이라 하위 요청만 끊을 수 없다. | ACP (https://agentclientprotocol.com/rfds/updates) | 권장 |
| L1a | 칸반식 병렬 에이전트 (카드별 워크트리, 자동 커밋, 의존 체인) | 여러 에이전트를 태스크 보드에서 병렬 실행하며 카드마다 워크트리를 준다. | 병렬 에이전트가 같은 작업 트리를 건드려 서로 덮어쓴다. | Cline Kanban (https://docs.cline.bot/) | 선택 |
| L1a | 병렬 interrupt 다중 재개 (id→값 맵) | 한 단계에서 여러 interrupt가 걸리면 id별 응답 맵으로 한 번에 재개한다. | 병렬 분기가 동시에 승인을 요구할 때 하나만 답하면 나머지가 멈춘다. | LangGraph interrupts (https://docs.langchain.com/oss/python/langgraph/interrupts) | 권장 |
| L1a | 멈춤 감지기 (stuck detector) | 같은 행동-관찰 4회 이상, 같은 행동-오류 3회 이상, 독백, 핑퐁 교대를 감지해 중단한다. | 에이전트가 같은 실패 명령을 토큰이 다 닳도록 반복한다. | OpenHands SDK [2차 요약] (https://docs.openhands.dev/sdk/guides/agent-stuck-detector) | 권장 |

### L1b 에이전트 루프

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1b | 가드레일 병렬/차단 실행 모드 | 입력 가드레일을 에이전트와 병렬(지연 최소)로 돌릴지 선행 차단(부작용 방지)으로 돌릴지 고른다. | 병렬 검사가 늦게 실패하면 이미 도구가 실행되고 토큰이 나간 뒤다. | OpenAI Agents SDK (https://openai.github.io/openai-agents-python/guardrails/) | 권장 |
| L1b | 출력 가드레일 거부 시 세션 저장 제외 | 거부된 최종 출력은 세션 스토리지에 쓰지 않는다. | 막힌 응답이 다음 턴 컨텍스트에 남아 모델이 이어서 따라간다. | OpenAI Agents SDK (위 URL) | 권장 |
| L1b | 가드레일 판정 3값(통과/트립와이어/불명) | 가드레일 함수가 예외를 던지면 거부가 아니라 "불명"으로 처리한다. | 검사기 장애가 곧 사용자 요청 거부로 번진다. | OpenAI Agents SDK (위 URL) | 선택 |
| L1b | 단계 전 준비 훅 + 정지 조건 조합 (stopWhen, prepareStep, 기본 20스텝) | 단계마다 메시지·도구를 조정하고 정지 조건 함수를 조합한다. | 종료 조건과 단계별 컨텍스트 정리를 루프 밖에서 끼워 넣을 방법이 없다. | Vercel AI SDK [2차] (https://zenn.dev/layerx/articles/5538adfc79b14e) | 권장 |
| L1b | 도구별 `needsApproval` (불리언 또는 함수) | 도구 정의에 승인 필요 여부를 선언해 루프가 호출 직전에 멈춘다. | 승인 정책이 루프 바깥 분기에 흩어져 도구 추가 때마다 누락된다. | Vercel AI SDK v6 [2차] (https://www.issoh.co.jp/tech/details/10402/) | 권장 |
| L1b | 모델이 스스로 매기는 도구 호출 위험도 | 모든 도구 스키마에 `security_risk` 필수 파라미터를 넣어 추가 LLM 호출 없이 위험도를 얻는다. | 별도 분류 모델 호출은 지연과 비용을 더한다. | OpenHands SDK (https://docs.openhands.dev/sdk/arch/security) | 권장 |

### L1c 모델 게이트웨이

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1c | 에이전트 서버의 OpenAI 호환 엔드포인트 | Chat Completions/Responses 클라이언트가 에이전트를 모델처럼 호출하게 한다. | 기존 OpenAI 호환 도구가 에이전트를 붙이려면 어댑터를 새로 짜야 한다. | OpenHands SDK (https://docs.openhands.dev/sdk) | 선택 |
| L1c | 클라이언트 지정 LLM 엔드포인트 | 에디터가 사용할 모델 provider 설정을 에이전트에 넘긴다. | 에디터가 가진 키·프록시를 에이전트에 또 입력해야 한다. | ACP Custom LLM Endpoint RFD (https://agentclientprotocol.com/rfds/updates) | 선택 |
| L1c | 세션 사용량(컨텍스트 크기·누적 비용) 알림 | `usage_update` 알림으로 컨텍스트 윈도 크기와 비용을 보고한다. | UI가 남은 컨텍스트를 몰라 컴팩션 시점을 사용자에게 보여 주지 못한다. | ACP Session Usage RFD (위 URL) | 권장 |
| L1c | 용도별 모델 라우팅 (주 모델 / 추론 오라클) | 작업 성격별로 다른 모델을 쓰고 어려운 분석만 상위 모델에 맡긴다. | 단일 모델로는 비용과 품질을 동시에 맞출 수 없다. | Amp oracle [2차] (https://ampcode.com/manual/switch-from) | 선택 |

### L1d 도구 디스패치·권한

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1d | 선언형 정책 엔진 (TOML 규칙, allow/deny/ask_user, 우선순위 0~999) | 도구명 와일드카드, args 정규식, 명령 접두, MCP 서버명, 호출 서브에이전트, 승인 모드로 규칙을 건다. | 권한 로직이 코드에 박혀 있으면 관리자가 정책을 바꿀 수 없다. | Gemini CLI (https://geminicli.com/docs/reference/policy-engine/) | 필수 |
| L1d | 계층 티어 정책 (기본 < 확장 < 사용자 < 관리자) | 티어 기반 + 규칙 우선순위를 합쳐 최종 순위를 계산한다. | 확장이 관리자 금지 규칙을 덮어쓴다. | Gemini CLI (위 URL) | 권장 |
| L1d | deny 규칙으로 도구를 모델 시야에서 제거 | 전역 deny는 거부 응답이 아니라 도구 목록에서 빼 버린다. | 거부될 도구를 계속 호출하려는 모델이 턴을 낭비한다. | Gemini CLI (위 URL) | 권장 |
| L1d | 비대화형에서 ask_user = deny | 사람 없는 실행에서 승인 요구를 자동 거부로 해석한다. | 헤드리스 실행이 승인 대기에서 영구 정지한다. | Gemini CLI (위 URL) | 필수 |
| L1d | 셸 리다이렉션 별도 승인 | 규칙이 허용한 명령이라도 `>` 등 리다이렉션은 기본 확인을 요구한다. | 허용된 `echo`가 리다이렉션으로 임의 파일을 덮어쓴다. | Gemini CLI (위 URL) | 권장 |
| L1d | 읽기전용 plan 모드 | 승인 모드의 하나로 쓰기 도구를 전부 막는다. | "먼저 계획만"을 지시로만 하면 모델이 몰래 수정한다. | Gemini CLI (위 URL) | 권장 |
| L1d | 위험도 임계값 확인 정책 (ConfirmRisky, UNKNOWN 별도) | LOW/MEDIUM/HIGH/UNKNOWN 위험도를 임계값과 비교해 확인을 요구한다. | 모든 호출 승인과 무승인 사이에 중간이 없다. | OpenHands SDK (https://docs.openhands.dev/sdk/arch/security) | 권장 |
| L1d | MCP 도구 annotation을 권한 판단에 사용 | readOnly 등 MCP 힌트를 위험 평가 입력으로 쓴다. | MCP 도구는 이름만으로 읽기/쓰기를 구분 못 한다. | OpenHands SDK (위 URL) | 권장 |
| L1d | Guardian(자동 승인 리뷰 서브에이전트) + 연속 거부 서킷브레이커 | 승인 요청을 별도 리뷰어가 판정하고 거부가 누적되면 턴을 중단한다(`tooManyDenials`). | 사람 승인이 병목이고, 거부된 시도를 모델이 무한 반복한다. | Codex (app-server README https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md; 동작 상세는 2차 https://codex.danielvaughan.com/2026/05/21/codex-cli-security-testing-tools-sandbox-execpolicy-offline-policy-validation/) | 권장 |
| L1d | 도구 호출 전 적대적 리뷰어 (ALLOW/BLOCK) | 원래 과제와 최근 대화를 기준으로 별도 모델이 각 호출을 심사한다. 장애 시 통과(fail-open)라는 점이 약점이다. | 프롬프트 주입으로 과제와 무관한 도구 호출이 나간다. | Goose adversary mode [2차] (https://goose-docs.ai/blog/2026/03/31/adversary-mode) | 선택 |
| L1d | 도구 가드레일의 승인 전/후 순서 선택 | 승인이 필요한 도구의 입력 검사를 승인 뒤 또는 앞(`pre_approval_tool_input_guardrails`)에 둔다. | 위험한 인자를 사람에게 승인 요청으로 띄우기 전에 걸러야 한다. | OpenAI Agents SDK (https://openai.github.io/openai-agents-python/guardrails/) | 선택 |
| L1d | execpolicy 규칙 파일 (명령 접두 allow/prompt/forbidden) | 셸 명령 접두에 대한 정책을 별도 규칙 언어로 둔다. [추측: 형식 상세는 문서 접근 실패로 미확인] | 셸 문자열 정규식 매칭은 인용·파이프에서 우회된다. | Codex CLI [2차] (https://codex.danielvaughan.com/2026/06/06/codex-cli-command-safety-defence-in-depth-shell-injection-sandbox-containment/) | 권장 |

### L1e 컨텍스트 조립·컴팩션

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1e | 컴팩션 이벤트의 ID 지정 보고와 요약 보존 | 컴팩션을 id 있는 이벤트로 알리고 요약문을 선택적으로 남긴다. | 클라이언트가 컴팩션 시점 이전 이력을 재생할 때 어디가 잘렸는지 모른다. | ACP Session Compaction RFD (https://agentclientprotocol.com/rfds/updates) | 권장 |
| L1e | Condenser 플러그인 계층 | 대화 이력을 압축하는 전략을 교체 가능한 컴포넌트로 둔다. | 컴팩션 전략을 코어 수정 없이 실험할 수 없다. | OpenHands SDK (https://docs.openhands.dev/sdk/arch/overview.md) | 권장 |
| L1e | 클라이언트가 주입하는 세션 시스템 프롬프트 | 에디터가 세션 범위의 지시를 프로토콜로 전달한다. | 에디터별 지시를 AGENTS.md 파일로 쓰고 지우는 우회가 필요하다. | ACP Client-Provided System Prompt RFD (위 URL) | 선택 |
| L1e | 추가 워크스페이스 루트 | 세션 생성 시 여러 디렉터리를 작업 영역으로 넘긴다. | 모노리포 밖 보조 디렉터리를 에이전트에 보이게 할 방법이 없다. | ACP Additional Directories (위 URL) | 권장 |

### L1f 세션 영속성

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1f | 체크포인터 (thread_id 단위 상태 저장, 교체형 백엔드) | 그래프 상태를 단계마다 저장해 재개·시간여행·장애 복구를 지원한다. | 프로세스가 죽으면 진행 중이던 실행이 소실된다. | LangGraph persistence (https://docs.langchain.com/oss/python/langgraph/durable-execution) | 필수 |
| L1f | 내구성 모드 exit / async / sync | 체크포인트 저장 시점을 종료 시·백그라운드·다음 단계 전 동기 중에서 고른다. | 항상 동기 저장은 느리고 종료 시 저장만은 중간 장애에 취약하다. | LangGraph [2차 검색 요약, 공식 페이지는 본문 미확인] (https://docs.langchain.com/oss/python/langgraph/durable-execution) | 권장 |
| L1f | `interrupt()` + `Command(resume)` 재진입 규칙 | 노드 안에서 멈추고 재개 시 노드를 처음부터 재실행하며 interrupt 호출 순서를 인덱스로 매칭한다. | 승인 대기 후 재개 시 앞쪽 부작용이 중복 실행된다(규칙으로 멱등성을 강제). | LangGraph interrupts (https://docs.langchain.com/oss/python/langgraph/interrupts) | 필수 |
| L1f | 재개 입력 스키마 (response_schema) | 재개 값을 스키마로 검증하고 클라이언트에 입력 폼 정의로 노출한다. | 승인 UI가 어떤 형식의 답을 받아야 하는지 알 수 없다. | LangGraph interrupts (위 URL) | 선택 |
| L1f | 실행 저널 + `ctx.run` 단계 기록과 멱등키 | 단계 결과를 저널에 남겨 재시작 시 건너뛰며, 부작용 직후 크래시는 멱등키로 방어한다. | "도구가 실행됐는지 불명"인 상태에서 재시도하면 이중 결제가 난다. | Restate [2차, 단일 저자 시험] (https://nerdleveltech.com/restate-durable-agent-duplicate-tool-calls-tested) | 필수 |
| L1f | 모델 호출 결과 체크포인트 후 재생 (모델 호출을 단계로 감싸기) | 비결정적 LLM 출력을 저장하고 복구 시 재호출 대신 재생한다. | 복구 때 모델이 다른 답을 내 실행 경로가 갈라진다. | DBOS + Vercel AI SDK [2차] (https://docs.dbos.dev/integrations/vercel-ai) | 권장 |
| L1f | 워크플로 recv/send로 지속 대기하는 사람 승인 | 워크플로가 타임아웃 포함 메시지 수신을 내구적으로 기다린다. | 승인 대기가 프로세스 메모리에 있어 재배포 때 사라진다. | DBOS (https://dbos.dev/blog/durable-execution-crashproof-ai-agents), Temporal Signals (https://docs.temporal.io/ai-cookbook) | 권장 |
| L1f | 세션 재개 시 리플레이 커서 (`replayFrom`) | `session/resume`이 무재생 재개와 전체 재생을 커서로 구분한다. | 재접속한 클라이언트가 이력 전체를 받을지 이어서만 받을지 선택 못 한다. | ACP v2 (https://agentclientprotocol.com/rfds/v2/prompt) | 권장 |
| L1f | 세션 list/delete/close/fork 수명주기 메서드 | 세션 조회·삭제·종료·분기를 프로토콜 메서드로 둔다. | 클라이언트가 세션 저장소 파일을 직접 만져야 한다. | ACP (https://agentclientprotocol.com/rfds/updates), Codex `thread/fork`/`thread/revert` (app-server README) | 필수 |
| L1f | 서버측 스레드 읽기·페이지네이션 (item 앵커 커서) | 아이템 앵커 커서로 양방향 이어 읽는다. | 긴 스레드 전체를 매번 내려받아야 한다. | Codex app-server (위 README) | 권장 |
| L1f | 이벤트 소싱 상태와 결정적 리플레이 | 상태를 불변 이벤트의 함수로 두고 설정은 불변 객체로 둔다. | 버그 재현에 실제 세션 로그를 그대로 다시 돌릴 수 없다. | OpenHands SDK [2차, arXiv 2511.03690 요약] (https://docs.openhands.dev/sdk/arch/overview.md는 이벤트 타입만 확인) | 권장 |
| L1f | 롤아웃 파일 압축 | 로컬 롤아웃 로그를 압축하는 메서드를 제공한다. | 장기 사용 후 세션 로그가 디스크를 채운다. | Codex app-server README | 선택 |

### L1g 서브에이전트·멀티에이전트

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L1g | 서브에이전트 단위 정책 규칙 (`subagent` 조건, 서브에이전트명으로 호출 거부) | 호출 주체가 서브에이전트일 때만 적용되는 규칙과 특정 서브에이전트 호출 차단. | 서브에이전트가 부모보다 넓은 권한으로 도구를 부른다. | Gemini CLI (https://geminicli.com/docs/reference/policy-engine/) | 권장 |
| L1g | 승인 모드에 따른 서브에이전트 자동 생성 on/off | 자율 모드에서만 모델이 서브에이전트를 자동 띄우고 수동 승인 모드에서는 끈다. | 사람이 단계마다 승인하는 모드에서 병렬 서브에이전트가 승인 폭주를 만든다. | Goose [2차] (https://goose-docs.ai/docs/guides/subagents) | 선택 |
| L1g | 핸드오프 vs 에이전트-as-도구 구분 | 제어권을 넘기는 핸드오프와 호출자가 제어권을 유지하는 도구형 위임을 따로 둔다. | 둘을 섞으면 대화 주도권과 가드레일 적용 범위가 불분명해진다. | OpenAI Agents SDK (https://openai.github.io/openai-agents-python/) | 권장 |
| L1g | 입력 가드레일은 체인 첫 에이전트, 출력은 최종 에이전트에만 적용 | 핸드오프 체인에서 가드레일 적용 위치를 규칙으로 정한다. | 핸드오프 때마다 검사가 반복되거나 빠진다. | OpenAI Agents SDK (guardrails 페이지) | 선택 |
| L1g | 새 스레드로의 handoff (계획 후 관련 컨텍스트만 이월) | 현재 스레드에서 필요한 컨텍스트만 뽑아 새 스레드를 초안으로 만든다. | 긴 스레드 컴팩션 대신 깨끗한 컨텍스트로 이어 가고 싶다. | Amp [2차] (https://ampcode.com/manual/switch-from) | 권장 |
| L1g | 서브에이전트 격리 (별도 컨텍스트·통신 불가·최종 요약만 반환) | 서브에이전트는 부모 대화를 상속하지 않고 끝나면 요약만 돌려준다. | 서브에이전트의 중간 출력이 부모 컨텍스트를 채운다. | Amp [2차] (https://www.verdent.ai/guides/agents/amp-coding-agent) | 권장 |
| L1g | 서브에이전트 세션과 프록시 체인 프로토콜 | 서브에이전트를 세션으로 노출하고 프록시가 에이전트-클라이언트 사이에 끼는 구조. [추측: RFD 존재만 확인, 내용 미확인] | 서브에이전트 진행 상황을 클라이언트가 볼 수 없다. | ACP RFD 목록 (https://agentclientprotocol.com/rfds/updates) | 선택 |

### L2 능력

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| L2 | MCP elicitation (form / URL 모드) | 도구 서버가 사용자에게 구조화 입력이나 외부 URL 상호작용을 요청한다. | 서버가 사용자 입력이 필요할 때 도구 호출 전체를 실패시켜야 한다. | MCP 2025-11-25 (https://modelcontextprotocol.io/specification/2025-11-25/changelog); Codex는 `mcpServer/elicitation/request`로 전달 | 필수 |
| L2 | MRTR (다중 왕복 요청: input_required → inputResponses 재시도) | 서버 주도 요청(elicitation, sampling, roots)을 열어 둔 스트림 없이 "추가 입력 필요" 결과와 재시도로 처리한다. | 서버 인스턴스 사이에 스트림 상태가 있어 수평 확장·서버리스가 막힌다. | MCP 2026-07-28 (https://modelcontextprotocol.io/specification/2026-07-28/changelog) | 필수 |
| L2 | 무상태 MCP (세션·initialize 제거, `server/discover`, 요청별 능력 선언) | 모든 요청에 버전과 능력을 싣고 상태가 필요하면 서버 발급 핸들을 인자로 쓴다. | 로드밸런서 뒤에서 MCP 세션 고정이 필요하다. | MCP 2026-07-28 (위 URL) | 필수 |
| L2 | Tasks 확장 (`tasks/get` 폴링, `tasks/update` 입력, 서버 비요청 태스크 핸들) | 장기 도구 호출을 태스크 핸들로 돌려주고 폴링으로 결과를 받는다. | 몇 분 걸리는 도구가 연결을 붙잡고 있거나 타임아웃으로 죽는다. | MCP 2026-07-28 (위 URL) | 권장 |
| L2 | `subscriptions/listen` 선택 구독 스트림 | tools/prompts/resources 변경 알림을 하나의 장수 스트림에서 옵트인으로 받는다. | 목록 변경을 알기 위해 상시 GET 연결을 유지해야 한다. | MCP 2026-07-28 (위 URL) | 권장 |
| L2 | 요청별 로그 레벨 (`_meta` logLevel) | 서버 로그 레벨을 전역 설정이 아닌 요청 메타에 싣는다. | 무상태 서버에서 `setLevel`의 연결 상태를 유지할 수 없다. | MCP 2026-07-28 (위 URL) | 선택 |
| L2 | 클라이언트 신원 확인 OAuth (Client ID Metadata Documents, `iss` 검증, 발급자별 자격 증명 키잉) | DCR 대신 URL 형태의 클라이언트 메타데이터 문서로 등록하고 발급자 혼동을 막는다. | 임의 서버가 다른 인가 서버의 토큰을 재사용하게 만드는 혼동 공격. | MCP 2025-11-25 / 2026-07-28 changelog | 권장 |
| L2 | 증분 스코프 동의 (`WWW-Authenticate`) | 도구 호출 시점에 필요한 스코프만 추가로 동의받는다. | 처음부터 광범위 스코프를 요구해 동의율이 떨어진다. | MCP 2025-11-25 (위 URL) | 선택 |
| L2 | 입력 검증 오류는 도구 실행 오류로 반환 | 프로토콜 오류가 아닌 도구 결과 오류로 돌려 모델이 자가 수정하게 한다. | 인자 오류가 루프를 중단시킨다. | MCP 2025-11-25 (SEP-1303) | 필수 |
| L2 | 에이전트 클라이언트 터미널·파일시스템 위임 (v2에서 제거 논의) | 에이전트가 에디터의 터미널·파일 접근을 요청하는 표준 메서드. | 에디터의 미저장 버퍼가 에이전트에 보이지 않는다. | ACP v1 (https://agentclientprotocol.com/llms.txt 목록), v2 제거는 https://agentclientprotocol.com/rfds/v2/overview.md [2차 요약] | 선택 |
| L2 | 에이전트 계획 객체와 plan_update 연산 | 계획을 항목 리스트로 보내고 갱신·삭제 연산을 둔다. | UI가 계획 변화를 전체 교체로만 받아 깜박인다. | ACP Plan Operations RFD (https://agentclientprotocol.com/rfds/updates) | 선택 |
| L2 | 슬래시 명령 광고, 세션 설정 옵션(모드·모델·불리언 토글) | 에이전트가 지원 명령과 설정 선택지를 클라이언트에 선언한다. | 클라이언트가 에이전트별 명령 목록을 하드코딩한다. | ACP (https://agentclientprotocol.com/llms.txt, RFD 목록) | 권장 |
| L2 | ACP 레지스트리 | 설치 가능한 ACP 에이전트를 찾는 공개 레지스트리. | 클라이언트가 지원 에이전트를 직접 관리해야 한다. | ACP (https://agentclientprotocol.com/rfds/updates) | 선택 |
| L2 | 메모리 파일시스템(MemFS): git 추적 마크다운 메모리, system/ 하위만 매 턴 주입 | 메모리를 git 저장소 파일로 두고 편집마다 커밋하며 일부만 시스템 프롬프트에 올린다. | 불투명 DB 메모리는 사람이 검토·되돌리기·병합할 수 없다. | Letta (https://docs.letta.com/concepts/memfs, https://www.letta.com/blog/context-repositories) | 권장 |
| L2 | 슬립타임 메모리 정리 에이전트 (별도 에이전트에만 메모리 편집 도구, 워크트리에서 작업 후 병합) | 대화 중이 아닐 때 백그라운드 서브에이전트가 이력을 읽고 메모리를 갱신한다. | 주 에이전트가 응답 중에 메모리를 고치면 지연이 늘고 충돌한다. | Letta sleep-time compute (https://letta.com/blog/sleep-time-compute), Dreaming 설정(스텝 수·컴팩션 시점) | 권장 |
| L2 | 메모리 계층: 코어 블록 / recall / archival | 컨텍스트 상주 블록, 대화 검색 저장소, 임베딩 검색 저장소로 나눈다. | 장기 사실이 컨텍스트에 못 들어가고 검색으로만 접근해야 한다. | Letta [2차] (https://sureprompts.com/blog/letta-memgpt-walkthrough) | 권장 |
| L2 | 공유 메모리 저장소 (여러 에이전트가 같은 git 저장소) | 에이전트 간 메모리를 동일 저장소로 공유한다. | 에이전트마다 같은 사실을 따로 학습한다. | Letta (https://docs.letta.com/concepts/shared-memory) | 선택 |
| L2 | 샌드박스 네이티브 capability (파일 편집, 이미지 확인, 셸, 스킬, 메모리, 컴팩션) | 샌드박스 에이전트에 능력 묶음을 선언적으로 붙인다. | 샌드박스 종류마다 도구 구현을 새로 한다. | OpenAI Agents SDK (https://openai.github.io/openai-agents-python/sandbox_agents/) | 선택 |
| L2 | 재사용 YAML 레시피(매개변수, 하위 레시피)와 CI 실행 | 워크플로를 파일로 공유하고 CI에서 돌린다. | 팀이 쓰는 에이전트 절차가 대화 속에만 있다. | Goose [2차] (https://goose-docs.ai/docs/guides/subagents 인접 검색 결과) | 권장 |
| L2 | 세션 간 공유 가능한 스레드와 가시성 단계 | 스레드를 링크·워크스페이스·그룹·비공개로 공유한다. | 에이전트 작업 내역을 동료가 보고 이어받을 수 없다. | Amp [2차] (https://www.verdent.ai/guides/agents/amp-coding-agent) | 선택 |

### 확장 체계

| 층 | 항목 | 역할 | 해결하는 문제 | 대표 구현(근거) | 필수도 |
|---|---|---|---|---|---|
| 확장 | 공식 extensions 협상 필드 (ClientCapabilities.extensions) | 코어 밖 확장을 능력 협상에 넣고 ID 네임스페이스(`io.modelcontextprotocol/tasks`)로 식별한다. | 확장 지원 여부를 알 수 없어 호출이 실패한다. | MCP 2026-07-28 (https://modelcontextprotocol.io/specification/2026-07-28/changelog) | 필수 |
| 확장 | 확장 정책 티어에서의 순서 보장 | 확장이 넣은 규칙이 사용자·관리자 티어보다 낮게 평가되도록 순서를 고정한다. | 확장이 관리자 정책을 약화한다. | Gemini CLI policy engine (https://geminicli.com/docs/reference/policy-engine/) | 권장 |
| 확장 | 플러그인 설정·MCP OAuth 상태 메서드 | 플러그인 설정과 MCP 로그인 상태를 서버 API로 노출한다. | 클라이언트가 확장 상태를 파일 직접 읽기로 확인한다. | Codex app-server README | 선택 |
| 확장 | 호스트 네트워크 정책/제공자 요구사항이 입력 RPC를 차단 | 관리형 정책이 어긋난 스레드의 입력 RPC를 막는다. | 정책이 바뀐 뒤에도 기존 스레드가 위반 상태로 계속 동작한다. | Codex app-server README | 선택 |
| 확장 | 훅 스크립트 (CLI 동작 커스터마이즈) | 이벤트 시점에 외부 스크립트를 실행한다. [상세 미확인] | 정책·감사를 코어 수정 없이 붙이고 싶다. | Gemini CLI (https://geminicli.com/docs/) | 권장 |
| 확장 | 사용자 정의 에이전트 규칙 파일 (adversary.md) | 리뷰어의 판단 규칙을 사용자 마크다운으로 쓴다. | 리뷰어 기준을 코드 수정 없이 조정하고 싶다. | Goose [2차] (https://goose-docs.ai/blog/2026/03/31/adversary-mode) | 선택 |

## 진보된 설계로 볼 만한 것

1. **MCP 무상태화와 MRTR (2026-07-28).** 서버가 사용자·모델에게 물어야 할 때 열린 스트림 대신 "input_required" 결과를 돌려주고 클라이언트가 답을 붙여 같은 요청을 재시도한다. 세션이 없어지니 어느 인스턴스가 받아도 되고, 재시도라는 한 가지 경로로 elicitation, sampling, roots가 통합된다. 서버가 상태를 유지해야 하면 서버가 발급한 핸들을 도구 인자로 넘긴다. 우리 런타임이 도구 서버와 대화하는 방식을 "호출 + 재시도"로 단순화할 근거가 된다.

2. **ACP v2의 프롬프트 수락/완료 분리.** `session/prompt` 응답을 "수락됨"으로 줄이고 완료와 정지 사유를 상태 알림으로 보낸다. 요청-응답이 턴 길이에 묶이지 않아 큐잉, steering, 다중 클라이언트 재생이 한 모델로 설명된다. 클라이언트-서버 분리 구조에서 턴 상태를 "서버가 가진 상태 + 알림"으로 두는 설계의 직접 선례다.

3. **Codex의 Guardian + 서킷브레이커.** 승인을 사람 대신 별도 리뷰 에이전트가 처리하고, 거부가 쌓이면 턴을 `tooManyDenials`로 끝낸다. 사람 승인 병목과 "거부당한 시도를 계속 반복하는 모델" 두 문제를 함께 푼다. 동작 상세는 2차 자료라 채택 전 원문 확인이 필요하다.

4. **OpenHands의 인라인 위험도 매기기.** 모든 도구 스키마에 필수 `security_risk` 파라미터를 넣어 모델이 호출 생성과 동시에 위험도를 선언하고, 확인 정책이 임계값과 비교한다. 추가 LLM 호출이 없다. 모델의 자기 평가를 믿는 한계는 있으나, 정책 엔진의 입력으로 싸게 얻을 수 있는 신호다.

5. **Gemini CLI 정책 엔진의 "도구를 시야에서 삭제".** 전역 deny 규칙은 거부 메시지를 돌려주는 대신 도구 목록에서 도구를 빼 버린다. 모델이 못 쓸 도구를 시도하느라 턴을 낭비하지 않고 프롬프트도 줄어든다. 티어(기본/확장/사용자/관리자)와 모드별 조건, 서브에이전트 조건을 한 규칙 언어에 모았다는 점도 참고할 만하다.

6. **LangGraph interrupt의 재진입 규칙을 문서화한 점.** 재개 시 노드를 처음부터 다시 실행하고 interrupt를 호출 순서 인덱스로 매칭한다. 그래서 "interrupt 전 부작용은 멱등으로" 같은 규칙이 명시된다. 내구 실행이 결국 "재실행 가능한 코드 + 결과 불명 부작용 처리"의 문제임을 가장 구체적으로 보여 준다. Restate 시험 보고(부작용 직후 크래시 시 이중 결제, 멱등키로 해소)와 같은 결론이다.

7. **Letta MemFS와 슬립타임 에이전트.** 메모리를 git 저장소의 마크다운으로 두어 사람이 diff로 검토·되돌릴 수 있게 하고, 메모리 편집 도구는 별도의 슬립타임 에이전트에게만 주며 워크트리에서 작업 후 병합한다. 주 에이전트는 응답 지연도 편집 충돌도 겪지 않는다. 메모리를 "파일시스템 + 커밋"이라는 기존 도구 위에 올린 점이 바퀴 재발명을 피하는 방식이다.

8. **입력 가드레일의 병렬/차단 선택 (OpenAI Agents SDK).** 지연과 부작용 방지를 설정 하나로 맞바꾸게 하고, 실패한 출력은 세션에 저장하지 않으며, 검사기 예외는 거부와 구분해 "불명"으로 둔다. 가드레일이 단순 필터가 아니라 루프 안의 실행 순서 문제임을 드러낸다.

9. **Codex app-server의 능력 탐지와 읽음 상태 낙관적 동시성.** 초기화 성공만으로 신규 능력 지원을 믿지 말고 프로브 호출로 확인하게 하고, 공유 상태는 불투명 리비전 토큰과 충돌 오류로 다룬다. 서버-클라이언트가 따로 배포될 때 버전 정책을 "협상 + 탐지 + 충돌 응답"으로 푸는 실전 사례다.

10. **MCP 기능 수명주기 정책과 캐시 힌트.** 최소 12개월 폐기 창과 폐기 레지스트리, 그리고 목록 결과의 `ttlMs`/`cacheScope`와 결정적 정렬 요구는 프롬프트 캐시 적중률을 프로토콜 요구사항으로 끌어올린 드문 사례다. 우리 F 계약의 버전 정책과 도구 목록 안정성 규칙에 그대로 참고할 수 있다.

## 확인 못 한 것 / 한계

- Codex 샌드박스·rules·auto-review 공식 페이지는 열리지 않아 3개 항목은 2차 블로그 근거다. Codex rollout 파일 형식과 app-server의 approval 메서드 이름은 직접 확인하지 못했다.
- Amp 매뉴얼 세부(oracle 외 도구, 권한), Roo Code(모드, fileRegex, 인덱싱), Cline 훅·plan/act, Gemini CLI 훅 세부, Temporal 결정성 요구, Restate awakeable, Zed ACP 터미널 세부는 열람 실패로 표에서 뺐거나 [추측]으로 표시했다.
- LangGraph 내구성 모드의 기본값은 자료마다 달라 적지 않았다.
- Goose 적대적 리뷰어의 fail-open 설명은 공식 블로그 제목과 2차 요약에 의존한다.
- 항목 수는 약 100개다.
