# pack 작성 중 발견한 설계 어긋남 (메인 마지막 검토 대상)

## 02 (아키텍처)
- 의존 규칙 개수: 06 §3.5.1 R1~R16, 24 ADR-06-04 R1~R13, 06 §6 S2·22 check-arch R1~R14
- CONNECT 프록시 소유: 06 §3.4.9 tools/src/sandbox/proxy.ts, 17 §3.1.2 데몬 helm-egress-proxy, 18 §3.11.9 둘 다
- 쓰기 트랜잭션 시간: 06 §3.6.5 p99 10 ms, 06 F13 경고 100 ms, 17 §3.1.2 규칙 50 ms
- 06 §3.4.2 SubmitResult vs §3.4.5 CommitResult
- 25 N-01 Via listener 값 낡음(tailscale|ssh|local → tailnet|loopback|local)
- ADR-00-32 제목 React 18(대체됨 표시 확인)

## 03 (한 작업의 일생, UC-03)
- F1: 14 §3.17은 예약 정보 질문도 휴대폰 notice 푸시, 26 §3.4.3·11 urgencyOf는 푸시 없음
- F2: 02 UC-03 단계 7은 권리 질문을 복귀 요약으로 예약만, 26 planPush는 푸시 가능 휴대폰이 있으면 interrupt 푸시
- F3: 02 단계 8 정보 질문 승격 때 휴대폰 notice 여부 누락
- F4: 02 단계 4 표에 run.queued·run.started·이전 run.end(handed_off) 누락

## 07 (런타임)
- 08 종결 목록의 interrupted vs 09 run.ended.reason에 interrupted 없음
- toolcall.interrupted.cause 값과 run.interrupted.code 값 차이
- 07 A3 요구 라벨(F-1/F8) 차이

## 08 (도구)
- 13 toolcall.intend/complete/skip vs 09 정본 toolcall.requested·started·completed·not_executed{reason}
- 웹 응답 허용 미디어 타입: 13(HTML·텍스트·JSON) vs 18 §3.11.8(XML·PDF 추가); 22 WB-03 긴 질의 기준 256자 잔존
- 홈 디렉터리: 13 §3.6.2 작업 공간별 영속 홈 vs 18 R-2 실행별 임시 홈
- 격리 자가 시험: 13 §3.6.8 7행 vs 13 U-TL-14·18 T18-08 "여섯 시험"
- 13 §3.2.2 도구 묶음 식에 grep·find 샌드박스 조건 없음 vs §3.6.1 샌드박스 없으면 뺌
- 허용 플래그: 08·13 allowUnknownTargets vs 18 R-10 allowUnscopedExecute
- 내부망 차단 대역 0.0.0.0/8이 18에만
- ActionDescriptor 08에 없음; PrimitiveAction(13·14) vs Primitive(08 정본)
- TruncationInfo 정의 없음
- pre_read_exposed가 08 enforcement enum에 없음
- 19 오류 목록에 web.*, stale_snapshot, browser.stale_ref 없음(13 §5.2 요구)

## 06 (묻기)
- D-8(VoI≥9 immediate)이 D-9(부재 시 예약)보다 앞: 부재 중 점수 9 정보 질문 처리 문장 없음
- 11 §3.6.3 "가까워짐" 승격을 끼어들기로 서술 vs urgencyOf·26은 막지 않는 정보 질문 승격을 notice
- notifications.dndException 위치: 11 §3.16 vs 14 §3.13.2(20 정본) vs 20 설정 표
- attention.snoozeUntil: 11 "데몬 설정 아님" vs 14 OrchestrationSettings 안
- 09 §10.3 2a 기록에 옛 PresenceState 값 locked 잔존(기록 절이라 낮음)

## 12 (데몬 운영)
- helmd.owner.json: J-247 크래시 루프 계산에만 vs 17 §3.10.3 lastFailure 기록
- daemon.safe_mode_entered: 09 카탈로그 "크래시 루프 전용" vs reason 열거형·복원 흐름 restored 사용
- drill.completed·backup.failed: 17 필드명 vs 09 payload
- 시작 단계 번호: 17 0~16, 09 1~13, 12 "0~11", 22 "복구 11단계"

## 학습 글 리뷰에서 나온 것 (사용자 점검 회의 대상)
- [제품 동작] 결과 제출 뒤 도착한 send 승인: 02 UC-03 단계 11·AC-03-09·12 §3.13.2는 같은 toolCallId로 실행, 10 §3.11.8·14 §3.12.3·F32는 실행하지 않고 not_executed(awaitingApprovalCalls). 정본 10을 따르면 UC-03의 CI 확인 흐름이 바뀜 → 사용자 결정 필요
- 02 UC-07 E2 "근거 id 부재 → 확인 못함" vs 08 §3.12 규칙 2·10 R-17 "지어낸 관찰 id는 거부(invalid.evidence_not_found), 서술뿐인 met만 unverified"
- implementation-readiness.md A-3: 해시라인을 "줄마다 해시 표식"으로 설명함. 13 §3.3.7은 파일(스냅숏)당 태그 `[PATH#TAG]` + 줄 번호 연산. 점검표 문장 수정 필요(사용자에게도 같은 설명을 했으므로 정정)
- 보호 경로 읽기: 18 §3.11.6 질문(ask) vs 13 일부 거부 서술 / 샌드박스 HOME, systemctl(전체 vs --user), 명령 문자열 검사 역할 차이(08 리뷰 1절 끝)

## 13 (보안 모델) 학습 글 수정에서 나온 것
- 인증 실패 지연 상한과 `1011`: 18 §3.14는 차단 대신 지연(1분 5회 초과 시 실패 응답마다 2초씩, 최대 30초)을 상한으로 쓰고 `1011`을 말하지 않음. 19 §3.4.5(614행, 711행)는 상한 1분 5회(60초)·10분 20회(10분)에 이르면 `1011 rateLimited` + `retryAfterMs`. 일치하는 점: 맞는 토큰의 연결은 실패 지연과 무관하게 통과, `X-Forwarded-For`만으로 막지 않음
- 18 §3.4.3 검사 순서: 산문은 Host → Origin → 신원 → 자격, 같은 절의 `preflight` 의사 코드는 `tailnet`에서 Host 403 → 신원(`tailscaleIngress`) 401 → 경로별 Origin. 응답 코드(403 대 401)가 갈리는 지점이라 시험이 한쪽을 기대하면 충돌
