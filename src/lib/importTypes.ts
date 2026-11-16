/** 가져오기 공용 타입 (메인 스레드 · 워커 공유) */
import type { LayerInput } from "@/shared/protocol";
import type { DxfOptions } from "@/lib/dxf";

export type ImportedLayer = LayerInput & {
  crsLabel: string;
  warning?: string;
  encoding?: string;
  /** 총 꼭짓점(좌표) 수 */
  vertexCount?: number;
  /** GeoJSON 직렬화 대략 크기(문자 수 ≈ 바이트) */
  bytes?: number;
  /** 단순화했다면 원래 꼭짓점 수 (importFiles 는 단순화하지 않음 — 패널이 simplifyForBudget 호출 시 채운다) */
  simplifiedFrom?: number;
};
export type ImportResult = { layers: ImportedLayer[]; errors: string[]; warnings: string[] };

export type ImportProgress = { stage: string; pct?: number; file?: string };

export type ImportOptions = {
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
  dxf?: DxfOptions;
};

/** 파일 1개당 크기 한도 (이상이면 거부) / 경고 기준 */
export const HARD_FILE_BYTES = 200 * 1024 * 1024;
export const SOFT_FILE_BYTES = 30 * 1024 * 1024;
/** 꼭짓점 경고 기준 */
export const WARN_VERTICES = 300_000;
