import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attempt, attemptAsync, err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import {
  checkGroupName,
  TEMPLATE_PLACEHOLDERS,
  TemplateIndexSchema,
  type GroupNameError,
  type TemplateIndex,
  type TemplateKind,
  type TemplatePlaceholder,
} from "../../src/index.ts";

// 템플릿 생성기(L3.slots.spec §4.3 3번, §3.3.6 R3·R5). 파일 복사와 치환만 한다. 생성 중에 템플릿 코드를 실행하지 않는다.
// L4의 생성 명령이 같은 규칙을 따로 구현한다(R5, DR-14). 이 생성기는 group-kit 시험이 쓴다.

export const TEMPLATES_DIR: string = fileURLToPath(new URL("../../templates/", import.meta.url));

/** 생성 시험이 만드는 디렉터리의 뿌리. 패키지 안에 둬서 워크스페이스 해석(@xeon/*)이 그대로 된다. 시험이 끝나면 지운다 */
export const GENERATED_ROOT: string = fileURLToPath(new URL("../.generated/", import.meta.url));

/** 이 패키지(@xeon/group-kit)의 디렉터리. 생성 그룹은 자기 패키지를 이름으로 import하므로 링크가 필요하다 */
const GROUP_KIT_DIR: string = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 생성 루트 아래 node_modules/@xeon/group-kit을 이 패키지로 잇는다. 워크스페이스 설치가 하는 일의 시험용 흉내다.
 * 나머지 @xeon/* 패키지와 typebox는 이 패키지의 node_modules에서 이미 해석된다.
 */
export async function linkGroupKit(root: string): Promise<Result<void, GenerateError>> {
  const linked = await attemptAsync(async () => {
    await mkdir(join(root, "node_modules", "@xeon"), { recursive: true });
    await symlink(GROUP_KIT_DIR, join(root, "node_modules", "@xeon", "group-kit"), "dir");
  });
  if (!linked.ok) return err({ kind: "io", cause: linked.error.cause });
  return ok(undefined);
}

/**
 * linkGroupKit이 만든 링크만 지운다. 링크 자체를 지우고(디렉터리로 따라 들어가지 않는다) 생성 루트를 지운다.
 * 이 함수는 패키지 원본을 지우지 않는다.
 */
export function removeGenerated(root: string): void {
  rmSync(join(root, "node_modules", "@xeon", "group-kit"), { force: true });
  rmSync(root, { recursive: true, force: true });
}

export interface GenerateRequest {
  readonly kind: TemplateKind;
  readonly name: string;
  /** 표시 이름. 기본은 이름이다. 생성 코드의 문자열 안에 들어가므로 따옴표·역슬래시·`$`를 쓰지 못한다 */
  readonly title?: string;
  /** 기본 "0.1.0" */
  readonly version?: string;
  /** 만들 디렉터리(절대 경로). 없거나 비어 있어야 한다 */
  readonly target: string;
}

export type GenerateError =
  | GroupNameError
  | {
      readonly kind: "placeholder_value";
      readonly field: "title" | "version";
      readonly value: string;
    }
  | { readonly kind: "target_not_empty"; readonly target: string }
  | { readonly kind: "index_invalid"; readonly cause: unknown }
  | { readonly kind: "io"; readonly cause: unknown };

const TITLE_PATTERN = /^[\p{L}\p{N} ._-]{1,64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

type PlaceholderValues = Readonly<Record<TemplatePlaceholder, string>>;

function substitute(text: string, values: PlaceholderValues): string {
  return TEMPLATE_PLACEHOLDERS.reduce((out, key) => out.replaceAll(key, values[key]), text);
}

/** 색인의 파일 경로는 "common/…"이나 "<종류>/…"로 시작한다. 만들 파일 경로에서는 그 첫 부분을 뗀다 */
function destinationOf(file: string): string {
  return file.split("/").slice(1).join("/");
}

async function readIndex(): Promise<Result<TemplateIndex, GenerateError>> {
  const text = await attemptAsync(() => Bun.file(join(TEMPLATES_DIR, "index.json")).text());
  if (!text.ok) return err({ kind: "io", cause: text.error.cause });
  const json = parseJson(text.value);
  if (!json.ok) return err({ kind: "index_invalid", cause: json.error.cause });
  const checked = parse(TemplateIndexSchema, json.value);
  if (!checked.ok) return err({ kind: "index_invalid", cause: checked.error });
  return ok(checked.value);
}

function targetIsEmpty(target: string): Result<boolean, GenerateError> {
  const listed = attempt(() => !existsSync(target) || readdirSync(target).length === 0);
  if (!listed.ok) return err({ kind: "io", cause: listed.error.cause });
  return ok(listed.value);
}

/** 색인의 파일 하나를 읽어 치환하고 대상 디렉터리에 쓴다. 쓴 파일의 상대 경로를 돌려준다 */
async function writeTemplateFile(
  file: string,
  target: string,
  values: PlaceholderValues,
): Promise<Result<string, GenerateError>> {
  const read = await attemptAsync(() => Bun.file(join(TEMPLATES_DIR, file)).text());
  if (!read.ok) return err({ kind: "io", cause: read.error.cause });
  const relative = substitute(destinationOf(file), values);
  const dest = join(target, relative);
  const body = substitute(read.value, values);
  const wrote = await attemptAsync(async () => {
    await mkdir(dirname(dest), { recursive: true });
    await Bun.write(dest, body);
  });
  if (!wrote.ok) return err({ kind: "io", cause: wrote.error.cause });
  return ok(relative);
}

/**
 * 템플릿으로 그룹 디렉터리를 만든다. 성공하면 만든 파일의 상대 경로(대상 디렉터리 기준)를 돌려준다.
 * 이름, 치환 값, 대상, 색인은 쓰기 전에 검사한다. 입출력 실패는 이미 쓴 파일을 지우지 않으니 호출자가 생성 루트를 지운다.
 */
export async function generateTemplate(
  request: GenerateRequest,
): Promise<Result<readonly string[], GenerateError>> {
  const named = checkGroupName(request.name);
  if (!named.ok) return err(named.error);
  const title = request.title ?? request.name;
  if (!TITLE_PATTERN.test(title)) {
    return err({ kind: "placeholder_value", field: "title", value: title });
  }
  const version = request.version ?? "0.1.0";
  if (!VERSION_PATTERN.test(version)) {
    return err({ kind: "placeholder_value", field: "version", value: version });
  }
  const index = await readIndex();
  if (!index.ok) return err(index.error);
  const empty = targetIsEmpty(request.target);
  if (!empty.ok) return err(empty.error);
  if (!empty.value) return err({ kind: "target_not_empty", target: request.target });

  const values: PlaceholderValues = {
    __ID__: request.name,
    __TITLE__: title,
    __VERSION__: version,
  };
  const written = await Promise.all(
    index.value.templates[request.kind].files.map((file) =>
      writeTemplateFile(file, request.target, values),
    ),
  );
  const [firstFailure] = written.flatMap((result) => (result.ok ? [] : [result.error]));
  if (firstFailure !== undefined) return err(firstFailure);
  return ok(written.flatMap((result) => (result.ok ? [result.value] : [])));
}
