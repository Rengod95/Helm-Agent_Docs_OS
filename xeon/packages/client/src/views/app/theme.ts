// 테마 push 값(ADR-0021 §3.6.8). 셸이 처음과 테마가 바뀔 때 `push: "theme"`로 보낸다. 토큰 이름은 CSS 사용자 속성이고 값은 글자 하나다.
// 프레임은 믿지 않는 코드지만 값이 프레임 CSS에 들어가므로, 셸도 CSS 문법을 깨는 글자를 보내지 않는다.

export interface ThemePush {
  readonly tokens: Readonly<Record<string, string>>;
  readonly scheme: "light" | "dark";
  readonly density: "compact" | "comfortable";
  readonly locale: string;
  readonly reducedMotion: boolean;
  /** 한글 타이포 규칙(DP-11). 줄바꿈 기준 */
  readonly hangulWordBreak: "keep-all" | "normal";
}

const TOKEN_NAME = /^--[a-z][a-z0-9-]{0,63}$/;
// 값은 CSS 선언 하나의 값이어야 한다. `;`, 중괄호, 꺾쇠, 역슬래시, url(), @import, 줄바꿈, 주석을 막는다
const TOKEN_VALUE = /^[^;{}<>\\\n\r]{1,200}$/;
const FORBIDDEN_VALUE = /url\s*\(|@import|\/\*|expression\s*\(/i;
const THEME_TOKEN_LIMIT = 512;

export function tokenValueAllowed(name: string, value: string): boolean {
  return TOKEN_NAME.test(name) && TOKEN_VALUE.test(value) && !FORBIDDEN_VALUE.test(value);
}

/** 이름 목록을 읽기 함수(`getComputedStyle(root).getPropertyValue`)로 읽어 허용되는 쌍만 모은다. 앞뒤 공백은 자른다 */
export function collectThemeTokens(
  names: readonly string[],
  read: (name: string) => string,
): Readonly<Record<string, string>> {
  const tokens: Record<string, string> = {};
  let count = 0;
  for (const name of names) {
    if (count >= THEME_TOKEN_LIMIT) break;
    const value = read(name).trim();
    if (!tokenValueAllowed(name, value)) continue;
    tokens[name] = value;
    count += 1;
  }
  return tokens;
}
