const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const transcriber = require('./transcriber');

let ffmpegProcess = null;
const outputDir = path.join(__dirname, '../../output');
const rawVideoPath = path.join(outputDir, 'meeting_master.mp4');
const audioExtractPath = path.join(outputDir, 'meeting_audio.wav');
const chunksDir = path.join(outputDir, 'chunks');

/**
 * Initiates HD FFMPEG capture directly from the virtual frame buffer :99
 */
async function startRecording() {
    await fs.ensureDir(outputDir);
    await fs.emptyDir(outputDir); // Clear previous session data
    await fs.ensureDir(chunksDir);

    logger.info("Initializing HD Stream Capture on :99...");

    /**
     * FFMPEG CONFIGURATION:
     * -f x11grab: Capture the virtual display
     * -video_size 1920x1080: Full HD resolution
     * -i :99.0: Target Xvfb display
     * -f pulse -i default: Capture high-quality system audio
     * -c:v libx264: H.264 encoding
     * -preset ultrafast: Minimize CPU overhead for Render compatibility
     * -crf 23: Balance quality and file size
     */
    ffmpegProcess = spawn('ffmpeg', [
        '-f', 'x11grab',
        '-video_size', '1920x1080',
        '-framerate', '30',
        '-i', ':99.0',
        '-f', 'pulse',
        '-i', 'default',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-y', rawVideoPath,
        // Separate high-quality wav for AI transcription
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', audioExtractPath
    ]);

    ffmpegProcess.on('error', (err) => logger.error(`FFMPEG Startup Error: ${err.message}`));
}

/**
 * Stops capture and triggers the post-processing pipeline
 */
async function stopRecording() {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
        // Allow FFMPEG to flush buffers and finalize the mp4 container
        await new Promise(resolve => setTimeout(resolve, 6000));
    }

    logger.info("Master recording finalized. Initiating segmenting and transcription...");

    // 1. Transcription (Triggered immediately)
    const transcriptionPromise = transcriber.transcribe(audioExtractPath);

    // 2. Video Chunking (Strict 40MB limit for Telegram)
    const videoChunks = await processChunks(rawVideoPath);

    const transcriptPath = await transcriptionPromise;

    return {
        videoChunks,
        transcriptPath
    };
}

/**
 * Post-processing script: Splits recording into 40MB chunks using stream-copy (-c copy)
 */
async function processChunks(filePath) {
    if (!fs.existsSync(filePath)) {
        logger.error("Master recording not found. Chunking aborted.");
        return [];
    }

    const stats = fs.statSync(filePath);
    const MAX_SIZE = 40 * 1024 * 1024; // 40MB in bytes

    if (stats.size <= MAX_SIZE) {
        logger.info("File size below 40MB. Skipping segmentation.");
        return [filePath];
    }

    logger.info(`Processing ${stats.size} bytes. Target chunk size: 40MB.`);

    try {
        // Calculate duration to estimate segment timing
        const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
        const duration = parseFloat(durationStr);

        // Estimate segment time: (Target Size / Total Size) * Total Duration
        const segmentTime = Math.floor((MAX_SIZE / stats.size) * duration * 0.95); // 5% buffer to stay safe

        logger.info(`Segmenting with -c copy every ${segmentTime} seconds...`);

        const outputPattern = path.join(chunksDir, 'GHOST_meet_Part_%03d.mp4');

        // -c copy is instant and zero-CPU as it doesn't re-encode
        execSync(`ffmpeg -i "${filePath}" -f segment -segment_time ${segmentTime} -c copy -reset_timestamps 1 "${outputPattern}"`);

        const chunkFiles = fs.readdirSync(chunksDir)
            .filter(f => f.endsWith('.mp4'))
            .map(f => path.join(chunksDir, f));

        return chunkFiles.sort();
    } catch (error) {
        logger.error(`Chunking Error: ${error.message}`);
        return [filePath]; // Fallback to master file if chunking fails
    }
}

module.exports = {
    startRecording,
    stopRecording
};
