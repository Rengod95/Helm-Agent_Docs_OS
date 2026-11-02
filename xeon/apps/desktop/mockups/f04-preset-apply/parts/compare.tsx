// 구조 입구의 적용 화면: 선 격자 둘. 위는 무엇을 어디에 적용하는지와 지금 상태, 아래는 앞뒤 견주기(_shell의 LineGrid, 옛 언어 이식).
// 행 = 프로필이 바꾸는 것만(오른쪽에 층 이름). 칸 뜻은 단계마다 바뀐다.
//   미리 보기: 지금 | 적용하면      미리 보기 실패: 지금 | 빗금(계산하지 못함)      기다림: 지금 | 적용하면(흐림)
//   적용함: 적용 전(흐림) | 지금(soft 채움)      되돌림: 지금 | 적용하려던 값(취소선) | 결과
import { Skeleton } from "@caustic/react";
import {
  LineGrid,
  LineGridBlock,
  LineGridFrame,
  LineGridMetric,
  type LineGridItem,
  T,
  threads,
} from "../../_shell";
import {
  PRESET_DIFF,
  THREAD_ON,
  layerName,
  pluginById,
  viewOf,
  type LayerId,
} from "../../wb-v3/data";
import { FAIL_ID, type Phase } from "../flow";

const ORDER: readonly LayerId[] = ["L3", "L2", "L1", "L0", "X"];

interface Row {
  id: string;
  name: string;
  layer: LayerId;
  now: string;
  after: string;
}

const onWord = (on: boolean) => (on ? "켜짐" : "꺼짐");

const ROWS: readonly Row[] = Object.entries(PRESET_DIFF)
  .map(([id, d]): Row => {
    const p = pluginById(id);
    const override = d.mark === "override";
    return {
      id,
      name: p.name,
      layer: p.layer,
      now: override ? `${T.lens} 3개` : onWord(THREAD_ON.has(id)),
      after: override ? `${T.lens} 4개` : onWord(d.mark === "add"),
    };
  })
  .sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer));

/** 미리 보기를 막은 확장. 다시 켜면 바뀌는 것이 아니라서 다른 단계에는 행이 없다. */
const BLOCKER: Row = {
  id: "review",
  name: pluginById("review").name,
  layer: "L3",
  now: T.autoDisabled,
  after: "",
};

export const PROFILE_NAME = viewOf("p-explore").label;
export const THREAD_NAME = threads.find((t) => t.id === "t1")?.title ?? "";
export const FAIL_NAME = pluginById(FAIL_ID).name;
export const BLOCKER_NAME = BLOCKER.name;

/** 상태 칸은 중립이다. 실패의 색은 바로 아래 Alert 하나와 격자의 6px 점에만 둔다(§3). */
const STATE_WORD: Record<Phase, string> = {
  "preview-loading": "미리 보는 중",
  preview: "적용 전",
  "preview-fail": "미리 보지 못했어요",
  pending: T.atBoundary,
  done: "적용했어요",
  reverted: "모두 되돌렸어요",
};

export function ApplyBand({ phase }: { phase: Phase }) {
  return (
    <LineGridFrame>
      <LineGridBlock columns="minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr)">
        <LineGridMetric value={PROFILE_NAME} metricLabel={T.profile} />
        <LineGridMetric value={THREAD_NAME} metricLabel={T.contextThread} />
        <LineGridMetric value={STATE_WORD[phase]} metricLabel="상태" />
      </LineGridBlock>
    </LineGridFrame>
  );
}

const text = (
  id: string,
  label: string,
  extra: Partial<LineGridItem> = {},
): { items: LineGridItem[] } => ({
  items: [{ id, label, ...extra }],
});

function columnsOf(phase: Phase) {
  if (phase === "done")
    return [
      { id: "before", label: "적용 전" },
      { id: "now", label: "지금" },
    ];
  if (phase === "reverted")
    return [
      { id: "now", label: "지금" },
      { id: "after", label: "적용하려던 값" },
      { id: "result", label: "결과" },
    ];
  return [
    { id: "now", label: "지금" },
    { id: "after", label: "적용하면" },
  ];
}

export function ApplyCompare({ phase }: { phase: Phase }) {
  const rows = phase === "preview-fail" ? [BLOCKER, ...ROWS] : ROWS;
  const cell = (id: string, col: string) => {
    const r = rows.find((x) => x.id === id);
    if (r === undefined) return null;
    const key = `${id}-${col}`;
    if (phase === "done")
      return col === "before" ? text(key, r.now, { muted: true }) : text(key, r.after);
    if (phase === "reverted") {
      if (col === "now") return text(key, r.now);
      if (col === "after") return text(key, r.after, { struck: true });
      return id === FAIL_ID
        ? text(key, T.capabilityWait, { dot: "danger" })
        : text(key, "되돌림", { muted: true });
    }
    if (col === "now")
      return r.id === BLOCKER.id ? text(key, r.now, { dot: "danger" }) : text(key, r.now);
    if (phase === "preview-fail") return null;
    if (phase === "preview-loading")
      return { items: [{ id: key, label: <Skeleton className="h-4 w-16" /> }] };
    return text(key, r.after, phase === "pending" ? { muted: true } : {});
  };
  return (
    <div aria-busy={phase === "preview-loading"}>
      <LineGridFrame>
        <LineGrid
          label={`${T.profile} 적용 앞뒤`}
          density="compact"
          style={{ minWidth: "560px" }}
          rowHeadWidth="16rem"
          groupBreaks={[]}
          columns={columnsOf(phase)}
          rows={rows.map((r) => ({ id: r.id, label: r.name, hint: layerName(r.layer) }))}
          cell={cell}
          {...(phase === "done" ? { selected: { col: "now" } } : {})}
        />
      </LineGridFrame>
    </div>
  );
}
