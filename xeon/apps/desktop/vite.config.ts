// 데스크톱 화면 번들. caustic 스타일이 Tailwind 4를 써서 `bun build`만으로는 만들 수 없어 Vite로 묶는다(devDependencies에 이미 있음).
// 개발 빌드(`--mode dev`)는 불변식 검사를 켠다(`__FRESNEL_CHECKS__`, src/app/build.ts). 출력은 Tauri가 읽는 `src-tauri/ui`다.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// oxlint-disable-next-line import/no-default-export -- Vite는 설정 파일의 default export만 읽는다 (Vite 설정 규약)
export default defineConfig(({ mode }) => ({
  root: ".",
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { __FRESNEL_CHECKS__: JSON.stringify(mode === "dev") },
  build: {
    outDir: "src-tauri/ui",
    emptyOutDir: true,
    minify: mode !== "dev",
  },
}));
