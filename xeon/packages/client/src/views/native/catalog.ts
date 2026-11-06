import { assertNever } from "@fresnel/contracts";
import type { UiScalar } from "@fresnel/contracts/extensions";

// 위젯 카탈로그 v1. 이름, prop, bind, 자식 허용을 정한다. 색, 크기 숫자, CSS, HTML, 핸들러는 어디에도 없다(DP-08).

/** 위젯 카탈로그 버전(SemVer). 확장의 `widgets` 범위가 이 값과 맞아야 한다 */
export const WIDGET_CATALOG_VERSION: string = "1.0.0";

export const WIDGET_NAMES = [
  "Stack",
  "Row",
  "Section",
  "Tabs",
  "Split",
  "Text",
  "Heading",
  "Markdown",
  "Code",
  "List",
  "Table",
  "ListDescription",
  "Badge",
  "Chip",
  "Progress",
  "Meter",
  "Stepper",
  "ActivityTree",
  "Timeline",
  "Sparkline",
  "Alert",
  "EmptyState",
  "Skeleton",
  "Button",
  "Switch",
  "Select",
  "TextField",
  "NumberField",
  "SegmentedControl",
  "Form",
  "ThreadLink",
  "TurnLink",
  "ViewLink",
  "ApprovalLink",
] as const;

export type WidgetName = (typeof WIDGET_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set<string>(WIDGET_NAMES);

export function isWidgetName(name: string): name is WidgetName {
  return NAME_SET.has(name);
}

/** prop 하나가 받는 값의 종류. enum은 허용 목록 밖의 글자를 받지 않는다 */
export type PropSpec =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum"; readonly values: readonly string[] };

export interface WidgetSpec {
  /** 정적으로 쓸 수 있는 prop. bind 대상이기도 하다 */
  readonly props: Readonly<Record<string, PropSpec>>;
  /** bind만 받는 키(데이터 경로로만 채운다). 종류 검사는 없고 스칼라인지만 본다 */
  readonly binds: readonly string[];
  /** 자식 노드를 받는지. "none"이면 자식이 있을 때 issue다 */
  readonly children: "none" | "any";
}

const STRING: PropSpec = { kind: "string" };
const NUMBER: PropSpec = { kind: "number" };
const GAP: PropSpec = { kind: "enum", values: ["none", "sm", "md", "lg"] };
const ALIGN: PropSpec = { kind: "enum", values: ["start", "center", "end"] };
const TONE: PropSpec = {
  kind: "enum",
  values: ["default", "muted", "success", "warning", "danger"],
};
const SIZE: PropSpec = { kind: "enum", values: ["sm", "md", "lg"] };
const VARIANT: PropSpec = { kind: "enum", values: ["primary", "secondary", "ghost"] };

export const WIDGET_SPECS: Readonly<Record<WidgetName, WidgetSpec>> = {
  Stack: { props: { gap: GAP }, binds: [], children: "any" },
  Row: { props: { gap: GAP, align: ALIGN }, binds: [], children: "any" },
  Section: { props: { title: STRING }, binds: [], children: "any" },
  Tabs: { props: {}, binds: ["selected"], children: "any" },
  Split: { props: { gap: GAP }, binds: [], children: "any" },
  Text: {
    props: { text: STRING, tone: TONE, size: SIZE, step: STRING },
    binds: [],
    children: "none",
  },
  Heading: { props: { text: STRING, level: NUMBER }, binds: [], children: "none" },
  Markdown: { props: { text: STRING }, binds: [], children: "none" },
  Code: { props: { text: STRING, language: STRING }, binds: [], children: "none" },
  List: { props: {}, binds: ["items"], children: "any" },
  Table: { props: {}, binds: ["rows"], children: "any" },
  ListDescription: { props: {}, binds: ["items"], children: "any" },
  Badge: { props: { text: STRING, tone: TONE }, binds: [], children: "none" },
  Chip: { props: { text: STRING, tone: TONE }, binds: [], children: "none" },
  Progress: {
    props: { label: STRING, max: NUMBER, value: NUMBER },
    binds: ["value"],
    children: "none",
  },
  Meter: {
    props: { label: STRING, max: NUMBER, value: NUMBER },
    binds: ["value"],
    children: "none",
  },
  Stepper: { props: {}, binds: ["current"], children: "any" },
  ActivityTree: { props: {}, binds: ["items"], children: "any" },
  Timeline: { props: {}, binds: ["items"], children: "any" },
  Sparkline: { props: { label: STRING }, binds: ["points"], children: "none" },
  Alert: { props: { title: STRING, text: STRING, tone: TONE }, binds: [], children: "none" },
  EmptyState: { props: { title: STRING, text: STRING }, binds: [], children: "none" },
  Skeleton: { props: { lines: NUMBER }, binds: [], children: "none" },
  Button: {
    props: { label: STRING, command: STRING, variant: VARIANT, tone: TONE },
    binds: [],
    children: "none",
  },
  Switch: { props: { label: STRING, name: STRING }, binds: ["checked"], children: "none" },
  Select: { props: { label: STRING, name: STRING }, binds: ["value", "options"], children: "none" },
  TextField: {
    props: { label: STRING, name: STRING, placeholder: STRING, maxLength: NUMBER },
    binds: ["value"],
    children: "none",
  },
  NumberField: {
    props: { label: STRING, name: STRING, min: NUMBER, max: NUMBER, step: NUMBER },
    binds: ["value"],
    children: "none",
  },
  SegmentedControl: {
    props: { label: STRING, name: STRING },
    binds: ["value", "options"],
    children: "none",
  },
  Form: {
    props: { title: STRING, command: STRING, submitLabel: STRING },
    binds: [],
    children: "any",
  },
  ThreadLink: { props: { text: STRING }, binds: ["thread"], children: "none" },
  TurnLink: { props: { text: STRING }, binds: ["thread", "turn"], children: "none" },
  ViewLink: { props: { text: STRING, view: STRING }, binds: [], children: "none" },
  ApprovalLink: { props: { text: STRING }, binds: ["approval"], children: "none" },
};

/** 어떤 위젯에도 쓸 수 없는 prop 이름. 스타일, 마크업, 핸들러다. 비교는 대소문자를 무시한다 */
export const FORBIDDEN_PROP_NAMES = [
  "style",
  "className",
  "class",
  "color",
  "background",
  "backgroundColor",
  "fill",
  "stroke",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "padding",
  "fontSize",
  "fontFamily",
  "css",
  "html",
  "innerHTML",
  "outerHTML",
  "dangerouslySetInnerHTML",
  "href",
  "src",
  "srcDoc",
  "script",
  "onClick",
  "onLoad",
  "onError",
  "onInput",
  "onChange",
  "onSubmit",
] as const;

const FORBIDDEN_LOWER: ReadonlySet<string> = new Set(
  FORBIDDEN_PROP_NAMES.map((name) => name.toLowerCase()),
);

export function isForbiddenPropName(name: string): boolean {
  return FORBIDDEN_LOWER.has(name.toLowerCase());
}

/** 위젯의 prop 종류. 없으면 undefined다(bind 전용 키 포함) */
export function propSpecOf(widget: WidgetSpec, key: string): PropSpec | undefined {
  return Object.hasOwn(widget.props, key) ? widget.props[key] : undefined;
}

/** bind 키가 위젯에 허용되는지. prop 이름이거나 binds 목록에 있어야 한다 */
export function bindAllowed(widget: WidgetSpec, key: string): boolean {
  return widget.binds.includes(key) || propSpecOf(widget, key) !== undefined;
}

/** 스칼라 값이 prop 종류에 맞는지. 맞으면 undefined, 아니면 사람이 읽을 이유 한 줄이다(값은 넣지 않는다) */
export function scalarMismatch(prop: PropSpec, value: UiScalar): string | undefined {
  switch (prop.kind) {
    case "string":
      return typeof value === "string" ? undefined : "must be a string";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "must be a number";
    case "boolean":
      return typeof value === "boolean" ? undefined : "must be a boolean";
    case "enum":
      return typeof value === "string" && prop.values.includes(value)
        ? undefined
        : `must be one of ${prop.values.join(", ")}`;
    default:
      return assertNever(prop, "scalarMismatch");
  }
}
