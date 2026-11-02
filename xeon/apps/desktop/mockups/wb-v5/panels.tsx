// 캔버스 위에 뜨는 두 패널: 오른쪽 선택 패널(옛 카드의 내용, 닫을 수 있다)과 아래 층 패널(고리를 누르면 그 층의 플러그인만, 순서대로).
import { IconButton } from "@caustic/react";
import { X } from "../_shell";
import { T } from "../_shell/terms";
import { LAYER_NAME, groupById, type LayerKey, type Plugin } from "./data";
import { CardBody } from "./card";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { useMock } from "./store";

export const PANEL_W = 320;
/** 오른쪽 위 셸 도구 모음(떠 있다)과 겹치지 않게 비우는 폭 */
export const RIGHT_GAP = 60;

export function SelectionPanel() {
  const m = useMock();
  const g =
    m.sel.k === "group" ||
    (m.sel.k === "plugin" &&
      m.plugins.some((p) => m.sel.k === "plugin" && p.id === m.sel.id && p.group !== undefined));
  return (
    <section
      aria-label="선택한 것"
      className="animate-enter absolute bottom-3 z-20 flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-raised shadow-3"
      style={{
        right: 12,
        top: 108,
        width: PANEL_W,
        borderTopColor: g ? GRP.graphic : undefined,
        borderTopWidth: g ? 3 : undefined,
      }}
    >
      <div className="absolute right-2 top-2 z-10">
        <IconButton size="sm" variant="ghost" label="닫기" onClick={m.closePanel}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CardBody />
      </div>
    </section>
  );
}

function Row({ p, i, n, layer }: { p: Plugin; i: number; n: number; layer: LayerKey }) {
  const m = useMock();
  const on = m.isOn(p.id);
  const h = m.health(p.id);
  const grp = p.group !== undefined;
  const picked = m.sel.k === "plugin" && m.sel.id === p.id;
  return (
    <div
      className={`grid min-w-[13.5rem] flex-1 gap-1 rounded-xl border px-3 py-2 ${picked ? "border-text-primary" : "border-border-default"} ${grp ? "" : "bg-surface-base"}`}
      style={
        grp ? { background: GRP.soft, borderColor: picked ? undefined : GRP.border } : undefined
      }
    >
      <div className="flex items-center gap-2">
        <span className="w-3 flex-none text-footnote text-text-tertiary">{i + 1}</span>
        <button
          type="button"
          onClick={() => m.select({ k: "plugin", id: p.id })}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-start outline-none focus-visible:underline"
        >
          <Mark
            shape={SHAPE_OF[layer]}
            size={20}
            group={grp}
            on={on}
            failing={h !== undefined}
            autoOff={h?.autoOff === true}
          />
          <span
            className={`truncate text-ui-strong ${on ? "text-text-primary" : "text-text-tertiary"}`}
          >
            {p.name}
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${p.name} ${on ? "끄기" : "켜기"}`}
          onClick={() => m.toggle(p.id)}
          className="grid size-7 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
        >
          <span
            className={`h-4 w-7 rounded-full border p-px ${on ? "border-text-primary bg-text-primary" : "border-border-strong bg-transparent"}`}
          >
            <span
              className={`block size-3 rounded-full ${on ? "ms-3 bg-surface-base" : "bg-text-tertiary"}`}
            />
          </span>
        </button>
      </div>
      <div className="flex items-center gap-1 ps-5">
        <span className="min-w-0 flex-1 truncate text-footnote text-text-tertiary">
          {p.group === undefined ? p.role : `${groupById(p.group)?.name ?? ""} ${T.group}`}
        </span>
        <button
          type="button"
          aria-label={`${p.name} 앞으로`}
          disabled={i === 0}
          onClick={() => m.moveInLayer(layer, p.id, i - 1)}
          className="size-6 flex-none cursor-pointer rounded-full border-0 bg-transparent text-text-secondary outline-none hover:bg-neutral-hover disabled:opacity-30"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label={`${p.name} 뒤로`}
          disabled={i === n - 1}
          onClick={() => m.moveInLayer(layer, p.id, i + 1)}
          className="size-6 flex-none cursor-pointer rounded-full border-0 bg-transparent text-text-secondary outline-none hover:bg-neutral-hover disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export function RingPanel({ right }: { right: number }) {
  const m = useMock();
  const layer = m.ring;
  if (layer === null) return null;
  const list = m.layerList(layer);
  return (
    <section
      aria-label={`${LAYER_NAME[layer]} 층`}
      className="animate-enter absolute bottom-[84px] left-3 z-20 grid gap-2 rounded-2xl border border-border-default bg-surface-raised p-3 shadow-3"
      style={{ right }}
    >
      <header className="flex items-center gap-2 ps-1">
        <Mark shape={SHAPE_OF[layer]} size={20} />
        <h3 className="m-0 text-title-3 text-text-primary">
          {layer === "plugin" ? LAYER_NAME[layer] : `${layer} ${LAYER_NAME[layer]}`}
        </h3>
        <span className="text-footnote text-text-tertiary">
          {list.length}개 · 앞에 있을수록 먼저 불려요
        </span>
        <span className="flex-1" />
        <IconButton size="sm" variant="ghost" label="닫기" onClick={m.closeRing}>
          <X />
        </IconButton>
      </header>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {list.map((p, i) => (
          <Row key={p.id} p={p} i={i} n={list.length} layer={layer} />
        ))}
      </div>
    </section>
  );
}
