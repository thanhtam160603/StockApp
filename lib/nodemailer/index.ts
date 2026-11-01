import nodemailer from "nodemailer"
import { WELCOME_EMAIL_TEMPLATE, NEWS_SUMMARY_EMAIL_TEMPLATE } from "@/lib/nodemailer/templates"

export const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
    },
})

export const sendWelcomeEmail = async ({ email, name, intro }: WelcomeEmailData) => {
    const htmlTemplate = WELCOME_EMAIL_TEMPLATE
        .replace('{{name}}', name)
        .replace('{{intro}}', intro);
    
    const mailOptions = {
        from: '"Signalist <signalist@gmail.com>"',
        to: email,
        subject: 'Welcome to Signalist!',
        text: 'Thanks for joining Signalist',
        html: htmlTemplate,
    }

    await transporter.sendMail(mailOptions);
}

export const sendNewsSummaryEmail = async ({ email, date, newsContent }: { email: string; date: string; newsContent: string }) => { 
    const htmlTemplate = NEWS_SUMMARY_EMAIL_TEMPLATE
        .replace('{{date}}', date)
        .replace('{{newsContent}}', newsContent);

    const mailOptions = {
        from: '"Signalist <signalist@gmail.com>"',
        to: email,
        subject: `Your Daily News Summary - ${date}`,
        text: 'Here is your daily news summary',
        html: htmlTemplate,
    }

    await transporter.sendMail(mailOptions);
}
