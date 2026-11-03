import { err } from "@fresnel/contracts";
import type { ExtensionUnit } from "@fresnel/ext-host";
import type { DevkitService } from "@fresnel/contracts/services";
import { createAuthoringGroup } from "@fresnel/plugin-builder";
import type { DevkitPort } from "../handlers/m4/devkit.ts";

// 제작 그룹 `authoring`(L3.authoring.spec §3.1)을 내장 그룹으로 싣는다. 기본은 꺼짐이다([결정: 2026-11-01 사용자]).
// 그룹이 쓰는 서비스 `fresnel.devkit`은 wire 처리기와 같은 포트(`m4.devkit`)를 어댑터로 감싼 것이라 에이전트와 화면이 같은 검사와 같은 뼈대를 얻는다.
// 포트는 엔진 포트가 만들어진 뒤에야 있으므로 쓸 때 읽는다. 조립 루트 코드(DR-14 예외 2).

/** 제작 그룹을 싣는가. 기본 그룹을 끄거나(`defaultGroups: false`) 안전 모드면 싣지 않는다(spec §5 안전 모드) */
export function authoringLoaded(options: {
  readonly defaultGroups: boolean | undefined;
  readonly safeMode: boolean | undefined;
}): boolean {
  return options.defaultGroups !== false && options.safeMode !== true;
}

export interface AuthoringWiring {
  /** wire 제작 포트. 엔진 포트가 만들어지기 전에는 undefined */
  readonly devkit: () => DevkitPort | undefined;
}

const NOT_READY = { kind: "io", message: "the devkit is not ready yet" } as const;

/** wire 포트를 서비스 계약으로 맞춘다. 시험 실행과 replay는 측정 계획이 wire를 더하기 전까지 거절한다 */
export function devkitServiceOf(wiring: AuthoringWiring): DevkitService {
  const port = () => wiring.devkit();
  return {
    kinds: async () => (await port()?.kinds()) ?? [],
    scaffold: async (input) => (await port()?.scaffold(input)) ?? err(NOT_READY),
    validate: async (dir) => (await port()?.validate(dir)) ?? err(NOT_READY),
    validateComposition: (composition) => {
      const found = port()?.validateComposition({ composition });
      const issues = found?.issues ?? [];
      return { ok: !issues.some((issue) => issue.severity === "error"), issues };
    },
    testRun: () =>
      Promise.resolve(
        err({ kind: "io", message: "Test runs are not available from the authoring group yet" }),
      ),
    replay: () =>
      Promise.resolve(
        err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
      ),
    pack: async (input) => (await port()?.pack(input)) ?? err(NOT_READY),
    link: async (input) => (await port()?.install(input)) ?? err(NOT_READY),
  };
}

export function authoringUnit(wiring: AuthoringWiring, loadIndex: number): ExtensionUnit {
  const module = createAuthoringGroup({ devkit: devkitServiceOf(wiring), devMode: () => false });
  return { manifest: module.manifest, entry: module.entry, loadIndex, builtin: true };
}
