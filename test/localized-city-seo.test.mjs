import test from "node:test";
import assert from "node:assert/strict";
import { localLanguageForCity, localizedCityUrl, cityCopy } from "../src/city-localization.mjs";
import { cityPageHtml, localizedCityPageHtml, sitemapXml } from "../src/build-seo-site.mjs";

const siteBase = "https://bl0ck154.github.io/wolt-discount-monitor/";
const city = { id:"deu/berlin", key:"deu-berlin", name:"Berlin", country:"Germany", countryCode2:"DE", label:"Berlin, Germany" };
const venues = Array.from({ length: 12 }, (_, i) => ({
  name: "Venue " + i, link: "https://wolt.com/en/deu/berlin/venue/example-" + i,
  offers: [{text:"10 € off (spend 15 €)", value:{score:80}},
    ...(i === 0 ? [{text:"20% off entire menu", value:{score:75}, amount:20, amountType:"percent"}]:[])],
}));
const snapshot = {generatedAt:"2026-11-02T02:00:00Z",
  counts:{restaurantsUniqueVenues:12,promotionsUniqueVenues:12}, venues};

test("native-language city pages use self canonical and reciprocal hreflang", () => {
 const html = localizedCityPageHtml({city,snapshot,language:"de",siteBase});
 assert.match(html, /<html lang="de">/);
 assert.match(html, /Wolt-Angebote in Berlin/);
 assert.match(html, /rel="canonical" href="https:\/\/bl0ck154\.github\.io\/wolt-discount-monitor\/de\/cities\/deu\/berlin\/"/);
 assert.match(html, /hreflang="en"/);
 assert.match(html, /hreflang="de"/);
 assert.match(html, /hreflang="x-default"/);
 assert.match(html, /"inLanguage":"de"/);
 assert.doesNotMatch(html, /10 € off \(spend 15 €\)/);
 assert.match(html, /20% off entire menu/);
 const english = cityPageHtml({city,snapshot,indexable:true,siteBase});
 assert.match(english, /hreflang="de"/);
 assert.match(english, /<html lang="en">/);
});
test("locales are country-scoped, and unavailable snapshots cannot be indexed", () => {
 for(const [code,lang] of [["DE","de"],["LT","lt"],["PL","pl"],["CZ","cs"],["FI","en"]]){
  assert.equal(localLanguageForCity({countryCode2:code}),lang);
 }
 assert.equal(localizedCityUrl(city,siteBase),"https://bl0ck154.github.io/wolt-discount-monitor/de/cities/deu/berlin/");
 assert.throws(()=>localizedCityPageHtml({city,snapshot,indexable:false,language:"de",siteBase}));
 assert.match(cityCopy("pl","h1",{city:"Warszawa"}),/Warszawa/);
});
test("sitemap includes localized city URLs only for recent indexable records", () => {
 const liveRecords=[{city,snapshot,indexable:true}];
 const xml=sitemapXml({siteBase,liveRecords});
 assert.match(xml, /wolt-discount-monitor\/de\/cities\/deu\/berlin\//);
 const stale=sitemapXml({siteBase,liveRecords:[]});
 assert.doesNotMatch(stale, /\/de\/cities\/deu\/berlin\//);
});
