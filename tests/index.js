const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.setPath("userData", process.env.ANTVASION_TEST_PROFILE || path.join(__dirname, "..", "node_modules", ".antvasion-test-profile"));

app.whenReady().then(async () => {
  let exitCode = 0;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  try {
    await window.loadFile(path.join(__dirname, "..", "index.html"));
    const loading = await window.webContents.executeJavaScript(`
      (async () => {
        const progress = document.querySelector("#loading-progress");
        const loadingScreen = document.querySelector("#loading-screen");
        const uniqueLoadingScreen = document.querySelectorAll("#loading-screen").length === 1
          && document.querySelectorAll("#loading-status").length === 1;
        const waitFor = async (condition) => {
          const deadline = Date.now() + 10000;
          while (!condition()) {
            if (Date.now() > deadline) throw new Error("Loading check timed out");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        const values = [];
        const observer = new MutationObserver(() => {
          if (progress.hasAttribute("value")) values.push(progress.value);
        });
        observer.observe(progress, { attributes: true, attributeFilter: ["value"] });

        showScreen("town-screen");
        document.querySelector("#random-town-button").click();
        const randomLoadingVisible = !loadingScreen.hidden;
        await waitFor(() => !document.querySelector("#game-screen").hidden);
        const randomValues = values.slice();
        const randomTownHasBuildings = town.buildings.length > 0;
        cancelAnimationFrame(animationFrame);
        targeting = null;

        const originalFetch = window.fetch;
        let resolveSearch;
        window.fetch = () => new Promise((resolve) => { resolveSearch = resolve; });
        showScreen("town-screen");
        document.querySelector("#address-input").value = "test address";
        document.querySelector("#address-form").requestSubmit();
        const waitingForSearch = !loadingScreen.hidden && !progress.hasAttribute("value")
          && document.querySelector("#loading-status").textContent.includes("Searching");
        await waitFor(() => Boolean(resolveSearch));
        resolveSearch({ ok: true, json: async () => [] });
        await waitFor(() => !document.querySelector("#town-screen").hidden);
        const searchError = document.querySelector("#town-status").textContent;

        let resolveMap;
        window.fetch = (url) => url.includes("nominatim")
          ? Promise.resolve({ ok: true, json: async () => [{ lat: "0", lon: "0", display_name: "Test" }] })
          : new Promise((resolve) => { resolveMap = resolve; });
        values.length = 0;
        document.querySelector("#address-form").requestSubmit();
        await waitFor(() => Boolean(resolveMap));
        const waitingForMap = !loadingScreen.hidden && !progress.hasAttribute("value")
          && document.querySelector("#loading-status").textContent.includes("Loading map data");
        resolveMap({ ok: true, json: async () => ({ elements: [{
          type: "way", tags: { building: "yes" }, geometry: [
            { lat: 0, lon: 0 }, { lat: 0, lon: 0.0001 },
            { lat: 0.0001, lon: 0.0001 }, { lat: 0, lon: 0 }
          ]
        }] }) });
        await waitFor(() => !document.querySelector("#game-screen").hidden);
        const addressValues = values.slice();
        const addressTownHasBuilding = town.name === "Test" && town.buildings.length === 1;
        cancelAnimationFrame(animationFrame);
        targeting = null;

        let resolveCanceledSearch;
        let searchSignal;
        window.fetch = (url, options) => {
          searchSignal = options.signal;
          return new Promise((resolve) => { resolveCanceledSearch = resolve; });
        };
        showScreen("town-screen");
        document.querySelector("#address-form").requestSubmit();
        await waitFor(() => Boolean(resolveCanceledSearch));
        document.querySelector("#cancel-loading-button").click();
        const canceledToTown = !document.querySelector("#town-screen").hidden && searchSignal.aborted;
        resolveCanceledSearch({ ok: true, json: async () => [{ lat: "0", lon: "0", display_name: "Canceled" }] });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const canceledStayedOnTown = !document.querySelector("#town-screen").hidden
          && town.name === "Test" && !document.querySelector("#town-status").textContent;

        window.fetch = async (url) => url.includes("nominatim")
          ? { ok: true, json: async () => [{ lat: "0", lon: "0", display_name: "Canceled rendering" }] }
          : { ok: true, json: async () => ({ elements: Array.from({ length: 3000 }, (_, i) => ({
            type: "way", tags: { building: "yes" }, geometry: [
              { lat: i * 0.000001, lon: 0 }, { lat: i * 0.000001, lon: 0.0001 },
              { lat: i * 0.000001 + 0.0001, lon: 0 }
            ]
          })) }) };
        let canceledDuringDrawing = false;
        const cancelObserver = new MutationObserver(() => {
          if (!canceledDuringDrawing && progress.hasAttribute("value") && progress.value > 0) {
            canceledDuringDrawing = true;
            document.querySelector("#cancel-loading-button").click();
          }
        });
        cancelObserver.observe(progress, { attributes: true, attributeFilter: ["value"] });
        document.querySelector("#address-form").requestSubmit();
        await waitFor(() => canceledDuringDrawing);
        await new Promise((resolve) => setTimeout(resolve, 50));
        cancelObserver.disconnect();
        const drawingStayedCanceled = !document.querySelector("#town-screen").hidden && town.name === "Test";

        const mapCalls = [];
        window.fetch = async (url) => {
          mapCalls.push(url);
          if (mapCalls.length === 1) return { ok: false };
          return { ok: true, json: async () => ({ elements: [{
            type: "way", tags: { building: "yes" }, geometry: [
              { lat: 0, lon: 0 }, { lat: 0, lon: 0.0001 }, { lat: 0.0001, lon: 0 }
            ]
          }] }) };
        };
        const fallbackTown = await fetchTown({ lat: 0, lon: 0, name: "Fallback" }, new AbortController().signal);
        const mirrorFallback = mapCalls.length === 2 && fallbackTown.buildings.length === 1;

        window.fetch = originalFetch;
        observer.disconnect();
        return { uniqueLoadingScreen, randomLoadingVisible, randomValues, randomTownHasBuildings, waitingForSearch,
          searchError, waitingForMap, addressValues, addressTownHasBuilding, canceledToTown, canceledStayedOnTown,
          canceledDuringDrawing, drawingStayedCanceled, mirrorFallback };
      })()
    `);
    for (const values of [loading.randomValues, loading.addressValues]) {
      assert.equal(values[0], 0);
      assert.equal(values[values.length - 1], 100);
      assert.ok(values.some((value) => value > 0 && value < 100), "drawing should report intermediate progress");
      assert.ok(values.every((value, i) => i === 0 || value >= values[i - 1]), "progress should not go backwards");
    }
    assert.ok(loading.randomLoadingVisible && loading.randomTownHasBuildings);
    assert.ok(loading.uniqueLoadingScreen, "loading screen and status IDs should be unique");
    assert.ok(loading.waitingForSearch && loading.waitingForMap, "network waits should be indeterminate");
    assert.match(loading.searchError, /No place found/);
    assert.ok(loading.addressTownHasBuilding);
    assert.ok(loading.canceledToTown && loading.canceledStayedOnTown, "canceling should abort the request and ignore late results");
    assert.ok(loading.canceledDuringDrawing && loading.drawingStayedCanceled, "canceling should stop map drawing");
    assert.ok(loading.mirrorFallback, "failed map requests should try the backup service");
    console.log("Map loading progress checks passed.");

    const result = await Promise.race([window.webContents.executeJavaScript(`
      (async () => {
        await antSprite.decode();
        town = { name: "Test", buildings: [], roads: [] };
        mapCanvas = document.createElement("canvas");
        mapCanvas.width = mapCanvas.height = Math.ceil(WORLD / PIXEL);
        const mapContext = mapCanvas.getContext("2d");
        mapContext.fillStyle = "#eeeeee";
        mapContext.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
        crash = { x: 500, y: 500 };
        const house = { x: 300, y: 100, points: [], claimed: false, progress: 0, protection: 0, incoming: 1 };
        const protectedHouse = { x: 290, y: 100, points: [
          { x: 284, y: 94 }, { x: 296, y: 94 }, { x: 296, y: 106 }, { x: 284, y: 106 }
        ], claimed: false, progress: 0, protection: 100, incoming: 0 };
        const scout = { x: 100, y: 100, heading: 0, walkDistance: 0, target: house };
        const worker = { x: 170, y: 100, heading: 0, walkDistance: 0, carrying: true, health: 4 };
        const soldier = { x: 230, y: 100, heading: 0, walkDistance: 0, health: 5, cooldown: 0 };
        game = { running: true, paused: false, lastFrame: 0, spawnTimer: 0, score: 0,
          houses: [house, protectedHouse], claimed: 0, ants: [scout], workers: [worker], soldiers: [soldier],
          exterminators: [], exterminatorsActivated: false };
        camera.x = camera.y = 0;

        const pixelStats = (x, y, radius) => {
          const pixels = context.getImageData(x - radius, y - radius, radius * 2, radius * 2).data;
          let changed = 0;
          let red = 0;
          let darkRed = 0;
          let bundle = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] !== 238 || pixels[i + 1] !== 238 || pixels[i + 2] !== 238) changed++;
            if (pixels[i] === 224 && pixels[i + 1] === 38 && pixels[i + 2] === 47) red++;
            if (pixels[i] === 142 && pixels[i + 1] === 31 && pixels[i + 2] === 39) darkRed++;
            if (pixels[i] === 246 && pixels[i + 1] === 214 && pixels[i + 2] === 176) bundle++;
          }
          return { changed, red, darkRed, bundle, pixels: Array.from(pixels) };
        };

        zoom = WIDTH / WORLD;
        drawGame();
        const distantScout = pixelStats(Math.round(scout.x * zoom), Math.round(scout.y * zoom), 8);
        const distantWorker = pixelStats(Math.round(worker.x * zoom), Math.round(worker.y * zoom), 8);
        const distantSoldier = pixelStats(Math.round(soldier.x * zoom), Math.round(soldier.y * zoom), 8);

        zoom = 3;
        drawGame();
        const closeScout = pixelStats(300, 300, 30);
        const closeWorker = pixelStats(510, 300, 30);
        const closeSoldier = pixelStats(690, 300, 55);
        const protectedColor = Array.from(context.getImageData(870, 300, 1, 1).data);
        scout.heading = Math.PI / 2;
        drawGame();
        const turnedScout = pixelStats(300, 300, 30);
        scout.walkDistance = 3;
        drawGame();
        const walkingScout = pixelStats(300, 300, 30);

        updateGame(0.1);
        const movement = { scoutX: scout.x, scoutY: scout.y, scoutHeading: scout.heading,
          scoutWalk: scout.walkDistance, workerX: worker.x, workerY: worker.y, workerWalk: worker.walkDistance };

        zoom = 3;
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
        const zoomedOut = zoom;
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
        return { sprite: [antSprite.naturalWidth, antSprite.naturalHeight], distantScout, distantWorker, distantSoldier,
          closeScout, closeWorker, closeSoldier, protectedColor, turnedScout, walkingScout, movement, zoomedOut, zoomedIn: zoom };
      })()
    `), new Promise((_, reject) => setTimeout(() => reject(new Error("Ant rendering check timed out")), 20000))]);

    assert.deepEqual(result.sprite, [140, 178]);
    for (const dot of [result.distantScout, result.distantWorker]) {
      assert.ok(dot.red >= 1 && dot.changed <= 16, "distant ants should be tiny red dots");
    }
    assert.ok(result.distantSoldier.darkRed >= 1 && result.distantSoldier.changed <= 16,
      "distant soldiers should be tiny dark red dots");
    assert.ok(result.closeScout.changed > 200, "a close-up scout should show the detailed sprite");
    assert.ok(result.closeWorker.changed > 200, "a close-up worker should show the detailed sprite");
    assert.ok(result.closeSoldier.changed > result.closeScout.changed, "a close-up soldier should show a larger sprite");
    assert.deepEqual(result.protectedColor, [77, 167, 255, 255], "protected houses should be blue");
    assert.ok(result.closeWorker.bundle > 0, "a carrying worker should show its bundle");
    assert.notDeepEqual(result.closeScout.pixels, result.turnedScout.pixels, "sprites should face their direction of travel");
    assert.notDeepEqual(result.turnedScout.pixels, result.walkingScout.pixels, "sprites should animate as ants move");
    assert.ok(result.movement.scoutX > 100 && result.movement.scoutY === 100);
    assert.equal(result.movement.scoutHeading, 0);
    assert.ok(result.movement.scoutWalk > 3 && result.movement.workerWalk > 0);
    assert.ok(result.movement.workerX > 170 && result.movement.workerY > 100);
    assert.ok(result.zoomedOut < 3 && result.zoomedIn === 3);
    console.log("Ant rendering and zoom checks passed.");
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    window.destroy();
    app.exit(exitCode);
  }
});
