const { Telegraf } = require('telegraf');
const browserManager = require('../src/core/browser');
const recorder = require('../src/core/recorder');
const logger = require('../src/utils/logger');
const ui = require('../src/utils/ui');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let meetingUrl = process.env.MEETING_URL;
if (meetingUrl && !meetingUrl.startsWith('http')) {
    meetingUrl = `https://${meetingUrl}`;
}
const groupId = process.env.ALLOWED_GROUP_ID;

// Handoff data
const playerMessageId = process.env.PLAYER_MESSAGE_ID;
const chatId = process.env.CHAT_ID || groupId;

let isRecording = false;
let heartbeatInterval = null;
let recordingStartTime = null;
let currentDashboardUrl = null;

/**
 * Animated Heartbeat for Telegram
 */
async function startHeartbeat(ctx) {
    recordingStartTime = Date.now();
    heartbeatInterval = setInterval(async () => {
        if (!isRecording) {
            clearInterval(heartbeatInterval);
            return;
        }
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        const timeStr = `${mins}:${secs}`;

        const updatedUI = ui.generatePlayerUI({
            status: 'RECORDING',
            timer: timeStr,
            dashboardUrl: currentDashboardUrl
        });

        try {
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, updatedUI.text, {
                parse_mode: 'Markdown', ...updatedUI.markup
            });
        } catch (e) {
            if (e.description && e.description.includes("message is not modified")) return;
            console.error("Heartbeat update error:", e.message);
        }
    }, 5000); // 5s update
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// Use built-in chrome on GitHub
process.env.CHROME_PATH = '/usr/bin/google-chrome-stable';

/**
 * Register all bot commands
 */
function registerCommands() {
    bot.action('cmd_screenshot', async (ctx) => {
        try {
            await ctx.answerCbQuery("📸 Capturing Live View...");
            const screenshotPath = await browserManager.takeScreenshot();
            if (screenshotPath) {
                await ctx.telegram.sendPhoto(chatId, { source: screenshotPath }, {
                    caption: "🖼 *LIVE PREVIEW*\n━━━━━━━━━━━━━━━━━━━━━━\nCurrent meeting screen status.",
                    parse_mode: 'Markdown'
                });
            }
        } catch (e) {
            console.error("Screenshot action error:", e.message);
        }
    });

    bot.action('cmd_stop', async (ctx) => {
        console.log("Runner: Stop Action Received via Callback.");

        try {
            await ctx.answerCbQuery("💾 Finalizing Stream...");

            isRecording = false;
            stopHeartbeat();

            // Link recorder progress to Telegram UI
            recorder.setProgressCallback(async (status, progress) => {
                const updatedUI = ui.generatePlayerUI({ status, progress });
                await ctx.telegram.editMessageText(chatId, playerMessageId, null, updatedUI.text, {
                    parse_mode: 'Markdown', ...updatedUI.markup
                }).catch(() => {});
            });

            console.log("Runner: Triggering recorder.stopRecording()...");

            // Set a timeout for the entire stop process (15 minutes)
            const stopTimeout = setTimeout(() => {
                console.error("Runner: stopRecording timed out!");
                ctx.reply("⚠️ *Timeout:* Asset processing took too long.").catch(() => {});
            }, 15 * 60 * 1000);

            const assets = await recorder.stopRecording();
            clearTimeout(stopTimeout);

            if (!assets || (!assets.videoChunks?.length && !assets.transcriptPath)) {
                console.log("Runner: No assets generated.");
                const errorUI = ui.generatePlayerUI({ status: 'ERROR' });
                await ctx.telegram.editMessageText(chatId, playerMessageId, null, errorUI.text + "\n\n❌ No recording files found.", { parse_mode: 'Markdown' });
                return;
            }

            // FINALIZING UI for upload phase
            const uploadingUI = ui.generatePlayerUI({ status: 'FINALIZING', progress: 95 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, uploadingUI.text, { parse_mode: 'Markdown' });

            console.log("Runner: Starting media uploads...");

            for (let i = 0; i < assets.videoChunks.length; i++) {
                await ctx.replyWithVideo({ source: assets.videoChunks[i] }, {
                    caption: `📽 GHOST meet | Part ${i+1}`
                });
            }

            if (assets.audioPath) {
                await ctx.replyWithAudio({ source: assets.audioPath }, {
                    caption: "🎙 Meeting Audio Recording"
                });
            }

            if (assets.transcriptPath) {
                await ctx.replyWithDocument({ source: assets.transcriptPath }, {
                    caption: "📄 AI Meeting Transcript (Hinglish)"
                });
            }

            const completedUI = ui.generatePlayerUI({ status: 'COMPLETED', progress: 100 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, completedUI.text, { parse_mode: 'Markdown' });

            console.log("Runner: Sequence Complete. Cleaning up...");
            await browserManager.closeBrowser().catch(() => {});

            setTimeout(() => {
                console.log("Runner: Final Exit.");
                process.exit(0);
            }, 5000);
        } catch (err) {
            console.error("Runner Callback Stop Error:", err.message);
            await ctx.reply(`❌ *System Error during Finalization:* ${err.message}`).catch(() => {});
        }
    });
}

async function run() {
    try {
        console.log(`🚀 Starting GitHub Runner...`);
        registerCommands();

        // 2. IMMEDIATE WEBHOOK LOCK: Force Render bot silence first
        async function forceWebhookLock() {
            try {
                await bot.telegram.setWebhook(`https://google.com/lock-${Date.now()}`);
                await new Promise(r => setTimeout(r, 2000));
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                console.log(`Webhook Lock Error: ${e.message}`);
            }
        }
        await forceWebhookLock();

        // 3. Start Polling
        const botPromise = bot.launch({
            dropPendingUpdates: true,
            polling: { timeout: 30, limit: 100 }
        });

        const connectingUI = ui.generatePlayerUI({ status: 'CONNECTING', meetingUrl });
        await bot.telegram.editMessageText(chatId, playerMessageId, null, connectingUI.text, {
            parse_mode: 'Markdown', ...connectingUI.markup
        });

        const tunnel = await browserManager.launchMeeting(meetingUrl);
        currentDashboardUrl = tunnel.url;
        isRecording = true; // Auto-record for Runner usually, or wait for start

        const readyUI = ui.generatePlayerUI({ status: 'READY', dashboardUrl: tunnel.url });
        await bot.telegram.editMessageText(chatId, playerMessageId, null, readyUI.text, {
            parse_mode: 'Markdown', ...readyUI.markup
        });

        await botPromise;
    } catch (error) {
        console.error("Runner Error:", error);
        process.exit(1);
    }
}

run();