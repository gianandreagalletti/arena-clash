# Arena Clash — Game Bible

Stato attuale del gioco, estratto da `src/sim/config/balance.js` e dal README del repo (2 ottobre 2026).
**Fonte di verità sui numeri: `balance.js`.** Se questo documento e il codice divergono, vince il codice: aggiornare qui.
Tutti i numeri sono valori di partenza da playtest, non bilanciamento finale.

## 1. Cos'è
Arena shooter top-down, free-for-all a 3 giocatori (stile Soul Knight), locale con gamepad/tastiera. Sim deterministica a 60 tick/s, arena 24×16 tile (mappa "Courtyard", 6 blocchi di copertura 2×1). Nessun player-vs-player collision: i giocatori si attraversano.

## 2. Flusso partita
1. Join → **boost pre-match**: ogni giocatore spende 10 punti su 4 categorie (fissi per tutto il match).
2. **Round**: countdown 3s → combattimento → l'ultimo in piedi vince il round → recap 5s.
3. **Draft** tra i round (non dopo il round che vince il match, non dopo un round annullato).
4. Primo a **3 round vinti** vince il match. Rematch: reset di tutto (boost uguali, amuleti, abilità, vittorie).
5. **Round annullato**: quando NESSUN giocatore resta vivo alla fine del tick — gli ultimi due rimasti si eliminano a vicenda nello stesso tick (il terzo era già morto), oppure tutti e tre muoiono insieme. Il round viene rigiocato, niente draft, e la carica ult NON viene dimezzata. *(Due eliminazioni nello stesso tick con un terzo ancora vivo sono invece una vittoria normale per il superstite — correzione rispetto alla bozza, verificata su `checkRoundEnd` in `src/sim/systems/round.js`: il controllo è `alive.length === 0`.)*
6. Invulnerabilità allo spawn 1.5s: il giocatore è **non bersagliabile** (proiettili lo attraversano, melee non lo seleziona).

## 3. Azioni universali (uguali per tutti)
| Azione | Numeri |
|---|---|
| Shoot | 18 danni, 2 colpi/s (cooldown 0.5s), proiettile 14 tile/s, **gittata illimitata** (vola fino a giocatore, copertura o bordo), raggio proiettile 0.12 |
| Slash | 14 danni, 2.5 colpi/s, raggio 1.5 tile, arco frontale 90°, un colpo per bersaglio per fendente |
| Shield | 2.0s attivo, danno subito −70%, cooldown 6.0s che parte quando lo scudo FINISCE. Blocca Shoot/Slash/skill mentre è su; il movimento è permesso |

Shoot e Slash hanno **cooldown indipendenti** (si possono alternare al ritmo massimo di entrambi).
DPS nominale: Shoot 36/s, Slash 35/s (solo entro 1.5 tile).
Aim assist: **disattivato** (`AIM_ASSIST_ENABLED = false`).

## 4. Personaggi
| | HP | Velocità (tile/s) | Identità |
|---|---|---|---|
| Sniper | 80 | 4.5 | Shoot override: 36 danni ogni 1.0s, proiettile 22 tile/s. DPS nominale uguale agli altri (36/s) ma in colpi pesanti: sbagliare costa. Nessuna abilità innata |
| Berserker | 140 | 5.0 | **Nova** (tasto abilità): 45 danni entro 3 tile (centro-centro), windup 0.5s durante il quale è rallentato al 50%; il danno cade UNA volta a fine windup su chi è dentro in quel momento. Costa 50 di carica ult |
| Summoner | 100 | 4.2 | **Cane**: 40 HP, morso 8 danni ogni 0.8s, portata 0.9, velocità 5.5, movimento random-walk con bias 0.5 verso il nemico più vicino. Uno solo vivo; respawn 5s dopo la morte. Il danno al cane non dà carica ult |

## 5. Boost (pre-match) e punti del draft
Bonus per punto, moltiplicativo sullo stat base:
| Categoria | Per punto | Max a 10 punti |
|---|---|---|
| HP | +4% | +40% |
| Speed | +3% | +30% |
| Shoot dmg | +3% | +30% |
| Slash dmg | +5% | +50% |

Il draft aggiunge +1 punto a una categoria **senza il limite di 10**.

## 6. Carica ult
Max 100. +1 per HP di danno inflitto, +0.5 per HP di danno subito, +20 per eliminazione. Il 50% si porta al round successivo (non su round annullato). Calcolata sul danno **dopo** la riduzione dello scudo (scudare nega anche la carica all'avversario). Oggi la usa solo la Nova del Berserker.

## 7. Pickup temporanei (si azzerano a fine round)
Spawn: primo dopo 4s dal countdown, poi ogni 6–10s, max 2 in mappa, durano 12s. Posizione casuale ad almeno 3 tile da un giocatore vivo. Raggio raccolta 0.4 tile.
| Item | Peso | Effetto |
|---|---|---|
| Medkit | 20 | +35 HP (cap al max) |
| Overcharge | 15 | Danno Shoot/Slash ×1.30 per 8s (si rinnova, non si somma) |
| Adrenaline | 15 | Velocità ×1.25 per 6s |
| Shield Battery | 15 | Azzera il cooldown dello scudo |
| Grenade | 15 | Slot item. Lancio fino a 5 tile, si ferma sulle coperture, esplode dopo 1s: 35 danni, raggio 1.5 |
| Mine | 10 | Slot item. Armata dopo 1s, scatta con raggio 0.6 su chiunque non sia il proprietario: 35 danni, raggio 1.2 |
| Cloak | 10 | 4s a bassa opacità; Shoot/Slash lo interrompono, subire danno no |

Grenade e Mine condividono **un solo slot item**. Le esplosioni **ignorano la linea di vista** (la copertura non protegge) e usano il percorso danni normale (scudo −70%, invuln spawn, cani colpiti). Un proprietario morto fa comunque esplodere granate/mine con danno a suo nome, ma non conta come kill.

## 8. Amuleti (permanenti per il match, cumulativi, nessun cap)
Spawn: primo dopo 15s, poi ogni 20–30s, max 1 in mappa, 7 tipi equiprobabili. Casuali: premiano il controllo mappa, non chi ha vinto.
| Amuleto | Per copia |
|---|---|
| Speed | +5% velocità |
| Vitality | +8% HP max (la HP corrente sale dello stesso delta, non è una cura piena) |
| Blade | +6% danno Slash |
| Marksman | +6% danno Shoot |
| Ward | −1.0s cooldown scudo, minimo 2.0s |
| Fury | +8% carica ult da ogni fonte |
| Hunter | +0.3 tile raggio raccolta |

## 9. Composizione dei moltiplicatori
Fattori **separati e moltiplicati** tra loro; i duplicati dello stesso amuleto si **sommano**.
```
shootDmg = base × (1 + 0.03·boostPts) × (1 + 0.06·nMarksman) × (overcharge ? 1.30 : 1)
speed    = base × (1 + 0.03·boostPts) × (1 + 0.05·nSpeed)    × (adrenaline ? 1.25 : 1)
maxHp    = base × (1 + 0.04·boostPts) × (1 + 0.08·nVitality)
shieldCd = max(2.0s, 6.0s − 1.0s·nWard)
slashDmg = base × boost × amuletBlade × overcharge × greatsword
```
Gli amuleti NON influenzano i numeri specifici di personaggio (cane, nova, override Sniper) né le abilità.

## 10. Draft tra i round
- Ogni giocatore prende **+1 punto stat** e **1 abilità su 3 offerte** (dal pool del proprio personaggio, escluse quelle già possedute). Entrambe obbligatorie.
- Ordine di scelta: **vincitore per primo, primo eliminato per ultimo** (i perdenti reagiscono alle scelte altrui). Parità: indice giocatore più basso per primo.
- Le offerte di tutti sono visibili dall'inizio. Timer 20s a turno; al timeout: punto su HP + prima offerta (saltata se attiva e slot pieni).
- Pool da 5 abilità per personaggio. **Passive**: illimitate. **Attive**: 2 slot (Skill 1 su LT/click destro, Skill 2 su R3/Spazio); con slot pieni si sceglie quale rimpiazzare, e l'abilità sostituita torna nel pool.
- Cooldown azzerati e summon/trappole eliminati a ogni round.

### Abilità Summoner
| ID | Tipo | Effetto |
|---|---|---|
| Viper | attiva, cd 14s | Serpente: 25 HP, vive 10s, vel 5.0, morso 4 danni/1.0s, portata 0.8, veleno 3 dps per 3s (si rinnova, non si somma). Max 1, coesiste col cane |
| Thorn Trap | attiva, cd 12s | Trappola: arma in 0.5s, raggio 1.0, 5 danni all'ingresso, rallenta ×0.6 dentro, dura 8s |
| Alpha Dog | passiva | HP cane ×1.4, morso ×1.25 |
| Bone Meal | passiva | Quando il cane morde, cura il Summoner del 30% del danno inflitto |
| Pack Leader | passiva | Respawn del cane ×0.6 |

### Abilità Berserker
| ID | Tipo | Effetto |
|---|---|---|
| Longsword | passiva | Raggio Slash +0.5 tile |
| Greatsword | passiva | Danno Slash ×1.25, frequenza ×0.8. Si somma a Longsword se entrambe |
| Charge | attiva, cd 8s | Scatto 4 tile in 0.25s, 20 danni a ogni nemico attraversato (una volta), si ferma su coperture/bordi |
| Whirlwind | attiva, cd 10s | Slash 360° al raggio corrente, 20 danni a ogni nemico in portata |
| Bloodthirst | passiva | Cura il 20% del danno Slash inflitto (dopo scudo) |

### Abilità Sniper
| ID | Tipo | Effetto |
|---|---|---|
| Vanish | attiva, cd 15s | Invisibile 3s (regole Cloak: Shoot/Slash lo interrompono, danno no) |
| Roll | attiva, cd 5s | Scatto 2.5 tile in 0.2s, **invulnerabile** durante lo scatto |
| Charged Shot | attiva (tenere premuto), cd 6s | Carica fino a 1.0s, velocità ×0.5 mentre carica, non può sparare; il colpo fa danno × da 1.0 a 2.2 in base alla carica. Annullato (senza cooldown) se usa lo scudo |
| Piercing Rounds | passiva | I proiettili trapassano il primo bersaglio; il secondo prende ×0.7. La copertura li ferma |
| Focus | passiva | Gittata Shoot +3 tile, velocità proiettile ×1.2 |

## 11. Log di fine round (materia prima per il bilanciamento)
Per giocatore: boost, punti stat, danno inflitto/subito, eliminazioni, tick di morte, pickup raccolti, item usati, amuleti, loadout (slot e passive), `damageByAbility` (abilità che fanno danno) e `abilityUses` (abilità che non ne fanno). Per round: ordine di scelta, offerte, scelte, timeout, slot rimpiazzati.

## 12. Strumenti
- `tools/balance-sim.js`: simula match bot-vs-bot-vs-bot nella sim pura. Uso: `node tools/balance-sim.js --matches=300 --seed=1000 --boosts=zero|random --json=out.json`. Riporta win-rate per personaggio e statistiche di combattimento. **Verificato eseguendolo** (correzione rispetto alla bozza, che lasciava il punto aperto): i bot *attraversano* il draft — non impostano mai `draftPick`, quindi ogni turno va in timeout dopo i suoi 20s pieni, e i pick di default (punto in HP + prima offerta) vengono comunque applicati — ma non usano **mai** le abilità attive in combattimento (nessun `skill1`/`skill2` nella logica bot). I tre timeout di draft da 20s per round transition (60s simulati) fanno sì che il `--maxTicks` di default (18000 tick = 5 minuti) sia spesso insufficiente a completare un match intero: 2 match su 2 testati con i default sono finiti in `TIMEOUT` dopo 4 round, mentre lo stesso seed completa in 6 round con `--maxTicks=90000`. Da tenere a mente leggendo i suoi report: con i default, i match lunghi vengono scartati a metà e le statistiche includono round "in corso".
- `npm test`: suite offline `node:test` (determinismo, danni, scudo, boost, identità dei personaggi, pickup, round, ecc.).

## 13. Regole di architettura (vincoli per ogni idea nuova)
- Tutta la logica in `src/sim/`, pura: niente Phaser/DOM/`window`/`Math.random`. RNG solo quello seedato nello stato.
- **Ogni numero in `balance.js`**, convertito in tick una sola volta al caricamento. Niente numeri magici nella logica, nel render o nel testo dell'Help.
- Il render legge lo stato e non lo muta. L'Help screen legge i numeri da `balance.js`; ogni nuovo pickup/abilità richiede una voce in `helpContent.js`.
- Gli input entrano nella sim solo tramite InputFrame (così le partite sono rigiocabili).
- Ogni nuova meccanica richiede test, icona/texture con chiave nel contratto esistente, voce di log.

## 14. Punti noti da tenere d'occhio (dal README e dalla lettura dei numeri)
- **Time-to-kill lungo**: 8 colpi Shoot (~3.5s di fuoco continuo) per uccidere un Berserker senza boost; con scudo 2s/−70% ogni 8s i round possono durare molto rispetto al target di 3–5 minuti di match.
- **Scudo**: 25% di uptime con riduzione 70% è il numero più probabile da ritoccare. Blocca anche le proprie azioni, quindi si autobilancia in parte.
- **Slash +5%/punto** è la categoria più forte per punto e HP è +4%: le scelte potrebbero non essere equivalenti.
- **Focus (Sniper)** dà +3 tile di gittata, ma la gittata dello Shoot è illimitata (`rangeTiles: null`): quella parte dell'abilità oggi non ha effetto, resta solo ×1.2 sulla velocità del proiettile.
- **Esplosioni ignorano la copertura** (TODO nel codice).
- **Due convenzioni di raggio**: la Nova usa centro-centro, granate/mine usano sovrapposizione del corpo (`dist ≤ raggio + raggio bersaglio`).
- Un proprietario morto fa danno con mine/granate ma non ottiene la kill.
- Il Sniper non ha identità attiva innata: la sua forza dipende dal draft (Roll, Vanish, Charged Shot).
- Scudo e Charged Shot: lo scudo annulla la carica; il Sniper non può sparare mentre carica.
- Il gioco ha 3 personaggi fissi: non c'è ancora selezione personaggio in-game (parametri URL `?p1=sniper&p2=berserker&p3=summoner`).
- **`tools/balance-sim.js` sottovaluta chi beneficia di più dal draft**: i bot non scelgono mai attivamente (ogni turno va in timeout) e non usano mai le abilità attive drafted, quindi i numeri che produce riflettono solo le passive prese di default più i boost — non il valore reale di Charge, Whirlwind, Charged Shot, Viper, ecc. Vedi §12.
