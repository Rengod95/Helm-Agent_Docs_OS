import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Bug, err, ok } from "@fresnel/contracts";
import {
  ToolsPortKey,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TestHost } from "@fresnel/ext-host/testing";

// 확장 폴더 하나를 시험 공간에 두고 실제 엔트리를 호스트에 싣는다. 생성 코드와 본보기는 `@fresnel/orchestration-sdk`,
// `@fresnel/contracts`, `typebox`를 import하므로 시험 공간의 node_modules에 이 저장소 패키지들을 잇는다
// (워크스페이스 설치가 하는 일의 시험용 흉내다). 시험 공간은 시험이 끝나면 지운다.

const PACKAGES_DIR: string = fileURLToPath(new URL("../../../", import.meta.url));

const made: string[] = [];

/** 이 파일이 만든 시험 공간을 모두 지운다. 시험 파일의 afterAll에 건다 */
export function cleanupStaged(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** 빈 시험 공간을 만들고 패키지 링크를 건다. 파일은 호출한 쪽이 쓴다 */
export function stageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fresnel-staged-"));
  made.push(root);
  const scope = join(root, "node_modules", "@fresnel");
  mkdirSync(scope, { recursive: true });
  symlinkSync(join(PACKAGES_DIR, "orchestration-sdk"), join(scope, "orchestration-sdk"), "dir");
  symlinkSync(join(PACKAGES_DIR, "contracts"), join(scope, "contracts"), "dir");
  symlinkSync(
    join(PACKAGES_DIR, "contracts", "node_modules", "typebox"),
    join(root, "node_modules", "typebox"),
    "dir",
  );
  return root;
}

/** 시험 공간의 매니페스트를 읽어 검증한다. 검증이 실패하면 시험 공간이나 본보기가 잘못된 것이다 */
function manifestAt(root: string): ExtensionManifest {
  const raw: unknown = JSON.parse(
    readFileSync(join(root, ".fresnel-plugin", "plugin.json"), "utf8"),
  );
  const checked = validateManifest(raw);
  if (checked.manifest === undefined) throw new Bug("the staged manifest does not validate");
  return checked.manifest;
}

function isEntry(value: unknown): value is ExtensionEntry {
  return typeof value === "function";
}

/** 시험 공간의 `src/index.ts`를 가져와 `extension`을 엔트리로 준다. 가져온 값의 모양은 함수인지만 본다 */
async function importEntry(root: string): Promise<ExtensionEntry> {
  const loaded: unknown = await import(pathToFileURL(join(root, "src", "index.ts")).href);
  if (typeof loaded !== "object" || loaded === null || !("extension" in loaded)) {
    throw new Bug("the staged entry has no extension export");
  }
  const candidate: unknown = loaded.extension;
  if (!isEntry(candidate)) throw new Bug("the staged extension export is not an entry");
  return candidate;
}

/**
 * 확장을 호스트에 싣고 켠다. 엔트리가 던졌으면 시험이 실패하도록 던진다.
 * 매니페스트의 `defaultEnabled`가 꺼져 있으므로 대화 하나를 열고 켜기를 그 대화의 유휴 경계에서 적용한다(apps/host 시험과 같은 길)
 */
export async function installStaged(t: TestHost, root: string): Promise<void> {
  const manifest = manifestAt(root);
  // 본보기는 모델 도구를 등록하므로 도구 포트가 있어야 설치가 된다. 도구 실행은 시험하지 않는다(apps/host 시험이 한다)
  await t.host.registerPlatform({
    name: "staged-extension-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        toolMappedFor: () => false,
        executeForPlugin: () => Promise.resolve(err({ kind: "unavailable", message: "not used" })),
        register: () => ok(() => undefined),
      });
    },
  });
  const installed = await t.host.install({
    manifest,
    entry: await importEntry(root),
    loadIndex: 0,
    builtin: false,
  });
  if (installed.entryError !== undefined)
    throw new Error("the staged entry threw while setting up");
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  t.host.registration(manifest.name)?.enable();
  await t.boundary(thread).idle();
  await t.settled();
}

/** 메서드 호출 하나. 대화가 없으면 `null`이다. 결과가 `ok`가 아니면 시험이 실패하도록 던진다 */
export async function callMethod(
  t: TestHost,
  extension: string,
  verb: string,
  params: unknown,
  threadId: ThreadId | null,
): Promise<unknown> {
  const outcome = await t.host.methods.call({
    extension,
    verb,
    params,
    threadId,
    signal: new AbortController().signal,
    caller: "ui",
  });
  await t.settled();
  if (outcome.kind !== "ok") throw new Error(`method ${verb} gave ${outcome.kind}`);
  return outcome.value;
}
