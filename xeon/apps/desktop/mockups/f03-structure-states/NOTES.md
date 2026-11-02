# f03 구조 화면 상태 (P-16)

지도 보기와 목록 + 캔버스 나눔 보기는 사용자 결정으로 없습니다. 층 × 단계 표 하나가 놓이는 화면에서 빠져 있던 여섯 상태만 그립니다.
redesign의 화면 구성과 내용을 옛 언어(옛 팔레트·글자 크기·그림자, caustic 기본 변형)로 옮겼습니다. 표는 `_shell`의 선 격자(`LineGrid`)에 바깥 틀(`LineGridFrame`)을 두고, 레일은 쓰지 않고 크래프트 폭(`WB_WIDTH`) 열에 놓습니다.

## 상태
- 읽는 중: 머리 칸은 그대로 두고 칸마다 글자 자리(Skeleton). 빗금은 "해당 없음"이라 아직 쓰지 않습니다.
- 오프라인: "14:03 기준", warning Alert 하나 + "다시 연결", 칸 글자 흐림, 쓰기 잠금. 읽은 적이 없으면 읽는 중 모양 + 같은 Alert로 둡니다.
- 빈: 내장 L0·L1·L2만 있는 설치. 그룹·확장 런타임 행이 빗금이고 표 아래 EmptyState "플러그인 그룹을 만들어 보세요". Helm·학습도 내장이지만 끈 경우로 그렸습니다.
- 안전 모드: 빗금과 머리 칸 "빠짐", 표 아래 층별로 빠진 이름(`SafeOut`, 행 사이는 얇은 실선).
- 좁은 폭(700 이하): 일곱 열이 들어가지 않아 행과 열을 바꿉니다(행 = 단계, 열 = 층). 가로 스크롤이 없고 턴 흐름 순서로 읽습니다. 머리에 "읽기 전용", 더하기 없음.
- 웹: 브라우저 틀(`parts/web.tsx`), 대상 칸 "웹 클라이언트 · build-box", 엔진 칸 없음. 플러그인 구역 동작은 "경로 복사"뿐이고 층 더하기도 없습니다.

## 가져다 쓴 것
- `../wb-v3/data`는 읽기만 합니다(`PLUGINS`·`STAGES`·`HOOKS`·`relationsOf`·`layerName` 등). wb-v3가 이 이름을 바꾸면 이 폴더도 맞춰야 합니다.
- `wb-v3/screens/layer-table`의 `TABLE_LAYERS`·`ROW_HEAD`는 `parts/grid.tsx`에 같은 값으로 옮겼습니다(wb-v3 store에 묶인 표는 가져오지 않음).
- 안전 모드 문장 `SAFE_OFF`는 d02 `life.tsx`의 것을, 브라우저 틀은 e05 `parts/web.tsx`의 `BrowserFrame`을 옮겼습니다.
- wb-v3 `HOOKS`에 내장 L0·L1·L2가 없어 `BUILTIN_PLACES`를 더했습니다(redesign과 같음). 그래서 평상 표가 wb-v3보다 찹니다.

## 빈틈
- `Alert`·상태 칸의 설명은 `_shell`이 요구하는 필수 `description`으로 채웠습니다(연결 끊김·대상 칸).
- 행 제목(`text-title-3`)은 옛 caustic에서 600이라 머리 글과 같은 무게로 보입니다(`_shell/line-grid.tsx`의 머리 글과 같은 원인).
- 옛 언어에 점선 구분선이 없어 행은 얇은 실선(`border-border-subtle`)으로 나눕니다.
- `T.structure`는 "구조"입니다(개요 내비 이름).
