// 원격 연결 명령 모듈의 electron 쪽 진입점(운영 의존). 시험은 electron 없이 `remote.ts`의 만드는 함수에 가짜를 넣는다.
import os from "node:os";
import { parseJson } from "@fresnel/contracts";
import { WIRE_PROTOCOL_VERSION } from "@fresnel/contracts/wire";
import { pairWithGateway, probeTlsFingerprint } from "@fresnel/platform-process";
import type { ShellModule } from "./context.ts";
import { pipedLauncher, type Launcher } from "./engine/launcher.ts";
import { remoteTokenSource, remoteVaultOf } from "./engine/remote-token.ts";
import { appLogOf } from "./lib/applog.ts";
import { ownField } from "./lib/narrow.ts";
import { nodeScheduler } from "./lib/scheduler.ts";
import { createRemoteModule, type LocalVersion } from "./remote.ts";

/**
 * 이 컴퓨터의 버전. 계약 버전은 이 빌드의 `WIRE_PROTOCOL_VERSION`이고, CLI 버전은 사이드카의 `version --json`에서 읽는다
 * (사이드카 CLI 버전은 `apps/cli`의 빌드 값이라 셸이 상수로 가져올 수 없다). 못 읽으면 `unknown`이다. CLI 버전은 `cliDiffers` 힌트에만 쓴다.
 */
async function localVersionOf(launcher: Launcher): Promise<LocalVersion> {
  const ran = await launcher.runOnce(["version", "--json"]);
  const cli = ran.ok && ran.value.exitCode === 0 ? cliOf(ran.value.stdout) : null;
  return { cli: cli ?? "unknown", contract: WIRE_PROTOCOL_VERSION };
}

function cliOf(stdout: string): string | null {
  const parsed = parseJson(stdout);
  if (!parsed.ok) return null;
  const cli = ownField(parsed.value, "cli");
  return typeof cli === "string" && cli !== "" ? cli : null;
}

export const remoteShellModule: ShellModule = createRemoteModule({
  home: os.homedir(),
  clock: { now: () => Date.now(), scheduler: nodeScheduler() },
  launcherOf: (ctx) =>
    pipedLauncher({
      env: ctx.env,
      platform: ctx.platform,
      arch: process.arch,
      resources: ctx.paths.resources,
      home: os.homedir(),
      log: appLogOf(ctx),
      scheduler: nodeScheduler(),
      remoteToken: remoteTokenSource({ platform: ctx.platform, env: ctx.env }),
    }),
  vaultOf: (ctx) => remoteVaultOf({ platform: ctx.platform, env: ctx.env }),
  ssh: {},
  pair: pairWithGateway,
  probeFingerprint: probeTlsFingerprint,
  appVersion: localVersionOf,
});
