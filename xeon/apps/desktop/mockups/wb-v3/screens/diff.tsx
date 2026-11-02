// 프로필 ↔ 대화 차이: 구조 표와 같은 선 격자를 바깥 틀(LineGridFrame)로 싼다. 행 = 바뀌는 플러그인(오른쪽에 층 이름), 열 = 이 대화 지금 · 적용하면.
// 층 경계마다 "+"를 찍으면 표식이 많아지므로 네 모서리만 둔다(groupBreaks 비움).
// 바뀌는 행만 둔다. 적용하면 칸의 바뀐 값에만 6px 중립 점. L1(비용 라우터)·X(끝나면 알림)도 프로필이 켜고 끈다.
import { Button } from "@caustic/react";
import { LineGrid, LineGridFrame, WorkbenchHead } from "../../_shell";
import { T } from "../../_shell/terms";
import { PRESET_DIFF, THREAD_ON, layerName, pluginById, viewOf, type LayerId } from "../data";
import { STAGE } from "../parts/kit";
import { useMock } from "../store";

const ORDER: readonly LayerId[] = ["L3", "L2", "L1", "L0", "X"];

export function DiffScreen() {
  const m = useMock();
  const t = viewOf(m.view);
  const p = viewOf(m.preview ?? "p-explore");
  const rows = Object.entries(PRESET_DIFF)
    .map(([id, d]) => ({ plugin: pluginById(id), d }))
    .sort((a, b) => ORDER.indexOf(a.plugin.layer) - ORDER.indexOf(b.plugin.layer));
  const value = (id: string, col: string) => {
    const r = rows.find((x) => x.plugin.id === id);
    if (r === undefined) return null;
    const now = THREAD_ON.has(id);
    if (r.d.mark === "override") return col === "now" ? `${T.lens} 3개` : `${T.lens} 4개`;
    const on = col === "now" ? now : r.d.mark === "add";
    return on ? "켜짐" : "꺼짐";
  };
  return (
    <div className={STAGE}>
      <WorkbenchHead
        className="w-full px-3 pb-4"
        title="차이"
        sub={`${T.contextThread} ${t.label} ↔ ${T.profile} ${p.label}`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => m.set({ screen: "structure" })}>
              {T.structure}로
            </Button>
            <Button
              size="sm"
              variant="solid"
              onClick={() => m.notify("이번 단계가 끝나면 적용돼요")}
            >
              이 대화에 적용
            </Button>
          </>
        }
      />
      <LineGridFrame>
        <LineGrid
          label={`${T.profile} 차이`}
          density="compact"
          style={{ minWidth: "560px" }}
          rowHeadWidth="16rem"
          groupBreaks={[]}
          columns={[
            { id: "now", label: "지금" },
            { id: "after", label: "적용하면" },
          ]}
          rows={rows.map((r) => ({
            id: r.plugin.id,
            label: r.plugin.name,
            hint: layerName(r.plugin.layer),
          }))}
          cell={(id, col) => {
            const v = value(id, col);
            return v === null
              ? null
              : {
                  items: [
                    {
                      id: `${id}-${col}`,
                      label: v,
                      ...(col === "after" ? { dot: "neutral" as const } : {}),
                    },
                  ],
                };
          }}
        />
      </LineGridFrame>
    </div>
  );
}
