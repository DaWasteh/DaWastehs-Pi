---
name: "audit-pixaroma-workflow-timers"
created: "2026-07-25"
description: "PixaromaRunTimer-Abdeckung in allen ComfyUI-Workflows dieses Repos ergänzen und statisch validieren. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Nutzen, wenn Workflows neu importiert, konsolidiert oder vor einem Release auf vollständige Pixaroma-Timer-Abdeckung geprüft werden.

## Procedure
1. Alle `workflows/**/*.json` als UTF-8 parsen und im Hauptgraphen Nodes vom Typ `PixaromaRunTimer` zählen.
2. Nur bei fehlendem Timer einen eigenständigen Root-Node ergänzen; die ID als `max(last_node_id, vorhandene numerische IDs) + 1` und `order` als `max(order) + 1` vergeben.
3. Den Timer mit leeren Inputs/Outputs, `cnr_id: ComfyUI-Pixaroma`, passendem `Node name for S&R`, den im Repo etablierten Widgets sowie dunkler Node-Farbe an einer überlappungsfreien Position außerhalb des bestehenden Graphen platzieren.
4. `last_node_id` aktualisieren und JSON im vorhandenen Format `indent=2`, UTF-8/`ensure_ascii=False` und abschließendem LF speichern.
5. README-Auditwerte für Timer-Abdeckung und Gesamtzahl der Nodes aktualisieren, falls sich die Sammlung geändert hat.
6. Vor dem Commit einen semantischen Vergleich gegen HEAD durchführen: Bei neuen Timern dürfen sich nur `last_node_id` und der angehängte Timer ändern; bestehende Timer nur gezielt normalisieren.

## Pitfalls
- Timer nur im Hauptgraphen ergänzen, nicht in jedem eingebetteten Subgraphen; pro Workflow-Datei ist exakt ein Root-Timer vorgesehen.
- ComfyUI-Root-Links sind häufig Listen, Subgraph-Links dagegen Dictionaries. Validatoren müssen beide Formate unterstützen und negative Interface-Knoten-IDs wie -10/-20 zulassen.
- Keinen gespeicherten Laufzeitwert wie `runTimerLastMs` aus einem anderen Workflow kopieren.
- JSON nicht mit anderen Separatoren oder ASCII-Escaping serialisieren, damit der Diff auf die beabsichtigten Änderungen begrenzt bleibt.

## Verification
1. Alle Workflow-Dateien lassen sich parsen und enthalten exakt einen Root-Node vom Typ `PixaromaRunTimer` mit `cnr_id: ComfyUI-Pixaroma`.
2. Node-IDs bleiben eindeutig und `last_node_id` ist mindestens die höchste numerische Root-Node-ID.
3. Alle Root- und Subgraph-Linkreferenzen bleiben vorhanden; Listen- und Dictionary-Linkformate werden geprüft.
4. `git diff --check` ist sauber und ein semantischer HEAD-Vergleich bestätigt, dass keine sonstigen Workflow-Felder verändert wurden.
