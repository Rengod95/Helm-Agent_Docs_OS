// O-09 바로 가기 키 도움말 목업. ⌘/로 어디서나 연다. 대화를 고르지 않은 P-02 위에 그렸다. ?state=S1..S3, ?theme=dark.
// 키를 그리는 유일한 화면이다(DP-06 예외, 브리프 결정). caustic에 도움말 오버레이가 없어(C-11) Dialog + 찾기 Input + 묶음별 목록 + Kbd로 만든다.
// 표는 스펙 §4.8 전역 키 + 입력창 키 + 승인 카드 키.
import { Button, Dialog, Input, Kbd } from "@caustic/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadCausticFonts, MockRoot, Search, ShellStateProvider } from "../_shell";
import { QuietPage } from "../o07-new-thread/quiet-page";
import "./mockup.css";

loadCausticFonts();

const STATES = [
  { id: "S1", label: "S1 기본(macOS)" },
  { id: "S2", label: "S2 찾기: 패널" },
  { id: "S3", label: "S3 Linux" },
  { id: "S4", label: "S4 결과 없음" },
] as const;
type StateId = (typeof STATES)[number]["id"];

/** 키는 공백으로 나눈 낱키. "Mod"는 macOS ⌘, Linux Ctrl. */
interface Binding {
  label: string;
  keys: string;
  id?: string;
}
const GROUPS: { title: string; items: Binding[] }[] = [
  {
    title: "어디서나",
    items: [
      { label: "명령 팔레트", keys: "Mod K", id: "palette.open" },
      { label: "새 대화", keys: "Mod N", id: "thread.new" },
      { label: "설정", keys: "Mod ,", id: "settings.open" },
      { label: "바로 가기 키", keys: "Mod /", id: "help.shortcuts" },
    ],
  },
  {
    title: "이동",
    items: [
      { label: "대화 · 받은 요청 · 제안 · 예약 · 연결", keys: "Mod 1–5", id: "nav.1–5" },
      { label: "다음 대화", keys: "Alt Mod ↓", id: "thread.next" },
      { label: "이전 대화", keys: "Alt Mod ↑", id: "thread.prev" },
    ],
  },
  {
    title: "패널",
    items: [
      { label: "왼쪽 패널 열고 닫기", keys: "Mod \\", id: "sidebar.toggle" },
      { label: "오른쪽 패널 열고 닫기", keys: "Mod J", id: "panel.toggle" },
      { label: "받은 요청", keys: "Mod Shift I", id: "panel.inbox" },
      { label: "탐구 (Helm)", keys: "Mod Shift H", id: "panel.helm" },
      { label: "작업", keys: "Mod Shift T", id: "panel.work" },
    ],
  },
  {
    title: "대화",
    items: [
      { label: "진행 중 턴 중단", keys: "Mod .", id: "turn.interrupt" },
      { label: "입력창으로", keys: "Mod L", id: "composer.focus" },
      { label: "다음 대기 승인", keys: "Mod Shift A", id: "approval.next" },
    ],
  },
  {
    title: "입력창",
    items: [
      { label: "보내기", keys: "Enter" },
      { label: "줄바꿈", keys: "Shift Enter" },
      { label: "마지막 입력 다시 불러오기", keys: "↑" },
      { label: "슬래시 명령", keys: "/" },
    ],
  },
  {
    title: "승인 카드",
    items: [
      { label: "허용", keys: "Y" },
      { label: "거부", keys: "N" },
      { label: "이 대화에서 항상", keys: "Shift Y" },
    ],
  },
];

const LEFT = ["어디서나", "이동", "대화"];
const RIGHT = ["패널", "입력창", "승인 카드"];

const MAC: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↩" };
const LINUX: Record<string, string> = { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Enter: "Enter" };

function Keys({ keys, os }: { keys: string; os: "mac" | "linux" }) {
  const map = os === "mac" ? MAC : LINUX;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {/* Linux는 Ctrl을 맨 앞에(Ctrl Alt ↓), macOS는 ⌥⌘ 순서 그대로. */}
      {(os === "linux"
        ? keys.split(" ").toSorted((a, b) => (a === "Mod" ? -1 : b === "Mod" ? 1 : 0))
        : keys.split(" ")
      ).map((k, i) => (
        <Kbd key={i} size="xs">
          {map[k] ?? k}
        </Kbd>
      ))}
    </span>
  );
}

function ShortcutsDialog({
  open,
  onOpenChange,
  os,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  os: "mac" | "linux";
  initialQuery: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const query = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    items:
      query === "" || g.title.includes(query)
        ? g.items
        : g.items.filter((b) => b.label.toLowerCase().includes(query) || b.id?.includes(query)),
  })).filter((g) => g.items.length > 0);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="바로 가기 키"
      footer={
        <>
          <Button size="sm" variant="ghost">
            설정에서 바꾸기
          </Button>
          <span aria-hidden className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input
          size="xs"
          variant="soft"
          prefix={<Search />}
          placeholder="동작 찾기"
          aria-label="동작 찾기"
          value={q}
          onValueChange={setQ}
        />
        {groups.length === 0 ? (
          <p className="m-0 py-6 text-center text-ui-sm text-text-tertiary">맞는 동작이 없어요</p>
        ) : (
          // 두 열: 왼쪽 어디서나·이동·대화, 오른쪽 패널·입력창·승인 카드. 좁은 창에서는 한 열.
          <div className="grid grid-cols-2 gap-x-6 max-[760px]:grid-cols-1">
            {[LEFT, RIGHT].map((col, i) => (
              <div key={i} className="grid content-start gap-3">
                {groups
                  .filter((g) => col.includes(g.title))
                  .map((g) => (
                    <section key={g.title} aria-label={g.title}>
                      <h3 className="m-0 mb-0.5 text-ui-xs font-medium text-text-tertiary">
                        {g.title}
                      </h3>
                      <ul className="m-0 list-none p-0">
                        {g.items.map((b) => (
                          <li
                            key={b.label}
                            className="flex h-7 items-center gap-3 text-ui-sm text-text-primary"
                          >
                            <span className="min-w-0 flex-1 truncate">{b.label}</span>
                            <Keys keys={b.keys} os={os} />
                          </li>
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
  );
}

function Page({ state }: { state: StateId }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <QuietPage onNew={() => {}} modalOpen={open} />
      <ShortcutsDialog
        open={open}
        onOpenChange={setOpen}
        os={state === "S3" ? "linux" : "mac"}
        initialQuery={state === "S2" ? "패널" : state === "S4" ? "되돌리기" : ""}
      />
    </>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <Page state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
