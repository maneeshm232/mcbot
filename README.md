# Hotspot Share

A private, browser-based app for transferring files between devices connected to the same 2.4 GHz or 5 GHz Wi-Fi network.

## Features

- Direct browser-to-browser file transfer using WebRTC
- QR-code and link-based room pairing
- Real-time progress, transfer speed, and cancellation

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` on the sender. On another device, open the page using the sender computer's LAN address (for example `http://192.168.1.20:3000`) and scan the QR code.

## Deploy

Set `PORT` if required and run `npm start`. The app can be deployed to any Node.js host. HTTPS is recommended for public deployments. The Socket.IO server only exchanges WebRTC signaling messages; file data travels directly between browsers.

## Network requirement

The devices need a route between them. Some corporate, guest, or public Wi-Fi networks block peer-to-peer traffic. A phone hotspot can be used when both devices are on the hotspot network.
