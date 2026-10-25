import React, { useEffect, useRef, useState } from 'react';
import PlayingCard from './PlayingCard.jsx';
import TableDecor from './TableDecor.jsx';
import DescenteComposer from './DescenteComposer.jsx';
import { arrangeSeats } from './layout.js';
import Scores from './Scores.jsx';
import { acceptGame } from './state.js';
import PrivateHand from './PrivateHand.jsx';
import MeldAreas from './FreeMeldArea.jsx';
import { CARD_DRAG_TYPE, DISCARD_DRAG_TYPE, validDiscardDrag, validHandDrag } from './hand-order.js';
import { GROUP_DRAG_TYPE, naturalProposal } from './group-proposal.js';
import './table.css';
import { jokerExtensions } from '../../../server/src/collage.js';
import { cardLabel } from './card-label.js';
import { discardDrop } from './discard-drop.js';
import usePointerDrag from './usePointerDrag.jsx';

function Seat({ playerId, player, position, hostId, teamMode, game, selected, onSelect, selectedGroup, onGroupSelect, onRetrieve, editable, selectionLocked, onCollage, onDropCard, onRecover, onReverse, layoutEditable, onFreeDrop, onDiscardDrop, onRetrieveDrop }) {
  if (!player) return null;
  const own = position === 'bottom';
  const count = game?.counts[player.id] ?? 0;
  return <section className={`table-seat seat-${position} ${game?.phase !== 'round-ended' && game?.activePlayerId === player.id ? 'preview-active-seat' : ''} ${game?.mustDiscard?.[player.id] ? 'owes-discard-seat' : ''}`} aria-label={`${player.name}${own ? ', vous' : ''}`}>
    <div className="seat-identity">
      <span className={`seat-avatar ${player.connected ? 'is-connected' : ''}`}>{player.name.slice(0, 1).toUpperCase()}</span>
      <div><strong>{player.name}{own ? ' · Vous' : ''}</strong><span className="seat-meta">{teamMode ? `Équipe ${player.team ?? '—'} · ` : ''}{player.id === hostId ? 'Hôte · ' : ''}{player.departed ? 'A quitté' : player.connected ? 'Connecté' : 'Déconnecté'}</span></div>
      <span className="card-count"><small>{game?.opened[player.id] ? game.openingInheritedFrom[player.id] ? "Ouvert · équipe" : "Ouvert" : "Non ouvert"}</small>{count} cartes{game?.phase !== 'round-ended' && (game?.mustDiscard?.[player.id] || game?.activePlayerId === player.id) && <small>{game?.mustDiscard?.[player.id] ? game.activePlayerId === player.id ? 'Pioche après défausse' : 'À défausser' : 'Droit de pioche'}</small>}</span>
    </div>
    {own ? <>
      <div className="own-opening-score"><span>Première Descente</span><strong>{game?.opened[player.id]?`${game.openingTotals[player.id]} points`:'Non descendu'}</strong></div>
      <MeldAreas name={player.name} player={player} game={game} own selected={selected} selectedGroup={selectedGroup} onGroupSelect={onGroupSelect} onRetrieve={onRetrieve} editable={editable} onCollage={onCollage} onDropCard={onDropCard} onRecover={onRecover} onReverse={onReverse} layoutEditable={layoutEditable} onFreeDrop={onFreeDrop} />
      {game && <PrivateHand key={`${playerId}:${game.roundId}`} game={game} playerId={playerId} selected={selected} onSelect={onSelect} locked={selectionLocked} onDiscardDrop={onDiscardDrop} onRetrieveDrop={onRetrieveDrop} />}
      <span className="hand-caption">Descente → main : sélection ou ⠿ · Collage/Jokers : glissez vers les groupes</span>
    </> : <>
      <div className="opponent-hand" aria-label={`${count} cartes face cachée`}>{Array.from({ length: count }, (_, i) => <PlayingCard key={i} faceDown />)}</div>
      <MeldAreas name={player.name} player={player} game={game} selected={selected} selectedGroup={selectedGroup} onGroupSelect={onGroupSelect} onRetrieve={onRetrieve} editable={editable} onCollage={onCollage} onDropCard={onDropCard} onRecover={onRecover} onReverse={onReverse} layoutEditable={layoutEditable} onFreeDrop={onFreeDrop} />
    </>}
  </section>;
}

function RoomChat({ socket, room, connected, playerId }) {
  const [messages, setMessages] = useState(room.chat ?? []);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const log = useRef(null);
  useEffect(() => {
    const update = (data) => { if (data.code === room.code) setMessages(data.messages); };
    socket.on('chat:update', update);
    if (connected) socket.timeout(5000).emit('chat:history', {}, (timeout, response) => {
      if (!timeout && response.ok) setMessages(response.messages);
      else setError('Historique indisponible. Réessayez après la reconnexion.');
    });
    return () => socket.off('chat:update', update);
  }, [socket, room.code, connected]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages]);
  function send(event) {
    event.preventDefault();
    if (!text.trim() || !connected || sending) return;
    setSending(true);
    setError('');
    socket.timeout(5000).emit('chat:send', { text }, (timeout, response) => {
      setSending(false);
      if (timeout || !response.ok) return setError(timeout ? 'Message non confirmé par le serveur.' : response.error);
      setText('');
    });
  }
  return <aside className="table-chat" aria-label="Discussion publique du salon">
    <div className="chat-title"><span>Discussion</span><span className="chat-public">PUBLIQUE</span></div>
    <p className="chat-intro">Autour de la table, entre amis.</p>
    <div ref={log} className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
      {!messages.length && <div className="chat-empty"><span aria-hidden="true">♧</span><p>La discussion commence ici.</p><small>Vos messages sont visibles par tous les joueurs du salon.</small></div>}
      {messages.map((message) => <article key={message.id} className={message.playerId === playerId ? 'own-message' : ''}>
        <div><strong>{message.name}</strong><time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p>
      </article>)}
    </div>
    <form className="chat-compose" onSubmit={send}>
      <label className="sr-only" htmlFor="chat-message">Votre message public</label>
      <input id="chat-message" placeholder="Écrire un message…" value={text} maxLength={300} onChange={(event) => setText(event.target.value)} disabled={!connected || sending} autoComplete="off" />
      <button type="submit" aria-label="Envoyer le message" disabled={!connected || sending || !text.trim()}>↑</button>
    </form>
    {error && <p className="chat-error" role="alert">{error}</p>}
    <p className="chat-caption">300 caractères maximum · Entrée pour envoyer</p>
  </aside>;
}

function InfoDialog({ type, room, match, onClose }) {
  const ref = useRef(null);
  const [showHelp, setShowHelp] = useState(true);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog className="table-dialog" ref={ref} aria-labelledby="table-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id="table-dialog-title">{type === 'Scores' ? 'Tableau des scores' : type === 'Historique' ? 'Historique des manches' : type}</h2><button className="secondary" onClick={onClose} aria-label="Fermer">×</button></div>
    {type === 'Scores' && <Scores match={match} />}
    {type === 'Historique' && <Scores match={match} history />}
    {type === 'Paramètres' && <><p>Affichage pour navigateur de bureau. Aucune animation.</p><label className="table-setting"><input type="checkbox" checked={showHelp} onChange={(event) => setShowHelp(event.target.checked)} /> Afficher l’aide des commandes</label>{showHelp && <p>Le premier joueur défausse sans piocher, puis le suivant reçoit le droit de pioche. Après votre pioche, vous pouvez poser, coller et défausser même si le suivant a déjà pioché. Vous devez terminer votre défausse avant de piocher à nouveau. Vous pouvez attendre une défausse pour prendre sa dernière carte par clic ou la glisser dans votre main. Avant ouverture, préparez ensuite une ouverture légale avant de défausser. Un groupe réservé par les poses provisoires d’un autre joueur attend sa validation ou son annulation. Annuler et Tout annuler concernent uniquement vos poses ; la prise d’une carte ne peut pas être annulée après transmission du droit de pioche. La poignée ⠿ déplace vos groupes sans changer leur contenu.</p>}</>}
    <button onClick={onClose}>Reprendre</button>
  </dialog>;
}

export default function GameTable({ room, playerId, socket, connected, error, onLeave, busy }) {
  const [dialog, setDialog] = useState(null);
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [composer, setComposer] = useState(null);
  const [jokerCollage,setJokerCollage]=useState(null);
  const [pending, setPending] = useState(false);
  const [moveError, setMoveError] = useState('');
  const inFlight = useRef(null);
  const requestSequence = useRef(0);
  useEffect(() => {
    let active = true;
    let retry;
    const accept = (next) => {
      if (active) setGame((current) => acceptGame(current, next));
    };
    const update = (data) => { if (data.code === room.code) accept(data.game); };
    socket.on('game:update', update);
    inFlight.current = null;
    requestSequence.current++;
    setPending(false);
    if (!connected) {setComposer(null);setJokerCollage(null);}
    const synchronize = () => {
      socket.timeout(5000).emit('game:state', {}, (timeout, response) => {
        if (!active) return;
        if (!timeout && response.ok) { accept(response.game); setMoveError(''); }
        else {
          setMoveError('Synchronisation en cours. Nouvelle tentative automatique…');
          retry = setTimeout(synchronize, 1500);
        }
      });
    };
    if (connected) synchronize();
    return () => { active = false; clearTimeout(retry); socket.off('game:update', update); };
  }, [socket, room.code, connected]);
  useEffect(() => {
    setSelected((current) => {
      const next = current.filter((id) => game?.hand.some((card) => card.id === id));
      return next.length === current.length ? current : next;
    });
    if (selectedGroup && !game?.staged.some((group) => group.id === selectedGroup) && !game?.collages.some((overlay) => overlay.groupId === selectedGroup)) setSelectedGroup(null);
  }, [game, selectedGroup]);
  useEffect(() => {
    inFlight.current = null;
    requestSequence.current++;
    setPending(false); setSelected([]); setSelectedGroup(null); setComposer(null); setJokerCollage(null); setMoveError('');
  }, [game?.roundId]);
  function move(event, payload) {
    if (!connected || inFlight.current !== null || !game) return;
    const sequence = ++requestSequence.current;
    inFlight.current = sequence;
    setPending(true);
    setMoveError('');
    socket.timeout(5000).emit(event, { ...payload, roundId: game.roundId, revision: game.revision, turnRevision:game.turnRevision }, (timeout, response) => {
      if (sequence !== requestSequence.current) return;
      inFlight.current = null;
      setPending(false);
      if (timeout) {
        setMoveError('Réponse non reçue. Vérification de votre main en cours…');
        socket.timeout(5000).emit('game:state', {}, (failure, state) => {
          if (sequence === requestSequence.current && !failure && state.ok) setGame((current) => acceptGame(current, state.game));
        });
        return;
      }
      if (!response.ok) { setMoveError(response.reason??response.error); return; }
      setGame((current) => acceptGame(current, response.game));
      if (['game:discard', 'game:stage', 'game:collage', 'game:joker-recover', 'game:joker-reverse', 'game:draw', 'game:cancel-discard', 'game:retrieve'].includes(event)) {
        setSelected([]);
        setComposer(null);
      }
    });
  }
  const seats = arrangeSeats((game?.order ?? room.game?.order ?? room.players.map((p) => p.id)).map((id) => room.players.find((p) => p.id === id)).filter(Boolean), playerId, room.mode);
  const activeName = room.players.find((p) => p.id === game?.activePlayerId)?.name ?? '…';
  const available = game?.phase !== 'round-ended' && connected && !pending && game?.pauseReason !== 'player-left';
  const canDraw = available && game?.canDraw;
  const discardPointer=usePointerDrag({enabled:!!canDraw,scope:game?.roundId});
  const canStage = available && game?.canStage;
  const canDiscard = available && game?.canDiscard && selected.length === 1 && !game.recoveredJokerIds.includes(selected[0]) && game.hand.some(card=>card.id===selected[0]);
  function takeDiscard(data, target) {
    if(!canDraw || !validDiscardDrag(data,game,playerId)) {setMoveError('Coup invalide');return;}
    move('game:draw',{source:'discard',cardId:data.cardId,...(target?{target}:{})});
  }
  function returnPickup(event) {
    event.preventDefault();event.stopPropagation();
    try {
      const data=JSON.parse(event.dataTransfer.getData(CARD_DRAG_TYPE));
      const action=discardDrop(data,game,playerId);
      if(action.error){setMoveError(action.error);return;}
      move(action.event,{cardId:action.cardId});
    }catch{setMoveError('Seule la carte physique qui vient d’être prise peut être remise dans la Défausse.');}
  }
  function collageCard(ownerId,groupId,cardId){
    const card=game.hand.find(item=>item.id===cardId);
    if(card?.rank!=='Joker'){move('game:collage',{ownerId,groupId,cardIds:[cardId]});return;}
    const group=game.collages.find(item=>item.ownerId===ownerId&&item.groupId===groupId)?.group??game.staged.find(item=>item.ownerId===ownerId&&item.id===groupId)??game.laid[ownerId]?.find(item=>item.id===groupId);
    const choices=jokerExtensions(group,card);
    if(!choices.length){setMoveError('Ce Joker ne peut pas compléter cette combinaison : un seul Joker est autorisé par groupe.');return;}
    const target={ownerId,groupId,cardIds:[cardId]};
    if(choices.length===1)move('game:collage',{...target,...choices[0]});
    else setJokerCollage({target,choices,revision:game.revision,roundId:game.roundId});
  }
  function dropCard(event, ownerId, groupId, jokerId) {
    try {
      if(event.dataTransfer.types.includes(DISCARD_DRAG_TYPE)) {const data=JSON.parse(event.dataTransfer.getData(DISCARD_DRAG_TYPE));takeDiscard(data,{ownerId,groupId});return;}
      const data = JSON.parse(event.dataTransfer.getData('application/x-rami-card'));
      if ((data.cardIds?.length ?? 1) !== 1 || !validHandDrag(data,data.cardId,game,playerId) || !game.hand.some((card) => card.id === data.cardId)) throw new Error();
      if (jokerId) {if(game.hand.find(card=>card.id===data.cardId).rank==='Joker')throw new Error();move('game:joker-recover', { ownerId, groupId, jokerId, cardId: data.cardId });}
      else collageCard(ownerId,groupId,data.cardId);
    } catch { setMoveError('Coup invalide'); }
  }
  function freeDrop(event, position) {
    try {
      if (event.dataTransfer.types.includes(GROUP_DRAG_TYPE)) {
        const data = JSON.parse(event.dataTransfer.getData(GROUP_DRAG_TYPE));
        if (data.ownerId !== playerId || data.roundId !== game.roundId) throw new Error();
        move('game:move-group', { groupId: data.groupId, position });
        return;
      }
      const data = JSON.parse(event.dataTransfer.getData(CARD_DRAG_TYPE));
      if((data.cardIds?.length??1)===1&&game.hand.find(card=>card.id===data.cardId)?.rank==='Joker'){setMoveError('Glissez le Joker sur une combinaison, ou sélectionnez-le avec les cartes d’une nouvelle combinaison.');return;}
      if (!canStage || !validHandDrag(data, data.cardId, game, playerId) || (data.cardIds?.length ?? 1) < 3) throw new Error();
      const ids = data.cardIds;
      const cards = ids.map(id => game.hand.find(card => card.id === id));
      if (cards.some(card => card.rank === 'Joker')) { setMoveError(''); setSelected(ids); setComposer({ fromDrop: true, position }); return; }
      const proposal = naturalProposal(cards);
      if (!proposal) throw new Error();
      move('game:stage', { groups: [{ ...proposal, position }] });
    } catch { setMoveError('Coup invalide'); }
  }
  const waitingNames=room.players.filter(player=>game?.mustDiscard?.[player.id]).map(player=>player.id===playerId?'vous':player.name).join(', ');
  const turnLabel=game?.phase==='round-ended'?'Manche terminée · Tableau des scores':!game?'Synchronisation de la table…':game.initialDiscard?activeName+' défausse sans piocher':
    'Pioche : '+activeName+(game.mustDiscard[game.activePlayerId]?' (défausse requise)':'')+(waitingNames?' · Défausse : '+waitingNames:'');
  return <main className="match-screen">
    {discardPointer.preview}
    {jokerCollage&&<div className="joker-choice-backdrop"><section className="joker-choice" role="dialog" aria-modal="true" aria-label="Carte remplacée par le Joker"><h2>Le Joker remplace…</h2><p>Choisissez la carte manquante dans cette combinaison.</p>{jokerCollage.choices.map(choice=><button key={`${choice.side}-${choice.joker.rank}-${choice.joker.suit}`} disabled={pending} onClick={()=>{if(game.roundId!==jokerCollage.roundId||game.revision!==jokerCollage.revision){setMoveError('La table a changé. Déposez à nouveau votre Joker.');setJokerCollage(null);return;}move('game:collage',{...jokerCollage.target,...choice});setJokerCollage(null);}}>{cardLabel(choice.joker.rank)} {({hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'})[choice.joker.suit]} · {choice.side==='prepend'?'début':'fin'}</button>)}<button className="secondary" onClick={()=>setJokerCollage(null)}>Annuler</button></section></div>}
    <header className="match-header">
      <a className="match-brand" href="/" aria-label="Rami Marocain 71, accueil">♠ <span>RAMI MAROCAIN <b>71</b></span></a>
      <div className="match-room"><span>SALON <strong>{room.code}</strong></span><span>{room.mode === 'teams' ? 'Équipes · 2 contre 2' : 'Individuel'}</span></div>
      <nav aria-label="Informations de la table">{['Scores', 'Historique', 'Paramètres'].map((label) => <button key={label} className="table-nav-button" onClick={() => setDialog(label)}>{label}</button>)}<button className="table-nav-button leave-table" onClick={onLeave} disabled={busy}>Quitter le salon</button></nav>
    </header>
    <div className="preview-banner"><span className="preview-pill">MANCHE {game?.round ?? '…'}</span><span>{game?.teamOpeningEligible ? "Ouverture d’équipe : une Suite valide suffit, Joker autorisé." : `Ouverture ordinaire : 71 naturels et total ≥ ${game?.minimumOpeningTotal ?? 71}.`} Après pioche : posez puis défaussez. Le suivant peut déjà piocher ou attendre.</span><span className={`table-connection ${connected ? 'connected' : ''}`}>{connected ? '● Connecté' : '○ Reconnexion…'}</span></div>
    {(error || moveError) && <p className="match-error" role="alert">{error || moveError}</p>}
    <div className="desktop-notice">Cette table est conçue pour un navigateur de bureau, à partir de 1 200 px de large.</div>
    <div className="match-layout">
      <section className="table-workspace" aria-label="Table de Rami Marocain">
        <div className="felt-table">
          <div className="zellige-border" aria-hidden="true" />
          <TableDecor />
          <div className="table-center">
            <div className="draw-and-discard">
              <div className="pile"><span className="pile-label">Pioche</span><button className="pile-button" aria-label="Piocher une carte" disabled={!canDraw || (!game.stockCount && game.discardCount < 2)} onClick={() => move('game:draw', { source: 'stock' })}><div className="draw-stack">{game?.stockCount ? Array.from({ length: Math.min(3, game.stockCount) }, (_, i) => <PlayingCard key={i} faceDown />) : <span className="empty-pile">Vide</span>}</div></button><small>{game?.stockCount ?? '…'} cartes{game && !game.stockCount && game.discardCount > 1 ? ' · à remélanger' : ''}</small></div>
              <div className="pile discard-pile" onDragOver={event=>{if((game?.canDiscard||game?.cancelPickupCardId)&&event.dataTransfer.types.includes(CARD_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={returnPickup}><span className="pile-label">Défausse</span><button className="pile-button" data-pointer-drag="discard" aria-label="Prendre la dernière carte de la défausse" title="Prenez cette carte puis ouvrez légalement avant votre défausse" disabled={!canDraw || !game?.discardTop} draggable={false} onDragStart={event=>event.preventDefault()} onPointerDown={event=>discardPointer.start(event,{type:DISCARD_DRAG_TYPE,data:{cardId:game.discardTop.id,playerId,revision:game.revision,roundId:game.roundId},cards:[game.discardTop]})} onClick={()=>move('game:draw',{source:'discard',cardId:game.discardTop.id})}><div className="discard-slot">{game?.discardTop ? <PlayingCard {...game.discardTop} /> : <span className="empty-pile">Vide</span>}</div></button><small>{game?.discardCount ?? 0} carte(s)</small></div>
            </div>
          </div>
            <p className="turn-status" role="status" title={turnLabel}><span aria-hidden="true">◉</span> {turnLabel}</p>
          {Object.entries(seats).map(([position, player]) => <Seat key={position} playerId={playerId} player={player} position={position} hostId={room.hostId} teamMode={room.mode === 'teams'} game={game} selected={selected} onSelect={setSelected} selectedGroup={selectedGroup} onGroupSelect={setSelectedGroup} editable={canStage} onDiscardDrop={takeDiscard} onRetrieveDrop={selections=>move('game:retrieve',{selections})} layoutEditable={connected && !pending} onFreeDrop={freeDrop} selectionLocked={pending || !connected} onRetrieve={(groupId, cardId, ownerId) => move('game:retrieve', { groupId, cardId, ownerId })} onCollage={collageCard} onDropCard={dropCard} onRecover={(ownerId, groupId, jokerId, cardId) => move('game:joker-recover', { ownerId, groupId, jokerId, cardId })} onReverse={(item) => move('game:joker-reverse', { ownerId: item.ownerId, groupId: item.groupId, jokerId: item.jokerId })} />)}
        </div>
        <div className="table-actions" aria-label="Actions de jeu">
          <div className="undo-actions"><button disabled={!canStage || !game.canUndo} onClick={() => move('game:undo', { all: false })}>Annuler</button><button disabled={!canStage || !game.canUndo} onClick={() => move('game:undo', { all: true })}>Tout annuler</button>{game?.canCancelDiscard&&<button disabled={!available} onClick={()=>move('game:cancel-discard',{cardId:game.cancelPickupCardId})}>Annuler la prise</button>}</div>
          <span>{game?.pendingRecoveredJokerIds.length > 0 ? `${game.pendingRecoveredJokerIds.length} Joker(s) récupéré(s) à rejouer avant défausse` : game?.openingStatus ? `${game.openingStatus.qualifyingNaturalPoints} naturels · ${game.openingStatus.totalLaidPoints} posés · ${game.openingStatus.valid ? 'Ouverture prête' : 'Ouverture incomplète'}` : game?.initialDiscard ? 'Premier joueur : défaussez sans piocher' : 'Poses dorées : engagées à votre défausse'}</span>
          <div><button disabled={!canStage} onClick={() => { setMoveError(''); setComposer('hand'); }}>Descendre</button><button disabled={!canDiscard} onClick={() => move('game:discard', { cardId: selected[0] })}>Défausser</button><button disabled={!canStage || !selectedGroup} onClick={() => move('game:retrieve', { groupId: selectedGroup })}>Reprendre</button></div>
        </div>
      </section>
      <RoomChat socket={socket} room={room} connected={connected} playerId={playerId} />
    </div>
    {game?.phase === 'round-ended' && !dialog && <aside className="round-score-overlay" aria-label="Tableau des scores"><h2>Tableau des scores</h2><Scores match={game.match} /><button onClick={() => setDialog('Historique')}>Historique des manches</button></aside>}
    {dialog && <InfoDialog type={dialog} room={room} match={game?.match} onClose={() => setDialog(null)} />}
    {composer && game && <DescenteComposer game={game} dropPosition={composer?.fromDrop ? composer.position : null} fromDiscard={composer === 'discard'} initialSelection={selected} pending={pending || !connected} error={moveError} onClose={() => setComposer(null)} onSubmit={(groups) => composer === 'discard' ? move('game:draw', { source: 'discard', openingGroups: groups }) : move('game:stage', { groups })} />}
  </main>;
}
