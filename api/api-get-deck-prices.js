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
    // Получаем все колоды с ценами из БД
    const { data: decks, error } = await supabase
      .from('deck_prices')
      .select('*')
      .eq('is_active', true)
      .order('order', { ascending: true });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      decks: decks || []
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}
