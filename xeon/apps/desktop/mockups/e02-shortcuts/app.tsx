// O-09 바로 가기 키(묶음 E): 크래프트 키(⌘E, ⌥⌘1/2), 키 바꾸기(계획에 없음 11: 바꾸기 → 키 기다림 → 겹침 경고 → 바꿔 쓰기·취소, 행 되돌리기,
// 모두 기본값), 웹 키 표(계획에 없음 9: 브라우저가 가져가는 키는 "브라우저가 씀"과 대체 키). 키를 그리는 유일한 화면(DP-06 예외).
// 옛 o09-shortcuts의 Dialog 모양(찾기 + 두 열 + Kbd)을 따르고, caustic에 키 기록 부품이 없어 행 안 기록 칸을 토큰으로 만들었다.
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  Input,
  Kbd,
  SegmentedControl,
  SegmentedControlItem,
  toast,
  Tooltip,
} from "@caustic/react";
import { useEffect, useState } from "react";
import { L2, Pencil, ScenarioDock, Search, ShellToaster, T, Undo2 } from "../_shell";
import { useMachine, usePrefill } from "../_chat-rt";
import { QuietPage } from "../o07-new-thread/quiet-page";
import {
  BROWSER_KEYS,
  find,
  GROUPS,
  keysOf,
  LEFT,
  reduce,
  RIGHT,
  SCRIPTS,
  effect,
  init,
  type A,
  type Binding,
  type S,
} from "./flow";

interface Look {
  script: string;
  n: number;
  over?: Partial<S>;
}

export const STATES = [
  { id: "main", label: "기본(macOS)" },
  { id: "area-keys", label: "찾기: 영역(크래프트 키)" },
  { id: "record", label: "키 기다림" },
  { id: "conflict", label: "겹치는 키" },
  { id: "swapped", label: "바꿔 쓰기 뒤" },
  { id: "changed", label: "바뀐 키 2개(되돌리기)" },
  { id: "reset-confirm", label: "모두 기본값으로 확인" },
  { id: "web", label: "웹 키 표" },
  { id: "web-conflict", label: "웹: 브라우저가 쓰는 키" },
  { id: "linux", label: "Linux" },
  { id: "empty", label: "찾기 결과 없음" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, Look> = {
  main: { script: "base", n: 0 },
  "area-keys": { script: "base", n: 0, over: { q: L2("영역", "area") } },
  record: { script: "rebind-key", n: 1 },
  conflict: { script: "rebind-key-conflict", n: 2 },
  swapped: { script: "rebind-key-conflict", n: 3 },
  changed: { script: "changed", n: 4 },
  "reset-confirm": { script: "reset-all", n: 5 },
  web: { script: "web-keys", n: 1 },
  "web-conflict": { script: "web-keys", n: 3 },
  linux: { script: "base", n: 0, over: { os: "linux" } },
  empty: { script: "base", n: 0, over: { q: L2("되돌리기", "undo") } },
};

export const SCENARIOS = [
  { id: "rebind-key", label: "새 대화 키 바꾸기" },
  { id: "rebind-key-conflict", label: "실패: 겹치는 키(⌘K) → 바꿔 쓰기" },
  { id: "web-keys", label: "웹: 브라우저 키(⌘N) → 대체 키" },
  { id: "reset-all", label: "바꾼 키 모두 기본값으로" },
];

const MAC: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↩" };
const LINUX: Record<string, string> = { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Enter: "Enter" };

function Keys({ keys, os, dim = false }: { keys: string; os: "mac" | "linux"; dim?: boolean }) {
  const map = os === "mac" ? MAC : LINUX;
  const parts =
    os === "linux"
      ? keys.split(" ").toSorted((a, b) => (a === "Mod" ? -1 : b === "Mod" ? 1 : 0))
      : keys.split(" ");
  return (
    <span className={`flex shrink-0 items-center gap-0.5 ${dim ? "line-through opacity-60" : ""}`}>
      {parts.map((k, i) => (
        <Kbd key={i} size="xs">
          {map[k] ?? k}
        </Kbd>
      ))}
    </span>
  );
}

/** 키를 문장으로(겹침 경고 안). */
function keyText(keys: string, os: "mac" | "linux"): string {
  const map = os === "mac" ? MAC : LINUX;
  return keys
    .split(" ")
    .map((k) => map[k] ?? k)
    .join(os === "mac" ? "" : "+");
}

/** 눌린 키 → "Mod Shift N". 단독 수정 키는 무시. */
function comboOf(e: KeyboardEvent): string | null {
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.altKey) parts.push("Alt");
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  const k = e.code.startsWith("Key")
    ? e.code.slice(3)
    : e.code.startsWith("Digit")
      ? e.code.slice(5)
      : e.key;
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join(" ");
}

function Row({ b, s, go }: { b: Binding; s: S; go: (a: A) => void }) {
  const keys = keysOf(s, b);
  const changed = b.id !== undefined && b.id in s.over;
  const recording = b.id !== undefined && s.rec === b.id;
  const browser =
    s.platform === "web" && b.web !== undefined && BROWSER_KEYS.has(b.keys) && !changed;
  const c = s.conflict;
  return (
    <li className="grid">
      <div
        className={`group flex h-7 items-center gap-2 rounded-md text-ui-sm text-text-primary ${recording ? "bg-fill-hover -mx-1.5 px-1.5" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate" title={b.label}>
          {b.label}
        </span>
        {changed && !recording && (
          <span className="shrink-0 text-ui-xs text-text-tertiary">
            {s.saved === b.id ? L2("저장됨", "Saved") : L2("바뀜", "Changed")}
          </span>
        )}
        {browser && (
          <Tooltip
            content={L2(
              `브라우저가 ${keyText(b.keys, s.os)}를 가져가요`,
              `The browser keeps ${keyText(b.keys, s.os)}`,
            )}
          >
            <span
              tabIndex={0}
              className="shrink-0 rounded-sm text-ui-xs text-text-tertiary outline-none focus-visible:focus-ring"
            >
              <Keys keys={b.keys} os={s.os} dim />
            </span>
          </Tooltip>
        )}
        {recording ? (
          <span
            role="status"
            className="inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-ui-xs text-text-secondary shadow-[inset_0_0_0_1px_var(--cs-color-accent-border-strong)]"
          >
            {L2("새 키를 누르세요 · Esc 취소", "Press the new keys · Esc to cancel")}
          </span>
        ) : keys === null ? (
          <span className="shrink-0 text-ui-xs text-warning-text">
            {L2("키 없음", "No shortcut")}
          </span>
        ) : (
          <Keys keys={keys} os={s.os} />
        )}
        {b.id !== undefined && !recording && (
          <span className="flex w-6 shrink-0 justify-end">
            {changed ? (
              <IconButton
                size="xs"
                variant="ghost"
                label={L2(`${b.label} 기본 키로 되돌리기`, `Reset ${b.label} to default`)}
                onClick={() => b.id !== undefined && go({ t: "reset", id: b.id })}
              >
                <Undo2 />
              </IconButton>
            ) : (
              <IconButton
                size="xs"
                variant="ghost"
                label={L2(`${b.label} 키 바꾸기`, `Change shortcut for ${b.label}`)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => b.id !== undefined && go({ t: "record", id: b.id })}
              >
                <Pencil />
              </IconButton>
            )}
          </span>
        )}
        {b.id === undefined && <span aria-hidden className="w-6 shrink-0" />}
      </div>
      {recording && c !== null && c.id === b.id && (
        <Alert
          tone="warning"
          size="sm"
          className="my-1"
          actions={
            c.other === "browser"
              ? [
                  {
                    label: L2("다른 키 누르기", "Press other keys"),
                    onClick: () => go({ t: "record", id: c.id }),
                  },
                ]
              : [
                  {
                    label: L2("바꿔 쓰기", "Use it here"),
                    primary: true,
                    onClick: () => go({ t: "swap" }),
                  },
                  { label: L2("취소", "Cancel"), onClick: () => go({ t: "cancel" }) },
                ]
          }
        >
          {c.other === "browser"
            ? L2(
                `${keyText(c.keys, s.os)}는 브라우저가 가져가 웹에서는 쓸 수 없어요.`,
                `${keyText(c.keys, s.os)} is taken by the browser, so it can't work on the web.`,
              )
            : L2(
                `${keyText(c.keys, s.os)}는 "${find(c.other)?.label ?? c.other}"가 쓰고 있어요. 바꿔 쓰면 그 동작은 키가 없어져요.`,
                `${keyText(c.keys, s.os)} is used by "${find(c.other)?.label ?? c.other}". If you use it here, that action loses its shortcut.`,
              )}
        </Alert>
      )}
    </li>
  );
}

export function App({ state }: { state: StateId }) {
  const look = AT[state];
  const pre = usePrefill(SCRIPTS, look);
  const [s, dispatch] = useMachine<S, A>({
    init: { ...init(), ...look.over },
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const [open, setOpen] = useState(true);

  // 키 기록: 기다리는 동안 누른 조합을 받는다. Esc는 취소.
  useEffect(() => {
    if (s.rec === null || s.conflict !== null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return dispatch({ t: "cancel" });
      const c = comboOf(e);
      if (c !== null) dispatch({ t: "press", keys: c });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s.rec, s.conflict, dispatch]);

  useEffect(() => {
    if (s.toast === null || !pre.live) return;
    toast({ title: s.toast.title, tone: s.toast.tone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.toast]);

  const query = s.q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    items:
      query === "" || g.title.toLowerCase().includes(query)
        ? g.items
        : g.items.filter(
            (b) => b.label.toLowerCase().includes(query) || (b.id ?? "").includes(query),
          ),
  })).filter((g) => g.items.length > 0);
  const changedN = Object.keys(s.over).length;

  const hint = (() => {
    switch (pre.script) {
      case "rebind-key":
        return s.rec === null
          ? L2("새 대화 행의 연필", "Pencil on New conversation")
          : L2("⌘⇧N을 눌러요", "Press ⌘⇧N");
      case "rebind-key-conflict":
        return s.rec === null
          ? L2("새 대화 행의 연필 → ⌘K", "Pencil on New conversation → ⌘K")
          : s.conflict !== null
            ? L2("바꿔 쓰기 또는 취소", "Use it here or Cancel")
            : L2("⌘K를 눌러요", "Press ⌘K");
      case "web-keys":
        return s.conflict !== null
          ? L2("다른 키 누르기 → ⌥⇧M", "Press other keys → ⌥⇧M")
          : L2("웹 표 · 새 대화 연필 → ⌘N", "Web table · pencil → ⌘N");
      case "reset-all":
        return L2("아래 모두 기본값으로", "Reset all, bottom left");
      default:
        return undefined;
    }
  })();

  return (
    <>
      <QuietPage onNew={() => {}} modalOpen={open} />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title={s.platform === "web" ? `${T.keybinding} · ${T.webClient}` : T.keybinding}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={changedN === 0}
              onClick={() => dispatch({ t: "resetAsk" })}
            >
              {L2("모두 기본값으로", "Reset all")}
            </Button>
            <span className="text-ui-xs text-text-tertiary">
              {changedN > 0
                ? L2(
                    `바뀐 키 ${changedN}개 · 이 기기에만`,
                    `${changedN} changed · this device only`,
                  )
                : null}
            </span>
            <span aria-hidden className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              {L2("닫기", "Close")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Input
              size="xs"
              variant="soft"
              prefix={<Search />}
              placeholder={L2("동작 찾기", "Find an action")}
              aria-label={L2("동작 찾기", "Find an action")}
              value={s.q}
              onChange={(e) => dispatch({ t: "q", q: e.target.value })}
              containerClassName="min-w-0 flex-1"
            />
            <SegmentedControl
              aria-label={L2("표", "Table")}
              size="xs"
              value={s.platform}
              onValueChange={(v) => dispatch({ t: "platform", p: v as "desktop" | "web" })}
            >
              <SegmentedControlItem value="desktop">
                {L2("데스크톱", "Desktop")}
              </SegmentedControlItem>
              <SegmentedControlItem value="web">{T.webClient}</SegmentedControlItem>
            </SegmentedControl>
          </div>
          {s.platform === "web" && (
            <p className="m-0 text-ui-xs text-text-secondary">
              {L2(
                "브라우저가 가져가는 키(⌘N, ⌘W, ⌘1–5)는 웹에서 쓸 수 없어 ⌥⇧ 조합으로 바꿨어요. 글자 키는 입력란 밖에서만 받아요.",
                "Keys the browser keeps (⌘N, ⌘W, ⌘1–5) can't work on the web, so they use ⌥⇧ combos. Letter keys work only outside text fields.",
              )}
            </p>
          )}
          {groups.length === 0 ? (
            <div className="grid justify-items-center gap-2 py-6 text-center">
              <p className="m-0 text-ui-sm text-text-secondary">
                {L2(`"${s.q}"와 맞는 동작이 없어요`, `No action matches "${s.q}"`)}
              </p>
              <Button size="xs" variant="outline" onClick={() => dispatch({ t: "q", q: "" })}>
                {L2("모든 키 보기", "Show all shortcuts")}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 max-[760px]:grid-cols-1">
              {[LEFT, RIGHT].map((col, i) => (
                <div key={i} className="grid content-start gap-3">
                  {groups
                    .filter((g) => col.includes(g.id))
                    .map((g) => (
                      <section key={g.id} aria-label={g.title}>
                        <h3 className="m-0 mb-0.5 text-ui-xs font-medium text-text-tertiary">
                          {g.title}
                        </h3>
                        <ul className="m-0 grid list-none p-0">
                          {g.items.map((b) => (
                            <Row key={b.label} b={b} s={s} go={dispatch} />
                          ))}
                        </ul>
                      </section>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>
      <Dialog
        open={s.confirmReset}
        onOpenChange={() => dispatch({ t: "cancel" })}
        kind="alert"
        size="sm"
        title={L2("바꾼 키를 모두 기본값으로 돌릴까요?", "Reset all changed shortcuts?")}
        description={L2(
          `바꾼 키 ${changedN}개가 기본값으로 돌아가요. 이 기기에만 해당해요.`,
          `${changedN} changed shortcuts go back to default on this device.`,
        )}
        footer={
          <>
            <span aria-hidden className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => dispatch({ t: "cancel" })}>
              {L2("취소", "Cancel")}
            </Button>
            <Button size="sm" variant="solid" onClick={() => dispatch({ t: "resetAll" })}>
              {L2("기본값으로", "Reset")}
            </Button>
          </>
        }
      />
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
