import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {syncCatalogStats,coverageMarkdown,START,END} from "../src/sync-catalog-stats.mjs";

test("README coverage lists snapshot venues and survives repeated sync", async () => {
 const dir=await mkdtemp(join(tmpdir(),"readme-wolt-"));
 try {
  await mkdir(join(dir,"data","cities","deu-berlin"),{recursive:true});
  const now="2026-11-02T07:00:00Z";
  const indexPath=join(dir,"data","cities.json");
  const readmePath=join(dir,"README.md");
  await writeFile(indexPath,JSON.stringify({generatedAt:now,cities:[
   {id:"deu/berlin",name:"Berlin",countryCode2:"DE",latestPath:"data/cities/deu-berlin/latest.json"},
   {id:"ltu/vilnius",name:"Vilnius",countryCode2:"LT",latestPath:"data/cities/ltu-vilnius/latest.json"},
   {id:"no-data",name:"Missing",countryCode2:"LT"}
  ]}));
  await writeFile(join(dir,"data","cities","deu-berlin","latest.json"),JSON.stringify({
    generatedAt:"2026-11-02T06:00:00Z",venues:[{name:"One",
      offers:[{text:"20% off",amount:20,amountType:"percent",value:{score:60,scope:"broad"}}]}]
  }));
  // The test fixture intentionally has no usable Vilnius snapshot.
  await writeFile(readmePath,START+"\n\n"+END+"\n![Cities](discovered_cities-967-blue)\n![Countries](countries-30-green)\nSearch a discovered catalog of **967 Wolt cities across 30 countries**.");
  const first=await syncCatalogStats({indexPath,readmePath});
  const readme=await readFile(readmePath,"utf8");
  assert.equal(first.totalCities,3);
  assert.match(readme,/1 cities with stored snapshots/);
  assert.match(readme,/Berlin/);
  assert.doesNotMatch(readme,/Missing\]\(/);
  assert.equal((await syncCatalogStats({indexPath,readmePath,check:true})).changed,false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test("rejects bad auto-generated README delimiters",async()=>{
 const html=await coverageMarkdown([],{docsDir:"/tmp",now:new Date("2026-11-02T07:00:00Z")});
 assert.match(html,/0 cities with stored snapshots/);
});
