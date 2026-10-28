import {
  assertNever,
  err,
  ok,
  parse,
  parseJson,
  type Result,
  type SchemaSound,
} from "@xeon/contracts";
import { isSkillFilePath, SkillNameSchema } from "@xeon/contracts/capabilities";
import { Type, type TUnsafe } from "typebox";
import type { ProposalKind, ProposalOp } from "./proposal.ts";

// 후보 대상(`target`)의 형식 [제안]. spec §3.5는 "스킬 이름 또는 메모리 영역 이름"까지만 정한다. 연산이 가리킬 대상을 더 좁혀야 해서 아래로 정했다.
//   skill   create·patch·archive: "<스킬 이름>"          add_file: "<스킬 이름>/<지원 파일 경로>"
//   memory  add: "user" | "environment"                  replace·remove: "<영역>/<항목 id 12자>"
//   feedback add: "user/work-style"(§4.7)

const FEEDBACK_TARGET = "user/work-style";

type MemoryArea = "user" | "environment";

export type ParsedTarget =
  | { readonly kind: "skill"; readonly name: string; readonly file: string | null }
  | { readonly kind: "memory"; readonly area: MemoryArea; readonly entryId: string | null }
  | { readonly kind: "feedback" };

export type TargetError = { readonly kind: "target.invalid"; readonly detail: string };

const ENTRY_ID = /^[0-9a-f]{12}$/;

function isArea(value: string): value is MemoryArea {
  return value === "user" || value === "environment";
}

function invalid(detail: string): Result<never, TargetError> {
  return err({ kind: "target.invalid", detail });
}

export function parseTarget(
  kind: ProposalKind,
  op: ProposalOp,
  target: string,
): Result<ParsedTarget, TargetError> {
  switch (kind) {
    case "skill": {
      const slash = target.indexOf("/");
      const name = slash < 0 ? target : target.slice(0, slash);
      if (!parse(SkillNameSchema, name).ok)
        return invalid("skill name must be lowercase letters, digits and hyphens");
      if (op === "add_file") {
        const file = slash < 0 ? "" : target.slice(slash + 1);
        return isSkillFilePath(file)
          ? ok({ kind: "skill", name, file })
          : invalid("add_file target is <skill>/<references|templates|scripts|assets>/<path>");
      }
      return slash < 0
        ? ok({ kind: "skill", name, file: null })
        : invalid(`${op} target is a bare skill name`);
    }
    case "memory": {
      if (op === "add") {
        return isArea(target)
          ? ok({ kind: "memory", area: target, entryId: null })
          : invalid("memory add target is user or environment");
      }
      const [area, entryId, ...rest] = target.split("/");
      if (
        area !== undefined &&
        isArea(area) &&
        entryId !== undefined &&
        ENTRY_ID.test(entryId) &&
        rest.length === 0
      ) {
        return ok({ kind: "memory", area, entryId });
      }
      return invalid("memory replace and remove target is <area>/<12 hex entry id>");
    }
    case "feedback":
      return target === FEEDBACK_TARGET
        ? ok({ kind: "feedback" })
        : invalid(`feedback target is ${FEEDBACK_TARGET}`);
    case "script":
      return invalid("script proposals are a later phase");
    default:
      return assertNever(kind, "ProposalKind");
  }
}

export type PatchEdits = readonly { readonly oldText: string; readonly newText: string }[];

const editsShape = Type.Array(
  Type.Object(
    {
      oldText: Type.String({ minLength: 1, maxLength: 20_000 }),
      newText: Type.String({ maxLength: 20_000 }),
    },
    { additionalProperties: false },
  ),
  { minItems: 1, maxItems: 32 },
);

const EditsSchema: TUnsafe<PatchEdits> = Type.Unsafe<PatchEdits>(
  editsShape satisfies SchemaSound<PatchEdits, typeof editsShape>,
);

/** 스킬 patch 본문은 L2 `skills.patch`의 정확 일치 치환 목록(JSON)이다 [제안, spec §3.5는 통합 diff] */
export function parsePatchEdits(body: string): Result<PatchEdits, TargetError> {
  const json = parseJson(body);
  if (!json.ok) return err({ kind: "target.invalid", detail: "patch body is not JSON" });
  const edits = parse(EditsSchema, json.value);
  if (!edits.ok)
    return err({
      kind: "target.invalid",
      detail: "patch body is not a list of {oldText, newText}",
    });
  return ok(edits.value);
}
