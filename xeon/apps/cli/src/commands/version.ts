import { t } from "@xeon/client/i18n";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
import type { OutputMode } from "../cli/command.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";

// L4.cli.spec §3.1 `xeon version [--json]`. CLI 버전, 계약 버전(WIRE_PROTOCOL_VERSION), Bun 버전. 엔진 없이 끝난다.

/** 릴리즈 빌드가 `bun build --define XEON_BUILD_VERSION="x.y.z"`로 넣는 값(scripts/build-sidecar.ts). 소스 실행에는 없다 */
declare const XEON_BUILD_VERSION: string | undefined;

/** CLI 빌드 버전. 주입이 없으면 "0.0.0"이다(L4.release.spec §8.1) */
export const CLI_VERSION: string =
  typeof XEON_BUILD_VERSION === "string" ? XEON_BUILD_VERSION : "0.0.0";

export interface VersionFacts {
  readonly cli: string;
  readonly bun: string;
}

export async function runVersion(
  output: OutputMode,
  facts: VersionFacts,
  stdout: (text: string) => Promise<void>,
): Promise<ExitCode> {
  if (output === "json") {
    const line = JSON.stringify({
      cli: facts.cli,
      contract: WIRE_PROTOCOL_VERSION,
      bun: facts.bun,
    });
    await stdout(`${line}\n`);
  } else {
    await stdout(
      t("cli.version.text", { cli: facts.cli, contract: WIRE_PROTOCOL_VERSION, bun: facts.bun }),
    );
  }
  return EXIT.ok;
}
