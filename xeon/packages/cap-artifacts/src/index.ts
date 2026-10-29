// @xeon/cap-artifacts 공개 진입점(L2.artifacts). 조립 루트가 쓰는 이름만 내보낸다.
export { artifactsPlugin, type ArtifactsPluginOptions } from "./plugin.ts";
export { artifactsManifest, ARTIFACTS_EXTENSION_NAME } from "./manifest.ts";
export { REVIEWS_PRODUCER } from "./reviews/kernel.ts";
export {
  ARTIFACTS_SETTING_DEFS,
  readArtifactsSettings,
  type ArtifactsSettingsSource,
} from "./settings.ts";
