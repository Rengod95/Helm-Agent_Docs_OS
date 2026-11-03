import { describe, expect, test } from "bun:test";
import { createScope, resolvePath, withLocal } from "../../../src/views/native/scope.ts";

const DOC = { lens: { title: "doc-lens" }, status: 1 };

describe("createScope and withLocal", () => {
  test("a new scope has the document and no locals", () => {
    const scope = createScope(DOC);
    expect(scope.doc).toEqual(DOC);
    expect(scope.locals.size).toEqual(0);
  });

  test("withLocal returns a new scope and leaves the old one unchanged", () => {
    const base = createScope(DOC);
    const child = withLocal(base, "lens", { title: "local" });
    expect(base.locals.has("lens")).toEqual(false);
    expect(child.locals.get("lens")).toEqual({ title: "local" });
    expect(child.doc).toEqual(DOC);
  });

  test("a nested local replaces the outer value of the same name", () => {
    const outer = withLocal(createScope(DOC), "item", 1);
    const inner = withLocal(outer, "item", 2);
    expect(resolvePath(outer, "/item")).toEqual({ found: true, value: 1 });
    expect(resolvePath(inner, "/item")).toEqual({ found: true, value: 2 });
  });
});

describe("resolvePath", () => {
  test("reads the document when no local has the first segment", () => {
    const scope = createScope(DOC);
    expect(resolvePath(scope, "/status")).toEqual({ found: true, value: 1 });
    expect(resolvePath(scope, "/lens/title")).toEqual({ found: true, value: "doc-lens" });
    expect(resolvePath(scope, "")).toEqual({ found: true, value: DOC });
  });

  test("a local takes precedence over a document key with the same name", () => {
    const scope = withLocal(createScope(DOC), "lens", { title: "local" });
    expect(resolvePath(scope, "/lens/title")).toEqual({ found: true, value: "local" });
    expect(resolvePath(scope, "/lens")).toEqual({ found: true, value: { title: "local" } });
  });

  test("a local name does not fall back to the document for a missing inner key", () => {
    const scope = withLocal(createScope(DOC), "lens", { other: true });
    expect(resolvePath(scope, "/lens/title")).toEqual({ found: false });
  });

  test("a local can hold a scalar and be read directly", () => {
    const scope = withLocal(createScope(DOC), "status", "shadowed");
    expect(resolvePath(scope, "/status")).toEqual({ found: true, value: "shadowed" });
  });

  test("an invalid pointer is not found", () => {
    const scope = createScope(DOC);
    expect(resolvePath(scope, "status")).toEqual({ found: false });
    expect(resolvePath(scope, "/status~")).toEqual({ found: false });
  });

  test("a prototype name is not found, even as a local-less first segment", () => {
    const scope = createScope(DOC);
    expect(resolvePath(scope, "/constructor")).toEqual({ found: false });
    expect(resolvePath(scope, "/__proto__/x")).toEqual({ found: false });
  });
});
