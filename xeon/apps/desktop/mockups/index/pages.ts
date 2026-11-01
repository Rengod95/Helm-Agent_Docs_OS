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
    title: "작업대 1차(개요, 확장, 확장 상세, Helm 탐구, 런타임 탭)",
    folder: "wb-opus",
    states: 11,
  },
  {
    id: "P-19~P-22",
    title: "작업대 2차: 시험 실행, 측정과 평가, 구성, 만들기 (W6–W9)",
    folder: "wb2-opus",
    states: 14,
  },
  { id: "P-09", title: "설정", folder: "p09-settings", states: 9 },
  {
    id: "P-10",
    title: "비밀 (O-05 재인증, O-06 삭제 확인 포함)",
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
    title: "셸 내비 · 보기 기준 칸 · 시험 표지와 정리",
    folder: "a00-nav-context",
    states: 14,
  },
  { id: "N-02·N-03", title: "시험 대화(머리, 멈춤 띠)", folder: "a01-trial-chat", states: 10 },
  {
    id: "N-05~N-07·P-05",
    title: "사람 확인 · 승인 출처 · 만료 · 진행권 충돌",
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
];
