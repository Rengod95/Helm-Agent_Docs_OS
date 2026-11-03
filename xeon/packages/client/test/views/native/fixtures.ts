import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import { validateUiTree, type UiNode } from "@fresnel/contracts/extensions";

// group-helm의 화면 트리 파일과 시험용 데이터. 실제 파일을 읽어 시험이 실제 트리에 묶이게 한다.

const HELM_UI_DIR = join(import.meta.dir, "../../../../group-helm/ui");

export function helmViewFiles(): readonly string[] {
  return readdirSync(HELM_UI_DIR)
    .filter((name) => name.endsWith(".view.json"))
    .toSorted();
}

/** JSON을 읽는다. 읽기나 파싱에 실패하면 undefined라서 validateUiTree가 거부한다 */
export function readHelmJson(file: string): unknown {
  const parsed = parseJson(readFileSync(join(HELM_UI_DIR, file), "utf8"));
  return parsed.ok ? parsed.value : undefined;
}

/** 검사를 통과한 트리만 돌려준다. 시험 준비 단계이므로 실패하면 시험을 멈춘다 */
export function loadHelmTree(file: string): UiNode {
  const checked = validateUiTree(readHelmJson(file));
  if (!checked.ok) {
    throw new Error(`${file} is not a valid UI tree`);
  }
  return checked.tree;
}

/** helm-inquiry 시험 데이터. lenses 두 개, 발견 한 개, 지난 탐구는 없다. inquiryId는 호출자가 고른다 */
export function helmInquiryDoc(inquiryId: string | null): unknown {
  return {
    status: {
      phase: "diverge",
      lease: "held",
      findings: 3,
      lenses: [
        { title: "A", status: "run" },
        { title: "B", status: "done" },
      ],
      inquiryId,
    },
    findings: { findings: [{ claim: "c", confidence: "high" }] },
    inquiries: { inquiries: [] },
  };
}
