import { describe, expect, test } from "bun:test";
import { MAX_VIOLATIONS, toViolations } from "../src/violations.ts";

describe("toViolations", () => {
  test("parses Seatbelt file and proxy network lines", () => {
    const { violations, truncated } = toViolations(
      [
        "bash(41) deny(1) file-write-create /Users/u/work/x.txt",
        "bash(41) deny(1) file-read-data /Users/u/.ssh/id_ed25519",
        "deny network-outbound example.com:443 (not allowed)",
        "curl(9) deny(1) network-outbound 93.184.216.34:443",
      ],
      { kind: "seatbelt" },
    );
    expect(truncated).toBe(false);
    expect(violations).toEqual([
      { source: "seatbelt", operation: "file_write", target: "/Users/u/work/x.txt", count: 1 },
      { source: "seatbelt", operation: "file_read", target: "/Users/u/.ssh/id_ed25519", count: 1 },
      { source: "proxy", operation: "network", target: "example.com:443", count: 1 },
      { source: "seatbelt", operation: "network", target: "93.184.216.34:443", count: 1 },
    ]);
  });

  test("parses Linux seccomp observer lines as file writes", () => {
    const { violations } = toViolations(
      ["deny openat /srv/x", "deny unlink /srv/x", "deny mkdir /srv/y"],
      {
        kind: "bwrap",
      },
    );
    expect(violations).toEqual([
      { source: "seccomp", operation: "file_write", target: "/srv/x", count: 2 },
      { source: "seccomp", operation: "file_write", target: "/srv/y", count: 1 },
    ]);
  });

  test("lines it does not understand become an anonymous other violation", () => {
    const { violations } = toViolations(["something odd with token=abc123"], { kind: "bwrap" });
    expect(violations).toEqual([{ source: "seccomp", operation: "other", count: 1 }]);
    expect(JSON.stringify(violations)).not.toContain("abc123");
  });

  test("empty input gives nothing", () => {
    expect(toViolations([], { kind: "bwrap" })).toEqual({ violations: [], truncated: false });
  });

  test("caps the number of kinds at the limit", () => {
    const lines = Array.from({ length: MAX_VIOLATIONS }, (_, i) => `deny open /p/${i}`);
    expect(toViolations(lines, { kind: "bwrap" }).truncated).toBe(false);
    expect(toViolations([...lines, "deny open /extra"], { kind: "bwrap" })).toMatchObject({
      truncated: true,
    });
  });
});
