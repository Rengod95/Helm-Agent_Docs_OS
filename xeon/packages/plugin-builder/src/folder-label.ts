// 사용자에게 보이는 폴더 글(U-03). 프로젝트 없는 대화의 기본 폴더는 `<데이터 폴더>/default-project/<대화 id>`라서 내부 경로가 그대로
// 보이면 안 된다. 그 경로는 "이 대화의 기본 폴더"로 말하고, 다른 경로는 그대로 쓴다. 상태의 `dir`은 바꾸지 않는다.

const DEFAULT_PROJECT_FOLDER = /[\\/]default-project[\\/]/;

/** 화면 글에 쓸 폴더 말. 기본 폴더 안의 경로는 내부 경로를 가리고 "이 대화의 기본 폴더"로 바꾼다 */
export function folderLabel(dir: string): string {
  return DEFAULT_PROJECT_FOLDER.test(dir) ? "이 대화의 기본 폴더" : dir;
}
