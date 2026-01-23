import { HansonQuote } from '../types';

interface HansonQuoteCardProps {
    quote?: HansonQuote;
}

// Default quotes for client-side rendering
const defaultQuotes: HansonQuote[] = [
    {
        text: "In prediction markets, 'insider trading' is the point—to extract and aggregate hidden knowledge.",
        source: "Forbes Interview",
        year: 2022,
    },
    {
        text: "Markets elicit sincere beliefs via skin-in-the-game, unlike voting where there's no cost to expressing false preferences.",
        source: "Shall We Vote on Values, But Bet on Beliefs?",
        year: 2003,
    },
    {
        text: "Insiders improve market accuracy by correcting mispricings quickly with non-public information.",
        source: "Insider Trading and Prediction Markets",
        year: 2007,
    },
    {
        text: "Experiments show 15-20% better forecasts with insider participation—they add competition and inject crucial liquidity.",
        source: "Iowa Electronic Markets Research",
        year: 2008,
    },
];

export function HansonQuoteCard({ quote }: HansonQuoteCardProps) {
    const displayQuote = quote || defaultQuotes[Math.floor(Math.random() * defaultQuotes.length)];

    return (
        <div className="hanson-quote-card">
            <div className="quote-icon">💡</div>
            <div className="quote-text">"{displayQuote.text}"</div>
            <div className="quote-source">
                — Robin Hanson, {displayQuote.source} ({displayQuote.year})
            </div>
        </div>
    );
}
