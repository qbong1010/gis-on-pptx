declare module "shpjs" {
  import type { Geometry } from "geojson";
  type Bin = ArrayBuffer | DataView | Uint8Array;
  /** prj 를 넘기지 않으면 원 좌표 그대로 반환 (재투영은 우리 쪽 reproject.ts 에서) */
  export function parseShp(shp: Bin, prj?: string | false): (Geometry | null)[];
  export function parseDbf(dbf: Bin, encoding?: string): Record<string, unknown>[];
  const getShapefile: (input: unknown) => Promise<unknown>;
  export default getShapefile;
}
