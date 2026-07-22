// 米国株ページの解説（現状・企業の動向）を Gemini API で生成する。
// Google検索グラウンディングで各社の公表情報を確認したうえで、
// 「事実の紹介」に徹した文章を作る（予測・株価見通し・売買推奨は書かない）。

const MODEL = process.env.ARTICLE_MODEL || "gemini-3.5-flash";

const SYSTEM = `あなたは日本の個人投資家向けメディア「マーケットデイリー」の編集者です。
指定された米国上場企業について、事実にもとづく短い解説を日本語で執筆します。

# 絶対に守るルール（法令遵守）
- 個別銘柄の売買推奨は絶対に書かない。「買い」「売り」「おすすめ」「今が仕込み時」等の表現は禁止。
- 将来の株価・相場の方向を予測・断定しない。株価目標や「上がる/下がる」は書かない。
- 投資助言・勧誘と受け取られる表現をしない。

# 執筆内容
- current（現状）: その企業の事業の現況を、客観的な事実として2〜3文で簡潔に。
- updates（企業の動向）: その企業が直近で「公表・発表した事実」を2〜3文で。
  新製品・新サービスの発表、設備投資計画、決算で公表された数値、開催済み/予定のイベント、
  事業提携など、同社や信頼できる報道が公表している客観的事実のみを書く。
  推測や見通しは書かず、「〜と発表しています」「〜と公表しています」等、事実の紹介にとどめる。

# 執筆ルール
- 必ずGoogle検索で最新の公表情報を確認してから書く。検索で確認できない事柄は書かない。
- 数値や日付を創作しない。確認できた範囲で正確に書く。
- 各文は簡潔に。誇張しない。
- 出力は次の形式のJSONのみ。前後に説明文やコードフェンス(\`\`\`)を付けない。
  {"current":"（現状の文）","updates":"（企業の動向の文）"}`;

// レスポンステキストからJSONオブジェクトを取り出す（コードフェンス等を除去）。
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`JSONが見つかりません: ${text.slice(0, 120)}`);
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("環境変数 GEMINI_API_KEY が未設定です");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 4096 },
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
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`生成が中断されました (finishReason: ${finishReason})`);
    }

    const text = (candidate?.content?.parts ?? [])
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (!text) {
      lastError = "生成結果が空でした";
      continue;
    }
    return text;
  }
  throw new Error(`解説生成に失敗しました: ${lastError}`);
}

/**
 * 1銘柄分の解説（current/updates）を生成して返す。
 * @param {{name:string, ticker:string}} stock
 * @returns {Promise<{current:string, updates:string}>}
 */
export async function writeStockNote(stock) {
  const prompt = `対象企業: ${stock.name}（ティッカー: ${stock.ticker}）

この企業について、current（現状）と updates（企業の動向）を、システム指示のルールに従って執筆してください。
updates は、この企業が直近で公表・発表した最新の事実（新製品・投資計画・決算で公表された数値・イベント・提携など）を中心にまとめてください。
出力は指定のJSONのみとしてください。`;

  const text = await callGemini(prompt);
  const parsed = extractJson(text);
  const current = String(parsed.current ?? "").trim();
  const updates = String(parsed.updates ?? "").trim();
  if (!current || !updates) {
    throw new Error(`current/updates が空です: ${text.slice(0, 120)}`);
  }
  return { current, updates };
}
