const puppeteer = require('puppeteer-core');
const localtunnel = require('localtunnel');
const { exec } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const axios = require('axios');

let browser = null;
let page = null;
let tunnelInstance = null;
let tunnelUrl = null;

/**
 * Initializes the virtual frame buffer and launches the meeting
 */
async function launchMeeting(url) {
    try {
        logger.info("Connecting to pre-initialized Virtual Display & Visual Bridge...");

        // Ensure DISPLAY is set (should be set by workflow, but just in case)
        process.env.DISPLAY = ':99';

        // 1. Setup LocalTunnel
        logger.info("Establishing LocalTunnel...");
        try {
            // Get Public IP for LocalTunnel verification bypass
            const response = await axios.get('https://api.ipify.org?format=json').catch(() => ({ data: { ip: "Unknown" } }));
            const publicIp = response.data.ip;
            logger.info(`Runner Public IP: ${publicIp} (Use this if prompted by LocalTunnel)`);

            tunnelInstance = await localtunnel({ port: 6080 });
            tunnelUrl = tunnelInstance.url;

            logger.info(`SUCCESS: LocalTunnel established: ${tunnelUrl}`);

            tunnelInstance.on('close', () => {
                logger.info("LocalTunnel connection closed.");
            });
        } catch (err) {
            logger.error(`LocalTunnel failed: ${err.message}`);
            tunnelUrl = "http://localhost:6080";
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
        return { url: tunnelUrl };
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
    if (tunnelInstance) tunnelInstance.close();
    // Cleanup Xvfb only if needed, but usually Action cleanup handles it
}

module.exports = { launchMeeting, closeBrowser, getPage: () => page };
