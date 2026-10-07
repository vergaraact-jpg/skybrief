const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NTFY_TOPIC = process.env.NTFY_TOPIC;

// Madrid
const LAT = 40.4168;
const LON = -3.7038;

// Modelos admitidos para reintento secuencial
const CANDIDATE_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-pro"
];

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return null;
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

// Misma lógica que la app: códigos de tormenta + energía convectiva (CAPE) + precipitación
function evaluarTormenta(wData, horas = 18) {
  const res = { nivel: 0, hora: "" };
  const h = wData.hourly;
  if (!h || !h.time) return res;

  const ahora = Date.now();
  let start = h.time.findIndex(t => new Date(t).getTime() >= ahora - 3600000);
  if (start < 0) start = 0;
  const end = Math.min(start + horas, h.time.length);

  let maxCape = 0, capeIdx = -1, probMax = 0, mm = 0, chubasco = false;
  const fmt = i => String(new Date(h.time[i]).getHours()).padStart(2, "0") + ":00";

  for (let i = start; i < end; i++) {
    const code = h.weathercode?.[i] ?? 0;
    const cape = h.cape?.[i] ?? 0;
    probMax = Math.max(probMax, h.precipitation_probability?.[i] ?? 0);
    mm += h.precipitation?.[i] ?? 0;
    if (cape > maxCape) { maxCape = cape; capeIdx = i; }
    if (code >= 80 && code <= 82) chubasco = true;
    if ([95, 96, 99].includes(code) && res.nivel < 2) {
      res.nivel = 2;
      res.hora = fmt(i);
    }
  }
  if ([95, 96, 99].includes(wData.current_weather?.weathercode) && res.nivel < 2) res.nivel = 2;

  if (res.nivel < 2 && ((maxCape >= 1500 && (probMax >= 10 || mm >= 0.5)) || (maxCape >= 800 && chubasco) || maxCape >= 2500)) {
    res.nivel = 1;
    res.hora = capeIdx >= 0 ? fmt(capeIdx) : "";
  }
  return res;
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
  if (!NTFY_TOPIC) {
    console.warn("⚠️ AVISO: La variable de entorno NTFY_TOPIC no está configurada en los Secrets de GitHub Actions.");
    console.warn("👉 Para activarla: ve a GitHub > Settings > Secrets and variables > Actions > New repository secret, y crea 'NTFY_TOPIC' con tu canal.");
    console.log("Ejecución finalizada con diagnóstico exitoso.");
    return;
  }

  // 1. Obtener métricas ampliadas de Open-Meteo (incluye hourly para análisis intradía y tormentas)
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,precipitation_probability,precipitation,cape,weathercode&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max&current_weather=true&timezone=auto`;
  const wRes = await fetch(weatherUrl);
  if (!wRes.ok) throw new Error(`Fallo Open-Meteo: ${wRes.status}`);
  const wData = await wRes.json();

  const tempActual = Math.round(wData.current_weather.temperature);
  const tempMin = Math.round(wData.daily.temperature_2m_min[0]);
  const tempMax = Math.round(wData.daily.temperature_2m_max[0]);
  const lluviaProbDiaria = wData.daily.precipitation_probability_max[0];
  const vientoMax = Math.round(wData.daily.windspeed_10m_max[0]);
  const intradia = analizarCambioIntradia(wData.hourly);

  // Riesgo de tormenta: la probabilidad de lluvia infravalora las tormentas convectivas
  const storm = evaluarTormenta(wData);
  const lluviaProb = storm.nivel >= 1 ? Math.max(lluviaProbDiaria, storm.nivel >= 2 ? 85 : 55) : lluviaProbDiaria;
  const weatherCode = storm.nivel >= 2 ? 95 : wData.current_weather.weathercode;

  if (process.env.MODE === "storm" && storm.nivel === 0) {
    console.log("Modo tormentas: sin riesgo de tormenta, no se envía aviso.");
    return;
  }

  if (process.env.MODE === "storm") {
    const titulo = storm.nivel >= 2 ? "🔴⛈️ ALERTA ROJA: TORMENTA" : "🟠⚡ RIESGO DE TORMENTA";
    const cuerpo = storm.nivel >= 2
      ? `Tormenta eléctrica prevista${storm.hora ? ` hacia las ${storm.hora}` : ""}. Lluvia intensa y posibles truenos: lleva paraguas y evita zonas descampadas.`
      : `Atmósfera muy inestable${storm.hora ? ` (máximo hacia las ${storm.hora})` : ""}: pueden formarse tormentas aunque la probabilidad de lluvia sea baja. Lleva paraguas.`;
    const encoded = ` =?utf-8?B?${Buffer.from(titulo, "utf-8").toString("base64")}?=`.trim();
    const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      body: cuerpo,
      headers: {
        "Title": encoded,
        "Priority": "urgent",
        "Tags": "rotating_light,thunder_cloud_and_rain,umbrella",
        "Icon": "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-rain.png"
      }
    });
    if (!r.ok) throw new Error(`Fallo ntfy: ${r.status}`);
    console.log("Alerta de tormenta enviada:", titulo, cuerpo);
    return;
  }

  // 2. Prompt Kumo enfocado en personalidad fresca, ropa, luz y estado vial si hay alerta
  const hasRoadHazard = lluviaProb >= 40 || tempMin <= 2 || vientoMax >= 45 || weatherCode >= 51;
  const roadHazardPrompt = hasRoadHazard
    ? "Hay riesgo meteorológico en carretera (lluvia, frío o viento): añade una advertencia brevísima para la conducción."
    : "Vía despejada: NO menciones coches, conducir ni tráfico. Céntrate exclusivamente en el tiempo, ropa y luz.";

  const systemInstruction = `Eres "Kumo", una copiloto meteorológica chibi despierta, con energía fresca, directa y con humor seco.
Tu trabajo: dar el resumen del tiempo, la ropa recomendada y la calidad de la luz del día en Madrid.

Reglas estrictas de tono:
1. NADA de diminutivos cursis (prohibido: "abriguito", "gotitas", "brrr", "fresquito").
2. Explica en 2 frases cortas la ropa recomendada y la luz del día, con humor seco o ironía limpia (ej: "12°C y lluvia: saca el chubasquero y ahórrate el peinado").
3. Regla vial: ${roadHazardPrompt}
4. Máximo 35 palabras en el mensaje.
5. Formato JSON estricto:
{
  "titular": "Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°): titular conciso",
  "mensaje": "Mensaje directo con ropa y luz",
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

  let titularFinal = `Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°)`;
  let mensajeFinal = "Luz neutra y condiciones estables. Ropa cómoda de entretiempo y calzado ligero.";
  let moodDetectado = "neutral";

  if (GEMINI_API_KEY) {
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
      generarMensajeNativo();
    }
  } else {
    console.log("GEMINI_API_KEY no detectada en Secrets. Utilizando motor nativo Kumo.");
    generarMensajeNativo();
  }

  function generarMensajeNativo() {
    if ([95, 96, 99].includes(weatherCode)) {
      titularFinal = `Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°): ${weatherCode >= 96 ? "Tormenta con granizo" : "Tormenta eléctrica"}`;
      mensajeFinal = `⚡ Actividad eléctrica y riesgo de granizo. Evita zonas abiertas o inundables y busca resguardo seguro.${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "alerta";
    } else if (lluviaProb >= 40) {
      titularFinal = `Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°): Lluvia a la vista`;
      mensajeFinal = `Luz difusa y asfalto mojado. Saca el paraguas, chubasquero y ahórrate peinarte. ⚠️ Precaución por calzada deslizante.${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "lluvia";
    } else if (tempMin <= 4 || tempActual <= 5) {
      titularFinal = `Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°): Frío cortante`;
      mensajeFinal = `Luz limpia pero aire gélido. Abrigo estructurado o cortavientos y calzado térmico.${tempMin <= 2 ? " ⚠️ Cuidado con placas de hielo en ruta." : ""}${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "frio";
    } else if (tempActual >= 28 || tempMax >= 30) {
      titularFinal = `Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°): Sol de justicia`;
      mensajeFinal = "Luz dura y calor implacable. Ropa de lino o algodón fresco, hidratación y sombra.";
      moodDetectado = "sol";
    } else {
      titularFinal = `Madrid a ${tempActual}°C (Mín ${tempMin}° / Máx ${tempMax}°): Día templado`;
      mensajeFinal = `Luz neutra y cielo despejado. Ropa cómoda de entretiempo y calzado ligero.${intradia.aviso ? " " + intradia.aviso : ""}`;
      moodDetectado = "neutral";
    }
  }

  // 3. Selección de condición climática visual (Sol, Lluvia, Frío, Calor, Tormenta)
  let tag = "sunny,sun_with_face";
  let iconoClima = "☀️";
  let iconUrl = "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-sun.png";

  if ([95, 96, 99].includes(weatherCode) || moodDetectado === "alerta") {
    tag = "thunderstorm,lightning,zap,umbrella";
    iconoClima = "⛈️";
    iconUrl = "https://raw.githubusercontent.com/vergaraact-jpg/skybrief/main/icons/weather-rain.png";
  } else if (moodDetectado === "lluvia" || lluviaProb >= 40 || (weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 90)) {
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

  // 4. Envío a ntfy con Avatar de Kumo e Iconos contextuales (RFC 2047 UTF-8 safe)
  const rawTitle = `${iconoClima} Kumo • ${titularFinal}`;
  const encodedTitle = ` =?utf-8?B?${Buffer.from(rawTitle, "utf-8").toString("base64")}?=`.trim();

  const pushRes = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    body: `${iconoClima} ${mensajeFinal}`,
    headers: {
      "Title": encodedTitle,
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
