import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyAccess } from '../lib/jwt';
import { setIo } from './io';
import { marketHub } from '../market/market-hub';
import { sentimentCache } from '../trading/sentiment';
import { sentimentPct } from '../trading/trade.service';

const MAX_SYMBOL_ROOMS = 8;

export function initSockets(http: HttpServer, corsOrigins: string[]) {
  const io = new Server(http, {
    cors: { origin: corsOrigins, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  // Auth is optional: anonymous sockets (landing page) may only join public market rooms.
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (token) {
      try {
        const c = verifyAccess(token);
        socket.data['user'] = { sub: c.sub, role: c.role };
      } catch {
        return next(new Error('TOKEN_EXPIRED'));
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data['user'] as { sub: string; role: string } | undefined;
    if (user) {
      void socket.join(`user:${user.sub}`);
      if (user.role === 'admin') void socket.join('admins');
    }

    socket.on('market:subscribe', (symbol: unknown) => {
      if (typeof symbol !== 'string' || !marketHub.getAsset(symbol)) return;
      const rooms = [...socket.rooms].filter((r) => r.startsWith('sym:'));
      if (rooms.length >= MAX_SYMBOL_ROOMS) void socket.leave(rooms[0]!);
      void socket.join(`sym:${symbol}`);
      const t = marketHub.latest(symbol);
      if (t) socket.emit('tick', { s: symbol, p: t.price, t: t.ts });
      socket.emit('sentiment', { symbol, ...sentimentPct(sentimentCache.get(symbol)) });
    });

    socket.on('market:unsubscribe', (symbol: unknown) => {
      if (typeof symbol === 'string') void socket.leave(`sym:${symbol}`);
    });

    socket.on('summary:subscribe', () => {
      void socket.join('summary');
      socket.emit('market:summary', marketHub.summary());
    });
    socket.on('summary:unsubscribe', () => void socket.leave('summary'));

    for (const room of ['signals', 'tournaments'] as const) {
      socket.on(`${room}:subscribe`, () => {
        if (user) void socket.join(room);
      });
      socket.on(`${room}:unsubscribe`, () => void socket.leave(room));
    }
  });

  setIo(io);
  return io;
}
