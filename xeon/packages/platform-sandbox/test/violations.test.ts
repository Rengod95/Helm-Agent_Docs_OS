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
    expect(toViolations([], { kind: "bwrap" })).toEqual({
      violations: [],
      truncated: false,
      blocks: [],
    });
  });

  test("caps the number of kinds at the limit", () => {
    const lines = Array.from({ length: MAX_VIOLATIONS }, (_, i) => `deny open /p/${i}`);
    expect(toViolations(lines, { kind: "bwrap" }).truncated).toBe(false);
    expect(toViolations([...lines, "deny open /extra"], { kind: "bwrap" })).toMatchObject({
      truncated: true,
    });
  });
});

describe("toViolations blocks", () => {
  test("a proxy denial from the deny list is a network block with the host, port removed", () => {
    const { blocks, violations } = toViolations(
      [
        "deny network-outbound localhost:8080 (host is on the deny list)",
        "deny network-outbound [::1]:443 (host is on the deny list)",
      ],
      { kind: "seatbelt" },
    );
    expect(blocks).toEqual([
      { code: "sandbox.network_blocked", domain: "localhost" },
      { code: "sandbox.network_blocked", domain: "::1" },
    ]);
    expect(violations).toEqual([
      { source: "proxy", operation: "network", target: "localhost:8080", count: 1 },
      { source: "proxy", operation: "network", target: "[::1]:443", count: 1 },
    ]);
  });

  test("other proxy denials stay violations without a block", () => {
    const { blocks, violations } = toViolations(
      [
        "deny network-outbound 169.254.169.254:80 (resolved address is private)",
        "deny network-outbound evil.example:443 (not on allow-list)",
      ],
      { kind: "seatbelt" },
    );
    expect(blocks).toEqual([]);
    expect(violations.map((violation) => violation.operation)).toEqual(["network", "network"]);
  });

  test("Seatbelt writes and content reads are blocks; metadata reads and direct sockets are not", () => {
    const { blocks } = toViolations(
      [
        "bash(41) deny(1) file-write-create /etc/hosts",
        "bash(41) deny(1) file-read-data /Users/u/.ssh/id_ed25519",
        "bash(41) deny(1) file-read-metadata /Users/u/.cache",
        "curl(9) deny(1) network-outbound 93.184.216.34:443",
      ],
      { kind: "seatbelt" },
    );
    expect(blocks).toEqual([
      { code: "sandbox.write_blocked", path: "/etc/hosts" },
      { code: "sandbox.read_blocked", path: "/Users/u/.ssh/id_ed25519" },
    ]);
  });

  test("the same block is listed once and a Linux seccomp write is a write block", () => {
    const { blocks, violations } = toViolations(
      ["deny openat /srv/x", "deny unlink /srv/x", "deny mkdir /srv/y"],
      { kind: "bwrap" },
    );
    expect(blocks).toEqual([
      { code: "sandbox.write_blocked", path: "/srv/x" },
      { code: "sandbox.write_blocked", path: "/srv/y" },
    ]);
    expect(violations).toEqual([
      { source: "seccomp", operation: "file_write", target: "/srv/x", count: 2 },
      { source: "seccomp", operation: "file_write", target: "/srv/y", count: 1 },
    ]);
  });

  test("unknown lines make no block", () => {
    expect(toViolations(["something odd with token=abc123"], { kind: "bwrap" }).blocks).toEqual([]);
  });
});
