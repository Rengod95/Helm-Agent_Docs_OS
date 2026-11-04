import { err, ok } from "@fresnel/contracts";
import type { ExtensionUnit } from "@fresnel/ext-host";
import type { DevkitService } from "@fresnel/contracts/services";
import { createAuthoringGroup, type AuthoringDeps } from "@fresnel/plugin-builder";
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
  /** 개발 모드 판정(`l3.authoring.devMode`의 현재 값). 조립 루트가 설정 값을 읽어 준다. 그룹은 도구를 부를 때마다 부른다 */
  readonly devMode: () => boolean;
}

const NOT_READY = { kind: "io", message: "the devkit is not ready yet" } as const;

/**
 * wire 포트를 서비스 계약으로 맞춘다. `replay`와 `testRun`은 wire `ext.test.run`과 같은 포트 호출이다.
 * `replay`의 보고는 와이어 기록(`ext.test.list`)에서 이 실행의 ID로 찾아 돌려준다(`ext.test.run`은 ID만 돌려준다).
 */
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
    testRun: async (input) => {
      const found = port();
      if (found === undefined) return err(NOT_READY);
      const run = await found.testRun({
        kind: "testRun",
        target: input.target,
        options: {
          ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
          ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
        },
      });
      if (!run.ok) return run;
      if (run.value.threadId === null) {
        return err({ kind: "io", message: "the test run did not open a thread" });
      }
      return ok({ threadId: run.value.threadId });
    },
    replay: async (input) => {
      const found = port();
      if (found === undefined) return err(NOT_READY);
      const run = await found.testRun({
        kind: "replay",
        target: input.target,
        ...(input.maxCommits === undefined ? {} : { options: { maxCommits: input.maxCommits } }),
      });
      if (!run.ok) return run;
      const listed = await found.testList();
      if (!listed.ok) return listed;
      const report =
        listed.value.tests.find((record) => record.testId === run.value.testId)?.replay ?? null;
      if (report === null) return err({ kind: "io", message: "the replay report is missing" });
      return ok(report);
    },
    pack: async (input) => (await port()?.pack(input)) ?? err(NOT_READY),
    link: async (input) => {
      const installed = await port()?.install(input);
      if (installed === undefined) return err(NOT_READY);
      if (!installed.ok) return installed;
      const { name, version, location } = installed.value;
      return ok({ name, version, location });
    },
  };
}

/** 그룹이 받는 의존. `devMode`는 함수 그대로 넘겨 설정을 바꾸면 다음 도구 호출부터 따라간다 */
export function authoringDepsOf(wiring: AuthoringWiring): AuthoringDeps {
  return { devkit: devkitServiceOf(wiring), devMode: wiring.devMode };
}

export function authoringUnit(wiring: AuthoringWiring, loadIndex: number): ExtensionUnit {
  const module = createAuthoringGroup(authoringDepsOf(wiring));
  return { manifest: module.manifest, entry: module.entry, loadIndex, builtin: true };
}
