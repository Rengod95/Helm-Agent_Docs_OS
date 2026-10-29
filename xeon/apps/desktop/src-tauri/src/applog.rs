//! 앱 로그 파일. 줄 단위로 덧붙인다. 프레임 내용은 쓰지 않는다(L4.desktop.spec E11).
use std::fs::{self, File, OpenOptions};
use std::io::Write as _;
use std::path::Path;
use std::sync::Mutex;

use crate::time::{now_ms, rfc3339_utc};

pub struct AppLog {
    file: Mutex<Option<File>>,
}

impl AppLog {
    /// `dir/xeon-desktop.log`를 연다. 열지 못하면 표준 오류로 대신한다(로그 때문에 앱이 멈추지 않는다).
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.and_then(|dir| {
            fs::create_dir_all(dir).ok()?;
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("xeon-desktop.log"))
                .ok()
        });
        Self {
            file: Mutex::new(file),
        }
    }

    pub fn line(&self, message: &str) {
        let clean: String = message
            .chars()
            .map(|c| if c.is_control() && c != '\t' { ' ' } else { c })
            .collect();
        // 같은 줄을 `log` 크레이트로도 낸다. 디버그 빌드의 로그 플러그인(main.rs `debug_log_plugin`)이 받아 xeon-desktop-debug.log에 쓴다.
        // 등록된 logger가 없으면(릴리스 빌드) 매크로는 아무 일도 하지 않는다.
        tauri_plugin_log::log::info!(target: "xeon_desktop", "{clean}");
        let text = format!("{} {clean}\n", rfc3339_utc(now_ms()));
        let mut guard = self.file.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(file) => {
                if file.write_all(text.as_bytes()).is_err() {
                    eprint!("{text}");
                }
            }
            None => eprint!("{text}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tauri_plugin_log::log::{Level, LevelFilter, Log, Metadata, Record};

    /// 전역 logger는 프로세스에 한 번만 달 수 있다. 이 시험만 달고, 다른 시험의 기록은 표식으로 거른다.
    static CAPTURED: Mutex<Vec<(Level, String, String)>> = Mutex::new(Vec::new());

    struct Capture;

    impl Log for Capture {
        fn enabled(&self, _metadata: &Metadata) -> bool {
            true
        }

        fn log(&self, record: &Record) {
            if let Ok(mut captured) = CAPTURED.lock() {
                captured.push((
                    record.level(),
                    record.target().to_owned(),
                    record.args().to_string(),
                ));
            }
        }

        fn flush(&self) {}
    }

    static CAPTURE: Capture = Capture;

    #[test]
    fn a_line_also_goes_to_the_log_crate_at_info_with_control_characters_replaced() {
        tauri_plugin_log::log::set_logger(&CAPTURE).expect("the capture logger is set once");
        tauri_plugin_log::log::set_max_level(LevelFilter::Info);
        let applog = AppLog::open(None);
        applog.line("applog-marker: a\tb\u{1b}[31mc\nd");
        let captured = CAPTURED.lock().expect("capture lock");
        let ours: Vec<&(Level, String, String)> = captured
            .iter()
            .filter(|(_, _, text)| text.contains("applog-marker"))
            .collect();
        assert_eq!(
            ours,
            [&(
                Level::Info,
                "xeon_desktop".to_owned(),
                "applog-marker: a\tb [31mc d".to_owned()
            )]
        );
    }
}
