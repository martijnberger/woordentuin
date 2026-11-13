import type { Language, Word } from '../model';

type Row = [string, string, string, string, string, string?, string?];
// Source order: Dutch, German, French, Spanish, English. Empty cells are absent in the photo.
const verbs: Row[] = [
  ['spreken', 'spreken, praten', 'sprechen', 'parler', 'hablar'],
  ['wonen', 'wonen', 'wohnen', 'habiter', 'vivir'],
  ['heten', 'heten', 'heißen', 's’appeler', 'llamarse'],
  ['zijn-ser', 'zijn', 'sein', 'être', 'ser', '', 'ser'],
  ['zijn-estar', 'zijn, zich bevinden', 'sein, sich befinden', 'être, se trouver', 'estar', '', 'estar'],
  ['gaan', 'gaan', 'gehen', 'aller', 'ir'],
  ['maken', 'maken, doen', 'machen, tun', 'faire', 'hacer'],
  ['hebben', 'hebben', 'haben', 'avoir', 'tener'],
  ['kunnen', 'kunnen/mogen', 'können', 'pouvoir', 'poder'],
  ['leuk-vinden', 'leuk vinden', 'mögen', 'aimer', 'gustar']
];
const nouns: Row[] = [
  ['auto','auto','Auto','automobile','coche','car'], ['lippenstift','lippenstift','Lippenstift','rouge à lèvres','lápiz labial','lipstick'],
  ['restaurant','restaurant','Restaurant','restaurant','restaurante','restaurant'], ['schoen','schoen','Schuh','chaussure','zapato','shoe'],
  ['telefoon','telefoon','Telefon','téléphone','teléfono','telephone'], ['koffie','koffie','Kaffee','café','café','coffee'],
  ['suiker','suiker','Zucker','sucre','azúcar','sugar'], ['school','school','Schule','école','escuela','school'],
  ['wijn','wijn','Wein','vin','vino','wine'], ['fiets','fiets','Fahrrad','bicyclette','bicicleta','bicycle'],
  ['chocolade','chocolade','Schokolade','chocolat','chocolate','chocolate'], ['bibliotheek','bibliotheek','Bibliothek','bibliothèque','biblioteca','library'],
  ['interview','interview','Interview','interview','entrevista','interview'], ['televisie','televisie','Fernsehen','télévision','televisión','television'],
  ['presentatie','presentatie','Präsentation','présentation','presentación','presentation'], ['presentator','presentator','Moderatorin','présentatrice','presentadora','presenter'],
  ['president','president','Präsident','président','presidente','president'], ['cadeau','cadeau','Geschenk','cadeau','regalo','gift'],
  ['idee','idee','Idee','idée','idea','Idea'], ['radio','radio','Radio','radio','radio','radio'],
  ['robot','robot','Roboter','robot','robot','Robot'], ['reactie','reactie','Reaktion','réaction','reacción','reaction'],
  ['baby','','Baby','bébé','bebe','baby'], ['casino','','Kasino','casino','casino','casino'],
  ['banaan','','Banane','banane','plátano','banana'], ['citroen','','Zitrone','citron','limón','lemon'],
  ['sinaasappel','','Orange','orange','naranja','orange'], ['nummer','','Nummer','numéro','número','number'],
  ['piano','','Klavier','piano','piano','piano'], ['gitaar','','Gitarre','guitare','guitarra','guitar'],
  ['viool','','Geige','violon','violín','violin']
];
const adjectives: Row[] = [
  ['groot','groot','groß','grand','grande','big'], ['klein','klein','klein','petit','pequeño','small'],
  ['oud','oud','alt','vieux','viejo','old'], ['nieuw','nieuw','neu','nouveau','nuevo','new'],
  ['snel','snel','schnell','vite','rápido','fast'], ['sloom','sloom','langsam','lent','lento','slow'],
  ['saai','saai','langweilig','ennuyeuse','aburrido','boring'], ['zacht','zacht','weich','doux','suave','soft'],
  ['jong','jong','jung','jeune','joven','young'], ['speciaal','speciaal','besondere','spécial','especial','special'],
  ['intelligent','intelligent','intelligent','intelligent','inteligente','intelligent'],
  ['enthousiast','enthousiast','enthusiast','enthousiaste','entusiasta','enthusiast'],
  ['sportief','sportief','sportlich','sportif','deportivo','sporty'], ['blauw','blauw','blau','bleu','azul','blue']
];
function makeWords(rows: Row[], partOfSpeech: Word['partOfSpeech'], chapter: string): Word[] {
  return rows.map(([id, nl, de, fr, es, en, context]) => {
    const forms: Partial<Record<Language, string>> = {};
    for (const [language, value] of [['nl', nl], ['de', de], ['fr', fr], ['es', es], ['en', en]] as const) if (value) forms[language] = value;
    const alternatives: Word['alternatives'] = {};
    for (const language of ['nl', 'de', 'fr', 'es', 'en'] as const) {
      const value = forms[language];
      if (value && /,|\//.test(value)) alternatives[language] = value.split(/,\s*|\//).map((s) => s.trim());
    }
    const cropped = !nl;
    const uncertain = cropped || id === 'presentator' || id === 'speciaal' || id === 'baby';
    return { id: `${partOfSpeech}-${id}`, chapter, partOfSpeech, forms, alternatives, ...(context ? { context } : {}), revision: 1, reviewed: !uncertain, enabled: true,
      ...(uncertain ? { note: cropped ? 'Nederlandse kolom is afgesneden op de foto; controleer en vul aan.' : 'Controleer de vorm en betekenis met de foto of docent.' } : {}) };
  });
}
export const seedWords: Word[] = [
  ...makeWords(verbs, 'verb', '4.2 Werkwoorden'),
  ...makeWords(nouns, 'noun', '4.3 Zelfstandige naamwoorden'),
  ...makeWords(adjectives, 'adjective', '4.4 Bijvoeglijke naamwoorden')
];
