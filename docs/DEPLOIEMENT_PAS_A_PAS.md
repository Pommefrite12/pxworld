# Mettre le site en ligne en mode TEST, pas à pas

À suivre dans l'ordre, environ **1 h 30 à 2 h**. Tout se fait en **mode test** : aucune vraie carte bancaire, aucun vrai paiement.
Les étapes 1 à 3 créent trois comptes gratuits (l'étape 2, Stripe, peut attendre) (Supabase pour la base de données et les comptes des visiteurs, Stripe pour le
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

## Étape 2 : Stripe, le paiement en mode test (15 min)

> **Cette étape peut se faire après les étapes 3 et 4.** Le site fonctionne sans Stripe (les achats sont alors désactivés, avec un message clair). Dans ce cas, passez directement à l'étape 3 et revenez ici ensuite, puis suivez « Ajouter Stripe après coup » en bas.

Stripe encaisse les paiements. **En mode test, personne ne paie rien** : on utilise de fausses cartes. À la fin de cette étape, vous aurez noté **1 information**
(la clé secrète de test). Le webhook (le message que Stripe envoie au site pour dire « c'est payé ») sera créé à l'étape 4, quand le site aura son adresse.

### 2A. Créer le compte

1. Ouvrez **https://stripe.com** et cliquez sur **Sign in** puis sur **Sign up** (ou **Start now**).
2. Remplissez : votre e-mail, votre nom complet, un mot de passe (notez-le), le **pays** (France). Cliquez sur **Create account**.
3. Stripe envoie un e-mail de confirmation : ouvrez-le et cliquez sur le lien de confirmation.
4. Stripe vous pose des questions sur votre activité, ou vous propose **Activate your account** / **Activer mon compte** : **ignorez-les toutes**, fermez la fenêtre ou cliquez sur
   **Skip** / **Plus tard** / la croix. Ne donnez ni pièce d'identité, ni compte bancaire : ce n'est utile que pour de vrais paiements, que nous ne faisons pas.

### 2B. S'assurer d'être en mode test

1. Regardez **en haut de la page du tableau de bord**. Vous devez voir un repère « **Test mode** » / « **Mode test** » (souvent un bandeau ou un interrupteur orange), ou le mot **Sandbox**.
2. S'il y a un **interrupteur** « Test mode » : mettez-le sur **activé**.
3. S'il y a, en haut à gauche, un **menu déroulant avec le nom de votre compte** : ouvrez-le et choisissez l'environnement **Sandbox** (ou « Test »), s'il y en a un. Si aucun n'existe, créez-en un en cliquant sur **Create sandbox** (nom : `pixelworld-test`).
4. Dans tous les cas, le critère décisif sera la clé à l'étape 2D : elle doit commencer par **`sk_test_`**.

### 2C. Donner un nom au compte (évite une erreur au premier paiement)

1. Cliquez sur la **roue dentée « Settings »** en haut à droite (ou utilisez la barre de recherche en haut et tapez `Business details`).
2. Cherchez **Business details** (ou **Public details** / **Public business name**) et, si le nom est vide, écrivez **`Pixel World`**. Cliquez sur **Save**.

### 2D. Noter la clé secrète de test

1. Dans la barre de recherche en haut de la page, tapez **`API keys`** et cliquez sur le résultat. (Sinon : **Developers** en bas du menu de gauche, puis l'onglet **API keys**.)
2. Vous voyez deux clés :
   - **Publishable key** (`pk_test_…`) : **vous n'en avez pas besoin**.
   - **Secret key** (`sk_test_…`), masquée : cliquez sur **Reveal test key** (ou l'icône œil), puis sur **Copy**.
3. **Vérifiez le début de la clé** :
   - `sk_test_…` ou `rk_test_…` : parfait.
   - `sk_live_…` : **arrêtez-vous**, vous n'êtes pas en mode test. Revenez à 2B, et dites-le-moi si vous n'y arrivez pas.
4. Dans votre fichier de notes, ligne **« Clé secrète Stripe (SECRET !) »** : collez-la. Elle ira dans `STRIPE_SECRET_KEY` sur Vercel. **Ne la collez jamais dans le chat ni dans GitHub.**

### 2E. Moyens de paiement

1. Barre de recherche : tapez **`Payment methods`** et ouvrez **Settings → Payment methods** (« Moyens de paiement »).
2. Vérifiez que **Cards** (cartes bancaires) est **activé**. C'est le seul dont nous avons besoin. Ne changez rien d'autre.

### Ce que vous devez avoir dans vos notes à la fin de l'étape 2

| # | Ligne | Servira pour (Vercel) |
|---|---|---|
| 8 | Clé secrète Stripe (`sk_test_…`) | `STRIPE_SECRET_KEY` |

---

## Étape 3 : Vercel, l'hébergement (30 min)

Vercel met le site en ligne : il récupère le code sur GitHub, le construit et lui donne une adresse. **Stripe n'est pas nécessaire pour cette étape** : sans lui, le site
fonctionne mais les achats sont désactivés (les visiteurs voient « Les paiements ne sont pas encore disponibles. »). Vous ajouterez Stripe après coup.

### 3A. Dire à GitHub quelle branche contient le site

Le dépôt a une branche `main` (presque vide) et la branche `claude/funny-bell-k7v5xf` (tout le site). Vercel déploie la **branche par défaut** : on la change.

1. Ouvrez **https://github.com/Pommefrite12/pxworld**.
2. Cliquez sur l'onglet **Settings** (en haut du dépôt, tout à droite).
3. Dans le menu de gauche, tout en haut, cliquez sur **General**. *(Ce réglage n'est plus dans « Branches » : cette page ne parle que des règles de protection.)*
4. **Descendez** dans la page jusqu'à la section **Default branch**. Elle affiche `main` avec, à droite, une icône à deux flèches **⇄** (« Switch to another branch »).
5. Cliquez sur **⇄**, choisissez **`claude/funny-bell-k7v5xf`** dans la liste, puis cliquez sur **Update**.
6. GitHub demande confirmation : cliquez sur **I understand, update the default branch**.
7. Vérification : la section affiche maintenant **`claude/funny-bell-k7v5xf`**.

*Si vous ne trouvez vraiment pas cette section :* ne perdez pas de temps, passez à 3B. À l'étape 3C, après l'import, vous réglerez la branche directement dans Vercel
(**Settings → Environments → Production → Branch Tracking**), et dites-moi où vous en êtes.

### 3B. Créer le compte Vercel

1. Ouvrez **https://vercel.com** et cliquez sur **Sign Up**.
2. Choisissez le plan **Hobby** (personnel, gratuit) si on vous le demande, et un nom (le vôtre).
3. Cliquez sur **Continue with GitHub**, puis **Authorize Vercel**. Si Vercel demande de vérifier votre téléphone, faites-le.

### 3C. Importer le dépôt

1. Sur le tableau de bord, en haut à droite : **Add New…** puis **Project**.
2. Dans « **Import Git Repository** », trouvez **pxworld**.
   - Il n'apparaît pas ? Cliquez sur **Adjust GitHub App Permissions**, sur GitHub choisissez **Only select repositories**, ajoutez `pxworld`, **Save**, puis revenez sur Vercel.
3. Cliquez sur **Import** à droite de `pxworld`.
4. Page « **Configure Project** » :
   - **Project Name** : `pixelworld-test`
   - **Framework Preset** : doit afficher **Next.js** (automatique).
   - **Root Directory** : laissez `./`.
   - Ne touchez pas à « Build and Output Settings ».
5. **Ne cliquez pas encore sur Deploy.** Cliquez d'abord sur **Environment Variables** pour déplier la section (étape suivante).

### 3D. Remplir les variables d'environnement

Pour **chacune** des 7 lignes du tableau : cliquez dans **Key**, tapez le nom ; cliquez dans **Value**, collez la valeur depuis vos notes ; cliquez sur **Add**.
Sans guillemets, sans espace avant ou après. *(Pas encore faits à l'étape 0 : les deux secrets se génèrent dans le terminal du Codespace avec `openssl rand -hex 32`, deux fois, une valeur chacun.)*

| Key (nom exact) | Value (depuis vos notes) | **Type** |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://pixelworld-test.vercel.app` (https, **sans `/` à la fin**) | **Config** |
| `DATABASE_URL` | votre **Adresse Transaction pooler** (celle en `:6543`, avec le mot de passe) | **Secret** |
| `NEXT_PUBLIC_SUPABASE_URL` | votre **Project URL** | **Config** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | votre **clé publique** (`sb_publishable_…`) | **Config** |
| `SUPABASE_SERVICE_ROLE_KEY` | votre **clé secrète** (`sb_secret_…`) | **Secret** |
| `RATE_LIMIT_SALT` | le premier secret généré par `openssl rand -hex 32` | **Secret** |
| `CRON_SECRET` | le second secret généré | **Secret** |

**Le « Type » de chaque variable compte.** Sur Vercel, chaque variable a un **Type**, à choisir en la créant :
- **Secret** : valeur secrète, illisible une fois enregistrée. À utiliser pour les mots de passe, clés et jetons.
- **Config** : valeur ordinaire, qu'on peut relire.

Les trois variables dont le nom commence par **`NEXT_PUBLIC_`** sont envoyées à tous les navigateurs **par conception** : elles doivent être de type **Config**. Vercel refuse d'enregistrer
une variable `NEXT_PUBLIC_…` de type Secret (message rouge « Remove the public framework prefix… », bouton **Save** bloqué). Si cela vous arrive : **un Secret enregistré ne peut plus devenir Config**,
donc supprimez la variable (⋯ → **Remove**) et recréez-la en choisissant **Config**.

**Les fautes de collage les plus fréquentes** (le build échoue alors avec « Invalid environment configuration ») :
- coller **la ligne entière** `NEXT_PUBLIC_SUPABASE_URL=https://…` : dans **Value**, il ne faut que ce qui vient **après** le `=` (ici `https://xxxx.supabase.co`) ;
- mettre des **guillemets** autour de la valeur, ou laisser une **espace** ou un retour à la ligne avant ou après ;
- laisser `[YOUR-PASSWORD]` (**crochets compris**) dans l'adresse de la base au lieu du vrai mot de passe ;
- **intervertir** la clé publique et la clé secrète de Supabase.

**Vérificateur facultatif, avant de cliquer sur Deploy** (vos valeurs ne quittent pas votre Codespace) : créez un fichier `.env.production.local` (il est ignoré par git) avec vos 7 lignes
`NOM=valeur`, puis lancez la commande suivante. Elle nomme chaque variable douteuse sans jamais afficher sa valeur. **Supprimez ensuite le fichier** (`rm .env.production.local`).
```bash
npx tsx scripts/check-env.mts .env.production.local
```
Deux avertissements sont normaux tant que Stripe n'est pas configuré : `STRIPE_SECRET_KEY` et `NEXT_PUBLIC_OPERATOR_*`.

**À ne pas ajouter :** `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` (plus tard, quand Stripe sera prêt), ni `DEV_AUTH`, `STRIPE_MOCK`, `NEXT_PUBLIC_WORLD_END_AT`.

### 3E. Déployer

1. Cliquez sur **Deploy**. Vercel construit le site : 3 à 5 minutes, avec un journal qui défile.
2. Quand l'écran « **Congratulations!** » apparaît, cliquez sur **Continue to Dashboard**.
3. Si le déploiement échoue (écran rouge, « Build Failed ») : ouvrez **Build Logs**, copiez les **20 dernières lignes** et envoyez-les-moi (elles ne contiennent pas de clé).
4. **L'adresse réelle du site** : dans le tableau de bord du projet, section **Domains**, repérez l'adresse **courte** qui se termine par `.vercel.app` (par exemple `pixelworld-test.vercel.app`). Ce n'est **pas** celle avec des lettres aléatoires au milieu.
5. Si cette adresse **n'est pas exactement** celle de `NEXT_PUBLIC_SITE_URL` : **Settings → Environment Variables**, cliquez sur les trois points de `NEXT_PUBLIC_SITE_URL` → **Edit**, corrigez, **Save** ; puis **Deployments**, les trois points du dernier déploiement → **Redeploy** → **Redeploy**. Attendez 3 minutes.
6. Cliquez sur **Visit** : la carte du monde doit s'afficher (10 secondes la première fois).

### 3F. Version de Node.js

1. **Settings → General**, descendez jusqu'à **Node.js Version**.
2. Si ce n'est pas **22.x**, choisissez-le et cliquez sur **Save** (puis **Redeploy** comme en 3E point 5).

---

## Étape 4 : dire à Supabase l'adresse du site (5 min)

Sans cela, le lien de confirmation reçu par e-mail ne ramènerait pas vers votre site.

1. Dans **Supabase**, menu de gauche : **Authentication**.
2. Rubrique « Configuration » : cliquez sur **URL Configuration**.
3. **Site URL** : effacez ce qui est écrit, tapez l'adresse du site : `https://pixelworld-test.vercel.app` (celle de l'étape 3E point 4). Cliquez sur **Save changes**.
4. **Redirect URLs** : cliquez sur **Add URL**, tapez `https://pixelworld-test.vercel.app/auth/callback`, validez. Cliquez de nouveau sur **Add URL**,
   tapez `https://pixelworld-test.vercel.app/**` (avec les deux étoiles), validez. Cliquez sur **Save** si le bouton apparaît.

---

## Étape 5 : vérifier le site, sans Stripe (20 min)

1. **Le contrôle automatique.** Dans un terminal du Codespace :
   ```bash
   node scripts/smoke.mjs https://pixelworld-test.vercel.app
   ```
   Résultat attendu : `50/50 checks passed`. S'il y a des `FAIL`, copiez les lignes et envoyez-les-moi.
2. **Ouvrez le site** : la carte s'affiche. Essayez le changement de langue (anglais / français).
3. **Créez votre compte** : bouton **Sign in** → **Sign up**, avec votre vrai e-mail, un nom, un mot de passe d'au moins 10 caractères. Ouvrez l'e-mail reçu et cliquez sur le lien de
   confirmation : vous revenez sur le site, connecté. *(Le service d'e-mails gratuit de Supabase limite à quelques messages par heure : si rien n'arrive, patientez ; regardez les spams.)*
4. **Devenez administrateur.** Supabase → **SQL Editor** → **New query**, collez ceci en remplaçant l'adresse par **celle de votre compte**, puis **Run** :
   ```sql
   insert into public.admin_roles (user_id, role) select id, 'admin' from auth.users where email = 'vous@exemple.fr';
   ```
   Résultat attendu : « Success. 1 row affected » (ou similaire). Rechargez le site : le menu de votre compte doit proposer **l'administration**.
5. **Les journaux.** Vercel → votre projet → **Logs**. Cherchez `[config]` : il doit y avoir deux avertissements (`STRIPE_SECRET_KEY` absent, identité du vendeur incomplète) et **aucun `error`**.

---

## Étape 6 : ajouter Stripe, quand vous pouvez (15 min + 10 min)

1. Faites l'**étape 2** (compte Stripe, mode test, clé secrète `sk_test_…`).
2. **Vercel** → votre projet → **Settings** → **Environment Variables** : ajoutez `STRIPE_SECRET_KEY` = votre clé `sk_test_…` (**Add**).
3. **Créer le webhook** (le message que Stripe envoie au site pour dire « c'est payé »). Dans Stripe : barre de recherche → **Webhooks** (ou **Developers → Webhooks**) → **Add endpoint**
   (ou **Create an event destination**) :
   - **Endpoint URL** : `https://pixelworld-test.vercel.app/api/stripe/webhook`
   - **Events** : cochez exactement ces 8 : `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`
   - Validez. Sur la page du webhook : **Signing secret** → **Reveal** → copiez la valeur qui commence par **`whsec_`**.
4. Dans **Vercel** → **Environment Variables** : ajoutez `STRIPE_WEBHOOK_SECRET` = cette valeur (**Add**).
5. **Redeploy** (Deployments → les trois points du dernier déploiement → **Redeploy**) et attendez 3 minutes.

---

## Étape 7 : l'achat de test (20 min)

1. Sur le site, cliquez sur **Trouver ma place** / **Find your spot**, choisissez une petite parcelle **sur la terre**, ajoutez une image, acceptez les conditions, **Payer**.
2. Sur la page de Stripe, carte **`4242 4242 4242 4242`**, une date future quelconque, un code CVC quelconque, un code postal quelconque.
3. Vous revenez sur le site : la commande doit passer à **Payée**. Dans **Administration → Modération**, approuvez la création ; la parcelle apparaît sur la carte.
   Dans Stripe → **Payments** : le paiement de test apparaît, en **EUR** (vous êtes en France).
4. **Une parcelle en mer** doit être refusée (« pas sur la terre »).
5. **Le prix en dollars**, sans VPN : dans Vercel, ajoutez `TEST_COUNTRY` = `US`, **Redeploy** ; le prix s'affiche en **$**. Refaites un achat de test : Stripe doit montrer **USD**.
   Puis **supprimez la variable `TEST_COUNTRY`** et **Redeploy** (elle ne fonctionne qu'avec une clé `sk_test_`).
6. Dans les **Logs** de Vercel, cherchez `[config]` (plus aucun `error` ni avertissement Stripe), puis `[alert]` et `[csp]` : à relire de temps en temps pendant la semaine de test.

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
| Le build Vercel échoue avec « Invalid environment configuration … Invalid URL → at NEXT_PUBLIC_SUPABASE_URL » (ou `NEXT_PUBLIC_SITE_URL`) | la valeur n'est pas une adresse valide : il faut **seulement** `https://xxxx.supabase.co` (sans `NEXT_PUBLIC_SUPABASE_URL=` devant, sans guillemets, sans espace). Corrigez-la (Settings → Environment Variables → ⋯ → Edit), puis **Redeploy** |
| La page affiche une erreur « Invalid environment configuration » | une variable est mal écrite (guillemets, espace, `/` final) |
| Impossible de se connecter / le lien de l'e-mail mène à une erreur | étape 4 : l'adresse de redirection manque ou ne correspond pas |
| Le paiement réussit mais la commande reste « en attente » | étape 6 : webhook absent, mauvais événements, ou `STRIPE_WEBHOOK_SECRET` faux (puis **Redeploy**) |
| `migrate.mjs` : « password authentication failed » | le mot de passe de la base est faux (ou contient des symboles non protégés) |
| `migrate.mjs` : « ENOTFOUND » / « timeout » | prenez bien l'adresse **Session pooler** (pas « Direct connection ») |
| Rien ne s'affiche sur la carte | attendez 10 secondes (le premier chargement est plus long) ; sinon regardez **Logs** |
