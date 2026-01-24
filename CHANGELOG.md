# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [2.1.0] - 2026-01-24

Big one. Cross-market correlation detection, whale watchlists, and a PnL leaderboard. The scoring algorithm went from 10 factors to 11, now maxing at 255 points.

### Added

- **Cross-market correlation detection**: The new `CorrelationDetector` finds wallets betting on logically related markets. If someone bets YES on "Trump wins" and NO on "Biden wins", that's consistent. If they bet YES on both, something's weird. Adds up to 15 points to the insider score.
- **Whale watchlists**: Track specific wallets and get custom Discord alerts when they trade. Each watchlist has its own thresholds and category filters. CRUD API at `/api/watchlists`.
- **PnL leaderboard**: See which wallets are actually profitable. Pulls from resolved trades, calculates win rate, ROI, and total PnL. Top 3 get medals in the UI.
- **WebSocket admin panel**: New section in the admin dashboard showing connection health, subscribed markets, and a "refresh subscriptions" button. Uptime counter included.
- **Tabbed navigation**: Main dashboard now has three tabs - Whale Tape (the original feed), Leaderboard, and Watchlists. Filters only show when you're on the Whale Tape tab.
- **Correlation badge on trade cards**: When a trade has a non-zero correlatedBets score, it shows a purple "Linked" badge next to the score donut. Hover for tooltip.

### Changed

- **Max raw score**: Bumped from 240 to 255 (added 15 for correlatedBets factor).
- **InsiderScorer constructor**: Now takes `CorrelationDetector` as a dependency. Had to reorder service instantiation in app.ts so MarketService gets created first.
- **Frontend ScoreBreakdown**: Added `correlatedBets` field to match backend. ScoreDonut and WhaleTape both updated.
- **AdminDashboard FACTOR_LABELS**: Added velocity, proximity, and correlatedBets so the factor breakdown table shows all 11 factors.

### Fixed

- Nothing broken this time. (Knocking on wood.)

## [2.0.1] - 2026-01-24

Cleanup release. Mostly velocity/proximity polish and some Discord link fixes.

### Added

- **Velocity detection**: Tracks how fast a wallet is trading. Multiple trades in a short window now boost the insider score. Uses Redis sorted sets under the hood.
- **Event proximity scoring**: Trades placed close to market resolution get flagged harder. Last-minute bets are often the most informed.
- **Theme toggle**: Dark/light mode switch in the frontend header with system preference detection.
- **New market categories**: Sports, esports, pop culture, entertainment, and science now show in the filters dropdown.
- **Backfill endpoint**: `POST /api/metrics/backfill` retroactively resolves markets that were stuck as "undefined". First run fixed 9 out of 16 markets.
- **Subscription cleanup**: WebSocket now unsubscribes from closed markets every 30 minutes instead of tracking them forever. Saves bandwidth.
- **Market URLs in Discord**: Alerts now link directly to the market page (using event/market slug) plus Polygonscan for the actual EOA.

### Changed

- **Typography overhaul**: Swapped generic fonts for Space Grotesk (headings), IBM Plex Sans (body), and JetBrains Mono (data).
- **Max raw score**: Increased from 210 to 240 to account for velocity (15pts) and proximity (15pts).
- **StatsGrid animations**: Cards now fade in with staggered timing using framer-motion.
- **Redis velocity tracking**: Now respects `VELOCITY_WINDOW_SEC` from config instead of hardcoding 60 seconds.

### Fixed

- **ScoreDonut missing factors**: Added velocity and proximity colors/labels so the UI displays all scoring factors.
- **Frontend type sync**: `ScoreBreakdown` now includes velocity and proximity in both backend and frontend.
- **Market resolution parsing**: OutcomeTracker now reads `umaResolutionStatus` and `outcomePrices` from Gamma API instead of looking for non-existent fields.
- **Discord profile links**: Previously only showed trader's profile. Now shows market link, Polymarket profile, and Polygonscan link.
- **WebSocket race condition**: Added `isRefreshing` guard to prevent concurrent subscription refreshes from causing disconnection chaos.

## [2.0.0] - 2026-01-24

Initial tracked release with 10-factor insider scoring algorithm.

