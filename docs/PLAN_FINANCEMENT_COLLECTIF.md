# Plan — « Financer à plusieurs » (parcelles collectives)

*Demande du propriétaire : « si quelqu'un veut faire une grande parcelle mais n'a pas les moyens, un bouton en plus dans le panneau d'achat ouvre le même module de dessin ; après validation des modérateurs, le projet entre dans une liste, et chacun peut participer financièrement pour que la parcelle soit publiée. En attendant, elle est réservée pour un temps défini. »*

Rien n'est codé : ce document fixe le parcours, les règles de l'argent et le découpage. Les décisions marquées **À DÉCIDER** sont au propriétaire ; tout le reste est une proposition par défaut, modifiable ensuite (les durées et montants iront dans les réglages de l'administration).

> Ne pas confondre avec **« Dessiner ensemble »** (déjà là) : celui-ci permet à plusieurs personnes de *dessiner* sur une parcelle déjà achetée ; « Financer à plusieurs » permet à plusieurs personnes de *payer* une parcelle qui n'existe pas encore.

## 1. Le parcours

**Le créateur** (compte obligatoire)
1. Dans le panneau « Réservez vos pixels », un bouton **« Financer à plusieurs »** à côté de « Créer ma parcelle ».
2. Il place sa parcelle et fait sa création dans **le même éditeur** qu'aujourd'hui (image, dessin, texte).
3. Il ajoute un **titre** et une **courte description** (pourquoi ce projet), choisit la durée de la collecte, puis **envoie à la modération**. Rien n'est payé.
4. Un modérateur regarde le projet (création + texte + emplacement) et **valide ou refuse** (avec un motif, comme pour les créations).

**Après validation**
5. La parcelle est **réservée** pour la durée choisie : plus personne ne peut acheter ces pixels (la même garantie technique que pour un achat en cours, mais plus longue).
6. Le projet apparaît dans la page **« Projets collectifs »** : aperçu de la création, titre, barre de progression (« 1 250 € sur 2 500 € »), jours restants, nombre de participants.

**Les contributeurs** (compte obligatoire, comme pour tout paiement)
7. Ils ouvrent un projet, choisissent un montant (boutons rapides + montant libre, avec un minimum) et paient avec Stripe, comme un achat normal. Ils peuvent afficher leur nom ou rester anonymes.

**La fin, dans les trois cas**
- **Objectif atteint** → la parcelle devient celle du créateur (active, avec la création validée). La fiche indique « Financée par N personnes » (et les noms de ceux qui le veulent).
- **Échéance sans objectif** → **tout le monde est remboursé automatiquement**, la parcelle est libérée.
- **Le créateur annule**, ou un modérateur retire le projet → remboursement de tous, parcelle libérée.

## 2. L'argent : ce qu'on réutilise, ce qui est nouveau

Réutilisé tel quel (déjà écrit, déjà testé) : prix calculé par le serveur, garantie « deux parcelles ne se chevauchent jamais » (contrainte PostgreSQL), paiement confirmé **uniquement** par le webhook Stripe vérifié, événements idempotents, remboursements automatiques et leur reprise par la tâche planifiée, gestion des litiges.

Nouveau, et c'est là que se trouvent les vrais risques :
- **Ne jamais dépasser l'objectif.** Si deux personnes paient en même temps le « dernier euro », la base de données verrouille le projet : chaque paiement en cours *réserve* sa part du reste à payer pendant 30 minutes (comme les pixels réservés pendant un achat). Un paiement arrivé trop tard est remboursé automatiquement.
- **Le prix est figé à la validation** : si le tarif change plus tard, l'objectif d'un projet ouvert ne bouge pas.
- **Devise du projet** : celle du créateur (euro en zone euro, dollar ailleurs) ; tous les participants paient dans cette devise.
- **Les remboursements coûtent** : Stripe ne rend en général pas ses frais de traitement quand on rembourse. Un projet qui échoue avec beaucoup de petits paiements coûte donc de l'argent à la plateforme → d'où un **montant minimum** par participation (à vérifier avec votre contrat Stripe).
- **Abus à prévoir** : un projet « fantôme » énorme qui bloque une zone de la carte sans jamais être financé (→ modération avant réservation, un seul projet actif par créateur, taille minimale, durée limitée) ; un créateur qui se « finance » avec une carte volée (→ les litiges existants marquent le projet pour examen).

## 3. Données (proposition)

- **`campaigns`** : le projet. Créateur, parcelle réservée, titre, description, création validée, devise, objectif (en centimes, figé), échéance, statut (`pending` en modération · `open` en collecte · `funded` · `expired` · `cancelled` · `rejected`), dates et motif de modération.
- **`contributions`** : une participation. Projet, contributeur, montant, statut (`pending` · `paid` · `refunded` · `failed` · `refund_required`), identifiants Stripe, nom affiché ou anonyme, fin de la réservation de sa part.
- Réglages (administration) : durées proposées, participation minimale, taille minimale d'un projet collectif, apport du créateur s'il est exigé.
- La parcelle réservée utilise la table `parcels` existante avec `status = 'reserved'` : la contrainte anti-chevauchement fonctionne sans rien changer.

## 4. Découpage en étapes (chacune testée et poussée)

| Étape | Contenu | Paiement réel nécessaire ? |
|---|---|---|
| 1 | Base de données, création du projet (bouton + éditeur + titre/description/durée), file d'attente de modération côté administration | Non |
| 2 | Page « Projets collectifs » + fiche projet + participation (mode Stripe simulé, comme pour les achats actuels) + attribution de la parcelle à l'objectif atteint | Non (simulé) |
| 3 | Échéance, annulation, remboursements automatiques (tâche planifiée), alertes aux participants | Non (simulé) |
| 4 | Affichage sur la carte : parcelles « en financement » (motif hachuré + progression), mention « financée par » sur la fiche | Non |
| 5 | Essai réel en mode test Stripe des paiements et remboursements | **Oui, quand Stripe sera possible** |

Le paiement réel reste désactivé tant que vous n'avez pas donné votre accord (règle du projet).

## 5. À valider par un juriste avant tout lancement réel

Je ne fixe aucune règle juridique ou fiscale. Points à faire examiner : la **détention temporaire de l'argent des participants** (et si un statut ou un agrément est requis dans votre pays), le **droit de rétractation** et la politique de remboursement à écrire dans les conditions d'utilisation, la TVA sur chaque participation, la communication « votre argent est remboursé si l'objectif n'est pas atteint ».

## 6. Décisions du propriétaire (prises)

| # | Question | Décision |
|---|---|---|
| 1 | Durée de la collecte | **Au choix du créateur : 7, 14 ou 30 jours** (modifiable dans l'administration) |
| 2 | Contrepartie d'un participant | **Rien : participation anonyme.** Seul le *nombre* de participants est affiché ; aucun nom, aucun badge |
| 3 | Participation minimale | **2 €** (et 2 $ en dollar), modifiable dans l'administration |
| 4 | Limites du créateur | **Un seul projet actif à la fois, aucun apport obligatoire** ; la modération filtre avant toute réservation |

Conséquences : pas de nom de participant à stocker côté public (la table `contributions` garde le contributeur pour les remboursements et la comptabilité, mais **rien n'en est exposé** : ni l'API publique, ni la fiche) ; pas de lien avec le badge du Registre ; pas d'apport du créateur à gérer.

Autres valeurs par défaut (non discutées, modifiables) : taille minimale d'un projet 10 000 px (2 500 €) ; réservation de la part d'un paiement en cours : 30 minutes ; modération avant toute réservation.

## 7. État d'avancement

*(mis à jour à chaque étape)* — étape 1 : à faire.
