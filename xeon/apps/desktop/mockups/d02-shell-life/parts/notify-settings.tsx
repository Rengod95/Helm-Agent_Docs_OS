// N-53 알림 끄는 자리: P-09 "실행과 서비스" 탭의 알림 묶음(l2.dialog.notify.*, L4.desktop §4.8). 공용 설정 틀(_settings) 위.
// OS 권한이 거부되면 묶음 위에 Alert 하나(DP-28)와 "시스템 설정 열기". 웹은 브라우저 권한 문장으로 바뀐다(NOTES).
// 창 닫기 동작(l4.desktop.window.closeBehavior, 메뉴 막대에 남기)도 같은 탭 아래에 둔다(N-51 진입점).
import { Alert, Select, SelectOption, Switch } from "@caustic/react";
import { SettingRow, SettingSection } from "../../_settings/row";
import { SettingsFrame } from "../../_settings/frame";
import { josa, T } from "../../_shell";

const KINDS = [
  { k: "l2.dialog.notify.approvalWaiting", label: "승인 기다림", on: true },
  { k: "l2.dialog.notify.questionWaiting", label: "질문 기다림", on: true },
  { k: "l2.dialog.notify.backgroundCompleted", label: "백그라운드 완료", on: true },
  { k: "l2.dialog.notify.error", label: "오류", on: true },
  { k: "l2.dialog.notify.completed", label: "대화 완료(창이 뒤에 있을 때)", on: false },
];

export function NotifySettings({ denied }: { denied: boolean }) {
  return (
    <SettingsFrame tab="runtime" onTabSelect={() => {}} title="실행과 서비스">
      <SettingSection title={T.osNotice}>
        {denied && (
          <Alert tone="warning" size="sm" actions={[{ label: "시스템 설정 열기", primary: true }]}>
            시스템에서 Xeon 알림을 막았어요. 앱 안 토스트와 받은 요청에는 그대로 보여요.
          </Alert>
        )}
        <SettingRow label={`${T.osNotice} 보내기`} k="l2.dialog.notify.os" scope="user" apply="now">
          <Switch size="sm" aria-label={`${T.osNotice} 보내기`} defaultChecked disabled={denied} />
        </SettingRow>
        {KINDS.map((x) => (
          <SettingRow key={x.k} label={x.label} k={x.k} scope="default" apply="now">
            <Switch size="sm" aria-label={x.label} defaultChecked={x.on} disabled={denied} />
          </SettingRow>
        ))}
      </SettingSection>
      <SettingSection title="창">
        <SettingRow
          label="창을 닫으면"
          k="l4.desktop.window.closeBehavior"
          scope="user"
          apply="now"
          hint={`메뉴 막대에 남기면 창만 닫히고 ${josa(T.engine, "과", "와")} 진행 중 ${josa(T.turn, "은", "는")} 계속돼요.`}
        >
          <Select size="sm" aria-label="창을 닫으면" defaultValue="tray" className="w-56">
            <SelectOption value="quit">앱 종료</SelectOption>
            <SelectOption value="tray">{josa(T.trayIcon, "으로", "로")} 남기기</SelectOption>
          </Select>
        </SettingRow>
      </SettingSection>
    </SettingsFrame>
  );
}
