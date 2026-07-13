FROM node:18-slim

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    xvfb \
    x11vnc \
    fluxbox \
    dbus-x11 \
    ffmpeg \
    python3 \
    python3-pip \
    chromium \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages SpeechRecognition

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium

EXPOSE 8080
EXPOSE 5900

CMD ["sh", "scripts/start.sh"]
