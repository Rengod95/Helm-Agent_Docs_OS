// [caustic 간극 C-05·C-17] 예산 대비 시간 막대(role="meter")가 caustic에 없다. Progress는 role="progressbar"(진행)라
// "예산의 몇 %를 쓰는가"를 말하지 못한다. caustic 토큰으로 막대를 그리고 role="meter"를 단다.
// 50% 넘는 p95는 warning(SC-20 3단계 [제안]), 100% 넘으면 danger. tone은 채운 막대에만 준다(DP-29).
export function BudgetMeter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = Math.min(1, value / max);
  const tone =
    value > max ? "bg-danger-graphic" : ratio > 0.5 ? "bg-warning-graphic" : "bg-neutral-graphic";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${Math.round(ratio * 100)}%`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-track"
    >
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${Math.max(2, ratio * 100)}%` }}
      />
    </div>
  );
}

/** [caustic 간극 C-17] 행 끝 작은 추세(Sparkline). 막대 7개, 장식(aria-hidden), 값은 표 칸이 말한다. */
export function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span aria-hidden className="inline-flex h-3.5 items-end gap-px align-middle">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-1 rounded-[1px] bg-neutral-graphic"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}
