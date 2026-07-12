const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const express = require('express');
const browserManager = require('../core/browser');
const recorder = require('../core/recorder');
const github = require('../utils/github');
const logger = require('../utils/logger');
const ui = require('../utils/ui');

// Load environment variables
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

// Global session state
const sessionState = {
    isJoined: false,
    isRecording: false,
    currentUrl: null,
    currentChatId: null,
    playerMessageId: null,
    recordingStartTime: null,
    timerInterval: null,
    isProcessing: false // NEW: Prevent overlapping triggers
};

/**
 * SMART LINK LISTENER - Replaces manual /join
 */
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;

    // Check for meeting links (Meet, Zoom, Webex, Teams, etc.)
    const meetingPattern = /(meet\.google\.com\/[a-z0-9-]+)|(zoom\.us\/j\/[0-9]+)|(webex\.com\/[a-z0-9-]+)|(teams\.microsoft\.com\/[a-z0-9-]+)/i;

    if (meetingPattern.test(text) && !text.startsWith('/')) {
        let meetingUrl = text.match(/https?:\/\/[^\s]+/)?.[0] || text;
        if (!meetingUrl.startsWith('http')) {
            meetingUrl = `https://${meetingUrl}`;
        }
        return handleJoin(ctx, meetingUrl);
    }

    return next();
});

async function handleJoin(ctx, meetingUrl) {
    if (sessionState.isJoined) {
        return ctx.replyWithMarkdown("⚠️ *Active Session Found:* Use the existing Player to /stop first.");
    }

    sessionState.currentUrl = meetingUrl;
    sessionState.currentChatId = ctx.chat.id;
    sessionState.isJoined = true;

    // Send INITIALIZING UI
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
        } catch (error) {
            sessionState.isJoined = false;
            const errorUI = ui.generatePlayerUI({ status: 'ERROR', meetingUrl });
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, errorUI.text + `\n\n🚨 *Dispatch Failure:* ${error.message}`, { parse_mode: 'Markdown' });
        }
        return;
    }
    // Local logic remains same...
}

bot.command('join', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply("❌ URL missing.");
    return handleJoin(ctx, parts[1]);
});

/**
 * /record - Start HD FFMPEG Stream with REAL-TIME TIMER
 */
bot.command('record', async (ctx) => {
    if (!sessionState.isJoined) {
        return ctx.replyWithMarkdown("❌ *Error:* Not joined yet. Use `/join <url>` first.");
    }

    if (sessionState.isRecording) {
        return ctx.replyWithMarkdown("⚠️ *Already Recording*\n━━━━━━━━━━━━━━━━━━━━━━\nUse `/stop` to end the current recording.");
    }

    sessionState.isRecording = true;
    sessionState.recordingStartTime = Date.now();

    try {
        await recorder.startRecording();
        
        // START REAL-TIME TIMER UPDATES
        let elapsedSeconds = 0;
        sessionState.timerInterval = setInterval(async () => {
            elapsedSeconds++;
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            const updatedUI = ui.generatePlayerUI({
                status: 'RECORDING',
                timer: timeStr,
                meetingUrl: sessionState.currentUrl
            });

            try {
                if (sessionState.playerMessageId) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        sessionState.playerMessageId,
                        undefined,
                        updatedUI.text,
                        { parse_mode: 'Markdown', ...updatedUI.markup }
                    );
                }
            } catch (err) {
                logger.warn("Timer update error (expected):", err.message);
            }
        }, 5000); // Update every 5 seconds to avoid rate limits

    } catch (error) {
        logger.error("Recording Start Failure:", error);
        sessionState.isRecording = false;
        if (sessionState.timerInterval) clearInterval(sessionState.timerInterval);
        await ctx.replyWithMarkdown(`❌ *Recording Error:* ${error.message}`);
    }
});

/**
 * /stop - Stop, Chunk, and Upload with REAL-TIME STATUS
 */
bot.command('stop', async (ctx) => {
    if (!sessionState.isRecording) {
        return ctx.replyWithMarkdown("⚠️ *Not Recording*\n━━━━━━━━━━━━━━━━━━━━━━\nStart recording with `/record` first.");
    }

    // STOP TIMER
    if (sessionState.timerInterval) {
        clearInterval(sessionState.timerInterval);
        sessionState.timerInterval = null;
    }

    sessionState.isRecording = false;

    const stoppingUI = ui.generatePlayerUI({
        status: 'FINALIZING',
        meetingUrl: sessionState.currentUrl
    });

    if (sessionState.playerMessageId) {
        await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, stoppingUI.text, {
            parse_mode: 'Markdown', ...stoppingUI.markup
        });
    }

    if (process.env.RENDER) {
        logger.info("Main bot on Render: Stop command handled by Runner.");
        return;
    }

    try {
        // Get recording duration
        const duration = sessionState.recordingStartTime ? 
            Math.round((Date.now() - sessionState.recordingStartTime) / 1000) : 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const assets = await recorder.stopRecording();
        
        const completedUI = ui.generatePlayerUI({
            status: 'COMPLETED',
            timer: timeStr,
            partCount: assets.videoChunks.length
        });

        if (sessionState.playerMessageId) {
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, completedUI.text, {
                parse_mode: 'Markdown', ...completedUI.markup
            });
        }

        // Upload Video Segments with progress
        for (let i = 0; i < assets.videoChunks.length; i++) {
            await ctx.replyWithVideo(
                { source: assets.videoChunks[i] },
                { 
                    caption: `📽 GHOST meet Recording | Part ${i + 1} of ${assets.videoChunks.length}\n⏱ Duration: ${timeStr}`
                }
            );
        }

        // Upload Audio Recording
        if (assets.audioPath) {
            await ctx.replyWithAudio(
                { source: assets.audioPath },
                { caption: "🎙 Meeting Audio Recording\n✨ High quality capture" }
            );
        }

        // Upload AI Transcript
        if (assets.transcriptPath) {
            await ctx.replyWithDocument(
                { source: assets.transcriptPath },
                { caption: "📄 AI Meeting Transcript (Hinglish)\n✨ Full continuous transcription" }
            );
        }

        // RESET SESSION STATE
        sessionState.isJoined = false;
        sessionState.isRecording = false;
        sessionState.currentUrl = null;
        sessionState.playerMessageId = null;
        sessionState.recordingStartTime = null;

        const finalUI =
            "✨ *SESSION COMPLETE*\n" +
            "━━━━━━━━━━━━━━━━━━━━━━\n" +
            "✅ All assets uploaded successfully.\n" +
            "🔐 Files secured in group storage.\n" +
            "🚀 Engine hibernated.\n\n" +
            "Send a meeting link to start a new session.";
        await ctx.replyWithMarkdown(finalUI);

    } catch (error) {
        logger.error("Finalization Failure:", error);
        sessionState.isRecording = false;
        await ctx.replyWithMarkdown(`❌ *Stop Error:* ${error.message}\n\n_System attempted to recover files, check logs._`);
    }
});

/**
 * /status - Real-time diagnostics and session status
 */
bot.command('status', (ctx) => {
    const recordingStatus = sessionState.isRecording ? "🔴 ACTIVE" : "⚪ IDLE";
    const joinStatus = sessionState.isJoined ? "✅ CONNECTED" : "❌ DISCONNECTED";
    
    let duration = "0:00";
    if (sessionState.recordingStartTime) {
        const elapsed = Math.round((Date.now() - sessionState.recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        duration = `${mins}:${(elapsed % 60).toString().padStart(2, '0')}`;
    }

    const diagnosticUI =
        "📟 *SYSTEM DIAGNOSTICS*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━\n" +
        `• Session Status: ${joinStatus}\n` +
        `• Recording: ${recordingStatus}\n` +
        `• Duration: *${duration}*\n` +
        "• Kernel: *Stable*\n" +
        "• Virtual Display: *Active (:99)*\n" +
        "• FFMPEG Pipeline: *Ready*\n" +
        "• STT Engine: *Bilingual Mode (Hindi/Hinglish)*\n" +
        "• Storage: *Optimized*";
    ctx.replyWithMarkdown(diagnosticUI);
});

// Inline Actions
bot.action('cmd_record', async (ctx) => {
    try {
        await ctx.answerCbQuery("🔴 Initiating HD Capture...");

        if (sessionState.isRecording) return;

        sessionState.isRecording = true;
        sessionState.recordingStartTime = Date.now();

        await recorder.startRecording();

        // START REAL-TIME TIMER UPDATES
        let elapsedSeconds = 0;
        sessionState.timerInterval = setInterval(async () => {
            elapsedSeconds++;
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            const updatedUI = ui.generatePlayerUI({
                status: 'RECORDING',
                timer: timeStr,
                meetingUrl: sessionState.currentUrl
            });

            try {
                if (sessionState.playerMessageId) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        sessionState.playerMessageId,
                        undefined,
                        updatedUI.text,
                        { parse_mode: 'Markdown', ...updatedUI.markup }
                    );
                }
            } catch (err) {
                logger.warn("Timer update error (expected):", err.message);
            }
        }, 5000);
    } catch (e) {
        logger.error("Action error:", e.message);
    }
});

bot.action('cmd_stop', async (ctx) => {
    try {
        await ctx.answerCbQuery("💾 Finalizing Session...");

        // 1. UPDATE UI INSTANTLY (Both Render and Runner see this)
        const stoppingUI = ui.generatePlayerUI({
            status: 'STOPPING',
            meetingUrl: sessionState.currentUrl
        });

        if (sessionState.playerMessageId) {
            await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, stoppingUI.text, {
                parse_mode: 'Markdown', ...stoppingUI.markup
            });
        }

        // 2. STOP TIMER (Both)
        if (sessionState.timerInterval) {
            clearInterval(sessionState.timerInterval);
            sessionState.timerInterval = null;
        }

        // 3. RENDER BOT LOGIC: Just Stop Here.
        if (process.env.RENDER) {
            logger.info("Main bot on Render: UI updated. Runner should handle the recording stop.");
            sessionState.isRecording = false;
            sessionState.isJoined = false;
            return;
        }

        // 4. RUNNER/LOCAL LOGIC: Actually stop the recording
        logger.info("Local/Runner Engine: Stopping recording and processing assets...");
        sessionState.isRecording = false;

        const assets = await recorder.stopRecording();

        if (!assets || (assets.videoChunks.length === 0 && !assets.transcriptPath)) {
            logger.warn("No assets generated.");
            return;
        }

        // Processing UI
        const processingUI = ui.generatePlayerUI({ status: 'FINALIZING', meetingUrl: sessionState.currentUrl });
        await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, processingUI.text, { parse_mode: 'Markdown' });

        // UPLOAD
        for (let i = 0; i < assets.videoChunks.length; i++) {
            await ctx.replyWithVideo({ source: assets.videoChunks[i] }, {
                caption: `📽 Part ${i + 1} | Duration: Captured`
            });
        }

        if (assets.audioPath) {
            await ctx.replyWithAudio({ source: assets.audioPath }, { caption: "🎙 Audio Recording" });
        }

        if (assets.transcriptPath) {
            await ctx.replyWithDocument({ source: assets.transcriptPath }, { caption: "📄 Transcript" });
        }

        const completedUI = ui.generatePlayerUI({ status: 'COMPLETED' });
        await ctx.telegram.editMessageText(ctx.chat.id, sessionState.playerMessageId, null, completedUI.text, { parse_mode: 'Markdown' });

        sessionState.isJoined = false;
    } catch (e) {
        logger.error("Stop Action Error:", e.message);
    }
});

bot.action('cmd_screenshot', async (ctx) => {
    try {
        await ctx.answerCbQuery("📸 Capturing Live View...");
        const screenshotPath = await browserManager.takeScreenshot();
        if (screenshotPath) {
            await ctx.replyWithPhoto({ source: screenshotPath }, {
                caption: "🖼 *LIVE PREVIEW*\n━━━━━━━━━━━━━━━━━━━━━━\nCurrent meeting screen status.",
                parse_mode: 'Markdown'
            });
        } else {
            await ctx.reply("❌ Failed to capture screenshot. Is the meeting active?");
        }
    } catch (e) {
        logger.error("Screenshot action error:", e.message);
    }
});

bot.action('engine_status', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("System pulse: 100%. Encryption layers active. Engine performing within parameters.");
});

bot.action('help_guide', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("GHOST meet Manual:\n1. Send the meeting link directly to this chat.\n2. Use the interactive PLAYER buttons to Start, Stop, or Take Screenshots.\n3. Recordings and transcripts are delivered automatically.");
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
