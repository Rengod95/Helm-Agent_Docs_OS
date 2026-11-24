// 플러그인 상세 "구성" 탭(plugHead, AGE-76): 머리줄과 탭 줄을 뺀 내용 칸 전체가 루프 캔버스이고, 설명은 캔버스 위에 떠 있는 판이다.
// 예전의 두 단(왼쪽 멤버와 Drive 블록 캔버스, 오른쪽 훅 표)을 대신한다. 값은 그대로다: 카드(`plugin.list`), 매니페스트(`ext.get`)의
// 훅 목록과 계측(`ext.timings`), Drive 구성 선언(`orchestration.composition`)과 그 검사(`ext.validateComposition`), 구성원.
import { t } from "@fresnel/client/i18n";
import {
  blockRowsOf,
  compositionOf,
  issuesByBlockOf,
  type InspectHookVM,
} from "@fresnel/client/workbench";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { ExtListEntry, WireManifestIssue } from "@fresnel/contracts/wire";
import { Alert } from "@caustic/react";
import { useMemo, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { tabLinkOf } from "../../workbench/tab-read.ts";
import { CheckBanner, useCompositionCheck } from "../composition/composition-check.tsx";
import { hasMembers, membersOfManifest } from "../members/members-model.ts";
import { MembersTab } from "../members/members-tab.tsx";
import { LoopCanvas } from "./loop-canvas.tsx";
import { loopPlanOf, type LoopPick } from "./loop-model.ts";
import { LoopPanel } from "./loop-panel.tsx";

const NO_ISSUES: ReadonlyMap<string, readonly WireManifestIssue[]> = new Map();

export function LoopTab(props: {
  readonly entry: ExtListEntry;
  /** 플러그인 카드. 못 읽었으면 null(재료와 Drive 명령이 비고, 훅은 매니페스트에서 읽는다) */
  readonly card: PluginCard | null;
  /** 설치본 매니페스트. 아직 못 읽었거나 실패했으면 null */
  readonly manifest: Readonly<Record<string, unknown>> | null;
  /** 매니페스트 훅 목록과 계측을 합친 줄. 매니페스트를 아직 못 읽었으면 null(카드의 훅 이름을 쓴다) */
  readonly hookRows: readonly InspectHookVM[] | null;
  /** 훅 계측이 꺼졌나 */
  readonly traceOff: boolean;
  /** 매니페스트 읽기가 실패했나 */
  readonly failed: boolean;
}): ReactNode {
  const { entry, manifest } = props;
  const link = tabLinkOf(useLinkPhase());
  // `compositionOf`는 호출마다 새 객체를 주므로 매니페스트가 바뀔 때만 다시 읽어 검사 효과가 반복되지 않게 한다
  const decl = useMemo(() => {
    if (manifest === null) return null;
    const read = compositionOf(manifest);
    return read.kind === "declared" ? read.composition : null;
  }, [manifest]);
  const check = useCompositionCheck(decl, link);
  const steps = useMemo(
    () =>
      decl === null || manifest === null
        ? []
        : blockRowsOf(decl, membersOfManifest(entry.name, manifest)),
    [decl, manifest, entry.name],
  );
  const issues =
    decl !== null && check.kind === "done" ? issuesByBlockOf(decl, check.issues) : NO_ISSUES;
  const plan = useMemo(
    () =>
      loopPlanOf({
        card: props.card,
        hookRows: props.hookRows,
        orchestration: entry.isOrchestration,
        steps,
      }),
    [props.card, props.hookRows, entry.isOrchestration, steps],
  );
  const [pick, setPick] = useState<LoopPick | null>(null);
  const [open, setOpen] = useState(true);
  const onPick = (next: LoopPick | null): void => {
    setPick(next);
    // 캔버스에서 무엇을 고르면 접힌 판이 다시 열린다. 바탕을 눌러 고름을 풀 때는 그대로다
    if (next !== null) setOpen(true);
  };
  const extra = (
    <>
      {props.failed ? (
        <Alert tone="danger" variant="soft" size="sm">
          {t("desktop.workbench.detail.load.failed")}
        </Alert>
      ) : null}
      {decl === null ? null : <CheckBanner check={check} />}
      {hasMembers(entry) ? (
        <section className="grid gap-1.5">
          <h4 className="m-0 text-ui-sm text-text-tertiary">{t("desktop.craft.members.tab")}</h4>
          <MembersTab entry={entry} manifest={manifest} />
        </section>
      ) : null}
    </>
  );
  const panelProps = {
    plan,
    pick,
    onPick,
    open,
    onOpen: setOpen,
    traceOff: props.traceOff,
    issues,
    extra,
  };
  // 넓으면 캔버스와 떠 있는 판, 상세 칸이 720 이하(DP-49)면 캔버스 대신 같은 값의 개요와 설명을 한 열로 보인다
  return (
    <>
      <div className="hidden min-h-0 flex-1 flex-col @[45rem]/detail:flex">
        <LoopCanvas
          plan={plan}
          pick={pick}
          onPick={onPick}
          panelOpen={open}
          panel={<LoopPanel {...panelProps} />}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-4 @[45rem]/detail:hidden">
        <LoopPanel {...panelProps} inline />
      </div>
    </>
  );
}
