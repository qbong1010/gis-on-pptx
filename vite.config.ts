import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getHttpsServerOptions } from "office-addin-dev-certs";

/**
 * 프록시 응답에서 hop-by-hop 헤더 제거 (D-027)
 * dev 서버는 HTTPS = HTTP/2 로 동작하는데, VWorld 응답에는 `connection: Upgrade, close`, `upgrade: h2,h2c`,
 * `transfer-encoding` 같은 HTTP/1.1 전용 헤더가 붙어 온다. 이걸 그대로 넘기면 브라우저(Chromium/WebView2)가
 * HTTP/2 규약 위반으로 판단해 ERR_HTTP2_PROTOCOL_ERROR 로 타일을 전부 버린다.
 */
const HOP_BY_HOP = ["connection", "upgrade", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripHopByHop(proxy: any) {
  proxy.on("proxyRes", (res: { headers: Record<string, unknown> }) => {
    for (const h of HOP_BY_HOP) delete res.headers[h];
    delete res.headers["set-cookie"]; // 타일에 세션 쿠키 불필요
  });
}

// Office 애드인은 반드시 HTTPS 로 서빙해야 한다. (최초 1회: npm run certs)
export default defineConfig(async ({ command }) => {
  // SLIDEMAP_NO_HTTPS=1 : 자동 테스트용 (Office 에서는 반드시 HTTPS)
  const https = command === "serve" && !process.env.SLIDEMAP_NO_HTTPS ? await getHttpsServerOptions() : undefined;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    server: {
      port: 3000,
      strictPort: true, // manifest 의 포트(3000)와 반드시 일치
      https,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      /**
       * 배경지도 타일 동일 출처 프록시 (D-025)
       * 타일을 같은 오리진에서 받아야 캔버스로 합성(Bake 시 배경지도 캡처)할 수 있다.
       */
      proxy: {
        "/tiles/vworld": {
          target: "https://api.vworld.kr",
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/tiles\/vworld/, "/req/wmts/1.0.0"),
          headers: { Referer: "https://localhost:3000/" },
          configure: stripHopByHop,
        },
        "/tiles/osm": {
          target: "https://tile.openstreetmap.org",
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/tiles\/osm/, ""),
          headers: { "User-Agent": "SlideMap-dev/0.1 (PowerPoint add-in prototype)" },
          configure: stripHopByHop,
        },
        "/tiles/carto": {
          target: "https://a.basemaps.cartocdn.com",
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/tiles\/carto/, ""),
          headers: { "User-Agent": "SlideMap-dev/0.1 (PowerPoint add-in prototype)" },
          configure: stripHopByHop,
        },
      },
    },
    preview: {
      port: 3000,
      strictPort: true,
      https,
    },
    build: {
      outDir: "dist",
      sourcemap: false, // 배포 번들에 소스 노출 방지 (M11)
      rolldownOptions: {
        input: {
          taskpane: path.resolve(import.meta.dirname, "taskpane.html"), // 우측 패널 (TaskPaneApp)
          commands: path.resolve(import.meta.dirname, "commands.html"), // 리본 FunctionFile
        },
      },
    },
  };
});
