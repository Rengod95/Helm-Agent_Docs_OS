import { describe, expect, test } from "bun:test";
import { MASKED_VALUE, planHeaders, publicResponseHeaders } from "../src/request-points.ts";

describe("planHeaders", () => {
  const original = {
    Authorization: "Bearer real-token",
    "x-api-key": "real-key",
    "X-Team": "core",
    "x-suppressed": null,
  };

  test("handlers see lower-case names with auth values masked and no deleted markers", () => {
    const plan = planHeaders(original);
    expect(plan.visible).toEqual({
      authorization: MASKED_VALUE,
      "x-api-key": MASKED_VALUE,
      "x-team": "core",
    });
    expect(JSON.stringify(plan.visible)).not.toContain("real-");
  });

  test("an unchanged result gives back the original values and names", () => {
    const plan = planHeaders(original);
    const result = plan.finalize(plan.visible);
    expect(result.headers).toEqual({
      Authorization: "Bearer real-token",
      "x-api-key": "real-key",
      "X-Team": "core",
      "x-suppressed": null,
    });
    expect(result.ignored).toEqual([]);
  });

  test("a patch on a normal header is applied, a missing header is deleted, a new one is added", () => {
    const plan = planHeaders(original);
    const result = plan.finalize({
      authorization: MASKED_VALUE,
      "x-api-key": MASKED_VALUE,
      "x-extra": "1",
    });
    expect(result.headers).toMatchObject({ "X-Team": null, "x-extra": "1" });
  });

  test("patching or deleting an auth header is ignored and reported", () => {
    const plan = planHeaders(original);
    const result = plan.finalize({
      authorization: "Bearer stolen",
      "x-team": "core",
    });
    expect(result.headers["Authorization"]).toBe("Bearer real-token");
    expect(result.headers["x-api-key"]).toBe("real-key");
    expect(result.ignored.toSorted()).toEqual(["authorization", "x-api-key"]);
  });

  test("a handler cannot create a new auth header either", () => {
    const plan = planHeaders({ "x-team": "core" });
    const result = plan.finalize({ "x-team": "core", "x-goog-api-key": "injected" });
    expect(result.headers).toEqual({ "x-team": "core" });
    expect(result.ignored).toEqual(["x-goog-api-key"]);
  });

  test("headers resolved from secret references are masked through extraSensitive", () => {
    const plan = planHeaders({ "x-org": "org-secret-value" }, new Set(["x-org"]));
    expect(plan.visible).toEqual({ "x-org": MASKED_VALUE });
    expect(plan.finalize(plan.visible).headers).toEqual({ "x-org": "org-secret-value" });
  });
});

describe("publicResponseHeaders", () => {
  test("drops authentication and cookie headers and lowercases names", () => {
    expect(
      publicResponseHeaders({
        "Content-Type": "application/json",
        "Set-Cookie": "a=b",
        "X-Api-Key": "k",
        "anthropic-ratelimit-tokens-remaining": "10",
      }),
    ).toEqual({
      "content-type": "application/json",
      "anthropic-ratelimit-tokens-remaining": "10",
    });
  });
});
