import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { appFrameCsp, appResponseHeaders } from "@fresnel/client/views/app";

// Rust 셸(view_scheme.rs)과 TS(views/app/scheme.ts)가 같은 CSP와 같은 응답 헤더 글자를 쓰는지 맞춰 본다. 한쪽만 고치면 여기서 깨진다.
const RUST = readFileSync(new URL("../src-tauri/src/view_scheme.rs", import.meta.url), "utf8");

describe("view scheme parity (Rust and TS)", () => {
  test("every CSP directive of appFrameCsp appears in the Rust list with {base} in place of the prefix", () => {
    const csp = appFrameCsp("fresnel-view://@B@/");
    expect(csp).toBeDefined();
    const directives = (csp ?? "")
      .split("; ")
      .map((part) => part.replaceAll("fresnel-view://@B@/", "{base}"));
    expect(directives).toHaveLength(11);
    for (const directive of directives) expect(RUST).toContain(`"${directive}"`);
    // 순서까지 같다
    const positions = directives.map((directive) => RUST.indexOf(`"${directive}"`));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  });

  test("response header names and fixed values match", () => {
    const headers = appResponseHeaders("text/html", "fresnel-view://a/1.0.0/");
    expect(headers).toBeDefined();
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (name === "Content-Type" || name === "Content-Security-Policy") continue;
      expect(RUST).toContain(
        `.header("${name}", ${name === "Permissions-Policy" ? "PERMISSIONS_POLICY" : `"${value}"`})`,
      );
      if (name === "Permissions-Policy") expect(RUST).toContain(`"${value}"`);
    }
  });
});
