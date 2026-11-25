const SETTINGS_KEY = "antvasion-settings";
const DIFFICULTIES = {
  easy: { spawnInterval: 1.15, antSpeed: 60 },
  normal: { spawnInterval: 1.65, antSpeed: 48 },
  hard: { spawnInterval: 2.4, antSpeed: 38 }
};
const GAME_SPEEDS = [1, 1.5, 2, 3, 5, 10, 20];
const WIDTH = 960;
const HEIGHT = 540;
const WORLD = 1610; // meters (~1 mile) per side
const HALF_WORLD = WORLD / 2;
const DEFAULT_ZOOM = 3;
const ROAD_WIDTHS = { motorway: 16, trunk: 15, primary: 13, secondary: 11, tertiary: 10, residential: 8, unclassified: 8, living_street: 6, service: 4, footway: 2, path: 2, cycleway: 2, pedestrian: 4 };
const HOUSE_ANTS = 100;
const HIVE_BIRTH_FACTOR = 2; // each production source (the meteor, and every infected house) births an ant every spawnInterval * this many seconds
const COURIER_INTERVAL = 5; // seconds between supply runs from each infected house
const COURIER_POINTS = 50;
const SCOUT_SPEED_FACTOR = 0.35;
const WORKER_SPEED_FACTOR = 0.7;
const SOLDIER_COST = 50;
const COMBAT_RANGE = 12;
const WORKER_HEALTH = 4;
const EXTERMINATOR_DAMAGE = 2;
let town = null;
let mapCanvas = null;
let targeting = null;
let crash = { x: HALF_WORLD, y: HALF_WORLD };
let zoom = DEFAULT_ZOOM;
const camera = { x: 0, y: 0 };
const canvas = document.querySelector("#game-canvas");
const context = canvas.getContext("2d");
const antSprite = new Image();
antSprite.addEventListener("error", () => console.error("Could not load the ant sprite."));
antSprite.src = "assets/ant.png";
const settings = loadSettings();
const keysDown = new Set();
let gameSpeed = 1;
let game;
let animationFrame;
let audioContext;
let loadingController = null;

function loadSettings() {
  const defaults = { difficulty: "normal", sound: true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      difficulty: DIFFICULTIES[saved.difficulty] ? saved.difficulty : defaults.difficulty,
      sound: typeof saved.sound === "boolean" ? saved.sound : defaults.sound
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function showScreen(screenId) {
  const appShell = document.querySelector(".app-shell");
  appShell.classList.toggle("menu-active", screenId === "main-menu");
  appShell.classList.toggle("game-active", screenId === "game-screen");
  document.querySelectorAll(".screen").forEach((screen) => {
    const isActive = screen.id === screenId;
    screen.hidden = !isActive;
    screen.classList.toggle("active", isActive);
  });
}

function playTone(frequency, duration = 0.08) {
  if (!settings.sound || !audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.055, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function updateSettingsUI() {
  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    const selected = button.dataset.difficulty === settings.difficulty;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const soundToggle = document.querySelector("#sound-toggle");
  soundToggle.checked = settings.sound;
  document.querySelector("#sound-label").textContent = settings.sound ? "On" : "Off";
}

document.querySelector("#play-button").addEventListener("click", () => {
  if (window.AudioContext && !audioContext) audioContext = new AudioContext();
  setTownStatus("");
  document.querySelector("#address-input").placeholder = `e.g. ${randomExampleAddress()}`;
  showScreen("town-screen");
});

function randomExampleAddress() {
  const streets = ["Maple", "Cedar", "Willow", "Oak", "Birch", "Sunset", "Harvest", "Meadow", "Clover", "Aspen", "Elm", "Pine"];
  const suffixes = ["St", "Ave", "Dr", "Ln", "Way", "Rd"];
  const cities = [["Springfield", "IL"], ["Madison", "WI"], ["Salem", "OR"], ["Austin", "TX"], ["Columbus", "OH"], ["Denver", "CO"], ["Raleigh", "NC"], ["Boise", "ID"]];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const [city, state] = pick(cities);
  return `${100 + Math.floor(Math.random() * 9800)} ${pick(streets)} ${pick(suffixes)}, ${city}, ${state}`;
}

document.querySelector("#town-back-button").addEventListener("click", () => showScreen("main-menu"));

document.querySelector("#random-town-button").addEventListener("click", async () => {
  const controller = new AbortController();
  loadingController = controller;
  setTownStatus("");
  showScreen("loading-screen");
  setLoadingStatus("Generating town…");
  try {
    await yieldToUI();
    controller.signal.throwIfAborted();
    const newTown = generateRandomTown();
    await prepareTown(newTown, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      showScreen("town-screen");
      setTownStatus(error.message || "Could not generate the town. Try again.", true);
    }
  } finally {
    if (loadingController === controller) loadingController = null;
  }
});

document.querySelector("#address-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#address-input").value.trim();
  if (!query) return;
  const controller = new AbortController();
  loadingController = controller;
  setTownStatus("");
  showScreen("loading-screen");
  try {
    setLoadingStatus("Searching for address…");
    await yieldToUI();
    controller.signal.throwIfAborted();
    const place = await geocode(query, controller.signal);
    controller.signal.throwIfAborted();
    setLoadingStatus(`Found ${place.name}. Loading map data…`);
    const newTown = await fetchTown(place, controller.signal);
    controller.signal.throwIfAborted();
    await prepareTown(newTown, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      showScreen("town-screen");
      setTownStatus(error.message || "Could not load that address. Check your connection and try again.", true);
    }
  } finally {
    if (loadingController === controller) loadingController = null;
  }
});

document.querySelector("#cancel-loading-button").addEventListener("click", () => {
  if (loadingController) loadingController.abort();
  showScreen("town-screen");
});

function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setLoadingStatus(message, percent) {
  document.querySelector("#loading-status").textContent = message;
  const progress = document.querySelector("#loading-progress");
  const label = document.querySelector("#loading-percent");
  if (percent === undefined) {
    progress.removeAttribute("value");
    label.textContent = "";
  } else {
    const value = Math.floor(percent);
    progress.value = value;
    label.textContent = `${value}%`;
  }
}

async function prepareTown(newTown, signal) {
  setLoadingStatus("Drawing map…", 0);
  await yieldToUI();
  signal.throwIfAborted();
  const newMapCanvas = await renderTown(newTown, (percent) => setLoadingStatus("Drawing map…", percent), signal);
  signal.throwIfAborted();
  town = newTown;
  mapCanvas = newMapCanvas;
  beginTargeting();
}

function setTownStatus(message, isError = false) {
  const status = document.querySelector("#town-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function geocode(query, signal) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error("Address search failed. Try again in a moment.");
  const results = await response.json();
  if (!results.length) throw new Error("No place found for that address. Try adding the city and state.");
  return { lat: Number(results[0].lat), lon: Number(results[0].lon), name: results[0].display_name.split(",").slice(0, 3).join(",") };
}

async function fetchTown(place, signal) {
  const dLat = HALF_WORLD / 110574;
  const dLon = HALF_WORLD / (111320 * Math.cos((place.lat * Math.PI) / 180));
  const bbox = `${place.lat - dLat},${place.lon - dLon},${place.lat + dLat},${place.lon + dLon}`;
  const query = `[out:json][timeout:60];(way["highway"](${bbox});way["building"](${bbox}););out geom;`;
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  let data = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      if (response.ok) {
        data = await response.json();
        break;
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  if (!data) throw new Error("Map data service is unavailable. Try again, or use a random town.");

  const cosLat = Math.cos((place.lat * Math.PI) / 180);
  const project = (point) => ({
    x: HALF_WORLD + (point.lon - place.lon) * 111320 * cosLat,
    y: HALF_WORLD - (point.lat - place.lat) * 110574
  });
  const roads = [];
  const buildings = [];
  for (const way of data.elements) {
    if (way.type !== "way" || !way.geometry) continue;
    const points = way.geometry.map(project);
    if (way.tags?.building) buildings.push(points);
    else if (way.tags?.highway) roads.push({ points, type: way.tags.highway, name: way.tags.name });
  }
  if (!roads.length && !buildings.length) throw new Error("No map data found at that address.");
  return { name: place.name, roads, buildings };
}

function generateRandomTown() {
  const rand = (min, max) => min + Math.random() * (max - min);
  const names = ["Lander Way", "Tressler Rd", "Draper St", "Tidwell St", "Kyle Dr", "Hummel Dr", "Twilight Dr", "Maple Ave", "Cedar Ln", "Birch Ct", "Willow Way", "Orchard St", "Harvest Dr", "Sunset Blvd", "Aspen Rd", "Garden St", "Meadow Ln", "Clover Dr", "Fern St", "Elm St", "Pine Ave", "Rose Ct"];
  let nameIndex = Math.floor(Math.random() * names.length);
  const nextName = () => names[nameIndex++ % names.length];
  const roads = [];
  const buildings = [];
  const xs = [];
  const ys = [];
  for (let x = rand(-80, 40); x < WORLD + 200; x += rand(140, 230)) xs.push(x);
  for (let y = rand(-80, 40); y < WORLD + 200; y += rand(120, 200)) ys.push(y);
  const wobble = () => rand(-8, 8);
  xs.forEach((x, i) => roads.push({ type: i % 5 === 0 ? "secondary" : "residential", name: nextName(), points: [{ x: x + wobble(), y: -50 }, { x: x + wobble(), y: HALF_WORLD }, { x: x + wobble(), y: WORLD + 50 }] }));
  ys.forEach((y, i) => roads.push({ type: i % 6 === 0 ? "secondary" : "residential", name: nextName(), points: [{ x: -50, y: y + wobble() }, { x: HALF_WORLD, y: y + wobble() }, { x: WORLD + 50, y: y + wobble() }] }));

  const house = (cx, cy, w, h) => {
    const angle = rand(-0.05, 0.05);
    const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([dx, dy]) => ({
      x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: cy + dx * Math.sin(angle) + dy * Math.cos(angle)
    }));
    buildings.push([...corners, corners[0]]);
  };
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      const left = xs[i] + 14;
      const right = xs[i + 1] - 14;
      const top = ys[j] + 14;
      const bottom = ys[j + 1] - 14;
      if (right - left < 60 || bottom - top < 50) continue;
      for (let x = left + 12; x < right - 12; x += rand(24, 34)) {
        house(x, top + rand(10, 15), rand(6, 9), rand(5, 8));
        house(x, bottom - rand(10, 15), rand(6, 9), rand(5, 8));
      }
    }
  }
  return { name: "Random Town", roads, buildings };
}

const PIXEL = 2.5; // world meters per map pixel
const PALETTE = { ground: [74, 36, 40], building: [167, 107, 96], roadEdge: [53, 25, 29], road: [116, 75, 72] };

async function renderTown(data, reportProgress, signal) {
  const size = Math.ceil(WORLD / PIXEL);
  const canvasMap = document.createElement("canvas");
  canvasMap.width = size;
  canvasMap.height = size;
  const ctx = canvasMap.getContext("2d", { willReadFrequently: true });
  ctx.scale(1 / PIXEL, 1 / PIXEL);
  ctx.fillStyle = "#4a2428";
  ctx.fillRect(0, 0, WORLD, WORLD);

  const roads = data.roads.filter((road) => (ROAD_WIDTHS[road.type] || 0) >= 2);
  const trace = (points) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const drawInBatches = async (items, draw, start, end) => {
    let lastYield = performance.now();
    for (let i = 0; i < items.length; i += 1) {
      draw(items[i]);
      if (performance.now() - lastYield >= 8) {
        reportProgress(start + (end - start) * (i + 1) / items.length);
        await yieldToUI();
        signal.throwIfAborted();
        lastYield = performance.now();
      }
    }
    reportProgress(end);
  };
  await drawInBatches(roads, (road) => {
    ctx.strokeStyle = "#35191d";
    ctx.lineWidth = Math.max(ROAD_WIDTHS[road.type] || 6, PIXEL * 1.6) + PIXEL * 1.2;
    trace(road.points);
    ctx.stroke();
  }, 0, 15);
  await drawInBatches(roads, (road) => {
    ctx.strokeStyle = "#744b48";
    ctx.lineWidth = Math.max(ROAD_WIDTHS[road.type] || 6, PIXEL * 1.6);
    trace(road.points);
    ctx.stroke();
  }, 15, 30);

  ctx.fillStyle = "#a76b60";
  ctx.strokeStyle = "#a76b60";
  ctx.lineWidth = 3;
  await drawInBatches(data.buildings, (points) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }, 30, 55);

  // Snap every pixel to the nearest palette color to remove antialiasing.
  const image = ctx.getImageData(0, 0, size, size);
  const colors = Object.values(PALETTE);
  const paletteKeys = new Set(colors.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const batchSize = 65536 * 4;
  for (let start = 0; start < image.data.length; start += batchSize) {
    const end = Math.min(start + batchSize, image.data.length);
    for (let i = start; i < end; i += 4) {
      const key = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
      if (paletteKeys.has(key)) continue;
      let best = colors[0];
      let bestDistance = Infinity;
      for (const color of colors) {
        const distance = (image.data[i] - color[0]) ** 2 + (image.data[i + 1] - color[1]) ** 2 + (image.data[i + 2] - color[2]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = color;
        }
      }
      image.data[i] = best[0];
      image.data[i + 1] = best[1];
      image.data[i + 2] = best[2];
      image.data[i + 3] = 255;
    }
    reportProgress(55 + 44 * end / image.data.length);
    await yieldToUI();
    signal.throwIfAborted();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(image, 0, 0);
  reportProgress(100);
  return canvasMap;
}
document.querySelector("#settings-button").addEventListener("click", () => {
  updateSettingsUI();
  showScreen("settings-screen");
});

document.querySelector("#quit-button").addEventListener("click", () => {
  window.antvasion.quit();
});

document.querySelector("#back-button").addEventListener("click", () => {
  showScreen("main-menu");
});

document.querySelectorAll("[data-difficulty]").forEach((button) => {
  button.addEventListener("click", () => {
    settings.difficulty = button.dataset.difficulty;
    saveSettings();
    updateSettingsUI();
  });
});

document.querySelector("#sound-toggle").addEventListener("change", (event) => {
  settings.sound = event.currentTarget.checked;
  saveSettings();
  updateSettingsUI();
});

document.querySelector("#pause-button").addEventListener("click", pauseGame);
document.querySelectorAll("[data-game-speed]").forEach((button) => {
  button.addEventListener("click", () => setGameSpeed(Number(button.dataset.gameSpeed)));
});
document.querySelector("#troop-dropdown").addEventListener("toggle", (event) => {
  if (event.currentTarget.open) document.querySelector("#speed-dropdown").open = false;
});
document.querySelector("#speed-dropdown").addEventListener("toggle", (event) => {
  if (event.currentTarget.open) document.querySelector("#troop-dropdown").open = false;
});
document.querySelector("#resume-button").addEventListener("click", resumeGame);
document.querySelector("#restart-button").addEventListener("click", beginTargeting);
document.querySelector("#menu-button").addEventListener("click", returnToMenu);
document.querySelector("#recruit-soldier").addEventListener("click", recruitSoldier);

window.addEventListener("keydown", (event) => {
  if ((targeting || (game?.running && !game.paused)) && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
  }
  if (event.key === "Escape" && targeting) returnToMenu();
  if (event.key === "Escape" && game?.running && !game.paused) pauseGame();
  if (targeting || (game?.running && !game.paused)) keysDown.add(event.key.toLowerCase());
});

window.addEventListener("keyup", (event) => keysDown.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keysDown.clear());

canvas.addEventListener("pointermove", (event) => {
  if (targeting) targeting.mouse = pointerToCanvas(event);
});

canvas.addEventListener("pointerdown", (event) => {
  if (targeting) {
    launchMeteor(pointerToCanvas(event));
  } else if (game?.running && !game.paused) {
    const point = pointerToCanvas(event);
    const x = camera.x + point.x / zoom;
    const y = camera.y + point.y / zoom;
    if (Math.abs(x - crash.x) <= Math.max(14, 10 / zoom) && Math.abs(y - crash.y) <= Math.max(14, 10 / zoom)) openTroopMenu();
  }
});

canvas.addEventListener("wheel", (event) => {
  if (event.deltaY === 0) return;
  const point = pointerToCanvas(event);
  if (targeting) {
    if (targeting.meteor || point.x < OVERVIEW_X || point.x > OVERVIEW_X + HEIGHT) return;
    event.preventDefault();
    const world = overviewToWorld(point);
    targeting.zoom = clamp(targeting.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), 1, 8);
    const size = WORLD / targeting.zoom;
    targeting.x = clamp(world.x - ((point.x - OVERVIEW_X) / HEIGHT) * size, 0, WORLD - size);
    targeting.y = clamp(world.y - (point.y / HEIGHT) * size, 0, WORLD - size);
  } else if (game?.running && !game.paused) {
    event.preventDefault();
    const centerX = camera.x + WIDTH / zoom / 2;
    const centerY = camera.y + HEIGHT / zoom / 2;
    zoom = clamp(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), WIDTH / WORLD, 8);
    camera.x = centerX - WIDTH / zoom / 2;
    camera.y = centerY - HEIGHT / zoom / 2;
    clampCamera();
  }
}, { passive: false });

function pointerToCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
}

const OVERVIEW_X = (WIDTH - HEIGHT) / 2;

function overviewToWorld(point) {
  const size = WORLD / targeting.zoom;
  return {
    x: targeting.x + ((point.x - OVERVIEW_X) / HEIGHT) * size,
    y: targeting.y + (point.y / HEIGHT) * size
  };
}

function beginTargeting() {
  cancelAnimationFrame(animationFrame);
  keysDown.clear();
  gameSpeed = 1;
  updateGameSpeedUI();
  closeGameMenus();
  document.querySelector("#game-stats").hidden = true;
  document.querySelector("#pause-button").hidden = true;
  document.querySelector("#troop-dropdown").hidden = true;
  document.querySelector("#speed-dropdown").hidden = true;
  game = null;
  targeting = { mouse: null, meteor: null, last: 0, zoom: 1, x: 0, y: 0 };
  document.querySelector("#game-overlay").hidden = true;
  showScreen("game-screen");
  animationFrame = requestAnimationFrame(targetingLoop);
}

function launchMeteor(point) {
  if (targeting.meteor || point.x < OVERVIEW_X || point.x > OVERVIEW_X + HEIGHT) return;
  const world = overviewToWorld(point);
  targeting.meteor = { t: 0, impact: 0, screen: point, world };
  playTone(180, 0.5);
}

function targetingLoop(timestamp) {
  if (!targeting) return;
  const delta = targeting.last ? Math.min((timestamp - targeting.last) / 1000, 0.05) : 0;
  targeting.last = timestamp;
  const meteor = targeting.meteor;
  if (!meteor) {
    const direction = cameraDirection();
    const size = WORLD / targeting.zoom;
    targeting.x = clamp(targeting.x + direction.x * size * delta, 0, WORLD - size);
    targeting.y = clamp(targeting.y + direction.y * size * delta, 0, WORLD - size);
  }
  if (meteor) {
    if (meteor.t < 1) {
      meteor.t += delta / 0.9;
      if (meteor.t >= 1) {
        meteor.t = 1;
        playTone(70, 0.3);
      }
    } else {
      meteor.impact += delta;
      if (meteor.impact > 0.7) {
        crash = meteor.world;
        targeting = null;
        startGame();
        return;
      }
    }
  }
  drawTargeting();
  animationFrame = requestAnimationFrame(targetingLoop);
}

function drawTargeting() {
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#1d0d10";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const size = WORLD / targeting.zoom;
  context.drawImage(mapCanvas, targeting.x / PIXEL, targeting.y / PIXEL, size / PIXEL, size / PIXEL, OVERVIEW_X, 0, HEIGHT, HEIGHT);
  const meteor = targeting.meteor;
  const mouse = targeting.mouse;
  if (!meteor && mouse && mouse.x >= OVERVIEW_X && mouse.x <= OVERVIEW_X + HEIGHT) {
    context.strokeStyle = "#ff5a4d";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(mouse.x, mouse.y, 12, 0, Math.PI * 2);
    context.moveTo(mouse.x - 18, mouse.y);
    context.lineTo(mouse.x + 18, mouse.y);
    context.moveTo(mouse.x, mouse.y - 18);
    context.lineTo(mouse.x, mouse.y + 18);
    context.stroke();
  }
  if (meteor) {
    const { x, y } = meteor.screen;
    if (meteor.t < 1) {
      const eased = meteor.t * meteor.t;
      const mx = x + 300 * (1 - eased);
      const my = y - 460 * (1 - eased);
      context.fillStyle = "#ff9a3c";
      for (let i = 1; i <= 6; i += 1) context.fillRect(mx + i * 9 - 5, my - i * 14 - 5, 10 - i, 10 - i);
      context.fillStyle = "#ffd36b";
      context.fillRect(mx - 7, my - 7, 14, 14);
    } else {
      const radius = 10 + meteor.impact * 70;
      context.globalAlpha = Math.max(0, 1 - meteor.impact / 0.7);
      context.fillStyle = "#ffd36b";
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      context.globalAlpha = 1;
      context.fillStyle = "#35191d";
      context.fillRect(x - 8, y - 8, 16, 16);
    }
  }
  context.fillStyle = "rgba(29, 13, 16, 0.78)";
  context.fillRect(0, 0, WIDTH, 34);
  context.fillStyle = "#f0f3e8";
  context.font = "700 14px Consolas, monospace";
  context.textAlign = "center";
  context.fillText(meteor ? "INCOMING!" : "CLICK THE MAP TO LAUNCH A METEOR", WIDTH / 2, 22);
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  keysDown.clear();
  zoom = DEFAULT_ZOOM;
  const houses = town.buildings.flatMap((points) => {
    if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
    const first = points[0];
    const last = points[points.length - 1];
    const vertices = first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
    if (vertices.length < 3) return [];
    const x = vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length;
    const y = vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length;
    if (x < 0 || x > WORLD || y < 0 || y > WORLD) return [];
    let area = 0;
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area) / 2 < 25) return [];
    return [{ x, y, points, claimed: false, progress: 0, protection: 0, incoming: 0 }];
  });
  game = {
    running: true,
    paused: false,
    lastFrame: 0,
    spawnTimer: 0,
    score: 0,
    houses,
    claimed: 0,
    ants: [],
    workers: [],
    soldiers: [],
    exterminators: [],
    exterminatorsActivated: false,
    exterminatorTimer: 0
  };
  camera.x = crash.x - WIDTH / zoom / 2;
  camera.y = crash.y - HEIGHT / zoom / 2;
  clampCamera();
  for (let i = 0; i < 20; i += 1) spawnAnt();
  updateHUD();
  document.querySelector("#game-stats").hidden = false;
  document.querySelector("#pause-button").hidden = false;
  document.querySelector("#troop-dropdown").hidden = false;
  document.querySelector("#speed-dropdown").hidden = false;
  updateGameSpeedUI();
  document.querySelector(".game-tip").textContent = houses.length ? "Use the Troops menu to spawn soldiers. Exterminators arrive after 5 buildings." : "No buildings on this map. Choose another town.";
  document.querySelector("#game-overlay").hidden = true;
  showScreen("game-screen");
  animationFrame = requestAnimationFrame(gameLoop);
}

function pauseGame() {
  if (!game?.running || game.paused) return;
  game.paused = true;
  keysDown.clear();
  closeGameMenus();
  setOverlay({
    eyebrow: "TAKE A BREATHER",
    title: "Paused",
    description: "Your colony is waiting.",
    resumeLabel: "Resume",
    restartHidden: false
  });
}

function resumeGame() {
  if (!game?.running || !game.paused) return;
  game.paused = false;
  game.lastFrame = 0;
  document.querySelector("#game-overlay").hidden = true;
  animationFrame = requestAnimationFrame(gameLoop);
}

function setOverlay({ eyebrow, title, description, resumeHidden = false, restartHidden = false }) {
  document.querySelector("#overlay-eyebrow").textContent = eyebrow;
  document.querySelector("#overlay-title").textContent = title;
  document.querySelector("#overlay-description").textContent = description;
  document.querySelector("#resume-button").hidden = resumeHidden;
  document.querySelector("#restart-button").hidden = restartHidden;
  document.querySelector("#game-overlay").hidden = false;
}

function returnToMenu() {
  targeting = null;
  if (game) game.running = false;
  closeGameMenus();
  keysDown.clear();
  cancelAnimationFrame(animationFrame);
  document.querySelector("#game-overlay").hidden = true;
  showScreen("main-menu");
}

function updateHUD() {
  document.querySelector("#ant-count").textContent = game.ants.length + game.workers.length + game.soldiers.length;
  document.querySelector("#house-count").textContent = `${game.claimed} / ${game.houses.length}`;
  document.querySelector("#score-value").textContent = game.score;
  document.querySelector("#soldier-count").textContent = game.soldiers.length;
  document.querySelector("#recruit-soldier").disabled = game.score < SOLDIER_COST;
}

function updateGameSpeedUI() {
  document.querySelector("#speed-label").textContent = `${gameSpeed}x`;
  document.querySelectorAll("[data-game-speed]").forEach((button) => {
    const selected = Number(button.dataset.gameSpeed) === gameSpeed;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setGameSpeed(speed) {
  if (!GAME_SPEEDS.includes(speed)) return;
  gameSpeed = speed;
  updateGameSpeedUI();
  document.querySelector("#speed-dropdown").open = false;
}

function closeGameMenus() {
  document.querySelector("#troop-dropdown").open = false;
  document.querySelector("#speed-dropdown").open = false;
}

function openTroopMenu() {
  if (!game?.running || game.paused) return;
  updateHUD();
  document.querySelector("#troop-dropdown").open = true;
}

function recruitSoldier() {
  if (!game?.running || game.paused || game.score < SOLDIER_COST) return;
  game.score -= SOLDIER_COST;
  game.soldiers.push({ x: crash.x, y: crash.y, radius: 12, health: 5, cooldown: 1, heading: 0, walkDistance: 0 });
  updateHUD();
}

function spawnAnt(source = crash) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * 30;
  game.ants.push({
    x: clamp(source.x + Math.cos(angle) * distance, 0, WORLD),
    y: clamp(source.y + Math.sin(angle) * distance, 0, WORLD),
    heading: angle,
    walkDistance: Math.random() * 6,
    target: null
  });
}

function infectHouse(house) {
  house.claimed = true;
  house.courierTimer = COURIER_INTERVAL;
  game.claimed += 1;
  playTone(440, 0.1);
}

function houseHasRoom(house) {
  return !house.claimed && house.progress + house.incoming < HOUSE_ANTS + house.protection;
}

function arriveAtHouse(ant) {
  const house = ant.target;
  house.incoming -= 1;
  if (house.protection > 0) {
    house.protection -= 1;
  } else {
    house.progress += 1;
    if (house.progress >= HOUSE_ANTS) infectHouse(house);
  }
}

function releaseWorkers(house) {
  house.claimed = false;
  house.progress = 0;
  house.protection = HOUSE_ANTS;
  game.claimed -= 1;
  for (let i = 0; i < HOUSE_ANTS; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * COMBAT_RANGE;
    game.workers.push({
      x: clamp(house.x + Math.cos(angle) * distance, 0, WORLD),
      y: clamp(house.y + Math.sin(angle) * distance, 0, WORLD),
      heading: angle,
      walkDistance: Math.random() * 6,
      health: WORKER_HEALTH,
      fleeing: true,
      sourceHouse: house,
      target: null,
      targetWait: 0,
      wanderTime: 0
    });
  }
}

function damageNearbyWorkers(exterminator) {
  game.workers = game.workers.filter((worker) => {
    if (Math.hypot(worker.x - exterminator.x, worker.y - exterminator.y) > COMBAT_RANGE) return true;
    worker.health -= EXTERMINATOR_DAMAGE;
    if (worker.health > 0) return true;
    if (worker.target) worker.target.incoming -= 1;
    return false;
  });
}

function spawnExterminator() {
  const infected = game.houses.filter((house) => house.claimed);
  const house = infected[Math.floor(Math.random() * infected.length)];
  const angle = Math.random() * Math.PI * 2;
  const distance = 160 + Math.random() * 80;
  game.exterminators.push({
    x: clamp(house.x + Math.cos(angle) * distance, 0, WORLD),
    y: clamp(house.y + Math.sin(angle) * distance, 0, WORLD),
    health: 100,
    cooldown: 1
  });
}

function nearestTo(origin, targets) {
  let nearest = null;
  let nearestDistance = Infinity;
  targets.forEach((target) => {
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function moveToward(unit, target, step, stopDistance) {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= stopDistance) return true;
  const movement = Math.min(step, distance - stopDistance);
  unit.x += dx / distance * movement;
  unit.y += dy / distance * movement;
  return false;
}

function updateCombat(delta) {
  if (!game.exterminatorsActivated && game.claimed >= 5) {
    game.exterminatorsActivated = true;
    game.exterminatorTimer = 0;
  }
  if (game.exterminatorsActivated && game.claimed > 0) {
    game.exterminatorTimer -= delta;
    if (game.exterminatorTimer <= 0) {
      const count = 1 + Math.floor(Math.max(0, game.claimed - 5) / 5);
      for (let i = 0; i < count; i += 1) spawnExterminator();
      game.exterminatorTimer = 6 + 90 / Math.max(5, game.claimed);
    }
  }

  game.soldiers.forEach((soldier) => {
    soldier.cooldown = Math.max(0, soldier.cooldown - delta);
    const enemy = nearestTo(soldier, game.exterminators.filter((exterminator) => exterminator.health > 0));
    if (!enemy) return;
    const previousX = soldier.x;
    const previousY = soldier.y;
    const inRange = moveToward(soldier, enemy, 42 * delta, COMBAT_RANGE);
    const dx = soldier.x - previousX;
    const dy = soldier.y - previousY;
    if (dx || dy) {
      soldier.heading = Math.atan2(dy, dx);
      soldier.walkDistance += Math.hypot(dx, dy);
    }
    if (inRange && soldier.cooldown <= 0) {
      enemy.health -= 1;
      soldier.cooldown = 1;
    }
  });
  game.exterminators = game.exterminators.filter((exterminator) => exterminator.health > 0);

  game.exterminators.forEach((exterminator) => {
    exterminator.cooldown = Math.max(0, exterminator.cooldown - delta);
    const soldier = nearestTo(exterminator, game.soldiers.filter((unit) => unit.health > 0));
    if (soldier && Math.hypot(soldier.x - exterminator.x, soldier.y - exterminator.y) <= COMBAT_RANGE) {
      if (exterminator.cooldown <= 0) {
        soldier.health -= EXTERMINATOR_DAMAGE;
        damageNearbyWorkers(exterminator);
        exterminator.cooldown = 1;
      }
      return;
    }
    const fleeingWorker = nearestTo(exterminator, game.workers.filter((worker) => worker.fleeing));
    if (fleeingWorker) {
      if (moveToward(exterminator, fleeingWorker, 30 * delta, COMBAT_RANGE / 2) && exterminator.cooldown <= 0) {
        damageNearbyWorkers(exterminator);
        exterminator.cooldown = 1;
      }
      return;
    }
    const house = nearestTo(exterminator, game.houses.filter((building) => building.claimed));
    if (!house) return;
    if (moveToward(exterminator, house, 30 * delta, 3) && exterminator.cooldown <= 0) {
      damageNearbyWorkers(exterminator);
      house.progress = Math.max(0, house.progress - EXTERMINATOR_DAMAGE);
      if (house.progress === 0) {
        releaseWorkers(house);
      }
      exterminator.cooldown = 1;
    }
  });
  game.soldiers = game.soldiers.filter((soldier) => soldier.health > 0);
}

function gameLoop(timestamp) {
  if (!game?.running || game.paused) return;
  const delta = game.lastFrame ? Math.min((timestamp - game.lastFrame) / 1000, 0.04) * gameSpeed : 0;
  game.lastFrame = timestamp;
  const steps = Math.ceil(gameSpeed / 5);
  for (let i = 0; i < steps; i += 1) updateGame(delta / steps);
  drawGame();
  animationFrame = requestAnimationFrame(gameLoop);
}

function updateGame(delta) {
  const config = DIFFICULTIES[settings.difficulty];
  const scoutStep = config.antSpeed * SCOUT_SPEED_FACTOR * delta;
  const workerStep = config.antSpeed * WORKER_SPEED_FACTOR * delta;

  game.spawnTimer += delta * (1 + game.claimed) / (config.spawnInterval * HIVE_BIRTH_FACTOR);
  while (game.spawnTimer >= 1) {
    game.spawnTimer -= 1;
    if (game.ants.length < 600 && game.claimed < game.houses.length) {
      const infected = game.houses.filter((house) => house.claimed);
      const pick = Math.floor(Math.random() * (infected.length + 1));
      spawnAnt(pick === 0 ? crash : infected[pick - 1]);
    }
  }

  const direction = cameraDirection();
  camera.x += direction.x * 450 * delta / zoom;
  camera.y += direction.y * 450 * delta / zoom;
  clampCamera();

  game.ants = game.ants.filter((ant) => {
    if (!ant.target) {
      ant.wait = (ant.wait || 0) - delta;
      if (ant.wait > 0) return true;
      ant.wait = 1;
      let nearest = Infinity;
      game.houses.forEach((house) => {
        if (!houseHasRoom(house)) return;
        const distance = Math.hypot(house.x - ant.x, house.y - ant.y);
        if (distance < nearest) nearest = distance;
      });
      // Among buildings about as close as the nearest, finish the one already being filled.
      let bestFill = -1;
      game.houses.forEach((house) => {
        if (!houseHasRoom(house)) return;
        if (Math.hypot(house.x - ant.x, house.y - ant.y) > nearest + 60) return;
        const fill = house.progress + house.incoming;
        if (fill > bestFill) {
          bestFill = fill;
          ant.target = house;
        }
      });
      if (!ant.target) return true;
      ant.target.incoming += 1;
    }
    const dx = ant.target.x - ant.x;
    const dy = ant.target.y - ant.y;
    const distance = Math.hypot(dx, dy);
    if (distance > scoutStep) {
      ant.x += dx / distance * scoutStep;
      ant.y += dy / distance * scoutStep;
      ant.heading = Math.atan2(dy, dx);
      ant.walkDistance += scoutStep;
      return true;
    }
    arriveAtHouse(ant);
    return false;
  });

  updateCombat(delta);

  game.houses.forEach((house) => {
    if (!house.claimed) return;
    house.courierTimer -= delta;
    if (house.courierTimer > 0) return;
    house.courierTimer += COURIER_INTERVAL;
    game.workers.push({
      x: house.x,
      y: house.y,
      carrying: true,
      health: WORKER_HEALTH,
      heading: Math.atan2(crash.y - house.y, crash.x - house.x),
      walkDistance: 0
    });
  });
  game.workers = game.workers.filter((worker) => {
    if (worker.fleeing) {
      if (!worker.target) {
        worker.targetWait -= delta;
        if (worker.targetWait <= 0) {
          worker.target = nearestTo(worker, game.houses.filter((house) =>
            house !== worker.sourceHouse && houseHasRoom(house)));
          worker.targetWait = 1;
          if (worker.target) worker.target.incoming += 1;
        }
      }
      if (worker.target) {
        const dx = worker.target.x - worker.x;
        const dy = worker.target.y - worker.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= workerStep) {
          arriveAtHouse(worker);
          return false;
        }
        worker.x += dx / distance * workerStep;
        worker.y += dy / distance * workerStep;
        worker.heading = Math.atan2(dy, dx);
      } else {
        worker.wanderTime -= delta;
        if (worker.wanderTime <= 0) {
          worker.heading = Math.random() * Math.PI * 2;
          worker.wanderTime = 0.5 + Math.random();
        }
        worker.x = clamp(worker.x + Math.cos(worker.heading) * workerStep, 0, WORLD);
        worker.y = clamp(worker.y + Math.sin(worker.heading) * workerStep, 0, WORLD);
      }
      worker.walkDistance += workerStep;
      return true;
    }
    const dx = crash.x - worker.x;
    const dy = crash.y - worker.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= workerStep + 2) {
      game.score += COURIER_POINTS;
      return false;
    }
    worker.x += dx / distance * workerStep;
    worker.y += dy / distance * workerStep;
    worker.heading = Math.atan2(dy, dx);
    worker.walkDistance += workerStep;
    return true;
  });
  updateHUD();
}
function cameraDirection() {
  let moveX = 0;
  let moveY = 0;
  if (keysDown.has("a") || keysDown.has("arrowleft")) moveX -= 1;
  if (keysDown.has("d") || keysDown.has("arrowright")) moveX += 1;
  if (keysDown.has("w") || keysDown.has("arrowup")) moveY -= 1;
  if (keysDown.has("s") || keysDown.has("arrowdown")) moveY += 1;
  const magnitude = Math.hypot(moveX, moveY) || 1;
  return { x: moveX / magnitude, y: moveY / magnitude };
}

function clampCamera() {
  const viewW = WIDTH / zoom;
  const viewH = HEIGHT / zoom;
  camera.x = clamp(camera.x, 0, WORLD - viewW);
  camera.y = clamp(camera.y, 0, WORLD - viewH);
}

function drawGame() {
  const viewW = WIDTH / zoom;
  const viewH = HEIGHT / zoom;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.imageSmoothingEnabled = false;
  context.drawImage(mapCanvas, camera.x / PIXEL, camera.y / PIXEL, viewW / PIXEL, viewH / PIXEL, 0, 0, WIDTH, HEIGHT);

  context.save();
  context.scale(zoom, zoom);
  context.translate(-camera.x, -camera.y);
  game.houses.forEach((house) => {
    if (!house.claimed && house.progress === 0 && house.protection === 0) return;
    context.fillStyle = house.protection > 0 ? "#4da7ff" : house.claimed ? "#c0303a" : "#e0262f";
    context.globalAlpha = house.claimed || house.protection > 0 ? 1 : 0.2 + 0.6 * (house.progress / HOUSE_ANTS);
    context.beginPath();
    house.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.fill();
  });
  context.globalAlpha = 1;
  context.fillStyle = "#35191d";
  context.fillRect(Math.round(crash.x) - 14, Math.round(crash.y) - 14, 28, 28);
  context.fillStyle = "#ff9a3c";
  context.fillRect(Math.round(crash.x) - 6, Math.round(crash.y) - 6, 12, 12);
  const minX = camera.x - 24;
  const maxX = camera.x + viewW + 24;
  const minY = camera.y - 24;
  const maxY = camera.y + viewH + 24;
  const drawVisibleAnt = (ant) => {
    if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) return;
    drawAnt(ant);
  };
  game.workers.forEach(drawVisibleAnt);
  game.ants.forEach(drawVisibleAnt);
  game.soldiers.forEach((soldier) => {
    if (soldier.x < minX || soldier.x > maxX || soldier.y < minY || soldier.y > maxY) return;
    drawAnt(soldier, true);
  });
  game.exterminators.forEach((exterminator) => {
    context.fillStyle = "#4da7ff";
    context.beginPath();
    context.arc(exterminator.x, exterminator.y, 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#35191d";
    context.fillRect(exterminator.x - 12, exterminator.y - 13, 24, 3);
    context.fillStyle = "#4da7ff";
    context.fillRect(exterminator.x - 12, exterminator.y - 13, 24 * exterminator.health / 100, 3);
  });
  game.houses.forEach((house) => {
    const showProtection = house.protection > 0 && zoom >= 1.6;
    const underAttack = house.claimed && game.exterminators.some((enemy) => Math.hypot(enemy.x - house.x, enemy.y - house.y) <= 15);
    if (!showProtection && !underAttack) return;
    context.fillStyle = "#ffffff";
    context.font = "bold 10px Consolas, monospace";
    context.textAlign = "center";
    context.fillText(`${showProtection ? house.protection : house.progress}/${HOUSE_ANTS}`, house.x, house.y - 14);
  });
  context.restore();
  drawMinimap();
}

function drawAnt(ant, soldier = false) {
  if (zoom < 1.6 || !antSprite.complete || !antSprite.naturalWidth) {
    const dotSize = 2.5 / zoom;
    context.fillStyle = soldier ? "#8e1f27" : "#e0262f";
    context.fillRect(ant.x - dotSize / 2, ant.y - dotSize / 2, dotSize, dotSize);
    return;
  }

  const step = Math.floor(ant.walkDistance / 3) % 2;
  context.save();
  context.translate(ant.x, ant.y);
  context.rotate(ant.heading + Math.PI / 2);
  context.scale(step ? -1 : 1, 1);
  const spriteSize = soldier ? 2 : 1;
  context.drawImage(antSprite, -7 * spriteSize, -9 * spriteSize, 14 * spriteSize, 18 * spriteSize);
  if (ant.carrying) {
    context.fillStyle = "#f6d6b0";
    context.fillRect(-2, -11, 4, 3);
  }
  context.restore();
}

function drawMinimap() {
  const size = 130;
  const x = WIDTH - size - 10;
  const y = HEIGHT - size - 10;
  context.drawImage(mapCanvas, x, y, size, size);
  context.strokeStyle = "#f0f3e8";
  context.lineWidth = 2;
  context.strokeRect(x, y, size, size);
  const dot = (p, color, s) => {
    context.fillStyle = color;
    context.fillRect(x + (p.x / WORLD) * size - s / 2, y + (p.y / WORLD) * size - s / 2, s, s);
  };
  dot(crash, "#ff9a3c", 5);
  game.houses.forEach((house) => {
    if (house.protection > 0) dot(house, "#4da7ff", 2);
    else if (house.claimed) dot(house, "#e0262f", 2);
  });
  game.ants.forEach((ant) => dot(ant, "#ffffff", 1.5));
  game.soldiers.forEach((soldier) => dot(soldier, "#8e1f27", 3));
  game.exterminators.forEach((exterminator) => dot(exterminator, "#4da7ff", 3));
  context.strokeStyle = "#ffffff";
  context.lineWidth = 1;
  context.strokeRect(x + camera.x / WORLD * size, y + camera.y / WORLD * size, WIDTH / zoom / WORLD * size, HEIGHT / zoom / WORLD * size);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

updateSettingsUI();
