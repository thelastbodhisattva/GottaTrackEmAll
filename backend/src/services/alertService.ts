import { WebhookClient } from 'discord.js';
import { config } from '../config/index.js';
import { EnrichedTrade, AlertConfig } from '../types/index.js';
import { HansonQuotes } from '../utils/hansonQuotes.js';

/**
 * Discord webhook alert service for whale and insider notifications
 */
export class AlertService {
    private discord: WebhookClient | null = null;
    private readonly config: AlertConfig;

    constructor(alertConfig?: Partial<AlertConfig>) {
        this.config = {
            discordWebhook: alertConfig?.discordWebhook || config.discordWebhookUrl,
            minScoreThreshold: alertConfig?.minScoreThreshold || config.insiderScoreThreshold,
            enabledCategories: alertConfig?.enabledCategories || [...config.targetCategories],
            showEthicsNotes: alertConfig?.showEthicsNotes ?? true,
        };

        if (this.config.discordWebhook) {
            this.discord = new WebhookClient({ url: this.config.discordWebhook });
        }
    }

    /**
     * Send whale trade alert
     */
    async sendWhaleAlert(trade: EnrichedTrade, showEthics?: boolean): Promise<void> {
        if (!this.discord) {
            console.warn('[AlertService] Discord webhook not configured');
            return;
        }

        const useEthics = showEthics ?? this.config.showEthicsNotes;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const embed = this.createTradeEmbed(trade, useEthics);
                await this.discord.send({
                    username: "Pencepu Handal",
                    avatarURL: 'https://64.media.tumblr.com/b1afdfa8b39af8e3d1206a299b00b063/02bbd9820e5a450a-eb/s1280x1920/fa8aa9a12285892788bd7cc12d691240e2bce6a2.png',
                    embeds: [embed]
                });
                console.log(`[AlertService] Sent alert for trade ${trade.id}`);
                return; // Success, exit retry loop
            } catch (error: unknown) {
                const err = error as any;
                const isTransient = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT';
                if (isTransient && attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1); // Exponential backoff
                    console.warn(`[AlertService] Discord send failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('[AlertService] Failed to send Discord alert:', err);
                    return; // Give up after max retries or non-transient error
                }
            }
        }
    }

    /**
     * Send a test message on startup (with retry for transient errors)
     */
    async sendTestMessage(): Promise<void> {
        if (!this.discord) {
            console.log('[AlertService] Discord not configured, skipping test message');
            return;
        }

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.discord.send({
                    username: "Pencepu Handal",
                    avatarURL: 'https://64.media.tumblr.com/b1afdfa8b39af8e3d1206a299b00b063/02bbd9820e5a450a-eb/s1280x1920/fa8aa9a12285892788bd7cc12d691240e2bce6a2.png',
                    content: '😜 **Disaat Anda Diam-diam Open Order Disitulah Anda Kami Pantau**'
                });
                console.log('[AlertService] ✅ Sent test message to Discord');
                return; // Success
            } catch (error: unknown) {
                const err = error as any;
                const isTransient = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 500;
                if (isTransient && attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s
                    console.warn(`[AlertService] Discord test message failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('[AlertService] ❌ Failed to send test message:', err?.message || err);
                    return; // Give up
                }
            }
        }
    }

    /**
     * Send batch of alerts
     */
    async sendBatchAlerts(trades: EnrichedTrade[], showEthics?: boolean): Promise<void> {
        for (const trade of trades) {
            await this.sendWhaleAlert(trade, showEthics);
            // Rate limiting: wait between messages
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Create Discord embed for trade alert
     */
    private createTradeEmbed(trade: EnrichedTrade, showEthics: boolean): any {
        const isFlagged = trade.isFlagged;
        const emoji = isFlagged ? '🚨' : '😂';
        const color = isFlagged ? 0xFF4444 : 0x3498DB;

        const fields: Array<{ name: string; value: string; inline?: boolean }> = [
            {
                name: '💰 Trade Size',
                value: `$${trade.sizeUsd.toLocaleString()}`,
                inline: true,
            },
            {
                name: '🎯 Position',
                value: `${trade.side} @ ${(trade.price * 100).toFixed(1)}%`,
                inline: true,
            },
            {
                name: '📊 Market',
                value: trade.marketTitle || trade.marketId,
                inline: false,
            },
            {
                name: '👛 Wallet',
                value: `\`${trade.walletAddress || 'Unknown'}\``,
                inline: false,
            },
            {
                name: '🔗 Profile',
                value: (trade.proxyWalletAddress || trade.walletAddress) && trade.walletAddress !== 'Unknown'
                    ? `[View on Polymarket](https://polymarket.com/profile/${trade.proxyWalletAddress || trade.walletAddress})`
                    : 'N/A',
                inline: true,
            },
            {
                name: '🏷️ Category',
                value: trade.marketCategory.toUpperCase(),
                inline: true,
            },
            {
                name: '🏦 Funding Source',
                value: trade.fundingSource
                    ? `${this.getFundingSourceEmoji(trade.fundingSource.type)} **${trade.fundingSource.label}**`
                    : '❓ Unknown',
                inline: true,
            }
        ];

        // Add insider score breakdown if flagged
        if (isFlagged) {
            const breakdown = trade.insiderScore.breakdown;
            const scoreBar = this.createScoreBar(breakdown.total);

            fields.push({
                name: `🔍 Insider Score: ${breakdown.total}/100 ${scoreBar}`,
                value: [
                    `├ Wallet Age: \`${breakdown.walletAge}/25\``,
                    `├ Trade Size: \`${breakdown.tradeSize}/20\``,
                    `├ Timing: \`${breakdown.timing}/30\``,
                    `├ Diversification: \`${breakdown.diversification}/15\``,
                    `├ On-Chain: \`${breakdown.onChainSource}/15\``,
                    `├ Specificity: \`${breakdown.specificity}/10\``,
                    `├ Impact: \`${breakdown.impact}/10\``,
                    `└ Connections: \`${breakdown.connections}/5\``,
                ].join('\n'),
                inline: false,
            });

            fields.push({
                name: '⚠️ Confidence',
                value: trade.insiderScore.confidence.toUpperCase(),
                inline: true,
            });
        }

        // Add wallet stats
        const profile = trade.walletProfile;
        fields.push({
            name: '📈 Wallet Stats',
            value: [
                `Trades: ${profile.totalTrades}`,
                `PNL: $${profile.totalPnl.toFixed(2)}`,
                `Win Rate: ${(profile.winRate * 100).toFixed(1)}%`,
            ].join(' | '),
            inline: false,
        });

        // Add ethics note if enabled
        if (showEthics && isFlagged) {
            const quote = HansonQuotes.getRandomFull();
            fields.push({
                name: '💡 Market Efficiency Note',
                value: `*"${quote.text}"*\n— Robin Hanson, ${quote.source} (${quote.year})`,
                inline: false,
            });
        }

        // Add TX hash as a field (not just footer) with Polygonscan link
        const txHash = trade.transactionHash;
        fields.push({
            name: '🔗 Transaction',
            value: txHash
                ? `[${txHash.slice(0, 12)}...${txHash.slice(-6)}](https://polygonscan.com/tx/${txHash})`
                : 'N/A',
            inline: false,
        });

        // Build embed object
        return {
            title: `${emoji} ${isFlagged ? 'INSIDER SIGNAL' : 'YAHAHA KENA CEPU'}`,
            color,
            timestamp: trade.timestamp?.toISOString() || new Date().toISOString(),
            fields,
            footer: {
                text: `Today at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
            },
        };
    }

    /**
     * Create visual score bar
     */
    private createScoreBar(score: number): string {
        const filled = Math.round(score / 10);
        const empty = 10 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    /**
     * Get emoji for funding source type
     */
    private getFundingSourceEmoji(type: string): string {
        switch (type) {
            case 'exchange': return '🏦';  // CEX like Binance, Coinbase
            case 'bridge': return '🌉';    // Cross-chain bridge
            case 'contract': return '📜';  // Smart contract
            default: return '❓';         // Unknown
        }
    }

    /**
     * Format plain text alert (for fallback)
     */
    formatPlainTextAlert(trade: EnrichedTrade, showEthics: boolean): string {
        const emoji = trade.isFlagged ? '🚨' : '😂';
        const header = trade.isFlagged ? 'INSIDER SIGNAL DETECTED' : 'YAHAHA KENA CEPU';

        let msg = `${emoji} **${header}**\n\n`;
        msg += `💰 Size: $${trade.sizeUsd.toLocaleString()}\n`;
        msg += `📊 Market: ${trade.marketTitle}\n`;
        msg += `🎯 Position: ${trade.side} @ ${(trade.price * 100).toFixed(1)}%\n`;
        msg += `👛 Wallet: ${trade.walletAddress?.slice(0, 8) || 'Unknown'}...${trade.walletAddress?.slice(-6) || ''}\n`;

        if (trade.isFlagged) {
            const b = trade.insiderScore.breakdown;
            msg += `\n🔍 **INSIDER SCORE: ${b.total}/100**\n`;
            msg += `├ Wallet Age: ${b.walletAge}/25\n`;
            msg += `├ Trade Size: ${b.tradeSize}/20\n`;
            msg += `├ Timing: ${b.timing}/30\n`;
            msg += `├ Impact: ${b.impact}/10\n`;
            msg += `└ Confidence: ${trade.insiderScore.confidence.toUpperCase()}\n`;
        }

        if (showEthics && trade.isFlagged) {
            msg += `\n💡 *${HansonQuotes.getRandom()}*`;
        }

        return msg;
    }

    /**
     * Check if alert should be sent based on configuration
     */
    shouldAlert(trade: EnrichedTrade): boolean {
        // Check if Discord is configured
        if (!this.discord) return false;

        // Check category filter
        if (!this.config.enabledCategories.includes(trade.marketCategory)) {
            return false;
        }

        // All whale trades are alerted, with extra emphasis on flagged ones
        return true;
    }

    /**
     * Get alert configuration
     */
    getConfig(): AlertConfig {
        return { ...this.config };
    }

    /**
     * Check if service is properly configured
     */
    isConfigured(): boolean {
        return this.discord !== null;
    }
}
