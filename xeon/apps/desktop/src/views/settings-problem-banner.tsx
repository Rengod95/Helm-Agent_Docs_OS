import { Alert, Button } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { SettingsFileProblem } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { useHostNotices } from "./host-notices-context.ts";
import { firstSettingsProblemOf, settingsProblemTextOf } from "./settings-problem-model.ts";

// 읽지 못한 설정 파일의 경고 띠(`host.status.settingsProblems`). 설정 개요의 맨 위와 시작하기 화면의 맨 위에 둔다.
// 경고는 정보 아이콘 뒤에 숨기지 않고 본문에 보인다. 단추는 "파일로 보기"이고, 이 띠를 둔 자리가 누를 동작을 준다.

export function SettingsProblemBannerView(props: {
  readonly problem: SettingsFileProblem;
  /** "파일로 보기"의 동작. 없으면 단추를 그리지 않는다 */
  readonly onOpenFile?: (() => void) | undefined;
  /** 파일 편집기가 이미 열려 있거나 연결이 없으면 단추를 잠근다 */
  readonly openFileDisabled?: boolean | undefined;
}): ReactNode {
  const { problem, onOpenFile, openFileDisabled } = props;
  const text = settingsProblemTextOf(problem);
  return (
    <Alert
      tone="warning"
      size="sm"
      action={
        onOpenFile === undefined ? undefined : (
          <Button
            size="sm"
            variant="outline"
            disabled={openFileDisabled === true}
            onClick={onOpenFile}
          >
            {t("desktop.settings.problem.openFile")}
          </Button>
        )
      }
    >
      <span className="block text-ui-strong">{t("desktop.settings.problem.title")}</span>
      <span className="block">
        {t("desktop.settings.problem.location", { path: text.path, where: text.where })}
      </span>
      <span className="block">{t("desktop.settings.problem.note")}</span>
    </Alert>
  );
}

/** 읽지 못한 설정 파일이 있을 때만 띠를 그린다. 값은 엔진이 실은 알림(`useHostNotices`)에서 읽는다 */
export function SettingsProblemBanner(props: {
  readonly onOpenFile?: (() => void) | undefined;
  readonly openFileDisabled?: boolean | undefined;
}): ReactNode {
  const notices = useHostNotices();
  const problem = firstSettingsProblemOf(notices?.settingsProblems ?? []);
  if (problem === null) return null;
  return (
    <SettingsProblemBannerView
      problem={problem}
      onOpenFile={props.onOpenFile}
      openFileDisabled={props.openFileDisabled}
    />
  );
}
