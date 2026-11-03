// 찾기와 확대 막대(지도의 왼쪽 아래). 찾기는 글을 state.query에 넣고, 맞는 점은 지도에서 밝고 나머지는 흐려진다.
// 확대 막대는 시점을 쥔 훅을 받아 단계 확대·축소와 전체 보기만 한다.
import {
  FloatingBar,
  FloatingBarItem,
  FloatingBarSeparator,
  Input,
  ZoomControl,
} from "@caustic/react";
import { Maximize, Search } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useCraft } from "./craft-context.tsx";
import { matchesQuery } from "./orbit-model.ts";

export function Finder(): ReactNode {
  const { source, state, dispatch } = useCraft();
  const query = state.query;
  const found =
    query.trim() === ""
      ? null
      : source.snapshot.plugins.filter((p) => matchesQuery(p, query)).length;
  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <Input
        type="search"
        size="sm"
        variant="solid"
        radius="2xl"
        prefix={<Search aria-hidden />}
        value={query}
        onValueChange={(v) => dispatch({ t: "query", query: v })}
        placeholder={t("desktop.craft.orbit.finder.placeholder")}
        aria-label={t("desktop.craft.orbit.finder.label")}
        containerClassName="craft-glass w-48"
      />
      {found !== null && (
        <span role="status" className="text-footnote text-text-secondary">
          {t("desktop.craft.orbit.finder.count", { n: found })}
        </span>
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
