// P-12 도구와 웹 목업 진입점. ?state=S1..S5, ?theme=dark.
import "./mockup.css";
import { mountSettingsPage } from "../_settings/mount";
import { App, STATES } from "./app";

mountSettingsPage(STATES, (state) => <App state={state} />);
