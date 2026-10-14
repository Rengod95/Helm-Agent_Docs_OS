# 22. 테스트 전략

- 작성: 2026-10-12, T1(2b단계 테스트 전략). 기준 결정은 브리프 결정 1~57이다. 01~21, 24, 26과 조정자 판정(`docs/design/process/rulings-stage2a.md`)의 2026-10-12 판을 읽고 썼다. 다른 문서가 2a 통합 중이라 13:00 무렵 판에서 한 번 더 맞췄다(§3.19의 ID 범위).
- 상태: 2b단계 초안. T2의 23(구현 계획)과 교차 확인 예정.
- 소유: 테스트 계층과 패키지별 담당, 테스트 도구와 폴더·이름 규칙, 결정성 장치(시계·ID 주입, 모델 테이프), 픽스처 규칙, 유즈케이스 대본(`ScenarioScript`) 형식과 하네스, 수용 기준 추적표, 장애 주입 방법과 시나리오, 적합성 시험 묶음, 모델 품질 평가와 커널 테스트의 경계, `just verify`의 테스트 범위와 테스트 레시피, 플래키·느린 테스트 규칙, 다른 문서 테스트 ID의 추적 색인.
- 소유하지 않음: 각 모듈의 개별 완료 조건(그 문서의 §6), 커널 불변조건과 속성 목록(10 §3.17), 장애 대상의 정상 동작(09·12·17), 프로토콜 적합성 시나리오 내용(19 §6.3), 보안 테스트 내용(18 §3.17), 화면 부품 테스트 종류(21 §6.3), 모델 평가 절차와 판정(15 §3.15, 16 §3.27), 레시피 색인 자체(06 §3.16), 마일스톤 순서(23).

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

1. 테스트 계층 14개와 각 계층의 결정성 등급, 도구, 실행 레시피(§3.1~§3.3).
2. 폴더 구조와 이름 규칙, 테스트 제목에 붙이는 추적 ID(§3.4).
3. 결정성: 시계·ID·난수·경로·환경의 주입, 모델 테이프(`helm.model-tape.v1`) 형식과 재생 규칙, "같은 입력이면 같은 이벤트 로그"의 비교 방법(§3.5).
4. 픽스처와 테스트 데이터: 상태 픽스처(02 §2.7), 골든 파일, 합성 외부 로그, 테스트 비밀(§3.6).
5. 커널 테스트 운용: 속성 테스트 PT-01~19의 실행 방식, 공리 A1~A15 위반 테스트 대응표, 불변조건 1~7, 의존 규칙 1~5와 계획 검사 V-PLAN-01~07, helm-toy 대본과 원전 57개 테스트의 대응(§3.7).
6. 유즈케이스 시나리오: `ScenarioScript` v1 정본, 하네스와 실행 모드, MVP 대본 목록, 수용 기준(AC) → 테스트 추적표(§3.8).
7. 장애 주입: 주입 수단, 종료 지점 목록, 장애 시나리오 FI-01~FI-32, 장애 뒤 공통 검사(§3.9).
8. 적합성: 세 리스너 동등성, 런타임 어댑터, 외부 로그 어댑터, pi 포크 무결성(§3.10).
9. 보안·격리·관찰 에이전트 테스트의 배치와 비밀 카나리아, 웹·네트워크·브라우저·해시라인 편집 시험(§3.11, §3.11.5).
10. UI: 부품·화면·시각 회귀(기준 이미지 환경), IME, 접근성(반투명 표면 대비 포함), 결정 18 금지 규칙, 데스크톱 E2E 범위, 모바일(§3.12).
11. 성능 시험(§3.13), 모델 품질 평가의 분리와 편집 방식 A/B 평가(§3.14).
12. `just verify`에 넣는 것과 넣지 않는 것, 테스트 레시피, CI 여부(§3.15~§3.16).
13. 커버리지·완료 기준, 플래키 대응, 느린 테스트 분리, 테스트 데이터 관리(§3.17~§3.18).
14. 다른 문서의 테스트 ID 추적 색인(§3.19).

### 1.2 다루지 않는 것

- 각 테스트의 기대값 자체. 기대값은 소유 문서(08~21의 §6, 02의 AC)가 정하고, 이 문서는 그것을 어디에 두고 어떻게 돌리는지 정한다.
- 실사용 실험 프로토콜(ABAB 교대, 복귀 점검 채점, 2주 평가)의 내용. 16 §3.27이 소유한다. 이 문서는 그 기록을 만드는 도구가 테스트 대상인지만 다룬다.
- 홈랩 백업 체계(restic)의 테스트. 홈랩 저장소의 일이다. 이 문서는 Helm 쪽 복원 훈련만 다룬다.
- 구현 순서와 마일스톤. 23이 정한다. 이 문서는 마일스톤 관문에 쓸 레시피(`just test-all`)만 정한다.

### 1.3 용어

| 용어 | 뜻 |
|---|---|
| 테스트 계층 | 무엇을 어떤 격리 수준으로 확인하는지에 따른 테스트 묶음(§3.1). 한 테스트는 한 계층에 속한다 |
| 추적 ID | 테스트 제목 맨 앞에 붙이는 `<문서 번호>/<그 문서의 ID>` 형식의 식별자. 예: `10/PT-04`, `02/AC-07-01`, `12/T-SC-01`, `13/T-SC-01`. 문서 번호를 붙여 문서 사이의 ID 충돌을 없앤다(§3.4.3) |
| 대본 | 02 §3.24의 `ScenarioScript`. 유즈케이스 흐름 하나를 사람 명령·모델 응답·시계·연결·장애 단계로 적은 데이터(§3.8.1) |
| 모델 테이프 | 가짜 모델이 돌려줄 응답 열을 적은 파일(`*.tape.jsonl`). 사람이 쓴 것(authored)과 실제 모델 실행에서 녹화한 것(recorded)이 있다(§3.5.4) |
| 골든 파일 | 테스트가 출력과 바이트 단위로 비교하는 커밋된 기대 출력(이벤트 열, 선형 텍스트, 스키마 스냅숏 등) |
| 픽스처 | 테스트의 출발 상태나 입력 데이터. 상태 픽스처(`F-*`)는 명령을 실행해 만든다(§3.6.1) |
| 결정성 등급 | D0 바이트 동일, D1 의미 동일, D2 통계·사람 판정(§3.1.2) |
| 빠른 테스트 / 느린 테스트 | `just verify`에 들어가는 것 / 들어가지 않고 `just test-slow`·`test-deep` 등에서 도는 것(§3.18.2) |
| 플래키 | 코드와 입력이 같은데 결과가 바뀌는 테스트(§3.18.1) |
| 종료 지점(kill point) | 장애 주입 시험에서 데몬 프로세스를 강제 종료하는 이름 붙은 코드 위치(§3.9.2) |
| 비밀 카나리아 | 테스트용 가짜 비밀 값. 테스트가 끝난 뒤 DB·로그·blob·프로토콜 프레임 어디에도 원문이 없는지 검사한다(§3.11.2) |

## 2. 전제와 결정

### 2.1 이 문서가 기대는 결정

| 결정 | 이 문서의 귀결 |
|---|---|
| 14 모델은 제안하고 커널이 상태를 바꾼다 | 커널 테스트에는 모델 응답을 넣지 않는다. 모델 품질이 낮아도 커널 테스트는 실패하지 않고, 커널 규칙이 깨지면 모델과 관계없이 실패한다(10 §3.17.3) |
| 15 의존 규칙, 17 불변조건 1~7 | 규칙마다 위반 테스트와 속성 테스트를 둔다(§3.7.3~§3.7.5). 어떤 다이얼·모드 조합에서도 통과해야 한다 |
| 18 대안 고르기 상호작용 거부 | 커널·탐구 엔진·문구·화면 네 층에 금지 테스트를 둔다(§3.12.5) |
| 22 클라이언트 없이 계속 | 대본은 클라이언트 연결 없이 시계만 진행하는 단계를 가진다(UC-03) |
| 23·27·28 자체 런타임, pi-ai 고정 의존, pi-agent-core 포크 | 가짜 모델은 pi-ai faux 제공자(`fauxProvider`) 위에 만든다(§3.5.4). 포크 무결성 테스트(07 I1~I5, C1~C25, 업스트림 테스트)를 계층에 넣는다(§3.10.4) |
| 29·30 이벤트 로그가 기준 원본, 의도 → 실행 → 결과 | 장애 주입 뒤 검사는 로그만 본다(§3.9.4) |
| 34 런타임 어댑터 인터페이스를 지금 정의 | 적합성 시험 틀과 가짜 어댑터를 MVP에 둔다(§3.10.2) |
| 38 두 접속 경로의 메시지·재전송 의미가 같다 | 리스너 동등성 시험(§3.10.1) |
| 41 React 19, 글래스모피즘 | 반투명 표면의 대비 시험과 투명도 줄이기 대체 시험(§3.12.4) |
| 42 휴대폰에서 답하기 | 모바일(PWA, Web Push) 시험 배치(§3.12.7, 26) |
| [결정 47] 모바일은 데몬이 서빙하는 PWA, 알림은 Web Push | 모바일 시험은 서버에서 Playwright WebKit과 가짜 푸시 서비스로 돈다(§3.12.7). Mac이 필요한 것은 실기기 수동 확인뿐이다 |
| [결정 48] 휴대폰 알림은 `interrupt`·`notice` 질문까지 | 모든 기기가 부재일 때 두 강도의 질문이 푸시로 나가고 `digest`는 나가지 않는지 대본으로 확인한다(UC-04/away-push, §3.12.7) |
| [결정 49] 모바일 최소 판 iOS 26, Android 제외 | 모바일 시험 대상은 iPhone(iOS 26)과 Playwright WebKit뿐이다. Android·Chromium 모바일 뷰포트 시험은 두지 않는다 |
| [결정 53] 루프 계획은 혼합 방식이다(기본 `hybrid`) | 계획 작성 방식 다이얼(`planAuthoring`)의 세 값과 계획 검사 V-PLAN-01~07(§3.7.5, 22/PL-01~07)을 시험한다. 모델 계획 초안은 가짜 모델 `faux:helm`의 테이프로 재생한다(14 C-4, [판정 J-188]) |
| [결정 55] MVP 도구에 외부 웹 탐색과 고급 도구를 넣는다 | 웹 읽기·검색·grep 확장·해시라인(MVP)과 브라우저(MVP 후반)를 시험한다. 내부망 차단과 외부 허용을 둘 다 본다(§3.11.5 22/NW-01~04). 요청 가로채기와 `taint.web`(22/WB-01~03), 해시라인 낡은 태그(22/HL-01~02), 편집 방식 A/B(22/EV-04, §3.14.2)를 더한다. 판정 J-190 |
| [결정 56] 결과 확인 대기의 휴대폰 알림은 설정으로 고른다 | 세 값(`none`, `daily_digest`, `immediate`)을 시험한다(§3.12.7 22/NT-01~03). 기본값 `none`은 [판정 J-189]이다 |
| 44 Node 24, TS 6.0, Vitest | 테스트 실행기는 Vitest(06 §3.12.1). 버전은 06 고정 정책을 따른다 |
| §2.5 just 레시피, `just verify` = 완료, 종료 코드 2 = 환경 문제 | 모든 테스트 실행은 레시피로 한다. 도구·환경이 없으면 2로 끝낸다(§3.15) |
| 사용자 규칙: 바이너리는 Git에 넣지 않는다 | 시각 기준 이미지는 Git 밖에 두고 해시 잠금 파일만 커밋한다(§3.12.2) |
| 06 O-11 `just verify`는 서버에서만 | 호스팅 CI에서 테스트를 돌리지 않는다(§3.16) |

### 2.2 원천에서 가져온 것

| 원천 | 내용 | 반영 |
|---|---|---|
| canon-2 §1.23 Test architecture | Kernel·Storage·Adapter conformance·Cross-runtime fixture·UX/effectiveness 다섯 묶음 | §3.1 계층에 나눠 넣음. Cross-runtime은 어댑터 적합성(§3.10.2), UX/effectiveness는 16의 실사용 측정과 모델 평가(§3.14) |
| canon-2 §9.14 helm-kernel-v02 테스트 57개 [실험: 57 pass] | 계약 2, guided-001 9, 어댑터 적합성 4, client 3, authority 5, context 3, agent-runtime 14, openai-provider 6, sqlite-kernel 9, experience 2 | §3.7.7에서 하나씩 새 테스트 ID에 대응 |
| canon-2 §3.16 | golden transcript, 선형 표현을 화면 스냅숏보다 먼저 검증 | 선형 텍스트 골든(04 §6, 21 §6.3)을 시각 회귀보다 앞 계층에 둠 |
| canon-2 §9.6, §9.9 | 고장 주입 지점, clock·idFactory 주입 | §3.5.1, §3.9.1 |
| 대화 발췌 3 X3-8-24 | 공리마다 불변조건, 집행 지점, 위반 테스트, 운영 지표 | §3.7.3 표 |
| 대화 발췌 3 X3-8-26 | 정해진 제안 순서를 내는 가짜 모델로 재생. 같은 입력이면 같은 이벤트 로그. 불변조건은 무작위 제안 순서로 속성 테스트 | §3.5, §3.7.2 |
| 대화 발췌 3 X3-8-27 | 모델 품질은 커널 테스트와 따로 평가 | §3.14 |
| 대화 발췌 3 X3-4-11(L2304–2316) | 한 턴 흐름(읽기 → 해석 → 합의 없는 쓰기 차단 → 합의 → 쓰기 → 결과 제출 → 확인) | UC-07 기본 대본의 출발점(02 §3.24, 12 §6 통합 시나리오) |
| 대화 발췌 3 X3-10-03, `experiments/helm-toy/helm.mjs` | 21번 시도 중 8번 거부(3, 4, 5, 7, 10, 17, 19, 21) [실험] | 커널 첫 대본(10 §3.17.4) |
| canon-2 §7.2.1 durable-spike 스파이크 1 c1~c7 | 합의 없음·범위 밖 쓰기 차단, 지어낸 근거 거부, 재시작 뒤 상태 유지 | UC-07 기본 대본의 재생 결과 비교 기준(12 §6) |
| pi-api-facts-1 §2.10 | faux 제공자 API, 응답 큐가 비면 오류 메시지, `api` 기본값이 실행마다 임의 문자열, cost 0 [원문] | §3.5.4 테이프 재생기. `api` 고정(07 C17) |

### 2.3 이 문서의 주요 결정 [제안]

| ID | 결정 | 근거 |
|---|---|---|
| D22-1 | 테스트를 14개 계층으로 나누고 계층마다 결정성 등급을 정한다. D0·D1 계층만 `just verify`에 넣는다 | 결정적이지 않은 테스트가 완료 판정에 섞이면 같은 코드에서 완료 여부가 바뀐다 |
| D22-2 | 테스트 제목 맨 앞에 추적 ID(`<문서>/<ID>`)를 둔다. 색인은 첫 마일스톤(23 M0-12)에서 §3.19 전체를 23 WBS ID와 함께 옮겨 둔다. `just test-trace`는 끝난 WBS 행에 속한 ID가 테스트 제목에 없으면 실패하고, 끝나지 않은 행의 ID는 경고만 낸다. `just verify`에 들어간다 | 설계의 완료 기준이 테스트로 옮겨졌는지 기계로 확인한다. 문서마다 ID 형식이 달라도 문서 번호로 구분된다. 마일스톤 중간에도 verify가 미래 항목 때문에 실패하지 않는다 |
| D22-3 | 시계, ID, 난수, 부팅 epoch, `storeId`, HMAC 키, 임시 경로, 환경 변수, 모델 응답, 시간대를 모두 주입한다. 테스트 안에서 실제 시계로 기다리지 않는다 | X3-8-26 "같은 입력에서 같은 이벤트 로그" |
| D22-4 | 가짜 모델은 `@helm/ai/testing`의 테이프 재생기 하나로 통일한다. pi-ai faux 제공자(`fauxProvider`)를 쓰고 `api`를 `"faux:helm"`으로 고정한다 | 12는 faux 대본을 testkit에 두었고 06은 `@helm/ai/testing`에 두었다. 06 §3.4.14의 순환 방지 이유를 따른다. 07 C17 |
| D22-5 | 유즈케이스 대본과 하네스는 저장소 루트의 `tests/` 작업 공간 패키지(`@helm/tests`, 비공개)에 둔다. 같은 대본을 `kernel`·`runtime`·`protocol` 세 모드로 돌릴 수 있게 하고, MVP 대본은 모두 `runtime` 모드로 통과해야 한다 | 대본은 엔진·런타임·저장소·데몬을 함께 쓰므로 어느 한 패키지에 둘 수 없다. `runtime` 모드가 실제 훅 순서를 지난다 |
| D22-6 | 저장소가 끼는 테스트는 임시 디렉터리의 실제 SQLite 파일을 쓴다. 메모리 DB는 쓰지 않는다. 저장소가 필요 없는 커널 테스트는 `reduce(apply)`로 상태를 만든다 | 09 §6.2 공통(WAL 동작이 다름). 14 §6.2의 "메모리 SQLite"는 이것으로 바꾼다(§5.2) |
| D22-7 | 속성 테스트는 `just verify`에서 고정 시드 목록으로, `just test-deep`에서 새 시드와 큰 실행 수로 돈다. 실패한 시드는 회귀 대본으로 커밋한다 | verify의 결정성과 탐색 폭을 둘 다 얻는다. 10 §6.2 "시드 100개 × 길이 200(CI는 20개)"를 verify 20 / deep 100으로 옮긴다 |
| D22-8 | 장애 주입은 두 층이다. verify에는 같은 프로세스 안에서 인스턴스를 버리는 크래시(트랜잭션 사이)와 저장소 고장 주입 지점을, `just test-faults`에는 자식 프로세스 데몬을 이름 붙은 종료 지점에서 SIGKILL하는 시험을 둔다 | 같은 프로세스 시험은 빠르고 결정적이다. 실제 프로세스 종료는 도구 자식·소켓·잠금까지 확인하지만 느리다 |
| D22-9 | 상태 픽스처는 이벤트를 손으로 쓰지 않고 명령을 실행해 만든다. 이벤트 열 골든은 생성한 뒤 사람이 검토해 커밋하고, verify는 비교만 한다 | 규칙이 바뀌어도 픽스처가 유효한 상태로 남는다. 골든 자동 갱신은 회귀를 가린다 |
| D22-10 | 외부 세션 로그 픽스처는 합성 문장으로만 만든다. 모든 테스트 프로세스는 임시 `HOME`·`XDG_*`로 돈다. 실제 홈 디렉터리 로그를 읽는 테스트가 있으면 verify가 실패한다 | 16 §6.2 끝 문단, 브리프 §5 관찰 입력 규칙 |
| D22-11 | 시각 기준 이미지는 서버(WSL)에서 고정 판 Playwright 브라우저로 만들고 Git 밖(`~/projects/helm/design/visual-baselines/`)에 둔다. Git에는 이미지별 sha256 잠금 파일만 둔다. 시각 회귀는 verify에 넣지 않고 화면 작업의 완료 기준(`just ui-visual`, `just shot`)으로 둔다 | 사용자 규칙(바이너리 Git 금지, 화면이면 `just shot`). 21 §6.3 서버 기준 |
| D22-12 | 재시도로 플래키를 숨기지 않는다(Vitest `retry: 0`). 플래키는 격리 목록에 기한 7일로 올리고, D0 계층의 플래키는 격리도 허용하지 않는다 | 결정적이어야 할 테스트의 흔들림은 결정성 결함이다 |
| D22-13 | 모델 품질 평가는 `just eval-*` 레시피로만 돌고 verify에 넣지 않는다. 운영 DB를 쓰지 않고 평가 데이터 디렉터리를 쓴다 | 15 §3.15.1, X3-8-27 |
| D22-14 | 호스팅 CI에서 테스트를 돌리지 않는다. 예외는 Windows 셸 스모크 하나로, 20의 `app-build-win-ci` 수동 워크플로 안에서만 돈다 | 06 O-11(비밀·SOPS 키가 서버에만 있음), 20 §3.13.4 |
| D22-15 | 줄 커버리지를 관문으로 쓰지 않는다. 관문은 추적 색인 완결성(D22-2)과 `@helm/kernel`·`@helm/domain`의 분기 커버리지 하한 하나다 | 커버리지 수치로는 위반 테스트가 있는지 알 수 없다. 커널에서는 분기 하나가 규칙 하나다 |
| D22-16 | 테스트가 운영 데이터와 운영 데몬을 건드리지 않도록 테스트 공통 준비에서 막는다: 운영 데이터 디렉터리(`/srv/volumes/helm/data`)와 운영 소켓을 여는 코드는 테스트에서 예외를 던진다. 포트는 항상 임시 포트(0)를 쓴다 | 17 T17-26처럼 정식 데몬이 같은 서버에서 돈다 |

## 3. 명세 본문

### 3.1 테스트 계층 [제안]

#### 3.1.1 계층 표

| 태그 | 계층 | 무엇을 확인하나 | 격리 | 모델 | 결정성 | 주 도구 | 기본 레시피 |
|---|---|---|---|---|---|---|---|
| `unit` | 단위 | 함수·모듈 하나의 입력 → 출력, 규칙 하나의 통과·실패 | 같은 프로세스, I/O 없음(또는 임시 디렉터리) | 없음 | D0 | Vitest | `just test` |
| `prop` | 속성 기반 | 무작위 입력 열에서 항상 참이어야 하는 성질(10 PT-01~19 등) | 같은 프로세스 | 없음 | D0(고정 시드) | Vitest + fast-check | `just test`(고정 시드), `just test-deep`(새 시드) |
| `contract` | 계약 | 외부 코드(pi 1.1.0, vendor 포크)와 경계 타입·스키마·등록 표의 약속 | 같은 프로세스 | faux | D0 | Vitest, `tsc`(타입 테스트) | `just test`, `just vendor-verify` |
| `int` | 통합 | 실제 SQLite 파일 + 엔진 + 커널, 런타임 + 테이프, 데몬 처리기 + 리스너(같은 프로세스), 자식 프로세스 몇 개 | 임시 디렉터리, 임시 포트 | 테이프 | D0/D1 | Vitest | `just test`(10초 이하), `just test-slow` |
| `scenario` | 유즈케이스 시나리오 | 02의 대본을 하네스로 재생해 AC 확인(§3.8) | `tests/` 하네스 안의 데몬 인스턴스 | 테이프 | D0 | Vitest + 하네스 | `just test`(`runtime` 모드), `just test-scenarios`(전 모드) |
| `conf` | 적합성 | 같은 대본을 여러 구현에 돌려 같은 결과(세 리스너, 어댑터, FakeDaemon, 외부 로그 어댑터) | 하네스 | 테이프 | D1 | Vitest + 19 시나리오 DSL | `just test`, `just test-conformance-ssh` |
| `fault` | 장애 주입 | 크래시·연결 끊김·디스크 가득·손상 뒤 불변조건(§3.9) | 같은 프로세스(verify) / 자식 프로세스 SIGKILL(test-faults) | 테이프 | D0/D1 | Vitest + 종료 지점 | `just test`, `just test-faults` |
| `sec` | 보안·격리 | 인증, 격리, 비밀, 주입(18 §3.17, 13 T-SB, 16 마스킹) | 통합 또는 실제 샌드박스 | 테이프 | D0/D1 | Vitest, bash | `just test`, `just daemon-systest` |
| `ui` | UI 부품·화면 | 부품 동작, 접근성, 키보드, IME, 선형 텍스트, 금지 패턴, 수명주기(21 §6.3), 화면 조립(20 §3.13.2) | 브라우저 모드 또는 jsdom | 없음(VM 고정 데이터) | D0 | Storybook + `@storybook/addon-vitest`, `@testing-library/react`, axe-core | `just ui-test` |
| `visual` | 시각 회귀 | 이야기·화면 캡처를 기준 이미지와 비교 | 서버의 고정 판 브라우저 | 없음 | D1(허용 차이) | Playwright `toHaveScreenshot` | `just ui-visual`, `just shot`, `just mobile-shot` |
| `e2e` | E2E | 앱(웹 대체 실행 또는 Tauri 셸) + FakeDaemon 또는 실제 데몬 | 브라우저·앱 프로세스 | 테이프(실제 데몬일 때) | D1 | Playwright, WebdriverIO `@wdio/tauri-service` | `just app-e2e`, `just mobile-e2e`, `just app-verify-mac`, `just e2e-real` |
| `perf` | 성능 | NFR-P·저장소·커널 목표 수치(§3.13) | 서버 고정 환경 | 없음 또는 테이프 | D2 | `vitest bench`, 측정 스크립트 | `just perf` |
| `sys` | 시스템 | systemd 단위, 설치·업그레이드, 실제 샌드박스, `/proc` 노출(17 시스템 종류, 18 시스템 종류) | 이 서버, 일회성 user unit | 테이프 | D1 | bash(`ops/test/`) | `just daemon-systest` |
| `eval` | 모델 품질 평가 | 실제 모델의 다양성·근거율·요약 누락·판정 일치(§3.14) | 평가 데이터 디렉터리 | 실제 모델 | D2 | 평가 하네스 | `just eval-*` |
| `manual` | 수동 확인 | OS UI(알림 클릭, 트레이, 키체인 확인 창), 실제 Tailscale serve, `wsl --shutdown`, 실제 IME | 실제 기기 | 실제 또는 테이프 | D2 | 체크리스트 | 없음(기록만) |

- 한 테스트는 태그 하나를 가진다. 태그는 파일 위치와 이름으로 정해진다(§3.4.2). 테스트 제목에 태그를 쓰지 않는다.
- canon-2 §1.23의 다섯 묶음과의 대응: Kernel tests → `unit`·`prop`(커널), Storage tests → `int`·`fault`(저장소), Adapter conformance → `conf`, Cross-runtime fixture → `conf`(어댑터 단계, 02 AC-17-04), UX/effectiveness → `eval`·`manual`과 16의 실사용 측정.

#### 3.1.2 결정성 등급

| 등급 | 뜻 | 비교 방법 | verify |
|---|---|---|---|
| D0 바이트 동일 | 주입한 시계·ID·난수·테이프가 같으면 출력이 바이트 단위로 같다 | 골든 파일 바이트 비교, 정규화 JSON(09 `canonicalJson`) 해시 비교 | 넣는다 |
| D1 의미 동일 | 실행 경로(리스너, 어댑터, 프로세스 경계)가 달라 ID·시각·provenance가 달라도 의미 필드가 같다 | §3.5.3의 정규화 뒤 비교, 허용 차이가 정해진 이미지 비교 | 넣는다(시각 회귀 제외) |
| D2 통계·사람 판정 | 시간 측정, 실제 모델, 사람 평가 | 목표 수치, 판정 규칙(15 §3.15.2) | 넣지 않는다 |

### 3.2 패키지별 담당

테스트는 그 코드가 있는 패키지에 둔다. 여러 패키지를 함께 띄워야 하는 시험만 `tests/`(`@helm/tests`)에 둔다.

| 패키지 | 계층 | 주 테스트 ID(추적 색인 §3.19) | 테스트 도우미 제공(`testing` 하위 경로, 06 §3.4.14) |
|---|---|---|---|
| `@helm/domain` | unit, prop, contract | 08/UT-01~13, 09/UT-01~06, 13/T-FP-01 | 없음(순환 방지, 06 §3.4.14) |
| `@helm/protocol` | unit, contract | 19/UT-01~08 | `@helm/protocol/testing`: `FakeDaemon`, `FakeClient`, 시나리오 DSL, 적합성 스위트(19 §6.3) |
| `@helm/kernel` | unit, prop | 10/UT-01~16, 10/PT-01~19, 11/AQ-01~24, 14/C-1~19·C-21~29, 22/AX-*, 22/INV-*, 22/DR-*, 22/PL-01~07 | 없음. 커널 시험용 생성기(`arbitraries.ts`)는 패키지 안 `test/` |
| `@helm/store` | int, fault, perf | 09/UT-07~20 | `@helm/store/testing`: 임시 DB, 고장 주입 지점, SQLite 오류 주입(§3.9.1) |
| `@helm/engine` | unit, int, fault | 06/S4 | `@helm/engine/testing`: 메모리 커널 상태 + 임시 파일 저장소 엔진 생성기 |
| `@helm/ai` | unit, contract | 12/T-AI-01~12(T-AI-05b 포함), 07/C15~C17·C19·C23·C24, 07/I1·I5 | `@helm/ai/testing`: 모델 테이프 재생기, 녹화기, 가짜 모델 정의(§3.5.4) |
| `@helm/agent`, `vendor/pi-agent-core` | contract | 07/C1~C14·C18·C8·C20·C25, 07/I3, 12/T-AG-01~09, 업스트림 37건 | 없음 |
| `@helm/tools`, `vendor/pi-tools`, `vendor/pi-image` | unit, contract, sec | 13/T-TL·T-PA·T-BT·T-SB·T-SC·T-CD·T-RD·T-HT·T-RB·T-RP·T-MC·T-PL·T-SG·T-NP·T-WF·T-WS·T-BR·T-HL·T-GR, 13/T-E01~T-E54, 22/NW-*, 22/WB-*, 22/HL-*, 07/C21·C22, 업스트림 137건 | `FakeToolExecutor`(대본의 `tool_result` 단계용) |
| `@helm/runtime` | unit, int, prop, fault | 12/T-RT·T-PJ·T-CP·T-CR·T-OW·T-CC·T-SC·T-BG·T-IN·T-SA·T-VW·T-PV·T-LC·T-DL·T-ST·T-IQ, 14/C-20, 15/T-01~29, 13/T-AD-01~03 | `@helm/runtime/testing`: 어댑터 적합성(`runAdapterConformance`), 가짜 어댑터, `whenIdle()`(§3.8.3) |
| `@helm/observer` | unit, prop, sec, conf | 16/OB-T01~33 | 합성 세션 픽스처 묶음 |
| `@helm/daemon` | int, sec, fault, sys | 17/T17-*, 18/T18-*, 26/T26-01~18·T26-28~33, 06/S3·S5·S7·S8 | 종료 지점 훅(§3.9.2, 테스트 빌드에서만) |
| `@helm/client` | unit, prop | 19/UT-09~14 | `@helm/client/testing`: 가짜 전송, 가짜 시계 연결 |
| `@helm/ui-language` | unit | 05/UT-01~03·UT-11 | 없음 |
| `@helm/testkit` | unit | 22/KIT-01~08 | 자기 자신(§3.5.2) |
| `@helm/ui-tokens` | unit(대비 관문) | 21/U1, 21/TK-09 | 없음 |
| `@helm/ui` | ui, visual | 21/TK-01~11, 21/U2~U9, 03/UT-08, 04/UT-14, 05/UT-04~07, 05/UT-13~14 | 이야기 고정 데이터(`packages/ui/src/fixtures`, 21 §6.1) |
| `@helm/client-react` | unit | 20/DM-26, 20/DM-28 | 가짜 `PlatformAdapter`(20 §3.14) |
| `apps/desktop` | ui, e2e, unit(Rust `cargo test`) | 03/UT-01~07, 04/UT-01~17, 05/UT-08~14, 20/DM-*, 20/IT-01~20 | 화면 뷰 표본(`test/fixtures/views`) |
| `apps/mobile` | unit, ui, e2e | 26/T26-12~14·T26-19~27·T26-34~35, 03/UT-09 | 26 §6.1 |
| `apps/cli` | unit, int | 17/T17-24·T17-32·T17-33, 06/S8 | 없음 |
| `scripts/` | unit | 06/S2, 07/V1·V7 | 가짜 워크스페이스 fixture(06 §3.5.2) |
| `tests/`(`@helm/tests`) | scenario, conf, fault, e2e(실제 데몬), perf | 02/AC-*, 22/FI-*, 22/CF-*, 22/PF-*, 22/RE-*, 22/NT-*, 22/NW-*, 22/WB-*, 22/EV-* | 대본 하네스(§3.8.3) |
| `ops/test/` | sys | 17/T17-22·23·26·27·28, 18/T18-08·09·14·24·29·33·34·35·44~49·52, 22/SY-*, 22/NW-04, 22/WB-01(sys 판) | bash 도우미 |

### 3.3 도구

| 용도 | 도구 | 고정 | 비고 |
|---|---|---|---|
| 테스트 실행기 | Vitest(06 §3.12.1, 5.x) | 정확한 버전 | 루트 `vitest.config.ts`의 `projects`. `resolve.conditions: ["source"]`로 소스를 바로 읽는다(06 §3.12.4) |
| 속성 기반 | fast-check | 정확한 버전 [지식: 4.x가 최신 계열, 구현 때 확인] | 10 §3.17.2. `fc.assert(…, { seed, numRuns, path })`로 재현 |
| 타입 테스트 | `tsc --noEmit`, Vitest `expectTypeOf` | | 07 I5, 19 등록 표 타입 |
| 브라우저 단위·부품 | Vitest 브라우저 모드(Playwright 구동, Chromium), Storybook 10.6 + `@storybook/addon-vitest`, `@storybook/addon-a11y` | 정확한 버전 | 21 §6.3 |
| DOM 단위 | `@testing-library/react` 16, jsdom 30, `fake-indexeddb` | 정확한 버전 | 20 §3.13.1~2 |
| 접근성 | axe-core | 정확한 버전 | §3.12.4 |
| 웹 E2E·시각 | `@playwright/test` 1.64(20 §3.13.4) + 그 판이 내려받는 Chromium·WebKit | 정확한 버전, 브라우저도 그 판에 묶임 | 기준 이미지 환경(§3.12.2) |
| 셸 E2E | WebdriverIO + `@wdio/tauri-service` 1.5.0 | 정확한 버전 | 20 §3.13.4. macOS(Mac), Windows(수동 워크플로) |
| Rust | `cargo test`(`helm-desktop-core`) | `rust-toolchain.toml` | 20 §6.1 |
| 시스템 시험 | bash(`ops/test/`), `systemd-run --user`, `systemd-analyze` | | 17 §6.2 |
| 성능 | `vitest bench`(함수 수준), 측정 스크립트(`tests/perf/*.ts`, 종단 수준) | | §3.13 |
| 커버리지 | Vitest V8 커버리지 | | §3.17.2 |
| 비밀 검사 | gitleaks(06 §3.16 verify 단계) | | 테스트 비밀 값 허용 목록(§3.6.4) |

들이지 않는 것: Jest(Vitest와 중복), Cypress(Playwright와 중복), 외부 시각 회귀 서비스(21 §2.5.8: 외부에 올리지 않음), 테스트용 Docker 컨테이너(서버에 Docker가 있지만 WSL 안 systemd·bwrap 동작을 그대로 시험해야 해서 컨테이너가 오히려 다른 환경이 된다).

### 3.4 폴더 구조와 이름 규칙

#### 3.4.1 폴더

패키지 하나(06 §3.15의 `test/`를 나눈다):

```text
packages/<이름>/test/
  unit/            *.test.ts                 단위
  property/        *.prop.test.ts            속성 기반 (+ arbitraries.ts)
  contract/        *.contract.test.ts        계약
  integration/     *.test.ts, *.slow.test.ts 통합
  fault/           *.fault.test.ts           장애 주입(같은 프로세스)
  golden/          *.golden.jsonl | *.golden.txt | *.golden.json   골든 파일
  fixtures/        입력 데이터
  regressions/     *.regression.json         속성 테스트가 줄여 낸 최소 실패 열(10 §3.17.2)
  bench/           *.bench.ts                vitest bench
```

10 §6.1의 `test/{unit,property,scripts,golden,regressions}`는 이 구조에 맞는다. `scripts/`(커널 대본 JSON)는 커널 단독 대본(helm-toy 등)이고, 유즈케이스 대본은 `tests/`에 둔다.

저장소 루트의 `tests/`(작업 공간 패키지 `@helm/tests`, `private: true`):

```text
tests/
  package.json             devDependencies: 모든 @helm/* 와 그 testing 하위 경로
  harness/
    world.ts               데몬 인스턴스 조립(엔진·저장소·런타임·리스너), 가짜 시계·ID
    runner.ts              runScenario (§3.8.3)
    steps/                 human.ts model.ts tool.ts clock.ts client.ts fault.ts until.ts
    expect.ts              Expectation 검사
    fixtures/              F-base.ts F-blog-goal.ts F-shop-goal.ts … (명령 열로 만든다, §3.6.1)
    workspaces/            합성 프로젝트 템플릿(blog, shop). 테스트마다 임시 디렉터리에 복사 + git init
    invariants.ts          장애 뒤 공통 검사(§3.9.4)
    trace.ts               추적 ID 수집
  scenarios/
    uc-01-want-inquiry.scenario.ts   UC-01의 기본·대안·예외 대본
    uc-02-cause-investigation.scenario.ts
    …                                 (02 §6의 `tests/scenarios/uc-XX-<흐름>.ts`)
    scenarios.test.ts                 모든 대본을 모드별로 돌리는 진입점
  tapes/
    authored/              손으로 쓴 테이프(대부분은 대본 안에 둔다)
    recorded/              익명 고정 과제의 녹화 테이프(15 E1)
  faults/                  *.fault.test.ts (같은 프로세스), *.kill.test.ts (자식 프로세스, test-faults)
  conformance/             listeners.test.ts adapters.test.ts fake-daemon.test.ts ssh.slow.test.ts
  e2e-real/                실제 데몬 + 앱 E2E 절차와 보조 스크립트(§3.12.6)
  perf/                    targets.ts 측정 스크립트
  trace/
    index.ts               §3.19 색인의 코드판(ID 목록, 계층, 레시피)
    manual.json            수동 시험 ID와 마지막 수행 기록
    quarantine.json        플래키 격리 목록(§3.18.1)
```

06 §3.5 의존 규칙에 `@helm/tests`를 "시험 전용" 층으로 더해야 한다(§5.2 06 요구): 모든 `@helm/*`와 `testing` 하위 경로를 devDependencies로 쓸 수 있고, 어떤 패키지도 `@helm/tests`를 의존하지 않는다.

#### 3.4.2 파일 이름과 계층

| 파일 이름 | 계층 | verify |
|---|---|---|
| `*.test.ts`(`unit/`, `integration/`) | unit, int | 넣는다 |
| `*.prop.test.ts` | prop | 넣는다(고정 시드) |
| `*.contract.test.ts` | contract | 넣는다 |
| `*.fault.test.ts` | fault(같은 프로세스) | 넣는다 |
| `*.scenario.ts` | scenario 데이터(테스트 파일이 아님) | `scenarios.test.ts`가 읽는다 |
| `*.slow.test.ts` | int·conf 중 10초를 넘는 파일 | 넣지 않는다(`just test-slow`) |
| `*.kill.test.ts` | fault(자식 프로세스) | 넣지 않는다(`just test-faults`) |
| `*.e2e.ts`, `*.visual.ts` | e2e, visual(Playwright) | 넣지 않는다 |
| `*.bench.ts` | perf | 넣지 않는다 |
| `ops/test/*.sh` | sys | 넣지 않는다(`just daemon-systest`) |
| `*.stories.tsx` + play 함수 | ui | `just ui-test`로 넣는다 |

#### 3.4.3 테스트 제목과 추적 ID

- 형식: `it("<추적 ID> [<추적 ID> …] <조건 한 줄>")`. `describe`는 모듈 이름.
  - 예: `it("10/PT-04 판단은 승격 시점에 관찰 근거·구분 확인·반증 탐색을 가졌다")`
  - 예: `it("02/AC-07-01 22/DR-1 활성 합의 없는 write는 denied.agreement_required")`
- 추적 ID = `<두 자리 문서 번호>/<그 문서의 ID>`. 그 문서 §6에 ID가 없는 단위는 이 문서가 `UT-nn`을 붙였다(§3.19). 대본은 02의 대본 ID(`UC-07/basic`)를 테스트 이름으로 쓰고 AC는 단계 기대값에 붙인다(§3.8.1 `ac` 필드).
- 문서 사이 ID 충돌: 12와 13은 둘 다 `T-SC-*`를 쓰고(스케줄러, 범위 계산), 13 `AC-01~14`(어댑터 적합성)는 02 `AC-xx-yy`와 모양이 비슷하며, 07 `C1`과 14 `C-1`이 다르다. 문서 번호를 붙이면 `12/T-SC-01`, `13/T-SC-01`, `13/AC-01`, `07/C1`, `14/C-1`로 모두 구분된다. 다른 문서의 ID를 바꾸라고 요구하지 않는다.
- 이 문서가 새로 만든 ID는 `22/` 접두사를 쓴다: `AX`(공리), `INV`(불변조건), `DR`(의존 규칙), `FI`(장애 주입), `CF`(적합성), `PF`(성능), `SY`(시스템), `ST`(정적·위생 검사), `SG`(샌드박스 밖 git), `KIT`(testkit), `E2E`(화면 흐름), `RE`(실제 데몬 E2E), `EV`(평가), `PL`(계획 검사 V-PLAN-01~07), `NT`(결과 확인 알림 설정), `NW`(내부망 차단과 외부 허용), `WB`(요청 가로채기와 taint.web), `HL`(해시라인 편집), `V02`(원전 57개 대응, 테스트 이름이 아니라 대응표의 행. 추적 검사는 V02 행의 대응 ID가 색인에 있는지만 본다).
- `just test-trace`(§3.15)는 Vitest의 JSON 보고와 Playwright·bash 시험 목록에서 제목을 모아 §3.19 색인(`tests/trace/index.ts`)과 비교한다. 색인 항목은 `{ id, layer, recipe, stage, wbs }`를 가진다(`wbs`는 그 시험을 만드는 23 WBS 행). (1) `tests/trace/done.ts`(끝난 WBS 행 ID 집합)에 든 행의 색인 ID가 어느 테스트 제목에도 없으면 실패, 끝나지 않은 행의 ID는 경고, (2) 테스트 제목의 ID가 색인에 없으면 실패(오타 방지. 색인은 M0-12에서 전체를 옮겨 두므로 마일스톤 중간에도 이 규칙이 성립한다), (3) `manual` ID는 `tests/trace/manual.json`에 수행 기록이 없으면 경고(실패 아님). 마일스톤 순서를 직선으로 보지 않고 끝난 행 집합으로 판정하므로 병렬 갈래(23)에서도 같은 규칙이 성립한다. 비교 결과를 `파일:행 ID 사유`로 출력한다.
- 22가 붙인 ID: 08·09·10·19의 `UT-nn`은 소유 문서 §6에 ID 열이 없어 이 문서가 행 순서로 붙였다. 원 문서에는 이 번호가 없다. 03·04·05의 `UT-nn`, 11의 `AQ-nn`, 20의 `DM-nn`·`IT-nn`·`MC-nn`, 21의 `TK-nn`은 소유 문서가 §6에 ID 열을 두어 그 ID를 쓴다(§5.2). 10의 `UT-nn`은 §6.2 행 순서이며, 계획 초안 행(V-PLAN)이 여덟째로 들어와 그 뒤 번호가 한 칸씩 밀렸다.

### 3.5 결정성 [제안]

#### 3.5.1 주입 대상

| 대상 | 운영에서 | 테스트에서 | 주입 지점 |
|---|---|---|---|
| 현재 시각 | `Date.now()`를 engine·스케줄러·런타임이 읽는다(커널은 읽지 않음, 06 R5) | `ManualClock`. 시작값 `2026-01-05T00:00:00Z`(월요일, 고정), 대본의 `clock` 단계로만 진행 | 저장소 `openStore({ clock })`(09 `StoreOptions.clock: Clock`), 엔진 `createEngine({ clock })`(06 §3.4.6, `() => Ms`), 클라이언트 `new HelmClient({ clock, random })`(19 `HelmClientOptions`), 런타임·스케줄러 생성자의 `clock`(12), 데몬 `world`의 공통 시계. `ManualClock`은 세 모양(`Clock` 객체, `() => Ms` 함수, 타이머 호스트)을 모두 내준다 |
| 타이머 | `setTimeout`·스케줄러 대기(최대 60초 단위, 06 F16) | 같은 `ManualClock`에 묶인 가짜 타이머. 시각을 진행하면 그 사이 만기 타이머를 순서대로 실행 | 스케줄러 `timerHost`, `@helm/client`의 재접속 백오프, 20의 깨어남 감지 |
| 커널 파생 ID | `derivedIdFactory(now, commandId)`(10 §3.1.3) | 그대로 쓴다(이미 결정적). 입력인 `commandId`를 결정적으로 만든다 | engine |
| 제출자 ID(`commandId`, 런타임·클라이언트가 만드는 레코드 ID, `tc_`, `rn_`) | ULID 생성기(08 `IdFactory`) | `fixedIdFactory(seed)`: 시각 부분은 `ManualClock`, 무작위 부분은 `seed`와 순번의 sha256 앞 10바이트 | 08 `IdFactory` 인터페이스를 받는 모든 생성자 |
| 이벤트 ID(`ev_`), seq | 저장소가 append 때 붙인다(09) | 저장소 옵션 `ids`에 같은 생성기. seq는 원래 결정적 | `openStore({ ids })`(09 `StoreOptions.ids: IdFactory`) |
| 부팅 epoch, `storeId` | 부팅마다 새 ULID(09 `boot.ts`) | 테스트 옵션으로 고정 값(`ep_test_1`, `st_test_1` 꼴의 유효 ULID) | `openStore({ testing: { bootEpoch, storeId, allowTmpfs } })`(09에 요구. `StoreOptions`에 테스트 전용 묶음 하나로 둔다. `faultInjector`도 이 묶음으로 옮기면 운영 경로에서 쓰지 않음을 타입으로 확인할 수 있다) |
| 난수 | 자극 섞기 seed(15 `rng.ts`), 백오프 지터(19), 페어링 코드(18), 토큰 | `seededRandom(seed)`. 보안 난수(토큰·코드)는 테스트에서도 `crypto`를 쓰되 값이 이벤트에 들어가지 않으므로 결정성에 영향이 없다. 들어가면 해시만 들어간다(18) | 15 `rng.ts`, 19 `HelmClientOptions.random` |
| HMAC 키 | `HELM_LEDGER_HMAC_KEY`(SecretStore, 결정 45) | 고정 테스트 키 `test-hmac-key-0001`(가짜 값, §3.6.4) | `SecretStore` 테스트 구현 |
| 경로 | `/srv/volumes/helm/…`, `~/projects/<제품>` | 테스트마다 `tempDir()` 아래. 프로젝트 루트도 임시 디렉터리의 합성 작업 공간 | 설정 `HELM_ROOT`, 프로젝트 등록 명령 |
| 환경 변수 | 데몬 환경 | 테스트 공통 준비가 `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`를 임시 디렉터리로 바꾸고 `*_API_KEY`, `HELM_*`(허용 목록 밖), `SSH_AUTH_SOCK`을 지운다 | Vitest `globalSetup`, `setupFiles` |
| 시간대·로케일 | 기기 시간대(CX-05) | `TZ=UTC`, `LANG=C.UTF-8`을 기본으로 두고, 표시 시험은 `Asia/Seoul`·`America/Los_Angeles`를 명시해 돈다 | `setupFiles`, 21 `lib/time.ts`의 시간대 인자 |
| 모델 응답 | 실제 제공자 | 모델 테이프(§3.5.4) | `ModelGateway`(12 §3.3.2)의 테스트 구현 |
| 도구 실행 | 실제 파일 시스템·프로세스 | `runtime` 모드: 임시 작업 공간에서 실제 read·write·edit·ls·grep·find 실행, bash는 샌드박스가 있으면 샌드박스로, 없으면 대본이 정한 `FakeToolExecutor` 결과. `kernel` 모드: `FakeToolExecutor`만 | 13 도구 레지스트리의 실행기 교체 지점 |
| 네트워크 | 모델 API, `web_fetch` | 공통 준비가 `globalThis.fetch`와 `undici` 전역 디스패처를 루프백 외 주소에 대해 예외를 던지게 바꾼다. 웹 읽기 도구는 가짜 응답 표를 쓴다 | `setupFiles` |
| 프로세스 정보 | pid, 프로세스 시작 시각(고아 판정, 06 F12) | 자식 프로세스 시험에서만 실제 값. 같은 프로세스 시험에서는 가짜 `ProcessInfo` | 12·13의 `orphans` 모듈 |

금지: 테스트 안의 실제 시간 대기(`sleep`, 실제 `setTimeout`으로 결과 기다리기). 실제 시간이 필요한 것은 자식 프로세스 시험(`*.kill.test.ts`, `*.slow.test.ts`)과 `sys`·`e2e`·`perf`뿐이고, 그때도 고정 지연 대신 조건 대기(폴링 + 상한)를 쓴다. ESLint 규칙으로 `test/unit/**`, `test/property/**`, `tests/scenarios/**`에서 `setTimeout`·`Date.now`·`Math.random` 직접 사용을 막는다(§6 22/ST-02).

#### 3.5.2 `@helm/testkit` 공개 API (06 §3.4.14, `domain`에만 의존)

```ts
// packages/testkit/src/index.ts
import type { Ms, IdFactory, IdPrefix, IdOf } from '@helm/domain';

export type TimerHandle = number;

/** 손으로만 움직이는 시계. 타이머 호스트를 겸한다.
 *  09 `Clock`(객체), 06 `createEngine`·19 `HelmClientOptions`의 `() => Ms` 함수 모양을 모두 내준다 */
export interface ManualClock {
  now(): Ms;
  /** `createEngine({ clock: c.fn })`, `new HelmClient({ clock: c.fn })`에 넣는 함수 모양 */
  readonly fn: () => Ms;
  /** 지정한 만큼 진행하며, 그 사이 만기 타이머를 만기 시각 순서로 실행한다. 같은 시각이면 등록 순서 */
  advance(ms: number): Promise<void>;
  /** 절대 시각으로 이동. 과거로 가는 것도 허용(시계 점프 시험, 12 T-SC-04, 17 T17-19) */
  set(at: Ms): Promise<void>;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  pendingTimers(): readonly { at: Ms; label?: string }[];
}
export function manualClock(start?: Ms): ManualClock;          // 기본 2026-01-05T00:00:00Z

/** 08 IdFactory 구현. ULID 시각 부분 = clock.now(), 무작위 부분 = sha256(`${seed}:${prefix}:${n}`) 앞 10바이트 */
export function fixedIdFactory(clock: Pick<ManualClock, 'now'>, seed?: string): IdFactory;

/** xorshift128+ 계열. 같은 seed → 같은 열 */
export function seededRandom(seed: string | number): () => number;

/** 임시 디렉터리. 테스트가 끝나면 지운다. keepOnFail이면 실패 시 남기고 경로를 출력한다 */
export function tempDir(opts?: { prefix?: string; keepOnFail?: boolean }): Promise<TempDir>;
export interface TempDir { path: string; join(...p: string[]): string; cleanup(): Promise<void> }

/** HOME·XDG_*·TMPDIR를 임시로 바꾸고 비밀 환경 변수를 지운 상태에서 fn을 실행한다 */
export function withIsolatedEnv<T>(fn: () => Promise<T>, extra?: Record<string, string>): Promise<T>;

/** 운영 경로·운영 소켓 사용 방지: 경로가 운영 데이터 디렉터리이거나 그 아래면 throw */
export function assertNotProduction(path: string): void;

/** 이벤트 비교 */
export function normalizeEvents(events: readonly unknown[], level: 'strict' | 'semantic'): unknown[];
export function eventDigest(events: readonly unknown[]): string;   // 정규화 JSON(09 canonicalJson과 같은 규칙)의 sha256
export function diffEvents(a: readonly unknown[], b: readonly unknown[]): string;  // 사람이 읽는 차이

/** 골든 파일 비교. 갱신은 HELM_GOLDEN_UPDATE=1 일 때만(just test-golden-update) */
export function expectGolden(actual: string, goldenPath: string): void;
```

- `testkit`이 `domain`보다 위를 알면 순환이 생기므로(06 §3.4.14) 정규화는 이벤트를 구조 없는 JSON으로 다룬다. 이벤트 타입별 의미 필드 목록은 `@helm/domain`의 `EVENT_META`(09 §6.1)에서 받아 쓴다.

#### 3.5.3 "같은 입력이면 같은 이벤트 로그"의 비교

| 수준 | 비교하는 것 | 빼는 것 | 쓰는 곳 |
|---|---|---|---|
| strict(D0) | 이벤트 envelope 전체의 정규화 JSON(seq, `ev_` ID, 시각, 해시 체인, payload, provenance) | 없음 | 같은 대본을 같은 모드로 두 번 돌린 결과(14 C-16, 15 T-01, 10 PT-01·02), 골든 이벤트 열(10 §6.1 `golden/`), 재구성 동등(09 투영기 (2)) |
| semantic(D1) | 이벤트 타입, 행위자 종류(`human`, `agent:<role>`, `runtime`…), 대상 레코드의 종류와 대본 안 별칭, payload의 의미 필드(09 `EVENT_META`의 `semanticFields`), 이벤트 순서 | `ev_` ID와 seq 절댓값, 시각, 해시, `provenance`(어댑터 ID, 리스너, 연결 ID), `via.connectionId`, 대본 밖에서 생긴 ID의 실제 값 | 리스너 동등성(§3.10.1), 어댑터 적합성(13 AC-12, 10 §3.18.4, 02 AC-17-04), `kernel` 모드와 `runtime` 모드 결과 비교, 원전 57개 중 전송 독립 시험(V02-13) |

- ID 별칭: semantic 비교는 레코드 ID를 처음 나온 순서대로 `<prefix>#1`, `<prefix>#2`로 바꾼 뒤 비교한다. 두 실행에서 레코드가 같은 순서로 생기면 별칭이 같다.
- 의미 필드 목록이 없는 이벤트 타입이 있으면 semantic 비교는 그 이벤트의 payload 전체를 비교한다(빠뜨려서 통과하는 일을 막는다). 09 `meta.ts`에 `semanticFields`(또는 반대로 `nonSemanticFields`)를 두도록 요구한다(§5.2).
- 휘발 이벤트(09 §3.5, 19 `stream.chunk`)는 비교하지 않는다. 대신 휘발 스트림 시험(19 UT-14, 20 IT-11)이 따로 본다.

#### 3.5.4 모델 테이프 [제안]

**형식** `helm.model-tape.v1`(JSONL, 한 줄에 객체 하나). 대본 안의 `model` 단계도 실행 전에 이 형식으로 바뀐다.

```ts
// packages/ai/src/testing/tape.ts  (@helm/ai/testing)
import type { ContentBlock, StopReason, Usage } from '@helm/domain/model';   // 07 §3.9.2, 08이 이름 확정
import type { ModelRole, AiError } from '../gateway.js';                     // 12 §3.3.2

export interface ModelTapeHeader {
  kind: 'header';
  format: 'helm.model-tape.v1';
  tapeId: string;                        // 예: "UC-07/basic"
  origin: 'authored' | 'recorded';
  recordedFrom?: { provider: string; model: string; piAi: string; at: string };  // recorded일 때. at은 ISO
  matching: 'role-queue' | 'context-hash';
  allowLeftover?: boolean;               // 끝났을 때 남은 응답 허용(기본 false)
}

export interface ModelTapeTurn {
  kind: 'turn';
  n: number;                             // 테이프 안 순번(1부터)
  role: ModelRole;                       // 'work' | 'verifier' | 'router' | 'summarizer' | 'subcall' | 'branch' | 'observer' …
  call: 'stream' | 'complete';           // streamFor(루프) | complete(도구 없는 단일 호출, 15 ModelPort.call)
  match?: {
    contextHash?: string;                // 12 투영의 bytesHash(T-PJ-01). matching='context-hash'일 때 필수
    memoKey?: string;                    // complete의 memoKey(12 §3.15)
    modelFamily?: 'faux-a' | 'faux-b';   // 다른 계열 요구 시험(12 T-AI-01, 15 T-04)
  };
  response:
    | { type: 'message'; content: ContentBlock[]; stopReason: StopReason; usage?: Partial<Usage> }
    | { type: 'structured'; value: unknown; usage?: Partial<Usage> }   // complete + outputSchema
    | { type: 'error'; error: AiError; afterContent?: ContentBlock[] } // 콘텐츠 전·후 오류(12 T-AI-03)
    | { type: 'stall' };                                               // 취소·시간 초과까지 응답 없음
  stream?: { chunks: number; chunkDelayMs?: number };   // 휘발 스트림 시험. 지연은 ManualClock 기준
  label?: string;                        // 사람이 읽는 설명. 비교에 쓰지 않는다
}
export type ModelTapeLine = ModelTapeHeader | ModelTapeTurn;

export interface ModelTape { readonly header: ModelTapeHeader; readonly turns: readonly ModelTapeTurn[] }
/** 테이프 재생기가 쓰는 시계 모양. `@helm/ai/testing`은 testkit에 의존하지 않으므로(06 R3: testkit은 테스트 파일에서만)
 *  구조 타입으로 받는다. testkit `ManualClock`이 이 모양을 만족한다 */
export interface TapeClock { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(h: number): void }

export function loadTape(path: string): ModelTape;
export function tape(id: string, turns: Omit<ModelTapeTurn, 'kind' | 'n'>[], opts?: Partial<ModelTapeHeader>): ModelTape;
/** 12 ModelGateway의 테스트 구현. resolve()는 가짜 모델 표를, streamFor()·complete()는 테이프를 쓴다 */
export function tapeGateway(t: ModelTape, opts: { clock: TapeClock; strict?: boolean }): ModelGateway & TapeControl;
export interface TapeControl { remaining(): number; consumed(): readonly ModelTapeTurn[]; assertExhausted(): void }
/** 실제 게이트웨이를 감싸 녹화한다. just eval-* 에서만 쓴다 */
export function recordingGateway(real: ModelGateway, sink: (line: ModelTapeLine) => void): ModelGateway;
/** 도우미: fauxText·fauxToolCall과 같은 모양을 @helm/domain/model 타입으로 */
export const t: { text(s: string): ContentBlock; toolCall(name: string, args: unknown, id: string): ContentBlock; thinking(s: string): ContentBlock };
```

**재생 규칙**

1. 가짜 모델 표: `faux-a/work`, `faux-a/verifier`, `faux-b/work`, `faux-b/verifier`, `faux-a/summarizer`, `faux-a/subcall`, `faux-a/router`, `faux-a/observer`. provider `"faux"`, `api: "faux:helm"`(실행마다 같음, 07 C17). 이미지 입력 가능 여부, 컨텍스트 창, 가격(예산 시험용으로 0이 아닌 값)을 표에 둔다. pi-ai `fauxProvider({ api: 'faux:helm', models })`를 만들고 응답 함수(`FauxResponseFactory`)에서 테이프를 읽는다(pi-api-facts-1 §2.10 [원문]).
2. `role-queue`: 역할별 대기열에서 순서대로 꺼낸다. 요청 역할의 대기열이 비면 테스트를 실패시킨다(pi faux의 기본 동작인 오류 메시지 응답 `"No more faux responses queued"`를 쓰지 않는다. 그 응답은 런타임이 모델 오류로 처리해 테스트가 엉뚱한 경로로 계속되기 때문이다).
3. `context-hash`: 차례가 온 응답의 `contextHash`와 실제 투영의 `bytesHash`가 다르면 실패하고 두 투영의 차이를 출력한다. 녹화 테이프(15 E1 재생 결정성)에 쓴다. 투영 규칙을 바꾸면 녹화 테이프가 실패하므로 다시 녹화하거나 `role-queue`로 낮춘 손 테이프로 바꾼다.
4. 테이프 끝에서 남은 응답이 있으면 `assertExhausted()`가 실패한다(`allowLeftover` 제외). 대본이 의도한 모델 호출 수를 확인하는 효과가 있다.
5. 도구 호출 ID: 테이프의 `toolCall(name, args, id)`에 준 ID가 pi 도구 호출 ID가 된다. Helm의 `tc_` ID는 런타임의 ID 생성기(`fixedIdFactory`)가 만든다. 대본은 `toolCallRef`(테이프의 ID)로 도구 결과를 가리킨다.
6. `stall`: 런타임이 취소하거나 시간 초과를 내기 전까지 스트림을 열어 둔다. `ManualClock`을 진행해 시간 초과를 일으킨다(12 T-IN-03, UC-10 B4).
7. 사용량: `usage`가 없으면 pi faux 추정(글자 수/4)을 쓰고 비용은 가짜 모델 표의 가격으로 계산한다(pi faux 자체 비용은 0 [원문 faux.ts:281]).

**녹화**

- `recordingGateway`는 `just eval-*`(§3.14)에서 `--record <경로>`를 줄 때만 쓴다. 녹화 파일은 평가 데이터 디렉터리(`/srv/volumes/helm/eval/<날짜>/tapes/`)에 쓴다.
- 저장소의 `tests/tapes/recorded/`로 옮길 수 있는 것은 익명 고정 과제(15 §3.15.1, E2의 10개)의 녹화뿐이다. 옮길 때 `just tape-promote <파일>`이 (1) 비밀 패턴(18 §3.10.4, 16 MK-01~13), (2) 홈 디렉터리 절대 경로, (3) 실제 사용자 이름을 검사하고 하나라도 있으면 거부한다. 개인 과제(E0)의 녹화는 저장소에 넣지 않는다(15 §3.15.1).
- 녹화 테이프의 헤더에 모델·pi-ai 판을 남긴다. pi-ai를 올리면(07 §3.18.4) 녹화 테이프를 재생해 스키마 실패가 없는지 본다.

**대본에 넣지 않는 것**: 모델 문장의 품질. 런타임 재생 테스트의 기대값은 이벤트 로그(타입과 핵심 필드)이며 모델 문장을 비교하지 않는다(10 §3.17.3).

#### 3.5.5 비결정 요소가 남는 곳

| 곳 | 이유 | 처리 |
|---|---|---|
| 자식 프로세스 시험(SIGKILL 시점, 17 통합 시험) | OS 스케줄링 | 종료 지점을 이름으로 고정(§3.9.2). 기대값은 "불변조건 성립"이지 특정 이벤트 열이 아니다(D1) |
| bash 실제 실행(샌드박스) | 프로세스 출력 순서, 실행 시간 | 출력은 정렬·정규화한 뒤 비교하거나 종료 코드·파일 결과만 본다 |
| 브라우저 렌더링 | 글꼴 래스터화, GPU | 기준 이미지 환경 고정(§3.12.2), 허용 차이 2% |
| better-sqlite3 성능 | 디스크, 다른 서비스 부하 | `perf`만 영향. verify에 넣지 않는다 |
| 보안 난수(토큰, 페어링 코드) | 보안상 고정하지 않음 | 값이 이벤트에 들어가지 않으므로 이벤트 비교에 영향 없음. 들어가면 18의 결함 |

### 3.6 픽스처와 테스트 데이터

#### 3.6.1 상태 픽스처 (02 §2.7)

픽스처는 하네스가 명령을 실행해 만든다. 이벤트를 손으로 쓰지 않는다(D22-9).

| 픽스처 | 만드는 방법 | 결과 상태 |
|---|---|---|
| `F-base` | 하네스 `world` 생성 → 페어링 두 번(`dv_mac`, `dv_win` 별칭, 18 페어링 명령) → 프로젝트 등록 두 번(`blog`, `shop`; 경로는 임시 작업 공간) → 각 프로젝트에 Goal 초안 제안(모델 테이프) + 사람 확정 | 기기 2, 프로젝트 2, Goal v1 각 1 |
| `F-blog-goal` | `F-base`의 blog Goal 문장을 "개인 블로그를 꾸준히 운영한다"로 | |
| `F-shop-goal` | shop Goal "개인 쇼핑몰 데모를 포트폴리오로 쓸 만한 품질로 만든다" | |
| `F-model-faux` | 테이프 재생기 연결(§3.5.4). 대본마다 자기 테이프 | |
| `F-model-live` | 실제 모델. 대본 테스트에서 쓰지 않는다. `just eval-*`와 실사용 기록 전용 | |
| `F-events-1k` (22 추가) | 무작위가 아닌 생성기(`seed=1k`)로 Concern 5개, 질문·합의·결과 확인이 섞인 이벤트 1,000개를 명령으로 만든다 | AC-06-02 복귀 요약 성능 |
| `F-events-50k-day` (22 추가) | 하루 이벤트 50,000개(01 NFR-U-3) | 성능(§3.13) |
| `F-events-1.8m` (22 추가) | 09 §3.15.2의 full 검사·재구성 180만 건. 명령 대신 저장소 쓰기 API로 대량 생성(성능 전용, 의미 검사 없음) | `just perf-seed`가 `/srv/volumes/helm/test-scratch/perf/`에 만든다. 커밋하지 않는다 |
| `F-garbage-legacy` (22 추가) | 원전 `legacy-decision-line-99.json`(요지 `ㅇ`)을 09 §3.13.4 가져오기로 넣은 상태 | V02-03, AC-06-07, AC-07-14 |

합성 작업 공간(`tests/harness/workspaces/`):

- `blog/`: 마크다운 글 5개, `drafts/` 디렉터리. 원함 탐구 대본(UC-01)의 쓰기 대상.
- `shop/`: 작은 React 앱 흉내(파일 20개 안팎, 실제 빌드는 하지 않음), `package.json`의 `test` 스크립트는 고정 출력을 내는 셸 스크립트. 원인 조사·C/A 대본(UC-02, UC-07)이 쓴다. 실제 측정 도구 대신 고정 출력 스크립트(`scripts/measure.sh`)를 둔다.
- 테스트마다 임시 디렉터리에 복사하고 `git init` + 첫 커밋을 한다(작성자·시각을 환경 변수로 고정: `GIT_AUTHOR_DATE` 등). 되돌릴 지점(13 T-RB), 변경 감지(13 T-CD), 해시 기반 낡음(AC-13-01)이 이 저장소를 쓴다.

#### 3.6.2 골든 파일

| 종류 | 위치 | 갱신 |
|---|---|---|
| 커널 대본 기대 이벤트 열 | `packages/kernel/test/golden/*.golden.jsonl` | `just test-golden-update` 후 사람이 `git diff`로 검토 |
| 유즈케이스 대본 이벤트 열(strict) | `tests/scenarios/golden/<대본>.golden.jsonl` | 같음 |
| 화면 뷰 표본(FakeDaemon·앱 시험용) | `apps/desktop/test/fixtures/views/*.json`(20 §3.13.2) | 같음. `protocol` 모드 대본이 `view.get` 결과를 비교하므로 데몬 투영이 바뀌면 verify가 실패하고, 갱신하면 앱 고정 데이터도 함께 바뀐다(§3.12.6) |
| 선형 텍스트 | `apps/desktop/src/ui/**/__golden__/*.txt`(21 §6.3), 화면별(04 UT-14) | 같음 |
| 도구 스키마 스냅숏 | `packages/tools/test/golden/`(13 T-HT-01) | 같음 |
| 변환 스냅숏 | `packages/ai/test/golden/`(07 C23·C24, 12 T-PJ-07) | 같음 |
| 탐구 엔진 번역 | `packages/runtime/test/golden/translate/`(15 T-23) | 같음 |
| 지표 골든 | `packages/observer/test/fixtures/helm-events/*.jsonl` + 기대 값 JSON(16 OB-T21·22) | 같음 |

규칙:

- verify는 골든을 고치지 않는다. `HELM_GOLDEN_UPDATE=1`은 `just test-golden-update`만 설정한다.
- 골든 파일은 사람이 읽을 수 있게 한 줄에 이벤트 하나, 키 정렬, 들여쓰기 없음(diff가 줄 단위로 보이게).
- 골든 갱신 커밋은 코드 변경과 같은 커밋에 넣고 커밋 메시지에 갱신 이유를 한 줄 적는다.

#### 3.6.3 합성 외부 로그 (16 §6.1 `test/fixtures/`)

- 구조는 각 런타임의 실제 키 구조를 따르되(16 §3.6, 1단계에서 키 구조만 확인), 본문은 모두 합성 문장이다. 실제 홈 디렉터리(`~/.claude`, `~/.codex`, `~/.pi`)의 파일을 복사하지 않는다.
- 경로는 `/home/tester/…`, `/work/blog` 같은 자리표시 경로만 쓴다.
- 비밀 픽스처(`fixtures/secrets.txt`)의 값은 형식만 맞춘 가짜 값이고 접두사 `HELM-FAKE`를 포함한다(gitleaks 허용 목록이 이 접두사만 허용, §3.6.4).
- 강제 방법: (1) 모든 테스트가 임시 `HOME`으로 돈다(§3.5.1). (2) 관찰 어댑터는 루트를 인자로만 받고 기본값으로 `os.homedir()`를 읽지 않는다(16 요구, §5.2). (3) `22/ST-03` 정적 검사: `**/test/fixtures/**`, `tests/**`에 실제 사용자 이름(`process.env.USER`가 아니라 고정 목록: 저장소 설정 `tests/trace/forbidden-strings.txt`, 커밋하지 않는 로컬 파일)과 `/home/<실제 이름>`이 나오면 실패.

#### 3.6.4 테스트 비밀

| 항목 | 값 | 규칙 |
|---|---|---|
| 모델 키 | `sk-test-HELM-FAKE-0000000000000000` 꼴 | 테스트 `SecretStore`에만 넣는다. 테스트는 `.env`를 읽지 않고 `secrets run`을 쓰지 않는다 |
| HMAC 키 | `test-hmac-key-0001`(이전 키 시험용 `…0000`) | 09 §3.10.3 다중 키 시험 |
| 기기 토큰 | 테스트 페어링이 발급한 값 | 실제 기기 토큰을 쓰지 않는다 |
| 비밀 카나리아 | `HELM-CANARY-<테스트 ID 해시>` | §3.11.2 |

- gitleaks 설정에 `HELM-FAKE`, `HELM-CANARY` 접두사 허용을 둔다. 그 밖의 비밀 형태 문자열이 테스트 데이터에 있으면 verify의 gitleaks 단계가 실패한다.
- 실제 모델 키가 필요한 것은 `eval`·`e2e-real`(테이프 대신 실제 모델을 쓰는 선택)뿐이며 레시피가 `secrets run`으로 자식 프로세스에만 넣는다(브리프 §2.5).

#### 3.6.5 큰 데이터와 임시 저장 위치

- 테스트 임시 디렉터리 기본값은 `os.tmpdir()`다. 저장소 시험은 실제 파일 시스템 동작이 필요하므로, `testkit`이 `statfs`로 tmpfs 여부를 확인해 tmpfs면 `HELM_TEST_SCRATCH`(기본 `/srv/volumes/helm/test-scratch`)를 쓴다. 17 T17-05의 tmpfs 거부 규칙은 운영 경로 검사이므로 테스트 저장소는 `allowTmpfs` 옵션을 명시해 연다(테스트 전용 옵션, 17·09에 요구).
- `/srv/volumes/helm/test-scratch/`는 백업 제외 목록에 넣는다(17·홈랩 H-3 제외 목록에 한 줄 요구).
- 성능 데이터(`F-events-1.8m` 등)와 E2E 데몬 데이터(`/srv/volumes/helm/e2e/`)는 생성물이며 커밋하지 않는다. `just test-clean`이 지운다.
- 운영 데이터 디렉터리(`/srv/volumes/helm/data`)와 운영 소켓(`/run/user/1000/helm/`)은 `assertNotProduction`이 막는다(D22-16).

### 3.7 커널 테스트

커널 테스트의 내용(무엇을 보장해야 하는가)은 10 §3.17이 정한다. 이 절은 실행 방식과 다른 문서·원천과의 대응을 정한다.

#### 3.7.1 단위

- 10 §3.17.1 그대로: 명령마다 정상 1건과 공통 거부(채널·능력·스키마), 명령별 거부 코드마다 1건. 규칙(V-*)마다 통과·실패. 파생 R-1~R-12. 순수성(`deepFreeze` 입력, 두 번 호출 결과 동등).
- 위치: `packages/kernel/test/unit/<영역>/*.test.ts`. 영역은 10 §6.1의 `src/` 하위 폴더 이름을 따른다(`commands/`, `rules/`, `policy/`, `asking/`, `apply/`, `react/`, `queries/`).
- 08 §6의 데이터(`constraints.ts`의 R-01~R-55, `machines/*.ts`)는 커널 테스트가 표를 읽어 사례를 만든다. 표에 행을 더하면 시험 사례가 따라 늘어난다(대화 X3-8-25 "명세를 실행 가능한 데이터로").
- 커널 단위 테스트는 저장소를 쓰지 않는다. 상태는 빈 상태에서 명령을 `decide` → `apply`로 접어 만든다(`packages/kernel/test/support/build-state.ts`).

#### 3.7.2 속성 테스트 운용

| 항목 | `just test`(verify) | `just test-deep` |
|---|---|---|
| 시드 | `packages/kernel/test/property/seeds.json`의 고정 시드 20개 | 시각 기반 새 시드 100개 + 고정 시드 20개 |
| 열 길이 | 1~200(10 §3.17.2) | 1~200, 일부 실행은 1~1,000 |
| fast-check `numRuns` | 시드당 1(열 하나가 실행 하나) | 시드당 1 |
| 실패 시 | 실패 열을 줄인 결과와 시드를 출력하고 실패 | 같음 + 줄인 열을 `test/regressions/<PT>-<시드>.regression.json`으로 저장. 사람이 원인을 고친 뒤 회귀 파일을 커밋한다 |
| 회귀 파일 | 모두 재생(verify에 포함) | 같음 |

- 대상 속성: 10 PT-01~PT-19. 그 밖의 속성 테스트도 같은 운용을 따른다: 08 UT-01(ID 1만 개 정렬), 09 UT-14(투영 증분 = 재구성), 12 T-PJ-04(필수 범주 포함), 14 C-4·C-8·C-12·C-18, 16 OB-T06, 19 UT-18(이벤트 구독 합집합)·UT-19(VIEW-01).
- 생성기 공유: 제출 열 생성기(10 §3.17.2의 1~5)는 `packages/kernel/test/property/arbitraries.ts`에 두고 14의 오케스트레이션 속성 테스트도 같은 파일을 import한다(같은 패키지 안 테스트).
- 시드 실행 시간 목표: PT 전체가 verify에서 60초 이하. 넘으면 시드 수를 줄이지 않고 생성기 비용을 먼저 줄인다.

#### 3.7.3 공리 A1~A15 위반 테스트 대응표

10 §3.15 표의 "위반 테스트" 칸을 테스트 ID로 옮긴다. 보장 수준(G1~G4)은 10의 정의다. 위치의 기본은 `packages/kernel/test/unit/axioms/aNN-*.test.ts`이고, 다른 패키지에 있는 것은 따로 적었다.

| ID | 공리 | 위반 시도 → 기대 결과 | 보장 | 위치·계층 | 함께 보는 ID |
|---|---|---|---|---|---|
| 22/AX-01 | A1 목적이 태스크보다 먼저 | (a) Goal 없는 Concern 생성 → `invalid.goal_link`(10 §3.4.4 코드가 정본. 08 E-02의 `not_found.goal`은 08에 맞춤 요구) (b) Goal이 `retired`·`superseded`인 Concern의 합의로 쓰기 → `policy.goal_not_active`(판정 J-130, V-POL-02의 Goal 상태 조건) (c) Concern 없는 `workunit.propose` → 거부(원전 존재론 1) | G1 | kernel unit | 08 R-01, AC-15-03 |
| 22/AX-02 | A2 진척은 정당화된 상태 변화 | (a) 근거 없는 `met` 기준 → `downgraded.criterion_unverified` 알림 (b) 근거 없는 승격 → `policy.promotion_requirements` | G2 | kernel unit | AC-07-04, AC-02-03, helm-toy n3·n17 |
| 22/AX-03 | A3 문제 정의는 작업 결과의 일부 | (a) `concern.reframe` 뒤 이전 프레임 이벤트가 남아 있음 (b) 처음 요청이 `statement`로만 기록되고 프레임 필드로 자동 복사되지 않음 | G2 | kernel unit | |
| 22/AX-04 | A4 병렬성은 가설 다양성에 먼저 | 같은 가지의 추측 두 개가 서로를 근거로 승격 → V-PRO-02 거부 | G2 | kernel unit | 15 T-04, 15 T-06 |
| 22/AX-05 | A5 사실·추론·가설·결정·약속 구분 | (a) 모델이 지어낸 관찰 ID로 근거 연결 → `invalid.evidence_not_found` (b) 모델이 `observation.record` → `denied.capability` (c) 관찰 참조 없는 해석 → 전제로 기록 | G1/G2 | kernel unit | AC-02-01, helm-toy n4·n5 |
| 22/AX-06 | A6 사람이 최종 약속의 저자 | (a) 작업 에이전트가 `result.accept`·`choice.commit`·`goal.revision.confirm`·`agreement.confirm` → 거부 (b) 모델 채널로 `human` 행위자 제출 → `denied.channel` (c) 모델 도구 목록에 사람 전용 명령 도구가 없음 | G1 | kernel unit + tools unit(13 T-HT-04) | 10 PT-05, AC-07-05, helm-toy n19, T18-19 |
| 22/AX-07 | A7 자율성은 위험 적응적 권한 범위 | (a) 범위 밖 쓰기 → `needs_gate`(`gate.scope_expansion_required`) (b) 권리 게이트 발송을 승인 없이 → needs_gate (b') 합의 `Scope.sendTargets` 안의 send, Grant로 활성된 합의 아래의 send도 승인 없이 → needs_gate. MVP 커널은 `sendTargets`를 읽지 않는다(판정 J-91, 01 NFR-S-7) (c) 확대된 합의를 부여로 활성화 → needs_gate (d) 사전 가로채기가 없는 어댑터의 쓰기는 `advisory`·`post_hoc`로 표시 | G1 / 낮아짐 | kernel unit + runtime adapter conf + scenario(UC-07/send-in-scope) | AC-07-02, AC-03-09, 13 AC-06, 13 T-AD-03, 10 UT-10(권한 fixture 5개) |
| 22/AX-08 | A8 결정은 낮은 수준에서, 예외만 상향 | (a) `why_not_asked` 없는 혼자 정한 결정 → 거부 (b) 권리 범주 없고 결과 차이 none인 결정을 질문으로 만들면 혼자 정한 결정이 된다 | G2 | kernel unit(asking) | 11 AQ-01, AC-05-01, 10 PT-08 |
| 22/AX-09 | A9 요약은 결정에 필요한 차이를 보존 | 열린 반대 근거가 있는 Concern의 투영에서 그 ID를 빼면 투영 생성이 실패(fail-closed) | G2 | runtime unit | 12 T-PJ-04·T-PJ-05·T-CP-02, AC-06-05 |
| 22/AX-10 | A10 완료 주장·수락·통합 구분 | (a) 반영 항목이 남은 Concern 닫기 → `policy.obligations_open` (b) 에이전트의 결과 확인 → 거부 (c) 결과 제출만으로 `integrated`가 되지 않음 | G1 | kernel unit | 10 PT-07·PT-16, AC-07-07, AC-07-11 |
| 22/AX-11 | A11 컨텍스트는 시점별 투영 | (a) `contextRef` 없는 모델 제출 → 거부(V-FORM-06) (b) 판단 이벤트에서 그때 본 투영(`run.context_projected`)을 찾을 수 있음 | G1 | kernel unit + scenario(UC-02/basic) | 12 T-PJ-01 |
| 22/AX-12 | A12 자동화가 이해를 낮추면 실패 | 커널 집행 없음(G4). 측정 재료가 이벤트로 남는지만 본다: 사람 결정 이벤트(16 사실 `human_op`, 정상 경로는 이벤트 종류로 계산, 판정 J-76), 질문 수, 이의 수, `brief.acknowledged` | G4 | observer unit | 16 OB-T21, OB-T22, OB-T23 |
| 22/AX-13 | A13 결정과 증거는 낡는다 | (a) 근거 파일 해시가 바뀌면 판단이 `stale` (b) stale 근거로 승격 → 거부 (c) 다시 볼 조건 충족 → `record.staled` + `concern.reopened` | G1/G2 | kernel unit + scenario(UC-13/basic) | AC-13-01~04, 10 PT-12 |
| 22/AX-14 | A14 실패와 이견은 학습 신호 | (a) 거부된 제출 뒤 로그에 `command.rejected`가 있음(J-25) (b) 실패한 도구 결과도 관찰로 남음 (c) 이벤트 삭제·수정 경로가 없음(09 트리거) | G1 | kernel unit + store int | 09 UT-10(트리거), helm-toy 전체 |
| 22/AX-15 | A15 상호작용은 공동 저작 | (a) 형식별 필수 선택지(결정점: 기준 수정·질문 재구성·먼저 실험·연기·범위 줄이기)를 빠뜨린 질문 종류는 레지스트리 적재에서 거부되고(11 AQ-17), 적재된 종류로 만든 질문은 언제나 그 묶음을 가진다(출력 검사, V-Q-02). 질문 하나의 선택지를 제출자가 빼는 입력은 명령 스키마에 없으므로 만들 수 없다 (b) "계속할까요" 형식, 원함 탐구의 하나 고르기 질문, I.want에서 답이 자극·가능성 id를 가리키는 질문 → 거부(V-Q-03, 판정 J-141) (c) 방향 수정 명령(`concern.reframe`, `agreement.renegotiate`, `dial.set`)이 모든 상태에서 열려 있음(원전 통치 8) | G3 | kernel unit + ui | 11 AQ-03·AQ-17, 15 T-24, §3.12.5 |

#### 3.7.4 불변조건 1~7 대응표

브리프 결정 17(v0.3 불변조건 1~7)은 어떤 모드·다이얼에서도 바뀌지 않는다. 불변조건마다 사후 검사(V-INV, 10 §3.16.3)를 일부러 깨는 시험과 속성 테스트를 둔다. "다이얼 무관" 열은 같은 시험을 다이얼 조합(14 C-10의 층 표에서 고른 극값 조합 8개)마다 반복한다는 뜻이다.

| ID | 불변조건 | 사후 검사 | 속성 | 다이얼 무관 시험 |
|---|---|---|---|---|
| 22/INV-1 | 기록과 진실은 다르다 | V-INV-01 | PT-14 | 예 |
| 22/INV-2 | 관찰·추측·판단·선택은 다르다 | V-INV-02, V-INV-07 | PT-04, PT-05, PT-08 | 예 |
| 22/INV-3 | 투영은 정본을 쓰지 않는다 | V-INV-03 | PT-10 | 예 |
| 22/INV-4 | 권한은 범위를 가진다 | V-INV-04 | PT-06, PT-15 | 예 |
| 22/INV-5 | 완료 주장·결과 확인·전체 반영은 다르다 | V-INV-05, V-INV-10 | PT-07, PT-16 | 예 |
| 22/INV-6 | 모르는 것·이견·낡은 상태를 숨기지 않는다 | V-INV-06 | PT-12 | 예 |
| 22/INV-7 | 혼자 정한 결정도 기록되며 이의를 걸 수 있다 | V-INV-07 | PT-08, PT-13 | 예 |

- 사후 검사 시험은 10 §6.2 "사후 검사" 행처럼, 불변조건을 깨는 초안을 만드는 가짜 명령 스펙을 규칙 묶음에 넣어 `kernel.invariant_violation`과 커밋 없음(`status: 'error'`)을 확인한다.
- "다이얼 무관" 시험은 원전 정제 후보 수락 기준 #3(강도 조절이 같은 불변조건을 지키며 부담만 바꾼다, 01 §3.8.5)의 확인이다.

#### 3.7.5 의존 규칙 1~5 대응표

10 §3.8의 규칙마다 위반 사례, 예외 통과 사례, 속성, 유즈케이스 확인을 둔다. 거부의 `missing`에 `dependency_rule:<n>`이 들어 있는지 함께 본다(10 §3.8).

| ID | 규칙 | 위반 → 기대 | 예외(통과해야 함) | 속성 | 대본·다른 테스트 |
|---|---|---|---|---|---|
| 22/DR-1 | write·send에는 C, send는 언제나 권리 게이트 | 활성 합의 없는 write → `denied.agreement_required`. 범위 밖 → `gate.scope_expansion_required`. execute인데 `mutating` 또는 `targetsKnown=false` → 같은 검사. 합의가 있어도 send는 승인 없이 → needs_gate(판정 J-91) | 사람이 확정한 Grant 안의 활성화(`activated_by_grant`), 사람이 고른 선택지 범위 안의 echo 활성화(판정 J-133), 비상 Grant(상황 `chaotic`일 때만, 3단계), 직접 지시 echo(`direct_instruction`, J-01 가벼운 작업). 어떤 예외도 send의 권리 게이트를 없애지 않는다 | PT-06, 14 C-8 | AC-01-12, AC-07-01, AC-07-02, AC-15-01, UC-02/E2, UC-07/send-in-scope |
| 22/DR-2 | "완료"에는 A | 결과 확인 없이 WorkUnit `accepted`·`integrated`, Concern `completed`, Goal `achieved` → `policy.acceptance_required`. 반영 항목 남음 → `policy.obligations_open` | 탐구·탐침 WorkUnit의 `concluded`(완료가 아님) | PT-07, 14 C-18 | AC-01-14, AC-07-07 |
| 22/DR-3 | 판단 승격에는 I의 근거 | 근거·구분 확인·반증 탐색 중 하나라도 없음 → `policy.promotion_requirements` | 사후 구분 확인은 세지 않음(통과가 아니라 거부 유지) | PT-04 | helm-toy 대본, AC-02-03, AC-13-04 |
| 22/DR-4 | 하위 Concern은 재조합 뒤 닫힘 [제안, 3단계] | 하위가 열린 상태의 `concern.close(completed)` → `policy.subconcerns_open` | 사람의 `force: true` 닫기(남은 하위와 경계 항목 기록) | PT-07 | AC-19-02(3단계) |
| 22/DR-5 | Goal 변경은 사람 확인 | 에이전트의 Goal 개정 → `gate.human_required`, 제안은 권리 질문(`goal_change`) | 사람이 먼저 시작한 직접 수정(UC-09 A4) | PT-17 | AC-09-01, AC-09-06 |

- J-01: Concern 밖 가벼운 작업에도 규칙 (1)(2)가 압축형으로 적용된다. DR-1·DR-2 시험은 가벼운 작업 보관 Concern(14) 아래의 WorkUnit에서도 한 번씩 돈다.
- 다이얼·모드·정책이 규칙 1~3을 끌 수 없음(10 §3.8 첫 문단): DR-1~3을 §3.7.4의 다이얼 극값 조합 8개에서 반복한다.

계획 검사 V-PLAN-01~07(10 §3.8.1, 14 `validatePlan`, [판정 J-188])은 커널이 계획마다 돌린다. V-PLAN-04~06은 모든 계획(모델·코드·사람)에, V-PLAN-02·03은 모델 초안에만 적용한다. 거부의 `missing`에 규칙 번호나 `maturity:<loop>`가 들어 있는지도 함께 본다.

| ID | 검사 | 위반 → 기대 | 통과해야 하는 경우 | 계층 | 함께 보는 ID |
|---|---|---|---|---|---|
| 22/PL-01 | V-PLAN-01 형식 | 키 중복, 모르는 루프, `pairWith`·`until` 누락 → `invalid.schema`. `outOfPattern`이 참인데 근거 ID가 없거나 기록에 없음 → `invalid.evidence_not_found` | 기록에 있는 근거 ID를 단 `outOfPattern` 참 | unit, prop(무작위 계획 형식) | 10/UT-08, 14 F37 |
| 22/PL-02 | V-PLAN-02 방식 | `computed`에서 모델 초안 → `denied.plan_authoring_mode`. 재요청하지 않고 두 번째 위반으로 세지 않는다. 사람 계획은 다이얼과 무관 | `hybrid`·`model`에서 초안 통과 | unit | 14 F36, 19/CT-47 |
| 22/PL-03 | V-PLAN-03 불필요 | `hybrid`에서 `outOfPattern`이 거짓이고 `buildPlan`이 규칙으로 계획을 정함 → `policy.plan_draft_not_needed`(다음 행동 `concern.reframe`). `model`에서는 이 검사를 하지 않는다 | `outOfPattern`이 참이거나 `buildPlan`이 NoRule을 냄 | unit(세 값 × 참·거짓 표) | 14 C-4 |
| 22/PL-04 | V-PLAN-04 규칙 1 | 쓰기·발송 단계가 `C.commit` 뒤에 없고 활성 합의도 없음 → `policy.plan_dependency_violation`(`dependency_rule:1`) | 활성 합의가 있거나 `C.commit` 뒤 | prop(무작위 계획), unit | DR-1 |
| 22/PL-05 | V-PLAN-05 규칙 2·4 | C 계열 단계 뒤 `A.confirm`이 없음, 또는 `S.split` 뒤 `S.recombine`·`A.confirm`이 없음 → `dependency_rule:2`·`:4` | 두 규칙을 모두 맞춘 계획 | prop, unit | DR-2, DR-4 |
| 22/PL-06 | V-PLAN-06 성숙도 관문 | 계획의 루프가 `features.enabledLoops`에서 꺼져 있음 → `policy.plan_maturity_gate`(`maturity:<loop>`) | 켜진 루프만 쓴 계획 | unit | 14 §3.15 |
| 22/PL-07 | V-PLAN-07 두 번째 위반 | 같은 Concern의 두 번째 V-PLAN-04~06 위반: 거부하지 않고 `buildPlan` 계획을 `authoredBy: code`로 기록한다. `command.rejected`(두 번째 위반), `loop_plan.adopted`(`modelDraftRejects`), `notice.plan_draft_fallback`이 남는다. 채택 뒤 `planDraftStrikes`는 0 | 첫 위반 뒤 고친 초안이 통과(첫 위반은 `retryable` 거부로 모델에 돌아간다) | int(가짜 모델 `faux:helm` 테이프로 모델 초안 경로 재생, 14 C-4) | 08 E-40, 14 F35 |

- PL-02·PL-03의 거부는 두 번째 위반으로 세지 않는다(10 §3.8.1). PL-04~07의 모델 초안 경로는 14 C-4가 `faux:helm` 테이프로 재생한다([판정 J-169], [판정 J-188]). 같은 Concern의 `planDraftStrikes`는 커널 상태가 맡는다.
- 계획 표시(`PlanFlags`)는 여섯 표시와 `outOfPattern`을 합친 일곱 개다. C-4는 표시 조합마다 같은 입력에서 같은 계획이 나오는지 본다.

#### 3.7.6 커널 첫 대본: helm-toy

- 10 §3.17.4 표의 21단계를 `packages/kernel/test/scripts/helm-toy.json`으로 두고 골든 이벤트 열과 비교한다(D0).
- 거부 8건(n=3, 4, 5, 7, 10, 17, 19, 21)의 갈래가 helm-toy 분류(내용 3·4·7·10·17, 자격 5·19, 경로 21)와 같아야 한다(10 §3.17.4, 02 §3.24). n=17은 10에서 "거부 + 강등" 두 갈래로 나눈 것을 따른다.
- 같은 대본을 `runtime` 모드 대본(`tests/scenarios/uc-02-cause-investigation.scenario.ts`의 `UC-02/helm-toy`)으로도 돌려 런타임 훅을 지난 결과가 같은 거부 갈래를 내는지 본다(D1). 06 §3.13.6의 어댑터 적합성 2번 항목(helm.mjs 거부 8건 대본)도 이 대본을 쓴다.
- 원본 `experiments/helm-toy/helm.mjs`는 고치지 않는다. 실행 결과(21번 시도 중 8번 거부)는 대화 발췌 3 X3-10-03에 [실험]으로 남아 있다.

#### 3.7.7 원전 helm-kernel-v02 테스트 57개의 대응

canon-2 §9.14의 57개를 새 설계의 테스트로 옮긴다. "대응 ID"의 테스트가 같은 성질을 확인한다. 새 설계에 없는 개념(13개 이벤트 이름, 별도 client 클래스 등)은 같은 성질을 새 이름으로 확인한다. 대응이 없는 것은 이유를 적었다.

| V02 | 원전 파일 | 원전이 확인한 것(canon-2 §9.14 요지) | 대응 ID |
|---|---|---|---|
| 22/V02-01 | contracts | JSON Schema 9개 파싱, `$id` 규칙 | 19/UT-06(스키마 생성 결정성), 09/UT-01(envelope 스키마 컴파일) |
| 22/V02-02 | contracts | 명령·이벤트 enum이 코드 상수와 일치 | 09/UT-02(이름 정규식·08 상태 기계 이벤트 포함), 19/UT-03(등록 표), 08/UT-09(R의 이벤트가 카탈로그에 있음) |
| 22/V02-03 | guided-001 | F1 쓰레기 legacy Decision(`ㅇ`)이 보이되 기준선이 되지 않음 | 02/AC-06-07, 02/AC-07-14, 10 §3.17.5(F1 → 품질 `captured`) |
| 22/V02-04 | guided-001 | F2 `projection.*` 쓰기 → `projection_is_derived` | 10/PT-10, 02/AC-07-12, 19 §6.3 `projection-is-derived` |
| 22/V02-05 | guided-001 | F3 이벤트 envelope 제출 → `adapter_cannot_append_event` | 10/UT-02, helm-toy n21, 19 §6.3 `adapter-cannot-append-events` |
| 22/V02-06 | guided-001 | F4 같은 cursor 두 명령 → 둘째 충돌, 마지막 쓰기가 이기지 않음 | 02/AC-07-13, 19/CT-18·CT-19, 09/UT-12(commit) |
| 22/V02-07 | guided-001 | 에이전트 commit → 사람 게이트, 사람 commit 뒤 기준선 | 10/PT-05, 02/AC-02-06 |
| 22/V02-08 | guided-001 | 같은 명령 재제출 → 재생, 이벤트 늘지 않음 | 10/PT-11, 09/UT-12(1) |
| 22/V02-09 | guided-001 | F5 재협상 → 이전 기준 stale, 옛 기준 완료 거부 | 02/AC-12-01 |
| 22/V02-10 | guided-001 | F6 제출·수락·통합 분리 | 02/AC-07-11, 10/PT-16, 22/INV-5 |
| 22/V02-11 | guided-001 | 이벤트 재생 투영 = 상태, `projection.` 타입 없음 | 10/PT-02, 09/UT-14(2) |
| 22/V02-12 | adapter-conformance ×2 | 직접·JSONL 전송 각각 적합성 | 22/CF-01(세 리스너), 06/S5 |
| 22/V02-13 | adapter-conformance | 두 전송의 의미 이벤트 동일, provenance만 다름 | 22/CF-01, 13/AC-12, 02/AC-04-04 |
| 22/V02-14 | adapter-conformance | 관찰 재전송 멱등, `effectiveAt`·`recordedAt` 분리, 같은 외부 ID 다른 내용 → 충돌 | 09/UT-12, 10/UT-03(코드 `conflict.external_observation_changed`, 09 요구 (8)) |
| 22/V02-15 | client | 역할별 표면: 에이전트 쪽에 commit 없음, 사람 쪽에 후보 열기 없음 | 13/T-HT-04, 10/UT-02(채널), 19 §6.3 `guided-human-gates` |
| 22/V02-16 | client | 관찰은 규범 상태로 승격되지 않음 | 22/AX-05(c), 10 R-06·R-07 단위 |
| 22/V02-17 | client | 원시 append·generic 명령 경로 비노출 | 19/UT-03(등록 표에 append 없음), 19 §6.3 `adapter-cannot-append-events` |
| 22/V02-18 | authority | 비확장 합의가 Grant로 활성, 두 역할 provenance | 10/UT-10(a), 02/AC-02-08 |
| 22/V02-19 | authority | 행동·효과·자원 확대 → 게이트 | 10/UT-10(b), 22/AX-07(c) |
| 22/V02-20 | authority | 멈출 조건 누락 → missing | 10/UT-10(c) |
| 22/V02-21 | authority | 만료 Grant | 10/UT-10(d) |
| 22/V02-22 | authority | 자기 권한 생성 불가 | 10/UT-10(e) |
| 22/V02-23 | context | 같은 입력 같은 컨텍스트, 예산, 비밀 삭제, 생략 보고 | 12/T-PJ-01, 12/T-PJ-06, 13/T-RD-01 |
| 22/V02-24 | context | 작은 예산에서 steering·도구 결과 우선 | 12/T-PJ-04, 12/T-PJ-06 |
| 22/V02-25 | context | 필수 컨텍스트 초과 → fail-closed | 12/T-PJ-05 |
| 22/V02-26 | agent-runtime | 모델 도구에 commit·accept 없음, 사람이 게이트 해결 | 13/T-HT-04, 12/T-RT-07, 02/AC-07-05 |
| 22/V02-27 | agent-runtime | 숨긴 권한 도구 호출 → unknown tool | 07/C5, 12/T-AG-01~05 |
| 22/V02-28 | agent-runtime | 필수 필드 없는 인자 → 런타임 재검증 실패 | 07/C5, 12/T-AG-01~05 |
| 22/V02-29 | agent-runtime | cursor에 묶인 게이트, 낡으면 충돌 | 02 CX-01(`stale_basis`), 19/CT-18, 20/IT-07 |
| 22/V02-30 | agent-runtime | 터미널 출력 정화(`\u0007`) | 12/T-ST-01(휘발 스트림 제어 문자 제거), 18/T18-32(모델 출력 렌더 정화), 21 마크다운 렌더 부품의 `skipHtml`·스킴 제한 시험(21/TK-01). TUI 단계에서 TUI 렌더 시험 추가 |
| 22/V02-31 | agent-runtime | 표시 라벨 위조 불가(`Observed`) | 10 V-INV-01(관찰 출처 = 채널), 21 `AuthorshipMark`는 레코드 행위자에서만 그림(21 U3) |
| 22/V02-32 | agent-runtime | 제공자에 원시 기록 대신 투영만 전달 | 12/T-PJ-02, 12/T-SA-02 |
| 22/V02-33 | agent-runtime | 루프 단계 상한 | 12/T-BG-02, 14 예산 |
| 22/V02-34 | agent-runtime | 대기 중 취소 | 12/T-IN-03 |
| 22/V02-35 | agent-runtime | 대기 중 steer → 다음 컨텍스트에 반영 | 12/T-IN-01, 07/C18 |
| 22/V02-36 | agent-runtime | 도구 효과 선언(메타데이터) | 13/T-TL-01, 13/T-HT-01(스키마 스냅숏), 13 도구 `primitive`·`replay` 선언 시험 |
| 22/V02-37 | agent-runtime | 협력 도구 실행 중 steer → 중단, 재개 컨텍스트에 steering | 12/T-IN-03 |
| 22/V02-38 | agent-runtime | 원자 도구 실행 중 취소 → 미룸, 끝난 뒤 취소 | 12/T-IN-03, 02/AC-12-03 |
| 22/V02-39 | agent-runtime | 불확실 외부 쓰기 → 복구 대기, 확인 뒤 진행 | 12/T-CR-08, 02/AC-10-04 |
| 22/V02-40 | openai-provider | 요청 대응(`store: false`, 키가 본문에 없음 등) | 07/C24, 12/T-PJ-07(변환 스냅숏) |
| 22/V02-41 | openai-provider | 구조화 메시지에 표시 라벨 없음 | 07/C23·C24 스냅숏(표시 라벨 개념이 없다) |
| 22/V02-42 | openai-provider | 잘못된 인자 JSON·혼합 출력 → fail-closed | 07/C5(`invalid_args`), 12/T-AI-03 |
| 22/V02-43 | openai-provider | HTTP 429, 오류에 키 없음 | 12/T-AI-03, 12/T-AI-08 |
| 22/V02-44 | openai-provider | 숨은 기본값 없음(빈 모델·키 → 오류) | 12/T-AI-02, 06 F9(키 없음 → 사용 불가 표시) |
| 22/V02-45 | openai-provider | 응답 3개 전체 경로 | 02 UC-07/basic(`runtime` 모드) |
| 22/V02-46 | sqlite-kernel | 다시 열기 뒤 상태·마이그레이션 | 09/UT-09(open), 09/UT-10(migrations) |
| 22/V02-47 | sqlite-kernel | 다시 열기 뒤 같은 명령 재생 | 09/UT-12(1) |
| 22/V02-48 | sqlite-kernel | 두 연결 같은 cursor → 하나 충돌 | 09/UT-11(fencing), 09/UT-12, 02/AC-07-13 |
| 22/V02-49 | sqlite-kernel | 이벤트 뒤·명령함 앞 고장 → 모두 롤백, 재제출 성공 | 09/UT-12(3) |
| 22/V02-50 | sqlite-kernel | `event_json` 직접 수정 → 해시 오류 | 09/UT-13(1), 18/T18-23 |
| 22/V02-51 | sqlite-kernel | 관찰 멱등이 다시 열기 뒤에도 | 09/UT-12(1) |
| 22/V02-52 | sqlite-kernel | 다른 작업 공간 명령은 두 함 모두 건드리기 전에 거부 | 대응 없음: Helm은 모든 프로젝트를 DB 하나에 둔다(09 A09-1). 프로젝트 경계는 10 R-01과 13 경로 정책(T-PA)이 본다 |
| 22/V02-53 | sqlite-kernel | outbox 소비 재개·멱등 표시 | 09 D09-5의 `consumer_cursors`: 09/UT-12(8)과 12 스케줄러 소비자 커서 시험 |
| 22/V02-54 | sqlite-kernel | 저장소를 바꿔도 프로토콜 동작 동일 | 19/UT-08(FakeDaemon과 실제 데몬이 같은 스위트 통과), 22/CF-03 |
| 22/V02-55 | experience | 게이트 수 상한(사람 판단 요청 정확히 2번), "계속할까요" 없음 | 14/C-14, 02/AC-07-09, 05/UT-02 |
| 22/V02-56 | experience | 단계 상태 기계(잘못된 단계 호출 예외) | 08/UT-10(machines), 10/UT-06(표에 없는 전이 → `conflict.invalid_transition`) |

표의 56행이 원전 57개를 모두 덮는다(V02-12 한 행이 직접·JSONL 두 건).

원전 아키텍처 수락 기준 13개(canon-2 §1.25)는 다음으로 확인한다: #4 → 22/AX-06·13/T-HT-04, #5·#6 → 어댑터 단계 13/AC-12, #7 → V02-05, #8 → V02-06, #9 → V02-04, #10 → V02-03, #11 → 09/UT-05(업캐스터)·09/UT-15(재구성), #12 → 13/T-AD-02·21 보장 수준 배지, #13 → 22/FI-07·19/CT-12. #1~#3은 구조 결정(06·23)이며 테스트 대상이 아니다.

#### 3.7.8 원전 불변 집합 채택 행의 시험

10 §3.16.2 표에서 "채택"으로 적었으나 시험 ID가 없던 행을 아래 시험으로 확인한다. 10 §3.16.2에 시험 열을 두도록 요구한다(§5.2).

| 원전 | 내용 | 시험 |
|---|---|---|
| F01 존재론 1 | WorkUnit은 Purpose 또는 Concern 연결 | 22/AX-01(c) |
| F01 존재론 8 | 파일 경로·세션은 객체 정체성을 정하지 않음 | 08/UT-01(ID 형식), 16/OB-T07(세션 파일이 바뀌어도 레코드 ID 유지)과 13/T-FP-01(상대·절대 경로가 같은 지문) |
| F03 통치 8 | 사람은 언제든 Frame·Purpose·Constraint를 재검토 | 22/AX-15(c) |
| F04 co-agency 1 | 공유 Purpose와 역할 | 22/AX-01 |
| F04 co-agency 3 | 자율 실행은 예상 경로와 예외 조건 노출 | 10/UT-04(`workunit.propose`의 `intent`·`expectedOutcome`, 합의 `checkBack`·`stopConditions` 빠짐 → 거부) |
| F04 co-agency 6 | 인간 참여는 목적·프레임·대안·수락에 집중 | 14/C-14(조작 2회 상한), 11/AQ-17(승인 극장 방지) |
| canon-3 §4.19 STPA "정상 권한, 잘못된 시점"(13 W-5) | 허용 범위 안이지만 잘못된 때의 행동 | UC-07/w5-allowed-unsafe: 합의 범위 안에서 다른 열린 Concern의 판단이 근거로 쓰는 파일을 지운다. 범위 검사는 통과하고(막을 수 없음), 해시 기반 낡음(R-2)으로 그 판단이 `stale`이 되며, 결과 확인의 반영 항목에 `concern_conflict`가 생기고, 복귀 요약 "왜 중요한가"에 나온다 |

### 3.8 유즈케이스 시나리오 테스트

02 §3.24가 요구한 최소 형태를 받아 정본을 정한다. 이름은 명령 10 §3.11, 이벤트 09 §3.4, 거부 갈래·코드 10 §3.4, 리스너 이름 17·판정 §2, 뷰 이름 19 §3.7을 쓴다.

#### 3.8.1 `ScenarioScript` v1 [제안]

```ts
// tests/harness/script.ts
import type { CommandType } from '@helm/domain';            // 10 §3.11 명령 이름. 10의 COMMAND_SPECS에서 파생한 합집합(10에 요구)
import type { EventType } from '@helm/domain';              // 09 §3.4 이벤트 이름
import type { RejectionClass } from '@helm/domain';         // 'content' | 'authority' | 'path' (판정 §1)
import type { ModelTapeTurn } from '@helm/ai/testing';

export type ScenarioMode = 'kernel' | 'runtime' | 'protocol';
export type Listener = 'tailnet' | 'loopback' | 'local';   // 02 §3.24와 같은 리스너 이름. SSH 경로는 loopback 리스너에 ssh -W. 'local'은 관리 CLI·TUI
export type DeviceAlias = 'dv_mac' | 'dv_win' | 'dv_phone' | 'localAdmin';   // localAdmin: 08·19 정본 값
export type KillPointName = string;                       // §3.9.2 표의 이름(예: 'tool.after_intent_commit')
export type FakeToolResult =                               // FakeToolExecutor가 돌려줄 결과
  | { ok: true; content: string; exitCode?: number; changedFiles?: string[] }
  | { ok: false; error: string; exitCode?: number }
  | { hang: true };                                       // 취소·시간 초과까지 끝나지 않음

export interface ScenarioScript {
  id: string;                          // 02 형식: "UC-07/basic", "UC-07/A2", "UC-10/B3". 22가 더한 것은 소문자 꼬리표: "UC-01/pick-only"
  title: string;
  fixtures: string[];                  // §3.6.1. 예: ["F-base", "F-shop-goal", "F-model-faux"]
  modes: ScenarioMode[];               // 이 대본을 돌릴 모드. MVP 대본은 'runtime'을 반드시 포함(D22-5)
  stage: 'mvp' | 'phase2' | 'phase3' | 'later';   // 01 §3.8.1 단계. 기능 플래그가 꺼진 단계는 건너뛴다
  /** 이 대본이 기대는 구성 요소. 그 요소를 만드는 23 WBS 행이 끝나기 전에는 건너뛰고 "선행 미도달"로 보고한다(§3.8.2) */
  requires?: ('runtime' | 'orchestrator' | 'views' | 'protocol' | 'inquiry' | 'push')[];
  dials?: Record<string, unknown>;     // 시작 다이얼(14 §3.11). 없으면 기본값
  tape?: string;                       // 별도 테이프 파일. 없으면 model 단계로 만든 테이프
  steps: ScriptStep[];
  expectAtEnd?: Expectation;
  /** strict 골든 비교 여부. 기본 true(runtime 모드). protocol 모드는 semantic */
  golden?: boolean;
}

export type ScriptStep =
  | { kind: 'human'; device: DeviceAlias; listener: Listener;
      command: CommandType; args: Record<string, unknown>;
      basis?: 'latest' | { at: string };        // basisSeq: 최신 또는 대본 안 표지(mark)의 seq(낡은 카드 시험)
      ttyConfirm?: boolean;                     // localAdmin 사람 결정의 TTY 확인(판정 J-135)
      idempotencyKey?: string;                  // 재전송 시험에서 같은 키를 다시 쓴다
      expect?: Expectation; ac?: string[] }
  | { kind: 'model'; role: ModelTapeTurn['role']; turn: Omit<ModelTapeTurn, 'kind' | 'n' | 'role'>;
      expect?: Expectation; ac?: string[] }
  | { kind: 'tool_result'; toolCallRef: string; result: FakeToolResult;  // FakeToolExecutor 대상 도구만
      expect?: Expectation; ac?: string[] }
  | { kind: 'clock'; advanceMs?: number; setTo?: string;   // setTo: ISO. 과거로도 갈 수 있다
      expect?: Expectation; ac?: string[] }
  | { kind: 'client'; device: DeviceAlias; listener?: Listener;
      action: 'connect' | 'disconnect' | 'reconnect'
            | 'send_draft'        // 사람이 초안을 확인하고 보냄(02)
            | 'resend_pending'    // 응답 전에 끊긴 명령을 같은 멱등 키로(02, J-02)
            | 'view' | 'ack_brief';
      view?: { name: string; params?: Record<string, unknown> };
      expect?: Expectation; ac?: string[] }
  | { kind: 'fault'; action: FaultAction; expect?: Expectation; ac?: string[] }
  | { kind: 'until'; event: EventType; where?: Record<string, unknown>; maxVirtualMs?: number;
      expect?: Expectation; ac?: string[] }
  | { kind: 'mark'; name: string };                        // 현재 seq에 이름을 붙인다(basis 'at'에서 사용)

export type FaultAction =
  | { type: 'crash'; at?: KillPointName }       // 같은 프로세스 모드: 인스턴스 버림. at이 있으면 그 종료 지점에서
  | { type: 'restart' }                         // 같은 데이터 디렉터리로 새 인스턴스 부팅(복구 포함)
  | { type: 'model_unavailable'; untilMs?: number }
  | { type: 'store_fault'; point: string }      // 09 faultInjector 지점(§3.9.1)
  | { type: 'sqlite_error'; code: 'SQLITE_FULL' | 'SQLITE_CORRUPT' | 'SQLITE_IOERR'; times?: number }
  | { type: 'corrupt_log'; how: 'tamper_event' | 'delete_row' | 'rehash_without_key' }
  | { type: 'drop_connection'; device: DeviceAlias; when: 'before_response' | 'after_commit_before_response' }
  | { type: 'skip_seq'; device: DeviceAlias }   // 서버가 일부러 구간을 건너뜀(19 CT-10)
  | { type: 'clock_jump'; byMs: number };

export interface Expectation {
  /** 이 단계 뒤 새로 기록된 이벤트 타입 열이 이 열을 부분열로 포함 */
  events?: EventType[];
  /** 부분열이 아니라 정확히 이 열(같은 트랜잭션 확인 등) */
  eventsExact?: EventType[];
  /** 같은 트랜잭션(같은 commandId)에 함께 기록되어야 하는 이벤트 */
  sameTransaction?: EventType[];
  /** 나오면 안 되는 이벤트 */
  absent?: EventType[];
  /** 거부되어야 할 때. needs_gate·conflict도 여기로(09: 모두 command.rejected, J-25) */
  rejected?: { status?: 'rejected' | 'needs_gate' | 'conflict'; class?: RejectionClass; code: string; missingIncludes?: string[] };
  /** 강등 알림 */
  downgraded?: { code: string };              // 'downgraded.criterion_unverified' 등
  /** 사람 조작 셈(대본 시작부터 누적, 01 §3.5.2. 16 §3.22.3 지표 함수로 이벤트 종류에서 계산) */
  humanOps?: { normalPath?: number; extra?: Partial<Record<'scope_expansion' | 'rights_gate' | 'correction_cycle' | 'reinquiry' | 'goal_change' | 'contest', number>> };
  /** 뷰 검사: 19 view.get 결과의 부분 일치. JSON 경로 → 기대값(매처 허용) */
  view?: { name: string; params?: Record<string, unknown>; match: Record<string, unknown> };
  /** 질문 전달 검사(09 question.delivered, delivery.planned) */
  delivered?: { question: string; urgency?: 'interrupt' | 'notice' | 'digest'; channel?: string; devices?: DeviceAlias[]; count?: number };
  /** 프로토콜 응답 검사(protocol 모드) */
  response?: { errorCode?: number; duplicate?: boolean };
  /** 장애 뒤 공통 불변조건 검사(§3.9.4)를 이 시점에 */
  invariants?: true;
}
```

02 §3.24 형태와의 차이:

| 02 | v1 | 이유 |
|---|---|---|
| `listener: "tailnet" \| "loopback"` | `+ 'local'` | 관리 CLI·TUI 경로(`rpc.sock`). SSH 경로는 `loopback` 리스너에 `ssh -W`로 붙는다(17, 19 B3) |
| `device: "dv_mac" \| "dv_win"` | `+ 'dv_phone'`(2단계), `'localAdmin'` | [결정 42], 관리 CLI 경로. `localAdmin`의 사람 결정은 TTY 확인 문자열이 있을 때만 받는다(판정 J-135). 대본의 `localAdmin` 사람 단계는 `ttyConfirm: true`를 싣고, 빠진 경우의 거부도 시험한다 |
| `kind: "model"; output: unknown` | `turn: ModelTapeTurn` | 모델 테이프 하나로 통일(D22-4) |
| `kind: "fault"; action: 4종` | `FaultAction` 9종 | §3.9의 장애 시나리오를 대본으로 쓰기 위해 |
| `kind: "client"; action` `disconnect`·`reconnect`·`send_draft`·`resend_pending` | `+ connect`, `view`, `ack_brief` | 복귀 요약 cursor(AC-06-01), 뷰 검사 |
| — | `until`, `mark` | 비동기 런타임 진행을 기다림, 낡은 기준 시험 |
| `Expectation.projection` | `view` | 투영 필드 대신 19의 뷰 이름과 결과로 검사. 앱이 실제로 받는 것과 같다 |
| — | `ac` | 단계 기대값이 확인하는 AC ID. 추적 검사가 이것을 테스트 제목에 넣는다 |

#### 3.8.2 실행 모드

| 모드 | 구성 | 모델 단계 처리 | 도구 | 사람 단계 | verify |
|---|---|---|---|---|---|
| `kernel` | engine + 임시 파일 저장소 + 커널. 런타임 없음 | 테이프 응답의 Helm 제안 도구 호출을 13 §3.7의 도구 → 명령 대응으로 모델 채널 제출로 바꾼다. `contextRef`는 하네스가 12의 순수 투영 함수로 만들어 런타임 채널로 먼저 기록한다 | 기본 도구 호출은 `toolcall.intend` + 대본의 `tool_result` | engine `submit`(사람 채널, via device) | 선택(빠른 변형 시험용) |
| `runtime` | 위 + 런타임(12) + 오케스트레이터(14) + 스케줄러 + 테이프 게이트웨이 | 실제 런타임 루프가 테이프를 읽는다 | 임시 작업 공간에서 실제 실행. bash는 샌드박스 수준(13 §3.6.1)을 감지해 S1·S1b가 있으면 실제, 없으면 `FakeToolExecutor` | engine `submit` | 모든 MVP 대본 |
| `protocol` | 위 + 데몬 리스너 셋(임시 포트·임시 소켓) + `@helm/client`(node 전송) | 같음 | 같음 | `@helm/client`로 19 명령 메서드 호출 | UC-04, UC-10 A, UC-11, UC-17과 AC-04-04 동등성 |

- 세 모드의 결과는 semantic 비교로 같아야 한다(대본이 여러 모드를 선언한 경우). 다르면 하네스 결함 또는 런타임과 커널 사이 계약 결함이다.

모드와 기대 검사의 선행 조건(구현 순서와 맞추기 위한 것, 23 WBS가 이 순서를 따른다):

| 쓰는 것 | 기대는 구성 요소 | 그 전까지 |
|---|---|---|
| 커널 단독 대본(`packages/kernel/test/scripts/*.json`, helm-toy 등) | 커널, 08 데이터 | 하네스 없이 커널 단위 시험으로 돈다 |
| `kernel` 모드 | 엔진(06 S4), 임시 파일 저장소(09), 12의 순수 투영 함수, 13 도구 → 명령 대응 데이터 | 대본을 만들지 않는다 |
| `runtime` 모드 | 위 + 런타임·테이프 게이트웨이(12), 오케스트레이터(14, `requires: ['orchestrator']`) | `kernel` 모드로만 돈다 |
| `view` 기대·`client.view` 단계 | 화면 투영(12 U-RT-12, 19 뷰) | 대본이 `requires: ['views']`를 선언하고 건너뛴다 |
| `protocol` 모드, 22/CF-01의 대본 부분 | 데몬 리스너·프로토콜 계층(19, 17) | CF-01은 19 적합성 스위트(CT-01~50)만으로 돈다. 대본 부분은 리스너가 생긴 뒤 더한다 |
| 앱 뷰 표본(`test-fixtures-views`) | `protocol` 모드 + 뷰 | 앱 시험은 19 `FakeDaemon` 손 고정 데이터로 시작하고, 뷰가 생기면 대본이 만든 표본으로 바꾼다 |
| `requires: ['push']` | 26 푸시 계획·송신, 가짜 푸시 서비스 | 2단계 대본으로 건너뛴다 |

하네스는 `requires`의 구성 요소가 없으면(23 WBS 행이 `tests/trace/done.ts`에 없음) 그 대본을 건너뛰고 "선행 미도달"로 보고한다. 건너뛴 대본의 AC는 추적 검사에서 경고로 남는다(§3.4.3).
- `runtime` 모드의 같은 대본 두 번 실행은 strict로 같아야 한다(14 C-16, 15 T-01).

#### 3.8.3 하네스 알고리즘

```text
runScenario(script, mode):
  1. env = withIsolatedEnv(); dir = tempDir(); clock = manualClock(); ids = fixedIdFactory(clock, script.id)
  2. tapeModel = buildTape(script)            # model 단계를 순서대로 ModelTapeTurn으로 모은다(role-queue)
  3. world = createWorld({ mode, dir, clock, ids, gateway: tapeGateway(tapeModel, {clock}),
                           storeOpts: { clock, ids, testing: { bootEpoch: fixed, storeId: fixed, allowTmpfs: true } } })
  4. for f in script.fixtures: await fixtures[f](world)          # 명령으로 상태를 만든다(§3.6.1)
  5. marks = {}; before = world.store.headSeq()
  6. for step in script.steps:
       a. 실행: human → world.submit(…) 또는 client.command(…)
                model → (runtime·protocol) 테이프에 이미 있음. 런타임이 다음 요청에서 꺼낸다
                         (kernel) 번역해 제출
                tool_result → FakeToolExecutor.resolve(toolCallRef, result)
                clock → await clock.advance / set   # 만기 타이머 실행
                client → 연결 조작
                fault → §3.9 처리
                until → 조건이 맞을 때까지 world.settle()과 clock.advance(1초 단위)를 반복, maxVirtualMs 넘으면 실패
                mark → marks[name] = headSeq
       b. await world.settle()      # 런타임 whenIdle(): 모든 run이 모델 응답·사람·타이머를 기다리는 상태가 될 때까지
       c. newEvents = world.store.readEvents(after = before); before = headSeq
       d. checkExpectation(step.expect, newEvents, world)  # 실패 메시지에 step 번호, ac, 이벤트 diff
  7. checkExpectation(script.expectAtEnd, allEvents, world)
  8. tape.assertExhausted()
  9. if golden: expectGolden(serialize(allEvents, strict), golden path)
 10. 비밀 카나리아 검사(§3.11.2), 장애가 있었으면 §3.9.4 불변조건 검사
```

- `world.settle()`은 런타임이 제공하는 `whenIdle()`(12에 요구)과 저장소 `onCommitted` 대기열이 빌 때를 기다린다. 실제 시간으로 기다리지 않는다.
- 사람 조작 셈은 하네스가 따로 세지 않는다. 01 §3.5.2의 정상 경로는 이벤트 종류로 계산한다(판정 J-76). 하네스는 대본의 이벤트 열에 16 §3.22.3의 순수 지표 함수(`@helm/observer/metrics`의 사람 결정 사실 `human_op`와 그 정상 경로·사유 판정)를 돌려 `humanOps.normalPath`·`humanOps.extra`를 얻는다. 08 `HumanOpMeta`의 필드(`followedRecommendation` 등)는 셈에 쓰지 않는다. 하네스가 따로 규칙을 만들면 같은 결함을 두 번 만든다.
- 테스트 제목: `scenarios.test.ts`가 대본마다 `it("<대본 ID> <ac 목록>")`을 만든다. 예: `it("02/UC-07/basic 02/AC-07-01 02/AC-07-04 … 단일 흐름")`. 단계 실패는 해당 AC 이름을 메시지에 넣는다.

#### 3.8.4 MVP 대본 목록

02 §6 "MVP 유즈케이스(UC-01~07, 09~13, 15, 17 기기 전환)의 기본 흐름과 대안·예외 흐름 각각에 대본". 2단계·3단계 흐름(UC-01 A9·A10, UC-02 A6, UC-07 A8·A9, UC-13 A2·A3, UC-04 M, UC-05 A7)은 `stage`를 붙여 두고 기능 플래그가 켜질 때 활성화한다(01 §3.8.4 G1 전 기본 꺼짐).

| 파일 | 대본 ID | 모드 | 비고 |
|---|---|---|---|
| `uc-01-want-inquiry` | `UC-01/basic`, `A1`~`A8`, `E1`~`E4`, `UC-01/pick-only`(22 추가, AC-01-06) | runtime | `A2`는 이미지 자극(이미지 blob 픽스처) |
| `uc-02-cause-investigation` | `UC-02/basic`, `A1`~`A5`, `E1`~`E3`, `UC-02/helm-toy`(10 §3.17.4의 runtime판), `UC-02/strict-proof`(22 추가, AC-02-04), `UC-02/assumed-choice-basis`(22 추가, 판정 J-133 근거 제외), `UC-02/plan-draft-fallback`(22 추가, [판정 J-188]: 모델 계획 초안의 두 번째 위반 뒤 코드 계획, `faux:helm` 테이프) | runtime, kernel | `basic`은 대화 L2426–2441 흐름. 사실 탐구 뒤 방향 선택 질문은 권리 게이트다(판정 J-131). 단계 11의 합의는 사람이 고른 선택지의 구조화 범위 안이면 확정 질문 없이 활성된다(판정 J-133) |
| `uc-03-multi-day` | `UC-03/basic`, `A1`~`A5`, `E1`~`E3` | runtime | 모든 클라이언트 끊김 + `clock` 단계로 밤을 넘긴다 |
| `uc-04-answer-remote` | `UC-04/basic`(tailnet), `UC-04/B`(ssh), `C`~`H`, `E1`~`E5`, `UC-04/resend-other-listener`(22 추가, 다른 연결·리스너에서 같은 키 재전송, FI-25), `UC-04/away-push`(22 추가, 2단계, [결정 48]) | protocol | `basic`·`B`가 AC-04-04 동등성 비교 대상. `E1`(Tailscale 꺼짐)·`E3`(serve만 실패)은 앱 연결 계층 시험(20 DM-13)으로 옮긴다 |
| `uc-05-autonomous-contest` | `UC-05/basic`, `A1`~`A6`, `E1`, `E2` | runtime | |
| `uc-06-brief` | `UC-06/basic`, `A1`~`A5`, `E1`, `E2` | runtime, protocol | `F-events-1k` 위에서도 돈다(성능은 §3.13) |
| `uc-07-agreement-acceptance` | `UC-07/basic`, `A1`~`A7`, `E1`~`E5`, `UC-07/cx-06`(22 추가, 두 기기 동시 수정 AC-07-13), `UC-07/send-in-scope`(22 추가, 판정 J-91: 합의 범위 안 send도 권리 게이트), `UC-07/w5-allowed-unsafe`(22 추가, 13 W-5), `UC-07/review-notice`(22 추가, 2단계, `requires: ['push']`, [판정 J-189]: 결과 확인 알림 세 값) | runtime, kernel | `basic`은 대화 X3-4-11 한 턴 흐름 + durable-spike c1~c7 결과와 비교(12 §6) |
| `uc-09-goal-refine` | `UC-09/basic`, `A1`~`A5` | runtime | |
| `uc-10-restart` | `UC-10/A`, `B1`, `B2`, `B3`, `B4`, `B5` | protocol(A), runtime(B*) | `B1`·`B3`의 프로세스 판은 §3.9 FI |
| `uc-11-install-pairing` | `UC-11/basic`, `A1`~`A3`, `E1`~`E3` | protocol | 설치 레시피 자체는 `sys`(22/SY-01) |
| `uc-12-redirect` | `UC-12/basic`, `A1`~`A5` | runtime | |
| `uc-13-reopen` | `UC-13/basic`, `A1` | runtime | |
| `uc-15-light-work` | `UC-15/basic`, `A1`~`A4` | runtime | |
| `uc-17-continue-elsewhere` | `UC-17/basic`, `UC-17/A*`(MVP 기기 전환만) | protocol | |

#### 3.8.5 수용 기준(AC) 추적표

"테스트" 열은 그 AC를 확인하는 대본 단계(대본 ID) 또는 다른 문서의 테스트 ID다. 하나 이상이 통과해야 AC가 충족된다. 계층·레시피: `scenario`는 `just test`(runtime 모드)와 `just test-scenarios`(전 모드), 그 밖은 해당 계층 레시피(§3.15).

**UC-01 취향형 작업의 원함 탐구 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-01-01 `entry.evaluated`(autonomy 포함)와 `concern.opened`가 같은 트랜잭션, 진입 판정은 Choice가 아님 | UC-01/basic(`sameTransaction`), 14/C-11 | scenario, unit |
| AC-01-02 판정 근거 없는 상황 판정 제안 → 내용 거부 | UC-01/basic(거부 단계), 14/C-3 | scenario, unit |
| AC-01-03 첫 라운드 자극 4개 이상·다른 분야/극단 1개 이상(라운드 전 비표시)·섞임 | UC-01/basic, 15/T-13, 15/T-27 | scenario, unit |
| AC-01-04 자극 생성 하위 호출끼리 결과를 보지 않음 | UC-01/basic(하위 호출 입력 참조 목록 검사), 12/T-SA-02, 13/T-RP-03 | scenario, unit |
| AC-01-05 반응 네 형태가 `observation.recorded(kind=reaction)`, 자극 id·구간 | UC-01/basic, UC-01/A2(이미지 영역) | scenario |
| AC-01-06 고르기만 한 라운드는 정지 규칙 미충족, 다음 라운드에 세 개 비교 | UC-01/pick-only, 15/T-12, 21/TK-06(2) | scenario, unit, ui |
| AC-01-07 반응 참조 없는 기준 후보 거부 | UC-01/basic(거부 단계), 10/UT-05(08 해당 R) | scenario, unit |
| AC-01-08 작업 에이전트의 기준 확정 → 자격 거부 | UC-01/basic(거부 단계), 22/AX-06 | scenario, unit |
| AC-01-09 다음 자극 선택 결정성 | 15/T-13, 15/T-01 | unit |
| AC-01-10 두 라운드 안정 → 자율 전환, 예산 소진 → `budget_exhausted` 전환과 열린 후보, 예산 질문 없음 | UC-01/basic, UC-01/A4 | scenario |
| AC-01-11 `stated_vs_revealed` 기록과 합의 초안 표시 | UC-01/basic(`view: agreement`) | scenario |
| AC-01-12 합의 없는 `drafts/` 쓰기 → `toolcall.blocked`(`denied.agreement_required`) | UC-01/basic, 22/DR-1 | scenario, unit |
| AC-01-13 단계 12~16 정상 경로 결정 조작 2건(이벤트 종류로 계산, 판정 J-76) | UC-01/basic(`humanOps`), 14/C-17 | scenario |
| AC-01-14 결과 확인 전 "반영 완료" 아님, 반영 항목 닫힘 뒤 닫기 | UC-01/basic, 22/DR-2 | scenario, unit |
| AC-01-15 선호 모델 → Goal 새 버전, 원인 = 결과 확인 | UC-01/basic | scenario |
| AC-01-16 자극판에 고르기만 있는 상태 없음 | 21/TK-06(1)(2), 04/UT-07, 22/E2E-UC01 | ui, e2e |
| AC-01-17 실사용 기록에 E0 형식 | 15/T-26(하네스가 형식 기록), 실사용 기록(manual) | unit, manual |

**UC-02 원인 조사 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-02-01 관찰 참조 없는 해석 → 전제 | UC-02/basic, 22/AX-05(c), 15/T-05 | scenario, unit |
| AC-02-02 확인 순서 결정성(15 §3.5.3 코드 계산), 구분 확인 선언과 함께 기록 | UC-02/basic, 15/T-09 | scenario, unit |
| AC-02-03 승격 조건 넷 | UC-02/helm-toy, UC-02/A2, 10/PT-04, 22/DR-3 | scenario, prop |
| AC-02-04 결정에 쓰이는 판단은 승격과 함께 판단 확인 질문, 증명 부담 "엄격"이면 확인 전 근거 불가 | UC-02/basic, UC-02/strict-proof(22 추가, 증명 부담 "엄격") | scenario |
| AC-02-05 선택 요청 필수 칸, `[승인][거절]`만이면 거부 | UC-02/basic(거부 단계), 11/AQ-03, 22/AX-15 | scenario, unit |
| AC-02-06 추천은 선택이 아님 | UC-02/basic(`absent`), 10/PT-05 | scenario, prop |
| AC-02-07 진짜 가능성 2개 이상 유지 | UC-02/basic | scenario |
| AC-02-08 사람이 고른 선택지의 구조화 범위 안 합의는 확정 질문 없이 활성(판정 J-133), 넘는 차원이 있으면 확정 질문. 가정 확정·맡기기로 생긴 선택은 근거가 되지 않음 | UC-02/basic(단계 11, `humanOps.normalPath` 2 이하), UC-07/A1(1), UC-02/assumed-choice-basis(확정 질문이 생김), 10/UT-10 | scenario, unit |
| AC-02-09 자동 검증 가능한 선택 → `choice.committed`(`auto_verified`, `whyNotAsked.kind = auto_verifiable`) | UC-02/A4 | scenario |
| AC-02-10 실사용 기록 E0 형식 | 실사용 기록(manual) | manual |

**UC-03 여러 날 걸리는 작업 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-03-01 클라이언트 없이 진행 | UC-03/basic(모든 클라이언트 disconnect 뒤 이벤트 증가) | scenario |
| AC-03-02 단계 진행은 관찰로만, 결과 제출·결과 확인 대기는 합의 단위로 한 번 | UC-03/basic | scenario |
| AC-03-03 멈출 조건에서 합의 밖 행동 차단, 안의 다른 해법은 자율 기록 | UC-03/E2 | scenario |
| AC-03-04 권리 게이트 질문은 만료·가정 확정 없음, 그 행동만 막힘 | UC-03/basic, 10/PT-09, 11/AQ-02 | scenario, prop |
| AC-03-05 정보 게이트 만료 순서 | UC-03/basic(`clock`), 11/AQ-06 | scenario, unit |
| AC-03-06 만료는 클라이언트 없이 스케줄러가 | UC-03/basic | scenario |
| AC-03-07 기기별 알림 한 번, 승격 시 한 번 더 | UC-03/basic(`delivered.count`), 20/DM-28, 05/UT-08 | scenario, unit |
| AC-03-08 복귀 요약에서 권리 게이트가 "선택 필요" 첫 항목 | UC-03/basic(`view: brief`) | scenario |
| AC-03-09 push는 Q-B(권리 게이트) 답을 권한 근거로, 답 전에는 막힘. 범위에 `net:<origin>`과 send 대상이 있어도 묻는다(판정 J-140, J-91) | UC-03/basic, UC-03/A2 | scenario |
| AC-03-10 정상 경로 2건 + 사유 `rights_gate` 1건(이벤트 종류로 계산) | UC-03/basic(`humanOps`) | scenario |

**UC-04 외부에서 접속해 질문에 답하기 (MVP, AC-04-09는 2단계)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-04-01 OS 알림 기본 내용 숨김("확인할 일이 n건"), 협상 전달은 기본 OS 알림 없음 | UC-04/basic(`question.delivered` payload에 문구 키만, J-31), 20/DM-28, 05/UT-08, 26/T26-13 | scenario, unit |
| AC-04-02 알림에서 답까지 결정 조작 1회 | UC-04/basic(`humanOps`), 22/E2E-UC04 | scenario, e2e |
| AC-04-03 토큰 없음·폐기 → 두 경로 모두 거부 | 18/T18-01, 18/T18-06, 18/T18-17, 19/CT-03, UC-04/E2 | sec, conf, scenario |
| AC-04-04 두 경로의 메시지 열(`hello`의 연결 정보 제외)·이벤트 로그 같음 | 22/CF-01(UC-04/basic vs UC-04/B, semantic), 22/CF-02(ssh -W 실제 경로) | conf |
| AC-04-05 재접속 뒤 `{storeId, seq}` 다음부터 빠짐없이, 범위 밖이면 스냅숏 경로 | 19/UT-18, 19/CT-07, 19/CT-08, 19/CT-27, 20/IT-02, 20/IT-04 | prop, conf, e2e |
| AC-04-06 오프라인 초안, 자동 전송 없음, 응답 전 끊긴 명령만 같은 키로 재전송(연결·리스너가 바뀌어도 한 번만 적용) | UC-04/C, UC-04/resend-other-listener, 22/FI-25, 19/CT-12, 20/IT-06, 20/IT-08, 20/DM-18 | scenario, conf, e2e |
| AC-04-07 답이 임시 가정과 다르면 기대던 작업 표시·수정 | UC-03/A1, 11/AQ-07 | scenario, unit |
| AC-04-08 답 이벤트에 기기 id와 리스너(서버가 채움) | UC-04/basic, UC-04/B | scenario |
| AC-04-09 (2단계) 휴대폰 답도 같은 사람 명령 | UC-04/M(stage phase2, `dv_phone`), 26/T26-06, 26/T26-24 | scenario, e2e |

**UC-05 혼자 정한 결정 확인과 이의 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-05-01 모든 자율 종류가 "에이전트가 정한 것"에, 빈 `why_not_asked` 거부 | 11/AQ-12, 10/PT-08, UC-05/basic(`view: autonomous`) | unit, prop, scenario |
| AC-05-02 `objection.filed` + `concern.reopened` 같은 트랜잭션 | UC-05/basic(`sameTransaction`) | scenario |
| AC-05-03 모든 이의가 끝 상태(`upheld`·`dismissed`·`withdrawn`, 기록만은 `noted`)에 이름 | UC-05/basic, UC-05/A1~A6(`expectAtEnd`), 16/OB-T22(열린 이의 지표) | scenario, unit |
| AC-05-04 다음 턴 경계 뒤 contested 결정에 기대는 새 행동 없음 | UC-05/basic, 10/PT-13 | scenario, prop |
| AC-05-05 이의 조작은 정상 경로 밖 사유 `contest`로 계산 | UC-05/basic(`humanOps.extra.contest`) | scenario |
| AC-05-06 복귀 요약에서 접힘과 종류별 개수 | UC-05/basic(`view: brief`), 04/UT-04 | scenario, ui |

**UC-06 복귀 요약 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-06-01 cursor는 사람 단위 하나, `brief.acknowledged`로만 바뀜 | UC-06/basic, UC-17/basic | scenario |
| AC-06-02 1,000개에서 결정적 부분 1초 이내 | 22/PF-05 | perf |
| AC-06-03 모든 항목에 근거 참조 | UC-06/basic, 12/T-VW-03 | scenario, unit |
| AC-06-04 Concern당 5묶음 이하 | 12/T-VW-03 | unit |
| AC-06-05 반대 근거·contested·stale 빠짐 없음 | UC-06/basic(`F-events-1k` 위), 22/AX-09 | scenario, unit |
| AC-06-06 권리 게이트가 "선택 필요" 맨 위 | UC-06/basic, UC-03/basic | scenario |
| AC-06-07 qualified 아닌 선택은 기준선이 아니라 주의 항목 | UC-06/basic(`F-garbage-legacy`), 22/V02-03 | scenario |
| AC-06-08 복귀 점검 기록, 정답은 로그에 없음 | UC-06/A1, 16/OB-T24, 18/T18-33 | scenario, unit, sys |
| AC-06-09 다시 만드는 중 낡음 표시 | UC-06/A5, 12/T-VW-02 | scenario, unit |

**UC-07 작업 합의(C)와 결과 확인(A) (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-07-01 합의 없는 write·send 차단 | UC-07/basic, 22/DR-1, 10/PT-06 | scenario, unit, prop |
| AC-07-02 금지 행동 거부, 범위 밖 쓰기는 질문 전환, bash 사후 비교 | UC-07/A2, UC-07/E5, 13/T-SC-03, 13/T-CD-01 | scenario, unit |
| AC-07-03 제출 없이 끝내려 하면 진행 요청, 최대 횟수 뒤 멈춤 | UC-07/E1 | scenario |
| AC-07-04 기준별 판정과 근거, 관찰 아닌 근거 → 확인 못함 | UC-07/E2, UC-02/helm-toy(n16~18) | scenario |
| AC-07-05 결과 확인은 사람 명령 경로만 | UC-07/E3, 22/AX-06, 10/PT-05 | scenario, unit, prop |
| AC-07-06 다섯 행동(결과 확인, 조건부, 수정 요청, 결과 거절(화면 문구 "거절(해결 안 됨)", [판정 J-170]), 기준이 틀림)은 `result.accept` 하나로(판정 J-123·J-124), 조건부는 조건 문장 필수이고 같은 트랜잭션에서 조건 항목이 deferred(revisitTrigger = 조건 문장)로 생김(판정 J-125) | UC-07/basic, UC-07/A3, UC-07/A5, UC-07/A6, 10/UT-04 | scenario, unit |
| AC-07-07 반영 항목, 닫히기 전 "결과 확인됨". `integrationAgreement`가 있으면 accepted·conditional에서 같은 트랜잭션에 `agreement.confirmed`(판정 J-126) | UC-07/basic, 22/AX-10 | scenario, unit |
| AC-07-08 미룬 반영 항목이 다음 복귀 요약 맨 위 | UC-07/basic(`view: brief`) | scenario |
| AC-07-09 정상 경로 2건, A1은 1건(이벤트 종류로 계산, 조건부 확인 뒤에도 유지, 판정 J-125) | UC-07/basic, UC-07/A1(`humanOps`), 14/C-14 | scenario, unit |
| AC-07-10 커널이 닫는 항목과 사람만 닫는 항목 | UC-07/basic, 10/UT-12 | scenario, unit |
| AC-07-11 테스트 통과 제출 ≠ 자동 결과 확인 | UC-07/basic, 22/V02-10 | scenario |
| AC-07-12 정본 이벤트 직접 추가·`projection.*` 명령 → 경로 거부 | UC-07/E4, helm-toy n21, 22/V02-04, 22/V02-05 | scenario, unit |
| AC-07-13 `basisSeq` 뒤 대상 변경 → `conflict.version_mismatch`·`already_resolved`·`superseded`, 마지막 쓰기가 이기지 않음 | UC-07/cx-06, 19/CT-18, 19/CT-19 | scenario, conf |
| AC-07-14 빈·무의미 완료 기준 합의는 활성 안 됨 | UC-07/basic(거부 단계), 22/V02-03 | scenario |
| AC-07-15 합의 활성 시 되돌릴 지점 등록 | UC-07/basic, 13/T-RB-01 | scenario, unit |
| AC-07-16 Helm이 계산한 "되돌릴 수 있음" 값이 없음 | 22/ST-01 | unit(정적) |
| AC-07-17 결과 확인 화면에 기준별 판정과 함께 남은 전제(활성 가정), 모르는 점, 결과를 무효로 만들 조건(`invalidIf`)이 보이고, 반영 단계에 어떤 가정이 확인되거나 깨졌는지 기록된다 | UC-07/basic, 04/UT-09(SCR-REVIEW) | scenario, ui |

**UC-09 Goal 정제 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-09-01 에이전트는 Goal을 직접 못 바꿈 | UC-09/basic(거부 단계), 22/DR-5, 10/PT-17 | scenario, unit, prop |
| AC-09-02 수정 제안은 근거와 차이 필수 | UC-09/basic(거부 단계) | scenario |
| AC-09-03 이전 버전 유지, 원인 이벤트, 참조 합의 "다시 확인" | UC-09/basic | scenario |
| AC-09-04 넓어지지 않는 합의 갱신은 echo | UC-09/basic(`humanOps` 변화 없음) | scenario |
| AC-09-05 거절된 차이는 새 근거 없이 다시 기록 안 됨 | UC-09/A1 | scenario |
| AC-09-06 Goal 수정 질문은 만료·가정 확정 없음 | UC-09/A2, 10/PT-09 | scenario, prop |

**UC-10 데몬 재시작·연결 끊김 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-10-01 각 단계 강제 종료 뒤 수락된 명령·이벤트 보존 | 22/FI-01, 22/FI-02 | fault |
| AC-10-02 의도만 있는 호출은 모두 interrupted·outcome_uncertain로 정리 | UC-10/B1, 12/T-CR-02, 12/T-CR-03, 22/FI-03, 22/FI-14, 22/FI-27 | scenario, unit, fault |
| AC-10-03 재실행 안전 선언 도구만 자동 재실행 | UC-10/B1, 12/T-CR-04 | scenario, unit |
| AC-10-04 결과 불확실 외부 행동은 재실행 안 함, "보냄/보내지 않음" 기록 뒤 진행 | UC-10/B3, 12/T-CR-08, 22/FI-05 | scenario, unit, fault |
| AC-10-05 중단 동안 지난 타이머 처리, 예정·실제 시각 기록 | UC-10/B2, 12/T-SC-02, 22/FI-12 | scenario, unit, fault |
| AC-10-06 재연결 뒤 빠진 이벤트 순서대로, 초안 자동 전송 없음, 끊긴 명령만 재전송 | UC-10/A, 19/CT-12, 20/IT-06, 22/FI-25, 22/FI-29, 22/FI-30 | scenario, conf, e2e |
| AC-10-07 재시작부터 복구 완료까지 30초, 복구 요약은 복귀 요약 복구 절, 사람 판단 항목만 복구 화면 | UC-10/B1(`view: brief`, `view: recovery`), 22/PF-08 | scenario, perf |
| AC-10-08 모델 제공자 장애 중에도 사람 명령 NFR-P-1 안 | UC-10/B4, 22/FI-23, 22/PF-02 | scenario, fault, perf |
| AC-10-09 기록 검사 실패 시 새 이벤트 0(`daemon.booted` 포함) | UC-10/B5, 09/UT-13, 17/T17-34, 19/CT-17 | scenario, int, conf |

**UC-11 처음 설치·기기 페어링 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-11-01 설치 레시피 두 번 실행해도 데이터 보존 | 22/SY-01 | sys |
| AC-11-02 데몬은 127.0.0.1:7840·7841과 `rpc.sock`(0600)에서만 들음 | 06/S3(설정 거부), 22/SY-02(실제 열린 소켓 목록) | int, sys |
| AC-11-03 페어링 코드 1회용·만료(`pairing.code_expired`)·시도 상한(`pairing.code_failed`) | 18/T18-15, 19/CT-32, UC-11/E1 | sec, conf, scenario |
| AC-11-04 기기 토큰은 OS 키체인에만 | 20/DM-02(manual 포함), 20/DM-08, 18/T18-18 | unit, manual, sec |
| AC-11-05 폐기 기기 연결 즉시 끊김 | 18/T18-17, 19/CT-16, UC-11/A2 | sec, conf, scenario |
| AC-11-06 비밀이 없을 때 키 이름만 | UC-11/E3, 17/T17-10, 17/T17-32 | scenario, int |
| AC-11-07 런타임 데이터는 `~/projects` 밖 | 06/S3, 09/UT-07 | int |
| AC-11-08 첫 Goal은 모델 초안에서 시작 | UC-11/basic, 22/E2E-UC11 | scenario, e2e |

**UC-12 실행 중 방향·기준 바꾸기 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-12-01 기준 변경 뒤 낡음 표시, 옛 기준으로 계속 안 함 | UC-12/basic, 22/V02-09 | scenario |
| AC-12-02 사람이 시작한 축소 변경은 확정 질문 없음 | UC-12/basic(`absent: question.recorded`) | scenario |
| AC-12-03 다음 턴 경계 반영, 원자 실행은 끝난 직후 | UC-12/basic, 12/T-IN-03 | scenario, unit |
| AC-12-04 다이얼 변경의 층 기록, 다음 턴 경계 적용 | UC-12/basic, 14/C-10 | scenario, unit |
| AC-12-05 안전하게 멈추기·작업 중단·즉시 끊기 구분 | UC-12/A2, UC-12/A3, UC-12/A4 | scenario |

**UC-13 새 근거로 다시 열기 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-13-01 근거 실제(해시) 변경 → 근거와 판단 낡음 | UC-13/basic, 22/AX-13(a) | scenario, unit |
| AC-13-02 다시 볼 조건 판정 결정성, `record.staled` + `concern.reopened` | UC-13/basic, 22/AX-13(c) | scenario, unit |
| AC-13-03 낡은 판단·선택은 "평가"에 | UC-13/basic(`view: brief`) | scenario |
| AC-13-04 낡은 판단 근거 선택 요청·승격 거부 | UC-13/basic(거부 단계), 22/AX-13(b) | scenario, unit |
| AC-13-05 다시 열린 선택은 사람 전에는 안 바뀜 | UC-13/basic, UC-13/A1 | scenario |

**UC-15 가벼운 작업과 승격·강등 (MVP)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-15-01 가벼운 작업도 write 전 합의(`direct_instruction`) | UC-15/basic, 22/DR-1(J-01 판) | scenario, unit |
| AC-15-02 정상 경로 결정 조작 1회 | UC-15/basic(`humanOps`) | scenario |
| AC-15-03 Goal(또는 자리표시 Goal) 연결 | UC-15/basic, 22/AX-01 | scenario, unit |
| AC-15-04 승격 신호 하나에 제안 1건, 거절 뒤 재기록 없음 | UC-15/A1, UC-15/A2, 14/C-11 | scenario, unit |
| AC-15-05 승격 Concern은 가벼운 작업 기록 참조 | UC-15/A1 | scenario |
| AC-15-06 강등은 자율 기록, 이의 가능 | UC-15/A3 | scenario |
| AC-15-07 CT-1~CT-3 계산 가능 | 16/OB-T22(UC-15 대본의 이벤트 열을 골든 입력으로) | unit |

**UC-17 다른 기기에서 이어 하기 (MVP: 기기 전환)**

| AC | 테스트 | 계층 |
|---|---|---|
| AC-17-01 같은 cursor에서 두 기기 투영 같음 | UC-17/basic(두 기기 `view` 비교), 12/T-VW-01 | scenario, unit |
| AC-17-02 한 기기의 복귀 확인이 다른 기기에 적용 | UC-17/basic | scenario |
| AC-17-03 (3단계) 클라이언트 전용 업무 동작 없음 | 03/UT-07(TUI parity 표) | unit |
| AC-17-04 (이후) 어댑터와 같은 의미 이벤트 | 13/AC-12, 22/CF-04 | conf |

**2단계·3단계 유즈케이스 (기능 플래그가 켜질 때 활성)**

| AC | 테스트 | 계층 | 단계 |
|---|---|---|---|
| AC-08-01 관찰 실행은 클라이언트 없이 스케줄러로 | UC-08/basic, 16/OB-T01 | scenario, unit | 2단계(결정적 수집은 MVP, J-07) |
| AC-08-02 제안 외 쓰기 거부 | 16/OB-T03, 16/OB-T04, 06/S7 | unit, int | 2단계(읽기 전용은 MVP) |
| AC-08-03 같은 로그 같은 수치 | 16/OB-T14, 16/OB-T15 | unit | MVP(결정적 부분) |
| AC-08-04 기각 서명 재제출 규칙 | 16/OB-T16 | unit | 2단계 |
| AC-08-05 허용 폴더 밖·자기 세션 안 읽음, 오프셋 이후만 | 16/OB-T09, 16/OB-T06, 16/OB-T20 | unit, prop | MVP |
| AC-08-06 비밀 가림, 주입 문장이 초안에 없음 | 16/OB-T10~T12 | sec | MVP(마스킹), 2단계(초안) |
| AC-08-07 채택 제안은 자동 설치 안 됨 | UC-08/A1, 16/OB-T05 | scenario, unit | 2단계 |
| AC-14-01~05 | 15/T-02, 15/T-03, 15/T-16~T-18, 13/T-RP-03, UC-14/basic | unit, scenario | 2단계 |
| AC-16-01~03 | UC-16/basic(`clock`), 11/AQ-02, 12/T-SC-01 | scenario, unit | 2단계 |
| AC-18-01~03 | UC-18/basic | scenario | 3단계 |
| AC-19-01~04 | UC-19/basic, 22/DR-4 | scenario, unit | 3단계 |

**01 §6 완료 기준의 대응**

| 01 §6 단위 | 테스트 |
|---|---|
| 진입 판정 규칙 (1)~(6) | 14/C-11, AC-01-01 |
| 승격 신호 감지(PS-1, PS-3) | 14/C-11, AC-15-04 |
| 사람 조작 기록(정상 경로는 이벤트 종류로 계산, 판정 J-76. UC-07 ≤ 2, R-OP-2 = 1) | 16/OB-T21·T22(정상 경로 사실), 11/AQ-16, 14/C-14, AC-07-09 |
| C/A·범주 지표 리포트 | 16/OB-T22 |
| 비기능 요구 측정 | 22/PF-01~PF-12 |
| 데이터 손실(NFR-D-1, NFR-D-4) | 22/FI-01, 22/FI-07, AC-04-06 |
| MVP 완료(§3.8.3 다섯 항목) | §3.17.3 |

### 3.9 장애 주입

#### 3.9.1 주입 수단

| 수단 | 어디서 | 하는 일 | 소유·요구 |
|---|---|---|---|
| 저장소 고장 주입 지점 | `@helm/store/testing` | `faultInjector(point)`가 예외를 던진다. 지점: `after_fence`, `after_decide`, `after_event_insert:<n>`, `after_projection:<n>`, `before_command_insert`, `before_trace_insert`, `before_commit`(09 §3.8.4 [원문 helm-kernel-v02 `faultInjector`]) | 09 |
| SQLite 오류 주입 | `@helm/store/testing` | 다음 n번의 쓰기에서 `SQLITE_FULL`·`SQLITE_IOERR`·`SQLITE_CORRUPT`를 낸다. better-sqlite3 문장 실행 래퍼에서 던진다 | 09에 요구(테스트 전용 API) |
| 같은 프로세스 크래시 | 하네스 `world.crash()` | 데몬 인스턴스를 정리 없이 버린다: 저장소 핸들을 닫고(이후 쓰기는 `Fenced`), 런타임의 대기 중인 Promise를 끊고, 타이머를 버린다. 도구 자식 프로세스는 프로세스 그룹째 SIGKILL. 그다음 `restart`가 같은 데이터 디렉터리로 새 인스턴스를 부팅한다 | 22 |
| 종료 지점 SIGKILL | 자식 프로세스로 띄운 데몬(`*.kill.test.ts`) | 환경 변수 `HELM_TEST_KILLPOINT=<이름>[:<n번째>]`가 있으면 데몬이 그 지점의 n번째 도달에서 `process.kill(process.pid, 'SIGKILL')` | 12·17에 요구(§3.9.2) |
| 연결 장애 | `@helm/client/testing`의 가짜 전송, 19 `FakeDaemon` 조작, 실제 리스너 앞의 TCP 프록시(`tests/harness/net-proxy.ts`) | 응답 전 끊기, 커밋 뒤 응답 전 끊기, 구간 건너뛰기, 느린 소비자(읽기 멈춤), tick 멈춤 | 19, 20 |
| 시계 | `ManualClock.set` | 앞으로·뒤로 점프, 긴 정지 뒤 재개(WSL 일시정지 흉내, 06 F16) | 22 |
| 모델 장애 | 테이프 `error`·`stall` | 인증 오류, 속도 제한, 과부하, 콘텐츠 뒤 오류, 무응답 | 12 |
| 도구 장애 | `FakeToolExecutor`, 실제 도구 | 걸림, 신호 무시(17 T17-07), 출력 폭주, 결과 없음 | 13 |
| 파일 장애 | 테스트 코드 | DB 페이지 바이트 바꾸기, WAL 파일 지우기·자르기, 데이터 디렉터리 읽기 전용 바꾸기, 이벤트 행 수정(트리거 제거 후) | 09, 17 |
| 디스크 가득 | `SQLITE_FULL` 주입(verify), 크기 제한 tmpfs(`sys`) | §3.9.3 FI-16 | 17 |

#### 3.9.2 종료 지점 [제안]

데몬 코드에 이름 붙은 지점을 둔다. 운영 빌드에서도 코드는 있지만 `HELM_TEST_HOOKS=1`이고 데이터 디렉터리가 운영 경로가 아닐 때만 켜진다(운영 데이터에서 켜지지 않게 `assertNotProduction`과 같은 검사).

| 이름 | 위치 | 관련 불변조건 |
|---|---|---|
| `run.before_message_commit` | 12 싱크, assistant `message_end` 커밋 전 | CR-2 |
| `run.after_message_commit` | 같은 곳, 커밋 직후 | CR-2 |
| `tool.before_intent_commit` | 12 `beforeToolCall`, `toolcall.intend` 커밋 전 | CR-3 |
| `tool.after_intent_commit` | 커밋 직후, `execute` 전 | CR-3, CR-4 |
| `tool.during_execute` | 실행 중(도구가 시작 신호를 보낸 뒤) | CR-4, 13 변경 감지 |
| `tool.after_execute` | 실행 끝, 결과 커밋 전(12 E-03, E-22) | CR-4 |
| `tool.after_result_commit` | 결과 커밋 직후 | CR-4 |
| `model.during_stream` | 스트리밍 중 | 12 T-CR-01 |
| `engine.between_batch` | `commitBatch`의 명령 사이 | 09 UT-12(7) |
| `boot.during_recovery` | 부팅 복구 11단계 중간(09 §3.8.2) | 복구의 멱등(두 번 연속 크래시) |
| `boot.during_migration` | 마이그레이션 트랜잭션 안 | 17 T17-08, T17-15 |
| `ops.during_backup` | 온라인 백업 중 | 17 T17-17 |
| `store.during_rebuild` | 투영 재구성 중 | 09 UT-15 |
| `orchestrator.after_command` | 오케스트레이터 명령 실행 뒤 체크포인트 전 | 14 C-20 |
| `scheduler.after_fire` | 타이머 발화 명령 커밋 뒤 | 12 T-SC-03 |
| `approval.after_consume` | 승인 실행 run이 `toolcall.started`·`approval.consumed`를 커밋한 직후 | FI-14, CR-4 |
| `restore.after_reapply` | 복원 뒤 위험 이벤트 재적용 중 | FI-20, FI-26 |

- 결정적 실패(FI-27)는 종료 지점이 아니라 고장 주입 훅(`HELM_TEST_FAULT=<지점>:always`)으로 만든다. 켜는 조건은 종료 지점과 같다.
- 12 T-CR-09("kill 시점을 무작위로 바꾼 장애 주입 100회에서 CR-1~CR-4 위반 0")는 `just test-faults`에서 위 지점과 `n`을 고정 시드로 고른 100회로 돈다(D22-7과 같은 방식: 시드 목록 커밋, deep에서는 새 시드).

#### 3.9.3 장애 시나리오

| ID | 장애 | 방법 | 기대(소유 문서) | 계층·레시피 |
|---|---|---|---|---|
| 22/FI-01 | 대본의 모든 단계 경계에서 데몬 크래시 | UC-07/basic을 단계마다 끊고 다시 시작해 끝까지 진행(단계 수만큼 실행) | 수락 응답을 받은 명령·이벤트 모두 보존(NFR-D-1, AC-10-01), 최종 이벤트 열이 크래시 없는 실행과 semantic 동일(재개 run·`run.interrupted` 같은 복구 이벤트 제외) | fault, `just test` |
| 22/FI-02 | 커밋 사이 크래시(트랜잭션 안) | 09 고장 주입 지점 전부 × 대표 명령 5종 | 롤백, seq 빈칸 없음, 같은 명령 재제출 성공(09 UT-12(3)(4)) | fault, `just test` |
| 22/FI-03 | 도구 실행 중 크래시: read·write·edit·bash | `tool.after_intent_commit`, `tool.during_execute`, `tool.after_execute`에서 SIGKILL | read 재실행, bash는 `toolcall.interrupted`(질문 없음, J-44), write는 해시 guard 세 경우(`hash_verified` / 재개 때 재검사 뒤 `replay_started`(J-41) / interrupted)(12 T-CR-02), 메시지만 커밋된 호출은 실행 안 함 기록(12 T-CR-03), 정리되지 않은 의도 0(AC-10-02) | fault, `just test-faults` |
| 22/FI-04 | 도구 실행 중 크래시: 고아 자식 | bash가 오래 도는 자식을 띄운 뒤 데몬 SIGKILL | 재시작 때 pid + 시작 시각 일치로 프로세스 그룹 종료, 호출은 `interrupted`(06 F12) | fault, `just test-faults` |
| 22/FI-05 | send(git push) 실행 중 크래시 | 로컬 bare 저장소를 원격으로 둔 push, `tool.during_execute` | 재실행 안 함, `toolcall.outcome_uncertain` + 복구 질문, 확인 조회로 "보냄" 정리(12 T-CR-08, AC-10-04, UC-10 B3, J-44) | fault, `just test-faults` |
| 22/FI-06 | 스트리밍 중 크래시 | `model.during_stream` | 부분 출력 버림, 재요청(12 T-CR-01, NFR-D-2) | fault, `just test-faults` |
| 22/FI-07 | 응답 전 연결 끊김 + 재전송 | `drop_connection(after_commit_before_response)` → 재접속 → 같은 멱등 키 | 한 번만 적용, `duplicate: true`(19 CT-12, 20 IT-06, 원전 수락 기준 #13) | conf, `just test` |
| 22/FI-08 | 같은 키가 두 연결에서 동시에 | 두 클라이언트가 같은 키로 동시 전송 | 하나는 기다려 `duplicate: true`(19 CT-30) | conf, `just test` |
| 22/FI-09 | gap: 서버가 구간을 건너뜀 | `skip_seq` | 클라이언트 재구독, 반복되면 재접속(19 CT-10, UT-11) | conf, `just test` |
| 22/FI-10 | 재생 중 데몬 재시작 | 재전송 1만 건 중간에 `crash` + `restart` | 마지막 `to`부터 이어서, 누락·중복 없음, `bootEpoch` 바뀜(19 CT-27, 20 IT-03) | conf, `just test` |
| 22/FI-11 | 타이머 경합: 답과 만료가 같은 시각 | 정보 게이트 질문의 만료 시각에 사람 답 명령과 만료 타이머가 같은 `now`로 들어옴(두 순서 모두) | engine 직렬화로 하나가 먼저. 답이 먼저면 만료 타이머는 상태를 보고 아무것도 하지 않음. 만료가 먼저면 답은 3008로 거부되고 응답에 확정된 값(`assumedValue`)과 다음 행동 "이의로 보내기"가 실린다(판정 J-120). 앱은 쓰던 답을 이의 초안으로 넘긴다(20 시험). 어느 순서든 질문의 끝 상태는 하나이고 `question.answered`와 `question.assumed`가 같은 질문에 함께 생기지 않는다 | fault, `just test` |
| 22/FI-12 | 다운타임 중 만기 타이머 | `crash` → 시계 3시간 진행 → `restart` | catch-up 상한 5·간격, run 타이머 2분 지연, 예정·실제 시각 기록(12 T-SC-02, AC-10-05). 막지 않는 질문의 가정 만료는 정지 시간이 만료 여유보다 길면 "복귀 + 30분"으로 미뤄지고, 다이얼로 끄면 미루지 않는다(판정 J-142) | fault, `just test` |
| 22/FI-13 | 타이머 중복 발화·시계 점프 | 같은 타이머 두 번 발화, 시계 뒤로 10분, 앞으로 하루 | 같은 키로 한 번만 처리(12 T-SC-03), 이벤트 시각 단조(17 T17-19), 시계 점프 전후 동작(12 T-SC-04) | fault, `just test` |
| 22/FI-14 | 승인된 행동 실행 중 크래시 | 권리 게이트 답 뒤 새 run이 같은 tcId로 `toolcall.started`·`approval.consumed`를 커밋한 다음(J-40) `tool.during_execute`·`tool.after_execute`에서 SIGKILL. 도구별로 (a) send(git push, replay never) (b) 해시 guard가 있는 write (c) 읽기 전용 safe 도구 (d) `approve_edited` 변형 | 부팅 정리는 run과 무관하게 상태 `started`·`replaying`인 호출을 모두 찾는다. 의도를 커밋한 run이 원래 run(`ended(handed_off)`)과 달라도 빠지지 않는다(12에 요구). (a) 재실행 0, `toolcall.outcome_uncertain` + 복구 질문, 승인은 다시 소진되지 않음 (b) 해시 guard로 판정(J-41) (c) 재실행 허용 (d) 원 호출은 `denied(edited_by_human)`, 새 tcId(원 tcId와 질문 id에서 결정적)가 승인을 1회 소진(판정 J-117·J-121). 재개 run이 같은 `tc:<id>:start:approved` 키로 낸 intend가 `replayed: true`로 돌아오면 실행하지 않고 "이미 시작됨"으로 다룬다. 모든 경우 가짜 원격의 push 수신은 1회 이하(10 PT-15, 11 AQ-15) | fault, `just test-faults` |
| 22/FI-15 | 부팅 복구 중 다시 크래시(일시적 실패) | `boot.during_recovery` 연속 2회 | 세 번째 부팅에서 복구 완료(결정적 실패는 FI-27), 복구 이벤트 중복 없음(내부 멱등 키, 09 §3.9.3). 10분 3회 비정상 부팅이면 안전 모드(12 T-CR-07, 17 T17-09) | fault, `just test-faults` |
| 22/FI-16 | 디스크 가득 | (a) `SQLITE_FULL` 주입 (b) `sys`: 사용자·마운트 네임스페이스(`unshare --user --map-root-user --mount`) 안의 크기 8 MiB tmpfs에 데이터 디렉터리를 두고 채움 [가정: 이 서버의 비특권 네임스페이스 허용 여부는 구현 때 확인] (c) 외부 효과 도구(push) 실행 뒤 완료 커밋이 `SQLITE_FULL`로 실패 | (a)(b) 데몬 생존, 헬스 critical, 새 실행 거부, 공간이 생기면 재개(17 T17-12). 이미 수락한 명령 손실 없음 (c) 결과가 파일(12·17이 위치를 정함, 제안 `state/pending-results/<tcId>.json`, fsync)에 남고, `disk_critical` 해제 때 다른 쓰기보다 먼저 커밋된다. 그 thread가 `thread_busy`로 막히지 않고, 현재 epoch의 남은 run이 부팅 복구와 같은 규칙으로 정리된다. 결과를 잃은 경우에는 복구 질문으로 남는다 | fault `just test`, sys `just daemon-systest` |
| 22/FI-17 | DB 손상: 이벤트 변조 | `corrupt_log(tamper_event)`: 트리거를 지우고 envelope 한 글자 변경 | `hash_mismatch`, 읽기 전용 시작(17 `read_only`), 새 이벤트 0(09 UT-13, AC-10-09, UC-10 B5), 클라이언트는 `5003`(19 CT-17) | fault, `just test` |
| 22/FI-18 | DB 손상: 체인 재계산 위조 | `rehash_without_key` | `checkpoint_hmac`(09 UT-13(3)), 기준점 검사 실패(18 T18-23) | fault, `just test` |
| 22/FI-19 | DB 손상: 페이지·WAL | DB 페이지 바이트 변경, WAL 자르기 | `quick_check` 실패 → 시작 거부 또는 읽기 전용, 백업 검증 실패(17 T17-16), 복구 절차로 복원(17 T17-20) | fault, `just test-slow` |
| 22/FI-20 | 백업 복원 훈련 | 쓰기 부하 중 백업 → 복원 → 체인·투영 요약 비교. 백업 뒤에 기기 폐기, Grant 철회, 합의 철회·축소, 다이얼 하향, `blob.redacted`를 한 뒤 복원 | 17 T17-16, T17-20, T17-29. 복원 뒤 이전 `lastSeq` 클라이언트는 스냅숏 경로(17 T17-21, 19 CT-08). 백업 뒤의 철회·축소·하향·가림이 복원 뒤에도 유지된다(격리한 현재 DB에서 넘긴 위험 이벤트를 데몬이 `store.restored` 직후 다시 적용, 투영 재구성 뒤에도 유지, 18 T18-22 확장). 재적용 전에는 리스너가 열리지 않는다 | fault, `just test-slow` |
| 22/FI-21 | 실제 백업 원본에서 복원 훈련(사람) | restic에서 꺼낸 스냅숏으로 `just daemon-drill --file …` | 17 §3.9 절차대로 통과. 결과를 `tests/trace/manual.json`에 기록. MVP 완료 전 1회, 이후 분기 1회(17 Q17-05) | manual |
| 22/FI-22 | WSL 종료 | (a) 자동 근사: 데몬·도구 자식·관찰 자식을 cgroup째 SIGKILL(`systemctl --user kill --signal=SIGKILL helmd.service`) 후 재시작 (b) 실제 `wsl --shutdown`(사람, 17 T17-30) | (a) FI-03·FI-04와 같은 기대, 관찰 자식은 다음 회차에 오프셋부터(UC-08 E3) (b) 비정상 종료 기록, 복구, 클라이언트 재접속. 전원 차단과 같은 쓰기 유실 여부는 `synchronous=FULL`(09)에 기대며 자동 시험으로 확인하지 못한다 [가정] | sys `just daemon-systest`, manual |
| 22/FI-23 | 모델 제공자 장애 | 테이프 `error`(rate_limited, overloaded, auth) 연속, 모든 후보 연결 오류, `stall` | 재시도·대체(12 T-AI-03·T-AI-04). 모든 후보가 연결 오류면 run은 `ended(failed, model_unreachable)`로 끝나고 상태는 17 상태 확인과 trace에 보인다. 도메인 관찰은 만들지 않는다(판정 J-109). `progress_stall` 질문이 생기지 않고, 회복 신호 뒤 14가 다시 요청한다. 그동안 사람 명령은 처리된다(AC-10-08, NFR-O-3) | fault, `just test` |
| 22/FI-24 | 느린 소비자·투영 지연 | 클라이언트 읽기 멈춤, 투영 지연 주입 | 4008 뒤 재접속 누락 없음(19 CT-13, 20 IT-14), `2006` 뒤 재시도(19 CT-29) | conf, `just test` |
| 22/FI-25 | 다른 연결·다른 리스너에서 같은 키 재전송 | (a) `tailnet`으로 보낸 명령이 커밋 뒤 응답 전 끊김 → `loopback`(SSH 경로)으로 같은 키·같은 params 재전송 (b) 같은 경로의 새 연결 (c) run attempt가 바뀐 뒤 같은 내부 멱등 키 재제출 | 셋 모두 `duplicate: true`로 저장 결과 재생, `3006`이 아님. 멱등 지문은 연결·리스너·attempt와 무관하다(09 지문 입력 `{type, actor, viaKey(via), payload}`, 19에 요구). 진행 중 명령이 결과를 모른 채 지워지지 않는다(NFR-D-4, AC-10-06) | conf, `just test` |
| 22/FI-26 | 복원 뒤 자동 재개 없음 | 스냅숏 시점에 쓰기 중인 running run, 곧 발화할 에이전트 타이머, 미소진 `approval.issued`(push)가 있는 백업을 만든다. 백업 뒤 실제로 push가 나간 다음 그 백업으로 복원한다 | 복원을 마칠 때 17이 복원 표지 `store.restored`를 남긴다(09의 정본 이름, [판정 J-152]). 그 표지 뒤 첫 부팅은 12의 안전 모드다: run 자동 재개 0, 에이전트 타이머·관찰 실행·14의 새 실행 0, 소진되지 않은 승인은 만료로 닫히고 다시 묻는다. 가짜 원격의 push 수신은 1회 그대로다. 복귀 요약의 "복원 지점 이후 기록 없음" 표시는 04가 소유하며 표지 이벤트를 읽어 그린다(04 화면 시험, `view: brief`에서 표지 참조 확인). 표지가 없는 보통 부팅에서는 안전 모드로 들어가지 않는다. 업그레이드 되돌리기(17)도 같은 대본으로([판정 J-152]). 안전 모드를 푸는 시험은 `helm ops safe-mode off`([판정 J-153])와 19 `daemon.exitSafeMode`([판정 J-165])로 한다 | fault, `just test-slow` |
| 22/FI-27 | 결정적 부팅 복구 실패 | 고장 주입 훅으로 (a) 12단계 `recover()`가 특정 run에서 매번 예외 (b) 9단계 투영 재구성이 매번 실패 | (a) 실패한 run만 `ended(failed, recovery_error)`와 복구 항목으로 남고 다른 run은 정리되며 데몬이 뜬다 (b) 읽기 전용 시작(사유 `recovery_failed`): 리스너가 열려 앱에서 상태를 보고, 쓰기 명령은 `5003`. 비정상 종료 기록이 크래시 루프 계산에 들어가 systemd `failed`까지 가지 않는다. 복구 멱등 키는 12 형식이며 연속 부팅에서 복구 이벤트가 중복되지 않는다 | fault, `just test-faults` |
| 22/FI-28 | 데몬이 살아 있는 동안 외부 효과 호출의 비정상 종료 | 가짜 원격이 응답하지 않아 push가 bash 타임아웃, 실행 중 cooperative 취소, HTTP MCP 서버 프로세스 kill | 셋 모두 `toolcall.outcome_uncertain` + 사람 확인. 모델에게 일반 오류 결과로 가지 않고 같은 행동의 자동 재시도는 0이다(12 §3.4.6, 13 T-E14·T-E25 기대 수정 요구). 외부 효과 없는 도구(read)의 타임아웃은 일반 오류 결과 | fault, `just test` |
| 22/FI-29 | 복원 뒤 재접속과 진행 중 명령 | 클라이언트가 응답 전 끊긴 명령을 가진 채 데몬 DB가 복원된다(`storeId` 바뀜). 위치 저장소를 지운 클라이언트 변형 포함 | `hello`의 `storeId`가 저장 위치와 다르면 재전송 전에 캐시를 비운다. 보낼 때의 `storeId`가 다른 진행 중 명령은 자동 재전송하지 않고 "보내지 못한 조작"으로 보인다. 복원된 DB에 같은 명령이 다시 적용되지 않고, 재전송이 `events.subscribe`의 `2001`보다 먼저 나가지 않는다(19 CT-08 확장, 20 PendingRow) | conf, `just test` |
| 22/FI-30 | 재페어링 뒤 진행 중 명령 | 기기 폐기 → 재페어링(새 `deviceId`) 뒤 남은 진행 중 명령. 복원으로 기기가 사라져 다시 페어링한 변형 | 보낼 때의 `deviceId`가 다르면 자동 재전송 0, 사람에게 보인다. 처음 명령이 이미 커밋됐어도 두 번 적용되지 않는다 | conf, `just test` |
| 22/FI-31 | 절전 복귀 | 스케줄러 tick 없이 `ManualClock`을 3시간 진행(Windows 절전 흉내) | `now − lastTickAt > 2분`이면 부팅 catch-up과 같은 상한·간격으로 지난 타이머를 처리한다. run 벽시계 감시는 단조 시계로 재므로 복귀 직후 실행 중 run을 멈추지 않는다(12 요구) | fault, `just test` |
| 22/FI-32 | 투영 갱신 실패 | 투영기 예외를 1회, 그리고 반복 주입 | 1회: 커밋 전체 롤백, 같은 명령 재제출 성공. 반복: 17이 읽기 전용(사유 `projection_fault`)으로 바꾸고 사람이 `rebuild`한 뒤 쓰기 재개(판정 J-129) | fault, `just test` |

#### 3.9.4 장애 뒤 공통 검사

`tests/harness/invariants.ts`의 `checkCrashInvariants(dataDir, ackedCommands)`. 모든 FI와 `expect.invariants`가 있는 대본 단계가 부른다.

1. 수락 응답(또는 `accepted` 결과)을 받은 명령의 `commandId`가 모두 `commands` 테이블에 있고 그 이벤트가 로그에 있다(NFR-D-1).
2. seq에 빈칸이 없다. `verify --full`(09 §3.10.4)이 통과한다(손상 시험 제외).
3. 의도(`toolcall.started`)마다 종결 기록이 정확히 하나다(CR-4). 의도를 커밋한 run이 무엇이든(승인 실행 run, `ended(handed_off)`된 원래 run 포함) 모든 호출을 대상으로 본다. 의도 없는 실행 기록이 없다(CR-3).
4. assistant 메시지의 도구 호출 배치가 도구 준비보다 먼저 커밋됐다(CR-2, trace 순서로 확인).
5. 부팅 복구가 끝난 뒤 모든 run 상태에 걸쳐 상태 `started`·`replaying`인 호출이 0이고 `running` run이 없다(AC-10-02). `awaiting_*` run은 그대로 둔다(J-39). 커널이 run을 `awaiting_recovery`로 옮긴 경우 그 run에 `run.end`가 더해지지 않는다(판정 J-122).
6. 증분 투영 행 해시 = 재구성 투영 행 해시(09 UT-14(2)).
7. 비밀 카나리아가 어디에도 없다(§3.11.2).
8. 같은 프로세스 크래시 뒤 이전 인스턴스가 쓴 행이 없다(`Fenced`, 09 UT-11).
9. 외부 효과의 실제 횟수: 가짜 원격 저장소·가짜 푸시 서비스·가짜 HTTP 서버의 수신 기록에서 같은 tcId의 효과가 1회 이하다. 이벤트 로그만 보면 두 번 나간 발송을 놓치므로 받는 쪽 기록으로 센다.

### 3.10 적합성 시험

#### 3.10.1 프로토콜: 세 리스너 동등성

| ID | 대상 | 방법 | 기대 | 레시피 |
|---|---|---|---|---|
| 22/CF-01 | `tailnet`·`loopback`·`local` 리스너(같은 프로세스, 임시 포트·임시 소켓) | 19 §6.3 적합성 스위트(CT-01~50)를 세 리스너에 각각 돌린다. 리스너가 생긴 뒤에는 `protocol` 모드 대본(UC-04/basic, UC-04/B, UC-04/resend-other-listener, UC-10/A, UC-17/basic)도 더한다(§3.8.2 선행 조건). `tailnet`의 Tailscale 신원 헤더는 테스트 훅으로 넣는다(19 §6.3 (2), 가짜 whois 18 T18-02). 한 리스너에서 보낸 명령을 다른 리스너에서 같은 키로 다시 보내는 시험(FI-25)을 포함한다 | JSON-RPC 메시지 열(요청 id·시각·nonce·연결 ID 정규화) 같음, 이벤트 로그 semantic 같음(리스너·`via` 제외)(06 S5, 02 AC-04-04, 결정 38). 다른 리스너 재전송은 `duplicate: true`. 리스너별 사전 검사 차이(19 §3.2.1)는 기대 목록에 명시 | `just test` |
| 22/CF-02 | `ssh -W` 실제 경로 | WSL sshd(127.0.0.1:22)와 시험 키로 `loopback` 리스너에 `ssh -W localhost:<port>` 바이트 스트림을 열고 CF-01의 스위트를 돈다(06 S6, 19 §6.3 (4), 20 `app-test-ssh`와 같은 환경) | CF-01과 같은 메시지 열 | `just test-conformance-ssh`(sshd·시험 키 없으면 종료 코드 2) |
| 22/CF-03 | `FakeDaemon` 대 실제 데몬 | 19 §6.3 스위트를 `FakeDaemon`과 실제 데몬 양쪽에 | 같은 결과(19 UT-08). 앱 시험(20 IT-01~20)이 `FakeDaemon`을 믿을 근거 | `just test` |
| 22/CF-05 | 클라이언트 코어 대 리스너 | `@helm/client`(node 전송)를 세 리스너에 붙여 재접속·재전송 시나리오(19 UT-09~14 중 통합 판) | 같은 상태 전이 | `just test` |

- v0.2 실행 후보의 핸드셰이크 불변 항목 네 개(`adapter-cannot-append-events`, `projection-is-derived`, `expected-cursor-required`, `guided-human-gates`, 19 §6.3 끝)는 CF-01 스위트에 들어 있다.
- 19 §6.3 (4)의 "CI에서 sshd를 띄울 수 있을 때"는 이 문서에서 `just test-conformance-ssh`(서버)로 바꾼다(D22-14, §5.2 19 요구).

#### 3.10.2 런타임 어댑터

| ID | 대상 | 방법 | 기대 |
|---|---|---|---|
| 13/AC-01~AC-14 | 자체 런타임 어댑터(Level D) | `@helm/runtime/testing`의 `runAdapterConformance(adapter)`. 대본: helm-toy runtime판(UC-02/helm-toy), UC-07/basic, 연결 끊김·중복 관찰·취소 대본 | 13 §3.11.7 표 |
| 13/T-AD-02 | `deriveLevel`, 성질별 수준 계산 | 표 시험 | 13 §3.11.5 |
| 13/T-AD-03 | 가짜 Level B 어댑터 | 낮춘 동작(13 §3.11.6)으로 같은 도메인 결과 | 13 §3.11.6 |
| 22/CF-04 | 거짓 광고 가짜 어댑터 | `preToolIntercept: enforced`를 광고하지만 차단을 무시하는 가짜, `toolResultIds`를 광고하지만 ID를 바꾸는 가짜 | 적합성 시험이 실패한다(06 S9, 13 AC-01). 실패하지 않으면 시험 자체의 결함 |

- 외부 어댑터(Claude Code, Codex, pi CLI RPC, ACP)는 이후 단계다. 그때 같은 `runAdapterConformance`에 런타임별 녹화 응답(13 §3.11.7 "런타임별 녹화 응답")을 테이프로 넣는다. 02 AC-17-04는 그때 활성화한다.

#### 3.10.3 외부 세션 로그 어댑터

16 OB-T27: pi(v1 선형, v3 트리), Claude Code(본문·하위 에이전트·메타), Codex(픽스처가 생길 때까지 꺼짐 상태 시험만) 각 어댑터가 합성 픽스처 묶음 적합성(정규화 결과 골든)을 통과해야 설정에서 켤 수 있다. 픽스처 규칙은 §3.6.3.

#### 3.10.4 pi 포크 무결성 (07 §3.19)

| 묶음 | ID | 위치 | verify |
|---|---|---|---|
| import 무결성 | 07/I1 | `packages/ai/test/pi-integrity.test.ts`, `packages/tools/test/…`, `apps/tui/test/…`(TUI 단계) | 넣는다 |
| vendor 동기 검사 | 07/I2 | `just vendor-verify`(`scripts/vendor/sync.mjs verify`) | 넣는다(06 §3.16) |
| export 표면 | 07/I3 | `vendor/*/test/surface.test.ts` | 넣는다 |
| pi 경계 | 07/I4 | `scripts/vendor/check-pi-boundary.mjs`(`just check-arch`와 함께) | 넣는다 |
| 모델 타입 대입 | 07/I5 | `packages/ai/test/model-types.test.ts`(타입 검사) | 넣는다 |
| 동작 계약 | 07/C1~C25 | 07 §3.19.2 위치 표 | 넣는다 |
| 업스트림 테스트 | 07/V2(2), 07/V3(2) | `vendor/pi-agent-core/test/`(37건, A5 기대값 1건 수정), `vendor/pi-tools/test/`, `vendor/pi-image/test/`(6개 파일 137건, 1건 건너뜀) [실험: 07 시제품 173건 통과] | 넣는다. 네트워크 차단 상태에서 돈다(07 V3(4)) |
| faux `api` 고정 | 07/C17 | `packages/ai/test/contract.test.ts` | 넣는다. 테이프 재생기(§3.5.4)가 기대는 성질 |

- 업스트림 테스트는 원본 의미 유지 회귀 시험이다. `vendor-upgrade` 때 새 태그의 테스트로 바꾼다(07 §3.18.4-6). 바꾼 뒤 `just test`와 녹화 테이프 재생(§3.5.4)을 함께 돌린다.

### 3.11 보안·격리·관찰 에이전트

#### 3.11.1 배치

| 묶음 | 테스트 | 계층·레시피 | 조건 |
|---|---|---|---|
| 인증·리스너 | 18/T18-01~04·06·07·15~17·20·21 | sec(int), `just test` | 가짜 whois |
| 실제 serve·Windows 쪽 | 18/T18-05, 18/T18-12 | manual | 결과를 18 §7(A18-1, A18-3)에 반영 |
| 샌드박스 | 13/T-SB-01~04, 18/T18-08~11·14·29 | sys, `just daemon-systest` | S1(bwrap)과 S1b(`systemd-run --user`) 각각. 설치되지 않은 수준은 건너뛰고 보고서에 적는다. 둘 다 없으면 종료 코드 2 |
| 경로 정책 | 13/T-PA-01~05, 07/V5(2), 18/T18-10(통합 부분) | unit, `just test` | |
| 비밀·마스킹 | 13/T-RD-01, 18/T18-13·18·30·32, 16/OB-T10·T11, 17/T17-10·T17-32, 12/T-AI-06~08 | sec, `just test` | 비밀 카나리아(§3.11.2) |
| 사람 결정 위조 | 18/T18-19, 22/AX-06, 16/OB-T04 | sec, unit | |
| 같은 uid 로컬 관리자의 사람 결정 | TTY 확인 문자열 없는 `localAdmin` 사람 결정 명령 → 거부, TUI·TTY CLI 확인이 있으면 수락, 비대화 `localAdmin`은 읽기·관리만(판정 J-135). 18이 시험 ID를 붙인다 | sec, `just test` | 의도적 공격은 막지 못한다는 한계는 18에 기록 |
| 샌드박스 밖 데몬 git | 22/SG-01~06(§3.11.4), 13/T-SG-01~06(같은 표본), 18/T18-35 | sec(int) `just test`, sys `just daemon-systest` | 수정 방향은 13·18 |
| send 권리 게이트 | 합의 `sendTargets` 안의 send, Grant 활성 합의의 send도 승인 없이 → needs_gate(판정 J-91) | unit, scenario | 22/AX-07(b'), UC-07/send-in-scope |
| 공급망 | 18/T18-25, 07/I4(3), 07/V3(4) | sec, `just test-slow`(네트워크 차단 설치) | |
| 권한 기준선 | 18/T18-26, 13/T-PL-01 | unit | |
| 웹 읽기·내부망 차단과 외부 허용 | 13/T-WF-01~04, 13/T-WS-02, 13/T-NP-01~04, 13/T-E37·T-E41, 18/T18-27, 18/T18-34, 18/T18-47, 18/T18-50, 22/NW-01~04(§3.11.5) | sec(int), sys(18 T18-34·47, 13 T-NP-03), `just test`, `just daemon-systest` | 가짜 DNS와 가짜 응답 표로 판정한다. 실제 레지스트리 접근만 sys에서 본다 |
| 브라우저 요청 가로채기와 오염 | 13/T-BR-01~03·T-BR-07, 13/T-E45·T-E46, 12/T-RT-07d·07f, 18/T18-43·T18-46·T18-52, 22/WB-01~03(§3.11.5) | int(판정과 run 상태), sys(실제 Chrome, S1), `just test`, `just daemon-systest` | 2단계 판은 `ask` 보류까지 본다 |
| 허용 폴더 | 18/T18-28, 16/OB-T09 | sec, unit | |
| 모바일 | 18/T18-31, 26/T26-05~T26-11 | sec, `just test` | §3.12.7 |
| 관찰 에이전트 | 16/OB-T01~T05, OB-T12(주입), OB-T13(lint), OB-T20(자기 재귀), OB-T24(점검 키) | unit, sec | 합성 픽스처만(§3.6.3) |
| 복귀 점검 정답 | 18/T18-33, 16/OB-T24 | sys, unit | |

#### 3.11.2 비밀 카나리아 [제안]

- `int`·`scenario`·`conf`·`fault` 계층의 모든 데몬 인스턴스는 시작 때 `SecretStore`에 카나리아 값(`HELM-CANARY-<16자>`)을 모델 키 이름으로 넣는다. 테이프 응답 하나는 그 값을 일부러 도구 인자와 출력에 섞는다(`F-model-faux` 기본 테이프의 마지막 턴).
- 테스트가 끝나면 하네스가 다음 어디에도 카나리아 원문이 없는지 검사한다: DB 파일 전체 바이트, WAL, blob 디렉터리, 운영 로그 파일(pino 출력), 프로토콜로 보낸 모든 프레임(테스트 전송이 모아 둔 것), 진단 묶음(만든 경우). 가려진 토큰(`[REDACTED:…]`, 18 §3.10)은 허용.
- 실패 메시지는 카나리아가 나온 파일과 오프셋을 보인다. 이 검사는 18 T18-13을 모든 통합 시험으로 넓힌 것이다(22/ST-04).

#### 3.11.3 격리 시험 실행 환경

- bwrap(S1)은 지금 서버에 설치되어 있지 않다(18 §3.11.2 [실험 7]). 사람이 `sudo apt install bubblewrap`을 하기 전에는 `daemon-systest`의 S1 묶음이 "건너뜀(S1 없음)"으로 보고되고 S1b 묶음만 돈다. 13 §3.6.1 기본값이 S1이므로, MVP 완료 기준(§3.17.3)은 S1 묶음 통과를 요구한다.
- 격리 시험은 같은 uid로 도는 실제 데몬(개발 데몬 경로, `HELM_ROOT=/srv/volumes/helm/systest`)과 실제 `systemd-run --user`를 쓴다. 정식 데몬과 같은 시각에 돌아도 잠금·소켓·포트가 겹치지 않아야 한다(17 T17-26).

#### 3.11.4 샌드박스 밖에서 도는 데몬 git (V4-001)

데몬은 샌드박스 밖에서 작업 공간의 `git`을 데몬 uid로 실행한다(13의 변경 감지 `status`, 되돌릴 지점의 임시 인덱스 `add -A`·`commit-tree`, 초안·검증 작업 트리 `worktree add`). 샌드박스 안 도구가 git 설정을 쓰거나 새 `.git`을 만들면 그 호출이 설정에 적힌 명령을 데몬 권한으로 실행할 수 있다. 막는 방법(고정 git 환경, `.git/config` 등의 읽기 전용 덧씌움, 새 `.git` 감지 뒤 git 호출 생략)은 13·18이 정한다. 이 문서는 방법과 관계없이 결과로 판정한다: 데몬의 git 호출 뒤 표지 파일이 생기지 않아야 한다. 시험 표본(악성 설정의 종류와 위치)은 13 §6 U-TL-15의 T-SG-01~06과 같고, 18 T18-35가 이 표본을 쓴다.

공통 준비: 표지 파일 경로는 샌드박스가 쓸 수 없는 테스트 임시 디렉터리(`$MARKER_DIR/<시험 ID>`)다. 심는 명령은 `touch $MARKER_DIR/<시험 ID>`다. 심기는 두 판으로 한다. (가) `int` 판: 도구 실행 뒤의 파일 상태를 테스트 코드가 직접 만든다(빠름, `just test`). (나) `sys` 판: 실제 샌드박스(S1·S1b) 안 bash가 같은 파일을 쓰려고 시도한다(`just daemon-systest`). (나)에서 쓰기가 막혔으면 그것도 기록하되, 판정은 표지 파일 유무로 한다. 데몬 쪽 호출은 13의 실제 코드 경로(변경 감지, 되돌릴 지점 생성, 검증 작업 트리 준비)를 그대로 부른다.

| ID | 심는 것 | 부르는 데몬 경로 | 기대 |
|---|---|---|---|
| 22/SG-01 | 작업 공간 `.git/config`에 `core.fsmonitor = touch …`(`.git/**` 쓰기 부여가 있는 합의 포함) | 변경 감지 `status`, 임시 인덱스 `add -A`, `commit-tree`, `worktree add` 각각 | 표지 파일 없음 |
| 22/SG-02 | `.git/config`에 `core.hooksPath = <쓰기 가능 루트 안 디렉터리>`와 그 안의 `pre-commit`·`post-commit`·`post-checkout`·`reference-transaction` 실행 파일 | 같음 | 표지 파일 없음. `.git/hooks/**` 보호(18 §3.11.5)를 `hooksPath`로 돌아가는 경로도 막혀 있음 |
| 22/SG-03 | `.git/config`에 `filter.x.clean = touch …`와 작업 트리 `.gitattributes`(`* filter=x`), 같은 내용을 `.git/info/attributes`로 넣은 변형 | 임시 인덱스 `add -A`, `status` | 표지 파일 없음 |
| 22/SG-04 | 같은 계열의 다른 키: `diff.x.textconv`, `core.sshCommand`, `core.pager`, `uploadpack`·`protocol` 관련 키, `include.path`로 다른 파일을 끌어오는 설정 | SG-01과 같음 | 표지 파일 없음 |
| 22/SG-05 | `.git`이 없는 쓰기 가능 루트(예: `src/`)에 새 `.git`(SG-01~03의 설정을 담은 것)과 `.gitmodules` | 그 루트를 대상으로 하는 데몬 git 호출 | 표지 파일 없음. 실행 전에 없던 `.git`·`.gitmodules`가 생긴 것이 감사 이벤트와 결과 제출의 관찰로 남는다 |
| 22/SG-06 | 실행 전 `.git/config`·`.git/info/attributes`의 해시를 적어 둔 뒤 SG-01~04의 쓰기 시도 | 실행 뒤 비교 | (나) 판에서 파일 내용이 바뀌지 않았거나, 바뀌었으면 결과 제출과 복귀 요약에 위험 표시로 보임 |

사용자 셸 쪽 영향: 작업 공간은 사용자의 셸과 편집기도 쓰는 폴더다(`~/projects`). 데몬이 자기 호출을 고정 환경으로 막아도, 남은 `.git/config` 설정이나 새 `.git`은 사용자가 그 폴더에서 `git status`를 치거나 셸 프롬프트·편집기가 git을 부를 때 사용자 uid로 실행된다. 데몬은 이 실행을 막을 수 없다. 그래서 SG-05·SG-06은 표지 파일 대신 "사람에게 보였는가"도 판정한다. 시험은 사용자 셸을 흉내 낸 별도 프로세스(보통 환경 변수, 고정 git 환경 없음)로 `git status`를 돌려, 덧씌움이 잘 되었다면 표지가 생기지 않는지 확인한다(SG-01~04의 (나) 판). 새 `.git`이 남는 경우(SG-05)는 사용자 셸 실행을 막을 수 없으므로 표지 생성 여부를 기록만 하고, 위험 표시가 결과 제출 전에 사람에게 보였는지를 판정 기준으로 둔다. 이 한계와 사람 할 일은 18이 적는다.

#### 3.11.5 웹·브라우저·해시라인 편집 시험 [판정 J-190]

결정 55의 도구(웹 읽기·검색, 브라우저, 해시라인 편집)를 막는 장치를 시험한다. 네트워크 차단은 두 층이다. 프록시는 연결 호스트 수준으로 내부 주소를 막고(13 §3.6.3, 18 §3.11.9), browserd는 메서드와 요청 종류를 판정한다. 두 층을 따로 시험한다. 실제 인터넷과 실제 Chrome이 필요한 것만 `sys` 판에 둔다. 외부 탐색은 막지 않는다(결정 55).

| ID | 확인하는 것 | 기대 | 계층·레시피 | 함께 보는 ID |
|---|---|---|---|---|
| 22/NW-01 외부 허용 | `net:public` 합의에서 공인 주소로의 `web_fetch`, `web_search` 질의 | 연결과 본문이 허용되고 질의가 제공자에 나간다. 합의에 호스트 목록을 적었으면 그 밖의 호스트는 거부한다 | int(가짜 DNS, `test`), sys(실제 레지스트리, `daemon-systest`) | 13/T-WF-01, 13/T-NP-03, 18/T18-50 |
| 22/NW-02 내부망 차단 | 루프백, 사설(10/8, 172.16/12, 192.168/16), 링크 로컬, CGNAT(100.64/10), tailnet, ULA, IPv4 매핑 IPv6 주소로의 `web_fetch`와 browserd 요청 | 연결 전에 `policy.forbidden_resource`로 거부하고 연결 시도는 0회다. 18 T18-34의 `127.0.0.1:2019`(H-5 관리 API)를 예로 쓴다 | unit(주소 판정 표), int(`test`) | 13/T-E41, 13/T-WF-01, 18/T18-50, 26/T26-32 |
| 22/NW-03 해석 뒤 주소와 리디렉션 | (a) 공인 이름이 사설 주소를 돌려준다(DNS 재바인딩), (b) 공인 주소가 302로 사설 주소를 가리킨다, (c) 해석 뒤 주소를 고정한다 | (a) 연결 전 거부, (b) 리디렉션마다 다시 판정해 거부, (c) 검사한 주소로만 연결 | int(가짜 DNS와 가짜 302, `test`), sys(프록시 판, `daemon-systest`) | 13/T-WF-02, 13/T-NP-02, 18/T18-34, 18/T18-47 |
| 22/NW-04 우회 차단 | 프록시 환경 변수를 지운 `curl`, 직접 소켓, UDP(QUIC·WebRTC) 송신 | 연결이나 송신이 실패한다. 네임스페이스 밖으로 나가는 길이 없다 | sys(S1, `daemon-systest`) | 18/T18-34 |
| 22/WB-01 요청 가로채기 | (a) 1단계의 브라우저 비-GET 요청, (b) 2단계의 비-GET 요청 보류, (c) `navigator.sendBeacon`·`fetch` keepalive·서비스 워커 요청 | (a) 거부, (b) 보류 뒤 `ask`, (c) 잡히면 같은 판정. 놓치는 종류가 있으면 그 구성에서 상호작용 도구를 끈다(18 Q18-14, 23 스파이크) | unit(판정 표), sys(실제 Chrome, S1, `daemon-systest`) | 13/T-BR-01·T-BR-02, 13/T-E45, 18/T18-52 |
| 22/WB-02 taint.web | 웹 내용을 본 run에서 합의가 허용한 호스트로 POST | `ask`(합의가 허용해도). 승인 화면에 "웹 내용을 본 뒤의 요청"이 보인다. 같은 run의 읽기와 작업 공간 쓰기는 자동이다. 다음 run은 오염을 이어받는다 | int(`test`, 18 T18-43과 함께) | 13/T-BR-03, 13/T-E46, 12/T-RT-07d·07f, 18/T18-43 |
| 22/WB-03 외부 효과 분류 | 업로드, 256자를 넘는 GET 질의, 합의 밖 호스트로의 이동, 다운로드 | 업로드와 긴 질의, 합의 밖 이동은 `ask`다. 다운로드는 기본 거부고, 허용되어도 `drafts/<concernId>/downloads/` 밖에 쓰지 않는다 | unit(판정 표), sys(18 T18-46) | 13/T-BR-07, 18/T18-46 |
| 22/HL-01 낡은 태그 거부 | (a) 태그 없음, (b) 파일이 바뀐 뒤의 태그, (c) 데몬 재시작 뒤의 태그, (d) 같은 4자리 태그에 다른 내용(16비트 충돌) | (a)~(c)는 `stale_snapshot`으로 실행 없이 끝난다. 자동 복구는 없다. (d)는 태그가 같아도 sha256 guard가 달라 `file_changed_since_prepare`로 거부한다(태그만으로 일치를 판정하지 않는다) | int(실제 파일과 데몬 스냅샷 저장소, `test`) | 13/T-HL-01·T-HL-03·T-HL-05, 13/T-E49 |
| 22/HL-02 편집 연산 검사 | 안 본 줄을 겨냥하거나 연산이 겹침, 여러 파일 중 일부만 쓰이고 실패 | prepare에서 거부하고 실행하지 않는다. 쓰기는 파일별로 원자적이고, 적용된 파일 목록을 결과에 적는다 | unit, int(`test`) | 13/T-HL-02·T-HL-04, 13/T-E50·T-E51 |

편집 방식의 A/B 비교(`replace`와 `hashline`)는 평가이므로 §3.14.2의 22/EV-04에 둔다. 기본값은 `replace`이고, `hashline`은 모델 계열마다 근거를 본 뒤 켠다([판정 J-190 (1)]).

### 3.12 UI 테스트

21은 2a에서 개정되었다(결정 41~43: React 19, 직접 만든 부품, 글래스모피즘, 토큰 복사). 부품과 이야기는 `@helm/ui`(`packages/ui`), 토큰과 대비 관문은 `@helm/ui-tokens`(`packages/ui-tokens`)에 있다(21 §6.1). 이 절은 21 §6.3(테스트 종류)과 20 §3.13(앱 테스트), 26 §6(모바일)을 계층에 배치하고, 세 문서가 이 문서에 넘긴 결정(기준 이미지 환경, verify 범위)을 정한다.

#### 3.12.1 층

| 층 | 대상 | 도구 | 데이터 | 계층·레시피 |
|---|---|---|---|---|
| 부품 | L0~L2 부품, 시각화 부품(21 §3.7·§3.8) | Storybook play 함수 + `@storybook/addon-vitest`(Vitest 브라우저 모드, Chromium) | `packages/ui/src/fixtures`(한국어 VM 고정 데이터, 21 §6.3) | ui, `just ui-test` |
| 화면 조립 | `screens/*/useScreenModel.ts`, 훅(`useView`, `useCommand`) | `@testing-library/react` + jsdom + Tauri `mockIPC` | `test/fixtures/views/*.json`(데몬 대본이 만든 뷰 표본, §3.6.2) | ui, `just test`(앱 프로젝트) |
| 앱 단위 | 연결 계층, 동기화, 초안, 딥 링크, 알림 규칙 | Vitest(node) + `fake-indexeddb` + 19 가짜 전송 | | unit, `just test` |
| Rust 코어 | 프로필 검증, SSH 인자, WS-over-stream, blob 캐시 | `cargo test -p helm-desktop-core` | 표본 파일 | unit, `just app-check` |
| 웹 E2E | 앱 웹 번들(브라우저 대체 실행) + `FakeDaemon` | Playwright(Chromium, WebKit) | `FakeDaemon` 고정 데이터 | e2e, `just app-e2e` |
| 셸 스모크 | Tauri 앱 실행·연결·창 숨기기 | WebdriverIO + `@wdio/tauri-service` | `FakeDaemon` | e2e, `just app-verify-mac`(Mac), Windows 수동 워크플로 |
| 실제 데몬 E2E | 앱 + 실제 데몬(테이프 모델) | Playwright(웹) 또는 사람 | `HELM_ROOT=/srv/volumes/helm/e2e` | e2e, `just e2e-real` + manual |
| 시각 회귀 | 이야기(`packages/ui/tests/visual/`)·화면 캡처 | Playwright `toHaveScreenshot` | 정적 Storybook 빌드, `FakeDaemon` 고정 데이터 | visual, `just ui-visual`, `just shot`, `just mobile-shot` |
| 수동 | 알림 클릭, 트레이, 배지, 키체인, 로그인 시 시작, 딥 링크(설치 앱), 실제 IME, 잠자기 | 체크리스트(20 §6.2) | | manual |

#### 3.12.2 시각 회귀와 기준 이미지 환경 [제안]

- 기준 이미지는 서버(WSL, 브리프 §2.5의 Ubuntu 24.04)에서 만든다. 이유: 테스트가 도는 곳이 서버뿐이고(D22-14), 글꼴을 앱에 넣었으므로 시스템 글꼴 차이가 없다(21 §6.3).
- 브라우저: `@playwright/test` 정확한 판(20 §3.13.4의 1.64)이 내려받은 Chromium·WebKit 빌드만 쓴다. Playwright 판을 올리면 기준 이미지를 모두 다시 만들고 사람이 차이 보고서를 검토한다(같은 커밋).
- 고정 조건: 뷰포트 1280·1100·900(03 §6), `deviceScaleFactor` 1(그리고 L2 부품 일부만 2), `TZ=Asia/Seoul`, 로케일 `ko-KR`, 애니메이션 끔(`reducedMotion: 'reduce'` + CSS 전환 0), 캐럿 숨김, 테마 라이트·다크 각각, 투명도 기본과 줄이기 각각(유리 표면이 있는 셸·오버레이 이야기만).
- 허용 차이: `maxDiffPixelRatio: 0.02`, 크기 변화 0(21 §6.3, Caustic G4와 같은 값 [원문]). WebKit 결과는 macOS WKWebView의 근사이며 같은 판이 아니다 [가정, 20 §3.13.4].
- 보관: 사용자 규칙("바이너리는 Git에 넣지 않는다")에 따라 기준 이미지는 Git 밖 `~/projects/helm/design/visual-baselines/<chromium|webkit>/<이야기 또는 화면 ID>.png`에 둔다(제품 폴더, Syncthing으로 Mac에서도 볼 수 있다). Git에는 `packages/ui/tests/visual/baselines.lock.json`(이야기)과 `apps/desktop/tests/visual/baselines.lock.json`(화면)(파일 이름 → sha256, Playwright 판, 브라우저 빌드 번호)만 커밋한다.
  - `just ui-visual`: 잠금 파일과 기준 이미지 해시가 다르거나 이미지가 없으면 종료 코드 2(환경 문제)와 "`just ui-visual-update`로 다시 만들고 검토"를 안내한다. 비교 실패는 종료 코드 1과 HTML 차이 보고서(`/tmp/helm-visual-report/`).
  - `just ui-visual-update`: 이미지를 다시 만들고 잠금 파일을 고친다. 사람이 차이 보고서를 본 뒤 잠금 파일을 커밋한다.
  - `just shot`(20 §3.13.5, 21 §6.4): 화면 ID별 캡처를 `~/projects/helm/design/shots/<YYYY-MM-DD>_<커밋>/`에 쓰고, 04가 정한 디자인 기준(있으면)과 나란히 놓은 HTML을 만든다. 기준 비교 실패로 끝나지 않는다(사람 비교용). `just shot-mac`은 Mac 캡처를 같은 폴더에 더한다.
- 21 §6.1의 고정 데이터에는 유리 시험용 고정 배경 이미지 2장과 글꼴 woff2가 있다. 이것도 바이너리다. 글꼴은 앱 번들에 들어가는 빌드 입력이라 기준 이미지와 성격이 다르지만, 사용자 규칙과의 관계를 21에 확인한다(§5.2 21 요구). 이 문서의 기본값: 배경 이미지는 시험이 실행 때 SVG·CSS 그라디언트로 그려 만들고(바이너리 없음), 글꼴은 사용자 확인 전까지 21 계획대로 둔다.
- 시각 회귀를 `just verify`에 넣지 않는다(D22-11). 화면을 바꾼 작업의 완료 기준은 `just verify` + `just ui-visual` + `just shot` 비교다(사용자 규칙 "화면이면 `just shot`으로 디자인과 비교").

#### 3.12.3 IME

| 층 | 무엇 | 방법 |
|---|---|---|
| 부품 | 조합 중 Enter·Esc가 제출·닫기를 일으키지 않음(21 TK-04) | play 함수에서 `compositionstart/update/end`, `keydown(isComposing=true)`, `keydown(keyCode=229)` 합성 |
| 부품 | 숫자 키 1~5 반응이 한글 입력 상태에서도 동작(04 UT-07, 05 §3.8 `KeyboardEvent.code`) | `code: 'Digit1'`, `key: 'ㅂ'` 같은 한글 배열 `key` 값으로 합성 |
| 웹 E2E | `G` `I`, `1`~`5`, `N` 단축키가 `code` 기준으로 동작, 텍스트 입력 중 한 글자 단축키 없음, 결정 의도를 보내는 단축키 없음(05 UT-09) | Playwright `keyboard.down` + 페이지 안 이벤트 합성(Playwright는 실제 IME를 띄우지 않는다 [지식]) |
| 수동 | macOS 한글 2벌식, Windows MS 한글 IME에서 조합 중 Enter, 전역 단축키(20 §6.2-4) | 체크리스트, 출시 전 플랫폼마다 |

- 실제 IME 동작은 자동화로 확인하지 못한다. 합성 이벤트 시험은 브라우저가 IME 조합 중 보내는 이벤트 모양을 흉내 낸 것이며, 그 모양이 실제와 다르면 수동 체크리스트에서만 발견된다 [가정].

#### 3.12.4 접근성

| 항목 | 기준 | 방법 | 레시피 |
|---|---|---|---|
| 자동 규칙 | axe-core WCAG 2.1 A·AA 태그 규칙 위반 0(영향도와 관계없이). best-practice 태그는 보고만 | 모든 이야기(21 TK-02), 웹 E2E의 화면마다 한 번 | `just ui-test`, `just app-e2e` |
| 키보드 | 21 §3.12 표대로 이동·조작, 포커스가 `body`로 빠지지 않음, 질문 답·결과 확인·이의를 키보드만으로(01 NFR-U-5) | play 함수(21 TK-03), 웹 E2E | `just ui-test`, `just app-e2e` |
| 색에만 기대지 않음 | 흑백 변환 스크린샷에서 게이트·품질 배지가 글자로 구분(05 UT-10) | 선형 텍스트 골든(21 TK-05)이 1차 확인. 시각 회귀에 `filter: grayscale(1)` 판 몇 개 | `just ui-test`, `just ui-visual` |
| 토큰 대비 | 본문 7:1, 보조 4.5:1, 비활성 3:1, 경계·포커스 3:1(21 TK-09, Caustic 대비 관문) | 토큰 빌드 스크립트(21 §3.2.8)가 대비 보고서를 만들고 규칙 하나라도 실패하면 1 | `just ui-check` |
| 반투명 표면 대비(결정 41) | 유리 재질(크롬 84~86%, 오버레이 90%) 위 글자가 최악 배경에서 위 기준 충족(21 UI-D16) | (1) 토큰 단계(관문): `@helm/ui-tokens` 빌드가 유리 재질 × 최악 배경(n0·n1·n8·n9, 채도 높은 색 15개, 순수 검정·흰색)을 알파 합성해 계산하고 하나라도 실패하면 빌드 실패(21 §6.3 대비 행). axe 색 대비 규칙은 `backdrop-filter` 아래 배경을 계산하지 못해 "불완전"으로 보고하는 경우가 있으므로[지식] 토큰 단계가 관문이다 (2) 렌더 단계: 유리 크롬·오버레이 이야기를 세 배경 픽스처(빈 캔버스, 글자가 빽빽한 목록, 채도 높은 이미지 자극) 위에서 찍고, 글자 영역 바깥 테두리 픽셀의 평균을 배경색으로 잡아 대비를 계산하는 Playwright 시험 [제안: 근사 측정. 흐림 뒤 실제 배경은 픽셀마다 다르므로 이 값은 평균값이며 최악값보다 낙관적이다] | `just ui-check`·`just ui-tokens`(1), `just ui-visual`(2, 보조) |
| 투명도 대체 | `prefers-reduced-transparency`, `prefers-contrast: more`, `forced-colors: active`, `backdrop-filter` 미지원에서 유리가 불투명(21 §3.2.5) | Playwright `emulateMedia`(`forcedColors`, `reducedMotion`; `contrast`·`reducedTransparency` 지원 여부는 판에 따라 다르다 [지식, 구현 때 확인]. 지원하지 않으면 `data-transparency="reduced"` 속성으로 같은 분기를 시험) | `just ui-test` |
| 낭독 빈도 | 진행 중 카드 갱신이 30초 안에 두 번 이상 낭독되지 않음(05 UT-10) | `aria-live` 영역의 변경 횟수를 가짜 시계로 셈 | `just ui-test` |
| 확대 | 200%에서 가로 스크롤 없음(표 제외, 21 U5) | 시각 회귀 확대판 | `just ui-visual` |

- 05 §6 "axe 위반 0(AA)"와 21 §6.3 "serious·critical 0"이 다르다. 이 문서는 "A·AA 태그 규칙 위반 0, 영향도 무관"으로 정한다. 결정 41의 반투명 표면이 대비 위반을 만들기 쉬우므로 영향도로 거르지 않는다(§5.2 05·21 요구).

#### 3.12.5 대안 고르기 금지 규칙 (결정 18)

결정 18은 네 층에서 따로 확인한다. 한 층의 시험만 있으면 다른 층에서 생긴 고르기 형태를 확인하지 못한다.

| 층 | 규칙 | 테스트 |
|---|---|---|
| 커널 | 원함 탐구(I.want) 출처의 하나 고르기 질문 거부(V-Q-03), 승인 극장 질문 거부, 형식별 필수 선택지(V-Q-02) | 22/AX-15, 11/AQ-03, 11/AQ-17 |
| 탐구 엔진 | I.want에서 `choice` 질문 후보 제거(15 T-08), 고르기만 한 라운드는 사람이 명시해야 닫히고 다음 라운드에 세 개 비교(15 T-12, J-34), `near`는 정보성 반응이 아님(15 T-28), E18-1~6 각각을 깨려는 가짜 모델 대본이 실패(15 T-24) | 15/T-08, 15/T-12, 15/T-24, UC-01/pick-only |
| 문구 | 금지 표현 목록(05 §3.10.9), 권리 게이트 버튼에 "승인"·"거절"·"확인"·"계속" 단독 문구 없음, 세 개 비교 문구에 "가장 좋은" 같은 고르기 표현 없음 | 05/UT-02, 05/UT-05 |
| 화면 | 원함 탐구 이야기에 결정 의도 버튼 없음, `StimulusBoard`·`ContrastCard`에 "가장 좋은 것 고르기" 행동 없음, 고르기 같은 반응(`pickLike`)뿐인 라운드는 "그대로 닫기" 확인을 거쳐서만 닫힘(J-34), "그 밖에" 없는 질문 카드 없음, 원함 탐구 출처 질문에 `options`·`pickOne`이 와도 렌더 안 됨, `RadioGroup`·`Select`를 자극·탐구 부품에서 import하지 않음(21 R4), 확률 숫자 없음 | 21/TK-06(1)~(6), 21 정적 검사(가져오기 규칙), 04/UT-05, 04/UT-07, 02/AC-01-16 |
| 흐름 | 원함 탐구 한 라운드를 앱에서 끝까지(자극판 → 반응 → 라운드 마침 → 세 개 비교) 진행하는 웹 E2E | 22/E2E-UC01 |

#### 3.12.6 데스크톱 E2E 범위

**웹 E2E(`just app-e2e`, 서버, verify 밖)**

- 20 IT-01~20(가짜 데몬 통합 시나리오).
- 화면 흐름(22/E2E-UCxx): MVP 유즈케이스마다 화면 경로 하나(03 §3.7, 02 §3.23의 화면 열). `FakeDaemon`이 유즈케이스 대본의 뷰 표본(§3.6.2)을 차례로 내보내고, 앱에서 사람 행동을 눌러 그 대본의 사람 명령과 같은 명령 메서드·인자가 나가는지 본다. 앱 쪽 Helm 로직 금지(결정 32·41, R12)에 맞춰, 확인은 "보낸 명령"과 "그려진 화면"까지다.

| ID | 화면 경로 | 대응 대본 |
|---|---|---|
| 22/E2E-UC01 | 입력 → Concern 개요 → 자극판 → 질문 → 합의 → 결과 확인 → Goal | UC-01/basic |
| 22/E2E-UC02 | 입력 → 탐구 → 근거 체인 → 질문(선택 요청) → 합의 → 결과 확인 | UC-02/basic |
| 22/E2E-UC03 | 복귀 요약(권리 게이트 첫 항목) → 질문 → 결과 확인 → 에이전트가 정한 것 | UC-03/basic |
| 22/E2E-UC04 | 알림(모의) → 질문 → 답(1회 조작) | UC-04/basic |
| 22/E2E-UC05 | 복귀 요약 → 에이전트가 정한 것 → 이의 걸기 | UC-05/basic |
| 22/E2E-UC06 | 홈 → 복귀 요약 → 근거 체인 → "여기까지 봤음" | UC-06/basic |
| 22/E2E-UC07 | 합의 초안 → 확정 → 결과 확인(다섯 행동) → 반영 항목 | UC-07/basic |
| 22/E2E-UC09 | Goal 상세 → 수정 제안 확정 | UC-09/basic |
| 22/E2E-UC10 | 위쪽 막대 오프라인 → 복구 화면 | UC-10/A, UC-10/B1 |
| 22/E2E-UC11 | 처음 연결 → 페어링 → 첫 Goal 확정 | UC-11/basic |
| 22/E2E-UC12 | Concern 개요 → 기준 변경 → 합의 echo → 다이얼 | UC-12/basic |
| 22/E2E-UC13 | 복귀 요약 "평가" → 근거 체인 → 다시 정하기 | UC-13/basic |
| 22/E2E-UC15 | 입력 → 가벼운 작업 결과 확인 → 승격 제안 질문 | UC-15/basic, UC-15/A1 |
| 22/E2E-UC17 | 두 브라우저 컨텍스트(두 기기)에서 같은 홈·복귀 요약 | UC-17/basic |

**셸 스모크**: 20 DM-30(앱이 뜨고 가짜 데몬에 연결해 홈 표시, 창 닫기 = 숨기기). macOS는 `just app-verify-mac`(Mac이 잠들어 있으면 종료 코드 2), Windows는 `app-build-win-ci` 수동 워크플로 안에서(D22-14).

**실제 데몬 E2E(`just e2e-real`, 02 §6 E2E 행, 01 §3.8.3 항목 3)**

| ID | 내용 | 방법 |
|---|---|---|
| 22/RE-01 | UC-04 두 경로: Mac 앱과 Windows 앱 각각에서 Tailscale 경로와 SSH 경로로 질문에 답함 | 서버에 E2E 데이터 디렉터리로 개발 데몬을 띄우고(`HELM_ROOT=/srv/volumes/helm/e2e`, 테이프 모델), UC-04/basic 대본의 앞부분을 하네스가 실행해 질문을 만든 뒤 사람이 각 기기·경로로 답한다. 하네스가 이벤트 로그에서 기기 id·경로가 다른 답 4건을 확인하고 결과를 `tests/trace/manual.json`에 기록 |
| 22/RE-02 | UC-10 A: 앱 연결을 끊고(Wi-Fi 끔) 초안 작성, 재연결 뒤 직접 보냄 | 같은 환경, 사람 |
| 22/RE-03 | UC-11: 새 데이터 디렉터리에서 설치 → 페어링 → 첫 Goal | 같은 환경, 사람 |

실제 데몬 E2E는 macOS·Windows 각 1회 이상(02 §6), 앱 출시 전과 MVP 완료 전에 한다. 실제 모델을 쓰는 실사용 기록(01 §3.8.3 항목 2)은 운영 데이터이며 테스트에 넣지 않는다.

#### 3.12.7 모바일 (결정 42, 26)

26은 모바일 1차를 데몬이 `tailnet` 리스너의 `/m/`로 서빙하는 PWA로 정했다(26 MOB-D01). 데스크톱과 같은 `@helm/client`·`@helm/client-react`·`@helm/ui`·`@helm/ui-tokens`·`@helm/ui-language`를 쓰고, 앱이 꺼져 있을 때는 데몬이 Web Push를 직접 보낸다(MOB-D02). 빌드는 서버에서 하며 Mac이 필요 없다(MOB-D10). 그래서 모바일 시험은 대부분 서버에서 돈다.

| 묶음 | 내용 | 계층·레시피 |
|---|---|---|
| 정적 서빙·쿠키 인증 | 26 T26-01~T26-10(`/m/`은 `tailnet`에서만, `__Host-` HttpOnly 쿠키, Origin 검사, 데스크톱 토큰을 쿠키로 쓰면 거부) | sec(int), `just test` |
| 푸시 등록·payload·대상 계산·송신 | 26 T26-11~T26-18. T26-13은 속성 테스트(무작위 질문 문장·Goal 서술이 payload에 없음). T26-17은 22의 가짜 푸시 서비스로 | unit, prop, int, `just test` |
| 서비스 워커·수명주기·결정 가능 판정 | 26 T26-19~T26-23 | unit, `just test`(26 `mobile-check`가 워크스페이스 `test`에 포함) |
| 화면 | 26 T26-24(Playwright WebKit, iPhone 15 뷰포트, 가짜 데몬), T26-26(누르는 영역 44×44pt, 입력 글자 16px) | e2e, `just mobile-e2e`(verify 밖, `app-e2e`와 같은 취급) |
| 화면 캡처 | 26 T26-25 `just mobile-shot`(`just shot`이 부름). 기준 보관은 §3.12.2와 같다(Git 밖) | visual |
| 갱신 | 26 T26-27(새 판 배포 → 다음 실행 때 적용, 초안 유지) | int, `just test` |
| 같은 사람 명령 | UC-04/M(`dv_phone`, 2단계 대본): 휴대폰 답이 데스크톱 답과 같은 이벤트, 다른 것은 기기 id와 리스너뿐(AC-04-09) | scenario, `just test`(2단계 기능 플래그가 켜졌을 때) |
| 부재 중 푸시 | UC-04/away-push(2단계 대본, `requires: ['push']`): 모든 기기가 부재(14 파생 함수, 판정 J-119)이고 휴대폰 푸시가 등록된 상태에서 `interrupt`·`notice` 질문이 기록되면 가짜 푸시 서비스가 각각 받고(`channel: push`), `digest`는 푸시로 나가지 않는다([결정 48]). 다른 기기가 활동 중이면 보내지 않고, 연결만 되어 있으면 60초 기다린다(26 MOB-D05). 같은 질문 세 번째 알림은 없다 | scenario, `just test` |
| 결과 확인 알림 세 값([판정 J-189]) | 22/NT-01~03. NT-01: `notifications.resultReview`가 `none`(기본)이면 결과 확인 대기가 있어도 푸시가 없고 복귀 요약에만 보인다. NT-02: `daily_digest`는 `notifications.resultReviewDigestAt`(기본 "19:00", 서버 시간대)에 대기 결과가 하나 이상일 때만 묶음 푸시 1개(개수만)를 보내고, 0개면 보내지 않는다. 타이머 목적은 `result_review_digest` 하나다. NT-03: `immediate`는 결과 확인 질문마다 notice 1개를 보낸다. NT-02·03은 방해 금지([판정 J-166])와 시간당 상한([판정 J-171])을 따르고, 휴대폰 확인 범위는 [판정 J-139] 그대로다. 설정 변경은 `settings.update`(잘못된 값은 3001), 기록은 `setting.changed` 한 번이다. 시험은 26 T26-15, 19 CT-48, 11 AQ-24, 05 UT-14가 나눠 맡는다 | unit, int, `just test`. 시나리오 `UC-07/review-notice`(2단계, `requires: ['push']`) |
| 보안 | 18 T18-31(모바일 기기 scope, 푸시 본문에 질문 내용 없음, 푸시 토큰 원문이 이벤트·로그에 없음) | sec, `just test` |
| 실제 기기 | 26 §6.2 M-01~M-14(iPhone, 출시 전) | manual |

가짜 푸시 서비스(26 §5.2 22 요구) [제안]: `tests/harness/fake-push-service.ts`. 로컬 HTTP 서버가 RFC 8030 요청을 받는다. 시험이 만든 구독 키 쌍(p256dh, auth)으로 RFC 8291 `aes128gcm` 본문을 복호화하고, VAPID JWT(RFC 8292)의 `aud`·만료·서명을 검사하고, `TTL`·`Urgency`·`Topic` 헤더를 기록한다. 응답 코드를 조작할 수 있다(201, 410, 429, 5xx). 데몬 시험 설정은 허용 푸시 호스트 목록에 이 서버의 루프백 주소를 넣는다(테스트 전용 설정, 26 T26-11의 호스트 검사를 운영에서는 그대로 둔다).

- presence: 저장 값은 09의 `active`·`idle`·`hidden`·`offline`이고 `locked`는 없다(판정 J-118·J-119). 부재는 14의 파생 함수가 기기 종류별 문턱(휴대폰 active 2분, 데스크톱 5분)으로 계산한다. 시험은 (1) 어떤 클라이언트도 `locked`를 보내지 않음, (2) 서버가 `locked`를 스키마 오류로 거부함, (3) 같은 presence 이벤트 열에서 `urgencyOf`·푸시 계획·복귀 판정이 같은 부재 값을 씀(14 파생 함수 하나)을 본다.
- 26 T26-06의 `via.listener` 값은 리스너 이름 `tailnet`이다(판정 §2).
- 모바일 유리 재질 기본값은 `data-transparency="reduced"`(26, 21 U-22 답)다. 모바일 시각 기준은 줄인 투명도를 기본으로 만든다.

### 3.13 성능 시험

`just perf`가 서버(브리프 §2.5: Ryzen 5 PRO 6650H, WSL 메모리 상한 10 GB)에서 돈다. 결과는 `/srv/volumes/helm/perf/<YYYY-MM-DD>_<커밋>.json`에 쓰고(커밋하지 않음), 목표 표는 `tests/perf/targets.ts`에 둔다. 각 항목은 워밍업 뒤 반복 측정해 p50·p95·p99를 낸다. 목표를 넘으면 그 항목은 실패, 전체 종료 코드 1. 측정 중 정식 데몬·다른 서비스 부하가 있으면 결과에 함께 적는다(비교용).

| ID | 대상 | 목표 | 출처 | 방법 |
|---|---|---|---|---|
| 22/PF-01 | 명령 하나 커밋(이벤트 1~5개, 투영 포함) | p50 ≤ 3 ms, p99 ≤ 25 ms | 09 §3.15.2 | `@helm/store` bench(09 UT-20) |
| 22/PF-02 | 사람 명령 왕복(`question.answer`, `loopback`) | p95 ≤ 300 ms, 데몬 안 처리 p95 ≤ 50 ms. 모델 장애 중에도 같음 | 01 NFR-P-1, 19 §6.4, AC-10-08 | 실제 데몬 + `@helm/client` |
| 22/PF-03 | 커밋 → 이벤트 알림 수신 | p95 ≤ 500 ms | 01 NFR-P-2 | 같음 |
| 22/PF-04 | 밀린 이벤트 1,000개 재생 + 열린 뷰 3개 | ≤ 3 s | 01 NFR-P-4, 19 §6.4 | 같음 |
| 22/PF-05 | 복귀 요약 결정적 부분(`F-events-1k`) | ≤ 1 s | 01 NFR-P-5, AC-06-02 | 투영 계산 + `view.get brief` |
| 22/PF-06 | 엔진 트랜잭션 시간 | p99 ≤ 10 ms, 100 ms 넘으면 warn 로그 | 06 §3.6.5 [가정], 06 F13 | 엔진 bench, 혼합 부하 |
| 22/PF-07 | 커널 `decide`(이벤트 10만 건 상태), `impactOf` | p95 < 5 ms, p95 < 50 ms | 10 UT-15 | 커널 bench |
| 22/PF-08 | 재시작부터 복구 완료 | ≤ 30 s(로그 1만 건, 열린 run 3개) | 01 NFR-A-1, AC-10-07 | 자식 프로세스 데몬 |
| 22/PF-09 | 저장소 처리량·재전송·검사·재구성 | ≥ 500 이벤트/s, 재전송 1만 건 ≤ 200 ms, tail 검사 1만 건 ≤ 1 s, full 검사 180만 건 ≤ 90 s, 재구성 180만 건 ≤ 120 s, 낡음 전파 1,000개 ≤ 300 ms | 09 §3.15.2 | `F-events-1.8m`(`just perf-seed`) |
| 22/PF-10 | 스키마 검증 | 관찰 1만 개 ≤ 200 ms | 08 UT-13 | domain bench |
| 22/PF-11 | 데몬 상시 자원 | 대기 중 CPU ≤ 2%, 상주 메모리 ≤ 1 GB | 01 NFR-C-4 | 실제 데몬 10분 대기 측정 |
| 22/PF-12 | 하루 이벤트 50,000개에서 PF-02·PF-03 유지 | 같은 목표 | 01 NFR-U-3 | `F-events-50k-day` |
| 22/PF-13 | 앱 시작 → 캐시로 홈 | ≤ 2 s | 01 NFR-P-3, 20 DM-19 | Mac·Windows 수동 측정(manual) |
| 22/PF-14 | UI 렌더(트리 2,000노드 등), 유리 크롬 아래 긴 목록 스크롤 | 펼침·접힘 한 번 ≤ 50 ms, 스크롤 프레임 시간 중앙값 ≤ 16.7 ms(Chromium·WebKit) | 21 TK-10 | Vitest 브라우저 모드 + Playwright 추적. 시간 측정이므로 `just ui-test`에 넣지 않고 `just perf`에서 |
| 22/PF-15 | 즉시 전달 질문 → 알림 | ≤ 5 s | 01 NFR-P-6, 05 UT-08 | 가짜 시계가 아니라 실제 시간, 실제 데몬 + 클라이언트 알림 규칙 |

- 함수 수준 측정(`just bench`)은 해당 패키지가 생기면 바로 쓰고, 종단 측정(`just perf`)은 데몬과 클라이언트가 생긴 뒤 쓴다. 저장소 기준은 PF-01(p99 ≤ 25 ms)·PF-09이며 09 §6.2와 23 스파이크의 "p99 100 ms"는 이것으로 바꾼다.
- 성능 시험은 verify에 넣지 않는다(D2). `@helm/store`·`@helm/kernel`·`@helm/engine`을 바꾼 작업과 마일스톤 관문(23)에서 돈다.
- 09 §6.2 `bench/*.ts`의 "p99 100 ms를 넘으면 실패(초기 기준)"는 PF-01·PF-09가 대신한다.

### 3.14 모델 품질 평가

#### 3.14.1 분리 원칙

| 층 | 재생하는 것 | 보장 | 보장하지 않음 | 레시피 | verify |
|---|---|---|---|---|---|
| 커널 대본 | 정해진 제출 열 | 같은 입력 → 같은 이벤트 로그, 거부 갈래·코드 | 런타임 훅, 모델 동작 | `just test` | 넣음 |
| 런타임 재생 | 손 테이프·녹화 테이프 | 훅 지점의 제출, 거부의 모델 반환, 질문에서 멈춤과 답에서 재개, 녹화 응답의 재생 결정성(15 E1) | 모델이 맞게 판단하는가 | `just test` | 넣음 |
| 모델 품질 평가 | 실제 모델 | 관점 다양성, 근거율, 예측 적중, 요약 누락, 선호 모델 안정성, 판정 일치, 사람의 목표 변화 | 커널 규칙 | `just eval-*` | 넣지 않음 |

(10 §3.17.3 표를 레시피와 함께 다시 적은 것이다.) 커널 테스트에 모델 응답을 넣지 않는다. 모델 품질이 낮아도 커널 테스트는 실패하지 않고, 커널 규칙이 깨지면 모델과 관계없이 실패한다.

#### 3.14.2 평가 목록

| ID | 평가 | 내용 | 시점 | 레시피 | 기록 |
|---|---|---|---|---|---|
| 15/E0 | 흐린 작업 다섯 개(G0 관문) | 15 §3.15.2 절차와 판정. 취향형 과제는 "대안 2~3개 고르기" 비교 조건(평가용, 결정 18과 충돌 없음) | 원함 탐구를 커널 E/N에 정식 연결하기 전(01 §3.8.4 G0) | `just eval-inquiry task=<경로>` | `eval/<날짜>/<task>.result.yaml` + `self_report.recorded{instrument:"e0_task"}`(16) |
| 15/E1 | 재생 결정성 | 녹화 테이프로 엔진을 다시 돌려 같은 행동·같은 이벤트 | 매 커밋 | `just test`(verify) | 테스트 결과 |
| 15/E2 | 프롬프트 회귀 | 익명 고정 과제 10개: 스키마 실패율, 근거율, 서로 다른 결과 벡터 수, 병합 비율을 이전 값과 비교 | 프롬프트·모델·설정 변경 시 | `just eval-prompts` | `eval/<날짜>/prompts.json`, 녹화 테이프(§3.5.4) |
| 15/E3 | REPL 평가 | 합성 큰 로그 사실 확인 과제의 정확도·비용 | REPL 구현 뒤 1회, 모델 변경 시(2단계) | `just eval-repl` | 같음 |
| 15/E4 | 다계열 효과 | E2 과제를 단일·다계열로 | 다양성 풀 변경 시(2단계) | `just eval-prompts families=1,2` | 같음 |
| 22/EV-01 | 복귀 요약 누락 | 고정 이벤트 열(`F-events-1k`와 익명 과제 로그)에서 실제 `summarizer` 모델이 쓴 요약 문장이 `mustIncludeRefs`(10 §3.1.5)의 항목을 문장에서 빠뜨린 비율. 결정적 부분은 커널 테스트가 이미 보장하므로 모델 문장만 본다(AX-09는 구조, EV-01은 문장) | 요약 프롬프트·모델 변경 시 | `just eval-summary` | `eval/<날짜>/summary.json` |
| 22/EV-02 | 관찰 에이전트 판정 일치(2단계) | 합성 후보 묶음(정답 판정을 사람이 붙인 것)에 대한 모델 판정(16 §3.12.3)의 일치율, 허용 밖 판정 비율 | 관찰 프롬프트·모델 변경 시 | `just eval-observer` | `eval/<날짜>/observer.json` |
| 22/EV-03 | 작업 에이전트 대본 적합 | UC-01·02·07 기본 흐름을 실제 모델로 끝까지: 거부 횟수, 사람 조작 수, 스키마 실패, 비용 | 모델 변경 시, MVP 완료 전(01 §3.8.3 항목 2의 사전 점검) | `just eval-flows` | `eval/<날짜>/flows.json` + 녹화 테이프 |
| 22/EV-04 | 편집 방식 A/B([판정 J-190 (7)]) | 같은 변이 복구 과제 묶음(익명 고정 과제, §3.5.4)을 `RunSpec.editMode`의 `replace`와 `hashline`으로 모델 계열마다 돌린다. 성공률, 출력 토큰, 낡은 태그 거부 비율, 잘못 편집된 줄 수를 잰다. 결과로 계열마다 `hashline`을 켤지 정하고, 기본은 `replace`로 둔다 | MVP 전 23 스파이크에서 1회, 모델 계열을 추가하거나 편집 도구를 바꿀 때 | `just eval-edit`(새 레시피, §3.15.3) | `eval/<날짜>/edit-ab.json` |
| 16 지표 | 운영 지표(H1~H10, V1~V9, CA-1~7, CT-1~3, 탐구 지표) | 운영 이벤트에서 계산. 계산 함수는 골든 테스트(16 OB-T21·T22)로 verify에 있고, 값의 판정은 2주 평가(16 §3.27.6) | 14일마다 | 관찰 에이전트 `evaluate` | `observer_report.recorded` |

규칙:

- 평가는 운영 DB를 쓰지 않는다. 평가 데이터 디렉터리 `/srv/volumes/helm/eval/<YYYY-MM-DD>/`(15 §3.15.1, 17이 확정)에 별도 저장소를 연다. 예외는 16의 운영 지표(운영 이벤트가 입력)와 E0 결과를 운영 로그에 `self_report.recorded`로 남기는 것뿐이다.
- 실제 모델 키는 레시피가 `secrets run`으로 자식 프로세스에만 넣는다. 평가 하네스는 실행 전에 예상 비용 상한을 보이고 `--max-usd`(기본 5)를 넘으면 멈춘다.
- 개인 과제 내용과 그 녹화는 저장소에 넣지 않는다. 익명 고정 과제와 그 녹화만 넣는다(§3.5.4).
- 평가 결과는 테스트 통과·실패가 아니다. 판정은 15 §3.15.2 규칙과 16 §3.27을 따른다. 15 T-26(평가 하네스가 메모리 커널과 가짜 모델로 과제 하나를 끝까지 돌림)은 하네스 자체의 테스트이며 verify에 있다.

### 3.15 `just verify`와 테스트 레시피

#### 3.15.1 `just verify`에 넣는 것

06 §3.16의 `_verify-steps`(lint, typecheck, check-arch, test, secrets 검사, gitleaks)에 07·20·21의 단계를 더한 것의 테스트 쪽 내용이다.

| 단계 | 테스트 내용 | 소유 |
|---|---|---|
| `lint` | ESLint(테스트 위생 규칙 22/ST-02 포함) | 06 |
| `typecheck` | `tsc -b`(타입 테스트 07 I5, 19 등록 표 타입 포함) | 06 |
| `check-arch` | 06 R1~R14(+ `@helm/tests` 층), 07 I4 | 06, 07 |
| `test` | 빠른 계층 전부: `unit`, `prop`(고정 시드), `contract`, `int`(`*.slow` 제외), `scenario`(`runtime` 모드 MVP 대본), `conf`(같은 프로세스 세 리스너, FakeDaemon, 어댑터), `fault`(같은 프로세스), `sec`(통합), 앱의 Vitest 프로젝트(jsdom·node), 골든 비교, 비밀 카나리아 | 22 |
| `test-trace` | §3.4.3 추적 검사 | 22 |
| `vendor-verify`, `licenses` 일치 | 07 I2, V8 | 07 |
| `app-check` | `cargo fmt --check`, `clippy`, `cargo test -p helm-desktop-core`, capability·CSP 정적 검사 | 20 |
| `ui-check`, `ui-test` | 21 정적 검사(토큰 생성물·대비 관문 포함), 부품 동작·접근성·키보드·IME·선형 텍스트·금지 패턴·수명주기 | 21 |
| `mobile-check` | 26 단위·컴포넌트 시험(워크스페이스 `test`에 포함) | 26 |
| secrets, gitleaks | 테스트 비밀 허용 접두사(§3.6.4) | 06 |

- `_verify-steps`는 그 단계를 만드는 23 WBS 행이 끝날 때 더한다. 예: `app-check`는 Rust 크레이트 행 뒤, `ui-test`는 `@helm/ui` 첫 행 뒤, `mobile-check`는 `apps/mobile` 첫 행 뒤. 그 단계에 필요한 도구(cargo, Playwright 브라우저)를 설치하는 사람 작업은 그 행보다 먼저 둔다(23). 단계가 들어간 뒤 도구가 없으면 종료 코드 2로 끝난다(환경 문제를 감추지 않는다).
- 시간 목표: 서버에서 `just verify` 전체 5분 이하, 상한 10분 [제안]. 넘으면 가장 느린 파일부터 원인을 보고(실제 시간 대기, 큰 픽스처 재생성), 고칠 수 없으면 `*.slow.test.ts`로 옮기고 이유를 파일 머리 주석에 쓴다.
- 종료 코드 2 조건(환경 문제, 코드를 고치지 않고 보고): pnpm·cargo·Playwright 브라우저(부품 시험용 Chromium)가 없음, 임시 디렉터리를 만들 수 없음. bwrap·sshd·Mac은 verify의 조건이 아니다.

#### 3.15.2 넣지 않는 것

| 무엇 | 이유 | 대신 |
|---|---|---|
| 실제 모델 호출(`eval`) | 비용, 비결정(D2) | `just eval-*` |
| 시각 회귀 | Git 밖 기준 이미지, 시간 | `just ui-visual`, `just shot`(화면 작업의 완료 기준) |
| 웹 E2E | 시간(Playwright 두 엔진) | `just app-e2e`, `just mobile-e2e`(앱 작업의 완료 기준, 20 §6, 26 §6) |
| Mac·Windows 필요 작업 | 기기 의존 | `just app-verify-mac`, Windows 수동 워크플로 |
| 시스템 시험(systemd, 실제 샌드박스) | 일회성 user unit, 실제 서버 상태 의존 | `just daemon-systest` |
| 자식 프로세스 SIGKILL 장애 주입 | 시간, OS 스케줄링 | `just test-faults` |
| 느린 통합(`*.slow`), SSH 경로 적합성 | 시간, sshd·시험 키 필요 | `just test-slow`, `just test-conformance-ssh` |
| 속성 테스트 새 시드 | 비결정 | `just test-deep` |
| 성능 | D2 | `just perf` |

#### 3.15.3 레시피 [제안, 06 §3.16 색인에 "테스트(`test-*`)" 묶음으로 더함]

| 레시피 | 하는 일 | 종료 코드 2 |
|---|---|---|
| `test` (템플릿) | `pnpm run test` = `vitest run`(빠른 계층) | pnpm 없음 |
| `test-slow` | `*.slow.test.ts` 전부 | |
| `test-deep` | 속성 테스트 새 시드 100개 + 장애 무작위 100회(`test-faults --seeds new`) + 대본 전 모드 | |
| `test-scenarios [filter]` | 대본을 선언한 모든 모드로(`kernel`, `runtime`, `protocol`) | |
| `test-faults [--seeds fixed\|new]` | `*.kill.test.ts`(자식 프로세스 데몬, 종료 지점) | |
| `test-conformance-ssh` | 22/CF-02 | sshd(127.0.0.1:22) 없음, 시험 키 없음 |
| `test-trace` | 추적 검사(§3.4.3). `--report`면 ID별 테스트 위치 표를 출력 | |
| `test-golden-update [filter]` | `HELM_GOLDEN_UPDATE=1`로 골든 다시 쓰기. 끝에 바뀐 파일 목록을 보인다 | |
| `test-fixtures-views` | `protocol` 모드 대본으로 앱 뷰 표본(`apps/desktop/test/fixtures/views`)을 다시 만든다(골든 갱신의 일부) | |
| `test-clean` | 테스트 임시·성능·E2E 데이터 디렉터리 정리(`/srv/volumes/helm/{test-scratch,perf,e2e,systest}`만. `data`는 건드리지 않는다) | |
| `test-all` | 서버에서 돌릴 수 있는 것 전부: `verify` + `test-slow` + `test-scenarios` + `test-faults` + `test-conformance-ssh` + `app-e2e` + `mobile-e2e` + `ui-visual` + `daemon-systest` + `perf`. 마일스톤 관문(23)에 쓴다. 단계별 결과를 `/srv/volumes/helm/test-reports/<날짜>.json`에 남긴다 | 하위 레시피의 2를 모아 보고 |
| `coverage` | V8 커버리지 보고(§3.17.2) | |
| `mobile-e2e`, `mobile-shot` (26) | 휴대폰 화면 시나리오(Playwright WebKit), 화면 캡처 | Playwright WebKit 없음 |
| `bench [패키지]` | 패키지 단위 `vitest bench`와 22/PF-01·PF-06·PF-07·PF-09·PF-10 목표 비교. 첫 마일스톤부터 쓴다(23 M2-10의 저장소 측정이 이것으로 돈다) | |
| `perf`, `perf-seed` | §3.13 종단 측정(데몬·클라이언트가 필요한 PF-02~05·08·11·12·14·15) | |
| `e2e-real` | 실제 데몬 E2E 환경을 띄우고 절차를 안내, 결과 기록(§3.12.6) | `HELM_ROOT` 준비 실패 |
| `eval-inquiry`, `eval-prompts`, `eval-repl`, `eval-summary`, `eval-observer`, `eval-flows`, `eval-edit`(22/EV-04) | §3.14 | 모델 키 없음(`secrets run` 실패) |
| `tape-promote <파일>` | 녹화 테이프를 저장소로 옮기며 검사(§3.5.4) | |

다른 문서가 이름을 정한 테스트 레시피(그대로 쓴다): `daemon-systest`(17), `daemon-drill`(17), `app-check`·`app-test-ssh`·`app-e2e`·`app-verify-mac`·`shot`(20), `ui-tokens`·`ui-check`·`ui-test`·`ui-visual`·`ui-visual-update`·`shot-mac`·`ui-storybook`(21), `mobile-check`·`mobile-e2e`·`mobile-shot`·`mobile-push-test`(26), `vendor-verify`·`licenses`·`ai-smoke`(07), `check-arch`(06). `app-test-ssh`와 `test-conformance-ssh`는 같은 sshd 환경을 쓰고 대상이 다르다(앱의 Rust 전송 / 데몬 프로토콜).

### 3.16 CI [제안]

- 호스팅 CI에서 테스트를 돌리지 않는다(06 O-11, D22-14). `just verify`와 `just test-all`은 서버에서 사람이나 에이전트가 레시피로 돌린다.
- 예외: Windows 앱 빌드(`app-build-win-ci`, 20 §3.12.2)가 쓰는 GitHub Actions 워크플로 `desktop-windows.yml` 안에서 셸 스모크(20 DM-30)를 함께 돈다. 브랜치 push가 필요하므로 사람 확인 뒤에만 실행한다. 이 워크플로는 비밀을 쓰지 않는다(가짜 데몬).
- 17 §6.2·19 §6.3·10 §6.2의 "CI" 표현은 각각 "verify"(10: 시드 20개), "`daemon-systest`에서만"(17), "`test-conformance-ssh`"(19)로 읽는다(§5.2).
- 야간 실행 [제안, 기본 꺼짐]: 사용자 systemd 타이머 `helm-test-nightly.timer`가 `just test-deep`을 돌리고 실패하면 17의 `helm-alert@`로 알리는 구성. MVP 구현 중에는 끄고, M11-12(운영 데몬 설치) 뒤에 켠다(23 §5.2 "22"(3), Q22-04).

### 3.17 커버리지와 완료 기준

#### 3.17.1 추적 완결성 (D22-2)

- 관문: `just test-trace`. §3.19 색인 전체를 23 M0-12에서 `tests/trace/index.ts`로 옮기고 항목마다 `stage`(mvp, phase2, phase3, later)와 `wbs`(그 시험을 만드는 23 WBS 행)를 단다. 끝난 WBS 행 집합(`tests/trace/done.ts`, 행을 끝낼 때 같은 커밋에서 더한다)에 든 항목은 테스트 제목에 ID가 없으면 실패하고, 나머지는 경고만 낸다. 마일스톤을 직선 순서로 보지 않으므로 23의 병렬 갈래에서도 판정이 하나로 정해진다.
- `manual` 항목은 `tests/trace/manual.json`의 마지막 수행 날짜·결과·기록 위치를 본다. MVP 완료 판정(§3.17.3) 때만 필수다.

#### 3.17.2 코드 커버리지 [제안]

- 줄 커버리지를 관문으로 쓰지 않는다(D22-15).
- 관문 하나: `@helm/kernel`과 `@helm/domain`의 `src/rules/**`, `src/policy/**`, `src/commands/**`, `src/asking/**` 분기 커버리지 90% 이상. 커널은 분기가 곧 규칙이므로 시험하지 않은 분기는 시험하지 않은 규칙이다. 측정은 `just coverage`, 관문 검사는 `just test`가 커널 프로젝트에 한해 V8 커버리지를 켜고 한다(커널 테스트는 빨라서 부담이 작다) [가정: 실행 시간은 구현 때 확인].
- 그 밖의 패키지는 `just coverage` 보고만 한다.

#### 3.17.3 MVP 완료 판정 (01 §3.8.3)

| 01 §3.8.3 항목 | 확인 |
|---|---|
| 1. MVP 유즈케이스 AC를 가짜 모델 대본과 E2E로 통과 | `just test-all` 통과. 판정은 "`stage: mvp` 항목 누락 0, 격리 목록 0"이다(2·3단계 항목의 경고는 판정에 넣지 않는다). MVP WBS 행이 모두 `done.ts`에 있어야 한다. 22/E2E-UC01~UC17 통과 |
| 2. 실제 모델로 UC-01·UC-02·UC-07 끝까지 수행한 기록 | 운영 이벤트 로그(테스트 아님). 사전 점검으로 22/EV-03 |
| 3. macOS·Windows에서 Tailscale·SSH 경로로 답한 기록 | 22/RE-01(manual 기록). 23 SP-10이 대체 경로(SSH 경로만)로 가면 Tailscale 경로 기록은 남길 수 없다. 그때는 판정 표에 "경로 ① 미충족, SP-10 대체"와 사유를 적고 사용자 확인을 받는다(결정 38의 두 경로 요구를 테스트가 대신 충족시키지 않는다) |
| 4. 데몬 강제 종료 뒤 중단됨 정리·재개, 이벤트 손실 0 | 22/FI-01, 22/FI-03, 22/FI-22(a), 17/T17-30(manual) |
| 5. `just verify` 통과 | `just verify` |
| (22 추가) 격리 기본 수준 | `daemon-systest`의 S1 묶음 통과(bwrap 설치 뒤). 23 SP-04가 대체 경로(S1b)로 가면 S1b 묶음 통과로 판정하고, S1에서만 도는 초안·검증 실행(판정 J-108)은 꺼진 상태임을 함께 확인한다 |
| (22 추가) 복원 훈련 | 22/FI-21 1회 기록 |

모듈의 완료 = 그 모듈 소유 문서 §6의 테스트 통과 + 그 ID가 추적 색인에 연결됨 + `just verify` 통과. 화면이면 `just shot` 비교, 앱이면 `just app-e2e`를 더한다(사용자 규칙, 20 §6).

### 3.18 플래키, 느린 테스트, 테스트 데이터 관리

#### 3.18.1 플래키 대응 [제안]

1. Vitest `retry: 0`. 재시도로 통과시키지 않는다.
2. 플래키를 발견하면 그 테스트를 `tests/trace/quarantine.json`에 `{ id, file, since, until(최대 7일), reason, seen }`으로 올리고 실행에서 건너뛴다. 건너뛴 ID는 추적 검사가 "격리 중" 경고로 보인다. 기한이 지나면 추적 검사가 실패한다.
3. D0 계층(`unit`, `prop`, `contract`, `scenario`, 같은 프로세스 `fault`)의 플래키는 격리하지 않는다. 결정성 결함(주입하지 않은 시계·난수·순서 의존)이므로 바로 고친다. 원인 찾기: 같은 테스트를 `--sequence.shuffle`·`--repeat 50`으로 돌리는 `just test-flaky <파일>` [제안].
4. 흔한 원인과 규칙: 실제 시간 대기(금지, §3.5.1), 포트 고정(항상 0), 공유 임시 디렉터리(테스트마다 `tempDir`), 정렬 안 된 목록 비교(정렬 또는 의미 비교), 파일 시스템 감시 지연(폴링 + 상한), 남은 자식 프로세스(각 테스트 뒤 프로세스 그룹 확인, 22/ST-05).
5. 같은 실수가 두 번 나오면 AGENTS.md 테스트 절에 한 줄을 더하자고 제안한다(사용자 규칙, [결정 54]: 제안까지만 하고 동기화는 별도 도구가 맡는다).

#### 3.18.2 느린 테스트 분리

- 기준: 파일 하나가 서버에서 10초를 넘으면 `*.slow.test.ts`. 테스트 하나가 2초를 넘으면 원인을 먼저 본다.
- verify 시간이 목표(5분)를 넘으면 `vitest --reporter=json`의 파일별 시간 상위 10개를 `just test-trace --report`가 함께 보인다.
- 느린 것으로 옮겨도 추적 ID는 유지된다. 추적 검사는 계층과 관계없이 제목을 모은다(`test-slow` 결과 JSON도 읽는다. 최근 실행 결과가 없으면 정적 수집: 파일을 읽어 `it("…")` 제목만 뽑는다).

#### 3.18.3 테스트 데이터 관리

| 데이터 | 위치 | Git | 갱신 |
|---|---|---|---|
| 대본(`*.scenario.ts`) | `tests/scenarios/` | 넣음 | 코드 리뷰 |
| 손 테이프 | 대본 안 또는 `tests/tapes/authored/` | 넣음 | 코드 리뷰 |
| 녹화 테이프(익명 고정 과제) | `tests/tapes/recorded/` | 넣음(`tape-promote` 검사 통과분) | 프롬프트·모델 변경 시 다시 녹화 |
| 골든 파일 | 각 `test/golden/` | 넣음 | `just test-golden-update` + 검토 |
| 합성 작업 공간 템플릿 | `tests/harness/workspaces/` | 넣음 | |
| 합성 외부 로그 | `packages/observer/test/fixtures/` | 넣음 | 16 AS-1·AS-2(실제 형식 확인) 뒤 |
| 회귀 대본(속성 테스트) | `test/regressions/` | 넣음 | `test-deep` 실패 뒤 |
| 시각 기준 이미지 | `~/projects/helm/design/visual-baselines/` | 넣지 않음(잠금 파일만) | `just ui-visual-update` |
| 화면 캡처 | `~/projects/helm/design/shots/` | 넣지 않음 | `just shot` |
| 성능·E2E·시스템 시험 데이터 | `/srv/volumes/helm/{perf,e2e,systest,test-scratch}` | 넣지 않음 | `just test-clean` |
| 평가 과제·결과·녹화 | `/srv/volumes/helm/eval/` | 넣지 않음(익명 고정 과제 정의만 `tests/eval-tasks/`) | |
| 테스트 보고 | `/srv/volumes/helm/test-reports/` | 넣지 않음 | `test-all` |

- 테스트 데이터는 한국어 문장을 쓴다(UI 문구 언어 결정 37). 고정 데이터에 공백 없는 긴 문자열, 영어·한국어 혼합, 이모지, 빈 값, 극단 값을 포함한다(21 §6.3).
- 안정 스키마 승격(원전 최소 법칙 12): 2단계·3단계 기능의 이벤트·레코드 스키마는 G1 기록 전에는 업캐스터로 바꿀 수 있는 후보로 둔다. 이 이벤트들의 골든 파일은 `stage`를 달아 두고, 스키마를 바꿀 때 업캐스터 시험(09 UT-05)에 이전 골든을 입력으로 넣는다. MVP 이벤트의 스키마 변경도 같은 절차를 따른다.
- 레코드 스키마가 바뀌면(08) 픽스처는 명령으로 다시 만들어지므로 고칠 것은 대본과 골든뿐이다. 이벤트 payload 버전이 오르면(09 업캐스터) 이전 골든을 업캐스터 시험 입력으로 남긴다(09 UT-05).

### 3.19 추적 색인

문서별 테스트 ID → 계층 → 실행 레시피. 그 문서 §6에 ID가 없는 단위는 이 문서가 붙인 `UT-nn`(문서의 표 행 순서)을 쓴다. 코드판은 `tests/trace/index.ts`이고 이 표와 같은 커밋에서 고친다. "레시피"의 `test`는 `just test`(= verify에 포함).

#### 3.19.1 01·02 (제품·유즈케이스)

| ID | 내용 | 계층 | 레시피 |
|---|---|---|---|
| 01 §6 | §3.8.5 끝 표로 다른 ID에 대응 | — | — |
| 02/AC-01-01~AC-17-04 | §3.8.5 표 | scenario 외 | `test`, `test-scenarios` 등 표 참조 |
| 02/UC-xx/<흐름> | §3.8.4 대본 | scenario | `test`(runtime), `test-scenarios` |

#### 3.19.2 03·04·05 (UX)

| ID | 단위(그 문서 §6 행) | 계층 | 레시피 |
|---|---|---|---|
| 03/UT-01 | 화면 ID·경로 표(타입 오류) | unit(typecheck) | `typecheck` |
| 03/UT-02 | 최상위 내비게이션 | ui | `ui-test` |
| 03/UT-03 | 셸 영역 1280·1100·900px | visual | `ui-visual` |
| 03/UT-04 | 딥 링크 | unit | `test` |
| 03/UT-05 | 상태 라벨 목록 | unit | `test` |
| 03/UT-06 | 표시 번호(같은 로그 → 같은 번호) | unit | `test`(12/T-VW-01과 함께) |
| 03/UT-07 | TUI parity 표 | unit | `test` |
| 03/UT-08 | 세 깊이에서 반대 근거·이의·낡음 배지 | ui | `ui-test` |
| 03/UT-09 | 휴대폰 화면 ID(결과 확인 버튼은 산출물을 열기 전 비활성) | unit | `test` |
| 04/UT-01 | 공통 상태 표시(연결 상태 9종 스토리 + 스크린샷) | ui, visual | `ui-test`, `ui-visual` |
| 04/UT-02 | 명령 의도 공통(`basisSeq`, 멱등 키, 거부 세 갈래 문장) | unit | `test` |
| 04/UT-03~13 | `SCR-HOME`, `SCR-BRIEF`, `SCR-QUESTION`, `SCR-AUTO`, `SCR-STIM`, `SCR-AGREE`, `SCR-REVIEW`, `SCR-EVIDENCE`, `SCR-DIALS`, `SCR-CONNECT`, `SCR-RECOVERY` | ui | `ui-test`, `test`(앱) |
| 04/UT-14 | 화면별 선형 텍스트 골든 | ui | `ui-test` |
| 04/UT-15~17 | 안전 모드·읽기 전용 화면, 새 일 echo 미리보기, 뷰 타입 대응표 | ui, unit | `ui-test`, `test` |
| 05/UT-01 | 공유 문구 목록(한글 리터럴 검사) | unit | `test`, `ui-check` |
| 05/UT-02 | 금지 표현 | unit | `test` |
| 05/UT-03 | 조사 처리 | unit | `test` |
| 05/UT-04~07 | 질문 응답, 자극 반응, 이의 걸기, 의미 미리보기 | ui | `ui-test` |
| 05/UT-08 | 알림(세 번 이상 없음, 본문 없음, 시간당 상한, 5초) | unit(20/DM-28) + perf(22/PF-15) | `test`, `perf` |
| 05/UT-09 | 단축키(한글 입력 상태 `code` 기준) | ui, e2e | `ui-test`, `app-e2e` |
| 05/UT-10 | 접근성(axe, 흑백, 낭독 빈도) | ui, visual | `ui-test`, `ui-visual` |
| 05/UT-11 | 오류 문구(19 오류 코드 대응표) | unit | `test` |
| 05/UT-12 | 응답 이름 통일 | unit | `test` |
| 05/UT-13 | 계획 표시(`authoredBy` 카드, 계획 방식 다이얼 값, 두 번 어긴 계획의 표시) | ui | `ui-test` |
| 05/UT-14 | 결과 확인 알림 표시(설정 기본 `none`, 묶음 푸시는 개수만, 즉시 푸시) | ui, unit | `ui-test`, `test` |

#### 3.19.3 06·07 (구조·pi)

| ID | 내용 | 계층 | 레시피 |
|---|---|---|---|
| 06/S0 | 빈 패키지에서 `setup && verify` | unit | `verify` |
| 06/S1 | `--conditions=source` 실행 | int | `test` |
| 06/S2 | R1~R14 위반 fixture | unit | `test`(scripts 프로젝트) |
| 06/S3 | 설정 우선순위·거부 | unit | `test` |
| 06/S4 | 엔진 골격(재생, 충돌, 롤백) | int | `test` |
| 06/S5 | 세 리스너 동등성 | conf | `test`(22/CF-01) |
| 06/S6 | `ssh -W` 경로 | conf | `test-conformance-ssh`(22/CF-02) |
| 06/S7 | 관찰 감독기 경계 | int, sec | `test` |
| 06/S8 | 진단 명령 | int | `test` |
| 06/S9 | 어댑터 계약 골격, 가짜 어댑터 | conf | `test`(22/CF-04) |
| 07/V1~V11 | vendor 구현 단위(07 §6) | contract, unit | `test`, `vendor-verify` |
| 07/I1~I5 | import 무결성 | contract | `test`, `vendor-verify`, `check-arch` |
| 07/C1~C25 | pi 동작 계약 | contract | `test` |

#### 3.19.4 08·09 (도메인·저장소)

| ID | 단위 | 계층 | 레시피 |
|---|---|---|---|
| 08/UT-01 | `ids.ts` | unit, prop | `test` |
| 08/UT-02 | 시간·행위자·능력 타입 | unit | `test` |
| 08/UT-03 | 능력표 A | unit | `test` |
| 08/UT-04 | 공통 타입(autonomy, quality 등) | unit | `test` |
| 08/UT-05 | 레코드 44종 스키마(유효 1·무효 3 이상) | unit | `test` |
| 08/UT-06 | LoopId 18개 | unit | `test` |
| 08/UT-07 | `promotionMissing`(helm-toy fixture) | unit | `test` |
| 08/UT-08 | `canDependOn` | unit | `test` |
| 08/UT-09 | R-01~R-55 데이터(카탈로그·가드 교차) | unit | `test` |
| 08/UT-10 | 상태 기계 데이터(도달성·중복·종료·카탈로그) | unit | `test` |
| 08/UT-11 | 거부 갈래 매핑 | unit | `test` |
| 08/UT-12 | 공개 export(`projection` 이름 없음) | unit | `test` |
| 08/UT-13 | 스키마 검증 성능 | perf | `perf`(22/PF-10) |
| 09/UT-01~06 | `envelope`, `payloads`, `meta`, `canonical-json`, `upcast`, `volatile` | unit | `test` |
| 09/UT-07~19 | `paths`, `lock`, `open`, `migrations`, `boot`, `commit`, `hash`·`integrity`, `projectors`, `rebuild`, `query`, `blobs`, `backup`·`restore`·`export`, `retention` | int, fault | `test`(일부 `test-slow`) |
| 09/UT-20 | `bench` | perf | `perf`(22/PF-01, PF-09) |

#### 3.19.5 10·11 (커널·묻기)

| ID | 단위 | 계층 | 레시피 |
|---|---|---|---|
| 10/UT-01 | 순수성(ESLint R4·R5, 1,000회 해시 동일, 동결 입력) | unit | `test`, `lint` |
| 10/UT-02 | 경로·채널·형식·자격 | unit | `test` |
| 10/UT-03 | 거부 분류(PT-18·19, 코드 패턴) | unit | `test` |
| 10/UT-04 | 명령 카탈로그(정상 1 + 거부 코드마다 1) | unit | `test` |
| 10/UT-05 | 08 제약 R-01~R-55 위반 | unit | `test` |
| 10/UT-06 | 상태 기계 전이 | unit | `test` |
| 10/UT-07 | 의존 규칙(= 22/DR-1~5) | unit | `test` |
| 10/UT-08 | 계획 초안 V-PLAN-01~07(= 22/PL-01~07, [판정 J-188]) | unit, prop, int | `test` |
| 10/UT-09 | 승격(helm-toy) | unit | `test` |
| 10/UT-10 | 권한 fixture 5개 | unit | `test` |
| 10/UT-11 | C/A 흐름(한 턴 흐름, 사람 조작 2회) | unit | `test` |
| 10/UT-12 | 파생 R-1~R-16 | unit | `test` |
| 10/UT-13 | 속성(= PT-01~19) | prop | `test`, `test-deep` |
| 10/UT-14 | 사후 검사 V-INV | unit | `test` |
| 10/UT-15 | 성능(`decide`, `impactOf`) | perf | `perf`(22/PF-07) |
| 10/UT-16 | 재생(골든, `reduce(apply)`) | unit | `test` |
| 10/PT-01~PT-19 | 불변조건 속성 | prop | `test`, `test-deep` |
| 11/AQ-01~24 | 게이트 판정, 권리 게이트, 질문 형식, 전달, 강도, 만료, 가정 비교, 병합, 가정 아래 행동, 중재자, 사람 부재, 혼자 정한 결정, 이의·재작업, 범위 줄이기, 승인, 사람 조작, 승인 극장 방지, 푸시, 늦은 답, 정지 중 만료, 고쳐서 허락, 막지 않는 권리 질문, 휴대폰 복귀, 결과 확인 알림 | unit | `test` |

#### 3.19.6 12·13 (런타임·도구)

| ID | 단위 | 계층 | 레시피 |
|---|---|---|---|
| 12/T-AI-01~12, T-AI-05b | 게이트웨이, 키, 사용량(T-AI-11 검색 사용량), editMode 해석(T-AI-12) | unit, contract | `test` |
| 12/T-AG-01~09 | 포크 루프 연결 | contract | `test` |
| 12/T-RT-01~14(T-RT-07b~07f, T-RT-14 포함) | 훅·기록, run 상태, 사람 제어, 웹 결과의 오염, 배치 중단, editMode 유지 | unit, int | `test` |
| 12/T-PJ-01~14 | 투영(T-PJ-04 속성, T-PJ-13·14 스크린샷과 바깥 글 표식) | unit, prop | `test` |
| 12/T-CP-01~04 | 컴팩션 | unit | `test` |
| 12/T-CR-01~08 | 복구 | int, fault | `test`, `test-faults`(프로세스판) |
| 12/T-CR-09 | 무작위 종료 100회 | fault | `test-faults` |
| 12/T-OW-01~03 | 소유권 | int | `test` |
| 12/T-CC-01~03 | 동시성 | unit, prop | `test` |
| 12/T-SC-01~06 | 스케줄러 | unit | `test` |
| 12/T-BG-01~05 | 예산(T-BG-05 검색 비용) | unit | `test` |
| 12/T-IN-01~04 | 입력 | unit, int | `test` |
| 12/T-SA-01~05 | 하위 실행 | int | `test` |
| 12/T-VW-01~04, T-VW-06~07, T-PV-01 | 화면 투영(T-VW-04 속성) | unit, prop | `test` |
| 12/T-VW-05 | 복귀 요약 결정적 부분 1,000 이벤트 1초 이하 | perf | `perf`(22/PF-05와 같은 측정. verify에서는 결정적 부분의 구조만) |
| 12/T-LC-01~03 | 생명주기(drain, abortAll, pause·resume) | int | `test` |
| 12/T-DL-01~02, T-ST-01 | 전달기, 휘발 스트림 | unit | `test` |
| 12/T-IQ-01~03 | 탐구 run | int | `test` |
| 13/T-TL-01~02 | 도구 모델 | unit | `test` |
| 13/T-PA-01~05 | 경로 정책 | unit | `test` |
| 13/T-BT-01~04 | 기본 도구 | unit, int | `test` |
| 13/T-SB-01~04 | 샌드박스 | sys | `daemon-systest` |
| 13/T-SC-01~03 | 범위 계산(12의 T-SC와 다름) | unit | `test` |
| 13/T-CD-01~03 | 변경 감지 | int | `test` |
| 13/T-RD-01 | 비밀 마스킹 | sec | `test` |
| 13/T-HT-01~06 | Helm 제안 도구 | unit, int | `test` |
| 13/T-FP-01 | 지문 | unit | `test` |
| 13/T-RB-01~03 | 되돌릴 지점 | int | `test` |
| 13/T-RP-01~06 | 하위 호출·REPL(REPL은 2단계) | int | `test` |
| 13/T-MC-01~04 | MCP(MCP 단계) | int | `test` |
| 13/T-PL-01~02 | 권한 레이어, 기준선은 다이얼로 못 끔 | unit | `test` |
| 13/T-AD-01~03, 13/AC-01~14 | 어댑터 계약·적합성 | conf | `test` |
| 13/T-IS-01~02, 13/T-OR-01, 13/T-UC-01 | 격리 운영(자체 시험 여섯, 데이터 디렉터리 거부, 고아 단위 정리, run 사이 외부 변경) | sys, int | `daemon-systest`(T-IS), `test`(T-OR, T-UC) |
| 13/T-SG-01~06 | 데몬 git 고정 환경(§3.11.4와 표본 공유) | sec(int), sys | `test`, `daemon-systest` |
| 13/T-NP-01~04 | 네트워크 프록시(주소 차단, 허용 목록, 도구의 프록시 경유, 네트워크 없는 실행) | sec(int), sys | `test`, `daemon-systest`(T-NP-03) |
| 13/T-WF-01~04, T-WS-01~02 | 웹 읽기·검색(주소 차단과 리디렉션 재판정, 변환 작업자, 크기 상한, 제공자 대체와 상한) | unit, int | `test` |
| 13/T-BR-01~07 | 브라우저(비-GET 거부와 보류, `taint.web` 뒤 POST, 낡은 ref, 크래시 뒤 불명, 스크린샷 3장, 다운로드) | int, sec, sys | `test`, `daemon-systest`(실제 Chrome) |
| 13/T-HL-01~05 | 해시라인 편집(낡은 태그, 연산 검사, 실행 직전 해시, `editMode` 기본, 재시작 뒤 첫 편집) | unit, int | `test` |
| 13/T-GR-01~04 | 고급 grep(`skip`과 `nextSkip`, 라운드로빈, `paths` 읽기 루트, 줄 자르기) | unit, int | `test` |
| 13/T-E01~T-E54 | §4 실패·경계 사례(행 하나가 시험 하나) | unit, int, sec, sys | `test`, `daemon-systest`(샌드박스 항목) |

#### 3.19.7 14·15·16 (오케스트레이션·탐구·관찰)

| ID | 단위 | 계층 | 레시피 |
|---|---|---|---|
| 14/C-1~C-15 | 계약, 조건, 상황 판정, 계획, 전환, 가드, 의존, 모드, 다이얼, 진입, 거시, 주의 예산, C/A 상한, 경계(C-4의 모델 초안 경로는 22/PL-02~07) | unit, prop | `test` |
| 14/C-16~C-17 | `decide` 재생(가짜 모델) | scenario(kernel 모드 재생) | `test` |
| 14/C-18 | `decide` 속성 | prop | `test`, `test-deep` |
| 14/C-19 | 이의 처리 | unit | `test` |
| 14/C-20 | 오케스트레이터 복구 | fault | `test`, `test-faults` |
| 14/C-21 | 클라이언트 없음 | scenario | `test` |
| 14/C-22~C-24 | 기능 플래그, 도구 안정성, 뷰 리듀서 | unit, prop | `test` |
| 14/C-25~C-29 | 결정성과 재생(C-25~C-27), 입장과 부재(C-28·C-29) | unit, prop, int | `test` |
| 15/T-01~T-25, T-27~T-29 | 탐구 엔진 | unit, int, golden | `test` |
| 15/T-26 | 평가 하네스(메모리 커널) | int | `test` |
| 15/E0~E4 | 모델 품질 평가 | eval | `eval-inquiry`, `eval-prompts`, `eval-repl`(E1은 `test`) |
| 16/OB-T01~T33 | 관찰 에이전트·지표 | unit, prop, sec, conf | `test` |

#### 3.19.8 17·18 (데몬·보안)

| ID | 계층 | 레시피 |
|---|---|---|
| 17/T17-01, 02, 05, 19, 24, 25, 37, 38 | unit | `test` |
| 17/T17-03, 04, 06, 09, 10, 11, 12, 13, 14, 16, 18, 20, 21, 29, 32, 33, 34, 35, 36, 39 | int(자식 프로세스) | `test`(10초 이하), 넘는 것은 `test-slow` |
| 17/T17-07, 08, 15, 17 | int(종료·마이그레이션 실패) | `test-slow` |
| 17/T17-22, 23, 26, 27, 28 | sys | `daemon-systest` |
| 17/T17-30, 31 | manual | — |
| 17/T17-40~47(복원 중 종료, 투영기 고장, 결정적 복구 실패, 가짜 시계, 모바일 정적 서빙, 시험 훅 차단, CLI 종료 코드, 임시 D: 복사) | int(45는 unit) | `test`, 40·42는 `test-faults` |
| 18/T18-01~04, 06, 07, 07b, 07c, 13, 15~23, 25, 27, 28 | sec(int) | `test`(T18-25는 `test-slow`) |
| 18/T18-26, 30 | unit | `test` |
| 18/T18-08~11, 14, 24, 29, 33 | sys | `daemon-systest` |
| 18/T18-05, 12 | manual | — |
| 18/T18-31 | sec(모바일, 26) | `test` |
| 18/T18-32 | sec(앱) | `ui-test` |
| 18/T18-36, 39~41, 43, 50, 51 | int | `test` |
| 18/T18-37, 38, 42 | unit | `test` |
| 18/T18-34, 35, 44~49, 52 | sys | `daemon-systest` |

#### 3.19.9 19·20·21 (프로토콜·앱·UI)

| ID | 단위 | 계층 | 레시피 |
|---|---|---|---|
| 19/UT-01~08 | envelope·codec, 오류 표, 등록 표, 핸드셰이크 스키마, 이벤트·뷰·스트림 스키마, 생성 스크립트, 브라우저 안전, 테스트 도구 | unit, contract | `test` |
| 19/UT-09~14 | 클라이언트 상태 기계, 백오프, 구독 복원·gap, 진행 중 명령함, 뷰 무효화, 휘발 스트림 | unit | `test` |
| 19/UT-15~22 | 리스너, 연결·핸드셰이크, 디스패처, 이벤트 구독(속성), 뷰(속성), 명령, 파일, 백프레셔 | int, prop | `test` |
| 19/CT-01~CT-50 | 적합성 시나리오(CT-47~50은 [판정 J-188]·[판정 J-189]·[판정 J-130]) | conf | `test`(세 리스너), `test-conformance-ssh` |
| 20/DM-01~DM-30 | §6.1 완료 기준 행(DM-nn 순서): 프로필 저장·검증, 키체인, SSH 인자·실패 분류, WebSocket-over-stream, 전송 관리자, SSH 경로 통합, blob, 페어링, 토큰 보낼 곳, capability·CSP, blob 스킴 응답, 공급망, 연결 계층, 깨어남·포커스 확인, 코어 연결, 뷰 읽기, 명령, 초안, 시작 시간, 라우터, 딥 링크, 알림, 트레이·배지, 오류 경계, 빌드, `@helm/client-react`, 설정, 알림 규칙, 서드파티 고지, 셸 스모크 | unit, int, e2e, manual | `test`, `app-check`(DM-10·12·29), `app-test-ssh`(DM-06), `app-e2e`, `app-verify-mac`(DM-30), manual(DM-02·05·19·21·25·27) |
| 20/IT-01~IT-20 | 가짜 데몬 통합 | e2e | `app-e2e` |
| 20/MC-01~MC-14 | 수동 확인 체크리스트(20 §6.2) | manual | — |
| 21/TK-01~TK-11 | 테스트 종류(동작, 접근성, 키보드, IME, 선형 텍스트, 금지 패턴, 수명주기, 시각, 대비, 성능, 인자 표시(TK-11)) | ui, visual, perf | `ui-test`, `ui-visual`, `ui-check`(TK-09), `perf`(TK-10) |
| 21/U1~U9 | 구현 단계별 완료 기준 | ui, visual | `ui-test`, `ui-visual` |
| 21 정적 검사(§6.4) | 토큰 생성물 일치, 스타일 규칙, 재질 규칙, 가져오기, React 19 규칙, 위험 HTML, 문구, 아이콘 | unit(정적) | `ui-check` |

#### 3.19.10 26 (모바일)

| ID | 단위 | 계층 | 레시피 |
|---|---|---|---|
| 26/T26-01~T26-11 | 정적 서빙, 쿠키 인증, 푸시 등록 | sec(int) | `test` |
| 26/T26-12~T26-18 | 푸시 payload(T26-13 속성), 대상 계산(T26-15: 결과 확인 알림 세 값 포함), 송신(가짜 푸시 서비스), 11 강도 반영 | unit, prop, int | `test` |
| 26/T26-19~T26-23, T26-27 | 서비스 워커, 수명주기, 결정 가능 판정, 갱신 | unit, int | `test`(`mobile-check`) |
| 26/T26-24, T26-26 | 휴대폰 화면 시나리오, 누르는 영역·글자 크기 | e2e | `mobile-e2e` |
| 26/T26-25 | 화면 캡처 | visual | `mobile-shot` |
| 26/T26-28~T26-32 | 쿠키 갈래의 Origin 판정(T26-28·29), scope 거부(T26-30), `/files` CSP(T26-31), 송신 주소 검사(T26-32) | sec(int) | `test` |
| 26/T26-33 | 푸시 첫 시도가 모두 실패하면 `channel: brief`로 바꾼다(26 대상 계산 행 안의 시험) | unit, int | `test` |
| 26/T26-34~T26-35 | 두 창 중 하나만 연결·재전송(T26-34), 연결 진단 문장(T26-35) | unit, int | `test`(`mobile-check`) |
| 26/M-01~M-14 | iPhone 실기기 체크리스트 | manual | — |

#### 3.19.11 22 (이 문서)

| ID | 내용 | 계층 | 레시피 |
|---|---|---|---|
| 22/AX-01~15 | 공리 위반(§3.7.3) | unit 외 | `test` |
| 22/INV-1~7 | 불변조건(§3.7.4) | unit, prop | `test` |
| 22/DR-1~5 | 의존 규칙(§3.7.5) | unit, prop | `test` |
| 22/PL-01~07 | 계획 검사 V-PLAN-01~07(§3.7.5, [판정 J-188]) | unit, prop, int | `test` |
| 22/FI-01~32 | 장애 주입(§3.9.3) | fault, sys, manual | `test`, `test-faults`, `test-slow`, `daemon-systest` |
| 22/CF-01~05 | 적합성(§3.10) | conf | `test`, `test-conformance-ssh` |
| 22/PF-01~15 | 성능(§3.13) | perf | `perf` |
| 22/SY-01 | 설치 레시피 두 번 실행해도 데이터 보존(AC-11-01) | sys | `daemon-systest` |
| 22/SY-02 | 실제 데몬이 127.0.0.1·Unix 소켓에서만 듣는다(`ss -ltnp`, AC-11-02, NFR-S-2) | sys | `daemon-systest` |
| 22/SG-01~06 | 샌드박스 밖 데몬 git 탈출(§3.11.4, 13/T-SG-01~06과 표본 공유) | sec(int), sys | `test`, `daemon-systest` |
| 22/NT-01~03 | 결과 확인 알림 세 값(§3.12.7, [판정 J-189]) | unit, int, scenario(2단계) | `test` |
| 22/NW-01~04 | 내부망 차단과 외부 허용(§3.11.5, [판정 J-190 (2)]) | unit, int, sys | `test`, `daemon-systest` |
| 22/WB-01~03 | 요청 가로채기, taint.web, 외부 효과 분류(§3.11.5, [판정 J-190 (3)]) | unit, int, sys | `test`, `daemon-systest` |
| 22/HL-01~02 | 해시라인 낡은 태그와 편집 연산 검사(§3.11.5, [판정 J-190 (1)]) | unit, int | `test` |
| 22/ST-01 | 도메인·프로토콜 스키마와 뷰 타입에 Helm이 계산한 가역성 필드가 없다. 위험 표시 부품은 권한 레이어 출처 prop 없이 렌더되지 않는다(AC-07-16, 결정 2) | unit(정적) | `test` |
| 22/ST-02 | 테스트 위생 ESLint: 결정적 테스트 폴더에서 실제 시계·난수·`setTimeout` 금지, 고정 포트 금지 | unit(정적) | `lint` |
| 22/ST-03 | 픽스처에 실제 사용자 이름·홈 경로·비밀 형태 없음(§3.6.3) | unit(정적) | `test` |
| 22/ST-04 | 비밀 카나리아(§3.11.2) | sec | `test` |
| 22/ST-05 | 테스트 뒤 남은 자식 프로세스·열린 포트·임시 디렉터리 없음 | unit | `test` |
| 22/ST-06 | 테스트가 운영 데이터 디렉터리·운영 소켓을 열면 실패(`assertNotProduction`) | unit | `test` |
| 22/ST-07 | 실제 모델 호출 차단: 테스트 프로세스에 모델 키 없음, 루프백 밖 `fetch` 차단 | unit | `test` |
| 22/ST-08 | OPD+C 이름 충돌 검사: 14의 OPD+C 의무 ID(`opdc:<기준>.<이름>`)와 16의 지표 ID(`opdc.o.*`) 레지스트리를 읽어 두 집합에 같은 문자열이 없음, 각 ID가 자기 형식을 지킴(판정 J-149, J-112) | unit(정적) | `test` |
| 22/KIT-01 | `manualClock`: 만기 타이머를 만기 시각 순서로, 같은 시각이면 등록 순서로 실행. `set`으로 과거 이동. `fn`과 `now()`가 같은 값 | unit | `test` |
| 22/KIT-02 | `fixedIdFactory`: 1만 개가 모두 다르고 사전순이 생성순과 같음, 같은 seed·시계에서 같은 열, 08 ID 형식 통과 | unit | `test` |
| 22/KIT-03 | `seededRandom`: 같은 seed 같은 열, 다른 seed 다른 열 | unit | `test` |
| 22/KIT-04 | `tempDir`: 끝나면 지움, `keepOnFail`이면 실패 때 남기고 경로 출력, tmpfs 감지 시 `HELM_TEST_SCRATCH` 사용 | unit | `test` |
| 22/KIT-05 | `withIsolatedEnv`: `HOME`·`XDG_*`·`TMPDIR` 교체, `*_API_KEY`·허용 밖 `HELM_*`·`SSH_AUTH_SOCK` 제거, 끝나면 원래대로 | unit | `test` |
| 22/KIT-06 | `assertNotProduction`: 운영 데이터 디렉터리·운영 소켓 경로와 그 아래에서 throw, 심볼릭 링크로 가리켜도 throw | unit | `test` |
| 22/KIT-07 | `normalizeEvents`·`eventDigest`·`diffEvents`: strict는 바이트 동일, semantic은 §3.5.3 규칙(ID 별칭, 의미 필드, 목록 없는 타입은 payload 전체) | unit | `test` |
| 22/KIT-08 | `expectGolden`: 다르면 실패하고 차이 출력, `HELM_GOLDEN_UPDATE=1`일 때만 다시 씀 | unit | `test` |
| 22/E2E-UC01~UC17 | 화면 흐름(§3.12.6) | e2e | `app-e2e` |
| 22/RE-01~03 | 실제 데몬 E2E | e2e, manual | `e2e-real` |
| 22/EV-01~03 | 요약 누락, 관찰 판정 일치, 대본 적합 | eval | `eval-summary`, `eval-observer`, `eval-flows` |
| 22/EV-04 | 편집 방식 A/B(§3.14.2, [판정 J-190 (7)]) | eval | `eval-edit` |
| 22/V02-01~56 | 원전 57개 대응(§3.7.7). 행마다 대응 ID가 위 표에 있어야 한다 | — | — |

## 4. 실패·예외·경계 사례

테스트 체계 자체의 실패와 경계다.

| ID | 상황 | 처리 |
|---|---|---|
| TE-01 | 테이프가 바닥났는데 런타임이 모델을 더 부름 | 테스트 실패("테이프 소진: role=<역할> n=<요청 순번>"). pi faux 기본 오류 응답으로 넘어가지 않는다(§3.5.4 규칙 2) |
| TE-02 | 대본 끝에 테이프 응답이 남음 | `assertExhausted` 실패. 대본이 의도한 모델 호출 수와 실제가 다르다는 뜻이다 |
| TE-03 | 녹화 테이프의 `contextHash`가 투영 규칙 변경으로 맞지 않음 | 실패 + 두 투영의 차이 출력. 다시 녹화(`just eval-prompts --record`)하거나 손 테이프(`role-queue`)로 바꾼다. 녹화 테이프를 고치지 않는다 |
| TE-04 | 골든 파일이 커밋마다 바뀜(불필요한 변동) | 골든에 들어간 비결정 값(시각, 순서)을 찾아 주입하거나 정규화한다. `test-golden-update`를 습관적으로 돌려 덮지 않는다 |
| TE-05 | 시각 기준 이미지가 없거나 잠금 해시와 다름 | `ui-visual` 종료 코드 2(환경 문제). 이미지를 다시 만들고 검토(`ui-visual-update`) |
| TE-06 | Playwright 브라우저가 설치되지 않음 | 해당 레시피 종료 코드 2. `just setup`이 `pnpm exec playwright install chromium webkit`을 한다(06 S0에 요구) |
| TE-07 | bwrap 없음, sshd 없음, Mac 잠듦 | 해당 묶음만 종료 코드 2 또는 "건너뜀" 보고. verify는 영향 없음 |
| TE-08 | 테스트가 실제 `HOME`의 파일을 읽음 | 공통 준비가 `HOME`을 바꾸므로 원래 경로는 열리지 않는다. 절대 경로를 하드코딩한 경우는 22/ST-03·ST-06이 실패 |
| TE-09 | 테스트가 실수로 실제 모델을 부름 | 키가 없고 루프백 밖 `fetch`가 막혀 있어 즉시 실패(22/ST-07). 비용 발생 없음 |
| TE-10 | 테스트가 운영 데몬과 포트·소켓·데이터를 같이 씀 | 임시 포트(0), 임시 `XDG_RUNTIME_DIR`, `assertNotProduction`. 정식 데몬이 돌고 있어도 결과가 같아야 한다 |
| TE-11 | 임시 디렉터리가 tmpfs라 저장소가 시작을 거부(17 T17-05) | `testkit`이 tmpfs를 감지해 `HELM_TEST_SCRATCH`를 쓰거나 테스트 저장소를 `allowTmpfs`로 연다(§3.6.5) |
| TE-12 | 시간대·로케일에 따라 결과가 바뀜 | 기본 `TZ=UTC`, 표시 시험은 시간대를 명시(§3.5.1) |
| TE-13 | 속성 테스트가 deep에서만 실패 | 시드와 줄인 열을 회귀 파일로 저장하고, 고친 뒤 회귀 파일을 커밋한다. 회귀 파일은 verify에서 매번 재생된다 |
| TE-14 | 자식 프로세스 시험이 끝난 뒤 프로세스가 남음 | 22/ST-05 실패. 프로세스 그룹 단위로 띄우고 테스트 뒤 그룹째 정리 |
| TE-15 | 장애 시험에서 데이터 디렉터리가 깨진 채로 남아 다음 테스트에 영향 | 테스트마다 새 임시 디렉터리. 실패 시 `keepOnFail`로 남겨 원인 조사 |
| TE-16 | 다른 문서가 테스트 ID를 바꾸거나 지움 | 추적 검사가 "색인에 있으나 테스트 없음" 또는 "테스트에 있으나 색인에 없음"으로 실패. 색인(`tests/trace/index.ts`)과 이 문서 §3.19를 같은 커밋에서 고친다 |
| TE-17 | 커널 규칙 데이터(08 R 표, 08 상태 기계)에 행이 더해짐 | 데이터에서 사례를 만드는 시험(§3.7.1)이 새 행을 자동으로 시험한다. 새 행에 위반 사례가 없으면(08 UT-09 교차 검사) 실패 |
| TE-18 | 2단계 기능이 꺼져 있는데 그 대본이 돔 | 대본의 `stage`와 기능 플래그(01 §3.8.4, 14 `features.ts`)를 하네스가 비교해 건너뛰고, 추적 검사는 그 AC를 "단계 미도달"로 보인다 |
| TE-19 | 같은 프로세스 크래시 뒤 이전 인스턴스의 늦은 비동기 작업이 쓰기를 시도 | 이전 저장소 핸들이 닫혀 `Fenced` 오류. 이 오류가 나도 테스트는 통과해야 하며, 쓰기가 성공하면 22/FI 공통 검사(§3.9.4-8)가 실패 |
| TE-20 | 실제 IME·OS 알림처럼 자동화할 수 없는 것 | manual 계층으로 두고 `tests/trace/manual.json`에 수행 기록. MVP 완료 판정에서만 필수 |
| TE-21 | 성능 측정 중 다른 서비스 부하 | 결과 JSON에 측정 시점 부하(로드 평균, 정식 데몬 상태)를 남기고, 목표를 넘으면 한 번 다시 잰다. 두 번 넘으면 실패 |
| TE-22 | 테스트 데이터에 한국어 조사·정규화 차이(NFC/NFD) | 골든 비교 전에 NFC 정규화. 입력 픽스처는 NFC로 커밋한다(Mac에서 만든 파일 이름 주의) |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공하는 것 |
|---|---|
| 모든 설계 문서 | 테스트 계층(§3.1), 추적 ID 형식과 색인(§3.4.3, §3.19), 이름 규칙(§3.4.2), `just verify` 범위(§3.15) |
| 02 | `ScenarioScript` v1 정본(§3.8.1), 실행 모드(§3.8.2), 대본 목록(§3.8.4), AC 추적표(§3.8.5) |
| 06 | `@helm/testkit` 공개 API(§3.5.2), `@helm/tests` 패키지와 그 의존 층, 테스트 레시피 묶음(§3.15.3), 테스트 위생 ESLint 규칙(22/ST-02) |
| 07 | 포크 무결성 묶음의 계층·레시피 배치(§3.10.4), 녹화 테이프 재생을 pi 업그레이드 확인에 쓰는 절차(§3.5.4) |
| 09 | 장애 주입 수단 목록(§3.9.1), 결정성 비교 방법(§3.5.3), 성능 목표의 측정 방법(§3.13) |
| 10 | 속성 테스트 운용(§3.7.2), 공리·불변조건·의존 규칙 대응표(§3.7.3~§3.7.5), 원전 57개 대응(§3.7.7) |
| 12 | 모델 테이프 형식과 재생기(§3.5.4), 종료 지점 목록(§3.9.2), 장애 시나리오(§3.9.3) |
| 13 | 어댑터 적합성 실행 위치와 거짓 광고 시험(§3.10.2), 샌드박스 시험 배치(§3.11.3) |
| 14, 15 | 재생 테스트의 저장소 규칙(D22-6), 모델 평가 레시피(§3.14) |
| 16 | 합성 픽스처 규칙(§3.6.3), 지표 골든 배치, 평가 기록 연결(§3.14.2) |
| 17, 18 | 시스템 시험·수동 시험 배치(§3.11, §3.19.8), 비밀 카나리아(§3.11.2), 테스트 데이터 디렉터리(§3.6.5) |
| 19 | 세 리스너 동등성과 SSH 경로 실행 방법(§3.10.1) |
| 20, 21 | 기준 이미지 환경과 보관(§3.12.2), IME·접근성 기준(§3.12.3~§3.12.4), 결정 18 층별 표(§3.12.5), E2E 범위(§3.12.6) |
| 23 | 마일스톤 관문 레시피 `just test-all`, 추적 검사의 마일스톤 단계 표시(§3.17.1), MVP 완료 판정 표(§3.17.3) |
| 25 | 용어: 테스트 계층, 추적 ID, 대본, 모델 테이프, 골든, 결정성 등급, 종료 지점, 비밀 카나리아, 플래키 격리 |
| 26 | 모바일 시험 배치(§3.12.7), 가짜 푸시 서비스 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01 | (1) §3.5.2 `HumanDecisionOp`의 `onNormalPath`·`extraReason`을 "이벤트 종류로 계산하는 16 사실"로 바꾸고 CA-6·CA-7 식과 §6 "사람 조작 기록" 행을 맞춘다(판정 J-76). (2) NFR-O-3의 "모델 연결 끊김 관찰"을 판정 J-109대로(run은 `model_unreachable`로 끝나고 17 상태에 보인다). §3.8.3 확인 방법은 이 문서 §3.17.3 |
| 02 | (1) §3.24의 형태 정본을 이 문서 §3.8.1 v1로 가리킨다(02의 `listener`·`send_draft`·`resend_pending`은 v1에 들어 있다). (2) §6의 "수용 기준 추적표" 위치를 이 문서 §3.8.5로. (3) AC-01-13·AC-03-10·AC-05-05·AC-07-09와 §6 "사람 조작 검사" 행의 `onNormalPath`·`extraReason=`을 "정상 경로 결정 조작(이벤트 종류로 계산)"·"정상 경로 밖 사유"로(판정 J-76). (4) UC-10 B4의 "모델 연결 끊김 관찰"을 판정 J-109대로 |
| 04 | 복원 표지 이벤트를 읽어 복귀 요약에 "복원 지점 이후 기록 없음"을 그린다(판정 J-152). 22 FI-26이 `view: brief`에서 표지 참조를 확인한다 |
| 05 | (1) 접근성 기준을 "axe WCAG 2.1 A·AA 태그 규칙 위반 0(영향도 무관)"으로(§3.12.4). (2) 10 거부 코드 ↔ 19 오류 코드 ↔ 05 문구 키 대응을 한 표로 두고 셋이 같은 표를 가리킨다(10·19·05 공동). 22는 그 표로 05 UT-11(대응표 시험)을 돌린다 |
| 06 | (1) `tests/`(`@helm/tests`, 비공개)를 작업 공간·`vitest.config.ts` `projects`·`architecture-rules.ts`에 더한다: 모든 `@helm/*`와 `testing` 하위 경로를 devDependencies로 쓸 수 있고 누구도 의존하지 않는 "시험 전용" 층. R3의 "테스트 파일에서만 import" 범위에 `tests/**`를 넣는다. (2) §3.16 레시피 색인에 테스트 묶음(`test-slow`, `test-deep`, `test-scenarios`, `test-faults`, `test-conformance-ssh`, `test-trace`, `test-golden-update`, `test-fixtures-views`, `test-clean`, `test-all`, `coverage`, `bench`, `perf-seed`, `e2e-real`, `eval-*`, `eval-edit`(22/EV-04), `tape-promote`)과 `_verify-steps`에 `test-trace`를 더한다. (3) §3.4.14 testkit 책임에 이 문서 §3.5.2 API를 적고, 12 §6의 "testkit의 faux 대본" 문장과 맞춘다. (4) 패키지 하위 경로 표에 `@helm/ai/testing`(모델 테이프 재생기·녹화기·가짜 모델 표)과 `@helm/engine/testing`을 더한다. (5) `just setup`이 Playwright 브라우저(Chromium, WebKit)를 설치한다. (6) 테스트 위생 ESLint 규칙(22/ST-02)을 §3.5.3 설정에 더한다 |
| 07 | faux 응답 함수에서 테이프를 읽는 방식(§3.5.4)이 pi-ai 1.1.0 `FauxResponseFactory`로 되는지 V4 단계에서 확인해 달라 |
| 08 | (1) E-02의 Goal 없는 Concern 거부 코드를 10의 `invalid.goal_link`로 맞춘다(10이 코드 정본). (2) `Scope.sendTargets` 주석·R-05·U-07을 판정 J-91로(MVP 커널은 읽지 않음, send는 언제나 권리 게이트). (3) L2969 등 저장 값 `local_admin`을 `localAdmin`으로. (4) `IdFactory`가 시각 함수와 seed를 받는 구현(`fixedIdFactory`)을 허용하는지 확인. (5) 선택지의 구조화 `scope: Scope`(판정 J-133) |
| 09 | (1) 멱등 지문 입력을 `{type, actor, viaKey(via), payload}`로 바꾼다. 연결 ID·리스너·attempt가 바뀐 재전송이 같은 지문이 되어야 22/FI-25가 성립한다. (2) `openStore`에 테스트 전용 묶음 `testing: { bootEpoch, storeId, allowTmpfs }`(`faultInjector`도 이 묶음으로). (3) `@helm/store/testing`에 SQLite 오류 주입(`SQLITE_FULL`·`SQLITE_IOERR`·`SQLITE_CORRUPT`, 다음 n번 쓰기). (4) `EVENT_META`에 의미 필드 목록(`semanticFields`). (5) `restore()`에 위험 이벤트 재적용 단계(기기 폐기, Grant 철회, 합의 철회·축소, 다이얼 하향, `blob.redacted`)를 두고 재적용 전에는 리스너를 열지 않는다(FI-20). (6) 판정 J-133의 합의 활성 이벤트(제안 이름 `agreement.activated_by_choice`). (6-1) 복원 표지 이벤트 이름(판정 J-152). (7) §6.2 `src/projectors/core` 완료 기준 (2)의 "유즈케이스 시나리오 이벤트 열"은 `tests/scenarios/golden/*.golden.jsonl`이다 |
| 10 | (1) §3.6.6 범위 검사를 `if primitive == 'send': needsApproval = true`로(판정 J-91). Grant 포함 검사도 send의 승인을 없애지 않는다. (2) V-POL-02에 Goal 상태 조건과 `policy.goal_not_active`(판정 J-130). (3) 판정 J-133의 선택 범위 echo 활성 갈래(합의 범위 ⊆ 선택 범위, 근거는 사람이 직접 고른 선택만). (4) 모든 명령에 TypeBox payload 상수를 두고 `COMMAND_SPECS`에서 `CommandType`·`CommandPayload<T>`를 파생한다(22 대본 타입이 이것을 import한다). (5) §3.16.2 원전 불변 표에 시험 ID 열(22 §3.7.8). (6) §6.2 "속성" 행의 "(CI는 시드 20개)"를 "verify는 고정 시드 20개, `test-deep`은 새 시드 100개"로. (7) 거부 코드 ↔ 19 ↔ 05 대응표(05 요구 (2)와 같음). (8) §6.2 행에 `10/UT-01~16` 번호를 붙여 주면 추적이 쉽다(선택). 계획 초안 행이 여덟째다 |
| 11 | (1) `urgencyOf` 첫 줄과 전달 채널(`app`·`push`·`brief`)을 26 §3.4.3·판정 J-119·[결정 48]대로. 부재는 14 파생 함수로 계산한다. 22 UC-04/away-push가 이 규칙을 시험한다. |
| 12 | (1) §6 첫 문장의 faux 대본 위치를 `@helm/ai/testing`의 모델 테이프 재생기로. (2) `@helm/runtime/testing`에 `whenIdle()`. (3) 종료 지점(§3.9.2)과 결정적 실패 훅(`HELM_TEST_FAULT`)을 코드에 두고 `HELM_TEST_HOOKS=1`이며 운영 경로가 아닐 때만 켠다. (4) `ModelGateway`를 데몬 조립에서 주입받는다. (5) T-VW-05(1초)는 `just perf`에서. (6) `recover()`에 run과 무관한 단계: 상태 `started`·`replaying`인 모든 호출을 정리, 투영에 `executedByRunId`. intend 결과가 `replayed: true`면 실행하지 않는다(FI-14). (7) `recover()`는 run 단위로 예외를 가두고 실패 run을 `ended(failed, recovery_error)`로(FI-27). 복구 멱등 키는 12 형식으로 09와 맞춘다. (8) §3.4.6에 "외부 효과 가능 호출의 타임아웃·신호 종료·전송 끊김·취소·서버 크래시 → `outcome_uncertain`"(FI-28). (9) 완료 커밋이 디스크 부족으로 실패한 결과의 보관과 해제 뒤 커밋(FI-16(c)). (10) 절전 복귀 catch-up과 단조 시계 감시(FI-31). (11) 복원 표지 이벤트 뒤 첫 부팅을 안전 모드로(자동 재개·에이전트 타이머·관찰 실행 없음, 미소진 승인 만료, 판정 J-152, FI-26) |
| 13 | (0) 데몬이 샌드박스 밖에서 부르는 모든 git 호출의 방어(V4-001): 22 SG-01~06이 결과로 판정한다. (1) 기본 도구 실행기 교체 지점(`FakeToolExecutor`). (2) 도구 → 명령 대응을 데이터로 내보낸다(`kernel` 모드 번역). (3) T-E14·T-E25 기대를 12 (8)의 결과 불명 규칙으로(FI-28) |
| 14 | (1) §6.2 머리말의 "메모리 SQLite"를 임시 파일 SQLite(또는 저장소 없는 `@helm/engine/testing`)로. (2) `run.ended(failed, model_unreachable)`이면 질문 없이 대기하고 회복 신호 뒤 다시 요청한다(판정 J-109, FI-23). (3) 부재 파생 함수(판정 J-119)를 하네스가 import할 수 있는 순수 함수로 둔다 |
| 15 | (1) E1 재생 결정성은 `helm.model-tape.v1` 녹화 테이프(`context-hash`)를 쓴다. (2) 평가 데이터 디렉터리와 `--max-usd` 비용 상한(§3.14.2). (3) 익명 고정 과제 정의를 `tests/eval-tasks/`에 둔다 |
| 16 | (1) 관찰 어댑터는 루트를 인자로만 받는다(§3.6.3). (2) 정상 경로 사실 이름을 하나로 정하고 CA-6 식이 그 사실을 읽게 한다(판정 J-76). 22 하네스가 같은 함수를 쓴다. (3) 지표 타입의 위치(`@helm/protocol`이 `@helm/observer/metrics`를 다시 내보내는 방향은 06 의존 방향과 반대다. 06과 정한다). (4) 22/EV-02 평가용 합성 후보 묶음 형식(2단계) |
| 17 | (0) 복원을 마칠 때 복원 표지 이벤트(이름은 09)를 남긴다(판정 J-152). (1) 테스트 데이터 디렉터리(`/srv/volumes/helm/{test-scratch,perf,e2e,systest,test-reports,eval}`)를 저장 위치 표와 백업 제외 목록(홈랩 H-3)에. (2) 종료 지점·고장 주입 훅이 운영 데이터 경로에서 켜지지 않는 검사. (3) §6.2의 "CI에서는 건너뜀"을 "`daemon-systest`에서만"으로. (4) 22/SY-01·SY-02를 `ops/test/`에. (5) 비특권 tmpfs 방식 확인(FI-16(b)). (6) 복원 뒤 부팅을 안전 모드(사유 `restored`)로 시작하고 미소진 승인을 `approval.expired`(사유 `restored`)로 닫는다(FI-26). (7) 9·12단계 결정적 실패를 읽기 전용 시작(사유 `recovery_failed`)으로, 비정상 종료 기록을 크래시 루프 계산에(FI-27). (8) 복원 때 위험 이벤트를 격리한 현재 DB에서 넘기는 파일과 단계(09 (5)와 공동) |
| 18 | (1) 비밀 카나리아를 통합 시험 공통 검사로 받아들일지. (2) 격리 시험을 S1·S1b 각각. (3) T18-25는 `test-slow`. (4) T18-22를 "재투영 뒤에도 폐기·철회 유지"로 넓히고, 가린 비밀이 백업·restic에 남는 사실과 사람 할 일을 §3.16에. (5) 판정 J-135(TTY 확인 없는 `localAdmin` 사람 결정 거부)에 시험 ID를 붙인다(22 §3.11.1이 배치). (6) `.git/config`·`.git/info/attributes`·`.git/hooks/**` 읽기 전용 덧씌움과 사용자 셸 쪽 한계·사람 할 일을 적는다(V4-001, 22 SG-05·SG-06) |
| 19 | (1) §6.3 (4)의 "CI에서 sshd를 띄울 수 있을 때"를 "`just test-conformance-ssh`"로. (2) §3.9.2에 "지문은 연결·경로·attempt와 무관"을 적고, 다른 연결·리스너 재전송 적합성 시험을 CT로 더한다(FI-25). (3) CT-08에 "재전송이 `2001`보다 먼저 나가지 않음", `hello`의 `storeId`가 다르면 재전송 전 캐시 비우기, `PendingCommand`에 보낼 때의 `storeId`·`deviceId`(FI-29·FI-30). (4) CT-24의 1판 이름(`content.ref_not_found`)을 10 코드로. (5) §6.4 성능 기준은 22/PF-02~04로 실행한다 |
| 20 | (1) "Windows(CI)" 셸 스모크를 "`app-build-win-ci` 수동 워크플로 안"으로. (2) `test/fixtures/views/*.json`은 뷰가 생기기 전에는 손 고정 데이터, 뒤에는 `just test-fixtures-views` 표본. (3) `PendingRow`에 `storeId`·`deviceId`, 다르면 자동 재전송 제외(19 (3)과 공동). |
| 21 | (1) 시각 기준 이미지 보관을 §3.12.2(Git 밖 + 잠금 파일)로. (2) `ui-visual`은 verify 밖(§6.4 끝 문장에 대한 답). (3) 접근성 기준 "A·AA 태그 위반 0, 영향도 무관". (4) 유리 시험용 배경 이미지와 woff2의 바이너리 처리. (5) 프레임 시간 측정은 `just perf`(PF-14). (6) 토큰 전체와 상태 → 토큰 대응표를 §3.2.8에 두면 대비 관문(TK-09)이 대응표를 입력으로 돈다. (7) 부품 9개의 WBS 배정은 23과 정한다 |
| 23 | (1) M0-12에서 §3.19 색인 전체를 WBS ID와 함께 옮기고 `tests/trace/done.ts`로 판정한다(§3.17.1). (2) M3-10은 커널 단독 대본만, `kernel` 모드는 엔진 통합(M4-05) 뒤, `view`·`protocol` 대본은 뷰·리스너 행 뒤, 뷰 표본 생성은 뷰 행(M12)으로(§3.8.2 선행 조건 표). (3) 하네스 전제 API(§6 아래 표)를 만드는 WBS 행. (4) `_verify-steps` 단계는 그 단계를 만드는 행이 끝날 때 더하고, 필요한 사람 작업(HT-06 cargo, HT-24 Playwright)을 그 행보다 앞에. (5) `bench` 레시피를 M2-10에서 도입하고 저장소 기준을 PF-01·PF-09로(M2-10·SP-03의 p99 100 ms를 바꾼다). (6) MVP 판정은 "`stage: mvp` 누락 0, 격리 0"과 끝난 WBS 집합으로. 스파이크 표에 "MVP 판정 영향" 열(SP-04 → 격리 판정, SP-10 → 경로 ① 판정, §3.17.3). (7) 마일스톤 관문 `just test-all`, G0 관문, 사람 작업(bwrap, 시험용 SSH 키, Playwright). (8) 편집 방식 A/B 스파이크(판정 J-190 (7))의 결과를 22/EV-04에 기록한다 |
| 25 | §5.1의 용어. "제공자"(판정 J-150)는 이미 따랐다 |
| 26 | (1) 가짜 푸시 서비스의 허용 호스트를 테스트 설정으로만 넓히는 방식 확인. (2) 모바일 시각 기준 뷰포트(iPhone 15 외 iPad 가로·세로) |

## 6. 구현 단위와 완료 기준

| 단위 | 위치 | 완료 기준(테스트로 확인) |
|---|---|---|
| U22-1 testkit | `packages/testkit/src/` | 22/KIT-01~08 통과. `domain` 밖을 import하지 않음(06 R1) |
| U22-2 모델 테이프 | `packages/ai/src/testing/` | (1) 손 테이프 하나로 `runAgentLoop`가 도구 호출 두 번 + 종료 메시지를 받는다. (2) 대기열이 비면 테스트가 실패한다(TE-01). (3) `context-hash` 불일치 시 실패와 차이 출력. (4) `api`가 `"faux:helm"`(07 C17). (5) `stall`이 가짜 시계 진행으로 시간 초과를 낸다. (6) `recordingGateway`가 만든 파일을 `tapeGateway`로 재생하면 같은 이벤트 열(strict) |
| U22-3 테스트 공통 준비 | `vitest.config.ts`, `tests/setup/*.ts` | 22/ST-05~07 통과. 공통 준비가 `HOME`·`XDG_*`·`TMPDIR`를 바꾸고 모델 키를 지움을 시험으로 확인 |
| U22-4 하네스 | `tests/harness/` | (1) `F-base` 픽스처가 명령만으로 만들어진다. (2) 빈 대본이 세 모드에서 통과. (3) UC-07/basic이 `runtime` 모드로 통과하고 두 번 실행 결과가 strict 동일. (4) 같은 대본의 `kernel`·`runtime` 결과가 semantic 동일. (5) 기대 실패 시 메시지에 단계 번호·AC·이벤트 차이가 있다(일부러 틀린 기대값으로 확인) |
| U22-5 장애 공통 검사 | `tests/harness/invariants.ts` | 일부러 깬 DB(의도만 있는 호출, seq 빈칸, 투영 불일치)마다 해당 검사가 실패 |
| U22-6 종료 지점 | 12·17 코드 + `tests/faults/*.kill.test.ts` | §3.9.2 지점 전부에서 SIGKILL 뒤 공통 검사 통과. `HELM_TEST_HOOKS` 없으면 지점이 꺼져 있음 |
| U22-7 추적 검사 | `scripts/test-trace.ts`, `tests/trace/{index.ts,done.ts,manual.json,quarantine.json}` | (1) 끝난 WBS 행의 색인 ID가 테스트에 없으면 실패, (2) 테스트의 모르는 ID에 실패, (3) 끝나지 않은 행의 항목은 경고, (4) 격리 기한 지남에 실패, (5) `requires` 선행 미도달로 건너뛴 대본의 AC는 경고. 각 경우를 가짜 테스트 보고로 확인 |
| U22-8 대본 | `tests/scenarios/*.scenario.ts` | §3.8.4 MVP 대본 전부 `runtime` 모드 통과, §3.8.5의 MVP AC가 모두 대본 `ac` 또는 다른 테스트 ID에 연결(추적 검사) |
| U22-9 적합성 | `tests/conformance/` | 22/CF-01·03·04·05 `just test`에서, CF-02 `just test-conformance-ssh`에서 통과 |
| U22-10 장애 시나리오 | `tests/faults/` | 22/FI-01~20, FI-22(a)~32 통과(레시피별) |
| U22-11 비밀 카나리아 | `tests/harness/canary.ts` | 카나리아를 일부러 로그에 쓰는 가짜 코드에서 실패, 가려진 토큰은 통과 |
| U22-12 시각 기준 관리 | `packages/ui/tests/visual/`, `apps/desktop/tests/visual/`, `scripts/visual-baselines.ts` | 잠금 파일 불일치·이미지 없음에서 종료 코드 2, 갱신 레시피가 잠금 파일을 다시 쓴다 |
| U22-13 성능 | `tests/perf/` | 22/PF-01~12·14·15가 결과 JSON을 쓰고 목표 비교 |
| U22-14 레시피 | `.just/helm.just` | §3.15.3 레시피가 `just`에 보이고, 도구가 없을 때 종료 코드 2 |
| U22-15 정적 검사 | `scripts/test/static/*.test.ts`, ESLint 설정 | 22/ST-01~03·ST-08 통과, 위반 fixture에서 실패 |
| U22-16 가짜 푸시 서비스 | `tests/harness/fake-push-service.ts` | RFC 8291 복호화·VAPID 검사·응답 코드 조작이 26 T26-17과 UC-04/away-push에서 동작 |

하네스가 기대는 다른 문서의 API(만드는 23 WBS 행이 있어야 한다):

| API | 소유 문서 | 쓰는 곳 |
|---|---|---|
| `openStore`의 `clock`·`ids`·`testing{bootEpoch, storeId, allowTmpfs}`·`faultInjector` | 09 §3.16 | §3.5.1, FI-02 |
| SQLite 오류 주입, 임시 DB | 09(`@helm/store/testing`) | FI-16, FI-19 |
| `EVENT_META.semanticFields` | 09 §6.1 | §3.5.3 semantic 비교 |
| 메모리 커널 상태 + 임시 파일 저장소 엔진 | 06·09(`@helm/engine/testing`) | `kernel` 모드 |
| `whenIdle()`, 가짜 어댑터, `runAdapterConformance` | 12·13(`@helm/runtime/testing`) | §3.8.3, §3.10.2 |
| 종료 지점·고장 주입 훅 | 12(런타임), 17(데몬 부팅·운영) | §3.9.2, FI-27 |
| `ModelGateway` 주입 | 12 §3.3.2 | 테이프 재생기 |
| `FakeToolExecutor`, 도구 → 명령 대응 데이터 | 13 | `kernel` 모드, 샌드박스 없는 환경 |
| 부재 파생 함수 | 14 §3.13.8 | UC-04/away-push |
| 정상 경로 사실 계산 | 16 §3.22.3(`@helm/observer/metrics`) | `humanOps` 기대 |
| `FakeDaemon` 조작, 가짜 전송 | 19(`@helm/protocol/testing`, `@helm/client/testing`) | CF, FI-07~10·25·29·30 |

공통 완료 조건: `just verify` 통과, `just test-trace --report`에서 끝난 WBS 행 항목의 누락 0.

## 7. 미결 사항

| ID | 쟁점 | 선택지 | 추천 기본값 |
|---|---|---|---|
| Q22-01 | `@helm/tests`를 작업 공간 패키지로 둘지 | (a) 루트 `tests/` 작업 공간 패키지 (b) `packages/daemon/test/scenarios`에 넣기 (c) 별도 `packages/scenario-harness` | (a). 대본이 데몬·런타임·클라이언트를 함께 쓰므로 어느 한 패키지에 넣으면 의존 규칙이 흐려진다 |
| Q22-02 | 커널 분기 커버리지 하한 | 90% / 80% / 관문 없음 | 90%. 구현 첫 마일스톤에서 실제 값을 보고 23과 다시 정한다 |
| Q22-03 | 시각 기준 이미지 위치 | (a) 제품 폴더 `design/visual-baselines/`(Git 밖, Syncthing) (b) `/srv/volumes/helm/visual-baselines/`(동기화 안 됨) (c) Git LFS | (a). 사용자 규칙상 바이너리는 Git에 넣지 않고, Mac에서 사람이 볼 수 있다. Syncthing 충돌 사본이 생기면 잠금 해시가 달라 종료 코드 2로 끝난다 |
| Q22-04 | 야간 `test-deep` 타이머 | 켬 / 끔 | 해소: MVP 구현 중 끔, M11-12(운영 데몬 설치) 뒤 켬(23 §5.2 "22"(3)) |
| Q22-05 | `kernel` 모드를 모든 대본에 요구할지 | 전부 / 선택 | 선택. `runtime` 모드가 정본. `kernel` 모드는 빠른 변형 시험이 필요한 대본(UC-02, UC-07)에만 |
| Q22-06 | Windows 셸 스모크를 매 릴리스마다 할지 | 릴리스마다 / MVP 완료 전 1회 + 앱 셸 변경 시 | 후자. push가 필요해 사람 확인이 든다 |
| Q22-07 | 반투명 표면 렌더 대비 측정 방법 | 테두리 픽셀 평균(근사) / 텍스트를 지운 같은 장면 캡처와의 픽셀 대응 계산 / 토큰 계산만 | 토큰 계산(관문) + 텍스트를 지운 장면과의 픽셀 대응 계산(정확, 구현 비용 큼)은 21 개정판 결과를 보고 정한다. 그동안 근사 측정 |
| Q22-08 | 비특권 tmpfs로 디스크 가득 시험(FI-16 b) | 네임스페이스 tmpfs / 작은 루프 이미지(sudo) / `SQLITE_FULL` 주입만 | 네임스페이스 tmpfs가 되면 그것, 안 되면 주입만으로 두고 수동 시험 1회 |
| Q22-09 | 녹화 테이프를 Git에 넣을 범위 | 익명 고정 과제만 / 넣지 않음 | 익명 고정 과제만(`tape-promote` 검사) |
| Q22-10 | verify 시간 상한 | 5분 / 10분 | 목표 5분, 상한 10분. 넘으면 slow로 옮기기 전에 원인 조사 |
| Q22-11 | 복원·결정적 복구 실패 시험의 이벤트·사유 이름 | 09가 정할 복원 표지 이벤트 이름(판정 J-152), 12·17이 정할 사유 이름(읽기 전용 `recovery_failed`, 승인 만료 사유), 결과 보관 파일 위치 | 해소: 정본 이름을 쓴다. 복원 표지 `store.restored`(09), 안전 모드 사유 `restored`(09 `daemon.safe_mode_entered`), 읽기 전용 사유 `recovery_failed`(17). FI-26·FI-27의 기대는 이 이름을 쓴다([판정 J-152], [판정 J-164]) |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 2, 14, 15, 17, 18, 22, 23, 27~30, 34, 37, 38, 40~46, 53~56, §2.5, §3, §5.
- 조정자 판정: `docs/design/process/rulings-stage2a.md` §1(이름 정본), §2(패키지·포트), J-01, J-02, J-07, J-25, J-28, J-31, J-33, J-34, J-39, J-40, J-130, J-149, J-152, J-153, J-164, J-165, J-169, J-170, J-188~J-190.
- 4c 조사(판정 J-190의 근거): `.helm-design-work/coordinator/stage4c/research-browser.md` §6·§8, `research-ohmypi.md` §3·§6.
- 설계 문서(2026-10-12 판): 01 §3.5.2, §3.8, §3.11, §6 / 02 §2.7, §3.1, §3.4~§3.22 수용 기준, §3.23, §3.24, §6 / 03 §6 / 04 §6 / 05 §6 / 06 §3.3, §3.4.14, §3.5, §3.12, §3.13.6, §3.15, §3.16, §4 F13·F16, §6, §7 O-11 / 07 §3.10, §3.19, §6 / 08 §6 / 09 §3.8.4, §3.15.2, §6 / 10 §3.8, §3.15, §3.16, §3.17, §6 / 11 §6 / 12 §3.3, §6(CR-1~CR-4는 §3.7) / 13 §3.6.1, §3.11.7, §6 / 14 §6 / 15 §3.15, §6 / 16 §6 / 17 §3.14, §6.2 / 18 §3.11, §3.17 / 19 §6 / 20 §3.12.2, §3.13, §3.14, §6 / 21 §3.2.5, §6.1, §6.3, §6.4, §6.6(2a 개정판) / 26 §2.4, §3.6.2, §6. 시작 때(12:42 무렵)와 끝낼 때(13:14 무렵) 두 번 §5·§6을 대조했다.
- 원천: `docs/design/process/sources/helm-canon-2.md` §1.23, §1.25, §3.16, §7.2, §7.3, §9.6, §9.9, §9.14(57개), 체크리스트 "22 테스트 전략" / `conversation-extracts-3.md` X3-4-11, X3-8-24~27, X3-10-03~05 / `pi-api-facts-1.md` §2.10(faux 제공자 [원문 `ai/src/providers/faux.ts:54-146, 455, 532, 704`]).
- 실험 자료(이 문서가 다시 실행하지 않음): `experiments/helm-toy/helm.mjs`(대화 발췌 3 X3-10-03에 [실험] 기록), `experiments/helm-kernel-v02/test/*.mjs`(canon-2 §9.14 [실험: 57 pass]), `.helm-design-work/P4/fork-proto/test/`(07 §3.19 [실험: 173 pass]).
- 도구 사실: Vitest·Playwright·Storybook·WebdriverIO 판은 06 §3.12.1, 20 §3.13, 21 §6.5의 표기를 따른다. fast-check 판과 Playwright `emulateMedia`의 `contrast`·`reducedTransparency` 지원은 [지식]이며 구현 때 확인한다.

## ADR 후보

### ADR-22-1 테스트 제목에 문서 번호를 붙인 추적 ID를 쓰고 추적 완결성을 `just verify`에서 검사한다

- 맥락: 설계 문서 22개가 각자 테스트 ID 체계를 가지며 일부는 겹친다(12·13 `T-SC`, 07 `C1`·14 `C-1`, 02·13 `AC`). 브리프 §1은 모듈마다 완료 기준을 테스트로 확인하라고 한다.
- 결정: 추적 ID `<문서>/<ID>`를 테스트 제목 맨 앞에 두고, `just test-trace`가 색인과 대조한다. 마일스톤 전 항목은 경고만 한다.
- 대안: (a) 문서마다 ID를 고유하게 다시 붙이기 — 다른 문서 개정이 필요하고 이미 쓴 참조가 깨진다. (b) 추적표를 문서로만 유지 — 테스트가 빠져도 알 수 없다.
- 결과: 색인과 테스트를 같은 커밋에서 고쳐야 한다. 테스트 이름이 길어진다.

### ADR-22-2 가짜 모델은 `helm.model-tape.v1` 테이프 하나로 통일한다

- 맥락: 12는 faux 대본, 15는 녹화 응답 재생(E1), 02는 대본의 `model` 단계, 13은 어댑터별 녹화 응답을 요구한다.
- 결정: `@helm/ai/testing`의 테이프 형식과 재생기 하나. 손 테이프는 역할별 대기열, 녹화 테이프는 투영 해시 대조. pi-ai faux 제공자(`fauxProvider`) 위에 만들고 `api`를 고정한다.
- 대안: 대본마다 `sequenceProvider`(원전 helm-kernel-v02)처럼 함수로 응답 열을 주기 — 녹화·재생과 형식이 달라진다.
- 결과: 투영 규칙을 바꾸면 녹화 테이프를 다시 녹화해야 한다.

### ADR-22-3 유즈케이스 대본은 `runtime` 모드를 정본으로 하고 세 모드를 지원한다

- 맥락: 커널만 시험하면 훅 순서·싱크 커밋 같은 런타임 결함을 놓치고, 프로토콜까지 매번 거치면 느리다.
- 결정: MVP 대본은 `runtime` 모드로 verify에서 돈다. `kernel` 모드는 선택, `protocol` 모드는 접속·재전송·기기 관련 대본에만.
- 결과: 세 모드 결과의 semantic 동일성이 하네스와 계약의 회귀 시험이 된다.

### ADR-22-4 시각 기준 이미지는 Git 밖에 두고 해시 잠금 파일만 커밋한다

- 맥락: 사용자 규칙 "바이너리는 Git에 넣지 않는다", 21의 서버 기준 이미지 요구.
- 결정: 제품 폴더 `design/visual-baselines/`에 이미지, 저장소에 sha256 잠금 파일. 불일치는 환경 문제(종료 코드 2).
- 대안: Git LFS(규칙 위반에 가깝고 원격 저장 필요), 매번 기준 커밋을 다시 렌더(승인된 기준이 없음).
- 결과: 새 기계에서 시각 회귀를 돌리려면 제품 폴더 동기화가 필요하다. 테스트는 서버에서만 돌므로 문제가 작다.

### ADR-22-5 호스팅 CI에서 테스트를 돌리지 않는다

- 맥락: 06 O-11(비밀·SOPS 키가 서버에만), 1인 프로젝트, push는 사용자 확인 뒤.
- 결정: `just verify`·`just test-all`은 서버에서. 예외는 Windows 셸 스모크(수동 워크플로).
- 결과: 테스트 결과 기록은 `/srv/volumes/helm/test-reports/`와 `.just/.last-verify`. 다른 사람이 볼 수 있는 CI 배지는 없다.
