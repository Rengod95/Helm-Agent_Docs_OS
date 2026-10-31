// P-09 설정 목업 진입점. ?state=S1..S9, ?theme=dark. 탭은 ?tab=(옆 시안에서 왔을 때) 또는 탭 열.
import "./mockup.css";
import { mountSettingsPage } from "../_settings/mount";
import { App, STATES } from "./app";

mountSettingsPage(STATES, (state) => <App state={state} />);
