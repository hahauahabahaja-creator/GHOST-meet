const axios = require('axios');
const logger = require('./logger');

async function isWorkflowRunning() {
    const { PAT_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?status=in_progress`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${PAT_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        return response.data.total_count > 0;
    } catch (error) {
        logger.error("GitHub Status Check Error:", error.message);
        return false;
    }
}

async function triggerRunner(meetingUrl, playerMessageId, chatId) {
    const { PAT_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;

    if (!PAT_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        throw new Error("Missing GitHub configuration (PAT_TOKEN, OWNER, or REPO)");
    }

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;

    try {
        logger.info(`Triggering GitHub Runner for: ${meetingUrl}`);

        const payload = {
            meeting_url: meetingUrl,
            player_message_id: playerMessageId,
            chat_id: chatId,
            // Securely pass LiveKit credentials from Render to GitHub
            livekit_url: process.env.LIVEKIT_URL,
            livekit_api_key: process.env.LIVEKIT_API_KEY,
            livekit_api_secret: process.env.LIVEKIT_API_SECRET
        };

        await axios.post(url, {
            event_type: 'start_ghost_runner',
            client_payload: payload
        }, {
            headers: {
                'Authorization': `token ${PAT_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        return true;
    } catch (error) {
        logger.error("GitHub Dispatch Error:", error.response ? error.response.data : error.message);
        throw new Error(`GitHub Dispatch Failed: ${error.message}`);
    }
}

module.exports = { triggerRunner, isWorkflowRunning };
