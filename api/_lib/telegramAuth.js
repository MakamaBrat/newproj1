import crypto from "crypto";

/// Проверка подписи Telegram WebApp initData по официальному алгоритму:
/// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
///
/// Без этой проверки сервер вынужден верить telegram_id, который прислал
/// клиент, — а его легко подделать (это и была реальная дыра: любой мог
/// вызвать set-referrer/grant-referral-deck с чужим или произвольным
/// telegram_id). initData подписан секретом, который знает только бот
/// (BOT_TOKEN) и Telegram — подделать её без токена нельзя.
///
/// Возвращает { ok: true, userId } либо { ok: false, reason }.
export function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 24 * 60 * 60) {
  if (!initData || typeof initData !== "string") {
    return { ok: false, reason: "empty_init_data" };
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "unparseable_init_data" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    return { ok: false, reason: "bad_signature" };
  }

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (authDate && Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }

  let userId = null;
  try {
    const userJson = params.get("user");
    if (userJson) userId = String(JSON.parse(userJson).id);
  } catch {
    // ignore, userId остаётся null
  }

  if (!userId) return { ok: false, reason: "missing_user" };

  return { ok: true, userId };
}
