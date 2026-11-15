# Woordentuin

Een lokale, Nederlandstalige woordjesoefening voor één leerling. Oefeningen, woorden en voortgang blijven in deze browser op dit apparaat; er is geen account, synchronisatie, reclame of externe analyse. Het spel meet herkenning, niet zelfstandig vertalen of spellen.

## MVT uit het boek oefenen

Kies op de startpagina **MVT · Frans, Duits en Spaans** en eventueel een hoofdstuk. Bij een nieuwe installatie is MVT de standaard. Nederlands staat links; Frans, Duits en Spaans staan door elkaar rechts, met de taal bij elke vertaling. Engels blijft beschikbaar als afzonderlijke oefentaal, met behoud van bestaande woorden en voortgang.

- Drie borden van zes paren per ronde; maximaal zes nieuwe vertalingen worden eerst getoond. Een kleine of dubbelzinnige selectie kan minder paren opleveren. Een extra herhaling maakt een bestaand vol bord niet kleiner.
- Na het laatste bord volgt alleen **Nog een ronde** of **Stoppen**. De handmatige terugvraagronde is vervallen, ook bij afzonderlijke talen. Oude zelfbeoordelingen blijven als historisch archief bewaard.
- Voortgang wordt per woord, doeltaal en inhoudsversie bewaard. Frans kennen betekent niet automatisch Duits kennen. Fouten en hints krijgen extra aandacht; de laatste één of twee overgebleven keuzes tellen niet als sterk positief bewijs.
- **Voor ouders → Alle MVT-boekwoorden** toont de volledige tabel met Nederlands en alle vier doeltalen. Daaronder kun je woorden aanpassen en de voortgang bekijken. Eigen toegevoegde woorden blijven beschikbaar in de afzonderlijke taalmodus, maar worden niet aan de exacte MVT-boekselectie toegevoegd.

De vier foto's in `intput/` zijn overgenomen in `src/lib/content/words.ts`: **55 Nederlandse ingangen** (10 werkwoorden, 31 zelfstandige naamwoorden en 14 bijvoeglijke naamwoorden), met **210 anderstalige vormen**. De werkwoordenfoto bevat geen Engelse kolom; die vertalingen zijn niet verzonnen en worden niet gevraagd.

Bij negen zelfstandige naamwoorden is de Nederlandse kolom afgesneden. Die Nederlandse betekenissen zijn afgeleid uit de zichtbare vertalingen en expliciet gemarkeerd. Ook twijfelachtige boekvormen, zoals Spaans `bebe` en Engels/Duits `enthusiast`, blijven herkenbaar overgenomen met een notitie voor oudercontrole. De twee betekenissen van *zijn* krijgen Nederlandse aanwijzingen, niet de Spaanse antwoorden `ser` en `estar`.

Opslag en reservekopieën uit versie 1 en 2 worden automatisch naar versie 3 gemigreerd. De nieuwe statistieken verzinnen geen tijden of eerste-pogingresultaten voor oude gegevens. Een lopende MVT-ronde met Engels wordt met uitleg opnieuw begonnen; een oude terugvraagronde wordt afgerond zonder extra leerresultaten te boeken. Eigen wijzigingen, Engelse voortgang en historische zelfbeoordelingen blijven behouden. De bestaande inhoudsmigratie van versie 1 kan nog wel de voortgang van inhoudelijk gewijzigde, onaangepaste boekwoorden opnieuw beginnen.

## Hoe de oefening meegroeit

- Het spel bewaart echte keuzes, fouten, hints, pogingen, keuzevolgorde en verbindvolgorde. Een verbetering na een fout blijft geholpen; opnieuw selecteren wist die fout niet.
- Alleen actieve speeltijd telt mee. Opslaan en bordwisselingen worden niet meegeteld. Na focusverlies, herladen of hervatten krijgt het huidige bord geen betrouwbare tijdmeting; het volgende bord kan weer worden gemeten.
- De laatste tien bordbeurten per woordenpaar bepalen het recente advies. Oude fouten blijven daardoor niet onbeperkt doorslaggevend. Een eerste, zelfstandige goede keuze uit minstens drie mogelijkheden telt zwaarder dan een laatste overgebleven paar.
- De planning richt zich op ongeveer negen moeilijke/herhaalparen, zes nieuwe of andere herhaalparen en drie vertrouwde steunparen. Bij veel moeilijk materiaal kan dat twaalf/drie/drie worden. Beschikbare woorden, taalspreiding en ondubbelzinnige antwoorden gaan voor deze streefaantallen. Gemiste paren komen waar mogelijk pas na drie andere verbindingen opnieuw terug.
- De bestaande intervallen van 1, 3, 7, 14 en 30 dagen blijven gelden. Herhalen in dezelfde ronde levert geen langetermijnbeheersing op.
- Snelheid is alleen een zwak extra signaal, nooit een straf voor langzaam goed antwoorden. Vergelijking vereist minstens drie schone tijdmetingen voor het paar en twintig vergelijkbare metingen in dezelfde taal en keuzeband, verspreid over minstens twee sessies. Dit zijn voorzichtige ontwerpkeuzes, geen wetenschappelijk gevalideerde beheersingsgrenzen.

Onder **Voor ouders → Herkenning tijdens het verbinden → Oefenoverzicht bekijken** staan eerste-pogingpercentages met aantallen, fouten/hints, schone antwoordtijd, volgorde, oefenadvies en oefendatums. Op een smal scherm staan de gegevens onder elkaar. MVT toont alleen de drie actieve doeltalen. Het kind krijgt geen timer, snelheidsscore of extra controlescherm.

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
- `npm test`: 56 geslaagde tests voor bewijsinterpretatie, tijdmeting, herhaalplanning, taalspreiding, zes-parenborden, migratie, reservekopieën en opslaggrenzen.
- `npm run build`: geslaagde statische productiebuild.
- Productiebuild in Chromium: volledige MVT-rondes met drie borden van zes paren, fouten, hints, correcties na opnieuw selecteren, rechtstreeks afronden en een volgende ronde met extra herhaling van gemiste/geholpen paren. Er ontstonden geen nieuwe zelfbeoordelingsrecords.
- Een zelfstandige eerste match bewaarde zes echte keuzes; een correctie bleef poging twee en geholpen. Focusverlies en herladen leverden onbekende tijden op; een nieuw bord kreeg weer geldige tijdmetingen. Ook een rechts-eerst gekozen vertaling werd aan de juiste taal toegeschreven.
- Een echte versie-2-opslag met 19 leergebeurtenissen en zeven voortgangsrecords via de serviceworker-update gemigreerd: gebeurtenissen en voortgang bleven exact behouden en de oude terugvraagronde werd een afrondscherm. Een oude actieve MVT-reservekopie met Engels werd met uitleg opnieuw begonnen.
- Ouderoverzicht: 165 MVT-woordenparen, geen Engelse statistiekrijen, zichtbaar recent oefenadvies met aantallen en geen horizontale pagina-overloop op 390 en 1024 pixels breed.
- De previewserver gestopt: een ongecachet netwerkverzoek faalde, opgeslagen pagina's konden herladen worden, een volledige MVT-ronde werd voltooid en bewaard, en afzonderlijk Engels bleef oefenbaar zonder terugvraagronde.
- Een echte reservekopie gedownload, voortgang gewist en de volledige versie-3-reservekopie exact hersteld. Een reservekopie met ongeldige poginggegevens werd afgewezen zonder opgeslagen gegevens te veranderen.
- Een volgende serviceworker-update behield alle 92 opgeslagen gebeurtenissen en de overige gegevens exact.
- Speelschermen op 390 × 844 en 1024 × 1366 browserpixels gecontroleerd: twaalf tegels en geen horizontale pagina-overloop. Speelscherm en mobiel ouderoverzicht ook visueel beoordeeld via PDF-weergaven van de scherm-CSS; de normale screenshotopname liep eerder vast in de testbrowser. Dit is geen fysieke Safari-controle.

## Nog fysiek te beoordelen

Test op echte iPhone en iPad met Safari en beginscherm-app, inclusief vliegtuigmodus na offline gereedmelding, een update, hervatten, herstel van een back-up, verschillende schermstanden, Split View, grotere tekst, VoiceOver en verminderde beweging. Desktop-emulatie vervangt deze controles niet.
