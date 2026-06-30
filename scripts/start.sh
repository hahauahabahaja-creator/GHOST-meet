#!/bin/bash

# Initialize DBUS for Pulseaudio
mkdir -p /var/run/dbus
dbus-daemon --config-file=/usr/share/dbus-1/system.conf --print-address

# Start Pulseaudio in the background
pulseaudio -D --exit-idle-time=-1

# Create a virtual sink to capture audio
pactl load-module module-virtual-sink sink_name=v_sink
pactl set-default-sink v_sink

# Start the Node.js application
npm start
