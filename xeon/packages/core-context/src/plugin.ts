import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type PortKey,
} from "@xeon/contracts/extensions";
import { SessionServiceName, type SessionService } from "@xeon/contracts/records";
import {
  ContextServiceName,
  ModelServiceName,
  OsServiceName,
  type ContextService,
  type ModelService,
  type OsService,
} from "@xeon/contracts/services";
import { ExtHostPortKey, hostOf } from "@xeon/ext-host";
import { createContextService } from "./service.ts";

// 플러그인 정의: xeon.context를 제공하고 xeon.models, xeon.session, xeon.ext를 주입받는다(L1.context.plan §2).
// 서비스 전체 모양의 포트 키는 F에 없어(ModelsPortKey는 등록 부분형이다) 이름만 F 상수로 쓰는 키를 여기서 만든다.

/** 서비스 xeon.context. 소비자(core-loop 등)는 F가 같은 키를 내보낼 때까지 이름 상수로 조회한다 */
export const ContextPortKey: PortKey<ContextService> = { name: ContextServiceName };
const ModelServicePortKey: PortKey<ModelService> = { name: ModelServiceName };
const SessionPortKey: PortKey<SessionService> = { name: SessionServiceName };
const OsPortKey: PortKey<OsService> = { name: OsServiceName };

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
