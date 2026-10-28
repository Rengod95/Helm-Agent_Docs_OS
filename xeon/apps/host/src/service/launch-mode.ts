import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { attemptAsync, parseJson } from "@xeon/contracts";
import { resolveOsDirs } from "@xeon/platform-os";
import { hostResourceDir } from "../state-paths.ts";

// L4.host-service.spec §3.6 resolveLaunchMode, HS-37. 엔진 없이 사용자 설정 파일만 읽어 `l0.process.service.enabled`를 해석한다.
// 데스크톱 셸과 CLI가 사이드카(in-process·stdio)와 서비스 중 어느 쪽으로 갈지 정할 때 쓴다. 관리 범위 파일은 읽지 않는다 [미결: managed 위치는 L0.os].

export async function resolveLaunchMode(): Promise<"in-process" | "service"> {
  const dirs = resolveOsDirs({ resourceDir: hostResourceDir() });
  if (!dirs.ok) return "in-process";
  const text = await attemptAsync(() => readFile(join(dirs.value.config, "settings.json"), "utf8"));
  if (!text.ok) return "in-process";
  const json = parseJson(text.value);
  if (!json.ok || typeof json.value !== "object" || json.value === null) return "in-process";
  const enabled: unknown = Object.fromEntries(Object.entries(json.value))[
    "l0.process.service.enabled"
  ];
  return enabled === true ? "service" : "in-process";
}
