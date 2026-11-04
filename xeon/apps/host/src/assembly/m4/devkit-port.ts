import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNever, err, ok, parseJson, type Result } from "@fresnel/contracts";
import { validateManifest } from "@fresnel/contracts/extensions";
import type {
  ExtDiagnostic,
  ExtInstallResult,
  ExtLoadFailureReason,
} from "@fresnel/contracts/wire";
import type { LoadDiagnostic } from "@fresnel/ext-host";
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

function wireDiagnosticOf(entry: LoadDiagnostic): ExtDiagnostic {
  return {
    severity: entry.severity === "warning" || entry.severity === "info" ? "warning" : "error",
    code: entry.code,
    message: entry.message,
    ...(entry.path === undefined ? {} : { file: entry.path }),
  };
}

/** 파일은 복사됐지만 싣지 못한 결과. 재시작해도 같은 파일을 다시 싣는다 */
function notLoaded(
  placed: { readonly name: string; readonly version: string; readonly location: string },
  reason: ExtLoadFailureReason,
  diagnostics: readonly LoadDiagnostic[],
): ExtInstallResult {
  return {
    ...placed,
    appliesAt: "restart",
    loadFailure: { reason, diagnostics: diagnostics.slice(0, 64).map(wireDiagnosticOf) },
  };
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
      // 같은 이름이 실행 중이면 호출자가 `ext.reload`로 단계 경계에서 바꾼다. 새 이름은 로더가 곧바로 싣는다(X.loading-trust §4.4.4)
      const name = installed.value.name;
      const placed = {
        name,
        version: installed.value.version,
        location: installed.value.location,
      };
      const loader = source.loader();
      if (loader === undefined) {
        return ok(notLoaded(placed, "loader_unavailable", []));
      }
      const current = loader.list().find((info) => info.name === name);
      if (current?.state === "active") {
        return ok({ ...placed, appliesAt: "nextStepBoundary" });
      }
      // 실려 있지 못한 옛 기록(거부, 오류, 꺼짐)은 새 설치본으로 다시 싣는다
      if (current !== undefined) await loader.unload(name);
      const loaded = await loader.loadInstalled(name, deps.env.signal);
      if (loaded.ok) return ok({ ...placed, appliesAt: loaded.value.appliesAt });
      const failure = loaded.error;
      switch (failure.kind) {
        case "already_loaded":
          return ok({ ...placed, appliesAt: "nextStepBoundary" });
        case "safe_mode":
          return ok(notLoaded(placed, "safe_mode", []));
        case "not_found":
          return ok(notLoaded(placed, "not_found", failure.diagnostics));
        case "not_active":
          return ok(notLoaded(placed, failure.state, failure.diagnostics));
        default:
          return assertNever(failure, "LoadInstalledFailure");
      }
    },
    remove: async (name) => {
      const source = deps.extUi;
      if (source === undefined) return noLocation();
      const removed = await removeExtension(name, { extensionsDir: source.extensionsDir });
      if (!removed.ok) return removed;
      // 로더가 실은 확장은 재시작 없이 내려가 목록에서 바로 빠진다(X.loading-trust §4.4.5)
      if ((await source.loader()?.unload(name)) === true) return ok({ name, appliesAt: "now" });
      // 로더가 모르는 확장은 실행 중인 등록의 끄기를 청한다. 단계 경계에서 적용되고, 등록이 없으면 다음 시작부터 빠진다
      const scopes = source.host.registrations().filter((scope) => scope.extension === name);
      for (const scope of scopes) source.host.registration(scope.id)?.disable();
      return ok({ name, appliesAt: scopes.length > 0 ? "nextStepBoundary" : "restart" });
    },
  };
}
