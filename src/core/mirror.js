const express = require('express');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

const app = express();
const PORT = 8080;

let ffmpegProcess = null;

function startMirror() {
    logger.info(`Initializing GHOST Mirror Engine on port ${PORT}...`);

    app.get('/live', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache',
            'Connection': 'close',
            'Pragma': 'no-cache'
        });

        const ffmpeg = spawn('ffmpeg', [
            '-f', 'x11grab',
            '-video_size', '1280x720',
            '-framerate', '12',
            '-i', ':99', // Use standard display
            '-f', 'mpjpeg', // Use motion jpeg format
            '-q:v', '4',
            '-an',
            'pipe:1'
        ]);

        ffmpeg.stdout.pipe(res);

        ffmpeg.stderr.on('data', (data) => {
            // Optional: log ffmpeg errors for debugging
            // logger.debug(`Mirror FFmpeg: ${data}`);
        });

        req.on('close', () => {
            ffmpeg.kill('SIGKILL');
        });
    });

    app.get('/', (req, res) => {
        res.send(`
            <html>
                <head>
                    <title>GHOST Mirror | Stealth Dashboard</title>
                    <style>
                        body { background: #000; color: #fff; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
                        img { max-width: 100%; border: 2px solid #333; border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
                        .header { margin-bottom: 10px; font-weight: bold; color: #ff3e3e; text-transform: uppercase; letter-spacing: 2px; }
                        .status { font-size: 12px; color: #888; margin-top: 10px; }
                    </style>
                </head>
                <body>
                    <div class="header">🛰 GHOST MIRROR | LIVE FEED</div>
                    <img src="/live" onerror="this.src='/live'" />
                    <div class="status">ULTRA-LOW LATENCY STEALTH STREAM ACTIVE</div>
                </body>
            </html>
        `);
    });

    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`GHOST Mirror Dashboard is ready at http://localhost:${PORT}`);
    });
}

function stopMirror() {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
    }
}

module.exports = { startMirror, stopMirror };
