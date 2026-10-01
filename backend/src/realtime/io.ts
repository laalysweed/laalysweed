import type { Server } from 'socket.io';

/** Thin holder so services can emit without importing the socket bootstrap (avoids import cycles). */
let io: Server | null = null;

export const setIo = (server: Server) => {
  io = server;
};
export const getIo = () => io;

export const toUser = (userId: unknown, event: string, payload: unknown) => io?.to(`user:${String(userId)}`).emit(event, payload);
export const toSymbol = (symbol: string, event: string, payload: unknown) => io?.to(`sym:${symbol}`).emit(event, payload);
export const toRoom = (room: string, event: string, payload: unknown) => io?.to(room).emit(event, payload);
export const toAdmins = (event: string, payload: unknown) => io?.to('admins').emit(event, payload);
export const toAll = (event: string, payload: unknown) => io?.emit(event, payload);
