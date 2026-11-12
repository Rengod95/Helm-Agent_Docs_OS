import { describe, expect, test } from "bun:test";
import { encodeQr } from "@fresnel/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QrCode } from "../../src/views/pages/shared/qr-code.tsx";

// QR 그림 조각(SVG). d 문자열을 다시 풀어 검은 모듈 좌표가 부호화 결과와 같은지 값으로 비교한다.

/** path의 d를 풀어 [행, 열] 목록(모듈 좌표, 조용한 영역 4 제외)으로 되돌린다 */
function darkCellsOf(d: string): [number, number][] {
  const cells: [number, number][] = [];
  for (const match of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const x = Number(match[1]) - 4;
    const y = Number(match[2]) - 4;
    const run = Number(match[3]);
    for (let k = 0; k < run; k++) cells.push([y, x + k]);
  }
  return cells;
}

function darkCellsOfMatrix(modules: readonly (readonly boolean[])[]): [number, number][] {
  const cells: [number, number][] = [];
  modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) cells.push([r, c]);
    });
  });
  return cells;
}

describe("QrCode", () => {
  test('"A" draws the matrix in a 4-module quiet zone, as one path of dark runs', () => {
    const result = encodeQr("A");
    if (!result.ok) throw new Error("encode failed");
    const html = renderToStaticMarkup(<QrCode value="A" size={116} label="링크 QR" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="링크 QR"');
    expect(html).toContain('width="116"');
    expect(html).toContain('viewBox="0 0 29 29"');
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('fill="#fff"');
    expect(html).toContain('fill="#000"');
    expect(html).not.toContain("class=");

    const d = / d="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(darkCellsOf(d)).toEqual(darkCellsOfMatrix(result.value));
    // 가로로 이어진 줄은 한 조각이다: 첫 찾기 패턴의 윗줄(7칸 검정)이 한 번에 나온다
    expect(d.startsWith("M4 4h7v1h-7z")).toBe(true);
  });

  test("a value that does not fit draws nothing", () => {
    expect(
      renderToStaticMarkup(<QrCode value={"x".repeat(413)} size={100} label="너무 김" />),
    ).toBe("");
  });
});
