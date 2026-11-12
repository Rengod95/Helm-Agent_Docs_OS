import { t } from "@fresnel/client/i18n";
import {
  initialSettingsState,
  settingsViewOf,
  type FieldVM,
  type SettingsController,
  type SettingsState,
} from "@fresnel/client/settings";
import { extSettingPrefixes } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { SETTINGS_EDITORS } from "../pages/settings/settings-editors-screen.tsx";
import {
  FieldRow,
  type DedicatedEditors,
  type FieldHandlers,
} from "../pages/settings/settings-field.tsx";
import { SAVED_MARK_MS } from "../pages/settings/settings-model.ts";
import { SettingSection } from "../pages/settings/settings-section.tsx";

// 플러그인 상세의 "설정" 구역(DP-92): 매니페스트 `userConfig`가 만든 엔진 설정 키(`ext.<이름>.*`, `l3.<이름>.*`)를 설정 화면과
// 같은 줄(`FieldRow`)과 같은 저장(사용자 범위)으로 고친다. 켜짐 키(`.enabled`)는 상세 머리의 스위치가 맡으므로 뺀다.
// 시크릿 값은 시크릿 참조 고르기(`secretRef` 전용 편집기)로 받는다. 값을 고칠 키가 없으면 아무것도 그리지 않는다.

const EDITORS: DedicatedEditors = SETTINGS_EDITORS;

/** 이 플러그인이 가진 설정 항목(켜짐 키 제외), 받은 순서 */
export function pluginFieldsOf(fields: readonly FieldVM[], name: string): readonly FieldVM[] {
  const prefixes = extSettingPrefixes(name);
  return fields.filter(
    (field) =>
      prefixes.some((prefix) => field.key.startsWith(prefix) && field.key.length > prefix.length) &&
      field.key !== `ext.${name}.enabled`,
  );
}

export function PluginConfigForm(props: {
  readonly name: string;
  readonly title: string;
}): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [binding, setBinding] = useState<{
    readonly live: boolean;
    readonly controller: SettingsController | null;
  }>({ live: false, controller: null });
  const [saved, setSaved] = useState<ReadonlySet<SettingKey>>(() => new Set());
  const timers = useRef(new Map<SettingKey, number>());

  // 연결이 살아날 때마다 컨트롤러 하나(설정 화면과 같은 식: 렌더에서 만들기만 하고 읽기·구독 끊기는 효과가 한다).
  // 연결이 끊기면 마지막 컨트롤러를 두어 값을 보이고 편집은 막는다
  if (binding.live !== live) {
    setBinding({ live, controller: live ? commands.settings.open() : binding.controller });
  }
  const controller = binding.controller;
  useEffect(() => {
    if (controller === null) return undefined;
    detach(controller.load(), rethrow);
    return () => {
      detach(controller.dispose(), rethrow);
    };
  }, [controller]);
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const handle of all.values()) window.clearTimeout(handle);
      all.clear();
    };
  }, []);

  const subscribe = useCallback(
    (listener: () => void): (() => void) =>
      controller === null ? () => undefined : controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(
    (): SettingsState => (controller === null ? initialSettingsState : controller.getState()),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const fields = useMemo(() => {
    if (state.status !== "ready") return [];
    return pluginFieldsOf(
      settingsViewOf(state).tabs.flatMap((tab) => tab.fields),
      props.name,
    );
  }, [state, props.name]);
  if (fields.length === 0) return null;

  const markSaved = (key: SettingKey): void => {
    setSaved((prev) => new Set([...prev, key]));
    const previous = timers.current.get(key);
    if (previous !== undefined) window.clearTimeout(previous);
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        setSaved((prev) => new Set([...prev].filter((item) => item !== key)));
      }, SAVED_MARK_MS),
    );
  };
  const save = async (key: SettingKey): Promise<void> => {
    if (controller === null || !controller.getState().drafts.has(key)) return;
    await controller.commit(key);
    const after = controller.getState();
    if (!after.drafts.has(key) && !after.errors.has(key)) markSaved(key);
  };
  // 쓸 범위는 설정 화면과 같이 늘 사용자다
  const handlers: FieldHandlers = {
    edit: (key, raw) => {
      controller?.selectScope(key, "user");
      controller?.edit(key, raw);
    },
    change: (key, raw) => {
      if (controller === null) return;
      controller.selectScope(key, "user");
      controller.edit(key, raw);
      detach(save(key), rethrow);
    },
    commit: (key) => {
      detach(save(key), rethrow);
    },
    keepDraft: (key) => {
      controller?.keepDraft(key);
      detach(save(key), rethrow);
    },
    discard: (key) => {
      controller?.discard(key);
    },
    reset: (key) => {
      if (controller !== null) detach(controller.reset(key, "user"), rethrow);
    },
  };
  return (
    // 상세 본문 열의 구역 간격(gap-8)을 따르도록 감싸 설정 카드의 위 여백(첫 구역이 아닐 때 40)을 없앤다
    <div>
      <SettingSection title={t("desktop.addons.section.settings")} label={props.title}>
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            editable={field.editable && live}
            saved={saved.has(field.key)}
            editors={EDITORS}
            handlers={handlers}
          />
        ))}
      </SettingSection>
    </div>
  );
}
