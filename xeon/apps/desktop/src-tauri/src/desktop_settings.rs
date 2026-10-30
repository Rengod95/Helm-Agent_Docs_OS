//! 데스크톱 설정 파일을 읽는다 (L4.desktop.spec §3.6, §4.2 1단계, §5, §6).
//!
//! 파일은 `<app_config_dir>/desktop-settings.json`이다. 키는 전체 설정 키(`l4.desktop.*`)를 쓰는 평평한 JSON 객체다.
//! 셸은 시작할 때 한 번 읽는다. 값 하나가 틀리면 그 키만 기본값을 쓰고, 파일 전체가 틀리면 모두 기본값을 쓴다.
//! 진단은 키 이름과 이유만 담는다. 다른 키의 값은 담지 않는다(E11).
//! 쓰기 명령(`desktop_settings_read/write`)은 아직 없다 [미결: M4 settings-ui / B3-SET].

use std::fs::File;
use std::io::{ErrorKind, Read};
use std::ops::RangeInclusive;
use std::path::Path;

use serde_json::{Map, Value};

/// 설정 파일 이름.
pub const FILE_NAME: &str = "desktop-settings.json";
/// 파일 읽기 상한(바이트). 이보다 큰 파일은 전체를 기본값으로 쓴다.
const MAX_FILE_BYTES: u64 = 64 * 1024;

pub const KEY_CLOSE_BEHAVIOR: &str = "l4.desktop.window.closeBehavior";
pub const KEY_SHUTDOWN_GRACE_MS: &str = "l4.desktop.engine.shutdownGraceMs";
pub const KEY_RESTART_LIMIT: &str = "l4.desktop.engine.restartLimit";

/// `l4.desktop.engine.shutdownGraceMs`의 range (spec §6). `EngineConfig::from_values`도 이 범위를 쓴다.
pub const SHUTDOWN_GRACE_MS_RANGE: RangeInclusive<i64> = 1000..=180_000;
/// `l4.desktop.engine.restartLimit`의 range (spec §6).
pub const RESTART_LIMIT_RANGE: RangeInclusive<i64> = 0..=10;

/// 창을 닫을 때의 동작 (`l4.desktop.window.closeBehavior`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CloseBehavior {
    /// 정상 종료 순서를 탄다 (§4.3). 기본값이다.
    #[default]
    Quit,
    /// WebView를 해제하고 셸과 엔진을 남긴다 (§6).
    Tray,
}

/// 셸이 시작할 때 쓰는 값. 엔진 값은 범위 안에서만 `Some`이다. 없으면 `EngineConfig`의 기본값을 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DesktopSettings {
    pub close_behavior: CloseBehavior,
    pub shutdown_grace_ms: Option<i64>,
    pub restart_limit: Option<i64>,
}

/// 설정 파일 본문을 해석한다. 진단 문장은 키 이름과 이유만 담는다.
pub fn parse(text: &str) -> (DesktopSettings, Vec<String>) {
    let mut settings = DesktopSettings::default();
    let mut diagnostics = Vec::new();
    let root: Value = match serde_json::from_str(text) {
        Ok(root) => root,
        Err(error) => {
            diagnostics.push(format!(
                "desktop settings: not valid JSON (line {}, column {}); using defaults",
                error.line(),
                error.column()
            ));
            return (settings, diagnostics);
        }
    };
    let Value::Object(map) = root else {
        diagnostics
            .push("desktop settings: the top level is not a JSON object; using defaults".into());
        return (settings, diagnostics);
    };
    if let Some(value) = map.get(KEY_CLOSE_BEHAVIOR) {
        match value.as_str() {
            Some("quit") => settings.close_behavior = CloseBehavior::Quit,
            Some("tray") => settings.close_behavior = CloseBehavior::Tray,
            _ => diagnostics.push(skipped(KEY_CLOSE_BEHAVIOR, "is not \"quit\" or \"tray\"")),
        }
    }
    settings.shutdown_grace_ms = integer_in_range(
        &map,
        KEY_SHUTDOWN_GRACE_MS,
        &SHUTDOWN_GRACE_MS_RANGE,
        &mut diagnostics,
    );
    settings.restart_limit = integer_in_range(
        &map,
        KEY_RESTART_LIMIT,
        &RESTART_LIMIT_RANGE,
        &mut diagnostics,
    );
    (settings, diagnostics)
}

/// 파일을 읽어 해석한다. 파일이 없는 것은 오류가 아니라 기본값이다. 디렉터리가 없으면 진단을 남긴다.
pub fn load(dir: Option<&Path>) -> (DesktopSettings, Vec<String>) {
    let Some(dir) = dir else {
        return (
            DesktopSettings::default(),
            vec!["desktop settings: the config directory is unavailable; using defaults".into()],
        );
    };
    let file = match File::open(dir.join(FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return (DesktopSettings::default(), Vec::new());
        }
        Err(error) => {
            return (
                DesktopSettings::default(),
                vec![format!(
                    "desktop settings: the file could not be opened ({:?}); using defaults",
                    error.kind()
                )],
            );
        }
    };
    // 상한보다 한 바이트 더 읽어 넘었는지 본다.
    let mut bytes = Vec::new();
    if let Err(error) = file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes) {
        return (
            DesktopSettings::default(),
            vec![format!(
                "desktop settings: the file could not be read ({:?}); using defaults",
                error.kind()
            )],
        );
    }
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
        return (
            DesktopSettings::default(),
            vec!["desktop settings: the file is larger than 64 KiB; using defaults".into()],
        );
    }
    match std::str::from_utf8(&bytes) {
        Ok(text) => parse(text),
        Err(_) => (
            DesktopSettings::default(),
            vec!["desktop settings: the file is not UTF-8; using defaults".into()],
        ),
    }
}

/// `RunEvent::ExitRequested`에서 종료를 막을지 정한다.
/// 막는 경우는 트레이 유지이고 창이 모두 닫혀 생긴 종료(`code`가 없음)뿐이다. 그때 WebView는 이미 없고,
/// 셸과 엔진과 진행 중 turn은 남는다. 명시 종료(코드가 있는 `app.exit`, 신호)와 `quit`은
/// `Supervisor::on_exit_requested` 경로를 그대로 탄다 (§4.3).
pub fn should_prevent_exit(behavior: CloseBehavior, code: Option<i32>) -> bool {
    behavior == CloseBehavior::Tray && code.is_none()
}

fn integer_in_range(
    map: &Map<String, Value>,
    key: &str,
    range: &RangeInclusive<i64>,
    diagnostics: &mut Vec<String>,
) -> Option<i64> {
    let value = map.get(key)?;
    match value.as_i64() {
        Some(number) if range.contains(&number) => Some(number),
        Some(_) => {
            diagnostics.push(skipped(key, "is outside its range"));
            None
        }
        None => {
            diagnostics.push(skipped(key, "is not an integer"));
            None
        }
    }
}

fn skipped(key: &str, reason: &str) -> String {
    format!("desktop settings: {key} {reason}; using the default")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    use crate::engine::EngineConfig;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xeon-desktop-settings-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the temp dir is created");
        dir
    }

    #[test]
    fn parse_reads_the_documented_flat_keys() {
        let text = r#"{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.shutdownGraceMs":5000,"l4.desktop.engine.restartLimit":2}"#;
        let (settings, diagnostics) = parse(text);
        assert_eq!(
            settings,
            DesktopSettings {
                close_behavior: CloseBehavior::Tray,
                shutdown_grace_ms: Some(5000),
                restart_limit: Some(2),
            }
        );
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    #[test]
    fn parse_accepts_the_range_bounds_and_quit() {
        let (upper, diagnostics) = parse(
            r#"{"l4.desktop.window.closeBehavior":"quit","l4.desktop.engine.shutdownGraceMs":180000,"l4.desktop.engine.restartLimit":0}"#,
        );
        assert_eq!(upper.close_behavior, CloseBehavior::Quit);
        assert_eq!(upper.shutdown_grace_ms, Some(180_000));
        assert_eq!(upper.restart_limit, Some(0));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        let (lower, diagnostics) = parse(
            r#"{"l4.desktop.engine.shutdownGraceMs":1000,"l4.desktop.engine.restartLimit":10}"#,
        );
        assert_eq!(lower.shutdown_grace_ms, Some(1000));
        assert_eq!(lower.restart_limit, Some(10));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    /// 값 하나가 틀리면 그 키만 기본값이고 진단이 하나 남는다.
    #[test]
    fn parse_skips_each_invalid_value_with_one_diagnostic_naming_its_key() {
        let invalid = [
            (KEY_CLOSE_BEHAVIOR, r#""exit""#),
            (KEY_CLOSE_BEHAVIOR, r#""Tray""#),
            (KEY_CLOSE_BEHAVIOR, "1"),
            (KEY_CLOSE_BEHAVIOR, "null"),
            (KEY_SHUTDOWN_GRACE_MS, r#""5000""#),
            (KEY_SHUTDOWN_GRACE_MS, "5000.5"),
            (KEY_SHUTDOWN_GRACE_MS, "999"),
            (KEY_SHUTDOWN_GRACE_MS, "180001"),
            (KEY_SHUTDOWN_GRACE_MS, "true"),
            (KEY_RESTART_LIMIT, "-1"),
            (KEY_RESTART_LIMIT, "11"),
            (KEY_RESTART_LIMIT, "2.0"),
            (KEY_RESTART_LIMIT, "[2]"),
        ];
        for (key, value) in invalid {
            let text = format!(r#"{{"{key}":{value}}}"#);
            let (settings, diagnostics) = parse(&text);
            assert_eq!(settings, DesktopSettings::default(), "{text}");
            assert_eq!(diagnostics.len(), 1, "{text}: {diagnostics:?}");
            assert!(diagnostics[0].contains(key), "{text}: {diagnostics:?}");
        }
    }

    #[test]
    fn an_invalid_value_does_not_drop_the_valid_ones_next_to_it() {
        let (settings, diagnostics) = parse(
            r#"{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.restartLimit":"two","l4.desktop.engine.shutdownGraceMs":6000}"#,
        );
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert_eq!(settings.restart_limit, None);
        assert_eq!(settings.shutdown_grace_ms, Some(6000));
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    }

    /// 진단은 키 이름을 담고 다른 키의 값을 담지 않는다.
    #[test]
    fn diagnostics_name_the_key_and_never_echo_a_value() {
        let (_, diagnostics) = parse(
            r#"{"l4.desktop.window.closeBehavior":"zz-marker-one","l4.desktop.engine.restartLimit":"zz-marker-two"}"#,
        );
        assert_eq!(diagnostics.len(), 2, "{diagnostics:?}");
        let joined = diagnostics.join("\n");
        assert!(joined.contains(KEY_CLOSE_BEHAVIOR), "{joined}");
        assert!(joined.contains(KEY_RESTART_LIMIT), "{joined}");
        assert!(!joined.contains("zz-marker"), "{joined}");
    }

    #[test]
    fn corrupt_json_or_a_non_object_gives_all_defaults_and_one_diagnostic() {
        for text in [
            "",
            "{",
            "not json",
            r#"{"l4.desktop.window.closeBehavior":"tray","#,
            "[1,2]",
            r#""tray""#,
        ] {
            let (settings, diagnostics) = parse(text);
            assert_eq!(settings, DesktopSettings::default(), "{text:?}");
            assert_eq!(diagnostics.len(), 1, "{text:?}: {diagnostics:?}");
        }
    }

    #[test]
    fn an_empty_object_and_unknown_keys_are_ignored_without_a_diagnostic() {
        let (settings, diagnostics) = parse("{}");
        assert_eq!(settings, DesktopSettings::default());
        assert!(diagnostics.is_empty());

        let long_key = "k".repeat(10_000);
        let text = format!(
            r#"{{"l4.desktop.appearance.theme":"dark","l4.desktop.window.other":{{"x":1}},"{long_key}":"y","l4.desktop.engine.restartLimit":4}}"#
        );
        let (settings, diagnostics) = parse(&text);
        assert_eq!(settings.restart_limit, Some(4));
        assert_eq!(settings.close_behavior, CloseBehavior::Quit);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    /// 범위 밖 숫자는 `parse`에서 걸러져 `from_values`가 기본값으로 바꾼다.
    #[test]
    fn out_of_range_numbers_fall_back_to_the_engine_defaults_through_parse() {
        let default = EngineConfig::default();
        for text in [
            r#"{"l4.desktop.engine.shutdownGraceMs":999,"l4.desktop.engine.restartLimit":11}"#,
            r#"{"l4.desktop.engine.shutdownGraceMs":180001,"l4.desktop.engine.restartLimit":-1}"#,
        ] {
            let (settings, _) = parse(text);
            let config =
                EngineConfig::from_values(settings.shutdown_grace_ms, settings.restart_limit);
            assert_eq!(config, default, "{text}");
        }
    }

    #[test]
    fn valid_values_reach_the_engine_config_through_parse() {
        let (settings, _) = parse(
            r#"{"l4.desktop.engine.shutdownGraceMs":5000,"l4.desktop.engine.restartLimit":0}"#,
        );
        let config = EngineConfig::from_values(settings.shutdown_grace_ms, settings.restart_limit);
        assert_eq!(config.shutdown_grace, Duration::from_millis(5000));
        assert_eq!(config.restart_limit, 0);
    }

    /// 종료 결정은 (동작 × 종료 코드) 모든 조합을 값으로 확인한다. `i32::MAX`는 tauri의 재시작 코드다.
    #[test]
    fn only_a_tray_close_without_an_exit_code_is_prevented() {
        let table = [
            (CloseBehavior::Quit, None, false),
            (CloseBehavior::Quit, Some(0), false),
            (CloseBehavior::Quit, Some(1), false),
            (CloseBehavior::Quit, Some(-1), false),
            (CloseBehavior::Quit, Some(i32::MAX), false),
            (CloseBehavior::Tray, None, true),
            (CloseBehavior::Tray, Some(0), false),
            (CloseBehavior::Tray, Some(1), false),
            (CloseBehavior::Tray, Some(-1), false),
            (CloseBehavior::Tray, Some(i32::MAX), false),
        ];
        for (behavior, code, expected) in table {
            assert_eq!(
                should_prevent_exit(behavior, code),
                expected,
                "{behavior:?} with {code:?}"
            );
        }
    }

    #[test]
    fn load_without_a_directory_reports_it_and_uses_defaults() {
        let (settings, diagnostics) = load(None);
        assert_eq!(settings, DesktopSettings::default());
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    }

    #[test]
    fn load_of_a_missing_directory_or_a_missing_file_is_silent() {
        let missing = std::env::temp_dir().join(format!(
            "xeon-desktop-settings-missing-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&missing);
        let (settings, diagnostics) = load(Some(&missing));
        assert_eq!(settings, DesktopSettings::default());
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        let dir = scratch_dir("no-file");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings, DesktopSettings::default());
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_reads_the_file_in_the_directory() {
        let dir = scratch_dir("read");
        std::fs::write(
            dir.join(FILE_NAME),
            r#"{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.restartLimit":1}"#,
        )
        .expect("the settings file is written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert_eq!(settings.restart_limit, Some(1));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 파일이 상한을 넘으면 앞부분이 맞아도 전체를 기본값으로 쓴다. 정확히 상한이면 읽는다.
    #[test]
    fn load_refuses_a_file_over_64_kib_and_reads_one_of_exactly_64_kib() {
        let dir = scratch_dir("cap");
        let head = r#"{"l4.desktop.engine.restartLimit":2}"#;
        let padded = |total: usize| format!("{head}{}", " ".repeat(total - head.len()));

        std::fs::write(dir.join(FILE_NAME), padded(65 * 1024)).expect("written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings, DesktopSettings::default());
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");

        std::fs::write(dir.join(FILE_NAME), padded(64 * 1024)).expect("written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings.restart_limit, Some(2));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_of_a_file_that_is_not_utf8_uses_defaults() {
        let dir = scratch_dir("utf8");
        std::fs::write(dir.join(FILE_NAME), [0xff_u8, 0xfe, 0x00]).expect("written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings, DesktopSettings::default());
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
