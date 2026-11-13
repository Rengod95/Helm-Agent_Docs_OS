// 앱 확대 환산(DP-171·DP-173). 앱 확대는 `<html>`의 CSS `zoom`이다(views/appearance-prefs.ts).
// `getBoundingClientRect`·`clientX/Y`·`innerWidth/Height`는 확대가 곱해진 화면 px을 주고, 요소의 `style`(width·height·transform·CSS 변수)에 쓴 px은
// 확대가 한 번 더 곱해진다. 화면 px로 잰 값을 style에 쓸 때는 그 요소의 확대로 나눈다. `offsetHeight`·`scrollHeight`·ResizeObserver는 이미 CSS px이라 나누지 않는다.

/** 요소 자리의 실효 CSS 확대. 확대를 모르는 브라우저(시험의 흉내 창 포함)나 틀린 값이면 1 */
export function cssZoomOf(el: { readonly currentCSSZoom?: number }): number {
  const zoom = el.currentCSSZoom;
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** 화면 px을 확대 `zoom` 아래의 CSS px로 옮긴다. 틀린 확대 값이면 그대로 둔다 */
export function cssPxOf(screenPx: number, zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? screenPx / zoom : screenPx;
}
