// 메트릭 화면의 표본 장면 고르기(개발 빌드만, `BUILD_CHECKS`). 셋째 판(m6X3): 리뷰 화면처럼 화면 머리 오른쪽 끝의 작은 메뉴
// ("표본 · <장면>")다. 창 왼쪽 아래 구석은 옆 내비의 설정 줄과 아래 띠에 묻혀 묶인 앱에서 찾기 어려웠다.
// 판 전환기(가·나)는 사용자가 나의 짜임을 고르며 뺐다(2026-11-20). 장면 "실제 엔진"은 실제 원천을 그대로 쓰고
// 나머지는 `sample.ts`의 표본이다. 표본의 "이 턴 보기"와 최근 턴도 트레이스로 간다(표본 턴).
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다).
import type { MessageId } from "@fresnel/client/i18n";
import { attempt } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useShellActions } from "../../../state/shell/index.ts";
import { openTrace } from "../trace/target.ts";
import { DEFAULT_FILTER, type MetricsFilter } from "./model.ts";
import { MetricsView } from "./metrics-view.tsx";
import { SceneMenu } from "./scene-menu.tsx";
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
  const menu = (
    <SceneMenu
      scenes={SCENES}
      words={SCENE_WORD}
      value={scene}
      marker="metrics"
      onPick={(next) => {
        writeKey(SCENE_KEY, next);
        setScene(next);
      }}
    />
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MetricsView key={scene} data={data} dev={menu} />
    </div>
  );
}
