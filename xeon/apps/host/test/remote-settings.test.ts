import { expect, test } from "bun:test";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";

// L4.remote.spec §10. 게이트웨이 설정 여섯 개의 키, 기본값, 허용 범위를 카탈로그에서 값으로 비교한다.
const REMOTE_WEB_DEFAULTS = [
  { key: "l4.remote.web.enabled", default: false },
  { key: "l4.remote.web.listen", default: "127.0.0.1:8480" },
  { key: "l4.remote.web.listenTls", default: "0.0.0.0:8443" },
  { key: "l4.remote.web.hosts", default: [] },
  { key: "l4.remote.web.tlsCert", default: "" },
  { key: "l4.remote.web.tlsKey", default: "" },
];

function coreCatalog() {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error(`the core catalog must build: ${JSON.stringify(built.issues)}`);
  return built.catalog;
}

test("the six l4.remote.web keys are in the catalog with the spec defaults and restart changes", () => {
  const catalog = coreCatalog();
  for (const expected of REMOTE_WEB_DEFAULTS) {
    const def = catalog.get(expected.key);
    expect(def?.key).toBe(expected.key);
    expect(def?.default).toEqual(expected.default);
    expect(def?.runtimeChange).toBe("restart");
  }
});

test("the remote web keys never allow the project or local scope, so a repository cannot open external access", () => {
  const catalog = coreCatalog();
  for (const expected of REMOTE_WEB_DEFAULTS) {
    const def = catalog.get(expected.key);
    expect(def?.allowedScopes).toEqual(["managed", "user"]);
    expect(def?.allowedScopes).not.toContain("project");
    expect(def?.allowedScopes).not.toContain("local");
  }
});
