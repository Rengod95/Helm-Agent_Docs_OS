// 큰 값 시험(AGE-59)의 주도 픽스처. 단계는 받은 값의 길이와 SHA-256을 상태에 적는다(값 전체를 상태에 싣지 않는다).
// 시작 입력 `mode`로 갈래를 고른다:
//   start    시작 입력의 `text`를 다이제스트로 적고 끝낸다
//   handoff  `text`를 `bb`에게 맡기고, 돌아온 결과의 `result`를 다이제스트로 적고 끝낸다(맡기는 쪽, `ba`)
//   produce  맡기는 쪽(`ba`)은 `size` 바이트만큼 글을 만들게 `bb`에게 맡기고, `bb`는 그 글을 결과 `{text}`로 돌려준다.
//            맡기는 쪽은 돌아온 글의 다이제스트를 적는다
//   yield    첫 단계에서 커밋하고 기다린다. 사용자 메시지의 `content`를 다이제스트로 적고 끝낸다
import { createHash } from "node:crypto";
import { Type } from "typebox";
import type { DriveStep, ExtensionEntry } from "@fresnel/contracts/extensions";

interface Doc {
  readonly n: number;
  readonly seen: string;
}

const DOC = Type.Object({ n: Type.Integer({ minimum: 0 }), seen: Type.String() });

/** 글의 UTF-8 길이와 SHA-256. 시험이 같은 식을 따로 계산해 비교한다 */
function digestOf(text: string): { readonly length: number; readonly sha256: string } {
  return {
    length: new TextEncoder().encode(text).byteLength,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function fieldOf(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const found = Object.entries(input).find(([name]) => name === key);
  return found?.[1];
}

function modeOf(input: unknown): string {
  const mode = fieldOf(input, "mode");
  return typeof mode === "string" ? mode : "start";
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sizeOf(input: unknown): number {
  const size = fieldOf(input, "size");
  return typeof size === "number" ? size : 0;
}

/** 한글 글자 하나는 UTF-8 세 바이트다. 바이트 수에 가까운 글을 만든다 */
function koreanOf(bytes: number): string {
  return "가".repeat(Math.ceil(bytes / 3));
}

/** 맡기는 쪽(`ba`) */
export const parentStep: DriveStep<Doc> = async ({ state, last, frame }) => {
  const mode = modeOf(frame.input);
  if (last === null) {
    // 커밋한 뒤 기다린다: 메시지는 커밋된 주도권에만 받힌다(lease.ts claimTargetOf)
    if (mode === "yield") {
      return { do: "commit", state: { n: state.n + 1, seen: state.seen }, next: { do: "yield" } };
    }
    if (mode === "handoff") {
      return {
        do: "handoff",
        to: "bb",
        input: { mode: "start", text: textOf(fieldOf(frame.input, "text")) },
      };
    }
    if (mode === "produce") {
      return { do: "handoff", to: "bb", input: { mode: "produce", size: sizeOf(frame.input) } };
    }
    const text = textOf(fieldOf(frame.input, "text"));
    return {
      do: "commit",
      state: { n: state.n + 1, seen: JSON.stringify(digestOf(text)) },
      next: { do: "done" },
    };
  }
  if (last.kind === "user") {
    const content = last.message.kind === "user" ? textOf(last.message.content) : "";
    return {
      do: "commit",
      state: { n: state.n + 1, seen: JSON.stringify(digestOf(content)) },
      next: { do: "done" },
    };
  }
  if (last.kind === "handoff") {
    const result = last.result;
    const text = textOf(fieldOf(result, "text"));
    const digest = text === "" ? result : digestOf(text);
    return {
      do: "commit",
      state: { n: state.n + 1, seen: JSON.stringify(digest) },
      next: { do: "done" },
    };
  }
  return { do: "done" };
};

/** 맡은 쪽(`bb`) */
export const childStep: DriveStep<Doc> = async ({ frame }) => {
  if (modeOf(frame.input) === "produce") {
    return { do: "done", result: { text: koreanOf(sizeOf(frame.input)) } };
  }
  return { do: "done", result: digestOf(textOf(fieldOf(frame.input, "text"))) };
};

/** 등록 한 개짜리 엔트리 */
export function bigEntry(name: string, step: DriveStep<Doc>): ExtensionEntry {
  return ({ register }) => {
    register(
      name,
      { state: { schema: DOC, initial: { n: 0, seen: "" }, version: 1 }, defaultEnabled: true },
      (g) => {
        g.drive(step);
      },
    );
  };
}
