// 플러그인 한 개의 구성: 훅, 기능(제공), 구성 요소(종류별), 함께 쓰면 좋은 기능을 이름표 줄의 표로 보인다.
// 자세히 보기의 "구성"과 선택 패널의 "구성"이 함께 쓴다(시안 card.tsx Provides).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { CanvasPlugin, PieceKind } from "@fresnel/client/workbench/canvas";
import { Badge } from "@caustic/react";
import type { ReactNode } from "react";
import { hookLabelOf } from "./detail-flow.tsx";

const LABEL = "text-footnote text-text-tertiary";

/** 구성 요소의 종류 순서(시안 PIECE_ORDER) */
const PIECE_KINDS: readonly PieceKind[] = ["skill", "command", "tool", "mcp", "agent", "view"];

const PIECE_LABEL: Record<PieceKind, MessageId> = {
  skill: "desktop.craft.detail.piece.skill",
  command: "desktop.craft.detail.piece.command",
  tool: "desktop.craft.detail.piece.tool",
  mcp: "desktop.craft.detail.piece.mcp",
  agent: "desktop.craft.detail.piece.agent",
  view: "desktop.craft.detail.piece.view",
};

interface Row {
  readonly key: string;
  readonly label: string;
  readonly body: ReactNode;
}

/** 훅 한 줄: 순간의 이름(알려진 것만)과 id. 나머지 훅은 id만 보인다 */
function HookName({ id }: { readonly id: string }): ReactNode {
  const label = hookLabelOf(id);
  return (
    <span className="grid gap-0">
      {label !== undefined && <span className="text-body text-text-primary">{t(label)}</span>}
      <span className="font-mono text-mono-sm text-text-tertiary">{id}</span>
    </span>
  );
}

export function Provides({ plugin }: { readonly plugin: CanvasPlugin }): ReactNode {
  const optional = plugin.optional ?? [];
  const rows: Row[] = [];
  if (plugin.hooks.length > 0) {
    rows.push({
      key: "hook",
      label: t("term.hook"),
      body: plugin.hooks.map((h) => <HookName key={h} id={h} />),
    });
  }
  if (plugin.provides.length > 0) {
    rows.push({
      key: "capability",
      label: t("term.capability"),
      body: plugin.provides.map((c) => (
        <Badge key={c} mono size="sm">
          {c}
        </Badge>
      )),
    });
  }
  for (const kind of PIECE_KINDS) {
    const pieces = plugin.pieces.filter((x) => x.kind === kind);
    if (pieces.length === 0) continue;
    rows.push({
      key: kind,
      label: t(PIECE_LABEL[kind]),
      body: pieces.map((x) =>
        kind === "view" ? (
          <span key={x.name} className="text-body text-text-primary">
            {x.name}
          </span>
        ) : (
          <Badge key={x.name} mono size="sm">
            {x.name}
          </Badge>
        ),
      ),
    });
  }
  if (optional.length > 0) {
    rows.push({
      key: "optional",
      label: t("desktop.craft.detail.provides.optional"),
      body: optional.map((c) => (
        <Badge key={c} mono size="sm" variant="outline">
          {c}
        </Badge>
      )),
    });
  }
  if (rows.length === 0) {
    return <span className={LABEL}>{t("desktop.craft.detail.provides.none")}</span>;
  }
  return (
    <dl className="m-0 grid gap-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-baseline gap-x-2">
          <dt className={`${LABEL} w-18 flex-none`}>{r.label}</dt>
          <dd className="m-0 flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1.5">{r.body}</dd>
        </div>
      ))}
    </dl>
  );
}
