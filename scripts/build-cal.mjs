// build-cal.mjs — Motor de coleta do Calendário Econômico 3★ (WINPRIME)
// Roda no GitHub Actions (Node 20). Sem dependências externas.
// Fonte de verdade: endpoint interno do Investing (mesma fonte usada em sala),
// já em horário de Brasília (timeZone=12 = GMT-3). Escreve dados.json.
// REGRA ANTI-ERRO: em qualquer falha de rede/parse, sai com código 1 e NÃO
// escreve o arquivo — o painel mantém o último dado bom em vez de mostrar algo errado.

import { writeFileSync, readFileSync } from 'node:fs';

const ENDPOINT = 'https://br.investing.com/economic-calendar/Service/getCalendarFilteredData';
const OUT = 'dados.json';

const FLAG = {
  USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵', CNY:'🇨🇳', BRL:'🇧🇷', CAD:'🇨🇦',
  AUD:'🇦🇺', NZD:'🇳🇿', CHF:'🇨🇭', INR:'🇮🇳', MXN:'🇲🇽', ZAR:'🇿🇦', KRW:'🇰🇷',
  RUB:'🇷🇺', SGD:'🇸🇬', HKD:'🇭🇰', TRY:'🇹🇷', IDR:'🇮🇩', ARS:'🇦🇷', SEK:'🇸🇪',
  NOK:'🇳🇴', DKK:'🇩🇰', PLN:'🇵🇱', ITL:'🇮🇹', ESP:'🇪🇸', PTE:'🇵🇹'
};

function stripTags(s){ return s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim(); }

function spNow(){
  // "today" e labels em America/Sao_Paulo
  const now = new Date();
  const ymd = now.toLocaleString('en-CA',{ timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' });
  const extenso = now.toLocaleDateString('pt-BR',{ timeZone:'America/Sao_Paulo', weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const hm = now.toLocaleString('pt-BR',{ timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit', hour12:false });
  const dmy = ymd.split('-').reverse().join('/');
  return { ymd, extenso, lastUpdated: `${dmy} ${hm} (GMT-3)` };
}

async function fetchInvesting(){
  const body = 'importance%5B%5D=3&timeZone=12&currentTab=today&limit_from=0';
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer': 'https://br.investing.com/economic-calendar/',
      'Origin': 'https://br.investing.com'
    },
    body
  });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const j = await res.json(); // se vier challenge HTML do Cloudflare, quebra aqui -> anti-erro
  if (typeof j.data !== 'string') throw new Error('Resposta sem campo data');
  return j.data;
}

function parseRows(html){
  const rows = html.match(/<tr[^>]*id="eventRowId[\s\S]*?<\/tr>/g) || [];
  const events = [];
  for (const row of rows){
    const stars = (row.match(/grayFullBullishIcon/g) || []).length;
    if (stars !== 3) continue;
    const dtM = row.match(/data-event-datetime="([^"]+)"/);
    if (!dtM) continue;
    const dt = dtM[1].trim(); // "YYYY/MM/DD HH:MM:SS" em GMT-3
    const m = dt.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) continue;
    const [ , Y, Mo, D, H, Mi, S ] = m;
    if (H === '00' && Mi === '00' && S === '00') continue; // evento sem horário definido -> descarta
    const curM = row.match(/<td[^>]*flagCur[^>]*>([\s\S]*?)<\/td>/);
    const cur = curM ? stripTags(curM[1]).toUpperCase() : '';
    const evM = row.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    const name = evM ? stripTags(evM[1]) : '';
    if (!name) continue;
    events.push({
      iso: `${Y}-${Mo}-${D}T${H}:${Mi}:00-03:00`,
      cur,
      flag: FLAG[cur] || '🏳️',
      name
    });
  }
  events.sort((a,b)=> new Date(a.iso) - new Date(b.iso));
  return events;
}

async function main(){
  const { extenso, lastUpdated } = spNow();
  const html = await fetchInvesting();
  const events = parseRows(html);

  // Sanity extra: o Investing devolveu HTML de linhas, mas 0 eventos 3★ pode ser
  // legítimo (dia calmo). Só gravamos porque o fetch/parse tiveram sucesso.
  const payload = { dateLabel: extenso, lastUpdated, source: 'Investing.com', events };
  const json = JSON.stringify(payload, null, 2) + '\n';

  let prev = '';
  try { prev = readFileSync(OUT, 'utf8'); } catch {}
  // ignora diferença só de lastUpdated para não poluir o histórico com commits vazios
  const norm = s => s.replace(/"lastUpdated":\s*"[^"]*"/, '');
  if (norm(prev) === norm(json)) {
    // regrava mesmo assim para atualizar o horário, mas sinaliza que só o relógio mudou
    writeFileSync(OUT, json);
    console.log(`OK (sem mudança de eventos): ${events.length} evento(s) 3★`);
  } else {
    writeFileSync(OUT, json);
    console.log(`OK (atualizado): ${events.length} evento(s) 3★`);
  }
  for (const e of events) console.log(`  ${e.iso.slice(11,16)} ${e.cur} ${e.flag} ${e.name}`);
}

main().catch(err => {
  console.error('FALHA na coleta (mantendo último dados.json):', err.message);
  process.exit(1);
});
