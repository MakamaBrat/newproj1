import { createClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "./_lib/telegramAuth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service_role — только сервер может выдавать подарки
);

// ВАЖНО: должно совпадать с GiftManager.totalDeckCount в Unity.
// Используется только для подарков с grant_all_decks=true.
const TOTAL_DECK_COUNT = 8;

// Раньше клиент (anon key) сам читал таблицу gifts и сам же писал в неё
// used_count/redeemer_ids, а PlayerDataService.SaveData() пытался (безуспешно —
// эти поля не сериализуются) выдать премиум/колоды напрямую. Теперь ВСЯ
// логика подарка — проверка лимита, идемпотентность по telegram_id и
// собственно выдача — атомарно происходит в Postgres-функции redeem_gift()
// (см. migration_gifts.sql), вызываемой только отсюда через service_role.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { telegram_id, code, init_data } = req.body || {};

    if (!telegram_id || !code) {
      return res.status(400).json({ success: false, error: "Missing telegram_id or code" });
    }

    // Проверяем, что telegram_id реально принадлежит вызывающему клиенту —
    // без этого кто угодно мог бы редимить подарки "от имени" чужого ID.
    const verified = verifyTelegramInitData(init_data, process.env.BOT_TOKEN);
    if (!verified.ok) {
      console.warn("[redeem-gift] init_data не прошла проверку:", verified.reason);
      return res.status(401).json({ success: false, error: `invalid_init_data:${verified.reason}` });
    }

    if (verified.userId !== String(telegram_id)) {
      console.warn(`[redeem-gift] telegram_id подделан: заявлен ${telegram_id}, а подпись от ${verified.userId}`);
      return res.status(403).json({ success: false, error: "telegram_id_mismatch" });
    }

    const { data, error } = await supabase.rpc("redeem_gift", {
      p_code: String(code),
      p_telegram_id: String(telegram_id),
      p_total_deck_count: TOTAL_DECK_COUNT
    });

    if (error) throw error;

    // data — это json, который вернула сама функция (см. migration_gifts.sql)
    return res.status(200).json(data);
  } catch (error) {
    console.error("[redeem-gift] error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
