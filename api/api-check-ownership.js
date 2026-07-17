import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const { telegram_id, deck_id } = req.query;

    if (!telegram_id || !deck_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Проверяем инвентарь
    const { data: inventory, error } = await supabase
      .from('player_inventory')
      .select('*')
      .eq('telegram_id', telegram_id)
      .eq('deck_id', deck_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return res.status(200).json({
      owned: inventory !== null && inventory !== undefined
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
