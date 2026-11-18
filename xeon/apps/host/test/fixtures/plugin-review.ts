import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseJson } from "@fresnel/contracts";
import { ProfilesFileSchema, type ProfilesFile } from "@fresnel/contracts/wire";
import type { EngineHome } from "./engine-home.ts";

// 검토 흐름 시험(M5c §4.7)이 쓰는 사용자 플러그인 폴더 도우미. 훅 하나(`boundary.settle.after`)가 `marker` 파일에 `tag`를 쓴다.
// 그래서 파일 내용으로 "지금 돌고 있는 코드가 어느 판인지"를 값으로 본다. 원본 폴더를 바꾸면 같은 함수로 다시 쓴다.

/** 사용자 플러그인 폴더는 `<config>/plugins/<이름>`이다. 설정 폴더는 0700으로 만든다 */
export function userPluginRoot(home: EngineHome, name: string): string {
  mkdirSync(join(home.root, "config"), { recursive: true, mode: 0o700 });
  return join(home.root, "config", "plugins", name);
}

/**
 * 훅이 `marker`에 `tag`를 쓰는 코드 플러그인을 `<config>/plugins/<name>`에 쓴다. 이미 있으면 코드만 덮어쓴다(원본 편집 흉내).
 * `defaultEnabled: false`라 기본 프로필은 이것을 켜지 않는다
 */
export function writeMarkerPlugin(
  home: EngineHome,
  name: string,
  tag: string,
  marker: string,
): string {
  return writeMarkerPluginAt(userPluginRoot(home, name), name, tag, marker);
}

/** 같은 플러그인 폴더를 `root`에 쓴다(작업 폴더에서 만드는 담당 AI의 폴더처럼 사용자 플러그인 폴더 밖에 둘 때) */
export function writeMarkerPluginAt(
  root: string,
  name: string,
  tag: string,
  marker: string,
): string {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      purpose: `Writes ${tag} on each settled turn`,
      defaultEnabled: false,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
export const extension = ({ register }) => {
  register(${JSON.stringify(name)}, {}, (g) => {
    g.on("boundary.settle.after", () => {
      writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(tag)});
    });
  });
};
`,
  );
  return root;
}

/** 프로필 파일(`<config>/profiles.json`)의 글 그대로. 없으면 null. 바이트 비교에 쓴다 */
export function readProfilesText(home: EngineHome): string | null {
  const path = join(home.root, "config", "profiles.json");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** 프로필 파일을 v2 계약 스키마로 읽는다. 파일이 없거나 스키마와 맞지 않으면 던진다(시험이 실패한다) */
export function storedProfilesOf(home: EngineHome): ProfilesFile {
  const text = readProfilesText(home);
  if (text === null) throw new Error("profiles.json does not exist");
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error("profiles.json is not JSON");
  const checked = parse(ProfilesFileSchema, parsed.value);
  if (!checked.ok) throw new Error("profiles.json does not match the v2 schema");
  return checked.value;
}
