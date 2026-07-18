const { Telegraf } = require('telegraf');
const path = require('path');

const browserManager = require(path.join(__dirname, '../src/core/browser'));
const recorder = require(path.join(__dirname, '../src/core/recorder'));
const logger = require(path.join(__dirname, '../src/utils/logger'));
const ui = require(path.join(__dirname, '../src/utils/ui'));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let meetingUrl = process.env.MEETING_URL;
if (meetingUrl && !meetingUrl.startsWith('http')) {
    meetingUrl = `https://${meetingUrl}`;
}
const groupId = process.env.ALLOWED_GROUP_ID;

const playerMessageId = process.env.PLAYER_MESSAGE_ID;
const chatId = process.env.CHAT_ID || groupId;

let isRecording = false;
let isStopping = false;
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
    }, 8000);
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
        await handleStop(ctx);
    });
}

async function handleStop(ctx) {
    if (isStopping) return;
    isStopping = true;

    console.log("Runner: Stop Action Sequence Initiated.");

    try {
        if (ctx.answerCbQuery) await ctx.answerCbQuery("💾 Finalizing Stream...").catch(() => {});

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

            if (process.env.RENDER_APP_NAME) {
                const axios = require('axios');
                await axios.get(`https://${process.env.RENDER_APP_NAME}.onrender.com/resume`).catch(() => {});
            }
            process.exit(0);
        }

        const uploadingUI = ui.generatePlayerUI({ status: 'FINALIZING', progress: 95 });
        await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, uploadingUI.text, { parse_mode: 'Markdown' }).catch(e => {
            if (!e.description?.includes("message is not modified")) throw e;
        });

        console.log("Runner: Starting media uploads...");

        for (let i = 0; i < assets.videoChunks.length; i++) {
            const partInfo = `📤 Uploading Video Part ${i+1}/${assets.videoChunks.length}...`;
            await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, `💾 *FINALIZING*\n━━━━━━━━━━━━━━━━━━━━━━\n${partInfo}`, { parse_mode: 'Markdown' }).catch(e => {
                if (!e.description?.includes("message is not modified")) console.error("Upload UI Error:", e.message);
            });

            await ctx.telegram.sendVideo(chatId, { source: assets.videoChunks[i] }, {
                caption: `📽 GHOST meet | Part ${i+1}`
            });
        }

        if (assets.transcriptPath) {
            await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, `💾 *FINALIZING*\n━━━━━━━━━━━━━━━━━━━━━━\n📤 Uploading AI Transcript...`, { parse_mode: 'Markdown' }).catch(e => {
                if (!e.description?.includes("message is not modified")) console.error("Transcript UI Error:", e.message);
            });
            await ctx.telegram.sendDocument(chatId, { source: assets.transcriptPath }, {
                caption: "📄 AI Meeting Transcript (Hinglish)"
            });
        } else {
            await ctx.telegram.sendMessage(chatId, "📄 *AI Transcript:* Skip/Not generated (No audio detected).", { parse_mode: 'Markdown' }).catch(() => {});
        }

        const completedUI = ui.generatePlayerUI({ status: 'COMPLETED', progress: 100 });
        await ctx.telegram.editMessageText(chatId, Number(playerMessageId), null, completedUI.text, { parse_mode: 'Markdown' }).catch(e => {
            if (!e.description?.includes("message is not modified")) throw e;
        });

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
        console.error("Runner Stop Error:", err.message);
        await ctx.reply(`❌ *System Error during Finalization:* ${err.message}`).catch(() => {});

        if (process.env.RENDER_APP_NAME) {
            const axios = require('axios');
            await axios.get(`https://${process.env.RENDER_APP_NAME}.onrender.com/resume`).catch(() => {});
        }
        process.exit(1);
    }
}

async function run() {
    try {
        console.log(`🚀 Starting GitHub Runner Engine...`);
        registerCommands();

        async function claimSession() {
        try {
            console.log("Claiming session... Waiting for Render instance to disconnect.");
            await new Promise(r => setTimeout(r, 5000)); // Increased delay

            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
            console.log("Webhook deleted. Attempting launch...");
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
            const provisioningUI = ui.generatePlayerUI({ status: 'PROVISIONING', meetingUrl });
            await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, provisioningUI.text, {
                parse_mode: 'Markdown', ...provisioningUI.markup
            });
            await new Promise(r => setTimeout(r, 4000));

            const bootingUI = ui.generatePlayerUI({ status: 'BOOTING', meetingUrl });
            await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, bootingUI.text, {
                parse_mode: 'Markdown', ...bootingUI.markup
            });
        } catch (e) {
            console.log("UI Update Note:", e.message);
        }

        const tunnel = await browserManager.launchMeeting(meetingUrl);
        currentDashboardUrl = tunnel.url;

        try {
            const connectingUI = ui.generatePlayerUI({ status: 'CONNECTING', meetingUrl, dashboardUrl: currentDashboardUrl });
            await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, connectingUI.text, {
                parse_mode: 'Markdown', ...connectingUI.markup
            });
        } catch (e) {
            console.log("UI Update Note:", e.message);
        }

        // Watchdog Loop for Status Detection
        const statusWatchdog = setInterval(async () => {
            const currentStatus = await browserManager.checkMeetingStatus();

            if (currentStatus === 'WAITING') {
                const waitingUI = ui.generatePlayerUI({ status: 'WAITING', dashboardUrl: currentDashboardUrl });
                await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, waitingUI.text, {
                    parse_mode: 'Markdown', ...waitingUI.markup
                }).catch(() => {});
            } else if (currentStatus === 'INSIDE') {
                if (!isRecording && !isStopping) {
                    const readyUI = ui.generatePlayerUI({ status: 'READY', dashboardUrl: currentDashboardUrl });
                    await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, readyUI.text, {
                        parse_mode: 'Markdown', ...readyUI.markup
                    }).catch(() => {});
                }
            } else if (currentStatus === 'ENDED') {
                if (isRecording) {
                    console.log("Runner: Meeting End detected. Auto-stopping...");
                    clearInterval(statusWatchdog);
                    const endedUI = ui.generatePlayerUI({ status: 'ENDED' });
                    await bot.telegram.editMessageText(chatId, Number(playerMessageId), null, endedUI.text, { parse_mode: 'Markdown' }).catch(() => {});

                    // Trigger the stop action logic manually
                    await handleStop({
                        telegram: bot.telegram,
                        chat: { id: chatId },
                        reply: async (t) => console.log(t)
                    });
                }
            }
        }, 15000);

        console.log("Runner ready. Awaiting commands...");

    } catch (error) {
        console.error("Runner Boot Error:", error);
        if (process.env.RENDER_APP_NAME) {
            const axios = require('axios');
            await axios.get(`https://${process.env.RENDER_APP_NAME}.onrender.com/resume`).catch(() => {});
        }
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
