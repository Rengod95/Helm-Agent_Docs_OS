// 표 아래 "고른 것" 구역: 칸(층 · 단계)이면 그 칸의 훅, 층이면 그 층에 깔린 것 전부와 더하기, 단계면 그 단계에 끼어드는
// 플러그인, 포커스면 그 플러그인의 관계. 행을 누르면 포커스(관계 없는 칸 글자를 낮춤), 상세가 있는 플러그인은 "구성과 흐름".
// 위 표의 연장이라 첫 단을 층 이름 칸과 같은 폭으로 두고, 둘째 단을 표의 첫 칸 글자에 맞춘다. 행 구분은 1px 얇은 선이다.
import { Button } from "@caustic/react";
import { PageSection } from "../../_shell/page";
import { T } from "../../_shell/terms";
import {
  STAGES,
  layerById,
  layerName,
  pluginById,
  pluginsOf,
  relationsOf,
  type LayerId,
  type Plugin,
  type Relation,
} from "../data";
import { useMock } from "../store";
import { ROW_HEAD, TABLE_LAYERS, useCellPlugins } from "./layer-table";

/** 상세(구성과 흐름)가 있는 플러그인 */
const HAS_DETAIL = new Set(["helm", "cost-router"]);

/** 행 끝 글: 손볼 상태와 누가 깔았는지만. 내장·켜짐은 말하지 않는다. */
function endWord(p: Plugin) {
  if (p.health === "auto_off")
    return <span className="text-body text-danger-text">{T.autoDisabled}</span>;
  if (p.health === "failing") return <span className="text-body text-warning-text">실패 있음</span>;
  if (p.health === "off") return <span className="text-footnote text-text-tertiary">꺼짐</span>;
  if (p.origin === "user")
    return <span className="text-footnote text-text-tertiary">{T.trustUser}</span>;
  if (p.origin === "project")
    return <span className="text-footnote text-text-tertiary">{T.trustProject}</span>;
  return undefined;
}

/** 플러그인 한 줄: 이름 · 하는 일 · 손볼 상태. 누르면 포커스. */
function PluginRows({ plugins, label }: { plugins: Plugin[]; label: string }) {
  const m = useMock();
  return (
    <ul aria-label={label} className="m-0 grid list-none p-0">
      {plugins.map((p) => (
        <li key={p.id} className="border-t border-border-subtle first:border-t-0">
          <button
            type="button"
            onClick={() => m.set({ focus: p.id, pick: {} })}
            style={{ gridTemplateColumns: `${ROW_HEAD} minmax(0,1fr) auto` }}
            className="grid min-h-11 w-full cursor-pointer items-baseline py-2.5 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring"
          >
            <span className="min-w-0 truncate pe-3 text-title-3 text-text-primary">{p.name}</span>
            <span className="min-w-0 text-body text-text-secondary">{p.blurb}</span>
            <span className="ps-4">{endWord(p)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 관계의 층 순서. 표에 없는 계약(F)도 관계에는 나온다. */
const RELATION_LAYERS: readonly LayerId[] = [...TABLE_LAYERS, "F"];

/** 관계: 층별로 묶는다. 왼쪽은 층 이름, 오른쪽은 그 층과의 관계 문장. */
function RelationRows({ relations, label }: { relations: Relation[]; label: string }) {
  const layers = RELATION_LAYERS.filter((l) => relations.some((r) => r.layer === l));
  return (
    <dl aria-label={label} className="m-0 grid">
      {layers.map((l) => (
        <div
          key={l}
          style={{ gridTemplateColumns: `${ROW_HEAD} minmax(0,1fr)` }}
          className="grid items-baseline border-t border-border-subtle py-2.5 first:border-t-0"
        >
          <dt className="min-w-0 truncate pe-3 text-title-3 text-text-primary">{layerName(l)}</dt>
          <dd className="m-0 grid min-w-0 gap-1 text-body text-text-secondary">
            {relations
              .filter((r) => r.layer === l)
              .map((r) => (
                <span key={r.label}>{r.label}</span>
              ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PickPanel() {
  const m = useMock();
  const cellPlugins = useCellPlugins();
  const { row, col } = m.pick;

  if (m.focus !== null) {
    const p = pluginById(m.focus);
    return (
      <PageSection
        title={p.name}
        description={p.blurb}
        action={
          <span className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => m.set({ focus: null })}>
              닫기
            </Button>
            {HAS_DETAIL.has(p.id) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => m.set({ screen: "detail", detail: p.id })}
              >
                구성과 흐름
              </Button>
            )}
          </span>
        }
      >
        <RelationRows relations={relationsOf(p.id)} label={`${p.name} 관계`} />
      </PageSection>
    );
  }

  if (row !== undefined && col !== undefined) {
    const stage = STAGES.find((s) => s.id === col);
    const items = cellPlugins(row, col).map((x) => x.p);
    return (
      <PageSection title={`${layerName(row)} · ${stage?.label ?? col}`} description={stage?.when}>
        {items.length === 0 ? (
          <p className="m-0 text-body text-text-secondary">이 층은 이 단계에 끼어들지 않아요.</p>
        ) : (
          <PluginRows plugins={items} label={`${layerName(row)} ${stage?.label ?? col}`} />
        )}
      </PageSection>
    );
  }

  if (row !== undefined) {
    const layer = layerById(row);
    return (
      <PageSection
        title={layerName(row)}
        description={layer.does}
        action={
          layer.addNoun === "" ? undefined : (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                row === "L1"
                  ? m.set({ overlay: "add-l1" })
                  : m.notify(`${layerName(row)}에 ${layer.addNoun} 더하기`)
              }
            >
              {layer.addNoun} 더하기
            </Button>
          )
        }
      >
        <PluginRows plugins={pluginsOf(row)} label={layerName(row)} />
      </PageSection>
    );
  }

  if (col !== undefined) {
    const stage = STAGES.find((s) => s.id === col);
    const plugins = TABLE_LAYERS.flatMap((l) => cellPlugins(l, col).map((x) => x.p));
    return (
      <PageSection title={stage?.label ?? col} description={stage?.when}>
        <PluginRows plugins={plugins} label={stage?.label ?? col} />
      </PageSection>
    );
  }

  return null;
}
