import { describe, expect, test } from "bun:test";
import {
  appBase,
  appFrameCsp,
  appResponseHeaders,
  buildAppUrl,
  DESKTOP_FRAME_ROOT,
  webFrameRoot,
} from "../../../src/views/app/index.ts";

const TOKEN = "view-token-".padEnd(43, "x");
const ORIGIN = "https://origin.example:8443";

describe("web frame root ({base} substitution)", () => {
  test("the desktop root keeps the fresnel-view address", () => {
    expect(DESKTOP_FRAME_ROOT).toBe("fresnel-view://");
    expect(buildAppUrl("helm", "1.0.0", "ui/index.html")).toBe(
      "fresnel-view://helm/1.0.0/ui/index.html",
    );
    expect(appBase("helm", "1.0.0")).toBe("fresnel-view://helm/1.0.0/");
  });

  test("the web root puts the extension, version and path after the token path", () => {
    const root = webFrameRoot(ORIGIN, `/view/${TOKEN}/`);
    expect(root).toBe(`${ORIGIN}/view/${TOKEN}/`);
    if (root === undefined) throw new Error("root refused");
    expect(buildAppUrl("helm", "1.0.0", "ui/my file.html", "abcDEF123_-xyz90", root)).toBe(
      `${ORIGIN}/view/${TOKEN}/helm/1.0.0/ui/my%20file.html#n=abcDEF123_-xyz90`,
    );
    expect(appBase("helm", "1.0.0", root)).toBe(`${ORIGIN}/view/${TOKEN}/helm/1.0.0/`);
  });

  test("the frame CSP differs between desktop and web only in the base", () => {
    const root = webFrameRoot(ORIGIN, `/view/${TOKEN}/`);
    if (root === undefined) throw new Error("root refused");
    const web = appBase("helm", "1.0.0", root);
    const desktop = appBase("helm", "1.0.0");
    if (web === undefined || desktop === undefined) throw new Error("base refused");
    const webCsp = appFrameCsp(web);
    const desktopCsp = appFrameCsp(desktop);
    expect(webCsp?.replaceAll(web, "{base}")).toBe(desktopCsp?.replaceAll(desktop, "{base}"));
    expect(webCsp).toContain(`script-src ${web}`);
    const headers = appResponseHeaders("text/html", web);
    expect(headers?.["Content-Security-Policy"]).toBe(webCsp);
  });

  test("malformed roots and view paths are refused", () => {
    for (const viewPath of [
      "/view/short/",
      `/view/${TOKEN}`,
      `/view/${TOKEN}/x/`,
      `view/${TOKEN}/`,
      `/other/${TOKEN}/`,
      `/view/${TOKEN.slice(1)}!/`,
    ]) {
      expect(webFrameRoot(ORIGIN, viewPath)).toBeUndefined();
    }
    for (const origin of [
      "",
      "ftp://x",
      "https://a b",
      "https://a;b",
      "https://a/b",
      "javascript:",
    ]) {
      expect(webFrameRoot(origin, `/view/${TOKEN}/`)).toBeUndefined();
    }
    // 뿌리를 직접 만들어 넣어도 모양이 틀리면 주소를 만들지 않는다
    expect(buildAppUrl("helm", "1.0.0", "a.html", undefined, "https://evil.test/")).toBeUndefined();
    expect(appBase("helm", "1.0.0", "https://evil.test/")).toBeUndefined();
  });
});
