import { createClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "./_lib/telegramAuth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service_role — обходит RLS/триггер на players
);

// Единственное место, которое имеет право писать players.referred_by.
// Раньше это делал клиент (anon key, SavePlayer upsert) — при этом RLS-политика
// "players_update_own" была написана как using(true), то есть разрешала
// апдейтить ЛЮБУЮ чужую строку. Это позволяло:
//   1) напрямую накрутить себе рефералов, пропатчив referred_by кучи чужих
//      игроков на свой telegram_id, без единого перехода по реф-ссылке;
//   2) переустановить referred_by игроку повторно / на самого себя.
//
// Плюс: telegram_id раньше принимался от клиента "на слово". Теперь клиент
// обязан прислать init_data (подписанную Telegram строку), и мы проверяем
// HMAC бот-токеном — это подтверждает, что запрос реально пришёл от того
// telegram_id, который указан, а не от кого угодно, кто подделал JSON-тело.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { telegram_id, referrer_id, init_data } = req.body || {};

    if (!telegram_id || !referrer_id) {
      return res.status(400).json({ success: false, error: "Missing telegram_id or referrer_id" });
    }

    const verified = verifyTelegramInitData(init_data, process.env.BOT_TOKEN);
    if (!verified.ok) {
      console.warn("[set-referrer] init_data не прошла проверку:", verified.reason);
      return res.status(401).json({ success: false, error: `invalid_init_data:${verified.reason}` });
    }

    if (verified.userId !== String(telegram_id)) {
      console.warn(`[set-referrer] telegram_id подделан: заявлен ${telegram_id}, а подпись от ${verified.userId}`);
      return res.status(403).json({ success: false, error: "telegram_id_mismatch" });
    }

    // Нельзя быть рефералом самого себя.
    if (String(telegram_id) === String(referrer_id)) {
      return res.status(200).json({ success: true, applied: false, reason: "self_referral" });
    }

    // Реферер должен реально существовать как игрок.
    const { data: referrerPlayer, error: referrerError } = await supabase
      .from("players")
      .select("telegram_id")
      .eq("telegram_id", referrer_id)
      .maybeSingle();

    if (referrerError) throw referrerError;
    if (!referrerPlayer) {
      return res.status(200).json({ success: true, applied: false, reason: "referrer_not_found" });
    }

    // referred_by можно установить РОВНО ОДИН РАЗ (пока он NULL/пустой).
    // Никаких перезаписей — это не даёт задваивать/перекидывать реферала.
    const { data: me, error: meError } = await supabase
      .from("players")
      .select("referred_by")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (meError) throw meError;

    if (me && me.referred_by) {
      return res.status(200).json({ success: true, applied: false, reason: "already_set" });
    }

    const { error: updateError } = await supabase
      .from("players")
      .update({ referred_by: String(referrer_id) })
      .eq("telegram_id", telegram_id);

    if (updateError) throw updateError;

    return res.status(200).json({ success: true, applied: true });
  } catch (error) {
    console.error("[set-referrer] error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
