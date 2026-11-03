import {
  Combobox,
  Dialog,
  DialogDescription,
  DialogTitle,
  type ComboboxGroupData,
  type ComboboxOptionData,
} from "@caustic/react";
import { ChevronRight, Ellipsis, MessageSquare, Play, Settings } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  settingsViewOf,
  TAB_ORDER,
  TAB_SPECS,
  type CommandRowVM,
  type FieldVM,
} from "@fresnel/client/settings";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useLinkPhase, useThreadSummaries } from "../../state/engine/index.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { useSelectedThreadId } from "../../state/ui/index.ts";
import { useCommands } from "../commands.ts";
import { formatKey, resolveKeymap } from "../shell/keybindings.ts";
import {
  availableCommands,
  commandValue,
  decodeValue,
  groupCellsOf,
  settingValue,
  slashValue,
  threadValue,
  visibleGroupsOf,
  type GroupCell,
  type GroupInput,
  type GroupStatus,
  type PaletteGroupId,
  type PaletteItem,
  type PaletteRun,
} from "./palette-model.ts";

// S-02 명령 팔레트. Dialog 안 인라인 Combobox 하나(caustic에 전용 팔레트가 없다). 찾기 글과 묶음 걸러내기는 모델이 하고,
// Combobox의 자체 걸러내기는 끈다(`matchAll`). 고른 항목은 `onRun`으로 가고, 팔레트는 먼저 닫힌다. 실제 동작은 App이 맡는다.
// 슬래시 명령과 설정 항목은 열 때 읽는다(연결이 있을 때만). "더 보기"는 팔레트 안에서 묶음을 펼친다.

export interface PaletteProps {
  readonly mac: boolean;
  readonly keyOverrides?: Readonly<Record<string, string>> | undefined;
  readonly onRun: (run: PaletteRun) => void;
}

/** 읽은 값. 읽는 중과 실패는 그 묶음만 상태 칸으로 바뀐다 */
type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly value: T };

const GROUP_HEADING: Readonly<Record<PaletteGroupId, MessageId>> = {
  thread: "desktop.palette.group.threads",
  command: "desktop.palette.group.commands",
  slash: "desktop.palette.group.slash",
  setting: "desktop.palette.group.settings",
};

/** 묶음마다 행 앞에 두는 아이콘. 구성 요소를 고르고 그릴 때 `<Icon />`으로 쓴다 */
const GROUP_ICON: Readonly<Record<PaletteGroupId, ComponentType>> = {
  thread: MessageSquare,
  command: Play,
  slash: ChevronRight,
  setting: Settings,
};

/** 상태 칸의 문장. 대화와 명령 묶음은 읽기를 따로 하지 않아 일반 문장을 쓴다 */
function statusTextOf(group: PaletteGroupId, status: Exclude<GroupStatus, "ready">): MessageId {
  const failed = status === "failed";
  switch (group) {
    case "slash":
      return failed ? "desktop.palette.status.slashFailed" : "desktop.palette.status.slashLoading";
    case "setting":
      return failed
        ? "desktop.palette.status.settingsFailed"
        : "desktop.palette.status.settingsLoading";
    case "thread":
    case "command":
      return failed ? "desktop.palette.status.failed" : "desktop.palette.status.loading";
    default:
      return assertNever(group, "palette group");
  }
}

function optionOf(group: PaletteGroupId, cell: GroupCell): ComboboxOptionData {
  const Icon = GROUP_ICON[group];
  switch (cell.kind) {
    case "item":
      return {
        value: cell.item.value,
        label: cell.item.label,
        leading: <Icon />,
        description: cell.item.description ?? undefined,
        meta: cell.item.meta ?? undefined,
      };
    case "more":
      return {
        value: cell.value,
        label: t("desktop.palette.more"),
        leading: <Ellipsis />,
        meta: String(cell.hidden),
      };
    case "status":
      return { value: cell.value, label: t(statusTextOf(group, cell.status)), disabled: true };
    default:
      return assertNever(cell, "palette cell");
  }
}

/** Combobox의 자체 걸러내기를 끈다. 찾기는 `groupCellsOf`가 한다 */
const matchAll = (): boolean => true;

export function Palette(props: PaletteProps): ReactNode {
  const open = useShell((s) => s.paletteOpen);
  const actions = useShellActions();
  return (
    <Dialog open={open} onOpenChange={(next) => actions.setPaletteOpen(next)} size="md">
      <DialogTitle className="sr-only">{t("desktop.palette.title")}</DialogTitle>
      <DialogDescription className="sr-only">{t("desktop.palette.description")}</DialogDescription>
      <PaletteBody mac={props.mac} keyOverrides={props.keyOverrides} onRun={props.onRun} />
    </Dialog>
  );
}

/** 팔레트 본문. 대화 상자가 열릴 때마다 새로 마운트되므로 찾는 글과 펼친 묶음은 열 때마다 비어 있다 */
export function PaletteBody(props: PaletteProps): ReactNode {
  const commands = useCommands();
  const actions = useShellActions();
  const live = useLinkPhase() === "live";
  const selected = useSelectedThreadId();
  const threads = useThreadSummaries();
  const keymap = useMemo(() => resolveKeymap(props.keyOverrides), [props.keyOverrides]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<PaletteGroupId>>(() => new Set());
  // "더 보기"를 고르면 Combobox가 입력란 글을 그 항목의 라벨로 바꾼다. 그 한 번의 바꿈은 찾는 글로 받지 않는다
  const skipText = useRef<string | null>(null);
  // 슬래시 명령은 열린 대화마다 따로 읽는다. 읽은 값에는 그 대화 이름을 붙여 다른 대화의 값을 쓰지 않는다
  const [slashLoad, setSlashLoad] = useState<{
    readonly thread: string | null;
    readonly state: Loaded<readonly CommandRowVM[]>;
  }>({ thread: null, state: { status: "loading" } });
  const slash: Loaded<readonly CommandRowVM[]> =
    slashLoad.thread === selected ? slashLoad.state : { status: "loading" };
  const [fields, setFields] = useState<Loaded<readonly FieldVM[]>>({ status: "loading" });

  // 열린 대화의 슬래시 명령(`command.list`). 입력창이 없으면 묶음이 보이지 않으므로 읽지 않는다
  useEffect(() => {
    if (!live || selected === null) return undefined;
    let stale = false;
    const load = async (): Promise<void> => {
      const listed = await commands.commandList(selected);
      if (stale) return;
      setSlashLoad({
        thread: selected,
        state: listed.ok ? { status: "ready", value: listed.value } : { status: "failed" },
      });
    };
    detach(load(), rethrow);
    return () => {
      stale = true;
    };
  }, [commands, live, selected]);

  // 설정 항목(P-09 필드). 설정 화면의 컨트롤러를 잠깐 빌려 읽고 바로 놓는다. 화면이 열려 있지 않아도 항목을 찾게 한다
  useEffect(() => {
    if (!live) return undefined;
    let stale = false;
    const load = async (): Promise<void> => {
      const controller = commands.settings.open();
      if (controller === null) {
        if (!stale) setFields({ status: "failed" });
        return;
      }
      await controller.load();
      const state = controller.getState();
      await controller.dispose();
      if (stale) return;
      setFields(
        state.status === "ready"
          ? { status: "ready", value: settingsViewOf(state).tabs.flatMap((tab) => tab.fields) }
          : { status: "failed" },
      );
    };
    detach(load(), rethrow);
    return () => {
      stale = true;
    };
  }, [commands, live]);

  const threadItems: PaletteItem[] = threads.map((thread) => ({
    value: threadValue(thread.threadId),
    label: thread.title ?? t("desktop.threads.untitled"),
    description: thread.workspace ?? null,
    meta: null,
  }));
  const commandItems: PaletteItem[] = availableCommands(selected !== null).map((command) => {
    const spec = command.action === null ? null : keymap[command.action];
    return {
      value: commandValue(command.id),
      label: t(command.label),
      description: null,
      meta: spec === null ? null : formatKey(spec, props.mac),
    };
  });
  const slashItems: PaletteItem[] =
    slash.status === "ready"
      ? slash.value.map((row) => ({
          value: slashValue(row.name),
          label: row.label,
          description: row.description,
          meta: null,
        }))
      : [];
  // 탭 이름은 읽지 않아도 된다(표가 정해져 있다). 항목은 읽은 뒤에만 더한다
  const settingItems: PaletteItem[] = [
    ...TAB_ORDER.map((tab) => ({
      value: settingValue(tab, null),
      label: TAB_SPECS[tab].label,
      description: t("desktop.palette.settingsTab"),
      meta: null,
    })),
    ...(fields.status === "ready"
      ? fields.value.map((field) => ({
          value: settingValue(field.tab, field.key),
          label: field.label,
          description: TAB_SPECS[field.tab].label,
          meta: null,
        }))
      : []),
  ];

  const sources: Readonly<
    Record<PaletteGroupId, { items: readonly PaletteItem[]; status: GroupStatus }>
  > = {
    thread: { items: threadItems, status: "ready" },
    command: { items: commandItems, status: "ready" },
    slash: { items: slashItems, status: slash.status },
    setting: { items: settingItems, status: fields.status },
  };
  const groups: ComboboxGroupData[] = visibleGroupsOf({
    live,
    hasThread: selected !== null,
  }).flatMap((group) => {
    const source = sources[group];
    const input: GroupInput = {
      group,
      items: source.items,
      status: source.status,
      query,
      expanded: expanded.has(group),
    };
    const cells = groupCellsOf(input);
    if (cells.length === 0) return [];
    return [
      { label: t(GROUP_HEADING[group]), options: cells.map((cell) => optionOf(group, cell)) },
    ];
  });

  const onValue = (value: string): void => {
    const decoded = decodeValue(value);
    if (decoded === null) return;
    if (decoded.kind === "more") {
      skipText.current = t("desktop.palette.more");
      const group = decoded.group;
      setExpanded((prev) => new Set([...prev, group]));
      return;
    }
    actions.setPaletteOpen(false);
    props.onRun(decoded);
  };

  const onInput = (text: string): void => {
    const skip = skipText.current;
    skipText.current = null;
    if (skip !== null && text === skip) return;
    setQuery(text);
  };

  return (
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
        filter={matchAll}
        inputValue={query}
        onInputValueChange={onInput}
        emptyMessage={t("desktop.palette.empty")}
        resultsLabel={(n) => t("desktop.palette.resultsCount", { count: n })}
        onValueChange={onValue}
      />
      {live ? null : (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.palette.offline")}</p>
      )}
    </div>
  );
}
