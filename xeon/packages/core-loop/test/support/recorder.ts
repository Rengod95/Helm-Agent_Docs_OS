import { defineManifest, type ExtensionEntry, type PointName } from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import type { FakeSession } from "./fake-session.ts";

/** 한 번 발화된 지점과 그 순간 마지막으로 커밋된 이벤트 종류 */
interface PointSighting {
  readonly point: string;
  readonly lastKind: string;
  readonly eventCount: number;
}

export interface Recorder {
  readonly unit: ExtensionUnit;
  readonly sightings: PointSighting[];
  /** 지점 이름만(같은 지점이 이어지면 하나로 줄인다) */
  order(): string[];
}

const TAP_POINTS = [
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "agent_end",
  "agent_settled",
] as const satisfies readonly PointName[];

export function createRecorder(fake: FakeSession, name = "recorder"): Recorder {
  const sightings: PointSighting[] = [];
  const see = (point: string): void => {
    const events = fake.events();
    sightings.push({ point, lastKind: events.at(-1)?.kind ?? "", eventCount: events.length });
  };
  const manifest = defineManifest({
    schemaVersion: 1,
    name,
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: [
      ...TAP_POINTS,
      "input",
      "before_agent_start",
      "message_end",
      "turn_end",
      "agent_before_settle",
    ],
    usesDrive: false,
  });
  const entry: ExtensionEntry = ({ manifest: own, scope }) => {
    scope(own.name, {}, (g) => {
      for (const point of TAP_POINTS) {
        g.on(point, () => {
          see(point);
        });
      }
      g.on("input", () => {
        see("input");
        return undefined;
      });
      g.on("before_agent_start", () => {
        see("before_agent_start");
        return undefined;
      });
      g.on("message_end", () => {
        see("message_end");
        return undefined;
      });
      g.on("turn_end", () => {
        see("turn_end");
        return undefined;
      });
      g.on("agent_before_settle", () => {
        see("agent_before_settle");
        return undefined;
      });
    });
  };
  const unit: ExtensionUnit = { manifest, entry, loadIndex: 5, builtin: false };
  return {
    unit,
    sightings,
    order: () =>
      sightings
        .map((sighting) => sighting.point)
        .filter((point, index, all) => index === 0 || all[index - 1] !== point),
  };
}
