# Validation pure des combinaisons

`combinations.js` exporte deux fonctions synchrones, sans accès à Socket.IO ni mutation de la partie. Le moteur `descente.js` les utilise pour les poses provisoires, les ouvertures, les prises conditionnelles de défausse et la validation finale du tour. Ce module pur ne modifie jamais `opened`, les mains ou les piles.

## `validateCombination(proposal, availableCards)`

`availableCards` est une liste de cartes physiques **provenant de la main autoritative côté serveur**, au format `{ id, rank, suit }`. Le module résout chaque identifiant dans cette liste ; les valeurs, couleurs et points éventuellement ajoutés à une proposition sont ignorés. L’appelant futur devra fournir la vraie main de la connexion authentifiée, jamais un catalogue envoyé par le client.

```js
import { validateCombination } from './combinations.js';

const result = validateCombination({
  type: 'suite',
  cardIds: [idHuitCoeur, idJoker, idDixCoeur],
  joker: { cardId: idJoker, rank: '9', suit: 'hearts' },
}, authoritativeHand);
```

- `type` : `suite`, `tierce` ou `carre`.
- `cardIds` : identifiants physiques distincts. Pour une Suite, l’ordre proposé est explicite et croissant. Le module ne trie pas les cartes et ne choisit pas la signification d’un Joker à la place du joueur.
- `joker` : obligatoire si le groupe contient un Joker, interdit sinon. L’affectation doit préciser l’identifiant de ce Joker, le rang et la couleur naturels exacts qu’il remplace. Aucune déduction implicite, même si une seule possibilité semble exister.
- Couleurs : `hearts`, `diamonds`, `clubs`, `spades`. Rangs internes : `A`, `2` à `10`, `V`, `D`, `R`, `Joker`. Les alias `J`, `Q`, `K` sont acceptés et normalisés vers `V`, `D`, `R`. Un Joker physique a `suit: null`.

Une Suite correspond à une fenêtre de 3 à 14 positions dans `A,2,3,4,5,6,7,8,9,10,V,D,R,A`. Ainsi `A,2,3` et `D,R,A` sont valides ; `R,A,2`, les trous et les répétitions intermédiaires ne le sont pas. La Suite naturelle de 14 cartes utilise deux As physiques différents, aux extrémités. Un Joker peut remplacer une seule position, y compris un As ; sa position fixe sa valeur basse ou haute sans ambiguïté.

Une Tierce contient exactement 3 cartes de même rang et de 3 couleurs différentes ; un Carré exactement 4 cartes de même rang et des 4 couleurs différentes. Les copies du deuxième jeu ne permettent pas de répéter une couleur. Un cinquième élément est toujours refusé.

Résultat valide :

```js
{
  valid: true,
  errors: [],
  type: 'suite',
  pure: false,
  cards: [
    // Cartes détachées de l’entrée, dans l’ordre proposé.
    // Une carte naturelle a substitution: null.
    // Le Joker conserve son identité physique et rank: 'Joker', suit: null,
    // avec substitution: { rank: '9', suit: 'hearts' } et points: 9.
  ],
  naturalPoints: 18, // 8 + 10 ; Joker exclu
  totalPoints: 27,   // 8 + 9 + 10
}
```

Les figures valent 10. Un As initial de Suite vaut 1 ; l’As placé après le Roi vaut 10. Les As de Tierce ou de Carré valent 10. Un Joker prend la valeur de sa substitution, mais ne contribue jamais aux points naturels.

Un refus retourne `valid: false`, `errors: [{ code, message }]`, des listes de cartes vides et des points à zéro. Les messages sont en français. Une entrée mal formée, une carte inconnue, un identifiant répété, une affectation de Joker invalide ou une combinaison illégale donnent un résultat de refus ; les erreurs de programmation inattendues ne sont pas masquées.

## `validateOpening(proposals, availableCards, options = {})`

`proposals` est une liste de groupes au format ci-dessus. La liste `availableCards` provient également de la main réelle côté serveur. Une carte physique ne peut apparaître dans plusieurs groupes, y compris un Joker ; deux exemplaires distincts d’une même face peuvent servir dans des groupes différents.

```js
import { validateOpening } from './combinations.js';

const result = validateOpening(proposals, authoritativeHand, {
  discardTakenCardId: serverTrackedDiscardId, // null si aucune carte prise
});
```

`discardTakenCardId` est un contexte fiable fourni par le serveur, pas une indication à accepter du client. S’il est renseigné, il doit être présent dans la main. Il peut ne pas faire partie des groupes proposés.

L’ouverture ordinaire exige simultanément :

1. Au moins une Suite pure et une Tierce pure, sans Joker et sans la carte physique juste prise à la défausse. Un Carré ne remplace pas la Tierce obligatoire.
2. Au moins 71 points de cartes naturelles parmi toutes les combinaisons valides posées, hors Jokers.

La restriction sur la carte de défausse concerne **l’éligibilité des groupes obligatoires**. Cette carte reste naturelle et contribue aux points si elle figure dans un autre groupe posé. Les cartes naturelles d’un groupe avec Joker contribuent également aux points ; seul le Joker est exclu. La provenance n’est pas déduite de la face : l’autre exemplaire physique de la même carte ne subit pas cette restriction.

Le résultat contient :

| Champ | Signification |
| --- | --- |
| `valid` | Toutes les combinaisons et toutes les conditions d’ouverture sont satisfaites. |
| `errors` | Codes stables et messages français des conditions non satisfaites. |
| `qualifyingNaturalPoints` | Somme des cartes naturelles des groupes posés, sans les Jokers. |
| `totalLaidPoints` | Somme posée, substitutions des Jokers comprises. |
| `groups` | Résultats détaillés des groupes, avec `mandatoryEligible`. |
| `mandatorySuiteIndices` | Indices des Suites pouvant satisfaire l’exigence obligatoire. |
| `mandatoryTierceIndices` | Indices des Tierces pouvant satisfaire l’exigence obligatoire. |

Quand les combinaisons sont légales mais qu’une condition d’ouverture échoue, les points réels sont retournés pour expliquer le refus. Si une combinaison est illégale, le contexte invalide ou une carte réutilisée, l’ouverture entière est rejetée avec des points à zéro : aucun score partiel n’est présenté comme validé.

Le module ne vérifie pas le tour et ne réalise aucune ouverture : ces responsabilités sont assurées par `game.js` et `descente.js`. L’escalade est calculée par `descente.js`, sans modifier ce validateur ordinaire réutilisable. L’ouverture spéciale d’équipe est validée par `team-opening.js`, qui réutilise les contrôles structurels et remplace les exigences de points et de groupes purs par une Suite valide. Le présent module n’implémente ni collage, ni remplacement/récupération de Joker, ni pénalité, ni fin de manche.
