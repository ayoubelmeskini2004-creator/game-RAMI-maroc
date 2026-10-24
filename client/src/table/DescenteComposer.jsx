import React, { useEffect, useRef, useState } from 'react';
import PlayingCard from './PlayingCard.jsx';
import { cardLabel } from './card-label.js';

const suits = [['hearts', 'Cœur'], ['diamonds', 'Carreau'], ['clubs', 'Trèfle'], ['spades', 'Pique']];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];

export default function DescenteComposer({ game, fromDiscard, initialSelection, onSubmit, onClose, pending, error, dropPosition }) {
  const ref = useRef(null);
  const [groups, setGroups] = useState([]);
  const [selection, setSelection] = useState(initialSelection);
  const [type, setType] = useState('suite');
  const [jokerRank, setJokerRank] = useState('A');
  const [jokerSuit, setJokerSuit] = useState('hearts');
  // Keep the draft stable if the server broadcasts the accepted pose before its acknowledgement.
  const [cards] = useState(() => [...game.hand, ...(fromDiscard && game.discardTop ? [game.discardTop] : [])]);
  const used = new Set(groups.flatMap((group) => group.cardIds));
  const chosen = selection.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
  const joker = chosen.find((card) => card.rank === 'Joker');
  useEffect(() => { ref.current.showModal(); }, []);
  function add() {
    if (selection.length < 3) return;
    setGroups([...groups, { type, cardIds: [...selection], ...(dropPosition ? { position: dropPosition } : {}), ...(joker ? { joker: { cardId: joker.id, rank: jokerRank, suit: jokerSuit } } : {}) }]);
    setSelection([]);
  }
  return <dialog ref={ref} className="table-dialog descente-composer" aria-labelledby="descente-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id="descente-title">{fromDiscard ? 'Ouvrir avec la défausse' : 'Préparer une descente'}</h2><button onClick={onClose} className="secondary" aria-label="Fermer">×</button></div>
    <p>Sélectionnez les cartes dans l’ordre de la Suite, puis ajoutez chaque groupe au projet. Le serveur contrôle toutes les poses. Votre défausse engage vos poses ; le joueur suivant peut déjà piocher pendant leur préparation.</p>
    {game.teamOpeningEligible && <p className="composer-note">Votre partenaire a ouvert : une Suite valide suffit, avec ou sans Joker. Aucun minimum de points ni Tierce obligatoire. Vous devez ouvrir personnellement avant de coller ou récupérer un Joker. La Suite peut utiliser la carte prise à la défausse.</p>}
    {fromDiscard && <p className="composer-note">La prise n’est effectuée que si ce projet permet une ouverture complète. {game.teamOpeningEligible ? 'Préparez au moins une Suite valide.' : `Les groupes obligatoires doivent exclure la carte prise. Total requis : ${game.minimumOpeningTotal} points, dont au moins 71 naturels.`}</p>}
    <div className="composer-hand" aria-label="Cartes disponibles pour le projet">{cards.filter((card) => !used.has(card.id)).map((card) => <button key={card.id} className="composer-card" disabled={pending} aria-pressed={selection.includes(card.id)} onClick={() => setSelection(selection.includes(card.id) ? selection.filter((id) => id !== card.id) : [...selection, card.id])}>
      <PlayingCard {...card} /><small>{selection.includes(card.id) ? selection.indexOf(card.id) + 1 : ''}{fromDiscard && card.id === game.discardTop?.id ? ' · Défausse' : ''}</small>
    </button>)}</div>
    <div className="composer-fields"><label>Combinaison<select value={type} onChange={(event) => setType(event.target.value)} disabled={pending}><option value="suite">Suite</option><option value="tierce">Tierce</option><option value="carre">Carré</option></select></label>
      {joker && <><label>Le Joker remplace<select value={jokerRank} onChange={(event) => setJokerRank(event.target.value)} disabled={pending}>{ranks.map((rank) => <option key={rank} value={rank}>{cardLabel(rank)}</option>)}</select></label><label>Couleur remplacée<select value={jokerSuit} onChange={(event) => setJokerSuit(event.target.value)} disabled={pending}>{suits.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label></>}
      <button className="secondary" disabled={pending || selection.length < 3} onClick={add}>Ajouter au projet</button>
    </div>
    <div className="composer-project">{groups.map((group, i) => <div key={i}><strong>{i + 1}. {group.type === 'suite' ? 'Suite' : group.type === 'tierce' ? 'Tierce' : 'Carré'}</strong><span>{group.cardIds.map((id) => { const card = cards.find((c) => c.id === id); return `${cardLabel(card.rank)} ${suits.find(([s]) => s === card.suit)?.[1] ?? ''}`; }).join(' · ')}{group.joker ? ` (Joker : ${cardLabel(group.joker.rank)} ${suits.find(([s]) => s === group.joker.suit)?.[1]})` : ''}</span><button disabled={pending} className="secondary" onClick={() => setGroups(groups.filter((_, index) => index !== i))}>Retirer du projet</button></div>)}</div>
    {!!selection.length && <p className="composer-note">{selection.length} carte(s) sélectionnée(s) à ajouter au projet. Seuls les groupes ajoutés seront envoyés.</p>}
    {error && <p className="chat-error" role="alert">{error}</p>}
    <button disabled={pending || !groups.length || selection.length > 0} onClick={() => onSubmit(groups)}>{fromDiscard ? 'Prendre et descendre' : 'Descendre'}</button>
  </dialog>;
}
