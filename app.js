(function () {
  "use strict";

  const E = window.ScandalEngine;
  const SAVE_KEY = "scandal-stock-market:v1";
  const app = document.getElementById("app");

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  const state = loadState() || freshState();
  let menuOpen = false;

  function freshState() {
    return {
      screen: "landing",
      statements: E.createSampleStatements(33),
      players: [],
      startingBalance: 1000,
      zeroWinnerPolicy: "carry",
      carryPool: 0,
      order: [],
      currentStatementId: null,
      phase: "setup",
      bettorIndex: 0,
      activeReady: false,
      selectedTargetId: "",
      betAmount: 20,
      currentBets: [],
      history: [],
      paused: false,
      sampleMode: true,
      toast: "",
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      return saved ? migrateState(saved) : null;
    } catch (_) {
      return null;
    }
  }

  function migrateState(saved) {
    saved.players = (saved.players || []).map((p) => ({
      ...p,
      chosenStatementIds: playerChoiceIds(p),
    }));
    return saved;
  }

  function saveState() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function setState(changes) {
    Object.assign(state, changes);
    saveState();
    render();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }

  function currency(value) {
    return `₹${E.money(value).toLocaleString("en-IN")}`;
  }

  function statement(id) {
    return state.statements.find((item) => String(item.id) === String(id));
  }

  function player(id) {
    return state.players.find((item) => item.id === id);
  }

  function sortedPlayers(players = state.players) {
    return players.slice().sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }

  function playerChoiceIds(p) {
    const choices = Array.isArray(p.chosenStatementIds) ? p.chosenStatementIds : [p.chosenStatementId];
    const seen = new Set();
    return choices.map((id) => String(id || "")).filter(Boolean).filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 3);
  }

  function chosenStatementIds(players = state.players) {
    return new Set(players.flatMap(playerChoiceIds));
  }

  function playableStatements(players = state.players) {
    const chosen = chosenStatementIds(players);
    return state.statements.filter((item) => item.text.trim() && chosen.has(String(item.id)));
  }

  function remainingCount() {
    return state.order.filter((id) => !state.history.some((round) => String(round.statementId) === String(id))).length;
  }

  function validSetup() {
    const validStatements = state.statements.filter((item) => item.text.trim());
    const statementIds = new Set(validStatements.map((item) => String(item.id)));
    const playable = playableStatements();
    return validStatements.length > 0 &&
      state.players.length >= 2 &&
      playable.length > 0 &&
      state.players.every((p) => {
        const choices = playerChoiceIds(p);
        return p.name.trim() && choices.length >= 1 && choices.length <= 3 && choices.every((id) => statementIds.has(String(id)));
      });
  }

  function startGame() {
    if (!validSetup()) return toast("Add at least two players and valid statement choices first.");
    const players = state.players.map((p) => ({
      ...p,
      chosenStatementIds: playerChoiceIds(p),
      balance: Number(state.startingBalance),
      stats: E.defaultStats(),
    }));
    const order = E.shuffleIds(playableStatements(players).map((item) => item.id));
    Object.assign(state, {
      screen: "game",
      phase: "reveal",
      players,
      order,
      currentStatementId: order[0],
      bettorIndex: 0,
      activeReady: false,
      selectedTargetId: "",
      betAmount: 20,
      currentBets: [],
      history: [],
      carryPool: 0,
      paused: false,
    });
    saveState();
    render();
  }

  function advanceStatement() {
    const played = new Set(state.history.map((round) => String(round.statementId)));
    const next = state.order.find((id) => !played.has(String(id)));
    if (!next) {
      setState({ screen: "final", phase: "final" });
      return;
    }
    setState({
      screen: "game",
      phase: "reveal",
      currentStatementId: next,
      bettorIndex: 0,
      activeReady: false,
      selectedTargetId: "",
      betAmount: 20,
      currentBets: [],
    });
  }

  function beginBetting() {
    setState({
      phase: "betting",
      bettorIndex: 0,
      activeReady: false,
      selectedTargetId: "",
      betAmount: 20,
      currentBets: [],
    });
  }

  function lockBet() {
    const bettor = state.players[state.bettorIndex];
    if (!bettor) return;
    const amount = Math.round(Math.min(E.BET_MAX, bettor.balance, Math.max(E.BET_MIN, Number(state.betAmount))));
    if (!state.selectedTargetId) return toast("Choose a player to bet on.");
    if (!Number.isInteger(amount) || amount < E.BET_MIN || amount > E.BET_MAX) return toast("Bet must be an integer from ₹20 to ₹100.");
    if (amount > bettor.balance) return toast("Insufficient balance for that bet.");
    const bet = {
      id: E.createId("bet"),
      bettorId: bettor.id,
      targetId: state.selectedTargetId,
      amount,
    };
    const nextIndex = state.bettorIndex + 1;
    bettor.balance = E.money(bettor.balance - amount);
    state.currentBets.push(bet);
    state.selectedTargetId = "";
    state.betAmount = 20;
    state.activeReady = false;
    if (nextIndex >= state.players.length) {
      resolveCurrentRound();
    } else {
      state.bettorIndex = nextIndex;
      saveState();
      render();
      toast("Bet locked.");
    }
  }

  function resolveCurrentRound() {
    try {
      const result = E.resolveRound(state.currentStatementId, state.currentBets, state.players, {
        carryIn: state.carryPool,
        zeroWinnerPolicy: state.zeroWinnerPolicy,
        betsAlreadyDeducted: true,
      });
      state.players = result.players;
      state.carryPool = result.carryOut;
      state.history.push(result);
      state.phase = "results";
      saveState();
      render();
      if (result.winningBettorCount > 0) confetti();
    } catch (err) {
      toast(err.message);
    }
  }

  function restartCurrentRound() {
    refundCurrentBets();
    setState({ phase: "reveal", bettorIndex: 0, activeReady: false, selectedTargetId: "", betAmount: 20, currentBets: [] });
  }

  function skipStatement() {
    if (!state.currentStatementId) return;
    refundCurrentBets();
    state.history.push({
      id: E.createId("skip"),
      statementId: state.currentStatementId,
      actualPlayerIds: [],
      actualPlayerNames: [],
      bets: [],
      losingPool: 0,
      carryIn: state.carryPool,
      carryOut: state.carryPool,
      winningBettorCount: 0,
      payoutPerWinner: 0,
      skipped: true,
      completedAt: new Date().toISOString(),
    });
    saveState();
    advanceStatement();
  }

  function undoLastBet() {
    if (state.phase !== "betting" || !state.currentBets.length) return toast("No locked bet to undo in this round.");
    const last = state.currentBets.pop();
    const bettor = player(last.bettorId);
    if (bettor) bettor.balance = E.money(bettor.balance + last.amount);
    state.bettorIndex = Math.max(0, state.bettorIndex - 1);
    state.activeReady = true;
    saveState();
    render();
  }

  function refundCurrentBets() {
    state.currentBets.forEach((bet) => {
      const bettor = player(bet.bettorId);
      if (bettor) bettor.balance = E.money(bettor.balance + bet.amount);
    });
  }

  function toast(message) {
    state.toast = message;
    render();
    window.setTimeout(() => {
      if (state.toast === message) {
        state.toast = "";
        render();
      }
    }, 2200);
  }

  function confetti() {
    const wrap = document.createElement("div");
    wrap.className = "confetti";
    for (let i = 0; i < 80; i += 1) {
      const piece = document.createElement("i");
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.animationDelay = `${Math.random() * 420}ms`;
      piece.style.background = [E.BET_MIN, E.BET_MAX, 60][i % 3] === 20 ? "var(--green)" : i % 2 ? "var(--cyan)" : "var(--gold)";
      wrap.appendChild(piece);
    }
    document.body.appendChild(wrap);
    window.setTimeout(() => wrap.remove(), 1800);
  }

  function render() {
    if (state.screen === "landing") app.innerHTML = landingHtml();
    if (state.screen === "setup") app.innerHTML = setupHtml();
    if (state.screen === "game") app.innerHTML = gameHtml();
    if (state.screen === "history") app.innerHTML = historyHtml();
    if (state.screen === "final") app.innerHTML = finalHtml();
    if (state.toast) app.insertAdjacentHTML("beforeend", `<div class="toast">${escapeHtml(state.toast)}</div>`);
    bind();
  }

  function landingHtml() {
    const canResume = !!localStorage.getItem(SAVE_KEY);
    return `
      <main class="hero">
        <section class="hero-inner">
          <div class="eyebrow">Offline party exchange</div>
          <h1 class="shimmer">SCANDAL STOCK MARKET</h1>
          <p class="tagline">Think you know everyone's scandals? Put your money where your prediction is.</p>
          <div class="actions">
            <button class="btn primary" data-action="newSetup">Create New Game</button>
            <button class="btn" data-action="resume" ${canResume ? "" : "disabled"}>Resume Game</button>
          </div>
        </section>
      </main>`;
  }

  function setupHtml() {
    const ready = validSetup();
    return `
      <main class="screen">
        ${topbar("SETUP EXCHANGE", false)}
        <section class="grid three">
          <div class="metric"><span>Players Ready</span><strong>${state.players.length}</strong></div>
          <div class="metric"><span>Playable Statements</span><strong>${playableStatements().length}</strong></div>
          <div class="metric"><span>Starting Balance</span><strong>${currency(state.startingBalance)}</strong></div>
        </section>
        <div class="grid two" style="margin-top:18px">
          <section class="panel">
            <div class="topbar">
              <div><h2>Statements</h2><p class="notice">${state.sampleMode ? "Sample statements are loaded so you can test immediately. Paste your own numbered list whenever you are ready." : "Paste numbered or plain lines, preview them, then replace the statement board."}</p></div>
            </div>
            <label>Paste your statements here
              <textarea id="pasteStatements" placeholder="1. First scandal...&#10;2. Second scandal..."></textarea>
            </label>
            <div class="actions" style="margin:10px 0 18px">
              <button class="btn" data-action="previewPaste">Preview Import</button>
              <button class="btn primary" data-action="applyPaste">Replace With Paste</button>
              <button class="btn" data-action="addStatement">+ Add Statement</button>
            </div>
            <div id="pastePreview" class="notice hide"></div>
            <div class="statement-list">
              ${state.statements.map(statementRow).join("")}
            </div>
          </section>
          <section class="panel">
            <h2>Add Players</h2>
            <p class="notice">Each player can choose up to three original statements. The game will only reveal statements selected by at least one player.</p>
            <div class="grid">
              <label>Starting balance
                <input class="input" id="startingBalance" type="number" min="100" step="50" value="${state.startingBalance}">
              </label>
              <label>No-winner rule
                <select id="zeroWinnerPolicy">
                  <option value="carry" ${state.zeroWinnerPolicy === "carry" ? "selected" : ""}>Carry losing pool to next round</option>
                  <option value="return" ${state.zeroWinnerPolicy === "return" ? "selected" : ""}>Return losing bets</option>
                </select>
              </label>
              <button class="btn" data-action="addPlayer">+ Add Player</button>
            </div>
            <h3 style="margin-top:22px">${state.players.length} Players Ready</h3>
            <div class="player-list">${state.players.map(playerRow).join("") || `<p class="notice">Add at least two players to open the market.</p>`}</div>
            <div class="actions" style="margin-top:18px">
              <button class="btn primary" data-action="startGame" ${ready ? "" : "disabled"}>START GAME</button>
              <button class="btn" data-action="saveGame">Save Game</button>
            </div>
            ${ready ? "" : `<p class="danger">Setup needs at least two named players, and every player needs one to three valid statement choices. Only chosen statements will appear in the game.</p>`}
          </section>
        </div>
      </main>`;
  }

  function statementRow(item, index) {
    return `
      <div class="statement-row" data-statement-id="${escapeHtml(item.id)}">
        <span class="pill">#${index + 1}</span>
        <input class="input statement-input" value="${escapeHtml(item.text)}" placeholder="Statement ${index + 1}">
        <div class="actions">
          <button class="btn" data-action="moveStatementUp" data-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="btn" data-action="moveStatementDown" data-index="${index}" ${index === state.statements.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn danger" data-action="deleteStatement" data-index="${index}">Delete</button>
        </div>
      </div>`;
  }

  function options(selected, includeBlank = false) {
    const blank = includeBlank ? `<option value="">No extra statement</option>` : "";
    return blank + state.statements.filter((s) => s.text.trim()).map((s, i) =>
      `<option value="${escapeHtml(s.id)}" ${String(selected) === String(s.id) ? "selected" : ""}>#${i + 1} ${escapeHtml(s.text.slice(0, 58))}</option>`
    ).join("");
  }

  function playerRow(item, index) {
    const choices = playerChoiceIds(item);
    return `
      <div class="player-row" data-player-id="${item.id}">
        <input class="input player-name" value="${escapeHtml(item.name)}" placeholder="Player name">
        <div class="choice-stack">
          <select class="player-choice" data-choice-index="0">${options(choices[0])}</select>
          <select class="player-choice" data-choice-index="1">${options(choices[1], true)}</select>
          <select class="player-choice" data-choice-index="2">${options(choices[2], true)}</select>
        </div>
        <button class="btn danger" data-action="deletePlayer" data-index="${index}">Remove</button>
      </div>`;
  }

  function topbar(subtitle, showControls = true) {
    return `
      <header class="topbar">
        <div class="brand"><span>SCANDAL STOCK MARKET</span><span>${escapeHtml(subtitle)}</span></div>
        ${showControls ? hostControls() : `<button class="btn" data-action="newSetup">Reset Setup</button>`}
      </header>`;
  }

  function hostControls() {
    return `
      <div class="host-menu">
        <button class="btn" data-action="toggleMenu">Host Controls</button>
        <div class="menu-panel ${menuOpen ? "" : "hide"}">
          <button class="btn" data-action="togglePause">${state.paused ? "Resume Game" : "Pause Game"}</button>
          <button class="btn" data-action="restartRound">Restart Current Round</button>
          <button class="btn" data-action="skipStatement">Skip Statement</button>
          <button class="btn" data-action="undoBet">Undo Last Bet</button>
          <button class="btn" data-action="viewHistory">View Game History</button>
          <button class="btn danger" data-action="restartGame">Restart Entire Game</button>
          <button class="btn danger" data-action="returnSetup">Return To Setup</button>
        </div>
      </div>`;
  }

  function gameHtml() {
    if (state.paused) {
      return `<main class="screen">${topbar("PAUSED")}<section class="pass-screen"><div class="pass-card"><h1>MARKET PAUSED</h1><button class="btn primary" data-action="togglePause">Resume Game</button></div></section></main>`;
    }
    const current = statement(state.currentStatementId);
    const played = state.history.filter((round) => !round.skipped).length + (state.phase === "results" ? 0 : 1);
    const total = state.order.length || state.statements.filter((s) => s.text.trim()).length;
    const percent = Math.min(100, (played / Math.max(1, total)) * 100);
    return `
      <main class="screen">
        ${topbar(`STATEMENT ${played} / ${total}`)}
        <div class="progress"><span style="width:${percent}%"></span></div>
        ${state.carryPool ? `<p class="notice" style="margin-top:14px">Carried market pool: ${currency(state.carryPool)}</p>` : ""}
        ${state.phase === "reveal" ? revealHtml(current, played, total) : ""}
        ${state.phase === "betting" ? bettingHtml(current) : ""}
        ${state.phase === "results" ? resultsHtml(state.history[state.history.length - 1]) : ""}
      </main>`;
  }

  function revealHtml(current, played, total) {
    return `
      <section class="statement-stage" style="margin-top:18px">
        <div>
          <div class="eyebrow">Statement #${escapeHtml(current.id)} · ${played} / ${total}</div>
          <blockquote>“${escapeHtml(current.text)}”</blockquote>
          <div class="actions" style="justify-content:center;margin-top:26px">
            <button class="btn primary" data-action="beginBetting">Open Betting Floor</button>
          </div>
        </div>
      </section>`;
  }

  function bettingHtml(current) {
    const bettor = state.players[state.bettorIndex];
    if (!bettor) return "";
    if (!state.activeReady) {
      return `
        <section class="pass-screen">
          <div class="pass-card">
            <div class="eyebrow">Pass the device</div>
            <h1>PASS TO ${escapeHtml(bettor.name)}</h1>
            <p class="tagline">Previous selections are hidden. Tap ready when ${escapeHtml(bettor.name)} is holding the device.</p>
            <button class="btn primary" data-action="readyPlayer">I'M READY</button>
          </div>
        </section>`;
    }
    const maxBet = Math.min(E.BET_MAX, Math.floor(bettor.balance));
    const canBet = bettor.balance >= E.BET_MIN;
    const locked = state.currentBets.length;
    return `
      <section class="grid" style="margin-top:18px">
        <div class="statement-stage" style="min-height:220px">
          <div>
            <div class="eyebrow">Now Betting</div>
            <h2>${escapeHtml(bettor.name)}</h2>
            <p class="tagline">“${escapeHtml(current.text)}”</p>
            <span class="pill">Balance ${currency(bettor.balance)}</span>
            <span class="pill">${locked} / ${state.players.length} bets locked</span>
          </div>
        </div>
        ${canBet ? `
          <div class="panel">
            <h2>Who do you think chose this statement?</h2>
            <div class="player-grid">
              ${state.players.map((p) => `
                <button class="player-card ${state.selectedTargetId === p.id ? "selected" : ""}" data-action="selectTarget" data-player-id="${p.id}">
                  <strong>${escapeHtml(p.name)}</strong>
                  <p>${p.id === bettor.id ? "Self-bet: wins only if you are the only one." : `Bet that ${escapeHtml(p.name)} chose it.`}</p>
                </button>`).join("")}
            </div>
            <div class="grid two" style="margin-top:18px">
              <div>
                <h3>Bet Amount: ${currency(state.betAmount)}</h3>
                <div class="amount-grid">
                  ${[20,40,60,80,100].map((amount) => `<button class="btn ${Number(state.betAmount) === amount ? "primary" : ""}" data-action="setAmount" data-amount="${amount}" ${amount > maxBet ? "disabled" : ""}>${currency(amount)}</button>`).join("")}
                </div>
              </div>
              <div class="range-wrap">
                <label>Custom integer amount
                  <input id="betAmount" type="range" min="20" max="${maxBet}" step="1" value="${Math.min(state.betAmount, maxBet)}">
                </label>
                <input class="input" id="betAmountNumber" type="number" min="20" max="${maxBet}" step="1" value="${Math.min(state.betAmount, maxBet)}">
              </div>
            </div>
            <div class="actions" style="margin-top:18px">
              <button class="btn primary" data-action="lockBet">BET ${currency(Math.min(state.betAmount, maxBet))} ON ${escapeHtml(player(state.selectedTargetId)?.name || "TARGET")}</button>
            </div>
          </div>` : `
          <div class="panel"><h2>Insufficient balance</h2><p class="notice">${escapeHtml(bettor.name)} has less than ₹20 and cannot place a bet.</p><button class="btn primary" data-action="skipBrokePlayer">Lock ₹0 Skip</button></div>`}
      </section>`;
  }

  function resultsHtml(round) {
    const current = statement(round.statementId);
    const actual = round.actualPlayerNames.length ? round.actualPlayerNames.join(", ") : "Nobody chose this statement";
    return `
      <section class="grid" style="margin-top:18px">
        <div class="statement-stage" style="min-height:260px">
          <div>
            <div class="eyebrow">Statement #${escapeHtml(current.id)}</div>
            <blockquote>“${escapeHtml(current.text)}”</blockquote>
            <h2 style="margin-top:22px">Actual Scandal Holders</h2>
            <p class="tagline">${escapeHtml(actual)}</p>
          </div>
        </div>
        <div class="grid three">
          <div class="metric"><span>Total Losing Pool</span><strong>${currency(round.losingPool)}</strong></div>
          <div class="metric"><span>Winning Bettors</span><strong>${round.winningBettorCount}</strong></div>
          <div class="metric"><span>Payout Per Winner</span><strong>${currency(round.payoutPerWinner)}</strong></div>
        </div>
        ${round.winningBettorCount === 0 ? `<p class="notice">No winning bets this round. ${round.zeroWinnerPolicy === "carry" ? `The pool carries forward: ${currency(round.carryOut)}.` : "All losing bets were returned."}</p>` : ""}
        <div class="panel">
          <h2>Bet Tape</h2>
          ${betTable(round)}
        </div>
        <div class="panel">
          <h2>Updated Balances</h2>
          <div class="grid">${sortedPlayers(round.players).map(leaderRow).join("")}</div>
        </div>
        <div class="actions">
          <button class="btn primary" data-action="nextStatement">${remainingCount() ? "NEXT STATEMENT" : "MARKET CLOSE"}</button>
        </div>
      </section>`;
  }

  function betTable(round) {
    if (!round.bets.length) return `<p class="notice">No bets were placed.</p>`;
    return `
      <table class="table">
        <thead><tr><th>Bettor</th><th>Bet</th><th>Target</th><th>Type</th><th>Result</th><th>Payout</th></tr></thead>
        <tbody>${round.bets.map((bet) => `
          <tr>
            <td>${escapeHtml(player(bet.bettorId)?.name || "Unknown")}</td>
            <td>${currency(bet.amount)}</td>
            <td>${escapeHtml(player(bet.targetId)?.name || "Unknown")}</td>
            <td>${bet.isSelfBet ? "Self" : "Normal"}</td>
            <td class="${bet.won ? "success" : "danger"}"><strong>${bet.result}</strong></td>
            <td>${currency(bet.payout)}</td>
          </tr>`).join("")}</tbody>
      </table>`;
  }

  function leaderRow(p, index = 0) {
    const net = E.money(p.balance - state.startingBalance);
    const titles = getTitles(p, index);
    return `
      <div class="leader">
        <span class="rank">${index + 1}</span>
        <div><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${titles}</span></div>
        <strong class="${net >= 0 ? "success" : "danger"}">${currency(p.balance)}</strong>
      </div>`;
  }

  function getTitles(p, index) {
    if (index === 0) return "Market King";
    if ((p.stats?.winningBets || 0) >= (p.stats?.losingBets || 0) + 2) return "Oracle";
    if ((p.stats?.totalWagered || 0) >= 400) return "Risk Taker";
    if (p.balance < state.startingBalance) return "Market Crash Survivor";
    return "Professional Gambler";
  }

  function historyHtml() {
    return `
      <main class="screen">
        ${topbar("GAME HISTORY")}
        <div class="actions"><button class="btn primary" data-action="backToGame">Back To Game</button></div>
        <section class="history-list" style="margin-top:18px">
          ${state.history.map((round, i) => `
            <div class="panel">
              <h3>Round ${i + 1}: Statement #${escapeHtml(round.statementId)} ${round.skipped ? "(Skipped)" : ""}</h3>
              <p>${escapeHtml(statement(round.statementId)?.text || "")}</p>
              <p class="notice">Actual: ${escapeHtml(round.actualPlayerNames?.join(", ") || "Nobody")} · Pool: ${currency(round.losingPool || 0)} · Winners: ${round.winningBettorCount || 0}</p>
              ${betTable(round)}
            </div>`).join("") || `<p class="notice">No completed rounds yet.</p>`}
        </section>
      </main>`;
  }

  function finalHtml() {
    const leaders = sortedPlayers();
    const best = leaders[0];
    return `
      <main class="screen">
        <section class="statement-stage">
          <div>
            <div class="eyebrow">SCANDAL STOCK MARKET</div>
            <h1 class="shimmer">MARKET CLOSED 📈</h1>
            <p class="tagline">${best ? `${escapeHtml(best.name)} exits as ${getTitles(best, 0)}.` : "Final balances are ready."}</p>
          </div>
        </section>
        <div class="grid" style="margin-top:18px">${leaders.map(leaderRow).join("")}</div>
        <section class="panel" style="margin-top:18px">
          <h2>Game Summary</h2>
          <table class="table">
            <thead><tr><th>Player</th><th>Start</th><th>Final</th><th>Net</th><th>Wins</th><th>Losses</th><th>Wagered</th><th>Best</th><th>Worst</th></tr></thead>
            <tbody>${leaders.map((p) => {
              const net = E.money(p.balance - state.startingBalance);
              return `<tr><td>${escapeHtml(p.name)}</td><td>${currency(state.startingBalance)}</td><td>${currency(p.balance)}</td><td class="${net >= 0 ? "success" : "danger"}">${currency(net)}</td><td>${p.stats?.winningBets || 0}</td><td>${p.stats?.losingBets || 0}</td><td>${currency(p.stats?.totalWagered || 0)}</td><td>${currency(p.stats?.biggestWinningRound || 0)}</td><td>${currency(p.stats?.biggestLosingRound || 0)}</td></tr>`;
            }).join("")}</tbody>
          </table>
        </section>
        <div class="actions" style="margin-top:18px">
          <button class="btn primary" data-action="returnSetup">New Game</button>
          <button class="btn" data-action="restartGame">Restart Same Setup</button>
          <button class="btn" data-action="viewHistory">View Complete History</button>
        </div>
      </main>`;
  }

  function bind() {
    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => handle(button.dataset.action, button));
    });
    document.querySelectorAll(".statement-row").forEach((row) => {
      row.querySelector(".statement-input").addEventListener("input", (event) => {
        const item = statement(row.dataset.statementId);
        if (item) {
          item.text = event.target.value;
          state.sampleMode = false;
          saveState();
        }
      });
    });
    document.querySelectorAll(".player-row").forEach((row) => {
      const p = player(row.dataset.playerId);
      row.querySelector(".player-name").addEventListener("input", (event) => {
        p.name = event.target.value;
        saveState();
      });
      row.querySelectorAll(".player-choice").forEach((select) => {
        select.addEventListener("change", () => {
          const seen = new Set();
          p.chosenStatementIds = Array.from(row.querySelectorAll(".player-choice"))
            .map((field) => field.value)
            .filter((value) => {
              if (!value || seen.has(value)) return false;
              seen.add(value);
              return true;
            })
            .slice(0, 3);
          p.chosenStatementId = p.chosenStatementIds[0] || "";
          saveState();
          render();
        });
      });
    });
    if (byId("startingBalance")) byId("startingBalance").addEventListener("input", (e) => {
      state.startingBalance = Math.max(100, Number(e.target.value) || 1000);
      saveState();
    });
    if (byId("zeroWinnerPolicy")) byId("zeroWinnerPolicy").addEventListener("change", (e) => {
      state.zeroWinnerPolicy = e.target.value;
      saveState();
    });
    ["betAmount", "betAmountNumber"].forEach((id) => {
      if (byId(id)) byId(id).addEventListener("input", (e) => {
        state.betAmount = Math.round(Number(e.target.value));
        saveState();
        render();
      });
    });
  }

  function handle(action, el) {
    const actions = {
      newSetup: () => {
        Object.assign(state, freshState(), { screen: "setup" });
        saveState();
        render();
      },
      resume: () => setState({ screen: state.screen === "landing" ? "setup" : state.screen }),
      saveGame: () => toast("Game saved locally."),
      addStatement: () => {
        state.statements.push({ id: E.createId("statement"), label: "", text: "" });
        state.sampleMode = false;
        saveState();
        render();
      },
      deleteStatement: () => {
        state.statements.splice(Number(el.dataset.index), 1);
        saveState();
        render();
      },
      moveStatementUp: () => moveStatement(Number(el.dataset.index), -1),
      moveStatementDown: () => moveStatement(Number(el.dataset.index), 1),
      previewPaste: () => previewPaste(),
      applyPaste: () => applyPaste(),
      addPlayer: () => {
        const first = state.statements.find((s) => s.text.trim());
        state.players.push({
          id: E.createId("player"),
          name: `Player ${state.players.length + 1}`,
          chosenStatementId: first?.id || "",
          chosenStatementIds: first?.id ? [first.id] : [],
          balance: state.startingBalance,
          stats: E.defaultStats(),
        });
        saveState();
        render();
      },
      deletePlayer: () => {
        state.players.splice(Number(el.dataset.index), 1);
        saveState();
        render();
      },
      startGame,
      beginBetting,
      readyPlayer: () => setState({ activeReady: true }),
      selectTarget: () => setState({ selectedTargetId: el.dataset.playerId }),
      setAmount: () => setState({ betAmount: Number(el.dataset.amount) }),
      lockBet,
      skipBrokePlayer: () => {
        const next = state.bettorIndex + 1;
        if (next >= state.players.length) resolveCurrentRound();
        else setState({ bettorIndex: next, activeReady: false });
      },
      nextStatement: advanceStatement,
      toggleMenu: () => { menuOpen = !menuOpen; render(); },
      togglePause: () => setState({ paused: !state.paused }),
      restartRound: restartCurrentRound,
      skipStatement,
      undoBet: undoLastBet,
      viewHistory: () => setState({ screen: "history" }),
      backToGame: () => setState({ screen: state.phase === "final" ? "final" : "game" }),
      restartGame: () => {
        state.players = state.players.map((p) => ({ ...p, chosenStatementIds: playerChoiceIds(p), balance: state.startingBalance, stats: E.defaultStats() }));
        Object.assign(state, {
          screen: "game",
          phase: "reveal",
          order: E.shuffleIds(playableStatements().map((s) => s.id)),
          currentStatementId: null,
          history: [],
          currentBets: [],
          carryPool: 0,
          bettorIndex: 0,
          activeReady: false,
        });
        state.currentStatementId = state.order[0] || null;
        saveState();
        render();
      },
      returnSetup: () => setState({ screen: "setup", phase: "setup", currentStatementId: null, currentBets: [], history: [], carryPool: 0 }),
    };
    if (actions[action]) actions[action]();
  }

  function moveStatement(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= state.statements.length) return;
    [state.statements[index], state.statements[target]] = [state.statements[target], state.statements[index]];
    saveState();
    render();
  }

  function previewPaste() {
    const parsed = E.parseStatements(byId("pasteStatements").value);
    const box = byId("pastePreview");
    box.classList.remove("hide");
    box.innerHTML = parsed.length
      ? `<strong>${parsed.length} statements detected.</strong><br>${parsed.slice(0, 5).map(escapeHtml).join("<br>")}${parsed.length > 5 ? "<br>..." : ""}`
      : "No statements detected yet.";
  }

  function applyPaste() {
    const parsed = E.parseStatements(byId("pasteStatements").value);
    if (!parsed.length) return toast("Paste at least one statement first.");
    state.statements = parsed.map((text, index) => ({ id: String(index + 1), label: "", text }));
    state.players = state.players.map((p) => ({ ...p, chosenStatementId: state.statements[0]?.id || "", chosenStatementIds: state.statements[0]?.id ? [state.statements[0].id] : [] }));
    state.sampleMode = false;
    saveState();
    render();
  }

  render();
})();
