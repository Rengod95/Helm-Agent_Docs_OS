// cvC "고요한 카드" 프로필 캔버스. 한 화면이 답하는 질문은 하나다: 이 프로필에서 무엇이 루프의 어디에 어떻게 붙어 있나.
// 턴은 두 줄 경주로로 도는 지점 틀이고, 플러그인 카드는 그 틀의 칸(앞·몸통·뒤)에 순서대로 선다. Drive는 턴 틀 위에서 루프를 쥔다.
// 왼쪽 목록에서 끌어 지점에 놓고(키보드: Enter → Tab → Enter), 캔버스 안에서 끌어 순서를 바꾸고, 목록으로 끌어내거나 Delete로 뺀다.
// 노드를 고르면 오른쪽에 가벼운 상세가 뜨고, 더블클릭·Enter로 플러그인 내부(`PluginInside`)가 캔버스 위에 열린다(캔버스 상태는 그대로 남는다).
import {
  FloatingBar,
  FloatingBarItem,
  FloatingBarSeparator,
  Select,
  SelectOption,
  ZoomControl,
} from "@caustic/react";
import { Maximize, Plus } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { cssPxOf, cssZoomOf } from "../../../../lib/zoom.ts";
import { useCraftTheme } from "../../orbit.tsx";
import { Detail, GroupDetail } from "./detail.tsx";
import { Edges, EdgeTags } from "./edges.tsx";
import { GlowGrid } from "./glow-grid.tsx";
import { PluginInside } from "./inside.tsx";
import { kindLabel, pointLabel, sideLabel } from "./labels.ts";
import { KindWell } from "./marks.tsx";
import {
  cardKey,
  effectiveNames,
  groupOfMember,
  layoutOf,
  membersAt,
  minIndexAt,
  nudgePlugin,
  outsideNames,
  placeOf,
  placePlugin,
  relatedKeys,
  removePlugin,
  samePlace,
  type CardBox,
  type Layout,
  type Place,
  type SlotBox,
} from "./model.ts";
import { GroupCard, PluginCard, Slot, Station, type CardHandlers } from "./nodes.tsx";
import { Palette } from "./palette.tsx";
import { useRealProfiles } from "./real.ts";
import { initialScene } from "../shared-sample.ts";
import { CATALOG, pluginOf, sampleProfiles, type SampleProfile } from "./sample.ts";
import { fitView, useSurface, zoomAround } from "./surface.ts";

/** 끄는 중. 포인터가 4px 넘게 움직여야 시작한다. 놓을 칸은 상태가 아니라 포인터 자리에서 매번 구한다 */
interface Drag {
  readonly name: string;
  readonly from: "palette" | "canvas";
  readonly place: Place;
  /** 캔버스 안 CSS px(고스트 자리) */
  readonly x: number;
  readonly y: number;
  readonly started: boolean;
  /** 목록 위에 있다(캔버스에서 끌어 빼기) */
  readonly overPalette: boolean;
}

const MOVE_THRESHOLD = 4;
const HEADER_H = 56;
const TOOLBAR_H = 72;
const NARROW = 1200;
const CATALOG_NAMES: readonly string[] = CATALOG.map((p) => p.name);

function slotName(box: SlotBox): string {
  if (box.place.lane === "drive") {
    return t("desktop.craft.canvas.cvC.slot.drive", { n: box.index + 1 });
  }
  return t("desktop.craft.canvas.cvC.slot.point", {
    point: pointLabel(box.place.point),
    side: sideLabel(box.place.side),
    n: box.index + 1,
  });
}

function slotKey(box: SlotBox): string {
  const where = box.place.lane === "drive" ? "drive" : `${box.place.point}/${box.place.side}`;
  return `${where}#${String(box.index)}`;
}

/** 세계 좌표(wx, wy)에서 가장 가까운 놓을 자리. 쉬는 배치(hot 없음)의 틈으로 재서 흔들리지 않는다 */
export function nearestSlot(idle: Layout, wx: number, wy: number): number {
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (const s of idle.slots) {
    const cx = s.rect.x + s.rect.w / 2;
    const cy = s.rect.y + s.rect.h / 2;
    const inX = wx > s.rect.x - 60 && wx < s.rect.x + s.rect.w + 60;
    const inY = wy > s.rect.y - 60 && wy < s.rect.y + s.rect.h + 60;
    if (inX && inY) {
      const d = Math.hypot(wx - cx, (wy - cy) * 1.4);
      if (d < dist) {
        dist = d;
        best = s.index;
      }
    }
  }
  return best;
}

export function ProfileCanvas(): ReactNode {
  const real = useRealProfiles();
  const [edits, setEdits] = useState<Readonly<Record<string, SampleProfile>>>({});
  const [profileId, setProfileId] = useState<string>(() => {
    const scene = initialScene();
    return scene === "empty" ? "blank" : scene;
  });
  const profiles = useMemo(
    () => [...sampleProfiles(), ...real].map((p) => edits[p.id] ?? p),
    [real, edits],
  );
  const onChange = useCallback((next: SampleProfile) => {
    setEdits((e) => ({ ...e, [next.id]: next }));
  }, []);
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];
  if (profile === undefined) return null;
  return (
    <Board
      key={profile.id}
      profile={profile}
      profiles={profiles}
      onProfile={setProfileId}
      onChange={onChange}
    />
  );
}

interface BoardProps {
  readonly profile: SampleProfile;
  readonly profiles: readonly SampleProfile[];
  readonly onProfile: (id: string) => void;
  readonly onChange: (next: SampleProfile) => void;
}

function Board(props: BoardProps): ReactNode {
  const { profile, onChange } = props;
  const reduced = useMotionReduced();
  const dark = useCraftTheme() === "dark";
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [placing, setPlacing] = useState<{ readonly name: string; readonly hot: number } | null>(
    null,
  );
  const [inside, setInside] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth >= NARROW);
  const viewportRef = useRef<HTMLDivElement>(null);
  const surface = useSurface(viewportRef);
  const { view, setView } = surface;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const justDragged = useRef(false);

  // 끌기·자리 고르기의 자리(놓을 수 있는 칸만 열린다)와 지금 위에 있는 칸
  const focusPlace = useMemo<Place | null>(() => {
    if (drag?.started === true) return drag.place;
    return placing === null ? null : placeOf(placing.name);
  }, [drag, placing]);
  const idle = useMemo(
    () =>
      focusPlace === null ? null : layoutOf(profile, collapsed, { place: focusPlace, hot: -1 }),
    [profile, collapsed, focusPlace],
  );
  const dragHot = useMemo(() => {
    if (drag === null || !drag.started || idle === null || drag.overPalette) return -1;
    return nearestSlot(idle, (drag.x - view.x) / view.k, (drag.y - view.y) / view.k);
  }, [drag, idle, view]);
  const hotIndex = drag?.started === true ? dragHot : (placing?.hot ?? -1);
  const layout = useMemo(
    () =>
      layoutOf(
        profile,
        collapsed,
        focusPlace === null ? null : { place: focusPlace, hot: hotIndex },
      ),
    [profile, collapsed, focusPlace, hotIndex],
  );

  // 놓기 처리(포인터를 뗀 때)가 읽는 최신 값
  const live = useRef({ drag, dragHot, profile });
  useLayoutEffect(() => {
    live.current = { drag, dragHot, profile };
  });

  // 크기. 처음 맞추기와 창 크기·목록 열림이 바뀔 때 다시 맞춘다(쉬는 배치의 테두리로)
  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const restBounds = useRef(layoutOf(profile, collapsed, null).bounds);
  useEffect(() => {
    restBounds.current = layoutOf(profile, collapsed, null).bounds;
  }, [profile, collapsed]);
  const fit = useCallback(() => {
    if (size.w === 0) return;
    setView(
      fitView(restBounds.current, size.w, size.h, {
        left: paletteOpen ? 268 : 24,
        // 앱 오른쪽 세로 막대(48)를 비킨다
        right: 56,
        top: HEADER_H,
        bottom: TOOLBAR_H,
      }),
    );
  }, [size, paletteOpen, setView]);
  useEffect(() => {
    fit();
  }, [fit]);

  // 선택한 것과 이어진 것
  const hot = useMemo(
    () => (selected === null ? new Set<string>() : relatedKeys(layout, selected)),
    [layout, selected],
  );

  // ── 끌기 ──
  const startPress = useCallback(
    (name: string, from: Drag["from"], e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const place = placeOf(name);
      if (place === null || pluginOf(name) === undefined) return;
      if (from === "canvas" && !live.current.profile.plugins.includes(name)) return;
      e.stopPropagation();
      const el = viewportRef.current;
      if (el === null) return;
      const zoom = cssZoomOf(el);
      const origin = { x: e.clientX, y: e.clientY };
      const local = (cx: number, cy: number): { x: number; y: number } => {
        const r = el.getBoundingClientRect();
        return { x: cssPxOf(cx - r.left, zoom), y: cssPxOf(cy - r.top, zoom) };
      };
      const p0 = local(e.clientX, e.clientY);
      setDrag({ name, from, place, x: p0.x, y: p0.y, started: false, overPalette: false });
      const move = (ev: globalThis.PointerEvent): void => {
        const moved = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > MOVE_THRESHOLD;
        const p = local(ev.clientX, ev.clientY);
        const overPalette = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .some((n) => n.closest("[data-cvc-palette-panel]") !== null);
        setDrag((d) =>
          d === null ? d : { ...d, started: d.started || moved, x: p.x, y: p.y, overPalette },
        );
      };
      const stop = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
      };
      const up = (): void => {
        stop();
        const now = live.current;
        const d = now.drag;
        if (d !== null && d.started) {
          // 끌기 뒤에 따라오는 click은 고르기로 치지 않는다
          justDragged.current = true;
          window.setTimeout(() => {
            justDragged.current = false;
          }, 0);
          if (now.dragHot >= 0) {
            onChange(placePlugin(now.profile, d.name, d.place, now.dragHot));
            setSelected(d.name);
          } else if (d.overPalette && d.from === "canvas") {
            onChange(removePlugin(now.profile, d.name));
            setSelected(null);
          }
        }
        setDrag(null);
      };
      const cancel = (): void => {
        stop();
        setDrag(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    },
    [onChange],
  );

  // ── 키보드로 놓기: 첫 자리에 초점 ──
  const placingName = placing?.name ?? null;
  useEffect(() => {
    if (placingName === null) return;
    viewportRef.current?.querySelector<HTMLButtonElement>("[data-cvc-slot]")?.focus();
  }, [placingName]);
  const focusCard = (key: string): void => {
    window.requestAnimationFrame(() => {
      viewportRef.current?.querySelector<HTMLElement>(`[data-cvc-card="${key}"]`)?.focus();
    });
  };
  const placeAt = (box: SlotBox): void => {
    if (placing === null) return;
    onChange(placePlugin(profile, placing.name, box.place, box.index));
    setSelected(placing.name);
    focusCard(placing.name);
    setPlacing(null);
  };

  // ── 카드 ──
  const remove = (name: string): void => {
    if (!profile.plugins.includes(name)) return;
    onChange(removePlugin(profile, name));
    setSelected(null);
  };
  const toggleGroup = (id: string): void => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelected(null);
  };
  const onCardKey = (key: string, e: KeyboardEvent<HTMLElement>): void => {
    const group = key.startsWith("group:") ? key.slice("group:".length) : null;
    if (e.key === "Enter") {
      e.preventDefault();
      if (group === null) setInside(key);
      else toggleGroup(group);
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      return;
    }
    const arrow = e.key.startsWith("Arrow");
    if (group === null && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      remove(key);
      return;
    }
    if (!arrow) return;
    e.preventDefault();
    const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    if (e.altKey && group === null) {
      onChange(nudgePlugin(profile, key, back ? -1 : 1));
      setSelected(key);
      focusCard(key);
      return;
    }
    const order = layout.cards.map((c) => cardKey(c.card));
    const i = order.indexOf(key);
    const next = order[(i + (back ? -1 : 1) + order.length) % order.length];
    if (next !== undefined) focusCard(next);
  };
  const handlers: CardHandlers = {
    onSelect: (key) => {
      if (justDragged.current) return;
      setSelected((s) => (s === key ? null : key));
    },
    onOpen: (name) => setInside(name),
    onPress: (key, e) => startPress(key, "canvas", e),
    onToggleGroup: toggleGroup,
    onKey: onCardKey,
  };

  // ── 바탕 ──
  const onBackgroundDown = (e: PointerEvent<HTMLDivElement>): void => {
    const target = e.target;
    if (target instanceof Element && target.closest("button,aside") !== null) return;
    setSelected(null);
    surface.onPanStart(e);
  };
  const onViewportKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      setPlacing(null);
      setSelected(null);
      return;
    }
    if (e.target !== e.currentTarget) return;
    const step = 48;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const moves: Readonly<Record<string, () => void>> = {
      "+": () => setView(zoomAround(view, 1.2, cx, cy)),
      "=": () => setView(zoomAround(view, 1.2, cx, cy)),
      "-": () => setView(zoomAround(view, 1 / 1.2, cx, cy)),
      "0": fit,
      ArrowLeft: () => setView({ ...view, x: view.x + step }),
      ArrowRight: () => setView({ ...view, x: view.x - step }),
      ArrowUp: () => setView({ ...view, y: view.y + step }),
      ArrowDown: () => setView({ ...view, y: view.y - step }),
    };
    const run = moves[e.key];
    if (run === undefined) return;
    e.preventDefault();
    run();
  };

  // 배경 빛의 초점: 끄는 고스트, 아니면 고른 장
  const selectedBox =
    selected === null ? undefined : layout.cards.find((c) => cardKey(c.card) === selected);
  const dragging = drag?.started === true;
  const glow = dragging
    ? { x: drag.x, y: drag.y, strength: 1 }
    : selectedBox === undefined
      ? null
      : {
          x: view.x + (selectedBox.rect.x + selectedBox.rect.w / 2) * view.k,
          y: view.y + (selectedBox.rect.y + selectedBox.rect.h / 2) * view.k,
          strength: 0.8,
        };
  const opening = focusPlace !== null;

  const renderCard = (box: CardBox): ReactNode => {
    const key = cardKey(box.card);
    const dimmed =
      (selected !== null && !hot.has(key)) ||
      (focusPlace !== null && !samePlace(box.place, focusPlace));
    if (box.card.type === "group") {
      return (
        <GroupCard
          key={key}
          box={box}
          group={box.card.group}
          kinds={box.card.kinds}
          selected={selected === key}
          dimmed={dimmed}
          reduced={reduced}
          on={handlers}
        />
      );
    }
    const member = box.card;
    const tab = groupOfMember(profile, member.name);
    return (
      <PluginCard
        key={key}
        box={box}
        member={member}
        on={handlers}
        state={{
          selected: selected === key,
          dimmed,
          reduced,
          tab: tab !== null && !collapsed.has(tab.id) ? tab : null,
          start: profile.startDrive === member.name,
          lifted: dragging && drag.name === member.name,
        }}
      />
    );
  };

  const panel = ((): ReactNode => {
    if (selectedBox === undefined) return null;
    if (selectedBox.card.type === "group") {
      const group = selectedBox.card.group;
      return (
        <GroupDetail
          group={group}
          onClose={() => setSelected(null)}
          onToggle={() => toggleGroup(group.id)}
        />
      );
    }
    const m = selectedBox.card;
    const at = selectedBox.place;
    const count = membersAt(profile, at).length;
    const mine = profile.plugins.includes(m.name);
    return (
      <Detail
        member={m}
        place={at}
        index={selectedBox.index}
        start={profile.startDrive === m.name}
        canUp={mine && selectedBox.index > minIndexAt(profile, at)}
        canDown={mine && selectedBox.index < count - 1}
        group={groupOfMember(profile, m.name)}
        onClose={() => setSelected(null)}
        onOpen={() => setInside(m.name)}
        onRemove={() => remove(m.name)}
        onNudge={(d) => onChange(nudgePlugin(profile, m.name, d))}
      />
    );
  })();

  const empty = profile.plugins.length === 0;
  const zoomBy = (f: number): void => setView(zoomAround(view, f, size.w / 2, size.h / 2));
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-bg-canvas" data-cvc-root="">
      <div inert={inside !== null} className="absolute inset-0">
        <div
          ref={viewportRef}
          role="application"
          aria-label={t("desktop.craft.canvas.cvC.canvas.label", { name: profile.title })}
          aria-roledescription={t("desktop.craft.canvas.cvC.canvas.role")}
          tabIndex={0}
          onPointerDown={onBackgroundDown}
          onKeyDown={onViewportKey}
          className={`absolute inset-0 overflow-hidden outline-none ${
            surface.panning || dragging ? "cursor-grabbing select-none" : "cursor-default"
          }`}
        >
          <GlowGrid view={view} dark={dark} focus={glow} />
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{
              transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.k)})`,
            }}
          >
            <Edges layout={layout} hot={hot} startDrive={profile.startDrive} dimmed={opening} />
            {layout.stations.map((s) => (
              <Station key={s.point} box={s} dragging={opening} reduced={reduced} />
            ))}
            <EdgeTags layout={layout} dimmed={opening} />
            {layout.cards.map(renderCard)}
            {layout.slots.map((box) => (
              <Slot
                key={slotKey(box)}
                box={box}
                label={slotName(box)}
                keyboard={placing !== null}
                reduced={reduced}
                onPlace={placeAt}
                onFocusSlot={(b) => setPlacing((p) => (p === null ? p : { ...p, hot: b.index }))}
              />
            ))}
            {empty && !opening && <EmptyHint layout={layout} />}
          </div>
          {placing !== null && (
            <p className="pointer-events-none absolute bottom-20 left-1/2 m-0 -translate-x-1/2 rounded-full bg-ink-solid px-3 py-1 text-ui-sm text-ink-on">
              {t("desktop.craft.canvas.cvC.placing", { name: placing.name })}
            </p>
          )}
        </div>

        {/* 위: 지금 보는 프로필(늘 보인다) */}
        <div
          className="pointer-events-auto absolute top-3 z-20 flex h-10 items-center gap-1 rounded-2xl bg-material-regular pr-1 pl-3.5 shadow-2"
          style={{ left: paletteOpen ? 268 : 64 }}
        >
          <span className="text-ui-sm whitespace-nowrap text-text-tertiary">
            {t("desktop.craft.canvas.cvC.profile")}
          </span>
          <span className="text-text-tertiary">/</span>
          <Select
            size="sm"
            variant="ghost"
            aria-label={t("desktop.craft.canvas.cvC.profilePick")}
            value={profile.id}
            onValueChange={props.onProfile}
            className="min-w-24 text-ui-strong"
          >
            {props.profiles.map((p) => (
              <SelectOption key={p.id} value={p.id}>
                {p.title}
              </SelectOption>
            ))}
          </Select>
        </div>

        <Palette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((o) => !o)}
          outside={outsideNames(profile, CATALOG_NAMES)}
          inside={effectiveNames(profile)}
          selected={selected}
          onPress={(name, e) => startPress(name, "palette", e)}
          onKeyboardPlace={(name) => setPlacing({ name, hot: -1 })}
          onLocate={(name) => setSelected(name)}
        />

        {panel}

        {/* 아래 가운데: 떠 있는 도구 막대 */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
          <FloatingBar
            label={t("desktop.craft.canvas.cvC.toolbar")}
            size="sm"
            className="pointer-events-auto"
          >
            <FloatingBarItem
              icon={<Plus aria-hidden />}
              aria-label={t("desktop.craft.canvas.cvC.add")}
              onClick={() => {
                setPaletteOpen(true);
                window.requestAnimationFrame(() => {
                  document.querySelector<HTMLElement>("[data-cvc-palette]")?.focus();
                });
              }}
            />
            <FloatingBarSeparator />
            <ZoomControl
              variant="ghost"
              size="sm"
              readout="static"
              value={`${String(Math.round(view.k * 100))}%`}
              label={t("desktop.craft.canvas.cvC.zoom")}
              zoomOutLabel={t("desktop.craft.canvas.cvC.zoomOut")}
              zoomInLabel={t("desktop.craft.canvas.cvC.zoomIn")}
              onZoomOut={() => zoomBy(1 / 1.2)}
              onZoomIn={() => zoomBy(1.2)}
            />
            <FloatingBarSeparator />
            <FloatingBarItem
              icon={<Maximize aria-hidden />}
              aria-label={t("desktop.craft.canvas.cvC.fit")}
              onClick={fit}
            />
          </FloatingBar>
        </div>

        {dragging && (
          <Ghost
            name={drag.name}
            x={drag.x}
            y={drag.y}
            removing={drag.overPalette && drag.from === "canvas"}
          />
        )}
      </div>
      {inside !== null && (
        <div className="absolute inset-0 z-40 flex">
          <PluginInside
            name={inside}
            profileTitle={profile.title}
            onBack={() => {
              const name = inside;
              setInside(null);
              focusCard(name);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** 끄는 동안 포인터를 따라오는 카드. 목록 위로 끌어내면 빼기 표시 */
function Ghost(props: {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly removing: boolean;
}): ReactNode {
  const p = pluginOf(props.name);
  if (p === undefined) return null;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-0 left-0 z-30 flex h-[52px] w-[188px] items-center gap-2.5 rounded-xl bg-surface-raised pr-3 pl-2.5 shadow-4 ${
        props.removing ? "opacity-60 ring-1 ring-danger-border" : "ring-1 ring-accent-border"
      }`}
      style={{
        translate: `${String(props.x - 28)}px ${String(props.y - 26)}px`,
        rotate: "-1.5deg",
      }}
    >
      <KindWell kind={p.kind} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ui-strong text-text-primary">{props.name}</span>
        <span className="truncate text-ui-xs text-text-tertiary">
          {props.removing ? t("desktop.craft.canvas.cvC.detail.remove") : kindLabel(p.kind)}
        </span>
      </span>
    </div>
  );
}

/** 빈 프로필: 턴 틀 가운데 아래쪽에 조용한 안내 한 장 */
function EmptyHint(props: { readonly layout: Layout }): ReactNode {
  const f = props.layout.frame;
  return (
    <div
      className="pointer-events-none absolute top-0 left-0 flex w-[300px] flex-col items-center gap-3 text-center"
      style={{ translate: `${String(f.x + f.w / 2 - 150)}px ${String(f.y + f.h + 36)}px` }}
    >
      <svg
        aria-hidden
        width="132"
        height="56"
        viewBox="0 0 132 56"
        fill="none"
        className="text-text-tertiary"
      >
        <rect
          x="1"
          y="12"
          width="64"
          height="34"
          rx="9"
          stroke="currentColor"
          strokeDasharray="3 4"
        />
        <rect x="9" y="21" width="16" height="16" rx="4" stroke="currentColor" />
        <path d="M33 25h22M33 33h14" stroke="currentColor" strokeLinecap="round" />
        <path
          d="M72 29c16 0 22-16 40-16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray="2 4"
        />
        <path
          d="M106 9l7 4-6 5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="m-0 text-ui text-text-secondary">{t("desktop.craft.canvas.cvC.empty")}</p>
    </div>
  );
}
