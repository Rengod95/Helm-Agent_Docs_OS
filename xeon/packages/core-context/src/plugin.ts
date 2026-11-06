import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type { IdFactory } from "@fresnel/contracts/conversation";
import type { ProducerHandle } from "@fresnel/contracts/records";
import {
  ContextPortKey,
  ModelServicePortKey,
  OsPortKey,
  SecretServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
} from "@fresnel/contracts/services";
import { ExtHostPortKey, hostOf, type BuiltinExtensionModule } from "@fresnel/ext-host";
import { createContextService } from "./service.ts";
import type { ContextSettingsSource } from "./settings.ts";

// 플러그인 정의: fresnel.context를 제공하고 fresnel.models, fresnel.session, fresnel.ext를 주입받는다(L1.context.plan §2).
// 서비스 전체 모양의 포트 키(ContextPortKey, ModelServicePortKey, SessionPortKey, OsPortKey)는 F `services`가 내보낸다.

export const manifest: ExtensionManifest = defineManifest({
  schemaVersion: 2,
  name: "core-context",
  version: "0.0.0",
  displayName: "Context",
  description: "Context assembly, compaction and overflow recovery (fresnel.context)",
  entry: "./src/index.ts",
  plugins: [
    {
      layer: "L1",
      // 이 확장은 지점을 발화만 하고 핸들러를 달지 않는다
      hooks: [],
    },
  ],
});

export interface ContextExtensionOptions {
  /** 유효 설정 읽기(`contextSettingsOf`로 만든다). 없으면 기본값이다 */
  readonly settings?: ContextSettingsSource;
  /** 컴팩션 이벤트 id 발급. 없으면 컴팩션은 skipped(disabled)다 */
  readonly ids?: IdFactory;
}

export function createContextExtension(
  options: ContextExtensionOptions = {},
): BuiltinExtensionModule {
  // 생산자 핸들은 한 번만 받을 수 있다(store.producer_claimed). scope가 다시 켜져도 처음 받은 것을 쓴다
  let producer: ProducerHandle | undefined;
  const entry: ExtensionEntry = ({ register }) => {
    register(manifest.name, {}, (g) => {
      const host = hostOf(g);
      const ext = host.port(ExtHostPortKey);
      const os = ext.ports.get(OsPortKey);
      // 모델 입력 단계 사후 가림(L0.secrets.spec §3.5.1). 시크릿 서비스가 없으면 가리지 않는다
      const secrets = ext.ports.get(SecretServicePortKey);
      const session = host.port(SessionPortKey);
      // 이미지 blob 자리표시를 요청에서 푼다. store 포트가 없으면 풀지 않는다
      const store = ext.ports.get(StoreServicePortKey);
      if (options.ids !== undefined) producer ??= session.producer("core.context");
      host.providePort(
        ContextPortKey,
        createContextService({
          session,
          models: host.port(ModelServicePortKey),
          ext,
          ...(options.settings === undefined ? {} : { settings: options.settings }),
          ...(options.ids === undefined || producer === undefined
            ? {}
            : { ids: options.ids, producer }),
          ...(store === undefined
            ? {}
            : { readBlobByHash: (sha256: string) => store.readBlobByHash(sha256) }),
          ...(secrets === undefined ? {} : { redactor: secrets.redactor }),
          ...(os === undefined ? {} : { logger: os.logger(manifest.name) }),
        }),
      );
    });
  };
  return { manifest, extension: entry };
}

/** 기본 설정으로 만든 내장 확장 엔트리. 컴팩션은 꺼져 있다. 조립 루트가 설정과 id 발급을 넘기려면 createContextExtension을 쓴다 */
export const extension: ExtensionEntry = createContextExtension().extension;
