
# 브라우저 제어 도구 소스 구조 분석
 · 
## 요약
주목 도구 여섯 개는 "더 나은 Playwright MCP"가 아니라, 브라우저 에이전트의 서로 다른 계층을 바꿉니다. Lightpanda는 엔진, Stagehand는 연결과 재생, jev-ultrafast는 결정, Skyvern은 결과를 코드로 굳히는 단계, webcmd는 실행 간 지식과 실행 격리, scout는 모델 계층과 클라우드 브라우저입니다.
도구
 | 바꾼 계층
 | 핵심 아이디어
 | 코드에서 확인한 것
 | 주의할 점
 | 
Stagehand v4
 | 연결·재생
 | CDP 처리를 브라우저 확장(서비스 워커) 안으로, 액션을 재생 가능한 XPath로 반환
 | 한 Zod 프로토콜을 3개 언어 SDK가 공유, act LLM 1~2회
 | 캐시는 Browserbase 서버에만 있음. 자가 복구는 옵트인
 | 
Lightpanda
 | 브라우저 엔진
 | 렌더링·레이아웃 없는 Zig 엔진에 에이전트 도구·LLM·재생 스크립트를 내장
 | Web API 직접 구현 108k줄, CDP·WebDriver·MCP 가 한 도구 구현 공유
 | 좌표·가시성은 가짜 레이아웃 값. AGPL
 | 
Skyvern
 | 실행 결과의 영속화
 | 에이전트 실행을 워크플로와 Python 스크립트로 승격, 실패하면 AI 폴백
 | 엔진 3종(v1·v2·v3), 검증 LLM + 병렬 추측, 자격증명·2FA
 | "비전 기반"은 현재 DOM 트리 중심. OSS에 CAPTCHA·프록시 없음
 | 
jev-ultrafast
 | 결정
 | 생성 대신 분류. 코드가 만든 후보 표에서 소형 모델이 번호와 확률만 반환
 | 핵심 700줄, 모델이 셀렉터·JS를 만들 수 없는 구조
 | iframe·shadow·업로드·키 입력 미지원. 호스팅 API 종속
 | 
webcmd
 | 실행 간 지식·실행 격리
 | 사이트 지식을 git 마크다운으로 축적, 스크립트는 QuickJS 샌드박스에서
 | 2일 증거 승격 규칙, 예산 기반 스냅샷·diff
 | "기억"은 재생이 아니라 프롬프트 지식. 90% 절감 근거 없음
 | 
scout
 | 모델 계층
 | hands·brain·eyes·extract 역할 분리, hedge·failover·비용 장부
 | 닫힌 액션 21종, ref 검증
 | 안전장치·기억은 코드에 있으나 OSS에서 미연결. 92.5%는 도달률
 | 
이번 분석에서 나온 공통 결론은 네 가지입니다.
루프는 하네스가, 도구는 도구 역할만: Stagehand는 agent()를 제거했고, browser-use는 CLI를 루프 없는 browser-harness로 바꿨습니다. webcmd·agent-browser·dev-browser도 LLM을 부르지 않습니다.
"한 번 탐색 → 다음엔 싼게"의 방식이 갈립니다: 액션 재생 캐시(Stagehand), 워크플로 코드 생성(Skyvern), 스크립트 녹화(Lightpanda PandaScript), 서술형 사이트 지식(webcmd, browser-harness domain-skills).
성능 수치는 거의 전부 자체 측정입니다: 같은 BU Bench 계열에서도 측정자에 따라 순위가 다르고, 대부분 단일 실행입니다. browser-harness 측정에서는 Playwright MCP·DevTools MCP·harness가 신뢰구간 안에서 차이가 없었습니다.
텔레메트리 기본 켜짐이 많습니다: browser-harness(스크립트·출력 전송 가능성), Lightpanda, Chrome DevTools MCP. 도입 전에 끄는 방법을 확인해야 합니다.
## 분석 방법
2026-10-19에 각 저장소를 git clone --depth 1로 받아 소스를 읽고 분석했습니다. 도구 15개를 7개 묶음으로 나눠 Sonnet 에이전트가 병렬로 맡았습니다.
묶음
 | 도구
 | 
주목 도구
 | Stagehand(+Browse CLI) / Lightpanda / Skyvern / jev-ultrafast / webcmd / scout
 | 
주류 기준선
 | Playwright MCP, Playwright CLI, agent-browser, Chrome DevTools MCP
 | 
browser-use 계열·소형
 | browser-use, browser-harness, dev-browser, chrome-cdp-skill
 | 
도구마다 같은 항목을 봤습니다. 모듈 구조, 브라우저 연결 방식, 페이지를 LLM에 표현하는 방식, 결정 주체와 LLM 호출 횟수, 요청 하나의 흐름(함수·파일 단위), 성능 장치, 보안 장치, 한계, 코드 품질입니다.
저장소 코드는 실행하지 않았습니다. 성능은 코드에서 확인한 메커니즘과 공개 수치로 설명하고, 수치는 "자체 측정"과 "제3자 측정"을 구분합니다.
"webcams"는 지난 조사의 webcmd(agentrhq/webcmd)로 보고 분석했습니다. "jev"는 Jev 모델을 쓰는 browser-use/jev-ultrafast입니다.
## 공통 구조
브라우저 에이전트는 다섯 계층으로 나눠 볼 수 있습니다. 누가 다음 행동을 고르는가(결정), LLM이 페이지를 어떤 형태로 보는가(표현), 한 번 찾은 동작을 어떻게 다시 쓰는가(실행·재사용), 브라우저를 어떤 경로로 제어하는가(연결), 페이지를 무엇이 실행하는가(엔진)입니다.
주류 도구는 왼쪽 열(호스트 결정, 접근성 트리, 명령 단위, Chrome)에 모여 있고, 주목 도구는 각자 한두 계층에서 오른쪽 열로 옮겼습니다.
## Stagehand v4
Stagehand v4는 에이전트 루프를 버리고, 브라우저 안에 상주하는 Chrome MV3 확장(서비스 워커)을 엔진으로 삼았습니다. TS·Python·Go SDK는 이 엔진에 JSON-RPC를 보내는 클라이언트입니다. 저장소 HEAD c6b6f27(2026-10-18), MIT. 확장 엔진 약 23.8k줄, 테스트 코드는 패키지 전체 약 95k줄입니다.
### 구조
packages/protocol: Zod 스키마가 단일 원천입니다. 여기서 JSON Schema를 생성하고, 다시 Python 모델과 Go 구조체를 생성합니다.
packages/extension: 실제 엔진입니다. controllers → services(act·observe·extract·cache·llm) → understudy 계층이고, understudy/는 Playwright를 흉낸 자체 구현(page, locator, frameRegistry, domainPolicy)입니다.
packages/sdk-*: 브라우저 기동, CDP 연결, 확장 로드만 담당합니다. act는 RPC 한 번입니다.
packages/cli: browse CLI. 세션별 데몬과 Unix 소켓 구조이고, LLM을 부르지 않는 저수준 명령(snapshot, click, fill)만 있어 agent-browser와 용도가 겹칩니다.
### 통신 경로
SDK는 브라우저 CDP에 한 번 붙어 Extensions.loadUnpacked로 확장을 올리고, 서비스 워커 타깃에 attach합니다. SDK→워커는 Runtime.evaluate로 전역 함수를 호출하고, 워커→SDK는 Runtime.addBinding으로 만든 바인딩을 호출합니다. 워커는 별도 CDP WebSocket을 열어 페이지를 직접 제어합니다. 즉 CDP 왕복이 브라우저 내부에서 끝납니다. MV3 서비스 워커 휴면은 offscreen 문서 heartbeat로 막습니다.
### 페이지 표현과 LLM 호출
Accessibility.getFullAXTree와 DOM 인덱스를 합친 하이브리드 스냅샷입니다. 노드는 프레임순번-backendNodeId 형태 id를 갖고, LLM이 id를 돌려주면 코드가 XPath로 복원합니다. iframe과 Shadow DOM을 포함합니다. 가지치기는 규칙 기반입니다(이름 없는 generic 제거, 단일 자식 구조 노드 축약, 중복 StaticText 제거). 관련성 점수나 토큰 예산 기반 프루닝은 코드에서 찾지 못했습니다.
API
 | LLM 호출
 | 비고
 | 
act(문자열)
 | 1회(최대 2회)
 | LLM이 twoStep을 요청하면 diff 트리로 2회째. selfHeal 옵트인 시 실패하면 +1
 | 
act(Action 객체)
 | 0회
 | 스냅샷·대기도 생략. 이전 결과 재생
 | 
observe
 | 1회
 | 요소 목록 반환
 | 
extract
 | 2회
 | 추출 + 완료 여부 판단. 대형 페이지 청크 분할 없음
 | 
### 캐시와 자가 복구
캐시는 Browserbase 서버(Redis)에만 있습니다. 키는 지침 + 페이지 내용 + 옵션이고, 같은 결과가 threshold회 쌓여야 hit을 줍니다. 로컬 브라우저에서는 무효이고, v3의 로컬 파일 캐시는 v4에서 삭제됐습니다.
README는 자가 복구를 기본 동작처럼 쓰지만, 코드에서 selfHeal은 act 전용 옵트인이고 1회 재시도입니다. 캐시 재생 실패 시에는 일반 LLM 경로로 돌아갑니다.
### 성능·보안
자체 측정: 50개 액션 크롤 1회에서 14.2초 vs Playwright 22.7초(1.59배). click 중앙값 628→323ms. 변경 로그의 "2배, 토큰 80% 절감"은 근거를 찾지 못했고, 제3자 측정도 없습니다. 이득은 원격 브라우저에서 커지고 로컬에서는 작습니다.
도메인 정책은 요청 단위로 강제됩니다(Fetch.enable로 요청을 멈추고 판정). 단 http(s) 외 스킴은 통과시킵니다.
%key% 변수 치환으로 비밀번호를 프롬프트에 넣지 않을 수 있습니다. 대신 확장이 debugger와 &lt;all_urls&gt; 권한을 갖고, 모델 API 키를 직접 넘기면 키가 워커에 들어갑니다.
### 평가
기존 대비 개선: CDP 처리의 브라우저 내부 이동, 한 코어를 3개 언어가 공유하는 프로토콜 생성 파이프라인, 액션을 재생 가능한 값(XPath)으로 돌려주는 설계, 캐시 hit/miss 사유와 절감 토큰 노출.
다른 관점: "결정적 코드 + 필요한 지점만 LLM"입니다. 루프는 Claude Code 같은 하네스에 맡기고, 한 번 찾은 액션을 코드에 굳혀 비용을 줄이는 방향입니다.
약점: 캐시가 Browserbase에 종속돼 오픈소스만으로는 핵심 이득의 일부를 얻지 못합니다. Chrome 전용이고, 세 SDK가 CDP 클라이언트·브라우저 관리를 각자 구현해 중복이 있습니다(understudy/page.ts 2770줄).
적합: Browserbase 위 반복 자동화, 안정적인 부분은 코드로·변하는 단계만 act로 처리하는 스크립트, 여러 언어 팀. 부적합: 자율 장기 에이전트를 라이브러리에 기대하는 경우, 로컬만으로 캐시 효과를 원하는 경우, 확장 권한을 주기 어려운 환경.
## Lightpanda
Lightpanda는 Chromium을 포크하지 않고 Zig로 새로 쓴, 레이아웃과 렌더링이 없는 헤드리스 브라우저입니다. 브라우저 안에 에이전트용 도구 계층과 LLM 에이전트, 재생 가능한 스크립트 형식(PandaScript)까지 넣었습니다. 저장소 HEAD 5d4e1c0(2026-10-19, 1.1.0-dev), AGPL-3.0. Zig 약 27만 줄(테스트 포함), Rust 4k줄, 인라인 테스트 1,926개.
### 무엇을 직접 만들고 무엇을 가져왔나
영역
 | 구현
 | 
HTML 파서
 | html5ever(Rust)를 FFI로 호출. 트리 구성 콜백에서 Zig DOM 노드를 바로 생성
 | 
DOM·Web API
 | 직접 구현. webapi/ 413개 파일 약 108k줄. fetch, XHR, WebSocket, Worker, IndexedDB, Shadow DOM, Custom Elements 포함. Canvas 2D 266줄, WebGL 196줄으로 실제 래스터화는 없음
 | 
CSS
 | 부분 구현. display, visibility, opacity, pointer-events, width, height 등 일부 속성만 캐스케이드. 레이아웃 없음
 | 
JS
 | V8 포크 링크. 바인딩은 코드 생성기 없이 Zig comptime으로 선언하고 V8 snapshot에 담음
 | 
네트워크
 | libcurl multi + 직접 구현한 CORS·robots·애드블록·IP 필터·레이트리미터
 | 
프로토콜
 | CDP 도메인 22개, WebDriver Classic·BiDi, MCP(stdio·HTTP). 자체 확장 도메인 LP(getMarkdown, getSemanticTree, getInteractiveElements, clickNode)
 | 
### 실행 구조
serve 모드에서는 epoll/kqueue 서버 루프가 WebSocket을 받고, 연결마다 워커 스레드 하나가 독립된 V8 isolate와 libcurl multi를 가집니다. 동시 연결 기본 상한은 16입니다.
브라우저당 단일 스레드 협력형 이벤트 루프(Runner._tick)가 이동, V8 태스크, libcurl 틱을 돌립니다.
MCP 도구 28개는 browser/tools.zig 한 곳에 정의되고, CDP 확장·MCP·내장 에이전트가 같은 구현을 공유합니다. 에이전트 모드에서는 CDP 왕복 없이 함수 호출로 동작합니다.
에이전트 세션을 /save하면 PandaScript(JS)로 기록되고, lightpanda run으로 LLM 없이 재생합니다. $LP_* 환경변수 참조는 프로세스 안에서 치환돼 비밀값이 LLM에 들어가지 않습니다.
메모리는 크기별 arena 풀을 재사용하고, DOM 노드는 개별 해제하지 않고 페이지 이동 때 arena를 통째로 반납합니다. V8 힙이 한계에 가까워지면 실행을 중단해 프로세스 OOM을 피합니다.
### 렌더링이 없어서 생기는 일
레이아웃은 "가짜"입니다. y는 문서 순서 인덱스×5px, 크기는 명시값이 없으면 5px입니다. getBoundingClientRect, getBoxModel(padding·border·margin 없음), elementFromPoint가 모두 이 값을 씁니다.
가시성은 display:none, visibility, opacity만 봅니다. 것히는 요소 판정이나 뷰포트 판정은 Chrome과 다르게 나옵니다.
스크린샷·PDF는 페이지 텍스트를 블록 모델로 만들어 Rust로 글자만 그린 결과입니다. 이미지와 CSS 레이아웃은 반영되지 않습니다.
스타일시트를 받지 않으면 클래스로 숨긴 메뉴가 보이는 것처럼 나오기 때문에, mcp·agent 모드는 스타일시트를 기본으로 받고 fetch·serve는 받지 않습니다.
### 성능·보안
자체 측정: 933페이지, 병렬 25에서 4.81초·피크 123MB vs Chrome 46.70초·2.0GB. Chrome 버전·플래그 미공개, 단일 머신입니다. WPT 서브테스트 약 174만 개 통과(Chrome의 약 80%)이고, 차이의 절반 이상이 CSS·editing·SVG입니다.
1.0부터 CORS가 기본 적용됩니다. --block-private-networks, WebSocket Origin 검사, 워치독의 JS 강제 종료가 있습니다.
CDP 포트에 인증 토큰이 없고 seccomp 같은 샌드박스도 없습니다. 외부에 열 때는 컨테이너 격리가 필요합니다. 텔레메트리는 기본 켜짐(LIGHTPANDA_DISABLE_TELEMETRY=true로 끔)입니다.
### 평가
기존 대비 개선: 에이전트 워크로드에 필요 없는 페인트·합성·멀티 프로세스를 설계 단계에서 뺐습니다. 출력도 픽셀이 아니라 마크다운·시맨틱 트리·상호작용 요소 목록입니다.
다른 관점: 호환성 기준을 "렌더링 일치"가 아니라 "DOM·Web API 일치(WPT)"에 둡니다. "Chrome을 띄우고 CDP로 제어"하던 구성을 "브라우저 함수 호출"로 줄였습니다.
비교: moli도 자체 엔진(Rust, Servo/Stylo)이지만 --layout으로 필요할 때만 실제 레이아웃을 켤 수 있습니다. Lightpanda는 그런 선택지 없이 레이아웃이 필요하면 Chrome으로 넘기는 설계입니다.
적합: 대량 크롤링, JS 의존 페이지 텍스트 수집, 자원이 적은 환경의 다중 세션, 폼·링크·fetch 기반 SPA 데이터 추출. 부적합: 시각 검증·레이아웃 회귀 테스트, 좌표·겹침에 의존하는 상호작용, 봇 차단이 강한 사이트, Windows 네이티브.
## moli (lexmount)
moli는 Lightpanda와 같은 "자체 엔진" 방향이지만, 브라우저 구성요소를 거의 다 갖추고 레이아웃·페인트를 필요할 때만 실행하는 쪽입니다. 저장소 HEAD 2843cde(2026-10-19, 1.1.18), MIT OR Apache-2.0. Rust 약 228만 줄(비테스트 약 130만, 테스트 약 95만), 크레이트 약 95개, 커밋 2,043개입니다.
### 구조
크레이트
 | 비테스트 줄 수
 | 역할
 | 
moli-renderer-v8
 | 약 794k
 | 사실상 브라우저 본체. DOM 브리지, V8 바인딩, Web API, 스타일 엔진, 페이지 스케줄러, 워커
 | 
moli-protocol
 | 약 215k
 | 프로토콜 중립 명령 실행. CDP 도메인 29개, 메서드 약 277개
 | 
moli-layout
 | 약 38k
 | 박스 트리, Taffy·Parley 연결, 히트 테스트, 동결 레이아웃 트리
 | 
moli-dom
 | 약 27k
 | 자체 DOM + html5ever
 | 
moli-protocol-server
 | 약 24k
 | axum 서버. CDP·WebDriver Classic·BiDi를 한 포트에서 라우팅
 | 
moli-fetch / moli-curl
 | 약 15k / 8k
 | HTTP, CORS, 쿠키, 캐시, libcurl multi, 사설망 차단
 | 
moli
 | 약 17k
 | CLI(fetch, serve, import)
 | 
가져온 것은 V8(rusty_v8 152.2.0 벤더링 + C++ shim), html5ever, Stylo, Taffy, Parley, libcurl, anyrender/vello_cpu(페인트), krilla(PDF)입니다. 이 중 Stylo·Taffy·Parley·curl-rust·url·anyrender·cookie가 모두 lexmount 또는 ldm0 포크의 고정 rev입니다. Web API 바인딩은 JS 폴리필이 아니라 Rust derive 매크로(#[derive(WebApiObject)])로 선언합니다.
### 레이아웃 두 가지 정책
항목
 | 기본(Mock)
 | --layout(OnDemand)
 | 
기하 값
 | 문서 순서로 24px씩 내려가는 고정 박스(기본 100×20). html·body·전체 높이 SPA 셸은 뷰포트 크기. 인라인 height만 반영
 | Stylo 계산 스타일 + Taffy 레이아웃 + Parley 텍스트로 만든 FrozenLayoutTree
 | 
좌표 클릭(Input.dispatchMouseEvent)
 | 오류 -32000으로 거부. DOM.resolveNode + Runtime.callFunctionOn을 쓰라고 안내
 | 동결 트리에서 히트 테스트 후 pointer·mouse 이벤트 시퀀스 디스패치
 | 
스크린샷·PDF
 | 없음
 | CPU 렌더링(vello_cpu), PDF는 krilla
 | 
갱신 시점
 | 해당 없음
 | 첫 기하 질의, 스크린샷, fetch --eval 직전, 웹폰트 등록. DOM·스타일 변경으로는 자동 갱신되지 않음
 | 
즉 --layout에서도 문서당 "마지막 동결 트리 하나"만 두고 증분 재계산은 하지 않습니다. 함수 주석도 기하가 stale할 수 있다고 밝힙니다. 동작 뒤 DOM이 바뀌면 다음 좌표 클릭이 어긋날 수 있다는 뜻입니다. 기본 모드에서 Playwright의 일반 locator.click()은 좌표 입력을 쓰므로 이 오류에 걸릴 것으로 보입니다(추정, 실행 미확인).
### 실행 구조
단일 프로세스입니다. Tokio 런타임은 최대 4스레드, V8 백그라운드 워커는 최대 8개, libcurl 전용 스레드 1개, V8 watchdog 스레드가 있습니다.
페이지 상태와 JS는 "owner" 단위의 단일 스레드 실행기에서 협력적 턴으로 돌고, 여러 페이지가 owner 하나를 공유할 수 있습니다. Worker류는 별도 스레드입니다.
메모리는 Linux·macOS에서 PartitionAlloc, 그 외에서 jemalloc을 씁니다. 인코딩된 이미지는 익명 임시 파일로 내보냈다 필요할 때 다시 읽습니다(Blink DiskDataAllocator 방식). 레이아웃·페인트 결과는 재사용하지 않고 버립니다.
이미지·폰트·미디어 같은 선택적 리소스는 기본으로 받지 않고 패밀리별로 켭니다. moli fetch --dump는 markdown, semantic tree, JSON, PDF 등을 출력합니다. 마크다운은 DOM→Markdown 상태 기계이고 readability식 본문 추출은 아닙니다.
### 성능 수치 (모두 Lexmount 자체 측정)
수치
 | 하네스
 | 비고
 | 
공개 웹 192 URL: 유용 페이지 53.6% vs Chrome 52.6%, 중앙 RSS 73MiB vs 773MiB
 | 저장소에 있음(moli-benchmark/)
 | "유용" 판정은 휴리스틱 분류기. 같은 표에서 Lightpanda는 유용 85페이지·RSS 40MiB·0.97초(moli 1.43초)
 | 
에이전트 워크로드: CDP ready 34.85 vs 169.37ms, 프로세스/스레드 1/24 vs 11/123
 | 저장소에 있음
 | 원본 결과 데이터는 미확인
 | 
Lexbench 81.88% vs Chrome 99.85%
 | 별도 저장소(같은 회사)
 | 이 저장소에서는 검증 불가
 | 
README 벤치마크는 0.1.1 기준이고 현재는 1.1.18입니다. CI에는 정적 HTML 545페이지를 네트워크 없이 돌리는 안정성 검사, CDP·WebDriver 스모크, Chromium 차분 테스트, 소크 테스트가 있습니다.
### 보안
사설망 차단은 DNS 응답 전체를 검사하지만 기본 꺼짐입니다(--block-private-networks). 프록시를 거치는 대상은 정책 밖입니다.
프로토콜 서버는 기본 127.0.0.1:9222이고 인증·Origin 검사를 찾지 못했습니다. 단일 프로세스라 OS 샌드박스나 사이트 격리는 없습니다.
외부로 전송하는 텔레메트리 코드는 찾지 못했습니다(telemetry.rs는 로그 초기화). Lightpanda·Chrome DevTools MCP와 다른 점입니다.
### 성숙도
공개 첫 커밋(2026-08-11)은 6,009개 파일, +237만 줄을 한 번에 올린 "Public preview"입니다. 이후 하루 평균 약 30커밋이고, 커밋의 약 95%가 한 계정(ldm0, lexmount 이메일 사용)입니다. ldm0/moli는 이 저장소의 포크이고, 같은 사람이 의존 포크(Taffy, anyrender 등)도 관리합니다. 테스트 비중(Rust의 약 42%, #[test] 약 15k개)과 CI 구성은 탄탄하지만, 사실상 한 사람에게 달린 프로젝트입니다.
### 평가
Lightpanda 대비 개선: 같은 바이너리 안에 실제 CSS 레이아웃·히트 테스트·스크린샷·PDF 경로가 있습니다. 기본 모드에서 좌표 입력을 명시적 오류로 거부해 가짜 기하로 거짓 성공을 내지 않습니다. CDP·WebDriver Classic·BiDi를 한 포트에서 제공하고, 외부 텔레메트리가 없고, 라이선스가 AGPL이 아니라 MIT/Apache입니다.
다른 관점: Lightpanda는 최소 구현으로 가볍게 가고, moli는 구성요소를 다 갖추되 실행 시점만 미룹니다. 그 대가가 비테스트 130만 줄과 포크 의존성이고, 자체 표에서도 메모리·속도는 Lightpanda가 앞섭니다.
약점: 버스 팩터가 사실상 1이고, 의존성 다수가 포크입니다. --layout의 기하가 자동 갱신되지 않고, 기본 모드는 일반 Playwright 클릭과 호환되지 않을 수 있습니다. 사설망 차단 기본 꺼짐과 무인증 CDP는 공용 환경에서 위험합니다.
적합: 에이전트용 대량 페이지 읽기, JS SPA의 DOM 추출, 단일 프로세스로 많이 띄우는 평가·크롤 환경, 요소 단위 조작 위주의 스크립트, 간단한 스크린샷·PDF. 부적합: 픽셀 정확한 시각 검증, 기본 모드의 좌표 클릭, 가상 스크롤·지연 로드 의존 사이트, WebGL·미디어, PDF 입력 파싱, 외부 노출 서버.
## Skyvern
Skyvern은 라이브러리가 아니라 서버입니다. 스텝 루프 에이전트 위에 워크플로 블록 엔진과 "성공한 실행을 Python 스크립트로 굳히는" 계층을 얹었습니다. 저장소 HEAD a4fe637(2026-10-18, 1.0.56), AGPL-3.0. 본체 Python 약 51만 줄, 테스트 약 71만 줄, React 프론트엔드 약 38만 줄로 이번 분석 대상 중 가장 큽니다.
### 구조
skyvern/forge/: FastAPI 서버와 에이전트 본체(agent.py 12k줄), 프롬프트 95개, 워크플로 엔진(block.py 20k줄), DB repository 약 30개.
skyvern/webeye/: 브라우저 계층. 페이지 주입 스크립트 domUtils.js(4,088줄), 액션 핸들러(handler.py 16.6k줄).
skyvern/core/script_generations/: 실행 기록에서 Python 코드를 생성.
skyvern/library/: Playwright 호환 SDK. skyvern/cli/mcp_tools/: MCP 도구.
저장소는 SQLite 기본, Postgres 전환, Alembic 마이그레이션 321개. 아티팩트는 로컬·S3·Azure.
### 엔진 세 개가 함께 있음
엔진
 | 구조
 | 한도
 | 
v1(기본)
 | 스텝마다 스크랩 → LLM 1회로 액션 배열 생성 → 실행 → 검증 LLM. 재귀 호출로 다음 스텝
 | 스텝 10, 스텝당 재시도 5
 | 
v2
 | 플래너 LLM이 mini goal을 만들고 내부 v1 태스크로 실행
 | 반복 50
 | 
v3
 | 한 대화 안에서 네이티브 tool calling. 매 호출에 이력 전체 재전송
 | 80턴, 도구 300회, 150만 토큰, 30분
 | 
OpenAI·Anthropic CUA, UI-TARS도 엔진 옵션입니다. README의 "에이전트 군집"은 별도 프로세스가 아니라 역할별 프롬프트입니다(플래너, 액션 생성, 목표 검증, 추출, 드롭다운 선택, OTP 파싱). 설정에서 역할마다 다른 모델을 지정할 수 있습니다.
### 페이지 표현: "비전 기반"은 현재 코드와 다름
주 입력은 domUtils.js가 요소마다 unique_id를 붙여 만든 DOM 요소 트리(HTML 문자열)이고, LLM은 그 id로 대상을 지정합니다. iframe과 Shadow DOM을 포함합니다. 스크린샷은 최대 10장을 보조 이미지로 함께 보냅니다. 스크린샷 위에 요소 번호 박스를 그리는 방식은 코드에 "DEPRECATED"로 표시돼 있습니다. 프롬프트에는 웹 콘텐츠를 UNTRUSTED DATA로 감싸는 구분자가 있습니다.
### 태스크 하나의 흐름 (폼 채우고 제출)
POST /v1/run/tasks가 Task 행을 만들고 FastAPI 백그라운드로 실행을 시작합니다.
execute_step이 브라우저를 열고 스크랩해 ScrapedPage를 만듭니다.
extract-action.j2 프롬프트에 요소 트리, 목표, 사용자 데이터, 이전 액션을 넣고 LLM 1회로 INPUT_TEXT·SELECT_OPTION·CLICK 배열을 받습니다.
핸들러가 순서대로 실행합니다. 비밀값은 이 시점에 플레이스홀더에서 실제 값으로 바뀝니다.
스텝이 끝나면 목표 검증 LLM과 다음 스텝 사전 스크랩·추측 계획을 병렬로 돌립니다. 완료면 종료하고, 아니면 사전 계산을 재사용해 다음 스텝으로 갑니다.
제출 성공 판정은 검증 LLM이 새 스크린샷과 DOM을 보고 합니다. 결정적 확인 로직은 없습니다.
### 코드로 굳히기
generate_script.py(4,437줄)가 libcst로 워크플로 실행 기록에서 Python 코드를 생성합니다. 생성 코드는 page.click(selector, prompt=...) 형태라 셀렉터가 되면 LLM을 쓰지 않고, 실패하면 AI 폴백으로 넘어갑니다. 폴백 사례는 script_reviewer.py가 LLM으로 검토해 스크립트를 고칩니다. 블록 단위로 점진적으로 캐시하고, 모든 최상위 블록에 스크립트가 있어야 run_with: code로 실행됩니다.
### 운영 기능과 OSS 경계
자격증명 볼트(자체, Bitwarden, 1Password, Azure, GCP), TOTP 직접 생성·웹훅·이메일·SMS OTP, 자릿수별 입력칸 TOTP를 처리합니다. CredentialReleaseGuard는 비밀값이 해당 사이트 밖으로 입력되는 것을 막습니다.
OSS에는 CAPTCHA 풀이가 없습니다. SOLVE_CAPTCHA 핸들러는 로그를 남기고 30초 기다린 뒤 성공을 반환합니다. 프록시 연결 코드도 찾지 못했고, 안티봇은 AutomationControlled 비활성화 인자 정도입니다. 클라우드와 OSS의 경계는 AgentFunction 훅 클래스입니다.
공개 수치는 모두 자체 보고입니다. WebVoyager 85.85%는 클라우드에서 GPT-4o로 측정했고 무효 과제 8개를 뺐 값입니다. 현재 기본 모델은 다릅니다. evaluation/에 재현용 데이터와 스크립트가 있습니다.
### 평가
기존 대비 개선: 에이전트 실행을 영속 워크플로와 스크립트로 승격하는 파이프라인, 자격증명·2FA·비밀 마스킹·사이트 한정 자격증명 방출 같은 운영 기능, "액션은 성공했지만 목표는 미달성" 문제를 다루는 검증 LLM과 그 지연을 숨기는 병렬 추측.
다른 관점: "에이전트가 탐색하고 결과를 코드로 굳힌다"는 방향은 Stagehand와 같지만, Stagehand는 액션 단위 서버 캐시이고 Skyvern은 워크플로 단위 코드 생성입니다.
약점: 엔진·실험 플래그 분기가 많고 파일이 매우 커서 동작 예측이 어렵습니다. README와 코드가 어긋난 부분이 있습니다. 스텝마다 스크랩·스크린샷·LLM·검증이 걹쳐 비용과 지연이 큽니다.
적합: 로그인·2FA가 끼는 RPA형 쓰기 작업을 한 번 에이전트로 돌리고 워크플로로 굳혀 반복하는 유즈케이스, 감사 기록이 필요한 업무 자동화. 부적합: 지연·비용에 민감한 대량 크롤링, OSS만으로 봇 차단 사이트 상시 운영, 서버·DB·UI를 올릴 이유가 없는 가벼운 작업, AGPL이 곤란한 SaaS 내장.
## jev-ultrafast
jev-ultrafast는 브라우저 조작을 "생성"이 아니라 "분류"로 바꾼 실험입니다. 코드가 후보 요소 표를 만들고, 소형 결정 모델 Jev(TypeSafe)는 연산과 요소 번호만 고릅니다. 저장소 HEAD 1231850(2026-09-18), MIT. 핵심 코드는 약 700줄이고 의존성은 browser-harness와 httpx 둘뿐입니다.
### 구조
파일
 | 줄 수
 | 역할
 | 
agent.py
 | 174
 | tick = predict + act 루프
 | 
model.py
 | 198
 | 후보 번호 매핑, TypeSafe 호출, 응답 검증, 텍스트 LLM 호출
 | 
browser.py
 | 194
 | browser-harness 데몬 위 CDP 연결, 신선도 검사, 실행
 | 
snapshot.js
 | 107
 | 페이지 안에서 한 번에 도는 DOM 스냅샷
 | 
CDP 계층은 직접 만들지 않고 browser-harness 0.1.13을 재사용합니다. 사용자의 기존 Chrome에 백그라운드 탭을 만들고, 백그라운드에서도 애니메이션이 멈추지 않도록 focus emulation을 켭니다.
### 페이지 표현
접근성 트리를 쓰지 않고 Runtime.evaluate 한 번으로 DOM에서 직접 읽습니다. 대상은 표준 컨트롤과 ARIA role 14개이고, 숨김·비활성·뷰포트 밖 요소와 password·file input은 빼냅니다. 가시 텍스트는 최대 6000자, 후보는 250개까지입니다. 모델에는 {page, elements[index, role, label, value, 상태, operations], recent_actions}를 보내고, 스크린샷은 보내지 않습니다.
### 결정과 실행
한 단계마다 TypeSafe /v1/systemone에 요청 1회를 보냅니다. "어떤 연산인가"와 "연산별 대상 요소"를 한 요청에 묶어 동시에 묻습니다(투기적 fan-out).
응답은 후보별 확률분포입니다. validate_choice()가 선택이 허용 ID 안에 있는지, 확률 합이 1인지, 선택이 최대 확률인지 검사하고 하나라도 어긋나면 중단합니다.
번호를 코드 소유의 액션 레코드로 바꾸고, 페이지 쪽 window.__jevFast Map에서 실제 DOM 노드를 꺼냅니다.
입력 직전에 가시성·활성·elementFromPoint 가림 여부를 다시 확인하고 Input.dispatchMouseEvent를 보냅니다.
TYPE_TEXT가 선택됐을 때만 작은 LLM이 {"text": "..."} 하나를 생성하고, Input.insertText로만 넣습니다.
모델은 셀렉터, JS, 좌표를 만들 수 없습니다. 루프 예산은 액션 60회, 결정 120회이고 최근 3개 액션이 페이지를 바꾸지 못하면 BLOCKED로 끝납니다. 신선도는 전체 DOM 변이가 아니라 대상 요소와 주변 문맥(form, dialog 등)만 비교해서, 애니메이션으로는 재예측하지 않습니다. 상위 계획 모델은 따로 없고, 매 단계 Jev가 목표 전체를 보고 다음 행동을 고릅니다.
### 성능 (모두 자체 측정)
Google Flights 편도 검색 1회: 7,073ms. Jev 요청 17회(중앙값 178ms)가 전체의 약 53%, 텍스트 LLM 2회, 입력 토큰 90,558.
이전 버전 대비 6회 교대 측정: 중앙값 9.45초→7.09초, CDP 호출 1,092→101. 문서가 스스로 "3쌍으로는 강한 주장이 어렵다"고 적습니다.
다른 도구와의 직접 비교 수치는 없습니다. Jev 단가는 TypeSafe 발표 기준 입력 $0.042/백만 토큰입니다.
### 한계
README가 밝힌 미지원 기능은 코드에서 원인이 보입니다.
미지원
 | 코드상 원인
 | 
shadow root, iframe
 | querySelectorAll과 TreeWalker가 최상위 문서에서만 돔
 | 
파일 업로드
 | file input을 후보에서 제외, DOM.setFileInputFiles 경로 없음
 | 
팝업 탭
 | Browser가 타깃·세션을 하나만 보유
 | 
중첩 스크롤
 | 고정 좌표 (550, 650)의 휠 이벤트 하나
 | 
Enter·화살표 키
 | 연산 목록에 키 입력이 없어 제출은 버튼 클릭에 의존
 | 
그 밖에 Jev는 TypeSafe 호스팅 API(대기자 명단)이고 가중치와 모델 크기가 비공개입니다. 페이지 텍스트가 외부 API로 나가고, 결제·삭제 같은 위험 액션 확인 단계는 없습니다. 검증된 실사이트는 2개(Google Flights, Wikipedia)입니다.
### 평가
기존 대비 개선: 출력이 열린 JSON이 아니라 정해진 선택지의 확률이라 환각된 셀렉터나 형식 오류가 구조상 나오지 않습니다. 확률과 confidence가 로그로 남아 디버깅에 쓸 수 있습니다. 한 단계가 수백 ms라는 가정으로 스냅샷·신선도·대기 정책을 다시 설계했습니다.
다른 관점: 범용 LLM이 매 단계 판단하는 대신, 판단을 "빠르고 좋은 분류기"에 맡기고 생성은 텍스트 입력에만 씁니다. 보안과 지연 시간을 얻고 표현력을 포기한 설계입니다.
적합: 표준 HTML/ARIA로 된 폼·검색·필터·날짜 선택 같은 짧고 반복되는 조작, 결과를 코드로 따로 검증할 수 있는 작업. 부적합: 추출·요약, iframe·웹 컴포넌트 UI, 업로드, 새 탭 흐름, 위험 액션. 현재는 MVP로 보는 편이 맞고, "결정 모델 + 코드 소유 후보 표" 구조를 자기 하네스에 차용하는 참고 구현으로 가치가 큽니다.
## webcmd
webcmd의 "자기학습"은 셀렉터나 API 스펙을 저장해 재생하는 기능이 아닙니다. 호스트 에이전트가 스킬 지침에 따라 사이트별 마크다운 문서(SITE.md)를 쓰고, 다음 실행 때 그 문서를 프롬프트에 넣는 구조입니다. 저장소 HEAD 9d8ea44(2026-09-25, 0.8.4), Apache-2.0. TS 약 6.2만 줄, 테스트도 약 6.2만 줄, 커밋 694개·작성자 30명(첫 커밋 2026-07-03).
### 구조
src/browser/: 브라우저 제어. 기본 런타임은 번들된 CloakBrowser(스텔스 Chromium)를 Playwright로 구동합니다. macOS 알파 브라우저 SLAB도 있습니다.
src/browser/snapshot/: 접근성 트리 캡처, 예산 기반 가지치기(budget.ts), 실행 전후 diff(diff.ts).
src/browser/run/: browser run. 호스트 LLM이 보낸 Playwright 스타일 JS를 QuickJS(WASM) 샌드박스에서 실행합니다. dev-browser에서 가져온 코드가 NOTICE에 명시돼 있습니다.
src/site-memory/: 사이트 메모리 저장소(테스트 포함 8.4k줄).
skills/: 학습 루프의 대부분은 코드가 아니라 이 에이전트 지침 문서에 있습니다.
webcmd 코드에는 LLM 호출이 없습니다. 결정은 Claude Code, Codex, pi 같은 호스트가 합니다. 인터페이스는 CLI이고, MCP는 argv를 받는 webcmd_cli_run 도구 하나입니다.
### 기억의 저장 방식
~/.webcmd/sites/&lt;product-key&gt;/ 아래에 로컬 git 저장소로 관리됩니다.
파일
 | 내용
 | 
sitemap/SITE.md, references/*.md
 | 활성 메모리. 라우트와 액션 공간, 더 나은 경로, 로그인 없이 되는 것, 비용이 드는 실수를 자연어로 기록
 | 
candidates/*.json
 | 후보 관찰. kind 5종(action_space, better_path, access, high_consequence, repeated_mistake), 주장, 근거, 날짜
 | 
.drafts/&lt;task-id&gt;/
 | 에이전트가 편집하는 초안
 | 
코드가 강제하는 규칙은 네 가지입니다. 후보는 서로 다른 UTC 날짜 2개 이상의 근거가 있어야 승격되고, SITE.md의 사실 줄마다 [verified YYYY-MM-DD]가 있어야 하며, 500줄을 넘으면 200줄 이하로 재작성해야 하고, 후보 근거에서 비밀번호·토큰·JWT 패턴을 거부합니다. 쓰기는 파일 락과 낙관적 동시성 제어를 씁니다.
### 첫 실행과 두 번째 실행
첫 실행: site memory context &lt;url&gt;가 로컬 메모리를 찾고, 없으면 api.webcmd.dev에서 공용 seed를 받습니다. 에이전트는 작업하면서 다섯 종류에 해당하는 관찰만 후보로 기록합니다. 하루치 근거뿐이라 SITE.md는 대개 갱신되지 않습니다.
두 번째 실행: 같은 호출이 SITE.md를 에이전트 컨텍스트에 넣습니다. 에이전트는 탐색을 줄이지만 browser run 프로그램은 새로 작성합니다. 저장된 액션을 재생하거나 API 호출로 바꾸는 코드는 없습니다.
다른 날 같은 관찰이 쌓이면 승격돼 SITE.md가 갱신됩니다.
### 성능과 주장의 근거
BU Bench V1 100과제, 도구당 1회(자체 측정, 같은 컨트롤러·브라우저·심판) 결과입니다.
도구
 | 정확도
 | 완료 과제당 비용
 | 평균 턴
 | 
webcmd
 | 67%
 | $0.255
 | 9.8
 | 
browser-use
 | 66%
 | $0.297
 | 14.8
 | 
dev-browser
 | 55%
 | $0.263
 | 15.2
 | 
Playwright CLI
 | 55%
 | $0.441
 | 20.5
 | 
agent-browser
 | 47%
 | $0.554
 | 25.5
 | 
이 벤치마크는 사이트 메모리가 아니라 한 번에 묶어 실행하는 browser run, 예산 기반 스냅샷, 실행 전후 diff를 측정합니다. 개선의 대부분은 턴 수 감소에서 나옵니다. README의 "토큰 최대 90% 절감"과 메모리 효과를 보여주는 측정은 저장소에서 찾지 못했습니다. 측정 버전은 0.7.3이고 단일 실행이라 1과제 차이는 노이즈 범위입니다.
### 보안
browser run은 QuickJS 샌드박스라 document, require, fs가 없고 메모리·CPU 제한이 있습니다. 이번에 본 코드 실행형 도구 중 가장 명확한 격리입니다.
로그인은 사용자 Chrome이 아니라 별도 프로필(쿠키 저장소)에 합니다. Chrome 쿠키를 가져오는 옵션은 있습니다.
결제·삭제 승인은 코드 게이트가 아니라 스킬 지침에 의존합니다. 페이지 내용이 에이전트를 속여 SITE.md에 잘못된 지침을 남길 수 있고, 본문의 비밀·개인정보 검사는 없습니다.
후보 JSON에 호스트명과 사설·공인 IP가 평문으로 저장됩니다(로컬, WEBCMD_CANDIDATE_PUBLIC_IP=off로 끔). 네트워크 캡처 창고는 0600 권한, 24시간 TTL입니다.
### 평가
기존 대비 개선: dev-browser의 "스크립트 한 덩어리" 방식을 QuickJS로 격리하고, 실행 후 diff를 자동으로 돌려주며, 스냅샷을 문자 예산으로 가지치기합니다. 자체 벤치마크에서 가장 적은 턴으로 가장 높은 정확도를 냈습니다.
다른 관점: 사이트 지식을 git 이력이 있는 마크다운으로 두어 사람이 읽고 고칠 수 있게 했습니다. Stagehand·Skyvern의 "정확 재생"과 반대로 UI 변화에는 유연하지만 매번 LLM 판단 비용이 듭니다.
약점: 학습 품질이 호스트 LLM이 긴 지침을 따르는지에 달려 있고, 2일 승격 규칙 때문에 메모리가 느리게 쌓입니다. 3개월 만에 0.8.4이고 메모리 스키마 단절이 한 번 있었습니다.
적합: 같은 사이트를 여러 세션에 걸쳐 자주 쓰는 읽기 위주 리서치·수집, 여러 호스트 에이전트가 같은 CLI를 공유하는 환경. 부적합: 코드 수준 승인 게이트가 필요한 결제·삭제, 한두 번 쓰는 사이트, 자동화가 약관상 금지된 사이트(스텔스 전제 도구입니다).
## scout
scout는 new Scout({browser, models}).run(task) 한 번으로 끝까지 수행하는, 루프와 모델 계층을 직접 가진 TypeScript 라이브러리입니다. 저장소 HEAD 8b5dd40(2026-10-19), Apache-2.0. TS 약 6.4만 줄, 테스트 약 3.7만 줄입니다. 커밋 23개가 모두 "sync YYYY-MM-DD" 형태의 자동 미러링이라 실제 개발 이력은 공개되지 않습니다.
### 구조
패키지
 | 역할
 | 
scout
 | 공개 API, 브라우저 열기, 모델 조립
 | 
runtime
 | 에이전트 루프. loop.ts가 14,527줄 한 파일. 액션 21종, 스냅샷, 검증, 한도
 | 
model
 | chat-completions 호환 어댑터, failover, hedge, 비용 장부
 | 
scout-cdp
 | CDP 바인딩(page-binding.ts 4.2k줄)
 | 
scout-core
 | 공용 타입: secrets, rules, spend
 | 
agenthands
 | 사람 같은 마우스·키보드 입력 계획(궁적 데이터 포함, MIT)
 | 
### 루프와 모델 역할 분리
브라우저는 로컬 실행, 실행 중인 브라우저에 cdpUrl로 연결, Outcrawl 클라우드 할당 세 가지입니다. 어느 경우든 OSS 경로는 순수 CDP(Accessibility.getFullAXTree, DOMSnapshot)로 동작합니다.
스냅샷은 접근성 트리 직렬화이고, 노드 참조는 프레임순번-backendNodeId입니다(Stagehand와 같은 형식). 문자 상한 안에서 문서 앞부분을 먼저 채우고 남는 여유는 조작 가능한 노드에만 씁니다.
단계 루프: 스냅샷 → 액션 요청 → validateAction(모델이 본 트리에 없는 ref 거부) → 실행 → 정착 대기·결과 확인. 액션은 닫힌 유니온 21종(click, fill, select, press, drag, openTab, attachFile, ask, callTool, purchase.begin/end, done, fail 등)입니다.
모델 역할은 네 개입니다. hands(필수, 액션 결정), brain(선택, 상위 판단), eyes(선택, 비전), extract(선택). 역할마다 baseURL·키·모델을 따로 줄 수 있고, 지연 시 같은 모델에 중복 요청하는 hedge와 호출별 USD 비용 장부(정확 소수점 산술)가 있습니다.
장기 실행 보조: 이력 창 8개, 12스텝 이후 계획 요구, 목표 장부·발견 사항·"배제한 것" 기록과 압축, 정체 감지.
### OSS에서 실제로 켜져 있는 범위
코드에는 비밀 플레이스홀더({{secret:&lt;handle&gt;}}), 자연어 규칙을 강제 게이트로 바꾸는 파서, 결제 한도·승인, 사이트별 노트(site-skills.ts), 재개(resume.ts)가 있습니다. 그런데 scout.ts가 이들을 루프에 연결하지 않고, 다중 탭(tabs: null)과 파일 업로드(files: null)도 꺼져 있습니다. 즉 OSS 사용자가 쓰는 scout에는 지출 게이트·비밀 처리·실행 간 기억이 없습니다. 로컬 CDP 경로에는 클라우드 포크의 페이지 동결(모델이 생각하는 동안 페이지를 멈추는 기능)도 없습니다.
### 성능 수치의 의미
README의 92.5%는 작업 성공률이 아니라 Browser Use 80개 사이트에서 Outcrawl 클라우드가 페이지에 "도달"한 비율입니다. 브라우저 인프라의 탐지 우회 지표에 가깝고, 벤치마크 하네스는 저장소에 없습니다. 코드 주석에는 BU Bench V1 실패 사례 번호를 근거로 한 수정이 많아, 그 벤치로 튜닝한 흔적이 보이지만 정확도는 공개하지 않았습니다.
### 평가
기존 대비 개선: 모델 역할 분리(hands/brain/eyes/extract), hedge·failover, 호출별 비용 장부는 다른 도구에서 드문 구성입니다. 실제 효과를 보여주는 비교 수치는 없습니다.
다른 관점: 가장 큰 차별점은 코드가 아니라 클라우드 브라우저(주거용 IP, 캐차 풀이, 동결)입니다. 코드만으로는 "기존 대비 개선"을 판단할 근거가 부족합니다.
약점: 공개 코드에 내부 호스트용 기능이 대량 섞여 있어 어디까지가 공개 동작인지 읽는 사람이 구별해야 합니다. 생성 1주일째라 API 안정성이 없고 루프 파일 14.5k줄은 리뷰 비용이 큽니다.
적합: 탐지 수준이 높은 사이트의 일회성 읽기·폼 작업을 클라우드 브라우저로, 모델 공급자를 역할별로 바꿔 비교, JSON Schema로 출력을 고정하는 추출. 부적합: 반복 작업 비용 절감, 지출 안전장치가 필요한 작업, 다중 탭·업로드, 온프레미스 완결형 요구.
## 주류 도구: Playwright MCP·CLI, agent-browser, Chrome DevTools MCP
세 도구 모두 접근성 트리에 ref를 붙이고 LLM 없이 호스트 에이전트의 명령을 실행합니다. 차이는 스냅샷을 만드는 방법, ref를 얼마나 오래 유지하는지, 동작 뒤 무엇을 기다리는지에 있습니다.
### Playwright MCP와 CLI는 같은 코드입니다
playwright-mcp와 playwright-cli 저장소는 껍데기이고, 실제 구현은 microsoft/playwright의 playwright-core/src/tools/(약 16.3k줄)에 있습니다. 두 인터페이스는 같은 BrowserBackend, 같은 tool 정의, 같은 Response를 씁니다. CLI는 명령 약 100개를 tool에 매핑(click→browser_click)하고, 세션별 데몬이 Unix 소켓으로 브라우저를 유지합니다.
스냅샷: 브라우저 AX API가 아니라 페이지에 주입한 스크립트가 DOM을 직접 순회하고, 접근성 이름도 Playwright 자체 구현으로 계산합니다. iframe은 f1e3처럼 접두어를 붙여 병합합니다.
ref: 보이고 pointer 이벤트를 받는 요소에만 e&lt;N&gt;을 부여합니다. role과 name이 같으면 번호를 유지하지만, 해석은 마지막 스냅샷의 맵에서 하므로 네비게이션 후에는 대체로 무효입니다.
동작 후 응답: click·navigate 뒤의 스냅샷은 인라인이 아니라 .playwright-mcp/page-&lt;시각&gt;.yml 파일로 저장되고 링크만 옵니다(response.ts:289, 코드 읽기). Checkly가 MCP와 CLI의 토큰 차이를 거의 못 찾은 이유가 이 구조입니다. 응답에는 실행한 동작이 Playwright 코드로 나옵니다.
대기: 동작마다 settle 500ms 후 네트워크 응답을 최대 5~10초 기다리고, 서버 쪽 actionability(보임·활성·안정·가림) 검사를 합니다.
보안: --allowed-origins는 context.route('**')로 구현되지만 옵션 설명 스스로 보안 경계가 아니라고 합니다. --secrets는 이름→값 치환과 응답 마스킹입니다. browser_run_code_unsafe(Node vm, RCE 동급)는 기본 활성이고 끄는 플래그는 찾지 못했습니다. CLI는 파일 경로 제한 검사가 꺼져 있습니다.
로그인 브라우저 연결: extension 모드는 MCP가 로컬 WebSocket 릴레이를 열고, 확장이 chrome.debugger로 CDP를 대신 실행합니다. 사용자가 연결 페이지에서 Allow를 눌러야 합니다.
### agent-browser
vercel-labs/agent-browser HEAD dac13bb(10-15), Apache-2.0. Rust 약 107.8k줄(테스트 1,566개 포함)이고 Node·Playwright·Puppeteer 의존이 없습니다. CDP 클라이언트를 직접 구현했고, MCP 서버는 같은 바이너리의 --json CLI로 위임합니다.
스냅샷: Accessibility.getFullAXTree에 페이지 JS로 찾은 cursor:pointer·클릭 핸들러 요소를 더합니다. iframe은 한 단계만 전개합니다.
영구 ref: 데몬이 문서(loaderId) 단위로 backendNodeId→@eN을 메모리에 유지해, 같은 문서 안에서는 재스냅샷 후에도 번호가 같습니다. 해석에 실패하면 AX 트리를 다시 조회해 role+name+nth가 같은 노드로 대체합니다. 이 복구는 다른 요소를 집을 위험이 있습니다.
--delta: 스냅샷은 항상 새로 만들고, 직전 리비전과 비교해 unchanged, ref 단위 변경 + 줄 단위 diff, 또는 70% 이상 바뀌면 full을 냅니다. CDP 비용이 아니라 토큰만 줄입니다.
대기: 클릭은 가림 검사 후 Input.dispatchMouseEvent를 보내고 끝납니다. Playwright식 auto-wait·settle이 없고 자동 스냅샷도 붙이지 않아 응답이 작은 대신, 상태 확인은 에이전트가 따로 해야 합니다.
보안: --allowed-domains는 Fetch 가로채기에 WebSocket·sendBeacon·Worker·WebRTC 차단 JS 패치까지 더해 이번 비교 중 가장 넓습니다. 단 기존 로그인 브라우저(--auto-connect, --cdp)와는 함께 쓸 수 없습니다. --action-policy는 정책 파일이 없거나 깨지면 정책 없음으로 처리되는 것으로 읽혔습니다(fail-open 가능성, 실행 미확인).
WebMCP: Chrome 플래그를 켜고 도구 목록을 캐시해 응답에 요약(16개·4KiB)을 붙입니다. untrusted:true 표시는 출처 표시일 뿐 방어 경계가 아니라고 README가 밝힙니다.
### Chrome DevTools MCP
ChromeDevTools/chrome-devtools-mcp HEAD e342c6e(10-19), Apache-2.0. TS 약 26k줄, 테스트 약 39k줄. Puppeteer로 Chrome을 조작합니다.
도구 59개: 입력 10, 이동 6, 성능 3, 네트워크 2, 디버깅 9, 메모리(힙 스냅샷) 14, PWA 4 등. --slim은 navigate·evaluate·screenshot 3개만 남깁니다.
스냅샷: Puppeteer가 가져온 AX 트리를 uid=1_5 button "Submit" 형태로 출력합니다. 축소 수단은 verbose와 filePath뿐이고, 동작 tool의 includeSnapshot 기본값이 false입니다. DevTools Elements 패널에서 선택한 요소를 표시합니다.
대기: 클릭 후 100ms 안에 시작하는 네비게이션을 감지하고, MutationObserver로 DOM이 100ms 안정될 때까지 최대 3초 기다립니다. CPU·네트워크 스로틀에 비례해 늘어납니다.
진단: 성능 트레이스는 DevTools TraceEngine으로 파싱해 원시 데이터 대신 Insight(예: LCP 분해)를 돌려주고, CrUX 실사용자 데이터를 붙입니다. 힙 스냅샷은 디스크에 두고 요약·dominators·retainers·비교를 조회합니다. React 앱의 렌더링 성능이나 메모리 누수를 에이전트에게 맡길 때 다른 도구로 대체하기 어렵습니다.
보안·텔레메트리: URL 허용·차단 패턴은 Puppeteer/Chrome에 넘겨 강제합니다(allowlist는 Chrome 149 이상). 비밀 치환 기능은 없습니다. 사용 통계는 기본 켜져 Google로 전송되며, 문자열 인자는 길이 구간만, URL은 localhost 여부만 기록합니다. 성능 트레이스 URL은 CrUX API로 나갈 수 있습니다.
### 세 도구 비교
항목
 | Playwright MCP / CLI
 | agent-browser
 | Chrome DevTools MCP
 | 
스냅샷 출처
 | 주입 스크립트가 DOM 순회
 | CDP AX 트리 + 커서 요소 탐색
 | Puppeteer AX 트리
 | 
ref 수명
 | 마지막 스냅샷 기준
 | 문서 단위 유지 + 자동 복구
 | 최신 스냅샷만 유효
 | 
동작 후 스냅샷
 | 자동, 파일 링크
 | 없음
 | 기본 없음
 | 
동작 후 대기
 | settle 500ms + 네트워크 + actionability
 | 없음(가림 검사만)
 | 네비게이션 감지 + DOM 안정
 | 
축소 수단
 | none 모드, depth, 부분, find
 | -i, -c, -d, -s, delta, if-changed
 | filePath, 페이지네이션, slim
 | 
도메인 제한
 | origin 라우팅(경계 아님)
 | Fetch + JS 패치(기존 브라우저 불가)
 | Chrome 내장 패턴
 | 
브라우저
 | Chromium·Firefox·WebKit
 | Chrome(+기타 백엔드)
 | Chrome 전용
 | 
제3자 측정(Ranger, 시나리오 1)
 | MCP 약 92초·14회 / CLI 약 240초·40회
 | 약 179초·29회
 | 측정 없음
 | 
Playwright는 "가장 완성도 높은 범용 실행 계층 + 코드 생성", agent-browser는 "가장 가벼운 전용 데몬 + 토큰 절약 기능", Chrome DevTools MCP는 "조작보다 관찰·진단이 강한 서버"입니다.
## browser-use 계열과 소형 도구
이 네 도구는 "에이전트가 도구를 호출"하는 방식과 "에이전트가 코드를 써서 실행"하는 방식의 차이를 잘 보여줍니다. browser-use는 라이브러리에서 전자를, CLI에서 후자를 쓰는데, CLI는 이제 browser-harness 위에 얹혀 있습니다.
도구
 | HEAD / 라이선스
 | 코드 규모
 | 방식
 | 결정 주체
 | 
browser-use 라이브러리
 | aa093a8(10-17) / MIT
 | Python 약 68.8k줄
 | 도구 호출(스텝당 액션 최대 5개)
 | 내장 LLM 루프
 | 
browser-harness (= browser-use CLI)
 | c6a9412(10-17) / MIT
 | Python 약 6.7k줄
 | 코드 실행(Python을 stdin으로 exec)
 | 호스트 에이전트
 | 
dev-browser
 | e5d746f(10-18) / MIT
 | TS 약 8.3k줄
 | 코드 실행(Puppeteer JS를 node:vm에서)
 | 호스트 에이전트
 | 
chrome-cdp-skill
 | ffea76a(06-28) / MIT
 | 단일 파일 882줄
 | 도구 호출(명령 14개, eval로 코드 탈출구)
 | 호스트 에이전트
 | 
### browser-use 라이브러리
Playwright가 아니라 자사 래퍼 cdp-use로 CDP에 직접 붙습니다. 스텝마다 DOMSnapshot·DOM.getDocument·AX 트리를 합쳐 인터랙티브 요소에 [index] 번호를 붙이고, 새로 생긴 요소는 *[로 표시합니다. 클릭 가능 판정은 JS 클릭 리스너 감지와 레이아웃을 씁니다. 가려진 요소(paint order)와 부모 bbox에 99% 포함된 자식을 제거합니다.
스크린샷은 기본으로 함께 보냅니다(use_vision=True). DOM 구성과 병렬로 찍습니다.
LLM 호출은 스텝당 1회에 extract 액션, 이력 압축(25스텝·4만 자 조건), 완료 후 판정기 1회가 더해집니다. 과거 스텝의 DOM·스크린샷은 쌓지 않고 텍스트 요약만 남깁니다.
한 스텝의 액션 여러 개 중 URL이나 포커스가 바뀌면 나머지를 버립니다. allowed_domains(이동 전후 검사), sensitive_data 플레이스홀더, 액션별 도메인 필터가 있습니다. 기본은 도메인 제한 없음입니다.
자체 모델 bu-2-0은 자사 게이트웨이를 거치고, 오픈 웨이트 bu-30b-a3b-preview는 vLLM으로 자체 호스팅합니다. 저장소의 벤치마크 이미지에는 bu-2-0이 없어 성능 근거는 미확인입니다.
### browser-harness
사용자 Chrome에 CDP WebSocket 하나로 붙는 데몬과, 호출마다 뜨는 CLI 프로세스가 Unix 소켓으로 통신합니다. 하네스에는 페이지 표현도 LLM도 없고, 에이전트가 AX 트리·js()·스크린샷을 골라 씁니다.
자기 확장: agent_helpers.py를 importlib로 로드해 전역에 덮어씁니다. 코어 헬퍼 덮어쓰기 보호는 없고, MCP 래퍼(23개 도구)에는 추가 헬퍼가 노출되지 않습니다. domain-skills/는 사이트별 마크다운 노트 151개이고 BH_DOMAIN_SKILLS=1일 때만 켜집니다.
에이전트가 쓴 코드는 exec(code, globals())로 샌드박스 없이 실행됩니다.
텔레메트리 주의: 기본 켜짐(PostHog EU)이고, CLI 이벤트가 스크립트 본문과 출력 끝 2만 자를 보낼 수 있는 것으로 코드에서 읽혔습니다(실제 전송은 미확인). BH_TELEMETRY=0로 끕니다.
자체 비교(BU Bench V2.1 100과제, Codex 호스트, 1회): 루브릭 점수 browser-harness 60.4, Playwright MCP 60.0, Chrome DevTools MCP 61.0, agent-browser 56.3. 저자 스스로 "점수로 이기는 도구는 없다"고 결론내고, 입력 토큰 중앙값은 2.1M으로 가장 적었습니다.
### dev-browser
웜 데몬에 스크립트를 보내면 acorn으로 변환해 새 vm 컨텍스트에서 실행합니다. 스크립트가 받는 Page는 실행 단위 Proxy(RunGate)라, 실행이 끝나면 이후 호출과 리스너·타이머가 정리됩니다.
node:vm은 보안 경계가 아니라고 README가 명시합니다. 격리가 아니라 실행 단위 정리가 목적입니다.
스냅샷은 AX YAML + ref(e12)이고, track 옵션으로 이전 스냅샷 대비 diff를 돌려줍니다. 이름 있는 탭은 파일에 저장돼 데몬이 재시작돼도 이어집니다.
사용자 기본 프로필에는 붙지 않고 전용 프로필을 씁니다. 자체 측정 지연은 빈 스크립트 약 13ms, 스냅샷 약 18ms, 콜드 스타트 약 280ms입니다.
### chrome-cdp-skill
사용자 실제 Chrome 프로필의 DevToolsActivePort 파일에서 WebSocket 주소를 얻습니다. 탭마다 데몬 하나가 브라우저 연결을 잡고 있어, Chrome의 "디버깅 허용" 프롬프트가 탭당 한 번만 뜹니다.
ref가 없고 CSS 셀렉터나 좌표로 클릭합니다. click은 el.click()이라 isTrusted가 아닙니다. 테스트가 없고 데몬 소켓에 인증이 없습니다.
### 평가
도구 호출 방식(browser-use 라이브러리)은 액션 집합이 닫혀 있어 도메인 제한·비밀 치환·로깅을 코드로 강제하기 쉽지만, 스텝마다 LLM 왕복과 상태 재전송 비용이 듭니다.
코드 실행 방식(browser-harness, dev-browser)은 한 번에 이동·대기·추출·반복을 묶어 왕복과 토큰을 줄이지만, 실행되는 코드가 곱 권한이라 안전장치를 걸 지점이 약합니다. 이 약점을 QuickJS 샌드박스로 보완한 것이 webcmd입니다.
적합: browser-use 라이브러리는 앱에 내장하는 자율 다단계 에이전트, browser-harness는 로그인된 개인 브라우저의 일회성 비정형 작업, dev-browser는 코딩 에이전트의 개발·QA, chrome-cdp-skill은 이미 열린 내 탭을 관찰하는 일회성 작업입니다.
## 접근법 비교
도구를 "누가 결정하나"와 "한 번에 얼마나 묶거나 다시 쓰나" 두 기준으로 나누면 네 갈래가 됩니다. 칸 안의 순서는 점수가 아니고, 어느 칸에 있는지만 의미가 있습니다.
아래 줄(매 단계 명령·판단)은 동작마다 LLM 왕복이 있어 통제는 쉽지만 비용이 단계 수에 비례합니다. 위 줄은 그 비용을 줄이는 두 방법입니다. 왼쪽 위는 한 턴에 여러 동작을 묶고, 오른쪽 위는 한 번 찾은 동작을 다음 실행에서 LLM 없이 재생합니다.
비교 항목
 | 호스트가 스크립트 작성
 | 재생·코드화
 | 
줄어드는 것
 | 턴 수 (webcmd 평균 9.8턴 vs agent-browser 25.5턴, 자체 측정)
 | 다음 실행의 LLM 호출 (Stagehand act(Action)은 0회)
 | 
기억의 형태
 | 마크다운 사이트 지식(webcmd, harness domain-skills)
 | XPath·셀렉터·스크립트
 | 
UI 변경에
 | 유연(매번 판단)
 | 재생 실패 → LLM 폴백
 | 
안전장치를 걸 자리
 | 스크립트 실행 환경(QuickJS는 격리, vm·exec는 비격리)
 | 닫힌 액션 집합, 도메인 정책
 | 
페이지 표현 방식은 이 구분과 별개로, 접근성 트리 + ref가 대부분입니다. 예외는 DOM 인덱스 + 스크린샷(browser-use, Skyvern)과 코드가 만든 후보 표(jev-ultrafast), 그리고 표현을 호스트에 맡기는 browser-harness입니다.
## 작업별 선택 가이드
코딩 에이전트에 붙이는 기본값은 Playwright CLI·MCP 또는 agent-browser이고, 아래 시나리오에서만 다른 도구가 나은 선택이 됩니다.
시나리오
 | 선택
 | 이유
 | 
내 앱 E2E 테스트 작성·재현
 | Playwright CLI/MCP
 | 실행한 동작이 Playwright 코드로 나오고 auto-wait가 있음. 크로스 브라우저
 | 
내 앱 성능·메모리·콘솔 진단
 | Chrome DevTools MCP
 | 트레이스 Insight, 힙 스냅샷 14개 도구, 소스맵 스택. 다른 도구에 없음
 | 
빠른 일반 웹 조작, 토큰 절약
 | agent-browser
 | 영구 ref, --delta, 작은 응답. 대신 동작 후 확인을 직접 해야 함
 | 
격리된 실행 + 도메인 제한
 | agent-browser --allowed-domains
 | Fetch 가로채기 + WebSocket·Worker 차단까지. 기존 브라우저와는 불가
 | 
로그인된 내 Chrome에서 일회성 작업
 | browser-harness 또는 Playwright attach --extension
 | 실제 세션 사용. harness는 텔레메트리를 꺼야 함
 | 
여러 단계를 한 번에 묶어 턴 줄이기
 | webcmd browser run 또는 dev-browser
 | 스크립트 한 덩어리가 한 왕복. 격리가 필요하면 webcmd(QuickJS)
 | 
같은 사이트를 자주 쓰는 리서치
 | webcmd
 | 사이트 지식이 날짜 증거와 함께 쌓임
 | 
대량 페이지 텍스트 수집, 적은 메모리
 | Lightpanda
 | 렌더링 없는 엔진, 마크다운·시맨틱 트리 출력. 레이아웃 의존 사이트는 Chrome으로
 | 
제품에 브라우저 자동화 내장
 | Stagehand(Browserbase 사용 시), browser-use 라이브러리
 | 스크립트 안에서 필요한 단계만 act. 자율 루프가 필요하면 browser-use
 | 
로그인·2FA 폼 업무를 반복 자동화
 | Skyvern
 | 워크플로·스크립트 코드화, 자격증명 볼트, TOTP. 서버 운영 부담 있음
 | 
정해진 폼·필터 조작을 낮은 지연으로
 | jev-ultrafast(실험)
 | 단계당 수백 ms 분류. 범위가 좁고 대기자 명단 API
 | 
탐지가 강한 사이트의 일회성 작업
 | scout + Outcrawl 클라우드, 또는 클라우드 브라우저
 | 차별점이 인프라에 있음. 약관 검토 필요
 | 
직접 하네스를 설계한다면 참고할 만한 구조는 다섯 가지입니다. agent-browser의 문서 단위 영구 ref와 delta, jev-ultrafast의 "코드 소유 후보 표 + 확률 검증", webcmd의 QuickJS 격리와 2일 증거 승격, dev-browser의 실행 단위 게이트(RunGate), Lightpanda의 $LP_* 비밀 치환과 세션 녹화→재생입니다.
## 한계와 출처
저장소 코드는 실행하지 않았습니다. "코드에서 읽혔다"는 내용(Playwright 암묵 스냅샷의 파일 저장, agent-browser 정책 fail-open, browser-harness 텔레메트리 전송 내용)은 실제 동작을 확인하지 않았습니다.
모두 --depth 1 클론이라 커밋 이력은 webcmd·scout를 제외하면 보지 못했습니다.
Skyvern(본체 51만 줄)과 Lightpanda(27만 줄)는 핵심 경로만 직접 읽고 나머지는 파일명·주석·grep으로 판단했습니다.
성능 수치는 대부분 자체 측정이고, Checkly·Ranger 수치는 요약을 거쳐 얻은 값이라 인용 전에 원문 확인이 필요합니다.
Lightpanda 비교에 나온 ldm0/moli는 lexmount/moli의 포크이고, ldm0은 lexmount/moli의 주 개발자 계정입니다.
분석한 저장소(2026-10-19 클론):
browserbase/stagehand c6b6f27
lightpanda-io/browser 5d4e1c0
Skyvern-AI/skyvern a4fe637
browser-use/jev-ultrafast 1231850
agentrhq/webcmd 9d8ea44
outcrawlai/scout 8b5dd40
microsoft/playwright b335271, playwright-mcp b8b4183, playwright-cli b85c7a7
vercel-labs/agent-browser dac13bb
ChromeDevTools/chrome-devtools-mcp e342c6e
browser-use/browser-use aa093a8, browser-use/browser-harness c6a9412
sawyerhood/dev-browser e5d746f, pasky/chrome-cdp-skill ffea76a
참고 문서:
Stagehand v4 블로그
Lightpanda 1.0, Lightpanda 벤치마크
TypeSafe: System One models and Jev
Checkly: MCP vs CLI token efficiency (2026-07-30)
Ranger: The hidden cost of fewer tokens (2026-04-03)
