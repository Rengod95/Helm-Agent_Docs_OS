import { join } from "node:path";
import { attemptAsync, err, ok, parseJson, type Result } from "@xeon/contracts";
import { validateManifest } from "@xeon/contracts/extensions";
import { MANIFEST_RELATIVE_PATH } from "./discover.ts";
import { compareVersions } from "./semver.ts";

/**
 * 기본 플러그인 설치가 쓰는 파일 접근. 복사에는 쓰기가 필요한데 `LoaderFs`는 읽기 전용이고 X는 L0를 import하지 않으므로
 * 조립 루트가 L0.os로 구현해 넘긴다 [미결: 정본은 F.extensions.spec §3.2.1 로더 포트여야 한다]
 */
export interface PluginInstallFs {
  readText(path: string): Promise<string | null>;
  /** 없으면 null */
  listDir(
    path: string,
  ): Promise<
    readonly { readonly name: string; readonly kind: "file" | "dir" | "symlink" }[] | null
  >;
  readBytes(path: string): Promise<Uint8Array>;
  /** 부모 디렉터리가 없으면 만든다 */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** 중간 디렉터리까지 만든다. 이미 있어도 오류가 아니다 */
  makeDir(path: string): Promise<void>;
  /** 디렉터리와 그 아래를 지운다. 없어도 오류가 아니다 */
  removeDir(path: string): Promise<void>;
  /** `from`을 `to`로 옮긴다. `to`는 없어야 한다 */
  rename(from: string, to: string): Promise<void>;
}

export interface DefaultPluginInstallInput {
  readonly fs: PluginInstallFs;
  /** 릴리즈에 든 기본 플러그인 디렉터리. `.xeon-plugin/plugin.json`이 있어야 한다 */
  readonly source: string;
  /** `<userDir>/extensions/<name>/` */
  readonly destination: string;
}

export type DefaultPluginInstallOutcome =
  /** 대상이 없어서 처음 복사했다 */
  | { readonly action: "installed"; readonly version: string }
  /** 번들 버전이 더 높거나 설치본의 매니페스트를 읽을 수 없어 교체했다 */
  | {
      readonly action: "replaced";
      readonly version: string;
      /** 읽을 수 있었던 이전 버전. 설치본이 손상이었으면 undefined */
      readonly previousVersion?: string;
    }
  /** 설치본이 번들과 같거나 더 높아 그대로 둔다 */
  | { readonly action: "kept"; readonly version: string; readonly installedVersion: string };

export type DefaultPluginInstallError =
  /** 번들 쪽 매니페스트를 읽거나 검증하지 못했다. 릴리즈가 잘못된 것이다 */
  | { readonly kind: "source_invalid"; readonly message: string }
  | { readonly kind: "io"; readonly message: string; readonly cause: unknown };

async function readVersion(
  fs: PluginInstallFs,
  root: string,
): Promise<Result<string | undefined, { readonly cause: unknown }>> {
  const text = await attemptAsync(() => fs.readText(join(root, MANIFEST_RELATIVE_PATH)));
  if (!text.ok) return err({ cause: text.error.cause });
  if (text.value === null) return ok(undefined);
  const json = parseJson(text.value);
  if (!json.ok) return ok(undefined);
  const checked = validateManifest(json.value);
  return ok(checked.manifest?.version);
}

async function copyTree(fs: PluginInstallFs, from: string, to: string): Promise<void> {
  await fs.makeDir(to);
  const entries = (await fs.listDir(from)) ?? [];
  await Promise.all(
    entries.map(async (entry) => {
      const source = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.kind === "dir") {
        await copyTree(fs, source, target);
      } else {
        // 심볼릭 링크는 가리키는 내용을 복사한다. 번들에는 링크를 두지 않는 것이 규칙이다
        await fs.writeBytes(target, await fs.readBytes(source));
      }
    }),
  );
}

/**
 * 기본 플러그인(Helm)을 사용자 확장 위치에 설치한다(M3-REQ-110, D-M3-01 c). 첫 실행에는 복사하고, 앱을 갱신해
 * 번들 버전이 설치본보다 높으면 디렉터리째 교체한다. 같거나 낮은 설치본은 건드리지 않는다. 설치본의
 * 매니페스트가 없거나 읽을 수 없으면 손상으로 보고 교체한다. 복사는 임시 디렉터리에 끝낸 뒤 옮긴다. 복사 도중
 * 실패하면 이전 설치본이 그대로 남고, 반쯤 복사된 대상 디렉터리는 생기지 않는다
 */
export async function installDefaultPlugin(
  input: DefaultPluginInstallInput,
): Promise<Result<DefaultPluginInstallOutcome, DefaultPluginInstallError>> {
  const { fs, source, destination } = input;
  const bundled = await readVersion(fs, source);
  if (!bundled.ok) {
    return err({ kind: "io", message: `cannot read ${source}`, cause: bundled.error.cause });
  }
  if (bundled.value === undefined) {
    return err({
      kind: "source_invalid",
      message: `${source}/${MANIFEST_RELATIVE_PATH} is missing or is not a valid manifest`,
    });
  }
  const version = bundled.value;
  const installed = await readVersion(fs, destination);
  if (!installed.ok) {
    return err({ kind: "io", message: `cannot read ${destination}`, cause: installed.error.cause });
  }
  const installedVersion = installed.value;
  if (installedVersion !== undefined) {
    const order = compareVersions(installedVersion, version);
    if (order !== undefined && order >= 0) {
      return ok({ action: "kept", version, installedVersion });
    }
  }
  const existing = await attemptAsync(() => fs.listDir(destination));
  if (!existing.ok) {
    return err({ kind: "io", message: `cannot read ${destination}`, cause: existing.error.cause });
  }
  const staging = `${destination}.installing`;
  const swapped = await attemptAsync(async () => {
    await fs.removeDir(staging);
    await copyTree(fs, source, staging);
    await fs.removeDir(destination);
    await fs.rename(staging, destination);
  });
  if (!swapped.ok) {
    await attemptAsync(() => fs.removeDir(staging));
    return err({
      kind: "io",
      message: `cannot install the default plugin into ${destination}`,
      cause: swapped.error.cause,
    });
  }
  if (existing.value === null) return ok({ action: "installed", version });
  return ok({
    action: "replaced",
    version,
    ...(installedVersion === undefined ? {} : { previousVersion: installedVersion }),
  });
}
