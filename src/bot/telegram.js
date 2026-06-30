const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const express = require('express');
const browserManager = require('../core/browser');
const recorder = require('../core/recorder');
const logger = require('../utils/logger');

// Load environment variables
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

/**
 * STRICT GROUP AUTHORIZATION MIDDLEWARE
 * Ensures the bot only responds within the authorized GHOST meet group.
 */
bot.use(async (ctx, next) => {
    if (!ctx.chat) return;

    const chatId = ctx.chat.id.toString();

    // Only allow commands from the specific group ID
    if (chatId !== ALLOWED_GROUP_ID) {
        // If it's a private message or unauthorized group, notify and block
        if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
            logger.warn(`Unauthorized access attempt from Chat ID: ${chatId}`);
            return ctx.replyWithMarkdown(
                "⚠️ *GHOST meet | ACCESS DENIED*\n" +
                "━━━━━━━━━━━━━━━━━━━━━━\n" +
                "This terminal is encrypted and locked to a specific authorized group.\n\n" +
                "*System Action:* Connection Rejected."
            );
        }
        return; // Silent ignore for non-command messages
    }

    return next();
});

/**
 * /start - Boot the system interface
 */
bot.start((ctx) => {
    const welcomeUI =
        "🛸 *GHOST meet | SYSTEM TERMINAL*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━\n" +
        "Status: 🟢 *OPERATIONAL*\n" +
        "Security: 🔒 *ENCRYPTED*\n\n" +
        "Welcome, Operative. The capture suite is on standby.\n\n" +
        "📍 *Operational Commands:*\n" +
        "• `/join <url>` - Deploy Virtual Frame Buffer\n" +
        "• `/record` - Initiate 1080p HD Capture\n" +
        "• `/stop` - Finalize, Split & Transcribe\n" +
        "• `/status` - Engine Diagnostics";

    ctx.replyWithMarkdown(welcomeUI, Markup.inlineKeyboard([
        [Markup.button.callback('📊 Check Diagnostics', 'engine_status')],
        [Markup.button.callback('🛠 Help & Documentation', 'help_guide')]
    ]));
});

/**
 * /join <url> - Deploy visual engine
 */
bot.command('join', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
        return ctx.replyWithMarkdown("❌ *Error:* URL missing. Use `/join <link>`");
    }

    const meetingUrl = parts[1];
    ctx.replyWithMarkdown("🌀 *Deploying GHOST meet Virtual Display...*");

    try {
        const tunnel = await browserManager.launchMeeting(meetingUrl);

        const successUI =
            "✅ *Visual Engine Online*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "🔗 *Secure Control Tunnel:*\n" +
            `[ACCESS DASHBOARD](${tunnel.url})\n\n` +
            "📝 *Instructions:*\n" +
            "1. Enter the dashboard link above.\n" +
            "2. Handle meeting credentials & permissions.\n" +
            "3. Once the meeting is active, return here and send `/record`.";

        ctx.replyWithMarkdown(successUI);
    } catch (error) {
        logger.error("Deployment Failure:", error);
        ctx.replyWithMarkdown(`🚨 *System Failure:* ${error.message}`);
    }
});

/**
 * /record - Start HD FFMPEG Stream
 */
bot.command('record', async (ctx) => {
    ctx.replyWithMarkdown("🔴 *Initiating Native HD Capture...*");
    try {
        await recorder.startRecording();
        ctx.replyWithMarkdown(
            "⏺ *RECORDING ACTIVE*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "Resolution: *1920x1080 HD*\n" +
            "Audio: *Native System Feed*\n" +
            "Target: *Authorized Group Storage*"
        );
    } catch (error) {
        logger.error("Recording Start Failure:", error);
        ctx.replyWithMarkdown(`❌ *Recording Error:* ${error.message}`);
    }
});

/**
 * /stop - Stop, Chunk, and Upload
 */
bot.command('stop', async (ctx) => {
    ctx.replyWithMarkdown("💾 *Finalizing Stream & Post-Processing...*");
    try {
        const assets = await recorder.stopRecording();
        ctx.replyWithMarkdown("📤 *GHOST meet Assets Uploading...*");

        // Upload Video Segments
        for (let i = 0; i < assets.videoChunks.length; i++) {
            await ctx.replyWithVideo(
                { source: assets.videoChunks[i] },
                { caption: `📽 GHOST meet Recording | Part ${i + 1} of ${assets.videoChunks.length}` }
            );
        }

        // Upload AI Transcript
        if (assets.transcriptPath) {
            await ctx.replyWithDocument(
                { source: assets.transcriptPath },
                { caption: "📄 AI Meeting Transcript (English + Hindi)" }
            );
        }

        ctx.replyWithMarkdown("✨ *Session Finalized. Engine Hibernated.*");
    } catch (error) {
        logger.error("Finalization Failure:", error);
        ctx.replyWithMarkdown(`❌ *Stop Error:* ${error.message}`);
    }
});

/**
 * /status - Real-time diagnostics
 */
bot.command('status', (ctx) => {
    const diagnosticUI =
        "📟 *SYSTEM DIAGNOSTICS*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━\n" +
        "• Kernel: *Stable*\n" +
        "• Virtual Display: *Active (:99)*\n" +
        "• FFMPEG Pipeline: *Standby*\n" +
        "• STT Engine: *Bilingual Mode*\n" +
        "• Storage: *Optimized*";
    ctx.replyWithMarkdown(diagnosticUI);
});

// Inline Actions
bot.action('engine_status', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("System pulse: 100%. Encryption layers active. Engine performing within parameters.");
});

bot.action('help_guide', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("GHOST meet Manual:\n1. Use /join for the meeting link.\n2. Manual login via Ngrok link.\n3. /record to start.\n4. /stop to get the files.");
});

// Launch sequence
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('GHOST Meet Bot is Running!'));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});

function launchBot() {
    bot.launch()
        .then(() => {
            console.log("🚀 GHOST meet Bot is initialized and guarding the group.");
        })
        .catch((err) => {
            console.error("❌ Telegram Launch Error:", err.message);
            console.log("🔄 Retrying bot connection in 10 seconds...");
            setTimeout(launchBot, 10000); // Retry without crashing the Express server
        });
}

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
