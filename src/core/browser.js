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
        logger.info("Initializing ULTIMATE Stealth Hardware Engine...");

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

        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

        browser = await puppeteer.launch({
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
            headless: false,
            userDataDir: userDataDir,
            defaultViewport: { width: 1280, height: 720 },
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                '--window-size=1280,720',
                '--window-position=0,0',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--disable-notifications',
                '--no-first-run',
                '--disable-blink-features=AutomationControlled',
                '--lang=en-US,en',
                `--user-agent=${userAgent}`
            ]
        });

        const pages = await browser.pages();
        page = pages[0];

        // --- DEEP HARDWARE MASKING ---
        await page.evaluateOnNewDocument(() => {
            // 1. Spoof WebGL (GPU)
            const getParameter = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, attributes) {
                const context = getParameter.apply(this, [type, attributes]);
                if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
                    const originalGetParameter = context.getParameter;
                    context.getParameter = function(param) {
                        if (param === 37445) return 'NVIDIA Corporation'; // UNMASKED_VENDOR_WEBGL
                        if (param === 37446) return 'NVIDIA GeForce RTX 3060/PCIe/SSE2'; // UNMASKED_RENDERER_WEBGL
                        return originalGetParameter.apply(this, [param]);
                    };
                }
                return context;
            };

            // 2. Spoof CPU & RAM
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

            // 3. Spoof OS/Platform
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

            // 4. Spoof Battery
            navigator.getBattery = () => Promise.resolve({
                level: 0.85,
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                onlevelchange: null,
                onchargingchange: null
            });

            // 5. Mask Automation
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

        logger.info(`🚀 Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // --- HUMANIZED JOIN SEQUENCE ---
        setTimeout(async () => {
            try {
                // 1. Professional Name
                const adminNames = ["Admin Support (Note-Taker)", "Executive Assistant", "Meeting Recorder", "Project Coordinator"];
                const chosenName = adminNames[Math.floor(Math.random() * adminNames.length)];

                // Find and type name (Google Meet specific)
                const nameInputSelector = 'input[type="text"]';
                if (await page.$(nameInputSelector)) {
                    await page.click(nameInputSelector);
                    for (const char of chosenName) {
                        await page.keyboard.sendCharacter(char);
                        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
                    }
                    logger.info(`Identity Set: ${chosenName}`);
                }

                // 2. Humanized Controls (Mic/Cam Off)
                const controls = await page.$$('[role="button"]');
                for (const btn of controls) {
                    const text = await page.evaluate(el => el.getAttribute('aria-label') || el.innerText, btn);
                    if (text && (text.includes('microphone') || text.includes('camera'))) {
                        await btn.hover();
                        await new Promise(r => setTimeout(r, 500));
                        await btn.click();
                        await new Promise(r => setTimeout(r, 800));
                    }
                }

            } catch (e) {
                logger.error("Humanized Sequence Warning:", e.message);
            }
        }, 5000);

        // Auto-Clicker for Join/Dismiss buttons (Humanized)
        setInterval(async () => {
            if (!page) return;
            try {
                await page.evaluate(() => {
                    const buttons = ['Join now', 'Ask to join', 'Dismiss', 'Got it', 'Admit', 'Allow'];
                    const elements = document.querySelectorAll('button, [role="button"], span');
                    for (const el of elements) {
                        if (buttons.some(btn => el.innerText && el.innerText.includes(btn))) {
                            // Simulate human click
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                el.click();
                                break;
                            }
                        }
                    }
                });
            } catch (e) {}
        }, 8000);

        const vncPass = process.env.VNC_PASSWORD || "";
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
