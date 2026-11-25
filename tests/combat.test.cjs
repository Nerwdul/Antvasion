const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createGame() {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        addEventListener() {},
        getContext() { return {}; },
        classList: { toggle() {} },
        setAttribute() {},
        textContent: "",
        disabled: false
      });
    }
    return elements.get(selector);
  };
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const speedButtons = Array.from(html.matchAll(/data-game-speed="([^"]+)"/g), (match) => ({
    dataset: { gameSpeed: match[1] },
    classList: { toggle() {} },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, callback) { if (name === "click") this.click = callback; }
  }));
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: (selector) => selector === "[data-game-speed]" ? speedButtons : [] },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null },
    Image: class { addEventListener() {} },
    requestAnimationFrame: () => 1,
    console
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
  vm.runInContext(`${source}
    globalThis.hooks = {
      setGame: (value) => { game = value; },
      infectHouse, updateCombat, updateGame, arriveAtHouse, recruitSoldier, setGameSpeed, gameLoop,
      setFrameFunctions: (update, draw) => { updateGame = update; drawGame = draw; }
    };
  `, context);
  const game = {
    running: true,
    paused: false,
    spawnTimer: 0,
    score: 0,
    claimed: 0,
    houses: [],
    ants: [],
    workers: [],
    soldiers: [],
    exterminators: [],
    exterminatorsActivated: false,
    exterminatorTimer: 0
  };
  context.hooks.setGame(game);
  return { game, hooks: context.hooks, element, speedButtons };
}

function infect(game, hooks, count) {
  for (let i = 0; i < count; i += 1) {
    const house = { x: 100 + game.houses.length * 40, y: 100, claimed: false, progress: 100, protection: 0, incoming: 0 };
    game.houses.push(house);
    hooks.infectHouse(house);
  }
}

test("exterminator waves start at five houses and scale", () => {
  const { game, hooks } = createGame();
  infect(game, hooks, 4);
  hooks.updateCombat(0.04);
  assert.equal(game.exterminators.length, 0);
  infect(game, hooks, 1);
  hooks.updateCombat(0.04);
  assert.equal(game.exterminators.length, 1);
  assert.equal(game.exterminators[0].health, 100);
  const firstInterval = game.exterminatorTimer;
  infect(game, hooks, 5);
  game.exterminatorTimer = 0;
  hooks.updateCombat(0.04);
  assert.equal(game.exterminators.length, 3);
  assert.ok(game.exterminatorTimer < firstInterval);
});

test("recruiting spends supplies and combat protects the house", () => {
  const { game, hooks } = createGame();
  infect(game, hooks, 1);
  const house = game.houses[0];
  game.score = 49;
  hooks.recruitSoldier();
  assert.equal(game.soldiers.length, 0);
  game.score = 50;
  hooks.recruitSoldier();
  assert.equal(game.score, 0);
  assert.equal(game.soldiers.length, 1);
  const soldier = game.soldiers[0];
  soldier.x = house.x;
  soldier.y = house.y;
  game.exterminators.push({ x: house.x, y: house.y, health: 100, cooldown: 1 });
  hooks.updateCombat(1);
  assert.equal(soldier.health, 3);
  assert.equal(game.exterminators[0].health, 99);
  assert.equal(house.progress, 100);
  hooks.updateCombat(1);
  hooks.updateCombat(1);
  assert.equal(game.soldiers.length, 0);
  hooks.updateCombat(1);
  assert.equal(house.progress, 98);
  assert.equal(game.workers.length, 0);
});

test("destroyed nests release workers toward the nearest other available house", () => {
  const { game, hooks } = createGame();
  infect(game, hooks, 1);
  const house = game.houses[0];
  const near = { x: 250, y: 100, claimed: false, progress: 0, protection: 0, incoming: 0 };
  const far = { x: 500, y: 100, claimed: false, progress: 0, protection: 0, incoming: 0 };
  game.houses.push(near, far);
  game.exterminators.push({ x: house.x, y: house.y, health: 100, cooldown: 1 });
  for (let i = 0; i < 50; i += 1) hooks.updateCombat(1);
  assert.equal(house.progress, 0);
  assert.equal(house.claimed, false);
  assert.equal(house.protection, 100);
  assert.equal(game.claimed, 0);
  assert.equal(game.workers.length, 100);
  assert.ok(game.workers.every((worker) => worker.health === 4 && worker.sourceHouse === house));
  game.exterminators = [];
  hooks.updateGame(0.1);
  assert.equal(near.incoming, 100);
  assert.equal(far.incoming, 0);
  assert.ok(game.workers.every((worker) => worker.target === near));
});

test("fleeing workers use the next nearest house when the closest is full", () => {
  const { game, hooks } = createGame();
  infect(game, hooks, 1);
  const source = game.houses[0];
  const near = { x: 250, y: 100, claimed: false, progress: 98, protection: 0, incoming: 0 };
  const far = { x: 500, y: 100, claimed: false, progress: 0, protection: 0, incoming: 0 };
  game.houses.push(near, far);
  game.exterminators.push({ x: source.x, y: source.y, health: 100, cooldown: 1 });
  for (let i = 0; i < 50; i += 1) hooks.updateCombat(1);
  game.exterminators = [];
  hooks.updateGame(0.1);
  assert.equal(near.incoming, 2);
  assert.equal(far.incoming, 98);
  assert.equal(source.incoming, 0);
});

test("released workers wander and retry when no other house is available", () => {
  const { game, hooks } = createGame();
  infect(game, hooks, 1);
  const house = game.houses[0];
  game.exterminators.push({ x: house.x, y: house.y, health: 100, cooldown: 1 });
  for (let i = 0; i < 50; i += 1) hooks.updateCombat(1);
  game.exterminators = [];
  const worker = game.workers[0];
  const before = { x: worker.x, y: worker.y };
  hooks.updateGame(0.1);
  assert.equal(worker.target, null);
  assert.notDeepEqual({ x: worker.x, y: worker.y }, before);
  const other = { x: 300, y: 100, claimed: false, progress: 0, protection: 0, incoming: 0 };
  game.houses.push(other);
  hooks.updateGame(1);
  assert.equal(worker.target, other);
  assert.equal(house.incoming, 0);
});

test("exterminators pursue fleeing workers and deal area damage", () => {
  const { game, hooks } = createGame();
  const targetHouse = { x: 300, y: 100, claimed: false, progress: 0, protection: 0, incoming: 2 };
  game.houses.push(targetHouse);
  const worker = (x, y, target) => ({ x, y, health: 4, fleeing: true, target });
  game.workers.push(worker(100, 100, targetHouse), worker(100, 100, targetHouse), worker(150, 100, null));
  const exterminator = { x: 40, y: 100, health: 100, cooldown: 0 };
  game.exterminators.push(exterminator);
  hooks.updateCombat(1);
  assert.equal(exterminator.x, 70);
  hooks.updateCombat(1);
  hooks.updateCombat(1);
  assert.equal(game.workers[0].health, 2);
  assert.equal(game.workers[1].health, 2);
  assert.equal(game.workers[2].health, 4);
  hooks.updateCombat(1);
  assert.equal(game.workers.length, 1);
  assert.equal(game.workers[0].health, 4);
  assert.equal(targetHouse.incoming, 0);
});

test("exterminators hit nearby fleeing workers after approaching the group", () => {
  const { game, hooks } = createGame();
  game.workers.push(
    { x: 100, y: 100, health: 4, fleeing: true, target: null },
    { x: 104, y: 100, health: 4, fleeing: true, target: null }
  );
  game.exterminators.push({ x: 70, y: 100, health: 100, cooldown: 0 });
  hooks.updateCombat(1);
  hooks.updateCombat(1);
  assert.equal(game.workers[0].health, 2);
  assert.equal(game.workers[1].health, 2);
});

test("protected houses consume 100 ants before needing 100 more to reinfect", () => {
  const { game, hooks } = createGame();
  const house = { x: 100, y: 100, claimed: false, progress: 0, protection: 100, incoming: 200 };
  game.houses.push(house);
  for (let i = 0; i < 99; i += 1) hooks.arriveAtHouse({ target: house });
  assert.equal(house.protection, 1);
  assert.equal(house.progress, 0);
  hooks.arriveAtHouse({ target: house });
  assert.equal(house.protection, 0);
  assert.equal(house.progress, 0);
  assert.equal(house.claimed, false);
  for (let i = 0; i < 99; i += 1) hooks.arriveAtHouse({ target: house });
  assert.equal(house.progress, 99);
  assert.equal(house.claimed, false);
  hooks.arriveAtHouse({ target: house });
  assert.equal(house.progress, 100);
  assert.equal(house.incoming, 0);
  assert.equal(house.claimed, true);
});

test("arriving scouts remove protection and reinfect through the game update", () => {
  const { game, hooks } = createGame();
  const house = { x: 100, y: 100, claimed: false, progress: 0, protection: 100, incoming: 200 };
  game.houses.push(house);
  for (let i = 0; i < 200; i += 1) {
    game.ants.push({ x: 100, y: 100, heading: 0, walkDistance: 0, target: house });
  }
  hooks.updateGame(0.1);
  assert.equal(game.ants.length, 0);
  assert.equal(house.protection, 0);
  assert.equal(house.progress, 100);
  assert.equal(house.incoming, 0);
  assert.equal(house.claimed, true);
});

test("soldiers seek the nearest threat", () => {
  const { game, hooks } = createGame();
  infect(game, hooks, 1);
  game.score = 50;
  hooks.recruitSoldier();
  const soldier = game.soldiers[0];
  soldier.x = 180;
  soldier.y = 100;
  game.exterminators = [
    { x: 100, y: 100, health: 100, cooldown: 1 },
    { x: 200, y: 100, health: 100, cooldown: 1 }
  ];
  hooks.updateCombat(0.1);
  assert.ok(soldier.x > 180);
});

test("10x and 20x advance simulation at the selected rates", () => {
  const { game, hooks, element, speedButtons } = createGame();
  const updates = [];
  hooks.setFrameFunctions((delta) => updates.push(delta), () => {});
  assert.deepEqual(speedButtons.map((button) => Number(button.dataset.gameSpeed)), [1, 1.5, 2, 3, 5, 10, 20]);
  for (const speed of [5, 10, 20, 1]) {
    const option = speedButtons.find((button) => Number(button.dataset.gameSpeed) === speed);
    option.click();
    assert.equal(element("#speed-label").textContent, `${speed}x`);
    assert.equal(option["aria-pressed"], "true");
    if (speed === 10 || speed === 20) {
      updates.length = 0;
      game.lastFrame = 1000;
      hooks.gameLoop(1040);
      const expected = speed === 10 ? 0.4 : 0.8;
      assert.ok(Math.abs(updates.reduce((sum, delta) => sum + delta, 0) - expected) < 1e-10);
      assert.ok(updates.every((delta) => delta <= 0.2));
    }
  }
});
