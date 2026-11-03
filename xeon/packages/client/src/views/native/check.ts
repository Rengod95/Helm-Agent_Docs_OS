import type { UiBinding, UiNode, UiScalar } from "@fresnel/contracts/extensions";
import {
  bindAllowed,
  isForbiddenPropName,
  isWidgetName,
  propSpecOf,
  scalarMismatch,
  WIDGET_CATALOG_VERSION,
  WIDGET_SPECS,
} from "./catalog.ts";
import { escapePointerSegment } from "./pointer.ts";

// 정적 트리를 위젯 카탈로그와 맞춰 본다. 바인드 값은 실행 때 정해지므로 여기서는 키와 자리만 본다.
// 모르는 위젯은 그 노드만 자리표시가 된다(ADR-0021 §3.7). 자식은 계속 검사한다.
// 메시지에는 prop 값을 넣지 않는다. 값은 길 수 있다.

type TreeIssueCode =
  | "unknown_widget"
  | "prop_not_allowed"
  | "prop_type"
  | "bind_not_allowed"
  | "children_not_allowed"
  | "forbidden_prop"
  | "each_scope";

export interface TreeIssue {
  readonly code: TreeIssueCode;
  /** 트리 안 JSON Pointer. 예 "/children/0/props/gap" */
  readonly path: string;
  readonly message: string;
}

export interface TreeCheck {
  readonly issues: readonly TreeIssue[];
}

export function checkTree(tree: UiNode): TreeCheck {
  const issues: TreeIssue[] = [];
  checkNode(tree, "", [], issues);
  return { issues };
}

function checkNode(
  node: UiNode,
  path: string,
  enclosing: readonly string[],
  issues: TreeIssue[],
): void {
  const each = node.each;
  if (each !== undefined && enclosing.includes(each.as)) {
    issues.push({
      code: "each_scope",
      path: `${path}/each/as`,
      message: `each name "${each.as}" is already used by an enclosing each`,
    });
  }
  // 이 노드의 bind와 when은 자기 each 이름을 볼 수 있다
  const names = each === undefined ? enclosing : [...enclosing, each.as];

  const type = node.type;
  const widget = isWidgetName(type) ? WIDGET_SPECS[type] : undefined;
  if (widget === undefined) {
    issues.push({
      code: "unknown_widget",
      path: `${path}/type`,
      message: `"${type}" is not in widget catalog ${WIDGET_CATALOG_VERSION}`,
    });
  }

  const props: Readonly<Record<string, UiScalar>> = node.props ?? {};
  for (const [key, value] of Object.entries(props)) {
    const at = `${path}/props/${escapePointerSegment(key)}`;
    if (isForbiddenPropName(key)) {
      issues.push(forbiddenIssue(at, key));
      continue;
    }
    if (widget === undefined) continue;
    const prop = propSpecOf(widget, key);
    if (prop === undefined) {
      issues.push({
        code: "prop_not_allowed",
        path: at,
        message: `"${key}" is not a prop of ${type}`,
      });
      continue;
    }
    const reason = scalarMismatch(prop, value);
    if (reason !== undefined) {
      issues.push({ code: "prop_type", path: at, message: `prop "${key}" ${reason}` });
    }
  }

  const binds: Readonly<Record<string, UiBinding>> = node.bind ?? {};
  for (const key of Object.keys(binds)) {
    const at = `${path}/bind/${escapePointerSegment(key)}`;
    if (isForbiddenPropName(key)) {
      issues.push(forbiddenIssue(at, key));
    } else if (widget !== undefined && !bindAllowed(widget, key)) {
      issues.push({
        code: "bind_not_allowed",
        path: at,
        message: `"${key}" is not a bind key of ${type}`,
      });
    }
  }

  const children: readonly UiNode[] = node.children ?? [];
  if (children.length > 0 && widget !== undefined && widget.children === "none") {
    issues.push({
      code: "children_not_allowed",
      path: `${path}/children`,
      message: `${type} takes no children`,
    });
  }
  for (const [index, child] of children.entries()) {
    checkNode(child, `${path}/children/${index}`, names, issues);
  }
}

function forbiddenIssue(path: string, key: string): TreeIssue {
  return {
    code: "forbidden_prop",
    path,
    message: `"${key}" is a forbidden name: styling, markup and handlers are not part of the tree`,
  };
}
