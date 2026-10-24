# Audit de Rami Marocain 71

## Périmètre et méthode

Audit de l’architecture React/Vite, Express, Socket.IO, de tous les modules de règles, du protocole, des vues privées/publiques, des actions client et des tests existants. Aucune nouvelle règle ni action de jeu n’a été ajoutée.

Le moteur conserve les cartes et les poses côté serveur. Les validateurs purs contrôlent les combinaisons ; les modules de Descente, Collage et Joker gardent les modifications provisoires ; la défausse valide le commit et les scores. Express possède les identités, salons et transitions de manches. Les simulations de test injectent uniquement la distribution initiale et l’horloge via les interfaces serveur existantes ; aucun endpoint de test n’est exposé.

## Défauts corrigés et régressions

| Défaut | Correction | Vérification automatique |
|---|---|---|
| Un ancien coup pouvait retrouver la même révision après annulation et redistribution. | Identifiant `roundId` unique par distribution, exigé sur toute mutation Socket.IO et dans les données de drag ; échéance liée à cette distribution. | `progression.test.js` rejoue exactement le même numéro, premier joueur, acteur et révision : anciens identifiants refusés ; deux pioches concurrentes n’en exécutent qu’une. |
| Les acquittements et resynchronisations client n’appliquaient pas tous la comparaison de manche et de révision. | Ordre commun dans `state.js`, suivi des requêtes en cours, brouillon local fermé sur déconnexion/changement de distribution. | `client/test/state.test.js` et interruption réelle de transport avec récupération de Joker provisoire et brouillon ouvert dans Chrome. |
| Une sélection de main pouvait être changée pendant une requête, puis effacée à l’arrivée de son acquittement. | Verrou de requête immédiat et cartes de main désactivées jusqu’à acquittement. | Diffusion avant acquittement volontairement retardé de 600 ms : sélection vérifiée désactivée puis réactivée. |
| À 1280×820, la barre d’actions dépassait l’écran ; une erreur pouvait aussi repousser les commandes et masquer le statut du tour derrière le siège. | Cadrage compact du tapis, tailles et espacements adaptés, réduction du tapis plutôt qu’agrandissement de la page lors des erreurs ; statut séparé des piles et ancré au-dessus de la main. | Mesure et captures à 1440×900 et 1280×820, avec et sans `Coup invalide`. Aucune commande sous le viewport ni débordement horizontal ; assertions des distances entre poses adverses, piles, statut et siège. |
| Les petites cartes posées se recouvraient, masquant notamment le centre cliquable d’un Joker. | Cartes posées espacées, zone du joueur opposé élargie, contrôles agrandis et cibles de drag non interceptées par l’illustration ou un bouton désactivé. | Clic réel CDP au centre du Joker ; drag natif Chrome depuis la main pour récupération et Collage d’équipe. |
| Confirmation trompeuse depuis le salon réservé ; préparation proposée après la fin de partie ; gagnant encore indiqué « À son tour ». | Texte de réservation cohérent, préparation masquée pour une partie terminée, absence de tour actif au tableau des scores. | Parcours de départ/retour depuis table et salon réservé, puis retour au salon après match et vérification des contrôles et scores. |

## Scénarios exécutés

- **Tests serveur et Socket.IO :** parties complètes à 2, 3 et 4 joueurs, puis 2v2 ; deux manches avec vraies distributions de 15/14 cartes, premier joueur/rotation, première défausse obligatoire, pioche avant défausse, ouverture, annulations, Collage, score final et confidentialité. À chaque action, 108 cartes physiques distinctes sont conservées. Les diffusions sont contrôlées contre les identifiants de toutes les cartes privées et les jetons des autres joueurs.
- **Chrome, parties complètes :** mêmes quatre configurations, depuis les formulaires de création et de jonction jusqu’au résultat final de deux manches et à leur historique. Contextes de navigateur indépendants, connexions Socket.IO réelles, actions par les commandes React. En équipes : partenaire opposé, ouverture ordinaire, Suite spéciale avec Joker sous 71 points, Collage sur le partenaire et victoire d’équipe.
- **Chrome, interactions ciblées de milieu de manche :** mauvais remplacement de Joker, message français, clic et glisser-déposer natif, récupération sur adversaire sans seuil de Collage, Annuler/Tout annuler, rétablissement, reprise du groupe réutilisant le Joker, refus de défausse avant réemploi, commit, interruption/reconnexion pendant les poses, transfert d’hôte, départ explicite et retour réservé. Un second scénario exécute une ouverture depuis Défausse, l’annule, vérifie le refus de défausser, rend la carte, puis ouvre légalement.
- **Chronométrage :** un passage de manche dans Chrome attend les 15 secondes réelles et vérifie le décompte décroissant. Les autres utilisent l’horloge serveur injectable. Les tests Socket.IO contrôlent exactement l’échéance, sa conservation à la reconnexion, l’annulation, les égalités prolongées et la rotation.
- **Règles pures et autres intégrations :** Suites naturelles et tous les placements uniques de Joker, As bas/haut et Suite de 14, Tierces/Carrés, 71 naturels, pureté, défausse et escalade sur le premier total ; Collage adverse strict et héritage d’équipe ; multiples récupérations, reprise, conservation et confidentialité ; pioche recyclée sans son sommet ; pénalités, Descente totale ordinaire/spéciale, cumuls et départages ; salon, chat, reprise d’identité et absence de doublons.

Les quatre parties complètes utilisent des distributions **déterministes de test** afin de terminer légalement et de façon reproductible ; ce ne sont pas des parties à distribution aléatoire jouées manuellement. Les deux scénarios ciblés commencent dans un état de milieu de manche préparé côté serveur. Les drag natifs utilisent les événements souris et `Input.dispatchDragEvent` de Chrome ; les sélections de cartes de main utilisent leur gestionnaire de clic DOM, et les boutons/composeurs sont cliqués avec vérification de visibilité. Aucun test Firefox, Safari ou mobile n’est revendiqué.

## Résultats et limites

- Suite Node : **159 tests**, tous réussis (4 client, 155 serveur).
- Navigateur : **6 scénarios**, dont 4 parties de deux manches et 2 scénarios ciblés, avec contrôles aux deux tailles demandées.
- Build de production Vite : réussi.
- Couverture serveur mesurée : 99,91 % des lignes, 98,21 % des branches sur les fichiers instrumentés ; elle ne représente pas une couverture JSX du client.
- Aucun blocage restant constaté dans le périmètre exécuté. Les salons et résultats restent en mémoire : un redémarrage du serveur les efface, comme documenté avant cet audit. Les interprétations de règles déjà détaillées dans le README restent inchangées.

## Reproduire sous PowerShell

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
npm.cmd run dev
```

Développement : http://localhost:5173. Pour servir le build avec Express : `npm.cmd start`, puis http://localhost:3001.

Le test navigateur nécessite Chrome et Node.js 22+ ; `CHROME_PATH` peut pointer vers un autre exécutable Chrome. Captures et mesures : `.audit-artifacts/`. `--teams-only`, `--interactions-only` et `--layout-only` sont disponibles sur `node tests/browser-audit.mjs` pour isoler un diagnostic. Les tests de jeu ordinaires n’ont pas besoin de Chrome.
