import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 원격 점검(L4.desktop.spec §4.15)은 디버그 빌드에만 있다. 릴리스 빌드에 듣는 소켓이 생기지 않도록 소스 수준 보장을 시험한다.
// 컴파일된 릴리스 산출물에서의 확인은 같은 절의 "릴리스 확인" 목록이 맡는다(cargo build --release 뒤의 사람이 하는 단계).

const src = join(import.meta.dir, "..", "src-tauri", "src");
const main = readFileSync(join(src, "main.rs"), "utf8");
const lines = main.split("\n");

function previous(index: number): string {
  return (lines[index - 1] ?? "").trim();
}

describe("debug-only inspection", () => {
  test("`mod inspect;` is declared only under cfg(debug_assertions)", () => {
    const at = lines.findIndex((line) => line.trim().startsWith("mod inspect;"));
    expect(at).toBeGreaterThan(0);
    expect(previous(at)).toBe("#[cfg(debug_assertions)]");
  });

  test("every use of the inspect module in main.rs sits behind a debug_assertions cfg", () => {
    const uses = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /\binspect::|start_inspect\(/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    // 호출 지점(`start_inspect(...)`)과 함수 정의는 cfg 줄이 바로 앞에 있어야 한다. 정의 안쪽의 `inspect::`는 정의의 cfg가 덮는다.
    const entries = uses.filter(({ line }) => /start_inspect\(/.test(line));
    for (const { index } of entries) {
      expect(previous(index)).toMatch(/^#\[cfg\(all\(debug_assertions, unix\)\)\]$/);
    }
  });

  test("no other module outside src/inspect names the listener (the socket is created only by inspect::serve)", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(src)) {
      if (!file.endsWith(".rs") || file === "main.rs") continue;
      const text = readFileSync(join(src, file), "utf8");
      if (/UnixListener|inspect::serve/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the debug log plugin is registered only in debug builds", () => {
    const at = lines.findIndex((line) => /\.plugin\(debug_log_plugin\(\)\)/.test(line));
    expect(at).toBeGreaterThan(0);
    expect(previous(at)).toBe("#[cfg(debug_assertions)]");
  });
});
