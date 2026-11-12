import { SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { FORM_CONTROL_SIZE, RowNote, SettingRow } from "../settings/settings-section.tsx";
import type { KeyStoreNote, KeyStoreView, KeyWhere } from "./key-store-model.ts";

// 시크릿 구역의 "열쇠 보관" 줄(한 줄, 표 위). 세그먼트 두 개와 현재 위치 글, 줄 아래 메시지다. 뜻은 정보 아이콘 하나에 두 줄로 놓는다.
// 임시 배치: 시크릿 구역의 기존 줄 모양(`SettingRow`)을 그대로 쓴다. 옮기기 결과와 판정은 `key-store-model.ts`가 정한다.

function keyWhereOf(value: string): KeyWhere | null {
  return value === "keychain" || value === "file" ? value : null;
}

function NoteView(props: { readonly note: KeyStoreNote }): ReactNode {
  const { note } = props;
  return (
    <>
      <RowNote tone={note.tone}>{t(note.text.id, note.text.args)}</RowNote>
      {note.fix === null ? null : (
        <p className="m-0 ps-5 text-ui text-text-tertiary">{t(note.fix.id, note.fix.args)}</p>
      )}
    </>
  );
}

export function KeyStoreRow(props: {
  readonly view: KeyStoreView;
  readonly onChoose: (to: KeyWhere) => void;
}): ReactNode {
  const { view } = props;
  return (
    <SettingRow
      slot="secret-key-store"
      label={t("desktop.secrets.keyStore.title")}
      info={[t("desktop.secrets.keyStore.info.keychain"), t("desktop.secrets.keyStore.info.file")]}
      description={view.status === null ? undefined : t(view.status.id, view.status.args)}
      disabled={view.disabled}
      control={
        <SegmentedControl
          size={FORM_CONTROL_SIZE}
          aria-label={t("desktop.secrets.keyStore.title")}
          value={view.selected ?? ""}
          disabled={view.disabled}
          onValueChange={(value) => {
            const to = keyWhereOf(value);
            if (to !== null && to !== view.selected) props.onChoose(to);
          }}
        >
          <SegmentedControlItem value="keychain">
            {t("desktop.secrets.keyStore.keychain")}
          </SegmentedControlItem>
          <SegmentedControlItem value="file">
            {t("desktop.secrets.keyStore.file")}
          </SegmentedControlItem>
        </SegmentedControl>
      }
      notes={
        view.notes.length === 0
          ? undefined
          : view.notes.map((note) => <NoteView key={note.text.id} note={note} />)
      }
    />
  );
}
