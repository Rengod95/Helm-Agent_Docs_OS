// 시크릿 참조 편집기(L4.settings-ui §4.2.1 `secret`)의 순수 모델. 값은 `secret://<이름>` 참조 글이고, 화면은 이름만 고른다.
// 키 값은 여기서도 다루지 않는다. 이름 목록은 시크릿 목록 명령(`commands.secrets.list`)이 준다.

const REF_PREFIX = "secret://";

/** 참조 글에서 이름을 꺼낸다. 참조 글이 아니거나 이름이 비었으면 `null`이다 */
export function secretNameOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(REF_PREFIX)) return null;
  const name = value.slice(REF_PREFIX.length);
  return name === "" ? null : name;
}

export function secretRefOf(name: string): string {
  return `${REF_PREFIX}${name}`;
}

/**
 * 고를 수 있는 이름 목록. 현재 값의 이름이 목록에 없어도 넣어서 값이 보이게 한다. 중복은 없고 이름순이다.
 */
export function secretChoicesOf(
  names: readonly string[],
  current: string | null,
): readonly string[] {
  const all = current === null ? names : [...names, current];
  return [...new Set(all)].toSorted();
}
