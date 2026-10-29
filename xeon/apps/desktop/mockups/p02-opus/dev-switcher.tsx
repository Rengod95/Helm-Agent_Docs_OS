// 목업 전용: 화면 상태(S1~S7)와 테마를 바꾸는 개발용 띠. 앱 화면 밖(창 위쪽, 오른쪽)에 둔다.
// URL ?state=S1..S7&theme=light|dark 와 함께 바뀐다.
import { Select, SelectOption } from "@caustic/react";
import { STATES, type StateId } from "./store";

export type Theme = "light" | "dark";

export function DevSwitcher({
  state,
  theme,
  onState,
  onTheme,
}: {
  state: StateId;
  theme: Theme;
  onState: (s: StateId) => void;
  onTheme: (t: Theme) => void;
}) {
  return (
    <div
      role="region"
      aria-label="목업 전용 상태 전환"
      className="order-first flex h-9 flex-none items-center justify-end gap-2 border-b border-border-subtle bg-bg-inset px-3 text-ui-xs text-text-tertiary"
    >
      <span className="mr-auto">목업 전용 · 실제 앱에는 없어요</span>
      <Select
        size="xs"
        aria-label="화면 상태"
        value={state}
        onValueChange={(v) => onState(v as StateId)}
        className="w-40"
      >
        {STATES.map((s) => (
          <SelectOption key={s.id} value={s.id}>
            {s.label}
          </SelectOption>
        ))}
      </Select>
      <Select
        size="xs"
        aria-label="테마"
        value={theme}
        onValueChange={(v) => onTheme(v as Theme)}
        className="w-24"
      >
        <SelectOption value="light">라이트</SelectOption>
        <SelectOption value="dark">다크</SelectOption>
      </Select>
    </div>
  );
}
