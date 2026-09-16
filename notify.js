const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NTFY_TOPIC = process.env.NTFY_TOPIC;

// Madrid
const LAT = 40.4168;
const LON = -3.7038;

// Modelos admitidos para reintento secuencial
const CANDIDATE_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-3.6-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-pro"
];

async function callGemini(prompt) {
  let lastErr = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const gRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      if (gRes.status === 404) {
        continue; // Probar siguiente modelo
      }

      if (!gRes.ok) {
        const errText = await gRes.text();
        throw new Error(`HTTP ${gRes.status}: ${errText}`);
      }

      const gData = await gRes.json();
      if (gData.candidates && gData.candidates[0]?.content?.parts?.[0]?.text) {
        return gData.candidates[0].content.parts[0].text.trim();
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No se pudo obtener respuesta de ningún modelo de Gemini");
}

function analizarCambioIntradia(hourlyData) {
  if (!hourlyData || !hourlyData.temperature_2m) return { aviso: null };

  const tempManana = Math.round(hourlyData.temperature_2m[10] ?? 15);
  const tempTarde = Math.round(hourlyData.temperature_2m[19] ?? 15);
  const lluviaManana = hourlyData.precipitation_probability?.[10] ?? 0;
  const lluviaTarde = hourlyData.precipitation_probability?.[19] ?? 0;

  const difTemp = Math.round(tempTarde - tempManana);
  let avisoIntradia = null;

  if (difTemp <= -7) {
    avisoIntradia = `Desplome térmico: Caerán ${Math.abs(difTemp)}°C por la tarde (${tempTarde}°C).`;
  } else if (difTemp >= 8) {
    avisoIntradia = `Amplitud térmica: De ${tempManana}°C a ${tempTarde}°C por la tarde. Viste en capas.`;
  } else if (lluviaManana < 20 && lluviaTarde >= 50) {
    avisoIntradia = `Lluvia prevista por la tarde (${lluviaTarde}% prob.). Lleva paraguas.`;
  }

  return {
    tempManana,
    tempTarde,
    difTemp,
    aviso: avisoIntradia
  };
}

function extractJsonFromText(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {}

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
    } catch (e) {}
  }

  return null;
}

async function run() {
  if (!GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  if (!NTFY_TOPIC) throw new Error("Falta NTFY_TOPIC");

  // 1. Obtener métricas ampliadas de Open-Meteo (incluye hourly para análisis intradía)
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,precipitation_probability,weathercode&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max&current_weather=true&timezone=auto`;
  const wRes = await fetch(weatherUrl);
  if (!wRes.ok) throw new Error(`Fallo Open-Meteo: ${wRes.status}`);
  const wData = await wRes.json();

  const tempActual = Math.round(wData.current_weather.temperature);
  const tempMin = Math.round(wData.daily.temperature_2m_min[0]);
  const tempMax = Math.round(wData.daily.temperature_2m_max[0]);
  const lluviaProb = wData.daily.precipitation_probability_max[0];
  const vientoMax = Math.round(wData.daily.windspeed_10m_max[0]);
  const weatherCode = wData.current_weather.weathercode;
  const intradia = analizarCambioIntradia(wData.hourly);

  // 2. Prompt Kumo enfocado en personalidad fresca, ropa y estado vial
  const systemInstruction = `Eres "Kumo", una pequeña copiloto meteorológica chibi (chica con gafas, pelo negro y piel mulata), despierta, con energía fresca y directa.
Tu trabajo: dar el resumen del tiempo, la ropa recomendada y el estado vial/conducción del día para Madrid.

Reglas estrictas de tono:
1. NADA de diminutivos cursis (prohibido: "abriguito", "gotitas", "brrr", "waaa").
2. Habla de tú a tú, cercano pero con ironía limpia o humor práctico.
3. Máximo 35 palabras en el mensaje.
4. Formato JSON estricto:
{
  "titular": "Madrid a ${tempActual}°C: titular conciso e irónico o directo",
  "mensaje": "Mensaje directo con ropa y recomendación vial",
  "mood": "sol" | "lluvia" | "frio" | "viento" | "alerta" | "neutral"
}`;

  const prompt = `${systemInstruction}

Datos meteorológicos de Madrid:
- Temp actual: ${tempActual}°C (Mín: ${tempMin}°C, Máx: ${tempMax}°C)
- Análisis intradía (10h vs 19h): ${intradia.aviso || "Sin cambios bruscos"}
- Probabilidad de lluvia: ${lluviaProb}%
- Viento máx: ${vientoMax} km/h
- Código WMO: ${weatherCode}

Responde exclusivamente con el JSON estricto:`;

  let titularFinal = `Madrid a ${tempActual}°C`;
  let mensajeFinal = "Tiempo agradable. Ropa cómoda y calzado ligero.";
  let moodDetectado = "neutral";

  try {
    const raw = await callGemini(prompt);
    const parsed = extractJsonFromText(raw);
    if (parsed && parsed.mensaje) {
      titularFinal = parsed.titular || titularFinal;
      mensajeFinal = parsed.mensaje;
      moodDetectado = (parsed.mood || "neutral").toLowerCase();
    } else if (raw) {
      mensajeFinal = raw.replace(/[{}"]/g, "").trim();
    }
  } catch (err) {
    console.warn("Fallo en Gemini, generando mensaje nativo Kumo de respaldo:", err.message);
    if (lluviaProb >= 40) {
      titularFinal = `Madrid a ${tempActual}°C: Lluvia a la vista`;
      mensajeFinal = `Luz difusa y asfalto mojado. Saca el paraguas, chubasquero y duplica la distancia en coche.${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "lluvia";
    } else if (tempMin <= 4 || tempActual <= 5) {
      titularFinal = `Madrid a ${tempActual}°C: Frío cortante`;
      mensajeFinal = `Luz limpia pero aire helado. Abrigo cortavientos, calzado térmico y revisa escarcha en lunas.${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "frio";
    } else if (tempActual >= 28 || tempMax >= 30) {
      titularFinal = `Madrid a ${tempActual}°C: Sol de justicia`;
      mensajeFinal = "Luz dura y calor directo. Ropa fresca, hidratación y ventila el habitáculo antes de arrancar.";
      moodDetectado = "sol";
    } else {
      titularFinal = `Madrid a ${tempActual}°C: Día templado`;
      mensajeFinal = `Luz neutra y condiciones estables. Ropa cómoda de entretiempo y calzado ligero.${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "neutral";
    }
  }

  // 3. Selección de condición climática visual (Sol, Lluvia, Frío, Calor)
  let tag = "sunny,sun_with_face";
  let iconoClima = "☀️";
  let iconUrl = "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-sun.png";

  if (moodDetectado === "lluvia" || lluviaProb >= 40 || (weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 99)) {
    tag = "rain_cloud,umbrella,droplet";
    iconoClima = "🌧️";
    iconUrl = "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-rain.png";
  } else if (moodDetectado === "frio" || tempMin <= 4 || tempActual <= 5) {
    tag = "snowflake,cold_face,ice_cube";
    iconoClima = "❄️";
    iconUrl = "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-cold.png";
  } else if (moodDetectado === "sol" || tempActual >= 28 || tempMax >= 30) {
    tag = "hot_face,fire,sun";
    iconoClima = "🔥";
    iconUrl = "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-heat.png";
  }

  // 4. Envío a ntfy con Avatar de Kumo e Iconos contextuales
  const pushRes = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    body: `${iconoClima} ${mensajeFinal}`,
    headers: {
      "Title": `${iconoClima} Kumo • ${titularFinal}`,
      "Priority": lluviaProb > 60 || tempMin <= 2 ? "high" : "default",
      "Tags": tag,
      "Icon": "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/kumo-avatar.png"
    }
  });

  if (!pushRes.ok) throw new Error(`Fallo ntfy: ${pushRes.status}`);
  console.log("Notificación Kumo enviada con éxito a ntfy.sh/" + NTFY_TOPIC + ":\n[" + titularFinal + "]\n" + mensajeFinal);
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
