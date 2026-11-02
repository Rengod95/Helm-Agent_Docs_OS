// 시크릿 목록. caustic Table은 고른 행을 뒤집어(검은 바탕) 그리고 행이 32px부터라, 지금 행을 올린 바탕 하나로 보이는
// 밀도 높은 목록을 caustic 토큰으로 만든다(빈틈: Table에 "현재 행" 상태와 행 단위 링크가 없음). 값 열은 없다.
import type { Secret } from "./fixtures";

const STATUS: Record<Secret["status"], { text: string; cls: string }> = {
  ok: { text: "정상", cls: "text-text-tertiary" },
  unused: { text: "쓰지 않음", cls: "text-text-tertiary" },
  expiring: { text: "3일 뒤 만료", cls: "text-warning-text" },
  expired: { text: "만료됨", cls: "text-danger-text" },
};

const COLS =
  "grid-cols-[minmax(9rem,1.1fr)_minmax(0,1fr)_5.5rem_5.5rem] @max-[34rem]:grid-cols-[minmax(0,1fr)_5.5rem]";

export function SecretList({
  items,
  selected,
  onSelect,
}: {
  items: Secret[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <div role="listbox" aria-label="시크릿 목록" className="grid">
      <div aria-hidden className={`grid ${COLS} gap-3 px-2 pb-1 text-ui-sm text-text-tertiary`}>
        <span>이름</span>
        <span className="@max-[34rem]:hidden">설명</span>
        <span className="@max-[34rem]:hidden">마지막 사용</span>
        <span>상태</span>
      </div>
      {items.map((s) => {
        const cur = s.name === selected;
        const st = STATUS[s.status];
        return (
          <div
            key={s.name}
            role="option"
            aria-selected={cur}
            tabIndex={cur ? 0 : -1}
            onClick={() => onSelect(s.name)}
            className={`grid h-8 ${COLS} cursor-default items-center gap-3 rounded-md px-2 text-ui outline-none focus-visible:focus-ring ${
              cur
                ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]"
                : "hover:bg-neutral-hover"
            }`}
          >
            <span className="truncate font-mono text-mono text-text-primary">{s.name}</span>
            <span className="truncate text-text-secondary @max-[34rem]:hidden">{s.desc}</span>
            <span className="truncate text-ui-sm text-text-tertiary tabular-nums @max-[34rem]:hidden">
              {s.lastUsed}
            </span>
            <span className={`truncate text-ui-sm ${st.cls}`}>{st.text}</span>
          </div>
        );
      })}
    </div>
  );
}
