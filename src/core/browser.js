const puppeteer = require('puppeteer-core');
const { exec, spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');
const fs = require('fs-extra');

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

        process.env.DISPLAY = ':99';

        // 1. Setup Serveo Tunnel (Unlimited & No IP check)
        logger.info("Establishing Serveo Unlimited Tunnel...");
        try {
            // Start Serveo tunnel via SSH
            tunnelInstance = spawn('ssh', ['-o', 'StrictHostKeyChecking=no', '-R', '80:localhost:6080', 'serveo.net'], {
                detached: false
            });

            tunnelUrl = await new Promise((resolve, reject) => {
                let found = false;
                const timeout = setTimeout(() => {
                    if (!found) {
                        logger.warn("Serveo URL extraction timed out. Using fallback.");
                        resolve("http://localhost:6080");
                    }
                }, 20000);

                // Serveo sometimes prints the URL on stderr
                const handleOutput = (data) => {
                    const msg = data.toString();
                    logger.info(`[SERVEO DEBUG] ${msg}`); // Log output for debugging

                    // Improved regex to handle both serveo.net and serveousercontent.com
                    const match = msg.match(/https:\/\/[a-z0-9.-]+\.(serveo\.net|serveousercontent\.com)/i);
                    if (match && !match[0].includes('console.serveo.net')) {
                        found = true;
                        clearTimeout(timeout);
                        resolve(match[0]);
                    }
                };

                tunnelInstance.stdout.on('data', handleOutput);
                tunnelInstance.stderr.on('data', handleOutput);

                tunnelInstance.on('error', (err) => {
                    logger.error(`Serveo Process Error: ${err.message}`);
                    resolve("http://localhost:6080");
                });
            });

            logger.info(`SUCCESS: Serveo tunnel established: ${tunnelUrl}`);
        } catch (err) {
            logger.error(`Serveo failed: ${err.message}`);
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

        // Generate One-Click Link
        const vncPass = process.env.VNC_PASSWORD || "";
        const oneClickUrl = `${tunnelUrl}/vnc_lite.html?autoconnect=true&password=${vncPass}`;
        logger.info(`Final Dashboard URL: ${oneClickUrl}`);

        return { url: oneClickUrl };
    } catch (error) {
        logger.error("Browser Launch Error:", error);
        throw error;
    }
}

/**
 * Capture a real-time screenshot of the meeting
 */
async function takeScreenshot() {
    if (!page) throw new Error("Browser session not active.");
    const screenshotPath = path.join(__dirname, '../../output/screenshot.png');
    await fs.ensureDir(path.dirname(screenshotPath));
    await page.screenshot({ path: screenshotPath });
    return screenshotPath;
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
    if (tunnelInstance) tunnelInstance.kill();
    exec('pkill Xvfb');
}

module.exports = { launchMeeting, takeScreenshot, closeBrowser, getPage: () => page };
