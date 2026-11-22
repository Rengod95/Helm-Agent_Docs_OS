// 종류 그림의 획(12 칸). 리뷰 화면(`review/review-glyphs.tsx`)과 메트릭·트레이스(`metrics/glyphs.tsx`)의 `KindGlyph`가 같은 획을 그린다.
// 그림 말은 프로필 캔버스(cv3)와 같다: Inject는 들어가는 화살, Hook은 문(마름모), Drive는 겹 갈매기, 도구는 플러그, 블록은 칸 나뉜 네모.
// 선은 `LINE_GLYPH`(화면 1px, m6R7 [결정: 2026-11-22 사용자 "다 1px기준으로"])이고, 가로·세로 획은 0.5 칸 배수에 두어 12px에서 번지지 않는다.

export type GlyphKind = "inject" | "hook" | "drive" | "tool" | "block";

export const KIND_PATHS: Readonly<Record<GlyphKind, readonly string[]>> = {
  inject: ["M1.5 6h6", "M5 3.5 7.5 6 5 8.5", "M10.5 2v8"],
  hook: ["M6 1.6 10.4 6 6 10.4 1.6 6Z", "M6 4.5v3"],
  drive: ["M2.2 2.6 5.6 6 2.2 9.4", "M6.4 2.6 9.8 6 6.4 9.4"],
  tool: ["M4 1.5v2.5M8 1.5v2.5", "M2.5 4h7v1.5a3.5 3.5 0 0 1-7 0Z", "M6 9v1.5"],
  block: [
    "M3.5 2h5A1.5 1.5 0 0 1 10 3.5v5A1.5 1.5 0 0 1 8.5 10h-5A1.5 1.5 0 0 1 2 8.5v-5A1.5 1.5 0 0 1 3.5 2Z",
    "M2 6h8",
  ],
};
