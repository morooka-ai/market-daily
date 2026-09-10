// Firebase（Authentication + Firestore）のクライアント側ラッパー。
//
// 方針:
//  - Firebase SDK は「必要になったときだけ」動的 import する。
//    未ログインの一般訪問者にはSDKを一切ダウンロードさせず、サイトの表示速度を維持するため。
//  - 設定（PUBLIC_FIREBASE_*）が未投入でもビルド・表示は壊れない。
//    その場合 isConfigured() が false を返し、会員機能のUIが「準備中」表示になる。
//
// 会員登録はメールアドレス＋パスワード。メールアドレスをIDにすることで、
// パスワードを忘れた場合の再設定（Firebase が自前で送るメール）が使える。
// 毎日の配信メールを受け取るかどうかは、これとは別に本人が選ぶ（既定はオフ）。
//
// PUBLIC_FIREBASE_* は公開前提の値（ブラウザに埋め込まれる）で、秘密情報ではない。
// 実際のアクセス制御は firestore.rules で行う。

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

/** ブラウザ側で「ログイン済みらしい」ことを即座に判定するためのフラグ。
 *  これが無ければ Firebase SDK を読み込まずに済む。 */
export const SIGNED_IN_KEY = "md_signed_in";
/** 選択銘柄のローカルキャッシュ。描画直後に同期適用してチラつきを防ぐ。 */
export const SELECTION_CACHE_KEY = "md_selections";

export function isConfigured() {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

export function hasSignedInHint() {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

function setSignedInHint(on) {
  try {
    if (on) localStorage.setItem(SIGNED_IN_KEY, "1");
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    /* プライベートモード等で localStorage が使えなくても機能自体は動く */
  }
}

export function readSelectionCache() {
  try {
    const raw = localStorage.getItem(SELECTION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSelectionCache(selections) {
  try {
    localStorage.setItem(SELECTION_CACHE_KEY, JSON.stringify(selections ?? {}));
  } catch {
    /* 保存できなくてもFirestore側が正なので致命的ではない */
  }
}

function clearSelectionCache() {
  try {
    localStorage.removeItem(SELECTION_CACHE_KEY);
  } catch {
    /* 同上 */
  }
}

// --- SDK の遅延読み込み ------------------------------------------------------

let sdkPromise = null;

/** Firebase SDK を読み込んで app / auth / db を返す（2回目以降はキャッシュ） */
function loadSdk() {
  if (!isConfigured()) {
    return Promise.reject(new Error("Firebaseの設定が未完了です"));
  }
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const [appMod, authMod, storeMod] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);
      const app = appMod.getApps().length
        ? appMod.getApp()
        : appMod.initializeApp(config);
      const auth = authMod.getAuth(app);
      auth.languageCode = "ja"; // 再設定・確認メールを日本語で送る
      return { app, auth, db: storeMod.getFirestore(app), authMod, storeMod };
    })();
  }
  return sdkPromise;
}

// --- 認証 --------------------------------------------------------------------

/** ログイン状態の変化を購読する。コールバックには user または null が渡る。 */
export async function watchUser(callback) {
  const { auth, authMod } = await loadSdk();
  return authMod.onAuthStateChanged(auth, (user) => {
    setSignedInHint(Boolean(user));
    callback(user);
  });
}

/**
 * 新規会員登録。
 * @param {string} email    ログインIDを兼ねるメールアドレス
 * @param {string} password
 */
export async function register(email, password) {
  const address = email.trim();
  if (!EMAIL_PATTERN.test(address)) {
    throw new Error("メールアドレスの形式が正しくありません");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }

  const { auth, authMod, db, storeMod } = await loadSdk();
  const cred = await authMod.createUserWithEmailAndPassword(auth, address, password);

  await storeMod.setDoc(storeMod.doc(db, "users", cred.user.uid), {
    selections: {},
    createdAt: storeMod.serverTimestamp(),
    updatedAt: storeMod.serverTimestamp(),
  });

  // メールアドレスの確認メール（Firebaseが送信）。
  // 宛先の打ち間違いをその場で気づけるようにし、パスワード再設定を確実にするため。
  // 失敗しても登録自体は成立しているので、ここでは中断しない。
  try {
    await authMod.sendEmailVerification(cred.user);
  } catch (err) {
    console.warn("確認メールの送信に失敗しました", err);
  }

  setSignedInHint(true);
  return cred.user;
}

export async function login(email, password) {
  const { auth, authMod } = await loadSdk();
  const cred = await authMod.signInWithEmailAndPassword(auth, email.trim(), password);
  setSignedInHint(true);
  return cred.user;
}

export async function logout() {
  const { auth, authMod } = await loadSdk();
  await authMod.signOut(auth);
  setSignedInHint(false);
  clearSelectionCache();
}

/** パスワード再設定メールを送る（Firebaseが送信するため送信サービスの契約は不要） */
export async function sendPasswordReset(email) {
  const address = email.trim();
  if (!EMAIL_PATTERN.test(address)) {
    throw new Error("メールアドレスの形式が正しくありません");
  }
  const { auth, authMod } = await loadSdk();
  await authMod.sendPasswordResetEmail(auth, address);
}

/** メールアドレスの確認メールを送り直す */
export async function resendEmailVerification() {
  const { auth, authMod } = await loadSdk();
  if (!auth.currentUser) throw new Error("ログインしていません");
  await authMod.sendEmailVerification(auth.currentUser);
}

/** 退会。Firestore の文書を消してから認証アカウントを削除する。 */
export async function deleteAccount() {
  const { auth, db, storeMod } = await loadSdk();
  const user = auth.currentUser;
  if (!user) throw new Error("ログインしていません");
  await storeMod.deleteDoc(storeMod.doc(db, "users", user.uid));
  await user.delete();
  setSignedInHint(false);
  clearSelectionCache();
}

// --- プロフィール（選択銘柄） -------------------------------------------------

export async function loadProfile(user) {
  const { db, storeMod } = await loadSdk();
  const snap = await storeMod.getDoc(storeMod.doc(db, "users", user.uid));
  const data = snap.exists() ? snap.data() : {};
  const profile = {
    selections: data.selections ?? {},
  };
  writeSelectionCache(profile.selections);
  return profile;
}

/** 1ページ分の選択銘柄を保存する。ids が空配列なら「全件表示（絞り込みなし）」。 */
export async function saveSelection(user, pageKey, ids) {
  const { db, storeMod } = await loadSdk();
  await storeMod.setDoc(
    storeMod.doc(db, "users", user.uid),
    {
      selections: { [pageKey]: ids },
      updatedAt: storeMod.serverTimestamp(),
    },
    { merge: true },
  );
  const cache = readSelectionCache();
  cache[pageKey] = ids;
  writeSelectionCache(cache);
}

// --- エラーメッセージの日本語化 ------------------------------------------------

const AUTH_ERRORS = {
  "auth/email-already-in-use":
    "このメールアドレスは既に登録されています。ログインするか、パスワードの再設定をお試しください。",
  "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
  "auth/invalid-email": "メールアドレスの形式が正しくありません。",
  "auth/missing-email": "メールアドレスを入力してください。",
  "auth/user-not-found": "メールアドレスまたはパスワードが違います。",
  "auth/wrong-password": "メールアドレスまたはパスワードが違います。",
  "auth/weak-password": `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`,
  "auth/too-many-requests":
    "試行回数が多すぎます。しばらく時間をおいてからお試しください。",
  "auth/network-request-failed": "通信に失敗しました。接続を確認してください。",
  "auth/requires-recent-login":
    "この操作には再ログインが必要です。一度ログアウトしてから、もう一度お試しください。",
  "permission-denied": "リンクが正しくないか、有効期限が切れています。",
  "not-found": "対象の登録が見つかりませんでした。",
};

export function toMessage(err) {
  if (err?.code && AUTH_ERRORS[err.code]) return AUTH_ERRORS[err.code];
  return err?.message || "エラーが発生しました。時間をおいてお試しください。";
}
