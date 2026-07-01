const { Telegraf } = require('telegraf');
const browserManager = require('../src/core/browser');
const recorder = require('../src/core/recorder');
const logger = require('../src/utils/logger');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const meetingUrl = process.env.MEETING_URL;
const groupId = process.env.ALLOWED_GROUP_ID;

async function run() {
    try {
        console.log(`🚀 Starting GitHub Runner for URL: ${meetingUrl}`);

        // 1. Notify Group
        await bot.telegram.sendMessage(groupId, "🛸 *GHOST meet Runner Active*\n━━━━━━━━━━━━━━━━━━━━━━\nInitializing 7GB High-Performance Engine...", { parse_mode: 'Markdown' });

        // 2. Launch Browser
        const tunnel = await browserManager.launchMeeting(meetingUrl);

        // 3. Send Tunnel Link
        await bot.telegram.sendMessage(groupId,
            "✅ *Visual Engine Booted (GitHub Actions)*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "🔗 *Secure Control Tunnel:*\n" +
            `[ACCESS DASHBOARD](${tunnel.url})\n\n` +
            "📝 *Instructions:*\n" +
            "1. Enter the dashboard link.\n" +
            "2. Login/Join the meeting.\n" +
            "3. Send `/record` to the bot to start capture.", { parse_mode: 'Markdown' });

        // 4. STAY ALIVE & LISTEN FOR RECORD/STOP COMMANDS
        // On GitHub, we run a full bot instance to handle the specific session commands
        bot.command('record', async (ctx) => {
            ctx.replyWithMarkdown("🔴 *GitHub Runner: Initiating HD Capture...*");
            try {
                await recorder.startRecording();
            } catch (err) {
                ctx.replyWithMarkdown(`❌ *Recording Error:* ${err.message}`);
            }
        });

        bot.command('stop', async (ctx) => {
            ctx.replyWithMarkdown("💾 *GitHub Runner: Processing Assets...*");
            try {
                const assets = await recorder.stopRecording();

                for (let i = 0; i < assets.videoChunks.length; i++) {
                    await ctx.replyWithVideo({ source: assets.videoChunks[i] }, { caption: `📽 Part ${i+1}` });
                }
                if (assets.transcriptPath) {
                    await ctx.replyWithDocument({ source: assets.transcriptPath });
                }

                ctx.replyWithMarkdown("✨ *Session Finalized. Shutting down runner.*");
                setTimeout(() => process.exit(0), 5000);
            } catch (err) {
                ctx.replyWithMarkdown(`❌ *Stop Error:* ${err.message}`);
            }
        });

        bot.launch();
        console.log("Runner Bot is listening...");

    } catch (error) {
        console.error("Runner Error:", error);
        await bot.telegram.sendMessage(groupId, `🚨 *Runner Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        process.exit(1);
    }
}

run();
