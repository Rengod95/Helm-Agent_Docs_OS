import { expect, test } from "bun:test";
import { parseFrontmatter } from "../src/index.ts";

function parsed(content: string): { frontmatter: unknown; body: string } {
  const result = parseFrontmatter(content);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.kind}`);
  return result.value;
}

test("front matter and body are split, with CRLF and BOM normalized", () => {
  const value = parsed("﻿---\r\nname: explorer\r\ntools: [read]\r\n---\r\n\r\nBody text\r\n");
  expect(value.frontmatter).toEqual({ name: "explorer", tools: ["read"] });
  expect(value.body).toBe("Body text");
});

test("a document without front matter has an empty record and keeps its body", () => {
  expect(parsed("just text")).toEqual({ frontmatter: {}, body: "just text" });
  expect(parsed("---\nname: open-ended")).toEqual({
    frontmatter: {},
    body: "---\nname: open-ended",
  });
});

test("an empty front matter block gives an empty record", () => {
  expect(parsed("---\n---\nbody").frontmatter).toEqual({});
});

test("broken YAML becomes a yaml_invalid error value instead of a throw", () => {
  const result = parseFrontmatter("---\nname: [unclosed\n---\nbody");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe("yaml_invalid");
});

test("a scalar front matter document is returned as is for the schema to reject", () => {
  expect(parsed("---\njust a string\n---\nbody").frontmatter).toBe("just a string");
});
