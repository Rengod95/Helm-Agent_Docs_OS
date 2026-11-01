// 묶음 D · 기존 페이지의 빠진 상태(P-04, P-07, P-08, P-09, P-10, P-11, P-12, P-14, P-15, O-06 데이터 지우기).
// ?page=p07&state=<id>. 페이지마다 원래 폴더의 코드를 이 폴더(pNN/)로 복사해 상태만 더했다(원래 폴더는 그대로).
// 새로 더한 상태 id는 모두 "D-"로 시작한다. ?dev=1이면 왼쪽 아래에 페이지 고르기.
import { Select, SelectOption } from "@caustic/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isDev, loadCausticFonts, MockRoot, ScenarioDock, useScenarioParam } from "../_shell";
import "./mockup.css";
import * as p04 from "./p04/entry";
import * as p07 from "./p07/entry";
import * as p08 from "./p08/entry";
import * as p09 from "./p09/entry";
import * as p10 from "./p10/entry";
import * as p11 from "./p11/entry";
import * as p12 from "./p12/entry";
import * as p14 from "./p14/entry";
import * as p15 from "./p15/entry";

loadCausticFonts();

interface PageMod {
  STATES: readonly { id: string; label: string }[];
  Root: (p: { state: string }) => React.ReactNode;
}
const PAGES: Record<string, { label: string; mod: PageMod }> = {
  p04: { label: "P-04 변경 검토", mod: p04 },
  p07: { label: "P-07 예약", mod: p07 },
  p08: { label: "P-08 연결", mod: p08 },
  p09: { label: "P-09 설정(데이터 지우기)", mod: p09 },
  p10: { label: "P-10 비밀", mod: p10 },
  p11: { label: "P-11 계정", mod: p11 },
  p12: { label: "P-12 도구와 웹", mod: p12 },
  p14: { label: "P-14 목표와 작업", mod: p14 },
  p15: { label: "P-15 엔진(작업대)", mod: p15 },
};

/** 시나리오는 페이지와 시작 상태를 고르고, 그 뒤는 화면 안 버튼이 진행한다(상태 기계 없이 화면 로컬 상태). */
const SCENARIOS = [
  { id: "wipe-data", label: "데이터 지우기: 확인 글 → 지움 → 다시 시작" },
  { id: "wipe-blocked", label: "실패: 진행 중 턴이 있어 못 지움" },
  { id: "schedule-runs", label: "예약: 실행 기록 → 다시 켜기 → 지우기" },
  { id: "connection-stop", label: "연결: 대상 팝오버 → 서비스 멈추기" },
];
const SC_START: Record<string, { page: string; state: string }> = {
  "wipe-data": { page: "p09", state: "D-data" },
  "wipe-blocked": { page: "p09", state: "D-wipe-blocked" },
  "schedule-runs": { page: "p07", state: "S1" },
  "connection-stop": { page: "p08", state: "D-idle" },
};
const sc = new URLSearchParams(window.location.search).get("scenario");
const start = sc !== null ? SC_START[sc] : undefined;
if (start !== undefined) {
  const u = new URL(window.location.href);
  if (u.searchParams.get("page") !== start.page || u.searchParams.get("state") === null) {
    u.searchParams.set("page", start.page);
    u.searchParams.set("state", start.state);
    window.history.replaceState(null, "", u);
  }
}
const id = new URLSearchParams(window.location.search).get("page") ?? "p07";
const page = PAGES[id] ?? PAGES["p07"];

function PagePicker() {
  if (!isDev()) return null;
  return (
    <div className="fixed bottom-12 left-2 z-50 rounded-md bg-bg-raised p-1 shadow-md">
      <Select
        size="xs"
        aria-label="페이지"
        value={id}
        onValueChange={(v) => {
          const u = new URL(window.location.href);
          u.searchParams.set("page", v);
          u.searchParams.delete("state");
          window.location.assign(u.toString());
        }}
        className="w-52"
      >
        {Object.entries(PAGES).map(([k, p]) => (
          <SelectOption key={k} value={k}>
            {p.label}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}

function Dock() {
  const cur = useScenarioParam();
  const hint =
    cur === "wipe-data"
      ? "개요 맨 아래 ‘데이터 지우기…’ → ‘지우기’ 입력 → 모두 지우기"
      : cur === "schedule-runs"
        ? "행 ⋯ → 실행 기록 · 주간 보고 ‘다시 켜기’ · ⋯ → 지우기…"
        : cur === "connection-stop"
          ? "서비스 멈추기 · 상태 표시줄 대상 칸"
          : undefined;
  return <ScenarioDock scenarios={SCENARIOS} hint={hint} />;
}

const root = document.getElementById("root");
if (root !== null && page !== undefined)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={page.mod.STATES}>
        {(state) => <page.mod.Root key={state} state={state} />}
      </MockRoot>
      <PagePicker />
      <Dock />
    </StrictMode>,
  );
