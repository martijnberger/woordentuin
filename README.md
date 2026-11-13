# Woordentuin

Een lokale, Nederlandstalige woordjesoefening voor één leerling. Oefeningen, woorden en voortgang blijven in deze browser op dit apparaat; er is geen account, synchronisatie, reclame of externe analyse. De terugvraagronde is zelfrapportage, geen gecontroleerde spellingtoets.

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

## Installeren en offline

Publiceer uitsluitend de inhoud van `build/` op een statische HTTPS-host die map-indexbestanden ondersteunt. De oorspronkelijke foto's staan buiten de publieke assets en horen niet bij de deployment. Controleer toestemming voordat je de van lesmateriaal overgenomen woorden publiek verspreidt.

Open de app eerst online en wacht op **Klaar voor offline oefenen**. Daarna zijn de vooraf geladen pagina's en assets beschikbaar zonder netwerk, zolang de browseropslag behouden blijft. De eerste opening werkt niet offline. Serviceworkers vereisen HTTPS of localhost; gebruik een productiebuild voor een realistische offlineproef. Een nieuwe versie kan buiten het speelscherm worden geladen; sluit eerst eventuele andere tabbladen van de app. Voortgang wordt niet met een update gewist.

Op iPhone of iPad: open de site in Safari, tik op Deel en kies **Zet op beginscherm**. De precieze benaming kan per iOS-versie verschillen. Een geïnstalleerde app en de browser kunnen afzonderlijke opslag hebben.

## Gegevens en inhoud

Browseropslag is afhankelijk van apparaat en browser en kan worden gewist of door het systeem worden verwijderd. Een verzoek om permanente opslag is geen garantie. Exporteer regelmatig een back-up via het oudergedeelte en bewaar die veilig; import vervangt de bestaande lokale gegevens. Er is geen automatische synchronisatie tussen apparaten of browsers. Het oudergedeelte is geen beveiliging tegen toegang door anderen op hetzelfde apparaat.

De woorden uit het lesmateriaal moeten door een ouder of docent worden gecontroleerd, met name spelling, accenten, lidwoorden, vertaalalternatieven en onzekere vormen. Het gebruik van de app garandeert geen leerresultaat.

## Uitgevoerde controle

- `npm run check`: 0 fouten en 0 waarschuwingen.
- `npm test`: 19 geslaagde tests voor leerplanning, voortgang en opslaggrenzen.
- `npm run build`: geslaagde statische productiebuild.
- In Chromium met de productiebuild: volledige oefenrondes, fouten en hints, afzonderlijke terugvraagvoortgang, hervatten na herladen, blokkering van een tweede speeltab en een lege woordselectie.
- Een echte browseropslaglimiet opgelegd: een mislukte schrijfactie toont een fout en telt de combinatie niet als opgeslagen.
- Oudergedeelte: dubbele invoer geweigerd, woorden geïmporteerd/bewerkt/goedgekeurd, back-up gedownload, voortgang gewist en de volledige back-up exact hersteld.
- Zonder netwerk: oefenronde voltooid en opgeslagen, speelsessie na herladen hervat en ouderpagina geopend. Een ongecachet verzoek faalde tijdens deze controle.
- Een nieuwe serviceworkerversie geactiveerd zonder wijziging van de opgeslagen gegevens.
- Schermen visueel bekeken op 320 × 568, 390 × 844, 844 × 390 en 1024 × 768 browserpixels; geen horizontale pagina-overloop op deze afmetingen.

## Nog fysiek te beoordelen

Test op echte iPhone en iPad met Safari en beginscherm-app, inclusief vliegtuigmodus na offline gereedmelding, een update, hervatten, herstel van een back-up, verschillende schermstanden, Split View, grotere tekst, VoiceOver en verminderde beweging. Desktop-emulatie vervangt deze controles niet.
