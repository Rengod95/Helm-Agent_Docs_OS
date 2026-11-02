// 공용 셸 진입점. 페이지 목업은 여기서만 가져온다: import { Shell, ShellStateProvider, ... } from "../_shell";
export * from "./icons";
export { loadCausticFonts } from "./fonts";
export { MockRoot, type MockStateDef, type Theme } from "./dev";
export {
  ShellStateProvider,
  useShell,
  type Area,
  type Layout,
  type ShellState,
  type WorkbenchContext,
} from "./state";
export { Shell, STAGE_ID, type ShellProps } from "./shell";
export type { PaletteGroup } from "./palette";
export { chatRightTabs, standardRightTabs, workbenchRightTabs, type RightTab } from "./right-panel";
export type { ThreadListProps, WorkbenchPanelProps } from "./start-panel";
export { WB_WIDTH, WorkbenchHead, type WorkbenchHeadProps } from "./workbench-head";
export { RuntimeLog } from "./parts/runtime-log";
export { ThreadTail } from "./parts/thread-tail";
export { ToneIcon } from "./parts/tone-icon";
export { defaultStatusCells, type StatusOptions } from "./status";
export { StatusBar, TokenBar, type StatusCell } from "./parts/status-bar";
export { NoticeList } from "./parts/notice-list";
export { ShellToaster } from "./parts/shell-toaster";
export { QuestionCard, type QuestionCardProps } from "./parts/question-card";
export { ToolApprovalCard, type Decision, type ToolApprovalCardProps } from "./parts/tool-approval";
export {
  LineGrid,
  LineGridBlock,
  LineGridCell,
  LineGridEmpty,
  GRID_BODY,
  GRID_BODY_COMPACT,
  GRID_INSET,
  GRID_INSET_COMPACT,
  LineGridFrame,
  LineGridMark,
  LineGridMetric,
  type LineGridBlockProps,
  type LineGridCellData,
  type LineGridCellProps,
  type LineGridColumn,
  type LineGridDot,
  type LineGridEmptyProps,
  type LineGridItem,
  type LineGridMarkProps,
  type LineGridMetricProps,
  type LineGridProps,
  type LineGridRow,
  type LineGridSelection,
} from "./line-grid";
export {
  HEAD_GAP,
  ITEM_GAP,
  PAGE_HEAD_GAP,
  PAGE_PAD,
  PAGE_PAD_GRID,
  PageBody,
  PageHead,
  PageSection,
  SECTION_GAP,
  SoftAlert,
  StageHead,
  WELL_SECTION_GAP,
  type PageHeadProps,
  type PageSectionProps,
  type StageHeadProps,
} from "./page";
export {
  currentFolder,
  navigateToArea,
  navigateToNav,
  navigateToPage,
  navigateToPaletteItem,
  PAGE_ROUTES,
  PALETTE_NAV,
  pageHref,
  postRoute,
  routeForNav,
  type PageRoute,
} from "./routes";
export * from "./fixtures";
export * from "./workbench-fixtures";
export { T, josa, type TermKey } from "./terms";
export { L, L2, LANG, switchLang, type Lang } from "./i18n";
export {
  goScenario,
  isDev,
  ScenarioDock,
  useScenarioParam,
  useTimeline,
  useTypewriter,
  type ScenarioDef,
  type TimelineStep,
} from "./scenario";
