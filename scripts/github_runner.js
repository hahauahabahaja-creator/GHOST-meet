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

async function run() {
    try {
        console.log(`🚀 Starting GitHub Runner for URL: ${meetingUrl}`);

        // 1. Force Takeover & Notify Group
        async function notifyStart() {
            try {
                // Clear any existing webhook/polling from Render bot
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                await new Promise(r => setTimeout(r, 2000));

                await bot.telegram.sendMessage(groupId, "🛸 *GHOST meet Runner Active*\n━━━━━━━━━━━━━━━━━━━━━━\nInitializing 7GB High-Performance Engine...", { parse_mode: 'Markdown' });
            } catch (err) {
                if (err.response && err.response.error_code === 409) {
                    console.log("Conflict during notify, retrying takeover in 5s...");
                    await new Promise(r => setTimeout(r, 5000));
                    return notifyStart();
                }
                throw err;
            }
        }
        await notifyStart();

        // 2. Launch Browser
        const tunnel = await browserManager.launchMeeting(meetingUrl);

        // 3. Send One-Click Tunnel Link
        async function sendTunnel() {
            try {
                await bot.telegram.sendMessage(groupId,
                    "✅ *Visual Engine Booted (GitHub Actions)*\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━\n" +
                    "🔗 *Secure One-Click Link:*\n" +
                    `[ACCESS DASHBOARD](${tunnel.url})\n\n` +
                    "📝 *Instructions:*\n" +
                    "1. Click the link (Logs in automatically).\n" +
                    "2. Handle meeting permissions.\n" +
                    "3. Send `/view` to check class.\n" +
                    "4. Send `/record` to start.", { parse_mode: 'Markdown' });
            } catch (err) {
                if (err.response && err.response.error_code === 409) {
                    await new Promise(r => setTimeout(r, 5000));
                    return sendTunnel();
                }
                throw err;
            }
        }
        await sendTunnel();

        // 4. SMART COMMANDS
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
                return ctx.replyWithMarkdown("⚠️ *System Alert:* A recording is already in progress. (Class recording chal rhi hai)");
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
                return ctx.replyWithMarkdown("⚠️ *System Alert:* No active recording found to stop. (Recording shuru he nhi hui hai)");
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
                    await ctx.replyWithDocument({ source: assets.transcriptPath }, { caption: "📄 *AI Meeting Transcript (English + Hindi)*", parse_mode: 'Markdown' });
                }

                ctx.replyWithMarkdown("✨ *Session Finalized. Shutting down runner.*");
                setTimeout(() => process.exit(0), 5000);
            } catch (err) {
                ctx.replyWithMarkdown(`❌ *Stop Error:* ${err.message}`);
            }
        });

        // Robust Launch with Retry for 409 Conflict
        async function startBot() {
            try {
                await bot.launch({ dropPendingUpdates: true });
                console.log("Runner Bot is listening...");
            } catch (err) {
                if (err.response && err.response.error_code === 409) {
                    console.log("Conflict detected, retrying bot launch in 5s...");
                    await new Promise(r => setTimeout(r, 5000));
                    return startBot();
                }
                throw err;
            }
        }
        await startBot();

    } catch (error) {
        console.error("Runner Error:", error);
        try {
            await bot.telegram.sendMessage(groupId, `🚨 *Runner Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        } catch (e) {}
        process.exit(1);
    }
}

run();
