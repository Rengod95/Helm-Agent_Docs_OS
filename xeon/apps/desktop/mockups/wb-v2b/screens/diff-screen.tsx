// 맥락 차이: 두 맥락 프레임(지금 대화 ↔ 프로필)을 나란히 두고 같은 확장을 같은 줄에 맞춘다. 가운데 홈에 차이 표지(+ − ~).
// 프레임 색: 대화 = 아이리스 실선(실제로 도는 맥락), 프로필 = 잉크 점선(가정), 시험 = 금색(떨어진 실행). 표지 색은 diff 토큰.
import { Button } from "@caustic/react";
import type { ReactNode } from "react";
import { MessageSquare, Play, Layers } from "../../_shell";
import { PROFILE_DIFF, extById, type DiffMark } from "../data";
import { ExtIcon, Face, PortGlyph } from "../parts/kit";
import { useMock } from "../store";

const STATE_TEXT: Record<string, string> = {
  on: "켜짐",
  off: "꺼짐",
  auto_off: "자동 꺼짐",
  pending: "다음 경계에 켜짐",
};

function Chip({ id, state, faded }: { id: string; state: string; faded?: boolean }) {
  const e = extById(id);
  const off = state === "off" || state === "auto_off";
  return (
    <div
      className="flex h-10 min-w-0 items-center gap-2 rounded-[10px] px-2.5"
      style={
        off
          ? { boxShadow: "inset 0 0 0 1px var(--cs-color-border-default)" }
          : {
              background: "var(--cs-color-surface-base)",
              boxShadow: "inset 0 0 0 1px var(--block-edge), var(--block-shadow)",
              opacity: faded ? 0.6 : 1,
            }
      }
    >
      <Face
        health={state === "auto_off" ? "danger" : off ? "off" : e.health === "warn" ? "warn" : "ok"}
        size={20}
      >
        <ExtIcon name={e.icon} />
      </Face>
      <span className={`truncate text-ui-sm ${off ? "text-text-tertiary" : "text-text-primary"}`}>
        {e.label}
      </span>
      <span className="truncate font-mono text-[10px] text-text-tertiary">{e.id}</span>
      <span
        className={`ms-auto flex-none text-[11px] ${state === "auto_off" ? "text-danger-text" : "text-text-tertiary"}`}
      >
        {STATE_TEXT[state]}
      </span>
    </div>
  );
}

function Mark({ mark, note }: { mark: DiffMark; note?: string }) {
  if (mark === "same")
    return (
      <div className="flex h-10 items-center justify-center">
        <span className="h-px w-full bg-[var(--block-edge)]" />
      </div>
    );
  const cls =
    mark === "add"
      ? "bg-diff-add-bg text-diff-add-text"
      : mark === "remove"
        ? "bg-diff-remove-bg text-diff-remove-text"
        : "bg-neutral-track text-text-primary";
  const sym = mark === "add" ? "+" : mark === "remove" ? "−" : "~";
  return (
    <div className="flex h-10 flex-col items-center justify-center gap-0.5">
      <span
        className={`flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${cls}`}
      >
        <span className="font-mono text-[12px]">{sym}</span>
        {mark === "add" ? "켜요" : mark === "remove" ? "꺼요" : "설정"}
      </span>
      {note !== undefined && (
        <span className="max-w-full truncate font-mono text-[9.5px] text-text-tertiary">
          {note}
        </span>
      )}
    </div>
  );
}

function Frame({
  tone,
  title,
  kind,
  meta,
  icon,
  children,
}: {
  tone: "thread" | "profile";
  title: string;
  kind: string;
  meta: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const c = tone === "thread" ? "var(--port-on)" : "var(--port-drive)";
  return (
    <div
      className="relative min-w-0 rounded-2xl px-3 pt-6 pb-3"
      style={{
        background:
          tone === "thread"
            ? "color-mix(in oklab, var(--port-on) 5%, transparent)"
            : "var(--lane-fill)",
        boxShadow: `inset 0 0 0 1.25px color-mix(in oklab, ${c} ${tone === "thread" ? 55 : 35}%, transparent)`,
        outline:
          tone === "profile"
            ? "1.25px dashed color-mix(in oklab, var(--port-drive) 40%, transparent)"
            : undefined,
        outlineOffset: -1.25,
      }}
    >
      <div className="absolute -top-3 left-3 flex h-6 items-center gap-1.5 rounded-md bg-surface-base px-2 shadow-[inset_0_0_0_1px_var(--block-edge)]">
        <span className="text-text-tertiary [&_svg]:size-3.5">{icon}</span>
        <span className="text-ui-xs text-text-tertiary">{kind}</span>
        <span className="text-ui-sm text-text-primary">{title}</span>
        <span className="text-ui-xs text-text-tertiary tabular-nums">{meta}</span>
      </div>
      {children}
    </div>
  );
}

export function DiffScreen() {
  const m = useMock();
  const lanes = ["L3", "plugin", "L2"];
  const laneName: Record<string, string> = { L3: "의도 그룹", plugin: "외부 확장", L2: "능력" };
  return (
    <div className="v2b-grid flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6">
      <div className="flex h-12 flex-none items-center gap-3">
        <h1 className="text-title-4 text-text-primary">맥락 차이</h1>
        <span className="flex items-center gap-1.5 text-ui-xs">
          <span className="rounded-full bg-diff-add-bg px-1.5 font-mono text-diff-add-text">
            +1
          </span>
          <span className="rounded-full bg-diff-remove-bg px-1.5 font-mono text-diff-remove-text">
            −1
          </span>
          <span className="rounded-full bg-neutral-track px-1.5 font-mono text-text-primary">
            ~1
          </span>
          <span className="text-text-tertiary">· drive Helm 그대로 · 나머지 6 그대로</span>
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          <Button
            size="sm"
            tone="neutral"
            variant="soft"
            iconStart={<Play />}
            onClick={() => m.notify("프로필로 시험 대화를 만들어요")}
          >
            시험 대화로
          </Button>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            onClick={() => m.notify("다음 단계 경계에 적용돼요")}
          >
            이 대화에 적용
          </Button>
        </div>
      </div>

      <div
        className="grid items-start gap-x-0 gap-y-0"
        style={{ gridTemplateColumns: "minmax(0,1fr) 160px minmax(0,1fr)" }}
      >
        <Frame
          tone="thread"
          kind="대화"
          title="캐시 무효화 조사"
          meta="지금 · 멤버 8 · 턴 7"
          icon={<MessageSquare />}
        >
          <Rows side="now" lanes={lanes} laneName={laneName} />
        </Frame>
        <div className="flex flex-col px-2 pt-6 pb-3">
          {lanes.map((l) => (
            <div key={l} className="flex flex-col gap-1.5">
              <div className="h-7" />
              {PROFILE_DIFF.filter((r) => r.lane === l).map((r) => (
                <Mark key={r.id} mark={r.mark} note={r.note} />
              ))}
            </div>
          ))}
          <div className="h-7" />
          <Mark mark="same" />
        </div>
        <Frame
          tone="profile"
          kind="프로필"
          title="탐구 중심"
          meta="가정 · enable 3 · disable 1"
          icon={<Layers />}
        >
          <Rows side="next" lanes={lanes} laneName={laneName} />
        </Frame>
      </div>
    </div>
  );
}

function Rows({
  side,
  lanes,
  laneName,
}: {
  side: "now" | "next";
  lanes: string[];
  laneName: Record<string, string>;
}) {
  return (
    <div className="flex flex-col">
      {lanes.map((l) => (
        <div key={l} className="flex flex-col gap-1.5">
          <div className="flex h-7 items-end gap-1.5 pb-1">
            <span className="font-mono text-[10.5px] font-medium text-text-tertiary">{l}</span>
            <span className="text-ui-xs text-text-tertiary">{laneName[l]}</span>
          </div>
          {PROFILE_DIFF.filter((r) => r.lane === l).map((r) => (
            <Chip
              key={r.id}
              id={r.id}
              state={side === "now" ? r.now : r.next}
              faded={r.mark === "same"}
            />
          ))}
        </div>
      ))}
      <div className="flex h-7 items-end pb-1 text-ui-xs text-text-tertiary">drive 그룹</div>
      <div className="flex h-10 items-center gap-2 rounded-[10px] bg-surface-base px-2.5 shadow-[inset_0_0_0_1px_var(--block-edge)]">
        <PortGlyph type="drive" size={9} />
        <span className="text-ui-sm text-text-primary">Helm</span>
        <span className="ms-auto font-mono text-[10px] text-text-tertiary">
          {side === "now" ? "session · 보유 중" : "driveGroup"}
        </span>
      </div>
    </div>
  );
}
