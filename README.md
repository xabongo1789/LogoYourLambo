# LogoYourLambo : STL réel et positions partagées

Le studio charge `lambo+H.stl` (500 000 triangles), avec carrosserie blanche et vitres grisées. Les logos sont projetés sur ce maillage. Les images PNG sont stockées dans **Supabase Storage** ; les positions sont enregistrées dans **PostgreSQL**, avec une contrainte anti-chevauchement.

## Démarrage

Node.js 20 minimum. Aucune dépendance npm à installer pour le build et les tests.

```sh
npm run check
npm run dev
```

Ouvrir `http://127.0.0.1:8000`. Sans configuration Supabase, la 3D fonctionne en mode local et aucune sauvegarde partagée n'est annoncée comme réussie.

**Publier le dossier `dist/`, pas le HTML source.** `HURACAN-500-v2.html` est conservé comme template. Le build retire le GLB embarqué et injecte les extensions avant l'initialisation du studio. Il produit `dist/index.html` et `dist/HURACAN-500-v2.html`, accompagnés du STL, du profil et des modules. Le build refuse les changements incompatibles du template. Le double-clic `file://` ne fonctionne pas : utiliser HTTP.

## Configuration Supabase

1. Appliquer une fois `supabase/migrations/202609080001_shared_logo_placements.sql` au projet, via le SQL Editor ou les migrations Supabase. Elle crée tables, bucket `company-logos`, RLS, RPC et publication Realtime. Ne jamais exécuter les fichiers `tests/database-*.sql` dans ce projet : ce sont des schémas factices pour la CI.
2. Activer la connexion email dans Supabase Auth, configurer l'envoi d'emails et autoriser les URL de retour exactes de l'application (local et domaine HTTPS de production). Le lien PKCE doit être ouvert dans le même navigateur que la demande. Une adresse vérifiée est requise pour sauvegarder.
3. Copier `.env.example` vers `.env`, renseigner `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`, puis reconstruire. Sur l'hébergeur, utiliser ces mêmes variables d'environnement. `HURACAN_VEHICLE_ID` vaut `huracan-stl-v1` et doit correspondre à une entrée de `logo_vehicles`.

```sh
cp .env.example .env
# Compléter l'URL et la clé publique dans .env, puis :
npm run build
```

**Ne jamais exposer une clé `service_role` ou `sb_secret_`.** Le build les refuse. `config.js` est public : la sécurité repose sur les politiques SQL et les RPC. Le SDK navigateur est épinglé à `@supabase/supabase-js@2.57.4` via jsDelivr. Le CDN doit être accessible pour le partage ; le rendu STL ne dépend pas de ce CDN.

`vercel.json` configure la publication de `dist/`. Aucune migration, création de projet Supabase ou mise en production n'est effectuée automatiquement.

## Utilisation

Les visiteurs voient les placements des autres entreprises sans connexion. Après connexion, importer un logo, choisir une surface libre, puis enregistrer explicitement depuis la proposition. La marque, le PNG et les coordonnées deviennent publics. L'email reste dans Supabase Auth, pas dans la table publique. L'identifiant technique du propriétaire est public ; la session de connexion est conservée sur l'appareil.

Un compte dispose d'une position par véhicule. **Reprendre ma position** restaure la zone, la cellule, la taille et la rotation exactes. **Supprimer ma position** libère les cellules. Le bouton de retrait du logo dans le configurateur retire seulement le brouillon local : il ne supprime pas le placement partagé. Les positions approuvées ou payées nécessitent l'intervention de l'opérateur.

L'inventaire est actualisé au chargement, via Realtime, toutes les 30 secondes lorsque la page est visible, au retour sur la page et à la reconnexion réseau. Une image qui ne charge pas ne libère pas sa position. Une panne d'inventaire conserve le dernier état et suspend la sauvegarde.

## Protection contre les chevauchements

La grille canonique est de 20 colonnes par 10 lignes, pour chacune des dix zones. La zone, les coordonnées, l'emprise, la rotation, le véhicule/calibration et la révision sont persistés, jamais les pixels écran. Les positions 3D sont recalculées sur le même STL.

Le glisser-déposer refuse les collisions. Le clavier, le curseur de taille et la rotation reviennent à la dernière configuration valide si leur emprise devient occupée. Les vitres et les trous détectés sur le maillage sont exclus côté configurateur.

La contrainte d'exclusion PostgreSQL `logo_placements_no_overlap` interdit les intersections sur un même véhicule et une même zone, **même en présence de deux requêtes simultanées**. Deux bords peuvent se toucher. La révision attendue empêche d'écraser une modification d'un autre onglet. La base contrôle les limites de grille et les collisions ; le contrôle géométrique fin de la carrosserie est côté client, pas un contrôle CAD côté serveur.

Les écritures passent exclusivement par les RPC, qui vérifient le propriétaire, l'adresse vérifiée et le chemin de son image. Le prix est calculé par la base ; le client ne peut pas se déclarer payé ou approuvé. Les nouvelles positions `pending/unpaid` sont visibles, mais **ne contribuent pas au montant collecté**. Le blocage technique des cellules n'est ni un paiement ni une validation commerciale.

Les PNG sont immuables, limités à 2 Mo, sous `<auth.uid()>/<uuid>.png`. Les politiques empêchent de supprimer un fichier encore référencé. Le nettoyage des anciennes versions est effectué après succès et au mieux. Un arrêt brutal peut laisser un fichier orphelin : prévoir un nettoyage périodique serveur, uniquement après vérification d'absence de référence et délai de grâce.

## Modèle, couleurs et calibration

Le vrai STL a été inspecté et réorienté : axe source Y longitudinal, Z vertical, avant vers Y négatif et correction de lacet de -13,32654°. `model-profile.json` contient cette orientation, les masques de vitrage et la calibration des zones. Le maillage est préparé dans un worker ; les surfaces publicitaires sont projetées sur les triangles extérieurs puis subdivisées. Le capot et les ailes avant sont recalibrés pour ce modèle, pas laissés sur les anciennes surfaces planes du GLB.

Le STL ne fournit pas de noms de matériaux exploitables pour identifier les vitres : leur teinte repose sur des **masques géométriques ajustables**, non une segmentation CAD certifiée. Les contours peuvent rester approximatifs. Le toit et la carrosserie restent blancs. Les dimensions de devis historiques sont conservées comme indicatives, pas comme gabarit de fabrication. Vérifier les droits d'utilisation du STL avant publication.

Après une modification du STL ou de sa calibration, créer un **nouvel identifiant de véhicule** et revalider les positions ; ne pas déplacer silencieusement les logos existants. Sans WebGL2, l'aperçu logiciel est volontairement allégé ; les positions utilisent néanmoins le maillage complet.

## Vérification

```sh
npm run check
npm run build
node scripts/verify-model.mjs
```

Les tests Node couvrent STL binaire/ASCII, fichiers invalides, orientation, vitrage, projection, trous, collisions, rotations, interactions, révisions et secrets. La vérification du vrai STL compte les matériaux et les surfaces disponibles. Le workflow GitHub teste aussi la migration, les droits et deux écritures concurrentes dans **PostgreSQL 16 isolé**, avec des schémas Auth/Storage de test. Cela ne remplace pas un essai des emails Auth, du SDK, du stockage HTTP et de Realtime sur le vrai projet Supabase.

La CI fournit `dist/` en artefact. Elle ne déploie pas le site et ne touche pas à une base distante. Avant lancement, vérifier dans deux sessions navigateur : sauvegarde/rechargement de deux marques, collision simultanée, restauration/suppression par propriétaire, panne réseau, cinq vues de la voiture, puis conditions commerciales et politique de conservation.
