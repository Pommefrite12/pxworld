# Mettre le site en ligne en mode TEST, pas à pas

À suivre dans l'ordre, environ **1 h 30 à 2 h**. Tout se fait en **mode test** : aucune vraie carte bancaire, aucun vrai paiement.
Les étapes 1 à 3 créent trois comptes gratuits (Supabase pour la base de données et les comptes des visiteurs, Stripe pour le
paiement, Vercel pour héberger le site). L'étape 4 les relie, l'étape 5 vérifie que tout marche.

> **Règle d'or :** les clés et mots de passe vont dans un fichier de notes privé (ou un gestionnaire de mots de passe), et dans les
> pages de réglages de Supabase / Stripe / Vercel. **Jamais** dans le chat avec moi, ni dans GitHub, ni dans un fichier du dépôt.
> Les écrans de ces services changent parfois d'apparence : si un libellé est un peu différent, cherchez le mot-clé indiqué en gras.

**À savoir avant de commencer**
- Le compte gratuit de **Vercel (Hobby)** est réservé à un usage personnel et non commercial : parfait pour ce test, mais il faudra passer au
  forfait payant (Pro) pour le vrai lancement.
- Le projet gratuit de **Supabase** se met en pause après une semaine sans activité (on le relance d'un clic) et n'a pas de sauvegarde
  point-dans-le-temps : parfait pour le test, forfait payant conseillé au lancement.
- Rien de ce que vous allez créer ne coûte quoi que ce soit pour l'instant.

---

## Étape 0 : préparer (5 min)

1. Ouvrez un fichier de notes privé. Vous y collerez au fur et à mesure : le mot de passe de la base, trois clés Supabase, la clé Stripe,
   le secret du webhook, et les deux secrets que nous générerons.
2. Ouvrez votre Codespace (comme d'habitude) et mettez-le à jour :
   ```bash
   git pull origin claude/funny-bell-k7v5xf
   ```
3. Générez deux secrets au hasard (deux commandes, deux résultats à noter, l'un pour `RATE_LIMIT_SALT`, l'autre pour `CRON_SECRET`) :
   ```bash
   openssl rand -hex 32
   ```
   ```bash
   openssl rand -hex 32
   ```

---

## Étape 1 : Supabase, la base de données et les comptes (20 min)

1. Allez sur **supabase.com** → **Start your project** → connectez-vous avec GitHub.
2. **New project** :
   - **Name** : `pixelworld-test`
   - **Database password** : cliquez sur **Generate a password**, **copiez-le dans vos notes**. Si le mot de passe contient des symboles
     (`@`, `/`, `:`…), régénérez-en un jusqu'à en avoir un fait uniquement de lettres et de chiffres : c'est plus simple pour la suite.
   - **Region** : **Frankfurt** (ou la plus proche de chez vous en Europe).
   - Plan **Free**. Cliquez sur **Create new project** et attendez 2 minutes.
3. **Récupérez les clés** : menu de gauche → **Project Settings** (la roue dentée) → **API** (ou **API Keys**). Notez :
   - **Project URL** (ressemble à `https://abcdxyz.supabase.co`) → ce sera `NEXT_PUBLIC_SUPABASE_URL`
   - la clé **anon** (ou **publishable**) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - la clé **service_role** (ou **secret**), à ne montrer à personne → `SUPABASE_SERVICE_ROLE_KEY`
4. **Récupérez les deux adresses de connexion** : bouton **Connect** en haut de la page → onglet **Connection string** (ou **ORMs**).
   Vous avez besoin de deux adresses, dans lesquelles vous remplacez `[YOUR-PASSWORD]` par le mot de passe de la base :
   - **Session pooler** (port **5432**) → pour installer la base depuis votre Codespace (point 6 ci-dessous)
   - **Transaction pooler** (port **6543**) → ce sera `DATABASE_URL` sur Vercel
   Elles commencent par `postgresql://postgres.` et contiennent `pooler.supabase.com`. **N'ajoutez rien à la fin** (pas de `?sslmode=…`).
5. **Créer le dossier privé des images** : menu **SQL Editor** → **New query**. Dans votre Codespace, affichez le fichier :
   ```bash
   cat supabase/storage.sql
   ```
   Copiez tout ce qu'il affiche, collez-le dans l'éditeur Supabase, cliquez sur **Run**. Message attendu : *Success. No rows returned*.
6. **Installer les tables** : dans le terminal du Codespace, en remplaçant l'adresse par votre **Session pooler** (entre apostrophes) :
   ```bash
   DATABASE_URL='postgresql://postgres.xxxx:VOTRE_MOT_DE_PASSE@aws-0-xxxx.pooler.supabase.com:5432/postgres' node scripts/migrate.mjs
   ```
   Vous devez voir 14 lignes `applying … ok`. Si vous relancez la commande, elle n'applique plus rien : c'est normal.
7. **Réglages des comptes** : menu **Authentication** → **Sign In / Providers** : **Email** doit être activé, avec **Confirm email** coché.
   (Google est facultatif pour ce test.) Les adresses du site seront réglées à l'étape 4.

---

## Étape 2 : Stripe, le paiement en mode test (10 min)

1. Allez sur **stripe.com** → créez un compte. **Ne cliquez sur aucune proposition « Activer les paiements » ou « Passer en production »** :
   restez dans l'environnement de **test** (bandeau « Mode test » ou « Sandbox » en haut).
2. **Developers** (Développeurs) → **API keys** : copiez la **Secret key** qui commence par **`sk_test_`** → `STRIPE_SECRET_KEY`.
   Si elle commence par `sk_live_`, vous n'êtes pas en mode test : arrêtez-vous et dites-le-moi.
3. **Settings** → **Payment methods** : laissez les **cartes** activées, rien d'autre.
4. Le webhook se crée à l'étape 4 (il lui faut l'adresse du site).

---

## Étape 3 : Vercel, l'hébergement (20 min)

1. Allez sur **vercel.com** → **Sign Up** → **Continue with GitHub**, plan **Hobby**.
2. **Add New…** → **Project** → choisissez le dépôt **`Pommefrite12/pxworld`** → **Import**. (Si le dépôt n'apparaît pas :
   **Adjust GitHub App Permissions** et donnez l'accès à ce dépôt.)
3. Avant de cliquer sur Deploy :
   - **Project Name** : `pixelworld-test` (l'adresse sera `https://pixelworld-test.vercel.app` si le nom est libre ; sinon Vercel en propose un autre, notez-le).
   - **Framework Preset** : Next.js (automatique). Ne changez ni la commande de build ni le dossier.
   - **Environment Variables** : ajoutez **une par une** les lignes du tableau ci-dessous (pour chacune : nom, valeur, **Add**).
4. **Deploy**, puis attendez 3 à 5 minutes. Si le build échoue, ouvrez le journal rouge, copiez les 20 dernières lignes **sans clé** et envoyez-les-moi.
5. **Branche de production** : le dépôt a une branche `main` quasi vide ; notre travail est sur `claude/funny-bell-k7v5xf`.
   Dans Vercel : **Settings** → **Environments** → **Production** → **Branch Tracking** (ou **Settings** → **Git** → **Production Branch**)
   → choisissez `claude/funny-bell-k7v5xf`, puis **Save**. Chaque fois que je pousse du code sur cette branche, le site se met à jour tout seul.
   (Si vous préférez que la branche principale devienne `main`, dites-le-moi : je prépare la fusion sur votre demande.)
6. **Settings** → **General** → **Node.js Version** : **22.x**.

### Les variables d'environnement

| Nom | Valeur | D'où elle vient |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://pixelworld-test.vercel.app` (**l'adresse exacte du site, en https, sans `/` final**) | le nom du projet |
| `DATABASE_URL` | l'adresse **Transaction pooler** (port 6543) | Supabase, étape 1.4 |
| `NEXT_PUBLIC_SUPABASE_URL` | la **Project URL** | Supabase, étape 1.3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé **anon / publishable** | Supabase, étape 1.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé **service_role / secret** | Supabase, étape 1.3 |
| `STRIPE_SECRET_KEY` | `sk_test_…` | Stripe, étape 2.2 |
| `RATE_LIMIT_SALT` | le premier secret généré | étape 0.3 |
| `CRON_SECRET` | le second secret généré | étape 0.3 |
| `STRIPE_WEBHOOK_SECRET` | *(à ajouter à l'étape 4.2)* | Stripe |

À **ne pas** ajouter : `DEV_AUTH`, `NEXT_PUBLIC_DEV_AUTH`, `DEV_AUTH_SECRET`, `STRIPE_MOCK`, `LOCAL_STORAGE_DIR`, `PAYMENTS_LIVE_ENABLED`
(variables de développement ou de vrais paiements), ni `NEXT_PUBLIC_WORLD_END_AT` (l'histoire des 100 jours reste éteinte tant que la date n'est pas décidée).
Les variables `NEXT_PUBLIC_OPERATOR_*` et `NEXT_PUBLIC_CONTACT_EMAIL` (identité du vendeur) peuvent attendre : les pages légales afficheront des
trous entre crochets, c'est normal pour un test.

> `NEXT_PUBLIC_…` est « figé » à la construction du site : si vous modifiez une de ces variables, il faut **redéployer**
> (**Deployments** → les trois points du dernier déploiement → **Redeploy**).

---

## Étape 4 : relier les trois (10 min)

1. **Supabase** → **Authentication** → **URL Configuration** :
   - **Site URL** : l'adresse du site (`https://pixelworld-test.vercel.app`)
   - **Redirect URLs** → **Add URL** : `https://pixelworld-test.vercel.app/auth/callback` **et** `https://pixelworld-test.vercel.app/**` → **Save**
2. **Stripe** → **Developers** → **Webhooks** (ou **Event destinations**) → **Add endpoint** (**Create destination**) :
   - **Endpoint URL** : `https://pixelworld-test.vercel.app/api/stripe/webhook`
   - **Events** : cochez exactement ces 8 : `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`
   - Après création : **Signing secret** → **Reveal** → copiez la valeur qui commence par **`whsec_`**.
   - Dans **Vercel** → **Settings** → **Environment Variables** : ajoutez `STRIPE_WEBHOOK_SECRET` = cette valeur, puis **Redeploy** le site.
3. Si l'adresse réelle du site n'est pas celle que vous aviez mise dans `NEXT_PUBLIC_SITE_URL`, corrigez-la, **Redeploy**, et reprenez le point 1.

---

## Étape 5 : vérifier (20 min)

1. **Le contrôle automatique**. Dans le Codespace :
   ```bash
   node scripts/smoke.mjs https://pixelworld-test.vercel.app
   ```
   Résultat attendu : `51/51 checks passed`. S'il y a des `FAIL`, copiez les lignes et envoyez-les-moi.
2. **Le site s'ouvre**, la carte s'affiche. Passez en anglais / français.
3. **Créez votre compte** (Sign in → Sign up) avec votre vrai e-mail, confirmez par le lien reçu. (Le service d'e-mails gratuit de Supabase limite à
   quelques messages par heure : si le message tarde, patientez.)
4. **Devenez administrateur** : Supabase → **SQL Editor** → **New query**, en remplaçant l'adresse par la vôtre :
   ```sql
   insert into public.admin_roles (user_id, role) select id, 'admin' from auth.users where email = 'vous@exemple.fr';
   ```
   Puis rechargez le site : le menu de votre compte doit proposer l'administration.
5. **Un achat de test** : cliquez sur **Trouver ma place** / **Find your spot**, choisissez une petite parcelle **sur la terre**, ajoutez une image,
   acceptez les conditions, **Payer**. Sur la page de Stripe, carte **`4242 4242 4242 4242`**, une date future quelconque, un code CVC
   quelconque, un code postal quelconque. Vous revenez sur le site : la commande doit passer à **Payée**. Dans **Administration → Modération**,
   approuvez la création ; la parcelle apparaît sur la carte.
   - Dans Stripe (mode test) → **Payments** : le paiement de test apparaît, en **EUR** puisque vous êtes en France.
6. **Une parcelle en mer** doit être refusée (« pas sur la terre »).
7. **Tester le prix en dollars** (sans VPN) : dans Vercel, ajoutez `TEST_COUNTRY` = `US`, **Redeploy** ; le prix s'affiche en **$**. Refaites un achat
   de test : Stripe doit montrer **USD**. Puis **supprimez la variable `TEST_COUNTRY`** et **Redeploy** (elle ne fonctionne qu'avec une clé `sk_test_`).
8. **Les journaux** : Vercel → votre projet → **Logs**. Cherchez `[config]` : ce sont les avertissements de configuration (il ne doit plus y avoir
   de `error`). Cherchez `[alert]` et `[csp]` : à lire de temps en temps pendant la semaine de test.

---

## Quand c'est fait

- **Ne partagez pas encore l'adresse publiquement** : c'est un site de test (paiements fictifs).
- Dites-moi simplement **« le déploiement est fait »** ou envoyez-moi **le texte exact de ce qui bloque** (jamais de clé ni de mot de passe).
- Ensuite, de mon côté : relire avec vous le résultat des vérifications, puis les réglages à faire une fois le site en ligne (double authentification
  des administrateurs, règles du pare-feu Vercel, lecture des rapports `[csp]` pendant une semaine, essai de restauration d'une sauvegarde).
- **Pas encore** (chacun demande votre accord explicite) : les vraies clés Stripe, les vrais paiements, la date de fin de l'histoire,
  le nom de domaine, les textes légaux.

## Si ça coince

| Symptôme | Cause probable |
|---|---|
| Le build Vercel échoue | copiez les dernières lignes du journal et envoyez-les-moi |
| La page affiche une erreur « Invalid environment configuration » | une variable est mal écrite (guillemets, espace, `/` final) |
| Impossible de se connecter / le lien de l'e-mail mène à une erreur | étape 4.1 : l'adresse de redirection manque ou ne correspond pas |
| Le paiement réussit mais la commande reste « en attente » | étape 4.2 : webhook absent, mauvais événements, ou `STRIPE_WEBHOOK_SECRET` faux (puis **Redeploy**) |
| `migrate.mjs` : « password authentication failed » | le mot de passe de la base est faux (ou contient des symboles non protégés) |
| `migrate.mjs` : « ENOTFOUND » / « timeout » | prenez bien l'adresse **Session pooler** (pas « Direct connection ») |
| Rien ne s'affiche sur la carte | attendez 10 secondes (le premier chargement est plus long) ; sinon regardez **Logs** |
