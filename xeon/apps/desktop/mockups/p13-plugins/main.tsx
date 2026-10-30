// P-13 플러그인과 그룹 목업 진입점. ?state=S1..S7, ?theme=dark.
import "./mockup.css";
import { mountSettingsPage } from "../_settings/mount";
import { App, STATES } from "./app";

mountSettingsPage(STATES, (state) => <App state={state} />);
