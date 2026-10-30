import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { t } from "@xeon/client/i18n";
import { attemptAsync, err, ok, parseJson, type Result } from "@xeon/contracts";
import type { GroupIoError, GroupTargetState, GroupTemplatesPort } from "../io.ts";

// L4.cli.spec §3.8. `xeon group new`의 실제 파일 작업. 시험(group-new-core-diff.test.ts)도 이 구현을 쓴다.
// 템플릿 위치와 사용자 설정 폴더는 runtime.ts가 넘긴다. 이 파일은 프로세스 환경을 읽지 않는다.

export interface GroupFsOptions {
  /** templates/ 디렉터리. 찾지 못했으면 null */
  readonly templatesDir: string | null;
  /** `<OsDirs.config>`를 부를 때 구한다. 사용자 확장은 그 아래 `extensions/<이름>/`이다. 모르면 null */
  readonly userConfigDir: () => string | null;
  /** 폴더 없이 설치된 기본 그룹 이름(runtime.ts가 정한다). 목록이 어긋나는 한계는 spec §10에 적는다 */
  readonly builtinNames: readonly string[];
}

/**
 * 템플릿 디렉터리를 찾는다: 환경 변수 XEON_GROUP_TEMPLATES_DIR, 릴리즈의 자원 디렉터리(`<resourceDir>/group-kit/templates`),
 * 없으면 `from`에서 위로 올라가며 packages/group-kit/templates를 찾는다(소스 실행)
 */
export function locateGroupTemplates(
  env: Readonly<Record<string, string | undefined>>,
  from: string,
  resourceDir?: string,
): string | null {
  const override = env["XEON_GROUP_TEMPLATES_DIR"];
  if (override !== undefined && override !== "") return override;
  if (resourceDir !== undefined) {
    const bundled = join(resourceDir, "group-kit", "templates");
    if (existsSync(join(bundled, "index.json"))) return bundled;
  }
  let dir = from;
  for (;;) {
    const candidate = join(dir, "packages", "group-kit", "templates");
    if (existsSync(join(candidate, "index.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function codeOf(caught: unknown): string | undefined {
  if (typeof caught !== "object" || caught === null || !("code" in caught)) return undefined;
  return typeof caught.code === "string" ? caught.code : undefined;
}

/** 파일 작업 하나를 값으로 바꾼다. 던진 값은 메시지와 없음 여부만 남긴다 */
async function io<T>(path: string, work: () => Promise<T>): Promise<Result<T, GroupIoError>> {
  const attempted = await attemptAsync(work);
  if (attempted.ok) return ok(attempted.value);
  const cause = attempted.error.cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return err({ path, message, missing: codeOf(cause) === "ENOENT" });
}

/** 매니페스트의 name. 매니페스트 파일이 없으면 null(확장이 아닌 폴더), 있는데 못 읽거나 name이 없으면 실패다 */
async function manifestNameOf(manifestPath: string): Promise<Result<string | null, GroupIoError>> {
  const text = await io(manifestPath, () => readFile(manifestPath, "utf8"));
  if (!text.ok) return text.error.missing ? ok(null) : text;
  const json = parseJson(text.value);
  if (!json.ok)
    return err({
      path: manifestPath,
      message: t("cli.errors.group.manifestNotJson.message"),
      missing: false,
    });
  const value = json.value;
  const name =
    typeof value === "object" && value !== null && "name" in value ? value.name : undefined;
  if (typeof name !== "string") {
    return err({
      path: manifestPath,
      message: t("cli.errors.group.manifestNoName.message"),
      missing: false,
    });
  }
  return ok(name);
}

/** 한 extensions 폴더 아래 `<이름>/.xeon-plugin/plugin.json`의 이름들. 폴더가 없으면 빈 목록이다 */
async function namesIn(extensionsDir: string): Promise<Result<readonly string[], GroupIoError>> {
  const entries = await io(extensionsDir, () => readdir(extensionsDir, { withFileTypes: true }));
  if (!entries.ok) return entries.error.missing ? ok([]) : entries;
  const manifests = await Promise.all(
    entries.value
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        manifestNameOf(join(extensionsDir, entry.name, ".xeon-plugin", "plugin.json")),
      ),
  );
  const names: string[] = [];
  for (const manifest of manifests) {
    if (!manifest.ok) return manifest;
    if (manifest.value !== null) names.push(manifest.value);
  }
  return ok(names);
}

export function createGroupTemplatesFs(options: GroupFsOptions): GroupTemplatesPort {
  const templatesDir = options.templatesDir;
  return {
    async readIndex() {
      if (templatesDir === null) {
        return err({
          path: "templates",
          message: t("cli.errors.group.templatesMissing.message"),
          missing: true,
        });
      }
      const indexPath = join(templatesDir, "index.json");
      return io(indexPath, () => readFile(indexPath, "utf8"));
    },

    async readTemplateFile(rel) {
      if (templatesDir === null) {
        return err({
          path: rel,
          message: t("cli.errors.group.templatesMissing.message"),
          missing: true,
        });
      }
      const path = join(templatesDir, rel);
      return io(path, () => readFile(path));
    },

    async installedExtensionNames(workspace) {
      const configDir = options.userConfigDir();
      const userDirs = configDir === null ? [] : [join(configDir, "extensions")];
      const dirs = [...userDirs, join(workspace, ".xeon", "extensions")];
      const perDir = await Promise.all(dirs.map((dir) => namesIn(dir)));
      const found: string[] = [...options.builtinNames];
      for (const names of perDir) {
        if (!names.ok) return names;
        found.push(...names.value);
      }
      return ok([...new Set(found)].toSorted());
    },

    async targetState(path) {
      const found = await io(path, () => stat(path));
      if (!found.ok) return found.error.missing ? ok<GroupTargetState>("absent") : found;
      if (!found.value.isDirectory()) return ok<GroupTargetState>("occupied");
      const children = await io(path, () => readdir(path));
      if (!children.ok) return children;
      return ok<GroupTargetState>(children.value.length === 0 ? "empty" : "occupied");
    },

    makeDir(path) {
      return io(path, async () => {
        await mkdir(path, { recursive: true });
      });
    },

    writeFile(path, bytes) {
      return io(path, async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      });
    },

    removeDir(path, removeOptions) {
      return io(path, async () => {
        if (!removeOptions.keepRoot) {
          await rm(path, { recursive: true, force: true });
          return;
        }
        const children = await readdir(path);
        await Promise.all(
          children.map((child) => rm(join(path, child), { recursive: true, force: true })),
        );
      });
    },
  };
}
