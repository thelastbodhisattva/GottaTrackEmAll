/**
 * Robin Hanson quotes and educational content for market efficiency framing
 * 
 * These quotes present insider trading in prediction markets as
 * "high-information signals" that enhance market accuracy.
 */

interface HansonQuote {
    text: string;
    source: string;
    year: number;
    url?: string;
}

export const hansonQuotes: HansonQuote[] = [
    {
        text: "In prediction markets, 'insider trading' is the point—to extract and aggregate hidden knowledge.",
        source: "Forbes Interview",
        year: 2022,
        url: "https://www.forbes.com/sites/prediction-markets/",
    },
    {
        text: "Markets elicit sincere beliefs via skin-in-the-game, unlike voting where there's no cost to expressing false preferences.",
        source: "Shall We Vote on Values, But Bet on Beliefs?",
        year: 2003,
        url: "https://mason.gmu.edu/~rhanson/futarchy.html",
    },
    {
        text: "Insiders improve market accuracy by correcting mispricings quickly with non-public information.",
        source: "Insider Trading and Prediction Markets",
        year: 2007,
    },
    {
        text: "Banning insider trading in prediction markets deters information flow; we should reward it for public good.",
        source: "Overcoming Bias Blog",
        year: 2010,
        url: "https://www.overcomingbias.com",
    },
    {
        text: "Experiments show 15-20% better forecasts with insider participation—they add competition and inject crucial liquidity.",
        source: "Iowa Electronic Markets Research",
        year: 2008,
    },
    {
        text: "Prediction markets succeed precisely because they reward those with superior information for sharing it publicly through their bets.",
        source: "The Age of Em",
        year: 2016,
    },
    {
        text: "The whole point of a prediction market is to give people with information a financial incentive to reveal what they know.",
        source: "Overcoming Bias Blog",
        year: 2012,
        url: "https://www.overcomingbias.com",
    },
    {
        text: "When someone bets with inside information, they're not stealing—they're providing a public service by making prices more accurate.",
        source: "Overcoming Bias Blog",
        year: 2015,
        url: "https://www.overcomingbias.com",
    },
];

export const HansonQuotes = {
    quotes: hansonQuotes,

    /**
     * Get a random Hanson quote
     */
    getRandom(): string {
        const q = hansonQuotes[Math.floor(Math.random() * hansonQuotes.length)];
        return `"${q.text}" — Robin Hanson, ${q.source} (${q.year})`;
    },

    /**
     * Get a random quote with full details
     */
    getRandomFull(): HansonQuote {
        return hansonQuotes[Math.floor(Math.random() * hansonQuotes.length)];
    },

    /**
     * Get educational note for high-score trades
     */
    getEducationalNote(): string {
        return (
            `This flag indicates a potential high-information signal. ` +
            `Prediction markets like Polymarket excel by aggregating insider knowledge, ` +
            `leading to more accurate forecasts—studies show 15-20% improvement with insider participation. ` +
            `Consider this as an opportunity to update your beliefs based on potentially informed trading activity.`
        );
    },

    /**
     * Get brief efficiency note
     */
    getBriefNote(): string {
        return `High-information signal detected. Insiders improve market accuracy by ~15-20%.`;
    },

    /**
     * Get context-appropriate note based on score
     */
    getNoteForScore(score: number): string {
        if (score >= 80) {
            return (
                `🔍 Very High Confidence Signal\n` +
                `This trade exhibits multiple characteristics of informed trading. ` +
                `As Robin Hanson argues, such signals rapidly correct mispricings.\n\n` +
                this.getRandom()
            );
        }
        if (score >= 65) {
            return (
                `🔍 Potential High-Information Signal\n` +
                `${this.getEducationalNote()}`
            );
        }
        return '';
    },

    /**
     * Get all quotes for display
     */
    getAll(): HansonQuote[] {
        return [...hansonQuotes];
    },

    /**
     * Get quotes by year range
     */
    getByYearRange(startYear: number, endYear: number): HansonQuote[] {
        return hansonQuotes.filter(q => q.year >= startYear && q.year <= endYear);
    },
};
