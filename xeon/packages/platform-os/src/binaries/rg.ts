import { attemptAsync, err, ok } from "@xeon/contracts";
import type { RunCommand } from "../proc.ts";
import type { BundledSource } from "./resolve.ts";
import { findVersion } from "./semver.ts";

// OS-11, L0.os.spec §3.6 소스 실행: `@vscode/ripgrep`이 제공하는 경로를 번들 rg로 쓴다.
// 설치 때 npm 락파일의 무결성 해시로 검증되므로 실행 시 해시 검사는 하지 않는다(postinstall 다운로드 없음).
// 플랫폼 패키지(@vscode/ripgrep-<os>-<arch>)가 없으면 그 모듈이 import 때 던진다. 그 경우는 번들이 없는 것으로 보고 시스템 rg로 간다.

export interface RipgrepSourceDeps {
  readonly run: RunCommand;
  /** `rgPath`를 주는 모듈 불러오기. 기본은 `@vscode/ripgrep`. 시험이 대신 넣는다 */
  readonly load?: () => Promise<{ readonly rgPath: string }>;
}

function loadVscodeRipgrep(): Promise<{ readonly rgPath: string }> {
  return import("@vscode/ripgrep");
}

export function createRipgrepSource(deps: RipgrepSourceDeps): BundledSource {
  const load = deps.load ?? loadVscodeRipgrep;
  return async (name, signal) => {
    if (name !== "rg") return ok(undefined);
    const loaded = await attemptAsync(load);
    // 플랫폼 패키지가 없거나 모듈을 읽지 못했다. 번들 없음이다
    if (!loaded.ok) return ok(undefined);
    const path = loaded.value.rgPath;
    const out = await deps.run([path, "--version"], { signal });
    if (!out.ok) {
      if (out.error.kind === "cancelled") return err({ kind: "cancelled" });
      return err({ kind: "version_unreadable", name, path });
    }
    const version = out.value.exitCode === 0 ? findVersion(out.value.stdout) : undefined;
    if (version === undefined) return err({ kind: "version_unreadable", name, path });
    return ok({ path, version });
  };
}
