/**
 * 가져오기 웹 워커 — 무거운 파싱·재투영을 메인 스레드 밖에서 (D-0xx)
 * 입력 File 은 structured clone 으로 넘어온다(Blob 핸들이라 복사 없음). 결과는 JSON 객체라 clone 한다.
 */
import { importFilesCore } from "@/lib/importCore";
import type { ImportProgress, ImportResult } from "@/lib/importTypes";
import type { DxfOptions } from "@/lib/dxf";

export type WorkerRequest = { files: File[]; crsOverride: string | null; dxf?: DxfOptions };
export type WorkerMessage =
  | { type: "ready" }
  | { type: "progress"; p: ImportProgress }
  | { type: "result"; result: ImportResult }
  | { type: "error"; message: string };

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (m: WorkerMessage) => void;
};

ctx.onmessage = async (ev) => {
  const { files, crsOverride, dxf } = ev.data;
  try {
    const result = await importFilesCore(files, crsOverride, { dxf, onProgress: (p) => ctx.postMessage({ type: "progress", p }) });
    ctx.postMessage({ type: "result", result });
  } catch (e) {
    ctx.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

ctx.postMessage({ type: "ready" });
