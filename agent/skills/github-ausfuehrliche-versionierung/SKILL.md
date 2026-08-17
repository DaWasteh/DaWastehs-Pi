---
name: "github-ausfuehrliche-versionierung"
description: "Erstellt prüfbare, ausführliche Git-Commit-, Release- und Tag-Beschreibungen. Nur bei ausdrücklich gewünschtem Commit, Tag, Release oder Push verwenden; nicht für normale Edits, Reviews oder automatische Zwischenstände."
version: 2
created: "2026-07-24"
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Manuell laden, wenn der Nutzer einen Commit, Versions-Commit, Tag, Release oder Push beauftragt. Expliziter Releaseumfang, Repository-Konventionen und tatsächlicher Diff haben Vorrang vor diesem Format.

## Procedure
1. Vor einem Commit Status, vollständigen staged/unstaged Diff und relevante letzte Commits prüfen. Keine Änderung erfinden.
2. Unabhängige Änderungen möglichst trennen; zusammengehörige Änderungen nach Wirkung gruppieren.
3. Eine kurze, konkrete Betreffzeile und – wenn der Diff es rechtfertigt – einen Body mit einzeln lesbaren Änderungen schreiben.
4. Für Versions-Commits `vX.Y.Z Kurze Zusammenfassung` verwenden und konkrete Kategorien wie Feature, Bugfix, Sicherheit, Tests oder Dokumentation aufführen.
5. Ursache beziehungsweise Anlass und Nutzerwirkung nennen; Dateinamen allein sind keine ausreichende Beschreibung.
6. Commit-Nachricht über mehrere `-m`-Argumente oder eine Message-Datei verlustfrei erstellen.
7. Nur die für den Releaseumfang vorgesehenen Prüfungen ausführen. Fehlgeschlagene oder nicht ausgeführte Checks ehrlich ausweisen.
8. Nach dem Commit `git show -s --format=fuller HEAD` prüfen. Tag und Push nur innerhalb der ausdrücklich freigegebenen Grenzen ausführen.

## Pitfalls
- Keine generischen Nachrichten wie `updates`, `misc` oder nur eine Versionsnummer.
- Ausführlich bedeutet vollständig, nicht redundant.
- Keine Versionsnummer, Tags, Releases, Force-Pushes oder Branch-Überschreibungen ohne Auftrag.
- Keine Tokens, Zugangsdaten oder unnötig sensible Interna in Commit-Nachrichten.
- Bestehende fremde Änderungen nicht versehentlich stagen.

## Verification
1. `git diff --cached` stimmt mit Betreff und Body überein.
2. Vorgesehene Checks sind grün oder ihr Status ist ausdrücklich dokumentiert.
3. `git show -s --format=fuller HEAD` enthält die erwartete mehrzeilige Nachricht.
4. Nach einem autorisierten Push zeigen lokaler Branch, Remote und gegebenenfalls der dereferenzierte Tag auf den beabsichtigten Commit.
