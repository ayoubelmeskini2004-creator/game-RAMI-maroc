# Mise à jour : cartes, main, descente libre et tours

> Rapport de l’étape antérieure. Le déroulement des tours décrit ici est remplacé par les [tours chevauchants](TOURS-CHEVAUCHANTS.md), qui constituent la règle actuelle.

Les rangs internes V/D/R, les identifiants physiques, les validateurs et les calculs de points sont conservés. Seul leur affichage devient J/Q/K. Le lobby, les équipes 2v2, les scores, le chat et les sessions utilisent toujours les mêmes services.

## Comportements réalisés

- Clics multiples puis déplacement de toute la sélection dans la main, dans son ordre visuel courant. Les positions d’insertion incluent les limites situées parmi les cartes sélectionnées. Aucun événement de jeu n’est envoyé pour ce rangement. Le tri automatique et la mémoire privée des positions restent disponibles.
- Dépôt d’une sélection naturelle valide dans la surface personnelle libre : proposition de Suite, Tierce ou Carré, suivie d’une validation serveur. Une sélection contenant un Joker ouvre le composeur pour préciser sa substitution et l’ordre de la Suite. Le dépôt dans la main n’ouvre jamais de projet.
- Surfaces sans cases par type, avec défilement et positions publiques normalisées. La poignée ⠿ déplace un groupe entier, provisoire ou engagé, y compris hors du tour de son propriétaire. Le contenu et les points du groupe ne changent pas. Un autre joueur ne peut pas déplacer ce groupe.
- Disposition et jeu ont des versions indépendantes : un déplacement visuel concurrent n’invalide pas une défausse ou une pioche. Les réponses tardives ne rétablissent ni un ancien état du jeu ni une ancienne disposition.

## Nouveau cycle autoritatif

Le premier joueur reçoit toujours 15 cartes. Il défausse avant toute pose puis garde la main pour préparer des poses et piocher. Les autres reçoivent 14 cartes et n’ont pas de défausse obligatoire à leur premier passage. Toute pioche, depuis le stock ou la Défausse, termine immédiatement le tour et impose une défausse au prochain passage du joueur concerné.

Le cycle normal devient **défausser → poses facultatives → piocher → passage horaire**. Les poses sont aussi possibles avant la défausse obligatoire, sauf la toute première défausse du donneur. Une défausse engage atomiquement les poses légales puis permet au même joueur de piocher ; une pioche engage ses éventuelles nouvelles poses et passe au suivant. Une ouverture incomplète ou un Joker récupéré non réutilisé bloque ces engagements sans consommer de carte.

Une ouverture depuis la Défausse est prévalidée puis immédiatement engagée avec la prise. Elle ne peut plus être annulée après le passage au suivant. Les poses précédemment préparées peuvent contribuer à cette ouverture ; les restrictions de pureté et de carte prise restent appliquées. Annuler et Tout annuler ne traversent jamais un engagement déjà effectué. Les déplacements visuels ne sont pas des actions d’annulation du jeu.

Une victoire exige toujours la défausse de la dernière carte pendant une phase autorisée. Une pioche et une pose seules ne gagnent jamais la manche. Les pénalités, la Descente totale, les exceptions d’équipe et la rotation entre manches restent régies par les modules existants. Une reconnexion conserve les obligations de défausse, les poses provisoires et les positions publiques.

## Fichiers modifiés ou ajoutés

- Client : `GameTable.jsx`, `PlayingCard.jsx`, `PrivateHand.jsx`, `DescenteComposer.jsx`, `FreeMeldArea.jsx`, `hand-order.js`, `card-label.js`, `group-proposal.js`, `state.js`, `table.css`, dans `client/src/table/`.
- Serveur : `server/src/game.js`, `server/src/descente.js`, `server/src/app.js`, `server/src/group-layout.js`.
- Tests client : `client/test/multi-drag.test.js`.
- Tests serveur : `server/test/draw-pass.test.js`, `group-layout.test.js`, `game.test.js`, `descente.test.js`, `collage.test.js`, `joker.test.js`, `team-opening.test.js`, `rooms.test.js`, `full-match.test.js` ; distributions de référence dans `server/test-support/match-scenarios.js`.
- Tests navigateur : `tests/browser-audit.mjs`, `browser-interactions.mjs`, `browser-support.mjs`, `browser-free-table.mjs`.
- Documentation : `README.md` et ce rapport.

## Vérifications

- `npm.cmd test` : 182 tests réussis, dont 15 client et 167 serveur. Les tests existants de phases et de prises de Défausse ont été adaptés au nouveau cycle ; aucun test supprimé.
- `npm.cmd run build` : compilation de production Vite réussie.
- `npm.cmd run test:browser` : huit parcours vérifiés dans Chrome, comprenant quatre matchs complets de deux manches (individuel à 2, 3 et 4 joueurs ; équipes 2v2), le rangement privé/reconnexion, les récupérations de Joker, l’ouverture depuis la Défausse et la nouvelle surface libre. Le parcours individuel à deux joueurs vérifie réellement les 15 secondes entre manches ; les autres matchs utilisent une horloge serveur de test.
- Glissés natifs Chrome : insertion manuelle, sélection multiple, poses à des positions différentes, Collage, remplacement de Joker et déplacement d’un groupe engagé hors tour. Les sélections de certaines cartes dans les scénarios utilisent leurs gestionnaires de clic par identifiant physique.
- Affichage contrôlé à 1440 × 900 et 1280 × 820 ; chevauchement de la surface adverse corrigé. Captures locales dans `.audit-artifacts/` (ignorées par Git).

## Limites explicites

La surface est défilable pour conserver les commandes dans les tailles de bureau prises en charge. Le rangement de la main est propre au navigateur ; les positions des groupes sont publiques. Visez un espace libre pour créer un groupe : un dépôt sur un groupe ou son Joker conserve les interactions de Collage/remplacement. Les positions choisies peuvent se chevaucher volontairement. Les cartes déjà engagées ne sont pas reprises lors d’un déplacement visuel. Le serveur reste en mémoire : un redémarrage ne conserve pas les salons, les parties ou les positions.

Lancement local : `npm.cmd run dev` à la racine ; voir le README pour les ports et le lancement de production.
