// 앱 바탕(bg.app) 위 SegmentedControl의 홈(plugHead, AGE-76 "segmented control들이 segmented control 스럽지가 않아서").
// caustic의 홈 바탕 bg.inset은 놓인 면을 따라 한 단계 어두운 값이다. 왼쪽 패널(surface.base) 위 "대화 / 크래프트"에서는 홈이 뚜렷하지만,
// 앱 바탕 위에서는 bg.inset(다크 rgb 6)이 바탕(다크 rgb 13)과 거의 같아 홈이 사라지고 고른 칸만 떠 보였다(다크 그림 plugHead-shots/before-*).
// 그래서 앱 바탕 위에서는 홈을 neutral.track(다크 rgb 28, 라이트 rgb 229)으로 채운다. 고른 칸(control.raised, 테두리와 elevation 1), 높이, 간격은 caustic 그대로다.

/** 앱 바탕 위 SegmentedControl에 더하는 홈 바탕(caustic 토큰 neutral.track) */
export const SEGMENTED_ON_APP = "bg-neutral-track";
