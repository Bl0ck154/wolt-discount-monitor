// Native-language SEO copy, generated only for recently scanned cities.
const COPY = {
  "de": {
    "title": "Wolt-Angebote in {city} | Rabatte und Aktionen",
    "description": "Vergleiche {count} bewertete Wolt-Angebote in {city}, {country}. Die Angebote stammen aus einem aktuellen Scan; Endpreis und Bedingungen bitte bei Wolt prüfen.",
    "h1": "Wolt-Angebote in {city}",
    "intro": "Vergleiche öffentliche Wolt-Aktionen in {label}, ohne jedes Geschäft einzeln zu öffnen. Alle Preise, Bedingungen und Öffnungszeiten müssen vor der Bestellung bei Wolt geprüft werden.",
    "status": "Kürzlich geprüft · {time}",
    "home": "Startseite",
    "open": "Angebote vergleichen",
    "rss": "Neue Angebote per RSS",
    "openWolt": "{city} bei Wolt öffnen",
    "ranked": "Bewertete Angebote",
    "restaurants": "Restaurants",
    "snapshot": "Letzter Scan",
    "best": "Ausgewählte Angebote in {city}",
    "hint": "Diese Angebote wurden im letzten Scan beobachtet und nach geschätztem Wert geordnet. Persönliche Berechtigung ist nicht bestätigt.",
    "other": "Weitere Wolt-Städte in {country}",
    "related": "Entdecke weitere Städte. Seiten mit frischen Angeboten sind entsprechend gekennzeichnet.",
    "fresh": "Aktuelle Angebote",
    "catalog": "Katalogseite"
  },
  "lt": {
    "title": "Wolt pasiūlymai mieste {city} | Nuolaidos ir akcijos",
    "description": "Palyginkite {count} įvertintų Wolt pasiūlymų mieste {city}, {country}. Duomenys iš naujausio patikrinimo; galutinę kainą ir sąlygas tikrinkite Wolt.",
    "h1": "Wolt pasiūlymai mieste {city}",
    "intro": "Palyginkite viešas Wolt akcijas mieste {label}, neatsidarydami kiekvienos parduotuvės. Prieš užsakydami patikrinkite kainą, sąlygas ir darbo laiką Wolt.",
    "status": "Neseniai patikrinta · {time}",
    "home": "Pradžia",
    "open": "Palyginti pasiūlymus",
    "rss": "Nauji pasiūlymai per RSS",
    "openWolt": "Atidaryti {city} Wolt",
    "ranked": "Įvertinti pasiūlymai",
    "restaurants": "Restoranai",
    "snapshot": "Patikrinimo laikas",
    "best": "Atrinkti pasiūlymai mieste {city}",
    "hint": "Pasiūlymai surinkti paskutinio patikrinimo metu ir surikiuoti pagal numatomą vertę. Paskyros tinkamumas nepatvirtintas.",
    "other": "Kiti Wolt miestai šalyje {country}",
    "related": "Peržiūrėkite kitus miestus. Nauji pasiūlymai pažymimi atskirai.",
    "fresh": "Nauji pasiūlymai",
    "catalog": "Miestų katalogas"
  },
  "pl": {
    "title": "Promocje Wolt w {city} | Rabaty i oferty",
    "description": "Porównaj {count} ocenionych promocji Wolt w {city}, {country}. Dane pochodzą z ostatniego skanu; ostateczną cenę i warunki sprawdź w Wolt.",
    "h1": "Promocje Wolt w {city}",
    "intro": "Porównuj publiczne promocje Wolt w {label} bez sprawdzania każdego lokalu osobno. Przed zamówieniem potwierdź cenę, warunki i godziny w Wolt.",
    "status": "Niedawno sprawdzone · {time}",
    "home": "Strona główna",
    "open": "Porównaj promocje",
    "rss": "Nowe oferty przez RSS",
    "openWolt": "Otwórz {city} w Wolt",
    "ranked": "Ocenione oferty",
    "restaurants": "Restauracje",
    "snapshot": "Ostatni skan",
    "best": "Wybrane promocje Wolt w {city}",
    "hint": "Oferty pochodzą z ostatniego skanu i są posortowane według szacowanej wartości. Uprawnienia konta nie są potwierdzone.",
    "other": "Inne miasta Wolt w {country}",
    "related": "Przeglądaj inne miasta. Strony z aktualnymi ofertami są oznaczone osobno.",
    "fresh": "Aktualne oferty",
    "catalog": "Katalog miast"
  },
  "cs": {
    "title": "Akce Wolt v {city} | Slevy a nabídky",
    "description": "Porovnejte {count} hodnocených nabídek Wolt ve městě {city}, {country}. Údaje pocházejí z nedávné kontroly; cenu a podmínky ověřte na Wolt.",
    "h1": "Nabídky Wolt v {city}",
    "intro": "Porovnejte veřejné akce Wolt ve městě {label}, aniž byste procházeli každý podnik. Před objednáním ověřte cenu, podmínky a otevírací dobu na Wolt.",
    "status": "Nedávno zkontrolováno · {time}",
    "home": "Úvod",
    "open": "Porovnat nabídky",
    "rss": "Nové nabídky přes RSS",
    "openWolt": "Otevřít {city} na Wolt",
    "ranked": "Hodnocené nabídky",
    "restaurants": "Restaurace",
    "snapshot": "Poslední kontrola",
    "best": "Vybrané nabídky Wolt v {city}",
    "hint": "Nabídky byly nalezeny při poslední kontrole a seřazeny podle odhadované hodnoty. Nárok konkrétního účtu není ověřen.",
    "other": "Další města Wolt v {country}",
    "related": "Prohlédněte si další města. Stránky s aktuálními nabídkami jsou označeny zvlášť.",
    "fresh": "Aktuální nabídky",
    "catalog": "Katalog měst"
  }
};
const COUNTRY_LANGUAGES = { DE: "de", LT: "lt", PL: "pl", CZ: "cs" };
export function localLanguageForCity(city) {
  return COUNTRY_LANGUAGES[String(city?.countryCode2 ?? "").toUpperCase()] ?? "en";
}
export function cityCopy(lang, key, values = {}) {
  const template = COPY[lang]?.[key] ?? "";
  return template.replace(/\{([a-zA-Z]+)\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : token);
}
export function localizedCityUrl(city, base, lang = localLanguageForCity(city)) {
  if (lang === "en") return new URL("cities/" + city.id + "/", base).href;
  return new URL(lang + "/cities/" + city.id + "/", base).href;
}
