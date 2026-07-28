---
name: "github-ausfuehrliche-versionierung"
description: "Erstellt aussagekräftige GitHub-Commits, Versions-Commits, Tags und Pushes mit einer direkt lesbaren, vollständigen Änderungsbeschreibung statt knapper Einzeiler."
version: 1
created: "2026-07-24"
updated: "2026-07-24"
---
## When to Use
Bei jedem Git-Commit, Versions-Commit, Release, Tag oder Push, insbesondere wenn mehrere Bugfixes, Features, Refactorings oder sonstige Änderungen zusammengefasst werden. Der Skill gilt unabhängig vom Repository. Er soll verhindern, dass relevante Änderungen nur mit einem generischen Einzeiler wie „update“, „bugfixes“ oder „v1.0.3“ dokumentiert werden.

## Procedure
1. Vor dem Commit immer `git status`, den vollständigen staged/unstaged Diff und bei Bedarf die letzten Commits prüfen. Die Beschreibung muss auf den tatsächlich enthaltenen Änderungen basieren; nichts erfinden.
2. Zusammengehörige Änderungen sinnvoll gruppieren. Wenn unabhängige Änderungen vorliegen, nach Möglichkeit mehrere klar abgegrenzte Commits statt eines Sammel-Commits erstellen.
3. Für normale Commits eine kurze, präzise Betreffzeile schreiben. Danach eine Leerzeile und einen ausführlichen Body mit Aufzählung aller wesentlichen Änderungen ergänzen.
4. Für Versions- oder Release-Commits dieses Grundformat verwenden: `vX.Y.Z Kurze Zusammenfassung:`; danach pro Änderung eine eigene Listenzeile, zum Beispiel `- Bugfix: …`, `- Neues Feature: …`, `- Verbesserung: …`, `- Refactoring: …`, `- Dokumentation: …`, `- Tests: …` oder `- Breaking Change: …`.
5. Jede Listenzeile konkret formulieren: betroffene Komponente nennen, vorheriges Problem beziehungsweise Anlass beschreiben und die Wirkung der Änderung deutlich machen. Nicht nur Dateinamen oder interne Implementierungsdetails aufzählen.
6. Wenn eine Kategorie mehrere Änderungen enthält, diese einzeln aufführen. Formulierungen wie „mehrere Bugfixes“, „diverse Anpassungen“ oder „Code aktualisiert“ sind nur als Zusammenfassung zulässig und müssen anschließend konkret aufgeschlüsselt werden.
7. Vor dem Commit prüfen, dass die Nachricht alle wesentlichen Änderungen aus dem Diff abdeckt, keine nicht enthaltenen Änderungen behauptet und direkt verständlich ist, ohne den Code öffnen zu müssen.
8. Den mehrzeiligen Commit so erstellen, dass Betreff und Body erhalten bleiben, beispielsweise mit mehreren `-m`-Argumenten oder einer Commit-Message-Datei. Keine ausführliche Beschreibung durch Shell-Quoting oder Zeilenumbruchfehler verlieren.
9. Vor dem Push Tests, Linting oder andere im Repository vorgesehene Prüfungen ausführen. Bei fehlgeschlagenen Prüfungen nicht als erfolgreich abgeschlossen darstellen und nicht ohne ausdrückliche Freigabe pushen.
10. Nach dem Commit die finale Nachricht mit `git show -s --format=fuller HEAD` kontrollieren. Erst danach den gewünschten Branch und gegebenenfalls den ausdrücklich angeforderten Tag pushen.
11. In der Abschlussmeldung Commit-Hash, Branch, Push-Ziel und eine kompakte Übersicht der dokumentierten Änderungen nennen. Falls kein Push möglich war, den Grund klar angeben.

## Pitfalls
- Keine generischen Einzeiler wie `fix bugs`, `updates`, `misc changes` oder nur eine Versionsnummer verwenden.
- Nicht automatisch Versionsnummern erhöhen, Tags erstellen, Releases veröffentlichen, Force-Pushes ausführen oder Branches überschreiben, sofern dies nicht ausdrücklich beauftragt oder durch den etablierten Repository-Workflow vorgegeben ist.
- Keine vertraulichen Daten, Tokens, Zugangsdaten oder unnötig sensible interne Informationen in Commit-Nachrichten aufnehmen.
- Die Beschreibung nicht künstlich aufblasen: ausführlich bedeutet vollständig und konkret, nicht redundant oder spekulativ.
- Nicht behaupten, Tests seien erfolgreich, wenn sie nicht ausgeführt wurden oder fehlgeschlagen sind.
- Bei einem Commit mit nur einer kleinen Änderung darf die Nachricht kürzer sein, muss aber weiterhin Ursache und Wirkung verständlich benennen; ein bedeutungsloser Einzeiler bleibt unzulässig.

## Verification
1. `git diff --cached` stimmt vollständig mit Betreff und Body der Commit-Nachricht überein.
2. Die Nachricht enthält für jede wesentliche Änderung eine konkrete, separat lesbare Beschreibung.
3. `git show -s --format=fuller HEAD` zeigt die erwartete mehrzeilige Nachricht ohne Formatierungsverlust.
4. Die vorgesehenen Repository-Prüfungen sind erfolgreich oder ihr nicht ausgeführter/fehlgeschlagener Status wurde ausdrücklich genannt.
5. `git status` und gegebenenfalls die Remote-Anzeige bestätigen, dass der richtige Commit beziehungsweise Tag auf den richtigen Branch und Remote gepusht wurde.