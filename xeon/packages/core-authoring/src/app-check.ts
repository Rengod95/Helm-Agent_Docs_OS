import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { AppDecl, ExtensionManifest } from "@fresnel/contracts/extensions";
import type { DevkitIssue } from "@fresnel/contracts/services";
import { APP_REASON_PLACEHOLDER } from "./app-skeleton.ts";
import { io } from "./errors.ts";
import { isSafeRelative } from "./shared.ts";

// 앱 화면 검사(pgRe §4.3). 화면 모양(ui 항목, `app.reason` 빈 글)은 contracts `validateManifest`가 보고, 여기는 파일과 등록을 본다:
// `app.root` 폴더와 `app.entry` 파일이 있는가, 경로가 확장 폴더 밖으로 나가지 않는가, 기본 까닭 글이 그대로인가,
// 선언한 `methods`가 엔트리에서 `registerMethod`로 등록되었는가(그 반대도). 등록은 문자열 리터럴 이름만 센다.
// 이름이 계산되는 `registerMethod` 호출이 있으면 등록을 알 수 없으므로 등록 검사는 건너뛴다.

/** 검사할 소스 한 파일. `validateExtensionDir`가 읽은 `.ts` 파일과 같은 모양이다 */
interface AppSourceFile {
  readonly file: string;
  readonly text: string;
}

/** 확장 폴더 기준 경로에서 앞의 `./`를 뗀다. `./ui/app`과 `ui/app`은 같다 */
function relativeOf(path: string): string {
  return path.replace(/^\.\//, "");
}

const LITERAL_REGISTRATION = /registerMethod\(\s*(["'])([^"'\\\n]+)\1/g;
const COMPUTED_REGISTRATION = /registerMethod\(\s*(?!["'])/;

/** 소스에서 리터럴 이름으로 등록한 메서드 이름들. 계산된 이름의 등록이 있으면 `computed`가 참이다 */
function registeredMethodsOf(sources: readonly AppSourceFile[]): {
  readonly names: ReadonlySet<string>;
  readonly computed: boolean;
} {
  const names = new Set<string>();
  let computed = false;
  for (const source of sources) {
    for (const match of source.text.matchAll(LITERAL_REGISTRATION)) {
      const name = match[2];
      if (name !== undefined) names.add(name);
    }
    if (COMPUTED_REGISTRATION.test(source.text)) computed = true;
  }
  return { names, computed };
}

function methodIssues(
  manifest: ExtensionManifest,
  sources: readonly AppSourceFile[],
): readonly DevkitIssue[] {
  const declared = manifest.methods ?? [];
  const registered = registeredMethodsOf(sources);
  if (registered.computed) return [];
  const declaredVerbs = new Set(declared.map((decl) => decl.verb));
  const issues: DevkitIssue[] = [];
  declared.forEach((decl, index) => {
    if (registered.names.has(decl.verb)) return;
    issues.push({
      severity: "error",
      code: "method_unregistered",
      path: `/methods/${index}`,
      message: `method ${decl.verb} is declared in methods but the entry never registers it: add g.registerMethod("${decl.verb}", { handler }) in the entry, or remove it from methods`,
    });
  });
  for (const name of registered.names) {
    if (declaredVerbs.has(name)) continue;
    issues.push({
      severity: "error",
      code: "method_undeclared",
      path: "/methods",
      message: `the entry registers method ${name} but methods does not declare it, and the host refuses such a registration: add { verb: "${name}", ... } to methods or remove the registration`,
    });
  }
  return issues;
}

/** 화면 항목 하나의 파일 검사. `app`이 없으면 할 일이 없다 */
async function screenIssues(
  dir: string,
  index: number,
  app: AppDecl | undefined,
): Promise<readonly DevkitIssue[]> {
  if (app === undefined) return [];
  const base = `/ui/items/${index}/app`;
  const root = relativeOf(app.root);
  const entry = relativeOf(app.entry);
  if (!isSafeRelative(root) || !isSafeRelative(entry))
    return [
      {
        severity: "error",
        code: "app_path_unsafe",
        path: `${base}/root`,
        message: `app.root ${app.root} and app.entry ${app.entry} must stay inside the extension folder: use a relative path without ".." (for example "./ui/app" and "index.html")`,
      },
    ];
  const rootPath = join(dir, root);
  const folder = await io(rootPath, () => stat(rootPath));
  if (!folder.ok || !folder.value.isDirectory())
    return [
      {
        severity: "error",
        code: "app_root_missing",
        path: `${base}/root`,
        message: `app.root ${app.root} is not a folder in the extension: create it with ${entry} inside, or point app.root at the folder that holds the HTML`,
      },
    ];
  const entryPath = join(dir, root, entry);
  const file = await io(entryPath, () => stat(entryPath));
  const found: DevkitIssue[] = [];
  if (!file.ok || !file.value.isFile())
    found.push({
      severity: "error",
      code: "app_entry_missing",
      path: `${base}/entry`,
      message: `app.entry ${app.entry} is not a file under ${app.root}: create that HTML file (the frame loads it), or fix app.entry`,
    });
  if (app.reason === APP_REASON_PLACEHOLDER)
    found.push({
      severity: "warning",
      code: "app_reason_placeholder",
      path: `${base}/reason`,
      message:
        "app.reason still has the scaffold's text: write why a declarative view cannot draw this screen, in one line",
    });
  return found;
}

/** 화면 파일과 메서드 등록 검사. 매니페스트가 있어야 부른다. 파일이 없으면 해당 항목의 오류로 알린다 */
export async function appViewIssues(
  dir: string,
  manifest: ExtensionManifest,
  sources: readonly AppSourceFile[],
): Promise<readonly DevkitIssue[]> {
  const items = manifest.ui?.items ?? [];
  const perScreen = await Promise.all(
    items.map((item, index) => screenIssues(dir, index, item.app)),
  );
  return [...perScreen.flat(), ...methodIssues(manifest, sources)];
}
