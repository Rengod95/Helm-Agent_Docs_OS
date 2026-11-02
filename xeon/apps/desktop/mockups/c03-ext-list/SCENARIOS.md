# c03-ext-list 시나리오

P-13 확장 목록의 켜는 범위와 대기(N-35), X 훅 행(N-36)입니다. 보기 기준 기본값은 대화 "캐시 무효화 조사"(따라감)입니다. `?state=`, `?scenario=<id>&step=<n>&hold=1`, `?dev=1`.

## 시나리오

| id | 누르는 것 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `enable-scope` | ① Acme 노트 스위치 → ② "이 대화만" 고르고 "켜기" → (기다림) | ① 행이 올린 면, 팝오버 "켜는 범위"(이 대화만 · 이 프로젝트 · 사용자 전체, 각 저장 위치) ② 상태 "이번 단계가 끝나면 적용"(info 점), 스위치 잠김 → 단계 사이에서 "켜짐 · 이 대화만", 토스트 | spec §6.23(scope "session"), §6.21, SC-18 |
| `enable-capwait` | provider-oauth 스위치 → "켜기" | 상태 "필요한 기능 기다림 `secrets.oauth`", 표 위 danger Alert, warning 토스트 | X.loading-trust §4.8(requires 미충족) |
| `enable-managed` | 제작(authoring)의 잠긴 스위치 | 이유 툴팁 "관리 정책으로 꺼져 있어요… /etc/fresnel/managed.json" | §6.23(managed 위치 잠김) |

스크린숏 순간: `sc-enable-1`(범위 팝오버), `sc-enable-3`(대기), `sc-enable-4`(적용), `sc-capwait-1`, `sc-capwait-2`, `sc-managed-1`.

## ?state= 목록

| id | 모습 |
|---|---|
| `list`(기본) | 층 묶음(L3 그룹, L2 기능, plugin, L1·L0, X 훅). 행: 이름 + id, 층, 종류, 연산, 상태, 켜기 |
| `scope-pick` · `pending` · `applied` | 범위 고르기, 대기, 적용 |
| `capwait` · `managed` | 실패 갈래 둘 |
| `all` | 보기 기준 전체: 범위에 "이 대화만"이 없음 |
| `profile` | 보기 기준 프로필: 머리 띠 "프로필 고치기 · 탐구 중심", 스위치가 프로필을 고침, 적용했다면의 모습과 "프로필이 바꿈" 표지 |
| `trial` | 보기 기준 테스트: 머리 띠 "이 테스트에만", 스위치가 session 범위 |
| `hooks` | X 훅 묶음(hooks.list): 훅 이벤트 · p50, 실패 |
| `safe` | 안전 모드: 사용자·프로젝트 확장과 X 훅이 "안전 모드라 빠짐"(결정 12), 내장만 켜짐 |
| `narrow` | 390px: 이름 · 상태 · 켜기 세 열 |
