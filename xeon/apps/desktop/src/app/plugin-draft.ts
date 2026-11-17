import type { InstallPreview } from "@fresnel/contracts/services";
import type { PluginDraftCreateResult } from "@fresnel/contracts/wire";

// 설치 화면의 미리 보기(`InstallPreview`)를 `plugin.draft.create`의 카드로 채우는 순수 함수.
// 카드에 없는 칸(신뢰 요청, 설치본 버전, 기능 요청, 경고)은 비운다. `sha256`은 초안의 내용 해시, `version`은 접두어를 뺀 앞 12자다
// (검토본의 버전 id가 내용 해시이므로 이 값이 화면에 보이는 버전이다).

const VERSION_HASH_LENGTH = 12;
const HASH_PREFIX = "sha256:";

/** `sha256:<64 hex>` 해시에서 화면에 보일 버전 문자열(접두어를 뺀 앞 12자) */
function versionOf(contentHash: string): string {
  const hex = contentHash.startsWith(HASH_PREFIX)
    ? contentHash.slice(HASH_PREFIX.length)
    : contentHash;
  return hex.slice(0, VERSION_HASH_LENGTH);
}

/** 초안 만들기 결과를 설치 확인 화면이 그리는 미리 보기로 바꾼다. `dir`은 사용자가 고른 원본 폴더다 */
export function installPreviewOfDraft(dir: string, draft: PluginDraftCreateResult): InstallPreview {
  const { card } = draft;
  const inject = card.does.inject;
  return {
    name: card.name,
    version: versionOf(draft.contentHash),
    displayName: card.displayName,
    description: card.purpose,
    source: dir,
    sha256: draft.contentHash,
    trustRequest: null,
    installedVersion: null,
    hooks: card.does.hook === null ? [] : card.does.hook.hooks.map((hook) => hook.name),
    tools: inject === null ? [] : inject.replaces,
    capabilities: [],
    network: inject === null ? [] : inject.mcpServers.map((server) => server.name),
    files: [],
    shell: [],
    drives: card.does.drive !== null,
    screens:
      inject === null
        ? []
        : inject.ui.map((decl) => ({
            id: decl.id,
            title: decl.id,
            placement: decl.placement,
            mode: "native",
            capabilities: [],
          })),
    warnings: [],
  };
}
