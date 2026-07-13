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
    logger.info("Initiating ULTRA-ROBUST stopRecording sequence...");

    try {
        // 1. UPDATE UI: STEP 1
        await updateStatus('STOPPING', 10);
        logger.info("Step 1: Sending SIGINT to FFmpeg via pkill...");

        // Use shell-level pkill for maximum reliability
        exec('pkill -SIGINT ffmpeg');

        // Background browser kill - don't let it block us
        const browserManager = require('./browser');
        browserManager.closeBrowser().catch(e => logger.error(`Background cleanup error: ${e.message}`));

        // 2. FIXED SLEEP (Wait for FFmpeg to flush MKV)
        await new Promise(r => setTimeout(r, 6000));
        logger.info("Step 2: Grace period over. Ensuring FFmpeg is dead...");
        exec('pkill -9 ffmpeg');

        // 3. SECURE ASSETS
        await updateStatus('FINALIZING', 30);

        if (!fs.existsSync(rawVideoPath) || fs.statSync(rawVideoPath).size < 1000) {
            logger.error("Critical Error: Raw MKV file is missing or empty.");
            return { videoChunks: [], audioPath: null, transcriptPath: null };
        }

        // 4. CONVERSION (With Fallback)
        await updateStatus('FINALIZING', 50);
        logger.info("Step 3: Converting/Optimizing Video...");

        let processedVideoPath = masterMp4Path;
        try {
            // Attempt fast conversion
            await execPromise(`ffmpeg -i "${rawVideoPath}" -c copy -movflags +faststart -y "${masterMp4Path}"`);
        } catch (e) {
            logger.warn(`Conversion failed: ${e.message}. Falling back to RAW MKV.`);
            processedVideoPath = rawVideoPath; // Use the raw file if conversion fails
        }

        // 5. CHUNKING
        await updateStatus('FINALIZING', 70);
        let videoChunks = [];
        if (processedVideoPath === masterMp4Path) {
            videoChunks = await processChunks(masterMp4Path);
        } else {
            videoChunks = [processedVideoPath];
        }

        videoChunks = videoChunks.filter(f => fs.existsSync(f) && fs.statSync(f).size > 0);

        // 6. TRANSCRIPTION (Non-blocking)
        let transcriptPath = null;
        if (fs.existsSync(audioExtractPath) && fs.statSync(audioExtractPath).size > 5000) {
            try {
                logger.info("Step 4: Background Transcription...");
                const transPromise = transcriber.transcribe(audioExtractPath);
                const transTimeout = new Promise(r => setTimeout(() => r(null), 4 * 60 * 1000));
                transcriptPath = await Promise.race([transPromise, transTimeout]);
            } catch (e) {
                logger.error(`Transcription skipped: ${e.message}`);
            }
        }

        await updateStatus('FINALIZING', 95);
        logger.info("Ultra-Robust sequence complete.");
        return {
            videoChunks,
            audioPath: (fs.existsSync(audioExtractPath) && fs.statSync(audioExtractPath).size > 0) ? audioExtractPath : null,
            transcriptPath
        };

    } catch (err) {
        logger.error(`ULTRA-ROBUST FATAL ERROR: ${err.message}`);
        return {
            videoChunks: fs.existsSync(rawVideoPath) ? [rawVideoPath] : [],
            audioPath: fs.existsSync(audioExtractPath) ? audioExtractPath : null,
            transcriptPath: null
        };
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