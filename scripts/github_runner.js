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
 * Premium UI Helper: Animated Loading State
 */
async function runWithLoading(ctx, taskName, taskFn) {
    const statusMsg = await ctx.replyWithMarkdown(`? *GHOST meet:* ${taskName}... ??`);
    const interval = setInterval(async () => {
        try {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `? *GHOST meet:* ${taskName}... ?`, { parse_mode: 'Markdown' });
            setTimeout(() => {
                ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `? *GHOST meet:* ${taskName}... ??`, { parse_mode: 'Markdown' }).catch(() => {});
            }, 1000);
        } catch (e) {}
    }, 2000);

    try {
        const result = await taskFn();
        clearInterval(interval);
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        return result;
    } catch (err) {
        clearInterval(interval);
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `? *Task Failed:* ${taskName}\n${err.message}`, { parse_mode: 'Markdown' });
        throw err;
    }
}

/**
 * Helper to show progress bar in Telegram
 */
function getProgressBar(percent) {
    const total = 10;
    const progress = Math.round((percent / 100) * total);
    const remaining = total - progress;
    return `[${"?".repeat(progress)}${"?".repeat(remaining)}] ${percent}%`;
}

/**
 * Register all bot commands
 */
function registerCommands() {
    bot.command('view', async (ctx) => {
        try {
            await runWithLoading(ctx, "Capturing View", async () => {
                const screenshotPath = await browserManager.takeScreenshot();
                await ctx.replyWithPhoto({ source: screenshotPath }, { caption: "? *Current Meeting View*" , parse_mode: 'Markdown' });
            });
        } catch (err) {
            console.error("View error", err);
        }
    });

    bot.command('record', async (ctx) => {
        if (isRecording) return;

        try {
            await recorder.startRecording();
            isRecording = true;
            await startHeartbeat(ctx);
        } catch (err) {
            console.error("Record error", err);
        }
    });

    bot.command('stop', async (ctx) => {
        if (!isRecording) return;

        stopHeartbeat();

        try {
            isRecording = false;

            // Phase 2: Processing
            const finalizingUI = ui.generatePlayerUI({ status: 'FINALIZING', progress: 20 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, finalizingUI.text, { parse_mode: 'Markdown' });

            const assets = await recorder.stopRecording();

            // Check if assets were actually generated
            if (!assets || (!assets.videoChunks.length && !assets.transcriptPath)) {
                throw new Error("Recording finalized but no assets were generated. Check FFmpeg/Audio logs.");
            }

            // Phase 3: Uploading
            const uploadingUI = ui.generatePlayerUI({ status: 'FINALIZING', progress: 80 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, uploadingUI.text, { parse_mode: 'Markdown' });

            for (let i = 0; i < assets.videoChunks.length; i++) {
                await ctx.replyWithVideo({ source: assets.videoChunks[i] }, { caption: `📽 Part ${i+1}` });
            }

            if (assets.audioPath) {
                await ctx.replyWithAudio({ source: assets.audioPath }, { caption: "🎙 Meeting Audio Recording" });
            }

            if (assets.transcriptPath) {
                await ctx.replyWithDocument({ source: assets.transcriptPath }, { caption: "📄 *AI Meeting Transcript*", parse_mode: 'Markdown' });
            }

            const completedUI = ui.generatePlayerUI({ status: 'COMPLETED', progress: 100, partCount: assets.videoChunks.length });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, completedUI.text, { parse_mode: 'Markdown' });

            // CLOSE BROWSER BEFORE EXIT
            try {
                console.log("Cleaning up browser session...");
                await browserManager.closeBrowser();
            } catch (e) {
                console.error("Cleanup error:", e.message);
            }

            setTimeout(() => {
                console.log("Runner complete. Exiting.");
                process.exit(0);
            }, 5000);

        } catch (err) {
            logger.error(`Stop Error: ${err.message}`);
            process.exit(1);
        }
    });

    // Handle Inline Button Clicks - DIRECT HANDLERS
    bot.action('cmd_record', async (ctx) => {
        if (isRecording) return ctx.answerCbQuery("⚠️ Already Recording");
        await ctx.answerCbQuery("⚡ Booting Capture Engine...");

        try {
            // Instant Loading UI
            const startingUI = ui.generatePlayerUI({ status: 'STARTING', dashboardUrl: currentDashboardUrl });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, startingUI.text, { parse_mode: 'Markdown', ...startingUI.markup });

            await recorder.startRecording();
            isRecording = true;
            await startHeartbeat(ctx);
        } catch (err) {
            console.error("Record error", err);
            await ctx.reply(`❌ Engine Error: ${err.message}`);
        }
    });

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

            // CRITICAL: Even if isRecording is locally false, we check if browser is active
            // This ensures the runner handles the stop even if state is slightly out of sync
            isRecording = false;
            stopHeartbeat();

            const stoppingUI = ui.generatePlayerUI({ status: 'STOPPING', progress: 10 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, stoppingUI.text, {
                parse_mode: 'Markdown', ...stoppingUI.markup
            });

            console.log("Runner: Triggering recorder.stopRecording()...");
            const assets = await recorder.stopRecording();

            if (!assets || (assets.videoChunks.length === 0 && !assets.transcriptPath)) {
                console.log("Runner: No assets generated or files not ready.");
                return;
            }

            const uploadingUI = ui.generatePlayerUI({ status: 'FINALIZING', progress: 50 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, uploadingUI.text, { parse_mode: 'Markdown' });

            for (let i = 0; i < assets.videoChunks.length; i++) {
                await ctx.replyWithVideo({ source: assets.videoChunks[i] }, { caption: `📽 Part ${i+1}` });
            }

            if (assets.audioPath) {
                await ctx.replyWithAudio({ source: assets.audioPath }, { caption: "🎙 Meeting Audio Recording" });
            }

            if (assets.transcriptPath) {
                await ctx.replyWithDocument({ source: assets.transcriptPath }, { caption: "📄 AI Meeting Transcript" });
            }

            const completedUI = ui.generatePlayerUI({ status: 'COMPLETED', progress: 100 });
            await ctx.telegram.editMessageText(chatId, playerMessageId, null, completedUI.text, { parse_mode: 'Markdown' });

            console.log("Runner: Sequence Complete. Exiting...");
            setTimeout(() => process.exit(0), 3000);
        } catch (err) {
            console.error("Runner Callback Stop Error:", err.message);
        }
    });
}

async function run() {
    try {
        // Mask sensitive meeting URL in logs
        const maskedUrl = meetingUrl ? meetingUrl.replace(/meet\.google\.com\/[a-z0-9-]+/i, 'meet.google.com/****-****-****') : 'HIDDEN';
        console.log(`🚀 Starting GitHub Runner for target: ${maskedUrl}`);

        // 1. Register Commands & Actions FIRST
        registerCommands();

        // 2. IMMEDIATE WEBHOOK LOCK: Force Render bot silence first
        async function forceWebhookLock() {
            try {
                console.log("Applying Webhook Lock to silence Render bot...");
                await bot.telegram.setWebhook(`https://google.com/lock-${Date.now()}`);
                await new Promise(r => setTimeout(r, 2000));
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                console.log(`Webhook Lock Error: ${e.message}`);
            }
        }
        await forceWebhookLock();

        // 3. Start Polling BEFORE long-running async tasks
        const botPromise = bot.launch({
            dropPendingUpdates: true,
            polling: {
                timeout: 30,
                limit: 100
            }
        }).then(() => console.log("Runner Bot Polling Active.")).catch(err => {
            if (err.response && err.response.error_code === 409) {
                console.log("Conflict detected, retrying...");
            } else {
                throw err;
            }
        });

        // 4. Update UI to CONNECTING
        const connectingUI = ui.generatePlayerUI({ status: 'CONNECTING', meetingUrl });
        await bot.telegram.editMessageText(chatId, playerMessageId, null, connectingUI.text, {
            parse_mode: 'Markdown', ...connectingUI.markup
        });

        // 5. Launch Browser
        const tunnel = await browserManager.launchMeeting(meetingUrl);
        currentDashboardUrl = tunnel.url;

        // 6. Update Player UI to READY
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
