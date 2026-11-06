import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ResolvedNode } from "@fresnel/client/views/native";
import { renderToString } from "react-dom/server";
import {
  NativeTree,
  type NativeLink,
  type NativeTreeActions,
} from "../../../src/views/plugin/native-tree.tsx";

// 선언형 트리 렌더러의 값 검사. 이벤트가 없는 서버 렌더만 쓴다(DOM 라이브러리가 없다).
// 명령과 링크가 실제로 불리는지는 여기서 보지 못한다. 그 경로는 콜백 타입이 막는다.

// 그리기만 하는 시험이므로 명령과 링크는 하나도 불리지 않아야 한다
const commands: string[] = [];
const opened: NativeLink[] = [];
const actions: NativeTreeActions = {
  runCommand: (name) => {
    commands.push(name);
  },
  openLink: (link) => {
    opened.push(link);
  },
};

function node(
  type: string,
  props: ResolvedNode["props"] = {},
  children: readonly ResolvedNode[] = [],
  extra: Partial<Pick<ResolvedNode, "placeholder" | "lists">> = {},
): ResolvedNode {
  return { type, props, children, ...extra };
}

function html(root: ResolvedNode): string {
  return renderToString(<NativeTree root={root} actions={actions} />);
}

describe("NativeTree text and placeholders", () => {
  test("a Text node shows its bound text exactly", () => {
    const out = html(node("Text", { text: "Build 42 passed" }));
    expect(out).toContain(">Build 42 passed</p>");
  });

  test("an unknown widget shows the placeholder with its type name", () => {
    const out = html(node("Sparkly3D", {}, [], { placeholder: "unknown_widget" }));
    expect(out).toContain(t("desktop.plugin.placeholder.unknownWidget", { type: "Sparkly3D" }));
  });

  test("a type the catalog does not know renders the placeholder even without the flag", () => {
    const out = html(node("Nope", {}));
    expect(out).toContain(t("desktop.plugin.placeholder.unknownWidget", { type: "Nope" }));
  });

  test("a too_long node renders its own placeholder", () => {
    const out = html(node("Stack", {}, [], { placeholder: "too_long" }));
    expect(out).toContain(t("desktop.plugin.placeholder.tooLong"));
  });

  test("an unknown sibling does not stop the widgets next to it", () => {
    const out = html(
      node("Stack", {}, [
        node("Mystery", {}, [], { placeholder: "unknown_widget" }),
        node("Text", { text: "still here" }),
      ]),
    );
    expect(out).toContain(t("desktop.plugin.placeholder.unknownWidget", { type: "Mystery" }));
    expect(out).toContain(">still here</p>");
  });

  test("a widget with its prop missing renders with empty content and no throw", () => {
    const out = html(node("Meter", {}));
    expect(out).toContain('role="meter"');
  });
});

describe("NativeTree text rules", () => {
  test("Markdown is plain text: markup stays escaped and asterisks stay literal", () => {
    const out = html(node("Markdown", { text: "<script>alert(1)</script>\n\n**bold**" }));
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("**bold**");
  });

  test("Heading level is clamped to 2..6", () => {
    expect(html(node("Heading", { text: "Top", level: 1 }))).toContain("<h2");
    expect(html(node("Heading", { text: "Deep", level: 9 }))).toContain("<h6");
    expect(html(node("Heading", { text: "Mid", level: 3 }))).toContain("<h3");
  });

  test("Code is shown in pre and code elements", () => {
    const out = html(node("Code", { text: "const a = 1;", language: "ts" }));
    expect(out).toContain("<pre");
    expect(out).toContain("<code>const a = 1;</code>");
  });

  test("style-like props never become attributes", () => {
    const out = html(
      node("Stack", {
        className: "evil-class",
        style: "color:red",
        href: "javascript:alert(1)",
        gap: "md",
      }),
    );
    expect(out).not.toContain("evil-class");
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("javascript:");
  });
});

describe("NativeTree data widgets", () => {
  test("an Alert shows its title and text", () => {
    const out = html(
      node("Alert", { title: "Heads up", text: "Disk is 91% full", tone: "warning" }),
    );
    expect(out).toContain("Heads up");
    expect(out).toContain("Disk is 91% full");
  });

  test("a Table renders the bound rows under their column names", () => {
    const out = html(
      node("Table", {}, [], {
        lists: { rows: [{ name: "alpha", count: 2 }] },
      }),
    );
    expect(out).toContain(">name<");
    expect(out).toContain(">alpha<");
    expect(out).toContain(">2<");
  });

  test("a List shows one row per bound item", () => {
    const out = html(
      node("List", {}, [], {
        lists: { items: ["first finding", { title: "second finding", description: "detail" }] },
      }),
    );
    expect(out).toContain("first finding");
    expect(out).toContain("second finding");
    expect(out).toContain("detail");
  });

  test("a Sparkline draws a polyline and names it with its label", () => {
    const out = html(
      node("Sparkline", { label: "Trend" }, [], {
        lists: { points: [1, 3, 2] },
      }),
    );
    expect(out).toContain("<polyline");
    expect(out).toContain('aria-label="Trend"');
  });

  test("a Progress without a value is indeterminate, not a made-up percentage", () => {
    const out = html(node("Progress", { label: "Loading work" }));
    expect(out).toContain("Loading work");
    expect(out).not.toContain("aria-valuenow");
  });
});

describe("NativeTree tabs, forms and links", () => {
  test("each Section child becomes a tab labelled by its title", () => {
    const out = html(
      node("Tabs", { selected: "Details" }, [
        node("Section", { title: "Overview" }, [node("Text", { text: "overview body" })]),
        node("Section", { title: "Details" }, [node("Text", { text: "details body" })]),
      ]),
    );
    expect(out).toContain(">Overview<");
    expect(out).toContain(">Details<");
  });

  test("a Form without submitLabel shows the default submit text", () => {
    const out = html(
      node("Form", { command: "helm-start" }, [node("TextField", { name: "topic" })]),
    );
    expect(out).toContain(t("desktop.plugin.form.submit"));
  });

  test("a Form with submitLabel shows that label", () => {
    const out = html(node("Form", { command: "helm-start", submitLabel: "Start inquiry" }));
    expect(out).toContain("Start inquiry");
  });

  test("a Button shows its label", () => {
    const out = html(node("Button", { label: "Start", command: "helm-start" }));
    expect(out).toContain(">Start</button>");
  });

  test("a TextField shows its label and its placeholder", () => {
    const out = html(
      node("Form", { command: "helm start", submitLabel: "탐구 시작" }, [
        node("TextField", { name: "arg", label: "주제", placeholder: "비우면 마지막 질문" }),
      ]),
    );
    expect(out).toContain(">주제<");
    expect(out).toContain('placeholder="비우면 마지막 질문"');
    expect(out).toContain("탐구 시작");
  });

  test("a ThreadLink shows its text", () => {
    const out = html(node("ThreadLink", { text: "Open thread", thread: "t-1" }));
    expect(out).toContain("Open thread");
  });

  test("rendering alone runs no command and opens no link", () => {
    html(
      node("Form", { command: "helm-start" }, [
        node("Button", { label: "Stop", command: "helm-stop" }),
        node("ThreadLink", { text: "Open thread", thread: "t-1" }),
      ]),
    );
    expect(commands).toEqual([]);
    expect(opened).toEqual([]);
  });

  test("an EmptyState with only text shows that text as its title", () => {
    const out = html(node("EmptyState", { text: "Nothing running yet" }));
    expect(out).toContain("Nothing running yet");
  });
});
