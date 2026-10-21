import { assertNever } from "@xeon/contracts";
import type { OsInfo } from "@xeon/contracts/services";
import { createDarwinKeyProvider } from "./key/darwin.ts";
import { createFileKeyProvider, type StatKeyFile } from "./key/file-fallback.ts";
import { createLinuxKeyProvider } from "./key/linux.ts";
import type { KeyProvider } from "./key/provider.ts";
import { createWin32KeyProvider } from "./key/win32.ts";

// L0.secrets.spec §3.7 마지막 단락. 키 획득 방식 선택은 이 파일 한 곳에만 둔다(DR-13, spec §9 12번).
// 플랫폼과 WSL 판정은 xeon.os의 OsInfo가 정하고, 이 파일만 그 값으로 분기한다.

export interface KeySelectInput {
  readonly source: "auto" | "keychain" | "file";
  /** 파일 폴백의 키 파일 경로(설정값 또는 기본 경로) */
  readonly filePath: string;
  readonly info: Pick<OsInfo, "platform" | "isWsl">;
  readonly userId: number | null;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** xeon.os resolveBinary로 찾은 절대 경로. 없으면 null */
  readonly resolveTool: (name: "security" | "secret-tool") => Promise<string | null>;
  readonly pathExists: (path: string) => boolean;
  readonly stat?: StatKeyFile;
}

export interface KeySelection {
  readonly provider: KeyProvider;
  /** 파일 폴백을 쓰고 있어 "키가 디스크 파일에 있다" 고지가 필요한가 */
  readonly fileNotice: boolean;
  /** auto가 파일 폴백으로 떨어졌고 사람이 아직 source를 file로 확인하지 않았다(spec §4.7 5번) */
  readonly unconfirmedFallback: boolean;
}

async function osProvider(input: KeySelectInput): Promise<KeyProvider> {
  const platform = input.info.platform;
  switch (platform) {
    case "darwin":
      return createDarwinKeyProvider({ securityPath: await input.resolveTool("security") });
    case "linux":
      return createLinuxKeyProvider({
        secretToolPath: await input.resolveTool("secret-tool"),
        isWsl: input.info.isWsl,
        env: input.env,
        pathExists: input.pathExists,
      });
    case "win32":
      return createWin32KeyProvider();
    default:
      return assertNever(platform, "selectKeyProvider");
  }
}

function fileProvider(input: KeySelectInput): KeyProvider {
  return createFileKeyProvider({
    path: input.filePath,
    uid: input.userId,
    ...(input.stat === undefined ? {} : { stat: input.stat }),
  });
}

/**
 * source가 file이면 파일, keychain이면 OS provider(쓸 수 없으면 sopsKeyEnv가 오류를 낸다),
 * auto면 OS provider의 probe()가 available일 때 그것, 아니면 파일 폴백이다. auto에서 파일로 가면
 * 사람이 한 번 확인할 때까지 쓰지 않는다.
 */
export async function selectKeyProvider(input: KeySelectInput): Promise<KeySelection> {
  if (input.source === "file") {
    return { provider: fileProvider(input), fileNotice: true, unconfirmedFallback: false };
  }
  const os = await osProvider(input);
  if (input.source === "keychain") {
    return { provider: os, fileNotice: false, unconfirmedFallback: false };
  }
  if ((await os.probe()).available) {
    return { provider: os, fileNotice: false, unconfirmedFallback: false };
  }
  return { provider: fileProvider(input), fileNotice: true, unconfirmedFallback: true };
}
