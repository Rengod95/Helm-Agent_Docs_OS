import {
  Combobox,
  Dialog,
  DialogDescription,
  DialogTitle,
  type ComboboxGroupData,
} from "@caustic/react";
import { MessageSquare, Play } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { useMemo, type ReactNode } from "react";
import { useThreadSummaries } from "../../state/engine/index.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { useSelectedThreadId } from "../../state/ui/index.ts";
import { formatKey, resolveKeymap } from "../shell/keybindings.ts";
import {
  availableCommands,
  commandValue,
  decodeValue,
  threadValue,
  type PaletteValue,
} from "./palette-model.ts";

// S-02 명령 팔레트. Dialog 안 인라인 Combobox 하나(caustic에 전용 팔레트가 없다). 입력하면 라벨로 거른다.
// 고른 항목은 `onRun`으로 가고, 팔레트는 먼저 닫힌다. 실제 동작은 App이 맡는다.

export interface PaletteProps {
  readonly mac: boolean;
  readonly keyOverrides?: Readonly<Record<string, string>> | undefined;
  readonly onRun: (value: PaletteValue) => void;
}

export function Palette(props: PaletteProps): ReactNode {
  const open = useShell((s) => s.paletteOpen);
  const actions = useShellActions();
  const threads = useThreadSummaries();
  const selected = useSelectedThreadId();
  const keymap = useMemo(() => resolveKeymap(props.keyOverrides), [props.keyOverrides]);
  const groups = useMemo((): ComboboxGroupData[] => {
    const commands = availableCommands(selected !== null).map((command) => {
      const spec = command.action === null ? null : keymap[command.action];
      return {
        value: commandValue(command.id),
        label: t(command.label),
        leading: <Play />,
        meta: spec === null ? undefined : formatKey(spec, props.mac),
      };
    });
    const found = threads.map((thread) => ({
      value: threadValue(thread.threadId),
      label: thread.title ?? t("desktop.threads.untitled"),
      leading: <MessageSquare />,
      description: thread.workspace ?? undefined,
    }));
    return [
      ...(found.length === 0
        ? []
        : [{ label: t("desktop.palette.group.threads"), options: found }]),
      { label: t("desktop.palette.group.commands"), options: commands },
    ];
  }, [threads, selected, keymap, props.mac]);
  return (
    <Dialog open={open} onOpenChange={(next) => actions.setPaletteOpen(next)} size="md">
      <DialogTitle className="sr-only">{t("desktop.palette.title")}</DialogTitle>
      <DialogDescription className="sr-only">{t("desktop.palette.description")}</DialogDescription>
      <div className="grid gap-2 p-2">
        <Combobox
          mode="inline"
          inline
          open
          autoFocus
          aria-label={t("desktop.palette.input")}
          listLabel={t("desktop.palette.results")}
          placeholder={t("desktop.palette.input")}
          groups={groups}
          emptyMessage={t("desktop.palette.empty")}
          resultsLabel={(n) => t("desktop.palette.resultsCount", { count: n })}
          onValueChange={(value) => {
            const decoded = decodeValue(value);
            actions.setPaletteOpen(false);
            if (decoded !== null) props.onRun(decoded);
          }}
        />
      </div>
    </Dialog>
  );
}
