import { inngest } from "@/lib/inngest/client";
import { PERSONALIZED_WELCOME_EMAIL_PROMPT, NEWS_SUMMARY_EMAIL_PROMPT } from "@/lib/inngest/prompts";
import { sendNewsSummaryEmail, sendWelcomeEmail, } from "../nodemailer";
import { getAllUsersForNewsEmail, } from "../actions/user.actions";
import { getWatchlistSymbolsByEmail } from "../actions/watchlist.action";
import { getNews } from "../actions/finnhub.actions";
import { getFormattedTodayDate } from "@/lib/utils";


export const sendSignupEmail = inngest.createFunction(
    {
        id: 'sign-up-email',
        triggers: { event: 'app/user.created' },
    },
    async ({ event, step }) => {
        const userProfile = `
            - Country: ${event.data.country}
            - Investment Goals: ${event.data.investmentGoals}
            - Risk Tolerance: ${event.data.riskTolerance}
            - Preferred industry: ${event.data.preferredIndustry}
        `;

        const prompt = PERSONALIZED_WELCOME_EMAIL_PROMPT.replace('{userProfile}', userProfile);

        const response = await step.ai.infer('generate-welcome-intro', {
            model: step.ai.models.gemini({ model: 'gemini-3.5-flash-lite' }), 
            body: {
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt }
                        ]
                    }
                ]
            }
        });

        await step.run('send-welcome-email', async () => {
            const part = response.candidates?.[0].content?.parts?.[0];
            const introText = (part && 'text' in part ? part.text : null) || 'Welcome to our platform! We are excited to have you on board.';

            const { data: { email, name } } = event;
            return await sendWelcomeEmail({
                email,
                name,
                intro: introText
            })
        })

        return {
            success: true,
            message: 'Welcome email sent successfully',
        }
    }
)

export const sendDailyNewsSummary = inngest.createFunction(
    {
        id: 'daily-news-summary',
        triggers: [{ event: 'app/daily.news.summary' }, { cron: '0 12 * * *' }],
    },
    async ({ step }) => {
        //step 1: get all users for news delivery
        const users = await step.run('get-all-users', getAllUsersForNewsEmail);

        if (!users || users.length === 0) return { success: false, message: 'No users found for news delivery' };
        //step 2: Fetch personalized news for each user

        const results = await step.run('fectch-user-news', async () => {
            const perUser: Array<{ user: UserForNewsEmail; articles: MarketNewsArticle[] }> = [];
            for (const user of users as UserForNewsEmail[]) {
                try {
                    const symbols = await getWatchlistSymbolsByEmail(user.email);
                    let articles = await getNews(symbols);
                    //Enforce max 6 articles
                    articles = (articles || []).slice(0, 6);
                    if (!articles || articles.length === 0) { 
                        articles = await getNews(); // Fetch general market news if no personalized news
                        articles = (articles || []).slice(0, 6);
                    }
                    perUser.push({ user, articles });
                }catch (error) {
                    console.error(`Error fetching news for user ${user.email}:`, error);
                    perUser.push({ user, articles: [] }); // Push empty articles on error
                }
            }
            return perUser;
        })
        //step 3: Summarize news via AI for each user
        const userNewsSummaries: { user: User; newsContent: string | null }[] = [];
        for (const { user, articles } of results) { 
            try { 
                const prompt = NEWS_SUMMARY_EMAIL_PROMPT.replace('{{newsData}}', JSON.stringify(articles, null, 2));

                const response = await step.ai.infer(`summarize-news-${user.id}`, {
                    model: step.ai.models.gemini({ model: 'gemini-3.5-flash-lite' }),
                    body: {
                        contents: [{role: 'user', parts: [{ text: prompt }]}]
                    }
                })
                const part = response.candidates?.[0].content?.parts?.[0];
                const newsContent = (part && 'text' in part ? part.text : null) || 'No market news';

                userNewsSummaries.push({ user, newsContent });
            }
            catch (error) {
                console.error(`Error summarizing news for user ${user.email}:`, error);
                userNewsSummaries.push({ user, newsContent: null }); // Push null summary on error
            }
        }
        //step 4: Send emails
        await step.run('send-news-emails', async () => { 
            await Promise.all(
                userNewsSummaries.map(async ({ user, newsContent }) => { 
                    if (!newsContent) return false;
                    
                    return await sendNewsSummaryEmail({
                        email: user.email,
                        date: getFormattedTodayDate(),
                        newsContent
                    })
                })
            )
        })

        return {
            success: true,
            message: 'Daily news summary process completed',
        }
    }

)
    
