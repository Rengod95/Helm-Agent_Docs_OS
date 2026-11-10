// @electron/packager로 Fresnel.app(macOS arm64)을 만든다(L4.desktop.spec §11.7). UI 번들과 엔진 사이드카는 Resources에 넣고
// (옛 Tauri 구현의 externalBin과 같은 자리), 고지 파일은 Resources/licenses/에 모은다. 서명과 공증은 이 스크립트가 아니라
// xeon/scripts/electron-sign.sh가 하고(`just desktop-sign-electron`), 업데이트 피드(Resources/update-feed.json)와
// electron-updater용 Resources/app-update.yml은 build/update-feed.json이나 env FRESNEL_UPDATE_REPO가 있을 때만 넣는다(값은 사용자 몫).
// env: FRESNEL_RELEASE_VERSION (앱 버전, 기본은 package.json), FRESNEL_APP_OUT (출력 폴더, 기본 dist-app)
// 도구 선택: packager는 설정 없이 .app만 만들고 서명·공증·업데이트는 따로 붙일 수 있어 electron-builder보다 얇다.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { packager } from "@electron/packager";
import {
  appUpdateYmlText,
  dirBytes,
  githubFeedText,
  localeDirsOf,
  mibOf,
  pruneLocales,
} from "./package-lib.ts";

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
  path.join(desktop, "dist", "sidecar", "fresnel-web-aarch64-apple-darwin"),
  path.join(shell, "dist", "bundle", "main.mjs"),
  path.join(shell, "node_modules", "electron", "dist", "LICENSE"),
  path.join(shell, "dist", "engine-notices.txt"),
  path.join(shell, "dist", "default-plugins"),
  path.join(shell, "node_modules", "mac-security", "index.js"),
  path.join(shell, "node_modules", "mac-security", "build", "Release", "mac_security.node"),
];
for (const file of requiredInputs) {
  if (!existsSync(file)) {
    const electronHint = file.includes(`${path.sep}electron${path.sep}dist${path.sep}`)
      ? "; the Electron binary was not unpacked (bun install skipped its postinstall): cd apps/desktop-shell/node_modules/electron && node install.js"
      : "";
    process.stderr.write(
      `package: missing ${file} (just desktop-build-electron builds the inputs; or just desktop-ui, just desktop-sidecar host, just desktop-sidecar host --gateway)${electronHint}\n`,
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

// mac-security(재인증): bun이 `.node`를 번들에 묶지 못한다. 애드온 폴더(index.js, package.json, 라이선스, `.node`)를
// Resources/mac-security로 둔다(lib/mac-security.ts가 createRequire로 거기서 불러온다). Mach-O라 electron-sign.sh가 서명한다.
const addonSrc = path.join(shell, "node_modules", "mac-security");
const addonStage = path.join(stage, "mac-security");
mkdirSync(path.join(addonStage, "build", "Release"), { recursive: true });
for (const name of ["index.js", "package.json", "LICENSE"]) {
  copyFileSync(path.join(addonSrc, name), path.join(addonStage, name));
}
copyFileSync(
  path.join(addonSrc, "build", "Release", "mac_security.node"),
  path.join(addonStage, "build", "Release", "mac_security.node"),
);

// 업데이트 피드: build/update-feed.json이 있으면 그것을, 없고 FRESNEL_UPDATE_REPO(소유자/저장소)가 맞으면 GitHub Releases 피드를 만든다.
// 둘 다 없으면 피드 없이 묶는다(앱은 "업데이트를 확인할 수 없어요"를 보인다). 저장소가 비공개면 앱이 못 읽는다(공개 릴리스 저장소는 사용자 몫)
const feedSource = path.join(shell, "build", "update-feed.json");
const generated = githubFeedText(process.env["FRESNEL_UPDATE_REPO"]);
let feed = feedSource;
if (!existsSync(feedSource) && generated !== null) {
  feed = path.join(stage, "update-feed.json");
  writeFileSync(feed, generated);
}
// electron-updater는 내려받기 전에 Resources/app-update.yml을 읽는다(없으면 ENOENT). 피드가 있으면 그에 맞춰 만든다
const appUpdateYml = existsSync(feed) ? appUpdateYmlText(readFileSync(feed, "utf8")) : null;
const appUpdateYmlFile = path.join(stage, "app-update.yml");
if (appUpdateYml !== null) writeFileSync(appUpdateYmlFile, appUpdateYml);
// 웹 게이트웨이: 서비스(호스트)가 자기 바이너리 옆의 `fresnel-web`과 `ui/`를 찾는다(apps/host gateway-command.ts). 파일 이름에서 triple을 뺀다
const gatewayStaged = path.join(stage, "fresnel-web");
copyFileSync(
  path.join(desktop, "dist", "sidecar", "fresnel-web-aarch64-apple-darwin"),
  gatewayStaged,
);
chmodSync(gatewayStaged, 0o755);
const extraResource = [
  path.join(desktop, "dist", "ui"),
  path.join(desktop, "dist", "sidecar", "fresnel-aarch64-apple-darwin"),
  gatewayStaged,
  // 트레이 아이콘(tray-shell.ts가 Resources/assets/tray.png를 읽는다)
  path.join(shell, "assets"),
  licenses,
  addonStage,
  // 기본 플러그인(Helm 등): `just desktop-build-electron`이 scripts/default-plugins.ts로 먼저 만든다. 엔진 사이드카가 Resources/default-plugins/를 설치 원본으로 읽는다
  path.join(shell, "dist", "default-plugins"),
  ...(existsSync(feed) ? [feed] : []),
  ...(appUpdateYml === null ? [] : [appUpdateYmlFile]),
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
  // 앱 아이콘(Dock, Finder, ⌘Tab). 경로 고해상도 렌더를 크기별로 줄인 것이다(docs/xeon/engineering/brand/guide.md)
  icon: path.join(shell, "build", "icon.icns"),
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
