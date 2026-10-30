// S-02 명령 팔레트(caustic 빈틈 C-01의 대용): Dialog 안 Combobox mode="inline". 묶음 제목, 보조 설명, 바로 가기 키를 보이고
// 입력하면 라벨로 거른다(Combobox 기본 필터). 아래 줄에 키 안내.
import {
  Combobox,
  Dialog,
  DialogDescription,
  DialogTitle,
  type ComboboxGroupData,
} from "@caustic/react";
import { palette } from "./fixtures";
import { Command, MessageSquare, Settings, SlashSquare } from "./icons";
import { useShell } from "./state";

const GROUP_ICON: Record<string, React.ReactNode> = {
  대화: <MessageSquare />,
  명령: <Command />,
  "슬래시 명령": <SlashSquare />,
  설정: <Settings />,
};

const groups: ComboboxGroupData[] = palette.map((g) => ({
  label: g.group,
  options: g.items.map((item) => {
    const it = typeof item === "string" ? { label: item } : item;
    return {
      value: `${g.group}:${it.label}`,
      label: it.label,
      leading: GROUP_ICON[g.group],
      ...(it.hint !== undefined
        ? {
            description:
              g.group === "설정" ? (
                <span className="font-mono text-mono-sm">{it.hint}</span>
              ) : (
                it.hint
              ),
          }
        : {}),
    };
  }),
}));

/** onRun은 고른 항목의 묶음 이름과 라벨을 받는다(예: "대화", "테스트 정리"). 팔레트는 먼저 닫힌다. */
export function Palette({
  onRun,
}: {
  onRun?: ((group: string, label: string) => void) | undefined;
}) {
  const m = useShell();
  const run = (value: string) => {
    const [group, label] = value.split(":") as [string, string];
    m.setPaletteOpen(false);
    onRun?.(group, label);
  };
  return (
    <Dialog open={m.paletteOpen} onOpenChange={m.setPaletteOpen} size="md">
      <DialogTitle className="sr-only">명령 팔레트</DialogTitle>
      <DialogDescription className="sr-only">
        명령, 대화, 슬래시 명령, 설정을 찾아 실행해요.
      </DialogDescription>
      <div className="grid gap-2 p-2">
        <Combobox
          mode="inline"
          inline
          open
          autoFocus
          aria-label="명령 또는 대화 찾기"
          listLabel="결과"
          placeholder="명령 또는 대화 찾기"
          groups={groups}
          emptyMessage="맞는 항목이 없어요"
          resultsLabel={(n) => `결과 ${n}개`}
          onValueChange={run}
        />
      </div>
    </Dialog>
  );
}
