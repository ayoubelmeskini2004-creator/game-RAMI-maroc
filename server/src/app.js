import express from 'express';
import { createServer } from 'node:http';
import { randomInt, randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createRound, seatingOrder, publicGame, privateGame, drawCard, discardCard, INVALID_MOVE } from './game.js';
import { stageGroups, undoStaging, retrieveStaged, stageCollage, recoverJoker, reverseJokerRecovery } from './descente.js';
import { validThreshold, createMatch, recordRound, matchView } from './scoring.js';
import { moveGroup } from './group-layout.js';
import { actOnTurn } from './turns.js';
import { cancelPickup } from './pickup-return.js';

export function createApp({ makeRound = createRound, now = Date.now, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map();
  const sessions = new Map();
  const timers = new Map();
  httpServer.on('close', () => { for (const timer of timers.values()) unschedule(timer); timers.clear(); });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(fileURLToPath(new URL('../../client/dist/', import.meta.url))));

  function canStart(room) {
    return room.status === 'lobby' && room.players.length >= 2 && room.players.length <= 4
      && room.players.every((p) => p.connected && p.ready)
      && (room.mode === 'individual' || (room.players.length === 4
        && room.players.filter((p) => p.team === 'A').length === 2
        && room.players.filter((p) => p.team === 'B').length === 2));
  }
  function snapshot(room) {
    return { code: room.code, hostId: room.hostId, mode: room.mode, status: room.status,
      threshold: room.threshold, match: matchView(room.match, now()),
      canStart: canStart(room) && !room.match?.finished, chat: room.chat, game: publicGame(room.game),
      players: room.players.map(({ token, socketId, ...player }) => player) };
  }
  function gameView(room, playerId) {
    const game = privateGame(room.game, playerId);
    game.match = matchView(room.match, now());
    game.pauseReason = room.players.some((p) => p.departed) ? 'player-left'
      : !room.players.find((p) => p.id === game.activePlayerId)?.connected ? 'active-disconnected' : null;
    return game;
  }
  function publishGame(room) {
    if (!room.game) return;
    // Never broadcast private hands to the room, including during resume and host changes.
    for (const player of room.players) {
      if (player.connected && player.socketId) io.to(player.socketId).emit('game:update', { code: room.code, game: gameView(room, player.id) });
    }
  }
  function publish(room) {
    io.to(room.code).emit('room:update', snapshot(room));
    publishGame(room);
  }
  function electHost(room) {
    if (!room.players.some((p) => p.id === room.hostId && p.connected)) {
      room.hostId = room.players.find((p) => p.connected)?.id ?? null;
    }
  }
  function cancelTimer(room) {
    if (timers.has(room.code)) unschedule(timers.get(room.code));
    timers.delete(room.code);
    if (room.match) room.match.nextRoundAt = null;
  }
  function beginRound(room) {
    // A cancelled attempt is replayed with its original starter and round number.
    const retry = room.replayRound;
    const previous = retry ? { order: retry.order, round: retry.round - 1,
      starterId: retry.order[(retry.order.indexOf(retry.starterId) + retry.order.length - 1) % retry.order.length] }
      : room.lastCompleted ?? null;
    const order = room.match ? room.order : seatingOrder(room.players, room.mode);
    const game = makeRound(order, previous);
    game.mode = room.mode;
    game.teams = Object.fromEntries(room.players.map((p) => [p.id, p.team]));
    room.order = order;
    room.game = game;
    room.replayRound = null;
    if (!room.match) room.match = createMatch(room.players, room.mode, room.threshold);
    room.match.nextRoundAt = null;
    room.status = 'playing';
  }
  function completeRound(room) {
    recordRound(room.match, room.game.roundResult, now());
    room.lastCompleted = { order: [...room.game.order], starterId: room.game.starterId, round: room.game.round };
    if (!room.match.finished) {
      const due = room.match.nextRoundAt;
      const roundId = room.game.roundId;
      const timer = schedule(() => {
        timers.delete(room.code);
        if (room.status !== 'playing' || room.game?.roundId !== roundId || room.match.finished || room.match.nextRoundAt !== due) return;
        beginRound(room);
        publish(room);
      }, Math.max(0, due - now()));
      timer?.unref?.(); timers.set(room.code, timer);
    }
  }
  function membership(socket) {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((p) => p.socketId === socket.id);
    if (!player) throw new Error('Rejoignez un salon pour continuer.');
    return { room, player };
  }
  function leave(socket, explicit = false) {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    socket.leave(room.code);
    delete socket.data.roomCode;
    player.connected = false;
    player.socketId = null;
    if (room.status === 'lobby') player.ready = false;
    if (explicit) {
      player.departed = true;
      if (room.match) {
        cancelTimer(room);
        if (room.game && !room.game.roundResult) room.replayRound = { round: room.game.round, starterId: room.game.starterId, order: [...room.game.order] };
        room.game = null;
        room.status = 'lobby';
        room.players.forEach((p) => { p.ready = false; });
      } else {
        sessions.delete(player.token);
        player.token = null;
        room.players = room.players.filter((p) => p !== player);
      }
    }
    electHost(room);
    if (!room.match && !room.players.some((p) => !p.departed)) rooms.delete(room.code);
    else publish(room);
  }
  function attach(socket, room, player) {
    const oldSocket = io.sockets.sockets.get(player.socketId);
    // Change ownership before disconnecting the previous socket: it cannot remove this session.
    player.socketId = socket.id;
    player.connected = true;
    player.departed = false;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    if (oldSocket && oldSocket !== socket) {
      oldSocket.emit('session:replaced');
      oldSocket.disconnect(true);
    }
    electHost(room);
    publish(room);
    return { room: snapshot(room), playerId: player.id, token: player.token,
      ...(room.game ? { game: gameView(room, player.id) } : {}) };
  }
  function addPlayer(socket, room, name) {
    const player = { id: randomUUID(), token: randomBytes(32).toString('hex'), name,
      ready: false, team: null, connected: true, departed: false, socketId: null };
    room.players.push(player);
    sessions.set(player.token, { room, player });
    return attach(socket, room, player);
  }

  io.on('connection', (socket) => {
    function action(event, handler) {
      socket.on(event, (payload, ack) => {
        if (typeof ack !== 'function') return;
        try { ack({ ok: true, ...handler(payload) }); }
        catch (error) { ack({ ok: false, error: error.message, ...(error.publicReason?{reason:error.publicReason}:{}) }); }
      });
    }
    function playerName(payload) {
      const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Choisissez un pseudo de 1 à 24 caractères.');
      return name;
    }
    action('room:create', (payload) => {
      const name = playerName(payload);
      if (socket.data.roomCode) throw new Error('Quittez votre salon avant d’en créer un autre.');
      if (!['individual', 'teams'].includes(payload?.mode)) throw new Error('Choisissez un mode de jeu.');
      let code;
      do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
      const threshold = payload.threshold ?? 500;
      if (!validThreshold(threshold)) throw new Error('Choisissez un seuil entier positif (maximum 1 000 000 000).');
      const room = { code, hostId: null, mode: payload.mode, threshold, status: 'lobby', players: [], chat: [] };
      rooms.set(code, room);
      return addPlayer(socket, room, name);
    });
    action('room:join', (payload) => {
      const name = playerName(payload);
      const code = typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) throw new Error('Salon introuvable. Vérifiez le code.');
      if (socket.data.roomCode) throw new Error('Quittez votre salon avant d’en rejoindre un autre.');
      if (room.status !== 'lobby' || room.match) throw new Error('La partie a déjà commencé. Seuls les joueurs d’origine peuvent se reconnecter.');
      if (room.players.length >= 4) throw new Error('Ce salon est complet (4 joueurs maximum).');
      return addPlayer(socket, room, name);
    });
    action('room:resume', (payload) => {
      const session = typeof payload?.token === 'string' ? sessions.get(payload.token) : null;
      if (!session) throw new Error('Votre session a expiré. Rejoignez ou créez un salon.');
      if (socket.data.roomCode && socket.data.roomCode !== session.room.code) throw new Error('Quittez votre salon actuel.');
      const current = session.room.players.find((p) => p.socketId === socket.id);
      if (current && current !== session.player) throw new Error('Une autre identité est déjà connectée.');
      return attach(socket, session.room, session.player);
    });
    action('player:ready', (payload) => {
      const { room, player } = membership(socket);
      if (room.status !== 'lobby') throw new Error('La partie a déjà commencé.');
      if (typeof payload?.ready !== 'boolean') throw new Error('État de préparation invalide.');
      player.ready = payload.ready;
      publish(room);
      return { room: snapshot(room) };
    });
    action('room:threshold', (payload) => {
      const { room, player } = membership(socket);
      if (room.hostId !== player.id || room.status !== 'lobby' || room.match || !validThreshold(payload?.threshold)) throw new Error('Seuil indisponible ou invalide.');
      room.threshold = payload.threshold;
      room.players.forEach((p) => { p.ready = false; });
      publish(room); return { room: snapshot(room) };
    });
    action('player:team', (payload) => {
      const { room, player } = membership(socket);
      if (room.status !== 'lobby' || room.mode !== 'teams' || room.match) throw new Error('Choix d’équipe indisponible.');
      if (!['A', 'B'].includes(payload?.team)) throw new Error('Choisissez l’équipe A ou B.');
      if (player.team !== payload.team && room.players.filter((p) => p.team === payload.team).length >= 2) throw new Error('Cette équipe est complète.');
      if (player.team !== payload.team) { player.team = payload.team; player.ready = false; }
      publish(room);
      return { room: snapshot(room) };
    });
    action('room:start', () => {
      const { room, player } = membership(socket);
      if (room.hostId !== player.id) throw new Error('Seul l’hôte peut lancer la partie.');
      if (room.match?.finished) throw new Error('La partie est terminée.');
      if (!canStart(room)) throw new Error('Tous les joueurs doivent être connectés et prêts, avec un nombre de joueurs et des équipes valides.');
      beginRound(room);
      publish(room);
      return { room: snapshot(room) };
    });
    function gameAction(event, mutate) {
      action(event, (payload) => {
        try {
          const { room, player } = membership(socket);
          if (room.status !== 'playing' || !room.game) throw new Error(INVALID_MOVE);
          if (mutate) {
            if (payload?.roundId !== room.game.roundId) throw new Error(INVALID_MOVE);
            if (room.players.some((p) => p.departed)) throw new Error(INVALID_MOVE);
            mutate(room.game, player.id, payload);
            if (room.game.roundResult && !room.match.history.some((r) => r.round === room.game.round)) completeRound(room);
            publishGame(room);
          }
          return { game: gameView(room, player.id) };
        } catch (error) { if(error.publicReason)throw error;throw new Error(INVALID_MOVE); }
      });
    }
    gameAction('game:state');
    gameAction('game:move-group', moveGroup);
    gameAction('game:draw', drawCard);
    gameAction('game:discard', discardCard);
    gameAction('game:cancel-discard',cancelPickup);
    for(const [event,operation]of [['game:stage',stageGroups],['game:collage',stageCollage],['game:joker-recover',recoverJoker],['game:joker-reverse',reverseJokerRecovery],['game:undo',undoStaging],['game:retrieve',retrieveStaged]]) {
      gameAction(event,(game,player,payload)=>actOnTurn(game,player,payload,operation));
    }
    action('chat:history', () => {
      const { room } = membership(socket);
      return { messages: room.chat };
    });
    action('chat:send', (payload) => {
      const { room, player } = membership(socket);
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text || text.length > 300 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) throw new Error('Votre message doit contenir entre 1 et 300 caractères lisibles.');
      if (Date.now() - (socket.data.lastChatAt ?? 0) < 750) throw new Error('Patientez un instant avant d’envoyer un autre message.');
      socket.data.lastChatAt = Date.now();
      const message = { id: randomUUID(), playerId: player.id, name: player.name, text, sentAt: new Date().toISOString() };
      room.chat.push(message);
      if (room.chat.length > 100) room.chat.shift();
      io.to(room.code).emit('chat:update', { code: room.code, messages: room.chat });
      return { message };
    });
    action('room:leave', () => {
      const { room } = membership(socket); const reserved = Boolean(room.match);
      leave(socket, true); return { room: null, reserved };
    });
    socket.on('disconnect', () => leave(socket));
  });
  return { app, httpServer, io };
}
