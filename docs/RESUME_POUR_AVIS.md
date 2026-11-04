# Pixel World — résumé à coller à une autre IA pour avoir son avis

> Texte autonome (ne contient aucun secret). À coller tel quel, suivi de vos questions, ou des questions proposées en fin de texte.

## Le produit

**Pixel World** est une carte du monde collaborative (« Une planète. Un milliard de pixels. Votre empreinte. »). La carte est une grille de
**40 000 × 25 000 = 1 milliard de pixels**, dont environ **308 millions sont de la terre** : seule la terre est à vendre, la mer ne s'achète pas.
Un visiteur achète une **parcelle rectangulaire** (de 25 pixels minimum, 5 × 5), y dépose **sa création** (une image, ou un dessin fait dans
l'éditeur intégré : pinceau jusqu'au dixième de pixel, texte, couleurs multiples) et obtient une page permanente partageable. Les pixels
achetés sont définitivement à lui. Un visiteur peut aussi inviter d'autres personnes à dessiner sur sa parcelle (lien public, sans compte).

## Le prix

**0,25 € le pixel dans la zone euro, 0,25 $ ailleurs (terre comme eau)** (la devise est choisie par le serveur d'après le pays du visiteur). Une
parcelle côtière peut contenir de la mer (offerte) mais doit être à moitié de la terre au moins. Paiement unique, pas d'abonnement.

## Comment ça marche techniquement

- **Next.js 16** (React 19, TypeScript), **PostgreSQL** (Supabase) pour les données et les comptes, **Stripe Checkout** pour le paiement,
  hébergement **Vercel**. Interface en français et en anglais. Une carte dessinée en **Canvas 2D** avec des tuiles géographiques pré-calculées.
- **Intégrité :** deux parcelles ne peuvent jamais se chevaucher (contrainte d'exclusion PostgreSQL + verrous). Le **prix est toujours calculé
  par le serveur** ; le navigateur ne fait qu'afficher une estimation. Les pixels sont **réservés 35 minutes** pendant le paiement.
- **Paiement :** une parcelle n'est attribuée que lorsque le **webhook Stripe signé** le confirme (jamais sur la simple page de retour). Si
  quelqu'un paie pour des pixels devenus indisponibles, il est **remboursé automatiquement**. Remboursements et litiges sont gérés.
- **Comptes et modération :** compte obligatoire pour acheter. **Toute création est relue par un humain avant publication** (modérateurs et
  administrateurs, journal d'audit non modifiable). Commentaires, signalements, galerie « Découvrir », aperçus de partage sur les réseaux.
- **Sécurité :** limites de débit, contrôle d'origine, images ré-encodées, politique de sécurité du navigateur, alertes sur les échecs de paiement.
- **Chiffres réels uniquement :** aucun compteur, utilisateur ou transaction fictif.
- Environ **460 tests automatiques** (unitaires et base de données) et **170 tests de bout en bout** passent.

## L'histoire « 100 jours pour sauver le monde » (optionnelle, éteinte tant qu'une date n'est pas fixée)

Un compte à rebours de 100 jours annonce la **« suppression du monde numérique »**. Au fur et à mesure, la terre non achetée se **corrompt** (style
« glitch » : lavande, cyan, magenta). À zéro, une séquence finale efface tout (un flash, une secousse, un balayage de 12 secondes qui détruit aussi
tous les noms de pays et de villes) : **seules les parcelles achetées survivent**, intactes. Après zéro : **plus aucun achat**, un bouton
« Rejouer la destruction », un bouton « Partager », et l'image de partage change selon l'état (normal, compte à rebours, fin du monde avec le nombre
réel de survivants). C'est une **fiction** assumée, signalée comme telle sur le site.

## État actuel

Le site est prêt pour un **déploiement de test** (paiements Stripe en mode test, aucun vrai paiement). Les **textes légaux sont des brouillons**
à faire relire par un juriste. Rien n'est en ligne publiquement. Décisions encore ouvertes : la date de fin, l'identité du vendeur, la modération
(qui relit, sous quel délai), le nom de domaine, et ce que devient le site après la fin du compte à rebours.

## Questions que vous pouvez poser

1. **Modèle économique :** le prix de 0,25 € (ou 0,25 $) le pixel est-il crédible pour un million de petites parcelles ? Que faire pour les premiers acheteurs
   (rareté, emplacements, effet de preuve sociale) ? Comparaison avec la « Million Dollar Homepage » et d'autres projets du même genre.
2. **Droit et conformité (UE) :** vente de contenu numérique (droit de rétractation, consentement à l'exécution immédiate), TVA/OSS, conditions de vente,
   responsabilité sur les contenus publiés par les acheteurs (droits d'auteur, contenus illicites), RGPD. Que faut-il absolument faire valider ?
3. **Risque de l'histoire de la « fin du monde » :** fiction clairement signalée ou risque de confusion, de réclamations ou de mauvaise presse ? Fermer
   les achats à zéro est-il une bonne idée, et que proposer ensuite (musée, galerie, événements, nouvelle saison) ?
4. **Modération :** comment tenir une relecture humaine de chaque création si le succès est important ? Où automatiser sans perdre le contrôle ?
5. **Technique :** points faibles d'architecture, de sécurité ou de montée en charge ; ce qui casserait en premier avec 100 000 visiteurs en un jour.
6. **Produit :** ce qui manque pour donner envie d'acheter, d'inviter, de revenir ; ce qui est superflu.
