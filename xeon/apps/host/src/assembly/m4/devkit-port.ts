import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import { validateManifest } from "@fresnel/contracts/extensions";
import type { ExtInstallResult } from "@fresnel/contracts/wire";
import type { DevkitError, LinkInput } from "@fresnel/contracts/services";
import {
  installExtension,
  previewInstall,
  KIND_CATALOG,
  locateTemplateDirs,
  MANIFEST_PATH,
  packExtension,
  removeExtension,
  scaffoldExtension,
  validateCompositionReport,
  validateExtensionDir,
  type TemplateDirs,
} from "@fresnel/plugin-builder";
import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import { hostResourceDir } from "../../state-paths.ts";
import type { M4PortDeps } from "./deps.ts";

// Devkit 포트 구현(L3.authoring.spec §3.3). 파일 작업은 `@fresnel/plugin-builder`가 하고 이 파일은 호스트 상태(설치된 확장 이름,
// 사용자 확장 위치, 버전 기록, 등록 끄기)와 이어 준다. 사용자 확장 위치가 없으면(`extUi` 없음) 설치와 지우기는 `io`로 거절한다.

export interface DevkitPortOptions {
  /** 템플릿 폴더. 생략하면 환경 변수와 자원 폴더, 소스 저장소 순으로 찾는다. 못 찾으면 null */
  readonly templates?: TemplateDirs | null;
}

function noLocation(): Result<never, DevkitError> {
  return err({ kind: "io", message: "the user extensions location is not available" });
}

/** 설치 위치에 있는 지금 설치본의 이름 확인에 쓰는 매니페스트 이름과 버전. 읽을 수 없으면 null */
async function manifestIdentity(
  root: string,
): Promise<{ readonly name: string; readonly version: string; readonly text: string } | null> {
  const text = await readFile(join(root, MANIFEST_PATH), "utf8").then(
    (value) => value,
    () => null,
  );
  if (text === null) return null;
  const json = parseJson(text);
  if (!json.ok) return null;
  const manifest = validateManifest(json.value).manifest;
  return manifest === undefined ? null : { name: manifest.name, version: manifest.version, text };
}

export function createDevkitPort(deps: M4PortDeps, options: DevkitPortOptions = {}): DevkitPort {
  const templates = (): TemplateDirs | null =>
    options.templates !== undefined
      ? options.templates
      : locateTemplateDirs(process.env, hostResourceDir());
  const installedNames = (): readonly string[] =>
    deps.extUi
      ?.loader()
      ?.list()
      .map((info) => info.name) ?? [];

  return {
    kinds: () => Promise.resolve(KIND_CATALOG),
    scaffold: (input) => {
      const found = templates();
      if (found === null)
        return Promise.resolve(err({ kind: "io", message: "the extension templates are missing" }));
      return scaffoldExtension(input, { templates: found, installedNames: installedNames() });
    },
    validate: (dir) => validateExtensionDir(dir),
    validateComposition: (params) => ({
      issues: validateCompositionReport(params.composition, params.plugins).issues.flatMap(
        (found) =>
          found.severity === "info"
            ? []
            : [
                {
                  severity: found.severity,
                  code: found.code,
                  path: found.path,
                  message: found.message,
                },
              ],
      ),
    }),
    pack: (input) => packExtension(input),
    installPreview: async (input) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      return previewInstall(input, { extensionsDir: source.extensionsDir });
    },
    install: async (input) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      // 안전 모드와 managed 잠금은 신뢰 검사 앞에서 거절한다. 설치본은 평소 로더와 신뢰 경로로만 읽힌다
      if (source.installGate.safeMode())
        return err({ kind: "safe_mode_active", message: "install is refused in safe mode" });
      const incoming = await manifestIdentity(input.source);
      if (incoming !== null && source.installGate.managedLocked(incoming.name))
        return err({
          kind: "managed_locked",
          message: `${incoming.name} is locked by the managed scope`,
        });
      // 같은 이름의 설치본이 있으면 지우기 전에 버전 기록에 남겨 되돌릴 수 있게 한다(HS-108). 첫 설치는 남기지 않는다
      if (incoming !== null) {
        const location = join(source.extensionsDir, incoming.name);
        const current = await manifestIdentity(location);
        if (current !== null) {
          await source.history.record({
            name: current.name,
            version: current.version,
            source: "authored",
            extensionDir: location,
            manifestText: current.text,
            stateSchemaVersion: source.stateSchemaVersion(current.name),
          });
        }
      }
      const installed = await installExtension(input satisfies LinkInput, {
        extensionsDir: source.extensionsDir,
      });
      if (!installed.ok) return installed;
      // 실행 중인 같은 이름은 호출자가 `ext.reload`로 단계 경계에서 바꾼다. 새 이름은 로더가 싣지 않으므로 다음 시작부터다
      const name = installed.value.name;
      const running =
        source
          .loader()
          ?.list()
          .some((info) => info.name === name) === true;
      const result: ExtInstallResult = {
        name,
        version: installed.value.version,
        location: installed.value.location,
        appliesAt: running ? "nextStepBoundary" : "restart",
      };
      return ok(result);
    },
    remove: async (name) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      const removed = await removeExtension(name, { extensionsDir: source.extensionsDir });
      if (!removed.ok) return removed;
      // 실행 중인 등록은 끄기를 청한다. 단계 경계에서 적용된다. 등록이 없으면 다음 시작부터 빠진다
      const scopes = source.host.registrations().filter((scope) => scope.extension === name);
      for (const scope of scopes) source.host.registration(scope.id)?.disable();
      return ok({ name, appliesAt: scopes.length > 0 ? "nextStepBoundary" : "restart" });
    },
  };
}
