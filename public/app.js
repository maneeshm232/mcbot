const socket = io();

const els = {
  badge: document.querySelector('#connectionBadge'), sender: document.querySelector('#senderPanel'),
  receiver: document.querySelector('#receiverPanel'), roomCode: document.querySelector('#roomCode'),
  qr: document.querySelector('#qr'), waiting: document.querySelector('#waitingText'),
  fileInput: document.querySelector('#fileInput'), copyLink: document.querySelector('#copyLink'),
  transferCard: document.querySelector('#transferCard'), transferName: document.querySelector('#transferName'),
  progressBar: document.querySelector('#progressBar'), progressText: document.querySelector('#progressText'),
  speedText: document.querySelector('#speedText'), cancelButton: document.querySelector('#cancelButton')
};

let room = new URLSearchParams(location.search).get('room')?.toUpperCase();
let peerId = null;
let pc = null;
let channel = null;
let isHost = !room;
let files = [];
let fileIndex = 0;
let cancelRequested = false;
let receive = null;

function makeRoom() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

function joinRoom() {
  socket.emit('join-room', room, (result) => {
    if (!result.ok) {
      els.waiting.textContent = result.error;
      els.badge.textContent = 'Unavailable';
      return;
    }
    peerId = result.peerId;
    els.roomCode.textContent = room;
    if (peerId) connected(peerId);
  });
}

socket.on('connect', () => {
  els.badge.textContent = 'Ready';
  els.badge.classList.add('online');
  if (isHost) room = makeRoom();
  joinRoom();
  els.roomCode.textContent = room;

  if (isHost) {
    const link = `${location.origin}${location.pathname}?room=${room}`;
    els.qr.replaceChildren();
    new QRCode(els.qr, { text: link, width: 176, height: 176, correctLevel: QRCode.CorrectLevel.M });
    els.copyLink.onclick = async () => {
      await navigator.clipboard.writeText(link);
      els.copyLink.textContent = 'Copied';
      setTimeout(() => els.copyLink.textContent = 'Copy link', 1500);
    };
  } else {
    els.sender.hidden = true;
    els.receiver.hidden = false;
  }
});

socket.on('peer-ready', (id) => connected(id));
socket.on('peer-left', () => {
  els.waiting.textContent = 'The other device disconnected';
  els.badge.textContent = 'Disconnected';
  els.badge.classList.remove('online');
  pc?.close(); pc = null; channel = null; peerId = null;
});
socket.on('signal', async ({ to, description, candidate }) => {
  if (!pc) return;
  try {
    if (description) {
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', room, { description: pc.localDescription });
      }
    } else if (candidate) await pc.addIceCandidate(candidate);
  } catch (err) { console.error(err); }
});

async function connected(id) {
  peerId = id;
  els.waiting.textContent = 'Device connected';
  els.badge.textContent = 'Connected';
  els.badge.classList.add('online');
  if (!pc) await createConnection();
}

async function createConnection() {
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('signal', room, { candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      els.waiting.textContent = 'Connection lost';
    }
  };

  if (isHost) {
    channel = pc.createDataChannel('files', { ordered: true });
    setupChannel();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', room, { description: pc.localDescription });
  } else {
    pc.ondatachannel = ({ channel: incoming }) => { channel = incoming; setupChannel(); };
  }
}

function setupChannel() {
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => {
    els.waiting.textContent = 'Ready to transfer';
    els.fileInput.disabled = false;
  };
  channel.onclose = () => els.waiting.textContent = 'Connection closed';
  channel.onmessage = async (event) => {
    if (typeof event.data === 'string') {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'metadata') {
        receive = { name: message.name, mime: message.mime, size: message.size, index: message.index, total: message.total, chunks: [], received: 0, started: performance.now() };
        showTransfer(message.name, 0, 'Receiving');
      } else if (message.type === 'complete') {
        const blob = new Blob(receive.chunks, { type: receive.mime });
        downloadBlob(blob, receive.name);
        updateTransfer(receive.size, receive.size, receive.started);
        els.speedText.textContent = 'Received';
        receive = null;
      } else if (message.type === 'cancel') {
        receive = null;
        els.transferName.textContent = 'Transfer cancelled';
        els.speedText.textContent = '';
      }
    } else if (receive) {
      receive.chunks.push(event.data);
      receive.received += event.data.byteLength;
      updateTransfer(receive.received, receive.size, receive.started);
    }
  };
}

els.fileInput.addEventListener('change', () => {
  files = [...els.fileInput.files];
  if (files.length && channel?.readyState === 'open') sendFiles();
});

async function sendFiles() {
  cancelRequested = false;
  for (fileIndex = 0; fileIndex < files.length; fileIndex++) {
    if (cancelRequested) break;
    await sendFile(files[fileIndex], fileIndex, files.length);
  }
}

async function sendFile(file, index, total) {
  channel.send(JSON.stringify({ type: 'metadata', name: file.name, mime: file.type, size: file.size, index: index + 1, total }));
  showTransfer(file.name, 0, 'Sending');
  const started = performance.now();
  let offset = 0;
  const chunkSize = 64 * 1024;

  while (offset < file.size) {
    if (cancelRequested) {
      channel.send(JSON.stringify({ type: 'cancel' }));
      els.transferName.textContent = 'Transfer cancelled';
      return;
    }
    if (channel.bufferedAmount > 1024 * 1024) {
      await new Promise((resolve) => {
        channel.addEventListener('bufferedamountlow', resolve, { once: true });
        setTimeout(resolve, 50);
      });
    }
    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
    channel.send(chunk);
    offset += chunk.byteLength;
    updateTransfer(offset, file.size, started);
  }
  channel.send(JSON.stringify({ type: 'complete' }));
  els.speedText.textContent = 'Sent';
}

els.cancelButton.addEventListener('click', () => {
  cancelRequested = true;
  if (!isHost && channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'cancel' }));
});

function showTransfer(name, percent, action) {
  els.transferCard.hidden = false;
  els.transferName.textContent = `${action}: ${name}`;
  els.progressBar.style.width = `${percent}%`;
  els.progressText.textContent = `${percent}%`;
}

function updateTransfer(done, total, started) {
  const percent = total ? Math.round(done / total * 100) : 100;
  els.progressBar.style.width = `${percent}%`;
  els.progressText.textContent = `${percent}% (${formatBytes(done)} / ${formatBytes(total)})`;
  const elapsed = Math.max((performance.now() - started) / 1000, .1);
  els.speedText.textContent = `${formatBytes(done / elapsed)}/s`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
