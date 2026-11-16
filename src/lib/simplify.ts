/**
 * 큰 레이어를 문서(pptx)에 넣기 전에 꼭짓점 예산에 맞게 단순화 (D-0xx)
 *  - @turf/turf simplify(highQuality=false, Douglas-Peucker) 를 허용오차를 키워 가며 반복
 *  - 피처는 절대 지우지 않는다 (점은 그대로, 선은 양 끝 보존, 폴리곤 링은 4점 이상 유지 — turf 가 보장)
 */
import { simplify } from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";

function geomVertices(g: Geometry | null): number {
  if (!g) return 0;
  switch (g.type) {
    case "Point":
      return 1;
    case "MultiPoint":
    case "LineString":
      return g.coordinates.length;
    case "MultiLineString":
    case "Polygon": {
      let n = 0;
      for (const r of g.coordinates) n += r.length;
      return n;
    }
    case "MultiPolygon": {
      let n = 0;
      for (const p of g.coordinates) for (const r of p) n += r.length;
      return n;
    }
    case "GeometryCollection": {
      let n = 0;
      for (const x of g.geometries) n += geomVertices(x);
      return n;
    }
  }
}

export function countVertices(fc: FeatureCollection): number {
  let n = 0;
  for (const f of fc.features) n += geomVertices(f.geometry);
  return n;
}

export type SimplifyResult = { data: FeatureCollection; simplified: boolean; tolerance: number; vertexCount: number; originalVertexCount: number };

/**
 * 더 줄일 여지가 있는 구조인가 (선 3점 이상, 폴리곤 링 6점 이상).
 * 닫힌 사각형(5점)·삼각형(4점)은 turf 가 링을 4점 미만으로 못 줄이고 허용오차를 되돌려 가며 재시도하므로 실질적으로 최소 구조다 (필지 사각형 20만 개 헛바퀴의 원인).
 */
function reducible(g: Geometry | null): boolean {
  if (!g) return false;
  switch (g.type) {
    case "LineString":
      return g.coordinates.length > 2;
    case "MultiLineString":
      return g.coordinates.some((l) => l.length > 2);
    case "Polygon":
      return g.coordinates.some((r) => r.length > 5);
    case "MultiPolygon":
      return g.coordinates.some((p) => p.some((r) => r.length > 5));
    default:
      return false; // Point/MultiPoint/GeometryCollection 은 건드리지 않는다
  }
}

/** 단순화에 쓸 수 있는 최대 시간(ms). 넘기면 그때까지의 결과를 반환 */
const MAX_MS = 10_000;

/**
 * @param maxVertices 목표 꼭짓점 수. 도달하지 못해도(점 레이어, 이미 최소 구조인 폴리곤 등) 멈추고 최선의 결과를 돌려준다.
 * tolerance 는 도(degree) 단위 (1e-5° ≈ 1.1 m)
 *
 * 멈춤 조건: 목표 달성 / 허용오차 상한 / 더 줄일 피처 없음 / 한 바퀴 감소율 1% 미만이 연속 2회 / 시간 상한
 */
export function simplifyForBudget(fc: FeatureCollection, maxVertices: number): SimplifyResult {
  const original = countVertices(fc);
  if (original <= maxVertices) return { data: fc, simplified: false, tolerance: 0, vertexCount: original, originalVertexCount: original };

  // 줄일 여지가 있는 피처가 하나도 없으면(점 레이어, 전부 최소 구조) 복제·반복 없이 그대로 돌려준다
  if (!fc.features.some((f) => reducible(f.geometry))) {
    return { data: fc, simplified: false, tolerance: 0, vertexCount: original, originalVertexCount: original };
  }
  // 원본을 건드리지 않도록 1회만 복제하고, 그 복제본을 점점 거칠게 단순화한다
  const work = structuredClone(fc);
  const t0 = Date.now();
  let tol = 1e-6; // ≈ 0.1 m
  const MAX_TOL = 0.05; // ≈ 5 km — 이 이상은 형태가 무너진다
  let count = original;
  let used = 0;
  let stalls = 0;
  // 줄일 여지가 있는 피처 인덱스만 추린다 (5점짜리 사각형 20만 개 같은 레이어에서 헛바퀴 방지)
  let active: number[] = [];
  for (let i = 0; i < work.features.length; i++) if (reducible(work.features[i].geometry)) active.push(i);

  outer: while (count > maxVertices && tol <= MAX_TOL && active.length) {
    used = tol;
    const before = count;
    const next: number[] = [];
    for (let k = 0; k < active.length; k++) {
      if ((k & 255) === 0 && Date.now() - t0 > MAX_MS) break outer;
      const i = active[k];
      const f = work.features[i];
      try {
        const s = simplify(f as Feature, { tolerance: tol, highQuality: false, mutate: false }) as Feature;
        if (s.geometry) {
          count += geomVertices(s.geometry) - geomVertices(f.geometry);
          work.features[i] = { ...f, geometry: s.geometry };
        }
      } catch {
        /* 해당 피처는 그대로 둔다 */
      }
      if (reducible(work.features[i].geometry)) next.push(i);
    }
    active = next;
    // 한 바퀴 감소율이 1% 미만이면 "정체". 허용오차가 작을 때(≈10m 미만)의 정체는 정상적인 출발 구간이라 계속 키우고,
    // 허용오차가 충분히 커졌는데도 연속 2회 정체면 더 줄일 수 없는 레이어로 보고 포기한다.
    if (before - count < before * 0.01) {
      stalls++;
      if (stalls >= 2 && tol >= 1e-4) break;
    } else stalls = 0;
    tol *= 1.8;
  }
  return { data: work, simplified: true, tolerance: used, vertexCount: count, originalVertexCount: original };
}
