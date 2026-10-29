// 셸 목업 개발 서버와 정적 빌드. caustic 문서 앱과 같은 Vite + Tailwind 4 구성이다.
// 실행: MOCKUP=<목업 폴더 이름> bun run mockup        (개발 서버)
//       MOCKUP=<목업 폴더 이름> bun run mockup:build  (MOCKUP_OUT 또는 <tmpdir>/xeon-mockups/<이름>에 정적 파일, 저장소 밖)
// 아이콘 세트: CAUSTIC_ICON_SET=phosphor(기본)|solar. caustic의 '#icon-set' import를 해석 조건으로 고른다(DP-17).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig } from "vite";

const name = process.env["MOCKUP"] ?? "_base";
const here = fileURLToPath(new URL(".", import.meta.url));
const iconSet = process.env["CAUSTIC_ICON_SET"] ?? "phosphor";
if (iconSet !== "phosphor" && iconSet !== "solar") {
  throw new Error(`CAUSTIC_ICON_SET는 phosphor 또는 solar여야 해요: ${iconSet}`);
}

export default defineConfig({
  root: `${here}${name}`,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions:
      iconSet === "solar"
        ? ["caustic-icons-solar", ...defaultClientConditions]
        : [...defaultClientConditions],
  },
  server: { host: "127.0.0.1", port: Number(process.env["MOCKUP_PORT"] ?? 5180) },
  build: {
    outDir: process.env["MOCKUP_OUT"] ?? join(tmpdir(), "xeon-mockups", name),
    emptyOutDir: true,
  },
});
