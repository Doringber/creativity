const { chromium } = require("playwright");
const http = require("http"); const fs = require("fs"); const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png" };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split("?")[0]); if (p==="/")p="/index.html";
  fs.readFile(path.join(ROOT,p),(e,d)=>{ if(e){res.writeHead(404);res.end();return;} res.writeHead(200,{"Content-Type":MIME[path.extname(p)]||"application/octet-stream"}); res.end(d); }); });

(async () => {
  await new Promise((r) => server.listen(8099, r));
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--use-gl=swiftshader","--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["camera"] });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8099/index.html");
  await page.waitForTimeout(1200);
  await page.click("#play-btn");
  await page.waitForTimeout(2600);

  async function vis(tag) {
    const buf = await page.screenshot();
    const url = "data:image/png;base64," + buf.toString("base64");
    const px = await page.evaluate(async (u) => { const i=new Image(); i.src=u; await i.decode();
      const c=document.createElement("canvas"); c.width=i.width;c.height=i.height; const g=c.getContext("2d"); g.drawImage(i,0,0);
      const d=g.getImageData(Math.floor(i.width/2),Math.floor(i.height*0.4),1,1).data; return [d[0],d[1],d[2]]; }, url);
    const green = px[1] > 90 && px[1] > px[0]+30 && px[1] > px[2]+30;
    console.log(`${tag}: rgb(${px}) -> camera ${green?"VISIBLE ✅":"GONE ❌"}`); return green;
  }

  const base = await vis("playing");
  // exercise the REAL fever path: add the body state class the engine now uses
  await page.evaluate(() => document.body.classList.add("fevermode"));
  await page.waitForTimeout(700);
  const fever = await vis("FEVER");
  await page.screenshot({ path: "tools/verify_fever.png" });
  // also confirm the body did NOT get turned into the tiny bar
  const bodyBox = await page.evaluate(() => { const b=getComputedStyle(document.body); return {position:b.position,height:b.height,overflow:b.overflow,transform:b.transform}; });
  console.log("body computed during fever:", JSON.stringify(bodyBox));

  console.log(base && fever ? "\nRESULT: PASS — camera stays visible through Fever ✅" : "\nRESULT: FAIL ❌");
  await browser.close(); server.close();
})();
