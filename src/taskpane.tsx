import "./index.css";
import PaneApp from "./pane/PaneApp";
import { bootOffice } from "@/shared/office";

// 우측 패널 (PowerPoint TaskPane 애드인) 엔트리 — manifest-taskpane.xml → taskpane.html
bootOffice((env) => <PaneApp env={env} />);
