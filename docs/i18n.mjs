// Independent consumer UI translations; original Wolt promotion text is unchanged.
const en = {
  deals: "Offers worth checking", hero: "Choose your city. Compare restaurant and grocery offers without scrolling through Wolt venue by venue. Check the final price in Wolt before ordering.",
  hideNew: "Hide likely new-customer & repeated offers", hideDelivery: "Hide delivery discounts",
  hideClosed: "Hide venues closed when checked", onlyOffers: "Only venues with offers",
  favoritesOnly: "Saved only", updated: "Updated", search: "Search deals",
  open: "Open at last scan", closed: "Closed at last scan", unknown: "Status not verified",
  type: "Type", sort: "Sort", allTypes: "All types"
};
const dictionary = {
  en: { ...en, rankedVenues: "Ranked deal venues", scannedVenues: "Scanned venues" },
  de: {
    deals: "Angebote zum Entdecken", hero: "Wähle deine Stadt und vergleiche Restaurant- und Lebensmittelangebote. Prüfe den Endpreis bei Wolt.",
    hideNew: "Neukunden- und wiederholte Aktionen ausblenden", hideDelivery: "Lieferrabatte ausblenden",
    hideClosed: "Bei der Prüfung geschlossene Geschäfte ausblenden", onlyOffers: "Nur mit Angeboten",
    favoritesOnly: "Nur gemerkte", updated: "Aktualisiert", search: "Angebote suchen",
    open: "Bei letzter Prüfung geöffnet", closed: "Bei letzter Prüfung geschlossen",
    unknown: "Status nicht bestätigt", type: "Kategorie", sort: "Sortieren", allTypes: "Alle Kategorien"
  },
  lt: {
    deals: "Verta patikrinti", hero: "Pasirinkite miestą ir palyginkite restoranų bei parduotuvių pasiūlymus. Galutinę kainą patikrinkite Wolt.",
    hideNew: "Slėpti naujų klientų ir pasikartojančias akcijas", hideDelivery: "Slėpti pristatymo nuolaidas",
    hideClosed: "Slėpti paskutinio tikrinimo metu uždarytas vietas", onlyOffers: "Tik su pasiūlymais",
    favoritesOnly: "Tik išsaugoti", updated: "Atnaujinta", search: "Ieškoti pasiūlymų",
    open: "Veikė paskutinio tikrinimo metu", closed: "Neveikė paskutinio tikrinimo metu",
    unknown: "Būsena nepatvirtinta", type: "Kategorija", sort: "Rikiuoti", allTypes: "Visos kategorijos"
  },
  pl: {
    deals: "Oferty warte sprawdzenia", hero: "Wybierz miasto i porównaj promocje restauracji i sklepów. Sprawdź cenę końcową w Wolt.",
    hideNew: "Ukryj promocje dla nowych klientów i powtarzające się", hideDelivery: "Ukryj rabaty na dostawę",
    hideClosed: "Ukryj lokale zamknięte przy ostatnim sprawdzeniu", onlyOffers: "Tylko z ofertami",
    favoritesOnly: "Tylko zapisane", updated: "Aktualizacja", search: "Szukaj ofert",
    open: "Otwarte przy ostatnim sprawdzeniu", closed: "Zamknięte przy ostatnim sprawdzeniu",
    unknown: "Status niepotwierdzony", type: "Rodzaj", sort: "Sortuj", allTypes: "Wszystkie rodzaje"
  },
  cs: {
    deals: "Nabídky, které stojí za kontrolu", hero: "Vyberte město a porovnejte nabídky restaurací a obchodů. Konečnou cenu ověřte na Wolt.",
    hideNew: "Skrýt akce pro nové zákazníky a opakované akce", hideDelivery: "Skrýt slevy na doručení",
    hideClosed: "Skrýt podniky zavřené při poslední kontrole", onlyOffers: "Jen s nabídkami",
    favoritesOnly: "Jen uložené", updated: "Aktualizováno", search: "Hledat nabídky",
    open: "Otevřeno při poslední kontrole", closed: "Zavřeno při poslední kontrole",
    unknown: "Stav nepotvrzen", type: "Kategorie", sort: "Řadit", allTypes: "Všechny kategorie"
  },
};
export function normalizeLanguage(value) {
 const language = String(value ?? "").toLowerCase().split("-")[0];
 return Object.hasOwn(dictionary, language) ? language : "en";
}
export function translate(language, key) {
 return dictionary[normalizeLanguage(language)][key] ?? dictionary.en[key] ?? en[key] ?? key;
}
