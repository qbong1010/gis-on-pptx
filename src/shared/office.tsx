import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export type OfficeEnv = {
  /** PowerPoint 안이면 "PowerPoint", 일반 브라우저면 null */
  host: Office.HostType | null;
  platform: Office.PlatformType | null;
};

/** office.js 준비 후 렌더. Office 밖(일반 브라우저)에서도 동작한다. */
export function bootOffice(renderApp: (env: OfficeEnv) => ReactNode) {
  const render = (env: OfficeEnv) =>
    createRoot(document.getElementById("root")!).render(<StrictMode>{renderApp(env)}</StrictMode>);

  if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
    Office.onReady()
      .then((info) => render({ host: info.host ?? null, platform: info.platform ?? null }))
      .catch(() => render({ host: null, platform: null }));
  } else {
    console.warn("[slide-map] office.js not loaded — browser-only mode");
    render({ host: null, platform: null });
  }
}
