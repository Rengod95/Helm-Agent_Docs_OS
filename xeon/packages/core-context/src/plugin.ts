import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@xeon/contracts/extensions";
import {
  ContextPortKey,
  ModelServicePortKey,
  OsPortKey,
  SessionPortKey,
} from "@xeon/contracts/services";
import { ExtHostPortKey, hostOf } from "@xeon/ext-host";
import { createContextService } from "./service.ts";

// 플러그인 정의: xeon.context를 제공하고 xeon.models, xeon.session, xeon.ext를 주입받는다(L1.context.plan §2).
// 서비스 전체 모양의 포트 키(ContextPortKey, ModelServicePortKey, SessionPortKey, OsPortKey)는 F `services`가 내보낸다.

export const manifest: ExtensionManifest = defineManifest({
  schemaVersion: 1,
  name: "core-context",
  version: "0.0.0",
  displayName: "Context",
  description: "Context assembly, compaction and overflow recovery (xeon.context)",
  layer: "L1",
  kind: "plugin",
  entry: "./src/index.ts",
  // 이 확장은 지점을 발화만 하고 핸들러를 달지 않는다
  points: [],
  usesDrive: false,
});

export const extension: ExtensionEntry = ({ scope }) => {
  scope(manifest.name, {}, (g) => {
    const host = hostOf(g);
    const ext = host.port(ExtHostPortKey);
    const os = ext.ports.get(OsPortKey);
    host.providePort(
      ContextPortKey,
      createContextService({
        session: host.port(SessionPortKey),
        models: host.port(ModelServicePortKey),
        ext,
        ...(os === undefined ? {} : { logger: os.logger(manifest.name) }),
      }),
    );
  });
};
