# Plan de refonte — « Pixel World, l'archive collective de notre époque »

*Demande du propriétaire : transformer Pixel World en archive collective pour les générations futures (« Dans 100 ans, que restera-t-il de nous ? »), supprimer entièrement le thème apocalyptique du Protocole ZÉRO, garder tous les mécanismes existants, prix du pixel à 0,25 €, nouvelle direction artistique violet nuit / or / cyan.*

**Statut : PLAN SEULEMENT.** Aucune ligne de code n'a été modifiée. Ce document est l'audit (phase A) et la proposition (phase B). La maquette de l'accueil (phase C) et le développement (phase D) ne commencent qu'après l'accord du propriétaire.

Les points marqués **DÉCISION** sont au propriétaire ; chacun a une recommandation par défaut, modifiable.

---

## 0. En dix lignes

1. Presque tout ce qui fait marcher Pixel World est **conservé** : carte, grille, parcelles rectangulaires, achat, éditeur, import d'image, dessin collectif, comptes, paiements, règles terre/océan, modération, classement, recherche.
2. Le **récit** change (textes, vocabulaire, page d'accueil, images de partage) : c'est surtout du texte et de la présentation.
3. Le **thème Protocole ZÉRO** (personnage à capuche, destruction, compte à rebours de fin du monde, carte corrompue, bande défilante, BD de 8 images) est **supprimé** : environ 850 lignes de code + 116 lignes dans le moteur de la carte + 10 fichiers de tests + 8 images.
4. Le **compte à rebours de 100 jours** reste, mais devient la durée d'une **édition** (« l'édition fondatrice »), pilotée par l'administration et **appliquée par la base de données**, pas par le navigateur ni par une variable de configuration.
5. **Constat important de l'audit** : aujourd'hui la fermeture des ventes n'est vérifiée que dans le code du site (une variable `NEXT_PUBLIC_WORLD_END_AT`), pas dans la base de données, et rien ne gèle les créations après la fin. C'est le chantier technique n° 1.
6. Les **100 jours ne démarrent jamais tout seuls** : l'édition naît en « pré-lancement » sans aucune date ; seul un administrateur, par une action confirmée et journalisée, l'ouvre.
7. **Prix** : la valeur par défaut est déjà 0,25 € dans le code. Il reste à **vérifier la valeur réelle dans la base du site de test** et à ajouter des tests qui figent la table 25 px = 6,25 € … 400 px = 100 €.
8. **Nouvelles données** modestes : une table `editions`, et sur chaque création : catégorie, lieu associé (facultatif), date d'archivage. Rien de destructif, les données existantes sont conservées.
9. **Nouvelle direction artistique** : thème sombre pour tout le côté public, l'administration reste claire (moins de risque, aucun intérêt à la repeindre). Pixelisation modérée, continuité avec les boutons « escalier » actuels.
10. **Ordre proposé** : prix → éditions en base → métadonnées d'archive → palette → accueil (après maquette) → suppression du Protocole ZÉRO → textes et juridique → export de conservation → badges (étude seulement).

---

# PHASE A — AUDIT

## A1. À garder tel quel (aucune modification)

| Élément | Où | Remarque |
|---|---|---|
| Grille 40 000 × 25 000, projection, tuiles géographiques | `src/components/map/engine.ts`, `src/lib/grid/*` | le cœur, intact |
| Sélection rectangulaire, taille minimale 25 px, chevauchements impossibles | contraintes PostgreSQL (exclusion), migration 12 | intact |
| Règles terre / océan / eau (pourcentages, prix de la mer coupée) | migrations 6 et 15, `src/lib/grid/pricing.ts` | « aucune nouvelle règle » : intact |
| Achat, réservation 35 min, paiement Stripe (mode simulé), webhook vérifié, remboursements, litiges | `src/app/api/checkout`, `px_*`, `docs/PAYMENTS.md` | intact |
| Éditeur intégré (image, dessin au 1/10 de pixel, texte), import d'image | `src/components/editor/*` | intact |
| Dessin collectif (« Dessiner ensemble », lien `/draw/jeton`) | migration 9–11 | c'est exactement « inviter d'autres à co-créer » ; seul le texte change |
| Comptes, profils, authentification, suppression de compte | Supabase Auth, `profiles` | intact |
| Modération (file d'attente, motifs, signalements, journal d'audit) | pages admin, `audit_logs` | intact, s'étend aux nouveaux champs |
| Recherche de lieux (communes, villages) | `SearchBox.tsx` | intact, **réutilisée** pour « lieu associé » |
| Commentaires, « j'aime », classement | `Comments.tsx`, `parcel_likes`, `/ranking` | gardés (voir DÉCISION 7 pour après la clôture) |
| Versions de création avec empreinte sha256 | `parcel_assets.content_hash` | **base de la conservation** : déjà là |
| Sauvegardes documentées | `docs/BACKUP_RESTORE.md` | à compléter, pas à refaire |
| Pages légales provisoires, `rules`, `privacy`, `credits` | `src/app/[locale]/*` | à réécrire dans le ton, **pas de fond juridique modifié sans juriste** |

## A2. À adapter au nouveau récit (texte et présentation, pas de logique)

| Élément | Aujourd'hui | Devient |
|---|---|---|
| Slogan `meta.tagline` | « Une planète. Un milliard de pixels. Votre empreinte. » | « Dans 100 ans, que restera-t-il de nous ? » |
| `meta.description`, `map.pitch`, `footer.tagline` | « planisphère collaboratif… réservez un morceau de la planète » | archive collective, laisser une trace |
| Statistiques `stats.*` | « Pixels acquis », « Part de la planète acquise », « Propriétaires » | « Pixels archivés », « Part de la carte archivée », « Contributeurs » (à valider) |
| Panneau d'achat `buy.*` | « Réservez vos pixels », « Que voulez-vous acquérir ? », « Terre/Eau » | « Laisser ma trace », « Que voulez-vous archiver ? » ; **le prix reste affiché clairement** |
| Inscription `auth.sign-up.lead` | « réservez votre morceau de planète » | « laissez votre trace » |
| Pages légales | « emplacement virtuel… aucun droit de propriété » (déjà juste) | on **ajoute** : droit d'usage numérique, pas de garantie de conservation éternelle, édition gelée, retrait légitime |
| Terme « propriétaire » (parcelle) | partout (`admin.*`, fiches) | « auteur » côté public ; le mot reste côté technique/admin |
| Bouton « Financer à plusieurs » et page « Projets collectifs » | déjà construits, testés | conservés mais **non mis en avant** (le brief les range en « plus tard ») — **DÉCISION 2** |
| Image de partage `/api/og/home` | états du Protocole ZÉRO | états de l'édition (pré-lancement / ouverte / clôturée / archive), nouveau style |

## A3. Composants visuels à modifier

L'interface est aujourd'hui **claire uniquement** (« Light only, by design », `docs/DESIGN.md`).

| Composant | Fichier | Travail |
|---|---|---|
| Jetons de couleur (`paper`, `ink`, `signal`, `sky`, `glitch-*`…) | `src/app/globals.css` (`@theme`) | **ajouter** des jetons du nouveau thème (`night`, `night-2`, `gold`, `cyan`, `ivory`) ; supprimer `glitch-*` à la fin |
| Boutons pixel « escalier » (`.btn`, variantes) | `globals.css` | **conservés** : ils sont construits avec des variables (`--edge`, `--face`, `--hl`…), donc seule la teinte change (continuité forte avec l'existant) |
| Moteur de la carte (océan, terre, papier, encre, parcelle libre) | `engine.ts` (`COLORS`, 7 constantes) + quelques couleurs écrites en dur | recolorer : océan violet très sombre, terre violet secondaire, contours or, parcelles actives/sélection cyan. Les tuiles sont dessinées par le moteur à partir des données vectorielles : **pas d'images à refaire** |
| Parcelles d'eau en teintes de bleu (règle existante) | engine + `src/lib/*` (teintes) | on **garde la règle** ; on vérifie qu'elle reste lisible sur fond violet (teinte vers le cyan) |
| En-tête, pied de page, panneaux, cartes, fiches, formulaires | `SiteHeader.tsx`, `Hud.tsx`, `ParcelCard.tsx`, `Footer`… | passent au thème sombre par les jetons |
| Pages de contenu (règles, conditions, confidentialité, crédits, compte, projets, classement) | `src/app/[locale]/*` | thème sombre ; lisibilité du texte long à tester (ivoire sur nuit) |
| Administration | `src/app/[locale]/admin/*` | **reste claire** (non publique) — DÉCISION 11 |
| Logo et icônes | `Logo.tsx`, `icon.svg`… | globe pixel à revoir dans la palette (or + cyan sur violet) ; fichiers regénérés par `scripts/build-icons.mjs` |
| Image de partage, icônes de manifeste, `themeColor` | `layout.tsx`, `/api/og/*` | `themeColor` passe à `#190921` |
| `docs/DESIGN.md`, page `/dev/design` | docs | réécrits pour la nouvelle palette |

**Contrastes calculés (WCAG)** pour la palette du brief :

| Texte / fond | Rapport | Verdict |
|---|---|---|
| ivoire `#F1E8DF` sur nuit `#190921` | 15,7 : 1 | excellent (texte courant) |
| or `#D6AB72` sur nuit | 9,0 : 1 | très bon |
| cyan `#55C7D1` sur nuit | 9,5 : 1 | très bon |
| ivoire sur violet `#382050` | 11,6 : 1 | très bon |
| or sur violet `#382050` | 6,7 : 1 | bon |
| cyan sur violet `#382050` | 7,0 : 1 | bon |
| nuit sur cyan (texte d'un bouton cyan) | 9,5 : 1 | très bon |
| violet `#382050` sur nuit | 1,4 : 1 | **décoratif seulement** (bordures, fonds), jamais du texte |

Les tests d'accessibilité automatiques (axe) du projet seront relancés après chaque étape de repeinte.

**Dette de couleurs en dur** : environ 25 couleurs hexadécimales écrites directement dans `src/` en dehors des jetons (`#ffffff` ×10, `#0b7a5a` ×10, `#f04316` ×8…). Elles seront repérées une à une et ramenées aux jetons.

## A4. Nouvelles données nécessaires

Tout est **additif** : nouvelles tables et colonnes facultatives, aucune donnée existante modifiée ni supprimée.

### Table `editions` (nouvelle)

| Colonne | Rôle |
|---|---|
| `id`, `slug`, `name` | identité (« Édition fondatrice ») |
| `status` | `prelaunch` (pré-lancement) · `open` (ouverte) · `closed` (clôturée) |
| `duration_days` | 100 par défaut |
| `opens_at`, `closes_at` | **vides** tant que l'édition n'a pas été ouverte par un administrateur |
| `closed_at` | date réelle de la clôture enregistrée |
| `snapshot_hash`, `snapshot_taken_at`, `snapshot_count` | empreinte du cliché historique gelé à la clôture |
| `created_at`, `created_by` | traçabilité |

Garde-fous : un seul état « ouverte » à la fois ; **aucune création automatique d'édition** (une seule ligne, l'édition fondatrice, créée par la migration) ; tout changement d'état passe par une fonction SQL réservée aux administrateurs et inscrite au journal d'audit (append-only, déjà existant).

### Colonnes ajoutées à `parcels`

- `edition_id` (rattache chaque parcelle à une édition ; rempli pour l'existant avec l'édition fondatrice → permet de **préparer** les futures éditions sans en créer).

### Colonnes ajoutées à `parcel_assets` (une création, par version)

| Colonne | Contenu | Remarque |
|---|---|---|
| `category` | une valeur d'une liste fermée | liste proposée en A4 bis |
| `place_label` (≤ 80), `place_country` | lieu associé, **distinct** de la position sur la carte | facultatif ; choisi via la recherche de lieux existante |
| `place_lat`, `place_lng` | coordonnées **arrondies à ~1 km** | facultatif ; jamais plus précis (données personnelles) |
| *(déjà là)* `title` (80), `description` (280), `link_url`, `is_commercial` | titre, description | rien à créer : le titre est déjà obligatoire à l'achat |

- **Auteur** : le pseudonyme du compte (`profiles.username`) est déjà public. Recommandation : **une seule identité** (le pseudo du compte) ; un pseudonyme propre à chaque archive est une option ultérieure.
- **Date d'archivage automatique** : recommandation = **date du paiement confirmé** (`parcels.activated_at`, déjà existante), figée, indépendante de la date de validation par la modération. Aucune colonne à ajouter pour elle.

### A4 bis. Liste de catégories proposée (modifiable)

Arts et culture · Vie quotidienne · Famille et souvenirs · Nature et climat · Science et technologie · Sport · Cuisine et traditions · Hommage et mémoire · Humour et internet · Message aux générations futures · Autre.

### Badges « Premiers Gardiens » (étude seulement, **aucune migration maintenant**)

Modèle prévu : `badges` (type, libellé, édition) et `badge_awards` (parcelle/utilisateur, badge, état `candidat` / `attribué` / `refusé`, décideur, date, note). **L'attribution ne se fait jamais automatiquement** : l'unicité d'un sujet (« la Pizza ») est un jugement humain ; l'outil peut seulement *proposer* des candidats (même catégorie + titres proches) à un modérateur, qui valide. Règles reprises du plan abandonné (`PLAN_REGISTRE_DE_L_HUMANITE.md`) : date de revendication = la plus tardive entre « création envoyée » et « parcelle payée », élément figé une fois validé, fusion manuelle des doublons, marques refusées par défaut. Les champs `category` et la date d'archivage suffisent à préparer cela sans rien développer.

## A5. Problèmes techniques et de sécurité relevés

| # | Constat | Gravité | Réponse prévue |
|---|---|---|---|
| 1 | **La fermeture n'existe que dans le code du site** (`salesClosedByStory`, variable `NEXT_PUBLIC_WORLD_END_AT`), dans `/api/checkout`, `/api/campaigns`, `/api/campaigns/[id]/contribute`, `/api/map/projects`, `getPricing`. La base ne connaît que `sales_open`. Quiconque appelle la base autrement (ou un oubli sur une nouvelle route) contourne la fermeture | **haute** | l'état de l'édition vit en base ; **chaque** fonction `px_*` qui achète, réserve ou modifie une création appelle `px_assert_edition_open()` |
| 2 | **Rien ne gèle les créations à la fin** : `POST /api/parcels/[code]/creation`, `/collab`, le dessin collectif restent actifs | **haute** | gel en base (nouvelles versions, modification des textes, dessin collectif, remise à zéro) ; les routes répondent « édition archivée » |
| 3 | La variable `NEXT_PUBLIC_*` est **visible dans le navigateur** et fixée au déploiement : changer une date = redéployer ; une erreur de config pourrait **démarrer les 100 jours** | haute vis-à-vis de la consigne | variable **supprimée** ; la date vit en base, modifiable seulement par l'administration |
| 4 | Le compteur est calculé avec l'heure de l'appareil | moyenne | le serveur envoie `closes_at` **et** son heure ; le navigateur n'affiche que cela (aucune décision côté client) |
| 5 | La clôture dépendrait de la tâche planifiée si on la codait naïvement | haute | l'**état effectif** est calculé à la lecture : `now() ≥ closes_at` ⇒ fermé, même si la tâche n'a pas tourné. La tâche ne fait qu'enregistrer l'état et prendre le cliché (idempotent, rejouable) |
| 6 | Paiements déjà lancés au moment de la clôture, projets collectifs encore en collecte | moyenne | règle explicite en B4 (DÉCISIONS 4 et 5) |
| 7 | Retrait légitime après clôture (droit d'auteur, données personnelles) | moyenne | la modération garde son pouvoir de retrait après la clôture ; l'archive est **versionnée** : un retrait produit une nouvelle révision du cliché avec une « pierre tombale », il ne réécrit jamais l'ancienne |
| 8 | Suppression de compte vs. archive (droit à l'effacement) | moyenne (juridique) | comportement actuel conservé (création retirée de l'affichage public) ; **à faire valider par un juriste** |
| 9 | Migrations : l'édition fondatrice naîtrait « pré-lancement », donc les tests d'achat existants (base et e2e) fermeraient | basse | les outils de test ouvrent l'édition au départ ; sur le site de test, un clic dans l'administration |
| 10 | Performance de la carte | basse | aucun ajout de calcul par parcelle ; le thème retire des branches (tout le code « corruption/finale/glitch »). Les petites particules lumineuses sont **facultatives**, plafonnées, coupées en mode « machine lente » et si `prefers-reduced-motion` |
| 11 | Messages d'erreur `px_world_ended` | basse | remplacés par `px_edition_not_open` (pré-lancement) et `px_edition_closed` (clôture), traduits |

Les règles RLS, l'autorisation côté serveur et le principe « rien n'est accordé aux rôles du navigateur » (tout passe par des fonctions réservées au serveur) restent **identiques** pour les nouvelles tables.

## A6. Éléments du Protocole ZÉRO à retirer

| Catégorie | Éléments |
|---|---|
| **Code React** | `src/components/doom/` (Comic, Doom, finaleStore, useDoom) |
| **Logique** | `src/lib/doom/` (clock, comic, corruption, finale, glitch, preview, sales) — `clock.ts` (formatage du décompte) est **réutilisé** dans un module `edition` |
| **Moteur de la carte** | ~116 lignes d'états « histoire » : corruption des terres, finale, glitch, balayage, secousse, frange magenta/cyan |
| **Interface** | plaque du compte à rebours « destruction », bande défilante (ticker), `?preview=J-9` (remplacé par un aperçu **réservé à l'administration**, pour tester les états sans changer la base), pastilles de la carte |
| **Images et sources** | `public/story/panel-1..8.webp` (≈ 0,9 Mo), `assets/story-source/*.jpg` (≈ 1,9 Mo), `scripts/build-story.mts` |
| **Textes** | `comic.*`, `doom.*` (FR et EN), mentions « monde supprimé », « sauvez le monde », « sauver ma parcelle » |
| **Style** | jetons `--color-glitch-*`, rayures de danger, section « Glitch » de `docs/DESIGN.md` |
| **Configuration** | `NEXT_PUBLIC_WORLD_END_AT`, `NEXT_PUBLIC_STORY_PREVIEW` (`.env.example`, `config-check.ts`, guides de déploiement) |
| **Partage** | états de l'image `/api/og/home` (ordinaire / compte à rebours / fin) |
| **Tests** | e2e : `comic`, `doom`, `map-doom`, `map-water` (parties « détruit »), `mobile` (mesures de la plaque), `share` ; unitaires : `comic`, `doom-clock`, `doom-corruption`, `doom-finale`, `doom-glitch`, `doom-preview`, `doom-sales`, `config-check` (parties story) → supprimés ou réécrits pour les éditions |
| **Docs** | `ARCHITECTURE.md`, `DEPLOIEMENT_PAS_A_PAS.md`, `NEXT_STEPS.md`, `DESIGN.md` |

Méthode : la suppression se fait **après** que les éditions et le nouvel accueil fonctionnent, dans un commit dédié, avec la suite de tests complète. L'historique Git garde de toute façon l'ancien code.

## A7. Où vérifier que le pixel vaut 0,25 €

| # | Endroit | État constaté | Action |
|---|---|---|---|
| 1 | `src/lib/grid/constants.ts` : `DEFAULT_UNIT_PRICE_CENTS` | **25** | OK |
| 2 | Base : `app_settings.price_unit_cents` et `price_unit_cents_usd` | la migration 16 passe 50 → 25 **seulement si la valeur est encore 50** ; une valeur saisie à la main est laissée | **à vérifier sur le site de test** (`/admin/settings`) ; si ≠ 25, la corriger là |
| 3 | `src/lib/grid/pricing.ts` : calcul et `DEFAULT_PRICING` (valeurs de repli quand la base ne répond pas) | utilise la constante | test unitaire de la table ci-dessous |
| 4 | Fonction SQL de devis utilisée par `px_start_order` | le **serveur** calcule, le navigateur n'envoie jamais de prix | test base de la table ci-dessous |
| 5 | Panneau d'achat, récapitulatif, page de paiement, ligne Stripe de `/api/checkout` (et mode simulé) | affichent/envoient le montant calculé côté serveur | test e2e sur le panneau |
| 6 | Réglages d'administration (`SettingsForm.tsx`) | libellés en centimes | vérifier l'affichage « 25 » |
| 7 | Textes commerciaux : conditions (FR « 0,25 € … 0,25 $ »), pitch, pied de page, image de partage, `PAYMENTS.md` | conditions OK | repasser sur tous les textes lors de la refonte |
| 8 | Surface minimale 25 px (migration 12, `MIN_AREA = 25`) | OK | nécessaire pour « 25 px = 6,25 € » |
| 9 | Règles eau/mer (pourcentages) | s'appliquent **par-dessus** le prix de base | la table du brief vaut pour une parcelle de terre pleine ; vérifier que `water_price_percent` vaut bien 100 % |
| 10 | Dollar hors zone euro | 0,25 $ (décision antérieure) | **DÉCISION 3** : le brief dit « 0,25 € partout » → confirmer que les acheteurs hors zone euro paient bien 0,25 $ |

**Table de référence à figer dans les tests** (parcelle de terre pleine) : 25 px = 6,25 € · 50 px = 12,50 € · 100 px = 25 € · 200 px = 50 € · 400 px = 100 €. Le prix affiché ne sera jamais la seule chose changée : le test couvre le devis serveur, la commande créée en base et le montant envoyé au paiement.

---

# PHASE B — PROPOSITION

## B1. Résumé de l'expérience

1. **Choisir une parcelle** sur la carte (rectangle, comme aujourd'hui).
2. **Créer son archive** : titre, description courte, catégorie, pseudonyme (celui du compte), date d'archivage automatique, lieu associé facultatif — puis l'éditeur existant (image, dessin, texte). Formulaires courts, en une seule étape visible sur téléphone.
3. **Payer** (le prix est visible et clair : « 25 px · 6,25 € »).
4. **Publier** : après modération, une **page d'archive** montre la création, le titre, la description, l'auteur, la date d'archivage, le lieu, l'édition, et un bouton de partage. Message : *« Votre trace fait désormais partie de l'archive collective de notre époque. »*
5. **Transmettre** : inviter d'autres personnes à co-créer (dessin collectif existant) ; partager la page.

**Page d'archive** : on propose de faire de `/p/[code]` (adresse permanente déjà partagée) une vraie page lisible et indexable, avec un bouton « Voir sur la carte » qui ouvre la carte à cet endroit. L'adresse ne change pas, aucun lien existant ne casse. L'image de partage `/api/og/parcel/[code]` existe déjà et sera passée au nouveau style.

## B2. Organisation de la nouvelle page d'accueil

Contenu demandé : titre « Dans 100 ans, que restera-t-il de nous ? » · sous-titre · boutons **Laisser ma trace** (principal) / **Explorer les archives** (secondaire) · grand planisphère · 3 étapes · créations récentes · section temps · aucune fausse statistique ni fausse création.

**Contrainte technique à connaître** : aujourd'hui l'accueil **est** la carte plein écran, et la molette/le doigt servent à zoomer et déplacer la carte. Ajouter des sections sous la carte crée un conflit de défilement (surtout au doigt).

| | Variante 1 — « La carte d'abord » | Variante 2 — « Accueil puis carte » (recommandée) |
|---|---|---|
| Principe | la page reste la carte plein écran, avec un panneau d'accueil par-dessus | un vrai accueil : le planisphère en grand (la vraie carte, animée doucement, non interactive) sous le titre, puis les sections |
| Bouton « Explorer les archives » | referme le panneau | ouvre la carte interactive (`/map`, adresse existante) |
| Sections 3 étapes, créations récentes, temps | impossibles sans conflit de défilement ; on les met dans des feuillets du panneau | défilement normal de la page |
| Mobile | bon | bon (aucun conflit : la carte n'est interactive que dans `/map`) |
| Risque | texte trop dense dans un panneau | une seule instance du moteur ; mode « ambiant » à ajouter |

La phase C produira **les deux** à partir des composants existants pour que le propriétaire juge sur pièces.

**Contenu de l'accueil (version 2)**
1. En-tête (logo, langue, compte) · héros : titre, sous-titre, deux boutons, planisphère.
2. **3 étapes** : *Choisissez une parcelle* · *Archivez ce qui compte* · *Transmettez*.
3. **Créations archivées récemment** : uniquement les **vraies créations validées par la modération** (la requête `latestCreations` existe déjà) ; si aucune, la section n'apparaît pas — jamais de faux contenu.
4. **Une époque. 100 jours pour la raconter.** — le compteur de l'édition (voir états B4) et « À la clôture, l'édition deviendra une archive historique consultable. »
5. Pied de page : règles, conditions, confidentialité, crédits, projets collectifs.

Le texte d'introduction du brief sert de **base narrative**, pas de bloc à afficher en entier : une version courte alimente la page « En savoir plus » (qui remplace l'ancienne BD).

## B3. Adaptation graphique

- **Palette** : nuit `#190921` (dominante, fonds) · violet `#382050` (surfaces secondaires) · or `#D6AB72` (temps, héritage : compteur, date d'archivage, badges) · cyan `#55C7D1` (interactions, parcelles actives, sélection) · ivoire `#F1E8DF` (texte).
- **Pixelisation modérée** : boutons « escalier » conservés (teintes changées), bordures en pas de 2 px, icônes pixel, police pixel (Jersey 10) réservée aux chiffres, dates et petits titres ; les créations gardent leur finesse (aucun filtre dessus).
- **Carte** : **océans bleu nuit** (décision du propriétaire : « les océans gardent une teinte bleutée » — base `#0d1a3e`, lueur le long des côtes `#183468`), terres en violet `#382050`, côtes fines or, parcelles cyan au survol/sélection ; parcelles d'eau en teintes de bleu (règle existante, à garder bien visible sur ce fond bleu). Seule la carte est bleutée : les fonds de pages, panneaux et en-tête restent en violet nuit `#190921`.
- **Ambiance** : lueurs douces, quelques particules très discrètes (facultatif, voir A5 n°10) ; **rien** de flamme, d'explosion, d'écran d'alerte, de destruction ni d'effet d'apocalypse.
- **Lisibilité d'abord** : texte courant ivoire sur nuit (15,7 : 1) ; pas d'interface « futuriste illisible » ; le bruit visuel de l'ancien thème (rayures, franges magenta) disparaît.
- Mobile et ordinateur testés à chaque étape (les mesures d'en-tête à 320–412 px sont conservées et adaptées).

## B4. Éditions temporelles

**États** : *pré-lancement* → *ouverte* → *clôturée* ; puis l'édition clôturée est *consultable comme archive* (même état technique, présentation différente).

| État | Achats | Créations | Carte | Compteur affiché |
|---|---|---|---|---|
| Pré-lancement | fermés | non modifiables | consultable | « Ouverture prochainement » (aucune date, aucun décompte) |
| Ouverte | ouverts | modifiables par leurs auteurs | consultable | « J-xx : 100 jours pour raconter notre monde. » |
| Clôturée / archive | **fermés** | **gelées** | consultable | « Édition close le … — archive consultable » |

**Ouverture** (jamais automatique) : page d'administration « Édition » → bouton « Ouvrir l'édition » → confirmation en tapant le nom de l'édition → la base enregistre `opens_at = maintenant` et `closes_at = opens_at + 100 jours`, et écrit dans le journal d'audit. **Aucun déploiement, aucune variable d'environnement, aucun test ne peut démarrer les 100 jours.**

**Clôture technique fiable** (jamais le navigateur) :
1. L'état « fermé » est **calculé par la base** à chaque appel : `now() ≥ closes_at`. Même si la tâche planifiée est en panne, plus rien ne peut s'acheter ni se modifier.
2. La tâche planifiée (déjà existante, `/api/cron/maintenance`) **enregistre** l'état « clôturée », prend le **cliché historique** (liste figée des parcelles avec leur création approuvée, leur empreinte sha256, titre, description, catégorie, lieu, date d'archivage) et en enregistre l'empreinte. Opération idempotente, rejouable.
3. Une clôture manuelle (« Clôturer maintenant ») existe pour l'administration, avec la même confirmation et le même journal.
4. Date de clôture modifiable après ouverture : **prolongation seulement**, jamais de raccourcissement, journalisée (DÉCISION 15).

**À la clôture** : achats fermés ; créations gelées dans le cliché ; carte consultable ; les participants ne peuvent plus modifier une création archivée (nouvelles versions, textes, dessin collectif, remise à zéro : tous refusés par la base) ; la modération conserve le pouvoir de **retirer** (juridique), ce qui produit une nouvelle révision du cliché avec trace du retrait.

**Cas limites (à décider)**
- *Paiement déjà lancé à la clôture* : recommandation = **délai de grâce égal à la réservation (35 min)** pour les commandes commencées avant la clôture ; au-delà, remboursement automatique (mécanisme existant). **DÉCISION 4**
- *Projets collectifs encore en collecte* : à la clôture, ils sont **expirés et tous les participants remboursés** automatiquement (mécanisme existant), car une contribution est un achat. **DÉCISION 5**
- *Avant lancement* : achats fermés, carte consultable. Sur le site de test, l'administrateur ouvre l'édition en un clic. **DÉCISION 6**
- *Éditions futures* : le modèle les permet (`edition_id`), mais **aucune n'est créée** ; une seconde édition demandera une décision explicite et un développement dédié.

## B5. Badges « Premiers Gardiens » (conception seulement)

Voir A4 : tables prévues, attribution **toujours humaine**, jamais déduite d'un titre. Rien n'est développé dans cette refonte hormis les champs qui rendront l'attribution possible (catégorie, date d'archivage, modération). Le visuel du badge circulaire (maquette déjà faite) sera réutilisé plus tard, en or sur violet.

## B6. Monétisation et formulation

- **Paiement unique, 0,25 € le pixel partout**, aucun abonnement, aucun service payant nouveau.
- Présentation : *« une contribution à une œuvre collaborative, avec un droit d'usage numérique »* — ni propriété, ni garantie de conservation éternelle. Les textes actuels (« emplacement virtuel, aucun droit de propriété ») vont déjà dans ce sens ; on ajoute la mention de la clôture de l'édition et du retrait légitime.
- **Attention à la transparence** : on peut parler de « contribution » dans le récit, mais le bouton de paiement et le récapitulatif restent explicites (« Payer 6,25 € »), pour ne pas tromper un consommateur sur le caractère d'un achat (droit de rétractation, remboursement) — **à faire valider par un juriste** avec le reste des conditions.
- **Plus tard, pas maintenant** : certificats, parcelles collaboratives, offres associations/entreprises, grandes créations collectives (les projets collectifs déjà construits restent en place sans être promus).

## B7. Conservation

| Besoin | Proposition | Coût |
|---|---|---|
| Versions | déjà là : `parcel_assets` garde chaque version avec son sha256 ; fichiers **immuables** (`<parcelle>/<horodatage>-<empreinte>.png`) | nul |
| Cliché figé à la clôture | manifeste JSON (une ligne par parcelle) + empreinte du manifeste enregistrée dans `editions` | nul |
| **Export de l'archive** | une archive ZIP : `creations/*.png` + `manifest.json` + `manifest.csv` + `README` + `SHA256SUMS` + version des conditions ; **formats ouverts**, lisibles sans notre logiciel | un script, pas de service |
| **Vérification d'intégrité** | script qui recalcule le sha256 de chaque fichier et le compare à la base et au manifeste | un script |
| Sauvegarde indépendante | déjà documentée (`BACKUP_RESTORE.md` : dump hebdomadaire + copie nocturne du seau chez un second fournisseur) ; ajouter : le **cliché de clôture** copié dans un second endroit, en écriture seule si le fournisseur le permet | à chiffrer (les images sont petites : stockage négligeable) |
| Procédure de restauration | à ajouter à `BACKUP_RESTORE.md` : restaurer l'export dans une base vide, relancer la vérification | exercice annuel |
| Retraits légitimes | nouvelle **révision** du cliché + liste des retraits ; l'ancien cliché n'est jamais réécrit | nul |

Pas de stockage complexe ni coûteux sans analyse préalable : le volume réel (des PNG de quelques dizaines de ko) reste très petit. On ne promet **pas** « éternel » dans les textes : on promet une conservation « aussi longue que possible » avec une procédure de transmission documentée (formulation à valider par un juriste).

## B8. Ordre de développement recommandé

Chaque étape est testée (unitaire, base, e2e), poussée et présentée avant la suivante.

| # | Étape | Taille | Dépend de |
|---|---|---|---|
| D0 | *(propriétaire)* appliquer les migrations 17–18 sur le site de test ; lire le prix réel dans `/admin/settings` ; changer la clé secrète et le mot de passe de la base montrés en capture | petite | — |
| D1 | **Prix** : tests qui figent 25 px = 6,25 € … 400 px = 100 € (devis, commande, montant de paiement, panneau) ; correction si un écart apparaît | petite | — |
| D2 | **Éditions en base** (migration 19) : table, états, fonctions SQL réservées à l'admin, garde dans toutes les fonctions d'achat/modification, gel des créations, `/api/edition`, page d'administration « Édition », tâche de clôture et cliché ; remplacement de la variable d'environnement ; tests dont la **course** « clôture pendant un achat » | grande | D0 |
| D3 | **Archive** (migration 20) : catégorie, lieu associé ; formulaire court dans l'achat et l'éditeur ; page d'archive `/p/[code]` ; message de confirmation ; champs dans la modération ; image de partage de la parcelle | grande | D2 |
| D4 | **Direction artistique** : jetons, boutons, moteur de la carte, en-tête/pied/panneaux/fiches, pages de contenu, logo ; administration laissée claire ; `DESIGN.md` et `/dev/design` ; axe | grande | — |
| — | **Maquette de l'accueil (phase C)** : deux variantes avec les composants existants — **avant D5** | moyenne | accord du plan |
| D5 | **Nouvel accueil** (variante choisie) : héros, 3 étapes, créations récentes réelles, section temps liée aux états de l'édition, page « En savoir plus » (manifeste) | grande | D2, D4, maquette |
| D6 | **Suppression du Protocole ZÉRO** (A6) | moyenne | D2, D5 |
| D7 | **Textes** FR/EN complets, vocabulaire, pages légales (version provisoire), images de partage, README et guides | moyenne | D5 |
| D8 | **Conservation** : export ZIP, script d'intégrité, procédure de restauration | moyenne | D2 |
| D9 | **Badges** : document de conception, sans développement | petite | — |

## B9. Indispensable ou facultatif

| Indispensable (le projet ne tient pas sans) | Facultatif / plus tard |
|---|---|
| Éditions en base, ouverture manuelle, clôture fiable, gel des créations (D2) | prolongation de l'édition (peut venir avec D2 ou après) |
| Prix 0,25 € vérifié partout (D1) | pseudonyme propre à chaque archive |
| Catégorie et date d'archivage, page d'archive, message de confirmation (D3) | coordonnées du lieu (le libellé suffit au début) |
| Nouvelle palette appliquée à tout le côté public (D4) | particules lumineuses, transitions pixel |
| Nouvel accueil, textes, retrait du Protocole ZÉRO (D5–D7) | données structurées pour les moteurs de recherche |
| Export + vérification d'intégrité avant la clôture (D8) | dépôt de l'archive auprès d'une institution |
| Validation juridique des textes et du traitement des retraits | badges (D9), certificats, offres entreprises/associations |

---

# DÉCISIONS DU PROPRIÉTAIRE

| # | Question | Recommandation |
|---|---|---|
| 1 | Accueil : variante 1 (carte d'abord) ou 2 (accueil puis carte) ? | **2** ; la phase C montrera les deux |
| 2 | Projets collectifs (financement à plusieurs) : visibles, discrets, ou masqués ? | **discrets** (lien en pied de page / menu), sans les mettre en avant |
| 3 | Dollar hors zone euro : 0,25 $ ou autre ? | **0,25 $** (inchangé) |
| 4 | Paiement déjà lancé à la clôture | **grâce de 35 min**, au-delà remboursé |
| 5 | Projets collectifs encore en collecte à la clôture | **expirés, tout le monde remboursé** |
| 6 | Avant lancement | **achats fermés**, carte consultable |
| 7 | Après la clôture : « j'aime », classement, commentaires | **j'aime et classement gelés (classement historique), commentaires fermés, signalements toujours ouverts** |
| 8 | Liste de catégories | celle de A4 bis |
| 9 | Lieu associé | **libellé + pays**, coordonnées arrondies facultatives |
| 10 | Pseudonyme | **pseudo du compte**, un par personne |
| 11 | Administration | **reste claire** |
| 12 | Page « En savoir plus » | **manifeste court** tiré du texte d'introduction, remplace la BD |
| 13 | Date d'archivage | **date du paiement confirmé** |
| 14 | Nom de la première édition | **« Édition fondatrice »** (aucune année tant que la date n'est pas fixée) |
| 15 | Date de clôture après ouverture | **prolongeable seulement**, journalisée, jamais raccourcie |

## Ce qui ne dépend pas de moi (juriste, prestataires)

La détention temporaire de fonds (projets collectifs), le droit de rétractation et la politique de remboursement, la TVA, le traitement d'une demande d'effacement face à une archive publique, la formulation « contribution / droit d'usage numérique » sans tromper le consommateur, et toute promesse de durée de conservation : **à faire examiner par un juriste avant tout lancement réel**. Je ne fixe aucune règle juridique ou fiscale. Le paiement réel reste **désactivé** (règle du projet).

## État d'avancement

- **Phase A (audit) et B (proposition)** : faites (ce document).
- **Phase C (maquette de l'accueil)** : faite ; deux variantes (A « carte d'abord », B « accueil puis carte ») et les trois états du compteur. **Validée par le propriétaire** (« ça me va ») avec une demande : **les océans gardent une teinte bleutée** (intégrée, voir B3). Le choix entre A et B ne conditionne que l'étape D5 (accueil) : il reste à confirmer avant D5 (recommandation : B).
- **Phase D (développement)** : les décisions 1 à 15 non tranchées suivent leur recommandation par défaut.
  - **D1 — faite** : la table du brief (25 px = 6,25 € … 400 px = 100 €) est figée à chaque couche : devis (`tests/unit/price-table.test.ts`), commande en base avec les réglages d'usine après toutes les migrations, en euros et en dollars, terre et eau (`tests/db/price-025.test.ts`), panneau d'achat dans le navigateur (`tests/e2e/ui.spec.ts`). Constat : le prix de paiement envoyé à Stripe est `orders.amount_cents`, calculé par la base ; aucune fonction ne reçoit de montant du navigateur. Seul écart trouvé et corrigé : `docs/ARCHITECTURE.md` annonçait encore 0,50 €. **Reste à vérifier par le propriétaire** : la valeur réelle dans `/admin/settings` du site de test (la migration 16 ne touche pas un prix saisi à la main).
  - **D2 — faite** (migration 19) : table `editions` (une seule ligne : l'édition fondatrice, en pré-lancement, **sans aucune date**), état **calculé par l'horloge de la base** à chaque appel, garde dans les fonctions d'achat et de modification (achat, projet collectif, contribution, approbation d'un projet, nouvelle version d'une création, dessin collectif, commentaires, « j'aime »), délai de grâce de 35 minutes pour les paiements déjà lancés (au-delà : remboursés), projets collectifs terminés et remboursés à la clôture, **cliché historique** (manifeste + sha256, ajoutable seulement), page admin « Édition » (ouvrir en tapant le nom, reporter, clore, nouveau cliché), `GET /api/edition`, tâche de clôture idempotente. Remplace `NEXT_PUBLIC_WORLD_END_AT` pour les ventes. Testé : 27 tests de base (dont la course achat/clôture et six tâches simultanées), 6 tests e2e, 6 tests unitaires. Reste à faire par le propriétaire : appliquer la migration 19 sur le site de test, puis ouvrir l'édition dans `/admin/edition` (étape 9b du guide de déploiement).
  - **D3 — faite** (migration 20) : **catégorie** (liste fermée de onze, demandée dans le formulaire) et **lieu associé** (texte de 80 caractères et pays facultatif, **jamais de coordonnées**) sur chaque création, y compris les projets collectifs ; **date d'archivage** = date du paiement confirmé ; **page d'archive** `/archive/<code>` (lisible sans la carte, partageable, indexable une fois la création validée) avec bouton « La voir sur la carte » ; la carte, la modération et le JSON public les montrent ; message de confirmation « Votre trace fait désormais partie de l'archive collective de notre époque. ». `/p/<code>` reste l'adresse du lieu (la carte). Décision d'implémentation : le lieu est un texte libre + pays (sans recherche de lieux), à rediscuter si vous voulez la même recherche que la barre de la carte. Testé : 8 tests de base, 7 unitaires, 9 e2e.
  - **D4 — faite** : la **nouvelle direction artistique** couvre tout le côté public. Deux thèmes faits des mêmes variables (`data-theme`) : **nuit** (violet `#190921`, or `#d6ab72`, cyan `#55c7d1`, ivoire `#f1e8df`) pour le public, **lumière** (l'ancienne palette) pour l'administration. Les boutons « escalier » sont les mêmes, recolorés (bouton principal cyan) ; la carte a ses **océans bleu nuit** (`#0d1a3e`), ses terres violettes, ses côtes dorées, ses noms en ivoire, sa sélection cyan et ses projets en or ; le logo et les icônes sont en or et cyan ; `docs/DESIGN.md` et `/dev/design` décrivent les deux thèmes. Le Protocole ZÉRO garde provisoirement son look clair (palette de la carte et variables de ses éléments) tant qu'il n'est pas retiré (D6). Testé : suite e2e complète (les contrastes sont vérifiés par axe), dont deux tests de couleurs de la carte mis à jour.
  - **D5 — faite** (variante B, « accueil puis carte », choisie par le propriétaire) : `/` est la **page d'accueil** et la carte est à `/map` ; les anciennes adresses (`/?x=…&y=…&z=…`, `/?p=…`, `/?buy=1`, `/?bx=…`, `/?preview=…`) ouvrent toujours la carte. Contenu : le **planisphère** (la vraie terre du site, en palette nuit, océans bleus, avec les créations validées à leur place) derrière « Dans 100 ans, que restera-t-il de nous ? », les boutons « Laisser ma trace » / « Explorer les archives » et le prix réel en petit (0,25 € le pixel, à partir de 6,25 €) ; **3 étapes** ; **« Récemment archivées »** (créations réelles validées uniquement, la section n'existe pas tant qu'il n'y en a aucune) ; la **section temps** liée à l'état de l'édition lu en base (pré-lancement « Ouverture prochaine » sans date ni compteur, ouverte avec les jours restants, close « Archive historique ») ; la page **« En savoir plus »** (`/about`, texte provisoire). Testé : `tests/e2e/home.spec.ts`, états de l'édition dans `edition.spec.ts`, trace récente dans `the-archive.spec.ts`, largeurs de téléphone 320/390/412 dans `mobile.spec.ts`, `tests/unit/home.test.ts`.
  - **D6 — faite** : le **Protocole ZÉRO est retiré**, tout ce que listait A6 : composants (`components/doom`), modules (`lib/doom`, `lib/og/story`), images (`public/story`, `assets/story-source`) et `scripts/build-story.mts`, corruption / glitch / séquence finale / frange du **moteur de la carte** (environ 600 lignes) et sa palette claire de secours (la carte n'a plus qu'une palette, la nuit, océans bleus), `Geo.landLattice/waterLattice` (ne servaient qu'à la corruption), textes `doom.*` et `comic.*` (FR et EN), styles et jetons `--color-glitch-*`, variables `NEXT_PUBLIC_WORLD_END_AT` et `NEXT_PUBLIC_STORY_PREVIEW` (le contrôle de configuration avertit seulement si l'une est encore posée), paramètre `?preview=`. L'image de partage du site est **une seule image** à la nouvelle DA (violet nuit, or, cyan ; « Dans 100 ans, que restera-t-il de nous ? » ; FR/EN). `/globe` renvoie vers `/map`. Tests supprimés : 8 fichiers unitaires, 3 e2e (`comic`, `doom`, `map-doom`) et les parties « histoire » de `map-water`, `mobile`, `share`, `config-check`, `smoke`. **Pas de remplaçant du `?preview=`** pour l'instant : les trois états de l'édition se testent en l'ouvrant/clôturant sur le site de test (`/admin/edition`) ; un aperçu réservé à l'administration reste possible plus tard.
  - **D7 — faite** : **vocabulaire de l'archive** (FR et EN) dans le parcours public : slogan `meta.tagline` (« Dans 100 ans, que restera-t-il de nous ? »), description, titre de la carte, bouton de la carte et de l'en-tête « **Laisser ma trace** » (remplace « Trouvez votre place »), compteurs (« Pixels archivés », « Part de la carte archivée », « Contributeurs »), tuile « Récemment archivées », panneau d'achat (« Laissez votre trace », « Créer ma trace »), pied de page, inscription/connexion, compte, fiche et dessin collectif (« auteur » à la place de « propriétaire » côté public) ; le mot « parcelle » reste celui du rectangle choisi, et le bouton de paiement garde son montant explicite. **Pages légales** (toujours provisoires, crochets « à faire relire par un juriste ») : conditions réécrites (« Ce que vous payez » = contribution + droit d'usage numérique, pas de garantie de conservation éternelle, nouvelle section « Éditions et clôture » avec figement et retrait légitime, « Durée de conservation d'une trace »), confidentialité (archive publique, effacement), règles. **Image de partage des traces** (`/api/og/parcel/<code>`) à la nouvelle DA, dans la langue de la page (`?lang=fr`), en police pixel sauf titre dans un alphabet qu'elle ne sait pas dessiner (alors police du moteur) ; briques communes dans `src/lib/og/brand.tsx`. README, guides et liste de lancement à jour.
