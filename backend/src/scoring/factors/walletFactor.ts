/**
 * Wallet Age Scoring Factor (25 pts max)
 * Fresh wallets are strong insider indicators
 */
import { Trade } from '../../types/index.js';

/**
 * Score wallet age based on first transaction time
 * Sub-factors:
 * - Base age score (15 pts max): How old is the wallet
 * - wc/tx score (10 pts max): Time from wallet creation to THIS trade (ghost insider detection)
 */
export function scoreWalletAge(trade: Trade, firstTxTime: number | null): number {
    if (firstTxTime === null) {
        return 0; // Can't determine age, no score
    }

    const walletCreatedAt = firstTxTime;
    const ageDays = (Date.now() - walletCreatedAt) / (1000 * 60 * 60 * 24);

    // Base age score (15 pts max)
    let baseScore = 0;
    if (ageDays < 1) baseScore = 15;       // Fresh wallet (<1 day)
    else if (ageDays < 3) baseScore = 10;  // Recent wallet (1-3 days)
    else if (ageDays < 7) baseScore = 5;   // Week old
    // else 0 for established wallets

    // wc/tx sub-factor (10 pts max): Time from wallet creation to THIS trade
    // Ghost insiders act very quickly after creating proxies
    let wcTxScore = 0;
    const hoursFromCreationToTrade = (trade.timestamp.getTime() - walletCreatedAt) / (1000 * 60 * 60);

    if (hoursFromCreationToTrade >= 0 && hoursFromCreationToTrade < 1) {
        wcTxScore = 10;  // Trade within 1 hour of wallet creation - highly suspicious
        console.log(`[WalletFactor] Ghost insider pattern: trade ${hoursFromCreationToTrade.toFixed(1)}h after wallet creation (+10)`);
    } else if (hoursFromCreationToTrade >= 1 && hoursFromCreationToTrade < 5) {
        wcTxScore = 5;   // Trade within 1-5 hours
        console.log(`[WalletFactor] Fast action: trade ${hoursFromCreationToTrade.toFixed(1)}h after wallet creation (+5)`);
    }

    return Math.min(25, baseScore + wcTxScore);
}
