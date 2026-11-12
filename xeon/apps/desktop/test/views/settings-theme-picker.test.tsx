import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { ThemePicker } from "../../src/views/pages/settings/settings-theme-picker.tsx";

// 테마 고르기 타일(DP-86). 세 타일이 한 radiogroup이고, 고른 하나만 checked이며 탭 순서에 든다.

function tilesOf(
  html: string,
): { readonly theme: string; readonly checked: string; readonly tab: string }[] {
  return [...html.matchAll(/<button[^>]*>/g)].map((match) => {
    const tag = match[0];
    return {
      theme: /data-theme-option="([a-z]+)"/.exec(tag)?.[1] ?? "",
      checked: /aria-checked="(true|false)"/.exec(tag)?.[1] ?? "",
      tab: /tabindex="(-?\d)"/i.exec(tag)?.[1] ?? "",
    };
  });
}

describe("theme tiles", () => {
  test("system, light and dark tiles in that order, only the chosen one checked and tabbable", () => {
    const html = renderToString(<ThemePicker value="dark" onChange={() => {}} labelId="theme" />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="theme"');
    expect(tilesOf(html)).toEqual([
      { theme: "system", checked: "false", tab: "-1" },
      { theme: "light", checked: "false", tab: "-1" },
      { theme: "dark", checked: "true", tab: "0" },
    ]);
  });
});
