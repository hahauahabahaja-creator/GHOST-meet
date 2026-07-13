const { Telegraf } = require('telegraf');
const browserManager = require('../src/core/browser');
const recorder = require('../src/core/recorder');
const logger = require('../utils/logger');
const ui = require('../utils/ui');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let meetingUrl = process.env.MEETING_URL;
if (meetingUrl && !meetingUrl.startsWith('http')) {
    meetingUrl = `https://${meetingUrl}`;
}
const groupId = process.env.ALLOWED_GROUP_ID;

const playerMessageId = process.env.PLAYER_MESSAGE_ID;
const chatId = process.env.CHAT_ID || groupId;

let isRecording = false;
let heartbeatInterval = null;
let recordingStartTime = null;
let currentDashboardUrl = null;

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
            await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, updatedUI.text, {
                parse_mode: 'Markdown', ...updatedUI.markup
            });
        } catch (e) {
            if (e.description && e.description.includes("message is not modified")) return;
            console.error("Heartbeat update error:", e.message);
        }
    }, 3000);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

process.env.CHROME_PATH = '/usr/bin/google-chrome-stable';

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

    bot.action('cmd_record', async (ctx) => {
        try {
            await ctx.answerCbQuery("🔴 Initiating HD Capture...");
            if (isRecording) return;

            console.log("Runner: Starting Capture...");
            await recorder.startRecording();
            isRecording = true;

            await startHeartbeat(ctx);
        } catch (e) {
            console.error("Runner: Record Action Error:", e.message);
            await ctx.reply(`❌ *Capture Failed to Start:* ${e.message}`).catch(() => {});
        }
    });

    bot.action('cmd_stop', async (ctx) => {
        console.log("Runner: Stop Action Received via Callback.");

        try {
            await ctx.answerCbQuery("💾 Finalizing Stream...");

            isRecording = false;
            stopHeartbeat();

            recorder.setProgressCallback(async (status, progress) => {
                const updatedUI = ui.generatePlayerUI({ status, progress });
                await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, updatedUI.text, {
                    parse_mode: 'Markdown', ...updatedUI.markup
                }).catch(() => {});
            });

            console.log("Runner: Triggering recorder.stopRecording()...");

            const stopTimeout = setTimeout(() => {
                console.error("Runner: stopRecording GLOBAL TIMEOUT!");
                ctx.reply("⚠️ *CRITICAL TIMEOUT:* Assets took too long to process. Attempting emergency exit.").catch(() => {});
                process.exit(1);
            }, 10 * 60 * 1000);

            const assets = await recorder.stopRecording();
            clearTimeout(stopTimeout);

            if (!assets || (!assets.videoChunks?.length && !assets.transcriptPath)) {
                console.log("Runner: No assets generated.");
                const errorUI = ui.generatePlayerUI({ status: 'ERROR' });
                await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, errorUI.text + "\n\n❌ No recording files found.", { parse_mode: 'Markdown' });
                return;
            }

            const uploadingUI = ui.generatePlayerUI({ status: 'FINALIZING', progress: 95 });
            await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, uploadingUI.text, { parse_mode: 'Markdown' });

            console.log("Runner: Starting media uploads...");

            for (let i = 0; i < assets.videoChunks.length; i++) {
                const partInfo = `📤 Uploading Video Part ${i+1}/${assets.videoChunks.length}...`;
                await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, `💾 *FINALIZING*\n━━━━━━━━━━━━━━━━━━━━━━\n${partInfo}`, { parse_mode: 'Markdown' }).catch(() => {});

                await ctx.telegram.sendVideo(chatId, { source: assets.videoChunks[i] }, {
                    caption: `📽 GHOST meet | Part ${i+1}`
                });
            }

            if (assets.transcriptPath) {
                await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, `💾 *FINALIZING*\n━━━━━━━━━━━━━━━━━━━━━━\n📤 Uploading AI Transcript...`, { parse_mode: 'Markdown' }).catch(() => {});
                await ctx.telegram.sendDocument(chatId, { source: assets.transcriptPath }, {
                    caption: "📄 AI Meeting Transcript (Hinglish)"
                });
            } else {
                await ctx.telegram.sendMessage(chatId, "📄 *AI Transcript:* Skip/Not generated (No audio detected).", { parse_mode: 'Markdown' }).catch(() => {});
            }

            const completedUI = ui.generatePlayerUI({ status: 'COMPLETED', progress: 100 });
            await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, completedUI.text, { parse_mode: 'Markdown' });

            console.log("Runner: Sequence Complete. Cleaning up...");
            await browserManager.closeBrowser().catch(() => {});

            if (process.env.RENDER_APP_NAME) {
                const axios = require('axios');
                console.log(`Runner: Notifying Render Bot (${process.env.RENDER_APP_NAME}) to resume...`);
                await axios.get(`https://${process.env.RENDER_APP_NAME}.onrender.com/resume`).catch(e => {
                    console.error("Runner: Failed to wake up Render bot:", e.message);
                });
            }

            setTimeout(() => {
                console.log("Runner: Final Exit.");
                process.exit(0);
            }, 5000);
        } catch (err) {
            console.error("Runner Callback Stop Error:", err.message);
            await ctx.reply(`❌ *System Error during Finalization:* ${err.message}`).catch(() => {});
            process.exit(1);
        }
    });
}

async function run() {
    try {
        console.log(`🚀 Starting GitHub Runner Engine...`);
        registerCommands();

        async function claimSession() {
            try {
                console.log("Claiming session... (Silencing other instances)");
                await bot.telegram.deleteWebhook({ drop_pending_updates: true });
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                console.log(`Session Claim Warning: ${e.message}`);
            }
        }

        await claimSession();

        const botPromise = bot.launch({
            dropPendingUpdates: true,
            polling: { timeout: 30, limit: 100 }
        }).catch(err => {
            if (err.response && err.response.error_code === 409) {
                console.log("⚠️ Initial Conflict detected. This is expected during session claim.");
            } else {
                console.error("Critical Bot Launch Error:", err.message);
            }
        });

        console.log("Runner Engine Active. Initializing Browser...");

        try {
            const connectingUI = ui.generatePlayerUI({ status: 'CONNECTING', meetingUrl });
            await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, connectingUI.text, {
                parse_mode: 'Markdown', ...connectingUI.markup
            });
        } catch (e) {
            if (!e.description?.includes("message is not modified")) {
                console.log("UI Update Note:", e.message);
            }
        }

        const tunnel = await browserManager.launchMeeting(meetingUrl);
        currentDashboardUrl = tunnel.url;

        const readyUI = ui.generatePlayerUI({ status: 'READY', dashboardUrl: tunnel.url });
        await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, readyUI.text, {
            parse_mode: 'Markdown', ...readyUI.markup
        });

        console.log("Runner ready. Awaiting commands...");

    } catch (error) {
        console.error("Runner Boot Error:", error);
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    if (err.message.includes('409')) {
        console.log("🔄 Conflict Error handled: Bot session is being claimed by another instance.");
    } else {
        console.error('💥 Uncaught Exception:', err);
    }
});

run();
