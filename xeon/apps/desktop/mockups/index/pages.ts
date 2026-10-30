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
  { id: "P-03", title: "받은 요청", folder: "p03-inbox", states: 9 },
  { id: "P-04", title: "변경 검토", folder: "p04-review", states: 8 },
  { id: "P-06", title: "제안", folder: "p06-proposals", states: 9 },
  {
    id: "O-02·03·04",
    title: "셸 명령 확인 · 명령 결과 · 신뢰 카드",
    folder: "o02-o04-chat",
    states: 4,
  },
];
