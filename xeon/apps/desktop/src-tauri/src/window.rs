//! 창 조작. 두 번째 실행과 macOS Dock 클릭이 메인 창을 다시 여는 일(G2-09, L4.desktop.spec §5, §6)이 쓴다.

use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};

/// 메인 창의 레이블. `tauri.conf.json`의 `app.windows[0].label`과 같다.
pub const MAIN_LABEL: &str = "main";

/// 메인 창을 보이고(숨겨져 있었다면), 최소화를 풀고, 포커스를 준다. 창이 없으면 `false`다.
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

/// 메인 창이 없으면 `tauri.conf.json`의 `main` 항목으로 다시 만든 뒤 앞으로 가져온다.
/// 트레이 유지 모드에서 창을 닫은 뒤 다시 여는 길이다. 두 번째 실행과 macOS `RunEvent::Reopen`이 부른다.
/// 창이 있거나 만들었으면 `true`, 설정에 `main` 항목이 없거나 만들지 못했으면 `false`다.
pub fn ensure_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    if app.get_webview_window(MAIN_LABEL).is_none() {
        let Some(config) = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == MAIN_LABEL)
        else {
            return false;
        };
        if WebviewWindowBuilder::from_config(app, config)
            .and_then(|builder| builder.build())
            .is_err()
        {
            return false;
        }
    }
    focus_main(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::utils::config::WindowConfig;

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

    #[test]
    fn ensure_main_recreates_the_main_window_from_the_config_entry_once() {
        let mut context = mock_context(noop_assets());
        context.config_mut().app.windows = vec![WindowConfig {
            label: MAIN_LABEL.into(),
            ..Default::default()
        }];
        let app = mock_builder().build(context).unwrap();
        assert!(app.get_webview_window(MAIN_LABEL).is_none());
        assert!(ensure_main(app.handle()));
        assert!(app.get_webview_window(MAIN_LABEL).is_some());
        assert!(
            ensure_main(app.handle()),
            "an open window is focused, not duplicated"
        );
        assert_eq!(app.webview_windows().len(), 1);
    }

    #[test]
    fn ensure_main_without_a_main_entry_in_the_config_creates_nothing() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        assert!(!ensure_main(app.handle()));
        assert!(app.get_webview_window(MAIN_LABEL).is_none());
    }
}
