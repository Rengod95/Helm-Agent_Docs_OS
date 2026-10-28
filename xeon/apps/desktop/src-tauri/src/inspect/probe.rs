//! 실제 앱의 `Probe`. `state.dump`의 내용과 스냅샷 파일 위치를 정한다.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{BoxFuture, Probe};
use crate::relay::Relay;
use crate::window::MAIN_LABEL;

pub struct AppProbe {
    pub app: AppHandle,
    pub relay: Arc<Relay>,
    pub log_dir: Option<PathBuf>,
    pub started: Instant,
}

impl AppProbe {
    fn window_info(&self) -> Value {
        let Some(window) = self.app.get_webview_window(MAIN_LABEL) else {
            return Value::Null;
        };
        let size = window.inner_size().ok();
        json!({
            "label": MAIN_LABEL,
            "visible": window.is_visible().ok(),
            "focused": window.is_focused().ok(),
            "minimized": window.is_minimized().ok(),
            "scaleFactor": window.scale_factor().ok(),
            "innerSize": size.map(|s| json!({ "width": s.width, "height": s.height })),
        })
    }
}

impl Probe for AppProbe {
    fn state_dump(&self) -> Value {
        json!({
            "app": {
                "name": "xeon-desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "pid": std::process::id(),
                "uptimeMs": u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX),
                "debug": true,
            },
            // EngineState는 IPC의 상태 채널과 같은 직렬화다(ipc.ts EngineStateSchema)
            "engine": serde_json::to_value(self.relay.state()).unwrap_or(Value::Null),
            "relay": { "epoch": self.relay.current_epoch() },
            "window": self.window_info(),
            "paths": { "logDir": self.log_dir.as_ref().map(|p| p.display().to_string()) },
        })
    }

    fn viewport_snapshot(&self) -> BoxFuture<'_, Result<Value, String>> {
        #[cfg(target_os = "macos")]
        {
            let app = self.app.clone();
            let dir = self.log_dir.clone();
            return Box::pin(async move { super::snapshot_macos::take(&app, dir.as_deref()).await });
        }
        #[cfg(not(target_os = "macos"))]
        {
            Box::pin(async { Err("viewport.snapshot is supported on macOS only".to_string()) })
        }
    }
}
