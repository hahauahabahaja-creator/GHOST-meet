const { Markup } = require('telegraf');

/**
 * GHOST meet | Pro UI Engine
 * Generates consistent, high-end "Video Player" style interfaces
 */

const STATUS_ICONS = {
    INITIALIZING: '⏳',
    DEPLOYING: '🚀',
    CONNECTING: '🌀',
    READY: '✅',
    RECORDING: '🔴',
    FINALIZING: '💾',
    COMPLETED: '✨',
    ERROR: '🚨'
};

function generatePlayerUI(params) {
    const { status, timer, meetingUrl, dashboardUrl, partCount, progress } = params;
    const icon = STATUS_ICONS[status] || '🛸';

    let uiText = `${icon} *GHOST meet | LIVE PLAYER*\n`;
    uiText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    uiText += `📍 Status: *${status}*\n`;

    // Switch from Meeting Link to Dashboard Link when ready
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
        uiText += `✅ System Ready. Click the dashboard link to login, then click START below.`;
    } else if (status === 'RECORDING') {
        uiText += `⏺ CAPTURING LIVE FEED...`;
    } else if (status === 'FINALIZING') {
        uiText += `⚙️ Processing & Uploading...`;
    }

    // Inline Buttons (NO DIAGNOSTICS - ONLY ACTIONS)
    const buttons = [];
    if (status === 'READY') {
        buttons.push([Markup.button.callback('⏺ START CAPTURE', 'cmd_record')]);
    } else if (status === 'RECORDING') {
        buttons.push([Markup.button.callback('🛑 STOP & SAVE', 'cmd_stop')]);
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
