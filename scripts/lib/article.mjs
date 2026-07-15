// Claude API による記事生成（web search tool 併用）

import Anthropic from "@anthropic-ai/sdk";

// 既定は最高品質の Opus 4.8。コストを抑えたい場合は
// リポジトリの Actions Variables で ARTICLE_MODEL=claude-sonnet-5 を設定する
// （web search tool の _20260209 版が使えるのは Opus 4.6+/Sonnet 4.6+ のみ）。
const MODEL = process.env.ARTICLE_MODEL || "claude-opus-4-8";

const SYSTEM = `あなたは日本の個人投資家向けメディア「マーケットデイリー」の編集者です。
与えられた市場データをもとに、正確で読みやすい市況記事を日本語で執筆します。

# 絶対に守るルール（法令遵守）
- 個別銘柄の売買推奨は絶対に書かない。「買い」「売り」「おすすめ」「今が仕込み時」等の表現は禁止。
- 将来の価格や相場の方向を断定しない。「〜と考えられます」「市場では〜が意識されています」「〜となる可能性があります」等の表現に統一する。
- 出来高ランキングは事実の紹介にとどめ、投資判断を促す文脈にしない。
- 投資助言・勧誘と受け取られる表現をしない。免責事項はサイト側で自動表示されるため本文には書かない。

# 執筆ルール
- 与えられた市場データの数値をそのまま使う。数値を創作・推測しない。
- 「注目ニュース」セクションではweb検索を使い、経済指標カレンダー・金融政策イベント・主要企業決算など今後の予定を確認してから書く。検索で確認できなかった予定は書かない。
- 各イベントには「一般的にどんな影響が意識されやすいか」の解説を添える（一般論として）。
- 見出しは ## と ### を使う。データは表（Markdownテーブル）で示す。
- 全体で1000〜1600字程度。前置きの挨拶は不要、本文から始める。
- 出力はMarkdown本文のみ。タイトル（# 見出し）やfrontmatterは含めない。`;

/**
 * 記事本文を生成する。pause_turn（サーバー側ツールの反復上限）は自動で再開する。
 */
export async function writeArticle(prompt) {
  const client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読む
  let messages = [{ role: "user", content: prompt }];

  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages,
    });

    if (response.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    if (response.stop_reason === "refusal") {
      throw new Error("記事生成がモデルに拒否されました (stop_reason: refusal)");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("出力がトークン上限に達しました (stop_reason: max_tokens)");
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("生成結果が空でした");
    return text;
  }
  throw new Error("pause_turn の再開回数が上限に達しました");
}
