import { describe, expect, test } from "bun:test";
import {
  createRobotsChecker,
  parseRobots,
  robotsAllows,
  rulesFromResponse,
  type RobotsFetcher,
} from "../src/policy/robots.ts";
import { manualClock } from "./support/clock.ts";

const SAMPLE = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/public.html
Disallow: /*.pdf$

User-agent: Xeon
Disallow: /xeon-only/
Allow: /xeon-only/ok
`;

describe("robots.txt", () => {
  test("the Xeon group wins over the wildcard group", () => {
    const rules = parseRobots(SAMPLE);
    expect(robotsAllows(rules, "/xeon-only/page")).toBe(false);
    expect(robotsAllows(rules, "/xeon-only/ok")).toBe(true);
    // 와일드카드 그룹의 규칙은 Xeon 그룹이 있으면 쓰지 않는다
    expect(robotsAllows(rules, "/private/page")).toBe(true);
  });

  test("the wildcard group applies when no group names Xeon", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /private/\nAllow: /private/public.html\nDisallow: /*.pdf$",
    );
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(robotsAllows(rules, "/private/public.html")).toBe(true);
    expect(robotsAllows(rules, "/doc.pdf")).toBe(false);
    expect(robotsAllows(rules, "/doc.pdf?x=1")).toBe(true);
    expect(robotsAllows(rules, "/open")).toBe(true);
  });

  test("the longest rule wins and allow wins a tie", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a\nDisallow: /b/c\nAllow: /b");
    expect(robotsAllows(rules, "/a/x")).toBe(true);
    expect(robotsAllows(rules, "/b/c/d")).toBe(false);
    expect(robotsAllows(rules, "/b/x")).toBe(true);
  });

  test("grouped user agents share rules and an empty disallow allows all", () => {
    const rules = parseRobots(
      "User-agent: foo\nUser-agent: xeon\nDisallow: /x\n\nUser-agent: *\nDisallow:",
    );
    expect(robotsAllows(rules, "/x")).toBe(false);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:"), "/anything")).toBe(true);
  });

  test("status codes pick the rules", () => {
    expect(robotsAllows(rulesFromResponse(404, ""), "/x")).toBe(true);
    expect(robotsAllows(rulesFromResponse(403, ""), "/x")).toBe(true);
    expect(robotsAllows(rulesFromResponse(500, ""), "/x")).toBe(false);
    expect(robotsAllows(rulesFromResponse(503, ""), "/x")).toBe(false);
    expect(robotsAllows(rulesFromResponse(200, "User-agent: *\nDisallow: /no"), "/no")).toBe(false);
  });

  test("results are cached for 24 hours per origin", async () => {
    const clock = manualClock();
    let calls = 0;
    const fetcher: RobotsFetcher = () => {
      calls += 1;
      return Promise.resolve({
        kind: "response",
        status: 200,
        body: "User-agent: *\nDisallow: /no",
      });
    };
    const checker = createRobotsChecker(fetcher, clock);
    const signal = new AbortController().signal;
    expect(await checker.allows(new URL("https://a.example/no"), signal)).toBe(false);
    expect(await checker.allows(new URL("https://a.example/yes"), signal)).toBe(true);
    expect(await checker.allows(new URL("https://b.example/no"), signal)).toBe(false);
    expect(calls).toBe(2);
    clock.advance(23 * 60 * 60 * 1000);
    await checker.allows(new URL("https://a.example/yes"), signal);
    expect(calls).toBe(2);
    clock.advance(2 * 60 * 60 * 1000);
    await checker.allows(new URL("https://a.example/yes"), signal);
    expect(calls).toBe(3);
  });

  test("a failed fetch disallows everything", async () => {
    const checker = createRobotsChecker(() => Promise.resolve({ kind: "failed" }), manualClock());
    const signal = new AbortController().signal;
    expect(await checker.allows(new URL("https://a.example/"), signal)).toBe(false);
  });

  test("a cancelled fetch is not cached as disallow-all", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const checker = createRobotsChecker(() => {
      attempts += 1;
      return Promise.resolve(
        attempts === 1 ? { kind: "failed" } : { kind: "response", status: 200, body: "" },
      );
    }, manualClock());
    controller.abort();
    expect(await checker.allows(new URL("https://a.example/"), controller.signal)).toBe(false);
    const fresh = new AbortController().signal;
    expect(await checker.allows(new URL("https://a.example/"), fresh)).toBe(true);
    expect(attempts).toBe(2);
  });
});
