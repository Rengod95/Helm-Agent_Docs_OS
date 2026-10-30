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
  { id: "P-01", title: "첫 실행", folder: "p01-first-run", states: 10 },
  { id: "P-15", title: "진단과 정보", folder: "p15-diagnostics", states: 6 },
  { id: "O-07", title: "새 대화", folder: "o07-new-thread", states: 5 },
  { id: "O-09", title: "바로 가기 키 도움말", folder: "o09-shortcuts", states: 4 },
  { id: "S-04", title: "토스트", folder: "s04-toast", states: 5 },
];
