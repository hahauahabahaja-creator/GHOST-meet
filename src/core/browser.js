const puppeteer = require('puppeteer-core');
const ngrok = require('ngrok');
const { exec } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');
const fs = require('fs-extra');

let browser = null;
let page = null;
let ngrokUrl = null;

/**
 * Initializes the virtual frame buffer and launches the meeting
 */
async function launchMeeting(url) {
    try {
        logger.info("Starting Xvfb virtual display :99...");
        // Ensure any old instances are killed
        exec('pkill Xvfb');
        exec('Xvfb :99 -screen 0 1920x1080x24 &');
        process.env.DISPLAY = ':99';

        logger.info("Starting visual Ngrok tunnel...");

        // Use a completely unique ID for each tunnel to prevent "already exists" errors
        const uniqueId = Math.random().toString(36).substring(2, 10);
        const tunnelName = `ghost_${uniqueId}_${Date.now()}`;

        try {
            ngrokUrl = await ngrok.connect({
                proto: 'http',
                addr: 6080, // noVNC default port
                authtoken: process.env.NGROK_AUTH_TOKEN,
                name: tunnelName,
                bind_tls: true
            });
            logger.info(`Ngrok tunnel established: ${ngrokUrl}`);
        } catch (err) {
            logger.warn(`Ngrok primary attempt failed (${err.message}), trying dynamic fallback...`);
            // Fallback: Let Ngrok auto-generate a name entirely
            ngrokUrl = await ngrok.connect({
                proto: 'http',
                addr: 6080,
                authtoken: process.env.NGROK_AUTH_TOKEN
            });
        }

        logger.info(`Launching Puppeteer on DISPLAY :99 for URL: ${url}`);
        browser = await puppeteer.launch({
            headless: false,
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1920,1080',
                '--start-maximized',
                '--hide-scrollbars',
                '--disable-infobars',
                '--autoplay-policy=no-user-gesture-required',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--display=:99'
            ],
            defaultViewport: {
                width: 1920,
                height: 1080
            }
        });

        page = await browser.newPage();

        // Premium Loading Overlay Injection
        await injectLoadingOverlay(page);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        logger.info("Browser session initialized.");
        return { url: ngrokUrl };
    } catch (error) {
        logger.error("Browser Launch Error:", error);
        throw error;
    }
}

/**
 * Injects a custom premium dark-themed overlay to show the "GHOST meet" branding
 */
async function injectLoadingOverlay(page) {
    const overlayPath = path.join(__dirname, 'overlay.html');
    const overlayHtml = await fs.readFile(overlayPath, 'utf8');

    await page.evaluateOnNewDocument((html) => {
        window.addEventListener('DOMContentLoaded', () => {
            const div = document.createElement('div');
            div.id = 'ghost-overlay-container';
            div.style.position = 'fixed';
            div.style.top = '0';
            div.style.left = '0';
            div.style.width = '100%';
            div.style.height = '100%';
            div.style.zIndex = '999999';
            div.style.pointerEvents = 'none';
            div.innerHTML = html;
            document.body.appendChild(div);

            // Remove overlay after 15 seconds or when meeting loads
            setTimeout(() => {
                const el = document.getElementById('ghost-overlay-container');
                if (el) el.style.display = 'none';
            }, 15000);
        });
    }, overlayHtml);
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
    if (ngrokUrl) {
        try {
            await ngrok.disconnect();
            await ngrok.kill();
        } catch (e) {}
    }
    exec('pkill Xvfb');
    exec('pkill x11vnc');
    exec('pkill websockify');
}

module.exports = {
    launchMeeting,
    closeBrowser,
    getPage: () => page
};
