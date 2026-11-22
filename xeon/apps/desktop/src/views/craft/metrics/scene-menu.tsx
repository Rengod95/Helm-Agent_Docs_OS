// 개발 빌드의 표본 장면 메뉴(메트릭·트레이스 공용, m6X3). 리뷰 화면 셋째 판의 머리 메뉴와 같은 모양이다:
// 화면 머리 오른쪽 끝의 ghost 단추 "표본 · <장면>"(플라스크 그림, 아래 화살표)와 고른 것에 체크가 붙는 목록.
// 개발 빌드 파일(`metrics-dev.tsx`, `trace-dev.tsx`)만 불러 배포 빌드에 들지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Button, Menu, MenuGroup, MenuHeading, MenuItem } from "@caustic/react";
import { Check, ChevronDown, FlaskConical } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { HEADER_CONTROL_SIZE } from "../../shell/screen-header.tsx";

export function SceneMenu<S extends string>(props: {
  readonly scenes: readonly S[];
  readonly words: Readonly<Record<S, MessageId>>;
  readonly value: S;
  readonly onPick: (scene: S) => void;
  /** 찍기 도구가 찾는 표지(`data-metrics-switcher` 등) */
  readonly marker: "metrics" | "trace";
}): ReactNode {
  const current = t(props.words[props.value]);
  return (
    <Menu
      align="end"
      size="sm"
      trigger={
        <Button
          size={HEADER_CONTROL_SIZE}
          variant="ghost"
          {...(props.marker === "metrics"
            ? { "data-metrics-switcher": "" }
            : { "data-trace-switcher": "" })}
          aria-label={`${t("desktop.craft.metrics.dev.menu")}: ${current}`}
          iconStart={<FlaskConical />}
          iconEnd={<ChevronDown />}
          className="text-text-secondary"
        >
          {t("desktop.craft.metrics.dev.trigger", { scene: current })}
        </Button>
      }
    >
      <MenuGroup>
        <MenuHeading>{t("desktop.craft.metrics.dev.scene")}</MenuHeading>
        {props.scenes.map((s) => (
          <MenuItem
            key={s}
            role="menuitemradio"
            selected={s === props.value}
            icon={s === props.value ? <Check /> : <span className="size-4" />}
            onSelect={() => {
              props.onPick(s);
            }}
          >
            {t(props.words[s])}
          </MenuItem>
        ))}
      </MenuGroup>
    </Menu>
  );
}
