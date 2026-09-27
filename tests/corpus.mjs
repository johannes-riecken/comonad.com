import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
const json=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const corpus=json('content/corpus.json'),articles=json('content/articles.json'),collections=json('content/collections.json');
for(const [url,record] of Object.entries(corpus.downloads))assert.equal(hash(record.file),record.sha256,`Snapshot unchanged: ${url}`);
for(const asset of json('content/assets-manifest.json').filter(a=>a.path))assert.equal(hash('content/'+asset.path),asset.sha256,`Asset unchanged: ${asset.url}`);
for(const source of [...corpus.blog,...corpus.school])assert.ok([...articles,...collections].some(a=>a.origin===source.origin||a.aliases?.includes(source.origin)),`Catalog item imported: ${source.origin}`);
const doc=parseHTML(fs.readFileSync('dist/reader/index.html','utf8')).document;
const entries=[...doc.querySelectorAll('.archive-entry')];
const videos=[...json('content/boston-haskell-videos.json').videos,...json('content/external-talks.json').videos];
assert.equal(entries.length,articles.length+new Set(videos.map(v=>v.videoId)).size+json('content/publications.json').length);
const dates=entries.map(a=>a.querySelector('time').getAttribute('datetime'));
assert.deepEqual(dates,[...dates].sort((a,b)=>b.localeCompare(a)),'Interleaved archive date order');
for(const v of videos){
  const file=`dist/reader/talks/${v.id}/index.html`,d=parseHTML(fs.readFileSync(file,'utf8')).document;
  assert.equal(d.querySelector('[data-video-id]').getAttribute('data-video-id'),v.videoId);
  const player=d.querySelector('iframe');
  assert.equal(d.querySelectorAll('iframe').length,1,'One native inline player per talk');
  assert.equal(player.getAttribute('src'),`https://www.youtube-nocookie.com/embed/${v.videoId}?playsinline=1`);
  assert.ok(player.hasAttribute('allowfullscreen'));
  assert.equal(player.getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
  assert.equal(d.querySelectorAll('.load-video').length,0,'No opaque player placeholder');
  assert.ok(d.querySelector('.talk-speakers').textContent.includes(''+v.speakers[0]),'Speaker attribution');
}
const learning=entries.find(e=>e.textContent.includes('Learning to Learn'));
assert.equal(learning.querySelector('time').getAttribute('datetime'),'2014','Use presentation year, not mirror upload');
console.log(`Corpus checks passed: ${Object.keys(corpus.downloads).length} source hashes, all catalog items represented, ${entries.length} dated entries and ${videos.length} local talk pages.`);

for(const asset of json('content/external-preservation.json').filter(a=>a.path)){
 assert.equal(hash(asset.path),asset.sha256,'Preserved external source hash: '+asset.path);
 if(asset.path.startsWith('content/assets/'))assert.equal(hash(asset.path.replace('content/','dist/')),asset.sha256,'Published asset is complete');
}
for(const publication of json('content/publications.json')){
 const page=parseHTML(fs.readFileSync('dist/'+publication.path+'index.html','utf8')).document;
 assert.equal(page.querySelector('h1').textContent,publication.title);
 assert.equal(page.querySelector('.talk-speakers').textContent,publication.authors.join(', '));
 if(publication.deck)assert.equal(page.querySelectorAll('.slide-deck img').length,publication.pages);
 if(publication.pdf)assert.equal(page.querySelector('object').getAttribute('type'),'application/pdf');
}
for(const entry of entries)assert.ok(entry.querySelector('.entry-author').textContent.trim(),'Every entry has an author');
for(const v of videos){
 const page=parseHTML(fs.readFileSync(`dist/reader/talks/${v.id}/index.html`,'utf8')).document;
 assert.equal(page.querySelector('h1').textContent,v.displayTitle||v.title);
 if(v.publisher.includes('Boston Haskell'))assert.ok(!/Boston Haskell/i.test(page.querySelector('h1').textContent),'Boston Haskell belongs in the event label');
 if(v.seriesId==='monadic-party-2019-guanxi'){
   assert.equal(v.displayTitle,`Guanxi: Logic Programming in Haskell — Part ${v.sequence} of 4`);
   assert.deepEqual([...page.querySelectorAll('[aria-label="Talk series"] a')].map(a=>a.textContent),['Part 1','Part 2','Part 3','Part 4']);
 }
}

for(const record of Object.values(json('content/talk-thumbnails.json')).filter(r=>r.path)){
 assert.equal(hash('content/'+record.path),record.sha256,'Locally preserved thumbnail');
 assert.equal(hash('dist/'+record.path),record.sha256,'Published thumbnail');
}
assert.ok(doc.querySelector('#archive-count').textContent.includes('1 paper'));
assert.equal(doc.querySelectorAll('.archive-entry[data-kind="Article"] .talk-thumbnail').length,0);

const streams=videos.filter(v=>v.archiveType==='stream').sort((a,b)=>a.sequence-b.sequence);
assert.equal(streams.length,31);
assert.deepEqual([...new Set(streams.map(v=>Math.floor(v.sequence)))],Array.from({length:26},(_,i)=>i+1));
const streamIndex=parseHTML(fs.readFileSync('dist/reader/series/live-coding/index.html','utf8')).document;
assert.deepEqual([...streamIndex.querySelectorAll('.prose ol a')].map(a=>a.textContent),streams.map(v=>v.displayTitle));
const split=parseHTML(fs.readFileSync('dist/reader/talks/live-coding-14-2/index.html','utf8')).document;
const adjacent=[...split.querySelectorAll('[aria-label="Live coding series"] p a')].map(a=>a.textContent);
assert.deepEqual(adjacent,['Live Coding','Session 14.1','Session 14.3']);
const wavelets=articles.find(a=>a.slug==='wavelets-in-3d-graphics');
assert.equal(wavelets.date,'1995');assert.equal(wavelets.dateApproximate,true);
const lambdaWorld=videos.find(v=>v.id==='there-and-back-again-lambda-world-2018');
assert.equal(lambdaWorld.eventDate,'2018-09-18');
assert.equal(lambdaWorld.uploadDate,'2018-11-06');

const seriesPage=parseHTML(fs.readFileSync('dist/reader/series/index.html','utf8')).document;
assert.ok([...doc.querySelectorAll('#archive-kind option')].some(n=>n.textContent==='Series'));
assert.equal(seriesPage.querySelector('#archive-kind [selected]').textContent,'Series');
assert.ok(seriesPage.querySelector('.chronological').hasAttribute('hidden'));
assert.ok(!seriesPage.querySelector('.series-results').hasAttribute('hidden'));
for(const card of seriesPage.querySelectorAll('.series-entry')){
 const href=card.querySelector('h3 a').getAttribute('href');
 assert.ok(fs.existsSync(new URL(href+'index.html','file://'+process.cwd()+'/dist/reader/series/')),'Every series card opens a local page');
 const members=[...card.querySelectorAll('.series-members li a')];
 assert.equal(members.length,Number(card.querySelector('.entry-date span:last-child').textContent.split(' ')[0]),'Every series part is individually linked');
 for(const part of members)assert.ok(fs.existsSync(new URL(part.getAttribute('href')+'index.html','file://'+process.cwd()+'/dist/reader/series/')),'Series part opens a local page');
}
const nominalDoc=parseHTML(fs.readFileSync('dist/reader/talks/live-coding-18/index.html','utf8')).document;
assert.ok(nominalDoc.querySelector('.prose a[href="https://github.com/ekmett/name"]'),'Recording URL is clickable');
assert.ok([...nominalDoc.querySelectorAll('.prose code')].some(n=>n.textContent==='nominal'),'Recording Markdown is formatted');
assert.ok(!nominalDoc.querySelector('a[href="https://hackage.haskell.org/package/nominal"]'),'Do not link an unrelated namesake package');
const packages=json('content/package-links.json');
const packageDoc=parseHTML(fs.readFileSync('dist/reader/packages/index.html','utf8')).document;
for(const [id,names] of Object.entries(packages.talks).filter(([id])=>id.startsWith('live-coding-'))){
 const page=parseHTML(fs.readFileSync(`dist/reader/talks/${id}/index.html`,'utf8')).document;
 for(const name of names){
  assert.ok(page.querySelector(`a[href="${packages.packages[name].url}"]`));
  assert.ok(packageDoc.querySelector(`#${name} a[href="../../reader/talks/${id}/"]`),'Package index links back to stream');
 }
}

const optics=parseHTML(fs.readFileSync('dist/reader/talks/linear-optics-bx-2021/index.html','utf8')).document;
assert.ok(optics.querySelector('a[href="https://github.com/ekmett/linear-logic"]'));
for(const slug of ['cellular-automata-part-2','cellular-automata-part-3','snippets-mandelbrot']){
 const entry=articles.find(a=>a.slug===slug);const page=parseHTML(fs.readFileSync('dist/'+entry.path+'index.html','utf8')).document;
 assert.equal(page.querySelectorAll('[data-image-demo]').length,1);
 assert.ok(page.querySelector('script[src$="png-demos.js"]'));
 const data=JSON.parse(page.querySelector('script[type="application/ld+json"]').textContent);
 assert.equal(data.datePublished,entry.authoredDate);assert.equal(data.dateModified,entry.dateModified);
}

const vrDemo=videos.find(v=>v.videoId==='pBjzyi3YVVA');
assert.equal(vrDemo.date,'2016-09-14');
assert.equal(vrDemo.archiveType,'demo');
const vrPage=parseHTML(fs.readFileSync('dist/reader/talks/vr-test-framework-2016/index.html','utf8')).document;
assert.ok(vrPage.querySelector('a[href="https://github.com/ekmett/vr"]'));
assert.ok(vrPage.querySelector('.talk-video figcaption').textContent.includes('1 minute'));
assert.ok(!vrPage.querySelector('.talk-video figcaption').textContent.includes('1 minutes'));
assert.equal(doc.querySelectorAll('.archive-entry[data-kind="Demo"]').length,3);
