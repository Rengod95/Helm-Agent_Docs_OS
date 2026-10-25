//! 창 조작. 두 번째 실행이 첫 창을 앞으로 가져오는 일(G2-09, L4.desktop.spec §5)이 쓴다.

use tauri::{AppHandle, Manager, Runtime};

/// 메인 창의 레이블. `tauri.conf.json`의 `app.windows[0].label`과 같다.
pub const MAIN_LABEL: &str = "main";

/// 메인 창을 보이고(숨겨져 있었다면), 최소화를 풀고, 포커스를 준다. 창이 없으면 `false`다.
/// 두 번째 실행의 알림을 받는 쪽(`tauri-plugin-single-instance`의 콜백)이 부른다.
pub fn focus_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return false;
    };
    // 어느 한 호출이 실패해도 나머지는 시도한다. 창이 이미 보이거나 최소화가 아닐 때의 오류는 무해하다.
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::WebviewWindowBuilder;

    #[test]
    fn focus_main_reports_false_without_a_main_window() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        assert!(!focus_main(app.handle()));
    }

    #[test]
    fn focus_main_finds_the_window_labelled_main_and_ignores_others() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        WebviewWindowBuilder::new(&app, "other", Default::default())
            .build()
            .unwrap();
        assert!(!focus_main(app.handle()), "only the main label counts");
        WebviewWindowBuilder::new(&app, MAIN_LABEL, Default::default())
            .build()
            .unwrap();
        assert!(focus_main(app.handle()));
    }
}
