# Récupérer ses poses et rendre une carte prise à la Défausse

Pendant sa préparation personnelle, avant sa défausse :

- Glisser une carte posée vers sa main pour la reprendre. Cliquer plusieurs cartes posées, puis en glisser une sélectionnée pour reprendre la sélection en une seule opération, y compris depuis plusieurs groupes.
- Glisser la poignée **⠿** d’une combinaison provisoire vers sa main pour reprendre la combinaison entière. La même poignée continue de déplacer les groupes dans leur zone de Descente.
- Si retirer la sélection rend le reste d’une combinaison provisoire invalide, ce reste revient également en main. Un groupe engagé reste protégé ; seuls les ajouts de ce tour peuvent en revenir. Les obligations de remplacement et de réemploi de Joker restent applicables.
- Après avoir récupéré toutes ses poses, glisser **la carte physique prise** de sa main vers la Défausse. Le sommet et l’ordre antérieur de la Défausse sont restaurés. Le joueur peut alors piocher dans la Pioche immédiatement, sans défausse personnelle intermédiaire.

Le fait d’avoir provisoirement utilisé la carte prise ne bloque plus son retour une fois la préparation entièrement restituée. L’historique des actions réversibles peut rester présent : il n’est pas nécessaire d’utiliser Tout annuler avant de rendre la carte. Une autre carte, même de même rang et couleur mais issue de l’autre jeu, ne remplace jamais la carte physique prise.

Les boutons **Annuler**, **Tout annuler**, **Reprendre** et **Annuler la prise** restent disponibles selon leurs conditions habituelles. Annuler peut rétablir une récupération effectuée à la souris. Les poses engagées lors d’une défausse, les cartes des autres joueurs, les sources de récupération de Joker encore remplacées, les demandes périmées et les groupes réservés à une préparation adverse ne peuvent pas être récupérés ainsi.

Pendant la décision de prise, les pioches et les défausses adverses sont maintenant refusées côté serveur pour préserver le retour exact. Les essais réversibles restent autorisés. La défausse personnelle confirme l’utilisation de la carte prise et lève le verrou ; sa restitution exacte permet au contraire de piocher au stock sans terminer le tour. Voir [Décision de Défausse](DECISION-DEFAUSSE.md). Les validations des ouvertures, des combinaisons, du Collage et des Jokers restent côté serveur. Le retour d’une sélection est atomique et produit une seule entrée d’annulation ; les autres joueurs reçoivent la mise à jour via Socket.IO sans voir les faces des cartes revenues dans la main privée.

## Vérifications reproductibles

```sh
npm test
npm run build
CHROME_PATH=/chemin/vers/chrome node tests/browser-retrieve-return.mjs
CHROME_PATH=/chemin/vers/chrome npm run test:browser
```

Le nouvel audit utilise de vraies souris CDP/Pointer Events et deux contextes de navigateur indépendants. Huit distributions de test couvrent Suites de 3, 5 et 6 cartes, As haut et bas, Tierces, Carrés, figures, les quatre couleurs et des combinaisons avec Joker. Les groupes sont posés depuis le composeur puis récupérés à la souris ; les cartes prises sont rendues à leur Défausse, puis une carte du stock est piochée. Les boutons d’annulation, la synchronisation et la conservation des 108 cartes sont également vérifiés. Les tests serveur parcourent les 108 cartes physiques pour le retour de prise, y compris les doublons et les quatre Jokers.

Rapport JSON et captures du nouvel audit : `.audit-artifacts/retrieve-return/` (ignoré par Git). Ces distributions sont créées uniquement au démarrage des serveurs de test, sans endpoint de test ni modification de l’état en cours de partie.
