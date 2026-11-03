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

## Étape 1 : Supabase, la base de données et les comptes (30 min)

Supabase fait trois choses pour nous : il garde **les données** (parcelles, commandes), il gère **les comptes** des visiteurs (inscription, connexion) et il
range **les images**. À la fin de cette étape, vous aurez noté **7 informations** dans votre fichier de notes (la liste est en bas).

### 1A. Créer le compte et le projet

*(Si vous avez déjà un projet Supabase, passez à 1B. Votre projet actuel s'appelle peut-être déjà `pixelworld-test` : gardez-le.)*

1. Ouvrez **https://supabase.com**.
2. En haut à droite, cliquez sur **Sign in** puis sur **Continue with GitHub**. GitHub vous demande d'autoriser Supabase : cliquez sur **Authorize supabase**.
3. Si Supabase vous demande de créer une **organisation** : **Name** = `Pixel World`, **Type** = `Personal`, **Plan** = `Free`, puis **Create organization**.
4. Cliquez sur le bouton vert **New project**.
5. Remplissez le formulaire :
   - **Organization** : celle que vous venez de créer (déjà sélectionnée).
   - **Project name** : `pixelworld-test`
   - **Database Password** : cliquez sur **Generate a password**. Un mot de passe apparaît.
     **Avant de continuer, copiez-le dans votre fichier de notes** (ligne « Mot de passe de la base »). Supabase ne le remontrera plus jamais.
     Vérifiez qu'il ne contient **que des lettres et des chiffres**. S'il contient des symboles comme `@ / : # ? %`, cliquez de nouveau sur **Generate a password** jusqu'à en obtenir un sans symbole.
   - **Region** : ouvrez la liste et choisissez **Europe (Frankfurt)**, ou la ville d'Europe la plus proche de chez vous.
   - Laissez **toutes les autres options** comme elles sont (ne cochez et ne décochez rien).
6. Cliquez sur **Create new project**.
7. Attendez 1 à 2 minutes : une page de chargement s'affiche, puis le tableau de bord du projet. Quand vous voyez le menu à gauche avec « Table Editor », « SQL Editor »,
   etc., c'est prêt.

### 1B. Noter l'adresse du projet et la clé publique

1. En haut de la page, cliquez sur le bouton **Connect**. Une fenêtre « Connect to your project » s'ouvre (celle de votre capture), avec cinq onglets : *Framework, Server, Direct, ORM, MCP*.
2. Restez sur l'onglet **Framework**. **Ne changez rien** à « Framework », « Variant » ni « Shadcn », et n'exécutez aucune commande de cet écran (il est fait pour des développeurs qui partent de zéro).
3. En bas à droite, la zone avec les onglets `.env.local`, `page.tsx`… : restez sur **`.env.local`**. Elle contient deux lignes :
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
   ```
   Les lignes sont coupées à droite : faites défiler la zone vers la droite, ou passez la souris dessus pour faire apparaître un bouton **Copy**.
4. Dans votre fichier de notes, écrivez :
   - ligne **« Project URL »** : ce qui vient **après** `NEXT_PUBLIC_SUPABASE_URL=` (c'est une adresse qui commence par `https://` et se termine par `.supabase.co`)
   - ligne **« Clé publique »** : ce qui vient **après** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` (elle commence par `sb_publishable_`)
5. **Attention aux noms** : Supabase l'appelle « PUBLISHABLE_KEY », notre site l'appelle **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**. C'est la même chose. Sur Vercel (étape 3), la valeur de cette « clé publique » ira dans la variable nommée `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. Notez aussi **l'identifiant du projet** : ce sont les lettres entre `https://` et `.supabase.co` dans le Project URL (votre capture montre `wrpemamvpcsgrapwukzj`). Ligne **« Identifiant du projet »**.

Ces deux valeurs ne sont **pas secrètes** (le navigateur des visiteurs les utilise).

### 1C. Noter la clé secrète

1. Fermez la fenêtre « Connect » (croix en haut à droite ou touche Échap).
2. En bas du menu de gauche, cliquez sur la **roue dentée « Project Settings »**.
3. Dans le menu qui s'ouvre, cliquez sur **API Keys**.
4. Vous voyez des onglets : gardez celui des clés récentes (**« Publishable and secret API keys »**). Descendez jusqu'à la section **Secret keys**. Une clé nommée **`default`** y est listée, masquée.
5. Cliquez sur l'icône **œil** (ou **Reveal**), puis sur **Copy**. Elle commence par **`sb_secret_`**.
6. Dans votre fichier de notes, ligne **« Clé secrète (SECRET !) »** : collez-la. Elle ira dans la variable `SUPABASE_SERVICE_ROLE_KEY` de Vercel.
   **Cette clé donne tous les droits sur vos données : ne la collez jamais dans le chat, dans GitHub, ni dans une capture d'écran.**
7. *Si vous ne voyez pas cette page* ou qu'elle n'a pas de « Secret keys » : cherchez un onglet **« Legacy API keys »** ; il contient une clé **`service_role`** (longue, commence par `eyJ`) qu'on utilise de la même façon.

### 1D. Noter les deux adresses de connexion à la base

1. Cliquez de nouveau sur **Connect** (en haut de la page).
2. Cliquez sur le **troisième onglet** : **Direct — Connection string**.
3. Vous voyez des adresses de connexion, ou une liste de choix (« Method »). Il y en a trois sortes. Il nous en faut **deux** :
   - **Session pooler** → se termine par `:5432/postgres`
   - **Transaction pooler** → se termine par `:6543/postgres`
   (La troisième, « Direct connection », ne marche pas depuis votre Codespace : ignorez-la.)
4. Pour chacune des deux : copiez l'adresse. Elle ressemble à :
   ```
   postgresql://postgres.xxxxxxxx:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
5. **Dans votre fichier de notes** (pas dans Supabase), remplacez `[YOUR-PASSWORD]` par le mot de passe de la base noté en 1A. **Supprimez aussi les crochets** `[` et `]`.
   Exemple : si le mot de passe est `Ab12Cd34`, l'adresse devient `postgresql://postgres.xxxxxxxx:Ab12Cd34@aws-0-…`.
6. Écrivez-les sur deux lignes : **« Adresse Session pooler »** et **« Adresse Transaction pooler »**.
7. **Ne rajoutez rien à la fin** de ces adresses (pas de `?sslmode=…`).
8. Si vous avez perdu le mot de passe : **Project Settings** (roue dentée) → **Database** → **Reset database password** → choisissez-en un (lettres et chiffres uniquement), notez-le.

### 1E. Créer le dossier privé des images

1. Dans votre **Codespace**, ouvrez un terminal et affichez le fichier :
   ```bash
   cat supabase/storage.sql
   ```
2. Sélectionnez tout le texte affiché et copiez-le.
3. Dans Supabase, menu de gauche : **SQL Editor** (icône `>_`).
4. Cliquez sur **New query** (ou sur le **+**). Une page blanche s'ouvre. Collez le texte.
5. Cliquez sur **Run** (en bas à droite de l'éditeur ; ou touches Ctrl + Entrée).
6. En bas, le résultat doit dire **« Success. No rows returned »**. (Si Supabase affiche une fenêtre d'avertissement, lisez-la : ce script ne supprime rien.)
7. Vérification : menu de gauche **Storage** → vous devez voir un dossier (bucket) nommé **`pixel-world-creations`**, marqué **Private**.

### 1F. Installer les tables depuis le Codespace

1. Dans le Codespace, ouvrez un **nouveau terminal** (le **+** en haut à droite du panneau du terminal) pour ne pas arrêter votre site de développement.
2. Mettez le code à jour :
   ```bash
   git pull origin claude/funny-bell-k7v5xf
   ```
3. Préparez la commande **dans votre fichier de notes**, jamais directement dans le terminal : copiez la ligne ci-dessous et remplacez `ADRESSE_SESSION_POOLER` par votre **« Adresse Session pooler »** (celle qui se termine par `:5432/postgres`, avec le mot de passe déjà dedans). **Gardez les apostrophes** autour.
   ```bash
   DATABASE_URL='ADRESSE_SESSION_POOLER' node scripts/migrate.mjs
   ```
4. Collez la ligne complète dans le terminal et appuyez sur Entrée. Ça prend 10 à 30 secondes.
5. Résultat attendu : **14 lignes** qui commencent par `applying 2026…` et finissent par `… ok`. La première est `20261029000001_core_schema.sql … ok`, la dernière
   `20261029000014_usd_price.sql … ok`.
6. Vérification : dans Supabase, menu **Table Editor** → vous devez voir des tables (`parcels`, `orders`, `profiles`, `app_settings`…).
7. Si vous relancez la commande, elle n'applique plus rien : c'est normal et sans danger.

**Si la commande affiche une erreur :**

| Message | Ce que ça veut dire | Quoi faire |
|---|---|---|
| `password authentication failed` | mot de passe faux ou mal recopié | refaites 1D point 5 (ou réinitialisez le mot de passe, 1D point 8) |
| `ENOTFOUND` ou `getaddrinfo` | adresse mal recopiée | recopiez-la depuis « Connect » → « Direct » |
| `timeout`, `ECONNREFUSED`, `ENETUNREACH` | vous avez pris « Direct connection » | prenez bien l'adresse **Session pooler** (`:5432`) |
| `Tenant or user not found` | l'identifiant devant `:` est faux | l'adresse doit commencer par `postgresql://postgres.` suivi de l'identifiant du projet |
| autre erreur (par exemple `permission denied` ou `extension`) | c'est le **premier vrai essai** sur un Supabase | copiez **tout le message** (il ne contient aucun mot de passe) et envoyez-le-moi |

### 1G. Régler les comptes des visiteurs

1. Menu de gauche : **Authentication**.
2. Dans la colonne de gauche de cette page, rubrique **Configuration** : cliquez sur **Sign In / Providers**.
3. Cliquez sur la ligne **Email**. Vérifiez que **Enable Email provider** est activé, et que **Confirm email** est **activé**. Si un réglage **Minimum password length** est proposé, mettez **10**. Cliquez sur **Save**.
4. Les autres lignes (Google, etc.) : laissez-les telles quelles, vous n'en avez pas besoin pour le test.
5. **Ne touchez pas encore à « URL Configuration »** : on s'en occupe à l'étape 4, quand le site aura son adresse.

### Ce que vous devez avoir dans vos notes à la fin de l'étape 1

| # | Ligne de vos notes | Où elle servira |
|---|---|---|
| 1 | Mot de passe de la base | (déjà dans les adresses 6 et 7) |
| 2 | Project URL (`https://….supabase.co`) | Vercel : `NEXT_PUBLIC_SUPABASE_URL` |
| 3 | Clé publique (`sb_publishable_…`) | Vercel : `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| 4 | Clé secrète (`sb_secret_…`) | Vercel : `SUPABASE_SERVICE_ROLE_KEY` |
| 5 | Identifiant du projet | (pour vérifier vos adresses) |
| 6 | Adresse Session pooler (`:5432`) | déjà utilisée pour installer les tables |
| 7 | Adresse Transaction pooler (`:6543`) | Vercel : `DATABASE_URL` |

> Les nouvelles clés (`sb_publishable_…`, `sb_secret_…`) devraient fonctionner avec ce site, mais je n'ai pas pu l'essayer sur un vrai projet. Si la connexion ou l'envoi d'images échoue plus tard,
> prenez les anciennes clés (onglet « Legacy API keys » : `anon` et `service_role`) et dites-moi l'erreur exacte.

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
| `DATABASE_URL` | l'adresse **Transaction pooler** (port 6543, avec le mot de passe) | Supabase, étape 1D |
| `NEXT_PUBLIC_SUPABASE_URL` | la **Project URL** | Supabase, étape 1B |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la **clé publique** (`sb_publishable_…`) | Supabase, étape 1B |
| `SUPABASE_SERVICE_ROLE_KEY` | la **clé secrète** (`sb_secret_…`) | Supabase, étape 1C |
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
