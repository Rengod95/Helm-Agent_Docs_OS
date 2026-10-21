import type { DurableEventEnvelope, VolatileEventEnvelope } from "@xeon/contracts/records";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 휘발 part_delta 알림의 델타 문자열 */
export function deltaTextOf(event: VolatileEventEnvelope): string {
  const payload = event.payload;
  if (!isRecord(payload) || !isRecord(payload["update"])) return "";
  const delta = payload["update"]["delta"];
  if (!isRecord(delta)) return "";
  const text = delta["delta"];
  return typeof text === "string" ? text : "";
}

export function payloadField(event: DurableEventEnvelope, key: string): unknown {
  return isRecord(event.payload) ? event.payload[key] : undefined;
}

export function kindsOf(events: readonly { readonly kind: string }[]): string[] {
  return events.map((event) => event.kind);
}

/** 같은 kind가 몇 번 나왔는가 */
export function countKind(events: readonly { readonly kind: string }[], kind: string): number {
  return events.filter((event) => event.kind === kind).length;
}

export function firstOfKind(
  events: readonly DurableEventEnvelope[],
  kind: string,
): DurableEventEnvelope | undefined {
  return events.find((event) => event.kind === kind);
}
