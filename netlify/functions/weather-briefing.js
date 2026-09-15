exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { weatherData, userContext = {} } = JSON.parse(event.body || "{}");
    const apiKey = process.env.GEMINI_API_KEY;

    if (!weatherData) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Faltan datos meteorológicos" })
      };
    }

    const currentTemp = Math.round(weatherData.current_weather.temperature);
    const rainProb = weatherData.daily?.precipitation_probability_max?.[0] || 0;
    const uvIndex = weatherData.daily?.uv_index_max?.[0] || 0;
    const wind = Math.round(weatherData.current_weather.windspeed);
    const minTemp = weatherData.daily?.temperature_2m_min?.[0] !== undefined ? Math.round(weatherData.daily.temperature_2m_min[0]) : currentTemp - 3;
    const maxTemp = weatherData.daily?.temperature_2m_max?.[0] !== undefined ? Math.round(weatherData.daily.temperature_2m_max[0]) : currentTemp + 3;
    const transporte = userContext.transporte || "coche";

    if (!apiKey) {
      // Fallback si no se ha configurado GEMINI_API_KEY en Netlify
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentTemp,
          rainProb,
          uvIndex,
          wind,
          advice: currentTemp < 15 ? "Ambiente fresco. Viste en capas." : "Tiempo agradable. Ropa cómoda y ligera.",
          items: ["Prenda principal", "Calzado cómodo", rainProb >= 40 ? "Paraguas" : "Gafas de sol"],
          palette: ["#38BDF8", "#94A3B8", "#0F172A"],
          lightDescription: `Modo transporte: ${transporte}`
        })
      };
    }

    const promptPro = `
Analiza el clima de hoy para un usuario que viaja en ${transporte}:
- Temp mín/máx: ${minTemp}°C / ${maxTemp}°C
- Viento/Rachas: ${wind} km/h
- Lluvia/Hielo: Probabilidad ${rainProb}%

Devuelve un JSON con:
{
  "consejo_vestimenta": "Ropa recomendada",
  "consejo_transporte": "Recomendación para ${transporte} (ej. riesgo de acuaplaning, escarcha en cristales, salir 10 min antes)",
  "llevar": ["ítem 1", "ítem 2"],
  "paleta_hex": ["#HEX1", "#HEX2", "#HEX3"]
}
`.trim();

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptPro }] }] })
    });

    const data = await res.json();
    const raw = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(raw.replace(/```json|```/gi, "").trim());

    const combinedAdvice = `${parsed.consejo_vestimenta || ""} ${parsed.consejo_transporte ? "• " + parsed.consejo_transporte : ""}`.trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentTemp,
        rainProb,
        uvIndex,
        wind,
        advice: combinedAdvice || parsed.consejo_vestimenta,
        items: parsed.llevar || [],
        palette: parsed.paleta_hex || ["#38BDF8", "#94A3B8", "#E2E8F0"],
        lightDescription: `Contexto para ${transporte}: ${parsed.consejo_transporte || "Circulación normal"}`
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
