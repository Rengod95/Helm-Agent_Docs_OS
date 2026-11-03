import { expect, test } from "bun:test";
import { extMessageOf } from "../../../src/views/native/messages.ts";
import { resolveTree } from "../../../src/views/native/resolve.ts";

const MESSAGES = {
  en: { "helm.status": "Status", "helm.onlyEnglish": "Only in English" },
  ko: { "helm.status": "상태" },
};

test("an extension message resolves in the current locale, then English, then the text itself", () => {
  expect(extMessageOf(MESSAGES, "ko", "helm.status")).toBe("상태");
  expect(extMessageOf(MESSAGES, "ko-KR", "helm.status")).toBe("상태");
  expect(extMessageOf(MESSAGES, "ko", "helm.onlyEnglish")).toBe("Only in English");
  expect(extMessageOf(MESSAGES, "en", "helm.status")).toBe("Status");
  expect(extMessageOf(MESSAGES, "ko", "helm.missing")).toBe("helm.missing");
  expect(extMessageOf(MESSAGES, "ko", "Plain title")).toBe("Plain title");
  expect(extMessageOf(undefined, "ko", "helm.status")).toBe("helm.status");
});

test("a catalog lookup ignores prototype keys", () => {
  expect(extMessageOf(MESSAGES, "ko", "constructor")).toBe("constructor");
  expect(extMessageOf(MESSAGES, "__proto__", "toString")).toBe("toString");
});

test("resolveTree resolves static text props through the extension catalog and leaves bound values alone", () => {
  const tree = {
    type: "Stack",
    children: [
      { type: "Text", props: { text: "helm.status" } },
      { type: "Text", props: { text: "helm.onlyEnglish" } },
      { type: "Text", props: { text: "helm.missing" } },
      { type: "Text", bind: { text: { path: "/name" } } },
    ],
  } as const;
  const resolved = resolveTree(tree, {
    doc: { name: "helm.status" },
    locale: "ko",
    nowMs: 0,
    messages: MESSAGES,
  });
  const texts = (resolved.root?.children ?? []).map((child) => child.props["text"]);
  expect(texts).toEqual(["상태", "Only in English", "helm.missing", "helm.status"]);
  const plain = resolveTree(tree, { doc: { name: "x" }, locale: "ko", nowMs: 0 });
  expect((plain.root?.children ?? []).map((child) => child.props["text"])).toEqual([
    "helm.status",
    "helm.onlyEnglish",
    "helm.missing",
    "x",
  ]);
});
