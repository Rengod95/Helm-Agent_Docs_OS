import { join } from "node:path";
import type * as RealContractsModule from "@fresnel/contracts";
import { CapabilityError } from "@fresnel/contracts/capabilities";
import type { SdkModules } from "../../../src/loading-trust/index.ts";
import type * as RealTypeboxModule from "typebox";
import { putFile } from "./real-fs.ts";

// 지정자가 아니라 파일 경로로 불러온다. 같은 프로세스에서 다른 시험 파일(격리 시험의 호스트)이 먼저 SDK를 등록했으면
// (파일 순서는 기기마다 다르다. macOS는 이름순, Linux는 디렉터리 순) 지정자 `@fresnel/contracts`와 `typebox`는 가상 모듈 껍데기를
// 돌려주고, 그 껍데기는 X가 등록한 실제 모듈 객체와 달라 등록이 `conflict`가 된다
const contracts: typeof RealContractsModule = await import(
  Bun.resolveSync("@fresnel/contracts", import.meta.dir)
);
const typebox: typeof RealTypeboxModule = await import(Bun.resolveSync("typebox", import.meta.dir));

/** 호스트 쪽 `@fresnel/orchestration-sdk` 대역. 플러그인 번들이 import하면 같은 객체를 받아야 한다 */
export const fakeOrchestrationSdk: {
  readonly marker: symbol;
  readonly seen: string[];
  record(value: string): void;
  /** 호스트의 `CapabilityError`. 하위 경로 지정자로 받은 클래스가 같은 값인지 플러그인이 비교한다 */
  readonly capabilityError: unknown;
  /** 플러그인이 받은 typebox와 contracts가 호스트 것과 같은 값인지 기록한다 */
  verify(name: string, type: unknown, ok: unknown): void;
} = {
  marker: Symbol("host-orchestration-sdk"),
  seen: [],
  capabilityError: CapabilityError,
  record(value) {
    fakeOrchestrationSdk.seen.push(value);
  },
  verify(name, type, ok) {
    fakeOrchestrationSdk.seen.push(
      `${name}:shared:${String(type === typebox.Type)}:${String(ok === contracts.ok)}`,
    );
  },
};

/** 프로세스 전역 등록이라 모든 시험이 같은 객체를 넘긴다 */
export const SDK: SdkModules = {
  "@fresnel/contracts": contracts,
  "@fresnel/orchestration-sdk": fakeOrchestrationSdk,
  typebox,
};

export interface PluginFiles {
  readonly name: string;
  readonly version?: string;
  /** 루트 플러그인(id 없음)의 hooks. 생략하면 `boundary.settle.after` 하나 */
  readonly hooks?: readonly string[];
  readonly trustLevel?: string;
  /** 루트 플러그인의 층. 생략하면 `plugin` */
  readonly layer?: string;
  /** 참이면 플러그인 그룹(`orchestration: {}`) */
  readonly group?: boolean;
  /** 엔트리 파일 본문. 생략하면 `on` 핸들러 하나를 등록하는 기본 엔트리다 */
  readonly entry?: string;
  /** 매니페스트 `ui`(JSON 값). 생략하면 없다. 화면 파일은 호출자가 따로 쓴다 */
  readonly ui?: unknown;
  /** 매니페스트 `methods`(JSON 값). 생략하면 없다 */
  readonly methods?: unknown;
  /** 루트 플러그인의 `replaces`(내장 도구 대체 선언). 생략하면 없다 */
  readonly replaces?: readonly string[];
  /** 루트 플러그인의 `drives`. 참이면 매니페스트에 drives가 선언된다(격리 판정의 drives 행) */
  readonly drives?: boolean;
  /** 매니페스트 `isolation`. 생략하면 없다 */
  readonly isolation?: "none" | "process";
  /** 매니페스트 `defaultEnabled`(기본 켜짐). 생략하면 없다(기본 켜짐으로 본다) */
  readonly defaultEnabled?: boolean;
}

/** `boundary.settle.after`에 `on` 핸들러를 걸고 호출 때 `<이름>:fired`를 기록하는 엔트리 */
function defaultEntry(name: string): string {
  // 플러그인 본문은 문자열이다. 층 검사가 import로 읽지 않게 지정자를 조립한다
  const kitSpecifier = ["@fresnel", "orchestration-sdk"].join("/");
  return `import * as kit from "${kitSpecifier}";
import { ok } from "@fresnel/contracts";
import { Type } from "typebox";
export const extension = ({ register }) => {
  register(${JSON.stringify(name)}, {}, (g) => {
    kit.verify(${JSON.stringify(name)}, Type, ok);
    g.on("boundary.settle.after", () => {
      kit.record(${JSON.stringify(name)} + ":fired");
    });
  });
};
`;
}

/** `<extensionsDir>/<dir>/` 아래에 매니페스트와 엔트리를 쓴다 */
export async function writePlugin(
  extensionsDir: string,
  dir: string,
  files: PluginFiles,
): Promise<string> {
  const root = join(extensionsDir, dir);
  const manifest = {
    schemaVersion: 2,
    name: files.name,
    version: files.version ?? "1.0.0",
    entry: "./src/index.ts",
    plugins: [
      {
        layer: files.layer ?? "plugin",
        hooks: files.hooks ?? ["boundary.settle.after"],
        ...(files.replaces === undefined ? {} : { replaces: [...files.replaces] }),
        ...(files.drives === true ? { drives: true } : {}),
      },
    ],
    ...(files.group === true ? { orchestration: {} } : {}),
    ...(files.trustLevel === undefined ? {} : { trust: { level: files.trustLevel } }),
    ...(files.ui === undefined ? {} : { ui: files.ui }),
    ...(files.methods === undefined ? {} : { methods: files.methods }),
    ...(files.isolation === undefined ? {} : { isolation: files.isolation }),
    ...(files.defaultEnabled === undefined ? {} : { defaultEnabled: files.defaultEnabled }),
  };
  await putFile(join(root, ".fresnel-plugin", "plugin.json"), JSON.stringify(manifest, null, 2));
  await putFile(join(root, "src", "index.ts"), files.entry ?? defaultEntry(files.name));
  return root;
}
