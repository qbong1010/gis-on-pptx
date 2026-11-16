import "./index.css";
import App from "./App";
import { bootOffice } from "@/shared/office";

// 지도 박스 (PowerPoint 콘텐츠 애드인) 엔트리 — manifest.xml → index.html
bootOffice((env) => <App env={env} />);
