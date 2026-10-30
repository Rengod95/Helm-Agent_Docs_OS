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
  { id: "P-05", title: "탐구(Helm)", folder: "p05-helm", states: 12 },
  { id: "P-07", title: "예약 · O-08 예약 편집", folder: "p07-schedules", states: 11 },
  { id: "P-08", title: "연결", folder: "p08-connection", states: 7 },
  { id: "P-14", title: "목표와 작업", folder: "p14-work", states: 7 },
];
