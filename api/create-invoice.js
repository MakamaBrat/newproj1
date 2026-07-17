export default async function handler(req, res) {

  // Разрешаем запросы с любого домена
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(404).json({ error: "Not found" });
  }

  const { title, description, payload, stars } = req.body;

  // stars обязательно должен быть целым числом >= 1
  const amount = Number.isInteger(stars) ? stars : parseInt(stars, 10);
  if (!amount || amount <= 0) {
    console.error("Invalid stars value received:", stars);
    return res.status(400).json({ error: "Invalid stars amount", received: stars });
  }

  console.log("Creating invoice with:", { title, description, payload, amount });

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/createInvoiceLink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || "Покупка",
        description: description || "Внутриигровой товар",
        payload: payload || "item",
        currency: "XTR",
        prices: [{ label: title || "Товар", amount }]
      })
    }
  );

  const data = await response.json();

  // ВАЖНО: логируем полный ответ Telegram, чтобы видеть причину ошибки
  console.log("Telegram API response:", JSON.stringify(data));

  if (!data.ok) {
    return res.status(400).json({
      error: "Failed to create invoice",
      details: data.description || "Unknown error",
      telegramResponse: data
    });
  }

  // Telegram иногда возвращает ссылку с доменом telegram.me,
  // а Telegram.WebApp.openInvoice() на клиенте строго требует домен t.me
  const invoiceLink = data.result.replace("telegram.me", "t.me");

  return res.status(200).json({ invoiceLink });
}
