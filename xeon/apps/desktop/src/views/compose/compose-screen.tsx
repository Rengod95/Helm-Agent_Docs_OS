// 구성 화면(P-21, `compose`): 보기 셋(그룹·흐름·프로필)과 고른 그룹. 설치 그룹은 읽기 전용이다(§6.28).
// 확장 목록은 크래프트 컨트롤러가 읽어 둔 것을 쓴다.
import { t } from "@fresnel/client/i18n";
import {
  Field,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench } from "../../state/workbench/index.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useWorkbenchController } from "../workbench/controller.ts";
import { tabLinkOf } from "../workbench/tab-read.ts";
import { GroupSource } from "./compose-group.tsx";
import { ProfilePanel } from "./compose-profile.tsx";
import { COMPOSE_VIEWS, VIEW_TEXT, type ComposeViewId } from "./compose-text.ts";

export function ComposeScreen(): ReactNode {
  useWorkbenchController();
  const link = tabLinkOf(useLinkPhase());
  const entries = useWorkbench((s) => s.entries);
  const groups = entries.filter((entry) => entry.isGroup);
  const [view, setView] = useState<ComposeViewId>("group");
  const [picked, setPicked] = useState<string | null>(null);
  const group = groups.find((entry) => entry.name === picked) ?? groups[0] ?? null;
  return (
    <section
      aria-labelledby="compose-screen-title"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          id="compose-screen-title"
          className="m-0 flex items-center gap-1 text-ui-strong text-text-primary"
        >
          {t("desktop.compose.title")}
          <InfoTip text={t("desktop.compose.readonly")} />
        </h1>
        <SegmentedControl
          aria-label={t("desktop.compose.view.label")}
          size="sm"
          value={view}
          onValueChange={(value) => {
            const next = COMPOSE_VIEWS.find((item) => item === value);
            if (next !== undefined) setView(next);
          }}
        >
          {COMPOSE_VIEWS.map((id) => (
            <SegmentedControlItem key={id} value={id}>
              {t(VIEW_TEXT[id])}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      {view === "profile" ? (
        <ProfilePanel link={link} entries={entries} />
      ) : group === null ? (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.compose.noGroups")}</p>
      ) : (
        <>
          <Field label={t("desktop.compose.pickGroup")}>
            <Select value={group.name} onValueChange={setPicked}>
              {groups.map((entry) => (
                <SelectOption key={entry.name} value={entry.name}>
                  {entry.displayName}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <GroupSource key={group.name} name={group.name} link={link} mode={view} />
        </>
      )}
    </section>
  );
}
