import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleVenueCount } from "../docs/deal-visibility.mjs";
import { offerScore } from "./offer-value.mjs";
export const START = "<!-- AUTO_COVERAGE_START -->";
export const END = "<!-- AUTO_COVERAGE_END -->";
async function readMaybe(path) {
 try { return JSON.parse(await readFile(path,"utf8")); }
 catch(error) { if(error.code==="ENOENT") return null; throw error; }
}
export async function coverageMarkdown(cities, {docsDir,now=new Date()}) {
 const rows=[];
 for(const city of cities) {
  if(!/^data\/(?:latest\.json|cities\/[a-z0-9-]+\/latest\.json)$/.test(city.latestPath??""))continue;
  const snapshot=await readMaybe(join(docsDir,city.latestPath));
  if(!snapshot?.generatedAt||!Array.isArray(snapshot.venues))continue;
  const dateMs=Date.parse(snapshot.generatedAt);
  if(!Number.isFinite(dateMs)||dateMs>now.getTime()+300000)continue;
  rows.push({city,dateMs,ranked:visibleVenueCount(snapshot.venues,offerScore).ranked});
 }
 rows.sort((a,b)=>b.dateMs-a.dateMs||String(a.city.name).localeCompare(String(b.city.name)));
 const recent=rows.filter(x=>x.dateMs<=now.getTime()&&now.getTime()-x.dateMs<86400000);
 const lines=[
  "### Latest snapshot coverage",
  "",
  "**"+rows.length+" cities with stored snapshots**, including **"+recent.length+" updated within 24 hours** as of "+now.toISOString().slice(0,16).replace("T"," ")+" UTC. The full catalog is much larger; catalog membership does not mean fresh deals are available.",
  "",
  "| City | Last scan (UTC) | Ranked deal venues |",
  "| --- | --- | ---: |"
 ];
 for (const {city,dateMs,ranked} of rows.slice(0,10)) {
  const label=String(city.name||city.id||"").replaceAll("|","\|");
  lines.push("| ["+label+"](https://bl0ck154.github.io/wolt-discount-monitor/?city="+encodeURIComponent(city.id)+") | "+new Date(dateMs).toISOString().slice(0,16).replace("T"," ")+" | "+ranked+" |");
 }
 lines.push("","Offers are observed, not personalized. Check eligibility and the final delivery/service fees in Wolt.");
 return lines.join("\n");
}
export async function syncCatalogStats({
 indexPath=fileURLToPath(new URL("../docs/data/cities.json",import.meta.url)),
 readmePath=fileURLToPath(new URL("../README.md",import.meta.url)),
 docsDir=dirname(dirname(indexPath)),now=new Date(),check=false
}={}) {
 const index=JSON.parse(await readFile(indexPath,"utf8"));
 const totalCities=index.cities?.length;
 const countries=new Set((index.cities??[]).map(c=>c.countryCode2)).size;
 if(!Number.isInteger(totalCities)||totalCities<=0||countries<=0)throw Error("Cannot update README from empty city catalog");
 const input=await readFile(readmePath,"utf8");
 let output=input
  .replace(/discovered_cities-\d+-/,"discovered_cities-"+totalCities+"-")
  .replace(/countries-\d+-/,"countries-"+countries+"-")
  .replace(/Search a discovered catalog of \*\*\d+ Wolt cities across \d+ countries\*\*/,"Search a discovered catalog of **"+totalCities+" Wolt cities across "+countries+" countries**");
 if(input.includes(START)||input.includes(END)) {
  if(input.split(START).length!==2||input.split(END).length!==2)throw Error("README coverage markers missing or duplicated");
  const start=output.indexOf(START),end=output.indexOf(END);
  if(end<=start)throw Error("README auto-coverage marker order invalid");
  const stableNow = index.generatedAt ? new Date(index.generatedAt) : now;
  const content=await coverageMarkdown(index.cities,{docsDir,now:stableNow});
  output=output.slice(0,start+START.length)+"\n"+content+"\n"+output.slice(end);
 }
 if(output===input&&!input.includes("discovered_cities-"+totalCities+"-"))throw Error("README count markers changed");
 if(check&&output!==input)throw Error("README coverage out of sync: run npm run readme:sync");
 if(!check&&output!==input)await writeFile(readmePath,output);
 return {totalCities,countries,changed:output!==input};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 syncCatalogStats({check:process.argv.includes("--check")}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1;});
}
