
'use server';

// Đánh dấu file này chứa Server Functions của Next.js.
// Các hàm async được export từ file sẽ chạy ở phía server,
// không chạy trực tiếp trong trình duyệt.

// Import các hàm tiện ích từ file lib/utils.
// getDateRange: Tạo khoảng thời gian từ ngày bắt đầu đến ngày kết thúc.
// validateArticle: Kiểm tra bài báo có dữ liệu hợp lệ không.
// formatArticle: Chuyển dữ liệu bài báo từ Finnhub sang định dạng ứng dụng.
import {
    getDateRange,
    validateArticle,
    formatArticle,
    formatPrice,
    formatChangePercent,
    formatMarketCapValue
} from '@/lib/utils';

// Import danh sách các mã cổ phiếu phổ biến.
// Ví dụ: AAPL, MSFT, NVDA, TSLA...
import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';

// Import cache từ React.
// cache() có thể ghi nhớ kết quả theo tham số trong một lần render
// Server Component. React không bảo đảm memoization này khi gọi hàm
// ngoài cây component, ví dụ từ một tác vụ nền.
// Nó KHÔNG phải cache dữ liệu Finnhub lâu dài 30 phút hay 1 giờ;
// thời hạn đó do tùy chọn next.revalidate của fetch() bên dưới đặt ra.
import { cache } from 'react';
import { auth } from '../better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getWatchlistSymbolsByEmail } from './watchlist.actions';

// URL gốc của Finnhub API.
// Các endpoint sẽ được nối vào phía sau URL này.
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

// Lấy API key từ biến môi trường.
// process.env: Truy cập các biến môi trường của Node.js.
// ?? '': Nếu giá trị là null hoặc undefined thì dùng chuỗi rỗng.
//
// LƯU Ý:
// NEXT_PUBLIC_ khiến biến có thể được đưa vào client bundle
// khi được tham chiếu trong mã client.
// Với API key chỉ dùng trên server, nên dùng FINNHUB_API_KEY.
const NEXT_PUBLIC_FINNHUB_API_KEY =
    process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

/**
 * Hàm fetchJSON<T>
 *
 * Chức năng:
 * - Gửi HTTP request tới API.
 * - Cấu hình cache tùy theo revalidateSeconds.
 * - Kiểm tra HTTP status.
 * - Chuyển JSON response thành kiểu dữ liệu T.
 *
 * @param url - Địa chỉ API cần gọi.
 * @param revalidateSeconds - Thời gian cache tính bằng giây.
 * @returns Promise<T> - Dữ liệu JSON được khai báo theo kiểu T.
 */
async function fetchJSON<T>(
    url: string,
    revalidateSeconds?: number
): Promise<T> {

    // RequestInit là kiểu TypeScript có sẵn của Fetch API.
    // Bao gồm các tùy chọn như method, headers, body, cache...
    //
    // next là tùy chọn mở rộng do Next.js hỗ trợ.
    // revalidate quy định thời gian dữ liệu cache được coi là mới.
    //
    // Dấu ? nghĩa là thuộc tính không bắt buộc.
    const options: RequestInit & {
        next?: { revalidate?: number }
    } = revalidateSeconds

            // Nếu revalidateSeconds có giá trị truthy:
            // Yêu cầu cache response và cấu hình thời gian revalidate.
            //
            // Ví dụ: revalidateSeconds = 300
            // => dữ liệu có thể được tái sử dụng trong 5 phút.
            //
            // Lưu ý: Hành vi cache thực tế còn phụ thuộc
            // phiên bản Next.js và môi trường triển khai.
            ? {
                cache: 'force-cache',
                next: { revalidate: revalidateSeconds }
            }

            // Nếu không truyền revalidateSeconds:
            // Không lưu response trong Next.js Data Cache.
            : {
                cache: 'no-store'
            };

    // Gửi HTTP GET request đến URL.
    // await đợi fetch hoàn thành và trả về Response.
    const res = await fetch(url, options);

    // res.ok = true nếu HTTP status nằm trong khoảng 200-299.
    // Dấu ! là phủ định, nghĩa là response không thành công.
    if (!res.ok) {

        // Đọc nội dung lỗi từ response dưới dạng text.
        //
        // .catch(() => '') giúp tránh lỗi phụ nếu đọc body thất bại.
        const text = await res.text().catch(() => '');

        // Ném lỗi kèm HTTP status và nội dung response.
        // Ví dụ: Fetch failed 429: API limit reached.
        throw new Error(`Fetch failed ${res.status}: ${text}`);
    }

    // Chuyển response JSON thành JavaScript object.
    //
    // as T là Type Assertion:
    // Thông báo cho TypeScript rằng dữ liệu có kiểu T.
    // KHÔNG tự động kiểm tra dữ liệu thực tế lúc runtime.
    return (await res.json()) as T;
}

// Export hàm fetchJSON để file khác có thể import.
// Vì file có 'use server', hàm async export này
// cũng có thể được sử dụng như một Server Function.
export { fetchJSON };

/**
 * Hàm getNews
 *
 * Chức năng:
 * - Nếu có symbols: ưu tiên lấy tin tức theo từng mã cổ phiếu.
 * - Nếu không có symbols hoặc không lấy được bài nào theo mã:
 *   lấy tin tức thị trường chung.
 * - Kiểm tra dữ liệu hợp lệ.
 * - Giới hạn tối đa 6 bài báo.
 *
 * @param symbols - Danh sách mã cổ phiếu, không bắt buộc.
 * @returns Promise<MarketNewsArticle[]>
 */
export async function getNews(
    symbols?: string[]
): Promise<MarketNewsArticle[]> {

    // try/catch giúp bắt lỗi phát sinh trong quá trình xử lý.
    try {

        // Lấy khoảng thời gian 5 ngày.
        // Ngày bắt đầu và kết thúc được tính tại thời điểm gọi hàm.
        const range = getDateRange(5);

        // Hàm getNews chỉ đọc NEXT_PUBLIC_FINNHUB_API_KEY.
        // Khác với searchStocks, nó không đọc FINNHUB_API_KEY.
        const token = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;

        // Nếu không cấu hình API key thì ném lỗi.
        if (!token) {
            throw new Error('FINNHUB API key is not configured');
        }

        // Xử lý danh sách symbols đầu vào.
        const cleanSymbols = (symbols || [])

            // Duyệt qua từng mã cổ phiếu.
            // trim(): Xóa khoảng trắng ở đầu và cuối.
            // toUpperCase(): Chuyển thành chữ in hoa.
            //
            // Ví dụ: " aapl " => "AAPL"
            // ?. tránh lỗi nếu phần tử là null/undefined.
            .map((s) => s?.trim().toUpperCase())

            // Loại bỏ các giá trị rỗng.
            //
            // Boolean(s):
            // - "AAPL" => true
            // - "" => false
            //
            // s is string là Type Predicate,
            // giúp TypeScript hiểu kết quả là string[].
            .filter((s): s is string => Boolean(s));

        // Số bài báo tối đa muốn trả về.
        const maxArticles = 6;

        // Nếu có ít nhất một mã cổ phiếu:
        // Ưu tiên lấy tin tức theo mã đó.
        if (cleanSymbols.length > 0) {

            // Tạo object lưu danh sách bài báo theo từng mã.
            //
            // Record<string, RawNewsArticle[]> nghĩa là:
            // - Key: string, ví dụ "AAPL".
            // - Value: mảng RawNewsArticle.
            //
            // Ví dụ:
            // {
            //   AAPL: [article1, article2],
            //   TSLA: [article3, article4]
            // }
            const perSymbolArticles:
                Record<string, RawNewsArticle[]> = {};

            // Promise.all() chạy nhiều Promise đồng thời.
            // Ở đây gọi API cho tất cả symbols cùng lúc.
            //
            // Ví dụ có AAPL, TSLA, NVDA:
            // Cả 3 request được khởi tạo gần như đồng thời,
            // thay vì đợi từng request chạy xong.
            await Promise.all(

                // map() tạo một Promise cho mỗi symbol.
                cleanSymbols.map(async (sym) => {

                    // Mỗi symbol có try/catch riêng.
                    // Một mã lỗi sẽ không làm hỏng toàn bộ danh sách.
                    try {

                        // Tạo URL gọi Finnhub company-news API.
                        //
                        // encodeURIComponent(sym):
                        // Mã hóa symbol để an toàn khi đặt trong URL.
                        //
                        // from/to: Khoảng thời gian lấy tin.
                        // token: API key xác thực.
                        const url =
                            `${FINNHUB_BASE_URL}/company-news` +
                            `?symbol=${encodeURIComponent(sym)}` +
                            `&from=${range.from}` +
                            `&to=${range.to}` +
                            `&token=${token}`;

                        // Gọi API lấy danh sách bài báo.
                        //
                        // <RawNewsArticle[]>:
                        // Khai báo kiểu dữ liệu mong đợi.
                        //
                        // 300 giây = thời hạn cache của fetch() là 5 phút.
                        const articles =
                            await fetchJSON<RawNewsArticle[]>(url, 300);

                        // Nếu articles có dữ liệu:
                        // Chỉ giữ những bài hợp lệ.
                        //
                        // Nếu articles là null/undefined:
                        // Sử dụng mảng rỗng [].
                        //
                        // filter(validateArticle):
                        // Gọi validateArticle cho từng bài báo.
                        perSymbolArticles[sym] =
                            (articles || []).filter(validateArticle);

                    } catch (e) {

                        // Ghi log nếu gọi API của symbol thất bại.
                        console.error(
                            'Error fetching company news for',
                            sym,
                            e
                        );

                        // Nếu lỗi thì gán mảng rỗng.
                        // Những symbol khác vẫn có thể trả dữ liệu.
                        perSymbolArticles[sym] = [];
                    }
                })
            );

            // Mảng chứa các bài báo cuối cùng.
            const collected: MarketNewsArticle[] = [];

            // Round-robin:
            // Lấy lần lượt bài báo từ từng mã cổ phiếu.
            //
            // Ví dụ:
            // AAPL có [A1, A2, A3]
            // TSLA có [T1, T2, T3]
            //
            // Thứ tự thu thập tạm thời:
            // A1, T1, A2, T2, A3, T3
            //
            // Cách này giúp chọn tin từ nhiều mã. Trước khi trả về,
            // danh sách còn được sắp xếp theo thời gian nên thứ tự cuối
            // không nhất thiết xen kẽ giữa các mã.

            // Vòng lặp ngoài: tối đa 6 lượt.
            for (let round = 0; round < maxArticles; round++) {

                // Vòng lặp trong: duyệt từng symbol.
                for (let i = 0; i < cleanSymbols.length; i++) {

                    // Lấy mã cổ phiếu tại vị trí i.
                    const sym = cleanSymbols[i];

                    // Lấy danh sách bài báo của mã đó.
                    // Nếu không có thì dùng mảng rỗng.
                    const list = perSymbolArticles[sym] || [];

                    // Nếu danh sách rỗng thì bỏ qua symbol này.
                    continueIfEmpty: {
                        if (list.length === 0) break continueIfEmpty;

                        // shift() lấy và XÓA phần tử đầu tiên của mảng.
                        //
                        // Ví dụ:
                        // [A1, A2, A3].shift() => A1
                        // Mảng còn lại: [A2, A3]
                        const article = list.shift();

                        // Nếu không có bài hoặc bài không hợp lệ:
                        // Bỏ qua lần duyệt hiện tại.
                        if (!article || !validateArticle(article)) {
                            continue;
                        }

                        // Chuyển bài báo sang định dạng ứng dụng.
                        //
                        // true: Đánh dấu bài thuộc company news
                        // theo quy ước của formatArticle().
                        // sym: Mã cổ phiếu.
                        // round: Lượt lấy bài.
                        collected.push(
                            formatArticle(article, true, sym, round)
                        );
                    }

                    // Nếu đã đủ 6 bài thì thoát vòng lặp trong.
                    if (collected.length >= maxArticles) break;
                }

                // Nếu đủ 6 bài thì thoát vòng lặp ngoài.
                if (collected.length >= maxArticles) break;
            }

            // Nếu đã thu thập được bài báo:
            if (collected.length > 0) {

                // Sắp xếp theo thời gian mới nhất trước.
                //
                // sort((a, b) => b.datetime - a.datetime)
                // => Sắp xếp giảm dần.
                //
                // || 0: Nếu datetime là falsy thì dùng 0.
                collected.sort(
                    (a, b) =>
                        (b.datetime || 0) - (a.datetime || 0)
                );

                // Chỉ trả về tối đa 6 bài báo.
                return collected.slice(0, maxArticles);
            }

            // Nếu không lấy được bài nào theo symbol,
            // chương trình tiếp tục lấy tin thị trường chung.
        }

        // API lấy tin tức thị trường chung.
        // category=general nghĩa là tin tức tổng hợp.
        const generalUrl =
            `${FINNHUB_BASE_URL}/news` +
            `?category=general&token=${token}`;

        // Gọi API với thời hạn cache của fetch() là 300 giây.
        const general =
            await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        // Set dùng để lưu các khóa duy nhất.
        // Mục đích: tránh bài báo bị trùng lặp.
        const seen = new Set<string>();

        // Mảng lưu các bài báo không trùng nhau.
        const unique: RawNewsArticle[] = [];

        // Duyệt từng bài báo từ API.
        for (const art of general || []) {

            // Nếu bài báo không hợp lệ thì bỏ qua.
            if (!validateArticle(art)) continue;

            // Tạo khóa nhận diện bài báo.
            // Kết hợp id, url và headline.
            const key = `${art.id}-${art.url}-${art.headline}`;

            // Nếu Set đã chứa key thì bỏ qua bài này.
            if (seen.has(key)) continue;

            // Thêm key vào Set để đánh dấu đã xử lý.
            seen.add(key);

            // Thêm bài hợp lệ vào danh sách.
            unique.push(art);

            // Chỉ thu thập tối đa 20 bài trước khi xử lý tiếp.
            if (unique.length >= 20) break;
        }

        // Lấy tối đa 6 bài từ danh sách unique.
        //
        // map() chuyển từng RawNewsArticle
        // thành MarketNewsArticle.
        //
        // false: Đánh dấu không phải company news.
        // undefined: Không gắn symbol cụ thể.
        // idx: Vị trí bài báo trong danh sách.
        const formatted = unique
            .slice(0, maxArticles)
            .map((a, idx) =>
                formatArticle(a, false, undefined, idx)
            );

        // Trả về danh sách bài báo đã xử lý.
        return formatted;

    } catch (err) {

        // Ghi log lỗi chi tiết ở phía server.
        console.error('getNews error:', err);

        // Ném lỗi chung cho nơi gọi hàm.
        // Không trả trực tiếp chi tiết lỗi API ra ngoài.
        throw new Error('Failed to fetch news');
    }
}

/**
 * Hàm searchStocks
 *
 * Chức năng:
 * - Có query: Tìm kiếm cổ phiếu bằng Finnhub Search API.
 * - Không có query: Lấy profile của 10 mã phổ biến.
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
            // Đọc session từ header của request hiện tại để biết người gọi là ai.
            const session = await auth.api.getSession({
                headers: await headers(),
            });
            // redirect() ném ngoại lệ điều hướng; catch bên dưới có thể bắt ngoại lệ này.
            if (!session?.user) redirect('/sign-in');

            // Lấy các mã đã lưu để gắn cờ isInWatchlist vào kết quả tìm kiếm.
            const userWatchlistSymbols = await getWatchlistSymbolsByEmail(
                session.user.email
            );

            // Ưu tiên key chỉ dùng trên server; dùng key NEXT_PUBLIC_ nếu không có.
            const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;

            if (!token) {
                // Thiếu key: ghi log phía server và trả danh sách rỗng.
                console.error('Error in stock search:',
                    new Error('FINNHUB API key is not configured')
                );
                return [];
            }

            // Bỏ khoảng trắng; query rỗng hoặc không phải chuỗi đi vào nhánh phổ biến.
            const trimmed = typeof query === 'string' ? query.trim() : '';

            // Hai nhánh cùng đưa dữ liệu về dạng FinnhubSearchResult để xử lý chung.
            let results: FinnhubSearchResult[] = [];

            if (!trimmed) {
                // Lấy profile của 10 mã đầu trong danh sách phổ biến, chạy đồng thời.
                const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
                const profiles = await Promise.all(
                    top.map(async (sym) => {
                        try {
                            const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
                            // Cache response của request này tối đa 3600 giây theo fetchJSON.
                            const profile = await fetchJSON<any>(url, 3600);

                            return { sym, profile } as { sym: string; profile: any };
                        } catch (e) {
                            // Một mã lỗi vẫn cho phép các mã khác tiếp tục hiển thị.
                            console.error('Error fetching profile for', sym, e);
                            return { sym, profile: null } as { sym: string; profile: any };
                        }
                    })
                )
                // Chuẩn hóa profile thành cấu trúc giống kết quả của Search API.
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
                        // Thuộc tính tạm ngoài kiểu khai báo; chỉ nhánh profile có nó.
                        (r as any).__exchange = exchange;
                        return r;
                    })
                    .filter((x): x is FinnhubSearchResult => Boolean(x));
            } else {
                // Có từ khóa: gọi Search API; cache response trong 1800 giây.
                const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
                const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
                // Dữ liệu sai dạng hoặc không có result được xem là không có kết quả.
                results = Array.isArray(data?.result) ? data.result : [];
            }

            // Chuyển dữ liệu Finnhub sang kiểu StockWithWatchlistStatus của UI.
            const mapped: StockWithWatchlistStatus[] = results
                .map((r) => {
                    const upper = (r.symbol || '').toUpperCase();
                    const name = r.description || upper;
                    // displaySymbol là mã hiển thị, không chắc là tên sàn.
                    const exchangeFromDisplay =
                        (r.displaySymbol as string | undefined) || undefined;
                    const exchangeFromProfile = (r as any).__exchange as
                        | string
                        | undefined;
                    // Thứ tự hiện tại khiến __exchange bị bỏ qua nếu có displaySymbol;
                    // ở nhánh phổ biến, displaySymbol luôn bằng symbol.
                    const exchange = exchangeFromDisplay || exchangeFromProfile || 'US';
                    const type = r.type || 'Stock';
                    const item: StockWithWatchlistStatus = {
                        symbol: upper,
                        name,
                        exchange,
                        type,
                        // So khớp mã viết hoa với danh sách watchlist đã đọc ở trên.
                        isInWatchlist: userWatchlistSymbols.includes(r.symbol.toUpperCase())
                    }
                    return item;
                })
                .slice(0, 15); // Chỉ trả tối đa 15 kết quả.
            return mapped;

        } catch (err) {

            // Bắt cả lỗi API và ngoại lệ redirect() ở phía trên.
            console.error('Error in stock search:', err);

            // Nếu có lỗi thì trả mảng rỗng.
            // Không làm ứng dụng bị crash vì exception này.
            return [];
        }
    }
);

//Fetch stock details by symbol
export const getStocksDetails = cache(async (symbol: string) => {
    const cleanSymbol = symbol.trim().toUpperCase();

    try {
        const [quote, profile, financials] = await Promise.all([
            //Price data - no caching for accuracy
            fetchJSON(`${FINNHUB_BASE_URL}/quote?symbol=${cleanSymbol}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`),
            //Company info - cache 1hr (rarely changes)
            fetchJSON(`${FINNHUB_BASE_URL}/stock/profile2?symbol=${cleanSymbol}&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`, 3600),
            //Financial metrics (P/E, etc.) - cache 30min
            fetchJSON(`${FINNHUB_BASE_URL}/stock/metric?symbol=${cleanSymbol}&metric=all&token=${NEXT_PUBLIC_FINNHUB_API_KEY}`, 1800)
        ])

        // Type cast the responses
        const quoteData = quote as QuoteData;
        const profileData = profile as ProfileData;
        const financialsData = financials as FinancialsData;

        // Check if we got valid quote and profile data
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
        console.error(`Error fetching stock details for ${cleanSymbol}:`, error);
    }
})
