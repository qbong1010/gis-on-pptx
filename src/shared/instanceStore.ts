/**
 * 지도 박스(콘텐츠 애드인 인스턴스)별 저장소.
 * - PowerPoint: Office.context.document.settings — 콘텐츠 애드인은 인스턴스마다 별도로 문서에 저장된다.
 *   → 지도 박스를 복사/저장/재오픈해도 상태가 유지된다.
 * - 브라우저 개발 모드: sessionStorage (탭마다 다른 지도)
 */
export type InstanceStore = {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  save(): Promise<void>;
};

export function createInstanceStore(inOffice: boolean): InstanceStore {
  if (inOffice) {
    const s = Office.context.document.settings;
    return {
      get: <T,>(k: string) => (s.get(k) ?? undefined) as T | undefined,
      set: (k, v) => s.set(k, v),
      save: () =>
        new Promise<void>((resolve, reject) =>
          s.saveAsync((r) =>
            r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(r.error.message)),
          ),
        ),
    };
  }
  const prefix = "slide-map:dev-map:";
  return {
    get: <T,>(k: string) => {
      const raw = sessionStorage.getItem(prefix + k);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    set: (k, v) => sessionStorage.setItem(prefix + k, JSON.stringify(v)),
    save: async () => {},
  };
}
