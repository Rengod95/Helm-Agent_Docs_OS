// P-10 비밀 목업 진입점(O-05 재인증, O-06 삭제 확인은 이 화면의 상태). ?state=S1..S9, ?theme=dark.
import "./mockup.css";
import { mountSettingsPage } from "../_settings/mount";
import { App, STATES } from "./app";

mountSettingsPage(STATES, (state) => <App state={state} />);
