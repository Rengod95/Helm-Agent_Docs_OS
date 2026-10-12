# 26. 모바일 클라이언트

- 작성: 2026-10-12, P15 모바일 (2a단계에 추가된 문서)
- 상태: 1판. 브리프 결정 41~46(§2.4b)과 조정자 판정(`process/rulings-stage2a.md`, 특히 J-02·J-03·J-28·J-31·J-37)을 따른다. 01~05, 06, 08, 09, 11, 17~21의 2026-10-12 판(다른 에이전트가 같은 날 고치는 중인 판)을 읽고 맞췄다. 이름의 정본은 이벤트 09, 레코드·필드 08, 명령 10, 메서드 19, 화면 ID 03이다. 이 문서가 새로 제안하는 이름은 §5.2에 해당 문서 요구로 적었다.
- 소유: 모바일 구현 방식, 휴대폰에서 하는 일의 범위(03 §3.12의 화면 ID를 받아 레이아웃과 상태를 정함), 모바일 연결·인증 적용 방식, 앱이 꺼져 있을 때의 알림 경로와 푸시 등록 형식(08 Device `push`), 모바일 빌드·배포.
- 표시: 브리프 §5.2. `[결정 n]`은 브리프 §2의 결정 번호, `[제안]`은 이 문서가 정한 것, `[가정]`은 확인하지 않은 전제. 외부 사실은 `[원문]`(문서·소스를 직접 읽음), `[실험]`(명령을 실행해 확인), `[검색]`(검색 결과 요약으로 확인), `[지식]`(다시 확인하지 않음).
- 출처 줄임말: `homelab/`은 `~/projects/homelab`, `_ref/`는 `~/projects/_ref`, `cases`는 `docs/design/process/sources/pi-cases-notes.md`. 웹 출처의 주소는 §8에 모았다.

## 1. 목적과 범위

### 1.1 목적

사용자는 2026-10-12에 "휴대폰에서도 질문에 답할 수 있어야 한다"를 범위에 넣었다 [결정 42]. 데스크톱 앱 MVP 다음 단계(01의 2단계)에 만든다. 이 문서는 다음을 정해 구현자가 바로 만들 수 있게 한다.

1. 어떤 기술로 만드는가(Tauri v2 모바일, PWA, React Native, 네이티브 Swift 비교)와 App Store 없이 iPhone에 설치하는 방법.
2. 휴대폰이 데몬에 어떻게 붙고 어떻게 인증하는가. 백그라운드 제약 아래에서 연결·재전송·초안을 어떻게 다루는가.
3. 앱이 꺼져 있을 때 질문을 어떻게 알리는가. 알림 내용 숨김, 문구 키, 딥 링크, 알림에서 답까지의 조작 수.
4. 휴대폰 화면(03 §3.12의 `SCR-M-*`)의 레이아웃, 상태, 결정 버튼 활성 조건.
5. 빌드·배포 절차, 테스트와 완료 기준.

### 1.2 휴대폰에서 하는 일 [결정 42 / 범위는 제안]

| 할 일 | 화면 | 근거 |
|---|---|---|
| 질문함을 보고 질문에 답한다(묶음 답하기 포함) | `SCR-M-INBOX`, `SCR-M-QUESTION` | 결정 42의 본래 목적. 02 UC-04 대안 M |
| 권리 게이트를 허락·하지 않기·미루기 한다 | `SCR-M-QUESTION` | 권리 게이트는 사람이 없으면 그 일이 멈춘다(11 §3.8.2). 외출 중 멈춤을 푸는 것이 가장 큰 쓸모다 |
| 작업 합의 확인(이 범위로 맡기기, 넓어진 부분 빼고 맡기기, 맡기지 않기) | `SCR-M-QUESTION` | C/A 사람 조작이 외출 때문에 멈추지 않게 한다(05 §3.4) |
| 결과 확인(결과 확인, 수정 요청, 미루기) | `SCR-M-QUESTION` | 조정자 판정 J-37(03 §3.12 안)을 받아들인다 |
| 에이전트가 정한 것에 이의를 건다(이유는 선택) | `SCR-M-AUTO` | 불변조건 7, 결정 8 |
| 복귀 요약 요약판을 읽고 "여기까지 봤음"을 누른다 | `SCR-M-BRIEF` | 04 §3.2의 결정적 절만 줄인 판 |
| 진행 중 작업을 한 줄씩 보고 안전하게 멈춘다 | `SCR-M-WORK` | 05 §3.6.1 "안전하게 멈추기" |
| 복구 판단에 답한다 | `SCR-M-QUESTION` | 03 §3.12 질문 형식 표 |
| 알림을 받는다(앱이 꺼져 있어도) | OS 알림 | §3.4 |
| 페어링, 이 기기 폐기, 다른 기기 폐기, 알림 설정 | `SCR-M-ONBOARD`, `SCR-M-CONNECT`, `SCR-M-SETTINGS` | 18 §3.18.2 |

### 1.3 휴대폰에서 하지 않는 일 [제안]

| 하지 않는 일 | 대신 | 이유 |
|---|---|---|
| 자극 보드의 요소 단위 반응, 세 개 비교, 라운드 마치기(`reaction` 형식) | 카드에 "데스크톱에서 답하기"와 미루기(`question.defer`)만 | 요소 고르기는 넓은 화면과 정밀한 지정이 필요하다. 작은 화면의 반응은 대충 고르기로 흐르기 쉽고, 원함 탐구의 자료 품질이 떨어진다(결정 1·18). 21 §3.13 규칙 5의 터치 반응은 이번 범위에 넣지 않는다 |
| 고쳐서 허락(`approve_edited`, 인자 편집) | 인자 미리보기는 보이고 "데스크톱에서 고치기" 표시 | 밖으로 나가는 행동의 인자를 작은 화면에서 고쳐 쓰는 실수를 줄인다(03 §3.12) |
| 결과 확인의 조건 붙여 확인·거절·기준이 틀림 | 같은 표시 | 판정 J-37. 길게 쓰는 판단은 데스크톱에서 |
| 새 일 시작, 입력창 지시, 대화 탭 | 없음 | 휴대폰은 답하는 곳이다(03 §3.12 원칙 1) |
| 탐구 화면, 근거 체인 전체 트리, 다이얼, 관찰 제안, 변화 기록, 평가 | 질문 카드 안의 핵심 근거 줄만 | 같은 이유 |
| 새 기기 페어링 코드 만들기 | 없음 | 휴대폰을 잃었을 때 그 휴대폰으로 새 기기를 들여오지 못하게 한다(18 §3.18.2 5번, 19 `devicesLimited`) |
| SSH 경로 | 없음 | 18 §3.18.2 1번, 19 §3.17 |
| 알림 안에서 바로 답하기(알림 동작 단추) | 알림을 누르면 질문 화면이 열린다 | 질문을 읽지 않고 답하는 경로를 만들지 않는다(05 §3.7.5) |
| 백그라운드에서 연결을 유지하거나 내용을 미리 받기 | 앞으로 올 때 다시 붙는다 | iOS가 백그라운드 앱을 곧 멈춘다(§2.3) |

### 1.4 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 질문 레코드, 게이트, 전달 방식, 알림 강도 계산의 정본 | 11 |
| 프로토콜 메서드·오류 코드·재전송 규칙 | 19 |
| 기기 토큰 형식, 페어링 코드 규칙, 위협 모델 전체 | 18 |
| 화면 ID와 이름 | 03 (이 문서는 `SCR-M-ONBOARD` 하나를 새로 요구한다) |
| 데스크톱 화면 상세, 질문 카드 필드, 문구 정본 | 04, 05 |
| 토큰 값, 부품 계약 | 21 |
| 데몬 수명주기, 릴리스·업그레이드 절차 | 17 |
| 테스트 계층과 구현 순서 | 22, 23 |

### 1.5 관련 유즈케이스

| 유즈케이스 | 이 문서의 몫 |
|---|---|
| UC-04 대안 M (외부에서 질문에 답하기, 휴대폰) | §3.7.1 시퀀스, AC-04-09의 세부 기준(§6) |
| UC-11 처음 설치·기기 페어링 | §3.3.4 휴대폰 페어링 |
| UC-17 대안 A0 (기기 이어 하기, 휴대폰) | §3.3.6, §3.4.3 "다른 기기를 쓰는 중이면 푸시를 늦춤" |
| UC-03 단계 7 (밤사이 권리 게이트) | §3.4.3 사람이 없을 때 푸시 |

## 2. 전제와 결정

### 2.1 브리프 결정과 판정에서 오는 전제

| 근거 | 이 문서에 주는 전제 |
|---|---|
| 결정 42 | 휴대폰에서 질문에 답한다. 데스크톱 MVP 다음 단계. 구현 방식과 알림 경로는 이 문서가 정하고 01·03·06·18·19·20이 맞춘다 |
| 결정 19 | "클라이언트는 웹이 아니다. 데스크톱 앱을 먼저." 결정 42가 모바일 구현 후보로 PWA를 직접 적었으므로, 이 문서는 결정 19를 데스크톱 클라이언트에 대한 결정으로 읽는다. 모바일을 PWA로 만드는 것은 사용자 확인 항목으로 둔다(§7.1 U-2) |
| 결정 14, 32 | 앱은 얇은 클라이언트다. 사람 결정은 프로토콜의 명령 메서드로만 들어온다. 모바일에도 Helm 로직을 두지 않는다 |
| 결정 21, 26, 46 | 외부 접속은 Windows 호스트의 `tailscale serve`, 데몬은 127.0.0.1. 모든 리스너가 자격 증명을 요구한다. Funnel은 쓰지 않는다 |
| 결정 24 | 혼자 쓰는 앱이다. App Store 배포는 범위 밖이다 |
| 결정 41, 43 | React 19, 부품 직접 제작, 글래스모피즘, Caustic 토큰 복사. 모바일도 같은 토큰·부품을 쓴다 |
| 판정 §2 | 클라이언트 코어는 `@helm/client`(데스크톱·모바일·TUI 공용). 문구는 `@helm/ui-language` |
| J-02 | 연결이 없을 때 결정 입력은 막고 초안으로 보존한다. 응답 전에 끊긴 명령만 같은 멱등 키로 다시 보낸다 |
| J-03 | 알림 내용은 기본 숨김, 설정으로 켠다. 푸시도 같다(05 §3.7.7) |
| J-28 | presence `locked`는 모바일만 보낸다(26이 확인). 이 문서의 결론은 §3.3.7: 모바일도 보내지 않는다 |
| J-31 | 알림 문구는 문구 키로 저장하고 앱이 `@helm/ui-language`로 문장을 만든다 |
| J-37 | 휴대폰의 결과 확인 범위는 03 §3.12 안(결과 확인·수정 요청). 26이 다르게 정하면 26을 따른다. 이 문서는 03 안을 받아들인다 |

### 2.2 운영 환경 사실

| 사실 | 확인 |
|---|---|
| iPhone과 iPad가 tailnet에 있고 Tailscale 앱이 깔려 있다. 용도는 열람·입력·사진(OpenCloud, Obsidian, Moonlight) | [원문 `homelab/context/machines.md` 기기 표] |
| tailnet 이름은 `tail7ad0b4.ts.net`, 서버 노드는 Windows 호스트(`tag:server`). serve는 8443~8447을 쓰고 Helm은 8448(→ 127.0.0.1:7840)을 쓴다 | [원문 `homelab/context/network.md`], 판정 §2 |
| `tailscale serve`의 HTTPS는 ts.net 인증서로 끝난다. 휴대폰 Safari가 신뢰하는 공인 인증서다 | [지식] 홈랩의 다른 serve 서비스(OpenCloud 등)를 iPhone 앱이 이미 쓰고 있다 |
| Mac(`user-macbookpro`)은 iOS 빌드 노드다. 서버가 `run-on mac`으로 빌드를 지시한다 | [원문 `homelab/context/machines.md`], 브리프 §2.5 |
| Apple 개발자 프로그램(유료) 가입 여부는 기록이 없다 | [원문] 홈랩 문서와 dotfiles 어디에도 없다. 사용자 확인 항목(§7.1 U-1) |
| 홈랩 경보 스크립트는 `NTFY_URL`이 있으면 ntfy로 보낸다. 예시 값은 공개 `https://ntfy.sh/<topic>`이고, 지금 비밀 저장소에 그 키가 없다 | [원문 `homelab/scripts/alert`, `homelab/.env.example`], [실험 `secrets ls -i ntfy`: 해당 키 없음]. 18 Q18-09의 "홈랩이 이미 쓰는 방식"은 훅만 있는 상태다 |
| 홈랩에는 공인 IP를 가진 VPS(`stackmellow-gateway`)가 있으나 홈서버의 일부가 아니다 | [원문 `homelab/context/machines.md`]. 이 문서는 푸시 중계에 쓰지 않는다 |

### 2.3 외부 사실 (iOS와 푸시)

| ID | 사실 | 확인 |
|---|---|---|
| X-1 | 무료 Apple ID(Personal Team)로 서명한 앱의 프로비저닝 프로파일은 7일 뒤 만료되고, 만료되면 앱이 실행되지 않는다. 다시 설치하려면 Mac에서 다시 빌드·설치해야 한다 | [검색: Apple 개발자 포럼, mybyways 블로그] |
| X-2 | Personal Team은 Push Notifications capability를 쓸 수 없다. TestFlight·App Store Connect도 쓸 수 없다. App ID 생성·기기 수에 제한이 있다는 보고가 있다(수치는 출처마다 다름) | [검색: Apple 개발자 포럼, Microsoft Xamarin 무료 프로비저닝 문서] |
| X-3 | 유료 개발자 프로그램은 프로파일이 1년이다. TestFlight 내부 테스트는 심사 없이 바로 설치할 수 있고 빌드는 업로드 뒤 90일에 만료된다 | [검색: Expo 문서, TestFlight 안내 글]. 정확한 한도는 Apple 문서로 다시 확인할 것 |
| X-4 | iOS·iPadOS 16.4부터 홈 화면에 추가한 웹 앱(manifest `display: standalone`)이 Web Push를 받는다. 권한 요청은 사용자의 직접 조작 뒤에만 된다. Apple 개발자 프로그램 가입이 필요 없다. 서버 쪽 방화벽은 `*.push.apple.com`을 허용해야 한다. 배지 API(`setAppBadge`)를 지원하고 집중 모드와 연동된다 | [원문: WebKit 블로그 "Web Push for Web Apps on iOS and iPadOS"] |
| X-5 | iOS 18.4부터 Declarative Web Push를 지원한다. 메시지 JSON에 `"web_push": 8030`과 `notification.title`, `notification.navigate`가 필수다. 서비스 워커가 없어도 알림이 뜨고, 서비스 워커가 있으면 그 내용을 바꿔 띄울 수 있다. 서비스 워커가 제때 알림을 띄우지 못하면 선언된 알림이 대신 뜬다. 구독은 `userVisibleOnly: true`라 조용한 푸시는 없다 | [원문: WebKit 블로그 "Meet Declarative Web Push"] |
| X-6 | 홈 화면 웹 앱은 Safari와 따로 사용일을 센다(스크립트가 쓰는 저장소의 7일 상한이 Safari 사용일 기준이라는 설명). iOS 17부터 저장 할당이 디스크 비율로 커졌다. 다만 저장 공간이 부족하거나 오래 쓰지 않으면 지워질 수 있다 | [검색: WebKit 저장 정책 글, 관련 버그 보고]. 완전한 면제는 확인하지 못했다 |
| X-7 | 홈 화면 웹 앱은 Safari와 저장소(쿠키·IndexedDB)를 나눠 쓰지 않는다 | [지식]. §6.2 실기기 확인 항목 |
| X-8 | iOS는 백그라운드로 간 앱을 곧 멈추고, 그 앱의 네트워크 연결도 함께 끊긴다. 백그라운드 작업 API로 얻는 시간은 짧고, 지속 연결 대신 "백그라운드에서 닫고 포그라운드에서 다시 붙고 푸시로 깨운다"가 권장 방식이다 | [검색: Apple 개발자 포럼의 DTS 답변] |
| X-9 | 자체 호스팅 ntfy를 iOS에서 바로 받으려면 서버가 공개 `ntfy.sh`로 `poll_request`를 보내야 한다. 보내는 것은 메시지 ID(`X-Poll-ID`)와 토픽 URL의 SHA-256이고 본문은 "New message"로 고정이다. 휴대폰 앱이 자체 서버에서 실제 내용을 가져온다. 상류 서버를 두지 않으면 지연이 몇 시간이 될 수 있다 | [원문: docs.ntfy.sh 설정 문서 "iOS instant notifications"] |
| X-10 | Tauri 공식 notification 플러그인은 로컬 알림만 다룬다. 원격 푸시는 커뮤니티 플러그인(`tauri-plugin-notifications`의 `push-notifications` 기능: iOS APNs, Android FCM)이 있다 | [원문: GitHub `Choochmeque/tauri-plugin-notifications` README], [검색: `tauri-plugin-mobile-push`] |
| X-11 | `apple-native-keyring-store` 1.0.2는 iOS(`aarch64-apple-ios`)의 protected data 키체인을 지원한다 | [원문: docs.rs] |
| X-12 | Tailscale iOS 앱의 VPN On Demand는 Wi-Fi·셀룰러별 규칙(Always 등)과 "`*.ts.net` 요청이 있으면 연결" 규칙을 둔다. 후자는 인터페이스 규칙이 "Do Nothing"일 때만 쓸 수 있다 | [검색: Tailscale KB 1291] |
| X-13 | OpenClaw는 웹 Control UI에 Web Push(VAPID, `web-push` 3.6.7)를 쓰고, iOS 공식 빌드는 App Attest와 배포 증명을 요구하는 APNs 중계를 쓴다. 직접 빌드한 iOS 앱은 중계를 쓸 수 없고 Gateway에 APNs 키(Team ID, Key ID, .p8)를 넣어야 한다 | [원문 `_ref/openclaw/docs/platforms/ios.md:601-678`, cases L411·L476] |
| X-14 | Paseo는 Expo push를 쓰고, 앱이 포그라운드로 돌아오면 3초 프로브로 연결을 확인한다 | [원문 cases L260·L264] |
| X-15 | npm `web-push` 최신은 3.6.7(2024-01 갱신), `vite-plugin-pwa` 2.0.0은 peer `vite ^8`을 받는다, `idb` 8.0.4 | [실험: `npm view`, 2026-10-12] |

### 2.4 이 문서의 주요 결정

| ID | 결정 | 표시 | 절 |
|---|---|---|---|
| MOB-D01 | 모바일 1차는 **데몬이 `tailnet` 리스너의 `/m/` 경로로 서빙하는 PWA**다. React 19 + Vite, 데스크톱과 같은 `@helm/client`·`@helm/client-react`·`@helm/ui`·`@helm/ui-tokens`·`@helm/ui-language`를 쓴다. 사용자는 Safari에서 "홈 화면에 추가"로 설치한다 | [제안], ADR-26-1 | §3.1 |
| MOB-D02 | 앱이 꺼져 있을 때의 알림은 **Web Push**(RFC 8030·8291·8292, VAPID)다. 데몬이 Apple·Google 푸시 서비스로 직접 보낸다. 중계 서버, 메신저 봇, ntfy를 두지 않는다 | [제안], ADR-26-2 | §3.4 |
| MOB-D03 | 모바일 기기 토큰은 `__Host-helm_dt` **HttpOnly 쿠키**로 나른다. 스크립트는 토큰을 읽지 못한다. 쿠키로 인증하는 요청은 `Origin`이 모바일 출처와 같아야 한다 | [제안], ADR-26-3. 18 §3.18.2 4번의 요구를 따른 것 | §3.3.3 |
| MOB-D04 | 앱이 숨겨지면(`visibilitychange → hidden`) 연결을 1000으로 닫고 위치만 저장한다. 다시 보이면 백오프를 무시하고 바로 붙는다(19 `retryNow()`) | [제안], ADR-26-4. 19 §3.17과 같음 | §3.3.5 |
| MOB-D05 | 푸시는 11이 계산한 알림 강도가 `interrupt`인 전달에만 보낸다(설정으로 `notice`까지 넓힘). 사람이 다른 기기에서 활동 중이면 보내지 않고, 다른 기기가 연결만 되어 있으면 60초 기다린 뒤 아직 열람·답이 없을 때 보낸다 | [제안], ADR-26-5 | §3.4.3 |
| MOB-D06 | 푸시 등록 원문(엔드포인트 URL, 암호 키)은 정본 이벤트가 아닌 운영 테이블 `device_push`에 두고, 이벤트와 08 Device `push`에는 해시·끝자리·호스트만 둔다 | [제안], ADR-26-6. 18 §3.18.2 9번과 같음 | §3.4.6 |
| MOB-D07 | 푸시 payload는 문구 키와 인자만 담고(J-31), 서비스 워커가 `@helm/ui-language`로 문장을 만든다. 기본은 내용 숨김(J-03). Declarative Web Push 형식으로 보내 서비스 워커가 실패해도 중립 문구("Helm · 확인할 일이 있습니다.")가 뜬다 | [제안] | §3.4.4, §3.4.5 |
| MOB-D08 | 휴대폰에서 답할 수 있는 질문 형식은 `answer`, `confirm_candidate`, `approve_action`(고쳐서 허락 제외), `result_review`(결과 확인·수정 요청), `choose_one`, 복구 판단이다. `reaction`은 데스크톱에서만 답하고 휴대폰은 미루기만 한다 | [제안]. 03 §3.12 표와 `choose_one`만 다르다 | §3.5.4 |
| MOB-D09 | presence `locked`는 모바일도 보내지 않는다. 웹 플랫폼은 잠금과 앱 전환을 구분하지 못한다 | [제안], J-28에 대한 답 | §3.3.7 |
| MOB-D10 | 휴대폰은 Mac 없이 서버에서 빌드한다. PWA 묶음은 데몬 릴리스에 함께 들어가 데몬과 같은 판으로 배포된다. 앱–데몬 판 불일치가 생기지 않는다 | [제안] | §3.6 |
| MOB-D11 | 경로 B(Tauri v2 iOS 앱 + APNs 직접)는 사용자에게 유료 Apple 개발자 프로그램이 있고 §3.1.5의 전환 조건 중 하나가 생길 때 다시 본다. 08 Device `push.provider`에 `apns`를 예약해 두어 전환이 추가 작업이 되게 한다 | [제안] | §3.1.5 |

### 2.5 가정

| ID | 가정 | 틀리면 |
|---|---|---|
| AS-M1 | 사용자의 iPhone은 iOS 18.4 이상이다(16.4 이상이면 동작, 18.4 이상을 권장) | 16.4~18.3이면 Declarative 대체 문구 없이 서비스 워커 경로만 쓴다(§3.4.5). 16.4 미만이면 푸시 없이 앱만 쓴다 |
| AS-M2 | `tailscale serve`가 `Cookie`, `Origin`, `Sec-WebSocket-Protocol` 헤더를 그대로 넘긴다 | §6.2 M-03에서 확인. 쿠키가 넘어가지 않으면 19의 `helm-bearer.` 하위 프로토콜로 바꾸고 토큰을 IndexedDB에 둔다(MQ-04) |
| AS-M3 | 홈 화면 웹 앱의 WebSocket 업그레이드 요청에 같은 출처 쿠키가 실린다 | 같음 |
| AS-M4 | 서버 측 HttpOnly 쿠키는 스크립트 저장소의 7일 정리 대상이 아니다 | [지식]. 틀리면 7일 이상 열지 않았을 때 다시 페어링하게 된다. 장기 사용 확인 항목 M-09 |
| AS-M5 | 데몬 프로세스는 `*.push.apple.com`(iOS), `fcm.googleapis.com`(Android Chrome)으로 HTTPS를 보낼 수 있다(모델 공급자 호출과 같은 바깥 연결) | 18 §3.18.2 9번의 바깥 연결 허용 목록에 넣는다 |
| AS-M6 | Apple 푸시 서비스가 VAPID `sub`에 `https:` URL을 받는다 | `mailto:` 주소를 설정에 넣는다(MQ-07). 사용자 이메일을 기본값으로 쓰지 않는다 |

## 3. 명세 본문

### 3.1 구현 방식 비교와 선택

#### 3.1.1 후보

| 후보 | 모양 |
|---|---|
| A. Tauri v2 모바일(iOS·Android) | 데스크톱과 같은 Tauri 셸. WKWebView 안의 React SPA + Rust 코어. 전송·키체인은 Rust |
| B. PWA(데몬이 서빙) + Tailscale | 데몬이 `/m/`로 정적 묶음을 내보내고, 사용자가 Safari에서 홈 화면에 추가한다. 브라우저 WebSocket으로 같은 프로토콜을 쓴다 |
| C. React Native(Expo) | 네이티브 UI. TS 코어(`@helm/client`)는 함께 쓰고 화면 부품은 새로 만든다 |
| D. 네이티브 Swift(SwiftUI) | 프로토콜 코어와 화면을 Swift로 다시 만든다 |

#### 3.1.2 비교

| 기준 | A. Tauri v2 모바일 | B. PWA | C. React Native | D. Swift |
|---|---|---|---|---|
| 데스크톱과 코드 공유 | 높음. SPA·부품·`@helm/client`·Rust 전송(`transport/wss.rs`)을 그대로 쓴다 | 높음. SPA·부품·`@helm/client`(`./browser` 전송)를 쓴다. Rust는 쓰지 않는다 | 중간. 코어·문구는 공유, 화면 부품(21의 DOM 부품)은 다시 만든다 | 낮음. 문구 키 표 정도만 공유 |
| App Store 없이 iPhone 설치 | 무료 계정: 7일마다 Mac에서 다시 설치(X-1). 유료: 1년 프로파일 또는 TestFlight 90일(X-3) | Safari "홈 화면에 추가". 계정·만료 없음 | A와 같음 | A와 같음 |
| 앱이 꺼져 있을 때 푸시 | APNs. 유료 계정 필요(X-2). 커뮤니티 플러그인(X-10)과 데몬의 APNs 키 필요 | Web Push. 계정 필요 없음(X-4), iOS 16.4+ | APNs, 유료 계정 필요(Expo push도 APNs 자격 필요) | APNs, 유료 계정 필요 |
| 토큰 보관 | iOS 키체인(X-11) | HttpOnly 쿠키(스크립트가 읽지 못함, MOB-D03). 하드웨어 보호 키는 없음 | 키체인 | 키체인(Secure Enclave 가능) |
| 백그라운드 연결 | 불가(X-8) | 불가 | 불가 | 불가 |
| 앱–데몬 판 맞춤 | 앱을 따로 갱신해야 한다(데스크톱과 같은 문제, 20 §3.12.7) | 데몬과 같은 릴리스로 내려오므로 항상 맞다 | A와 같음 | A와 같음 |
| 빌드 위치 | Mac(Xcode, Rust iOS 대상) | 서버(WSL)만 | Mac | Mac |
| 유지 비용(1인) | Xcode·Rust iOS 대상·서명·커뮤니티 플러그인 추적, 연 99 USD | Vite 빌드 하나와 서비스 워커. Safari 동작 변화 추적 | RN·Expo 판 추적, 부품 두 벌 | 코드 두 벌 |
| 데몬 쪽 추가 | APNs 송신기, .p8 비밀 | 정적 서빙 경로, 쿠키 인증, Web Push 송신기, VAPID 비밀 | APNs | APNs |
| 보안 표면 | 웹뷰에 원격 콘텐츠 없음 | 데몬이 웹 출처가 된다: CSP, Origin 검사, 쿠키 CSRF 대책이 필요하다 | 작음 | 작음 |
| Android | Tauri Android, FCM(Google 프로젝트 필요) | 같은 PWA가 Chrome에서 동작할 것으로 본다(FCM 계정 필요 없음) [지식] | Expo | 없음 |

#### 3.1.3 App Store 없이 iPhone에 설치하는 경로

| 경로 | 필요한 것 | 만료 | 푸시 | 판단 |
|---|---|---|---|---|
| Xcode + 무료 Apple ID | Mac, 케이블 또는 같은 네트워크의 무선 디버깅 | 7일 | 불가(X-2) | 쓰지 않는다. 일주일마다 다시 설치해야 하고 그 사이 앱이 실행되지 않는다 |
| Xcode + 유료 개발자 프로그램(개발 프로파일) | 연 99 USD, 기기 UDID 등록 | 1년 | APNs 가능 | 경로 B에서 쓴다 |
| TestFlight 내부 테스트 | 유료 계정, App Store Connect 업로드 | 빌드 90일 | APNs 가능 | 경로 B의 대안. 업로드 절차가 늘어난다 |
| AltStore·SideStore 같은 재서명 도구 | 무료 계정 + 주기적 재서명 | 7일(자동 갱신 시도) | 불가 | 쓰지 않는다. 무료 계정의 푸시 제약이 그대로 남는다 [지식] |
| EU 대체 앱 장터·웹 배포 | EU 거주, 공증 | - | - | 해당 없음(사용자는 한국) [지식] |
| 홈 화면 웹 앱(PWA) | iOS 16.4+, Safari | 없음 | Web Push(X-4) | **채택(MOB-D01)** |

#### 3.1.4 선택과 근거 [제안, ADR-26-1]

B(PWA)를 고른다.

1. **계정과 만료가 없다.** 유료 계정이 없으면 A·C·D는 푸시를 쓸 수 없고 7일마다 앱이 멈춘다(X-1, X-2). 결정 42의 목적(휴대폰에서 답하기)에는 "앱이 꺼져 있을 때 알림"이 사실상 필수다. B는 계정 없이 이 둘을 모두 얻는다(X-4).
2. **코드 공유가 A만큼 높다.** 화면은 `@helm/ui`의 같은 부품(`QuestionCard`, `QuestionInbox` 등, 21 §3.13)을 쓰고, 연결은 `@helm/client`의 브라우저 전송(19 §3.13.1 `./browser`)을 쓴다. 뷰 캐시·초안·결정 가능 판정은 `@helm/client-react`(20 §3.14)를 그대로 쓴다.
3. **판이 어긋나지 않는다.** 묶음이 데몬 릴리스에 들어 있으므로 데몬을 올리면 휴대폰 화면도 같은 판이 된다(MOB-D10). 데스크톱이 겪는 "앱 갱신 안내"(20 APP-D14)가 모바일에는 없다.
4. **빌드에 Mac이 필요 없다.** Vite 빌드는 서버에서 끝난다. Mac이 잠들어 빌드가 막히는 일(06 F23)이 모바일에는 없다.

받아들이는 약점과 대응:

| 약점 | 대응 |
|---|---|
| 토큰을 하드웨어 보호 키나 키체인에 둘 수 없다 | HttpOnly 쿠키로 스크립트가 읽지 못하게 한다(MOB-D03). 노드 묶기(18 D18-02), 기기 폐기, 휴대폰 잠금이 남은 방어다. 서명 증명은 1차에 쓰지 않는다(§3.3.3, MQ-05) |
| 데몬이 웹 출처가 되어 XSS·CSRF 표면이 생긴다 | 엄격한 CSP(인라인 스크립트 없음), 모델 문장은 글자로만 그림(21 R, 18 T18-32), 쿠키 요청의 Origin 검사, `SameSite=Strict` |
| iOS가 웹 앱 저장소를 지울 수 있다(X-6) | 토큰은 쿠키, 위치·뷰 캐시·초안은 다시 받을 수 있는 사본이다. 쿠키까지 지워지면 다시 페어링한다(§4 MF-09) |
| 앱 전환 화면 가리기, 생체 인증 앱 잠금이 어렵다 | §3.3.8. 18 §3.18.2 6번과 다르게 기본 끔으로 두고 미결로 남긴다(MQ-03) |
| Safari 동작이 바뀔 수 있다(EU에서 2024년 홈 화면 웹 앱을 일시 제거하려 했던 일 [지식]) | 경로 B를 열어 둔다(MOB-D11). 08 Device `push.provider`에 `apns`를 예약한다 |

결정 19와의 관계는 §2.1에 적었다. 데스크톱 UI를 데몬이 서빙하지 않는다는 20 ADR-20-04는 데스크톱의 이유(오프라인 시작, 원격 출처에 IPC 권한, SSH 경로)에 근거한다. 모바일 PWA에는 IPC가 없고 SSH 경로가 없으며, 오프라인 시작은 서비스 워커 캐시가 맡는다(§3.6.4). 그래서 20의 결정과 충돌하지 않는다.

#### 3.1.5 경로 B로 바꾸는 조건 [제안]

다음 중 하나가 생기고 사용자에게 유료 Apple 개발자 프로그램이 있으면 Tauri v2 iOS 앱 + APNs 직접 송신을 다시 본다.

1. 2주 사용에서 Web Push가 전달된 질문의 5% 넘게 뜨지 않는다(16이 `push.sent`와 열람을 대조해 잰다).
2. 한 달에 한 번 넘게 쿠키·저장소가 지워져 다시 페어링한다.
3. Safari가 홈 화면 웹 앱의 Web Push나 WebSocket을 막는 변경을 낸다.
4. 사용자가 알림 동작 단추, 잠금 화면 위젯처럼 네이티브에만 있는 기능을 원한다(05 §3.7.5의 원칙은 그대로).

경로 B의 모양: `apps/mobile`의 SPA를 그대로 Tauri iOS 셸(`apps/mobile/src-tauri`)에 넣고, 데스크톱의 Rust 전송(`transport/wss.rs`)과 `secrets.rs`(iOS protected store, X-11)를 다시 쓴다. 푸시는 `tauri-plugin-notifications`의 `push-notifications` 기능(X-10)으로 APNs 토큰을 받아 `device.registerPush { channel: "apns" }`로 등록한다. 데몬은 APNs HTTP/2 API로 직접 보낸다(비밀 `HELM_APNS_KEY_P8`, `HELM_APNS_KEY_ID`, `HELM_APNS_TEAM_ID`, `HELM_APNS_TOPIC`). 화면·문구·푸시 payload의 `helm` 부분은 같다. 빌드는 `run-on mac`으로 `tauri ios build`, 설치는 개발 프로파일(1년) 또는 TestFlight 내부 테스트다.

#### 3.1.6 Android와 iPad [제안]

- Android: 같은 PWA가 Chrome에서 설치·Web Push(FCM 엔드포인트)로 동작할 것으로 본다 [지식]. 사용자 기기에 Android가 없으므로 지원 대상에 넣지 않고 시험하지 않는다. 데몬의 엔드포인트 허용 목록에 `fcm.googleapis.com`을 넣어 막지만 않는다.
- iPad: iPadOS도 같은 PWA다(X-4). 너비 768px 이상이면 질문함 목록과 질문을 두 칸으로 보인다(§3.5.1). 별도 화면을 만들지 않는다.

### 3.2 전체 구조

```text
┌──────────────────────── iPhone ───────────────────────────────┐
│ Tailscale 앱 (VPN On Demand 권장)                               │
│ 홈 화면 웹 앱 "Helm" (Safari 엔진, 출처 https://server.tail7ad0b4.ts.net:8448) │
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
| 프로토콜 | `@helm/protocol` | 씀 | |
| 클라이언트 코어 | `@helm/client` (`.`, `./browser`) | 씀 | `./browser` 전송에 쿠키 방식(토큰 인자 없음)을 더한다(19에 요구) |
| React 연결 | `@helm/client-react` | 씀 | 20 §3.14의 `PlatformAdapter`를 모바일이 구현한다 |
| 문구 | `@helm/ui-language` | 씀 | 앱과 서비스 워커가 함께 쓴다 |
| 토큰·부품 | `@helm/ui-tokens`, `@helm/ui` | 씀 | 21 §3.13 |
| 앱 | `apps/mobile` = `@helm/mobile` | - | 06이 자리를 둔 이름을 확정한다 |

```text
apps/mobile/
  index.html                       viewport-fit=cover, lang="ko"
  vite.config.ts                   base '/m/', vite-plugin-pwa(injectManifest)
  public/manifest.webmanifest      id, name "Helm", start_url /m/, scope /m/, display standalone, icons
  public/icons/                    180·192·512 png (바이너리는 생성 스크립트로 만든다)
  src/main.tsx                     진입, 서비스 워커 등록
  src/app/routes.tsx               §3.5.2 경로
  src/screens/                     MobileInbox.tsx, MobileQuestion.tsx, MobileBrief.tsx, MobileAuto.tsx,
                                   MobileWork.tsx, MobileConnect.tsx, MobileSettings.tsx, MobileOnboard.tsx
  src/shell/                       MobileShell.tsx(머리·아래 탭), InstallGuide.tsx, CoverOnHide.tsx
  src/platform/pwa/                adapter.ts(PlatformAdapter), transport.ts, credential.ts(whoami·pair·logout),
                                   push.ts(구독·등록·지문 비교), lifecycle.ts(보임·숨김·입력), settings.ts
  src/sw/sw.ts                     서비스 워커: precache, push, notificationclick, 문구 생성
  src/sw/notify.ts                 payload 검증과 알림 문구 만들기(순수 함수, 시험 대상)
  test/                            단위·컴포넌트 시험, Playwright(WebKit, iPhone 뷰포트) 시나리오
packages/daemon/src/push/          webpush.ts(송신), planner.ts(보낼 대상 계산), store.ts(device_push), vapid.ts
packages/daemon/src/http/mobile-static.ts   /m/ 정적 서빙, CSP
packages/daemon/src/http/mobile-auth.ts     /m/pair, /m/whoami, /m/logout, 쿠키 판정
```

의존 규칙(06 §3.5 표에 더할 행): `@helm/mobile`은 `protocol`, `client`, `client-react`, `ui`, `ui-tokens`, `ui-language`, `domain`(타입)만 의존한다. `kernel`·`engine`·`runtime`과 `@tauri-apps/*`를 쓰지 않는다. `daemon/push`는 `web-push`(정확한 판 고정)만 새로 쓴다.

### 3.3 연결

#### 3.3.1 경로 [제안]

- 휴대폰은 `tailnet` 리스너만 쓴다. 주소는 데스크톱 WSS 경로와 같은 `https://server.tail7ad0b4.ts.net:8448`이고 WebSocket은 `wss://…:8448/rpc`다(19 §3.2.2). 정적 묶음도 같은 출처에서 받으므로 같은 출처 정책 아래에서 쿠키와 서비스 워커가 동작한다.
- 휴대폰의 Tailscale이 꺼져 있으면 서버 이름을 찾지 못한다. 앱은 서비스 워커가 캐시한 껍데기와 IndexedDB의 마지막 뷰를 읽기 전용으로 보이고, 연결 표시를 "연결 안 됨"으로 둔다(04 §3.0.4). 연결 점검 1단계 문구(04 §3.19 "이 기기에서 Tailscale이 켜져 있는지")를 그대로 쓴다.
- 권장 설정(설치 안내에 넣는다): Tailscale 앱의 VPN On Demand를 켜고 "`*.ts.net` 요청 시 연결"을 쓴다(X-12). 셀룰러·Wi-Fi 규칙을 "Always"로 두는 것도 된다. 둘 중 무엇을 고를지는 사용자 습관에 맡긴다.
- 푸시를 받는 데는 Tailscale이 필요 없다(Apple 푸시 서비스를 거친다). 알림을 누른 뒤 내용을 받는 데 필요하다.

#### 3.3.2 데몬의 모바일 정적 서빙 [제안, 19·17·18에 요구]

| 메서드·경로 | 리스너 | 인증 | 응답 |
|---|---|---|---|
| `GET /m/`, `GET /m/<경로>` (확장자 없는 경로) | `tailnet`만 | 전송 조건만(Tailscale 신원 헤더·whois, Host 검사, 18 §3.4.3) | `index.html`. 클라이언트 경로(§3.5.2)를 위해 확장자 없는 경로는 모두 `index.html`로 돌린다 |
| `GET /m/assets/<해시 이름>` | `tailnet` | 전송 조건만 | 정적 파일. `Cache-Control: public, max-age=31536000, immutable` |
| `GET /m/sw.js`, `GET /m/manifest.webmanifest` | `tailnet` | 전송 조건만 | `Cache-Control: no-cache`(갱신 확인용) |
| `POST /m/pair` | `tailnet` | 페어링 코드 + 전송 조건 + Origin 검사 | §3.3.3. 쿠키 설정, 본문에 토큰 없음 |
| `GET /m/whoami` | `tailnet` | 쿠키 | `{ serverId, deviceId, deviceName, tokenExpiresAt }` 또는 401 |
| `POST /m/logout` | `tailnet` | Origin 검사 | 쿠키 지우기(`Max-Age=0`). 기기 폐기는 하지 않는다 |

- 정적 파일 원본은 현재 릴리스의 `web/mobile/`(17 §3.10 릴리스 폴더, `/srv/volumes/helm/app/releases/<id>/web/mobile/`)다. 데몬은 시작할 때 이 폴더의 파일 목록과 해시를 읽어 메모리 표로 두고, 표에 없는 경로는 404로 끝낸다. 경로 정규화 뒤 `..`·심볼릭 링크로 폴더를 벗어나는 요청은 거부한다.
- 모든 `/m/` 응답 헤더:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' wss://server.tail7ad0b4.ts.net:8448; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

  `connect-src`의 호스트는 설정의 공개 호스트(18 §3.4.3 `cfg.listeners.tailnet.publicHost`)로 만든다. `style-src`에 `'unsafe-inline'`이 필요해지면(부품이 인라인 스타일을 쓰는 경우) 21이 부품에서 인라인 스타일 속성을 쓰지 않게 하는 쪽을 먼저 본다 [가정: Radix 위치 계산은 `style` 속성으로 쓰는데, CSP `style-src`는 `style` 속성(`style-src-attr`)도 막는다. 구현 때 확인하고 `style-src-attr 'unsafe-inline'`만 여는 것을 허용한다].
- 정적 경로는 `hello` 전에도 받는다. 묶음에는 비밀이 없다. 19 §3.2.5의 "정적 파일은 서빙하지 않는다"와 18 §3.4.5 "TCP 리스너는 hello 전에 아무것도 처리하지 않는다"에 이 경로를 예외로 더해 달라고 요구한다(§5.2).
- 개발 데몬(`just daemon-dev`)은 `tailnet` 리스너를 열지 않는다(17 F-35). 그래서 실기기 시험은 정식 데몬에서 하고, 개발 중 화면 시험은 가짜 데몬 + 브라우저로 한다(§3.6.2).

#### 3.3.3 인증: 쿠키로 나르는 기기 토큰 [제안, ADR-26-3]

18 §3.18.2 4번은 "PWA를 택하면 토큰을 HttpOnly 쿠키로 바꾸고 CSRF 대책을 둔다"를 요구했다. 이 문서는 그 요구를 따른다.

| 항목 | 값 |
|---|---|
| 쿠키 | `__Host-helm_dt=<기기 토큰>; Path=/; Max-Age=<토큰 남은 수명 초>; Secure; HttpOnly; SameSite=Strict`. `__Host-` 접두사는 `Secure`, `Path=/`, `Domain` 없음을 강제한다 [지식] |
| 토큰 | 18 §3.8.1 형식 그대로(`helm_dt_` + base64url 43자). 수명·유휴 만료·폐기도 18 그대로 |
| 쿠키를 받는 곳 | `tailnet` 리스너의 `GET /rpc` 업그레이드, `/files/*`, `/m/whoami`. 그 밖의 리스너는 쿠키를 보지 않는다 |
| 쿠키를 받는 기기 | `clientKind: "mobile"`이고 `/m/pair`로 발급된 기기(08 Device에 `credentialCarrier: "cookie"`). 데스크톱 토큰이 쿠키로 오면 거부한다 |
| Origin 검사 | 쿠키로 인증하는 모든 요청은 `Origin`이 모바일 출처(`https://<publicHost>`)와 같아야 한다. 없거나 다르면 403. WebSocket 업그레이드는 브라우저가 항상 `Origin`을 보낸다 [지식]. GET `/files/*`는 `Sec-Fetch-Site: same-origin`도 허용한다(이미지 요청은 Origin이 없을 수 있다) |
| `allowedOrigins` | 18 §3.4.3의 기본 빈 목록에 모바일 출처 하나를 더한다. 이 출처는 쿠키 경로에만 쓴다. `Authorization` 헤더 경로(데스크톱)는 지금처럼 Origin이 있으면 거부한다 |
| `Authorization`와 함께 오면 | 헤더를 쓴다(19 P-03). 쿠키는 무시 |
| 토큰과 자바스크립트 | 페이지 스크립트, 서비스 워커, IndexedDB, 로그 어디에도 토큰이 없다. 스크립트가 가진 것은 `deviceId`, `serverId`(비밀 아님)뿐이다 |

업그레이드 판정(18 §3.4.3 `preflight`에 더할 갈래):

```text
preflightMobileCookie(req, listener):
  if listener != tailnet: return notApplicable
  if req.headers.authorization 있음: return notApplicable          # 데스크톱 경로
  tok = cookie(req, "__Host-helm_dt")
  if !tok: return notApplicable                                     # 아래 기존 규칙(토큰 없음 → 401)
  if req.headers.origin != cfg.mobile.origin: → 403 ("origin_mismatch")
  if !matchesFormat(tok): → 401
  conn.bearer = tok; conn.carrier = "cookie"                        # hello에서 helloDeviceAuth가 판정(18 §3.6.1)
helloDeviceAuth 추가 검사: conn.carrier == "cookie"이면 rec.credentialCarrier == "cookie" 아니면 1008(reason "carrier_mismatch")
```

- `hello`의 `auth.deviceId`: 스크립트는 `localStorage`의 `deviceId`를 쓴다. 없으면(저장소가 지워짐) `GET /m/whoami`로 다시 얻는다. `whoami`가 401이면 페어링 화면으로 간다.
- 서명 증명(18 §3.8.5, Q18-02): 웹 앱은 Secure Enclave 키를 쓸 수 없다. 쿠키 방식에서는 스크립트가 토큰을 꺼낼 수 없으므로, 스크립트 저장소의 키로 서명을 더해도 막는 공격이 거의 늘지 않는다(XSS가 있으면 열린 세션 안에서 같은 일을 할 수 있다). 1차에는 모바일 기기도 `proofRequired: false`로 둔다(MQ-05). 18 §3.18.2 7번 권장과 다르므로 18에 알린다.
- scope는 19 §3.4.6의 모바일 값(`read`, `decide`, `devicesLimited`)을 그대로 쓴다.

#### 3.3.4 페어링 [제안, 흐름은 18 §3.7 흐름 A]

홈 화면 웹 앱은 Safari와 저장소를 나눠 쓰지 않는다(X-7). Safari에서 받은 쿠키는 설치한 앱에서 쓸 수 없으므로, 페어링은 **홈 화면에서 연 앱 안에서만** 한다.

| # | 사람 | 휴대폰 화면 | 데몬 |
|---|---|---|---|
| 1 | 데스크톱 `SCR-CONNECT` "새 기기 페어링 → 휴대폰"을 누르거나 서버에서 `helm pair --mobile --qr`을 실행 | (데스크톱) 설치 주소 QR(`https://server.tail7ad0b4.ts.net:8448/m/`)과 12자 코드, 만료 시각 | `pairing.code_created`(18) |
| 2 | 휴대폰 카메라로 QR을 읽어 Safari로 연다(Tailscale 켜짐) | `SCR-M-ONBOARD` 설치 단계: "공유 → 홈 화면에 추가"를 그림으로 안내. 이 화면(브라우저 탭)에서는 페어링 입력을 보이지 않는다 | 정적 서빙 |
| 3 | 홈 화면에 추가하고 "Helm" 아이콘으로 연다 | `SCR-M-ONBOARD` 연결 단계: 코드 입력 칸(12자, `XXXX-XXXX-XXXX`로 자동 끊어 보임), 기기 이름(기본 "iPhone" 또는 "iPad") | - |
| 4 | 코드를 입력하고 [연결] | "연결하는 중" | `POST /m/pair` → 18 §3.7.2 규칙(10분, 1회, 5회 시도, tailnet 신원) → 기기 생성(`clientKind: "mobile"`, `platform: "ios"`, `credentialCarrier: "cookie"`), 노드 묶기, `Set-Cookie`. 본문 `{ serverId, deviceId, tokenExpiresAt }` |
| 5 | - | `hello` 성공 → "연결됨 · 기기 9 iPhone" | `device.paired`, `device.connected` |
| 6 | [알림 켜기] (건너뛸 수 있음) | iOS 권한 창 → 허용 | §3.4.6 등록 → `device.push_registered` |
| 7 | [시험 알림 보내기] | 잠금 화면·알림 센터에 "Helm · 알림 시험입니다." | `device.testPush` → `push.sent` |

```http
POST /m/pair HTTP/1.1
Origin: https://server.tail7ad0b4.ts.net:8448
Content-Type: application/json

{"code":"K7Q4-XM92-PH3D","device":{"name":"iPhone","platform":"ios","clientKind":"mobile"}}

HTTP/1.1 200 OK
Cache-Control: no-store
Set-Cookie: __Host-helm_dt=helm_dt_…; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict

{"serverId":"…","deviceId":"dv_…","tokenExpiresAt":"2027-10-12T…Z"}
```

- 실패 응답은 19 §3.7.7의 `/pair`와 같다(`1009 pairing.invalidCode`, 사유 구분 없음).
- 설치 여부 판정: `matchMedia('(display-mode: standalone)').matches` 또는 `navigator.standalone`. 거짓이면 3단계 화면을 보이지 않는다. 개발·시험 빌드에서만 `?allowBrowser=1`로 이 검사를 끈다(정식 빌드에는 이 분기가 없다).
- 사람 조작: 설치 1회(공유 → 추가 → 열기), 코드 입력 1, 연결 1, 알림 켜기 2(단추 + 권한 창). 한 번만 한다.
- 데스크톱 `SCR-CONNECT`의 "새 기기 페어링"에 "휴대폰" 선택지를 두고, 고르면 `helm://pair` 링크 대신 설치 주소 QR을 보인다(04·20에 요구). 17 `helm pair --qr`은 `--mobile`일 때 설치 주소를 QR로 보인다(17에 요구).
- QR을 앱 안 카메라로 읽어 코드를 채우는 기능은 2차로 미룬다(MQ-10).

#### 3.3.5 연결 수명주기: 보임과 숨김 [제안, ADR-26-4]

휴대폰 웹 앱은 백그라운드에서 연결을 유지할 수 없다(X-8). 그래서 숨겨지면 스스로 닫고, 보이면 바로 다시 붙는다. 앱 쪽 상태 기계(`platform/pwa/lifecycle.ts`). `HelmClient`의 상태 기계(19 §3.10.2)는 그대로이고, 이 표는 그 바깥의 앱 수명주기다.

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| `starting` | 앱 시작(차가운 시작, 알림 누름 포함) | 쿠키 있음(`whoami` 200 또는 `deviceId` 있음) | `visible` | 캐시 뷰 그림(읽기 전용), `client.start()` |
| `starting` | 앱 시작 | 페어링 안 됨 | `unpaired` | `SCR-M-ONBOARD` |
| `visible` | `visibilitychange → hidden` 또는 `pagehide` | - | `hiding` | `presence.report { state: "hidden" }` 보냄(연결이 ready일 때만), 응답 대기 명령이 있으면 최대 2초 기다림 |
| `hiding` | 응답 대기 명령 0개 또는 2초 지남 | - | `hidden` | `client.stop()`(1000), 위치 저장은 코어가 이미 했다. 화면 가림막을 그린다(§3.3.8) |
| `hiding`·`hidden` | `visibilitychange → visible` | - | `visible` | `client.start()` 뒤 `client.retryNow()`. 열린 뷰 다시 받기(코어 `syncing`). 처리된 질문의 알림 지우기(§3.4.9) |
| `hidden` | iOS가 앱을 멈추거나 종료 | - | (없음) | 다음 실행은 `starting` |
| `visible` | 네트워크 바뀜(`online`·`offline` 이벤트) | - | `visible` | `online`이면 `retryNow()` |
| 아무 상태 | 1005·4009(폐기) | - | `unpaired` | 이 서버의 뷰 캐시·진행 중 명령함·초안을 지운다(18 §3.19), `POST /m/logout` |

- 응답 대기 명령이 있는 채로 닫히면 그 명령은 진행 중 명령함에 남고, 다시 붙을 때 같은 멱등 키로 다시 보낸다(19 §3.9, J-02). 사용자가 다시 누르지 않는다.
- 다시 붙는 동안(`connecting`~`syncing`) 결정 버튼은 막는다(04 §3.0.4 "다시 맞추는 중"). 보통 1~3초다. 목표는 §3.4.8.
- 이벤트 구독은 19 §3.17 권고대로 `filter.payload: "none"`(머리와 무효화 태그만)으로 하고, 화면에 필요한 뷰만 `view.get`으로 받는다. 휴대폰은 질문함·질문·요약·진행 중 화면만 열므로 받는 양이 적다.
- 오래 숨겨졌다가 돌아와 `2001 replay.outOfRange`가 나면 19 §3.5.5 스냅숏 경로로 간다. 휴대폰은 위치가 오래되기 쉬우므로 이 경로가 데스크톱보다 자주 쓰인다. 열린 뷰를 다시 받는 것으로 끝나므로 사용자가 할 일은 없다.

#### 3.3.6 오프라인, 초안, 재전송 [J-02, 제안]

- 연결이 없거나 뷰가 낡으면 결정 버튼을 막고 쓰던 내용은 초안으로 둔다. 초안은 `@helm/client-react`의 IndexedDB 초안 저장소(20 §3.9.5 `DraftRow`)를 그대로 쓴다. 데이터베이스 이름은 `helm-mobile`이다.
- 다시 연결되면 초안이 있는 질문에 "보내지 않은 답이 있습니다. 바뀐 상황을 확인하고 보내세요."를 보인다(05 §3.1.8). 자동으로 보내지 않는다.
- 같은 질문을 휴대폰과 데스크톱에서 답하면 먼저 받아들여진 답이 남는다. 늦은 쪽은 04 §3.0.5 "이미 처리됨"을 보인다(04 §4 첫 행).
- 사람 결정의 이벤트에는 기기 id와 경로(`via.kind = "device"`, `listener = "tailscale"`)가 남는다(02 AC-04-08). 휴대폰에서 낸 답과 데스크톱에서 낸 답의 차이는 이것뿐이다(AC-04-09).
- 뷰 캐시 크기: 서버당 8 MiB, 뷰 50개, 오래 열지 않은 것부터 지운다. 데스크톱보다 작게 둔다(휴대폰 저장 공간과 X-6의 정리 정책).

#### 3.3.7 presence [제안, J-28에 대한 답]

| 값 | 휴대폰에서의 판정 |
|---|---|
| `active` | 화면이 보이고(`visibilityState == "visible"`) 마지막 터치·키 입력이 2분 안. 휴대폰은 짧게 보고 닫으므로 데스크톱(5분)보다 짧게 둔다 |
| `idle` | 보이지만 2분 넘게 입력이 없음 |
| `hidden` | 숨겨지기 직전에 한 번 보낸다(§3.3.5). 그 뒤 연결을 닫으므로 데몬은 곧 연결 없음으로 본다 |
| `locked` | 보내지 않는다 |

- 웹 플랫폼은 화면 잠금과 다른 앱으로 전환을 구분하는 신호를 주지 않는다. 둘 다 `visibilitychange → hidden`이다 [지식]. 잠긴 휴대폰의 앱은 곧 멈추므로 `locked`를 보낼 시간도 없다(X-8). 경로 B(네이티브)여도 잠기는 순간 앱이 백그라운드로 가므로 같다. 그래서 **어떤 클라이언트도 `locked`를 보내지 않는다.** 판정 J-28("모바일만 보낸다")에 대해 "모바일도 보내지 않는다"로 답하고, 19 `PresenceState`와 09 `PresenceState`의 `locked`는 예약 값으로 두거나 빼 달라고 요구한다(§5.2). 11 Q-E20의 처리(잠금은 `idle`→`away`로 흡수)가 그대로 맞다.
- `screen`은 03 화면 ID(`SCR-M-QUESTION` 등), `objectId`는 경로의 레코드 ID다. 16의 열람 기록(`view.opened`)은 화면 ID가 `SCR-M-*`이어도 데스크톱 대응 화면과 같은 종류로 센다(16에 요구).

#### 3.3.8 분실, 폐기, 화면 가림 [제안, 18 §3.18과 맞춤]

- 분실 대응(18 §3.18.2 8번): (1) Tailscale 관리 콘솔에서 휴대폰 노드 제거 → 노드 묶기 때문에 쿠키가 있어도 `tailnet` 리스너를 통과하지 못한다. (2) 데스크톱 `SCR-CONNECT` 또는 `helm device revoke <dv_id> --reason lost`. (3) 폐기 뒤 데몬은 그 기기의 `device_push` 행을 지우고 `device.push_unregistered { reason: "revoked" }`를 남긴다. 그 휴대폰에 푸시가 더 가지 않는다.
- 이 기기 폐기(`SCR-M-CONNECT`): `device.revoke { deviceId: 자기 }` → 응답 뒤 4009 → §3.3.5 마지막 행.
- 앱 전환 화면 가림: `visibilitychange → hidden`에서 화면 위에 불투명 가림막(앱 이름만)을 그린다. iOS가 전환 화면을 찍는 시점보다 먼저 그려지는지는 확실하지 않다 [가정]. §6.2 M-07에서 확인하고, 안 되면 한계로 기록한다.
- 앱 잠금(18 §3.18.2 6번 "생체 인증 또는 기기 암호, 기본 켬"): 웹 앱은 로컬 생체 인증 API가 없다. WebAuthn(패스키) 확인을 데몬이 검증하는 방식으로만 만들 수 있다. 1차에는 넣지 않고 휴대폰 자체 잠금에 맡긴다. 결정마다 추가 확인을 넣으면 사람 조작 상한(05 §3.4)과 맞지 않는다. 미결 MQ-03에 선택지를 두고 18에 알린다.

### 3.4 알림

#### 3.4.1 경로 비교

| 기준 | APNs 직접(네이티브 앱) | **Web Push(PWA)** | 자체 호스팅 ntfy + ntfy iOS 앱 | 공개 ntfy.sh 토픽 | 텔레그램 봇 | Pushover·Bark 같은 외부 앱 | 푸시 없음 |
|---|---|---|---|---|---|---|---|
| 필요한 계정 | 유료 Apple 개발자(X-2) | 없음(X-4) | 없음. ntfy 서버를 새로 운영 | 없음 | 텔레그램 계정, 봇 | Pushover 유료 앱 / Bark 서버 | 없음 |
| 외부에 남는 것 | Apple이 알림 메타데이터를 본다. payload는 Apple 경유(TLS) | 푸시 서비스는 시각과 크기만 안다. payload는 RFC 8291로 종단 암호화 [지식] | ntfy.sh가 메시지 ID·토픽 해시·시각을 안다(X-9) | ntfy.sh가 본문 전체를 본다 | 텔레그램이 본문 전체를 본다 | 해당 서버가 본문을 본다 | 없음 |
| 알림을 누르면 | 앱이 해당 화면으로 | 홈 화면 웹 앱이 `navigate` 주소로 열린다(X-5) | ntfy 앱이 먼저 열리고, 클릭 URL은 Safari로 열린다. 홈 화면 웹 앱의 쿠키를 쓸 수 없다(X-7) | 같음 | 텔레그램이 열린다. 링크는 Safari로 | 해당 앱 | - |
| 답까지 사람 조작 | 탭 1 + D1 | 탭 1 + D1 | 탭 2 이상 + D1, PWA와 이어지지 않음 | 같음 | 같음. 봇 안에서 답하면 기기 인증·19 명령 경로를 벗어난다(결정 14, NFR-S-8) | 같음 | 앱을 열어야 안다 |
| 데몬 쪽 추가 | APNs HTTP/2 송신, .p8 키 | Web Push 송신, VAPID 키 | ntfy 컨테이너, 토픽 비밀, upstream 설정 | 토픽 이름(=비밀) | 봇 토큰, 아웃바운드 | 해당 API 키 | 없음 |
| J-03·J-31 지키기 | 앱이 문구를 만든다 | 서비스 워커가 문구를 만든다 | ntfy 앱이 받은 본문을 그대로 보인다. 문구 키 사용 불가 | 같음 | 같음 | 같음 | - |

#### 3.4.2 선택 [제안, ADR-26-2]

Web Push를 고른다. 구현 방식(PWA)과 함께 움직이는 경로이고, 계정이 필요 없으며, 알림을 누르면 같은 앱(같은 쿠키·캐시)이 열린다. payload가 종단 암호화되므로 내용 숨김을 꺼도 푸시 서비스가 내용을 읽지 못한다. 18 Q18-09가 권한 홈랩 ntfy는 (1) 홈랩에 ntfy 서버가 없고 `NTFY_URL`도 비어 있으며(§2.2), (2) iOS 즉시 알림에 공개 ntfy.sh 중계가 필요하고(X-9), (3) 알림을 누르면 Safari가 열려 PWA와 이어지지 않으므로 고르지 않는다. 경로 B로 바꾸면 APNs 직접으로 바꾼다(§3.1.5).

#### 3.4.3 언제 푸시를 보내는가 [제안, 11에 요구]

원칙: 푸시는 11의 전달 결정이 기록된 질문에만 보낸다(05 §3.7.1, 19 §3.8.3, 18 §3.18.2 9번). 진행 보고, 에이전트가 정한 것, 관찰 제안에는 보내지 않는다.

11의 알림 강도 계산(11 §3.5.1 `urgencyOf`)은 사람이 자리에 없으면(`presence.state == 'away'`) 모두 `digest`(OS 알림 없음)로 낮춘다. 휴대폰 푸시의 목적은 바로 이 "자리에 없을 때"다. 그래서 11에 다음 수정을 요구한다.

```text
# 11 §3.8.1 PresenceSnapshot에 더함
pushReachable: readonly DeviceId[]   # push 등록이 정상(state 'ok')이고 폐기·만료되지 않은 기기. 데몬이 device_push와 기기 상태로 만든다

# 11 §3.5.1 urgencyOf 첫 줄을 바꿈
urgencyOf(q, presence, dials, state):
  if presence.dnd or presence.attention == 'quiet_hours': return 'digest'
  if presence.state == 'away' and presence.pushReachable 비어 있음: return 'digest'
  ... (나머지 그대로: 승격 interrupt, 즉시+막힘+권리 interrupt, 즉시 notice, 협상 notice, 그 밖 digest)
```

- 이 수정은 강도만 바꾼다. 전달 방식 규칙(D-1~D-11)은 그대로다. 사람이 없을 때 정보 게이트 질문은 여전히 D-9로 `user_return`까지 예약되므로 푸시가 가지 않는다. 푸시가 가는 것은 즉시로 놓이는 것들이다: 권리 게이트(D-1), 큰 지연 비용의 막힘(D-2), 만료 임박 승격(D-3), 결과 확인·합의 확인(A·C 루프의 D-1).
- 방해 금지·조용한 시간에는 어떤 경우에도 보내지 않는다(05 §3.7.4).

보낼 기기 고르기(데몬 `push/planner.ts`, 11 §3.5.3의 전달기가 `notify` 지시를 처리할 때 부른다):

```text
planPush(delivery, presence, devices, settings, now):
  # delivery: notify 지시 하나 (questionIds, urgency, category, copy, target, batchKey, deliveryId)
  if presence.dnd or presence.attention == 'quiet_hours': return []
  live = 연결된 기기 목록 (presence active·idle·hidden)
  if 어떤 기기의 presence가 'active': return []                  # 사람이 다른 기기 앞에 있다. 그 기기가 OS 알림을 띄운다(11 §3.5.6)
  out = []
  for d in presence.pushReachable:
     if d ∈ live and presence(d) == 'idle': continue             # 그 기기 화면이 켜져 있다. 앱 안 알림으로 충분
     if rank(delivery.urgency) < rank(d.push.minUrgency): continue   # 기본 minUrgency 'interrupt'
     if sentCount(d, delivery.questionIds, window=전체) >= 2: continue   # 같은 질문은 전달 1 + 승격 1까지(05 §3.7.1)
     if hourlyCount(d, now) >= settings.push.hourlyCap and delivery.urgency != 'interrupt': continue   # 기본 6
     delay = live 비어 있음 ? 0 : settings.push.followupDelayMs     # 기본 60,000. 다른 기기가 연결만 되어 있을 때
     out.push({ device: d, delayMs: delay })
  return out
```

- `delayMs > 0`이면 런타임 타이머(09 `runtime_timers`, 목적 `push_followup`)를 건다. 타이머가 울릴 때 그 질문이 `delivered` 상태이고 열람(19 `presence.report`의 `objectId`)·답이 없으면 보낸다. 아니면 버린다.
- `question.delivered`의 `channel`: 연결된 기기에 보냈으면 `app`, 연결된 기기가 없고 푸시를 보냈으면 `push`, 둘 다 아니면 `brief`(11 §3.5.3 1번을 이렇게 넓힌다). `targetDevices`에는 실제로 보낸 기기들을 넣는다.
- 방해 금지가 끝날 때: 방해 금지 동안 푸시를 보내지 않은 즉시 전달 질문 중 아직 열려 있는 것이 있으면, 끝나는 시각에 묶음 푸시 하나("확인할 일 n건", `kind: "bundle"`)를 보낸다(05 §3.7.4). 타이머 목적 `push_dnd_digest`.
- 재전송·재접속에서 생긴 전달 이벤트로는 푸시를 보내지 않는다. 푸시는 전달 지시를 처리할 때 한 번만 계획한다.

#### 3.4.4 푸시 payload [제안]

Declarative Web Push 형식(X-5)으로 보낸다. iOS 18.4 이상에서는 서비스 워커가 실패해도 중립 알림이 뜨고, 16.4~18.3과 Android에서는 서비스 워커가 같은 JSON을 읽어 알림을 만든다.

```ts
// @helm/protocol/src/push.ts (데몬과 서비스 워커가 함께 쓴다)
export interface HelmPushMessage {
  web_push: 8030;
  notification: {
    title: "Helm";                               // 고정. 서비스 워커가 없을 때의 중립 문구(J-03)
    body: string;                                // 고정 "확인할 일이 있습니다." (PUSH_FALLBACK_BODY)
    navigate: string;                            // https://<publicHost>/m/q/<qsId> 또는 /m/ (묶음)
    tag?: string;                                // 질문 ID 또는 "bundle". 같은 질문의 승격 알림이 앞 알림을 바꾼다
    app_badge?: string;                          // 질문함 배지 수(선택 필요 + 확인하면 좋은 것)
  };
  helm: {
    v: 1;
    serverId: string;
    deliveryId: string;                          // 11 §3.5.6. 중복 표시 방지
    kind: "question" | "bundle" | "test";
    questionId: string | null;                   // 질문 ID는 비밀이 아니다(19 §3.17)
    category: "question" | "rights_gate" | "review" | "goal" | "recovery" | "system";
    urgency: "interrupt" | "notice";
    copy: { titleKey: string; bodyKey: string; args: Record<string, string> };   // 05 문구 키(J-31)
    count: number;                               // 묶음이면 질문 수, 아니면 1
    badge: number;
    sentAt: string;                              // ISO 8601 UTC
  };
}
export const PUSH_FALLBACK_TITLE = "Helm";
export const PUSH_FALLBACK_BODY = "확인할 일이 있습니다.";   // @helm/ui-language `notif.hidden.body`와 같은지 시험한다(T26-12)
```

- `copy.args`: 기기의 `contentLevel`이 `hidden`(기본)이면 `count`만 넣는다. `summary`이면 05 §3.7.2의 제목·본문 인자(할 일, 마감 효과, Concern 이름, 질문 번호)를 넣는다. 질문 문장 전체, Goal 서술, 근거 내용, 비밀은 어느 경우에도 넣지 않는다(05 §3.7.5, 18 §3.18.2 9번).
- 크기: 직렬화 3 KiB 이하(암호화 전). 넘으면 `args`를 버리고 `hidden` 수준으로 보낸다.
- HTTP 헤더(RFC 8030): `TTL`은 즉시 전달 12시간, 승격은 만료점까지 남은 시간(최소 5분), 묶음 6시간. `Urgency: high`(interrupt) / `normal`(notice). `Topic`은 질문 ID의 SHA-256 앞 22자(base64url, 32자 상한 안)로 두어 아직 배달 전인 같은 질문의 푸시를 바꾼다.
- 데몬은 `@helm/ui-language`를 import하지 않는다(06 §3.4 규칙). 중립 문구 두 개만 `@helm/protocol`의 상수로 두고, 문구 목록과 같은지는 시험으로 묶는다.

#### 3.4.5 서비스 워커 처리 [제안]

```ts
// apps/mobile/src/sw/sw.ts (개요)
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    const msg = parsePush(e.data?.json());            // 스키마 검사. 실패하면 중립 알림
    const s = await readDeviceSettings();             // IndexedDB: contentLevel, serverId
    if (!msg || msg.helm.serverId !== s.serverId) return showFallback(msg);
    const { title, body } = renderNotification(msg, s);   // @helm/ui-language, 순수 함수(notify.ts)
    await self.registration.showNotification(title, {
      body, tag: msg.notification.tag, data: { navigate: msg.notification.navigate, deliveryId: msg.helm.deliveryId },
      badge: undefined, icon: "/m/icons/192.png",
    });
    if ("setAppBadge" in navigator) await navigator.setAppBadge(msg.helm.badge);
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(focusOrOpen(e.notification.data.navigate));   // 열린 창이 있으면 postMessage로 이동, 없으면 openWindow
});
```

- 문장 규칙: `hidden`이면 제목 "Helm", 본문 "확인할 일이 {n}건 있습니다."(05 §3.7.6 A8 문구, `notif.hidden.*`). `summary`이면 05 §3.7.2·§3.7.5의 키(`notif.question.rights.title` 등)로 만든다. 서비스 워커는 알림을 반드시 하나 띄운다(`userVisibleOnly`). 띄우지 않는 경우를 만들지 않는다.
- 잠금 화면 노출은 iOS 설정(알림 미리보기)이 따로 정한다 [지식]. 앱은 잠금 상태를 감지하지 않는다(05 §3.7.6).
- 알림 동작 단추(`actions`)를 쓰지 않는다(05 §3.7.5).
- 서비스 워커가 쓰는 문구 묶음은 `@helm/ui-language`에서 `notif.*` 키만 뽑아 넣어 크기를 줄인다(빌드 단계에서 트리 셰이킹).

#### 3.4.6 푸시 등록: 08 Device `push` 형식 [제안, 08·09·10·19에 요구]

08 §3.19.1 Device의 `push` 필드를 다음으로 바꿔 달라고 요구한다.

```ts
// @helm/domain/src/records/device.ts
export const PushProvider = Type.Union([Type.Literal("webpush"), Type.Literal("apns"), Type.Literal("fcm")]);  // 1차는 webpush만 받는다
export const PushRegistration = Obj({
  provider: PushProvider,
  /** webpush: sha256(endpoint URL), apns·fcm: sha256(기기 토큰). 원문은 운영 테이블 device_push(18 §3.18.2 9번) */
  tokenHash: Sha256,
  /** 화면·진단용. tokenHash 16진수 앞 8자 */
  tokenHint: Type.String({ pattern: "^[0-9a-f]{8}$" }),
  /** webpush 엔드포인트 호스트(예: "web.push.apple.com"). apns는 "api.push.apple.com" 또는 sandbox */
  endpointHost: Type.String({ minLength: 1, maxLength: 253 }),
  contentLevel: Type.Union([Type.Literal("hidden"), Type.Literal("summary")]),   // 기본 hidden (J-03)
  minUrgency: Type.Union([Type.Literal("interrupt"), Type.Literal("notice")]),   // 기본 interrupt (MOB-D05)
  /** 구독에 쓴 VAPID 공개 키의 sha256 앞 12자. 데몬 키가 바뀌면 다시 구독해야 함을 안다 */
  vapidKeyId: Nullable(Type.String({ pattern: "^[0-9a-f]{12}$" })),
  registeredAt: Ms,
});
// Device에서: push: Nullable(PushRegistration)
// Device에 더함: credentialCarrier: Type.Union([Type.Literal("header"), Type.Literal("cookie")])  // §3.3.3. 기본 header
```

운영 테이블(09 §3.12의 운영 테이블 목록에 더함. 정본 이벤트가 아니다):

```sql
CREATE TABLE device_push (                 -- 푸시 송신에 필요한 원문. 이벤트·재전송·투영·관찰 입력·진단 묶음에 넣지 않는다
  device_id     TEXT    PRIMARY KEY,       -- dv_…
  provider      TEXT    NOT NULL,          -- webpush | apns | fcm
  token_hash    TEXT    NOT NULL,          -- device.push_registered의 tokenHash와 같아야 함
  material      TEXT    NOT NULL,          -- JSON. webpush: {"endpoint":…,"keys":{"p256dh":…,"auth":…}}, apns: {"token":…,"env":"production"|"sandbox"}
  registered_at INTEGER NOT NULL,
  last_ok_at    INTEGER,
  last_error    TEXT,                      -- HTTP 상태와 짧은 사유. 엔드포인트 URL은 넣지 않는다
  fail_count    INTEGER NOT NULL DEFAULT 0
) STRICT;
```

이벤트(09 §3.4.13 통치 이벤트에 더함):

| 이벤트 | 범주·평면 | 행위자 | subject | payload | 상태 효과 |
|---|---|---|---|---|---|
| `device.push_registered` | governance·A | human(그 기기의 명령) | dv | `PushRegistration` | Device.push 설정·교체 |
| `device.push_unregistered` | governance·A | human / runtime | dv | `{ reason: "user" \| "gone" \| "revoked" \| "permission_lost" \| "key_rotated" }` | Device.push = null |
| `push.sent` | system | runtime | dv | `{ deliveryId, questionIds, provider, outcome: "accepted" \| "gone" \| "rejected" \| "failed", httpStatus: Nullable(Integer), attempt }` | 없음(감사·16 지표). 이름은 09가 정한다 |

명령과 메서드(19 §3.17의 형식을 이 값으로 확정):

```ts
// device.registerPush (cmd, scope devices·devicesLimited(자기 기기만))
export interface DeviceRegisterPushParams extends CommandParamsBase {
  channel: "webpush";                         // 1차. "apns" | "fcm"는 예약
  address: string;                            // 엔드포인트 URL(https만)
  keys: { p256dh: string; auth: string };     // base64url
  contentLevel: "hidden" | "summary";
  minUrgency: "interrupt" | "notice";
  vapidKeyId: string;                         // 구독에 쓴 키 (device.pushConfig 결과)
}
export interface DeviceRegisterPushResult extends CommandResult { fingerprint: string }   // tokenHint와 같은 값
// device.unregisterPush (cmd): { channel: "webpush"; reason?: "user" | "permission_lost" }
// device.pushConfig (read, scope read): 등록 전에 부른다
export interface DevicePushConfigResult {
  enabled: boolean;                           // 데몬 설정 push.enabled와 VAPID 비밀이 모두 있을 때 true
  providers: Array<"webpush">;
  vapidPublicKey: string | null;              // base64url (applicationServerKey)
  vapidKeyId: string | null;
}
// device.testPush (cmd, scope devicesLimited(자기 기기만)·devices): 이 기기로 kind "test" 푸시 하나
// DeviceInfo.push (19 §3.7.7)를 다음으로:
//   push: { channel: "webpush" | "apns" | "fcm"; registeredAt: IsoTime; fingerprint: string; contentLevel; minUrgency;
//           state: "ok" | "failing" | "needs_refresh"; lastOkAt: IsoTime | null } | null
```

데몬 검증(커널 판정이 없는 통치 명령, 10 §3.11 끝 문단의 방식):

1. `address`는 `https:` URL이고 호스트가 허용 목록(설정 `push.webpush.allowedEndpointHosts`, 기본 `["*.push.apple.com", "fcm.googleapis.com", "*.notify.windows.com", "updates.push.services.mozilla.com"]`)에 있어야 한다. 아니면 `content` 갈래 거부 `push.endpoint_not_allowed`. 클라이언트가 `http://127.0.0.1:2019/…` 같은 주소를 등록해 데몬이 내부 서비스로 요청을 보내게 하는 일(18 T-M5와 같은 종류)을 막는다.
2. `keys.p256dh`는 65바이트 P-256 공개 점, `auth`는 16바이트여야 한다.
3. `vapidKeyId`가 현재 키와 다르면 `content` 갈래 거부 `push.vapid_key_mismatch`(앱이 다시 구독한다).
4. 같은 트랜잭션에서 `device_push` 행을 쓰고 `device.push_registered`를 남긴다. 같은 `tokenHash`·같은 설정이면 이벤트를 다시 남기지 않고 결과만 돌려준다(멱등).

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
  if me.push == null or me.push.fingerprint != fp or me.push.state == 'needs_refresh'
     or me.push.contentLevel != settings.contentLevel or me.push.minUrgency != settings.minUrgency:
     device.registerPush({ channel:'webpush', address: sub.endpoint, keys: sub.toJSON().keys, ... })
```

- 처음 구독(`subscribe`)과 권한 요청은 사용자 조작 안에서만 한다(X-4). `ensurePush`는 이미 허용된 뒤의 갱신만 한다.
- 데몬이 `404`·`410`을 받으면 그 구독은 끝난 것이다. `device_push` 행을 지우고 `device.push_unregistered { reason: "gone" }`. 다음에 앱이 열리면 `ensurePush`가 다시 구독한다.
- 데몬을 복원해 `device_push` 행이 없는데 Device.push가 남아 있으면 `DeviceInfo.push.state = "needs_refresh"`로 보이고, 앱이 다음 실행 때 다시 등록한다. 결정 29(로그에서 재구성)를 지키기 위해 원문이 로그에 없어도 상태가 스스로 돌아오게 한 것이다.

#### 3.4.7 VAPID 키와 송신 [제안]

| 항목 | 값 |
|---|---|
| 비밀 | `HELM_VAPID_PRIVATE_KEY`(P-256 개인 키, base64url). 제품 비밀 `~/projects/helm/secrets/prod.sops.yaml`. 공개 키는 개인 키에서 계산한다. 데몬은 시작 때 SecretStore로 받는다(결정 45) |
| 키 만들기 | `just mobile-vapid-keygen`이 새 키 쌍을 만들어 한 번 표준 출력에 보이고, 사람이 `secrets edit prod`로 넣는다. `.env.example`에 `HELM_VAPID_PRIVATE_KEY=`를 적는다 |
| 키가 없을 때 | `push.enabled`가 참이어도 푸시를 끈 것으로 본다. `daemon.status.warnings`에 `push_no_vapid_key`(17 점검 ID로 요구), `device.pushConfig.enabled = false` |
| 키 교체 | 키를 바꾸면 모든 구독이 무효다. 데몬은 시작 때 `vapidKeyId`가 다른 등록을 모두 `device.push_unregistered { reason: "key_rotated" }`로 정리하고, 앱은 다음 실행 때 다시 구독한다 |
| `sub` | 설정 `push.webpush.subject`. 기본값은 `https://<publicHost>/m/` [가정 AS-M6]. 사용자 이메일을 기본값으로 쓰지 않는다 |
| 송신 라이브러리 | `web-push` 3.6.7(정확한 판 고정, X-15. OpenClaw가 쓰는 판, X-13). 의존이 오래되었거나 Node 24에서 문제가 생기면 RFC 8291(aes128gcm)·RFC 8292(VAPID JWT)를 Node `crypto`로 직접 구현한다(150행 안팎) [제안, MQ-08] |
| 재시도 | 429·5xx·네트워크 오류는 1초, 5초, 30초 뒤 세 번 다시 보내고 TTL을 넘기지 않는다. 4xx(404·410 제외)는 다시 보내지 않는다. 결과는 `push.sent`로 남긴다 |
| 바깥 연결 | 데몬 프로세스만 보낸다. 도구 샌드박스는 영향 없다. 18 §3.18.2 9번 "설정에 이름을 적은 호스트로만"은 위 허용 목록으로 지킨다 |

#### 3.4.8 알림에서 답까지 [제안]

| # | 사람 | 화면 | 시간 목표 |
|---|---|---|---|
| 1 | 잠금 화면의 "Helm · 확인할 일이 1건 있습니다."를 누른다 | (Face ID로 잠금 해제는 OS 조작이라 세지 않는다) | 질문 기록 → 알림 표시: p95 10초 이하(전달 지시 처리 + 푸시 서비스) |
| 2 | - | 웹 앱이 `/m/q/<qsId>`로 열린다. 캐시된 질문 카드를 읽기 전용으로 먼저 보이고, 머리에 "연결하는 중" | 화면이 그려지기까지 1초 이하(서비스 워커 캐시) |
| 3 | 질문을 읽는다 | 연결 ready → 버튼 활성 | 알림 누름 → 결정 버튼 활성: Tailscale이 이미 연결되어 있으면 p95 3초, VPN On Demand가 연결을 새로 맺으면 p95 6초 |
| 4 | 주 버튼을 누른다 | "보내는 중" → "적용됨" + 영향 표시 | 01 NFR-P-1과 같음 |

사람 조작: 보기 1(알림 누름) + D1. 데스크톱 UC-04(단계 3·5)와 같다(02 AC-04-02).

알림 표시 시간 목표(p95 10초)는 01 NFR-P-6(연결된 기기 5초)과 따로 둔다. 푸시 서비스를 거치는 시간은 Helm이 정할 수 없으므로 측정만 한다(16에 요구).

#### 3.4.9 배지, 철회, 중복 [제안]

- 철회 푸시를 보내지 않는다. 다른 기기에서 답했다고 휴대폰에 푸시를 다시 보내면 iOS 규칙상 알림을 하나 더 띄워야 한다(X-5 `userVisibleOnly`). 대신:
  - 같은 질문의 승격 푸시는 `tag`가 같아 앞 알림을 바꾼다.
  - 앱이 보이게 될 때 `registration.getNotifications()`로 띄운 알림을 읽어, `inbox` 뷰에서 이미 처리된 질문의 알림을 닫는다.
  - 처리된 질문의 알림을 누르면 04 §3.0.5 "이 질문은 09:12에 답했습니다(다른 기기)"를 보인다.
- 배지: 푸시의 `badge`와 앱이 보일 때 `tray` 뷰 값으로 `setAppBadge`를 갱신한다(X-4). 질문함이 비면 `clearAppBadge`.
- 같은 `deliveryId`는 한 번만 띄운다. 서비스 워커가 최근 200개를 IndexedDB에 둔다.
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
│ 질문함 3 │ 요약 │ 정한 것 2 │ 진행 중 │  MobileTabBar (아래 안전 영역 위)
└──────────────────────────────┘
```

- 아래 탭 넷: 질문함(`SCR-M-INBOX`, 배지 = 전달된 질문 수, 권리 게이트 수는 강조), 요약(`SCR-M-BRIEF`, 배지 없음), 정한 것(`SCR-M-AUTO`, 배지 = 마지막 확인 이후 새로 생긴 수), 진행 중(`SCR-M-WORK`, 배지 없음). 배지 수는 데몬 뷰 값이다(앱이 세지 않는다, 03 §6).
- 머리: 앱 이름, 연결 표시(누르면 `SCR-M-CONNECT`), 설정 단추.
- 안전 영역: `viewport-fit=cover`와 `env(safe-area-inset-*)`로 노치·홈 표시줄을 피한다. 높이는 `100dvh`.
- iPad(너비 768px 이상): 질문함 탭에서 왼쪽 목록, 오른쪽 질문 두 칸. 다른 탭은 가운데 한 열(최대 680px).
- 키보드 조합은 두지 않는다(03 §3.12). 하드웨어 키보드가 붙은 iPad에서도 Tab·Enter만 쓴다.

#### 3.5.2 경로 [제안]

| 화면 ID | 경로 | 딥 링크(03 §3.5.4) 대응 |
|---|---|---|
| `SCR-M-INBOX` | `/m/` | - |
| `SCR-M-QUESTION` | `/m/q/:qsId` | `helm://question/<qsId>` |
| `SCR-M-BRIEF` | `/m/brief` | `helm://brief` |
| `SCR-M-AUTO` | `/m/auto` | - |
| `SCR-M-WORK` | `/m/work` | - |
| `SCR-M-CONNECT` | `/m/connect` | - |
| `SCR-M-SETTINGS` | `/m/settings` | - |
| `SCR-M-ONBOARD` | `/m/onboard` | - |

- 웹 앱은 `helm://` 스킴을 받을 수 없다. 데몬은 푸시 `navigate`에 위 경로를 쓰고, 03 §3.5.4의 딥 링크는 데스크톱용으로 그대로 둔다. 둘의 대응은 `@helm/client-react`의 딥 링크 해석 표(20 §3.14) 하나에 둔다.
- 모바일에 없는 화면을 가리키는 링크(`helm://concern/…`, `helm://evidence/…` 등)는 "데스크톱에서 열 수 있습니다"와 관련 질문·요약 링크를 보인다(03 §3.12).
- `helm://question/<id>`의 종류가 합의 확인·결과 확인·복구 판단이어도 모바일은 `SCR-M-QUESTION` 하나에서 처리한다(별도 화면 없음).

#### 3.5.3 `SCR-M-INBOX` 질문함

```text
질문함                                    [모두 ▾]
─────────────────────────────────────────
지금 정할 것
┃ 선택 필요 · 질문 15 · Concern 12
┃ 초안을 외부 리뷰어에게 보내도 될까요
┃ 즉시 전달 09:10 · 오늘 18:00 마감          ›
┃ 결과 확인 · WorkUnit 31 · Concern 12
┃ 본문 1절 초안 · 기준 3개 중 2개 확인됨        ›
확인하면 좋은 것
│ 확인 · 질문 14 · 임시 가정으로 진행 중
│ 만료: 본문 2절 전 (약 40분)                  ›
│ 반응 요청 · 라운드 3 · Concern 9
│ 데스크톱에서 답하기                  [미루기]
함께 답할 수 있는 묶음 (라운드 3 끝)
│ 질문 16, 17 · Concern 9                    ›
곧 전달될 것 (2) ▸
최근 답한 것 (5) ▸
```

- 뷰: `view:inbox`(04 §3.3 `InboxView`). 순서는 데몬 정렬 그대로(11 §3.5.4). 권리 게이트와 막는 질문은 접지 않는다(04 A5).
- 거르기는 칩 대신 머리의 선택 메뉴(모두 / 선택 필요 / 확인 / 기타) 하나다.
- 휴대폰에서 답할 수 없는 형식(§3.5.4 표)의 행은 "데스크톱에서 답하기"와 [미루기]만 보인다. 미루기 기본값은 "다음 데스크톱 접속까지"(03 §3.12 원칙 3) — 11 `question.defer`의 `until`에 경계 `user_return` + 조건 "clientKind desktop"을 넣을 수 있는지 11에 요구하고, 안 되면 "다음 작업 경계까지"를 기본으로 쓴다(MQ-11).
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
  초안을 외부 리뷰어(김OO)에게 보내도 될까요
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
│ 전체 초안 보내기                      │
├──────────────────────────────────────┤
│ 보내지 않기                           │
└──────────────────────────────────────┘
그 밖에 ▾   (아래 시트: 범위 줄여 진행 · 기준 고치기 · 질문 다시 쓰기 · 먼저 알아보기 · 미루기 · 이의)
```

- 뷰: `view:question`(04 §3.4 `QuestionView`). 필드와 깊이별 펼침은 04 §3.4 표를 그대로 쓰되, 휴대폰에서는 "일반" 깊이 기준으로 펼치고 "깊은 검토" 질문에는 머리에 "데스크톱에서 보기 권장"을 붙인다(03 §3.12). 답할 수는 있다.
- 주 버튼은 최대 3개, 세로로 쌓는다. 문구는 `OptionView.actionLabel`. "그 밖에"는 아래 시트(`BottomSheet`)로 연다. 시트에도 A15 필수 선택지가 모두 있다(05 §3.1.5, 11 §3.2.3). 휴대폰에서 할 수 없는 선택지는 빼지 않고 "데스크톱에서" 표시와 함께 비활성으로 보인다.
- 답한 뒤: `ChoiceImpactEcho`로 영향 표시(04 §3.4) → [질문함으로].

질문 형식별 휴대폰 동작 [제안, MOB-D08]:

| 형식(11 §3.2.3) | 휴대폰에서 할 수 있는 응답 | 휴대폰에서 비활성("데스크톱에서") | 03 §3.12와 다른 점 |
|---|---|---|---|
| `answer` | `answer`(값·글), `accept_recommendation`, `accept_assumption`(정보·비막힘), `modify_criteria`, `reframe_question`, `experiment_first`, `delegate`(정보 게이트), `narrow_scope`, 미루기 | 없음 | 같음 |
| `confirm_candidate` | `confirm`(고쳐서 확정 포함, 글 입력), `reject`, `accept_assumption`, `modify_criteria`, `reframe_question`, 미루기. 작업 합의 확인은 "이 범위로 맡기기 / 넓어진 부분 빼고 맡기기 / 맡기지 않기" | 없음 | 같음 |
| `approve_action` | `approve`, `deny`, `narrow_scope`(글로 지시), 미루기 | `approve_edited`(인자 편집) | 같음 |
| `result_review` | `accept`(반영 방침 고르기 포함), `request_changes`(기준 고르기 + 글), 미루기 | `accept_with_conditions`, `reject`, `criteria_wrong` | 같음(J-37) |
| `choose_one` | 고르기(추천 먼저, 나머지 "+n" 펼침), 고쳐서 정하기(글), `modify_criteria`, `reframe_question`, `experiment_first`, `delegate`, `narrow_scope`, 미루기 | 없음 | **다름.** 03은 데스크톱 전용으로 두었다. 선택지 목록을 세로로 읽고 하나를 누르는 일은 작은 화면에서도 정확히 할 수 있다. 원함 탐구에서는 이 형식 자체가 금지(11 V-Q-03)라 요소 반응과 섞일 일이 없다 |
| `reaction` | 미루기 | 반응 전체 | 같음 |
| 복구 판단(`recovery`, 형식은 11) | 화면 04 §3.20의 행동 전부(다시 실행, 그대로 두기, 확인 작업 만들기, 결과 기록) | "Concern에서 다시 계획"(데스크톱 화면이 필요) | 같음 |

- 묶음 답하기: 묶음으로 열면 질문을 차례로 쌓아 보이고, 질문마다 응답을 고른 뒤 맨 아래 "고른 대로 보내기" 하나(04 §3.4, D1). 휴대폰에서 답할 수 없는 질문은 묶음에서 "데스크톱에서"로 남는다.
- 글 입력: 입력 칸의 글자 크기는 16px 이상으로 둔다(iOS Safari가 작은 입력 칸에 초점을 주면 화면을 확대한다 [지식]). 한국어 조합 중 Enter는 보내지 않는다(05 §3.9, 21 UI-D15). 보내기는 단추로만 한다.

#### 3.5.5 `SCR-M-BRIEF` 요약

```text
요약 · 어제 23:10 이후 (10시간)
─────────────────────────────────────────
Goal과 바뀐 기준
  Goal 2: 완료 기준에 "도입부는 장면으로" 임시 적용 중
지금 선택이 필요함 (1)       [질문 15 카드(접힘)]
확인하면 좋은 것 (2)         [질문 14][질문 16]
진행 중 (1)
  WorkUnit 31 본문 1절 초안 · 다음: 제출 후 멈춤
그대로 두면
  09:40쯤 1절 초안이 제출되고 결과 확인을 기다립니다
Concern별 바뀐 것
  Concern 12  방향 2 · 이해 3 · 실제 3              ›(데스크톱에서)
에이전트가 정한 것 4                                 ›
─────────────────────────────────────────
[여기까지 봤음]
```

- 뷰: `view:brief`(04 §3.2). 03 §3.12의 요약판 범위(1·4·5·6·7절 + 2·3절은 Concern별 한 줄)를 따른다. 3·7절(모델 평가)이 늦게 오면 "평가를 만드는 중"을 보인다(04 §3.2).
- "여기까지 봤음" → `brief.acknowledge`(D0, 보기). 뒤이은 한 줄 입력은 휴대폰에서도 둔다(선택).
- 읽는 동안 내용을 바꾸지 않는다(04 §3.2 "낡음" 행, 19 `untrackView`).

#### 3.5.6 `SCR-M-AUTO` 에이전트가 정한 것

```text
에이전트가 정한 것 · 마지막 확인 이후
─────────────────────────────────────────
▾ 루프 전환 (2)
  선택 41 · Concern 12 · 어제 23:30
  탐침 → 구조: 나누기
  묻지 않은 이유: 정보 게이트, 결과에 실질적 차이 없음
                                    [봤음]  [이의]
▸ 상황 판정 (1)    ▸ 일반 선택 (1)
처리 중인 이의 (1)
[모두 봤음]
```

- 뷰: `view:autonomous`(04 §3.5). [이의]는 아래 시트로 `OVL-CONTEST`(04 §3.26)의 같은 내용을 보인다: 이유(선택), "이유는 모르겠지만 맞지 않습니다", 원하는 처리(다시 열기 기본 / 다음부터 묻기 / 기록만), 영향 미리보기, [이의 걸기]. 명령은 `contest.file`(19, 이벤트 09 `objection.filed`, 판정 J-30). 사람 조작: 이유 없이 D1, 이유 입력 D1 + I1(J-20).

#### 3.5.7 `SCR-M-WORK` 진행 중

- 뷰: 홈 뷰의 진행 작업 구역(04 §3.1) 또는 `tray` 뷰. 진행 작업 카드의 한눈 깊이(04 §3.0.7: 머리, 지금 하는 일, 다음 단계, 맡긴 범위 한 줄, 마지막 중요한 변화)만 보인다.
- 동작: "안전하게 멈추기"(05 §3.6.1)만 둔다. 확인 시트 "WorkUnit 31을 지금 단계가 끝나면 멈춥니다" → [멈추기]. 방향 바꾸기·범위 좁히기·즉시 끊기는 데스크톱에서.
- 낡음일 때 "지금 하는 일"은 "14:02에 하던 일"로 바뀐다(04 §3.0.4 규칙 2).

#### 3.5.8 `SCR-M-CONNECT` 연결

```text
연결
─────────────────────────────────────────
● 연결됨 · server.tail7ad0b4.ts.net:8448
  마지막 이벤트 14:02 · 서버 Helm 0.4.0
이 기기   기기 9 iPhone · 알림 켜짐(내용 숨김)
─────────────────────────────────────────
연결 점검 [점검 실행]
  1 이름 찾기 ✓  2 서버 경로 ✓  3 Helm 서버 응답 ✓  4 인증 ✓  5 버전 ✓
─────────────────────────────────────────
기기
  기기 7 MacBook        마지막 사용 지금          [폐기]
  기기 9 iPhone (이 기기)                         [이 기기 폐기]
```

- 04 §3.19의 일부. 연결 방식 고르기, SSH, 새 기기 페어링은 없다. 다른 기기 폐기는 된다(`devicesLimited`).
- 연결 점검 5단계와 문구는 04 §3.19와 같다. 1단계 실패 문구에 "Tailscale 앱에서 연결을 켜세요"를 쓴다.

#### 3.5.9 `SCR-M-SETTINGS` 설정

| 항목 | 값 | 저장 위치 |
|---|---|---|
| 알림 받기 | 켬/끔. 켜면 권한 요청과 구독(§3.3.4 6단계) | 기기(권한) + 데몬(`device.registerPush`) |
| 알림에 내용 보이기 | 끔(기본) / 켬 → `contentLevel` | 데몬 등록(서비스 워커도 IndexedDB 사본을 읽음) |
| 알릴 것 | "멈춰 있는 것만"(기본, `minUrgency: interrupt`) / "알림 강도까지"(`notice`) | 데몬 등록 |
| 알림 시험 보내기 | 단추 → `device.testPush` | - |
| 방해 금지 | 데몬 설정(05 §3.7.4, 기기 공통). 같은 값을 보이고 바꾼다(`settings.update`) | 데몬 |
| 표시 | 테마(시스템/밝게/어둡게), 글자 크기, 투명 효과(기본 줄임, §3.5.11) | 기기 |
| 이 기기의 사본 지우기 | 뷰 캐시·초안 지우기 | 기기 |
| 정보 | 앱 판(= 데몬 릴리스), 프로토콜 판, 열린 소스 고지 링크 | - |

#### 3.5.10 `SCR-M-ONBOARD` 처음 연결 (03에 새 화면 ID 요구)

- 단계: (1) 설치 안내(브라우저 탭으로 열렸을 때만): 공유 단추 → "홈 화면에 추가" 그림 안내, iOS 판이 16.4 미만이면 "이 iOS 판에서는 알림을 받을 수 없습니다" 안내. (2) 연결: 코드 입력, 기기 이름, [연결]. (3) 알림 켜기: [알림 켜기] / [나중에]. (4) Tailscale 권장 설정 한 줄 안내(VPN On Demand).
- 03 §3.6 표에 `SCR-M-ONBOARD`(처음 연결, 앱, 데스크톱 대응 `SCR-ONBOARD`)를 더해 달라고 요구한다.

#### 3.5.11 공통 상태와 결정 버튼 활성 조건 [04 §3.0.4·20 §3.8.9와 같은 규칙]

| 상태 | 휴대폰 표시 | 결정 동작 |
|---|---|---|
| 연결됨, 느림, 안전 모드 | 머리 점 + 글자 | 가능 |
| 다시 연결하는 중(숨김에서 돌아옴 포함), 다시 맞추는 중 | 머리 "연결하는 중", 띠 "14:02 기준" | 막음, 초안 보존 |
| 연결 안 됨(Tailscale 꺼짐 포함), 데몬 응답 없음 | 띠 + "연결 화면 열기" | 막음 |
| 인증 실패(폐기·만료·쿠키 없음) | "이 기기의 연결 권한이 없거나 폐기되었습니다. 다시 페어링하세요." → `SCR-M-ONBOARD` | 막음 |
| 버전 불일치 | 서비스 워커가 옛 묶음을 들고 있는 경우뿐이다. "새 판을 받는 중입니다" 뒤 자동 새로고침(§3.6.4) | 막음 |
| 복구 모드, 서버 종료 중 | 04 §3.0.4 문구 | 막음 |
| 뷰 낡음(서버 `freshness` ≠ `current`) | 화면 머리 띠 | 그 화면만 막음 |

결정 버튼 활성 조건(질문 화면과 이의·멈추기 시트 공통):

```ts
// @helm/client-react의 decisionsAllowed(20 §3.8.9)에 모바일 조건을 더한 것. apps/mobile/src/screens/decide.ts
export function mobileDecisionAllowed(i: {
  conn: UserConnState; serverFreshness: Freshness;              // 20 decisionsAllowed 입력
  questionStatus?: "pending" | "delivered" | "answered" | "assumed" | "withdrawn" | "expired";
  form?: QuestionForm; option?: ResponseOptionId | AcceptanceDecision;
  sending: boolean; visible: boolean;
}): { allowed: boolean; reasonKey?: string } {
  if (!decisionsAllowed(i.conn, { serverFreshness: i.serverFreshness })) return { allowed: false, reasonKey: "notice.decide.offline" };
  if (!i.visible) return { allowed: false };                                      // 숨김 직전 누름 방지
  if (i.sending) return { allowed: false };                                       // 04 §3.0.6 규칙 2
  if (i.questionStatus && !["pending", "delivered"].includes(i.questionStatus)) return { allowed: false, reasonKey: "notice.question.resolved" };
  if (i.form && i.option && !mobileSupports(i.form, i.option)) return { allowed: false, reasonKey: "notice.mobile.desktopOnly" };   // §3.5.4 표
  return { allowed: true };
}
```

- 규칙 근거: 04 §3.0.4 규칙 3(서버 신선도와 연결로만 막는다. 무효화 뒤 다시 받기 사이의 짧은 낡음으로는 막지 않는다), 05 §3.1.9 카드 상태 기계, 20 §3.8.9. 휴대폰만의 조건은 `visible`과 `mobileSupports` 둘이다.
- 막힌 버튼에는 이유를 붙인다(04 §3.0.4 규칙 4). `notice.mobile.desktopOnly` = "데스크톱에서 할 수 있습니다." (05에 키 요구)

#### 3.5.12 21과 나눠 쓰는 범위 [제안, 21 §3.13에 대한 답]

| 21 항목 | 모바일 |
|---|---|
| `@helm/ui-tokens` | 그대로 쓴다. 밀도 `data-density="touch"`(컨트롤 44px). 입력 칸 글자 16px 이상(§3.5.4) |
| 유리 재질(U-22) | 모바일 기본값은 `data-transparency="reduced"`(불투명 표면)로 둔다. 휴대폰 GPU 비용과 밝은 실외에서의 가독성 때문이다. 설정에서 켤 수 있다. 읽고 판단하는 영역은 켜도 불투명에 가깝게(05 §3.9) |
| `@helm/ui` 부품 | `QuestionCard`, `QuestionInbox`, `ChoiceImpactEcho`, `AutonomousChoiceList`, `SinceLastVisit`(요약판 변형 `variant="compact"`), `FreshnessIndicator`, `ConnectionIndicator`, 상태 배지, `ContestButton`. 새로 필요한 L0 부품 `BottomSheet`(그 밖에 메뉴·이의·확인 시트)는 플랫폼 중립이므로 `@helm/ui`에 둔다(21에 요구) |
| 모바일 전용 셸 | `MobileShell`, `MobileHeader`, `MobileTabBar`, `InstallGuide`, `PairCodeInput`, `CoverOnHide`는 `apps/mobile/src/shell`에 둔다 |
| 호버 | 쓰지 않는다(21 §3.13 규칙 2가 이미 보장) |
| 키 지도 | 비어 있다(21 §3.13 규칙 4) |

### 3.6 빌드·배포

#### 3.6.1 빌드 위치와 릴리스 [제안, MOB-D10]

- 빌드는 서버(WSL)에서 한다. `pnpm --filter @helm/mobile build` → `apps/mobile/dist/`(해시 이름 묶음, `sw.js`, `manifest.webmanifest`, 아이콘). Mac이 필요 없다.
- 데몬 릴리스 만들기(17 §3.10)가 `apps/mobile/dist/`를 릴리스 폴더의 `web/mobile/`로 복사한다. 업그레이드·되돌리기(17)를 따라 휴대폰 화면도 같이 바뀌고 같이 돌아간다.
- 묶음 크기 목표: 첫 내려받기 gzip 400 KiB 이하(질문함·질문 화면 기준). 서비스 워커 캐시는 판마다 하나다.

#### 3.6.2 just 레시피 [제안, 06 §3.16 표에 더함]

| 레시피 | 하는 일 | `verify`에 넣는가 |
|---|---|---|
| `mobile-dev` | Vite 개발 서버(127.0.0.1:5174) + 가짜 데몬(20 §3.13.3과 같은 것). 데스크톱 브라우저의 휴대폰 뷰포트로 본다 | 아니요 |
| `mobile-build` | PWA 묶음 빌드. `build`가 부른다 | 아니요(`build`) |
| `mobile-check` | 타입 검사·lint·단위·컴포넌트 시험(`apps/mobile`, 서비스 워커 문구 생성 포함). 워크스페이스 `check`·`test`에 이미 포함되면 별도 레시피는 이름만 둔다 | 예(워크스페이스 단계로) |
| `mobile-e2e` | Playwright WebKit(iPhone 15 뷰포트) + 가짜 데몬: 페어링, 질문 답하기, 숨김·복귀, 초안, 낡음 | 아니요(20의 `app-e2e`와 같은 취급) |
| `mobile-shot` | Playwright WebKit으로 `SCR-M-*` 화면 캡처, 디자인과 비교(`just shot`이 부름) | 아니요 |
| `mobile-vapid-keygen` | VAPID 키 쌍을 한 번 만들어 보인다(§3.4.7) | 아니요 |
| `mobile-push-test` | `helm push test --device <dv_id>`: 정식 데몬에서 시험 푸시 하나 | 아니요 |
| `mobile-sim` (선택) | `run-on mac`으로 iOS 시뮬레이터 Safari에서 `/m/`를 연다(화면 확인용). Mac이 잠들어 있으면 종료 코드 2 | 아니요 |

#### 3.6.3 설치 절차 (사람, 한 번) [제안]

1. 서버: `secrets edit prod`에 `HELM_VAPID_PRIVATE_KEY`를 넣는다(`just mobile-vapid-keygen` 출력). 데몬을 다시 시작한다.
2. 서버: 홈랩 H-1(`serve.table`의 8448 줄)이 반영되어 있는지 확인한다(판정 §5). 모바일은 새 홈랩 변경을 요구하지 않는다.
3. 데스크톱 `SCR-CONNECT` → 새 기기 페어링 → 휴대폰 → QR과 코드.
4. iPhone: Tailscale 켜기 → QR 읽기 → Safari → 공유 → 홈 화면에 추가 → 홈 화면에서 Helm 열기 → 코드 입력 → [연결] → [알림 켜기] → [시험 알림 보내기].
5. iPhone: Tailscale 앱에서 VPN On Demand 설정(권장).

#### 3.6.4 갱신 [제안]

- 서비스 워커는 `vite-plugin-pwa`의 `injectManifest`로 만든다(X-15). 등록 방식은 "새 서비스 워커가 기다렸다가 다음 실행 때 적용"이다. 쓰는 도중 화면이 바뀌지 않게 한다.
- 앱이 보이게 될 때마다 `registration.update()`를 부른다. 새 판이 대기 중이고 연결이 끊긴 상태(숨김 직후 다시 연결하기 전)이면 그때 적용하고 새로고침한다. 초안은 IndexedDB에 있으므로 잃지 않는다.
- 데몬이 업그레이드되어 `hello`가 `protocol.unsupported`로 끝나면(옛 서비스 워커 묶음) 곧바로 갱신을 적용한다. 정상이면 이 경우는 잠깐만 생긴다(데몬이 직전 판 프로토콜도 받는다, 19 P-14).
- 매니페스트의 `id`는 `/m/`로 고정한다. 바꾸면 iOS가 다른 앱으로 본다 [원문 X-4 "manifest id"].

### 3.7 대표 시퀀스

#### 3.7.1 UC-04 대안 M: 밤사이 권리 게이트를 휴대폰에서 허락

```text
 1 런타임: question.recorded(Q-B, rights, blocking) → 커널 D-1 immediate → notify 지시
 2 전달기: 연결된 기기 없음, presence away, pushReachable=[dv_iphone] → urgencyOf = interrupt
          planPush → dv_iphone delay 0 → question.delivered{channel:"push", targetDevices:[dv_iphone]}
 3 daemon/push: device_push 행 읽기 → payload(§3.4.4, contentLevel hidden) 암호화 → POST web.push.apple.com (VAPID)
          201 → push.sent{outcome:"accepted"}
 4 iPhone: 서비스 워커 push → "Helm · 확인할 일이 1건 있습니다." 잠금 화면에
 5 사람: 알림 누름 → Face ID → 웹 앱 /m/q/qs_B (캐시 카드, "연결하는 중")
 6 앱: client.start → WSS 업그레이드(Cookie __Host-helm_dt, Origin) → hello(deviceId) → ready
          → presence.report{active, SCR-M-QUESTION, qs_B} → 데몬: user_return 경계(11 §3.8.1)
          → view.get question → 버튼 활성
 7 사람: [작업 브랜치 vite-migration을 원격에 push하기] (D1)
 8 앱: question.answer{questionId, option approve, basisSeq, idempotencyKey}
          → question.answered(via {device dv_iphone, listener tailscale}) → 영향 표시
 9 데스크톱(나중에 열림): 재전송으로 question.answered 받음 → 질문함에서 "다른 기기에서 답함"
```

#### 3.7.2 보내는 중에 화면을 끔

```text
 1 사람: [넣기] → question.answer 전송(putPending 완료) → visibilitychange hidden
 2 앱: hiding, 응답 대기 1 → 2초 기다림 → 응답 없음 → client.stop()(1000)
 3 (데몬은 명령을 커밋했을 수도, 못 받았을 수도 있다)
 4 사람: 10분 뒤 다시 엶 → visible → retryNow → hello → syncing: 진행 중 명령함의 같은 idempotencyKey로 다시 보냄
 5 데몬: 커밋했으면 멱등 결과 그대로(19 §3.9.2), 못 받았으면 지금 처리. basisSeq 이후 상태가 바뀌었으면 3004 → 04 §3.0.5
```

#### 3.7.3 다른 기기를 쓰는 중

```text
 1 Mac 앱이 연결되어 있고 presence active → 질문 Q 즉시 전달 → planPush: active 기기 있음 → 푸시 없음. Mac이 OS 알림
 2 Mac presence idle(자리 비움 5분) → 질문 R 즉시 전달 → planPush: live 있음 → dv_iphone delay 60s, 타이머 push_followup
 3 60초 안에 Mac에서 R을 열면(presence.report objectId=R) 타이머가 울릴 때 버림. 안 열면 푸시
```

## 4. 실패·예외·경계 사례

| ID | 사례 | 처리 [제안] |
|---|---|---|
| MF-01 | 휴대폰 Tailscale이 꺼져 있음 | 이름 찾기 실패 → "연결 안 됨", 캐시 읽기 전용. 연결 점검 1단계 문구. 푸시는 계속 받는다 |
| MF-02 | 알림을 눌렀는데 데몬이 꺼져 있음 | 캐시 카드를 보이고 "Helm 서버가 응답하지 않습니다"(04 §3.0.4). 결정 막음, 초안 보존 |
| MF-03 | 알림을 눌렀는데 그 질문이 이미 답해짐·가정 확정·철회 | 04 §3.0.5 문장. 앱이 보이게 될 때 그런 알림을 닫는다(§3.4.9) |
| MF-04 | 사용자가 iOS 설정에서 Helm 알림을 끔 | 다음 실행 때 `Notification.permission == "denied"` → `device.unregisterPush(permission_lost)`. 설정 화면에 "iOS 설정 > 알림에서 Helm을 켜세요". 데몬은 그 기기를 `pushReachable`에서 뺀다 |
| MF-05 | 푸시 서비스가 410·404 | 등록 삭제, `device.push_unregistered(gone)`. 다음 실행 때 다시 구독 |
| MF-06 | 푸시 서비스 장애(5xx, 시간 초과) | §3.4.7 재시도 3회, TTL 안. 실패는 `push.sent(failed)`. 질문은 질문함·복귀 요약에 그대로 있다 |
| MF-07 | 클라이언트가 내부 주소를 엔드포인트로 등록하려 함 | `push.endpoint_not_allowed` 거부(§3.4.6 검증 1). 감사 기록 |
| MF-08 | 브라우저 탭(설치 전)에서 페어링하려 함 | 연결 단계를 보이지 않는다(§3.3.4). 설치 안내만 |
| MF-09 | iOS가 웹 앱 저장소를 지움(쿠키 포함) | `whoami` 401 → `SCR-M-ONBOARD`. 서버 쪽 기기는 남아 있으므로 데스크톱에서 옛 기기를 폐기하고 새로 페어링한다. 푸시 구독도 사라졌으면 데몬은 410을 받아 정리한다 |
| MF-10 | 쿠키는 남았는데 `localStorage`의 `deviceId`만 지워짐 | `whoami`로 복구(§3.3.3) |
| MF-11 | 데몬 공개 호스트가 바뀜(tailnet 이름 변경) | 출처가 바뀌어 쿠키·서비스 워커·홈 화면 앱이 모두 새 출처가 된다. 새로 설치·페어링한다. 옛 기기는 데스크톱에서 폐기 |
| MF-12 | VAPID 키 교체 | §3.4.7. 모든 등록 정리, 다음 실행 때 다시 구독. 그 사이 푸시 없음 |
| MF-13 | 같은 질문을 휴대폰과 데스크톱에서 동시에 답함 | 먼저 받아들여진 답. 늦은 쪽 "이미 처리됨"(04 §4) |
| MF-14 | 보내는 중에 화면을 끔 | §3.7.2 |
| MF-15 | 앱이 오래 숨겨져 위치가 보존 범위 밖 | `2001` → 스냅숏 경로(19 §3.5.5). 뷰 다시 받기 |
| MF-16 | iPhone과 iPad 둘 다 푸시 등록 | 둘 다 받는다(같은 `tag`). 한쪽에서 답하면 다른 쪽 알림은 그 기기가 열릴 때 닫힌다 |
| MF-17 | 방해 금지 중 권리 게이트 | 푸시 없음. 끝날 때 묶음 푸시 1개(§3.4.3) |
| MF-18 | 같은 질문이 만료 임박으로 승격 | 두 번째 푸시(같은 `tag`, 앞 알림을 바꿈). 세 번째는 없다 |
| MF-19 | 한 시간에 즉시 전달이 많음 | interrupt는 상한 밖(05 §3.7.3). `notice`까지 켠 경우만 시간당 6개 상한, 넘으면 그 시간 끝에 묶음 1개 |
| MF-20 | 서비스 워커가 payload를 해석하지 못함 | 중립 알림("Helm · 확인할 일이 있습니다.")을 띄운다. iOS 18.4 이상은 선언된 알림이 대신 뜬다 |
| MF-21 | 다른 Helm 서버의 푸시(서버 id 불일치) | 중립 알림만, 누르면 `/m/`. 1인 1서버라 정상 경로에서는 생기지 않는다 |
| MF-22 | 버전 불일치(옛 서비스 워커 묶음) | §3.6.4 즉시 갱신 |
| MF-23 | iOS 16.4 미만 | 설치 안내에 "알림을 받을 수 없습니다". 앱은 연결해 쓸 수 있다 |
| MF-24 | 저전력 모드·집중 모드 | iOS가 알림 표시를 늦추거나 숨긴다(X-4 집중 모드). Helm은 바꾸지 않는다. 질문은 질문함에 남는다 |
| MF-25 | 휴대폰을 잃음 | §3.3.8 분실 대응 |
| MF-26 | 쿠키가 실린 요청이 다른 출처에서 옴 | `SameSite=Strict`로 브라우저가 싣지 않는다. 실려도 Origin 불일치 403 |
| MF-27 | 모델 문장에 스크립트·링크 위조 | 글자로만 그린다(21). CSP가 인라인 스크립트를 막는다. 18 T18-32 |
| MF-28 | 화면이 낡은 채로 결정 버튼 누름 | 막힘(§3.5.11). 경합이면 데몬 3004 → 04 §3.0.5 |
| MF-29 | 페어링 코드 오타 5회 | 코드 무효(18 §3.7.4). 데스크톱에서 새 코드 |
| MF-30 | `tailscale serve`가 쿠키를 넘기지 않음(AS-M2 틀림) | M-03에서 발견. MQ-04의 대체 방식으로 바꾼다 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 모바일 구현 방식(PWA)과 경로 B 전환 조건(§3.1) | 01, 06, 20, 23, 24 |
| 휴대폰에서 하는 일·하지 않는 일(§1.2, §1.3), 질문 형식별 휴대폰 동작(§3.5.4) | 01, 02, 03, 04 |
| 모바일 화면 레이아웃·경로·상태·결정 버튼 조건(§3.5) | 03, 04, 21, 22 |
| 쿠키 인증, 정적 서빙, 페어링 HTTP(§3.3.2~§3.3.4) | 17, 18, 19 |
| 수명주기와 presence 규칙, `locked` 결론(§3.3.5, §3.3.7) | 09, 11, 19, 20, 판정 J-28 |
| 푸시 보내는 조건, payload, 등록 형식, 운영 테이블, 이벤트, 메서드(§3.4) | 05, 08, 09, 10, 11, 16, 18, 19 |
| 빌드·릴리스·레시피(§3.6) | 06, 17, 23 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01 | (1) 모바일 구현 방식을 "데몬이 서빙하는 PWA + Web Push"(26 MOB-D01·D02)로 적고, OQ-10 해소 문장을 고친다. (2) NFR에 모바일 항목 추가: 알림 누름 → 결정 버튼 활성 p95 3초(Tailscale 연결 중)/6초(새로 연결), 질문 기록 → 푸시 표시 p95 10초(측정만, 푸시 서비스 시간 포함). (3) NS-06의 "26이 정하는 범위"를 §1.3 표로 |
| 02 | (1) UC-04 대안 M을 §3.7.1 단계로 바꾸고 조작 수(보기 1 + D1)를 적는다. AC-04-09 세부 기준: 휴대폰 답의 이벤트는 `via.deviceId`·`listener`만 다르고, 휴대폰에서 비활성인 응답(§3.5.4)은 명령을 보내지 않는다. (2) UC-11에 휴대폰 페어링 대안(§3.3.4). (3) UC-17 A0에 "다른 기기 활동 중이면 푸시를 늦춤"(§3.7.3). (4) AC-04-01의 "즉시면 '지금 답이 필요함'"은 내용 숨김 기본(J-03)에서 "확인할 일이 n건 있습니다"로 맞춘다 |
| 03 | (1) §3.12 질문 형식 표에서 `choose_one`을 "답함"으로 바꾼다(MOB-D08, 이유 §3.5.4). (2) 화면 ID `SCR-M-ONBOARD`(처음 연결) 추가. (3) §3.4.2의 "휴대폰 화면은 범위 밖" 문장을 §3.12 참조로. (4) 모바일 경로 `/m/…`(§3.5.2)를 §3.5.5 옆에 적거나 26을 참조. (5) "다음 데스크톱 접속까지" 미루기를 11이 표현하지 못하면 기본값을 "다음 작업 경계까지"로(MQ-11) |
| 04 | (1) `SCR-CONNECT` 새 기기 페어링에 "휴대폰" 선택지: 설치 주소 QR + 코드(§3.3.4). (2) `SCR-SETTINGS` 알림 절에 "휴대폰 알림은 휴대폰 설정에서" 한 줄. (3) 기기 목록에 푸시 상태 칸(켜짐·실패 중·다시 등록 필요) |
| 05 | (1) §3.7.7의 "앱이 꺼져 있으면 알림이 없다. 데몬은 휴대폰 푸시 같은 별도 채널을 갖지 않는다"를 2단계 기준으로 고친다(26 §3.4). (2) 문구 키 추가: `notif.push.test.*`("알림 시험입니다."), `notif.push.bundle.*`("확인할 일 {n}건"), `notice.mobile.desktopOnly`("데스크톱에서 할 수 있습니다."), `notice.mobile.install.*`(설치 안내), `err.push.permissionDenied`, `err.push.unsupportedIos`, `notice.mobile.reconnecting`. (3) `notif.hidden.title`·`notif.hidden.body`의 값을 26 `PUSH_FALLBACK_*`과 맞춘다("Helm", "확인할 일이 있습니다." / 개수가 있을 때 "확인할 일이 {n}건 있습니다.") |
| 06 | (1) `apps/mobile` 이름을 `@helm/mobile`로 확정하고 의존 허용 표에 `protocol`, `client`, `client-react`, `ui`, `ui-tokens`, `ui-language`, `domain`(타입) 행을 둔다. (2) `daemon`의 새 외부 의존 `web-push`(정확한 판 고정)와 소유 규칙(R6에 `web-push`는 `daemon/push`만). (3) 06 §3.4.13 "(삭제) `@helm/client`"가 판정 §2와 어긋난다(같은 문서 §3.3은 추가로 적음). 정리 필요. (4) justfile 표에 §3.6.2 레시피. (5) 릴리스 폴더에 `web/mobile/`(17과 함께). (6) `.env.example`에 `HELM_VAPID_PRIVATE_KEY=` |
| 08 | (1) Device `push`를 §3.4.6 `PushRegistration`으로 바꾼다. (2) Device에 `credentialCarrier: "header" \| "cookie"`. (3) `platform`의 `web` 값은 쓰지 않는다(PWA도 `ios`). 필요 없으면 뺀다 |
| 09 | (1) 이벤트 `device.push_registered`, `device.push_unregistered`, `push.sent`(이름은 09가 확정) 추가와 `EVENT_META.sensitiveFields`(없음: 원문은 이벤트에 없다). (2) 운영 테이블 `device_push`(§3.4.6), 런타임 타이머 목적 `push_followup`, `push_dnd_digest`. (3) `question.delivered.channel`의 `push` 사용 규칙(§3.4.3). (4) `PresenceState`의 `locked`를 예약 값으로 표시하거나 뺀다(§3.3.7). (5) 11과 09의 presence 기록 방식 차이(09 영속 `presence.changed` 대 11 ADR-A7 "이벤트가 아님")는 26과 무관하지만 아직 남아 있다 |
| 10 | 통치 명령 `device.register_push`, `device.unregister_push`, `device.test_push`(19 메서드의 snake_case). 검증 규칙은 26 §3.4.6(허용 호스트, 키 길이, VAPID 키 일치, 자기 기기만). 거부 코드 `push.endpoint_not_allowed`, `push.vapid_key_mismatch`(내용 갈래) |
| 11 | (1) `PresenceSnapshot.pushReachable`과 `urgencyOf` 첫 줄 수정(§3.4.3). (2) §3.5.3 전달 기록 1번의 channel 규칙(`app`/`push`/`brief`)과 전달기가 `planPush`를 부르는 지점. (3) `push_followup` 타이머가 울릴 때 "열람 또는 답이 있으면 버림" 판정에 쓸 열람 기록(11은 `question.seen`을 운영 기록으로 둔다). (4) §3.8.2 "알림" 행의 "휴대폰 푸시는 범위 밖" 문장과 A-4 미결을 26으로 해소. (5) `question.defer.until`에 "다음 데스크톱 접속"(경계 `user_return` + `clientKind` 조건)을 표현할 수 있는지(MQ-11). (6) Q-E20의 `locked` 언급을 26 §3.3.7에 맞춘다 |
| 16 | (1) 푸시 지표: 질문별 `push.sent` → 열람·답까지 시간, 푸시 실패율(경로 B 전환 조건 §3.1.5 1번), 재페어링 횟수(2번). (2) `SCR-M-*` 열람을 데스크톱 대응 화면과 같은 종류로 센다 |
| 17 | (1) 릴리스에 `web/mobile/` 포함과 업그레이드·되돌리기(§3.6.1). (2) `helm pair --mobile [--qr]`: 설치 주소 QR + 코드. (3) `helm push test --device`. (4) 점검 ID `push_no_vapid_key`, `push_failing`(최근 24시간 실패율 20% 초과). (5) 설정 키 `push.enabled`(기본 true), `push.webpush.subject`, `push.webpush.allowedEndpointHosts`, `push.followupDelayMs`(60000), `push.hourlyCap`(6), `mobile.origin`(기본 `https://<publicHost>`). (6) 정적 경로가 `tailnet` 리스너에서만 열리는지 시험 |
| 18 | (1) §3.18.2 4번을 26 §3.3.3 쿠키 방식으로 확정: `__Host-helm_dt`, Origin 검사, `credentialCarrier`, `preflightMobileCookie`. 18 §3.4.3 `preflight`의 "Authorization 없으면 401"에 쿠키 갈래를 더한다. `allowedOrigins`에 모바일 출처. (2) §3.18.2 3번(키체인)은 경로 B에만 해당한다고 적는다. (3) §3.18.2 6번(앱 잠금 기본 켬)과 7번(서명 증명 권장)에 26의 판단(1차 끔, MQ-03·MQ-05)을 반영하거나 이의를 낸다. (4) Q18-09를 Web Push로 해소. 홈랩 ntfy 근거(`NTFY_URL`)는 설정되지 않은 훅임을 적는다(§2.2). (5) 바깥 연결 허용 목록에 푸시 서비스 호스트(§3.4.6). (6) 엔드포인트 등록으로 데몬이 내부 주소에 요청하는 위협(T-M5 종류)과 대응(허용 목록)을 위협 표에. (7) 보안 시험 추가: T26-07~T26-10 |
| 19 | (1) §3.17을 26으로 확정: 토큰 전달은 쿠키(`helm-bearer.` 하위 프로토콜은 MQ-04 대체 방식으로만 남김), `@helm/client/browser`에 쿠키 방식(자격 인자 없음). (2) `device.registerPush` params(`channel: "webpush"`, `address`, `keys`, `contentLevel`, `minUrgency`, `vapidKeyId`), 새 메서드 `device.pushConfig`(read), `device.testPush`(cmd), `DeviceInfo.push` 모양(§3.4.6). (3) 푸시 payload는 §3.4.4 `HelmPushMessage`(19 §3.17의 `{v, serverId, deliveryId, category, count, target}`에 문구 키·배지·Declarative 필드를 더한 것). 형식 정의는 `@helm/protocol/src/push.ts`. (4) HTTP 경로 표(§3.2.5)에 `/m/*`, `/m/pair`, `/m/whoami`, `/m/logout`과 "정적 서빙 안 함"의 예외. (5) `PresenceState`의 `locked`(§3.3.7). (6) 19 §3.17 "철회 푸시를 보낼 수 있는 제공자면 보낸다"를 "보내지 않는다"로(§3.4.9). (7) `HelmClient`가 `stop()`(`closed`) 뒤 `start()`로 다시 시작할 수 있음을 상태 기계 표에 적는다(`closed → connecting`, 위치·진행 중 명령함 유지). 안 되면 모바일은 숨김마다 새 인스턴스를 만든다. (8) `devicesLimited` scope에 `device.pushConfig`(read는 `read`), `device.testPush`(자기 기기)를 넣는다 |
| 20 | (1) §3.14 `PlatformAdapter`에 선택 필드 `push?: { permission(): NotificationPermission; subscribe(vapidKey: string): Promise<PushSubscriptionJSON>; current(): Promise<PushSubscriptionJSON \| null>; unsubscribe(): Promise<void> }`와 `lifecycle?: { onHidden(cb): () => void; onVisible(cb): () => void }`. (2) 딥 링크 해석 표에 모바일 경로(§3.5.2) 대응. (3) §3.10.1 "별도 푸시 채널은 없다"를 2단계 기준으로. (4) `client-react`의 IndexedDB 이름을 앱별로 받게(`helm-desktop`, `helm-mobile`). (5) 데스크톱 `SCR-CONNECT`의 휴대폰 페어링 화면(04 요구 (1)) |
| 21 | (1) `BottomSheet`(L0)를 `@helm/ui`에 추가. (2) `SinceLastVisit`에 `variant="compact"`(요약판). (3) U-22 답: 모바일 기본 `data-transparency="reduced"`. (4) 터치 반응(§3.13 규칙 5)은 이번 모바일 범위에 없다. (5) 입력 칸 글자 16px 이상 규칙(touch 밀도). (6) 부품이 `style` 속성을 쓰는 곳 목록(CSP `style-src-attr` 판단, §3.3.2) |
| 22 | 시험 계층에 모바일 추가: 서비스 워커 문구 생성 단위 시험, 쿠키·Origin 통합 시험, Playwright WebKit 휴대폰 시나리오, 실기기 수동 체크리스트(§6.2). 가짜 푸시 서비스(로컬 HTTP 서버가 RFC 8030 요청을 받아 복호화해 검사) |
| 23 | 모바일 마일스톤(데스크톱 MVP 뒤): M-a 데몬 쪽(정적 서빙, 쿠키 인증, 푸시 송신·등록), M-b `apps/mobile` 화면, M-c 실기기 확인(§6.2). 선행 조건: `@helm/ui`·`@helm/client-react`가 데스크톱 MVP에서 별도 패키지로 나와 있을 것(20 Q-18, 21 §3.13) |
| 24 | ADR 후보 ADR-26-1~6(문서 끝) |
| 25 | 용어: "홈 화면 웹 앱", "푸시", "푸시 등록", "VAPID", "내용 숨김", "경로 B" |

## 6. 구현 단위와 완료 기준

### 6.1 모듈별

| 단위 | 위치 | 완료 기준(테스트로 확인할 조건) |
|---|---|---|
| 정적 서빙 | `packages/daemon/src/http/mobile-static.ts` | T26-01 `tailnet`에서 `/m/` 200, `loopback`·`local`에서 404. T26-02 표에 없는 경로·`..`·심볼릭 링크 탈출 404. T26-03 모든 응답에 §3.3.2 헤더(CSP의 `connect-src`가 설정 호스트). T26-04 해시 자산은 `immutable`, `sw.js`는 `no-cache` |
| 쿠키 인증 | `packages/daemon/src/http/mobile-auth.ts`, 18 `preflight` | T26-05 `/m/pair` 성공 시 `Set-Cookie`가 `__Host-`·`HttpOnly`·`Secure`·`SameSite=Strict`이고 본문에 토큰이 없다. T26-06 쿠키 + 올바른 Origin → `hello` 성공, `via.listener = "tailscale"`. T26-07 쿠키 + 다른 Origin → 403, 쿠키 + Origin 없음(업그레이드) → 403. T26-08 데스크톱 기기(`credentialCarrier: header`)의 토큰을 쿠키로 → 1008. T26-09 `loopback`에서 쿠키 → 무시되어 401. T26-10 폐기 뒤 쿠키 → 1005, `whoami` 401 |
| 푸시 등록 | `packages/daemon/src/push/store.ts`, 10 통치 명령 | T26-11 허용 밖 호스트·`http:`·IP 주소 엔드포인트 거부. 키 길이 틀림 거부. VAPID 키 불일치 거부. 같은 등록 두 번 → 이벤트 1개. `device_push` 원문이 이벤트·재전송·투영·진단 묶음·로그 어디에도 없다(DB 덤프와 로그 grep) |
| 푸시 payload | `packages/protocol/src/push.ts`, `apps/mobile/src/sw/notify.ts` | T26-12 `PUSH_FALLBACK_*`이 `@helm/ui-language`의 `notif.hidden.*`과 같다. T26-13 `contentLevel: hidden`이면 `args`에 `count` 말고 아무것도 없다(속성 시험: 무작위 질문에서 질문 문장·Goal 서술 문자열이 payload에 없다). T26-14 직렬화 3 KiB 이하, 넘으면 hidden으로 줄인다 |
| 보낼 대상 계산 | `packages/daemon/src/push/planner.ts` | T26-15 표 시험: active 기기 있음 → 없음, live 없음 → 즉시, live idle만 → 60초 지연, 방해 금지 → 없음, minUrgency 미만 → 없음, 같은 질문 세 번째 → 없음, notice 시간당 7번째 → 묶음. T26-16 재전송·재접속으로 푸시가 다시 가지 않는다 |
| 송신 | `packages/daemon/src/push/webpush.ts` | T26-17 가짜 푸시 서비스(22)로 RFC 8291 복호화 성공, VAPID JWT의 `aud`가 엔드포인트 출처, `TTL`·`Urgency`·`Topic` 헤더. 410 → 등록 삭제 + `device.push_unregistered(gone)`. 5xx → 3회 재시도 뒤 `push.sent(failed)` |
| 11 수정 반영 | 11의 `urgencyOf`, 전달기 | T26-18 away + pushReachable → 권리 게이트 막힘 질문이 interrupt, away + pushReachable 없음 → digest(기존과 같음). `question.delivered.channel` 규칙 |
| 서비스 워커 | `apps/mobile/src/sw/` | T26-19 push 이벤트마다 알림이 정확히 하나(payload 오류 포함). T26-20 notificationclick → 열린 창 이동 또는 새 창 `navigate`. T26-21 같은 `deliveryId` 두 번 → 한 번 표시 |
| 수명주기 | `apps/mobile/src/platform/pwa/lifecycle.ts` | T26-22 hidden → presence hidden 보낸 뒤 1000 닫기, 응답 대기 명령이 있으면 최대 2초 기다림. visible → `retryNow`. 폐기 → 캐시·초안·진행 중 명령함 삭제 |
| 결정 가능 판정 | `apps/mobile/src/screens/decide.ts` | T26-23 표 시험: §3.5.11의 각 상태에서 버튼 활성 여부와 이유 키. 휴대폰 비활성 선택지(§3.5.4 표)는 명령을 보내지 않는다 |
| 화면 | `apps/mobile/src/screens/` | T26-24 Playwright WebKit(iPhone 15 뷰포트, 가짜 데몬): 페어링 → 질문 답하기 → 영향 표시, 묶음 답하기 D1, 오프라인 초안 보존과 재연결 뒤 수동 보내기, 낡음 띠, 다른 기기에서 답함. T26-25 `just mobile-shot` 화면 캡처가 디자인과 맞음. T26-26 모든 누르는 영역 44×44pt 이상, 입력 칸 글자 16px 이상(자동 검사) |
| 갱신 | `apps/mobile/vite.config.ts`, `sw.ts` | T26-27 새 판 배포 → 다음 실행 때 적용, 초안 유지. `protocol.unsupported` → 즉시 적용 |

공통 완료 조건: `just verify` 통과. 화면 작업은 `just shot`(= `mobile-shot`) 비교.

### 6.2 실기기 수동 확인 체크리스트 (iPhone, 출시 전)

| ID | 확인 |
|---|---|
| M-01 | Safari → 홈 화면에 추가 → 독립 창으로 열림, 아이콘·이름 "Helm" |
| M-02 | 브라우저 탭에서는 페어링 칸이 보이지 않음 |
| M-03 | 쿠키로 WSS가 붙음(AS-M2·M3). `tailscale serve`를 거친 요청에 `Cookie`·`Origin`이 그대로 있음(데몬 로그의 헤더 존재 여부만, 값은 남기지 않음) |
| M-04 | 알림 권한 → 구독 → 시험 푸시가 잠금 화면에 뜸. 내용 숨김 기본 문구 |
| M-05 | 앱을 완전히 닫은 상태에서 권리 게이트 질문 → 10초 안에 알림 → 누르면 그 질문이 열리고 6초 안에 버튼 활성 |
| M-06 | 화면 끔·다른 앱 전환 → 다시 열기 → 3초 안에 연결, 초안 유지 |
| M-07 | 앱 전환 화면에 내용이 보이는지(가림막 동작 여부 기록) |
| M-08 | iOS 설정에서 알림 끔 → 다음 실행 때 설정 화면 안내, 데몬 등록 해제 |
| M-09 | 8일 동안 열지 않은 뒤 열기 → 다시 페어링 없이 연결(AS-M4) |
| M-10 | Tailscale 끔 → 캐시 읽기 전용과 연결 점검 1단계 문구 |
| M-11 | VoiceOver로 질문 카드 읽기 순서(화면 종류 라벨 → 질문 → 버튼) |
| M-12 | iPad 가로·세로에서 두 칸 배치 |

## 7. 미결 사항

### 7.1 사용자에게 확인할 것

| ID | 질문 | 왜 필요한가 | 답이 없을 때 |
|---|---|---|---|
| U-1 | Apple 개발자 프로그램(유료, 연 99 USD)에 가입되어 있는가 | 있으면 경로 B(Tauri iOS + APNs)를 고를 수 있다. 없으면 PWA만 푸시를 받을 수 있다 | PWA(경로 A). 가입 여부와 관계없이 동작한다 |
| U-2 | 모바일을 웹 기술(데몬이 서빙하는 홈 화면 웹 앱)로 만들어도 되는가. 결정 19 "클라이언트는 웹이 아니다"는 데스크톱에 대한 결정으로 읽었다 | 결정 19의 해석 | PWA로 진행 |
| U-3 | iPhone의 iOS 판(16.4 이상인가, 18.4 이상인가) | Web Push 가능 여부와 대체 문구 경로(AS-M1) | 18.4 이상으로 본다 |
| U-4 | 휴대폰 알림을 "멈춰 있는 것만"(기본)으로 둘지, 알림 강도 질문까지 받을지 | 푸시 양 | 멈춰 있는 것만 |
| U-5 | Android 기기를 쓸 계획이 있는가 | 시험 대상 여부 | 지원 대상 아님 |

### 7.2 설계 미결

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| MQ-01 | 모바일 구현 방식 | PWA / Tauri iOS / RN / Swift | PWA(§3.1.4). U-1이 "있음"이고 §3.1.5 조건이 생기면 Tauri iOS |
| MQ-02 | 최소 iOS 판 | 16.4 / 18.4 | 16.4에서 동작, 18.4 권장 |
| MQ-03 | 앱 잠금(18 §3.18.2 6번) | 1차 끔(휴대폰 잠금에 맡김) / WebAuthn 확인을 권리 게이트 허락에만 / 모든 결정에 | 1차 끔. 2주 사용 뒤 권리 게이트 허락에만 WebAuthn 확인을 넣을지 본다. 18과 의견이 다르다 |
| MQ-04 | 쿠키가 serve를 통과하지 못할 때의 대체 | `helm-bearer.` 하위 프로토콜 + IndexedDB 토큰 / 연결마다 1회용 티켓(쿠키 없이 `whoami` 대신 `/m/ticket`) | 하위 프로토콜. 토큰이 스크립트에 보이게 되므로 이때는 서명 증명(ES256, 추출 불가 WebCrypto 키)을 켠다 |
| MQ-05 | 모바일 서명 증명(18 §3.8.5) | 1차 끔 / 켬(WebCrypto ES256, 추출 불가 키) | 쿠키 방식이면 끔(§3.3.3). MQ-04 대체 방식이면 켬 |
| MQ-06 | `push.followupDelayMs` | 0 / 60초 / 5분 | 60초 |
| MQ-07 | VAPID `sub` | `https://<publicHost>/m/` / `mailto:` 주소 | https URL. Apple이 거부하면(AS-M6) 설정에 사람이 고른 `mailto:`를 넣는다 |
| MQ-08 | Web Push 송신 구현 | `web-push` 3.6.7 고정 / Node `crypto` 직접 구현 | `web-push` 고정. 의존 감사에서 문제가 나오면 직접 구현 |
| MQ-09 | 모바일 유리 재질 기본값(21 U-22) | 줄임 / 켬 | 줄임 |
| MQ-10 | 앱 안 QR 읽기(코드 자동 입력) | 1차 / 2차 | 2차. 1차는 12자 입력 |
| MQ-11 | 휴대폰에서 답할 수 없는 질문의 미루기 기본값 | "다음 데스크톱 접속까지" / "다음 작업 경계까지" | 11이 표현할 수 있으면 앞의 것, 아니면 뒤의 것 |
| MQ-12 | 실기기 시험용 개발 데몬 serve 포트(예: 8449 → 개발 데몬 tailnet 리스너) | 둔다(홈랩 변경) / 두지 않는다 | 두지 않는다. 실기기 확인은 정식 데몬에서, 개발 중에는 브라우저 + 가짜 데몬 |
| MQ-13 | presence `active` 판정 시간 | 2분 / 5분(데스크톱과 같게) | 2분 |
| MQ-14 | `choose_one`을 휴대폰에서 답하게 할지(03과 다름) | 답함 / 데스크톱 | 답함(§3.5.4). 03이 받아들이지 않으면 03 안을 따른다 |

## 8. 출처

설계 문서(2026-10-12 판): `docs/design/process/00-design-brief.md`(결정 14, 19, 21, 24, 26, 29, 32, 38, 41~46, §2.5), `docs/design/process/rulings-stage2a.md`(§2, J-02, J-03, J-20, J-28, J-30, J-31, J-37), 01 §3.8·NFR, 02 UC-04·UC-11·UC-17, 03 §3.4~§3.6·§3.12, 04 §3.0~§3.5·§3.19·§3.21·§3.26·§4·A4·A5, 05 §3.1·§3.3·§3.4·§3.7·§3.9·A8, 06 §3.1·§3.3·§3.4·§3.5·§3.16, 08 §3.19.1·Via, 09 §3.4.9·§3.4.13·운영 테이블, 10 §3.11, 11 §3.2.3·§3.5·§3.8·ADR-A7, 17 §3.10·§3.11·§3.15, 18 §3.2~§3.9·§3.18·§3.19·Q18-02·Q18-09, 19 §2.3·§3.2·§3.4·§3.7.7·§3.7.8·§3.8.3·§3.10·§3.13·§3.14·§3.17, 20 §2.3·§3.8.9·§3.9.5·§3.9.12·§3.10.1·§3.10.6·§3.11·§3.14, 21 §3.5.8·§3.7.3·§3.13.

원천과 홈랩(읽기 전용):
- `docs/design/process/sources/pi-cases-notes.md` L260·L264(Paseo 푸시·포그라운드 프로브), L411·L476(OpenClaw Web Push·APNs), L483(iOS outbox)
- `~/projects/_ref/openclaw/docs/platforms/ios.md` L20-32, L270-300, L601-678(APNs 중계 조건, 직접 빌드는 직접 APNs 키) [원문]
- `~/projects/homelab/context/machines.md`(iPhone·iPad, Mac 빌드 노드, VPS), `network.md`(serve 표, tailnet 이름), `storage.md` L135(경보와 `NTFY_URL`), `homelab/scripts/alert`, `homelab/.env.example` [원문]
- `secrets ls -i ntfy` 결과(2026-10-12) [실험]
- `npm view web-push`, `vite-plugin-pwa`, `idb`(2026-10-12) [실험]

웹(2026-10-12 확인):
- WebKit, "Web Push for Web Apps on iOS and iPadOS": https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ [원문]
- WebKit, "Meet Declarative Web Push": https://webkit.org/blog/16535/meet-declarative-web-push/ [원문]
- WebKit, "Updates to Storage Policy": https://webkit.org/?p=14403 , 관련 보도 https://www.osnews.com/?p=131566 , WebKit 버그 272189 https://bugs.webkit.org/show_bug.cgi?id=272189 [검색]
- ntfy 설정 문서 "iOS instant notifications": https://docs.ntfy.sh/config/ [원문]
- 무료 프로비저닝 제약: https://learn.microsoft.com/th-th/previous-versions/xamarin/ios/get-started/installation/device-provisioning/free-provisioning , https://developer.apple.com/forums/thread/724896 , https://mybyways.com/blog/new-limitations-imposed-on-free-apple-developer-account [검색]
- TestFlight 내부 테스트·90일: https://docs.expo.dev/submit/testflight.md [검색]
- iOS 백그라운드 소켓: https://developer.apple.com/forums/thread/716118 [검색]
- Tauri 원격 푸시 플러그인: https://github.com/Choochmeque/tauri-plugin-notifications [원문], https://github.com/yanqianglu/tauri-plugin-mobile-push [검색]
- `apple-native-keyring-store`: https://docs.rs/apple-native-keyring-store/latest/apple_native_keyring_store/ [원문]
- Tailscale VPN On Demand: https://tailscale.com/kb/1291/ios-vpn-on-demand [검색]

## ADR 후보

### ADR-26-1. 모바일 1차는 데몬이 서빙하는 PWA로 만든다

- 상태: 제안
- 맥락: 결정 42로 휴대폰 클라이언트가 범위에 들어왔다. 사용자의 Apple 개발자 프로그램 가입 여부는 모른다. 무료 계정으로 서명한 iOS 앱은 7일마다 다시 설치해야 하고 푸시를 쓸 수 없다(X-1, X-2). iOS 16.4부터 홈 화면 웹 앱이 계정 없이 Web Push를 받는다(X-4).
- 결정: `apps/mobile`(React 19 + Vite, 데스크톱과 같은 `@helm/ui`·`@helm/client`·`@helm/client-react`)을 데몬 릴리스에 넣고 `tailnet` 리스너의 `/m/`로 서빙한다. 사용자는 Safari에서 홈 화면에 추가해 쓴다.
- 근거: 계정·만료 없이 푸시를 받는다. 데스크톱과 화면 코드를 공유한다. 데몬과 같은 판으로 배포되어 판 불일치가 없다. 빌드에 Mac이 필요 없다.
- 기각한 대안: Tauri v2 iOS(유료 계정 없이는 푸시와 장기 설치가 안 됨. 유료 계정이 있으면 경로 B로 남김), React Native(화면 부품 두 벌), 네이티브 Swift(코드 두 벌).
- 결과: 데몬이 웹 출처가 되므로 CSP·Origin 검사·쿠키 규칙이 필요하다(ADR-26-3). 19의 "정적 파일을 서빙하지 않는다"와 18의 "hello 전 처리 없음"에 `/m/` 예외가 생긴다. 결정 19의 해석을 사용자에게 확인한다.

### ADR-26-2. 앱이 꺼져 있을 때의 알림은 데몬이 직접 보내는 Web Push다

- 상태: 제안
- 맥락: 사람이 자리에 없을 때 권리 게이트가 멈춘 채로 남는다(11 §3.8.2). 후보는 APNs 직접, Web Push, ntfy(자체·공개), 텔레그램 봇, 외부 푸시 앱이다.
- 결정: VAPID로 서명한 Web Push를 데몬이 Apple·Google 푸시 서비스로 직접 보낸다. payload는 Declarative Web Push 형식이고 문구 키만 담는다.
- 근거: PWA와 같은 앱이 열려 쿠키와 캐시를 그대로 쓴다. 계정이 필요 없다. payload가 종단 암호화된다. ntfy는 iOS에서 공개 중계를 거치고 누르면 Safari가 열려 PWA와 이어지지 않는다. 텔레그램 안에서 답하면 사람 명령 경로(결정 14)를 벗어난다.
- 기각한 대안: APNs 직접(유료 계정, 네이티브 앱 필요), ntfy, 텔레그램, Pushover·Bark, 푸시 없음(결정 42의 목적을 채우지 못함).
- 결과: VAPID 개인 키가 제품 비밀에 들어간다. 데몬의 바깥 연결에 푸시 서비스 호스트가 더해진다. 11의 `urgencyOf`가 "자리에 없지만 푸시로 알릴 수 있음"을 알아야 한다.

### ADR-26-3. 모바일 기기 토큰은 HttpOnly `__Host-` 쿠키로 나른다

- 상태: 제안
- 맥락: 브라우저 WebSocket은 `Authorization` 헤더를 붙일 수 없다. 19는 `helm-bearer.` 하위 프로토콜을 두었으나 그러면 토큰이 스크립트 저장소에 있어야 한다. 18 §3.18.2 4번은 PWA라면 HttpOnly 쿠키와 CSRF 대책을 요구했다.
- 결정: `/m/pair`가 `__Host-helm_dt` 쿠키(`HttpOnly; Secure; SameSite=Strict`)를 설정하고, `tailnet` 리스너는 Origin이 모바일 출처일 때만 쿠키를 받는다. 쿠키는 `credentialCarrier: "cookie"`로 발급된 모바일 기기에만 쓸 수 있다.
- 근거: 스크립트가 토큰을 꺼낼 수 없다. 쿠키는 스크립트 저장소 정리 정책의 대상이 아니라고 본다(AS-M4).
- 기각한 대안: 하위 프로토콜 + IndexedDB(토큰이 스크립트에 보임. 쿠키가 serve를 통과하지 못할 때의 대체로만 남김), 연결마다 1회용 티켓(티켓 발급에도 결국 자격이 필요).
- 결과: 18 `preflight`에 쿠키 갈래, 08 Device에 `credentialCarrier`. 실기기에서 serve가 쿠키를 넘기는지 확인해야 한다(M-03).

### ADR-26-4. 휴대폰은 숨겨지면 연결을 닫고 보이면 바로 다시 붙는다

- 상태: 제안
- 맥락: iOS는 백그라운드 앱을 곧 멈추고 그 연결도 끊는다(X-8). 끊긴 연결을 데몬이 45초 뒤에 알아채면 그동안 presence가 틀리고 푸시 판단이 늦는다.
- 결정: `visibilitychange → hidden`에서 presence `hidden`을 보내고 응답 대기 명령을 최대 2초 기다린 뒤 1000으로 닫는다. `visible`에서 `retryNow()`. 구독은 `payload: "none"`.
- 근거: 데몬이 사람의 부재를 바로 알아 푸시를 고를 수 있다. 다시 붙는 비용(1~3초)은 위치부터 재전송과 진행 중 명령함으로 메운다.
- 기각한 대안: 백그라운드 작업으로 연결 유지(시간이 짧고 보장이 없다), 닫지 않고 두기(반쯤 열린 연결이 45초 남는다).
- 결과: 짧게 다른 앱을 다녀와도 다시 붙는다. 19 §3.17의 "이동 환경 규칙"과 같다.

### ADR-26-5. 푸시는 멈춰 있는 질문에만, 다른 기기 앞에 사람이 있으면 보내지 않는다

- 상태: 제안
- 맥락: 05는 알림을 전달된 질문에만, 같은 질문은 두 번까지로 정했다. 휴대폰 푸시가 데스크톱 알림과 겹치면 같은 일을 두 번 알린다.
- 결정: 기본은 강도 `interrupt`만 푸시한다. 어떤 기기가 `active`면 보내지 않는다. 연결된 기기가 `idle`·`hidden`뿐이면 60초 뒤 열람이 없을 때 보낸다. 방해 금지 중에는 보내지 않고 끝날 때 묶음 하나.
- 근거: 휴대폰은 주머니 속 기기라 알림 하나의 비용이 크다. 멈춰 있지 않은 질문은 임시 가정으로 진행되므로 기다려도 된다.
- 기각한 대안: 모든 전달을 푸시(05 주의 예산과 충돌), 데스크톱과 휴대폰에 동시 알림(같은 일을 두 번).
- 결과: 11에 `pushReachable`, 런타임 타이머 `push_followup`·`push_dnd_digest`.

### ADR-26-6. 푸시 등록 원문은 운영 테이블에 두고 이벤트에는 해시만 둔다

- 상태: 제안
- 맥락: 푸시를 보내려면 엔드포인트 URL과 암호 키 원문이 필요하다. 결정 29는 모든 상태를 로그에서 재구성하라고 한다. 18 §3.18.2 9번은 원문을 이벤트에 넣지 말라고 요구했다.
- 결정: 원문은 운영 테이블 `device_push`에, 이벤트(`device.push_registered`)와 Device `push`에는 해시·끝자리·호스트·설정만 둔다. 원문이 없는데 등록 이벤트가 있으면 `needs_refresh`로 보이고 앱이 다시 등록한다.
- 근거: 원문은 휴대폰이 언제든 다시 줄 수 있는 값이라 로그에 없어도 상태가 스스로 돌아온다. 원문이 재전송·투영·진단으로 퍼지지 않는다.
- 기각한 대안: 원문을 이벤트에 넣고 `sensitiveFields`로 가림(백업·내보내기에 남는다), 원문을 SOPS에(기기마다 바뀌는 값이라 사람 작업이 된다).
- 결과: 09 운영 테이블 목록과 복원 절차에 `device_push`가 더해진다.
