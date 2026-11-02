// 내비 "구조": 층 × 단계 표 하나. 표 위에 바꾸기 미리보기 띠·실패 Alert, 표 아래 고른 것 구역.
// 표는 바깥 틀(LineGridFrame)로 감싸고, 위아래 선이 곧 구역 경계다. 레일은 없다. 보기 전환·지도·그림은 없다.
// 덮개 둘(보기 기준 설명, 에이전트 코어에 더하기)은 이 화면 위에 뜬다.
import { Alert, Button } from "@caustic/react";
import { LineGridFrame, WorkbenchHead } from "../../_shell";
import { T } from "../../_shell/terms";
import { PRESET_DIFF, viewOf } from "../data";
import { CARD, STAGE } from "../parts/kit";
import { useMock } from "../store";
import { LayerTable } from "./layer-table";
import { AddL1Sheet, ExplainOverlay } from "./overlays";
import { PickPanel } from "./pick-panel";

/** 바꾸기 미리보기: 프로필을 이 대화에 적용하면 무엇이 바뀌는지 한 줄 + 동작. 보기 기준은 그대로다. */
function PreviewBand() {
  const m = useMock();
  if (m.preview === null) return null;
  const p = viewOf(m.preview);
  const n = Object.values(PRESET_DIFF);
  const count = (k: string) => n.filter((x) => x.mark === k).length;
  return (
    <div className={`${CARD} flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4`}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-title-3 text-text-primary">
          {T.profile} "{p.label}"을 이 대화에 적용하면
        </span>
        <span className="text-body text-text-secondary">
          켜짐 {count("add")} · 꺼짐 {count("remove")} · 설정 {count("override")}
        </span>
      </div>
      <span className="flex flex-none items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => m.set({ preview: null })}>
          닫기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.set({ screen: "diff" })}>
          나란히 비교
        </Button>
        <Button size="sm" variant="solid" onClick={() => m.notify("이번 단계가 끝나면 적용돼요")}>
          이 대화에 적용
        </Button>
      </span>
    </div>
  );
}

export function StructureScreen() {
  const m = useMock();
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={STAGE}>
        <WorkbenchHead className="w-full px-3 pb-4" title={T.structure} />
        {(m.preview !== null || m.failure) && (
          <div className="grid min-w-0 gap-3 px-3 pb-3">
            <PreviewBand />
            {m.failure && (
              <Alert
                tone="danger"
                variant="soft"
                size="sm"
                actions={[
                  { label: "다시 켜기", onClick: () => m.notify("이번 단계가 끝나면 다시 켜요") },
                  { label: "기록 보기", onClick: () => m.notify("기록 탭을 열어요") },
                ]}
              >
                리뷰가 연속 5번 실패해 자동으로 꺼졌어요.
              </Alert>
            )}
          </div>
        )}
        <LineGridFrame>
          <LayerTable />
        </LineGridFrame>
        <div className="px-3 pt-8 pb-6">
          <PickPanel />
        </div>
      </div>
      {m.overlay === "explain" && <ExplainOverlay />}
      {m.overlay === "add-l1" && <AddL1Sheet />}
    </div>
  );
}
