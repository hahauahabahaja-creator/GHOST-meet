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

        // We stay alive to listen for recording commands
        // In a GitHub Actions environment, we need to keep the process running
        // to handle the /record and /stop commands which will be received by the Render bot
        // and passed here, or the Render bot could signal this process via some IPC/API.

        // However, to keep it simple and robust, this runner will wait for a specific
        // trigger or just stay active.
        // For the current implementation, we'll keep the process alive while it waits.

        console.log("Runner is waiting for commands...");

        // Keep the script running to maintain the browser session
        // Command handling logic (record/stop) will be triggered via the main bot
        // This script serves as the host for the visual session.

    } catch (error) {
        console.error("Runner Error:", error);
        await bot.telegram.sendMessage(groupId, `🚨 *Runner Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        process.exit(1);
    }
}

run();
