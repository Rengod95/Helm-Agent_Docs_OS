import { describe, expect, test } from "bun:test";
import { classifyAddress, parseIpv4, parseIpv6 } from "../src/policy/address.ts";

describe("address classification", () => {
  test("ipv4 ranges follow the spec table", () => {
    const table: readonly (readonly [string, string])[] = [
      ["8.8.8.8", "public"],
      ["93.184.216.34", "public"],
      ["0.0.0.0", "loopback"],
      ["0.1.2.3", "loopback"],
      ["127.0.0.1", "loopback"],
      ["127.255.255.255", "loopback"],
      ["10.0.0.1", "private"],
      ["172.16.0.1", "private"],
      ["172.31.255.255", "private"],
      ["172.32.0.1", "public"],
      ["192.168.1.1", "private"],
      ["100.64.0.1", "private"],
      ["100.127.255.255", "private"],
      ["100.128.0.1", "public"],
      ["169.254.1.1", "link_local"],
      ["169.254.169.254", "metadata"],
      ["169.254.170.2", "metadata"],
      ["100.100.100.200", "metadata"],
      ["192.0.0.1", "reserved"],
      ["192.0.2.5", "reserved"],
      ["198.18.0.1", "reserved"],
      ["198.19.255.255", "reserved"],
      ["198.51.100.7", "reserved"],
      ["203.0.113.9", "reserved"],
      ["224.0.0.1", "reserved"],
      ["240.0.0.1", "reserved"],
      ["255.255.255.255", "reserved"],
    ];
    for (const [address, expected] of table) {
      expect([address, classifyAddress(address)]).toEqual([address, expected]);
    }
  });

  test("ipv6 ranges and embedded ipv4 follow the spec table", () => {
    const table: readonly (readonly [string, string])[] = [
      ["2606:4700:4700::1111", "public"],
      ["::1", "loopback"],
      ["::", "loopback"],
      ["fc00::1", "private"],
      ["fd12:3456::1", "private"],
      ["fd00:ec2::254", "metadata"],
      ["fe80::1", "link_local"],
      ["fe80::1%eth0", "link_local"],
      ["ff02::1", "reserved"],
      ["fec0::1", "reserved"],
      ["2001:db8::1", "reserved"],
      ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "reserved"],
      ["::ffff:127.0.0.1", "loopback"],
      ["::ffff:7f00:1", "loopback"],
      ["::ffff:10.0.0.1", "private"],
      ["::ffff:8.8.8.8", "public"],
      ["::ffff:169.254.169.254", "metadata"],
      ["64:ff9b::7f00:1", "loopback"],
      ["64:ff9b::808:808", "public"],
      ["64:ff9b:1::1", "reserved"],
      ["2002:7f00:1::1", "loopback"],
      ["2002:0808:0808::1", "public"],
      ["[::1]", "loopback"],
    ];
    for (const [address, expected] of table) {
      expect([address, classifyAddress(address)]).toEqual([address, expected]);
    }
  });

  test("text that is not an address has no class", () => {
    for (const text of ["example.com", "1.2.3", "256.1.1.1", "01.2.3.4", "::g", "1:2:3", ":::"]) {
      expect([text, classifyAddress(text)]).toEqual([text, undefined]);
    }
  });

  test("parsers read the compressed and dotted forms", () => {
    expect(parseIpv4("1.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parseIpv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIpv6("1::")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeUndefined();
  });
});
