// 캔버스 위에 뜨는 두 줄: 도구 막대(보기 전환, 고른 것에 하는 일, 찾기)와 거르기 막대(어떤 플러그인인가, 무엇을 넣어 주나).
import { useEffect, useRef, useState } from "react";
import { T } from "../_shell/terms";
import {
  CONTRIB_LABEL,
  CONTRIB_ORDER,
  KIND_LABEL,
  KIND_ORDER,
  groupById,
  hasContrib,
  matchesKind,
  pluginById,
  type Plugin,
  type Sel,
} from "./data";
import { Finder } from "./finder";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { useMock } from "./store";

const PILL =
  "flex h-11 items-center gap-1 rounded-full border border-border-subtle bg-surface-raised p-1 shadow-2";
const BTN =
  "inline-flex h-9 cursor-pointer items-center whitespace-nowrap rounded-full border-0 bg-transparent px-3.5 text-ui-sm text-text-primary outline-none hover:bg-neutral-hover focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] disabled:cursor-not-allowed disabled:text-text-tertiary disabled:opacity-60 disabled:hover:bg-transparent";
const DIV = <span aria-hidden className="mx-1 h-5 w-px flex-none bg-border-default" />;

/** 고른 것의 이름과 모양. 도구 막대의 일은 이것에 한다. */
function target(
  sel: Sel,
  plugins: readonly Plugin[],
): { name: string; plugin: Plugin | null; kind: "plugin" | "group" | null } {
  if (sel.k === "plugin") {
    const p = plugins.find((x) => x.id === sel.id);
    return p === undefined
      ? { name: "", plugin: null, kind: null }
      : { name: p.name, plugin: p, kind: "plugin" };
  }
  if (sel.k === "group") {
    const g = groupById(sel.id);
    return {
      name: g === undefined ? "" : `${g.name} ${T.group}`,
      plugin: pluginById(sel.id) ?? null,
      kind: "group",
    };
  }
  return { name: "", plugin: null, kind: null };
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent): void => {
      if (ref.current !== null && e.target instanceof Node && !ref.current.contains(e.target))
        close();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}

const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border-0 bg-transparent px-3 text-start text-body text-text-primary outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]";

function AddButton() {
  const m = useMock();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const off = m.plugins.filter((p) => !m.isOn(p.id));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={BTN}
      >
        {T.plugin} 추가
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${T.plugin} 추가`}
          className="animate-enter absolute left-0 top-12 z-30 grid w-72 gap-0.5 rounded-2xl border border-border-default bg-surface-raised p-1.5 shadow-3"
        >
          <span className="px-3 pt-1 text-footnote text-text-tertiary">설치했지만 꺼진 것</span>
          {off.length === 0 && (
            <span className="px-3 py-1.5 text-body text-text-tertiary">없어요</span>
          )}
          {off.map((p) => (
            <button
              key={p.id}
              type="button"
              className={ITEM}
              onClick={() => {
                m.toggle(p.id);
                m.select({ k: "plugin", id: p.id });
                setOpen(false);
              }}
            >
              <span className="truncate">{p.name}</span>
              <span className="flex-none text-footnote text-text-tertiary">켜기</span>
            </button>
          ))}
          <div className="my-1 h-px bg-border-subtle" />
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              m.openBuilder(null);
              setOpen(false);
            }}
          >
            <span>새로 만들기</span>
            <span className="text-footnote text-text-tertiary">{T.authoringExt}</span>
          </button>
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              m.notify("가져오기는 아직 모형이에요");
              setOpen(false);
            }}
          >
            <span>{T.install}</span>
            <span className="text-footnote text-text-tertiary">파일·주소</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function CanvasToolbar() {
  const m = useMock();
  const t = target(m.sel, m.plugins);
  const has = t.kind !== null;
  const editable = t.plugin !== null && t.plugin.origin !== "builtin";
  const fix = (): void => {
    m.setView("strata");
    m.notify("순서에서 칩을 끌어 놓거나 Alt+← → 로 순서를 고쳐요");
  };
  return (
    <div role="toolbar" aria-label="캔버스 도구" className={PILL}>
      <div
        role="radiogroup"
        aria-label="보기 방식"
        className="inline-flex rounded-full bg-bg-inset p-0.5"
      >
        {(["orbit", "strata"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={m.view === v}
            onClick={() => m.setView(v)}
            className={`h-8 cursor-pointer rounded-full border-0 px-3.5 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] ${
              m.view === v
                ? "bg-text-primary text-surface-base"
                : "bg-transparent text-text-secondary hover:bg-neutral-hover"
            }`}
          >
            {v === "orbit" ? "Orbit" : "Strata"}
          </button>
        ))}
      </div>
      {DIV}
      <span
        className="flex h-9 max-w-40 items-center gap-1.5 ps-1.5 pe-2 text-ui-sm text-text-secondary"
        title="아래 버튼은 고른 것에 해요"
      >
        {t.plugin !== null && (
          <Mark shape={SHAPE_OF[t.plugin.layer]} size={18} group={t.plugin.group !== undefined} />
        )}
        <span className="truncate">{has ? t.name : "고른 것 없음"}</span>
      </span>
      <button
        type="button"
        className={BTN}
        disabled={!has}
        onClick={fix}
        title={has ? undefined : "먼저 플러그인이나 그룹을 고르세요"}
      >
        구성 고치기
      </button>
      <AddButton />
      <button
        type="button"
        className={BTN}
        disabled={!has || t.plugin === null}
        onClick={() => {
          if (t.kind === null) return;
          const id = m.sel.k === "plugin" || m.sel.k === "group" ? m.sel.id : "";
          m.openDetail({ k: t.kind, id }, true);
          if (!editable) m.notify("내장은 코드를 볼 수만 있어요");
        }}
        title={has ? undefined : "먼저 플러그인이나 그룹을 고르세요"}
      >
        {T.plugin} 수정
      </button>
      {DIV}
      <Finder />
    </div>
  );
}

export function FilterBar() {
  const m = useMock();
  const f = m.filter;
  // 센 값은 지금 고른 종류 안에서의 개수다: 켜 보기 전에 비어 있는지 안다.
  const pool = m.plugins.filter((p) => matchesKind(p, f.kind));
  return (
    <div role="toolbar" aria-label="거르기" className={`${PILL} h-10`}>
      <div
        role="radiogroup"
        aria-label="종류"
        className="inline-flex rounded-full bg-bg-inset p-0.5"
      >
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={f.kind === k}
            onClick={() => m.setKind(k)}
            className={`inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border-0 px-3 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] ${
              f.kind === k
                ? "bg-text-primary text-surface-base"
                : "bg-transparent text-text-secondary hover:bg-neutral-hover"
            }`}
          >
            {k === "group" && (
              <span aria-hidden className="size-2 rounded-full" style={{ background: GRP.mark }} />
            )}
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {DIV}
      <div role="group" aria-label="넣어 주는 것" className="flex items-center gap-0.5">
        {CONTRIB_ORDER.map((c) => {
          const n = pool.filter((p) => hasContrib(p, c)).length;
          const on = f.contrib.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              disabled={n === 0 && !on}
              onClick={() => m.toggleContrib(c)}
              className={`inline-flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 ${
                on
                  ? "border-text-primary bg-text-primary text-surface-base"
                  : "border-transparent bg-transparent text-text-secondary hover:bg-neutral-hover"
              }`}
            >
              {CONTRIB_LABEL[c]}
              <span className={`text-footnote ${on ? "opacity-70" : "text-text-tertiary"}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {m.filtering && (
        <>
          {DIV}
          <button
            type="button"
            onClick={m.clearFilter}
            className="h-7 cursor-pointer rounded-full border-0 bg-transparent px-2.5 text-ui-sm text-text-secondary outline-none hover:bg-neutral-hover focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
          >
            해제
          </button>
        </>
      )}
    </div>
  );
}
