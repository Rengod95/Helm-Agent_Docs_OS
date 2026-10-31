// 맥락 칸(왼쪽 패널, 결정 3: 맥락 칸 하나가 작업대 모든 화면을 움직인다). wb-canvas 것을 옮겨 왔다.
// 맥락의 정본은 이 칸 하나다(§6.21). 캔버스 위에는 맥락 이름을 다시 쓰지 않고 그 맥락의 한 줄(턴, 실시간)과 비교만 둔다.
import { IconButton, Select, SelectGroup, SelectHeading, SelectOption } from "@caustic/react";
import { MessageSquare } from "../../_shell";
import { CONTEXTS } from "../data";
type CtxKind = "all" | "thread" | "profile" | "trial";

const HEAD: Record<CtxKind, string> = { all: "", thread: "대화", profile: "프로필", trial: "시험" };
const PREFIX: Record<CtxKind, string> = {
  all: "맥락 · ",
  thread: "대화 · ",
  profile: "프로필 · ",
  trial: "시험 · ",
};

export function ContextField({
  value,
  onChange,
  onGoToThread,
}: {
  value: string;
  onChange: (v: string) => void;
  onGoToThread: () => void;
}) {
  const kinds: CtxKind[] = ["thread", "profile", "trial"];
  const cur = CONTEXTS.find((c) => c.value === value);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        size="xs"
        variant="soft"
        aria-label="맥락"
        value={value}
        onValueChange={onChange}
        className="min-w-0 flex-1"
      >
        <SelectOption value="all">맥락 · 전체</SelectOption>
        {kinds.map((k) => (
          <SelectGroup key={k}>
            <SelectHeading>{HEAD[k]}</SelectHeading>
            {CONTEXTS.filter((c) => c.kind === k).map((c) => (
              <SelectOption key={c.value} value={c.value}>
                {PREFIX[k]}
                {c.label}
              </SelectOption>
            ))}
          </SelectGroup>
        ))}
      </Select>
      {(cur?.kind === "thread" || cur?.kind === "trial") && (
        <IconButton size="md" variant="ghost" label="그 대화로 가기" onClick={onGoToThread}>
          <MessageSquare />
        </IconButton>
      )}
    </div>
  );
}
