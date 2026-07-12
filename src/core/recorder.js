const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
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

// NEW: Progress tracking for UI
let currentProgressCallback = null;
function setProgressCallback(cb) { currentProgressCallback = cb; }

async function updateStatus(status, progress) {
    if (currentProgressCallback) {
        // Run callback without blocking the main recorder flow indefinitely
        currentProgressCallback(status, progress).catch(err => {
            logger.warn(`Progress UI Update Failed: ${err.message}`);
        });
    }
}

async function startRecording() {
    await fs.ensureDir(outputDir);
    await fs.emptyDir(outputDir);
    await fs.ensureDir(chunksDir);

    logger.info("Initializing HD Stream Capture on :99...");

    // Unified FFmpeg process for video and audio
    ffmpegProcess = spawn('ffmpeg', [
        '-f', 'x11grab',
        '-video_size', '1920x1080',
        '-framerate', '30',
        '-i', ':99.0',
        '-f', 'pulse',
        '-i', 'v_sink.monitor',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28', // Slightly lower quality for faster processing/smaller size
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-y', rawVideoPath,
        // Separate audio-only stream for transcription (Resilient to silence)
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioExtractPath
    ]);

    ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Error')) logger.error(`FFMPEG Error: ${output}`);
    });
}

async function stopRecording() {
    logger.info("Initiating stopRecording sequence...");

    // 1. Force Browser to close first (Leaves meeting)
    try {
        await updateStatus('STOPPING', 10);
        logger.info("Triggering browser close to leave meeting...");
        const browserManager = require('./browser');

        // Timeout for browser close to prevent hang
        const browserClosePromise = browserManager.closeBrowser();
        const timeoutPromise = new Promise(r => setTimeout(r, 15000)); // 15s max
        await Promise.race([browserClosePromise, timeoutPromise]);
    } catch (e) {
        logger.warn("Browser close during stop failed or timed out:", e.message);
    }

    // 2. Stop FFmpeg
    if (ffmpegProcess && !ffmpegProcess.killed) {
        logger.info("Stopping active FFmpeg process...");
        try {
            ffmpegProcess.stdin.write('q');
        } catch (e) {
            ffmpegProcess.kill('SIGTERM');
        }

        // Wait for exit or force kill
        await new Promise((resolve) => {
            const forceKill = setTimeout(() => {
                logger.warn("FFmpeg hang detected, forcing SIGKILL...");
                if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');
                resolve();
            }, 8000);

            ffmpegProcess.on('exit', () => {
                clearTimeout(forceKill);
                logger.info("FFmpeg exited.");
                resolve();
            });
        });
    }

    // 3. Post-Processing
    try {
        await new Promise(r => setTimeout(r, 2000));

        if (!fs.existsSync(rawVideoPath)) {
            logger.error("Master recording (MKV) not found.");
            return { videoChunks: [], audioPath: null, transcriptPath: null };
        }

        await updateStatus('FINALIZING', 20);
        logger.info("Converting MKV to MP4...");
        try {
            await execPromise(`ffmpeg -i "${rawVideoPath}" -c copy -movflags +faststart -y "${masterMp4Path}"`);
        } catch (e) {
            logger.warn(`Fast conversion failed: ${e.message}. Trying re-encoding...`);
            await execPromise(`ffmpeg -i "${rawVideoPath}" -c:v libx264 -preset superfast -crf 28 -c:a aac -y "${masterMp4Path}"`);
        }

        await updateStatus('FINALIZING', 40);
        logger.info("Splitting video into chunks...");
        let videoChunks = await processChunks(masterMp4Path);

        // Final sanity check on chunks
        videoChunks = videoChunks.filter(f => fs.existsSync(f) && fs.statSync(f).size > 0);

        await updateStatus('FINALIZING', 60);

        let transcriptPath = null;
        if (fs.existsSync(audioExtractPath) && fs.statSync(audioExtractPath).size > 1000) {
            try {
                logger.info("Starting Whisper AI Transcription...");
                const transcriptionPromise = transcriber.transcribe(audioExtractPath);
                const transcriptionTimeout = new Promise(r => setTimeout(() => r(null), 5 * 60 * 1000)); // 5 min max
                transcriptPath = await Promise.race([transcriptionPromise, transcriptionTimeout]);
            } catch (e) {
                logger.error(`Transcription failed: ${e.message}`);
            }
        } else {
            logger.warn("Audio file too small or missing, skipping transcription.");
        }

        await updateStatus('FINALIZING', 90);
        logger.info("Stop sequence complete.");
        return {
            videoChunks,
            audioPath: (fs.existsSync(audioExtractPath) && fs.statSync(audioExtractPath).size > 0) ? audioExtractPath : null,
            transcriptPath
        };
    } catch (err) {
        logger.error(`Post-processing Failure: ${err.message}`);
        return { videoChunks: [], audioPath: null, transcriptPath: null };
    }
}

async function processChunks(filePath) {
    if (!fs.existsSync(filePath)) return [];

    const stats = fs.statSync(filePath);
    const MAX_SIZE = 45 * 1024 * 1024; // 45MB limit

    if (stats.size <= MAX_SIZE) return [filePath];

    try {
        const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        const duration = parseFloat(stdout.trim());
        const chunkDuration = Math.floor((MAX_SIZE / stats.size) * duration * 0.9);

        const outputPattern = path.join(chunksDir, 'GHOST_meet_Part_%03d.mp4');
        await execPromise(`ffmpeg -i "${filePath}" -f segment -segment_time ${chunkDuration} -c copy -reset_timestamps 1 -movflags +faststart "${outputPattern}"`);

        return fs.readdirSync(chunksDir)
            .filter(f => f.endsWith('.mp4'))
            .map(f => path.join(chunksDir, f))
            .sort();
    } catch (e) {
        logger.error(`Chunking error: ${e.message}`);
        return [filePath];
    }
}

module.exports = { startRecording, stopRecording, setProgressCallback };