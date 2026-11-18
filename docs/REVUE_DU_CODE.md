# Revue du code et du site — novembre 2026

Demande du propriétaire : « repasser tout en revue afin d'optimiser et/ou corriger des erreurs ». Ce document dit **ce qui a été regardé**, **ce qui était déjà bon**, **ce qui a été corrigé** (avec la preuve) et **ce qui reste à décider**. Une revue ne prouve pas qu'il n'y a plus aucun défaut : elle réduit le risque dans les endroits où une erreur coûterait le plus.

## 1. Ce qui a été regardé

| Domaine | Comment |
|---|---|
| Dépendances | `npm audit`, `npm outdated`, mises à jour compatibles |
| Construction du site | `next build` complet (aucun avertissement), taille des fichiers envoyés au navigateur |
| Paiements | webhook Stripe, traitement des événements, remboursements, tâche d'entretien, protections « jamais de vrai paiement par accident » |
| Droits d'accès | les 34 routes de l'API (origine, connexion, rôle, limites de débit), interrupteurs de développement, en-têtes de sécurité |
| Envois et textes | validation des images (type réel, bombe de décompression, ré-encodage, dimensions exactes), textes et liens |
| Base de données | règles d'accès de chaque table (RLS), droits sur les fonctions, droits sur les colonnes, dossier des images (privé), index |
| Performances | requêtes les plus fréquentes sur une base de **50 000 parcelles**, taille des paquets JavaScript |
| Code | variables inutilisées, avertissements du lint, requêtes SQL construites à la main, `eval`, HTML injecté |

## 2. Ce qui était déjà bon (et que je n'ai pas touché)

- **Paiements.** La signature du webhook est vérifiée sur le corps brut ; chaque événement est enregistré une seule fois (rejouable sans doublon) ; chaque effet est aussi idempotent en SQL ; l'argent reçu pour des pixels qu'on ne peut plus attribuer est **remboursé automatiquement**, avec une alerte si le remboursement échoue ; une clé Stripe « live » est **refusée** sans autorisation explicite.
- **Interrupteurs de développement** (`/api/dev/login`, `/api/dev/pay`) : impossibles en production, et impossibles avec un vrai projet Supabase ou une vraie clé Stripe.
- **Routes de l'API** : vérification de l'origine (contre les requêtes venues d'un autre site), connexion et rôle vérifiés côté serveur, limites de débit partagées par toutes les instances, comparaison **à temps constant** du secret de la tâche d'entretien, petites tailles maximales pour les rapports publics.
- **Images envoyées** : le type est lu dans le contenu (pas dans le nom), les SVG et exécutables sont refusés, les images animées aussi, les pixels sont décodés puis **ré-encodés** (plus aucun octet caché), les dimensions doivent correspondre exactement à la parcelle.
- **Base de données** : **toutes** les tables ont la sécurité par ligne ; les colonnes sensibles des profils (`suspended_reason`, `deleted_at`…) ne sont pas lisibles de l'extérieur ; les commandes et paiements ne sont lisibles que par leur propriétaire et le personnel ; le dossier d'images est **privé** et ne se lit qu'à travers le serveur, qui vérifie la modération.
- **Code** : aucun `eval`, aucun HTML injecté, aucune requête SQL construite avec une valeur venue du visiteur (les quelques requêtes à gabarit n'assemblent que des constantes). Seulement 5 variables inutilisées dans 229 fichiers.
- **Performances** sur 50 000 parcelles : les listes, la page d'une parcelle et le compteur public répondent en **4 à 40 ms** ; le plus gros paquet JavaScript fait 73 Ko compressés.

## 3. Ce qui a été corrigé

| # | Problème | Gravité | Preuve | Correction |
|---|---|---|---|---|
| 1 | **9 liens de la base sans index.** Chaque suppression d'une parcelle obligeait la base à relire toute la table (et chaque paiement relisait toutes les réservations). | Performance (réelle pour l'outil « tout supprimer » ; légère pour les paiements) | Effacer 20 000 parcelles : **53 s** avant, **2 s** après | Migration 28 + test `foreign-key-indexes` qui échoue si un lien est ajouté sans index |
| 2 | **Une fonction interne laissée ouverte** (`px_cover_free_parcels`) : un `revoke` oublié lors d'une migration ultérieure. C'est une fonction de déclenchement : on ne pouvait rien en faire à distance. | Hygiène (la règle est « fermé sauf exception ») | Requête sur le catalogue de la base : 1 fonction ouverte sur 78 | Migration 29 + test `function-grants` qui échoue si une fonction `px_*` est ouverte |
| 3 | **L'éditeur dépassait de l'écran d'un téléphone** (540 px de large pour 412 px d'écran). Corrigé en même temps que la grille. | Utilisabilité sur téléphone | Mesure avant/après, test sur téléphone | La colonne de l'éditeur peut maintenant rétrécir |
| 4 | **Un test de la carte échouait de temps en temps** (il attendait la moitié gauche d'une création, puis vérifiait la droite sans attendre). | Fiabilité des tests | 1 échec sur 222 à la dernière suite complète, 4 réussites en le rejouant | Les trois vérifications de la moitié droite attendent comme celles de la gauche |
| 5 | **Code mort et avertissements** : 5 variables inutilisées, 3 directives du lint périmées. | Propreté | `tsc --noUnusedLocals`, `eslint` | Supprimés (les explications des `<img>` volontaires sont gardées en commentaire) |
| 6 | **Outillage de développement un peu en retard** : le plugin ESLint de Next (16.4.3) n'était pas à la version de Next (16.4.6), `typescript-eslint` avait une version corrective de retard. | Propreté | `npm audit fix` | Mises à jour correctives dans le fichier de verrouillage (aucun effet sur le site en ligne), validées par tous les tests |

## 4. Ce qui reste à décider ou à savoir (rien d'urgent)

1. **La politique de sécurité du contenu (CSP) est en mode « rapport seulement ».** Elle ne bloque rien : elle signale. Il est prévu de lire les rapports (`[csp]` dans les journaux Vercel) pendant une semaine avant de la rendre obligatoire (`docs/SECURITY.md`). À faire avant l'ouverture au public, pas avant.
2. **Une alerte `npm audit` sans correctif** : `picomatch` (outil de recherche de fichiers utilisé en développement, pas par le site en ligne). Elle concerne toutes les versions publiées ; aucun correctif n'existe encore. Aucun visiteur ne peut l'atteindre. À revérifier de temps en temps (`npm audit`).
3. **Mises à jour de bibliothèques non faites, volontairement** : `stripe` (23.0 → 23.1) — la version de l'API Stripe n'est pas fixée dans le code, elle suit celle de la bibliothèque ; je préfère la fixer explicitement **avant** de mettre à jour la bibliothèque de paiement ; `@playwright/test` (le navigateur de test installé correspond à la version actuelle) ; et les versions « majeures » (TypeScript 7, Vitest 5, ESLint 10) qui demandent un chantier à part. Les mises à jour mineures sans enjeu de sécurité (`next-intl`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, Tailwind) peuvent se faire en un lot quand vous voulez.
4. **La tâche d'entretien ne tourne qu'une fois par jour** (3 h du matin, `vercel.json`) : c'est la limite du plan gratuit de Vercel. Conséquence : la prise de l'instantané à la **fin de l'édition**, la récupération d'un paiement dont le webhook se serait perdu et les remboursements à relancer peuvent attendre jusqu'à 24 h. La **règle** de fin d'édition, elle, est appliquée à la seconde par la base. Avec un plan payant on peut passer à toutes les heures.
5. **Les « j'aime » peuvent être posés directement par l'API publique de Supabase** (la règle d'accès le permet, avec le bon compte), donc sans passer par la limite de débit du site. Impact très faible : un compte ne peut aimer une parcelle qu'une fois, ses propres « j'aime » ne comptent pas, et un compte suspendu ne compte pas. À surveiller si le classement devient un enjeu.
6. **Hors périmètre de cette revue** (non vérifiable par moi) : les réglages des services externes (Supabase, Vercel, Stripe), la relecture juridique, le nom de domaine et la marque.

## 5. À faire de votre côté

Une seule chose : **appliquer les migrations 28 et 29** sur la base de Supabase (étape 14 de `docs/DEPLOIEMENT_PAS_A_PAS.md`). Deux commandes, sans effet sur les données.
