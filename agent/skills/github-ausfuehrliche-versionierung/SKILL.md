---
name: "github-ausfuehrliche-versionierung"
description: "Erstellt prüfbare, ausführliche Git-Commit-, Release- und Tag-Beschreibungen. Nur bei ausdrücklich gewünschtem Commit, Tag, Release oder Push verwenden; nicht für normale Edits, Reviews oder automatische Zwischenstände."
version: 3
created: "2026-07-24"
updated: "2026-08-30"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Manuell laden, wenn der Nutzer einen Commit, Versions-Commit, Tag, Release oder Push beauftragt. Expliziter Releaseumfang, Repository-Konventionen und tatsächlicher Diff haben Vorrang vor diesem Format.

## Procedure
1. Vor einem Commit Status, vollständigen staged/unstaged Diff und relevante letzte Commits prüfen. Keine Änderung erfinden und fremde Änderungen nicht versehentlich stagen.
2. Unabhängige Änderungen möglichst trennen; zusammengehörige Änderungen nach Wirkung gruppieren.
3. Für jede materielle Änderung Ursache und Nutzerwirkung bestimmen. Dateinamen oder pauschale Formeln wie „updates“ reichen nicht.
4. Bei Versions-Commits oder mehreren materiellen Änderungen eine konkrete Betreffzeile **und einen mehrzeiligen Body** verwenden. Jede materielle Änderung erhält eine separat lesbare Listenzeile, etwa unter Feature, Bugfix, Sicherheit, Tests oder Dokumentation.
5. Nur ein wirklich winziger Commit mit genau einer klaren Änderung darf einzeilig bleiben. Ein Versions- oder Sammelcommit ist nicht automatisch winzig.
6. Commit-Nachrichten über mehrere `-m`-Argumente oder eine Message-Datei verlustfrei erstellen.
7. Nur die für den Releaseumfang vorgesehenen Prüfungen ausführen. Fehlgeschlagene oder nicht ausgeführte Checks ehrlich ausweisen.
8. Nach dem Commit `git show -s --format=fuller HEAD` prüfen: Betreff und erwarteter mehrzeiliger Body müssen erhalten sein. Tag und Push nur innerhalb der ausdrücklich freigegebenen Grenzen ausführen.

## Pitfalls
- Keine generischen Nachrichten wie `updates`, `misc` oder nur eine Versionsnummer.
- Ausführlich bedeutet vollständig und konkret, nicht redundant oder spekulativ.
- Keine Versionsnummer, Tags, Releases, Force-Pushes oder Branch-Überschreibungen ohne Auftrag.
- Keine Tokens, Zugangsdaten oder unnötig sensible Interna in Commit-Nachrichten.

## Verification
1. `git diff --cached` stimmt mit Betreff und Body überein.
2. Bei Multi-Change- oder Versions-Commits beschreibt der Body jede materielle Änderung separat.
3. Vorgesehene Checks sind grün oder ihr Status ist ausdrücklich dokumentiert.
4. `git show -s --format=fuller HEAD` enthält die erwartete mehrzeilige Nachricht.
5. Nach einem autorisierten Push zeigen lokaler Branch, Remote und gegebenenfalls der dereferenzierte Tag auf den beabsichtigten Commit.
