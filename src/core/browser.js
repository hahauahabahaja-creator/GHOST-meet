const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { spawn, exec } = require('child_process');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');

puppeteer.use(stealth);

let browser = null;
let page = null;
let tunnelInstance = null;

async function launchMeeting(url) {
    try {
        logger.info("Initializing Super Stealth Chrome Engine...");

        // 1. Setup Serveo Tunnel
        tunnelInstance = spawn('ssh', ['-o', 'StrictHostKeyChecking=no', '-R', '80:localhost:6080', 'serveo.net']);

        const tunnelUrl = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve("http://localhost:6080"), 25000);
            const handleOutput = (data) => {
                const match = data.toString().match(/https:\/\/[a-z0-9.-]+\.(serveo\.net|serveousercontent\.com)/i);
                if (match && !match[0].includes('console.serveo.net')) {
                    clearTimeout(timeout);
                    resolve(match[0]);
                }
            };
            tunnelInstance.stdout.on('data', handleOutput);
            tunnelInstance.stderr.on('data', handleOutput);
        });

        // 🛡 ULTIMATE STEALTH: Use full desktop chrome for extension support
        const userDataDir = '/tmp/ghost_chrome_profile';
        await fs.ensureDir(userDataDir);

        browser = await puppeteer.launch({
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
            headless: false,
            userDataDir: userDataDir, // PERSISTENT PROFILE FOR EXTENSIONS
            defaultViewport: null,
            ignoreDefaultArgs: ['--disable-extensions'], // CRITICAL FOR EXTENSIONS
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--disable-notifications',
                '--no-first-run',
                '--disable-blink-features=AutomationControlled',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--lang=en-US,en'
            ]
        });

        const pages = await browser.pages();
        page = pages[0];

        // 🚀 ZIDDI AUTO-RETRY LOOP (To bypass "You can't join this call")
        let attempts = 0;
        const maxAttempts = 5;
        let joined = false;

        while (attempts < maxAttempts && !joined) {
            attempts++;
            logger.info(`🔄 Joining Attempt ${attempts}/${maxAttempts}...`);

            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

                // Wait to see if we hit the error page or meeting screen
                await new Promise(r => setTimeout(r, 8000));

                const content = await page.content();
                if (content.includes('You can\'t join this video call') || content.includes('Returning to home screen')) {
                    logger.warn("⚠️ Google blocked the join. Retrying in 5 seconds...");
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    joined = true;
                    logger.info("✅ Successfully reached Meeting Entrance.");
                }
            } catch (e) {
                logger.error(`Attempt ${attempts} failed: ${e.message}`);
            }
        }

        const vncPass = process.env.VNC_PASSWORD || "";
        const dashboardUrl = `${tunnelUrl}/vnc.html?autoconnect=true&password=${vncPass}&resize=scale&scale=1.0`;

        return { url: dashboardUrl };
    } catch (error) {
        logger.error("Stealth Engine Failure:", error);
        throw error;
    }
}

async function takeScreenshot() {
    if (!page) return null;
    const screenshotPath = path.join(__dirname, '../../output/screenshot.png');
    await fs.ensureDir(path.dirname(screenshotPath));
    await page.screenshot({ path: screenshotPath });
    return screenshotPath;
}

async function closeBrowser() {
    try {
        logger.info("Initiating browser shutdown and meeting exit...");
        if (browser) {
            await browser.close();
            logger.info("Browser closed successfully.");
        }
        if (tunnelInstance) {
            tunnelInstance.kill('SIGKILL');
            logger.info("Tunnel terminated.");
        }
        // Force kill any remaining chrome or display processes
        exec('pkill -9 -f chrome');
        exec('pkill -9 Xvfb');
        exec('pkill -9 fluxbox');
        logger.info("Display and window manager purged.");
    } catch (e) {
        logger.error("Error during browser cleanup:", e.message);
    }
}

module.exports = { launchMeeting, takeScreenshot, closeBrowser, getPage: () => page };
