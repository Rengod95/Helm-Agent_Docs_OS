// 번들 사이드카(fresnel CLI 겸 엔진) 위치와 개발 덮어쓰기. engine.rs의 SIDECAR_NAME·SIDECAR_ARGS·parse_dev_override와
// secret_entry.rs의 override_prefix를 옮긴다(ADR-0014: 사이드카 바이너리가 곧 fresnel CLI다).
import { existsSync } from "node:fs";
import path from "node:path";

/** `scripts/package.ts`의 extraResource와 `dist/sidecar`의 파일 이름 앞부분 */
export const SIDECAR_NAME = "fresnel";
/** 사이드카를 엔진으로 띄울 때의 인자. 개발 덮어쓰기 인자가 이것으로 끝나야 쓸 수 있다 */
export const SIDECAR_ARGS = ["host", "--stdio"] as const;

/** `<플랫폼>-<아키텍처>`에서 Tauri 목표 삼중항으로 가는 표. 여기 없는 조합은 사이드카가 없다 */
const TRIPLES: ReadonlyMap<string, string> = new Map([
  ["darwin-arm64", "aarch64-apple-darwin"],
  ["darwin-x64", "x86_64-apple-darwin"],
  ["linux-x64", "x86_64-unknown-linux-gnu"],
  ["linux-arm64", "aarch64-unknown-linux-gnu"],
  ["win32-x64", "x86_64-pc-windows-msvc"],
]);

export interface SidecarInputs {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** ctx.paths.resources. 패키지 앱이면 Resources, 개발 중이면 셸 패키지 폴더 */
  readonly resources: string;
  /** 파일 존재 검사. 시험이 바꾼다(기본은 실제 파일 시스템) */
  readonly exists?: (file: string) => boolean;
}

export interface SidecarCandidates {
  /** 패키지 앱: `<resources>/fresnel-<삼중항>` */
  readonly bundled: string;
  /** 개발: `<resources>/../desktop/dist/sidecar/fresnel-<삼중항>` */
  readonly dev: string;
}

/** 사이드카 후보 두 곳의 경로. 지원 밖 OS와 아키텍처면 null. 파일 시스템을 보지 않는 순수 함수다 */
export function sidecarCandidates(
  input: Pick<SidecarInputs, "platform" | "arch" | "resources">,
): SidecarCandidates | null {
  const triple = TRIPLES.get(`${input.platform}-${input.arch}`);
  if (triple === undefined) return null;
  const file = `${SIDECAR_NAME}-${triple}${input.platform === "win32" ? ".exe" : ""}`;
  return {
    bundled: path.join(input.resources, file),
    dev: path.join(input.resources, "..", "desktop", "dist", "sidecar", file),
  };
}

export interface SidecarResolution {
  /** 패키지 앱의 Resources에 사이드카가 있다. 있으면 개발 덮어쓰기를 쓰지 않는다(Rust 릴리스 빌드와 같다) */
  readonly bundled: boolean;
  /** 실행할 사이드카 파일. 패키지 쪽을 먼저 보고 없으면 개발 쪽을 본다. 둘 다 없거나 지원 밖이면 null */
  readonly file: string | null;
}

/**
 * 실행할 사이드카를 고른다. 패키지 앱의 Resources를 먼저 보고, 없으면 개발 폴더를 본다.
 * 엔진 supervisor와 키 등록이 같은 함수를 쓴다.
 */
export function resolveSidecar(inputs: SidecarInputs): SidecarResolution {
  const candidates = sidecarCandidates(inputs);
  if (candidates === null) return { bundled: false, file: null };
  const exists = inputs.exists ?? existsSync;
  if (exists(candidates.bundled)) return { bundled: true, file: candidates.bundled };
  if (exists(candidates.dev)) return { bundled: false, file: candidates.dev };
  return { bundled: false, file: null };
}

export interface DevOverride {
  /** `FRESNEL_DESKTOP_ENGINE_BIN` */
  readonly bin: string;
  /** `FRESNEL_DESKTOP_ENGINE_ARGS`를 공백으로 나눈 것 */
  readonly args: readonly string[];
}

/**
 * 개발 덮어쓰기를 읽는다. 실행 파일 이름이 없거나 비면 덮어쓰지 않는다(null). 인자는 공백으로 나눈다.
 * Rust는 디버그 빌드에서만 읽는다. 셸 문맥에는 그 구분이 없어서 `resolveSidecar`로 패키지 사이드카 유무를 보고 거른다.
 */
export function devOverrideOf(env: NodeJS.ProcessEnv): DevOverride | null {
  const bin = env["FRESNEL_DESKTOP_ENGINE_BIN"];
  if (bin === undefined || bin === "") return null;
  const args = (env["FRESNEL_DESKTOP_ENGINE_ARGS"] ?? "").split(/\s+/u).filter((arg) => arg !== "");
  return { bin, args };
}

/**
 * 덮어쓴 인자가 `... host --stdio`로 끝나면 그 앞부분을 돌려준다. 그 모양이 아니면 null이고 번들 사이드카를 쓴다.
 * 호출자는 돌려준 앞부분 뒤에 `secret <동작> <이름>`을 붙여서 띄운다.
 */
export function overridePrefix(args: readonly string[]): string[] | null {
  const count = args.length;
  if (count < 2) return null;
  if (args[count - 2] !== SIDECAR_ARGS[0] || args[count - 1] !== SIDECAR_ARGS[1]) return null;
  return args.slice(0, count - 2);
}
