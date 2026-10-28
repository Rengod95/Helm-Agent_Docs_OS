import { expect, test } from "bun:test";
import type { OsInfo } from "@xeon/contracts/services";
import { resolveDirs } from "../src/dirs.ts";
import { PRODUCT, productUidDirName, productUserAgent } from "../src/product.ts";

const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "6.1.0" };

test("M3 product values are xeon and the user agent carries the version", () => {
  expect(PRODUCT).toEqual({ name: "xeon", displayName: "Xeon", settingsFileName: "settings.json" });
  expect(productUserAgent("0.1.0")).toBe("xeon/0.1.0");
  expect(productUidDirName(1000)).toBe("xeon-1000");
});

test("app directory names come from the product constant", () => {
  const dirs = resolveDirs({
    info: LINUX,
    env: { get: () => undefined },
    home: "/home/u",
    systemTmp: "/tmp",
    uid: 1000,
    resourceDir: "/opt/res",
  });
  expect(dirs.ok && dirs.value.config).toBe(`/home/u/.config/${PRODUCT.name}`);
  expect(dirs.ok && dirs.value.tmp).toBe(`/tmp/${productUidDirName(1000)}`);
});
