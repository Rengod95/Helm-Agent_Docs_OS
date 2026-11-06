// 앱 문서(`app://`)의 CSP. 옛 Tauri 구현(커밋 424f338a)의 CSP에 `img-src`만 더했다.
// 입력창 첨부 칩의 썸네일은 파일을 `data:` 주소로 그려서, `default-src 'self'`만 있으면 막혀 깨진 그림이 된다.
// 이미지 주소만 `data:`와 `blob:`을 허용한다. 스크립트·연결·프레임 규칙은 그대로다.
export const APP_CSP =
  "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src fresnel-view:";
