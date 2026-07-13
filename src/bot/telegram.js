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
    handoffActive: false
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
}

let isPolling = false;

async function startEngine(dropUpdates = false) {
    if (sessionState.handoffActive) {
        console.log("🚫 [ENGINE] Polling blocked: Handoff is active.");
        return;
    }

    try {
        if (isPolling) {
            console.log("🔄 [ENGINE] Stopping previous instance...");
            await bot.stop();
            isPolling = false;
        }

        console.log("🚀 [ENGINE] Starting polling...");
        await bot.launch({ dropPendingUpdates: dropUpdates });
        isPolling = true;
        console.log("✅ [ENGINE] GHOST meet is ACTIVE.");
    } catch (err) {
        if (err.message.includes('409')) {
            console.log("⚠️ [CONFLICT] Another instance is running. Handoff might be in progress.");
            isPolling = false;
        } else {
            console.error("❌ [ERROR] Engine Crash:", err.message);
            isPolling = false;
        }

        if (!sessionState.handoffActive) {
            console.log("🛠 [RECOVERY] Retrying engine start in 15s...");
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
            "Hello! I am your AI Meeting Assistant. I can join meetings, record them in high quality, and generate AI transcripts.\n\n" +
            "📜 *Available Commands:*\n" +
            "• `/start <link>` - Wake up bot and join a meeting.\n" +
            "• `/status` - Check engine health and duration.\n" +
            "• `/reset` - Perform a system hard reset.\n\n" +
            "💡 *Tip:* You can also start by simply sending a meeting link.";
        return ctx.replyWithMarkdown(introText);
    });

    bot.command('reset', async (ctx) => {
        sessionState.handoffActive = false;
        resetSessionState();
        await startEngine(false);
        return ctx.replyWithMarkdown("🔄 *Hard Reset Successful*");
    });

    bot.command('status', (ctx) => {
        const recordingStatus = sessionState.isRecording ? "🔴 ACTIVE" : "⚪ IDLE";
        const joinStatus = sessionState.isJoined ? "✅ CONNECTED" : "❌ DISCONNECTED";
        ctx.replyWithMarkdown(`📟 *DIAGNOSTICS*\n━━━━━━━━━━━━━━━━━━━━━━\n• Engine: Online\n• Session: ${joinStatus}\n• Recording: ${recordingStatus}`);
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
