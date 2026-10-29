import { assertNever, Bug } from "@xeon/contracts";
import type { DeliveryInput } from "./types.ts";

// L2.artifacts.spec §4.2.6. 제출 때 에이전트에 보내는 전달 문안을 만든다. 코드 원문은 넣지 않는다.
// 경로, hunk ID, 줄 번호와 사용자가 쓴 코멘트 글만 넣는다.

type DeliveryFile = DeliveryInput["files"][number];
type DeliveryHunk = DeliveryFile["hunks"][number];
type DeliveryComment = DeliveryInput["comments"][number];

const HUNK_ID = /^f(\d+)h(\d+)$/;

/** hunk ID의 파일 순번으로 경로를 찾는다. 입력에 없는 hunk ID는 호출자의 계약 위반이다 */
function pathOf(input: DeliveryInput, hunkId: string): string {
  const index = HUNK_ID.exec(hunkId)?.[1];
  const file = index === undefined ? undefined : input.files[Number(index)];
  if (file === undefined || !file.hunks.some((hunk) => hunk.hunkId === hunkId)) {
    throw new Bug("Comment target hunk is not in the delivery input.");
  }
  return file.path;
}

/** 한 파일에 한 줄씩 낸다. 조건에 맞는 hunk가 없는 파일은 줄을 내지 않는다 */
function fileLines(
  files: readonly DeliveryFile[],
  label: string,
  picks: (hunk: DeliveryHunk) => boolean,
): string[] {
  const lines: string[] = [];
  for (const file of files) {
    const ids = file.hunks.filter(picks).map((hunk) => hunk.hunkId);
    if (ids.length > 0) lines.push(`${label}: ${file.path} ${ids.join(", ")}`);
  }
  return lines;
}

/** `- <머리>: <글>`. 글의 이어지는 줄은 두 칸 들여 쓴다 */
function bullet(head: string, body: string): string {
  const [first = "", ...rest] = body.split("\n");
  return [`- ${head}: ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
}

function commentLine(input: DeliveryInput, comment: DeliveryComment): string {
  const { target, body } = comment;
  switch (target.type) {
    case "hunk": {
      const at = target.line === undefined ? "" : ` ${target.line.side} ${target.line.number}행`;
      return bullet(`${pathOf(input, target.hunkId)} ${target.hunkId}${at}`, body);
    }
    case "file":
      return bullet(target.path, body);
    case "review":
      return bullet("리뷰 전체", body);
    default:
      return assertNever(target, "renderDelivery comment target");
  }
}

/** 제출 전달 문안. 마지막 줄 뒤에는 줄바꿈이 없다 */
export function renderDelivery(input: DeliveryInput): string {
  const reverted = fileLines(input.files, "거절하고 되돌림", (hunk) => hunk.applied === "reverted");
  const conflicted = fileLines(
    input.files,
    "되돌리지 못함(충돌)",
    (hunk) => hunk.applied === "conflict",
  );
  const kept = fileLines(
    input.files,
    "거절했으나 되돌리지 않음",
    (hunk) => hunk.applied === "none" && hunk.decision === "rejected",
  );
  const approved = input.files.reduce(
    (count, file) => count + file.hunks.filter((hunk) => hunk.decision === "approved").length,
    0,
  );
  const rejectSeen = reverted.length + conflicted.length + kept.length > 0;

  const lines = [
    `[review ${input.reviewId} round ${input.round}]`,
    ...reverted,
    ...conflicted,
    ...kept,
  ];
  if (approved > 0) {
    lines.push(rejectSeen ? `승인: 나머지 ${approved}개 hunk` : `승인: 모든 hunk ${approved}개`);
  }
  if (input.comments.length > 0) {
    lines.push("", "코멘트:", ...input.comments.map((comment) => commentLine(input, comment)));
  }
  return lines.join("\n");
}
