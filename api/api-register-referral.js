import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const REFERRAL_REWARD = 10; // Звёзды за каждого рефала

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const { referrer_id, new_user_id, new_user_username } = req.body;

    if (!referrer_id || !new_user_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Проверяем, не зарегистрирован ли уже этот реферал
    const { data: existing } = await supabase
      .from('referrals')
      .select('*')
      .eq('referred_user_id', new_user_id)
      .single();

    if (existing) {
      return res.status(200).json({ message: "Already registered" });
    }

    // Создаём нового игрока если его нет
    const { data: newPlayer, error: newPlayerError } = await supabase
      .from('players')
      .upsert({
        telegram_id: new_user_id,
        username: new_user_username,
        created_at: new Date().toISOString()
      }, { onConflict: 'telegram_id' })
      .select()
      .single();

    if (newPlayerError) throw newPlayerError;

    // Добавляем запись о реферале
    const { error: refError } = await supabase
      .from('referrals')
      .insert([{
        referrer_id: referrer_id,
        referred_user_id: new_user_id,
        referred_username: new_user_username,
        created_at: new Date().toISOString()
      }]);

    if (refError) throw refError;

    // Увеличиваем баланс наград рефереру
    const { data: referrer } = await supabase
      .from('players')
      .select('reward_balance')
      .eq('telegram_id', referrer_id)
      .single();

    const currentBalance = referrer?.reward_balance || 0;
    
    await supabase
      .from('players')
      .update({ reward_balance: currentBalance + REFERRAL_REWARD })
      .eq('telegram_id', referrer_id);

    return res.status(200).json({
      message: "Referral registered successfully",
      reward_added: REFERRAL_REWARD
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
