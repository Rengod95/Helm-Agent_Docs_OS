// 묶기 스크립트(package.ts)의 순수 부분. 시험은 test/package-lib.test.ts.
import { lstatSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/** 묶은 앱에 남기는 로캘. UI 카탈로그가 ko와 en뿐이라 나머지 Chromium 로캘 폴더는 지운다. 없는 로캘은 en으로 돌아간다 */
export const KEPT_LOCALES: readonly string[] = ["en", "ko"];

/** `ko.lproj` 같은 로캘 폴더 이름을 지워도 되는가. `.lproj`가 아니면 지우지 않는다 */
export function isPrunableLocaleDir(name: string): boolean {
  if (!name.endsWith(".lproj")) return false;
  return !KEPT_LOCALES.includes(name.slice(0, -".lproj".length));
}

/** `dir` 바로 아래의 지울 로캘 폴더를 지우고 지운 개수를 돌려준다 */
export function pruneLocales(dir: string): number {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!isPrunableLocaleDir(name)) continue;
    rmSync(path.join(dir, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** 폴더의 전체 바이트(하위 포함, 심볼릭 링크는 따라가지 않는다) */
export function dirBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const info = lstatSync(file, { throwIfNoEntry: false });
    if (info === undefined) continue;
    total += info.isDirectory() ? dirBytes(file) : info.size;
  }
  return total;
}

/** 묶은 앱 안에서 지울 로캘 폴더가 있는 곳(앱 Resources와 Electron Framework Resources) */
export function localeDirsOf(app: string): readonly string[] {
  return [
    path.join(app, "Contents", "Resources"),
    path.join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Resources",
    ),
  ];
}

const MIB = 1024 * 1024;
export function mibOf(bytes: number): number {
  return Math.round((bytes / MIB) * 10) / 10;
}
