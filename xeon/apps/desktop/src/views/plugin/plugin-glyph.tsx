import {
  Archive,
  Bell,
  Calendar,
  CodeXml,
  Command,
  Compass,
  customIcon,
  File,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  Globe,
  Grid2x2,
  House,
  Image,
  Inbox,
  KeyRound,
  Laptop,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Lightbulb,
  ListChecks,
  Mail,
  MessageSquare,
  Monitor,
  Package,
  Palette,
  PenTool,
  Plug,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Target,
  Terminal,
  User,
  WandSparkles,
  type Icon,
} from "@caustic/react/icons";
import { createElement, type ReactNode } from "react";

// 플러그인 표지(DP-90~92): 기여 선언의 `icon`(caustic 아이콘 어댑터 이름, ADR-0021 §3.2)이 아래 표에 있으면 그 아이콘,
// 없으면 이름 첫 글자다. 표는 앱이 그릴 수 있다고 약속하는 이름이다(확장이 아무 이름이나 불러 번들 전체를 싣지 않게).
// 크기: tab 16(머리 줄 탭, 타일 없음), card 36 타일(목록 카드), head 56 타일(상세 머리). 색은 이름마다 바꾸지 않는다.

const PLUGIN_ICONS: Readonly<Record<string, Icon>> = {
  Archive,
  Bell,
  Calendar,
  CodeXml,
  Command,
  Compass,
  File,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  Globe,
  Grid2x2,
  House,
  Image,
  Inbox,
  KeyRound,
  Laptop,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Lightbulb,
  ListChecks,
  Mail,
  MessageSquare,
  Monitor,
  Package,
  Palette,
  PenTool,
  Plug,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Target,
  Terminal,
  User,
  WandSparkles,
};

/** 아이콘 이름을 그릴 부품으로. 모르는 이름이면 undefined */
function pluginIconOf(name: string | undefined): Icon | undefined {
  if (name === undefined || !Object.hasOwn(PLUGIN_ICONS, name)) return undefined;
  return PLUGIN_ICONS[name];
}

/** 고정 표지(Solar에 없는 모양이라 선으로 그린다, lucide `Pin`의 윤곽) */
export const PinIcon: Icon = customIcon(
  "Pin",
  <>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </>,
);

const TILE: Readonly<Record<"card" | "head", string>> = {
  card: "size-9 rounded-lg text-[15px]/5 [&_svg]:size-[18px]",
  head: "size-14 rounded-xl text-title-1 [&_svg]:size-6",
};

export function PluginGlyph(props: {
  readonly icon: string | undefined;
  readonly monogram: string;
  readonly size: "tab" | "card" | "head";
  readonly off?: boolean | undefined;
}): ReactNode {
  const Glyph = pluginIconOf(props.icon);
  const tone = props.off === true ? "text-text-tertiary" : "text-text-secondary";
  if (props.size === "tab") {
    return Glyph === undefined ? (
      <span
        aria-hidden
        className={`grid size-4 flex-none place-items-center rounded-[4px] bg-neutral-hover text-[10px]/none font-semibold ${tone}`}
      >
        {props.monogram}
      </span>
    ) : (
      createElement(Glyph, { "aria-hidden": true, className: `size-4 flex-none ${tone}` })
    );
  }
  return (
    <span
      aria-hidden
      data-slot="plugin-glyph"
      className={`grid flex-none place-items-center border border-border-subtle bg-bg-inset font-medium ${TILE[props.size]} ${tone}`}
    >
      {Glyph === undefined ? props.monogram : createElement(Glyph)}
    </span>
  );
}
