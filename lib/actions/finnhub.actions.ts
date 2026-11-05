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
import type { FinnhubRawData } from '@/database/models/watchlist.model';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';



const POPULAR_STOCK_NAMES: Record<string, string> = {
    AAPL: 'Apple Inc.',
    MSFT: 'Microsoft',
    GOOGL: 'Alphabet',
    AMZN: 'Amazon',
    TSLA: 'Tesla',
    META: 'Meta Platforms',
    NVDA: 'NVIDIA',
    NFLX: 'Netflix',
    ORCL: 'Oracle',
    CRM: 'Salesforce',
};

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

/**
 * Hàm searchStocks
 *
 * Chức năng:
 * - Có query: Tìm kiếm cổ phiếu bằng Finnhub Search API.
 * - Không có query: Hiển thị 10 mã phổ biến từ danh sách có sẵn.
 * - Chuyển dữ liệu thành StockWithWatchlistStatus[].
 *
 * cache() của React:
 * Có thể ghi nhớ kết quả theo tham số trong một lần render Server Component.
 * Không bảo đảm memoization khi gọi ngoài cây component, chẳng hạn
 * khi Client Component gọi Server Function này sau khi nhập tìm kiếm.
 * Cache này khác với thời hạn next.revalidate của từng fetch() bên dưới.
 *
 * @param query - Từ khóa tìm kiếm, không bắt buộc.
 * @returns Promise<StockWithWatchlistStatus[]>
 */
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

            const trimmed = typeof query === 'string' ? query.trim() : '';

            let results: FinnhubSearchResult[] = [];

            if (!trimmed) {
                // Danh sách này không gọi Finnhub, nên vẫn hiện khi API bị giới hạn 429.
                results = POPULAR_STOCK_SYMBOLS.slice(0, 10).map((symbol) => ({
                    symbol,
                    description: POPULAR_STOCK_NAMES[symbol] || symbol,
                    type: 'Common Stock',
                }));
            } else {
                if (!token) {
                    console.error('Error in stock search:', new Error('FINNHUB API key is not configured'));
                    return [];
                }
                // Có từ khóa: gọi Search API; cache response trong 1800 giây.
                const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
                const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
                results = Array.isArray(data?.result) ? data.result : [];
            }

            const mapped: StockWithWatchlistStatus[] = results
                .map((r) => {
                    const upper = (r.symbol || '').toUpperCase();
                    const name = r.description || upper;
                    // Search API không cung cấp tên sàn; displaySymbol là mã hiển thị.
                    const exchange = 'US';
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

            // Trả tín hiệu redirect/prerender về Next.js trước khi xử lý lỗi API.
            unstable_rethrow(err);
            console.error('Error in stock search:', err);

            return [];
        }
    }
);

// Lấy dữ liệu Finnhub; cachedRaw là response nguyên vẹn đã lưu trong watchlist.
export const getStocksDetails = cache(async (
    symbol: string,
    fallbackCompany?: string,
    cachedRaw?: FinnhubRawData,
) => {
    const cleanSymbol = symbol.trim().toUpperCase();
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;

    // Cùng một cách định dạng cho response mới và response đọc từ MongoDB.
    // Hàm giữ raw nguyên vẹn trong finnhubRaw để nơi gọi có thể lưu đủ các trường.
    const formatDetails = (raw: FinnhubRawData, dataSource: 'live' | 'cached') => {
        const price = raw.quote.c;
        if (typeof price !== 'number' || price <= 0) throw new Error('Invalid stock data');
        const changePercent = raw.quote.dp || 0;
        const peRatio = raw.financials?.metric?.peNormalizedAnnual || null;
        return {
            symbol: cleanSymbol,
            company: raw.profile?.name || fallbackCompany || cleanSymbol,
            currentPrice: price,
            changePercent,
            priceFormatted: formatPrice(price),
            changeFormatted: formatChangePercent(changePercent) || '0.00%',
            peRatio: peRatio?.toFixed(1) || '-',
            marketCapFormatted: raw.profile?.marketCapitalization
                // Finnhub trả vốn hóa theo triệu USD; hàm định dạng nhận USD.
                ? formatMarketCapValue(raw.profile.marketCapitalization * 1_000_000)
                : '-',
            finnhubRaw: raw,
            dataSource,
        };
    };

    try {
        if (!token) throw new Error('FINNHUB API key is not configured');
        // Lấy giá trước; nếu quote bị giới hạn thì không gọi thêm profile/metric.
        const quoteData = await fetchJSON<FinnhubRawData['quote']>(
            `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(cleanSymbol)}&token=${token}`,
        );
        if (!quoteData?.c) throw new Error('Invalid stock data');

        // allSettled giữ kết quả từng endpoint, kể cả khi endpoint còn lại thất bại.
        // Không truyền revalidateSeconds: fetchJSON dùng no-store để hỏi Finnhub trước.
        const [profileResult, financialsResult] = await Promise.allSettled([
            // Luôn hỏi Finnhub trước; MongoDB chỉ được dùng khi endpoint lỗi.
            fetchJSON<NonNullable<FinnhubRawData['profile']>>(`${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(cleanSymbol)}&token=${token}`),
            fetchJSON<NonNullable<FinnhubRawData['financials']>>(`${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(cleanSymbol)}&metric=all&token=${token}`)
        ])

        for (const result of [profileResult, financialsResult]) {
            // allSettled cũng có thể giữ tín hiệu prerender trong nhánh rejected.
            if (result.status === 'rejected') unstable_rethrow(result.reason);
            if (result.status === 'rejected' &&
                !(result.reason instanceof FinnhubHttpError && result.reason.status === 403)) {
                console.error(`Partial stock data for ${cleanSymbol}:`, result.reason);
            }
        }

        // Lưu cả response; endpoint phụ lỗi thì giữ response thành công trước đó.
        const raw: FinnhubRawData = {
            quote: quoteData,
            // fulfilled: lấy toàn bộ JSON mới; rejected: dùng JSON đã lưu của endpoint đó.
            profile: profileResult.status === 'fulfilled' ? profileResult.value : cachedRaw?.profile,
            financials: financialsResult.status === 'fulfilled' ? financialsResult.value : cachedRaw?.financials,
        };
        return formatDetails(raw, 'live');
    } catch (error) { 
        // Chỉ dùng MongoDB cho lỗi dữ liệu/API; tín hiệu Next.js phải được ném lại.
        unstable_rethrow(error);
        // Quote lỗi 429/403: đọc dữ liệu đã lưu, không gọi thêm Finnhub.
        if (cachedRaw?.quote?.c) return formatDetails(cachedRaw, 'cached');
        // Gói Finnhub hiện tại không có quyền với một số mã như APP.NE.
        if (error instanceof FinnhubHttpError && error.status === 403) return null;

        console.error(`Error fetching stock details for ${cleanSymbol}:`, error);
    }
})
