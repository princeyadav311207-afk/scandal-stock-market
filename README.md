# SCANDAL STOCK MARKET

Think you know everyone's scandals? Put your money where your prediction is.

SCANDAL STOCK MARKET is a static, local-browser party game web app. It runs with no backend, database, login, or external API. Game progress is saved in the browser's `localStorage` on the device that opens it.

You can host these files on any static website host to get a normal clickable URL. The hosted site only delivers the app files; game data does not sync to a server or between devices.

## Run Locally

Open `index.html` in a modern browser.

For the smoothest local experience, you can also serve the folder:

```powershell
cd outputs/scandal-stock-market
node local-server.js 5173
```

Then open:

```text
http://localhost:5173
```

To open the game on a phone or tablet, keep the laptop and phone on the same Wi-Fi, run the same command, and use the `Phone/tablet URL` printed in the terminal. It will look like:

```text
http://192.168.x.x:5173
```

This is still backend-free. The laptop only serves the app files. Each browser/device keeps its own saved game in that device's local storage.

## Public Phone URL

To use the game on a trip without your laptop, upload this folder to any static website host, for example Cloudflare Pages, GitHub Pages, Netlify, Vercel, or any ordinary web hosting.

Use this folder as the site root:

```text
outputs/scandal-stock-market
```

There is no build command.

The publish directory is:

```text
.
```

After publishing, you will get a URL like:

```text
https://your-game-name.pages.dev
```

Open that URL on any phone, tablet, or computer. Each device stores its own game locally in that browser. Opening the same URL on another device starts with that device's own local save, not someone else's.

The app also includes a service worker and web app manifest. After the first successful load from an HTTPS URL, the browser can cache the game files for offline use.

## Install

No install is required for normal use.

The app is plain HTML, CSS, and JavaScript so it can be copied to a laptop and used offline.

## Production Build

No build step is required. The production app is the contents of this folder:

```text
index.html
styles.css
app.js
engine.js
local-server.js
manifest.json
sw.js
icon.svg
```

## Game Rules

Each player starts with a configurable balance, defaulting to `₹1000`.

During setup, the host enters statements and assigns each player one to three statements they originally chose or agreed with. When the game starts, the app generates a random statement order from only the statements chosen by at least one player, then reveals one statement per round.

For each revealed statement, players bet `₹20` to `₹100` on the person they think chose it. Bets are deducted when resolved. Losing bets form the losing pool. All winning bettors split that losing pool equally.

Self-bets use the special rule:

```text
A self-bet wins only when exactly one player chose the revealed statement,
and that one player is the bettor.
```

If multiple players chose the statement, every self-bet by those players loses. Normal bets on any player who chose the statement still win.

The app does not normally reveal unchosen statements. The engine still handles the nobody-chose edge case for imported saves or manual testing, and the host can choose whether that losing pool carries forward to the next round or losing bets are returned.

## Game Logic

The central game engine is in:

```text
engine.js
```

The main round resolver is:

```js
resolveRound(statementId, bets, players, options)
```

It finds actual statement choosers, identifies self-bets, resolves wins and losses, calculates the losing pool, splits payouts, updates balances, and returns a full round result for the UI.

## Tests

Run the rule tests with Node:

```powershell
cd outputs/scandal-stock-market
node --test tests/engine.test.js
```

The tests cover one correct person, multiple correct people, nobody correct, one-to-three player statement choices, self-bets, normal bets, multiple winners, unequal losing amounts, no-winner policy, and insufficient balance.

## Persistence

The app saves state under:

```text
scandal-stock-market:v1
```

Use the in-app host controls to restart, return to setup, skip a statement, undo the last bet, or view game history.
