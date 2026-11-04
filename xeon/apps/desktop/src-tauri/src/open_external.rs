//! 확인 줄을 거친 외부 링크를 OS 기본 브라우저로 연다(ADR-0021 §3.4 `navigate` 외부 링크, §3.6.1).
//!
//! 확인 줄은 WebView(셸 층)가 띄우고 이 명령은 그 뒤에 부른다. 그래도 이 명령은 스스로 주소를 좁힌다: `http(s)`만, 계정 정보 없이,
//! 제어 문자와 공백 없이, 길이 상한 안에서만 연다. 프레임에는 invoke 키가 주입되지 않으므로(ADR-0021 §3.6.2) 프레임이 직접 부를 수 없다.
//! 새 의존은 없다: 이미 쓰는 `tauri-plugin-shell`의 `open`을 쓴다.

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// 주소 길이 상한(TS `NavigateArgs`와 같다).
pub const MAX_HREF_BYTES: usize = 2048;

/// 열어도 되는 주소인가. TS `normalizeExternalLink`의 거부 조건을 한 번 더 건다.
pub fn href_allowed(href: &str) -> bool {
    if href.is_empty() || href.len() > MAX_HREF_BYTES {
        return false;
    }
    if href.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let rest = if let Some(rest) = href.strip_prefix("https://") {
        rest
    } else if let Some(rest) = href.strip_prefix("http://") {
        rest
    } else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty() && !authority.contains('@')
}

#[tauri::command]
#[allow(deprecated)]
pub fn open_external(app: AppHandle, href: String) -> Result<(), String> {
    if !href_allowed(&href) {
        return Err("href_not_allowed".to_string());
    }
    app.shell()
        .open(href, None)
        .map_err(|_| "open_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_plain_http_and_https() {
        assert!(href_allowed("https://example.com/a?b=1#c"));
        assert!(href_allowed("http://example.com"));
    }

    #[test]
    fn rejects_other_schemes_credentials_and_unsafe_characters() {
        for bad in [
            "",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:a@b.c",
            "https://user:pw@example.com/",
            "https://user@example.com/",
            "https:///nohost",
            "https://example.com/a b",
            "https://example.com/\n",
            "ftp://example.com/",
        ] {
            assert!(!href_allowed(bad), "{bad:?} must be rejected");
        }
        assert!(!href_allowed(&format!("https://e.com/{}", "a".repeat(MAX_HREF_BYTES))));
    }
}
