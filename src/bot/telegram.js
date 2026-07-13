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
    isProcessing: false
};

function resetSessionState() {
    console.log("🛠 [SYSTEM] Resetting all states...");
    sessionState.isJoined = false;
    sessionState.isRecording = false;
    sessionState.isProcessing = false;
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
    try {
        if (isPolling) {
            console.log("🔄 [ENGINE] Restarting Polling Instance...");
            await bot.stop();
        }

        await bot.launch({ dropPendingUpdates: dropUpdates });
        isPolling = true;
        console.log("✅ [ENGINE] GHOST meet is now ACTIVE 24/7.");
    } catch (err) {
        console.error("❌ [ERROR] Engine Crash:", err.message);
        isPolling = false;
        setTimeout(() => startEngine(false), 5000);
    }
}

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/resume', async (req, res) => {
    console.log("🔔 [SIGNAL] Forced Wakeup received.");
    resetSessionState();
    await startEngine(false);
    res.send('Engine Resumed');
});

app.get('/', (req, res) => res.send('GHOST Engine Active!'));
app.listen(PORT, '0.0.0.0', () => console.log(`📡 [SERVER] Monitoring port ${PORT}`));

function registerHandlers() {
    bot.command('start', async (ctx) => {
        resetSessionState();
        const parts = ctx.message.text.split(' ');
        if (parts.length > 1) return handleJoin(ctx, parts[1]);

        await startEngine(false);
        const introText =
            "🛰 *GHOST meet | Stealth Engine v2.0*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "Professional AI Assistant is online.\n\n" +
            "📜 *Commands:*\n" +
            "• `/start <link>` - Join meeting\n" +
            "• `/status` - Check health\n" +
            "• `/reset` - Force refresh\n\n" +
            "💡 *Tip:* Send link directly to start.";
        return ctx.replyWithMarkdown(introText);
    });

    bot.command('reset', async (ctx) => {
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
    if (sessionState.isProcessing) return;

    console.log(`🚀 [JOIN] Triggering Runner: ${meetingUrl}`);
    const isRunning = await github.isWorkflowRunning();
    if (isRunning) return ctx.replyWithMarkdown("⚠️ *Busy:* Another session is active. Please wait.");

    sessionState.isProcessing = true;
    sessionState.currentUrl = meetingUrl;
    sessionState.currentChatId = ctx.chat.id;
    sessionState.isJoined = true;

    const player = ui.generatePlayerUI({ status: 'INITIALIZING', meetingUrl });
    const msg = await ctx.replyWithMarkdown(player.text, player.markup);
    sessionState.playerMessageId = msg.message_id;

    if (process.env.RENDER) {
        try {
            await github.triggerRunner(meetingUrl, sessionState.playerMessageId, ctx.chat.id.toString());
            const dispatchedUI = ui.generatePlayerUI({ status: 'DEPLOYING', meetingUrl });
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, dispatchedUI.text, { parse_mode: 'Markdown', ...dispatchedUI.markup });

            setTimeout(() => {
                console.log("💤 [POLLING] Pausing for Runner...");
                bot.stop();
                isPolling = false;
                sessionState.isProcessing = false;
            }, 5000);

            setTimeout(() => {
                if (!isPolling) {
                    console.log("⏰ [SYSTEM] Safety Wakeup triggered.");
                    startEngine(false);
                }
            }, 5 * 60 * 1000);
        } catch (error) {
            resetSessionState();
            const errorUI = ui.generatePlayerUI({ status: 'ERROR', meetingUrl });
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, errorUI.text + `\n\n🚨 *Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        }
    }
}

registerHandlers();
startEngine(true);

setInterval(() => {
    if (!isPolling) {
        console.log("🛠 [WATCHDOG] Engine is offline. Restarting now...");
        startEngine(false);
    }
}, 10000);
