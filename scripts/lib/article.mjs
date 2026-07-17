// Gemini API による記事生成（Google検索グラウンディング併用）
// APIキーは https://aistudio.google.com/apikey で無料発行（GEMINI_API_KEY）

// 既定は安定版の gemini-3.5-flash（無料枠対象・Google検索グラウンディングは月5,000回まで無料）。
// 変更する場合はリポジトリの Actions Variables で ARTICLE_MODEL を設定する。
const MODEL = process.env.ARTICLE_MODEL || "gemini-3.5-flash";

const SYSTEM = `あなたは日本の個人投資家向けメディア「マーケットデイリー」の編集者です。
与えられた市場データをもとに、正確で読みやすい市況記事を日本語で執筆します。

# 絶対に守るルール（法令遵守）
- 個別銘柄の売買推奨は絶対に書かない。「買い」「売り」「おすすめ」「今が仕込み時」等の表現は禁止。
- 将来の価格や相場の方向を断定しない。「〜と考えられます」「市場では〜が意識されています」「〜となる可能性があります」等の表現に統一する。
- 出来高ランキングは事実の紹介にとどめ、投資判断を促す文脈にしない。
- 投資助言・勧誘と受け取られる表現をしない。免責事項はサイト側で自動表示されるため本文には書かない。

# 執筆ルール
- 与えられた市場データの数値をそのまま使う。数値を創作・推測しない。
- 「注目ニュース」セクションではGoogle検索を使い、経済指標カレンダー・金融政策イベント・主要企業決算など今後の予定を確認してから書く。検索で確認できなかった予定は書かない。
- 各イベントには「一般的にどんな影響が意識されやすいか」の解説を添える（一般論として）。
- 見出しは ## と ### を使う。データは表（Markdownテーブル）で示す。
- 全体で1000〜1600字程度。前置きの挨拶は不要、本文から始める。
- 出力はMarkdown本文のみ。タイトル（# 見出し）やfrontmatterは含めない。`;

/**
 * 記事本文を生成する。レート制限(429)や一時エラー(5xx)はバックオフして再試行する。
 */
export async function writeArticle(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("環境変数 GEMINI_API_KEY が未設定です");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }], // Google検索グラウンディング
    generationConfig: { maxOutputTokens: 16384 },
  };

  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const waitSec = 20 * attempt;
      console.log(`リトライします（${attempt}回目、${waitSec}秒待機）: ${lastError}`);
      await new Promise((s) => setTimeout(s, waitSec * 1000));
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);

    // 429(レート制限)・5xx は再試行、それ以外のエラーは即失敗
    if (!res.ok) {
      const message = json?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) {
        lastError = `Gemini: ${res.status} ${message}`;
        continue;
      }
      throw new Error(`Gemini: ${res.status} ${message}`);
    }

    const candidate = json?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      throw new Error("出力がトークン上限に達しました (finishReason: MAX_TOKENS)");
    }
    if (finishReason && finishReason !== "STOP") {
      // SAFETY / RECITATION / PROHIBITED_CONTENT など
      throw new Error(`記事生成が中断されました (finishReason: ${finishReason})`);
    }

    const text = (candidate?.content?.parts ?? [])
      .filter((p) => typeof p.text === "string" && !p.thought) // 思考パートは除外
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (!text) {
      lastError = "生成結果が空でした";
      continue;
    }
    return text;
  }
  throw new Error(`記事生成に失敗しました: ${lastError}`);
}
