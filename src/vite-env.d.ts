/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VWORLD_KEY?: string;
  /** 배포 빌드에 넣을 공개(배포 도메인용) 키 */
  readonly VITE_VWORLD_KEY_PUBLIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
