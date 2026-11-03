import type { ExtGetResult, ExtListResult, ExtUiEntry } from "@fresnel/contracts/wire";

// Plugin UI 모델 시험의 공용 입력. 매니페스트는 `ExtensionManifestSchema`를 통과하는 모양이다.

export const HELM_MANIFEST: Readonly<Record<string, unknown>> = {
  schemaVersion: 2,
  name: "helm",
  version: "0.1.0",
  entry: "./src/index.ts",
  plugins: [{ layer: "plugin", hooks: [], readsRecordKinds: ["x.other.note.item"] }],
  userConfig: {
    model: { setting: "ext.helm.model", title: "모델" },
    token: { setting: "ext.helm.token", title: "토큰", sensitive: true },
  },
  methods: [
    { verb: "status", params: {}, result: {}, readOnly: true },
    { verb: "reset", params: {}, result: {}, readOnly: false, approval: true },
    { verb: "save", params: {}, result: {}, readOnly: false },
  ],
};

type RegistrationStatus = ExtGetResult["entry"]["status"];

/** `ext.get` 결과. 기본은 켜진 사용자 확장 helm이다 */
export function extGetOf(
  manifest: Readonly<Record<string, unknown>> = HELM_MANIFEST,
  options: {
    readonly status?: RegistrationStatus;
    readonly safeModeExcluded?: string | null;
  } = {},
): ExtGetResult {
  const status = options.status ?? "enabled";
  return {
    entry: {
      name: "helm",
      displayName: "Helm",
      layer: "plugin",
      isGroup: false,
      version: "0.1.0",
      location: "/home/u/.fresnel/extensions/helm",
      requestedGrade: "user",
      effectiveGrade: "user",
      tier: null,
      status,
      plugins: [{ registrationId: "helm", layer: "plugin", status, inGroup: false }],
      diagnostics: [],
      autoDisabled: false,
      safeModeExcluded: options.safeModeExcluded ?? null,
      hookCount: 0,
    },
    manifest,
    hooks: [],
    bindings: [],
  };
}

/** 화면 항목 하나. 기본은 사용자 확장의 native 페이지다 */
export function uiEntryOf(overrides: Partial<ExtUiEntry> = {}): ExtUiEntry {
  return {
    extension: "helm",
    id: "status",
    placement: "page",
    mode: "native",
    title: "상태",
    state: "ok",
    version: "0.1.0",
    trust: "user",
    issues: [],
    ...overrides,
  };
}

export const APP_ROOT = "/home/u/.fresnel/extensions/helm/ui/graph";
export const APP_DECL: NonNullable<ExtUiEntry["app"]> = {
  root: "./ui/graph",
  entry: "index.html",
  bridge: "^1.0.0",
  reason: "그래프",
};

/** 앱 모드 화면 항목. 검사를 통과해 `appRoot`가 있다 */
export function appEntryOf(overrides: Partial<ExtUiEntry> = {}): ExtUiEntry {
  return uiEntryOf({
    id: "graph",
    mode: "app",
    appRoot: APP_ROOT,
    app: APP_DECL,
    ...overrides,
  });
}

/** `ext.list` 결과 한 줄. 기본은 켜진 확장이다 */
export function extListEntryOf(
  name: string,
  options: {
    readonly status?: RegistrationStatus;
    readonly safeModeExcluded?: string | null;
  } = {},
): ExtListResult["extensions"][number] {
  return {
    ...extGetOf().entry,
    name,
    status: options.status ?? "enabled",
    safeModeExcluded: options.safeModeExcluded ?? null,
  };
}
