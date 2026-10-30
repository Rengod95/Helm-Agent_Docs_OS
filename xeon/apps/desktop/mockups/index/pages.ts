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
];
