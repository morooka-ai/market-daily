// 画面表示用の日付フォーマット（JST）。

/**
 * ISO 文字列を日本語表記（例「2026/09/10」）にする。
 * 値が無い・不正なら null を返すので、呼び出し側で表示を出し分けられる。
 */
export function jstDateLabel(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
