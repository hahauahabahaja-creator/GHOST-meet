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

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

const sessionState = {
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
let shouldPoll = true;

async function launchBot(dropUpdates = true) {
    if (!shouldPoll) return;

    try {
        if (isPolling) {
            bot.stop();
            isPolling = false;
        }

        await bot.launch({ dropPendingUpdates: dropUpdates });
        isPolling = true;
        console.log(`🚀 GHOST meet Bot is active (DropUpdates: ${dropUpdates})`);
    } catch (err) {
        if (shouldPoll) {
            console.error("❌ Telegram Launch Error:", err.message);
            isPolling = false;
            setTimeout(() => launchBot(dropUpdates), 10000);
        }
    }
}

function stopBot() {
    shouldPoll = false;
    bot.stop();
    isPolling = false;
    console.log("💤 Bot is now in STRICT SLEEP mode.");
}

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/resume', (req, res) => {
    console.log("🔔 Wake up signal received from Runner.");
    shouldPoll = true;
    resetSessionState();
    launchBot(false);
    res.send('Bot Resumed');
});

app.get('/', (req, res) => res.send('GHOST Meet Bot is Running!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server is listening on port ${PORT}`));

bot.command('start', async (ctx) => {
    if (sessionState.isProcessing) return;

    const parts = ctx.message.text.split(' ');
    shouldPoll = true;
    resetSessionState();

    if (parts.length > 1) {
        const meetingUrl = parts[1];
        return handleJoin(ctx, meetingUrl);
    }

    await launchBot(false);

    const introText =
        "🛰 *GHOST meet | Stealth Engine v2.0*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━\n" +
        "Hello! I am your AI Meeting Assistant. I can join meetings, record them in high quality, and generate AI transcripts.\n\n" +
        "📜 *Available Commands:*\n" +
        "• `/start <link>` - Wake up bot and join a meeting.\n" +
        "• `/record` - Manually start meeting capture.\n" +
        "• `/stop` - Finalize, save, and upload assets.\n" +
        "• `/status` - Check engine health and duration.\n" +
        "• `/reset` - Perform a system hard reset.\n\n" +
        "💡 *Tip:* You can also start by simply sending a meeting link.";

    return ctx.replyWithMarkdown(introText);
});

bot.command('reset', async (ctx) => {
    resetSessionState();
    shouldPoll = true;
    await launchBot(false);
    return ctx.replyWithMarkdown("🔄 *Session Hard Reset Complete*");
});

bot.command('status', (ctx) => {
    const recordingStatus = sessionState.isRecording ? "🔴 ACTIVE" : "⚪ IDLE";
    const joinStatus = sessionState.isJoined ? "✅ CONNECTED" : "❌ DISCONNECTED";
    let duration = "0:00";
    if (sessionState.recordingStartTime) {
        const elapsed = Math.round((Date.now() - sessionState.recordingStartTime) / 1000);
        duration = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
    }
    ctx.replyWithMarkdown(`📟 *SYSTEM DIAGNOSTICS*\n━━━━━━━━━━━━━━━━━━━━━━\n• Session: ${joinStatus}\n• Recording: ${recordingStatus}\n• Duration: *${duration}*`);
});

bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();

    const meetingPattern = /(meet\.google\.com\/[a-z0-9-]+)|(zoom\.us\/j\/[0-9]+)|(webex\.com\/[a-z0-9-]+)|(teams\.microsoft\.com\/[a-z0-9-]+)/i;

    if (meetingPattern.test(text)) {
        let meetingUrl = text.match(/https?:\/\/[^\s]+/)?.[0] || text;
        if (!meetingUrl.startsWith('http')) {
            meetingUrl = `https://${meetingUrl}`;
        }
        return handleJoin(ctx, meetingUrl);
    }

    return next();
});

async function handleJoin(ctx, meetingUrl) {
    if (sessionState.isProcessing) return;

    if (sessionState.isJoined) {
        return ctx.replyWithMarkdown("⚠️ *Active Session Found:* Use the existing Player to /stop first.");
    }

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
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, dispatchedUI.text, {
                parse_mode: 'Markdown', ...dispatchedUI.markup
            });

            setTimeout(() => {
                console.log("Initiating Handoff: Stopping local bot polling...");
                stopBot();
            }, 5000);
        } catch (error) {
            sessionState.isJoined = false;
            sessionState.isProcessing = false;
            const errorUI = ui.generatePlayerUI({ status: 'ERROR', meetingUrl });
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, errorUI.text + `\n\n🚨 *Dispatch Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        }
        return;
    }
}

bot.action('cmd_record', async (ctx) => {
    try {
        await ctx.answerCbQuery("🔴 Initiating HD Capture...");
        if (sessionState.isRecording) return;
        sessionState.isRecording = true;
        sessionState.recordingStartTime = Date.now();
        await recorder.startRecording();
        let elapsedSeconds = 0;
        sessionState.timerInterval = setInterval(async () => {
            elapsedSeconds++;
            const timeStr = `${Math.floor(elapsedSeconds / 60)}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`;
            const updatedUI = ui.generatePlayerUI({ status: 'RECORDING', timer: timeStr, meetingUrl: sessionState.currentUrl });
            try {
                if (sessionState.playerMessageId) await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, undefined, updatedUI.text, { parse_mode: 'Markdown', ...updatedUI.markup });
            } catch (err) {}
        }, 8000);
    } catch (e) {}
});

bot.action('cmd_stop', async (ctx) => {
    try {
        await ctx.answerCbQuery("💾 Finalizing Session...");
        const stoppingUI = ui.generatePlayerUI({ status: 'STOPPING', meetingUrl: sessionState.currentUrl });
        if (sessionState.playerMessageId) await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, stoppingUI.text, { parse_mode: 'Markdown', ...stoppingUI.markup });
        if (sessionState.timerInterval) { clearInterval(sessionState.timerInterval); sessionState.timerInterval = null; }
        if (process.env.RENDER) { sessionState.isRecording = false; sessionState.isJoined = false; return; }
        sessionState.isRecording = false;
        const assets = await recorder.stopRecording();
        if (!assets || (assets.videoChunks.length === 0 && !assets.transcriptPath)) return;
        const processingUI = ui.generatePlayerUI({ status: 'FINALIZING', meetingUrl: sessionState.currentUrl });
        await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, processingUI.text, { parse_mode: 'Markdown' });
        for (let i = 0; i < assets.videoChunks.length; i++) await ctx.replyWithVideo({ source: assets.videoChunks[i] }, { caption: `📽 Part ${i + 1}` });
        if (assets.transcriptPath) await ctx.replyWithDocument({ source: assets.transcriptPath }, { caption: "📄 Transcript" });
        const completedUI = ui.generatePlayerUI({ status: 'COMPLETED' });
        await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, completedUI.text, { parse_mode: 'Markdown' });
        resetSessionState();
    } catch (e) {}
});

bot.action('cmd_screenshot', async (ctx) => {
    try {
        await ctx.answerCbQuery("📸 Capturing Live View...");
        const screenshotPath = await browserManager.takeScreenshot();
        if (screenshotPath) await ctx.replyWithPhoto({ source: screenshotPath }, { caption: "🖼 *LIVE PREVIEW*", parse_mode: 'Markdown' });
    } catch (e) {}
});

setInterval(() => {
    if (shouldPoll && !isPolling) launchBot(false);
}, 30000);

launchBot(true);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
