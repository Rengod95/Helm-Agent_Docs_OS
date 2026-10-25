//! WKWebView 뷰포트 스냅샷(macOS, 디버그 전용). `takeSnapshotWithConfiguration`으로 보이는 영역을 PNG로 저장한다.
//! 호출은 `with_webview`가 메인 스레드에서 실행하는 클로저 안에서만 한다(WKWebView는 메인 스레드 전용이다).

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use block2::RcBlock;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError};
use objc2_web_kit::WKWebView;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use crate::time::now_ms;
use crate::window::MAIN_LABEL;

/// 스냅샷 완료를 기다리는 시간.
const WAIT: Duration = Duration::from_secs(10);

type Reply = oneshot::Sender<Result<Vec<u8>, String>>;

fn png_of(image: &NSImage) -> Option<Vec<u8>> {
    let tiff = image.TIFFRepresentation()?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}

/// 메인 스레드에서 스냅샷을 요청한다. 결과는 `reply`로 한 번 돌려준다.
fn request(view: &WKWebView, reply: Reply) {
    let slot = Mutex::new(Some(reply));
    let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let Some(reply) = slot.lock().ok().and_then(|mut guard| guard.take()) else {
            return;
        };
        let outcome = match unsafe { image.as_ref() } {
            Some(image) => png_of(image).ok_or_else(|| "the snapshot could not be encoded as PNG".to_string()),
            None => Err(if error.is_null() {
                "the snapshot returned no image".to_string()
            } else {
                "the snapshot failed".to_string()
            }),
        };
        let _ = reply.send(outcome);
    });
    unsafe { view.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
}

/// 뷰포트를 `<dir>/snapshots/viewport-<ms>.png`에 저장하고 메타데이터를 돌려준다.
pub async fn take(app: &AppHandle, dir: Option<&Path>) -> Result<Value, String> {
    let dir = dir.ok_or("no log directory to write the snapshot into")?;
    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or("the main window does not exist")?;
    let (tx, rx) = oneshot::channel();
    let tx = Mutex::new(Some(tx));
    window
        .with_webview(move |webview| {
            let Some(reply) = tx.lock().ok().and_then(|mut guard| guard.take()) else {
                return;
            };
            let pointer = webview.inner();
            if pointer.is_null() {
                let _ = reply.send(Err("the webview handle is null".to_string()));
                return;
            }
            // with_webview는 메인 스레드에서 부른다. inner()는 이 창의 WKWebView다.
            let view: &WKWebView = unsafe { &*pointer.cast::<WKWebView>() };
            request(view, reply);
        })
        .map_err(|error| format!("with_webview failed: {error}"))?;
    let png = tokio::time::timeout(WAIT, rx)
        .await
        .map_err(|_| "the snapshot timed out".to_string())?
        .map_err(|_| "the snapshot was dropped".to_string())??;
    let snapshots = dir.join("snapshots");
    std::fs::create_dir_all(&snapshots).map_err(|error| format!("snapshot folder: {error}"))?;
    let path = snapshots.join(format!("viewport-{}.png", now_ms()));
    std::fs::write(&path, &png).map_err(|error| format!("snapshot write: {error}"))?;
    Ok(json!({ "path": path.display().to_string(), "bytes": png.len(), "mime": "image/png" }))
}
