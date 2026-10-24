# Tours chevauchants, Défausse et Collage

Ce fonctionnement remplace les deux déroulements précédents. Le rapport `MISE-A-JOUR-MAIN-TOURS.md` décrit l’étape antérieure ; les règles de tours actuelles sont celles de ce document.

## Machine serveur

- `activePlayerId` représente le prochain droit de pioche, dans l’ordre horaire serveur. Il ne représente plus un monopole sur les autres actions.
- `mustDiscard[id]` représente une obligation personnelle. Seul le premier joueur, avec 15 cartes, en possède une au début. Il défausse sans poser ni piocher ; le suivant devient le premier autorisé à piocher.
- Toute pioche exige le droit courant et l’absence d’obligation personnelle antérieure. Elle ajoute exactement une carte, ouvre une préparation personnelle et transmet immédiatement le droit suivant. Si ce droit revient à un joueur encore obligé de défausser, sa pioche attend sa propre défausse.
- Chaque joueur qui a pioché peut poser, coller, récupérer/réutiliser un Joker, annuler et défausser, même lorsque d’autres ont déjà pioché. Sa défausse engage uniquement ses poses et lève uniquement son obligation. Elle ne déplace pas le droit de pioche courant.
- Les préparations indépendantes sont conservées dans `turns`. Les fonctions de combinaison restent réutilisées dans un contexte personnel détaché. `actOnTurn` publie le résultat seulement si l’opération complète est légale.

## Prises de Défausse

Le joueur disposant du droit de pioche peut cliquer le sommet ou le glisser dans sa main. Avant ouverture, il peut ainsi préparer ensuite une ouverture légale ; sa défausse est refusée tant que cette ouverture n’est pas complète. Le Joker et les cartes prises restent soumis aux validateurs ordinaires/spéciaux existants. La carte prise ne peut pas servir dans une Suite/Tierce pure obligatoire de l’ouverture ordinaire.

Un joueur déjà ouvert peut glisser une carte naturelle directement depuis la Défausse sur une combinaison autorisée. La prise et le Collage sont atomiques : groupe absent/réservé, mauvais rang/couleur, cinquième carte ou droit adverse insuffisant entraînent un refus sans retirer la carte du sommet. Une Tierce de trois couleurs différentes devient un Carré avec la quatrième couleur, sans reprise des trois cartes initiales. Une substitution de Joker existante demeure identique.

`game:draw` accepte `source`, `revision`, `roundId`, `cardId` pour vérifier le sommet affiché, et éventuellement `target: { ownerId, groupId }`. Le client n’envoie ni faces de cartes ni scores. Les événements Socket.IO sont traités synchroniquement dans l’ordre d’arrivée ; une révision périmée est rejetée avec **Coup invalide**, sans rejeu automatique. Le perdant d’une course peut recommencer après synchronisation. Il n’existe aucun état où deux prises possèdent la même carte physique.

## Conflits traités explicitement

1. **Préparations simultanées :** chaque main, baseline, pile Annuler, ouverture conditionnelle et Joker à réutiliser appartient à son joueur. Annuler ne modifie jamais la préparation d’un autre.
2. **Même groupe :** un groupe engagé visé par un Collage/remplacement provisoire est réservé à cet acteur jusqu’à engagement ou annulation. Les autres voient « Pose en cours » et doivent attendre. Les groupes provisoires d’un autre joueur ne sont pas des cibles autorisées. Le propriétaire peut toujours repositionner visuellement son groupe.
3. **Ouvertures concurrentes :** le premier total d’ouverture est enregistré lors de la première défausse qui engage une ouverture valide. Les ouvertures encore provisoires sont recontrôlées contre cette référence. Le partenaire doit toujours ouvrir personnellement ; son exception n’est disponible qu’après l’ouverture engagée du premier coéquipier.
4. **Jokers récupérés :** chacun doit être rejoué avant la défausse de son récupérateur, même si d’autres piochent entre-temps. Il ne peut pas être défaussé. Les annulations/reprises et la reconnexion conservent cette obligation.
5. **Fin de manche pendant des poses étrangères :** seule une défausse finale légale gagne. Les poses non engagées des autres sont rendues à leurs mains avant les pénalités ; elles ne peuvent donc pas réduire artificiellement leurs pénalités. Les groupes déjà engagés restent engagés. Les seuils, équipes, Descente totale, historique et progression de 15 secondes restent serveur.
6. **Annulation d’une prise :** le bouton **Annuler la prise** ou le glissé de la carte exacte vers la Défausse rétablit le choix de pioche avant utilisation et avant toute autre action irréversible. Une pioche ou défausse ultérieure interdit ce retour. Annuler/Tout annuler restent limités aux poses. Voir les [corrections complémentaires](CORRECTIONS-DEFAUSSE.md).
7. **Déconnexion :** un joueur qui doit défausser garde sa place et sa préparation. Le suivant peut piocher s’il dispose du droit et n’a pas lui-même de dette. Le droit attend lorsqu’il revient à un joueur indisponible ou encore obligé de défausser. Le départ explicite conserve l’annulation de manche et les scores terminés déjà existants.

Aucune nouvelle interdiction visant le propriétaire de la carte au sommet n’a été ajoutée : le droit de pioche, le sommet exact et les restrictions d’ouverture restent les critères existants. Une éventuelle interdiction de reprendre sa propre défausse nécessiterait une règle métier explicite.

## Interface conservée et améliorée

L’affichage J/Q/K reste une traduction de V/D/R. Les quatre enseignes naturelles sont exclusivement ♥/♦ rouges et ♠/♣ noires. Le dessin original, les dos et l’apparence distincte des Jokers sont conservés. Les cartes et leurs index sont légèrement agrandis ; le pas de la main s’adapte à sa largeur et au nombre de cartes, en gardant le chevauchement et les cartes accessibles.

Sélection multiple, tri privé, Descente libre, substitutions explicites, déplacements des groupes engagés et versions de disposition séparées restent disponibles. Les badges distinguent le droit de pioche des obligations de défausse. Les positions publiques et les préparations simultanées sont restaurées après reconnexion ; les mains et jetons ne sont jamais transmis aux autres joueurs.

## Fichiers concernés

- Serveur : `server/src/game.js`, `turns.js` (nouveau), `descente.js`, `app.js`, `group-layout.js`. Les validateurs et le calcul des pénalités sont conservés.
- Client : `client/src/table/GameTable.jsx`, `FreeMeldArea.jsx`, `PrivateHand.jsx`, `DescenteComposer.jsx`, `hand-order.js`, `table.css`.
- Tests nouveaux : `server/test/overlapping-turns.test.js`, `client/test/discard-drag.test.js`.
- Tests adaptés : `server/test/descente.test.js`, `draw-pass.test.js`, `full-match.test.js`, `game.test.js`, `group-layout.test.js`, `rooms.test.js`, `team-opening.test.js` ; `server/test-support/match-scenarios.js` compte toutes les préparations pour vérifier les 108 cartes.
- Navigateur : `tests/browser-overlap.mjs` (nouveau), `browser-audit.mjs`, `browser-interactions.mjs`, `browser-support.mjs`.
- Documentation : `README.md`, ce rapport et un avertissement dans `docs/MISE-A-JOUR-MAIN-TOURS.md` pour identifier le déroulement antérieur.

## Vérifications et limites

Résultats obtenus le 23 octobre 2026 : **196 tests réussis** (16 client, 180 serveur), build de production Vite réussi et **10 parcours Chrome réussis**. Les quatre matchs complets de deux manches, puis les six parcours ciblés, ont été exécutés à 1440 × 900 et 1280 × 820 selon les captures de chaque scénario. Le test d’attente de sélection d’équipe a été stabilisé en attendant explicitement l’état synchronisé du bouton. Les captures ont aussi permis de corriger le chevauchement des badges et du statut avec les cartes agrandies.

Les commandes de référence sont `npm.cmd test`, `npm.cmd run build` et `npm.cmd run test:browser`. Les parcours navigateur utilisent Chrome et des distributions déterministes injectées uniquement côté serveur, sans endpoint de triche. Les parties complètes couvrent individuel 2/3/4 joueurs et équipes 2v2, deux manches, rotation et résultat final. Le parcours individuel à deux joueurs attend réellement les 15 secondes ; les autres utilisent une horloge serveur de test. Les prises par clic, glissés natifs vers main et Tierce, obligations chevauchantes, poses, reprises, Jokers, tri, dispositions et reconnexions ont des scénarios dédiés.

La surface libre reste défilable sur les écrans de bureau pris en charge. Les courses sur une révision ancienne demandent de recommencer le geste ; le client ne rejoue jamais une pioche automatiquement. Les positions de main restent privées au navigateur. La persistance serveur après redémarrage et l’expiration des salons ne font pas partie de cette modification.
