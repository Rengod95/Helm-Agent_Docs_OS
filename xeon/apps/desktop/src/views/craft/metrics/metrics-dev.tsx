// 메트릭 화면의 판 전환기와 표본 장면(개발 빌드만, `BUILD_CHECKS`). 창 왼쪽 아래의 작은 칸: `가 │ 나`와 장면 고르기.
// 장면 "실제 엔진"은 실제 원천을 그대로 쓰고 나머지는 `sample.ts`의 표본이다. 표본의 "이 턴 보기"도 트레이스로 간다(표본 턴).
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다). 키보드 1·2는 판을 바꾼다(글자 입력 중 제외).
import { t, type MessageId } from "@fresnel/client/i18n";
import { attempt } from "@fresnel/contracts";
import { Select, SelectOption, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useShellActions } from "../../../state/shell/index.ts";
import { openTrace } from "../trace/target.ts";
import { DEFAULT_FILTER, type MetricsFilter } from "./model.ts";
import { MetricsView, type MetricsLayout } from "./metrics-view.tsx";
import { SCENES, sampleData, type Scene } from "./sample.ts";
import type { MetricsData } from "./source.ts";

const LAYOUT_KEY = "fresnel.craft.metrics.layout";
const SCENE_KEY = "fresnel.craft.metrics.scene";

const SCENE_WORD: Readonly<Record<Scene, MessageId>> = {
  live: "desktop.craft.metrics.dev.scene.live",
  sample: "desktop.craft.metrics.dev.scene.sample",
  empty: "desktop.craft.metrics.dev.scene.empty",
  loading: "desktop.craft.metrics.dev.scene.loading",
  failed: "desktop.craft.metrics.dev.scene.failed",
  offline: "desktop.craft.metrics.dev.scene.offline",
  unsupported: "desktop.craft.metrics.dev.scene.unsupported",
  off: "desktop.craft.metrics.dev.scene.off",
  many: "desktop.craft.metrics.dev.scene.many",
};

function isScene(value: string | null): value is Scene {
  return SCENES.some((scene) => scene === value);
}

function readKey(key: string): string | null {
  const read = attempt(() => localStorage.getItem(key));
  return read.ok ? read.value : null;
}

function writeKey(key: string, value: string): void {
  // 저장이 막힌 창(개인 창, 미리 보기)에서는 이번 실행에만 남는다
  attempt(() => {
    localStorage.setItem(key, value);
  });
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || target.closest("input, textarea, select, [role='textbox']") !== null
  );
}

export function MetricsDev(props: { readonly live: MetricsData }): ReactNode {
  const shell = useShellActions();
  const [layout, setLayout] = useState<MetricsLayout>(() =>
    readKey(LAYOUT_KEY) === "charts" ? "charts" : "insights",
  );
  const [scene, setScene] = useState<Scene>(() => {
    const stored = readKey(SCENE_KEY);
    return isScene(stored) ? stored : "live";
  });
  const [filter, setFilter] = useState<MetricsFilter>(DEFAULT_FILTER);
  const data =
    scene === "live"
      ? props.live
      : sampleData(scene, filter, setFilter, {
          openTurn: (ref) => {
            if (ref.kind === "backtest") return;
            openTrace({ threadId: ref.threadId, turnId: ref.turnId, from: "metrics" });
            shell.updatePlace({ screen: "trace", scroll: 0 });
          },
        });
  const chooseLayout = (value: string): void => {
    const next: MetricsLayout = value === "charts" ? "charts" : "insights";
    writeKey(LAYOUT_KEY, next);
    setLayout(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || typing(e.target)) return;
      if (e.key !== "1" && e.key !== "2") return;
      const next: MetricsLayout = e.key === "1" ? "insights" : "charts";
      writeKey(LAYOUT_KEY, next);
      setLayout(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MetricsView key={`${scene}:${layout}`} data={data} layout={layout} />
      <div
        data-metrics-switcher=""
        className="fixed bottom-2 left-24 z-40 flex items-center gap-1 opacity-55 transition-opacity focus-within:opacity-100 hover:opacity-100"
      >
        <SegmentedControl
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.metrics.dev.pick")}
          value={layout}
          onValueChange={chooseLayout}
        >
          <SegmentedControlItem
            value="insights"
            aria-label={t("desktop.craft.metrics.dev.a")}
            title={`${t("desktop.craft.metrics.dev.a")} · 1`}
            className="font-semibold"
          >
            {t("desktop.craft.metrics.dev.aShort")}
          </SegmentedControlItem>
          <SegmentedControlItem
            value="charts"
            aria-label={t("desktop.craft.metrics.dev.b")}
            title={`${t("desktop.craft.metrics.dev.b")} · 2`}
            className="font-semibold"
          >
            {t("desktop.craft.metrics.dev.bShort")}
          </SegmentedControlItem>
        </SegmentedControl>
        <Select
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.metrics.dev.scene")}
          value={scene}
          onValueChange={(value) => {
            if (!isScene(value)) return;
            writeKey(SCENE_KEY, value);
            setScene(value);
          }}
        >
          {SCENES.map((s) => (
            <SelectOption key={s} value={s}>
              {t(SCENE_WORD[s])}
            </SelectOption>
          ))}
        </Select>
      </div>
    </div>
  );
}
