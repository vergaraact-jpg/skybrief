// ==========================================
// ESTADO GLOBAL
// ==========================================
const DEFAULT_COORDS = { lat: 40.4168, lon: -3.7038, city: "Madrid" };
let modoTransporte = "metro"; // 'metro' o 'coche'
let datosMeteorologicos = null;
let coordsActuales = { ...DEFAULT_COORDS };
let mapa = null;

// Lista de modelos oficiales de Gemini ordenados por velocidad y compatibilidad universal
const CANDIDATE_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
  "gemini-pro"
];

// Elementos DOM
const cityTitle = document.getElementById("city-title");
const tempDisplay = document.getElementById("temp-display");
const alertText = document.getElementById("alert-text");
const transportLabel = document.getElementById("transport-mode-label");
const windDisplay = document.getElementById("wind-display");
const uvDisplay = document.getElementById("uv-display");
const rainDisplay = document.getElementById("rain-display");
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
    keyStatus.textContent = "Clave guardada. Buscando modelo compatible...";
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
// 2. APIS EXTERNAS: CLIMA, AIRE Y UBICACIÓN
// ==========================================
async function obtenerUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(DEFAULT_COORDS);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        let city = "Tu Ubicación";
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
          const data = await res.json();
          city = data.address.city || data.address.town || data.address.suburb || "Tu Ubicación";
        } catch (e) {
          console.warn("Geocodificación inversa fallida:", e);
        }
        resolve({ lat, lon, city });
      },
      () => resolve(DEFAULT_COORDS),
      { timeout: 4000 }
    );
  });
}

async function obtenerClimaYCalidad(lat, lon) {
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&current_weather=true&timezone=auto`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5`;

  const [resClima, resAire] = await Promise.all([
    fetch(weatherUrl).then(r => r.json()),
    fetch(airUrl).then(r => r.json()).catch(() => null)
  ]);

  return { clima: resClima, aire: resAire };
}

// ==========================================
// 3. MAPA EN VIVO (LEAFLET)
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
// 4. MOTORES DE ANÁLISIS (HÍBRIDO)
// ==========================================
function motorNativo(clima, transporte) {
  const temp = Math.round(clima.current_weather.temperature);
  const probLluvia = clima.daily.precipitation_probability_max[0];
  const viento = Math.round(clima.current_weather.windspeed);
  const uv = clima.daily.uv_index_max[0];

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

  if (probLluvia > 40) {
    consejo += " Probabilidad de precipitaciones.";
    items.push(transporte === "coche" ? "Líquido limpiaparabrisas" : "Paraguas compacto");
  }

  if (uv >= 6) items.push("Protector solar");

  return { temp: `${temp}°C`, consejo, items, paleta };
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

// BÚSQUEDA SECUENCIAL AUTO-DESCARTABLE (Infalible)
async function callGeminiAutoDetect(apiKey, promptText) {
  const cleanKey = apiKey.trim();

  // Si ya hay un modelo guardado que funcionó antes, pruébalo primero
  const cached = localStorage.getItem("gemini_active_model");
  const queue = cached 
    ? [cached, ...CANDIDATE_MODELS.filter(m => m !== cached)]
    : CANDIDATE_MODELS;

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

      // Si el modelo no existe o no está habilitado (404 o 400 not found), DESCÁRTALO y sigue
      if (response.status === 404) {
        console.warn(`[Auto-Detect] Modelo ${model} no disponible (404), descartando...`);
        localStorage.removeItem("gemini_active_model");
        continue;
      }

      const result = await response.json().catch(() => ({}));

      // Si hay error en la respuesta de Google
      if (!response.ok) {
        const errorMsg = (result.error?.message || "").toLowerCase();
        // Si el error es que el modelo no existe, descartar y seguir con el siguiente
        if (errorMsg.includes("not found") || errorMsg.includes("not supported") || errorMsg.includes("404")) {
          console.warn(`[Auto-Detect] Modelo ${model} no admitido (${errorMsg}), descartando...`);
          localStorage.removeItem("gemini_active_model");
          continue;
        }
        // Si la clave es inválida (400/403 de autenticación), corta para avisar al usuario
        if (errorMsg.includes("api_key_invalid") || errorMsg.includes("api key not valid") || response.status === 403) {
          throw new Error("API Key inválida. Comprueba tu clave de Google AI Studio.");
        }
        throw new Error(result.error?.message || `Error HTTP ${response.status}`);
      }

      if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
        continue;
      }

      // ¡ÉXITO! Encontramos el modelo que sí funciona en tu cuenta
      localStorage.setItem("gemini_active_model", model);
      console.log(`[Auto-Detect] ✓ Modelo activo fijado con éxito: ${model}`);
      return { text: result.candidates[0].content.parts[0].text, model };

    } catch (err) {
      lastError = err;
      const msg = (err.message || "").toLowerCase();
      if (msg.includes("inválida") || msg.includes("api key not valid")) {
        throw err;
      }
      // Cualquier otro error de modelo, pasa al siguiente candidato
    }
  }

  throw new Error(`Ningún modelo de Gemini respondió. ${lastError?.message || "Revisa tu conexión o API Key."}`);
}

async function motorGemini(clima, transporte, city, apiKey) {
  const prompt = `Analiza estos datos meteorológicos de ${city}:
- Temp actual: ${clima.current_weather.temperature}°C (Máx: ${clima.daily.temperature_2m_max[0]}°C, Mín: ${clima.daily.temperature_2m_min[0]}°C)
- Prob. lluvia: ${clima.daily.precipitation_probability_max[0]}%
- UV: ${clima.daily.uv_index_max[0]}
- Viento: ${clima.current_weather.windspeed} km/h
- Modo de transporte elegido por el usuario: ${transporte}

Responde exclusivamente con un JSON válido con este formato:
{
  "temp": "${Math.round(clima.current_weather.temperature)}°C",
  "consejo": "Consejo directo de ropa y trayecto en ${transporte} (máx 15 palabras)",
  "items": ["Prenda 1", "Accesorio 2", "Accesorio 3"],
  "paleta": ["#HEX1", "#HEX2", "#HEX3"]
}`;

  const { text: raw, model } = await callGeminiAutoDetect(apiKey, prompt);
  const cleanJson = extractJsonFromText(raw);
  
  return {
    temp: cleanJson.temp || `${Math.round(clima.current_weather.temperature)}°C`,
    consejo: cleanJson.consejo || cleanJson.advice || "Día estable.",
    items: cleanJson.items || cleanJson.que_llevar || cleanJson.queLlevar || ["Ropa cómoda"],
    paleta: cleanJson.paleta || cleanJson.paleta_luz || cleanJson.palette || ["#38BDF8", "#94A3B8", "#0F172A"],
    modeloUsado: model
  };
}

// ==========================================
// 5. ORQUESTADOR Y RENDERIZADO
// ==========================================
async function procesarReporteCompleto() {
  if (!datosMeteorologicos) return;

  const { clima, aire } = datosMeteorologicos;
  const apiKey = localStorage.getItem("gemini_key");

  // Calidad del aire
  if (aire && aire.current && aire.current.pm2_5 !== undefined) {
    const pm25 = aire.current.pm2_5;
    if (pm25 > 25) {
      airText.textContent = `Calidad del aire desfavorable (${pm25} µg/m³ PM2.5). Precaución en exteriores.`;
    } else {
      airText.textContent = `Calidad del aire favorable (${pm25} µg/m³ PM2.5). Ideal para desplazamientos.`;
    }
  }

  // Métricas
  windDisplay.textContent = `${Math.round(clima.current_weather.windspeed)} km/h`;
  uvDisplay.textContent = clima.daily.uv_index_max[0];
  rainDisplay.textContent = `${clima.daily.precipitation_probability_max[0]}%`;

  let resultado;

  if (apiKey) {
    try {
      keyStatus.textContent = "● Probando modelos de Gemini...";
      keyStatus.style.color = "#38bdf8";

      resultado = await motorGemini(clima, modoTransporte, coordsActuales.city, apiKey);
      const mod = resultado.modeloUsado || "Gemini Flash";
      keyStatus.textContent = `● Modo Pro Activo (${mod})`;
      keyStatus.style.color = "#38bdf8";
    } catch (e) {
      console.warn("Fallo en Gemini, aplicando motor nativo:", e);
      resultado = motorNativo(clima, modoTransporte);
      keyStatus.textContent = `Aviso: ${e.message}`;
      keyStatus.style.color = "#f59e0b";
      alert(`Aviso de IA: ${e.message}`);
    }
  } else {
    resultado = motorNativo(clima, modoTransporte);
    keyStatus.textContent = "Modo Básico Activo (Sin IA)";
    keyStatus.style.color = "#94a3b8";
  }

  // Pintar en pantalla
  tempDisplay.textContent = resultado.temp;
  alertText.textContent = resultado.consejo;
  itemsList.innerHTML = resultado.items.map(i => `<span class="pill">${i}</span>`).join("");
  paletteContainer.innerHTML = resultado.paleta.map(hex => 
    `<div class="swatch" style="background:${hex};">${hex}</div>`
  ).join("");
}

async function iniciarApp() {
  cityTitle.textContent = "Localizando...";
  coordsActuales = await obtenerUbicacion();
  cityTitle.textContent = coordsActuales.city;

  inicializarMapa(coordsActuales.lat, coordsActuales.lon);

  try {
    datosMeteorologicos = await obtenerClimaYCalidad(coordsActuales.lat, coordsActuales.lon);
    await procesarReporteCompleto();
  } catch (err) {
    alertText.textContent = "Error al conectar con los servicios de clima.";
  }
}

window.addEventListener("DOMContentLoaded", iniciarApp);

// ==========================================
// 6. GESTIÓN DE NOTIFICACIÓN MATUTINA (NATIVA CON CAPACITOR / WEB)
// ==========================================
const notifyTimeInput = document.getElementById("notify-time");
const btnSetAlert = document.getElementById("btn-set-alert");
const notifyStatus = document.getElementById("notify-status");
const notifBadge = document.getElementById("notif-badge");

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
    notifyStatus.textContent = `Aviso nativo diario a las ${horaString}`;
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

      new Notification("SkyBrief Activado", {
        body: `Te avisaremos a las ${horaString} con el reporte del tiempo y qué ponerte.`,
        icon: "icon.png"
      });
    } else {
      alert("Debes conceder permisos de notificación en Android para recibir el aviso.");
    }
  } else {
    alert("Tu navegador no soporta notificaciones locales.");
  }
}

btnSetAlert.addEventListener("click", () => {
  const hora = notifyTimeInput.value;
  const consejoTexto = document.getElementById("alert-text")?.textContent || "";
  const tempTexto = document.getElementById("temp-display")?.textContent || "--°C";
  programarAlarmaMatutina(hora, consejoTexto, tempTexto);
});

// Comprobación de reloj en segundo plano (fallback web)
setInterval(() => {
  if (window.Capacitor?.Plugins?.LocalNotifications) return;

  const horaGuardada = localStorage.getItem("notify_time");
  if (!horaGuardada) return;

  const ahora = new Date();
  const actualStr = ahora.toTimeString().slice(0, 5);

  if (actualStr === horaGuardada && ahora.getSeconds() === 0) {
    if (Notification.permission === "granted") {
      const consejoTexto = document.getElementById("alert-text").textContent;
      const tempTexto = document.getElementById("temp-display").textContent;

      new Notification(`SkyBrief (${tempTexto})`, {
        body: consejoTexto || "Consulta tu recomendación de vestimenta para hoy.",
        icon: "icon.png"
      });
    }
  }
}, 1000);
