export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Office 저장소 파티션 키를 반영한 localStorage 키 */
export function lsKey(name: string): string {
  let pk = "";
  try {
    pk = (typeof Office !== "undefined" && Office.context?.partitionKey) || "";
  } catch {
    pk = "";
  }
  return `${pk}slide-map:${name}`;
}

export function lsGet(name: string): string | null {
  try {
    return localStorage.getItem(lsKey(name));
  } catch {
    return null;
  }
}

export function lsSet(name: string, value: string) {
  try {
    localStorage.setItem(lsKey(name), value);
  } catch {
    /* ignore */
  }
}

export function isPowerPoint(host: unknown): boolean {
  return host === "PowerPoint";
}
