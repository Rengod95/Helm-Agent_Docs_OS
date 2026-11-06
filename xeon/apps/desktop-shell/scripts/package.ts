// @electron/packager로 Fresnel.app(macOS arm64)을 만든다(L4.desktop.spec §11.7). UI 번들과 엔진 사이드카는 Resources에 넣고
// (옛 Tauri 구현의 externalBin과 같은 자리), 고지 파일은 Resources/licenses/에 모은다. 서명과 공증은 이 스크립트가 아니라
// xeon/scripts/electron-sign.sh가 하고(`just desktop-sign-electron`), 업데이트 피드(Resources/update-feed.json)는
// build/update-feed.json이 있을 때만 넣는다(값은 사용자 몫).
// env: FRESNEL_RELEASE_VERSION (앱 버전, 기본은 package.json), FRESNEL_APP_OUT (출력 폴더, 기본 dist-app)
// 도구 선택: packager는 설정 없이 .app만 만들고 서명·공증·업데이트는 따로 붙일 수 있어 electron-builder보다 얇다.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { packager } from "@electron/packager";
import { dirBytes, localeDirsOf, mibOf, pruneLocales } from "./package-lib.ts";

const root = import.meta.dirname;
const shell = path.resolve(root, "..");
const desktop = path.join(shell, "..", "desktop");
const out = path.resolve(process.env["FRESNEL_APP_OUT"] ?? path.join(shell, "dist-app"));
const stage = path.join(out, "stage");
const version = (process.env["FRESNEL_RELEASE_VERSION"] ?? "").replace(/^v/u, "");
const BUNDLE_ID = "dev.fresnel.desktop";

const requiredInputs = [
  path.join(desktop, "dist", "ui", "index.html"),
  path.join(desktop, "dist", "sidecar", "fresnel-aarch64-apple-darwin"),
  path.join(shell, "dist", "bundle", "main.mjs"),
  path.join(shell, "node_modules", "electron", "dist", "LICENSE"),
  path.join(shell, "dist", "engine-notices.txt"),
];
for (const file of requiredInputs) {
  if (!existsSync(file)) {
    process.stderr.write(
      `package: missing ${file} (just desktop-ui, just desktop-sidecar host, bun run build)\n`,
    );
    process.exit(2);
  }
}

// 고지 모음: Electron과 Chromium 라이선스, 셸 npm 고지, 엔진 사이드카(Bun, host, cli) 고지
const licenses = path.join(stage, "licenses");
rmSync(stage, { recursive: true, force: true });
mkdirSync(licenses, { recursive: true });
const electronDist = path.join(shell, "node_modules", "electron", "dist");
copyFileSync(path.join(electronDist, "LICENSE"), path.join(licenses, "LICENSE.electron"));
copyFileSync(
  path.join(electronDist, "LICENSES.chromium.html"),
  path.join(licenses, "LICENSES.chromium.html"),
);
copyFileSync(
  path.join(shell, "resources", "THIRD-PARTY-NOTICES-SHELL.txt"),
  path.join(licenses, "THIRD-PARTY-NOTICES-SHELL.txt"),
);
// 엔진 사이드카 고지는 `just desktop-build-electron`이 먼저 만든다(`scripts/notices.ts --out dist/engine-notices.txt`)
copyFileSync(
  path.join(shell, "dist", "engine-notices.txt"),
  path.join(licenses, "THIRD-PARTY-NOTICES.txt"),
);

const feed = path.join(shell, "build", "update-feed.json");
const extraResource = [
  path.join(desktop, "dist", "ui"),
  path.join(desktop, "dist", "sidecar", "fresnel-aarch64-apple-darwin"),
  // 트레이 아이콘(tray-shell.ts가 Resources/assets/tray.png를 읽는다)
  path.join(shell, "assets"),
  licenses,
  ...(existsSync(feed) ? [feed] : []),
];

const paths = await packager({
  dir: shell,
  out,
  name: "Fresnel",
  platform: "darwin",
  arch: "arm64",
  overwrite: true,
  prune: false,
  asar: true,
  appBundleId: BUNDLE_ID,
  appCategoryType: "public.app-category.developer-tools",
  ...(version === "" ? {} : { appVersion: version, buildVersion: version }),
  ignore: [
    /^\/(src|test|scripts|build|resources|assets|dist-app|node_modules|tsconfig\.json|bun\.lock|\.gitignore)(\/|$)/,
  ],
  extraResource,
});

const [appDir] = paths;
if (appDir === undefined) {
  process.stderr.write("package: packager returned no output folder\n");
  process.exit(1);
}
const app = path.join(appDir, "Fresnel.app");
let removed = 0;
for (const dir of localeDirsOf(app)) removed += pruneLocales(dir);
rmSync(stage, { recursive: true, force: true });
process.stdout.write(`${app}\n`);
process.stderr.write(
  `package: ${path.relative(process.cwd(), app)} ${String(mibOf(dirBytes(app)))} MiB (locale folders removed: ${String(removed)}, kept: en, ko)\n`,
);
