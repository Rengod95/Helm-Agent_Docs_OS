// 찾기와 확대 막대(지도의 왼쪽 아래). 찾기는 글을 state.query에 넣고, 맞는 점은 지도에서 밝고 나머지는 흐려진다.
// 확대 막대는 시점을 쥔 훅을 받아 단계 확대·축소와 전체 보기만 한다.
import {
  Card,
  FloatingBar,
  FloatingBarItem,
  FloatingBarSeparator,
  Input,
  List,
  ListRow,
  ZoomControl,
} from "@caustic/react";
import { Maximize, Search } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { useRef, useState, type ReactNode } from "react";
import { useCraft } from "./craft-context.tsx";
import { matchesQuery } from "./orbit-model.ts";
import { layerName } from "./orbit-names.ts";

/** 찾기 목록에 보이는 최대 개수. 나머지는 글을 좁혀 본다 */
const HIT_MAX = 8;

/**
 * 찾기 칸과 그 결과 목록(칸 위로 열린다). 글은 state.query에 들어가 지도의 맞는 점을 밝힌다.
 * 목록의 한 줄을 누르면 그 플러그인을 고르고 글을 지운다. 개수는 화면 글이 아니라 읽기 쉬운 상태 글로만 준다.
 */
export function Finder(): ReactNode {
  const { source, state, dispatch } = useCraft();
  const query = state.query;
  const needle = query.trim();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hits = needle === "" ? [] : source.snapshot.plugins.filter((p) => matchesQuery(p, query));
  const shown = hits.slice(0, HIT_MAX);
  return (
    <div
      ref={box}
      className="pointer-events-auto relative"
      onBlur={(e) => {
        // 목록 안의 줄로 초점이 옮겨 가면 닫지 않는다
        if (!(e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget) === true))
          setOpen(false);
      }}
    >
      <Input
        type="search"
        size="sm"
        variant="solid"
        radius="2xl"
        prefix={<Search aria-hidden />}
        value={query}
        onValueChange={(v) => {
          dispatch({ t: "query", query: v });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("desktop.craft.orbit.finder.placeholder")}
        aria-label={t("desktop.craft.orbit.finder.label")}
        containerClassName="craft-glass w-48"
      />
      {needle !== "" && (
        <span role="status" className="sr-only">
          {t("desktop.craft.orbit.finder.count", { n: hits.length })}
        </span>
      )}
      {open && needle !== "" && (
        <Card
          variant="surface"
          size="xs"
          shadow="4"
          className="craft-glass absolute bottom-11 left-0 z-30 w-80"
        >
          {shown.length === 0 ? (
            <span className="px-2 py-1.5 text-body text-text-tertiary">
              {t("desktop.craft.orbit.finder.empty")}
            </span>
          ) : (
            <List
              size="xs"
              variant="ghost"
              dividers={false}
              aria-label={t("desktop.craft.orbit.finder.results")}
            >
              {shown.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.name}
                  value={layerName(p.layer)}
                  description={p.role}
                  onClick={() => {
                    dispatch({ t: "selectPlugin", id: p.id });
                    dispatch({ t: "query", query: "" });
                    setOpen(false);
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

export function ZoomBar({
  percent,
  onZoom,
  onFit,
}: {
  readonly percent: number;
  readonly onZoom: (direction: "in" | "out") => void;
  readonly onFit: () => void;
}): ReactNode {
  return (
    <FloatingBar
      label={t("desktop.craft.orbit.zoom.label")}
      size="sm"
      className="craft-glass pointer-events-auto"
    >
      <ZoomControl
        variant="ghost"
        size="sm"
        readout="static"
        value={`${percent}%`}
        label={t("desktop.craft.orbit.zoom.group")}
        zoomOutLabel={t("desktop.craft.orbit.zoom.out")}
        zoomInLabel={t("desktop.craft.orbit.zoom.in")}
        onZoomOut={() => onZoom("out")}
        onZoomIn={() => onZoom("in")}
      />
      <FloatingBarSeparator />
      <FloatingBarItem
        icon={<Maximize aria-hidden />}
        aria-label={t("desktop.craft.orbit.zoom.fit")}
        onClick={onFit}
      />
    </FloatingBar>
  );
}
