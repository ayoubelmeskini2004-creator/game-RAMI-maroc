import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';
import './lobby.css';
import './welcome.css';
import GameTable from './table/GameTable.jsx';
import Scores from './table/Scores.jsx';

const socket = io({ autoConnect: false });
const sessionKey = 'rami71.session';
function readSession() {
  try { return JSON.parse(localStorage.getItem(sessionKey)); } catch { return null; }
}

function App() {
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState('individual');
  const [playerId, setPlayerId] = useState(null);
  const [restoring, setRestoring] = useState(Boolean(readSession()?.token));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reserved, setReserved] = useState(false);

  function accept(response) {
    setRoom(response.room ?? null);
    if (response.token) {
      localStorage.setItem(sessionKey, JSON.stringify({ token: response.token }));
      setPlayerId(response.playerId);
    }
  }

  useEffect(() => {
    let retry;
    let active = true;
    const resume = () => {
      const session = readSession();
      if (!session?.token) { setRestoring(false); return; }
      setRestoring(true);
      socket.timeout(5000).emit('room:resume', session, (timeout, response) => {
        if (!active || !socket.connected) return;
        if (timeout) { retry = setTimeout(resume, 1500); return; }
        setRestoring(false);
        if (!response.ok) {
          localStorage.removeItem(sessionKey);
          setRoom(null);
          setPlayerId(null);
          setError(response.error);
        } else { accept(response); setError(''); }
      });
    };
    const onConnect = () => { setConnected(true); setError(''); resume(); };
    const onDisconnect = () => {
      setConnected(false);
      setBusy(false);
      clearTimeout(retry);
      setRestoring(Boolean(readSession()?.token));
      setError('Connexion interrompue. Reconnexion automatique en cours…');
    };
    const onReplaced = () => {
      socket.disconnect();
      setRoom(null);
      setPlayerId(null);
      setRestoring(false);
      setError('Votre session est ouverte dans un autre onglet. Rechargez cette page pour la reprendre ici.');
    };
    const onConnectionError = () => {
      setConnected(false);
      setError('Le serveur est indisponible. Nouvelle tentative en cours…');
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectionError);
    socket.on('room:update', setRoom);
    socket.on('session:replaced', onReplaced);
    socket.connect();
    return () => {
      active = false;
      clearTimeout(retry);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectionError);
      socket.off('room:update', setRoom);
      socket.off('session:replaced', onReplaced);
      socket.disconnect();
    };
  }, []);

  function request(event, payload) {
    if (!socket.connected || restoring || busy) return;
    setError('');
    setBusy(true);
    socket.timeout(5000).emit(event, payload, (timeout, response) => {
      setBusy(false);
      if (timeout) return setError('Le serveur ne répond pas. Veuillez réessayer.');
      if (!response.ok) return setError(response.error);
      accept(response);
      if (event === 'room:resume') setReserved(false);
      if (event === 'room:leave') {
        if (!response.reserved) localStorage.removeItem(sessionKey);
        setReserved(Boolean(response.reserved));
        setPlayerId(null);
        setConfirmLeave(false);
      }
      setCopied(false);
    });
  }

  const me = room?.players.find((player) => player.id === playerId);
  const isHost = room?.hostId === playerId;
  const disabled = busy || !connected || restoring;
  const modeLabel = room?.mode === 'teams' ? 'Mode Équipes · 2 contre 2' : 'Mode Individuel · 2 à 4 joueurs';

  if (room?.status === 'playing') return <>
    <GameTable room={room} playerId={playerId} socket={socket} connected={connected && !restoring}
      error={error} onLeave={() => setConfirmLeave(true)} busy={disabled} />
    {confirmLeave && <LeaveDialog reserved={Boolean(room?.match)} busy={disabled} onCancel={() => setConfirmLeave(false)} onConfirm={() => request('room:leave', {})} />}
  </>;

  return (
    <main className={room ? undefined : 'welcome-screen'}>
      <header><a className="brand" href="/">♠ <span>RAMI <b>71</b></span></a><span className="connection"><i className={connected ? 'online' : ''} />{connected ? 'Connecté' : 'Connexion…'}</span></header>
      <section className="intro">
        <p className="eyebrow">LE PLAISIR DE SE RETROUVER</p>
        <h1>Rami Marocain <span>71</span></h1>
        <p>Une table, vos amis, un bon moment.</p>
      </section>
      <section className={`panel ${room ? 'lobby-panel' : ''}`} aria-label={room?.status === 'playing' ? 'Table de jeu' : room ? 'Salon privé' : 'Bienvenue'}>
        {room ? <>
          <p className="eyebrow">{room.status === 'playing' ? 'VOTRE TABLE DE JEU' : 'VOTRE SALON PRIVÉ'}</p>
          <h2>{room.status === 'playing' ? 'La table est réunie.' : 'Tout commence entre amis.'}</h2>
          <p className="mode-badge">{modeLabel}</p>
          <ThresholdSetting room={room} disabled={disabled || !isHost || Boolean(room.match)} onSave={(threshold) => request('room:threshold', { threshold })} />
          {room.match && <><p className="notice">{room.match.finished ? "Partie terminée." : "Manche annulée. Scores conservés : les joueurs d’origine doivent revenir et se préparer pour reprendre."}</p><Scores match={room.match} history /></>}
          <p className="muted">{room.match ? 'Les places restent réservées aux joueurs d’origine.' : 'Partagez ce code pour inviter vos joueurs.'}</p>
          <div className="room-code">{room.code}</div>
          <button className="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(room.code); setCopied(true); }
            catch { setError('Copie indisponible. Sélectionnez le code pour le copier.'); }
          }}>{copied ? 'Code copié !' : 'Copier le code'}</button>
          <h3>Joueurs · {room.players.length}/4</h3>
          <ul className="players">{room.players.map((player) => <li key={player.id}>
            <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
            <div className="player-info"><strong>{player.name}</strong><div className="player-tags">
              {player.id === playerId && <small>Vous</small>}{player.id === room.hostId && <small>Hôte</small>}
              <small>{player.departed ? 'A quitté le salon' : !player.connected ? 'Déconnecté' : 'Connecté'}</small>
              {room.mode === 'teams' && <small>{player.team ? `Équipe ${player.team}` : 'Sans équipe'}</small>}
            </div></div>
            <span className={`ready-badge ${player.ready ? 'ready' : ''}`}>{player.ready ? 'Prêt' : 'Pas prêt'}</span>
          </li>)}</ul>
          {room.status === 'lobby' && !room.match?.finished ? <>
            {room.mode === 'teams' && <fieldset className="team-picker" disabled={disabled || Boolean(room.match)}>
              <legend>Votre équipe</legend>
              {['A', 'B'].map((team) => {
                const count = room.players.filter((player) => player.team === team).length;
                return <button key={team} className="secondary" aria-pressed={me?.team === team} disabled={disabled || (count >= 2 && me?.team !== team)} onClick={() => request('player:team', { team })}>Équipe {team} · {count}/2</button>;
              })}
            </fieldset>}
            <button className="ready-toggle secondary" aria-pressed={Boolean(me?.ready)} disabled={disabled || !me} onClick={() => request('player:ready', { ready: !me.ready })}>{me?.ready ? 'Prêt ✓ — Passer à « Pas prêt »' : 'Pas prêt — Je suis prêt'}</button>
            <p className="notice">{room.mode === 'teams' ? 'Il faut 4 joueurs connectés et prêts, répartis en 2 équipes de 2.' : 'Il faut entre 2 et 4 joueurs connectés, tous prêts.'} Un changement d’équipe ou une déconnexion annule votre préparation.</p>
            {isHost ? <button className="start-button" disabled={disabled || !room.canStart} onClick={() => request('room:start', {})}>Lancer la partie</button> : <p className="muted">L’hôte lancera la partie lorsque tout le monde sera prêt.</p>}
          </> : null}
          <button className="text-button" disabled={disabled} onClick={() => setConfirmLeave(true)}>Quitter le salon</button>
        </> : <>
          <div className="suits" aria-hidden="true">♠ <span>♥</span> ♣ <span>♦</span></div>
          <h2>Bienvenue à la table</h2>
          {reserved && readSession()?.token && <button disabled={disabled} onClick={() => request('room:resume', readSession())}>Revenir à mon salon réservé</button>}
          <p className="muted">Créez votre salon privé ou retrouvez vos amis.</p>
          <form onSubmit={(event) => { event.preventDefault(); request('room:create', { name, mode }); }}>
            <label htmlFor="name">Votre prénom ou pseudo</label>
            <input id="name" autoComplete="nickname" placeholder="Comment vous appeler ?" value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={24} disabled={disabled} />
            <fieldset className="mode-picker" disabled={disabled}>
              <legend>Mode de votre nouveau salon</legend>
              <label><input type="radio" name="mode" value="individual" checked={mode === 'individual'} onChange={() => setMode('individual')} /> <span>Mode Individuel<small>2 à 4 joueurs</small></span></label>
              <label><input type="radio" name="mode" value="teams" checked={mode === 'teams'} onChange={() => setMode('teams')} /> <span>Mode Équipes<small>4 joueurs · 2 contre 2</small></span></label>
            </fieldset>
            <button type="submit" disabled={disabled || !name.trim()}>Créer un salon privé <span>→</span></button>
          </form>
          <div className="divider"><span>ou rejoindre vos amis</span></div>
          <form onSubmit={(event) => { event.preventDefault(); request('room:join', { name, code }); }}>
            <label htmlFor="code">Code du salon</label>
            <div className="join"><input id="code" placeholder="Ex. A7K2MP" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={6} minLength={6} required autoComplete="off" spellCheck="false" disabled={disabled} /><button className="secondary" type="submit" disabled={disabled || !name.trim() || code.trim().length !== 6}>Rejoindre</button></div>
          </form>
          <p className="footnote">Entre amis uniquement · Aucun bot · Jusqu’à 4 joueurs</p>
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        {restoring && <p className="notice" role="status">Récupération de votre place en cours…</p>}
        <span className="sr-only" role="status">{busy ? 'Veuillez patienter…' : ''}</span>
      </section>
      {confirmLeave && <LeaveDialog reserved={Boolean(room?.match)} busy={disabled} onCancel={() => setConfirmLeave(false)} onConfirm={() => request('room:leave', {})} />}
      <footer>Rami Marocain 71 <span>·</span> Les bons moments se partagent.</footer>
    </main>
  );
}

function ThresholdSetting({ room, disabled, onSave }) {
  const [value, setValue] = useState(room.threshold);
  useEffect(() => setValue(room.threshold), [room.threshold]);
  return <form onSubmit={(event) => { event.preventDefault(); onSave(Number(value)); }}><label htmlFor="penalty-threshold">Seuil maximal de pénalités cumulées</label><input id="penalty-threshold" type="number" min="1" max="1000000000" step="1" required value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} /><button className="secondary" disabled={disabled || Number(value) === room.threshold}>Enregistrer le seuil</button></form>;
}

function LeaveDialog({ reserved, busy, onCancel, onConfirm }) {
  const ref = React.useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="leave-dialog" aria-labelledby="leave-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="leave-title">Quitter le salon ?</h2>
    <p>{reserved ? "Votre départ annule la manche et renvoie tous les joueurs au salon. Les scores terminés sont conservés. Votre identité reste réservée : vous devrez revenir pour reprendre." : "Votre place sera libérée et votre session supprimée."}</p>
    <div className="dialog-actions"><button className="secondary" autoFocus onClick={onCancel}>Rester</button><button disabled={busy} onClick={onConfirm}>Quitter le salon</button></div>
  </dialog>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
