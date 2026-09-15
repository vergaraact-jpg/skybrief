const webpush = require("web-push");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};

webpush.setVapidDetails(
  "mailto:tu-email@ejemplo.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

async function run() {
  // 1. Obtener clima
  const weatherRes = await fetch("https://api.open-meteo.com/v1/forecast?latitude=40.4168&longitude=-3.7038&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&current_weather=true&timezone=auto");
  const weatherData = await weatherRes.json();

  // 2. Generar consejo con Gemini
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `Analiza: Temp actual ${weatherData.current_weather.temperature}°C, Máx ${weatherData.daily.temperature_2m_max[0]}°C, Lluvia ${weatherData.daily.precipitation_probability_max[0]}%. 
Devuelve una sola frase de máximo 70 caracteres con qué ponerse o llevar hoy.`;

  const result = await model.generateContent(prompt);
  const consejo = result.response.text().trim();

  // 3. Enviar Push nativo a tu móvil
  const pushSubscription = JSON.parse(process.env.WEB_PUSH_SUBSCRIPTION);

  const payload = JSON.stringify({
    title: `SkyBrief • ${weatherData.current_weather.temperature}°C`,
    body: consejo
  });

  await webpush.sendNotification(pushSubscription, payload);
  console.log("Notificación push nativa enviada con éxito.");
}

run().catch(console.error);
