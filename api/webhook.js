import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // ВАЖНО: service_role key, не anon!
);

// ── purchased_decks хранится в players как ТЕКСТ вида "[0,1,2]" ──────────
// (см. комментарий в migration_gifts.sql). Это НЕ нативный Postgres-массив,
// поэтому нельзя работать с ним как с обычным JS-массивом — supabase-js
// вернёт это поле строкой. БАГ, который был здесь до исправления: код
// делал current.includes(deckIndex) и [...current, deckIndex] прямо на
// этой строке — .includes() на строке работает "случайно" (проверяет
// вхождение подстроки), а спред строки разбивает её на отдельные символы,
// после чего purchased_decks в БД необратимо портится при первой же покупке.
// Приводим к общему текстовому формату явно.
function parseDeckList(raw) {
  if (!raw) return [];
  const cleaned = String(raw).replace(/[[\]"]/g, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

function stringifyDeckList(list) {
  return "[" + list.join(",") + "]";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  // ─── Проверка, что запрос реально пришёл от Telegram ───────────
  // Без этого любой, кто узнает URL вебхука, мог бы прислать сюда
  // поддельный update с successful_payment и получить премиум/колоду
  // БЕСПЛАТНО — сервер писал в players через service_role, ничего
  // не проверяя. secret_token задаётся один раз при setWebhook и
  // Telegram присылает его в этом заголовке в каждом запросе.
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("[webhook] Отклонён запрос с неверным/отсутствующим secret_token");
    return res.status(401).json({ ok: false });
  }

  const update = req.body;

  // ─── /start ───────────────────────────────────────────────────
  if (update.message && update.message.text === "/start") {
    const chatId = update.message.chat.id;

    const buttonText = "🔮 Start 🔮";

    const imagePath = join(process.cwd(), "api", "ShowCard.png");
    const imageBuffer = readFileSync(imagePath);
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("photo", imageBlob, "ShowCard.png");
    formData.append(
      "reply_markup",
      JSON.stringify({
        inline_keyboard: [
          [{ text: buttonText, url: "https://T.me/taroxabot/game" }]
        ]
      })
    );

    await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: formData }
    );

    return res.status(200).json({ ok: true });
  }

  // ─── pre_checkout_query ───────────────────────────────────────
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;

    await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerPreCheckoutQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pre_checkout_query_id: query.id, ok: true })
      }
    );

    return res.status(200).json({ ok: true });
  }

  // ─── successful_payment ─────────────────────────────────────
  // ЕДИНСТВЕННОЕ место, которое реально подтверждает оплату и
  // ЕДИНСТВЕННОЕ место, которое имеет право менять платёжные поля
  // в таблице players (через service_role, в обход RLS/триггеров).
  if (update.message && update.message.successful_payment) {
    const payment = update.message.successful_payment;
    const telegramId = String(update.message.from.id);
    const payload = payment.invoice_payload; // "premium" | "cover" | "special_ritual" | "deck_<N>"
    const chargeId = payment.telegram_payment_charge_id;

    console.log("[webhook] successful_payment:", telegramId, payload, chargeId);

    try {
      // Выдаём товар — пишем напрямую в players.
      //    Читаем текущее состояние строки, чтобы не затереть purchased_decks.
      const { data: player, error: loadError } = await supabase
        .from("players")
        .select("purchased_decks")
        .eq("telegram_id", telegramId)
        .maybeSingle();

      if (loadError) throw loadError;

      if (payload === "premium") {
        const { error: grantError } = await supabase
          .from("players")
          .update({
            is_premium: true,
            premium_granted_at: new Date().toISOString()
          })
          .eq("telegram_id", telegramId);
        if (grantError) throw grantError;

      } else if (payload === "cover") {
        const { error: grantError } = await supabase
          .from("players")
          .update({ has_tarot_cover: true })
          .eq("telegram_id", telegramId);
        if (grantError) throw grantError;

      } else if (payload === "special_ritual") {
        const { error: grantError } = await supabase
          .from("players")
          .update({ has_special_ritual: true })
          .eq("telegram_id", telegramId);
        if (grantError) throw grantError;

      } else if (payload && payload.startsWith("deck_")) {
        const deckIndex = parseInt(payload.slice("deck_".length), 10);

        if (Number.isNaN(deckIndex)) {
          throw new Error(`Некорректный payload колоды: ${payload}`);
        }

        const current = parseDeckList(player?.purchased_decks);
        if (!current.includes(deckIndex)) {
          const updated = [...current, deckIndex];
          const { error: grantError } = await supabase
            .from("players")
            .update({ purchased_decks: stringifyDeckList(updated) })
            .eq("telegram_id", telegramId);
          if (grantError) throw grantError;
        }
      } else {
        throw new Error(`Неизвестный payload товара: ${payload}`);
      }

      console.log("[webhook] покупка зачислена:", telegramId, payload);
    } catch (err) {
      // Если тут упадёт — Stars уже списаны у пользователя, но товар не выдан.
      // Логируй громко, чтобы можно было разрулить вручную.
      console.error("[webhook] ОШИБКА зачисления покупки:", err, {
        telegramId,
        payload,
        chargeId
      });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}
