import { parse, type Logger } from "@xeon/contracts";
import {
  parseSecretRef,
  type SecretHandle,
  type SecretMeta,
  type SecretName,
  type SecretUsePolicy,
} from "@xeon/contracts/capabilities";
import type { ProviderTarget, SecretAdminService, SecretMetaPatch } from "@xeon/contracts/services";
import { resolveSetting, type SettingCatalog } from "@xeon/contracts/settings";
import { Type } from "typebox";
import type { SettingsEngine } from "../assembly/settings-engine.ts";

// L4.host-service.spec HS-45 [결정: M2 Mac 실기]. 비밀을 모델 provider에 연결하는 사람의 행위가 그 호출 하나만 허용하는 사용 정책을
// 비밀 메타에 더한다. 허용은 모드 runtime-http, 목적 `model.provider:<id>`, provider 요청의 호스트뿐이다. env 모드, 도구, 다른 호스트는 열지 않는다.
// 연결은 사용자 범위 `l1.models.providers`의 `apiKeyRef`다. 프로젝트·로컬 범위의 설정은 연결로 세지 않는다(저장소 안 파일이 정책을 넓히지 못한다).

const PROVIDERS_KEY = "l1.models.providers";

/** `model.provider:<id>`. core-models의 비밀 다리가 lease에 싣는 purpose와 같은 문자열이다(L1.models.spec §3.9) */
export function modelProviderPurpose(providerId: string): string {
  return `model.provider:${providerId}`;
}

const LinkedProvidersSchema = Type.Array(
  Type.Object({
    id: Type.String(),
    enabled: Type.Boolean(),
    apiKeyRef: Type.Union([Type.String(), Type.Null()]),
  }),
);

export interface ProviderKeyLink {
  readonly providerId: string;
  readonly name: SecretName;
  readonly handle: SecretHandle;
}

/** 사용자 범위 설정에서 켜져 있고 키 참조가 있는 provider들. 참조 모양이 틀린 원소는 건너뛴다 */
export function userProviderLinks(
  settings: Pick<SettingsEngine, "layers">,
  catalog: SettingCatalog,
): readonly ProviderKeyLink[] {
  const def = catalog.get(PROVIDERS_KEY);
  if (def === undefined) return [];
  const userOnly = settings.layers(undefined).filter((layer) => layer.scope === "user");
  const parsed = parse(LinkedProvidersSchema, resolveSetting(def, userOnly).setting.value);
  if (!parsed.ok) return [];
  const links: ProviderKeyLink[] = [];
  for (const entry of parsed.value) {
    if (!entry.enabled || entry.apiKeyRef === null) continue;
    const ref = parseSecretRef(entry.apiKeyRef);
    if (!ref.ok) continue;
    links.push({ providerId: entry.id, name: ref.value.name, handle: ref.value.handle });
  }
  return links;
}

function withEntry(list: readonly string[], entry: string): readonly string[] {
  return list.includes(entry) ? list : [...list, entry];
}

/** 정책 판정의 호스트 항목. 포트가 없으면 443만 맞으므로 있을 때만 `host:port`로 적는다 */
function hostEntryOf(target: ProviderTarget): string {
  return target.port === null ? target.host : `${target.host}:${target.port}`;
}

/** 현재 정책에 모델 provider 사용 하나를 더한 정책. 이미 있는 항목과 `origins`, `commands`는 그대로 둔다 */
export function useWithModelProvider(
  current: SecretUsePolicy,
  providerId: string,
  target: ProviderTarget,
): SecretUsePolicy {
  return {
    ...current,
    modes: current.modes.includes("runtime-http")
      ? current.modes
      : [...current.modes, "runtime-http"],
    tools: withEntry(current.tools, modelProviderPurpose(providerId)),
    hosts: withEntry(current.hosts, hostEntryOf(target)),
  };
}

/** 정책이 모델 provider 사용만 허용하는가 */
function isModelProviderOnly(use: SecretUsePolicy): boolean {
  return (
    use.modes.every((mode) => mode === "runtime-http") &&
    use.tools.every((tool) => tool.startsWith("model.provider:")) &&
    (use.origins ?? []).length === 0 &&
    (use.commands ?? []).length === 0
  );
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * 연결이 메타에 더할 변경. 이미 허용돼 있으면 null이다. 모델 호출은 사람에게 승인을 물을 수 없으므로 정책이 모델 provider 사용만 남을 때
 * 승인을 `none`으로 낮춘다(사람이 연결로 이미 허용했다). 다른 사용(env, 브라우저 등)이 같이 있으면 승인은 그대로다: env 모드는 어느 쪽이든
 * 실행마다 승인을 요구한다(L0.secrets.spec §4.2 6번).
 */
export function linkPatchOf(
  meta: SecretMeta,
  providerId: string,
  target: ProviderTarget,
): SecretMetaPatch | null {
  const use = useWithModelProvider(meta.use, providerId, target);
  const approval = isModelProviderOnly(use) ? "none" : meta.approval;
  const unchanged =
    sameList(use.modes, meta.use.modes) &&
    sameList(use.tools, meta.use.tools) &&
    sameList(use.hosts, meta.use.hosts) &&
    approval === meta.approval;
  return unchanged ? null : { use, approval };
}

export interface ProviderLinker {
  /**
   * 사용자 범위에 연결된 모든 provider의 비밀에 허용을 더한다. 비밀이 아직 없으면 건너뛴다(만들 때 `grantFor`가 더한다).
   * 설정 쓰기는 이미 끝난 뒤라 실패해도 쓰기를 되돌리지 않고 경고만 남긴다
   */
  link(): Promise<void>;
  /** 새 비밀 `name`이 이미 provider에 연결돼 있으면 처음부터 가질 정책. 연결이 없으면 undefined */
  grantFor(
    name: SecretName,
  ): { readonly use: SecretUsePolicy; readonly approval: "none" } | undefined;
}

export function createProviderLinker(deps: {
  readonly admin: SecretAdminService;
  readonly settings: Pick<SettingsEngine, "layers">;
  readonly catalog: SettingCatalog;
  readonly targetOf: (providerId: string) => ProviderTarget | null;
  readonly logger: Logger;
}): ProviderLinker {
  const { admin, settings, catalog, targetOf, logger } = deps;
  return {
    async link() {
      const links = userProviderLinks(settings, catalog);
      if (links.length === 0) return;
      const listed = await admin.ls({ usage: false });
      if (!listed.ok) {
        logger.warn("secret.provider_link_failed", { kind: listed.error.kind });
        return;
      }
      for (const link of links) {
        const meta = listed.value.find((listing) => listing.handle === link.handle)?.meta;
        if (meta === undefined || meta === null) {
          logger.info("secret.provider_link_pending", { provider: link.providerId });
          continue;
        }
        const target = targetOf(link.providerId);
        if (target === null) {
          logger.warn("secret.provider_link_no_target", { provider: link.providerId });
          continue;
        }
        const patch = linkPatchOf(meta, link.providerId, target);
        if (patch === null) continue;
        // oxlint-disable-next-line no-await-in-loop -- 메타 파일 쓰기는 하나씩 차례로 한다 (L4.host-service.spec HS-45)
        const patched = await admin.meta(link.handle, patch);
        if (!patched.ok) {
          logger.warn("secret.provider_link_failed", {
            provider: link.providerId,
            kind: patched.error.kind,
          });
        }
      }
    },
    grantFor(name) {
      let use: SecretUsePolicy | undefined;
      for (const link of userProviderLinks(settings, catalog)) {
        if (link.name !== name) continue;
        const target = targetOf(link.providerId);
        if (target === null) continue;
        use = useWithModelProvider(
          use ?? { modes: [], tools: [], hosts: [] },
          link.providerId,
          target,
        );
      }
      return use === undefined ? undefined : { use, approval: "none" };
    },
  };
}
