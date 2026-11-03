//! 실제 Tauri 창 안에서 `fresnel-view://` 프레임이 IPC에 닿는지 확인하는 실기 시험(ADR-0021 §3.6.2, 미결 1).
//!
//! 진짜 `tauri.conf.json`과 capability, 진짜 `view_scheme.rs`를 쓴다. 바뀐 점은 둘뿐이다: 화면 자원이 시험 페이지이고, 창 CSP를 끈다
//! (프레임 결과를 `fresnel-probe://` 이미지 요청으로 받으려고. 프레임 문서의 CSP는 `view_scheme`이 헤더로 붙이는 그대로다).
//!
//! 흐름: 메인 페이지가 진짜 invoke 키로 `app_roots_set`을 불러 프레임 root를 등록한다(양성 대조) → sandbox iframe을 `fresnel-view://`로 띄운다 →
//! 프레임이 `window.ipc`, `webkit.messageHandlers.ipc`, `__TAURI_INTERNALS__`를 살피고 키 없이 `app_roots_set`을 흉내 낸다 → 결과를 부모에 보낸다.
//! 시험은 (1) 대조 호출이 됐는지, (2) 프레임에 `__TAURI__`/`__TAURI_INTERNALS__`/부모 키가 없는지, (3) 흉내 낸 호출이 root 목록을 바꾸지 못했는지를 확인한다.
//! 존재만 하는 것(`window.ipc` 등)은 사실로 출력한다. 창을 띄울 수 없는 환경(GUI 세션 없음)은 90초 뒤 종료코드 2다.

#[path = "../src/view_scheme.rs"]
#[allow(dead_code)]
mod view_scheme;

use std::borrow::Cow;
use std::fs;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

const FRAME_HTML: &str = "<!doctype html><meta charset=utf-8><script src=\"frame.js\"></script>";

const FRAME_JS: &str = r#"
const out = {};
const safe = (f) => { try { return String(f()); } catch (e) { return "throws:" + e.name; } };
out.hasTauri = safe(() => typeof window.__TAURI__);
out.hasInternals = safe(() => typeof window.__TAURI_INTERNALS__);
out.hasKey = safe(() => typeof window.__TAURI_INVOKE_KEY__);
out.hasIpc = safe(() => typeof (window.ipc && window.ipc.postMessage));
out.hasWebkitHandler = safe(() => typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc));
out.parentKey = safe(() => typeof window.parent.__TAURI_INVOKE_KEY__);
out.parentInternals = safe(() => typeof window.parent.__TAURI_INTERNALS__);
out.origin = safe(() => location.origin);
out.windowOrigin = safe(() => window.origin);
out.localStorage = safe(() => { void localStorage.length; return "readable"; });
out.cookie = safe(() => "len:" + document.cookie.length);
const forged = JSON.stringify({ cmd: "app_roots_set", callback: 1, error: 2, options: {}, payload: { entries: [] }, __TAURI_INVOKE_KEY__: "guess" });
out.forgedPostMessage = safe(() => { window.ipc.postMessage(forged); return "sent"; });
out.forgedWebkit = safe(() => { window.webkit.messageHandlers.ipc.postMessage(forged); return "sent"; });
out.forgedFetch = "pending";
fetch("ipc://localhost/app_roots_set", { method: "POST", body: "{\"entries\":[]}", headers: { "Tauri-Invoke-Key": "guess" } })
  .then((r) => { out.forgedFetch = "status:" + r.status; }, (e) => { out.forgedFetch = "rejected:" + e.name; })
  .finally(() => setTimeout(() => parent.postMessage({ probe: out }, "*"), 800));
"#;

fn host_page(root: &str) -> String {
    let root_json = serde_json::to_string(root).unwrap();
    format!(
        r#"<!doctype html><meta charset=utf-8><body><script>
const report = (obj) => {{ new Image().src = "fresnel-probe://localhost/report?d=" + encodeURIComponent(JSON.stringify(obj)); }};
(async () => {{
  const result = {{}};
  try {{
    await window.__TAURI_INTERNALS__.invoke("app_roots_set", {{ entries: [{{ extension: "probe", version: "1.0.0", root: {root_json}, entry: "index.html", trust: "user" }}] }});
    result.control = "ok";
  }} catch (e) {{ result.control = "error:" + String(e); }}
  report({{ stage: "control", result }});
  if (result.control !== "ok") return;
  window.addEventListener("message", (event) => {{ if (event.data && event.data.probe) report({{ stage: "frame", probe: event.data.probe }}); }});
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.src = "fresnel-view://probe/1.0.0/index.html";
  document.body.append(frame);
}})();
</script>"#
    )
}

struct ProbeAssets {
    page: String,
}

impl<R: Runtime> tauri::Assets<R> for ProbeAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let path: &str = key.as_ref();
        (path == "/probe.html" || path == "/index.html")
            .then(|| Cow::Borrowed(self.page.as_bytes()))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() + 0 {
            if let Ok(v) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn main() {
    let work = std::env::temp_dir().join(format!("fresnel-ipc-probe-{}", std::process::id()));
    let ui = work.join("extensions/probe/ui");
    fs::create_dir_all(&ui).unwrap();
    fs::write(ui.join("index.html"), FRAME_HTML).unwrap();
    fs::write(ui.join("frame.js"), FRAME_JS).unwrap();
    let root = fs::canonicalize(&ui).unwrap();

    let (tx, rx) = mpsc::channel::<serde_json::Value>();
    let tx = Arc::new(Mutex::new(tx));
    let roots = Arc::new(view_scheme::AppRoots::default());

    let mut context = tauri::generate_context!();
    context.config_mut().app.security.csp = None;
    context.config_mut().app.windows.clear();
    context.set_assets(Box::new(ProbeAssets {
        page: host_page(&root.to_string_lossy()),
    }));

    let roots_for_scheme = roots.clone();
    let roots_for_state = roots.clone();
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol(view_scheme::SCHEME, move |_ctx, request| {
            view_scheme::respond(
                &roots_for_scheme,
                request.method().as_str(),
                &request.uri().to_string(),
            )
        })
        .register_uri_scheme_protocol("fresnel-probe", move |_ctx, request| {
            if let Some(query) = request.uri().query() {
                if let Some(data) = query.strip_prefix("d=") {
                    if let Ok(value) = serde_json::from_str(&percent_decode(data)) {
                        let _ = tx.lock().unwrap().send(value);
                    }
                }
            }
            tauri::http::Response::new(Cow::Borrowed(&[][..]))
        })
        .invoke_handler(tauri::generate_handler![view_scheme::app_roots_set])
        .setup(move |app| {
            app.manage(roots_for_state.clone());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("probe.html".into()))
                .title("ipc probe")
                .build()?;
            Ok(())
        })
        .build(context)
        .expect("tauri app builds");

    let handle = app.handle().clone();
    let sentinel = "fresnel-view://probe/1.0.0/index.html".to_string();
    std::thread::spawn(move || {
        let finish = |code: i32, message: &str| -> ! {
            println!("{message}");
            let _ = fs::remove_dir_all(&work);
            handle.exit(code);
            std::process::exit(code);
        };
        let wait = |stage: &str| -> serde_json::Value {
            loop {
                match rx.recv_timeout(Duration::from_secs(90)) {
                    Ok(value) if value["stage"] == stage => return value,
                    Ok(_) => continue,
                    Err(_) => finish(2, &format!("environment: no '{stage}' report in 90 s (no GUI session or the window did not load)")),
                }
            }
        };
        let control = wait("control");
        if control["result"]["control"] != "ok" {
            finish(
                1,
                &format!(
                    "FAIL positive control: the main page could not call app_roots_set: {control}"
                ),
            );
        }
        let frame = wait("frame");
        let probe = &frame["probe"];
        println!("probe facts: {probe}");
        let mut failures = Vec::new();
        for key in [
            "hasTauri",
            "hasInternals",
            "hasKey",
            "parentKey",
            "parentInternals",
        ] {
            let value = probe[key].as_str().unwrap_or("missing");
            if value != "undefined" && !value.starts_with("throws:") {
                failures.push(format!("{key} = {value}"));
            }
        }
        // sandbox가 걸린 프레임은 불투명 origin이라 저장소와 쿠키를 읽지 못한다(WKWebView는 location.origin에 스킴 origin을 보이므로 그 글은 보지 않는다)
        for key in ["localStorage"] {
            if probe[key].as_str() != Some("throws:SecurityError") {
                failures.push(format!(
                    "{key} = {} (expected a SecurityError: opaque origin)",
                    probe[key]
                ));
            }
        }
        let still = view_scheme::resolve(&roots, &sentinel);
        // WKWebView는 불투명 origin에서도 `document.cookie`를 던지지 않고 빈 글을 준다. 앱 쿠키는 보이지 않아야 한다
        if probe["cookie"].as_str() != Some("len:0") {
            failures.push(format!(
                "cookie = {} (expected an empty cookie string)",
                probe["cookie"]
            ));
        }
        if probe["windowOrigin"].as_str() != Some("null") {
            failures.push(format!(
                "window.origin = {} (expected the opaque \"null\")",
                probe["windowOrigin"]
            ));
        }
        if still.is_err() {
            failures.push("a forged IPC call from the frame changed the app root list".to_string());
        }
        if failures.is_empty() {
            finish(
                0,
                "PASS: the frame cannot reach Tauri IPC without the invoke key",
            );
        }
        finish(1, &format!("FAIL: {}", failures.join("; ")));
    });
    app.run(|_, _| {});
}
