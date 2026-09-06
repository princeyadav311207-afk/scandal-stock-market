const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

function players(overrides = {}) {
  const base = [
    { id: "rahul", name: "Rahul", chosenStatementId: "7", balance: 1000, stats: E.defaultStats() },
    { id: "aman", name: "Aman", chosenStatementId: "3", balance: 1000, stats: E.defaultStats() },
    { id: "priya", name: "Priya", chosenStatementId: "7", balance: 1000, stats: E.defaultStats() },
    { id: "rohan", name: "Rohan", chosenStatementId: "2", balance: 1000, stats: E.defaultStats() },
  ];
  return base.map((p) => ({ ...p, ...(overrides[p.id] || {}) }));
}

test("normal correct and incorrect bets resolve against actual statement choosers", () => {
  const result = E.resolveRound("7", [
    { id: "b1", bettorId: "aman", targetId: "rahul", amount: 60 },
    { id: "b2", bettorId: "rohan", targetId: "aman", amount: 40 },
  ], players());

  assert.equal(result.bets[0].won, true);
  assert.equal(result.bets[1].won, false);
  assert.equal(result.losingPool, 40);
  assert.equal(result.payoutPerWinner, 40);
  assert.equal(result.players.find((p) => p.id === "aman").balance, 980);
  assert.equal(result.players.find((p) => p.id === "rohan").balance, 960);
});

test("a player can be correct through any of up to three chosen statements", () => {
  const result = E.resolveRound("12", [
    { id: "b1", bettorId: "aman", targetId: "rahul", amount: 60 },
    { id: "b2", bettorId: "rohan", targetId: "priya", amount: 40 },
  ], players({
    rahul: { chosenStatementIds: ["7", "12", "18"] },
    priya: { chosenStatementIds: ["1", "2", "3"] },
  }));

  assert.deepEqual(result.actualPlayerIds, ["rahul"]);
  assert.equal(result.bets[0].won, true);
  assert.equal(result.bets[1].won, false);
});

test("self-bet still loses when multiple players include the statement in their choices", () => {
  const result = E.resolveRound("12", [
    { id: "b1", bettorId: "rahul", targetId: "rahul", amount: 100 },
    { id: "b2", bettorId: "aman", targetId: "rahul", amount: 60 },
  ], players({
    rahul: { chosenStatementIds: ["7", "12"] },
    priya: { chosenStatementIds: ["12", "19"] },
  }));

  assert.equal(result.bets[0].won, false);
  assert.equal(result.bets[1].won, true);
  assert.equal(result.actualPlayerIds.length, 2);
});

test("self-bet wins when exactly one player chose the statement", () => {
  const result = E.resolveRound("7", [
    { id: "b1", bettorId: "rahul", targetId: "rahul", amount: 100 },
    { id: "b2", bettorId: "aman", targetId: "rohan", amount: 80 },
  ], players({ priya: { chosenStatementId: "5" } }));

  assert.equal(result.bets[0].won, true);
  assert.equal(result.bets[1].won, false);
  assert.equal(result.payoutPerWinner, 80);
  assert.equal(result.players.find((p) => p.id === "rahul").balance, 980);
});

test("self-bet loses when multiple players chose the statement", () => {
  const result = E.resolveRound("7", [
    { id: "b1", bettorId: "rahul", targetId: "rahul", amount: 100 },
    { id: "b2", bettorId: "aman", targetId: "rahul", amount: 60 },
  ], players());

  assert.equal(result.bets[0].won, false);
  assert.equal(result.bets[1].won, true);
  assert.equal(result.losingPool, 100);
  assert.equal(result.payoutPerWinner, 100);
  assert.equal(result.players.find((p) => p.id === "rahul").balance, 900);
  assert.equal(result.players.find((p) => p.id === "aman").balance, 1040);
});

test("zero correct people carries pool by default", () => {
  const result = E.resolveRound("20", [
    { id: "b1", bettorId: "rahul", targetId: "aman", amount: 40 },
    { id: "b2", bettorId: "aman", targetId: "rahul", amount: 60 },
  ], players(), { carryIn: 30 });

  assert.equal(result.actualPlayerIds.length, 0);
  assert.equal(result.winningBettorCount, 0);
  assert.equal(result.losingPool, 100);
  assert.equal(result.carryOut, 130);
  assert.equal(result.payoutPerWinner, 0);
});

test("zero correct people can return losing bets", () => {
  const result = E.resolveRound("20", [
    { id: "b1", bettorId: "rahul", targetId: "aman", amount: 40 },
  ], players(), { zeroWinnerPolicy: "return" });

  assert.equal(result.winningBettorCount, 0);
  assert.equal(result.returnedAmount, 40);
  assert.equal(result.players.find((p) => p.id === "rahul").balance, 1000);
});

test("multiple winners split unequal losing amounts equally", () => {
  const result = E.resolveRound("7", [
    { id: "b1", bettorId: "aman", targetId: "rahul", amount: 20 },
    { id: "b2", bettorId: "rohan", targetId: "priya", amount: 40 },
    { id: "b3", bettorId: "rahul", targetId: "rahul", amount: 100 },
    { id: "b4", bettorId: "priya", targetId: "priya", amount: 80 },
  ], players());

  assert.equal(result.winningBettorCount, 2);
  assert.equal(result.losingPool, 180);
  assert.equal(result.payoutPerWinner, 90);
  assert.equal(result.players.find((p) => p.id === "aman").balance, 1070);
  assert.equal(result.players.find((p) => p.id === "rohan").balance, 1050);
});

test("everyone choosing the statement makes normal bets win and self-bets lose", () => {
  const all = players({
    aman: { chosenStatementId: "7" },
    rohan: { chosenStatementId: "7" },
  });
  const result = E.resolveRound("7", [
    { id: "b1", bettorId: "rahul", targetId: "rahul", amount: 20 },
    { id: "b2", bettorId: "aman", targetId: "rahul", amount: 20 },
  ], all);

  assert.equal(result.bets[0].won, false);
  assert.equal(result.bets[1].won, true);
});

test("insufficient balance is rejected", () => {
  assert.throws(() => E.resolveRound("7", [
    { id: "b1", bettorId: "rahul", targetId: "aman", amount: 60 },
  ], players({ rahul: { balance: 40 } })), /Insufficient balance/);
});
