const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { spawn, exec } = require('child_process');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');

chromium.use(stealth);

let browser = null;
let context = null;
let page = null;
let tunnelInstance = null;

async function launchMeeting(url) {
    try {
        logger.info("Initializing Ultimate Ghost Engine (Brave + Playwright)...");

        // 1. Setup Serveo Tunnel
        tunnelInstance = spawn('ssh', ['-o', 'StrictHostKeyChecking=no', '-R', '80:localhost:6080', 'serveo.net']);

        const tunnelUrl = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve("http://localhost:6080"), 20000);
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

        // 2. Launch Brave with Playwright
        browser = await chromium.launch({
            executablePath: process.env.BRAVE_PATH || '/usr/bin/brave-browser',
            headless: false,
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--disable-notifications',
                '--no-first-run'
            ]
        });

        context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Brave/1.63.165'
        });

        page = await context.newPage();

        logger.info(`Brave Engine Dispatched for: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });

        const vncPass = process.env.VNC_PASSWORD || "";
        // Updated URL for auto-fit and auto-connect
        const dashboardUrl = `${tunnelUrl}/vnc.html?autoconnect=true&password=${vncPass}&resize=scale&scale=1.0`;

        return { url: dashboardUrl };
    } catch (error) {
        logger.error("Ghost Engine Failure:", error);
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
        if (browser) await browser.close();
        if (tunnelInstance) tunnelInstance.kill();
        exec('pkill Xvfb');
    } catch (e) {}
}

module.exports = { launchMeeting, takeScreenshot, closeBrowser, getPage: () => page };
