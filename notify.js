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
  const lluviaProb = wData.daily.precipitation_probability_max[0];
  const vientoMax = Math.round(wData.daily.windspeed_10m_max[0]);
  const weatherCode = wData.current_weather.weathercode;
  const intradia = analizarCambioIntradia(wData.hourly);

  // 2. Prompt enfocado en Clima general + Módulo Coche/Tráfico + Intradía
  const prompt = `Actúa como asesor meteorológico y vial para Madrid.
Datos de hoy:
- Temperatura actual: ${tempActual}°C (Mín: ${tempMin}°C)
- Análisis intradía (10h vs 19h): ${intradia.aviso || "Sin cambios bruscos"}
- Probabilidad de lluvia: ${lluviaProb}%
- Viento máx: ${vientoMax} km/h
- Código WMO: ${weatherCode}

Devuelve EXACTAMENTE dos líneas cortas (máximo 120 caracteres en total):
Línea 1: Ropa recomendada y sensación térmica (incluye aviso si hay cambio brusco intradía).
Línea 2: [Coche & Vía]: Estado del vehículo (parabrisas/hielo si hace frío) y recomendación de conducción (adherencia, visibilidad o viento).`;

  let mensaje;
  try {
    mensaje = await callGemini(prompt);
  } catch (err) {
    console.warn("Fallo en Gemini, generando mensaje nativo de respaldo:", err.message);
    let ropa = tempActual > 22 ? "Ropa fresca y ligera." : tempActual < 12 ? "Abrigo y chaqueta cortavientos." : "Ropa de entretiempo.";
    if (intradia.aviso) ropa += ` ${intradia.aviso}`;
    const via = lluviaProb > 40 ? "[Coche & Vía]: Calzada húmeda, aumenta distancia de frenado." : tempMin <= 3 ? "[Coche & Vía]: Revisa escarcha en lunas y batería." : "[Coche & Vía]: Asfalto seco y buena adherencia.";
    mensaje = `${ropa}\n${via}`;
  }

  // 3. Selección de tag para ntfy según condiciones
  let tag = "partly_sunny";
  if (lluviaProb > 40) tag = "umbrella,warning";
  else if (tempMin <= 3) tag = "snowflake,car";
  else if (vientoMax > 40) tag = "wind_blowing_face,warning";

  // 4. Envío a ntfy
  const pushRes = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    body: mensaje,
    headers: {
      "Title": `Madrid ${tempActual}°C - Clima y Estado Vial`,
      "Priority": lluviaProb > 60 || tempMin <= 2 ? "high" : "default",
      "Tags": tag
    }
  });

  if (!pushRes.ok) throw new Error(`Fallo ntfy: ${pushRes.status}`);
  console.log("Notificación enviada con éxito a ntfy.sh/" + NTFY_TOPIC + ":\n", mensaje);
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
