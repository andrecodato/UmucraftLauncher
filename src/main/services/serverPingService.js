'use strict';
const net = require('net');

function pingMinecraftServer(host, port = 25565, timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      const ping = Date.now() - start;
      // Send MC handshake + status request
      const hostBuf = Buffer.from(host, 'utf8');
      const handshake = Buffer.alloc(7 + hostBuf.length);
      let off = 0;
      handshake[off++] = handshake.length - 1;
      handshake[off++] = 0x00;
      handshake[off++] = 0x00;
      handshake[off++] = hostBuf.length;
      hostBuf.copy(handshake, off); off += hostBuf.length;
      handshake.writeUInt16BE(port, off); off += 2;
      handshake[off++] = 0x01;

      const statusRequest = Buffer.from([0x01, 0x00]);

      socket.write(handshake);
      socket.write(statusRequest);

      let responseData = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        responseData = Buffer.concat([responseData, chunk]);
        try {
          const str = responseData.toString('utf8');
          const jsonStart = str.indexOf('{');
          const jsonEnd = str.lastIndexOf('}');
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            const json = JSON.parse(str.substring(jsonStart, jsonEnd + 1));
            socket.destroy();
            resolve({
              online: true,
              ping,
              players: json.players || { online: 0, max: 0 },
              description: json.description,
              version: json.version?.name || '',
            });
          }
        } catch {}
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ online: false, ping: -1 });
    });

    socket.on('error', () => {
      socket.destroy();
      resolve({ online: false, ping: -1 });
    });

    socket.connect(port, host);
  });
}

module.exports = { pingMinecraftServer };
