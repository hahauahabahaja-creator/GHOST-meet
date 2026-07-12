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

    // Log ffmpeg output for debugging
    ffmpegProcess.stderr.on('data', (data) => {
        if (data.toString().includes('Error')) logger.error(`FFmpeg Log: ${data.toString()}`);
    });
}

async function stopRecording() {
    if (ffmpegProcess) {
        logger.info("Stopping FFMPEG process...");

        return new Promise((resolve) => {
            const forceKill = setTimeout(() => {
                logger.warn("FFmpeg hang detected, forcing kill...");
                ffmpegProcess.kill('SIGKILL');
            }, 15000);

            ffmpegProcess.on('exit', async () => {
                clearTimeout(forceKill);
                logger.info("FFmpeg exited. Starting post-processing...");

                try {
                    // MKV -> MP4
                    if (fs.existsSync(rawVideoPath)) {
                        logger.info("Converting to MP4...");
                        execSync(`ffmpeg -i "${rawVideoPath}" -c copy -movflags +faststart -y "${masterMp4Path}"`);
                    }

                    // 1. Chunking
                    const videoChunks = await processChunks(masterMp4Path);

                    // 2. Transcription
                    logger.info("Starting AI Transcription...");
                    const transcriptPath = await transcriber.transcribe(audioExtractPath);

                    resolve({ videoChunks, transcriptPath });
                } catch (err) {
                    logger.error(`Post-processing Error: ${err.message}`);
                    resolve({ videoChunks: [], transcriptPath: null });
                }
            });

            // Graceful stop
            ffmpegProcess.stdin.write('q');
        });
    }
    return { videoChunks: [], transcriptPath: null };
}

async function processChunks(filePath) {
    if (!fs.existsSync(filePath)) {
        logger.error("Master recording not found.");
        return [];
    }

    const stats = fs.statSync(filePath);
    const MAX_SIZE = 45 * 1024 * 1024;

    if (stats.size <= MAX_SIZE) return [filePath];

    try {
        const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
        const duration = parseFloat(durationStr);
        const segmentTime = Math.floor((MAX_SIZE / stats.size) * duration * 0.95);

        const outputPattern = path.join(chunksDir, 'GHOST_meet_Part_%03d.mp4');
        execSync(`ffmpeg -i "${filePath}" -f segment -segment_time ${segmentTime} -c copy -reset_timestamps 1 -movflags +faststart "${outputPattern}"`);

        return fs.readdirSync(chunksDir)
            .filter(f => f.endsWith('.mp4'))
            .map(f => path.join(chunksDir, f))
            .sort();
    } catch (error) {
        logger.error(`Chunking Error: ${error.message}`);
        return [filePath];
    }
}

module.exports = { startRecording, stopRecording };
