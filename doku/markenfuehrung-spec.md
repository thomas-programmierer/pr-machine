# Markenführung — verbindliche Spezifikation

Prüfreferenz für den Abnahmepunkt **G4**. Wer die Markenführung prüft, prüft
gegen dieses Dokument, **nicht gegen den Code**. Weicht der Code ab, ist der
Code falsch — es sei denn, hier steht ausdrücklich etwas anderes.

Stand: 01.09.2026 · Gilt für alle Werke der Volkshochschule Spandau

---

## 1 Grundsatz

Die Corporate Identity von DVV und VHS Spandau hat Vorrang vor eigenen
Gestaltungsideen. Vor jeder Gestaltung wird die verbindliche Regel gesucht
und angewandt, statt sie zu erfinden. Abweichungen nur nach Rückfrage und
mit Begründung im jeweiligen Werk.

## 2 Absenderkennung — genau eine je Motiv

Ein Motiv trägt **genau eine** Absenderkennung. Zwei nebeneinander sind ein
Fehler, keine Geschmacksfrage.

| Variante | Wann | Umsetzung |
|---|---|---|
| `logo` | Standard | offizielles DVV-vhs-Logo als Bilddatei, 1:1 aus dem Original |
| `fuss` | wenn der Programmbereich benannt werden soll | Schriftzug über zweiteiliger Programmbereichslinie |

Kein selbstgebautes Ersatzlogo. Quelle ist ausschließlich das offizielle
DVV-Logopaket.

## 3 Programmbereichskennung

Bezeichner klein und neutral grau über einer zweiteiligen feinen Linie:
heller Vorlauf, direkt anschließend die Programmbereichsfarbe.

Alle Werte sind **Exportpixel bezogen auf 1080 px Bildbreite** und skalieren
proportional mit der tatsächlichen Breite.

| Größe | Wert |
|---|---|
| Schriftgröße Bezeichner | 24 |
| Linienstärke | 5 |
| Länge des farbigen Teils | 12,2 % der Bildbreite |
| Überstand des hellen Vorlaufs über den Bezeichner | 30 |
| Farbe Bezeichner auf dunklem Grund | `#C8CDD3` |
| Farbe Bezeichner auf hellem Grund | `#6E7781` |

Diese Linie **ersetzt** beliebige eigene Trennlinien. Andere Akzentlinien im
Motiv gibt es nicht.

### Programmbereichsfarben

| PB | Bereich | Farbe |
|---|---|---|
| PB1 | Politik & Gesellschaft | `#EB640F` |
| PB2 | Kultur & Gestalten | `#E1000F` |
| PB3 | Gesundheit | `#AFC805` |
| PB4 | Deutsch & Integration | `#7D5AA5` |
| PB5 | Fremdsprachen | `#7D5AA5` |
| PB6 | Beruf & IT | `#64B9E6` |
| PB7 | Grundbildung | `#FAB90F` |

## 4 Kontrast auf Farbflächen

Nicht nach Gefühl entscheiden, sondern nach der Leuchtdichte der Fläche.

| Fläche | Schrift |
|---|---|
| Gelb `#FAB90F`, Grün `#AFC805`, Hellblau `#64B9E6` | VHS-Blau `#00285A` |
| Dunkelblau `#00285A`, Lila `#6B3A8C`, Rot `#E1000F`, Orange `#EB640F` | Weiß |

Für Fremdfarben (Plattformfarben in der Oberfläche) gilt derselbe Grundsatz.
Beispiel: nebenan.de „Knallgrün" `#B5D622` ist eine helle Fläche — Schrift
darauf in VHS-Blau (8,69:1), nicht weiß (1,67:1).

Text auf weißem Grund erreicht mindestens **4,5:1**. Reicht eine Markenfarbe
dafür nicht, wird eine abgedunkelte Fassung verwendet und im Code mit dem
gemessenen Wert begründet.

## 5 Lage der Kennungen im Motiv

Kennung, Programmbereichslinie und EU-KI-Symbol liegen **vollständig in der
Kernfläche** — also innerhalb der Sicherheitszone des jeweiligen Formats —
und überlappen einander nicht.

| Element | Standardplatz |
|---|---|
| Logo bzw. Schriftzug | oben links an der Kante der Kernfläche |
| Programmbereichslinie | unten links an der Kante der Kernfläche |
| EU-KI-Symbol | unten rechts an der Kante der Kernfläche |

Die Prüfung läuft **je Format**. Eine Lage, die im Hochformat sitzt, kann im
Querformat danebenliegen.

## 6 Sicherheitszonen je Format

| Format | Maß | Rand | Kernfläche |
|---|---|---|---|
| Portrait 4:5 | 1080 × 1350 | 100 rundum | 880 × 1150 |
| Quadrat | 1080 × 1080 | oben/unten 100, seitlich 135 | 810 × 880 |
| Story / Reels | 1080 × 1920 | oben 270, unten 672, seitlich 65 | 950 × 978 |
| nebenan.de | 1120 × 630 | 60 rundum | 1000 × 510 |

Die seitlichen 135 px beim Quadrat kommen vom Zuschnitt im Profilraster auf
3:4. Die 60 px bei nebenan.de entsprechen bei 1120 px Breite optisch demselben
Rand wie 100 px bei 1080 px Breite; die sonst übliche 5-Prozent-Regel ergäbe
bei 630 px Höhe nur 31 px und damit zu wenig für Logo und Kennung.

## 7 Meta-Band

Jedes Format, das im Feed von Instagram oder Facebook erscheinen soll, liegt
im Seitenverhältnis zwischen **0,800 (4:5)** und **1,910 (1,91:1)**. Metas
Content Manager weist alles andere beim Planen zurück. Story und Reels sind
davon nicht betroffen.

## 8 Schrift

DM Sans, lokal aus `public/fonts/`. Keine Schrift von einem fremden Host: Wo
Google Fonts gesperrt ist, setzt der Browser eine Ersatzschrift ein, die
Zeilen brechen anders um, und der Export weicht unbemerkt vom Entwurf ab.

## 9 Koordinatenraum

Maße werden immer in dem Koordinatensystem gemessen und angewandt, in dem
gezeichnet wird — nie an der fertigen Datei gemessen und auf ein Zwischenbild
angewandt.

## 10 Prüfschwelle

Jede Pixel-Nachbearbeitung wird an der **fertigen Datei** gegengemessen, mit
scharfer Schwelle: bei Umfärbungen höchstens 40 Restpixel der alten Farbe.
Großzügige Schwellen lassen echte Fehler durchgehen.

---

## Prüfliste G4

1. Genau eine Absenderkennung im Motiv?
2. Programmbereichslinie: 24 / 5 / 12,2 % / 30 Überstand, auf 1080 bezogen?
3. Bezeichnerfarbe passend zum Untergrund?
4. Kennung, Linie und EU-Symbol vollständig in der Kernfläche, ohne Überlappung?
5. Je Format geprüft, nicht nur im zuletzt angezeigten?
6. Schrift auf Farbfläche nach Abschnitt 4?
7. Seitenverhältnis im Meta-Band (außer Story)?
8. Am fertigen Export gemessen, nicht am Entwurf?
