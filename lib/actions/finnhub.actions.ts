'use server';

import {
    getDateRange,
    validateArticle,
    formatArticle,
    formatPrice,
    formatChangePercent,
    formatMarketCapValue
} from '@/lib/utils';
import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { cache } from 'react';
import { auth } from '../better-auth/auth';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getWatchlistSymbolsByEmail } from './watchlist.actions';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

// Khóa chỉ dùng trên server nên ưu tiên FINNHUB_API_KEY khi triển khai.
const NEXT_PUBLIC_FINNHUB_API_KEY =
    process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

// Giữ HTTP status để xử lý riêng mã bị từ chối quyền truy cập.
class FinnhubHttpError extends Error {
    constructor(readonly status: number, body: string) {
        super(`Fetch failed ${status}: ${body}`);
    }
}

// Cache của fetch theo revalidateSeconds; không truyền thì luôn lấy dữ liệu mới.
async function fetchJSON<T>(
    url: string,
    revalidateSeconds?: number
): Promise<T> {

    const options: RequestInit & {
        next?: { revalidate?: number }
    } = revalidateSeconds
            ? {
                cache: 'force-cache',
                next: { revalidate: revalidateSeconds }
            }
            : {
                cache: 'no-store'
            };

    const res = await fetch(url, options);

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new FinnhubHttpError(res.status, text);
    }

    return (await res.json()) as T;
}

export { fetchJSON };

// Ưu tiên tin theo mã; nếu không có tin hợp lệ thì lấy tin thị trường chung.
export async function getNews(
    symbols?: string[]
): Promise<MarketNewsArticle[]> {
    try {
        const range = getDateRange(5);
        const token = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
        if (!token) {
            throw new Error('FINNHUB API key is not configured');
        }
        const cleanSymbols = (symbols || [])
            .map((s) => s?.trim().toUpperCase())
            .filter((s): s is string => Boolean(s));
        const maxArticles = 6;
        if (cleanSymbols.length > 0) {
            const perSymbolArticles:
                Record<string, RawNewsArticle[]> = {};
            await Promise.all(
                cleanSymbols.map(async (sym) => {
                    // Lỗi ở một mã không chặn việc lấy tin của các mã khác.
                    try {
                        const url =
                            `${FINNHUB_BASE_URL}/company-news` +
                            `?symbol=${encodeURIComponent(sym)}` +
                            `&from=${range.from}` +
                            `&to=${range.to}` +
                            `&token=${token}`;
                        const articles =
                            await fetchJSON<RawNewsArticle[]>(url, 300);
                        perSymbolArticles[sym] =
                            (articles || []).filter(validateArticle);
                    } catch (e) {
                        console.error(
                            'Error fetching company news for',
                            sym,
                            e
                        );
                        perSymbolArticles[sym] = [];
                    }
                })
            );

            const collected: MarketNewsArticle[] = [];

            // Lấy luân phiên giữa các mã để một mã không chiếm hết 6 bài.
            for (let round = 0; round < maxArticles; round++) {
                for (let i = 0; i < cleanSymbols.length; i++) {
                    const sym = cleanSymbols[i];

                    const list = perSymbolArticles[sym] || [];

                    continueIfEmpty: {
                        if (list.length === 0) break continueIfEmpty;

                        const article = list.shift();

                        if (!article || !validateArticle(article)) {
                            continue;
                        }

                        collected.push(
                            formatArticle(article, true, sym, round)
                        );
                    }

                    if (collected.length >= maxArticles) break;
                }

                if (collected.length >= maxArticles) break;
            }

            if (collected.length > 0) {

                collected.sort(
                    (a, b) =>
                        (b.datetime || 0) - (a.datetime || 0)
                );

                return collected.slice(0, maxArticles);
            }

        }

        const generalUrl =
            `${FINNHUB_BASE_URL}/news` +
            `?category=general&token=${token}`;

        const general =
            await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        const seen = new Set<string>();

        const unique: RawNewsArticle[] = [];

        for (const art of general || []) {

            if (!validateArticle(art)) continue;

            const key = `${art.id}-${art.url}-${art.headline}`;

            if (seen.has(key)) continue;

            seen.add(key);

            unique.push(art);

            if (unique.length >= 20) break;
        }

        const formatted = unique
            .slice(0, maxArticles)
            .map((a, idx) =>
                formatArticle(a, false, undefined, idx)
            );

        return formatted;

    } catch (err) {

        console.error('getNews error:', err);

        throw new Error('Failed to fetch news');
    }
}

// React cache chỉ ghi nhớ trong một lượt render; fetchJSON quản lý thời hạn API.
export const searchStocks = cache(
    async (
        query?: string
    ): Promise<StockWithWatchlistStatus[]> => {

        try {
            const session = await auth.api.getSession({
                headers: await headers(),
            });
            if (!session?.user) redirect('/sign-in');

            const userWatchlistSymbols = await getWatchlistSymbolsByEmail(
                session.user.email
            );

            const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;

            if (!token) {
                console.error('Error in stock search:',
                    new Error('FINNHUB API key is not configured')
                );
                return [];
            }

            const trimmed = typeof query === 'string' ? query.trim() : '';

            let results: FinnhubSearchResult[] = [];

            if (!trimmed) {
                const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
                const profiles = await Promise.all(
                    top.map(async (sym) => {
                        try {
                            const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
                            const profile = await fetchJSON<any>(url, 3600);

                            return { sym, profile } as { sym: string; profile: any };
                        } catch (e) {
                            console.error('Error fetching profile for', sym, e);
                            return { sym, profile: null } as { sym: string; profile: any };
                        }
                    })
                )
                results = profiles
                    .map(({ sym, profile }) => {
                        const symbol = sym.toUpperCase();
                        const name: string | undefined = profile?.name || profile?.ticker || undefined;
                        const exchange: string | undefined = profile?.exchange || undefined;
                        if (!name) return undefined;
                        const r: FinnhubSearchResult = {
                            symbol,
                            description: name,
                            displaySymbol: symbol,
                            type: 'Common Stock',
                        };
                        // Giữ exchange từ profile vì kết quả search dùng cấu trúc khác.
                        (r as any).__exchange = exchange;
                        return r;
                    })
                    .filter((x): x is FinnhubSearchResult => Boolean(x));
            } else {
                const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
                const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
                results = Array.isArray(data?.result) ? data.result : [];
            }

            const mapped: StockWithWatchlistStatus[] = results
                .map((r) => {
                    const upper = (r.symbol || '').toUpperCase();
                    const name = r.description || upper;
                    const exchangeFromDisplay =
                        (r.displaySymbol as string | undefined) || undefined;
                    const exchangeFromProfile = (r as any).__exchange as
                        | string
                        | undefined;
                    const exchange = exchangeFromDisplay || exchangeFromProfile || 'US';
                    const type = r.type || 'Stock';
                    const item: StockWithWatchlistStatus = {
                        symbol: upper,
                        name,
                        exchange,
                        type,
                        isInWatchlist: userWatchlistSymbols.includes(r.symbol.toUpperCase())
                    }
                    return item;
                })
                .slice(0, 15);
            return mapped;

        } catch (err) {

            // Để Next.js tự xử lý redirect và prerender interruption.
            unstable_rethrow(err);
            console.error('Error in stock search:', err);

            return [];
        }
    }
);

export const getStocksDetails = cache(async (symbol: string) => {
    const cleanSymbol = symbol.trim().toUpperCase();

    try {
        const [quote, profile, financials] = await Promise.all([
            fetchJSON(`${FINNHUB_BASE_URL}/quote?symbol=${cleanSymbol}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`),
            fetchJSON(`${FINNHUB_BASE_URL}/stock/profile2?symbol=${cleanSymbol}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`, 3600),
            fetchJSON(`${FINNHUB_BASE_URL}/stock/metric?symbol=${cleanSymbol}&metric=all&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`, 1800)
        ])

        const quoteData = quote as QuoteData;
        const profileData = profile as ProfileData;
        const financialsData = financials as FinancialsData;

        if (!quoteData?.c || !profileData?.name) throw new Error('Invalid stock data');

        const changePercent = quoteData.dp || 0;
        const peRatio = financialsData.metric?.peNormalizedAnnual || null;

        return {
            symbol: cleanSymbol,
            company: profileData?.name,
            currentPrice: quoteData.c,
            changePercent,
            priceFormatted: formatPrice(quoteData.c),
            changeFormatted: formatChangePercent(changePercent),
            peRatio: peRatio?.toFixed(1) || '-',
            marketCapFormatted: formatMarketCapValue(profileData?.marketCapitalization || 0)
        }
    } catch (error) {
        // Gói Finnhub có thể không cấp quyền cho một số mã như APP.NE.
        if (error instanceof FinnhubHttpError && error.status === 403) return null;

        console.error(`Error fetching stock details for ${cleanSymbol}:`, error);
    }
})
