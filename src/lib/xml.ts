/** XML 1.0 안전 문자열 도우미 — style/bake/decorations 공용 (M4) */

/** XML 1.0 에서 금지된 제어문자와 짝 없는 서로게이트를 제거 */
export function stripInvalidXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

export function escapeXml(s: string): string {
  return stripInvalidXml(String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** SVG id 로 안전한 문자열 (문자·숫자·_- 만) */
export function xmlId(s: string): string {
  return stripInvalidXml(String(s)).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "x";
}
