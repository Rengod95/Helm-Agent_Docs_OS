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
];
