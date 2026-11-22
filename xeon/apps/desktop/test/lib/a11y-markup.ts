// 서버 렌더 글(HTML)에서 이름 없는 조작 요소를 찾는 가벼운 점검. axe가 아니다(DOM이 없어 axe를 못 돌린다).
// 단추·링크·입력란에 읽을 이름이 있는지, 이미지에 alt가 있는지, 양수 tabindex가 없는지만 본다.

export interface A11yProblem {
  readonly rule: "button-name" | "link-name" | "input-name" | "image-alt" | "tabindex-positive";
  readonly tag: string;
}

const VOID_TAG = /<(input|img)\b([^>]*)>/g;
const PAIR_TAG = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g;

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}(?:="([^"]*)")?(?=\\s|/|$)`).exec(attrs);
  if (match === null) return undefined;
  return match[1] ?? "";
}

function hasName(attrs: string, inner: string): boolean {
  const label = attribute(attrs, "aria-label");
  if (label !== undefined && label.trim() !== "") return true;
  if ((attribute(attrs, "aria-labelledby") ?? "") !== "") return true;
  if ((attribute(attrs, "title") ?? "") !== "") return true;
  const text = inner.replace(/<[^>]*>/g, "").trim();
  if (text !== "") return true;
  // 안쪽 이미지의 alt나 이름 붙은 요소도 이름이 된다
  return /\salt="[^"]+"|\saria-label="[^"]+"/.test(inner);
}

/** 이름 없는 조작 요소와 양수 tabindex를 모은다. 문제가 없으면 빈 목록이다 */
export function a11yProblems(markup: string): A11yProblem[] {
  const problems: A11yProblem[] = [];
  for (const match of markup.matchAll(PAIR_TAG)) {
    const [whole, tag, attrs = "", inner = ""] = match;
    if (tag === undefined) continue;
    if (tag === "a" && attribute(attrs, "href") === undefined) continue;
    if (!hasName(attrs, inner)) {
      problems.push({
        rule: tag === "button" ? "button-name" : "link-name",
        tag: whole.slice(0, 120),
      });
    }
  }
  for (const match of markup.matchAll(VOID_TAG)) {
    const [whole, tag, attrs = ""] = match;
    if (tag === "img") {
      if (attribute(attrs, "alt") === undefined && attribute(attrs, "role") !== "presentation") {
        problems.push({ rule: "image-alt", tag: whole.slice(0, 120) });
      }
      continue;
    }
    // 화면 낭독기에서 숨긴 입력란은 겉 요소가 이름을 가진다
    if (attribute(attrs, "aria-hidden") === "true") continue;
    const type = attribute(attrs, "type") ?? "text";
    if (type === "hidden" || type === "submit" || type === "button") continue;
    const id = attribute(attrs, "id");
    const labelled = id !== undefined && markup.includes(`for="${id}"`);
    if (!labelled && !hasName(attrs, ""))
      problems.push({ rule: "input-name", tag: whole.slice(0, 120) });
  }
  for (const match of markup.matchAll(/tabindex="(\d+)"/g)) {
    if (Number(match[1]) > 0) problems.push({ rule: "tabindex-positive", tag: match[0] });
  }
  return problems;
}
