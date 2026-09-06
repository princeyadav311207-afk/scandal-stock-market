(function (root) {
  "use strict";

  const BET_MIN = 20;
  const BET_MAX = 100;

  function money(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function shuffleIds(ids, random = Math.random) {
    const next = ids.slice();
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  function parseStatements(text) {
    const normalized = String(text || "").replace(/\r/g, "");
    const rawLines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    const parsed = [];
    let current = null;

    rawLines.forEach((line) => {
      const numbered = line.match(/^(\d+)[.)\-\s]+(.+)$/);
      if (numbered) {
        if (current) parsed.push(current);
        current = numbered[2].trim();
      } else if (current && /^[a-z]/.test(line)) {
        current += ` ${line}`;
      } else {
        if (current) parsed.push(current);
        current = line.replace(/^[-*]\s+/, "").trim();
      }
    });

    if (current) parsed.push(current);
    return parsed.filter(Boolean);
  }

  function validateBet(bet, playersById) {
    const bettor = playersById.get(bet.bettorId);
    if (!bettor) throw new Error("Bettor not found");
    if (!playersById.has(bet.targetId)) throw new Error("Target player not found");
    if (!Number.isInteger(bet.amount)) throw new Error("Bet amount must be an integer");
    if (bet.amount < BET_MIN || bet.amount > BET_MAX) throw new Error("Bet amount must be between 20 and 100");
    if (bettor.balance < bet.amount) throw new Error("Insufficient balance");
  }

  function playerChoseStatement(player, statementId) {
    const choices = Array.isArray(player.chosenStatementIds)
      ? player.chosenStatementIds
      : [player.chosenStatementId];
    return choices.some((id) => String(id) === String(statementId));
  }

  function resolveRound(statementId, bets, players, options = {}) {
    const carryIn = money(options.carryIn || 0);
    const zeroWinnerPolicy = options.zeroWinnerPolicy || "carry";
    const betsAlreadyDeducted = !!options.betsAlreadyDeducted;
    const playersById = new Map(players.map((player) => [player.id, { ...player }]));
    const actualPlayers = players.filter((player) => playerChoseStatement(player, statementId));
    const actualIds = new Set(actualPlayers.map((player) => player.id));

    bets.forEach((bet) => validateBet(bet, playersById));

    const resolvedBets = bets.map((bet) => {
      const isSelfBet = bet.bettorId === bet.targetId;
      const targetActuallyChose = actualIds.has(bet.targetId);
      const wins = isSelfBet
        ? actualPlayers.length === 1 && actualIds.has(bet.bettorId)
        : targetActuallyChose;

      return {
        ...bet,
        isSelfBet,
        result: wins ? "WIN" : "LOSS",
        won: wins,
        payout: 0,
        balanceDelta: -bet.amount,
      };
    });

    const losingPool = money(resolvedBets.filter((bet) => !bet.won).reduce((sum, bet) => sum + bet.amount, 0));
    const winningBets = resolvedBets.filter((bet) => bet.won);
    let payoutPerWinner = 0;
    let carryOut = 0;
    let returnedAmount = 0;

    if (winningBets.length > 0) {
      payoutPerWinner = money((losingPool + carryIn) / winningBets.length);
    } else if (zeroWinnerPolicy === "return") {
      returnedAmount = losingPool;
    } else {
      carryOut = money(losingPool + carryIn);
    }

    const updatedPlayers = players.map((player) => {
      const newPlayer = { ...player, stats: { ...defaultStats(), ...(player.stats || {}) } };
      const playerBets = resolvedBets.filter((bet) => bet.bettorId === player.id);
      let delta = 0;

      playerBets.forEach((bet) => {
        if (!betsAlreadyDeducted) delta -= bet.amount;
        newPlayer.stats.totalWagered = money(newPlayer.stats.totalWagered + bet.amount);
        if (bet.won) {
          delta += payoutPerWinner;
          bet.payout = payoutPerWinner;
          bet.balanceDelta = money(-bet.amount + payoutPerWinner);
          newPlayer.stats.winningBets += 1;
          newPlayer.stats.biggestWinningRound = Math.max(newPlayer.stats.biggestWinningRound, bet.balanceDelta);
        } else {
          bet.balanceDelta = -bet.amount;
          newPlayer.stats.losingBets += 1;
          newPlayer.stats.biggestLosingRound = Math.min(newPlayer.stats.biggestLosingRound, bet.balanceDelta);
        }
      });

      if (winningBets.length === 0 && zeroWinnerPolicy === "return") {
        const refund = playerBets.reduce((sum, bet) => sum + bet.amount, 0);
        delta += refund;
        playerBets.forEach((bet) => {
          bet.payout = bet.amount;
          bet.balanceDelta = 0;
        });
      }

      newPlayer.balance = money(newPlayer.balance + delta);
      return newPlayer;
    });

    return {
      id: createId("round"),
      statementId,
      actualPlayerIds: Array.from(actualIds),
      actualPlayerNames: actualPlayers.map((player) => player.name),
      bets: resolvedBets,
      losingPool,
      carryIn,
      carryOut,
      returnedAmount,
      winningBettorIds: winningBets.map((bet) => bet.bettorId),
      winningBettorCount: winningBets.length,
      payoutPerWinner,
      zeroWinnerPolicy,
      players: updatedPlayers,
      completedAt: new Date().toISOString(),
    };
  }

  function defaultStats() {
    return {
      winningBets: 0,
      losingBets: 0,
      totalWagered: 0,
      biggestWinningRound: 0,
      biggestLosingRound: 0,
    };
  }

  function createSampleStatements(count = 33) {
    const samples = [
      "I have lied to get out of a difficult situation.",
      "I have stalked someone online before meeting them.",
      "I have pretended to like a gift and secretly hated it.",
      "I have blamed traffic when I was simply late.",
      "I have sent a message to the wrong person and panicked.",
      "I have kept a ridiculous secret for years.",
      "I have rehearsed a comeback in the mirror.",
      "I have ghosted someone because replying felt too hard.",
      "I have exaggerated a story to make it funnier.",
      "I have eaten someone else's food and denied it.",
      "I have searched my own name online.",
      "I have laughed at a joke I did not understand.",
      "I have checked someone's last seen more than once.",
      "I have made plans hoping they would get cancelled.",
      "I have pretended to be busy to avoid a call.",
      "I have used a friend's streaming password.",
      "I have saved a screenshot as evidence.",
      "I have judged someone by their playlist.",
      "I have overthought a one-word reply.",
      "I have had a crush I never admitted.",
      "I have faked confidence in a situation.",
      "I have deleted a post because it got no attention.",
      "I have lied about watching a famous movie.",
      "I have ordered extra food and called it sharing.",
      "I have changed my opinion to avoid an argument.",
      "I have made a dramatic exit in my head.",
      "I have pretended not to see someone in public.",
      "I have given advice I did not follow myself.",
      "I have said 'five minutes' and meant thirty.",
      "I have snoozed an alarm more than five times.",
      "I have been jealous of a friend's vacation.",
      "I have kept a harmless but embarrassing habit secret.",
      "I have won an argument in the shower hours later.",
    ];
    return Array.from({ length: count }, (_, index) => ({
      id: String(index + 1),
      label: index < samples.length ? "Sample" : "Empty",
      text: samples[index] || "",
    }));
  }

  const api = {
    BET_MIN,
    BET_MAX,
    createId,
    createSampleStatements,
    defaultStats,
    money,
    parseStatements,
    playerChoseStatement,
    resolveRound,
    shuffleIds,
    validateBet,
  };

  root.ScandalEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
