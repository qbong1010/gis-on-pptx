import type { Msg } from "./protocol";
import { lsKey, uid } from "./util";

/**
 * 패널(TaskPane) ↔ 지도(ContentApp) 메시지 버스.
 *
 * 세 경로로 동시에 보내고 id 로 중복 제거한다.
 *  1) dev 서버 웹소켓 중계 (import.meta.hot, D-024) — PowerPoint 에서 실제로 동작하는 주 경로
 *  2) BroadcastChannel — 같은 브라우저(개발용 크롬 탭)끼리
 *  3) localStorage 'storage' 이벤트 — 폴백
 * PowerPoint 에서는 두 애드인의 웹뷰 저장소가 분리되어 2)·3)이 통하지 않음 (D-012 대체).
 */

const CHANNEL = "slide-map-v1";
const BUS_KEY = "bus";

type Envelope = { id: string; from: string; msg: Msg };

export type Bus = { send: (msg: Msg) => void; close: () => void };

export function createBus(selfId: string, onMsg: (msg: Msg) => void): Bus {
  const seen = new Set<string>();

  const deliver = (env: Envelope | null | undefined) => {
    if (!env || env.from === selfId || seen.has(env.id)) return;
    seen.add(env.id);
    if (seen.size > 500) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
    onMsg(env.msg);
  };

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => deliver(e.data as Envelope);
  } catch {
    bc = null;
  }

  // 1) dev 서버 웹소켓 중계
  const hot = import.meta.hot;
  const onHot = (data: Envelope) => deliver(data);
  hot?.on("slide-map:bus", onHot);

  const key = lsKey(BUS_KEY);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== key || !e.newValue) return;
    try {
      deliver(JSON.parse(e.newValue) as Envelope);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);

  return {
    send(msg) {
      const env: Envelope = { id: uid(), from: selfId, msg };
      try {
        hot?.send("slide-map:bus", env);
      } catch {
        /* ignore */
      }
      try {
        bc?.postMessage(env);
      } catch {
        /* ignore */
      }
      // localStorage 폴백은 작은 메시지만 (큰 GeoJSON/이미지는 quota 초과 + 직렬화 비용)
      if (msg.type !== "pane:cmd" || msg.cmd.kind !== "addLayers") {
        if (msg.type !== "map:bakeData") {
          try {
            localStorage.setItem(key, JSON.stringify(env));
          } catch {
            /* ignore */
          }
        }
      }
    },
    close() {
      hot?.off?.("slide-map:bus", onHot);
      bc?.close();
      window.removeEventListener("storage", onStorage);
    },
  };
}
