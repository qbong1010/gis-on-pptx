/** 진단 로그 — 패널 하단 "진단" 접이식 영역에 표시 (실제 PowerPoint 검증용) */
export type DiagEntry = { t: number; level: "info" | "warn" | "error"; text: string };

const entries: DiagEntry[] = [];
const listeners = new Set<() => void>();
let version = 0;

export function diag(text: string, level: DiagEntry["level"] = "info") {
  entries.push({ t: Date.now(), level, text });
  if (entries.length > 300) entries.shift();
  version++;
  if (level !== "info") console.warn("[slide-map]", text);
  listeners.forEach((l) => l());
}

export function getDiag(): DiagEntry[] {
  return entries;
}
export function diagVersion(): number {
  return version;
}
export function subscribeDiag(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function clearDiag() {
  entries.length = 0;
  version++;
  listeners.forEach((l) => l());
}
if (typeof window !== "undefined") (window as unknown as { __slidemapDiag: unknown }).__slidemapDiag = { entries };
