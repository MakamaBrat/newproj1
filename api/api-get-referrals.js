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
    const { telegram_id } = req.query;

    if (!telegram_id) {
      return res.status(400).json({ error: "telegram_id required" });
    }

    // Получаем количество рефералов
    const { data: referrals, error: refError } = await supabase
      .from('referrals')
      .select('*', { count: 'exact' })
      .eq('referrer_id', telegram_id);

    if (refError) throw refError;

    // Получаем баланс наград
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('reward_balance')
      .eq('telegram_id', telegram_id)
      .single();

    if (playerError && playerError.code !== 'PGRST116') {
      throw playerError;
    }

    return res.status(200).json({
      referral_count: referrals?.length || 0,
      reward_balance: player?.reward_balance || 0
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
