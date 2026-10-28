import type {
  ExtensionManifest,
  LoaderFs,
  LoaderPaths,
  ScopeSetup,
  TrustStoreBackend,
} from "@xeon/contracts/extensions";
import {
  createExtensionLoader,
  type BuiltinExtensionModule,
  type ExtensionLoader,
  type LoaderDeps,
  type LoaderSettingsSource,
  type LoadOptions,
} from "../../../src/loading-trust/index.ts";
import type { OperationsPolicy } from "../../../src/operations/index.ts";
import { type ManifestInput, makeManifest } from "../../primitives/fixtures/support.ts";
import {
  createOperationsHarness,
  type HarnessOptions,
  type OperationsHarness,
} from "../../operations/support/harness.ts";

const EMPTY_FS: LoaderFs = {
  readText: () => Promise.resolve(null),
  listDir: () => Promise.resolve(null),
  exists: () => Promise.resolve(false),
  realpath: (path) => Promise.resolve(path),
};

const PATHS: LoaderPaths = { userDir: "/home/test/.xeon", managedDir: null, homeDir: "/home/test" };

const TRUST_BACKEND: TrustStoreBackend = {
  read: () => Promise.resolve({ ok: true, text: null }),
  update: () => Promise.resolve(),
};

export interface ModuleInput extends ManifestInput {
  readonly essential?: boolean;
  readonly trustLevel?: "builtin" | "user" | "project" | "untrusted";
  readonly extraManifest?: Readonly<Record<string, unknown>>;
  readonly userConfig?: ExtensionManifest["userConfig"];
  readonly manifest?: ExtensionManifest;
}

/** 내장 모듈 하나. setup은 주 scope의 setup이다 */
export function moduleOf(
  input: ModuleInput,
  setup: ScopeSetup<never> = () => {},
): BuiltinExtensionModule {
  const base = input.manifest ?? makeManifest(input);
  const manifest: ExtensionManifest = {
    ...base,
    ...(input.userConfig === undefined ? {} : { userConfig: input.userConfig }),
    ...(input.trustLevel === undefined ? {} : { trust: { level: input.trustLevel } }),
    ...input.extraManifest,
  };
  return {
    manifest,
    extension: ({ scope }) => {
      scope(manifest.name, {}, setup);
    },
    ...(input.essential === undefined ? {} : { essential: input.essential }),
  };
}

/** 외부 확장 시험에서 바꾸는 로더 의존. 나머지는 빈 파일 시스템과 고정 경로다 */
export type LoaderOverrides = Partial<
  Pick<LoaderDeps, "fs" | "paths" | "trustBackend" | "prompter" | "sdkModules" | "emitProjectTrust">
>;

export interface LoaderHarness extends OperationsHarness {
  readonly loader: ExtensionLoader;
  readonly options: (
    builtins: readonly BuiltinExtensionModule[],
    extra?: Partial<LoadOptions>,
  ) => LoadOptions;
  readonly settings: { enabled: Map<string, boolean>; values: Set<string> };
}

export async function createLoaderHarness(
  options: HarnessOptions & {
    readonly policy?: Pick<OperationsPolicy, "admit" | "forget">;
    readonly core?: LoaderDeps["coreCapabilities"];
    readonly loader?: LoaderOverrides;
  } = {},
): Promise<LoaderHarness> {
  const harness = await createOperationsHarness(options);
  const settings = { enabled: new Map<string, boolean>(), values: new Set<string>() };
  const source: LoaderSettingsSource = {
    enabled: (name) => settings.enabled.get(name),
    hasValue: (key) => settings.values.has(key),
  };
  const loader = createExtensionLoader({
    host: harness.t.host,
    policy: options.policy ?? harness.policy,
    fs: options.loader?.fs ?? EMPTY_FS,
    paths: options.loader?.paths ?? PATHS,
    trustBackend: options.loader?.trustBackend ?? TRUST_BACKEND,
    ...(options.loader?.prompter === undefined ? {} : { prompter: options.loader.prompter }),
    ...(options.loader?.sdkModules === undefined ? {} : { sdkModules: options.loader.sdkModules }),
    ...(options.loader?.emitProjectTrust === undefined
      ? {}
      : { emitProjectTrust: options.loader.emitProjectTrust }),
    clock: { now: harness.t.timers.now },
    settings: source,
    ...(options.core === undefined ? {} : { coreCapabilities: options.core }),
  });
  return {
    ...harness,
    loader,
    settings,
    options: (builtins, extra = {}) => ({
      builtins,
      cwd: "/work",
      mode: "headless",
      signal: new AbortController().signal,
      ...extra,
    }),
  };
}
