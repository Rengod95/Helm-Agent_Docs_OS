# c04-settings-rows 시나리오

P-09 설정에 더하는 행입니다(p09-settings 모양, 공용 틀 `_settings`). "플러그인과 그룹" 탭: 프레임 행과 "묻지 않기" 목록, 계측, 개발 모드, 확장 설정의 settings slot. "외관" 탭: 표시 언어. `?state=`, `?scenario=<id>&step=<n>&hold=1`, `?dev=1`.

## 시나리오

| id | 누르는 것 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `settings-frames` | ① "자체 코드 화면 허용" 끄기 → ② 목록 한 줄 "다시 묻기" | ① "저장됨", 도움말이 "자체 코드 화면 2개를 기본 부품 화면이나 자리표시로 보여요", 프로젝트 행 잠김 ② 줄이 빠지고 토스트 "다시 물어요 · Helm이 …" | spec §12.1 27번, ADR-0021 §3.5·§6 9번, 계획에 없음 13 |
| `settings-frames-fail` | "이 프로젝트 확장의 자체 코드 화면" 켜기 | 저장 중 스피너 → 꺼짐으로 돌아가고 필드 오류 "관리 정책이 이 값을 막았어요 · 3102" | ADR-0021 §3.5(allowedScopes managed·user) |
| `trace-off` | "계측" 끄기 → 토스트 "테스트 실행 보기" | 도움말 "꺼져 있어요. 테스트 실행·구성기의 턴 다시 보기가 잠겨요", 남길 턴 수 잠김, 토스트 → c01 `?state=trace-off`(잠긴 막대) | 결정 캔버스 5, X-15, Y4 |
| `trace-off-fail` | "계측" 끄기 | 저장 중 → 켜짐으로 돌아가고 필드 오류 "저장하지 못했어요 · 엔진에 연결되지 않아…" | §6.21(쓰기 실패 문장) |
| `locale-switch` | "외관" 탭 → 표시 언어 English | 저장 중 → 행 배지 "다시 시작하면 적용"(warning, DP-36), 도움말 "화면 글은 바로 바뀌어요. 앱 메뉴·트레이·OS 알림은 다시 시작하면", "지금 다시 시작" | Y15, T-I18N, L4.desktop §18 |
| `locale-auto-fallback` | 표시 언어 "자동(OS 언어)" | OS 언어 ja-JP가 지원 밖이라 "English로 보여요" 도움말 | ADR-0016 1번(지원 밖이면 en) |

스크린숏 순간: `sc-frames-1`, `sc-frames-2`, `sc-framesfail-2`, `sc-trace-1`, `sc-tracefail-2`, `sc-locale-3`, `sc-localeauto-3`.

## ?state= 목록

| id | 모습 |
|---|---|
| `plugins`(기본) | 플러그인 화면 구역(프레임 두 행 + 묻지 않기 목록 3) |
| `frames-off` · `frames-fail` | 프레임 끔, 프로젝트 프레임 허용 거부 |
| `trace` · `trace-off` · `trace-fail` | 계측 행, 끔(토스트), 저장 거부 |
| `dev` | 개발 모드 켬: 저장소 경로 입력, "테스트 도구 3개를 찾았어요 · 상태 표시줄에 개발 모드 칸" |
| `web` | 웹: 개발 모드 행이 "원격 컴퓨터" 배지, 읽기 전용 |
| `slot` | Helm 확장 설정 + Helm이 그린 읽기 전용 부분(N-25) |
| `locale` · `locale-en` · `locale-auto` | 외관 탭 언어 행 세 모습 |
| `narrow` | 390px: 탭 열 대신 머리 Select(DP-37) |

"묻지 않기 목록"(계획에 없음 13)은 spec에 없던 제안 화면입니다.
