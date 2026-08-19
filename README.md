# Archives du Courant — Créateur de listes

## Architecture

- `listes.html` : interface du générateur.
- `js/generator.js` : moteur du générateur.
- `data/supplements.json` : catalogue des suppléments disponibles.
- `data/supplements/*.json` : règles et contraintes propres à chaque supplément.
- `data/armees/*.json` : données des armées génériques (unités, profils, règles).

## Plusieurs armées pour un même supplément

Un supplément utilise maintenant le champ `armies`, qui est toujours un tableau :

```json
"armies": ["elfes-noirs"]
```

ou, pour un supplément commun à plusieurs armées :

```json
"armies": ["elfes-noirs", "hauts-elfes", "elfes-sylvains"]
```

Lorsque plusieurs armées sont définies, le générateur affiche automatiquement un sélecteur d’armée et charge le fichier correspondant dans `data/armees/`.

Le générateur conserve une compatibilité de lecture avec l’ancien champ `army`, mais les nouveaux fichiers doivent utiliser `armies`.

## Important

Le fichier `data/armees/elfes-noirs.json` présent dans cette archive est volontairement un modèle vide : l’archive fournie ne contenait pas les données de l’armée générique des Elfes Noirs. Il faut y placer les statistiques et règles françaises de ton fichier source.

## Hébergement

Le générateur utilise `fetch()` pour charger les JSON. Il doit donc être hébergé (par exemple GitHub Pages) et ne fonctionnera pas correctement en ouvrant simplement `listes.html` en `file://`.
