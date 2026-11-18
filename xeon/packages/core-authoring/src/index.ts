// 제작 코어(시스템 모듈, L1). 플러그인(P)은 이 패키지를 import하지 않고 `fresnel.devkit` 서비스 계약(contracts)으로만 쓴다(DR-15).
// 호스트(조립 루트)가 이 함수들로 제작 포트를 만든다.
export { KIND_CATALOG, kindEntryOf } from "./catalog.ts";
export { BUNDLE_ENTRY, folderHash, looksSecret, packExtension } from "./pack.ts";
export { DEFAULT_VERSION, scaffoldExtension, type ScaffoldOptions } from "./scaffold.ts";
export { locateTemplateDirs, type TemplateDirs } from "./templates-dir.ts";
export { MANIFEST_PATH, validateCompositionReport, validateExtensionDir } from "./validate.ts";
export { catalogConformance } from "./conformance.ts";
