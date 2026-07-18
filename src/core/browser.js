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

        const userDataDir = '/tmp/ghost_chrome_profile';
        await fs.ensureDir(userDataDir);

        browser = await puppeteer.launch({
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
            headless: false,
            userDataDir: userDataDir,
            defaultViewport: { width: 1280, height: 720 },
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                '--window-size=1280,720',
                '--window-position=0,0',
                '--force-device-scale-factor=1',
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

        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

        return { url: `${tunnelUrl}/vnc.html?autoconnect=true&password=${vncPass}&resize=scale&scale=1.0&touch_mode=1&view_only=false&reconnect=true` };
    } catch (error) {
        logger.error("Stealth Engine Failure:", error);
        throw error;
    }
}

async function checkMeetingStatus() {
    if (!page) return 'UNKNOWN';
    try {
        const content = await page.content();

        // Detection logic for Google Meet
        if (content.includes('Asking to join') || content.includes('You\'ll join the call when someone lets you in')) {
            return 'WAITING';
        }

        if (content.includes('You can\'t join this video call') || content.includes('Returning to home screen') || content.includes('Meeting has ended')) {
            return 'ENDED';
        }

        // Detect if we are actually inside (looking for typical UI elements like the leave button)
        const isInside = await page.evaluate(() => {
            return !!document.querySelector('[aria-label="Leave call"]') || !!document.querySelector('.VfPpkd-Bz112c-LgbsSe');
        });

        if (isInside) return 'INSIDE';

        return 'CONNECTING';
    } catch (e) {
        return 'ERROR';
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
        exec('pkill -9 -f chrome');
        exec('pkill -9 Xvfb');
        exec('pkill -9 fluxbox');
        logger.info("Display and window manager purged.");
    } catch (e) {
        logger.error("Error during browser cleanup:", e.message);
    }
}

module.exports = { launchMeeting, takeScreenshot, closeBrowser, getPage: () => page };
