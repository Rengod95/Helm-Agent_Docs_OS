import { t } from "@fresnel/client/i18n";
import type { SettingsView } from "@fresnel/client/settings";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { ReactNode } from "react";
import {
  FieldRow,
  type DedicatedEditors,
  type FieldHandlers,
} from "../settings/settings-field.tsx";
import {
  SECRET_ADVANCED_KEYS,
  partFieldsOf,
  shownFieldsOf,
} from "../settings/settings-sections.ts";
import { FoldedFields } from "../shared/folded-fields.tsx";

// 시크릿 구역의 "고급"(DP-85 [결정: 2026-11-11 사용자]). 시크릿 저장소(백엔드)·age 키 위치·임대·감사 보관 키를 접어 둔다.
// 줄은 설정 화면의 일반 항목 줄(FieldRow)이다. 고치는 중인 초안이 있으면 펼친 채 시작한다(저장된 값만으로는 펼치지 않는다).

export function SecretsAdvancedPanel(props: {
  readonly view: SettingsView;
  readonly live: boolean;
  readonly saved: ReadonlySet<SettingKey>;
  readonly editors: DedicatedEditors;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const fields = partFieldsOf(
    { kind: "panel", panel: "secretsAdvanced", keys: SECRET_ADVANCED_KEYS },
    shownFieldsOf(props.view.tabs),
  );
  if (fields.length === 0) return null;
  const changed = fields.some((field) => field.dirty);
  return (
    <FoldedFields
      title={t("desktop.secrets.advanced.title")}
      count={fields.length}
      forceOpen={changed}
    >
      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          editable={field.editable && props.live}
          saved={props.saved.has(field.key)}
          editors={props.editors}
          handlers={props.handlers}
        />
      ))}
    </FoldedFields>
  );
}
