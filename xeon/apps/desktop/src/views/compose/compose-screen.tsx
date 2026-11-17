// 구성 화면(P-21, `compose`): 보기 넷(그룹·흐름·프로필·코드), 고른 그룹, "새 그룹"(§6.28, §6.29). 설치 그룹은 읽기 전용이다.
// 확장 목록은 크래프트 컨트롤러가 읽어 둔 것을 쓴다. 머리는 모든 상태에서 보인다. "새 그룹"을 열면 본문이 시작 화면으로 바뀌고 "뒤로"로 돌아온다.
import { t } from "@fresnel/client/i18n";
import type { FlowDraft } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import {
  Button,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench } from "../../state/workbench/index.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { HEADER_SEGMENTED_SIZE, ScreenHeader } from "../shell/screen-header.tsx";
import { useWorkbenchController } from "../workbench/controller.ts";
import { tabLinkOf } from "../workbench/tab-read.ts";
import { AUTHORING_EXT, builderOf, CodeSource } from "./compose-code.tsx";
import { GroupSource } from "./compose-group.tsx";
import { NewGroupScreen, type NewGroupPrefill } from "./compose-new-group.tsx";
import { ProfilePanel } from "./compose-profile.tsx";
import { COMPOSE_VIEWS, VIEW_TEXT, type ComposeViewId } from "./compose-text.ts";

export function ComposeScreen(): ReactNode {
  const controller = useWorkbenchController();
  const link = tabLinkOf(useLinkPhase());
  const entries = useWorkbench((s) => s.entries);
  const groups = entries.filter((entry) => entry.isGroup);
  const [view, setView] = useState<ComposeViewId>("group");
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<NewGroupPrefill | null>(null);
  // 흐름 초안은 그룹 이름별로 이 화면에 든다. "새 그룹"을 열었다 돌아와도 고친 것이 남는다(화면을 떠나면 사라진다)
  const [flowDrafts, setFlowDrafts] = useState<Readonly<Record<string, FlowDraft>>>({});
  const group = groups.find((entry) => entry.name === picked) ?? groups[0] ?? null;
  // 플러그인 빌더가 목록에 없으면 null이다. 그때 켜기 단추는 잠기고 까닭을 코드 보기가 문장으로 보인다
  const builder = builderOf(entries.find((entry) => entry.name === AUTHORING_EXT));

  const openNew = (next: NewGroupPrefill | null): void => {
    setPrefill(next);
    setCreating(true);
  };
  const enableBuilder = (): void => {
    detach(controller.toggle(AUTHORING_EXT, true), rethrow);
  };

  return (
    <section aria-labelledby="compose-screen-title" className="flex min-h-0 flex-1 flex-col">
      {/* 공용 머리(DP-122): 제목·읽기 전용 안내(정보 아이콘)·보기 고르기 */}
      <ScreenHeader
        title={t("desktop.compose.title")}
        titleId="compose-screen-title"
        meta={<InfoTip text={t("desktop.compose.readonly")} />}
        controls={
          <SegmentedControl
            aria-label={t("desktop.compose.view.label")}
            size={HEADER_SEGMENTED_SIZE}
            // 새 그룹을 여는 동안에는 보기 하나도 고른 것으로 보이지 않는다
            value={creating ? "" : view}
            onValueChange={(value) => {
              const next = COMPOSE_VIEWS.find((item) => item === value);
              if (next !== undefined) {
                setCreating(false);
                setView(next);
              }
            }}
          >
            {COMPOSE_VIEWS.map((id) => (
              <SegmentedControlItem key={id} value={id}>
                {t(VIEW_TEXT[id])}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        }
      />
      {/* 시안 WB_WIDTH와 같은 가운데 폭(60rem, 좌우 여백 3). 스크롤은 머리 아래 본문만 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-240 flex-col gap-4 px-3 pb-8">
          {creating ? (
            <NewGroupScreen
              link={link}
              prefill={prefill}
              onBack={() => {
                setCreating(false);
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {view === "profile" || group === null ? null : (
                  // 시안처럼 고르기 칸에 보이는 이름은 두지 않는다. 이름은 aria-label로만 붙는다
                  <Select
                    size="xs"
                    aria-label={t("desktop.compose.pickGroup")}
                    className="w-36"
                    value={group.name}
                    onValueChange={setPicked}
                  >
                    {groups.map((entry) => (
                      <SelectOption key={entry.name} value={entry.name}>
                        {entry.displayName}
                      </SelectOption>
                    ))}
                  </Select>
                )}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    openNew(null);
                  }}
                >
                  {t("desktop.compose.newGroup.button")}
                </Button>
              </div>
              {view === "profile" ? (
                <ProfilePanel link={link} entries={entries} />
              ) : group === null ? (
                <p className="m-0 text-ui text-text-tertiary">{t("desktop.compose.noGroups")}</p>
              ) : view === "code" ? (
                <CodeSource
                  key={group.name}
                  name={group.name}
                  link={link}
                  builder={builder}
                  onMake={(name) => {
                    openNew({ name, kind: "single-plugin" });
                  }}
                  onEnable={enableBuilder}
                />
              ) : (
                <GroupSource
                  key={group.name}
                  name={group.name}
                  link={link}
                  installed={groups.some((entry) => entry.name === group.name)}
                  mode={view}
                  flowDraft={flowDrafts[group.name] ?? null}
                  onFlowDraft={(draft) => {
                    setFlowDrafts((current) => ({ ...current, [group.name]: draft }));
                  }}
                  onMake={(composition) => {
                    openNew({ name: "", kind: "single-plugin", composition });
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
