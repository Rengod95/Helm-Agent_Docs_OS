import { t } from "@fresnel/client/i18n";
import type { FieldVM } from "@fresnel/client/settings";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { ReactNode } from "react";
import { ConnectionScreen } from "../connection/connection-screen.tsx";
import { FieldRow, type DedicatedEditors, type FieldHandlers } from "./settings-field.tsx";
import { SettingSection } from "./settings-section.tsx";

// 설정의 "연결과 서비스" 구역. 연결 화면 본문을 제목 머리 없이 싣고, 그 아래 서비스 항목(이 기기의 서비스 켜기, 원격 서비스 주소)을
// 설정 줄로 그린다. 연결 화면은 상태를 스스로 읽으므로 이 구역은 마운트와 언마운트만 맞으면 된다. 항목 값과 저장은 설정 화면의 핸들러가 한다.

export interface SettingsConnectionSectionProps {
  /** 이 구역에 드는 항목(`fieldsOfSection(view, "connection")`) */
  readonly fields: readonly FieldVM[];
  /** 읽기 전용(오프라인)이면 참이다. 엔진 항목은 바꿀 수 없다 */
  readonly readOnly: boolean;
  /** "저장됨" 표시가 보이는 키 */
  readonly saved: ReadonlySet<SettingKey>;
  readonly editors: DedicatedEditors;
  readonly handlers: FieldHandlers;
}

export function SettingsConnectionSection(props: SettingsConnectionSectionProps): ReactNode {
  return (
    <>
      <ConnectionScreen embedded />
      {props.fields.length === 0 ? null : (
        <SettingSection title={t("desktop.settings.connection.service")}>
          {props.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              editable={field.editable && (!props.readOnly || field.origin === "desktop")}
              saved={props.saved.has(field.key)}
              editors={props.editors}
              handlers={props.handlers}
            />
          ))}
        </SettingSection>
      )}
    </>
  );
}
