const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const transcriber = require('./transcriber');

let ffmpegProcess = null;
const outputDir = path.join(__dirname, '../../output');
const rawVideoPath = path.join(outputDir, 'meeting_master.mkv');
const masterMp4Path = path.join(outputDir, 'meeting_master.mp4');
const audioExtractPath = path.join(outputDir, 'meeting_audio.wav');
const chunksDir = path.join(outputDir, 'chunks');

async function startRecording() {
    await fs.ensureDir(outputDir);
    await fs.emptyDir(outputDir);
    await fs.ensureDir(chunksDir);

    logger.info("Initializing HD Stream Capture on :99...");

    ffmpegProcess = spawn('ffmpeg', [
        '-f', 'x11grab',
        '-video_size', '1920x1080',
        '-framerate', '30',
        '-i', ':99.0',
        '-f', 'pulse',
        '-i', 'v_sink.monitor',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-y', rawVideoPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-af', 'loudnorm', audioExtractPath
    ]);

    ffmpegProcess.on('error', (err) => logger.error(`FFMPEG Startup Error: ${err.message}`));
}

async function stopRecording() {
    return new Promise(async (resolve) => {
        logger.info("Stopping FFMPEG process...");

        if (!ffmpegProcess) {
            logger.warn("No active FFmpeg process to stop.");
            return resolve({ videoChunks: [], transcriptPath: null });
        }

        // 1. Force Browser to close first (Leaves meeting)
        try {
            logger.info("Triggering browser close to leave meeting...");
            const browserManager = require('./browser'); // Lazy load
            await browserManager.closeBrowser();
        } catch (e) {
            logger.warn("Manual browser close failed:", e.message);
        }

        // 2. Kill FFmpeg aggressively to ensure it stops
        const forceKill = setTimeout(() => {
            logger.warn("FFmpeg hang detected, forcing SIGKILL...");
            ffmpegProcess.kill('SIGKILL');
        }, 5000);

        ffmpegProcess.on('exit', async () => {
            clearTimeout(forceKill);
            logger.info("FFmpeg process terminated. Starting cleanup...");

            try {
                // Wait 2s for file handles to release
                await new Promise(r => setTimeout(r, 2000));

                if (!fs.existsSync(rawVideoPath)) {
                    throw new Error("Master recording (MKV) not found.");
                }

                logger.info("Converting MKV to MP4...");
                execSync(`ffmpeg -i "${rawVideoPath}" -c copy -movflags +faststart -y "${masterMp4Path}"`);

                logger.info("Splitting video into chunks...");
                const videoChunks = await processChunks(masterMp4Path);

                logger.info("Starting Whisper AI Transcription...");
                const transcriptPath = await transcriber.transcribe(audioExtractPath);

                resolve({ videoChunks, audioPath: audioExtractPath, transcriptPath });
            } catch (err) {
                logger.error(`Post-processing Failure: ${err.message}`);
                resolve({ videoChunks: [], audioPath: null, transcriptPath: null });
            }
        });

        // Try graceful quit first
        try {
            ffmpegProcess.stdin.write('q');
        } catch (e) {
            ffmpegProcess.kill('SIGTERM');
        }
    });
}

async function processChunks(filePath) {
    if (!fs.existsSync(filePath)) return [];

    const stats = fs.statSync(filePath);
    const MAX_SIZE = 40 * 1024 * 1024; // 40MB limit for safety

    if (stats.size <= MAX_SIZE) return [filePath];

    try {
        const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
        const duration = parseFloat(durationStr);
        const chunkDuration = Math.floor((MAX_SIZE / stats.size) * duration * 0.9);

        const outputPattern = path.join(chunksDir, 'GHOST_meet_Part_%03d.mp4');
        execSync(`ffmpeg -i "${filePath}" -f segment -segment_time ${chunkDuration} -c copy -reset_timestamps 1 -movflags +faststart "${outputPattern}"`);

        return fs.readdirSync(chunksDir)
            .filter(f => f.endsWith('.mp4'))
            .map(f => path.join(chunksDir, f))
            .sort();
    } catch (e) {
        logger.error(`Chunking error: ${e.message}`);
        return [filePath];
    }
}

module.exports = { startRecording, stopRecording };
