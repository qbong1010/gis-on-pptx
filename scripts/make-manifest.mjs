/**
 * 배포용 매니페스트 생성 (D-032)
 *   node scripts/make-manifest.mjs https://slidemap.example.com [출력경로]
 * - manifest-taskpane.xml 의 https://localhost:3000 을 배포 주소로 바꾸고,
 *   개발용과 동시에 설치될 수 있도록 Id/표시 이름을 배포용으로 바꾼다.
 * - 결과: dist/manifest.xml (정적 호스팅에 함께 올림) — 설치 스크립트가 이 주소에서 내려받는다.
 */
import fs from "node:fs";
import path from "node:path";

const PROD_ID = "8f1c2d7e-5b3a-4c9e-9a61-2d4f7b0c5e13";
const DEV_ID = "55565cbb-3a80-4456-8e3a-6ee14e5f39b1";

const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("사용법: node scripts/make-manifest.mjs https://배포주소 [출력경로]  (https 필수)");
  process.exit(1);
}
const out = process.argv[3] || path.join("dist", "manifest.xml");
const src = fs.readFileSync("manifest-taskpane.xml", "utf8");
const origin = new URL(base).origin;

let xml = src
  .replaceAll("https://localhost:3000", base)
  .replace(DEV_ID, PROD_ID)
  .replace(/<DisplayName DefaultValue="[^"]*"\s*\/>/, '<DisplayName DefaultValue="Slide Map" />');
// AppDomain 은 오리진만
xml = xml.replace(/<AppDomain>[^<]*<\/AppDomain>/, `<AppDomain>${origin}</AppDomain>`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, xml);
console.log(`매니페스트 생성: ${out}\n  주소: ${base}\n  Id: ${PROD_ID}`);
