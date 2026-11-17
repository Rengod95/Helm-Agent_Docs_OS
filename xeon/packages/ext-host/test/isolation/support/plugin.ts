// 감독 시험의 플러그인 픽스처. 메서드 네 개(ping: 값을 돌려준다, hang: 영원히 기다린다, delay: 잠깐 뒤 돌려준다,
// bump: 엔진에 상태 커밋을 요청한다)와, 선언이 다른 두 번째 엔트리(other)를 가진다.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { PLUGIN_HOST_PROTOCOL_VERSION, type HostInitParams } from "@fresnel/contracts/extensions";
import { writePluginRoot } from "./host.ts";

export { cleanupTempRoots } from "./host.ts";

const FIXTURE_ENTRY = `
import { Type } from "typebox";
import { hostOf } from "@fresnel/ext-host";

export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({ count: Type.Number() }), initial: { count: 0 }, version: 1 }, defaultEnabled: true }, (g) => {
    const host = hostOf(g);
    host.registerMethod("ping", { handler: async (params) => ({ pong: params.n }) });
    host.registerMethod("hang", { handler: () => new Promise(() => {}) });
    host.registerMethod("delay", {
      handler: async (params) => {
        await new Promise((resolve) => setTimeout(resolve, params.ms));
        return "late";
      },
    });
    host.registerMethod("bump", { handler: async () => g.commit({ count: g.state().count + 1 }) });
  });
}
`;

const OTHER_ENTRY = `
import { Type } from "typebox";
import { hostOf } from "@fresnel/ext-host";

export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({ count: Type.Number() }), initial: { count: 0 }, version: 1 }, defaultEnabled: true }, (g) => {
    const host = hostOf(g);
    host.registerMethod("other", { handler: async () => "other" });
  });
}
`;

const MANIFEST: JsonValue = {
  schemaVersion: 2,
  name: "demo",
  version: "1.0.0",
  entry: "./src/index.ts",
  plugins: [{ layer: "plugin", hooks: [] }],
};

/** 메서드 네 개를 가진 확장 루트. 두 번째 엔트리 `./src/other.ts`도 같은 루트에 쓴다 */
export async function fixtureRoot(): Promise<string> {
  const root = await writePluginRoot(FIXTURE_ENTRY);
  await writeFile(join(root, "src", "other.ts"), OTHER_ENTRY);
  return root;
}

/** host.init params. 엔트리 파일은 루트 안의 상대 경로다 */
export function initParamsOf(
  root: string,
  entry: string = "./src/index.ts",
  protocolVersion: number = PLUGIN_HOST_PROTOCOL_VERSION,
): HostInitParams {
  return {
    protocolVersion,
    extension: "demo",
    versionId: "v1",
    manifest: MANIFEST,
    root,
    entry,
    settings: { "ext.demo.limit": 3 },
  };
}

/** 메서드 호출 params. 호출 문맥 필드(`threadId`, `deadlineMs`, `replay`, `caller`, `state`, `settings`)를 채운다 */
export function methodParams(verb: string, params: JsonValue, callId?: string): JsonValue {
  return {
    threadId: null,
    deadlineMs: null,
    replay: false,
    caller: "engine",
    state: { count: 0 },
    settings: {},
    registration: "demo",
    verb,
    params,
    callId: callId ?? `call_${verb}`,
    callerKind: "wire",
  };
}
