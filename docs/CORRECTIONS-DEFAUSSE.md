# Corrections complémentaires — Défausse et présentation

## Défausse en tours chevauchants

Le refus a été reproduit avec deux clients Socket.IO : une action adverse augmentait la révision globale alors que la main et les poses du joueur obligé de défausser restaient inchangées. La défausse accepte désormais une révision globale antérieure lorsque `turnRevision`, version personnelle serveur, est encore exacte. Identité, distribution, obligation, propriété, ouverture, Jokers et intégralité des poses restent validés sur l’état courant. Une ancienne action personnelle ou un rejeu reste refusé. Le client affiche les raisons françaises fournies par le serveur, sans modifier le code de refus `Coup invalide`.

## Annuler la prise

Le bouton et le glissé vers la Défausse rendent la même carte physique et restaurent le droit de choisir une source. Le serveur mémorise son identifiant, les cartes restantes de la Défausse et la version des actions irréversibles. Aucune pioche dans la Pioche ne peut être annulée. Une nouvelle pioche, une défausse ou une annulation de prise empêche tout retour antérieur. La carte ne doit jamais avoir été utilisée, même si sa pose a ensuite été annulée. Une préparation sans cette carte doit être entièrement annulée avant son retour.

Cette limite conserve les actions adverses et empêche de consulter une carte cachée puis de rembobiner le jeu. Le retour ne compte pas comme une défausse normale. La reconnexion conserve les contrôles côté serveur ; aucune face privée ni checkpoint interne n’est diffusé aux autres joueurs.

## Présentation

La surface personnelle passe à 620 px de largeur maximale usuelle, 104 px de hauteur (88 px sur bureau compact), avec défilement conservé. Un placement cherche une position libre proche du dépôt sans déplacer les autres groupes ; une zone encombrée affiche un avertissement. Les groupes engagés restent déplaçables. Les enseignes naturelles utilisent des silhouettes SVG classiques rouges/noires pour éviter les variations de polices, tout en conservant le dessin des cartes, J/Q/K, leurs dimensions et leur chevauchement. Les dos et Jokers gardent leurs décorations distinctes.

## Fichiers modifiés

- Serveur : `game.js`, `turns.js`, `descente.js`, `app.js` ; nouveaux `pickup-return.js`, `move-error.js` dans `server/src`.
- Client : `GameTable.jsx`, `FreeMeldArea.jsx`, `PlayingCard.jsx`, `table.css` ; nouveaux `free-layout.js`, `suit-shapes.js` dans `client/src/table`.
- Tests : nouveaux `server/test/pickup-return.test.js`, `client/test/free-layout.test.js`, `tests/browser-pickup-return.mjs` ; adaptations de `server/test/rooms.test.js` et des parcours `browser-audit.mjs`, `browser-support.mjs`, `browser-interactions.mjs`, `browser-overlap.mjs`.
- Documentation : `README.md`, `TOURS-CHEVAUCHANTS.md`, ce rapport.

## Vérifications du 23 octobre 2026

- `npm.cmd test` : **205 tests réussis**, 18 client et 187 serveur, aucun échec.
- `npm.cmd run build` : build Vite réussi.
- `npm.cmd run test:browser` : **11 parcours Chrome réussis**, dont quatre matchs de deux manches (individuel 2/3/4 et équipes 2v2), rangement/reconnexion, Jokers, ouverture depuis Défausse, surface libre, tours chevauchants et nouvelles annulations.
- Nouveau parcours réel à deux navigateurs : bouton, glissé exact vers Défausse, restauration des droits, refus après pioche adverse, défausse autorisée malgré diffusion adverse volontairement retardée. Conservation des 108 cartes vérifiée après chaque mutation du scénario.
- Géométrie vérifiée à 1440 × 900 et 1280 × 820 ; captures `pickup-return-1440.png` et `pickup-return-1280.png` dans `.audit-artifacts`. Les tests existants vérifient également le déplacement des groupes engagés et sa synchronisation.

Les distributions des parcours sont injectées uniquement dans le serveur de test. Un scénario attend réellement les 15 secondes ; les autres matchs utilisent une horloge de test. Chrome a été exécuté ; les autres navigateurs ne sont pas certifiés par cette passe. La persistance après redémarrage serveur reste hors périmètre.
