import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getHttpsServerOptions } from "office-addin-dev-certs";

/**
 * 패널(TaskPane) ↔ 지도 박스(ContentApp) 메시지 중계 (D-024)
 * PowerPoint 에서 두 애드인의 웹뷰 저장소가 분리되어 BroadcastChannel/localStorage 가 통하지 않으므로,
 * 둘 다 이미 접속해 있는 dev 서버 웹소켓(HMR 채널)으로 메시지를 중계한다.
 */
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

function slideMapRelay(): Plugin {
  return {
    name: "slide-map-relay",
    apply: "serve",
    configureServer(server) {
      server.ws.on("slide-map:bus", (data: unknown) => {
        server.ws.send("slide-map:bus", data as Record<string, unknown>);
      });
    },
  };
}

// Office 애드인은 반드시 HTTPS 로 서빙해야 한다. (최초 1회: npm run certs)
export default defineConfig(async ({ command }) => {
  // SLIDEMAP_NO_HTTPS=1 : 자동 테스트용 (Office 에서는 반드시 HTTPS)
  const https = command === "serve" && !process.env.SLIDEMAP_NO_HTTPS ? await getHttpsServerOptions() : undefined;

  return {
    plugins: [react(), tailwindcss(), slideMapRelay()],
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
      sourcemap: true,
      rolldownOptions: {
        input: {
          map: path.resolve(import.meta.dirname, "index.html"), // 지도 박스 (ContentApp)
          taskpane: path.resolve(import.meta.dirname, "taskpane.html"), // 우측 패널 (TaskPaneApp)
          commands: path.resolve(import.meta.dirname, "commands.html"), // 리본 FunctionFile
        },
      },
    },
  };
});
