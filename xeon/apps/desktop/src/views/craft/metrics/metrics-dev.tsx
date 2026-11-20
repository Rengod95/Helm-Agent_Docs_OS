// 메트릭 화면의 표본 장면 고르기(개발 빌드만, `BUILD_CHECKS`). 창 왼쪽 아래의 작은 칸 하나.
// 판 전환기(가·나)는 사용자가 나의 짜임을 고르며 뺐다(2026-11-20). 장면 "실제 엔진"은 실제 원천을 그대로 쓰고
// 나머지는 `sample.ts`의 표본이다. 표본의 "이 턴 보기"와 최근 턴도 트레이스로 간다(표본 턴).
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다).
import { t, type MessageId } from "@fresnel/client/i18n";
import { attempt } from "@fresnel/contracts";
import { Select, SelectOption } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useShellActions } from "../../../state/shell/index.ts";
import { openTrace } from "../trace/target.ts";
import { DEFAULT_FILTER, type MetricsFilter } from "./model.ts";
import { MetricsView } from "./metrics-view.tsx";
import { SCENES, sampleData, type Scene } from "./sample.ts";
import type { MetricsData } from "./source.ts";

const SCENE_KEY = "fresnel.craft.metrics.scene";

const SCENE_WORD: Readonly<Record<Scene, MessageId>> = {
  live: "desktop.craft.metrics.dev.scene.live",
  sample: "desktop.craft.metrics.dev.scene.sample",
  few: "desktop.craft.metrics.dev.scene.few",
  quiet: "desktop.craft.metrics.dev.scene.quiet",
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

export function MetricsDev(props: { readonly live: MetricsData }): ReactNode {
  const shell = useShellActions();
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
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MetricsView key={scene} data={data} />
      <div
        data-metrics-switcher=""
        className="fixed bottom-2 left-24 z-40 flex items-center gap-1 opacity-55 transition-opacity focus-within:opacity-100 hover:opacity-100"
      >
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
