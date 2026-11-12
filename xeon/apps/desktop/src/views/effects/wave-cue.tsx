// 화면 전체 물결을 띄우는 때(DP-161). 앱 뿌리(app.tsx)에 하나 둔다. 그리는 것은 없다.
// (가) 첫 진입: 창이 처음 그려진 직후 한 번. (나) 작업 완료: 열어 둔 대화에서 이 화면이 도는 것을 본 턴이 정상으로 끝났고 fx-config의 조건
// (도구를 쓴 턴 또는 긴 턴, 앞 물결과 간격)을 채울 때. 멈춤·실패·한도·승인 대기, 보고 있지 않은 대화(다른 대화, 입력창이 화면에 없음)에는 띄우지 않는다.

import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import { useEffect, useRef, type ReactNode } from "react";
import { useOpenThreadId, useTurnSummaries } from "../../state/engine/index.ts";
import { waveDueOnDone } from "./fx-config.ts";
import { playWave } from "./wave-overlay.ts";
import type { WaveRect } from "./wave-front.ts";

/** 첫 진입 물결을 이 앱 실행에서 띄웠나 */
let introPlayed = false;
/** 마지막 물결을 띄운 때(ms). 연달아 끝나는 턴에 간격을 둔다 */
let lastWaveAt: number | null = null;

/** 첫 그림이 화면에 오른 뒤 기다리는 시간(ms). 글꼴과 대화 목록이 자리 잡은 뒤에 지나가게 한다 */
const INTRO_DELAY_MS = 240;

/** 입력창 상자. 물결이 여기서 떠난다. 화면에 없으면 대화를 보고 있지 않은 것이다 */
function composerSource(): WaveRect | null {
  const box = document.querySelector(".composer-box");
  if (box === null) return null;
  const r = box.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function DoneWatch(props: { readonly threadId: ThreadId }): ReactNode {
  const turns = useTurnSummaries(props.threadId);
  /** 이 화면이 도는 것을 본 턴. 열기 전에 끝난 턴(불러온 기록)에는 띄우지 않는다 */
  const seen = useRef(new Set<TurnId>());
  useEffect(() => {
    for (const turn of turns) {
      if (turn.running) {
        seen.current.add(turn.turnId);
        continue;
      }
      if (!seen.current.delete(turn.turnId) || turn.end === null) continue;
      const now = Date.now();
      const since = lastWaveAt === null ? null : now - lastWaveAt;
      const finished = { endKind: turn.end.kind, steps: turn.steps, durationMs: turn.durationMs };
      if (!waveDueOnDone(finished, since)) continue;
      const source = composerSource();
      if (source === null) continue;
      lastWaveAt = now;
      playWave({ cause: "done", source });
    }
  }, [turns]);
  return null;
}

export function WaveCue(): ReactNode {
  const threadId = useOpenThreadId();
  useEffect(() => {
    if (introPlayed) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 두 번 기다려 첫 그림이 실제로 화면에 오른 뒤에 센다
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        introPlayed = true;
        lastWaveAt = Date.now();
        playWave({ cause: "intro" });
      }, INTRO_DELAY_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return threadId === null ? null : <DoneWatch key={threadId} threadId={threadId} />;
}
