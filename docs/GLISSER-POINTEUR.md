# Glisser les cartes avec la souris

## Diagnostic et changement

L’ancienne main ne traitait pas `pointerdown`/`pointermove`/`pointerup`. Elle attendait le démarrage du Drag & Drop HTML de Chrome et son image native. Aucun aperçu de carte n’était dessiné par React. Les tests précédents vérifiaient des déplacements et leurs résultats, sans vérifier visuellement un aperçu pendant l’appui. Ils ne suffisaient donc pas à certifier le comportement décrit dans le signalement Windows.

Cette dépendance est supprimée pour les cartes de la main, la Défausse et la poignée des groupes. Un contrôleur commun capture le pointeur dès l’appui gauche ; à partir de 6 pixels de déplacement, il affiche un aperçu fidèle des cartes sélectionnées dans un portail au niveau du document. Cet aperçu suit les coordonnées du pointeur, ne reçoit aucun événement de souris et ne subit pas le découpage des zones défilables. Les cartes déplacées restent à leur place jusqu’au relâchement. Un clic sans déplacement reste une sélection/désélection.

Le contrôleur réutilise les gestionnaires de dépôt existants via un adaptateur local `DataTransfer`/`DragEvent` : les événements HTML internes servent uniquement au routage de la destination. Aucun `dragstart` natif n’est nécessaire. La main ne transmet aucun rangement au serveur. Descente, Collage, récupération de Joker, prise et retour de Défausse continuent de passer par les événements Socket.IO et toutes les validations serveur existantes. Aucun code de règle serveur n’a été modifié.

Le contrôleur libère la capture et l’aperçu au relâchement, à la perte de capture/focus, à Échap, à une interruption et au changement de distribution. Il empêche seulement le clic parasite issu d’un déplacement sur sa source, sans absorber le clic suivant sur un autre contrôle. Les mises à jour indépendantes d’un autre joueur ne détruisent pas le geste. Les positions synchronisées des groupes et le rangement privé persistant sont conservés.

Le profil personnel du navigateur signalé n’a pas été inspecté : son éventuel facteur supplémentaire de configuration Windows/Chrome n’est pas établi. Le nouveau fonctionnement ne dépend plus du mécanisme natif mis en cause.

## Fichiers modifiés

- Nouveaux `client/src/table/usePointerDrag.jsx` et `pointer-drag.js` : geste, capture, aperçu, seuil et calcul de l’insertion.
- `client/src/table/PrivateHand.jsx` : source simple/multiple et rangement privé.
- `client/src/table/GameTable.jsx` : source de la Défausse.
- `client/src/table/FreeMeldArea.jsx` : déplacement des groupes.
- `client/src/table/table.css` : aperçu, curseur et propriétés d’interaction.
- Nouveau `client/test/pointer-drag.test.js` : seuil clic/glissé et insertion dans une main superposée.
- `tests/browser-support.mjs` : véritables événements souris, contrôle de l’aperçu à cinq positions et mode Chrome fenêtré.
- `tests/browser-free-table.mjs` : cartes non sélectionnées/sélectionnées, groupe sélectionné, début/milieu/fin et captures pendant le geste.
- `tests/browser-overlap.mjs` : disponibilité des nouvelles sources de Défausse.
- `README.md`, ce rapport.

## Vérification des gestes

Résultats du 23 octobre 2026 : **211 tests automatisés réussis** (24 client, 187 serveur), build Vite réussi et **11 parcours Chrome complets réussis**. Les **7 parcours ciblés** ont également été exécutés avec une fenêtre Chrome sous Windows. Les écrans restent vérifiés à 1440 × 900 et 1280 × 820. Les commandes complètes sont `npm.cmd test`, `npm.cmd run build` et `npm.cmd run test:browser`.

L’outil navigateur envoie uniquement les événements souris Chrome : appui gauche, cinq mouvements avec `buttons: 1`, puis relâchement. Il n’injecte pas de dépôt et n’intercepte plus de Drag & Drop natif. À chaque mouvement, il vérifie l’existence de l’aperçu et sa position à moins de 2 pixels du décalage attendu. Il contrôle aussi le nombre de cartes représentées, l’indicateur d’insertion avant relâchement, le retrait de l’aperçu après relâchement et les événements pointeur fiables (`isTrusted`). Un `dragstart` HTML fait échouer le test.

La main est vérifiée au début, au milieu et à la fin, avec une carte sélectionnée ou non, puis trois cartes dont l’ordre relatif est contrôlé. Un autre client pioche pendant un glissé. Les autres gestes couvrent les poses libres, le Collage sur une carte de Tierce pour obtenir un Carré, l’extension 7♥–8♥–9♥ avec 10♥, les Jokers, le déplacement de groupes engagés, les prises de Défausse et leurs annulations. Les captures `pointer-selected-during-drag.png` et `pointer-multiple-during-drag.png` sont enregistrées dans `.audit-artifacts`.

Pour reproduire avec une fenêtre Chrome sous PowerShell :

```powershell
$env:RAMI_BROWSER_HEADED = '1'
node tests/browser-audit.mjs --interactions-only
Remove-Item Env:RAMI_BROWSER_HEADED
```

Les distributions des scénarios restent injectées côté serveur de test ; aucune commande de triche n’est exposée dans l’application. Le support reste limité au bureau. Les autres navigateurs et le profil Chrome personnel ne sont pas certifiés par cette passe.
