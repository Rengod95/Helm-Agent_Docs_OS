// "보기 기준"(옛 맥락) 칸과 개념 그림. 결정 3(왼쪽 패널 칸 하나가 크래프트 모든 화면을 움직임)은 그대로 두고,
// 이름과 묶음을 "무엇을 보고 있나"로 바꿨다: 설치 전체 · 대화(실시간) · 테스트 대화 · 프로필(설계도로 보기).
// 보기 기준을 바꾸는 것은 아무것도 바꾸지 않는다. 바꾸는 동작(켜기·끄기, 프로필 적용)은 따로, 늘 "이 대화에 · 다음 단계 경계부터".
import { IconButton, Select, SelectGroup, SelectHeading, SelectOption } from "@caustic/react";
import { CircleHelp, Eye, MessageSquare, SlidersHorizontal, X as XIcon } from "../../_shell";
import { VIEWS, viewOf, type ViewKind } from "../data";

const HEAD: Record<Exclude<ViewKind, "all">, string> = {
  thread: "대화 · 지금 도는 것",
  trial: "테스트 대화",
  preset: "프로필 · 설계도로 보기",
};

export function ViewField({
  value,
  onChange,
  onExplain,
  onGoToThread,
  preview,
  onClearPreview,
}: {
  value: string;
  onChange: (v: string) => void;
  onExplain: () => void;
  onGoToThread: () => void;
  preview: string | null;
  onClearPreview: () => void;
}) {
  const cur = viewOf(value);
  return (
    <div className="grid gap-1">
      <div className="flex h-5 items-center gap-1 ps-0.5 text-ui-xs text-text-tertiary [&_svg]:size-3.5">
        <Eye />
        <span className="flex-1">보기 기준</span>
        <IconButton size="xs" variant="ghost" label="보기 기준이 뭐예요?" onClick={onExplain}>
          <CircleHelp />
        </IconButton>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <Select
          size="xs"
          variant="soft"
          aria-label="보기 기준"
          value={value}
          onValueChange={onChange}
          className="min-w-0 flex-1"
        >
          <SelectOption value="all">설치 전체</SelectOption>
          {(["thread", "trial", "preset"] as const).map((k) => (
            <SelectGroup key={k}>
              <SelectHeading>{HEAD[k]}</SelectHeading>
              {VIEWS.filter((v) => v.kind === k).map((v) => (
                <SelectOption key={v.value} value={v.value}>
                  {v.label}
                </SelectOption>
              ))}
            </SelectGroup>
          ))}
        </Select>
        {(cur.kind === "thread" || cur.kind === "trial") && (
          <IconButton size="md" variant="ghost" label="그 대화로 가기" onClick={onGoToThread}>
            <MessageSquare />
          </IconButton>
        )}
      </div>
      <span className="flex items-center gap-1.5 ps-0.5 text-ui-xs text-text-tertiary">
        {cur.kind === "thread" && cur.meta.startsWith("실시간") && (
          <span className="size-1.5 rounded-full bg-success-solid" />
        )}
        {cur.kind === "all"
          ? "켜짐·꺼짐은 대화마다 달라요"
          : cur.kind === "preset"
            ? "실행 안 함 · 스위치만 보여요"
            : cur.meta}
      </span>
      {preview !== null && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 rounded-md bg-accent-soft py-1 ps-2 pe-1 text-ui-xs text-accent-text [&_svg]:size-3.5">
          <SlidersHorizontal />
          <span className="min-w-0 flex-1 truncate">바꾸기 미리보기 · {viewOf(preview).label}</span>
          <IconButton size="xs" variant="ghost" label="미리보기 닫기" onClick={onClearPreview}>
            <XIcon />
          </IconButton>
        </div>
      )}
    </div>
  );
}
