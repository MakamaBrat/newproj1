import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // anon key ок, это read-only и RLS его ограничит
);

// purchased_decks хранится в players как ТЕКСТ вида "[0,1,2]" (см. webhook.js).
function parseDeckList(raw) {
  if (!raw) return [];
  const cleaned = String(raw).replace(/[[\]"]/g, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

// Больше не читает отдельную таблицу transactions — статус покупки
// определяется напрямую по фактическому состоянию players, которое
// пишет webhook.js через service_role после successful_payment.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const { deck_id, telegram_id } = req.query;

    if (!deck_id || !telegram_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const { data: player, error } = await supabase
      .from("players")
      .select("is_premium, has_tarot_cover, has_special_ritual, purchased_decks")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (error) throw error;

    let granted = false;

    if (!player) {
      granted = false;
    } else if (deck_id === "premium") {
      granted = !!player.is_premium;
    } else if (deck_id === "cover") {
      granted = !!player.has_tarot_cover;
    } else if (deck_id === "special_ritual") {
      granted = !!player.has_special_ritual;
    } else if (deck_id.startsWith("deck_")) {
      const deckIndex = parseInt(deck_id.slice("deck_".length), 10);
      granted = !Number.isNaN(deckIndex) && parseDeckList(player.purchased_decks).includes(deckIndex);
    }

    return res.status(200).json({
      success: true,
      status: granted ? "completed" : "not_found"
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
