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
    const { deck_id, status, telegram_id } = req.query;

    if (!deck_id || !status || !telegram_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Обновляем статус последней транзакции
    const { error: updateError } = await supabase
      .from('transactions')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('telegram_id', telegram_id)
      .eq('deck_id', deck_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    if (updateError) throw updateError;

    // Если платёж успешен, добавляем колоду в инвентарь
    if (status === 'completed') {
      const { data: existingDeck } = await supabase
        .from('player_inventory')
        .select('*')
        .eq('telegram_id', telegram_id)
        .eq('deck_id', deck_id)
        .single();

      if (!existingDeck) {
        const { error: inventoryError } = await supabase
          .from('player_inventory')
          .insert([{
            telegram_id: telegram_id,
            deck_id: deck_id,
            purchased_at: new Date().toISOString()
          }]);

        if (inventoryError) throw inventoryError;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Payment status updated to ${status}`
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}
