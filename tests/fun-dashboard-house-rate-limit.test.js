import assert from "node:assert/strict";
import test from "node:test";

import { getHouseRateLimitPolicy } from "../fun_dashboard/src/lib/houseRateLimitPolicy.js";
import { shouldPublishMovement } from "../fun_dashboard/src/lib/realtimeMovementPolicy.js";

const HOUSE = "/api/fun/houses/test-token";

test("transporte realtime válido usa o limite por sessão do servidor", () => {
  const routes = [
    ["GET", `${HOUSE}/realtime/stream`],
    ["POST", `${HOUSE}/realtime/snapshot`],
    ["POST", `${HOUSE}/realtime/move`],
    ["POST", `${HOUSE}/realtime/chat`],
    ["POST", `${HOUSE}/realtime/signal`],
    ["POST", `${HOUSE}/realtime/leave`],
  ];

  for (const [method, pathname] of routes) {
    assert.deepEqual(getHouseRateLimitPolicy(pathname, method), {
      bucket: "house-realtime",
      bypassGeneric: true,
    });
  }
});

test("método inválido não consegue furar o limite HTTP genérico", () => {
  assert.deepEqual(getHouseRateLimitPolicy(`${HOUSE}/realtime/move`, "GET"), {
    bucket: "houses",
    bypassGeneric: false,
  });
});

test("criação de sessão tem balde próprio contra reconexões abusivas", () => {
  assert.deepEqual(getHouseRateLimitPolicy(`${HOUSE}/session`, "POST"), {
    bucket: "house-session",
    bypassGeneric: false,
  });
});

test("leituras e mutações persistentes continuam protegidas", () => {
  const routes = [
    ["GET", HOUSE],
    ["GET", `${HOUSE}/shop`],
    ["POST", `${HOUSE}/collect`],
    ["POST", `${HOUSE}/items/place`],
    ["PUT", `${HOUSE}/items/move`],
    ["POST", `${HOUSE}/rob`],
  ];

  for (const [method, pathname] of routes) {
    assert.deepEqual(getHouseRateLimitPolicy(pathname, method), {
      bucket: "houses",
      bypassGeneric: false,
    });
  }
});

test("rotas fora da API de casas não são reclassificadas", () => {
  assert.equal(getHouseRateLimitPolicy("/casas/test-token", "GET"), null);
  assert.equal(getHouseRateLimitPolicy("/api/fun/overview", "GET"), null);
});

test("avatar parado não gera tráfego e movimento respeita a cadência", () => {
  assert.equal(shouldPublishMovement({ moving: false, wasMoving: false, elapsed: 10, lastSent: 0, interval: 0.15 }), false);
  assert.equal(shouldPublishMovement({ moving: true, wasMoving: true, elapsed: 1.1, lastSent: 1, interval: 0.15 }), false);
  assert.equal(shouldPublishMovement({ moving: true, wasMoving: true, elapsed: 1.2, lastSent: 1, interval: 0.15 }), true);
});

test("início e parada sempre publicam a mudança final de estado", () => {
  assert.equal(shouldPublishMovement({ moving: true, wasMoving: false, elapsed: 0, lastSent: 0, interval: 0.15 }), true);
  assert.equal(shouldPublishMovement({ moving: false, wasMoving: true, elapsed: 0.01, lastSent: 0, interval: 0.15 }), true);
});
