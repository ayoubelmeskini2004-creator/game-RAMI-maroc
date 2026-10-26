# Tester sur Render

Dans Render, créer un **Blueprint**, connecter le dépôt GitHub
`ayoubelmeskini2004-creator/game-RAMI-maroc`, puis sélectionner la branche
`codex/render-discard-fix`. Render lit le fichier `render.yaml` à la racine.
Vérifier le forfait gratuit avant de lancer la création de la ressource.

Le build installe aussi les dépendances de développement nécessaires à Vite,
puis compile le client. Express sert le client compilé et Socket.IO sur le
port `PORT` fourni par Render. Aucun secret ni base de données n'est requis.
Le contrôle de disponibilité utilise `/api/health`.

Après le déploiement, ouvrir l'adresse HTTPS fournie par Render dans deux
profils de navigateur distincts pour tester avec deux joueurs. Les onglets
d'un même profil partagent l'identité du joueur.

Les salons et parties sont en mémoire et disparaissent à chaque redémarrage
ou mise en veille du service. Le service gratuit peut nécessiter un délai
de réveil après une période d'inactivité. Les déploiements automatiques sont
désactivés ; utiliser un déploiement manuel pour les prochains essais.
