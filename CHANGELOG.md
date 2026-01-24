# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Velocity detection**: Tracks how fast a wallet is trading. Multiple trades in a short window now boost the insider score. Uses Redis sorted sets under the hood.
- **Event proximity scoring**: Trades placed close to market resolution get flagged harder. Last-minute bets are often the most informed.
- **Theme toggle**: Dark/light mode switch in the frontend header with system preference detection.
- **New market categories**: Sports, esports, pop culture, entertainment, and science now show in the filters dropdown.
- **Backfill endpoint**: `POST /api/metrics/backfill` retroactively resolves markets that were stuck as "undefined". First run fixed 9 out of 16 markets.
- **Subscription cleanup**: WebSocket now unsubscribes from closed markets every 30 minutes instead of tracking them forever. Saves bandwidth and keeps things lean.
- **Market URLs in Discord**: Alerts now link directly to the market page (using event/market slug) plus Polygonscan for the actual EOA.

### Changed

- **Typography overhaul**: Swapped generic fonts for Space Grotesk (headings), IBM Plex Sans (body), and JetBrains Mono (data).
- **Max raw score**: Increased from 210 to 240 to account for velocity (15pts) and proximity (15pts).
- **StatsGrid animations**: Cards now fade in with staggered timing using framer-motion.
- **Redis velocity tracking**: Now respects `VELOCITY_WINDOW_SEC` from config instead of hardcoding 60 seconds.

### Fixed

- **ScoreDonut missing factors**: Added velocity and proximity colors/labels so the UI displays all scoring factors.
- **Frontend type sync**: `ScoreBreakdown` now includes velocity and proximity in both backend and frontend.
- **Market resolution parsing**: OutcomeTracker now reads `umaResolutionStatus` and `outcomePrices` from Gamma API instead of looking for non-existent fields. Handles all market types: Yes/No, Over/Under, team names, player names.
- **Discord profile links**: Previously only showed trader's profile. Now shows market link, Polymarket profile, and Polygonscan link.
- **WebSocket race condition**: Added `isRefreshing` guard to prevent concurrent subscription refreshes from causing disconnection chaos.

## [2.0.0] - 2026-01-24

Initial tracked release with 10-factor insider scoring algorithm.
