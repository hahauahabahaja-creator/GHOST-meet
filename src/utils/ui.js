const { Markup } = require('telegraf');

const STATUS_ICONS = {
    INITIALIZING: '⏳',
    DEPLOYING: '🚀',
    CONNECTING: '🌀',
    READY: '✅',
    RECORDING: '🔴',
    FINALIZING: '💾',
    COMPLETED: '✨',
    ERROR: '🚨',
    STARTING: '⚡',
    STOPPING: '💾'
};

function generatePlayerUI(params) {
    const { status, timer, meetingUrl, dashboardUrl, partCount, progress } = params;
    const icon = STATUS_ICONS[status] || '🛸';

    let uiText = `${icon} *GHOST meet | LIVE PLAYER*\n`;
    uiText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    uiText += `📍 Status: *${status}*\n`;

    if (dashboardUrl) {
        uiText += `🔗 Control: [ACCESS DASHBOARD](${dashboardUrl})\n`;
    } else if (meetingUrl) {
        uiText += `🔗 Target: [MEETING ROOM](${meetingUrl})\n`;
    }

    if (timer) {
        uiText += `⏱ Timer: *${timer}*\n`;
    }

    if (progress !== undefined) {
        uiText += `📊 Progress: ${getProgressBar(progress)}\n`;
    } else if (status === 'DEPLOYING') {
        uiText += `📊 Progress: ${getProgressBar(30)}\n`;
    } else if (status === 'CONNECTING') {
        uiText += `📊 Progress: ${getProgressBar(70)}\n`;
    }

    if (partCount) {
        uiText += `🎥 Captured: *${partCount} parts*\n`;
    }

    uiText += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (status === 'READY') {
        uiText += `✅ System Ready. Click START below to begin.`;
    } else if (status === 'STARTING') {
        uiText += `⚡ Initializing engine... Please wait.`;
    } else if (status === 'RECORDING') {
        uiText += `⏺ *CAPTURING LIVE FEED...* 🛰`;
    } else if (status === 'STOPPING') {
        uiText += `💾 Finalizing capture... Please wait.`;
    } else if (status === 'FINALIZING') {
        uiText += `⚙️ Processing & Uploading...`;
    }

    const buttons = [];
    if (status === 'READY') {
        buttons.push([Markup.button.callback('⏺ START CAPTURE', 'cmd_record')]);
    } else if (status === 'RECORDING') {
        buttons.push([
            Markup.button.callback('📸 SCREENSHOT', 'cmd_screenshot'),
            Markup.button.callback('🛑 STOP & SAVE', 'cmd_stop')
        ]);
    } else if (status === 'STARTING' || status === 'STOPPING') {
        buttons.push([Markup.button.callback('⏳ PROCESSING...', 'none')]);
    }

    return {
        text: uiText,
        markup: Markup.inlineKeyboard(buttons)
    };
}

function getProgressBar(percent) {
    const total = 10;
    const progress = Math.round((percent / 100) * total);
    const remaining = total - progress;
    return `[${"█".repeat(progress)}${"░".repeat(remaining)}] ${percent}%`;
}

module.exports = {
    generatePlayerUI,
    STATUS_ICONS
};
