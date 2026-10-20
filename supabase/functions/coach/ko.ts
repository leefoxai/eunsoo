// 한국어 조사·문자열 도우미

/** 마지막 글자에 받침이 있는지. 한글 음절이 아니면(ㅇㅇ, ○○ 등) 받침 없음으로 본다. */
export function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return "013678".includes(ch); // 영·일·삼·육·칠·팔
  return false;
}

export type JosaPair = "을/를" | "이/가" | "은/는" | "과/와" | "으로/로";

/** pair는 "받침 있을 때/없을 때" 순서 */
export function josa(word: string, pair: JosaPair): string {
  const [withB, withoutB] = pair.split("/");
  if (pair === "으로/로") {
    const ch = word.trim().slice(-1);
    const code = ch.charCodeAt(0);
    const rieul = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
    return hasBatchim(word) && !rieul ? withB : withoutB;
  }
  return hasBatchim(word) ? withB : withoutB;
}

/** 단어 + 조사 */
export function withJosa(word: string, pair: JosaPair): string {
  return word + josa(word, pair);
}

/** 길면 n자에서 자르고 … */
export function short(s: string, n = 30): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
