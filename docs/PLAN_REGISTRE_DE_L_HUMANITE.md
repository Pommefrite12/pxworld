# « Sauvez le monde. Et la pizza avec. » — plan en trois phases

*Analyse du code existant et proposition. **Rien de ce qui suit n'est codé** : on attend votre accord sur les points de la section 6.*

## 1. Ce qui existe déjà et que l'on réutilise

| Besoin | Ce qui existe | Réutilisation |
|---|---|---|
| Une création par parcelle, versions successives | `parcel_assets` (une ligne par version : `pending` → `approved` / `rejected` / `superseded` / `removed`), `px_add_asset`, `px_review_asset` | le « concept » s'attache à la **création** (une ligne de `parcel_assets`), pas à la parcelle : c'est la création qui représente la pizza |
| Modération | file d'attente `/admin/moderation`, `px_review_asset`, `moderation_actions`, `audit_logs` (journaux en ajout seul) | un seul geste du modérateur : valider la création **et** son élément |
| Opérations sensibles protégées | fonctions `px_*` appelées par le serveur uniquement (rôles du navigateur révoqués), `px_require_staff` | mêmes règles pour toutes les nouvelles fonctions |
| Unicité garantie par la base | contraintes d'exclusion (parcelles), index uniques partiels (une seule création en attente par parcelle) | un **index unique partiel** garantit « un seul Premier Sauveur par élément » |
| Partage | `/api/og/home` (image de partage, police pixel), pages publiques de parcelle | mêmes outils pour l'image du badge et de l'élément |
| FR/EN | `src/messages/{fr,en}.json`, routes `[locale]` | idem |

**Ne change pas :** la carte (aucune donnée de concept dans les tuiles : zéro effet sur ses performances), les paiements Stripe, les prix, la propriété géographique, `px_start_order`.

## 2. Principe de données (commun aux trois phases)

- Un **élément** (concept) a un **identifiant interne stable** (`uuid`), indépendant de son nom. Ses noms sont des **étiquettes** par langue (`fr`, `en`) et des synonymes ; un texte normalisé (minuscules, sans accents, sans articles, singulier/pluriel ramenés à la même forme) est **unique par langue** : « Pizza », « pizzas », « La pizza » sont le même élément.
- Une création porte **au plus un** élément principal (une seule colonne `concept_id` : la règle « un seul élément à sauver » est tenue par la structure elle-même).
- L'élément est facultatif : sans élément, la parcelle est protégée comme aujourd'hui.
- Le Premier Sauveur n'est pas un champ qu'on écrit à la main : il est **calculé** par une fonction de la base, verrouillée, à partir de l'ordre de soumission et de l'état de validation.

## 3. Les trois phases

### Phase 1 — Fonctionnement essentiel : « Que souhaitez-vous sauver ? »
**Migration 16**
- `concept_categories` (clé, noms FR/EN, ordre) remplie : animaux, gastronomie, culture, inventions, objets, nature, transports, loisirs, monuments, autre.
- `concepts` (id, catégorie, statut `proposed | approved | rejected | merged`, `merged_into`, auteur, dates, motif de refus).
- `concept_labels` (concept, langue, texte affiché, texte normalisé ; **unique (langue, texte normalisé)**).
- `parcel_assets.concept_id` (nullable) ; `parcel_assets.concept_label_typed` (ce que l'acheteur a tapé, conservé pour la modération).
- Extensions PostgreSQL : `unaccent` et `pg_trgm` (déjà disponibles sur Supabase) pour la normalisation et la recherche approchée.
- Fonctions : `px_normalize_label`, `px_search_concepts` (préfixe + similarité, par langue, synonymes compris), `px_propose_concept` (rattache à l'existant si le texte normalisé existe, sinon crée une proposition ; limite de propositions par compte), `px_add_asset` reçoit un argument facultatif `p_concept` (l'ancien appel reste valable), `px_review_asset` reçoit la décision sur l'élément (valider / rattacher à un élément existant / refuser l'élément sans refuser la création).
- Liste de refus (concepts vagues : « tout », « le monde », « l'univers »…) appliquée dès la saisie.

**Interface :** champ « Que souhaitez-vous sauver ? » avec autocomplétion dans la boîte d'achat et dans la page de modification de création ; « Proposer un nouvel élément » ; file de modération enrichie (élément revendiqué, comparaison avec la création, boutons de rattachement et de catégorie) ; `GET /api/concepts/search`.
**Tests :** normalisation (variantes, accents, pluriels, langues), recherche, rattachement, refus, droits (un non-modérateur ne peut rien valider), compatibilité des parcours existants (achat sans élément).

### Phase 2 — Rareté et collection : Premier Sauveur
**Migration 17**
- `parcel_assets.claim_at` : l'instant de **soumission complète** = le plus tardif de « création déposée » et « parcelle payée » (une création sur une réservation non payée ne compte pas).
- `concept_badges` (id, **code public** de 10 caractères, concept, création, parcelle, utilisateur, date, statut `active | revoked | merged`, motif) avec l'index unique **`unique (concept_id) where status = 'active'`**.
- `concept_disputes` (contestations de badge) ; journalisation dans `audit_logs`.
- `px_resolve_first_saviour(concept)` : verrouille la ligne de l'élément, prend la revendication la plus ancienne parmi les créations **non refusées** de parcelles actives ; si elle est validée et qu'aucun badge n'existe, elle reçoit le badge ; si une revendication plus ancienne attend encore la modération, **le badge attend sa décision** ; une création refusée, retirée ou remboursée perd sa priorité. Appelée à chaque décision de modération, retrait, remboursement ou expiration.

**Interface :** page publique `/badge/[code]` (nom de l'élément, « Premier Sauveur », pseudonyme, date, identifiant, lien vers la parcelle) ; « Mes badges » ; bouton de partage ; image de partage `/api/og/badge/[code]` (jamais de badge « validé » tant que la décision n'est pas prise) ; texte de partage en FR/EN.
**Tests base de données (le cœur du risque) :** deux acheteurs simultanés pour le même élément (un seul badge), la création la plus ancienne refusée (le badge passe à la suivante), la plus ancienne en attente (attente), remboursement, retrait, élément fusionné, compte supprimé.

### Phase 3 — Registre complet
- Pages `/registre` (EN `/registry`) : recherche, catégories, galerie des éléments sauvés, derniers sauvés, premiers revendiqués récemment, **fiche par élément** (statut, Premier Sauveur, date réelle, nombre réel de créations associées, catégorie, création du Premier Sauveur, localisation de sa parcelle, autres créations).
- Élément **non sauvé** : message « Cet élément n'a pas encore été sauvé… » avec accès à l'achat ; on ne dit jamais « n'existe pas » (synonymes, traductions et propositions en cours sont cherchés d'abord).
- Administration : fusion de doublons, traductions, catégories, **procédure de résolution documentée** pour les badges, tout dans le journal d'audit.
- Statistiques **réelles** uniquement (comptages en base, mis en cache 30 s comme les compteurs actuels) ; sitemap ; après l'échéance, le registre devient une archive en lecture seule.

## 4. Impact sur les parcours existants

| Parcours | Effet |
|---|---|
| Achat (`/api/checkout`, boîte d'achat) | un champ facultatif en plus ; **le prix, Stripe et la réservation ne changent pas** ; un élément refusé ne bloque jamais la parcelle |
| Modification d'une création | l'élément peut être changé : une nouvelle création = une nouvelle revendication ; un badge déjà attribué reste attaché à **la création qui l'a obtenu** (conservée, même remplacée) |
| Modération | la file affiche l'élément revendiqué ; une décision peut valider la création et l'élément en un geste |
| Carte, rasters, tuiles | aucun changement |
| Remboursement / contestation de paiement | la parcelle redevient libre → ses revendications tombent → le badge éventuel est révoqué avec motif et passe à la revendication suivante |
| Démo | quelques éléments de démonstration pourront être ajoutés par l'outil (site de test seulement) |
| Textes légaux (brouillons) | à compléter : badge symbolique, ni propriété intellectuelle, ni NFT, ni actif échangeable |

## 5. Principaux risques techniques et réponses

1. **Deux Premiers Sauveurs** → verrou sur la ligne de l'élément + index unique partiel ; test de concurrence.
2. **Une vieille revendication bloque tout le monde** (en attente de modération) → c'est la règle annoncée ; il faut un objectif de délai de modération et un tableau de bord des revendications en attente les plus anciennes.
3. **Doublons et langues** → identifiant stable, étiquettes par langue, normalisation, recherche approchée ; mais aucune machine ne remplace un humain : validation manuelle du premier élément et de tout nouveau nom.
4. **Contournement par variantes typographiques** → texte normalisé unique par langue ; suggestion « existe déjà ? » à la saisie ; modérateur voit les éléments proches.
5. **Fusion de deux éléments qui ont chacun un badge** → règle proposée : le badge **le plus ancien** reste l'unique badge actif ; l'autre est conservé, vérifiable, marqué « fusionné » (jamais supprimé en silence), avec journal d'audit et notification.
6. **Noms de marques, noms de personnes, insultes, concepts vagues** → liste de refus, signalement d'abus, contestation ; marques : refus par défaut à décider (section 6).
7. **Remboursement, suppression de compte, contenu retiré** → révocation motivée du badge et reprise par la revendication suivante, tout journalisé ; compte supprimé : badge conservé sous « compte supprimé ».
8. **Soumissions en cours à zéro** → règle proposée : un paiement déjà en cours est honoré (comme aujourd'hui) et sa revendication garde sa date ; la modération continue jusqu'à épuisement de la file ; plus aucune nouvelle revendication après zéro.
9. **Partage** → les images ne montrent « Premier Sauveur » que pour un badge actif ; le reste est « en attente de validation ».
10. **Déploiement** → colonnes ajoutées facultatives (l'existant reste intact) ; migrations à appliquer sur Supabase **avant** le déploiement (même procédure que la migration 15).

## 6. Décisions à prendre avant la phase 1

1. **Date de priorité** : « le plus tardif de création déposée et parcelle payée » (recommandé) ?
2. **Changer d'élément après validation** : permis, avec nouvelle revendication, le badge restant à la création d'origine (recommandé) ?
3. **Fusion de deux badges** : le plus ancien gagne, l'autre devient « fusionné » visible (recommandé) ?
4. **Marques** (« Coca-Cola », « Nutella ») : refusées par défaut (recommandé, risque juridique) ?
5. **Catégories** : la liste proposée convient-elle ?
6. **Après zéro** : modération poursuivie sans limite de date, plus de nouvelles revendications (recommandé) ?
7. **Style des badges** : carte sombre en pixel art (cyan et magenta) posée sur le site clair : d'accord ? (le reste du site reste clair.)
8. **Section principale de l'accueil** (« Sauvez le monde. Et la pizza avec. ») : à faire en dernier, avec de nouvelles maquettes (vous avez écarté les précédentes) ?

*Le compte à rebours n'est ni lancé ni réinitialisé par ce chantier : il reste réglé par la date officielle (`NEXT_PUBLIC_WORLD_END_AT`), absente tant que vous ne l'avez pas choisie. Sur le site de test, la simulation « FICTION · 100 JOURS » reste une simulation.*
