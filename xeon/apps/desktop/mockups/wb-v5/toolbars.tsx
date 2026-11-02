// 캔버스 위에 뜨는 한 줄: 왼쪽에 보기 전환과 필터, 오른쪽에 하는 일. 찾기는 이 줄이 아니라 캔버스 왼쪽 아래(확대 막대 옆)에 따로 앉는다.
import {
  Badge,
  Button,
  Chip,
  FloatingBar,
  FloatingBarSeparator,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  Popover,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { Filter, Pencil, Plus, Rows3, Target, X } from "../_shell";
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
  type KindFilter,
  type Plugin,
  type Sel,
} from "./data";
import { useMock } from "./store";

/** 고른 것의 모양. 도구 막대의 일은 이것에 한다. */
function target(
  sel: Sel,
  plugins: readonly Plugin[],
): { plugin: Plugin | null; kind: "plugin" | "group" | null } {
  if (sel.k === "plugin") {
    const p = plugins.find((x) => x.id === sel.id);
    return p === undefined ? { plugin: null, kind: null } : { plugin: p, kind: "plugin" };
  }
  if (sel.k === "group") {
    return {
      plugin: pluginById(sel.id) ?? null,
      kind: groupById(sel.id) === undefined ? null : "group",
    };
  }
  return { plugin: null, kind: null };
}

const isKind = (v: string): v is KindFilter => KIND_ORDER.some((k) => k === v);

function AddMenu() {
  const m = useMock();
  const off = m.plugins.filter((p) => !m.isOn(p.id));
  return (
    <Menu
      size="sm"
      trigger={
        <Button size="sm" variant="ghost" iconStart={<Plus />}>
          {T.plugin} 추가
        </Button>
      }
    >
      {off.length > 0 && <MenuHeading>꺼진 {T.plugin}</MenuHeading>}
      {off.map((p) => (
        <MenuItem
          key={p.id}
          onSelect={() => {
            m.toggle(p.id);
            m.select({ k: "plugin", id: p.id });
          }}
        >
          {p.name}
        </MenuItem>
      ))}
      {off.length > 0 && <MenuSeparator />}
      <MenuItem onSelect={() => m.openBuilder(null)}>새로 만들기</MenuItem>
      <MenuItem onSelect={() => m.notify("가져오기는 아직 모형이에요")}>{T.install}</MenuItem>
    </Menu>
  );
}

export function CanvasBar() {
  const m = useMock();
  const f = m.filter;
  const t = target(m.sel, m.plugins);
  const editable = t.plugin !== null && t.plugin.origin !== "builtin";
  // 센 값은 지금 고른 종류 안에서의 개수다: 비어 있는 것은 눌러 보기 전에 꺼 둔다.
  const pool = m.plugins.filter((p) => matchesKind(p, f.kind));
  return (
    <div className="pointer-events-none absolute left-3 right-14 top-3 z-20 flex items-start justify-between gap-3">
      <FloatingBar label="보기와 필터" size="md" className="pointer-events-auto min-w-0">
        <SegmentedControl
          size="sm"
          radius="lg"
          aria-label="보기 방식"
          value={m.view === "strata" ? "strata" : "orbit"}
          onValueChange={(v) => {
            if (v === "orbit" || v === "strata") m.setView(v);
          }}
        >
          <SegmentedControlItem value="orbit" icon={<Target />}>
            Orbit
          </SegmentedControlItem>
          <SegmentedControlItem value="strata" icon={<Rows3 />}>
            Strata
          </SegmentedControlItem>
        </SegmentedControl>
        <FloatingBarSeparator />
        <SegmentedControl
          size="sm"
          radius="lg"
          variant="soft"
          aria-label="종류"
          value={f.kind}
          onValueChange={(v) => {
            if (isKind(v)) m.setKind(v);
          }}
        >
          {KIND_ORDER.map((k) => (
            <SegmentedControlItem key={k} value={k}>
              {KIND_LABEL[k]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <FloatingBarSeparator />
        <Popover
          size="sm"
          radius="2xl"
          arrow={false}
          side="bottom"
          align="start"
          anchor={
            <Button
              size="sm"
              variant={f.contrib.length > 0 ? "soft" : "ghost"}
              iconStart={<Filter />}
            >
              구성 요소{f.contrib.length > 0 && <Badge size="xs">{f.contrib.length}</Badge>}
            </Button>
          }
        >
          <div role="group" aria-label="구성 요소" className="flex max-w-72 flex-wrap gap-1.5">
            {CONTRIB_ORDER.map((c) => {
              const on = f.contrib.includes(c);
              const empty = !pool.some((p) => hasContrib(p, c));
              return (
                <Chip
                  key={c}
                  size="md"
                  variant="outline"
                  radius="md"
                  pressed={on}
                  disabled={empty && !on}
                  onPressedChange={() => m.toggleContrib(c)}
                >
                  {CONTRIB_LABEL[c]}
                </Chip>
              );
            })}
          </div>
        </Popover>
        {m.filtering && (
          <Button size="sm" variant="ghost" iconStart={<X />} onClick={m.clearFilter}>
            해제
          </Button>
        )}
      </FloatingBar>
      <FloatingBar label="플러그인" size="md" className="pointer-events-auto flex-none">
        <AddMenu />
        <Button
          size="sm"
          variant="ghost"
          iconStart={<Pencil />}
          disabled={t.kind === null}
          onClick={() => {
            if (t.kind === null) return;
            const id = m.sel.k === "plugin" || m.sel.k === "group" ? m.sel.id : "";
            m.openDetail({ k: t.kind, id }, true);
            if (!editable) m.notify("내장은 코드를 볼 수만 있어요");
          }}
        >
          {T.plugin} 수정
        </Button>
      </FloatingBar>
    </div>
  );
}
