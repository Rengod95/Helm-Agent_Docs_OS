// cvC 왼쪽 플러그인 목록(떠 있는 판). 위는 프로필 밖의 설치된 플러그인(끌어서 지점에 놓는다), 아래는 이 프로필에 든 것(누르면 캔버스에서 고른다).
// 끌기는 포인터로, 키보드는 Enter로 "놓을 자리 고르기"를 연다. 쓰는 법은 정보 아이콘 뒤에 둔다.
import { IconButton, Input } from "@caustic/react";
import { GripVertical, PanelLeft, Search } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { useState, type PointerEvent, type ReactNode } from "react";
import { InfoTip } from "../../info-tip.tsx";
import { kindLabel } from "./labels.ts";
import { KindWell } from "./marks.tsx";
import { pluginOf, type PluginKind } from "./sample.ts";

interface Row {
  readonly name: string;
  readonly kind: PluginKind;
}

function rowsOf(names: readonly string[], query: string): readonly Row[] {
  const q = query.trim().toLowerCase();
  return names.flatMap((name) => {
    const p = pluginOf(name);
    if (p === undefined) return [];
    if (q !== "" && !name.includes(q) && !kindLabel(p.kind).toLowerCase().includes(q)) return [];
    return [{ name, kind: p.kind }];
  });
}

export interface PaletteProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** 프로필 밖의 설치된 플러그인 */
  readonly outside: readonly string[];
  /** 프로필에 든 것(베이스 포함, 실행 순서) */
  readonly inside: readonly string[];
  readonly selected: string | null;
  readonly onPress: (name: string, e: PointerEvent<HTMLElement>) => void;
  readonly onKeyboardPlace: (name: string) => void;
  readonly onLocate: (name: string) => void;
}

export function Palette(props: PaletteProps): ReactNode {
  const [query, setQuery] = useState("");
  if (!props.open) {
    return (
      <div className="pointer-events-auto absolute top-3 left-3 z-20 rounded-2xl bg-material-regular p-1 shadow-3">
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.palette.open")}
          onClick={props.onToggle}
        >
          <PanelLeft aria-hidden />
        </IconButton>
      </div>
    );
  }
  const outside = rowsOf(props.outside, query);
  const inside = rowsOf(props.inside, query);
  return (
    <aside
      data-cvc-palette-panel=""
      aria-label={t("desktop.craft.canvas.cvC.palette.title")}
      className="pointer-events-auto absolute top-3 left-3 z-20 flex max-h-[calc(100%-24px)] w-[240px] flex-col rounded-[22px] bg-material-regular shadow-3"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="m-0 flex-1 text-ui-strong text-text-primary">
          {t("desktop.craft.canvas.cvC.palette.title")}
        </h2>
        <InfoTip text={t("desktop.craft.canvas.cvC.palette.help")} />
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.palette.close")}
          onClick={props.onToggle}
        >
          <PanelLeft aria-hidden />
        </IconButton>
      </div>
      <div className="shrink-0 px-3 pb-2">
        <Input
          size="sm"
          variant="soft"
          prefix={<Search aria-hidden />}
          aria-label={t("desktop.craft.canvas.cvC.palette.search")}
          placeholder={t("desktop.craft.canvas.cvC.palette.search")}
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Section title={t("desktop.craft.canvas.cvC.palette.installed")}>
          {outside.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                data-slot="cvc-button"
                data-cvc-palette={r.name}
                aria-label={t("desktop.craft.canvas.cvC.palette.add", {
                  name: r.name,
                  kind: kindLabel(r.kind),
                })}
                onPointerDown={(e) => props.onPress(r.name, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onKeyboardPlace(r.name);
                  }
                }}
                className="group/row flex h-11 w-full cursor-grab touch-none items-center gap-2.5 rounded-xl px-2 text-left outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-focus-ring active:cursor-grabbing"
              >
                <KindWell kind={r.kind} />
                <span className="min-w-0 flex-1 truncate text-ui text-text-primary">{r.name}</span>
                <span className="text-text-tertiary opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
                  <GripVertical size={14} aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </Section>
        <Section title={t("desktop.craft.canvas.cvC.palette.inProfile")}>
          {inside.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                data-slot="cvc-button"
                aria-pressed={props.selected === r.name}
                onClick={() => props.onLocate(r.name)}
                className={`flex h-9 w-full items-center gap-2.5 rounded-xl px-2 text-left outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  props.selected === r.name ? "bg-fill-selected" : ""
                }`}
              >
                <span className="flex w-7 justify-center text-text-tertiary">
                  <KindGlyph kind={r.kind} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ui text-text-secondary">
                  {r.name}
                </span>
              </button>
            </li>
          ))}
        </Section>
      </div>
    </aside>
  );
}

function KindGlyph(props: { readonly kind: PluginKind }): ReactNode {
  return (
    <span aria-hidden className="flex">
      <KindWell kind={props.kind} muted />
    </span>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="mt-2 first:mt-0">
      <h3 className="m-0 px-2 pt-2 pb-1 text-ui-xs text-text-tertiary">{props.title}</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{props.children}</ul>
    </section>
  );
}
