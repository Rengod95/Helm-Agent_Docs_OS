import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attempt, attemptAsync, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import { ExtensionNameSchema, validateManifest } from "@fresnel/contracts/extensions";
import { hashPluginTree } from "./content-hash.ts";

// 한 줄 지침(M5c §4.10). 입력 한 줄을 지침만 든 플러그인 폴더로 옮기는 규칙과, 그 폴더를 쓰고 알아보는 일이다.
// 초안과 검토 항목은 `review.ts`의 `fromInstruction`이 만든다. 이 모듈은 검토 상태를 읽지 않는다(판정은 호출자가 한다).

/** 지침 본문 글자 상한. 와이어 스키마 `text`의 상한과 같다(`length`는 UTF-16 단위다) */
const INSTRUCTION_TEXT_MAX = 2000;
/** 목적 한 문장 상한. 매니페스트 `purpose`의 상한과 같다 */
const INSTRUCTION_PURPOSE_MAX = 200;
/** 설명 상한. 매니페스트 `description`의 상한과 같다 */
const INSTRUCTION_DESCRIPTION_MAX = 1024;
/** 지침 파일. 폴더 루트에 있다 */
const INSTRUCTION_FILE = "instructions.md";
/** 매니페스트 위치(폴더 기준) */
const MANIFEST_PATH = ".fresnel-plugin/plugin.json";
/** 이름을 안 준 경우의 접두와 내용 해시 자리 수(§4.10.1) */
const GENERATED_PREFIX = "instr-";
const GENERATED_HEX_LENGTH = 6;
/** 지침만 든 플러그인의 매니페스트 버전. 같은 이름의 새 버전도 이 값이고 내용 해시로 구별한다 [제안] */
const INSTRUCTION_VERSION = "0.0.0";

/** 입력 검사의 이슈 하나. 검토 서비스가 `plugin.invalid`의 `details.issues`로 옮긴다 */
export interface InstructionIssue {
  readonly code: "text_length" | "text_blank" | "name_invalid";
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

/** 폴더 쓰기 실패. 이유는 저장소 쪽 `io`로만 나눈다 */
export interface InstructionWriteFailure {
  readonly kind: "io";
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 입력 검사. 와이어 스키마가 먼저 거절하지만(연결 계층의 `jsonrpc.invalidParams`), 포트를 직접 부르는 쪽을 위해 같은 규칙을
 * 여기서도 지킨다. 공백만 있는 본문은 목적이 비어 승인할 수 없으므로 거절한다 [제안]
 */
export function instructionIssuesOf(text: string, name: string | undefined): InstructionIssue[] {
  const issues: InstructionIssue[] = [];
  if (text.length === 0 || text.length > INSTRUCTION_TEXT_MAX) {
    issues.push({
      code: "text_length",
      severity: "error",
      path: "/text",
      message: `text must be 1 to ${INSTRUCTION_TEXT_MAX} characters`,
    });
  } else if (text.trim() === "") {
    issues.push({ code: "text_blank", severity: "error", path: "/text", message: "text is blank" });
  }
  if (name !== undefined && !parse(ExtensionNameSchema, name).ok) {
    issues.push({
      code: "name_invalid",
      severity: "error",
      path: "/name",
      message: "name must match the extension name pattern",
    });
  }
  return issues;
}

/** 이름을 안 줬을 때의 이름: `instr-` 뒤에 입력 텍스트 sha256의 앞 6자(16진수) */
export function generatedNameOf(text: string): string {
  return `${GENERATED_PREFIX}${sha256Hex(text).slice(0, GENERATED_HEX_LENGTH)}`;
}

/**
 * 목적 한 문장: 입력의 앞부분을 글자(코드 포인트) 단위로 잘라 `INSTRUCTION_PURPOSE_MAX`를 넘지 않게 하고,
 * 개행은 공백으로 바꾼다. 앞뒤 공백은 목적 칸이 보여 주는 값이라 뗀다 [제안]
 */
export function purposeOf(text: string): string {
  let purpose = "";
  for (const char of text.replace(/\r\n|\r|\n/g, " ")) {
    if (purpose.length + char.length > INSTRUCTION_PURPOSE_MAX) break;
    purpose += char;
  }
  return purpose.trim();
}

/**
 * 설명: 지침 글 그대로(앞뒤 공백을 뗀다), 매니페스트 상한 안에서 자른다. 한 줄 지침은 승인 때 채울 설명 입력이 없어서 글이 곧 설명이다 [제안]
 */
export function descriptionOf(text: string): string {
  let description = "";
  for (const char of text) {
    if (description.length + char.length > INSTRUCTION_DESCRIPTION_MAX) break;
    description += char;
  }
  return description.trim();
}

/**
 * 최소 매니페스트 텍스트. 스키마 2, 이름, 버전, 목적과 설명(있을 때만), 지침 파일 하나의 `components`만 둔다.
 * 코드도 훅도 도구도 없어 카드는 권고(advisory)의 지침 칸 하나가 된다
 */
export function manifestTextOf(name: string, purpose: string, description: string): string {
  const manifest = {
    schemaVersion: 2,
    name,
    version: INSTRUCTION_VERSION,
    ...(purpose === "" ? {} : { purpose }),
    ...(description === "" ? {} : { description }),
    components: { instructions: [INSTRUCTION_FILE] },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * 지침 폴더를 쓴다: `instructions.md`는 입력 텍스트 그대로(개행을 더하지 않는다), 매니페스트는 `.fresnel-plugin/plugin.json`.
 * 같은 이름의 파일이 있으면 덮어쓴다. 호출자가 덮어써도 되는지 먼저 정한다(`isInstructionFolder`)
 */
export async function writeInstructionFolder(
  dir: string,
  manifest: string,
  text: string,
): Promise<Result<void, InstructionWriteFailure>> {
  const written = await attemptAsync(async () => {
    await mkdir(join(dir, ".fresnel-plugin"), { recursive: true });
    await writeFile(join(dir, INSTRUCTION_FILE), text, "utf8");
    await writeFile(join(dir, MANIFEST_PATH), manifest, "utf8");
  });
  return written.ok ? ok(undefined) : err({ kind: "io" });
}

/**
 * 폴더가 이 기능이 만든 지침 플러그인의 모양인가: 파일이 매니페스트와 `instructions.md` 둘뿐이고, 매니페스트가 검증을 통과하며
 * 이름이 `name`이고, 목적이 있고, 구성 요소가 지침 파일 하나뿐이다. 읽지 못하면 아니다(모호하면 거절이다, §4.10.4)
 */
export function isInstructionFolder(dir: string, name: string): boolean {
  const tree = hashPluginTree(dir);
  if (!tree.ok) return false;
  const paths = tree.value.files.map((file) => file.path).toSorted();
  const expected = [INSTRUCTION_FILE, MANIFEST_PATH].toSorted();
  if (paths.length !== expected.length || paths.some((path, index) => path !== expected[index])) {
    return false;
  }
  const text = attempt(() => readFileSync(join(dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return false;
  const json = parseJson(text.value);
  if (!json.ok) return false;
  const manifest = validateManifest(json.value).manifest;
  if (manifest === undefined) return false;
  const components = manifest.components;
  return (
    manifest.name === name &&
    manifest.purpose !== undefined &&
    components !== undefined &&
    Object.keys(components).length === 1 &&
    components.instructions?.length === 1 &&
    components.instructions[0] === INSTRUCTION_FILE
  );
}
