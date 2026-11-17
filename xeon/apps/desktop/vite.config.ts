// 데스크톱 화면 번들. caustic 스타일이 Tailwind 4를 써서 `bun build`만으로는 만들 수 없어 Vite로 묶는다(devDependencies에 이미 있음).
// 개발 빌드(`--mode dev`)는 불변식 검사를 켠다(`__FRESNEL_CHECKS__`, src/app/build.ts). 출력은 Electron 셸이 읽는 `dist/ui`다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * 번들에 실제로 들어간 모듈의 id 목록을 출력 폴더 옆(`dist/ui-modules.json`, 앱에 실리지 않는 자리)에 쓴다.
 * scripts/ui-notices.ts가 이 목록에서 npm 패키지를 가려 라이선스 고지를 만든다.
 */
function moduleManifest(): Plugin {
  let outDir = "";
  return {
    name: "fresnel-module-manifest",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const ids = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") for (const id of Object.keys(output.modules)) ids.add(id);
      }
      const file = resolve(dirname(outDir), `${outDir.split("/").at(-1) ?? "ui"}-modules.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ modules: [...ids] }, null, 2)}\n`);
    },
  };
}

// oxlint-disable-next-line import/no-default-export -- Vite는 설정 파일의 default export만 읽는다 (Vite 설정 규약)
export default defineConfig(({ mode }) => ({
  root: ".",
  base: "./",
  plugins: [react(), tailwindcss(), moduleManifest()],
  define: { __FRESNEL_CHECKS__: JSON.stringify(mode === "dev") },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    minify: mode !== "dev",
  },
}));
