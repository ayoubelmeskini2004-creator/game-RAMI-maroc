# Décider d’une prise de Défausse

Le serveur conserve une prise en attente jusqu’à l’une des décisions suivantes :

1. Le joueur restitue toutes ses poses, Collages et remplacements provisoires, rend exactement la carte physique prise à la Défausse, puis peut piocher au stock sans terminer son tour.
2. Le joueur utilise cette carte dans une combinaison légale, puis défausse une autre carte. Toutes les validations habituelles de Descente, Collage, ouverture et Joker s’appliquent à cette défausse atomique. La carte prise doit se trouver dans un groupe réellement engagé.

Une pose provisoire n’est pas une décision définitive : elle peut encore être annulée. Le verrou reste donc actif jusqu’à la défausse personnelle ou la restitution exacte. Pendant cette période, tous les joueurs sont empêchés de piocher ; les autres préparations déjà en cours peuvent rester réversibles, mais ne peuvent pas défausser et changer la pile. Les gestes de disposition et les essais réversibles restent possibles. Une reconnexion ne libère pas ce verrou.

L’autre exemplaire d’une même face ne compte pas comme utilisation de la carte physique prise. Une carte inutilisée ne peut être conservée en main en défaussant simplement une autre carte. La même carte prise ne peut pas être défaussée par l’action normale pour contourner son obligation : elle doit être rendue par l’annulation de prise.

La projection publique expose uniquement `pickupDecisionPlayerId` pour expliquer l’attente. Les droits `canDraw` et `canDiscard` sont calculés individuellement. Les requêtes directes restent vérifiées côté serveur : la désactivation des boutons n’est pas la protection principale. Les anciennes révisions, identités étrangères, doubles demandes et tentatives de prise concurrentes restent rejetées sans mutation partielle.

Les règles d’ouverture, l’escalade d’un point, les exceptions d’équipe, les scores, les Jokers, les réservations de groupes et le chevauchement des préparations après une pioche **au stock** ne changent pas. Une fois la décision résolue, les obligations antérieures des autres joueurs sont conservées.

## Vérifications

```sh
npm test
npm run build
CHROME_PATH=/chemin/vers/chrome node tests/browser-discard-decision.mjs
CHROME_PATH=/chemin/vers/chrome npm run test:browser
```

Les tests serveur parcourent tous les sièges en configurations de 2, 3 et 4 joueurs. Ils couvrent les pioches concurrentes interdites, les retours exacts et versions périmées, l’utilisation suivie d’une autre défausse, les préparations adverses antérieures et une ouverture complète de 72 points employant le mauvais exemplaire physique.

L’audit dédié connecte deux contextes Chromium à un serveur Socket.IO réel, puis exerce les deux rôles à la souris : prise inutilisée refusée, essais de groupes, Annuler, Tout annuler, reconnexion avec verrou conservé, restitution exacte et pioche immédiate, utilisation dans une Descente puis dans un Collage, annulation de cette utilisation et validation définitive. Les 108 cartes physiques et la confidentialité des mains sont contrôlées. Les captures sont générées dans `.audit-artifacts/discard-decision/`.
