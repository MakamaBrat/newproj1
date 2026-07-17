import { createClient } from "@supabase/supabase-js";
import { verifyTelegramInitData } from "./_lib/telegramAuth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service_role — обходит RLS/триггеры на players
);

// Правила разблокировки (должны совпадать с ShopManager.IsDecUnlockedByReferrals):
// колода 0 — всегда бесплатна; колода N (N>=1) — нужно >= N+1 рефералов.
function requiredReferrals(deckIndex) {
  return deckIndex + 1;
}

// ── purchased_decks хранится в players как ТЕКСТ вида "[0,1,2]" ──────────
// (см. комментарий в migration_gifts.sql), а НЕ как нативный Postgres-массив.
// Раньше здесь эту строку читали и писали напрямую как JS-массив
// (current.includes(...), [...current, deckIndex]) — это работало по
// случайности для чтения и полностью ломало данные при записи (спред строки
// разбивал её на отдельные символы). Приводим к тому же текстовому формату,
// который использует webhook.js и который ожидает клиент (Unity).
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
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { telegram_id, deck_index, init_data } = req.body || {};
    const deckIndex = parseInt(deck_index, 10);

    if (!telegram_id || Number.isNaN(deckIndex)) {
      return res.status(400).json({ success: false, error: "Missing telegram_id or deck_index" });
    }

    // Без этого клиент мог бы запросить выдачу колоды за рефералов от имени
    // любого telegram_id (не обязательно своего) — проверяем подпись Telegram.
    const verified = verifyTelegramInitData(init_data, process.env.BOT_TOKEN);
    if (!verified.ok) {
      console.warn("[grant-referral-deck] init_data не прошла проверку:", verified.reason);
      return res.status(401).json({ success: false, error: `invalid_init_data:${verified.reason}` });
    }

    if (verified.userId !== String(telegram_id)) {
      console.warn(`[grant-referral-deck] telegram_id подделан: заявлен ${telegram_id}, а подпись от ${verified.userId}`);
      return res.status(403).json({ success: false, error: "telegram_id_mismatch" });
    }

    if (deckIndex === 0) {
      return res.status(200).json({ success: true, granted: true, reason: "deck_0_always_free" });
    }

    // Сервер сам считает рефералов — клиенту верить нельзя.
    const { count, error: countError } = await supabase
      .from("players")
      .select("telegram_id", { count: "exact", head: true })
      .eq("referred_by", telegram_id);

    if (countError) throw countError;

    const need = requiredReferrals(deckIndex);
    if ((count || 0) < need) {
      return res.status(200).json({
        success: true,
        granted: false,
        reason: "not_enough_referrals",
        referrals: count || 0,
        required: need
      });
    }

    const { data: player, error: loadError } = await supabase
      .from("players")
      .select("purchased_decks")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (loadError) throw loadError;

    const current = parseDeckList(player?.purchased_decks);
    if (!current.includes(deckIndex)) {
      const updated = [...current, deckIndex];
      const { error: updateError } = await supabase
        .from("players")
        .update({ purchased_decks: stringifyDeckList(updated) })
        .eq("telegram_id", telegram_id);

      if (updateError) throw updateError;
    }

    return res.status(200).json({ success: true, granted: true });
  } catch (error) {
    console.error("[grant-referral-deck] error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
