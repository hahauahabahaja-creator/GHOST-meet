const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const express = require('express');
const path = require('path');
const browserManager = require('../core/browser');
const recorder = require('../core/recorder');
const github = require('../utils/github');
const logger = require('../utils/logger');
const ui = require('../utils/ui');

dotenv.config();

const INSTANCE_ID = Math.random().toString(36).substring(2, 8).toUpperCase();
const startTime = Date.now();

let bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

let sessionState = {
    isJoined: false,
    isRecording: false,
    currentUrl: null,
    currentChatId: null,
    playerMessageId: null,
    recordingStartTime: null,
    timerInterval: null,
    isProcessing: false,
    handoffActive: false,
    cleanupQueue: []
};

function resetSessionState() {
    console.log("🛠 [SYSTEM] Resetting all states...");
    sessionState.isJoined = false;
    sessionState.isRecording = false;
    sessionState.isProcessing = false;
    sessionState.handoffActive = false;
    sessionState.currentUrl = null;
    sessionState.playerMessageId = null;
    sessionState.recordingStartTime = null;
    if (sessionState.timerInterval) {
        clearInterval(sessionState.timerInterval);
        sessionState.timerInterval = null;
    }
    sessionState.cleanupQueue = [];
}

let isPolling = false;

async function startEngine(dropUpdates = false) {
    if (sessionState.handoffActive) {
        console.log(`🚫 [${INSTANCE_ID}] Polling blocked: Handoff is active.`);
        return;
    }

    try {
        if (isPolling) {
            console.log(`🔄 [${INSTANCE_ID}] Stopping previous instance...`);
            await bot.stop();
            isPolling = false;
        }

        console.log(`🚀 [${INSTANCE_ID}] Starting polling...`);
        await bot.launch({ dropPendingUpdates: dropUpdates });
        isPolling = true;
        console.log(`✅ [${INSTANCE_ID}] GHOST meet is ACTIVE.`);
    } catch (err) {
        if (err.message.includes('409')) {
            console.log(`⚠️ [${INSTANCE_ID}] CONFLICT: Another instance is running.`);
            isPolling = false;
        } else {
            console.error(`❌ [${INSTANCE_ID}] Engine Crash:`, err.message);
            isPolling = false;
        }

        if (!sessionState.handoffActive && !isPolling) {
            console.log(`🛠 [${INSTANCE_ID}] Retrying engine start in 15s...`);
            setTimeout(() => startEngine(false), 15000);
        }
    }
}

async function stopEngine() {
    console.log("💤 [ENGINE] Stopping polling for handoff...");
    isPolling = false;
    try {
        await bot.stop();
        console.log("✅ [ENGINE] Polling stopped successfully.");
    } catch (e) {
        console.log("⚠️ [ENGINE] Error during stop (possibly already stopped):", e.message);
    }
}

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/resume', async (req, res) => {
    console.log("🔔 [SIGNAL] Resume signal received.");
    sessionState.handoffActive = false;
    resetSessionState();

    // Give the runner time to die before starting
    setTimeout(async () => {
        console.log("🛠 [SYSTEM] Attempting to resume polling...");
        await startEngine(false); // Drop updates that might have been handled by runner
    }, 5000);

    res.send('Engine Resume Initiated');
});

app.get('/', (req, res) => res.send('GHOST Engine Active!'));
app.listen(PORT, '0.0.0.0', () => console.log(`📡 [SERVER] Monitoring port ${PORT}`));

function registerHandlers() {
    bot.command('start', async (ctx) => {
        if (sessionState.handoffActive) return;
        resetSessionState();
        const parts = ctx.message.text.split(' ');
        if (parts.length > 1) return handleJoin(ctx, parts[1]);

        await startEngine(false);
        const introText =
            "🛰 *GHOST meet | Stealth Engine v2.0*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "Welcome, Operator. I am your high-performance AI Meeting Assistant, specialized in stealth capture, high-fidelity recording, and multi-language transcription.\n\n" +
            "🛡 *Core Capabilities:*\n" +
            "• *Stealth Entry:* Joins meetings without being detected.\n" +
            "• *HD Capture:* Records 720p/1080p video with internal audio.\n" +
            "• *AI Transcription:* Generates precise Hinglish transcripts.\n" +
            "• *Auto-Handoff:* Scalable cloud architecture for 24/7 uptime.\n\n" +
            "📜 *System Commands:*\n" +
            "• /start - Initialize the engine.\n" +
            "• /status - Check system health & diagnostics.\n" +
            "• /help - View detailed usage guide.\n" +
            "• /reset - Force a hard system reboot.\n\n" +
            "💡 *Tip:* Simply send a Google Meet or Zoom link to begin.";
        const msg = await ctx.replyWithMarkdown(introText);
        sessionState.cleanupQueue.push(msg.message_id);
        return;
    });

    bot.command('help', async (ctx) => {
        const helpText =
            "📖 *GHOST meet | Operation Manual*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "1️⃣ *Initiation:* Send a valid meeting link (Google Meet, Zoom, Teams).\n" +
            "2️⃣ *Deployment:* I will deploy a stealth runner to join the meeting.\n" +
            "3️⃣ *Control:* Use the Live Dashboard link provided to control the browser.\n" +
            "4️⃣ *Finalization:* Use the 🛑 STOP button in the player to save the recording.\n\n" +
            "🛠 *Maintenance Commands:*\n" +
            "• /status - Check if the engine is busy or idle.\n" +
            "• /reset - Emergency Hard Reset. Use this if the bot is stuck or not responding.\n\n" +
            "⚠️ *Note:* Only one session can be active at a time.";
        const msg = await ctx.replyWithMarkdown(helpText);
        sessionState.cleanupQueue.push(msg.message_id);
        return;
    });

    bot.command('reset', async (ctx) => {
        sessionState.handoffActive = false;
        resetSessionState();
        await startEngine(false);
        return ctx.replyWithMarkdown("🔄 *Hard Reset Successful*");
    });

    bot.command('status', (ctx) => {
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const secs = uptime % 60;
        const uptimeStr = `${hours}h ${mins}m ${secs}s`;

        const recordingStatus = sessionState.isRecording ? "🔴 RECORDING ACTIVE" : "⚪ IDLE / READY";
        const joinStatus = sessionState.isJoined ? "✅ CONNECTED" : "❌ DISCONNECTED";
        const engineStatus = isPolling ? "⚡ CORE ONLINE" : "💤 STANDBY";

        const statusMsg =
            `📟 *GHOST | SYSTEM DIAGNOSTICS*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 *Instance:* \`${INSTANCE_ID}\`\n` +
            `⏱ *Uptime:* \`${uptimeStr}\`\n` +
            `📡 *Engine:* ${engineStatus}\n` +
            `🔗 *Session:* ${joinStatus}\n` +
            `⏺ *Capture:* ${recordingStatus}\n` +
            `🔄 *Handoff:* ${sessionState.handoffActive ? "🟠 ACTIVE" : "🟢 INACTIVE"}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✨ *System is running optimally.*`;

        ctx.replyWithMarkdown(statusMsg);
    });

    bot.on('text', async (ctx, next) => {
        if (sessionState.handoffActive) return;
        const text = ctx.message.text;
        if (text.startsWith('/')) return next();

        const meetingPattern = /(meet\.google\.com\/[a-z0-9-]+)|(zoom\.us\/j\/[0-9]+)|(webex\.com\/[a-z0-9-]+)|(teams\.microsoft\.com\/[a-z0-9-]+)/i;
        if (meetingPattern.test(text)) {
            let meetingUrl = text.match(/https?:\/\/[^\s]+/)?.[0] || text;
            if (!meetingUrl.startsWith('http')) meetingUrl = `https://${meetingUrl}`;
            return handleJoin(ctx, meetingUrl);
        }
        return next();
    });

    bot.action('cmd_record', async (ctx) => {
        try {
            await ctx.answerCbQuery("🔴 Initiating...");
            if (sessionState.isRecording) return;
            sessionState.isRecording = true;
            sessionState.recordingStartTime = Date.now();
            await recorder.startRecording();
            sessionState.timerInterval = setInterval(async () => {
                const updatedUI = ui.generatePlayerUI({ status: 'RECORDING', meetingUrl: sessionState.currentUrl });
                if (sessionState.playerMessageId) await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, undefined, updatedUI.text, { parse_mode: 'Markdown', ...updatedUI.markup }).catch(() => {});
            }, 8000);
        } catch (e) {}
    });

    bot.action('cmd_stop', async (ctx) => {
        try {
            await ctx.answerCbQuery("💾 Finalizing...");
            const stoppingUI = ui.generatePlayerUI({ status: 'STOPPING', meetingUrl: sessionState.currentUrl });
            if (sessionState.playerMessageId) await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, stoppingUI.text, { parse_mode: 'Markdown', ...stoppingUI.markup }).catch(() => {});
            if (sessionState.timerInterval) { clearInterval(sessionState.timerInterval); sessionState.timerInterval = null; }

            if (process.env.RENDER) {
                sessionState.isRecording = false;
                sessionState.isJoined = false;
                return;
            }

            sessionState.isRecording = false;
            const assets = await recorder.stopRecording();
            if (!assets) return;

            for (let i = 0; i < assets.videoChunks.length; i++) await ctx.telegram.sendVideo(ctx.chat.id, { source: assets.videoChunks[i] }, { caption: `📽 Part ${i + 1}` });
            if (assets.transcriptPath) await ctx.telegram.sendDocument(ctx.chat.id, { source: assets.transcriptPath }, { caption: "📄 AI Transcript" });
            resetSessionState();
        } catch (e) {}
    });

    bot.action('cmd_screenshot', async (ctx) => {
        try {
            await ctx.answerCbQuery("📸 Capturing...");
            const screenshotPath = await browserManager.takeScreenshot();
            if (screenshotPath) await ctx.replyWithPhoto({ source: screenshotPath }, { caption: "🖼 *LIVE PREVIEW*", parse_mode: 'Markdown' });
        } catch (e) {}
    });

    bot.action('cmd_cancel', async (ctx) => {
        try {
            await ctx.answerCbQuery("❌ Cancelling...");

            // Cleanup current session UI
            if (sessionState.playerMessageId) {
                await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, "🛑 *Deployment Terminated.* Engine returned to standby.", { parse_mode: 'Markdown' }).catch(() => {});
            }

            resetSessionState();
            sessionState.handoffActive = false; // Force unlock

            await startEngine(true); // Restart and drop pending updates
        } catch (e) {
            console.error("Cancel Action Error:", e.message);
        }
    });
}

async function handleJoin(ctx, meetingUrl) {
    if (sessionState.isProcessing || sessionState.handoffActive) {
        console.log("⚠️ [JOIN] Blocked: Process already running or handoff active.");
        return;
    }

    // Double check with GitHub before triggering
    const isRunning = await github.isWorkflowRunning();
    if (isRunning) {
        return ctx.replyWithMarkdown("⚠️ *Busy:* Another session is active. Please wait.");
    }

    sessionState.isProcessing = true;
    sessionState.handoffActive = true; // Lock immediately to prevent double trigger
    sessionState.currentUrl = meetingUrl;
    sessionState.currentChatId = ctx.chat.id;
    sessionState.isJoined = true;

    // Cleanup old intro/help messages
    for (const msgId of sessionState.cleanupQueue) {
        await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
    }
    sessionState.cleanupQueue = [];

    console.log(`🚀 [JOIN] Triggering workflow for: ${meetingUrl}`);

    const player = ui.generatePlayerUI({ status: 'INITIALIZING', meetingUrl });
    const msg = await ctx.replyWithMarkdown(player.text, player.markup);
    sessionState.playerMessageId = msg.message_id;

    if (process.env.RENDER) {
        try {
            await github.triggerRunner(meetingUrl, sessionState.playerMessageId, ctx.chat.id.toString());
            const dispatchedUI = ui.generatePlayerUI({ status: 'DEPLOYING', meetingUrl });
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, dispatchedUI.text, { parse_mode: 'Markdown', ...dispatchedUI.markup });

            sessionState.handoffActive = true;

            // Critical: Stop engine IMMEDIATELY after triggering runner to avoid 409
            console.log("🔄 [SYSTEM] Runner triggered. Relinquishing bot session...");
            setTimeout(async () => {
                await stopEngine();
                sessionState.isProcessing = false;
            }, 2000);

            setTimeout(() => {
                if (sessionState.handoffActive) {
                    console.log("⏰ [SYSTEM] Handoff safety timeout. Re-enabling Engine.");
                    sessionState.handoffActive = false;
                    startEngine(false);
                }
            }, 6 * 60 * 60 * 1000);
        } catch (error) {
            resetSessionState();
            const errorUI = ui.generatePlayerUI({ status: 'ERROR', meetingUrl });
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, errorUI.text + `\n\n🚨 *Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        }
    }
}

registerHandlers();
startEngine(false);

setInterval(() => {
    if (!isPolling && !sessionState.handoffActive) {
        console.log("🛠 [WATCHDOG] Engine is offline and no handoff. Restarting...");
        startEngine(false);
    }
}, 20000);
