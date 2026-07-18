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
        logger.info("Initializing ULTIMATE Stealth GHOST Vision Engine...");

        // Reverting Tunnel to noVNC port (6080) for full manual control
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
            // CRITICAL: ignoreDefaultArgs removes the "controlled by automated software" bar
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                `--app=${url}`, // Join as installed app
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
                `--user-agent=${userAgent}`,
                '--disable-webrtc-hw-encoding',
                '--disable-webrtc-hw-decoding',
                '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
                '--disable-features=WebRtcHideLocalIpsWithMdns'
            ]
        });

        const pages = await browser.pages();
        page = pages[0];

        // --- MOUSE CURVE HELPER (HUMANIZED) ---
        async function moveMouseHuman(targetX, targetY) {
            const start = await page.mouse._position;
            const steps = 15 + Math.random() * 10;
            for (let i = 0; i <= steps; i++) {
                const x = start.x + (targetX - start.x) * (i / steps) + (Math.random() - 0.5) * 5;
                const y = start.y + (targetY - start.y) * (i / steps) + (Math.random() - 0.5) * 5;
                await page.mouse.move(x, y);
                await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
            }
        }

        // --- DEEP HARDWARE & FINGERPRINT MASKING ---
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

            // 5. Mask Automation & Webdriver
            Object.defineProperty(navigator, 'webdriver', { get: () => false });

            // 6. Canvas Fingerprint Protection (Add slight noise)
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type) {
                const context = this.getContext('2d');
                if (context) {
                    context.fillStyle = 'rgba(0,0,0,0.01)';
                    context.fillRect(0, 0, 1, 1);
                }
                return originalToDataURL.apply(this, arguments);
            };

            // 7. Audio Fingerprint Protection
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
                const data = originalGetChannelData.apply(this, arguments);
                if (data && data.length > 10) {
                    for (let i = 0; i < 10; i++) data[i] += Math.random() * 0.0001;
                }
                return data;
            };
        });

        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

        logger.info(`🚀 Navigating to: ${url}`);

        // --- HUMANIZED DELAY ---
        const dwellTime = 5000 + Math.random() * 7000;
        logger.info(`Stealth: Dwelling for ${Math.round(dwellTime/1000)}s before navigation...`);
        await new Promise(r => setTimeout(r, dwellTime));

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // --- HUMANIZED JOIN SEQUENCE ---
        setTimeout(async () => {
            try {
                // 1. Settings Check Simulation (Very Human)
                const settingsBtn = await page.$('[aria-label="Settings"]');
                if (settingsBtn) {
                    const rect = await settingsBtn.boundingBox();
                    if (rect) {
                        await moveMouseHuman(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
                        await page.keyboard.press('Escape'); // Close settings
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                // 2. Professional Name
                const adminNames = ["Admin Support (Note-Taker)", "Executive Assistant", "Meeting Recorder", "Project Coordinator"];
                const chosenName = adminNames[Math.floor(Math.random() * adminNames.length)];

                const nameInputSelector = 'input[type="text"]';
                const nameInput = await page.$(nameInputSelector);
                if (nameInput) {
                    const rect = await nameInput.boundingBox();
                    if (rect) {
                        await moveMouseHuman(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        for (const char of chosenName) {
                            await page.keyboard.sendCharacter(char);
                            await new Promise(r => setTimeout(r, 100 + Math.random() * 150));
                        }
                        logger.info(`Identity Set: ${chosenName}`);
                    }
                }

                // 3. Humanized Controls (Mic/Cam Off)
                const controls = await page.$$('[role="button"]');
                for (const btn of controls) {
                    const text = await page.evaluate(el => el.getAttribute('aria-label') || el.innerText, btn);
                    if (text && (text.includes('microphone') || text.includes('camera'))) {
                        const rect = await btn.boundingBox();
                        if (rect) {
                            await moveMouseHuman(rect.x + rect.width / 2, rect.y + rect.height / 2);
                            await new Promise(r => setTimeout(r, 300));
                            await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                            await new Promise(r => setTimeout(r, 800));
                        }
                    }
                }

            } catch (e) {
                logger.error("Humanized Sequence Warning:", e.message);
            }
        }, 12000); // Wait for dwell + extra safety

        // Auto-Clicker for Join/Dismiss buttons (Humanized)
        setInterval(async () => {
            if (!page) return;
            try {
                const buttons = ['Join now', 'Ask to join', 'Dismiss', 'Got it', 'Admit', 'Allow'];
                const elements = await page.$$('button, [role="button"], span');
                for (const el of elements) {
                    const text = await page.evaluate(node => node.innerText, el);
                    if (buttons.some(btn => text && text.includes(btn))) {
                        const rect = await el.boundingBox();
                        if (rect && rect.width > 0 && rect.height > 0) {
                            await moveMouseHuman(rect.x + rect.width / 2, rect.y + rect.height / 2);
                            await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                            break;
                        }
                    }
                }
            } catch (e) {}
        }, 15000); // Slower, more humanized interval

        const vncPass = process.env.VNC_PASSWORD || "";
        const dashboardUrl = `${tunnelUrl}/vnc.html?autoconnect=true&password=${vncPass}&resize=scale&scale=1.0&touch_mode=1&view_only=false&reconnect=true`;

        return { url: dashboardUrl };
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
