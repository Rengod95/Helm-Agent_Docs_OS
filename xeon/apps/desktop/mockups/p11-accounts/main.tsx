// P-11 계정과 제공자·예산 목업 진입점. ?state=S1..S7, ?theme=dark.
import "./mockup.css";
import { mountSettingsPage } from "../_settings/mount";
import { App, STATES } from "./app";

mountSettingsPage(STATES, (state) => <App state={state} />);
