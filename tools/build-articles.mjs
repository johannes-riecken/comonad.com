// All rendering happens at build time. Serving dist needs no compiler, database,
// CDN, or access to either original host.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import haskell from 'highlight.js/lib/languages/haskell';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import ocaml from 'highlight.js/lib/languages/ocaml';
import scheme from 'highlight.js/lib/languages/scheme';
import prolog from 'highlight.js/lib/languages/prolog';
import katex from 'katex';
import { parseHTML } from 'linkedom';
import { buildQuine } from './build-quine.mjs';
import { readerNavigation } from './reader-navigation.mjs';
import { createSite } from './site-metadata.mjs';
import { crcMath } from './article-math.mjs';
import { packageNames, linkPackageMentions } from './package-links.mjs';
const packageCatalog = JSON.parse(fs.readFileSync('content/package-links.json','utf8'));
const siteConfig=JSON.parse(fs.readFileSync('content/site.json','utf8'));
if(process.env.READER_SITE_URL)siteConfig.baseUrl=process.env.READER_SITE_URL;
const publicSite=createSite(siteConfig);
import { loadArchive, archiveLookup, buildArchive, localArchiveLink } from './haskell-archive.mjs';

hljs.registerLanguage('haskell', haskell);
for (const [name, grammar] of Object.entries({c,cpp,ocaml,scheme,prolog})) hljs.registerLanguage(name,grammar);
const articles = JSON.parse(fs.readFileSync('content/articles.json', 'utf8'));
const originalReaderArchive = new Map(JSON.parse(fs.readFileSync('content/original-reader-archive.json', 'utf8')).articles.filter(a => a.status === 'present').map(a => [a.slug, a.archiveUrl]));
const repositoryCatalog = JSON.parse(fs.readFileSync('content/github-repositories.json', 'utf8'));
const repositories = repositoryCatalog.repositories.filter(repo=>!repo.fork || repositoryCatalog.alwaysInclude.includes(repo.name));
const newestFirst=(a,b)=>b.date.localeCompare(a.date)||((a.series&&a.series===b.series)?(b.seriesOrder||0)-(a.seriesOrder||0):0)||a.title.localeCompare(b.title);
articles.sort(newestFirst);
const collections = JSON.parse(fs.readFileSync('content/collections.json','utf8'));
const videoSources=['content/boston-haskell-videos.json','content/external-talks.json'].filter(f=>fs.existsSync(f)).flatMap(f=>{const data=JSON.parse(fs.readFileSync(f,'utf8'));return data.videos || data;});
function dateLabel(date) {
  if(date.length===4)return date+' · day unknown';
  if(date.length===7)return new Date(date+'-01T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})+' · day unknown';
  return new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
}
function durationLabel(seconds){
  const n=seconds<60?seconds:Math.floor(seconds/60),unit=seconds<60?'second':'minute';
  return n+' '+unit+(n===1?'':'s');
}
const videos=[...new Map(videoSources.map(v=>[v.videoId || v.id,v])).values()].map(v=>{
  const date=v.eventDate||v.eventMonth||v.eventYear||v.date;
  const dateNote=v.eventDate||v.eventMonth||v.eventYear?'':v.dateBasis==='publication'?' · published':' · uploaded';
  return {...v,title:v.displayTitle||v.title,originalTitle:v.title,date,dateNote,path:`reader/talks/${v.id}/`,author:(v.speakers||[]).join(', '),source:v.publisher||v.event||'Talk',dateLabel:dateLabel(date),kind:v.archiveType==='stream'?'Stream':v.archiveType==='demo'?'Demo':'Talk'};
});
const publications=JSON.parse(fs.readFileSync('content/publications.json','utf8')).map(p=>({...p,author:p.authors.join(', '),dateLabel:dateLabel(p.date)}));
const talkThumbnails=JSON.parse(fs.readFileSync('content/talk-thumbnails.json','utf8'));
const externalPreservation=JSON.parse(fs.readFileSync('content/external-preservation.json','utf8'));
const timeline=[...articles.map(a=>({...a,kind:a.kind||'Article'})),...videos,...publications].sort(newestFirst);
const seriesCatalog=collections.map(c=>({...c,members:c.links.map(l=>articles.find(a=>a.origin===l.origin)).filter(Boolean)}));
for(const id of new Set(videos.map(v=>v.seriesId).filter(Boolean))){
 const members=videos.filter(v=>v.seriesId===id).sort((a,b)=>a.sequence-b.sequence);
 const live=members[0].archiveType==='stream';
 seriesCatalog.push({slug:id,title:live?'Live Coding':'Guanxi: Logic Programming in Haskell',path:live?'reader/series/live-coding/':`reader/series/${id}/`,description:live?'Sessions 1–26, including split recordings.':'Four sessions on relational programming in Haskell.',members});
}
seriesCatalog.sort((a,b)=>a.title.localeCompare(b.title));
const navigation=readerNavigation(timeline);
const importedAssets = fs.existsSync('content/assets-manifest.json') ? JSON.parse(fs.readFileSync('content/assets-manifest.json','utf8')) : [];
function sourceKey(href, base='http://comonad.com/') {
  try {
    const url=new URL(href,base);let host=url.hostname.replace(/^www\./,'');
    if(['schoolofhaskell.com','fpcomplete.com'].includes(host)) host='school';
    let pathname=url.pathname.replace(/\/$/,'');
    if(host==='school') pathname=pathname.replace('/tutorial-edit/','/user/edwardk/');
    if(host==='school') pathname=pathname.replace(/(revisiting-matrix-multiplication)-part-(\d+)$/, '$1/part-$2');
    return host+pathname;
  } catch {return href;}
}
const haskellArchive = loadArchive();
const haskellLookup = archiveLookup(haskellArchive);
buildArchive(haskellArchive);
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, s); };
const archiveScriptHash=crypto.createHash('sha256').update(read('dist/archive.js')).digest('hex').slice(0,12);
const sidebarScriptHash=crypto.createHash('sha256').update(read('dist/reader-sidebar.js')).digest('hex').slice(0,12);
const baseStyleHash=crypto.createHash('sha256').update(read('dist/style.css')).digest('hex').slice(0,12);
const appearanceHash=crypto.createHash('sha256').update(read('dist/appearance.css')+read('dist/appearance.js')).digest('hex').slice(0,12);
const articleStyleHash=crypto.createHash('sha256').update(read('dist/article.css')).digest('hex').slice(0,12);
const highlight = code => hljs.highlight(code, {language:'haskell'}).value;
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const md = new MarkdownIt({html:true, linkify:true, highlight:(code, lang) => lang === 'haskell' ? highlight(code) : esc(code)});
md.linkify.set({fuzzyLink:false,fuzzyEmail:false});
// Recording descriptions contain Markdown and explicit URLs, but no trusted HTML.
const recordingMd=new MarkdownIt({html:false,linkify:true,breaks:true});
recordingMd.linkify.set({fuzzyLink:false,fuzzyEmail:false});
md.inline.ruler.before('escape', 'math', (state, silent) => {
  if (state.src[state.pos] !== '$') return false;
  const display = state.src[state.pos+1] === '$';
  const delimiter = display ? '$$' : '$';
  const start = state.pos + delimiter.length;
  const end = state.src.indexOf(delimiter, start);
  if (end < start) return false;
  if (!silent) {
    const token = state.push('math', '', 0);
    token.content = state.src.slice(start, end);
    token.meta = {display};
  }
  state.pos = end + delimiter.length;
  return true;
});
md.renderer.rules.math = (tokens, index) => katex.renderToString(tokens[index].content.replaceAll('\\mathbin{\\text{⦶}}','\\mathbin{\\htmlClass{vertical-operator}{\\ominus}}'), {displayMode:tokens[index].meta.display, throwOnError:true, trust:context=>context.command==='\\htmlClass', strict:code=>code==='htmlExtension'?'ignore':'warn', output:'htmlAndMathml'});
md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index], lang = token.info.trim() || 'text';
  if (lang === 'crc-math') return `<div class="math-derivation" data-original-text="${esc(token.content).replaceAll('\n', '&#10;')}">${katex.renderToString(crcMath(token.content), {displayMode:true, throwOnError:true, trust:false})}</div>\n`;
  return `<pre tabindex="0" aria-label="${lang === 'haskell' ? 'Haskell code' : esc(lang)+' code'}"><code class="language-${esc(lang)}">${hljs.getLanguage(lang) ? hljs.highlight(token.content,{language:lang}).value : esc(token.content)}</code></pre>\n`;
};
const commentMd = new MarkdownIt({html:false});
commentMd.renderer.rules.fence = md.renderer.rules.fence;

fs.mkdirSync('dist/vendor/katex', {recursive:true});
fs.copyFileSync('node_modules/katex/dist/katex.min.css', 'dist/vendor/katex/katex.min.css');
fs.copyFileSync('node_modules/katex/LICENSE', 'dist/vendor/katex/LICENSE');
fs.cpSync('node_modules/katex/dist/fonts', 'dist/vendor/katex/fonts', {recursive:true});
fs.cpSync('content/figures', 'dist/figures', {recursive:true});
buildQuine();
fs.cpSync('content/assets', 'dist/assets', {recursive:true});
fs.copyFileSync('TwoDContouring.hs', 'dist/source/TwoDContouring.hs');
fs.copyFileSync('haskell/ContourDemo.hs', 'dist/source/ContourDemo.hs');
for(const asset of importedAssets.filter(a=>a.path && new URL(a.url).hostname==='comonad.com')) {
  const target=new URL(asset.url).pathname.slice(1);
  if(!target.split('/').includes('..')) write('dist/'+target,fs.readFileSync('content/'+asset.path));
}
for(const [i,a] of importedAssets.entries())if(a.error)write(`dist/source/unavailable/asset-${i}.html`,shell({title:'Historical attachment unavailable',base:'../../',main:`<h1>Historical attachment unavailable</h1><p>This attachment is unavailable: <code>${esc(a.url)}</code>.</p>`}));
write('dist/.nojekyll', '');
for (const [name, file] of [['highlight.js','node_modules/highlight.js/LICENSE'], ['markdown-it','node_modules/markdown-it/LICENSE']]) {
  fs.copyFileSync(file, `dist/vendor/${name}-LICENSE`);
}

const figureCaptions = {
  'adjunction': '$F$ is left adjoint to $G$, with unit $\\eta : 1_{\\mathcal C} \\Rightarrow GF$ and counit $\\varepsilon : FG \\Rightarrow 1_{\\mathcal D}$.',
  'right-kan': 'The right Kan extension, with $\\varepsilon : (\\operatorname{Ran}_G H) \\circ G \\Rightarrow H$.',
};
function relative(route, target) {
  return path.posix.relative(route || '.', target) || './';
}
function shell({title, base, main, script = '', date, route, entry}) {
  const doc=parseHTML(`<div>${main}</div>`).document;
  const lead=doc.querySelector('.prose > p')?.textContent||entry?.description||entry?.context||'Types, (co)monads, substructural logic. Writing, papers, and talks from Edward Kmett and guests.';
  const description=lead.replace(/\s+/g,' ').trim().slice(0,240);
  const metadata=route===undefined?null:publicSite.metadata({title,route,entry,description});
  const head=metadata?`<link rel="canonical" href="${route?'./':siteConfig.readerPath}"><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(metadata.pageUrl)}"><meta property="og:type" content="${entry&&!entry.videoId&&entry.kind!=='Talk'?'article':'website'}"><meta property="og:site_name" content="The Comonad.Reader"><script type="application/ld+json">${JSON.stringify(metadata.data).replaceAll('<','\\u003c')}</script>`:'';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · The Comonad.Reader</title>
${head}
<meta name="color-scheme" content="light dark"><script>try{const t=localStorage.getItem('reader-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;const z=Number(localStorage.getItem('reader-text-size'));if([90,100,110,125,150,175,200].includes(z))document.documentElement.style.setProperty('--reader-text-scale',z/100)}catch{}</script>
<link rel="alternate" type="application/rss+xml" title="The Comonad.Reader" href="${base}feed.xml"><link rel="stylesheet" href="${base}style.css?v=${baseStyleHash}"><link rel="stylesheet" href="${base}article.css?v=${articleStyleHash}"><link rel="stylesheet" href="${base}vendor/katex/katex.min.css"><link rel="stylesheet" href="${base}appearance.css?v=${appearanceHash}">
</head><body><canvas class="margin-cells" aria-hidden="true"></canvas><a class="skip-link" href="#main-content">Skip to content</a><header class="masthead reader-masthead"><a class="site-identity" href="${base}reader/"><span class="lambda-mark" aria-hidden="true">λ</span><span class="site-wording"><span class="wordmark">The Comonad.Reader</span><span class="tagline">types, (co)monads, substructural logic</span></span></a><div class="masthead-links"><nav aria-label="Site navigation"><a href="${base}reader/">Home</a><a href="${base}reader/packages/">Packages</a><a href="${base}feed.xml">RSS</a><a href="mailto:ekmett@gmail.com">Contact</a><details class="appearance" hidden><summary>Appearance</summary><div class="appearance-panel"><fieldset><legend>Theme</legend><div class="theme-options"><label><input type="radio" name="reader-theme" value="light">Light</label><label><input type="radio" name="reader-theme" value="dark">Dark</label><label><input type="radio" name="reader-theme" value="system" checked>System</label></div></fieldset><fieldset class="text-size-controls"><legend>Text size</legend><div class="text-size-buttons"><button type="button" data-text-size="smaller" aria-label="Decrease text size">A−</button><output id="reader-text-size" aria-live="polite" aria-label="Text size">100%</output><button type="button" data-text-size="larger" aria-label="Increase text size">A+</button><button type="button" data-text-size="reset">Reset</button></div></fieldset><label class="background-label" for="reader-background">Margin pattern</label><select id="reader-background" name="reader-background"><option value="auto">Follow system</option><option value="moving">Moving</option><option value="still">Still</option><option value="off">Off</option></select><p>Preferences are saved in this browser.</p><p>Motion follows your system preference unless you choose Moving. Hidden on small screens.</p><button type="button" class="appearance-done" data-appearance-close>Done</button></div></details></nav><nav class="profile-links" aria-label="Edward Kmett elsewhere"><a href="https://github.com/ekmett" rel="me">GitHub</a><a href="https://x.com/kmett" rel="me">X</a><a href="https://www.linkedin.com/in/ekmett" rel="me">LinkedIn</a><a href="https://positron.ai/">Positron</a></nav></div></header>
<div class="reader-layout">${navigation.calendar(base,date)}<main class="reading" id="main-content" tabindex="-1">${main}</main></div><script src="${base}reader-sidebar.js?v=${sidebarScriptHash}"></script><script type="module" src="${base}appearance.js?v=${appearanceHash}"></script>${script}</body></html>\n`;
}
function packageLine(names,root) {
  if(!names.length)return '';
  return `<aside class="package-links" aria-label="Related Hackage packages"><span>Related on Hackage</span> ${names.map(name=>`<a href="${packageCatalog.packages[name].url}"><code>${esc(name)}</code></a>`).join(' · ')} <a class="package-index-link" href="${root}reader/packages/">Browse by package →</a></aside>`;
}
function projectURL(url){
 return Object.values(packageCatalog.projects||{}).find(p=>p.aliases?.includes(url))?.url||url;
}
function recordingDescription(text){
 const body=parseHTML('<div>'+recordingMd.render(text)+'</div>').document.querySelector('div');
 for(const a of body.querySelectorAll('a[href]')){
  const original=a.getAttribute('href'),current=projectURL(original);
  a.setAttribute('href',current);if(a.textContent===original)a.textContent=current;
 }
 return body.innerHTML;
}
function projectLine(video,root){
 const names=packageCatalog.entryProjects?.[video.id]||[];
 if(!names.length)return '';
 return `<aside class="package-links" aria-label="Related projects"><span>Project code</span> ${names.map(name=>`<a href="${packageCatalog.projects[name].url}"><code>${esc(name)}</code></a>${packageCatalog.projects[name].note?' <span>(original repository; currently unavailable)</span>':''}`).join(' · ')} · <a href="${root}reader/packages/#${names[0]}">Related writing &amp; recordings</a></aside>`;
}
function renderArticle(article, route = article.path) {
  const root = (path.posix.relative(route || '.', '.') || '.') + '/';
  let source = read(`content/articles/${article.slug}.md`);
  source = source.replace(/<!-- figure:([\w-]+) -->/g, (_, id) => {
    if (!(id in figureCaptions)) throw new Error(`Unknown figure: ${id}`);
    return `<figure class="category-diagram" id="${id}"><img src="${root}figures/${id}.svg" alt="${id === 'adjunction' ? 'F from C to D is left adjoint to G from D to C.' : 'G maps C to D; H maps C to E; Ran G H maps D to E, with counit from its composite with G to H.'}"><figcaption>${md.renderInline(figureCaptions[id])}</figcaption></figure>`;
  });
  const hasInlineDemo = /<!-- demo:(binding|morton|ad|lca) -->/.test(source);
  const hasQuineDemo = source.includes('<!-- demo:quine -->');
  source = source.replace('<!-- demo:quine -->',read('templates/quine.html').replaceAll('{{root}}',root));
  const hasPNGDemo = /<!-- demo:(png-automaton|topology-automaton|mandelbrot) -->/.test(source);
  source = source.replace(/<!-- demo:(png-automaton|topology-automaton|mandelbrot) -->/g, (_,name)=>read(`templates/${name}.html`).replaceAll('{{root}}',root));
  source = source.replace(/<!-- demo:(binding|morton|ad|lca) -->/g, (_, name) => read(`templates/${name}.html`).replaceAll('{{root}}', root));
  source = source.replace('<!-- demo:automaton -->', read('templates/automaton.html').replace('../../../../source/',root+'source/'));
  source = source.replace('<!-- demo:contour -->', read('templates/contour.html').replaceAll('{{root}}', root));
  source = source.replace(/<!-- demo:(split|tree) -->/g, (_, name) => {
    if (name === 'split') return read('templates/crc-split.html');
    const proof = String.raw`\begin{aligned}
      (A \otimes B) \otimes C
        &= ((pn + q)s + r,\;(mn)s) \\
        &= (pns + qs + r,\;mns) \\[6pt]
      A \otimes (B \otimes C)
        &= (p(ns) + (qs + r),\;m(ns)) \\
        &= (pns + qs + r,\;mns)
    \end{aligned}`;
    return read('templates/crc-associativity.html').replace('<!-- associativity-proof -->', katex.renderToString(proof, {displayMode:true, throwOnError:true, trust:false}))
      + '<details class="incremental-detail"><summary>Using associativity to update a cached tree</summary>\n' + read('templates/crc-tree.html') + '</details>\n';
  });
  let body = md.render(source);
  const document = parseHTML(`<article class="prose">${body}</article>`).document;
  const prose = document.querySelector('article');
  const headings = [...prose.querySelectorAll('h2,h3,h4')];
  const used = new Set();
  for (const heading of headings) {
    let id = heading.id || slugify(heading.textContent), suffix = 2;
    while (used.has(id)) id = slugify(heading.textContent) + '-' + suffix++;
    used.add(id); heading.id = id;
  }
  // Preserve old inbound jump links; new links to imported posts stay on-site.
  if (article.legacyId && !prose.querySelector(`[id="more-${article.legacyId}"]`)) prose.insertAdjacentHTML('afterbegin', `<span id="more-${article.legacyId}"></span>`);
  function localLinks(container) {
    for (const a of container.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
    const imported = [...articles,...collections,...publications].find(post => sourceKey(href,article.origin) === sourceKey(post.origin) || (post.aliases || []).some(alias=>sourceKey(href,article.origin)===sourceKey(alias)) || (post.legacyId && /comonad.com/.test(href) && new URL(href,article.origin).searchParams.get('p')===post.legacyId));
      if (imported) a.setAttribute('href', root + imported.path + (href.includes('#') ? '#' + href.split('#')[1] : ''));
      else if (/^https?:\/\/comonad\.com\/reader\/(?:wiki|source)(?:[/?;]|$)/.test(href)) a.setAttribute('href',root+'reader/wiki/');
      else {
        const local = localArchiveLink(href, article.origin, haskellLookup, route + 'index.html');
        if (local) a.setAttribute('href', local);
      }
    }
  }
  localLinks(prose);
  for(const a of prose.querySelectorAll('a[href]'))if(a.getAttribute('href')==='http://comonad.com/')a.setAttribute('href',root);
  for(const node of prose.querySelectorAll('img[src],a[href]')) {
    const attr=node.tagName==='IMG'?'src':'href', href=node.getAttribute(attr);
    if(href.startsWith('/figures/')) {node.setAttribute(attr,root+href.slice(1));continue;}
    const asset=importedAssets.find(a=>sourceKey(a.url)===sourceKey(href,article.origin));
    if(asset?.path) node.setAttribute(attr,root+asset.path);
    else if(asset?.error && node.tagName==='A') {
      const index=importedAssets.indexOf(asset);node.setAttribute('href',root+`source/unavailable/asset-${index}.html`);
    } else if(node.tagName==='IMG') {
      const local=localArchiveLink(href,article.origin,haskellLookup,route+'index.html');
      if(local) node.setAttribute(attr,local);
    }
    if(node.tagName==='IMG') { node.setAttribute('loading','lazy'); if(!node.hasAttribute('alt'))node.setAttribute('alt','Illustration from '+article.title); }
  }
  linkPackageMentions(prose, packageNames(packageCatalog,article.slug), packageCatalog);
  body = prose.outerHTML;
  const toc = `<details class="contents"><summary>On this page</summary><ol>${headings.map(h => `<li><a href="#${h.id}">${esc(h.textContent)}</a></li>`).join('')}</ol></details>`;
  let comments = '';
  const commentPath = `content/comments/${article.slug}.json`;
  if (fs.existsSync(commentPath)) {
    const data = JSON.parse(read(commentPath));
    const items = data.comments.map(c => `<article class="comment" id="${c.id}"><header><strong>${esc(c.author)}</strong><a href="#${c.id}">${esc(c.date)}</a></header>${commentMd.render(c.markdown)}</article>`).join('');
    const doc = parseHTML(`<section class="comments" id="comments"><h2>Discussion</h2>${items}</section>`).document;
    localLinks(doc); comments = data.comments.length ? doc.querySelector('section').outerHTML : ''; 
  }
  let companions = '';
  if (article.slug === 'parallel-crc') {
    companions = read('templates/crc-source.html').replace('<!-- sources -->', ['CRC.hs','Browser.hs','Server.hs'].map(file => `<details><summary>${file === 'CRC.hs' ? 'Shared core' : file === 'Browser.hs' ? 'WebAssembly adapter' : 'HTTP server'}</summary><a href="${root}source/${file}" download>Download Haskell</a>${file==='Browser.hs'?` · <a href="${root}source/browser-sources.zip">All modules used by the shared browser adapter</a>`:''}<pre tabindex="0" aria-label="Haskell code"><code class="language-haskell">${highlight(read('haskell/' + file))}</code></pre></details>`).join(''));
  }
  const originalCopy = originalReaderArchive.get(article.slug);
  const footer = `<p class="article-download">${originalCopy ? `<a href="${esc(originalCopy)}">Original post and discussion</a> · ` : ''}<a href="${root}source/articles/${article.slug}.md" download>Download Markdown</a></p>
${navigation.neighbors(article,root)}
<footer><span>The Comonad.Reader</span><p>${article.rightsNote?esc(article.rightsNote):`Writing and code © ${esc(article.author || 'Edward Kmett')}.`}</p></footer>`;
  const series=collections.find(c=>c.slug===article.series);
  const seriesNav=series ? `<nav class="series-navigation" aria-label="Article series"><p>In <a href="${root+series.path}">${esc(series.title)}</a></p><ol>${series.links.map(link=>articles.find(a=>sourceKey(a.origin)===sourceKey(link.origin))).filter(Boolean).map(a=>`<li><a href="${root+a.path}"${a.slug===article.slug?' aria-current="page"':''}>${esc(a.seriesTitle||a.originalTitle||a.title)}</a></li>`).join('')}</ol></nav>` : '';
  const main = `<header class="article-header"><div class="article-meta"><span>${esc(article.categories)}</span><span>${esc(article.author || 'Edward Kmett')} · <time datetime="${article.date}">${article.dateLabel}</time></span></div><h1>${esc(article.title)}</h1></header>${seriesNav}${headings.length?toc:''}${body}${packageLine(packageNames(packageCatalog,article.slug),root)}${companions}${comments}${footer}`;
  const script = hasQuineDemo ? `<script type="module" src="${root}quine-demo.js"></script>` : hasPNGDemo ? `<script type="module" src="${root}png-demos.js"></script>` : hasInlineDemo ? `<script type="module" src="${root}article-demos.js"></script>` : article.slug === 'parallel-crc' ? `<script type="module" src="${root}app.js"></script>` : article.slug==='cellular-automata-part-1' ? `<script type="module" src="${root}automaton.js"></script>` : article.slug==='two-d-contouring' ? `<script type="module" src="${root}contour.js"></script>` : '';
  write('dist/' + route + 'index.html', shell({title:article.title, base:root, main, script, date:article.date,route,entry:article}));
}

const provenance = [];
for (const article of articles) {
  renderArticle(article);
  const raw = article.rawSource || (article.slug === 'parallel-crc' ? 'dist/source/original/parallel-crc.md' : `content/original/${article.slug}.html`);
  const bytes = fs.readFileSync(raw);
  const archived = `dist/source/articles/${article.slug}.original.${article.rawFormat === 'md' ? 'md' : 'html.txt'}`;
  write(archived, bytes);
  write(`dist/source/articles/${article.slug}.md`, read(`content/articles/${article.slug}.md`));
  provenance.push({...article, retrieved:article.retrieved||externalPreservation.find(p=>p.path===raw)?.retrieved||'2026-09-21', sha256:crypto.createHash('sha256').update(bytes).digest('hex'), archive:archived.replace('dist/','')});
}
write('dist/source/articles/provenance.json', JSON.stringify(provenance, null, 2)+'\n');
// References to the old hosts are migration work, not a permanent escape hatch.
// Preserve a reviewable inventory before the domain is pointed at this build.
const pending = new Map();
for (const article of articles) {
  const doc = parseHTML(read('dist/' + article.path + 'index.html')).document;
  for (const link of doc.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (!/^https?:\/\/(?:www\.)?(?:comonad\.com|schoolofhaskell\.com|fpcomplete\.com)\//.test(href)) continue;
    const key = href.split('#')[0];
    if (!pending.has(key)) pending.set(key, {url:key, referencedBy:[]});
    const entry = pending.get(key);
    if (!entry.referencedBy.includes(article.slug)) entry.referencedBy.push(article.slug);
  }
}
write('docs/pending-migration-links.json', JSON.stringify([...pending.values()], null, 2)+'\n');
for(const collection of collections) {
  const root=(path.posix.relative(collection.path,'.')||'.')+'/';
  const members=collection.links.map(link=>articles.find(a=>sourceKey(a.origin)===sourceKey(link.origin))).filter(Boolean);
  const authors=[...new Set(members.map(a=>a.author||'Edward Kmett'))].join(', ');
  write('dist/'+collection.path+'index.html',shell({title:collection.title,base:root,route:collection.path,main:`<header class="article-header"><p class="article-meta">A series by ${esc(authors)}</p><h1>${esc(collection.title)}</h1></header><div class="prose">${md.render(collection.description)}</div><div class="article-list">${members.map(a=>`<article><time datetime="${a.date}">${a.dateLabel}</time><h2><a href="${root+a.path}">${esc(a.title)}</a></h2></article>`).join('') || '<p>No articles were published in this collection.</p>'}</div><nav class="related"><a href="${root}reader/">All writing</a></nav>`}));
}
const materialLabels={video:'Recording',video_mirror:'Recording (mirror)',video_historical:'Conference recording',slides_pdf:'Slides (PDF)',slides_pdf_redirect:'Slides (alternate link)',slides_source:'Slides (Keynote)',mp3:'Audio',audio:'Audio',edited_transcript:'Transcript','related workshop subject source repository':'Source code'};
for(const video of videos) {
  const root=(path.posix.relative(video.path,'.')||'.')+'/';
  const main=`<header class="article-header"><div class="article-meta"><span>${esc(video.source)} · ${video.kind}</span><span><time datetime="${video.date}">${esc(video.dateLabel)}</time>${video.dateNote}</span></div><h1>${esc(video.title)}</h1><p class="talk-speakers">${esc(video.author)}</p></header><div class="prose"><figure class="talk-video" data-video-id="${esc(video.videoId)}"><iframe src="https://www.youtube-nocookie.com/embed/${esc(video.videoId)}?playsinline=1" title="${esc(video.title)}" loading="eager" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><figcaption><a href="${esc(video.videoUrl)}">Watch on YouTube</a>${video.durationSeconds?' · '+durationLabel(video.durationSeconds):''}</figcaption></figure>${video.seriesId?videoSeriesNavigation(video,root):''}${video.editorialNote?'<p class="editorial">'+esc(video.editorialNote)+'</p>':''}${recordingDescription(video.description||video.context||'')}${video.materials?.length?'<h2>Materials</h2><ul>'+video.materials.map(m=>`<li><a href="${esc(projectURL(typeof m==='string'?m:m.url))}">${esc(typeof m==='string'?m:m.title||m.label||materialLabels[m.kind]||'Related material')}</a></li>`).join('')+'</ul>':''}</div>${(video.relatedRecordings||[]).map(id=>videos.find(v=>v.id===id)).filter(Boolean).map(v=>`<p class="related-recording">Related recording: <a href="${root+v.path}">${esc(v.title)}</a></p>`).join('')}${video.discussion?.length?'<section class="comments"><h2>Discussion</h2>'+video.discussion.map(c=>`<article class="comment"><header><strong>${esc(c.author)}</strong> · <a href="${esc(c.source)}">Full reply</a></header>${commentMd.render(c.markdown)}</article>`).join('')+'</section>':''}${projectLine(video,root)}${packageLine(video.packages||packageCatalog.talks[video.id]||[],root)}${navigation.neighbors(video,root)}`;
  write('dist/'+video.path+'index.html',shell({title:video.title,base:root,main,date:video.date,route:video.path,entry:video}));
}
for(const publication of publications) {
  const root=(path.posix.relative(publication.path,'.')||'.')+'/';
  const slides=publication.deck?externalPreservation.filter(p=>p.deck===publication.deck&&p.path).sort((a,b)=>a.slide-b.slide):[];
  const material=publication.pdf ? `<p><a class="document-download" href="${root+publication.pdf}">Read the ${publication.kind==='Paper'?'paper':'slides'} (PDF · ${publication.pages} pages)</a> · <a href="${root+publication.pdf}" download>Download</a></p><object class="document-preview" data="${root+publication.pdf}" type="application/pdf" aria-label="${esc(publication.title)}"><p><a href="${root+publication.pdf}">Open the PDF</a></p></object>` : `<section class="slide-deck" aria-label="Presentation slides"><p>${slides.length} slides · <a href="#slide-1">Start reading</a></p>${slides.map(s=>`<figure id="slide-${s.slide}"><img src="${root+s.path.replace(/^content\//,'')}" alt="${esc(s.alt.replaceAll('\\n','\n').trim())}" loading="lazy" width="2048" height="1536"><figcaption>Slide ${s.slide} of ${slides.length}${s.slide>1?` · <a href="#slide-${s.slide-1}" aria-label="Previous slide">←</a>`:''}${s.slide<slides.length?` · <a href="#slide-${s.slide+1}" aria-label="Next slide">→</a>`:''}</figcaption></figure>`).join('')}</section>`;
  const related=articles.find(a=>a.slug===publication.relatedArticle);
  const main=`<header class="article-header"><div class="article-meta"><span>${esc(publication.source)} · ${publication.kind}</span><span><time datetime="${publication.date}">${esc(publication.dateLabel)}</time>${esc(publication.dateNote||'')}</span></div><h1>${esc(publication.title)}</h1><p class="talk-speakers">${esc(publication.author)}</p></header><div class="prose"><p>${esc(publication.description)}</p>${related?`<p>Related article: <a href="${root+related.path}">${esc(related.title)}</a>.</p>`:''}${material}</div>${projectLine(publication,root)}${packageLine(publication.packages||[],root)}${navigation.neighbors(publication,root)}`;
  write('dist/'+publication.path+'index.html',shell({title:publication.title,base:root,main,date:publication.date,route:publication.path,entry:publication}));
}
const countLabel=(count,singular,plural=singular+'s')=>`${count} ${count===1?singular:plural}`;
function videoSeriesNavigation(video,root){
  const members=videos.filter(v=>v.seriesId===video.seriesId).sort((a,b)=>a.sequence-b.sequence);
  if(video.archiveType!=='stream')return '<nav aria-label="Talk series">'+members.map(v=>`<a href="${root+v.path}"${v.id===video.id?' aria-current="page"':''}>Part ${v.sequence}</a>`).join(' · ')+'</nav>';
  const index=members.findIndex(v=>v.id===video.id);
  const adjacent=[members[index-1],members[index+1]].filter(Boolean).map(v=>`<a href="${root+v.path}">${esc(v.sequenceLabel)}</a>`).join(' · ');
  return `<nav class="series-navigation" aria-label="Live coding series"><p><a href="${root}reader/series/live-coding/">Live Coding</a> · ${esc(video.sequenceLabel)}${adjacent?' · '+adjacent:''}</p><details><summary>All sessions</summary><ol>${members.map(v=>`<li><a href="${root+v.path}"${v.id===video.id?' aria-current="page"':''}>${esc(v.title)}</a></li>`).join('')}</ol></details></nav>`;
}
function seriesCards(base,period){
 return seriesCatalog.filter(c=>!period||c.members.some(a=>a.date.startsWith(period))).map(c=>{
  const authors=[...new Set(c.members.map(a=>a.author))].join(', ');
  const dates=c.members.map(a=>a.date.slice(0,4)).sort();
  const years=dates[0]===dates.at(-1)?dates[0]:dates[0]+'–'+dates.at(-1);
  const search=[c.title,authors,...c.members.map(a=>[a.title,a.categories,a.date].join(' '))].join(' ').toLowerCase();
  return `<article class="series-entry" data-search="${esc(search)}"><div class="entry-date"><span>${esc(years)}</span><span>${countLabel(c.members.length,'part')}</span></div><h3><a href="${base+c.path}">${esc(c.title)}</a></h3><p class="entry-author">${esc(authors)}</p><ol class="series-members">${c.members.map(a=>`<li><a href="${base+a.path}">${esc(a.seriesTitle||a.title)}</a></li>`).join('')}</ol></article>`;
 }).join('');
}
function archivePage(route, period, seriesOnly=false) {
  const base=(path.posix.relative(route||'.','.')||'.')+'/';
  const selected=timeline.filter(item=>!period || item.date.startsWith(period));
  const selectedRepos=repositories.filter(repo=>!period || repo.created_at.startsWith(period));
  const seenDates=new Set();
  const title=seriesOnly?'Series':period ? period.length===7 ? navigation.monthLabel(period) : period : 'Writing & talks';
  const years=[...new Set([...selected.map(a=>a.date.slice(0,4)),...selectedRepos.map(r=>r.created_at.slice(0,4))])].sort().reverse();
  const entries=years.map(year=>{
    const repos=selectedRepos.filter(r=>r.created_at.startsWith(year));
    const tags=repos.length?`<ul class="archive-repositories" aria-label="GitHub repositories created in ${year}">${repos.map(repo=>`<li data-search="${esc([repo.name,repo.description,repo.language,...repo.topics,year,'github repository',repo.fork?'fork':''].join(' ').toLowerCase())}"><a href="${esc(repo.html_url)}"${repo.description?` title="${esc(repo.description)}"`:''}>${esc(repo.name)}</a></li>`).join(' ')}</ul>`:'';
    return `<h2 class="archive-year" id="year-${year}">${year}</h2>`+tags+selected.filter(a=>a.date.startsWith(year)).map(a=>{
    const dayId=seenDates.has(a.date)?'':` id="day-${a.date}"`;seenDates.add(a.date);
    const thumbnail=talkThumbnails[a.videoId]?.path?talkThumbnails[a.videoId]:null;
    const image=thumbnail?`<a class="talk-thumbnail" href="${base+a.path}" tabindex="-1" aria-hidden="true"><img src="${base+thumbnail.path}" alt="" width="320" height="180" loading="lazy" decoding="async"></a>`:'';
    return `<article${dayId} class="archive-entry" data-kind="${a.kind}" data-search="${esc([a.title,a.slug,a.author,a.categories,a.date,a.source,a.kind].join(' ').toLowerCase())}"><div class="entry-date"><time datetime="${a.date}">${esc(a.dateLabel)}${a.dateNote||''}</time><span>${a.kind!=='Article'?a.kind+' · ':''}${esc(a.source)}</span></div><div class="entry-body"><div class="entry-copy"><h3><a href="${base+a.path}">${esc(a.title)}</a></h3><p class="entry-author">${esc(a.author||'Edward Kmett')}</p></div>${image}</div></article>`;
    }).join('');
  }).join('');
  return shell({title,base,date:period,route,main:`<header class="archive-header"><p class="article-meta">Edward Kmett &amp; guests</p><h1>${esc(title)}</h1><p>${period?`<a href="${base}reader/">All writing &amp; talks</a>`:"Types, programs, and the structures between them."}</p></header><div class="archive-tools"><label for="archive-search">Explore the archive</label><div class="archive-search-row"><input id="archive-search" type="search" placeholder="Title, repository, topic, speaker, or year…"><select id="archive-kind" aria-label="Content type"><option value="">Everything</option><option>Article</option><option>Talk</option><option>Stream</option><option>Demo</option><option>Paper</option><option>Repository</option><option${seriesOnly?' selected':''}>Series</option></select></div><p id="archive-count" aria-live="polite">${seriesOnly?countLabel(seriesCatalog.length,'series','series'):countLabel(selected.filter(a=>a.kind==='Article').length,'article')}${seriesOnly?'':' · '+countLabel(selected.filter(a=>a.kind==='Talk').length,'talk')+' · '+countLabel(selected.filter(a=>a.kind==='Paper').length,'paper')+(selected.some(a=>a.kind==='Demo')?' · '+countLabel(selected.filter(a=>a.kind==='Demo').length,'demo'):'')+(selected.some(a=>a.kind==='Stream')?' · '+countLabel(selected.filter(a=>a.kind==='Stream').length,'stream'):'')+' · '+countLabel(selectedRepos.length,'repository','repositories')}</p></div><div class="article-list chronological"${seriesOnly?' hidden':''}>${entries}</div><div class="series-results"${seriesOnly?'':' hidden'}>${seriesCards(base,period)}</div><p id="archive-empty"${selected.length||seriesOnly?' hidden':''}>No matching entries.</p><details class="series-list"><summary>Browse series</summary><p><a href="${base}reader/series/">Explore all series →</a></p><ul><li><a href="${base}reader/series/live-coding/">Live Coding</a></li>${collections.filter(c=>c.links.length).map(c=>`<li><a href="${base+c.path}">${esc(c.title)}</a></li>`).join('')}</ul></details><footer><span>The Comonad.Reader</span></footer>`,script:`<script type="module" src="${base}archive.js?v=${archiveScriptHash}"></script>`});
}
const packageSections=Object.entries(packageCatalog.packages).map(([name,pkg])=>{
  const writing=articles.filter(a=>packageNames(packageCatalog,a.slug).includes(name));
  const talks=[...videos,...publications].filter(v=>(v.packages||packageCatalog.talks[v.id]||[]).includes(name));
  return `<section class="package-section" id="${name}"><h2><a href="${pkg.url}">${esc(name)}</a>${pkg.repository?` <small>· <a href="${pkg.repository}">GitHub</a></small>`:''}</h2><ul>${[...writing,...talks].sort((a,b)=>b.date.localeCompare(a.date)).map(a=>`<li><a href="../../${a.path}">${esc(a.title)}</a> <span class="package-date">${a.date.slice(0,4)}</span></li>`).join('')}</ul></section>`;
}).join('');
const projectSections=Object.entries(packageCatalog.projects||{}).map(([name,project])=>{
 const recordings=[...articles,...videos,...publications].filter(v=>(packageCatalog.entryProjects[v.id||v.slug]||[]).includes(name)).sort(newestFirst);
 return `<section class="package-section" id="${name}"><h2><a href="${project.url}">${esc(name)}</a> <small>GitHub project</small></h2>${project.note?`<p>${esc(project.note)}</p>`:''}<ul>${recordings.map(v=>`<li><a href="../../${v.path}">${esc(v.title)}</a> <span class="package-date">${v.date.slice(0,4)}</span></li>`).join('')}</ul></section>`;
}).join('');
write('dist/reader/packages/index.html',shell({title:'Packages & projects',base:'../../',route:'reader/packages/',main:`<header class="article-header"><h1>Packages &amp; projects</h1><p>Libraries and projects, with related articles and talks.</p></header><nav class="package-jump" aria-label="Package index">${[...Object.keys(packageCatalog.packages),...Object.keys(packageCatalog.projects||{})].map(n=>`<a href="#${n}">${esc(n)}</a>`).join(' · ')}</nav>${packageSections}<h2 id="stream-projects">Projects from the archive</h2>${projectSections}`}));
write('dist/source/articles/talk-thumbnails.json',JSON.stringify(talkThumbnails,null,2)+'\n');
write('dist/source/articles/package-links.json',JSON.stringify(packageCatalog,null,2)+'\n');
const streamSeries=videos.filter(v=>v.archiveType==='stream').sort((a,b)=>a.sequence-b.sequence);
write('dist/reader/series/live-coding/index.html',shell({title:'Live Coding',base:'../../../',route:'reader/series/live-coding/',main:`<header class="article-header"><h1>Live Coding</h1><p>Edward Kmett · Twitch recordings</p></header><div class="prose"><p>Sessions 1–26, including split recordings. Follow the session numbers here; the dated archive uses the known YouTube release dates where original broadcast dates are unavailable.</p><ol>${streamSeries.map(v=>`<li><a href="../../../${v.path}">${esc(v.title)}</a></li>`).join('')}</ol></div>`}));
write('dist/reader/index.html',archivePage('reader/'));
write('dist/reader/series/index.html',archivePage('reader/series/',undefined,true));
for(const series of seriesCatalog.filter(c=>c.members[0]?.videoId&&c.slug!=='edward-kmett-live-coding')){
 const base=(path.posix.relative(series.path,'.')||'.')+'/';
 write('dist/'+series.path+'index.html',shell({title:series.title,base,route:series.path,main:`<header class="article-header"><h1>${esc(series.title)}</h1><p>${esc(series.members[0].author)}</p></header><div class="prose"><p>${esc(series.description)}</p><ol>${series.members.map(v=>`<li><a href="${base+v.path}">${esc(v.title)}</a></li>`).join('')}</ol></div><p><a href="${base}reader/series/">All series</a></p>`}));
}
write('dist/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Comonad.Reader</title><link rel="canonical" href="${siteConfig.readerPath}"><meta http-equiv="refresh" content="0;url=${siteConfig.readerPath}"></head><body><p><a href="${siteConfig.readerPath}">Continue to The Comonad.Reader</a></p></body></html>\n`);
write('dist/reader/wiki/index.html',shell({title:'Historical Wiki',base:'../../',main:'<h1>Historical Wiki</h1><p>There are no wiki entries available.</p><p><a href="../../reader/">Return to the archive</a></p>'}));
write('dist/source/articles/wiki.original.html.txt',read('content/original/wiki.html'));
for(const name of ['editorial-changes','math-migration','code-formatting','legacy-link-status','external-talks','boston-haskell-videos','publications','external-preservation'])write(`dist/source/articles/${name}.json`,read(`content/${name}.json`));
for(const year of new Set(timeline.map(a=>a.date.slice(0,4))))write(`dist/reader/${year}/index.html`,archivePage(`reader/${year}/`,year));
// Refresh previously published month pages too when corrected dates empty a month.
const archiveMonths=new Set(navigation.months);
for(const year of fs.readdirSync('dist/reader').filter(y=>/^\d{4}$/.test(y)))for(const month of fs.readdirSync('dist/reader/'+year).filter(m=>/^\d{2}$/.test(m)))archiveMonths.add(year+'-'+month);
for(const month of archiveMonths)write('dist/'+navigation.monthPath(month)+'index.html',archivePage(navigation.monthPath(month),month));
const site=siteConfig.baseUrl;
write('dist/source/articles/site.json',JSON.stringify(siteConfig,null,2)+'\n');
function feedBody(entry){
 const url=publicSite.url(entry.path);
 const prose=parseHTML(read('dist/'+entry.path+'index.html')).document.querySelector('.prose');
 // Keep prose and static figures; embedded applications and slide decks need the page.
 for(const demo of prose.querySelectorAll('.experiment,.interactive-figure,.automaton'))demo.outerHTML=`<p><a href="${url}${demo.id?'#'+demo.id:''}">Try the interactive example</a></p>`;
 prose.querySelectorAll('script,button,input,select,iframe,object,.slide-deck,.series-navigation').forEach(n=>n.remove());
 for(const n of prose.querySelectorAll('[href],[src]'))for(const attr of ['href','src'])if(n.hasAttribute(attr))n.setAttribute(attr,new URL(n.getAttribute(attr),url).href);
 const date=entry.dateLabel||dateLabel(entry.date);
 return `<p>${esc(entry.author)} · ${esc(date)}${esc(entry.dateNote||'')}</p>`+prose.innerHTML+`<p><a href="${url}">${entry.deck?'Read the slides':'Read on The Comonad.Reader'}</a></p>`;
}
const feed=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>The Comonad.Reader</title><link>${site}reader/</link><description>Writing, talks, live coding, and papers: types, (co)monads, substructural logic</description>${timeline.map(a=>`<item><title>${esc(a.title)}</title><link>${esc(publicSite.url(a.path))}</link><guid isPermaLink="false">${esc(siteConfig.permanentIdentityBaseUrl+a.path)}</guid>${/^\d{4}-\d{2}-\d{2}$/.test(a.date)?`<pubDate>${new Date(a.date+'T12:00:00Z').toUTCString()}</pubDate>`:''}<category>${a.kind}</category><description>${esc(feedBody(a))}</description></item>`).join('')}</channel></rss>`;
write('dist/reader/feed/index.xml',feed);
write('dist/reader/feed/index.html',feed);
write('dist/feed.xml',feed);
write('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['reader/','reader/packages/','reader/series/',...seriesCatalog.filter(c=>c.members[0]?.videoId).map(c=>c.path),...articles.map(a=>a.path),...collections.map(a=>a.path),...videos.map(v=>v.path),...publications.map(p=>p.path)].map(p=>`<url><loc>${site+p}</loc></url>`).join('')}</urlset>`);
console.log(`Built ${articles.length} complete articles, local math and diagrams, curated comments, and ${videos.length} recording pages, and ${publications.length} preserved publications.`);
