
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
    formatArticle
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

            // Ưu tiên biến FINNHUB_API_KEY.
            // Nếu null/undefined thì dùng key NEXT_PUBLIC_.
            const token =
                process.env.FINNHUB_API_KEY ??
                NEXT_PUBLIC_FINNHUB_API_KEY;

            // Nếu không có API key:
            if (!token) {

                // Ghi log lỗi phía server.
                console.error(
                    'Error in stock search:',
                    new Error('FINNHUB API key is not configured')
                );

                // Trả mảng rỗng thay vì throw error.
                // UI có thể hiển thị trạng thái không có dữ liệu.
                return [];
            }

            // Kiểm tra query có phải string không.
            //
            // Nếu là string: Xóa khoảng trắng.
            // Nếu không: Dùng chuỗi rỗng.
            //
            // Ví dụ:
            // "  Apple  " => "Apple"
            // undefined => ""
            const trimmed =
                typeof query === 'string' ? query.trim() : '';

            // Mảng chứa kết quả tìm kiếm từ Finnhub.
            // Khởi tạo rỗng.
            let results: FinnhubSearchResult[] = [];

            // Nếu người dùng KHÔNG nhập từ khóa:
            if (!trimmed) {

                // Lấy 10 mã đầu tiên trong danh sách phổ biến.
                //
                // slice(0, 10):
                // Lấy từ index 0 đến trước index 10.
                const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);

                // Gọi API lấy profile cho từng mã đồng thời.
                const profiles = await Promise.all(

                    // Duyệt danh sách 10 mã cổ phiếu.
                    top.map(async (sym) => {

                        try {

                            // Tạo URL gọi Finnhub stock/profile2.
                            //
                            // Endpoint này trả thông tin công ty:
                            // tên, ticker, sàn giao dịch, logo...
                            const url =
                                `${FINNHUB_BASE_URL}/stock/profile2` +
                                `?symbol=${encodeURIComponent(sym)}` +
                                `&token=${token}`;

                            // Gọi API lấy profile.
                            //
                            // 3600 giây = thời hạn cache của fetch() là 1 giờ.
                            //
                            // any: Bỏ qua kiểm tra kiểu chi tiết.
                            // Nên thay bằng interface cụ thể.
                            const profile =
                                await fetchJSON<any>(url, 3600);

                            // Trả về object gồm symbol và profile.
                            //
                            // as {...} là Type Assertion.
                            return {
                                sym,
                                profile
                            } as {
                                sym: string;
                                profile: any;
                            };

                        } catch (e) {

                            // Nếu API profile của một mã bị lỗi:
                            console.error(
                                'Error fetching profile2 for',
                                sym,
                                e
                            );

                            // Trả profile=null để các mã khác
                            // vẫn có thể được xử lý.
                            return {
                                sym,
                                profile: null
                            } as {
                                sym: string;
                                profile: any;
                            };
                        }
                    })
                );

                // Chuyển danh sách profile sang FinnhubSearchResult.
                results = profiles

                    // map() biến đổi từng phần tử.
                    .map(({ sym, profile }) => {

                        // Chuyển mã cổ phiếu thành chữ hoa.
                        const symbol = sym.toUpperCase();

                        // Lấy tên công ty.
                        //
                        // Ưu tiên profile.name.
                        // Nếu không có, lấy profile.ticker.
                        // Nếu cả hai không có thì undefined.
                        //
                        // ?. là Optional Chaining:
                        // Không gây lỗi khi profile=null.
                        const name: string | undefined =
                            profile?.name ||
                            profile?.ticker ||
                            undefined;

                        // Lấy tên sàn giao dịch từ profile.
                        const exchange: string | undefined =
                            profile?.exchange || undefined;

                        // Nếu không có tên công ty:
                        // Trả undefined để loại bỏ ở bước filter.
                        if (!name) return undefined;

                        // Tạo object theo kiểu FinnhubSearchResult.
                        const r: FinnhubSearchResult = {

                            // Mã cổ phiếu.
                            symbol,

                            // Tên công ty.
                            description: name,

                            // Mã hiển thị.
                            displaySymbol: symbol,

                            // Loại tài sản.
                            type: 'Common Stock',
                        };

                        // Thêm thuộc tính tạm __exchange.
                        //
                        // Vì FinnhubSearchResult không khai báo
                        // thuộc tính __exchange nên dùng as any.
                        //
                        // Đây là cách "lách" TypeScript,
                        // không nên lạm dụng trong dự án thực tế.
                        (r as any).__exchange = exchange;

                        // Trả object đã được xử lý.
                        return r;
                    })

                    // Loại bỏ các phần tử undefined.
                    //
                    // x is FinnhubSearchResult:
                    // Giúp TypeScript hiểu mảng sau filter
                    // chỉ còn FinnhubSearchResult.
                    .filter(
                        (x): x is FinnhubSearchResult => Boolean(x)
                    );

            } else {

                // Nếu người dùng CÓ nhập từ khóa:
                // Gọi Finnhub Search API.
                //
                // Ví dụ:
                // query="apple"
                // => /search?q=apple&token=...
                const url =
                    `${FINNHUB_BASE_URL}/search` +
                    `?q=${encodeURIComponent(trimmed)}` +
                    `&token=${token}`;

                // Gọi API tìm kiếm.
                //
                // FinnhubSearchResponse là kiểu response mong đợi.
                //
                // 1800 giây = thời hạn cache của fetch() là 30 phút.
                const data =
                    await fetchJSON<FinnhubSearchResponse>(url, 1800);

                // Kiểm tra data.result có phải array không.
                //
                // Nếu đúng: Sử dụng kết quả từ API.
                // Nếu sai: Trả mảng rỗng.
                results = Array.isArray(data?.result)
                    ? data.result
                    : [];
            }

            // Chuyển kết quả Finnhub thành kiểu dữ liệu
            // StockWithWatchlistStatus mà ứng dụng sử dụng.
            const mapped: StockWithWatchlistStatus[] = results

                .map((r) => {

                    // Lấy symbol và chuyển thành chữ in hoa.
                    // Nếu r.symbol rỗng thì dùng "".
                    const upper =
                        (r.symbol || '').toUpperCase();

                    // Tên công ty.
                    // Nếu không có description thì dùng symbol.
                    const name = r.description || upper;

                    // Lấy displaySymbol.
                    //
                    // displaySymbol là mã hiển thị, không phải trường
                    // xác định sàn giao dịch. Ở nhánh không có query,
                    // code phía trên còn gán displaySymbol = symbol.
                    const exchangeFromDisplay =
                        (r.displaySymbol as string | undefined)
                        || undefined;

                    // Lấy exchange đã gắn tạm từ profile.
                    //
                    // as any giúp truy cập thuộc tính
                    // không tồn tại trong interface gốc.
                    const exchangeFromProfile =
                        (r as any).__exchange as
                        string | undefined;

                    // Chọn giá trị exchange theo thứ tự:
                    // 1. displaySymbol
                    // 2. __exchange từ profile
                    // 3. Giá trị mặc định "US"
                    //
                    // CHÚ Ý: Đây chỉ là thứ tự ưu tiên hiện tại, không
                    // bảo đảm exchange là tên sàn. Ở nhánh không có query,
                    // displaySymbol luôn bằng symbol nên __exchange từ
                    // profile không được dùng nếu symbol không rỗng.
                    const exchange =
                        exchangeFromDisplay ||
                        exchangeFromProfile ||
                        'US';

                    // Lấy loại cổ phiếu.
                    // Nếu không có thì mặc định "Stock".
                    const type = r.type || 'Stock';

                    // Tạo object theo định dạng của ứng dụng.
                    const item: StockWithWatchlistStatus = {

                        // Mã cổ phiếu.
                        symbol: upper,

                        // Tên công ty.
                        name,

                        // Thông tin exchange.
                        exchange,

                        // Loại tài sản.
                        type,

                        // Mặc định chưa nằm trong watchlist.
                        //
                        // Hàm này chưa kiểm tra database
                        // xem người dùng đã lưu cổ phiếu chưa.
                        isInWatchlist: false,
                    };

                    // Trả object đã chuyển đổi.
                    return item;
                })

                // Giới hạn tối đa 15 kết quả.
                .slice(0, 15);

            // Trả danh sách cổ phiếu cho nơi gọi.
            return mapped;

        } catch (err) {

            // Ghi log lỗi tìm kiếm.
            console.error('Error in stock search:', err);

            // Nếu có lỗi thì trả mảng rỗng.
            // Không làm ứng dụng bị crash vì exception này.
            return [];
        }
    }
);
