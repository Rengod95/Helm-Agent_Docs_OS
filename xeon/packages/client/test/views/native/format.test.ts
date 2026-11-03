import { describe, expect, test } from "bun:test";
import { formatValue } from "../../../src/views/native/format.ts";

// 2026-11-03T00:00:00Z
const NOW = Date.UTC(2026, 10, 3, 0, 0, 0);

describe("duration", () => {
  test("milliseconds under one second", () => {
    expect(formatValue("duration", 0, "en-US", NOW)).toEqual("0ms");
    expect(formatValue("duration", 500, "en-US", NOW)).toEqual("500ms");
    expect(formatValue("duration", 999.6, "en-US", NOW)).toEqual("1s");
  });

  test("under a minute, one decimal with trailing zero trimmed", () => {
    expect(formatValue("duration", 1500, "en-US", NOW)).toEqual("1.5s");
    expect(formatValue("duration", 2000, "en-US", NOW)).toEqual("2s");
    expect(formatValue("duration", 59400, "en-US", NOW)).toEqual("59.4s");
  });

  test("minutes and seconds, omitting zero seconds", () => {
    expect(formatValue("duration", 59960, "en-US", NOW)).toEqual("1m");
    expect(formatValue("duration", 120000, "en-US", NOW)).toEqual("2m");
    expect(formatValue("duration", 123000, "en-US", NOW)).toEqual("2m 3s");
  });

  test("hours and minutes, omitting zero minutes", () => {
    expect(formatValue("duration", 3599600, "en-US", NOW)).toEqual("1h");
    expect(formatValue("duration", 3600000, "en-US", NOW)).toEqual("1h");
    expect(formatValue("duration", 3900000, "en-US", NOW)).toEqual("1h 5m");
  });

  test("rejects negative, non-finite and non-number values", () => {
    expect(formatValue("duration", -1, "en-US", NOW)).toBeUndefined();
    expect(formatValue("duration", Number.NaN, "en-US", NOW)).toBeUndefined();
    expect(formatValue("duration", Number.POSITIVE_INFINITY, "en-US", NOW)).toBeUndefined();
    expect(formatValue("duration", "1500", "en-US", NOW)).toBeUndefined();
  });
});

describe("bytes", () => {
  test("bytes below one KiB", () => {
    expect(formatValue("bytes", 0, "en-US", NOW)).toEqual("0 B");
    expect(formatValue("bytes", 512, "en-US", NOW)).toEqual("512 B");
  });

  test("binary units with one decimal, trimmed", () => {
    expect(formatValue("bytes", 1024, "en-US", NOW)).toEqual("1 KiB");
    expect(formatValue("bytes", 1536, "en-US", NOW)).toEqual("1.5 KiB");
    expect(formatValue("bytes", 2097152, "en-US", NOW)).toEqual("2 MiB");
    expect(formatValue("bytes", 3221225472, "en-US", NOW)).toEqual("3 GiB");
    expect(formatValue("bytes", 1099511627776, "en-US", NOW)).toEqual("1 TiB");
  });

  test("moves to the next unit when rounding would print 1024", () => {
    expect(formatValue("bytes", 1048575, "en-US", NOW)).toEqual("1 MiB");
  });

  test("rejects negative, non-finite and non-number values", () => {
    expect(formatValue("bytes", -1, "en-US", NOW)).toBeUndefined();
    expect(formatValue("bytes", Number.NaN, "en-US", NOW)).toBeUndefined();
    expect(formatValue("bytes", "512", "en-US", NOW)).toBeUndefined();
  });
});

describe("relativeTime", () => {
  test("picks the largest fitting unit, in English", () => {
    expect(formatValue("relativeTime", NOW - 90_000, "en-US", NOW)).toEqual("1 minute ago");
    expect(formatValue("relativeTime", NOW - 86_400_000, "en-US", NOW)).toEqual("yesterday");
    expect(formatValue("relativeTime", NOW - 2 * 86_400_000, "en-US", NOW)).toEqual("2 days ago");
    expect(formatValue("relativeTime", NOW + 3 * 3_600_000, "en-US", NOW)).toEqual("in 3 hours");
  });

  test("under one second is now", () => {
    expect(formatValue("relativeTime", NOW, "en-US", NOW)).toEqual("now");
    expect(formatValue("relativeTime", NOW - 500, "en-US", NOW)).toEqual("now");
  });

  test("the same phrases in Korean", () => {
    expect(formatValue("relativeTime", NOW - 86_400_000, "ko-KR", NOW)).toEqual("어제");
    expect(formatValue("relativeTime", NOW - 2 * 86_400_000, "ko-KR", NOW)).toEqual("그저께");
    expect(formatValue("relativeTime", NOW - 90_000, "ko-KR", NOW)).toEqual("1분 전");
    expect(formatValue("relativeTime", NOW, "ko-KR", NOW)).toEqual("지금");
  });

  test("accepts an ISO string with a zone or a date-only string", () => {
    expect(formatValue("relativeTime", "2026-10-24T00:00:00Z", "en-US", NOW)).toEqual(
      "10 days ago",
    );
    expect(formatValue("relativeTime", "2026-11-01", "en-US", NOW)).toEqual("2 days ago");
    expect(formatValue("relativeTime", "2026-11-03T02:00:00+02:00", "en-US", NOW)).toEqual("now");
  });

  test("rejects a time string without a zone, a non-date string and a non-finite number", () => {
    expect(formatValue("relativeTime", "2026-11-03T00:00:00", "en-US", NOW)).toBeUndefined();
    expect(formatValue("relativeTime", "not a date", "en-US", NOW)).toBeUndefined();
    expect(formatValue("relativeTime", Number.NaN, "en-US", NOW)).toBeUndefined();
    expect(formatValue("relativeTime", NOW, "en-US", Number.NaN)).toBeUndefined();
  });
});

describe("number", () => {
  test("groups digits by locale", () => {
    expect(formatValue("number", 1234567, "en-US", NOW)).toEqual("1,234,567");
    expect(formatValue("number", 1234567, "ko-KR", NOW)).toEqual("1,234,567");
    expect(formatValue("number", 1234.5, "en-US", NOW)).toEqual("1,234.5");
    expect(formatValue("number", 1234.5, "ko-KR", NOW)).toEqual("1,234.5");
    expect(formatValue("number", 1234.5, "de-DE", NOW)).toEqual("1.234,5");
  });

  test("rejects non-finite and non-number values", () => {
    expect(formatValue("number", Number.POSITIVE_INFINITY, "en-US", NOW)).toBeUndefined();
    expect(formatValue("number", Number.NaN, "en-US", NOW)).toBeUndefined();
    expect(formatValue("number", "12", "en-US", NOW)).toBeUndefined();
  });
});

describe("percent", () => {
  test("a ratio from 0 to 1 as a whole percent", () => {
    expect(formatValue("percent", 0, "en-US", NOW)).toEqual("0%");
    expect(formatValue("percent", 0.5, "en-US", NOW)).toEqual("50%");
    expect(formatValue("percent", 0.123, "en-US", NOW)).toEqual("12%");
    expect(formatValue("percent", 1, "en-US", NOW)).toEqual("100%");
    expect(formatValue("percent", 0.5, "ko-KR", NOW)).toEqual("50%");
    expect(formatValue("percent", 0.123, "ko-KR", NOW)).toEqual("12%");
  });

  test("rejects a value outside 0..1 and non-finite values", () => {
    expect(formatValue("percent", 1.5, "en-US", NOW)).toBeUndefined();
    expect(formatValue("percent", -0.1, "en-US", NOW)).toBeUndefined();
    expect(formatValue("percent", Number.NaN, "en-US", NOW)).toBeUndefined();
  });
});

describe("dateTime", () => {
  test("epoch milliseconds in UTC, medium date and short time", () => {
    expect(formatValue("dateTime", 0, "en-US", NOW)).toEqual("Jan 1, 1970 at 12:00 AM");
    expect(formatValue("dateTime", 0, "ko-KR", NOW)).toEqual("1970. 1. 1. 오전 12:00");
  });

  test("an ISO string is converted to UTC before formatting", () => {
    expect(formatValue("dateTime", "2026-11-03T12:30:00Z", "en-US", NOW)).toEqual(
      "Nov 3, 2026 at 12:30 PM",
    );
    expect(formatValue("dateTime", "2026-11-03T21:30:00+09:00", "en-US", NOW)).toEqual(
      "Nov 3, 2026 at 12:30 PM",
    );
    expect(formatValue("dateTime", "2026-11-03", "en-US", NOW)).toEqual("Nov 3, 2026 at 12:00 AM");
  });

  test("rejects a non-date string and a non-finite number", () => {
    expect(formatValue("dateTime", "soon", "en-US", NOW)).toBeUndefined();
    expect(formatValue("dateTime", Number.NaN, "en-US", NOW)).toBeUndefined();
    expect(formatValue("dateTime", 8.64e15 + 1, "en-US", NOW)).toBeUndefined();
  });
});

describe("locale failures never throw", () => {
  test("an unusable locale yields undefined for every Intl-backed format", () => {
    expect(formatValue("number", 1, "not_a_locale!!", NOW)).toBeUndefined();
    expect(formatValue("percent", 0.5, "not_a_locale!!", NOW)).toBeUndefined();
    expect(formatValue("relativeTime", NOW, "not_a_locale!!", NOW)).toBeUndefined();
    expect(formatValue("dateTime", 0, "not_a_locale!!", NOW)).toBeUndefined();
  });

  test("duration and bytes do not depend on the locale", () => {
    expect(formatValue("duration", 1500, "not_a_locale!!", NOW)).toEqual("1.5s");
    expect(formatValue("bytes", 1536, "not_a_locale!!", NOW)).toEqual("1.5 KiB");
  });
});
