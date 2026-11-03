// Helm well 기여(helm/panel). DP-23: 그룹 자기 내용만(주제, 단계, 렌즈, 발견 수). 주도·대기열·전환은 런타임 탭에만.
// 머리 "크게"는 셸이 그린다(chatRightTabs의 expand, DP-24).
import { Badge, Stepper } from "@caustic/react";
import { helmInquiry } from "../../_shell";
import { LensTree } from "../parts/lens-tree";

export function HelmWell() {
  const q = helmInquiry;
  return (
    <div className="grid gap-4">
      <p className="-mb-2 m-0 truncate text-ui-xs text-text-tertiary">
        {q.topic} · {q.signal.kind} · {q.signal.text}
      </p>
      <Stepper
        size="xs"
        variant="ghost"
        value={1}
        aria-label="탐구 단계"
        statusLabels={{ done: "끝남", now: "지금", todo: "남음", failed: "실패" }}
        steps={[
          { label: "확산", status: "done" },
          { label: "탐색", status: "now" },
          { label: "수렴", status: "todo" },
          { label: "적용", status: "todo" },
        ]}
      />
      <LensTree lenses={q.lenses} />
      <div className="grid gap-1.5">
        {q.findings.map((f) => (
          <div key={f.claim} className="flex items-baseline gap-2 text-ui-dense">
            <Badge size="sm" tone={f.confidence === "high" ? "success" : "warning"}>
              {f.confidence === "high" ? "높음" : "보통"}
            </Badge>
            <span className="truncate text-text-primary">{f.claim}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
