import { join } from "node:path";

/** docs/xeon 아래 문서를 읽는다. 문서는 xeon 워크스페이스의 형제 디렉터리(code/helm/docs)에 있다 */
export async function readDoc(relative: string): Promise<string> {
  const path = join(import.meta.dir, "../../../../..", "docs/xeon", relative);
  return Bun.file(path).text();
}

/** 마크다운 표의 한 행을 셀 배열로 쪼갠다. 앞뒤 파이프와 공백을 뗀다 */
function cellsOf(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** 헤딩 아래 첫 표의 데이터 행들(헤더와 구분선 제외)을 돌려준다 */
export function tableRowsAfter(markdown: string, heading: string): readonly (readonly string[])[] {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const lines = markdown.slice(start).split("\n");
  const rows: (readonly string[])[] = [];
  let inTable = false;
  for (const line of lines.slice(1)) {
    if (line.trim().startsWith("|")) {
      inTable = true;
      rows.push(cellsOf(line));
    } else if (inTable) {
      break;
    }
  }
  return rows.slice(2);
}
