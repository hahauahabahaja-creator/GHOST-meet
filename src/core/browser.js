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
        exec('pkill Xvfb');
        exec('Xvfb :99 -screen 0 1920x1080x24 &');
        process.env.DISPLAY = ':99';

        logger.info("Starting visual Ngrok tunnel...");

        // 1. Force kill any existing ngrok processes to clear the environment
        try {
            await ngrok.kill();
        } catch (e) {}

        // 2. Simple, clean connection with the NEW token
        // We use the most basic configuration to avoid account-level policy conflicts
        try {
            ngrokUrl = await ngrok.connect({
                proto: 'http',
                addr: 6080, // noVNC default port
                authtoken: process.env.NGROK_AUTH_TOKEN
            });
            logger.info(`Ngrok tunnel established: ${ngrokUrl}`);
        } catch (err) {
            logger.error(`Ngrok connection failed: ${err.message}`);
            throw new Error(`Ngrok Error: ${err.message}. Ensure your token is valid and email is verified.`);
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
        await injectLoadingOverlay(page);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        logger.info("Browser session initialized.");
        return { url: ngrokUrl };
    } catch (error) {
        logger.error("Browser Launch Error:", error);
        throw error;
    }
}

async function injectLoadingOverlay(page) {
    const overlayPath = path.join(__dirname, 'overlay.html');
    if (fs.existsSync(overlayPath)) {
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
                setTimeout(() => {
                    const el = document.getElementById('ghost-overlay-container');
                    if (el) el.style.display = 'none';
                }, 15000);
            });
        }, overlayHtml);
    }
}

async function closeBrowser() {
    if (browser) await browser.close();
    if (ngrokUrl) await ngrok.kill();
    exec('pkill Xvfb');
}

module.exports = { launchMeeting, closeBrowser, getPage: () => page };
