// 화면 전체 물결을 띄우는 때(DP-161). 앱 뿌리(app.tsx)에 하나 둔다. 그리는 것은 없다.
// (가) 첫 진입: 창이 처음 그려진 직후 한 번. (나) 작업 완료: 열어 둔 대화에서 이 화면이 도는 것을 본 턴이 정상으로 끝났고 fx-config의 조건
// (도구를 쓴 턴 또는 긴 턴, 앞 물결과 간격)을 채울 때. 멈춤·실패·한도·승인 대기, 보고 있지 않은 대화(다른 대화, 입력창이 화면에 없음)에는 띄우지 않는다.
// 떠나는 자리(DP-166): 둘 다 입력창이다. 사람이 말을 건 곳이고, 원본의 `.vertical`처럼 화면 아래 넓은 원천에서 위로 퍼진다.
// 첫 진입에 입력창이 없으면(설정 화면 등) 아래 가운데 알약에서 떠난다. 렌즈가 찍을 그림이 마지막 답의 자리 잡기를 담도록 턴 끝은 잠깐 기다린다.

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

/** 첫 진입: 화면(DOM)이 이만큼 조용하면 자리를 잡은 것으로 본다(ms). 렌즈가 그 화면을 찍는다 */
const INTRO_QUIET_MS = 300;
/** 첫 진입: 조용해지기를 기다리는 상한(ms). 넘으면 그때 띄운다(렌즈는 overlay가 낡은 그림을 걷는다) */
const INTRO_MAX_WAIT_MS = 3000;
/** 턴이 끝난 뒤 기다리는 시간(ms). 마지막 답의 마크다운 마무리와 줄 높이 재기가 끝난 화면을 찍는다 */
const DONE_SETTLE_MS = 160;

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
  /** 자리 잡기를 기다리는 물결. 대화를 떠나면 띄우지 않는다 */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      pending.current = setTimeout(() => {
        pending.current = null;
        playWave({ cause: "done", source: composerSource() ?? source });
      }, DONE_SETTLE_MS);
    }
  }, [turns]);
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );
  return null;
}

export function WaveCue(): ReactNode {
  const threadId = useOpenThreadId();
  useEffect(() => {
    if (introPlayed) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = performance.now();
    const fire = (): void => {
      observer.disconnect();
      introPlayed = true;
      lastWaveAt = Date.now();
      const source = composerSource();
      playWave(source === null ? { cause: "intro" } : { cause: "intro", source });
    };
    // 바뀔 때마다 다시 센다. 상한을 넘으면 기다리지 않는다
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer);
      const left = INTRO_MAX_WAIT_MS - (performance.now() - startedAt);
      timer = setTimeout(fire, Math.max(0, Math.min(INTRO_QUIET_MS, left)));
    };
    const observer = new MutationObserver(arm);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    arm();
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return threadId === null ? null : <DoneWatch key={threadId} threadId={threadId} />;
}
