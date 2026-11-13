# Woordentuin

Een lokale, Nederlandstalige woordjesoefening voor één leerling. Oefeningen, woorden en voortgang blijven in deze browser op dit apparaat; er is geen account, synchronisatie, reclame of externe analyse. De terugvraagronde is zelfrapportage, geen gecontroleerde spellingtoets.

## MVT uit het boek oefenen

Kies op de startpagina **MVT · alle talen** en eventueel een hoofdstuk. Bij een nieuwe installatie is MVT de standaard. Nederlands staat links; Engels, Frans, Duits en Spaans staan door elkaar rechts, met de taal bij elke vertaling. Bij terugvragen wordt de gevraagde taal vóór het onthullen getoond.

- Zes paren per bord, ook in de eerste ronde; maximaal zes nieuwe vertalingen worden eerst getoond. Een kleine of dubbelzinnige selectie kan minder paren opleveren. Een al opgeslagen oudere ronde behoudt zijn indeling; de volgende ronde gebruikt zes paren.
- Voortgang wordt per woord én doeltaal bewaard. Frans kennen betekent niet automatisch Duits kennen. Fouten en hints krijgen extra aandacht; de laatste één of twee overgebleven keuzes tellen niet als sterk bewijs van beheersing.
- **Voor ouders → Alle MVT-boekwoorden** toont de volledige tabel met Nederlands en alle vier doeltalen. Daaronder kun je woorden aanpassen en de voortgang bekijken. Eigen toegevoegde woorden blijven beschikbaar in de afzonderlijke taalmodus, maar worden niet aan de exacte MVT-boekselectie toegevoegd.

De vier foto's in `intput/` zijn overgenomen in `src/lib/content/words.ts`: **55 Nederlandse ingangen** (10 werkwoorden, 31 zelfstandige naamwoorden en 14 bijvoeglijke naamwoorden), met **210 anderstalige vormen**. De werkwoordenfoto bevat geen Engelse kolom; die vertalingen zijn niet verzonnen en worden niet gevraagd.

Bij negen zelfstandige naamwoorden is de Nederlandse kolom afgesneden. Die Nederlandse betekenissen zijn afgeleid uit de zichtbare vertalingen en expliciet gemarkeerd. Ook twijfelachtige boekvormen, zoals Spaans `bebe` en Engels/Duits `enthusiast`, blijven herkenbaar overgenomen met een notitie voor oudercontrole. De twee betekenissen van *zijn* krijgen Nederlandse aanwijzingen, niet de Spaanse antwoorden `ser` en `estar`.

Oude opslag en back-ups worden naar de MVT-indeling gemigreerd. Eigen wijzigingen en toevoegingen blijven behouden. Alleen bij inhoudelijk gewijzigde, onaangepaste boekwoorden wordt de bijbehorende voortgang opnieuw begonnen; een getroffen lopende ronde wordt dan opnieuw samengesteld.

## Ontwikkelen

Gebruik Node.js 22.17 of nieuwer en npm:

```sh
npm install
npm run dev
npm run check
npm test
npm run build
npm run preview
```

`dev` start de ontwikkelserver; `check` controleert Svelte en TypeScript; `test` draait de unit tests. `build` maakt de statische site in `build/`; `preview` serveert de productiebuild lokaal. Deze commando's impliceren geen apparaatvalidatie.

## GitHub Pages

Publieke URL: **https://martijnberger.github.io/woordentuin/**.

De workflow `.github/workflows/pages.yml` controleert en bouwt de app bij elke push naar `main` en publiceert uitsluitend `build/` via GitHub Pages. In de repository-instellingen moet **Pages → Source → GitHub Actions** geselecteerd zijn. Handmatig opnieuw publiceren kan via **Actions → Deploy GitHub Pages → Run workflow**.

In GitHub Actions gebruikt de build het basispad `/woordentuin`; lokale ontwikkeling blijft op `/`. Navigatie en de serviceworker volgen dat basispad. Dezelfde Pages-build lokaal controleren:

```sh
GITHUB_ACTIONS=true npm run build
GITHUB_ACTIONS=true npm run preview -- --host 127.0.0.1 --port 4174
```

Open daarna `http://127.0.0.1:4174/woordentuin/`. De oorspronkelijke foto's in `intput/` en de machinespecifieke `woordentuin.Caddyfile` blijven lokaal en zijn uitgesloten van de gepubliceerde repositorygeschiedenis. Voortgang en reservekopieën worden niet naar GitHub gestuurd; een nieuw domein heeft eigen browseropslag. Gebruik export/import als je bestaande lokale voortgang wilt meenemen.

Deze toepassing en publicatieconfiguratie zijn ontwikkeld met hulp van een AI-agent.


## Installeren en offline

Publiceer uitsluitend de inhoud van `build/` op een statische HTTPS-host die map-indexbestanden ondersteunt. De oorspronkelijke foto's staan buiten de publieke assets en horen niet bij de deployment. Controleer toestemming voordat je de van lesmateriaal overgenomen woorden publiek verspreidt.

Open de app eerst online en wacht op **Klaar voor offline oefenen**. Daarna zijn de vooraf geladen pagina's en assets beschikbaar zonder netwerk, zolang de browseropslag behouden blijft. De eerste opening werkt niet offline. Serviceworkers vereisen HTTPS of localhost; gebruik een productiebuild voor een realistische offlineproef. Een nieuwe versie kan buiten het speelscherm worden geladen; sluit eerst eventuele andere tabbladen van de app. Voortgang wordt niet met een update gewist.

Op iPhone of iPad: open de site in Safari, tik op Deel en kies **Zet op beginscherm**. De precieze benaming kan per iOS-versie verschillen. Een geïnstalleerde app en de browser kunnen afzonderlijke opslag hebben.

## Gegevens en inhoud

Browseropslag is afhankelijk van apparaat en browser en kan worden gewist of door het systeem worden verwijderd. Een verzoek om permanente opslag is geen garantie. Exporteer regelmatig een back-up via het oudergedeelte en bewaar die veilig; import vervangt de bestaande lokale gegevens. Er is geen automatische synchronisatie tussen apparaten of browsers. Het oudergedeelte is geen beveiliging tegen toegang door anderen op hetzelfde apparaat.

De woorden uit het lesmateriaal moeten door een ouder of docent worden gecontroleerd, met name spelling, accenten, lidwoorden, vertaalalternatieven en onzekere vormen. Het gebruik van de app garandeert geen leerresultaat.

## Uitgevoerde controle

- `npm run check`: 0 fouten en 0 waarschuwingen.
- `npm test`: 24 geslaagde tests voor leerplanning, zes-parenborden, MVT-taaltoewijzing, migratie, voortgang en opslaggrenzen.
- `npm run build`: geslaagde statische productiebuild.
- In Chromium met de productiebuild: volledige oefenrondes, fouten en hints, afzonderlijke terugvraagvoortgang, hervatten na herladen, blokkering van een tweede speeltab en een lege woordselectie.
- Een echte browseropslaglimiet opgelegd: een mislukte schrijfactie toont een fout en telt de combinatie niet als opgeslagen.
- Oudergedeelte: dubbele invoer geweigerd, woorden geïmporteerd/bewerkt/goedgekeurd, back-up gedownload, voortgang gewist en de volledige back-up exact hersteld.
- Zonder netwerk: oefenronde voltooid en opgeslagen, speelsessie na herladen hervat en ouderpagina geopend. Een ongecachet verzoek faalde tijdens deze controle.
- Een nieuwe serviceworkerversie geactiveerd zonder wijziging van de opgeslagen gegevens.
- Schermen visueel bekeken op 320 × 568, 390 × 844, 844 × 390 en 1024 × 768 browserpixels; geen horizontale pagina-overloop op deze afmetingen.
- MVT: zes nieuwe paren en vier gemengde doeltalen, fouten/hints met zes keuzemogelijkheden, afzonderlijke taalvoortgang, taal vóór terugvragen, offline hervatten en oefenen, 55 boekregels in het ouderoverzicht en exact herstel van een back-up met gemengde sessie. Na de aanpassing aan herhalingen bleven alle drie borden zes paren bevatten: 18 combinaties offline voltooid.
- Een bestaande versie-1-opslag met zes voortgangsrecords, eigen woorden en een lopende ronde gemigreerd; de onaangetaste voortgang en ronde bleven behouden.
- Het zes-parenscherm op 390 pixels breed beoordeeld via een PDF van de scherm-CSS; de normale screenshotopname liep vast in de testbrowser. Dit is geen fysieke Safari-controle.
- Het zes-parenwerkwoordenbord met Nederlandse betekenishulp gecontroleerd op 320 × 568 en 1024 × 768: twaalf tegels, geen horizontale pagina-overloop. Bij lange woorden of aanwijzingen is verticaal scrollen mogelijk; de tekst en tikvlakken worden niet kleiner gemaakt om alles in één scherm te persen.
- De GitHub Pages-build lokaal onder `/woordentuin/` uitgevoerd: navigatie tussen start, ouderoverzicht en spel, 55 tabelregels, serviceworker op het juiste basispad, offline herladen en alle 18 combinaties voltooid.

## Nog fysiek te beoordelen

Test op echte iPhone en iPad met Safari en beginscherm-app, inclusief vliegtuigmodus na offline gereedmelding, een update, hervatten, herstel van een back-up, verschillende schermstanden, Split View, grotere tekst, VoiceOver en verminderde beweging. Desktop-emulatie vervangt deze controles niet.
