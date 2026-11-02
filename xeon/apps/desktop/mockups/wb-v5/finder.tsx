// 찾기: 플러그인, 스킬, 명령, 도구, MCP 서버, 훅, 기능을 한 칸에서 찾는다. 누르면 그것을 넣어 주는 플러그인이 카드로 열린다.
import { useId, useRef, useState } from "react";
import { HOOKS, PIECE_LABEL } from "./data";
import { useMock } from "./store";

interface Hit {
  key: string;
  kind: string;
  name: string;
  mono: boolean;
  owner: string;
  pick: () => void;
}

export function Finder() {
  const m = useMock();
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const has = (s: string): boolean => s.toLowerCase().includes(needle);
  const hits: Hit[] = [];
  if (needle !== "") {
    for (const p of m.plugins) {
      const go = (): void => m.select({ k: "plugin", id: p.id });
      if (has(p.name) || has(p.role)) hits.push({ key: `p-${p.id}`, kind: p.group === undefined ? "플러그인" : "구성원", name: p.name, mono: false, owner: p.group ?? "", pick: go });
      for (const x of p.pieces) if (has(x.name)) hits.push({ key: `x-${p.id}-${x.name}`, kind: PIECE_LABEL[x.kind], name: x.name, mono: x.kind !== "view", owner: p.name, pick: go });
      for (const c of p.provides) if (has(c)) hits.push({ key: `c-${p.id}-${c}`, kind: "기능", name: c, mono: true, owner: p.name, pick: go });
    }
    for (const h of HOOKS) if (has(h.id) || has(h.label)) hits.push({ key: `h-${h.id}`, kind: "훅", name: h.id, mono: true, owner: h.label, pick: () => m.select({ k: "hook", id: h.id }) });
  }
  const shown = hits.slice(0, 8);
  return (
    <div ref={box} className="relative">
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget) === true)) setOpen(false);
        }}
        placeholder="스킬·명령·도구·훅 찾기"
        aria-label="찾기"
        className="h-8 w-56 rounded-full border border-border-default bg-surface-base px-3.5 text-body text-text-primary outline-none placeholder:text-text-tertiary focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
      />
      {open && needle !== "" && (
        <div role="listbox" aria-label="찾은 것" className="animate-enter absolute right-0 top-9 z-30 grid w-80 gap-0.5 rounded-2xl border border-border-default bg-surface-raised p-1.5 shadow-3">
          {shown.length === 0 && <span className="px-3 py-2 text-body text-text-tertiary">없어요</span>}
          {shown.map((h) => (
            <button
              key={h.key}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                h.pick();
                setOpen(false);
                setQ("");
              }}
              className="flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-start outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]"
            >
              <span className="w-14 flex-none text-footnote text-text-tertiary">{h.kind}</span>
              <span className={`min-w-0 flex-1 truncate ${h.mono ? "font-mono text-mono-sm" : "text-body"} text-text-primary`}>{h.name}</span>
              <span className="max-w-24 flex-none truncate text-footnote text-text-tertiary">{h.owner}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
