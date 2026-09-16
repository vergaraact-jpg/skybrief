// ==========================================
// ESTADO GLOBAL
// ==========================================
const DEFAULT_COORDS = { lat: 40.4168, lon: -3.7038, city: "Madrid" };
const DEFAULT_SCHEDULE = {
  morning: 9,
  afternoon: 15,
  night: 21
};

let modoTransporte = "metro"; // 'metro' o 'coche'
let datosMeteorologicos = null;
let coordsActuales = { ...DEFAULT_COORDS };
let mapa = null;

// Lista ampliada de modelos oficiales y experimentales de Gemini
const EXPANDED_KNOWN_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite-preview-02-05",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-thinking-exp-01-21",
  "gemini-2.0-flash-thinking-exp",
  "gemini-2.0-pro-exp-02-05",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash-8b-latest",
  "gemini-1.5-pro",
  "gemini-1.5-pro-latest",
  "gemini-1.0-pro",
  "gemini-pro"
];

// Elementos DOM
const cityTitle = document.getElementById("city-title");
const tempDisplay = document.getElementById("temp-display");
const alertText = document.getElementById("alert-text");
const transportLabel = document.getElementById("transport-mode-label");
const windDisplay = document.getElementById("wind-display") || document.getElementById("wind-metric");
const uvDisplay = document.getElementById("uv-display") || document.getElementById("uv-metric");
const rainDisplay = document.getElementById("rain-display") || document.getElementById("rain-metric");
const itemsList = document.getElementById("items-list");
const paletteContainer = document.getElementById("palette-container");
const airText = document.getElementById("air-text");
const apiKeyInput = document.getElementById("api-key");
const btnSaveKey = document.getElementById("btn-save-key");
const keyStatus = document.getElementById("key-status");
const btnWalk = document.getElementById("btn-transport-walk");
const btnCar = document.getElementById("btn-transport-car");
const btnRefresh = document.getElementById("btn-refresh-icon");

// Cargar clave previa al iniciar
if (localStorage.getItem("gemini_key")) {
  apiKeyInput.value = localStorage.getItem("gemini_key");
  const modeloGuardado = localStorage.getItem("gemini_active_model") || "Modo Pro IA";
  keyStatus.textContent = `● ${modeloGuardado} Conectado`;
  keyStatus.style.color = "#38bdf8";
}

// ==========================================
// 1. SELECTOR DE TRANSPORTE
// ==========================================
btnWalk.addEventListener("click", () => {
  btnWalk.classList.add("active");
  btnCar.classList.remove("active");
  modoTransporte = "metro";
  transportLabel.textContent = "Modo transporte: a pie / metro";
  procesarReporteCompleto();
});

btnCar.addEventListener("click", () => {
  btnCar.classList.add("active");
  btnWalk.classList.remove("active");
  modoTransporte = "coche";
  transportLabel.textContent = "Modo transporte: coche / moto";
  procesarReporteCompleto();
});

// Guardar clave y forzar actualización
btnSaveKey.addEventListener("click", () => {
  const clave = apiKeyInput.value.trim();
  if (clave) {
    localStorage.setItem("gemini_key", clave);
    localStorage.removeItem("gemini_active_model");
    keyStatus.textContent = "Clave guardada. Detectando modelos activos...";
    keyStatus.style.color = "#38bdf8";
    procesarReporteCompleto();
  } else {
    localStorage.removeItem("gemini_key");
    localStorage.removeItem("gemini_active_model");
    keyStatus.textContent = "Clave eliminada. Modo Básico activo.";
    keyStatus.style.color = "#94a3b8";
    procesarReporteCompleto();
  }
});

btnRefresh.addEventListener("click", () => {
  iniciarApp();
});

// ==========================================
// 2. CONFIGURACIÓN HORARIA DINÁMICA
// ==========================================
function getUserSchedule() {
  const saved = localStorage.getItem("skybrief_user_schedule");
  if (!saved) return DEFAULT_SCHEDULE;
  try {
    return JSON.parse(saved);
  } catch (e) {
    return DEFAULT_SCHEDULE;
  }
}

function initScheduleInputs() {
  const schedule = getUserSchedule();
  const mInput = document.getElementById("time-morning");
  const aInput = document.getElementById("time-afternoon");
  const nInput = document.getElementById("time-night");

  if (mInput) mInput.value = `${String(schedule.morning).padStart(2, "0")}:00`;
  if (aInput) aInput.value = `${String(schedule.afternoon).padStart(2, "0")}:00`;
  if (nInput) nInput.value = `${String(schedule.night).padStart(2, "0")}:00`;

  const btnSave = document.getElementById("btn-save-schedule");
  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const updatedSchedule = {
        morning: parseInt(mInput?.value.split(":")[0], 10) || DEFAULT_SCHEDULE.morning,
        afternoon: parseInt(aInput?.value.split(":")[0], 10) || DEFAULT_SCHEDULE.afternoon,
        night: parseInt(nInput?.value.split(":")[0], 10) || DEFAULT_SCHEDULE.night
      };
      localStorage.setItem("skybrief_user_schedule", JSON.stringify(updatedSchedule));
      
      const scheduleStatus = document.getElementById("schedule-status");
      if (scheduleStatus) {
        scheduleStatus.textContent = "✓ Horarios guardados correctamente.";
        scheduleStatus.style.color = "#38bdf8";
        setTimeout(() => { scheduleStatus.textContent = ""; }, 3000);
      }
      
      alert("Horarios guardados correctamente.");
      procesarReporteCompleto();
    });
  }
}

// ==========================================
// 3. APIS EXTERNAS: CLIMA, AIRE Y UBICACIÓN
// ==========================================
async function obtenerUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ...DEFAULT_COORDS });

    const timer = setTimeout(() => {
      resolve({ ...DEFAULT_COORDS });
    }, 2500);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        clearTimeout(timer);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        let city = "Tu Ubicación";
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
          const data = await res.json();
          city = data.address.city || data.address.town || data.address.village || data.address.suburb || "Tu Ubicación";
        } catch (e) {
          console.warn("Geocodificación inversa fallida:", e);
        }
        resolve({ lat, lon, city });
      },
      (err) => {
        clearTimeout(timer);
        console.warn("Geolocalización denegada o timeout, usando Madrid:", err);
        resolve({ ...DEFAULT_COORDS });
      },
      { timeout: 2500, enableHighAccuracy: false, maximumAge: 60000 }
    );
  });
}

// Endpoint con current, hourly y daily completo (incluye weather_code horario para intradía)
async function getWeatherData(lat = 40.4168, lon = -3.7038) {
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,weather_code,visibility&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code,uv_index_max&timezone=auto`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5`;

  const [resClima, resAire] = await Promise.all([
    fetch(weatherUrl).then(r => {
      if (!r.ok) throw new Error(`Error Open-Meteo: ${r.status}`);
      return r.json();
    }),
    fetch(airUrl).then(r => r.json()).catch(() => null)
  ]);

  // Asegurar compatibilidad con current_weather si se consulta directamente
  if (resClima && !resClima.current_weather && resClima.current) {
    resClima.current_weather = {
      temperature: resClima.current.temperature_2m,
      windspeed: resClima.current.wind_speed_10m,
      winddirection: 0,
      weathercode: resClima.current.weather_code,
      is_day: resClima.current.is_day,
      time: resClima.current.time
    };
  }

  return { clima: resClima, aire: resAire };
}

// ==========================================
// 4. MAPA EN VIVO (LEAFLET)
// ==========================================
function inicializarMapa(lat, lon) {
  if (!mapa) {
    mapa = L.map("map", { zoomControl: false }).setView([lat, lon], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(mapa);
  } else {
    mapa.setView([lat, lon], 12);
  }

  L.marker([lat, lon]).addTo(mapa);
}

// ==========================================
// 5. MOTORES DE ANÁLISIS (HÍBRIDO) Y PREDICCIÓN INTRADÍA
// ==========================================
function analizarCambioIntradia(hourlyData, schedule) {
  if (!hourlyData || !hourlyData.temperature_2m) {
    return { tempManana: null, tempTarde: null, difTemp: 0, aviso: null };
  }

  // Índices de referencia del día actual: 10:00 AM y 19:00 PM
  const horaManana = schedule?.morning ?? 10;
  const horaTarde = schedule?.afternoon ? Math.max(schedule.afternoon, 19) : 19;

  const tempManana = Math.round(hourlyData.temperature_2m[horaManana] ?? hourlyData.temperature_2m[10] ?? 15);
  const tempTarde = Math.round(hourlyData.temperature_2m[horaTarde] ?? hourlyData.temperature_2m[19] ?? tempManana);
  const lluviaManana = hourlyData.precipitation_probability?.[horaManana] ?? hourlyData.precipitation_probability?.[10] ?? 0;
  const lluviaTarde = hourlyData.precipitation_probability?.[horaTarde] ?? hourlyData.precipitation_probability?.[19] ?? 0;

  const difTemp = Math.round(tempTarde - tempManana);
  let avisoIntradia = null;

  // Caída brusca de temperatura por la tarde
  if (difTemp <= -7) {
    avisoIntradia = `Desplome térmico: Caerán ${Math.abs(difTemp)}°C hacia la tarde (${tempTarde}°C). Lleva una capa extra.`;
  }
  // Subida drástica de temperatura
  else if (difTemp >= 8) {
    avisoIntradia = `Amplitud térmica alta: De ${tempManana}°C por la mañana a ${tempTarde}°C por la tarde. Viste en capas fácilmente removibles.`;
  }
  // Mañana seca pero tarde con lluvia
  else if (lluviaManana < 20 && lluviaTarde >= 50) {
    avisoIntradia = `Cambio de tiempo: La mañana será seca, pero la lluvia entrará sobre las ${horaTarde}:00 (${lluviaTarde}% prob.). No olvides el paraguas.`;
  }

  return {
    tempManana,
    tempTarde,
    difTemp,
    aviso: avisoIntradia
  };
}

function motorNativo(clima, transporte, schedule) {
  const temp = Math.round(clima.current?.temperature_2m ?? clima.current_weather?.temperature ?? 20);
  const probLluvia = clima.daily?.precipitation_probability_max?.[0] ?? 0;
  const viento = Math.round(clima.current?.wind_speed_10m ?? clima.current_weather?.windspeed ?? 10);
  const uv = clima.daily?.uv_index_max?.[0] ?? 0;
  const intradia = clima.hourly ? analizarCambioIntradia(clima.hourly, schedule) : { aviso: null };

  let items = [];
  let consejo = "Tiempo agradable. Ropa cómoda y ligera.";
  let paleta = ["#38BDF8", "#94A3B8", "#0F172A"];

  if (temp > 28) {
    consejo = transporte === "coche" 
      ? "Calor alto. Ventila el habitáculo antes de conducir." 
      : "Calor intenso en trayectos a pie. Hidratación continua.";
    items.push("Prenda fresca", "Gorra o sombrero", "Gafas de sol");
    paleta = ["#b45309", "#f59e0b", "#fef3c7"];
  } else if (temp < 14) {
    consejo = "Ambiente fresco. Imprescindible chaqueta o capa cortavientos.";
    items.push("Chaqueta estructurada", "Calzado cerrado");
    paleta = ["#1e293b", "#475569", "#cbd5e1"];
  } else {
    items.push("Prenda principal", "Calzado cómodo");
  }

  if (intradia.aviso) {
    consejo = intradia.aviso;
    if (intradia.difTemp <= -7 || intradia.difTemp >= 8) items.push("Capa de ropa extra");
    if (intradia.aviso.includes("paraguas")) items.push("Paraguas compacto");
  } else if (probLluvia > 40) {
    consejo += " Probabilidad de precipitaciones.";
    items.push(transporte === "coche" ? "Líquido limpiaparabrisas" : "Paraguas compacto");
  }

  if (uv >= 6) items.push("Protector solar");

  return { temp: `${temp}°C`, consejo, items, paleta, intradia };
}

// Extractor de JSON universal y seguro
function extractJsonFromText(rawText) {
  if (!rawText) throw new Error("Respuesta vacía de la IA.");
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
    const jsonCandidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonCandidate);
    } catch (e) {}
  }

  throw new Error("No se pudo interpretar el formato JSON de Gemini.");
}

// Descubre dinámicamente todos los modelos activos para la clave del usuario
async function discoverAvailableModels(apiKey) {
  let apiModels = [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      if (data.models && Array.isArray(data.models)) {
        apiModels = data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
          .map(m => m.name.replace(/^models\//, ""));
      }
    }
  } catch (e) {
    console.warn("No se pudo consultar el catálogo /models:", e);
  }

  const fullList = [...new Set([...apiModels, ...EXPANDED_KNOWN_MODELS])];

  fullList.sort((a, b) => {
    const score = (name) => {
      let s = 0;
      if (name.includes("flash")) s += 10;
      if (name.includes("2.0") || name.includes("2.5") || name.includes("3.")) s += 5;
      if (name.includes("1.5")) s += 3;
      return s;
    };
    return score(b) - score(a);
  });

  return fullList;
}

// BÚSQUEDA SECUENCIAL AUTO-DESCARTABLE UNIVERSAL
async function callGeminiAutoDetect(apiKey, promptText) {
  const cleanKey = apiKey.trim();
  const cached = localStorage.getItem("gemini_active_model");
  const availableModels = await discoverAvailableModels(cleanKey);
  
  const queue = cached 
    ? [cached, ...availableModels.filter(m => m !== cached)]
    : availableModels;

  let lastError = null;

  for (const model of queue) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      if (response.status === 404) {
        console.warn(`[Auto-Detect] Modelo '${model}' 404, probando siguiente...`);
        localStorage.removeItem("gemini_active_model");
        continue;
      }

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = (result.error?.message || "").toLowerCase();
        if (errorMsg.includes("not found") || errorMsg.includes("not supported") || errorMsg.includes("404")) {
          console.warn(`[Auto-Detect] Modelo '${model}' no admitido (${errorMsg}), saltando...`);
          localStorage.removeItem("gemini_active_model");
          continue;
        }
        if (errorMsg.includes("api_key_invalid") || errorMsg.includes("api key not valid") || response.status === 403) {
          throw new Error("API Key inválida. Revisa tu clave en Google AI Studio.");
        }
        throw new Error(result.error?.message || `Error HTTP ${response.status}`);
      }

      if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
        continue;
      }

      localStorage.setItem("gemini_active_model", model);
      console.log(`[Auto-Detect] ✓ Modelo activo fijado con éxito: ${model}`);
      return { text: result.candidates[0].content.parts[0].text, model };

    } catch (err) {
      lastError = err;
      const msg = (err.message || "").toLowerCase();
      if (msg.includes("inválida") || msg.includes("api key not valid")) {
        throw err;
      }
    }
  }

  throw new Error(`Ningún modelo respondió. ${lastError?.message || "Comprueba tu clave o conexión."}`);
}

async function motorGemini(clima, transporte, city, apiKey, schedule) {
  const currentTemp = Math.round(clima.current?.temperature_2m ?? clima.current_weather?.temperature ?? 20);
  const maxTemp = clima.daily?.temperature_2m_max?.[0] ?? currentTemp;
  const minTemp = clima.daily?.temperature_2m_min?.[0] ?? currentTemp;
  const probLluvia = clima.daily?.precipitation_probability_max?.[0] ?? 0;
  const uv = clima.daily?.uv_index_max?.[0] ?? 0;
  const viento = Math.round(clima.current?.wind_speed_10m ?? clima.current_weather?.windspeed ?? 10);

  // Extraer temperaturas horarias específicas de los tramos elegidos
  const tempManana = clima.hourly?.temperature_2m?.[schedule.morning] !== undefined 
    ? Math.round(clima.hourly.temperature_2m[schedule.morning]) 
    : currentTemp;
  const tempTarde = clima.hourly?.temperature_2m?.[schedule.afternoon] !== undefined 
    ? Math.round(clima.hourly.temperature_2m[schedule.afternoon]) 
    : maxTemp;
  const tempNoche = clima.hourly?.temperature_2m?.[schedule.night] !== undefined 
    ? Math.round(clima.hourly.temperature_2m[schedule.night]) 
    : minTemp;

  const intradia = clima.hourly ? analizarCambioIntradia(clima.hourly, schedule) : { aviso: null };

  const prompt = `Analiza estos datos meteorológicos de ${city}:
- Temp actual: ${currentTemp}°C (Máx: ${maxTemp}°C, Mín: ${minTemp}°C)
- Tramos del día elegidos por el usuario:
  * Mañana (${schedule.morning}:00): ${tempManana}°C
  * Tarde (${schedule.afternoon}:00): ${tempTarde}°C
  * Noche (${schedule.night}:00): ${tempNoche}°C
- Análisis intradía: ${intradia.aviso || "Sin saltos bruscos térmicos ni de precipitación"}
- Prob. lluvia: ${probLluvia}%
- UV: ${uv}
- Viento: ${viento} km/h
- Modo de transporte elegido por el usuario: ${transporte}

Responde exclusivamente con un JSON válido con este formato:
{
  "temp": "${currentTemp}°C",
  "consejo": "Consejo directo de ropa y trayecto en ${transporte} adaptado al día (máx 15 palabras)",
  "items": ["Prenda 1", "Accesorio 2", "Accesorio 3"],
  "paleta": ["#HEX1", "#HEX2", "#HEX3"]
}`;

  const { text: raw, model } = await callGeminiAutoDetect(apiKey, prompt);
  const cleanJson = extractJsonFromText(raw);
  
  return {
    temp: cleanJson.temp || `${currentTemp}°C`,
    consejo: cleanJson.consejo || cleanJson.advice || "Día estable.",
    items: cleanJson.items || cleanJson.que_llevar || cleanJson.queLlevar || ["Ropa cómoda"],
    paleta: cleanJson.paleta || cleanJson.paleta_luz || cleanJson.palette || ["#38BDF8", "#94A3B8", "#0F172A"],
    modeloUsado: model
  };
}

// ==========================================
// 6. ASISTENTE VIAL Y CONTEXTUAL DE VEHÍCULO
// ==========================================
function generarConsejoCocheNativo(weatherData) {
  const tMin = weatherData.daily?.temperature_2m_min?.[0] ?? Math.round(weatherData.current?.temperature_2m ?? 10);
  const tMax = weatherData.daily?.temperature_2m_max?.[0] ?? Math.round(weatherData.current?.temperature_2m ?? 20);
  const lluvia = weatherData.daily?.precipitation_probability_max?.[0] ?? 0;
  const viento = Math.round(weatherData.current?.wind_speed_10m ?? weatherData.current_weather?.windspeed ?? 10);
  const weatherCode = weatherData.current?.weather_code ?? weatherData.current_weather?.weathercode ?? weatherData.daily?.weather_code?.[0] ?? 0;

  let alerta_coche = "Niveles, batería y presión de neumáticos en rango óptimo.";
  let consejo_conduccion = "Condiciones de circulación favorables y asfalto seco.";
  let precaucion_nivel = "bajo";

  // Control de estado del vehículo
  if (tMin <= 3) {
    alerta_coche = "Riesgo de escarcha en lunas/cristales y menor rendimiento de batería.";
  } else if (tMax >= 32) {
    alerta_coche = "Vigila la presión de neumáticos y ventila el habitáculo antes de iniciar marcha.";
  } else if (tMin < 8) {
    alerta_coche = "Baja temperatura matinal: utiliza desempañador y climatización suave.";
  }

  // Control de conducción y nivel de riesgo
  if (weatherCode >= 45 && weatherCode <= 48) {
    consejo_conduccion = "Visibilidad reducida por niebla: enciende luces antiniebla y modera velocidad.";
    precaucion_nivel = "alto";
  } else if (weatherCode >= 71 && weatherCode <= 86) {
    consejo_conduccion = "Nieve o aguanieve: extrema suavidad en frenadas y aumenta distancia de seguridad.";
    precaucion_nivel = "alto";
  } else if (weatherCode >= 95) {
    consejo_conduccion = "Tormenta activa: extrema precaución con balsas de agua, ráfagas y visibilidad.";
    precaucion_nivel = "alto";
  } else if (tMin <= 2) {
    consejo_conduccion = "Posibles placas de hielo en pasos elevados y calzadas sombrías.";
    precaucion_nivel = "alto";
  } else if (lluvia >= 50 || (weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) {
    consejo_conduccion = "Calzada mojada: duplica la distancia de seguridad y vigila el aquaplaning.";
    precaucion_nivel = "medio";
  } else if (viento >= 40) {
    consejo_conduccion = "Viento lateral notable: mantén firme el volante en puentes y adelantamientos.";
    precaucion_nivel = "medio";
  }

  return {
    alerta_coche,
    consejo_conduccion,
    precaucion_nivel
  };
}

async function generarConsejoCoche(weatherData, apiKey) {
  const tMin = weatherData.daily?.temperature_2m_min?.[0] ?? Math.round(weatherData.current?.temperature_2m ?? 10);
  const tMax = weatherData.daily?.temperature_2m_max?.[0] ?? Math.round(weatherData.current?.temperature_2m ?? 20);
  const lluvia = weatherData.daily?.precipitation_probability_max?.[0] ?? 0;
  const viento = Math.round(weatherData.current?.wind_speed_10m ?? weatherData.current_weather?.windspeed ?? 10);
  const weatherCode = weatherData.current?.weather_code ?? weatherData.current_weather?.weathercode ?? weatherData.daily?.weather_code?.[0] ?? 0;

  if (!apiKey) {
    return generarConsejoCocheNativo(weatherData);
  }

  const prompt = `Actúa como asistente vial y mecánico experto. Analiza estos datos meteorológicos:
- Temperatura mín/máx: ${tMin}°C / ${tMax}°C
- Probabilidad de lluvia: ${lluvia}%
- Velocidad del viento: ${viento} km/h
- Código WMO: ${weatherCode}

Devuelve un JSON estricto con:
{
  "alerta_coche": "Frase de 1 línea sobre el estado del vehículo (cristales, batería, presión o climatización)",
  "consejo_conduccion": "Frase de 1 línea sobre la conducción (visibilidad, distancia de seguridad, viento o asfalto)",
  "precaucion_nivel": "bajo" | "medio" | "alto"
}`;

  try {
    const { text: rawText } = await callGeminiAutoDetect(apiKey, prompt);
    const cleanJson = extractJsonFromText(rawText);
    
    return {
      alerta_coche: cleanJson.alerta_coche || "Niveles y neumáticos en buen estado.",
      consejo_conduccion: cleanJson.consejo_conduccion || "Conducción regular.",
      precaucion_nivel: (cleanJson.precaucion_nivel || "bajo").toLowerCase()
    };
  } catch (err) {
    console.warn("Fallo al consultar módulo coche en Gemini, aplicando fallback nativo:", err);
    return generarConsejoCocheNativo(weatherData);
  }
}

// ==========================================
// 7. ORQUESTADOR Y RENDERIZADO
// ==========================================
async function procesarReporteCompleto() {
  if (!datosMeteorologicos) return;

  const { clima, aire } = datosMeteorologicos;
  const apiKey = localStorage.getItem("gemini_key");
  const schedule = getUserSchedule();

  // Calidad del aire
  if (aire && aire.current && aire.current.pm2_5 !== undefined) {
    const pm25 = aire.current.pm2_5;
    if (pm25 > 25) {
      airText.textContent = `Calidad del aire desfavorable (${pm25} µg/m³ PM2.5). Precaución en exteriores.`;
    } else {
      airText.textContent = `Calidad del aire favorable (${pm25} µg/m³ PM2.5). Ideal para desplazamientos.`;
    }
  }

  // Extraer valores meteorológicos reales de Open-Meteo
  const currentTemp = Math.round(clima.current?.temperature_2m ?? clima.current_weather?.temperature ?? 20);
  const windSpeed = Math.round(clima.current?.wind_speed_10m ?? clima.current_weather?.windspeed ?? 10);
  const rainProb = clima.daily?.precipitation_probability_max?.[0] ?? 0;
  const uvMax = clima.daily?.uv_index_max?.[0] ?? 0;

  // Pintar métricas en interfaz
  const windElem = document.getElementById("wind-display") || document.getElementById("wind-metric");
  if (windElem) windElem.textContent = `${windSpeed} km/h`;

  const uvElem = document.getElementById("uv-display") || document.getElementById("uv-metric");
  if (uvElem) uvElem.textContent = uvMax;

  const rainElem = document.getElementById("rain-display") || document.getElementById("rain-metric");
  if (rainElem) rainElem.textContent = `${rainProb}%`;

  const tempElem = document.getElementById("temp-display");
  if (tempElem) tempElem.textContent = `${currentTemp}°C`;

  let resultado;

  if (apiKey) {
    try {
      keyStatus.textContent = "● Analizando clima y tramos con IA...";
      keyStatus.style.color = "#38bdf8";

      resultado = await motorGemini(clima, modoTransporte, coordsActuales.city, apiKey, schedule);
      const mod = resultado.modeloUsado || "Gemini";
      keyStatus.textContent = `● Modo Pro Activo (${mod})`;
      keyStatus.style.color = "#38bdf8";
    } catch (e) {
      console.warn("Fallo en Gemini, aplicando motor nativo:", e);
      resultado = motorNativo(clima, modoTransporte, schedule);
      keyStatus.textContent = `Aviso: ${e.message}`;
      keyStatus.style.color = "#f59e0b";
    }
  } else {
    resultado = motorNativo(clima, modoTransporte, schedule);
    keyStatus.textContent = "Modo Básico Activo (Sin IA)";
    keyStatus.style.color = "#94a3b8";
  }

  // Pintar en pantalla
  if (tempElem) tempElem.textContent = resultado.temp;
  alertText.textContent = resultado.consejo;
  itemsList.innerHTML = resultado.items.map(i => `<span class="pill">${i}</span>`).join("");
  paletteContainer.innerHTML = resultado.paleta.map(hex => 
    `<div class="swatch" style="background:${hex};">${hex}</div>`
  ).join("");

  // Manejo de la Tarjeta de Conducción / Coche si modoTransporte === "coche"
  const carCard = document.getElementById("car-module-card") || document.getElementById("car-assistant-card");
  const carVehicleStatus = document.getElementById("car-vehicle-status") || document.getElementById("car-vehicle-alert");
  const carDrivingStatus = document.getElementById("car-driving-status") || document.getElementById("car-driving-advice");
  const carBadge = document.getElementById("car-badge") || document.getElementById("car-risk-badge");

  if (modoTransporte === "coche") {
    if (carCard) carCard.style.display = "flex";
    try {
      const consejoCoche = await generarConsejoCoche(clima, apiKey);
      if (carVehicleStatus) carVehicleStatus.textContent = consejoCoche.alerta_coche;
      if (carDrivingStatus) carDrivingStatus.textContent = consejoCoche.consejo_conduccion;
      if (carBadge) {
        const nivel = (consejoCoche.precaucion_nivel || "bajo").toLowerCase();
        carBadge.className = `badge badge-${nivel === "alto" ? "high" : nivel === "medio" ? "med" : "low"}`;
        carBadge.textContent = nivel === "alto" ? "Atención Alta" : nivel === "medio" ? "Precaución" : "Normal";
      }
    } catch (e) {
      console.warn("Error al renderizar consejo de coche:", e);
    }
  } else {
    if (carCard) carCard.style.display = "none";
  }

  // Comprobar alertas críticas (Sismos USGS y clima extremo)
  await verificarAlertasCriticas(clima);
}

// ==========================================
// 7.1 GESTOR DE ALERTAS CRÍTICAS (SISMOS Y CLIMA SEVERO)
// ==========================================
const USER_LAT = 40.4168;
const USER_LON = -3.7038;

async function verificarAlertasCriticas(weatherData) {
  const banner = document.getElementById("critical-alert");
  const title = document.getElementById("alert-title");
  const message = document.getElementById("alert-message");

  if (!banner || !title || !message) return;

  let alertaActiva = false;
  let textoAlerta = "";
  let subtitulo = "";

  const lat = typeof coordsActuales !== "undefined" && coordsActuales.lat ? coordsActuales.lat : USER_LAT;
  const lon = typeof coordsActuales !== "undefined" && coordsActuales.lon ? coordsActuales.lon : USER_LON;

  // 1. Verificación Sísmica (API USGS: magnitud >= 3.0 en radio de 300km)
  try {
    const sismoUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=300&minmagnitude=3.0`;
    const sismoRes = await fetch(sismoUrl);
    const sismoData = await sismoRes.json();

    if (sismoData.features && sismoData.features.length > 0) {
      const sismo = sismoData.features[0].properties;
      alertaActiva = true;
      subtitulo = "Alerta Sísmica Reciente";
      textoAlerta = `Registrado sismo M ${sismo.mag} en ${sismo.place}.`;
    }
  } catch (err) {
    console.warn("No se pudo verificar USGS:", err);
  }

  // 2. Si no hay sismo, verificar fenómenos meteorológicos severos
  if (!alertaActiva && weatherData) {
    const viento = Math.round(weatherData.current_weather?.windspeed || weatherData.current?.wind_speed_10m || 0);
    const weatherCode = weatherData.current_weather?.weathercode || weatherData.current?.weather_code || 0;

    // Vientos muy fuertes (> 70 km/h)
    if (viento >= 70) {
      alertaActiva = true;
      subtitulo = "Aviso de Viento Severo";
      textoAlerta = `Rachas peligrosas de ${viento} km/h. Precaución en carretera y vía pública.`;
    } 
    // Códigos WMO de tormenta eléctrica fuerte o granizo (95, 96, 99)
    else if ([95, 96, 99].includes(weatherCode)) {
      alertaActiva = true;
      subtitulo = "Tormenta Eléctrica / Granizo";
      textoAlerta = "Riesgo de tormenta severa inminente en la zona.";
    }
  }

  // 3. Renderizar o mantener oculto
  if (alertaActiva) {
    title.textContent = subtitulo;
    message.textContent = textoAlerta;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

async function iniciarApp() {
  cityTitle.textContent = "Localizando...";
  coordsActuales = await obtenerUbicacion();
  cityTitle.textContent = coordsActuales.city;

  inicializarMapa(coordsActuales.lat, coordsActuales.lon);
  initScheduleInputs();

  try {
    datosMeteorologicos = await getWeatherData(coordsActuales.lat, coordsActuales.lon);
    // Tras procesar open-meteo:
    verificarAlertasCriticas(datosMeteorologicos.clima);
    await procesarReporteCompleto();
  } catch (err) {
    console.error("Error al conectar con los servicios de clima:", err);
    alertText.textContent = "Error al conectar con los servicios de clima.";
  }
}

window.addEventListener("DOMContentLoaded", iniciarApp);

// ==========================================
// 7. GESTIÓN DE NOTIFICACIÓN MATUTINA (CONTROL ÚNICO DIARIO)
// ==========================================
const notifyTimeInput = document.getElementById("notify-time");
const btnSetAlert = document.getElementById("btn-set-alert");
const notifyStatus = document.getElementById("notify-status");
const notifBadge = document.getElementById("notif-badge");

// Control único diario para evitar repeticiones
function shouldTriggerNotification(targetTimeStr) {
  const now = new Date();
  const todayKey = now.toISOString().split("T")[0]; // "YYYY-MM-DD"
  const lastSent = localStorage.getItem("skybrief_last_notification");

  if (lastSent === todayKey) {
    return false; // Ya se envió hoy
  }

  const [targetHours, targetMinutes] = targetTimeStr.split(":").map(Number);
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();

  if (currentHours === targetHours && currentMinutes === targetMinutes) {
    localStorage.setItem("skybrief_last_notification", todayKey);
    return true;
  }
  return false;
}

// Restaurar hora configurada previamente
if (localStorage.getItem("notify_time")) {
  notifyTimeInput.value = localStorage.getItem("notify_time");
  notifBadge.textContent = "Activo";
  notifBadge.style.background = "#065f46";
  notifBadge.style.color = "#6ee7b7";
  notifyStatus.textContent = `Aviso programado a las ${notifyTimeInput.value}`;
}

async function programarAlarmaMatutina(horaString, textoConsejo, tempTexto) {
  const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;

  if (LocalNotifications) {
    const permiso = await LocalNotifications.requestPermissions();
    if (permiso.display !== "granted") {
      alert("Necesitamos permisos de notificación para el aviso matutino.");
      return;
    }

    const [horas, minutos] = horaString.split(":").map(Number);
    const fechaDisparo = new Date();
    fechaDisparo.setHours(horas, minutos, 0, 0);

    if (fechaDisparo <= new Date()) {
      fechaDisparo.setDate(fechaDisparo.getDate() + 1);
    }

    try {
      await LocalNotifications.cancel({ notifications: [{ id: 101 }] });
    } catch (e) {}

    await LocalNotifications.schedule({
      notifications: [
        {
          id: 101,
          title: `SkyBrief • ${tempTexto}`,
          body: textoConsejo || "Consulta tu recomendación de vestimenta y movilidad para hoy.",
          schedule: { 
            at: fechaDisparo,
            repeats: true,
            every: "day",
            allowWhileIdle: true
          },
          sound: "beep.wav",
          smallIcon: "ic_stat_name"
        }
      ]
    });

    localStorage.setItem("notify_time", horaString);
    notifBadge.textContent = "Activo";
    notifBadge.style.background = "#065f46";
    notifBadge.style.color = "#6ee7b7";
    notifyStatus.textContent = `Aviso diario programado a las ${horaString}`;
    alert(`Aviso programado con éxito todos los días a las ${horaString}.`);
    return;
  }

  // Fallback para navegador web estándar / PWA
  if ("Notification" in window) {
    const permiso = await Notification.requestPermission();
    if (permiso === "granted") {
      localStorage.setItem("notify_time", horaString);
      notifBadge.textContent = "Activo";
      notifBadge.style.background = "#065f46";
      notifBadge.style.color = "#6ee7b7";
      notifyStatus.textContent = `Aviso diario activado para las ${horaString}`;
      alert(`Aviso web programado a las ${horaString}.`);
    } else {
      alert("Debes conceder permisos de notificación en Android para recibir el aviso.");
    }
  } else {
    alert("Tu navegador no soporta notificaciones locales.");
  }
}

if (btnSetAlert) {
  btnSetAlert.addEventListener("click", () => {
    const hora = notifyTimeInput.value;
    const consejoTexto = document.getElementById("alert-text")?.textContent || "";
    const tempTexto = document.getElementById("temp-display")?.textContent || "--°C";
    programarAlarmaMatutina(hora, consejoTexto, tempTexto);
  });
}
