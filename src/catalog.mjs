// 会員が「表示する銘柄」を選ぶための、ページ横断の銘柄カタログ。
//
// 参照元は3か所:
//   1. 各カテゴリーページ（表示の絞り込み）
//   2. マイページ（選択中の銘柄の一覧表示）
//   3. メール配信スクリプト（scripts/send-mail.mjs）— 現在値の取得に yahooSymbol を使う
//
// 銘柄そのものの定義は chart-pairs.mjs / us-stocks-data.mjs / jp-stocks-data.mjs にあり、
// ここではそれをページ単位に束ね直しているだけ。銘柄の追加・変更は各定義ファイルで行う。

import { FX_PAIRS, METAL_PAIRS, CRYPTO_PAIRS } from "./chart-pairs.mjs";
import { US_STOCKS } from "./us-stocks-data.mjs";
import { JP_STOCKS } from "./jp-stocks-data.mjs";

/** 1ページあたりに選択できる銘柄数の上限（0件＝会員は絞り込みなしで全件表示） */
export const MAX_SELECTION = 12;

/**
 * 未ログインの訪問者に既定で見せる銘柄数。
 *
 * 掲載候補を増やすと、絞り込みをしない訪問者にはチャート・解説が延々と並ぶことになる。
 * 既定をこの件数に抑えることで、初見の見通しとページの重さ（TradingViewウィジェットは
 * 画面内に入ったものだけ読み込まれる）を保つ。会員は従来どおり、選択があればその銘柄を、
 * 選択がなければ全銘柄を見る。
 *
 * どの6銘柄を出すかは content/featured.json の売買代金ランキングで毎日決まる。
 * 生成に失敗している場合は FALLBACK_FEATURED を使う（下記）。
 */
export const DEFAULT_VISIBLE = 6;

/**
 * 選択パネルの検索用キーワード。銘柄名・ティッカーだけでは引けない読み方を補う。
 * （検索側で全角/半角・大文字小文字・カタカナ/ひらがなは吸収するので、ここには素の語を書く）
 *
 * 日本株は日経225の223銘柄あるため全件には付けていない。銘柄名と証券コードでの検索は
 * キーワードなしでも効くので、ローマ字や通称で引きたい主要銘柄にだけ足してある。
 */
const SEARCH_KEYWORDS = {
  // FX・貴金属
  usdjpy: "dollar doller ドル 米ドル", eurjpy: "euro ユーロ", gbpjpy: "pound ポンド 英ポンド",
  chfjpy: "franc フラン スイス", audjpy: "aussie 豪ドル オーストラリア",
  nzdjpy: "kiwi ニュージーランド", cadjpy: "カナダ", zarjpy: "南アフリカ ランド",
  tryjpy: "トルコ リラ", mxnjpy: "メキシコ ペソ", eurusd: "ユーロドル",
  gbpusd: "ケーブル", audusd: "豪ドル米ドル", nzdusd: "キウイ",
  usdchf: "スイスフラン", usdcad: "カナダドル", eurgbp: "ユーロポンド",
  gold: "gold ゴールド 金", platinum: "platinum プラチナ 白金", silver: "silver シルバー 銀",
  palladium: "palladium パラジウム", copper: "copper カッパー 銅", aluminum: "aluminum アルミ",

  // 暗号資産
  btcjpy: "bitcoin ビットコイン", ethjpy: "ethereum イーサリアム", xrpjpy: "ripple リップル",
  dogejpy: "dogecoin ドージ", ltcjpy: "litecoin ライトコイン", soljpy: "solana ソラナ",
  bnbjpy: "binance バイナンス", adajpy: "cardano カルダノ", linkjpy: "chainlink チェーンリンク",
  bchjpy: "bitcoincash ビットコインキャッシュ", trxjpy: "tron トロン",
  xlmjpy: "stellar ステラ ルーメン", dotjpy: "polkadot ポルカドット",
  shibjpy: "shiba シバイヌ 柴犬", monajpy: "monacoin モナコイン モナ",

  // 日本株
  7203: "toyota トヨタ 自動車", 6758: "sony ソニー", 9984: "softbank ソフトバンク sbg",
  6861: "keyence キーエンス", 7974: "nintendo にんてんどう 任天堂",
  9432: "ntt 日本電信電話 通信", 8306: "mufg 三菱ufj 銀行 メガバンク",
  9983: "fastretailing ユニクロ uniqlo", 8035: "tokyoelectron 東エレク 半導体",
  6098: "recruit リクルート", 6501: "hitachi 日立", 8058: "mitsubishi 三菱商事 商社",
  6857: "advantest アドバンテスト 半導体", 6981: "murata 村田 電子部品",
  6146: "disco ディスコ 半導体", 6920: "lasertec レーザーテック 半導体",
  8316: "smfg 三井住友 銀行 メガバンク", 4063: "shinetsu 信越 化学",
  7011: "mhi 三菱重工 防衛", 7267: "honda ホンダ 本田 自動車",
  8411: "mizuho みずほ 銀行 メガバンク", 8001: "itochu 伊藤忠 商社",
  8031: "mitsui 三井物産 商社", 8053: "sumitomo 住友商事 商社",
  6902: "denso デンソー 自動車部品", 6954: "fanuc ファナック ロボット",
  6301: "komatsu コマツ 小松 建機", 7741: "hoya ホーヤ",
  4661: "orientalland ディズニー 東京ディズニーランド",
  9020: "jreast jr東日本 鉄道", 9022: "jrcentral jr東海 新幹線 鉄道",
  6752: "panasonic パナソニック", 6702: "fujitsu 富士通", 6701: "nec 日本電気",
  7751: "canon キヤノン", 7201: "nissan 日産 自動車", 7269: "suzuki スズキ 自動車",
  7270: "subaru スバル 自動車", 4755: "rakuten 楽天", 4689: "yahoo line ヤフー",
  9613: "ntt data", 6178: "japanpost 日本郵政 ゆうちょ",
  8697: "jpx 日本取引所 東証", 9843: "nitori ニトリ",

  // 米国株（S&P 100）。ティッカーと銘柄名での検索はキーワードなしでも効くので、
  // ここでは英語社名・通称・業種など「別の引き方」を補う。
  AAPL: "apple アップル", ABBV: "abbvie アッヴィ 製薬",
  ABT: "abbott アボット 医療機器", ACN: "accenture アクセンチュア コンサル",
  ADBE: "adobe アドビ ソフトウェア", AMAT: "appliedmaterials アプライドマテリアルズ 半導体製造装置",
  AMD: "amd advancedmicrodevices エーエムディー 半導体", AMGN: "amgen アムジェン 製薬 バイオ",
  AMT: "americantower アメリカンタワー reit 通信インフラ", AMZN: "amazon アマゾン ec クラウド",
  AVGO: "broadcom ブロードコム 半導体", AXP: "americanexpress アメックス 決済 カード",
  BA: "boeing ボーイング 航空 防衛", BAC: "bankofamerica バンクオブアメリカ 銀行",
  BKNG: "booking ブッキング priceline 旅行", BLK: "blackrock ブラックロック 資産運用",
  BMY: "bristolmyerssquibb ブリストルマイヤーズ 製薬", BNY: "bankofnewyorkmellon bnyメロン 銀行",
  "BRK.B": "berkshire バークシャー ハサウェイ バフェット", C: "citigroup シティグループ 銀行",
  CAT: "caterpillar キャタピラー 建機", CL: "colgate コルゲート パルモリーブ 日用品",
  CMCSA: "comcast コムキャスト ケーブル メディア", COF: "capitalone キャピタルワン カード 銀行",
  COP: "conocophillips コノコフィリップス 石油", COST: "costco コストコ 小売",
  CRM: "salesforce セールスフォース ソフトウェア", CSCO: "cisco シスコ ネットワーク機器",
  CVS: "cvshealth シーブイエス ドラッグストア 薬局", CVX: "chevron シェブロン 石油",
  DE: "deere ジョンディア ディア 農機 建機", DHR: "danaher ダナハー 医療機器",
  DIS: "disney ディズニー メディア", DUK: "dukeenergy デュークエナジー 電力",
  EMR: "emerson エマソン 電機 産業", FDX: "fedex フェデックス 物流",
  GD: "generaldynamics ゼネラルダイナミクス 防衛", GE: "geaerospace ゼネラルエレクトリック エンジン 航空",
  GEV: "gevernova ゼネラルエレクトリック バーノバ 電力設備", GILD: "gilead ギリアド 製薬 バイオ",
  GM: "generalmotors ゼネラルモーターズ 自動車", GOOG: "google alphabet グーグル アルファベット",
  GOOGL: "google alphabet グーグル アルファベット 検索 広告", GS: "goldmansachs ゴールドマン 証券 投資銀行",
  HD: "homedepot ホームデポ 小売 diy", HONA: "honeywell ハネウェル エアロスペース 航空",
  IBM: "ibm アイビーエム", INTC: "intel インテル 半導体 cpu",
  INTU: "intuit インテュイット quickbooks turbotax ソフトウェア", ISRG: "intuitivesurgical インテュイティブサージカル 手術ロボット ダヴィンチ",
  JNJ: "johnson ジョンソン 製薬 医療機器", JPM: "jpmorgan jpモルガン 銀行",
  KO: "cocacola コカコーラ 飲料", LIN: "linde リンデ 産業ガス 化学",
  LLY: "eililly イーライリリー リリー 製薬 肥満症", LMT: "lockheedmartin ロッキードマーチン 防衛",
  LOW: "lowes ロウズ 小売 diy ホームセンター", LRCX: "lamresearch ラムリサーチ 半導体製造装置",
  MA: "mastercard マスターカード 決済 カード", MCD: "mcdonalds マクドナルド マック 外食",
  MDLZ: "mondelez モンデリーズ オレオ 菓子", MDT: "medtronic メドトロニック 医療機器",
  META: "meta メタ facebook instagram フェイスブック インスタ", MMM: "3m スリーエム",
  MO: "altria アルトリア マルボロ たばこ", MRK: "merck メルク 製薬 キイトルーダ",
  MS: "morganstanley モルガンスタンレー 証券 投資銀行", MSFT: "microsoft マイクロソフト windows azure",
  MU: "micron マイクロン メモリ 半導体 dram", NEE: "nexteraenergy ネクステラ 電力 再エネ",
  NFLX: "netflix ネットフリックス 動画配信", NKE: "nike ナイキ スポーツ",
  NOW: "servicenow サービスナウ ソフトウェア", NVDA: "nvidia エヌビディア 半導体 gpu ai",
  ORCL: "oracle オラクル データベース クラウド", PEP: "pepsico ペプシコ 飲料 スナック",
  PFE: "pfizer ファイザー 製薬 ワクチン", PG: "procter gamble ピーアンドジー 日用品",
  PLTR: "palantir パランティア ソフトウェア ai データ分析", PM: "philipmorris フィリップモリス たばこ アイコス",
  QCOM: "qualcomm クアルコム 半導体 スマホ", RTX: "raytheon レイセオン rtx 防衛 航空",
  SBUX: "starbucks スターバックス スタバ コーヒー", SCHW: "charlesschwab シュワブ 証券",
  SO: "southerncompany サザン 電力", SPG: "simonproperty サイモンプロパティ reit モール",
  T: "at&t エーティーアンドティー 通信", TMO: "thermofisher サーモフィッシャー 分析機器",
  TMUS: "tmobile ティーモバイル 通信 携帯", TSLA: "tesla テスラ 電気自動車 ev マスク",
  TXN: "texasinstruments テキサスインスツルメンツ 半導体 アナログ", UBER: "uber ウーバー 配車 フードデリバリー",
  UNH: "unitedhealth ユナイテッドヘルス 保険 医療", UNP: "unionpacific ユニオンパシフィック 鉄道 貨物",
  UPS: "ups ユナイテッドパーセルサービス 物流 宅配", USB: "usbancorp usバンコープ 銀行",
  V: "visa ビザ 決済 カード", VZ: "verizon ベライゾン 通信 携帯",
  WFC: "wellsfargo ウェルズファーゴ 銀行", WMT: "walmart ウォルマート 小売",
  XOM: "exxonmobil エクソンモービル 石油",
};

const fromPairs = (pairs) =>
  pairs.map((p) => ({
    id: p.id,
    name: p.name,
    sub: p.pair,
    yahooSymbol: p.yahooSymbol,
    kw: SEARCH_KEYWORDS[p.id] ?? "",
  }));

const fromStocks = (stocks) =>
  stocks.map((s) => ({
    id: s.ticker,
    name: s.name,
    sub: s.ticker,
    yahooSymbol: s.yahooSymbol,
    kw: SEARCH_KEYWORDS[s.ticker] ?? "",
  }));

/**
 * ページ単位のカタログ。
 * key      : Firestore の selections に保存するキー。URLパスとも一致させている。
 * label    : 画面表示・メール見出し用のページ名
 * items    : 選択肢（表示順は既定の並び順）
 * limited  : true なら未ログイン時に DEFAULT_VISIBLE 件だけ表示する。
 *            掲載候補が多いページだけを対象にしている（FX・貴金属は従来どおり全件表示）。
 * basis    : 既定表示を決める指標のラベル（画面の注記に使う）
 */
export const PAGES = [
  { key: "fx", label: "FX", path: "fx/", items: fromPairs(FX_PAIRS), limited: false },
  { key: "metals", label: "貴金属", path: "metals/", items: fromPairs(METAL_PAIRS), limited: false },
  {
    key: "crypto",
    label: "暗号資産",
    path: "crypto/",
    items: fromPairs(CRYPTO_PAIRS),
    limited: true,
    basis: "24時間取引高",
  },
  {
    key: "jp-stocks",
    label: "日本株",
    path: "jp-stocks/",
    items: fromStocks(JP_STOCKS),
    limited: true,
    basis: "売買代金",
  },
  {
    key: "us-stocks",
    label: "米国株",
    path: "us-stocks/",
    items: fromStocks(US_STOCKS),
    limited: true,
    basis: "売買代金",
  },
];

/** ページキーからカタログを引く */
export function getPage(key) {
  return PAGES.find((p) => p.key === key) ?? null;
}

/**
 * content/featured.json が無い・壊れている・銘柄構成と食い違うときに使う既定表示。
 * 売買代金ランキングが取れなくても未ログインの画面が空にならないようにするための保険で、
 * 業種・知名度が偏らない銘柄を手で選んである。
 */
const FALLBACK_FEATURED = {
  crypto: ["btcjpy", "ethjpy", "xrpjpy", "soljpy", "dogejpy", "bnbjpy"],
  "jp-stocks": ["7203", "6758", "9984", "8306", "8035", "7974"],
  "us-stocks": ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "WMT"],
};

/**
 * 未ログイン時に表示する銘柄IDを決める。
 *
 * @param {string} pageKey
 * @param {object} [featured] content/featured.json の中身。省略・不正なら手動の既定値を使う。
 * @returns {string[]} DEFAULT_VISIBLE 件のID（limited でないページは空配列＝絞り込みなし）
 */
export function defaultVisibleIds(pageKey, featured) {
  const page = getPage(pageKey);
  if (!page || !page.limited) return [];

  const valid = new Set(page.items.map((it) => it.id));
  const ranking = featured?.pages?.[pageKey]?.ranking;
  const out = [];

  // ランキングは銘柄を追加・削除した直後に古いIDを含みうるので、必ず実在確認を通す
  for (const id of Array.isArray(ranking) ? ranking : []) {
    if (!valid.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= DEFAULT_VISIBLE) break;
  }
  // ランキングが足りない分は手動の既定値、それでも足りなければカタログ順で埋める
  for (const id of [...(FALLBACK_FEATURED[pageKey] ?? []), ...valid]) {
    if (out.length >= DEFAULT_VISIBLE) break;
    if (!valid.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * 保存された選択値を検証して正規化する。
 * 未知のID・重複を除き、上限（MAX_SELECTION 件）で切り詰める。
 * 選択が空（=未設定）の場合は空配列を返し、呼び出し側で「全件表示」として扱う。
 */
export function normalizeSelection(pageKey, ids) {
  const page = getPage(pageKey);
  if (!page || !Array.isArray(ids)) return [];
  const valid = new Set(page.items.map((it) => it.id));
  const out = [];
  for (const id of ids) {
    if (typeof id !== "string" || !valid.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_SELECTION) break;
  }
  return out;
}
