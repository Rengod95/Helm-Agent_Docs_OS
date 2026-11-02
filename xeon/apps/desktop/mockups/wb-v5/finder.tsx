// 찾기: 플러그인, 스킬, 명령, 도구, MCP 서버, 훅, 기능을 한 칸에서 찾는다. 결과는 위로 열린다(캔버스 왼쪽 아래에 앉는다).
import { Card, Input, List, ListRow } from "@caustic/react";
import { useRef, useState } from "react";
import { Search } from "../_shell";
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
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const has = (s: string): boolean => s.toLowerCase().includes(needle);
  const hits: Hit[] = [];
  if (needle !== "") {
    for (const p of m.plugins) {
      const go = (): void => m.select({ k: "plugin", id: p.id });
      if (has(p.name) || has(p.role))
        hits.push({
          key: `p-${p.id}`,
          kind: p.group === undefined ? "플러그인" : "구성원",
          name: p.name,
          mono: false,
          owner: p.group ?? "",
          pick: go,
        });
      for (const x of p.pieces)
        if (has(x.name))
          hits.push({
            key: `x-${p.id}-${x.name}`,
            kind: PIECE_LABEL[x.kind],
            name: x.name,
            mono: x.kind !== "view",
            owner: p.name,
            pick: go,
          });
      for (const c of p.provides)
        if (has(c))
          hits.push({
            key: `c-${p.id}-${c}`,
            kind: "기능",
            name: c,
            mono: true,
            owner: p.name,
            pick: go,
          });
    }
    for (const h of HOOKS)
      if (has(h.id) || has(h.label))
        hits.push({
          key: `h-${h.id}`,
          kind: "훅",
          name: h.id,
          mono: true,
          owner: h.label,
          pick: () => m.select({ k: "hook", id: h.id }),
        });
  }
  const shown = hits.slice(0, 8);
  return (
    <div
      ref={box}
      className="pointer-events-auto relative"
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget) === true))
          setOpen(false);
      }}
    >
      <Input
        type="search"
        size="sm"
        variant="solid"
        radius="2xl"
        prefix={<Search />}
        value={q}
        onValueChange={(v) => {
          setQ(v);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="찾기"
        aria-label="찾기"
        containerClassName="w-48"
      />
      {open && needle !== "" && (
        <Card
          variant="surface"
          size="xs"
          shadow="4"
          role="listbox"
          aria-label="찾은 것"
          className="absolute bottom-11 left-0 z-30 w-80"
        >
          {shown.length === 0 ? (
            <span className="px-2 py-1.5 text-body text-text-tertiary">없어요</span>
          ) : (
            <List size="xs" variant="ghost" dividers={false} aria-label="찾은 것">
              {shown.map((h) => (
                <ListRow
                  key={h.key}
                  title={
                    <span className={h.mono ? "font-mono text-mono-sm" : undefined}>{h.name}</span>
                  }
                  value={h.kind}
                  description={h.owner === "" ? undefined : h.owner}
                  onClick={() => {
                    h.pick();
                    setOpen(false);
                    setQ("");
                  }}
                />
              ))}
            </List>
          )}
        </Card>
      )}
    </div>
  );
}
