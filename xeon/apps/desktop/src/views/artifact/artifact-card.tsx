import { Button } from "@caustic/react";
import { CodeXml, FileText, Image } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ItemId, ItemRecord, ThreadId } from "@fresnel/contracts/conversation";
import { useContext, type ReactNode } from "react";
import { useOpenThread, useOpenTranscript } from "../../state/engine/index.ts";
import { ShellStoreContext } from "../../state/shell/index.ts";
import { ARTIFACT_TAB_ID } from "../panels/tab-ids.ts";
import { artifactsOf, type ArtifactEntry, type ArtifactKind } from "./artifact-model.ts";
import { pickArtifact } from "./artifact-store.ts";
import { ARTIFACT_KIND_LABEL, versionOfCall } from "./artifact-view-model.ts";

// 대화의 아티팩트 카드(artView, F-21). 모델이 HTML, SVG, 그림, 마크다운을 쓰거나 고친 도구 묶음 아래에 그 판의 카드를 둔다.
// 누르면 오른쪽 well의 아티팩트 판이 그 판으로 열린다. 지난 턴의 카드는 그 턴의 판을 연다(최신 판이면 최신을 따라간다).

interface CacheEntry {
  readonly itemIds: readonly ItemId[];
  readonly items: Readonly<Record<string, ItemRecord>>;
  readonly workspace: string | null;
  readonly list: readonly ArtifactEntry[];
}

// 한 대화 기록에 카드 묶음이 여럿이라 같은 기록으로 한 번만 모은다(기록 객체가 바뀌면 다시 모은다)
let cache: CacheEntry | null = null;

function cachedArtifacts(
  itemIds: readonly ItemId[],
  items: Readonly<Record<string, ItemRecord>>,
  workspace: string | null,
): readonly ArtifactEntry[] {
  if (
    cache !== null &&
    cache.itemIds === itemIds &&
    cache.items === items &&
    cache.workspace === workspace
  ) {
    return cache.list;
  }
  const list = artifactsOf({ itemIds, items, workspace });
  cache = { itemIds, items, workspace, list };
  return list;
}

const KIND_ICON: Readonly<Record<ArtifactKind, typeof CodeXml>> = {
  html: CodeXml,
  svg: Image,
  image: Image,
  markdown: FileText,
};

function KindIcon(props: { readonly kind: ArtifactKind }): ReactNode {
  const Icon = KIND_ICON[props.kind];
  return <Icon aria-hidden className="size-icon-sm flex-none text-text-secondary" />;
}

function kindLabel(kind: ArtifactKind): string {
  return t(ARTIFACT_KIND_LABEL[kind]);
}

/** 도구 호출 묶음이 만든 판의 카드들. 같은 아티팩트를 여러 번 고쳤으면 마지막 판 하나만 둔다 */
export function ArtifactCards(props: {
  readonly threadId: ThreadId;
  readonly callIds: readonly string[];
}): ReactNode {
  const transcript = useOpenTranscript(props.threadId);
  const workspace = useOpenThread()?.workspace ?? null;
  const shell = useContext(ShellStoreContext);
  if (transcript.status !== "ready") return null;
  const list = cachedArtifacts(transcript.itemIds, transcript.items, workspace);
  if (list.length === 0) return null;
  const cards = new Map<string, NonNullable<ReturnType<typeof versionOfCall>>>();
  for (const callId of props.callIds) {
    const found = versionOfCall(list, callId);
    if (found !== undefined) cards.set(found.entry.key, found);
  }
  if (cards.size === 0) return null;
  return (
    <div data-artifact-cards="" className="grid min-w-0 gap-1.5 ps-5 pt-1 pb-1.5">
      {[...cards.values()].map(({ entry, version }) => {
        const latest = version.number === entry.versions.length;
        const open = (): void => {
          pickArtifact({ key: entry.key, version: latest ? null : version.number });
          shell?.actions.openEndTab(ARTIFACT_TAB_ID, "chat");
        };
        return (
          <div
            key={entry.key}
            data-artifact-card={entry.key}
            className="flex h-12 w-full max-w-96 min-w-0 items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-raised ps-3 pe-2"
          >
            <KindIcon kind={entry.kind} />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-ui-strong text-text-primary" title={entry.title}>
                {entry.title}
              </span>
              <span className="truncate text-footnote text-text-tertiary">
                {entry.versions.length > 1
                  ? t("desktop.artifact.card.meta", {
                      kind: kindLabel(entry.kind),
                      number: version.number,
                    })
                  : kindLabel(entry.kind)}
              </span>
            </span>
            <Button size="xs" variant="soft" onClick={open}>
              {t("desktop.artifact.card.open")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
