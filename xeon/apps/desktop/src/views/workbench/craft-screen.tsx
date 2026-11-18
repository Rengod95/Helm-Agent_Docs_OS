// 크래프트 개요(`overview`, P-16). 캔버스(지도·순서·링크)가 화면 전체를 쓰고, 도구 막대·찾기·층 패널·선택 패널·자세히 보기는 캔버스의 떠 있는 판이다.
// 이 파일은 목록 읽기 상태 띠(읽는 중·오류·오프라인)를 위에 두고, 목록이 읽힌 뒤에만 캔버스를 그리며 원천을 잇는다.
// 자동 꺼짐 알림은 위 띠에 두지 않고 고른 플러그인의 카드에 있다(`craft-parts.tsx`의 `ExtNotice`). 그 카드의 답은 여기서 준다.
import { t } from "@fresnel/client/i18n";
import { useWorkbench } from "../../state/workbench/index.ts";
import { useMemo, useState, type ReactNode } from "react";
import { CraftProvider } from "../craft/craft-context.tsx";
import { CraftBody } from "../craft/craft-screen.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { useCraftSource } from "./craft-source.ts";
import { AutoOffActionsContext, ListStatusBand, useToggleRequest } from "./craft-parts.tsx";
import { BuilderEntry } from "./builder-entry.tsx";
import { HookAnswersContext } from "./hook-notice.tsx";
import { ScreenHeader } from "../shell/screen-header.tsx";
import { Select, SelectOption } from "@caustic/react";
import { BUILD_CHECKS } from "../../app/build.ts";
import { CANVAS_DESIGNS, type CanvasDesign } from "../craft/canvas/registry.ts";

// 개발 빌드: 지금 화면과 프로필 캔버스 시안(registry) 사이를 바꾼다. 고른 값은 localStorage에 남는다(스크린샷 도구가 미리 정한다)
const DESIGN_KEY = "fresnel.craft.canvasDesign";

export function CraftScreen(): ReactNode {
  const [design, setDesign] = useState(() =>
    BUILD_CHECKS ? (localStorage.getItem(DESIGN_KEY) ?? "") : "",
  );
  const picked = CANVAS_DESIGNS.find((d) => d.id === design);
  const picker = BUILD_CHECKS ? (
    <div className="absolute top-1.5 right-3 z-30">
      <Select
        size="sm"
        aria-label={t("desktop.craft.canvas.pick")}
        value={picked?.id ?? "current"}
        onValueChange={(id) => {
          localStorage.setItem(DESIGN_KEY, id);
          setDesign(id);
        }}
        className="w-36"
      >
        <SelectOption value="current">{t("desktop.craft.canvas.current")}</SelectOption>
        {CANVAS_DESIGNS.map((d) => (
          <SelectOption key={d.id} value={d.id}>
            {t(d.name)}
          </SelectOption>
        ))}
      </Select>
    </div>
  ) : null;
  if (picked === undefined) return <OverviewScreen picker={picker} />;
  return <DesignHost key={picked.id} design={picked} picker={picker} />;
}

function DesignHost(props: {
  readonly design: CanvasDesign;
  readonly picker: ReactNode;
}): ReactNode {
  const [inside, setInside] = useState<string | null>(null);
  const { ProfileCanvas, PluginInside } = props.design;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {inside === null ? (
        <ProfileCanvas onOpen={setInside} />
      ) : (
        <PluginInside
          key={inside}
          pluginId={inside}
          onOpen={setInside}
          onBack={() => {
            setInside(null);
          }}
        />
      )}
      {props.picker}
    </div>
  );
}

function OverviewScreen(props: { readonly picker: ReactNode }): ReactNode {
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const source = useCraftSource(controller, toggle.request);
  const ready = useWorkbench((s) => s.list === "ready");
  // 자동 꺼짐 알림의 두 답: 다시 켜기(켜 두기)와 끄기(둘 다 컨트롤러가 설정을 쓰고 목록을 다시 읽는다)
  const answers = useMemo(
    () => ({
      keepOn: (name: string) => {
        detachVoid(controller.reenable(name));
      },
      keepOff: (name: string) => {
        detachVoid(controller.keepOff(name));
      },
    }),
    [controller],
  );
  const hookAnswers = useMemo(
    () => ({
      keepOn: (hook: string) => controller.hookKeepOn(hook),
      keepOff: (hook: string) => controller.hookKeepOff(hook),
    }),
    [controller],
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 캔버스가 그려지면 도구 막대가 펼치기 단추를 가진다. 목록을 못 읽는 동안은 캔버스가 없어 머리를 둔다 */}
      <ScreenHeader hidden={ready} title={t("desktop.shell.nav.overview")} />
      <ListStatusBand controller={controller} />
      {ready && (
        <AutoOffActionsContext value={answers}>
          <HookAnswersContext value={hookAnswers}>
            <CraftProvider source={source}>
              <CraftBody />
            </CraftProvider>
          </HookAnswersContext>
        </AutoOffActionsContext>
      )}
      {toggle.dialog}
      <BuilderEntry controller={controller} />
      {props.picker}
    </div>
  );
}
