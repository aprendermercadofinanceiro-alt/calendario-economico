// build-cal.mjs — Motor de coleta do Calendário Econômico 3★ (WINPRIME) — v2
// Roda no GitHub Actions. Sem dependências externas.
//
// v2 (out/2026): o endpoint principal do Investing passou a bloquear os IPs do
// GitHub (Cloudflare) e o motor ficou parado desde 09/09. Agora há 2 fontes,
// ambas do próprio Investing, tentadas em ordem com novas tentativas:
//   1) Service/getCalendarFilteredData (mesma fonte usada em sala, já em GMT-3)
//   2) Widget oficial sslecal2.investing.com (horário em UTC -> convertido p/ GMT-3)
// REGRA ANTI-ERRO: se TODAS as fontes falharem, sai com código 1 e NÃO grava —
// o site detecta dado de outro dia e mostra aviso de "desatualizado".

import { writeFileSync } from 'node:fs';

const OUT = 'dados.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const FLAG = {
  USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵', CNY:'🇨🇳', BRL:'🇧🇷', CAD:'🇨🇦',
  AUD:'🇦🇺', NZD:'🇳🇿', CHF:'🇨🇭', INR:'🇮🇳', MXN:'🇲🇽', ZAR:'🇿🇦', KRW:'🇰🇷',
  RUB:'🇷🇺', SGD:'🇸🇬', HKD:'🇭🇰', TRY:'🇹🇷', IDR:'🇮🇩', ARS:'🇦🇷', SEK:'🇸🇪',
  NOK:'🇳🇴', DKK:'🇩🇰', PLN:'🇵🇱'
};
// o widget devolve meses em inglês no nome do evento: "(Oct)" -> "(Out)"
const MES = { Feb:'Fev', Apr:'Abr', May:'Mai', Aug:'Ago', Sep:'Set', Oct:'Out', Dec:'Dez' };

function stripTags(s){
  return s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ')
          .replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
}
function ptMonths(name){ return name.replace(/\((Feb|Apr|May|Aug|Sep|Oct|Dec)\)/g, (_,m)=>`(${MES[m]})`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function spNow(){
  const now = new Date();
  const ymd = now.toLocaleString('en-CA',{ timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' });
  const extenso = now.toLocaleDateString('pt-BR',{ timeZone:'America/Sao_Paulo', weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const hm = now.toLocaleString('pt-BR',{ timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit', hour12:false });
  const dmy = ymd.split('-').reverse().join('/');
  return { ymd, extenso, lastUpdated: `${dmy} ${hm} (GMT-3)` };
}

function mkEvent(Y, Mo, D, H, Mi, cur, name){
  return { iso:`${Y}-${Mo}-${D}T${H}:${Mi}:00-03:00`, cur, flag: FLAG[cur] || '🏳️', name };
}

// ---------- FONTE 1: endpoint interno (GMT-3) ----------
async function fonteService(){
  const res = await fetch('https://br.investing.com/economic-calendar/Service/getCalendarFilteredData', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': UA, 'Accept': '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer': 'https://br.investing.com/economic-calendar/',
      'Origin': 'https://br.investing.com'
    },
    body: 'importance%5B%5D=3&timeZone=12&currentTab=today&limit_from=0'
  });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (typeof j.data !== 'string') throw new Error('resposta sem campo data');
  const rows = j.data.match(/<tr[^>]*id="eventRowId[\s\S]*?<\/tr>/g) || [];
  const out = [];
  for (const row of rows){
    if ((row.match(/grayFullBullishIcon/g) || []).length !== 3) continue;
    const m = (row.match(/data-event-datetime="([^"]+)"/)?.[1] || '').trim()
      .match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) continue;
    const [, Y, Mo, D, H, Mi, S] = m;
    if (H === '00' && Mi === '00' && S === '00') continue; // sem horário definido
    const curM = row.match(/<td[^>]*flagCur[^>]*>([\s\S]*?)<\/td>/);
    const evM = row.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    const cur = curM ? stripTags(curM[1]).toUpperCase() : '';
    const name = evM ? stripTags(evM[1]) : '';
    if (name) out.push(mkEvent(Y, Mo, D, H, Mi, cur, name));
  }
  return out;
}

// ---------- FONTE 2: widget oficial (UTC -> GMT-3) ----------
async function fonteWidget(){
  const url = 'https://sslecal2.investing.com/?columns=exc_flags,exc_currency,exc_importance'
            + '&importance=3&features=datepicker,timezone&countries=&calType=day&timeZone=12&lang=12';
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  if (!/ecEventsTable|eventRowId|theDay/.test(html)) throw new Error('HTML inesperado (bloqueio?)');
  const rows = html.match(/<tr[^>]*id="eventRowId[\s\S]*?<\/tr>/g) || [];
  const out = [];
  for (const row of rows){
    if ((row.match(/grayFullBullishIcon/g) || []).length !== 3) continue;
    const ts = row.match(/event_timestamp="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}"/);
    if (!ts) continue; // "Todo o dia" / sem horário
    const d = new Date(ts[1].replace(' ', 'T') + ':00Z');           // UTC
    const br = new Date(d.getTime() - 3 * 3600 * 1000);              // GMT-3 (Brasil sem horário de verão)
    const p = n => String(n).padStart(2, '0');
    const curM = row.match(/<td[^>]*flagCur[^>]*>([\s\S]*?)<\/td>/);
    const evM = row.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    const cur = curM ? stripTags(curM[1]).toUpperCase() : '';
    const name = evM ? ptMonths(stripTags(evM[1])) : '';
    if (name) out.push(mkEvent(br.getUTCFullYear(), p(br.getUTCMonth()+1), p(br.getUTCDate()),
                                p(br.getUTCHours()), p(br.getUTCMinutes()), cur, name));
  }
  return out;
}

async function tentar(nome, fn, tentativas = 3){
  for (let i = 1; i <= tentativas; i++){
    try { const ev = await fn(); console.log(`[${nome}] OK na tentativa ${i}`); return ev; }
    catch (e){ console.log(`[${nome}] tentativa ${i} falhou: ${e.message}`); if (i < tentativas) await sleep(4000 * i); }
  }
  return null;
}

async function main(){
  const { ymd, extenso, lastUpdated } = spNow();
  let fonte = 'service', events = await tentar('service', fonteService);
  if (events === null){ fonte = 'widget'; events = await tentar('widget', fonteWidget); }
  if (events === null) throw new Error('todas as fontes falharam');

  // garante que só entram eventos de HOJE (Brasília)
  events = events.filter(e => e.iso.slice(0, 10) === ymd);
  events.sort((a, b) => new Date(a.iso) - new Date(b.iso));

  const payload = { date: ymd, dateLabel: extenso, lastUpdated, source: 'Investing.com', via: fonte, events };
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`OK via ${fonte}: ${events.length} evento(s) 3★ em ${ymd}`);
  for (const e of events) console.log(`  ${e.iso.slice(11,16)} ${e.cur} ${e.flag} ${e.name}`);
}

main().catch(err => {
  console.error('FALHA na coleta (mantendo último dados.json):', err.message);
  process.exit(1);
});
