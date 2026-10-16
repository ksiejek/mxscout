# MxScout & Claude — a guide for the team · przewodnik dla zespołu

**[English](#english)** · **[Polski](#polski)**

---

<a id="english"></a>

## English

### 1. What this is

Three things work together. You can use all of them, or only Claude.

- **`mxscout/`** is a folder inside the Mendix project, committed with the app.
  It holds the documentation of the application, written for people and for
  AI: what the app is for, its processes, its modules, every microflow in a
  sentence or two, the risks (P1–P3), and notes for developers. It also says
  which version of the app (which git commit) the documentation describes.
- **The Claude skills** come with the repository, in `.claude/skills/`. Open
  Claude Code in the project and they are there, with nothing to install:
  - **mendix-describe** writes and updates the documentation and answers
    questions about how the app works.
  - **mendix-assist** is your help with tickets, Jira issues, ideas and
    larger pieces of work (the workbook), checked against the app's model —
    and it writes down what you ask it to note on any of them.
- **MxScout** is a local app (a small program on your own machine plus your
  browser) for reading the model: entities, flows drawn as in Studio Pro,
  pages, security per role, risks, and the documentation. **You do not need it
  to work with Claude.** It is for those who want to see things, and for the
  person who sets the project up.

Nothing here connects anywhere. MxScout never runs git and never talks to a
server; you commit, pull and push yourself, as always.

**Where to find this guide.** In the project, as `mxscout/GUIDE.html` (open it
in a browser; English and Polish) beside `mxscout/GUIDE.md`. In MxScout, under
**Help → Team guide** at the foot of the sidebar. And in the MxScout repository, as
`public/guide-team.html` — [download it from GitHub](https://github.com/ksiejek/mxscout/blob/main/public/guide-team.html)
("Download raw file") and open it; it needs no network.

### 2. Which way do I work?

| You have… | You work like this |
|---|---|
| The app's git repository and Claude Code | **Claude only** (section 5). Pull, open Claude Code in the project, ask. |
| The repository, Claude and MxScout | **Claude + MxScout** (section 6). The same, plus the screens. |
| No repository (an analyst, a tester) | **A package** (section 9). Someone sends you a `.mxscout` file; you open it in MxScout. |
| Claude Code, but no Mendix project with the skills in it | **Install the skills** (section 4), then work with a project folder or a package. |

### 3. Setting it up — once per application, by one person

1. Start MxScout: double-click `MxScout.cmd` (Windows) or `MxScout.command`
   (macOS) in the MxScout folder. It needs Node.js. Your browser opens on it.
   Use Chrome or Edge, since only they can write into a folder.
2. **New project** → **In the Mendix project (mxscout/) — recommended** → pick
   the Mendix project folder (the one with the `.mpr`). Allow the browser to
   edit that folder. MxScout writes only into `mxscout/`, plus the two skills
   in `.claude/skills/`.
3. Leave **Add the Claude skills to this project (.claude/skills)** ticked.
4. Describe the application with Claude: open Claude Code in the Mendix
   project and say *"Use mendix-describe on mxscout/ — describe the whole
   application."* It asks what you want, and in which language to write (the
   default is English; the answer is kept for the project). A full description
   of a large app takes a while; that is normal.
5. **Commit `mxscout/` and `.claude/skills/`** as their own commit, for example
   "Add documentation", and push.

Already have the project in MxScout? Project menu → **Keep in the Mendix
project (mxscout/)…**

From now on, everyone who pulls has the documentation and the skills.

### 4. Installing the skills

**In a Mendix project with `mxscout/`:** nothing to install. The skills come
with the repository, in `.claude/skills/`. Start Claude Code in the root of the
project; after a pull that brought new skills, restart it.

**Anywhere else** — no such project, only a project folder or a package:

1. Install Claude Code.
2. Get MxScout, which carries the skills:
   `git clone https://github.com/ksiejek/mxscout.git`
3. Install them, from that folder:
   - macOS (or Linux): `skills/install.sh` — it links the skills into
     `~/.claude/skills/` (`skills/install.sh --copy` copies them instead);
   - Windows, in PowerShell:
     `powershell -ExecutionPolicy Bypass -File skills\install.ps1` — it copies
     them into `%USERPROFILE%\.claude\skills\` (the bypass is for that one run).
4. Restart Claude Code.
5. Check: type `/mendix-assist`, or ask *"Use mendix-describe on <folder>"*.

Both scripts put **mendix-describe** and **mendix-assist** side by side and
touch nothing else; a folder of the same name already there is moved to
`~/.claude/skills-backup/`, never deleted.

To update: `git pull` in the MxScout folder. On macOS the links follow it;
with `--copy`, or on Windows, run the script again. Then restart Claude Code.

**Using Codex**

The skills are plain Markdown and Node scripts, so Codex (or another coding
agent) can use them too.

- In a project with `mxscout/`: add one line to the repository's root
  `AGENTS.md`, which Codex reads: *Documentation of this Mendix app, and how
  to work with it: see mxscout/AGENTS.md.* Or tell Codex once: *"Read
  .claude/skills/mendix-assist/SKILL.md and follow it."*
- On a machine, for newer Codex versions, which load skills: from the MxScout
  folder, `skills/install.sh --codex` (macOS, Linux) or
  `powershell -ExecutionPolicy Bypass -File skills\install.ps1 -Codex`
  (Windows) installs the skills for Claude Code and for Codex, into
  `~/.agents/skills/` and `~/.codex/skills/` (`$CODEX_HOME/skills/` when that
  is set) — newer and older Codex versions look in one or the other; an old
  folder of the same name goes to `skills-backup/` beside it). `--codex-only` or
  `-CodexOnly`: for Codex alone. Restart Codex.
- `/mendix-assist` is Claude Code's. In Codex, say *"Use the mendix-assist
  skill"*, or the sentence above.

### 5. Working with Claude only

Open Claude Code **in the root of the Mendix project** (so it sees
`.claude/skills/`). If the skills do not show up, restart Claude Code.

**Ask about the application**

> *How does an order get approved?* · *Who can change a customer's address?* ·
> *What happens when a payment fails?*

Claude starts at `mxscout/docs/index.md`, reads what matters, and checks it
against the model. Where the documentation and the model disagree, the model
wins and it tells you.

**A ticket, a Jira issue, an idea, anything else: `/mendix-assist`**

1. Type `/mendix-assist`, or just *"I have a ticket"*, *"I have a Jira"*,
   *"I have an idea"*.
2. It asks what kind it is (**Service Desk ticket / Jira / Idea / Other**) and
   **always asks for its number** (e.g. SD-4711, PROJ-12), so the item can be
   found later.
3. Paste the text. You get:
   - **Ticket:** a verdict (bug / works as designed / data or configuration /
     cannot tell), how sure it is, the evidence (flows, conditions, access
     rules), a reply to paste back to the reporter and, for a bug, a proposed
     fix.
   - **Jira:** whether and how it can be done, which parts of the app it
     touches, a proposed solution in Mendix terms, risks, open questions and
     effort.
   - **Idea:** how that part works today, traced through the flows, and a
     proposed change.
   - **Other:** help with whatever you need, such as an analysis or an
     explanation.
4. **If something is missing** (the user's role, the steps, what was expected,
   the exact message, the environment), Claude writes the **questions to ask
   the reporter** and sets the item to *waiting*. When the answer comes, say
   *"The reporter answered on SD-4711: …"*. Claude records it, checks again
   and updates the verdict.
5. **Status and dates**, in plain words: *"SD-4711 is done"*, *"plan PROJ-12
   for 2026-11-20"*, *"drop the idea about exports"*. The statuses are open,
   in progress, waiting, done and dropped.

Your Assist items are **yours**. They stay on your machine — in your MxScout
folder (set it once in Settings; then nothing of yours is in the
Mendix project), or else in `mxscout/.local/` —
are never committed, and never go into a package or an export.

**Solved cases: the team's memory**

When a case is solved, Claude **writes a short case note itself** into
`mxscout/knowledge/`: the problem, the cause, the solution, what did not work,
and how to recognise it next time. It leaves out names, e-mails and customer
data, and tells you: *"I recorded case SD-4711 in mxscout/knowledge/ — commit
it with the fix."* **Your commit is the approval.** Before working on any new
item, Claude first looks there for a similar case: *"This happened before, in
SD-4711; the cause was …"*. You can also say *"add it to the documentation"*
yourself at any time.

**The language**

Everything Claude writes goes into the project's language: English unless you
chose another. It asks once and remembers it. Headings stay in English. To
change it, say *"from now on write in Polish"*.

### 6. Working with MxScout as well

Everything in section 5 works the same. MxScout adds:

- **Screens:** Overview, Processes, Modules, Architecture, Entities,
  Microflows, Pages, Security (**View as** a role), Risks, Model quality, For
  developers, **Assist** (every item in one list — Tickets, Jira, Ideas and
  Workbook, chosen from a dropdown — with search, status and planned date,
  notes by topic to tick off, **Copy questions**, **Add the reporter's
  answer**), **Solved cases** (the team's case notes, in one list with search;
  a case whose flows changed since is marked *May be out of date*), and
  **Documentation**.
- **Seeing what Claude did:** what Claude writes into the folder appears in
  MxScout within seconds, with **Undo**.
- **The version line** at the top of Documentation: *"Model main @ f00ba12 ·
  descriptions a1b2c3d (3 flows changed since)"*, or *"Descriptions describe
  this version — up to date"*. After a pull, press **Re-read**.
- **The press `/`** to search everything: a flow, a page, an entity.
- **Only Copilot, no Claude?** Press **+ Context** beside an entity, a
  microflow or a page (or right-click it) for everything a piece of work is
  about. In **Context**, **Copy prompt**, paste it into Copilot and talk the
  solution over; then say *"give me the JSON"* and paste the answer back. It
  becomes a **Workbook** item; its technical description downloads as HTML
  or Markdown with those elements appended — send it to whoever builds it.

### 7. After the application changed

One person updates the documentation; the others just pull.

1. **Pull** (Studio Pro or git).
2. Ask Claude *"Is the documentation up to date?"*, or look at the version line
   in MxScout. If it already describes the current commit, there is nothing to
   do.
3. If not: *"Use mendix-describe on mxscout/ — update the documentation."*
   Claude reads what changed (the commits since the described version and the
   flows that changed) and describes only that.
4. **Commit `mxscout/` on its own**, as "Update documentation", and push.
5. The others pull. They spend no tokens and get the current documentation.

Tip: agree in the team who updates (for example whoever merges to main), so
two people do not describe the same version at once.

### 8. A git conflict in mxscout/

If two people updated the documentation at once, a file in `mxscout/` gets git's
conflict markers.

- **With MxScout:** Documentation shows *"A file in mxscout/ has a git
  conflict"*, with both sides and **Use yours** / **Use theirs**. Then `git add`
  the file and finish the merge.
- **Without MxScout:** resolve it in git as usual, or ask Claude to do it.
- `mxscout/docs/` is generated from `mxscout/descriptions/`, so fix the
  descriptions; the docs follow.

### 9. Without the repository: packages

For people who do not have the repository:

- The person who updates: in MxScout, the project's **⋯** menu → **Package…**.
  It shows which version it packs. Put the `.mxscout` file on the shared drive
  and give the **access code** separately, once.
- The others: **New project** → drop the `.mxscout` file in. **The first time
  it needs the code; after that, packages of the same project open without
  it.** MxScout says whether the package is **newer, older or the same** as
  what you have, and asks before replacing yours with an older one. A package
  also carries the solved cases.
- **Forget this project's key** (Settings) makes it ask for the code again.

### 10. What is committed, and what is not

| Committed (shared) | Never committed (your machine) |
|---|---|
| `mxscout/mxscout.json`: the project, its language, the described version | `mxscout/.local/`: the model cache, the AI pack, the agent's inbox |
| `mxscout/descriptions/`: the documentation's source, in small files | **your Assist items** |
| `mxscout/docs/`: the documentation as Markdown, plus `manifest.json` | the package key, the agent channel's token |
| `mxscout/knowledge/`: solved cases | |
| `mxscout/AGENTS.md`, `README.md`, `GUIDE.md`, `GUIDE.html` | |
| `.claude/skills/mendix-describe/`, `mendix-assist/` | |

`mxscout/docs/` and `mxscout/knowledge/` are plain Markdown with a header on
each file, so a company search tool or AI (RAG) can take them straight from
the repository. MxScout itself uploads nothing.

Agents keep their working files — packs, notes, drafts — outside the project,
in a work folder of their own (`node .claude/skills/mendix-describe/agent.js
workdir` prints where). Into the project they write only the documentation,
and they never commit: you do.

### 11. When something does not work

- **Claude does not see the skills.** Start Claude Code in the root of the
  Mendix project and restart it after a pull that brought new skills.
- **"Version unknown".** The folder has no `.git`, `.git` is a worktree link,
  or only the `.mpr` was picked. Everything else works.
- **Studio Pro does not show `mxscout/` in its commit dialog.** This is not
  verified yet. Commit `mxscout/` and `.claude/skills/` with a git client or
  the command line.
- **MxScout cannot write the folder.** Use Chrome or Edge, and press
  **Reconnect the folder** in the header if the browser forgot the permission.
- **The documentation looks old** although you pulled: in MxScout press
  **Re-read**. With Claude only, ask it to check the version.
- **Claude wants to describe everything** when you only asked a question: say
  what you want. The skills ask first and never start describing on their own.

### 12. Phrases to start with

| You want… | Say to Claude |
|---|---|
| a full description, the first time | *Use mendix-describe on mxscout/ — describe the whole application.* |
| an update after changes | *Update the documentation.* |
| one more process described | *Describe the invoicing process too.* |
| a question answered | *How does … work? Who can …?* |
| a ticket checked | */mendix-assist* → Service Desk ticket → number → paste |
| a Jira worked out | */mendix-assist* → Jira → number → paste |
| an idea worked out | */mendix-assist* → Idea → *I want customers to be able to cancel an order.* |
| the reporter's answer recorded | *The reporter answered on SD-4711: …* |
| a status changed | *SD-4711 is done* · *plan PROJ-12 for 2026-11-20* |
| a solved case recorded | *Add it to the documentation.* |
| a similar case found | *Has this happened before?* |
| a different language | *From now on write in Polish.* |

---

<a id="polski"></a>

## Polski

### 1. Co to jest

Trzy rzeczy działają razem. Możesz używać wszystkich albo tylko Claude'a.

- **`mxscout/`** to folder w projekcie Mendix, commitowany razem z aplikacją.
  Zawiera dokumentację aplikacji, pisaną dla ludzi i dla AI: do czego służy,
  jej procesy, moduły, każdy mikroflow w jednym–dwóch zdaniach, ryzyka (P1–P3)
  i uwagi dla deweloperów. Mówi też, którą wersję aplikacji (który commit)
  opisuje.
- **Skille Claude'a** przychodzą razem z repozytorium, w `.claude/skills/`.
  Otwierasz Claude Code w projekcie i są, bez instalowania:
  - **mendix-describe** pisze i aktualizuje dokumentację oraz odpowiada na
    pytania, jak działa aplikacja.
  - **mendix-assist** to twoja pomoc przy ticketach, Jirach, pomysłach i
    większych zadaniach (workbook), sprawdzanych z modelem aplikacji — i
    zapisuje przy każdym z nich to, co każesz mu zanotować.
- **MxScout** to lokalna aplikacja (mały program na twoim komputerze plus
  przeglądarka) do oglądania modelu: encje, mikroflowy narysowane jak w Studio
  Pro, strony, uprawnienia ról, ryzyka i dokumentacja. **Do pracy z Claude'em
  nie jest potrzebny.** Jest dla tych, którzy chcą to zobaczyć, i dla osoby,
  która zakłada projekt.

Nic tu nigdzie się nie łączy. MxScout nie uruchamia gita i nie łączy się z
żadnym serwerem; commit, pull i push robisz sam, jak zawsze.

**Gdzie jest ten przewodnik.** W projekcie, jako `mxscout/GUIDE.html` (otwórz
w przeglądarce; po angielsku i po polsku) obok `mxscout/GUIDE.md`. W MxScoucie,
pod **Help → Team guide** na dole paska bocznego. I w repozytorium MxScout, jako
`public/guide-team.html` — [pobierz go z GitHuba](https://github.com/ksiejek/mxscout/blob/main/public/guide-team.html)
(„Download raw file”) i otwórz; nie potrzebuje sieci.

### 2. Jak pracuję?

| Masz… | Pracujesz tak |
|---|---|
| repozytorium aplikacji i Claude Code | **Tylko Claude** (punkt 5). Pull, Claude Code w projekcie, pytasz. |
| repozytorium, Claude'a i MxScout | **Claude + MxScout** (punkt 6). To samo, plus ekrany. |
| bez repozytorium (analityk, tester) | **Paczka** (punkt 9). Ktoś przysyła plik `.mxscout`, otwierasz go w MxScout. |
| Claude Code, ale bez projektu Mendix ze skillami | **Zainstaluj skille** (punkt 4), potem pracujesz z folderem projektu albo paczką. |

### 3. Pierwsze ustawienie — raz na aplikację, robi to jedna osoba

1. Uruchom MxScout: dwuklik w `MxScout.cmd` (Windows) albo `MxScout.command`
   (macOS) w folderze MxScout. Potrzebny jest Node.js. Otworzy się przeglądarka.
   Używaj Chrome albo Edge, bo tylko one potrafią zapisywać do folderu.
2. **New project** → **In the Mendix project (mxscout/) — recommended** →
   wskaż folder projektu Mendix (ten z plikiem `.mpr`). Pozwól przeglądarce
   edytować ten folder. MxScout zapisuje tylko do `mxscout/`, plus dwa skille w
   `.claude/skills/`.
3. Zostaw zaznaczone **Add the Claude skills to this project (.claude/skills)**.
4. Opisz aplikację z Claude'em: otwórz Claude Code w projekcie Mendix i napisz
   *„Use mendix-describe on mxscout/ — opisz całą aplikację.”* Claude zapyta,
   co chcesz i w jakim języku pisać (domyślnie po angielsku; odpowiedź zostaje
   zapamiętana dla projektu). Pełny opis dużej aplikacji trochę trwa, to
   normalne.
5. **Zacommituj `mxscout/` i `.claude/skills/`** osobnym commitem, np. „Add
   documentation”, i zrób push.

Masz już ten projekt w MxScout? Menu projektu → **Keep in the Mendix project
(mxscout/)…**

Od teraz każdy, kto zrobi pull, ma dokumentację i skille.

### 4. Instalacja skilli

**W projekcie Mendix z `mxscout/`:** nic nie instalujesz. Skille są w
repozytorium, w `.claude/skills/`. Uruchom Claude Code w katalogu głównym
projektu; po pullu, który przyniósł nowe skille, uruchom go ponownie.

**Gdzie indziej** — bez takiego projektu, tylko z folderem projektu albo paczką:

1. Zainstaluj Claude Code.
2. Pobierz MxScout, w którym są skille:
   `git clone https://github.com/ksiejek/mxscout.git`
3. Zainstaluj je, z tego folderu:
   - macOS (albo Linux): `skills/install.sh` — linkuje skille do
     `~/.claude/skills/` (`skills/install.sh --copy` je kopiuje);
   - Windows, w PowerShellu:
     `powershell -ExecutionPolicy Bypass -File skills\install.ps1` — kopiuje
     je do `%USERPROFILE%\.claude\skills\` (bypass dotyczy tylko tego jednego uruchomienia).
4. Uruchom ponownie Claude Code.
5. Sprawdź: wpisz `/mendix-assist` albo poproś *„Use mendix-describe on <folder>”*.

Oba skrypty kładą **mendix-describe** i **mendix-assist** obok siebie i nie
ruszają niczego innego; folder o tej samej nazwie, który już tam jest,
przenoszą do `~/.claude/skills-backup/`, nigdy go nie kasują.

Aktualizacja: `git pull` w folderze MxScout. Na macOS linki idą za nim same;
z `--copy` albo na Windows uruchom skrypt jeszcze raz. Potem uruchom ponownie
Claude Code.

**Z Codexem**

Skille to zwykły Markdown i skrypty Node, więc Codex (albo inny agent do
kodu) też może z nich korzystać.

- W projekcie z `mxscout/`: dopisz jedną linię do `AGENTS.md` w katalogu
  głównym repozytorium, który Codex czyta: *Documentation of this Mendix app,
  and how to work with it: see mxscout/AGENTS.md.* Albo powiedz Codexowi raz:
  *„Read .claude/skills/mendix-assist/SKILL.md and follow it.”*
- Na komputerze, dla nowszych wersji Codexa, które ładują skille: z folderu
  MxScout `skills/install.sh --codex` (macOS, Linux) albo
  `powershell -ExecutionPolicy Bypass -File skills\install.ps1 -Codex`
  (Windows) instaluje skille dla Claude Code i dla Codexa, do
  `~/.agents/skills/` i `~/.codex/skills/` (do `$CODEX_HOME/skills/`, gdy ta
  zmienna jest ustawiona) — nowsze i starsze wersje Codexa szukają w jednym
  albo drugim; stary folder o tej samej nazwie trafia do `skills-backup/` obok).
  `--codex-only` albo `-CodexOnly`: tylko dla Codexa. Uruchom ponownie Codexa.
- `/mendix-assist` jest z Claude Code. W Codexie powiedz *„Use the
  mendix-assist skill”* albo zdanie wyżej.

### 5. Praca tylko z Claude'em

Otwórz Claude Code **w głównym folderze projektu Mendix**, żeby widział
`.claude/skills/`. Jeśli skille się nie pokazują, uruchom Claude Code
ponownie.

**Pytania o aplikację**

> *Jak zatwierdzane jest zamówienie?* · *Kto może zmienić adres klienta?* ·
> *Co się dzieje, gdy płatność się nie powiedzie?*

Claude zaczyna od `mxscout/docs/index.md`, czyta to, co potrzebne, i sprawdza
w modelu. Gdy dokumentacja i model się różnią, wygrywa model, a Claude o tym
mówi.

**Ticket, Jira, pomysł, cokolwiek innego: `/mendix-assist`**

1. Wpisz `/mendix-assist` albo po prostu *„mam ticket”*, *„mam Jirę”*, *„mam
   pomysł”*.
2. Claude pyta o rodzaj (**Service Desk ticket / Jira / Idea / Other**) i
   **zawsze o numer** (np. SD-4711, PROJ-12), żeby dało się do tego wrócić.
3. Wklej treść. Dostajesz:
   - **Ticket:** werdykt (błąd / działa zgodnie z projektem / dane lub
     konfiguracja / nie da się stwierdzić), pewność, dowody (mikroflowy,
     warunki, reguły dostępu), odpowiedź do wklejenia zgłaszającemu, a przy
     błędzie propozycję poprawki.
   - **Jira:** czy i jak da się to zrobić, których części aplikacji dotyczy,
     propozycję rozwiązania w kategoriach Mendixa, ryzyka, otwarte pytania i
     nakład pracy.
   - **Idea:** jak ta część działa dziś, prześledzone przez mikroflowy, i
     proponowaną zmianę.
   - **Other:** pomoc w czymkolwiek, np. analizę albo wyjaśnienie.
4. **Gdy czegoś brakuje** (rola użytkownika, kroki, oczekiwany wynik, dokładny
   komunikat, środowisko), Claude pisze **pytania do zgłaszającego** i ustawia
   status *waiting*. Gdy przyjdzie odpowiedź, napisz *„Zgłaszający odpisał na
   SD-4711: …”*. Claude ją zapisze, sprawdzi jeszcze raz i poprawi werdykt.
5. **Status i terminy** zwykłymi słowami: *„SD-4711 zrobione”*, *„zaplanuj
   PROJ-12 na 2026-11-20”*, *„porzuć pomysł z eksportem”*. Statusy to open,
   in progress, waiting, done i dropped.

Twoje zgłoszenia w Assist są **twoje**. Zostają na twoim komputerze — w
twoim folderze MxScout (ustaw go raz w Settings; wtedy w projekcie
Mendix nie ma nic twojego), a bez niego w `mxscout/.local/` — nie idą do gita,
do paczki ani do eksportu.

**Rozwiązane przypadki: pamięć zespołu**

Gdy sprawa jest rozwiązana, Claude **sam zapisuje krótką notatkę** do
`mxscout/knowledge/`: problem, przyczynę, rozwiązanie, co nie zadziałało i jak
to rozpoznać następnym razem. Pomija nazwiska, maile i dane klientów, i mówi
ci: *„Zapisałem przypadek SD-4711 w mxscout/knowledge/ — zacommituj go razem z
poprawką.”* **Twój commit jest zatwierdzeniem.** Przy każdym nowym zgłoszeniu
Claude najpierw szuka tam podobnego przypadku: *„To już było, w SD-4711;
przyczyną było …”*. Możesz też w każdej chwili sam powiedzieć *„dołóż to do
dokumentacji”*.

**Język**

Wszystko, co pisze Claude, jest w języku projektu: po angielsku, chyba że
wybrałeś inny. Claude pyta raz i zapamiętuje. Nagłówki zostają po angielsku.
Żeby zmienić, powiedz *„od teraz pisz po polsku”*.

### 6. Praca także z MxScoutem

Wszystko z punktu 5 działa tak samo. MxScout dokłada:

- **Ekrany:** Overview, Processes, Modules, Architecture, Entities,
  Microflows, Pages, Security (**View as**, czyli widok oczami roli), Risks,
  Model quality, For developers, **Assist** (wszystkie twoje pozycje na jednej
  liście — Tickets, Jira, Ideas i Workbook, do wyboru z listy rozwijanej — z
  wyszukiwaniem, statusem i terminem, notatkami według tematów do odhaczania,
  **Copy questions**, **Add the reporter's answer**), **Solved cases**
  (notatki zespołu o przypadkach, na jednej liście z wyszukiwaniem; przypadek, którego
  mikroflowy się od tamtej pory zmieniły, ma znacznik *May be out of date*) i
  **Documentation**.
- **Podgląd tego, co zrobił Claude:** to, co Claude zapisze w folderze, pojawia
  się w MxScout w ciągu kilku sekund, z **Undo**.
- **Linia wersji** na górze Documentation: *„Model main @ f00ba12 ·
  descriptions a1b2c3d (3 flows changed since)”* albo *„Descriptions describe
  this version — up to date”*. Po pullu kliknij **Re-read**.
- **Klawisz `/`** szuka wszystkiego: mikroflowu, strony, encji.
- **Tylko Copilot, bez Claude'a?** Kliknij **+ Context** przy encji,
  mikroflowie czy stronie (albo prawy przycisk) przy wszystkim, czego dotyczy
  dana praca. W **Context** kliknij **Copy prompt**, wklej do Copilota i
  omów rozwiązanie; potem napisz *„give me the JSON”* i wklej odpowiedź z
  powrotem. Powstaje pozycja **Workbook**; jej opis techniczny pobierzesz
  jako HTML albo Markdown z tymi elementami na końcu — wyślij go temu, kto
  będzie to budował.

### 7. Po zmianach w aplikacji

Jedna osoba aktualizuje dokumentację, reszta tylko robi pull.

1. **Pull** (Studio Pro albo git).
2. Zapytaj Claude'a *„Czy dokumentacja jest aktualna?”* albo spójrz na linię
   wersji w MxScout. Jeśli opisuje bieżący commit, nie ma nic do zrobienia.
3. Jeśli nie: *„Use mendix-describe on mxscout/ — zaktualizuj dokumentację.”*
   Claude sprawdza, co się zmieniło (commity od opisanej wersji i zmienione
   mikroflowy), i opisuje tylko to.
4. **Zacommituj `mxscout/` osobno**, jako „Update documentation”, i zrób push.
5. Reszta robi pull. Nie wydaje tokenów, a ma aktualną dokumentację.

Rada: ustalcie w zespole, kto aktualizuje (np. osoba, która scala do main),
żeby dwie osoby nie opisywały tej samej wersji naraz.

### 8. Konflikt w gicie w mxscout/

Gdy dwie osoby zaktualizowały dokumentację naraz, plik w `mxscout/` dostaje
znaczniki konfliktu gita.

- **Z MxScoutem:** Documentation pokazuje *„A file in mxscout/ has a git
  conflict”*, obie wersje i przyciski **Use yours** / **Use theirs**. Potem
  `git add` tego pliku i dokończ scalanie.
- **Bez MxScouta:** rozwiąż jak zwykle w gicie albo poproś o to Claude'a.
- `mxscout/docs/` powstaje z `mxscout/descriptions/`, więc poprawiaj opisy,
  a dokumentacja pójdzie za nimi.

### 9. Bez repozytorium: paczki

Dla osób, które nie mają repozytorium:

- Osoba, która aktualizuje: w MxScout menu **⋯** projektu → **Package…**.
  Okno pokazuje, którą wersję pakuje. Plik `.mxscout` wrzuć na wspólny dysk, a
  **kod dostępu** przekaż osobno, raz.
- Reszta: **New project** → upuść plik `.mxscout`. **Za pierwszym razem trzeba
  podać kod, później paczki tego samego projektu otwierają się bez niego.**
  MxScout mówi, czy paczka jest **nowsza, starsza czy taka sama** jak to, co
  masz, i pyta, zanim zastąpi twoją wersję starszą. Paczka zawiera też
  rozwiązane przypadki.
- **Forget this project's key** (Settings) sprawia, że kod znów będzie
  potrzebny.

### 10. Co idzie do gita, a co nie

| Commitowane (wspólne) | Nigdy niecommitowane (twój komputer) |
|---|---|
| `mxscout/mxscout.json`: projekt, język, opisana wersja | `mxscout/.local/`: kopia modelu, pakiet AI, skrzynka agenta |
| `mxscout/descriptions/`: źródło dokumentacji, w małych plikach | **twoje zgłoszenia w Assist** |
| `mxscout/docs/`: dokumentacja w Markdown, plus `manifest.json` | klucz paczki, token kanału agenta |
| `mxscout/knowledge/`: rozwiązane przypadki | |
| `mxscout/AGENTS.md`, `README.md`, `GUIDE.md`, `GUIDE.html` | |
| `.claude/skills/mendix-describe/`, `mendix-assist/` | |

`mxscout/docs/` i `mxscout/knowledge/` to zwykły Markdown z nagłówkiem w
każdym pliku, więc firmowa wyszukiwarka albo AI (RAG) może je brać prosto z
repozytorium. Sam MxScout niczego nie wysyła.

Agenci trzymają swoje pliki robocze — pakiety, notatki, szkice — poza
projektem, we własnym folderze roboczym (`node
.claude/skills/mendix-describe/agent.js workdir` pokazuje, gdzie). Do projektu
zapisują tylko dokumentację i nigdy nie commitują: robisz to ty.

### 11. Gdy coś nie działa

- **Claude nie widzi skilli.** Uruchom Claude Code w głównym folderze projektu
  Mendix, a po pullu z nowymi skillami uruchom go ponownie.
- **„Version unknown”.** Folder nie ma `.git`, `.git` jest odnośnikiem
  worktree albo wskazano sam plik `.mpr`. Reszta działa.
- **Studio Pro nie pokazuje `mxscout/` przy commicie.** Jeszcze tego nie
  sprawdziliśmy. Zacommituj `mxscout/` i `.claude/skills/` klientem gita albo z
  wiersza poleceń.
- **MxScout nie może zapisać folderu.** Użyj Chrome albo Edge, a jeśli
  przeglądarka zapomniała uprawnienie, kliknij w nagłówku **Reconnect the
  folder**.
- **Dokumentacja wygląda na starą**, choć zrobiłeś pull: w MxScout kliknij
  **Re-read**. Z samym Claude'em poproś, żeby sprawdził wersję.
- **Claude chce opisywać wszystko**, a ty zadałeś tylko pytanie: powiedz,
  czego chcesz. Skille najpierw pytają i nigdy nie zaczynają opisywać same.

### 12. Na początek: co powiedzieć

| Chcesz… | Powiedz Claude'owi |
|---|---|
| pełny opis, pierwszy raz | *Use mendix-describe on mxscout/ — opisz całą aplikację.* |
| aktualizację po zmianach | *Zaktualizuj dokumentację.* |
| opis jeszcze jednego procesu | *Opisz jeszcze proces fakturowania.* |
| odpowiedź na pytanie | *Jak działa …? Kto może …?* |
| sprawdzenie ticketu | */mendix-assist* → Service Desk ticket → numer → wklej |
| rozpisanie Jiry | */mendix-assist* → Jira → numer → wklej |
| rozpisanie pomysłu | */mendix-assist* → Idea → *Chcę, żeby klient mógł anulować zamówienie.* |
| zapisanie odpowiedzi zgłaszającego | *Zgłaszający odpisał na SD-4711: …* |
| zmianę statusu | *SD-4711 zrobione* · *zaplanuj PROJ-12 na 2026-11-20* |
| zapisanie rozwiązanego przypadku | *Dołóż to do dokumentacji.* |
| znalezienie podobnego przypadku | *Czy to już się zdarzyło?* |
| inny język | *Od teraz pisz po polsku.* |
