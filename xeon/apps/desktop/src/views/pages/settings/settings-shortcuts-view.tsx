import { Badge, Button, IconButton, Input, Kbd, toast } from "@caustic/react";
import { RotateCcw, Search } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDesktopShell, type KeybindingsPort } from "../../desktop-shell-context.ts";
import {
  ACTION_IDS,
  DEFAULT_KEYMAP,
  formatKey,
  resolveKeymap,
  type ActionId,
  type KeySpec,
  type Keymap,
} from "../../shell/keybindings.ts";
import {
  ACTION_GROUP,
  ACTION_LABEL_IDS,
  SHORTCUT_GROUP_LABEL_IDS,
  keyPartsOf,
  type ShortcutGroupId,
} from "../../shortcut-help-model.ts";
import {
  FIELD_WIDTH,
  FORM_CONTROL_SIZE,
  RowNote,
  SettingRow,
  SettingSection,
} from "./settings-section.tsx";
import {
  conflictOf,
  overridesOf,
  recordStepOf,
  withDefault,
  withKey,
  withSwap,
} from "./settings-shortcuts-model.ts";

// 설정 "단축키" 구역(DP-89 [결정: 2026-11-11 사용자]). 바꿀 수 있는 동작(`ACTION_IDS`)을 묶음마다 카드 하나로 보이고, 줄마다 지금 키(Kbd),
// "바꾸기"(누른 키를 기록), 바꾼 줄은 "바뀜" 배지와 되돌리기다. 다른 동작이 쓰는 키면 저장하지 않고 줄 아래에 겹친다고 알리며
// "바꿔 쓰기"(상대를 기본 키로 되돌리고 이 키를 씀)를 준다. 입력창·승인 카드의 고정 키는 바꿀 수 없어 이 구역에 없다(⌘/ 도움말에 있다).
// 저장은 기기 설정 파일이고 앱 키 맵에 바로 걸린다(`KeybindingsPort`). 셸이 없는 곳(웹)은 기본 표를 읽기만 한다.
// VS Code 키보드 단축키 편집기와 Raycast 단축키 기록 칩을 참고했다(`_notes/design/dz/dzS3-design.md` 4절).

/** 이 구역에 보이는 묶음 순서(고정 키 묶음인 입력창·승인 카드는 뺀다) */
const GROUPS: readonly ShortcutGroupId[] = [
  "anywhere",
  "navigate",
  "conversation",
  "panel",
  "area",
];

/** 기록 중인 줄과 그 줄의 막힘 */
type Recording =
  | { readonly kind: "idle" }
  | { readonly kind: "recording"; readonly id: ActionId; readonly hint: MessageId | null }
  | {
      readonly kind: "conflict";
      readonly id: ActionId;
      readonly spec: KeySpec;
      readonly other: ActionId;
    };

export function ShortcutsPanel(): ReactNode {
  const shell = useDesktopShell();
  const port = shell?.keybindings;
  if (port === undefined) {
    return (
      <ShortcutsPanelView
        keymap={DEFAULT_KEYMAP}
        mac={navigator.platform.startsWith("Mac")}
        editable={false}
        onSave={() => undefined}
      />
    );
  }
  return <ShortcutsPanelBound port={port} />;
}

function ShortcutsPanelBound(props: { readonly port: KeybindingsPort }): ReactNode {
  const { port } = props;
  const [overrides, setOverrides] = useState(() => port.get());
  const save = (next: Readonly<Record<string, string>>): void => {
    const before = overrides;
    setOverrides(next);
    detach(
      port.set(next).then((saved) => {
        if (saved) return null;
        setOverrides(before);
        toast({ tone: "danger", title: t("desktop.settings.shortcuts.saveFailed") });
        return null;
      }),
      rethrow,
    );
  };
  return (
    <ShortcutsPanelView
      keymap={resolveKeymap(overrides)}
      mac={port.mac}
      editable
      onSave={(keymap) => {
        save(overridesOf(keymap));
      }}
    />
  );
}

export interface ShortcutsPanelViewProps {
  readonly keymap: Keymap;
  readonly mac: boolean;
  /** 바꿀 수 있는가. 셸이 없으면(웹) 읽기만 한다 */
  readonly editable: boolean;
  /** 새 키 맵 전체를 저장한다 */
  readonly onSave: (keymap: Keymap) => void;
}

function KeyChips(props: { readonly spec: KeySpec; readonly mac: boolean }): ReactNode {
  const parts = keyPartsOf(formatKey(props.spec, props.mac), props.mac);
  return (
    <span className="flex flex-none items-center gap-0.5" data-shortcut-keys={props.spec}>
      {parts.map((part, index) => (
        <Kbd key={`${part}-${String(index)}`} size="sm">
          {part}
        </Kbd>
      ))}
    </span>
  );
}

/** 키 칩 묶음. 바꿀 수 있으면 누르면 기록을 시작하는 ghost 단추이고, 아니면 칩만 보인다 */
function KeysButton(props: {
  readonly spec: KeySpec;
  readonly mac: boolean;
  readonly editable: boolean;
  readonly label: string;
  readonly onStart: () => void;
}): ReactNode {
  const chips = <KeyChips spec={props.spec} mac={props.mac} />;
  if (!props.editable) return chips;
  return (
    <Button
      variant="ghost"
      size={FORM_CONTROL_SIZE}
      aria-label={props.label}
      title={t("desktop.settings.shortcuts.change")}
      onClick={props.onStart}
    >
      {chips}
    </Button>
  );
}

export function ShortcutsPanelView(props: ShortcutsPanelViewProps): ReactNode {
  const { keymap, mac, editable } = props;
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<Recording>({ kind: "idle" });
  const changed = ACTION_IDS.filter((id) => keymap[id] !== DEFAULT_KEYMAP[id]);
  const needle = query.trim().toLowerCase();
  const matches = (id: ActionId): boolean =>
    needle === "" ||
    [t(ACTION_LABEL_IDS[id]), formatKey(keymap[id], mac), id].some((hay) =>
      hay.toLowerCase().includes(needle),
    );
  const commit = (next: Keymap): void => {
    setRecording({ kind: "idle" });
    props.onSave(next);
  };
  const onRecordKey = (id: ActionId, event: KeyboardEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const step = recordStepOf(event, mac);
    switch (step.kind) {
      case "waiting":
        return;
      case "cancel":
        setRecording({ kind: "idle" });
        return;
      case "needsModifier":
        setRecording({ kind: "recording", id, hint: "desktop.settings.shortcuts.needsModifier" });
        return;
      case "key": {
        if (step.spec === keymap[id]) {
          setRecording({ kind: "idle" });
          return;
        }
        const other = conflictOf(keymap, id, step.spec, mac);
        if (other !== null) {
          setRecording({ kind: "conflict", id, spec: step.spec, other });
          return;
        }
        commit(resolveKeymap(withKey(overridesOf(keymap), id, step.spec)));
        return;
      }
      default:
        assertNever(step, "recordStep");
    }
  };
  const groups = GROUPS.map((group) => ({
    group,
    ids: ACTION_IDS.filter((id) => ACTION_GROUP[id] === group && matches(id)),
  })).filter((entry) => entry.ids.length > 0);
  return (
    <div data-slot="settings-shortcuts" className="grid">
      <div className="flex items-center gap-2 pb-2">
        <Input
          type="search"
          size={FORM_CONTROL_SIZE}
          variant="soft"
          prefix={<Search />}
          aria-label={t("desktop.settings.shortcuts.search")}
          placeholder={t("desktop.settings.shortcuts.search")}
          value={query}
          spellCheck={false}
          containerClassName={FIELD_WIDTH.medium}
          onValueChange={setQuery}
        />
        <span className="flex-1" />
        {editable ? (
          <Button
            variant="ghost"
            size={FORM_CONTROL_SIZE}
            disabled={changed.length === 0}
            onClick={() => {
              commit(DEFAULT_KEYMAP);
            }}
          >
            {t("desktop.settings.shortcuts.resetAll")}
          </Button>
        ) : null}
      </div>
      {editable ? null : (
        <p className="m-0 pb-2 text-ui text-text-tertiary">
          {t("desktop.settings.shortcuts.readOnly")}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="m-0 py-6 text-center text-ui text-text-tertiary">
          {t("desktop.shortcuts.empty")}
        </p>
      ) : null}
      {groups.map(({ group, ids }) => (
        <SettingSection key={group} title={t(SHORTCUT_GROUP_LABEL_IDS[group])}>
          {ids.map((id) => (
            <ShortcutRow
              key={id}
              id={id}
              keymap={keymap}
              mac={mac}
              editable={editable}
              recording={recording}
              onStart={() => {
                setRecording({ kind: "recording", id, hint: null });
              }}
              onCancel={() => {
                setRecording({ kind: "idle" });
              }}
              onKey={(event) => {
                onRecordKey(id, event);
              }}
              onReset={() => {
                commit(resolveKeymap(withDefault(overridesOf(keymap), id)));
              }}
              onSwap={(spec, other) => {
                commit(resolveKeymap(withSwap(overridesOf(keymap), id, spec, other)));
              }}
            />
          ))}
        </SettingSection>
      ))}
    </div>
  );
}

/** 기록 칩: 점선 테두리 + "키를 누르세요". 나타나면 초점을 받아 키를 듣는다 */
function RecordChip(props: {
  readonly onKey: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <span
      ref={ref}
      role="textbox"
      tabIndex={0}
      aria-label={t("desktop.settings.shortcuts.recording")}
      data-shortcut-recording
      onKeyDown={props.onKey}
      onBlur={props.onCancel}
      className="inline-flex h-7 items-center rounded-md border border-dashed border-accent-solid px-2.5 text-ui text-text-secondary outline-none"
    >
      {t("desktop.settings.shortcuts.recording")}
    </span>
  );
}

function ShortcutRow(props: {
  readonly id: ActionId;
  readonly keymap: Keymap;
  readonly mac: boolean;
  readonly editable: boolean;
  readonly recording: Recording;
  readonly onStart: () => void;
  readonly onCancel: () => void;
  readonly onKey: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onReset: () => void;
  readonly onSwap: (spec: KeySpec, other: ActionId) => void;
}): ReactNode {
  const { id, keymap, mac, recording } = props;
  const label = t(ACTION_LABEL_IDS[id]);
  const mine = recording.kind !== "idle" && recording.id === id;
  const changed = keymap[id] !== DEFAULT_KEYMAP[id];
  const notes =
    mine && recording.kind === "conflict" ? (
      <RowNote
        tone="danger"
        actions={
          <>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                props.onSwap(recording.spec, recording.other);
              }}
            >
              {t("desktop.settings.shortcuts.swap")}
            </Button>
            <Button variant="ghost" size="xs" onClick={props.onCancel}>
              {t("desktop.settings.cancel.button")}
            </Button>
          </>
        }
      >
        {t("desktop.settings.shortcuts.conflict", {
          key: formatKey(recording.spec, mac),
          action: t(ACTION_LABEL_IDS[recording.other]),
        })}
      </RowNote>
    ) : mine && recording.kind === "recording" && recording.hint !== null ? (
      <RowNote>{t(recording.hint)}</RowNote>
    ) : undefined;
  return (
    <SettingRow
      slot="settings-shortcut"
      dataKey={id}
      label={label}
      badges={
        changed ? <Badge size="sm">{t("desktop.settings.shortcuts.changed")}</Badge> : undefined
      }
      notes={notes}
      lead={
        changed && props.editable && !mine ? (
          <IconButton
            variant="ghost"
            size={FORM_CONTROL_SIZE}
            label={t("desktop.settings.shortcuts.reset", { action: label })}
            onClick={props.onReset}
          >
            <RotateCcw />
          </IconButton>
        ) : undefined
      }
      control={
        mine && recording.kind === "recording" ? (
          <RecordChip onKey={props.onKey} onCancel={props.onCancel} />
        ) : (
          // 키 칩 자체가 바꾸기 단추다(ghost sm). 줄마다 "바꾸기" 글 단추를 두면 23줄이 같은 단추로 덮인다(Raycast, VS Code 키 표)
          <KeysButton
            spec={mine && recording.kind === "conflict" ? recording.spec : keymap[id]}
            mac={mac}
            editable={props.editable}
            label={t("desktop.settings.shortcuts.change.aria", { action: label })}
            onStart={props.onStart}
          />
        )
      }
    />
  );
}
