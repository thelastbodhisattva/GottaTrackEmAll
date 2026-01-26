# Polymarket Whale & Insider Tracker

Real-time monitoring for Polymarket. Catches whale trades, scores them for insider-like behavior, and sends Discord alerts when something looks suspicious. The scoring algorithm has 11 factors now. It's not perfect, but hey at least it's working as intended.

## What it does

- **Watches the WebSocket feed** from Polymarket's CLOB and filters for trades above a threshold (default $15k)
- **Scores each trade** using wallet age, trade timing, position sizing, cluster behavior, order flow patterns, and cross-market correlation
- **Alerts to Discord** when scores exceed your threshold, with links to the market, trader profile, and Polygonscan
- **Tracks resolved outcomes** so you can see which flagged traders were actually right

The frontend has three tabs: a live trade feed (the "Whale Tape"), a leaderboard showing wallet performance after markets resolve, and watchlist management for tracking specific addresses.

## The 11-factor scoring algorithm

Each factor adds points. Total max is 255, normalized to 0-100 for display.

| Factor | Max pts | What it checks |
|--------|---------|----------------|
| Wallet Age | 25 | Newer wallets score higher |
| Trade Size | 25 | Larger positions relative to wallet history |
| Timing | 25 | Trades near market creation or big news |
| Diversification | 25 | Concentrated bets on few markets |
| On-chain Source | 20 | Funded from CEX vs. contract vs. unknown |
| Specificity | 20 | Obscure markets vs. popular ones |
| Impact | 20 | Did the trade move the price? |
| Connections | 30 | Win rate from historical trades |
| Order Flow | 20 | Unusual patterns like whale exits |
| Cluster | 30 | Multiple wallets trading in sync |
| Correlated Bets | 15 | Consistent positions across related markets |

The last one is new in v2.1. If someone bets YES on "Trump wins" and NO on "Biden wins", that's logically consistent and gets points. If they bet YES on both in the same race, that's hedging, fewer points.

## Stack

**Backend**: Node.js, TypeScript, Express, MongoDB, Redis, WebSocket  
**Frontend**: React (Vite), TypeScript  
**Infra**: Docker Compose for the full stack

## Getting started

### Docker (recommended)

```bash
git clone <repo-url>
cd GottaTrackEmAll

# Copy env template and fill in your keys
cp backend/.env.example backend/.env

# Fire it up
docker-compose up -d --build
```

Frontend at http://localhost:3000, API at http://localhost:3001.

### Local dev

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

You'll need MongoDB and Redis running locally, or point to remote instances via env vars.

## Environment variables

| Variable | What | Default |
|----------|------|---------|
| `PORT` | Backend port | 3001 |
| `MONGODB_URI` | Mongo connection string | mongodb://localhost:27017/whale-tracker |
| `REDIS_URL` | Redis connection string | redis://localhost:6379 |
| `WHALE_THRESHOLD_USD` | Min trade size to track | 15000 |
| `INSIDER_SCORE_THRESHOLD` | Score threshold for alerts | 65 |
| `ALCHEMY_API_KEY` | For wallet resolution | Required |
| `POLYGONSCAN_API_KEY` | Wallet age lookups | Optional |
| `DISCORD_WEBHOOK_URL` | Alert destination | Optional |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (get from @BotFather) | Optional |
| `TELEGRAM_CHAT_ID` | Telegram chat/group ID | Optional |

## Latest Updates (v2.2.2)

- **Smart Profile Resolution**: Automatically detects if a wallet is a Proxy, Kernel, or EOA and links to the one that actually has the trade history. No more 404s.
- **Enhanced Telegram Alerts**: Alerts now give you direct links to both the Polymarket profile and the on-chain EOA for deep diving.
- **Reliability Fixes**: Solved race conditions in wallet tracking and duplicate trade alerts.
- **Scorer Health**: New endpoint to check if your API keys are alive.

## From v2.1

- **Watchlists**: Create lists of wallets to track with custom alert thresholds
- **Leaderboard**: See which wallets are profitable after markets resolve
- **Correlation detection**: Score boost for wallets with logically consistent positions across related markets
- **WebSocket admin panel**: Monitor connection health and manually refresh subscriptions
- **Tabbed dashboard**: Switch between Whale Tape, Leaderboard, and Watchlists

## API endpoints

### Core
- `GET /api/trades` - Recent trades with filtering
- `GET /api/wallets/:address` - Wallet profile and history
- `GET /api/markets/:id` - Market details

### Watchlists
- `GET /api/watchlists` - List all watchlists
- `POST /api/watchlists` - Create new watchlist
- `PUT /api/watchlists/:id` - Update watchlist
- `DELETE /api/watchlists/:id` - Delete watchlist

### Leaderboard
- `GET /api/metrics/leaderboard` - Top wallets by ROI
- `GET /api/metrics/leaderboard/:wallet` - Stats for specific wallet

### Admin
- `GET /api/admin/stats` - System stats
- `GET /api/admin/subscriptions/health` - WebSocket connection status
- `POST /api/admin/subscriptions/refresh` - Force reconnect

## License

MIT
