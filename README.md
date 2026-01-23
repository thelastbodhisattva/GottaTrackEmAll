# Polymarket Whale & Insider Tracker 🐋🕵️‍♂️

A powerful, real-time analytics platform designed to monitor **Polymarket** for high-value trades ("whales") and detect potential insider activity using advanced scoring algorithms. This project combines a high-performance backend ingestion engine with a reactive frontend dashboard.

## 🚀 Key Features

*   **Real-time Whale Monitoring**: Subscribes to Polymarket's CLOB (Central Limit Order Book) WebSocket to detect trades exceeding configurable USD thresholds instantly.
*   **Insider Trading Detection**: utilizing a sophisticated scoring engine that analyzes:
    *   **Timing Factors**: Trades made shortly before market resolution or major news events.
    *   **Trade Patterns**: Behavioral analysis of wallet history and position sizing.
    *   **Wallet Profiling**: Integration with on-chain data (Polygonscan, Alchemy) to enrich wallet identities.
*   **Interactive Admin Dashboard**: A React-based frontend visualization to monitor live events, review flagged trades, and analyze historical data.
*   **Discord Alerts**: Configurable webhook integration to push real-time notifications to your community or trading group.
*   **Robust Data Pipeline**: Built with MongoDB for persistent storage and Redis for high-speed caching and queue management.

## 🛠️ Technology Stack

### Backend
*   **Runtime**: Node.js (v18+) & TypeScript
*   **Framework**: Express.js
*   **Database**: MongoDB (via Mongoose)
*   **Caching**: Redis (via ioredis)
*   **Communication**: WebSocket (`ws`) for real-time market data
*   **Alerting**: Discord.js / Webhooks
*   **Blockchain**: Ethers.js for EVM interactions

### Frontend
*   **Framework**: React (Vite)
*   **Visualization**: Chart.js / react-chartjs-2
*   **Language**: TypeScript

### DevOps & Infrastructure
*   **Containerization**: Docker & Docker Compose
*   **Testing**: Vitest & Jest
*   **Linting**: ESLint

## 📋 Prerequisites

*   [Docker](https://www.docker.com/products/docker-desktop) & Docker Compose (Recommended)
*   [Node.js](https://nodejs.org/) v18+ (If running locally without Docker)
*   Polymarket API Access (Public WebSocket)
*   Alchemy / Polygonscan API Keys (Recommended for full wallet resolution)

## ⚡ Quick Start (Docker)

The easiest way to get the entire stack (Database, Cache, Backend, Frontend) running is using Docker Compose.

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd GottaTrackEmAll
    ```

2.  **Configure Environment Variables**
    Create a `.env` file in the `backend` directory (or use the environment variables in `docker-compose.yml`):
    ```bash
    cp backend/.env.example backend/.env # If example exists, otherwise create new
    ```
    *See the [Configuration](#-configuration) section below for details.*

3.  **Start Services**
    ```bash
    docker-compose up -d --build
    ```

4.  **Access the Application**
    *   **Frontend**: [http://localhost:3000](http://localhost:3000)
    *   **Backend API**: [http://localhost:3001](http://localhost:3001)
    *   **Redis**: [localhost:6379](localhost:6379)
    *   **MongoDB**: [localhost:27017](localhost:27017)

## 🔧 Configuration

Configure the application by setting the following environment variables. These can be set in `docker-compose.yml` or a `.env` file.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend API Port | `3001` |
| `MONGODB_URI` | MongoDB Connection String | `mongodb://localhost:27017/whale-tracker` |
| `REDIS_URL` | Redis Connection String | `redis://localhost:6379` |
| `POLYMARKET_WS_URL` | Polymarket WebSocket Endpoint | `wss://ws-subscriptions-clob.polymarket.com/ws/market` |
| `WHALE_THRESHOLD_USD` | Minimum trade size ($) to flag as a whale | `1000` |
| `INSIDER_SCORE_THRESHOLD` | Scoring threshold (0-100) to flag as insider | `65` |
| `ALCHEMY_API_KEY` | API Key for Alchemy (Polygon RPC) | *Required for wallet resolution* |
| `POLYGONSCAN_API_KEY` | API Key for Polygonscan | *Optional* |
| `DISCORD_WEBHOOK_URL` | Webhook URL for Discord alerts | *Optional* |
| `LOG_VERBOSE` | Enable verbose logging | `false` |

## 💻 Local Development

If you prefer to run services individually:

### Backend

1.  Navigate to `backend`:
    ```bash
    cd backend
    npm install
    ```
2.  Start dependencies (Mongo/Redis) locally or via Docker.
3.  Run in development mode:
    ```bash
    npm run dev
    ```

### Frontend

1.  Navigate to `frontend`:
    ```bash
    cd frontend
    npm install
    ```
2.  Run the development server:
    ```bash
    npm run dev
    ```

## 🧪 Testing

Run strict unit and integration tests to ensure system reliability.

```bash
# Backend Tests
cd backend
npm run test
```

## 📄 License

This project is licensed under the MIT License.
