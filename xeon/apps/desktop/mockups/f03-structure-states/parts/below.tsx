// 표 아래 구역. 칸·층·단계를 고르면 그 플러그인, 플러그인을 누르면 그 플러그인의 자리와 동작.
// 안전 모드는 빠진 것을 층별로, 빈 상태는 EmptyState 하나. 행 구분은 얇은 실선(옛 언어: 점선 아님).
// 폴더·파일 열기는 이 컴퓨터의 OS 동작이라 웹에는 없고 경로 복사만 남는다(N-60과 같음).
import { Button, EmptyState } from "@caustic/react";
import type { ReactNode } from "react";
import { PageSection, T } from "../../_shell";
import {
  STAGES,
  layerById,
  layerName,
  pluginById,
  type LayerId,
  type Plugin,
} from "../../wb-v3/data";
import type { Look, Pick } from "../flow";
import { OUT_BY_LAYER, pluginsAt, pluginsIn, ROW_HEAD, TABLE_LAYERS } from "./grid";

/** 층에 더하는 것. 시스템은 시작할 때 고르는 것이라 더하기가 없다. */
const ADD: Partial<Record<LayerId, string>> = {
  L3: T.group,
  L2: T.capability,
  L1: T.plugin,
  X: T.hook,
};

function endWord(p: Plugin) {
  if (p.health === "auto_off")
    return <span className="text-body text-danger-text">{T.autoDisabled}</span>;
  if (p.health === "failing") return <span className="text-body text-warning-text">실패 있음</span>;
  if (p.origin === "user")
    return <span className="text-footnote text-text-tertiary">{T.trustUser}</span>;
  if (p.origin === "project")
    return <span className="text-footnote text-text-tertiary">{T.trustProject}</span>;
  return undefined;
}

function Rows({
  plugins,
  label,
  head,
  onFocus,
}: {
  plugins: Plugin[];
  label: string;
  head: string;
  onFocus: (id: string) => void;
}) {
  return (
    <ul aria-label={label} className="m-0 grid list-none p-0">
      {plugins.map((p) => (
        <li key={p.id} className="border-b border-border-subtle last:border-b-0">
          <button
            type="button"
            onClick={() => onFocus(p.id)}
            style={{ gridTemplateColumns: `${head} minmax(0,1fr) auto` }}
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

const PATHS: Record<string, string> = {
  "acme-notes": "~/work/acme/.fresnel/extensions/acme-notes",
  "cost-router": "~/.fresnel/extensions/cost-router",
  "web-exa": "~/.fresnel/extensions/web-exa",
  "hook:secret-scan": "~/.fresnel/hooks/secret-scan",
  "hook:notify-done": "~/.fresnel/hooks/notify-done",
};

function FactRow({ term, head, children }: { term: string; head: string; children: ReactNode }) {
  return (
    <div
      style={{ gridTemplateColumns: `${head} minmax(0,1fr)` }}
      className="grid items-baseline border-b border-border-subtle py-2.5 last:border-b-0"
    >
      <dt className="min-w-0 truncate pe-3 text-title-3 text-text-primary">{term}</dt>
      <dd className="m-0 min-w-0 text-body text-text-secondary">{children}</dd>
    </div>
  );
}

function PluginSection({
  id,
  look,
  head,
  onClose,
  onDone,
}: {
  id: string;
  look: Look;
  head: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const p = pluginById(id);
  const path = PATHS[id];
  const web = look === "web";
  const trust =
    p.origin === "builtin" ? T.trustBuiltin : p.origin === "user" ? T.trustUser : T.trustProject;
  return (
    <PageSection
      title={p.name}
      description={p.blurb}
      action={
        <span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
          {path !== undefined &&
            (web ? (
              <Button size="sm" variant="outline" onClick={() => onDone("경로를 복사했어요")}>
                {T.copyPath}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => onDone("파일을 열었어요")}>
                  파일 열기
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDone(`${T.folder}를 열었어요`)}
                >
                  {T.folder} 열기
                </Button>
              </>
            ))}
        </span>
      }
    >
      <dl className="m-0 grid">
        <FactRow term={T.layer} head={head}>
          {layerName(p.layer)}
        </FactRow>
        <FactRow term={T.trust} head={head}>
          {trust}
        </FactRow>
        {path !== undefined && (
          <FactRow term={T.folder} head={head}>
            <span className="font-mono text-footnote">{path}</span>
          </FactRow>
        )}
      </dl>
    </PageSection>
  );
}

export function SafeOut({ head }: { head: string }) {
  return (
    <PageSection title="이번 실행에서 빠진 것">
      <dl className="m-0 grid">
        {OUT_BY_LAYER.map((o) => (
          <FactRow key={o.layer} term={layerName(o.layer)} head={head}>
            {o.names.join(" · ")}
          </FactRow>
        ))}
      </dl>
    </PageSection>
  );
}

export function EmptyInvite({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      size="md"
      surface="none"
      title={`${T.group}을 만들어 보세요`}
      actions={
        <Button size="sm" tone="neutral" variant="solid" onClick={onNew}>
          새 {T.group}
        </Button>
      }
    />
  );
}

export function PickSection({
  look,
  pick,
  focus,
  compact,
  onFocus,
  onDone,
}: {
  look: Look;
  pick: Pick;
  focus: string | null;
  compact: boolean;
  onFocus: (id: string | null) => void;
  onDone: (msg: string) => void;
}) {
  const head = compact ? "5.5rem" : ROW_HEAD;
  const { row, col } = pick;
  const go = (id: string) => onFocus(id);
  if (focus !== null)
    return (
      <PluginSection
        id={focus}
        look={look}
        head={head}
        onClose={() => onFocus(null)}
        onDone={onDone}
      />
    );
  if (row !== undefined && col !== undefined) {
    const stage = STAGES.find((s) => s.id === col);
    const items = pluginsAt(look, row, col);
    const title = `${layerName(row)} · ${stage?.label ?? col}`;
    return (
      <PageSection title={title} description={stage?.when}>
        {items.length === 0 ? (
          <p className="m-0 text-body text-text-secondary">이 층은 이 단계에 끼어들지 않아요.</p>
        ) : (
          <Rows plugins={items} label={title} head={head} onFocus={go} />
        )}
      </PageSection>
    );
  }
  if (row !== undefined) {
    const noun = ADD[row];
    // 더하기는 폴더에서 가져오는 길이 있어 웹에는 없고, 좁은 폭은 읽기만 한다.
    const canAdd = noun !== undefined && look !== "web" && look !== "narrow" && !compact;
    return (
      <PageSection
        title={layerName(row)}
        description={layerById(row).does}
        action={
          canAdd ? (
            <Button
              size="sm"
              variant="outline"
              disabled={look === "offline"}
              onClick={() => onDone(`${noun} 더하기`)}
            >
              {noun} 더하기
            </Button>
          ) : undefined
        }
      >
        <Rows plugins={pluginsIn(look, row)} label={layerName(row)} head={head} onFocus={go} />
      </PageSection>
    );
  }
  if (col !== undefined) {
    const stage = STAGES.find((s) => s.id === col);
    const plugins = TABLE_LAYERS.flatMap((l) => pluginsAt(look, l, col));
    return (
      <PageSection title={stage?.label ?? col} description={stage?.when}>
        <Rows plugins={plugins} label={stage?.label ?? col} head={head} onFocus={go} />
      </PageSection>
    );
  }
  return null;
}
