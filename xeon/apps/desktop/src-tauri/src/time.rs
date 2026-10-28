//! 시각 문자열. 외부 크레이트 없이 RFC 3339 UTC(밀리초)만 만든다.
use std::time::{SystemTime, UNIX_EPOCH};

/// 현재 시각(Unix epoch 밀리초). 시계가 epoch 이전이면 0이다.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// `2026-10-24T12:34:56.789Z` 꼴(24자). `ipc.ts`의 `format: "date-time"`, `maxLength: 32`에 맞는다.
pub fn rfc3339_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let millis = ms % 1000;
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 1970-01-01부터의 일 수를 (년, 월, 일)로 바꾼다(Howard Hinnant의 civil_from_days).
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_epoch_and_known_instants() {
        assert_eq!(rfc3339_utc(0), "1970-01-01T00:00:00.000Z");
        // 2026-10-24T00:00:00Z = 1_792_800_000 s
        assert_eq!(rfc3339_utc(1_792_800_000_000), "2026-10-24T00:00:00.000Z");
        assert_eq!(rfc3339_utc(1_792_800_000_000 + 3_723_456), "2026-10-24T01:02:03.456Z");
    }

    #[test]
    fn handles_leap_day_and_year_end() {
        // 2024-02-29T23:59:59.999Z
        assert_eq!(rfc3339_utc(1_709_251_199_999), "2024-02-29T23:59:59.999Z");
        // 2025-12-31T23:59:59.000Z -> next ms boundary 2026-01-01
        assert_eq!(rfc3339_utc(1_767_225_599_000), "2025-12-31T23:59:59.000Z");
        assert_eq!(rfc3339_utc(1_767_225_600_000), "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn fits_the_schema_length_limit() {
        assert!(rfc3339_utc(u64::from(u32::MAX) * 1000).len() <= 32);
    }
}
