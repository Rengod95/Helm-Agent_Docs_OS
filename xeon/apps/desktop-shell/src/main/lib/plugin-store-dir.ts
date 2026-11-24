// 이 앱의 플러그인 저장소 폴더(`<데이터 폴더>/plugin-store`)를 셸이 안다. 데이터 폴더는 엔진 CLI(`fresnel db usage --json`)의 `dataDir`이 알려 주는 값으로,
// 엔진이 쓰는 폴더 규칙(FRESNEL_HOME 포함)을 셸이 다시 구현하지 않는다(`open_data_dir`과 같은 길). 드래프트 등급 app root는 이 폴더 아래일 때만 받는다(view-scheme.ts)
import path from "node:path";
import { attemptAsync, detach, parseJson, rethrow } from "@fresnel/contracts";
import type { Launcher } from "../engine/launcher.ts";
import { ownField } from "./narrow.ts";

export interface PluginStoreDirSource {
  /** 지금 아는 저장소 폴더. 아직 모르면 undefined이고, 그 호출이 알아보기를 시작한다(다음 호출에서 쓴다) */
  readonly current: () => string | undefined;
}

/** 사이드카 CLI를 한 번 돌려 데이터 폴더를 읽는다. 실패하면 undefined다 */
async function dataDirOf(launcher: Launcher): Promise<string | undefined> {
  const ran = await attemptAsync(() => launcher.runOnce(["db", "usage", "--json"]));
  if (!ran.ok || !ran.value.ok || ran.value.value.exitCode !== 0) return undefined;
  const parsed = parseJson(ran.value.value.stdout);
  const dataDir = parsed.ok ? ownField(parsed.value, "dataDir") : undefined;
  return typeof dataDir === "string" && path.isAbsolute(dataDir) ? dataDir : undefined;
}

export function createPluginStoreDirSource(launcher: Launcher): PluginStoreDirSource {
  let known: string | undefined;
  let looking = false;
  async function lookNow(): Promise<void> {
    const dataDir = await dataDirOf(launcher);
    looking = false;
    if (dataDir !== undefined) known = path.join(dataDir, "plugin-store");
  }
  function look(): void {
    if (looking) return;
    looking = true;
    detach(lookNow(), rethrow);
  }
  return {
    current() {
      if (known === undefined) look();
      return known;
    },
  };
}
