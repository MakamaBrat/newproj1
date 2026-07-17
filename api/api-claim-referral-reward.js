import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ error: "telegram_id required" });
    }

    // Получаем текущий баланс
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('reward_balance')
      .eq('telegram_id', telegram_id)
      .single();

    if (playerError) throw playerError;

    const rewardAmount = player.reward_balance;

    if (rewardAmount <= 0) {
      return res.status(400).json({ error: "No rewards to claim" });
    }

    // Обнуляем баланс после выплаты
    const { error: updateError } = await supabase
      .from('players')
      .update({ reward_balance: 0 })
      .eq('telegram_id', telegram_id);

    if (updateError) throw updateError;

    // Логируем выплату
    await supabase
      .from('referral_rewards')
      .insert([{
        referrer_id: telegram_id,
        amount: rewardAmount,
        status: 'claimed',
        claimed_at: new Date().toISOString()
      }]);

    // TODO: Отправить звёзды через Telegram API
    // Используй метод sendStarPayments API Telegram

    return res.status(200).json({
      success: true,
      amount_claimed: rewardAmount,
      message: "Reward claimed successfully"
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
