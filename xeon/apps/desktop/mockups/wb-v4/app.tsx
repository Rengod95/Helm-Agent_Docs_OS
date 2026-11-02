// 크래프트 v4: 확장 · 구성 · 엔진을 한 화면으로. 공용 셸(크래프트) 가운데에 위 두 막대(범위, 단위), 가운데 캔버스(표 | 루프),
// 왼쪽 서랍(설치한 확장), 오른쪽 상세, 아래 서랍(엔진), 빌더 패널을 둔다. 상태 전환기 없이 눌러서 본다.
import {
  NoticeList,
  Shell,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchRightTabs,
} from "../_shell";
import { T } from "../_shell/terms";
import { ScopeBar, UnitBar } from "./bars";
import { Builder } from "./builder";
import { litSet, pluginById, type Unit } from "./data";
import { ExtensionTree, HealthDrawer } from "./drawers";
import { Inspector } from "./inspector";
import { LoopView } from "./loop-view";
import { MockProvider, useMock } from "./store";
import { TableView } from "./table-view";

const NAV = [
  { id: "craft", label: T.workbench },
  { id: "tests", label: T.trials, badge: "1*", badgeLabel: "실행 중 1개" },
  { id: "metrics", label: T.metrics },
];

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-14 z-30 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-full bg-surface-raised px-4 py-2 text-body text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

function Canvas() {
  const m = useMock();
  if (m.view === "table") return <TableView />;
  const unitOfId = (id: string): Unit => {
    const p = pluginById(id);
    return p.kind === "group" ? { kind: "group", id } : { kind: "plugin", id };
  };
  return (
    <div className="min-w-[720px] px-4 py-3">
      <LoopView
        lit={litSet(m.unit)}
        hasUnit={m.unit.kind !== "loop"}
        isOn={(id) => m.eff(pluginById(id)).on}
        isHere={(id) => m.eff(pluginById(id)).here}
        selected={m.selection}
        onSelect={m.select}
        onPick={(id) => m.setUnit(unitOfId(id))}
        onAdd={(layer, stage) => m.openBuilder({ layer, stage }, layer === "L3" ? "drive" : null)}
      />
    </div>
  );
}

function Page() {
  const m = useMock();
  const shell = useShell();
  const b = m.builder;
  return (
    <Shell
      activeNav="craft"
      onNavSelect={() => {}}
      workbench={{
        nav: NAV,
        onGoToThread: () => shell.setArea("chat"),
        contextField: <></>,
      }}
      stageLabel={T.workbench}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={workbenchRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 5,
        onGoToThread: () => shell.setArea("chat"),
      })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: true,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: { drive: "helm", extFailures: 3, onOpen: () => m.setHealth(true) },
      })}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <ScopeBar />
        <UnitBar />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            {m.drawer === "extensions" && <ExtensionTree />}
            <div className="min-w-0 flex-1 overflow-auto">
              <Canvas />
            </div>
            {m.inspectorOpen && <Inspector />}
          </div>
          <HealthDrawer />
          {b !== null && (
            <div className="absolute inset-0 z-20 border-t border-border-subtle bg-bg-app shadow-3">
              <Builder
                ctx={m.builderContext()}
                templateId={b.template}
                onTemplate={m.setTemplate}
                onClose={m.closeBuilder}
                onCreate={() => {
                  m.closeBuilder();
                  m.notify(`${m.builderContext().scopeLabel}에 저장 · 이번 단계가 끝나면 적용돼요`);
                }}
              />
            </div>
          )}
        </div>
        <Notice />
      </div>
    </Shell>
  );
}

export function App() {
  return (
    <MockProvider>
      <Page />
    </MockProvider>
  );
}
