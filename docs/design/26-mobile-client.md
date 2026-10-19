# 26. 모바일 클라이언트

- 작성: 2026-10-12, P15 모바일 (2a단계에 추가된 문서)
- 상태: 2판. 브리프 결정 1~64(§2.4b·§2.4c)과 조정자 판정(`process/rulings-stage2a.md` J-01~J-275)을 따른다. 1판 뒤에 나온 사용자 결정 47(PWA·Web Push), 48(휴대폰 알림 강도), 49(iOS 26, Android 제외), 56(결과 확인 대기 알림 설정), 57(Apple 개발자 프로그램), 59(방해 금지 예외는 휴대폰 푸시만), 60(결과 확인 대기는 데스크톱 배지만), 64(만료 임박 승격 예외)와 판정 J-111·J-115·J-118~J-120·J-124·J-132·J-137·J-139·J-144·J-154·J-166·J-168·J-171~J-173·J-177·J-185·J-189·J-195·J-227·J-238·J-241·J-242·J-248·J-252·J-254를 반영했다. 이름의 정본은 이벤트 09, 레코드·필드 08, 명령 10, 메서드 19, 화면 ID 03, 설정 키 17이다. 이 문서가 새로 제안하는 이름은 §5.2에 해당 문서 요구로 적었다.
- 소유: 휴대폰에서 하는 일의 범위(03 §3.12의 화면 ID를 받아 레이아웃과 상태를 정함), 모바일 연결·인증 적용 방식, 앱이 꺼져 있을 때의 알림 규칙과 푸시 등록 형식(08 Device `push`, 판정 J-71), 모바일 빌드·배포.
- 표시: 브리프 §5.2와 판정 J-144. `[결정 n]`은 사용자 결정, `[제안: 결정 n 기본값]`은 조정자 기본값, `[판정 n]`·`[판정 J-nn]`은 조정자 판정, `[제안]`은 이 문서가 정한 것, `[가정]`은 확인하지 않은 전제. 외부 사실은 `[원문]`(문서·소스를 직접 읽음), `[실험]`(명령을 실행해 확인), `[검색]`(검색 결과 요약으로 확인), `[지식]`(다시 확인하지 않음).
- 출처 줄임말: `homelab/`은 `~/projects/homelab`, `_ref/`는 `~/projects/_ref`, `cases`는 `docs/design/process/sources/pi-cases-notes.md`. 웹 출처의 주소는 §8에 모았다.

## 1. 목적과 범위

### 1.1 목적

사용자는 2026-10-12에 "휴대폰에서도 질문에 답할 수 있어야 한다"를 범위에 넣었고 [결정 42], 같은 날 오후 구현 방식(데몬이 서빙하는 홈 화면 웹 앱과 Web Push) [결정 47], 휴대폰 알림 강도 [결정 48], 최소 판(iOS 26) [결정 49]을 정했다. 모바일은 데스크톱 앱 MVP 다음 단계(01의 2단계)다. 이 문서는 다음을 정해 구현자가 바로 만들 수 있게 한다.

1. 결정 47의 구현 형태: 데몬의 정적 서빙, 쿠키 인증, 페어링, 서비스 워커, 경로 B(Tauri iOS + APNs)로 옮길 조건.
2. 휴대폰이 데몬에 붙는 방법과 백그라운드 제약 아래의 연결·재전송·초안 처리.
3. 앱이 꺼져 있을 때 언제 무엇을 푸시하는가. 내용 숨김, 문구 키, 딥 링크, 알림에서 답까지의 조작 수.
4. 휴대폰 화면(03 §3.12의 `SCR-M-*`)의 레이아웃, 상태, 결정 버튼 활성 조건.
5. 빌드·배포, 테스트와 완료 기준.

### 1.2 휴대폰에서 하는 일 [결정 42 / 범위는 제안]

| 할 일 | 화면 | 근거 |
|---|---|---|
| 질문함을 보고 질문에 답한다(묶음 답하기 포함) | `SCR-M-INBOX`, `SCR-M-QUESTION` | 결정 42의 본래 목적. 02 UC-04 대안 M |
| 권리 게이트를 허락·하지 않기·미루기 한다 | `SCR-M-QUESTION` | 권리 게이트는 사람이 없으면 그 일이 멈춘다(11 §3.8.2). 외출 중 멈춤을 푸는 것이 가장 큰 쓸모다 |
| 작업 합의 확인(이 범위로 맡기기, 넓어진 부분 빼고 맡기기, 맡기지 않기) | `SCR-M-QUESTION` | C/A 사람 조작이 외출 때문에 멈추지 않게 한다(05 §3.4) |
| 결과 확인(산출물을 본 뒤 결과 확인, 수정 요청, 미루기). 큰 산출물과 취향형은 미루기만 | `SCR-M-QUESTION` | [판정 J-37], [판정 J-139] |
| 에이전트가 정한 것에 이의를 건다(이유는 선택) | `SCR-M-AUTO` | 불변조건 7, 결정 8 |
| 복귀 요약 요약판을 읽고 "여기까지 봤음"을 누른다(줄여 본 표시가 붙는다) | `SCR-M-BRIEF` | 04 §3.2, [판정 J-137] |
| 진행 중 작업을 한 줄씩 보고 안전하게 멈춘다 | `SCR-M-WORK` | 05 §3.6.1 |
| 복구 선택에 답한다 | `SCR-M-QUESTION` | 03 §3.12 질문 형식 표, 이름은 [판정 J-115] |
| 안전 모드를 푼다 | `SCR-M-CONNECT` | 안전 모드는 재시작해도 유지되고 모든 에이전트 실행을 멈춘다(17 §3.4.1). 외출 중에도 풀 수 있어야 한다 |
| 알림을 받는다(앱이 꺼져 있어도) | OS 알림 | [결정 47], [결정 48], §3.4 |
| 페어링, 이 기기 권한 없애기, 다른 기기 권한 없애기, 알림 설정 | `SCR-M-ONBOARD`, `SCR-M-CONNECT`, `SCR-M-SETTINGS` | 18 §3.18.2 |

### 1.3 휴대폰에서 하지 않는 일 [제안]

| 하지 않는 일 | 대신 | 이유 |
|---|---|---|
| 자극 보드의 요소 단위 반응, 세 개 비교, 라운드 마치기(`reaction` 형식) | 카드에 "데스크톱에서 답하기"와 미루기(`question.defer`)만 | 요소 고르기는 넓은 화면과 정밀한 지정이 필요하다. 작은 화면의 반응은 대충 고르기로 흐르기 쉽고 원함 탐구의 자료 품질이 떨어진다(결정 1·18). 21 §3.13 규칙 5의 터치 반응은 이번 범위에 넣지 않는다 |
| 고쳐서 허락(`approve_edited`, 인자 편집) | 인자 미리보기는 보이고 "데스크톱에서 고치기" 표시 | 밖으로 나가는 행동의 인자를 작은 화면에서 고쳐 쓰는 실수를 줄인다(03 §3.12) |
| 결과 확인의 조건 붙여 확인·거절·기준이 틀림, 큰 산출물·취향형 결과의 결과 확인 | 같은 표시 + 미루기 | [판정 J-37], [판정 J-139] |
| 새 일 시작, 입력창 지시, 대화 탭, 범위·다이얼·모드·권한 바꾸기 | 없음. 권한(scope)으로도 막는다(§3.3.3 `decideMobile`) | 휴대폰은 답하는 곳이다(03 §3.12 원칙 1) |
| 탐구 화면, 근거 체인 전체 트리, 관찰 제안, 변화 기록, 평가 | 질문 카드 안의 핵심 근거 줄만 | 같은 이유 |
| 새 기기 페어링 코드 만들기 | 없음 | 휴대폰을 잃었을 때 그 휴대폰으로 새 기기를 들여오지 못하게 한다(18 §3.18.2 5번) |
| SSH 경로 | 없음 | 18 §3.18.2 1번, 19 §3.17 |
| 알림 안에서 바로 답하기(알림 동작 단추) | 알림을 누르면 질문 화면이 열린다 | 질문을 읽지 않고 답하는 경로를 만들지 않는다(05 §3.7.5) |
| 백그라운드에서 연결을 유지하거나 내용을 미리 받기 | 앞으로 올 때 다시 붙는다 | iOS가 백그라운드 앱을 곧 멈춘다(§2.3 X-8) |
| Android | 없음 | [결정 49]. 지원·시험 대상이 아니다 |

### 1.4 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 질문 레코드, 게이트, 전달 방식, 알림 강도 계산의 정본 | 11 |
| 접속 상태 값과 부재(away) 파생 함수 | 09(값), 14 §3.13.8(함수), [판정 J-119] |
| 프로토콜 메서드·오류 코드·재전송 규칙, 클라이언트 연결 상태 기계 | 19 |
| 사용자용 연결 상태(`UserConnState`)와 `decisionsAllowed` 정의 | 20 §3.8.9 |
| 기기 토큰 형식, 페어링 코드 규칙, 위협 모델 전체 | 18 |
| 화면 ID와 이름 | 03 (이 문서는 `SCR-M-ONBOARD` 하나를 새로 요구한다) |
| 데스크톱 화면 상세, 질문 카드 필드, 문구 정본 | 04, 05 |
| 설정 키 정본, 릴리스·업그레이드 절차, 설치 점검표 | 17 |
| 토큰 값, 부품 계약 | 21 |
| 테스트 계층과 구현 순서, 기능 플래그 `clients.mobile` | 22, 23 |

### 1.5 관련 유즈케이스

| 유즈케이스 | 이 문서의 몫 |
|---|---|
| UC-04 대안 M (외부에서 질문에 답하기, 휴대폰) | §3.7.1 시퀀스, AC-04-09의 세부 기준(§6) |
| UC-05 (혼자 정한 결정에 이의) | `SCR-M-AUTO`, §3.5.6 |
| UC-06 (복귀 요약) | `SCR-M-BRIEF`의 줄여 본 확인(§3.5.5) |
| UC-11 처음 설치·기기 페어링 | §3.3.4 휴대폰 페어링 |
| UC-17 대안 A0 (기기 이어 하기, 휴대폰) | §3.3.6, §3.4.3 "다른 기기를 쓰는 중이면 푸시를 늦춤" |
| UC-03 단계 7 (밤사이 권리 게이트) | §3.4.3 사람이 없을 때 푸시 |

## 2. 전제와 결정

### 2.1 브리프 결정과 판정에서 오는 전제

| 근거 | 이 문서에 주는 전제 |
|---|---|
| [결정 42] | 휴대폰에서 질문에 답한다. 데스크톱 MVP 다음 단계 |
| [결정 47] | 모바일 클라이언트는 데몬이 서빙하는 홈 화면 웹 앱(PWA)이다. 결정 19("클라이언트는 웹이 아니다")는 데스크톱에 적용한다. 알림은 Web Push(VAPID). 경로 B(Tauri iOS + APNs)는 열어 둔다 |
| [결정 48] | 휴대폰 알림은 알림 강도 `interrupt`와 `notice` 질문까지 보낸다 |
| [결정 49] | 모바일 최소 판은 iOS 26. Android는 지원·시험 대상에서 뺀다 |
| [결정 14], [제안: 결정 32 기본값]·[결정 41] | 앱은 얇은 클라이언트다. 사람 결정은 프로토콜의 명령 메서드로만 들어온다. 모바일에도 Helm 로직을 두지 않는다. React 19 |
| [결정 21], [제안: 결정 26 기본값], [판정 46] | 외부 접속은 Windows 호스트의 `tailscale serve`, 데몬은 127.0.0.1. 모든 리스너가 자격 증명을 요구한다. Funnel은 쓰지 않는다 |
| [결정 24] | 혼자 쓰는 앱이다. App Store 배포는 범위 밖이다 |
| [결정 41], [결정 43], [결정 50] | 부품 직접 제작(shadcn 소스 복사 포함), 글래스모피즘, Caustic 토큰 복사. 모바일도 같은 토큰·부품을 쓴다 |
| [판정 J-02] | 연결이 없을 때 결정 입력은 막고 초안으로 보존한다. 응답 전에 끊긴 명령만 같은 멱등 키로 다시 보낸다 |
| [판정 J-03] | 알림 내용은 기본 숨김, 설정으로 켠다 |
| [판정 J-31] | 알림 문구는 문구 키로 저장하고 앱이 `@helm/ui-language`로 문장을 만든다 |
| [판정 J-71] | 푸시 토큰 원문은 운영 테이블에(09 `push_tokens`), Device에는 해시 |
| [판정 J-111] | 이의 메서드는 `objection.file` |
| [판정 J-115] | 화면 이름 "복구 선택", "읽기 전용" |
| [판정 J-118], [판정 J-119] | 18·19는 26을 따른다(쿠키 토큰, Web Push, `locked` 미전송). 접속 상태 저장 값은 09의 `active`/`idle`/`hidden`/`offline`, 부재는 14 §3.13.8 파생 함수, 기기 종류별 문턱은 그 함수의 입력. `locked`는 뺀다 |
| [판정 J-120] | 가정 확정 뒤 도착한 답은 3008로 거부하고 응답에 확정 값과 "이의로 보내기"를 싣는다 |
| [판정 J-124] | 합의 확정·결과 확인은 19 전용 메서드(`agreement.confirm`, `result.accept`)로 보낸다 |
| [판정 J-132] | 막지 않는 권리 게이트는 다음 작업 경계 또는 검토 창에 전달하고, 휴대폰 푸시는 결정 48을 따른다 |
| [판정 J-137] | 휴대폰의 복귀 요약 확인에 `compact: true`를 싣고, 줄여 본 반대 근거·이견 항목은 다음 데스크톱 요약에 남긴다 |
| [판정 J-139] | 휴대폰 결과 확인은 산출물을 연 뒤에만 받는다. 큰 산출물과 취향형은 데스크톱 전용, 휴대폰은 미루기 |
| [판정 J-82] | 브라우저 전송의 bearer 하위 프로토콜 수용 여부는 18이 정한다(18 §3.4.4: 받지 않는다). 26의 전송 경로는 쿠키 하나다. 23 SP-15 스파이크가 실패하면 사용자 결정으로 올린다(§7.2 MQ-04, [판정 J-241]) |
| [판정 J-154] | `publicOrigin`은 데몬의 공개 주소 하나다(17). `auth.allowedOrigins`는 받는 Origin 목록이고 기본값은 `[publicOrigin]`이다. `mobile.origin`은 쓰지 않는다 |
| [판정 J-166], [판정 J-227] | 방해 금지는 의미 설정 `attention.snoozeUntil`이다(`settings.update`). 휴대폰은 `settings.update`로 `notifications` 섹션과 `attention.quietHours`만 바꾼다(19) |
| [판정 J-168] | 쿠키 판정 함수는 19 정본 `cookieAuth`다 |
| [판정 J-171] | 시간당 알림 상한은 사람 기준 하나, `attention.interruptsPerHour`(14 기본 2, 모든 기기 합)다. 기기별 상한(`push.hourlyCap`)은 두지 않는다 |
| [판정 J-172] | `notice` 푸시는 모든 데스크톱 기기가 부재(14 `isDeviceAway`)이고 휴대폰이 `active`가 아닐 때만 보낸다. "연결 기기 없음" 조건은 쓰지 않는다 |
| [판정 J-173] | 휴대폰이 `active`가 되는 것은 `user_return`이 아니다. `user_return`은 데스크톱·TUI 기기의 복귀뿐이다(11·14) |
| [판정 J-177] | `question.delegate` 버튼 문구는 "에이전트가 정하게 두기"다("이 범위로 맡기기"와 구분한다) |
| [판정 J-185] | presence 타입 이름은 11의 `PresenceSnapshot`이다 |
| [결정 56], [판정 J-189] | 결과 확인 대기 알림은 의미 설정 `notifications.resultReview`(`none`·`daily_digest`·`immediate`, 기본 `none`)로 고른다. 묶음 시각은 `notifications.resultReviewDigestAt`(기본 19:00, 서버 시간대)이다 |
| [결정 59] | 방해 금지 예외(`notifications.dndException`)는 휴대폰 푸시에만 적용한다. 방해 금지 중에는 데스크톱 OS 알림을 띄우지 않는다(예외 값과 관계없이) |
| [결정 60] | 결과 확인 대기는 데스크톱에서 배지로만 알린다. 데스크톱 OS 알림은 `notifications.resultReview`가 `immediate`일 때만 띄운다 |
| [결정 64] | 막지 않는 권리 게이트도 만료가 임박하면 `interrupt`로 올린다. 그 밖의 막지 않는 권리 질문은 다음 작업 경계에 전달한다 |

### 2.2 운영 환경 사실

| 사실 | 확인 |
|---|---|
| iPhone과 iPad가 tailnet에 있고 Tailscale 앱이 깔려 있다. 용도는 열람·입력·사진(OpenCloud, Obsidian, Moonlight) | [원문 `homelab/context/machines.md` 기기 표] |
| tailnet 이름은 `tail7ad0b4.ts.net`, 서버 노드는 Windows 호스트(`tag:server`). serve는 8443~8447을 쓰고 Helm은 8448(→ 127.0.0.1:7840)을 쓴다. 모두 같은 호스트 이름 `server.tail7ad0b4.ts.net`의 다른 포트다 | [원문 `homelab/context/network.md`], 판정 §2 |
| `tailscale serve`의 HTTPS는 ts.net 인증서로 끝난다. 휴대폰 Safari가 신뢰하는 공인 인증서다 | [지식] 홈랩의 다른 serve 서비스를 iPhone 앱이 이미 쓰고 있다 |
| Mac(`user-macbookpro`)은 iOS 빌드 노드다(경로 B에서만 쓴다) | [원문 `homelab/context/machines.md`] |
| Apple 개발자 프로그램은 지금 없다고 본다(만료 추정)[결정 57] | 경로 B에서만 필요하다(§7.1 U-1) |
| 홈랩 경보 스크립트는 `NTFY_URL`이 있으면 ntfy로 보낸다. 예시 값은 공개 `https://ntfy.sh/<topic>`이고, 지금 비밀 저장소에 그 키가 없다 | [원문 `homelab/scripts/alert`, `homelab/.env.example`], [실험 `secrets ls -i ntfy`: 해당 키 없음] |

### 2.3 외부 사실 (iOS와 푸시)

| ID | 사실 | 확인 |
|---|---|---|
| X-1 | 무료 Apple ID(Personal Team)로 서명한 앱의 프로비저닝 프로파일은 7일 뒤 만료되고, 만료되면 앱이 실행되지 않는다 | [검색: Apple 개발자 포럼, mybyways 블로그] |
| X-2 | Personal Team은 Push Notifications capability와 TestFlight를 쓸 수 없다 | [검색: Apple 개발자 포럼, Microsoft Xamarin 무료 프로비저닝 문서] |
| X-3 | 유료 개발자 프로그램은 프로파일이 1년이다. TestFlight 내부 테스트는 심사 없이 설치할 수 있고 빌드는 업로드 뒤 90일에 만료된다 | [검색: Expo 문서, TestFlight 안내 글] |
| X-4 | 홈 화면에 추가한 웹 앱(manifest `display: standalone`)은 Web Push를 받는다. 권한 요청은 사용자의 직접 조작 뒤에만 된다. Apple 개발자 프로그램 가입이 필요 없다. 서버 쪽은 `*.push.apple.com`으로 보낼 수 있어야 한다. 배지 API(`setAppBadge`)를 지원하고 집중 모드와 연동된다. manifest `id`로 설치본을 구분한다 | [원문: WebKit 블로그 "Web Push for Web Apps on iOS and iPadOS"(16.4 발표)] |
| X-5 | Declarative Web Push(iOS 18.4부터, 따라서 iOS 26에 있음): 메시지 JSON에 `"web_push": 8030`과 `notification.title`, `notification.navigate`가 필수다. 서비스 워커가 있으면 그 내용을 바꿔 띄울 수 있고, 서비스 워커가 제때 띄우지 못하면 선언된 알림이 대신 뜬다. 구독은 `userVisibleOnly: true`라 조용한 푸시는 없다 | [원문: WebKit 블로그 "Meet Declarative Web Push"] |
| X-6 | 홈 화면 웹 앱은 Safari와 따로 사용일을 센다. iOS 17부터 저장 할당이 디스크 비율로 커졌다. 다만 저장 공간이 부족하거나 오래 쓰지 않으면 지워질 수 있다 | [검색: WebKit 저장 정책 글, 관련 버그 보고]. 완전한 면제는 확인하지 못했다 |
| X-7 | 홈 화면 웹 앱은 Safari와 저장소(쿠키·IndexedDB)를 나눠 쓰지 않는다 | [지식]. §6.2 M-02에서 확인 |
| X-8 | iOS는 백그라운드로 간 앱을 곧 멈추고, 그 앱의 네트워크 연결도 함께 끊긴다. 권장 방식은 백그라운드에서 닫고 포그라운드에서 다시 붙고 푸시로 깨우는 것이다 | [검색: Apple 개발자 포럼의 DTS 답변] |
| X-9 | 자체 호스팅 ntfy를 iOS에서 바로 받으려면 서버가 공개 `ntfy.sh`로 메시지 ID(`X-Poll-ID`)와 토픽 URL의 SHA-256을 보내야 한다. 본문은 "New message"로 고정이고 휴대폰 앱이 자체 서버에서 실제 내용을 가져온다 | [원문: docs.ntfy.sh 설정 문서 "iOS instant notifications"] |
| X-10 | Tauri 공식 notification 플러그인은 로컬 알림만 다룬다. 원격 푸시는 커뮤니티 플러그인(`tauri-plugin-notifications`의 `push-notifications` 기능)이 있다 | [원문: GitHub README], [검색] |
| X-11 | `apple-native-keyring-store` 1.0.2는 iOS의 protected data 키체인을 지원한다 | [원문: docs.rs] |
| X-12 | Tailscale iOS 앱의 VPN On Demand는 Wi-Fi·셀룰러별 규칙과 "`*.ts.net` 요청이 있으면 연결" 규칙을 둔다. 후자는 인터페이스 규칙이 "Do Nothing"일 때만 쓸 수 있다 | [검색: Tailscale KB 1291] |
| X-13 | OpenClaw는 웹 Control UI에 Web Push(VAPID, `web-push` 3.6.7)를 쓴다. iOS 공식 빌드의 APNs 중계는 직접 빌드한 앱이 쓸 수 없고, 직접 빌드는 Gateway에 APNs 키가 필요하다 | [원문 `_ref/openclaw/docs/platforms/ios.md:601-678`, cases L411·L476] |
| X-14 | Paseo는 앱이 포그라운드로 돌아오면 3초 프로브로 연결을 확인한다 | [원문 cases L264] |
| X-15 | npm `web-push` 최신은 3.6.7(2024-01 갱신), `vite-plugin-pwa` 2.0.0은 peer `vite ^8`을 받는다, `idb` 8.0.4 | [실험: `npm view`, 2026-10-12] |
| X-16 | 쿠키는 포트를 구분하지 않는다. 같은 호스트의 다른 포트 서비스로도 실리고, 그 서비스가 같은 이름의 쿠키를 설정할 수 있다. 같은 호스트의 다른 포트는 same-site라 `SameSite=Strict`가 막지 않는다 | [지식], RFC 6265 §8.5 |

### 2.4 이 문서의 주요 결정

| ID | 결정 | 표시 | 절 |
|---|---|---|---|
| MOB-D01 | 모바일은 데몬이 `tailnet` 리스너의 `/m/` 경로로 서빙하는 PWA다. React 19 + Vite, 데스크톱과 같은 `@helm/client`·`@helm/client-react`·`@helm/ui`·`@helm/ui-tokens`·`@helm/ui-language`를 쓴다. 사용자는 Safari에서 "홈 화면에 추가"로 설치한다 | [결정 47]. 서빙 경로·패키지 구성은 [제안] | §3.1, §3.3.2 |
| MOB-D02 | 앱이 꺼져 있을 때의 알림은 Web Push(RFC 8030·8291·8292, VAPID)다. 데몬이 Apple 푸시 서비스로 직접 보낸다 | [결정 47]. 송신 규칙은 [제안] | §3.4 |
| MOB-D03 | 모바일 기기 토큰은 `__Host-helm_dt` HttpOnly 쿠키로 나른다. 스크립트는 토큰을 읽지 못한다 | [제안], [판정 J-118] | §3.3.3 |
| MOB-D04 | 앱이 숨겨지면 연결을 1000으로 닫고 위치만 저장한다. 다시 보이면 백오프를 무시하고 바로 붙는다(19 `retryNow()`) | [제안] | §3.3.5 |
| MOB-D05 | 푸시는 11이 계산한 강도가 `interrupt` 또는 `notice`인 전달에 보낸다. 어떤 기기든 `active`면 보내지 않는다. `interrupt`는 연결된 기기가 있으면 60초 뒤 아직 열람이 없을 때 보낸다. `notice`는 모든 데스크톱 기기가 부재(14 `isDeviceAway`)이고 휴대폰이 `active`가 아닐 때만 보낸다. 시간당 상한은 사람 기준 하나다 | [결정 48]. 기기 조건은 [판정 J-171]·[판정 J-172]. 기기별 상한은 두지 않는다 | §3.4.3 |
| MOB-D06 | 푸시 등록 원문은 운영 테이블 `push_tokens`(09)에 두고, 이벤트와 08 Device `push`에는 해시·앞 8자(`tokenHint`)·호스트·설정만 둔다 | [판정 J-71], [판정 J-254] | §3.4.6 |
| MOB-D07 | 데몬은 푸시 payload에 05 §3.7.2의 문구 키와 인자를 늘 싣고(종단 암호화된다), 내용을 보일지는 기기 설정 `notifications.showContent`(기본 꺼짐)로 서비스 워커가 정한다. Declarative 형식이라 서비스 워커가 실패해도 05 `notif.hidden.*` 문구가 뜬다 | [판정 J-03], [판정 J-31], [제안] | §3.4.4, §3.4.5 |
| MOB-D08 | 휴대폰에서 답할 수 있는 질문 형식은 `answer`, `confirm_candidate`, `approve_action`(고쳐서 허락 제외), `result_review`(산출물을 본 뒤 결과 확인·수정 요청, 큰 산출물·취향형 제외), `choose_one`, 복구 선택이다. `reaction`은 데스크톱에서만 답한다 | [제안], [판정 J-139] | §3.5.4 |
| MOB-D09 | presence `locked`는 보내지 않는다. 접속 상태 값은 09의 저장 값을 쓰고 부재는 14의 파생 함수로 계산한다. 휴대폰의 `active` 문턱(2분)을 그 함수에 기기 종류별 입력으로 준다 | [판정 J-119] | §3.3.7 |
| MOB-D10 | 휴대폰은 Mac 없이 서버에서 빌드한다. PWA 묶음은 데몬 릴리스에 들어가 데몬과 같은 판으로 배포된다 | [제안] | §3.6 |
| MOB-D11 | 경로 B(Tauri v2 iOS + APNs 직접)는 Apple 개발자 프로그램이 지금 없으므로 이후에 검토한다[결정 57]. 검토할 때는 가입을 먼저 하고 §3.1.5의 조건을 본다. `push.provider`에 `apns`를 예약한다 | [결정 47](열어 둠), [결정 57], 조건은 [제안] | §3.1.5 |
| MOB-D12 | 지원 기기는 iOS 26 이상의 iPhone·iPad다. Android 경로(FCM 엔드포인트 등)는 두지 않는다 | [결정 49] | §3.1.6 |
| MOB-D13 | 휴대폰 기기는 `decideMobile` scope를 받는다. §3.5.4의 화면이 쓰는 명령만 허용하고 범위·다이얼·모드·새 일·권한 명령은 거부한다 | [제안] | §3.3.3 |
| MOB-D14 | 결과 확인 대기 알림은 설정 `notifications.resultReview`로 고른다. `none`(기본)은 알리지 않고 복귀 요약에서 확인한다. `daily_digest`는 설정 시각에 묶음 푸시 1개를, `immediate`는 결과 확인 질문마다 푸시 1개를 `notice` 강도로 보낸다. 두 경우의 휴대폰 푸시는 방해 금지·시간당 상한·부재 조건을 따른다. 데스크톱은 배지만 달고, 데스크톱 OS 알림은 `immediate`일 때만 띄운다 | [결정 56], [결정 60], [판정 J-189] | §3.4.2, §3.4.3 |

### 2.5 가정

| ID | 가정 | 틀리면 |
|---|---|---|
| AS-M2 | `tailscale serve`가 `Cookie`, `Origin`, `Sec-Fetch-Site` 헤더를 그대로 넘긴다 | §6.2 M-03에서 확인(23 SP-15와 같은 시험). 쿠키가 넘어가지 않으면 23 SP-15 스파이크가 실패한 것이므로 사용자 결정으로 올린다(§7.2 MQ-04) |
| AS-M3 | 홈 화면 웹 앱의 WebSocket 업그레이드 요청에 같은 출처 쿠키가 실린다 | 같음 |
| AS-M4 | 서버가 설정한 HttpOnly 쿠키는 스크립트 저장소의 7일 정리 대상이 아니다 | [지식]. 틀리면 오래 열지 않았을 때 다시 페어링하게 된다. M-09 |
| AS-M5 | 데몬 프로세스는 `*.push.apple.com`으로 HTTPS를 보낼 수 있다(모델 제공자 호출과 같은 바깥 연결) | 18 §3.18.2 9번의 바깥 연결 허용 목록에 넣는다 |
| AS-M6 | Apple 푸시 서비스가 VAPID `sub`에 `https:` URL을 받는다 | `mailto:` 주소를 설정에 넣는다(MQ-07). 사용자 이메일을 기본값으로 쓰지 않는다 |
| AS-M7 | 한 기기에서 Helm 웹 앱 창은 하나다 | 둘이면 같은 진행 중 명령을 두 창이 다시 보낼 수 있다. `navigator.locks`로 연결·재전송을 한 창만 하게 한다(§3.3.5) |
| AS-M8 | iOS 26의 Safari는 `Sec-Fetch-Site`와 `Clear-Site-Data`를 지원한다 | [지식]. 틀리면 GET 쿠키 요청도 Origin을 요구하고(앱이 `fetch`에 `mode: "same-origin"`으로 Origin을 붙이게 함), 로그아웃 때는 앱이 직접 캐시를 지운다 |

## 3. 명세 본문

### 3.1 구현 방식 [결정 47]

#### 3.1.1 후보

| 후보 | 모양 |
|---|---|
| A. Tauri v2 모바일(iOS) | 데스크톱과 같은 Tauri 셸. WKWebView 안의 React SPA + Rust 코어. 전송·키체인은 Rust |
| B. PWA(데몬이 서빙) + Tailscale | 데몬이 `/m/`로 정적 묶음을 내보내고, 사용자가 Safari에서 홈 화면에 추가한다. 브라우저 WebSocket으로 같은 프로토콜을 쓴다 |
| C. React Native(Expo) | 네이티브 UI. TS 코어는 함께 쓰고 화면 부품은 새로 만든다 |
| D. 네이티브 Swift(SwiftUI) | 프로토콜 코어와 화면을 Swift로 다시 만든다 |

#### 3.1.2 비교 (결정 47의 배경)

| 기준 | A. Tauri v2 모바일 | B. PWA | C. React Native | D. Swift |
|---|---|---|---|---|
| 데스크톱과 코드 공유 | 높음. SPA·부품·`@helm/client`·Rust 전송을 그대로 쓴다 | 높음. SPA·부품·`@helm/client`(`./browser` 전송)를 쓴다 | 중간. 코어·문구는 공유, 화면 부품은 다시 만든다 | 낮음 |
| App Store 없이 iPhone 설치 | 무료 계정: 7일마다 Mac에서 다시 설치(X-1). 유료: 1년 프로파일 또는 TestFlight 90일(X-3) | Safari "홈 화면에 추가". 계정·만료 없음 | A와 같음 | A와 같음 |
| 앱이 꺼져 있을 때 푸시 | APNs. 유료 계정 필요(X-2) | Web Push. 계정 필요 없음(X-4) | APNs, 유료 계정 필요 | APNs, 유료 계정 필요 |
| 토큰 보관 | iOS 키체인(X-11) | HttpOnly 쿠키(MOB-D03) | 키체인 | 키체인(Secure Enclave 가능) |
| 백그라운드 연결 | 불가(X-8) | 불가 | 불가 | 불가 |
| 앱–데몬 판 맞춤 | 앱을 따로 갱신해야 한다 | 데몬과 같은 릴리스로 내려오므로 항상 맞다 | A와 같음 | A와 같음 |
| 빌드 위치 | Mac | 서버(WSL)만 | Mac | Mac |
| 데몬 쪽 추가 | APNs 송신기, .p8 비밀 | 정적 서빙, 쿠키 인증, Web Push 송신기, VAPID 비밀 | APNs | APNs |
| 보안 표면 | 웹뷰에 원격 콘텐츠 없음 | 데몬이 웹 출처가 된다: CSP, Origin 검사, 쿠키 규칙, `/files/*` 격리가 필요하다 | 작음 | 작음 |

#### 3.1.3 App Store 없이 iPhone에 설치하는 경로

| 경로 | 필요한 것 | 만료 | 푸시 | 쓰임 |
|---|---|---|---|---|
| 홈 화면 웹 앱(PWA) | iOS 26 이상 [결정 49], Safari | 없음 | Web Push(X-4) | **1차 [결정 47]** |
| Xcode + 유료 개발자 프로그램(개발 프로파일) | 연 99 USD, 기기 UDID 등록 | 1년 | APNs | 경로 B |
| TestFlight 내부 테스트 | 유료 계정, App Store Connect 업로드 | 빌드 90일 | APNs | 경로 B의 대안 |
| Xcode + 무료 Apple ID, AltStore·SideStore | Mac, 주기적 재서명 | 7일 | 불가(X-2) | 쓰지 않는다 |

#### 3.1.4 PWA를 쓸 때 받아들이는 약점과 대응 [제안]

결정 47을 정한 근거는 1판의 비교(§3.1.2)다: 계정·만료 없이 푸시를 받고, 데스크톱과 화면 코드를 공유하며, 데몬과 같은 판으로 배포되고, Mac 없이 빌드한다. 남는 약점과 대응은 다음과 같다.

| 약점 | 대응 |
|---|---|
| 토큰을 하드웨어 보호 키나 키체인에 둘 수 없다 | HttpOnly 쿠키로 스크립트가 읽지 못하게 한다(MOB-D03). 노드 묶기(18 D18-02), 기기 권한 없애기, 휴대폰 잠금이 남은 방어다 |
| 데몬이 웹 출처가 되어 XSS·CSRF 표면이 생긴다 | 엄격한 CSP(인라인 스크립트 없음), 모델 문장은 글자로만 그림(21, 18 T18-32), 쿠키 요청의 Origin 검사, `/files/*` 응답 격리(§3.3.2), `decideMobile` scope(MOB-D13) |
| 같은 호스트의 다른 홈랩 서비스(8443~8447)로 쿠키가 실리고, 그 서비스가 같은 이름의 쿠키를 덮어쓸 수 있다(X-16) | Origin 정확 일치(포트 포함)로 다른 포트에서 온 요청을 거부한다(T26-07). 남는 위험(다른 서비스 로그에 쿠키가 남을 수 있음, 쿠키 덮어쓰기로 인한 연결 실패)은 §4 MF-31에 기록하고, Helm 전용 serve 호스트 이름을 미결로 둔다(MQ-15) |
| iOS가 웹 앱 저장소를 지울 수 있다(X-6) | 토큰은 쿠키, 위치·뷰 캐시·초안은 다시 받을 수 있는 사본이다. 쿠키까지 지워지면 다시 페어링한다(§4 MF-09) |
| 앱 전환 화면 가리기, 생체 인증 앱 잠금이 어렵다 | §3.3.8. 18 §3.18.2 6번과 다르게 1차는 끔으로 두고 미결로 남긴다(MQ-03) |
| Safari 동작이 바뀔 수 있다 | 경로 B를 열어 둔다(MOB-D11) |

데스크톱 UI를 데몬이 서빙하지 않는다는 20 ADR-20-04는 데스크톱의 이유(오프라인 시작, 원격 출처에 IPC 권한, SSH 경로)에 근거한다. 모바일 PWA에는 IPC가 없고 SSH 경로가 없으며 오프라인 시작은 서비스 워커 캐시가 맡는다(§3.6.4). 결정 47이 결정 19의 적용 범위를 데스크톱으로 좁혔다.

#### 3.1.5 경로 B로 바꾸는 조건 [제안]

Apple 개발자 프로그램이 지금 없으므로[결정 57] 경로 B는 이후에 검토한다. 다음 중 하나가 생기면 유료 프로그램 가입을 포함해 Tauri v2 iOS 앱 + APNs 직접 송신을 다시 본다.

1. 2주 사용에서 Web Push가 전달된 질문의 5% 넘게 뜨지 않는다(16이 `push.sent`와 열람을 대조해 잰다).
2. 한 달에 한 번 넘게 쿠키·저장소가 지워져 다시 페어링한다.
3. Safari가 홈 화면 웹 앱의 Web Push나 WebSocket을 막는 변경을 낸다.
4. 사용자가 알림 동작 단추, 잠금 화면 위젯처럼 네이티브에만 있는 기능을 원한다(05 §3.7.5의 원칙은 그대로).

경로 B의 모양: `apps/mobile`의 SPA를 그대로 Tauri iOS 셸(`apps/mobile/src-tauri`)에 넣고, 데스크톱의 Rust 전송과 `secrets.rs`(iOS protected store, X-11)를 다시 쓴다. 토큰은 키체인(18 §3.18.2 3번)에 두고 `Authorization` 헤더로 보낸다. 푸시는 `tauri-plugin-notifications`의 `push-notifications` 기능(X-10)으로 APNs 토큰을 받아 `device.registerPush { channel: "apns" }`로 등록한다. 데몬은 APNs HTTP/2 API로 직접 보낸다(비밀 `HELM_APNS_KEY_P8`, `HELM_APNS_KEY_ID`, `HELM_APNS_TEAM_ID`, `HELM_APNS_TOPIC`). 화면·문구·푸시 payload의 `helm` 부분은 같다. 빌드는 `run-on mac`으로 `tauri ios build`, 설치는 개발 프로파일(1년) 또는 TestFlight 내부 테스트다.

#### 3.1.6 지원 기기 [결정 49]

- iOS 26 이상의 iPhone. iPadOS 26 이상의 iPad도 같은 PWA다. iPad는 너비 768px 이상에서 질문함 목록과 질문을 두 칸으로 보인다(§3.5.1). 별도 화면을 만들지 않는다.
- Android는 지원·시험 대상이 아니다. 데몬의 엔드포인트 허용 목록에 Android 푸시 서비스 호스트를 넣지 않는다(§3.4.6).
- iOS 26 미만에서 열면 설치 안내 화면에 "이 iOS 판은 지원하지 않습니다. iOS 26 이상으로 올리세요."를 보이고 페어링 칸을 보이지 않는다.

### 3.2 전체 구조

```text
┌──────────────────────── iPhone (iOS 26+) ─────────────────────┐
│ Tailscale 앱 (VPN On Demand 권장)                               │
│ 홈 화면 웹 앱 "Helm" (출처 https://server.tail7ad0b4.ts.net:8448) │
│   React 19 SPA (/m/)  ── @helm/ui · @helm/ui-tokens             │
│     @helm/client-react: 뷰 캐시(IndexedDB) · 초안 · decisionsAllowed │
│     @helm/client (HelmClient) ── @helm/client/browser 전송       │
│   서비스 워커 (/m/sw.js): 앱 껍데기 캐시 · push · notificationclick │
│   쿠키 __Host-helm_dt (HttpOnly, 스크립트가 읽지 못함)            │
└───────────┬───────────────────────────────▲───────────────────┘
            │ WSS /rpc, HTTPS /m/*, /files/* │ Web Push (암호화, RFC 8291)
            ▼                                │
  Windows 호스트 tailscale serve :8448       Apple 푸시 서비스 (*.push.apple.com)
            │                                ▲
            ▼                                │ HTTPS POST (VAPID)
  WSL helmd `tailnet` 리스너 127.0.0.1:7840 ─┘
     정적 /m/ (릴리스의 web/mobile) · 쿠키 인증 · /rpc · 푸시 송신기(daemon/push)
```

#### 3.2.1 패키지와 폴더 [제안]

| 층 | 패키지 | 모바일이 쓰는가 | 비고 |
|---|---|---|---|
| 프로토콜 | `@helm/protocol` | 씀 | 푸시 payload 타입 `src/push.ts`를 여기에 둔다 |
| 클라이언트 코어 | `@helm/client` (`.`, `./browser`) | 씀 | `./browser` 전송에 쿠키 방식(토큰 인자 없음)을 더한다(19에 요구) |
| React 연결 | `@helm/client-react` | 씀 | 20 §3.14의 `PlatformAdapter`를 모바일이 구현한다. `UserConnState`·`decisionsAllowed`는 20이 정의하고 이 패키지에 있다 |
| 문구 | `@helm/ui-language` | 씀 | 앱과 서비스 워커가 함께 쓴다 |
| 토큰·부품 | `@helm/ui-tokens`, `@helm/ui` | 씀 | 21 §3.13 |
| 앱 | `apps/mobile` = `@helm/mobile` | - | 06이 자리를 둔 이름을 확정한다 |

```text
apps/mobile/
  index.html                       viewport-fit=cover, lang="ko"
  vite.config.ts                   base '/m/', vite-plugin-pwa(injectManifest)
  public/manifest.webmanifest      id "/m/", name "Helm", start_url /m/, scope /m/, display standalone, icons
  public/icons/                    180·192·512 png (생성 스크립트로 만든다)
  src/main.tsx                     진입, 서비스 워커 등록
  src/app/routes.tsx               §3.5.2 경로
  src/screens/                     MobileInbox, MobileQuestion, MobileOutputViewer, MobileBrief, MobileAuto,
                                   MobileWork, MobileConnect, MobileSettings, MobileOnboard (.tsx)
  src/screens/decide.ts            휴대폰 결정 가능 판정(§3.5.11)
  src/shell/                       MobileShell, InstallGuide, CoverOnHide (.tsx)
  src/platform/pwa/                adapter.ts(PlatformAdapter), transport.ts, credential.ts(whoami·pair·logout),
                                   push.ts(구독·등록·지문 비교), lifecycle.ts(보임·숨김·입력·창 잠금), probe.ts(/healthz), settings.ts
  src/sw/sw.ts                     서비스 워커: precache, push, notificationclick
  src/sw/notify.ts                 payload 검증과 알림 문구 만들기(순수 함수, 시험 대상)
  test/                            단위·컴포넌트 시험, Playwright(WebKit, iPhone 뷰포트) 시나리오
packages/daemon/src/push/          webpush.ts(송신), planner.ts(보낼 대상 계산), store.ts(push_tokens), vapid.ts, endpoint.ts(주소 검사)
packages/daemon/src/http/mobile-static.ts   /m/ 정적 서빙, CSP
packages/daemon/src/http/mobile-auth.ts     /m/pair, /m/whoami, /m/logout, 쿠키 판정
```

의존 규칙(06 §3.5 표에 더할 행): `@helm/mobile`은 `protocol`, `client`, `client-react`, `ui`, `ui-tokens`, `ui-language`, `domain`(타입)만 의존한다. `kernel`·`engine`·`runtime`과 `@tauri-apps/*`를 쓰지 않는다. `daemon/push`는 `web-push`(정확한 판 고정)만 새로 쓴다.

### 3.3 연결

#### 3.3.1 경로 [제안]

- 휴대폰은 `tailnet` 리스너만 쓴다. 주소는 17 설정 `[listeners.tailnet].publicOrigin`(기본 `https://server.tail7ad0b4.ts.net:8448`)이고 WebSocket은 `wss://…:8448/rpc`다(19 §3.2.2). 정적 묶음도 같은 출처에서 받으므로 같은 출처 정책 아래에서 쿠키와 서비스 워커가 동작한다. 이 문서에서 "모바일 출처"는 이 `publicOrigin` 값 그대로다.
- 휴대폰의 Tailscale이 꺼져 있으면 서버 이름을 찾지 못한다. 앱은 서비스 워커가 캐시한 껍데기와 IndexedDB의 마지막 뷰를 읽기 전용으로 보이고, §3.5.11의 진단 순서로 "Tailscale 앱에서 연결을 켜세요"를 보인다.
- 권장 설정(설치 안내에 넣는다): Tailscale 앱의 VPN On Demand를 켜고 "`*.ts.net` 요청 시 연결"을 쓴다(X-12). 셀룰러·Wi-Fi 규칙을 "Always"로 두는 것도 된다.
- 푸시를 받는 데는 Tailscale이 필요 없다(Apple 푸시 서비스를 거친다). 알림을 누른 뒤 내용을 받는 데 필요하다.

#### 3.3.2 데몬의 모바일 HTTP 경로 [제안, 19·17·18에 요구]

기능 플래그 `clients.mobile`(23, 기본 꺼짐)이 꺼져 있으면 아래 경로는 모두 404이고 휴대폰 페어링도 받지 않는다.

| 메서드·경로 | 리스너 | 인증 | 응답 |
|---|---|---|---|
| `GET /m/`, `GET /m/<경로>` (확장자 없는 경로) | `tailnet`만 | 전송 조건만(Tailscale 신원 헤더·whois, Host 검사, 18 §3.4.3) | `index.html`, `Cache-Control: no-cache`(갱신 확인용, 18 §3.4.6). 클라이언트 경로(§3.5.2)를 위해 확장자 없는 경로는 모두 `index.html`로 돌린다 |
| `GET /m/assets/<해시 이름>` | `tailnet` | 전송 조건만 | 정적 파일. `Cache-Control: public, max-age=31536000, immutable` |
| `GET /m/sw.js`, `GET /m/manifest.webmanifest` | `tailnet` | 전송 조건만 | `Cache-Control: no-cache`(갱신 확인용) |
| `POST /m/pair` | `tailnet` | 페어링 코드 + 전송 조건 + Origin 일치 | §3.3.3·§3.3.4. 쿠키 설정, 본문에 토큰 없음 |
| `GET /m/whoami` | `tailnet` | 쿠키(§3.3.3 GET 규칙) | `{ serverId, deviceId, deviceName, tokenExpiresAt }` 또는 401 |
| `POST /m/logout` | `tailnet` | Origin 일치 | 쿠키 지우기(`Max-Age=0`)와 `Clear-Site-Data: "cache", "storage"`. 기기 권한은 없애지 않는다 |
| `POST /m/cmd` | `tailnet` | 쿠키 + Origin 일치 | 진행 중 명령 하나를 HTTP로 보낸다(§3.3.5 숨김 직전). 본문은 19 JSON-RPC 명령 요청 하나, 응답은 같은 JSON-RPC 응답. 멱등 키·`basisSeq` 규칙은 WebSocket과 같다. 19가 정한다 |

- 정적 파일 원본은 현재 릴리스의 `web/mobile/`(17 릴리스 폴더 `/srv/volumes/helm/app/releases/<id>/web/mobile/`)다. 데몬은 시작할 때 이 폴더의 파일 목록과 해시를 읽어 메모리 표로 두고, 표에 없는 경로는 404로 끝낸다. 경로 정규화 뒤 `..`·심볼릭 링크로 폴더를 벗어나는 요청은 거부한다. 이 두 규칙은 18 §3.4.6의 인용이다.
- `/m/` 정적 응답의 헤더·캐시·쿠키 조건은 18 §3.4.6이 정본이고, 여기서는 인용한다. 정적 응답은 쿠키를 읽지도 `Set-Cookie`를 붙이지도 않는다(`__Host-helm_dt`가 `Path=/`라 정적 요청에도 실리지만 정적 경로는 그 값을 쓰지 않는다). 아래 헤더 값과 위 표의 `Cache-Control`은 그 인용이다:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' wss://server.tail7ad0b4.ts.net:8448; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

  `connect-src`의 호스트는 `publicOrigin`으로 만든다. 부품이 `style` 속성을 쓰면(Radix 위치 계산 등) `style-src-attr 'unsafe-inline'`만 연다. 인라인 `<style>`·스크립트는 열지 않는다. 쓰는 곳 목록은 21에 요구한다.
- `/files/*`(19 §3.11) 응답의 헤더는 18 §3.4.6이 정본이고 여기서는 인용한다 [판정 J-252]. 모든 `/files/*` 응답에 `Content-Security-Policy: sandbox; default-src 'none'`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: private, no-store`를 붙인다(모바일 출처와 같은 출처에서 실행되지 않게, 폐기 뒤 HTTP 캐시에 남지 않게). 인라인 표시는 허용 목록(`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `text/plain; charset=utf-8`)만이고, 그 밖의 형식은 `Content-Type: application/octet-stream`과 `Content-Disposition: attachment`로 보낸다.
- 정적 경로는 `hello` 전에도 받는다. 묶음에는 비밀이 없다. 19 §3.2.5의 "정적 파일은 서빙하지 않는다"와 19 §3.4.5의 "인증 전 제한", 18 §3.4.3의 업그레이드 전 검사에 이 경로를 예외로 더해 달라고 요구한다(§5.2).
- 개발 데몬(`just daemon-dev`)은 `tailnet` 리스너를 열지 않는다(17 F-35). 실기기 시험은 정식 데몬에서 하고, 개발 중 화면 시험은 가짜 데몬 + 브라우저로 한다(§3.6.2).

#### 3.3.3 인증: 쿠키로 나르는 기기 토큰과 scope [제안, MOB-D03·D13]

18 §3.18.2 4번("PWA를 택하면 토큰을 HttpOnly 쿠키로 바꾸고 CSRF 대책을 둔다")과 판정 J-118을 따른다.

| 항목 | 값 |
|---|---|
| 쿠키 | `__Host-helm_dt=<기기 토큰>; Path=/; Max-Age=<토큰 남은 수명 초>; Secure; HttpOnly; SameSite=Strict`. `__Host-` 접두사는 `Secure`, `Path=/`, `Domain` 없음을 강제한다 [지식] |
| 토큰 | 18 §3.8.1 형식 그대로. 수명·유휴 만료·폐기도 18 그대로 |
| 쿠키를 받는 곳 | `tailnet` 리스너의 `GET /rpc` 업그레이드, `/files/*`, `/m/whoami`, `/m/cmd`. 다른 리스너는 쿠키를 보지 않는다 |
| 쿠키를 받는 기기 | `clientKind: "mobile"`이고 `credentialCarrier: "cookie"`(08 Device)인 기기. 데스크톱 토큰이 쿠키로 오면 `1008`(reason `carrier_mismatch`) |
| 상태를 바꾸는 요청과 업그레이드 | `Origin`이 모바일 출처와 정확히 같아야 한다(스킴·호스트·포트). 없거나 다르면 403(reason `origin_mismatch`). 같은 호스트의 8443~8447에서 온 요청도 403이다(X-16) |
| 쿠키로 인증하는 GET·HEAD | `Origin`이 모바일 출처와 같거나, `Origin`이 없고 `Sec-Fetch-Site: same-origin`이면 받는다. 같은 출처 GET에는 브라우저가 `Origin`을 붙이지 않기 때문이다 [지식] |
| 헤더 경로와의 구분 | `Authorization` 헤더 경로(데스크톱), `POST /pair`, `POST /devices/self/rotate`는 지금처럼 `Origin`이 있으면 403이다. 18 `allowedOrigins`에 넣는 모바일 출처는 쿠키 경로와 `/m/*`에서만 쓴다 |
| `Authorization`와 쿠키가 함께 오면 | 헤더를 쓴다(19 P-03). 쿠키는 무시 |
| 토큰과 자바스크립트 | 페이지 스크립트, 서비스 워커, IndexedDB, 로그 어디에도 토큰이 없다. 스크립트가 가진 것은 `deviceId`, `serverId`(비밀 아님)뿐이다 |
| `/m/pair`가 정하는 값 | 서버가 `clientKind: "mobile"`, `platform: "ios"`, `credentialCarrier: "cookie"`로 정한다. 본문에서는 기기 이름만 받는다 |

업그레이드 판정(18 §3.4.3 `preflight`에 더할 갈래):

```text
cookieAuth(req, listener):                                                 # 19 정본 함수 이름(판정 J-168)
  if listener != tailnet: return notApplicable
  if req.headers.authorization 있음: return notApplicable              # 데스크톱 경로
  tok = cookie(req, "__Host-helm_dt")
  if !tok: return notApplicable                                         # 기존 규칙(토큰 없음 → 401)
  if !sameOriginExact(req.headers.origin, cfg.listeners.tailnet.publicOrigin): → 403 ("origin_mismatch")
  if !matchesFormat(tok): → 401
  conn.bearer = tok; conn.carrier = "cookie"                            # hello에서 helloDeviceAuth가 판정(18 §3.6.1)
helloDeviceAuth 추가 검사: conn.carrier == "cookie"이면 rec.credentialCarrier == "cookie" 아니면 1008 (reason "carrier_mismatch")
```

- `hello`의 `auth.deviceId`: 스크립트는 `localStorage`의 `deviceId`를 쓴다. 없으면(저장소가 지워짐) `GET /m/whoami`로 다시 얻는다. `whoami`가 401이면 페어링 화면으로 간다.
- 서명 증명(18 §3.8.5): 웹 앱은 Secure Enclave 키를 쓸 수 없다. 쿠키 방식에서는 스크립트가 토큰을 꺼낼 수 없으므로, 스크립트 저장소의 키로 서명을 더해도 막는 공격이 거의 늘지 않는다(XSS가 있으면 열린 세션 안에서 같은 일을 할 수 있다). 1차에는 모바일 기기도 `proofRequired: false`로 둔다(MQ-05).

`decideMobile` scope [제안, 18 §3.5·19 §3.4.6에 요구]: 휴대폰 기기는 `read`, `decideMobile`, `devicesLimited`를 받고 `decide`는 받지 않는다. `decideMobile`이 허용하는 명령 메서드는 이 문서의 화면이 쓰는 것뿐이다.

| 메서드 | 쓰는 화면 | 제한 |
|---|---|---|
| `question.answer`, `question.proceedWithAssumption`, `question.defer`, `question.delegate`, `question.requestReframe`, `question.requestInquiry` | `SCR-M-QUESTION` | 11 AnswerValue 중 `approve_edited`는 거부(`scope.forbidden`) |
| `agreement.confirm` | 작업 합의 확인 | `edits`는 "넓어진 부분 빼기"만 |
| `result.accept`(decision `accept`·`request_changes`) | 결과 확인 | 산출물을 연 뒤에만 받는다. `accept_with_conditions`·`reject`·`criteria_wrong`은 거부한다(19 §3.7.1, 판정 J-139) |
| `recovery.resolve` | 복구 선택 | `replan`은 거부 |
| `objection.file`, `autonomous.markSeen` | `SCR-M-AUTO` | |
| `brief.acknowledge` | `SCR-M-BRIEF` | `compact: true`만 받는다([판정 J-137]) |
| `work.stop` | `SCR-M-WORK` | `work.abort`는 거부 |
| `daemon.exitSafeMode` | `SCR-M-CONNECT` | |
| `settings.update` | `SCR-M-SETTINGS` | 섹션 `notifications`(결과 확인 알림 `notifications.resultReview`·`notifications.resultReviewDigestAt` 포함)와 `attention.quietHours`만([판정 J-227]). 방해 금지(`attention.snoozeUntil`)는 데스크톱·TUI에서만 바꾼다(판정 J-166) |
| `device.registerPush`, `device.unregisterPush`, `device.testPush` | 설정 | 자기 기기만(`devicesLimited`) |

그 밖의 명령(`grant.*`, `dial.set`, `mode.set`, `composer.submit`, `agreement.renegotiate` 등)은 `1010 scope.forbidden`이다. 분실·XSS 때 피해 범위를 화면이 하는 일로 줄인다.

#### 3.3.4 페어링 [제안, 흐름은 18 §3.7 흐름 A]

홈 화면 웹 앱은 Safari와 저장소를 나눠 쓰지 않는다(X-7). Safari에서 받은 쿠키는 설치한 앱에서 쓸 수 없으므로, 페어링은 **홈 화면에서 연 앱 안에서만** 한다.

| # | 사람 | 휴대폰 화면 | 데몬 |
|---|---|---|---|
| 1 | 데스크톱 `SCR-CONNECT` "새 기기 페어링 → 휴대폰"을 누르거나 서버에서 `helm pair --mobile --qr`을 실행 | (데스크톱) 설치 주소 QR(`<publicOrigin>/m/`)과 12자 코드, 만료 시각. 문구: "휴대폰 카메라로 QR을 읽고, Safari에서 공유 → 홈 화면에 추가를 누르세요. 홈 화면의 Helm을 열어 아래 코드를 넣으세요." | `pairing.code_created`(18) |
| 2 | 휴대폰 카메라로 QR을 읽어 Safari로 연다(Tailscale 켜짐) | `SCR-M-ONBOARD` 설치 단계: "공유 → 홈 화면에 추가"를 그림으로 안내. 이 화면(브라우저 탭)에서는 페어링 입력을 보이지 않는다 | 정적 서빙 |
| 3 | 홈 화면에 추가하고 "Helm" 아이콘으로 연다 | `SCR-M-ONBOARD` 연결 단계: 코드 입력 칸(12자, `XXXX-XXXX-XXXX`로 자동 끊어 보임), 기기 이름(기본 "iPhone" 또는 "iPad") | - |
| 4 | 코드를 입력하고 [이 휴대폰 연결하기] | "연결하는 중" | `POST /m/pair` → 18 §3.7.2 규칙(10분, 1회, 5회 시도, tailnet 신원) → 기기 생성(서버가 정한 `clientKind`·`platform`·`credentialCarrier`), 노드 묶기, `Set-Cookie`. 본문 `{ serverId, deviceId, tokenExpiresAt }` |
| 5 | - | `hello` 성공 → "연결됨 · 기기 9 iPhone" | `device.paired`, `device.connected` |
| 6 | [알림 켜기] (건너뛸 수 있음) | iOS 권한 창 → 허용 → "밤에는 알림을 보내지 않을까요? 조용한 시간 23:00~08:00" [이 시간으로 정하기] / [나중에] | §3.4.6 등록 → `device.push_registered`. 조용한 시간을 고르면 `settings.update`(14 `attention.quietHours`, 05 §3.7.4) |
| 7 | [시험 알림 보내기] | 잠금 화면·알림 센터에 05 `notif.push.test.*` 문구 | `device.testPush` → `push.sent` |

```http
POST /m/pair HTTP/1.1
Origin: https://server.tail7ad0b4.ts.net:8448
Content-Type: application/json

{"code":"K7Q4-XM92-PH3D","device":{"name":"iPhone"}}

HTTP/1.1 200 OK
Cache-Control: no-store
Set-Cookie: __Host-helm_dt=helm_dt_…; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict

{"serverId":"…","deviceId":"dv_…","tokenExpiresAt":"2027-10-12T…Z"}
```

- 실패 응답은 19 §3.7.7의 `/pair`와 같다(`1009 pairing.invalidCode`, 사유 구분 없음, [판정 J-81]).
- 설치 여부 판정: `matchMedia('(display-mode: standalone)').matches`. 거짓이면 3단계 화면을 보이지 않는다. 개발·시험 빌드에서만 `?allowBrowser=1`로 이 검사를 끈다(정식 빌드에는 이 분기가 없다).
- 사람 조작: 설치 1회(공유 → 추가 → 열기), 코드 입력 1, 연결 1, 알림 켜기 2(단추 + 권한 창), 조용한 시간 1(선택). 한 번만 한다.
- QR을 앱 안 카메라로 읽어 코드를 채우는 기능은 2차로 미룬다(MQ-10).

#### 3.3.5 연결 수명주기: 보임과 숨김 [제안, MOB-D04]

휴대폰 웹 앱은 백그라운드에서 연결을 유지할 수 없다(X-8). 그래서 앱은 숨겨질 때 연결을 닫고, 보일 때 바로 다시 붙는다. 앱 쪽 상태 기계(`platform/pwa/lifecycle.ts`). `HelmClient`의 상태 기계(19 §3.10.2)는 그대로이고 이 표는 그 바깥의 앱 수명주기다. `client.stop()` 뒤 `client.start()`로 다시 시작하는 행(`closed → connecting`)은 19에 요구했다. 19가 받지 않으면 숨김마다 `HelmClient`를 새로 만든다(위치·진행 중 명령함은 저장소에 있으므로 같다).

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| `starting` | 앱 시작(차가운 시작, 알림 누름 포함) | `navigator.locks` 잠금 `helm-conn-<serverId>`을 얻음, 쿠키 있음(`deviceId` 있음 또는 `whoami` 200) | `visible` | 캐시 뷰 그림(읽기 전용), 알림으로 열렸으면 자리 표시(§3.4.8), `client.start()` |
| `starting` | 앱 시작 | 잠금을 얻지 못함(다른 창이 연결 중) | `follower` | "다른 창에서 Helm이 열려 있습니다"와 읽기 전용 캐시. 결정 버튼 막음 |
| `starting` | 앱 시작 | 페어링 안 됨 | `unpaired` | `SCR-M-ONBOARD` |
| `visible` | `visibilitychange → hidden` 또는 `pagehide` | - | `hiding` | `presence.report { state: "hidden" }` 보냄(연결이 ready일 때만). 진행 중 명령이 있으면 각각 `fetch("/m/cmd", { method: "POST", keepalive: true, … })`로도 보낸다(같은 멱등 키) |
| `hiding` | 진행 중 명령 0개 또는 2초 지남 | - | `hidden` | `client.stop()`(1000). 화면 가림막을 그린다(§3.3.8) |
| `hiding`·`hidden` | `visibilitychange → visible` | - | `visible` | `client.start()` 뒤 `client.retryNow()`. 열린 뷰 다시 받기(코어 `syncing`). 처리된 질문의 알림 닫기(§3.4.9) |
| `hidden` | iOS가 앱을 멈추거나 종료 | - | (없음) | 다음 실행은 `starting` |
| `visible` | `online` 이벤트 | - | `visible` | `retryNow()` |
| `visible` | 연결이 열리기 전에 실패(브라우저는 업그레이드의 HTTP 상태를 알려 주지 않는다) | - | `visible` | `GET /m/whoami`로 판정: 401 → 인증 실패(`needsUser`), 네트워크 오류·그 밖 → §3.5.11 진단 순서와 백오프 |
| 아무 상태 | `auth.revoked`(reason `revoked`) 또는 4009(폐기) | - | `unpaired` | 이 서버의 뷰 캐시·진행 중 명령함·서비스 워커의 `/files` 캐시를 지우고 초안만 남긴다(18 §3.19와 같은 규칙으로 요구). `POST /m/logout` |
| 아무 상태 | `auth.revoked`(reason `expired`) | - | `unpaired` | 캐시·초안을 남긴다. 진행 중 명령은 자동 재전송 대상에서 빼고 "보내지 못한 조작"으로 보인다. "기기 연결 기간이 끝났습니다. 다시 페어링하세요." |

- 진행 중 명령이 남은 채로 닫히면 다시 붙을 때 같은 멱등 키로 다시 보낸다(19 §3.9, J-02). `/m/cmd`로 이미 처리됐으면 데몬이 멱등 결과를 돌려준다. 다시 열었을 때 아직 결과를 모르는 명령이 있으면 머리 띠 "보내지 못한 답 1개"와 `SCR-M-CONNECT`의 "보내지 못한 조작" 목록에 보인다(04 §3.19와 같은 규칙).
- 다시 붙는 동안(`connecting`~`syncing`) 결정 버튼은 막는다(04 §3.0.4 "다시 맞추는 중"). 목표는 §3.4.8.
- 이벤트 구독은 19 §3.17 권고대로 `filter.payload: "none"`(머리와 무효화 태그만)으로 하고, 화면에 필요한 뷰만 `view.get`으로 받는다.
- 오래 숨겨졌다가 돌아와 `2001 replay.outOfRange`가 나면 19 §3.5.5 스냅숏 경로로 간다. 열린 뷰를 다시 받는 것으로 끝나므로 사용자가 할 일은 없다.

#### 3.3.6 오프라인, 초안, 재전송 [판정 J-02, 판정 J-120]

- 연결이 없거나 뷰가 낡으면 결정 버튼을 막고 쓰던 내용은 초안으로 둔다. 초안은 `@helm/client-react`의 IndexedDB 초안 저장소(20 §3.9.5 `DraftRow`)를 그대로 쓴다. 데이터베이스 이름은 `helm-mobile`이다.
- 다시 연결되면 초안이 있는 질문에 "보내지 않은 답이 있습니다. 바뀐 상황을 확인하고 보내세요."를 보인다(05 §3.1.8). 자동으로 보내지 않는다.
- 같은 질문을 휴대폰과 데스크톱에서 답하면 먼저 받아들여진 답이 남는다. 늦은 쪽은 `3008 command.alreadyResolved` 또는 `3004 command.revisionConflict`를 받고 04 §3.0.5 "이미 처리됨"을 보인다(04 §4 첫 행).
- 가정 확정(`assumed`) 뒤 도착한 답은 3008로 거부된다. 응답의 `assumedValue`와 다음 행동 "이의로 보내기"를 보이고, 쓰던 답을 이의 시트의 이유 초안으로 넘긴다([판정 J-120]).
- 사람 결정의 이벤트에는 기기 id와 경로(`via.kind = "device"`, `listener = "tailnet"`, 19 `ListenerKind`)가 남는다(02 AC-04-08). 휴대폰에서 낸 답과 데스크톱에서 낸 답의 차이는 이것뿐이다(AC-04-09).
- 초안은 기기에만 있다. 다른 기기는 휴대폰의 보내지 않은 초안을 모른다. `presence.report`에 초안 수를 싣는 안은 MQ-16에 둔다.
- 뷰 캐시 크기: 서버당 8 MiB, 뷰 50개, 오래 열지 않은 것부터 지운다.

#### 3.3.7 접속 상태 [판정 J-119, MOB-D09]

휴대폰이 `presence.report`로 보내는 값과 판정:

| 값(09 `PresenceState`) | 휴대폰에서의 판정 |
|---|---|
| `active` | 화면이 보이고 마지막 터치·키 입력이 2분 안 |
| `idle` | 보이지만 2분 넘게 입력이 없음 |
| `hidden` | 숨겨지기 직전에 한 번 보낸다(§3.3.5). 그 뒤 연결을 닫는다 |
| `offline` | 휴대폰이 보내지 않는다. 연결이 닫히면 데몬이 정한다(09) |

- `locked`는 보내지 않는다. 웹 플랫폼은 화면 잠금과 다른 앱으로 전환을 구분하는 신호를 주지 않고, 잠긴 휴대폰의 앱은 곧 멈춘다(X-8). 경로 B여도 같다. 판정 J-118·J-119에 따라 09·19의 `PresenceState`에서 `locked`를 뺀다.
- 부재(away)는 저장하지 않고 14 §3.13.8의 파생 함수로 계산한다. 휴대폰의 "입력 없음 2분"은 그 함수에 기기 종류별 문턱(`clientKind: "mobile"` → 2분, 데스크톱 → 5분)으로 들어간다. `urgencyOf`, 푸시 계획(§3.4.3), `user_return` 판정은 모두 이 함수를 쓴다.
- 휴대폰이 `active`가 되는 것은 `user_return`이 아니다[판정 J-173]. `user_return`은 부재였던 사람의 데스크톱·TUI 기기가 `active`가 되는 전환뿐이다(11 §3.8.1, 14 §3.13.8). 밤에 권리 게이트 하나를 답하려고 휴대폰을 열어도 예약 묶음은 발화하지 않는다. 그 사이 예약된 정보 질문은 질문함의 "곧 전달될 것"에 남고, 데스크톱이 돌아올 때 전달된다. 휴대폰 확인이 아침 묶음을 휴대폰으로 쏟아지게 하지 않는다(11 AQ-23).
- `screen`은 03 화면 ID(`SCR-M-QUESTION` 등), `objectId`는 경로의 레코드 ID다. 16의 열람 기록(`view.opened`)은 `SCR-M-*`을 데스크톱 대응 화면과 같은 종류로 센다(16에 요구). `objectId`가 질문 ID이고 그 질문이 `delivered`면 데몬이 `question.seen`을 남긴다(19에 요구, §3.4.3 지연 푸시 취소에 쓴다).

#### 3.3.8 분실, 권한 없애기, 화면 가림 [제안, 18 §3.18과 맞춤]

- 분실 대응(18 §3.18.2 8번): (1) Tailscale 관리 콘솔에서 휴대폰 노드 제거 → 노드 묶기 때문에 쿠키가 있어도 `tailnet` 리스너를 통과하지 못한다. (2) 데스크톱 `SCR-CONNECT` 또는 `helm device revoke <dv_id> --reason lost`. (3) 폐기 뒤 데몬은 그 기기의 `push_tokens` 행을 지우고 `device.push_unregistered { reason: "revoked" }`를 남긴다. 그 휴대폰에 푸시가 더 가지 않는다.
- 이 기기 권한 없애기(`SCR-M-CONNECT`): 확인 시트 "이 휴대폰(기기 9)의 연결 권한을 없앱니다. 다시 쓰려면 새로 페어링해야 합니다." [기기 9 권한 없애기] → `device.revoke { deviceId: 자기 }` → 응답 뒤 4009 → §3.3.5의 폐기 행.
- 앱 전환 화면 가림: `visibilitychange → hidden`에서 화면 위에 불투명 가림막(앱 이름만)을 그린다. iOS가 전환 화면을 찍는 시점보다 먼저 그려지는지는 확실하지 않다 [가정]. §6.2 M-07에서 확인하고, 안 되면 한계로 기록한다.
- 앱 잠금(18 §3.18.2 6번 "생체 인증 또는 기기 암호, 기본 켬"): 웹 앱은 로컬 생체 인증 API가 없다. WebAuthn(패스키) 확인을 데몬이 검증하는 방식으로만 만들 수 있다. 1차에는 넣지 않고 휴대폰 자체 잠금과 `decideMobile` scope에 맡긴다. 결정마다 추가 확인을 넣으면 사람 조작 상한(05 §3.4)과 맞지 않는다. 미결 MQ-03.

### 3.4 알림

#### 3.4.1 경로 비교 (결정 47의 배경)

| 기준 | APNs 직접(네이티브 앱) | **Web Push(PWA)** | 자체 호스팅 ntfy + ntfy iOS 앱 | 공개 ntfy.sh 토픽 | 텔레그램 봇 | 푸시 없음 |
|---|---|---|---|---|---|---|
| 필요한 계정 | 유료 Apple 개발자(X-2) | 없음(X-4) | 없음. ntfy 서버를 새로 운영 | 없음 | 텔레그램 계정, 봇 | 없음 |
| 외부에 남는 것 | Apple이 payload를 중계한다(TLS) | 푸시 서비스는 시각과 크기만 받는다. payload는 RFC 8291로 종단 암호화 [지식] | ntfy.sh가 메시지 ID·토픽 해시·시각을 받는다(X-9) | ntfy.sh가 본문 전체를 받는다 | 텔레그램이 본문 전체를 받는다 | 없음 |
| 알림을 누르면 | 앱이 해당 화면으로 | 홈 화면 웹 앱이 `navigate` 주소로 열린다(X-5) | ntfy 앱이 먼저 열리고 링크는 Safari로 열린다. 홈 화면 웹 앱의 쿠키를 쓸 수 없다(X-7) | 같음 | 텔레그램이 열린다. 봇 안에서 답하면 사람 명령 경로(결정 14)를 벗어난다 | 앱을 열어야 볼 수 있다 |
| J-03·J-31 지키기 | 앱이 문구를 만든다 | 서비스 워커가 문구를 만든다 | ntfy 앱이 받은 본문을 그대로 보인다 | 같음 | 같음 | - |

Web Push를 쓴다 [결정 47]. 데몬이 꺼져 있으면 푸시도 없다. 데몬·WSL이 죽은 상황은 홈랩 경보(`alert@` → ntfy, `NTFY_URL`이 설정된 경우)가 맡고 Helm은 그 경로를 쓰지 않는다.

#### 3.4.2 푸시하는 것 [결정 48 / 세부는 제안]

| 종류 | 계기 | 범주(`helm.category`) |
|---|---|---|
| 질문 | 11의 전달 결정이 기록되고 알림 강도가 `interrupt` 또는 `notice`인 전달(§3.4.3) | `question`, `rights_gate`, `review`, `goal`, `recovery` |
| 묶음 | 방해 금지·조용한 시간이 끝날 때 그 사이 푸시하지 않은 열린 질문이 있으면 1개. 시간당 상한(`attention.interruptsPerHour`, §3.4.3)을 넘은 전달은 그 시간이 끝날 때 1개 | `question` |
| 결과 확인 묶음 | `notifications.resultReview`가 `daily_digest`면 설정 시각(`notifications.resultReviewDigestAt`, 기본 19:00, 서버 시간대)에 확인 대기 결과가 하나 이상일 때 1개(강도 `notice`). `immediate`면 결과 확인 질문이 생길 때마다 1개(강도 `notice`). 기본 `none`은 보내지 않는다([결정 56], [판정 J-189]) | `review` |
| 데몬 상태 | 안전 모드 진입, 읽기 전용 진입(사유별: `disk_critical`, `integrity_suspect`, `projection_fault`, `operator`). 진입마다 1회, 강도 `interrupt`로 다룬다. 풀릴 때는 보내지 않는다 | `system` |
| 시험 | `device.testPush` | `system` |

진행 보고, 에이전트가 정한 것, 관찰 제안에는 보내지 않는다(05 §3.7.1).

#### 3.4.3 언제 누구에게 보내는가 [제안, 11에 요구]

11의 알림 강도 계산(11 §3.5.1 `urgencyOf`)은 사람이 자리에 없으면 모두 `digest`로 낮춘다. 휴대폰 푸시의 목적은 바로 이 "자리에 없을 때"다. 그래서 11에 다음 수정을 요구한다(판정 J-119·J-172). 부재는 14 §3.13.8의 `isAway`(사람 단위)와 `isDeviceAway`(기기 단위)로 계산한다.

```text
# 11 §3.8.1 PresenceSnapshot에 더함(판정 J-185)
pushReachable: readonly DeviceId[]   # push 등록 상태가 'ok'·'failing'이고 폐기·만료되지 않은 기기. 데몬이 push_tokens와 기기 상태로 만든다

# 11 §3.5.1 urgencyOf의 부재 판정을 바꿈 (away = 14 §3.13.8 파생 함수, 기기 종류별 문턱 입력)
urgencyOf(q, presence, dials, state):
  if presence.dnd or presence.attention == 'quiet_hours': return 'digest'
  if allAway(presence) and presence.pushReachable 비어 있음: return 'digest'
  if q.escalations 비어 있지 않음:                                      # 만료 임박 승격
     return (q.blocking or q.gate == 'rights') ? 'interrupt' : 'notice'
  ... (나머지 그대로)
```

- 승격 강도: 막는 질문과 권리 게이트의 승격은 `interrupt`, 막지 않는 정보 질문의 승격은 `notice`로 한다. 막지 않는 권리 게이트는 마감이 임박할 때 승격되며, 그때도 `interrupt`다([결정 64]). 밤사이 정보 질문의 가정 확정 직전 알림이 끼어들기가 되지 않게 하기 위해서다(11에 요구).
- 이 수정은 강도만 바꾼다. 전달 방식 규칙(D-1~D-11)은 그대로다. 사람이 없을 때 정보 게이트 질문은 D-9로 `user_return`까지 예약되므로 푸시가 가지 않는다. 막지 않는 권리 게이트는 판정 J-132대로 다음 작업 경계나 검토 창에 전달되고, 그때 강도가 `notice`면 결정 48에 따라 푸시한다.

보낼 기기 고르기(데몬 `push/planner.ts`, 11 §3.5.3의 전달기가 `notify` 지시를 처리할 때 부른다):

```text
planPush(delivery, presence, devices, settings, now):
  # delivery: notify 지시 하나 (questionIds, urgency, cause, category, copy, target, batchKey, deliveryId)
  if presence.dnd or presence.attention == 'quiet_hours':
     if not (settings.notifications.dndException == 'expiringOnly' and delivery.cause == 'expiry_near'):   # 설정 값은 20 notifications.dndException(기본 none). 휴대폰 푸시에만 적용한다 [결정 59]
        remember(delivery); return []                                    # 끝날 때 묶음 1개
  if delivery.urgency not in {'interrupt', 'notice'}: return []          # 결정 48
  if 어떤 기기의 presence가 'active': return []                          # 사람이 그 기기 앞에 있다. 그 기기가 알린다(11 §3.5.6)
  if delivery.urgency == 'notice' and 데스크톱 기기 중 isDeviceAway가 거짓인 것이 있다: return []   # 판정 J-172: 데스크톱이 모두 부재일 때만(14 §3.13.8). 연결 기기 유무는 보지 않는다
  if counts(delivery) and countedInLastHour(now) >= settings.attention.interruptsPerHour:                # 판정 J-171: 사람 기준 하나, 모든 기기 합
     deferToHourBundle(delivery); return []
  live = 연결된 기기 목록 (presence idle·hidden, 이 기기 포함)
  out = []
  for d in presence.pushReachable:
     if rank(delivery.urgency) < rank(d.push.minUrgency): continue      # 기본 minUrgency 'notice'(결정 48)
     if acceptedCount(d, delivery.questionIds) >= 2: continue           # 같은 질문은 전달 1 + 승격 1까지(05 §3.7.1). 성공한 것만 센다
     out.push({ device: d, delayMs: delivery.urgency == 'interrupt' and live 비어 있지 않음 ? settings.push.followupDelayMs : 0 })   # 60,000. 열람이 있으면 타이머가 버린다
  return out
# counts(delivery): 권리 게이트의 즉시 전달과 만료 임박 승격(cause expiry_near)을 뺀 전달. 데스크톱 OS 알림과 휴대폰 푸시를 합쳐 센다(05 §3.7.3, 14 §3.13.8)
# countedInLastHour(now): 지난 1시간의 counts 전달 가운데 OS 알림이나 받아들여진 푸시가 있었던 것의 수
```

- 방해 금지 예외(`notifications.dndException`)는 휴대폰 푸시에만 적용한다. 방해 금지 중에는 데스크톱 OS 알림을 띄우지 않는다(예외 값과 관계없이) [결정 59].
- `delayMs > 0`이면 런타임 타이머(09 `runtime_timers`, 목적 `push_followup`)를 건다. 타이머가 울릴 때 그 질문이 `delivered` 상태이고 `question.seen`·답이 없으면 보낸다. 아니면 버린다.
- 시간당 상한(판정 J-171): 상한은 사람 기준 하나다. `attention.interruptsPerHour`(14 §3.13.2, 기본 2)를 데스크톱 OS 알림과 휴대폰 푸시를 합쳐 센다. 권리 게이트의 즉시 전달과 만료 임박 승격은 세지 않는다(05 §3.7.3). 넘으면 그 시간이 끝날 때 묶음 1개다. 기기별 상한(`push.hourlyCap`)은 두지 않는다.
- `notice`의 부재 조건(판정 J-172)은 "연결된 기기가 없음"이 아니다. 데스크톱 기기가 모두 부재(14 `isDeviceAway`)이고 휴대폰이 `active`가 아닐 때다. 연결된 휴대폰이 `idle`이면 `notice`는 바로 간다. `interrupt`는 연결된 기기가 있으면 60초 뒤에 보낸다.
- 결과 확인 알림(결정 56, 판정 J-189): `notifications.resultReview`가 `none`(기본)이면 알리지 않고 복귀 요약에서 확인한다. `daily_digest`이면 설정 시각(`notifications.resultReviewDigestAt`, 기본 "19:00", 서버 시간대)에 타이머 `result_review_digest`(09 `runtime_timers`)가 울린다. 그때 확인 대기 결과가 하나 이상이면 묶음 푸시 1개를 강도 `notice`로 `planPush`에 넘기고, 결과가 없으면 버린다. `immediate`이면 결과 확인 질문이 생길 때마다 강도 `notice`로 `planPush`를 거친다. 송신 지시의 `cause`는 묶음이면 `result_review_digest`, 즉시면 `result_review_immediate`다(16 §5.2 26행). 묶음은 개수만 싣고 문구는 05 `notif.push.bundle.*`를 쓴다. 숨김 즉시 푸시의 문구는 05 `notif.hidden.*`다(05 §3.7.8). 휴대폰 푸시는 두 경우 모두 방해 금지, 시간당 상한, 부재 조건을 따른다. 그래서 데스크톱이 부재가 아니면 휴대폰에 보내지 않는다. 데스크톱은 결과 확인 대기를 배지로만 알리고, OS 알림은 `immediate`일 때만 띄운다([결정 60]). 휴대폰 확인 범위는 판정 J-139 그대로다.
- `question.delivered.channel`: 연결된 기기에 보냈으면 `app`. 연결된 기기가 없으면 전달기가 첫 푸시 시도의 결과를 최대 5초 기다리고, 하나라도 받아들여졌으면(`201`) `push`, 모두 실패했거나 보낼 기기가 없으면 `brief`로 기록한다(11 §3.5.3 1번을 이렇게 넓힌다). 지연 푸시(`push_followup`)는 이미 `app`으로 기록된 전달에 덧붙는 것이므로 channel을 바꾸지 않는다. `targetDevices`에는 실제로 받아들여진 기기를 넣는다.
- 재전송·재접속에서 생긴 전달 이벤트로는 푸시를 보내지 않는다. 푸시는 전달 지시를 처리할 때 한 번만 계획한다.
- 데몬 상태 푸시(§3.4.2)는 질문 전달이 아니므로 `planPush`를 거치지 않고, "어떤 기기든 `active`면 보내지 않음"과 방해 금지 규칙만 같게 쓴다.

#### 3.4.4 푸시 payload [제안]

Declarative Web Push 형식(X-5)으로 보낸다. iOS 26에는 이 형식이 있으므로 서비스 워커가 실패해도 중립 알림이 뜬다.

```ts
// @helm/protocol/src/push.ts (데몬과 서비스 워커가 함께 쓴다)
export interface HelmPushMessage {
  web_push: 8030;
  notification: {
    title: string;                               // 05 notif.hidden.title 값. 서비스 워커가 없을 때의 중립 문구(J-03)
    body: string;                                // 05 notif.hidden.body.plain 값(개수 없는 형)
    navigate: string;                            // <publicOrigin>/m/q/<qsId>, 묶음·시스템은 <publicOrigin>/m/
    tag?: string;                                // 질문 ID, "bundle", "system". 같은 질문의 승격 알림이 앞 알림을 바꾼다
    app_badge?: string;                          // 선택 필요 수(§3.4.9)
  };
  helm: {
    v: 1;
    serverId: string;
    deliveryId: string;                          // 11 §3.5.6
    kind: "question" | "bundle" | "system" | "test";
    questionId: string | null;                   // 질문 ID는 비밀이 아니다(19 §3.17)
    ref: { questionNo: number | null; concernNo: number | null };   // 앱 자리 표시용 표시 번호(03 §3.2.6)
    category: "question" | "rights_gate" | "review" | "goal" | "recovery" | "system";
    urgency: "interrupt" | "notice";
    copy: { titleKey: string; bodyKey: string; args: Record<string, string> };   // 05 §3.7.2 키와 인자(J-31)
    count: number;                               // 묶음이면 질문 수, 아니면 1
    badge: number;
    sentAt: string;                              // ISO 8601 UTC
  };
}
// 05 notif.hidden.title·notif.hidden.body.plain과 같은 값. 데몬은 @helm/ui-language를 import하지 않으므로 상수로 두고 시험으로 묶는다(T26-12)
export const PUSH_FALLBACK = { titleKey: "notif.hidden.title", bodyKey: "notif.hidden.body.plain" } as const;
```

- `copy.args`는 05 §3.7.2의 제목·본문 인자(할 일, 마감 효과, Concern 이름, 질문 번호)다. 데몬은 기기 설정과 관계없이 이 인자를 싣는다. 질문 문장 전체, Goal 서술, 근거 내용, 비밀은 어느 경우에도 싣지 않는다(05 §3.7.5, 18 §3.18.2 9번). payload는 기기 공개 키로 암호화되므로 푸시 서비스는 인자를 읽지 못한다. 내용을 알림에 보일지는 기기가 정한다(§3.4.5).
- 크기: 직렬화 3 KiB 이하(암호화 전). 넘으면 `args`를 버리고 보낸다.
- HTTP 헤더(RFC 8030): `TTL`은 즉시 전달 12시간, 승격은 만료점까지 남은 시간(최소 5분), 묶음·시스템 6시간. `Urgency: high`(interrupt) / `normal`(notice). `Topic`은 질문 ID의 SHA-256 앞 16바이트를 base64url로 쓴 22자(RFC 8030의 32자 상한 안)로 두어 아직 배달 전인 같은 질문의 푸시를 바꾼다. 묶음·시스템은 `Topic`을 두지 않는다.
- 데몬은 `notification.title`·`body`에 넣을 중립 문자열을 시작 때 문구 표에서 읽지 않고 상수 파일(`packages/protocol/src/push-fallback.generated.ts`)로 받는다. 이 파일은 `scripts/gen-push-fallback.ts`가 `@helm/ui-language`의 값으로 만들어 저장소에 커밋한다. `just gen-push-fallback --check`가 현재 값과 같은지 본다(06 §3.16). 05 문구를 바꾸면 `just gen-push-fallback`으로 다시 만들어 커밋한다. 06의 "데몬은 ui-language를 import하지 않는다"를 지키면서 문구는 05 한 곳에서 바뀐다.

#### 3.4.5 서비스 워커 처리 [제안]

```ts
// apps/mobile/src/sw/sw.ts (개요)
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const msg = parsePush(e.data?.json());            // 스키마 검사. 실패하면 중립 알림
    const s = await readDeviceSettings();             // IndexedDB: serverId, showContent(기본 false)
    if (!msg || msg.helm.serverId !== s.serverId) return showFallback(msg);
    const { title, body } = renderNotification(msg, s);   // @helm/ui-language, 순수 함수(notify.ts)
    await self.registration.showNotification(title, {
      body, tag: msg.notification.tag ?? msg.helm.deliveryId,
      data: { navigate: safeNavigate(msg.notification.navigate), deliveryId: msg.helm.deliveryId },
      icon: "/m/icons/192.png",
    });
    if ("setAppBadge" in navigator) await navigator.setAppBadge(msg.helm.badge);
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(focusOrOpen(e.notification.data.navigate));   // 열린 창이 있으면 postMessage로 이동, 없으면 openWindow
});
```

- 문장 규칙: `showContent`가 거짓(기본)이면 05 `notif.hidden.title`·`notif.hidden.body.count`(개수 있는 형)로, 참이면 `copy.titleKey`·`bodyKey`와 `args`로 만든다. 판단은 기기 설정 하나로 한다(데스크톱 20 §3.10.1의 `notifications.showContent`와 같은 이름).
- 서비스 워커는 push 이벤트마다 알림을 반드시 하나 띄운다(`userVisibleOnly`). 같은 `deliveryId`가 다시 오면 띄우지 않는 대신 같은 `tag`로 `showNotification`을 다시 불러 기존 알림을 바꾼다. 알림 수는 늘지 않는다.
- `safeNavigate`: `navigate`가 모바일 출처의 `/m/` 아래 경로가 아니면 `/m/`로 바꾼다. 다른 출처나 다른 경로를 열지 않는다.
- 잠금 화면 노출은 iOS 설정(알림 미리보기)이 따로 정한다 [지식]. 앱은 잠금 상태를 감지하지 않는다(05 §3.7.6).
- 알림 동작 단추(`actions`)를 쓰지 않는다(05 §3.7.5).
- 서비스 워커가 쓰는 문구 묶음은 `@helm/ui-language`에서 `notif.*` 키만 뽑아 넣는다(빌드 단계에서 트리 셰이킹).

#### 3.4.6 푸시 등록: 08 Device `push`와 09 `push_tokens` [판정 J-71, 08·09·10·19에 요구]

08 §3.19.1 Device의 `push` 필드를 다음으로 바꿔 달라고 요구한다.

```ts
// @helm/domain/src/records/device.ts
import { Type } from "typebox";                                  // 07 §3.11.8
import { Obj, Nullable, Sha256, Ms } from "../schema/common.js";  // 08 공통 스키마 도우미(같은 패키지)

export const PushProvider = Type.Union([Type.Literal("webpush"), Type.Literal("apns")]);   // 1차는 webpush만 받는다. apns는 경로 B 예약
export const PushRegistration = Obj({
  provider: PushProvider,
  /** webpush: sha256(endpoint URL), apns: sha256(기기 토큰). 원문은 09 운영 테이블 push_tokens(판정 J-71) */
  tokenHash: Sha256,
  /** 화면·진단용 표시. tokenHash 16진수 앞 8자. 18의 표시 규칙도 이 값 하나로 한다 */
  tokenHint: Type.String({ pattern: "^[0-9a-f]{8}$" }),
  /** webpush 엔드포인트 호스트(예: "web.push.apple.com") */
  endpointHost: Type.String({ minLength: 1, maxLength: 253 }),
  /** 결정 48 기본 notice. 사람이 interrupt로 좁힐 수 있다 */
  minUrgency: Type.Union([Type.Literal("interrupt"), Type.Literal("notice")]),
  /** 구독에 쓴 VAPID 공개 키의 sha256 앞 12자 */
  vapidKeyId: Nullable(Type.String({ pattern: "^[0-9a-f]{12}$" })),
  registeredAt: Ms,
});
// Device에서: push: Nullable(PushRegistration)
// Device에 더함: credentialCarrier: Type.Union([Type.Literal("header"), Type.Literal("cookie")])   // §3.3.3. 기본 header
```

09의 운영 테이블 `push_tokens`(09 §3.7, 판정 J-71)를 쓴다. 09에 다음을 요구한다.

| 열 | 09 현재 | 요구 |
|---|---|---|
| `token` | 원문 한 칸 | webpush는 구독 JSON `{"endpoint":…,"keys":{"p256dh":…,"auth":…}}` 문자열, apns는 기기 토큰. 이벤트·재전송·투영·관찰 입력·진단 묶음·로그에 넣지 않는다 |
| `token_hash` | 있음 | `PushRegistration.tokenHash`와 같은 값 |
| `vapid_key_id` | 없음 | 더함. 키 교체 때 정리에 쓴다 |
| `last_ok_at`, `fail_count`, `last_error` | 없음 | 더함. 상태 `failing` 판정과 17 점검에 쓴다. `last_error`는 HTTP 상태와 짧은 사유만(엔드포인트 URL은 넣지 않는다) |

이벤트(09 §3.4.13 통치 이벤트에 더함, 이름은 09가 정한다):

| 이벤트 | 범주·평면 | 행위자 | subject | payload | 상태 효과 |
|---|---|---|---|---|---|
| `device.push_registered` | governance·A | human(그 기기의 명령) | dv | `PushRegistration` | Device.push 설정·교체 |
| `device.push_unregistered` | governance·A | human / runtime | dv | `{ reason: "user" \| "gone" \| "revoked" \| "permission_lost" \| "key_rotated" }` | Device.push = null |
| `push.sent` | system | runtime | dv | `{ deliveryId, questionIds, provider, outcome: "accepted" \| "gone" \| "rejected" \| "failed", httpStatus: Nullable(Integer), attempt }` | 없음(감사·16 지표) |

런타임 타이머 목적(09 `runtime_timers`): `push_followup`(§3.4.3 지연 푸시), `push_dnd_digest`(방해 금지·조용한 시간 끝 묶음), `push_hour_bundle`(시간당 상한을 넘은 전달의 묶음), `result_review_digest`(결과 확인 묶음, §3.4.2, 판정 J-189).

명령과 메서드(19 §3.17을 이 값으로 확정, 10 통치 명령 `device.register_push`·`device.unregister_push`·`device.test_push`):

```ts
// device.registerPush (cmd, scope devices·devicesLimited(자기 기기만))
export interface DeviceRegisterPushParams extends CommandParamsBase {
  channel: "webpush";                         // 1차. "apns"는 경로 B 예약
  address: string;                            // 엔드포인트 URL(https만)
  keys: { p256dh: string; auth: string };     // base64url
  minUrgency: "interrupt" | "notice";         // 기본 notice(결정 48)
  vapidKeyId: string;                         // 구독에 쓴 키 (device.pushConfig 결과)
}
export interface DeviceRegisterPushResult extends CommandResult { fingerprint: string }   // tokenHint와 같은 값
// device.unregisterPush (cmd): { channel: "webpush"; reason?: "user" | "permission_lost" }
// device.pushConfig (read, scope read)
export interface DevicePushConfigResult {
  enabled: boolean;                           // clients.mobile·push.enabled가 켜져 있고 VAPID 비밀이 있을 때 true
  providers: Array<"webpush">;
  vapidPublicKey: string | null;              // base64url (applicationServerKey)
  vapidKeyId: string | null;
}
// device.testPush (cmd, scope devicesLimited(자기 기기만)·devices): 이 기기로 kind "test" 푸시 하나
// DeviceInfo.push (19 §3.7.7):
//   push: { channel: "webpush" | "apns"; registeredAt: IsoTime; fingerprint: string; minUrgency;
//           state: "ok" | "failing" | "needs_refresh"; lastOkAt: IsoTime | null } | null
```

데몬 검증(커널 판정이 없는 통치 명령, 10 §3.11 끝 문단의 방식):

1. `address`는 `https:` URL이고 포트가 없거나 443이며, 호스트가 허용 목록(17 설정 `push.webpush.allowedEndpointSuffixes`, 기본 `["push.apple.com"]`)과 점 경계 접미사로 일치해야 한다(호스트가 그 값과 같거나 `.` + 그 값으로 끝남). 아니면 내용 갈래 거부 `push.endpoint_not_allowed`. 클라이언트가 내부 주소를 등록해 데몬이 내부 서비스로 요청을 보내게 하는 일(18 T-M5와 같은 종류)을 막는다.
2. `keys.p256dh`는 65바이트 P-256 공개 점, `auth`는 16바이트여야 한다.
3. `vapidKeyId`가 현재 키와 다르면 내용 갈래 거부 `push.vapid_key_mismatch`(앱이 다시 구독한다).
4. 같은 트랜잭션에서 `push_tokens` 행을 쓰고 `device.push_registered`를 남긴다. 같은 `tokenHash`·같은 설정이면 이벤트를 다시 남기지 않고 결과만 돌려준다(멱등).

송신 때 검사(`push/endpoint.ts`): 이름을 해석한 주소가 루프백·사설(RFC 1918)·링크 로컬·CGNAT·tailnet(100.64.0.0/10, fd7a:115c:a1e0::/48)이면 보내지 않는다. 해석한 주소로 연결을 고정한다. 3xx 응답은 따르지 않고 실패(`rejected`)로 본다. 시험에서 가짜 푸시 서비스를 루프백에 띄울 때만, 시험 설정의 `push.webpush.testEndpoints`(`host:port` 목록, 기본 없음, 정식 설정에는 두지 않는다)에 든 주소를 허용 목록 검사(1번)와 이 검사에서 면제한다(T26-17). 이 키는 17에 요구한다(§5.2).

앱 쪽 등록 절차(`platform/pwa/push.ts`):

```text
ensurePush(client, settings):                       # 연결이 ready가 될 때마다 한 번
  cfg = device.pushConfig()
  if !cfg.enabled or Notification.permission != 'granted':
     if server의 DeviceInfo.push != null and Notification.permission == 'denied': device.unregisterPush(reason 'permission_lost')
     return
  sub = await registration.pushManager.getSubscription()
  if sub and keyIdOf(sub.options.applicationServerKey) != cfg.vapidKeyId: await sub.unsubscribe(); sub = null
  if !sub: sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cfg.vapidPublicKey })
  fp = sha256hex(sub.endpoint)[0:8]
  me = DeviceInfo(current)
  if me.push == null or me.push.fingerprint != fp or me.push.state == 'needs_refresh' or me.push.minUrgency != settings.minUrgency:
     device.registerPush({ channel:'webpush', address: sub.endpoint, keys: sub.toJSON().keys, minUrgency: settings.minUrgency, vapidKeyId: cfg.vapidKeyId })
```

- 처음 구독과 권한 요청은 사용자 조작 안에서만 한다(X-4). `ensurePush`는 이미 허용된 뒤의 갱신만 한다.
- 데몬이 `404`·`410`을 받으면 그 구독은 끝난 것이다. `push_tokens` 행을 지우고 `device.push_unregistered { reason: "gone" }`. 다음에 앱이 열리면 `ensurePush`가 다시 구독한다.
- `push_tokens` 행이 없는데 Device.push가 남아 있으면(복원 등) `DeviceInfo.push.state = "needs_refresh"`로 보이고, 앱이 다음 실행 때 다시 등록한다. 원문은 휴대폰이 다시 줄 수 있는 값이라 로그에 두지 않아도 상태를 복구할 수 있다.

#### 3.4.7 VAPID 키, 송신, 스위치 [제안, 17에 요구]

| 항목 | 값 |
|---|---|
| 스위치 | 상위는 기능 플래그 `clients.mobile`(23, 기본 꺼짐). 꺼져 있으면 `/m/`, 휴대폰 페어링, 푸시가 모두 없다. 하위는 17 설정 `push.enabled`(기본 켬). 끄면 등록은 받되 보내지 않는다 |
| 비밀 | `HELM_VAPID_PRIVATE_KEY`(P-256 개인 키, base64url). 제품 비밀 `~/projects/helm/secrets/prod.sops.yaml`. 공개 키는 개인 키에서 계산한다. 데몬은 시작 때와 `helm ops reload-secrets` 때 SecretStore로 받는다([판정 45], 17 §3.8) |
| 키 만들기 | `just mobile-vapid-keygen`이 새 키 쌍을 만들어 한 번 표준 출력에 보이고, 사람이 `secrets edit prod`로 넣은 뒤 `helm ops reload-secrets`를 실행한다. `.env.example`에 `HELM_VAPID_PRIVATE_KEY=`를 적는다 |
| 키가 없을 때 | `device.pushConfig.enabled = false`, `daemon.status.warnings`에 `push_no_vapid_key`(17 점검 ID로 요구) |
| 키 교체 | 모든 구독이 무효다. 데몬은 키를 읽을 때 `vapid_key_id`가 다른 행을 모두 지우고 `device.push_unregistered { reason: "key_rotated" }`를 남긴다. 앱은 다음 실행 때 다시 구독한다 |
| `sub` | 17 설정 `push.webpush.subject`. 기본값은 `<publicOrigin>/m/` [가정 AS-M6]. 사용자 이메일을 기본값으로 쓰지 않는다 |
| VAPID JWT | `aud` = 엔드포인트 출처, `exp` = 지금 + 12시간(RFC 8292의 24시간 상한 안), 같은 `aud`에 대해 만료 1시간 전까지 다시 쓴다 |
| 송신 라이브러리 | `web-push` 3.6.7(정확한 판 고정, X-15). 의존 감사에서 문제가 나오면 RFC 8291(aes128gcm)·RFC 8292를 Node `crypto`로 직접 구현한다(MQ-08) |
| 재시도 | 429는 `Retry-After`(없으면 30초)를 따른다. 5xx·네트워크 오류는 1초, 5초, 30초 뒤 세 번 다시 보낸다. 어느 경우든 TTL을 넘기지 않는다. 404·410은 등록 삭제. 그 밖의 4xx와 3xx는 다시 보내지 않는다. 재시도는 메모리에만 두고 데몬이 다시 시작되면 버린다(`push.sent(failed)`가 남는다). 시도마다 `push.sent`를 남긴다 |
| 실패 상태 | 404·410이 아닌 실패가 연속 5회이거나 24시간 동안 시도가 있었는데 받아들여진 것이 없으면 `failing`. `failing` 기기도 `pushReachable`에 남는다. 받아들여지면 `fail_count = 0`, `ok`. 17 점검 `push_failing`이 이 상태를 보인다 |
| 바깥 연결 | 데몬 프로세스만 보낸다. 18 §3.18.2 9번 "설정에 이름을 적은 호스트로만"은 위 허용 목록으로 지킨다 |

#### 3.4.8 알림에서 답까지 [제안]

| # | 사람 | 화면 | 시간 목표 |
|---|---|---|---|
| 1 | 잠금 화면의 알림(기본: 05 `notif.hidden.*`, 예 "Helm · 확인할 일이 1건 있습니다.")을 누른다 | (Face ID로 잠금 해제는 OS 조작이라 세지 않는다) | 질문 기록 → 알림 표시: p95 10초 이하 |
| 2 | - | 웹 앱이 `/m/q/<qsId>`로 열린다. 캐시에 그 질문이 있으면 읽기 전용으로 먼저 보이고, 없으면 푸시 data의 `ref`로 "질문 15 · Concern 12를 받는 중"을 보인다. 머리에 "다시 연결하는 중" | 화면이 그려지기까지 1초 이하(서비스 워커 캐시) |
| 3 | 질문을 읽는다 | 연결 ready → 버튼 활성. 연결에 실패하면 §3.5.11 진단 순서로 원인과 할 일(예: "Tailscale 앱에서 연결을 켜세요")을 보인다 | 알림 누름 → 결정 버튼 활성: Tailscale이 연결되어 있으면 p95 3초, VPN On Demand가 새로 연결하면 p95 6초 |
| 4 | 주 버튼을 누른다 | "보내는 중" → "적용됨" + 영향 표시 | 01 NFR-P-1과 같음 |

사람 조작: 보기 1(알림 누름) + D1. 데스크톱 UC-04(단계 3·5)와 같다(02 AC-04-02). 조작 셈법은 01 §3.5.2를 따른다.

알림 표시 시간 목표(p95 10초)는 01 NFR-P-6(연결된 기기 5초)과 따로 둔다. 푸시 서비스를 거치는 시간은 Helm이 정할 수 없으므로 측정만 한다(16에 요구).

#### 3.4.9 배지, 철회, 중복 [제안]

- 철회 푸시를 보내지 않는다. 다른 기기에서 답했다고 휴대폰에 푸시를 다시 보내면 iOS 규칙상 알림을 하나 더 띄워야 한다(X-5 `userVisibleOnly`). 대신:
  - 같은 질문의 승격 푸시는 `tag`가 같아 앞 알림을 바꾼다.
  - 앱이 보이게 될 때 `registration.getNotifications()`로 띄운 알림을 읽어, `inbox` 뷰에서 이미 처리된 질문의 알림을 닫는다.
  - 처리된 질문의 알림을 누르면 04 §3.0.5 "이 질문은 09:12에 답했습니다(다른 기기)"를 보인다.
- 배지: 데스크톱 Dock 배지(20 §3.10.3)와 같은 뜻으로 "선택 필요" 수만 센다(권리 게이트와 막는 질문). 푸시의 `badge`와 앱이 보일 때 `tray` 뷰 값으로 `setAppBadge`를 갱신한다(X-4). 0이면 `clearAppBadge`.
- 앱이 보이는 동안 실시간 전달(`question.delivered`)이 오면 OS 알림 대신 앱 안 배너로 보인다(20 §3.10.1 규칙 8과 같은 판단, `PlatformAdapter.notifications.show`의 모바일 구현).

### 3.5 화면

#### 3.5.1 셸과 내비게이션 [03 §3.12를 따름 / 레이아웃은 제안]

```text
┌──────────────────────────────┐  너비 360~430pt, 한 열
│ Helm        ● 연결됨     ⚙   │  MobileHeader: 연결 표시(점+글자, 04 §3.0.4), 설정
│ 14:02 기준 · 다시 연결하는 중 │  (낡음·끊김일 때만) 띠
├──────────────────────────────┤
│                              │
│   현재 화면                   │
│                              │
├──────────────────────────────┤
│ 질문함 3 │ 복귀 요약 │ 정한 것 • │ 진행 중 │  MobileTabBar (아래 안전 영역 위)
└──────────────────────────────┘
```

- 아래 탭 넷: 질문함(`SCR-M-INBOX`, 배지 = 전달된 질문 수, 권리 게이트 수는 강조), 복귀 요약(`SCR-M-BRIEF`), 정한 것(`SCR-M-AUTO`, 숫자 대신 점 하나: 마지막 확인 이후 새 항목이 있음), 진행 중(`SCR-M-WORK`). 탭 이름은 화면 제목(05 §3.10.4 고정 표현: "복귀 요약", "에이전트가 정한 것", "진행 중인 작업")의 줄임형이고, 접근 가능한 이름은 전체 이름이다. 줄임형 탭 이름은 05 문구 목록에 `label.mobile.tab.*`로 둔다(05에 요구). 배지 수는 데몬 뷰 값이다(앱이 세지 않는다, 03 §6).
- 머리: 앱 이름, 연결 표시(누르면 `SCR-M-CONNECT`), 설정 단추.
- 안전 영역: `viewport-fit=cover`와 `env(safe-area-inset-*)`로 노치·홈 표시줄을 피한다. 높이는 `100dvh`.
- iPad(너비 768px 이상): 질문함 탭에서 왼쪽 목록, 오른쪽 질문 두 칸. 다른 탭은 가운데 한 열(최대 680px).
- 키보드 조합은 두지 않는다(03 §3.12). 하드웨어 키보드가 붙은 iPad에서도 Tab·Enter만 쓴다.

#### 3.5.2 경로 [제안]

| 화면 ID | 경로 | 딥 링크(03 §3.5.4) 대응 |
|---|---|---|
| `SCR-M-INBOX` | `/m/` | - |
| `SCR-M-QUESTION` | `/m/q/:qsId` | `helm://question/<qsId>` |
| `SCR-M-QUESTION`의 산출물 보기 | `/m/q/:qsId/output` | - |
| `SCR-M-BRIEF` | `/m/brief` | `helm://brief` |
| `SCR-M-AUTO` | `/m/auto` | - |
| `SCR-M-WORK` | `/m/work` | - |
| `SCR-M-CONNECT` | `/m/connect` | - |
| `SCR-M-SETTINGS` | `/m/settings` | - |
| `SCR-M-ONBOARD` | `/m/onboard` | - |

- 웹 앱은 `helm://` 스킴을 받을 수 없다. 데몬은 푸시 `navigate`에 위 경로를 쓰고, 03 §3.5.4의 딥 링크는 데스크톱용으로 그대로 둔다. 둘의 대응은 `@helm/client-react`의 딥 링크 해석 표(20 §3.14) 하나에 둔다.
- 모바일에 없는 화면을 가리키는 링크(`helm://concern/…`, `helm://evidence/…` 등)는 "데스크톱에서 열 수 있습니다"와 관련 질문·요약 링크를 보인다(03 §3.12).
- `helm://question/<id>`의 종류가 합의 확인·결과 확인·복구 선택이어도 모바일은 `SCR-M-QUESTION` 하나에서 처리한다.

#### 3.5.3 `SCR-M-INBOX` 질문함

```text
질문함                                    [모두 ▾]
─────────────────────────────────────────
지금 선택이 필요함
┃ 선택 필요 · 질문 15 · Concern 12
┃ 초안을 외부 리뷰어에게 보낼지 정해야 합니다
┃ 즉시 전달 09:10 · 오늘 18:00 마감          ›
┃ 결과 확인 · WorkUnit 31 · Concern 12
┃ 본문 1절 초안 · 기준 3개 중 2개 확인됨        ›
확인하면 좋은 것
│ 확인하면 좋은 것 · 질문 14 · 임시 가정으로 진행 중
│ 만료점: 본문 2절 전 (약 40분)                ›
│ 반응 요청 · 라운드 3 · Concern 9
│ 데스크톱에서 답할 수 있습니다       [미루기]
함께 답할 수 있는 묶음 (라운드 3 끝)
│ 질문 16, 17 · Concern 9                    ›
곧 전달될 것 (2) ▸
최근 답한 것 (5) ▸
```

- 뷰: `view:inbox`(04 §3.3 `InboxView`). 순서는 데몬 정렬 그대로(11 §3.5.4). 권리 게이트와 막는 질문은 접지 않는다(04 A5).
- 거르기는 머리의 선택 메뉴 하나다: 모두 / 선택 필요 / 확인하면 좋은 것 / 그 밖의 요청.
- 휴대폰에서 답할 수 없는 형식(§3.5.4 표)의 행은 "데스크톱에서 답할 수 있습니다"와 [미루기]만 보인다. 미루기 기본값은 "다음 데스크톱 접속까지"(11 §3.18 `user_return`)다. 11은 `user_return`을 데스크톱·TUI 복귀로만 정했으므로(11 §3.8.1, 판정 J-173), 휴대폰에서 답할 수 없는 질문은 데스크톱에서 답할 때 다시 나온다(MQ-11 해소).
- 행 누름 → `SCR-M-QUESTION`. 묶음 행 누름 → 묶음 모드(§3.5.4).
- 빈 상태·다른 기기에서 답함 표시는 04 §3.3과 같다.
- 사람 조작: 이동 1 + 질문별 D1.

#### 3.5.4 `SCR-M-QUESTION` 질문

```text
‹ 질문함                                ⋯
선택 필요 · 질문 15 · Concern 12 블로그 글 방향
즉시 전달 09:10
─────────────────────────────────────────
지금 정할 것
  1·2절 초안을 외부 리뷰어(김OO)에게 보낼지 정해야 합니다.
  지금 정하지 않으면 리뷰가 다음 주로 밀립니다
왜 지금인가
  리뷰 일정이 오늘 18:00에 마감됩니다
답이 없으면
  보내기 작업만 멈춰 있습니다. 다른 작업은 계속됩니다
추천
  1절과 2절 초안만 보내기 (3절은 아직 근거 확인 중)
다른 선택  전체 초안 보내기 · 이번 리뷰 건너뛰기 (+1 ▸)
핵심 근거  ▸ 지지 2 · 반대 1 (가장 강한 반대: …)
되돌릴 수 있나  보낸 뒤에는 되돌릴 수 없습니다 (권한 레이어 판정)
보낼 인자  ▸ 받는 사람, 파일 2개            고치기는 데스크톱에서
─────────────────────────────────────────
┌──────────────────────────────────────┐
│ 1·2절만 김OO에게 보내기               │  주 버튼(44pt 이상, 세로로 쌓음)
├──────────────────────────────────────┤
│ 전체 초안 김OO에게 보내기              │
├──────────────────────────────────────┤
│ 김OO에게 보내지 않기                   │
└──────────────────────────────────────┘
그 밖에 ▾   (아래 시트: 범위 줄여 진행 · 기준 고치기 · 질문 다시 쓰기 · 먼저 알아보기 · 미루기 · 이의 걸기)
```

- 뷰: `view:question`(04 §3.4 `QuestionView`). 필드와 깊이별 펼침은 04 §3.4 표를 그대로 쓰되 휴대폰에서는 "일반" 깊이 기준으로 펼치고, "깊은 검토" 질문에는 머리에 "데스크톱에서 보기를 권합니다"를 붙인다(03 §3.12). 답할 수는 있다.
- 주 버튼은 최대 3개, 세로로 쌓는다. 문구는 `OptionView.actionLabel`(대상과 효과, 05 §3.10.5). "그 밖에"는 아래 시트(`BottomSheet`)로 연다. 시트에도 A15 필수 선택지가 모두 있다(05 §3.1.5, 11 §3.2.3). 휴대폰에서 할 수 없는 선택지는 빼지 않고 "데스크톱에서 할 수 있습니다" 표시와 함께 비활성으로 보인다.
- 보내는 명령: 질문 답은 `question.answer`에 11 `AnswerValue`를 싣는다(예: 범위 줄여 진행은 `{ option: "narrow_scope", instruction }`). 19 params를 AnswerValue로 받는 변경은 19 몫이다(§5.2). 작업 합의 확인은 `agreement.confirm`, 결과 확인은 `result.accept`(decision `accept`·`request_changes`)로 보낸다([판정 J-124], 19 §3.7.1).
- 답한 뒤: `ChoiceImpactEcho`로 영향 표시(04 §3.4) → [질문함으로].

질문 형식별 휴대폰 동작 [제안, MOB-D08]:

| 형식(11 §3.2.3) | 휴대폰에서 할 수 있는 응답 | 휴대폰에서 비활성("데스크톱에서") | 03 §3.12와 다른 점 |
|---|---|---|---|
| `answer` | 답(값·글), 추천대로 정하기, 가정대로 진행(정보·비막힘), 기준 고치기, 질문 다시 쓰기, 먼저 알아보기, 에이전트가 정하게 두기(정보 게이트), 범위 줄여 진행, 미루기 | 없음 | 같음 |
| `confirm_candidate` | 확정(고쳐서 확정 포함, 글 입력), 넣지 않기, 가정대로 진행, 기준 고치기, 질문 다시 쓰기, 미루기. 작업 합의 확인은 "이 범위로 맡기기 / 넓어진 부분 빼고 맡기기 / 맡기지 않기" | 없음 | 같음 |
| `approve_action` | 허락, 하지 않기, 범위 줄여 진행(글로 지시), 미루기 | 고쳐서 허락(`approve_edited`) | 같음 |
| `result_review` | 산출물을 연 뒤 결과 확인(반영 방침 고르기 포함), 수정 요청(기준 고르기 + 글), 미루기 | 조건 붙여 확인, 거절(해결 안 됨), 기준이 틀림. 큰 산출물·취향형 결과는 결과 확인도 비활성(아래) | 산출물 보기 조건 추가([판정 J-139]) |
| `choose_one` | 고르기(추천 먼저, 나머지 "+n" 펼침), 고쳐서 정하기(글), 기준 고치기, 질문 다시 쓰기, 먼저 알아보기, 에이전트가 정하게 두기, 범위 줄여 진행, 미루기 | 없음 | **다름.** 03은 데스크톱 전용으로 두었다. 선택지 목록을 세로로 읽고 하나를 누르는 일은 작은 화면에서도 정확히 할 수 있다. 원함 탐구에서는 이 형식 자체가 금지(11 V-Q-03, [판정 J-141])라 요소 반응과 섞일 일이 없다 |
| `reaction` | 미루기 | 반응 전체 | 같음 |
| 복구 선택(`recovery`) | 04 §3.20의 행동(마지막 확인 지점부터 다시 실행, 그대로 두기, 확인 작업 만들기, 결과 기록) | "Concern에서 다시 계획"(데스크톱 화면이 필요) | 같음 |

결과 확인 [판정 J-139]:

- 결과 확인 카드는 "산출물 보기"(`/m/q/:qsId/output`)를 연 뒤에만 [결과 확인] 단추를 켠다. 산출물 보기 화면은 결과 제출의 본문(텍스트), 이미지(`/files/*` 썸네일과 원본), 변경 요약(바뀐 파일 목록과 파일별 줄 수)을 보인다. 열었는지는 화면 상태(`outputsViewed`)로만 둔다. 서버에 보내지 않는다.
- 데스크톱 전용으로 보는 결과(카드에 "데스크톱에서 확인할 수 있습니다", 미루기만): 본문 텍스트가 200 KiB를 넘음, 바뀐 파일이 20개를 넘음, 휴대폰에서 그릴 수 없는 형식(영상, PDF 이외 문서 등)이 있음, 결과에 선호 모델 기준이 붙은 취향형 작업(05 §3.4.1 "기준마다 맞음·아님·모르겠음"). 판정 값은 데몬이 결과 뷰에 `mobileReviewable: boolean`과 이유 키로 싣는다(04·19에 요구). 앱이 크기를 세지 않는다.
- 수정 요청은 산출물을 열지 않아도 보낼 수 있다(받아들이는 조작이 아니다).

- 묶음 답하기: 묶음으로 열면 질문을 차례로 쌓아 보이고, 질문마다 응답을 고른 뒤 맨 아래 "고른 대로 보내기" 하나(04 §3.4). 휴대폰에서 답할 수 없는 질문은 묶음에서 "데스크톱에서"로 남는다. 조작 수는 01 §3.5.2 셈법을 따른다.
- 글 입력: 입력 칸의 글자 크기는 16px 이상으로 둔다(iOS Safari가 작은 입력 칸에 초점을 주면 화면을 확대한다 [지식]). 한국어 조합 중 Enter는 보내지 않는다(05 §3.9, 21 UI-D15). 보내기는 단추로만 한다.

#### 3.5.5 `SCR-M-BRIEF` 복귀 요약

```text
복귀 요약 · 어제 23:10 이후 (10시간)
─────────────────────────────────────────
Goal과 바뀐 기준
  Goal 2: 완료 기준에 "도입부는 장면으로" 임시 적용 중
지금 선택이 필요함 (1)       [질문 15 카드(접힘)]
확인하면 좋은 것 (2)         [질문 14][질문 16]
답이 없어 가정대로 정해진 질문 (1)
  질문 13 · "참고 자료는 블로그 글만" · 02:10 확정                    [이의]
진행 중인 작업 (1)
  WorkUnit 31 본문 1절 초안 · 다음 단계: 제출 후 멈춤
그대로 두면
  09:40쯤 1절 초안이 제출되고 결과 확인을 기다립니다
돌아온 뒤 달라진 점 (Concern별 한 줄)
  Concern 12  방향 2 · 이해 3 · 실제 3 · 반대 근거 1      ›데스크톱에서
왜 중요한가 (줄여 보임: 항목 2)                          ›데스크톱에서
에이전트가 정한 것 4                                     ›
─────────────────────────────────────────
[여기까지 봤음]  휴대폰에서 줄여 본 항목은 다음 데스크톱 복귀 요약에 다시 보입니다
```

- 뷰: `view:brief`(04 §3.2). 03 §3.12의 요약판 범위(1·4·5·6·7절 + 2·3절은 Concern별 한 줄)를 따른다. 줄인 한 줄에도 반대 근거·이견·깨진 가정의 개수는 보인다. 3·7절이 늦게 오면 "평가를 만드는 중"을 보인다(04 §3.2).
- "여기까지 봤음" → `brief.acknowledge { upToSeq, compact: true }`(D0, 보기). 데몬은 이 확인으로 사람 단위 확인 cursor를 옮기되, 줄여 보인 2·3절의 반대 근거·이견·깨진 가정 항목을 다음 데스크톱 복귀 요약에 "휴대폰에서 줄여 본 항목" 절로 남긴다([판정 J-137], 04·19·12에 요구).
- 읽는 동안 내용을 바꾸지 않는다(04 §3.2 "낡음" 행, 19 `untrackView`).
- 5절 "확인하면 좋은 것" 아래에 "답이 없어 가정대로 정해진 질문 n"과 항목마다 [이의]를 둔다. 원인(부재, 데몬 정지)과 관계없이 같다(04 §3.2 5절). 머리 줄 `headline.assumedWhileAway`의 개수도 이 줄과 같은 값이다. [이의]는 `OVL-CONTEST` 시트로 연다(§3.5.6).
- 자동으로 열지 않는다. 부재 2시간 뒤 복귀 때 요약을 자동으로 여는 기준(14 §3.13.8)은 데스크톱·TUI 복귀에만 적용한다. 휴대폰은 `user_return`을 일으키지 않으므로(§3.3.7) 요약은 아래 탭 "복귀 요약"에서 연다.

#### 3.5.6 `SCR-M-AUTO` 에이전트가 정한 것

```text
에이전트가 정한 것 · 마지막 확인 이후
─────────────────────────────────────────
▾ 루프 전환 (2)
  선택 41 · Concern 12 · 어제 23:30
  탐침 → 구조: 나누기
  묻지 않은 이유: 답에 따라 결과가 크게 달라지지 않습니다
                                         [이의 걸기]
▸ 상황 판정 (1)    ▸ 일반 선택 (1)
처리 중인 이의 (1)
```

- 뷰: `view:autonomous`(04 §3.5). 화면을 열어 목록이 보이면 `autonomous.markSeen { upToSeq: meta.asOfSeq }`를 한 번 보낸다(열람 표시이며 승인이 아니다). 항목별 [봤음] 단추는 두지 않는다. 탭의 표시는 숫자 대신 점이다(§3.5.1). 사람에게 확인 조작을 요구하지 않기 위해서다(03·04에 같은 변경을 요구).
- [이의 걸기]는 아래 시트로 `OVL-CONTEST`(04 §3.26)의 같은 내용을 보인다: 이유(선택), "이유는 모르겠지만 맞지 않습니다", 원하는 처리(다시 열기 기본 / 다음부터 묻기 / 기록만), 영향 미리보기, [선택 41에 이의 걸기]. 명령은 `objection.file`([판정 J-111], 이벤트 09 `objection.filed`).
- 적용된 뒤 영향 표시에 재결정 질문이 생겼으면 "다시 정할 질문: 질문 18 [질문 18 지금 정하기]"를 보이고 누르면 그 질문을 연다(질문함을 거치지 않는다).
- 사람 조작: 이유 없이 D1, 이유 입력은 D1 + I1([판정 J-20]).

#### 3.5.7 `SCR-M-WORK` 진행 중인 작업

- 뷰: 홈 뷰의 진행 작업 구역(04 §3.1) 또는 `tray` 뷰. 진행 작업 카드의 한눈 깊이(04 §3.0.7: 머리, 지금 하는 일, 다음 단계, 맡긴 범위 한 줄, 마지막 중요한 변화)만 보인다.
- 동작: "안전하게 멈추기"(05 §3.6.1)만 둔다. 확인 시트 "지금 하던 도구 실행이 끝나는 지점에서 멈춥니다. 다시 시작하면 그 지점부터 이어집니다." → [WorkUnit 31 안전하게 멈추기] → `work.stop`. 방향 바꾸기·범위 좁히기·작업 중단은 데스크톱에서.
- 낡음일 때 "지금 하는 일"은 "14:02에 하던 일"로 바뀐다(04 §3.0.4 규칙 2).

#### 3.5.8 `SCR-M-CONNECT` 연결

```text
연결
─────────────────────────────────────────
● 연결됨 · server.tail7ad0b4.ts.net:8448
  마지막 이벤트 14:02 · 서버 Helm 0.4.0
이 기기   기기 9 iPhone · 알림 켜짐(내용 숨김)
─────────────────────────────────────────
서버 상태  안전 모드 · 10:02부터 · 사유: 짧은 시간에 세 번 비정상 종료됨
           에이전트 작업이 멈춰 있습니다. 질문에 답할 수는 있습니다
           [안전 모드 풀고 작업 다시 시작하기]
─────────────────────────────────────────
보내지 못한 조작 (1)
  질문 16 답 "넣기" · 22:41 · [내용 보기] [질문 16 다시 보내기]
─────────────────────────────────────────
연결 점검 [점검 실행]
  1 서버 이름 ✓  2 서버 PC까지 경로 ✓  3 Helm 서버 응답 ✓  4 인증 ✓  5 판 ✓
─────────────────────────────────────────
기기
  기기 7 MacBook        마지막 사용 지금     [기기 7 권한 없애기]
  기기 9 iPhone (이 기기)                    [이 휴대폰 권한 없애기]
```

- 04 §3.19의 일부. 연결 방식 고르기, SSH, 새 기기 페어링은 없다. 다른 기기 권한 없애기는 된다(`devicesLimited`). 권한 없애기는 모두 확인 시트를 거친다(§3.3.8 문구).
- 안전 모드: 사유(`DaemonStatus.safeMode.reason`, 비정상 종료 횟수)와 [안전 모드 풀고 작업 다시 시작하기] → 확인 시트 "멈춰 있던 에이전트 작업과 예약 실행이 다시 시작됩니다." → `daemon.exitSafeMode`. 같은 단추를 04 `SCR-CONNECT`·`SCR-RECOVERY`에도 두도록 04에 요구한다.
- 읽기 전용: 사유별 문장(05 키, 19 `server.modeChanged.reason`·`DaemonStatus.readOnlyReasons`). 예: `disk_critical` → "서버 디스크가 거의 찼습니다. 서버에서 공간을 비워야 다시 쓸 수 있습니다." 휴대폰에서 할 수 있는 일이 없으면 그렇다고 쓴다.
- 보내지 못한 조작: §3.3.5의 진행 중 명령 중 결과를 모르는 것. 다시 보내기 전에 그 질문 화면을 열어 바뀐 상황을 보게 한다(04 §3.19와 같은 규칙).
- 연결 점검 5단계와 문구는 04 §3.19를 따르되 1단계 실패 문구에 "Tailscale 앱에서 연결을 켜세요"를 쓴다.

#### 3.5.9 `SCR-M-SETTINGS` 설정

| 항목 | 값 | 저장 위치 |
|---|---|---|
| 알림 받기 | 켬/끔. 켜면 권한 요청과 구독(§3.3.4 6단계) | 기기(권한) + 데몬(`device.registerPush`) |
| 알림에 내용 보이기 | 끔(기본) / 켬 (`notifications.showContent`) | 기기(서비스 워커가 IndexedDB에서 읽음) |
| 알릴 것 | "멈춰 있는 질문과 알림 강도 질문"(기본, `minUrgency: notice`, [결정 48]) / "멈춰 있는 질문만"(`interrupt`) | 데몬 등록 |
| 알림 시험 보내기 | [시험 알림 보내기] → `device.testPush` | - |
| 조용한 시간·방해 금지 | 데몬 설정(05 §3.7.4, 14 `attention.quietHours`·`attention.snoozeUntil`, 기기 공통). 조용한 시간은 같은 값을 보이고 바꾼다(`settings.update`, [판정 J-227]). 방해 금지는 같은 값을 보기만 하고, 바꾸기는 데스크톱·TUI에서 한다(판정 J-166). 방해 금지 중 예외 "만료 임박만" | 데몬 |
| 결과 확인 알림 | 알리지 않음(기본) / 하루 한 번 묶음(시각 `notifications.resultReviewDigestAt`, 기본 19:00) / 결과마다 즉시. 휴대폰에서 결과는 산출물을 본 뒤에만 확인한다(§3.5.4) [결정 56, 판정 J-189] | 데몬(`settings.update`, 기록 `setting.changed`) |
| 표시 | 테마(시스템/밝게/어둡게), 글자 크기, 투명 효과(기본 줄임, §3.5.12) | 기기 |
| 이 기기의 사본 지우기 | 뷰 캐시·초안 지우기 | 기기 |
| 정보 | 앱 판(= 데몬 릴리스), 프로토콜 판, 열린 소스 고지 링크 | - |

#### 3.5.10 `SCR-M-ONBOARD` 처음 연결 (03에 새 화면 ID 요구)

- 단계: (1) 설치 안내(브라우저 탭으로 열렸을 때만): 공유 단추 → "홈 화면에 추가" 그림 안내. iOS 26 미만이면 §3.1.6 문구. (2) 연결: 코드 입력, 기기 이름, [이 휴대폰 연결하기]. (3) 알림 켜기와 조용한 시간: [알림 켜기] / [나중에]. (4) Tailscale 권장 설정 한 줄 안내(VPN On Demand).
- 03 §3.6 표에 `SCR-M-ONBOARD`(처음 연결, 앱, 데스크톱 대응 `SCR-ONBOARD`)를 더해 달라고 요구한다.

#### 3.5.11 공통 상태와 결정 버튼 활성 조건 [04 §3.0.4·20 §3.8.9와 같은 규칙]

연결 실패 진단 순서(`platform/pwa/probe.ts`): 웹 앱은 WebSocket 실패의 HTTP 상태를 알 수 없으므로 실패 뒤 다음을 차례로 한다.

| 시험 | 결과 | 사용자용 상태와 문장(05 키로 요구) |
|---|---|---|
| `fetch("/healthz")` | 네트워크 오류(이름 찾기·연결 실패) | 연결 안 됨: "서버 PC에 연결할 수 없습니다. 휴대폰의 Tailscale 앱이 켜져 있는지, 서버 PC가 켜져 있는지 확인하세요." 작업이 계속되고 있다고 말하지 않는다 |
| | 502·504(serve는 응답, 데몬 없음) | Helm 서버 응답 없음: "서버 PC까지는 연결되지만 Helm 서버가 응답하지 않습니다." |
| | 200·503 | 데몬은 있음 → `GET /m/whoami`. 401이면 인증 실패, 200이면 일시 오류로 보고 백오프 |

| 상태(20 `UserConnState`) | 휴대폰 표시 | 결정 동작 |
|---|---|---|
| 연결됨, 느림, 안전 모드 | 머리 점 + 글자. 안전 모드는 띠 "에이전트 작업이 멈춰 있습니다 · 연결 화면에서 풀 수 있습니다" | 가능 |
| 다시 연결하는 중(숨김에서 돌아옴 포함), 다시 맞추는 중 | 머리 "다시 연결하는 중", 띠 "14:02 기준" | 막음, 초안 보존 |
| 연결 안 됨, Helm 서버 응답 없음 | 위 진단 문장 + [연결 화면 열기] | 막음 |
| 인증 실패(폐기·만료·쿠키 없음) | 사유별 문장(§3.3.5) → `SCR-M-ONBOARD` | 막음 |
| 판 불일치 | 서비스 워커가 옛 묶음을 들고 있는 경우뿐이다. "새 판을 받는 중입니다" 뒤 자동 새로고침(§3.6.4) | 막음 |
| 읽기 전용, 서버 종료 중 | 사유별 문장(§3.5.8), 04 §3.0.4 | 막음 |
| 뷰 낡음(서버 `freshness` ≠ `current`) | 화면 머리 띠 | 그 화면만 막음 |
| 다른 창에서 열려 있음(`follower`) | "다른 창에서 Helm이 열려 있습니다" | 막음 |

결정 버튼 활성 조건(질문 화면과 이의·멈추기·안전 모드 시트 공통):

```ts
// apps/mobile/src/screens/decide.ts — 20 §3.8.9 decisionsAllowed(@helm/client-react)에 휴대폰 조건을 더한 것
import { decisionsAllowed, type UserConnState } from "@helm/client-react";
import type { Freshness } from "@helm/protocol";
import type { QuestionForm, ResponseOptionId } from "@helm/domain";

export function mobileDecisionAllowed(i: {
  conn: UserConnState; serverFreshness: Freshness;
  questionStatus?: "pending" | "delivered" | "answered" | "assumed" | "withdrawn" | "expired";
  form?: QuestionForm; option?: ResponseOptionId | "accepted" | "revision_requested";
  mobileReviewable?: boolean; outputsViewed?: boolean;
  sending: boolean; visible: boolean; leader: boolean;
}): { allowed: boolean; reasonKey?: string } {
  if (!decisionsAllowed(i.conn, { serverFreshness: i.serverFreshness })) return { allowed: false, reasonKey: "notice.decide.offline" };
  if (!i.visible || !i.leader) return { allowed: false };
  if (i.sending) return { allowed: false };                                        // 04 §3.0.6 규칙 2
  if (i.questionStatus && !["pending", "delivered"].includes(i.questionStatus)) return { allowed: false, reasonKey: "notice.question.resolved" };
  if (i.form && i.option && !mobileSupports(i.form, i.option)) return { allowed: false, reasonKey: "notice.mobile.desktopOnly" };   // §3.5.4 표
  if (i.form === "result_review" && i.option === "accepted") {
    if (i.mobileReviewable === false) return { allowed: false, reasonKey: "notice.mobile.reviewOnDesktop" };
    if (!i.outputsViewed) return { allowed: false, reasonKey: "notice.mobile.openOutputFirst" };   // 판정 J-139
  }
  return { allowed: true };
}
```

- 규칙 근거: 04 §3.0.4 규칙 3(서버 신선도와 연결로만 막는다), 05 §3.1.9 카드 상태 기계, 20 §3.8.9. `UserConnState`와 `decisionsAllowed`의 정의·반환형은 20이 정한다(이 문서는 쓰기만 한다). 휴대폰만의 조건은 `visible`, `leader`, `mobileSupports`, 결과 확인의 산출물 조건이다.
- 막힌 버튼에는 이유를 붙인다(04 §3.0.4 규칙 4). 새 문구 키 `notice.mobile.desktopOnly`("데스크톱에서 할 수 있습니다."), `notice.mobile.reviewOnDesktop`("이 결과는 데스크톱에서 확인할 수 있습니다. 미룰 수 있습니다."), `notice.mobile.openOutputFirst`("산출물을 연 뒤 결과를 확인할 수 있습니다.")는 05에 요구한다.

#### 3.5.12 21과 나눠 쓰는 범위 [제안, 21 §3.13에 대한 답]

| 21 항목 | 모바일 |
|---|---|
| `@helm/ui-tokens` | 그대로 쓴다. 밀도 `data-density="touch"`(컨트롤 44px). 입력 칸 글자 16px 이상 |
| 유리 재질(U-22) | 모바일 기본값은 `data-transparency="reduced"`(불투명 표면). 휴대폰 GPU 비용과 밝은 실외에서의 가독성 때문이다. 설정에서 켤 수 있다. 읽고 판단하는 영역은 켜도 불투명에 가깝게(05 §3.9) |
| `@helm/ui` 부품 | `QuestionCard`, `QuestionInbox`, `ChoiceImpactEcho`, `AutonomousChoiceList`(항목별 [봤음] 없는 변형), `SinceLastVisit`(`variant="compact"`), `FreshnessIndicator`, `ConnectionIndicator`, 상태 배지, `ContestButton`. 새로 필요한 L0 부품 `BottomSheet`(그 밖에 메뉴·이의·확인 시트)는 플랫폼 중립이므로 `@helm/ui`에 둔다(21에 요구) |
| 모바일 전용 셸 | `MobileShell`, `MobileHeader`, `MobileTabBar`, `InstallGuide`, `PairCodeInput`, `CoverOnHide`, `OutputViewer`는 `apps/mobile/src/shell`·`screens`에 둔다 |
| 호버 | 쓰지 않는다(21 §3.13 규칙 2) |
| 키 지도 | 비어 있다(21 §3.13 규칙 4) |

### 3.6 빌드·배포

#### 3.6.1 빌드 위치와 릴리스 [제안, MOB-D10]

- 빌드는 서버(WSL)에서 한다. `pnpm --filter @helm/mobile build` → `apps/mobile/dist/`(해시 이름 묶음, `sw.js`, `manifest.webmanifest`, 아이콘). Mac이 필요 없다.
- 데몬 릴리스 만들기(17 §3.10)가 `apps/mobile/dist/`를 릴리스 폴더의 `web/mobile/`로 복사한다. 업그레이드·되돌리기(17)를 따라 휴대폰 화면도 같이 바뀌고 같이 돌아간다.
- 묶음 크기 목표: 첫 내려받기 gzip 400 KiB 이하(질문함·질문 화면 기준).

#### 3.6.2 just 레시피 [제안, 06 §3.16 표에 더함]

| 레시피 | 하는 일 | `verify`에 넣는가 |
|---|---|---|
| `mobile-dev` | Vite 개발 서버(127.0.0.1:5174) + 가짜 데몬(20 §3.13.3과 같은 것). 데스크톱 브라우저의 휴대폰 뷰포트로 본다 | 아니요 |
| `mobile-build` | PWA 묶음 빌드. `build`가 부른다 | 아니요(`build`) |
| `mobile-check` | 타입 검사·lint·단위·컴포넌트 시험(`apps/mobile`, 서비스 워커 문구 생성 포함). 워크스페이스 `check`·`test`에 포함된다 | 예(워크스페이스 단계로) |
| `mobile-e2e` | Playwright WebKit(iPhone 뷰포트) + 가짜 데몬 + 가짜 푸시 서비스: 페어링, 질문 답하기, 숨김·복귀, 초안, 낡음, 결과 확인 산출물 조건 | 아니요(20의 `app-e2e`와 같은 취급) |
| `mobile-shot` | Playwright WebKit으로 `SCR-M-*` 화면 캡처, 디자인과 비교(`just shot`이 부름). 뷰포트는 iPhone 15(393×852), iPad 세로 768×1024, iPad 가로 1024×768이다(§3.1.6의 두 칸 기준) | 아니요 |
| `mobile-vapid-keygen` | VAPID 키 쌍을 한 번 만들어 보인다(§3.4.7) | 아니요 |
| `mobile-push-test` | `helm push test --device <dv_id>`: 정식 데몬에서 시험 푸시 하나 | 아니요 |

#### 3.6.3 설치 절차 (사람, 한 번) [제안, 17 §3.16 점검표를 따른다]

설치 순서의 정본은 17 §3.16 점검표다. 기능 플래그 `clients.mobile`을 켜는 것은 2단계 활성화(23 A2)이고, VAPID 키 입력(행 2), 홈랩 H-1 확인(행 3), 휴대폰 페어링과 시험 알림(행 8)도 그 표에 있다. 이 절은 휴대폰에서 할 일만 적는다.

1. iPhone: Tailscale 켜기 → QR 읽기 → Safari → 공유 → 홈 화면에 추가 → 홈 화면에서 Helm 열기 → 코드 입력 → [이 휴대폰 연결하기] → [알림 켜기] → 조용한 시간 → [시험 알림 보내기].
2. iPhone: Tailscale 앱에서 VPN On Demand 설정(권장).

#### 3.6.4 갱신 [제안]

- 서비스 워커는 `vite-plugin-pwa`의 `injectManifest`로 만든다(X-15). 등록 방식은 "새 서비스 워커가 기다렸다가 다음 실행 때 적용"이다. 쓰는 도중 화면이 바뀌지 않게 한다.
- 앱이 보이게 될 때마다 `registration.update()`를 부른다. 새 판이 대기 중이고 연결이 끊긴 상태(숨김 직후 다시 연결하기 전)이면 그때 적용하고 새로고침한다. 초안은 IndexedDB에 있으므로 잃지 않는다.
- 데몬이 업그레이드되어 `hello`가 `protocol.unsupported`로 끝나면(옛 서비스 워커 묶음) 곧바로 갱신을 적용한다.
- 매니페스트의 `id`는 `/m/`로 고정한다. 바꾸면 iOS가 다른 앱으로 본다(X-4).

### 3.7 대표 시퀀스

#### 3.7.1 UC-04 대안 M: 밤사이 권리 게이트를 휴대폰에서 허락

```text
 1 런타임: question.recorded(Q-B, rights, blocking) → 커널 D-1 immediate → notify 지시
 2 전달기: 연결된 기기 없음(모든 기기 offline → 14 함수로 부재), pushReachable=[dv_iphone] → urgencyOf = interrupt
          planPush → dv_iphone delay 0 → POST web.push.apple.com (VAPID, payload §3.4.4) → 201
          → push.sent{outcome:"accepted"}, question.delivered{channel:"push", targetDevices:[dv_iphone]}
 3 iPhone: 서비스 워커 push → showContent false → 05 notif.hidden 문구가 잠금 화면에
 4 사람: 알림 누름 → Face ID → 웹 앱 /m/q/qs_B ("질문 n · Concern m을 받는 중", "다시 연결하는 중")
 5 앱: client.start → WSS 업그레이드(Cookie __Host-helm_dt, Origin 일치) → hello(deviceId) → ready
          → presence.report{active, SCR-M-QUESTION, qs_B} → 데몬: presence.changed(active), question.seen (user_return 경계는 발화하지 않는다, 판정 J-173)
          → view.get question → 버튼 활성
 6 사람: [작업 브랜치 vite-migration을 원격 저장소에 올리기] (D1)
 7 앱: question.answer{questionId, answer:{option:"approve"}, basisSeq, idempotencyKey}
          → question.answered(via {device dv_iphone, listener tailnet}) → 영향 표시
 8 데스크톱(나중에 열림): 재전송으로 question.answered 받음 → 질문함에서 "다른 기기에서 답함"
```

#### 3.7.2 보내는 중에 화면을 끔

```text
 1 사람: [넣기] → question.answer 전송(putPending 완료) → visibilitychange hidden
 2 앱: hiding → 진행 중 1 → fetch POST /m/cmd (keepalive, 같은 멱등 키) → 2초 기다림 → client.stop()(1000)
 3 데몬: /m/cmd 또는 WebSocket 중 먼저 온 것을 처리한다. 둘째는 멱등 결과(19 §3.9.2)
 4 사람: 10분 뒤 다시 엶 → visible → retryNow → hello → syncing: 진행 중 명령함의 같은 idempotencyKey로 다시 보냄
 5 데몬: 이미 처리했으면 멱등 결과 그대로, 아니면 지금 처리. basisSeq 이후 상태가 바뀌었으면 3004, 이미 답이 있으면 3008 → 04 §3.0.5
 6 결과를 끝내 모르면 머리 띠 "보내지 못한 답 1개" → SCR-M-CONNECT 목록
```

#### 3.7.3 다른 기기를 쓰는 중

```text
 1 Mac 앱이 연결되어 있고 presence active → 질문 Q(interrupt) 즉시 전달 → planPush: active 기기 있음 → 푸시 없음. Mac이 OS 알림
 2 Mac presence idle(입력 없음 5분, 아직 부재 아님) → 질문 R(interrupt) → planPush: live 있음 → dv_iphone delay 60s, 타이머 push_followup
 3 60초 안에 Mac에서 R을 열면 question.seen → 타이머가 울릴 때 버림. 안 열면 휴대폰에 푸시
 4 같은 상황에서 질문 S(notice) → Mac이 아직 부재가 아님(판정 J-172) → 푸시 없음. Mac의 OS 알림(05 강도 규칙)으로 끝
```

## 4. 실패·예외·경계 사례

| ID | 사례 | 처리 [제안] |
|---|---|---|
| MF-01 | 휴대폰 Tailscale이 꺼져 있음 | `/healthz` 네트워크 오류 → "Tailscale 앱이 켜져 있는지" 문장(§3.5.11), 캐시 읽기 전용. 푸시는 계속 받는다 |
| MF-02 | 알림을 눌렀는데 데몬이 꺼져 있음 | 자리 표시 카드를 보이고 "Helm 서버가 응답하지 않습니다"(502·504) 또는 "서버 PC에 연결할 수 없습니다"(네트워크 오류). 결정 막음, 초안 보존 |
| MF-03 | 알림을 눌렀는데 그 질문이 이미 답해짐·가정 확정·철회 | 04 §3.0.5 문장. 앱이 보이게 될 때 그런 알림을 닫는다(§3.4.9) |
| MF-04 | 사용자가 iOS 설정에서 Helm 알림을 끔 | 다음 실행 때 `Notification.permission == "denied"` → `device.unregisterPush(permission_lost)`. 설정 화면에 "iOS 설정 > 알림에서 Helm을 켜세요". 데몬은 그 기기를 `pushReachable`에서 뺀다 |
| MF-05 | 푸시 서비스가 410·404 | 등록 삭제, `device.push_unregistered(gone)`. 다음 실행 때 다시 구독 |
| MF-06 | 푸시 서비스 장애(5xx, 429, 시간 초과) | §3.4.7 재시도. 첫 시도가 모두 실패하면 `question.delivered.channel = brief`. 실패가 이어지면 `failing`과 17 점검. 질문은 질문함·복귀 요약에 그대로 있다 |
| MF-07 | 클라이언트가 내부 주소나 허용 밖 호스트를 엔드포인트로 등록하려 함 | `push.endpoint_not_allowed` 거부(§3.4.6 검증 1). 해석 주소가 사설·tailnet이면 보내지 않음. 3xx는 따르지 않음 |
| MF-08 | 브라우저 탭(설치 전)에서 페어링하려 함 | 연결 단계를 보이지 않는다(§3.3.4). 설치 안내만 |
| MF-09 | iOS가 웹 앱 저장소를 지움(쿠키 포함) | `whoami` 401 → `SCR-M-ONBOARD`. 서버 쪽 기기는 남아 있으므로 데스크톱에서 옛 기기 권한을 없애고 새로 페어링한다. 푸시 구독도 사라졌으면 데몬은 410을 받아 정리한다 |
| MF-10 | 쿠키는 남았는데 `localStorage`의 `deviceId`만 지워짐 | `whoami`로 복구(§3.3.3) |
| MF-11 | 데몬 공개 주소(`publicOrigin`)가 바뀜 | 출처가 바뀌어 쿠키·서비스 워커·홈 화면 앱이 모두 새 출처가 된다. 새로 설치·페어링한다. 옛 기기는 데스크톱에서 권한을 없앤다 |
| MF-12 | VAPID 키 교체 | §3.4.7. 모든 등록 정리, 다음 실행 때 다시 구독. 그 사이 푸시 없음 |
| MF-13 | 같은 질문을 휴대폰과 데스크톱에서 동시에 답함 | 먼저 받아들여진 답. 늦은 쪽 3008 또는 3004 → "이미 처리됨"(04 §4) |
| MF-14 | 보내는 중에 화면을 끔 | §3.7.2 |
| MF-15 | 앱이 오래 숨겨져 위치가 보존 범위 밖 | `2001` → 스냅숏 경로(19 §3.5.5). 뷰 다시 받기 |
| MF-16 | iPhone과 iPad 둘 다 푸시 등록 | 둘 다 받는다(같은 `tag`). 한쪽에서 답하면 다른 쪽 알림은 그 기기가 열릴 때 닫힌다 |
| MF-17 | 방해 금지·조용한 시간 중 권리 게이트 | 푸시 없음(예외 "만료 임박만"이면 승격만). 끝날 때 묶음 푸시 1개(§3.4.3) |
| MF-18 | 같은 질문이 만료 임박으로 승격 | 두 번째 푸시(같은 `tag`, 앞 알림을 바꿈). 막지 않는 정보 질문의 승격은 `notice`. 세 번째는 없다 |
| MF-19 | 시간당 알림이 상한을 넘음 | 사람 기준 상한 `attention.interruptsPerHour`(기본 2, 데스크톱 OS 알림과 휴대폰 푸시를 합쳐 셈, 권리 게이트 즉시 전달과 만료 임박 승격은 제외)을 넘으면 그 시간 끝에 묶음 1개(§3.4.3, 판정 J-171) |
| MF-20 | 서비스 워커가 payload를 해석하지 못함 | 05 `notif.hidden.*` 문구로 띄운다. iOS 26은 선언된 알림이 대신 뜬다 |
| MF-21 | 다른 Helm 서버의 푸시(서버 id 불일치) | 중립 알림만, 누르면 `/m/` |
| MF-22 | 판 불일치(옛 서비스 워커 묶음) | §3.6.4 즉시 갱신 |
| MF-23 | iOS 26 미만에서 열림 | §3.1.6 문구, 페어링 칸 없음([결정 49]) |
| MF-24 | 저전력 모드·집중 모드 | iOS가 알림 표시를 늦추거나 숨긴다(X-4 집중 모드). Helm은 바꾸지 않는다 |
| MF-25 | 휴대폰을 잃음 | §3.3.8 분실 대응. 피해 범위는 `decideMobile` scope로 줄어 있다 |
| MF-26 | 쿠키가 실린 요청이 다른 출처에서 옴 | 다른 사이트는 `SameSite=Strict`로 브라우저가 싣지 않는다. 같은 호스트의 다른 포트(8443~8447)는 same-site라 실릴 수 있으나 Origin 정확 일치에서 403 |
| MF-27 | 모델 문장에 스크립트·링크 위조 | 글자로만 그린다(21). CSP가 인라인 스크립트를 막는다. 18 T18-32 |
| MF-28 | 모델이 만든 파일(HTML, SVG, XHTML 등)을 `/files/*`로 열기 | `sandbox` CSP와 인라인 허용 목록으로 같은 출처 스크립트가 실행되지 않는다. 허용 목록 밖은 내려받기로만 |
| MF-29 | 화면이 낡은 채로 결정 버튼 누름 | 막힘(§3.5.11). 경합이면 데몬 3004 → 04 §3.0.5 |
| MF-30 | 페어링 코드 오타 5회 | 코드 무효(18 §3.7.4). 데스크톱에서 새 코드 |
| MF-31 | 같은 호스트의 다른 홈랩 서비스가 쿠키를 받음·덮어씀(X-16) | 그 서비스의 요청 로그에 쿠키 값이 남을 수 있다(홈랩 서비스는 사용자 소유라 받아들인다). 덮어쓰면 휴대폰 인증이 실패하고 다시 페어링한다. 근본 대응은 Helm 전용 serve 호스트 이름(MQ-15) |
| MF-32 | 가정 확정 뒤 휴대폰 답이 도착 | 3008 + `assumedValue` → 쓰던 답을 이의 초안으로([판정 J-120]) |
| MF-33 | 같은 기기에 Helm 창이 둘 | 잠금을 얻은 창만 연결·재전송한다. 다른 창은 읽기 전용(§3.3.5 `follower`) |
| MF-34 | 기기 토큰 유휴 만료(1005 expired) | 캐시·초안을 남기고 재페어링 안내. 진행 중 명령은 자동 재전송하지 않는다(§3.3.5) |
| MF-35 | 데몬 상태 사건(안전 모드·읽기 전용 진입) 때 사람이 없음 | `system` 푸시 1회(§3.4.2). 데몬이 꺼진 경우는 Helm 푸시가 없다 |
| MF-36 | `/m/cmd`와 WebSocket 재전송이 겹침 | 같은 멱등 키라 한 번만 적용된다(19 §3.9) |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 결정 47의 구현 형태와 경로 B 전환 조건(§3.1) | 01, 06, 20, 23, 24 |
| 휴대폰에서 하는 일·하지 않는 일(§1.2, §1.3), 질문 형식별 휴대폰 동작과 결과 확인 조건(§3.5.4) | 01, 02, 03, 04 |
| 모바일 화면 레이아웃·경로·상태·결정 버튼 조건·연결 진단(§3.5) | 03, 04, 05, 21, 22 |
| 쿠키 인증, `decideMobile` scope, 모바일 HTTP 경로, `/files/*` 격리, 페어링 HTTP(§3.3.2~§3.3.4) | 17, 18, 19 |
| 수명주기와 접속 상태 보고 규칙(§3.3.5, §3.3.7) | 09, 11, 14, 19, 20 |
| 푸시 조건, payload, 등록 형식, 저장 열, 이벤트, 메서드, 송신 규칙(§3.4) | 05, 08, 09, 10, 11, 16, 17, 18, 19 |
| 빌드·릴리스·레시피·설치 절차(§3.6) | 06, 17, 23 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01 | (1) 모바일 구현 방식을 결정 47·48·49로 적고 OQ-10 해소 문장을 고친다. (2) NFR에 모바일 항목: 알림 누름 → 결정 버튼 활성 p95 3초(Tailscale 연결 중)/6초(새로 연결), 질문 기록 → 푸시 표시 p95 10초(측정만). (3) NS-06의 범위를 26 §1.3으로. (4) §3.5.2 용어 표에 조작 셈법(묶음 답하기, 고쳐서 확정)을 한 줄씩 정한다(26 §3.4.8·§3.5.4가 따른다) |
| 02 | (1) UC-04 대안 M을 26 §3.7.1 단계로, 조작 수 보기 1 + D1. AC-04-09 세부: 휴대폰 답의 이벤트는 `via.deviceId`만 다르고 `listener`는 `tailnet`(19 `ListenerKind`), 휴대폰에서 비활성인 응답은 명령을 보내지 않는다. AC-04-08의 경로 값을 `tailnet`/`loopback`/`local`로. (2) UC-11에 휴대폰 페어링 대안(§3.3.4)과 설치 순서(비밀 범위 prod, `helm ops reload-secrets`, 17 점검표). (3) UC-17 A0에 "다른 기기 활동 중이면 푸시를 늦춤"(§3.7.3), 초안이 기기에만 있다는 한계. (4) AC-04-01을 05 `notif.hidden.*` 문구로. (5) UC-06에 휴대폰 확인의 `compact` 처리([판정 J-137]) |
| 03 | (1) §3.6·§3.12에 `SCR-M-ONBOARD`(처음 연결) 추가. (2) §3.12 질문 형식 표에서 `choose_one`을 "답함"으로, `result_review` 행에 [판정 J-139] 조건. (3) §3.4.2의 "휴대폰 화면은 범위 밖", §3.12의 "Tauri v2 모바일, PWA 등"을 결정 47과 26 참조로. `SCR-M-CONNECT` 내용에서 "페어링"을 "이 기기 권한 없애기, 안전 모드 풀기"로. (4) 모바일 경로 `/m/…`(§3.5.2) 참조. (5) 미루기 기본값을 "다음 데스크톱 접속까지"(11 `user_return`)로(MQ-11 해소, §3.5.3). (6) 정한 것 탭 배지를 점으로, 항목별 [봤음] 삭제(§3.5.6). (7) "복구 판단" → "복구 선택", "복구 모드" → "읽기 전용"([판정 J-115]) |
| 04 | (1) `SCR-CONNECT` 새 기기 페어링에 "휴대폰" 선택지: 설치 주소 QR + 코드 + 안내 문구(§3.3.4 1단계). (2) `SCR-CONNECT` 서버 상태와 `SCR-RECOVERY` 머리에 안전 모드 사유와 [안전 모드 풀고 작업 다시 시작하기](확인 시트, `daemon.exitSafeMode`). (3) 읽기 전용 사유별 배너(`DaemonStatus.readOnlyReasons`). (4) 연결 안 됨 배너의 "작업은 서버에서 계속되고 있을 수 있습니다"를 `/healthz` 진단(§3.5.11)에 따라 나눈다. (5) 기기 목록에 푸시 상태 칸. (6) 결과 뷰에 `mobileReviewable`과 이유 키([판정 J-139]). (7) 복귀 요약에 "휴대폰에서 줄여 본 항목" 절([판정 J-137]). (8) `SCR-AUTO` 항목별 [봤음]을 빼고 목록 열람으로 표시(§3.5.6), 이의 영향 표시에 "다시 정할 질문" 링크, 이유 입력은 I로 센다. (9) 설정 화면에 결과 확인 알림 `notifications.resultReview`와 시각(`resultReviewDigestAt`)을 보인다([판정 J-189]) |
| 05 | (1) §3.7.7 "앱이 꺼져 있으면 알림이 없다…"를 결정 47·48 기준으로. (2) `notif.hidden.title`·`notif.hidden.body.count`(개수 있는 형)·`notif.hidden.body.plain`(없는 형)을 정의한다. 18·19·26이 이 키 하나를 쓴다. (3) 새 키: `notif.push.test.*`, `notif.push.bundle.*`, `notif.system.safeMode.*`, `notif.system.readOnly.<사유>.*`, `label.mobile.tab.*`(탭 줄임형), `notice.mobile.desktopOnly`, `notice.mobile.reviewOnDesktop`, `notice.mobile.openOutputFirst`, `notice.mobile.install.*`, `notice.mobile.follower`, `err.push.permissionDenied`, `err.connection.serverPcUnreachable`, `err.connection.daemonUnreachable`, `err.daemon.readOnly.<사유>`. (4) 응답 이름 하나로: "먼저 알아보기", "범위 줄여 진행", "미루기", "에이전트가 정하게 두기"(`question.delegate`, 판정 J-177), "안전하게 멈추기", 연결 상태 "다시 연결하는 중"(26은 이 이름을 쓴다). (5) §3.7.2 "결과 확인" 행의 기본 알림을 `notifications.resultReview`(기본 `none`)로 바꾼다(판정 J-189). (6) 결과 확인 알림 문구 키 `notif.question.review.title`·`.body`를 정한다(26 §3.4.4의 `copy`가 쓴다). (7) §3.7.3 "notice 푸시는 연결된 기기가 하나도 없을 때만"을 판정 J-172 조건(데스크톱 부재, 휴대폰 active 아님)으로 고친다 |
| 06 | (1) `@helm/mobile` 의존 허용 표 행(§3.2.1). (2) `daemon/push`의 새 외부 의존 `web-push`(정확한 판 고정)와 R6 소유 규칙. (3) 06 §3.4.13 "(삭제) `@helm/client`"와 판정 §2의 어긋남 정리. (4) justfile 표에 §3.6.2 레시피. (5) 릴리스 폴더에 `web/mobile/`. (6) `.env.example`·`secrets.keys`에 `HELM_VAPID_PRIVATE_KEY`. (7) `packages/protocol/src/push-fallback.generated.ts` 생성 단계 |
| 08 | (1) Device `push`를 `PushRegistration`(§3.4.6)으로. `provider`는 `webpush`·`apns`. 표시는 `tokenHint`(해시 앞 8자) 하나. (2) Device에 `credentialCarrier`. (3) `Via.listener`를 19 `ListenerKind`(`tailnet`/`loopback`/`local`)로. (4) [판정 J-120]의 늦은 답 전이 삭제 |
| 09 | (1) `push_tokens`(판정 J-71)의 `token` 내용 규칙과 열 `vapid_key_id`, `last_ok_at`, `fail_count`, `last_error`(§3.4.6). (2) 이벤트 `device.push_registered`, `device.push_unregistered`, `push.sent`. (3) 타이머 목적 `push_followup`, `push_dnd_digest`, `push_hour_bundle`, `result_review_digest`(판정 J-189). (4) `question.delivered.channel`의 `push`·`brief` 규칙(§3.4.3). (5) `PresenceState`에서 `locked` 삭제([판정 J-119]). (6) `device.connected.listener`·`auth.denied.listener`를 `ListenerKind` 열거로. (7) `question.assumed`의 bumpsRevision([판정 J-120]) |
| 10 | 통치 명령 `device.register_push`, `device.unregister_push`, `device.test_push`. 검증 규칙은 §3.4.6. 거부 코드 `push.endpoint_not_allowed`, `push.vapid_key_mismatch`(내용 갈래). `decideMobile` scope 판정은 19·18 |
| 11 | (1) `PresenceSnapshot.pushReachable`과 `urgencyOf` 수정(§3.4.3, 부재는 14 함수, [판정 J-119], 타입 이름 [판정 J-185]). (2) 승격 강도: 막는 질문·권리 게이트 `interrupt`, 막지 않는 정보 질문 `notice`. (3) §3.5.3 전달 기록 1번의 channel 규칙과 전달기가 `planPush`를 부르는 지점. (4) §3.8.2 "알림" 행, A-4, Q-E20의 "휴대폰 푸시는 범위 밖"·`locked` 문장을 26으로. (5) 전달 기록 1번의 "`notice`는 연결된 기기가 없을 때만·시간당 3개" 요지를 판정 J-171·J-172 기준(데스크톱 부재, 사람 기준 상한)으로 고친다. `question.defer.until`의 "다음 데스크톱 접속"은 `user_return`이 이미 뜻하므로 따로 두지 않는다(MQ-11 해소). (6) 확인만: 11 §3.5.3 notify 지시의 `cause` 필드와 값 `result_review_immediate`·`result_review_digest`는 이미 이 판으로 있다([판정 J-238]) |
| 14 | §3.13.8 부재 함수에 기기 종류별 문턱 입력(`clientKind: mobile` 2분, 데스크톱 5분)과 `locked` 삭제. 11 타입 이름은 `PresenceSnapshot`이다([판정 J-185]) |
| 16 | (1) 푸시 지표: `push.sent` → 열람·답까지 시간, 실패율(§3.1.5 1번), 재페어링 횟수(2번). (2) `SCR-M-*` 열람을 데스크톱 대응 화면과 같은 종류로 센다. (3) 결과 확인 알림(판정 J-189)의 묶음·즉시 종류별 열람과 처리 시간을 센다 |
| 17 | (1) 릴리스에 `web/mobile/`. (2) `helm pair --mobile [--qr]`, `helm push test --device`. (3) 점검 ID `push_no_vapid_key`, `push_failing`. (4) 설정 키(`listeners.tailnet.publicOrigin` 하나에서 호스트를 계산): `push.enabled`(true), `push.webpush.subject`, `push.webpush.allowedEndpointSuffixes`(`["push.apple.com"]`), `push.followupDelayMs`(60000), `auth.allowedOrigins`(기본 `[publicOrigin]`, 판정 J-154), `notifications.resultReview`(`none`)와 `notifications.resultReviewDigestAt`(`"19:00"`, 판정 J-189). `push.hourlyCap`은 두지 않는다. 시간당 상한은 14의 `attention.interruptsPerHour` 하나로 읽는다(판정 J-171). 시험 설정에만 두는 `push.webpush.testEndpoints`(기본 없음, §3.4.6)를 새로 요구한다. (5) 설치 점검표 §3.16을 정본으로 두고 26 §3.6.3은 참조만 한다(17이 이미 합쳤다). (6) 안전 모드 해제 주체에 휴대폰 기기(`decideMobile`)를 포함 |
| 18 | (1) §3.18.2 4번을 26 §3.3.3 쿠키 방식으로 확정: `__Host-helm_dt`, Origin 정확 일치, GET의 `Sec-Fetch-Site` 규칙, `credentialCarrier`, 쿠키 판정 `cookieAuth`(19 정본, 판정 J-168), 헤더 경로는 Origin이 있으면 403. (2) §3.5에 모바일 행과 `decideMobile`·`devicesLimited` 허용 메서드 목록(§3.3.3 표). (3) §3.18.2 3번(키체인)은 경로 B에만 해당. (4) §3.18.2 6번(앱 잠금 기본 켬)과 7번(서명 증명 권장)에 26의 1차 끔 판단(MQ-03·MQ-05)을 받아들일지 적는다. (5) Q18-09를 결정 47로 닫는다. (6) 바깥 연결 허용 목록에 `push.apple.com` 접미사, 엔드포인트 등록·송신 검사(§3.4.6)를 위협 표에. (7) 같은 호스트 다른 포트 쿠키 위협(X-16, MF-31). (8) §3.19 폐기·만료 처리를 사유별로(§3.3.5): revoked → 뷰·명령함·blob 캐시 삭제, 초안 유지 / expired → 유지, 재전송 제외. (9) 표시 규칙(`tokenHint` 8자). (10) 보안 시험: T26-05~T26-11, T26-28~T26-30 |
| 19 | (1) §3.17을 26으로 확정([판정 J-118]): 토큰은 쿠키, `@helm/client/browser`에 쿠키 방식, 푸시 형식은 26 §3.4.4, 철회 푸시 없음, channel 값 `webpush`(`apns` 예약), ntfy 삭제. (2) `device.registerPush` params(§3.4.6), `device.pushConfig`(read), `device.testPush`(cmd), `DeviceInfo.push`. (3) HTTP 경로 표에 `/m/*`, `/m/pair`, `/m/whoami`, `/m/logout`, `/m/cmd`와 정적 서빙·인증 전 제한의 예외. (4) `/files/*` 응답 격리 헤더와 인라인 허용 목록(§3.3.2). (5) `PresenceState`에서 `locked` 삭제. (6) 연결 상태 기계에 `closed → connecting`(`start()` 재호출), 브라우저 전송의 인증 실패 판정(`/m/whoami`) 규칙, `carrier_mismatch`·`origin_mismatch` 사유. (7) scope `decideMobile`과 허용 메서드(§3.3.3). (8) `question.answer` params를 11 `AnswerValue`로(범위 줄여 진행 `instruction` 포함). (9) `brief.acknowledge`에 `compact`([판정 J-137]). (10) `presence.report.objectId`가 delivered 질문이면 데몬이 `question.seen`을 남기는 규칙. (11) `contest.file` → `objection.file`([판정 J-111]). (12) 확인만: `settings.update` 행(휴대폰은 `notifications` 섹션과 `attention.quietHours`만, 결과 확인 알림 키 포함)과 `result.accept` 행(휴대폰은 `accept`·`request_changes`만)은 이미 이 판으로 맞춰져 있다([판정 J-166], [판정 J-189], [판정 J-227]) |
| 20 | (1) §3.14 `PlatformAdapter`에 선택 필드 `push?`(`permission`, `subscribe`, `current`, `unsubscribe`)와 `lifecycle?`(`onHidden`, `onVisible`). (2) `UserConnState` 값 목록과 needsUser 원인 → 사유 표를 정하고 `decisionsAllowed`를 `@helm/client-react`에 둔다(26 §3.5.11이 가져다 쓴다). (3) 딥 링크 해석 표에 모바일 경로. (4) §3.10.1 "별도 푸시 채널은 없다"를 결정 47 기준으로. (5) `client-react`의 IndexedDB 이름을 앱별로. (6) 폐기·만료 처리 규칙을 18 요구 (8)과 같게. (7) 기기별 시간당 상한 키를 두지 않고, 시간당 상한은 14 `attention.interruptsPerHour` 하나로 읽는다([판정 J-171]). 결과 확인 알림 설정은 데몬 설정이라 데스크톱 기기 설정에 두지 않는다([판정 J-189]) |
| 21 | (1) `BottomSheet`(L0)를 `@helm/ui`에. (2) `SinceLastVisit`에 `variant="compact"`, `AutonomousChoiceList`에 항목별 [봤음] 없는 변형. (3) U-22 답: 모바일 기본 `data-transparency="reduced"`. (4) 입력 칸 글자 16px 이상(touch 밀도). (5) 부품이 `style` 속성을 쓰는 곳 목록(CSP `style-src-attr`) |
| 22 | 서비스 워커 문구 생성 단위 시험, 쿠키·Origin·`/files/*` 격리 통합 시험, Playwright WebKit 휴대폰 시나리오, 가짜 푸시 서비스(RFC 8030 요청을 받아 복호화해 검사), 종단 시험 "데스크톱 기기가 모두 부재이고 휴대폰이 active가 아님 + 푸시 등록 → interrupt·notice 질문 푸시"([판정 J-172]), 시험 설정 `push.webpush.testEndpoints`로 루프백 가짜 서비스를 허용(T26-17), 실기기 체크리스트(§6.2) |
| 23 | 모바일 마일스톤(M17): 데몬 쪽(정적 서빙, 쿠키 인증, 푸시 송신·등록), `apps/mobile` 화면, 실기기 확인(§6.2). 테이블 이름은 `push_tokens`. HT-21 등 사람 작업에서 결정 47~49로 답이 난 질문을 지우고 U-1(Apple 개발자 계정, 경로 B에만 필요)만 남긴다. M17 완료 기준(23 §3.4.18)에 T26-28~T26-35와 M-13·M-14를 더한다(현재 T26-01~27, M-01~12만 옮겨져 있다) |
| 24 | ADR 후보 ADR-26-01~06을 §8로 옮긴다. ADR-00-19·ADR-20-04에 결정 47로 범위가 줄었다는 표시 |
| 25 | 용어: "홈 화면 웹 앱", "푸시", "푸시 등록", "VAPID", "내용 숨김", "경로 B", 모델 API를 내는 쪽은 [판정 J-150]대로 본문 "제공자", 화면 "모델 제공자", 코드 `provider`(26은 이미 따른다). (확인만) 결과 확인 푸시 `cause` 두 값(`result_review_immediate`·`result_review_digest`)은 25에 이미 있다([판정 J-238]) |

## 6. 구현 단위와 완료 기준

### 6.1 모듈별

| 단위 | 위치 | 완료 기준(테스트로 확인할 조건) |
|---|---|---|
| 정적 서빙 | `packages/daemon/src/http/mobile-static.ts` | T26-01 `clients.mobile` 켬: `tailnet`에서 `/m/` 200, `loopback`·`local`에서 404. 끔: 모두 404. T26-02 표에 없는 경로·`..`·심볼릭 링크 탈출 404. T26-03 모든 `/m/` 응답에 §3.3.2 헤더(CSP의 `connect-src`가 `publicOrigin`). T26-04 해시 자산은 `immutable`, `sw.js`는 `no-cache` |
| 쿠키 인증 | `packages/daemon/src/http/mobile-auth.ts`, 18 `preflight` | T26-05 `/m/pair` 성공 시 `Set-Cookie`가 `__Host-`·`HttpOnly`·`Secure`·`SameSite=Strict`이고 본문에 토큰이 없다. 본문의 `clientKind`·`platform` 값은 무시되고 서버 값이 기록된다. T26-06 쿠키 + 올바른 Origin → `hello` 성공, `via.listener = "tailnet"`. T26-07 쿠키 + Origin `https://server.tail7ad0b4.ts.net:8443` → 403, 쿠키 + Origin 없음(업그레이드) → 403. T26-08 데스크톱 기기의 토큰을 쿠키로 → 1008(`carrier_mismatch`). T26-09 `loopback`에서 쿠키 → 무시되어 401. T26-10 폐기 뒤 쿠키 → 1005, `whoami` 401. T26-28 `GET /m/whoami`에 Origin 없음 + `Sec-Fetch-Site: same-origin` → 200, `cross-site` → 403. T26-29 `POST /pair`·`/devices/self/rotate`에 Origin이 있으면 403 |
| scope | 19 디스패처, 18 | T26-30 모바일 기기로 `dial.set`, `grant.*`, `composer.submit`, `work.abort`, `device.createPairingCode`, `question.answer`(`approve_edited`) → 1010. §3.3.3 표의 메서드는 통과 |
| `/files/*` 격리 | 19 파일 처리기 | T26-31 모든 응답에 `sandbox` CSP·`nosniff`·`CORP same-origin`. `text/html`·`image/svg+xml`·`application/xhtml+xml` blob은 `octet-stream` + `attachment`. 쿠키 인증 응답은 `no-store` |
| 푸시 등록 | `packages/daemon/src/push/store.ts`, 10 통치 명령 | T26-11 허용 밖 호스트(`evilpush.apple.com` 포함)·`http:`·IP 주소·포트 지정 엔드포인트 거부. 키 길이 틀림 거부. VAPID 키 불일치 거부. 같은 등록 두 번 → 이벤트 1개. `push_tokens.token` 원문이 이벤트·재전송·투영·진단 묶음·로그 어디에도 없다(DB 덤프와 로그 grep) |
| 송신 주소 검사 | `packages/daemon/src/push/endpoint.ts` | T26-32 해석 주소가 127.0.0.1, 10.x, 100.64.x, fd7a:115c:a1e0::/48이면 보내지 않음(시험 설정 `push.webpush.testEndpoints`의 주소는 T26-17에서만 예외). 3xx 응답은 따르지 않고 `rejected` |
| 푸시 payload | `packages/protocol/src/push.ts`, `apps/mobile/src/sw/notify.ts` | T26-12 생성된 대체 문구가 `@helm/ui-language`의 `notif.hidden.*` 값과 같다. T26-13 속성 시험: 무작위 질문에서 질문 문장·Goal 서술·근거 문자열이 payload에 없다. T26-14 직렬화 3 KiB 이하, 넘으면 `args`를 버린다 |
| 보낼 대상 계산 | `packages/daemon/src/push/planner.ts` | T26-15 표 시험: active 기기 있음 → 없음; 데스크톱 중 부재가 아닌 기기 있음 + notice → 없음; 데스크톱 모두 부재 + 휴대폰 active 아님 + notice → 즉시(휴대폰이 연결돼 있어도); 연결된 기기 있음 + interrupt → 60초 지연; 연결된 기기 없음 + interrupt → 즉시; 방해 금지 → 없음(예외 `expiringOnly` + 승격 → 보냄); `minUrgency: interrupt` 기기 + notice → 없음; 같은 질문 받아들여진 푸시 2회 뒤 → 없음(실패는 세지 않음); 셈에 드는 전달이 `attention.interruptsPerHour`(기본 2)를 넘은 셋째 → 그 시간 끝 묶음 1개. 결과 확인 알림: `none` → 없음, `daily_digest` → 설정 시각에 대기 결과가 있으면 묶음 1개(없으면 없음), `immediate` → 질문마다 notice 1개(위 조건을 그대로 적용). T26-16 재전송·재접속으로 푸시가 다시 가지 않는다. T26-33 첫 시도가 모두 실패하면 `channel: brief` |
| 송신 | `packages/daemon/src/push/webpush.ts` | T26-17 가짜 푸시 서비스(시험 설정 `push.webpush.testEndpoints`로만 루프백 허용, §3.4.6)로 RFC 8291 복호화 성공, VAPID JWT의 `aud`·`exp`(12시간), `TTL`·`Urgency`·`Topic`(22자) 헤더. 410 → 등록 삭제 + `device.push_unregistered(gone)`. 429 → `Retry-After` 준수. 5xx → 3회 재시도 뒤 `push.sent(failed)`. 연속 5회 실패 → `failing` |
| 11·14 수정 반영 | 11의 `urgencyOf`, 14 부재 함수, 전달기 | T26-18 모든 기기 부재 + pushReachable → 막는 권리 게이트 interrupt, 막지 않는 정보 질문 승격 notice. pushReachable 없음 → digest(기존과 같음). 휴대폰 입력 없음 2분 → idle 판정. 휴대폰이 active가 되어도 `user_return` 경계가 발화하지 않는다(판정 J-173, 11 AQ-23) |
| 서비스 워커 | `apps/mobile/src/sw/` | T26-19 push 이벤트마다 알림이 정확히 하나(payload 오류 포함). T26-20 notificationclick → 열린 창 이동 또는 새 창. 다른 출처·`/m/` 밖 `navigate`는 `/m/`로. T26-21 같은 `deliveryId` 두 번 → 같은 `tag`로 바꿔 띄움(알림 수 1) |
| 수명주기 | `apps/mobile/src/platform/pwa/lifecycle.ts` | T26-22 hidden → presence hidden, 진행 중 명령 `/m/cmd` keepalive, 최대 2초 뒤 1000 닫기. visible → `retryNow`. revoked → 캐시·명령함·`/files` 캐시 삭제, 초안 유지. expired → 모두 유지, 재전송 제외. T26-34 창 둘: 하나만 연결·재전송 |
| 결정 가능 판정 | `apps/mobile/src/screens/decide.ts` | T26-23 표 시험: §3.5.11의 각 상태에서 버튼 활성 여부와 이유 키. 휴대폰 비활성 선택지는 명령을 보내지 않는다. 결과 확인은 `outputsViewed` 전과 `mobileReviewable: false`에서 막힌다 |
| 연결 진단 | `apps/mobile/src/platform/pwa/probe.ts` | T26-35 `/healthz` 네트워크 오류 / 502 / 200 + whoami 401 / 200 + whoami 200 각각의 상태와 문장 |
| 화면 | `apps/mobile/src/screens/` | T26-24 Playwright WebKit(iPhone 15 뷰포트와 iPad 세로·가로 뷰포트, 가짜 데몬): 페어링 → 질문 답하기 → 영향 표시, 묶음 답하기, 오프라인 초안 보존과 재연결 뒤 수동 보내기, 낡음 띠, 다른 기기에서 답함, 가정 확정 뒤 답 → 이의 초안, 결과 확인 산출물 조건, 복귀 요약 확인에 `compact: true`, 정한 것 목록 열람 → `autonomous.markSeen` 1회. T26-25 `just mobile-shot`(§3.6.2의 세 뷰포트) 화면 캡처가 디자인과 맞음. T26-26 모든 누르는 영역 44×44pt 이상, 입력 칸 글자 16px 이상(자동 검사) |
| 갱신 | `apps/mobile/vite.config.ts`, `sw.ts` | T26-27 새 판 배포 → 다음 실행 때 적용, 초안 유지. `protocol.unsupported` → 즉시 적용 |

공통 완료 조건: `just verify` 통과. 화면 작업은 `just shot`(= `mobile-shot`) 비교.

### 6.2 실기기 수동 확인 체크리스트 (iOS 26 iPhone, 2단계 활성화 A2 때 운영 데몬에서)

실기기 확인은 운영 데몬에서 한다(MQ-12, 23 M17-04). 운영 데몬에서 `clients.mobile`을 켜는 것은 2단계 활성화이므로 M-01~M-14는 A2 때 수행한다. 그 전에는 §6.1의 `mobile-e2e`(WebKit)까지만 한다.

| ID | 확인 |
|---|---|
| M-01 | Safari → 홈 화면에 추가 → 독립 창으로 열림, 아이콘·이름 "Helm" |
| M-02 | 홈 화면 앱과 Safari가 쿠키를 나눠 쓰지 않음(X-7). 브라우저 탭에서는 페어링 칸이 보이지 않음 |
| M-03 | 쿠키로 WSS가 붙음(AS-M2·M3). `tailscale serve`를 거친 요청에 `Cookie`·`Origin`·`Sec-Fetch-Site`가 그대로 있음(데몬 로그의 헤더 존재 여부만, 값은 남기지 않음) |
| M-04 | 알림 권한 → 구독 → 시험 푸시가 잠금 화면에 뜸. 내용 숨김 기본 문구 |
| M-05 | 앱을 완전히 닫은 상태에서 권리 게이트 질문 → 10초 안에 알림 → 누르면 그 질문이 열리고 6초 안에 버튼 활성 |
| M-06 | 화면 끔·다른 앱 전환 → 다시 열기 → 3초 안에 연결, 초안 유지 |
| M-07 | 앱 전환 화면에 내용이 보이는지(가림막 동작 여부 기록) |
| M-08 | iOS 설정에서 알림 끔 → 다음 실행 때 설정 화면 안내, 데몬 등록 해제 |
| M-09 | 8일 동안 열지 않은 뒤 열기 → 다시 페어링 없이 연결(AS-M4) |
| M-10 | Tailscale 끔 → 캐시 읽기 전용과 "Tailscale 앱" 진단 문장 |
| M-11 | VoiceOver로 질문 카드 읽기 순서(화면 종류 라벨 → 질문 → 버튼) |
| M-12 | iPad 가로·세로에서 두 칸 배치 |
| M-13 | 답을 보낸 직후 화면 잠금 → 데스크톱에서 그 질문이 답해졌는지(`/m/cmd` keepalive), 아니면 다시 열 때 "보내지 못한 답" 띠 |
| M-14 | 홈랩 다른 serve 서비스(예: 8447)를 Safari로 연 뒤에도 Helm 인증이 유지되는지(X-16) |

## 7. 미결 사항

### 7.1 사용자에게 확인할 것

1판의 U-2(웹 기술 사용), U-3(iOS 판), U-4(알림 강도), U-5(Android)는 결정 47·48·49로, U-1(Apple 개발자 프로그램)은 결정 57로 답이 났다.

| ID | 질문 | 왜 필요한가 | 답이 없을 때 |
|---|---|---|---|
| U-1 | Apple 개발자 프로그램(유료, 연 99 USD)에 가입되어 있는가 | 경로 B(§3.1.5)를 고를 수 있는지. 1차(PWA)에는 필요 없다 | 해소: 결정 57. 지금 없다고 보고 경로 B는 이후에 검토한다 |

### 7.2 설계 미결

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| MQ-03 | 앱 잠금(18 §3.18.2 6번) | 1차 끔(휴대폰 잠금 + `decideMobile`) / WebAuthn 확인을 권리 게이트 허락에만 / 모든 결정에 | 1차 끔. 2주 사용 뒤 권리 게이트 허락에만 WebAuthn 확인을 넣을지 본다. 18이 받아들일지 적는다 |
| MQ-04 | 쿠키가 serve를 통과하지 못할 때의 전송 방식(23 SP-15로 확인) | 사용자 결정(선택지는 스파이크 결과를 보고 정한다) | 대체 방식은 두지 않는다. `helm-bearer.` 하위 프로토콜은 받지 않는다(18 §3.4.4, [판정 J-241]). SP-15 스파이크가 실패하면 사용자 결정으로 올린다 |
| MQ-05 | 모바일 서명 증명(18 §3.8.5) | 1차 끔 / 켬 | 쿠키 방식이면 끔(§3.3.3). 전송 방식이 MQ-04에서 바뀌면 그때 다시 정한다 |
| MQ-06 | `push.followupDelayMs` | 0 / 60초 / 5분 | 60초 |
| MQ-07 | VAPID `sub` | `<publicOrigin>/m/` / `mailto:` 주소 | https URL. Apple이 거부하면 설정에 사람이 고른 `mailto:`를 넣는다 |
| MQ-08 | Web Push 송신 구현 | `web-push` 3.6.7 고정 / Node `crypto` 직접 구현 | `web-push` 고정 |
| MQ-09 | 모바일 유리 재질 기본값(21 U-22) | 줄임 / 켬 | 줄임 |
| MQ-10 | 앱 안 QR 읽기(코드 자동 입력) | 1차 / 2차 | 2차 |
| MQ-11 | 휴대폰에서 답할 수 없는 질문의 미루기 기본값 | "다음 작업 경계까지" / "다음 데스크톱 접속까지" | 해소: "다음 데스크톱 접속까지". 11이 `user_return`을 데스크톱·TUI 복귀로만 정했으므로 조건이 충족되었다(§3.5.3, §5.2) |
| MQ-12 | 실기기 시험용 개발 데몬 serve 포트 | 둔다(홈랩 변경) / 두지 않는다 | 두지 않는다 |
| MQ-14 | `choose_one`을 휴대폰에서 답하게 할지(03과 다름) | 답함 / 데스크톱 | 답함(§3.5.4). 03이 받아들이지 않으면 03 안을 따른다 |
| MQ-15 | Helm 전용 serve 호스트 이름(쿠키를 다른 홈랩 서비스와 나누지 않기, X-16) | 같은 호스트 + Origin 정확 일치 / Tailscale Services로 `helm.<tailnet>.ts.net` 같은 전용 이름(홈랩 변경, 신원 헤더 유지 확인 필요) | 1차는 같은 호스트. 홈랩이 전용 이름을 줄 수 있고 신원 헤더가 유지되면 옮긴다(옮기면 휴대폰은 새로 설치·페어링) |
| MQ-16 | 다른 기기의 보내지 않은 초안 알리기 | 두지 않음 / `presence.report`에 초안 수를 싣고 질문 카드에 "다른 기기에 보내지 않은 답 있음" | 두지 않음. 2주 사용에서 "이미 처리됨"을 겪은 일이 반복되면 넣는다 |
| MQ-17 | `/m/cmd` HTTP 명령 경로 | 둔다(19) / 두지 않고 다음 실행 때 재전송만 | 둔다. 19가 받지 않으면 띠와 목록으로만 알린다 |

## 8. 출처

설계 문서(2026-10-12 판): `docs/design/process/00-design-brief.md`(결정 14, 19, 21, 24, 32, 41~43, 47~50, 56, 57, 판정 45·46, §2.5, §5.2), `docs/design/process/rulings-stage2a.md`(§2, J-02, J-03, J-20, J-31, J-37, J-71, J-81, J-82, J-111, J-115, J-118~J-120, J-124, J-132, J-137, J-139, J-141, J-144, J-154, J-166, J-168, J-171~J-173, J-177, J-185, J-189), 01 §3.5.2·§3.8·NFR, 02 UC-04·UC-06·UC-11·UC-17, 03 §3.4~§3.6·§3.12, 04 §3.0~§3.5·§3.19·§3.20·§3.21·§3.26·§4·A4·A5, 05 §3.1·§3.3·§3.4·§3.7·§3.9·§3.10·A8, 06 §3.1·§3.3·§3.4·§3.5·§3.16, 07 §3.11.8, 08 §3.19.1·Via, 09 §3.2·§3.4.9·§3.4.13·§3.7, 10 §3.11, 11 §3.2.3·§3.5·§3.8, 14 §3.13.8, 17 §3.3·§3.4.1·§3.8·§3.10·§3.11·§3.15, 18 §3.2~§3.9·§3.18·§3.19, 19 §2.3·§3.2·§3.4·§3.7·§3.8.3·§3.10·§3.11·§3.13·§3.14·§3.17, 20 §2.3·§3.8.9·§3.9.5·§3.9.12·§3.10.1·§3.10.6·§3.11·§3.14, 21 §3.5.8·§3.7.3·§3.13, 23 `clients.mobile`.

검증 1차 지적: `docs/design/process/verification/round-1/V1~V7`, `.helm-design-work/V2/A~D`, `.helm-design-work/coordinator/residual-2a.md`(처리 내역은 `.helm-design-work/coordinator/stage4/done/P15.md`).

원천과 홈랩(읽기 전용):
- `docs/design/process/sources/pi-cases-notes.md` L260·L264(Paseo 푸시·포그라운드 프로브), L411·L476(OpenClaw Web Push·APNs), L483(iOS outbox)
- `~/projects/_ref/openclaw/docs/platforms/ios.md` L20-32, L270-300, L601-678 [원문]
- `~/projects/homelab/context/machines.md`, `network.md`, `storage.md` L135, `homelab/scripts/alert`, `homelab/.env.example` [원문]
- `secrets ls -i ntfy` 결과(2026-10-12) [실험]
- `npm view web-push`, `vite-plugin-pwa`, `idb`(2026-10-12) [실험]

웹(2026-10-12 확인):
- WebKit, "Web Push for Web Apps on iOS and iPadOS": https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ [원문]
- WebKit, "Meet Declarative Web Push": https://webkit.org/blog/16535/meet-declarative-web-push/ [원문]
- WebKit, "Updates to Storage Policy": https://webkit.org/?p=14403 , https://www.osnews.com/?p=131566 , https://bugs.webkit.org/show_bug.cgi?id=272189 [검색]
- ntfy 설정 문서: https://docs.ntfy.sh/config/ [원문]
- 무료 프로비저닝 제약: https://learn.microsoft.com/th-th/previous-versions/xamarin/ios/get-started/installation/device-provisioning/free-provisioning , https://developer.apple.com/forums/thread/724896 , https://mybyways.com/blog/new-limitations-imposed-on-free-apple-developer-account [검색]
- TestFlight 내부 테스트·90일: https://docs.expo.dev/submit/testflight.md [검색]
- iOS 백그라운드 소켓: https://developer.apple.com/forums/thread/716118 [검색]
- Tauri 원격 푸시 플러그인: https://github.com/Choochmeque/tauri-plugin-notifications [원문], https://github.com/yanqianglu/tauri-plugin-mobile-push [검색]
- `apple-native-keyring-store`: https://docs.rs/apple-native-keyring-store/latest/apple_native_keyring_store/ [원문]
- Tailscale VPN On Demand: https://tailscale.com/kb/1291/ios-vpn-on-demand [검색]

## ADR 후보

### ADR-26-01. 모바일은 데몬이 서빙하는 PWA로 만든다

- 상태: 결정 47로 확정(구현 형태는 제안)
- 맥락: 결정 42로 휴대폰 클라이언트가 범위에 들어왔다. 무료 계정으로 서명한 iOS 앱은 7일마다 다시 설치해야 하고 푸시를 쓸 수 없다(X-1, X-2). 홈 화면 웹 앱은 계정 없이 Web Push를 받는다(X-4).
- 결정: `apps/mobile`(React 19 + Vite, 데스크톱과 같은 `@helm/ui`·`@helm/client`·`@helm/client-react`)을 데몬 릴리스에 넣고 `tailnet` 리스너의 `/m/`로 서빙한다. iOS 26 이상(결정 49).
- 근거: 계정·만료 없이 푸시를 받는다. 데스크톱과 화면 코드를 공유한다. 데몬과 같은 판으로 배포된다. 빌드에 Mac이 필요 없다.
- 기각한 대안: Tauri v2 iOS(유료 계정이 있으면 경로 B로 남김), React Native(화면 부품 두 벌), 네이티브 Swift(코드 두 벌).
- 결과: 데몬이 웹 출처가 되므로 CSP·Origin 검사·쿠키 규칙·`/files/*` 격리·`decideMobile` scope가 필요하다. 19의 "정적 파일을 서빙하지 않는다"와 인증 전 제한에 `/m/` 예외가 생긴다. 결정 19의 적용 범위는 데스크톱으로 좁혀졌다(ADR-00-19, ADR-20-04에 표시).

### ADR-26-02. 앱이 꺼져 있을 때의 알림은 데몬이 직접 보내는 Web Push다

- 상태: 결정 47로 확정(송신 규칙은 제안)
- 맥락: 사람이 자리에 없을 때 권리 게이트가 멈춘 채로 남는다(11 §3.8.2). 후보는 APNs 직접, Web Push, ntfy, 텔레그램 봇이었다.
- 결정: VAPID로 서명한 Web Push를 데몬이 Apple 푸시 서비스로 직접 보낸다. payload는 Declarative Web Push 형식이고 문구 키와 인자만 담는다.
- 근거: PWA와 같은 앱이 열려 쿠키와 캐시를 그대로 쓴다. 계정이 필요 없다. payload가 종단 암호화된다. ntfy는 iOS에서 공개 중계를 거치고 누르면 Safari가 열린다. 텔레그램 안에서 답하면 사람 명령 경로(결정 14)를 벗어난다.
- 결과: VAPID 개인 키가 제품 비밀에 들어간다. 데몬의 바깥 연결에 `push.apple.com`이 더해진다. 11의 `urgencyOf`가 "자리에 없지만 푸시로 알릴 수 있음"을 알아야 한다.

### ADR-26-03. 모바일 기기 토큰은 HttpOnly `__Host-` 쿠키로 나르고, 모바일 기기는 줄인 scope를 받는다

- 상태: 제안([판정 J-118]이 18·19에 따르게 함)
- 맥락: 브라우저 WebSocket은 `Authorization` 헤더를 붙일 수 없다. 하위 프로토콜로 보내면 토큰이 스크립트 저장소에 있어야 한다. 18 §3.18.2 4번은 PWA라면 HttpOnly 쿠키와 CSRF 대책을 요구했다. 휴대폰은 하는 일이 적다(§1.3).
- 결정: `/m/pair`가 `__Host-helm_dt` 쿠키를 설정하고, `tailnet` 리스너는 Origin이 모바일 출처와 정확히 같을 때만(GET은 `Sec-Fetch-Site: same-origin`도) 쿠키를 받는다. 쿠키는 `SameSite=Strict`로 주고, `credentialCarrier: "cookie"`로 발급된 모바일 기기에만 쓸 수 있다. 헤더 경로(`Authorization`)와 `POST /pair`·`POST /devices/self/rotate`는 Origin이 있으면 403이다(CSRF 대책). `POST /m/logout`은 쿠키만 지우고 기기를 폐기하지 않는다. 토큰은 페이지 스크립트·서비스 워커·IndexedDB·로그에 두지 않고, 하위 프로토콜로도 받지 않는다. 업그레이드 판정 함수는 18 `preflight`의 쿠키 갈래 `cookieAuth`(19 정본, 판정 J-168)다(18 §3.4.3, §3.18.2 3·4번). 모바일 기기는 `decide` 대신 `decideMobile` scope를 받는다.
- 근거: 스크립트가 토큰을 꺼낼 수 없다. 분실·XSS 때 피해가 화면이 하는 일로 줄어든다.
- 기각한 대안: 하위 프로토콜 + IndexedDB, 연결마다 1회용 티켓(티켓 발급에도 자격이 필요).
- 결과: 18 `preflight`에 쿠키 갈래, 08 Device에 `credentialCarrier`, 19에 `decideMobile`. 같은 호스트의 다른 포트 서비스로 쿠키가 실리는 위험이 남는다(MQ-15).

### ADR-26-04. 휴대폰은 숨겨지면 연결을 닫고 보이면 바로 다시 붙는다

- 상태: 제안
- 맥락: iOS는 백그라운드 앱을 곧 멈추고 그 연결도 끊는다(X-8). 끊긴 연결을 데몬이 무수신 감시(45초)로 발견하는 동안 접속 상태가 틀리고 푸시 판단이 늦는다.
- 결정: `visibilitychange → hidden`에서 presence `hidden`을 보내고 진행 중 명령을 `/m/cmd` keepalive로도 보낸 뒤 최대 2초 뒤 1000으로 닫는다. `visible`에서 `retryNow()`. 구독은 `payload: "none"`.
- 근거: 데몬이 사람의 부재를 바로 반영해 푸시를 고를 수 있다. 다시 붙는 비용(1~3초)은 위치부터 재전송과 진행 중 명령함으로 메운다.
- 기각한 대안: 백그라운드 작업으로 연결 유지(시간이 짧고 보장이 없다), 닫지 않고 두기(반쯤 열린 연결이 45초 남는다).

### ADR-26-05. 휴대폰 푸시는 interrupt와 notice 질문에, 사람이 다른 기기 앞에 있으면 보내지 않는다

- 상태: 강도 범위는 결정 48로 확정, 기기 조건은 판정 J-171·J-172로 정함
- 맥락: 05는 알림을 전달된 질문에만, 같은 질문은 두 번까지로 정했다. 휴대폰 푸시가 데스크톱 알림과 겹치면 같은 일을 두 번 알린다.
- 결정: `interrupt`와 `notice`를 푸시한다(결정 48). 어떤 기기가 `active`면 보내지 않는다. `interrupt`는 연결된 기기가 있으면 60초 뒤 열람이 없을 때 보낸다. `notice`는 모든 데스크톱 기기가 부재이고 휴대폰이 `active`가 아닐 때만 보낸다(판정 J-172). 시간당 상한은 `attention.interruptsPerHour` 하나로 사람 기준이다(판정 J-171). 방해 금지·조용한 시간에는 보내지 않고 끝날 때 묶음 하나.
- 근거: 휴대폰은 주머니 속 기기라 알림 하나의 비용이 크다. 데스크톱 OS 알림과 겹치는 경우를 `interrupt`의 지연 푸시 하나로 줄인다.
- 기각한 대안: 모든 전달을 푸시(05 주의 예산과 충돌), 데스크톱과 휴대폰에 동시 알림(같은 일을 두 번).
- 결과: 11에 `pushReachable`, 런타임 타이머 `push_followup`·`push_dnd_digest`·`push_hour_bundle`·`result_review_digest`(판정 J-189).

### ADR-26-06. 푸시 등록 원문은 운영 테이블에 두고 이벤트에는 해시만 둔다

- 상태: [판정 J-71]로 확정(열 구성은 제안)
- 맥락: 푸시를 보내려면 엔드포인트 URL과 암호 키 원문이 필요하다. 결정 29는 모든 상태를 로그에서 재구성하라고 한다. 18 §3.18.2 9번은 원문을 이벤트에 넣지 말라고 요구했다.
- 결정: 원문은 09 운영 테이블 `push_tokens`에, 이벤트(`device.push_registered`)와 Device `push`에는 해시·앞 8자·호스트·설정만 둔다. 원문이 없는데 등록 이벤트가 있으면 `needs_refresh`로 보이고 앱이 다시 등록한다.
- 근거: 원문은 휴대폰이 언제든 다시 줄 수 있는 값이라 로그에 없어도 등록 상태를 복구할 수 있다. 원문이 재전송·투영·진단으로 퍼지지 않는다.
- 기각한 대안: 원문을 이벤트에 넣고 `sensitiveFields`로 가림(백업·내보내기에 남는다), 원문을 SOPS에(기기마다 바뀌는 값이라 사람 작업이 된다).
- 결과: 09 `push_tokens`에 열 넷이 더해진다.
