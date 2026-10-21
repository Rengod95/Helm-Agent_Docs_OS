import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
import type { OutputMode } from "../cli/command.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";

// L4.cli.spec §3.1 `xeon version [--json]`. CLI 버전, 계약 버전(WIRE_PROTOCOL_VERSION), Bun 버전. 엔진 없이 끝난다.

/** CLI 빌드 버전. 릴리즈 빌드가 주입하는 수단은 아직 없다(host의 ENGINE_VERSION과 같은 사정) [미결] */
export const CLI_VERSION = "0.0.0";

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
    await stdout(`xeon ${facts.cli}\n계약 ${WIRE_PROTOCOL_VERSION}\nBun ${facts.bun}\n`);
  }
  return EXIT.ok;
}
