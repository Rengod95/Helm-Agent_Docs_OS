import {
  ActivityTree,
  Alert,
  Button,
  Chip,
  EmptyState,
  Field,
  FormLayout,
  Input,
  List,
  ListDescription,
  ListDescriptionRow,
  ListRow,
  Meter,
  NumberField,
  Progress,
  SectionHeader,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Stepper,
  Switch,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
  TimelineItem,
  type ActivityNode,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { isWidgetName, type ResolvedItem, type ResolvedNode } from "@fresnel/client/views/native";
import { assertNever, Bug } from "@fresnel/contracts";
import type { UiScalar } from "@fresnel/contracts/extensions";
import {
  Children,
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// 선언형 화면 트리(ADR-0021 §3.4.1)를 caustic 부품으로 그린다. 순수 렌더러이고 앱 밖의 일을 하지 않는다.
// 규칙:
// - 노드의 props는 위젯 카탈로그가 허용한 키만 읽는다. props를 일반 속성으로 펼치지 않고, className, style, href, src, HTML은 어디에도 쓰지 않는다.
// - 스타일 값은 카탈로그의 enum(tone, size, gap, align, variant)을 caustic 토큰이나 Tailwind 유틸리티로 바꾼 것뿐이다.
// - Markdown은 HTML을 만들지 않는다. 빈 줄로 나눈 문단을 글자 그대로 쓴다. HTML을 넣는 React 속성은 어디에도 쓰지 않는다.
// - 입력은 노드마다 로컬 상태를 가진다. Form은 자기 아래 name이 있는 입력의 값을 모아 제출 때 명령으로 보낸다.
// - 노드 하나가 그리다 던지면 그 노드 자리에 실패 문구를 보이고 형제는 그대로 그린다.

// ---------- 외부에 내보내는 타입 ----------

export type NativeLink =
  | { readonly kind: "thread"; readonly id: string }
  | { readonly kind: "turn"; readonly thread: string; readonly turn: string }
  | { readonly kind: "view"; readonly view: string }
  | { readonly kind: "approval"; readonly id: string };

export interface NativeTreeActions {
  /** Button.command / Form.command: a slash command name WITHOUT the slash, plus form values (empty for Button) */
  readonly runCommand: (
    name: string,
    values: Readonly<Record<string, string | number | boolean>>,
  ) => void;
  readonly openLink: (link: NativeLink) => void;
}

export interface NativeTreeProps {
  readonly root: ResolvedNode | undefined;
  readonly actions: NativeTreeActions;
  /** 노드 하나가 그리다 던지면 부른다. 그 자리에는 실패 문구가 남는다 */
  readonly onRenderError?: () => void;
}

// ---------- 카탈로그 enum (catalog.ts의 PropSpec과 같은 값) ----------

const TONES = ["default", "muted", "success", "warning", "danger"] as const;
const GAPS = ["none", "sm", "md", "lg"] as const;
const ALIGNS = ["start", "center", "end"] as const;
const SIZES = ["sm", "md", "lg"] as const;
const VARIANTS = ["primary", "secondary", "ghost"] as const;
const STEP_STATUSES = ["done", "active", "failed", "pending", "skipped"] as const;

type WidgetTone = (typeof TONES)[number];
type Gap = (typeof GAPS)[number];
type WidgetSize = (typeof SIZES)[number];
/** caustic 부품이 받는 색 계열 가운데 카탈로그가 쓰는 것 */
type CausticTone = "neutral" | "success" | "warning" | "danger";
type HeadingLevel = 2 | 3 | 4 | 5 | 6;
type FormValue = string | number | boolean;
/** 목록 원소 가운데 객체(평평한 스칼라 레코드) */
type ItemRecord = Exclude<ResolvedItem, UiScalar>;

/** 간격 enum은 시안의 간격 단계에 맞춘다. 값을 안 주면 자리마다 기본 간격을 쓴다(Stack gap-5, Row gap-x-3 gap-y-1, Split gap-6) */
const GAP_CLASS: Readonly<Record<Gap, string>> = {
  none: "gap-0",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};
const ALIGN_CLASS: Readonly<Record<(typeof ALIGNS)[number], string>> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};
/** 글 크기 enum은 시안의 글 역할(text-<role>)에 맞춘다. 기본 글은 본문 보조 역할(text-ui-dense)이다 */
const TEXT_SIZE: Readonly<Record<WidgetSize, string>> = {
  sm: "text-ui-xs",
  md: "text-ui-dense",
  lg: "text-ui-strong",
};
const TONE_TEXT: Readonly<Record<WidgetTone, string>> = {
  default: "",
  muted: "text-text-tertiary",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-danger-text",
};
const BUTTON_VARIANT = { primary: "solid", secondary: "outline", ghost: "ghost" } as const;

/** 목록 바인드를 원소마다 읽을 때 쓰는 키 순서. 있는 것을 쓴다 */
const TITLE_KEYS: readonly string[] = ["title", "label", "text", "name"];
const DETAIL_KEYS: readonly string[] = ["description", "detail"];
/** 값만 있는 목록(스칼라 원소)을 표로 그릴 때 쓰는 열 이름 */
const SCALAR_COLUMN = "value";

// ---------- 읽기 도우미: 값은 종류를 확인한 뒤에만 쓴다 ----------

function textProp(node: ResolvedNode, key: string): string | undefined {
  const value = node.props[key];
  return typeof value === "string" ? value : undefined;
}

function numberProp(node: ResolvedNode, key: string): number | undefined {
  const value = node.props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolProp(node: ResolvedNode, key: string): boolean | undefined {
  const value = node.props[key];
  return typeof value === "boolean" ? value : undefined;
}

function choiceProp<T extends string>(
  node: ResolvedNode,
  key: string,
  choices: readonly T[],
): T | undefined {
  return choiceOf(textProp(node, key), choices);
}

function choiceOf<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return choices.find((choice) => choice === value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isItemRecord(item: ResolvedItem): item is ItemRecord {
  return typeof item === "object" && item !== null;
}

/** 레코드에서 첫 글이 있는 키의 값. 없으면 undefined */
function fieldText(item: ItemRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const text = nonEmpty(scalarText(item[key]));
    if (text !== undefined) return text;
  }
  return undefined;
}

function titleOf(item: ResolvedItem): string {
  if (!isItemRecord(item)) return scalarText(item);
  return (
    fieldText(item, TITLE_KEYS) ??
    Object.values(item)
      .map(scalarText)
      .find((text) => text !== "") ??
    ""
  );
}

function detailOf(item: ResolvedItem): string | undefined {
  return isItemRecord(item) ? fieldText(item, DETAIL_KEYS) : undefined;
}

function timeOf(item: ResolvedItem): string | undefined {
  return isItemRecord(item) ? fieldText(item, ["time"]) : undefined;
}

/** 값이 있을 때만 label을 넘긴다(caustic은 undefined를 받지 않는 선택 prop을 쓴다) */
function labelOf(label: string | undefined): { readonly label?: string } {
  return label === undefined ? {} : { label };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
}

function headingLevelOf(level: number | undefined): HeadingLevel {
  if (level === undefined) return 2;
  const whole = Math.trunc(level);
  if (whole <= 2) return 2;
  if (whole === 3) return 3;
  if (whole === 4) return 4;
  if (whole === 5) return 5;
  return 6;
}

function toneOf(tone: WidgetTone | undefined): CausticTone {
  switch (tone) {
    case "success":
    case "warning":
    case "danger":
      return tone;
    case "muted":
    case "default":
    case undefined:
      return "neutral";
    default:
      return assertNever(tone, "toneOf");
  }
}

/** 간격 enum이 없으면 그 자리의 기본 간격(`fallback`)을 쓴다 */
function gapOf(node: ResolvedNode, fallback: string): string {
  const gap = choiceProp(node, "gap", GAPS);
  return gap === undefined ? fallback : GAP_CLASS[gap];
}

function joinClasses(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(" ");
}

function collectionLabel(): string {
  return t("desktop.plugin.collection.label");
}

// ---------- 문맥: 동작 콜백과 렌더 실패 보고 ----------

interface NativeContextValue {
  readonly actions: NativeTreeActions;
  readonly onRenderError: (() => void) | undefined;
}

const NativeContext = createContext<NativeContextValue | null>(null);

function useNative(): NativeContextValue {
  const value = useContext(NativeContext);
  if (value === null) throw new Bug("native tree node rendered outside NativeTree");
  return value;
}

// ---------- 입력 값과 Form 수집 ----------

interface FormRegistry {
  readonly register: (name: string, read: () => FormValue) => () => void;
  readonly collect: () => Record<string, FormValue>;
}

const FormContext = createContext<FormRegistry | null>(null);

function createFormRegistry(): FormRegistry {
  const readers = new Map<string, () => FormValue>();
  return {
    register(name, read) {
      readers.set(name, read);
      return () => {
        if (readers.get(name) === read) readers.delete(name);
      };
    },
    collect() {
      const values: Record<string, FormValue> = {};
      for (const [name, read] of readers) values[name] = read();
      return values;
    },
  };
}

/** 입력 하나의 로컬 값. name이 있고 Form 안이면 제출 때 읽히도록 등록한다 */
function useFormValue<T extends FormValue>(
  name: string | undefined,
  initial: T,
): readonly [T, (next: T) => void] {
  const registry = useContext(FormContext);
  const [value, setValue] = useState<T>(initial);
  const latest = useRef<T>(initial);
  useEffect(() => {
    if (name === undefined || registry === null) return undefined;
    return registry.register(name, () => latest.current);
  }, [name, registry]);
  const update = (next: T): void => {
    latest.current = next;
    setValue(next);
  };
  return [value, update];
}

/** 선택 입력의 선택지. 목록 바인드 options가 있으면 그 값을, 현재 값이 빠졌으면 앞에 붙인다. 빈 글은 선택지가 될 수 없다 */
function optionValues(node: ResolvedNode, current: string): string[] {
  const listed = (node.lists?.["options"] ?? [])
    .map((item) => scalarText(item))
    .filter((text) => text !== "");
  const all = current === "" || listed.includes(current) ? listed : [current, ...listed];
  return [...new Set(all)];
}

// ---------- 그리기 ----------

interface NodeProps {
  readonly node: ResolvedNode;
}

export function NativeTree(props: NativeTreeProps): ReactNode {
  const { root, actions, onRenderError } = props;
  const value = useMemo<NativeContextValue>(
    () => ({ actions, onRenderError }),
    [actions, onRenderError],
  );
  if (root === undefined) return null;
  return (
    <NativeContext.Provider value={value}>
      <NodeView node={root} />
    </NativeContext.Provider>
  );
}

/** 노드 하나를 실패 경계로 감싼다. 이 노드나 그 아래가 던지면 이 자리만 실패 문구가 된다 */
function NodeView({ node }: NodeProps): ReactNode {
  const { onRenderError } = useNative();
  return (
    <ErrorBoundary onError={onRenderError}>
      <NodeBody node={node} />
    </ErrorBoundary>
  );
}

/**
 * 원소를 그려 목록으로 만든다. 원소에 식별자가 없으므로 key는 위치로 React가 붙인다.
 * 위치 숫자를 Children.map에 넘기고 그리기는 콜백 안에서 한다. 만든 뒤에 맞춘 원소는 React가 key 경고를 낸다.
 */
function inOrder<T>(values: readonly T[], render: (value: T) => ReactNode): ReactNode {
  const positions: number[] = values.map((_value, position) => position);
  return Children.map(positions, (position) => {
    const value = values[position];
    return value === undefined ? null : render(value);
  });
}

function NodeList({ nodes }: { readonly nodes: readonly ResolvedNode[] }): ReactNode {
  return inOrder(nodes, (child) => <NodeView node={child} />);
}

/** 셸이 그리는 한 줄 글(상자 없이 시안의 셸 글 단계). 노드 자리에 글자로만 남는다 */
function Placeholder({ message }: { readonly message: string }): ReactNode {
  return <p className="m-0 text-ui-dense text-text-tertiary">{message}</p>;
}

interface BoundaryProps {
  readonly onError: (() => void) | undefined;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
}

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError?.();
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <Placeholder message={t("desktop.plugin.placeholder.renderFailed")} />;
    }
    return this.props.children;
  }
}

function NodeBody({ node }: NodeProps): ReactNode {
  if (node.placeholder === "too_long") {
    return <Placeholder message={t("desktop.plugin.placeholder.tooLong")} />;
  }
  const type = node.type;
  if (node.placeholder === "unknown_widget" || !isWidgetName(type)) {
    // 긴 이름은 자른다. 이름은 확장이 정한 글이므로 자리에는 글자로만 들어간다
    return (
      <Placeholder
        message={t("desktop.plugin.placeholder.unknownWidget", { type: type.slice(0, 48) })}
      />
    );
  }
  switch (type) {
    case "Stack":
      return <StackNode node={node} />;
    case "Row":
      return <RowNode node={node} />;
    case "Section":
      return <SectionNode node={node} />;
    case "Tabs":
      return <TabsNode node={node} />;
    case "Split":
      return <SplitNode node={node} />;
    case "Text":
      return <TextNode node={node} />;
    case "Heading":
      return <HeadingNode node={node} />;
    case "Markdown":
      return <MarkdownNode node={node} />;
    case "Code":
      return <CodeNode node={node} />;
    case "List":
      return <ListNode node={node} />;
    case "Table":
      return <TableNode node={node} />;
    case "ListDescription":
      return <ListDescriptionNode node={node} />;
    case "Badge":
      return <BadgeNode node={node} />;
    case "Chip":
      return <ChipNode node={node} />;
    case "Progress":
      return <ProgressNode node={node} />;
    case "Meter":
      return <MeterNode node={node} />;
    case "Stepper":
      return <StepperNode node={node} />;
    case "ActivityTree":
      return <ActivityTreeNode node={node} />;
    case "Timeline":
      return <TimelineNode node={node} />;
    case "Sparkline":
      return <SparklineNode node={node} />;
    case "Alert":
      return <AlertNode node={node} />;
    case "EmptyState":
      return <EmptyStateNode node={node} />;
    case "Skeleton":
      return <SkeletonNode node={node} />;
    case "Button":
      return <ButtonNode node={node} />;
    case "Switch":
      return <SwitchNode node={node} />;
    case "Select":
      return <SelectNode node={node} />;
    case "TextField":
      return <TextFieldNode node={node} />;
    case "NumberField":
      return <NumberFieldNode node={node} />;
    case "SegmentedControl":
      return <SegmentedControlNode node={node} />;
    case "Form":
      return <FormNode node={node} />;
    case "ThreadLink":
      return <ThreadLinkNode node={node} />;
    case "TurnLink":
      return <TurnLinkNode node={node} />;
    case "ViewLink":
      return <ViewLinkNode node={node} />;
    case "ApprovalLink":
      return <ApprovalLinkNode node={node} />;
    default:
      return assertNever(type, "NodeBody");
  }
}

// ---------- 배치 ----------

function StackNode({ node }: NodeProps): ReactNode {
  return (
    <div className={joinClasses("flex min-w-0 flex-col", gapOf(node, "gap-5"))}>
      <NodeList nodes={node.children} />
    </div>
  );
}

function RowNode({ node }: NodeProps): ReactNode {
  const align = choiceProp(node, "align", ALIGNS) ?? "center";
  return (
    <div
      className={joinClasses(
        "flex min-w-0 flex-wrap",
        ALIGN_CLASS[align],
        gapOf(node, "gap-x-3 gap-y-1"),
      )}
    >
      <NodeList nodes={node.children} />
    </div>
  );
}

function SplitNode({ node }: NodeProps): ReactNode {
  return (
    <div
      className={joinClasses(
        "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]",
        gapOf(node, "gap-6"),
      )}
    >
      <NodeList nodes={node.children} />
    </div>
  );
}

function SectionNode({ node }: NodeProps): ReactNode {
  const title = nonEmpty(textProp(node, "title"));
  return (
    <section className="grid min-w-0 gap-1.5">
      {title === undefined ? null : <SectionHeader title={title} headingLevel={2} />}
      <NodeList nodes={node.children} />
    </section>
  );
}

/** 탭 하나의 머리는 Section의 title이다. Section이 아닌 자식은 번호를 머리로 쓴다 */
function TabsNode({ node }: NodeProps): ReactNode {
  const tabs = node.children.map((child, index) => ({
    id: String(index),
    label: child.type === "Section" ? (textProp(child, "title") ?? "") : String(index + 1),
    content: child.type === "Section" ? child.children : [child],
  }));
  const selected = textProp(node, "selected");
  const initial = tabs.find((tab) => tab.label === selected)?.id ?? tabs[0]?.id ?? "";
  return (
    <Tabs defaultValue={initial}>
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="grid min-w-0 gap-2 pt-3">
          <NodeList nodes={tab.content} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ---------- 글 ----------

function TextNode({ node }: NodeProps): ReactNode {
  const size = choiceProp(node, "size", SIZES) ?? "md";
  const tone = choiceProp(node, "tone", TONES) ?? "default";
  return (
    <p className={joinClasses("m-0 whitespace-pre-wrap", TEXT_SIZE[size], TONE_TEXT[tone])}>
      {textProp(node, "text") ?? ""}
    </p>
  );
}

function HeadingNode({ node }: NodeProps): ReactNode {
  return (
    <SectionHeader
      title={textProp(node, "text") ?? ""}
      headingLevel={headingLevelOf(numberProp(node, "level"))}
    />
  );
}

/** HTML을 만들지 않는다. 빈 줄로 나눈 문단을 글자 그대로 쓴다 */
function MarkdownNode({ node }: NodeProps): ReactNode {
  const paragraphs = (textProp(node, "text") ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  return (
    <div className="grid min-w-0 gap-2 text-ui-dense text-text-primary">
      {inOrder(paragraphs, (paragraph) => (
        <p className="m-0 whitespace-pre-wrap">{paragraph}</p>
      ))}
    </div>
  );
}

function CodeNode({ node }: NodeProps): ReactNode {
  const language = nonEmpty(textProp(node, "language"));
  return (
    <div className="grid min-w-0 gap-1">
      {language === undefined ? null : (
        <span className="text-ui-xs text-text-tertiary">{language}</span>
      )}
      <pre className="m-0 overflow-x-auto rounded-lg bg-neutral-track px-3 py-2 font-mono text-mono-sm text-text-primary">
        <code>{textProp(node, "text") ?? ""}</code>
      </pre>
    </div>
  );
}

// ---------- 자료 ----------

function ListNode({ node }: NodeProps): ReactNode {
  const items = node.lists?.["items"];
  return (
    <div className="grid min-w-0 gap-2">
      {items === undefined ? null : (
        <List aria-label={collectionLabel()}>
          {inOrder(items, (item) => (
            <ListRow title={titleOf(item)} description={detailOf(item)} />
          ))}
        </List>
      )}
      <NodeList nodes={node.children} />
    </div>
  );
}

/** 열은 레코드 키를 처음 나온 순서대로 모은다. 스칼라 원소가 있으면 값 열을 더한다 */
function tableOf(items: readonly ResolvedItem[]): {
  readonly columns: TableColumn[];
  readonly rows: TableRow[];
} {
  const keys: string[] = [];
  let scalars = false;
  for (const item of items) {
    if (!isItemRecord(item)) {
      scalars = true;
      continue;
    }
    for (const key of Object.keys(item)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  if (scalars && !keys.includes(SCALAR_COLUMN)) keys.push(SCALAR_COLUMN);
  const columns: TableColumn[] = keys.map((key) => ({
    key,
    header: key === SCALAR_COLUMN && scalars ? "" : key,
  }));
  const rows: TableRow[] = items.map((item, index) => {
    const id = String(index);
    return isItemRecord(item) ? { ...item, id } : { id, [SCALAR_COLUMN]: item };
  });
  return { columns, rows };
}

function TableNode({ node }: NodeProps): ReactNode {
  const items = node.lists?.["rows"];
  if (items === undefined) {
    return (
      <div className="grid min-w-0 gap-2">
        <NodeList nodes={node.children} />
      </div>
    );
  }
  const { columns, rows } = tableOf(items);
  return (
    <div className="grid min-w-0 gap-2">
      <Table
        aria-label={collectionLabel()}
        columns={columns}
        rows={rows}
        renderCell={(row, column) => scalarText(row[column.key])}
      />
      <NodeList nodes={node.children} />
    </div>
  );
}

/** 레코드 원소의 키마다 한 줄이다. 스칼라 원소는 이름 없는 한 줄이다 */
function termsOf(
  items: readonly ResolvedItem[],
): readonly { readonly term: string; readonly text: string }[] {
  return items.flatMap((item) =>
    isItemRecord(item)
      ? Object.entries(item).map(([term, value]) => ({ term, text: scalarText(value) }))
      : [{ term: "", text: scalarText(item) }],
  );
}

/** 요약 줄은 시안의 well 요약과 같다: 면 없는 ghost, xs, 줄 안쪽 여백 없음 */
const LIST_DESCRIPTION_CLASS = "rounded-none [&_[data-slot=list-description-row]]:px-0";

function ListDescriptionNode({ node }: NodeProps): ReactNode {
  const items = node.lists?.["items"];
  return (
    <div className="grid min-w-0 gap-2">
      {items === undefined ? null : (
        <ListDescription
          aria-label={collectionLabel()}
          variant="ghost"
          size="xs"
          className={LIST_DESCRIPTION_CLASS}
        >
          {inOrder(termsOf(items), (row) => (
            <ListDescriptionRow term={row.term}>{row.text}</ListDescriptionRow>
          ))}
        </ListDescription>
      )}
      <NodeList nodes={node.children} />
    </div>
  );
}

// caustic Badge는 tone이 폐기 표시라 쓰지 않는다(lint no-deprecated). 같은 크기의 soft Chip으로 그린다
function BadgeNode({ node }: NodeProps): ReactNode {
  const tone = choiceProp(node, "tone", TONES);
  return (
    <Chip tone={toneOf(tone)} variant="soft" size="sm">
      {textProp(node, "text") ?? ""}
    </Chip>
  );
}

function ChipNode({ node }: NodeProps): ReactNode {
  const tone = choiceProp(node, "tone", TONES);
  return (
    <Chip tone={toneOf(tone)} variant="outline" size="sm">
      {textProp(node, "text") ?? ""}
    </Chip>
  );
}

/** 값이 없으면 진행률을 모르는 것이므로 indeterminate다. max는 양수일 때만 쓴다 */
function ProgressNode({ node }: NodeProps): ReactNode {
  const value = numberProp(node, "value");
  const max = positiveOr(numberProp(node, "max"), 100);
  const percent = value === undefined ? undefined : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <Progress
      value={percent}
      indeterminate={percent === undefined}
      {...labelOf(nonEmpty(textProp(node, "label")))}
    />
  );
}

function MeterNode({ node }: NodeProps): ReactNode {
  return (
    <Meter
      value={numberProp(node, "value") ?? 0}
      max={positiveOr(numberProp(node, "max"), 100)}
      {...labelOf(nonEmpty(textProp(node, "label")))}
    />
  );
}

/** Text 자식이 단계다. current는 단계 id이고, 그 앞 단계는 끝난 것으로 본다 */
function StepperNode({ node }: NodeProps): ReactNode {
  const current = textProp(node, "current");
  const steps = node.children
    .filter((child) => child.type === "Text")
    .map((child, index) => {
      const id = textProp(child, "step") ?? String(index);
      return { id, label: textProp(child, "text") ?? id };
    });
  const value = steps.findIndex((step) => step.id === current) + 1;
  return <Stepper steps={steps} value={value} variant="ghost" />;
}

function activityOf(item: ResolvedItem, index: number): ActivityNode {
  const id = String(index);
  if (!isItemRecord(item)) {
    return { id, kind: "step", label: scalarText(item), status: "pending" };
  }
  const label = titleOf(item);
  const meta = fieldText(item, ["meta"]);
  if (item.kind === "call") {
    return {
      id,
      kind: "call",
      label,
      meta,
      failed: item.failed === true,
      running: item.running === true,
    };
  }
  return {
    id,
    kind: "step",
    label,
    meta,
    status: choiceOf(scalarText(item.status), STEP_STATUSES) ?? "pending",
  };
}

function ActivityTreeNode({ node }: NodeProps): ReactNode {
  const items = node.lists?.["items"];
  return (
    <div className="grid min-w-0 gap-2">
      {items === undefined ? null : (
        <ActivityTree
          nodes={items.map(activityOf)}
          aria-label={collectionLabel()}
          failedLabel={t("desktop.plugin.activity.failed")}
          pendingLabel={t("desktop.plugin.activity.pending")}
          skippedLabel={t("desktop.plugin.activity.skipped")}
        />
      )}
      <NodeList nodes={node.children} />
    </div>
  );
}

function TimelineNode({ node }: NodeProps): ReactNode {
  const items = node.lists?.["items"];
  return (
    <div className="grid min-w-0 gap-2">
      {items === undefined ? null : (
        <Timeline aria-label={collectionLabel()}>
          {inOrder(items, (item) => (
            <TimelineItem title={titleOf(item)} detail={detailOf(item)} time={timeOf(item)} />
          ))}
        </Timeline>
      )}
      <NodeList nodes={node.children} />
    </div>
  );
}

/** caustic에 없는 부품이라 SVG 선 하나로 그린다. 색은 currentColor다 */
function SparklineNode({ node }: NodeProps): ReactNode {
  const label = nonEmpty(textProp(node, "label"));
  const values: number[] = [];
  for (const item of node.lists?.["points"] ?? []) {
    const value: unknown = isItemRecord(item) ? item["value"] : item;
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      fill="none"
      className="h-6 w-24 overflow-visible text-accent-text"
    >
      {values.length === 0 ? null : (
        <polyline
          points={sparkPoints(values)}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function sparkPoints(values: readonly number[]): string {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = (index * step).toFixed(2);
      const y = (23 - ((value - min) / span) * 22).toFixed(2);
      return `${x},${y}`;
    })
    .join(" ");
}

// ---------- 알림 ----------

function AlertNode({ node }: NodeProps): ReactNode {
  const title = nonEmpty(textProp(node, "title"));
  const text = textProp(node, "text") ?? "";
  const tone = choiceProp(node, "tone", TONES);
  return (
    <Alert
      tone={toneOf(tone)}
      size="sm"
      layout="inline"
      emphasis={title === undefined ? undefined : "lead"}
    >
      {title === undefined ? (
        text
      ) : (
        <>
          <b>{title}</b> {text}
        </>
      )}
    </Alert>
  );
}

/** 제목이 없으면 글을 제목 자리에 둔다(목록이 비었다는 한 줄 안내) */
function EmptyStateNode({ node }: NodeProps): ReactNode {
  const title = nonEmpty(textProp(node, "title"));
  const text = nonEmpty(textProp(node, "text"));
  return (
    <EmptyState
      size="sm"
      surface="none"
      title={title ?? text ?? ""}
      description={title === undefined ? undefined : text}
    />
  );
}

function SkeletonNode({ node }: NodeProps): ReactNode {
  const count = Math.min(8, Math.max(1, Math.floor(numberProp(node, "lines") ?? 3)));
  return (
    <div aria-busy="true" className="grid min-w-0 gap-2">
      {Array.from({ length: count }, (_unused, index) => (
        <Skeleton key={index} height={10} width={index === count - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

// ---------- 입력과 명령 ----------

function ButtonNode({ node }: NodeProps): ReactNode {
  const { actions } = useNative();
  const command = nonEmpty(textProp(node, "command"));
  // 색 계열은 variant로만 고른다. caustic Button의 tone은 폐기 표시라 쓰지 않는다(lint no-deprecated)
  const variant = choiceProp(node, "variant", VARIANTS) ?? "primary";
  return (
    <Button
      size="xs"
      variant={BUTTON_VARIANT[variant]}
      disabled={command === undefined}
      onClick={() => {
        if (command !== undefined) actions.runCommand(command, {});
      }}
    >
      {textProp(node, "label") ?? ""}
    </Button>
  );
}

function SwitchNode({ node }: NodeProps): ReactNode {
  const label = nonEmpty(textProp(node, "label"));
  const [checked, setChecked] = useFormValue(
    nonEmpty(textProp(node, "name")),
    boolProp(node, "checked") ?? false,
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Switch aria-label={label} checked={checked} onCheckedChange={setChecked} />
      {label === undefined ? null : <span className="text-ui text-text-primary">{label}</span>}
    </div>
  );
}

function SelectNode({ node }: NodeProps): ReactNode {
  const label = nonEmpty(textProp(node, "label"));
  const [value, setValue] = useFormValue(
    nonEmpty(textProp(node, "name")),
    textProp(node, "value") ?? "",
  );
  return (
    <Field label={label}>
      <Select aria-label={label} value={value} onValueChange={setValue}>
        {optionValues(node, value).map((option) => (
          <SelectOption key={option} value={option}>
            {option}
          </SelectOption>
        ))}
      </Select>
    </Field>
  );
}

function TextFieldNode({ node }: NodeProps): ReactNode {
  const [value, setValue] = useFormValue(
    nonEmpty(textProp(node, "name")),
    textProp(node, "value") ?? "",
  );
  return (
    <Field label={nonEmpty(textProp(node, "label"))}>
      <Input value={value} placeholder={textProp(node, "placeholder")} onValueChange={setValue} />
    </Field>
  );
}

function NumberFieldNode({ node }: NodeProps): ReactNode {
  const [value, setValue] = useFormValue(
    nonEmpty(textProp(node, "name")),
    numberProp(node, "value") ?? 0,
  );
  return (
    <Field label={nonEmpty(textProp(node, "label"))}>
      <NumberField
        appearance="stepper"
        value={value}
        onValueChange={setValue}
        min={numberProp(node, "min")}
        max={numberProp(node, "max")}
        step={numberProp(node, "step")}
      />
    </Field>
  );
}

function SegmentedControlNode({ node }: NodeProps): ReactNode {
  const label = nonEmpty(textProp(node, "label"));
  const [value, setValue] = useFormValue(
    nonEmpty(textProp(node, "name")),
    textProp(node, "value") ?? "",
  );
  return (
    <Field label={label}>
      <SegmentedControl size="sm" aria-label={label} value={value} onValueChange={setValue}>
        {optionValues(node, value).map((option) => (
          <SegmentedControlItem key={option} value={option}>
            {option}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </Field>
  );
}

/** Form은 아래 입력의 값을 모아 제출 때 명령 하나로 보낸다. command가 없으면 제출은 막혀 있다 */
function FormNode({ node }: NodeProps): ReactNode {
  const { actions } = useNative();
  const [registry] = useState(createFormRegistry);
  const command = nonEmpty(textProp(node, "command"));
  const title = nonEmpty(textProp(node, "title"));
  const submitLabel = nonEmpty(textProp(node, "submitLabel")) ?? t("desktop.plugin.form.submit");
  return (
    <FormContext.Provider value={registry}>
      <FormLayout
        title={title}
        onSubmit={(event) => {
          event.preventDefault();
          if (command !== undefined) actions.runCommand(command, registry.collect());
        }}
      >
        <NodeList nodes={node.children} />
        <div className="flex justify-end">
          <Button type="submit" size="xs" variant="solid" disabled={command === undefined}>
            {submitLabel}
          </Button>
        </div>
      </FormLayout>
    </FormContext.Provider>
  );
}

// ---------- 연결 ----------

function LinkButton({
  text,
  link,
}: {
  readonly text: string;
  readonly link: NativeLink | undefined;
}): ReactNode {
  const { actions } = useNative();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={link === undefined}
      onClick={() => {
        if (link !== undefined) actions.openLink(link);
      }}
    >
      {text}
    </Button>
  );
}

function ThreadLinkNode({ node }: NodeProps): ReactNode {
  const id = nonEmpty(textProp(node, "thread"));
  const link: NativeLink | undefined = id === undefined ? undefined : { kind: "thread", id };
  return <LinkButton text={textProp(node, "text") ?? ""} link={link} />;
}

function TurnLinkNode({ node }: NodeProps): ReactNode {
  const thread = nonEmpty(textProp(node, "thread"));
  const turn = nonEmpty(textProp(node, "turn"));
  const link: NativeLink | undefined =
    thread === undefined || turn === undefined ? undefined : { kind: "turn", thread, turn };
  return <LinkButton text={textProp(node, "text") ?? ""} link={link} />;
}

function ViewLinkNode({ node }: NodeProps): ReactNode {
  const view = nonEmpty(textProp(node, "view"));
  const link: NativeLink | undefined = view === undefined ? undefined : { kind: "view", view };
  return <LinkButton text={textProp(node, "text") ?? ""} link={link} />;
}

function ApprovalLinkNode({ node }: NodeProps): ReactNode {
  const id = nonEmpty(textProp(node, "approval"));
  const link: NativeLink | undefined = id === undefined ? undefined : { kind: "approval", id };
  return <LinkButton text={textProp(node, "text") ?? ""} link={link} />;
}
