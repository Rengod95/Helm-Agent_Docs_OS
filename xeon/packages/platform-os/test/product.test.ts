import { expect, test } from "bun:test";
import type { OsInfo } from "@xeon/contracts/services";
import { resolveDirs } from "../src/dirs.ts";
import { PRODUCT, productUidDirName, productUserAgent } from "../src/product.ts";

const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "6.1.0" };

test("product values are fresnel and the user agent carries the version", () => {
  expect(PRODUCT).toEqual({
    name: "fresnel",
    displayName: "Fresnel",
    settingsFileName: "settings.json",
    dbFileName: "fresnel.db",
  });
  expect(productUserAgent("0.1.0")).toBe("fresnel/0.1.0");
  expect(productUidDirName(1000)).toBe("fresnel-1000");
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
