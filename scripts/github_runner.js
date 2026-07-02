const { Telegraf } = require('telegraf');
const browserManager = require('../src/core/browser');
const recorder = require('../src/core/recorder');
const logger = require('../src/utils/logger');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const meetingUrl = process.env.MEETING_URL;
const groupId = process.env.ALLOWED_GROUP_ID;

let isRecording = false;

// Use built-in chrome on GitHub
process.env.CHROME_PATH = '/usr/bin/google-chrome-stable';

/**
 * Register all bot commands before launch
 */
function registerCommands() {
    bot.command('view', async (ctx) => {
        try {
            const screenshotPath = await browserManager.takeScreenshot();
            await ctx.replyWithPhoto({ source: screenshotPath }, { caption: "📸 *Current Meeting View*" , parse_mode: 'Markdown' });
        } catch (err) {
            ctx.replyWithMarkdown(`❌ *View Error:* ${err.message}`);
        }
    });

    bot.command('record', async (ctx) => {
        if (isRecording) {
            return ctx.replyWithMarkdown("⚠️ *System Alert:* Recording is already in progress.");
        }
        ctx.replyWithMarkdown("🔴 *GitHub Runner: Initiating HD Capture...*");
        try {
            await recorder.startRecording();
            isRecording = true;
            ctx.replyWithMarkdown("⏺ *RECORDING STARTED*");
        } catch (err) {
            ctx.replyWithMarkdown(`❌ *Recording Error:* ${err.message}`);
        }
    });

    bot.command('stop', async (ctx) => {
        if (!isRecording) {
            return ctx.replyWithMarkdown("⚠️ *System Alert:* No active recording found to stop.");
        }
        ctx.replyWithMarkdown("💾 *GitHub Runner: Processing Assets...*");
        try {
            isRecording = false;
            const assets = await recorder.stopRecording();
            ctx.replyWithMarkdown("📤 *GHOST meet Assets Uploading...*");

            for (let i = 0; i < assets.videoChunks.length; i++) {
                await ctx.replyWithVideo({ source: assets.videoChunks[i] }, { caption: `📽 Part ${i+1}` });
            }

            if (assets.transcriptPath) {
                await ctx.replyWithDocument({ source: assets.transcriptPath }, { caption: "📄 *AI Meeting Transcript*", parse_mode: 'Markdown' });
            }

            ctx.replyWithMarkdown("✨ *Session Finalized. Shutting down runner.*");
            setTimeout(() => process.exit(0), 15000);
        } catch (err) {
            logger.error(`Stop Error: ${err.message}`);
            ctx.replyWithMarkdown(`❌ *Stop Error:* ${err.message}`);
            process.exit(1);
        }
    });
}

async function run() {
    try {
        console.log(`🚀 Starting GitHub Runner for URL: ${meetingUrl}`);

        // AGGRESSIVE TAKEOVER: Clear webhook repeatedly and wait
        async function forceTakeover(attempts = 10) {
            for (let i = 0; i < attempts; i++) {
                try {
                    console.log(`Takeover attempt ${i+1}/${attempts}...`);
                    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                    await new Promise(r => setTimeout(r, 1500));
                } catch (e) {
                    console.log(`Takeover retry error: ${e.message}`);
                }
            }
        }
        await forceTakeover();

        // 2. Notify Group
        try {
            await bot.telegram.sendMessage(groupId, "🛸 *GHOST meet Runner Active*\n━━━━━━━━━━━━━━━━━━━━━━\nInitializing Ultimate Engine...", { parse_mode: 'Markdown' });
        } catch (e) {
            console.log("Initial notify failed. Proceeding.");
        }

        // 3. Launch Browser
        const tunnel = await browserManager.launchMeeting(meetingUrl);

        // 4. Send One-Click Link
        await bot.telegram.sendMessage(groupId,
            "✅ *Visual Engine Online*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "🔗 *One-Click Control Link:*\n" +
            `[ACCESS DASHBOARD](${tunnel.url})\n\n` +
            "📝 *Quick Tips:*\n" +
            "1. Link will auto-login and scale.\n" +
            "2. If Join is blocked, Login to Google in dashboard.\n" +
            "3. Send `/record` to start.", { parse_mode: 'Markdown' });

        // 5. Start Polling
        registerCommands();

        async function startBot() {
            try {
                // One last clear before launch
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                await bot.launch({ dropPendingUpdates: true });
                console.log("Runner Bot is listening...");
            } catch (err) {
                if (err.response && err.response.error_code === 409) {
                    console.log("Conflict detected, retrying takeover...");
                    await forceTakeover(2);
                    return startBot();
                }
                throw err;
            }
        }
        await startBot();

    } catch (error) {
        console.error("Runner Error:", error);
        process.exit(1);
    }
}

run();
