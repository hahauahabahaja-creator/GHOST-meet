# GHOST meet - Setup & Deployment Documentation

This document provides step-by-step instructions for deploying the GHOST meet automated meeting capture suite.

## 1. Telegram Bot Configuration
To interface with GHOST meet, you must create and authorize a Telegram Bot.

1.  **BotFather Creation**:
    - Open Telegram and search for `@BotFather`.
    - Send `/newbot`.
    - Name your bot (e.g., `GHOST_meet_Bot`).
    - Choose a username ending in `bot`.
    - **SAVE THE API TOKEN**: This is your `TELEGRAM_BOT_TOKEN`.
2.  **Privacy Settings**:
    - In `@BotFather`, send `/setprivacy`.
    - Select your bot.
    - Choose `Disable`. This ensures the bot can read messages containing meeting links.
3.  **Group Identification**:
    - Add the bot to your authorized Telegram Group.
    - Add `@myidbot` to the same group and send `/id`.
    - The ID (starting with `-100`) is your `ALLOWED_GROUP_ID`.
    - Send a message to the bot and check `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your personal `TELEGRAM_CHAT_ID`.

## 2. External Services
1.  **Ngrok**:
    - Sign up at [ngrok.com](https://ngrok.com).
    - Navigate to your dashboard and copy your `Authtoken`.
    - This is your `NGROK_AUTH_TOKEN`.
2.  **GitHub**:
    - Create a **Public** repository.
    - Navigate to `Settings` -> `Secrets and variables` -> `Actions`.
    - Add the following Secrets:
        - `TELEGRAM_BOT_TOKEN`
        - `TELEGRAM_CHAT_ID`
        - `ALLOWED_GROUP_ID`
        - `NGROK_AUTH_TOKEN`

## 3. Render Deployment (Linux Persistent Environment)
GHOST meet runs inside a Docker container on Render to ensure all dependencies (FFMPEG, Puppeteer, Xvfb) are met.

1.  **Create Service**:
    - Log in to [Render](https://render.com).
    - Click `New` -> `Web Service`.
    - Connect your GitHub repository.
2.  **Configuration**:
    - **Runtime**: `Docker`.
    - **Instance Type**: `Starter` (2GB RAM) is mandatory for stable recording.
3.  **Environment Variables**:
    - Add the secrets listed in the GitHub section.
    - Add `PORT` = `8080`.
    - Add `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` = `true` (if using system chromium).
4.  **Health Check**:
    - Set the health check path to `/`.

## 4. Operational Flow
1.  Invite the bot to your group.
2.  Send `/join <link>` to initialize the virtual display.
3.  Access the Ngrok link provided to handle manual login (if required).
4.  Send `/record` to start capturing.
5.  Send `/stop` to finalize, split, and upload.

---
**END OF DOCUMENT**
