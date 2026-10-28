import { join } from "node:path";
import * as contracts from "@xeon/contracts";
import type { SdkModules } from "../../../src/loading-trust/index.ts";
import * as typebox from "typebox";
import { putFile } from "./real-fs.ts";

/** 호스트 쪽 `@xeon/group-kit` 대역. 플러그인 번들이 import하면 같은 객체를 받아야 한다 */
export const fakeGroupKit: {
  readonly marker: symbol;
  readonly seen: string[];
  record(value: string): void;
  /** 플러그인이 받은 typebox와 contracts가 호스트 것과 같은 값인지 기록한다 */
  verify(name: string, type: unknown, ok: unknown): void;
} = {
  marker: Symbol("host-group-kit"),
  seen: [],
  record(value) {
    fakeGroupKit.seen.push(value);
  },
  verify(name, type, ok) {
    fakeGroupKit.seen.push(
      `${name}:shared:${String(type === typebox.Type)}:${String(ok === contracts.ok)}`,
    );
  },
};

/** 프로세스 전역 등록이라 모든 시험이 같은 객체를 넘긴다 */
export const SDK: SdkModules = {
  "@xeon/contracts": contracts,
  "@xeon/group-kit": fakeGroupKit,
  typebox,
};

export interface PluginFiles {
  readonly name: string;
  readonly version?: string;
  readonly points?: readonly string[];
  readonly trustLevel?: string;
  readonly layer?: string;
  readonly kind?: string;
  /** 엔트리 파일 본문. 생략하면 `on` 핸들러 하나를 등록하는 기본 엔트리다 */
  readonly entry?: string;
}

/** `boundary.settle.after`에 `on` 핸들러를 걸고 호출 때 `<이름>:fired`를 기록하는 엔트리 */
function defaultEntry(name: string): string {
  // 플러그인 본문은 문자열이다. 층 검사가 import로 읽지 않게 지정자를 조립한다
  const kitSpecifier = ["@xeon", "group-kit"].join("/");
  return `import * as kit from "${kitSpecifier}";
import { ok } from "@xeon/contracts";
import { Type } from "typebox";
export const extension = ({ scope }) => {
  scope(${JSON.stringify(name)}, {}, (g) => {
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
    schemaVersion: 1,
    name: files.name,
    version: files.version ?? "1.0.0",
    layer: files.layer ?? "plugin",
    kind: files.kind ?? "plugin",
    entry: "./src/index.ts",
    points: files.points ?? ["boundary.settle.after"],
    usesDrive: false,
    ...(files.trustLevel === undefined ? {} : { trust: { level: files.trustLevel } }),
  };
  await putFile(join(root, ".xeon-plugin", "plugin.json"), JSON.stringify(manifest, null, 2));
  await putFile(join(root, "src", "index.ts"), files.entry ?? defaultEntry(files.name));
  return root;
}
