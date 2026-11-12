import { describe, expect, test } from "bun:test";
import { createHelloMarker } from "../../../src/web/server/hello-origin.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hello(client: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "host.hello",
    params: { protocolVersion: "1.0.0", client, ...extra },
  });
}

const baseClient = { name: "web", version: "1.0.0", kind: "desktop" };

function lines(bytes: Uint8Array): unknown[] {
  return decoder
    .decode(bytes)
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

describe("createHelloMarker", () => {
  test("adds origin remote and the device id to host.hello", () => {
    const marker = createHelloMarker("dev_0123456789abcdef");
    const out = marker.feed(encoder.encode(`${hello(baseClient)}\n`));
    expect(lines(out)).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "host.hello",
        params: {
          protocolVersion: "1.0.0",
          client: { ...baseClient, origin: "remote", deviceId: "dev_0123456789abcdef" },
        },
      },
    ]);
  });

  test("overwrites a client-supplied origin and device id", () => {
    const marker = createHelloMarker("dev_a");
    const out = marker.feed(
      encoder.encode(`${hello({ ...baseClient, origin: "local", deviceId: "dev_forged" })}\n`),
    );
    expect(lines(out)).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "host.hello",
        params: {
          protocolVersion: "1.0.0",
          client: { ...baseClient, origin: "remote", deviceId: "dev_a" },
        },
      },
    ]);
  });

  test("passes other lines through byte for byte", () => {
    const marker = createHelloMarker("dev_a");
    const text = `{"jsonrpc":"2.0",  "id":2,"method":"thread.list","params":{}}\n`;
    expect(decoder.decode(marker.feed(encoder.encode(text)))).toBe(text);
  });

  test("holds a partial line until its newline arrives, across chunks", () => {
    const marker = createHelloMarker("dev_a");
    const full = `${hello(baseClient)}\n`;
    const cut = 20;
    expect(marker.feed(encoder.encode(full.slice(0, cut))).byteLength).toBe(0);
    expect(marker.held()).toBe(cut);
    const out = marker.feed(encoder.encode(full.slice(cut)));
    expect(marker.held()).toBe(0);
    expect(lines(out)).toHaveLength(1);
    expect(decoder.decode(out)).toContain('"origin":"remote"');
  });

  test("marks a hello whose method key is hidden behind a JSON escape", () => {
    const marker = createHelloMarker("dev_a");
    const sneaky = hello(baseClient)
      .replace('"method"', '"\\u006dethod"')
      .replace("host.hello", "host\\u002ehello");
    const out = marker.feed(encoder.encode(`${sneaky}\n`));
    expect(decoder.decode(out)).toContain('"deviceId":"dev_a"');
  });

  test("marks a retried hello after a non-hello line and keeps line order", () => {
    const marker = createHelloMarker("dev_a");
    const first = `{"jsonrpc":"2.0","id":0,"method":"x"}`;
    const out = marker.feed(encoder.encode(`${first}\n${hello(baseClient)}\n`));
    const parsed = lines(out);
    expect(parsed).toHaveLength(2);
    expect(decoder.decode(out).startsWith(`${first}\n`)).toBe(true);
    expect(decoder.decode(out).endsWith('"deviceId":"dev_a"}}}\n')).toBe(true);
  });
});
