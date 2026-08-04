// メール送信のプロバイダ抽象化。
//
// 送信サービスは環境変数 MAIL_PROVIDER で切り替える。未設定なら "console"（送信せずログ出力）。
// これにより、送信先サービスが決まる前でも会員登録・銘柄選択の機能を先に公開できる。
//
//   MAIL_PROVIDER  console（既定） | resend | brevo | sendgrid
//   MAIL_API_KEY   各サービスのAPIキー
//   MAIL_FROM      差出人アドレス（例: daily@market-daily.jimulabo.com）
//   MAIL_FROM_NAME 差出人名（既定: マーケットデイリー）
//
// 送信サービスを変えるときは、この2か所（PROVIDERS への追加と環境変数）だけを触ればよい。

const FROM_NAME_DEFAULT = "マーケットデイリー";

function config() {
  return {
    provider: (process.env.MAIL_PROVIDER || "console").toLowerCase(),
    apiKey: process.env.MAIL_API_KEY || "",
    from: process.env.MAIL_FROM || "",
    fromName: process.env.MAIL_FROM_NAME || FROM_NAME_DEFAULT,
  };
}

/** 送信サービスが実際に使える状態か（キーと差出人が揃っているか） */
export function isMailConfigured() {
  const c = config();
  return c.provider === "console" || Boolean(c.apiKey && c.from);
}

export function mailProviderName() {
  return config().provider;
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`メール送信に失敗しました (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }
  return res;
}

const PROVIDERS = {
  // 送信せず内容を標準出力に出すだけ。動作確認と、送信サービス未定の期間に使う。
  async console(msg, c) {
    console.log(
      [
        "--- (未送信・console モード) ---",
        `From   : ${c.fromName} <${c.from || "未設定"}>`,
        `To     : ${msg.to}`,
        `Subject: ${msg.subject}`,
        msg.unsubscribeUrl ? `Unsub  : ${msg.unsubscribeUrl}` : "",
        "",
        msg.text,
        "--------------------------------",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },

  async resend(msg, c) {
    await postJson(
      "https://api.resend.com/emails",
      { authorization: `Bearer ${c.apiKey}` },
      {
        from: `${c.fromName} <${c.from}>`,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        // List-Unsubscribe-Post（RFC 8058 のワンクリック解除）は付けない。
        // 静的サイトで POST を受け取れないため、宣言だけして解除できない状態になるより、
        // URLを開いてもらう方式に統一する。
        ...(msg.unsubscribeUrl
          ? { headers: { "List-Unsubscribe": `<${msg.unsubscribeUrl}>` } }
          : {}),
      },
    );
  },

  async brevo(msg, c) {
    await postJson(
      "https://api.brevo.com/v3/smtp/email",
      { "api-key": c.apiKey },
      {
        sender: { email: c.from, name: c.fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
        htmlContent: msg.html,
        ...(msg.unsubscribeUrl
          ? { headers: { "List-Unsubscribe": `<${msg.unsubscribeUrl}>` } }
          : {}),
      },
    );
  },

  async sendgrid(msg, c) {
    await postJson(
      "https://api.sendgrid.com/v3/mail/send",
      { authorization: `Bearer ${c.apiKey}` },
      {
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: c.from, name: c.fromName },
        subject: msg.subject,
        content: [
          { type: "text/plain", value: msg.text },
          ...(msg.html ? [{ type: "text/html", value: msg.html }] : []),
        ],
        ...(msg.unsubscribeUrl
          ? { headers: { "List-Unsubscribe": `<${msg.unsubscribeUrl}>` } }
          : {}),
      },
    );
  },
};

/**
 * メールを1通送る。
 * @param {{to:string, subject:string, text:string, html?:string, unsubscribeUrl?:string}} msg
 */
export async function sendMail(msg) {
  const c = config();
  const send = PROVIDERS[c.provider];
  if (!send) {
    throw new Error(
      `未知の MAIL_PROVIDER です: ${c.provider}（利用可能: ${Object.keys(PROVIDERS).join(", ")}）`,
    );
  }
  if (c.provider !== "console" && (!c.apiKey || !c.from)) {
    throw new Error("MAIL_API_KEY と MAIL_FROM を設定してください");
  }
  await send(msg, c);
}
