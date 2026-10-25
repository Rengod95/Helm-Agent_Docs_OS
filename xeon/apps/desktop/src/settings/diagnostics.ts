import { parse } from "@xeon/contracts";
import { Type, type Static } from "typebox";

// 외부 바이너리 점검 결과(G2-07, L0.os.spec §3.6.1 `BinaryCheckReport`)를 화면 값으로 읽는다.
// 이 보고서를 wire로 싣는 메서드는 F에 없다(`host.diagnose` 반려, F.wire-settings.spec). 값의 원천은 앱이 주입하고(`src/app/setup.ts`),
// 모양은 platform-os의 보고서 JSON과 같다. 모양이 다르거나 값이 없으면 "받을 수 없음"(null)이다.

const NeedSchema = Type.Union([Type.Literal("required"), Type.Literal("optional")]);
const StatusSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("ok"),
    path: Type.String(),
    version: Type.String(),
    source: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("missing"), hint: Type.String() }),
  Type.Object({ kind: Type.Literal("too_old"), found: Type.String(), required: Type.String() }),
  Type.Object({ kind: Type.Literal("unusable"), reason: Type.String() }),
]);
const ItemSchema = Type.Object({
  name: Type.String(),
  need: NeedSchema,
  usedBy: Type.String(),
  impact: Type.String(),
  status: StatusSchema,
});
const ReportSchema = Type.Object({
  platform: Type.String(),
  items: Type.Array(ItemSchema, { maxItems: 64 }),
  ready: Type.Boolean(),
  blocking: Type.Array(Type.String(), { maxItems: 64 }),
  degraded: Type.Array(Type.String(), { maxItems: 64 }),
});

export type BinaryRow = {
  readonly name: string;
  readonly need: "required" | "optional";
  readonly usedBy: string;
  /** 쓸 수 있으면 true */
  readonly ok: boolean;
  /** 사용자에게 보일 한 줄: 버전 또는 해야 할 일 */
  readonly note: string;
  /** 못 쓸 때 기능에 생기는 영향 */
  readonly impact: string;
};

export type BinaryView = {
  readonly platform: string;
  readonly ready: boolean;
  readonly rows: readonly BinaryRow[];
};

function noteOf(status: Static<typeof StatusSchema>): { ok: boolean; note: string } {
  if (status.kind === "ok") return { ok: true, note: status.version };
  if (status.kind === "missing") return { ok: false, note: status.hint };
  if (status.kind === "too_old") {
    return { ok: false, note: `${status.found} (필요 ${status.required} 이상)` };
  }
  return { ok: false, note: `쓸 수 없음 (${status.reason})` };
}

/** 점검 보고서 JSON을 화면 값으로 읽는다. 없거나 모양이 다르면 null */
export function binaryViewOf(report: unknown): BinaryView | null {
  const parsed = parse(ReportSchema, report);
  if (!parsed.ok) return null;
  const binaries = parsed.value;
  return {
    platform: binaries.platform,
    ready: binaries.ready,
    // 필수를 앞에 두고, 같은 필수/선택 안에서는 못 쓰는 것을 앞에 둔다
    rows: binaries.items
      .map((item): BinaryRow => {
        const { ok, note } = noteOf(item.status);
        return {
          name: item.name,
          need: item.need,
          usedBy: item.usedBy,
          ok,
          note,
          impact: item.impact,
        };
      })
      .toSorted((a, b) => {
        if (a.need !== b.need) return a.need === "required" ? -1 : 1;
        if (a.ok !== b.ok) return a.ok ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
  };
}
