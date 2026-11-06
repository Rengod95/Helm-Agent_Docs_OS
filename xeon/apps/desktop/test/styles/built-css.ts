import { build } from "vite";
import type { Rolldown } from "vite";
import { join } from "node:path";

// 화면 번들을 메모리에 빌드하고 CSS 한 덩어리를 돌려준다(개발 빌드와 같은 설정, 디스크에 쓰지 않는다).
const ROOT = join(import.meta.dir, "..", "..");

type Output = Rolldown.RolldownOutput;

function outputs(result: Awaited<ReturnType<typeof build>>): Output[] {
  if (Array.isArray(result)) return result.filter((item): item is Output => "output" in item);
  return "output" in result ? [result] : [];
}

export async function buildCss(): Promise<string> {
  const result = await build({
    root: ROOT,
    configFile: join(ROOT, "vite.config.ts"),
    mode: "dev",
    logLevel: "silent",
    build: { write: false, minify: false },
  });
  const css: string[] = [];
  for (const output of outputs(result)) {
    for (const chunk of output.output) {
      if (chunk.type === "asset" && chunk.fileName.endsWith(".css")) {
        css.push(
          typeof chunk.source === "string" ? chunk.source : new TextDecoder().decode(chunk.source),
        );
      }
    }
  }
  return css.join("\n");
}

/** CSS 안의 클래스 선택자 이름(이스케이프를 푼 것) */
export function classNamesIn(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/\.((?:\\.|[\w-])+)/g)) {
    const raw = match[1];
    if (raw !== undefined) names.add(raw.replace(/\\(.)/g, "$1"));
  }
  return names;
}
