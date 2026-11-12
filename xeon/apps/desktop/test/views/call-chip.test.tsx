import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CallChip } from "../../src/views/call-chip.tsx";

describe("CallChip", () => {
  test("running carries the border beam (no spinner), the label and the waiting flag", () => {
    const html = renderToStaticMarkup(<CallChip status="running" label="Running · 3s" />);
    expect(html).toContain('data-status="running"');
    expect(html).toContain('class="fx-beam-edge"');
    expect(html).not.toContain("spinner");
    expect(html).toContain('data-text="Running · 3s"');
    expect(html).not.toContain("data-waiting");
    expect(renderToStaticMarkup(<CallChip status="running" waiting />)).toContain(
      'data-waiting="true"',
    );
  });

  test("done draws only the check: no chip frame, fill or label; the stroke is drawn only on a change", () => {
    const html = renderToStaticMarkup(<CallChip status="done" />);
    expect(html).toContain('data-status="done"');
    expect(html).toContain('class="call-chip-done"');
    expect(html).toContain("call-chip-check");
    expect(html).not.toContain('class="call-chip"');
    expect(html).not.toContain("call-chip-fill");
    expect(html).not.toContain("call-chip-label");
    expect(html).not.toContain('data-draw="true"');
    expect(renderToStaticMarkup(<CallChip status="done" changed />)).toContain('data-draw="true"');
  });

  test("failed defaults to the danger tone and keeps a given tone; other states ignore the tone", () => {
    expect(renderToStaticMarkup(<CallChip status="failed" label="Failed" />)).toContain(
      'data-tone="danger"',
    );
    expect(
      renderToStaticMarkup(<CallChip status="failed" tone="warning" label="Denied" />),
    ).toContain('data-tone="warning"');
    expect(renderToStaticMarkup(<CallChip status="done" tone="warning" />)).toContain(
      'data-tone="neutral"',
    );
  });

  test("the chip is hidden from assistive tech (the caustic pill keeps the text)", () => {
    expect(renderToStaticMarkup(<CallChip status="done" />)).toContain('aria-hidden="true"');
  });
});
