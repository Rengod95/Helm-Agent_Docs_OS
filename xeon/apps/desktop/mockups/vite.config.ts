// 셸 목업 개발 서버와 정적 빌드. caustic 문서 앱과 같은 Vite + Tailwind 4 구성이다.
// 실행: MOCKUP=<목업 폴더 이름> bun run mockup        (개발 서버)
//       MOCKUP=<목업 폴더 이름> bun run mockup:build  (MOCKUP_OUT 또는 <tmpdir>/fresnel-mockups/<이름>에 정적 파일, 저장소 밖)
// 아이콘은 caustic 어댑터의 Solar 하나뿐이라 세트 고르기 설정이 없다(DP-17).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const name = process.env["MOCKUP"] ?? "_base";
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: `${here}${name}`,
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: Number(process.env["MOCKUP_PORT"] ?? 5180) },
  build: {
    outDir: process.env["MOCKUP_OUT"] ?? join(tmpdir(), "fresnel-mockups", name),
    emptyOutDir: true,
  },
});
