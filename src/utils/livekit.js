const { AccessToken } = require('livekit-server-sdk');
const logger = require('./logger');

function generateDashboardLink(roomName, participantIdentity) {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
        logger.warn("LiveKit credentials missing. Dashboard link will be limited.");
        return null;
    }

    try {
        const at = new AccessToken(apiKey, apiSecret, {
            identity: participantIdentity,
        });
        at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });

        const token = at.toJwt();
        // Construct a link to a hosted LiveKit client (e.g. meet.livekit.io or your own)
        // Using a direct token-based link
        const host = livekitUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        return `https://meet.livekit.io/?url=${encodeURIComponent(host)}&token=${token}`;
    } catch (e) {
        logger.error("LiveKit Token Error:", e.message);
        return null;
    }
}

module.exports = { generateDashboardLink };
