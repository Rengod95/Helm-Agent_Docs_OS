import type { Logger, LogFields } from "@xeon/contracts";

export interface LoggedEvent {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields | undefined;
}

export function captureLogger(): Logger & { readonly events: LoggedEvent[] } {
  const events: LoggedEvent[] = [];
  const make = (base: LogFields): Logger => {
    const record = (level: string) => (event: string, fields?: LogFields) => {
      events.push({ level, event, fields: fields === undefined ? base : { ...base, ...fields } });
    };
    return {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      child: (fields) => make({ ...base, ...fields }),
    };
  };
  return Object.assign(make({}), { events });
}
