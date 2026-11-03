// 시안 목록. 새 페이지 목업을 만들면 여기에 한 줄 더한다(folder = mockups/ 아래 폴더 이름).
export interface MockPage {
  /** 스펙 화면 id(P-02 등) */
  id: string;
  title: string;
  folder: string;
  /** ?state= 로 고를 수 있는 상태 수 */
  states: number;
}

export const pages: MockPage[] = [
  { id: "P-02", title: "대화", folder: "p02-opus", states: 7 },
  {
    id: "W1–W5",
    title: "크래프트 1차(개요, 확장, 확장 상세, Helm 탐구, 런타임 탭)",
    folder: "wb-opus",
    states: 11,
  },
  {
    id: "P-19~P-22",
    title: "크래프트 2차: 테스트 실행, 측정과 평가, 구성, 만들기 (W6–W9)",
    folder: "wb2-opus",
    states: 14,
  },
  { id: "P-09", title: "설정", folder: "p09-settings", states: 9 },
  {
    id: "P-10",
    title: "시크릿 (O-05 재인증, O-06 삭제 확인 포함)",
    folder: "p10-secrets",
    states: 9,
  },
  { id: "P-11", title: "계정과 제공자·예산", folder: "p11-accounts", states: 7 },
  { id: "P-12", title: "도구와 웹", folder: "p12-tools-web", states: 5 },
  { id: "P-13", title: "플러그인과 그룹", folder: "p13-plugins", states: 7 },
  { id: "P-03", title: "받은 요청", folder: "p03-inbox", states: 9 },
  { id: "P-04", title: "변경 검토", folder: "p04-review", states: 8 },
  { id: "P-06", title: "제안", folder: "p06-proposals", states: 9 },
  {
    id: "O-02·03·04",
    title: "셸 명령 확인 · 명령 결과 · 신뢰 카드",
    folder: "o02-o04-chat",
    states: 4,
  },
  { id: "P-05", title: "탐구(Helm)", folder: "p05-helm", states: 12 },
  { id: "P-07", title: "예약 · O-08 예약 편집", folder: "p07-schedules", states: 11 },
  { id: "P-08", title: "연결", folder: "p08-connection", states: 7 },
  { id: "P-14", title: "목표와 작업", folder: "p14-work", states: 7 },
  { id: "P-01", title: "첫 실행", folder: "p01-first-run", states: 10 },
  { id: "P-15", title: "진단과 정보", folder: "p15-diagnostics", states: 6 },
  { id: "O-07", title: "새 대화", folder: "o07-new-thread", states: 5 },
  { id: "O-09", title: "바로 가기 키 도움말", folder: "o09-shortcuts", states: 4 },
  { id: "S-04", title: "토스트", folder: "s04-toast", states: 5 },
  // 묶음 A(대화 영역 런타임, m4/pg-a)
  {
    id: "S-01·N-01·N-04",
    title: "셸 내비 · 보기 기준 칸 · 테스트 표지와 정리",
    folder: "a00-nav-context",
    states: 14,
  },
  { id: "N-02·N-03", title: "테스트 대화(머리, 멈춤 띠)", folder: "a01-trial-chat", states: 10 },
  {
    id: "N-05~N-07·P-05",
    title: "사람 확인 · 승인 출처 · 만료 · 주도 충돌",
    folder: "a02-human-gate",
    states: 14,
  },
  {
    id: "N-08~N-13",
    title: "대화에서 제작(확인 다섯, 결과 카드, 제작 화면)",
    folder: "a03-authoring",
    states: 21,
  },
  { id: "N-14", title: "대화 영역 둘러보기", folder: "a04-chat-tour", states: 9 },
  // 묶음 B(플러그인 화면과 신뢰)
  {
    id: "B01 · P-18",
    title: "플러그인 화면 호스트: 자체 코드 화면, 막힘, 남은 상태",
    folder: "b01-plugin-frame",
    states: 22,
  },
  {
    id: "B02",
    title: "대화 영역 플러그인 기여: 옆 패널, 카드, 상태 칸, 명령",
    folder: "b02-plugin-slots",
    states: 9,
  },
  {
    id: "B03 · O-10",
    title: "확장 가져오기, 신뢰 확인, 다시 확인, 지우기",
    folder: "b03-ext-trust",
    states: 13,
  },
  // 묶음 C(크래프트 테스트·버전·설정, m4/pg-c)
  {
    id: "P-19·O-12·N-30",
    title: "테스트 실행 다시 그리기 · 새 테스트 · 개발 모드",
    folder: "c01-trials",
    states: 18,
  },
  {
    id: "P-17·O-11·N-31~N-34·N-36",
    title: "확장 상세: 버전·되돌리기·설정 값 출처·화면·기록·X 훅",
    folder: "c02-ext-detail",
    states: 18,
  },
  {
    id: "P-13·N-35·N-36",
    title: "확장 목록: 켜는 범위·대기·X 훅",
    folder: "c03-ext-list",
    states: 12,
  },
  {
    id: "P-09·N-25·N-27~N-30",
    title: "설정 보탬: 프레임·묻지 않기·계측·언어·개발 모드",
    folder: "c04-settings-rows",
    states: 13,
  },
  // 묶음 D(대화 영역 빈칸과 셸 수명, m4/pg-d)
  {
    id: "N-42~N-46·O-06",
    title: "대화 영역 빈칸(실패·이어서 실행·승인 카드 넷·행 메뉴·목록·내보내기)",
    folder: "d01-chat-gaps",
    states: 26,
  },
  {
    id: "N-51~N-56·N-58·S-04",
    title: "셸 수명(엔진 실패·안전 모드·업데이트·진행 중·토스트·OS 알림·메뉴 막대)",
    folder: "d02-shell-life",
    states: 29,
  },
  {
    id: "P-04~P-15 빈 상태",
    title: "기존 페이지 빠진 상태(?page=p04…p15, 데이터 지우기)",
    folder: "d03-page-states",
    states: 37,
  },
  // 묶음 E(가로 품질, m4/pg-e)
  {
    id: "N-49·N-50",
    title: "화면 언어(영어 ?lang=en)와 접근성",
    folder: "e01-locale-a11y",
    states: 13,
  },
  { id: "O-09", title: "바로 가기 키 · 키 바꾸기 · 웹 키 표", folder: "e02-shortcuts", states: 11 },
  {
    id: "N-57",
    title: "프로필 관리(baseRev 충돌, profile.changed)",
    folder: "e03-profiles",
    states: 12,
  },
  {
    id: "N-47·N-48",
    title: "크래프트 여섯 상태 빈칸과 찾기·거르기 결과 없음",
    folder: "e04-workbench-states",
    states: 17,
  },
  {
    id: "N-59·N-60",
    title: "웹 연결 · 좁은 폭(390·700) · 원격 대상 크래프트",
    folder: "e05-web-narrow",
    states: 22,
  },
  {
    id: "P-16 캔버스",
    title: "런타임 캔버스: 층 띠·블록·연결, 맥락 분리, 트레이스, 검사기",
    folder: "wb-canvas",
    states: 13,
  },
  {
    id: "P-21·P-22",
    title: "블록 구성기: 그룹 쌓기, 흐름, 프로필 쌓기, 테스트, 코드",
    folder: "wb-compose",
    states: 8,
  },
  {
    id: "캔버스 v2 · B",
    title:
      "정교한 노드 편집기: 나눔 지도, 그룹 하위 캔버스, 구성(놓기·연결), 단계 머신·테스트, 층 × 훅 열지도, 맥락 차이",
    folder: "wb-v2b",
    states: 14,
  },
  {
    id: "P-16·P-21 v2 A",
    title:
      "런타임 지도·구성기 v2 A: 층 건물·루프 소켓, 줌 3단계, 구조 살펴보기, 맥락 테두리, 층×훅 표, Helm 부품·흐름·테스트·프로필",
    folder: "wb-v2a",
    states: 13,
  },
  {
    id: "캔버스 v3",
    title:
      "크래프트 캔버스 v3: 턴 흐름 그림, 층마다 내장·내 것·더하기, 관계 렌즈 포커스, 플러그인 상세(블록·흐름), 보기 기준·프로필, 층×훅 표",
    folder: "wb-v3",
    states: 12,
  },
  // 묶음 F(구성기 진입·테스트, 개요 상태, 프로필 적용). 상태 수는 redesign 사본의 STATES 개수.
  { id: "F1", title: "구성기 진입", folder: "f01-compose-entry", states: 13 },
  { id: "F2", title: "구성기 흐름 테스트", folder: "f02-compose-trial", states: 6 },
  { id: "F3", title: "개요 화면 상태", folder: "f03-structure-states", states: 6 },
  { id: "F4", title: "프로필 적용", folder: "f04-preset-apply", states: 5 },
  {
    id: "일러스트",
    title: "런타임 일러스트 세트: X 수명 고리, 층 쌓기, 개념 그림 8, 빈 상태 3 (밝음·어두움)",
    folder: "_art-preview",
    states: 1,
  },
];
