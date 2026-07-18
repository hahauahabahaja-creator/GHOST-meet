const express = require('express');
const { spawn, execSync } = require('child_process');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = 8080;
const snapshotPath = path.join(__dirname, '../../output/mirror_snapshot.jpg');

function startMirror() {
    logger.info(`Initializing GHOST Mirror Ultra-Stealth Engine...`);

    // Ensure output dir exists
    fs.ensureDirSync(path.dirname(snapshotPath));

    // Continuous snapshot process
    // This is more stable than MJPEG streams over tunnels
    const ffmpeg = spawn('ffmpeg', [
        '-f', 'x11grab',
        '-video_size', '1280x720',
        '-framerate', '5',
        '-i', ':99.0',
        '-update', '1',
        '-y',
        snapshotPath
    ]);

    ffmpeg.stderr.on('data', (data) => {
        // Suppress logs unless needed
    });

    app.get('/snapshot', (req, res) => {
        if (fs.existsSync(snapshotPath)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.sendFile(snapshotPath);
        } else {
            res.status(404).send('Not ready');
        }
    });

    app.get('/', (req, res) => {
        res.send(`
            <html>
                <head>
                    <title>GHOST Mirror | ULTIMATE STEALTH</title>
                    <style>
                        body { background: #080808; color: #fff; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                        .container { position: relative; border: 4px solid #1a1a1a; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
                        img { display: block; max-width: 90vw; max-height: 80vh; background: #000; }
                        .header { margin-bottom: 15px; font-weight: 800; color: #ff3e3e; text-transform: uppercase; letter-spacing: 4px; font-size: 20px; text-shadow: 0 0 10px rgba(255,62,62,0.3); }
                        .status-bar { display: flex; align-items: center; margin-top: 15px; color: #00ff00; font-size: 13px; font-weight: bold; }
                        .dot { height: 8px; width: 8px; background-color: #00ff00; border-radius: 50%; display: inline-block; margin-right: 8px; animation: blink 1s infinite; }
                        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
                    </style>
                </head>
                <body>
                    <div class="header">🛰 GHOST MIRROR LIVE</div>
                    <div class="container">
                        <img id="mirror" src="/snapshot?t=0" />
                    </div>
                    <div class="status-bar"><span class="dot"></span>ENCRYPTED STEALTH FEED ACTIVE</div>
                    <script>
                        const img = document.getElementById('mirror');
                        setInterval(() => {
                            img.src = '/snapshot?t=' + Date.now();
                        }, 200); // 5 FPS refresh - Perfectly stable over any network
                    </script>
                </body>
            </html>
        `);
    });

    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`GHOST Mirror UI ready at http://localhost:${PORT}`);
    });
}

module.exports = { startMirror };
