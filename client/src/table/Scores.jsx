import React, { useEffect, useState } from 'react';

export default function Scores({ match, round = match?.history.at(-1), history = false }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const deadline = Date.now() + Math.max(0, (match?.nextRoundAt ?? 0) - (match?.serverNow ?? 0));
    const update = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 250); return () => clearInterval(timer);
  }, [match?.nextRoundAt, match?.serverNow]);
  if (!match) return <p>Aucune manche terminée.</p>;
  const name = (id) => match.players.find((p) => p.id === id)?.name ?? id;
  const winner = (id) => match.mode === 'teams' ? `Équipe ${id}` : name(id);
  const entries = history ? match.history : round ? [round] : [];
  return <div className="score-content">
    <p>Seuil de la partie : <strong>{match.threshold}</strong> points de pénalité. Le plus petit cumul gagne.</p>
    {match.finished && <p className="score-victory">Partie terminée — Victoire : {winner(match.winner)}</p>}
    {match.tied && <p>Égalité au plus petit cumul : la partie continue jusqu’à départage.</p>}
    {!history && match.nextRoundAt && <p className="score-countdown" role="status">Prochaine manche dans {seconds} s{seconds === 0 ? ' · Synchronisation avec le serveur…' : ''}</p>}
    {!entries.length && <p>Aucune manche terminée.</p>}
    {entries.map((entry) => <section key={entry.round} className="score-round">
      <h3>Manche {entry.round} — {entry.winnerTeam ? `Équipe ${entry.winnerTeam}` : name(entry.winnerId)} remporte la manche</h3>
      <p>Joueur ayant terminé : {name(entry.winnerId)}{entry.totalDescent ? ' · Descente totale : pénalités adverses doublées' : ''}</p>
      <table><thead><tr><th>Joueur</th><th>Manche</th><th>Cumul</th></tr></thead><tbody>{match.players.map((p) => <tr key={p.id}><th>{p.name}{match.mode === 'teams' ? ` · Équipe ${p.team}` : ''}{p.id === entry.winnerId ? ' · Gagnant' : ''}</th><td>{entry.penalties[p.id]}</td><td>{entry.totals[p.id]}</td></tr>)}</tbody></table>
      {entry.teamTotals && <table><thead><tr><th>Équipe</th><th>Manche</th><th>Cumul</th></tr></thead><tbody>{['A', 'B'].map((team) => <tr key={team}><th>Équipe {team}{team === entry.winnerTeam ? ' · Gagnante' : ''}</th><td>{entry.teamPenalties[team]}</td><td>{entry.teamTotals[team]}</td></tr>)}</tbody></table>}
    </section>)}
  </div>;
}
