// `mac-security`(Touch ID, 안 되면 Mac 암호) 네이티브 애드온을 불러온다(L4.desktop.spec §11.6).
// bun은 `.node`를 번들에 묶지 못하므로 정적 import 대신 `createRequire`로 경로를 정해 불러온다.
//  - 묶은 앱: `<Resources>/mac-security/index.js`(scripts/package.ts가 복사한다, `.node`는 그 안 `build/Release`)
//  - 개발 실행: `node_modules`의 `mac-security`
// 불러오기에 실패하면 `null`이다. 재인증은 `unavailable`로 떨어지고 앱은 계속 돈다.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { attempt } from "@fresnel/contracts";

/** 재인증이 쓰는 애드온 면. 모양만 본다(다른 사본의 `MacSecurityError`도 받는다) */
export interface MacSecurityApi {
  readonly canAuthenticate: () => { readonly available: boolean };
  readonly authenticate: (reason: string) => Promise<void>;
}

/** 묶은 앱 안 애드온 폴더 이름(Resources 아래) */
const BUNDLED_DIR = "mac-security";

function isApi(value: unknown): value is MacSecurityApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "canAuthenticate" in value &&
    typeof value.canAuthenticate === "function" &&
    "authenticate" in value &&
    typeof value.authenticate === "function"
  );
}

/** 불러올 위치를 고른다. 묶은 사본이 있으면 그 경로, 없으면 모듈 이름(개발 실행) */
export function macSecuritySpecifier(
  resources: string,
  exists: (file: string) => boolean = existsSync,
): string {
  const bundled = path.join(resources, BUNDLED_DIR, "index.js");
  return exists(bundled) ? bundled : "mac-security";
}

/** 애드온을 불러온다. 없거나 모양이 다르면 null. `load`는 시험이 바꿔 넣는다 */
export function loadMacSecurity(
  resources: string,
  load: (specifier: string) => unknown = createRequire(import.meta.url),
  exists: (file: string) => boolean = existsSync,
): MacSecurityApi | null {
  const loaded = attempt(() => load(macSecuritySpecifier(resources, exists)));
  if (!loaded.ok) return null;
  return isApi(loaded.value) ? loaded.value : null;
}
