/**
 * 파일 가져오기 단일 진입점 — 패널과 지도 박스 드롭이 같이 사용
 *  GeoJSON / SHP(zip·낱개) / GeoPackage / DXF → 좌표계 판별 → WGS84 재투영 → LayerInput
 *
 * 실제 처리(importCore.ts)는 웹 워커에서 실행해 UI 스레드를 막지 않는다 (D-0xx).
 * 워커를 만들 수 없는 환경이면 메인 스레드에서 같은 코드를 실행한다.
 *
 * 좌표계 판별 우선순위 (D-019): 수동 지정 > .prj/GPKG srs/crs 멤버 > 경위도 범위 추정 > 에러
 */
import type { ImportOptions, ImportResult } from "@/lib/importTypes";
import type { WorkerMessage, WorkerRequest } from "@/workers/import.worker";

export type { ImportedLayer, ImportOptions, ImportProgress, ImportResult } from "@/lib/importTypes";
export { HARD_FILE_BYTES, SOFT_FILE_BYTES, WARN_VERTICES } from "@/lib/importTypes";
export { countVertices, simplifyForBudget, type SimplifyResult } from "@/lib/simplify";

export const ACCEPT_ATTR =
  ".geojson,.json,.zip,.shp,.dbf,.prj,.cpg,.shx,.gpkg,.dxf,application/geo+json,application/json,application/zip,application/geopackage+sqlite3";

const abortError = () => new DOMException("가져오기가 취소되었습니다.", "AbortError");

async function runOnMainThread(files: File[], crsOverride: string | null, opts: ImportOptions): Promise<ImportResult> {
  const { importFilesCore } = await import("@/lib/importCore");
  return importFilesCore(files, crsOverride, { onProgress: opts.onProgress, dxf: opts.dxf, aborted: () => !!opts.signal?.aborted });
}

/** 여러 파일 한꺼번에 처리 (zip, 낱개 shp 묶음, geojson, gpkg, dxf 섞여 있어도 됨) */
export async function importFiles(input: FileList | File[], crsOverride: string | null = null, opts: ImportOptions = {}): Promise<ImportResult> {
  const files = Array.from(input);
  if (opts.signal?.aborted) throw abortError();

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("../workers/import.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null; // 워커 생성 불가(CSP 등) → 메인 스레드 실행
  }
  if (!worker) return runOnMainThread(files, crsOverride, opts);

  const w = worker;
  return new Promise<ImportResult>((resolve, reject) => {
    let ready = false;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", onAbort);
      w.terminate();
      fn();
    };
    const onAbort = () => done(() => reject(abortError()));
    opts.signal?.addEventListener("abort", onAbort);

    w.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      if (m.type === "ready") ready = true;
      else if (m.type === "progress") opts.onProgress?.(m.p);
      else if (m.type === "result") done(() => resolve(m.result));
      else if (m.type === "error") done(() => reject(new Error(m.message)));
    };
    w.onerror = (ev) => {
      ev.preventDefault();
      if (!ready) {
        // 워커 스크립트 로드 자체가 실패 → 메인 스레드로 폴백
        done(() => runOnMainThread(files, crsOverride, opts).then(resolve, reject));
      } else {
        done(() => reject(new Error(ev.message || "가져오기 워커 오류")));
      }
    };
    // 결과/메시지 역직렬화 실패(너무 큰 구조화 복제 등) → 영원히 대기하지 않고 거부
    w.onmessageerror = () => done(() => reject(new Error("가져오기 워커 응답을 읽지 못했습니다. (결과가 너무 크거나 메모리가 부족할 수 있습니다)")));
    const req: WorkerRequest = { files, crsOverride, dxf: opts.dxf };
    try {
      w.postMessage(req);
    } catch {
      done(() => runOnMainThread(files, crsOverride, opts).then(resolve, reject));
    }
  });
}
