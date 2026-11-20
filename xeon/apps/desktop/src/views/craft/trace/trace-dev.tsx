// 트레이스 화면의 표본 장면 고르기(개발 빌드만, `BUILD_CHECKS`). 창 왼쪽 아래의 작은 칸 하나.
// 장면 "실제 엔진"은 실제 원천이다. 다만 메트릭 표본의 근거 줄에서 왔으면(대화 `thr_sample`) 표본 턴을 보인다.
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다).
import { t, type MessageId } from "@fresnel/client/i18n";
import { attempt } from "@fresnel/contracts";
import { Select, SelectOption } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useShellActions } from "../../../state/shell/index.ts";
import { SAMPLE_THREAD, TRACE_SCENES, sampleTrace, type TraceScene } from "./sample.ts";
import type { TraceData } from "./source.ts";
import { TraceView } from "./trace-view.tsx";

const SCENE_KEY = "fresnel.craft.trace.scene";

const SCENE_WORD: Readonly<Record<TraceScene, MessageId>> = {
  live: "desktop.craft.metrics.dev.scene.live",
  sample: "desktop.craft.metrics.dev.scene.sample",
  running: "desktop.craft.trace.dev.running",
  pending: "desktop.craft.trace.dev.pending",
  partial: "desktop.craft.trace.dev.partial",
  many: "desktop.craft.metrics.dev.scene.many",
  empty: "desktop.craft.metrics.dev.scene.empty",
  absent: "desktop.craft.trace.dev.absent",
  nothread: "desktop.craft.trace.dev.nothread",
  loading: "desktop.craft.metrics.dev.scene.loading",
  failed: "desktop.craft.metrics.dev.scene.failed",
  offline: "desktop.craft.metrics.dev.scene.offline",
};

function isScene(value: string | null): value is TraceScene {
  return TRACE_SCENES.some((scene) => scene === value);
}

function readScene(): TraceScene {
  const read = attempt(() => localStorage.getItem(SCENE_KEY));
  const value = read.ok ? read.value : null;
  return isScene(value) ? value : "live";
}

export function TraceDev(props: { readonly live: TraceData }): ReactNode {
  const shell = useShellActions();
  const [scene, setScene] = useState<TraceScene>(readScene);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const fromSample = props.live.threadId === SAMPLE_THREAD;
  const shown: TraceScene = scene === "live" && fromSample ? "sample" : scene;
  const data =
    shown === "live"
      ? props.live
      : sampleTrace(
          shown,
          { turnId: turnId ?? (fromSample ? props.live.turnId : null), pages },
          {
            pick: setTurnId,
            more: () => {
              setPages((n) => n + 1);
            },
            back: () => {
              shell.updatePlace({ screen: "craft-metrics", scroll: 0 });
            },
          },
        );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <TraceView key={shown} data={data} />
      <div
        data-trace-switcher=""
        className="fixed bottom-2 left-24 z-40 flex items-center gap-1 opacity-55 transition-opacity focus-within:opacity-100 hover:opacity-100"
      >
        <Select
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.metrics.dev.scene")}
          value={scene}
          onValueChange={(value) => {
            if (!isScene(value)) return;
            attempt(() => {
              localStorage.setItem(SCENE_KEY, value);
            });
            setScene(value);
          }}
        >
          {TRACE_SCENES.map((s) => (
            <SelectOption key={s} value={s}>
              {t(SCENE_WORD[s])}
            </SelectOption>
          ))}
        </Select>
      </div>
    </div>
  );
}
