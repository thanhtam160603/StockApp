import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface WatchlistSnapshot {
    currentPrice: number;
    changePercent: number;
    priceFormatted: string;
    changeFormatted: string;
    marketCap: string;
    peRatio: string;
}

export interface FinnhubRawData {
    quote: QuoteData & Record<string, unknown>;
    profile?: ProfileData & Record<string, unknown>;
    financials?: FinancialsData & Record<string, unknown>;
}

export interface WatchlistItem extends Document {
    userId: string;
    symbol: string;
    company: string;
    exchange?: string;
    stockType?: string;
    snapshot?: WatchlistSnapshot;
    finnhubRaw?: FinnhubRawData;
    addedAt: Date;
}

const WatchlistSnapshotSchema = new Schema<WatchlistSnapshot>(
    {
        currentPrice: { type: Number, required: true },
        changePercent: { type: Number, required: true },
        priceFormatted: { type: String, required: true },
        changeFormatted: { type: String, required: true },
        marketCap: { type: String, required: true },
        peRatio: { type: String, required: true },
    },
    { _id: false },
);

// Mixed giữ nguyên toàn bộ JSON của Finnhub, kể cả trường ứng dụng chưa sử dụng.
const FinnhubRawSchema = new Schema<FinnhubRawData>(
    {
        quote: { type: Schema.Types.Mixed, required: true },
        profile: { type: Schema.Types.Mixed },
        financials: { type: Schema.Types.Mixed },
    },
    { _id: false },
);

const WatchlistSchema = new Schema<WatchlistItem>(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        company: { type: String, required: true, trim: true },
        exchange: { type: String, trim: true },
        stockType: { type: String, trim: true },
        snapshot: { type: WatchlistSnapshotSchema },
        finnhubRaw: { type: FinnhubRawSchema },
        addedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// Prevent duplicate symbols per user
WatchlistSchema.index({ userId: 1, symbol: 1 }, { unique: true });

export const Watchlist: Model<WatchlistItem> =
    (models?.Watchlist as Model<WatchlistItem>) || model<WatchlistItem>('Watchlist', WatchlistSchema);
