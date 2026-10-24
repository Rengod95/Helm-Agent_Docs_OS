import { substituteArgs } from "../upstream/pi/prompt-templates.ts";

// L2.dialog.spec §4.2.4. 템플릿 본문의 `!{명령}` 자리를 찾고 인자를 치환한다. 중괄호는 Gemini CLI 규칙처럼 중첩을 센다.
// 인자 치환은 템플릿 조각마다 따로 한다: 인자 값 안의 `!{…}`가 새 셸 자리를 만들지 못하게 하려는 것이다.

/** 셸 주입이 한 템플릿에 가질 수 있는 최대 수(F `CommandExpandOutput.shell`의 상한) */
export const MAX_SHELL_INJECTIONS = 16;

export type TemplateSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "shell"; readonly command: string };

/** 본문을 글자 조각과 셸 자리로 나눈다. 닫히지 않은 `!{`는 글자로 둔다 */
export function splitShell(content: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let text = "";
  let index = 0;
  while (index < content.length) {
    if (content.startsWith("!{", index)) {
      let depth = 1;
      let end = index + 2;
      while (end < content.length && depth > 0) {
        const char = content.charAt(end);
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        end += 1;
      }
      if (depth === 0) {
        if (text !== "") segments.push({ kind: "text", text });
        text = "";
        segments.push({ kind: "shell", command: content.slice(index + 2, end - 1) });
        index = end;
        continue;
      }
    }
    text += content.charAt(index);
    index += 1;
  }
  if (text !== "") segments.push({ kind: "text", text });
  return segments;
}

/** 조각마다 인자를 치환한다 */
export function substituteSegments(
  segments: readonly TemplateSegment[],
  args: string[],
): TemplateSegment[] {
  return segments.map((segment) =>
    segment.kind === "text"
      ? { kind: "text", text: substituteArgs(segment.text, args) }
      : { kind: "shell", command: substituteArgs(segment.command, args) },
  );
}

export function shellCommands(segments: readonly TemplateSegment[]): string[] {
  return segments.flatMap((segment) => (segment.kind === "shell" ? [segment.command] : []));
}

/** 셸 자리를 `!{명령}` 그대로 둔 치환 결과(`expand`의 `text`) */
export function renderPending(segments: readonly TemplateSegment[]): string {
  return segments
    .map((segment) => (segment.kind === "text" ? segment.text : `!{${segment.command}}`))
    .join("");
}

/** 셸 자리를 실행 결과로 바꾼 최종 텍스트. `outputs`는 셸 자리 순서와 같다 */
export function renderWithOutputs(
  segments: readonly TemplateSegment[],
  outputs: readonly string[],
): string {
  let next = 0;
  return segments
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const output = outputs[next] ?? "";
      next += 1;
      return output;
    })
    .join("");
}
