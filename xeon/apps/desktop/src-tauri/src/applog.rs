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
