# Corrections du glisser-déposer, du Collage et de la prise

## Causes identifiées

- Les cartes posées et la Défausse contiennent des dessins SVG. Contrairement aux cartes de la main, ces dessins recevaient les événements de souris. Un glissé natif pouvait alors ne produire aucun dépôt sur le bouton attendu. Ce défaut a été reproduit dans Chrome sur le remplacement d’un Joker. L’ancien outil de test interceptait le glissé puis envoyait explicitement l’événement de dépôt ; il ne détectait pas ce problème.
- La main effaçait la source du glissé à chaque révision globale. Une pioche adverse suffisait à annuler un rangement privé. Les actions de jeu refusaient aussi un glissé dont seule la version globale avait changé.
- La zone Défausse n’acceptait les cartes de la main que lorsqu’une prise existait et traitait systématiquement le dépôt comme un retour de prise. Une autre carte ne pouvait donc pas suivre le chemin de défausse normale.
- Un dépôt interdit sur un groupe pouvait remonter vers la surface libre et être interprété comme une nouvelle Descente.

## Corrections

Les dessins décoratifs des cartes posées et de la Défausse sont transparents aux événements de souris ; les contrôles existants reçoivent les gestes. Le rangement privé vérifie la distribution, l’identité et toutes les cartes physiques sélectionnées sans dépendre des actions adverses. L’ordre relatif, le repère d’insertion, le tri et le stockage privé restent conservés.

Les glissés destinés à une action de jeu transportent aussi la version personnelle du joueur. Une modification adverse indépendante est tolérée uniquement si cette version n’a pas changé ; l’action est ensuite envoyée avec l’état courant et entièrement validée par le serveur. Les validateurs, permissions d’ouverture/Collage/Joker et règles de tours chevauchants ne sont pas modifiés.

Sur la Défausse, la carte exacte de la dernière prise demande son annulation, avec le motif français du serveur si le retour est devenu impossible. Une autre carte demande une défausse normale. Les dépôts multiples, cartes absentes, autre distribution et Jokers récupérés à rejouer sont refusés. Le bouton Annuler la prise et les protections serveur antérieures restent en place. Le dépôt d’un groupe ne peut plus être détourné vers la surface libre quand le Collage est interdit.

La zone verte agrandie, ses positions synchronisées, la poignée de déplacement des groupes engagés, J/Q/K et les quatre enseignes classiques sont conservés.

## Fichiers modifiés

- `client/src/table/PrivateHand.jsx`, `hand-order.js` : maintien des glissés pendant les mises à jour indépendantes.
- `client/src/table/GameTable.jsx`, nouveau `discard-drop.js` : distinction retour de prise / défausse normale et contrôle des glissés de Collage.
- `client/src/table/FreeMeldArea.jsx`, `table.css` : propagation des événements et cibles de dépôt.
- Nouveau `client/test/discard-drop.test.js` : quatre régressions ciblées.
- `tests/browser-support.mjs` : gestes de souris natifs par défaut, sans événement de dépôt injecté, clics sur les bandes exposées, attente des acquittements.
- `tests/browser-interactions.mjs`, `browser-free-table.mjs`, `browser-overlap.mjs`, `browser-pickup-return.mjs` : scénarios natifs et cibles physiques explicites.
- `README.md`, ce rapport.

## Vérifications

Commandes : `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:browser`.

Résultats du 23 octobre 2026 : **209 tests automatisés réussis** (22 client, 187 serveur), aucun échec ; **build Vite réussi** ; **11 parcours Chrome réussis**. Affichage et captures vérifiés à 1440 × 900 et 1280 × 820 dans `.audit-artifacts`.

Les parcours ciblés vérifient le rangement individuel et multiple, une pioche adverse pendant le glissé, la sélection multiple par vrais clics souris, les poses libres, le déplacement d’un groupe engagé, l’extension 7♥–8♥–9♥ avec 10♥, Tierce vers Carré en déposant sur une carte du groupe, le remplacement de Joker, les deux méthodes d’annulation de prise et une défausse normale par glissé. Les vues de deux clients, la reconnexion, la conservation des 108 cartes, les refus et la confidentialité sont contrôlés. Les matchs complets couvrent individuel 2/3/4 et équipes 2v2 sur deux manches ; un scénario attend réellement les 15 secondes, les autres utilisent une horloge de test.

Limites conservées : bureau uniquement, Chrome vérifié par cette passe. La carte exacte d’une prise se glisse vers la Défausse pour demander son annulation ; pour la défausser normalement, sélectionner cette carte et utiliser Défausser. Aucune prise ne peut être annulée après utilisation ou une nouvelle action irréversible. Les positions de la main restent privées et locales au navigateur ; la mémoire serveur ne persiste pas après redémarrage.
