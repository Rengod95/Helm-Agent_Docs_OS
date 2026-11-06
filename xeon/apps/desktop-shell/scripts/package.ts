// @electron/packager로 .app을 만든다. UI 번들과 엔진 사이드카는 Resources에 넣는다(Tauri externalBin과 같은 자리).
// 도구 선택: packager는 설정 없이 .app만 만들고 서명·공증·업데이트는 뒤 트랙이 따로 붙일 수 있어 electron-builder보다 얇다.
import { packager } from "@electron/packager";

const root = import.meta.dirname;
const shell = `${root}/..`;
const desktop = `${shell}/../desktop`;
const paths = await packager({
  dir: shell,
  out: `${shell}/dist-app`,
  name: "Fresnel",
  platform: "darwin",
  arch: "arm64",
  overwrite: true,
  prune: false,
  asar: true,
  ignore: [/^\/(src|test|scripts|dist|dist-app|node_modules|tsconfig\.json|bun\.lock)(\/|$)/],
  extraResource: [
    `${desktop}/src-tauri/ui`,
    `${desktop}/src-tauri/binaries/fresnel-aarch64-apple-darwin`,
  ],
});
process.stdout.write(`${paths.join("\n")}\n`);
