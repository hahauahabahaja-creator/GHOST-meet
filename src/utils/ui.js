const { Markup } = require('telegraf');

const STATUS_ICONS = {
    INITIALIZING: '⏳',
    DEPLOYING: '🚀',
    CONNECTING: '🌀',
    WAITING: '⚠️',
    READY: '✅',
    RECORDING: '🔴',
    FINALIZING: '💾',
    COMPLETED: '✨',
    ERROR: '🚨',
    STARTING: '⚡',
    STOPPING: '💾',
    ENDED: '🛑'
};

function generatePlayerUI(params) {
    const { status, timer, meetingUrl, dashboardUrl, partCount, progress } = params;
    const icon = STATUS_ICONS[status] || '🛸';

    let uiText = `${icon} *GHOST meet | ULTIMATE PLAYER*\n`;
    uiText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    uiText += `🛰 *System Status:* \`${status.replace(/_/g, ' ')}\`\n`;

    if (dashboardUrl) {
        uiText += `🔗 *Control:* [ACCESS DASHBOARD](${dashboardUrl})\n`;
    } else if (meetingUrl) {
        uiText += `📍 *Target:* [MEETING ROOM](${meetingUrl})\n`;
    }

    if (timer) {
        uiText += `⏱ *Session Time:* \`${timer}\`\n`;
    }

    if (progress !== undefined) {
        uiText += `📊 *Processing:* ${getProgressBar(progress)}\n`;
    } else if (status === 'DEPLOYING') {
        uiText += `📊 *Deployment:* ${getProgressBar(30)}\n`;
        uiText += `⏳ *ETA:* \`~2 mins\` (Spinning up cloud runner)`;
    } else if (status === 'CONNECTING' || status === 'WAITING') {
        uiText += `📊 *Connection:* ${getProgressBar(70)}\n`;
    }

    if (partCount) {
        uiText += `🎞 *Captured:* \`${partCount} parts\`\n`;
    }

    uiText += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (status === 'WAITING') {
        uiText += `⚠️ *WAITING FOR ADMISSION...*\n_The host needs to let me in. Please wait or check the dashboard._`;
    } else if (status === 'READY') {
        uiText += `✅ *Engine Ready.* All systems green. Click below to begin stealth capture.`;
    } else if (status === 'RECORDING') {
        uiText += `⏺ *CAPTURING LIVE FEED...* 🛰\n_Stealth mode active. Auto-Stop enabled._`;
    } else if (status === 'ENDED') {
        uiText += `🛑 *MEETING ENDED.* Automatically finalizing capture...`;
    } else if (status === 'FINALIZING') {
        uiText += `⚙️ *AI Processing & Secure Upload...*`;
    }

    const buttons = [];
    if (status === 'READY') {
        buttons.push([Markup.button.callback('⏺ START CAPTURE', 'cmd_record')]);
    } else if (status === 'RECORDING') {
        buttons.push([
            Markup.button.callback('📸 SCREENSHOT', 'cmd_screenshot'),
            Markup.button.callback('🛑 STOP & SAVE', 'cmd_stop')
        ]);
    } else if (status === 'DEPLOYING' || status === 'INITIALIZING' || status === 'CONNECTING' || status === 'WAITING') {
        buttons.push([Markup.button.callback('❌ CANCEL DEPLOYMENT', 'cmd_cancel')]);
    }

    return {
        text: uiText,
        markup: Markup.inlineKeyboard(buttons)
    };
}

function getProgressBar(percent) {
    const total = 12;
    const progress = Math.round((percent / 100) * total);
    const remaining = total - progress;
    // Premium style progress bar using shaded blocks
    return `\`[${"█".repeat(progress)}${"░".repeat(remaining)}]\` *${percent}%*`;
}

module.exports = {
    generatePlayerUI,
    STATUS_ICONS
};
