'use strict';

// Storage keys are initialized before any access-control callback can fire.
const OWNER_FLEET_KEY = 'grupoConect.ownerFleet.v2';
const OWNER_ROUTES_KEY = 'grupoConect.ownerRoutes.v1';
const OWNER_ROUTES_MIGRATED_KEY = 'grupoConect.ownerRoutesMigrated.v1';
const OWNER_CONTRACTS_KEY = 'grupoConect.municipalContracts.v1';
const OWNER_SCALE_KEY = 'grupoConect.ownerScalesByWeekday.v1';
const OPERATION_KEY = 'grupoConect.operationViewer.v1';
const DRIVER_COUNT_KEY = 'grupoConect.virtualDriverCounts.v1';
const FINANCED_BUSES_KEY = 'grupoConect.financedBuses.v1';
const CASH_LEDGER_KEY = 'grupoConect.cashLedger.v1';
const OPERATION_CASH_STATE_KEY = 'grupoConect.operationCashState.v1';
const GC_VALIDATOR_LOG_KEY = 'grupoConect.validatorDepartureLog.v1';
const GC_ZERO_KM_QUOTES_KEY = 'grupoConect.zeroKmQuotes.v1';

const DIESEL_DEFAULT = 7.99;
// IDs são a forma de consulta mais usada neste painel. getElementById evita o custo
// de interpretar um seletor CSS em centenas de leituras repetidas; outros seletores
// continuam usando querySelector, sem mudar o comportamento existente.
const $ = (selector) => (typeof selector === 'string' && /^#[A-Za-z_][A-Za-z0-9_-]*$/.test(selector))
  ? document.getElementById(selector.slice(1))
  : document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
// Cache as telas estáticas uma única vez para evitar novas consultas ao DOM em cada navegação.
const SCREEN_ELEMENTS = Array.from(document.querySelectorAll('.screen'));
const HISTORY_KEY = 'grupoConect.tripHistory.v1';
const DAY_COUNT_KEY = 'grupoConect.dayCount.v1';
const ACTIVE_DAY_KEY = 'grupoConect.activeDay.v1';
const PHOTO_DB_NAME = 'grupoConectSchedulePhotos';
const PHOTO_STORE_NAME = 'photos';
const state = { free: 0, paid: 0, photos: [], objectUrls: new Map(), toastTimer: null, journey: null, pendingJourney: null, validatorCardRead: false, dayCount: 1, lastAiReport: '' };
let gcZeroKmCurrentQuote = null;

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(value) ? value : 0);
const numberPt = (value, digits = 1) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dayLabel = (dayId) => `Dia ${Math.max(1, Number(String(dayId || 'day-1').replace('day-', '')) || 1)}`;

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function switchScreen(screenId) {
  const target = document.getElementById(String(screenId || ''));
  // Um destino inválido nunca pode esconder todas as telas e deixar o usuário preso em uma página vazia.
  if (!target || !target.classList.contains('screen')) {
    showToast('Esta opção não está disponível no momento. O menu e os demais módulos foram preservados.');
    console.warn('[Grupo Conect] Navegação ignorada: tela inexistente ou inválida:', screenId);
    return false;
  }
  if (screenId === 'calculatorScreen' && (!state.journey || state.pendingJourney?.type === 'normal')) {
    showToast('Para abrir o painel, primeiro identifique a viagem e confirme a partida no validador.');
    return false;
  }
  SCREEN_ELEMENTS.forEach((screen) => {
    const active = screen === target;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  // Rolagem instantânea evita animações concorrentes e engasgos ao navegar no celular.
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (screenId === 'calculatorScreen') { updateCalculation(); updateDayUI(); }
  if (screenId === 'startTripScreen') { if(typeof refreshRouteDatalists==='function') refreshRouteDatalists(); if(typeof refreshNormalTripDrivers==='function') refreshNormalTripDrivers(); }
  if (screenId === 'gpsTrackingScreen' && typeof gcRenderGps === 'function') { gcGpsSetAccess(); }
  if (screenId === 'intercityScreen' && typeof gcIcRenderIntercity === 'function') { gcIcRenderIntercity(); }
  if (screenId === 'validatorScreen' && typeof gcValidatorRender === 'function') gcValidatorRender();
  return true;
}

// Um único listener delegado mantém navegáveis todos os 36 atalhos atuais,
// além de qualquer atalho adicionado dinamicamente por módulos já existentes.
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-screen]');
  if (!button || button.disabled) return;
  const targetId = button.dataset.screen;
  if (!targetId) return;
  const screen = document.getElementById(targetId);
  if (screen && screen.classList.contains('screen') && screen.classList.contains('active') && !screen.hidden) return;
  switchScreen(targetId);
});
$('#brandHome').addEventListener('click', () => switchScreen('homeScreen'));
$('#openMainMenu').addEventListener('click', () => switchScreen('homeScreen'));

function readNonNegative(input) {
  const raw = String(input?.value ?? '').trim().replace(',', '.');
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function readPercent(input) {
  const value = readNonNegative(input);
  return value !== null && value <= 100 ? value : null;
}
function getCurrentDayId() { return $('#daySelect')?.value || 'day-1'; }
function getDayTrips(dayId = getCurrentDayId()) { return loadHistory().filter((trip) => (trip.dayId || 'day-1') === dayId); }

// Empresas ativas neste cenário fictício.
const GROUP_COMPANIES = ['Progresso','Viação Cedro','Viação Conecta','Transportes Transportes','Galaxy Transportes'];
const GC_CITIES = ['Barra do Piraí','Vassouras','Paraíba do Sul','Três Rios','Valença','Resende','Niterói','Nova Friburgo','Rio de Janeiro — Setor intermunicipal / Baixada','Petrópolis','Miguel Pereira','Nova Iguaçu','Paracambi','Juiz de Fora','Teresópolis','Areal'];
const GC_INTERSTATE_ROUTES = ['RJ × POA','RJ × SP','RJ × BH','RJ × Curitiba','RJ × Vitória','RJ × Brasília','RJ × Florianópolis','RJ × Juiz de Fora'];

// Frota pré-cadastrada por empresa. Os prefixos e modelos refletem as informações do usuário;
// o tipo de serviço fica marcado somente quando foi informado explicitamente.
const FLEET = [
  { company:'Progresso', model:'Caio Apache Vip III 1721L', prefixes:['80'], service:'A definir' },
  { company:'Progresso', model:'Marcopolo Torino 17.230 ODS', prefixes:['200','201','202','203','204','205'], service:'A definir' },
  { company:'Progresso', model:'Marcopolo Torino 2007', prefixes:['195','196','197','198','199'], service:'A definir' },
  { company:'Progresso', model:'Marcopolo Ideale 800', prefixes:['205','206','207'], service:'A definir' },
  { company:'Progresso', model:'Mascarello Gran Micro S3', prefixes:['208','209','210'], service:'A definir', chassis:'Mascarello Gran Micro S3' },
  { company:'Progresso', model:'Caio Apache Vip III MB OF-1721', prefixes:['180'], service:'A definir', chassis:'Mercedes-Benz OF-1721' },
  { company:'Progresso', model:'Marcopolo Torino MB OF-1519', prefixes:['211','212','213'], service:'A definir', chassis:'Mercedes-Benz OF-1519' },

  { company:'Viação Cedro', model:'Neobus Spectrum Road MB OF-1722M', prefixes:['2500','2501'], service:'A definir', chassis:'Mercedes-Benz OF-1722M' },
  { company:'Viação Cedro', model:'Marcopolo Audace OF-1721L', prefixes:['2502','2503','2504','2505','2506','2507','2508','2509','2510'], service:'A definir', chassis:'Mercedes-Benz OF-1721L' },
  { company:'Viação Cedro', model:'Mascarello Gran Via 17.230 EOD', prefixes:['2511','2512','2513'], service:'A definir', chassis:'Volkswagen 17.230 EOD' },
  { company:'Viação Cedro', model:'Marcopolo Viaggio G7 1050 MB O500M', prefixes:['2514','2515','2516','2517','2518','2519','2520'], service:'A definir', chassis:'Mercedes-Benz O500M' },
  { company:'Viação Cedro', model:'Neobus N10 MB OF-1721L', prefixes:['2521','2522'], service:'A definir', chassis:'Mercedes-Benz OF-1721L' },
  { company:'Viação Cedro', model:'Caio Apache Vip IV MB OF-1721L', prefixes:['2523','2524','2525'], service:'A definir', chassis:'Mercedes-Benz OF-1721L' },
  { company:'Viação Cedro', model:'Marcopolo Torino 2007 MB OF-1722M', prefixes:['2526'], service:'Municipal e intermunicipal', chassis:'Mercedes-Benz OF-1722M' },
  { company:'Viação Cedro', model:'Caio Apache Vip II MB OF-1722M', prefixes:['2527'], service:'Municipal e intermunicipal', chassis:'Mercedes-Benz OF-1722M' },
  { company:'Viação Cedro', model:'Marcopolo Paradiso G6 Volvo', prefixes:['2529','2530','2531','2532','2533'], service:'Intermunicipal', chassis:'Volvo' }
];
function populateSelect(select, placeholder, values) {
  select.innerHTML = '';
  const first = document.createElement('option'); first.value = ''; first.textContent = placeholder; select.appendChild(first);
  values.forEach((entry) => {
    const option = document.createElement('option');
    if (typeof entry === 'string') { option.value = entry; option.textContent = entry; }
    else { option.value = entry.value; option.textContent = entry.label; }
    select.appendChild(option);
  });
}
function mergeCompanyFleet(company) {
  const rows = FLEET.filter(item => norm(item.company) === norm(company)).map(item => ({...item, prefixes:[...item.prefixes]}));
  // Veículos também registrados pelo proprietário ficam disponíveis no início de viagem.
  const saved = typeof ownerFleet === 'function' ? ownerFleet().filter(item => norm(item.company) === norm(company)) : [];
  saved.forEach(item => {
    let match = rows.find(row => norm(row.model) === norm(item.model));
    if (!match) { match = {company:item.company, model:item.model, prefixes:[], service:item.type || 'A definir', chassis:item.chassis || ''}; rows.push(match); }
    if (item.prefix && !match.prefixes.includes(String(item.prefix))) match.prefixes.push(String(item.prefix));
  });
  const seen = new Set();
  return rows.map(item => ({...item, prefixes:[...new Set(item.prefixes.map(String))]})).filter(item => {
    const key=norm(item.model); if(seen.has(key))return false; seen.add(key); return item.prefixes.length>0;
  });
}
function refreshBusFields() {
  const company = $('#companySelect').value;
  const rows = mergeCompanyFleet(company);
  const modelSelect = $('#busModelSelect'); const prefixSelect = $('#busPrefixSelect');
  const enabled = rows.length > 0;
  $('#busFields').classList.toggle('is-disabled', !enabled);
  modelSelect.disabled = !enabled; prefixSelect.disabled = !enabled;
  populateSelect(modelSelect, enabled ? 'Selecione o modelo' : 'Nenhum ônibus cadastrado para esta empresa', rows.map(item => item.model));
  populateSelect(prefixSelect, 'Selecione o modelo primeiro', []);
  if (enabled) {
    $('#companyNotice').textContent = `Frota de ${company} liberada. Escolha o modelo e o prefixo cadastrado.`;
    $('#companyNotice').classList.remove('notice-warning');
  } else {
    $('#companyNotice').textContent = `Ainda não há ônibus cadastrado para ${company}. Abra Colinha → Área do Dono e cadastre a frota primeiro.`;
    $('#companyNotice').classList.add('notice-warning');
  }
}
$('#companySelect').addEventListener('change', () => { refreshBusFields(); refreshNormalTripDrivers(); });
$('#busModelSelect').addEventListener('change', () => {
  const company = $('#companySelect').value;
  const model = mergeCompanyFleet(company).find(item => item.model === $('#busModelSelect').value);
  populateSelect($('#busPrefixSelect'), 'Selecione o prefixo', model ? model.prefixes : []);
});
$('#startJourneyForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const company = $('#companySelect').value;
  const bus = mergeCompanyFleet(company).find(item => item.model === $('#busModelSelect').value);
  const prefix = $('#busPrefixSelect').value;
  if (!company || !bus || !prefix || !bus.prefixes.includes(prefix)) {
    $('#companyNotice').textContent = 'Confira empresa, modelo e prefixo. Se a frota não aparecer, cadastre o ônibus na Área do Dono.';
    $('#companyNotice').classList.add('notice-warning');
    showToast('Selecione uma empresa e um ônibus válido para iniciar a viagem.');
    return;
  }
  if (typeof gcOnlineBusReservationReason === 'function') {
    const reservation=gcOnlineBusReservationReason({company,prefix,model:bus.model},dateTodayLocal());
    if(reservation){$('#companyNotice').textContent=`Ônibus indisponível: ${reservation.message} Escolha outro prefixo para hoje.`;$('#companyNotice').classList.add('notice-warning');showToast(`Viagem não iniciada: ${reservation.message}`);return;}
  }
  if (!$('#driverSelect').value) { showToast('Selecione o motorista.'); return; }
  const city = $('#tripCity').value.trim();
  const line = $('#tripLine').value.trim();
  if (!city || !line) { showToast('Informe a cidade e o nome/número da linha para vincular a viagem ao histórico.'); (!city ? $('#tripCity') : $('#tripLine')).focus(); return; }
  const journey = { id:makeId(), company, driver:$('#driverSelect').value, city, line, busModel:bus.model, busPrefix:prefix, service:bus.service || 'A definir', chassis:bus.chassis || '' };
  gcValidatorOpen({type:'normal',journey,company,driver:journey.driver,city,line,model:bus.model,prefix,service:journey.service});
  showToast('Identificação concluída. O motorista precisa validar o cartão antes da partida.');
});

function gcBeginNormalJourney(journey, validatorLogId) {
  state.journey = {...journey, validatorLogId};
  $('#journeyContext').innerHTML = `<strong>${escapeHtml(state.journey.company)} · ${escapeHtml(state.journey.driver)}</strong><span>${escapeHtml(state.journey.city)} · Linha ${escapeHtml(state.journey.line)}</span><span>${escapeHtml(state.journey.busModel)} · Prefixo ${escapeHtml(state.journey.busPrefix)}${state.journey.service && state.journey.service!=='A definir' ? ` · ${escapeHtml(state.journey.service)}` : ''}</span><span class="validator-trip-stamp">Partida validada · ${escapeHtml(new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))}</span>`;
  state.free = 0; state.paid = 0;
  $('#fareValue').value = '';
  $('#chassisSelect').value = '';
  // Preseleciona uma opção de chassi aproximada quando existe no cadastro informado.
  if (state.journey.chassis) {
    const target = norm(state.journey.chassis);
    const option = Array.from($('#chassisSelect').options).find(o => norm(o.textContent).includes(target) || target.includes(norm(o.textContent)));
    if (option) $('#chassisSelect').value = option.value;
  }
  $('#tankCapacity').value = $('#chassisSelect').selectedOptions[0]?.dataset.capacity || '';
  $('#tankInitialPercent').value = '';
  $('#tankCurrentPercent').value = '';
  $('#dieselLiters').value = '';
  $('#dieselPrice').value = DIESEL_DEFAULT.toFixed(2);
  $('#tripReport').hidden = true;
  updateCalculation();
  switchScreen('calculatorScreen');
  showToast('Partida validada. Viagem iniciada!');
}

// --- Validador de bordo simulado: aproximação do cartão, leitura, confirmação e registro ---
const GC_VALIDATOR_CARD_IDS = {Pablo:'GC-MOT-0001',Treinamento:'GC-MOT-0002',Kaio:'GC-MOT-0003'};
function gcValidatorCardId(name){
  const driver=String(name||'').trim();if(GC_VALIDATOR_CARD_IDS[driver])return GC_VALIDATOR_CARD_IDS[driver];
  let hash=0;for(let i=0;i<driver.length;i++)hash=(hash*31+driver.charCodeAt(i))>>>0;
  return `GC-MOT-${String(1000+(hash%8999)).padStart(4,'0')}`;
}
function gcValidatorLogs(){return readArrayKey(GC_VALIDATOR_LOG_KEY);}
function gcValidatorSaveLog(row){const rows=gcValidatorLogs();if(rows.some(x=>x.id===row.id))return true;rows.push(row);return writeArrayKey(GC_VALIDATOR_LOG_KEY,rows.slice(-300));}
function gcValidatorCardTapReset(){state.validatorCardRead=false;const button=$('#validatorConfirmStart');if(button)button.disabled=true;$('#validatorLed')?.classList.remove('validator-led-ready');$('#validatorReaderLight')?.classList.remove('validator-reader-ready');$('#validatorCardVisual')?.classList.remove('validator-card-read');}
function gcValidatorOpen(pending){state.pendingJourney=pending;gcValidatorCardTapReset();gcValidatorRender();switchScreen('validatorScreen');}
function gcValidatorRender(){
  const pending=state.pendingJourney;
  const context=$('#validatorContext');if(!context)return;
  const driver=pending?.driver||pending?.journey?.driver||'—';
  const company=pending?.company||pending?.journey?.company||'—';
  const model=pending?.model||pending?.journey?.busModel||'';
  const prefix=pending?.prefix||pending?.journey?.busPrefix||'';
  const city=pending?.city||pending?.journey?.city||'';
  const line=pending?.line||pending?.journey?.line||'';
  const kind=pending?.type==='intercity'?'Viagem intermunicipal':pending?.type==='online'?'Fretamento contratado':'Viagem normal';
  $('#validatorCardName').textContent=pending?driver:'Nenhum cartão carregado';
  $('#validatorCardNumber').textContent=pending?gcValidatorCardId(driver):'GC-000000';
  $('#validatorTapCard').disabled=!pending;
  $('#validatorConfirmStart').disabled=!pending||!state.validatorCardRead;
  $('#validatorCancel').disabled=!pending;
  $('#validatorPrepareTrip').hidden=Boolean(pending);
  $('#validatorStateBadge').textContent=pending?(state.validatorCardRead?'Cartão lido · aguardando confirmação':'Aguardando cartão'):'Aguardando dados';
  if(pending){context.innerHTML=`<div class="validator-context-grid"><span>Tipo de serviço<strong>${escapeHtml(kind)}</strong></span><span>Motorista<strong>${escapeHtml(driver)}</strong></span><span>Empresa<strong>${escapeHtml(company)}</strong></span><span>Ônibus / prefixo<strong>${escapeHtml(model)}${prefix?` · ${escapeHtml(prefix)}`:''}</strong></span><span>Cidade / linha<strong>${escapeHtml(city||'Não informada')} · ${escapeHtml(line||'Linha não informada')}</strong></span></div>`;$('#validatorStatus').textContent=state.validatorCardRead?'Cartão aceito. Confira os dados acima e pressione INICIAR VIAGEM.':'Viagem identificada. Aproxime o cartão funcional do motorista para fazer a leitura.';$('#validatorLcdMain').textContent=state.validatorCardRead?'CARTÃO ACEITO':'AGUARDANDO CARTÃO';$('#validatorLcdSub').textContent=state.validatorCardRead?`${driver} · confirme a partida`:`${company} · ${line||'linha não informada'}`;}
  else{context.innerHTML='<p><strong>Nenhuma viagem aguardando validação.</strong></p><p>Comece pelo formulário “Iniciar viagem”, pelo Painel intermunicipal ou pelo Atendimento Online. O Visualizador de Operação inicia o ciclo diretamente, sem usar este validador.</p>';$('#validatorStatus').textContent='Nenhuma viagem selecionada. O cartão não pode liberar uma viagem sem identificação.';$('#validatorLcdMain').textContent='AGUARDANDO VIAGEM';$('#validatorLcdSub').textContent='Identifique a viagem antes de aproximar o cartão.';}
  $('#validatorClock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  gcValidatorRenderLog();
}
function gcActivateOperation(op){
  if(!assertOwner())return;
  const rows=ownerOperations();
  if(rows.some(x=>x.id===op.id)){showToast('Esta operação já foi registrada.');return;}
  // O Visualizador de Operação tem partida própria: não exige cartão no validador.
  const loading=$('#ovLoading');const submitButton=$('#operationViewerForm button[type="submit"]');
  if(loading)loading.hidden=false;if(submitButton)submitButton.disabled=true;
  setTimeout(()=>{
    const eventHappened=Math.random()<0.10;
    if(eventHappened){const kinds=Object.keys(INCIDENT_RESPONSES),type=kinds[Math.floor(Math.random()*kinds.length)];op.gcIncidentPreviousStatus='operando';op.status='fora de operação';op.lastEvent=`${INCIDENT_LABELS[type]} · ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;op.currentIncidentType=type;op.incidentHistory.push({id:makeId(),type,occurredAt:new Date().toISOString(),resolution:''});}
    else{op.status='operando';op.clockAnchorAt=Date.now();op.startedAt=new Date().toISOString();}
    const current=ownerOperations();if(!current.some(x=>x.id===op.id))current.push(op);
    if(!writeArrayKey(OPERATION_KEY,current)){if(loading)loading.hidden=true;if(submitButton)submitButton.disabled=false;showToast('Não foi possível salvar a operação no navegador. Tente novamente.');return;}
    if(loading)loading.hidden=true;if(submitButton)submitButton.disabled=false;renderOperations();
    switchScreen('ownerAreaScreen');
    if(eventHappened){showToast('Operação iniciada; surgiu um imprevisto simulado (10%). Escolha uma decisão.');openIncidentFor(op,op.currentIncidentType);}
    else showToast(`Operação iniciada. Primeira viagem termina em ${opFormatCountdown(op.duration*60/op.speedMultiplier)} de tempo real.`);
  },500);
}
function gcValidatorRenderLog(){
  const target=$('#validatorLogList');if(!target)return;const rows=gcValidatorLogs().slice().reverse().slice(0,12);
  target.innerHTML=rows.length?rows.map(x=>`<article class="record-item validator-log-record"><div><strong>${escapeHtml(x.driver||'Motorista')} · ${escapeHtml(x.line||'Linha não informada')}</strong><small>${escapeHtml(x.company||'Empresa')} · ${escapeHtml(x.prefix||'Sem prefixo')} · ${escapeHtml(new Date(x.startedAt).toLocaleString('pt-BR'))}</small><span class="record-inline-tag">Cartão ${escapeHtml(x.cardId||'GC')}</span></div><span class="doc-status-tag">Partida autorizada</span></article>`).join(''):recordsEmpty('Nenhuma partida validada ainda.');
}
$('#validatorTapCard').addEventListener('click',()=>{
  const p=state.pendingJourney;if(!p){showToast('Identifique a viagem antes de apresentar o cartão.');return;}
  const driver=p.driver||p.journey?.driver;if(!driver){showToast('Não há motorista escalado para validar.');return;}
  state.validatorCardRead=true;$('#validatorConfirmStart').disabled=false;$('#validatorLed').classList.add('validator-led-ready');$('#validatorReaderLight').classList.add('validator-reader-ready');$('#validatorCardVisual').classList.add('validator-card-read');$('#validatorStateBadge').textContent='Cartão lido · pronto';$('#validatorStatus').textContent=`LEITURA ACEITA · ${driver}. Confirme os dados da viagem e pressione INICIAR VIAGEM.`;$('#validatorLcdMain').textContent='CARTÃO ACEITO';$('#validatorLcdSub').textContent=`${driver} · ${gcValidatorCardId(driver)}`;$('#validatorClock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});showToast('Bip! Cartão funcional reconhecido na simulação.');
});
$('#validatorConfirmStart').addEventListener('click',()=>{
  const p=state.pendingJourney;if(!p||!state.validatorCardRead){showToast('Aproxime o cartão antes de iniciar a viagem.');return;}
  const driver=p.driver||p.journey?.driver||'Motorista não identificado';
  const company=p.company||p.journey?.company||'';const model=p.model||p.journey?.busModel||'';const prefix=p.prefix||p.journey?.busPrefix||'';const city=p.city||p.journey?.city||'';const line=p.line||p.journey?.line||'';
  const log={id:makeId(),type:p.type,driver,company,model,prefix,city,line,cardId:gcValidatorCardId(driver),startedAt:new Date().toISOString(),status:'started'};
  if(!gcValidatorSaveLog(log)){showToast('Não foi possível salvar a partida validada no navegador.');return;}
  state.pendingJourney=null;state.validatorCardRead=false;
  if(p.type==='normal'){gcBeginNormalJourney({...p.journey,validatorLogId:log.id},log.id);}
  else if(p.type==='intercity'){gcIcCommitStartTrip(p,log.id);}
  else if(p.type==='online'){gcOnlineCommitServiceStart(p,log.id);}
  gcValidatorRenderLog();
});
$('#validatorPrepareTrip').addEventListener('click',()=>switchScreen('startTripScreen'));
$('#validatorCancel').addEventListener('click',()=>{
  const p=state.pendingJourney;if(!p)return;const type=p.type;state.pendingJourney=null;state.validatorCardRead=false;gcValidatorRender();
  switchScreen(type==='normal'?'startTripScreen':type==='intercity'?'intercityScreen':'ownerAreaScreen');showToast('Validação cancelada. A viagem não foi iniciada.');
});
$('#validatorClearLog').addEventListener('click',()=>{if(!window.confirm('Limpar os registros visuais de partidas validadas deste navegador? Isso não apaga o histórico normal de viagens.'))return;writeArrayKey(GC_VALIDATOR_LOG_KEY,[]);gcValidatorRenderLog();showToast('Histórico visual do validador limpo.');});

// Seleção do chassi e cálculo do consumo pelas porcentagens do painel.
$('#chassisSelect').addEventListener('change', () => {
  const option = $('#chassisSelect').selectedOptions[0];
  $('#tankCapacity').value = option?.dataset.capacity || '';
  $('#tankInitialPercent').value = '';
  $('#tankCurrentPercent').value = '';
  $('#dieselLiters').value = '';
  updateDieselCalculation(); updateCalculation();
});
['tankInitialPercent', 'tankCurrentPercent', 'dieselPrice'].forEach((id) => {
  $('#' + id).addEventListener('input', () => { updateDieselCalculation(); updateCalculation(); });
  $('#' + id).addEventListener('change', () => { updateDieselCalculation(); updateCalculation(); });
});
function updateDieselCalculation() {
  const capacity = readNonNegative($('#tankCapacity'));
  const initial = readPercent($('#tankInitialPercent'));
  const current = readPercent($('#tankCurrentPercent'));
  const price = readNonNegative($('#dieselPrice'));
  const litersInput = $('#dieselLiters');
  if (capacity === null || initial === null || current === null) {
    litersInput.value = '';
    $('#remainingFuelPreview').textContent = '—';
    $('#dieselCostPreview').textContent = '—';
    $('#dieselCalcStatus').textContent = capacity === null ? 'Selecione o chassi para carregar a capacidade do tanque.' : 'Informe porcentagens entre 0% e 100% no início e no final.';
    $('#dieselCalcStatus').classList.remove('warning');
    return false;
  }
  if (current > initial) {
    litersInput.value = '';
    $('#remainingFuelPreview').textContent = `${numberPt(capacity * current / 100, 2)} L`;
    $('#dieselCostPreview').textContent = '—';
    $('#dieselCalcStatus').textContent = 'A porcentagem final é maior que a inicial. Confira os valores ou registre o abastecimento separadamente.';
    $('#dieselCalcStatus').classList.add('warning');
    return false;
  }
  const consumed = capacity * (initial - current) / 100;
  const remaining = capacity * current / 100;
  litersInput.value = consumed.toFixed(2);
  $('#remainingFuelPreview').textContent = `${numberPt(remaining, 2)} L`;
  $('#dieselCostPreview').textContent = money(consumed * (price ?? DIESEL_DEFAULT));
  $('#dieselCalcStatus').textContent = `Consumo estimado de ${numberPt(consumed, 2)} L (${numberPt(initial - current, 2)}% da capacidade).`;
  $('#dieselCalcStatus').classList.remove('warning');
  return true;
}

function getCalculation() {
  const fare = readNonNegative($('#fareValue'));
  const liters = readNonNegative($('#dieselLiters'));
  const dieselPrice = readNonNegative($('#dieselPrice'));
  const revenue = (fare ?? 0) * state.paid;
  const fuelCost = (liters ?? 0) * (dieselPrice ?? DIESEL_DEFAULT);
  const net = revenue - fuelCost;
  const valid = fare !== null && liters !== null && dieselPrice !== null;
  return { fare, liters, dieselPrice, revenue, fuelCost, net, valid, total: state.free + state.paid };
}
function updateCalculation() {
  $('#freeCount').textContent = state.free;
  $('#paidCount').textContent = state.paid;
  $('#totalCount').textContent = state.free + state.paid;
  $('#freeSummary').textContent = state.free;
  $('#paidSummary').textContent = state.paid;
  const result = getCalculation();
  $('#revenueValue').textContent = money(result.revenue);
  $('#fuelCostValue').textContent = money(result.fuelCost);
  const net = $('#liveNet'); net.textContent = money(result.net); net.classList.remove('positive', 'negative', 'neutral');
  const status = $('#liveStatus');
  if (!result.valid) { net.classList.add('neutral'); status.textContent = 'Informe passagem, chassi e porcentagens do tanque para calcular.'; }
  else if (result.net > 0.004) { net.classList.add('positive'); status.textContent = 'Resultado positivo antes de outras despesas.'; }
  else if (result.net < -0.004) { net.classList.add('negative'); status.textContent = 'Resultado negativo considerando apenas o diesel.'; }
  else { net.classList.add('neutral'); status.textContent = 'A arrecadação cobre exatamente o diesel informado.'; }
  $('#breakEvenCount').textContent = result.fare !== null && result.fare > 0 && result.liters !== null ? `${Math.ceil(result.fuelCost / result.fare)} pagantes` : 'Informe a passagem';
}
$$('[data-counter]').forEach((button) => button.addEventListener('click', () => {
  const key = button.dataset.counter; const change = Number(button.dataset.change);
  state[key] = Math.max(0, state[key] + change); updateCalculation();
}));
['fareValue'].forEach((id) => { $('#' + id).addEventListener('input', updateCalculation); $('#' + id).addEventListener('change', updateCalculation); });

// Histórico: viagens agrupadas por dia, mantidas no navegador utilizado.
function loadHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(data) ? data.map((trip) => ({ ...trip, dayId: trip.dayId || 'day-1' })) : [];
  } catch (error) { return []; }
}
function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 2000))); return true; }
  catch (error) { showToast('Não foi possível salvar o histórico neste navegador.'); return false; }
}
function loadDayCount() {
  const stored = Number(localStorage.getItem(DAY_COUNT_KEY) || 1);
  const maxDayFromTrips = loadHistory().reduce((max, trip) => Math.max(max, Number(String(trip.dayId || 'day-1').replace('day-', '')) || 1), 1);
  state.dayCount = Math.max(1, Number.isFinite(stored) ? stored : 1, maxDayFromTrips);
}
function renderDaySelect() {
  const select = $('#daySelect'); const previous = localStorage.getItem(ACTIVE_DAY_KEY) || select.value || 'day-1';
  select.innerHTML = '';
  for (let i=1; i<=state.dayCount; i++) { const option = document.createElement('option'); option.value=`day-${i}`; option.textContent=`Dia ${i}`; select.appendChild(option); }
  select.value = Number(previous.replace('day-', '')) <= state.dayCount && Number(previous.replace('day-', '')) >= 1 ? previous : 'day-1';
  localStorage.setItem(ACTIVE_DAY_KEY, select.value);
  $('#activeDayPill').textContent = `${dayLabel(select.value)} selecionado`;
}
function addDay() {
  state.dayCount += 1;
  localStorage.setItem(DAY_COUNT_KEY, String(state.dayCount));
  renderDaySelect();
  $('#daySelect').value = `day-${state.dayCount}`;
  localStorage.setItem(ACTIVE_DAY_KEY, $('#daySelect').value);
  updateDayUI();
  showToast(`${dayLabel($('#daySelect').value)} criado.`);
}
$('#addDay').addEventListener('click', addDay);
$('#daySelect').addEventListener('change', () => {
  localStorage.setItem(ACTIVE_DAY_KEY, $('#daySelect').value);
  $('#activeDayPill').textContent = `${dayLabel($('#daySelect').value)} selecionado`;
  updateDayUI();
  $('#tripReport').hidden = true;
  if (!$('#groupConectAiPanel').hidden) prefillAIInputs();
});
function sumTrips(trips) {
  return trips.reduce((acc, trip) => {
    acc.count += 1; acc.free += Number(trip.free) || 0; acc.paid += Number(trip.paid) || 0; acc.passengers += Number(trip.total) || 0;
    acc.revenue += Number(trip.revenue) || 0; acc.liters += Number(trip.liters) || 0; acc.fuelCost += Number(trip.fuelCost) || 0; acc.net += Number(trip.net) || 0;
    return acc;
  }, { count:0, free:0, paid:0, passengers:0, revenue:0, liters:0, fuelCost:0, net:0 });
}
function updateDayUI() {
  renderDaySelect();
  const trips = getDayTrips(); const total = sumTrips(trips);
  const stats = [
    ['Viagens', total.count], ['Passageiros', total.passengers], ['Gratuidades', total.free], ['Pagantes', total.paid],
    ['Arrecadação', money(total.revenue)], ['Diesel gasto', `${numberPt(total.liters, 2)} L`], ['Custo diesel', money(total.fuelCost)]
  ];
  $('#daySummary').innerHTML = stats.map(([label,value]) => `<div class="day-summary-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const dayNet = $('#dayNet'); dayNet.textContent = money(total.net); dayNet.classList.toggle('positive', total.net >= 0); dayNet.classList.toggle('negative', total.net < 0);
  $('#daySummaryNote').textContent = total.count ? `${total.count} ${total.count === 1 ? 'viagem registrada' : 'viagens registradas'} neste dia.` : 'Nenhuma viagem registrada neste dia.';
  $('#historyTitle').textContent = `Viagens do ${dayLabel(getCurrentDayId())}`;
  renderHistory();
  const aiButton = $('#openGroupConectAI');
  aiButton.title = total.count >= 3 ? 'Há dados suficientes para calcular uma média, conforme o mínimo escolhido.' : `Registre pelo menos 3 viagens neste dia (atual: ${total.count}).`;
}
function renderHistory() {
  const trips = getDayTrips(); const container = $('#tripHistory');
  if (!trips.length) { container.innerHTML = '<p class="history-empty">Nenhuma viagem finalizada neste dia.</p>'; return; }
  container.innerHTML = trips.slice(0, 50).map((trip) => {
    const date = new Date(trip.timestamp);
    const dateText = Number.isNaN(date.getTime()) ? 'Data não disponível' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const klass = trip.net > 0.004 ? 'positive' : (trip.net < -0.004 ? 'negative' : '');
    const label = trip.net > 0.004 ? 'Lucro' : (trip.net < -0.004 ? 'Prejuízo' : 'Equilíbrio');
    const bus = trip.busModel ? ` · ${escapeHtml(trip.busModel)} ${escapeHtml(trip.busPrefix || '')}` : '';
    const route = trip.city || trip.line ? ` · ${escapeHtml(trip.city || 'Cidade não informada')} / ${escapeHtml(trip.line || 'Linha não informada')}` : ' · Cidade/linha não cadastradas';
    const needsRouteTag = !String(trip.city||'').trim() || !String(trip.line||'').trim();
    const routeEditor = needsRouteTag ? `<button type="button" class="text-button legacy-trip-edit-button" data-trip-route-edit="${escapeHtml(trip.id)}">Identificar cidade/linha para análise</button>` : '';
    return `<div class="history-item"><div class="history-left"><strong>${label} · ${Number(trip.total)||0} passageiros</strong><small>${dateText} · ${Number(trip.free)||0} gratuidades · ${Number(trip.paid)||0} pagantes${route}${bus}</small>${routeEditor}</div><div class="history-net ${klass}">${money(Number(trip.net)||0)}</div></div>`;
  }).join('');
}

function buildReportMarkup(trip) {
  const verdictClass = trip.net > 0.004 ? '' : (trip.net < -0.004 ? ' loss' : ' neutral');
  let verdict = 'A arrecadação cobriu o custo do diesel informado.';
  if (trip.net > 0.004) verdict = `Lucro de ${money(trip.net)} antes de outras despesas.`;
  if (trip.net < -0.004) verdict = `Prejuízo de ${money(Math.abs(trip.net))} considerando o diesel informado.`;
  return `<div class="report-summary">
    <div class="report-stat"><span>Empresa</span><strong>${escapeHtml(trip.company || 'Não informada')}</strong></div>
    <div class="report-stat"><span>Cidade / linha</span><strong>${escapeHtml(trip.city || 'Sem cidade')} · ${escapeHtml(trip.line || 'Linha não informada')}</strong></div>
    <div class="report-stat"><span>Motorista</span><strong>${escapeHtml(trip.driver || 'Não informado')}</strong></div>
    <div class="report-stat"><span>Ônibus / prefixo</span><strong>${escapeHtml(trip.busModel || 'Não informado')} · ${escapeHtml(trip.busPrefix || '—')}</strong></div>
    <div class="report-stat"><span>Chassi / tanque</span><strong>${escapeHtml(trip.chassis || '—')} · ${trip.tankCapacity ?? '—'} L</strong></div>
    <div class="report-stat"><span>Nível inicial → final</span><strong>${trip.initialPercent ?? '—'}% → ${trip.currentPercent ?? '—'}%</strong></div>
    <div class="report-stat"><span>Gratuidades</span><strong>${trip.free}</strong></div>
    <div class="report-stat"><span>Passagens vendidas</span><strong>${trip.paid}</strong></div>
    <div class="report-stat"><span>Total de passageiros</span><strong>${trip.total}</strong></div>
    <div class="report-stat"><span>Valor da passagem</span><strong>${trip.fare === null ? 'Não informado' : money(trip.fare)}</strong></div>
    <div class="report-stat"><span>Arrecadação</span><strong>${money(trip.revenue)}</strong></div>
    <div class="report-stat"><span>Diesel consumido</span><strong>${trip.liters === null ? 'Não informado' : `${numberPt(trip.liters, 2)} L`}</strong></div>
    <div class="report-stat"><span>Preço / custo do diesel</span><strong>${money(trip.dieselPrice)}/L · ${money(trip.fuelCost)}</strong></div>
  </div><div class="report-verdict${verdictClass}">${verdict}</div>`;
}
function tripText(trip, index) {
  const date = new Date(trip.timestamp).toLocaleString('pt-BR');
  const verdict = trip.net > 0.004 ? `Lucro: ${money(trip.net)}` : trip.net < -0.004 ? `Prejuízo: ${money(Math.abs(trip.net))}` : 'Resultado equilibrado';
  return `${index + 1}. ${date}\nEmpresa: ${trip.company || 'Não informada'}\nCidade: ${trip.city || 'Não informada'}\nLinha: ${trip.line || 'Não informada'}\nMotorista: ${trip.driver || 'Não informado'}\nÔnibus: ${trip.busModel || 'Não informado'} · Prefixo ${trip.busPrefix || '—'}\nChassi: ${trip.chassis || '—'} · Tanque ${trip.tankCapacity ?? '—'} L\nTanque: ${trip.initialPercent ?? '—'}% → ${trip.currentPercent ?? '—'}%\nGratuidades: ${trip.free} | Pagantes: ${trip.paid} | Total de passageiros: ${trip.total}\nPassagem: ${money(trip.fare ?? 0)} | Arrecadação: ${money(trip.revenue)}\nDiesel: ${numberPt(trip.liters ?? 0,2)} L | Preço: ${money(trip.dieselPrice ?? DIESEL_DEFAULT)}/L | Custo: ${money(trip.fuelCost)}\n${verdict}`;
}
function makeDayReport(dayId = getCurrentDayId()) {
  const trips = getDayTrips(dayId); const sum = sumTrips(trips);
  return [`GRUPO CONECT — RELATÓRIO ${dayLabel(dayId).toUpperCase()}`, `Gerado em: ${new Date().toLocaleString('pt-BR')}`, '', `Viagens: ${sum.count}`, `Passageiros: ${sum.passengers} (pagantes: ${sum.paid}; gratuidades: ${sum.free})`, `Arrecadação: ${money(sum.revenue)}`, `Diesel consumido: ${numberPt(sum.liters,2)} L`, `Custo do diesel: ${money(sum.fuelCost)}`, `Resultado estimado: ${money(sum.net)} (antes de outras despesas)`, '', ...trips.slice().reverse().map((trip,index)=>tripText(trip,index))].join('\n\n');
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (error) {
    const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly','');
    area.style.position='fixed'; area.style.opacity='0'; document.body.appendChild(area); area.select();
    let copied=false; try { copied=document.execCommand('copy'); } catch (copyError) { copied=false; }
    area.remove(); return copied;
  }
}
$('#copyDayReport').addEventListener('click', async () => {
  const trips=getDayTrips(); if(!trips.length){showToast('Este dia ainda não tem viagens para relatar.');return;}
  showToast(await copyText(makeDayReport()) ? 'Relatório do dia copiado.' : 'Não foi possível copiar automaticamente.');
});
function csvCell(value) { const text=String(value ?? ''); return `"${text.replace(/"/g,'""')}"`; }
$('#exportDayCsv').addEventListener('click', () => {
  const dayId=getCurrentDayId(); const trips=getDayTrips(dayId);
  if(!trips.length){showToast('Este dia ainda não tem viagens para exportar.');return;}
  const headers=['Dia','Data','Empresa','Cidade','Linha','Motorista','Modelo do ônibus','Prefixo','Chassi','Tanque total (L)','Tanque inicial (%)','Tanque final (%)','Gratuidades','Pagantes','Passageiros totais','Valor da passagem (R$)','Arrecadação (R$)','Diesel consumido (L)','Preço diesel (R$/L)','Custo diesel (R$)','Resultado estimado (R$)'];
  const rows=trips.slice().reverse().map(t=>[dayLabel(t.dayId||dayId),new Date(t.timestamp).toLocaleString('pt-BR'),t.company,t.city||'',t.line||'',t.driver,t.busModel,t.busPrefix,t.chassis,t.tankCapacity,t.initialPercent,t.currentPercent,t.free,t.paid,t.total,t.fare,t.revenue,t.liters,t.dieselPrice,t.fuelCost,t.net]);
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`grupo-conect-${dayLabel(dayId).toLowerCase().replace(' ','-')}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast('Relatório CSV exportado.');
});

let lastReportText = '';
$('#finishTrip').addEventListener('click', () => {
  if (!state.journey) { showToast('Inicie a viagem e identifique o ônibus primeiro.'); switchScreen('startTripScreen'); return; }
  const calc=getCalculation();
  if(calc.fare===null){$('#fareValue').focus();showToast('Informe o valor da passagem.');return;}
  if($('#chassisSelect').value===''){ $('#chassisSelect').focus();showToast('Selecione o chassi do ônibus.');return; }
  if(!updateDieselCalculation() || calc.liters===null || readPercent($('#tankInitialPercent'))===null || readPercent($('#tankCurrentPercent'))===null){
    $('#tankInitialPercent').focus();showToast('Confira o chassi e as porcentagens inicial e final do tanque.');return;
  }
  if(calc.dieselPrice===null){$('#dieselPrice').focus();showToast('Confira o preço do diesel por litro.');return;}
  if(calc.total===0 && !window.confirm('Nenhum passageiro foi registrado. Deseja finalizar a viagem assim mesmo?')) return;
  const timestamp=new Date().toISOString(); const dayId=getCurrentDayId();
  const trip={
    id:(window.crypto&&crypto.randomUUID)?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp, dayId, dayLabel:dayLabel(dayId),
    ...state.journey, chassis:$('#chassisSelect').value, tankCapacity:Number($('#tankCapacity').value),
    initialPercent:Number($('#tankInitialPercent').value), currentPercent:Number($('#tankCurrentPercent').value),
    fare:calc.fare, liters:calc.liters, dieselPrice:calc.dieselPrice, free:state.free, paid:state.paid, total:calc.total,
    revenue:calc.revenue, fuelCost:calc.fuelCost, net:calc.net
  };
  $('#reportContent').innerHTML=buildReportMarkup(trip); $('#tripReport').hidden=false;
  const verdict=trip.net>0.004?`Lucro: ${money(trip.net)}`:trip.net< -0.004?`Prejuízo: ${money(Math.abs(trip.net))}`:'Resultado equilibrado';
  lastReportText=['GRUPO CONECT — RESUMO DA VIAGEM',`Dia: ${trip.dayLabel}`,`Data: ${new Date(timestamp).toLocaleString('pt-BR')}`,`Empresa: ${trip.company}`,`Cidade: ${trip.city || 'Não informada'}`,`Linha: ${trip.line || 'Não informada'}`,`Motorista: ${trip.driver}`,`Ônibus: ${trip.busModel} · Prefixo ${trip.busPrefix}`,`Chassi: ${trip.chassis} · Tanque ${trip.tankCapacity} L`,`Tanque inicial/final: ${trip.initialPercent}% → ${trip.currentPercent}%`,`Gratuidades: ${trip.free}`,`Passagens vendidas: ${trip.paid}`,`Total de passageiros: ${trip.total}`,`Valor da passagem: ${money(trip.fare)}`,`Arrecadação: ${money(trip.revenue)}`,`Diesel consumido: ${numberPt(trip.liters,2)} L`,`Preço do diesel: ${money(trip.dieselPrice)}/L`,`Custo do diesel: ${money(trip.fuelCost)}`,`${verdict} (antes de outras despesas).`].join('\n');
  const history=loadHistory(); history.unshift(trip); saveHistory(history);
  updateDayUI(); $('#tripReport').scrollIntoView({behavior:'smooth',block:'start'}); showToast('Viagem salva no '+trip.dayLabel+'.');
});
$('#copyReport').addEventListener('click', async () => { if(!lastReportText)return; showToast(await copyText(lastReportText)?'Resumo da viagem copiado.':'Não foi possível copiar automaticamente.'); });
$('#newTrip').addEventListener('click', () => {
  state.free=0; state.paid=0; $('#fareValue').value=''; $('#chassisSelect').value=''; $('#tankCapacity').value=''; $('#tankInitialPercent').value=''; $('#tankCurrentPercent').value=''; $('#dieselLiters').value=''; $('#dieselPrice').value=DIESEL_DEFAULT.toFixed(2); $('#tripReport').hidden=true; lastReportText=''; updateDieselCalculation(); updateCalculation(); window.scrollTo({top:0,behavior:'smooth'}); showToast('Dados zerados. Pronto para registrar a próxima viagem.');
});
$('#clearHistory').addEventListener('click', () => {
  const history=loadHistory(); const selected=getCurrentDayId(); const dayTrips=history.filter(t=>(t.dayId||'day-1')===selected);
  if(!dayTrips.length){showToast('Este dia já está vazio.');return;}
  if(window.confirm(`Deseja apagar apenas as viagens do ${dayLabel(selected)} neste navegador?`)) { saveHistory(history.filter(t=>(t.dayId||'day-1')!==selected)); updateDayUI(); showToast(`Histórico do ${dayLabel(selected)} apagado.`); }
});
$('#tripHistory').addEventListener('click',(event)=>{
  const button=event.target.closest('[data-trip-route-edit]');if(!button)return;
  const trip=loadHistory().find(item=>String(item.id)===String(button.dataset.tripRouteEdit));if(!trip){showToast('Não encontrei essa viagem no histórico.');return;}
  $('#legacyTripRouteId').value=String(trip.id);$('#legacyTripRouteCity').value=trip.city||'';$('#legacyTripRouteLine').value=trip.line||'';$('#legacyTripRouteEditor').hidden=false;$('#legacyTripRouteEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
});
$('#cancelLegacyTripRouteEdit').addEventListener('click',()=>{$('#legacyTripRouteEditor').hidden=true;});
$('#legacyTripRouteForm').addEventListener('submit',(event)=>{
  event.preventDefault();const id=$('#legacyTripRouteId').value,city=$('#legacyTripRouteCity').value.trim(),line=$('#legacyTripRouteLine').value.trim();
  if(!id||!city||!line){showToast('Informe cidade e linha antes de salvar.');return;}
  const history=loadHistory(),index=history.findIndex(item=>String(item.id)===String(id));if(index<0){showToast('Não encontrei a viagem para atualizar.');return;}
  history[index]={...history[index],city,line};if(!saveHistory(history))return;
  $('#legacyTripRouteEditor').hidden=true;$('#legacyTripRouteForm').reset();currentProfitReportText='';renderHistory();showToast('Cidade e linha adicionadas ao histórico antigo. Agora ele pode entrar na análise da operação.');
});

// Grupo Conect AI — previsão simples e transparente baseada nas médias registradas.
function prefillAIInputs() {
  const trips=getDayTrips(); const sums=sumTrips(trips);
  $('#aiPassengerTotal').value=String(sums.passengers);
  $('#aiDieselTotal').value=sums.liters.toFixed(2);
  $('#aiMinTrips').value=Math.max(3,Number($('#aiMinTrips').value)||3);
  $('#aiResults').hidden=true; state.lastAiReport='';
  const min=Math.max(3,Number($('#aiMinTrips').value)||3);
  $('#aiStatus').className='ai-status'+(trips.length<min?' warning':'');
  $('#aiStatus').textContent=trips.length<min?`Este dia tem ${trips.length} viagem(ns) registrada(s). São necessárias pelo menos ${min} para calcular uma média confiável.`:`Este dia tem ${trips.length} viagens registradas. Preencha quantas viagens ainda estão previstas e calcule a projeção.`;
}
$('#openGroupConectAI').addEventListener('click', () => {
  $('#groupConectAiPanel').hidden=false; prefillAIInputs(); $('#groupConectAiPanel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('#closeGroupConectAI').addEventListener('click', () => { $('#groupConectAiPanel').hidden=true; });
$('#refreshAiData').addEventListener('click', () => { prefillAIInputs(); showToast('Passageiros e diesel atualizados com os registros do dia.'); });
$('#aiMinTrips').addEventListener('change', () => { const value=Number($('#aiMinTrips').value); if(!Number.isFinite(value)||value<3) $('#aiMinTrips').value='3'; });
$('#aiForecastForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const trips=getDayTrips(); const count=trips.length; const minTrips=Number($('#aiMinTrips').value);
  const passengers=Number($('#aiPassengerTotal').value); const dieselTotal=Number(String($('#aiDieselTotal').value).replace(',','.'));
  const remainingTrips=Number($('#aiRemainingTrips').value); const schedules=$('#aiLineSchedules').value.trim();
  $('#aiResults').hidden=true;
  if(!Number.isInteger(minTrips)||minTrips<3){$('#aiStatus').className='ai-status warning';$('#aiStatus').textContent='O mínimo precisa ser 3 viagens ou mais.';return;}
  if(count<minTrips){$('#aiStatus').className='ai-status warning';$('#aiStatus').textContent=`Previsão bloqueada: ${dayLabel(getCurrentDayId())} tem ${count} viagem(ns). Finalize pelo menos ${minTrips} antes de calcular a média.`;return;}
  if(!Number.isFinite(passengers)||passengers<0||!Number.isFinite(dieselTotal)||dieselTotal<0||!Number.isInteger(remainingTrips)||remainingTrips<1){$('#aiStatus').className='ai-status warning';$('#aiStatus').textContent='Confira passageiros, litros de diesel e o número inteiro de viagens que ainda faltam.';return;}
  if(!schedules){$('#aiStatus').className='ai-status warning';$('#aiStatus').textContent='Informe os horários/linhas que pretende operar no restante do dia para documentar a projeção.';$('#aiLineSchedules').focus();return;}
  const sums=sumTrips(trips);
  const averageRevenue=sums.revenue/count;
  const averageDiesel= dieselTotal/count;
  const weightedPrice=sums.liters>0 ? sums.fuelCost/sums.liters : DIESEL_DEFAULT;
  const projectedDiesel=averageDiesel*remainingTrips;
  const projectedFuelCost=projectedDiesel*weightedPrice;
  const futureRevenue=averageRevenue*remainingTrips;
  const averageProfit=averageRevenue-(averageDiesel*weightedPrice);
  const futureProfit=averageProfit*remainingTrips;
  const averagePassengers=passengers/count;
  const projectedPassengers=averagePassengers*remainingTrips;
  const projectedDayEnd=sums.net+futureProfit;
  $('#aiAvgProfit').textContent=money(averageProfit);
  $('#aiFutureProfit').textContent=money(futureProfit);
  $('#aiAvgDiesel').textContent=`${numberPt(averageDiesel,2)} L`;
  $('#aiFutureDiesel').textContent=`${numberPt(projectedDiesel,2)} L`;
  $('#aiAvgPassengers').textContent=numberPt(averagePassengers,1);
  $('#aiDayEndProfit').textContent=money(projectedDayEnd);
  const summary=`Dia analisado: ${dayLabel(getCurrentDayId())}\nViagens consideradas: ${count} (mínimo definido: ${minTrips})\nHorários/linhas: ${schedules}\n\nMédia usada: ${money(averageRevenue)} de arrecadação por viagem; ${numberPt(averageDiesel,2)} L de diesel por viagem; preço médio de referência ${money(weightedPrice)}/L.\nPara as ${remainingTrips} viagens restantes, a estimativa é arrecadar ${money(futureRevenue)}, consumir ${numberPt(projectedDiesel,2)} L de diesel e obter resultado de ${money(futureProfit)} antes de outras despesas.\nSomando o resultado já registrado (${money(sums.net)}), o resultado projetado para o fim do dia é ${money(projectedDayEnd)}.\nPassageiros: aproximadamente ${numberPt(projectedPassengers,1)} a mais, com média de ${numberPt(averagePassengers,1)} por viagem.\n\nEsta é uma projeção matemática; os resultados reais podem mudar conforme linha, tarifa, trânsito, passageiros e condições do jogo.`;
  $('#aiSummaryText').textContent=summary;
  $('#aiResults').hidden=false;
  $('#aiStatus').className='ai-status success';
  $('#aiStatus').textContent=`Previsão calculada com ${count} viagens registradas em ${dayLabel(getCurrentDayId())}.`; 
  state.lastAiReport=`GRUPO CONECT AI — PREVISÃO\n${summary}`;
  $('#aiResults').scrollIntoView({behavior:'smooth',block:'nearest'});
});
$('#copyAiForecast').addEventListener('click', async () => { if(!state.lastAiReport)return; showToast(await copyText(state.lastAiReport)?'Previsão do Grupo Conect AI copiada.':'Não foi possível copiar automaticamente.'); });

// Ferramentas extras do menu: tarifa, abastecimento, duração, arrecadação, checklist e manutenção.
function readToolValue(id) { return readNonNegative(document.getElementById(id)); }
function toolResultError(containerId, message) {
  const container = document.getElementById(containerId);
  container.hidden = false;
  let error = container.querySelector('.tool-error');
  if (!error) { error = document.createElement('p'); error.className = 'tool-error'; error.setAttribute('role', 'alert'); container.prepend(error); }
  error.textContent = message;
}
function showToolResults(containerId) {
  const container = document.getElementById(containerId);
  container.hidden = false;
  const error = container.querySelector('.tool-error');
  if (error) error.remove();
}
function formatDuration(totalMinutes) {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${minutes} min`;
}

// 1) Tarifa estimada: diesel + outros custos opcionais, divididos por pagantes previstos.
$('#tariffForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const km = readToolValue('tariffKm');
  const consumption = readToolValue('tariffConsumption');
  const dieselPrice = readToolValue('tariffDieselPrice');
  const payers = readToolValue('tariffPayers');
  const otherCostsRaw = $('#tariffOtherCosts').value.trim();
  const marginRaw = $('#tariffMargin').value.trim();
  const otherCosts = otherCostsRaw === '' ? 0 : readToolValue('tariffOtherCosts');
  const margin = marginRaw === '' ? 0 : readToolValue('tariffMargin');
  if (km === null || km <= 0 || consumption === null || consumption <= 0 || dieselPrice === null || dieselPrice <= 0 || payers === null || !Number.isInteger(payers) || payers < 1 || otherCosts === null || margin === null || margin > 500) {
    toolResultError('tariffResults', 'Confira os quilômetros, o consumo médio em km/L, o preço do diesel e a quantidade inteira de pagantes.');
    return;
  }
  const liters = km / consumption;
  const fuelCost = liters * dieselPrice;
  const fuelOnlyFare = fuelCost / payers;
  const targetFare = ((fuelCost + otherCosts) * (1 + margin / 100)) / payers;
  showToolResults('tariffResults');
  $('#tariffLitersResult').textContent = `${numberPt(liters, 2)} L`;
  $('#tariffFuelCostResult').textContent = money(fuelCost);
  $('#tariffFuelOnlyResult').textContent = money(fuelOnlyFare);
  $('#tariffSuggestedResult').textContent = money(targetFare);
  $('#tariffExplanation').textContent = `Para ${numberPt(km, 2)} km, o modelo estima ${numberPt(liters, 2)} L de diesel a ${money(dieselPrice)}/L. O custo de combustível dividido por ${payers} pagantes resulta em ${money(fuelOnlyFare)} por pagante. Com ${money(otherCosts)} de outros custos e margem de ${numberPt(margin, 1)}%, a referência fica em ${money(targetFare)} por pagante. Use o consumo real do veículo e confira as regras de tarifa aplicáveis; este cálculo não define tarifa oficial.`;
});

// 2) Planejador de abastecimento pelo nível percentual do tanque.
$('#calculateFuelPlan').addEventListener('click', () => {
  const capacity = readToolValue('fuelPlanCapacity');
  const current = readToolValue('fuelPlanCurrent');
  const target = readToolValue('fuelPlanTarget');
  const price = readToolValue('fuelPlanPrice');
  if (capacity === null || capacity <= 0 || current === null || current > 100 || target === null || target > 100 || price === null || price <= 0) {
    toolResultError('fuelPlanResults', 'Informe a capacidade, porcentagens entre 0% e 100% e um preço de diesel válido.'); return;
  }
  if (target < current) { toolResultError('fuelPlanResults', 'O nível desejado é menor que o nível atual. Escolha uma porcentagem igual ou maior para calcular um abastecimento.'); return; }
  const currentLiters = capacity * current / 100;
  const targetLiters = capacity * target / 100;
  const needed = targetLiters - currentLiters;
  showToolResults('fuelPlanResults');
  $('#fuelPlanLiters').textContent = `${numberPt(needed, 2)} L`;
  $('#fuelPlanCost').textContent = money(needed * price);
  $('#fuelPlanCurrentLiters').textContent = `${numberPt(currentLiters, 2)} L`;
  $('#fuelPlanTargetLiters').textContent = `${numberPt(targetLiters, 2)} L`;
  $('#fuelPlanNote').textContent = needed === 0 ? 'O tanque já está no nível desejado; não seria necessário abastecer.' : `Para subir de ${numberPt(current, 1)}% para ${numberPt(target, 1)}%, a estimativa é abastecer ${numberPt(needed, 2)} L. O valor real pode variar conforme a bomba e a leitura do painel.`;
});

// 3) Estimador de duração de uma linha.
$('#durationForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const km = readToolValue('durationKm');
  const speed = readToolValue('durationSpeed');
  const stops = readToolValue('durationStops');
  const stopMinutes = readToolValue('durationStopMinutes');
  if (km === null || km <= 0 || speed === null || speed <= 0 || stops === null || !Number.isInteger(stops) || stopMinutes === null) {
    toolResultError('durationResults', 'Informe uma distância e velocidade maiores que zero, além de quantidades de paradas válidas.'); return;
  }
  const driving = km / speed * 60;
  const stopped = stops * stopMinutes;
  const total = driving + stopped;
  showToolResults('durationResults');
  $('#durationPretty').textContent = formatDuration(total);
  $('#durationDriveTime').textContent = formatDuration(driving);
  $('#durationStoppedTime').textContent = formatDuration(stopped);
});

// 5) Checklist pré-viagem persistente no navegador atual.
const CHECKLIST_KEY = 'grupoConect.checklist.v1';
const CHECKLIST_LAST_KEY = 'grupoConect.checklist.last.v1';
function loadChecklistState() {
  try { const stored = JSON.parse(localStorage.getItem(CHECKLIST_KEY) || '{}'); return stored && typeof stored === 'object' ? stored : {}; }
  catch (error) { return {}; }
}
function checklistItems() { return $$('[data-check-item]'); }
function renderChecklist() {
  const stored = loadChecklistState();
  checklistItems().forEach((box) => { box.checked = Boolean(stored[box.dataset.checkItem]); });
  const checked = checklistItems().filter((box) => box.checked).length;
  $('#checklistProgress').textContent = `${checked} de ${checklistItems().length}`;
  try {
    const last = JSON.parse(localStorage.getItem(CHECKLIST_LAST_KEY) || 'null');
    $('#checklistLastSaved').textContent = last ? `Último registro: ${new Date(last.timestamp).toLocaleString('pt-BR')} · ${last.checked}/${last.total} itens marcados.` : 'Nenhum registro de checklist salvo neste navegador.';
  } catch (error) { $('#checklistLastSaved').textContent = 'Nenhum registro de checklist salvo neste navegador.'; }
}
checklistItems().forEach((box) => box.addEventListener('change', () => {
  const stored = loadChecklistState(); stored[box.dataset.checkItem] = box.checked;
  try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(stored)); } catch (error) {}
  const checked = checklistItems().filter((item) => item.checked).length;
  $('#checklistProgress').textContent = `${checked} de ${checklistItems().length}`;
}));
$('#saveChecklist').addEventListener('click', () => {
  const items = checklistItems();
  const checked = items.filter((item) => item.checked);
  const saved = { timestamp: new Date().toISOString(), checked: checked.length, total: items.length, keys: checked.map((item) => item.dataset.checkItem) };
  try { localStorage.setItem(CHECKLIST_LAST_KEY, JSON.stringify(saved)); } catch (error) { showToast('Não foi possível salvar neste navegador.'); return; }
  renderChecklist();
  showToast(checked.length === items.length ? 'Checklist completo registrado.' : `Checklist parcial salvo: ${checked.length} de ${items.length} itens.`);
});
$('#resetChecklist').addEventListener('click', () => {
  checklistItems().forEach((item) => { item.checked = false; });
  try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify({})); } catch (error) {}
  $('#checklistProgress').textContent = `0 de ${checklistItems().length}`;
  showToast('Checklist desmarcado.');
});
$('#copyChecklist').addEventListener('click', async () => {
  const items = checklistItems(); const checked = items.filter((item) => item.checked);
  const report = ['GRUPO CONECT — CHECKLIST PRÉ-VIAGEM', `Data: ${new Date().toLocaleString('pt-BR')}`, `Progresso: ${checked.length}/${items.length}`, '', ...items.map((item) => `${item.checked ? '[X]' : '[ ]'} ${item.closest('.checklist-item').querySelector('strong').textContent}`), '', 'Este checklist é um lembrete de apoio e não substitui os procedimentos da empresa.'].join('\n');
  showToast(await copyText(report) ? 'Checklist copiado.' : 'Não foi possível copiar automaticamente.');
});

// 6) Agenda de manutenção salva localmente e com exclusão individual.
const MAINTENANCE_KEY = 'grupoConect.maintenance.v1';
function loadMaintenance() {
  try { const items = JSON.parse(localStorage.getItem(MAINTENANCE_KEY) || '[]'); return Array.isArray(items) ? items : []; }
  catch (error) { return []; }
}
function saveMaintenance(items) {
  try { localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(items.slice(0, 500))); return true; }
  catch (error) { showToast('Não foi possível salvar os lembretes neste navegador.'); return false; }
}


// Banco local do navegador para que as fotos de horários continuem disponíveis após recarregar a página.
function openPhotoDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
    const request = indexedDB.open(PHOTO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE_NAME)) db.createObjectStore(PHOTO_STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir banco de fotos'));
  });
}

async function dbPutPhoto(photo) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(PHOTO_STORE_NAME).put(photo);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
  });
}
async function dbGetPhotos() {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readonly');
    const req = tx.objectStore(PHOTO_STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('Falha ao ler fotos'));
    tx.oncomplete = () => db.close();
  });
}
async function dbDeletePhoto(id) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(PHOTO_STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const tempUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(tempUrl);
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Não foi possível processar a imagem'));
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Não foi possível salvar esta imagem'));
        resolve(blob);
      }, 'image/jpeg', 0.84);
    };
    img.onerror = () => { URL.revokeObjectURL(tempUrl); reject(new Error('Arquivo de imagem inválido')); };
    img.src = tempUrl;
  });
}

function revokePhotoUrl(id) {
  const url = state.objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.objectUrls.delete(id);
}

function renderPhotos() {
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  $('#photoCount').textContent = `${state.photos.length} ${state.photos.length === 1 ? 'foto' : 'fotos'}`;
  if (!state.photos.length) {
    grid.innerHTML = '<div class="empty-state" id="emptyPhotos"><div class="empty-icon" aria-hidden="true">▧</div><strong>Nenhuma foto por enquanto</strong><span>As fotos que você adicionar aparecerão aqui.</span></div>';
    return;
  }
  state.photos.forEach((photo) => {
    let url = state.objectUrls.get(photo.id);
    if (!url) {
      url = URL.createObjectURL(photo.blob);
      state.objectUrls.set(photo.id, url);
    }
    const card = document.createElement('article');
    card.className = 'photo-card';
    const img = document.createElement('img');
    img.src = url; img.alt = `Foto de horário: ${photo.name}`; img.loading = 'lazy';
    const caption = document.createElement('div'); caption.className = 'photo-card-caption';
    const name = document.createElement('span'); name.className = 'photo-name'; name.textContent = photo.name;
    name.title = photo.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-photo'; remove.textContent = 'Remover';
    remove.addEventListener('click', async () => {
      try { await dbDeletePhoto(photo.id); } catch (error) { /* a remoção visual ainda pode prosseguir */ }
      revokePhotoUrl(photo.id);
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      renderPhotos();
      showToast('Foto removida.');
    });
    caption.append(name, remove); card.append(img, caption); grid.append(card);
  });
}

$('#scheduleUpload').addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      const photo = {
        id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || `horario-${added + 1}.jpg`,
        blob,
        addedAt: new Date().toISOString()
      };
      await dbPutPhoto(photo);
      state.photos.push(photo);
      added += 1;
    } catch (error) {
      showToast('Uma foto não pôde ser salva neste navegador.');
    }
  }
  renderPhotos();
  if (added) showToast(`${added} ${added === 1 ? 'foto adicionada' : 'fotos adicionadas'}.`);
  event.target.value = '';
});

async function initializePhotos() {
  try {
    state.photos = await dbGetPhotos();
    renderPhotos();
  } catch (error) {
    renderPhotos();
    showToast('O salvamento de fotos não está disponível neste navegador.');
  }
}





// Dez novas ferramentas operacionais. Todos os registros ficam no navegador deste aparelho.
const ODOMETER_KEY = 'grupoConect.odometerRecords.v1';
const FUEL_LOG_KEY = 'grupoConect.fuelLog.v1';
const INCIDENT_KEY = 'grupoConect.incidents.v1';
const ENDCHECK_KEY = 'grupoConect.endChecklist.v1';
const endChecklistIds = ['passageiros','objetos','limpeza','avarias','combustivel','documentos','comunicacao'];
function readArrayKey(key) { try { const data=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(data)?data:[]; } catch(error) { return []; } }
function writeArrayKey(key, items) { try { localStorage.setItem(key, JSON.stringify(items.slice(-1000))); return true; } catch(error) { showToast('Armazenamento cheio ou indisponível neste navegador.'); return false; } }
function dateTodayLocal() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function localDate(value) { if(!value)return 'Sem data'; const d=new Date(`${value}T00:00:00`); return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('pt-BR'); }
function makeId() { return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function downloadTextFile(name, content, type='text/plain;charset=utf-8') { const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); }

// 1. Diário de bordo: hodômetro, distância percorrida e histórico.
function renderOdometer() {
  const rows=readArrayKey(ODOMETER_KEY); const total=rows.reduce((sum,item)=>sum+Number(item.km||0),0);
  $('#odoRecordCount').textContent=String(rows.length); $('#odoTotalKm').textContent=`${numberPt(total,1)} km`;
  const list=$('#odoList'); if(!rows.length){list.innerHTML='<p class="empty-state-text">Nenhum percurso registrado ainda.</p>';return;}
  list.innerHTML=rows.slice().reverse().map(item=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(item.vehicle)} · ${numberPt(item.km,1)} km</strong><small>${escapeHtml(localDate(item.date))} · hodômetro ${numberPt(item.start,1)} → ${numberPt(item.end,1)} km${item.notes?`\n${escapeHtml(item.notes)}`:''}</small></div><button class="record-danger" type="button" data-odo-delete="${escapeHtml(item.id)}">Excluir</button></div></article>`).join('');
  $('#odoRecordCount').textContent=String(rows.length); $('#odoTotalKm').textContent=`${numberPt(total,1)} km`;
}
$('#odoDate').value=dateTodayLocal();
$('#odometerForm').addEventListener('submit',event=>{event.preventDefault(); const date=$('#odoDate').value,vehicle=$('#odoVehicle').value.trim(),start=readToolValue('odoStart'),end=readToolValue('odoEnd'),notes=$('#odoNotes').value.trim(); if(!date||!vehicle||start===null||end===null||end<start){showToast('Confira o veículo e os hodômetros; o final precisa ser igual ou maior que o inicial.');return;} const km=end-start; const rows=readArrayKey(ODOMETER_KEY); rows.push({id:makeId(),date,vehicle,start,end,km,notes,createdAt:new Date().toISOString()}); if(!writeArrayKey(ODOMETER_KEY,rows))return; $('#odoTripKm').textContent=`${numberPt(km,1)} km`; $('#odoResults').hidden=false; $('#odometerForm').reset(); $('#odoDate').value=dateTodayLocal(); renderOdometer(); showToast('Quilometragem registrada.');});
$('#odoList').addEventListener('click',event=>{const b=event.target.closest('[data-odo-delete]');if(!b)return;writeArrayKey(ODOMETER_KEY,readArrayKey(ODOMETER_KEY).filter(x=>x.id!==b.dataset.odoDelete));renderOdometer();showToast('Registro de quilometragem excluído.');});
$('#copyOdoReport').addEventListener('click',async()=>{const rows=readArrayKey(ODOMETER_KEY);const text=['GRUPO CONECT — DIÁRIO DE BORDO',...rows.map(x=>`${localDate(x.date)} | ${x.vehicle} | ${numberPt(x.km,1)} km | ${numberPt(x.start,1)} → ${numberPt(x.end,1)} km${x.notes?' | '+x.notes:''}`),`Total registrado: ${numberPt(rows.reduce((s,x)=>s+Number(x.km||0),0),1)} km`].join('\n');showToast(await copyText(text)?'Relatório do diário de bordo copiado.':'Não foi possível copiar automaticamente.');});

// 2. Histórico de abastecimentos e soma de litros/custos.
function renderFuelLogs() { const rows=readArrayKey(FUEL_LOG_KEY); const liters=rows.reduce((s,x)=>s+Number(x.liters||0),0),cost=rows.reduce((s,x)=>s+Number(x.cost||0),0); $('#fuelLogTotalLiters').textContent=`${numberPt(liters,2)} L`;$('#fuelLogTotalCost').textContent=money(cost); const list=$('#fuelLogList'); if(!rows.length){list.innerHTML='<p class="empty-state-text">Nenhum abastecimento registrado ainda.</p>';return;} list.innerHTML=rows.slice().reverse().map(x=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(x.vehicle)} · ${money(x.cost)}</strong><small>${escapeHtml(localDate(x.date))} · ${numberPt(x.liters,2)} L × ${money(x.price)}/L${x.odometer!==null?` · hodômetro ${numberPt(x.odometer,1)} km`:''}${x.note?`\n${escapeHtml(x.note)}`:''}</small></div><button class="record-danger" type="button" data-fuel-delete="${escapeHtml(x.id)}">Excluir</button></div></article>`).join(''); }
$('#fuelLogForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#fuelLogDate').value,vehicle=$('#fuelLogVehicle').value.trim(),liters=readToolValue('fuelLogLiters'),price=readToolValue('fuelLogPrice'),odomRaw=$('#fuelLogOdometer').value.trim(),odometer=odomRaw===''?null:Number(odomRaw),note=$('#fuelLogNote').value.trim();if(!date||!vehicle||liters===null||liters<=0||price===null||price<=0||(odometer!==null&&(!Number.isFinite(odometer)||odometer<0))){showToast('Preencha os dados do abastecimento corretamente.');return;}const cost=liters*price;const rows=readArrayKey(FUEL_LOG_KEY);rows.push({id:makeId(),date,vehicle,liters,price,cost,odometer,note,createdAt:new Date().toISOString()});if(!writeArrayKey(FUEL_LOG_KEY,rows))return;$('#fuelLogCostResult').textContent=money(cost);$('#fuelLogResults').hidden=false;$('#fuelLogForm').reset();$('#fuelLogDate').value=dateTodayLocal();$('#fuelLogPrice').value=DIESEL_DEFAULT.toFixed(2);renderFuelLogs();showToast('Abastecimento salvo.');});
$('#fuelLogList').addEventListener('click',event=>{const b=event.target.closest('[data-fuel-delete]');if(!b)return;writeArrayKey(FUEL_LOG_KEY,readArrayKey(FUEL_LOG_KEY).filter(x=>x.id!==b.dataset.fuelDelete));renderFuelLogs();showToast('Abastecimento excluído.');});
$('#copyFuelLogReport').addEventListener('click',async()=>{const rows=readArrayKey(FUEL_LOG_KEY);const text=['GRUPO CONECT — ABASTECIMENTOS',...rows.map(x=>`${localDate(x.date)} | ${x.vehicle} | ${numberPt(x.liters,2)} L | ${money(x.price)}/L | total ${money(x.cost)}${x.odometer!==null?' | hodômetro '+numberPt(x.odometer,1)+' km':''}`),`Total: ${numberPt(rows.reduce((s,x)=>s+Number(x.liters||0),0),2)} L / ${money(rows.reduce((s,x)=>s+Number(x.cost||0),0))}`].join('\n');showToast(await copyText(text)?'Relatório de abastecimentos copiado.':'Não foi possível copiar automaticamente.');});
$('#fuelLogDate').value=dateTodayLocal();

// 3. Indicadores de eficiência a partir de uma medição.
$('#efficiencyForm').addEventListener('submit',event=>{event.preventDefault();const km=readToolValue('effKm'),liters=readToolValue('effLiters'),price=readToolValue('effPrice');if(km===null||km<=0||liters===null||liters<=0||price===null){toolResultError('effResults','Informe km e litros maiores que zero e um preço válido.');return;}showToolResults('effResults');$('#effKmPerL').textContent=`${numberPt(km/liters,2)} km/L`;$('#effPer100').textContent=`${numberPt(liters/km*100,2)} L/100 km`;$('#effCostKm').textContent=money(liters*price/km);$('#effTotalCost').textContent=money(liters*price);});

// 4. Meta de arrecadação e pagantes adicionais necessários.
$('#goalForm').addEventListener('submit',event=>{event.preventDefault();const target=readToolValue('goalTarget'),current=readToolValue('goalCurrent'),fare=readToolValue('goalFare');if(target===null||target<=0||current===null||fare===null||fare<=0){toolResultError('goalResults','Informe uma meta positiva, arrecadação atual não negativa e uma tarifa maior que zero.');return;}const remaining=Math.max(0,target-current),need=Math.ceil(remaining/fare),progress=Math.min(100,current/target*100),projected=current+need*fare;showToolResults('goalResults');$('#goalRemaining').textContent=money(remaining);$('#goalPayers').textContent=String(need);$('#goalProgress').textContent=`${numberPt(progress,1)}%`;$('#goalProjected').textContent=money(projected);$('#goalNote').textContent=remaining===0?'Meta atingida. A arrecadação informada já alcançou ou superou o objetivo.':`Faltam ${money(remaining)}. Com tarifa de ${money(fare)}, seriam necessários ${need} pagantes adicionais; a arrecadação pode superar a meta em até ${money(projected-target)} por causa do arredondamento para uma pessoa inteira.`;});

// 5. Grade de saídas gerada por intervalo, com suporte a cruzar meia-noite.
function minToClock(total) { const m=((total%1440)+1440)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
$('#timetableForm').addEventListener('submit',event=>{event.preventDefault();const route=$('#timeRoute').value.trim(),startVal=$('#timeStart').value,endVal=$('#timeEnd').value,interval=readToolValue('timeInterval');if(!route||!startVal||!endVal||interval===null||!Number.isInteger(interval)||interval<1||interval>1440){toolResultError('timeResults','Informe linha, horários e um intervalo inteiro entre 1 e 1440 minutos.');return;}const toM=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));let start=toM(startVal),end=toM(endVal);if(end<start)end+=1440;const times=[];for(let m=start;m<=end&&times.length<500;m+=interval)times.push(minToClock(m));if(!times.length){toolResultError('timeResults','Não foi possível gerar os horários.');return;}showToolResults('timeResults');$('#timeResultTitle').textContent=route;$('#timeDepartureCount').textContent=`${times.length} saídas`;$('#timeResultText').value=`GRUPO CONECT — GRADE DE HORÁRIOS\nLinha: ${route}\nIntervalo: ${interval} minuto(s)\n\n${times.map((t,i)=>`${String(i+1).padStart(2,'0')}. ${t}`).join('\n')}${times.length===500?'\n\nGrade limitada a 500 saídas.':''}`;});
$('#copyTimetable').addEventListener('click',async()=>showToast(await copyText($('#timeResultText').value)?'Grade de horários copiada.':'Não foi possível copiar automaticamente.'));

// 6. Turno, intervalo e tempo líquido com suporte a horários que passam da meia-noite.
function clockMinutes(v){return v?Number(v.slice(0,2))*60+Number(v.slice(3,5)):null;}
$('#shiftForm').addEventListener('submit',event=>{event.preventDefault();const start=clockMinutes($('#shiftStart').value),endInput=clockMinutes($('#shiftEnd').value),breakStartInput=clockMinutes($('#shiftBreakStart').value),breakEndInput=clockMinutes($('#shiftBreakEnd').value);if(start===null||endInput===null||start===endInput){toolResultError('shiftResults','Informe entrada e saída válidas, com horários diferentes.');return;}let end=endInput;if(end<=start)end+=1440;let pause=0;if((breakStartInput===null)!==(breakEndInput===null)){toolResultError('shiftResults','Preencha início e fim do intervalo ou deixe os dois vazios.');return;}if(breakStartInput!==null){let bs=breakStartInput,be=breakEndInput;while(bs<start)bs+=1440;while(be<bs)be+=1440;if(bs<start||be>end||be===bs){toolResultError('shiftResults','O intervalo precisa ocorrer dentro do turno e ter duração maior que zero.');return;}pause=be-bs;}const elapsed=end-start,net=elapsed-pause;showToolResults('shiftResults');$('#shiftElapsed').textContent=formatDuration(elapsed);$('#shiftBreak').textContent=formatDuration(pause);$('#shiftNet').textContent=formatDuration(net);$('#shiftNote').textContent=`Tempo líquido matemático: ${formatDuration(net)}. Esse cálculo é informativo e não determina pagamento, horas extras ou conformidade legal.`;});

// 7. Registro persistente de ocorrências com exclusão.
function renderIncidents(){const rows=readArrayKey(INCIDENT_KEY),list=$('#incidentList');if(!rows.length){list.innerHTML='<p class="empty-state-text">Nenhuma ocorrência registrada.</p>';return;}list.innerHTML=rows.slice().reverse().map(x=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(x.type)} · ${escapeHtml(x.vehicle)}</strong><small>${escapeHtml(localDate(x.date))} ${escapeHtml(x.time)} · Prioridade ${escapeHtml(x.severity)}\n${escapeHtml(x.description)}</small><span class="record-inline-tag">${escapeHtml(x.severity)}</span></div><button class="record-danger" type="button" data-incident-delete="${escapeHtml(x.id)}">Excluir</button></div></article>`).join('');}
$('#incidentDate').value=dateTodayLocal();
$('#incidentForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#incidentDate').value,time=$('#incidentTime').value,vehicle=$('#incidentVehicle').value.trim(),type=$('#incidentType').value,severity=$('#incidentSeverity').value,description=$('#incidentDescription').value.trim();if(!date||!time||!vehicle||!type||!description){showToast('Preencha todos os campos obrigatórios da ocorrência.');return;}const rows=readArrayKey(INCIDENT_KEY);rows.push({id:makeId(),date,time,vehicle,type,severity,description,createdAt:new Date().toISOString()});if(!writeArrayKey(INCIDENT_KEY,rows))return;$('#incidentForm').reset();$('#incidentDate').value=dateTodayLocal();$('#incidentSeverity').value='Informativa';renderIncidents();showToast('Ocorrência registrada.');});
$('#incidentList').addEventListener('click',event=>{const b=event.target.closest('[data-incident-delete]');if(!b)return;writeArrayKey(INCIDENT_KEY,readArrayKey(INCIDENT_KEY).filter(x=>x.id!==b.dataset.incidentDelete));renderIncidents();showToast('Ocorrência excluída.');});
$('#copyIncidents').addEventListener('click',async()=>{const rows=readArrayKey(INCIDENT_KEY);const text=['GRUPO CONECT — RELATÓRIO DE OCORRÊNCIAS',...rows.map(x=>`${localDate(x.date)} ${x.time} | ${x.vehicle} | ${x.type} | ${x.severity}\n${x.description}`)].join('\n\n');showToast(await copyText(text)?'Relatório de ocorrências copiado.':'Não foi possível copiar automaticamente.');});

// 8. Checklist de encerramento de viagem, com estado salvo localmente.
function loadEndChecklist(){try{const x=JSON.parse(localStorage.getItem(ENDCHECK_KEY)||'{}');return x&&typeof x==='object'?x:{};}catch(e){return{};}}
function renderEndChecklist(){const data=loadEndChecklist();$$('[data-endcheck]').forEach(box=>box.checked=Boolean(data[box.dataset.endcheck]));const count=$$('[data-endcheck]').filter(box=>box.checked).length;$('#endCheckProgress').textContent=`${count} de ${endChecklistIds.length}`;if(data.savedAt)$('#endCheckSaved').textContent=`Última conferência salva: ${new Date(data.savedAt).toLocaleString('pt-BR')} · ${count}/${endChecklistIds.length} itens marcados.`;}
$$('[data-endcheck]').forEach(box=>box.addEventListener('change',()=>{const data=loadEndChecklist();data[box.dataset.endcheck]=box.checked;try{localStorage.setItem(ENDCHECK_KEY,JSON.stringify(data));}catch(e){}renderEndChecklist();}));
$('#saveEndChecklist').addEventListener('click',()=>{const data=loadEndChecklist();data.savedAt=new Date().toISOString();try{localStorage.setItem(ENDCHECK_KEY,JSON.stringify(data));renderEndChecklist();showToast('Conferência de fim de viagem salva.');}catch(e){showToast('Não foi possível salvar a conferência.');}});
$('#resetEndChecklist').addEventListener('click',()=>{try{localStorage.removeItem(ENDCHECK_KEY);}catch(e){}renderEndChecklist();showToast('Checklist de encerramento desmarcado.');});
$('#copyEndChecklist').addEventListener('click',async()=>{const data=loadEndChecklist();const text=['GRUPO CONECT — CHECKLIST DE FIM DE VIAGEM',`Data: ${new Date().toLocaleString('pt-BR')}`,...$$('[data-endcheck]').map(box=>`${box.checked?'[X]':'[ ]'} ${box.closest('.checklist-item').querySelector('strong').textContent}`),'','Este checklist é um lembrete de apoio e não substitui os procedimentos oficiais.'].join('\n');showToast(await copyText(text)?'Checklist de encerramento copiado.':'Não foi possível copiar automaticamente.');});

// 9. Comparação estimada de duas linhas com a mesma referência de preço de diesel.
$('#routeCompareForm').addEventListener('submit',event=>{event.preventDefault();const diesel=readToolValue('compareDieselPrice');if(diesel===null||diesel<=0){toolResultError('routeCompareResults','Informe um preço válido do diesel.');return;}const routes=['A','B'].map(k=>({name:$('#compare'+k+'Name').value.trim(),km:readToolValue('compare'+k+'Km'),eff:readToolValue('compare'+k+'Eff'),fare:readToolValue('compare'+k+'Fare'),payers:readToolValue('compare'+k+'Payers')}));if(routes.some(r=>!r.name||r.km===null||r.km<=0||r.eff===null||r.eff<=0||r.fare===null||r.payers===null||!Number.isInteger(r.payers))){toolResultError('routeCompareResults','Confira o nome, km, consumo, tarifa e quantidade inteira de pagantes das duas linhas.');return;}const calc=r=>({...r,liters:r.km/r.eff,cost:r.km/r.eff*diesel,revenue:r.fare*r.payers,net:r.fare*r.payers-r.km/r.eff*diesel});const data=routes.map(calc);showToolResults('routeCompareResults');$('#routeCompareCards').innerHTML=data.map((r,i)=>`<article class="compare-route"><span class="route-card-tag">${i===0?'LINHA A':'LINHA B'}</span><h3>${escapeHtml(r.name)}</h3><div class="tool-result-grid"><article class="tool-stat"><span>Diesel estimado</span><strong>${numberPt(r.liters,2)} L</strong></article><article class="tool-stat"><span>Custo do diesel</span><strong>${money(r.cost)}</strong></article><article class="tool-stat"><span>Arrecadação</span><strong>${money(r.revenue)}</strong></article><article class="tool-stat ${r.net>=0?'tool-stat-highlight':''}"><span>Resultado antes de outros custos</span><strong>${money(r.net)}</strong></article></div></article>`).join('');const better=data[0].net===data[1].net?'As duas linhas têm o mesmo resultado estimado.':`${data[0].net>data[1].net?data[0].name:data[1].name} tem o maior resultado estimado nesta simulação.`;$('#routeCompareNote').textContent=`${better} O cálculo considera apenas arrecadação de pagantes menos diesel e depende das médias informadas; não inclui outros custos.`;});

// 10. Backup/restore compatível com o formato oficial do Grupo Conect.
// O formato de exportação permanece app/format/version/data, com valores string
// de localStorage para que arquivos antigos continuem intercambiáveis.
let selectedBackupFile=null, selectedBackupPayload=null;
function collectBackup(){const data={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith('grupoConect.'))data[key]=localStorage.getItem(key);}return {app:'Grupo Conect',format:'localStorage-backup',version:1,exportedAt:new Date().toISOString(),data};}
function backupModuleForKey(key){
 const k=String(key||'').toLowerCase();
 if(/operationviewer|operationcashstate|virtualdrivercounts|tripHistory|activeDay|dayCount|ownerScales|ownerRoutes/.test(k))return 'Visualizador, linhas e escalas';
 if(/cashLedger|bank|financedBuses|zeroKmQuotes/.test(k))return 'Banco e financeiro';
 if(/ownerFleet|busDocument|documentDeadlines|odometer|gpsStops/.test(k))return 'Frota e documentação';
 if(/garage|cleaningRecords|tireInspections/.test(k))return 'Garagem e mecânica';
 if(/agenda/.test(k))return 'Agenda de Frota';
 if(/adminFuel|fuelLog|operatingExpenses/.test(k))return 'Combustível e despesas';
 if(/intercity/.test(k))return 'Linhas intermunicipais';
 if(/onlineFretamento|municipalContracts/.test(k))return 'Atendimento e contratos';
 if(/apprentice|ownerActivities/.test(k))return 'Jovem Aprendiz e Funções Dono';
 if(/bankStaff|garageStaff/.test(k))return 'Funcionários e contratações';
 if(/validator|checklist|incident|handover|lostFound|stopPlans|fareReconciliations|maintenance/.test(k))return 'Ferramentas operacionais e históricos';
 return 'Outros dados Grupo Conect';
}
function backupPayloadSummary(backup){
 const entries=Object.entries(backup.data||{}),groups=new Map(),counts=[];let invalidJson=0,rawBytes=0;
 entries.forEach(([key,value])=>{const group=backupModuleForKey(key);groups.set(group,(groups.get(group)||0)+1);rawBytes+=String(value).length;try{const parsed=JSON.parse(value);if(Array.isArray(parsed))counts.push({key,count:parsed.length});else if(parsed&&typeof parsed==='object')counts.push({key,count:Object.keys(parsed).length});}catch(e){invalidJson++;}});
 const recordTotal=counts.reduce((sum,x)=>sum+x.count,0);
 return {entries,groups:[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')),rawBytes,invalidJson,recordTotal,counts};
}
function renderBackupPreview(backup){
 const box=$('#backupPreview');if(!box)return;
 if(!backup){box.hidden=true;box.innerHTML='';return;}
 const summary=backupPayloadSummary(backup),groupRows=summary.groups.map(([name,count])=>`<li><span>${escapeHtml(name)}</span><strong>${count} chave(s)</strong></li>`).join('');
 box.hidden=false;box.innerHTML=`<div class="backup-preview-heading"><strong>Conteúdo reconhecido</strong><span class="doc-status-tag">Grupo Conect · v${backup.version}</span></div><div class="backup-preview-kpis"><div><span>Conjuntos de dados</span><strong>${summary.entries.length}</strong></div><div><span>Registros / itens JSON</span><strong>${summary.recordTotal}</strong></div><div><span>Tamanho interno</span><strong>${numberPt(summary.rawBytes/1024,1)} KB</strong></div><div><span>Valores não JSON</span><strong>${summary.invalidJson}</strong></div></div><ul class="backup-preview-groups">${groupRows}</ul><p class="tool-result-note">Exportado em: ${escapeHtml(backup.exportedAt||'data não informada')}. Os valores são mantidos nas chaves originais sempre que possível; chaves desconhecidas serão preservadas como dados locais, sem criar telas novas.</p>`;
}
$('#downloadBackup').addEventListener('click',()=>{const backup=collectBackup();downloadTextFile(`grupo-conect-backup-${dateTodayLocal()}.json`,JSON.stringify(backup,null,2),'application/json;charset=utf-8');$('#backupStatus').textContent=`Backup gerado com ${Object.keys(backup.data).length} conjunto(s) de dados. Guarde o arquivo em local seguro.`;showToast('Backup JSON compatível exportado.');});
$('#backupFile').addEventListener('change',event=>{
 selectedBackupFile=event.target.files?.[0]||null;selectedBackupPayload=null;$('#restoreBackup').disabled=true;renderBackupPreview(null);
 if(!selectedBackupFile){$('#backupStatus').textContent='Nenhum arquivo selecionado.';return;}
 if(selectedBackupFile.size>50*1024*1024){$('#backupStatus').textContent='Arquivo acima de 50 MB. Selecione um backup menor.';selectedBackupFile=null;return;}
 const reader=new FileReader();reader.onerror=()=>$('#backupStatus').textContent='Não foi possível ler o arquivo selecionado.';
 reader.onload=()=>{try{const backup=JSON.parse(String(reader.result||''));if(!backup||backup.app!=='Grupo Conect'||backup.format!=='localStorage-backup'||backup.version!==1||!backup.data||typeof backup.data!=='object'||Array.isArray(backup.data))throw new Error('O JSON não corresponde ao formato localStorage-backup do Grupo Conect (version 1).');const entries=Object.entries(backup.data);if(entries.length>20000||entries.some(([key,value])=>!key.startsWith('grupoConect.')||typeof value!=='string'))throw new Error('O arquivo contém chaves fora de grupoConect.* ou valores que não são strings.');selectedBackupPayload=backup;renderBackupPreview(backup);$('#restoreBackup').disabled=false;$('#backupStatus').textContent=`Arquivo reconhecido: ${selectedBackupFile.name}. Revise o conteúdo e escolha Mesclar ou Substituir antes de restaurar.`;}catch(error){selectedBackupPayload=null;$('#restoreBackup').disabled=true;$('#backupStatus').textContent=`Backup recusado: ${error.message||'arquivo incompatível'}`;}};
 reader.readAsText(selectedBackupFile);
});
$('#restoreBackup').addEventListener('click',()=>{
 const backup=selectedBackupPayload;if(!backup)return;
 const entries=Object.entries(backup.data),mode=$('#backupRestoreMode')?.value||'merge',current=collectBackup(),incomingKeys=new Set(entries.map(([key])=>key));
 const removeKeys=mode==='replace'?Object.keys(current.data).filter(key=>!incomingKeys.has(key)):[];
 const msg=`Backup válido do Grupo Conect (v${backup.version}).

${entries.length} chaves serão importadas.
Modo: ${mode==='merge'?'MESCLAR (preserva chaves locais ausentes)':'SUBSTITUIR (remove chaves Grupo Conect ausentes no arquivo)'}.
${removeKeys.length} chave(s) local(is) ${mode==='replace'?'serão removidas':''}.

Antes da gravação, será baixado um backup de segurança do estado atual. Continuar?`;
 if(!window.confirm(msg))return;
 try{
  // Backup anterior à restauração, mantendo o formato antigo para recuperação manual.
  downloadTextFile(`seguranca-antes-restauracao-${dateTodayLocal()}-${Date.now()}.json`,JSON.stringify(current,null,2),'application/json;charset=utf-8');
  const before=new Map();for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith('grupoConect.'))before.set(key,localStorage.getItem(key));}
  try{
   if(mode==='replace')removeKeys.forEach(key=>localStorage.removeItem(key));
   entries.forEach(([key,value])=>localStorage.setItem(key,value));
   // Confirma a persistência real antes de declarar sucesso.
   const failed=entries.filter(([key,value])=>localStorage.getItem(key)!==value);
   if(failed.length)throw new Error(`${failed.length} chave(s) não foram gravadas integralmente (possível limite de armazenamento).`);
  }catch(writeError){
   const afterKeys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith('grupoConect.'))afterKeys.push(key);}
   afterKeys.forEach(key=>{if(!before.has(key))localStorage.removeItem(key);});
   before.forEach((value,key)=>{if(value!==null)localStorage.setItem(key,value);});
   throw writeError;
  }
  const summary=backupPayloadSummary(backup);
  $('#backupStatus').textContent=`Restauração concluída e verificada: ${entries.length} chaves importadas; ${removeKeys.length} chaves removidas; ${summary.groups.length} áreas identificadas. O backup de segurança anterior foi baixado. A página será recarregada para reler os dados.`;
  showToast('Backup importado e conferido.');setTimeout(()=>window.location.reload(),1100);
 }catch(error){$('#backupStatus').textContent=`Restauração cancelada/revertida: ${error.message||'falha de armazenamento'}. Os dados anteriores foram preservados sempre que o navegador permitiu a reversão.`;showToast('Não foi possível concluir a restauração.');}
});


// Funções Extras do Dono: análises práticas conectadas aos dados já salvos no simulador.
function oeRenderOverview(){
  const operations=syncOperationRows(Date.now()), cash=cashBreakdown();
  const active=operations.filter(operationIsRunning).length;
  const paused=operations.filter(x=>x.status==='pausada').length;
  const stopped=operations.filter(x=>x.status==='fora de operação'||x.status==='parada técnica').length;
  const trips=operations.reduce((sum,x)=>sum+Math.max(0,Number(x.completedTrips)||0),0);
  const gross=operations.reduce((sum,x)=>sum+(Number(operationSummary(x).totals.revenue)||0),0);
  const fuel=operations.reduce((sum,x)=>sum+(Number(operationSummary(x).totals.fuelCost)||0),0);
  const net=operations.reduce((sum,x)=>sum+operationLifetimeNet(x),0);
  $('#oeOverviewResult').innerHTML=[
    ['Linhas cadastradas',String(operations.length)],['Em operação',String(active)],['Pausadas',String(paused)],['Fora de operação',String(stopped)],
    ['Viagens concluídas',String(trips)],['Arrecadação da operação',money(gross)],['Diesel estimado',money(fuel)],['Lucro acumulado da operação',money(net),net>=0?'positive':'negative'],['Saldo atual do caixa',money(cash.balance),cash.balance>=0?'positive':'negative']
  ].map(([l,v,k])=>moneyStat(l,v,k||'')).join('');
  const drivers=new Map();
  operations.forEach(op=>Object.values(op.driverTotals||{}).forEach(d=>{const name=String(d.name||'Motorista não definido'),key=`${norm(op.company)}|${norm(name)}`;if(!drivers.has(key))drivers.set(key,{company:op.company||'Empresa',name,trips:0,revenue:0,fuel:0,net:0});const r=drivers.get(key);r.trips+=Number(d.trips)||0;r.revenue+=Number(d.revenue)||0;r.fuel+=Number(d.fuelCost)||0;r.net+=Number(d.net)||0;}));
  const ranked=[...drivers.values()].sort((a,b)=>b.net-a.net).slice(0,6);
  $('#oeOverviewDrivers').innerHTML=ranked.length?`<p class="tool-result-note"><strong>Melhores resultados acumulados por motorista (até 6):</strong></p>`+ranked.map(d=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(d.name)} · ${escapeHtml(d.company)}</strong><small>${d.trips} viagem(ns) · arrecadação ${money(d.revenue)} · diesel ${money(d.fuel)}</small></div><strong class="${d.net>=0?'positive':'negative'}">${money(d.net)}</strong></div></article>`).join(''):recordsEmpty('Nenhum motorista tem viagem concluída na operação ainda.');
}
function oeUpdateProjectionOptions(){
  const select=$('#oeProjectionOperation');if(!select)return;
  const previous=select.value, operations=syncOperationRows(Date.now());
  populateSelect(select,operations.length?'Selecione uma operação':'Nenhuma operação cadastrada',operations.map(x=>({value:String(x.id),label:`${x.company} · ${x.city} · ${x.line} · prefixo ${x.prefix} (${x.status||'sem status'})`})));
  if(operations.some(x=>String(x.id)===previous))select.value=previous;
}
function oeRunProjection(){
  if(!assertOwner())return;
  const id=$('#oeProjectionOperation').value, extra=readToolValue('oeProjectionTrips');
  const operations=syncOperationRows(Date.now()),op=operations.find(x=>String(x.id)===String(id));
  if(!op||extra===null||!Number.isInteger(extra)||extra<0||extra>300){$('#oeProjectionResult').innerHTML=moneyStat('Aviso','Selecione uma operação e informe 0–300 viagens.');return;}
  const actualTrips=Math.max(0,Number(op.completedTrips)||0),actualNet=operationLifetimeNet(op);
  const economics=op.unitEconomics||operationEconomics(op.company,op.city,op.line),unitNet=Number(economics.unitNet)||0;
  const forecast=actualNet+extra*unitNet;
  $('#oeProjectionResult').innerHTML=[['Viagens concluídas',String(actualTrips)],['Resultado já registrado',money(actualNet),actualNet>=0?'positive':'negative'],['Média estimada por viagem',money(unitNet),unitNet>=0?'positive':'negative'],['Resultado das viagens adicionais',money(extra*unitNet),(extra*unitNet)>=0?'positive':'negative'],['Projeção após as viagens',money(forecast),forecast>=0?'positive':'negative']].map(([l,v,k])=>moneyStat(l,v,k||'')).join('')+`<p class="tool-result-note owner-extra-note">Base: ${escapeHtml(economics.sampleCount?`${economics.sampleCount} viagem(ns) do histórico normal`:'estimativa usada pela operação por falta de histórico compatível')}. A projeção não lança dinheiro no caixa; ele só muda quando a viagem realmente termina no simulador.</p>`;
}
function oeCheckCashReserve(){
  if(!assertOwner())return;
  const balance=cashBreakdown().balance,today=dateTodayLocal(),td=dateFromISO(today);td.setDate(td.getDate()+30);const horizon=`${td.getFullYear()}-${String(td.getMonth()+1).padStart(2,'0')}-${String(td.getDate()).padStart(2,'0')}`;
  const dueRows=financedBuses().filter(f=>(Number(f.paidCount)||0)<(Number(f.installmentCount)||0)).map(f=>{const due=addMonthsToISO(f.firstDueDate,Number(f.paidCount)||0),late=daysLateFrom(due),fine=late?Number(f.installmentAmount||0)*Number(f.lateFinePct||0)/100:0,interest=late?Number(f.installmentAmount||0)*Number(f.lateInterestPct||0)/100*(late/30):0;return {...f,due,late,total:Number(f.installmentAmount||0)+fine+interest};}).filter(f=>f.due&&f.due<=horizon).sort((a,b)=>a.due.localeCompare(b.due));
  const dueTotal=dueRows.reduce((sum,f)=>sum+f.total,0),after=balance-dueTotal;
  $('#oeCashReserveResult').innerHTML=[['Saldo disponível agora',money(balance),balance>=0?'positive':'negative'],['Parcelas vencidas/próximos 30 dias',String(dueRows.length)],['Valor estimado a reservar',money(dueTotal)],['Saldo após reservar parcelas',money(after),after>=0?'positive':'negative']].map(([l,v,k])=>moneyStat(l,v,k||'')).join('')+`<p class="tool-result-note owner-extra-note">Período analisado: ${localDate(today)} até ${localDate(horizon)}. Encargos de atraso são estimados com as taxas configuradas em cada contrato.</p>`;
  $('#oeCashReserveList').innerHTML=dueRows.length?dueRows.map(f=>`<article class="record-item"><div><strong>${escapeHtml(f.company)} · ${escapeHtml(f.prefix)} · ${escapeHtml(f.model)}</strong><small>Vencimento ${localDate(f.due)} · ${f.late?`${f.late} dia(s) em atraso`:'dentro do horizonte'} · ${f.installmentCount-f.paidCount} parcela(s) restante(s)</small></div><strong>${money(f.total)}</strong></article>`).join(''):recordsEmpty('Não há parcelas vencidas ou com vencimento nos próximos 30 dias.');
}
function oeRenderAudit(targetId,items,emptyText){
  const el=$('#'+targetId);if(!el)return;
  if(!items.length){el.innerHTML=`<div class="owner-extra-status success"><strong>✓ Nenhum conflito detectado</strong><p>${escapeHtml(emptyText)}</p></div>`;return;}
  el.innerHTML=`<div class="owner-extra-status warning"><strong>⚠ ${items.length} alerta(s) para revisar</strong><ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul><p>Confira os cadastros antes de considerar a escala definitiva.</p></div>`;
}
function oeAuditFleet(){
  if(!assertOwner())return;
  const alerts=[],groups=new Map();
  ownerScales().filter(x=>x.date&&x.company&&x.prefix).forEach(x=>{const key=`${x.date}|${norm(x.company)}|${norm(x.prefix)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);});
  groups.forEach(rows=>{const lines=[...new Set(rows.map(x=>`${x.city||''} · ${x.line||''}`))];if(lines.length>1)alerts.push(`${rows[0].company} · prefixo ${rows[0].prefix} · ${localDate(rows[0].date)} aparece em ${lines.join(' / ')}.`);});
  const running=ownerOperations().filter(operationIsRunning),opGroups=new Map();running.forEach(op=>{const key=`${norm(op.company)}|${norm(op.prefix)}`;if(!opGroups.has(key))opGroups.set(key,[]);opGroups.get(key).push(op);});
  opGroups.forEach(rows=>{const lines=[...new Set(rows.map(x=>`${x.city} · ${x.line}`))];if(lines.length>1)alerts.push(`${rows[0].company} · prefixo ${rows[0].prefix} está em ${rows.length} operações ativas: ${lines.join(' / ')}.`);});
  oeRenderAudit('oeFleetAuditResult',alerts,'Os prefixos das escalas salvas e das operações ativas não aparecem duplicados por data/linha.');
}
function oeAuditDrivers(){
  if(!assertOwner())return;
  const active=ownerOperations().filter(operationIsRunning),groups=new Map();
  active.forEach(op=>{[['manhã','morning'],['tarde','afternoon'],['noite','night']].forEach(([label,key])=>{const name=String(op.drivers?.[key]||'').trim();if(!name)return;const groupKey=`${profitMatchKey(name)}|${key}`;if(!groups.has(groupKey))groups.set(groupKey,{name,shift:label,ops:[]});groups.get(groupKey).ops.push(op);});});
  const alerts=[];groups.forEach(g=>{if(g.ops.length>1){const lines=[...new Set(g.ops.map(o=>`${o.company} · ${o.city} · ${o.line}`))];if(lines.length>1)alerts.push(`${g.name} aparece no turno da ${g.shift} em ${lines.join(' / ')}.`);}});
  oeRenderAudit('oeDriverAuditResult',alerts,'Nenhum motorista aparece em mais de uma linha ativa no mesmo turno. Linhas pausadas não entram nesta verificação.');
}
function oeRankRoutes(){
  if(!assertOwner())return;
  const groups=new Map();
  loadHistory().filter(t=>t.company&&t.city&&t.line).forEach(t=>{const key=[t.company,t.city,t.line].map(profitMatchKey).join('|');if(!groups.has(key))groups.set(key,{company:t.company,city:t.city,line:t.line,count:0,revenue:0,fuel:0,net:0,days:new Set()});const g=groups.get(key);g.count++;g.revenue+=Number(t.revenue)||0;g.fuel+=Number(t.fuelCost)||0;g.net+=historicalTripNet(t);g.days.add(t.dayId||t.dayLabel||'Dia sem identificação');});
  const rows=[...groups.values()].map(g=>({...g,average:g.count?g.net/g.count:0})).sort((a,b)=>b.average-a.average);
  if(!rows.length){$('#oeRouteRankingResult').innerHTML='<div class="owner-extra-status"><strong>Sem dados suficientes</strong><p>Finalize viagens normais e identifique empresa, cidade e nome da linha para montar o ranking.</p></div>';return;}
  const top=rows.slice(0,3), bottom=rows.slice(-Math.min(3,rows.length)).reverse();
  const render=(r,label)=>`<article class="record-item"><div class="record-item-top"><div><strong>${label} · ${escapeHtml(r.company)} · ${escapeHtml(r.line)}</strong><small>${escapeHtml(r.city)} · ${r.count} viagem(ns) em ${r.days.size} dia(s) · arrecadação ${money(r.revenue)} · diesel ${money(r.fuel)}</small></div><strong class="${r.average>=0?'positive':'negative'}">Média ${money(r.average)}<small class="oe-small-stat">Total ${money(r.net)}</small></strong></div></article>`;
  $('#oeRouteRankingResult').innerHTML=`<p class="tool-result-note"><strong>Melhores médias</strong></p>${top.map((r,i)=>render(r,`#${i+1}`)).join('')}<p class="tool-result-note"><strong>Menores médias</strong></p>${bottom.map(r=>render(r,'Revisar')).join('')}<p class="tool-result-note owner-extra-note">O resultado considera arrecadação menos diesel. Não inclui despesas que não foram registradas na viagem. O ranking só usa registros com empresa, cidade e linha.</p>`;
}
function oeCalcFare(event){
  event.preventDefault();if(!assertOwner())return;
  const payers=readToolValue('oeFarePayers'),diesel=readToolValue('oeFareDiesel'),labor=readToolValue('oeFareLabor'),maintenance=readToolValue('oeFareMaintenance'),fixed=readToolValue('oeFareFixed'),margin=readToolValue('oeFareMarginPct');
  if([payers,diesel,labor,maintenance,fixed,margin].some(v=>v===null)||!Number.isInteger(payers)||payers<1||margin>300){$('#oeFareResult').innerHTML=moneyStat('Aviso','Confira os números; pagantes precisa ser inteiro e margem entre 0% e 300%.');return;}
  const costs=diesel+labor+maintenance+fixed,required=costs*(1+margin/100)/payers,breakEven=costs/payers;
  $('#oeFareResult').innerHTML=[['Custos do período',money(costs)],['Tarifa para empatar',money(breakEven)],['Tarifa com margem',money(required)],['Receita necessária',money(required*payers)]].map(([l,v])=>moneyStat(l,v)).join('')+`<p class="tool-result-note owner-extra-note">Estimativa de ${money(required)} por pagante. Arredonde conforme a regra tarifária do seu cenário e confira se todos os custos correspondem ao mesmo período.</p>`;
}
function oeCalcFuel(event){
  event.preventDefault();if(!assertOwner())return;
  const km=readToolValue('oeFuelKm'),trips=readToolValue('oeFuelTrips'),eff=readToolValue('oeFuelEfficiency'),price=readToolValue('oeFuelPrice'),days=readToolValue('oeFuelDays');
  if([km,trips,eff,price,days].some(v=>v===null)||km<=0||eff<=0||price<0||!Number.isInteger(trips)||trips<1||!Number.isInteger(days)||days<1){$('#oeFuelResult').innerHTML=moneyStat('Aviso','Confira km, consumo, viagens, preço e dias de operação.');return;}
  const dailyKm=km*trips,dailyLiters=dailyKm/eff,dailyCost=dailyLiters*price,monthlyLiters=dailyLiters*days,monthlyCost=dailyCost*days;
  $('#oeFuelResult').innerHTML=[['Km por dia',`${numberPt(dailyKm,1)} km`],['Diesel por dia',`${numberPt(dailyLiters,2)} L`],['Custo diário',money(dailyCost)],['Diesel por mês',`${numberPt(monthlyLiters,1)} L`],['Custo mensal',money(monthlyCost)]].map(([l,v])=>moneyStat(l,v)).join('');
}
function oeCalcFleetReserve(){
  if(!assertOwner())return;
  const company=$('#oeReserveCompany').value,peak=readToolValue('oeReservePeak'),pct=readToolValue('oeReservePct');
  if(!company||peak===null||pct===null||!Number.isInteger(peak)||peak<1||!Number.isInteger(pct)||pct<0||pct>100){$('#oeFleetReserveResult').innerHTML=moneyStat('Aviso','Informe empresa, demanda inteira e reserva entre 0% e 100%.');return;}
  const buses=availableBusPool(company),count=buses.length,reserve=Math.ceil(peak*pct/100),needed=peak+reserve,short=Math.max(0,needed-count);
  $('#oeFleetReserveResult').innerHTML=[['Frota registrada',String(count)],['Ônibus necessários para operar',String(peak)],['Reserva recomendada',String(reserve)],['Total desejável',String(needed)],['Situação',short?`Faltam ${short} ônibus`:'Frota suficiente',short?'negative':'positive']].map(([l,v,k])=>moneyStat(l,v,k||'')).join('')+`<p class="tool-result-note owner-extra-note">A frota consultada considera ${escapeHtml(company)}. O cálculo não muda a escala: use o resultado como recomendação e confira veículos já atribuídos a outras linhas na mesma data.</p>`;
}
function oeRenderBackupSummary(){
  const backup=collectBackup(), data=backup.data;
  const countKey=(key)=>{try{const x=JSON.parse(data[key]||'null');return Array.isArray(x)?x.length:(x&&typeof x==='object'?Object.keys(x).length:(data[key]!==undefined?1:0));}catch(e){return data[key]!==undefined?1:0;}};
  const entries=[['Conjuntos de dados',String(Object.keys(data).length)],['Viagens normais',String(countKey(HISTORY_KEY))],['Linhas de operação',String(countKey(OPERATION_KEY))],['Escalas salvas',String(countKey(OWNER_SCALE_KEY))],['Ônibus financiados',String(countKey(FINANCED_BUSES_KEY))],['Movimentos manuais do caixa',String(countKey(CASH_LEDGER_KEY))],['Registros de GPS',String(countKey(GC_GPS_STORAGE_KEY))],['Dias do intermunicipal',String(countKey(GC_IC_STORAGE_KEY))]];
  $('#oeBackupSummary').innerHTML=entries.map(([l,v])=>moneyStat(l,v)).join('')+'<p class="tool-result-note owner-extra-note">O arquivo inclui todas as chaves localStorage que começam com “grupoConect.”. Fotos de horários guardadas separadamente no IndexedDB podem exigir exportação própria; confirme o backup antes de trocar de aparelho.</p>';
}
$('#ownerExtrasToggle').addEventListener('click',()=>{
  if(!assertOwner())return;
  const panel=$('#ownerExtraFunctionsPanel'),open=panel.hidden;
  panel.hidden=!open;$('#ownerExtrasToggle').setAttribute('aria-expanded',String(open));$('#ownerExtrasToggle').textContent=open?'🧰 Ocultar Funções Extras do Dono ↑':'🧰 Abrir Funções Extras do Dono →';
  if(open){oeUpdateProjectionOptions();oeRenderOverview();oeCheckCashReserve();oeAuditFleet();oeAuditDrivers();oeRankRoutes();oeRenderBackupSummary();panel.scrollIntoView({behavior:'smooth',block:'start'});}
});
$('#ownerExtrasClose').addEventListener('click',()=>{ $('#ownerExtraFunctionsPanel').hidden=true;$('#ownerExtrasToggle').setAttribute('aria-expanded','false');$('#ownerExtrasToggle').textContent='🧰 Abrir Funções Extras do Dono →';$('#ownerExtrasToggle').scrollIntoView({behavior:'smooth',block:'center'});});
$('#oeRefreshOverview').addEventListener('click',oeRenderOverview);
$('#oeRunProjection').addEventListener('click',oeRunProjection);
$('#oeCheckCashReserve').addEventListener('click',oeCheckCashReserve);
$('#oeAuditFleet').addEventListener('click',oeAuditFleet);
$('#oeAuditDrivers').addEventListener('click',oeAuditDrivers);
$('#oeRankRoutes').addEventListener('click',oeRankRoutes);
$('#oeFareForm').addEventListener('submit',oeCalcFare);
$('#oeFuelForm').addEventListener('submit',oeCalcFuel);
$('#oeCalcFleetReserve').addEventListener('click',oeCalcFleetReserve);
$('#oeRefreshBackup').addEventListener('click',oeRenderBackupSummary);
$('#oeDownloadBackup').addEventListener('click',()=>{if(!assertOwner())return;const backup=collectBackup();downloadTextFile(`grupo-conect-backup-dono-${dateTodayLocal()}.json`,JSON.stringify(backup,null,2),'application/json;charset=utf-8');$('#oeBackupSummary').insertAdjacentHTML('afterbegin','<div class="owner-extra-status success"><strong>✓ Backup exportado</strong><p>O arquivo JSON foi gerado. Guarde-o fora do aparelho antes de apagar os dados do navegador.</p></div>');showToast('Backup da gestão baixado.');});


// Inicialização geral
$('#currentYear').textContent = new Date().getFullYear();
loadDayCount();
renderDaySelect();
refreshBusFields();
updateDieselCalculation();
updateCalculation();
updateDayUI();
initializePhotos();
renderChecklist();
renderOdometer();
renderFuelLogs();
renderIncidents();
renderEndChecklist();

// Dez novas funções operacionais com gravação local e relatórios copiáveis.
const EXPENSE_KEY = 'grupoConect.operatingExpenses.v1';
const TIRE_KEY = 'grupoConect.tireInspections.v1';
const CLEAN_KEY = 'grupoConect.cleaningRecords.v1';
const DOC_KEY = 'grupoConect.documentDeadlines.v1';
const HANDOVER_KEY = 'grupoConect.handoverRecords.v1';
const LOST_KEY = 'grupoConect.lostFoundRecords.v1';
const STOP_KEY = 'grupoConect.stopPlans.v1';
const RECON_KEY = 'grupoConect.fareReconciliations.v1';

function recordItem(title, details, deleteAttribute, id) {
  return `<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(details)}</small></div><button class="record-danger" type="button" ${deleteAttribute}="${escapeHtml(id)}">Excluir</button></div></article>`;
}
function recordsEmpty(message) { return `<p class="empty-state-text">${escapeHtml(message)}</p>`; }
async function copyRecordReport(title, lines, successMessage) {
  const content = [title, ...lines, '', `Gerado pelo Grupo Conect em ${new Date().toLocaleString('pt-BR')}.`].join('\n');
  showToast(await copyText(content) ? successMessage : 'Não foi possível copiar automaticamente.');
}
function setupToday(id) { const el = $('#' + id); if (el) el.value = dateTodayLocal(); }

// 2. Lançamento de despesas adicionais.
function renderOperatingExpenses(){const rows=readArrayKey(EXPENSE_KEY);const total=rows.reduce((s,x)=>s+Number(x.amount||0),0);$('#expenseAllTotal').textContent=money(total);$('#expenseSummary').textContent=`${rows.length} despesa(s) registrada(s) · total acumulado ${money(total)}.`;$('#expenseList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${x.vehicle} · ${money(x.amount)}`,`${localDate(x.date)} · ${x.category}${x.note?' · '+x.note:''}`,'data-expense-delete',x.id)).join(''):recordsEmpty('Nenhuma despesa adicional registrada.');}
setupToday('expenseDate');
$('#operatingExpenseForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#expenseDate').value,vehicle=$('#expenseVehicle').value.trim(),category=$('#expenseCategory').value,amount=readToolValue('expenseAmount'),note=$('#expenseNote').value.trim();if(!date||!vehicle||!category||amount===null||amount<=0){showToast('Informe data, veículo, categoria e valor positivo.');return;}const item={id:makeId(),date,vehicle,category,amount,note,createdAt:new Date().toISOString()};const rows=readArrayKey(EXPENSE_KEY);rows.push(item);if(!writeArrayKey(EXPENSE_KEY,rows))return;$('#expenseSavedValue').textContent=money(amount);$('#expenseResults').hidden=false;$('#operatingExpenseForm').reset();setupToday('expenseDate');renderOperatingExpenses();showToast('Despesa registrada.');});
$('#expenseList').addEventListener('click',event=>{const b=event.target.closest('[data-expense-delete]');if(!b)return;writeArrayKey(EXPENSE_KEY,readArrayKey(EXPENSE_KEY).filter(x=>x.id!==b.dataset.expenseDelete));renderOperatingExpenses();showToast('Despesa excluída.');});
$('#copyExpenseReport').addEventListener('click',()=>{const rows=readArrayKey(EXPENSE_KEY);copyRecordReport('GRUPO CONECT — DESPESAS OPERACIONAIS',[...rows.map(x=>`${localDate(x.date)} | ${x.vehicle} | ${x.category} | ${money(x.amount)}${x.note?' | '+x.note:''}`),`TOTAL: ${money(rows.reduce((s,x)=>s+Number(x.amount||0),0))}`],'Relatório de despesas copiado.');});

// 3. Inspeção comparativa de pneus: a referência é informada pelo usuário da frota.
function renderTireInspections(){const rows=readArrayKey(TIRE_KEY);$('#tireList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${x.vehicle} · ${x.position} · ${x.status}`,`${localDate(x.date)} · medido ${numberPt(x.actual,1)} bar · referência ${numberPt(x.target,1)} bar · diferença ${numberPt(x.delta,1)} bar${x.note?' · '+x.note:''}`,'data-tire-delete',x.id)).join(''):recordsEmpty('Nenhuma inspeção de pneu registrada.');}
setupToday('tireDate');
$('#tireForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#tireDate').value,vehicle=$('#tireVehicle').value.trim(),position=$('#tirePosition').value,actual=readToolValue('tireActual'),target=readToolValue('tireTarget'),tolerance=readToolValue('tireTolerance'),note=$('#tireNote').value.trim();if(!date||!vehicle||!position||actual===null||actual<=0||target===null||target<=0||tolerance===null){showToast('Confira a data, o veículo e os valores de pressão.');return;}const delta=actual-target,status=Math.abs(delta)<=tolerance?'Dentro da tolerância informada':delta<0?'Abaixo da referência':'Acima da referência';const item={id:makeId(),date,vehicle,position,actual,target,tolerance,delta,status,note,createdAt:new Date().toISOString()};const rows=readArrayKey(TIRE_KEY);rows.push(item);if(!writeArrayKey(TIRE_KEY,rows))return;$('#tireDelta').textContent=`${delta>0?'+':''}${numberPt(delta,1)} bar`;$('#tireStatus').textContent=status;$('#tireResults').hidden=false;renderTireInspections();showToast('Inspeção de pneu registrada.');});
$('#tireList').addEventListener('click',event=>{const b=event.target.closest('[data-tire-delete]');if(!b)return;writeArrayKey(TIRE_KEY,readArrayKey(TIRE_KEY).filter(x=>x.id!==b.dataset.tireDelete));renderTireInspections();showToast('Inspeção excluída.');});
$('#copyTireReport').addEventListener('click',()=>copyRecordReport('GRUPO CONECT — INSPEÇÃO DE PNEUS',readArrayKey(TIRE_KEY).map(x=>`${localDate(x.date)} | ${x.vehicle} | ${x.position} | ${numberPt(x.actual,1)} bar (ref. ${numberPt(x.target,1)}) | ${x.status}${x.note?' | '+x.note:''}`),'Relatório de pneus copiado.'));

// 4. Registro de limpeza e conservação.
function renderCleaningRecords(){const rows=readArrayKey(CLEAN_KEY);$('#cleaningList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${x.vehicle} · ${x.doneCount}/4 itens concluídos`,`${localDate(x.date)} · interno ${x.interior?'OK':'pendente'} · externo ${x.exterior?'OK':'pendente'} · vidros ${x.windows?'OK':'pendente'} · resíduos ${x.waste?'OK':'pendente'}${x.note?' · '+x.note:''}`,'data-clean-delete',x.id)).join(''):recordsEmpty('Nenhuma limpeza registrada.');}
setupToday('cleanDate');
$('#cleaningForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#cleanDate').value,vehicle=$('#cleanVehicle').value.trim();if(!date||!vehicle){showToast('Informe a data e o veículo.');return;}const item={id:makeId(),date,vehicle,interior:$('#cleanInterior').checked,exterior:$('#cleanExterior').checked,windows:$('#cleanWindows').checked,waste:$('#cleanWaste').checked,note:$('#cleanNote').value.trim(),createdAt:new Date().toISOString()};item.doneCount=[item.interior,item.exterior,item.windows,item.waste].filter(Boolean).length;const rows=readArrayKey(CLEAN_KEY);rows.push(item);if(!writeArrayKey(CLEAN_KEY,rows))return;renderCleaningRecords();$('#cleaningForm').reset();setupToday('cleanDate');showToast('Registro de limpeza salvo.');});
$('#cleaningList').addEventListener('click',event=>{const b=event.target.closest('[data-clean-delete]');if(!b)return;writeArrayKey(CLEAN_KEY,readArrayKey(CLEAN_KEY).filter(x=>x.id!==b.dataset.cleanDelete));renderCleaningRecords();showToast('Registro de limpeza excluído.');});
$('#copyCleaningReport').addEventListener('click',()=>copyRecordReport('GRUPO CONECT — LIMPEZA DE VEÍCULOS',readArrayKey(CLEAN_KEY).map(x=>`${localDate(x.date)} | ${x.vehicle} | interno ${x.interior?'OK':'pendente'} | externo ${x.exterior?'OK':'pendente'} | vidros ${x.windows?'OK':'pendente'} | resíduos ${x.waste?'OK':'pendente'} | observação: ${x.note||'—'}`),'Relatório de limpeza copiado.'));

// 5. Vencimentos, com alertas calculados contra a data atual.
function documentStatus(due){const today=new Date(`${dateTodayLocal()}T00:00:00`),expiry=new Date(`${due}T00:00:00`),days=Math.round((expiry-today)/86400000);return {days,status:days<0?`Vencido há ${Math.abs(days)} dia(s)`:days===0?'Vence hoje':days<=30?`Vence em ${days} dia(s)`:'Em dia'};}
function renderDocuments(){const rows=readArrayKey(DOC_KEY);const ordered=rows.slice().sort((a,b)=>a.due.localeCompare(b.due));$('#documentList').innerHTML=ordered.length?ordered.map(x=>{const s=documentStatus(x.due);return recordItem(`${x.vehicle} · ${x.type} · ${s.status}`,`Vencimento: ${localDate(x.due)}${x.note?' · '+x.note:''}`,'data-doc-delete',x.id);}).join(''):recordsEmpty('Nenhum documento com prazo cadastrado.');}
$('#documentForm').addEventListener('submit',event=>{event.preventDefault();const vehicle=$('#docVehicle').value.trim(),type=$('#docType').value.trim(),due=$('#docDue').value,note=$('#docNote').value.trim();if(!vehicle||!type||!due){showToast('Informe veículo, documento e vencimento.');return;}const item={id:makeId(),vehicle,type,due,note,createdAt:new Date().toISOString()};const rows=readArrayKey(DOC_KEY);rows.push(item);if(!writeArrayKey(DOC_KEY,rows))return;$('#documentForm').reset();renderDocuments();showToast(`Prazo salvo: ${documentStatus(due).status}.`);});
$('#documentList').addEventListener('click',event=>{const b=event.target.closest('[data-doc-delete]');if(!b)return;writeArrayKey(DOC_KEY,readArrayKey(DOC_KEY).filter(x=>x.id!==b.dataset.docDelete));renderDocuments();showToast('Prazo removido.');});
$('#copyDocumentReport').addEventListener('click',()=>copyRecordReport('GRUPO CONECT — VALIDADE DE DOCUMENTOS',readArrayKey(DOC_KEY).map(x=>`${x.vehicle} | ${x.type} | vence ${localDate(x.due)} | ${documentStatus(x.due).status}${x.note?' | '+x.note:''}`),'Relatório de documentos copiado.'));

// 7. Passagem de turno, registrando leitura de tanque e hodômetro.
function renderHandovers(){const rows=readArrayKey(HANDOVER_KEY);$('#handoverList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${x.vehicle} · ${x.outgoing} → ${x.incoming}`,`${localDate(x.date)} · tanque ${numberPt(x.fuel,1)}% · hodômetro ${numberPt(x.odo,1)} km${x.notes?' · '+x.notes:''}`,'data-handover-delete',x.id)).join(''):recordsEmpty('Nenhuma passagem de turno registrada.');}
setupToday('handoverDate');
$('#handoverForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#handoverDate').value,vehicle=$('#handoverVehicle').value.trim(),outgoing=$('#handoverOutgoing').value.trim(),incoming=$('#handoverIncoming').value.trim(),fuel=readToolValue('handoverFuel'),odo=readToolValue('handoverOdo'),notes=$('#handoverNotes').value.trim();if(!date||!vehicle||!outgoing||!incoming||fuel===null||fuel>100||odo===null){showToast('Confira os campos da passagem de turno e o nível de tanque (0 a 100%).');return;}const item={id:makeId(),date,vehicle,outgoing,incoming,fuel,odo,notes,createdAt:new Date().toISOString()};const rows=readArrayKey(HANDOVER_KEY);rows.push(item);if(!writeArrayKey(HANDOVER_KEY,rows))return;$('#handoverForm').reset();setupToday('handoverDate');renderHandovers();showToast('Passagem de turno registrada.');});
$('#handoverList').addEventListener('click',event=>{const b=event.target.closest('[data-handover-delete]');if(!b)return;writeArrayKey(HANDOVER_KEY,readArrayKey(HANDOVER_KEY).filter(x=>x.id!==b.dataset.handoverDelete));renderHandovers();showToast('Passagem de turno excluída.');});
$('#copyHandoverReport').addEventListener('click',()=>copyRecordReport('GRUPO CONECT — PASSAGEM DE TURNO',readArrayKey(HANDOVER_KEY).map(x=>`${localDate(x.date)} | ${x.vehicle} | entrega: ${x.outgoing} | recebe: ${x.incoming} | tanque ${numberPt(x.fuel,1)}% | hodômetro ${numberPt(x.odo,1)} km | pendências: ${x.notes||'nenhuma anotada'}`),'Relatório de passagem de turno copiado.'));

// 8. Achados e perdidos sem necessidade de armazenar dados pessoais do passageiro.
function renderLostFound(){const rows=readArrayKey(LOST_KEY);$('#lostList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${x.item} · ${x.status}`,`${localDate(x.date)} ${x.time} · ${x.vehicle} · local: ${x.location}${x.note?' · '+x.note:''}`,'data-lost-delete',x.id)).join(''):recordsEmpty('Nenhum item registrado.');}
setupToday('lostDate');
$('#lostFoundForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#lostDate').value,time=$('#lostTime').value,vehicle=$('#lostVehicle').value.trim(),location=$('#lostLocation').value.trim(),itemText=$('#lostItem').value.trim(),status=$('#lostStatus').value,note=$('#lostNote').value.trim();if(!date||!time||!vehicle||!location||!itemText){showToast('Preencha data, horário, veículo, local e descrição do item.');return;}const row={id:makeId(),date,time,vehicle,location,item:itemText,status,note,createdAt:new Date().toISOString()};const rows=readArrayKey(LOST_KEY);rows.push(row);if(!writeArrayKey(LOST_KEY,rows))return;$('#lostFoundForm').reset();setupToday('lostDate');renderLostFound();showToast('Item registrado.');});
$('#lostList').addEventListener('click',event=>{const b=event.target.closest('[data-lost-delete]');if(!b)return;writeArrayKey(LOST_KEY,readArrayKey(LOST_KEY).filter(x=>x.id!==b.dataset.lostDelete));renderLostFound();showToast('Item removido.');});
$('#copyLostReport').addEventListener('click',()=>copyRecordReport('GRUPO CONECT — ACHADOS E PERDIDOS',readArrayKey(LOST_KEY).map(x=>`${localDate(x.date)} ${x.time} | ${x.vehicle} | ${x.item} | local: ${x.location} | situação: ${x.status}${x.note?' | '+x.note:''}`),'Relatório de achados e perdidos copiado.'));

// 9. Planejamento de paradas por linha.
function currentStopRoute(){return $('#stopRoute').value.trim();}
function renderStopPlans(){const rows=readArrayKey(STOP_KEY),route=currentStopRoute(),view=route?rows.filter(x=>x.route.toLowerCase()===route.toLowerCase()):rows;$('#stopList').innerHTML=view.length?view.slice().sort((a,b)=>a.route.localeCompare(b.route)||a.order-b.order).map(x=>recordItem(`${x.route} · ${x.order}. ${x.stop}`,`${x.dwell} min de permanência${x.notes?' · '+x.notes:''}`,'data-stop-delete',x.id)).join(''):recordsEmpty(route?'Nenhuma parada cadastrada para esta linha.':'Informe uma linha para ver seu plano ou adicione a primeira parada.');if(route){$('#stopResults').hidden=false;$('#stopCount').textContent=String(view.length);$('#stopTotalMinutes').textContent=`${view.reduce((s,x)=>s+Number(x.dwell||0),0)} min`;}else{$('#stopResults').hidden=true;}}
$('#stopRoute').addEventListener('input',renderStopPlans);
$('#stopPlannerForm').addEventListener('submit',event=>{event.preventDefault();const route=$('#stopRoute').value.trim(),stop=$('#stopName').value.trim(),dwell=readToolValue('stopDwell'),notes=$('#stopNotes').value.trim();if(!route||!stop||dwell===null||!Number.isInteger(dwell)){showToast('Informe linha, parada e um tempo inteiro em minutos.');return;}const rows=readArrayKey(STOP_KEY),routeRows=rows.filter(x=>x.route.toLowerCase()===route.toLowerCase()),order=routeRows.reduce((m,x)=>Math.max(m,Number(x.order)||0),0)+1;rows.push({id:makeId(),route,stop,dwell,notes,order,createdAt:new Date().toISOString()});if(!writeArrayKey(STOP_KEY,rows))return;$('#stopName').value='';$('#stopNotes').value='';renderStopPlans();showToast('Parada adicionada ao itinerário.');});
$('#stopList').addEventListener('click',event=>{const b=event.target.closest('[data-stop-delete]');if(!b)return;writeArrayKey(STOP_KEY,readArrayKey(STOP_KEY).filter(x=>x.id!==b.dataset.stopDelete));renderStopPlans();showToast('Parada removida.');});
$('#copyStopPlan').addEventListener('click',()=>{const route=currentStopRoute();if(!route){showToast('Informe a linha para copiar o plano.');return;}const rows=readArrayKey(STOP_KEY).filter(x=>x.route.toLowerCase()===route.toLowerCase()).sort((a,b)=>a.order-b.order);if(!rows.length){showToast('Não há paradas cadastradas para esta linha.');return;}copyRecordReport(`GRUPO CONECT — PLANO DE PARADAS: ${route}`,[...rows.map(x=>`${x.order}. ${x.stop} — ${x.dwell} min${x.notes?' | '+x.notes:''}`),`TEMPO TOTAL PARADO: ${rows.reduce((s,x)=>s+Number(x.dwell||0),0)} minutos`],'Plano de paradas copiado.');});
$('#clearStopPlan').addEventListener('click',()=>{const route=currentStopRoute();if(!route){showToast('Informe a linha que deseja limpar.');return;}if(!window.confirm(`Remover todas as paradas cadastradas para “${route}”?`))return;writeArrayKey(STOP_KEY,readArrayKey(STOP_KEY).filter(x=>x.route.toLowerCase()!==route.toLowerCase()));renderStopPlans();showToast('Plano da linha limpo.');});

// 10. Conciliação da arrecadação esperada com os meios de pagamento informados.
function renderReconciliations(){const rows=readArrayKey(RECON_KEY);$('#reconList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${x.route} · diferença ${money(x.difference)}`,`${localDate(x.date)} · esperado ${money(x.expected)} · recebido ${money(x.received)} · ${x.status}`,'data-recon-delete',x.id)).join(''):recordsEmpty('Nenhuma conferência de arrecadação salva.');}
setupToday('reconDate');
$('#fareReconForm').addEventListener('submit',event=>{event.preventDefault();const date=$('#reconDate').value,route=$('#reconRoute').value.trim(),fare=readToolValue('reconFare'),payers=readToolValue('reconPayers'),cash=readToolValue('reconCash'),pix=readToolValue('reconPix'),card=readToolValue('reconCard');if(!date||!route||fare===null||fare<=0||payers===null||!Number.isInteger(payers)||[cash,pix,card].some(x=>x===null)){showToast('Confira tarifa, pagantes e os valores recebidos.');return;}const expected=fare*payers,received=cash+pix+card,difference=received-expected,status=Math.abs(difference)<0.01?'Conferido':difference<0?'Falta valor':'Recebido acima do esperado';const item={id:makeId(),date,route,fare,payers,cash,pix,card,expected,received,difference,status,createdAt:new Date().toISOString()};const rows=readArrayKey(RECON_KEY);rows.push(item);if(!writeArrayKey(RECON_KEY,rows))return;$('#reconExpected').textContent=money(expected);$('#reconReceived').textContent=money(received);$('#reconDifference').textContent=(difference>0?'+':'')+money(difference);$('#reconStatus').textContent=status;$('#reconNote').textContent=difference<0?`Verifique uma diferença de ${money(Math.abs(difference))} abaixo do esperado.`:difference>0?`O total recebido está ${money(difference)} acima do cálculo esperado; confirme se todas as fontes e passagens foram registradas.`:'Os valores informados correspondem à arrecadação esperada.';$('#reconResults').hidden=false;renderReconciliations();showToast('Conferência de arrecadação salva.');});
$('#reconList').addEventListener('click',event=>{const b=event.target.closest('[data-recon-delete]');if(!b)return;writeArrayKey(RECON_KEY,readArrayKey(RECON_KEY).filter(x=>x.id!==b.dataset.reconDelete));renderReconciliations();showToast('Conferência removida.');});
$('#copyReconReport').addEventListener('click',()=>copyRecordReport('GRUPO CONECT — CONFERÊNCIA DE ARRECADAÇÃO',readArrayKey(RECON_KEY).map(x=>`${localDate(x.date)} | ${x.route} | ${x.payers} pagantes × ${money(x.fare)} = ${money(x.expected)} esperado | dinheiro ${money(x.cash)} | Pix ${money(x.pix)} | cartão/outro ${money(x.card)} | recebido ${money(x.received)} | diferença ${money(x.difference)} (${x.status})`),'Relatório de arrecadação copiado.'));

// Os registros das novas ferramentas são incluídos automaticamente no backup JSON
// por utilizarem chaves com o prefixo grupoConect.
renderOperatingExpenses();
renderTireInspections();
renderCleaningRecords();
renderDocuments();
renderHandovers();
renderLostFound();
renderStopPlans();
renderReconciliations();


// Gerador de fichas internas de ônibus: interface liberada apenas quando o usuário escolhe Pablo.
// Aviso: em um site estático público, isso não substitui autenticação real no servidor.
const BUS_DOC_KEY = 'grupoConect.busDocumentRecords.v1';
let currentBusDoc = null;
function busDocField(label, value) { return { label, value: (value === undefined || value === null || String(value).trim() === '') ? 'Não informado' : String(value).trim() }; }
function readBusDocForm() {
  const value = id => ($('#' + id).value || '').trim();
  return {
    id: makeId(), createdAt: new Date().toISOString(), date: value('busDocDate'), responsible: 'Pablo',
    documentType: value('busDocType'), prefix: value('busDocPrefix'), status: value('busDocStatus'),
    bodyBrand: value('busDocBodyBrand'), bodyModel: value('busDocBodyModel'), bodyYear: value('busDocBodyYear'), bodyModelYear: value('busDocBodyModelYear'),
    chassisBrand: value('busDocChassisBrand'), chassisModel: value('busDocChassisModel'), chassisYear: value('busDocChassisYear'), chassisModelYear: value('busDocChassisModelYear'),
    chassisNumber: value('busDocChassisNumber'), plate: value('busDocPlate').toUpperCase(), renavam: value('busDocRenavam'), fuel: value('busDocFuel'),
    tank: value('busDocTank'), seats: value('busDocSeats'), odometer: value('busDocOdometer'), air: value('busDocAir'), accessibility: value('busDocAccessibility'), notes: value('busDocNotes')
  };
}
function validateBusDocForm(d) {
  if (!d.date || !d.prefix || !d.bodyModel || !d.bodyYear || !d.bodyModelYear || !d.chassisBrand || !d.chassisModel || !d.chassisYear || !d.chassisModelYear) return 'Preencha a data, prefixo, modelo e os anos de fabricação/modelo da carroceria e do chassi.';
  const bodyYear=Number(d.bodyYear), bodyModelYear=Number(d.bodyModelYear), chassisYear=Number(d.chassisYear), chassisModelYear=Number(d.chassisModelYear), now=new Date().getFullYear();
  if ([bodyYear,bodyModelYear,chassisYear,chassisModelYear].some(y=>!Number.isInteger(y)||y<1950||y>now+1)) return `Informe anos válidos entre 1950 e ${now+1}.`;
  if (bodyModelYear < bodyYear) return 'O ano-modelo da carroceria não pode ser anterior ao ano de fabricação informado.';
  if (chassisModelYear < chassisYear) return 'O ano-modelo do chassi não pode ser anterior ao ano de fabricação informado.';
  if (d.tank !== '' && (!Number.isFinite(Number(d.tank)) || Number(d.tank)<0 || Number(d.tank)>2000)) return 'Confira a capacidade do tanque.';
  if (d.seats !== '' && (!Number.isInteger(Number(d.seats)) || Number(d.seats)<0 || Number(d.seats)>300)) return 'Confira a capacidade de passageiros.';
  if (d.odometer !== '' && (!Number.isFinite(Number(d.odometer)) || Number(d.odometer)<0)) return 'Confira o valor do hodômetro.';
  return '';
}
function formatBusDocText(d) {
  return [
    'GRUPO CONECT — DOCUMENTO INTERNO DA FROTA',
    d.documentType,
    `Documento gerado em: ${new Date(d.createdAt).toLocaleString('pt-BR')}`,
    `Data de referência: ${localDate(d.date)}`,
    '', 'IDENTIFICAÇÃO DO VEÍCULO',
    `Empresa / prefixo: ${d.prefix}`,
    `Situação operacional: ${d.status}`,
    `Carroceria: ${d.bodyBrand || 'Não informado'} — ${d.bodyModel}`,
    `Ano de fabricação da carroceria: ${d.bodyYear}`,
    `Ano-modelo da carroceria: ${d.bodyModelYear}`,
    '', 'IDENTIFICAÇÃO DO CHASSI',
    `Marca do chassi: ${d.chassisBrand}`,
    `Modelo do chassi: ${d.chassisModel}`,
    `Ano de fabricação do chassi: ${d.chassisYear}`,
    `Ano-modelo do chassi: ${d.chassisModelYear}`,
    `Número do chassi / VIN: ${d.chassisNumber || 'Não informado'}`,
    '', 'DADOS COMPLEMENTARES',
    `Placa: ${d.plate || 'Não informado'}`,
    `RENAVAM: ${d.renavam || 'Não informado'}`,
    `Combustível: ${d.fuel || 'Não informado'}`,
    `Capacidade do tanque: ${d.tank ? `${d.tank} litros` : 'Não informado'}`,
    `Capacidade de passageiros: ${d.seats || 'Não informado'}`,
    `Hodômetro: ${d.odometer ? `${numberPt(Number(d.odometer),1)} km` : 'Não informado'}`,
    `Ar-condicionado: ${d.air || 'Não informado'}`,
    `Acessibilidade: ${d.accessibility || 'Não informado'}`,
    '', 'OBSERVAÇÕES / PENDÊNCIAS', d.notes || 'Nenhuma observação informada.',
    '', 'Responsável pelo preenchimento: Pablo',
    '', 'DOCUMENTO INTERNO: este registro foi montado a partir das informações digitadas e não substitui CRLV, CRV, licenciamento ou documento oficial emitido por autoridade competente.'
  ].join('\n');
}
function busDocDetail(label,value) { return `<div class="bus-doc-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value === undefined || value === null || String(value).trim()==='' ? 'Não informado' : String(value))}</strong></div>`; }
function renderBusDocPreview(d) {
  $('#busDocPreviewHeading').textContent = `${d.documentType} · ${d.prefix}`;
  const vehicle = [busDocDetail('Empresa / prefixo',d.prefix),busDocDetail('Situação operacional',d.status),busDocDetail('Carroceria / modelo',`${d.bodyBrand ? d.bodyBrand+' — ' : ''}${d.bodyModel}`),busDocDetail('Ano fabricação / ano-modelo da carroceria',`${d.bodyYear} / ${d.bodyModelYear}`)].join('');
  const chassis = [busDocDetail('Marca do chassi',d.chassisBrand),busDocDetail('Modelo do chassi',d.chassisModel),busDocDetail('Ano fabricação / ano-modelo do chassi',`${d.chassisYear} / ${d.chassisModelYear}`),busDocDetail('Número do chassi / VIN',d.chassisNumber),busDocDetail('Placa',d.plate),busDocDetail('RENAVAM',d.renavam)].join('');
  const extras = [busDocDetail('Combustível',d.fuel),busDocDetail('Capacidade do tanque',d.tank ? `${d.tank} litros` : ''),busDocDetail('Capacidade de passageiros',d.seats),busDocDetail('Hodômetro',d.odometer ? `${numberPt(Number(d.odometer),1)} km` : ''),busDocDetail('Ar-condicionado',d.air),busDocDetail('Acessibilidade',d.accessibility),busDocDetail('Responsável',d.responsible),busDocDetail('Data de referência',localDate(d.date))].join('');
  $('#busDocPreview').innerHTML = `<div class="doc-print-brand">GRUPO CONECT · DOCUMENTAÇÃO INTERNA</div><h3>${escapeHtml(d.documentType)}</h3><p class="doc-subtitle">Gerado em ${escapeHtml(new Date(d.createdAt).toLocaleString('pt-BR'))}. Revise todos os dados antes de utilizar ou compartilhar.</p><div class="doc-section-title">Identificação do veículo</div><div class="bus-doc-details">${vehicle}</div><div class="doc-section-title">Identificação do chassi</div><div class="bus-doc-details">${chassis}</div><div class="doc-section-title">Dados complementares</div><div class="bus-doc-details">${extras}</div><div class="doc-section-title">Observações / pendências</div><div class="bus-doc-note">${escapeHtml(d.notes || 'Nenhuma observação informada.')}</div><div class="bus-doc-signature"><div>Responsável pelo cadastro<br><strong>Pablo</strong></div><div>Conferência / aprovação</div></div><p class="doc-subtitle" style="margin-top:22px">Documento interno preenchido pelo usuário. Não substitui CRLV, CRV, licenciamento ou documento oficial emitido por órgão competente.</p>`;
  $('#busDocPreviewPanel').hidden = false;
}
function renderBusDocList() {
  const rows=readArrayKey(BUS_DOC_KEY);
  $('#busDocList').innerHTML = rows.length ? rows.slice().reverse().map(d=>`<article class="record-item"><div class="record-item-top"><div><strong class="doc-item-title">${escapeHtml(d.prefix)} · ${escapeHtml(d.bodyModel)}</strong><small>${escapeHtml(d.documentType)} · ${escapeHtml(localDate(d.date))} · chassi ${escapeHtml(d.chassisBrand)} ${escapeHtml(d.chassisModel)} · gerado por ${escapeHtml(d.responsible)}</small><div class="bus-doc-list-actions"><button type="button" data-busdoc-view="${escapeHtml(d.id)}">Abrir ficha</button><button type="button" data-busdoc-download="${escapeHtml(d.id)}">Baixar TXT</button><button type="button" data-busdoc-print="${escapeHtml(d.id)}">Imprimir / PDF</button><button type="button" class="danger" data-busdoc-delete="${escapeHtml(d.id)}">Excluir</button></div></div></div></article>`).join('') : recordsEmpty('Nenhuma ficha interna foi gerada ainda.');
}
function activateBusDocAccess() {
  const user=$('#docAccessUser').value, panel=$('#busDocumentProtected'), message=$('#docAccessMessage');
  const allowed=user==='Pablo';
  panel.hidden=!allowed;
  message.classList.toggle('allowed',allowed); message.classList.toggle('denied',Boolean(user)&&!allowed);
  message.textContent=allowed?'Acesso liberado para Pablo. Preencha os dados do veículo para gerar a ficha.':user?`Acesso não liberado para ${user}. Esta ferramenta está disponível na interface somente para Pablo.`:'Selecione Pablo para abrir o gerador de documentos.';
  if(allowed) renderBusDocList();
}
$('#docAccessUser').addEventListener('change',activateBusDocAccess);
$('#busDocDate').value=dateTodayLocal();
$('#busDocumentForm').addEventListener('submit',event=>{
  event.preventDefault();
  if($('#docAccessUser').value!=='Pablo'){showToast('Acesso não autorizado para esta ferramenta.');activateBusDocAccess();return;}
  const d=readBusDocForm(),error=validateBusDocForm(d);
  if(error){showToast(error);return;}
  d.text=formatBusDocText(d);
  const rows=readArrayKey(BUS_DOC_KEY); rows.push(d);
  if(!writeArrayKey(BUS_DOC_KEY,rows))return;
  currentBusDoc=d; renderBusDocPreview(d); renderBusDocList(); showToast('Ficha interna gerada e salva neste navegador.');
});
function printBusDoc(d) {
  const text=formatBusDocText(d);
  const popup=window.open('','_blank','width=900,height=700');
  if(!popup){showToast('O navegador bloqueou a janela de impressão. Permita pop-ups para imprimir ou salvar em PDF.');return;}
  popup.opener=null;
  const escapedText=escapeHtml(text);
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(d.documentType)} - ${escapeHtml(d.prefix)}</title><style>body{font-family:Arial,sans-serif;color:#182b3c;margin:0;padding:32px;line-height:1.55}header{border-bottom:3px solid #128579;padding-bottom:16px;margin-bottom:22px}h1{font-size:22px;margin:0 0 6px;color:#10243a}small{color:#657987}.doc{white-space:pre-wrap;font-size:12px;overflow-wrap:anywhere}.actions{margin:0 0 20px}button{padding:10px 14px;border:0;border-radius:8px;background:#10243a;color:#fff;font-weight:bold}@media print{body{padding:0}.actions{display:none}}@page{margin:16mm}</style></head><body><header><h1>GRUPO CONECT</h1><small>Documento interno da frota · Não substitui documento oficial do veículo</small></header><div class="actions"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div><div class="doc">${escapedText}</div></body></html>`);
  popup.document.close();
  setTimeout(()=>popup.print(),350);
}
$('#busDocPrint').addEventListener('click',()=>{if(currentBusDoc)printBusDoc(currentBusDoc);else showToast('Gere ou abra uma ficha primeiro.');});
$('#busDocDownload').addEventListener('click',()=>{if(!currentBusDoc){showToast('Gere ou abra uma ficha primeiro.');return;}downloadTextFile(`grupo-conect-ficha-${String(currentBusDoc.prefix).replace(/[^a-z0-9_-]+/gi,'-')}.txt`,formatBusDocText(currentBusDoc));});
$('#busDocCopy').addEventListener('click',async()=>{if(!currentBusDoc){showToast('Gere ou abra uma ficha primeiro.');return;}showToast(await copyText(formatBusDocText(currentBusDoc))?'Documento copiado.':'Não foi possível copiar automaticamente.');});
$('#busDocList').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;const rows=readArrayKey(BUS_DOC_KEY),id=b.dataset.busdocView||b.dataset.busdocDownload||b.dataset.busdocPrint||b.dataset.busdocDelete;const d=rows.find(x=>x.id===id);if(!d)return;
  if(b.hasAttribute('data-busdoc-view')){currentBusDoc=d;renderBusDocPreview(d);$('#busDocPreviewPanel').scrollIntoView({behavior:'smooth',block:'start'});}
  else if(b.hasAttribute('data-busdoc-download'))downloadTextFile(`grupo-conect-ficha-${String(d.prefix).replace(/[^a-z0-9_-]+/gi,'-')}.txt`,formatBusDocText(d));
  else if(b.hasAttribute('data-busdoc-print'))printBusDoc(d);
  else if(b.hasAttribute('data-busdoc-delete')){if(!window.confirm(`Excluir a ficha de ${d.prefix}?`))return;writeArrayKey(BUS_DOC_KEY,rows.filter(x=>x.id!==id));if(currentBusDoc&&currentBusDoc.id===id){currentBusDoc=null;$('#busDocPreviewPanel').hidden=true;}renderBusDocList();showToast('Ficha removida.');}
});
$('#busDocCopyAll').addEventListener('click',async()=>{if($('#docAccessUser').value!=='Pablo'){showToast('Acesso não autorizado.');return;}const rows=readArrayKey(BUS_DOC_KEY);if(!rows.length){showToast('Não há fichas para copiar.');return;}const report=['GRUPO CONECT — FICHAS INTERNAS DOS ÔNIBUS',...rows.map((d,i)=>`\n${i+1}. ${d.prefix} | ${d.bodyBrand||'Carroceria não informada'} ${d.bodyModel} (${d.bodyYear}/${d.bodyModelYear}) | Chassi ${d.chassisBrand} ${d.chassisModel} (${d.chassisYear}/${d.chassisModelYear}) | Placa ${d.plate||'não informada'} | Situação: ${d.status}`)].join('\n');showToast(await copyText(report)?'Lista de fichas copiada.':'Não foi possível copiar automaticamente.');});

// ÁREA DO DONO — escala por dia da semana, operação, mercado, financiamento e caixa.
// Todos os dados são locais ao navegador; este é um simulador de gestão para OMSI 2.


const WEEKDAY_LABELS = {segunda:'Segunda-feira',terca:'Terça-feira',quarta:'Quarta-feira',quinta:'Quinta-feira',sexta:'Sexta-feira',sabado:'Sábado',domingo:'Domingo'};
let ownerScalePreview = null;
let currentFinanceId = null;
let currentIncidentOperationId = null;
let currentVehicleSwapOperationId = null;
let currentProfitOperationId = null;
let currentProfitReportText = '';
let marketPage = 0;
let marketViewRows = [];

function readObjectKey(key) { try { const value=JSON.parse(localStorage.getItem(key)||'{}'); return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch(e) { return {}; } }
function writeObjectKey(key, value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch(e) { showToast('Não foi possível salvar os dados neste navegador.'); return false; } }
function ownerAllowed() { return $('#ownerUserSelect')?.value === 'Pablo'; }
function assertOwner() { if(ownerAllowed()) return true; showToast('Acesso disponível na interface somente para Pablo.'); return false; }
function ownerScales() { return readArrayKey(OWNER_SCALE_KEY); }
function ownerFleet() { return readArrayKey(OWNER_FLEET_KEY); }
function ownerRoutes() {
  let rows=readArrayKey(OWNER_ROUTES_KEY);
  try {
    if(localStorage.getItem(OWNER_ROUTES_MIGRATED_KEY)!=='1') {
      const known=new Set(rows.map(r=>`${norm(r.city)}|${norm(r.line)}`));
      ownerFleet().forEach(v=>{
        if(v.city&&v.line) { const key=`${norm(v.city)}|${norm(v.line)}`; if(!known.has(key)) { rows.push({id:`migrated-${v.id||makeId()}`,city:v.city,line:v.line,serviceType:v.type||'Municipal',createdAt:v.createdAt||new Date().toISOString(),migratedFromLegacyFleet:true});known.add(key); } }
      });
      writeArrayKey(OWNER_ROUTES_KEY,rows);localStorage.setItem(OWNER_ROUTES_MIGRATED_KEY,'1');
    }
  } catch(e) { /* A página pode estar em modo de armazenamento restrito; mantém os registros disponíveis. */ }
  return rows;
}
function ownerContracts() { return readArrayKey(OWNER_CONTRACTS_KEY); }
function ownerOperations() { return readArrayKey(OPERATION_KEY); }
function financedBuses() { return readArrayKey(FINANCED_BUSES_KEY); }
function cashLedger() { return readArrayKey(CASH_LEDGER_KEY); }
function norm(value) { return String(value||'').trim().toLocaleLowerCase('pt-BR'); }
function avg(list, field) { return list.length ? list.reduce((s,x)=>s+Number(x[field]||0),0)/list.length : 0; }
function dateFromISO(value) { if(!value) return null; const d=new Date(`${value}T00:00:00`); return Number.isNaN(d.getTime())?null:d; }
function daysLateFrom(value) { const due=dateFromISO(value); if(!due)return 0; const today=dateFromISO(dateTodayLocal()); return Math.max(0,Math.floor((today-due)/86400000)); }
function addMonthsToISO(iso, months) { const d=dateFromISO(iso); if(!d)return ''; const day=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+months); const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); d.setDate(Math.min(day,last)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function loanMonthlyPayment(principal, count, monthlyRatePercent) { if(!(principal>0)||!(count>0))return 0; const r=Math.max(0,Number(monthlyRatePercent)||0)/100; if(r===0)return principal/count; return principal*r/(1-Math.pow(1+r,-count)); }
function weekdayFromISO(iso) { const d=dateFromISO(iso); if(!d)return ''; return ['domingo','segunda','terca','quarta','quinta','sexta','sabado'][d.getDay()]; }
function moneyStat(label,value,klass='') { return `<div class="tool-result-stat ${klass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`; }

// Gate the owner screen. This is a visual guard only, not real authentication on GitHub Pages.
function activateOwnerArea() {
  const user=$('#ownerUserSelect').value, allowed=user==='Pablo';
  $('#ownerProtected').hidden=!allowed;
  const message=$('#ownerAccessMessage');
  message.classList.toggle('allowed',allowed); message.classList.toggle('denied',Boolean(user)&&!allowed);
  message.textContent=allowed?'Acesso liberado para Pablo. Os módulos estão em modo de simulação local.':user?`Acesso não liberado para ${user}. Selecione Pablo para abrir as ferramentas do proprietário.`:'Selecione Pablo para liberar a Área do Dono.';
  if(allowed){renderOwnerRoutes();renderOwnerFleet();renderOwnerScales();renderOwnerContractHistory();refreshOperationChoices();renderOperations();renderMarket();renderFinanceList();renderCashDashboard();gcZeroKmRenderHistory();}
}
$('#ownerUserSelect').addEventListener('change',activateOwnerArea);
$('#ownerProtected').hidden=true;

// Cadastro independente de rotas e frota: nenhum veículo fica preso a uma linha.
function routeKey(city,line){return `${norm(city)}|${norm(line)}`;}
function findRegisteredRoute(city,line){
  const routes=ownerRoutes();
  return routes.find(r=>norm(r.city)===norm(city)&&norm(r.line)===norm(line)) || null;
}
function displayDateValue(value){
  if(!value)return 'Sem data';const raw=String(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return localDate(raw);
  const d=new Date(raw);return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('pt-BR');
}
function refreshRouteDatalists(){
  const cities=new Set(GC_CITIES), routes=new Set(GC_INTERSTATE_ROUTES);
  ownerRoutes().forEach(r=>{if(r.city)cities.add(r.city);if(r.line)routes.add(r.line);});
  const c=$('#gcCities'),l=$('#gcRoutes');
  if(c)c.innerHTML=Array.from(cities).map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
  if(l)l.innerHTML=Array.from(routes).map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
}
// Mercado 0 km: famílias de carrocerias e chassis referenciadas em catálogos oficiais.
// Preços, opcionais, lotação e prazos são estimativas para a simulação, nunca cotações comerciais.
const ZERO_KM_MODELS = [
 {id:'mp-torino-2027',make:'Marcopolo',model:'Torino 2027',segments:['urbano'],length:12.56,width:2.55,height:3.26,seated:38,standing:42,doors:3,floor:'Entrada baixa (low entry)',base:980000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://onibus.marcopolo.com.br/produtos/urbanos/torino'},
 {id:'mp-torino-low',make:'Marcopolo',model:'Torino Low Entry',segments:['urbano','midibus'],length:12.5,width:2.55,height:3.3,seated:36,standing:44,doors:3,floor:'Entrada baixa (low entry)',base:1050000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://onibus.marcopolo.com.br/produtos/urbanos'},
 {id:'mp-torino-rear',make:'Marcopolo',model:'Torino Motor Traseiro',segments:['urbano'],length:13.2,width:2.55,height:3.3,seated:38,standing:46,doors:3,floor:'Piso baixo integral',base:1180000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://onibus.marcopolo.com.br/produtos/urbanos'},
 {id:'mp-torino-express',make:'Marcopolo',model:'Torino Express Articulado',segments:['articulado','urbano'],length:18.6,width:2.55,height:3.5,seated:46,standing:90,doors:4,floor:'Piso baixo integral',base:1850000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://onibus.marcopolo.com.br/produtos/urbanos'},
 {id:'mp-attivi',make:'Marcopolo',model:'Attivi Integral 100% elétrico',segments:['eletrico','urbano'],length:12.95,width:2.55,height:3.675,seated:32,standing:50,doors:3,floor:'Piso baixo integral',base:2850000,brands:['Volare (integral)'],electric:true,url:'https://onibus.marcopolo.com.br/produtos/urbanos/attivi'},
 {id:'mp-attivi-express',make:'Marcopolo',model:'Attivi Express Articulado elétrico',segments:['eletrico','articulado','urbano'],length:22,width:2.6,height:3.73,seated:48,standing:100,doors:4,floor:'Piso baixo integral',base:4400000,brands:['Volare (integral)'],electric:true,url:'https://onibus.marcopolo.com.br/produtos/urbanos/attivi-express'},
 {id:'mp-senior-urbano',make:'Marcopolo',model:'Senior Urbano',segments:['micro','midibus','urbano'],length:9.2,width:2.4,height:3.05,seated:28,standing:15,doors:2,floor:'Piso alto',base:590000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Volare (integral)'],url:'https://onibus.marcopolo.com.br/produtos/urbanos'},
 {id:'mp-senior-fret',make:'Marcopolo',model:'Senior Fretamento',segments:['micro','fretamento','escolar'],length:9.2,width:2.4,height:3.15,seated:31,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:630000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Volare (integral)'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'mp-ideale800',make:'Marcopolo',model:'Ideale 800',segments:['intermunicipal','fretamento'],length:12.5,width:2.55,height:3.45,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1180000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'mp-audace',make:'Marcopolo',model:'Audace',segments:['intermunicipal','fretamento','rodoviario'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1550000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'mp-viaggio800',make:'Marcopolo',model:'Viaggio 800',segments:['intermunicipal','fretamento','rodoviario'],length:12.5,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1370000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'mp-viaggio900',make:'Marcopolo',model:'Viaggio G8 900',segments:['intermunicipal','fretamento','rodoviario'],length:12.5,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1490000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'mp-viaggio1050',make:'Marcopolo',model:'Viaggio G8 1050',segments:['intermunicipal','fretamento','rodoviario'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1690000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'mp-paradiso1050',make:'Marcopolo',model:'Paradiso G8 1050',segments:['rodoviario','fretamento'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1850000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos/paradiso-g8'},
 {id:'mp-paradiso1200',make:'Marcopolo',model:'Paradiso G8 1200',segments:['rodoviario','fretamento'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:2150000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos/paradiso-g8'},
 {id:'mp-paradiso1350',make:'Marcopolo',model:'Paradiso G8 1350',segments:['rodoviario','fretamento'],length:14,width:2.6,height:3.75,seated:50,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:2480000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos/paradiso-g8'},
 {id:'mp-paradiso1600',make:'Marcopolo',model:'Paradiso G8 1600 LD',segments:['rodoviario'],length:14,width:2.6,height:3.9,seated:52,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:3150000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos/paradiso-g8'},
 {id:'mp-paradiso1800',make:'Marcopolo',model:'Paradiso G8 1800 DD',segments:['rodoviario'],length:14,width:2.6,height:4.1,seated:60,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:3850000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos/paradiso-g8'},
 {id:'mp-paradiso-tec',make:'Marcopolo',model:'Paradiso G8 TEC 1800 DD',segments:['rodoviario'],length:14,width:2.6,height:4.1,seated:60,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:4100000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://onibus.marcopolo.com.br/produtos'},
 {id:'caio-apachev',make:'Caio',model:'Apache VIP V',segments:['urbano','midibus','intermunicipal'],length:12.5,width:2.55,height:3.35,seated:38,standing:42,doors:3,floor:'Piso alto',base:970000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://caio.com.br/'},
 {id:'caio-millv',make:'Caio',model:'Millennium V',segments:['urbano'],length:13.2,width:2.55,height:3.5,seated:36,standing:48,doors:3,floor:'Piso baixo integral',base:1240000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://caio.com.br/produto/millennium-10.html'},
 {id:'caio-emillennium',make:'Caio',model:'eMillennium elétrico',segments:['eletrico','urbano'],length:12.5,width:2.55,height:3.5,seated:32,standing:50,doors:3,floor:'Piso baixo integral',base:2850000,brands:['BYD','Volare (integral)'],electric:true,url:'https://caio.com.br/'},
 {id:'caio-mill-art',make:'Caio',model:'Millennium V Articulado',segments:['articulado','urbano'],length:18.6,width:2.55,height:3.5,seated:46,standing:88,doors:4,floor:'Piso baixo integral',base:1940000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://caio.com.br/'},
 {id:'caio-brt-super',make:'Caio',model:'Millennium BRT Superarticulado',segments:['articulado','urbano'],length:23,width:2.55,height:3.5,seated:54,standing:110,doors:5,floor:'Piso baixo integral',base:2650000,brands:['Mercedes-Benz','Scania'],url:'https://caio.com.br/'},
 {id:'caio-f2400',make:'Caio',model:'F2400',segments:['micro','escolar','fretamento'],length:7.8,width:2.2,height:2.9,seated:24,standing:0,doors:1,floor:'Piso alto',base:480000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://caio.com.br/'},
 {id:'caio-f2500',make:'Caio',model:'F2500 Midi',segments:['micro','midibus','escolar','fretamento'],length:9,width:2.4,height:3.05,seated:29,standing:8,doors:2,floor:'Piso alto',base:610000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://caio.com.br/'},
 {id:'masc-granvia',make:'Mascarello',model:'New Gran Via Urbano',segments:['urbano','midibus'],length:12.5,width:2.55,height:3.35,seated:38,standing:42,doors:3,floor:'Piso alto',base:930000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://mascarello.com.br/documentos/'},
 {id:'masc-granmidi',make:'Mascarello',model:'Gran Midi',segments:['midibus','urbano','escolar'],length:10.5,width:2.45,height:3.2,seated:32,standing:18,doors:2,floor:'Piso alto',base:720000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://mascarello.com.br/documentos/'},
 {id:'masc-granmicro3',make:'Mascarello',model:'Gran Micro S3',segments:['micro','escolar','fretamento'],length:8.5,width:2.35,height:3.05,seated:27,standing:8,doors:1,floor:'Piso alto',base:545000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://mascarello.com.br/documentos/'},
 {id:'masc-micros2',make:'Mascarello',model:'Micro S2 Onurea',segments:['micro','escolar'],length:7.8,width:2.2,height:2.9,seated:24,standing:0,doors:1,floor:'Piso alto',base:465000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://mascarello.com.br/documentos/'},
 {id:'masc-newroma4',make:'Mascarello',model:'New Roma NR4',segments:['intermunicipal','fretamento','escolar'],length:10.5,width:2.45,height:3.25,seated:36,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:790000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://mascarello.com.br/documentos/'},
 {id:'masc-newroma6',make:'Mascarello',model:'New Roma NR6',segments:['intermunicipal','fretamento','rodoviario'],length:12.5,width:2.55,height:3.45,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1190000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://mascarello.com.br/documentos/'},
 {id:'comil-svelto',make:'Comil',model:'Svelto Urbano',segments:['urbano'],length:12.5,width:2.55,height:3.35,seated:38,standing:42,doors:3,floor:'Piso alto',base:950000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-svelto-midi',make:'Comil',model:'Svelto Midi',segments:['midibus','urbano'],length:10.5,width:2.45,height:3.2,seated:32,standing:18,doors:2,floor:'Piso alto',base:735000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-camp325',make:'Comil',model:'Campione 3.25 Fretamento',segments:['fretamento','intermunicipal'],length:10.5,width:2.6,height:3.45,seated:39,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:980000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-camp345',make:'Comil',model:'Campione 3.45 Fretamento',segments:['fretamento','intermunicipal'],length:12.5,width:2.6,height:3.55,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1260000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-versatile',make:'Comil',model:'Versatile V4',segments:['fretamento','intermunicipal','escolar'],length:12.5,width:2.6,height:3.45,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1190000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-micro-pia',make:'Comil',model:'Micro Piá Rodoviário',segments:['micro','fretamento','escolar'],length:8.5,width:2.35,height:3.05,seated:28,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:570000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-invictus1050',make:'Comil',model:'Campione Invictus 1050',segments:['rodoviario','fretamento'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1680000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-invictus1200',make:'Comil',model:'Campione Invictus 1200',segments:['rodoviario'],length:13.2,width:2.6,height:3.75,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1990000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-invictushd',make:'Comil',model:'Campione Invictus HD',segments:['rodoviario'],length:14,width:2.6,height:3.95,seated:50,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:2580000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'comil-invictusdd',make:'Comil',model:'Campione Invictus DD',segments:['rodoviario'],length:14,width:2.6,height:4.1,seated:60,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:3400000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://www2.comilonibus.com.br/produtos'},
 {id:'busscar-el320',make:'Busscar',model:'El Buss 320',segments:['intermunicipal','fretamento','escolar'],length:10.5,width:2.6,height:3.45,seated:38,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:970000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-el340',make:'Busscar',model:'El Buss 340',segments:['intermunicipal','fretamento','rodoviario'],length:12.5,width:2.6,height:3.55,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1280000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-vissta340',make:'Busscar',model:'Vissta Buss 340 NB1',segments:['intermunicipal','fretamento','rodoviario'],length:12.5,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1470000,brands:['Mercedes-Benz','Volkswagen Caminhões e Ônibus','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-vissta345',make:'Busscar',model:'Vissta Buss 345 NB1',segments:['intermunicipal','rodoviario'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1650000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-vissta360',make:'Busscar',model:'Vissta Buss 360',segments:['rodoviario'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1740000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-vissta365',make:'Busscar',model:'Vissta Buss 365 NB1',segments:['rodoviario'],length:13.2,width:2.6,height:3.65,seated:46,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:1890000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-vissta400',make:'Busscar',model:'Vissta Buss 400',segments:['rodoviario'],length:14,width:2.6,height:3.85,seated:50,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:2520000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-visstadd',make:'Busscar',model:'Vissta Buss DD',segments:['rodoviario'],length:14,width:2.6,height:4.1,seated:60,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:3450000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'busscar-panoramico',make:'Busscar',model:'Panorâmico DD NB1',segments:['rodoviario'],length:14,width:2.6,height:4.1,seated:60,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:3650000,brands:['Mercedes-Benz','Scania','Volvo'],url:'https://busscar.com.br/produtos/'},
 {id:'volare-attack8',make:'Volare',model:'Attack 8',segments:['micro','escolar','fretamento'],length:7.7,width:2.2,height:2.9,seated:24,standing:0,doors:1,floor:'Piso alto',base:460000,brands:['Volare (integral)'],url:'https://www.volare.com.br/'},
 {id:'volare-attack9',make:'Volare',model:'Attack 9',segments:['micro','escolar','fretamento'],length:8.5,width:2.35,height:3.05,seated:29,standing:0,doors:1,floor:'Piso alto',base:535000,brands:['Volare (integral)'],url:'https://www.volare.com.br/'},
 {id:'volare-attack10',make:'Volare',model:'Attack 10',segments:['micro','escolar','fretamento'],length:9.1,width:2.4,height:3.1,seated:32,standing:0,doors:1,floor:'Piso alto',base:610000,brands:['Volare (integral)'],url:'https://www.volare.com.br/'},
 {id:'volare-fly10',make:'Volare',model:'Fly 10',segments:['micro','intermunicipal','fretamento'],length:9.2,width:2.4,height:3.15,seated:32,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:660000,brands:['Volare (integral)'],url:'https://www.volare.com.br/'},
 {id:'volare-fly12',make:'Volare',model:'Fly 12',segments:['intermunicipal','fretamento','rodoviario'],length:10.5,width:2.45,height:3.25,seated:36,standing:0,doors:1,floor:'Rodoviário com salão elevado',base:790000,brands:['Volare (integral)'],url:'https://www.volare.com.br/'},
 {id:'volare-w9',make:'Volare',model:'W9',segments:['micro','escolar','fretamento'],length:8.5,width:2.35,height:3.05,seated:28,standing:0,doors:1,floor:'Piso alto',base:520000,brands:['Volare (integral)'],url:'https://www.volare.com.br/'}
];
const ZERO_KM_CHASSIS = [
 {brand:'Mercedes-Benz',model:'LO 916',engine:'OM 924 LA · 163 cv · diesel P-8',segments:['micro','escolar','fretamento'],axles:'4x2',baseAdd:0},
 {brand:'Mercedes-Benz',model:'LO 1116',engine:'OM 924 LA · 163 cv · diesel P-8',segments:['micro','escolar','fretamento'],axles:'4x2',baseAdd:25000},
 {brand:'Mercedes-Benz',model:'OF 1519 R',engine:'OM 924 LA · 185 cv · 700 Nm · diesel P-8',segments:['micro','midibus','urbano','escolar','fretamento','intermunicipal'],axles:'4x2',baseAdd:80000},
 {brand:'Mercedes-Benz',model:'OF 1721',engine:'OM 924 LA · 208 cv · 780 Nm · diesel P-8',segments:['midibus','urbano','escolar','fretamento','intermunicipal'],axles:'4x2',baseAdd:110000},
 {brand:'Mercedes-Benz',model:'OF 1721L',engine:'OM 924 LA · 208 cv · 780 Nm · diesel P-8',segments:['urbano','intermunicipal','fretamento'],axles:'4x2',baseAdd:125000},
 {brand:'Mercedes-Benz',model:'OF 1726',engine:'OM 926 LA · 260 cv · 980 Nm · diesel P-8',segments:['urbano','intermunicipal','fretamento'],axles:'4x2',baseAdd:160000},
 {brand:'Mercedes-Benz',model:'OF 1726L',engine:'OM 926 LA · 260 cv · 980 Nm · diesel P-8',segments:['urbano','intermunicipal','fretamento'],axles:'4x2',baseAdd:175000},
 {brand:'Mercedes-Benz',model:'O 500 U',engine:'OM 926 LA · 286 cv · 1.100 Nm · diesel P-8',segments:['urbano'],axles:'4x2',baseAdd:220000},
 {brand:'Mercedes-Benz',model:'O 500 M',engine:'OM 926 LA · 286 cv · 1.100 Nm · diesel P-8',segments:['urbano'],axles:'4x2',baseAdd:255000},
 {brand:'Mercedes-Benz',model:'O 500 UA articulado',engine:'OM 460 LA · 381 cv · diesel P-8',segments:['urbano','articulado'],axles:'6x2',baseAdd:400000},
 {brand:'Mercedes-Benz',model:'O 500 R',engine:'OM 926 LA · 310 cv · 1.250 Nm · diesel P-8',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:240000},
 {brand:'Mercedes-Benz',model:'O 500 RS',engine:'OM 460 LA · 381 cv · 1.900 Nm · diesel P-8',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:340000},
 {brand:'Mercedes-Benz',model:'O 500 RSD 2438/2445',engine:'OM 460 LA · 381–449 cv · diesel P-8',segments:['rodoviario'],axles:'6x2',baseAdd:520000},
 {brand:'Mercedes-Benz',model:'O 500 RSDD',engine:'OM 460 LA · 449 cv · diesel P-8',segments:['rodoviario'],axles:'8x2',baseAdd:680000},
 {brand:'Mercedes-Benz',model:'eO500U',engine:'Propulsão elétrica a bateria · especificação conforme proposta',segments:['eletrico','urbano'],axles:'4x2',electric:true,baseAdd:900000},
 {brand:'Mercedes-Benz',model:'eO500UA articulado',engine:'Propulsão elétrica a bateria · especificação conforme proposta',segments:['eletrico','articulado','urbano'],axles:'6x2',electric:true,baseAdd:1500000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 8.180 E ORE 1',engine:'Diesel P-8 · configuração escolar',segments:['micro','escolar'],axles:'4x2',baseAdd:0},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 9.180 / S',engine:'Cummins ISF 3.8 · 175 cv · diesel P-8',segments:['micro','urbano','escolar','fretamento'],axles:'4x2',baseAdd:0},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 11.180 / S',engine:'Cummins ISF 3.8 · 175 cv · diesel P-8',segments:['micro','midibus','urbano','escolar','fretamento'],axles:'4x2',baseAdd:30000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 11.180 R',engine:'Diesel P-8 · suspensão rural reforçada',segments:['escolar','fretamento','micro'],axles:'4x2',baseAdd:35000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 15.210 / S',engine:'D08 · 205 cv · diesel P-8',segments:['midibus','urbano','escolar','fretamento','intermunicipal'],axles:'4x2',baseAdd:85000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 17.230 / S',engine:'D08 · 225 cv · diesel P-8',segments:['urbano','intermunicipal','fretamento'],axles:'4x2',baseAdd:120000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 17.260 / S',engine:'D08 · 260 cv · diesel P-8',segments:['urbano','intermunicipal','fretamento'],axles:'4x2',baseAdd:160000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 18.320 SL',engine:'Diesel P-8 · piso baixo',segments:['urbano','articulado'],axles:'4x2',baseAdd:250000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 18.320 SH',engine:'Diesel P-8 · fretamento / rodoviário',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:260000},
 {brand:'Volkswagen Caminhões e Ônibus',model:'Volksbus 22.260 S 6x2i',engine:'Diesel P-8 · configuração 6x2i',segments:['urbano','articulado'],axles:'6x2',baseAdd:300000},
 {brand:'Scania',model:'K 230 4x2',engine:'Diesel P-8 · 230 cv',segments:['urbano'],axles:'4x2',baseAdd:150000},
 {brand:'Scania',model:'K 280 4x2',engine:'Diesel P-8 · 280 cv',segments:['urbano'],axles:'4x2',baseAdd:220000},
 {brand:'Scania',model:'K 320 4x2',engine:'Diesel P-8 · 320 cv',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:250000},
 {brand:'Scania',model:'K 370 4x2',engine:'Diesel P-8 · 370 cv',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:330000},
 {brand:'Scania',model:'K 410 6x2',engine:'Diesel P-8 · 410 cv',segments:['rodoviario'],axles:'6x2',baseAdd:490000},
 {brand:'Scania',model:'K 450 6x2',engine:'Diesel P-8 · 450 cv',segments:['rodoviario'],axles:'6x2',baseAdd:560000},
 {brand:'Scania',model:'K 500 6x2',engine:'Diesel P-8 · 500 cv',segments:['rodoviario'],axles:'6x2',baseAdd:650000},
 {brand:'Scania',model:'Super K 350 4x2',engine:'Scania Super · 350 cv · diesel',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:340000},
 {brand:'Scania',model:'Super K 390 4x2',engine:'Scania Super · 390 cv · diesel',segments:['rodoviario'],axles:'4x2',baseAdd:410000},
 {brand:'Scania',model:'Super K 430 4x2',engine:'Scania Super · 430 cv · diesel',segments:['rodoviario'],axles:'4x2',baseAdd:480000},
 {brand:'Scania',model:'Super K 460 6x2',engine:'Scania Super · 460 cv · diesel',segments:['rodoviario'],axles:'6x2',baseAdd:600000},
 {brand:'Scania',model:'Super K 500 6x2',engine:'Scania Super · 500 cv · diesel',segments:['rodoviario'],axles:'6x2',baseAdd:690000},
 {brand:'Volvo',model:'B 320R 4x2',engine:'Diesel P-8 · 320 cv',segments:['fretamento','intermunicipal','rodoviario'],axles:'4x2',baseAdd:240000},
 {brand:'Volvo',model:'B 360R 4x2',engine:'Diesel P-8 · 360 cv',segments:['rodoviario'],axles:'4x2',baseAdd:300000},
 {brand:'Volvo',model:'B 380R 4x2',engine:'Diesel P-8 · 380 cv',segments:['rodoviario'],axles:'4x2',baseAdd:360000},
 {brand:'Volvo',model:'B 420R 4x2',engine:'Diesel P-8 · 420 cv',segments:['rodoviario'],axles:'4x2',baseAdd:430000},
 {brand:'Volvo',model:'B 380R 6x2',engine:'Diesel P-8 · 380 cv',segments:['rodoviario'],axles:'6x2',baseAdd:460000},
 {brand:'Volvo',model:'B 420R 6x2',engine:'Diesel P-8 · 420 cv',segments:['rodoviario'],axles:'6x2',baseAdd:520000},
 {brand:'Volvo',model:'B 460R 6x2',engine:'Diesel P-8 · 460 cv',segments:['rodoviario'],axles:'6x2',baseAdd:610000},
 {brand:'Volvo',model:'B 510R 6x2',engine:'Diesel P-8 · 510 cv',segments:['rodoviario'],axles:'6x2',baseAdd:720000},
 {brand:'BYD',model:'D9W ePadron elétrico',engine:'Tração elétrica a bateria · ficha do importador a confirmar',segments:['eletrico','urbano'],axles:'6x2',electric:true,baseAdd:880000},
 {brand:'Volare (integral)',model:'Conjunto integral Volare',engine:'Motorização e plataforma integradas pela Volare',segments:['micro','escolar','fretamento','intermunicipal'],axles:'4x2',baseAdd:0}
];
function gcZeroKmSelectedModel(){return ZERO_KM_MODELS.find(x=>x.id===$('#zeroKmModel')?.value)||null;}
function gcZeroKmAllowedModels(){const make=$('#zeroKmBodyBuilder')?.value,segment=$('#zeroKmSegment')?.value;return ZERO_KM_MODELS.filter(x=>(!make||x.make===make)&&(!segment||x.segments.includes(segment)||segment==='eletrico'&&x.electric));}
function gcZeroKmRefreshModels(preferred=''){
  const select=$('#zeroKmModel');if(!select)return;const rows=gcZeroKmAllowedModels();select.innerHTML='<option value="">Selecione um modelo</option>'+rows.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.model)} · ${escapeHtml(x.segments.join('/'))}</option>`).join('');select.disabled=!rows.length;select.value=rows.some(x=>x.id===preferred)?preferred:(rows[0]?.id||'');gcZeroKmApplyModelDefaults();
}
function gcZeroKmAvailableChassis(model,brand){if(!model)return[];return ZERO_KM_CHASSIS.filter(x=>(model.brands||[]).includes(x.brand)&&(!brand||x.brand===brand)&&(x.segments.includes($('#zeroKmSegment').value)||x.electric&&$('#zeroKmSegment').value==='eletrico'));}
function gcZeroKmRefreshChassis(preferredBrand='',preferredModel=''){
  const model=gcZeroKmSelectedModel(),brandSelect=$('#zeroKmChassisBrand'),modelSelect=$('#zeroKmChassisModel');if(!model||!brandSelect||!modelSelect)return;
  const brands=model.brands||[];brandSelect.innerHTML='<option value="">Selecione fabricante do chassi</option>'+brands.map(x=>`<option>${escapeHtml(x)}</option>`).join('');brandSelect.value=brands.includes(preferredBrand)?preferredBrand:(brands[0]||'');
  const rows=gcZeroKmAvailableChassis(model,brandSelect.value);modelSelect.innerHTML='<option value="">Selecione o chassi</option>'+rows.map(x=>`<option value="${escapeHtml(x.model)}">${escapeHtml(x.model)} · ${escapeHtml(x.engine)}</option>`).join('');modelSelect.disabled=!rows.length;modelSelect.value=rows.some(x=>x.model===preferredModel)?preferredModel:(rows[0]?.model||'');gcZeroKmApplyChassisDefaults();
}
function gcZeroKmApplyModelDefaults(){const model=gcZeroKmSelectedModel();if(!model)return;
  $('#zeroKmLength').value=model.length;$('#zeroKmWidth').value=model.width;$('#zeroKmHeight').value=model.height;$('#zeroKmSeated').value=model.seated;$('#zeroKmStanding').value=model.standing;$('#zeroKmDoors').value=String(model.doors);$('#zeroKmFloor').value=model.floor;
  if(model.electric){$('#zeroKmEmission').value='Elétrico a bateria (BEV)';$('#zeroKmEnginePosition').value='Elétrico / integrado';$('#zeroKmTransmission').value='Elétrica / redução integrada';$('#zeroKmAir').value='Ar-condicionado padrão';}
  else{if($('#zeroKmEmission').value==='Elétrico a bateria (BEV)')$('#zeroKmEmission').value='Diesel Proconve P-8 / Euro VI';if($('#zeroKmEnginePosition').value==='Elétrico / integrado')$('#zeroKmEnginePosition').value='Traseiro';if($('#zeroKmTransmission').value==='Elétrica / redução integrada')$('#zeroKmTransmission').value='Manual';}
  gcZeroKmRefreshChassis();gcZeroKmUpdateCapacity();gcZeroKmInvalidateQuote();
}
function gcZeroKmApplyChassisDefaults(){const model=gcZeroKmSelectedModel(),chassis=gcZeroKmAvailableChassis(model,$('#zeroKmChassisBrand').value).find(x=>x.model===$('#zeroKmChassisModel').value);if(!chassis)return;$('#zeroKmEngine').value=chassis.engine;$('#zeroKmAxles').value=chassis.axles.includes('6x2')?'6x2 · 3 eixos':chassis.axles==='8x2'?'8x2 · 4 eixos':'4x2 · 2 eixos';$('#zeroKmEmission').value=chassis.electric?'Elétrico a bateria (BEV)':'Diesel Proconve P-8 / Euro VI';$('#zeroKmEnginePosition').value=chassis.electric?'Elétrico / integrado':(['O 500 U','O 500 M','O 500 UA articulado','18.320 SL'].some(x=>chassis.model.includes(x))?'Traseiro':'Dianteiro');if(chassis.electric)$('#zeroKmTransmission').value='Elétrica / redução integrada';gcZeroKmInvalidateQuote();}
function gcZeroKmUpdateCapacity(){const seats=Number($('#zeroKmSeated').value)||0,standing=Number($('#zeroKmStanding').value)||0;$('#zeroKmCapacityNote').textContent=`Lotação estimada: ${seats+standing} passageiros (${seats} sentados + ${standing} em pé). Confirme os limites homologados e a distribuição de peso na proposta oficial.`;}
function gcZeroKmInvalidateQuote(){gcZeroKmCurrentQuote=null;if($('#zeroKmSaveQuote'))$('#zeroKmSaveQuote').disabled=true;if($('#zeroKmAcquire'))$('#zeroKmAcquire').disabled=true;}
function gcZeroKmReadConfig(){const model=gcZeroKmSelectedModel(),chassis=gcZeroKmAvailableChassis(model,$('#zeroKmChassisBrand').value).find(x=>x.model===$('#zeroKmChassisModel').value);if(!model||!chassis)return null;const number=id=>Number($('#'+id).value);return {id:makeId(),company:$('#zeroKmCompany').value,prefix:$('#zeroKmPrefix').value.trim(),quantity:Math.max(1,Math.min(100,Math.floor(number('zeroKmQuantity')))),year:$('#zeroKmYear').value,deliveryMonths:number('zeroKmDelivery'),region:$('#zeroKmQuoteRegion').value,segment:$('#zeroKmSegment').value,make:model.make,model:model.model,modelId:model.id,chassisBrand:chassis.brand,chassisModel:chassis.model,engine:$('#zeroKmEngine').value.trim()||chassis.engine,emission:$('#zeroKmEmission').value,enginePosition:$('#zeroKmEnginePosition').value,length:number('zeroKmLength'),width:number('zeroKmWidth'),height:number('zeroKmHeight'),seated:number('zeroKmSeated'),standing:number('zeroKmStanding'),doors:$('#zeroKmDoors').value,floor:$('#zeroKmFloor').value,axles:$('#zeroKmAxles').value,suspension:$('#zeroKmSuspension').value,transmission:$('#zeroKmTransmission').value,air:$('#zeroKmAir').value,seatsType:$('#zeroKmSeatsType').value,accessibility:$('#zeroKmAccessibility').value,usb:$('#zeroKmUSB').value,wifi:$('#zeroKmWifi').value,cameras:$('#zeroKmCameras').value,led:$('#zeroKmLED').value,gps:$('#zeroKmGPS').value,validator:$('#zeroKmValidator').value,paint:$('#zeroKmPaint').value,interior:$('#zeroKmInterior').value,warrantyMonths:number('zeroKmWarranty'),maintenance:$('#zeroKmMaintenance').value,payment:$('#zeroKmPayment').value,downPct:number('zeroKmDownPct'),months:number('zeroKmMonths'),rate:number('zeroKmRate'),basePrice:model.base,chassisAddon:chassis.baseAdd||0,source:model.url};}
function gcZeroKmCalculatePrice(c){let price=c.basePrice+(c.chassisAddon||0);if(/Ar-condicionado padrão/.test(c.air))price+=35000;else if(/alta capacidade/.test(c.air))price+=60000;else if(/zonal|executivo/.test(c.air))price+=85000;if(c.transmission==='Automática')price+=30000;if(c.transmission.includes('retarder'))price+=65000;if(c.suspension.includes('integral'))price+=60000;else if(c.suspension.includes('traseiro'))price+=25000;if(c.accessibility==='Plataforma elevatória')price+=28000;else if(c.accessibility==='Rampa de acesso')price+=12000;else if(c.accessibility.includes('Piso baixo'))price+=35000;if(c.usb==='USB por fileira')price+=9000;else if(c.usb.includes('individual'))price+=22000;if(c.wifi.includes('instalados'))price+=9500;if(c.cameras.includes('4 câmeras'))price+=12500;else if(c.cameras.includes('6 câmeras'))price+=18000;else if(c.cameras.includes('8 câmeras'))price+=26000;if(c.led.includes('Frontal +'))price+=12500;else if(c.led.includes('Destino frontal'))price+=17500;if(c.gps.includes('Preparação'))price+=3500;else if(c.gps.includes('Telemetria'))price+=12500;if(c.validator.includes('Prodata'))price+=15000;else if(c.validator.includes('Digicon'))price+=12500;else if(c.validator.includes('Tacom'))price+=11000;else if(c.validator.includes('Conjunto'))price+=14000;if(c.seatsType==='Executiva / turismo')price+=22000;else if(c.seatsType==='Semileito')price+=65000;else if(c.seatsType==='Leito')price+=130000;else if(c.seatsType.includes('Leito-cama'))price+=210000;if(c.paint.includes('personalizada'))price+=18000;else if(c.paint.includes('Verde')||c.paint.includes('Azul'))price+=6500;if(c.interior==='Turismo premium')price+=28000;else if(c.interior==='Executivo')price+=18000;if(c.warrantyMonths>=36)price+=35000;if(c.maintenance.includes('Preventiva básica'))price+=18000;else if(c.maintenance.includes('Preventiva completa'))price+=42000;else if(c.maintenance.includes('estendido'))price+=70000;price*=1+Math.max(0,c.deliveryMonths<=3?0.035:0);return Math.round(price/100)*100;}
function gcZeroKmCurrentQuoteText(q){const c=q.config;return `GRUPO CONECT — COTAÇÃO SIMULADA DE ÔNIBUS 0 KM\nCotação: ${q.id}\nData: ${new Date(q.createdAt).toLocaleString('pt-BR')}\nComprador: ${c.company}\nUnidades: ${c.quantity} · Prefixo inicial: ${c.prefix}\nAno/modelo: ${c.year} · Entrega em ${c.deliveryMonths} meses (estimativa) · Destino: ${c.region}\nCarroceria: ${c.make} ${c.model}\nAplicação: ${c.segment}\nChassi: ${c.chassisBrand} ${c.chassisModel}\nMotor: ${c.engine}\nPropulsão: ${c.emission} · motor ${c.enginePosition}\nDimensões C×L×A: ${c.length} × ${c.width} × ${c.height} m\nLotação estimada: ${c.seated} sentados + ${c.standing} em pé = ${c.seated+c.standing}\nPortas: ${c.doors} · piso: ${c.floor} · eixos: ${c.axles} · suspensão: ${c.suspension}\nTransmissão: ${c.transmission} · ar: ${c.air} · poltronas: ${c.seatsType}\nAcessibilidade: ${c.accessibility}\nUSB: ${c.usb} · Wi-Fi: ${c.wifi} · câmeras: ${c.cameras} · letreiros: ${c.led}\nGPS/telemetria: ${c.gps} · validador: ${c.validator}\nPintura: ${c.paint} · interior: ${c.interior}\nGarantia desejada: ${c.warrantyMonths} meses · manutenção: ${c.maintenance}\nPreço unitário estimado: ${money(q.unitPrice)}\nQuantidade: ${c.quantity} · Total estimado: ${money(q.totalPrice)}\nForma: ${c.payment==='cash'?'À vista (simulação)':c.payment==='finance'?'Financiamento simulado':'Somente cotação'}${c.payment==='finance'?`\nEntrada estimada: ${money(q.downTotal)} · ${c.months} parcelas estimadas de ${money(q.installmentPerBus)}/ônibus por mês · taxa fictícia ${c.rate}% a.m.`:''}\n\nIMPORTANTE: valores, prazos, opcionais e compatibilidade são estimativas fictícias. Não é oferta comercial ou pedido de fábrica. Confirme ficha técnica, lotação homologada, compatibilidade carroceria/chassi, preço e prazo com as empresas responsáveis.\nFicha de referência: ${c.source}`;}
function gcZeroKmRenderQuote(q){$('#zeroKmQuoteResult').hidden=false;$('#zeroKmQuoteTitle').textContent=`${q.config.make} ${q.config.model} · ${q.config.quantity} unidade(s)`;$('#zeroKmQuoteStats').innerHTML=[['Preço estimado por unidade',money(q.unitPrice)],['Quantidade',String(q.config.quantity)],['Total estimado',money(q.totalPrice)],['Prazo estimado de entrega',`${q.config.deliveryMonths} mês(es)`],['Entrada simulada',money(q.downTotal||0)],['Parcela estimada por unidade',q.config.payment==='finance'?money(q.installmentPerBus):'—']].map(([l,v])=>moneyStat(l,v)).join('');$('#zeroKmQuoteSpec').innerHTML=`<div><strong>Configuração selecionada</strong><p>${escapeHtml(q.config.company)} · ${escapeHtml(q.config.prefix)} · ${escapeHtml(q.config.year)}<br>${escapeHtml(q.config.chassisBrand)} ${escapeHtml(q.config.chassisModel)} · ${escapeHtml(q.config.engine)}<br>${escapeHtml(q.config.length+' × '+q.config.width+' × '+q.config.height)} m · ${q.config.seated} sentados + ${q.config.standing} em pé<br>${escapeHtml(q.config.transmission)} · ${escapeHtml(q.config.suspension)} · ${escapeHtml(q.config.accessibility)}<br>${escapeHtml(q.config.validator)} · ${escapeHtml(q.config.paint)}</p></div><p class="tool-result-note">Preço ilustrativo de simulação. A combinação real depende de validação técnica e cotação oficial.</p>`;$('#zeroKmSaveQuote').disabled=false;$('#zeroKmAcquire').disabled=q.config.payment==='quote';$('#zeroKmCopyQuote').dataset.quoteId=q.id;$('#zeroKmDownloadQuote').dataset.quoteId=q.id;}
function gcZeroKmRenderHistory(){const el=$('#zeroKmQuoteHistory');if(!el)return;const rows=readArrayKey(GC_ZERO_KM_QUOTES_KEY).slice().reverse().slice(0,20);el.innerHTML=rows.length?rows.map(q=>`<article class="record-item"><div><strong>${escapeHtml(q.config.make)} ${escapeHtml(q.config.model)} · ${escapeHtml(q.config.company)}</strong><small>${escapeHtml(q.config.chassisBrand)} ${escapeHtml(q.config.chassisModel)} · ${q.config.quantity} unidade(s) · total ${money(q.totalPrice)} · ${escapeHtml(new Date(q.createdAt).toLocaleDateString('pt-BR'))}</small></div><button class="secondary-action-button" type="button" data-zero-km-load="${escapeHtml(q.id)}">Carregar cotação</button></article>`).join(''):recordsEmpty('Nenhuma cotação guardada ainda.');}
function gcZeroKmInvalidateOnEdit(){gcZeroKmInvalidateQuote();}
function gcZeroKmCalculateQuote(){if(!assertOwner())return;const c=gcZeroKmReadConfig();if(!c||!c.company||!c.prefix||!c.quantity||c.length<=0||c.width<=0||c.height<=0||c.seated<1||c.standing<0){showToast('Confira comprador, prefixo, modelo, chassi, dimensões e lotação.');return;}if(c.downPct<0||c.downPct>100||c.rate<0||c.rate>10||c.months<1){showToast('Confira entrada e condições de financiamento.');return;}const unitPrice=gcZeroKmCalculatePrice(c),totalPrice=unitPrice*c.quantity,downTotal=c.payment==='finance'?totalPrice*c.downPct/100:0,principalPerBus=unitPrice*(1-c.downPct/100),installmentPerBus=c.payment==='finance'?loanMonthlyPayment(principalPerBus,c.months,c.rate):0;gcZeroKmCurrentQuote={id:makeId(),createdAt:new Date().toISOString(),config:c,unitPrice,totalPrice,downTotal,installmentPerBus};gcZeroKmRenderQuote(gcZeroKmCurrentQuote);}
$('#zeroKmOpenButton').addEventListener('click',()=>{if(!assertOwner())return;$('#zeroKmMarketPanel').hidden=false;gcZeroKmRenderHistory();gcZeroKmRefreshModels();$('#zeroKmMarketPanel').scrollIntoView({behavior:'smooth',block:'start'});});
$('#zeroKmCloseButton').addEventListener('click',()=>{$('#zeroKmMarketPanel').hidden=true;$('#zeroKmOpenButton').scrollIntoView({behavior:'smooth',block:'center'});});
$('#ownerValidatorOpenButton')?.addEventListener('click',()=>{if(!assertOwner())return;gcValidatorRender();switchScreen('validatorScreen');});
$('#zeroKmSegment').addEventListener('change',()=>gcZeroKmRefreshModels());
$('#zeroKmBodyBuilder').addEventListener('change',()=>gcZeroKmRefreshModels());
$('#zeroKmModel').addEventListener('change',()=>{const m=gcZeroKmSelectedModel();gcZeroKmApplyModelDefaults();if(m){const brand=m.brands?.[0]||'';gcZeroKmRefreshChassis(brand);}});
$('#zeroKmChassisBrand').addEventListener('change',()=>gcZeroKmRefreshChassis($('#zeroKmChassisBrand').value));
$('#zeroKmChassisModel').addEventListener('change',gcZeroKmApplyChassisDefaults);
['zeroKmCompany','zeroKmPrefix','zeroKmQuantity','zeroKmYear','zeroKmDelivery','zeroKmQuoteRegion','zeroKmEngine','zeroKmEmission','zeroKmEnginePosition','zeroKmLength','zeroKmWidth','zeroKmHeight','zeroKmSeated','zeroKmStanding','zeroKmDoors','zeroKmFloor','zeroKmAxles','zeroKmSuspension','zeroKmTransmission','zeroKmAir','zeroKmSeatsType','zeroKmAccessibility','zeroKmUSB','zeroKmWifi','zeroKmCameras','zeroKmLED','zeroKmGPS','zeroKmValidator','zeroKmPaint','zeroKmInterior','zeroKmWarranty','zeroKmMaintenance','zeroKmPayment','zeroKmDownPct','zeroKmMonths','zeroKmRate'].forEach(id=>{const el=$('#'+id);el.addEventListener('input',()=>{gcZeroKmInvalidateOnEdit();if(id==='zeroKmSeated'||id==='zeroKmStanding')gcZeroKmUpdateCapacity();});el.addEventListener('change',()=>{gcZeroKmInvalidateOnEdit();if(id==='zeroKmSeated'||id==='zeroKmStanding')gcZeroKmUpdateCapacity();if(id==='zeroKmPayment'){const financ=$('#zeroKmPayment').value==='finance';$('#zeroKmDownPct').disabled=!financ;$('#zeroKmMonths').disabled=!financ;$('#zeroKmRate').disabled=!financ;}});});
$('#zeroKmConfigForm').addEventListener('submit',event=>{event.preventDefault();gcZeroKmCalculateQuote();});
$('#zeroKmSaveQuote').addEventListener('click',()=>{if(!assertOwner()||!gcZeroKmCurrentQuote)return;const rows=readArrayKey(GC_ZERO_KM_QUOTES_KEY);if(rows.some(x=>x.id===gcZeroKmCurrentQuote.id)){showToast('Esta cotação já foi guardada.');return;}rows.push(gcZeroKmCurrentQuote);if(!writeArrayKey(GC_ZERO_KM_QUOTES_KEY,rows))return;gcZeroKmRenderHistory();showToast('Cotação 0 km guardada no histórico local.');});
$('#zeroKmCopyQuote').addEventListener('click',async()=>{if(!gcZeroKmCurrentQuote)return;showToast(await copyText(gcZeroKmCurrentQuoteText(gcZeroKmCurrentQuote))?'Ficha da cotação copiada.':'Não foi possível copiar automaticamente.');});
$('#zeroKmDownloadQuote').addEventListener('click',()=>{if(!gcZeroKmCurrentQuote)return;downloadTextFile(`grupo-conect-cotacao-0km-${gcZeroKmCurrentQuote.config.prefix}.txt`,gcZeroKmCurrentQuoteText(gcZeroKmCurrentQuote),'text/plain;charset=utf-8');showToast('Ficha da cotação baixada.');});
function gcZeroKmPrefixList(base,qty){const raw=String(base||'').trim(),m=raw.match(/^(.*?)(\d+)$/);return Array.from({length:qty},(_,i)=>qty===1?raw:m?m[1]+String(Number(m[2])+i).padStart(m[2].length,'0'):`${raw}-${String(i+1).padStart(2,'0')}`);}
function gcZeroKmAcquire(){if(!assertOwner()||!gcZeroKmCurrentQuote)return;const q=gcZeroKmCurrentQuote,c=q.config;if(c.payment==='quote'){showToast('Escolha compra à vista ou financiamento para registrar a aquisição.');return;}const prefixes=gcZeroKmPrefixList(c.prefix,c.quantity),existing=GROUP_COMPANIES.flatMap(company=>availableBusPool(company).map(x=>({company:x.company||company,prefix:x.prefix}))).concat(ownerFleet());const conflicts=prefixes.filter(prefix=>existing.some(x=>norm(x.company)===norm(c.company)&&norm(x.prefix)===norm(prefix)));if(conflicts.length){showToast(`Prefixo já existente: ${conflicts.join(', ')}. Escolha um prefixo inicial livre.`);return;}const cash=cashBreakdown();let downTotal=0;const finance=c.payment==='finance'&&c.downPct<100;if(c.payment==='cash'||c.payment==='finance'&&!finance){downTotal=q.totalPrice;}else if(finance)downTotal=q.totalPrice*c.downPct/100;if(downTotal>cash.balance+0.005){showToast(`Aquisição recusada: o caixa disponível é ${money(cash.balance)} e a entrada exigida é ${money(downTotal)}. Registre um aporte ou escolha outra condição.`);return;}const newFleet=[],newFinance=[];prefixes.forEach(prefix=>{const row={id:makeId(),company:c.company,prefix,model:`${c.make} ${c.model}`,chassis:`${c.chassisBrand} ${c.chassisModel}`,createdAt:new Date().toISOString(),source:'zero-km-market',isZeroKm:true,year:c.year,seats:c.seated,standing:c.standing,lengthM:c.length,widthM:c.width,heightM:c.height,bodyBuilder:c.make,engine:c.engine,segment:c.segment,doors:c.doors,floor:c.floor,transmission:c.transmission,air:c.air,validator:c.validator,paint:c.paint,sourceQuoteId:q.id};newFleet.push(row);if(finance){const price=q.unitPrice,down=price*c.downPct/100,principal=price-down;newFinance.push({id:makeId(),company:c.company,model:row.model,chassis:row.chassis,year:c.year,prefix,price,downPayment:down,principal,installmentCount:c.months,monthlyRate:c.rate,installmentAmount:loanMonthlyPayment(principal,c.months,c.rate),firstDueDate:addMonthsToISO(dateTodayLocal(),1),lateFinePct:2,lateInterestPct:1,paidCount:0,payments:[],createdAt:new Date().toISOString(),zeroKmQuoteId:q.id});}});const fl=ownerFleet();fl.push(...newFleet);if(!writeArrayKey(OWNER_FLEET_KEY,fl))return;if(newFinance.length){const fr=financedBuses();fr.push(...newFinance);if(!writeArrayKey(FINANCED_BUSES_KEY,fr))return;}if(downTotal>0){const led=cashLedger();led.push({id:`zero-km-cash-${q.id}`,date:dateTodayLocal(),direction:'out',category:finance?'Entrada de ônibus 0 km financiado':'Compra de ônibus 0 km',amount:downTotal,description:`${c.quantity} × ${c.make} ${c.model} · ${prefixes.join(', ')} · cotação ${q.id}`,createdAt:new Date().toISOString(),source:'zeroKmPurchase',quoteId:q.id});if(!writeArrayKey(CASH_LEDGER_KEY,led))return;}renderOwnerFleet();refreshOperationChoices();renderFinanceList();renderCashDashboard();const quotes=readArrayKey(GC_ZERO_KM_QUOTES_KEY);const ix=quotes.findIndex(x=>x.id===q.id);if(ix>=0){quotes[ix]={...quotes[ix],status:'Aquisição registrada',prefixes};writeArrayKey(GC_ZERO_KM_QUOTES_KEY,quotes);}showToast(`${newFleet.length} ônibus 0 km adicionado(s) à frota. ${finance?`${newFinance.length} financiamento(s) cadastrado(s).`:c.payment==='cash'?'Compra simulada lançada no Caixa.':'Aquisição registrada.'}`);gcZeroKmRenderHistory();$('#zeroKmAcquire').disabled=true;}
$('#zeroKmAcquire').addEventListener('click',gcZeroKmAcquire);
$('#zeroKmQuoteHistory').addEventListener('click',event=>{const b=event.target.closest('[data-zero-km-load]');if(!b)return;if(!assertOwner())return;const q=readArrayKey(GC_ZERO_KM_QUOTES_KEY).find(x=>x.id===b.dataset.zeroKmLoad);if(!q)return;const c=q.config;$('#zeroKmCompany').value=c.company;$('#zeroKmPrefix').value=c.prefix;$('#zeroKmQuantity').value=c.quantity;$('#zeroKmYear').value=c.year;$('#zeroKmDelivery').value=String(c.deliveryMonths);$('#zeroKmQuoteRegion').value=c.region;$('#zeroKmSegment').value=c.segment;$('#zeroKmBodyBuilder').value=c.make;gcZeroKmRefreshModels(c.modelId);gcZeroKmRefreshChassis(c.chassisBrand,c.chassisModel);for(const [id,key] of Object.entries({zeroKmEngine:'engine',zeroKmEmission:'emission',zeroKmEnginePosition:'enginePosition',zeroKmLength:'length',zeroKmWidth:'width',zeroKmHeight:'height',zeroKmSeated:'seated',zeroKmStanding:'standing',zeroKmDoors:'doors',zeroKmFloor:'floor',zeroKmAxles:'axles',zeroKmSuspension:'suspension',zeroKmTransmission:'transmission',zeroKmAir:'air',zeroKmSeatsType:'seatsType',zeroKmAccessibility:'accessibility',zeroKmUSB:'usb',zeroKmWifi:'wifi',zeroKmCameras:'cameras',zeroKmLED:'led',zeroKmGPS:'gps',zeroKmValidator:'validator',zeroKmPaint:'paint',zeroKmInterior:'interior',zeroKmWarranty:'warrantyMonths',zeroKmMaintenance:'maintenance',zeroKmPayment:'payment',zeroKmDownPct:'downPct',zeroKmMonths:'months',zeroKmRate:'rate'})){const el=$('#'+id);if(el)el.value=String(c[key]);}gcZeroKmCalculateQuote();$('#zeroKmMarketPanel').scrollIntoView({behavior:'smooth',block:'start'});});

function renderOwnerRoutes(){
  refreshRouteDatalists();
  const list=$('#ownerRouteList');if(!list)return;
  const rows=ownerRoutes();
  list.innerHTML=rows.length?rows.slice().reverse().map(r=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(r.city)} · ${escapeHtml(r.line)}</strong><small>${escapeHtml(r.serviceType||'Municipal')} · cadastrada em ${escapeHtml(displayDateValue(r.createdAt||dateTodayLocal()))}</small><span class="record-inline-tag">${escapeHtml(r.serviceType||'Municipal')}</span></div><div class="inline-toolbar"><button class="secondary-action-button" type="button" data-owner-route-scale="${escapeHtml(r.id)}">Usar na escala</button><button class="secondary-action-button" type="button" data-owner-route-contract="${escapeHtml(r.id)}">Solicitar contrato</button><button class="record-danger" type="button" data-owner-route-delete="${escapeHtml(r.id)}">Excluir</button></div></div></article>`).join(''):recordsEmpty('Nenhuma rota cadastrada. Cadastre cidade, linha e tipo de serviço; depois use a rota na escala diária ou peça uma proposta municipal.');
}
$('#ownerRouteForm').addEventListener('submit',event=>{
  event.preventDefault();if(!assertOwner())return;
  const city=$('#orCity').value.trim(),line=$('#orLine').value.trim(),serviceType=$('#orType').value;
  if(!city||!line){showToast('Informe a cidade e a linha.');return;}
  const rows=ownerRoutes(),old=rows.find(r=>routeKey(r.city,r.line)===routeKey(city,line));
  if(old){old.serviceType=serviceType;old.updatedAt=new Date().toISOString();}
  else rows.push({id:makeId(),city,line,serviceType,createdAt:new Date().toISOString()});
  if(!writeArrayKey(OWNER_ROUTES_KEY,rows))return;
  $('#ownerRouteForm').reset();$('#orType').value='Municipal';renderOwnerRoutes();
  showToast(old?'Tipo de serviço da rota atualizado.':'Cidade e linha cadastradas; já podem ser usadas na escala e nos contratos.');
});
$('#ownerRouteList').addEventListener('click',event=>{
  const useScale=event.target.closest('[data-owner-route-scale]'),useContract=event.target.closest('[data-owner-route-contract]'),del=event.target.closest('[data-owner-route-delete]');
  const routeId=(useScale||useContract||del)?.dataset.ownerRouteScale||(useContract?.dataset.ownerRouteContract)||(del?.dataset.ownerRouteDelete);
  if(!routeId)return;if(!assertOwner())return;
  const route=ownerRoutes().find(r=>r.id===routeId);if(!route)return;
  if(del){if(!window.confirm(`Excluir a rota ${route.city} · ${route.line}? As escalas e contratos já salvos serão preservados.`))return;writeArrayKey(OWNER_ROUTES_KEY,ownerRoutes().filter(r=>r.id!==routeId));renderOwnerRoutes();showToast('Rota excluída do cadastro.');return;}
  if(useScale){ownerScalePreview=null;latestScaleText='';$('#ownerScaleResults').hidden=true;$('#osCity').value=route.city;$('#osLine').value=route.line;$('#osServiceType').value='auto';suggestDemandFromHistory();$('#ownerScaleForm').scrollIntoView({behavior:'smooth',block:'start'});showToast('Rota carregada na escala. Escolha a empresa e informe a demanda do dia.');}
  if(useContract){currentOwnerContract=null;currentOwnerContractText='';$('#ownerContractResults').hidden=true;$('#ocCity').value=route.city;$('#ocLine').value=route.line;$('#ownerContractForm').scrollIntoView({behavior:'smooth',block:'start'});showToast('Cidade e linha carregadas para solicitar uma proposta municipal.');}
});

function vehicleFromStaticFleet(company){
  const result=[];
  FLEET.filter(m=>norm(m.company)===norm(company)).forEach(m=>(m.prefixes||[]).forEach(prefix=>result.push({company:m.company,prefix:String(prefix),model:m.model,chassis:m.chassis||'',source:'base',service:m.service||'A definir'})));
  return result;
}
function availableBusPool(company,date='',city='',line=''){
  const map=new Map();
  vehicleFromStaticFleet(company).forEach(x=>map.set(`${norm(x.company)}|${norm(x.prefix)}`,x));
  ownerFleet().filter(x=>norm(x.company)===norm(company)&&x.prefix&&x.model).forEach(x=>map.set(`${norm(x.company)}|${norm(x.prefix)}`,{...x,source:'custom',company:x.company,prefix:String(x.prefix),model:x.model,chassis:x.chassis||'',service:x.type||'A definir'}));
  let rows=Array.from(map.values());
  if(date){
    // Um prefixo só pode atender uma viagem por data: desconta escalas diárias,
    // operações recorrentes, fretamentos aceitos e viagens normais já registradas.
    const occupied=new Set(ownerScales().filter(x=>x.date===date&&norm(x.company)===norm(company)).map(x=>norm(x.prefix)));
    rows=rows.filter(x=>!occupied.has(norm(x.prefix)));
    if(typeof gcOnlineBusReservationReason==='function'){
      rows=rows.filter(x=>!gcOnlineBusReservationReason(x,date));
    }
  }
  return rows;
}
function renderOwnerFleet(){
  const list=$('#ownerFleetList');if(!list)return;
  const rows=GROUP_COMPANIES.flatMap(company=>availableBusPool(company).map(x=>({...x,company}))).sort((a,b)=>a.company.localeCompare(b.company,'pt-BR')||String(a.prefix).localeCompare(String(b.prefix),'pt-BR',{numeric:true}));
  list.innerHTML=rows.length?rows.map(x=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(x.company)} · prefixo ${escapeHtml(x.prefix)} · ${escapeHtml(x.model)}</strong><small>Chassi: ${escapeHtml(x.chassis||'não informado')} · o veículo pode ser escalado para linhas diferentes em dias diferentes</small><span class="record-inline-tag">${x.source==='base'?'Frota base':'Cadastro do proprietário'}</span></div>${x.source==='custom'?`<button class="record-danger" type="button" data-owner-fleet-delete="${escapeHtml(x.id)}">Excluir</button>`:''}</div></article>`).join(''):recordsEmpty('Nenhum veículo disponível. Cadastre modelos e prefixos da empresa.');
}
$('#ownerFleetForm').addEventListener('submit',event=>{
  event.preventDefault();if(!assertOwner())return;
  const row={id:makeId(),company:$('#ofCompany').value.trim(),prefix:$('#ofPrefix').value.trim(),model:$('#ofModel').value.trim(),chassis:$('#ofChassis').value.trim(),createdAt:new Date().toISOString(),source:'owner'};
  if(!row.company||!row.prefix||!row.model){showToast('Informe empresa, prefixo e modelo. O chassi é opcional.');return;}
  if(availableBusPool(row.company).some(x=>norm(x.prefix)===norm(row.prefix))){showToast('Este prefixo já está disponível nessa empresa. Confira o cadastro para evitar duplicidade.');return;}
  const rows=ownerFleet();rows.push(row);if(!writeArrayKey(OWNER_FLEET_KEY,rows))return;
  $('#ownerFleetForm').reset();renderOwnerFleet();refreshOperationChoices();renderMarket();showToast('Veículo adicionado ao conjunto de ônibus que a escala pode recomendar.');
});
$('#ownerFleetList').addEventListener('click',event=>{const b=event.target.closest('[data-owner-fleet-delete]');if(!b)return;if(!assertOwner())return;if(!window.confirm('Excluir este veículo personalizado da frota disponível? Escalas e financiamentos antigos serão preservados.'))return;writeArrayKey(OWNER_FLEET_KEY,ownerFleet().filter(x=>x.id!==b.dataset.ownerFleetDelete));renderOwnerFleet();refreshOperationChoices();showToast('Veículo removido da frota disponível.');});
$('#ownerExportFleet').addEventListener('click',()=>{
  if(!assertOwner())return;const rows=GROUP_COMPANIES.flatMap(company=>availableBusPool(company).map(x=>({...x,company})));
  if(!rows.length){showToast('Não há veículos para exportar.');return;}
  const header=['Empresa','Prefixo','Modelo','Chassi','Origem'];const data=rows.map(x=>[x.company,x.prefix,x.model,x.chassis,x.source==='base'?'Frota base':'Cadastro do proprietário']);
  downloadTextFile('grupo-conect-frota.csv',[header,...data].map(r=>r.map(csvCell).join(';')).join('\n'),'text/csv;charset=utf-8');showToast('Frota exportada em CSV.');
});

function scalesForProfile(weekday,city,line,company=''){
  return ownerScales().filter(x=>x.weekday===weekday&&norm(x.city)===norm(city)&&norm(x.line)===norm(line)&&(!company||norm(x.company)===norm(company)));
}
['osWeekday','osCity','osLine','osCompany'].forEach(id=>$('#'+id).addEventListener('change',suggestDemandFromHistory));
$('#osDate').value=dateTodayLocal();
if(weekdayFromISO($('#osDate').value))$('#osWeekday').value=weekdayFromISO($('#osDate').value);
$('#osDate').addEventListener('change',()=>{const d=weekdayFromISO($('#osDate').value);if(d)$('#osWeekday').value=d;suggestDemandFromHistory();});
let latestScaleText='';
function suggestDemandFromHistory(){
  if(!$('#ownerDemandNote'))return;
  const weekday=$('#osWeekday').value,city=$('#osCity').value.trim(),line=$('#osLine').value.trim(),company=$('#osCompany').value;
  const note=$('#ownerDemandNote');
  const route=findRegisteredRoute(city,line);
  const rows=city&&line?scalesForProfile(weekday,city,line,company):[];
  const busCount=company?availableBusPool(company,$('#osDate').value,city,line).length:0;
  const parts=[];
  if(route)parts.push(`Rota cadastrada como ${route.serviceType||'Municipal'}.`);
  else if(city&&line)parts.push('Rota não cadastrada: será analisada com o tipo de serviço informado.');
  if(rows.length){
    $('#osPassengers').value=Math.round(avg(rows,'passengers'));
    $('#osFree').value=Math.min(Number($('#osPassengers').value),Math.round(avg(rows,'free')));
    $('#osTripsDay').value=Math.max(1,Math.round(avg(rows,'tripsDay')));
    parts.push(`Demanda sugerida por ${rows.length} escala(s) anterior(es) do mesmo dia, empresa, cidade e linha.`);
  }else if(city&&line)parts.push(`Sem histórico para ${WEEKDAY_LABELS[weekday]}, ${city} · ${line}; serão usados os dados de demanda informados agora.`);
  if(company)parts.push(`${busCount} veículo(s) disponível(is) de ${company} para essa data, descontando prefixos usados em outras linhas no mesmo dia.`);
  parts.push('A escolha final do ônibus considera categoria do serviço, capacidade estimada, distância, intervalos e consumo de referência.');
  note.textContent=parts.join(' ');
}
function matchMarketBus(model,chassis=''){
  if(!Array.isArray(BUS_MARKET))return null;
  const clean=s=>norm(s).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(t=>t.length>2&&!['marcopolo','caio','neobus','mascarello','volare','busscar','comil','mercedes','benz','volkswagen','mb','of','ods','eod','euro','iii','iv','ii','2007','2019','2020','2021','2022','2023','2024'].includes(t));
  const wanted=clean(model), wantedAll=norm(model), chassisKey=norm(chassis);
  let best=null,bestScore=0;
  BUS_MARKET.forEach(item=>{
    const candidate=clean(item.model), candidateAll=norm(item.model);let score=0;
    if(wantedAll===candidateAll)score+=30;
    else if(wantedAll.includes(candidateAll)||candidateAll.includes(wantedAll))score+=16;
    const common=wanted.filter(t=>candidate.includes(t));score+=common.length*8;
    const union=new Set([...wanted,...candidate]).size; if(union)score+=common.length/union*6;
    if(/articulad|double|dd/.test(candidateAll)&&!/articulad|double|dd/.test(wantedAll))score-=15;
    if(/micro|volare|senior|foz|fly|attack 8/.test(candidateAll)&&!/micro|volare|senior|foz|fly|attack 8/.test(wantedAll))score-=8;
    if(chassisKey&&norm(item.chassis)&& (chassisKey.includes(norm(item.chassis))||norm(item.chassis).includes(chassisKey)))score+=4;
    if(score>bestScore){best=item;bestScore=score;}
  });
  return bestScore>=12?best:null;
}
function busOperationalProfile(vehicle){
  const model=String(vehicle.model||''),chassis=String(vehicle.chassis||''),name=norm(model),market=matchMarketBus(model,chassis);
  if(market){
    const type=String(market.type||'');
    const cls=/articulad|brt/.test(norm(type+' '+model))?'articulated':/micro|volare|senior|foz|fly|attack 8/.test(norm(type+' '+model))?'micro':/rodovi|double|high.?deck|viaggio|paradiso|audace|ideale|spectrum road/.test(norm(type+' '+model))?'coach':'urban';
    return {seated:Math.max(1,Number(market.seated||market.seats||40)),standing:Math.max(0,Number(market.standing||0)),capacity:Math.max(1,Number(market.totalCapacity||market.seated||market.seats||40)),kmpl:Number(market.kmL)||(/micro/.test(cls)?4.2:cls==='coach'?2.6:2.1),tank:Number(market.tankL)||(/micro/.test(cls)?150:cls==='coach'?480:280),length:Number(market.lengthM)||12,serviceClass:cls,profileSource:'ficha de referência do mercado'};
  }
  let cls='urban',seated=40,standing=28,kmpl=2.1,tank=280,length=12;
  if(/articulad|brt/.test(name)){cls='articulated';seated=55;standing=55;kmpl=1.25;tank=350;length=18.5;}
  else if(/micro|gran micro|volare|senior|foz|fly 8|fly 9|fly 10|fly 12|attack 8/.test(name)){cls='micro';seated=26;standing=/urbano/.test(name)?8:0;kmpl=4.2;tank=150;length=8.5;}
  else if(/rodovi|road|paradiso|viaggio|audace|ideale|double.?decker/.test(name)){cls='coach';seated=45;standing=0;kmpl=2.6;tank=480;length=/double.?decker/.test(name)?14:12.5;}
  else if(/torino|apache vip|gran via|spectrum|n10/.test(name)){cls='urban';seated=42;standing=30;kmpl=2.05;tank=280;length=12.5;}
  return {seated,standing,capacity:seated+standing,kmpl,tank,length,serviceClass:cls,profileSource:'estimativa pelo nome do modelo'};
}
function serviceTypeForScale(){
  const chosen=$('#osServiceType').value;
  if(chosen!=='auto')return chosen;
  const route=findRegisteredRoute($('#osCity').value,$('#osLine').value);
  if(route)return route.serviceType||'Municipal';
  if(/\brj\s*[×x]\s*(poa|sp|bh|curitiba|vit[oó]ria|bras[ií]lia|florian[oó]polis|juiz de fora)/i.test($('#osLine').value))return 'Interestadual';
  return 'Municipal';
}
function rankVehiclesForScale(vehicles,x,serviceType){
  const expected=Number(x.passengers)||0;
  return vehicles.map(v=>{
    const profile=busOperationalProfile(v),ratio=profile.capacity?expected/profile.capacity:2;let score=60;
    if(expected<=profile.capacity){score+=ratio>=0.45&&ratio<=0.9?24:ratio<0.25?8:14;}else score-=Math.min(90,45+(ratio-1)*65);
    if(serviceType==='Municipal')score+=profile.serviceClass==='urban'?32:profile.serviceClass==='articulated'?28:profile.serviceClass==='micro'?18:-48;
    else if(serviceType==='Intermunicipal'||serviceType==='Municipal e intermunicipal')score+=profile.serviceClass==='coach'?28:profile.serviceClass==='micro'?12:profile.serviceClass==='urban'?10:18;
    else if(serviceType==='Interestadual')score+=profile.serviceClass==='coach'?38:profile.serviceClass==='articulated'?-50:profile.serviceClass==='micro'?-30:-65;
    if(x.km>150)score+=profile.serviceClass==='coach'?25:profile.serviceClass==='urban'?-30:0;
    else if(x.km>60)score+=profile.serviceClass==='coach'?12:profile.serviceClass==='urban'?-14:0;
    else if(x.km<25)score+=profile.serviceClass==='urban'?10:profile.serviceClass==='coach'?-10:0;
    score+=Math.min(4.5,profile.kmpl)*3;
    if(profile.capacity<expected)score-=20;
    return {...v,profile,score};
  }).sort((a,b)=>b.score-a.score||b.profile.kmpl-a.profile.kmpl||String(a.prefix).localeCompare(String(b.prefix),'pt-BR',{numeric:true}));
}
function calculateOwnerScale(){
  const x={date:$('#osDate').value,weekday:$('#osWeekday').value,company:$('#osCompany').value.trim(),city:$('#osCity').value.trim(),line:$('#osLine').value.trim(),serviceType:serviceTypeForScale(),passengers:readToolValue('osPassengers'),free:readToolValue('osFree'),fare:readToolValue('osFare'),km:readToolValue('osKm'),minutes:readToolValue('osMinutes'),upKm:readToolValue('osUpKm'),flatKm:readToolValue('osFlatKm'),downKm:readToolValue('osDownKm'),diesel:readToolValue('osDieselPrice'),maintKm:readToolValue('osMaintKm'),laborHour:readToolValue('osLaborHour'),fixedTrip:readToolValue('osFixedCost'),tripsDay:readToolValue('osTripsDay'),headway:readToolValue('osHeadway')};
  if(!x.date||!x.weekday||!x.company||!x.city||!x.line||[x.passengers,x.free,x.fare,x.km,x.minutes,x.upKm,x.flatKm,x.downKm,x.diesel,x.maintKm,x.laborHour,x.fixedTrip,x.tripsDay,x.headway].some(v=>v===null)||x.passengers<0||x.free>x.passengers||x.km<=0||x.minutes<=0||x.diesel<=0||x.tripsDay<1||x.headway<1){showToast('Confira data, empresa, cidade, linha e os valores operacionais. As gratuidades não podem superar os passageiros previstos.');return null;}
  const terrainTotal=x.upKm+x.flatKm+x.downKm;
  if(Math.abs(terrainTotal-x.km)>Math.max(0.2,x.km*0.03)){showToast(`A soma de subidas, retas e descidas (${numberPt(terrainTotal,1)} km) precisa aproximar-se dos ${numberPt(x.km,1)} km totais.`);return null;}
  const all=availableBusPool(x.company,x.date,x.city,x.line);
  if(!all.length){showToast(`Nenhum ônibus de ${x.company} está disponível para essa data. Cadastre mais veículos ou confira as escalas já salvas.`);return null;}
  const ranked=rankVehiclesForScale(all,x,x.serviceType),chosen=ranked[0],profile=chosen.profile;
  if(!chosen){showToast('Não foi possível encontrar um veículo adequado para essa linha.');return null;}
  x.model=chosen.model;x.chassis=chosen.chassis||'Não informado';x.prefix=String(chosen.prefix);x.seats=profile.capacity;x.seated=profile.seated;x.standing=profile.standing;x.kmpl=profile.kmpl;x.tank=profile.tank;x.vehicleProfile=profile.profileSource;x.score=chosen.score;x.alternatives=ranked.slice(1,4).map(v=>({model:v.model,prefix:v.prefix,capacity:v.profile.capacity,kmpl:v.profile.kmpl,score:v.score}));
  const terrainFactor=Math.max(0.75,Math.min(1.6,1+(x.upKm/x.km)*0.30-(x.downKm/x.km)*0.07));
  const vehicleUnits=Math.max(1,Math.ceil(x.passengers/x.seats));
  const dailyVehicleRuns=x.tripsDay*vehicleUnits;
  const simultaneousBuses=Math.max(vehicleUnits,Math.ceil((x.minutes/x.headway)*vehicleUnits));
  const kmDaily=x.km*dailyVehicleRuns,litersTrip=(x.km/x.kmpl)*terrainFactor,litersDay=litersTrip*dailyVehicleRuns,dieselCost=litersDay*x.diesel;
  const maintenanceCost=kmDaily*x.maintKm,laborHours=(x.minutes/60)*dailyVehicleRuns,laborCost=laborHours*x.laborHour,fixedCost=dailyVehicleRuns*x.fixedTrip,dailyCost=dieselCost+maintenanceCost+laborCost+fixedCost;
  const payers=Math.max(0,x.passengers-x.free),revenue=payers*x.fare*x.tripsDay,profit=revenue-dailyCost,dailyPayers=payers*x.tripsDay,breakEven=dailyPayers>0?dailyCost/dailyPayers:null;
  const profileRows=scalesForProfile(x.weekday,x.city,x.line,x.company);
  Object.assign(x,{terrainFactor,vehicleUnits,dailyVehicleRuns,simultaneousBuses,kmDaily,litersTrip,litersDay,dieselCost,maintenanceCost,laborHours,laborCost,fixedCost,dailyCost,payers,revenue,profit,breakEven,profileCount:profileRows.length,demandSource:profileRows.length?'Perfil histórico do dia da semana':'Estimativa manual (sem histórico suficiente)'});
  $('#ownerScaleHeading').textContent=`${WEEKDAY_LABELS[x.weekday]} · ${x.company} · ${x.line}`;
  $('#ownerScaleStats').innerHTML=[['Ônibus recomendado',`${x.model} · prefixo ${x.prefix}`],['Capacidade estimada',`${x.seats} total (${x.seated} sentados + ${x.standing} em pé)`],['Perfil do veículo',`${x.serviceType} · consumo de referência ${numberPt(x.kmpl,2)} km/L`],['Ônibus simultâneos estimados',`${simultaneousBuses}`],['Passageiros/partida',`${x.passengers} (${x.payers} pagantes + ${x.free} gratuidades)`],['Partidas/dia',x.tripsDay],['Km da frota/dia',`${numberPt(kmDaily,1)} km`],['Diesel/dia',`${numberPt(litersDay,1)} L · ${money(dieselCost)}`],['Custo diário estimado',money(dailyCost)],['Arrecadação diária',money(revenue)],['Resultado diário estimado',money(profit)],['Tarifa de equilíbrio',breakEven===null?'Sem pagantes':money(breakEven)]].map(([l,v])=>moneyStat(l,v,l.includes('Resultado')?(profit>=0?'positive':'negative'):'')).join('');
  const alternatives=x.alternatives.length?` Alternativas próximas: ${x.alternatives.map(a=>`${a.model} prefixo ${a.prefix} (${a.capacity} passageiros estimados, ${numberPt(a.kmpl,1)} km/L)`).join('; ')}.`:' Não há outro veículo livre para comparar nesse dia.';
  $('#ownerScaleNarrative').textContent=`Recomendação: ${x.model}, prefixo ${x.prefix}. Escolha feita pela compatibilidade do tipo de serviço (${x.serviceType}), demanda por partida, capacidade aproximada, distância e economia estimada. Demanda: ${x.demandSource}${x.profileCount?` (${x.profileCount} escala(s) anterior(es))`:''}. Perfil técnico: ${x.vehicleProfile}; valores aproximados do catálogo ou estimados pelo nome do modelo. Fator de terreno ${numberPt(terrainFactor,2)}; são estimados ${vehicleUnits} ônibus por partida e ${simultaneousBuses} simultâneos pelo intervalo informado. Os custos incluem apenas os itens preenchidos.${alternatives}`;
  $('#ownerScaleResults').hidden=false;
  latestScaleText=`GRUPO CONECT — ESCALA DIÁRIA RECOMENDADA\nData: ${localDate(x.date)} · ${WEEKDAY_LABELS[x.weekday]}\nEmpresa: ${x.company}\nCidade/linha: ${x.city} · ${x.line}\nTipo de serviço: ${x.serviceType}\nÔnibus recomendado: ${x.model} · Prefixo ${x.prefix} · Chassi ${x.chassis}\nCapacidade estimada: ${x.seats} (${x.seated} sentados + ${x.standing} em pé) · Consumo de referência ${numberPt(x.kmpl,2)} km/L\nJustificativa: demanda, categoria de serviço, quilometragem e consumo. Perfil técnico: ${x.vehicleProfile}.\nPassageiros/partida: ${x.passengers} (pagantes ${x.payers} + gratuidades ${x.free})\nPartidas: ${x.tripsDay}/dia · Tempo ${x.minutes} min · intervalo ${x.headway} min\nÔnibus/partida ${vehicleUnits} · ônibus simultâneos estimados ${simultaneousBuses}\nKm/dia da frota: ${numberPt(kmDaily,1)} · Diesel/dia ${numberPt(litersDay,1)} L · custo diesel ${money(dieselCost)}\nManutenção ${money(maintenanceCost)} · mão de obra ${money(laborCost)} · fixos ${money(fixedCost)}\nCusto diário ${money(dailyCost)} · arrecadação ${money(revenue)} · resultado ${money(profit)}\nTarifa de equilíbrio por pagante: ${breakEven===null?'não calculada':money(breakEven)}\nAlternativas: ${x.alternatives.map(a=>`${a.model} prefixo ${a.prefix}`).join('; ')||'Nenhuma alternativa disponível'}\nValores simulados; capacidades/consumo são estimativas e não garantias de operação.`;
  ownerScalePreview=x;return x;
}
$('#ownerScaleForm').addEventListener('input',()=>{if(ownerScalePreview){ownerScalePreview=null;latestScaleText='';$('#ownerScaleResults').hidden=true;}});
$('#ownerScaleForm').addEventListener('submit',event=>{event.preventDefault();if(!assertOwner())return;calculateOwnerScale();});
$('#ownerSaveScale').addEventListener('click',()=>{if(!assertOwner()||!ownerScalePreview){showToast('Analise a linha antes de salvar a escala.');return;}const x={...ownerScalePreview,id:makeId(),createdAt:new Date().toISOString()};const rows=ownerScales();rows.push(x);if(!writeArrayKey(OWNER_SCALE_KEY,rows))return;ownerScalePreview=x;renderOwnerScales();refreshOperationChoices();renderOwnerFleet();showToast(`Escala salva: ${x.model} prefixo ${x.prefix} para ${x.line} em ${localDate(x.date)}.`);});
$('#ownerCopyScale').addEventListener('click',async()=>{if(!latestScaleText){showToast('Analise uma escala antes de copiar.');return;}showToast(await copyText(latestScaleText)?'Escala e justificativa copiadas.':'Não foi possível copiar automaticamente.');});
function renderOwnerScales(){const rows=ownerScales();$('#ownerScaleList').innerHTML=rows.length?rows.slice().reverse().map(x=>recordItem(`${localDate(x.date)} · ${WEEKDAY_LABELS[x.weekday]||x.weekday} · ${x.company} · ${x.line}`,`${x.model||'Modelo antigo'} · prefixo ${x.prefix||'—'} · ${x.tripsDay} viagens/dia · ${x.passengers} passageiros/viagem · resultado ${money(x.profit)}`,'data-owner-scale-delete',x.id)).join(''):recordsEmpty('Nenhuma escala salva. Informe o dia, linha e demanda; o sistema vai recomendar o ônibus e depois guardar essa referência para o histórico.');}
$('#ownerScaleList').addEventListener('click',event=>{const b=event.target.closest('[data-owner-scale-delete]');if(!b)return;if(!assertOwner())return;if(!window.confirm('Excluir esta escala? Ela deixará de compor o perfil histórico e liberar o prefixo para outra escala nessa data.'))return;writeArrayKey(OWNER_SCALE_KEY,ownerScales().filter(x=>x.id!==b.dataset.ownerScaleDelete));renderOwnerScales();refreshOperationChoices();suggestDemandFromHistory();renderOwnerFleet();showToast('Escala excluída.');});

// Contratos municipais simulados: a prefeitura apresenta proposta e pode recusar a contraproposta.
let currentOwnerContractText='';
let currentOwnerContract=null;
$('#ocStartDate').value=dateTodayLocal();
function renderOwnerContractHistory(){
  const el=$('#ownerContractHistory');if(!el)return;const rows=ownerContracts();
  el.innerHTML=rows.length?rows.slice().reverse().map(x=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(x.city)} · ${escapeHtml(x.line)}</strong><small>${escapeHtml(x.company)} · aceita em ${escapeHtml(displayDateValue(x.acceptedAt||x.createdAt||dateTodayLocal()))}\nValor mensal aceito: ${money(Number(x.offer||0))} · custo estimado: ${money(Number(x.totalCost||0))} · resultado: ${money(Number(x.profit||0))}</small><span class="record-inline-tag">Contrato aceito na simulação</span></div><button class="record-danger" type="button" data-owner-contract-delete="${escapeHtml(x.id)}">Excluir</button></div></article>`).join(''):recordsEmpty('Nenhuma proposta aceita ainda. Solicite uma proposta à prefeitura e aceite quando fizer sentido no cenário.');
}
$('#ownerContractHistory').addEventListener('click',event=>{const b=event.target.closest('[data-owner-contract-delete]');if(!b)return;if(!assertOwner())return;if(!window.confirm('Excluir este registro de contrato aceito?'))return;writeArrayKey(OWNER_CONTRACTS_KEY,ownerContracts().filter(x=>x.id!==b.dataset.ownerContractDelete));renderOwnerContractHistory();showToast('Registro de contrato removido do histórico.');});
function updateContractProposalText(){
  if(!currentOwnerContract)return;
  const c=currentOwnerContract;
  currentOwnerContractText=[`GRUPO CONECT — PROPOSTA MUNICIPAL (SIMULAÇÃO)`,`Data: ${new Date().toLocaleDateString('pt-BR')}`,`Município: ${c.city}`,`Empresa: ${c.company}`,`Linha/lote: ${c.line}`,`Tipo da rota: ${c.serviceType}`,`Vigência sugerida: ${localDate(c.start)}`,`Situação: ${c.status}`,``,`PROPOSTA DA PREFEITURA`,`Valor mensal oferecido: ${money(c.offer)}`,`Pedido de aumento: ${c.counterPercent?`+${c.counterPercent}% (${money(c.counterOffer)})`:'não solicitado'}`,``,`RESUMO OPERACIONAL`,`Frota estimada: ${c.buses} ônibus · ${c.trips} viagens/ônibus/dia · ${c.days} dias por mês`,`Percurso completo: ${numberPt(c.km,1)} km · total mensal estimado ${numberPt(c.monthlyKm,1)} km`,`Consumo: ${numberPt(c.kmpl,2)} km/L · diesel ${money(c.diesel)}/L`,`Custo mensal estimado: ${money(c.totalCost)}`,`Resultado com a proposta atual: ${money(c.offer-c.totalCost)}`,`Referência calculada antes da negociação: ${money(c.referenceRevenue)}`,``,`Esta proposta é gerada por regras aleatórias e custos informados no simulador do Grupo Conect. Não é proposta pública real, licitação, contrato jurídico, tarifa oficial ou garantia de aceitação.`].join('\n');
  $('#ownerContractText').textContent=currentOwnerContractText;$('#ownerContractText').hidden=false;
}
function refreshContractStats(){
  const c=currentOwnerContract;if(!c)return;
  const profit=c.offer-c.totalCost;
  $('#ownerContractStats').innerHTML=[['Oferta mensal da prefeitura',money(c.offer)],['Custo mensal estimado',money(c.totalCost)],['Saldo projetado',money(profit)],['Margem sobre a oferta',c.offer>0?`${numberPt(profit/c.offer*100,1)}%`:'—']].map(([l,val])=>moneyStat(l,val,l==='Saldo projetado'?(profit>=0?'positive':'negative'):'' )).join('');
  $('#ownerContractNote').textContent=`A prefeitura de ${c.city} apresentou uma proposta simulada para ${c.line}. A oferta está ${c.offer>=c.totalCost?'acima':'abaixo'} do custo mensal estimado em ${money(Math.abs(c.offer-c.totalCost))}. Confira os números antes de aceitar.`;
  $('#ownerContractNegotiationNote').textContent=c.statusMessage||'Escolha aceitar a proposta ou solicitar um aumento. Se pedir aumento, a prefeitura pode aceitar ou recusar dependendo do percentual e do orçamento simulado.';
  $('#ownerContractAccept').disabled=c.accepted===true;
  $('#ownerContractAccept').textContent=c.accepted?'Proposta já aceita':'Aceitar proposta';
  $('#ownerContractIncrease').disabled=c.accepted===true||c.hasCountered===true;
  updateContractProposalText();
}
$('#ownerContractForm').addEventListener('submit',event=>{
  event.preventDefault();if(!assertOwner())return;
  const v=id=>String($('#'+id).value||'').trim(),n=id=>readToolValue(id);
  const city=v('ocCity'),company=v('ocCompany'),line=v('ocLine'),start=v('ocStartDate'),km=n('ocKmTrip'),trips=n('ocTripsDay'),days=n('ocDaysMonth'),buses=n('ocBuses'),kmpl=n('ocKmpl'),diesel=n('ocDiesel'),rate=n('ocRateKm'),payers=n('ocPayersTrip'),fare=n('ocFare'),free=n('ocGratuities'),maint=n('ocMaintKm'),labor=n('ocLaborHour'),minutes=n('ocMinutesTrip'),fixed=n('ocFixedBus'),admin=n('ocAdminPercent'),freeComp=n('ocFreeComp'),model=v('ocModel');
  if(!city||!company||!line||!start||[km,trips,days,buses,kmpl,diesel,rate,payers,fare,free,maint,labor,minutes,fixed,admin,freeComp].some(x=>x===null)||km<=0||trips<1||days<1||buses<1||kmpl<=0||diesel<=0||payers<0||free<0){showToast('Confira a cidade, linha e todos os dados de custo e operação.');return;}
  const monthlyKm=km*trips*days*buses,liters=monthlyKm/kmpl,fuel=liters*diesel,maintenance=monthlyKm*maint,laborCost=(minutes/60)*trips*days*buses*labor,fixedCost=fixed*buses,baseCost=fuel+maintenance+laborCost+fixedCost,adminCost=baseCost*admin/100,totalCost=baseCost+adminCost;
  const referenceRevenue=model==='km'?monthlyKm*rate:(payers*fare*trips*days*buses)+(free*freeComp*trips*days*buses);
  const route=findRegisteredRoute(city,line),serviceType=route?.serviceType||(/\brj\s*[×x]/i.test(line)?'Interestadual':'Municipal');
  // A cidade cadastrada, o tipo do serviço e a presença da rota no cadastro alteram a faixa-base da oferta.
  // A prefeitura ainda começa abaixo/ao redor da remuneração de referência e pode recusar contrapropostas.
  const cityFactor=/rio de janeiro|niter[oó]i|nova iguaçu/i.test(city)?1.03:/petr[oó]polis|nova friburgo|juiz de fora|resende/i.test(city)?1.01:0.98;
  const serviceFactor=serviceType==='Interestadual'?1.04:serviceType==='Intermunicipal'?1.025:serviceType==='Municipal e intermunicipal'?1.015:0.99;
  const routeFactor=route?1.02:0.95;
  const offer=Math.max(0,Math.round(referenceRevenue*(0.86+Math.random()*0.15)*cityFactor*serviceFactor*routeFactor*100)/100);
  currentOwnerContract={id:makeId(),city,company,line,start,km,trips,days,buses,kmpl,diesel,rate,payers,fare,free,maint,labor,minutes,fixed,admin,freeComp,model,monthlyKm,totalCost,referenceRevenue,offer,initialOffer:offer,counterPercent:0,counterOffer:0,hasCountered:false,accepted:false,serviceType,routeRegistered:Boolean(route),createdAt:new Date().toISOString(),status:'Proposta inicial',statusMessage:`A prefeitura de ${city} apresentou ${money(offer)} por mês. A oferta foi simulada com base na remuneração de referência e no município/serviço selecionado.`};
  $('#ownerContractResults').hidden=false;refreshContractStats();showToast('Proposta municipal simulada recebida. Agora você pode aceitar ou negociar um aumento.');
});
$('#ownerContractForm').addEventListener('input',()=>{if(currentOwnerContract){currentOwnerContract=null;currentOwnerContractText='';$('#ownerContractResults').hidden=true;}});
$('#ownerContractIncrease').addEventListener('click',()=>{
  if(!assertOwner()||!currentOwnerContract||currentOwnerContract.accepted)return;
  if(currentOwnerContract.hasCountered){showToast('Esta proposta já teve uma contraproposta. Gere uma nova proposta para negociar novamente.');return;}
  const c=currentOwnerContract,pct=Number($('#ocIncreasePercent').value)||8;let chance=68-(pct*2.5);
  if(c.offer<c.totalCost)chance+=10;else if(c.offer>=c.totalCost*1.25)chance-=8;
  if(c.routeRegistered)chance+=3;else chance-=3;
  chance=Math.max(8,Math.min(78,Math.round(chance)));
  c.counterPercent=pct;c.counterOffer=Math.round(c.offer*(1+pct/100)*100)/100;c.hasCountered=true;
  if(Math.random()*100<chance){c.offer=c.counterOffer;c.status='Contraproposta aceita';c.statusMessage=`A prefeitura aceitou o aumento de ${pct}% (chance simulada de aceitação: ${chance}%). Nova proposta: ${money(c.offer)}/mês. Você ainda precisa tocar em “Aceitar proposta” para fechar o contrato no cenário.`;}
  else{c.status='Aumento recusado';c.statusMessage=`A prefeitura recusou o aumento de ${pct}% (chance simulada de aceitação: ${chance}%). A oferta original de ${money(c.initialOffer)}/mês continua disponível para você aceitar; para tentar de novo, solicite uma nova proposta.`;}
  refreshContractStats();showToast(c.status==='Contraproposta aceita'?'A prefeitura aceitou a contraproposta!':'A prefeitura recusou o aumento. A proposta original continua disponível.');
});
$('#ownerContractAccept').addEventListener('click',()=>{
  if(!assertOwner()||!currentOwnerContract||currentOwnerContract.accepted){if(!currentOwnerContract)showToast('Solicite uma proposta antes de aceitar.');return;}
  const c=currentOwnerContract;const record={...c,accepted:true,status:'Contrato aceito',acceptedAt:new Date().toISOString(),profit:c.offer-c.totalCost};
  const rows=ownerContracts();rows.push(record);if(!writeArrayKey(OWNER_CONTRACTS_KEY,rows))return;
  currentOwnerContract.accepted=true;currentOwnerContract.status='Contrato aceito';currentOwnerContract.statusMessage=`Contrato aceito no simulador por ${money(c.offer)}/mês. Resultado projetado após custo estimado: ${money(c.offer-c.totalCost)}. Registro salvo no histórico local.`;
  renderOwnerContractHistory();refreshContractStats();showToast('Proposta aceita e contrato salvo no histórico do cenário.');
});
$('#ownerCopyContract').addEventListener('click',async()=>{if(!assertOwner()||!currentOwnerContract)return;showToast(await copyText(currentOwnerContractText)?'Proposta copiada.':'Não foi possível copiar automaticamente.');});
$('#ownerDownloadContract').addEventListener('click',()=>{if(!assertOwner()||!currentOwnerContract)return;downloadTextFile('grupo-conect-proposta-municipal.txt',currentOwnerContractText);});
$('#ownerPrintContract').addEventListener('click',()=>{if(!assertOwner()||!currentOwnerContract)return;const w=window.open('','_blank','width=900,height=700');if(!w){showToast('Permita pop-ups para imprimir ou salvar em PDF.');return;}w.opener=null;w.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Proposta municipal Grupo Conect</title><style>body{font:13px Arial;line-height:1.65;margin:25mm;color:#203040}pre{white-space:pre-wrap;font:inherit}h1{color:#14786b}@media print{button{display:none}}</style><h1>Grupo Conect</h1><button onclick="window.print()">Imprimir / Salvar PDF</button><pre>${escapeHtml(currentOwnerContractText)}</pre></html>`);w.document.close();});

// Visualizador de Operação com roster de motoristas virtuais e 10% de chance de ocorrência.
const INCIDENT_RESPONSES={
 acidente:['Parar em local seguro antes da área afetada e comunicar a central.','Manter passageiros protegidos e aguardar instruções das autoridades/central.','Usar apenas desvio oficial autorizado pela operação.','Registrar ponto e horário e aguardar liberação segura da via.','Se houver risco ou feridos, acionar os serviços de emergência e não avançar pela área insegura.'],
 obra:['Seguir sinalização temporária e o desvio autorizado para a linha.','Reduzir a velocidade e respeitar as orientações da obra.','Parar em local seguro e pedir instrução à central se não houver desvio claro.','Registrar o atraso e comunicar a previsão atualizada aos passageiros.','Retomar o itinerário original somente quando a via estiver liberada e segura.'],
 mecanica:['Encostar em local seguro, sinalizar e comunicar a central/manutenção.','Não tentar reparo no meio do tráfego; solicitar equipe de apoio.','Solicitar veículo reserva e organizar a transferência conforme procedimento da operação.','Registrar a pane, local, horário e sintomas para a equipe técnica.','Manter a linha parada até o veículo ser avaliado e liberado.'],
 transito:['Manter-se em rota aprovada e informar a central sobre o atraso.','Solicitar à central um desvio previamente autorizado.','Aguardar se não existir uma rota alternativa segura e autorizada.','Atualizar a previsão de chegada sem prometer horário não confirmado.','Reprogramar as partidas seguintes no simulador para recuperar o intervalo.'],
 clima:['Não entrar em trecho alagado; parar em local seguro e pedir orientação.','Aguardar avaliação ou liberação oficial se a via estiver perigosa.','Informar a central e registrar o ponto afetado.','Usar somente alternativa previamente aprovada e segura.','Retomar o trajeto quando as condições estiverem liberadas e seguras.']
};
const INCIDENT_LABELS={acidente:'Acidente / via bloqueada',obra:'Obra na rua',mecanica:'Falha mecânica do ônibus',transito:'Trânsito intenso / congestionamento',clima:'Alagamento / condição climática'};
function driverCounts(){return readObjectKey(DRIVER_COUNT_KEY);}
function driverRoster(company){const count=Math.max(3,Math.min(60,Number(driverCounts()[company]||12)));const base=['Pablo','Kaio','Treinamento'];const items=[];for(let i=0;i<count;i++)items.push(i<base.length?base[i]:`Motorista ${String(i+1).padStart(2,'0')} · ${company}`);return items;}
function refreshNormalTripDrivers(){const select=$('#driverSelect'),company=$('#companySelect')?.value||'Progresso';if(!select)return;const previous=select.value;const options=typeof driverRoster==='function'?driverRoster(company):['Pablo','Treinamento','Kaio'];populateSelect(select,'Escolha o motorista',options);if(options.includes(previous))select.value=previous;}
function populateShiftDrivers(preserve=true){const company=$('#ovCompany').value||'Progresso';const rows=driverRoster(company);['ovMorningDriver','ovAfternoonDriver','ovNightDriver'].forEach((id,idx)=>{const el=$('#'+id),old=preserve?el.value:'';populateSelect(el,'Selecione motorista',rows);if(rows.includes(old))el.value=old;else el.selectedIndex=idx<rows.length?idx+1:0;});$('#ovDriverCount').value=driverCounts()[company]||12;$('#ovDriverCountNote').textContent=`${driverRoster(company).length} motorista(s) virtual(is) disponíveis para ${company}.`;
}
function uniqueVehicleOptions(){const out=[];const seen=new Set();const add=x=>{if(!x)return;const key=`${norm(x.company)}|${norm(x.prefix)}|${norm(x.model)}`;if(seen.has(key))return;seen.add(key);out.push({company:x.company||'',prefix:x.prefix||'',model:x.model||'',chassis:x.chassis||'',city:x.city||'',line:x.line||'',duration:x.minutes||x.duration||60,weekday:x.weekday||''});};ownerFleet().forEach(add);ownerScales().forEach(add);FLEET.forEach(m=>m.prefixes.forEach(prefix=>add({company:m.company,prefix,model:m.model,chassis:m.chassis||'A selecionar',city:'',line:'',duration:60,service:m.service||'A definir'})));return out;}
function refreshOperationChoices(){
  if(!$('#ovScalePick'))return;
  const scales=ownerScales();$('#ovScalePick').innerHTML='<option value="">Escolher escala salva...</option>'+scales.slice().reverse().map(x=>`<option value="scale:${escapeHtml(x.id)}">${escapeHtml(WEEKDAY_LABELS[x.weekday]||x.weekday)} · ${escapeHtml(x.company)} · ${escapeHtml(x.line)} · ${escapeHtml(x.prefix)}</option>`).join('')+ownerFleet().map(x=>`<option value="fleet:${escapeHtml(x.id)}">Frota · ${escapeHtml(x.company)} · ${escapeHtml(x.prefix)} · ${escapeHtml(x.model)}</option>`).join('');
  const currentCompany=$('#ovCompany').value||'Progresso';
  const companyBuses=uniqueVehicleOptions().filter(x=>norm(x.company)===norm(currentCompany));
  const allModels=[...new Set(companyBuses.map(x=>x.model).filter(Boolean))];
  populateSelect($('#ovBus'),allModels.length?'Selecione ônibus cadastrado':'Nenhum ônibus cadastrado para esta empresa',allModels);
  $('#ovBus').disabled=!allModels.length;
  updateOperationPrefixOptions();
  populateShiftDrivers();
}
function updateOperationPrefixOptions(){
  const company=$('#ovCompany')?.value||'Progresso', model=$('#ovBus')?.value||'';
  const rows=uniqueVehicleOptions().filter(x=>norm(x.company)===norm(company)&&norm(x.model)===norm(model));
  const prefixes=[...new Set(rows.map(x=>String(x.prefix)).filter(Boolean))];
  const list=$('#gcPrefixes'); if(list)list.innerHTML=prefixes.map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
  if(prefixes.length===1 && !$('#ovPrefix').value)$('#ovPrefix').value=prefixes[0];
  if(prefixes.length && !prefixes.includes($('#ovPrefix').value)) $('#ovPrefix').value=prefixes.length===1?prefixes[0]:'';
}
$('#ovScalePick').addEventListener('change',()=>{
  const val=$('#ovScalePick').value;if(!val)return;const [kind,id]=val.split(':');let x=kind==='scale'?ownerScales().find(r=>r.id===id):ownerFleet().find(r=>r.id===id);if(!x)return;
  $('#ovCompany').value=x.company||'Progresso';refreshOperationChoices();if(x.model)$('#ovBus').value=x.model;$('#ovPrefix').value=x.prefix||'';$('#ovCity').value=x.city||'';$('#ovLine').value=x.line||'';$('#ovDuration').value=x.minutes||60;if(x.weekday)$('#ovWeekday').value=WEEKDAY_LABELS[x.weekday]||x.weekday;showToast('Dados da escala/frota carregados. Revise e complete os campos da operação.');
});
$('#ovCompany').addEventListener('change',refreshOperationChoices);
$('#ovBus').addEventListener('change',()=>{ $('#ovPrefix').value=''; updateOperationPrefixOptions(); });
$('#ovApplyDriverCount').addEventListener('click',()=>{if(!assertOwner())return;const company=$('#ovCompany').value,count=readToolValue('ovDriverCount');if(!company||count===null||!Number.isInteger(count)||count<3||count>60){showToast('Informe de 3 a 60 motoristas virtuais para a empresa.');return;}const counts=driverCounts();counts[company]=count;if(!writeObjectKey(DRIVER_COUNT_KEY,counts))return;populateShiftDrivers(false);showToast(`Roster de ${count} motorista(s) atualizado para ${company}.`);});
function opVehicleCompany(op){return String(op?.vehicleCompany||op?.company||'');}
function operationIsRunning(op){return op.status==='operando'||op.status==='operando com desvio';}
function opSwapTrafficEstimate(){const n=Math.random();if(n<.18)return {label:'Livre',minutes:22};if(n<.78)return {label:'Moderado',minutes:25};if(n<.96)return {label:'Intenso',minutes:32};return {label:'Muito intenso',minutes:40};}
function opSwapVehicleAvailability(company,prefix,operationId=''){
  const vehicle=typeof gcGarageVehicles==='function'?gcGarageVehicles().find(v=>norm(v.company)===norm(company)&&String(v.prefix)===String(prefix)):uniqueVehicleOptions().find(v=>norm(v.company)===norm(company)&&String(v.prefix)===String(prefix));
  if(!vehicle)return {ok:false,reason:'O ônibus não foi encontrado na frota cadastrada.'};
  const key=typeof gcGarageKey==='function'?gcGarageKey(vehicle):`${norm(company)}|${norm(prefix)}`;
  const assigned=ownerOperations().some(row=>row.id!==operationId&&(
    (typeof gcGarageKey==='function'?gcGarageKey({company:opVehicleCompany(row),prefix:row.prefix}):`${norm(opVehicleCompany(row))}|${norm(row.prefix)}`)===key ||
    (row.pendingVehicleSwap&&norm(row.pendingVehicleSwap.replacementCompany)===norm(company)&&String(row.pendingVehicleSwap.replacementPrefix)===String(prefix)) ||
    (row.replacementDispatch&&norm(row.replacementDispatch.replacementCompany||opVehicleCompany(row))===norm(company)&&String(row.replacementDispatch.replacementPrefix)===String(prefix))
  ));
  if(assigned)return {ok:false,reason:'Este ônibus já está vinculado ou reservado para outra linha/operação.'};
  const state=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(vehicle):null;
  if(state?.blocked)return {ok:false,reason:`Ônibus retido pela oficina: ${state.blockedReason||'restrição mecânica'}.`};
  if(typeof gcGarageAlerts==='function'&&gcGarageAlerts().some(a=>!a.resolvedAt&&a.vehicleKey===key))return {ok:false,reason:'O ônibus possui uma pane mecânica aberta.'};
  if(typeof gcGarageOrders==='function'&&gcGarageOrders().some(o=>o.vehicleKey===key&&!['Aprovada','Cancelada'].includes(o.status)))return {ok:false,reason:'O ônibus possui uma ordem de serviço pendente.'};
  if(state&&typeof gcGarageCondition==='function'&&gcGarageCondition(state)<45)return {ok:false,reason:'A condição mecânica está abaixo de 45%; selecione um ônibus em melhores condições.'};
  return {ok:true,vehicle,state,key};
}
function opApplyPendingVehicleSwap(op,now=Date.now()){
  const pending=op?.pendingVehicleSwap;if(!pending||!pending.busAtTerminal||now<Number(pending.arrivesAtMs||0))return false;
  const available=opSwapVehicleAvailability(pending.replacementCompany,pending.replacementPrefix,op.id);
  if(!available.ok){
    const prior=pending.priorStatus||'operando';op.lastVehicleSwapFailure={...pending,failedAt:new Date(now).toISOString(),failureReason:available.reason};op.pendingVehicleSwap=null;
    op.status=prior==='pausada'?'pausada':(prior==='operando com desvio'&&op.gcIncidentActive?.effect==='detour'?'operando com desvio':'operando');
    op.clockAnchorAt=operationIsRunning(op)?now:null;op.lastEvent=`Troca cancelada no terminal: ${available.reason} O ônibus atual permaneceu na linha.`;return true;
  }
  const old={company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||'',chassis:op.chassis||''};
  const replacement=available.vehicle;
  // Se o ônibus antigo sofrer pane justamente ao concluir o percurso, sua
  // ocorrência continua vinculada à ficha dele, mas não pode bloquear o reserva.
  if(typeof gcGarageAlerts==='function'&&typeof gcGarageWrite==='function'){
    const alerts=gcGarageAlerts(),oldKey=typeof gcGarageKey==='function'?gcGarageKey(old):`${norm(old.company)}|${norm(old.prefix)}`;
    let detached=false;
    alerts.forEach(a=>{if(!a.resolvedAt&&a.operationId===op.id&&a.vehicleKey===oldKey){a.previousOperationId=op.id;a.operationId='';a.detachedAt=new Date(now).toISOString();a.resolutionNote='Veículo retirado desta operação após troca no terminal; ocorrência permanece aberta para reparo individual.';detached=true;}});
    if(detached)gcGarageWrite(GC_GARAGE_ALERTS_KEY,alerts);
  }
  op.breakdownId='';
  op.vehicleCompany=replacement.company;op.prefix=String(replacement.prefix);op.busModel=replacement.model;op.chassis=replacement.chassis||'';
  op.vehicleChangeHistory=Array.isArray(op.vehicleChangeHistory)?op.vehicleChangeHistory:[];
  op.vehicleChangeHistory.push({id:makeId(),requestedAt:pending.requestedAt,completedAt:new Date(now).toISOString(),oldVehicle:old,newVehicle:{company:replacement.company,prefix:String(replacement.prefix),model:replacement.model,chassis:replacement.chassis||''},terminal:pending.terminal,trafficLabel:pending.trafficLabel,dispatchMinutes:pending.durationMinutes});
  if(op.vehicleChangeHistory.length>100)op.vehicleChangeHistory=op.vehicleChangeHistory.slice(-100);
  op.pendingVehicleSwap=null;
  const prior=pending.priorStatus||'operando';
  op.status=prior==='pausada'?'pausada':(prior==='operando com desvio'&&op.gcIncidentActive?.effect==='detour'?'operando com desvio':'operando');
  op.clockAnchorAt=operationIsRunning(op)?now:null;
  op.gcFuelPreparedTrip=0;
  if(typeof gcGaragePreTripEvent==='function')op.garagePreTripEventId=gcGaragePreTripEvent(replacement,op.line,'troca programada',`${op.id}-terminal-swap-${pending.id}`);
  op.lastEvent=`Troca concluída no ${pending.terminal}: ${old.prefix} substituído por ${replacement.prefix}. Próxima partida liberada após conferência pré-operacional e abastecimento.`;
  return true;
}
function opParseTime(value){const m=String(value||'06:00').match(/^(\d{1,2}):(\d{2})$/);return m?((Number(m[1])*60+Number(m[2]))%1440):360;}
function opFormatTime(minute){const m=((Math.floor(Number(minute)||0)%1440)+1440)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
function opFormatCountdown(seconds){const value=Math.max(0,Math.ceil(Number(seconds)||0));const m=Math.floor(value/60),s=value%60;return m?`${m} min ${String(s).padStart(2,'0')} s`:`${s} s`;}
function opShiftKey(minute){const m=((Math.floor(Number(minute)||0)%1440)+1440)%1440;return m>=300&&m<720?'morning':m>=720&&m<1080?'afternoon':'night';}
function opShiftLabel(key){return key==='morning'?'manhã':key==='afternoon'?'tarde':'noite';}
const OP_SERVICE_OPEN_MINUTE=5*60;
const OP_SERVICE_CLOSE_MINUTE=23*60;
const OP_DAY_MINUTES=24*60;
function opMinuteOfDay(absMinute){return ((Math.floor(Number(absMinute)||0)%OP_DAY_MINUTES)+OP_DAY_MINUTES)%OP_DAY_MINUTES;}
function opIsServiceOpen(absMinute){const m=opMinuteOfDay(absMinute);return m>=OP_SERVICE_OPEN_MINUTE&&m<OP_SERVICE_CLOSE_MINUTE;}
function opNextOpenAtOrAfter(absMinute){
  const value=Math.max(0,Number(absMinute)||0),day=Math.floor(value/OP_DAY_MINUTES),minute=value-day*OP_DAY_MINUTES;
  if(minute<OP_SERVICE_OPEN_MINUTE)return day*OP_DAY_MINUTES+OP_SERVICE_OPEN_MINUTE;
  if(minute>=OP_SERVICE_CLOSE_MINUTE)return (day+1)*OP_DAY_MINUTES+OP_SERVICE_OPEN_MINUTE;
  return value;
}
function opNextDepartureAfterTrip(startAbs,durationMinutes){return opNextOpenAtOrAfter(Number(startAbs)+Math.max(1,Number(durationMinutes)||60));}
function opTripScheduleAt(op,tripIndex){
  const duration=Math.max(1,Number(op.duration)||60);
  const baseCount=Number.isFinite(Number(op.scheduleBaseTripCount))?Math.max(0,Number(op.scheduleBaseTripCount)):0;
  let start=Number.isFinite(Number(op.scheduleBaseStartAbs))?Number(op.scheduleBaseStartAbs):opParseTime(op.startTime);
  const count=Math.max(0,Math.floor(Number(tripIndex)||0)-baseCount);
  for(let i=0;i<count;i++)start=opNextDepartureAfterTrip(start,duration);
  return {start,end:start+duration};
}
function opElapsedSeconds(op,now=Date.now()){
  const saved=Math.max(0,Number(op.elapsedSeconds)||0);
  if(operationIsRunning(op)&&Number(op.clockAnchorAt)>0){const speed=Math.max(1,Number(op.speedMultiplier)||1);return saved+Math.max(0,now-Number(op.clockAnchorAt))/1000*speed;}
  return saved;
}
function freezeOperationClock(op,now=Date.now()){
  op.elapsedSeconds=opElapsedSeconds(op,now);op.clockAnchorAt=null;
}
function operationRouteHistory(company,city,line){
  const c=profitMatchKey(company),ct=profitMatchKey(city),l=profitMatchKey(line);
  return loadHistory().filter(t=>t.company&&t.city&&t.line&&profitMatchKey(t.company)===c&&profitMatchKey(t.city)===ct&&profitMatchKey(t.line)===l);
}
function operationEconomics(company,city,line,fallbackPayers=30,fallbackFare=5.5,fallbackFuelCost=35){
  const matches=operationRouteHistory(company,city,line);
  if(matches.length){
    const sum=matches.reduce((a,t)=>({revenue:a.revenue+(Number(t.revenue)||0),fuelCost:a.fuelCost+(Number(t.fuelCost)||0),net:a.net+historicalTripNet(t)}),{revenue:0,fuelCost:0,net:0});
    return {basis:'histórico das linhas normais',sampleCount:matches.length,unitRevenue:sum.revenue/matches.length,unitFuelCost:sum.fuelCost/matches.length,unitNet:sum.net/matches.length};
  }
  const revenue=Math.max(0,Number(fallbackPayers)||0)*Math.max(0,Number(fallbackFare)||0),fuel=Math.max(0,Number(fallbackFuelCost)||0);
  return {basis:'estimativa manual (sem histórico compatível)',sampleCount:0,unitRevenue:revenue,unitFuelCost:fuel,unitNet:revenue-fuel};
}
function opDriverForTrip(op,tripIndex,startAbsOverride){
  const duration=Math.max(1,Number(op.duration)||60),schedule=Number.isFinite(Number(startAbsOverride))?{start:Number(startAbsOverride),end:Number(startAbsOverride)+duration}:opTripScheduleAt(op,tripIndex);
  const shift=opShiftKey(schedule.start),name=String(op.drivers?.[shift]||op.drivers?.morning||'Motorista não definido');
  return {name,shift,simStart:opFormatTime(schedule.start),simEnd:opFormatTime(schedule.end),startAbs:schedule.start,endAbs:schedule.end};
}
function opEnsureSimulation(op,now=Date.now()){
  let changed=false;
  if(!Number.isFinite(Number(op.completedTrips))){op.completedTrips=0;changed=true;}
  if(!Number.isFinite(Number(op.elapsedSeconds))){op.elapsedSeconds=0;changed=true;}
  if(!Array.isArray(op.tripLog)){op.tripLog=[];changed=true;}
  if(!op.driverTotals||typeof op.driverTotals!=='object'){op.driverTotals={};changed=true;}
  if(!Number.isFinite(Number(op.speedMultiplier))||Number(op.speedMultiplier)<1){op.speedMultiplier=10;changed=true;}
  if(!op.unitEconomics){op.unitEconomics=operationEconomics(op.company,op.city,op.line);changed=true;}
  // Upgrade existing running lines into the 05:00–23:00 daily departure cycle without erasing saved profits.
  if(Number(op.scheduleVersion)!==2||!Number.isFinite(Number(op.scheduleBaseStartAbs))||!Number.isFinite(Number(op.scheduleBaseTripCount))){
    const already=Math.max(0,Number(op.completedTrips)||0),elapsed=opElapsedSeconds(op,now),duration=Math.max(1,Number(op.duration)||60),currentAbs=opParseTime(op.startTime)+elapsed/60,within=(elapsed/60)%duration;
    op.scheduleVersion=2;op.scheduleBaseTripCount=already;
    op.scheduleBaseStartAbs=within>0.001?currentAbs-within:opNextOpenAtOrAfter(currentAbs);
    changed=true;
  }
  if(operationIsRunning(op)&&!(Number(op.clockAnchorAt)>0)){op.clockAnchorAt=now;changed=true;}
  if(!operationIsRunning(op)&&op.clockAnchorAt){op.elapsedSeconds=opElapsedSeconds(op,now);op.clockAnchorAt=null;changed=true;}
  return changed;
}
function syncOneOperationProgress(op,now=Date.now()){
  let changed=opEnsureSimulation(op,now);
  if(!operationIsRunning(op))return changed;
  const duration=Math.max(1,Number(op.duration)||60),elapsed=opElapsedSeconds(op,now),virtualNow=opParseTime(op.startTime)+elapsed/60;
  const already=Math.max(0,Number(op.completedTrips)||0),speed=Math.max(1,Number(op.speedMultiplier)||1),econ=op.unitEconomics||operationEconomics(op.company,op.city,op.line);
  let idx=already,schedule=opTripScheduleAt(op,idx),processed=0,terminalSwapCompleted=false;
  while(schedule.end<=virtualNow&&processed<5000){
    const driver=opDriverForTrip(op,idx,schedule.start),revenue=Number(econ.unitRevenue)||0,fuelCost=Number(econ.unitFuelCost)||0,net=Number(econ.unitNet??(revenue-fuelCost));
    const driverKey=driver.name;
    if(!op.driverTotals[driverKey])op.driverTotals[driverKey]={name:driver.name,trips:0,revenue:0,fuelCost:0,net:0};
    const dt=op.driverTotals[driverKey];dt.trips+=1;dt.revenue+=revenue;dt.fuelCost+=fuelCost;dt.net+=net;
    const lateSimSeconds=Math.max(0,(virtualNow-schedule.end)*60);
    const completedAt=new Date(Math.max(0,now-(lateSimSeconds/speed)*1000)).toISOString();
    op.tripLog.push({id:makeId(),tripNumber:idx+1,driver:driver.name,shift:driver.shift,simStart:driver.simStart,simEnd:driver.simEnd,completedAt,revenue,fuelCost,net,basis:econ.basis,vehicleCompany:opVehicleCompany(op),prefix:String(op.prefix||''),busModel:op.busModel||'',chassis:op.chassis||''});
    idx++;processed++;const completedEnd=schedule.end,nextStart=opNextDepartureAfterTrip(schedule.start,duration);schedule={start:nextStart,end:nextStart+duration};
    if(op.pendingVehicleSwap&&idx>=Number(op.pendingVehicleSwap.applyAfterTrip||Infinity)){
      op.pendingVehicleSwap.busAtTerminal=true;op.pendingVehicleSwap.busAtTerminalAt=new Date(now).toISOString();op.pendingVehicleSwap.terminal=op.pendingVehicleSwap.terminal||((Number(op.pendingVehicleSwap.applyAfterTrip||1)%2===1)?'Terminal de destino':'Terminal de origem');
      // O ônibus atual concluiu o percurso. Congelamos exatamente no terminal para
      // que ele não inicie outra viagem enquanto o substituto ainda está a caminho.
      op.elapsedSeconds=Math.max(0,(completedEnd-opParseTime(op.startTime))*60);op.clockAnchorAt=null;op.status='aguardando substituição no terminal';
      op.completedTrips=idx;
      if(now>=Number(op.pendingVehicleSwap.arrivesAtMs||Infinity)){
        op.scheduleBaseTripCount=idx;op.scheduleBaseStartAbs=schedule.start;
        terminalSwapCompleted=opApplyPendingVehicleSwap(op,now)||false;
      }else{op.scheduleBaseTripCount=idx;op.scheduleBaseStartAbs=schedule.start;break;}
    }
  }
  if(processed){
    op.completedTrips=idx;
    // Rebase at the next scheduled trip so the repeating daily cycle remains lightweight over long simulations.
    op.scheduleBaseTripCount=idx;
    op.scheduleBaseStartAbs=schedule.start;
    if(op.tripLog.length>250)op.tripLog=op.tripLog.slice(-250);
    op.lastTripCompletedAt=op.tripLog.length?op.tripLog[op.tripLog.length-1].completedAt:op.lastTripCompletedAt;
    if(!terminalSwapCompleted)op.lastEvent=`Viagem ${op.completedTrips} concluída · ${op.tripLog[op.tripLog.length-1]?.driver||'motorista'} · lucro ${money(Number(econ.unitNet)||0)} por percurso`;
    changed=true;
  }
  return changed;
}
function syncOperationRows(now=Date.now()){
  const rows=ownerOperations();let changed=false;
  for(const op of rows)if(syncOneOperationProgress(op,now))changed=true;
  if(changed)writeArrayKey(OPERATION_KEY,rows);
  // Cada lucro novo da operação é contabilizado no caixa sem depender de abrir essa tela.
  const cashChanged=syncOperationCashState(rows);
  if(cashChanged && $('#cashSummary')) renderCashDashboard();
  return rows;
}
function operationSummary(op,now=Date.now()){
  const elapsed=opElapsedSeconds(op,now),currentAbs=opParseTime(op.startTime)+elapsed/60,currentMinute=Math.floor(currentAbs),duration=Math.max(1,Number(op.duration)||60),already=Math.max(0,Number(op.completedTrips)||0),next=opTripScheduleAt(op,already),inTrip=currentAbs>=next.start&&currentAbs<next.end;
  const driverInfo=opDriverForTrip(op,already,next.start),shift=driverInfo.shift,driver=driverInfo.name;
  const totals=Object.values(op.driverTotals||{}).reduce((a,d)=>({trips:a.trips+(Number(d.trips)||0),revenue:a.revenue+(Number(d.revenue)||0),fuelCost:a.fuelCost+(Number(d.fuelCost)||0),net:a.net+(Number(d.net)||0)}),{trips:0,revenue:0,fuelCost:0,net:0});
  const progress=inTrip?Math.min(100,Math.max(0,(currentAbs-next.start)/duration*100)):0,remaining=Math.max(0,(next.end-currentAbs)*60/Math.max(1,Number(op.speedMultiplier)||1)),serviceOpen=opIsServiceOpen(currentAbs);
  return {elapsed,remaining,currentTime:opFormatTime(currentMinute),shift,driver,totals,progress,serviceOpen,inTrip,nextDeparture:opFormatTime(next.start),nextCompletion:opFormatTime(next.end)};
}
function renderOperations(){
  const rows=syncOperationRows(),now=Date.now();
  $('#operationList').innerHTML=rows.length?rows.slice().reverse().map(x=>{
    const isPaused=x.status==='pausada',isTerminalSwap=x.status==='aguardando substituição no terminal',isOut=x.status==='fora de operação'||x.status==='parada técnica'||isPaused||isTerminalSwap,isDetour=x.status==='operando com desvio';
    const cls=isOut?'offline':isDetour?'detour':'online',status=isTerminalSwap?'AGUARDANDO TROCA NO TERMINAL':isPaused?'PAUSADA':x.status==='parada técnica'?'PARADA TÉCNICA':x.status==='fora de operação'?'FORA DE OPERAÇÃO':isDetour?'OPERANDO COM DESVIO':'OPERANDO';
    const sums=operationSummary(x,now),econ=x.unitEconomics||operationEconomics(x.company,x.city,x.line),sourceLabel=econ.sampleCount?`${econ.sampleCount} viagem(ns) histórica(s) usada(s)`:'valores manuais estimados';
    const resultClass=sums.totals.net>0.004?'positive':sums.totals.net< -0.004?'negative':'';
    const recent=(x.tripLog||[]).slice(-5).reverse();
    const tripRows=recent.length?`<details class="operation-trip-details"><summary>Ver últimas viagens concluídas (${x.completedTrips||0} no total)</summary><div class="operation-trip-log">${recent.map(t=>`<div class="operation-trip-row"><span><b>Viagem ${t.tripNumber}</b> · ${escapeHtml(t.driver)} (${escapeHtml(opShiftLabel(t.shift))})<small>Horário simulado ${escapeHtml(t.simStart)}–${escapeHtml(t.simEnd)} · concluída ${escapeHtml(new Date(t.completedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</small></span><strong class="${Number(t.net)>=0?'positive':'negative'}">${money(Number(t.net)||0)}</strong></div>`).join('')}</div></details>`:'<p class="tool-result-note">A primeira viagem ainda está em andamento. O lucro aparecerá quando o tempo definido para o percurso terminar.</p>';
    const driverLiveRows=Object.values(x.driverTotals||{}).sort((a,b)=>(Number(b.trips)||0)-(Number(a.trips)||0)).map(d=>`<div class="operation-driver-live-row"><span><b>${escapeHtml(d.name)}</b><small>${Number(d.trips)||0} viagem(ns) concluída(s) · arrecadação ${money(Number(d.revenue)||0)} · diesel ${money(Number(d.fuelCost)||0)}</small></span><strong class="${Number(d.net)>=0?'positive':'negative'}">${money(Number(d.net)||0)}</strong></div>`).join('');
    const driverBreakdown=driverLiveRows?`<section class="operation-driver-live"><strong>Lucro acumulado por motorista</strong>${driverLiveRows}</section>`:'<section class="operation-driver-live"><strong>Lucro acumulado por motorista</strong><p class="tool-result-note">Ainda não há viagem concluída. Assim que o percurso atingir o tempo configurado, o resultado será lançado para o motorista do turno correspondente.</p></section>';
    const canProgress=operationIsRunning(x);
    return `<article class="operation-card"><div class="operation-card-top"><div><strong>${escapeHtml(x.company)} · ${escapeHtml(x.line)}</strong><small>${escapeHtml(x.city)} · ${escapeHtml(x.busModel)} · prefixo ${escapeHtml(x.prefix)} · ${norm(opVehicleCompany(x))!==norm(x.company)?`veículo de ${escapeHtml(opVehicleCompany(x))} · `:''}${escapeHtml(x.weekday)} às ${escapeHtml(x.startTime)} · ${x.duration} min por percurso</small><small>Turnos: manhã ${escapeHtml(x.drivers?.morning||'—')} · tarde ${escapeHtml(x.drivers?.afternoon||'—')} · noite ${escapeHtml(x.drivers?.night||'—')}</small><small>Funcionamento diário: 05:00–23:00 · ciclo automático</small></div><span class="operation-status ${cls}"><i></i>${status}</span></div><div class="operation-live-progress" data-gc-operation-live="${escapeHtml(x.id)}"><div class="operation-live-heading"><strong data-gc-live-heading>${canProgress?(!sums.serviceOpen&&!sums.inTrip?'Serviço encerrado · retoma às 05:00':'Operação em andamento'):'Relógio da operação parado'}</strong><span data-gc-live-time>Horário simulado: ${escapeHtml(sums.currentTime)}</span></div><div class="operation-progress-track"><span data-gc-live-progress style="width:${canProgress?sums.progress:0}%"></span></div><div class="operation-live-meta"><span data-gc-live-driver>Motorista da próxima viagem <b data-gc-live-driver-name>${escapeHtml(sums.driver)}</b> · turno da <span data-gc-live-shift>${escapeHtml(opShiftLabel(sums.shift))}</span></span><span data-gc-live-next>${canProgress?(!sums.serviceOpen&&!sums.inTrip?`Próxima partida às ${escapeHtml(sums.nextDeparture)} · chegada prevista ${escapeHtml(sums.nextCompletion)}`:'Próxima viagem conclui em '+opFormatCountdown(sums.remaining)):'Retome para continuar a contagem'}</span></div></div><div class="operation-live-stats"><article><span>Viagens concluídas</span><strong>${Number(x.completedTrips)||0}</strong></article><article><span>Arrecadação acumulada</span><strong>${money(sums.totals.revenue)}</strong></article><article><span>Diesel estimado</span><strong>${money(sums.totals.fuelCost)}</strong></article><article class="${resultClass}"><span>Lucro acumulado</span><strong>${money(sums.totals.net)}</strong></article></div><p class="tool-result-note operation-economics-note">Cálculo por percurso: ${money(Number(econ.unitRevenue)||0)} de arrecadação − ${money(Number(econ.unitFuelCost)||0)} de diesel = <b>${money(Number(econ.unitNet)||0)}</b>. Fonte: ${escapeHtml(sourceLabel)}. ${!econ.sampleCount?'Estimativa usada porque ainda não existe histórico compatível; ajuste os valores ao cadastrar a operação.':'A média vem das viagens normais desta mesma empresa, cidade e linha.'}</p>${driverBreakdown}${tripRows}${x.pendingVehicleSwap?`<p class="operation-swap-notice"><strong>Troca programada:</strong> ônibus ${escapeHtml(x.pendingVehicleSwap.replacementPrefix)} · ${escapeHtml(x.pendingVehicleSwap.replacementModel)} enviado ao ${escapeHtml(x.pendingVehicleSwap.terminal||'terminal de encontro')}. ${x.pendingVehicleSwap.busAtTerminal?'O ônibus atual já chegou; aguardando o reserva.':`O ônibus atual segue até o terminal; `}<b data-gc-operation-swap-countdown="${escapeHtml(x.id)}">${Date.now()>=Number(x.pendingVehicleSwap.arrivesAtMs)?'reserva chegou e aguarda o ônibus atual':'reserva chega em '+opFormatCountdown(Math.max(0,(Number(x.pendingVehicleSwap.arrivesAtMs)-now)/1000))}</b> · trânsito ${escapeHtml(x.pendingVehicleSwap.trafficLabel)}.</p>`:''}${x.gcIncidentActive?`<p class="operation-incident-timer" data-gc-incident-countdown="${escapeHtml(x.id)}">Ocorrência ${escapeHtml(INCIDENT_LABELS[x.gcIncidentActive.type]||x.gcIncidentActive.type)} · ${x.gcIncidentActive.manualRelease?'apoio mecânico':`normalização prevista (${x.gcIncidentActive.durationMinutes||0} min simulados)`}: ${x.gcIncidentActive.serviceArrived?'equipe de apoio chegou · aguardando oficina':x.gcIncidentActive.endsAtMs?escapeHtml(opFormatCountdown(Math.max(0,(Number(x.gcIncidentActive.endsAtMs)-now)/1000))):'aguardando liberação da oficina'}.</p>`:''}${x.lastEvent?`<p class="operation-last-event">Último evento: ${escapeHtml(x.lastEvent)}</p>`:''}<div class="operation-actions"><button type="button" class="primary-button" data-op-profit="${escapeHtml(x.id)}">Ver lucro histórico por motorista</button><button type="button" class="secondary-action-button" data-op-swap="${escapeHtml(x.id)}">Trocar veículo da operação</button><button type="button" class="secondary-action-button" data-op-incident="${escapeHtml(x.id)}">Registrar / resolver ocorrência</button><button type="button" class="secondary-action-button" data-op-random="${escapeHtml(x.id)}">Teste aleatório (10%)</button><button type="button" class="secondary-action-button" data-op-toggle="${escapeHtml(x.id)}" ${isTerminalSwap?'disabled':''}>${canProgress?'Pausar operação':(isTerminalSwap?'Aguardando substituto':'Retomar operação')}</button><button type="button" class="secondary-action-button" data-op-delete="${escapeHtml(x.id)}">Remover</button></div></article>`;
  }).join(''):recordsEmpty('Nenhuma linha cadastrada no Visualizador de Operação.');
}
function openIncidentFor(op,type){currentIncidentOperationId=op.id;$('#ovIncidentPanel').hidden=false;$('#ovIncidentType').value=type||'acidente';$('#ovIncidentTitle').textContent=`${INCIDENT_LABELS[$('#ovIncidentType').value]} · ${op.company} / ${op.line}`;$('#ovIncidentQuestion').textContent=`Ocorrência em ${op.city}: o que a central/Pablo decide registrar para esta linha?`;populateIncidentResponses();$('#ovIncidentPanel').scrollIntoView({behavior:'smooth',block:'nearest'});}

function opSwapAvailableFleet(){
  const source=typeof gcGarageVehicles==='function'?gcGarageVehicles():[];
  const rows=source.length?source:uniqueVehicleOptions();
  const seen=new Set();
  return rows.filter(v=>{
    const key=`${norm(v.company)}|${String(v.prefix||'')}`;
    if(!v.company||!v.prefix||seen.has(key))return false;
    seen.add(key);return true;
  });
}
function opSwapCandidateLabel(v){
  const state=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(v):null;
  const health=state&&typeof gcGarageCondition==='function'?Math.round(gcGarageCondition(state)):null;
  return `${v.company} · ${v.prefix} · ${v.model||'modelo não informado'}${health===null?'':` · condição ${health}%`}`;
}
function opSwapPopulateCompanies(op){
  const companySelect=$('#ovSwapCompany'),vehicleSelect=$('#ovSwapVehicle');
  const companies=[...new Set(opSwapAvailableFleet().map(v=>String(v.company)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  companySelect.innerHTML='<option value="">Selecione a empresa</option>'+companies.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const preferred=opVehicleCompany(op);
  if(companies.some(c=>norm(c)===norm(preferred)))companySelect.value=companies.find(c=>norm(c)===norm(preferred));
  vehicleSelect.innerHTML='<option value="">Selecione primeiro a empresa</option>';
  opSwapPopulateVehicles(op);
}
function opSwapPopulateVehicles(op){
  const company=$('#ovSwapCompany').value,select=$('#ovSwapVehicle'),preview=$('#ovSwapPreview');
  if(!company){select.innerHTML='<option value="">Selecione primeiro a empresa</option>';preview.textContent='Selecione a empresa proprietária para consultar os ônibus disponíveis.';return;}
  const all=opSwapAvailableFleet().filter(v=>norm(v.company)===norm(company));
  const eligible=[];const blocked=[];
  all.forEach(v=>{
    if(norm(v.company)===norm(opVehicleCompany(op))&&String(v.prefix)===String(op.prefix))return;
    const test=opSwapVehicleAvailability(v.company,v.prefix,op.id);
    if(test.ok)eligible.push(v);else blocked.push({v,reason:test.reason});
  });
  select.innerHTML='<option value="">Selecione o ônibus substituto</option>'+eligible.map(v=>`<option value="${escapeHtml(encodeURIComponent(JSON.stringify({company:v.company,prefix:String(v.prefix)})))}">${escapeHtml(opSwapCandidateLabel(v))}</option>`).join('');
  preview.textContent=eligible.length?`${eligible.length} ônibus disponível(is) nesta empresa. Apenas veículos sem vínculo com outra linha, sem ordem de serviço e em condição operacional serão listados.${blocked.length?` ${blocked.length} unidade(s) foram excluídas por indisponibilidade.`:''}`:`Nenhum ônibus elegível encontrado nesta empresa.${blocked.length?` Foram avaliados ${blocked.length} veículo(s), mas todos possuem vínculo, bloqueio ou condição insuficiente.`:''}`;
}
function opSwapOpenPanel(op){
  if(!assertOwner())return;
  if(op.pendingVehicleSwap){showToast('Esta operação já possui uma troca programada. Aguarde a chegada e o encontro no terminal.');return;}
  if(op.replacementDispatch){showToast('Há um substituto de pane em deslocamento. Utilize o alerta mecânico já aberto para acompanhar essa substituição.');return;}
  if(op.breakdownId||(typeof gcGarageAlerts==='function'&&gcGarageAlerts().some(a=>!a.resolvedAt&&a.operationId===op.id))){showToast('A operação possui uma pane mecânica aberta. Resolva a ocorrência pela Garagem para não contornar o bloqueio de segurança.');return;}
  const currentVehicle={company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||''};
  if(op.gcInspectionPaused||op.gcUserMaintenanceHoldOrderId||op.gcMaintenanceStoppedByOrder||op.gcFuelPaused||(typeof gcGarageOrders==='function'&&gcGarageOrders().some(o=>o.vehicleKey===gcGarageKey(currentVehicle)&&!['Aprovada','Cancelada'].includes(o.status)))){showToast('O ônibus possui uma retenção, ordem de serviço ou pendência de abastecimento. Resolva o bloqueio atual antes de programar uma troca comum.');return;}
  if(!['operando','operando com desvio','pausada'].includes(op.status)){showToast('A troca programada exige uma linha em operação ou pausada em um terminal. Linhas retidas por pane/fiscalização devem usar o procedimento de ocorrência.');return;}
  const summary=operationSummary(op,Date.now());
  if(op.status==='pausada'&&summary.inTrip){showToast('O ônibus está pausado no meio do percurso. Retome a linha para que ele alcance o terminal antes da troca.');return;}
  currentVehicleSwapOperationId=op.id;
  $('#ovVehicleSwapTitle').textContent=`Trocar veículo · ${op.company} / ${op.line}`;
  $('#ovVehicleSwapQuestion').textContent=`Ônibus atual: ${opVehicleCompany(op)} · ${op.prefix} · ${op.busModel}. O substituto será enviado ao próximo terminal de encontro e aguardará a chegada desta unidade.`;
  opSwapPopulateCompanies(op);
  $('#ovVehicleSwapPanel').hidden=false;
  $('#ovVehicleSwapPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('#ovSwapCompany').addEventListener('change',()=>{
  const op=ownerOperations().find(x=>x.id===currentVehicleSwapOperationId);if(op)opSwapPopulateVehicles(op);
});
$('#ovSwapVehicle').addEventListener('change',()=>{
  const val=$('#ovSwapVehicle').value,preview=$('#ovSwapPreview');
  if(!val)return;
  try{const selected=JSON.parse(decodeURIComponent(val));const test=opSwapVehicleAvailability(selected.company,selected.prefix,currentVehicleSwapOperationId);preview.textContent=test.ok?`Selecionado: ${opSwapCandidateLabel(test.vehicle)}. A disponibilidade será conferida novamente quando o ônibus chegar ao terminal.`:`Este ônibus não pode ser usado: ${test.reason}`;}catch(e){preview.textContent='Não foi possível ler a seleção. Escolha o ônibus novamente.';}
});
$('#ovConfirmVehicleSwap').addEventListener('click',()=>{
  if(!assertOwner())return;
  const rows=ownerOperations(),op=rows.find(x=>x.id===currentVehicleSwapOperationId);
  if(!op){showToast('A operação selecionada não existe mais. Atualize a lista e tente novamente.');return;}
  if(op.pendingVehicleSwap||op.replacementDispatch){showToast('Já existe uma substituição em andamento para esta operação.');return;}
  const currentVehicle={company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||''};
  if(op.breakdownId||op.gcInspectionPaused||op.gcUserMaintenanceHoldOrderId||op.gcMaintenanceStoppedByOrder||op.gcFuelPaused||(typeof gcGarageOrders==='function'&&gcGarageOrders().some(o=>o.vehicleKey===gcGarageKey(currentVehicle)&&!['Aprovada','Cancelada'].includes(o.status)))){showToast('A operação recebeu um bloqueio desde a abertura da janela. Resolva a pane, oficina, fiscalização ou abastecimento antes de trocar o veículo.');return;}
  const encoded=$('#ovSwapVehicle').value;if(!encoded){showToast('Selecione a empresa e o ônibus substituto.');return;}
  let selected;try{selected=JSON.parse(decodeURIComponent(encoded));}catch(e){showToast('A seleção do ônibus está inválida. Escolha novamente.');return;}
  const available=opSwapVehicleAvailability(selected.company,selected.prefix,op.id);
  if(!available.ok){showToast(available.reason);opSwapPopulateVehicles(op);return;}
  if(!['operando','operando com desvio','pausada'].includes(op.status)){showToast('A linha deixou de estar disponível para troca programada. Atualize o Visualizador.');return;}
  const now=Date.now(),summary=operationSummary(op,now);
  if(op.status==='pausada'&&summary.inTrip){showToast('O ônibus atual está pausado durante o percurso. Retome a operação para ele chegar ao terminal.');return;}
  const traffic=opSwapTrafficEstimate(),arrivesAtMs=now+traffic.minutes*60000;
  const completed=Math.max(0,Number(op.completedTrips)||0);
  const isRunning=operationIsRunning(op);
  const busAtTerminal=!summary.inTrip;
  const applyAfterTrip=busAtTerminal?completed:completed+1;
  const terminal=busAtTerminal?(completed%2===0?'Terminal de origem':'Terminal de destino'):(applyAfterTrip%2===1?'Terminal de destino':'Terminal de origem');
  const priorStatus=op.status;
  op.pendingVehicleSwap={
    id:makeId(),requestedAt:new Date(now).toISOString(),requestedAtMs:now,
    arrivesAt:new Date(arrivesAtMs).toISOString(),arrivesAtMs,durationMinutes:traffic.minutes,trafficLabel:traffic.label,
    replacementCompany:available.vehicle.company,replacementPrefix:String(available.vehicle.prefix),
    replacementModel:available.vehicle.model||'',replacementChassis:available.vehicle.chassis||'',
    applyAfterTrip,busAtTerminal,terminal,priorStatus
  };
  if(busAtTerminal){
    if(isRunning)freezeOperationClock(op,now);
    op.status='aguardando substituição no terminal';
    op.scheduleBaseTripCount=completed;
    const next=opTripScheduleAt(op,completed);op.scheduleBaseStartAbs=next.start;
  }
  op.lastEvent=`Substituto ${available.vehicle.prefix} enviado ao ${terminal} · trânsito ${traffic.label.toLowerCase()} · chegada prevista em ${traffic.minutes} min. A troca ocorrerá somente quando os dois ônibus estiverem no terminal.`;
  if(!writeArrayKey(OPERATION_KEY,rows)){op.pendingVehicleSwap=null;showToast('Não foi possível salvar a substituição. Nenhuma alteração foi confirmada.');return;}
  $('#ovVehicleSwapPanel').hidden=true;currentVehicleSwapOperationId=null;
  renderOperations();
  showToast(`Ônibus ${available.vehicle.prefix} enviado ao ${terminal}. Chegada estimada em ${traffic.minutes} minutos (${traffic.label.toLowerCase()}). O ônibus atual seguirá até o mesmo terminal; a troca será feita no encontro.`);
});
$('#ovCancelVehicleSwapPanel').addEventListener('click',()=>{$('#ovVehicleSwapPanel').hidden=true;currentVehicleSwapOperationId=null;});
function populateIncidentResponses(){const type=$('#ovIncidentType').value;populateSelect($('#ovIncidentResponse'),'Selecione uma decisão',INCIDENT_RESPONSES[type]||INCIDENT_RESPONSES.acidente);}
$('#ovIncidentType').addEventListener('change',()=>{if(currentIncidentOperationId){const op=ownerOperations().find(x=>x.id===currentIncidentOperationId);if(op){$('#ovIncidentTitle').textContent=`${INCIDENT_LABELS[$('#ovIncidentType').value]} · ${op.company} / ${op.line}`;$('#ovIncidentQuestion').textContent=`Ocorrência em ${op.city}: escolha uma resposta simulada.`;}}populateIncidentResponses();});
function updateOperationEconomicsHint(){
  const el=$('#ovEconomicsHint');if(!el)return;
  const company=$('#ovCompany').value,city=$('#ovCity').value.trim(),line=$('#ovLine').value.trim();
  if(!company||!city||!line){el.textContent='Informe empresa, cidade e linha. O simulador pesquisará essas três informações no histórico das linhas normais e usará os valores manuais abaixo somente se não encontrar viagens compatíveis.';return;}
  const matches=operationRouteHistory(company,city,line);
  if(matches.length)el.textContent=`Encontrei ${matches.length} viagem(ns) histórica(s) compatível(is). A operação usará média de ${money(matches.reduce((s,t)=>s+(Number(t.revenue)||0),0)/matches.length)} de arrecadação, ${money(matches.reduce((s,t)=>s+(Number(t.fuelCost)||0),0)/matches.length)} de diesel e ${money(matches.reduce((s,t)=>s+historicalTripNet(t),0)/matches.length)} de resultado por percurso. Os valores manuais serão ignorados.`;
  else el.textContent='Ainda não encontrei essa combinação no histórico normal. Para a simulação começar mesmo assim, serão usados os pagantes, a tarifa e o diesel estimados que você informou. Assim que houver histórico compatível em uma nova operação, ele será priorizado.';
}
['ovCompany','ovCity','ovLine','ovFallbackPayers','ovFallbackFare','ovFallbackFuelCost'].forEach(id=>{const el=$('#'+id);if(el){el.addEventListener('input',updateOperationEconomicsHint);el.addEventListener('change',updateOperationEconomicsHint);}});
function gcDriverForOperationStart(op){const minute=opParseTime(op.startTime);const shift=opShiftKey(minute);return String(op.drivers?.[shift]||'');}
$('#operationViewerForm').addEventListener('submit',event=>{
  event.preventDefault();if(!assertOwner())return;
  const company=$('#ovCompany').value,model=$('#ovBus').value,prefix=$('#ovPrefix').value.trim(),city=$('#ovCity').value.trim(),line=$('#ovLine').value.trim(),duration=readToolValue('ovDuration'),startTime=$('#ovStartTime').value,weekday=$('#ovWeekday').value;
  const fallbackPayers=Number($('#ovFallbackPayers').value),fallbackFare=Number($('#ovFallbackFare').value),fallbackFuelCost=Number($('#ovFallbackFuelCost').value),speedMultiplier=Number($('#ovSimSpeed').value)||10;
  if(!company||!model||!prefix||!city||!line||duration===null||duration<1||!startTime){showToast('Preencha empresa, ônibus, prefixo, cidade, linha, tempo e horário.');return;}
  const firstDepartureMinute=opParseTime(startTime);
  if(firstDepartureMinute<OP_SERVICE_OPEN_MINUTE||firstDepartureMinute>OP_SERVICE_CLOSE_MINUTE){showToast('A primeira partida deve ficar entre 05:00 e 23:00. Fora desse horário, o ciclo aguarda até 05:00.');return;}
  if(!Number.isInteger(fallbackPayers)||fallbackPayers<0||!Number.isFinite(fallbackFare)||fallbackFare<0||!Number.isFinite(fallbackFuelCost)||fallbackFuelCost<0){showToast('Confira pagantes estimados, tarifa e custo de diesel (não podem ser negativos).');return;}
  const repeatedConflict=gcOnlineRecurringOperationConflict({company,prefix,model},weekday);
  if(repeatedConflict){showToast(`Ônibus indisponível: ${repeatedConflict.message}`);return;}
  const economics=operationEconomics(company,city,line,fallbackPayers,fallbackFare,fallbackFuelCost);
  const op={id:makeId(),company,vehicleCompany:company,busModel:model,prefix,city,line,duration,startTime,weekday,drivers:{morning:$('#ovMorningDriver').value,afternoon:$('#ovAfternoonDriver').value,night:$('#ovNightDriver').value},status:'initializing',createdAt:new Date().toISOString(),lastEvent:'',incidentHistory:[],speedMultiplier,elapsedSeconds:0,clockAnchorAt:null,completedTrips:0,tripLog:[],driverTotals:{},unitEconomics:economics,scheduleVersion:2,scheduleBaseTripCount:0,scheduleBaseStartAbs:opParseTime(startTime)};
  const startingDriver=gcDriverForOperationStart(op);if(!startingDriver){showToast('Escolha o motorista escalado para o turno que contém a primeira partida.');return;}
  gcActivateOperation(op);
});

// O relatório usa todo o histórico das viagens municipais salvas no navegador, não apenas o dia selecionado.
// Normalização insensível a maiúsculas, acentos e pontuação reduz divergências como "32 - Nova Suíça"/"32 Nova Suica".
function profitMatchKey(value){return norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
function historicalTripNet(trip){const direct=trip?.net;if(direct!==undefined&&direct!==null&&Number.isFinite(Number(direct)))return Number(direct);return (Number(trip?.revenue)||0)-(Number(trip?.fuelCost)||0);}
function renderOperationProfitReport(operationId){
  const op=ownerOperations().find(row=>row.id===operationId);
  if(!op){showToast('Não encontrei essa operação para analisar.');return;}
  currentProfitOperationId=op.id;
  const history=loadHistory();
  const cityKey=profitMatchKey(op.city),lineKey=profitMatchKey(op.line),companyKey=profitMatchKey(op.company);
  const locationMatches=history.filter(t=>t.city&&t.line&&profitMatchKey(t.city)===cityKey&&profitMatchKey(t.line)===lineKey);
  const matches=locationMatches.filter(t=>profitMatchKey(t.company)===companyKey);
  const totalResult=matches.reduce((sum,t)=>sum+historicalTripNet(t),0);
  const average=matches.length?totalResult/matches.length:0;
  const days=new Set(matches.map(t=>t.dayId||t.dayLabel||'day-1'));
  $('#operationProfitTitle').textContent=`Lucro histórico · ${op.line}`;
  $('#operationProfitSubtitle').textContent=`Operação: ${op.company} · ${op.city} · Linha ${op.line}. Busca em todos os dias do histórico normal, com comparação por empresa, cidade e nome/número da linha.`;
  $('#operationProfitSummary').innerHTML=[['Viagens compatíveis encontradas',String(matches.length)],['Resultado acumulado das viagens',money(totalResult)],['Resultado médio por viagem',money(average)],['Dias com registros',String(days.size)]].map(([label,value])=>`<article class="tool-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
  const shiftNames=[['Manhã','morning'],['Tarde','afternoon'],['Noite','night']].map(([label,key])=>({shift:label,name:String(op.drivers?.[key]||'').trim()})).filter(row=>row.name);
  const grouped=new Map();shiftNames.forEach(row=>{const key=profitMatchKey(row.name);if(!grouped.has(key))grouped.set(key,{name:row.name,shifts:[]});grouped.get(key).shifts.push(row.shift);});
  const driverRows=Array.from(grouped.values()).map(driver=>{
    const trips=matches.filter(t=>profitMatchKey(t.driver)===profitMatchKey(driver.name));
    const result=trips.reduce((sum,t)=>sum+historicalTripNet(t),0);
    return {...driver,trips,result,average:trips.length?result/trips.length:0,days:new Set(trips.map(t=>t.dayId||t.dayLabel||'day-1')).size};
  });
  $('#operationProfitDrivers').innerHTML=driverRows.length?driverRows.map(driver=>{
    const resultClass=driver.result>0.004?'positive':driver.result< -0.004?'negative':'';
    return `<article class="record-item operation-profit-driver"><div class="record-item-top"><div><strong>${escapeHtml(driver.name)}</strong><small>Turno(s): ${escapeHtml(driver.shifts.join(', '))} · ${driver.trips.length} viagem(ns) encontrada(s) · ${driver.days} dia(s) no histórico</small><small>Resultado médio por viagem: <b>${money(driver.average)}</b></small></div><span class="operation-profit-total ${resultClass}">${money(driver.result)}</span></div></article>`;
  }).join(''):recordsEmpty('Nenhum motorista está atribuído aos turnos desta operação.');
  const missingTags=history.filter(t=>!String(t.city||'').trim()||!String(t.line||'').trim()).length;
  const otherCompanies=locationMatches.filter(t=>profitMatchKey(t.company)!==companyKey);
  let note='O resultado registrado é a arrecadação da viagem menos o custo do diesel. É o resultado operacional da viagem atribuída ao motorista, não o salário ou comissão pessoal dele. Não inclui manutenção, salários, pneus, pedágios ou demais despesas que não foram registradas no histórico.';
  if(!matches.length){
    if(otherCompanies.length){const companyNames=[...new Set(otherCompanies.map(t=>t.company||'Empresa não informada'))].join(', ');note=`Encontrei ${otherCompanies.length} viagem(ns) com a mesma cidade e linha, mas de outra empresa (${companyNames}). Não misturei os valores para evitar erro. Confira o cadastro da empresa e mantenha cidade/linha consistentes. ${note}`;}
    else note=`Ainda não há viagens compatíveis nesta combinação de empresa, cidade e linha. Ao registrar viagens normais, informe exatamente a empresa, a cidade e o nome da linha; o sistema ignora diferenças de acento, maiúsculas e pontuação. ${note}`;
  } else if(otherCompanies.length){note+=` Também encontrei ${otherCompanies.length} viagem(ns) com a mesma cidade/linha de outra(s) empresa(s); elas foram excluídas deste resultado.`;}
  if(missingTags) note+=` ${missingTags} registro(s) antigo(s) não possuem cidade e/ou linha cadastradas e foram excluídos da análise. Na tela do histórico normal, use “Identificar cidade/linha para análise” em cada viagem antiga para completá-los.`;
  $('#operationProfitLimit').textContent=note;
  currentProfitReportText=[`GRUPO CONECT — RESULTADO HISTÓRICO POR MOTORISTA`,`Empresa: ${op.company}`,`Cidade: ${op.city}`,`Linha: ${op.line}`,`Viagens compatíveis: ${matches.length}`,`Resultado acumulado: ${money(totalResult)}`,`Média por viagem: ${money(average)}`,'',...driverRows.map(d=>`${d.name} (${d.shifts.join(', ')}): ${d.trips.length} viagem(ns), acumulado ${money(d.result)}, média por viagem ${money(d.average)}`),'',note].join('\n');
  $('#operationProfitPanel').hidden=false;
  $('#operationProfitPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('#ovCloseProfit').addEventListener('click',()=>{$('#operationProfitPanel').hidden=true;});
$('#ovRefreshProfit').addEventListener('click',()=>{if(currentProfitOperationId)renderOperationProfitReport(currentProfitOperationId);else showToast('Abra o relatório a partir de uma linha da operação.');});
$('#ovCopyProfit').addEventListener('click',async()=>{if(!currentProfitReportText){showToast('Abra um relatório antes de copiar.');return;}showToast(await copyText(currentProfitReportText)?'Relatório de lucros copiado.':'Não foi possível copiar o relatório automaticamente.');});
$('#operationList').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-op-profit')){if(!assertOwner())return;renderOperationProfitReport(b.dataset.opProfit);return;}
  if(b.hasAttribute('data-op-swap')){const op=ownerOperations().find(x=>x.id===b.dataset.opSwap);if(op)opSwapOpenPanel(op);return;}
  const rows=ownerOperations();const id=b.dataset.opIncident||b.dataset.opRandom||b.dataset.opDelete||b.dataset.opResume||b.dataset.opToggle;let op=rows.find(x=>x.id===id);if(!op)return;if(!assertOwner())return;
  if(b.hasAttribute('data-op-toggle')||b.hasAttribute('data-op-resume')){
    if(operationIsRunning(op)){
      op.gcResumeStatus=op.status;
      freezeOperationClock(op);
      op.status='pausada';
      op.lastEvent=(op.lastEvent||'Operação')+' · relógio pausado por Pablo';
      if(!writeArrayKey(OPERATION_KEY,rows))return;
      renderOperations();
      showToast('Operação pausada; o tempo e os resultados deixaram de avançar.');
    }else{
      const resumeResult=typeof window.gcAdminResumeOperation==='function'
        ? window.gcAdminResumeOperation(op,{source:'visualizador'})
        : {ok:true,status:'operando'};
      if(!resumeResult?.ok){renderOperations();return;}
      if(!writeArrayKey(OPERATION_KEY,rows))return;
      renderOperations();
      showToast(resumeResult.message||'Operação retomada; o cronômetro voltou a contar.');
    }
    return;
  }
  if(b.hasAttribute('data-op-delete')){if(!window.confirm(`Remover a linha ${op.line} do visualizador? O histórico de caixa e escala ficará preservado.`))return;writeArrayKey(OPERATION_KEY,rows.filter(x=>x.id!==id));renderOperations();return;}
  if(b.hasAttribute('data-op-random')){if(Math.random()>=0.10){showToast('Nenhuma ocorrência nesta verificação (90% de chance de seguir operando).');return;}op.gcIncidentPreviousStatus=op.status;freezeOperationClock(op);const kinds=Object.keys(INCIDENT_RESPONSES),type=kinds[Math.floor(Math.random()*kinds.length)];op.status='fora de operação';op.currentIncidentType=type;op.lastEvent=`${INCIDENT_LABELS[type]} · ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;op.incidentHistory=op.incidentHistory||[];op.incidentHistory.push({id:makeId(),type,occurredAt:new Date().toISOString(),resolution:''});writeArrayKey(OPERATION_KEY,rows);renderOperations();openIncidentFor(op,type);showToast('Ocorrência simulada; a linha foi parada.');return;}
  const type=op.currentIncidentType||'transito';openIncidentFor(op,type);
});
$('#ovApplyIncidentResponse').addEventListener('click',()=>{
  if(!assertOwner())return;const rows=ownerOperations(),op=rows.find(x=>x.id===currentIncidentOperationId);if(!op){showToast('Selecione uma linha para registrar a decisão.');return;}const type=$('#ovIncidentType').value,response=$('#ovIncidentResponse').value;if(!response){showToast('Selecione uma resposta pronta.');return;}
  op.currentIncidentType=type;op.lastEvent=`${INCIDENT_LABELS[type]} — decisão: ${response}`;op.incidentHistory=op.incidentHistory||[];let last=op.incidentHistory[op.incidentHistory.length-1];if(!last||last.resolution){last={id:makeId(),type,occurredAt:new Date().toISOString(),resolution:''};op.incidentHistory.push(last);}last.resolution=response;last.resolvedAt=new Date().toISOString();
  if(type==='mecanica'||type==='acidente'){freezeOperationClock(op);op.status='parada técnica';}else{op.status='operando com desvio';if(!(Number(op.clockAnchorAt)>0))op.clockAnchorAt=Date.now();}
  writeArrayKey(OPERATION_KEY,rows);renderOperations();$('#ovIncidentPanel').hidden=true;showToast('Decisão registrada. Estado da linha atualizado.');
});
$('#ovDismissIncident').addEventListener('click',()=>{if(!assertOwner())return;const rows=ownerOperations(),op=rows.find(x=>x.id===currentIncidentOperationId);if(op){freezeOperationClock(op);op.status='fora de operação';if(op.gcIncidentActive){const record=(op.incidentHistory||[]).find(x=>x.id===op.gcIncidentActive.id);if(record)record.userKeptStoppedAt=new Date().toISOString();op.gcIncidentActive=null;}delete op.gcIncidentPreviousStatus;writeArrayKey(OPERATION_KEY,rows);renderOperations();}$('#ovIncidentPanel').hidden=true;showToast('Linha mantida fora de operação por decisão do proprietário. A retomada será manual.');});
$('#ovChanceEvent').addEventListener('click',()=>{if(!assertOwner())return;const rows=ownerOperations(),active=rows.filter(x=>x.status==='operando'||x.status==='operando com desvio');if(!active.length){showToast('Não há linha em operação para testar.');return;}if(Math.random()>=0.10){showToast('Nenhuma ocorrência nesta verificação (90%).');return;}const op=active[Math.floor(Math.random()*active.length)],kinds=Object.keys(INCIDENT_RESPONSES),type=kinds[Math.floor(Math.random()*kinds.length)];op.gcIncidentPreviousStatus=op.status;freezeOperationClock(op);op.status='fora de operação';op.currentIncidentType=type;op.lastEvent=`${INCIDENT_LABELS[type]} · ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;op.incidentHistory=op.incidentHistory||[];op.incidentHistory.push({id:makeId(),type,occurredAt:new Date().toISOString(),resolution:''});writeArrayKey(OPERATION_KEY,rows);renderOperations();openIncidentFor(op,type);showToast(`Ocorrência em ${op.line}: escolha uma resposta.`);});

// Ficha técnica padrão de simulação. Dimensões/capacidades mudam de acordo com o ano,
// carroceria, chassi e layout interno; quilometragens e preços são valores fictícios de jogo.
function enrichMarketBus(x,i){
  const yearMatch=String(x.year||'2020').match(/(19|20)\d{2}/);const year=yearMatch?Number(yearMatch[0]):2020;
  const type=String(x.type||'').toLowerCase(),model=String(x.model||'').toLowerCase(),chassis=String(x.chassis||'');
  const isElectric=/elétric|eletric/i.test(type+' '+model+' '+chassis);
  const isDouble=/dd|double-decker|dois andares/.test(type+' '+model);
  const isArtic=/articulad/.test(type+' '+model);
  const isMicro=/micro|volare|senior|fox|foz|attack 8|fly 9|fly 10|fly 12/.test(type+' '+model);
  const isMidi=/midi|midibus/.test(type+' '+model);
  const isUrban=/urbano|escolar|brt|padron|midi/.test(type);
  let length= x.lengthM || (isArtic?18.9:isDouble?14.5:isMicro?(model.includes('senior')?8.2:8.5):isMidi?10.8:isUrban?12.5:12.8);
  if(/paradiso g8 1800|g8 1800 dd/.test(model)) length=15.0;
  let width=x.widthM || (isMicro?2.40:(isUrban?2.55:2.60));
  let height=x.heightM || (isDouble?4.10:isMicro?3.15:(isUrban?3.30:3.75));
  if(/torino/.test(model)){width=x.widthM||2.55;height=x.heightM||3.26;length=x.lengthM||12.565;}
  if(/senior urbano/.test(model)){width=2.35;height=3.09;length=8.3;}
  if(/senior rodoviário|senior interprovincial/.test(model)){width=2.40;height=3.295;length=9.155;}
  if(/apache vip/.test(model)){width=2.53;height=3.48;}
  if(/granvia/.test(model)){width=2.60;height=3.20;}
  const seated=Number(x.seats)||0;
  const seatedOnly=/escolar|rodoviário|intermunicipal|fretamento|turismo/.test(type);
  let standing=Number.isFinite(x.standing)?x.standing:(isDouble||seatedOnly?0:isElectric?Math.max(0,Math.round(length*2.8)):isArtic?90:isMicro?(isUrban?8:0):isMidi?(isUrban?18:0):isUrban?(length>=14.5?50:length>=12?35:25):0);
  const total=Number.isFinite(x.totalCapacity)?x.totalCapacity:seated+standing;
  const age=Math.max(0,2026-year);const annualKm=isUrban?65000:isMicro?48000:85000;const multiplier=0.82+(i%8)*0.045;
  const mileage=Number.isFinite(x.kmDriven)?x.kmDriven:Math.round(Math.max(8000,age*annualKm*multiplier)/5000)*5000;
  const fuel=x.fuel||(isElectric?'Elétrico (bateria)':'Diesel S-10');
  const tank=x.tankL??(isElectric?0:isMicro?150:isUrban?(length>=14?350:280):(isDouble?550:480));
  const kmL=x.kmL??(isElectric?null:isMicro?4.6:isUrban?(isArtic?1.25:length>=14?1.8:2.2):(isDouble?2.0:2.7));
  const traction=x.traction||(chassis.match(/(?:4x2|6x2|6x4|8x2|8x4)/i)?.[0]|| (isArtic?'6x2':isDouble?'8x2':'4x2'));
  const axles=x.axles||(traction.startsWith('8')?4:traction.startsWith('6')?3:2);
  return {...x,lengthM:length,widthM:width,heightM:height,seated,standing,totalCapacity:total,kmDriven:mileage,fuel,tankL:tank,kmL,traction,axles,
    engine:x.engine||chassis,
    transmission:x.transmission||'Manual ou automática, conforme a versão',
    airConditioning:x.airConditioning||'Com ou sem ar-condicionado, conforme a unidade',
    accessibility:x.accessibility||'Elevador/DPM e espaços reservados dependem da configuração',
    doors:x.doors||(isArtic?4:isUrban?(length>=14?4:3):isMicro?1:2),
    configuration:x.configuration||(isArtic?'Urbano articulado, alta capacidade':isDouble?'Rodoviário double-decker':isUrban?'Urbano: piso alto ou configuração conforme versão':isMicro?'Micro-ônibus para urbano, fretamento ou turismo':'Rodoviário/intermunicipal, salão de poltronas'),
    kmLLabel:isElectric?'Consumo elétrico depende do ciclo (kWh/km)':`aprox. ${String(kmL).replace('.',',')} km/L`,source:'Modelo de referência; preço/odômetro simulados',dataStatus:'Ficha técnica aproximada para simulação; confirme a unidade real'};
}

// Catálogo de ônibus para simulação — preços e odômetros abaixo são estimativas fictícias,
// não anúncios ativos nem quilometragens atribuídas a veículos reais.
const BUS_MARKET=[
{id:'m01',model:'Caio Apache VIP III',year:'2013/2013',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:46,price:170000,source:'Revenda de Ônibus'},
{id:'m02',model:'Caio Apache VIP II',year:'2011/2011',chassis:'Mercedes-Benz OF-1722',type:'Urbano',seats:46,price:110000,source:'Revenda de Ônibus'},
{id:'m03',model:'Caio Apache',year:'2015/2015',chassis:'Volkswagen 17.230',type:'Urbano',seats:39,price:220000,source:'Revenda de Ônibus'},
{id:'m04',model:'Caio Apache',year:'2016/2016',chassis:'Volkswagen 17.230',type:'Urbano',seats:33,price:240000,source:'Revenda de Ônibus'},
{id:'m05',model:'Caio Apache',year:'2016/2016',chassis:'Volkswagen 17.230',type:'Urbano',seats:33,price:265000,source:'Revenda de Ônibus'},
{id:'m06',model:'Marcopolo Torino',year:'2014/2014',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:44,price:190000,source:'Revenda de Ônibus'},
{id:'m07',model:'Marcopolo Torino',year:'2015/2015',chassis:'Mercedes-Benz OF-1724',type:'Urbano',seats:39,price:310000,source:'Revenda de Ônibus'},
{id:'m08',model:'Marcopolo Torino',year:'2017/2017',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:31,price:380000,source:'Revenda de Ônibus'},
{id:'m09',model:'Marcopolo Torino',year:'2018/2019',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:36,price:470000,source:'Revenda de Ônibus'},
{id:'m10',model:'Marcopolo Torino',year:'2019/2020',chassis:'Mercedes-Benz OF-1519 Euro V',type:'Urbano',seats:34,price:560000,source:'Revenda de Ônibus'},
{id:'m11',model:'Marcopolo Torino',year:'2020/2021',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:41,price:640000,source:'Revenda de Ônibus'},
{id:'m12',model:'Caio Torino',year:'2022/2023',chassis:'Mercedes-Benz OF-1721 Euro V',type:'Urbano',seats:39,price:650000,source:'Revenda de Ônibus'},
{id:'m13',model:'Caio Apache VIP II',year:'2014/2015',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:46,price:199000,source:'Revenda de Ônibus'},
{id:'m14',model:'Caio Apache VIP',year:'2017/2017',chassis:'Mercedes-Benz OF-1519',type:'Urbano',seats:36,price:450000,source:'CISIOTAR'},
{id:'m15',model:'Marcopolo New Torino',year:'2015/2015',chassis:'Mercedes-Benz OF-721',type:'Urbano',seats:35,price:320000,source:'CISIOTAR'},
{id:'m16',model:'Mascarello Gran Via',year:'2019/2020',chassis:'Mercedes-Benz OF-1519',type:'Urbano',seats:30,price:490000,source:'Revenda de Ônibus'},
{id:'m17',model:'Mascarello Gran Via',year:'2021/2022',chassis:'Mercedes-Benz OF-1519',type:'Urbano',seats:31,price:580000,source:'Revenda de Ônibus'},
{id:'m18',model:'Marcopolo Senior',year:'2018/2019',chassis:'Mercedes-Benz LO-916',type:'Micro-ônibus urbano',seats:23,price:370000,source:'Revenda de Ônibus'},
{id:'m19',model:'Marcopolo Senior',year:'2019/2020',chassis:'Mercedes-Benz LO-916',type:'Micro-ônibus urbano',seats:25,price:380000,source:'Revenda de Ônibus'},
{id:'m20',model:'Caio Fox',year:'2018/2019',chassis:'Mercedes-Benz LO-916',type:'Micro-ônibus urbano',seats:23,price:340000,source:'Revenda de Ônibus'},
{id:'m21',model:'Neobus Mega com elevador',year:'2012/2012',chassis:'Mercedes-Benz OF-1519',type:'Urbano acessível',seats:32,price:120000,source:'CISIOTAR'},
{id:'m22',model:'Marcopolo Paradiso G7 1050',year:'2011/2012',chassis:'Scania K310 4x2',type:'Rodoviário',seats:46,price:300000,source:'Revenda de Ônibus'},
{id:'m23',model:'Marcopolo Paradiso G7 1050',year:'2012/2013',chassis:'Volvo B340',type:'Rodoviário',seats:46,price:360000,source:'Revenda de Ônibus'},
{id:'m24',model:'Marcopolo Paradiso G7 1050',year:'2013/2014',chassis:'Scania K310 4x2',type:'Rodoviário',seats:46,price:460000,source:'Revenda de Ônibus'},
{id:'m25',model:'Marcopolo Paradiso G7 1050',year:'2013/2014',chassis:'Scania K310 4x2',type:'Rodoviário',seats:46,price:449000,source:'Revenda de Ônibus'},
{id:'m26',model:'Marcopolo Paradiso G7 1050',year:'2015/2015',chassis:'Mercedes-Benz O500 R',type:'Rodoviário',seats:50,price:470000,source:'SuperCaminhões'},
{id:'m27',model:'Marcopolo Viaggio G7 1050',year:'2017/2017',chassis:'Mercedes-Benz O500 RS',type:'Rodoviário',seats:46,price:650000,source:'Revenda de Ônibus'},
{id:'m28',model:'Marcopolo Paradiso G7 1200',year:'2013/2013',chassis:'Mercedes-Benz O500 RSD',type:'Rodoviário',seats:46,price:425000,source:'Revenda de Ônibus'},
{id:'m29',model:'Marcopolo New G7 1200',year:'2019/2020',chassis:'Mercedes-Benz O500 RS',type:'Rodoviário',seats:46,price:900000,source:'Revenda de Ônibus'},
{id:'m30',model:'Marcopolo New G7 1600 LD',year:'2019/2020',chassis:'Mercedes-Benz O500 RSD',type:'Rodoviário',seats:46,price:1000000,source:'Revenda de Ônibus'},
{id:'m31',model:'Marcopolo New G7 1800 DD',year:'2019/2020',chassis:'Mercedes-Benz O500 RSD',type:'Rodoviário double-decker',seats:56,price:1100000,source:'Revenda de Ônibus'},
{id:'m32',model:'Marcopolo New G7 1800 DD 4 eixos',year:'2019/2020',chassis:'Mercedes-Benz O500 RSD 4 eixos',type:'Rodoviário double-decker',seats:54,price:1200000,source:'Revenda de Ônibus'},
{id:'m33',model:'Marcopolo Paradiso DD 1800 G8',year:'2023/2024',chassis:'Mercedes-Benz O500 RSD 8x2',type:'Rodoviário double-decker',seats:54,price:2150000,source:'Revenda de Ônibus'},
{id:'m34',model:'Comil Campione 345',year:'2019/2020',chassis:'Volkswagen 17.230 S',type:'Rodoviário',seats:46,price:650000,source:'Revenda de Ônibus'},
{id:'m35',model:'Busscar El Bus 320L',year:'2021/2022',chassis:'Volkswagen 17.230 S',type:'Rodoviário',seats:46,price:720000,source:'Revenda de Ônibus'},
{id:'m36',model:'Comil Versatile Gold',year:'2024/2025',chassis:'Volkswagen 17.230 S',type:'Rodoviário',seats:46,price:850000,source:'Revenda de Ônibus'},
{id:'m37',model:'Marcopolo Ideale 770',year:'2013/2013',chassis:'Mercedes-Benz OF-1721',type:'Fretamento / rodoviário',seats:46,price:330000,source:'Revenda de Ônibus'},
{id:'m38',model:'Marcopolo Viaggio 900 G7',year:'2013/2013',chassis:'Mercedes-Benz OF-1721',type:'Rodoviário',seats:50,price:360000,source:'Revenda de Ônibus'},
{id:'m39',model:'Marcopolo Ideale 800',year:'2017/2018',chassis:'Volkswagen 17.230',type:'Fretamento / rodoviário',seats:46,price:530000,source:'Revenda de Ônibus'},
{id:'m40',model:'Irizar Century S',year:'2011/2011',chassis:'Scania K310 4x2',type:'Rodoviário',seats:46,price:270000,source:'Referência simulada'},
{id:'m41',model:'Caio Apache VIP IV',year:'2018/2019',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:39,price:390000,source:'Estimativa de simulação'},
{id:'m42',model:'Caio Apache VIP V',year:'2022/2023',chassis:'Mercedes-Benz OF-1721 Euro V',type:'Urbano',seats:40,price:680000,source:'Estimativa de simulação'},
{id:'m43',model:'Caio Apache VIP VI',year:'2025/2026',chassis:'Mercedes-Benz OF-1726 Euro VI',type:'Urbano',seats:42,price:920000,source:'Estimativa de simulação'},
{id:'m44',model:'Caio Millennium V Padron',year:'2020/2021',chassis:'Mercedes-Benz O-500U',type:'Urbano padron',seats:42,price:720000,source:'Estimativa de simulação'},
{id:'m45',model:'Caio Millennium V Articulado',year:'2021/2022',chassis:'Mercedes-Benz O-500 UA 6x2',type:'Urbano articulado',seats:55,price:1350000,source:'Estimativa de simulação'},
{id:'m46',model:'Caio eMillennium elétrico',year:'2024/2025',chassis:'Chassi elétrico — especificação depende da versão',type:'Urbano elétrico',seats:35,price:2450000,fuel:'Elétrico (bateria)',tankL:0,kmL:null,source:'Estimativa de simulação',lengthM:12.5,widthM:2.55,heightM:3.4},
{id:'m47',model:'Caio Foz Super',year:'2018/2019',chassis:'Mercedes-Benz LO-916',type:'Micro-ônibus urbano',seats:24,price:290000,source:'Estimativa de simulação',lengthM:8.0,widthM:2.35,heightM:3.0},
{id:'m48',model:'Caio Foz 2400',year:'2021/2022',chassis:'Mercedes-Benz LO-916',type:'Micro-ônibus urbano',seats:25,price:410000,source:'Estimativa de simulação',lengthM:8.5,widthM:2.35,heightM:3.05},
{id:'m49',model:'Marcopolo Torino S',year:'2023/2024',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:40,price:780000,source:'Estimativa de simulação'},
{id:'m50',model:'Marcopolo Torino articulado',year:'2018/2019',chassis:'Scania K320 UA 6x2',type:'Urbano articulado',seats:55,price:990000,source:'Estimativa de simulação',lengthM:18.6,widthM:2.60,heightM:3.35},
{id:'m51',model:'Marcopolo Viale BRT',year:'2012/2013',chassis:'Volvo B340M 6x2',type:'Urbano articulado BRT',seats:50,price:430000,source:'Estimativa de simulação',lengthM:18.8,widthM:2.60,heightM:3.45},
{id:'m52',model:'Marcopolo Viale',year:'2010/2011',chassis:'Mercedes-Benz OF-1722',type:'Urbano',seats:42,price:150000,source:'Estimativa de simulação'},
{id:'m53',model:'Marcopolo Attivi elétrico',year:'2024/2025',chassis:'Plataforma elétrica — versão a confirmar',type:'Urbano elétrico',seats:34,price:2350000,fuel:'Elétrico (bateria)',tankL:0,kmL:null,source:'Estimativa de simulação',lengthM:12.5,widthM:2.55,heightM:3.4},
{id:'m54',model:'Marcopolo Senior Urbano',year:'2022/2023',chassis:'Mercedes-Benz LO-916',type:'Micro-ônibus urbano',seats:24,price:430000,source:'Estimativa de simulação',lengthM:8.3,widthM:2.35,heightM:3.09},
{id:'m55',model:'Volare Attack 8 Escolar',year:'2020/2021',chassis:'Agrale MA 10.0',type:'Micro-ônibus escolar',seats:30,price:330000,source:'Estimativa de simulação',lengthM:7.0,widthM:2.3,heightM:3.0},
{id:'m56',model:'Volare Fly 10 Urbano',year:'2023/2024',chassis:'Agrale MA 10.0',type:'Micro-ônibus urbano',seats:30,price:510000,source:'Estimativa de simulação',lengthM:8.5,widthM:2.35,heightM:3.1},
{id:'m57',model:'Volare Fly 12',year:'2024/2025',chassis:'Agrale MA 12.0',type:'Micro-ônibus intermunicipal',seats:42,price:660000,source:'Estimativa de simulação',lengthM:9.5,widthM:2.4,heightM:3.3},
{id:'m58',model:'Mascarello Granmidi',year:'2021/2022',chassis:'Mercedes-Benz OF-1519',type:'Urbano midi',seats:30,price:520000,source:'Estimativa de simulação',lengthM:10.8,widthM:2.55,heightM:3.25},
{id:'m59',model:'Mascarello Granmetro',year:'2018/2019',chassis:'Mercedes-Benz O-500U',type:'Urbano padron',seats:42,price:650000,source:'Estimativa de simulação'},
{id:'m60',model:'Mascarello Horizon Escolar',year:'2022/2023',chassis:'Volkswagen 9.180',type:'Micro-ônibus escolar',seats:29,price:390000,source:'Estimativa de simulação',lengthM:8.5,widthM:2.35,heightM:3.1},
{id:'m61',model:'Mascarello Roma R6',year:'2022/2023',chassis:'Volkswagen 17.230',type:'Intermunicipal / fretamento',seats:46,price:720000,source:'Estimativa de simulação'},
{id:'m62',model:'Comil Svelto',year:'2015/2016',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:42,price:260000,source:'Estimativa de simulação'},
{id:'m63',model:'Comil Svelto Midi',year:'2023/2024',chassis:'Mercedes-Benz OF-1519',type:'Urbano midi',seats:30,price:590000,source:'Estimativa de simulação',lengthM:10.8,widthM:2.55,heightM:3.25},
{id:'m64',model:'Comil Campione 3.25',year:'2019/2020',chassis:'Mercedes-Benz OF-1721',type:'Fretamento / rodoviário',seats:46,price:610000,source:'Estimativa de simulação'},
{id:'m65',model:'Comil Campione 3.45',year:'2023/2024',chassis:'Mercedes-Benz OF-1724',type:'Fretamento / rodoviário',seats:46,price:890000,source:'Estimativa de simulação'},
{id:'m66',model:'Comil Campione Invictus 1050',year:'2024/2025',chassis:'Volvo B340R 4x2',type:'Rodoviário',seats:46,price:1450000,source:'Estimativa de simulação'},
{id:'m67',model:'Comil Campione Invictus 1200',year:'2023/2024',chassis:'Mercedes-Benz O-500 RS',type:'Rodoviário',seats:46,price:1350000,source:'Estimativa de simulação'},
{id:'m68',model:'Comil Campione Invictus HD',year:'2024/2025',chassis:'Scania K410 4x2',type:'Rodoviário high-deck',seats:44,price:1650000,source:'Estimativa de simulação'},
{id:'m69',model:'Comil Campione Invictus DD',year:'2022/2023',chassis:'Scania K440 8x2',type:'Rodoviário double-decker',seats:60,price:1950000,source:'Estimativa de simulação',lengthM:14.0,widthM:2.6,heightM:4.1},
{id:'m70',model:'Busscar El Buss 320',year:'2018/2019',chassis:'Volkswagen 17.230',type:'Rodoviário / fretamento',seats:46,price:590000,source:'Estimativa de simulação'},
{id:'m71',model:'Busscar El Buss 340',year:'2022/2023',chassis:'Mercedes-Benz OF-1724',type:'Intermunicipal / fretamento',seats:46,price:790000,source:'Estimativa de simulação'},
{id:'m72',model:'Busscar Vissta Buss 340',year:'2023/2024',chassis:'Volkswagen 17.230',type:'Rodoviário',seats:46,price:890000,source:'Estimativa de simulação'},
{id:'m73',model:'Busscar Vissta Buss 360',year:'2024/2025',chassis:'Mercedes-Benz O-500 RS',type:'Rodoviário',seats:46,price:1450000,source:'Estimativa de simulação'},
{id:'m74',model:'Busscar Vissta Buss DD',year:'2020/2021',chassis:'Scania K440 8x2',type:'Rodoviário double-decker',seats:58,price:1650000,source:'Estimativa de simulação',lengthM:14.0,widthM:2.6,heightM:4.1},
{id:'m75',model:'Irizar i6',year:'2017/2018',chassis:'Scania K360 4x2',type:'Rodoviário',seats:46,price:820000,source:'Estimativa de simulação'},
{id:'m76',model:'Irizar i8',year:'2022/2023',chassis:'Volvo B420R 6x2',type:'Rodoviário',seats:46,price:1550000,source:'Estimativa de simulação'},
{id:'m77',model:'Neobus Mega Plus',year:'2019/2020',chassis:'Mercedes-Benz OF-1721',type:'Urbano',seats:42,price:520000,source:'Estimativa de simulação'},
{id:'m78',model:'Neobus New Mega BRT articulado',year:'2021/2022',chassis:'Volvo B340M 6x2',type:'Urbano articulado BRT',seats:55,price:1300000,source:'Estimativa de simulação',lengthM:18.8,widthM:2.6,heightM:3.5},
{id:'m79',model:'Marcopolo Viaggio G8 900',year:'2024/2025',chassis:'Volvo B320R 4x2',type:'Rodoviário',seats:44,price:1320000,source:'Estimativa de simulação'},
{id:'m80',model:'Marcopolo Paradiso G8 1350',year:'2023/2024',chassis:'Mercedes-Benz O-500 RS 4x2',type:'Rodoviário high-deck',seats:46,price:1750000,source:'Estimativa de simulação',lengthM:13.2,widthM:2.6,heightM:3.9}
].map(enrichMarketBus);
function renderMarket(){
  if(!$('#busMarketGrid'))return;
  const q=norm($('#marketSearch').value);const rows=BUS_MARKET.filter(x=>!q||norm(`${x.model} ${x.chassis} ${x.type} ${x.year} ${x.seats} ${x.totalCapacity} ${x.standing} ${x.traction} ${x.configuration} ${x.fuel}`).includes(q));
  const pageCount=Math.max(1,Math.ceil(rows.length/20));marketPage=Math.min(marketPage,pageCount-1);marketViewRows=rows.slice(marketPage*20,marketPage*20+20);
  $('#marketPageLabel').textContent=rows.length?`Mostrando ${marketPage*20+1}–${Math.min((marketPage+1)*20,rows.length)} de ${rows.length} veículos. Quilometragem e preço são dados de simulação; confirme a ficha real antes de qualquer compra.`:'Nenhum ônibus corresponde à busca.';
  $('#marketPrev').disabled=marketPage===0;$('#marketNext').disabled=marketPage>=pageCount-1;
  $('#busMarketGrid').innerHTML=marketViewRows.map(x=>{const down=x.price*0.2,monthly=loanMonthlyPayment(x.price-down,48,1.8);const km=Number(x.kmDriven||0).toLocaleString('pt-BR');const dim=`${numberPt(x.lengthM,2)} m × ${numberPt(x.widthM,2)} m × ${numberPt(x.heightM,2)} m`;const tank=x.fuel==='Elétrico (bateria)'?'Bateria elétrica':`${x.tankL} L`;const consumption=x.kmL==null?'kWh/km varia por ciclo':`~${numberPt(x.kmL,1)} km/L`;return `<article class="market-bus-card"><div class="market-bus-top"><span class="market-category">${escapeHtml(x.type)}</span><span class="market-year">${escapeHtml(x.year)}</span></div><h3>${escapeHtml(x.model)}</h3><p class="market-chassis">${escapeHtml(x.chassis)}</p><div class="market-specs"><span><small>Passageiros sentados</small><strong>${x.seated}</strong></span><span><small>Em pé (estimativa)</small><strong>${x.standing}</strong></span><span><small>Capacidade total estimada</small><strong>${x.totalCapacity} passageiros</strong></span><span><small>Quilometragem simulada</small><strong>${km} km</strong></span></div><details class="market-detail"><summary>Ver ficha técnica completa</summary><div class="market-detail-grid"><div><small>Dimensões (C × L × A)</small><strong>${dim}</strong></div><div><small>Configuração</small><strong>${escapeHtml(x.configuration)}</strong></div><div><small>Chassi / motor informado</small><strong>${escapeHtml(x.engine)}</strong></div><div><small>Tração / eixos</small><strong>${escapeHtml(x.traction)} · ${x.axles} eixos</strong></div><div><small>Combustível</small><strong>${escapeHtml(x.fuel)}</strong></div><div><small>Tanque / bateria</small><strong>${tank}</strong></div><div><small>Consumo de referência</small><strong>${consumption}</strong></div><div><small>Câmbio</small><strong>${escapeHtml(x.transmission)}</strong></div><div><small>Portas</small><strong>${x.doors}</strong></div><div><small>Ar-condicionado</small><strong>${escapeHtml(x.airConditioning)}</strong></div><div><small>Acessibilidade</small><strong>${escapeHtml(x.accessibility)}</strong></div><div><small>Perfil</small><strong>${escapeHtml(x.type)}</strong></div></div><p class="market-data-disclaimer">${escapeHtml(x.dataStatus)}. Lotação em pé é apenas estimativa para o simulador, não autorização legal de capacidade.</p></details><div class="market-price">${money(x.price)}<small>preço ilustrativo do mercado simulado — não é anúncio ativo</small></div><div class="market-finance-estimate"><strong>${money(monthly)}/mês</strong><small>Simulação: entrada ${money(down)} + 48 parcelas a 1,8% a.m.</small></div><p class="market-source">Ficha de referência: ${escapeHtml(x.source)}. Hodômetro, preço, estado, documentos e disponibilidade são fictícios ou precisam de conferência.</p><button class="primary-button market-finance-button" type="button" data-market-finance="${escapeHtml(x.id)}">Simular compra / financiamento</button></article>`;}).join('');
}
$('#marketSearch').addEventListener('input',()=>{marketPage=0;renderMarket();});
$('#marketNext').addEventListener('click',()=>{marketPage++;renderMarket();});
$('#marketPrev').addEventListener('click',()=>{marketPage=Math.max(0,marketPage-1);renderMarket();});
$('#marketRefresh').addEventListener('click',()=>{marketPage=marketPage+1>=Math.ceil(BUS_MARKET.filter(x=>!norm($('#marketSearch').value)||norm(`${x.model} ${x.chassis} ${x.type} ${x.year} ${x.seats} ${x.totalCapacity} ${x.standing} ${x.traction} ${x.configuration} ${x.fuel}`).includes(norm($('#marketSearch').value))).length/20)?0:marketPage+1;renderMarket();showToast(`Catálogo atualizado: lote ${marketPage+1}. Os preços e hodômetros são fictícios e servem apenas para a simulação.`);});
$('#busMarketGrid').addEventListener('click',event=>{const b=event.target.closest('[data-market-finance]');if(!b)return;if(!assertOwner())return;const item=BUS_MARKET.find(x=>x.id===b.dataset.marketFinance);if(!item)return;$('#finCompany').value=GROUP_COMPANIES.includes($('#finCompany').value)?$('#finCompany').value:'Progresso';$('#finModel').value=`${item.model} ${item.year}`;$('#finChassis').value=item.chassis;$('#finYear').value=item.year;$('#finPrice').value=String(item.price);$('#finPrefix').value=$('#finPrefix').value||`GC-${String(BUS_MARKET.indexOf(item)+1).padStart(3,'0')}`;updateFinancePreview();$('#financedBusForm').scrollIntoView({behavior:'smooth',block:'start'});showToast('Modelo e preço de referência enviados ao simulador de financiamento.');});

// Caixa: histórico de viagens normais + resultado líquido das operações simuladas + lançamentos manuais.
function readOperationCashState(){
  try{
    const raw=JSON.parse(localStorage.getItem(OPERATION_CASH_STATE_KEY)||'null');
    if(!raw||typeof raw!=='object')return {totalNet:0,operationNets:{},lastTripCounts:{},entries:[]};
    return {totalNet:Number(raw.totalNet)||0,operationNets:raw.operationNets&&typeof raw.operationNets==='object'?raw.operationNets:{},lastTripCounts:raw.lastTripCounts&&typeof raw.lastTripCounts==='object'?raw.lastTripCounts:{},entries:Array.isArray(raw.entries)?raw.entries:[]};
  }catch(error){return {totalNet:0,operationNets:{},lastTripCounts:{},entries:[]};}
}
function writeOperationCashState(value){
  try{localStorage.setItem(OPERATION_CASH_STATE_KEY,JSON.stringify({...value,entries:(value.entries||[]).slice(-5000)}));return true;}
  catch(error){showToast('Não foi possível salvar o lucro da operação no caixa. Verifique o espaço livre do navegador.');return false;}
}
function operationLifetimeNet(op){
  const values=Object.values(op.driverTotals&&typeof op.driverTotals==='object'?op.driverTotals:{});
  if(values.length)return values.reduce((sum,item)=>sum+(Number(item.net)||0),0);
  return (Array.isArray(op.tripLog)?op.tripLog:[]).reduce((sum,item)=>sum+(Number(item.net)||0),0);
}
function operationCashEntry(op,net,kind,trip){
  const positive=Number(net)>=0,stamp=trip?.completedAt||op.lastTripCompletedAt||op.startedAt||op.createdAt||new Date().toISOString();
  const d=new Date(stamp);const date=Number.isNaN(d.getTime())?dateTodayLocal():`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const route=`${op.company||'Empresa'} · ${op.city||'Cidade não informada'} · Linha ${op.line||'sem nome'}`;
  const desc=kind==='trip'?`${route} · ${trip?.driver||'Motorista não definido'} · viagem ${trip?.tripNumber||''} · ${op.busModel||'Ônibus'} prefixo ${op.prefix||'—'}`:`${route} · lucro acumulado anterior à integração (${Number(op.completedTrips)||0} viagem(ns), motoristas escalados)`;
  return {id:kind==='trip'?`opcash-${op.id}-${trip.tripNumber}`:`opcash-baseline-${op.id}`,date,direction:positive?'in':'out',amount:Math.abs(Number(net)||0),category:positive?(kind==='trip'?'Lucro de operação de linha':'Lucro acumulado anterior da operação'):(kind==='trip'?'Prejuízo de operação de linha':'Prejuízo acumulado anterior da operação'),description:desc,auto:true,source:'operationSimulation',operationId:op.id,tripNumber:trip?.tripNumber||null,createdAt:stamp};
}
function syncOperationCashState(operations){
  const state=readOperationCashState();let changed=false;
  for(const op of operations){
    const id=String(op.id||'');if(!id)continue;
    const currentNet=operationLifetimeNet(op),currentTrips=Math.max(0,Number(op.completedTrips)||0);
    if(!Object.prototype.hasOwnProperty.call(state.lastTripCounts,id)){
      // Migra o lucro já acumulado na versão anterior para o caixa uma única vez.
      state.operationNets[id]=currentNet;state.lastTripCounts[id]=currentTrips;state.totalNet+=currentNet;
      if(Math.abs(currentNet)>0.004)state.entries.push(operationCashEntry(op,currentNet,'baseline'));
      changed=true;continue;
    }
    const priorNet=Number(state.operationNets[id])||0,priorTrips=Math.max(0,Number(state.lastTripCounts[id])||0),delta=currentNet-priorNet;
    const fresh=(Array.isArray(op.tripLog)?op.tripLog:[]).filter(t=>Number(t.tripNumber)>priorTrips&&Number(t.tripNumber)<=currentTrips).sort((a,b)=>Number(a.tripNumber)-Number(b.tripNumber));
    let freshNet=0;for(const trip of fresh){const net=Number(trip.net)||0;freshNet+=net;if(Math.abs(net)>0.004)state.entries.push(operationCashEntry(op,net,'trip',trip));}
    const missedNet=delta-freshNet;
    // Se o navegador ficou fechado por muitas viagens e o log rotativo já as removeu,
    // lança a diferença restante como recuperação consolidada, sem perder o lucro.
    if(Math.abs(missedNet)>0.004){state.entries.push({...operationCashEntry(op,missedNet,'trip',{tripNumber:`${priorTrips+1}–${currentTrips}`,driver:'Motoristas escalados',completedAt:op.lastTripCompletedAt}),id:`opcash-recovery-${id}-${priorTrips}-${currentTrips}`,category:missedNet>=0?'Lucro recuperado de viagens da operação':'Prejuízo recuperado de viagens da operação',description:`${op.company||'Empresa'} · ${op.city||'Cidade não informada'} · Linha ${op.line||'sem nome'} · viagens recuperadas após reabertura do site (${priorTrips+1} a ${currentTrips})`});}
    if(Math.abs(delta)>0.004||currentTrips!==priorTrips){state.totalNet+=delta;changed=true;}
    state.operationNets[id]=currentNet;state.lastTripCounts[id]=currentTrips;
  }
  if(changed&&!writeOperationCashState(state))return false;
  return changed;
}
function cashBreakdown(){
  const trips=loadHistory(),ledger=cashLedger(),ops=readOperationCashState();
  const revenue=trips.reduce((s,x)=>s+Number(x.revenue||0),0),diesel=trips.reduce((s,x)=>s+Number(x.fuelCost||0),0);
  const manualAndOther=ledger.filter(x=>x.source!=='operationSimulation');
  const income=manualAndOther.filter(x=>x.direction==='in').reduce((s,x)=>s+Number(x.amount||0),0),expenses=manualAndOther.filter(x=>x.direction==='out').reduce((s,x)=>s+Number(x.amount||0),0);
  const operationProfit=Number(ops.totalNet)||0;
  return{trips:trips.length,revenue,diesel,tripNet:revenue-diesel,operationProfit,otherIncome:income,otherExpenses:expenses,balance:revenue-diesel+operationProfit+income-expenses};
}
function allCashMovements(){
  const tripRows=[];
  loadHistory().forEach(t=>{const date=t.timestamp?new Date(t.timestamp):new Date();const iso=Number.isNaN(date.getTime())?dateTodayLocal():`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;tripRows.push({id:`triprev-${t.id}`,date:iso,direction:'in',amount:Number(t.revenue||0),category:'Arrecadação de viagem',description:`${t.dayLabel||'Dia'} · ${t.company||'Empresa'} · ${t.busPrefix||t.busModel||'Ônibus'} · ${t.paid||0} pagantes`,auto:true,source:'normalTrip'});if(Number(t.fuelCost||0)>0)tripRows.push({id:`tripdiesel-${t.id}`,date:iso,direction:'out',amount:Number(t.fuelCost||0),category:'Diesel da viagem',description:`${t.dayLabel||'Dia'} · ${t.company||'Empresa'} · diesel ${numberPt(t.liters||0,2)} L`,auto:true,source:'normalTrip'});});
  const opState=readOperationCashState(),opEntries=opState.entries||[];
  const listedNet=opEntries.reduce((sum,x)=>sum+(x.direction==='in'?1:-1)*Number(x.amount||0),0),unlistedNet=(Number(opState.totalNet)||0)-listedNet;
  const summary= Math.abs(unlistedNet)>0.004?[{id:'opcash-archive-summary',date:dateTodayLocal(),direction:unlistedNet>=0?'in':'out',amount:Math.abs(unlistedNet),category:unlistedNet>=0?'Lucro acumulado de operações anteriores':'Prejuízo acumulado de operações anteriores',description:'Resumo de movimentos antigos da Operação de Linha; os últimos 5.000 lançamentos detalhados são mantidos.',auto:true,source:'operationSimulation'}]:[];
  return [...tripRows,...opEntries,...summary,...cashLedger().map(x=>({...x,auto:!!x.auto}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.id).localeCompare(String(a.id)));
}
function renderCashDashboard(){if(!$('#cashSummary'))return;const c=cashBreakdown();$('#cashSummary').innerHTML=[['Arrecadação total das viagens normais',money(c.revenue)],['Diesel registrado nas viagens normais',`− ${money(c.diesel)}`],['Resultado das viagens normais antes de outros custos',money(c.tripNet),c.tripNet>=0?'positive':'negative'],['Lucro líquido das operações em linha',money(c.operationProfit),c.operationProfit>=0?'positive':'negative'],['Outras entradas',money(c.otherIncome)],['Outras saídas',money(c.otherExpenses)],['Saldo disponível do caixa',money(c.balance),c.balance>=0?'positive':'negative']].map(([l,v,k])=>moneyStat(l,v,k||'')).join('');
  const rows=allCashMovements();$('#cashLedgerList').innerHTML=rows.length?rows.slice(0,40).map(x=>`<article class="record-item"><div class="record-item-top"><div><strong class="cash-${x.direction}">${x.direction==='in'?'+ ':'− '}${money(x.amount)} · ${escapeHtml(x.category)}</strong><small>${escapeHtml(localDate(x.date))} · ${escapeHtml(x.description||'Sem descrição')}${x.auto?(x.source==='operationSimulation'?' · automático da Operação de Linha':x.source==='onlineFretamento'?' · Atendimento Online':' · automático das viagens'):''}</small></div>${x.auto?'<span class="doc-status-tag">Automático</span>':`<button type="button" class="record-danger" data-cash-delete="${escapeHtml(x.id)}">Excluir</button>`}</div></article>`).join(''):recordsEmpty('Sem movimentos. As viagens finalizadas aparecerão automaticamente aqui.');}
$('#cashDate').value=dateTodayLocal();
$('#cashEntryForm').addEventListener('submit',event=>{event.preventDefault();if(!assertOwner())return;const date=$('#cashDate').value,direction=$('#cashDirection').value,category=$('#cashCategory').value,amount=readToolValue('cashAmount'),description=$('#cashDescription').value.trim();if(!date||!description||amount===null||amount<=0){showToast('Informe data, descrição e valor maior que zero.');return;}if(direction==='out'&&amount>cashBreakdown().balance+0.005){showToast(`Saída recusada: o caixa disponível é ${money(cashBreakdown().balance)}.`);return;}const rows=cashLedger();rows.push({id:makeId(),date,direction,category,amount,description,createdAt:new Date().toISOString()});if(!writeArrayKey(CASH_LEDGER_KEY,rows))return;$('#cashEntryForm').reset();$('#cashDate').value=dateTodayLocal();renderCashDashboard();renderFinanceList();showToast('Movimento do caixa registrado.');});
$('#cashLedgerList').addEventListener('click',event=>{const b=event.target.closest('[data-cash-delete]');if(!b)return;if(!assertOwner())return;if(!window.confirm('Excluir este movimento manual do caixa?'))return;writeArrayKey(CASH_LEDGER_KEY,cashLedger().filter(x=>x.id!==b.dataset.cashDelete));renderCashDashboard();renderFinanceList();showToast('Movimento removido.');});
$('#cashExportCsv').addEventListener('click',()=>{if(!assertOwner())return;const rows=allCashMovements();const header=['Data','Tipo','Categoria','Valor','Descrição','Origem'];const content=[header,...rows.map(x=>[x.date,x.direction==='in'?'Entrada':'Saída',x.category,x.amount,x.description||'',x.source==='operationSimulation'?'Operação de linha automática':x.auto?'Viagem automática':'Manual'])].map(r=>r.map(csvCell).join(';')).join('\n');downloadTextFile('grupo-conect-caixa.csv',content,'text/csv;charset=utf-8');showToast('Livro-caixa exportado em CSV.');});

// Financiamentos pelo sistema Price, com caixa obrigatório para entrada e para cada parcela.
function renderFinanceList(){if(!$('#financeList'))return;const rows=financedBuses();$('#financeList').innerHTML=rows.length?rows.slice().reverse().map(x=>{const rem=Math.max(0,x.installmentCount-x.paidCount),due=addMonthsToISO(x.firstDueDate,x.paidCount),late=daysLateFrom(due);return `<article class="record-item finance-list-item"><div class="record-item-top"><div><strong>${escapeHtml(x.company)} · ${escapeHtml(x.prefix)} · ${escapeHtml(x.model)}</strong><small>${escapeHtml(x.chassis)} · ano/modelo ${escapeHtml(x.year)} · ${x.paidCount}/${x.installmentCount} parcelas pagas · ${rem} restantes · parcela-base ${money(x.installmentAmount)}${rem?` · vencimento ${localDate(due)}${late?` · ${late} dia(s) em atraso`:''}`:' · quitado'}</small></div><button type="button" class="secondary-action-button" data-fin-view="${escapeHtml(x.id)}">Ver parcelas</button></div></article>`;}).join(''):recordsEmpty('Nenhum financiamento cadastrado. Você também pode enviar um ônibus do Mercado para este formulário.');}
function updateFinancePreview(){const price=readToolValue('finPrice'),down=readToolValue('finDownPayment'),n=readToolValue('finInstallments'),rate=readToolValue('finMonthlyRate');if(price===null||down===null||n===null||rate===null||price<=0||down>price||n<1){$('#finPreview').textContent='Confira o preço, a entrada, o prazo e a taxa.';return;}const principal=price-down,payment=loanMonthlyPayment(principal,n,rate);$('#finPreview').innerHTML=`<strong>Crédito financiado: ${money(principal)}</strong><span>Parcela estimada: <b>${money(payment)}</b> · total das parcelas ${money(payment*n)} · juros estimados ${money(payment*n-principal)}. Entrada de ${money(down)} não inclui custos acessórios ou seguros.`;}
['finPrice','finDownPayment','finInstallments','finMonthlyRate'].forEach(id=>$('#'+id).addEventListener('input',updateFinancePreview));
$('#finFirstDue').value=addMonthsToISO(dateTodayLocal(),1);
// Inicializa o configurador 0 km com opções compatíveis com o segmento selecionado.
gcZeroKmRefreshModels();$('#zeroKmDownPct').disabled=true;$('#zeroKmMonths').disabled=true;$('#zeroKmRate').disabled=true;gcZeroKmRenderHistory();
function renderFinanceDetail(id){const f=financedBuses().find(x=>x.id===id);if(!f)return;currentFinanceId=id;$('#financeDetailTitle').textContent=`${f.prefix} · ${f.model}`;const remaining=Math.max(0,f.installmentCount-f.paidCount),due=addMonthsToISO(f.firstDueDate,f.paidCount),daysLate=remaining?daysLateFrom(due):0,lateFine=daysLate?f.installmentAmount*(f.lateFinePct/100):0,lateInterest=daysLate?f.installmentAmount*(f.lateInterestPct/100)*(daysLate/30):0,totalDue=remaining?f.installmentAmount+lateFine+lateInterest:0;
  $('#financeDetailStats').innerHTML=[['Preço do ônibus',money(f.price)],['Entrada paga',money(f.downPayment)],['Valor financiado',money(f.principal)],['Parcelas pagas',`${f.paidCount}/${f.installmentCount}`],['Parcelas restantes',remaining],['Parcela-base',money(f.installmentAmount)]].map(([l,v])=>moneyStat(l,v)).join('');
  $('#financeDueInfo').textContent=remaining?`Próximo vencimento: ${localDate(due)}. ${daysLate?`Atraso de ${daysLate} dia(s): multa simulada de ${money(lateFine)} + juros de mora de ${money(lateInterest)}. `:'Sem atraso até a data de hoje. '}Total necessário para pagar a próxima parcela: ${money(totalDue)}. Taxas de atraso aplicadas conforme os percentuais informados no cadastro do contrato; confira seu contrato real.`:'Financiamento quitado: não há parcelas pendentes.';
  $('#financePayInstallment').disabled=remaining===0;$('#financePayInstallment').textContent=remaining?`Pagar próxima parcela com o caixa · ${money(totalDue)}`:'Financiamento quitado';
  const payments=f.payments||[];$('#financePaymentHistory').innerHTML=payments.length?payments.slice().reverse().map(p=>`<article class="record-item"><div><strong>Parcela ${p.number} paga · ${money(p.total)}</strong><small>Vencimento ${localDate(p.dueDate)} · paga ${new Date(p.paidAt).toLocaleDateString('pt-BR')} · ${p.daysLate} dia(s) de atraso · encargos ${money(p.charges)}</small></div></article>`).join(''):recordsEmpty('Nenhuma parcela paga ainda.');$('#financeDetailPanel').hidden=false;
}
$('#financedBusForm').addEventListener('submit',event=>{event.preventDefault();if(!assertOwner())return;const company=$('#finCompany').value,model=$('#finModel').value.trim(),chassis=$('#finChassis').value.trim(),year=$('#finYear').value.trim(),prefix=$('#finPrefix').value.trim(),price=readToolValue('finPrice'),down=readToolValue('finDownPayment'),count=readToolValue('finInstallments'),rate=readToolValue('finMonthlyRate'),firstDue=$('#finFirstDue').value,fine=readToolValue('finLateFine'),lateRate=readToolValue('finLateInterest');
  if(!company||!model||!chassis||!year||!prefix||price===null||price<=0||down===null||down<0||down>price||count===null||count<1||rate===null||rate<0||!firstDue||fine===null||lateRate===null){showToast('Confira os dados do ônibus e do financiamento.');return;}
  const c=cashBreakdown();if(down>c.balance+0.005){showToast(`Entrada recusada: o caixa disponível é ${money(c.balance)} e a entrada informada é ${money(down)}. Registre um aporte ou reduza a entrada.`);return;}
  const principal=price-down,payment=loanMonthlyPayment(principal,count,rate);if(principal<=0){showToast('A entrada cobre o preço inteiro; use o cadastro de frota para compra à vista, sem financiamento.');return;}
  const row={id:makeId(),company,model,chassis,year,prefix,price,downPayment:down,principal,installmentCount:count,monthlyRate:rate,installmentAmount:payment,firstDueDate:firstDue,lateFinePct:fine,lateInterestPct:lateRate,paidCount:0,payments:[],createdAt:new Date().toISOString()};
  const frows=financedBuses();frows.push(row);if(!writeArrayKey(FINANCED_BUSES_KEY,frows))return;
  if(down>0){const led=cashLedger();led.push({id:makeId(),date:dateTodayLocal(),direction:'out',category:'Entrada de ônibus financiado',amount:down,description:`Entrada do ${prefix} · ${model}`,createdAt:new Date().toISOString()});writeArrayKey(CASH_LEDGER_KEY,led);}
  const fleet=ownerFleet();if(!fleet.some(x=>norm(x.company)===norm(company)&&norm(x.prefix)===norm(prefix))){fleet.push({id:makeId(),company,city:'',line:'',type:'Frota financeira',prefix,model,chassis,seats:45,tank:300,kmpl:2.5,fare:7.99,dieselPrice:7.99,createdAt:new Date().toISOString(),source:'financiamento'});writeArrayKey(OWNER_FLEET_KEY,fleet);}
  $('#financedBusForm').reset();$('#finInstallments').value='48';$('#finMonthlyRate').value='1.8';$('#finDownPayment').value='0';$('#finLateFine').value='2';$('#finLateInterest').value='1';$('#finFirstDue').value=addMonthsToISO(dateTodayLocal(),1);updateFinancePreview();renderFinanceList();renderCashDashboard();renderOwnerFleet();refreshOperationChoices();showToast(`Financiamento salvo: parcela estimada de ${money(payment)}.`);
});
$('#financeList').addEventListener('click',event=>{const b=event.target.closest('[data-fin-view]');if(!b)return;if(!assertOwner())return;renderFinanceDetail(b.dataset.finView);$('#financeDetailPanel').scrollIntoView({behavior:'smooth',block:'start'});});
$('#financeCloseDetail').addEventListener('click',()=>{$('#financeDetailPanel').hidden=true;currentFinanceId=null;});
$('#financePayInstallment').addEventListener('click',()=>{
  if(!assertOwner()||!currentFinanceId)return;const rows=financedBuses(),f=rows.find(x=>x.id===currentFinanceId);if(!f)return;const remaining=f.installmentCount-f.paidCount;if(remaining<=0){showToast('Este financiamento já está quitado.');return;}
  const due=addMonthsToISO(f.firstDueDate,f.paidCount),lateDays=daysLateFrom(due),fine=lateDays?f.installmentAmount*f.lateFinePct/100:0,interest=lateDays?f.installmentAmount*f.lateInterestPct/100*(lateDays/30):0,total=f.installmentAmount+fine+interest,breakdown=cashBreakdown();
  if(breakdown.balance+0.005<total){showToast(`Pagamento recusado: caixa ${money(breakdown.balance)}; necessário ${money(total)}. Registre uma entrada ou espere mais lucros de viagens.`);return;}
  const description=`Parcela ${f.paidCount+1}/${f.installmentCount} · ${f.prefix} · ${f.model}`;if(!window.confirm(`Confirmar pagamento de ${money(total)}?\nParcela: ${money(f.installmentAmount)}\nMulta: ${money(fine)}\nJuros de mora: ${money(interest)}\nCaixa após pagamento: ${money(breakdown.balance-total)}`))return;
  const payment={id:makeId(),number:f.paidCount+1,dueDate:due,paidAt:new Date().toISOString(),base:f.installmentAmount,fine,interest,charges:fine+interest,total,daysLate:lateDays};f.payments=f.payments||[];f.payments.push(payment);f.paidCount+=1;
  const ledger=cashLedger();ledger.push({id:makeId(),date:dateTodayLocal(),direction:'out',category:'Parcela de financiamento',amount:total,description,createdAt:new Date().toISOString()});
  if(!writeArrayKey(FINANCED_BUSES_KEY,rows)||!writeArrayKey(CASH_LEDGER_KEY,ledger))return;
  renderFinanceList();renderFinanceDetail(f.id);renderCashDashboard();showToast(`Parcela ${payment.number} paga e registrada no caixa.`);
});
$('#financeCopyContract').addEventListener('click',async()=>{if(!assertOwner()||!currentFinanceId)return;const f=financedBuses().find(x=>x.id===currentFinanceId);if(!f)return;const due=addMonthsToISO(f.firstDueDate,f.paidCount);const text=`GRUPO CONECT — RESUMO DE FINANCIAMENTO\nEmpresa: ${f.company}\nÔnibus: ${f.model} · ${f.year}\nPrefixo: ${f.prefix}\nChassi: ${f.chassis}\nPreço: ${money(f.price)} · Entrada: ${money(f.downPayment)} · Principal financiado: ${money(f.principal)}\nTaxa contratual simulada: ${numberPt(f.monthlyRate,2)}% a.m.\nParcela: ${money(f.installmentAmount)}\nPagas: ${f.paidCount}/${f.installmentCount} · Restantes: ${f.installmentCount-f.paidCount}\nPróximo vencimento: ${localDate(due)}\nMulta por atraso: ${f.lateFinePct}% · Juros de mora simulados: ${f.lateInterestPct}% a.m. simples\nDocumento de simulação para OMSI 2; confirme condições em contratos reais.`;showToast(await copyText(text)?'Resumo do financiamento copiado.':'Não foi possível copiar automaticamente.');});

// Relógio em tempo real da simulação. O timestamp persistido permite recuperar viagens concluídas
// depois de trocar de tela ou recarregar a página; não depende de um trabalho em segundo plano externo.
let lastOperationUiRenderAt=0;
let lastOperationUiSignature='';
function operationUiStateSignature(rows){
  return (Array.isArray(rows)?rows:[]).map(op=>[
    op.id,op.status,Number(op.completedTrips)||0,op.lastEvent||'',op.breakdownId||'',
    op.gcUserMaintenanceHoldOrderId||'',op.gcFuelPaused?'fuel-pause':'',
    op.gcInspectionPaused?'inspection-pause':'',op.replacementDispatch?.arrivesAt||'',
    op.vehicleCompany||'',op.prefix||'',op.pendingVehicleSwap?.id||'',op.pendingVehicleSwap?.busAtTerminal?'bus-at-terminal':'',
    op.gcIncidentActive?.id||'',op.gcIncidentActive?.endsAtMs||'',
    Array.isArray(op.tripLog)?op.tripLog.length:0
  ].join('~')).join('||');
}
function updateOperationLiveCards(rows, now=Date.now()){
  const panel=$('#operationViewerPanel');
  if(!panel||!panel.getClientRects().length)return;
  const byId=new Map(rows.map(op=>[String(op.id),op]));
  panel.querySelectorAll('[data-gc-operation-live]').forEach(card=>{
    const op=byId.get(String(card.dataset.gcOperationLive));
    if(!op)return;
    const sums=operationSummary(op,now),canProgress=operationIsRunning(op);
    const heading=card.querySelector('[data-gc-live-heading]');
    const clock=card.querySelector('[data-gc-live-time]');
    const progress=card.querySelector('[data-gc-live-progress]');
    const driver=card.querySelector('[data-gc-live-driver-name]');
    const shift=card.querySelector('[data-gc-live-shift]');
    const next=card.querySelector('[data-gc-live-next]');
    if(heading)heading.textContent=canProgress?(!sums.serviceOpen&&!sums.inTrip?'Serviço encerrado · retoma às 05:00':'Operação em andamento'):'Relógio da operação parado';
    if(clock)clock.textContent=`Horário simulado: ${sums.currentTime}`;
    if(progress)progress.style.width=`${canProgress?sums.progress:0}%`;
    if(driver)driver.textContent=sums.driver;
    if(shift)shift.textContent=opShiftLabel(sums.shift);
    if(next)next.textContent=canProgress?(!sums.serviceOpen&&!sums.inTrip?`Próxima partida às ${sums.nextDeparture} · chegada prevista ${sums.nextCompletion}`:'Próxima viagem conclui em '+opFormatCountdown(sums.remaining)):'Retome para continuar a contagem';
  });
}
function refreshLiveOperations(){
  // Em abas ocultas o relógio persistido continua válido; ao voltar, os listeners
  // visibilitychange/focus fazem a sincronização imediata sem gastar CPU em segundo plano.
  if (document.hidden) return;
  const now=Date.now();
  const rows=syncOperationRows(now);
  const panel=$('#operationViewerPanel');
  const panelVisible=!!(panel&&panel.getClientRects().length>0);
  if(!panelVisible)return;
  const signature=operationUiStateSignature(rows);
  const stateChanged=signature!==lastOperationUiSignature;
  const liveRefreshDue=rows.some(operationIsRunning)&&now-lastOperationUiRenderAt>=1000;
  // Mudanças reais recompõem os cartões; o relógio e a barra de progresso são
  // atualizados no próprio DOM, sem reconstruir toda a lista a cada poucos segundos.
  if(stateChanged){
    renderOperations();
    lastOperationUiRenderAt=now;
    lastOperationUiSignature=operationUiStateSignature(ownerOperations());
  }else if(liveRefreshDue){
    updateOperationLiveCards(rows,now);
    lastOperationUiRenderAt=now;
  }
}
setInterval(refreshLiveOperations,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLiveOperations();});
window.addEventListener('focus',refreshLiveOperations);

// Inicialização dos módulos da Área do Dono.
setupToday('cashDate');
refreshOperationChoices();
populateIncidentResponses();
updateOperationEconomicsHint();
renderOwnerFleet();renderOwnerScales();renderOperations();renderMarket();renderFinanceList();renderCashDashboard();updateFinancePreview();

// Atalhos da Colinha para abrir o módulo correspondente e descer ao painel indicado.
$$('[data-cheat-go]').forEach(button=>button.addEventListener('click',()=>{
  const target=button.dataset.cheatGo;
  if(target==='gps'){switchScreen('gpsTrackingScreen');$('#gpsUserSelect').value='Pablo';gcGpsSetAccess();return;}
  $('#ownerUserSelect').value='Pablo'; if(typeof activateOwnerArea==='function')activateOwnerArea();
  switchScreen('ownerAreaScreen');
  const anchor=target==='installments'?'ownerFinancePanel':target==='cash'?'ownerCashPanel':target==='operation'?'operationViewerPanel':'ownerFleetForm';
  window.setTimeout(()=>{const el=document.getElementById(anchor);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});if(target==='operation')toggleOperationCheatSheet(true);},80);
}));

// Colinha contextual da operação: pode ser aberta pelo painel principal ou durante uma ocorrência.
function toggleOperationCheatSheet(forceOpen){
  const panel=$('#ovOperationCheatSheet');
  const button=$('#ovToggleOperationCheatSheet');
  if(!panel||!button)return;
  const open=typeof forceOpen==='boolean'?forceOpen:panel.hidden;
  panel.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
  button.textContent=open?'📘 Ocultar colinha da operação':'📘 Colinha da operação de linha';
  if(open)panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('#ovToggleOperationCheatSheet')?.addEventListener('click',()=>toggleOperationCheatSheet());
$('#ovOpenCheatFromIncident')?.addEventListener('click',()=>toggleOperationCheatSheet(true));


/* Correções e módulos completos: GPS de paradas + intermunicipal independente. */
const GC_GPS_STORAGE_KEY = 'grupoConect.gpsStops.v1';
const GC_IC_STORAGE_KEY = 'grupoConect.intercity.v2';
const GC_IC_SEATED_CAPACITY = 44;
const GC_IC_STANDING_CAPACITY = 36;
const GC_IC_TOTAL_CAPACITY = GC_IC_SEATED_CAPACITY + GC_IC_STANDING_CAPACITY;
let gcGpsEditingId = null;

function gcSafeRead(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (error) { return fallback; }
}
function gcSafeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { showToast('Não foi possível salvar neste navegador. Verifique o espaço disponível.'); return false; }
}
function gcNowLocalInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function gcFormatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function gcMakeId(prefix = 'gc') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function gcNormalizeText(value) { return String(value ?? '').trim().toLocaleLowerCase('pt-BR'); }

// GPS manual: consulta por linha/ônibus, histórico, criação, edição e exclusão.
function gcGpsRows() {
  const rows = gcSafeRead(GC_GPS_STORAGE_KEY, []);
  return Array.isArray(rows) ? rows.filter((row) => row && row.id) : [];
}
function gcGpsSaveRows(rows) { return gcSafeWrite(GC_GPS_STORAGE_KEY, rows.slice(-1000)); }
function gcGpsIsPablo() { return $('#gpsUserSelect')?.value === 'Pablo'; }
function gcGpsSetAccess() {
  const pablo = gcGpsIsPablo();
  $('#gpsEditPanel').hidden = !pablo;
  $('#gpsAccessMessage').textContent = pablo
    ? 'Modo Pablo liberado nesta interface: você pode registrar, editar e excluir paradas. A seleção é demonstrativa, não é autenticação segura.'
    : 'Modo somente leitura: consulte as últimas paradas e o histórico. Selecione Pablo para liberar a edição neste navegador.';
  $('#gpsAccessMessage').classList.toggle('success', pablo);
  if (!pablo && gcGpsEditingId) gcGpsResetForm();
  gcRenderGps();
}
function gcGpsResetForm() {
  gcGpsEditingId = null;
  $('#gpsStopForm').reset();
  $('#gpsStopDateTime').value = gcNowLocalInput();
  const submit = $('#gpsStopForm button[type="submit"]');
  if (submit) submit.textContent = 'Registrar parada →';
  const cancel = $('#gpsCancelEdit'); if (cancel) cancel.hidden = true;
}
function gcGpsBeginEdit(id) {
  if (!gcGpsIsPablo()) { showToast('Selecione Pablo para editar as paradas.'); return; }
  const row = gcGpsRows().find((item) => item.id === id);
  if (!row) return;
  gcGpsEditingId = id;
  $('#gpsVehicle').value = row.vehicle || '';
  $('#gpsLine').value = row.line || '';
  $('#gpsStopName').value = row.stop || '';
  const parsed = new Date(row.dateTime || row.createdAt);
  $('#gpsStopDateTime').value = Number.isNaN(parsed.getTime()) ? gcNowLocalInput() : new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('#gpsStopNote').value = row.note || '';
  const submit = $('#gpsStopForm button[type="submit"]');
  if (submit) submit.textContent = 'Salvar alterações →';
  const cancel = $('#gpsCancelEdit'); if (cancel) cancel.hidden = false;
  $('#gpsStopForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Parada carregada para edição.');
}
function gcRenderGps() {
  const rows = gcGpsRows().sort((a, b) => new Date(b.dateTime || b.createdAt) - new Date(a.dateTime || a.createdAt));
  const isPablo = gcGpsIsPablo();
  const latestByLine = new Map();
  rows.forEach((row) => {
    const key = `${gcNormalizeText(row.vehicle)}|${gcNormalizeText(row.line)}`;
    if (!latestByLine.has(key)) latestByLine.set(key, row);
  });
  const current = Array.from(latestByLine.values());
  $('#gpsCurrentList').innerHTML = current.length ? current.map((row) => `
    <article class="record-item gps-record">
      <div class="gps-record-main"><div><strong>${escapeHtml(row.line || 'Linha sem nome')}</strong><small>Ônibus/prefixo: ${escapeHtml(row.vehicle || 'Não informado')}</small><small>Última parada: ${escapeHtml(row.stop || 'Não informada')} · ${escapeHtml(gcFormatDate(row.dateTime || row.createdAt))}</small>${row.note ? `<small>Obs.: ${escapeHtml(row.note)}</small>` : ''}<span class="gps-current-status">PARADA REGISTRADA</span></div><span class="record-inline-tag">Manual</span></div>
      ${isPablo ? `<div class="gps-record-actions"><button type="button" data-gps-edit="${escapeHtml(row.id)}">Editar parada</button><button type="button" data-gps-delete="${escapeHtml(row.id)}">Excluir registro</button></div>` : ''}
    </article>`).join('') : '<div class="empty-state"><span class="empty-icon">📍</span><strong>Nenhuma parada registrada ainda</strong><span>Quando Pablo registrar o ônibus, a linha e o ponto aparecerão aqui para consulta.</span></div>';
  $('#gpsHistoryList').innerHTML = rows.length ? rows.slice(0, 100).map((row) => `
    <article class="record-item gps-record"><div class="gps-record-main"><div><strong>${escapeHtml(row.vehicle || 'Ônibus não informado')} · ${escapeHtml(row.line || 'Linha sem nome')}</strong><small>${escapeHtml(row.stop || 'Parada não informada')} · ${escapeHtml(gcFormatDate(row.dateTime || row.createdAt))}</small>${row.note ? `<small>${escapeHtml(row.note)}</small>` : ''}</div></div>
      ${isPablo ? `<div class="gps-record-actions"><button type="button" data-gps-edit="${escapeHtml(row.id)}">Editar</button><button type="button" data-gps-delete="${escapeHtml(row.id)}">Excluir</button></div>` : ''}</article>`).join('') : '<div class="empty-state"><span class="empty-icon">🗂️</span><strong>Histórico vazio</strong><span>Os registros serão organizados do mais recente para o mais antigo.</span></div>';
  const operations = typeof ownerOperations === 'function' ? ownerOperations().slice().reverse() : [];
  $('#gpsOperationLinesList').innerHTML = operations.length ? operations.map((op) => {
    const status = String(op.status || 'operando').toLocaleLowerCase('pt-BR');
    const off = status.includes('fora') || status.includes('parada técnica') || status.includes('parada tecnica');
    const detour = status.includes('desvio');
    const statusLabel = off ? 'PARADA / FORA DE OPERAÇÃO' : detour ? 'OPERANDO COM DESVIO' : 'OPERANDO';
    const statusClass = off ? 'offline' : detour ? 'detour' : 'online';
    const vehicle = `${op.company || ''} ${op.prefix || op.busModel || ''}`.trim();
    const matching = rows.find((row) => gcNormalizeText(row.line) === gcNormalizeText(op.line) && (gcNormalizeText(row.vehicle).includes(gcNormalizeText(op.prefix || op.busModel)) || gcNormalizeText(row.vehicle) === gcNormalizeText(vehicle)));
    return `<article class="record-item gps-operation-item"><div class="gps-record-main"><div><strong>${escapeHtml(op.line || 'Linha sem nome')}</strong><small>${escapeHtml(op.company || 'Empresa não informada')} · ${escapeHtml(op.city || 'Cidade não informada')}</small><small>Ônibus: ${escapeHtml(vehicle || 'Não informado')} · Motorista: ${escapeHtml(op.driver || op.drivers?.morning || 'Não informado')}</small>${matching ? `<small>Última parada: ${escapeHtml(matching.stop)} · ${escapeHtml(gcFormatDate(matching.dateTime || matching.createdAt))}</small>` : '<small>Última parada: ainda não registrada no GPS manual</small>'}</div><span class="operation-status ${statusClass}"><i></i>${statusLabel}</span></div>${isPablo ? `<div class="gps-record-actions"><button type="button" data-gps-prefill="${escapeHtml(op.id)}">Registrar parada</button>${matching ? `<button type="button" data-gps-edit="${escapeHtml(matching.id)}">Editar parada</button>` : ''}</div>` : ''}</article>`;
  }).join('') : '<div class="empty-state"><span class="empty-icon">🚌</span><strong>Nenhuma linha cadastrada no Visualizador de Operação</strong><span>As linhas cadastradas na Área do Dono aparecerão aqui. Você também pode registrar uma parada manualmente pelo formulário.</span></div>';
}
function gcGpsPrefillOperation(operationId) {
  if (!gcGpsIsPablo()) { showToast('Selecione Pablo para registrar ou editar paradas.'); return; }
  const op = typeof ownerOperations === 'function' ? ownerOperations().find((item) => item.id === operationId) : null;
  if (!op) { showToast('Não encontrei essa linha no Visualizador de Operação.'); return; }
  const vehicle = `${op.company || ''} ${op.prefix || op.busModel || ''}`.trim();
  const existing = gcGpsRows().filter((row) => gcNormalizeText(row.line) === gcNormalizeText(op.line) && (gcNormalizeText(row.vehicle).includes(gcNormalizeText(op.prefix || op.busModel)) || gcNormalizeText(row.vehicle) === gcNormalizeText(vehicle))).sort((a,b) => new Date(b.dateTime || b.createdAt) - new Date(a.dateTime || a.createdAt))[0];
  if (existing) { gcGpsBeginEdit(existing.id); return; }
  gcGpsResetForm();
  $('#gpsVehicle').value = vehicle; $('#gpsLine').value = op.line || ''; $('#gpsStopDateTime').value = gcNowLocalInput();
  $('#gpsEditPanel').hidden = false; $('#gpsStopName').focus(); $('#gpsStopForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Linha carregada. Informe o ponto onde o ônibus parou e salve.');
}
$('#gpsStopDateTime').value = gcNowLocalInput();
$('#gpsCancelEdit')?.addEventListener('click', gcGpsResetForm);
$('#gpsUserSelect').addEventListener('change', gcGpsSetAccess);
$('#gpsStopForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!gcGpsIsPablo()) { showToast('Somente o modo Pablo pode salvar registros nesta interface.'); return; }
  const vehicle = $('#gpsVehicle').value.trim(), line = $('#gpsLine').value.trim(), stop = $('#gpsStopName').value.trim(), dateTime = $('#gpsStopDateTime').value;
  if (!vehicle || !line || !stop || !dateTime) { showToast('Preencha ônibus, linha, ponto e data/horário.'); return; }
  const rows = gcGpsRows();
  const existing = gcGpsEditingId ? rows.find((item) => item.id === gcGpsEditingId) : null;
  const item = { id: gcGpsEditingId || gcMakeId('gps'), vehicle, line, stop, dateTime: new Date(dateTime).toISOString(), note: $('#gpsStopNote').value.trim(), createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  const next = existing ? rows.map((row) => row.id === gcGpsEditingId ? item : row) : [item, ...rows];
  if (!gcGpsSaveRows(next)) return;
  gcGpsResetForm(); gcRenderGps(); showToast(existing ? 'Parada atualizada.' : 'Nova parada registrada.');
});
$('#gpsCurrentList').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-gps-edit]'); const del = event.target.closest('[data-gps-delete]');
  if (edit) gcGpsBeginEdit(edit.dataset.gpsEdit);
  if (del) { if (!gcGpsIsPablo()) return; if (!window.confirm('Excluir este registro de parada?')) return; gcGpsSaveRows(gcGpsRows().filter((row) => row.id !== del.dataset.gpsDelete)); if (gcGpsEditingId === del.dataset.gpsDelete) gcGpsResetForm(); gcRenderGps(); showToast('Registro excluído.'); }
});
$('#gpsHistoryList').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-gps-edit]'); const del = event.target.closest('[data-gps-delete]');
  if (edit) gcGpsBeginEdit(edit.dataset.gpsEdit);
  if (del) { if (!gcGpsIsPablo()) return; if (!window.confirm('Excluir este registro de parada?')) return; gcGpsSaveRows(gcGpsRows().filter((row) => row.id !== del.dataset.gpsDelete)); if (gcGpsEditingId === del.dataset.gpsDelete) gcGpsResetForm(); gcRenderGps(); showToast('Registro excluído.'); }
});
$('#gpsOperationLinesList').addEventListener('click', (event) => {
  const prefill = event.target.closest('[data-gps-prefill]'); const edit = event.target.closest('[data-gps-edit]');
  if (prefill) gcGpsPrefillOperation(prefill.dataset.gpsPrefill);
  if (edit) gcGpsBeginEdit(edit.dataset.gpsEdit);
});
$('#gpsCopyReport').addEventListener('click', async () => {
  const rows = gcGpsRows().sort((a,b) => new Date(b.dateTime || b.createdAt) - new Date(a.dateTime || a.createdAt));
  const report = ['GRUPO CONECT — RELATÓRIO DE PARADAS', ...rows.map((row) => `${gcFormatDate(row.dateTime || row.createdAt)} | ${row.vehicle} | ${row.line} | Parada: ${row.stop}${row.note ? ` | Obs.: ${row.note}` : ''}`)].join('\n');
  showToast(await copyText(report) ? 'Relatório de paradas copiado.' : 'Não foi possível copiar automaticamente.');
});
gcGpsSetAccess();

// Intermunicipal independente: todos os controles salvam por dia neste navegador.
function gcIcNewDay() { return { paid: 0, free: 0, turnstile: 0, tickets: [], soldSpots: {}, selectedSpot: '', report: '', closedAt: null, tripStarted: false, tripStartAt: null, tripEndedAt: null, tripDriver: '', tripCompany: '', tripModel: '', tripPrefix: '', tripValidatorLogId: '' }; }
function gcIcDefaultState() {
  return { driver: 'Pablo', lineName: '', activeDay: 'ic-day-1', nextDayNumber: 2,
    destinations: [{ name: 'Destino A', fare: 8 }, { name: 'Destino B', fare: 12 }, { name: 'Destino C', fare: 18 }, { name: 'Destino D', fare: 25 }],
    days: { 'ic-day-1': gcIcNewDay() } };
}
function gcIcLoadState() {
  const fallback = gcIcDefaultState(); const value = gcSafeRead(GC_IC_STORAGE_KEY, fallback);
  if (!value || typeof value !== 'object' || !value.days || typeof value.days !== 'object') return fallback;
  value.driver = value.driver || 'Pablo'; value.lineName = value.lineName || ''; value.activeDay = value.activeDay || 'ic-day-1';
  value.destinations = Array.isArray(value.destinations) && value.destinations.length === 4 ? value.destinations : fallback.destinations;
  if (!Object.keys(value.days).length) value.days = { 'ic-day-1': gcIcNewDay() };
  Object.keys(value.days).forEach((key) => {
    const day = value.days[key] || gcIcNewDay();
    day.paid = Math.max(0, Number(day.paid) || 0); day.free = Math.max(0, Number(day.free) || 0); day.turnstile = Math.max(0, Number(day.turnstile) || 0);
    day.tickets = Array.isArray(day.tickets) ? day.tickets : []; day.soldSpots = day.soldSpots && typeof day.soldSpots === 'object' ? day.soldSpots : {}; day.selectedSpot = day.selectedSpot || ''; day.report = day.report || '';
    value.days[key] = day;
  });
  if (!value.days[value.activeDay]) value.activeDay = Object.keys(value.days)[0];
  value.nextDayNumber = Math.max(Number(value.nextDayNumber) || 2, Object.keys(value.days).length + 1);
  return value;
}
const gcIcState = gcIcLoadState();
function gcIcActiveDay() {
  if (!gcIcState.days[gcIcState.activeDay]) gcIcState.days[gcIcState.activeDay] = gcIcNewDay();
  const day=gcIcState.days[gcIcState.activeDay];
  for(const [key,value] of Object.entries(gcIcNewDay()))if(day[key]===undefined)day[key]=value;
  return day;
}
function gcIcCurrentCapacity() {
  const company = $('#icTripCompany')?.value || gcIcActiveDay().tripCompany || '';
  const model = $('#icTripModel')?.value || gcIcActiveDay().tripModel || '';
  const prefix = $('#icTripPrefix')?.value || gcIcActiveDay().tripPrefix || '';
  let vehicle = null;
  try {
    const rows = typeof gcGarageVehicles === 'function' ? gcGarageVehicles() : (typeof ownerFleet === 'function' ? ownerFleet() : []);
    vehicle = rows.find(v => norm(v.company) === norm(company) && String(v.prefix) === String(prefix) && (!model || norm(v.model) === norm(model))) || null;
  } catch (e) { vehicle = null; }
  if (!vehicle && company && model && typeof mergeCompanyFleet === 'function') {
    try { vehicle = mergeCompanyFleet(company).find(v => norm(v.model) === norm(model) && (v.prefixes || []).map(String).includes(String(prefix))) || null; } catch (e) {}
  }
  const firstPositive = values => {
    for (const value of values) { const n = Number(value); if (value !== '' && value !== null && value !== undefined && Number.isFinite(n) && n > 0) return n; }
    return null;
  };
  let profile = null;
  if (vehicle && typeof busOperationalProfile === 'function') { try { profile = busOperationalProfile(vehicle); } catch (e) {} }
  let seated = firstPositive([vehicle?.seated, vehicle?.seats, vehicle?.seatCapacity, vehicle?.seatedCapacity, profile?.seated]);
  let standing = firstPositive([vehicle?.standing, vehicle?.standingCapacity, profile?.standing]);
  const total = firstPositive([vehicle?.totalCapacity, vehicle?.capacity, profile?.capacity]);
  if (seated === null && total !== null) seated = Math.max(1, total - (standing || 0));
  if (standing === null) standing = total !== null && seated !== null ? Math.max(0, total - seated) : 0;
  if (seated === null) { seated = GC_IC_SEATED_CAPACITY; standing = GC_IC_STANDING_CAPACITY; }
  seated = Math.max(1, Math.floor(seated)); standing = Math.max(0, Math.floor(standing));
  return { seated, standing, total: seated + standing, source: vehicle ? 'ficha/perfil do ônibus' : 'padrão do intermunicipal' };
}
function gcIcOccupancy(day = gcIcActiveDay()) { return Math.max(0, Number(day.paid) || 0) + Math.max(0, Number(day.free) || 0); }
function gcIcFormatDayName(id) { const match = String(id).match(/ic-day-(\d+)/); return match ? `Dia ${match[1]}` : id; }
function gcIcSyncFieldsToState() {
  gcIcState.driver = $('#icDriver').value || 'Pablo';
  gcIcState.lineName = $('#icLineName').value.trim();
  gcIcState.destinations = [1,2,3,4].map((n, index) => ({ name: $(`#icDest${n}Name`).value.trim() || `Destino ${String.fromCharCode(64+n)}`, fare: Math.max(0, Number($(`#icDest${n}Fare`).value) || 0) }));
  if ($('#icDaySelect').value && gcIcState.days[$('#icDaySelect').value]) gcIcState.activeDay = $('#icDaySelect').value;
}
function gcIcSave() { gcIcSyncFieldsToState(); return gcSafeWrite(GC_IC_STORAGE_KEY, gcIcState); }
function gcIcPopulateDays() {
  const select = $('#icDaySelect');
  const entries = Object.keys(gcIcState.days).sort((a,b) => Number(a.replace('ic-day-','')) - Number(b.replace('ic-day-','')));
  select.innerHTML = entries.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(gcIcFormatDayName(id))}</option>`).join('');
  if (!gcIcState.days[gcIcState.activeDay]) gcIcState.activeDay = entries[0] || 'ic-day-1';
  select.value = gcIcState.activeDay;
}
function gcIcDestinations() { return [1,2,3,4].map((n, index) => ({ index: n, name: $(`#icDest${n}Name`).value.trim() || `Destino ${String.fromCharCode(64+n)}`, fare: Math.max(0, Number($(`#icDest${n}Fare`).value) || 0) })); }
function gcIcGetSelectedDestination() { const n = Math.max(1, Math.min(4, Number($('#icTicketDestination').value) || 1)); return gcIcDestinations()[n-1]; }
function gcIcUpdateTerminalDisplay(message = null, status = null) {
  const destination = gcIcGetSelectedDestination();
  $('#icTerminalAmount').value = money(destination.fare);
  $('#icPosAmount').textContent = money(destination.fare);
  if (status !== null) $('#icPosStatus').textContent = status;
  if (message !== null) $('#icPosMessage').textContent = message;
  else {
    const selected = gcIcActiveDay().selectedSpot;
    $('#icPosMessage').textContent = selected ? `Posição selecionada: ${selected}. Pronta para venda.` : 'Selecione o trecho e uma posição livre para iniciar.';
  }
}
function gcIcSpotMarkup(spot, standing, day) {
  const sold = Boolean(day.soldSpots[spot]); const selected = day.selectedSpot === spot; const cls = `${standing ? 'standing-place' : 'seat-place'}${sold ? ' sold' : selected ? ' chosen' : ''}`;
  const stateLabel = sold ? 'VENDIDA' : selected ? 'SELECIONADA' : standing ? 'LIVRE EM PÉ' : 'LIVRE';
  return `<button class="${cls}" type="button" data-ic-spot="${spot}" aria-label="${standing ? 'Posição em pé' : 'Poltrona'} ${spot}${sold ? ', vendida' : ''}" ${sold ? 'disabled' : ''}><span>${spot}</span><small>${stateLabel}</small></button>`;
}
function gcIcRenderSeats() {
  const day = gcIcActiveDay(), capacity = gcIcCurrentCapacity();
  let rows = '<div class="seat-map-front">FRENTE DO ÔNIBUS · MOTORISTA</div>';
  for (let start = 1, row = 0; start <= capacity.seated; start += 4, row++) {
    const leftA = start, leftB = start + 1, rightA = start + 2, rightB = start + 3;
    const seat = n => n <= capacity.seated ? gcIcSpotMarkup(`S${String(n).padStart(2,'0')}`, false, day) : '<span class="seat-placeholder" aria-hidden="true"></span>';
    rows += `<div class="seat-row">${seat(leftA)}${seat(leftB)}<div class="seat-aisle">${row===Math.floor(Math.ceil(capacity.seated/4)/2)?'CORREDOR':'│'}</div>${seat(rightA)}${seat(rightB)}</div>`;
  }
  $('#icSeatMap').innerHTML = rows;
  $('#icStandingMap').innerHTML = Array.from({length: capacity.standing}, (_, index) => gcIcSpotMarkup(`E${String(index+1).padStart(2,'0')}`, true, day)).join('');
  const selected = day.selectedSpot;
  if (!selected) $('#icSeatStatus').textContent = `Selecione uma posição livre. Capacidade do veículo: ${capacity.seated} sentados + ${capacity.standing} em pé = ${capacity.total} passageiros.`;
  else $('#icSeatStatus').textContent = `${selected.startsWith('E') ? 'Posição para passageiro em pé' : 'Poltrona'} ${selected} selecionada. ${gcIcOccupancy(day)}/${capacity.total} passageiros registrados.`;
  $('#icSeatStatus').classList.toggle('notice-warning', Boolean(selected && day.soldSpots[selected]));
}
function gcIcRenderCounters() {
  const day = gcIcActiveDay(), capacity = gcIcCurrentCapacity(); const total = gcIcOccupancy(day);
  $('#icPaidCount').textContent = String(day.paid); $('#icFreeCount').textContent = String(day.free); $('#icTotalCount').textContent = String(total); $('#icTurnstileCount').textContent = String(day.turnstile);
  $('#icPaidCounterDisplay').textContent = String(day.paid); $('#icFreeCounterDisplay').textContent = String(day.free);
  // Keep controls clickable at capacity so the user receives an explanation instead of a dead button.
  $('#icPaidPlus').disabled = false; $('#icFreePlus').disabled = false;
  $('#icTicketForm button[type="submit"]').disabled = false;
  const capacityHint = $('#icCapacityHint');
  if (capacityHint) {
    const full = total >= capacity.total;
    capacityHint.textContent = full
      ? `Lotação máxima atingida (${total}/${capacity.total}). Use − para corrigir a contagem ou crie outro dia para começar uma nova operação.`
      : `Ocupação atual: ${total}/${capacity.total}. Restam ${capacity.total-total} lugares para o limite simulado (capacidade cadastrada do ônibus).`;
    capacityHint.classList.toggle('notice-warning', full);
  }
}
function gcIcMakeReport() {
  const day = gcIcActiveDay(), capacity = gcIcCurrentCapacity(), sales = day.tickets || [], revenue = sales.reduce((sum, ticket) => sum + Number(ticket.fare || 0), 0);
  return [
    'GRUPO CONECT — FECHAMENTO INTERMUNICIPAL (SIMULAÇÃO)', `Dia de operação: ${gcIcFormatDayName(gcIcState.activeDay)}`,
    `Data do fechamento: ${new Date().toLocaleString('pt-BR')}`, `Motorista: ${gcIcState.driver || 'Não informado'}`,
    `Linha: ${gcIcState.lineName || 'Não informada'}`, `Pagantes registrados: ${day.paid}`, `Gratuidades: ${day.free}`,
    `Total de passageiros registrados: ${gcIcOccupancy(day)}/${capacity.total}`, `Contador físico simulado da catraca: ${day.turnstile}`,
    `Passagens vendidas no sistema: ${sales.length}`, `Arrecadação das vendas fictícias: ${money(revenue)}`,
    '', 'PASSAGENS FICTÍCIAS', ...(sales.length ? sales.map((ticket) => `${ticket.serial} | ${ticket.createdAt ? gcFormatDate(ticket.createdAt) : ''} | ${ticket.destination} | ${ticket.spot} | ${money(ticket.fare)} | ${ticket.payment} | ${ticket.passenger || 'Sem nome'}`) : ['Nenhuma passagem vendida neste dia.']),
    '', 'Este relatório pertence a um simulador e não comprova transporte ou pagamento real.'
  ].join('\n');
}
function gcIcTicketLedgerEntry(dayId, day, ticket) {
  const ticketKey = String(ticket.id || ticket.serial || `${dayId}-${ticket.createdAt || ''}`);
  const id = `intercity-ticket-${ticketKey}`;
  const amount = Number(Number(ticket.fare || 0).toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const company = day.tripCompany || $('#icTripCompany')?.value || '';
  const model = day.tripModel || $('#icTripModel')?.value || '';
  const prefix = day.tripPrefix || $('#icTripPrefix')?.value || '';
  const line = gcIcState.lineName || $('#icLineName')?.value?.trim() || 'Linha intermunicipal';
  return {
    id, date: String(ticket.createdAt || day.closedAt || dateTodayLocal()).slice(0,10), direction: 'in',
    category: 'Receita de passagens intermunicipais', amount,
    description: `${line} · bilhete ${ticket.serial || ticketKey} · posição ${ticket.spot || 'não informada'} · ${ticket.destination || 'trecho não informado'}${prefix ? ` · ${company} ${prefix}` : ''}`,
    payee: ticket.passenger || 'Passageiro da linha (simulação)', company, source: 'intercity-ticket-sale',
    auto: true, simulated: true, ticketId: ticketKey, createdAt: ticket.createdAt || new Date().toISOString()
  };
}
function gcIcReconcileBankEntries() {
  const ledger = typeof cashLedger === 'function' ? cashLedger() : readArrayKey(CASH_LEDGER_KEY);
  const known = new Set(ledger.map(row => String(row.id || ''))), additions = [];
  Object.entries(gcIcState.days || {}).forEach(([dayId, day]) => {
    (Array.isArray(day?.tickets) ? day.tickets : []).forEach(ticket => {
      const row = gcIcTicketLedgerEntry(dayId, day, ticket);
      if (row && !known.has(row.id)) { additions.push(row); known.add(row.id); }
    });
  });
  if (!additions.length) return 0;
  if (!writeArrayKey(CASH_LEDGER_KEY, [...ledger, ...additions])) return -1;
  if (typeof renderCashDashboard === 'function') renderCashDashboard();
  if (typeof renderFinanceList === 'function') renderFinanceList();
  if (typeof gcBankRender === 'function') gcBankRender();
  return additions.length;
}
function gcIcRenderSummary() {
  const day = gcIcActiveDay(), capacity = gcIcCurrentCapacity(), sales = day.tickets || [], revenue = sales.reduce((sum, ticket) => sum + Number(ticket.fare || 0), 0);
  const cards = [ ['Pagantes', day.paid], ['Gratuidades', day.free], ['A bordo', `${gcIcOccupancy(day)}/${capacity.total}`], ['Vendas fictícias', sales.length], ['Arrecadação fictícia', money(revenue)], ['Poltronas vendidas', Object.keys(day.soldSpots).filter((spot) => spot.startsWith('S')).length], ['Posições em pé vendidas', Object.keys(day.soldSpots).filter((spot) => spot.startsWith('E')).length], ['Catraca', day.turnstile] ];
  $('#icDaySummary').innerHTML = cards.map(([label, value]) => `<article class="tool-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join('');
  $('#icTicketHistory').innerHTML = sales.length ? sales.slice().reverse().map((ticket) => `<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(ticket.serial)} · ${escapeHtml(ticket.destination)}</strong><small>${escapeHtml(ticket.spot)} · ${money(Number(ticket.fare)||0)} · ${escapeHtml(ticket.payment)}</small><small>${escapeHtml(ticket.passenger || 'Passageiro não identificado')} · ${escapeHtml(gcFormatDate(ticket.createdAt))}</small></div><span class="record-inline-tag">APROVADA · SIMULAÇÃO</span></div></article>`).join('') : '<div class="empty-state"><span class="empty-icon">🎟️</span><strong>Nenhuma passagem neste dia</strong><span>As vendas fictícias aparecerão aqui após o processamento.</span></div>';
  if (day.report) { $('#icReportOutput').hidden = false; $('#icReportOutput').textContent = day.report; }
  else { $('#icReportOutput').hidden = true; $('#icReportOutput').textContent = ''; }
}
function gcIcRenderIntercity() {
  gcIcPopulateDays();
  $('#icDriver').value = gcIcState.driver || 'Pablo'; $('#icLineName').value = gcIcState.lineName || '';
  gcIcPopulateTripVehicleFields();
  gcIcState.destinations.forEach((dest, index) => { const n = index+1; $(`#icDest${n}Name`).value = dest.name || `Destino ${String.fromCharCode(64+n)}`; $(`#icDest${n}Fare`).value = String(Math.max(0, Number(dest.fare)||0)); });
  const day = gcIcActiveDay();
  gcIcRenderSeats(); gcIcRenderCounters(); gcIcRenderSummary(); gcIcUpdateTerminalDisplay();gcIcUpdateTripStartStatus();
  $('#intercityScreen').dataset.independent = 'true';
  if (day.report) { $('#icReportOutput').hidden = false; $('#icReportOutput').textContent = day.report; }
}
function gcIcPopulateTripVehicleFields(){
  const companySelect=$('#icTripCompany'),modelSelect=$('#icTripModel'),prefixSelect=$('#icTripPrefix');if(!companySelect||!modelSelect||!prefixSelect)return;
  const company=companySelect.value;const previousModel=modelSelect.value,previousPrefix=prefixSelect.value;
  const models=company?mergeCompanyFleet(company):[];
  modelSelect.innerHTML='<option value="">Selecione o modelo</option>'+models.map(x=>`<option value="${escapeHtml(x.model)}">${escapeHtml(x.model)}</option>`).join('');modelSelect.disabled=!models.length;
  if(models.some(x=>x.model===previousModel))modelSelect.value=previousModel;else modelSelect.value=models[0]?.model||'';
  const picked=models.find(x=>x.model===modelSelect.value);const prefixes=picked?.prefixes||[];
  prefixSelect.innerHTML='<option value="">Selecione o prefixo</option>'+prefixes.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');prefixSelect.disabled=!prefixes.length;
  prefixSelect.value=prefixes.includes(previousPrefix)?previousPrefix:(prefixes[0]||'');
}
function gcIcUpdateTripStartStatus(){const day=gcIcActiveDay();const status=$('#icTripStatus');if(!status)return;const started=Boolean(day.tripStarted);$('#icStartTripButton').disabled=started;$('#icEndTripButton').disabled=!started;status.textContent=started?`VIAGEM INICIADA · ${day.tripCompany||''} · ${day.tripModel||''} prefixo ${day.tripPrefix||''} · motorista ${day.tripDriver||gcIcState.driver} · partida ${new Date(day.tripStartAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}. Passe pelo botão “Encerrar viagem” ao finalizar.`:'Antes da partida, escolha empresa, modelo e prefixo. O motorista precisa validar o cartão funcional.';status.classList.toggle('allowed',started);}
function gcIcCommitStartTrip(p,validatorLogId){
  const day=gcIcActiveDay();if(day.tripStarted){showToast('Já existe uma viagem aberta neste dia intermunicipal. Encerre antes de iniciar outra.');switchScreen('intercityScreen');return;}
  day.tripStarted=true;day.tripStartAt=new Date().toISOString();day.tripDriver=p.driver;day.tripCompany=p.company;day.tripModel=p.model;day.tripPrefix=p.prefix;day.tripValidatorLogId=validatorLogId;gcIcSave();gcIcRenderIntercity();switchScreen('intercityScreen');showToast('Validador autorizou a viagem intermunicipal.');
}
function gcIcVehicleSelectionChanged() {
  gcIcPopulateTripVehicleFields();
  const day = gcIcActiveDay();
  if (day.selectedSpot && !day.soldSpots[day.selectedSpot]) day.selectedSpot = '';
  gcIcSave(); gcIcRenderSeats(); gcIcRenderCounters(); gcIcRenderSummary();
}
$('#icTripCompany').addEventListener('change',gcIcVehicleSelectionChanged);
$('#icTripModel').addEventListener('change',gcIcVehicleSelectionChanged);
$('#icTripPrefix').addEventListener('change',gcIcVehicleSelectionChanged);
$('#icStartTripButton').addEventListener('click',()=>{
  const day=gcIcActiveDay();if(day.tripStarted){showToast('A viagem atual já está iniciada.');return;}
  const company=$('#icTripCompany').value,model=$('#icTripModel').value,prefix=$('#icTripPrefix').value,driver=$('#icDriver').value,line=$('#icLineName').value.trim();
  if(!line){showToast('Informe o nome da linha intermunicipal antes da partida.');$('#icLineName').focus();return;}
  if(!company||!model||!prefix){showToast('Selecione empresa, modelo e prefixo do ônibus intermunicipal.');return;}
  const bus=mergeCompanyFleet(company).find(x=>x.model===model);if(!bus||!bus.prefixes.map(String).includes(String(prefix))){showToast('O prefixo não corresponde ao modelo escolhido.');return;}
  const reservation=typeof gcOnlineBusReservationReason==='function'?gcOnlineBusReservationReason({company,prefix,model},dateTodayLocal()):null;if(reservation){showToast(`Ônibus indisponível: ${reservation.message}`);return;}
  const pool=availableBusPool(company,dateTodayLocal(),'',line);if(!pool.some(x=>norm(x.prefix)===norm(prefix))){showToast('Este prefixo está reservado em outra viagem ou escala para hoje. Escolha outro ônibus.');return;}
  gcIcSyncFieldsToState();gcValidatorOpen({type:'intercity',driver,company,model,prefix,city:'Intermunicipal',line});
});
$('#icEndTripButton').addEventListener('click',()=>{const day=gcIcActiveDay();if(!day.tripStarted){showToast('Não há uma viagem aberta para encerrar.');return;}day.tripStarted=false;day.tripEndedAt=new Date().toISOString();gcIcSave();gcIcRenderIntercity();showToast('Viagem intermunicipal encerrada e registrada no histórico de partida.');});

function gcIcSelectSpot(spot) {
  const day = gcIcActiveDay();
  if (day.soldSpots[spot]) { showToast('Esta posição já está vendida neste dia.'); return; }
  day.selectedSpot = spot; gcIcSave(); gcIcRenderSeats(); $('#icPosScreen').classList.remove('approved');
  gcIcUpdateTerminalDisplay(`${spot.startsWith('E') ? 'Passageiro em pé' : 'Poltrona'} ${spot} selecionada.`, 'AGUARDANDO PAGAMENTO');
  $('#icTicketReceipt').hidden = true;
}
function gcIcRenderFakeQr(serial) {
  let seed = Array.from(String(serial)).reduce((total, char) => (total*31 + char.charCodeAt(0)) >>> 0, 7);
  const bits = [];
  for (let i=0; i<169; i++) { seed = (seed*1664525 + 1013904223) >>> 0; bits.push((seed >>> 27) % 2 === 1); }
  // Fixed finder-like corners improve the appearance of the fictional QR image.
  const setFinder = (ox, oy) => { for (let y=0; y<5; y++) for (let x=0; x<5; x++) bits[(oy+y)*13+ox+x] = x===0 || x===4 || y===0 || y===4 || (x>=2 && x<=2 && y>=2 && y<=2); };
  setFinder(0,0); setFinder(8,0); setFinder(0,8);
  $('#icFakeQr').innerHTML = bits.map((on) => `<span class="${on?'on':''}"></span>`).join('');
}
function gcIcShowTicket(ticket) {
  $('#icTicketReceiptTitle').textContent = `Passagem Grupo Conect · ${ticket.serial}`;
  const fields = [ ['Status','PAGAMENTO APROVADO (SIMULAÇÃO)'], ['Linha',gcIcState.lineName || 'Linha intermunicipal'], ['Destino',ticket.destination], ['Posição',ticket.spot], ['Valor',money(ticket.fare)], ['Pagamento',ticket.payment], ['Passageiro',ticket.passenger || 'Não identificado'], ['Dia',gcIcFormatDayName(gcIcState.activeDay)], ['Horário',gcFormatDate(ticket.createdAt)] ];
  $('#icTicketReceiptFields').innerHTML = fields.map(([label, value]) => `<div class="ticket-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');
  gcIcRenderFakeQr(ticket.serial); $('#icTicketReceipt').hidden = false;
  gcIcUpdateTerminalDisplay(`PAGAMENTO APROVADO! Bilhete ${ticket.serial}.`, '✓ APROVADO');
  $('#icPosScreen')?.classList.add('approved');
  $('#icTerminalInstruction').textContent = `Venda aprovada na simulação. Bilhete ${ticket.serial} registrado no ${gcIcFormatDayName(gcIcState.activeDay)}.`;
}
function gcIcSellTicket() {
  gcIcSyncFieldsToState();
  const day = gcIcActiveDay(); const destination = gcIcGetSelectedDestination(); const spot = day.selectedSpot;
  if (!spot) { gcIcUpdateTerminalDisplay('Selecione primeiro uma poltrona ou uma posição em pé.', 'SELECIONE A POSIÇÃO'); showToast('Selecione uma posição livre no mapa antes de vender.'); return; }
  if (day.soldSpots[spot]) { day.selectedSpot = ''; gcIcSave(); gcIcRenderSeats(); gcIcUpdateTerminalDisplay('A posição selecionada já foi vendida.', 'POSIÇÃO INDISPONÍVEL'); showToast('Escolha outra posição livre.'); return; }
  if (gcIcOccupancy(day) >= gcIcCurrentCapacity().total) { const max = gcIcCurrentCapacity().total; gcIcUpdateTerminalDisplay(`Lotação simulada atingida: ${max} passageiros.`, 'CAPACIDADE ESGOTADA'); showToast(`Capacidade máxima de ${max} passageiros atingida.`); return; }
  if (destination.fare < 0 || !Number.isFinite(destination.fare)) { showToast('Confira a tarifa selecionada.'); return; }
  const ticket = { id: gcMakeId('ticket'), serial: `GC${Date.now().toString().slice(-8)}`, spot, destination: destination.name, fare: destination.fare, payment: $('#icPaymentMethod').value, passenger: $('#icPassengerName').value.trim(), createdAt: new Date().toISOString() };
  const beforeDay = JSON.parse(JSON.stringify(day));
  day.tickets.push(ticket); day.soldSpots[spot] = ticket.id; day.paid += 1; day.turnstile += 1; day.selectedSpot = ''; day.report = '';
  if (!gcIcSave()) { Object.keys(day).forEach(key => delete day[key]); Object.assign(day, beforeDay); return; }
  const ledgerEntry = gcIcTicketLedgerEntry(gcIcState.activeDay, day, ticket);
  if (ledgerEntry) {
    const ledger = typeof cashLedger === 'function' ? cashLedger() : readArrayKey(CASH_LEDGER_KEY);
    if (!ledger.some(row => String(row.id || '') === ledgerEntry.id) && !writeArrayKey(CASH_LEDGER_KEY, [...ledger, ledgerEntry])) {
      Object.keys(day).forEach(key => delete day[key]); Object.assign(day, beforeDay); gcIcSave();
      showToast('A passagem não foi concluída: o Caixa não conseguiu registrar a receita. Tente novamente.'); return;
    }
    if (typeof renderCashDashboard === 'function') renderCashDashboard();
    if (typeof renderFinanceList === 'function') renderFinanceList();
    if (typeof gcBankRender === 'function') gcBankRender();
  }
  $('#icPassengerName').value = '';
  gcIcRenderSeats(); gcIcRenderCounters(); gcIcRenderSummary(); gcIcShowTicket(ticket);
  $('#icPosScreen').classList.add('approved'); showToast('Pagamento aprovado na simulação; passagem registrada.');
}
$('#icDaySelect').addEventListener('change', () => {
  gcIcSyncFieldsToState(); gcIcState.activeDay = $('#icDaySelect').value; gcIcSave();
  $('#icTicketReceipt').hidden = true; gcIcRenderIntercity();
});
$('#icAddDay').addEventListener('click', () => {
  gcIcSyncFieldsToState();
  const n = Math.max(1, Number(gcIcState.nextDayNumber)||2); const id = `ic-day-${n}`;
  gcIcState.days[id] = gcIcNewDay(); gcIcState.nextDayNumber = n + 1; gcIcState.activeDay = id;
  gcIcPopulateDays(); gcIcSave(); gcIcRenderIntercity();
  $('#icTicketReceipt').hidden = true; showToast(`${gcIcFormatDayName(id)} criado, sem apagar os registros dos dias anteriores.`);
});
['icDriver','icLineName','icDest1Name','icDest2Name','icDest3Name','icDest4Name','icDest1Fare','icDest2Fare','icDest3Fare','icDest4Fare'].forEach((id) => {
  const el = $('#'+id); el.addEventListener('input', () => { gcIcSave(); gcIcUpdateTerminalDisplay(); });
  el.addEventListener('change', () => { gcIcSave(); gcIcUpdateTerminalDisplay(); });
});
$('#icTicketDestination').addEventListener('change', () => gcIcUpdateTerminalDisplay());
$('#icSeatMap').addEventListener('click', (event) => { const button = event.target.closest('[data-ic-spot]'); if (button && button.dataset.icSpot.startsWith('S')) gcIcSelectSpot(button.dataset.icSpot); });
$('#icStandingMap').addEventListener('click', (event) => { const button = event.target.closest('[data-ic-spot]'); if (button && button.dataset.icSpot.startsWith('E')) gcIcSelectSpot(button.dataset.icSpot); });
function gcIcAdjustCounter(kind, direction) {
  const day = gcIcActiveDay(), capacity = gcIcCurrentCapacity(); const total = gcIcOccupancy(day);
  if (direction > 0 && total >= capacity.total) { showToast(`Capacidade máxima de ${capacity.total} passageiros atingida.`); return; }
  const key = kind === 'paid' ? 'paid' : 'free';
  if (direction < 0 && day[key] <= 0) return;
  day[key] = Math.max(0, day[key] + direction);
  if (direction > 0) day.turnstile += 1;
  day.report = ''; gcIcSave(); gcIcRenderCounters(); gcIcRenderSummary(); gcIcRenderSeats();
}
$('#icPaidPlus').addEventListener('click', () => gcIcAdjustCounter('paid',1));
$('#icPaidMinus').addEventListener('click', () => gcIcAdjustCounter('paid',-1));
$('#icFreePlus').addEventListener('click', () => gcIcAdjustCounter('free',1));
$('#icFreeMinus').addEventListener('click', () => gcIcAdjustCounter('free',-1));
$('#icTicketForm').addEventListener('submit', (event) => { event.preventDefault(); gcIcSellTicket(); });
$('#icPosTapCard').addEventListener('click', () => { if ($('#icTicketForm').requestSubmit) $('#icTicketForm').requestSubmit(); else gcIcSellTicket(); });
$('#icHideTicket').addEventListener('click', () => { $('#icTicketReceipt').hidden = true; $('#icPosScreen').classList.remove('approved'); gcIcUpdateTerminalDisplay('Selecione o trecho e uma posição livre para iniciar.', 'PRONTA PARA VENDA'); });
$('#icPrintTicket').addEventListener('click', () => {
  const fields = Array.from($('#icTicketReceiptFields').querySelectorAll('.ticket-field')).map((field) => `<tr><th>${escapeHtml(field.querySelector('span')?.textContent || '')}</th><td>${escapeHtml(field.querySelector('strong')?.textContent || '')}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=650,height=800');
  if (!w) { showToast('Permita pop-ups para imprimir ou salvar a passagem como PDF.'); return; }
  w.opener = null; w.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Passagem Grupo Conect</title><style>body{font:14px Arial;color:#172d3d;margin:24px}h1{font-size:22px}p{color:#18744f;font-weight:bold}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce5e9}th{color:#627581;width:35%}small{font-size:10px;color:#6d7f89}@media print{button{display:none}}</style><h1>Grupo Conect — Passagem</h1><p>✓ APROVADO — SIMULAÇÃO FICTÍCIA</p><table>${fields}</table><small>Documento ilustrativo. Nenhuma cobrança real foi realizada; não é válido para embarque.</small><p><button onclick="window.print()">Imprimir / Salvar PDF</button></p></html>`); w.document.close();
});
$('#icFinishDay').addEventListener('click', () => {
  gcIcSyncFieldsToState(); const day = gcIcActiveDay(); day.closedAt = new Date().toISOString(); day.report = gcIcMakeReport();
  gcIcSave(); gcIcRenderSummary(); $('#icReportOutput').hidden = false; $('#icReportOutput').textContent = day.report; showToast(`${gcIcFormatDayName(gcIcState.activeDay)} finalizado; relatório gerado.`);
});
$('#icCopyDayReport').addEventListener('click', async () => {
  gcIcSyncFieldsToState(); const report = gcIcActiveDay().report || gcIcMakeReport();
  showToast(await copyText(report) ? 'Relatório intermunicipal copiado.' : 'Não foi possível copiar automaticamente.');
});
$('#icDownloadDayReport').addEventListener('click', () => {
  gcIcSyncFieldsToState(); const report = gcIcActiveDay().report || gcIcMakeReport();
  downloadTextFile(`grupo-conect-intermunicipal-${gcIcState.activeDay}.txt`, report, 'text/plain;charset=utf-8'); showToast('Relatório TXT baixado.');
});
gcIcRenderIntercity();
// Recupera lançamentos financeiros de passagens já existentes em backups antigos,
// usando o ID do bilhete como chave idempotente para não creditar duas vezes.
gcIcReconcileBankEntries();


/* Atendimento Online: turismo, fretamento e escolar com clientes simulados do Brasil. */
const GC_ONLINE_STORAGE_KEY = 'grupoConect.onlineFretamento.v1';
const GC_ONLINE_CASH_SOURCE = 'onlineFretamento';
const GC_ONLINE_DIESEL_DEFAULT = 7.99;
let gcOnlineSelectedLeadId = null;
let gcOnlineActiveTab = 'clients';
let gcOnlineCurrentState = null;

const GC_ONLINE_REGIONS = [
  {city:'Três Rios',state:'RJ',lat:-22.116,lon:-43.209},
  {city:'Rio de Janeiro',state:'RJ',lat:-22.906,lon:-43.172},
  {city:'Petrópolis',state:'RJ',lat:-22.505,lon:-43.178},
  {city:'Nova Friburgo',state:'RJ',lat:-22.282,lon:-42.531},
  {city:'Juiz de Fora',state:'MG',lat:-21.760,lon:-43.350},
  {city:'Belo Horizonte',state:'MG',lat:-19.916,lon:-43.934},
  {city:'Uberlândia',state:'MG',lat:-18.918,lon:-48.277},
  {city:'São Paulo',state:'SP',lat:-23.551,lon:-46.633},
  {city:'Campinas',state:'SP',lat:-22.906,lon:-47.061},
  {city:'Santos',state:'SP',lat:-23.961,lon:-46.333},
  {city:'Vitória',state:'ES',lat:-20.315,lon:-40.312},
  {city:'Curitiba',state:'PR',lat:-25.428,lon:-49.273},
  {city:'Londrina',state:'PR',lat:-23.305,lon:-51.169},
  {city:'Florianópolis',state:'SC',lat:-27.595,lon:-48.548},
  {city:'Porto Alegre',state:'RS',lat:-30.034,lon:-51.217},
  {city:'Brasília',state:'DF',lat:-15.794,lon:-47.883},
  {city:'Goiânia',state:'GO',lat:-16.687,lon:-49.264},
  {city:'Salvador',state:'BA',lat:-12.977,lon:-38.501},
  {city:'Recife',state:'PE',lat:-8.047,lon:-34.878},
  {city:'Fortaleza',state:'CE',lat:-3.732,lon:-38.527},
  {city:'Manaus',state:'AM',lat:-3.119,lon:-60.021},
  {city:'Belém',state:'PA',lat:-1.455,lon:-48.502},
  {city:'Campo Grande',state:'MS',lat:-20.469,lon:-54.620},
  {city:'Cuiabá',state:'MT',lat:-15.601,lon:-56.097},
  {city:'Natal',state:'RN',lat:-5.794,lon:-35.211},
  {city:'João Pessoa',state:'PB',lat:-7.119,lon:-34.845},
  {city:'Maceió',state:'AL',lat:-9.650,lon:-35.708},
  {city:'São Luís',state:'MA',lat:-2.530,lon:-44.306}
];
const GC_ONLINE_CLIENT_SEEDS = [
  {name:'Colégio Horizonte',type:'Turismo escolar'},
  {name:'Instituto Caminhos do Saber',type:'Turismo escolar'},
  {name:'Escola Sementes do Futuro',type:'Turismo escolar'},
  {name:'Colégio Integração',type:'Turismo escolar'},
  {name:'Escola Mundo Novo',type:'Turismo escolar'},
  {name:'Centro Educacional Prisma',type:'Turismo escolar'},
  {name:'Universidade Central',type:'Turismo escolar'},
  {name:'Secretaria de Educação Regional',type:'Turismo escolar'},
  {name:'Clube Esportivo União',type:'Fretamento'},
  {name:'Associação Atlética Nacional',type:'Fretamento'},
  {name:'Alpha Tecnologia',type:'Fretamento'},
  {name:'Grupo Logística Brasil',type:'Fretamento'},
  {name:'Metalúrgica Vale Verde',type:'Fretamento'},
  {name:'Cooperativa Saúde Vida',type:'Fretamento'},
  {name:'Hospital Regional',type:'Fretamento'},
  {name:'Indústria Caminho Forte',type:'Fretamento'},
  {name:'Hotel Serra Azul',type:'Turismo'},
  {name:'Agência Rota Brasil',type:'Turismo'},
  {name:'Agência Viaje Mais',type:'Turismo'},
  {name:'Turismo Raízes do Brasil',type:'Turismo'},
  {name:'Associação Cultural Brasil',type:'Turismo'},
  {name:'Organização Celebra Eventos',type:'Fretamento'},
  {name:'Comunidade Esperança',type:'Turismo'},
  {name:'Paróquia São Lucas',type:'Turismo'},
  {name:'Família Ferreira',type:'Turismo'},
  {name:'Família Oliveira',type:'Turismo'},
  {name:'Família Santos',type:'Turismo'},
  {name:'Produtora Palco Vivo',type:'Fretamento'},
  {name:'Centro de Convenções Metropolitano',type:'Fretamento'},
  {name:'Associação de Guias e Excursões',type:'Turismo'},
  {name:'Prefeitura Municipal',type:'Contrato de fretamento'},
  {name:'Secretaria Municipal de Educação',type:'Contrato de fretamento'},
  {name:'Prefeitura / Secretaria de Turismo',type:'Contrato de fretamento'},
  {name:'Consórcio Intermunicipal de Saúde',type:'Contrato de fretamento'},
  {name:'Empresa Pública de Serviços Urbanos',type:'Contrato de fretamento'},
  {name:'Consórcio Municipal de Cultura',type:'Contrato de fretamento'},
  {name:'Rede Hospitalar Vida',type:'Contrato de fretamento'},
  {name:'Grupo Industrial Vale do Paraíba',type:'Contrato de fretamento'},
  {name:'Centro de Distribuição Nacional',type:'Contrato de fretamento'},
  {name:'Universidade Regional Integrada',type:'Contrato de fretamento'},
  {name:'Secretaria Regional de Educação',type:'Contrato de fretamento'},
  {name:'Complexo Industrial Sudeste',type:'Contrato de fretamento'},
  {name:'Operadora de Transporte de Funcionários',type:'Contrato de fretamento'},
  {name:'Cooperativa Regional de Serviços',type:'Contrato de fretamento'}
];
function gcOnlineBuildCatalog(){
  const rows=[]; let id=1;
  GC_ONLINE_CLIENT_SEEDS.forEach((seed,seedIndex)=>GC_ONLINE_REGIONS.forEach((region,regionIndex)=>{
    let destIndex=(regionIndex+4+(seedIndex%7))%GC_ONLINE_REGIONS.length;
    if(destIndex===regionIndex)destIndex=(destIndex+1)%GC_ONLINE_REGIONS.length;
    const destination=GC_ONLINE_REGIONS[destIndex];
    rows.push({id:`client-${String(id).padStart(4,'0')}`,name:`${seed.name} · ${region.city}`,organization:seed.name,clientType:seed.type,city:region.city,state:region.state,origin:`${region.city}/${region.state}`,destination:`${destination.city}/${destination.state}`,originRegion:region,destinationRegion:destination});
    id++;
  }));
  return rows;
}
const GC_ONLINE_CLIENT_CATALOG = gcOnlineBuildCatalog(); // 44 perfis-base × 28 regiões = 1.232 clientes potenciais.
function gcOnlineHaversine(a,b){
  const rad=x=>x*Math.PI/180, dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const v=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));
}
function gcOnlineDateAdd(iso,days){const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function gcOnlineDateGap(from,to){const a=new Date(`${from}T12:00:00`),b=new Date(`${to}T12:00:00`);if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime()))return 0;return Math.max(0,Math.floor((b-a)/86400000));}
function gcOnlineRandomTime(min=330,max=600){const minute=Math.floor((min+Math.random()*(max-min))/15)*15;return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
function gcOnlinePlusTime(value,minutes){const [hh,mm]=String(value||'06:00').split(':').map(Number);const total=((hh*60+mm+(Number(minutes)||0))%1440+1440)%1440;return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}
function gcOnlineDateTimeValue(date,time){return `${date}T${time}`;}
function gcOnlineFormatDateTime(iso){if(!iso)return 'Não informado';const d=new Date(iso);return Number.isNaN(d.getTime())?String(iso):d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function gcOnlineMakeEstimate(lead,vehicleModel=''){
  const model=String(vehicleModel||'').toLocaleLowerCase('pt-BR');
  const electric=/elétric|eletric/.test(model), coach=/paradiso|viaggio|audace|spectrum road|rodovi|ideale|irizar|double|dd\b/.test(model), micro=/micro|lo-916|lo-915|9\.160|volare/.test(model), urban=/apache|torino|gran via|gran micro|neobus n10/.test(model);
  const efficiency=electric?0:(micro?3.2:coach?2.65:urban?2.35:2.5);
  const distance=Math.max(0,Number(lead.totalKm)||0),hours=Math.max(1,Number(lead.serviceHours)||1),budget=Math.max(0,Number(lead.budget)||0);
  const journeys=Math.max(1,Math.min(120,Math.round(Number(lead.monthlyTrips)||1)));
  const fuel=(electric?0:(distance/Math.max(.5,efficiency))*GC_ONLINE_DIESEL_DEFAULT)*journeys;
  const energy=(electric?distance*.48:0)*journeys;
  const driver=(hours*58+45)*journeys;
  const maintenance=distance*(coach ? 0.88 : 0.82)*journeys;
  const tolls=(distance*(lead.oneWayKm>250?.14:.08)+(lead.oneWayKm>250?95:25))*journeys;
  const serviceExtra=(lead.serviceType==='Turismo escolar'?105:(lead.serviceType==='Turismo'?175:140))*journeys;
  const contingency=(fuel+energy+maintenance+tolls)*.055;
  const total=fuel+energy+driver+maintenance+tolls+serviceExtra+contingency;
  const profit=budget-total,margin=budget>0?profit/budget*100:-100,recommended=total*1.2;
  const monthly=Number(lead.contractDurationMonths)>0;
  let verdict,level,explanation;
  if(profit<=0){verdict=monthly?'A mensalidade não cobre os custos':'Não vale a pena neste valor';level='bad';explanation=monthly?'A mensalidade oferecida não cobre os custos mensais estimados para a frequência solicitada. Negocie outro valor ou recuse.':'O orçamento não cobre os custos estimados. Negocie um valor maior ou recuse se o cliente não aceitar.';}
  else if(margin<12){verdict=monthly?'Contrato com margem apertada — negocie':'Margem apertada — negocie';level='caution';explanation='Há resultado estimado positivo, mas pouca folga para atraso, desvio, pedágio ou consumo maior que o esperado.';}
  else{verdict=monthly?'Contrato com margem estimada positiva':'Parece valer a pena';level='good';explanation='O orçamento supera os custos previstos e deixa margem estimada. Confira ônibus, capacidade e horários antes de aceitar.';}
  return {distance,hours,budget,efficiency,journeys,fuel,energy,driver,maintenance,tolls,serviceExtra,contingency,total,profit,margin,recommended,verdict,level,explanation,monthly};
}
function gcOnlineBuildProposal(state,receivedDate){
  let seen=new Set(state.seenClientIds||[]);
  let unused=GC_ONLINE_CLIENT_CATALOG.filter(x=>!seen.has(x.id));
  if(!unused.length){state.seenClientIds=[];unused=GC_ONLINE_CLIENT_CATALOG.slice();seen=new Set();}
  const profile=unused[Math.floor(Math.random()*unused.length)];
  state.seenClientIds.push(profile.id);
  const contractProfile=profile.clientType==='Contrato de fretamento';
  // Mesmo empresas listadas para contratos contínuos podem pedir um fretamento pontual.
  const recurringContract=contractProfile && Math.random()<.52;
  const originRegion=profile.originRegion;
  let destinationRegion=profile.destinationRegion;
  if(recurringContract){
    const near=GC_ONLINE_REGIONS.filter(r=>r.city!==originRegion.city && gcOnlineHaversine(originRegion,r)<=160);
    if(near.length)destinationRegion=near[Math.floor(Math.random()*near.length)];
  }
  const destination=`${destinationRegion.city}/${destinationRegion.state}`;
  const rawKm=gcOnlineHaversine(originRegion,destinationRegion)*1.25;
  const oneWayKm=recurringContract?Math.max(12,Math.round(Math.min(160,rawKm)/5)*5):Math.max(35,Math.round(rawKm/5)*5);
  const roundTrip=recurringContract?true:Math.random() < (oneWayKm > 300 ? 0.88 : 0.78);
  const totalKm=Math.round((oneWayKm*(roundTrip?2:1)+Math.max(12,oneWayKm*.07))/5)*5;
  let serviceType=profile.clientType;
  if(recurringContract)serviceType='Contrato de fretamento';
  else if(contractProfile)serviceType='Fretamento';
  else if(serviceType!=='Turismo escolar'&&Math.random()<.23)serviceType=serviceType==='Turismo'?'Fretamento':'Turismo';
  const passengers=recurringContract?15+Math.floor(Math.random()*36):(serviceType==='Turismo escolar'?25+Math.floor(Math.random()*23):serviceType==='Turismo'?12+Math.floor(Math.random()*34):18+Math.floor(Math.random()*35));
  const hours=Math.max(2,Math.round(((totalKm/51)+(recurringContract?1.8:2.6))*2)/2);
  const tripDate=gcOnlineDateAdd(receivedDate,3+Math.floor(Math.random()*43));
  const requestedDeparture=gcOnlineRandomTime(recurringContract?330:315,recurringContract?510:570);
  const requestedArrivalMinutes=Math.max(60,Math.round(oneWayKm/48*60+20));
  const requestedArrival=gcOnlinePlusTime(requestedDeparture,requestedArrivalMinutes);
  const requestedArrivalDate=gcOnlineDateAdd(tripDate,Math.floor((Number(requestedDeparture.split(':')[0])*60+Number(requestedDeparture.split(':')[1])+requestedArrivalMinutes)/1440));
  const contractDurationMonths=recurringContract?[12,18,24,24,30,36,42,48][Math.floor(Math.random()*8)]:0;
  const monthlyTrips=recurringContract?[20,22,22,24,26][Math.floor(Math.random()*5)]:1;
  const temp={oneWayKm,totalKm,serviceHours:hours,budget:0,serviceType,monthlyTrips,contractDurationMonths};
  const cost=gcOnlineMakeEstimate(temp).total;
  const offeredFactor = recurringContract ? (0.72 + Math.random()*0.62) : (0.78 + Math.random()*0.78);
  const budget=Math.max(recurringContract?Math.max(6000,cost*.76):250,Math.round((cost*offeredFactor)/(recurringContract?100:50))*(recurringContract?100:50));
  const leadNumber=Number(state.nextLeadId)||1;state.nextLeadId=leadNumber+1;
  return {id:`online-lead-${leadNumber}`,clientId:profile.id,clientName:profile.name,organization:profile.organization,clientCity:profile.city,clientState:profile.state,clientType:contractProfile&&!recurringContract?'Empresa/prefeitura':profile.clientType,origin:`${originRegion.city}/${originRegion.state}`,destination,originRegion:originRegion.city,originState:originRegion.state,destinationRegion:destinationRegion.city,destinationState:destinationRegion.state,oneWayKm,totalKm,roundTrip,serviceType,passengers,serviceDate:tripDate,requestedDeparture,requestedArrival,requestedArrivalDate,serviceHours:hours,budget,receivedDate,receivedAt:new Date().toISOString(),status:'pending',contractDurationMonths,monthlyTrips,contractServiceDays:recurringContract?['segunda','terca','quarta','quinta','sexta']:[],monthlyKm:recurringContract?totalKm*monthlyTrips:0};
}
function gcOnlineDurationLabel(months){const m=Math.max(0,Number(months)||0);if(!m)return 'serviço pontual';if(m%12===0)return `${m/12} ${m===12?'ano':'anos'} (${m} meses)`;const years=Math.floor(m/12),rest=m%12;return years?`${years} ano${years===1?'':'s'} e ${rest} mês${rest===1?'':'es'} (${m} meses)`:`${m} meses`;}
function gcOnlineMonthOffset(anchorISO,todayISO){const start=new Date(anchorISO),end=new Date(`${todayISO}T12:00:00`);if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<start)return 0;let months=(end.getFullYear()-start.getFullYear())*12+(end.getMonth()-start.getMonth());if(end.getDate()<start.getDate())months--;return Math.max(0,months);}
function gcOnlineAddMonthsISO(anchorISO,months){const source=new Date(anchorISO);if(Number.isNaN(source.getTime()))return dateTodayLocal();const y=source.getFullYear(),m=source.getMonth()+Number(months||0),day=source.getDate(),targetYear=y+Math.floor(m/12),targetMonth=((m%12)+12)%12,last=new Date(targetYear,targetMonth+1,0).getDate(),d=new Date(targetYear,targetMonth,Math.min(day,last),12,0,0);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function gcOnlineSyncContractReceipts(state,todayISO=dateTodayLocal()){
  const ledger=cashLedger(),existing=new Set(ledger.map(x=>String(x.id))),additions=[];
  (state.contracts||[]).filter(c=>Number(c.contractDurationMonths)>0&&c.status==='accepted').forEach(c=>{
    const duration=Math.max(1,Number(c.contractDurationMonths)||1),anchor=c.acceptedAt||c.createdAt||new Date().toISOString(),elapsed=gcOnlineMonthOffset(anchor,todayISO),periods=Math.min(duration,1+elapsed),monthlyAmount=Number(c.monthlyAmount||c.budget)||0;
    for(let period=1;period<=periods;period++){
      const id=`online-contract-cash-${c.leadId||c.id}-${period}`;
      if(existing.has(id)||!(monthlyAmount>0))continue;
      const dueDate=period===1?gcOnlineLocalDatePart(anchor):gcOnlineAddMonthsISO(anchor,period-1);
      additions.push({id,date:dueDate,direction:'in',category:'Mensalidade de contrato de fretamento',amount:monthlyAmount,description:`Mensalidade ${period}/${duration} · ${c.clientName} · ${c.origin} → ${c.destination} · ${c.company} · ${c.model} prefixo ${c.prefix} · prazo total ${gcOnlineDurationLabel(duration)}`,createdAt:new Date().toISOString(),auto:true,source:GC_ONLINE_CASH_SOURCE,onlineLeadId:c.leadId||c.id,onlineContractPeriod:period,onlineContractDurationMonths:duration});
      existing.add(id);
    }
  });
  if(additions.length&&writeArrayKey(CASH_LEDGER_KEY,[...ledger,...additions])){if($('#cashSummary')){renderCashDashboard();renderFinanceList();}return additions.length;}
  return 0;
}
function gcOnlineLoadState(){
  try{const raw=JSON.parse(localStorage.getItem(GC_ONLINE_STORAGE_KEY)||'null');if(raw&&typeof raw==='object'&&!Array.isArray(raw))return {version:1,initialized:false,lastCheckedDate:'',lastManualCheckAt:0,nextLeadId:1,leads:[],contracts:[],seenClientIds:[],...raw,leads:Array.isArray(raw.leads)?raw.leads:[],contracts:Array.isArray(raw.contracts)?raw.contracts:[],seenClientIds:Array.isArray(raw.seenClientIds)?raw.seenClientIds:[]};}catch(e){}
  return {version:1,initialized:false,lastCheckedDate:'',lastManualCheckAt:0,nextLeadId:1,leads:[],contracts:[],seenClientIds:[]};
}
function gcOnlineSaveState(state){try{state.leads=(state.leads||[]).slice(-1200);state.contracts=(state.contracts||[]).slice(-1200);state.seenClientIds=(state.seenClientIds||[]).slice(-600);localStorage.setItem(GC_ONLINE_STORAGE_KEY,JSON.stringify(state));gcOnlineCurrentState=state;return true;}catch(e){showToast('Não foi possível salvar o Atendimento Online. Libere espaço no armazenamento do navegador.');return false;}}
function gcOnlineSyncArrivals(manual=false){
  const state=gcOnlineLoadState(),today=dateTodayLocal();let newCount=0;
  if(!state.initialized){state.initialized=true;state.lastCheckedDate=today;state.initializedAt=new Date().toISOString();for(let i=0;i<4;i++){const lead=gcOnlineBuildProposal(state,today);lead.receivedDate=gcOnlineDateAdd(today,-(3-i));lead.receivedAt=new Date(`${lead.receivedDate}T${String(9+i*2).padStart(2,'0')}:20:00`).toISOString();state.leads.push(lead);newCount++;}state.lastManualCheckAt=Date.now();}
  else{
    const gap=Math.min(180,gcOnlineDateGap(state.lastCheckedDate||today,today));
    for(let offset=gap;offset>0;offset--){const day=gcOnlineDateAdd(today,-offset);if(Math.random()<.57){let n=1+(Math.random()<.28?1:0)+(Math.random()<.07?1:0);for(let i=0;i<n;i++){state.leads.push(gcOnlineBuildProposal(state,day));newCount++;}}}
    if(gap>0)state.lastCheckedDate=today;
    const elapsed=Date.now()-(Number(state.lastManualCheckAt)||0);
    if(manual&&newCount===0&&elapsed>4*60*60*1000&&Math.random()<.22&&state.leads.filter(x=>x.status==='pending').length<35){state.leads.push(gcOnlineBuildProposal(state,today));newCount++;}
    if(manual)state.lastManualCheckAt=Date.now();
  }
  state.lastCheckedDate=today;const recurringReceipts=gcOnlineSyncContractReceipts(state,today);gcOnlineSaveState(state);return {state,newCount,recurringReceipts};
}
function gcOnlinePending(){return (gcOnlineCurrentState?.leads||[]).filter(x=>x.status==='pending').sort((a,b)=>String(b.receivedDate).localeCompare(String(a.receivedDate))||String(b.id).localeCompare(String(a.id)));}
function gcOnlineFindLead(id){return (gcOnlineCurrentState?.leads||[]).find(x=>x.id===id)||null;}
function gcOnlineMoneyRow(label,value){return `<div class="gc-cost-line"><span>${escapeHtml(label)}</span><strong>${escapeHtml(money(Number(value)||0))}</strong></div>`;}
function gcOnlineVerdictMarkup(estimate){return `<div class="gc-profit-verdict ${estimate.level}"><strong>${escapeHtml(estimate.verdict)} · ${escapeHtml(money(estimate.profit))}</strong><p>${escapeHtml(estimate.explanation)} Margem estimada: ${numberPt(estimate.margin,1)}%. Valor sugerido para margem de 20%: ${money(estimate.recommended)}.</p></div>`;}
function gcOnlineLeadMarkup(lead){
  const est=gcOnlineMakeEstimate(lead),statusText=est.level==='good'?'Boa margem estimada':est.level==='caution'?'Vale negociar':'Risco de prejuízo',isContract=Number(lead.contractDurationMonths)>0;
  const term=isContract?`<br><strong>Contrato solicitado pelo cliente:</strong> ${escapeHtml(gcOnlineDurationLabel(lead.contractDurationMonths))} · ${Number(lead.monthlyTrips)||22} jornadas/mês` :'';
  return `<article class="gc-lead-card"><div class="gc-lead-card-top"><div><strong class="gc-lead-client">${escapeHtml(lead.clientName)}</strong><span class="gc-lead-location">${escapeHtml(lead.clientCity||lead.originRegion)}/${escapeHtml(lead.clientState||lead.originState)} · recebido ${escapeHtml(displayDateValue(lead.receivedDate))}</span></div><span class="gc-service-pill">${escapeHtml(lead.serviceType)}</span></div><div class="gc-lead-route"><strong>${escapeHtml(lead.origin)}</strong> → <strong>${escapeHtml(lead.destination)}</strong><br>${escapeHtml(displayDateValue(lead.serviceDate))} · saída ${escapeHtml(lead.requestedDeparture)} · previsão destino ${escapeHtml(displayDateValue(lead.requestedArrivalDate||lead.serviceDate))} ${escapeHtml(lead.requestedArrival)} · ${lead.passengers} passageiros${term}</div><div class="gc-lead-budget"><div><small>${isContract?'Mensalidade oferecida':'Orçamento do cliente'}</small><strong>${escapeHtml(money(lead.budget))}${isContract?'<small> / mês</small>':''}</strong></div><div style="text-align:right"><small>${isContract?'Resultado mensal estimado':'Resultado estimado'}</small><strong class="${est.profit>=0?'positive':'negative'}">${escapeHtml(money(est.profit))}</strong></div></div><div class="gc-lead-card-bottom"><span class="gc-lead-status ${est.level}">${escapeHtml(statusText)}</span><button type="button" class="gc-mini-button" data-online-view="${escapeHtml(lead.id)}">Analisar proposta →</button></div></article>`;
}
function gcOnlineRenderKpis(){
  const state=gcOnlineCurrentState||gcOnlineLoadState(),pending=state.leads.filter(x=>x.status==='pending').length,accepted=state.contracts.length,acceptedIds=new Set(state.contracts.map(x=>x.leadId||x.id)),revenue=cashLedger().filter(x=>x.source===GC_ONLINE_CASH_SOURCE&&acceptedIds.has(x.onlineLeadId)&&x.direction==='in').reduce((s,x)=>s+Number(x.amount||0),0);
  $('#onlinePhoneKpis').innerHTML=[[String(GC_ONLINE_CLIENT_CATALOG.length),'clientes-base'],[String(pending),'pendentes'],[String(accepted),'aceitas']].map(([v,l])=>`<div class="gc-phone-kpi"><strong>${escapeHtml(v)}</strong><span>${escapeHtml(l)}</span></div>`).join('');
  $('#onlineInboxCount').textContent=`${pending} pendente${pending===1?'':'s'}`;$('#onlineSideCatalogCount').textContent=String(GC_ONLINE_CLIENT_CATALOG.length);$('#onlineSidePendingCount').textContent=String(pending);$('#onlineSideRevenue').textContent=money(revenue);
}
function gcOnlineRenderLeadList(){
  const rows=gcOnlinePending();$('#onlineLeadList').innerHTML=rows.length?rows.map(gcOnlineLeadMarkup).join(''):'<div class="gc-empty-state">Nenhuma proposta pendente agora. O simulador pode receber novas consultas em outros dias. Use ↻ para conferir se houve chegada desde sua última visita.</div>';
}
function gcOnlineRenderAgenda(){
  const state=gcOnlineCurrentState||gcOnlineLoadState(),rows=state.contracts.slice().sort((a,b)=>String(a.departureAt).localeCompare(String(b.departureAt)));
  const ids=new Set(rows.map(x=>x.leadId||x.id));
  const revenue=cashLedger().filter(x=>x.source===GC_ONLINE_CASH_SOURCE&&ids.has(x.onlineLeadId)&&x.direction==='in').reduce((sum,row)=>sum+Number(row.amount||0),0);
  $('#onlineAgendaKpis').innerHTML=[[''+rows.length,'serviços aceitos'],[money(revenue),'recebido no Caixa'],[String(rows.filter(x=>String(x.serviceDate)>=dateTodayLocal()).length),'futuros']].map(([v,l])=>`<div class="gc-phone-kpi"><strong>${escapeHtml(v)}</strong><span>${escapeHtml(l)}</span></div>`).join('');
  $('#onlineAgendaList').innerHTML=rows.length?rows.map(x=>{
    const term=Number(x.contractDurationMonths)>0;
    const termLine=term?`<br>Contrato contínuo: ${escapeHtml(gcOnlineDurationLabel(x.contractDurationMonths))} · ${Number(x.monthlyTrips)||22} jornadas/mês<br>Mensalidade: ${escapeHtml(money(Number(x.monthlyAmount||x.budget)||0))} · parcelas recebidas ${Math.max(1,cashLedger().filter(e=>e.source===GC_ONLINE_CASH_SOURCE&&(e.onlineLeadId===x.leadId||e.onlineLeadId===x.id)&&e.direction==='in').length)}/${Number(x.contractDurationMonths)||1}`:'';
    const runs=Array.isArray(x.startedRuns)?x.startedRuns:[];const todayRun=runs.find(run=>run.date===dateTodayLocal());
    let launch='';
    if(todayRun)launch=`<div class="gc-inline-notice good"><strong>Partida validada hoje</strong><br>${escapeHtml(todayRun.driver||x.driver||'Motorista')} · ${escapeHtml(new Date(todayRun.startedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))} · cartão reconhecido</div>`;
    else if(gcOnlineContractCoversDate(x,dateTodayLocal()))launch=`<button type="button" class="gc-primary-action" data-online-start-run="${escapeHtml(x.id)}">▣ Iniciar serviço no validador</button>`;
    else launch=`<p class="gc-small-note">${term?'O serviço contínuo só pode partir nas datas de vigência e dias de serviço contratados.':`Data marcada: ${escapeHtml(displayDateValue(x.serviceDate))}. O validador será liberado na data agendada.`}</p>`;
    return `<article class="gc-lead-card"><div class="gc-lead-card-top"><div><strong class="gc-lead-client">${escapeHtml(x.clientName)}</strong><span class="gc-lead-location">${escapeHtml(x.company)} · ${escapeHtml(x.model)} · prefixo ${escapeHtml(x.prefix)} · motorista ${escapeHtml(x.driver||'não definido')}</span></div><span class="gc-service-pill">${term?'Contrato contínuo':'Confirmado'}</span></div><div class="gc-lead-route"><strong>${escapeHtml(x.origin)}</strong> → <strong>${escapeHtml(x.destination)}</strong><br>Serviço: ${escapeHtml(displayDateValue(x.serviceDate))}<br>Saída da garagem: ${escapeHtml(gcOnlineFormatDateTime(x.departureAt))}<br>Chegada prevista: ${escapeHtml(gcOnlineFormatDateTime(x.arrivalAt))}${termLine}</div><div class="gc-lead-budget"><div><small>${term?'Mensalidade contratada':'Receita no Caixa'}</small><strong>${escapeHtml(money(Number(x.monthlyAmount||x.budget)||0))}</strong></div><div style="text-align:right"><small>${term?'Resultado mensal estimado':'Resultado estimado'}</small><strong class="${Number(x.estimatedProfit)>=0?'positive':'negative'}">${escapeHtml(money(Number(x.estimatedProfit)||0))}</strong></div></div>${x.note?`<p class="gc-small-note">${escapeHtml(x.note)}</p>`:''}<div class="gc-online-trip-start">${launch}</div></article>`;
  }).join(''):'<div class="gc-empty-state">Nenhum fretamento aceito ainda. Analise uma proposta e confirme a escala para preencher a agenda.</div>';
}
function gcOnlineRenderDirectory(){
  const q=norm($('#onlineDirectorySearch').value),kind=$('#onlineDirectoryType').value;
  const rows=GC_ONLINE_CLIENT_CATALOG.filter(x=>(!q||norm(`${x.name} ${x.organization} ${x.city} ${x.state} ${x.origin} ${x.destination}`).includes(q))&&(!kind||x.clientType===kind));
  $('#onlineDirectorySummary').textContent=`Exibindo ${Math.min(rows.length,15)} de ${rows.length} resultado(s) · base total: ${GC_ONLINE_CLIENT_CATALOG.length.toLocaleString('pt-BR')} clientes potenciais, incluindo prefeituras e empresas que podem solicitar contratos contínuos.`;
  $('#onlineDirectoryResults').innerHTML=rows.length?rows.slice(0,15).map(x=>`<div class="gc-directory-row"><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.clientType)} · ${escapeHtml(x.city)}/${escapeHtml(x.state)}<br>Rotas de referência: ${escapeHtml(x.origin)} → ${escapeHtml(x.destination)}</small></div>`).join(''):'<div class="gc-empty-state">Nenhum cliente corresponde à pesquisa.</div>';
}
function gcOnlineRenderMessagePreview(){
  const template=$('#onlineMessageTemplate').value,lead=gcOnlineFindLead(gcOnlineSelectedLeadId)||gcOnlinePending()[0];
  const name=lead?.organization||lead?.clientName||'Cliente',route=lead?`${lead.origin} → ${lead.destination}`:'o trajeto solicitado';
  const messages={moreInfo:`Olá, ${name}! Aqui é do Grupo Conect. Recebemos sua consulta para ${route}. Para preparar uma proposta correta, poderia confirmar a data, o número de passageiros, o tempo de espera e se haverá retorno no mesmo dia?`,counterOffer:`Olá, ${name}! Obrigado por consultar o Grupo Conect para ${route}. Considerando veículo, combustível, equipe e despesas operacionais, nossa contraproposta para o serviço é de ${money(lead?gcOnlineMakeEstimate(lead).recommended:0)}. Podemos conversar sobre os detalhes?`,accepted:`Olá, ${name}! O Grupo Conect confirma o recebimento e o agendamento simulado do serviço ${route}. A escala prevista e os horários foram registrados no nosso controle. Obrigado pela preferência!`,declined:`Olá, ${name}! Agradecemos por consultar o Grupo Conect para ${route}. Neste momento, não conseguimos atender nas condições informadas. Ficamos à disposição para avaliar outra data ou orçamento.`};
  $('#onlineMessagePreview').textContent=messages[template]||messages.moreInfo;return messages[template]||messages.moreInfo;
}
function gcOnlineShowTab(tab){
  if(!assertOwner())return;gcOnlineActiveTab=['clients','agenda','tools'].includes(tab)?tab:'clients';
  $('#onlineClientsView').hidden=gcOnlineActiveTab!=='clients';$('#onlineAgendaView').hidden=gcOnlineActiveTab!=='agenda';$('#onlineToolsView').hidden=gcOnlineActiveTab!=='tools';
  $$('[data-online-tab]').forEach(b=>b.classList.toggle('active',b.dataset.onlineTab===gcOnlineActiveTab));
  if(gcOnlineActiveTab==='agenda')gcOnlineRenderAgenda();if(gcOnlineActiveTab==='tools'){gcOnlineRenderDirectory();gcOnlineRenderMessagePreview();}
}
function gcOnlineRender(){
  const state=gcOnlineCurrentState||gcOnlineLoadState();gcOnlineCurrentState=state;
  gcOnlineRenderKpis();gcOnlineRenderLeadList();gcOnlineRenderAgenda();gcOnlineRenderDirectory();gcOnlineRenderMessagePreview();
}
function gcOnlineShowLead(id){
  if(!assertOwner())return;const lead=gcOnlineFindLead(id);if(!lead){showToast('Esta proposta não está mais disponível.');return;}
  gcOnlineSelectedLeadId=id;$('#onlineDispatchPanel').hidden=true;$('#onlineLeadDetail').hidden=false;
  const est=gcOnlineMakeEstimate(lead),already=lead.status!=='pending',isContract=Number(lead.contractDurationMonths)>0;
  const facts=[['Origem',lead.origin],['Destino',lead.destination],['Data solicitada',displayDateValue(lead.serviceDate)],['Saída solicitada',lead.requestedDeparture],['Previsão ao destino',`${displayDateValue(lead.requestedArrivalDate||lead.serviceDate)} ${lead.requestedArrival}`],['Passageiros',String(lead.passengers)],['Km de ida estimados',`${numberPt(lead.oneWayKm,0)} km`],['Km por serviço/dia',`${numberPt(lead.totalKm,0)} km`],['Duração diária estimada',`${numberPt(lead.serviceHours,1)} h`],...(isContract? [['Prazo escolhido pelo cliente',gcOnlineDurationLabel(lead.contractDurationMonths)],['Jornadas estimadas por mês',String(lead.monthlyTrips)],['Km estimados por mês',`${numberPt(lead.monthlyKm||lead.totalKm*lead.monthlyTrips,0)} km`]]:[]),[isContract?'Mensalidade oferecida':'Orçamento oferecido',money(lead.budget)]];
  $('#onlineLeadDetail').innerHTML=`<div class="gc-section-title"><div><span class="gc-app-eyebrow">ANÁLISE DA PROPOSTA</span><h3>${escapeHtml(lead.clientName)}</h3></div><button type="button" class="gc-icon-button" id="onlineCloseLeadDetail" aria-label="Fechar detalhes">×</button></div><p class="gc-small-note">${escapeHtml(lead.clientCity||lead.originRegion)}/${escapeHtml(lead.clientState||lead.originState)} · ${escapeHtml(lead.clientType)} · proposta recebida ${escapeHtml(displayDateValue(lead.receivedDate))}</p><div class="gc-detail-facts">${facts.map(([k,v])=>`<div class="gc-detail-fact"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}</div><div class="gc-cost-breakdown"><strong style="display:block;margin-bottom:5px;color:#193f4c;font-size:10px">${isContract?'Estimativa mensal do contrato':'Estimativa financeira antes de escolher o ônibus'}</strong>${gcOnlineMoneyRow('Combustível estimado',est.fuel+est.energy)}${gcOnlineMoneyRow('Motorista / equipe',est.driver)}${gcOnlineMoneyRow('Manutenção e pneus',est.maintenance)}${gcOnlineMoneyRow('Pedágios e deslocamentos',est.tolls)}${gcOnlineMoneyRow('Limpeza / preparação',est.serviceExtra)}${gcOnlineMoneyRow('Reserva para imprevistos',est.contingency)}${gcOnlineMoneyRow(isContract?'Custo total mensal estimado':'Custo estimado total',est.total)}</div>${gcOnlineVerdictMarkup(est)}${isContract?'<p class="gc-small-note">O prazo mostrado foi escolhido pelo cliente/prefeitura nesta proposta. O valor oferecido é mensal, não o total de todos os anos. Ao aceitar, a primeira mensalidade entra no Caixa e as seguintes são registradas conforme os meses transcorram e o aplicativo voltar a ser aberto.</p>':''}${already?`<div class="gc-inline-notice">Esta proposta já foi ${lead.status==='accepted'?'aceita':'recusada'}.</div>`:`<div class="gc-detail-actions"><button type="button" class="gc-primary-action" data-online-accept="${escapeHtml(lead.id)}">Escolher ônibus e aceitar</button><button type="button" class="gc-secondary-action" data-online-reject="${escapeHtml(lead.id)}">Recusar proposta</button></div>`}<button type="button" class="gc-secondary-action" id="onlineBackToLeadList" style="margin-top:7px">← Voltar à caixa de entrada</button>`;
  $('#onlineLeadDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function gcOnlineVehicleRows(company){
  const rows=typeof uniqueVehicleOptions==='function'?uniqueVehicleOptions():[];return rows.filter(x=>norm(x.company)===norm(company)&&x.model&&x.prefix).map(x=>({company:x.company,model:x.model,prefix:String(x.prefix),chassis:x.chassis||''}));
}
function gcOnlineBusKey(x){return `${norm(x?.company)}|${norm(x?.prefix)}`;}
function gcOnlineWeekdayKey(value){const n=norm(value).replace(/-feira/g,'').trim();const first=n.split(/\s+/)[0];return ({segunda:'segunda',terca:'terca',terça:'terca',quarta:'quarta',quinta:'quinta',sexta:'sexta',sabado:'sabado',sábado:'sabado',domingo:'domingo'})[first]||first;}
function gcOnlineWeekdayForDate(iso){const d=new Date(`${iso}T12:00:00`);return Number.isNaN(d.getTime())?'':['domingo','segunda','terca','quarta','quinta','sexta','sabado'][d.getDay()];}
function gcOnlineDateAddMonths(iso,months){const [y,m,d]=String(iso||'').split('-').map(Number);if(!y||!m||!d)return iso;const total=(m-1)+Number(months||0),yy=y+Math.floor(total/12),mm=((total%12)+12)%12,last=new Date(yy,mm+1,0).getDate();return `${yy}-${String(mm+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;}
function gcOnlineContractCoversDate(contract,date){
  const start=String(contract.serviceDate||contract.departureAt||'').slice(0,10),months=Number(contract.contractDurationMonths)||0;
  if(!start||!date)return false;
  if(!months)return date===start;
  const end=gcOnlineDateAddMonths(start,months);if(date<start||date>=end)return false;
  const serviceDays=Array.isArray(contract.contractServiceDays)&&contract.contractServiceDays.length?contract.contractServiceDays:['segunda','terca','quarta','quinta','sexta'];
  return serviceDays.includes(gcOnlineWeekdayForDate(date));
}
function gcOnlineLocalDatePart(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value||'').slice(0,10);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function gcOnlineBusReservationReason(vehicle,date,ignoreLeadId=''){
  if(!vehicle||!date)return null;const key=gcOnlineBusKey(vehicle),onlineState=gcOnlineCurrentState||gcOnlineLoadState();
  const contract=(onlineState.contracts||[]).find(x=>x.status==='accepted'&&(x.leadId||x.id)!==ignoreLeadId&&gcOnlineBusKey(x)===key&&gcOnlineContractCoversDate(x,date));
  if(contract)return {kind:'Atendimento Online',message:`prefixo ${vehicle.prefix} já está reservado para ${contract.clientName} nessa data${Number(contract.contractDurationMonths)>0?' por um contrato contínuo':''}.`};
  const scale=ownerScales().find(x=>String(x.date||'').slice(0,10)===date&&gcOnlineBusKey(x)===key);
  if(scale)return {kind:'Escala diária',message:`prefixo ${vehicle.prefix} já está escalado para ${scale.company} · ${scale.city} · ${scale.line} em ${date}.`};
  const weekday=gcOnlineWeekdayForDate(date);
  const op=ownerOperations().find(x=>gcOnlineBusKey({company:x.company,prefix:x.prefix})===key&&gcOnlineWeekdayKey(x.weekday)===weekday&&x.status!=='pausada');
  if(op)return {kind:'Operação de Linha',message:`prefixo ${vehicle.prefix} já está reservado na Operação de Linha ${op.city} · ${op.line} nesse dia da semana (${xSafeLabel(op.weekday)}).`};
  const priorTrip=loadHistory().find(t=>gcOnlineBusKey({company:t.company,prefix:t.busPrefix})===key&&gcOnlineLocalDatePart(t.timestamp||dateTodayLocal())===date);
  if(priorTrip)return {kind:'Histórico de viagens',message:`prefixo ${vehicle.prefix} já foi usado em uma viagem normal nessa data (${priorTrip.city||'cidade não informada'} · ${priorTrip.line||'linha não informada'}).`};
  if(date===dateTodayLocal()&&typeof state==='object'&&state.journey&&gcOnlineBusKey({company:state.journey.company,prefix:state.journey.busPrefix})===key)return {kind:'Viagem em andamento',message:`prefixo ${vehicle.prefix} já está selecionado em uma viagem normal em andamento hoje.`};
  return null;
}
function gcOnlineRecurringOperationConflict(vehicle,weekdayLabel){
  if(!vehicle)return null;
  const key=gcOnlineBusKey(vehicle),targetWeekday=gcOnlineWeekdayKey(weekdayLabel),today=dateTodayLocal();
  const onlineState=gcOnlineCurrentState||gcOnlineLoadState();
  const contracts=(onlineState.contracts||[]).filter(x=>x.status==='accepted'&&gcOnlineBusKey(x)===key);
  for(const contract of contracts){
    const start=String(contract.serviceDate||contract.departureAt||'').slice(0,10);
    const months=Number(contract.contractDurationMonths)||0;
    if(!start)continue;
    if(!months){
      if(start>=today&&gcOnlineWeekdayForDate(start)===targetWeekday){
        return {kind:'Atendimento Online',message:`prefixo ${vehicle.prefix} já está contratado para ${contract.clientName} em ${start}. Como esta operação se repete toda ${weekdayLabel}, o mesmo ônibus não pode ser reservado também para essa linha.`};
      }
      continue;
    }
    const end=gcOnlineDateAddMonths(start,months);
    const serviceDays=Array.isArray(contract.contractServiceDays)&&contract.contractServiceDays.length?contract.contractServiceDays:['segunda','terca','quarta','quinta','sexta'];
    if(end<=today||!serviceDays.includes(targetWeekday))continue;
    const from=start>today?start:today;
    for(let offset=0;offset<7;offset++){
      const d=new Date(`${from}T12:00:00`);d.setDate(d.getDate()+offset);
      const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if(iso>=end)break;
      if(gcOnlineWeekdayForDate(iso)===targetWeekday&&gcOnlineContractCoversDate(contract,iso)){
        return {kind:'Contrato contínuo de fretamento',message:`prefixo ${vehicle.prefix} já está reservado para o contrato contínuo de ${contract.clientName} (${gcOnlineDurationLabel(months)}). Escolha outro ônibus para uma operação recorrente às ${weekdayLabel}.`};
      }
    }
  }
  const scale=ownerScales().find(x=>gcOnlineBusKey(x)===key&&String(x.date||'')>=today&&gcOnlineWeekdayForDate(String(x.date||'').slice(0,10))===targetWeekday);
  if(scale)return {kind:'Escala diária',message:`prefixo ${vehicle.prefix} já está escalado em ${scale.city} · ${scale.line} no dia ${scale.date}; não pode ser atribuído também a uma linha recorrente de ${weekdayLabel}.`};
  const existingOperation=ownerOperations().find(x=>gcOnlineBusKey({company:x.company,prefix:x.prefix})===key&&gcOnlineWeekdayKey(x.weekday)===targetWeekday&&x.status!=='pausada');
  if(existingOperation)return {kind:'Operação de Linha',message:`prefixo ${vehicle.prefix} já está na operação ${existingOperation.city} · ${existingOperation.line} às ${weekdayLabel}.`};
  return null;
}
function xSafeLabel(value){return String(value||'dia cadastrado');}
function gcOnlineAvailableVehicleRows(company,date,ignoreLeadId=''){
  return gcOnlineVehicleRows(company).map(v=>({...v,reservation:gcOnlineBusReservationReason(v,date,ignoreLeadId)}));
}
function gcOnlinePopulateModels(){
  const company=$('#onlineDispatchCompany').value,lead=gcOnlineFindLead(gcOnlineSelectedLeadId),date=lead?.serviceDate||'',old=$('#onlineDispatchModel').value;
  const rows=gcOnlineAvailableVehicleRows(company,date,lead?.id),models=[...new Set(rows.filter(x=>!x.reservation).map(x=>x.model))];
  populateSelect($('#onlineDispatchModel'),models.length?'Selecione o modelo disponível':'Nenhum ônibus livre nessa data',models);
  if(models.includes(old))$('#onlineDispatchModel').value=old;else if(models.length)$('#onlineDispatchModel').value=models[0];
  gcOnlinePopulatePrefixes();
}
function gcOnlinePopulatePrefixes(){
  const company=$('#onlineDispatchCompany').value,model=$('#onlineDispatchModel').value,lead=gcOnlineFindLead(gcOnlineSelectedLeadId),date=lead?.serviceDate||'',all=gcOnlineAvailableVehicleRows(company,date,lead?.id).filter(x=>norm(x.model)===norm(model)),old=$('#onlineDispatchPrefix').value;
  const unique=[...new Map(all.map(x=>[x.prefix,x])).values()];
  const select=$('#onlineDispatchPrefix');select.innerHTML='';const first=document.createElement('option');first.value='';first.textContent=unique.some(x=>!x.reservation)?'Selecione o prefixo livre':'Nenhum prefixo livre';select.appendChild(first);
  unique.forEach(x=>{const o=document.createElement('option');o.value=x.prefix;o.textContent=x.reservation?`${x.prefix} · INDISPONÍVEL (${x.reservation.kind})`:x.prefix;o.disabled=!!x.reservation;select.appendChild(o);});
  const free=unique.filter(x=>!x.reservation);if(free.some(x=>x.prefix===old))select.value=old;else if(free.length)select.value=free[0].prefix;
  gcOnlineUpdateDispatchAssessment();
}
function gcOnlineSelectedVehicle(){const company=$('#onlineDispatchCompany')?.value,model=$('#onlineDispatchModel')?.value,prefix=$('#onlineDispatchPrefix')?.value;return gcOnlineVehicleRows(company).find(x=>norm(x.model)===norm(model)&&String(x.prefix)===String(prefix))||null;}
function gcOnlineCapacity(model){const s=String(model||'').toLocaleLowerCase('pt-BR');if(/articul|biarticul/.test(s))return 100;if(/gran micro|micro|volare|lo-916|lo-915|9\.160/.test(s))return 30;if(/paradiso|viaggio|audace|spectrum road|rodovi|ideale|irizar/.test(s))return 48;if(/apache|torino|gran via|neobus n10/.test(s))return 70;return 45;}
function gcOnlineUpdateDispatchAssessment(){
  const lead=gcOnlineFindLead(gcOnlineSelectedLeadId),vehicle=gcOnlineSelectedVehicle(),box=$('#onlineDispatchAssessment');if(!box)return;
  if(!lead){box.className='gc-inline-notice';box.textContent='Selecione uma proposta primeiro.';return;}
  const company=$('#onlineDispatchCompany').value||'',allRows=gcOnlineVehicleRows(company),available=gcOnlineAvailableVehicleRows(company,lead.serviceDate,lead.id).filter(x=>!x.reservation);
  if(!vehicle){box.className=allRows.length&&!available.length?'gc-inline-notice bad':'gc-inline-notice';box.textContent=allRows.length&&!available.length?`Nenhum ônibus de ${company} está livre em ${displayDateValue(lead.serviceDate)}. Prefixos escalados em outra viagem, numa escala diária ou numa operação recorrente ficam bloqueados para esse dia.`:'Selecione empresa, modelo e prefixo livre. O sistema impede o uso do mesmo ônibus em outra viagem na mesma data.';return;}
  const reservation=gcOnlineBusReservationReason(vehicle,lead.serviceDate,lead.id);if(reservation){box.className='gc-inline-notice bad';box.textContent=`Ônibus indisponível: ${reservation.message} Escolha outro prefixo ou outra data.`;return;}
  const capacity=gcOnlineCapacity(vehicle.model),est=gcOnlineMakeEstimate(lead,vehicle.model),isContract=Number(lead.contractDurationMonths)>0;
  if(lead.passengers>capacity){box.className='gc-inline-notice bad';box.textContent=`Atenção: o veículo comporta aproximadamente ${capacity} passageiros, mas a solicitação é de ${lead.passengers}. Escolha outro ônibus com capacidade suficiente.`;}
  else if(est.profit<=0){box.className='gc-inline-notice warn';box.textContent=`Capacidade compatível (${capacity} estimados). ${isContract?'Resultado mensal':'Resultado'} previsto: ${money(est.profit)}. Você ainda pode aceitar por decisão própria, mas o orçamento parece insuficiente.`;}
  else{box.className='gc-inline-notice good';box.textContent=`Capacidade aproximada: ${capacity} passageiros. ${isContract?'Resultado mensal estimado':'Resultado estimado'} com este ônibus: ${money(est.profit)} (${numberPt(est.margin,1)}% de margem). ${isContract?`Prazo solicitado pelo cliente: ${gcOnlineDurationLabel(lead.contractDurationMonths)}. A mensalidade de ${money(lead.budget)} será lançada no Caixa ao confirmar.`:`O orçamento de ${money(lead.budget)} será lançado no Caixa ao confirmar.`}`;}
}
function gcOnlineDefaultDispatchTimes(lead){
  const dep=new Date(`${lead.serviceDate}T${lead.requestedDeparture}:00`);dep.setMinutes(dep.getMinutes()-45);
  const travelMinutes=Math.max(30,Math.round(Number(lead.oneWayKm||50)/45*60+30));const eta=new Date(dep.getTime()+travelMinutes*60000);
  const localValue=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return {departure:localValue(dep),arrival:localValue(eta)};
}
function gcOnlinePopulateDispatchDrivers(){
  const select=$('#onlineDispatchDriver');if(!select)return;
  const company=$('#onlineDispatchCompany').value||GROUP_COMPANIES[0]||'Progresso';
  const rows=typeof driverRoster==='function'?driverRoster(company):['Pablo','Treinamento','Kaio'];
  const old=select.value;populateSelect(select,'Selecione o motorista',rows);select.value=rows.includes(old)?old:(rows[0]||'');
}
function gcOnlineStartDispatch(id){
  if(!assertOwner())return;const lead=gcOnlineFindLead(id);if(!lead||lead.status!=='pending'){showToast('A proposta não está pendente.');return;}
  gcOnlineSelectedLeadId=id;$('#onlineDispatchPanel').hidden=false;$('#onlineDispatchCompany').innerHTML='';populateSelect($('#onlineDispatchCompany'),'Selecione a empresa',GROUP_COMPANIES);$('#onlineDispatchCompany').value=GROUP_COMPANIES[0]||'';gcOnlinePopulateModels();gcOnlinePopulateDispatchDrivers();
  const times=gcOnlineDefaultDispatchTimes(lead);$('#onlineGarageDeparture').value=times.departure;$('#onlineExpectedArrival').value=times.arrival;$('#onlineDispatchNote').value='';gcOnlineUpdateDispatchAssessment();$('#onlineDispatchPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function gcOnlineConfirmAcceptance(event){
  event.preventDefault();if(!assertOwner())return;const state=gcOnlineCurrentState||gcOnlineLoadState(),lead=state.leads.find(x=>x.id===gcOnlineSelectedLeadId);
  if(!lead||lead.status!=='pending'){showToast('Esta proposta já foi resolvida ou não foi encontrada.');return;}
  const vehicle=gcOnlineSelectedVehicle(),departure=$('#onlineGarageDeparture').value,arrival=$('#onlineExpectedArrival').value,company=$('#onlineDispatchCompany').value,driver=$('#onlineDispatchDriver')?.value||'',note=$('#onlineDispatchNote').value.trim();
  if(!vehicle||!company||!driver||!departure||!arrival){showToast('Escolha empresa, ônibus, prefixo, motorista e os dois horários.');return;}
  const depDate=new Date(departure),arrDate=new Date(arrival);if(Number.isNaN(depDate.getTime())||Number.isNaN(arrDate.getTime())||arrDate<=depDate){showToast('A chegada prevista deve ser posterior à saída da garagem.');return;}
  const reservation=gcOnlineBusReservationReason(vehicle,lead.serviceDate,lead.id);if(reservation){showToast(`Escala recusada: ${reservation.message} Este ônibus não pode fazer outra viagem nessa data.`);gcOnlinePopulateModels();return;}
  const capacity=gcOnlineCapacity(vehicle.model);if(lead.passengers>capacity){showToast(`Este ônibus comporta aproximadamente ${capacity} passageiros; a proposta pede ${lead.passengers}. Escolha um maior.`);return;}
  if(state.contracts.some(x=>x.leadId===lead.id)){showToast('Esta proposta já está aceita e consta no histórico.');return;}
  const estimate=gcOnlineMakeEstimate(lead,vehicle.model),isContract=Number(lead.contractDurationMonths)>0,cashEntryId=isContract?`online-contract-cash-${lead.id}-1`:`online-cash-${lead.id}`,existingEntry=cashLedger().find(x=>x.id===cashEntryId||(!isContract&&x.onlineLeadId===lead.id&&x.source===GC_ONLINE_CASH_SOURCE));
  const entry=existingEntry||{id:cashEntryId,date:dateTodayLocal(),direction:'in',category:isContract?'Mensalidade de contrato de fretamento':'Receita de turismo / fretamento',amount:Number(lead.budget)||0,description:isContract?`Mensalidade 1/${lead.contractDurationMonths} · ${lead.clientName} · ${lead.origin} → ${lead.destination} · ${company} · ${vehicle.model} prefixo ${vehicle.prefix} · prazo ${gcOnlineDurationLabel(lead.contractDurationMonths)}`:`${lead.clientName} · ${lead.origin} → ${lead.destination} · ${company} · ${vehicle.model} prefixo ${vehicle.prefix} · saída ${gcOnlineFormatDateTime(departure)} · chegada ${gcOnlineFormatDateTime(arrival)}`,createdAt:new Date().toISOString(),auto:true,source:GC_ONLINE_CASH_SOURCE,onlineLeadId:lead.id,onlineContractPeriod:isContract?1:undefined,onlineContractDurationMonths:isContract?lead.contractDurationMonths:undefined};
  if(!(Number(entry.amount)>0)){showToast(isContract?'A mensalidade da proposta precisa ser maior que zero.':'O valor da proposta precisa ser maior que zero para registrar a receita.');return;}
  if(!existingEntry){const ledger=cashLedger();ledger.push(entry);if(!writeArrayKey(CASH_LEDGER_KEY,ledger))return;}
  const contract={id:`online-contract-${lead.id}`,leadId:lead.id,clientId:lead.clientId,clientName:lead.clientName,organization:lead.organization,origin:lead.origin,destination:lead.destination,serviceType:lead.serviceType,serviceDate:lead.serviceDate,requestedDeparture:lead.requestedDeparture,passengers:lead.passengers,budget:Number(lead.budget),monthlyAmount:isContract?Number(lead.budget):0,contractDurationMonths:isContract?Number(lead.contractDurationMonths):0,monthlyTrips:isContract?Number(lead.monthlyTrips)||22:1,monthlyKm:isContract?Number(lead.monthlyKm)||Number(lead.totalKm)*Number(lead.monthlyTrips||22):0,contractServiceDays:isContract?(lead.contractServiceDays||['segunda','terca','quarta','quinta','sexta']):[],estimatedCost:estimate.total,estimatedProfit:estimate.profit,company,model:vehicle.model,prefix:vehicle.prefix,chassis:vehicle.chassis,departureAt:departure,arrivalAt:arrival,driver,note,startedRuns:[],acceptedAt:new Date().toISOString(),status:'accepted',cashEntryId:entry.id};
  lead.status='accepted';lead.resolvedAt=new Date().toISOString();lead.contractId=contract.id;state.contracts.push(contract);
  if(!gcOnlineSaveState(state)){showToast('A receita foi registrada no Caixa, mas o contrato não pôde ser salvo no Atendimento Online. Não repita a operação; confira a agenda/caixa.');return;}
  gcOnlineSelectedLeadId=lead.id;$('#onlineDispatchPanel').hidden=true;$('#onlineLeadDetail').hidden=true;renderCashDashboard();renderFinanceList();gcOnlineRender();gcOnlineShowTab('agenda');showToast(isContract?`Contrato aceito por ${gcOnlineDurationLabel(lead.contractDurationMonths)}. A 1ª mensalidade (${money(entry.amount)}) entrou no Caixa. As demais serão lançadas mensalmente enquanto o simulador for aberto.`:`Proposta aceita. ${money(entry.amount)} entrou no Caixa do Grupo Conect automaticamente.`);
}
function gcOnlineStartContractRun(id){
  if(!assertOwner())return;
  const current=gcOnlineCurrentState||gcOnlineLoadState(),contract=current.contracts.find(x=>x.id===id&&x.status==='accepted');
  if(!contract){showToast('Serviço não encontrado na agenda.');return;}
  const today=dateTodayLocal();if(!gcOnlineContractCoversDate(contract,today)){showToast('Este serviço ainda não está previsto para hoje ou o contrato está fora da vigência.');return;}
  const runs=Array.isArray(contract.startedRuns)?contract.startedRuns:[];if(runs.some(run=>run.date===today)){showToast('A viagem deste contrato já teve partida validada hoje.');gcOnlineRenderAgenda();return;}
  const vehicle={company:contract.company,model:contract.model,prefix:contract.prefix};const conflict=gcOnlineBusReservationReason(vehicle,today,contract.leadId||contract.id);
  if(conflict){showToast(`Partida bloqueada: ${conflict.message}`);return;}
  gcValidatorOpen({type:'online',onlineContractId:contract.id,onlineLeadId:contract.leadId||contract.id,driver:contract.driver||'Pablo',company:contract.company,model:contract.model,prefix:contract.prefix,city:contract.origin,line:`${contract.serviceType||'Fretamento'} · ${contract.clientName}`});
}
function gcOnlineCommitServiceStart(p,validatorLogId){
  if(!assertOwner())return;
  const current=gcOnlineCurrentState||gcOnlineLoadState(),contract=current.contracts.find(x=>x.id===p.onlineContractId&&x.status==='accepted');
  if(!contract){showToast('O contrato não foi encontrado; nenhuma partida foi registrada.');switchScreen('ownerAreaScreen');return;}
  const today=dateTodayLocal();if(!gcOnlineContractCoversDate(contract,today)){showToast('O serviço não está previsto para hoje; a partida não foi registrada.');switchScreen('ownerAreaScreen');return;}
  if(!Array.isArray(contract.startedRuns))contract.startedRuns=[];
  if(contract.startedRuns.some(run=>run.date===today)){showToast('Já existe uma partida validada para este serviço hoje.');switchScreen('ownerAreaScreen');gcOnlineShowTab('agenda');return;}
  const conflict=gcOnlineBusReservationReason({company:contract.company,model:contract.model,prefix:contract.prefix},today,contract.leadId||contract.id);
  if(conflict){showToast(`Partida bloqueada: ${conflict.message}`);switchScreen('ownerAreaScreen');gcOnlineShowTab('agenda');return;}
  contract.startedRuns.push({id:makeId(),date:today,driver:p.driver,validatorLogId,startedAt:new Date().toISOString(),status:'partida validada'});
  if(!gcOnlineSaveState(current)){showToast('Não foi possível salvar a partida do contrato. Confira o histórico antes de tentar novamente.');return;}
  gcOnlineRender();gcOnlineShowTab('agenda');switchScreen('ownerAreaScreen');showToast(`Partida validada para ${contract.clientName}. O cartão de ${p.driver} foi registrado no simulador.`);
}
$('#onlineAgendaList')?.addEventListener('click',event=>{const button=event.target.closest('[data-online-start-run]');if(button)gcOnlineStartContractRun(button.dataset.onlineStartRun);});
function gcOnlineHandleOfferAction(event){
  const view=event.target.closest('[data-online-view]');if(view){gcOnlineShowLead(view.dataset.onlineView);return;}
  const accept=event.target.closest('[data-online-accept]');if(accept){gcOnlineStartDispatch(accept.dataset.onlineAccept);return;}
  const reject=event.target.closest('[data-online-reject]');if(reject){if(!assertOwner())return;const state=gcOnlineCurrentState||gcOnlineLoadState(),lead=state.leads.find(x=>x.id===reject.dataset.onlineReject);if(!lead||lead.status!=='pending')return;if(!window.confirm(`Recusar a proposta de ${lead.clientName}?`))return;lead.status='rejected';lead.resolvedAt=new Date().toISOString();gcOnlineSaveState(state);$('#onlineLeadDetail').hidden=true;$('#onlineDispatchPanel').hidden=true;gcOnlineRender();showToast('Proposta recusada e arquivada.');return;}
  if(event.target.closest('#onlineCloseLeadDetail')){$('#onlineLeadDetail').hidden=true;$('#onlineDispatchPanel').hidden=true;return;}
  if(event.target.closest('#onlineBackToLeadList')){$('#onlineLeadDetail').hidden=true;$('#onlineDispatchPanel').hidden=true;return;}
}
function gcOnlineCalculateTool(event){
  event.preventDefault();if(!assertOwner())return;
  const km=readToolValue('onlineCalcKm'),hours=readToolValue('onlineCalcHours'),eff=readToolValue('onlineCalcEfficiency'),price=readToolValue('onlineCalcDieselPrice'),other=readToolValue('onlineCalcOtherCosts'),offer=readToolValue('onlineCalcOffer');
  if([km,hours,eff,price,other,offer].some(x=>x===null)||km<=0||hours<=0||eff<=0){$('#onlineQuoteCalcResult').innerHTML='<div class="gc-inline-notice warn">Preencha todos os campos com valores válidos. Km, horas e consumo precisam ser maiores que zero.</div>';return;}
  const fuel=km/eff*price,driver=hours*58+45,wear=km*.82,contingency=(fuel+driver+wear+other)*.055,total=fuel+driver+wear+other+contingency,profit=offer-total,margin=offer?profit/offer*100:-100,level=profit<=0?'bad':margin<12?'warn':'good';
  $('#onlineQuoteCalcResult').innerHTML=`<div class="gc-cost-breakdown">${gcOnlineMoneyRow('Combustível',fuel)}${gcOnlineMoneyRow('Equipe / motorista',driver)}${gcOnlineMoneyRow('Manutenção e pneus',wear)}${gcOnlineMoneyRow('Outras despesas informadas',other)}${gcOnlineMoneyRow('Reserva para imprevistos',contingency)}${gcOnlineMoneyRow('Custo estimado total',total)}</div><div class="gc-inline-notice ${level}"><strong>${profit<=0?'Não cobre os custos':margin<12?'Margem apertada':'Margem estimada positiva'}</strong><br>Resultado: ${escapeHtml(money(profit))} · margem ${numberPt(margin,1)}%<br>Valor sugerido para margem de 20%: ${escapeHtml(money(total*1.2))}.</div>`;
}
function gcOnlineAcceptMessageCopy(){
  if(!assertOwner())return;const text=gcOnlineRenderMessagePreview();copyText(text).then(ok=>showToast(ok?'Mensagem copiada.':'Não foi possível copiar; selecione e copie o texto manualmente.'));
}
function gcOnlineOpenPanel(){
  if(!assertOwner())return;const result=gcOnlineSyncArrivals(false);gcOnlineCurrentState=result.state;
  $('#onlineServicePanel').hidden=false;gcOnlineShowTab('clients');gcOnlineRender();
  if(result.newCount)showToast(`${result.newCount} nova(s) proposta(s) disponível(is).`);else showToast('Atendimento Online aberto. Confira a caixa de entrada.');
  $('#onlineServicePanel').scrollIntoView({behavior:'smooth',block:'start'});
}
$('#onlineOpenButton')?.addEventListener('click',gcOnlineOpenPanel);
$('#onlineCloseButton')?.addEventListener('click',()=>{if(!assertOwner())return;$('#onlineServicePanel').hidden=true;$('#onlineOpenButton').scrollIntoView({behavior:'smooth',block:'center'});});
$('#onlineRefreshProposals')?.addEventListener('click',()=>{if(!assertOwner())return;const result=gcOnlineSyncArrivals(true);gcOnlineCurrentState=result.state;gcOnlineRender();showToast(result.newCount?`${result.newCount} nova(s) proposta(s) encontrada(s).`:'Nenhuma nova proposta desta vez; tente novamente após algum tempo.');});
$('#onlineCheckArrivals')?.addEventListener('click',()=>$('#onlineRefreshProposals').click());
$$('[data-online-tab]').forEach(b=>b.addEventListener('click',()=>gcOnlineShowTab(b.dataset.onlineTab)));
$('#onlineLeadList')?.addEventListener('click',gcOnlineHandleOfferAction);
$('#onlineLeadDetail')?.addEventListener('click',gcOnlineHandleOfferAction);
$('#onlineDispatchCompany')?.addEventListener('change',gcOnlinePopulateModels);
$('#onlineDispatchCompany')?.addEventListener('change',gcOnlinePopulateDispatchDrivers);
$('#onlineDispatchModel')?.addEventListener('change',gcOnlinePopulatePrefixes);
$('#onlineDispatchPrefix')?.addEventListener('change',gcOnlineUpdateDispatchAssessment);
$('#onlineGarageDeparture')?.addEventListener('change',()=>{const dep=new Date($('#onlineGarageDeparture').value);if(Number.isNaN(dep.getTime()))return;const lead=gcOnlineFindLead(gcOnlineSelectedLeadId);const minutes=Math.max(30,Math.round(Number(lead?.oneWayKm||50)/45*60+30));const arr=new Date(dep.getTime()+minutes*60000);const localValue=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;$('#onlineExpectedArrival').value=localValue(arr);});
$('#onlineCancelDispatch')?.addEventListener('click',()=>{$('#onlineDispatchPanel').hidden=true;});
$('#onlineDispatchForm')?.addEventListener('submit',gcOnlineConfirmAcceptance);
$('#onlineQuoteCalcForm')?.addEventListener('submit',gcOnlineCalculateTool);
$('#onlineMessageTemplate')?.addEventListener('change',gcOnlineRenderMessagePreview);
$('#onlineCopyMessage')?.addEventListener('click',gcOnlineAcceptMessageCopy);
$('#onlineDirectorySearch')?.addEventListener('input',gcOnlineRenderDirectory);
$('#onlineDirectoryType')?.addEventListener('change',gcOnlineRenderDirectory);

/* Banco Grupo Conect + Agenda de Frota. Valores e movimentações são de simulação local. */
const GC_BANK_STAFF_KEY='grupoConect.bankStaff.v1';
const GC_BANK_CARD_KEY='grupoConect.bankCard.v1';
const GC_BANK_IPVA_KEY='grupoConect.bankIpva.v1';
const GC_BANK_PAYROLL_KEY='grupoConect.bankPayroll.v1';
const GC_BANK_LOANS_KEY='grupoConect.bankBusinessLoans.v1';
const GC_AGENDA_PROFILES_KEY='grupoConect.agendaFleet.v1';
const GC_AGENDA_EVENTS_KEY='grupoConect.agendaEvents.v1';
const GC_AGENDA_DONE_KEY='grupoConect.agendaCompleted.v1';
let gcAgendaMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let gcAgendaSelectedDate=dateTodayLocal();
let gcBankCurrentReceipt='';
let gcAgendaInitialized=false;
const gcAgendaMonthNames=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function gcReadObject(key){try{const v=JSON.parse(localStorage.getItem(key)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch(e){return {};}}
function gcWriteObject(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){showToast('Armazenamento cheio ou indisponível neste navegador.');return false;}}
function gcBankLoanRows(){return readArrayKey(GC_BANK_LOANS_KEY);}
function gcBankLoanMonthlyDebt(){return gcBankLoanRows().filter(x=>['Ativo','Aprovado'].includes(x.status)&&Number(x.paidCount||0)<Number(x.term||x.installmentCount||0)).reduce((s,x)=>s+Number(x.installmentAmount||0),0);}
function gcBankLoanCashProfile(){
  const today=dateTodayLocal(),cutoff=gcAgendaDateAdd(today,-180);
  const rows=allCashMovements().filter(x=>!['gcBankLoan','gcBankLoanPayment'].includes(x.source)&&String(x.date||today).slice(0,10)>=cutoff&&String(x.date||today).slice(0,10)<=today&&Number(x.amount)>0);
  const incoming=rows.filter(x=>x.direction==='in').reduce((s,x)=>s+Number(x.amount||0),0);
  const outgoing=rows.filter(x=>x.direction==='out').reduce((s,x)=>s+Number(x.amount||0),0);
  const dates=rows.map(x=>String(x.date||today).slice(0,10)).sort();
  const days=dates.length?Math.max(1,Math.floor((new Date(`${today}T12:00:00`).getTime()-new Date(`${dates[0]}T12:00:00`).getTime())/86400000)+1):30;
  const months=Math.max(1,Math.min(6,days/30));
  return {rows,incoming,outgoing,months,monthlyIncoming:incoming/months,monthlyOutgoing:outgoing/months,monthlyNet:(incoming-outgoing)/months,balance:Number(cashBreakdown().balance)||0,activeMonthlyDebt:gcBankLoanMonthlyDebt()};
}
function gcBankLoanAnalyze(){
  const amount=Number($('#gcBankLoanAmount')?.value)||0,term=Number($('#gcBankLoanTerm')?.value)||24,guarantee=$('#gcBankLoanGuarantee')?.value||'none',purpose=$('#gcBankLoanPurpose')?.value||'capital de giro';
  const profile=gcBankLoanCashProfile(),activeLoans=gcBankLoanRows().filter(x=>['Ativo','Aprovado'].includes(x.status)&&Number(x.paidCount||0)<Number(x.term||x.installmentCount||0));
  const referencePayment=loanMonthlyPayment(amount,term,2.0),net=Math.max(0,profile.monthlyNet),debt=profile.activeMonthlyDebt,ratio=referencePayment>0?net/Math.max(1,referencePayment+debt):0,cashRatio=amount>0?Math.max(0,profile.balance)/amount:0;
  let score=420;
  if(profile.rows.length>=30)score+=100;else if(profile.rows.length>=10)score+=60;else if(profile.rows.length>=3)score+=25;else score-=35;
  if(ratio>=3)score+=210;else if(ratio>=2)score+=155;else if(ratio>=1.2)score+=95;else if(ratio>=.6)score+=40;else score-=85;
  if(cashRatio>=1)score+=120;else if(cashRatio>=.5)score+=80;else if(cashRatio>=.2)score+=50;else if(cashRatio>=.05)score+=20;
  if(guarantee==='receivables')score+=75;else if(guarantee==='fleet')score+=95;else if(guarantee==='property')score+=125;
  if(activeLoans.some(x=>x.status==='Quitado'))score+=35;
  if(net>0&&debt/net>.5)score-=120;else if(net>0&&debt/net>.25)score-=60;
  if(amount>250000)score-=20;if(amount>1000000)score-=45;if(amount>5000000)score-=80;
  if(amount>2000000&&guarantee==='none')score-=80;
  if(amount>5000000&&!['fleet','property'].includes(guarantee))score-=100;
  score=Math.max(250,Math.min(950,Math.round(score)));
  let rate=score>=850?.95:score>=760?1.25:score>=680?1.65:score>=600?2.05:2.45;
  if(amount>1000000)rate+=.2;if(amount>3000000)rate+=.25;if(guarantee==='property')rate-=.1;rate=Math.max(.75,Math.min(2.95,Number(rate.toFixed(2))));
  const zeroRateEligible=amount>0&&amount<=50000&&term<=12&&score>=850&&guarantee!=='none'&&net>=referencePayment*1.5&&(debt+referencePayment)<=net*.35;
  if(zeroRateEligible)rate=0;
  const monthlyPayment=Number(loanMonthlyPayment(amount,term,rate).toFixed(2));
  const totalRepayment=rate===0?Number(amount.toFixed(2)):Number((monthlyPayment*term).toFixed(2));
  let probability=14+(score-250)*.105;
  const burden=net>0?(debt+monthlyPayment)/net:Infinity;
  if(net<=0)probability-=12;else if(burden<=.25)probability+=7;else if(burden>.45)probability-=12;if(burden>.7)probability-=15;
  if(amount>2000000&&guarantee==='none')probability=Math.min(probability,20);
  if(amount>5000000&&!['fleet','property'].includes(guarantee))probability=Math.min(probability,8);
  if(profile.rows.length<3)probability-=5;
  probability=Math.max(5,Math.min(92,Math.round(probability)));
  let reason='A solicitação será avaliada pelo fluxo de caixa, endividamento, garantia e valor pedido.';
  if(amount>10000000)reason='O limite máximo simulado é R$ 10.000.000.';
  else if(amount<5000)reason='O valor mínimo para solicitar é R$ 5.000.';
  else if(amount>5000000&&guarantee==='none')reason='Crédito acima de R$ 5 milhões normalmente exige garantias empresariais substanciais.';
  else if(net<=0&&cashRatio<.05)reason='O histórico ainda não demonstra fluxo de caixa livre suficiente; uma garantia e um histórico operacional melhor podem fortalecer uma nova solicitação.';
  else if(burden>.7)reason='A parcela estimada comprometeria grande parte do fluxo de caixa livre e aumenta o risco de inadimplência.';
  else if(zeroRateEligible)reason='Perfil elegível para uma campanha simulada de taxa zero, limitada a valores baixos, prazo curto e garantia.';
  else if(score>=760)reason='Perfil simulado forte: histórico/caixa e capacidade de pagamento favorecem a análise, sem garantir aprovação.';
  else reason='Perfil intermediário ou de risco elevado: a taxa e a chance de aprovação refletem a capacidade de pagamento e as garantias.';
  return {amount,term,guarantee,purpose,profile,score,probability,rate,monthlyPayment,totalRepayment,totalInterest:Math.max(0,Number((totalRepayment-amount).toFixed(2))),burden,zeroRateEligible,reason,activeLoanCount:activeLoans.length};
}
function gcBankLoanRenderPreview(){
  const target=$('#gcBankLoanPreview');if(!target)return;const a=gcBankLoanAnalyze();
  if(!Number.isFinite(a.amount)||a.amount<5000||a.amount>10000000){target.innerHTML='<strong>Confira o valor solicitado.</strong><p>Informe um valor entre R$ 5.000 e R$ 10.000.000.</p>';$('#gcBankLoanApplyButton').disabled=true;return;}
  $('#gcBankLoanApplyButton').disabled=false;
  target.innerHTML=`<div class="gc-bank-loan-preview-grid"><div><span>Score empresarial simulado</span><strong>${a.score}/950</strong></div><div><span>Chance estimada de aprovação</span><strong>${a.probability}%</strong></div><div><span>Juros ao mês</span><strong>${a.rate===0?'0% · taxa zero':`${numberPt(a.rate,2)}% a.m.`}</strong></div><div><span>Parcela estimada</span><strong>${money(a.monthlyPayment)}</strong></div><div><span>Total a devolver</span><strong>${money(a.totalRepayment)}</strong></div><div><span>Juros totais estimados</span><strong>${money(a.totalInterest)}</strong></div></div><p><b>Fluxo mensal líquido estimado:</b> ${money(a.profile.monthlyNet)} · <b>compromissos mensais atuais:</b> ${money(a.profile.activeMonthlyDebt)} · <b>saldo atual do Caixa:</b> ${money(a.profile.balance)}.</p><p>${escapeHtml(a.reason)}</p><small>Taxa fixa simulada. As parcelas seguem tabela Price, salvo campanha de taxa zero. A chance é uma estimativa lúdica, não uma decisão de crédito real.</small>`;
}
function gcBankLoanNextPaymentAmount(loan){const term=Number(loan.term||loan.installmentCount||0),paid=Number(loan.paidCount||0),total=Number(loan.totalRepayment||Number(loan.installmentAmount||0)*term),repaid=(loan.payments||[]).reduce((s,p)=>s+Number(p.amount||0),0);return Number((paid>=term?0:paid===term-1?Math.max(0,total-repaid):Number(loan.installmentAmount||0)).toFixed(2));}
function gcBankLoanScheduleMarkup(loan){
  const term=Number(loan.term||loan.installmentCount||0);if(!term||term>48)return '';
  const payments=new Map((loan.payments||[]).map(p=>[Number(p.number),p]));let running=0;const amount=Number(loan.amount||0),regular=Number(loan.installmentAmount||0),total=Number(loan.totalRepayment||regular*term);
  const items=Array.from({length:term},(_,i)=>{const n=i+1,part=Number((n===term?Math.max(0,total-running):regular).toFixed(2));running+=part;const payment=payments.get(n),due=addMonthsToISO(loan.firstDueDate,i);return `<div class="gc-bank-loan-schedule-row ${payment?'paid':''}"><span><b>${n}/${term}</b> · ${escapeHtml(localDate(due))}${payment?` · Pago em ${escapeHtml(localDate(payment.date))}`:' · Pendente'}</span><strong>${money(payment?payment.amount:part)}</strong></div>`;});
  return `<details class="gc-bank-loan-payments"><summary>Ver cronograma completo · ${term} parcelas</summary><div class="gc-bank-loan-schedule">${items.join('')}</div></details>`;
}
function gcBankLoanRender(){
  const rows=gcBankLoanRows().slice().reverse(),approved=rows.filter(x=>['Ativo','Aprovado','Quitado'].includes(x.status)),active=approved.filter(x=>Number(x.paidCount||0)<Number(x.term||x.installmentCount||0));
  const borrowed=approved.reduce((s,x)=>s+Number(x.amount||0),0),remaining=active.reduce((s,x)=>s+Math.max(0,Number(x.totalRepayment||Number(x.installmentAmount||0)*Number(x.term||0))-Number((x.payments||[]).reduce((p,y)=>p+Number(y.amount||0),0))),0),monthly=gcBankLoanMonthlyDebt();
  $('#gcBankLoanSummary').innerHTML=[moneyStat('Crédito empresarial liberado',money(borrowed),'positive'),moneyStat('Saldo de parcelas por pagar',money(remaining),remaining>0?'negative':'positive'),moneyStat('Contratos ativos',String(active.length)),moneyStat('Compromisso mensal estimado',money(monthly),monthly>0?'negative':'')].join('');
  $('#gcBankLoanHistory').innerHTML=rows.length?rows.map(x=>{const term=Number(x.term||x.installmentCount||0),paid=Number(x.paidCount||0),left=Math.max(0,term-paid),repaid=(x.payments||[]).reduce((s,p)=>s+Number(p.amount||0),0),balance=['Ativo','Aprovado','Quitado'].includes(x.status)?Math.max(0,Number(x.totalRepayment||0)-repaid):0,nextDue=left?addMonthsToISO(x.firstDueDate,paid):'';const active=['Ativo','Aprovado'].includes(x.status)&&left>0;return `<article class="gc-bank-loan-record"><div class="gc-bank-loan-record-head"><div><strong>${escapeHtml(x.contractNumber||x.id)} · ${money(x.amount)}</strong><small>${escapeHtml(x.purpose||'Crédito empresarial')} · solicitado em ${escapeHtml(localDate(String(x.date||x.createdAt||dateTodayLocal()).slice(0,10)))}</small></div><span class="gc-bank-loan-status ${active?'active':x.status==='Quitado'?'paid':'declined'}">${escapeHtml(x.status||'Em análise')}</span></div><div class="gc-bank-loan-details"><span>Taxa: <b>${Number(x.monthlyRate||0)===0?'0%':`${numberPt(x.monthlyRate,2)}% a.m.`}</b></span><span>Prazo: <b>${term}x</b></span><span>Parcela: <b>${money(x.installmentAmount||0)}</b></span><span>Pagas: <b>${paid}/${term}</b></span><span>Saldo parcelado: <b>${money(balance)}</b></span>${active?`<span>Próximo vencimento: <b>${escapeHtml(localDate(nextDue))}</b></span>`:''}</div>${active||x.status==='Quitado'?gcBankLoanScheduleMarkup(x):''}<p>${escapeHtml(x.reason||'Análise simulada.')}</p><div class="gc-bank-movement-actions">${active?`<button type="button" class="primary-button gc-bank-loan-pay-button" data-bank-loan-pay="${escapeHtml(x.id)}">Pagar próxima parcela · ${money(gcBankLoanNextPaymentAmount(x))}</button>`:''}<button type="button" class="gc-bank-small-button" data-bank-loan-receipt="${escapeHtml(x.id)}">Ver contrato / comprovante</button></div>${(x.payments||[]).length?`<details class="gc-bank-loan-payments"><summary>Histórico de parcelas (${x.payments.length})</summary>${x.payments.map(p=>`<div class="gc-bank-movement-actions"><span>${escapeHtml(localDate(p.date))} · parcela ${Number(p.number)||''} · ${money(p.amount)}</span><button type="button" class="gc-bank-small-button" data-bank-receipt="${escapeHtml(p.ledgerId)}">Comprovante</button></div>`).join('')}</details>`:''}</article>`;}).join(''):recordsEmpty('Ainda não há solicitações. Faça uma simulação acima para avaliar a proposta.');
}
function gcBankLoanContractText(loan,caption='CONTRATO SIMULADO · EMPRÉSTIMO EMPRESARIAL'){
 return [caption,'BANCO GRUPO CONECT · SIMULAÇÃO LOCAL','Este documento é fictício e não representa crédito bancário real.','',`Contrato: ${loan.contractNumber||loan.id}`,`Status: ${loan.status}`,`Data da solicitação: ${localDate(String(loan.date||dateTodayLocal()).slice(0,10))}`,`Finalidade: ${loan.purpose}`,`Valor solicitado/liberado: ${money(loan.amount)}`,`Prazo: ${loan.term} parcelas mensais`,`Taxa fixa: ${Number(loan.monthlyRate||0)===0?'0% ao mês':`${numberPt(loan.monthlyRate,2)}% ao mês`}`,`Parcela estimada: ${money(loan.installmentAmount)}`,`Total previsto: ${money(loan.totalRepayment)}`,`Juros totais previstos: ${money(loan.totalInterest)}`,`Garantia declarada na simulação: ${({none:'Sem garantia específica',receivables:'Recebíveis de contratos',fleet:'Ônibus / frota',property:'Imóvel empresarial'})[loan.guarantee]||loan.guarantee}`,`Score: ${loan.score}/950 · chance estimada: ${loan.probability}%`,`Próximo vencimento: ${!['Ativo','Aprovado'].includes(loan.status)?(loan.status==='Quitado'?'Quitado':'Não se aplica — crédito recusado'):localDate(addMonthsToISO(loan.firstDueDate,loan.paidCount))}`,`Crédito: ${['Ativo','Aprovado','Quitado'].includes(loan.status)?'lançado imediatamente no Caixa na aprovação':'não liberado'}`,`Observação: ${loan.reason||''}`].join('\n');
}
function gcBankLoanApply(event){
 event.preventDefault();if(!assertOwner())return;const a=gcBankLoanAnalyze();if(!Number.isFinite(a.amount)||a.amount<5000||a.amount>10000000||![6,12,18,24,36,48].includes(a.term)){showToast('Informe valor entre R$ 5.000 e R$ 10 milhões e prazo de até 48 parcelas.');return;}
 const existing=gcBankLoanRows(),id=`emp-${makeId()}`,contractNumber=`GC-EMP-${dateTodayLocal().replaceAll('-','')}-${id.slice(-6).toUpperCase()}`;
 const hardRisk=(a.amount>5000000&&!['fleet','property'].includes(a.guarantee))||(a.profile.monthlyNet<=0&&a.profile.balance<a.amount*.05&&a.amount>500000);
 const approved=!hardRisk&&(Math.random()*100<a.probability);
 const record={id,contractNumber,date:dateTodayLocal(),createdAt:new Date().toISOString(),amount:a.amount,term:a.term,installmentCount:a.term,purpose:a.purpose,guarantee:a.guarantee,score:a.score,probability:a.probability,monthlyRate:a.rate,installmentAmount:a.monthlyPayment,totalRepayment:a.totalRepayment,totalInterest:a.totalInterest,paidCount:0,payments:[],status:approved?'Ativo':'Recusado',firstDueDate:addMonthsToISO(dateTodayLocal(),1),reason:approved?(a.zeroRateEligible?'Aprovado pela campanha promocional simulada de taxa zero.':'Aprovado pela análise simulada. O crédito foi depositado imediatamente no Caixa.'):(hardRisk?'Recusa automática simulada: fluxo de caixa/garantia insuficiente para o risco solicitado.':'A proposta não foi aprovada nesta análise. Você pode tentar outro valor, prazo ou garantia.')};
 if(approved){
  const ledgerId=`loan-credit-${record.id}`;const mov={id:ledgerId,date:dateTodayLocal(),direction:'in',amount:record.amount,category:'Crédito de empréstimo empresarial (passivo)',description:`Contrato ${contractNumber} · ${record.term} parcelas · ${record.purpose}`,payee:'Banco Grupo Conect · crédito empresarial simulado',reference:contractNumber,source:'gcBankLoan',loanId:record.id,auto:true};
  mov.receiptText=gcBankLoanContractText(record,'COMPROVANTE DE LIBERAÇÃO IMEDIATA · CRÉDITO SIMULADO');
  if(cashLedger().some(x=>x.id===ledgerId)){showToast('Este empréstimo já está registrado no Caixa.');return;}
  const oldLedger=cashLedger();if(!writeArrayKey(CASH_LEDGER_KEY,[...oldLedger,mov]))return;
  if(!writeArrayKey(GC_BANK_LOANS_KEY,[...existing,record])){writeArrayKey(CASH_LEDGER_KEY,oldLedger);return;}
  renderCashDashboard();renderFinanceList();gcBankRender();gcBankLoanRender();gcBankShowReceipt(mov.receiptText,`liberacao-${contractNumber}.txt`);showToast(`Empréstimo aprovado! ${money(record.amount)} entrou imediatamente no Caixa.`);
 }else{
  record.receiptText=gcBankLoanContractText(record,'RESULTADO DA ANÁLISE · EMPRÉSTIMO EMPRESARIAL');if(!writeArrayKey(GC_BANK_LOANS_KEY,[...existing,record]))return;gcBankLoanRender();gcBankShowReceipt(record.receiptText,`analise-${contractNumber}.txt`);showToast('Solicitação não aprovada desta vez. O saldo do Caixa não foi alterado.');
 }
}
function gcBankLoanPay(id){
 if(!assertOwner())return;const rows=gcBankLoanRows(),idx=rows.findIndex(x=>x.id===id);if(idx<0)return;const loan=rows[idx],term=Number(loan.term||loan.installmentCount||0),paid=Number(loan.paidCount||0);if(!['Ativo','Aprovado'].includes(loan.status)||paid>=term){showToast('Este contrato não possui parcelas pendentes.');return;}
 const ledgerId=`loan-payment-${loan.id}-${paid+1}`,oldLedger=cashLedger(),already=oldLedger.find(x=>x.id===ledgerId);if(already){loan.paidCount=Math.max(paid,paid+1);loan.payments=Array.isArray(loan.payments)?loan.payments:[];if(!loan.payments.some(x=>x.ledgerId===ledgerId))loan.payments.push({number:paid+1,date:already.date,amount:Number(already.amount),ledgerId});if(loan.paidCount>=term)loan.status='Quitado';writeArrayKey(GC_BANK_LOANS_KEY,rows);gcBankRender();gcBankLoanRender();showToast('A parcela já estava contabilizada; o histórico do contrato foi sincronizado.');return;}
 const total=Number(loan.totalRepayment||Number(loan.installmentAmount)*term),repaid=(loan.payments||[]).reduce((s,p)=>s+Number(p.amount||0),0),amount=Number((paid===term-1?Math.max(0,total-repaid):Number(loan.installmentAmount)).toFixed(2));if(amount>cashBreakdown().balance+0.005){showToast(`Saldo insuficiente para esta parcela de ${money(amount)}. Saldo disponível ${money(cashBreakdown().balance)}.`);return;}
 const date=dateTodayLocal(),mov={id:ledgerId,date,direction:'out',amount,category:'Parcela de empréstimo empresarial',description:`Contrato ${loan.contractNumber||loan.id} · parcela ${paid+1}/${term}`,payee:'Banco Grupo Conect · pagamento de crédito simulado',reference:loan.contractNumber||loan.id,source:'gcBankLoanPayment',loanId:loan.id,auto:true};mov.receiptText=[gcBankLoanContractText(loan,'COMPROVANTE SIMULADO DE PAGAMENTO DE PARCELA'),' ',`Parcela paga: ${paid+1}/${term}`,`Valor debitado: ${money(amount)}`,`Data do pagamento: ${localDate(date)}`].join('\n');if(!writeArrayKey(CASH_LEDGER_KEY,[...oldLedger,mov]))return;
 loan.paidCount=paid+1;loan.payments=Array.isArray(loan.payments)?loan.payments:[];loan.payments.push({number:paid+1,date,amount,ledgerId});loan.status=loan.paidCount>=term?'Quitado':'Ativo';loan.lastPaidAt=new Date().toISOString();if(!writeArrayKey(GC_BANK_LOANS_KEY,rows)){writeArrayKey(CASH_LEDGER_KEY,oldLedger);return;}renderCashDashboard();gcBankRender();gcBankLoanRender();gcBankShowReceipt(mov.receiptText,`parcela-${loan.contractNumber||loan.id}-${paid+1}.txt`);showToast(`Parcela ${paid+1}/${term} paga. Saldo do Caixa atualizado.`);
}

function gcBankOpen(){if(!assertOwner())return;$('#gcAgendaPanel').hidden=true;$('#gcBankPanel').hidden=false;gcBankRender();$('#gcBankPanel').scrollIntoView({behavior:'smooth',block:'start'});}
function gcBankClose(){if(!assertOwner())return;$('#gcBankPanel').hidden=true;$('#gcBankReceiptPanel').hidden=true;}
function gcAgendaOpen(){if(!assertOwner())return;$('#gcBankPanel').hidden=true;$('#gcAgendaPanel').hidden=false;gcAgendaSelectedDate=dateTodayLocal();gcAgendaMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);gcAgendaSyncFleet();gcAgendaRender();$('#gcAgendaPanel').scrollIntoView({behavior:'smooth',block:'start'});}
function gcAgendaClose(){if(!assertOwner())return;$('#gcAgendaPanel').hidden=true;}
function gcBankSetTab(tab){if(!assertOwner())return;const names=['overview','transfer','loans','payroll','financed','ipva','statement'];names.forEach(name=>{const panel=$('#gcBankView'+name[0].toUpperCase()+name.slice(1));if(panel)panel.hidden=name!==tab;});$$('[data-bank-tab]').forEach(b=>b.classList.toggle('active',b.dataset.bankTab===tab));$('#gcBankReceiptPanel').hidden=true;if(tab==='statement')gcBankRenderStatement();if(tab==='loans'){gcBankLoanRenderPreview();gcBankLoanRender();}if(tab==='payroll')gcBankRefreshEmployees();if(tab==='financed')gcBankRenderFinanced();if(tab==='ipva'){gcBankPopulateVehicles();gcBankRenderIpva();}if(tab==='overview')gcBankRenderRecent();}
function gcBankVehicleKey(v){return `${norm(v?.company)}|${norm(v?.prefix)}`;}
function gcBankVehicles(){
  const map=new Map();const companies=new Set([...(GROUP_COMPANIES||[]),...(FLEET||[]).map(x=>x.company),...ownerFleet().map(x=>x.company),...financedBuses().map(x=>x.company),...ownerOperations().map(x=>x.company)]);
  try{const online=gcOnlineLoadState();(online.contracts||[]).forEach(x=>{if(x.company)companies.add(x.company);});}catch(e){}
  companies.forEach(company=>{try{availableBusPool(company).forEach(v=>{if(v.prefix&&v.model)map.set(gcBankVehicleKey({...v,company}),{...v,company,prefix:String(v.prefix),model:v.model});});}catch(e){}});
  ownerFleet().forEach(v=>{if(v.prefix&&v.model)map.set(gcBankVehicleKey(v),{...map.get(gcBankVehicleKey(v)),...v,company:v.company,prefix:String(v.prefix)});});
  financedBuses().forEach(f=>{const k=gcBankVehicleKey(f),old=map.get(k)||{};map.set(k,{...old,...f,company:f.company,prefix:String(f.prefix),model:f.model||old.model,chassis:f.chassis||old.chassis,source:old.source||'financed'});});
  ownerOperations().forEach(op=>{const vehicleCompany=op.vehicleCompany||op.company;if(vehicleCompany&&op.prefix){const k=gcBankVehicleKey({company:vehicleCompany,prefix:op.prefix});if(!map.has(k))map.set(k,{company:vehicleCompany,prefix:String(op.prefix),model:op.busModel||'Modelo não informado',chassis:op.chassis||'',source:'operation'});}});
  loadHistory().forEach(t=>{const company=t.company||'Empresa não informada',prefix=String(t.busPrefix||'');if(prefix){const k=gcBankVehicleKey({company,prefix});if(!map.has(k))map.set(k,{company,prefix,model:t.busModel||'Modelo não informado',chassis:'',source:'history'});}});
  try{const online=gcOnlineLoadState();(online.contracts||[]).forEach(t=>{if(t.company&&t.prefix){const k=gcBankVehicleKey(t);if(!map.has(k))map.set(k,{company:t.company,prefix:String(t.prefix),model:t.model||'Modelo não informado',chassis:'',source:'online'});}});}catch(e){}
  return Array.from(map.values()).sort((a,b)=>String(a.company).localeCompare(String(b.company),'pt-BR')||String(a.prefix).localeCompare(String(b.prefix),'pt-BR',{numeric:true}));
}
function gcBankVehicleValue(v){
  const fin=financedBuses().find(x=>gcBankVehicleKey(x)===gcBankVehicleKey(v));if(fin&&Number(fin.price)>0)return Number(fin.price);
  const quote=readArrayKey(GC_ZERO_KM_QUOTES_KEY).find(q=>(q.prefixes||[]).some(p=>norm(p)===norm(v.prefix))&&norm(q.config?.company)===norm(v.company));if(quote&&Number(quote.unitPrice)>0)return Number(quote.unitPrice);
  const text=norm(`${v.model||''} ${v.chassis||''}`);if(/articulad|biarticulad/.test(text))return 950000;if(/el[eé]tric|electric/.test(text))return 1800000;if(/paradiso|viaggio|rodovi[aá]rio|double.?decker|irizar/.test(text))return 850000;if(/micro|lo-916|lo-915|volare/.test(text))return 280000;if(/midi|midibus/.test(text))return 420000;return 520000;
}
function gcBankPopulateSelect(selectId,includeBlank=true){const el=$('#'+selectId);if(!el)return;const current=el.value,vehicles=gcBankVehicles();el.innerHTML=(includeBlank?`<option value="">${selectId==='gcAgendaEventVehicle'?'Frota geral / sem veículo específico':'Selecione um ônibus...'}</option>`:'')+vehicles.map(v=>`<option value="${escapeHtml(encodeURIComponent(JSON.stringify({company:v.company,prefix:v.prefix})))}">${escapeHtml(v.company)} · ${escapeHtml(v.prefix)} · ${escapeHtml(v.model)}</option>`).join('');if(Array.from(el.options).some(o=>o.value===current))el.value=current;}
function gcBankVehicleFromSelect(id){try{const val=$('#'+id)?.value;if(!val)return null;const parsed=JSON.parse(decodeURIComponent(val));return gcBankVehicles().find(v=>gcBankVehicleKey(v)===gcBankVehicleKey(parsed))||parsed;}catch(e){return null;}}
function gcBankCardIsBlocked(){return localStorage.getItem(GC_BANK_CARD_KEY)==='blocked';}
function gcBankFormatReceipt(row,caption='COMPROVANTE GRUPO CONECT'){return [caption,'GRUPO CONECT · BANCO FICTÍCIO','Documento de simulação — não representa movimentação bancária real.','',`Código: ${row.id||makeId()}`,`Data: ${localDate(String(row.date||dateTodayLocal()).slice(0,10))}`,`Tipo: ${row.direction==='in'?'ENTRADA':'SAÍDA'}`,`Valor: ${money(Number(row.amount)||0)}`,`Categoria: ${row.category||'Movimentação'}`,`Descrição: ${row.description||'Sem descrição'}`,row.payee?`Favorecido/origem: ${row.payee}`:'',row.reference?`Referência: ${row.reference}`:'',row.company?`Empresa: ${row.company}`:'',row.prefix?`Prefixo: ${row.prefix}`:'',row.competence?`Competência: ${row.competence}`:'',`Gerado em: ${new Date().toLocaleString('pt-BR')}`].filter(Boolean).join('\n');}
function gcBankShowReceipt(text,filename='comprovante-grupo-conect.txt'){if(!assertOwner())return;gcBankCurrentReceipt=String(text||'');$('#gcBankReceiptText').textContent=gcBankCurrentReceipt;$('#gcBankReceiptPanel').hidden=false;$('#gcBankReceiptDownload').dataset.filename=filename;$('#gcBankReceiptPanel').scrollIntoView({behavior:'smooth',block:'nearest'});}
function gcBankMovementRow(row){const receipt=row.receiptText||gcBankFormatReceipt(row);return `<article class="gc-bank-movement"><div class="gc-bank-movement-main"><strong>${escapeHtml(row.category||'Movimentação')}</strong><small>${escapeHtml(localDate(String(row.date||'').slice(0,10)))} · ${escapeHtml(row.description||'Sem descrição')}${row.payee?` · Favorecido/origem: ${escapeHtml(row.payee)}`:''}${row.source==='operationSimulation'?' · automático da Operação de Linha':row.source==='onlineFretamento'?' · Atendimento Online':''}</small><div class="gc-bank-movement-actions"><button class="gc-bank-small-button" type="button" data-bank-receipt="${escapeHtml(row.id)}">Ver comprovante</button></div></div><div class="gc-bank-movement-amount ${row.direction==='in'?'in':'out'}">${row.direction==='in'?'+':'−'} ${money(Number(row.amount)||0)}</div></article>`;}
function gcBankRows(){try{return allCashMovements().filter(x=>Number.isFinite(Number(x.amount))&&Number(x.amount)!==0);}catch(e){return cashLedger();}}
function gcBankRenderRecent(){const rows=gcBankRows().slice(0,6);$('#gcBankRecentMovements').innerHTML=rows.length?rows.map(gcBankMovementRow).join(''):recordsEmpty('Nenhum movimento registrado. As viagens, entradas e saídas aparecerão aqui.');}
function gcBankRenderStatement(){const all=gcBankRows();const month=$('#gcBankStatementMonth')?.value||'',search=norm($('#gcBankStatementSearch')?.value||'');const rows=all.filter(x=>(!month||String(x.date||'').slice(0,7)===month)&&(!search||norm(`${x.category} ${x.description} ${x.payee||''} ${x.company||''} ${x.prefix||''}`).includes(search)));const incoming=rows.filter(x=>x.direction==='in').reduce((s,x)=>s+Number(x.amount||0),0),outgoing=rows.filter(x=>x.direction==='out').reduce((s,x)=>s+Number(x.amount||0),0);$('#gcBankStatementSummary').textContent=`${rows.length} movimentação(ões) · Entradas ${money(incoming)} · Saídas ${money(outgoing)} · Saldo atual ${money(cashBreakdown().balance)}. Extrato consolidado com os movimentos dos sistemas existentes.`;$('#gcBankStatementList').innerHTML=rows.length?rows.map(gcBankMovementRow).join(''):recordsEmpty('Nenhuma movimentação corresponde ao filtro.');}
function gcBankRenderOverview(){const c=cashBreakdown(),rows=gcBankRows(),inTotal=rows.filter(x=>x.direction==='in').reduce((s,x)=>s+Number(x.amount||0),0),outTotal=rows.filter(x=>x.direction==='out').reduce((s,x)=>s+Number(x.amount||0),0);$('#gcBankBalance').textContent=money(c.balance);$('#gcBankOverviewStats').innerHTML=[moneyStat('Saldo atual do Caixa espelhado',money(c.balance),c.balance>=0?'positive':'negative'),moneyStat('Total de entradas registradas',money(inTotal),'positive'),moneyStat('Total de saídas registradas',money(outTotal),'negative'),moneyStat('Ônibus financiados',String(financedBuses().length))].join('');const blocked=gcBankCardIsBlocked();$('#gcBankCardStatus').textContent=blocked?'Cartão virtual BLOQUEADO para operações simuladas.':'Cartão virtual desbloqueado para pagamentos fictícios.';$('#gcBankCardToggle').textContent=blocked?'Desbloquear cartão':'Bloquear cartão';gcBankRenderRecent();}
function gcBankRenderFinanced(){const financed=financedBuses().slice().reverse();$('#gcBankFinancedList').innerHTML=financed.length?financed.map(f=>{const rem=Math.max(0,Number(f.installmentCount||0)-Number(f.paidCount||0));return `<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(f.company)} · ${escapeHtml(f.prefix)} · ${escapeHtml(f.model)}</strong><small>${escapeHtml(f.chassis||'Chassi não informado')} · ano ${escapeHtml(f.year||'—')} · preço ${money(Number(f.price)||0)} · parcelas ${Number(f.paidCount)||0}/${Number(f.installmentCount)||0} · ${rem} restantes · próxima ${rem?localDate(addMonthsToISO(f.firstDueDate,Number(f.paidCount)||0)):'quitado'}</small></div><button class="secondary-action-button" type="button" data-bank-view-finance="${escapeHtml(f.id)}">Abrir contrato</button></div></article>`;}).join(''):recordsEmpty('Nenhum ônibus financiado cadastrado no sistema original.');const vehicles=gcBankVehicles();$('#gcBankFleetCopy').innerHTML=vehicles.length?vehicles.map(v=>`<article class="record-item"><div><strong>${escapeHtml(v.company)} · ${escapeHtml(v.prefix)} · ${escapeHtml(v.model)}</strong><small>Chassi: ${escapeHtml(v.chassis||'não informado')} · valor de referência ${money(gcBankVehicleValue(v))} · cópia de consulta, cadastro original preservado.</small></div></article>`).join(''):recordsEmpty('Nenhum veículo foi encontrado na frota.');}
function gcBankRender(){if(!$('#gcBankPanel'))return;gcBankPopulateSelect('gcBankTaxVehicle');gcBankRenderOverview();gcBankRenderStatement();gcBankRenderPayrollHistory();gcBankRenderIpva();gcBankLoanRenderPreview();gcBankLoanRender();}
function gcBankRefreshEmployees(){const el=$('#gcPayrollEmployee');if(!el)return;const current=el.value;const roster=new Map();ownerOperations().forEach(op=>{Object.values(op.drivers||{}).forEach(name=>{const n=String(name||'').trim();if(n&&norm(n)!==norm('—')&&norm(n)!==norm('Não escalado'))roster.set(`${norm(op.company)}|${norm(n)}`,{company:op.company||'Grupo Conect',name:n});});});const ordered=Array.from(roster.values()).sort((a,b)=>a.company.localeCompare(b.company,'pt-BR')||a.name.localeCompare(b.name,'pt-BR'));el.innerHTML='<option value="">Selecione um motorista escalado...</option>'+ordered.map(x=>`<option value="${escapeHtml(encodeURIComponent(JSON.stringify(x)))}">${escapeHtml(x.name)} · ${escapeHtml(x.company)}</option>`).join('');if(Array.from(el.options).some(o=>o.value===current))el.value=current;else if(ordered.length===1)el.value=el.options[1].value;gcBankLoadStaffSettings();}
function gcBankSelectedEmployee(){try{return JSON.parse(decodeURIComponent($('#gcPayrollEmployee').value||''));}catch(e){return null;}}
function gcBankSalaryDefaults(employee){const op=ownerOperations().find(x=>norm(x.company)===norm(employee?.company)&&Object.values(x.drivers||{}).some(d=>norm(d)===norm(employee?.name)));const text=norm(op?.busModel||'');return {base:/articulad/.test(text)?4104.18:/micro|midi|lo-91/.test(text)?2907.15:3420.16,meal:660,mealCopay:20,dental:27.5,includeMeal:true,includeDental:true,includeCharges:true};}
function gcBankStaffKey(employee){return `${norm(employee?.company)}|${norm(employee?.name)}`;}
function gcBankLoadStaffSettings(){const e=gcBankSelectedEmployee();if(!e)return;const prefs=gcReadObject(GC_BANK_STAFF_KEY),v=prefs[gcBankStaffKey(e)]||gcBankSalaryDefaults(e);$('#gcPayrollBase').value=Number(v.base??3420.16).toFixed(2);$('#gcPayrollMeal').value=Number(v.meal??660).toFixed(2);$('#gcPayrollMealCopay').value=Number(v.mealCopay??20).toFixed(2);$('#gcPayrollDental').value=Number(v.dental??27.5).toFixed(2);$('#gcPayrollIncludeMeal').checked=v.includeMeal!==false;$('#gcPayrollIncludeDental').checked=v.includeDental!==false;$('#gcPayrollIncludeEmployerCharges').checked=v.includeCharges!==false;if(!$('#gcPayrollCompetence').value)$('#gcPayrollCompetence').value=dateTodayLocal().slice(0,7);gcBankUpdatePayrollPreview();}
function gcBankGetPayrollInput(){const employee=gcBankSelectedEmployee(),base=Number($('#gcPayrollBase').value),meal=Number($('#gcPayrollMeal').value),copay=Math.min(meal,Number($('#gcPayrollMealCopay').value)),dental=Number($('#gcPayrollDental').value),includeMeal=$('#gcPayrollIncludeMeal').checked,includeDental=$('#gcPayrollIncludeDental').checked,includeCharges=$('#gcPayrollIncludeEmployerCharges').checked;const gross=Number.isFinite(base)&&base>=0?base:0;const inss=gcBankInss2026(gross);const mealCost=includeMeal?meal:0,actualCopay=includeMeal?copay:0,dentalCost=includeDental?dental:0,fgts=includeCharges?gross*.08:0,employerInss=includeCharges?gross*.20:0,net=Math.max(0,gross-inss-actualCopay),total=net+inss+mealCost+dentalCost+fgts+employerInss;return {employee,gross,inss,meal:mealCost,mealCopay:actualCopay,dental:dentalCost,fgts,employerInss,net,total,competence:$('#gcPayrollCompetence').value,includeMeal,includeDental,includeCharges};}
function gcBankInss2026(gross){let remain=Math.max(0,gross),last=0,total=0;const bands=[{limit:1621,rate:.075},{limit:2902.84,rate:.09},{limit:4354.27,rate:.12},{limit:8475.55,rate:.14}];for(const b of bands){const portion=Math.max(0,Math.min(remain,b.limit-last));total+=portion*b.rate;remain-=portion;last=b.limit;if(remain<=0)break;}return Math.round(total*100)/100;}
function gcBankUpdatePayrollPreview(){if(!$('#gcPayrollPreview'))return;const p=gcBankGetPayrollInput();if(!p.employee){$('#gcPayrollPreview').textContent='Cadastre e escale um motorista no Visualizador de Operação para montar a folha.';return;}const payRows=readArrayKey(GC_BANK_PAYROLL_KEY),duplicate=payRows.some(x=>gcBankStaffKey(x)===gcBankStaffKey(p.employee)&&x.competence===p.competence);$('#gcPayrollPreview').innerHTML=`<div class="finance-preview-grid"><div><span>Salário bruto</span><strong>${money(p.gross)}</strong></div><div><span>INSS estimado do empregado</span><strong>− ${money(p.inss)}</strong></div><div><span>Salário líquido a transferir</span><strong>${money(p.net)}</strong></div><div><span>Vale-alimentação</span><strong>${money(p.meal)}</strong></div><div><span>Plano odontológico</span><strong>${money(p.dental)}</strong></div><div><span>Encargos estimados (FGTS + patronal)</span><strong>${money(p.fgts+p.employerInss)}</strong></div><div><span>Custo total simulado</span><strong>${money(p.total)}</strong></div></div><p class="tool-result-note">${duplicate?'⚠ Esta competência já foi paga para este motorista.':'O INSS segue as faixas progressivas de 2026; os demais encargos são aproximações e a folha não inclui horas extras.'} Saldo disponível: ${money(cashBreakdown().balance)}.</p>`;const submit=$('#gcBankPayrollForm button[type="submit"]');if(submit)submit.disabled=duplicate||!p.employee||p.total<=0;}
function gcBankSavePayrollSettings(){if(!assertOwner())return;const p=gcBankGetPayrollInput();if(!p.employee){showToast('Selecione um motorista escalado.');return;}const values={base:p.gross,meal:Number($('#gcPayrollMeal').value)||0,mealCopay:Number($('#gcPayrollMealCopay').value)||0,dental:Number($('#gcPayrollDental').value)||0,includeMeal:p.includeMeal,includeDental:p.includeDental,includeCharges:p.includeCharges};const settings=gcReadObject(GC_BANK_STAFF_KEY);settings[gcBankStaffKey(p.employee)]=values;if(gcWriteObject(GC_BANK_STAFF_KEY,settings))showToast('Valores salvos para este motorista.');}
function gcBankRenderPayrollHistory(){const rows=readArrayKey(GC_BANK_PAYROLL_KEY).slice().reverse();$('#gcBankPayrollHistory').innerHTML=rows.length?rows.map(p=>`<article class="record-item"><div class="record-item-top"><div><strong>${escapeHtml(p.name)} · ${escapeHtml(p.company)}</strong><small>Competência ${escapeHtml(p.competence)} · líquido ${money(p.net)} · custo total ${money(p.total)} · pago em ${escapeHtml(new Date(p.paidAt).toLocaleDateString('pt-BR'))}</small></div><button class="secondary-action-button" type="button" data-bank-payroll-receipt="${escapeHtml(p.id)}">Comprovante de folha</button></div></article>`).join(''):recordsEmpty('Nenhuma folha foi paga pelo banco ainda.');}
function gcBankPayPayroll(event){event.preventDefault();if(!assertOwner()||gcBankCardIsBlocked()){showToast('Desbloqueie o cartão empresarial para realizar pagamentos simulados.');return;}const p=gcBankGetPayrollInput();if(!p.employee||!p.competence||p.gross<=0){showToast('Selecione um motorista, competência e salário válido.');return;}const existing=readArrayKey(GC_BANK_PAYROLL_KEY);if(existing.some(x=>gcBankStaffKey(x)===gcBankStaffKey(p.employee)&&x.competence===p.competence)){showToast('Esta folha já foi paga para esse motorista nesta competência.');return;}if(p.total>cashBreakdown().balance+0.005){showToast(`Saldo insuficiente. Custo da folha ${money(p.total)}; saldo ${money(cashBreakdown().balance)}.`);return;}const record={id:makeId(),company:p.employee.company,name:p.employee.name,competence:p.competence,gross:p.gross,inss:p.inss,net:p.net,meal:p.meal,mealCopay:p.mealCopay,dental:p.dental,fgts:p.fgts,employerInss:p.employerInss,total:p.total,paidAt:new Date().toISOString()};record.receiptText=['RECIBO SIMULADO DE FOLHA — GRUPO CONECT','Não é holerite legal nem documento de pagamento real.','',`Motorista: ${record.name}`,`Empresa: ${record.company}`,`Competência: ${record.competence}`,`Salário bruto: ${money(record.gross)}`,`INSS empregado (estimado): ${money(record.inss)}`,`Desconto participação VA: ${money(record.mealCopay)}`,`Líquido do salário: ${money(record.net)}`,`Vale-alimentação custeado: ${money(record.meal)}`,`Plano odontológico: ${money(record.dental)}`,`FGTS estimado: ${money(record.fgts)}`,`Contribuição patronal estimada: ${money(record.employerInss)}`,`Custo total registrado: ${money(record.total)}`,`Data do processamento: ${new Date(record.paidAt).toLocaleString('pt-BR')}`].join('\n');const rows=cashLedger(),date=dateTodayLocal(),baseId=`payroll-${record.id}`;const additions=[{id:`${baseId}-net`,date,direction:'out',amount:record.net,category:'Salário líquido · folha simulada',description:`${record.name} · ${record.company} · competência ${record.competence}`,payee:record.name,company:record.company,competence:record.competence,source:'gcBankPayroll',payrollId:record.id,receiptText:record.receiptText,auto:true},{id:`${baseId}-inss`,date,direction:'out',amount:record.inss,category:'Recolhimento INSS · folha simulada',description:`INSS retido de ${record.name} · ${record.competence}`,payee:'Recolhimento simulado',company:record.company,competence:record.competence,source:'gcBankPayroll',payrollId:record.id,receiptText:record.receiptText,auto:true}];if(record.meal>0)additions.push({id:`${baseId}-meal`,date,direction:'out',amount:record.meal,category:'Vale-alimentação · folha simulada',description:`Benefício de ${record.name} · ${record.competence}`,payee:'Benefício alimentação',company:record.company,competence:record.competence,source:'gcBankPayroll',payrollId:record.id,receiptText:record.receiptText,auto:true});if(record.dental>0)additions.push({id:`${baseId}-dental`,date,direction:'out',amount:record.dental,category:'Plano odontológico · folha simulada',description:`Benefício de ${record.name} · ${record.competence}`,payee:'Plano odontológico',company:record.company,competence:record.competence,source:'gcBankPayroll',payrollId:record.id,receiptText:record.receiptText,auto:true});if(record.fgts>0)additions.push({id:`${baseId}-fgts`,date,direction:'out',amount:record.fgts,category:'FGTS estimado · folha simulada',description:`Reserva de FGTS de ${record.name} · ${record.competence}`,payee:'FGTS simulado',company:record.company,competence:record.competence,source:'gcBankPayroll',payrollId:record.id,receiptText:record.receiptText,auto:true});if(record.employerInss>0)additions.push({id:`${baseId}-patronal`,date,direction:'out',amount:record.employerInss,category:'INSS patronal estimado · folha simulada',description:`Encargo de ${record.name} · ${record.competence}`,payee:'INSS patronal simulado',company:record.company,competence:record.competence,source:'gcBankPayroll',payrollId:record.id,receiptText:record.receiptText,auto:true});if(!writeArrayKey(CASH_LEDGER_KEY,[...rows,...additions]))return;if(!writeArrayKey(GC_BANK_PAYROLL_KEY,[...existing,record]))return;gcBankRender();renderCashDashboard();renderFinanceList();gcBankShowReceipt(record.receiptText,`folha-${record.competence}-${record.name.replace(/[^a-z0-9]+/gi,'-')}.txt`);showToast(`Folha simulada de ${record.name} paga e lançada no Caixa.`);}
function gcBankTaxHistory(){return readArrayKey(GC_BANK_IPVA_KEY);}
function gcBankTaxEstimate(v){return gcBankVehicleValue(v);}
function gcBankUpdateTaxPreview(){const v=gcBankVehicleFromSelect('gcBankTaxVehicle'),year=Number($('#gcBankTaxYear').value)||new Date().getFullYear(),value=Number($('#gcBankTaxValue').value)||0,rate=Number($('#gcBankTaxRate').value)||2,count=Number($('#gcBankTaxInstallments').value)||1,total=value*rate/100,rows=gcBankTaxHistory(),rec=v&&rows.find(x=>gcBankVehicleKey(x)===gcBankVehicleKey(v)&&Number(x.year)===year);if(!v){$('#gcBankTaxPreview').textContent='Selecione um ônibus para calcular o IPVA estimado.';return;}const amount=rec?Number(rec.total):total,inst=rec?Number(rec.installments):count,paid=rec?Number(rec.paidCount||0):0;$('#gcBankTaxPreview').innerHTML=`<strong>${escapeHtml(v.company)} · ${escapeHtml(v.prefix)} · ${escapeHtml(v.model)}</strong><p>Valor venal: ${money(rec?.baseValue??value)} · alíquota: ${numberPt(rec?.rate??rate,2)}% · IPVA estimado: ${money(amount)}.</p><p>Forma: ${inst===1?'cota única':`${inst} cotas de ${money(amount/inst)}`} · cotas pagas ${paid}/${inst}.</p><p class="tool-result-note">Estimativa para a simulação. No RJ, a referência legal para ônibus/micro-ônibus é 2%; elétricos puros podem ter alíquota de 0,5%. Confira o enquadramento e valor venal real.</p>`;const submit=$('#gcBankTaxForm button[type="submit"]');if(submit)submit.disabled=Boolean(rec&&Number(rec.paidCount)>=Number(rec.installments));}
function gcBankRenderIpva(){if(!$('#gcBankTaxHistory'))return;const rows=gcBankTaxHistory().slice().reverse();$('#gcBankTaxHistory').innerHTML=rows.length?rows.map(r=>`<article class="gc-bank-tax-record"><strong>${escapeHtml(r.company)} · ${escapeHtml(r.prefix)} · ${escapeHtml(r.model)} · IPVA ${escapeHtml(r.year)}</strong><small>Valor venal ${money(r.baseValue)} · total ${money(r.total)} · ${Number(r.paidCount)||0}/${Number(r.installments)||1} cotas pagas.</small>${(r.payments||[]).slice().reverse().map(p=>`<div class="gc-bank-movement-actions"><span>${escapeHtml(localDate(p.date))} · ${money(p.amount)} · ${escapeHtml(p.label)}</span><button class="gc-bank-small-button" type="button" data-bank-receipt="${escapeHtml(p.ledgerId)}">Comprovante</button></div>`).join('')}</article>`).join(''):recordsEmpty('Nenhum IPVA foi pago pelo banco ainda.');gcBankUpdateTaxPreview();}
function gcBankPayIpva(event){event.preventDefault();if(!assertOwner()||gcBankCardIsBlocked()){showToast('Desbloqueie o cartão empresarial para pagar o IPVA simulado.');return;}const vehicle=gcBankVehicleFromSelect('gcBankTaxVehicle');if(!vehicle){showToast('Selecione um ônibus.');return;}const year=Number($('#gcBankTaxYear').value),value=Number($('#gcBankTaxValue').value),rate=Number($('#gcBankTaxRate').value),installments=Number($('#gcBankTaxInstallments').value);if(!Number.isInteger(year)||year<2020||!Number.isFinite(value)||value<=0||![2,.5].includes(rate)||![1,3].includes(installments)){showToast('Confira o exercício, o valor venal, a alíquota e as cotas.');return;}const rows=gcBankTaxHistory();let rec=rows.find(x=>gcBankVehicleKey(x)===gcBankVehicleKey(vehicle)&&Number(x.year)===year);if(!rec){rec={id:makeId(),company:vehicle.company,prefix:vehicle.prefix,model:vehicle.model,year,baseValue:value,rate,total:Number((value*rate/100).toFixed(2)),installments,paidCount:0,payments:[],createdAt:new Date().toISOString()};}else if(rec.paidCount>=rec.installments){showToast('Todas as cotas deste IPVA já foram pagas.');return;}const index=Number(rec.paidCount)||0;if(index===0){rec.installments=installments;rec.rate=rate;rec.baseValue=value;rec.total=Number((value*rate/100).toFixed(2));}const due=Number(rec.paidCount)>=Number(rec.installments);if(due){showToast('IPVA já quitado.');return;}const dueIndex=Number(rec.paidCount)||0,paymentAmount=dueIndex===Number(rec.installments)-1?Number((Number(rec.total)-Number((Number(rec.total)/Number(rec.installments))*(Number(rec.installments)-1))).toFixed(2)):Number((Number(rec.total)/Number(rec.installments)).toFixed(2));if(paymentAmount>cashBreakdown().balance+0.005){showToast(`Saldo insuficiente para pagar ${money(paymentAmount)}. Saldo atual ${money(cashBreakdown().balance)}.`);return;}const ledgerId=`ipva-${rec.id}-cota-${dueIndex+1}`;if(cashLedger().some(x=>x.id===ledgerId)){showToast('Esta cota já aparece no livro-caixa. Reabra o extrato para consultar o comprovante.');rec.paidCount=Math.max(Number(rec.paidCount)||0,dueIndex+1);if(!rows.some(x=>x.id===rec.id))rows.push(rec);else rows[rows.findIndex(x=>x.id===rec.id)]=rec;writeArrayKey(GC_BANK_IPVA_KEY,rows);gcBankRenderIpva();return;}const mov={id:ledgerId,date:dateTodayLocal(),direction:'out',amount:paymentAmount,category:'IPVA · DETRAN fictício',description:`Ônibus ${rec.company} · prefixo ${rec.prefix} · ${rec.model} · exercício ${rec.year} · cota ${dueIndex+1}/${rec.installments}`,payee:'DETRAN fictício do RJ',company:rec.company,prefix:rec.prefix,source:'gcBankIpva',auto:true,receiptText:''};mov.receiptText=gcBankFormatReceipt(mov,'COMPROVANTE SIMULADO · IPVA');if(!writeArrayKey(CASH_LEDGER_KEY,[...cashLedger(),mov]))return;rec.paidCount=dueIndex+1;rec.payments=Array.isArray(rec.payments)?rec.payments:[];rec.payments.push({ledgerId,date:mov.date,amount:paymentAmount,label:`Cota ${rec.paidCount}/${rec.installments}`});if(!rows.some(x=>x.id===rec.id))rows.push(rec);else rows[rows.findIndex(x=>x.id===rec.id)]=rec;if(!writeArrayKey(GC_BANK_IPVA_KEY,rows))return;gcBankRender();renderCashDashboard();gcBankShowReceipt(mov.receiptText,`ipva-${rec.prefix}-${rec.year}-cota-${rec.paidCount}.txt`);showToast('Cota do IPVA fictício paga. O Caixa foi atualizado.');}
function gcBankExport(){if(!assertOwner())return;const rows=gcBankRows(),content=[['Data','Tipo','Categoria','Valor','Descrição','Origem'],...rows.map(x=>[x.date,x.direction==='in'?'Entrada':'Saída',x.category,x.amount,x.description||'',x.source||'Caixa existente'])].map(r=>r.map(csvCell).join(';')).join('\n');downloadTextFile('grupo-conect-extrato-banco.csv',content,'text/csv;charset=utf-8');showToast('Extrato consolidado exportado.');}

function gcAgendaDateAdd(iso,days){const d=dateFromISO(iso)||new Date();d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function gcAgendaVehicleLabel(v){return `${v.company} · ${v.prefix} · ${v.model}`;}
function gcAgendaVehicleKey(v){return gcBankVehicleKey(v);}
function gcAgendaVehicleList(){return gcBankVehicles();}
function gcAgendaReadProfiles(){return gcReadObject(GC_AGENDA_PROFILES_KEY);}
function gcAgendaSyncFleet(){const profiles=gcAgendaReadProfiles(),vehicles=gcAgendaVehicleList(),odo=readArrayKey(ODOMETER_KEY);let changed=false;vehicles.forEach(v=>{const k=gcAgendaVehicleKey(v);let p=profiles[k];if(!p){p={key:k,company:v.company,prefix:String(v.prefix),model:v.model,currentKm:null,odoDate:'',lastOilAtKm:null,lastPreventiveAtKm:null,lastTireAtKm:null,updatedAt:''};changed=true;}else{if(p.model!==v.model||p.company!==v.company){p.model=v.model;p.company=v.company;changed=true;}}if(p.currentKm===null||p.currentKm===undefined){const candidate=odo.filter(r=>{const label=norm(r.vehicle||'');const parts=label.split(/[·|]/).map(z=>z.trim());const prefixToken=parts.includes(norm(v.prefix))||label.includes(norm(`${v.company} · ${v.prefix} ·`));return prefixToken&&Number.isFinite(Number(r.end));}).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];if(candidate){p.currentKm=Number(candidate.end);p.odoDate=candidate.date||dateTodayLocal();p.lastOilAtKm=Number(candidate.end);p.lastPreventiveAtKm=Number(candidate.end);p.lastTireAtKm=Number(candidate.end);changed=true;}}profiles[k]=p;});if(changed)gcWriteObject(GC_AGENDA_PROFILES_KEY,profiles);return profiles;}
function gcAgendaSelectedVehicle(id){return gcBankVehicleFromSelect(id);}
function gcAgendaPopulateVehicles(){['gcAgendaOdometerVehicle','gcAgendaEventVehicle'].forEach(id=>gcBankPopulateSelect(id));const first=$('#gcAgendaEventVehicle');if(first&&first.options.length&&first.options[0].value!=='')first.insertAdjacentHTML('afterbegin','<option value="">Sem veículo específico</option>');}
function gcAgendaHash(text){let h=0;for(let i=0;i<String(text).length;i++)h=(h*31+String(text).charCodeAt(i))|0;return Math.abs(h);}
function gcAgendaDoneMap(){return gcReadObject(GC_AGENDA_DONE_KEY);}
function gcAgendaHasKm(p){return Boolean(p&&p.currentKm!==null&&p.currentKm!==undefined&&p.currentKm!==''&&Number.isFinite(Number(p.currentKm)));}
function gcAgendaIsDone(id){return Boolean(gcAgendaDoneMap()[id]);}
function gcAgendaMarkDone(id){if(!assertOwner())return;const all=gcAgendaEventsForDate(gcAgendaSelectedDate),ev=all.find(x=>x.id===id)||gcAgendaFindEvent(id);if(!ev)return;const done=gcAgendaDoneMap();done[id]=new Date().toISOString();if(!gcWriteObject(GC_AGENDA_DONE_KEY,done))return;if(ev.vehicleKey){const profiles=gcAgendaReadProfiles(),p=profiles[ev.vehicleKey];if(p){const km=Number(p.currentKm);if(ev.type==='oil'&&gcAgendaHasKm(p))p.lastOilAtKm=km;if(ev.type==='tires'&&gcAgendaHasKm(p))p.lastTireAtKm=km;if(ev.type==='maintenance'&&gcAgendaHasKm(p))p.lastPreventiveAtKm=km;profiles[ev.vehicleKey]=p;gcWriteObject(GC_AGENDA_PROFILES_KEY,profiles);}if(ev.type==='clean'||ev.type==='wash'){const vehicle=gcAgendaVehicleList().find(v=>gcAgendaVehicleKey(v)===ev.vehicleKey);const row={id:makeId(),date:gcAgendaSelectedDate,vehicle:vehicle?gcAgendaVehicleLabel(vehicle):ev.vehicleLabel||ev.vehicle||'Veículo',interior:ev.type==='clean',exterior:ev.type==='wash',windows:ev.type==='clean',waste:ev.type==='clean',doneCount:ev.type==='clean'?4:1,source:'agenda-frota',notes:ev.title};writeArrayKey(CLEAN_KEY,[...readArrayKey(CLEAN_KEY),row]);}}gcAgendaRender();gcAgendaRenderHomeAlert();showToast('Tarefa marcada como concluída.');}
function gcAgendaFindEvent(id){const today=dateTodayLocal(),events=gcAgendaEventsForDate(today);return events.find(x=>x.id===id)||gcAgendaBuildAllEventForSingleId(id);}
function gcAgendaBuildAllEventForSingleId(id){const manual=readArrayKey(GC_AGENDA_EVENTS_KEY).find(x=>x.id===id);if(manual)return {...manual,vehicleKey:manual.vehicleKey||''};const legacy=loadMaintenance().find(x=>x.id===id);if(legacy)return {id:legacy.id,date:legacy.date||dateTodayLocal(),type:'maintenance',title:legacy.task,vehicle:legacy.vehicle,priority:legacy.priority||'Normal',source:'legacy'};return null;}
function gcAgendaIcon(type,urgent=false){if(urgent)return '⚠️';return ({turismo:'🧳',escolar:'🎒',fretamento:'🚌',operation:'🚌',clean:'🧽',wash:'🚿',oil:'🛢️',maintenance:'🔧',tires:'🛞',document:'📄',other:'📌',ipva:'💳'})[type]||'•';}
function gcAgendaDateForProfile(p,threshold,currentIso){const current=Number(p.currentKm),base=Number(threshold);if(!Number.isFinite(current)||!Number.isFinite(base))return null;if(current>=base)return currentIso;const daily=/paradiso|viaggio|rodovi[aá]rio|coach|irizar/.test(norm(p.model))?260:155;const kmLeft=base-current;const predicted=gcAgendaDateAdd(p.odoDate||currentIso,Math.max(1,Math.ceil(kmLeft/daily)));return predicted<currentIso?currentIso:predicted;}
function gcAgendaCreateEvent(events,obj,date){const ev={...obj,date:date||obj.date||dateTodayLocal()};if(gcAgendaIsDone(ev.id))ev.completed=true;if(!events.some(x=>x.id===ev.id))events.push(ev);}
function gcAgendaEventsForDate(targetDate){
  const target=String(targetDate||dateTodayLocal()).slice(0,10),today=dateTodayLocal(),events=[],profiles=gcAgendaSyncFleet(),vehicles=gcAgendaVehicleList(),vehicleMap=new Map(vehicles.map(v=>[gcAgendaVehicleKey(v),v])),done=gcAgendaDoneMap();
  const add=(obj,date)=>{const ev={priority:'Normal',...obj,date:date||obj.date||target};if(ev.date!==target)return;if(done[ev.id])ev.completed=true;if(!events.some(x=>x.id===ev.id))events.push(ev);};
  readArrayKey(GC_AGENDA_EVENTS_KEY).forEach(e=>{let date=e.date;if(date<today&&['maintenance','oil','tires','document'].includes(e.type))date=today;if(date===target)add({...e,vehicleKey:e.vehicleKey||'',source:'manual'},date);});
  loadMaintenance().forEach(m=>{if(!m.date)return;let date=m.date,overdue=false;const profile=vehicles.find(v=>norm(gcAgendaVehicleLabel(v))===norm(m.vehicle)||norm(`${v.company} ${v.prefix} ${v.model}`)===norm(m.vehicle)||norm(m.vehicle).includes(norm(v.prefix)));if(date<today){date=today;overdue=true;}if(m.km!==null&&m.km!==undefined&&m.km!==''&&profile){const p=profiles[gcAgendaVehicleKey(profile)];if(p&&Number(p.currentKm)>=Number(m.km)){date=today;overdue=true;}}if(date===target)add({id:m.id||`legacy-maint-${gcAgendaHash(m.task+m.vehicle+m.date)}`,type:'maintenance',title:m.task||'Manutenção cadastrada',vehicle:m.vehicle||'Veículo não especificado',company:profile?.company||'',prefix:profile?.prefix||'',vehicleKey:profile?gcAgendaVehicleKey(profile):'',priority:overdue?'Urgente':m.priority||'Normal',description:`Lembrete do sistema de manutenção${overdue?' · ATRASADO':''}${m.km?` · previsto em ${numberPt(Number(m.km),0)} km`:''}`,source:'legacy',overdue,alertImportant:overdue||['alta','urgente'].includes(norm(m.priority))||/freio|oleo|óleo|pneu|motor|dire[cç][aã]o|temperatura|superaquec|arrefecimento/.test(norm(m.task))},date);});
  ownerOperations().forEach(op=>{if(!op.id||op.status==='pausada'||gcOnlineWeekdayKey(op.weekday)!==gcOnlineWeekdayForDate(target))return;const v={company:opVehicleCompany(op),prefix:String(op.prefix),model:op.busModel||''},key=gcAgendaVehicleKey(v);add({id:`agenda-op-${op.id}-${target}`,type:'operation',title:`Linha ${op.line||'sem nome'} · ${op.city||'cidade não informada'}`,vehicleKey:key,vehicle:gcAgendaVehicleLabel(v),company:opVehicleCompany(op),prefix:op.prefix,description:`Operação de Linha · ${Object.values(op.drivers||{}).filter(Boolean).join(', ')||'motorista não informado'} · início ${op.startTime||'05:00'}`,priority:'Normal',source:'operation'},target);});
  try{const online=gcOnlineLoadState();(online.contracts||[]).filter(c=>c.status==='accepted'&&gcOnlineContractCoversDate(c,target)).forEach(c=>{const type=norm(c.serviceType).includes('escolar')?'escolar':norm(c.serviceType).includes('turismo')?'turismo':'fretamento';const v={company:c.company,prefix:String(c.prefix),model:c.model||''};add({id:`agenda-online-${c.id}-${target}`,type,title:`${c.clientName||'Cliente'} · ${c.origin||'origem'} → ${c.destination||'destino'}`,vehicleKey:gcAgendaVehicleKey(v),vehicle:gcAgendaVehicleLabel(v),company:c.company,prefix:c.prefix,description:`Atendimento Online · ${c.requestedDeparture||c.departureAt||'horário a confirmar'} · ${c.driver||'motorista não informado'}`,priority:'Normal',source:'online'},target);});}catch(e){}
  const serviceVehicles=events.filter(e=>['operation','tourismo','turismo','escolar','fretamento'].includes(e.type)&&e.vehicleKey);serviceVehicles.forEach(ev=>{const vehicle=vehicleMap.get(ev.vehicleKey);if(!vehicle)return;const alreadyClean=readArrayKey(CLEAN_KEY).some(r=>String(r.date||'').slice(0,10)===target&&norm(r.vehicle||'').includes(norm(vehicle.prefix))&&((r.doneCount||0)>=3||r.interior&&r.exterior));if(!alreadyClean)add({id:`agenda-after-clean-${ev.vehicleKey}-${target}`,type:'clean',title:'Limpeza interna após serviço',vehicleKey:ev.vehicleKey,vehicle:gcAgendaVehicleLabel(vehicle),company:vehicle.company,prefix:vehicle.prefix,description:'Rotina sugerida após operação, turismo ou fretamento.',priority:'Normal',source:'auto-clean'},target);});
  vehicles.forEach(v=>{const key=gcAgendaVehicleKey(v),p=profiles[key],current=Number(p?.currentKm);if(gcAgendaHasKm(p)){[['oil','lastOilAtKm',10000,'Troca de óleo e filtros'],['tires','lastTireAtKm',5000,'Inspeção de pneus'],['maintenance','lastPreventiveAtKm',20000,'Revisão preventiva por hodômetro']].forEach(([type,field,interval,title])=>{if(p[field]===null||p[field]===undefined)return;const threshold=Number(p[field])+interval,date=gcAgendaDateForProfile(p,threshold,today);if(date===target){const overdue=current>=threshold;add({id:`agenda-mileage-${key}-${type}-${threshold}`,type,title,vehicleKey:key,vehicle:gcAgendaVehicleLabel(v),company:v.company,prefix:v.prefix,priority:overdue?'Urgente':'Alta',description:overdue?`Hodômetro ${numberPt(current,0)} km · ultrapassou o marco de ${numberPt(threshold,0)} km.`:`Previsão por uso médio · próximo marco ${numberPt(threshold,0)} km.`,source:'odometer',dueKm:threshold,alertImportant:overdue},target);}});}
    // Rotina visual mensal: cada prefixo recebe um dia previsível, sem criar tarefas diárias excessivas.
    const d=1+(gcAgendaHash(key)%27),monthly=`${target.slice(0,7)}-${String(d).padStart(2,'0')}`;if(monthly===target)add({id:`agenda-monthly-check-${key}-${monthly}`,type:'maintenance',title:'Inspeção preventiva mensal',vehicleKey:key,vehicle:gcAgendaVehicleLabel(v),company:v.company,prefix:v.prefix,priority:'Normal',description:'Conferir freios, luzes, vazamentos, extintor e itens de segurança.',source:'monthly'},target);
    const washDay=gcAgendaHash(key+'wash')%7;const dayObj=dateFromISO(target);if(dayObj&&dayObj.getDay()===washDay&&!readArrayKey(CLEAN_KEY).some(r=>String(r.date||'').slice(0,10)===target&&norm(r.vehicle||'').includes(norm(v.prefix))&&r.exterior))add({id:`agenda-wash-${key}-${target}`,type:'wash',title:'Banho / lavagem externa semanal',vehicleKey:key,vehicle:gcAgendaVehicleLabel(v),company:v.company,prefix:v.prefix,priority:'Normal',description:'Rotina semanal de conservação e apresentação da frota.',source:'weekly-wash'},target);
  });
  gcBankTaxHistory().forEach(t=>{if(Number(t.paidCount)>=Number(t.installments))return;const due=gcAgendaDateAdd(`${t.year}-02-01`,Number(t.paidCount||0)*30);if(due===target)add({id:`agenda-ipva-${t.id}-${t.paidCount||0}`,type:'document',title:`IPVA pendente · exercício ${t.year}`,vehicleKey:gcAgendaVehicleKey(t),vehicle:`${t.company} · ${t.prefix} · ${t.model}`,company:t.company,prefix:t.prefix,priority:'Alta',description:`Revisar a próxima cota do DETRAN fictício: ${money(Number(t.total)/Math.max(1,Number(t.installments)))}`,source:'ipva'},target);});
  return events.sort((a,b)=>({Urgente:0,Alta:1,Normal:2,Baixa:3}[a.priority]??2)-({Urgente:0,Alta:1,Normal:2,Baixa:3}[b.priority]??2)||String(a.time||'').localeCompare(String(b.time||''))||String(a.title).localeCompare(String(b.title),'pt-BR'));
}
function gcAgendaEventsForMonth(iso){const d=dateFromISO(iso)||new Date();const year=d.getFullYear(),month=d.getMonth();const days=new Date(year,month+1,0).getDate(),map={};for(let day=1;day<=days;day++){const date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;map[date]=gcAgendaEventsForDate(date);}return map;}
function gcAgendaRenderSummary(){const today=gcAgendaEventsForDate(dateTodayLocal()),fleet=gcAgendaVehicleList(),profiles=gcAgendaSyncFleet(),missing=fleet.filter(v=>!gcAgendaHasKm(profiles[gcAgendaVehicleKey(v)])).length,maint=today.filter(e=>['maintenance','oil','tires'].includes(e.type)&&!e.completed).length,service=today.filter(e=>['operation','turismo','fretamento','escolar'].includes(e.type)&&!e.completed).length;$('#gcAgendaSummary').innerHTML=[['Ônibus reconhecidos',fleet.length],['Serviços / linhas hoje',service],['Manutenções hoje',maint],['Sem hodômetro atualizado',missing]].map(([l,v])=>`<div class="gc-agenda-summary-card"><span>${escapeHtml(l)}</span><strong>${escapeHtml(String(v))}</strong></div>`).join('');}
function gcAgendaEventMarkup(ev){const isDone=ev.completed||gcAgendaIsDone(ev.id),vehicle=ev.vehicle||((ev.company||ev.prefix)?`${ev.company||''} · ${ev.prefix||''}`:'Frota geral'),urg=ev.priority==='Urgente'||ev.alertImportant;return `<article class="gc-agenda-event ${isDone?'completed':''}"><div class="gc-agenda-event-top"><div class="gc-agenda-event-main"><strong>${gcAgendaIcon(ev.type,urg)} ${escapeHtml(ev.title||'Tarefa da frota')}</strong><small>${escapeHtml(vehicle)}${ev.time?` · ${escapeHtml(ev.time)}`:''}${ev.description?` · ${escapeHtml(ev.description)}`:''}</small><div class="gc-agenda-event-badges"><span class="gc-agenda-badge ${urg?'urgent':''}">${escapeHtml(ev.priority||'Normal')}</span><span class="gc-agenda-badge">${escapeHtml(({turismo:'Turismo',escolar:'Escolar',fretamento:'Fretamento',operation:'Operação de linha',clean:'Limpeza',wash:'Lavagem',oil:'Óleo / filtros',maintenance:'Manutenção',tires:'Pneus',document:'Documento / IPVA',ipva:'IPVA',other:'Outro'})[ev.type]||'Agenda')}</span>${isDone?'<span class="gc-agenda-badge done">Concluído</span>':''}${ev.dueKm?`<span class="gc-agenda-badge">Marco ${numberPt(ev.dueKm,0)} km</span>`:''}</div></div>${!isDone?`<button type="button" class="secondary-action-button" data-agenda-done="${escapeHtml(ev.id)}">Concluir</button>`:''}</div></article>`;}
function gcAgendaRenderDay(){const iso=gcAgendaSelectedDate,events=gcAgendaEventsForDate(iso);$('#gcAgendaSelectedDayTitle').textContent=`Agenda de ${localDate(iso)}`;$('#gcAgendaDayCount').textContent=`${events.length} ${events.length===1?'item':'itens'}`;$('#gcAgendaDayEvents').innerHTML=events.length?events.map(gcAgendaEventMarkup).join(''):recordsEmpty('Nenhuma rotina cadastrada neste dia. A agenda gera linhas, serviços e lembretes de frota automaticamente quando há dados suficientes.');}
function gcAgendaRenderCalendar(){const label=$('#gcAgendaMonthLabel');if(!label)return;label.textContent=`${gcAgendaMonthNames[gcAgendaMonth.getMonth()]} ${gcAgendaMonth.getFullYear()}`;const year=gcAgendaMonth.getFullYear(),month=gcAgendaMonth.getMonth(),first=new Date(year,month,1),offset=(first.getDay()+6)%7,start=new Date(year,month,1-offset),today=dateTodayLocal();const map=gcAgendaEventsForMonth(`${year}-${String(month+1).padStart(2,'0')}-01`);let html='';for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const events=map[iso]||gcAgendaEventsForDate(iso),alerts=events.filter(e=>!e.completed&&(e.alertImportant||e.priority==='Urgente'||(e.priority==='Alta'&&['maintenance','oil','tires'].includes(e.type)))),icons=[];events.forEach(e=>{const icon=gcAgendaIcon(e.type,alerts.includes(e));if(!icons.includes(icon)&&icons.length<4)icons.push(icon);});html+=`<button type="button" class="gc-agenda-day ${d.getMonth()!==month?'outside':''} ${iso===today?'today':''} ${iso===gcAgendaSelectedDate?'selected':''}" data-agenda-date="${iso}" role="gridcell" aria-label="${escapeHtml(localDate(iso))}, ${events.length} itens"><span class="gc-agenda-day-number">${d.getDate()}</span><span class="gc-agenda-day-icons">${icons.join(' ')}</span>${events.length?`<span class="gc-agenda-day-count">${events.length} ${events.length===1?'item':'itens'}</span>`:''}</button>`;}$('#gcAgendaCalendar').innerHTML=html;}
function gcAgendaRenderFleetStatus(){const vehicles=gcAgendaVehicleList(),profiles=gcAgendaSyncFleet();$('#gcAgendaFleetStatus').innerHTML=vehicles.length?vehicles.map(v=>{const p=profiles[gcAgendaVehicleKey(v)],km=Number(p?.currentKm),hasKm=gcAgendaHasKm(p),status=hasKm?`${numberPt(km,0)} km · leitura ${localDate(p.odoDate)}`:'Hodômetro não informado';return `<article class="record-item"><div><strong>${escapeHtml(gcAgendaVehicleLabel(v))}</strong><small>${escapeHtml(status)} · próximo óleo ${hasKm&&p.lastOilAtKm!==null?`${numberPt(Number(p.lastOilAtKm)+10000,0)} km`:'definir após primeira leitura'} · revisão ${hasKm&&p.lastPreventiveAtKm!==null?`${numberPt(Number(p.lastPreventiveAtKm)+20000,0)} km`:'definir após primeira leitura'}</small></div></article>`;}).join(''):recordsEmpty('Cadastre ônibus na frota ou registre linhas para começar.');}
function gcAgendaRender(){if(!$('#gcAgendaPanel'))return;gcAgendaSyncFleet();gcAgendaPopulateVehicles();if(!$('#gcAgendaEventDate').value)$('#gcAgendaEventDate').value=dateTodayLocal();if(!$('#gcAgendaKmDate').value)$('#gcAgendaKmDate').value=dateTodayLocal();if(!gcAgendaSelectedDate)gcAgendaSelectedDate=dateTodayLocal();gcAgendaRenderSummary();gcAgendaRenderCalendar();gcAgendaRenderDay();gcAgendaRenderFleetStatus();gcAgendaRenderHomeAlert();}
function gcAgendaRenderHomeAlert(){
  const banner=$('#gcAgendaHomeAlert');
  if(!banner)return;
  try{
    const today=gcAgendaEventsForDate(dateTodayLocal());
    const urgent=today.filter(e=>!e.completed&&['maintenance','oil','tires'].includes(e.type)&&(e.alertImportant||e.priority==='Urgente'||e.priority==='Alta'));
    if(!urgent.length){banner.hidden=true;return;}
    const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
    // A agenda pode ter registros repetidos com IDs diferentes; a prévia agrupa apenas
    // eventos visualmente idênticos. Os registros originais continuam intactos na agenda.
    const unique=[...new Map(urgent.map(e=>{
      const key=[e.type,e.company,e.vehicle,e.prefix,e.title,e.line].map(normalize).join('|');
      return [key,e];
    })).values()];
    const shown=unique.slice(0,2);
    $('#gcAgendaAlertTitle').textContent=unique.some(e=>e.priority==='Urgente')?'MANUTENÇÃO URGENTE PENDENTE':'Atenção: manutenção importante hoje';
    $('#gcAgendaAlertText').textContent=shown.map(e=>`${e.vehicle||e.company||'Frota'} — ${e.title}${e.priority==='Urgente'?' (URGENTE)':''}`).join(' · ')+(unique.length>shown.length?` · +${unique.length-shown.length} item(ns) na agenda`:'' );
    banner.hidden=false;
  }catch(e){banner.hidden=true;console.warn('[Grupo Conect] Prévia da agenda indisponível:',e);}
}
function gcAgendaSaveOdometer(event){event.preventDefault();if(!assertOwner())return;const v=gcAgendaSelectedVehicle('gcAgendaOdometerVehicle'),km=Number($('#gcAgendaCurrentKm').value),date=$('#gcAgendaKmDate').value;if(!v||!date||!Number.isFinite(km)||km<0){showToast('Escolha o ônibus, a data e um hodômetro válido.');return;}const key=gcAgendaVehicleKey(v),profiles=gcAgendaSyncFleet(),p=profiles[key]||{key,company:v.company,prefix:v.prefix,model:v.model,lastOilAtKm:null,lastPreventiveAtKm:null,lastTireAtKm:null};if(gcAgendaHasKm(p)&&km<Number(p.currentKm)){if(!window.confirm(`O novo hodômetro (${numberPt(km,0)} km) é menor que o anterior (${numberPt(p.currentKm,0)} km). Registrar mesmo assim?`))return;}const old=gcAgendaHasKm(p)?Number(p.currentKm):null;p.currentKm=km;p.odoDate=date;if(p.lastOilAtKm===null||p.lastOilAtKm===undefined)p.lastOilAtKm=km;if(p.lastPreventiveAtKm===null||p.lastPreventiveAtKm===undefined)p.lastPreventiveAtKm=km;if(p.lastTireAtKm===null||p.lastTireAtKm===undefined)p.lastTireAtKm=km;p.updatedAt=new Date().toISOString();profiles[key]=p;if(!gcWriteObject(GC_AGENDA_PROFILES_KEY,profiles))return;const odoRows=readArrayKey(ODOMETER_KEY);odoRows.push({id:makeId(),date,vehicle:gcAgendaVehicleLabel(v),start:old!==null?old:km,end:km,km:old!==null?km-old:0,notes:'Leitura atual registrada pela Agenda de Frota',source:'agenda-frota'});if(!writeArrayKey(ODOMETER_KEY,odoRows))return;gcAgendaRender();$('#gcAgendaCurrentKm').value='';showToast('Hodômetro atualizado. A agenda recalculou as rotinas de manutenção.');}
function gcAgendaSaveEvent(event){event.preventDefault();if(!assertOwner())return;const date=$('#gcAgendaEventDate').value,type=$('#gcAgendaEventType').value,title=$('#gcAgendaEventTitle').value.trim(),vehicle=gcAgendaSelectedVehicle('gcAgendaEventVehicle'),priority=$('#gcAgendaEventPriority').value,time=$('#gcAgendaEventTime').value,kmRaw=$('#gcAgendaEventKm').value;if(!date||!title){showToast('Informe uma data e uma descrição.');return;}const row={id:makeId(),date,type,title,time,priority,vehicle:vehicle?gcAgendaVehicleLabel(vehicle):'Frota geral',company:vehicle?.company||'',prefix:vehicle?.prefix||'',vehicleKey:vehicle?gcAgendaVehicleKey(vehicle):'',description:kmRaw?`Hodômetro previsto: ${numberPt(Number(kmRaw),0)} km`:'',dueKm:kmRaw?Number(kmRaw):null,createdAt:new Date().toISOString(),source:'manual',alertImportant:['Alta','Urgente'].includes(priority)&&['maintenance','oil','tires'].includes(type)};if(!writeArrayKey(GC_AGENDA_EVENTS_KEY,[...readArrayKey(GC_AGENDA_EVENTS_KEY),row]))return;gcAgendaSelectedDate=date;gcAgendaMonth=new Date(dateFromISO(date).getFullYear(),dateFromISO(date).getMonth(),1);$('#gcAgendaEventForm').reset();$('#gcAgendaEventDate').value=date;gcAgendaRender();showToast('Rotina adicionada ao calendário.');}
function gcAgendaOpenAlert(){if(!$('#gcAgendaHomeAlert')||$('#gcAgendaHomeAlert').hidden)return;$('#ownerUserSelect').value='Pablo';activateOwnerArea();switchScreen('ownerAreaScreen');gcAgendaOpen();}

// Eventos e sincronização dos dois aplicativos adicionais.
$('#gcBankOpenButton')?.addEventListener('click',gcBankOpen);
$('#gcBankCloseButton')?.addEventListener('click',gcBankClose);
$$('[data-bank-tab]').forEach(b=>b.addEventListener('click',()=>gcBankSetTab(b.dataset.bankTab)));
$('#gcBankCardToggle')?.addEventListener('click',()=>{if(!assertOwner())return;localStorage.setItem(GC_BANK_CARD_KEY,gcBankCardIsBlocked()?'active':'blocked');gcBankRenderOverview();showToast(gcBankCardIsBlocked()?'Cartão empresarial simulado bloqueado.':'Cartão empresarial simulado desbloqueado.');});
$('#gcBankTransactionForm')?.addEventListener('submit',event=>{event.preventDefault();if(!assertOwner()||gcBankCardIsBlocked()){showToast('Desbloqueie o cartão empresarial simulado para prosseguir.');return;}const type=$('#gcBankTransactionType').value,amount=Number($('#gcBankTransactionAmount').value),payee=$('#gcBankTransactionRecipient').value.trim(),reference=$('#gcBankTransactionKey').value.trim(),description=$('#gcBankTransactionDescription').value.trim(),direction=type.endsWith('In')?'in':'out';if(!Number.isFinite(amount)||amount<=0||!payee||!description){showToast('Preencha favorecido/origem, descrição e valor positivo.');return;}if(direction==='out'&&amount>cashBreakdown().balance+0.005){showToast(`Saldo insuficiente. Disponível ${money(cashBreakdown().balance)}.`);return;}const cat=({pixOut:'Pix enviado',transferOut:'Transferência enviada',billOut:'Pagamento de conta / boleto fictício',withdrawOut:'Saque simulado',pixIn:'Pix recebido',depositIn:'Depósito / aporte recebido'})[type]||'Movimentação bancária';const row={id:`bank-txn-${makeId()}`,date:dateTodayLocal(),direction,amount:Number(amount.toFixed(2)),category:cat,description,payee,reference,source:'gcBankTransaction',auto:true,createdAt:new Date().toISOString()};row.receiptText=gcBankFormatReceipt(row,'COMPROVANTE DE OPERAÇÃO · BANCO GRUPO CONECT');if(!writeArrayKey(CASH_LEDGER_KEY,[...cashLedger(),row]))return;$('#gcBankTransactionForm').reset();gcBankRender();renderCashDashboard();gcBankShowReceipt(row.receiptText,`comprovante-${row.id}.txt`);showToast('Movimentação simulada registrada no Caixa e no banco.');});
$('#gcBankPayrollForm')?.addEventListener('submit',gcBankPayPayroll);
$('#gcBankLoanForm')?.addEventListener('submit',gcBankLoanApply);
['gcBankLoanAmount','gcBankLoanTerm','gcBankLoanPurpose','gcBankLoanGuarantee'].forEach(id=>$('#'+id)?.addEventListener('input',gcBankLoanRenderPreview));
['gcBankLoanTerm','gcBankLoanPurpose','gcBankLoanGuarantee'].forEach(id=>$('#'+id)?.addEventListener('change',gcBankLoanRenderPreview));
$('#gcPayrollEmployee')?.addEventListener('change',gcBankLoadStaffSettings);
['gcPayrollBase','gcPayrollMeal','gcPayrollMealCopay','gcPayrollDental','gcPayrollCompetence','gcPayrollIncludeMeal','gcPayrollIncludeDental','gcPayrollIncludeEmployerCharges'].forEach(id=>$('#'+id)?.addEventListener('input',gcBankUpdatePayrollPreview));
$('#gcPayrollSaveSettings')?.addEventListener('click',gcBankSavePayrollSettings);
function gcBankLoadTaxForm(){const v=gcBankVehicleFromSelect('gcBankTaxVehicle');if(!v){gcBankUpdateTaxPreview();return;}const y=Number($('#gcBankTaxYear').value)||new Date().getFullYear(),saved=gcBankTaxHistory().find(x=>gcBankVehicleKey(x)===gcBankVehicleKey(v)&&Number(x.year)===y);if(saved){$('#gcBankTaxValue').value=Number(saved.baseValue).toFixed(2);$('#gcBankTaxRate').value=String(saved.rate);$('#gcBankTaxInstallments').value=String(saved.installments);}else{$('#gcBankTaxValue').value=gcBankTaxEstimate(v).toFixed(2);$('#gcBankTaxRate').value=/el[eé]tric|electric/.test(norm(`${v.model} ${v.chassis}`))?'0.5':'2';$('#gcBankTaxInstallments').value='1';}gcBankUpdateTaxPreview();}
$('#gcBankTaxVehicle')?.addEventListener('change',gcBankLoadTaxForm);$('#gcBankTaxYear')?.addEventListener('change',gcBankLoadTaxForm);
['gcBankTaxValue','gcBankTaxRate','gcBankTaxInstallments'].forEach(id=>$('#'+id)?.addEventListener('input',gcBankUpdateTaxPreview));
$('#gcBankTaxForm')?.addEventListener('submit',gcBankPayIpva);
$('#gcBankExportStatement')?.addEventListener('click',gcBankExport);
$('#gcBankStatementMonth')?.addEventListener('input',gcBankRenderStatement);
$('#gcBankStatementSearch')?.addEventListener('input',gcBankRenderStatement);
$('#gcBankReceiptClose')?.addEventListener('click',()=>$('#gcBankReceiptPanel').hidden=true);
$('#gcBankReceiptDownload')?.addEventListener('click',()=>{if(!assertOwner())return;downloadTextFile($('#gcBankReceiptDownload').dataset.filename||'comprovante-grupo-conect.txt',gcBankCurrentReceipt);showToast('Comprovante baixado.');});
$('#gcBankReceiptPrint')?.addEventListener('click',()=>{if(!assertOwner())return;const w=window.open('','_blank','width=720,height=780');if(!w){showToast('Permita a abertura da janela para imprimir o comprovante.');return;}w.document.write(`<html><head><title>Comprovante Grupo Conect</title><meta charset="utf-8"><style>body{font:15px Arial,sans-serif;padding:28px}pre{white-space:pre-wrap;line-height:1.5}</style></head><body><pre>${escapeHtml(gcBankCurrentReceipt)}</pre><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();});
$('#gcBankReceiptCopy')?.addEventListener('click',async()=>{if(!assertOwner())return;showToast(await copyText(gcBankCurrentReceipt)?'Comprovante copiado.':'Não foi possível copiar automaticamente.');});
$('#gcBankPanel')?.addEventListener('click',event=>{const loanPay=event.target.closest('[data-bank-loan-pay]');if(loanPay){gcBankLoanPay(loanPay.dataset.bankLoanPay);return;}const loanReceipt=event.target.closest('[data-bank-loan-receipt]');if(loanReceipt){const loan=gcBankLoanRows().find(x=>x.id===loanReceipt.dataset.bankLoanReceipt);if(loan)gcBankShowReceipt(gcBankLoanContractText(loan),'contrato-'+(loan.contractNumber||loan.id)+'.txt');return;}const b=event.target.closest('[data-bank-receipt]');if(b){if(!assertOwner())return;const row=gcBankRows().find(x=>String(x.id)===b.dataset.bankReceipt);if(row)gcBankShowReceipt(row.receiptText||gcBankFormatReceipt(row),`comprovante-${row.id}.txt`);return;}const p=event.target.closest('[data-bank-payroll-receipt]');if(p){const row=readArrayKey(GC_BANK_PAYROLL_KEY).find(x=>x.id===p.dataset.bankPayrollReceipt);if(row)gcBankShowReceipt(row.receiptText,`folha-${row.competence}-${row.name}.txt`);return;}const f=event.target.closest('[data-bank-view-finance]');if(f){if(!assertOwner())return;$('#gcBankPanel').hidden=true;renderFinanceDetail(f.dataset.bankViewFinance);$('#ownerFinancePanel').scrollIntoView({behavior:'smooth',block:'start'});$('#financeDetailPanel').scrollIntoView({behavior:'smooth',block:'start'});return;}});
$('#gcAgendaOpenButton')?.addEventListener('click',gcAgendaOpen);
$('#gcAgendaCloseButton')?.addEventListener('click',gcAgendaClose);
$('#gcAgendaPrev')?.addEventListener('click',()=>{if(!assertOwner())return;gcAgendaMonth=new Date(gcAgendaMonth.getFullYear(),gcAgendaMonth.getMonth()-1,1);gcAgendaRenderCalendar();});
$('#gcAgendaNext')?.addEventListener('click',()=>{if(!assertOwner())return;gcAgendaMonth=new Date(gcAgendaMonth.getFullYear(),gcAgendaMonth.getMonth()+1,1);gcAgendaRenderCalendar();});
$('#gcAgendaCalendar')?.addEventListener('click',event=>{const b=event.target.closest('[data-agenda-date]');if(!b)return;if(!assertOwner())return;gcAgendaSelectedDate=b.dataset.agendaDate;gcAgendaMonth=new Date(dateFromISO(gcAgendaSelectedDate).getFullYear(),dateFromISO(gcAgendaSelectedDate).getMonth(),1);gcAgendaRenderCalendar();gcAgendaRenderDay();});
$('#gcAgendaDayEvents')?.addEventListener('click',event=>{const b=event.target.closest('[data-agenda-done]');if(b)gcAgendaMarkDone(b.dataset.agendaDone);});
$('#gcAgendaOdometerForm')?.addEventListener('submit',gcAgendaSaveOdometer);
$('#gcAgendaEventForm')?.addEventListener('submit',gcAgendaSaveEvent);
$('#gcAgendaOdometerVehicle')?.addEventListener('change',()=>{const v=gcAgendaSelectedVehicle('gcAgendaOdometerVehicle'),p=v&&gcAgendaReadProfiles()[gcAgendaVehicleKey(v)];if(gcAgendaHasKm(p))$('#gcAgendaCurrentKm').value=String(p.currentKm);});
$('#gcAgendaOpenFromAlert')?.addEventListener('click',gcAgendaOpenAlert);

// Atualize as vistas ao mudar os cadastros ou receber lançamentos do caixa em outros módulos.
const gcOriginalWriteArrayKey=writeArrayKey;
writeArrayKey=function(key,items){const ok=gcOriginalWriteArrayKey(key,items);if(ok&&typeof gcBankRender==='function'&&key===CASH_LEDGER_KEY&&$('#gcBankPanel')&&!$('#gcBankPanel').hidden)gcBankRender();if(ok&&typeof gcAgendaSyncFleet==='function'&&[OWNER_FLEET_KEY,FINANCED_BUSES_KEY,ODOMETER_KEY].includes(key)){gcAgendaSyncFleet();if($('#gcAgendaPanel')&&!$('#gcAgendaPanel').hidden)gcAgendaRender();}return ok;};
const gcOriginalCashRender=renderCashDashboard;
renderCashDashboard=function(){gcOriginalCashRender();if(typeof gcBankRender==='function'&&$('#gcBankPanel')&&!$('#gcBankPanel').hidden)gcBankRender();if(typeof gcAgendaRenderHomeAlert==='function')gcAgendaRenderHomeAlert();};
const gcOriginalSwitchScreen=switchScreen;
switchScreen=function(screenId){gcOriginalSwitchScreen(screenId);if(screenId==='homeScreen')gcAgendaRenderHomeAlert();if(screenId==='ownerAreaScreen'&&ownerAllowed())gcAgendaRenderHomeAlert();};
const gcOriginalActivateOwnerArea=activateOwnerArea;
activateOwnerArea=function(){gcOriginalActivateOwnerArea();if(ownerAllowed()){gcBankRender();gcAgendaSyncFleet();gcAgendaRenderHomeAlert();}};
const gcBankInitialDate=dateTodayLocal().slice(0,7);
if($('#gcPayrollCompetence')&&!$('#gcPayrollCompetence').value)$('#gcPayrollCompetence').value=gcBankInitialDate;
if($('#gcBankTaxYear')&&!$('#gcBankTaxYear').value)$('#gcBankTaxYear').value=String(new Date().getFullYear());
if($('#gcAgendaKmDate')&&!$('#gcAgendaKmDate').value)$('#gcAgendaKmDate').value=dateTodayLocal();
if($('#gcAgendaEventDate')&&!$('#gcAgendaEventDate').value)$('#gcAgendaEventDate').value=dateTodayLocal();
if($('#gcBankTaxVehicle')){gcBankPopulateSelect('gcBankTaxVehicle');gcBankLoadTaxForm();}
if($('#gcBankPayrollForm'))gcBankRefreshEmployees();
if($('#gcAgendaPanel')){gcAgendaSyncFleet();gcAgendaPopulateVehicles();gcAgendaRenderHomeAlert();}
setInterval(()=>{try{if(ownerAllowed()){if($('#gcBankPanel')&&!$('#gcBankPanel').hidden)gcBankRender();gcAgendaRenderHomeAlert();}}catch(e){}},12000);
/* Módulo aditivo de Garagem, Mecânica, Contratações e Mercado de Peças.
   Mantém os dados originais e salva os novos registros em chaves próprias do navegador. */
const GC_GARAGE_STATE_KEY='grupoConect.garageCondition.v1';
const GC_GARAGE_ORDERS_KEY='grupoConect.garageWorkOrders.v1';
const GC_GARAGE_ALERTS_KEY='grupoConect.garageBreakdowns.v1';
const GC_GARAGE_STAFF_KEY='grupoConect.garageStaff.v1';
const GC_GARAGE_HISTORY_KEY='grupoConect.garageWorkshopHistory.v1';
const GC_GARAGE_PARTS_STOCK_KEY='grupoConect.garagePartsStock.v1';
const GC_GARAGE_PARTS_PURCHASE_KEY='grupoConect.garagePartsPurchases.v1';
const GC_GARAGE_SUPPLIER_STOCK_KEY='grupoConect.garageSupplierStock.v1';
const GC_GARAGE_YEAR_NOW=2026;
const gcGarageRead=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem(key)||'null');return v===null?fallback:v;}catch(e){return fallback;}};
const gcGarageWrite=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){showToast('Não foi possível salvar a Garagem: armazenamento local cheio ou indisponível.');return false;}};
const gcGarageKey=v=>`${norm(v?.company)}|${norm(v?.prefix)}`;
const gcGarageStaff=()=>gcGarageRead(GC_GARAGE_STAFF_KEY,[]);
const gcGarageOrders=()=>gcGarageRead(GC_GARAGE_ORDERS_KEY,[]);
const gcGarageAlerts=()=>gcGarageRead(GC_GARAGE_ALERTS_KEY,[]);
const gcGarageHistory=()=>gcGarageRead(GC_GARAGE_HISTORY_KEY,[]);
const gcGarageState=()=>gcGarageRead(GC_GARAGE_STATE_KEY,{});
const gcGarageClamp=n=>Math.max(0,Math.min(100,Number(n)||0));
const gcGarageHash=s=>{let h=0;for(let i=0;i<String(s).length;i++)h=(h*31+String(s).charCodeAt(i))|0;return Math.abs(h);};

const GC_GARAGE_COMPONENTS=[
 {key:'engineOil',name:'Óleo lubrificante do motor (litro)',group:'Motor e filtros',life:15000,wear:.0067,base:28,critical:true,category:'Motor e filtros'},
 {key:'oilFilter',name:'Filtro de óleo',group:'Motor e filtros',life:20000,wear:.005,base:125,critical:true,category:'Motor e filtros'},
 {key:'fuelFilter',name:'Filtros de combustível / diesel',group:'Motor e filtros',life:30000,wear:.0033,base:185,critical:true,category:'Motor e filtros'},
 {key:'airFilter',name:'Filtro de ar do motor',group:'Motor e filtros',life:40000,wear:.0025,base:310,critical:true,category:'Motor e filtros'},
 {key:'turbocharger',name:'Turbocompressor e atuador',group:'Motor e filtros',life:320000,wear:.00022,base:6200,critical:true,category:'Motor e filtros'},
 {key:'injectors',name:'Bicos injetores / sistema de injeção',group:'Motor e filtros',life:280000,wear:.00024,base:4800,critical:true,category:'Motor e filtros'},
 {key:'belts',name:'Correias, tensionadores e polias',group:'Motor e filtros',life:90000,wear:.0009,base:480,critical:false,category:'Motor e filtros'},
 {key:'radiator',name:'Radiador e colmeia',group:'Arrefecimento',life:350000,wear:.00018,base:4200,critical:true,category:'Arrefecimento'},
 {key:'waterPump',name:'Bomba d’água',group:'Arrefecimento',life:220000,wear:.0003,base:1350,critical:true,category:'Arrefecimento'},
 {key:'hoses',name:'Mangueiras, abraçadeiras e válvula termostática',group:'Arrefecimento',life:120000,wear:.00065,base:780,critical:false,category:'Arrefecimento'},
 {key:'clutch',name:'Embreagem e atuadores',group:'Transmissão',life:300000,wear:.0002,base:5600,critical:true,category:'Transmissão'},
 {key:'gearbox',name:'Caixa de câmbio e sincronizadores',group:'Transmissão',life:650000,wear:.000095,base:14500,critical:true,category:'Transmissão'},
 {key:'differential',name:'Diferencial e coroa/pinhão',group:'Transmissão',life:650000,wear:.000095,base:11200,critical:true,category:'Transmissão'},
 {key:'driveshaft',name:'Eixo cardã e cruzetas',group:'Transmissão',life:360000,wear:.00018,base:4200,critical:false,category:'Transmissão'},
 {key:'brakeLining',name:'Lonas / pastilhas e kit de reparo',group:'Freios e pneumática',life:60000,wear:.00105,base:1350,critical:true,category:'Freios'},
 {key:'brakeDrum',name:'Tambores / discos de freio',group:'Freios e pneumática',life:180000,wear:.00032,base:2800,critical:true,category:'Freios'},
 {key:'airCompressor',name:'Compressor de ar do sistema pneumático',group:'Freios e pneumática',life:300000,wear:.0002,base:4900,critical:true,category:'Freios'},
 {key:'airDryer',name:'Secador de ar e cartucho',group:'Freios e pneumática',life:120000,wear:.0005,base:1450,critical:true,category:'Freios'},
 {key:'brakeChambers',name:'Câmaras, válvulas e tubulações de freio',group:'Freios e pneumática',life:240000,wear:.00025,base:2600,critical:true,category:'Freios'},
 {key:'frontTires',name:'Pneus dianteiros',group:'Pneus e suspensão',life:75000,wear:.00115,base:2950,critical:true,category:'Pneus'},
 {key:'rearTires',name:'Pneus traseiros / tração',group:'Pneus e suspensão',life:70000,wear:.00125,base:2750,critical:true,category:'Pneus'},
 {key:'wheels',name:'Rodas, porcas e prisioneiros',group:'Pneus e suspensão',life:500000,wear:.00012,base:1250,critical:true,category:'Pneus'},
 {key:'wheelBearings',name:'Rolamentos e cubos de roda',group:'Pneus e suspensão',life:240000,wear:.00025,base:1600,critical:true,category:'Suspensão'},
 {key:'shocks',name:'Amortecedores',group:'Pneus e suspensão',life:160000,wear:.00038,base:920,critical:false,category:'Suspensão'},
 {key:'bushings',name:'Buchas, pivôs e terminais',group:'Pneus e suspensão',life:140000,wear:.00043,base:980,critical:false,category:'Suspensão'},
 {key:'steering',name:'Caixa de direção e barras',group:'Pneus e suspensão',life:400000,wear:.00015,base:5200,critical:true,category:'Suspensão'},
 {key:'suspension',name:'Molas, bolsas de ar e válvulas niveladoras',group:'Pneus e suspensão',life:320000,wear:.0002,base:4600,critical:true,category:'Suspensão'},
 {key:'battery',name:'Baterias e cabos principais',group:'Elétrica e acessórios',life:1100,wear:.045,base:1850,critical:true,category:'Elétrica'},
 {key:'alternator',name:'Alternador e regulador de tensão',group:'Elétrica e acessórios',life:250000,wear:.00024,base:3100,critical:false,category:'Elétrica'},
 {key:'starter',name:'Motor de partida',group:'Elétrica e acessórios',life:260000,wear:.00022,base:2700,critical:false,category:'Elétrica'},
 {key:'lighting',name:'Faróis, lanternas, chicote e sinalização',group:'Elétrica e acessórios',life:8,wear:.0018,base:680,critical:true,category:'Elétrica'},
 {key:'arla32',name:'ARLA 32 / AdBlue (litro do sistema SCR)',group:'Emissões · SCR / ARLA 32',life:1000,wear:.08,base:6.5,critical:true,category:'SCR / ARLA 32',scr:true},
 {key:'scrPump',name:'Bomba e módulo dosador SCR',group:'Emissões · SCR / ARLA 32',life:320000,wear:.00019,base:4600,critical:true,category:'SCR / ARLA 32',scr:true},
 {key:'scrInjector',name:'Injetor dosador de ARLA 32',group:'Emissões · SCR / ARLA 32',life:250000,wear:.00023,base:1750,critical:true,category:'SCR / ARLA 32',scr:true},
 {key:'noxSensor',name:'Sensor de NOx e chicote',group:'Emissões · SCR / ARLA 32',life:220000,wear:.00025,base:3900,critical:true,category:'SCR / ARLA 32',scr:true},
 {key:'scrCatalyst',name:'Catalisador SCR / pós-tratamento',group:'Emissões · SCR / ARLA 32',life:600000,wear:.00009,base:14500,critical:true,category:'SCR / ARLA 32',scr:true}
];
const GC_EXTRA_PARTS=[
 {key:'airConditioning',name:'Compressor do ar-condicionado',category:'Ar-condicionado',base:3800},{key:'acCondenser',name:'Condensador do ar-condicionado',category:'Ar-condicionado',base:1650},{key:'acFilter',name:'Filtro secador do ar-condicionado',category:'Ar-condicionado',base:420},{key:'doorActuator',name:'Atuador pneumático da porta',category:'Carroceria e conforto',base:1450},{key:'doorValve',name:'Válvula de acionamento de porta',category:'Carroceria e conforto',base:620},{key:'wiperKit',name:'Palhetas e mecanismo limpador',category:'Carroceria e conforto',base:380},{key:'mirror',name:'Espelho retrovisor completo',category:'Carroceria e conforto',base:1250},{key:'windowGlass',name:'Vidro lateral / para-brisa (conforme modelo)',category:'Carroceria e conforto',base:1850},{key:'seatTrim',name:'Revestimento de poltrona',category:'Carroceria e conforto',base:480},{key:'fireExtinguisher',name:'Extintor e suporte homologado',category:'Segurança',base:390},{key:'cleanKit',name:'Kit de limpeza técnica interna',category:'Limpeza e conservação',base:160},{key:'bodySeal',name:'Jogo de borrachas e vedação',category:'Carroceria e conforto',base:520}
];
const GC_GARAGE_GROUPS=[...new Set(GC_GARAGE_COMPONENTS.map(x=>x.group))];
const GC_GARAGE_STAFF_CANDIDATES=[
 {id:'mec-ana',name:'Ana Paula Ribeiro',role:'mechanic',level:5,specialty:'Diagnóstico eletrônico, motor Euro V/VI e SCR',years:16,education:'Técnica em Mecânica Diesel · diagnóstico eletrônico',courses:'Common Rail, SCR/ARLA 32, scanner pesado',salary:5250,benefits:'VA/VR sugerido R$ 720 · VT · assistência médica · seguro de vida',city:'Três Rios/RJ'},
 {id:'mec-carlos',name:'Carlos Eduardo Nascimento',role:'mechanic',level:4,specialty:'Motor diesel, transmissão e embreagem',years:13,education:'Técnico em Manutenção Automotiva',courses:'Motores pesados, câmbio automatizado, análise de óleo',salary:4650,benefits:'VA/VR R$ 680 · VT · assistência odontológica',city:'Paraíba do Sul/RJ'},
 {id:'mec-marcos',name:'Marcos Vinícius Lopes',role:'mechanic',level:4,specialty:'Freios pneumáticos, ABS/EBS e suspensão',years:12,education:'Mecânico de veículos pesados · SENAI',courses:'Knorr-Bremse, WABCO, sistema pneumático',salary:4450,benefits:'VA/VR R$ 680 · VT · plano odontológico',city:'Vassouras/RJ'},
 {id:'mec-juliana',name:'Juliana Martins Costa',role:'mechanic',level:3,specialty:'Elétrica, alternador, partida e ar-condicionado',years:8,education:'Técnica em Eletromecânica',courses:'Elétrica 24 V, climatização veicular, leitura de diagramas',salary:3900,benefits:'VA/VR R$ 650 · VT',city:'Três Rios/RJ'},
 {id:'mec-roberto',name:'Roberto Alves Ferreira',role:'mechanic',level:3,specialty:'Pneus, cubos, rolamentos e alinhamento',years:9,education:'Formação profissional em mecânica pesada',courses:'Borracheiro de linha pesada, torque e geometria',salary:3750,benefits:'VA/VR R$ 650 · VT · seguro de vida',city:'Paraíba do Sul/RJ'},
 {id:'mec-pedro',name:'Pedro Henrique Souza',role:'mechanic',level:2,specialty:'Manutenção preventiva, filtros e lubrificação',years:4,education:'Mecânico de manutenção diesel',courses:'Lubrificação, filtros, inspeção de frota',salary:3250,benefits:'VA/VR R$ 620 · VT',city:'Areal/RJ'},
 {id:'mec-lucas',name:'Lucas Almeida Rocha',role:'mechanic',level:2,specialty:'Arrefecimento, mangueiras e periféricos',years:5,education:'Aprendizagem industrial em mecânica',courses:'Arrefecimento, correias, bombas d’água',salary:3300,benefits:'VA/VR R$ 620 · VT',city:'Vassouras/RJ'},
 {id:'mec-bruno',name:'Bruno da Silva Mendes',role:'mechanic',level:1,specialty:'Auxiliar de oficina e inspeção básica',years:1,education:'Curso de mecânica diesel básica',courses:'5S, segurança em oficina e checklist',salary:2750,benefits:'VA/VR R$ 600 · VT',city:'Três Rios/RJ'},
 {id:'drv-andre',name:'André Luiz Carvalho',role:'driver',level:0,specialty:'Turismo rodoviário e fretamento',years:14,education:'Ensino médio completo',courses:'CNH D/E · EAR · transporte coletivo · direção defensiva · primeiros socorros',salary:4050,benefits:'VA/VR sugerido R$ 700 · VT · plano odontológico',city:'Paraíba do Sul/RJ',license:'D/E · EAR'},
 {id:'drv-marcelo',name:'Marcelo Gomes Pereira',role:'driver',level:0,specialty:'Linha urbana e intermunicipal',years:11,education:'Ensino médio completo',courses:'CNH D · EAR · transporte coletivo · acessibilidade',salary:3890,benefits:'VA/VR R$ 680 · VT · seguro de vida',city:'Três Rios/RJ',license:'D · EAR'},
 {id:'drv-renata',name:'Renata de Oliveira Costa',role:'driver',level:0,specialty:'Fretamento corporativo e turismo',years:9,education:'Ensino médio completo',courses:'CNH D/E · EAR · transporte coletivo · condução econômica',salary:3980,benefits:'VA/VR R$ 680 · VT · assistência médica',city:'Vassouras/RJ',license:'D/E · EAR'},
 {id:'drv-fabio',name:'Fábio Augusto Martins',role:'driver',level:0,specialty:'Rodoviário e viagens de longa distância',years:18,education:'Ensino médio completo',courses:'CNH E · EAR · transporte coletivo · MOPP (quando aplicável)',salary:4350,benefits:'VA/VR R$ 720 · VT · assistência médica',city:'Petrópolis/RJ',license:'E · EAR'},
 {id:'drv-jose',name:'José Ricardo Lima',role:'driver',level:0,specialty:'Linhas municipais e fretamento',years:6,education:'Ensino médio completo',courses:'CNH D · EAR · transporte coletivo · direção defensiva',salary:3750,benefits:'VA/VR R$ 650 · VT',city:'Areal/RJ',license:'D · EAR'},
 {id:'drv-mateus',name:'Mateus Ferreira Santos',role:'driver',level:0,specialty:'Turismo escolar e acessibilidade',years:7,education:'Ensino médio completo',courses:'CNH D · EAR · transporte coletivo · atendimento a PCD',salary:3820,benefits:'VA/VR R$ 660 · VT · plano odontológico',city:'Miguel Pereira/RJ',license:'D · EAR'},
 {id:'drv-paulo',name:'Paulo César Mendes',role:'driver',level:0,specialty:'Intermunicipal e urbano',years:4,education:'Ensino médio completo',courses:'CNH D · EAR · transporte coletivo',salary:3650,benefits:'VA/VR R$ 620 · VT',city:'Paraíba do Sul/RJ',license:'D · EAR'},
 {id:'drv-tiago',name:'Tiago Barbosa Ribeiro',role:'driver',level:0,specialty:'Fretamento e viagens executivas',years:12,education:'Ensino médio completo',courses:'CNH D/E · EAR · transporte coletivo · direção defensiva',salary:4150,benefits:'VA/VR R$ 700 · VT · assistência odontológica',city:'Três Rios/RJ',license:'D/E · EAR'}
];

// Amplia o banco simulado para pelo menos 250 candidatos em cada função.
// Os perfis adicionais são fictícios e servem exclusivamente à simulação do site.
(function gcGarageBuildCandidatePool(){
 const firstMechanics=['Aline','André','Antônio','Bruno','Caio','Carlos','Daniel','Diego','Eduardo','Felipe','Fernando','Gabriel','Gustavo','Henrique','João','Jorge','Leonardo','Lucas','Marcelo','Marcos','Paulo','Rafael'];
 const lastMechanics=['Almeida','Andrade','Barbosa','Batista','Carvalho','Costa','Dias','Ferreira','Freitas','Lima','Lopes'];
 const firstDrivers=['Adriana','Alexandre','Anderson','Bruna','Camila','Cláudio','Cristiano','Daniela','Davi','Elaine','Emerson','Érica','Fabiana','Fábio','Gilberto','Isabela','Jorge','José','Leandro','Letícia','Luiz','Márcia'];
 const lastDrivers=['Alves','Araújo','Cardoso','Cavalcanti','Correia','Cunha','Gomes','Mendes','Moreira','Nunes','Oliveira'];
 const cities=['Paraíba do Sul/RJ','Três Rios/RJ','Vassouras/RJ','Areal/RJ','Miguel Pereira/RJ','Petrópolis/RJ','Valença/RJ','Barra do Piraí/RJ','Juiz de Fora/MG','Nova Friburgo/RJ','Levy Gasparian/RJ'];
 const mechSpecs=[
  ['Motor diesel pesado e injeção Common Rail','Motores Euro V/VI, Common Rail e análise de óleo'],
  ['Diagnóstico eletrônico e sistemas SCR','Scanner pesado, sensores NOx e ARLA 32'],
  ['Freios pneumáticos, ABS/EBS e válvulas','Sistemas Knorr-Bremse, WABCO e pneumática'],
  ['Transmissão, embreagem e diferencial','Câmbio manual/automatizado e diferencial'],
  ['Elétrica 24 V, alternador e partida','Chicotes, módulos, alternadores e diagnóstico'],
  ['Pneus, rodas, cubos e rolamentos','Geometria, torque e linha pesada'],
  ['Arrefecimento, turbo e periféricos','Radiadores, bombas d’água e intercooler'],
  ['Manutenção preventiva e inspeção de frota','Lubrificação, filtros e checklist técnico']
 ];
 const driverSpecs=[
  ['Linha urbana e intermunicipal','Transporte coletivo, acessibilidade e direção defensiva'],
  ['Turismo rodoviário e fretamento','Viagens interestaduais, atendimento e condução econômica'],
  ['Fretamento corporativo e executivo','Pontualidade, atendimento ao cliente e direção segura'],
  ['Transporte escolar e viagens especiais','Transporte coletivo, primeiros socorros e atendimento a estudantes'],
  ['Operação rodoviária de longa distância','Jornada, tacógrafo, condução econômica e segurança viária'],
  ['Linhas municipais e operação urbana','Condução em tráfego intenso e atendimento ao passageiro']
 ];
 const benefits=['VA/VR sugerido R$ 620 · VT · seguro de vida','VA/VR sugerido R$ 680 · VT · assistência odontológica','VA/VR sugerido R$ 700 · VT · assistência médica','VA/VR sugerido R$ 650 · VT · seguro de vida','VA/VR sugerido R$ 720 · VT · assistência médica'];
 for(let i=0;i<242;i++){
  const mi=i+1, mYears=1+((i*7)%24), mLevel=mYears>=16?5:mYears>=11?4:mYears>=7?3:mYears>=3?2:1, ms=mechSpecs[i%mechSpecs.length];
  GC_GARAGE_STAFF_CANDIDATES.push({id:`mec-auto-${String(mi).padStart(3,'0')}`,name:`${firstMechanics[i%firstMechanics.length]} ${lastMechanics[Math.floor(i/firstMechanics.length)]}`,role:'mechanic',level:mLevel,specialty:ms[0],years:mYears,education:mLevel>=4?'Técnico em Mecânica Diesel / Manutenção de Veículos Pesados':mLevel>=2?'Formação técnica em manutenção automotiva':'Qualificação profissional em mecânica diesel',courses:ms[1],salary:Math.round((2450+mLevel*510+(mYears*34))/10)*10,benefits:benefits[i%benefits.length],city:cities[(i*3)%cities.length]});
  const di=i+1, dYears=1+((i*5)%27), license=(i%5===0||i%7===0)?'E · EAR':'D · EAR',ds=driverSpecs[i%driverSpecs.length];
  GC_GARAGE_STAFF_CANDIDATES.push({id:`drv-auto-${String(di).padStart(3,'0')}`,name:`${firstDrivers[i%firstDrivers.length]} ${lastDrivers[Math.floor(i/firstDrivers.length)]}`,role:'driver',level:0,specialty:ds[0],years:dYears,education:'Ensino médio completo · experiência comprovável informada no perfil',courses:`CNH ${license} · curso de transporte coletivo · direção defensiva · ${ds[1]}`,salary:Math.round((3000+dYears*65+(license.startsWith('E')?260:0))/10)*10,benefits:benefits[(i+2)%benefits.length],city:cities[(i*5+1)%cities.length],license});
 }
})();

function gcGarageVehicles(){try{return gcBankVehicles();}catch(e){return []}}
function gcGarageVehicleYear(v){const text=String(v.year||v.yearModel||v.model||'');const match=text.match(/(?:19|20)\d{2}/);const n=match?Number(match[0]):0;if(n>=1980&&n<=GC_GARAGE_YEAR_NOW+1)return {year:n,estimated:false};return {year:Math.min(GC_GARAGE_YEAR_NOW,2015),estimated:true};}
function gcGarageIsScr(v,year){const t=norm(`${v.model||''} ${v.chassis||''} ${v.emission||''}`);const saved=v&&typeof gcGarageState==='function'?gcGarageState()[gcGarageKey(v)]:null;if(typeof saved?.scr==='boolean')return saved.scr;if(/\b(egr|sem scr|sem arla)\b/.test(t))return false;return Boolean(v.scr||/euro\s*(5|6|v|vi)|proconve\s*p[- ]?(7|8)|scr|arla|adblue/.test(t)||year>=2012);}
function gcGarageKmRate(v){return /paradiso|viaggio|rodovi|irizar|double.?decker|dd/.test(norm(`${v.model} ${v.chassis}`))?78000:/micro|volare|lo-916|lo-915/.test(norm(`${v.model} ${v.chassis}`))?42000:56000;}
function gcGarageInitVehicle(v,profiles){const key=gcGarageKey(v),all=gcGarageState();if(all[key])return all[key];const y=gcGarageVehicleYear(v),isNew=Boolean(v.isZeroKm||v.source==='zero-km-market'),profile=profiles?.[key],knownKm=profile&&profile.currentKm!==null&&profile.currentKm!==undefined?Number(profile.currentKm):v.odometer!==null&&v.odometer!==undefined&&v.odometer!==''&&Number.isFinite(Number(v.odometer))?Number(v.odometer):null;const estimateKm=isNew?0:(knownKm!==null?knownKm:Math.max(0,(GC_GARAGE_YEAR_NOW-y.year)*gcGarageKmRate(v)));const seed=gcGarageHash(key);const components={};GC_GARAGE_COMPONENTS.forEach((c,i)=>{const groupFactor=c.group==='Pneus e suspensão'?1.28:c.group==='Freios e pneumática'?1.15:c.group==='Arrefecimento'?1.05:c.group==='Transmissão'?0.92:c.group==='Elétrica e acessórios'?0.84:1;const jitter=((seed+i*37)%13)-6;let health=isNew?100:gcGarageClamp(91-(GC_GARAGE_YEAR_NOW-y.year)*1.15-(estimateKm/100000)*1.65*groupFactor+jitter);if(c.key==='battery'&&!isNew)health=Math.min(health,Math.max(18,78-((GC_GARAGE_YEAR_NOW-y.year)%5)*10));components[c.key]=Math.round(health);});if(gcGarageIsScr(v,y.year))GC_GARAGE_COMPONENTS.filter(c=>c.scr).forEach((c,i)=>{const jitter=((seed+i*29)%11)-5;components[c.key]=isNew?100:Math.round(gcGarageClamp(88-(GC_GARAGE_YEAR_NOW-y.year)*1.25-(estimateKm/100000)*1.7+jitter));});const row={key,company:v.company,prefix:String(v.prefix),model:v.model,chassis:v.chassis||'',year:y.year,yearEstimated:y.estimated,km:isNew?0:knownKm,estimatedKm:estimateKm,kmEstimated:knownKm===null&&!isNew,isNew,components,createdAt:new Date().toISOString(),lastWearAt:new Date().toISOString(),condition:Math.round(Object.values(components).reduce((a,b)=>a+b,0)/Math.max(1,Object.keys(components).length))};all[key]=row;gcGarageWrite(GC_GARAGE_STATE_KEY,all);return row;}
function gcGarageSyncVehicles(){const all=gcGarageState(),profiles=typeof gcAgendaReadProfiles==='function'?gcAgendaReadProfiles():{},vehicles=gcGarageVehicles();let changed=false;vehicles.forEach(v=>{const key=gcGarageKey(v);if(!all[key]){all[key]=gcGarageInitVehicle(v,profiles);changed=true;return;}const p=all[key];if(p.model!==v.model||p.chassis!==(v.chassis||'')){p.model=v.model;p.chassis=v.chassis||'';changed=true;}if(v.isZeroKm&&!p.isNew&&p.createdAt===undefined){p.isNew=true;p.components=Object.fromEntries(Object.keys(p.components||{}).map(k=>[k,100]));p.condition=100;changed=true;}if(profiles[key]?.currentKm!==null&&profiles[key]?.currentKm!==undefined&&Number.isFinite(Number(profiles[key].currentKm))){const km=Number(profiles[key].currentKm);if(p.km===null||km>Number(p.km||0)){p.km=km;p.estimatedKm=km;p.kmEstimated=false;changed=true;}}all[key]=p;});if(changed)gcGarageWrite(GC_GARAGE_STATE_KEY,all);return all;}
function gcGarageCurrentVehicle(vOrKey){const key=typeof vOrKey==='string'?vOrKey:gcGarageKey(vOrKey);const all=gcGarageSyncVehicles();return all[key]||null;}
function gcGarageComponentList(stateRow){const v=gcGarageVehicles().find(x=>gcGarageKey(x)===stateRow.key);const year=Number(stateRow.year)||2015;return GC_GARAGE_COMPONENTS.filter(c=>!c.scr||gcGarageIsScr(v||stateRow,year)).filter(c=>!c.scr||Object.prototype.hasOwnProperty.call(stateRow.components,c.key));}
function gcGarageComponentHealth(row,key){return gcGarageClamp(row?.components?.[key]??0)}
function gcGarageGroupScore(row,group){const list=gcGarageComponentList(row).filter(c=>c.group===group);return list.length?list.reduce((s,c)=>s+gcGarageComponentHealth(row,c.key),0)/list.length:100;}
function gcGarageCondition(row){const list=gcGarageComponentList(row);return Math.round(list.length?list.reduce((s,c)=>s+gcGarageComponentHealth(row,c.key),0)/list.length:100)}
function gcGarageVehicleInfo(v){const s=gcGarageCurrentVehicle(v);return {vehicle:v,state:s,condition:gcGarageCondition(s),year:s?.year||2015,km:s?.km!==null&&s?.km!==undefined?s.km:s?.estimatedKm||0};}
function gcGarageStatusLabel(n){return n<40?'Crítico':n<70?'Atenção':'Bom'}
function gcGarageStatusClass(n){return n<40?'critical':n<70?'attention':'good'}
function gcGaragePercent(n){return `${Math.round(n)}%`}
function gcGaragePopulateVehicleSelect(){const el=$('#gcGarageRepairVehicle');if(!el)return;const old=el.value;el.innerHTML='<option value="">Selecione um ônibus</option>'+gcGarageVehicles().map(v=>`<option value="${escapeHtml(encodeURIComponent(gcGarageKey(v)))}">${escapeHtml(v.company)} · ${escapeHtml(v.prefix)} · ${escapeHtml(v.model)}</option>`).join('');if(Array.from(el.options).some(o=>o.value===old))el.value=old;}
function gcGaragePopulateMechanics(){const rows=gcGarageStaff().filter(x=>x.role==='mechanic'&&x.active!==false);['gcGarageRepairMechanic','gcGarageRepairMechanic2'].forEach(id=>{const el=$('#'+id);if(!el)return;const old=el.value;el.innerHTML=rows.length?'<option value="">Selecione o mecânico</option>'+rows.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)} · Nível ${x.level} · ${escapeHtml(x.specialty)}</option>`).join(''):'<option value="">Nenhum mecânico contratado — contrate no app Equipe</option>';if(Array.from(el.options).some(o=>o.value===old))el.value=old;});gcGarageUpdateSecondMechanicVisibility();}
function gcGarageVehicleFromSelect(){try{const key=decodeURIComponent($('#gcGarageRepairVehicle').value||'');return gcGarageVehicles().find(v=>gcGarageKey(v)===key)||null;}catch(e){return null;}}
function gcGarageRenderStats(){const states=Object.values(gcGarageSyncVehicles()),orders=gcGarageOrders(),active=orders.filter(x=>!['Aprovada','Cancelada'].includes(x.status)).length,critical=states.filter(x=>gcGarageCondition(x)<40).length;$('#gcGarageStats').innerHTML=[['Ônibus reconhecidos',states.length],['Críticos / retidos',states.filter(x=>gcGarageCondition(x)<40||x.blocked).length],['Ordens em andamento',active],['Mecânicos contratados',gcGarageStaff().filter(x=>x.role==='mechanic'&&x.active!==false).length]].map(([l,n])=>`<div class="gc-garage-stat"><span>${escapeHtml(l)}</span><strong>${n}</strong></div>`).join('');}
function gcGarageRenderFleet(){if(!$('#gcGarageVehicleList'))return;const q=norm($('#gcGarageSearch')?.value||''),filter=$('#gcGarageConditionFilter')?.value||'';const vehicles=gcGarageVehicles().filter(v=>{const s=gcGarageCurrentVehicle(v),c=gcGarageCondition(s),search=norm(`${v.company} ${v.model} ${v.prefix} ${v.chassis||''}`);if(q&&!search.includes(q))return false;if(filter==='critical'&&c>=40)return false;if(filter==='attention'&&(c<40||c>=70))return false;if(filter==='good'&&c<70)return false;if(filter==='missing'&&!s.yearEstimated&&!s.kmEstimated)return false;return true;});$('#gcGarageVehicleList').innerHTML=vehicles.length?vehicles.map(v=>{const s=gcGarageCurrentVehicle(v),c=gcGarageCondition(s),cls=gcGarageStatusClass(c),km=s.km!==null&&s.km!==undefined?`${numberPt(s.km,0)} km`:`~${numberPt(s.estimatedKm,0)} km estimados`,year=s.yearEstimated?'ano estimado':'ano informado',missing=s.yearEstimated||s.kmEstimated;return `<article class="gc-garage-vehicle-card"><div class="gc-garage-vehicle-head"><div><span class="gc-garage-company">${escapeHtml(v.company)}</span><h3>${escapeHtml(v.model)}</h3><small>Chassi: ${escapeHtml(v.chassis||'não informado')} · Prefixo ${escapeHtml(v.prefix)}</small></div><span class="gc-garage-status-pill ${cls}">${gcGaragePercent(c)}</span></div><div class="gc-garage-progress"><span class="${cls}" style="width:${c}%"></span></div><div class="gc-garage-vehicle-meta"><span>${escapeHtml(gcGarageStatusLabel(c))} · ${escapeHtml(km)}</span><span>${escapeHtml(String(s.year))} · ${year}</span></div>${missing?'<p class="gc-garage-info-needed">⚠ Completar/confirmar ano e hodômetro para refinar a estimativa.</p>':''}${s.blocked?`<p class="gc-garage-info-needed gc-garage-blocked">🛑 BLOQUEADO PARA OPERAÇÃO · ${escapeHtml(s.blockedReason||'Pane mecânica pendente')}</p>`:''}<div class="gc-garage-card-actions"><button type="button" class="secondary-action-button" data-gc-garage-detail="${escapeHtml(gcGarageKey(v))}">Ver situação completa</button><button type="button" class="primary-button" data-gc-garage-repair="${escapeHtml(gcGarageKey(v))}">Conserto</button></div></article>`;}).join(''):recordsEmpty('Nenhum ônibus corresponde ao filtro.');gcGarageRenderStats();}
function gcGarageRenderDetail(key){const v=gcGarageVehicles().find(x=>gcGarageKey(x)===key),panel=$('#gcGarageDetail');if(!v||!panel)return;const s=gcGarageCurrentVehicle(v),c=gcGarageCondition(s),groups=GC_GARAGE_GROUPS.filter(g=>gcGarageComponentList(s).some(x=>x.group===g));const groupHtml=groups.map(g=>{const list=gcGarageComponentList(s).filter(x=>x.group===g),score=gcGarageGroupScore(s,g),cl=gcGarageStatusClass(score);return `<details class="gc-garage-component-group" ${score<45?'open':''}><summary><span>${escapeHtml(g)}</span><strong class="${cl}">${gcGaragePercent(score)}</strong></summary><div class="gc-garage-component-list">${list.map(x=>{const h=gcGarageComponentHealth(s,x.key),cls=gcGarageStatusClass(h);return `<div class="gc-garage-component-row"><span>${escapeHtml(x.name)}</span><strong class="${cls}">${gcGaragePercent(h)}</strong></div>`;}).join('')}</div></details>`;}).join('');panel.hidden=false;panel.innerHTML=`<div class="gc-garage-detail-head"><div><span class="eyebrow">FICHA TÉCNICA · ${escapeHtml(v.company)}</span><h3>${escapeHtml(v.model)} · ${escapeHtml(v.prefix)}</h3><p>Chassi: ${escapeHtml(v.chassis||'não informado')} · Condição mecânica global estimada: <b>${gcGaragePercent(c)}</b> (${gcGarageStatusLabel(c)}). ${s.blocked?`<b class="critical">RETIDO PARA OPERAÇÃO · ${escapeHtml(s.blockedReason||'Pane mecânica pendente')}</b>`:''}</p></div><button type="button" class="secondary-action-button" id="gcGarageCloseDetail">Fechar ficha</button></div><div class="gc-garage-identity-grid"><div><span>Ano/modelo</span><strong>${s.year}${s.yearEstimated?' · estimado':''}</strong></div><div><span>Hodômetro</span><strong>${s.km!==null&&s.km!==undefined?`${numberPt(s.km,0)} km`:`~${numberPt(s.estimatedKm,0)} km estimados`}</strong></div><div><span>Tipo de aquisição</span><strong>${s.isNew?'0 km / novo':'Usado / frota existente'}</strong></div><div><span>Emissões</span><strong>${gcGarageIsScr(v,s.year)?'Diesel com SCR / ARLA 32':'Sem SCR identificado'}</strong></div></div><div class="gc-garage-detail-groups">${groupHtml}</div><form class="gc-garage-confirm-form" id="gcGarageVehicleInfoForm"><strong>Completar / corrigir informações</strong><div class="fields-grid"><label class="field"><span>Ano de fabricação/modelo</span><input class="plain-input" id="gcGarageInfoYear" type="number" min="1990" max="2027" value="${s.year}" required></label><label class="field"><span>Hodômetro real (km)</span><input class="plain-input" id="gcGarageInfoKm" type="number" min="0" step="1" value="${s.km===null||s.km===undefined?'':s.km}" placeholder="Informe a leitura verdadeira" required></label></div><label class="gc-garage-scr-confirm"><input id="gcGarageInfoScr" type="checkbox" ${gcGarageIsScr(v,s.year)?'checked':''}><span>Este ônibus utiliza sistema SCR e ARLA 32 / AdBlue</span></label><button class="secondary-action-button" type="submit">Salvar dados confirmados</button><small>SCR é uma estimativa inicial para veículos mais recentes. Confirme no manual e na identificação do motor/chassi: o ano isoladamente não garante que o veículo use SCR. Se não houver leitura do hodômetro, não registre a estimativa como valor real.</small></form><button type="button" class="primary-button" data-gc-garage-repair="${escapeHtml(key)}">Conserto deste ônibus →</button>`;$('#gcGarageInfoYear').value=String(s.year);$('#gcGarageInfoKm').value=s.km===null||s.km===undefined?'':String(s.km);}

const GC_GARAGE_SERVICES={
 'Inspeção pré-operacional':{hours:1.5,needs:[],affects:[],labor:190},
 'Inspeção geral':{hours:2.5,needs:[],affects:[],labor:260},
 'Limpeza interna':{hours:2,needs:[],affects:[],labor:130},'Lavagem externa':{hours:1.5,needs:[],affects:[],labor:100},
 'Troca de óleo e filtros':{hours:4,needs:[['engineOil',20],['oilFilter',1],['fuelFilter',2],['airFilter',1]],affects:['engineOil','oilFilter','fuelFilter','airFilter'],labor:490},
 'Sistema de freios':{hours:12,needs:[['brakeLining',1],['airDryer',1],['brakeChambers',1]],affects:['brakeLining','brakeDrum','airCompressor','airDryer','brakeChambers'],labor:1450},
 'Pneus e rodas':{hours:10,needs:[['frontTires',2],['rearTires',4],['wheelBearings',1]],affects:['frontTires','rearTires','wheels','wheelBearings'],labor:1250},
 'Suspensão e direção':{hours:18,needs:[['shocks',2],['bushings',1],['steering',1]],affects:['shocks','bushings','steering','suspension'],labor:2100},
 'Motor e injeção':{hours:36,needs:[['fuelFilter',2],['injectors',1],['turbocharger',1],['belts',1]],affects:['engineOil','fuelFilter','injectors','turbocharger','belts'],labor:4600},
 'Transmissão e diferencial':{hours:48,needs:[['clutch',1],['gearbox',1],['differential',1],['driveshaft',1]],affects:['clutch','gearbox','differential','driveshaft'],labor:5900},
 'Arrefecimento':{hours:10,needs:[['radiator',1],['waterPump',1],['hoses',1]],affects:['radiator','waterPump','hoses'],labor:1250},
 'Sistema elétrico':{hours:12,needs:[['battery',2],['alternator',1],['starter',1],['lighting',1]],affects:['battery','alternator','starter','lighting'],labor:1450},
 'SCR / ARLA 32':{hours:8,needs:[['arla32',20],['scrInjector',1],['noxSensor',1]],affects:['arla32','scrPump','scrInjector','noxSensor','scrCatalyst'],labor:1550,scr:true},
 'Manutenção preventiva completa':{hours:16,needs:[['engineOil',20],['oilFilter',1],['fuelFilter',2],['airFilter',1],['brakeLining',1]],affects:['engineOil','oilFilter','fuelFilter','airFilter','brakeLining','brakeChambers','frontTires','rearTires'],labor:2350},
 'Retífica / revisão profunda do motor':{hours:160,needs:[['engineOil',30],['oilFilter',2],['injectors',1],['turbocharger',1],['waterPump',1],['belts',1]],affects:['engineOil','oilFilter','fuelFilter','airFilter','turbocharger','injectors','belts','radiator','waterPump','hoses'],labor:16800}
};
function gcGarageServiceNeeds(service,v){const def=GC_GARAGE_SERVICES[service]||GC_GARAGE_SERVICES['Inspeção geral'];if(def.scr&&!gcGarageIsScr(v,gcGarageVehicleYear(v).year))return [];const family=gcPartsVehicleFamily(v);return def.needs.map(([key,qty])=>{let q=qty;if(key==='frontTires'||key==='rearTires'){q=family==='micro'?2:family==='articulado'?(key==='frontTires'?2:8):(key==='frontTires'?2:4);}return {key,name:GC_GARAGE_COMPONENTS.find(c=>c.key===key)?.name||GC_EXTRA_PARTS.find(c=>c.key===key)?.name||key,quantity:q,status:'pending',quality:'original',purchaseId:'',arrivesAt:'',price:0};});}
function gcGarageUpdateSecondMechanicVisibility(){const urgent=$('#gcGarageRepairPriority')?.value==='Urgente',wrap=$('#gcGarageRepairMechanic2Wrap'),select=$('#gcGarageRepairMechanic2');if(wrap)wrap.hidden=!urgent;if(select){select.required=urgent;if(!urgent)select.value='';const first=$('#gcGarageRepairMechanic')?.value;Array.from(select.options).forEach(o=>{if(o.value)o.disabled=Boolean(first&&o.value===first);});}}
function gcGarageUpdateServiceEstimate(){const s=$('#gcGarageRepairService')?.value,v=gcGarageVehicleFromSelect(),def=GC_GARAGE_SERVICES[s]||GC_GARAGE_SERVICES['Inspeção geral'];if(!$('#gcGarageServiceEstimate'))return;const needs=v?gcGarageServiceNeeds(s,v):def.needs,staff=gcGarageStaff(),mechanic=staff.find(x=>x.id===$('#gcGarageRepairMechanic')?.value),urgent=$('#gcGarageRepairPriority')?.value==='Urgente',mechanic2=urgent?staff.find(x=>x.id===$('#gcGarageRepairMechanic2')?.value):null,speed1=mechanic?1+(Number(mechanic.level)-1)*.15:1,speed2=mechanic2&&mechanic2.id!==mechanic?.id?1+(Number(mechanic2.level)-1)*.15:0,factor=speed2?((speed1+speed2)/2)*1.25:speed1;$('#gcGarageServiceEstimate').innerHTML=`<strong>Tempo técnico previsto: ${numberPt(def.hours/factor,1)} h úteis de oficina</strong><span>Serviço de referência: ${numberPt(def.hours,1)} h · ${needs.length?`${needs.length} item(ns) de peças / insumos`:'sem substituição obrigatória de peça'}</span><small>${urgent?(mechanic2?'Equipe urgente com 2 mecânicos: ganho de produtividade estimado de até 25%; mão de obra adicional de equipe aplicada.':'Prioridade urgente: selecione um segundo mecânico diferente para calcular o prazo em equipe.')+' · ':''}Expediente simulado: segunda a sexta, 08h–12h e 13h–17h. Diagnósticos podem ampliar o prazo após desmontagem.</small>`;}
function gcGarageOpen(){if(!assertOwner())return;$('#gcBankPanel').hidden=true;$('#gcAgendaPanel').hidden=true;$('#gcGaragePanel').hidden=false;gcGarageSyncVehicles();gcGarageRender();gcGaragePopulateVehicleSelect();gcGaragePopulateMechanics();$('#gcGaragePanel').scrollIntoView({behavior:'smooth',block:'start'});}
function gcGarageClose(){if(!assertOwner())return;$('#gcGaragePanel').hidden=true;}
function gcGarageSetTab(tab){['fleet','orders','alerts'].forEach(name=>{const el=$('#gcGarageView'+name[0].toUpperCase()+name.slice(1));if(el)el.hidden=name!==tab;});$$('[data-garage-tab]').forEach(b=>b.classList.toggle('active',b.dataset.garageTab===tab));if(tab==='fleet')gcGarageRenderFleet();if(tab==='orders')gcGarageRenderOrders();if(tab==='alerts')gcGarageRenderAlerts();}
function gcGarageRender(){gcGarageSyncVehicles();gcGarageRenderStats();gcGarageRenderFleet();gcGarageRenderOrders();gcGarageRenderAlerts();gcGaragePopulateVehicleSelect();gcGaragePopulateMechanics();gcGarageRenderHomeAlert();}
function gcGarageOpenRepair(key='',service='Inspeção pré-operacional',agendaId='',notes=''){if(!assertOwner())return;gcGarageOpen();gcGarageSetTab('fleet');gcGaragePopulateVehicleSelect();gcGaragePopulateMechanics();const panel=$('#gcGarageRepairBox');panel.hidden=false;$('#gcGarageRepairTitle').textContent=key?'Conserto / manutenção do ônibus':'Nova ordem de serviço';$('#gcGarageRepairAgendaId').value=agendaId||'';const vehicle=gcGarageVehicles().find(v=>gcGarageKey(v)===key);$('#gcGarageRepairVehicle').value=vehicle?encodeURIComponent(key):'';$('#gcGarageRepairVehicleKey').value=key||'';$('#gcGarageRepairService').value=(service&&service in GC_GARAGE_SERVICES)||Array.from($('#gcGarageRepairService').options).some(o=>o.value===service)?service:'Inspeção pré-operacional';$('#gcGarageRepairPriority').value=agendaId?'Alta':'Normal';$('#gcGarageRepairMechanic2').value='';gcGarageUpdateSecondMechanicVisibility();$('#gcGarageRepairNotes').value=notes||'';gcGarageUpdateServiceEstimate();panel.scrollIntoView({behavior:'smooth',block:'center'});}
function gcGarageAddBusinessDays(start,days){const d=new Date(start);let count=0;while(count<days){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)count++;}return d;}
function gcGarageElapsedWorkshopHours(startIso,endMs=Date.now()){const start=new Date(startIso);if(Number.isNaN(start.getTime()))return 0;const end=new Date(endMs);if(end<=start)return 0;let total=0;const day=new Date(start.getFullYear(),start.getMonth(),start.getDate());while(day<=end){const dow=day.getDay();if(dow>=1&&dow<=5){[[8,12],[13,17]].forEach(([a,b])=>{const from=new Date(day);from.setHours(a,0,0,0);const to=new Date(day);to.setHours(b,0,0,0);total+=Math.max(0,Math.min(end,to)-Math.max(start,from))/3600000;});}day.setDate(day.getDate()+1);if(total>10000)break;}return total;}
function gcGarageStartOrder(order){if(order.status==='Aguardando peças'){const allReceived=order.parts.every(p=>p.status==='received');if(!allReceived)return false;}if(!order.startedAt){order.startedAt=new Date().toISOString();order.status='Em execução';order.lastUpdate=order.startedAt;return true;}return false;}
function gcGarageOrderProgress(order){if(!order.startedAt||order.status!=='Em execução')return 0;const staff=gcGarageStaff(),mech=staff.find(x=>x.id===order.mechanicId),mech2=staff.find(x=>x.id===(order.mechanic2Id||'')),speed1=1+(Math.max(1,Number(mech?.level)||1)-1)*.15,speed2=mech2?1+(Math.max(1,Number(mech2.level)||1)-1)*.15:0,teamFactor=mech2?((speed1+speed2)/2)*1.25:speed1,required=Math.max(.5,Number(order.estimatedHours)||2)/teamFactor;return Math.min(100,gcGarageElapsedWorkshopHours(order.startedAt)/required*100);}
function gcGarageProcess(){let orders=gcGarageOrders(),changed=false,completed=[];const now=Date.now();orders.forEach(order=>{if(order.status==='Aguardando peças'&&order.parts.every(p=>p.status==='received')){gcGarageStartOrder(order);changed=true;}if(order.status==='Em execução'){order.progress=gcGarageOrderProgress(order);if(order.progress>=100){order.progress=100;order.status='Aguardando conferência';order.completedAt=new Date(now).toISOString();order.lastUpdate=order.completedAt;completed.push(order);changed=true;}}});if(changed)gcGarageWrite(GC_GARAGE_ORDERS_KEY,orders);if(completed.length){completed.forEach(o=>showToast(`Ônibus ${o.prefix} pronto para sua conferência técnica.`));}gcGarageRenderHomeAlert();if($('#gcGaragePanel')&&!$('#gcGaragePanel').hidden)gcGarageRenderOrders();if($('#gcPhoneReportsView')&&!$('#gcPhoneReportsView').hidden)gcGarageRenderReports();}
function gcGarageRenderOrderCard(o){const v=gcGarageVehicles().find(x=>gcGarageKey(x)===o.vehicleKey),mech=gcGarageStaff().find(x=>x.id===o.mechanicId),progress=gcGarageOrderProgress(o),waiting=o.status==='Aguardando peças',ready=o.status==='Aguardando conferência';const needs=o.parts?.length?`<div class="gc-garage-order-parts">${o.parts.map(p=>`<div><span>${escapeHtml(p.name)} × ${p.quantity}</span><strong class="${p.status==='received'?'good':p.status==='ordered'?'attention':'critical'}">${p.status==='received'?'Recebida':p.status==='ordered'?'Em transporte':'Pendente'}</strong></div>`).join('')}</div>`:'';return `<article class="gc-garage-order-card"><div class="gc-garage-order-top"><div><span class="gc-garage-order-id">OS ${escapeHtml(o.number||o.id.slice(-6))} · ${escapeHtml(o.priority)}</span><h4>${escapeHtml(o.company)} · ${escapeHtml(o.prefix)} · ${escapeHtml(o.model)}</h4><p>${escapeHtml(o.service)} · ${escapeHtml(o.garage)}</p></div><span class="gc-garage-status-pill ${ready?'good':waiting?'attention':'attention'}">${escapeHtml(o.status)}</span></div><div class="gc-garage-order-meta"><span>Mecânico(s): <b>${escapeHtml([mech?.name||o.mechanicName||'—',o.mechanic2Name].filter(Boolean).join(' + '))}</b> · Nível ${mech?.level||o.mechanicLevel||'—'}${o.mechanic2Level?` + ${o.mechanic2Level}`:''}</span><span>Previsão: ${numberPt(o.estimatedHours,1)} h úteis</span></div>${o.notes?`<p class="gc-small-note">Observação: ${escapeHtml(o.notes)}</p>`:''}${needs}${o.status==='Em execução'?`<div class="gc-garage-progress"><span class="good" style="width:${progress}%"></span></div><small class="gc-garage-progress-label">${numberPt(progress,0)}% · expediente útil de oficina</small>`:''}${waiting?`<div class="gc-garage-order-actions"><button type="button" class="secondary-action-button" data-gc-parts-for-order="${escapeHtml(o.id)}">Comprar peças necessárias →</button></div>`:''}${ready?`<div class="gc-garage-approval"><strong>Serviço concluído. Confira o que foi feito antes de liberar o ônibus.</strong><p>${escapeHtml((o.workSummary||[]).join(' · '))}</p><div class="gc-garage-order-actions"><button type="button" class="primary-button" data-gc-order-approve="${escapeHtml(o.id)}">Confirmar boas condições</button><button type="button" class="secondary-action-button" data-gc-order-reject="${escapeHtml(o.id)}">Recusar / pedir reavaliação</button></div></div>`:''}<div class="gc-garage-order-footer"><small>Criada em ${escapeHtml(new Date(o.createdAt).toLocaleString('pt-BR'))}${o.startedAt?` · Início ${escapeHtml(new Date(o.startedAt).toLocaleString('pt-BR'))}`:''}</small>${['Aprovada','Cancelada'].includes(o.status)?'<span class="gc-garage-status-pill good">Finalizada</span>':''}</div></article>`;}
function gcGarageRenderOrders(){const list=$('#gcGarageOrderList');if(!list)return;const rows=gcGarageOrders().slice().reverse();list.innerHTML=rows.length?rows.map(gcGarageRenderOrderCard).join(''):recordsEmpty('Nenhuma ordem de serviço criada. O botão Conserto aparece na ficha de todos os ônibus.');}
function gcGarageRenderAlerts(){const el=$('#gcGarageAlertsList');if(!el)return;const rows=gcGarageAlerts().filter(x=>!x.resolvedAt).slice().reverse();el.innerHTML=rows.length?rows.map(a=>{const op=ownerOperations().find(x=>x.id===a.operationId);const alternatives=gcGarageVehicles().filter(v=>v.company===a.company&&gcGarageKey(v)!==a.vehicleKey&&gcGarageCondition(gcGarageCurrentVehicle(v))>=45&&!gcGarageCurrentVehicle(v).blocked&&!gcGarageAlerts().some(x=>!x.resolvedAt&&x.vehicleKey===gcGarageKey(v)));return `<article class="gc-garage-alert-card"><div><strong>🛑 Pane · ${escapeHtml(a.company)} · prefixo ${escapeHtml(a.prefix)}</strong><p>${escapeHtml(a.reason)} · ${escapeHtml(a.model)}</p><small>Interrupção em ${escapeHtml(new Date(a.createdAt).toLocaleString('pt-BR'))}. Linha/serviço: ${escapeHtml(op?.line||'operação interrompida')}.</small></div><div class="gc-garage-alert-actions"><button class="primary-button" type="button" data-gc-breakdown-send="${escapeHtml(a.id)}">Enviar mecânico</button><label class="gc-breakdown-swap"><span>Ônibus substituto</span><select data-gc-breakdown-select="${escapeHtml(a.id)}"><option value="">Selecione um ônibus livre</option>${alternatives.map(v=>`<option value="${escapeHtml(encodeURIComponent(gcGarageKey(v)))}">${escapeHtml(v.prefix)} · ${escapeHtml(v.model)}</option>`).join('')}</select></label><button class="secondary-action-button" type="button" data-gc-breakdown-swap="${escapeHtml(a.id)}">Trocar ônibus</button></div></article>`;}).join(''):recordsEmpty('Nenhuma pane mecânica pendente.');}
function gcGarageRenderHomeAlert(){
 const alerts=gcGarageAlerts().filter(x=>!x.resolvedAt),banner=$('#gcGarageBreakdownAlert');
 if(banner){if(!alerts.length)banner.hidden=true;else{const a=alerts[0];$('#gcGarageBreakdownTitle').textContent=`PANE MECÂNICA · ${a.company} · ${a.prefix}`;$('#gcGarageBreakdownText').textContent=`${a.reason}. A operação está parada. Escolha enviar mecânico ou substituir o veículo na Garagem.`;banner.hidden=false;}}
 const ready=$('#gcGarageReadyAlert'),orders=gcGarageOrders().filter(x=>x.status==='Aguardando conferência');
 if(ready){if(!orders.length)ready.hidden=true;else{const o=orders[0];$('#gcGarageReadyTitle').textContent=`ÔNIBUS PRONTO PARA CONFERÊNCIA · ${o.company} · ${o.prefix}`;$('#gcGarageReadyText').textContent=`OS ${o.number} · ${o.service}. Confira as peças e o trabalho do mecânico antes de liberar o veículo.`;ready.hidden=false;}}
}
function gcGarageCreateOrder(event){event.preventDefault();if(!assertOwner())return;const v=gcGarageVehicleFromSelect(),garage=$('#gcGarageRepairGarage').value,service=$('#gcGarageRepairService').value,mechanic=gcGarageStaff().find(x=>x.id===$('#gcGarageRepairMechanic').value),priority=$('#gcGarageRepairPriority').value,mechanic2=priority==='Urgente'?gcGarageStaff().find(x=>x.id===$('#gcGarageRepairMechanic2').value):null,notes=$('#gcGarageRepairNotes').value.trim(),agendaId=$('#gcGarageRepairAgendaId').value;if(!v||!garage||!service){showToast('Selecione o ônibus, a garagem e o serviço.');return;}if(!mechanic){showToast('Contrate ou selecione um mecânico no aplicativo Equipe antes de criar a ordem.');gcGarageOpenPhone('team');return;}if(priority==='Urgente'&&(!mechanic2||mechanic2.id===mechanic.id)){showToast('Para uma ordem urgente, selecione dois mecânicos diferentes.');return;}const def=GC_GARAGE_SERVICES[service]||GC_GARAGE_SERVICES['Inspeção geral'],needs=gcGarageServiceNeeds(service,v),key=gcGarageKey(v),all=gcGarageOrders(),mechanics=[mechanic,...(mechanic2?[mechanic2]:[])],order={id:makeId(),number:`GC-${String(all.length+1).padStart(5,'0')}`,createdAt:new Date().toISOString(),company:v.company,prefix:String(v.prefix),model:v.model,chassis:v.chassis||'',vehicleKey:key,garage,service,mechanicId:mechanic.id,mechanicName:mechanic.name,mechanicLevel:mechanic.level,mechanic2Id:mechanic2?.id||'',mechanic2Name:mechanic2?.name||'',mechanic2Level:mechanic2?.level||0,mechanicNames:mechanics.map(x=>x.name),priority,notes,agendaEventId:agendaId||'',breakdownId:gcGarageAlerts().find(a=>!a.resolvedAt&&a.vehicleKey===key)?.id||'',estimatedHours:def.hours,parts:needs,partsCost:0,laborCost:def.labor*(mechanic2?1.7:1),progress:0,status:needs.length?'Aguardando peças':'Em execução',startedAt:needs.length?'':new Date().toISOString(),workSummary:needs.length?needs.map(p=>`${p.name}: substituição prevista (${p.quantity})`):def.affects.map(k=>GC_GARAGE_COMPONENTS.find(c=>c.key===k)?.name||k),revisionCount:0};if(!gcGarageWrite(GC_GARAGE_ORDERS_KEY,[...all,order]))return;
 // Uma pendência ou lembrete na Agenda, sozinho, não para a linha. A parada ocorre
 // somente quando o proprietário confirma a abertura desta ordem de serviço.
 const affectedOps=ownerOperations();let affectedCount=0;
 const hasMechanicalBreakdown=Boolean(order.breakdownId||gcGarageAlerts().some(a=>!a.resolvedAt&&a.vehicleKey===key));
 affectedOps.forEach(op=>{
   if(gcGarageKey({company:opVehicleCompany(op),prefix:op.prefix})!==key)return;
   if(['cancelada','excluída'].includes(String(op.status||'').toLocaleLowerCase('pt-BR')))return;
   if(!op.gcUserMaintenanceHoldOrderId){
     const previousEvent=String(op.lastEvent||'');
     const stoppedOnlyByOldAgendaReminder=op.status==='parada técnica'&&/inspeção pré-operacional|aguardando inspeção|inspeção preventiva/i.test(previousEvent);
     const stoppedByThisBusBreakdown=(Boolean(op.breakdownId)||hasMechanicalBreakdown)&&['parada técnica','fora de operação'].includes(op.status);
     // Linhas que versões antigas deixaram paradas apenas por um lembrete da Agenda
     // ou pela pane que está sendo reparada voltam a ter estado operacional após aprovação.
     op.gcMaintenancePreviousStatus=(stoppedOnlyByOldAgendaReminder||stoppedByThisBusBreakdown)?'operando':op.status;
   }
   op.gcUserMaintenanceHoldOrderId=order.id;
   if(operationIsRunning(op)){
     freezeOperationClock(op);
     op.status='parada técnica';
     op.gcMaintenanceStoppedByOrder=true;
   }
   op.lastEvent=`ÔNIBUS ENCAMINHADO À OFICINA POR DECISÃO DO PROPRIETÁRIO · OS ${order.number}`;
   affectedCount++;
 });
 if(affectedCount){if(!writeArrayKey(OPERATION_KEY,affectedOps)){gcGarageWrite(GC_GARAGE_ORDERS_KEY,all);showToast('A ordem não foi mantida porque o navegador não conseguiu registrar a parada da operação. Libere espaço no armazenamento e tente novamente.');return;}renderOperations();}
 $('#gcGarageServiceForm').reset();gcGarageUpdateSecondMechanicVisibility();$('#gcGarageRepairBox').hidden=true;gcGarageRender();gcGarageSetTab('orders');showToast(needs.length?`OS ${order.number} criada. Compre as peças solicitadas no Mercado de Peças.`:`OS ${order.number} enviada para ${mechanics.map(x=>x.name).join(' e ')}. O prazo considerará a equipe escalada.`);}
// Confirma a tarefa de Agenda vinculada à ordem de serviço antes de liberar a próxima partida.
// A versão anterior chamava esta rotina sem declará-la, interrompendo a aprovação da OS
// com ReferenceError e deixando a inspeção pré-operacional eternamente pendente.
function gcGarageMarkAgendaDone(order){
 const agendaId=String(order?.agendaEventId||'').trim();
 if(!agendaId)return true;
 if(gcAgendaIsDone(agendaId))return true;
 if(typeof gcAgendaMarkDone==='function')gcAgendaMarkDone(agendaId);
 if(gcAgendaIsDone(agendaId))return true;
 // Fallback para eventos gerados automaticamente ou que já não aparecem na data selecionada.
 const done=gcAgendaDoneMap();
 done[agendaId]=new Date().toISOString();
 if(!gcWriteObject(GC_AGENDA_DONE_KEY,done))return false;
 if(typeof gcAgendaRender==='function')gcAgendaRender();
 if(typeof gcAgendaRenderHomeAlert==='function')gcAgendaRenderHomeAlert();
 return true;
}
function gcGarageApproveOrder(id){if(!assertOwner())return;const rows=gcGarageOrders(),o=rows.find(x=>x.id===id);if(!o||o.status!=='Aguardando conferência')return;const all=gcGarageState(),s=all[o.vehicleKey];if(!s){showToast('Não foi possível localizar a ficha do ônibus.');return;}const labor=Number(o.laborCost)||0,ledgerBefore=cashLedger(),laborLedgerId=`garage-labor-${o.id}`;if(labor>0&&!ledgerBefore.some(x=>x.id===laborLedgerId)&&labor>cashBreakdown().balance+0.005){showToast(`O serviço está pronto, mas o Caixa não cobre a mão de obra de ${money(labor)}. Faça um aporte antes de aprovar.`);return;}const def=GC_GARAGE_SERVICES[o.service]||GC_GARAGE_SERVICES['Inspeção geral'];const replaced=new Set(o.parts.map(p=>p.key));(def.affects||[]).forEach(k=>{if(s.components[k]!==undefined){const comp=GC_GARAGE_COMPONENTS.find(c=>c.key===k);s.components[k]=replaced.has(k)?100:Math.max(40,Math.min(100,Number(s.components[k]||0)+24));}});if(o.service==='Limpeza interna'||o.service==='Lavagem externa'){s.lastCleaningAt=new Date().toISOString();}s.condition=gcGarageCondition(s);s.lastWorkshopAt=new Date().toISOString();all[o.vehicleKey]=s;gcGarageWrite(GC_GARAGE_STATE_KEY,all);o.status='Aprovada';o.approvedAt=new Date().toISOString();o.progress=100;o.workSummary=(def.affects||[]).map(k=>GC_GARAGE_COMPONENTS.find(c=>c.key===k)?.name||k).concat(o.parts.map(p=>`${p.name} × ${p.quantity}`));
 if(labor>0){const ledger=cashLedger(),row={id:`garage-labor-${o.id}`,date:dateTodayLocal(),direction:'out',category:'Mão de obra de oficina',amount:labor,description:`OS ${o.number} · ${o.company} ${o.prefix} · ${o.service} · ${(o.mechanicNames||[o.mechanicName,o.mechanic2Name].filter(Boolean)).join(' + ')}`,source:'garage-workshop',auto:true,createdAt:new Date().toISOString()};if(!ledger.some(x=>x.id===row.id)){if(labor>cashBreakdown().balance+0.005){showToast(`O serviço está pronto, mas o Caixa não cobre a mão de obra de ${money(labor)}. Faça um aporte e confirme novamente.`);o.status='Aguardando conferência';o.approvedAt='';gcGarageWrite(GC_GARAGE_ORDERS_KEY,rows);return;}if(!writeArrayKey(CASH_LEDGER_KEY,[...ledger,row]))return;}}
 const partsCost=(o.parts||[]).reduce((sum,p)=>sum+Number(p.price||0),0),hist=gcGarageHistory();hist.push({id:makeId(),date:dateTodayLocal(),completedAt:o.approvedAt,company:o.company,prefix:o.prefix,model:o.model,chassis:o.chassis,service:o.service,mechanic:(o.mechanicNames||[o.mechanicName,o.mechanic2Name].filter(Boolean)).join(' + '),mechanicLevel:o.mechanic2Level?`${o.mechanicLevel} + ${o.mechanic2Level}`:o.mechanicLevel,garage:o.garage,parts:o.parts.map(p=>({name:p.name,quantity:p.quantity,price:p.price,quality:p.quality})),laborCost:labor,partsCost,totalCost:partsCost+labor,notes:o.notes||'',orderId:o.id});gcGarageWrite(GC_GARAGE_HISTORY_KEY,hist);gcGarageMarkAgendaDone(o);
 if(o.breakdownId){const al=gcGarageAlerts(),ix=al.findIndex(a=>a.id===o.breakdownId),alert=ix>=0?al[ix]:null,componentKey=alert?.componentKey||'',covered=new Set([...(def.affects||[]),...(o.parts||[]).map(p=>p.key)]),repaired=!componentKey||(covered.has(componentKey)&&gcGarageComponentHealth(s,componentKey)>=40);if(alert&&repaired){alert.resolvedAt=new Date().toISOString();alert.resolution=`Reparo aprovado na OS ${o.number}`;s.blocked=false;s.blockedReason='';gcGarageWrite(GC_GARAGE_STATE_KEY,all);gcGarageWrite(GC_GARAGE_ALERTS_KEY,al);const ops=ownerOperations(),op=ops.find(x=>x.id===alert.operationId);if(op){const priorStatus=op.gcIncidentPreviousStatus||op.gcIncidentActive?.resumeStatus||'operando';op.breakdownId='';op.gcIncidentActive=null;delete op.gcIncidentPreviousStatus;op.status=priorStatus==='pausada'?'pausada':'operando';op.lastEvent=`Pane resolvida · ${o.service} · OS ${o.number} aprovada${priorStatus==='pausada'?' · pausa manual preservada':''}`;op.clockAnchorAt=op.status==='pausada'?null:Date.now();writeArrayKey(OPERATION_KEY,ops);renderOperations();}}else if(alert){alert.lastAttemptAt=new Date().toISOString();alert.lastAttemptOrder=o.number;gcGarageWrite(GC_GARAGE_ALERTS_KEY,al);showToast(`OS ${o.number} aprovada, mas a pane ${componentKey||'não identificada'} continua sem comprovação de reparo. O ônibus permanece bloqueado; abra nova OS para corrigir o componente.`);}}
 const ops=ownerOperations();ops.forEach(op=>{
   if(op.garagePreTripEventId===o.agendaEventId&&op.status==='parada técnica'&&!op.gcUserMaintenanceHoldOrderId){op.status='operando';op.clockAnchorAt=Date.now();op.lastEvent='Tarefa da Agenda concluída após aprovação da oficina';}
   if(op.gcUserMaintenanceHoldOrderId!==o.id)return;
   const previous=op.gcMaintenancePreviousStatus||'operando';
   const otherPendingOrder=gcGarageOrders().find(x=>x.id!==o.id&&x.vehicleKey===o.vehicleKey&&!['Aprovada','Cancelada'].includes(x.status));
   if(otherPendingOrder){
     // Se houver mais de uma OS para o mesmo ônibus, a aprovação desta não libera
     // a linha; o marcador passa para a próxima ordem ainda pendente.
     op.gcUserMaintenanceHoldOrderId=otherPendingOrder.id;
     op.gcMaintenancePreviousStatus=previous;
     op.gcMaintenanceStoppedByOrder=true;
     op.status='parada técnica';
     op.clockAnchorAt=null;
     op.lastEvent=`Aguardando conclusão da OS ${otherPendingOrder.number}`;
     return;
   }
   delete op.gcUserMaintenanceHoldOrderId;
   delete op.gcMaintenancePreviousStatus;
   delete op.gcMaintenanceStoppedByOrder;
   const vehicle=getVehicle(opVehicleCompany(op),op.prefix,op.busModel);
   const mechanical=vehicle&&typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(vehicle):null;
   const unresolved=typeof gcGarageAlerts==='function'&&gcGarageAlerts().some(a=>!a.resolvedAt&&(a.operationId===op.id||(vehicle&&a.vehicleKey===gcGarageKey(vehicle))));
   if(op.replacementDispatch||op.gcInspectionPaused||mechanical?.blocked||unresolved){
     if(mechanical?.blocked)op.status='fora de operação';
     return;
   }
   if(op.gcFuelPaused)return;
   // Uma pausa manual anterior continua pausada. Uma linha que estava rodando
   // volta ao mesmo modo (inclusive desvio) quando a OS é aprovada.
   if(previous==='pausada'){
     op.status='pausada';op.clockAnchorAt=null;
   }else if(previous==='operando'||previous==='operando com desvio'||(previous==='parada técnica'&&(/inspeção pré-operacional|aguardando inspeção/i.test(String(op.lastEvent||''))||(o.breakdownId&&!op.breakdownId)||(o.agendaEventId&&typeof gcAgendaFindEvent==='function'&&(()=>{const ev=gcAgendaFindEvent(o.agendaEventId);return ev?.source==='garage-pretrip'||/inspeção pré-operacional/i.test(String(ev?.title||''));})())))||(previous==='fora de operação'&&o.breakdownId&&!op.breakdownId)){
     op.status=previous==='operando com desvio'?'operando com desvio':'operando';
     op.clockAnchorAt=Date.now();
   }else{
     op.status=previous;
     if(!operationIsRunning(op))op.clockAnchorAt=null;
   }
   op.lastEvent=`Manutenção aprovada · OS ${o.number} · ${o.service}`;
 });writeArrayKey(OPERATION_KEY,ops);renderOperations();gcGarageWrite(GC_GARAGE_ORDERS_KEY,rows);gcGarageRender();gcGarageRenderReports();if($('#gcAgendaPanel')&&!$('#gcAgendaPanel').hidden)gcAgendaRender();renderCashDashboard();showToast(`OS ${o.number} aprovada. Condição do ônibus atualizada e serviço registrado no Relatório de Oficina.`);}
function gcGarageRejectOrder(id){if(!assertOwner())return;const rows=gcGarageOrders(),o=rows.find(x=>x.id===id);if(!o||o.status!=='Aguardando conferência')return;const reason=window.prompt('Informe o motivo da recusa (ex.: vazamento persistente, peça não original, ruído após reparo):','Solicito reavaliação e conferência adicional.');if(reason===null)return;const preferOriginal=window.confirm('Deseja exigir peças originais/genuínas na reavaliação?');o.revisionCount=(Number(o.revisionCount)||0)+1;o.rejectionReason=reason;o.requireOriginal=preferOriginal;o.estimatedHours=Math.max(4,Number(o.estimatedHours)*.35);o.startedAt=new Date().toISOString();o.status='Em execução';o.progress=0;o.workSummary=[`Reavaliação solicitada: ${reason}`,preferOriginal?'Utilizar peças originais/genuínas.':'Revisar instalação e diagnóstico.'];if(preferOriginal){o.parts.forEach(p=>{p.status='pending';p.quality='original';p.purchaseId='';p.arrivesAt='';});if(o.parts.length)o.status='Aguardando peças';}gcGarageWrite(GC_GARAGE_ORDERS_KEY,rows);gcGarageRenderOrders();showToast('A oficina recebeu a recusa e iniciou uma reavaliação.');}
function gcGarageOpenPhone(tab='team',orderId=''){if(!assertOwner())return;$('#onlineServicePanel').hidden=false;gcOnlineShowTab(tab);if(orderId&&tab==='parts')$('#gcPartsOrderSelect').value=orderId;gcGarageRenderTeam();gcPartsRender();gcGarageRenderReports();$('#onlineServicePanel').scrollIntoView({behavior:'smooth',block:'start'});}
function gcGarageOpenFromAgenda(id){const ev=gcAgendaFindEvent(id)||gcGarageOrders().find(x=>x.agendaEventId===id);if(!ev)return;const vehicle=gcGarageVehicles().find(v=>gcGarageKey(v)===ev.vehicleKey)||gcGarageVehicles().find(v=>norm(v.prefix)===norm(ev.prefix)&&norm(v.company)===norm(ev.company));let service=ev.serviceType||'Inspeção pré-operacional';if(!ev.serviceType){service=({clean:'Limpeza interna',wash:'Lavagem externa',oil:'Troca de óleo e filtros',tires:'Inspeção geral',maintenance:'Manutenção preventiva completa',turismo:'Inspeção pré-operacional',fretamento:'Inspeção pré-operacional',escolar:'Inspeção pré-operacional',operation:'Inspeção pré-operacional'})[ev.type]||'Inspeção pré-operacional';}gcGarageOpenRepair(vehicle?gcGarageKey(vehicle):'',service,ev.id,ev.title||'Tarefa gerada pela Agenda de Frota');}
const gcGarageOriginalAgendaMarkup=gcAgendaEventMarkup;
gcAgendaEventMarkup=function(ev){let html=gcGarageOriginalAgendaMarkup(ev);if(!(ev.completed||gcAgendaIsDone(ev.id)))html=html.replace('data-agenda-done=','data-agenda-mech=').replace('>Concluir</button>','>Concluir tarefa → Mecânica</button>');return html;};
function gcGaragePreTripEvent(vehicle,line='',kind='normal',uniqueTag=''){const key=gcGarageKey(vehicle),date=dateTodayLocal(),tag=String(uniqueTag||`${kind}|${line}|${Date.now()}`),id=`gc-pretrip-${gcGarageHash(key+'|'+date+'|'+tag)}`,events=readArrayKey(GC_AGENDA_EVENTS_KEY);if(!events.some(x=>x.id===id)){const known=gcGarageVehicles().find(v=>gcGarageKey(v)===key);events.push({id,date,type:'maintenance',title:`Inspeção pré-operacional · ${line||kind||'viagem'}`,serviceType:'Inspeção pré-operacional',vehicle:known?(typeof gcGarageVehicleLabel==='function'?gcGarageVehicleLabel(known):gcAgendaVehicleLabel(known)):`${vehicle.company} · ${vehicle.prefix} · ${vehicle.model||''}`,company:vehicle.company,prefix:String(vehicle.prefix),vehicleKey:key,priority:'Alta',description:'Lembrete preventivo: conferir freios, pneus, iluminação, vazamentos, níveis, portas e documentação. Esta tarefa não interrompe a linha sozinha; a parada ocorre somente quando o proprietário envia o ônibus à oficina e abre uma ordem de serviço.',source:'garage-pretrip',createdAt:new Date().toISOString()});gcGarageWrite(GC_AGENDA_EVENTS_KEY,events);}return id;}
const gcGarageOriginalValidatorOpen=gcValidatorOpen;
gcValidatorOpen=function(pending){const j=pending?.journey||{},vehicle={company:pending?.company||j.company,model:pending?.model||j.busModel,prefix:pending?.prefix||j.busPrefix,chassis:pending?.chassis||j.chassis},line=pending?.line||j.line||pending?.type||'viagem';if(vehicle.company&&vehicle.prefix){const current=gcGarageCurrentVehicle(vehicle);if(current?.blocked){showToast(`Partida bloqueada: prefixo ${vehicle.prefix} está retido pela oficina (${current.blockedReason||'pane mecânica pendente'}).`);gcGarageOpen();gcGarageSetTab('alerts');return;}const workshopOrder=gcGarageOrders().find(x=>x.vehicleKey===gcGarageKey(vehicle)&&!['Aprovada','Cancelada'].includes(x.status));if(workshopOrder){showToast(`Partida bloqueada: prefixo ${vehicle.prefix} está na oficina pela OS ${workshopOrder.number} (${workshopOrder.status}). Aguarde a aprovação do serviço.`);gcGarageOpen();gcGarageSetTab('orders');return;}const fingerprint=[dateTodayLocal(),pending?.type||'',pending?.driver||j.driver||'',vehicle.company,vehicle.prefix,line].join('|');const previous=state.pendingJourney;let eventId=pending.gcGaragePreTripEventId||((previous?.gcGarageTripFingerprint===fingerprint)?previous.gcGaragePreTripEventId:'');if(!eventId)eventId=gcGaragePreTripEvent(vehicle,line,pending?.type||'normal',`${vehicle.company}-${vehicle.prefix}-${line}-${pending?.type||'normal'}-daily`);pending.gcGarageTripFingerprint=fingerprint;pending.gcGaragePreTripEventId=eventId;state.pendingJourney=pending;if(!gcAgendaIsDone(eventId))showToast('Lembrete de inspeção pré-operacional registrado na Agenda. Ele não interrompe a viagem; para parar o ônibus, encaminhe-o à Mecânica e abra uma ordem de serviço.');}gcGarageOriginalValidatorOpen(pending);};
const gcGarageOriginalActivateOperation=gcActivateOperation;
gcActivateOperation=function(op){if(op?.company&&op?.prefix){const vehicle={company:opVehicleCompany(op),prefix:op.prefix,model:op.busModel,chassis:op.chassis};const current=gcGarageCurrentVehicle(vehicle);if(current?.blocked){showToast(`Partida bloqueada: prefixo ${op.prefix} está retido pela oficina (${current.blockedReason||'pane pendente'}).`);gcGarageOpen();gcGarageSetTab('alerts');return false;}const workshopOrder=gcGarageOrders().find(x=>x.vehicleKey===gcGarageKey(vehicle)&&!['Aprovada','Cancelada'].includes(x.status));if(workshopOrder){showToast(`Partida bloqueada: prefixo ${op.prefix} está na oficina pela OS ${workshopOrder.number}. Aprove o serviço antes de iniciar outra operação.`);gcGarageOpen();gcGarageSetTab('orders');return false;}op.garagePreTripEventId=gcGaragePreTripEvent(vehicle,op.line,'visualizador',`${op.id}-daily-${dateTodayLocal()}`);}return gcGarageOriginalActivateOperation(op);};
const gcGarageOriginalSyncOperation=syncOneOperationProgress;
syncOneOperationProgress=function(op,now=Date.now()){
 if(op?.prefix){const current=gcGarageCurrentVehicle({company:opVehicleCompany(op),prefix:op.prefix});if(current?.blocked&&['operando','operando com desvio','initializing'].includes(op.status)){freezeOperationClock(op);op.status='fora de operação';op.lastEvent=`RETIDO PELA OFICINA · ${current.blockedReason||'pane mecânica não resolvida'}`;return true;}}
 const before=Number(op?.garageProcessedTrips??op?.completedTrips??0);const changed=gcGarageOriginalSyncOperation(op,now);const after=Number(op?.completedTrips)||0;
 if(after>before){const entries=(op.tripLog||[]).filter(t=>Number(t.tripNumber)>before&&Number(t.tripNumber)<=after).sort((a,b)=>Number(a.tripNumber)-Number(b.tripNumber)).slice(0,Math.min(500,after-before));for(let i=0;i<entries.length;i++){const trip=entries[i]||{},km=Math.max(5,Number(op.distanceKm||op.routeKm||trip.distanceKm)||35),vehicle={company:trip.vehicleCompany||opVehicleCompany(op),prefix:trip.prefix||op.prefix,model:trip.busModel||op.busModel,chassis:trip.chassis||op.chassis};gcGarageApplyWear(vehicle,km);const activeVehicleKey=gcGarageKey({company:opVehicleCompany(op),prefix:op.prefix});if(!op.breakdownId&&gcGarageKey(vehicle)===activeVehicleKey)gcGarageMaybeBreakdown(op,km,vehicle);}op.garageProcessedTrips=after;
  if(!['fora de operação','parada técnica','pausada','aguardando substituição no terminal'].includes(op.status))op.garagePreTripEventId=gcGaragePreTripEvent({company:opVehicleCompany(op),prefix:op.prefix,model:op.busModel,chassis:op.chassis},op.line,'visualizador',`${op.id}-daily-${dateTodayLocal()}`);
  return true;
 }
 if(!Number.isFinite(Number(op.garageProcessedTrips)))op.garageProcessedTrips=after;return changed;
};
function gcGarageApplyWear(vehicle,km){
 const s=gcGarageCurrentVehicle(vehicle);if(!s)return;
 const safeKm=Math.max(0,Number(km)||0),now=Date.now(),last=Date.parse(s.lastWearAt||'')||now,elapsedDays=Math.max(0,(now-last)/86400000);
 gcGarageComponentList(s).forEach(c=>{
  let wear=0;
  if(c.key==='battery')wear=100*elapsedDays/Math.max(1,Number(c.life)||1100);
  else if(c.key==='lighting')wear=100*elapsedDays/Math.max(1,(Number(c.life)||8)*365);
  else wear=100*safeKm/Math.max(1,Number(c.life)||100000);
  s.components[c.key]=gcGarageClamp(Number(s.components[c.key]||0)-wear);
 });
 if(s.km!==null&&s.km!==undefined)s.km+=safeKm;else{s.estimatedKm=(Number(s.estimatedKm)||0)+safeKm;s.kmEstimated=true;}
 s.condition=gcGarageCondition(s);s.lastWearAt=new Date(now).toISOString();
 const all=gcGarageState();all[s.key]=s;gcGarageWrite(GC_GARAGE_STATE_KEY,all);
 // Só publica no hodômetro da Agenda quando a leitura de partida já era real.
 if(s.km!==null&&s.km!==undefined&&Number.isFinite(Number(s.km))){
  const profiles=gcAgendaReadProfiles();const profile=profiles[s.key]||{key:s.key,company:s.company,prefix:s.prefix,model:s.model,lastOilAtKm:null,lastPreventiveAtKm:null,lastTireAtKm:null};
  profile.currentKm=Number(s.km);profile.odoDate=dateTodayLocal();profile.updatedAt=new Date(now).toISOString();profiles[s.key]=profile;gcWriteObject(GC_AGENDA_PROFILES_KEY,profiles);
 }
 if($('#gcGaragePanel')&&!$('#gcGaragePanel').hidden)gcGarageRenderFleet();
}
function gcGarageMaybeBreakdown(op,km,vehicleOverride=null){const failedVehicle=vehicleOverride||{company:opVehicleCompany(op),prefix:op.prefix,model:op.busModel,chassis:op.chassis};const s=gcGarageCurrentVehicle(failedVehicle);if(!s)return;const list=gcGarageComponentList(s),critical=list.filter(c=>c.critical&&gcGarageComponentHealth(s,c.key)<24);const avgHealth=gcGarageCondition(s),factor=1+Math.max(0,70-avgHealth)/28,prob=Math.min(.075,(km/100)*.00025*factor+critical.length*.0012);if(Math.random()>=prob)return;const weak=critical.sort((a,b)=>gcGarageComponentHealth(s,a.key)-gcGarageComponentHealth(s,b.key))[0]||list.sort((a,b)=>gcGarageComponentHealth(s,a.key)-gcGarageComponentHealth(s,b.key))[0],reason=weak?`Falha provável em ${weak.name.toLocaleLowerCase('pt-BR')} (${gcGaragePercent(gcGarageComponentHealth(s,weak.key))} de vida estimada)`:'Falha mecânica não localizada';s.blocked=true;s.blockedReason=reason;const all=gcGarageState();all[s.key]=s;gcGarageWrite(GC_GARAGE_STATE_KEY,all);freezeOperationClock(op);op.status='fora de operação';op.breakdownId=makeId();op.lastEvent=`PANE MECÂNICA · ${reason}`;const alerts=gcGarageAlerts();alerts.push({id:op.breakdownId,operationId:op.id,vehicleKey:s.key,company:failedVehicle.company,prefix:String(failedVehicle.prefix),model:failedVehicle.model||op.busModel,reason,componentKey:weak?.key||'',createdAt:new Date().toISOString(),resolvedAt:''});gcGarageWrite(GC_GARAGE_ALERTS_KEY,alerts);writeArrayKey(OPERATION_KEY,ownerOperations().map(x=>x.id===op.id?op:x));gcGarageRenderHomeAlert();showToast(`Pane mecânica no prefixo ${failedVehicle.prefix}. A operação foi interrompida e o alerta está fixado no menu principal.`);}
function gcGarageServiceForFault(key){const map={engineOil:'Troca de óleo e filtros',oilFilter:'Troca de óleo e filtros',fuelFilter:'Troca de óleo e filtros',airFilter:'Troca de óleo e filtros',brakeLining:'Sistema de freios',brakeDrum:'Sistema de freios',airCompressor:'Sistema de freios',airDryer:'Sistema de freios',brakeChambers:'Sistema de freios',frontTires:'Pneus e rodas',rearTires:'Pneus e rodas',wheels:'Pneus e rodas',wheelBearings:'Pneus e rodas',shocks:'Suspensão e direção',bushings:'Suspensão e direção',steering:'Suspensão e direção',suspension:'Suspensão e direção',injectors:'Motor e injeção',turbocharger:'Motor e injeção',belts:'Motor e injeção',clutch:'Transmissão e diferencial',gearbox:'Transmissão e diferencial',differential:'Transmissão e diferencial',driveshaft:'Transmissão e diferencial',radiator:'Arrefecimento',waterPump:'Arrefecimento',hoses:'Arrefecimento',battery:'Sistema elétrico',alternator:'Sistema elétrico',starter:'Sistema elétrico',lighting:'Sistema elétrico',arla32:'SCR / ARLA 32',scrPump:'SCR / ARLA 32',scrInjector:'SCR / ARLA 32',noxSensor:'SCR / ARLA 32',scrCatalyst:'SCR / ARLA 32'};return map[key]||'Inspeção geral';}
function gcGarageHandleBreakdownSend(id){const a=gcGarageAlerts().find(x=>x.id===id);if(!a)return;const rows=gcGarageOrders();const existing=rows.find(x=>x.breakdownId===id&&!['Aprovada','Cancelada'].includes(x.status));if(existing){gcGarageOpen();gcGarageSetTab('orders');showToast(`A ocorrência já está vinculada à OS ${existing.number}.`);return;}gcGarageOpenRepair(a.vehicleKey,gcGarageServiceForFault(a.componentKey),'',`Pane: ${a.reason}`);$('#gcGarageRepairAgendaId').value='';$('#gcGarageRepairNotes').value=`Pane: ${a.reason}`;$('#gcGarageRepairPriority').value='Urgente';gcGarageUpdateSecondMechanicVisibility();gcGarageUpdateServiceEstimate();}
function gcGarageHandleBreakdownSwap(id){const a=gcGarageAlerts().find(x=>x.id===id);if(!a)return;const el=$(`[data-gc-breakdown-select="${CSS.escape(id)}"]`),key=el?.value?decodeURIComponent(el.value):'';if(!key){showToast('Escolha um ônibus substituto disponível.');return;}const replacement=gcGarageVehicles().find(v=>gcGarageKey(v)===key),op=ownerOperations().find(x=>x.id===a.operationId);if(!replacement||!op)return;const replacementState=gcGarageCurrentVehicle(replacement),busy=ownerOperations().some(x=>x.id!==op.id&&!['fora de operação','parada técnica','pausada'].includes(x.status)&&gcGarageKey({company:x.company,prefix:x.prefix})===key);if(replacementState?.blocked||gcGarageAlerts().some(x=>!x.resolvedAt&&x.vehicleKey===key)||gcGarageOrders().some(x=>x.vehicleKey===key&&!['Aprovada','Cancelada'].includes(x.status))){showToast('O ônibus substituto também possui uma retenção mecânica ou ordem de serviço pendente. Escolha outra unidade.');return;}if(busy){showToast('Este prefixo já está em operação.');return;}op.vehicleCompany=replacement.company;op.busModel=replacement.model;op.prefix=String(replacement.prefix);op.status='operando';op.clockAnchorAt=Date.now();op.breakdownId='';op.garagePreTripEventId=gcGaragePreTripEvent(replacement,op.line,'substituição',`${op.id}-swap-${makeId()}`);op.lastEvent=`Ônibus substituído: ${replacement.model} · prefixo ${replacement.prefix}. Inspeção pré-operacional pendente.`;writeArrayKey(OPERATION_KEY,ownerOperations().map(x=>x.id===op.id?op:x));const alerts=gcGarageAlerts();const ix=alerts.findIndex(x=>x.id===id);if(ix>=0){alerts[ix].resolvedAt=new Date().toISOString();alerts[ix].resolution=`Substituído por ${replacement.prefix}`;gcGarageWrite(GC_GARAGE_ALERTS_KEY,alerts);}renderOperations();gcGarageRender();showToast(`Operação transferida para o prefixo ${replacement.prefix}. A inspeção pré-operacional da unidade substituta é obrigatória.`);}

function gcPartsVehicleFamily(v){const t=norm(`${v?.model||''} ${v?.chassis||''}`);if(/articulad|biarticulad/.test(t))return'articulado';if(/micro|volare|lo-916|lo-915|senior|fly/.test(t))return'micro';if(/rodovi|paradiso|viaggio|irizar|double.?decker|invictus|ideale/.test(t))return'rodoviario';if(/midi|midibus|gran micro/.test(t))return'midibus';return'urbano';}
const GC_PART_QUALITY=[{id:'original',name:'Original / genuína',factor:1.65},{id:'oem',name:'OEM / fornecedora de montagem',factor:1.28},{id:'premium',name:'Reposição premium',factor:1},{id:'economy',name:'Reposição econômica',factor:.72}];
const GC_PART_FAMILIES=[{id:'urbano',name:'Ônibus urbano pesado',factor:1},{id:'rodoviario',name:'Ônibus rodoviário',factor:1.12},{id:'micro',name:'Micro-ônibus',factor:.74},{id:'articulado',name:'Articulado / biarticulado',factor:1.65},{id:'midibus',name:'Midi / ônibus médio',factor:.88},{id:'universal',name:'Aplicação universal',factor:1}];
const GC_PART_BRANDS=['Bosch','Mann-Filter','Mahle','Knorr-Bremse','WABCO / ZF','Continental','Fras-le','Meritor','Gates'];
const GC_PART_BASE=[...GC_GARAGE_COMPONENTS.map(c=>({key:c.key,name:c.name,category:c.category,base:c.base,health:true})),...GC_EXTRA_PARTS];
let gcPartsCatalogCache=null,gcPartsCurrentQuality='premium';
function gcPartsCatalog(){
 if(gcPartsCatalogCache)return gcPartsCatalogCache;
 const rows=[],supplierStock=gcGarageRead(GC_GARAGE_SUPPLIER_STOCK_KEY,{});let stockChanged=false;
 GC_PART_BASE.forEach((p,pi)=>{
  GC_PART_FAMILIES.forEach(f=>{
   GC_PART_QUALITY.forEach(q=>{
    GC_PART_BRANDS.forEach((brand,bi)=>{
     const ref=`GC-${String(pi+1).padStart(2,'0')}-${f.id.toUpperCase().slice(0,3)}-${q.id.toUpperCase().slice(0,3)}-${String(bi+1).padStart(2,'0')}`;
     const promo=(gcGarageHash(ref)%11===0);
     const price=Math.round(p.base*f.factor*q.factor*(1+(bi%4)*.035)*(promo?.88:1)*100)/100;
     if(!Object.prototype.hasOwnProperty.call(supplierStock,ref)){supplierStock[ref]=gcGarageHash(ref+'|estoque')%7;stockChanged=true;}
     rows.push({id:ref,key:p.key,name:p.name,category:p.category,family:f.id,familyName:f.name,quality:q.id,qualityName:q.name,brand,price,promotion:promo,ref,base:p.base,stockQty:Number(supplierStock[ref])||0});
    });
   });
  });
 });
 if(stockChanged)gcGarageWrite(GC_GARAGE_SUPPLIER_STOCK_KEY,supplierStock);
 gcPartsCatalogCache=rows;
 return rows;
}
function gcPartsOrder(){const id=$('#gcPartsOrderSelect')?.value;return gcGarageOrders().find(x=>x.id===id)||null;}
function gcPartsPopulate(){const cat=$('#gcPartsCategory');if(cat&&cat.options.length<=1){[...new Set(GC_PART_BASE.map(x=>x.category))].sort().forEach(c=>cat.add(new Option(c,c)));}const order=$('#gcPartsOrderSelect');if(order){const old=order.value;const rows=gcGarageOrders().filter(x=>!['Aprovada','Cancelada'].includes(x.status));order.innerHTML='<option value="">Compra para estoque geral</option>'+rows.map(o=>`<option value="${escapeHtml(o.id)}">OS ${escapeHtml(o.number)} · ${escapeHtml(o.prefix)} · ${escapeHtml(o.service)}</option>`).join('');if(rows.some(x=>x.id===old))order.value=old;}$('#gcPartsSummary').innerHTML=[['SKUs simulados',gcPartsCatalog().length.toLocaleString('pt-BR')],['Itens no estoque',gcGarageRead(GC_GARAGE_PARTS_STOCK_KEY,[]).reduce((a,x)=>a+Number(x.quantity||0),0)],['Compras em trânsito',gcGarageRead(GC_GARAGE_PARTS_PURCHASE_KEY,[]).filter(x=>!x.receivedAt).length]].map(([l,n])=>`<div class="gc-phone-kpi"><span>${escapeHtml(l)}</span><strong>${escapeHtml(String(n))}</strong></div>`).join('');}
function gcPartsRenderNeeds(){
 const box=$('#gcPartsNeedsList');if(!box)return;const o=gcPartsOrder();
 if(!o){box.innerHTML='<p class="gc-small-note">Selecione uma OS acima para ver os itens que a oficina solicitou. As compras para estoque geral também ficam disponíveis no catálogo abaixo.</p>';return;}
 box.innerHTML=o.parts.length?o.parts.map(p=>{
  const family=gcPartsVehicleFamily({model:o.model,chassis:o.chassis}),baseSku=gcPartsCatalog().find(x=>x.key===p.key&&x.family===family&&x.quality==='premium')||gcPartsCatalog().find(x=>x.key===p.key&&x.quality==='premium'),id=baseSku?.id||'',qty=Number(p.quantity)||1,available=baseSku?.stockQty||0;
  const immediate=available>=qty;
  return `<article class="gc-parts-need"><div><strong>${escapeHtml(p.name)} × ${qty}</strong><small>${p.status==='received'?'Peça recebida na garagem':p.status==='ordered'?`Entrega prevista ${escapeHtml(new Date(p.arrivesAt).toLocaleString('pt-BR'))}`:'Aguardando compra'}${p.price?` · ${money(p.price)} · ${escapeHtml(p.quality||'')}`:''}</small></div>${p.status==='pending'?`<div class="gc-parts-buy-controls"><label class="gc-field"><span>Qualidade</span><select data-parts-quality="${escapeHtml(p.key)}"><option value="original">Original/genuína</option><option value="oem">OEM</option><option value="premium" selected>Premium</option><option value="economy">Econômica</option></select></label><label class="gc-field"><span>Entrega</span><select data-parts-delivery="${escapeHtml(p.key)}"><option value="stock" ${immediate?'':'disabled'}>${immediate?`Retirada imediata · estoque ${available}`:'Sem estoque para retirada imediata'}</option><option value="1">Expressa · até 24 horas</option><option value="3">2–4 dias úteis</option><option value="6">5–8 dias úteis</option></select></label><button type="button" class="gc-primary-action" data-parts-buy-need="${escapeHtml(p.key)}" data-parts-product="${escapeHtml(id)}">Comprar ${qty} unidade(s) para esta OS</button></div>`:`<span class="gc-garage-status-pill ${p.status==='received'?'good':'attention'}">${p.status==='received'?'Recebida':'Em trânsito'}</span>`}</article>`;
 }).join(''):'<p class="gc-small-note">Esta ordem não exige peças de reposição.</p>';
}
function gcPartsRenderResults(){
 const list=$('#gcPartsResults');if(!list)return;const q=norm($('#gcPartsSearch')?.value||''),cat=$('#gcPartsCategory')?.value||'',family=$('#gcPartsFamily')?.value||'';
 let rows=gcPartsCatalog().filter(p=>(!q||norm(`${p.name} ${p.brand} ${p.ref} ${p.category}`).includes(q))&&(!cat||p.category===cat)&&(!family||p.family===family));
 const order=gcPartsOrder();if(order)rows=rows.filter(p=>!order.parts.length||order.parts.some(n=>n.key===p.key&&n.status==='pending'));
 $('#gcPartsResults').innerHTML=`<div class="gc-parts-results-heading"><strong>${rows.length.toLocaleString('pt-BR')} produto(s) encontrado(s)</strong><small>Referências sintéticas para simulação; confirme compatibilidade e código genuíno antes de comprar na vida real.</small></div>`+(rows.length?rows.slice(0,48).map(p=>{
  const need=order?.parts.find(n=>n.key===p.key&&n.status==='pending'),quantity=Number(need?.quantity)||1,total=p.price*quantity;
  return `<article class="gc-part-product"><div class="gc-part-product-main"><span class="gc-part-category">${escapeHtml(p.category)} · ${escapeHtml(p.familyName)}</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.brand)} · ${escapeHtml(p.qualityName)} · Ref. simulada ${escapeHtml(p.ref)} · Estoque fornecedor: ${p.stockQty} un.</small>${p.promotion?'<span class="gc-part-promo">Oferta simulada · 12% OFF</span>':''}</div><div class="gc-part-product-buy"><strong>${money(total)}</strong>${quantity>1?`<small>${quantity} × ${money(p.price)} / un.</small>`:''}<label class="gc-field"><span>Prazo</span><select data-part-delivery="${escapeHtml(p.id)}"><option value="stock" ${p.stockQty>=quantity?'':'disabled'}>${p.stockQty>=quantity?'Retirada imediata':'Sem estoque imediato'}</option><option value="1">Expressa · até 24 h</option><option value="3">2–4 dias úteis</option><option value="6">5–8 dias úteis</option></select></label><button type="button" class="gc-primary-action" data-part-buy="${escapeHtml(p.id)}">Comprar ${quantity>1?`${quantity} un.`:''}</button></div></article>`;
 }).join(''):'<p class="gc-small-note">Nenhuma peça corresponde aos filtros. Tente outro termo ou categoria.</p>');
}
function gcPartsRender(){if(!$('#gcPhonePartsView'))return;gcPartsPopulate();gcPartsRenderNeeds();gcPartsRenderResults();}
function gcPartsPurchase(productId,delivery,needKey=''){
 if(!assertOwner())return;const p=gcPartsCatalog().find(x=>x.id===productId);if(!p)return;
 const selectedOrder=gcPartsOrder(),need=selectedOrder&&needKey?selectedOrder.parts.find(x=>x.key===needKey&&x.status==='pending'):null;
 if(selectedOrder&&needKey&&!need){showToast('Esta necessidade já foi comprada ou recebida.');return;}
 const quantity=Math.max(1,Number(need?.quantity)||1),price=Math.round(p.price*quantity*100)/100;
 if(delivery==='stock'&&Number(p.stockQty||0)<quantity){showToast(`Estoque imediato insuficiente: fornecedor tem ${p.stockQty||0} unidade(s), mas a OS precisa de ${quantity}. Escolha uma entrega.`);return;}
 if(price>cashBreakdown().balance+0.005){showToast(`Saldo insuficiente no Caixa. O pedido custa ${money(price)}; disponível ${money(cashBreakdown().balance)}.`);return;}
 const purchaseId=makeId(),days=delivery==='stock'?0:Math.max(1,Number(delivery)||1),arrival=days?gcGarageAddBusinessDays(new Date(),days).toISOString():new Date().toISOString();
 const row={id:`garage-parts-${purchaseId}`,date:dateTodayLocal(),direction:'out',category:'Compra de peças para oficina',amount:price,description:`${quantity} × ${p.name} · ${p.brand} · ${p.qualityName} · ${p.ref}${need?` · OS ${selectedOrder.number}`:' · estoque'}`,source:'garage-parts',auto:true,createdAt:new Date().toISOString()};
 if(!writeArrayKey(CASH_LEDGER_KEY,[...cashLedger(),row]))return;
 if(delivery==='stock'){const supplierStock=gcGarageRead(GC_GARAGE_SUPPLIER_STOCK_KEY,{});supplierStock[p.id]=Math.max(0,(Number(supplierStock[p.id])||0)-quantity);gcGarageWrite(GC_GARAGE_SUPPLIER_STOCK_KEY,supplierStock);p.stockQty=supplierStock[p.id];}
 const purchases=gcGarageRead(GC_GARAGE_PARTS_PURCHASE_KEY,[]);purchases.push({id:purchaseId,product:p,orderId:need?selectedOrder.id:'',needKey:need?.key||p.key,quantity,price,unitPrice:p.price,delivery,arrivesAt:arrival,receivedAt:days?null:new Date().toISOString()});gcGarageWrite(GC_GARAGE_PARTS_PURCHASE_KEY,purchases);
 if(need){const orders=gcGarageOrders(),target=orders.find(x=>x.id===selectedOrder.id),targetNeed=target?.parts.find(x=>x.key===needKey&&x.status==='pending');if(targetNeed){targetNeed.status=days?'ordered':'received';targetNeed.purchaseId=purchaseId;targetNeed.arrivesAt=arrival;targetNeed.price=price;targetNeed.quality=p.qualityName;targetNeed.productId=p.id;target.partsCost=(Number(target.partsCost)||0)+price;if(targetNeed.status==='received')gcGarageStartOrder(target);gcGarageWrite(GC_GARAGE_ORDERS_KEY,orders);}}
 else{const stock=gcGarageRead(GC_GARAGE_PARTS_STOCK_KEY,[]);stock.push({id:makeId(),productId:p.id,key:p.key,name:p.name,quantity,quality:p.qualityName,price,receivedAt:arrival});gcGarageWrite(GC_GARAGE_PARTS_STOCK_KEY,stock);}
 gcPartsRender();gcGarageRenderOrders();renderCashDashboard();showToast(days?`Compra registrada para ${quantity} unidade(s). Entrega estimada ${new Date(arrival).toLocaleString('pt-BR')}.`:'Peça retirada e vinculada ao pedido.');
}
function gcPartsProcessDeliveries(){const purchases=gcGarageRead(GC_GARAGE_PARTS_PURCHASE_KEY,[]),orders=gcGarageOrders(),now=Date.now();let changed=false;purchases.forEach(p=>{if(p.receivedAt||new Date(p.arrivesAt).getTime()>now)return;p.receivedAt=new Date(now).toISOString();changed=true;if(p.orderId){const o=orders.find(x=>x.id===p.orderId),need=o?.parts.find(x=>x.key===p.needKey&&x.purchaseId===p.id);if(need){need.status='received';gcGarageStartOrder(o);}}else{const stock=gcGarageRead(GC_GARAGE_PARTS_STOCK_KEY,[]);stock.push({id:makeId(),productId:p.product.id,key:p.product.key,name:p.product.name,quantity:p.quantity,quality:p.product.qualityName,price:p.price,receivedAt:p.receivedAt});gcGarageWrite(GC_GARAGE_PARTS_STOCK_KEY,stock);}});if(changed){gcGarageWrite(GC_GARAGE_PARTS_PURCHASE_KEY,purchases);gcGarageWrite(GC_GARAGE_ORDERS_KEY,orders);gcGarageRenderOrders();if($('#gcPhonePartsView')&&!$('#gcPhonePartsView').hidden)gcPartsRender();}}

let gcTeamCandidatePage={mechanic:0,driver:0};let gcTeamCandidateOrder={mechanic:[],driver:[]};
function gcTeamShuffleCandidates(role){const pool=GC_GARAGE_STAFF_CANDIDATES.filter(x=>x.role===role);const ids=pool.map(x=>x.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}gcTeamCandidateOrder[role]=ids;gcTeamCandidatePage[role]=0;}
function gcTeamMoveCandidatePage(delta){const role=gcTeamActiveRole;if(!['mechanic','driver'].includes(role))return;const perPage=window.matchMedia('(max-width: 700px)').matches?25:50,total=GC_GARAGE_STAFF_CANDIDATES.filter(x=>x.role===role).length,max=Math.max(0,Math.ceil(total/perPage)-1);gcTeamCandidatePage[role]=Math.max(0,Math.min(max,(gcTeamCandidatePage[role]||0)+delta));gcGarageRenderTeam();}
function gcGarageRenderTeam(){if(!$('#gcTeamCandidateList'))return;const hired=gcGarageStaff(),role=gcTeamActiveRole||'mechanic';$('#gcPhoneTeamSummary').innerHTML=[['Mecânicos',hired.filter(x=>x.role==='mechanic'&&x.active!==false).length],['Motoristas',hired.filter(x=>x.role==='driver'&&x.active!==false).length],['Folha mensal estimada',money(hired.filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.salary||0),0))]].map(([l,n])=>`<div class="gc-phone-kpi"><span>${escapeHtml(l)}</span><strong>${escapeHtml(String(n))}</strong></div>`).join('');const list=$('#gcTeamCandidateList');$('#gcTeamCandidateControls').hidden=role==='hired';$('#gcTeamHiredList').hidden=role!=='hired';list.hidden=role==='hired';$$('[data-team-role]').forEach(b=>b.classList.toggle('active',b.dataset.teamRole===role));if(role==='hired'){$('#gcTeamHiredList').innerHTML=hired.length?hired.map(x=>`<article class="gc-team-card"><div><span class="gc-team-role">${x.role==='mechanic'?'MECÂNICO':x.role==='driver'?'MOTORISTA':String(x.roleLabel||'EQUIPE').toUpperCase()} · ${escapeHtml(x.company||'Grupo Conect')}</span><h4>${escapeHtml(x.name)}</h4><p>${escapeHtml(x.specialty||x.courses||'Profissional contratado')}</p><small>${x.role==='mechanic'?`Nível ${x.level} · ${x.years} anos de experiência`:x.role==='driver'?`${escapeHtml(x.license||'CNH a confirmar')} · ${x.years} anos de experiência`:`${x.years||0} anos de experiência · ${escapeHtml(x.courses||'Qualificação não informada')}`}</small></div><div class="gc-team-card-bottom"><strong>${money(x.salary)}/mês</strong><button class="gc-secondary-action" type="button" data-team-fire="${escapeHtml(x.id)}">Desligar</button></div></article>`).join(''):'<p class="gc-small-note">Nenhum profissional contratado até o momento.</p>';return;}const candidates=GC_GARAGE_STAFF_CANDIDATES.filter(x=>x.role===role);if(gcTeamCandidateOrder[role].length!==candidates.length)gcTeamShuffleCandidates(role);const perPage=window.matchMedia('(max-width: 700px)').matches?25:50,maxPage=Math.max(0,Math.ceil(candidates.length/perPage)-1);gcTeamCandidatePage[role]=Math.min(gcTeamCandidatePage[role]||0,maxPage);const ordered=gcTeamCandidateOrder[role].map(id=>candidates.find(x=>x.id===id)).filter(Boolean),visible=ordered.slice(gcTeamCandidatePage[role]*perPage,(gcTeamCandidatePage[role]+1)*perPage);list.innerHTML=visible.map(x=>{const isHired=hired.some(y=>y.candidateId===x.id&&y.active!==false);return `<article class="gc-team-card"><div><span class="gc-team-role">${role==='mechanic'?`MECÂNICO · NÍVEL ${x.level}`:'MOTORISTA · CNH '+x.license}</span><h4>${escapeHtml(x.name)}</h4><p>${escapeHtml(x.specialty)}</p><small>${x.years} anos de experiência · ${escapeHtml(x.education)}</small><small>Qualificações: ${escapeHtml(x.courses)}</small><small>Base: ${escapeHtml(x.city)}</small></div><div class="gc-team-card-bottom"><span><strong>${money(x.salary)}/mês</strong><small>${escapeHtml(x.benefits)}</small></span><label class="gc-field"><span>Empresa</span><select data-staff-company="${escapeHtml(x.id)}">${GROUP_COMPANIES.map(c=>`<option>${escapeHtml(c)}</option>`).join('')}</select></label><button class="gc-primary-action" type="button" data-team-hire="${escapeHtml(x.id)}" ${isHired?'disabled':''}>${isHired?'Já contratado':'Contratar profissional'}</button></div></article>`;}).join('');const controls=$('#gcTeamCandidateControls');if(controls){controls.hidden=false;const from=gcTeamCandidatePage[role]*perPage+1,to=Math.min((gcTeamCandidatePage[role]+1)*perPage,candidates.length);controls.innerHTML=`<div class="gc-team-page-summary">Exibindo <strong>${from}–${to}</strong> de <strong>${candidates.length}</strong> ${role==='mechanic'?'mecânicos':'motoristas'} fictícios</div><div class="gc-team-page-actions"><button type="button" class="gc-secondary-action" data-team-page="prev" ${gcTeamCandidatePage[role]===0?'disabled':''}>← Anterior</button><span>Página ${gcTeamCandidatePage[role]+1} de ${maxPage+1}</span><button type="button" class="gc-secondary-action" data-team-page="next" ${gcTeamCandidatePage[role]>=maxPage?'disabled':''}>Próxima →</button></div><button type="button" class="gc-primary-action gc-team-refresh" data-team-refresh="${role}">↻ Atualizar candidatos</button>`;}$$('[data-team-role]').forEach(b=>{if(b.dataset.teamRole==='mechanic')b.textContent=`Mecânicos (${GC_GARAGE_STAFF_CANDIDATES.filter(x=>x.role==='mechanic').length})`;if(b.dataset.teamRole==='driver')b.textContent=`Motoristas (${GC_GARAGE_STAFF_CANDIDATES.filter(x=>x.role==='driver').length})`;});}
let gcTeamActiveRole='mechanic';
function gcGarageHireStaff(id){const c=GC_GARAGE_STAFF_CANDIDATES.find(x=>x.id===id);if(!c)return;const rows=gcGarageStaff();if(rows.some(x=>x.candidateId===id&&x.active!==false)){showToast('Este profissional já está contratado.');return;}const company=$(`[data-staff-company="${CSS.escape(id)}"]`)?.value||GROUP_COMPANIES[0];const row={...c,id:`hired-${id}-${makeId()}`,candidateId:id,company,active:true,hiredAt:new Date().toISOString()};rows.push(row);if(!gcGarageWrite(GC_GARAGE_STAFF_KEY,rows))return;gcGarageRenderTeam();gcGaragePopulateMechanics();if(c.role==='driver'){refreshOperationChoices();refreshNormalTripDrivers();}if(typeof gcBankRefreshEmployees==='function')gcBankRefreshEmployees();showToast(`${c.name} contratado(a) para ${company}.`);}

// Complemento de RH: cadastro de cargos administrativos e de apoio, sem misturar esses cargos às escalas de condução ou à mecânica.
const gcGarageRenderTeamBase=gcGarageRenderTeam;
gcGarageRenderTeam=function(){
 const role=gcTeamActiveRole||'mechanic',form=$('#gcTeamOtherForm');
 if(role!=='other'){
  if(form)form.hidden=true;
  gcGarageRenderTeamBase();
  return;
 }
 const hired=gcGarageStaff(),active=hired.filter(x=>x.active!==false);
 $('#gcPhoneTeamSummary').innerHTML=[['Mecânicos',active.filter(x=>x.role==='mechanic').length],['Motoristas',active.filter(x=>x.role==='driver').length],['Outros cargos',active.filter(x=>x.role==='other').length],['Folha mensal estimada',money(active.reduce((sum,x)=>sum+Number(x.salary||0),0))]].map(([label,value])=>`<div class="gc-phone-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');
 $('#gcTeamCandidateControls').hidden=true;$('#gcTeamCandidateList').hidden=true;$('#gcTeamHiredList').hidden=true;if(form)form.hidden=false;
 $$('[data-team-role]').forEach(button=>button.classList.toggle('active',button.dataset.teamRole==='other'));
};
(function gcTeamOtherInit(){
 const company=$('#gcTeamOtherCompany');
 if(company&&company.options.length===0)company.innerHTML=GROUP_COMPANIES.map(name=>`<option>${escapeHtml(name)}</option>`).join('');
 const form=$('#gcTeamOtherForm');
 form?.addEventListener('submit',event=>{
  event.preventDefault();if(!assertOwner())return;
  const name=$('#gcTeamOtherName').value.trim(),roleLabel=$('#gcTeamOtherRole').value,company=$('#gcTeamOtherCompany').value,salary=Number($('#gcTeamOtherSalary').value),years=Math.max(0,Math.min(60,Number($('#gcTeamOtherYears').value)||0)),benefits=$('#gcTeamOtherBenefits').value.trim(),courses=$('#gcTeamOtherCourses').value.trim();
  if(!name||!company||!Number.isFinite(salary)||salary<0){showToast('Informe nome, empresa e salário válido.');return;}
  const rows=gcGarageStaff();if(rows.some(row=>row.active!==false&&norm(row.name)===norm(name)&&norm(row.company||'Grupo Conect')===norm(company))){showToast('Já existe um colaborador ativo com esse nome nesta empresa.');return;}
  const row={id:`hired-other-${makeId()}`,candidateId:`manual-${makeId()}`,name,role:'other',roleLabel,company,salary,years,benefits,courses,specialty:roleLabel,education:'Cadastro manual do proprietário',active:true,hiredAt:new Date().toISOString()};
  rows.push(row);if(!gcGarageWrite(GC_GARAGE_STAFF_KEY,rows))return;
  form.reset();if(company)$('#gcTeamOtherCompany').value=company;$('#gcTeamOtherYears').value='0';gcGarageRenderTeam();if(typeof gcBankRefreshEmployees==='function')gcBankRefreshEmployees();showToast(`${name} cadastrado(a) como ${roleLabel}. O profissional já aparece na equipe e na folha simulada.`);
 });
})();

function gcGarageFireStaff(id){if(!window.confirm('Desligar este profissional? O histórico de ordens e viagens permanecerá salvo.'))return;gcGarageWrite(GC_GARAGE_STAFF_KEY,gcGarageStaff().map(x=>x.id===id?{...x,active:false,endedAt:new Date().toISOString()}:x));gcGarageRenderTeam();gcGaragePopulateMechanics();refreshOperationChoices();refreshNormalTripDrivers();showToast('Profissional desligado.');}
const gcOriginalDriverRoster=driverRoster;
driverRoster=function(company){const fixed=['Pablo','Kaio','Treinamento'];const hired=gcGarageStaff().filter(x=>x.role==='driver'&&x.active!==false&&(!x.company||norm(x.company)===norm(company))).map(x=>x.name);return [...new Set([...fixed,...hired])];};
const gcGarageOriginalPopulateShiftDrivers=populateShiftDrivers;
populateShiftDrivers=function(preserve=true){gcGarageOriginalPopulateShiftDrivers(preserve);const note=$('#ovDriverCountNote');if(note)note.textContent='Lista vinculada à aba Equipe: contrate ou desligue motoristas no aplicativo do celular.';};
function gcGarageRenderReports(){const rows=gcGarageHistory().slice().reverse(),q=norm($('#gcReportSearch')?.value||''),month=$('#gcReportMonth')?.value||'',filtered=rows.filter(x=>(!q||norm(`${x.company} ${x.prefix} ${x.model} ${x.service} ${x.mechanic}`).includes(q))&&(!month||String(x.date).startsWith(month)));const sum=filtered.reduce((s,x)=>s+Number(x.totalCost||0),0);if($('#gcWorkshopReportSummary'))$('#gcWorkshopReportSummary').innerHTML=[['Serviços concluídos',filtered.length],['Peças e insumos',money(filtered.reduce((s,x)=>s+Number(x.partsCost||0),0))],['Mão de obra',money(filtered.reduce((s,x)=>s+Number(x.laborCost||0),0))]].map(([l,n])=>`<div class="gc-phone-kpi"><span>${escapeHtml(l)}</span><strong>${escapeHtml(String(n))}</strong></div>`).join('');if($('#gcWorkshopReportList'))$('#gcWorkshopReportList').innerHTML=filtered.length?filtered.map(x=>`<article class="gc-workshop-report-card"><div><span class="gc-team-role">${escapeHtml(localDate(x.date))} · ${escapeHtml(x.company)}</span><h4>${escapeHtml(x.prefix)} · ${escapeHtml(x.model)}</h4><p>${escapeHtml(x.service)} · Mecânico(s): ${escapeHtml(x.mechanic)} (nível ${x.mechanicLevel})</p><small>${x.parts.length?x.parts.map(p=>`${p.name} × ${p.quantity} (${money(p.price)})`).join(' · '):'Sem peça substituída'}${x.notes?` · Observação: ${escapeHtml(x.notes)}`:''}</small></div><strong>${money(x.totalCost)}</strong></article>`).join(''):'<p class="gc-small-note">Nenhum serviço aprovado neste período.</p>';}
function gcGarageExportReport(){const rows=gcGarageHistory(),header=['Data','Empresa','Prefixo','Modelo','Chassi','Serviço','Mecânico','Nível','Garagem','Peças','Custo peças','Mão de obra','Total','Observação'],data=rows.map(x=>[x.date,x.company,x.prefix,x.model,x.chassis,x.service,x.mechanic,x.mechanicLevel,x.garage,x.parts.map(p=>`${p.name} x${p.quantity}`).join(' | '),x.partsCost,x.laborCost,x.totalCost,x.notes]);downloadTextFile('grupo-conect-relatorio-oficina.csv',[header,...data].map(r=>r.map(csvCell).join(';')).join('\n'),'text/csv;charset=utf-8');showToast('Relatório da oficina exportado em CSV.');}

function gcGarageHandleClick(event){const b=event.target.closest('button');if(!b)return;const d=b.dataset;if(d.gcGarageDetail){gcGarageRenderDetail(d.gcGarageDetail);$('#gcGarageDetail').scrollIntoView({behavior:'smooth',block:'nearest'});}else if(d.gcGarageRepair){gcGarageOpenRepair(d.gcGarageRepair);}else if(d.gcOrderApprove){gcGarageApproveOrder(d.gcOrderApprove);}else if(d.gcOrderReject){gcGarageRejectOrder(d.gcOrderReject);}else if(d.gcPartsForOrder){gcGarageOpenPhone('parts',d.gcPartsForOrder);}else if(d.gcBreakdownSend){gcGarageHandleBreakdownSend(d.gcBreakdownSend);}else if(d.gcBreakdownSwap){gcGarageHandleBreakdownSwap(d.gcBreakdownSwap);}}
$('#gcGarageOpenButton')?.addEventListener('click',gcGarageOpen);$('#gcGarageCloseButton')?.addEventListener('click',gcGarageClose);$('#gcGarageCancelRepair')?.addEventListener('click',()=>$('#gcGarageRepairBox').hidden=true);$('#gcGarageServiceForm')?.addEventListener('submit',gcGarageCreateOrder);$('#gcGarageRepairVehicle')?.addEventListener('change',()=>{const v=gcGarageVehicleFromSelect();$('#gcGarageRepairVehicleKey').value=v?gcGarageKey(v):'';gcGarageUpdateServiceEstimate();});$('#gcGarageRepairService')?.addEventListener('change',gcGarageUpdateServiceEstimate);$('#gcGarageRepairMechanic')?.addEventListener('change',()=>{gcGarageUpdateSecondMechanicVisibility();gcGarageUpdateServiceEstimate();});$('#gcGarageRepairMechanic2')?.addEventListener('change',gcGarageUpdateServiceEstimate);$('#gcGarageRepairPriority')?.addEventListener('change',()=>{gcGarageUpdateSecondMechanicVisibility();gcGarageUpdateServiceEstimate();});$('#gcGarageSearch')?.addEventListener('input',gcGarageRenderFleet);$('#gcGarageConditionFilter')?.addEventListener('change',gcGarageRenderFleet);$$('[data-garage-tab]').forEach(b=>b.addEventListener('click',()=>gcGarageSetTab(b.dataset.garageTab)));$('#gcGaragePanel')?.addEventListener('click',gcGarageHandleClick);$('#gcGarageNewServiceFromOrders')?.addEventListener('click',()=>gcGarageOpenRepair());$('#gcGarageBreakdownOpen')?.addEventListener('click',()=>{gcGarageOpen();gcGarageSetTab('alerts');});$('#gcGarageBreakdownAlert')?.addEventListener('click',gcGarageHandleClick);$('#gcGarageReadyOpen')?.addEventListener('click',()=>{gcGarageOpen();gcGarageSetTab('orders');});
$('#gcGarageDetail')?.addEventListener('click',event=>{if(event.target.id==='gcGarageCloseDetail')$('#gcGarageDetail').hidden=true;});$('#gcGarageDetail')?.addEventListener('submit',event=>{if(event.target.id!=='gcGarageVehicleInfoForm')return;event.preventDefault();const key=$('#gcGarageDetail').querySelector('[data-gc-garage-repair]')?.dataset.gcGarageRepair,year=Number($('#gcGarageInfoYear').value),km=Number($('#gcGarageInfoKm').value),usesScr=$('#gcGarageInfoScr')?.checked===true;if(!key||!Number.isInteger(year)||year<1990||year>2027||!Number.isFinite(km)||km<0){showToast('Informe ano e hodômetro real válidos.');return;}const all=gcGarageState(),s=all[key];if(!s)return;s.year=year;s.yearEstimated=false;s.km=km;s.estimatedKm=km;s.kmEstimated=false;s.scr=usesScr;if(usesScr){GC_GARAGE_COMPONENTS.filter(c=>c.scr).forEach(c=>{if(!Object.prototype.hasOwnProperty.call(s.components,c.key)){s.components[c.key]=Math.round(gcGarageClamp(88-(GC_GARAGE_YEAR_NOW-year)*1.25-(km/100000)*1.7));}});}else{GC_GARAGE_COMPONENTS.filter(c=>c.scr).forEach(c=>delete s.components[c.key]);}const profiles=gcAgendaReadProfiles(),v=gcGarageVehicles().find(x=>gcGarageKey(x)===key);if(v){const p=profiles[key]||{key,company:v.company,prefix:String(v.prefix),model:v.model,lastOilAtKm:km,lastPreventiveAtKm:km,lastTireAtKm:km};p.currentKm=km;p.odoDate=dateTodayLocal();profiles[key]=p;gcWriteObject(GC_AGENDA_PROFILES_KEY,profiles);}all[key]=s;gcGarageWrite(GC_GARAGE_STATE_KEY,all);gcGarageRenderFleet();gcGarageRenderDetail(key);gcAgendaRenderHomeAlert();showToast('Ano e hodômetro confirmados. A estimativa técnica foi recalibrada.');});
$('#gcAgendaDayEvents')?.addEventListener('click',event=>{const b=event.target.closest('[data-agenda-mech]');if(b)gcGarageOpenFromAgenda(b.dataset.agendaMech);});
$('#onlineServicePanel')?.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.teamHire)gcGarageHireStaff(b.dataset.teamHire);else if(b.dataset.teamRefresh){gcTeamShuffleCandidates(b.dataset.teamRefresh);gcGarageRenderTeam();showToast('Lista atualizada. Novos perfis foram exibidos a partir do banco de candidatos.');}else if(b.dataset.teamPage){gcTeamMoveCandidatePage(b.dataset.teamPage==='next'?1:-1);}else if(b.dataset.teamFire)gcGarageFireStaff(b.dataset.teamFire);else if(b.dataset.partBuy){const order=gcPartsOrder(),product=gcPartsCatalog().find(x=>x.id===b.dataset.partBuy),need=order?.parts.find(x=>x.key===product?.key&&x.status==='pending');gcPartsPurchase(b.dataset.partBuy,$(`[data-part-delivery="${CSS.escape(b.dataset.partBuy)}"]`)?.value||'stock',need?.key||'');}else if(b.dataset.partsBuyNeed){const o=gcPartsOrder(),need=o?.parts.find(p=>p.key===b.dataset.partsBuyNeed),quality=$(`[data-parts-quality="${CSS.escape(b.dataset.partsBuyNeed)}"]`)?.value||'premium',delivery=$(`[data-parts-delivery="${CSS.escape(b.dataset.partsBuyNeed)}"]`)?.value||'stock',family=gcPartsVehicleFamily({model:o?.model,chassis:o?.chassis}),sku=gcPartsCatalog().find(p=>p.key===b.dataset.partsBuyNeed&&p.family===family&&p.quality===quality)||gcPartsCatalog().find(p=>p.key===b.dataset.partsBuyNeed&&p.quality===quality);if(sku)gcPartsPurchase(sku.id,delivery,b.dataset.partsBuyNeed);} });
$$('[data-team-role]').forEach(b=>b.addEventListener('click',()=>{gcTeamActiveRole=b.dataset.teamRole;gcGarageRenderTeam();}));
$('#gcPartsSearch')?.addEventListener('input',gcPartsRenderResults);$('#gcPartsCategory')?.addEventListener('change',gcPartsRenderResults);$('#gcPartsFamily')?.addEventListener('change',gcPartsRenderResults);$('#gcPartsOrderSelect')?.addEventListener('change',()=>{gcPartsRenderNeeds();gcPartsRenderResults();});$('#gcReportSearch')?.addEventListener('input',gcGarageRenderReports);$('#gcReportMonth')?.addEventListener('change',gcGarageRenderReports);$('#gcReportExport')?.addEventListener('click',gcGarageExportReport);
const gcGarageOriginalOnlineShowTab=gcOnlineShowTab;
gcOnlineShowTab=function(tab){if(!['clients','agenda','tools','team','parts','reports'].includes(tab))tab='clients';if(!assertOwner())return;gcOnlineActiveTab=tab;const ids={clients:'onlineClientsView',agenda:'onlineAgendaView',tools:'onlineToolsView',team:'gcPhoneTeamView',parts:'gcPhonePartsView',reports:'gcPhoneReportsView'};Object.entries(ids).forEach(([name,id])=>{const el=$('#'+id);if(el)el.hidden=name!==tab;});$$('[data-online-tab]').forEach(b=>b.classList.toggle('active',b.dataset.onlineTab===tab));if(tab==='agenda')gcOnlineRenderAgenda();if(tab==='tools'){gcOnlineRenderDirectory();gcOnlineRenderMessagePreview();}if(tab==='team')gcGarageRenderTeam();if(tab==='parts'){gcPartsProcessDeliveries();gcPartsRender();}if(tab==='reports')gcGarageRenderReports();};
const gcGarageOriginalOpenFromAlert=gcAgendaOpenAlert;
gcAgendaOpenAlert=function(){gcGarageOriginalOpenFromAlert();};
const gcGarageOriginalActivateOwner=activateOwnerArea;
activateOwnerArea=function(){gcGarageOriginalActivateOwner();if(ownerAllowed()){gcGarageSyncVehicles();gcGarageRender();}};
const gcGarageOriginalWriteArray=writeArrayKey;
writeArrayKey=function(key,items){const ok=gcGarageOriginalWriteArray(key,items);if(ok&&[OWNER_FLEET_KEY,FINANCED_BUSES_KEY,ODOMETER_KEY].includes(key)){gcGarageSyncVehicles();if($('#gcGaragePanel')&&!$('#gcGaragePanel').hidden)gcGarageRenderFleet();}return ok;};
const gcGarageOriginalRenderOwnerFleet=renderOwnerFleet;
renderOwnerFleet=function(){gcGarageOriginalRenderOwnerFleet();if(typeof gcGarageSyncVehicles==='function')gcGarageSyncVehicles();};
const gcGarageOriginalOnlineStart=gcOnlineStartContractRun;
gcOnlineStartContractRun=function(id){const cur=gcOnlineCurrentState||gcOnlineLoadState(),c=cur.contracts.find(x=>x.id===id&&x.status==='accepted');if(c){const vehicle={company:c.company,prefix:c.prefix,model:c.model,chassis:c.chassis},s=gcGarageCurrentVehicle(vehicle);if(s?.blocked){showToast(`Partida bloqueada: prefixo ${c.prefix} está retido pela oficina (${s.blockedReason||'pane mecânica pendente'}).`);gcGarageOpen();gcGarageSetTab('alerts');return;}const workshopOrder=gcGarageOrders().find(x=>x.vehicleKey===gcGarageKey(vehicle)&&!['Aprovada','Cancelada'].includes(x.status));if(workshopOrder){showToast(`Partida bloqueada: prefixo ${c.prefix} está na oficina pela OS ${workshopOrder.number}. Aguarde a aprovação do serviço.`);gcGarageOpen();gcGarageSetTab('orders');return;}}gcGarageOriginalOnlineStart(id);};
function gcGarageInitialise(){gcGarageSyncVehicles();gcGaragePopulateVehicleSelect();gcGaragePopulateMechanics();gcPartsPopulate();try{refreshNormalTripDrivers();populateShiftDrivers(false);}catch(e){console.warn('Roster de motoristas:',e);}gcGarageProcess();gcGarageRenderHomeAlert();if($('#gcGaragePanel')&&!$('#gcGaragePanel').hidden)gcGarageRender();}
gcGarageInitialise();
setInterval(()=>{try{if(!ownerAllowed())return;gcPartsProcessDeliveries();gcGarageProcess();gcGarageRenderHomeAlert();}catch(e){console.warn('Garagem Grupo Conect:',e);}},15000);
/*
 * GPcntv9 — correção incremental do Visualizador de Operação.
 * Mantém os módulos existentes e corrige somente despacho de substituto
 * e interpretação das decisões de ocorrências.
 */
(function installOperationReliabilityPatch(){
  if (window.__gcOperationReliabilityPatchInstalled) return;
  window.__gcOperationReliabilityPatchInstalled = true;

  const gcSwapOriginalSyncOperation = syncOneOperationProgress;
  const gcSwapOriginalRenderOperations = renderOperations;

  function gcSwapTrafficScenario(){
    const n = Math.random();
    if (n < 0.18) return {label:'Livre', minutes:22};
    if (n < 0.78) return {label:'Moderado', minutes:25};
    if (n < 0.96) return {label:'Intenso', minutes:32};
    return {label:'Muito intenso', minutes:40};
  }

  function gcSwapFormatArrival(dispatch, now=Date.now()){
    const left = Math.max(0, Math.ceil((Number(dispatch.arrivesAtMs)-now)/1000));
    return opFormatCountdown(left);
  }

  function gcSwapCompletePreTrip(dispatch, now){
    const eventId = String(dispatch.preTripEventId || '');
    if (!eventId || typeof gcAgendaDoneMap !== 'function' || typeof gcWriteObject !== 'function') return;
    const done = gcAgendaDoneMap();
    if (!done[eventId]) {
      done[eventId] = new Date(now).toISOString();
      gcWriteObject(GC_AGENDA_DONE_KEY, done);
    }
  }

  function gcSwapHandleArrival(op, now){
    const dispatch = op.replacementDispatch;
    if (!dispatch) return false;
    const replacement = gcGarageCurrentVehicle({company:dispatch.replacementCompany||opVehicleCompany(op), prefix:dispatch.replacementPrefix});
    if (replacement?.blocked) {
      op.lastReplacementDispatch = {...dispatch, failedAt:new Date(now).toISOString()};
      op.replacementDispatch = null;
      op.status = 'fora de operação';
      op.clockAnchorAt = null;
      op.lastEvent = `Substituto ${dispatch.replacementPrefix} chegou, mas está retido pela oficina: ${replacement.blockedReason || 'restrição mecânica'}.`;
      return true;
    }
    gcSwapCompletePreTrip(dispatch, now);
    op.lastReplacementDispatch = {...dispatch, arrivedAt:new Date(now).toISOString()};
    op.replacementDispatch = null;
    op.status = 'operando';
    op.clockAnchorAt = now;
    op.garagePreTripEventId = dispatch.preTripEventId || '';
    op.lastEvent = `Ônibus substituto ${dispatch.replacementPrefix} chegou após ${dispatch.durationMinutes} min · trânsito ${dispatch.trafficLabel.toLowerCase()}. Operação retomada normalmente.`;
    return true;
  }

  // Enquanto o substituto está a caminho, o relógio da linha fica congelado.
  // Ao atingir a previsão, a linha volta automaticamente a operar.
  syncOneOperationProgress = function(op, now=Date.now()){
    let incidentChanged=gcIncidentProcessTimer(op,now);
    if(op?.pendingVehicleSwap?.busAtTerminal){
      const applied=opApplyPendingVehicleSwap(op,now);
      return incidentChanged||applied;
    }
    if (op?.replacementDispatch) {
      const arrival = Number(op.replacementDispatch.arrivesAtMs);
      if (Number.isFinite(arrival) && now < arrival) return incidentChanged;
      return gcSwapHandleArrival(op, now)||incidentChanged;
    }
    const progressChanged=gcSwapOriginalSyncOperation(op,now);
    // A running bus can arrive at the terminal during the core schedule tick.
    // If the reserve was already there, finish the exchange in this same tick.
    const applied=op?.pendingVehicleSwap?.busAtTerminal?opApplyPendingVehicleSwap(op,now):false;
    return Boolean(incidentChanged||progressChanged||applied);
  };

  // Repara a transferência de frota: o ônibus substituto fica em deslocamento
  // pelo prazo estimado, em vez de ser marcado como operando e imediatamente
  // retido pelo checklist pré-operacional ainda pendente.
  gcGarageHandleBreakdownSwap = function(alertId){
    if (!assertOwner()) return;
    const alerts = gcGarageAlerts();
    const alert = alerts.find(x=>x.id===alertId && !x.resolvedAt);
    if (!alert) { showToast('Esta ocorrência já foi resolvida ou não está mais disponível.'); return; }

    const select = $(`[data-gc-breakdown-select="${CSS.escape(alertId)}"]`);
    const vehicleKey = select?.value ? decodeURIComponent(select.value) : '';
    if (!vehicleKey) { showToast('Escolha primeiro um ônibus substituto disponível.'); return; }

    const replacement = gcGarageVehicles().find(v=>gcGarageKey(v)===vehicleKey);
    const operations = ownerOperations();
    const op = operations.find(x=>x.id===alert.operationId);
    if (!replacement || !op) { showToast('Não consegui localizar o ônibus substituto ou a operação vinculada à ocorrência.'); return; }
    if (op.replacementDispatch) { showToast('Já existe um ônibus substituto em deslocamento para esta linha.'); return; }

    const replacementState = gcGarageCurrentVehicle(replacement);
    if (!replacementState) { showToast('Não consegui carregar a ficha técnica do ônibus substituto. Atualize a Garagem e tente novamente.'); return; }
    const alreadyAssigned = operations.some(x=>x.id!==op.id && gcGarageKey({company:x.company,prefix:x.prefix})===vehicleKey);
    const hasOpenAlert = alerts.some(x=>!x.resolvedAt && x.vehicleKey===vehicleKey);
    if (replacementState?.blocked || hasOpenAlert) {
      showToast('O ônibus substituto possui uma retenção mecânica pendente. Escolha outra unidade.');
      return;
    }
    if (alreadyAssigned) {
      showToast('Este prefixo já está vinculado a outra linha/operação. Escolha um ônibus sem escala ativa.');
      return;
    }
    if (gcGarageCondition(replacementState) < 45) {
      showToast('A condição do ônibus substituto está abaixo de 45%. Escolha uma unidade em melhores condições.');
      return;
    }

    const traffic = gcSwapTrafficScenario();
    const now = Date.now();
    const arrivalMs = now + traffic.minutes*60*1000;
    const oldVehicle = {model:op.busModel||alert.model||'', prefix:String(op.prefix||alert.prefix||''), chassis:op.chassis||''};

    // A transferência troca a identificação da operação imediatamente, mas
    // mantém o serviço indisponível até a chegada física do reserva.
    op.vehicleCompany = replacement.company;
    op.busModel = replacement.model;
    op.prefix = String(replacement.prefix);
    op.chassis = replacement.chassis || '';
    op.status = 'substituição em deslocamento';
    op.clockAnchorAt = null;
    op.breakdownId = '';
    op.gcIncidentActive = null;delete op.gcIncidentPreviousStatus;
    const preTripEventId = gcGaragePreTripEvent(
      replacement, op.line, 'substituição', `${op.id}-replacement-${alertId}`
    );
    op.replacementDispatch = {
      startedAt:new Date(now).toISOString(),
      startedAtMs:now,
      arrivesAt:new Date(arrivalMs).toISOString(),
      arrivesAtMs:arrivalMs,
      durationMinutes:traffic.minutes,
      trafficLabel:traffic.label,
      oldVehicle,
      replacementCompany:replacement.company,
      replacementPrefix:String(replacement.prefix),
      replacementModel:replacement.model,
      preTripEventId
    };
    op.garagePreTripEventId = preTripEventId;
    op.lastEvent = `Ônibus reserva ${replacement.prefix} acionado · trânsito ${traffic.label.toLowerCase()} · previsão ${traffic.minutes} min.`;

    const alertIndex = alerts.findIndex(x=>x.id===alertId);
    if (alertIndex>=0) {
      alerts[alertIndex].resolvedAt = new Date(now).toISOString();
      alerts[alertIndex].resolution = `Substituição acionada: ${replacement.prefix} · previsão ${traffic.minutes} min · trânsito ${traffic.label}. O veículo avariado permanece retido para conserto.`;
    }
    if (!writeArrayKey(OPERATION_KEY, operations)) return;
    gcGarageWrite(GC_GARAGE_ALERTS_KEY, alerts);
    renderOperations();
    gcGarageRenderAlerts();
    gcGarageRenderHomeAlert();
    showToast(`Substituto ${replacement.prefix} acionado. Trânsito ${traffic.label.toLowerCase()}: chegada estimada em ${traffic.minutes} minutos. A linha retomará automaticamente quando ele chegar.`);
  };

  // Ajusta a apresentação do Visualizador sem reescrever o HTML original.
  renderOperations = function(){
    gcSwapOriginalRenderOperations();
    const list = $('#operationList');
    if (!list) return;
    const rows = ownerOperations().slice().reverse();
    const cards = Array.from(list.querySelectorAll('.operation-card'));
    cards.forEach((card,index)=>{
      const op = rows[index];
      const dispatch = op?.replacementDispatch;
      if (!dispatch) return;
      const status = card.querySelector('.operation-status');
      if (status) {
        status.className = 'operation-status detour gc-replacement-status';
        status.innerHTML = '<i></i>SUBSTITUTO A CAMINHO';
      }
      const heading = card.querySelector('.operation-live-heading strong');
      if (heading) heading.textContent = 'Ônibus reserva em deslocamento';
      const progress = card.querySelector('.operation-progress-track span');
      if (progress) progress.style.width = '0%';
      const meta = card.querySelector('.operation-live-meta');
      if (meta) {
        const spans = meta.querySelectorAll('span');
        if (spans[0]) spans[0].innerHTML = `Substituto <b>${escapeHtml(dispatch.replacementPrefix)}</b> · ${escapeHtml(dispatch.replacementModel)}`;
        if (spans[1]) spans[1].innerHTML = `Chegada em <b data-gc-replacement-countdown="${escapeHtml(op.id)}">${escapeHtml(gcSwapFormatArrival(dispatch))}</b> · Trânsito ${escapeHtml(dispatch.trafficLabel)}`;
      }
      const top = card.querySelector('.operation-card-top');
      if (top && !top.querySelector('.gc-replacement-dispatch-banner')) {
        const banner = document.createElement('p');
        banner.className = 'gc-replacement-dispatch-banner';
        banner.textContent = `Veículo anterior ${dispatch.oldVehicle?.prefix || '—'} retirado de operação. O reserva está a caminho; a linha será reativada automaticamente após a chegada.`;
        top.insertAdjacentElement('afterend', banner);
      }
      const toggle = card.querySelector('[data-op-toggle], [data-op-resume]');
      if (toggle) { toggle.disabled = true; toggle.textContent = 'Aguardando chegada do substituto'; }
    });
  };

  // A decisão escolhida precisa determinar o estado da linha. Antes, o código
  // parava sempre acidentes/mecânicas e mantinha rodando todos os demais tipos,
  // independentemente da orientação selecionada.
  function gcIncidentCreateMechanicalAlert(op,response){
    if (!op?.company || !op?.prefix || typeof gcGarageCurrentVehicle !== 'function') return null;
    const vehicle = {company:opVehicleCompany(op),prefix:String(op.prefix),model:op.busModel||'',chassis:op.chassis||''};
    const vehicleKey = gcGarageKey(vehicle);
    const existing = gcGarageAlerts().find(a=>!a.resolvedAt && a.operationId===op.id);
    if (existing) return existing;
    const state = gcGarageCurrentVehicle(vehicle);
    if (state) {
      const all = gcGarageState();
      const current = all[vehicleKey] || state;
      current.blocked = true;
      current.blockedReason = 'Falha mecânica reportada no Visualizador de Operação; exige avaliação da oficina.';
      all[vehicleKey] = current;
      gcGarageWrite(GC_GARAGE_STATE_KEY, all);
    }
    const alert = {
      id:makeId(), operationId:op.id, vehicleKey, company:vehicle.company,
      prefix:String(op.prefix), model:op.busModel||'', reason:'Falha mecânica reportada na ocorrência do Visualizador de Operação',
      componentKey:'', createdAt:new Date().toISOString(), resolvedAt:'',
      source:'operation-incident', decision:String(response||'')
    };
    gcGarageWrite(GC_GARAGE_ALERTS_KEY,[...gcGarageAlerts(),alert]);
    op.breakdownId = alert.id;
    return alert;
  }

  function gcIncidentDecisionEffect(type,response){
    const text = norm(response);
    if (type === 'mecanica') return 'stop';
    if (type === 'acidente') return /desvio oficial autorizado/.test(text) ? 'detour' : 'stop';
    if (type === 'obra') {
      if (/parar em local seguro|pedir instrução à central|somente quando a via estiver liberada/.test(text)) return 'stop';
      if (/desvio autorizado/.test(text)) return 'detour';
      return 'running';
    }
    if (type === 'transito') {
      if (/aguardar se não existir/.test(text)) return 'stop';
      if (/desvio previamente autorizado/.test(text)) return 'detour';
      return 'running';
    }
    if (type === 'clima') {
      if (/parar em local seguro|aguardar avaliação|via estiver perigosa/.test(text)) return 'stop';
      if (/alternativa previamente aprovada/.test(text)) return 'detour';
      return 'running';
    }
    return 'stop';
  }

  // Duração por tipo e por decisão, expressa em minutos simulados. A velocidade
  // configurada na linha converte esse período para tempo real de relógio.
  const GC_INCIDENT_DURATION_MINUTES={
    acidente:[20,45,30,60,90],
    obra:[40,15,20,10,15],
    mecanica:[25,45,25,20,60],
    transito:[20,30,15,10,25],
    clima:[45,60,15,35,30]
  };
  function gcIncidentDecisionPlan(type,response){
    const choices=INCIDENT_RESPONSES[type]||[],index=Math.max(0,choices.indexOf(response));
    const minutes=(GC_INCIDENT_DURATION_MINUTES[type]||[30,30,30,30,30])[Math.min(index,4)];
    const effect=gcIncidentDecisionEffect(type,response);
    const manualRelease=type==='mecanica';
    return {index,minutes,effect,manualRelease,timeBasis:manualRelease?'real':'simulado'};
  }

  function gcIncidentHasIndependentBlock(op){
    if(op.gcInspectionPaused||op.gcUserMaintenanceHoldOrderId||op.gcFuelPaused||op.gcMaintenanceStoppedByOrder||op.replacementDispatch||op.breakdownId)return true;
    if(typeof gcGarageAlerts==='function'&&gcGarageAlerts().some(a=>!a.resolvedAt&&a.operationId===op.id))return true;
    const vehicle={company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||'',chassis:op.chassis||''};
    if(vehicle.company&&vehicle.prefix&&typeof gcGarageCurrentVehicle==='function'){
      const state=gcGarageCurrentVehicle(vehicle);
      if(state?.blocked)return true;
      if(typeof gcGarageOrders==='function'&&gcGarageOrders().some(o=>o.vehicleKey===gcGarageKey(vehicle)&&!['Aprovada','Cancelada'].includes(o.status)))return true;
    }
    return false;
  }

  function gcIncidentMigrateLegacyDetour(op,now){
    if(op.status!=='operando com desvio'||op.gcIncidentActive||op.pendingVehicleSwap?.busAtTerminal)return false;
    const record=(op.incidentHistory||[]).slice().reverse().find(x=>x.type!=='mecanica'&&x.resolution&&(x.operationalEffect==='detour'||gcIncidentDecisionEffect(x.type,x.resolution)==='detour'));
    if(!record){op.status='operando';op.clockAnchorAt=now;op.lastEvent='Desvio legado sem ocorrência ativa encerrado; itinerário normal retomado.';return true;}
    const plan=gcIncidentDecisionPlan(record.type,record.resolution||'');
    const resolvedAt=Date.parse(record.resolvedAt||record.occurredAt||'')||now;
    const speed=Math.max(1,Number(op.speedMultiplier)||1);
    const durationMs=plan.minutes*60000/speed;
    const endsAtMs=resolvedAt+durationMs;
    if(now>=endsAtMs){
      if(!gcIncidentHasIndependentBlock(op)){op.status='operando';op.clockAnchorAt=now;}
      record.autoClosedAt=record.autoClosedAt||new Date(now).toISOString();
      record.autoClosedReason='Prazo da decisão de desvio concluído';
      op.lastEvent='Desvio antigo encerrado automaticamente após o prazo previsto; itinerário original retomado.';
      return true;
    }
    op.gcIncidentActive={id:record.id,type:record.type,effect:'detour',response:record.resolution,startedAtMs:resolvedAt,endsAtMs,durationMinutes:plan.minutes,timeBasis:'simulado',manualRelease:false,resumeStatus:'operando'};
    return true;
  }

  function gcIncidentProcessTimer(op,now){
    let changed=false;
    if(!op)return false;
    if(!op.gcIncidentActive){if(gcIncidentMigrateLegacyDetour(op,now))changed=true;return changed;}
    const active=op.gcIncidentActive;
    // Migra ocorrências salvas por versões anteriores que tinham status ativo,
    // mas ainda não armazenavam um prazo de encerramento.
    if(!(Number(active.endsAtMs)>0)&&active.type){
      const history=(op.incidentHistory||[]).find(x=>x.id===active.id)||((op.incidentHistory||[]).slice().reverse().find(x=>x.type===active.type&&x.resolution));
      const response=active.response||history?.resolution||'';
      const plan=gcIncidentDecisionPlan(active.type,response);
      const startedAt=Number(active.startedAtMs)||Date.parse(active.startedAt||history?.resolvedAt||history?.occurredAt||'')||now;
      active.manualRelease=Boolean(active.manualRelease||plan.manualRelease);
      active.durationMinutes=Number(active.durationMinutes)||plan.minutes;
      active.timeBasis=active.manualRelease?'real':'simulado';
      active.startedAtMs=startedAt;
      active.endsAtMs=startedAt+active.durationMinutes*60000/(active.manualRelease?1:Math.max(1,Number(op.speedMultiplier)||1));
      changed=true;
    }
    if(active.manualRelease){
      if(active.endsAtMs&&now>=Number(active.endsAtMs)&&!active.serviceArrived){
        active.serviceArrived=true;active.assistanceArrivedAt=new Date(now).toISOString();delete active.endsAtMs;
        op.lastEvent=`Equipe de apoio chegou à ocorrência de ${INCIDENT_LABELS[active.type]||'mecânica'}. O ônibus continua bloqueado até a avaliação, reparo aprovado ou substituição.`;
        changed=true;
      }
      return changed;
    }
    if(!active.endsAtMs||now<Number(active.endsAtMs))return changed;
    const wasPaused=op.status==='pausada'||active.resumeStatus==='pausada';
    const waitingTerminal=Boolean(op.pendingVehicleSwap?.busAtTerminal);
    const blocked=gcIncidentHasIndependentBlock(op);
    const history=(op.incidentHistory||[]).find(x=>x.id===active.id);
    if(history){history.completedAt=new Date(now).toISOString();history.autoClosedAt=history.completedAt;}
    op.gcIncidentActive=null;
    if(wasPaused){op.status='pausada';op.clockAnchorAt=null;op.gcResumeStatus='operando';}
    else if(waitingTerminal){op.status='aguardando substituição no terminal';op.clockAnchorAt=null;}
    else if(!blocked){op.status='operando';op.clockAnchorAt=now;}
    else if(op.status==='operando com desvio'||op.status==='parada técnica'){
      // Outro bloqueio independente continua prevalecendo; nunca libere uma pane,
      // retenção oficial, falta de combustível ou OS só porque o incidente terminou.
      op.clockAnchorAt=null;
    }
    op.lastEvent=blocked?'Prazo da ocorrência encerrado, mas a operação continua retida por outro bloqueio independente.':waitingTerminal?'Ocorrência encerrada; ônibus atual aguarda o substituto no terminal.':wasPaused?'Ocorrência encerrada; linha permanece pausada por decisão do operador.':'Ocorrência encerrada automaticamente; itinerário normal retomado.';
    delete op.gcIncidentPreviousStatus;
    return true;
  }

  document.addEventListener('click',function(event){
    const button = event.target.closest('#ovApplyIncidentResponse');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!assertOwner()) return;
    const rows = ownerOperations();
    const op = rows.find(x=>x.id===currentIncidentOperationId);
    if (!op) { showToast('Selecione uma linha para registrar a decisão.'); return; }
    const type = $('#ovIncidentType').value;
    const response = $('#ovIncidentResponse').value;
    if (!response) { showToast('Selecione uma resposta pronta.'); return; }

    const plan=gcIncidentDecisionPlan(type,response);
    const now=Date.now();
    const speed=Math.max(1,Number(op.speedMultiplier)||1);
    const durationMs=plan.manualRelease?plan.minutes*60000:plan.minutes*60000/speed;
    const resumeStatus=op.gcIncidentPreviousStatus||(op.status==='pausada'?'pausada':(operationIsRunning(op)?op.status:'operando'));
    op.currentIncidentType=type;
    op.lastEvent=`${INCIDENT_LABELS[type]} — decisão: ${response}`;
    op.incidentHistory=op.incidentHistory||[];
    let record=op.incidentHistory.slice().reverse().find(x=>x.type===type&&!x.resolution);
    if(!record){record={id:makeId(),type,occurredAt:new Date(now).toISOString(),resolution:''};op.incidentHistory.push(record);}
    record.resolution=response;
    record.resolvedAt=new Date(now).toISOString();
    record.operationalEffect=plan.effect;
    record.decisionIndex=plan.index;
    record.durationMinutes=plan.minutes;
    record.durationBasis=plan.timeBasis;
    record.estimatedEndAt=new Date(now+durationMs).toISOString();

    op.gcIncidentActive={id:record.id,type,effect:plan.effect,response,startedAt:new Date(now).toISOString(),startedAtMs:now,endsAtMs:plan.manualRelease?now+durationMs:now+durationMs,durationMinutes:plan.minutes,timeBasis:plan.timeBasis,manualRelease:plan.manualRelease,resumeStatus,serviceArrived:false};
    let mechanicalAlert=null;
    if(type==='mecanica'){
      mechanicalAlert=gcIncidentCreateMechanicalAlert(op,response);
      op.status='fora de operação';op.clockAnchorAt=null;
      op.lastEvent+=mechanicalAlert?' · veículo retido e ocorrência encaminhada à Garagem/Mecânica':' · linha mantida parada por segurança';
    }else if(plan.effect==='stop'){
      op.status='parada técnica';op.clockAnchorAt=null;
      op.lastEvent+=` · parada prevista por ${plan.minutes} min simulados`;
    }else{
      if(resumeStatus==='pausada'){
        op.status='pausada';op.clockAnchorAt=null;
      }else{
        op.status=plan.effect==='detour'?'operando com desvio':'operando';
        op.clockAnchorAt=now;
      }
      op.lastEvent+=plan.effect==='detour'?` · desvio autorizado temporário por ${plan.minutes} min simulados`:` · operação retomada; revisão em ${plan.minutes} min simulados`;
      if(resumeStatus==='pausada')op.lastEvent+=' · a pausa manual foi preservada';
    }
    delete op.gcIncidentPreviousStatus;
    if(!writeArrayKey(OPERATION_KEY,rows)){showToast('Não foi possível salvar a decisão da ocorrência.');return;}
    renderOperations();
    $('#ovIncidentPanel').hidden=true;
    if(mechanicalAlert){
      gcGarageRenderAlerts();gcGarageRenderHomeAlert();
      const requestsReserve=/veículo reserva|veiculo reserva|equipe de apoio/.test(norm(response));
      if(requestsReserve){gcGarageOpen();gcGarageSetTab('alerts');}
      showToast(requestsReserve?'Ocorrência mecânica registrada. A Garagem foi aberta para enviar mecânico ou acionar um ônibus substituto.':'Ocorrência mecânica registrada. A linha permanece bloqueada até reparo aprovado ou substituição.');
    }else{
      const basis=`${plan.minutes} min simulados`;
      showToast(plan.effect==='stop'?`Decisão registrada. Linha parada por até ${basis}; depois o sistema reavalia os bloqueios.`:plan.effect==='detour'?`Desvio autorizado aplicado por até ${basis}. O itinerário normal será retomado automaticamente.`:`Decisão registrada. A operação segue normalmente; revisão automática em ${basis}.`);
    }
  }, true);

  // Atualiza apenas o contador de chegada durante o deslocamento; o processo de
  // chegada e gravação é executado pelo relógio persistente da operação.
  setInterval(()=>{
    if(document.hidden)return;
    const replacementNodes=document.querySelectorAll('[data-gc-replacement-countdown]');
    const swapNodes=document.querySelectorAll('[data-gc-operation-swap-countdown]');
    const incidentNodes=document.querySelectorAll('[data-gc-incident-countdown]');
    if(!replacementNodes.length&&!swapNodes.length&&!incidentNodes.length)return;
    const byId = new Map(ownerOperations().map(op=>[op.id,op]));
    replacementNodes.forEach(el=>{
      const op=byId.get(el.dataset.gcReplacementCountdown);
      if(op?.replacementDispatch)el.textContent=gcSwapFormatArrival(op.replacementDispatch);
    });
    swapNodes.forEach(el=>{
      const op=byId.get(el.dataset.gcOperationSwapCountdown),pending=op?.pendingVehicleSwap;
      if(pending){el.textContent=Date.now()>=Number(pending.arrivesAtMs)?'reserva chegou e aguarda o ônibus atual':'reserva chega em '+opFormatCountdown(Math.max(0,(Number(pending.arrivesAtMs)-Date.now())/1000));}
    });
    incidentNodes.forEach(el=>{
      const op=byId.get(el.dataset.gcIncidentCountdown),active=op?.gcIncidentActive;
      if(active)el.textContent=`${INCIDENT_LABELS[active.type]||active.type} · ${active.manualRelease?'apoio mecânico':'normalização'}: ${active.serviceArrived?'equipe chegou · aguardando oficina':active.endsAtMs?opFormatCountdown(Math.max(0,(Number(active.endsAtMs)-Date.now())/1000)):'aguardando liberação da oficina'}.`;
    });
  },1000);

  console.info('[Grupo Conect] Correção incremental de substituição e decisões de ocorrência carregada.');
})();

/* =====================================================================
   GRUPO CONECT — Central de Gestão Operacional (módulo aditivo)
   Combustível, passageiros, escalas, reputação, inspeções e seguros.
   Persistência local em chaves próprias grupoConect.admin*.
   ===================================================================== */
(function gcAdminManagementModule(){
  const KEYS={
    fuelStock:'grupoConect.adminFuelStock.v1', fuelPrices:'grupoConect.adminFuelPrices.v1',
    fuelStates:'grupoConect.adminFuelStates.v1', fuelAuto:'grupoConect.adminFuelAuto.v1',
    fuelLog:'grupoConect.adminFuelLog.v1', driverSchedules:'grupoConect.adminDriverSchedules.v1',
    inspections:'grupoConect.adminInspections.v1', policies:'grupoConect.adminInsurancePolicies.v1',
    claims:'grupoConect.adminInsuranceClaims.v1', feedback:'grupoConect.adminPassengerFeedback.v1',
    demand:'grupoConect.adminPassengerDemand.v1'
  };
  const ADMIN_COMPANIES=Array.isArray(GROUP_COMPANIES)?GROUP_COMPANIES.slice():['Progresso','Viação Cedro','Viação Conecta','Transportes Transportes','Galaxy Transportes'];
  const $id=id=>document.getElementById(id);
  const readObj=key=>readObjectKey(key);
  const writeObj=(key,value)=>writeObjectKey(key,value);
  const readRows=key=>readArrayKey(key);
  const writeRows=(key,value)=>writeArrayKey(key,value);
  const nowIso=()=>new Date().toISOString();
  const safeNum=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const fmtDate=value=>{if(!value)return '—';const d=new Date(`${String(value).slice(0,10)}T12:00:00`);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('pt-BR');};
  const esc=escapeHtml;

  function fuelPrices(){return {...{diesel:7.99,arla:4.99},...readObj(KEYS.fuelPrices)};}
  function fuelStock(){return {...{diesel:0,arla:0},...readObj(KEYS.fuelStock)};}
  function fuelAuto(){return readObj(KEYS.fuelAuto).enabled!==false;}
  function getVehicles(){try{if(typeof gcGarageSyncVehicles==='function')gcGarageSyncVehicles();return gcGarageVehicles();}catch(e){return typeof gcGarageVehicles==='function'?gcGarageVehicles():[];}}
  function getVehicle(company,prefix,model=''){
    const rows=getVehicles();
    return rows.find(v=>norm(v.company)===norm(company)&&String(v.prefix)===String(prefix)&&(!model||norm(v.model)===norm(model)))||rows.find(v=>norm(v.company)===norm(company)&&String(v.prefix)===String(prefix))||null;
  }
  function scrGuess(vehicle){
    const t=norm(`${vehicle?.model||''} ${vehicle?.chassis||''} ${vehicle?.emission||''} ${vehicle?.engine||''}`);
    if(/sem\s*(scr|arla|adblue)|egr\s*(only|apenas)?/.test(t))return false;
    if(/euro\s*(5|v|6|vi)|proconve\s*p[- ]?(7|8)|\bscr\b|\barla\s*32\b|adblue/.test(t))return true;
    if(typeof vehicle?.scr==='boolean')return vehicle.scr;
    const mech=typeof gcGarageState==='function'?gcGarageState()[gcGarageKey(vehicle)]:null;
    if(typeof mech?.scr==='boolean')return mech.scr;
    return null;
  }
  function ensureFuelStates(){
    const all=readObj(KEYS.fuelStates);let changed=false;
    getVehicles().forEach(v=>{
      const key=gcGarageKey(v);if(all[key])return;
      const profile=busOperationalProfile(v),mechanical=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(v):null;
      const capacity=Math.max(80,Number(profile.tank)||280),isNew=Boolean(mechanical?.isNew||v.isZeroKm||v.source==='zero-km-market');
      const usesScr=scrGuess(v),arlaCapacity=Math.max(15,Math.round(capacity*.075));
      all[key]={key,company:v.company,prefix:String(v.prefix),model:v.model,chassis:v.chassis||'',tankCapacity:capacity,kmpl:Math.max(.8,Number(profile.kmpl)||2.1),distancePerTripKm:35,fuelLiters:Math.round(capacity*(isNew ? .9 : .62)*10)/10,arlaCapacity,arlaLiters:usesScr?Math.round(arlaCapacity*.58*10)/10:null,usesScr,createdAt:nowIso(),updatedAt:nowIso(),isNew};
      changed=true;
    });
    if(changed)writeObj(KEYS.fuelStates,all);
    return all;
  }
  function fuelState(vehicleOrKey){
    const key=typeof vehicleOrKey==='string'?vehicleOrKey:gcGarageKey(vehicleOrKey);
    const all=ensureFuelStates();return all[key]||null;
  }
  function saveFuelState(row){const all=ensureFuelStates();row.updatedAt=nowIso();all[row.key]=row;return writeObj(KEYS.fuelStates,all);}
  function saveFuelStock(row){return writeObj(KEYS.fuelStock,{diesel:Math.max(0,safeNum(row.diesel)),arla:Math.max(0,safeNum(row.arla))});}
  function fuelLog(entry){const rows=readRows(KEYS.fuelLog);rows.push({id:makeId(),createdAt:nowIso(),...entry});writeRows(KEYS.fuelLog,rows.slice(-1000));}
  function updateCashUI(){try{if(typeof renderCashDashboard==='function')renderCashDashboard();if(typeof gcBankRender==='function'&&$id('gcBankPanel')&&!$id('gcBankPanel').hidden)gcBankRender();}catch(e){console.warn('[Grupo Conect] Atualização do Caixa não concluída:',e);}}
  function addCashMovement(direction,amount,category,description,id){
    const rows=cashLedger();if(id&&rows.some(x=>x.id===id))return true;
    rows.push({id:id||makeId(),date:dateTodayLocal(),direction,amount:Math.round(Number(amount)*100)/100,category,description,source:'gcAdmin',createdAt:nowIso()});
    const ok=writeArrayKey(CASH_LEDGER_KEY,rows);if(ok)updateCashUI();return ok;
  }
  function adminVehicleLabel(v){return `${v.company} · ${v.prefix} · ${v.model}`;}
  function autoFuelEnabled(){return fuelAuto();}
  function estimatedTripDiesel(row,distance){return Math.max(1,Number(distance||row.distancePerTripKm||35)/Math.max(.8,Number(row.kmpl)||2.1));}
  function prepareFuelForTrip(vehicle,distance,reference){
    if(!vehicle)return {ok:true,skipped:true};
    const row=fuelState(vehicle);
    if(!row)return {ok:false,reason:'Ficha de combustível indisponível para este ônibus.'};
    const needDiesel=estimatedTripDiesel(row,distance),requiredDiesel=needDiesel*1.12;
    const needArla=row.usesScr===true?needDiesel*.04:0,requiredArla=needArla*1.15;
    if(requiredDiesel>Number(row.tankCapacity)*.98){
      return {ok:false,reason:`A distância estimada de ${numberPt(distance||row.distancePerTripKm||35,0)} km exige cerca de ${numberPt(requiredDiesel,1)} L com reserva, acima da autonomia segura deste tanque. Divida o trecho ou programe uma parada de abastecimento.`};
    }
    // Com o automático desligado, a partida só é liberada quando os tanques
    // instalados no próprio veículo suportam o trecho com margem de segurança.
    if(!autoFuelEnabled()){
      if(Number(row.fuelLiters||0)+.0001<requiredDiesel)return {ok:false,reason:`Abastecimento automático desligado. O tanque tem ${numberPt(row.fuelLiters||0,1)} L, mas são necessários ${numberPt(requiredDiesel,1)} L para a viagem, incluindo reserva de 12%.`};
      if(row.usesScr===true&&Number(row.arlaLiters||0)+.0001<requiredArla)return {ok:false,reason:`Abastecimento automático desligado. O reservatório de ARLA 32 tem ${numberPt(row.arlaLiters||0,1)} L, mas são necessários ${numberPt(requiredArla,2)} L.`};
      return {ok:true,manual:true,row};
    }
    const originalStock=fuelStock(),nextStock={...originalStock};
    const calcRefill=(kind,capacity,current,required,targetRatio)=>{
      const available=Math.max(0,Number(originalStock[kind])||0);
      const minimumShortage=Math.max(0,required-current);
      if(available+0.0001<minimumShortage)return {ok:false,kind,shortage:minimumShortage,available,current,required};
      // Abastece até o alvo operacional (72% diesel / 70% ARLA) sempre que
      // houver estoque. Se o veículo já tem autonomia e o estoque é limitado,
      // utiliza apenas o excedente sem bloquear uma viagem segura.
      const target=Math.min(capacity*.92,Math.max(required,capacity*targetRatio));
      const desired=Math.max(0,target-current);
      const added=Math.min(available,desired);
      return {ok:true,current:Math.min(capacity,current+added),added};
    };
    const diesel=calcRefill('diesel',row.tankCapacity,Number(row.fuelLiters)||0,requiredDiesel,.72);
    if(!diesel.ok)return {ok:false,reason:`Estoque insuficiente de Diesel S10. Faltam ${numberPt(diesel.shortage,1)} L para garantir a próxima viagem com reserva; estoque disponível ${numberPt(diesel.available,1)} L.`};
    let arla={ok:true,current:Number(row.arlaLiters)||0,added:0};
    if(row.usesScr===true){
      arla=calcRefill('arla',row.arlaCapacity,Number(row.arlaLiters)||0,requiredArla,.70);
      if(!arla.ok)return {ok:false,reason:`ARLA 32/AdBlue insuficiente para este veículo SCR. Faltam ${numberPt(arla.shortage,2)} L; estoque disponível ${numberPt(arla.available,1)} L.`};
    }
    if(diesel.current+0.0001<requiredDiesel)return {ok:false,reason:'O tanque não alcança a autonomia mínima estimada, mesmo após o abastecimento disponível.'};
    if(row.usesScr===true&&arla.current+0.0001<requiredArla)return {ok:false,reason:'O reservatório de ARLA 32 não alcança a autonomia mínima estimada.'};
    const updatedRow={...row,fuelLiters:diesel.current,updatedAt:nowIso()};
    if(row.usesScr===true)updatedRow.arlaLiters=arla.current;
    nextStock.diesel=Math.max(0,Number(nextStock.diesel||0)-diesel.added);
    if(row.usesScr===true)nextStock.arla=Math.max(0,Number(nextStock.arla||0)-arla.added);
    // Transação compensatória: se a ficha do veículo não puder ser gravada,
    // devolve os litros ao estoque para evitar combustível criado/perdido.
    if(!saveFuelStock(nextStock))return {ok:false,reason:'Não foi possível atualizar o estoque central. A partida foi bloqueada sem transferir combustível.'};
    if(!saveFuelState(updatedRow)){
      saveFuelStock(originalStock);
      return {ok:false,reason:'Não foi possível salvar o tanque do ônibus. O estoque central foi revertido.'};
    }
    if(diesel.added>0)fuelLog({type:'transferência automática',product:'Diesel S10',liters:diesel.added,company:row.company,prefix:row.prefix,reference:reference||'pré-viagem',unitPrice:fuelPrices().diesel,cost:0,description:'Transferência do estoque central para o tanque do ônibus; compra já paga anteriormente.'});
    if(arla.added>0)fuelLog({type:'transferência automática',product:'ARLA 32 / AdBlue',liters:arla.added,company:row.company,prefix:row.prefix,reference:reference||'pré-viagem',unitPrice:fuelPrices().arla,cost:0,description:'Transferência do estoque central para o reservatório do sistema SCR.'});
    return {ok:true,dieselAdded:diesel.added,arlaAdded:arla.added,row:updatedRow};
  }
  function consumeFuel(vehicle,distance,reference,actualDiesel=null){
    if(!vehicle)return false;const row=fuelState(vehicle);if(!row)return false;
    const diesel=Math.max(0,actualDiesel===null?estimatedTripDiesel(row,distance):Number(actualDiesel)||0);
    row.fuelLiters=Math.max(0,Number(row.fuelLiters||0)-diesel);
    const arlaUsed=row.usesScr===true?diesel*.04:0;if(row.usesScr===true)row.arlaLiters=Math.max(0,Number(row.arlaLiters||0)-arlaUsed);
    saveFuelState(row);
    fuelLog({type:'consumo de viagem',product:'Diesel S10',liters:diesel,arlaLiters:arlaUsed,company:row.company,prefix:row.prefix,reference:reference||'viagem',cost:0,description:`Consumo registrado. Tanque após viagem: ${numberPt(row.fuelLiters,1)} L${row.usesScr===true?` · ARLA restante ${numberPt(row.arlaLiters,1)} L`:''}.`});
    if(row.usesScr===true&&row.arlaLiters<=0.01)fuelLog({type:'alerta',product:'ARLA 32 / AdBlue',liters:0,company:row.company,prefix:row.prefix,reference,description:'Reservatório de ARLA 32 vazio; o abastecimento automático precisará de estoque antes da próxima partida.'});
    return true;
  }
  function fillVehicleNow(key){
    if(!assertOwner())return;
    const row=fuelState(key);if(!row)return;
    const originalStock=fuelStock(),stock={...originalStock},updated={...row};
    const dieselNeed=Math.max(0,row.tankCapacity*.9-row.fuelLiters),arlaNeed=row.usesScr===true?Math.max(0,row.arlaCapacity*.9-Number(row.arlaLiters||0)):0;
    if(stock.diesel+0.0001<dieselNeed||(row.usesScr===true&&stock.arla+0.0001<arlaNeed)){showToast('Estoque central insuficiente para completar os tanques. Compre Diesel e, quando aplicável, ARLA 32.');return;}
    stock.diesel-=dieselNeed;updated.fuelLiters+=dieselNeed;
    if(row.usesScr===true){stock.arla-=arlaNeed;updated.arlaLiters+=arlaNeed;}
    if(!saveFuelStock(stock)){showToast('Não foi possível atualizar o estoque central.');return;}
    if(!saveFuelState(updated)){saveFuelStock(originalStock);showToast('Falha ao salvar o tanque. O estoque central foi restaurado.');return;}
    fuelLog({type:'abastecimento manual',product:'Diesel S10',liters:dieselNeed,arlaLiters:arlaNeed,company:row.company,prefix:row.prefix,reference:'abastecimento manual',cost:0,description:'Estoque central transferido para completar os reservatórios até 90%.'});
    if(arlaNeed>0)fuelLog({type:'abastecimento manual',product:'ARLA 32 / AdBlue',liters:arlaNeed,company:row.company,prefix:row.prefix,reference:'abastecimento manual',cost:0,description:'Estoque central transferido para completar o reservatório SCR até 90%.'});
    gcAdminRenderFuel();showToast(`Tanques de ${row.prefix} abastecidos a partir do estoque central.`);gcAdminResumeFuelPausedOperations();
  }
  function purchaseFuel(event){
    event.preventDefault();if(!assertOwner())return;
    const product=$id('gcFuelPurchaseType').value,liters=Number($id('gcFuelPurchaseLiters').value),supplier=$id('gcFuelSupplier').value,prices=fuelPrices(),price=product==='arla'?prices.arla:prices.diesel,total=liters*price;
    if(!Number.isFinite(liters)||liters<=0||liters>100000||!Number.isFinite(price)||price<=0){showToast('Informe uma quantidade e um preço válidos.');return;}
    const balance=cashBreakdown().balance;if(total>balance+0.005){showToast(`Compra não autorizada: ${money(total)} necessários; saldo disponível ${money(balance)}.`);return;}
    const previousStock=fuelStock(),stock={...previousStock};stock[product]=Number(stock[product]||0)+liters;
    if(!saveFuelStock(stock)){showToast('Não foi possível atualizar o estoque. A compra não foi lançada no Caixa.');return;}
    if(!addCashMovement('out',total,product==='arla'?'Compra de ARLA 32 / AdBlue':'Compra de Diesel S10',`${numberPt(liters,1)} L · ${supplier} · ${money(price)}/L`)){
      saveFuelStock(previousStock);showToast('Falha ao lançar a compra no Caixa. O estoque foi revertido.');return;
    }
    fuelLog({type:'compra de estoque',product:product==='arla'?'ARLA 32 / AdBlue':'Diesel S10',productKey:product,liters,unitPrice:price,cost:total,supplier,reference:'estoque central'});
    $id('gcFuelPurchaseForm').reset();$id('gcFuelPurchaseType').value=product;$id('gcFuelPurchaseLiters').value='500';$id('gcFuelSupplier').value=supplier;
    gcAdminRenderFuel();gcAdminResumeFuelPausedOperations();showToast(`Compra registrada: ${numberPt(liters,1)} L de ${product==='arla'?'ARLA 32':'Diesel S10'} por ${money(total)}.`);
  }
  function updatePurchasePreview(){const type=$id('gcFuelPurchaseType')?.value||'diesel',liters=Number($id('gcFuelPurchaseLiters')?.value)||0,price=type==='arla'?fuelPrices().arla:fuelPrices().diesel;if($id('gcFuelPurchasePreview'))$id('gcFuelPurchasePreview').textContent=`Preço ${money(price)}/L · Total estimado: ${money(Math.max(0,liters)*price)}`;}
  function saveFuelSettings(){if(!assertOwner())return;const diesel=Number($id('gcFuelDieselPrice').value),arla=Number($id('gcFuelArlaPrice').value);if(!(diesel>0&&diesel<=100&&arla>0&&arla<=100)){showToast('Os preços devem ser maiores que zero e menores ou iguais a R$ 100,00.');return;}writeObj(KEYS.fuelPrices,{diesel,arla});writeObj(KEYS.fuelAuto,{enabled:$id('gcFuelAutoEnabled').checked});updatePurchasePreview();gcAdminRenderFuel();showToast('Preços e abastecimento automático atualizados.');}

  function gcAdminRenderFuel(){
    if(!$id('gcFuelStockStats'))return;const stock=fuelStock(),prices=fuelPrices(),states=ensureFuelStates(),dieselVehicles=Object.values(states);
    $id('gcFuelStockStats').innerHTML=[['Diesel S10 em estoque',`${numberPt(stock.diesel,1)} L`],['ARLA 32 em estoque',`${numberPt(stock.arla,1)} L`],['Preço do diesel',`${money(prices.diesel)}/L`],['Abastecimento automático',fuelAuto()?'Ativado':'Desativado']].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');
    if($id('gcFuelDieselPrice'))$id('gcFuelDieselPrice').value=Number(prices.diesel).toFixed(2);if($id('gcFuelArlaPrice'))$id('gcFuelArlaPrice').value=Number(prices.arla).toFixed(2);if($id('gcFuelAutoEnabled'))$id('gcFuelAutoEnabled').checked=fuelAuto();
    const vehicles=getVehicles();
    $id('gcFuelFleetList').innerHTML=vehicles.length?vehicles.map(v=>{const r=states[gcGarageKey(v)]||fuelState(v),dPct=Math.max(0,Math.min(100,Number(r.fuelLiters||0)/r.tankCapacity*100)),aPct=r.usesScr===true?Math.max(0,Math.min(100,Number(r.arlaLiters||0)/r.arlaCapacity*100)):0;return `<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(adminVehicleLabel(v))}</strong><small>${esc(v.chassis||'Chassi não informado')} · Tanque ${numberPt(r.tankCapacity,0)} L · ${numberPt(r.kmpl,2)} km/L</small></div><span class="gc-admin-badge ${dPct<20?'danger':dPct<40?'warning':'success'}">Diesel ${numberPt(dPct,0)}%</span></div><div class="gc-admin-meter"><span style="width:${dPct}%"></span></div><small>${numberPt(r.fuelLiters,1)} / ${numberPt(r.tankCapacity,1)} L</small>${r.usesScr===true?`<div class="gc-admin-record-head gc-admin-submeter"><span>ARLA 32 · ${numberPt(r.arlaLiters,1)} / ${numberPt(r.arlaCapacity,1)} L</span><b>${numberPt(aPct,0)}%</b></div><div class="gc-admin-meter arla"><span style="width:${aPct}%"></span></div>`:`<div class="gc-admin-muted">${r.usesScr===false?'Este veículo foi marcado como sem SCR.':'SCR/Euro V ou VI não confirmado: confirme a configuração do chassi.'}</div>`}<div class="gc-admin-record-actions"><label class="gc-admin-inline-field"><span>Usa SCR / ARLA 32?</span><select data-gc-fuel-scr="${esc(r.key)}"><option value="unknown" ${r.usesScr===null?'selected':''}>Confirmar depois</option><option value="yes" ${r.usesScr===true?'selected':''}>Sim · Euro V/VI com SCR</option><option value="no" ${r.usesScr===false?'selected':''}>Não utiliza SCR</option></select></label><label class="gc-admin-inline-field"><span>Distância por viagem</span><input type="number" min="1" max="1500" step="1" value="${Number(r.distancePerTripKm)||35}" data-gc-fuel-distance="${esc(r.key)}"></label><button type="button" class="gc-secondary-action" data-gc-fuel-fill="${esc(r.key)}">Abastecer agora</button></div></article>`;}).join(''):'<p class="gc-admin-empty">Nenhum ônibus cadastrado na frota.</p>';
    const logs=readRows(KEYS.fuelLog).slice().reverse().slice(0,30);$id('gcFuelHistoryList').innerHTML=logs.length?logs.map(x=>`<article class="gc-admin-record"><div><strong>${esc(x.product||'Movimento de combustível')} · ${esc(x.company||'Estoque central')}${x.prefix?` · ${esc(x.prefix)}`:''}</strong><small>${fmtDate(x.createdAt)} · ${esc(x.type||'Registro')} · ${numberPt(x.liters||0,1)} L${x.arlaLiters?` · ARLA ${numberPt(x.arlaLiters,1)} L`:''} ${x.cost?`· ${money(x.cost)}`:''}</small><small>${esc(x.description||x.supplier||'')}</small></div></article>`).join(''):'<p class="gc-admin-empty">Ainda não há compras ou abastecimentos registrados.</p>';
  }

  function scheduleRows(){return readRows(KEYS.driverSchedules);}
  function scheduleRange(s){const start=new Date(`${s.date}T${s.start}:00`).getTime(),rawEnd=new Date(`${s.date}T${s.end}:00`).getTime(),end=rawEnd<=start?rawEnd+86400000:rawEnd;return {start,end};}
  function refreshScheduleDrivers(){const company=$id('gcDriverScheduleCompany')?.value||ADMIN_COMPANIES[0],select=$id('gcDriverScheduleDriver');if(!select)return;const old=select.value,drivers=gcGarageStaff().filter(x=>x.role==='driver'&&x.active!==false&&(!x.company||norm(x.company)===norm(company)));select.innerHTML='<option value="">Selecione um motorista contratado</option>'+drivers.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.company||company)}</option>`).join('');if(drivers.some(x=>x.id===old))select.value=old;}
  function renderDriverSchedules(){if(!$id('gcDriverScheduleList'))return;refreshScheduleDrivers();const rows=scheduleRows().slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.start).localeCompare(String(b.start)));const today=dateTodayLocal(),todayRows=rows.filter(x=>x.date===today&&x.status!=='Cancelada'),staff=gcGarageStaff().filter(x=>x.role==='driver'&&x.active!==false);$id('gcDriverScheduleSummary').innerHTML=[['Escalas de hoje',todayRows.length],['Motoristas ativos',staff.length],['Jornadas longas sinalizadas',rows.filter(x=>Number(x.durationMinutes)>600&&x.status!=='Cancelada').length]].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');$id('gcDriverScheduleList').innerHTML=rows.length?rows.map(x=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(x.driverName)} · ${esc(x.company)}</strong><small>${fmtDate(x.date)} · ${esc(x.line)} · ${esc(x.start)}–${esc(x.end)} · intervalo ${Number(x.breakMinutes)||0} min</small></div><span class="gc-admin-badge ${x.status==='Cancelada'?'muted':x.longShift?'warning':'success'}">${x.status==='Cancelada'?'Cancelada':x.longShift?'Revisar jornada':'Escalada'}</span></div><small>${numberPt(Number(x.durationMinutes)/60,1)} h líquidas · ${esc(x.driverSpecialty||'Motorista contratado')}</small>${x.status!=='Cancelada'?`<div class="gc-admin-record-actions"><button type="button" class="gc-secondary-action" data-gc-schedule-cancel="${esc(x.id)}">Cancelar escala</button></div>`:''}</article>`).join(''):'<p class="gc-admin-empty">Nenhuma escala registrada. Contrate motoristas na aba Equipe do aplicativo no celular e registre aqui suas jornadas.</p>';}
  function submitDriverSchedule(event){event.preventDefault();if(!assertOwner())return;const driver=gcGarageStaff().find(x=>x.id===$id('gcDriverScheduleDriver').value&&x.active!==false),company=$id('gcDriverScheduleCompany').value,date=$id('gcDriverScheduleDate').value,line=$id('gcDriverScheduleLine').value.trim(),start=$id('gcDriverScheduleStart').value,end=$id('gcDriverScheduleEnd').value,breakMinutes=Number($id('gcDriverScheduleBreak').value);if(!driver||!date||!line||!start||!end||!Number.isFinite(breakMinutes)||breakMinutes<0){showToast('Selecione um motorista contratado e preencha data, linha e horários.');return;}const temp={date,start,end},range=scheduleRange(temp),gross=(range.end-range.start)/60000,duration=gross-breakMinutes;if(!(gross>0)||duration<=0){showToast('O intervalo não pode ser maior ou igual à jornada.');return;}const conflict=scheduleRows().filter(x=>x.status!=='Cancelada'&&x.driverId===driver.id).some(x=>{const r=scheduleRange(x);return range.start<r.end&&range.end>r.start;});if(conflict){showToast('Conflito de escala: este motorista já possui uma jornada sobreposta nesse período.');return;}const row={id:makeId(),driverId:driver.id,driverName:driver.name,driverSpecialty:driver.specialty||'',company,date,line,start,end,breakMinutes,durationMinutes:Math.round(duration),longShift:duration>600,status:'Escalada',createdAt:nowIso()};const rows=scheduleRows();rows.push(row);if(!writeRows(KEYS.driverSchedules,rows))return;$id('gcDriverScheduleForm').reset();$id('gcDriverScheduleDate').value=dateTodayLocal();$id('gcDriverScheduleCompany').value=company;refreshScheduleDrivers();gcAdminRenderStaff();showToast(row.longShift?'Escala registrada. Atenção: jornada acima de 10 horas líquidas; revise os limites aplicáveis.':'Escala de motorista registrada.');}

  function feedbackRows(){return readRows(KEYS.feedback);}
  function demandRows(){return readRows(KEYS.demand);}
  function passengerReputation(company){const cutoff=Date.now()-90*86400000,rows=feedbackRows().filter(x=>norm(x.company)===norm(company)&&new Date(x.createdAt).getTime()>=cutoff);if(!rows.length)return {score:80,average:4,comments:0,baseline:true};const average=rows.reduce((s,x)=>s+Number(x.rating||0),0)/rows.length;return {score:Math.round(average*20),average,comments:rows.length,baseline:false};}
  function estimateDemand(op,trip){
    const v=getVehicle(opVehicleCompany(op),op.prefix,op.busModel),profile=v?busOperationalProfile(v):{capacity:50},capacity=Math.max(1,Number(profile.capacity)||50),history=operationRouteHistory(op.company,op.city,op.line),actual=history.map(x=>Number(x.total||0)).filter(x=>x>0),econ=op.unitEconomics||{},base=actual.length?actual.reduce((a,b)=>a+b,0)/actual.length:Math.max(18,Number(econ.unitRevenue||0)/5.5||30),hour=Number(String(trip?.simStart||op.startTime||'07:00').split(':')[0]),peak=(hour>=5&&hour<10)||(hour>=16&&hour<20),night=hour>=21||hour<5,weekend=/sábado|domingo/i.test(String(op.weekday||'')),rep=passengerReputation(op.company);let multiplier=peak ? 1.32 : night ? .64 : .94;if(weekend)multiplier*=.9;multiplier*=.9+rep.score/500;let seed=gcGarageHash(`${op.id}|${trip?.tripNumber||0}`),noise=.88+(seed%25)/100;const forecast=Math.max(0,Math.round(base*multiplier*noise));return {forecast,boarded:Math.min(capacity,forecast),unserved:Math.max(0,forecast-capacity),capacity,occupancy:Math.min(100,forecast/capacity*100)};
  }
  function recordDemand(op,trip){const id=`${op.id}-trip-${trip.tripNumber}`;const rows=demandRows();if(rows.some(x=>x.id===id))return;const d=estimateDemand(op,trip);rows.push({id,operationId:op.id,tripNumber:trip.tripNumber,company:op.company,city:op.city,line:op.line,prefix:String(op.prefix),model:op.busModel,simStart:trip.simStart||op.startTime,forecast:d.forecast,boarded:d.boarded,unserved:d.unserved,capacity:d.capacity,occupancy:d.occupancy,createdAt:trip.completedAt||nowIso()});writeRows(KEYS.demand,rows.slice(-1000));}
  function renderPublicPassengerPortal(){
    if(!$id('gcPassengerPublicStats'))return;const ops=ownerOperations(),active=ops.filter(operationIsRunning),companies=ADMIN_COMPANIES,ratings=companies.map(passengerReputation),reputation=Math.round(ratings.reduce((s,x)=>s+x.score,0)/Math.max(1,ratings.length)),feedback=feedbackRows().slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    $id('gcPassengerPublicStats').innerHTML=[['Linhas em operação',active.length],['Empresas do grupo',companies.length],['Reputação média',`${reputation}/100`],['Avaliações recebidas',feedback.length]].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');
    $id('gcPassengerPublicRoutes').innerHTML=ops.length?ops.slice().reverse().map(op=>{const history=demandRows().filter(x=>x.operationId===op.id),last=history[history.length-1],d=last?{forecast:last.forecast,occupancy:last.occupancy,boarded:last.boarded,unserved:last.unserved,capacity:last.capacity}:estimateDemand(op,{tripNumber:0,simStart:op.startTime}),status=operationIsRunning(op)?'Operando':op.status==='parada técnica'?'Parada técnica':op.status==='fora de operação'?'Fora de operação':op.status==='pausada'?'Pausada':'Em preparação',badge=operationIsRunning(op)?'success':status==='Parada técnica'||status==='Fora de operação'?'danger':'warning';return `<article class="gc-passenger-route-card"><div class="gc-admin-record-head"><div><strong>${esc(op.company)} · ${esc(op.line)}</strong><small>${esc(op.city)} · ${esc(op.busModel)} · prefixo ${esc(op.prefix)}${op.vehicleCompany&&norm(op.vehicleCompany)!==norm(op.company)?` · veículo de ${esc(op.vehicleCompany)}`:''}</small></div><span class="gc-admin-badge ${badge}">${status}</span></div><div class="gc-passenger-route-stats"><span>Demanda estimada<strong>${d.forecast} passageiros</strong></span><span>Ocupação estimada<strong>${d.boarded}/${d.capacity} lugares</strong></span><span>Ocupação<strong>${numberPt(d.occupancy,0)}%</strong></span></div>${d.unserved?`<p class="gc-passenger-overload">Procura acima da capacidade estimada: ${d.unserved} passageiro(s) podem não embarcar.</p>`:''}<small>Indicadores aproximados da simulação; não são informação operacional em tempo real.</small></article>`;}).join(''):'<p class="gc-admin-empty">Nenhuma linha foi publicada no Visualizador de Operação neste navegador.</p>';
    $id('gcPassengerPublicReviews').innerHTML=feedback.length?feedback.slice(0,6).map(x=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><strong>${esc(x.alias||'Passageiro anônimo')} · ${esc(x.company)}</strong><span class="gc-admin-badge ${x.rating>=4?'success':x.rating<=2?'danger':'warning'}">${'★'.repeat(Number(x.rating)||0)}${'☆'.repeat(5-(Number(x.rating)||0))}</span></div><small>${esc(x.type)} · ${fmtDate(x.createdAt)}${x.line?` · ${esc(x.line)}`:''}</small><p>${esc(x.comment)}</p></article>`).join(''):'<p class="gc-admin-empty">Ainda não há avaliações publicadas.</p>';
  }
  function submitPassengerFeedback(event){event.preventDefault();const company=$id('gcPassengerCompany').value,comment=$id('gcPassengerComment').value.trim(),rating=Number($id('gcPassengerRating').value);if(!company||comment.length<5||rating<1||rating>5){showToast('Informe empresa, comentário e nota válida.');return;}const rows=feedbackRows();rows.push({id:makeId(),company,city:$id('gcPassengerCity').value.trim(),line:$id('gcPassengerLine').value.trim(),type:$id('gcPassengerFeedbackType').value,rating,comment,alias:$id('gcPassengerAlias').value.trim(),createdAt:nowIso(),status:'Pendente'});if(!writeRows(KEYS.feedback,rows))return;$id('gcPassengerFeedbackForm').reset();$id('gcPassengerRating').value='5';renderPublicPassengerPortal();gcAdminRenderDemand();showToast('Manifestação registrada nesta instalação do Grupo Conect.');}
  function gcAdminRenderDemand(){if(!$id('gcAdminDemandKpis'))return;const ds=demandRows().slice().reverse(),feedback=feedbackRows().slice().reverse(),avgOcc=ds.length?ds.reduce((s,x)=>s+Number(x.occupancy||0),0)/ds.length:0,unserved=ds.reduce((s,x)=>s+Number(x.unserved||0),0),reps=ADMIN_COMPANIES.map(passengerReputation),avgRep=Math.round(reps.reduce((s,x)=>s+x.score,0)/reps.length);$id('gcAdminDemandKpis').innerHTML=[['Percursos simulados',ds.length],['Ocupação média',`${numberPt(avgOcc,0)}%`],['Demanda não atendida',unserved],['Reputação média',`${avgRep}/100`]].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');$id('gcAdminDemandList').innerHTML=ds.length?ds.slice(0,35).map(x=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(x.company)} · ${esc(x.prefix)} · ${esc(x.line)}</strong><small>${esc(x.city)} · ${fmtDate(x.createdAt)} · partida simulada ${esc(x.simStart)}</small></div><span class="gc-admin-badge ${x.occupancy>=95?'danger':x.occupancy>=75?'warning':'success'}">${numberPt(x.occupancy,0)}% ocupação</span></div><small>Procura ${x.forecast} · embarcaram ${x.boarded} · não atendidos ${x.unserved} · capacidade ${x.capacity}.</small></article>`).join(''):'<p class="gc-admin-empty">As estimativas de procura aparecem após a conclusão das viagens do Visualizador de Operação.</p>';$id('gcAdminFeedbackList').innerHTML=feedback.length?feedback.slice(0,40).map(x=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(x.type)} · ${esc(x.company)}</strong><small>${fmtDate(x.createdAt)} · ${esc(x.alias||'Anônimo')} · ${Number(x.rating)||0}/5</small></div><span class="gc-admin-badge ${x.status==='Atendida'?'success':'warning'}">${esc(x.status||'Pendente')}</span></div><p>${esc(x.comment)}</p>${x.status!=='Atendida'?`<div class="gc-admin-record-actions"><button type="button" class="gc-secondary-action" data-gc-feedback-done="${esc(x.id)}">Marcar como atendida</button></div>`:''}</article>`).join(''):'<p class="gc-admin-empty">Nenhuma manifestação recebida no Portal do Passageiro.</p>';}
  function markFeedbackDone(id){const rows=feedbackRows(),row=rows.find(x=>x.id===id);if(!row)return;row.status='Atendida';row.resolvedAt=nowIso();writeRows(KEYS.feedback,rows);gcAdminRenderDemand();renderPublicPassengerPortal();}

  function vehicleOptions(){return getVehicles().map(v=>({value:gcGarageKey(v),label:adminVehicleLabel(v)}));}
  function populateVehicleSelect(id,placeholder='Selecione um ônibus'){const el=$id(id);if(!el)return;const old=el.value;el.innerHTML=`<option value="">${esc(placeholder)}</option>`+vehicleOptions().map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');if(vehicleOptions().some(x=>x.value===old))el.value=old;}
  function latestInspectionByKey(key){return readRows(KEYS.inspections).filter(x=>x.vehicleKey===key).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null;}
  function inspectionDue(key){const latest=latestInspectionByKey(key);if(!latest)return true;const due=new Date(`${latest.date}T12:00:00`);due.setDate(due.getDate()+90);return due<new Date(`${dateTodayLocal()}T12:00:00`);}
  function renderInspections(){if(!$id('gcInspectionDueSummary'))return;const vehicles=getVehicles(),due=vehicles.filter(v=>inspectionDue(gcGarageKey(v)));$id('gcInspectionDueSummary').innerHTML=[['Veículos no controle',vehicles.length],['Inspeções internas vencidas',due.length],['Retidos por reprovação',Object.values(gcGarageState()).filter(x=>x.blocked&&String(x.blockedReason||'').startsWith('Fiscalização simulada reprovada')).length]].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');populateVehicleSelect('gcInspectionVehicle');$id('gcInspectionList').innerHTML=readRows(KEYS.inspections).slice().reverse().slice(0,60).map(x=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(x.company)} · ${esc(x.prefix)} · ${esc(x.type)}</strong><small>${fmtDate(x.date)} · ${esc(x.model)}</small></div><span class="gc-admin-badge ${x.result==='aprovada'?'success':x.result==='reprovada'?'danger':'warning'}">${x.result==='aprovada'?'Aprovada':x.result==='reprovada'?'Reprovada':'Com ressalvas'}</span></div><small>Conformes: ${esc((x.passed||[]).join(', ')||'nenhum')} · Pendências: ${esc((x.failed||[]).join(', ')||'nenhuma')} ${x.fineAmount?`· Multa simulada ${money(x.fineAmount)}`:''}</small>${x.notes?`<p>${esc(x.notes)}</p>`:''}</article>`).join('')||'<p class="gc-admin-empty">Nenhuma fiscalização interna registrada.</p>';}
  function stopOperationForInspection(vehicle,reason){const rows=ownerOperations();let changed=false;rows.forEach(op=>{if(norm(opVehicleCompany(op))===norm(vehicle.company)&&String(op.prefix)===String(vehicle.prefix)&&operationIsRunning(op)){freezeOperationClock(op);op.gcInspectionPaused=true;op.gcInspectionPreviousStatus=op.status;op.status='fora de operação';op.lastEvent=reason;changed=true;}});if(changed){writeArrayKey(OPERATION_KEY,rows);renderOperations();}}
  function resumeInspectionOperations(vehicle){const current=gcGarageCurrentVehicle(vehicle);if(current?.blocked)return;const rows=ownerOperations();let changed=false;rows.forEach(op=>{if(norm(opVehicleCompany(op))===norm(vehicle.company)&&String(op.prefix)===String(vehicle.prefix)&&op.gcInspectionPaused){op.gcInspectionPaused=false;op.status=op.gcInspectionPreviousStatus==='operando com desvio'?'operando com desvio':'operando';op.clockAnchorAt=Date.now();op.lastEvent='Nova inspeção aprovada · operação liberada';delete op.gcInspectionPreviousStatus;changed=true;}});if(changed){writeArrayKey(OPERATION_KEY,rows);renderOperations();}}
  function submitInspection(event){event.preventDefault();if(!assertOwner())return;const key=$id('gcInspectionVehicle').value,v=getVehicles().find(x=>gcGarageKey(x)===key),result=$id('gcInspectionResult').value,date=$id('gcInspectionDate').value,fine=Number($id('gcInspectionFine').value)||0,checks=$$('input[name="gcInspectionCheck"]'),passed=checks.filter(x=>x.checked).map(x=>x.value),failed=checks.filter(x=>!x.checked).map(x=>x.value),critical=/freios|pneus|iluminação|saídas de emergência/i,criticalFailed=failed.filter(x=>critical.test(x));if(!v||!date){showToast('Selecione um ônibus e uma data para registrar a inspeção.');return;}if(fine>cashBreakdown().balance+0.005){showToast(`O caixa não cobre o custo/multa de ${money(fine)}. Faça um aporte ou ajuste o valor.`);return;}const rejected=result==='reprovada'||criticalFailed.length>0,actualResult=rejected?'reprovada':result,record={id:makeId(),vehicleKey:key,company:v.company,prefix:String(v.prefix),model:v.model,type:$id('gcInspectionType').value,result:actualResult,date,passed,failed,notes:$id('gcInspectionNotes').value.trim(),fineAmount:fine,createdAt:nowIso(),internalControl:true};const rows=readRows(KEYS.inspections);rows.push(record);if(!writeRows(KEYS.inspections,rows))return;if(fine>0)addCashMovement('out',fine,'Multa / custo de fiscalização simulada',`${v.company} · ${v.prefix} · ${record.type}`,`gc-inspection-fine-${record.id}`);const all=gcGarageState(),s=all[key]||gcGarageCurrentVehicle(v);if(rejected){s.blocked=true;s.blockedReason=`Fiscalização simulada reprovada: ${criticalFailed.length?criticalFailed.join(', '):record.notes||'não conformidade registrada'}`;all[key]=s;gcGarageWrite(GC_GARAGE_STATE_KEY,all);stopOperationForInspection(v,s.blockedReason);showToast(`Fiscalização registrada. ${v.prefix} ficou retido até nova inspeção aprovada e correção das pendências.`);}else{if(s&&String(s.blockedReason||'').startsWith('Fiscalização simulada reprovada')){s.blocked=false;s.blockedReason='';all[key]=s;gcGarageWrite(GC_GARAGE_STATE_KEY,all);}resumeInspectionOperations(v);showToast('Inspeção registrada. O veículo foi aprovado no controle interno.');}$id('gcInspectionForm').reset();$id('gcInspectionDate').value=dateTodayLocal();checks.forEach(x=>x.checked=true);gcAdminRenderInspection();}

  function policies(){return readRows(KEYS.policies);}
  function claims(){return readRows(KEYS.claims);}
  function coverageLabel(value){return ({comprehensive:'Compreensiva',thirdParty:'Responsabilidade civil / terceiros',passenger:'Acidentes pessoais de passageiros',fleet:'Combinada / frota'})[value]||value;}
  function policySupports(policy,type){if(policy.coverage==='fleet')return true;if(policy.coverage==='comprehensive')return ['collision','theft','fire'].includes(type);if(policy.coverage==='thirdParty')return type==='thirdParty';if(policy.coverage==='passenger')return type==='passenger';return false;}
  function processInsuranceBilling(){
    const today=dateTodayLocal(),rows=policies();let changed=false,ledger=cashLedger(),ledgerChanged=false;
    // Usa o saldo acumulado em memória durante o lote; assim duas apólices vencidas
    // não conseguem consumir o mesmo saldo duas vezes antes da gravação no Caixa.
    let available=Math.max(0,Number(cashBreakdown().balance)||0);
    rows.forEach(p=>{
      if(p.status==='Encerrada'||p.status==='Expirada')return;
      if(p.validTo&&today>p.validTo){p.status='Expirada';p.billingPending=false;changed=true;return;}
      let guard=0;
      while(p.nextDueDate&&p.nextDueDate<=today&&guard++<24){
        const dueDate=p.nextDueDate,chargeId=`gc-insurance-premium-${p.id}-${dueDate}`;
        if(ledger.some(x=>x.id===chargeId)){
          p.lastPaidDate=dueDate;p.payments=Array.isArray(p.payments)?p.payments:[];
          if(!p.payments.some(x=>x.date===dueDate))p.payments.push({date:dueDate,amount:Number(p.monthlyPremium)||0});
          p.nextDueDate=addMonthsToISO(dueDate,1);p.billingPending=false;changed=true;continue;
        }
        const amount=Math.max(0,Number(p.monthlyPremium)||0);
        if(amount>available+0.005){p.billingPending=true;p.status='Pagamento pendente';p.pendingDueDate=dueDate;changed=true;break;}
        ledger.push({id:chargeId,date:dueDate,direction:'out',amount,category:'Prêmio mensal de seguro simulado',description:`${p.company} · ${p.prefix} · apólice ${p.number}`,source:'gcAdmin',createdAt:nowIso()});
        ledgerChanged=true;available=Math.max(0,available-amount);
        p.lastPaidDate=dueDate;p.payments=Array.isArray(p.payments)?p.payments:[];p.payments.push({date:dueDate,amount});
        p.nextDueDate=addMonthsToISO(dueDate,1);p.billingPending=false;p.pendingDueDate='';p.status='Ativa';changed=true;
      }
    });
    if(ledgerChanged){if(!writeArrayKey(CASH_LEDGER_KEY,ledger))return false;updateCashUI();}
    if(changed&&!writeRows(KEYS.policies,rows))return false;
    return changed;
  }
  function estimateInsurancePremium(){const value=Number($id('gcInsuranceInsuredValue').value)||0,coverage=$id('gcInsuranceCoverage').value,rate=({comprehensive:.0025,thirdParty:.0012,passenger:.0010,fleet:.0034})[coverage]||.0025;const deductible=Number($id('gcInsuranceDeductible').value)||0,adjust=Math.max(.75,Math.min(1.4,1-(deductible/Math.max(1,value))*.25));$id('gcInsurancePremium').value=Math.max(180,value*rate*adjust).toFixed(2);}
  function submitPolicy(event){event.preventDefault();if(!assertOwner())return;const key=$id('gcInsuranceVehicle').value,v=getVehicles().find(x=>gcGarageKey(x)===key),premium=Number($id('gcInsurancePremium').value),insured=Number($id('gcInsuranceInsuredValue').value),deductible=Number($id('gcInsuranceDeductible').value);if(!v||!(premium>0)||!(insured>0)||deductible<0){showToast('Confira veículo, valor segurado, franquia e prêmio.');return;}if(premium>cashBreakdown().balance+0.005){showToast(`O Caixa não cobre o primeiro prêmio de ${money(premium)}.`);return;}const id=makeId(),today=dateTodayLocal(),row={id,number:`GC-SEG-${String(policies().length+1).padStart(5,'0')}`,vehicleKey:key,company:v.company,prefix:String(v.prefix),model:v.model,provider:$id('gcInsuranceProvider').value,coverage:$id('gcInsuranceCoverage').value,insuredValue:insured,deductible,monthlyPremium:premium,startDate:today,nextDueDate:addMonthsToISO(today,1),validTo:addMonthsToISO(today,12),status:'Ativa',createdAt:nowIso(),payments:[{date:today,amount:premium}]};if(!addCashMovement('out',premium,'Primeiro prêmio de seguro simulado',`${row.number} · ${row.company} · ${row.prefix} · ${row.provider}`,`gc-insurance-premium-${id}-${today}`))return;const rows=policies();rows.push(row);if(!writeRows(KEYS.policies,rows))return;$id('gcInsurancePolicyForm').reset();$id('gcInsuranceInsuredValue').value='450000';$id('gcInsuranceDeductible').value='12000';$id('gcInsurancePremium').value='900';gcAdminRenderInsurance();showToast(`Apólice simulada ${row.number} registrada. Próximo prêmio previsto para ${fmtDate(row.nextDueDate)}.`);}
  function submitClaim(event){event.preventDefault();if(!assertOwner())return;const p=policies().find(x=>x.id===$id('gcInsuranceClaimPolicy').value&&x.status==='Ativa'),amount=Number($id('gcInsuranceClaimAmount').value),description=$id('gcInsuranceClaimDescription').value.trim(),type=$id('gcInsuranceClaimType').value;if(!p||!(amount>0)||!description){showToast('Selecione uma apólice válida e informe o prejuízo e a descrição.');return;}const supported=policySupports(p,type),row={id:makeId(),policyId:p.id,policyNumber:p.number,company:p.company,prefix:p.prefix,type,amount,description,coverageEligible:supported,status:'Em análise',createdAt:nowIso()};const rows=claims();rows.push(row);if(!writeRows(KEYS.claims,rows))return;$id('gcInsuranceClaimForm').reset();gcAdminRenderInsurance();showToast(supported?'Sinistro registrado e aguardando sua análise.':'Sinistro registrado; o evento não parece estar coberto pela modalidade desta apólice.');}
  function decideClaim(id,approve){if(!assertOwner())return;const rows=claims(),claim=rows.find(x=>x.id===id);if(!claim||claim.status!=='Em análise')return;const policy=policies().find(x=>x.id===claim.policyId&&x.status==='Ativa');if(!approve){claim.status='Recusado pelo proprietário';claim.decidedAt=nowIso();writeRows(KEYS.claims,rows);gcAdminRenderInsurance();return;}if(!policy||!claim.coverageEligible||!policySupports(policy,claim.type)){showToast('Indenização recusada: a apólice não está ativa ou o evento não é compatível com a cobertura.');claim.status='Não coberto';claim.decidedAt=nowIso();writeRows(KEYS.claims,rows);gcAdminRenderInsurance();return;}const payout=Math.min(Math.max(0,Number(claim.amount)-Number(policy.deductible||0)),Number(policy.insuredValue)||0);if(payout>0&&!addCashMovement('in',payout,'Indenização de seguro simulada',`${policy.number} · sinistro ${claim.id.slice(-6)} · franquia ${money(policy.deductible)}`,`gc-insurance-claim-payout-${claim.id}`))return;claim.status='Indenizado';claim.payout=payout;claim.decidedAt=nowIso();writeRows(KEYS.claims,rows);gcAdminRenderInsurance();showToast(`Sinistro aprovado. Indenização simulada de ${money(payout)} lançada no Caixa.`);}
  function renderInsurance(){if(!$id('gcInsuranceSummary'))return;processInsuranceBilling();const policiesRows=policies(),claimsRows=claims(),active=policiesRows.filter(x=>x.status==='Ativa').length,pending=policiesRows.filter(x=>x.billingPending).length,open=claimsRows.filter(x=>x.status==='Em análise').length;$id('gcInsuranceSummary').innerHTML=[['Apólices ativas',active],['Prêmios pendentes',pending],['Sinistros em análise',open],['Prêmio mensal contratado',money(policiesRows.filter(x=>x.status==='Ativa').reduce((s,x)=>s+Number(x.monthlyPremium||0),0))]].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');populateVehicleSelect('gcInsuranceVehicle');const ps=$id('gcInsuranceClaimPolicy'),old=ps.value;ps.innerHTML='<option value="">Selecione apólice ativa</option>'+policiesRows.filter(x=>x.status==='Ativa').map(x=>`<option value="${esc(x.id)}">${esc(x.number)} · ${esc(x.company)} · ${esc(x.prefix)} (${esc(x.status)})</option>`).join('');if(policiesRows.some(x=>x.id===old))ps.value=old;$id('gcInsurancePolicyList').innerHTML=policiesRows.length?policiesRows.slice().reverse().map(p=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(p.number)} · ${esc(p.company)} · ${esc(p.prefix)}</strong><small>${esc(p.model)} · ${esc(p.provider)} · ${esc(coverageLabel(p.coverage))}</small></div><span class="gc-admin-badge ${p.status==='Ativa'?'success':p.status==='Expirada'?'danger':'warning'}">${esc(p.status)}</span></div><small>Segurado ${money(p.insuredValue)} · franquia ${money(p.deductible)} · prêmio ${money(p.monthlyPremium)}/mês · próximo ${fmtDate(p.nextDueDate)} · vigência até ${fmtDate(p.validTo)}</small>${p.billingPending?'<p class="gc-admin-warning">Prêmio pendente por saldo insuficiente. O sistema tentará novamente quando você abrir a central.</p>':''}</article>`).join(''):'<p class="gc-admin-empty">Nenhuma apólice registrada.</p>';$id('gcInsuranceClaimList').innerHTML=claimsRows.length?claimsRows.slice().reverse().map(c=>`<article class="gc-admin-record"><div class="gc-admin-record-head"><div><strong>${esc(c.company)} · ${esc(c.prefix)} · ${esc(c.policyNumber)}</strong><small>${esc(({collision:'Colisão',theft:'Roubo/furto',fire:'Incêndio',thirdParty:'Dano a terceiro',passenger:'Passageiro'})[c.type]||c.type)} · ${fmtDate(c.createdAt)}</small></div><span class="gc-admin-badge ${c.status==='Indenizado'?'success':c.status==='Em análise'?'warning':'danger'}">${esc(c.status)}</span></div><p>${esc(c.description)}</p><small>Prejuízo informado ${money(c.amount)} ${c.payout!==undefined?`· indenização ${money(c.payout)}`:c.coverageEligible?'· cobertura compatível':'· fora da cobertura cadastrada'}</small>${c.status==='Em análise'?`<div class="gc-admin-record-actions"><button type="button" class="gc-primary-action" data-gc-claim-approve="${esc(c.id)}">Aprovar indenização</button><button type="button" class="gc-secondary-action" data-gc-claim-reject="${esc(c.id)}">Recusar sinistro</button></div>`:''}</article>`).join(''):'<p class="gc-admin-empty">Nenhum sinistro registrado.</p>';}

  function gcAdminRenderStaff(){renderDriverSchedules();}
  function gcAdminRenderInspection(){renderInspections();}
  function gcAdminRenderInsurance(){renderInsurance();}
  function gcAdminRenderOverview(){if(!$id('gcAdminOverviewKpis'))return;const stock=fuelStock(),states=ensureFuelStates(),vehicles=getVehicles(),low=vehicles.filter(v=>{const r=states[gcGarageKey(v)];return r&&(r.fuelLiters/r.tankCapacity<.2||(r.usesScr===true&&Number(r.arlaLiters||0)/r.arlaCapacity<.2));}),due=vehicles.filter(v=>inspectionDue(gcGarageKey(v))).length,activePolicies=policies().filter(x=>x.status==='Ativa').length,activeOps=ownerOperations().filter(operationIsRunning).length;const reputation=Math.round(ADMIN_COMPANIES.reduce((s,c)=>s+passengerReputation(c).score,0)/ADMIN_COMPANIES.length);$id('gcAdminOverviewKpis').innerHTML=[['Ônibus cadastrados',vehicles.length],['Linhas operando',activeOps],['Diesel no estoque',`${numberPt(stock.diesel,0)} L`],['Reputação média',`${reputation}/100`],['Inspeções vencidas',due],['Apólices ativas',activePolicies]].map(([l,v])=>`<div class="gc-admin-kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');const alerts=[];if(stock.diesel<100)alerts.push(`<div class="gc-admin-alert warning"><strong>Estoque baixo de Diesel S10</strong><span>Restam ${numberPt(stock.diesel,1)} L. Compre combustível antes que as partidas sejam interrompidas.</span></div>`);if(stock.arla<25&&vehicles.some(v=>states[gcGarageKey(v)]?.usesScr===true))alerts.push(`<div class="gc-admin-alert warning"><strong>Estoque baixo de ARLA 32</strong><span>Restam ${numberPt(stock.arla,1)} L. Ônibus com SCR dependem deste insumo para a próxima partida.</span></div>`);if(low.length)alerts.push(`<div class="gc-admin-alert warning"><strong>${low.length} ônibus com nível baixo de insumo</strong><span>${esc(low.map(v=>v.prefix).join(', '))}. Confira os tanques e o estoque central.</span></div>`);if(due)alerts.push(`<div class="gc-admin-alert danger"><strong>${due} inspeção(ões) interna(s) vencida(s)</strong><span>Abra a aba Fiscalização para registrar a conferência de controle.</span></div>`);const pendingOps=ownerOperations().filter(x=>x.gcFuelPaused);if(pendingOps.length)alerts.push(`<div class="gc-admin-alert danger"><strong>${pendingOps.length} operação(ões) aguardando abastecimento</strong><span>${esc(pendingOps.map(x=>`${x.company} ${x.prefix}`).join(' · '))}.</span></div>`);$id('gcAdminOverviewAlerts').innerHTML=alerts.join('')||'<p class="gc-admin-empty">Nenhum alerta crítico da Central de Gestão neste momento.</p>';}
  function renderAll(){if(!$id('gcFleetAdminPanel'))return;ensureFuelStates();gcAdminRenderOverview();gcAdminRenderFuel();gcAdminRenderStaff();gcAdminRenderDemand();gcAdminRenderInspection();gcAdminRenderInsurance();}
  function openAdminPanel(tab='overview'){if(!assertOwner())return;const p=$id('gcFleetAdminPanel');if(!p)return;p.hidden=false;$$('[data-gc-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.gcAdminTab===tab));$$('#gcFleetAdminPanel .gc-admin-view').forEach(v=>v.hidden=v.id!==`gcAdminView${tab[0].toUpperCase()+tab.slice(1)}`);renderAll();p.scrollIntoView({behavior:'smooth',block:'start'});}
  function switchAdminTab(tab){if(!assertOwner())return;$$('[data-gc-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.gcAdminTab===tab));$$('#gcFleetAdminPanel .gc-admin-view').forEach(v=>v.hidden=v.id!==`gcAdminView${tab[0].toUpperCase()+tab.slice(1)}`);if(tab==='insurance')renderInsurance();if(tab==='fuel')gcAdminRenderFuel();if(tab==='staff')gcAdminRenderStaff();if(tab==='demand')gcAdminRenderDemand();if(tab==='inspection')gcAdminRenderInspection();}

  function renderHomeAlert(){
    if(!$id('gcAdminOverviewAlerts'))return;
    gcAdminRenderOverview();
  }
  function gcAdminPrepareOperationResume(op,options={}){
    const silent=options.silent===true;
    const fail=(message,action='')=>{
      if(!silent){
        if(action==='garage'&&typeof gcGarageOpen==='function'){gcGarageOpen();gcGarageSetTab('alerts');}
        else if(action==='agenda'&&typeof gcGarageOpenFromAgenda==='function'){gcGarageOpenFromAgenda(op?.garagePreTripEventId);}
        else if(action==='inspection')openAdminPanel('inspection');
        else if(action==='fuel')openAdminPanel('fuel');
        showToast(message);
      }
      return {ok:false,message};
    };
    if(!op)return fail('Não foi possível localizar a operação para retomada.');
    if(options.onlyIfFuelPaused&&!op.gcFuelPaused)return {ok:false,skipped:true};
    if(op.pendingVehicleSwap?.busAtTerminal)return fail(`O ônibus atual já chegou ao ${op.pendingVehicleSwap.terminal||'terminal'} e está aguardando o substituto ${op.pendingVehicleSwap.replacementPrefix}. Não retome antes do encontro.`);
    if(op.gcIncidentActive&&!op.gcIncidentActive.manualRelease&&op.gcIncidentActive.effect==='stop'&&Number(op.gcIncidentActive.endsAtMs)>Date.now())return fail(`A decisão de segurança ainda está dentro do prazo de ${op.gcIncidentActive.durationMinutes} minutos simulados. Aguarde o encerramento da ocorrência ou registre uma nova decisão autorizada.`);
    if(op.replacementDispatch)return fail('O ônibus substituto ainda está em deslocamento. A linha será liberada automaticamente quando ele chegar.');
    if(op.gcInspectionPaused)return fail('A operação continua retida por uma fiscalização reprovada. Regularize as pendências e registre nova inspeção aprovada.','inspection');
    if(op.gcUserMaintenanceHoldOrderId){
      const pendingOrder=typeof gcGarageOrders==='function'?gcGarageOrders().find(x=>x.id===op.gcUserMaintenanceHoldOrderId):null;
      if(pendingOrder&&!['Aprovada','Cancelada'].includes(pendingOrder.status))return fail(`Retomada impedida: o ônibus foi encaminhado à oficina por sua decisão (OS ${pendingOrder.number}). Aguarde a conclusão e aprove o serviço.`,'garage');
      if(pendingOrder?.status==='Cancelada') {delete op.gcUserMaintenanceHoldOrderId;delete op.gcMaintenancePreviousStatus;delete op.gcMaintenanceStoppedByOrder;}
    }

    const vehicle=getVehicle(opVehicleCompany(op),op.prefix,op.busModel);
    if(vehicle){
      const mechanical=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(vehicle):null;
      if(mechanical?.blocked)return fail(`Retomada impedida: o prefixo ${op.prefix} continua bloqueado pela oficina (${mechanical.blockedReason||'pane mecânica pendente'}). Conclua e aprove o reparo antes de retomar.`,'garage');
      const workshopOrder=typeof gcGarageOrders==='function'?gcGarageOrders().find(x=>x.vehicleKey===gcGarageKey(vehicle)&&!['Aprovada','Cancelada'].includes(x.status)):null;
      if(workshopOrder)return fail(`Retomada impedida: o prefixo ${op.prefix} ainda está na oficina pela OS ${workshopOrder.number} (${workshopOrder.status}).`,'garage');
    }
    const openAlert=typeof gcGarageAlerts==='function'?gcGarageAlerts().find(a=>!a.resolvedAt&&(a.operationId===op.id||(vehicle&&a.vehicleKey===gcGarageKey(vehicle)))):null;
    if(openAlert)return fail(`Retomada impedida: existe uma ocorrência mecânica aberta para o prefixo ${op.prefix}. Resolva-a na Garagem → Alertas e panes.`,'garage');

    // Tarefas preventivas da Agenda são lembretes: não bloqueiam a linha por si sós.
    // Pane confirmada, retenção oficial, OS aberta por decisão do dono e falta de insumo continuam bloqueando.
    let fuelResult={ok:true,skipped:true};
    if(vehicle){
      const f=fuelState(vehicle),distance=f?.distancePerTripKm||35;
      fuelResult=prepareFuelForTrip(vehicle,distance,`retomada da operação ${op.line} · próxima viagem ${Math.max(1,(Number(op.completedTrips)||0)+1)}`);
      if(!fuelResult.ok)return fail(`Retomada impedida por combustível/ARLA 32: ${fuelResult.reason} Verifique estoque e abastecimento na Central de Gestão → Combustível.`,'fuel');
      op.gcFuelPreparedTrip=Math.max(1,(Number(op.completedTrips)||0)+1);
    }

    const resumeAsDetour=Boolean(op.gcIncidentActive?.effect==='detour'&&Number(op.gcIncidentActive.endsAtMs)>Date.now());
    op.status=resumeAsDetour?'operando com desvio':'operando';
    op.clockAnchorAt=Date.now();
    op.elapsedSeconds=Math.max(0,Number(op.elapsedSeconds)||0);
    op.gcFuelPaused=false;
    delete op.gcFuelPreviousStatus;
    delete op.gcResumeStatus;
    op.lastEvent=`Operação retomada por Pablo${resumeAsDetour?' · desvio autorizado mantido':''}${fuelResult.dieselAdded||fuelResult.arlaAdded?' · abastecimento automático pré-partida realizado':''}`;
    return {ok:true,status:op.status,message:resumeAsDetour?'Operação retomada; o desvio autorizado foi mantido.':'Operação retomada; verificações de veículo e abastecimento concluídas.'};
  }
  window.gcAdminResumeOperation=gcAdminPrepareOperationResume;

  function gcAdminResumeFuelPausedOperations(){
    if(!ownerAllowed())return;const rows=ownerOperations();let changed=false;
    rows.forEach(op=>{
      if(!op.gcFuelPaused)return;
      const result=gcAdminPrepareOperationResume(op,{silent:true,onlyIfFuelPaused:true,source:'reposição de estoque'});
      if(result.ok)changed=true;
    });
    if(changed){writeArrayKey(OPERATION_KEY,rows);renderOperations();gcAdminRenderOverview();showToast('Estoque liberado. Operação(ões) retomada(s) após a conferência de mecânica, inspeção e abastecimento.');}
  }
  const originalActivate=gcActivateOperation;
  gcActivateOperation=function(op){
    if(!ownerAllowed())return originalActivate(op);
    const vehicle=getVehicle(opVehicleCompany(op),op.prefix,op.busModel);
    if(vehicle){const workshopOrder=gcGarageOrders().find(x=>x.vehicleKey===gcGarageKey(vehicle)&&!['Aprovada','Cancelada'].includes(x.status));if(workshopOrder){showToast(`Partida bloqueada: prefixo ${op.prefix} está na oficina pela OS ${workshopOrder.number}.`);gcGarageOpen();gcGarageSetTab('orders');return false;}}
    const driver=gcDriverForOperationStart(op),schedule=scheduleRows().filter(x=>x.status!=='Cancelada'&&x.driverName===driver&&norm(x.company)===norm(op.company)&&x.date===dateTodayLocal());
    if(schedule.length){const minute=opParseTime(op.startTime),covered=schedule.some(s=>{const r=scheduleRange(s),base=new Date(`${s.date}T00:00:00`).getTime(),startMin=(r.start-base)/60000,endMin=(r.end-base)/60000,point=minute+(endMin>1440&&minute<startMin?1440:0);return point>=startMin&&point<endMin;});if(!covered){showToast(`Partida bloqueada: ${driver} não tem escala cobrindo ${op.startTime} em ${dateTodayLocal()}.`);return false;}}
    if(vehicle){const f=fuelState(vehicle),prepared=prepareFuelForTrip(vehicle,f?.distancePerTripKm||35,`operação ${op.line} · primeira partida`);if(!prepared.ok){showToast(`Partida bloqueada por falta de insumo. ${prepared.reason} Abra Área do Dono → Central de Gestão → Combustível.`);return false;}op.gcFuelPreparedTrip=Math.max(1,Number(op.completedTrips||0)+1);op.gcFuelConsumedTrips=Math.max(0,Number(op.completedTrips)||0);op.gcDemandProcessedTrips=Math.max(0,Number(op.completedTrips)||0);}
    return originalActivate(op);
  };
  const originalSyncOne=syncOneOperationProgress;
  syncOneOperationProgress=function(op,now=Date.now()){
    if(op?.gcInspectionPaused&&operationIsRunning(op)){freezeOperationClock(op,now);op.status='fora de operação';op.lastEvent='RETIDO PELA FISCALIZAÇÃO · aguarda nova inspeção aprovada';return true;}
    const before=Math.max(0,Number(op.completedTrips)||0);if(!Number.isFinite(Number(op.gcFuelConsumedTrips)))op.gcFuelConsumedTrips=before;if(!Number.isFinite(Number(op.gcDemandProcessedTrips)))op.gcDemandProcessedTrips=before;
    let changed=originalSyncOne(op,now);const after=Math.max(0,Number(op.completedTrips)||0),v=getVehicle(opVehicleCompany(op),op.prefix,op.busModel);
    if(after>Number(op.gcFuelConsumedTrips||0)){
      const from=Number(op.gcFuelConsumedTrips||0),logs=(op.tripLog||[]).filter(t=>Number(t.tripNumber)>from&&Number(t.tripNumber)<=after).sort((a,b)=>Number(a.tripNumber)-Number(b.tripNumber));
      logs.forEach(t=>{const tripVehicle=getVehicle(t.vehicleCompany||opVehicleCompany(op),t.prefix||op.prefix,t.busModel||op.busModel);if(tripVehicle){const f=fuelState(tripVehicle);consumeFuel(tripVehicle,f?.distancePerTripKm||35,`operação ${op.line} · viagem ${t.tripNumber}`);}recordDemand(op,t);});
      op.gcFuelConsumedTrips=after;op.gcDemandProcessedTrips=after;changed=true;
    }
    if(v&&operationIsRunning(op)){
      const elapsed=opElapsedSeconds(op,now),virtualNow=opParseTime(op.startTime)+elapsed/60,nextIndex=Math.max(0,Number(op.completedTrips)||0),next=opTripScheduleAt(op,nextIndex),preparedIndex=Number(op.gcFuelPreparedTrip)||0;
      if(virtualNow>=next.start-.02&&preparedIndex!==nextIndex+1){const f=fuelState(v),prepared=prepareFuelForTrip(v,f?.distancePerTripKm||35,`operação ${op.line} · pré-partida ${nextIndex+1}`);if(prepared.ok){op.gcFuelPreparedTrip=nextIndex+1;if(op.gcFuelPaused){op.gcFuelPaused=false;delete op.gcFuelPreviousStatus;op.lastEvent=prepared.manual?'Autonomia confirmada · abastecimento pré-partida validado':'Abastecimento automático concluído · próxima viagem liberada';}changed=true;}else{op.gcFuelPreviousStatus=op.status;freezeOperationClock(op,now);op.status='parada técnica';op.gcFuelPaused=true;op.lastEvent=`ABASTECIMENTO PENDENTE · ${prepared.reason}`;changed=true;}}
    }
    return changed;
  };

  // Para viagens que passam pelo validador (normal, intermunicipal e fretamento),
  // respeita a escala lançada pelo proprietário. Se não existir escala cadastrada
  // para aquela pessoa nesta data, mantém compatibilidade com operações antigas.
  $id('validatorConfirmStart')?.addEventListener('click',event=>{
    const p=state.pendingJourney;if(!p||!ownerAllowed())return;
    const j=p.journey||{},driver=String(p.driver||j.driver||'').trim(),company=String(p.company||j.company||'').trim();
    if(!driver||!company)return;
    const today=dateTodayLocal(),matching=scheduleRows().filter(x=>x.status!=='Cancelada'&&x.date===today&&norm(x.driverName)===norm(driver)&&norm(x.company)===norm(company));
    if(!matching.length)return;
    const now=new Date(),minute=now.getHours()*60+now.getMinutes(),covered=matching.some(s=>{const r=scheduleRange(s),base=new Date(`${s.date}T00:00:00`).getTime(),startMin=(r.start-base)/60000,endMin=(r.end-base)/60000,point=endMin>1440&&minute<startMin?minute+1440:minute;return point>=startMin&&point<endMin;});
    if(!covered){event.preventDefault();event.stopImmediatePropagation();showToast(`Partida bloqueada: ${driver} não possui escala cobrindo o horário atual (${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}). Ajuste a escala na Central de Gestão.`);}
  },true);

  // Abastecimento antes da confirmação da partida: intercepta apenas o clique válido,
  // depois das inspeções pré-operacionais já existentes.
  $id('validatorConfirmStart')?.addEventListener('click',event=>{
    const p=state.pendingJourney;if(!p)return;const j=p.journey||{},v=getVehicle(p.company||j.company,p.prefix||j.busPrefix,p.model||j.busModel);if(!v)return;
    const f=fuelState(v),result=prepareFuelForTrip(v,f?.distancePerTripKm||35,`validador · ${p.type||'viagem'} · ${p.line||j.line||''}`);
    if(!result.ok){event.preventDefault();event.stopImmediatePropagation();showToast(`Partida bloqueada por falta de insumo. ${result.reason} Compre combustível na Central de Gestão.`);return;}
    p.gcAdminFuelVehicleKey=gcGarageKey(v);p.gcAdminFuelType=p.type||'normal';
    if(p.type!=='normal')setTimeout(()=>{const log=gcValidatorLogs().slice(-1)[0];if(log&&log.status==='started'&&log.company===v.company&&String(log.prefix)===String(v.prefix)){const row=fuelState(v);consumeFuel(v,row?.distancePerTripKm||35,`${p.type} · ${p.line||''}`);gcAdminRenderFuel();}},80);
  },true);
  const originalBeginJourney=gcBeginNormalJourney;
  gcBeginNormalJourney=function(journey,validatorLogId){originalBeginJourney(journey,validatorLogId);const v=getVehicle(journey.company,journey.busPrefix,journey.busModel);if(!v)return;const r=fuelState(v);$id('tankCapacity').value=String(r.tankCapacity);$id('tankInitialPercent').value=String(Math.round(r.fuelLiters/r.tankCapacity*1000)/10);$id('tankCurrentPercent').value=$id('tankInitialPercent').value;$id('dieselPrice').value=Number(fuelPrices().diesel).toFixed(2);if(typeof updateCalculation==='function')updateCalculation();};
  $id('finishTrip')?.addEventListener('click',()=>{const prior=loadHistory()[0]?.id;setTimeout(()=>{const trip=loadHistory()[0];if(!trip||trip.id===prior)return;const v=getVehicle(trip.company,trip.busPrefix,trip.busModel);if(!v)return;const r=fuelState(v),capacity=Number(trip.tankCapacity)||r.tankCapacity,percent=Math.max(0,Math.min(100,Number(trip.currentPercent)||0));r.fuelLiters=capacity*percent/100;if(r.usesScr===true)r.arlaLiters=Math.max(0,Number(r.arlaLiters||0)-(Number(trip.liters)||0)*.04);saveFuelState(r);fuelLog({type:'consumo registrado',product:'Diesel S10',liters:Number(trip.liters)||0,arlaLiters:r.usesScr===true?(Number(trip.liters)||0)*.04:0,company:r.company,prefix:r.prefix,reference:`viagem normal ${trip.city||''} · ${trip.line||''}`,description:`Tanque informado ao encerrar a viagem: ${numberPt(percent,1)}%.`});gcAdminRenderFuel();},100);});

  // Interação de painéis e formulários.
  $id('gcFleetAdminOpenButton')?.addEventListener('click',()=>openAdminPanel('overview'));
  $id('gcFleetAdminCloseButton')?.addEventListener('click',()=>{$id('gcFleetAdminPanel').hidden=true;});
  $$('[data-gc-admin-tab]').forEach(b=>b.addEventListener('click',()=>switchAdminTab(b.dataset.gcAdminTab)));
  $$('[data-gc-admin-go]').forEach(b=>b.addEventListener('click',()=>switchAdminTab(b.dataset.gcAdminGo)));
  $id('gcFuelPurchaseForm')?.addEventListener('submit',purchaseFuel);
  ['gcFuelPurchaseType','gcFuelPurchaseLiters'].forEach(id=>$id(id)?.addEventListener('input',updatePurchasePreview));
  $id('gcFuelSaveSettings')?.addEventListener('click',saveFuelSettings);
  $id('gcFuelRefreshFleet')?.addEventListener('click',()=>{ensureFuelStates();gcAdminRenderFuel();showToast('Níveis dos tanques atualizados.');});
  $id('gcFuelFleetList')?.addEventListener('change',event=>{const scr=event.target.closest('[data-gc-fuel-scr]'),dist=event.target.closest('[data-gc-fuel-distance]');if(scr){const row=fuelState(scr.dataset.gcFuelScr);if(!row)return;row.usesScr=scr.value==='unknown'?null:scr.value==='yes';if(row.usesScr===true&&row.arlaLiters===null)row.arlaLiters=row.arlaCapacity*.55;if(row.usesScr!==true)row.arlaLiters=null;saveFuelState(row);const mech=gcGarageState();if(mech[row.key]){mech[row.key].scr=row.usesScr;gcGarageWrite(GC_GARAGE_STATE_KEY,mech);}gcAdminRenderFuel();}if(dist){const row=fuelState(dist.dataset.gcFuelDistance),value=Number(dist.value);if(row&&value>=1&&value<=1500){row.distancePerTripKm=value;saveFuelState(row);}}});
  $id('gcFuelFleetList')?.addEventListener('click',event=>{const b=event.target.closest('[data-gc-fuel-fill]');if(b)fillVehicleNow(b.dataset.gcFuelFill);});
  $id('gcDriverScheduleCompany')?.addEventListener('change',refreshScheduleDrivers);
  $id('gcDriverScheduleForm')?.addEventListener('submit',submitDriverSchedule);
  $id('gcDriverScheduleList')?.addEventListener('click',event=>{const b=event.target.closest('[data-gc-schedule-cancel]');if(!b)return;if(!assertOwner())return;const rows=scheduleRows(),row=rows.find(x=>x.id===b.dataset.gcScheduleCancel);if(row){row.status='Cancelada';row.cancelledAt=nowIso();writeRows(KEYS.driverSchedules,rows);gcAdminRenderStaff();showToast('Escala cancelada; o histórico foi preservado.');}});
  $id('gcPassengerFeedbackForm')?.addEventListener('submit',submitPassengerFeedback);
  $id('gcPassengerRefreshPublic')?.addEventListener('click',renderPublicPassengerPortal);
  $id('gcAdminFeedbackList')?.addEventListener('click',event=>{const b=event.target.closest('[data-gc-feedback-done]');if(b)markFeedbackDone(b.dataset.gcFeedbackDone);});
  $id('gcInspectionForm')?.addEventListener('submit',submitInspection);
  $id('gcInsurancePolicyForm')?.addEventListener('submit',submitPolicy);
  $id('gcInsuranceEstimate')?.addEventListener('click',estimateInsurancePremium);
  $id('gcInsuranceClaimForm')?.addEventListener('submit',submitClaim);
  $id('gcInsuranceClaimList')?.addEventListener('click',event=>{const approve=event.target.closest('[data-gc-claim-approve]'),reject=event.target.closest('[data-gc-claim-reject]');if(approve)decideClaim(approve.dataset.gcClaimApprove,true);if(reject)decideClaim(reject.dataset.gcClaimReject,false);});

  const originalSwitchScreen=switchScreen;
  switchScreen=function(screenId){originalSwitchScreen(screenId);if(screenId==='passengerPortalScreen')renderPublicPassengerPortal();if(screenId==='ownerAreaScreen'&&ownerAllowed())gcAdminRenderOverview();};
  const originalActivateOwner=activateOwnerArea;
  activateOwnerArea=function(){originalActivateOwner();if(ownerAllowed()){ensureFuelStates();gcAdminRenderOverview();}};

  function gcAdminInit(){
    if(!$id('gcFleetAdminPanel'))return;
    ensureFuelStates();
    if($id('gcDriverScheduleDate'))$id('gcDriverScheduleDate').value=dateTodayLocal();
    if($id('gcInspectionDate'))$id('gcInspectionDate').value=dateTodayLocal();
    const prices=fuelPrices();if($id('gcFuelDieselPrice'))$id('gcFuelDieselPrice').value=Number(prices.diesel).toFixed(2);if($id('gcFuelArlaPrice'))$id('gcFuelArlaPrice').value=Number(prices.arla).toFixed(2);if($id('gcFuelAutoEnabled'))$id('gcFuelAutoEnabled').checked=fuelAuto();
    updatePurchasePreview();renderPublicPassengerPortal();
    if(ownerAllowed())renderAll();
  }
  gcAdminInit();
  setInterval(()=>{try{if(ownerAllowed()){processInsuranceBilling();if(!$id('gcFleetAdminPanel')?.hidden)renderAll();}}catch(e){console.warn('[Grupo Conect] Ciclo administrativo:',e);}},30000);
  console.info('[Grupo Conect] Central de Gestão Operacional carregada.');
})();


// Arquivo independente do Visualizador de Operação (não substitui o backup geral do site).
(function installOperationArchiveTools(){
  const $id=(id)=>document.getElementById(id);
  const ARCHIVE_SCHEMA='grupo-conect-operation-viewer-archive';
  const ARCHIVE_VERSION=1;
  function cloneJson(value){return JSON.parse(JSON.stringify(value));}
  function archiveStatus(message,isError=false){const el=$id('ovArchiveStatus');if(el){el.textContent=message;el.classList.toggle('is-error',isError);}}
  function viewerArchivePayload(){
    const cashState=typeof readOperationCashState==='function'?readOperationCashState():{totalNet:0,operationNets:{},lastTripCounts:{},entries:[]};
    return {
      schema:ARCHIVE_SCHEMA,version:ARCHIVE_VERSION,app:'Grupo Conect',createdAt:new Date().toISOString(),
      data:{
        operations:cloneJson(ownerOperations()),
        normalTripHistory:cloneJson(loadHistory()),
        operationCashState:cloneJson(cashState),
        virtualDriverCounts:cloneJson(readObjectKey(DRIVER_COUNT_KEY)),
        dayCount:Math.max(1,Number(localStorage.getItem(DAY_COUNT_KEY)||1)||1),
        activeDay:localStorage.getItem(ACTIVE_DAY_KEY)||'day-1'
      }
    };
  }
  function downloadArchive(){
    if(!assertOwner())return;
    try{
      const payload=viewerArchivePayload(),blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),a=document.createElement('a'),stamp=new Date().toISOString().slice(0,10);
      a.href=url;a.download=`Grupo_Conect_Visualizador_${stamp}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
      const trips=payload.data.normalTripHistory.length,lines=payload.data.operations.length,logged=payload.data.operations.reduce((sum,op)=>sum+(Number(op.completedTrips)||0),0);
      archiveStatus(`Arquivo criado em ${new Date().toLocaleString('pt-BR')}: ${lines} linha(s), ${logged} viagem(ns) concluída(s) no Visualizador e ${trips} viagem(ns) do histórico normal dos Dias 1…${payload.data.dayCount}. O Caixa e os outros módulos não foram alterados.`);
      showToast('Arquivo do Visualizador salvo. Guarde o JSON fora do navegador.');
    }catch(error){console.error('[Grupo Conect] Falha ao exportar Visualizador:',error);archiveStatus('Não foi possível gerar o arquivo. Verifique o espaço disponível e tente novamente.',true);showToast('Falha ao salvar os dados do Visualizador.');}
  }
  function operationIdentity(op){
    return [op.company,op.city,op.line,op.prefix,op.weekday,op.startTime].map(x=>profitMatchKey(x||'')).join('|');
  }
  function tripLogSignature(trip){return `${trip.tripNumber||''}|${trip.completedAt||''}|${trip.driver||''}`;}
  function mergeOperationRows(currentRows,archiveRows,archiveCreatedAt){
    const rows=Array.isArray(currentRows)?currentRows.map(cloneJson):[],byId=new Map(rows.map((op,i)=>[String(op.id||''),i]));
    const routeIndex=new Map(rows.map((op,i)=>[operationIdentity(op),i]));
    let restored=0,updated=0,skipped=0;
    for(const savedRaw of archiveRows){
      if(!savedRaw||typeof savedRaw!=='object'||!String(savedRaw.id||'').trim()||!String(savedRaw.company||'').trim()||!String(savedRaw.line||'').trim()) {skipped++;continue;}
      const saved=cloneJson(savedRaw),id=String(saved.id),exact=byId.get(id),route=operationIdentity(saved),sameRoute=routeIndex.get(route),idx=exact!==undefined?exact:sameRoute;
      if(idx===undefined){
        if(operationIsRunning(saved)){
          const snapshotTime=Date.parse(archiveCreatedAt)||Date.now();
          saved.elapsedSeconds=opElapsedSeconds(saved,snapshotTime);
          saved.clockAnchorAt=Date.now();
        }
        rows.push(saved);const newIndex=rows.length-1;byId.set(id,newIndex);routeIndex.set(route,newIndex);restored++;continue;
      }
      const current=rows[idx];
      const savedTrips=Math.max(0,Number(saved.completedTrips)||0),currentTrips=Math.max(0,Number(current.completedTrips)||0);
      // Para a mesma linha/veículo/escala, conserva a cópia com mais progresso e não cria duplicata.
      const savedWins=savedTrips>currentTrips||(savedTrips===currentTrips&&exact===undefined);
      const preferred=cloneJson(savedWins?saved:current),other=savedWins?current:saved;
      const combinedLog=[...(Array.isArray(preferred.tripLog)?preferred.tripLog:[]),...(Array.isArray(other.tripLog)?other.tripLog:[])];
      const uniqueLog=new Map();combinedLog.forEach(t=>uniqueLog.set(tripLogSignature(t),t));
      preferred.tripLog=[...uniqueLog.values()].sort((a,b)=>String(a.completedAt||'').localeCompare(String(b.completedAt||''))).slice(-250);
      preferred.completedTrips=Math.max(savedTrips,currentTrips);
      const pTotals=Object.values(preferred.driverTotals||{}).reduce((n,x)=>n+(Number(x.trips)||0),0),oTotals=Object.values(other.driverTotals||{}).reduce((n,x)=>n+(Number(x.trips)||0),0);
      if(oTotals>pTotals)preferred.driverTotals=cloneJson(other.driverTotals||{});
      const incidents=new Map();[...(preferred.incidentHistory||[]),...(other.incidentHistory||[])].forEach(x=>incidents.set(String(x.id||`${x.type}|${x.occurredAt}`),x));
      preferred.incidentHistory=[...incidents.values()];
      if(operationIsRunning(preferred)){
        const snapshotTime=Date.parse(archiveCreatedAt)||Date.now();
        preferred.elapsedSeconds=opElapsedSeconds(preferred,snapshotTime);
        preferred.clockAnchorAt=Date.now();
      }
      rows[idx]=preferred;byId.set(String(preferred.id),idx);routeIndex.set(operationIdentity(preferred),idx);updated++;
      if(exact===undefined&&id!==String(preferred.id))byId.delete(id);
    }
    return {rows,restored,updated,skipped};
  }
  function mergeTripHistory(currentRows,archiveRows){
    const map=new Map();
    (Array.isArray(currentRows)?currentRows:[]).forEach(t=>{if(t&&t.id)map.set(String(t.id),t);});
    (Array.isArray(archiveRows)?archiveRows:[]).forEach(t=>{if(t&&t.id&&!map.has(String(t.id)))map.set(String(t.id),{...t,dayId:t.dayId||'day-1'});});
    return [...map.values()].sort((a,b)=>String(b.timestamp||b.completedAt||'').localeCompare(String(a.timestamp||a.completedAt||''))).slice(0,2000);
  }
  function mergeOperationCashState(current,saved){
    const result={totalNet:0,operationNets:{...(current.operationNets||{})},lastTripCounts:{...(current.lastTripCounts||{})},entries:[]};
    const keys=new Set([...Object.keys(current.lastTripCounts||{}),...Object.keys(saved.lastTripCounts||{})]);
    keys.forEach(id=>{
      const c=Number(current.lastTripCounts?.[id])||0,s=Number(saved.lastTripCounts?.[id])||0;
      if(s>c){result.lastTripCounts[id]=s;result.operationNets[id]=Number(saved.operationNets?.[id])||0;}
      else if(c>=s){result.lastTripCounts[id]=c;result.operationNets[id]=Number(current.operationNets?.[id])||0;}
    });
    const entries=new Map();[...(current.entries||[]),...(saved.entries||[])].forEach(e=>{if(e?.id)entries.set(String(e.id),e);});
    result.entries=[...entries.values()].slice(-5000);
    result.totalNet=Object.values(result.operationNets).reduce((sum,n)=>sum+(Number(n)||0),0);
    return result;
  }
  function restoreArchiveFile(file){
    if(!assertOwner())return;
    if(!file){archiveStatus('Selecione um arquivo JSON válido.',true);return;}
    if(file.size>50*1024*1024){archiveStatus('Arquivo acima de 50 MB. Selecione um arquivo menor ou use o backup geral do site.',true);return;}
    const reader=new FileReader();
    reader.onerror=()=>archiveStatus('Não foi possível ler o arquivo selecionado.',true);
    reader.onload=()=>{
      try{
        const archive=JSON.parse(String(reader.result||'')),data=archive?.data;
        if(archive?.schema!==ARCHIVE_SCHEMA||archive?.version!==ARCHIVE_VERSION||archive?.app!=='Grupo Conect'||!data||!Array.isArray(data.operations)||!Array.isArray(data.normalTripHistory))throw new Error('Formato incompatível ou arquivo incompleto. O arquivo precisa usar o schema e o app Grupo Conect na versão 1.');
        const archiveTrips=data.normalTripHistory.length,archiveRows=data.operations.length,archiveLogs=data.operations.reduce((n,op)=>n+(Array.isArray(op.tripLog)?op.tripLog.length:0),0),archiveFinance=(data.operationCashState?.entries||[]).length,archiveNet=Number(data.operationCashState?.totalNet)||0;
        const preview=`Arquivo Grupo Conect · Visualizador v${archive.version}\nCriado em: ${archive.createdAt||'não informado'}\n\n${archiveRows} operação(ões) / linha(s)\n${archiveLogs} viagens concluídas nos logs operacionais\n${archiveTrips} viagens no histórico normal\n${archiveFinance} lançamentos detalhados do Visualizador\nResultado operacional consolidado: ${money(archiveNet)}\n\nA restauração mescla as linhas e históricos, concilia os IDs financeiros e preserva as demais áreas. Um backup geral de segurança será baixado antes de gravar. Continuar?`;
        if(!window.confirm(preview))return;
        try{const safety=typeof collectBackup==='function'?collectBackup():null;if(safety)downloadTextFile(`seguranca-antes-restaurar-visualizador-${dateTodayLocal()}-${Date.now()}.json`,JSON.stringify(safety,null,2),'application/json;charset=utf-8');}catch(safetyError){throw new Error(`Não foi possível preparar o backup de segurança: ${safetyError.message||'falha de exportação'}. A restauração foi cancelada.`);}
        const merged=mergeOperationRows(ownerOperations(),data.operations,archive.createdAt);
        const mergedHistory=mergeTripHistory(loadHistory(),data.normalTripHistory);
        const cashCurrent=readOperationCashState(),cashSaved=data.operationCashState&&typeof data.operationCashState==='object'?data.operationCashState:{totalNet:0,operationNets:{},lastTripCounts:{},entries:[]};
        const mergedCash=mergeOperationCashState(cashCurrent,cashSaved);
        // Restauração transacional: se uma gravação falhar por quota, tenta reverter
        // as chaves anteriores para não deixar linhas, histórico e caixa desencontrados.
        const restoreKeys=[OPERATION_KEY,HISTORY_KEY,OPERATION_CASH_STATE_KEY,DRIVER_COUNT_KEY,DAY_COUNT_KEY,ACTIVE_DAY_KEY];
        const before=new Map(restoreKeys.map(key=>[key,localStorage.getItem(key)]));
        try{
          if(!writeArrayKey(OPERATION_KEY,merged.rows))throw new Error('Não foi possível gravar as linhas no navegador.');
          if(!saveHistory(mergedHistory))throw new Error('Não foi possível gravar o histórico normal de viagens.');
          if(!writeOperationCashState(mergedCash))throw new Error('Não foi possível gravar o controle de contabilização do Visualizador.');
          const counts={...(data.virtualDriverCounts||{}),...readObjectKey(DRIVER_COUNT_KEY)};
          if(!writeObjectKey(DRIVER_COUNT_KEY,counts))throw new Error('Não foi possível gravar a contagem de motoristas virtuais.');
          const dayCount=Math.max(1,Number(localStorage.getItem(DAY_COUNT_KEY)||1)||1,Number(data.dayCount)||1,...mergedHistory.map(t=>Number(String(t.dayId||'day-1').replace('day-',''))||1));
          localStorage.setItem(DAY_COUNT_KEY,String(dayCount));
          if(typeof state==='object'&&state)state.dayCount=dayCount;
          const active=localStorage.getItem(ACTIVE_DAY_KEY)||data.activeDay||'day-1';
          const activeNum=Number(String(active).replace('day-',''))||1;
          localStorage.setItem(ACTIVE_DAY_KEY,activeNum<=dayCount&&activeNum>=1?`day-${activeNum}`:'day-1');
          // Leitura de retorno: não declarar a importação concluída sem conferir os dados gravados.
          const checkOperations=readArrayKey(OPERATION_KEY),checkHistory=loadHistory(),checkCash=readOperationCashState();
          if(checkOperations.length!==merged.rows.length)throw new Error('A conferência das linhas não corresponde à quantidade gravada.');
          if(checkHistory.length!==mergedHistory.length)throw new Error('A conferência do histórico normal não corresponde à quantidade gravada.');
          if((checkCash.entries||[]).length!==(mergedCash.entries||[]).length||Math.abs((Number(checkCash.totalNet)||0)-(Number(mergedCash.totalNet)||0))>0.01)throw new Error('A conferência dos lançamentos financeiros do Visualizador falhou.');
          const checkCounts=readObjectKey(DRIVER_COUNT_KEY);
          if(Object.keys(data.virtualDriverCounts||{}).some(key=>checkCounts[key]===undefined))throw new Error('A conferência da contagem de motoristas não foi concluída.');
        }catch(writeError){
          for(const [key,value] of before){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch(rollbackError){console.warn('[Grupo Conect] Não foi possível reverter a chave após falha de restauração:',key,rollbackError);}}
          throw writeError;
        }
        if(typeof renderDaySelect==='function')renderDaySelect();
        if(typeof updateDayUI==='function')updateDayUI();
        if(typeof populateShiftDrivers==='function')populateShiftDrivers(false);
        renderOperations();
        if(typeof renderCashDashboard==='function')renderCashDashboard();
        const message=`Restauração concluída: ${merged.restored} linha(s) recuperada(s), ${merged.updated} linha(s) conciliada(s), ${mergedHistory.length} viagem(ns) normais no histórico. ${merged.skipped?`${merged.skipped} registro(s) inválido(s) foram ignorados. `:''}O resultado das operações foi conciliado no Caixa; lançamentos manuais e demais módulos foram preservados.`;
        archiveStatus(message);showToast('Dados do Visualizador restaurados e conciliados com os registros atuais.');
      }catch(error){console.error('[Grupo Conect] Falha ao restaurar Visualizador:',error);archiveStatus(`Não foi possível restaurar: ${error.message||'arquivo inválido'}`,true);showToast('Falha ao restaurar o arquivo do Visualizador.');}
      finally{$id('ovArchiveFile').value='';}
    };
    reader.readAsText(file);
  }
  $id('ovSaveArchive')?.addEventListener('click',downloadArchive);
  $id('ovRestoreArchive')?.addEventListener('click',()=>{if(!assertOwner())return;$id('ovArchiveFile')?.click();});
  $id('ovArchiveFile')?.addEventListener('change',event=>restoreArchiveFile(event.target.files?.[0]));
})();

/* Jovem Aprendiz autorizado + Funções Dono. Tudo opera sobre dados locais e exige ação explícita. */
(function installApprenticeAndOwnerActivities(){
  'use strict';
  const APP_KEY='grupoConect.apprenticeAssistant.v1';
  const ACTIVITIES_KEY='grupoConect.ownerActivities.v1';
  const $id=id=>document.getElementById(id);
  const today=()=>typeof dateTodayLocal==='function'?dateTodayLocal():new Date().toISOString().slice(0,10);
  const safeRead=(key,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&typeof value==='object'?value:fallback;}catch(e){return fallback;}};
  const safeWrite=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){showToast('Não foi possível salvar: armazenamento local indisponível ou cheio.');return false;}};
  const moneyFmt=value=>typeof money==='function'?money(Number(value)||0):`R$ ${(Number(value)||0).toFixed(2)}`;
  const esc=value=>typeof escapeHtml==='function'?escapeHtml(value):String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normLocal=value=>String(value||'').trim().toLocaleLowerCase('pt-BR');
  const daysBetween=(a,b)=>Math.round((new Date(`${a}T12:00:00`).getTime()-new Date(`${b}T12:00:00`).getTime())/86400000);
  function shortHash(value){let h=2166136261;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function apprenticeData(){const d=safeRead(APP_KEY,{});return {version:2,findings:Array.isArray(d.findings)?d.findings:[],history:Array.isArray(d.history)?d.history:[],reports:Array.isArray(d.reports)?d.reports:[],lastScan:d.lastScan||'',tools:d.tools&&typeof d.tools==='object'?d.tools:{}};}
  function saveApprentice(data){return safeWrite(APP_KEY,data);}
  function activityData(){const d=safeRead(ACTIVITIES_KEY,{});return {version:2,history:Array.isArray(d.history)?d.history:[],scores:d.scores&&typeof d.scores==='object'?d.scores:{},charters:Array.isArray(d.charters)?d.charters:[],schoolDeals:Array.isArray(d.schoolDeals)?d.schoolDeals:[],adDeals:Array.isArray(d.adDeals)?d.adDeals:[],customerTrust:Number.isFinite(Number(d.customerTrust))?Number(d.customerTrust):70,supplierBest:d.supplierBest||null,activeChallenge:d.activeChallenge&&typeof d.activeChallenge==='object'?d.activeChallenge:{},lastDailyReset:d.lastDailyReset||''};}
  function saveActivities(data){return safeWrite(ACTIVITIES_KEY,data);}
  function toast(message){if(typeof showToast==='function')showToast(message);}
  function ownerCheck(){if(typeof assertOwner==='function')return assertOwner();toast('Selecione Pablo na Área do Dono antes de executar esta ação.');return false;}
  function currentPayrollMonth(){return today().slice(0,7);}

  // A folha passa a listar também os mecânicos contratados, mantendo os motoristas já escalados.
  if(typeof gcBankRefreshEmployees==='function'){
    const originalRefreshEmployees=gcBankRefreshEmployees;
    gcBankRefreshEmployees=function(){
      const el=$id('gcPayrollEmployee');if(!el)return originalRefreshEmployees();
      const previous=el.value,roster=new Map();
      (typeof ownerOperations==='function'?ownerOperations():[]).forEach(op=>Object.values(op.drivers||{}).forEach(name=>{const n=String(name||'').trim();if(n&& !['—','Não escalado'].includes(n))roster.set(`${normLocal(op.company)}|${normLocal(n)}`,{company:op.company||'Grupo Conect',name:n,role:'driver'});}));
      (typeof gcGarageStaff==='function'?gcGarageStaff():[]).filter(x=>x.active!==false&&['driver','mechanic','other'].includes(x.role)).forEach(x=>roster.set(`${normLocal(x.company||'Grupo Conect')}|${normLocal(x.name)}`,{company:x.company||'Grupo Conect',name:x.name,role:x.role}));
      const ordered=[...roster.values()].sort((a,b)=>a.company.localeCompare(b.company,'pt-BR')||a.name.localeCompare(b.name,'pt-BR'));
      el.innerHTML='<option value="">Selecione um funcionário contratado ou escalado...</option>'+ordered.map(x=>{const value=encodeURIComponent(JSON.stringify(x));return `<option value="${esc(value)}">${esc(x.name)} · ${esc(x.company)} · ${x.role==='mechanic'?'Mecânico':x.role==='driver'?'Motorista':esc(x.roleLabel||'Equipe')}</option>`;}).join('');
      if(Array.from(el.options).some(o=>o.value===previous))el.value=previous;else if(ordered.length===1)el.value=el.options[1].value;
      if(typeof gcBankLoadStaffSettings==='function')gcBankLoadStaffSettings();
    };
  }
  if(typeof gcBankSalaryDefaults==='function'){
    const originalSalaryDefaults=gcBankSalaryDefaults;
    gcBankSalaryDefaults=function(employee){
      const base=originalSalaryDefaults(employee);
      const staff=(typeof gcGarageStaff==='function'?gcGarageStaff():[]).find(x=>x.active!==false&&normLocal(x.company||'Grupo Conect')===normLocal(employee?.company)&&normLocal(x.name)===normLocal(employee?.name));
      return staff?{...base,base:Number(staff.salary)||base.base}:base;
    };
  }
  if(typeof gcBankPayPayroll==='function'){
    const originalPayPayroll=gcBankPayPayroll;
    gcBankPayPayroll=function(event){
      const employee=typeof gcBankSelectedEmployee==='function'?gcBankSelectedEmployee():null;
      const before=Array.isArray(readArrayKey(GC_BANK_PAYROLL_KEY))?readArrayKey(GC_BANK_PAYROLL_KEY).length:0;
      originalPayPayroll(event);
      const rows=readArrayKey(GC_BANK_PAYROLL_KEY);
      if(employee?.role&&rows.length>before){const latest=rows.slice().reverse().find(x=>normLocal(x.company)===normLocal(employee.company)&&normLocal(x.name)===normLocal(employee.name)&&x.competence===$id('gcPayrollCompetence')?.value);if(latest&&!latest.role){latest.role=employee.role;writeArrayKey(GC_BANK_PAYROLL_KEY,rows);}}
    };
  }

  function addFinding(list,kind,target,title,detail,action,payload={}){
    const id=`ap-${shortHash(`${kind}|${target}|${today()}`)}`;
    list.push({id,kind,target,title,detail,action,payload,date:today(),createdAt:new Date().toISOString()});
  }
  function upsertReport(data,report){
    data.reports=Array.isArray(data.reports)?data.reports:[];
    const index=data.reports.findIndex(x=>x.id===report.id);
    if(index>=0){const prior=data.reports[index],preserveFinal=Boolean(prior.status&&prior.status!=='Aguardando autorização');data.reports[index]={...prior,...report,createdAt:prior.createdAt||report.createdAt};if(preserveFinal){data.reports[index].status=prior.status;data.reports[index].actionTaken=prior.actionTaken||report.actionTaken;data.reports[index].recommendedVehicle=prior.recommendedVehicle||report.recommendedVehicle;data.reports[index].arrivalEstimate=prior.arrivalEstimate||report.arrivalEstimate;}}
    else data.reports.push(report);
    data.reports=data.reports.slice(-80);
  }
  function faultPartSuggestion(alert){
    const key=String(alert?.componentKey||'');
    const component=(typeof GC_GARAGE_COMPONENTS!=='undefined'?GC_GARAGE_COMPONENTS:[]).find(x=>x.key===key)
      ||(typeof GC_EXTRA_PARTS!=='undefined'?GC_EXTRA_PARTS:[]).find(x=>x.key===key);
    const service=typeof gcGarageServiceForFault==='function'?gcGarageServiceForFault(key):'Inspeção geral';
    return {service,part:component?.name||'Peça ainda não identificada',category:component?.category||'Diagnóstico na oficina',basePrice:component&&Number.isFinite(Number(component.base))?Number(component.base):null,note:component?'Item provável indicado pelo componente que gerou o alerta. Preço-base de referência da simulação; confirmar especificação, quantidade e compatibilidade no diagnóstico antes de comprar.':'Não há componente específico associado ao alerta. O mecânico deve diagnosticar antes de selecionar peças.'};
  }
  function apprenticeMechanicAnalysis(alert){
    const suggestion=faultPartSuggestion(alert),service=normLocal(suggestion.service),staff=(typeof gcGarageStaff==='function'?gcGarageStaff():[]).filter(x=>x.role==='mechanic'&&x.active!==false);
    const orders=typeof gcGarageOrders==='function'?gcGarageOrders():[];
    const key=typeof gcGarageKey==='function'?gcGarageKey({company:alert.company,prefix:alert.prefix}):`${normLocal(alert.company)}|${String(alert.prefix)}`;
    const openOrder=orders.find(x=>(x.vehicleKey===key||(normLocal(x.prefix)===normLocal(alert.prefix)&&((normLocal(x.company)===normLocal(alert.company))||normLocal(x.company).includes(normLocal(alert.company))||normLocal(alert.company).includes(normLocal(x.company)))))&&!['Aprovada','Cancelada'].includes(x.status));
    if(openOrder)return {service:suggestion.service,existingOrder:openOrder,primary:null,secondary:null,urgent:false,reason:`Já existe a OS ${openOrder.number} (${openOrder.status}).`};
    const busyIds=new Set();orders.filter(x=>!['Aprovada','Cancelada'].includes(x.status)).forEach(x=>{if(x.mechanicId)busyIds.add(x.mechanicId);if(x.mechanic2Id)busyIds.add(x.mechanic2Id);});
    const component=(typeof GC_GARAGE_COMPONENTS!=='undefined'?GC_GARAGE_COMPONENTS:[]).find(x=>x.key===alert.componentKey);
    const health=component&&typeof gcGarageCurrentVehicle==='function'?gcGarageComponentHealth(gcGarageCurrentVehicle(key),component.key):100;
    const urgent=Boolean(alert.priority==='Urgente'||alert.severity==='Urgente'||(component?.critical&&Number(health)<=15));
    const tokens={
      'motor e injecao':['motor','diesel','injecao','turbo','common rail'],
      'sistema de freios':['freio','pneumatic','abs','ebs','valvula'],
      'pneus e rodas':['pneu','roda','rolamento','cubo'],
      'suspensao e direcao':['suspensao','direcao','bucha','amortecedor'],
      'transmissao e diferencial':['transmissao','embreagem','cambio','diferencial'],
      'arrefecimento':['arrefecimento','radiador','bomba d agua','mangueira'],
      'sistema eletrico':['eletric','bateria','alternador','partida','diagnostico'],
      'scr / arla 32':['scr','arla','nox','adblue','eletronic']
    };
    const terms=Object.entries(tokens).find(([k])=>service===k)?.[1]||service.split(/\s+/).filter(x=>x.length>3);
    const ranked=staff.filter(x=>!busyIds.has(x.id)).map(x=>{
      const spec=normLocal(`${x.specialty||''} ${x.courses||''} ${x.education||''}`),matches=terms.filter(t=>spec.includes(normLocal(t))).length;
      const sameCompany=normLocal(x.company||'')===normLocal(alert.company||'');
      const level=Math.max(1,Math.min(5,Number(x.level)||1)),years=Math.max(0,Number(x.years)||0);
      return {...x,score:matches*90+level*24+Math.min(years,20)*2+(sameCompany?12:0),specialtyMatches:matches};
    }).sort((a,b)=>b.score-a.score);
    return {service:suggestion.service,primary:ranked[0]||null,secondary:ranked.find(x=>x.id!==ranked[0]?.id)||null,urgent,reason:ranked.length?'':'Não há mecânico livre; os profissionais disponíveis já estão vinculados a ordens de serviço.'};
  }
  function apprenticeReserveAnalysis(alert,op){
    if(!op||op.replacementDispatch||op.pendingVehicleSwap)return {candidate:null,reason:'A operação já possui uma substituição em andamento.'};
    const fleet=typeof gcGarageVehicles==='function'?gcGarageVehicles():[];
    const operations=typeof ownerOperations==='function'?ownerOperations():[];
    const alerts=typeof gcGarageAlerts==='function'?gcGarageAlerts():[];
    const orders=typeof gcGarageOrders==='function'?gcGarageOrders():[];
    const oldKey=typeof gcGarageKey==='function'?gcGarageKey({company:alert.company||opVehicleCompany(op),prefix:alert.prefix||op.prefix}):`${normLocal(alert.company||opVehicleCompany(op))}|${String(alert.prefix||op.prefix)}`;
    const oldVehicle=fleet.find(v=>(typeof gcGarageKey==='function'?gcGarageKey(v):`${normLocal(v.company)}|${String(v.prefix)}`)===oldKey)||{company:alert.company||opVehicleCompany(op),prefix:alert.prefix||op.prefix,model:alert.model||op.busModel,chassis:op.chassis||''};
    const oldFamily=typeof gcPartsVehicleFamily==='function'?gcPartsVehicleFamily(oldVehicle):'urbano';
    const candidates=[];
    fleet.forEach(v=>{
      const key=typeof gcGarageKey==='function'?gcGarageKey(v):`${normLocal(v.company)}|${String(v.prefix)}`;
      if(!v.company||!v.prefix||key===oldKey)return;
      const assigned=operations.some(row=>row.id!==op.id&&(
        (typeof gcGarageKey==='function'?gcGarageKey({company:opVehicleCompany(row),prefix:row.prefix}):`${normLocal(opVehicleCompany(row))}|${String(row.prefix)}`)===key ||
        (row.pendingVehicleSwap&&normLocal(row.pendingVehicleSwap.replacementCompany)===normLocal(v.company)&&String(row.pendingVehicleSwap.replacementPrefix)===String(v.prefix)) ||
        (row.replacementDispatch&&normLocal(row.replacementDispatch.replacementCompany||opVehicleCompany(row))===normLocal(v.company)&&String(row.replacementDispatch.replacementPrefix)===String(v.prefix))
      ));
      if(assigned)return;
      const state=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(v):null;
      if(!state||state.blocked)return;
      if(alerts.some(a=>!a.resolvedAt&&a.vehicleKey===key))return;
      if(orders.some(o=>o.vehicleKey===key&&!['Aprovada','Cancelada'].includes(o.status)))return;
      const condition=typeof gcGarageCondition==='function'?gcGarageCondition(state):0;
      if(condition<45)return;
      const family=typeof gcPartsVehicleFamily==='function'?gcPartsVehicleFamily(v):'urbano';
      const sameCompany=normLocal(v.company)===normLocal(alert.company||opVehicleCompany(op));
      const sameFamily=family===oldFamily;
      // Não recomenda um veículo de classe operacional diferente (ex.: micro no lugar de rodoviário).
      if(!sameFamily)return;
      const score=(sameCompany?1000:0)+condition*2+(normLocal(v.model)===normLocal(oldVehicle.model)?180:0);
      candidates.push({vehicle:v,state,condition,sameCompany,sameFamily,score,key});
    });
    candidates.sort((a,b)=>b.score-a.score);
    return {candidate:candidates[0]||null,candidates,reason:candidates.length?'':'Não existe ônibus livre, sem bloqueio e com condição mínima de 45% para substituir esta unidade.'};
  }
  function operationalInstruction(type){
    const instructions={
      acidente:'Mantenha o ônibus em local seguro, proteja os passageiros, não avance pela área do acidente e aguarde orientação da central e das autoridades.',
      obra:'Reduza a velocidade, siga apenas a sinalização temporária e o desvio oficialmente autorizado; comunique qualquer bloqueio à central.',
      transito:'Permaneça na rota autorizada, informe o atraso à central e não utilize atalhos ou desvios sem aprovação.',
      clima:'Não atravesse alagamentos ou trechos inseguros. Pare em local protegido, informe a central e aguarde uma rota liberada.'
    };
    return instructions[type]||'Mantenha os passageiros em segurança e siga somente instruções operacionais autorizadas pela central.';
  }
  function INCIDENT_LABELS_LOCAL(type){return ({acidente:'Acidente / via bloqueada',obra:'Obra na rua',transito:'Trânsito intenso / congestionamento',clima:'Alagamento / condição climática',mecanica:'Falha mecânica do ônibus'})[type]||String(type||'Ocorrência');}
  function apprenticeReportText(report){
    return [
      'GRUPO CONECT — RELATÓRIO DO JOVEM APRENDIZ',
      `Relatório: ${report.id||'—'}`,
      `Gerado/atualizado: ${report.updatedAt?new Date(report.updatedAt).toLocaleString('pt-BR'):new Date(report.createdAt||Date.now()).toLocaleString('pt-BR')}`,
      `Situação: ${report.status||'Aguardando autorização'}`,
      `Ocorrência: ${report.issue||'—'}`,
      `Linha: ${report.company||'—'} · ${report.line||'—'} · ${report.city||'—'}`,
      `Veículo avariado: ${report.oldVehicle||'—'}`,
      `Análise: ${report.analysis||'—'}`,
      `Ônibus recomendado: ${report.recommendedVehicle||'Nenhum disponível'}`,
      `Mecânico recomendado/escalado: ${report.recommendedMechanic||'Não informado'}`,
      `Ação realizada: ${report.actionTaken||'Aguardando sua autorização; nenhuma alteração foi executada.'}`,
      `Orientação ao motorista: ${report.driverInstruction||'—'}`,
      `Previsão do substituto: ${report.arrivalEstimate||'Não aplicável'}`,
      `Serviço indicado: ${report.service||'—'}`,
      `Peça provável a conferir/comprar: ${report.partToCheck||'Não identificada'}`,
      `Preço-base simulado (não é cotação): ${report.partBasePrice===null||report.partBasePrice===undefined?'não estimado':moneyFmt(report.partBasePrice)}`,
      `Categoria: ${report.partCategory||'—'}`,
      `Observação de compra: ${report.purchaseNote||'—'}`,
      '',
      'Nota: relatório de simulação baseado nos registros locais. Não substitui diagnóstico presencial, catálogo OEM, orçamento ou inspeção de segurança. Nenhuma peça é comprada automaticamente.'
    ].join('\n');
  }
  function renderApprenticeReports(data=apprenticeData()){
    const el=$id('gcApprenticeReports');if(!el)return;
    const rows=(data.reports||[]).slice().reverse().slice(0,10);
    el.innerHTML=rows.length?rows.map(r=>`<article class="gc-apprentice-report"><div class="gc-apprentice-report-main"><div class="gc-apprentice-finding-top"><strong>${esc(r.issue||'Ocorrência operacional')}</strong><span class="gc-apprentice-status ${/a caminho|deslocamento|autorizad|conclu/i.test(r.status||'')?'authorized':/recusad/i.test(r.status||'')?'rejected':'pending'}">${esc(r.status||'Aguardando autorização')}</span></div><p>${esc(r.company||'')} · ${esc(r.line||'')} · ${esc(r.city||'')} · Veículo: ${esc(r.oldVehicle||'não identificado')}</p><small>${esc(r.createdAt?new Date(r.createdAt).toLocaleString('pt-BR'):'—')}</small><p><b>Análise:</b> ${esc(r.analysis||'—')}</p><p><b>Ônibus recomendado:</b> ${esc(r.recommendedVehicle||'Nenhum reserva confirmado')}</p><p><b>Mecânico recomendado/escalado:</b> ${esc(r.recommendedMechanic||'Aguardando análise de equipe')}</p><p><b>O que foi feito:</b> ${esc(r.actionTaken||'Aguardando autorização; nenhuma alteração foi executada.')}</p><p><b>Orientação ao motorista:</b> ${esc(r.driverInstruction||'—')}</p><p><b>Previsão:</b> ${esc(r.arrivalEstimate||'Não aplicável')}</p><p><b>Peça a conferir:</b> ${esc(r.partToCheck||'Não identificada')}${r.partBasePrice!==null&&r.partBasePrice!==undefined?` · base simulada ${esc(moneyFmt(r.partBasePrice))}`:''}</p><small>${esc(r.purchaseNote||'Confirme compatibilidade, quantidade e necessidade com o mecânico antes de comprar.')}</small></div><button type="button" class="secondary-action-button" data-apprentice-report-download="${esc(r.id)}">Baixar relatório</button></article>`).join(''):'<p class="empty-state-text">Nenhum relatório de ocorrência operacional ainda. Quando Caio identificar um incidente no Visualizador, ele preparará um relatório e aguardará sua autorização.</p>';
  }
  function scanApprentice(options={}){
    if(!ownerCheck())return;
    const silent=Boolean(options.silent);
    const data=apprenticeData(),fresh=[],allEvents=typeof readArrayKey==='function'?readArrayKey(GC_AGENDA_EVENTS_KEY):[],now=today();
    allEvents.forEach(ev=>{
      if(!ev||!ev.id||gcAgendaIsDone?.(ev.id))return;
      const date=String(ev.date||now).slice(0,10);if(date>now)return;
      const overdue=Math.max(0,daysBetween(now,date));
      const kind=String(ev.type||'').toLowerCase(),title=String(ev.title||'Tarefa da frota');
      const clean=['clean','wash'].includes(kind)||/lavagem|limpeza|lavar/i.test(title);
      const maintenance=['maintenance','oil','tires'].includes(kind)||Boolean(ev.serviceType);
      if(clean){addFinding(fresh,'agenda-clean',ev.id,`Tarefa de limpeza pendente · ${ev.prefix||ev.vehicle||'frota'}`,`${title}. Vencimento: ${date}${overdue?` · atrasada há ${overdue} dia(s)`:''}. Posso registrar a limpeza como concluída e gerar o apontamento no histórico?`,'complete-cleaning',{eventId:ev.id,date});}
      else if(maintenance){addFinding(fresh,'agenda-maintenance',ev.id,`Manutenção agendada · ${ev.prefix||ev.vehicle||'frota'}`,`${title}. Vencimento: ${date}${overdue?` · atrasada há ${overdue} dia(s)`:''}. Posso encaminhar o ônibus à Garagem e preparar a ordem de serviço para você escolher o mecânico?`,'open-workshop',{eventId:ev.id,date,vehicleKey:ev.vehicleKey||'',serviceType:ev.serviceType||''});}
    });
    let vehicleRows=[];
    try{
      const rawVehicles=typeof gcGarageVehicles==='function'?gcGarageVehicles():[];
      const stateMap=typeof gcGarageState==='function'?gcGarageState():{};
      vehicleRows=rawVehicles.map(v=>{const key=typeof gcGarageKey==='function'?gcGarageKey(v):`${v.company}|${v.prefix}`;return stateMap[key]||{key,company:v.company,prefix:v.prefix,model:v.model,yearEstimated:true,kmEstimated:true,uninitialized:true};});
    }catch(e){console.warn('Aprendiz: leitura de frota indisponível',e);}
    const orders=typeof gcGarageOrders==='function'?gcGarageOrders():[];
    const incompleteVehicles=[];
    vehicleRows.forEach(v=>{
      const activeOrder=orders.some(o=>o.vehicleKey===v.key&&!['Aprovada','Cancelada'].includes(o.status));
      if(!v.uninitialized&&!activeOrder&&!v.blocked&&typeof gcGarageCondition==='function'&&gcGarageCondition(v)<40){addFinding(fresh,'vehicle-critical',v.key,`Condição crítica · prefixo ${v.prefix}`,`A ficha da garagem indica condição média de ${gcGarageCondition(v)}%. Posso abrir a Garagem e preparar uma inspeção para sua análise?`,'open-vehicle-workshop',{vehicleKey:v.key,company:v.company,prefix:v.prefix});}
      if(v.yearEstimated||v.kmEstimated||v.uninitialized)incompleteVehicles.push(v);
    });
    if(incompleteVehicles.length){const preview=incompleteVehicles.slice(0,8).map(v=>`${v.company} · ${v.prefix}`).join('; ');addFinding(fresh,'vehicle-data','fleet-incomplete',`Fichas técnicas incompletas · ${incompleteVehicles.length} ônibus`,`Ano ou hodômetro ainda é estimado/não inicializado em ${incompleteVehicles.length} veículo(s). Exemplos: ${preview}${incompleteVehicles.length>8?'…':''}. Recomendo revisar os dados na Garagem.`,'open-garage',{count:incompleteVehicles.length});}
    // Monitoramento do Visualizador: panes abertas recebem análise de reserva, orientação e relatório.
    const operationRows=typeof ownerOperations==='function'?ownerOperations():[];
    const activeAlerts=typeof gcGarageAlerts==='function'?gcGarageAlerts().filter(a=>!a.resolvedAt):[];
    activeAlerts.forEach(alert=>{
      const op=operationRows.find(x=>x.id===alert.operationId||x.id===alert.previousOperationId)
        ||operationRows.find(x=>normLocal(opVehicleCompany(x))===normLocal(alert.company)&&String(x.prefix)===String(alert.prefix));
      const parts=faultPartSuggestion(alert),analysis=apprenticeReserveAnalysis(alert,op),mechanicAnalysis=apprenticeMechanicAnalysis(alert);
      const mechanicReportId=`apr-rep-mechanic-${shortHash(`mechanic|${alert.id}`)}`;
      if(mechanicAnalysis.existingOrder){
        upsertReport(data,{id:mechanicReportId,kind:'mecanica',createdAt:alert.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),status:'Ordem de serviço em andamento',issue:`Plano de reparo · ${alert.company} · ${alert.prefix}`,company:alert.company||'',line:op?.line||'Operação não vinculada',city:op?.city||'',oldVehicle:`${alert.company||''} · ${alert.prefix||''} · ${alert.model||''}`,analysis:mechanicAnalysis.reason,recommendedMechanic:`${mechanicAnalysis.existingOrder.mechanicName||'Mecânico não identificado'} · OS ${mechanicAnalysis.existingOrder.number}`,actionTaken:'Nenhuma nova ordem foi criada para evitar duplicidade.',service:parts.service,partToCheck:parts.part,partBasePrice:parts.basePrice,partCategory:parts.category,purchaseNote:parts.note,alertId:alert.id});
      }else if(mechanicAnalysis.primary){
        const secondText=mechanicAnalysis.urgent?(mechanicAnalysis.secondary?` e ${mechanicAnalysis.secondary.name} (nível ${mechanicAnalysis.secondary.level})`:'; não há segundo mecânico livre para o atendimento urgente') : '';
        const detail=`Caio analisou a falha “${alert.reason||'não detalhada'}” e recomenda o serviço ${parts.service}. Mecânico mais compatível: ${mechanicAnalysis.primary.name} (nível ${mechanicAnalysis.primary.level}, ${mechanicAnalysis.primary.specialty||'especialidade não informada'})${secondText}. Após sua autorização, será aberta uma OS na garagem correspondente e o profissional será escalado. As peças necessárias ficarão listadas na OS; nenhuma compra será feita automaticamente.`;
        upsertReport(data,{id:mechanicReportId,kind:'mecanica',createdAt:alert.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),status:'Aguardando autorização',issue:`Escala de mecânico · ${alert.company} · ${alert.prefix}`,company:alert.company||'',line:op?.line||'Operação não vinculada',city:op?.city||'',oldVehicle:`${alert.company||''} · ${alert.prefix||''} · ${alert.model||''}`,analysis:detail,recommendedMechanic:`${mechanicAnalysis.primary.name} · nível ${mechanicAnalysis.primary.level}${mechanicAnalysis.secondary&&mechanicAnalysis.urgent?` + ${mechanicAnalysis.secondary.name} · nível ${mechanicAnalysis.secondary.level}`:''}`,actionTaken:'Aguardando sua autorização; nenhuma OS foi criada.',service:parts.service,partToCheck:parts.part,partBasePrice:parts.basePrice,partCategory:parts.category,purchaseNote:parts.note,alertId:alert.id});
        addFinding(fresh,'operation-mechanic-assignment',`${alert.id}|${mechanicAnalysis.primary.id}`,`Escalar mecânico · prefixo ${alert.prefix}`,detail,'apprentice-assign-mechanic',{alertId:alert.id,operationId:op?.id||'',recommendedMechanicId:mechanicAnalysis.primary.id,recommendedMechanic2Id:mechanicAnalysis.urgent?mechanicAnalysis.secondary?.id||'':'',service:parts.service,urgent:mechanicAnalysis.urgent,reportId:mechanicReportId});
      }else if(!mechanicAnalysis.existingOrder){
        upsertReport(data,{id:mechanicReportId,kind:'mecanica',createdAt:alert.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),status:'Aguardando contratação / disponibilidade',issue:`Escala de mecânico · ${alert.company} · ${alert.prefix}`,company:alert.company||'',line:op?.line||'Operação não vinculada',city:op?.city||'',oldVehicle:`${alert.company||''} · ${alert.prefix||''} · ${alert.model||''}`,analysis:mechanicAnalysis.reason||'Não foi possível identificar um mecânico livre.',recommendedMechanic:'Nenhum profissional disponível',actionTaken:'Nenhuma ordem foi criada.',service:parts.service,partToCheck:parts.part,partBasePrice:parts.basePrice,partCategory:parts.category,purchaseNote:parts.note,alertId:alert.id});
      }
      const reportId=`apr-rep-${shortHash(`breakdown|${alert.id}|${analysis.candidate?.key||'none'}`)}`;
      const report={id:reportId,kind:'mecanica',createdAt:alert.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),status:'Aguardando autorização',issue:`Pane mecânica · ${alert.reason||'falha não detalhada'}`,company:alert.company||op?.company||'',line:op?.line||'Operação não vinculada',city:op?.city||'',oldVehicle:`${alert.company||''} · ${alert.prefix||op?.prefix||''} · ${alert.model||op?.busModel||''}`,analysis:analysis.candidate?`Há substituto elegível. Prioridade: mesma empresa e classe de veículo, condição ${analysis.candidate.condition}%.`:(analysis.reason||'Não foi possível identificar um substituto elegível.'),recommendedVehicle:analysis.candidate?`${analysis.candidate.vehicle.company} · ${analysis.candidate.vehicle.prefix} · ${analysis.candidate.vehicle.model} (${analysis.candidate.condition}%)`:'Nenhum ônibus livre identificado',actionTaken:'Aguardando autorização; nenhuma alteração foi executada.',driverInstruction:op?'Encostar em local seguro, sinalizar, manter passageiros protegidos, comunicar a central e aguardar o substituto ou a equipe de apoio.':'Sem operação vinculada; encaminhar a ocorrência diretamente à Garagem.',arrivalEstimate:analysis.candidate?'Após autorização: estimativa variável de 22 a 40 minutos conforme trânsito simulado.':'Não há previsão até existir um veículo reserva disponível.',service:parts.service,partToCheck:parts.part,partBasePrice:parts.basePrice,partCategory:parts.category,purchaseNote:parts.note,alertId:alert.id,operationId:op?.id||''};
      upsertReport(data,report);
      if(op?.replacementDispatch){upsertReport(data,{id:reportId,status:'Substituto em deslocamento',actionTaken:`Substituto ${op.replacementDispatch.replacementPrefix} já está em deslocamento pelo despacho original.`,arrivalEstimate:`${op.replacementDispatch.durationMinutes} min · trânsito ${op.replacementDispatch.trafficLabel}.`});return;}
      if(op?.driverInstruction?.incidentId===alert.id&&!analysis.candidate)return;
      const action=!op?'open-garage':(analysis.candidate?'apprentice-dispatch-replacement':'apprentice-breakdown-guidance');
      const detail=analysis.candidate
        ?`${alert.reason||'Falha mecânica'} · ${op.company} / ${op.line}. Caio encontrou como melhor reserva ${analysis.candidate.vehicle.company} · ${analysis.candidate.vehicle.prefix} · ${analysis.candidate.vehicle.model}, condição ${analysis.candidate.condition}%. Critérios: disponibilidade, ausência de OS/pane, condição mínima de 45% e prioridade para mesma empresa/classe. Após sua autorização, o sistema enviará o reserva pelo despacho mecânico existente e manterá a contagem regressiva de chegada (22–40 min simulados). O ônibus avariado continuará retido para conserto.`
        :`${alert.reason||'Falha mecânica'} · ${op?.company||alert.company||'Empresa não identificada'} / ${op?.line||'sem operação vinculada'}. Não encontrei ônibus livre com condição suficiente. Recomendo manter a unidade parada, orientar o motorista e abrir a Garagem para escalar mecânico. ${parts.note}`;
      addFinding(fresh,'operation-breakdown',`${alert.id}|${analysis.candidate?.key||'none'}`,`Pane no Visualizador · prefixo ${alert.prefix||op?.prefix||'—'}`,detail,action,{alertId:alert.id,operationId:op?.id||'',type:'mecanica',recommendedVehicleKey:analysis.candidate?.key||'',recommendedVehicleCompany:analysis.candidate?.vehicle.company||'',recommendedVehiclePrefix:analysis.candidate?String(analysis.candidate.vehicle.prefix):'',reportId});
    });
    // Incidentes de via/clima também recebem orientação; o relógio/decisão original não é alterado.
    operationRows.forEach(op=>{
      const active=op.gcIncidentActive;
      if(!active||active.type==='mecanica'||!['acidente','obra','transito','clima'].includes(active.type))return;
      if(op.driverInstruction?.incidentId===active.id)return;
      const instruction=operationalInstruction(active.type),reportId=`apr-rep-${shortHash(`incident|${op.id}|${active.id}`)}`;
      const remaining=Number(active.endsAtMs)>0?Math.max(0,Math.ceil((Number(active.endsAtMs)-Date.now())/60000)):null;
      upsertReport(data,{id:reportId,kind:active.type,createdAt:active.startedAt||new Date().toISOString(),updatedAt:new Date().toISOString(),status:'Aguardando autorização',issue:`${INCIDENT_LABELS_LOCAL(active.type)} · decisão atual: ${active.response||'não informada'}`,company:op.company||'',line:op.line||'',city:op.city||'',oldVehicle:`${opVehicleCompany(op)} · ${op.prefix} · ${op.busModel||''}`,analysis:'Ocorrência de via/clima em andamento. A linha permanece sujeita ao prazo e à decisão registrados no Visualizador.',recommendedVehicle:'Não recomendado; ocorrência não é pane mecânica.',actionTaken:'Aguardando autorização; nenhuma alteração foi executada.',driverInstruction:instruction,arrivalEstimate:remaining===null?'Prazo não informado':`${remaining} min simulados restantes, sujeitos ao relógio da operação.`,service:'Não se aplica',partToCheck:'Não há peça mecânica indicada',partCategory:'Não aplicável',purchaseNote:'Não comprar peça para ocorrência de via/clima.',operationId:op.id});
      addFinding(fresh,'operation-driver-guidance',`${op.id}|${active.id}`,`Orientação ao motorista · ${op.line||op.prefix}`,`${INCIDENT_LABELS_LOCAL(active.type)} em ${op.city||'local não informado'}. Recomendo transmitir: “${instruction}” O prazo da decisão atual permanece controlado pelo timer do Visualizador${remaining===null?'':`; estimativa restante: ${remaining} minuto(s) simulados`}. Autorizar apenas registra a orientação; não altera o status, o desvio ou o timer.`,`guide-operation-driver`,{operationId:op.id,incidentId:active.id,type:active.type,instruction,reportId});
    });
    // Controle de competência: não presume que salário esteja atrasado; apenas aponta folha ainda não lançada no mês.
    const competence=currentPayrollMonth(),paid=typeof readArrayKey==='function'?readArrayKey(GC_BANK_PAYROLL_KEY):[],employees=new Map();
    (typeof gcGarageStaff==='function'?gcGarageStaff():[]).filter(x=>x.active!==false&&['driver','mechanic'].includes(x.role)).forEach(x=>employees.set(`${normLocal(x.company||'Grupo Conect')}|${normLocal(x.name)}`,{company:x.company||'Grupo Conect',name:x.name,role:x.role,salary:Number(x.salary)||0}));
    (typeof ownerOperations==='function'?ownerOperations():[]).forEach(op=>Object.values(op.drivers||{}).forEach(name=>{const n=String(name||'').trim();if(n&& !['—','Não escalado'].includes(n)){const k=`${normLocal(op.company)}|${normLocal(n)}`;if(!employees.has(k))employees.set(k,{company:op.company||'Grupo Conect',name:n,role:'driver',salary:0});}}));
    [...employees.values()].forEach(emp=>{const exists=paid.some(x=>x.competence===competence&&normLocal(x.company)===normLocal(emp.company)&&normLocal(x.name)===normLocal(emp.name));if(!exists)addFinding(fresh,'payroll',`${emp.company}|${emp.name}|${competence}`,`Folha não registrada · ${emp.name}`,`${emp.role==='mechanic'?'Mecânico':'Motorista'} da ${emp.company}. Não encontrei pagamento da competência ${competence}. Posso abrir a folha e, após sua autorização, tentar processar o pagamento simulado?`,'payroll',{employee:emp,competence});});
    // Linha sem motorista informado: o bot alerta, mas não inventa uma escala.
    (typeof ownerOperations==='function'?ownerOperations():[]).forEach(op=>{const drivers=Object.values(op.drivers||{}).map(x=>String(x||'').trim()).filter(x=>x&& !['—','Não escalado'].includes(x));if(!drivers.length)addFinding(fresh,'driver-gap',op.id,`Escala sem motorista · ${op.line||op.prefix}`,`A linha ${op.line||'sem identificação'} (${op.company||'empresa não informada'}) não apresenta motorista escalado nos turnos. Posso abrir o Visualizador para você revisar?`,'open-operations',{operationId:op.id});});
    const scanAt=new Date().toISOString(),freshIds=new Set(fresh.map(x=>x.id)),existing=new Map(data.findings.map(x=>[x.id,x]));
    // Retira da fila os alertas que já não aparecem na nova leitura. O Aprendiz não executa nada;
    // apenas evita manter pedidos antigos depois que o proprietário resolveu a pendência em outro módulo.
    existing.forEach((item,id)=>{if(item.status==='pending'&&!freshIds.has(id)){item.status='resolved';item.decidedAt=scanAt;item.result='A pendência não apareceu na nova análise; pode ter sido resolvida em outro módulo.';}});
    fresh.forEach(f=>{const prior=existing.get(f.id);if(!prior)existing.set(f.id,{...f,status:'pending'});else if(prior.status==='resolved')existing.set(f.id,{...prior,...f,status:'pending'});});
    // Sugestões antigas continuam no histórico, sem duplicar o mesmo pedido após cada varredura.
    data.findings=[...existing.values()].slice(-180);data.lastScan=scanAt;
    if(saveApprentice(data)){renderApprentice();if(!silent)toast(`Análise concluída: ${fresh.length} ponto(s) identificado(s). Nenhuma ação foi executada.`);}
  }
  function pendingFindings(){return apprenticeData().findings.filter(x=>x.status==='pending');}
  function refreshApprenticeAlert(){
    const alert=$id('gcApprenticeHomeAlert');if(!alert)return;const pending=pendingFindings();
    alert.hidden=!pending.length;
    if(pending.length){$id('gcApprenticeHomeTitle').textContent=`Caio encontrou ${pending.length} item(ns) aguardando autorização`;$id('gcApprenticeHomeText').textContent=pending.slice(0,2).map(x=>x.title).join(' · ')+(pending.length>2?` · +${pending.length-2}`:'');}
  }
  const selectedApprenticeFindings=new Set();
  function refreshApprenticeBulkbar(visiblePending=[]){
    const bar=$id('gcApprenticeBulkbar');if(!bar)return;
    const valid=new Set(visiblePending.map(x=>x.id));
    Array.from(selectedApprenticeFindings).forEach(id=>{if(!valid.has(id))selectedApprenticeFindings.delete(id);});
    const count=selectedApprenticeFindings.size,selectAll=$id('gcApprenticeSelectAll');
    bar.hidden=visiblePending.length===0;
    if($id('gcApprenticeBulkCount'))$id('gcApprenticeBulkCount').textContent=`${count} selecionado(s)`;
    if($id('gcApprenticeBulkApprove'))$id('gcApprenticeBulkApprove').disabled=count===0;
    if($id('gcApprenticeBulkReject'))$id('gcApprenticeBulkReject').disabled=count===0;
    if(selectAll){selectAll.checked=visiblePending.length>0&&count===visiblePending.length;selectAll.indeterminate=count>0&&count<visiblePending.length;}
  }
  function selectedPendingFindings(){const current=pendingFindings();return current.filter(x=>selectedApprenticeFindings.has(x.id));}
  function bulkApproveFindings(){
    if(!ownerCheck())return;const chosen=selectedPendingFindings();if(!chosen.length){toast('Selecione ao menos uma recomendação pendente.');return;}
    const preview=chosen.slice(0,8).map(x=>`• ${x.title}`).join('\n');
    if(!window.confirm(`AUTORIZAÇÃO EM LOTE — ${chosen.length} ITEM(NS)\n\n${preview}${chosen.length>8?`\n… e mais ${chosen.length-8} item(ns)`:''}\n\nCaio executará apenas as ações descritas em cada recomendação. Pagamentos e operações financeiras continuarão exigindo confirmação individual adicional. Deseja continuar?`))return;
    let completed=0,failed=0;
    chosen.forEach(f=>{if(approveFinding(f.id,{preconfirmed:true,ownerChecked:true,suppressRender:true}))completed++;else failed++;});
    selectedApprenticeFindings.clear();renderApprentice();toast(`Autorização em lote concluída: ${completed} executada(s), ${failed} pendente(s) para revisão.`);
  }
  function bulkRejectFindings(){
    if(!ownerCheck())return;const chosen=selectedPendingFindings();if(!chosen.length){toast('Selecione ao menos uma recomendação pendente.');return;}
    if(!window.confirm(`RECUSAR ${chosen.length} RECOMENDAÇÃO(ÕES)?\n\nNenhuma das ações selecionadas será executada. Deseja continuar?`))return;
    let count=0;chosen.forEach(f=>{if(rejectFinding(f.id,{preconfirmed:true,suppressRender:true}))count++;});
    selectedApprenticeFindings.clear();renderApprentice();toast(`${count} recomendação(ões) recusada(s). Nenhuma ação foi executada.`);
  }
  function renderApprentice(){
    const data=apprenticeData(),pending=data.findings.filter(x=>x.status==='pending'),stats=$id('gcApprenticeStats');
    if(stats)stats.innerHTML=[['Aguardando autorização',pending.length],['Ações autorizadas',data.history.filter(x=>x.status==='authorized').length],['Ações recusadas',data.history.filter(x=>x.status==='rejected').length],['Última análise',data.lastScan?new Date(data.lastScan).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—']].map(([a,b])=>`<div class="gc-apprentice-stat"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');
    const list=$id('gcApprenticeFindings');let visiblePending=[];if(list){const priority={'operation-breakdown':-3,'operation-mechanic-assignment':-2,'operation-driver-guidance':-1,'agenda-clean':0,'agenda-maintenance':1,'vehicle-critical':2,'payroll':3,'driver-gap':4,'vehicle-data':5};const rows=data.findings.slice().sort((a,b)=>{const ap=a.status==='pending'?0:1,bp=b.status==='pending'?0:1;return ap-bp||(priority[a.kind]??9)-(priority[b.kind]??9)||String(b.createdAt||'').localeCompare(String(a.createdAt||''));}).slice(0,35);visiblePending=rows.filter(f=>f.status==='pending');list.innerHTML=rows.length?rows.map(f=>`<article class="gc-apprentice-finding ${f.status!=='pending'?'is-processed':''}">${f.status==='pending'?`<label class="gc-apprentice-finding-select" title="Selecionar recomendação"><input type="checkbox" data-apprentice-select="${esc(f.id)}" ${selectedApprenticeFindings.has(f.id)?'checked':''}><span class="sr-only">Selecionar ${esc(f.title)}</span></label>`:''}<div class="gc-apprentice-finding-main"><div class="gc-apprentice-finding-top"><strong>${esc(f.title)}</strong><span class="gc-apprentice-status ${f.status==='pending'?'pending':['authorized','resolved'].includes(f.status)?'authorized':'rejected'}">${f.status==='pending'?'Aguardando você':f.status==='authorized'?'Autorizado / encaminhado':f.status==='resolved'?'Resolvido em outro módulo':'Recusado'}</span></div><p>${esc(f.detail)}</p><small>Identificação: ${esc(f.id)} · Detectado em ${esc(f.date||'—')}</small></div>${f.status==='pending'?`<div class="gc-apprentice-finding-actions"><button type="button" class="primary-button" data-apprentice-approve="${esc(f.id)}">Autorizar ação</button><button type="button" class="secondary-action-button" data-apprentice-reject="${esc(f.id)}">Recusar</button></div>`:''}</article>`).join(''):'<p class="empty-state-text">Nenhuma recomendação aguardando decisão. Faça uma nova análise para procurar pendências.</p>';}
    refreshApprenticeBulkbar(visiblePending);
    renderApprenticeReports(data);
    const count=$id('gcApprenticePendingCount');if(count)count.textContent=`${pending.length} pendente(s)`;refreshApprenticeAlert();
  }
  function setFindingStatus(id,status,note){const data=apprenticeData(),f=data.findings.find(x=>x.id===id);if(!f)return false;f.status=status;f.decidedAt=new Date().toISOString();f.result=note||'';data.history.push({id:f.id,title:f.title,status,at:f.decidedAt,result:f.result});data.history=data.history.slice(-100);return saveApprentice(data);}
  function openBankPayroll(employee,competence){
    if(typeof gcBankOpen!=='function'||typeof gcBankSetTab!=='function')return {done:false,message:'O Banco Grupo Conect não está disponível nesta versão.'};
    gcBankOpen();gcBankSetTab('payroll');
    const select=$id('gcPayrollEmployee');if(!select)return {done:false,message:'Não encontrei a seleção de funcionários da folha.'};
    const encoded=encodeURIComponent(JSON.stringify(employee));
    const option=Array.from(select.options).find(o=>{try{const val=JSON.parse(decodeURIComponent(o.value));return normLocal(val.company)===normLocal(employee.company)&&normLocal(val.name)===normLocal(employee.name);}catch(e){return false;}});
    if(!option)return {done:false,message:'Este funcionário ainda não aparece na lista da folha. Atualize a Equipe / Folha e tente novamente.'};
    select.value=option.value;if(typeof gcBankLoadStaffSettings==='function')gcBankLoadStaffSettings();
    const competenceEl=$id('gcPayrollCompetence');if(competenceEl)competenceEl.value=competence;
    if(typeof gcBankUpdatePayrollPreview==='function')gcBankUpdatePayrollPreview();
    if(typeof gcBankGetPayrollInput!=='function')return {done:false,message:'Não foi possível calcular a folha.'};
    const payroll=gcBankGetPayrollInput(),already=readArrayKey(GC_BANK_PAYROLL_KEY).some(x=>x.competence===competence&&normLocal(x.company)===normLocal(employee.company)&&normLocal(x.name)===normLocal(employee.name));
    if(already)return {done:true,message:'A folha já estava registrada para esta competência.'};
    if(!payroll.employee||!(payroll.total>0))return {done:false,message:'O valor de salário não está configurado. Confira os dados no Banco antes de autorizar o pagamento.'};
    if(payroll.total>cashBreakdown().balance+0.005)return {done:false,message:`Folha aberta para conferência, mas o Caixa não tem saldo suficiente. Necessário ${moneyFmt(payroll.total)}; disponível ${moneyFmt(cashBreakdown().balance)}.`};
    if(typeof gcBankCardIsBlocked==='function'&&gcBankCardIsBlocked())return {done:false,message:'Folha aberta, mas o cartão empresarial simulado está bloqueado. Desbloqueie-o antes de pagar.'};
    const approved=window.confirm(`AUTORIZAÇÃO FINANCEIRA\n\nProcessar a folha simulada de ${employee.name} (${employee.role==='mechanic'?'mecânico':'motorista'})?\nCompetência: ${competence}\nCusto total estimado: ${moneyFmt(payroll.total)}\n\nO valor será lançado no Caixa.`);
    if(!approved)return {done:false,message:'Você cancelou o pagamento. A folha ficou aberta para revisão, sem lançamento no Caixa.'};
    if(typeof gcBankPayPayroll==='function')gcBankPayPayroll({preventDefault(){}});
    const after=readArrayKey(GC_BANK_PAYROLL_KEY),paid=after.some(x=>x.competence===competence&&normLocal(x.company)===normLocal(employee.company)&&normLocal(x.name)===normLocal(employee.name));
    return paid?{done:true,message:`Folha processada e registrada no Caixa (${moneyFmt(payroll.total)}).`}:{done:false,message:'O módulo da folha não confirmou o pagamento. Confira o Banco e o saldo do Caixa.'};
  }
  function updateReport(reportId,patch){
    if(!reportId)return;const data=apprenticeData(),report=data.reports.find(x=>x.id===reportId);if(!report)return;
    Object.assign(report,patch,{updatedAt:new Date().toISOString()});saveApprentice(data);renderApprenticeReports(data);
  }
  function assignApprenticeMechanic(f){
    const alert=typeof gcGarageAlerts==='function'?gcGarageAlerts().find(x=>x.id===f.payload.alertId&&!x.resolvedAt):null;
    if(!alert)return {done:false,message:'A pane já foi encerrada ou não está mais disponível. Faça uma nova análise.'};
    const vehicle=(typeof gcGarageVehicles==='function'?gcGarageVehicles():[]).find(v=>gcGarageKey(v)===alert.vehicleKey)||{company:alert.company,prefix:String(alert.prefix),model:alert.model||'',chassis:''};
    const key=typeof gcGarageKey==='function'?gcGarageKey(vehicle):`${normLocal(vehicle.company)}|${String(vehicle.prefix)}`;
    const orders=typeof gcGarageOrders==='function'?gcGarageOrders():[];
    const existing=orders.find(o=>(o.vehicleKey===key||(normLocal(o.prefix)===normLocal(vehicle.prefix)&&((normLocal(o.company)===normLocal(vehicle.company))||normLocal(o.company).includes(normLocal(vehicle.company))||normLocal(vehicle.company).includes(normLocal(o.company)))))&&!['Aprovada','Cancelada'].includes(o.status));
    if(existing){updateReport(f.payload.reportId,{status:'Ordem de serviço já existente',recommendedMechanic:`${existing.mechanicName||'Mecânico não identificado'} · OS ${existing.number}`,actionTaken:`Não foi criada outra ordem. A pane já está vinculada à OS ${existing.number} (${existing.status}).`});return {done:true,message:`A pane já está vinculada à OS ${existing.number}. Evitei criar uma ordem duplicada.`};}
    const analysis=apprenticeMechanicAnalysis(alert);
    if(!analysis.primary)return {done:false,message:analysis.reason||'Não há mecânico disponível.'};
    if(analysis.primary.id!==f.payload.recommendedMechanicId)return {done:false,message:`A disponibilidade ou o diagnóstico mudou. O novo profissional recomendado é ${analysis.primary.name}. Faça uma nova análise e autorize a recomendação atualizada.`};
    if(analysis.urgent&&(!analysis.secondary||analysis.secondary.id!==f.payload.recommendedMechanic2Id))return {done:false,message:'O atendimento foi classificado como urgente, mas a segunda escala mudou. Faça uma nova análise para validar dois mecânicos diferentes.'};
    const garageSelect=$id('gcGarageRepairGarage'),garageOptions=Array.from(garageSelect?.options||[]).filter(o=>o.value);
    const company=normLocal(alert.company||vehicle.company),garage=garageOptions.find(o=>company.includes('progresso')&&normLocal(o.textContent).includes('progresso'))
      ||garageOptions.find(o=>company.includes('cedro')&&normLocal(o.textContent).includes('cedro'))
      ||garageOptions.find(o=>company.includes('conecta')&&normLocal(o.textContent).includes('conecta'))
      ||garageOptions.find(o=>company.includes('galaxy')&&normLocal(o.textContent).includes('galaxy'))
      ||garageOptions.find(o=>normLocal(o.textContent).includes('garagem central'))||garageOptions[0];
    if(typeof gcGarageOpenRepair!=='function'||typeof gcGarageCreateOrder!=='function')return {done:false,message:'O módulo de ordens de serviço não está disponível nesta versão.'};
    gcGarageOpenRepair(key,analysis.service,'',`Pane identificada pelo Visualizador: ${alert.reason}. Escala sugerida e autorizada por Pablo através do Jovem Aprendiz. Diagnóstico inicial; confirmar a causa, a peça e a compatibilidade antes de comprar.`);
    gcGaragePopulateVehicleSelect();gcGaragePopulateMechanics();
    const vehicleSelect=$id('gcGarageRepairVehicle'),serviceSelect=$id('gcGarageRepairService'),mechanicSelect=$id('gcGarageRepairMechanic'),mechanic2Select=$id('gcGarageRepairMechanic2'),prioritySelect=$id('gcGarageRepairPriority'),notes=$id('gcGarageRepairNotes');
    if(vehicleSelect)vehicleSelect.value=encodeURIComponent(key);
    if(serviceSelect)serviceSelect.value=analysis.service;
    if(!Array.from(serviceSelect?.options||[]).some(o=>o.value===analysis.service))return {done:false,message:`O serviço ${analysis.service} não existe no formulário da oficina. Nenhuma OS foi criada.`};
    if(mechanicSelect)mechanicSelect.value=analysis.primary.id;
    if(prioritySelect)prioritySelect.value=analysis.urgent?'Urgente':'Alta';
    if(mechanic2Select)mechanic2Select.value=analysis.urgent?analysis.secondary.id:'';
    if(garageSelect&&garage)garageSelect.value=garage.value;
    if(notes)notes.value=`Pane: ${alert.reason}. Escala automática autorizada pelo proprietário. Profissional recomendado por especialidade e nível: ${analysis.primary.name} (nível ${analysis.primary.level}).${analysis.urgent?` Segundo mecânico: ${analysis.secondary.name} (nível ${analysis.secondary.level}).`:''} Confirmar diagnóstico e peças antes da compra.`;
    if(typeof gcGarageUpdateSecondMechanicVisibility==='function')gcGarageUpdateSecondMechanicVisibility();
    const before=gcGarageOrders().length;
    gcGarageCreateOrder({preventDefault(){}});
    const created=gcGarageOrders().slice(before).find(o=>o.vehicleKey===key)||gcGarageOrders().find(o=>o.vehicleKey===key&&o.breakdownId===alert.id&&!['Aprovada','Cancelada'].includes(o.status));
    if(!created)return {done:false,message:'A oficina não confirmou a criação da OS. Confira garagem, mecânico e ordem de serviço; nenhuma compra foi feita.'};
    updateReport(f.payload.reportId,{status:'Diagnóstico revalidado · mecânico escalado',analysis:`Após sua autorização, Caio revalidou a pane (${alert.reason}), conferiu o componente ${alert.componentKey||'ainda não identificado'}, cruzou a especialidade e a experiência dos profissionais livres e selecionou ${analysis.primary.name}${analysis.urgent?` e ${analysis.secondary.name}`:''}. A causa definitiva e a compatibilidade das peças devem ser confirmadas na oficina.`,recommendedMechanic:`${analysis.primary.name} · nível ${analysis.primary.level}${analysis.urgent?` + ${analysis.secondary.name} · nível ${analysis.secondary.level}`:''}`,actionTaken:`OS ${created.number} criada e vinculada ao prefixo ${alert.prefix}. Serviço: ${analysis.service}. Status inicial: ${created.status}. O mecânico foi escalado somente após sua autorização.`,service:analysis.service,purchaseNote:'A OS lista as peças e insumos necessários. Caio não compra automaticamente; aguarde diagnóstico e autorize a compra no Mercado de Peças.'});
    return {done:true,message:`OS ${created.number} criada. ${analysis.primary.name} foi escalado${analysis.urgent?` junto com ${analysis.secondary.name}`:''} para ${analysis.service}. A ordem está ${created.status}; nenhuma peça foi comprada sem sua autorização.`};
  }

  function dispatchApprenticeReserve(f){
    const alert=typeof gcGarageAlerts==='function'?gcGarageAlerts().find(x=>x.id===f.payload.alertId&&!x.resolvedAt):null;
    if(!alert)return {done:false,message:'A pane já foi resolvida ou o alerta não está mais aberto. Faça uma nova análise.'};
    const op=typeof ownerOperations==='function'?ownerOperations().find(x=>x.id===alert.operationId):null;
    if(!op)return {done:false,message:'Não encontrei a operação vinculada à pane. Nenhum veículo foi enviado.'};
    const analysis=apprenticeReserveAnalysis(alert,op),candidate=analysis.candidate;
    if(!candidate)return {done:false,message:`O ônibus recomendado deixou de estar disponível. ${analysis.reason||'Faça nova análise.'}`};
    if(candidate.key!==f.payload.recommendedVehicleKey)return {done:false,message:`A disponibilidade mudou. O novo melhor ônibus é ${candidate.vehicle.company} · ${candidate.vehicle.prefix}. Nenhum despacho foi feito; faça uma nova análise e autorize a nova recomendação.`};
    if(typeof gcGarageRenderAlerts!=='function'||typeof gcGarageHandleBreakdownSwap!=='function')return {done:false,message:'O procedimento original de despacho mecânico não está disponível. Não alterei a operação.'};
    gcGarageRenderAlerts();
    const select=document.querySelector(`[data-gc-breakdown-select="${CSS.escape(alert.id)}"]`);
    if(!select)return {done:false,message:'Não consegui abrir o seletor original da Garagem. Nenhum despacho foi feito.'};
    const encoded=encodeURIComponent(candidate.key);
    if(!Array.from(select.options).some(option=>option.value===encoded))select.add(new Option(`${candidate.vehicle.company} · ${candidate.vehicle.prefix} · ${candidate.vehicle.model} · condição ${candidate.condition}%`,encoded));
    select.value=encoded;
    // Usa o despacho original da Garagem/Visualizador: ele cria replacementDispatch e mantém o timer de chegada.
    gcGarageHandleBreakdownSwap(alert.id);
    const updated=(typeof ownerOperations==='function'?ownerOperations():[]).find(x=>x.id===op.id);
    if(!updated?.replacementDispatch)return {done:false,message:'O despacho não foi confirmado pelo sistema original. A operação e o timer não foram alterados pelo Aprendiz.'};
    const dispatch=updated.replacementDispatch;
    const instruction='Permaneça parado em local seguro, sinalize a ocorrência, mantenha os passageiros protegidos e aguarde a chegada do ônibus reserva. Não tente seguir viagem com o veículo avariado.';
    const rows=ownerOperations(),target=rows.find(x=>x.id===op.id);
    if(target){target.driverInstruction={incidentId:alert.id,text:instruction,assignedAt:new Date().toISOString(),source:'Jovem Aprendiz'};target.lastEvent=`${target.lastEvent||'Substituto acionado.'} Orientação ao motorista: ${instruction}`;writeArrayKey(OPERATION_KEY,rows);if(typeof renderOperations==='function')renderOperations();}
    const parts=faultPartSuggestion(alert);
    updateReport(f.payload.reportId,{status:'Substituto em deslocamento',recommendedVehicle:`${candidate.vehicle.company} · ${candidate.vehicle.prefix} · ${candidate.vehicle.model} (${candidate.condition}%)`,analysis:`Reserva validada novamente no momento da autorização: livre, sem pane/OS e condição ${candidate.condition}%.`,actionTaken:`Despacho mecânico original acionado. O Visualizador está com status “substituição em deslocamento”; timer preservado até ${new Date(dispatch.arrivesAtMs).toLocaleString('pt-BR')}.`,driverInstruction:instruction,arrivalEstimate:`${dispatch.durationMinutes} minutos · trânsito ${dispatch.trafficLabel} · chegada ${new Date(dispatch.arrivesAtMs).toLocaleTimeString('pt-BR')}.`,service:parts.service,partToCheck:parts.part,partBasePrice:parts.basePrice,partCategory:parts.category,purchaseNote:parts.note});
    return {done:true,message:`Ônibus ${candidate.vehicle.prefix} enviado à linha. Timer de ${dispatch.durationMinutes} minutos (${dispatch.trafficLabel}) preservado. A linha só retoma quando o despacho original confirmar a chegada; o ônibus avariado continua retido para conserto.`};
  }
  function applyDriverGuidance(f){
    const rows=ownerOperations(),op=rows.find(x=>x.id===f.payload.operationId);if(!op)return {done:false,message:'A operação não foi encontrada. Nenhuma orientação foi registrada.'};
    if(f.payload.type==='mecanica'&&f.payload.alertId&&!gcGarageAlerts().some(a=>a.id===f.payload.alertId&&!a.resolvedAt))return {done:false,message:'A pane já não está aberta. Faça uma nova análise antes de orientar o motorista.'};
    if(f.payload.incidentId&&op.gcIncidentActive?.id!==f.payload.incidentId)return {done:false,message:'A ocorrência mudou desde a análise. Faça uma nova verificação antes de orientar o motorista.'};
    const instruction=f.payload.instruction||operationalInstruction(f.payload.type);
    op.driverInstruction={incidentId:f.payload.incidentId||f.payload.alertId||'',text:instruction,assignedAt:new Date().toISOString(),source:'Jovem Aprendiz'};
    op.lastEvent=`${op.lastEvent||'Ocorrência registrada.'} Orientação ao motorista: ${instruction}`;
    if(!writeArrayKey(OPERATION_KEY,rows))return {done:false,message:'Não foi possível salvar a orientação. O status e o timer da operação foram preservados.'};
    if(typeof renderOperations==='function')renderOperations();
    if(f.payload.type==='mecanica'&&typeof gcGarageOpen==='function'){gcGarageOpen();gcGarageSetTab('alerts');}
    updateReport(f.payload.reportId,{status:'Orientação autorizada e registrada',actionTaken:'Orientação registrada no histórico da operação; nenhum veículo foi liberado, substituído ou reparado automaticamente.',driverInstruction:instruction});
    return {done:true,message:'Orientação registrada para o motorista. O status, os bloqueios e os timers do Visualizador não foram alterados.'};
  }
  function approveFinding(id,options={}){
    if(!options.ownerChecked&&!ownerCheck())return false;const data=apprenticeData(),f=data.findings.find(x=>x.id===id&&x.status==='pending');if(!f)return false;
    if(!options.preconfirmed&&!window.confirm(`AUTORIZAR AÇÃO DO JOVEM APRENDIZ?\n\n${f.title}\n\n${f.detail}\n\nO Aprendiz somente executará a ação descrita após sua confirmação.`))return false;
    let result={done:false,message:'Ação não executada.'};
    try{
      if(f.action==='complete-cleaning'){
        const ev=typeof gcAgendaFindEvent==='function'?gcAgendaFindEvent(f.payload.eventId):null;
        if(!ev||gcAgendaIsDone(f.payload.eventId))result={done:true,message:'A tarefa já estava concluída ou não está mais disponível.'};
        else if(!['clean','wash'].includes(String(ev.type||'')))result={done:false,message:'A tarefa não está classificada como limpeza/lavagem. Encaminhe pela Agenda para evitar concluir o tipo errado.'};
        else {gcAgendaSelectedDate=ev.date||f.payload.date||today();gcAgendaMarkDone(ev.id);result={done:true,message:'Limpeza/lavagem marcada como concluída e histórico de limpeza atualizado. Faça a conferência física do ônibus.'};}
      }else if(f.action==='open-workshop'){
        const ev=typeof gcAgendaFindEvent==='function'?gcAgendaFindEvent(f.payload.eventId):null;
        if(!ev)result={done:false,message:'A tarefa da Agenda não foi encontrada. Atualize a análise.'};
        else {gcGarageOpenFromAgenda(ev.id);result={done:true,message:'Encaminhado à Garagem. A ordem ainda depende de você selecionar garagem, mecânico e confirmar a abertura do serviço.'};}
      }else if(f.action==='open-vehicle-workshop'){
        if(typeof gcGarageOpenRepair==='function'){gcGarageOpenRepair(f.payload.vehicleKey,'Inspeção geral','',`Sugestão do Jovem Aprendiz: condição ${f.detail}`);result={done:true,message:'Ficha de conserto aberta. Confira o ônibus e selecione o mecânico; nenhuma ordem foi criada ainda.'};}
      }else if(f.action==='open-garage'){
        if(typeof gcGarageOpen==='function'){gcGarageOpen();result={done:true,message:'Garagem aberta para completar ano e hodômetro. Nenhum dado foi alterado.'};if(f.payload?.reportId)updateReport(f.payload.reportId,{status:'Encaminhado à Garagem',actionTaken:'A ocorrência não estava vinculada a uma linha ativa. A Garagem foi aberta para inspeção manual; nenhum ônibus foi enviado e nenhum serviço ou compra foi executado.'});}
      }else if(f.action==='payroll'){
        result=openBankPayroll(f.payload.employee,f.payload.competence);
      }else if(f.action==='apprentice-dispatch-replacement'){
        result=dispatchApprenticeReserve(f);
      }else if(f.action==='apprentice-assign-mechanic'){
        result=assignApprenticeMechanic(f);
      }else if(f.action==='apprentice-breakdown-guidance'||f.action==='guide-operation-driver'){
        result=applyDriverGuidance(f);
      }else if(f.action==='open-operations'){
        const panel=$id('operationViewerPanel');if(panel){panel.scrollIntoView({behavior:'smooth',block:'start'});result={done:true,message:'Visualizador localizado na Área do Dono. Confira os motoristas da linha indicada.'};}
      }
    }catch(error){console.error('[Jovem Aprendiz] Ação não concluída:',error);result={done:false,message:`Não foi possível executar: ${error.message||'erro inesperado'}.`};}
    if(result.done){setFindingStatus(id,'authorized',result.message);if(!options.suppressToast)toast(result.message);}else{const d=apprenticeData(),target=d.findings.find(x=>x.id===id);if(target){target.lastAttemptAt=new Date().toISOString();target.result=result.message;saveApprentice(d);}if(f.payload?.reportId)updateReport(f.payload.reportId,{status:'Ação não executada',actionTaken:result.message});if(!options.suppressToast)toast(result.message);}
    if(!options.suppressRender)renderApprentice();
    return Boolean(result.done);
  }
  function rejectFinding(id,options={}){if(!options.preconfirmed&&!ownerCheck())return false;const f=apprenticeData().findings.find(x=>x.id===id&&x.status==='pending');if(!f)return false;if(!options.preconfirmed&&!window.confirm(`Recusar a sugestão “${f.title}”? Nenhuma alteração será feita.`))return false;if(!setFindingStatus(id,'rejected','Recusado pelo proprietário.')){toast('Não foi possível salvar a recusa. O item continua pendente; tente novamente.');return false;}if(f.payload?.reportId)updateReport(f.payload.reportId,{status:'Recusado pelo proprietário',actionTaken:'Nenhuma ação executada; a sugestão foi recusada.'});if(!options.suppressToast)toast('Sugestão recusada. Nenhuma ação foi executada.');if(!options.suppressRender)renderApprentice();return true;}
    function downloadApprenticeReport(id){if(!ownerCheck())return;const report=apprenticeData().reports.find(x=>x.id===id);if(!report)return;downloadTextFile(`Grupo_Conect_Relatorio_${id}.txt`,apprenticeReportText(report));toast('Relatório do Jovem Aprendiz baixado.');}
  function openApprentice(){if(!ownerCheck())return;const panel=$id('gcApprenticePanel');if(!panel)return;panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});renderApprentice();scanApprentice();}
  function closeApprentice(){const panel=$id('gcApprenticePanel');if(panel)panel.hidden=true;}

  function showApprenticeTool(tool){if(!ownerCheck())return;const box=$id('gcApprenticeToolResult'),body=$id('gcApprenticeToolBody'),title=$id('gcApprenticeToolTitle');if(!box||!body)return;let html='',label='Ferramenta de apoio';
    if(tool==='fleet'){
      label='Auditoria de Frota';const fleet=typeof gcGarageVehicles==='function'?gcGarageVehicles():[],stateMap=typeof gcGarageState==='function'?gcGarageState():{},vehicles=fleet.map(v=>{const key=typeof gcGarageKey==='function'?gcGarageKey(v):`${v.company}|${v.prefix}`;return stateMap[key]||{key,company:v.company,prefix:v.prefix,model:v.model,yearEstimated:true,kmEstimated:true,uninitialized:true};}),orders=typeof gcGarageOrders==='function'?gcGarageOrders():[],keys=new Map();const dup=[];vehicles.forEach(v=>{const k=`${normLocal(v.company)}|${normLocal(v.prefix)}`;if(keys.has(k))dup.push(`${v.company} · ${v.prefix}`);else keys.set(k,v);});const critical=vehicles.filter(v=>typeof gcGarageCondition==='function'&&gcGarageCondition(v)<40),incomplete=vehicles.filter(v=>v.yearEstimated||v.kmEstimated),active=orders.filter(o=>!['Aprovada','Cancelada'].includes(o.status));html=`<div class="gc-apprentice-tool-kpis">${[['Ônibus',vehicles.length],['Condição crítica',critical.length],['Fichas estimadas',incomplete.length],['OS em andamento',active.length]].map(([a,b])=>`<div><span>${esc(a)}</span><strong>${b}</strong></div>`).join('')}</div><p>${dup.length?`Prefixos duplicados na mesma empresa: ${dup.map(esc).join(', ')}.`:'Não encontrei prefixos duplicados dentro da mesma empresa.'}</p><p>${critical.length?`Condição crítica: ${critical.map(v=>`${esc(v.company)} · ${esc(v.prefix)} (${gcGarageCondition(v)}%)`).join('; ')}.`:'Nenhum ônibus aparece abaixo de 40% na ficha atual.'}</p><p>${incomplete.length?`Completar ano/km: ${incomplete.map(v=>`${esc(v.company)} · ${esc(v.prefix)}`).join('; ')}.`:'As fichas técnicas encontradas têm ano e hodômetro informados.'}</p><button type="button" class="primary-button" id="gcApprenticeOpenGarage">Abrir Garagem e conferir →</button>`;
    }else if(tool==='payroll'){
      label='Conferência de Salários';const month=currentPayrollMonth(),paid=readArrayKey(GC_BANK_PAYROLL_KEY),staff=(typeof gcGarageStaff==='function'?gcGarageStaff():[]).filter(x=>x.active!==false&&['driver','mechanic','other'].includes(x.role));const rows=staff.map(x=>({...x,done:paid.some(p=>p.competence===month&&normLocal(p.company)===normLocal(x.company||'Grupo Conect')&&normLocal(p.name)===normLocal(x.name))}));html=`<p>Competência ${esc(month)} · ${rows.filter(x=>x.done).length} de ${rows.length} funcionários contratados com folha registrada.</p>${rows.length?rows.map(x=>`<article class="gc-apprentice-mini-row"><div><strong>${esc(x.name)} · ${esc(x.company||'Grupo Conect')}</strong><small>${x.role==='mechanic'?'Mecânico':x.role==='driver'?'Motorista':esc(x.roleLabel||'Equipe')} · salário base cadastrado ${moneyFmt(Number(x.salary)||0)}</small></div><span class="gc-apprentice-status ${x.done?'authorized':'pending'}">${x.done?'Registrado':'Não registrado'}</span></article>`).join(''):'<p>Nenhum colaborador contratado foi encontrado. A folha usa a equipe ativa e os motoristas cadastrados no Visualizador.</p>'}<button type="button" class="primary-button" id="gcApprenticeOpenPayroll">Abrir folha no Banco →</button>`;
    }else if(tool==='daily'){
      label='Relatório Diário';const events=typeof gcAgendaEventsForDate==='function'?gcAgendaEventsForDate(today()):[],pending=events.filter(x=>!x.completed&&!gcAgendaIsDone(x.id)),orders=typeof gcGarageOrders==='function'?gcGarageOrders().filter(x=>!['Aprovada','Cancelada'].includes(x.status)):[],fleet=typeof gcGarageVehicles==='function'?gcGarageVehicles():[],stateMap=typeof gcGarageState==='function'?gcGarageState():{},vehicles=fleet.map(v=>{const key=typeof gcGarageKey==='function'?gcGarageKey(v):`${v.company}|${v.prefix}`;return stateMap[key]||{company:v.company,prefix:v.prefix,blocked:false};}),blocked=vehicles.filter(x=>x.blocked);html=`<div class="gc-apprentice-tool-kpis">${[['Agenda pendente',pending.length],['Ordens ativas',orders.length],['Ônibus bloqueados',blocked.length],['Frota reconhecida',vehicles.length]].map(([a,b])=>`<div><span>${esc(a)}</span><strong>${b}</strong></div>`).join('')}</div><h4>Próximos itens da Agenda</h4>${pending.slice(0,8).map(x=>`<p>• ${esc(x.time||'Sem horário')} · ${esc(x.vehicle||'Frota geral')} — ${esc(x.title)}</p>`).join('')||'<p>Nenhuma tarefa pendente para hoje.</p>'}<h4>Oficina em andamento</h4>${orders.slice(0,6).map(x=>`<p>• OS ${esc(x.number||x.id)} · ${esc(x.company||'')} ${esc(x.prefix||'')} — ${esc(x.status)}</p>`).join('')||'<p>Nenhuma ordem ativa.</p>'}`;
    }
    title.textContent=label;body.innerHTML=html;box.hidden=false;box.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  // Funções Dono: quinze experiências curtas e repetíveis, com progresso no navegador.
  const routes=['Paraíba do Sul × Três Rios','Três Rios × Vassouras','Vassouras × Barra do Piraí','Paraíba do Sul × Petrópolis','Três Rios × Areal','Vassouras × Miguel Pereira','Paraíba do Sul × Valença','Três Rios × Juiz de Fora'];
  const dispatchCases=[
    {title:'Congestionamento na entrada da cidade',desc:'A linha acumula 18 minutos de atraso e o ônibus está próximo de um terminal.',choices:[['Manter a rota e informar passageiros',3,'Você preservou a segurança e comunicou o atraso.'],['Desviar por via alternativa já conhecida',4,'Desvio coerente, com previsão de retorno ao itinerário.'],['Acelerar para recuperar o horário',-4,'Decisão inadequada: não se deve compensar atraso aumentando risco.']]},
    {title:'Demanda acima da capacidade',desc:'A procura prevista é de 86 passageiros; o próximo ônibus comporta 48.',choices:[['Despachar reforço / segundo carro',4,'Boa decisão: capacidade adicional reduz superlotação.'],['Usar veículo maior disponível',4,'Boa decisão se o veículo e motorista estiverem liberados.'],['Manter apenas um ônibus',-3,'Risco de lotação e passageiros não atendidos.']]},
    {title:'Motorista comunica cansaço',desc:'Faltam 40 minutos para o fim de uma jornada longa.',choices:[['Acionar reserva habilitado',4,'Você priorizou segurança e continuidade.'],['Reduzir o intervalo do motorista',-4,'Decisão inadequada: descanso não deve ser comprimido.'],['Reprogramar a partida e informar passageiros',3,'Atraso controlado, com transparência.']]},
    {title:'Falha leve detectada antes da partida',desc:'O checklist aponta lâmpada de freio inoperante.',choices:[['Segurar o veículo e corrigir antes de sair',4,'A falha foi tratada antes de expor passageiros.'],['Liberar e reparar depois',-5,'Falha de segurança não deve ser ignorada.'],['Trocar por veículo disponível',3,'Boa alternativa quando a substituição é segura.']]}
  ];
  const serviceCases=[
    {title:'Passageiro perdeu conexão por atraso',desc:'Ele pede uma solução e está irritado.',choices:[['Ouvir, explicar e oferecer orientação clara',4,'Atendimento transparente reduziu o conflito.'],['Culpar o trânsito e encerrar',-3,'A resposta não resolveu a necessidade do passageiro.'],['Registrar reclamação e acompanhar o caso',3,'Bom encaminhamento e rastreabilidade.']]},
    {title:'Objeto esquecido no ônibus',desc:'Uma pessoa liga procurando uma mochila.',choices:[['Registrar em Achados e Perdidos e conferir o carro',4,'Procedimento rastreável e cuidadoso.'],['Prometer entrega sem localizar',-3,'Promessa sem confirmação gera expectativa indevida.'],['Orientar retirada após identificação',3,'Boa prática para evitar entrega à pessoa errada.']]},
    {title:'Ônibus chegou lotado',desc:'Passageiros reclamam que não conseguiram embarcar.',choices:[['Verificar reforço ou veículo de maior capacidade',4,'Resposta orientada à demanda.'],['Ignorar a manifestação',-4,'A insatisfação tende a crescer.'],['Registrar o pico para ajustar a tabela',3,'Boa decisão para planejamento futuro.']]}
  ];
  const quizQuestions=[
    {q:'O que deve acontecer quando um defeito de freio é identificado antes da viagem?',a:['Liberar e acompanhar','Impedir a partida até corrigir ou substituir','Pedir ao motorista que use menos o freio'],correct:1,why:'Freios são item crítico de segurança; o veículo não deve sair nessas condições.'},
    {q:'Para calcular lucro operacional de uma viagem, qual abordagem é melhor?',a:['Subtrair apenas diesel da receita','Considerar receita e os custos variáveis e fixos relevantes','Usar apenas o número de passageiros'],correct:1,why:'Uma visão de resultado exige considerar os custos que realmente incidem sobre o serviço.'},
    {q:'Uma linha apresenta demanda maior que a capacidade disponível. Qual ação é mais adequada?',a:['Planejar reforço ou veículo maior','Reduzir o tempo de embarque sem análise','Ignorar a lotação'],correct:0,why:'O planejamento deve compatibilizar demanda, capacidade, frota e escala.'},
    {q:'O que o ARLA 32 faz em veículos com SCR?',a:['Lubrifica o motor','Ajuda a reduzir NOx no sistema de pós-tratamento','Substitui o diesel'],correct:1,why:'O ARLA 32 é reagente do sistema SCR; não é combustível nem óleo lubrificante.'},
    {q:'Ao receber uma reclamação, qual registro é mais útil?',a:['Data, linha, veículo, motivo e encaminhamento','Só o primeiro nome','Somente uma nota sem contexto'],correct:0,why:'O registro contextual facilita investigar e corrigir recorrências.'},
    {q:'Como o dono deve tratar um alerta preventivo de manutenção?',a:['Parar sempre a linha automaticamente','Ignorar até ocorrer pane','Avaliar o alerta e decidir o envio à oficina'],correct:2,why:'Lembretes preventivos informam; a decisão operacional deve seguir a regra do simulador e o risco identificado.'}
  ];
  const diagnosisCases=[
    {title:'Alerta de pressão de óleo',desc:'Durante a conferência, a luz de pressão do óleo permanece acesa após a partida. Qual deve ser a primeira conduta?',choices:[['Desligar o motor em segurança e solicitar verificação do nível/pressão antes de qualquer liberação',4,'Correto: pressão de óleo é crítica; não se deve manter o motor funcionando sem avaliação.'],['Acelerar para apagar o alerta',-4,'Incorreto: aumentar a rotação pode agravar danos se a lubrificação estiver comprometida.'],['Completar óleo com o motor quente e seguir viagem',-3,'Incorreto: é necessário procedimento seguro e diagnóstico; completar óleo não confirma pressão adequada.']]},
    {title:'Temperatura do motor subindo',desc:'O indicador de temperatura sobe acima da faixa normal e há suspeita de perda de líquido de arrefecimento.',choices:[['Parar em local seguro, desligar conforme procedimento e aguardar resfriamento antes da inspeção',4,'Correto: evita continuar sob superaquecimento e reduz risco de queimadura.'],['Abrir imediatamente a tampa do reservatório',-4,'Incorreto: sistema quente pode estar pressurizado e causar queimaduras graves.'],['Manter a operação em baixa velocidade',-3,'Incorreto: continuar rodando com superaquecimento pode causar dano severo.']]},
    {title:'Queda de pressão pneumática',desc:'O manômetro do sistema de ar demora a atingir a pressão de trabalho e o alarme permanece ativo.',choices:[['Manter o ônibus fora de operação e verificar vazamentos, compressor e secador',4,'Correto: freio pneumático depende de pressão adequada; não liberar sem inspeção.'],['Aumentar a rotação e liberar se o ônibus se mover',-4,'Incorreto: movimento não comprova funcionamento seguro do sistema de freios.'],['Drenar os reservatórios e liberar imediatamente',-3,'Incorreto: drenagem é rotina de manutenção, não solução para pressão insuficiente.']]},
    {title:'Desgaste irregular dos pneus',desc:'A inspeção identifica desgaste maior em uma borda do pneu dianteiro.',choices:[['Conferir pressão, alinhamento, suspensão e condição do conjunto antes de decidir a troca',4,'Correto: identifica causa provável e evita trocar pneu sem corrigir a origem.'],['Apenas inverter a posição dos pneus',-2,'Incorreto: remanejamento não corrige possível falha de alinhamento ou suspensão.'],['Aumentar a pressão sem consultar a especificação',-4,'Incorreto: calibragem deve seguir a carga e a orientação do fabricante.']]},
    {title:'Aviso do sistema SCR / ARLA 32',desc:'Um veículo equipado com SCR apresenta alerta de nível baixo de ARLA 32 e aviso de emissões.',choices:[['Conferir nível e especificação do ARLA 32, abastecer corretamente e ler os códigos do sistema',4,'Correto: verifica reagente e falha registrada sem improvisar componentes.'],['Adicionar água ao tanque de ARLA',-4,'Incorreto: contamina o reagente e pode danificar o sistema.'],['Desconectar sensores para apagar o alerta',-4,'Incorreto: não se deve burlar sistema de emissões ou segurança.']]}
  ];
  const routePlanCases=[
    {title:'Chuva forte na serra',desc:'Trecho principal: 42 km, 55 min estimados e risco elevado de pista escorregadia. Alternativa: 51 km, 68 min e menor exposição a trechos íngremes.',choices:[['Usar a alternativa sinalizada e informar o acréscimo de tempo',4,'Boa decisão: prioriza segurança e informa o passageiro sobre o prazo.'],['Manter a serra para cumprir horário a qualquer custo',-4,'Decisão arriscada: não compensa expor passageiros para recuperar minutos.'],['Escolher um atalho não reconhecido',-5,'Inadequado: rota desconhecida e não validada não deve ser usada.']]},
    {title:'Congestionamento com faixa liberada',desc:'A rota principal está 25 min mais lenta. Há desvio oficial com pedágio, 12 km adicionais e previsão mais estável.',choices:[['Comparar custo e tempo, usar o desvio oficial se a economia operacional compensar',4,'Boa decisão: avalia tempo, pedágio e segurança antes de alterar a rota.'],['Entrar em rua residencial proibida para ônibus',-5,'Inadequado: restrições viárias e segurança devem ser respeitadas.'],['Manter a rota sem avisar a central',-2,'A decisão pode ser segura, mas falta comunicação e atualização da previsão.']]},
    {title:'Interdição por alagamento',desc:'A água cobre parte da pista e não há confirmação da profundidade. A rota alternativa é 18 km maior.',choices:[['Não atravessar; aguardar liberação ou utilizar rota alternativa validada',4,'Correto: profundidade e condições do pavimento não podem ser presumidas.'],['Atravessar devagar seguindo outro veículo',-5,'Inadequado: não é possível avaliar profundidade, correnteza ou estado da pista.'],['Desviar por estrada de terra sem verificar restrições',-3,'Inadequado: rota alternativa também precisa ser validada para o veículo.']]},
    {title:'Janela apertada para conexão',desc:'O ônibus chega 10 min atrasado; passageiros têm conexão. Há possibilidade de reorganizar embarque no terminal sem acelerar.',choices:[['Avisar a conexão e reorganizar o embarque no terminal',4,'Boa decisão: reduz impacto sem transferir o atraso para riscos viários.'],['Solicitar ao motorista que exceda limites de velocidade',-5,'Inaceitável: não se recupera atraso aumentando risco.'],['Cancelar a conexão sem verificar alternativas',-2,'Faltou avaliar assistência e reacomodação dos passageiros.']]}
  ];
  function logActivity(d,type,title,detail,points=0){d.history.unshift({id:`act-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,type,title,detail,points,at:new Date().toISOString()});d.history=d.history.slice(0,60);d.scores[type]=(Number(d.scores[type])||0)+points;saveActivities(d);renderOwnerActivities();}
  function renderOwnerActivities(){const d=activityData(),stats=$id('gcOwnerFunctionsStats');if(stats){const total=d.history.length,points=Object.values(d.scores).reduce((a,b)=>a+(Number(b)||0),0),profit=[...d.charters,...d.schoolDeals,...d.adDeals].filter(x=>x.status==='completed').reduce((a,x)=>a+(Number(x.net)||0),0);stats.innerHTML=[['Atividades concluídas',total],['Pontos acumulados',points],['Lucro extra no Caixa',moneyFmt(profit)],['Satisfação simulada',`${Math.round(d.customerTrust)}/100`]].map(([a,b])=>`<div class="gc-owner-functions-stat"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');}
    const access=$id('gcOwnerFunctionsAccess');if(access)access.textContent=ownerAllowed()?'Acesso do proprietário ativo. Suas decisões são registradas neste navegador; ações financeiras exigem confirmação.':'Para registrar resultados no Caixa e acessar dados da frota, selecione Pablo na Área do Dono.';
    const hist=$id('gcOwnerActivityHistory');if(hist)hist.innerHTML=d.history.length?d.history.slice(0,12).map(x=>`<article class="record-item"><div><strong>${esc(x.title)}</strong><small>${esc(new Date(x.at).toLocaleString('pt-BR'))} · ${esc(x.detail)} ${x.points?`· ${x.points>0?'+':''}${x.points} pontos`:''}</small></div></article>`).join(''):'<p class="empty-state-text">As decisões e desafios concluídos aparecerão aqui.</p>';
  }
  let activeActivity='';
  function activityWorkspace(type){if(!ownerCheck())return;activeActivity=type;const box=$id('gcOwnerActivityWorkspace'),title=$id('gcOwnerActivityWorkspaceTitle'),body=$id('gcOwnerActivityWorkspaceBody');if(!box||!body)return;box.hidden=false;$id('gcOwnerActivityGrid').hidden=true;title.textContent=({charter:'Fretamento Extra',dispatch:'Desafio de Despacho',scale:'Planejador de Escala',supplier:'Negociação com Fornecedores',service:'Atendimento VIP',marketing:'Marketing de Linhas',bid:'Leilão de Contratos',fleet:'Raio-X da Frota',used:'Avaliação de Usados',quiz:'Quiz do Gestor',yard:'Quebra-cabeça do Terminal',diagnosis:'Diagnóstico Express',routeplan:'Planejador de Rota e Clima',school:'Contrato Escolar Extra',ads:'Publicidade na Frota'})[type]||'Atividade';body.innerHTML=activityContent(type);box.scrollIntoView({behavior:'smooth',block:'start'});}
  function activityContent(type){
    if(type==='charter')return `<p>Gere oportunidades fictícias de fretamento. Confira a receita prevista, o diesel, a taxa operacional e o lucro líquido antes de aceitar. O lucro só entra no Caixa quando você concluir o serviço.</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" id="gcCharterGenerate">＋ Gerar proposta de fretamento</button></div><div id="gcCharterOfferList">${renderCharters()}</div><p class="tool-result-note">Máximo de cinco propostas geradas por dia. O lucro creditado é líquido estimado; o custo de diesel e demais despesas já foi descontado no cálculo e não movimenta o estoque físico de combustível.</p>`;
    if(type==='dispatch')return `<p>Um novo cenário aparece sempre que você pedir outro desafio. Escolha uma decisão operacional; o sistema explica as consequências e pontua a qualidade da escolha.</p><button type="button" class="primary-button" id="gcDispatchNew">Gerar cenário</button><div id="gcDispatchCase" class="gc-owner-challenge-result">${renderCurrentChallenge('dispatch')}</div>`;
    if(type==='scale')return `<p>Teste se a capacidade e a quantidade de ônibus cobrem a procura. Ajuste os números livremente.</p><form id="gcScaleForm" class="gc-owner-mini-form"><label class="field"><span>Passageiros previstos</span><input class="plain-input" name="demand" type="number" min="1" max="5000" value="145" required></label><label class="field"><span>Capacidade por ônibus</span><input class="plain-input" name="capacity" type="number" min="1" max="300" value="48" required></label><label class="field"><span>Ônibus disponíveis</span><input class="plain-input" name="buses" type="number" min="0" max="100" value="3" required></label><label class="field"><span>Intervalo desejado (min)</span><input class="plain-input" name="interval" type="number" min="1" max="180" value="20" required></label><button class="primary-button" type="submit">Calcular escala →</button></form><div id="gcScaleResult"></div>`;
    if(type==='supplier')return `<p>Compare cotações simuladas de fornecedores. A análise considera preço, prazo e confiabilidade. O resultado não altera automaticamente os preços cadastrados no sistema de combustível.</p><button type="button" class="primary-button" id="gcSupplierGenerate">Solicitar três cotações</button><div id="gcSupplierQuotes">${renderSupplierQuotes()}</div>`;
    if(type==='service')return `<p>Atenda um passageiro em uma situação que exige decisão. Sua pontuação de satisfação muda conforme a qualidade do encaminhamento.</p><button type="button" class="primary-button" id="gcServiceNew">Receber atendimento</button><div id="gcServiceCase" class="gc-owner-challenge-result">${renderCurrentChallenge('service')}</div>`;
    if(type==='marketing')return `<p>Selecione uma campanha para uma rota e compare alcance, passageiros adicionais e retorno estimado. Não há débito no Caixa: esta é uma ferramenta de planejamento.</p><div class="gc-owner-marketing-grid">${[['digital','📱 Digital local',280,90,420],['terminal','🚌 Divulgação em terminal',520,170,680],['regional','📻 Rádio regional',850,250,1040]].map(([id,n,cost,reach,rev])=>`<button type="button" data-marketing="${id}"><strong>${n}</strong><small>Orçamento ${moneyFmt(cost)} · alcance ${reach} pessoas · receita incremental simulada ${moneyFmt(rev)}</small><b>Retorno projetado ${moneyFmt(rev-cost)}</b></button>`).join('')}</div><div id="gcMarketingResult"></div>`;
    if(type==='bid')return `<p>Receba um pedido fictício e pratique uma proposta comercial. O sistema calcula sua margem e estima a chance de aceitação com base no preço proposto.</p><button type="button" class="primary-button" id="gcBidNew">Receber solicitação de contrato</button><div id="gcBidCase" class="gc-owner-challenge-result">${renderCurrentChallenge('bid')}</div>`;
    if(type==='fleet')return `<p>Indicadores lidos da Garagem local. Use a ação para abrir a ficha real do módulo de mecânica, sem alterar o estado dos veículos.</p><div id="gcOwnerFleetSnapshot">${renderFleetSnapshot()}</div><button type="button" class="primary-button" id="gcOwnerOpenGarage">Abrir Garagem →</button>`;
    if(type==='used')return `<p>Avalie ofertas fictícias de ônibus usados: preço pedido, custo provável de preparação e preço de referência. Cada rodada gera uma oferta diferente; nada é comprado ou debitado.</p><button type="button" class="primary-button" id="gcUsedNew">Receber oferta de usado</button><div id="gcUsedCase" class="gc-owner-challenge-result">${renderCurrentChallenge('used')}</div>`;
    if(type==='quiz')return `<p>Teste seus conhecimentos de operação, segurança, manutenção e gestão. O banco de perguntas pode sortear questões em cada rodada.</p><button type="button" class="primary-button" id="gcQuizNew">Sortear pergunta</button><div id="gcQuizCase" class="gc-owner-challenge-result">${renderCurrentChallenge('quiz')}</div>`;
    if(type==='yard')return `<p>Organize três chegadas no terminal. Cada ônibus tem janela de chegada, tempo de permanência e requisito de plataforma. Evite conflito de ocupação e respeite acessibilidade e altura do veículo. Rodadas geradas aleatoriamente; pontuação não altera o Caixa nem as operações reais do Visualizador.</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" id="gcYardNew">Gerar nova grade do terminal</button></div><div id="gcYardCase" class="gc-owner-challenge-result">${renderYardRound()}</div>`;
    if(type==='diagnosis')return `<p>Leia o sintoma e escolha a primeira conduta segura. É um exercício de triagem simulada, não um diagnóstico real nem autorização para liberar um veículo.</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" id="gcDiagnosisNew">Sortear novo caso</button></div><div id="gcDiagnosisCase" class="gc-owner-challenge-result">${renderCurrentChallenge('diagnosis')}</div>`;
    if(type==='routeplan')return `<p>Planeje uma viagem fictícia considerando clima, trânsito, pedágio e segurança. Escolha a estratégia mais equilibrada para o cenário. Cada rodada muda.</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" id="gcRoutePlanNew">Gerar cenário de rota</button></div><div id="gcRoutePlanCase" class="gc-owner-challenge-result">${renderCurrentChallenge('routeplan')}</div>`;
    if(type==='school')return `<p>O cliente fictício solicita transporte escolar eventual por um mês. Defina a tarifa por aluno/dia; o sistema calcula combustível, motorista, monitor e reserva operacional, estima a chance de vencer e mostra a margem. O lucro só é lançado no Caixa depois que você concluir o serviço e confirmar.</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" id="gcSchoolGenerate">Receber nova solicitação escolar</button></div><div id="gcSchoolOffers">${renderSchoolDeals()}</div><p class="tool-result-note">Até quatro solicitações por dia. Contratos e lucro são inteiramente fictícios; não representam receita, cliente ou serviço real.</p>`;
    if(type==='ads')return `<p>Empresas fictícias oferecem campanhas de publicidade nos ônibus. Escolha o pacote e a quantidade de veículos, defina o preço e tente fechar o negócio. Após executar a campanha no simulador, o lucro líquido pode ser creditado ao Caixa com sua confirmação.</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" id="gcAdsGenerate">Receber proposta de anunciante</button></div><div id="gcAdsOffers">${renderAdDeals()}</div><p class="tool-result-note">Até cinco propostas por dia. A campanha é uma atividade financeira fictícia; não altera adesivos, disponibilidade nem estado físico dos ônibus.</p>`;
    return '<p>Atividade não encontrada.</p>';
  }
  function renderCharters(){const d=activityData(),rows=d.charters.slice().reverse().slice(0,8);return rows.length?rows.map(o=>`<article class="gc-charter-offer"><div><span class="gc-apprentice-status ${o.status==='completed'?'authorized':o.status==='accepted'?'pending':'rejected'}">${o.status==='completed'?'Concluído':o.status==='accepted'?'Aceito':'Disponível'}</span><h4>${esc(o.route)} · ${o.passengers} passageiros</h4><small>${o.km} km · tarifa média ${moneyFmt(o.fare)} · receita bruta ${moneyFmt(o.gross)} · custo estimado ${moneyFmt(o.cost)}</small><strong>Lucro líquido previsto: ${moneyFmt(o.net)}</strong></div><div class="gc-owner-activity-actions">${o.status==='available'?`<button class="primary-button" type="button" data-charter-accept="${esc(o.id)}" ${o.net<=0?'disabled':''}>Aceitar</button><button class="secondary-action-button" type="button" data-charter-decline="${esc(o.id)}">Recusar</button>`:''}${o.status==='accepted'?`<button class="primary-button" type="button" data-charter-complete="${esc(o.id)}">Concluir serviço e lançar lucro</button>`:''}</div></article>`).join(''):'<p class="empty-state-text">Nenhuma proposta gerada ainda.</p>';}
  function makeCharter(){if(!ownerCheck())return;const d=activityData(),day=today(),count=d.charters.filter(x=>x.day===day).length;if(count>=5){toast('Você já gerou cinco propostas hoje. Volte amanhã para novas oportunidades.');return;}const km=[28,42,65,88,120,155,190,230][Math.floor(Math.random()*8)],pax=12+Math.floor(Math.random()*37),fare=24+Math.random()*24,consumption=2.2+Math.random()*1.25,dieselPrice=7.99,tolls=km>120?30+Math.floor(Math.random()*55):Math.floor(Math.random()*25),driver=120+Math.floor(km*.55),gross=pax*fare,cost=(km/consumption*dieselPrice)+tolls+driver+gross*.055,net=Number((gross-cost).toFixed(2));const o={id:`charter-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,day,route:routes[Math.floor(Math.random()*routes.length)],km,passengers:pax,fare:Number(fare.toFixed(2)),consumption:Number(consumption.toFixed(2)),gross:Number(gross.toFixed(2)),cost:Number(cost.toFixed(2)),net,status:'available',createdAt:new Date().toISOString()};d.charters.push(o);saveActivities(d);$id('gcCharterOfferList').innerHTML=renderCharters();renderOwnerActivities();}
  function charterAction(id,action){if(!ownerCheck())return;const d=activityData(),o=d.charters.find(x=>x.id===id);if(!o)return;if(action==='accept'){if(o.status!=='available'||o.net<=0)return;o.status='accepted';o.acceptedAt=new Date().toISOString();saveActivities(d);logActivity(activityData(),'charter','Proposta aceita',`${o.route} · lucro estimado ${moneyFmt(o.net)}`,1);}else if(action==='decline'){if(o.status!=='available')return;o.status='declined';saveActivities(d);logActivity(activityData(),'charter','Proposta recusada',`${o.route}; nenhuma movimentação financeira.`,0);}else if(action==='complete'){
      if(o.status!=='accepted')return;const ledger=typeof cashLedger==='function'?cashLedger():readArrayKey(CASH_LEDGER_KEY),ledgerId=`owner-charter-profit-${o.id}`;if(ledger.some(x=>x.id===ledgerId)){o.status='completed';saveActivities(d);toast('Este lucro já foi registrado anteriormente.');return;}if(!window.confirm(`Concluir o fretamento ${o.route}?\nReceita bruta estimada: ${moneyFmt(o.gross)}\nCustos estimados já descontados: ${moneyFmt(o.cost)}\nLucro líquido a creditar no Caixa: ${moneyFmt(o.net)}\n\nO estoque de combustível não será alterado; este é um lançamento de lucro líquido simulado.`))return;
      const row={id:ledgerId,date:today(),direction:'in',amount:o.net,category:'Lucro líquido · fretamento extra simulado',description:`${o.route} · ${o.passengers} passageiros · receita ${moneyFmt(o.gross)} menos custos estimados ${moneyFmt(o.cost)}`,payee:'Cliente fictício de fretamento',company:'Grupo Conect',source:'gcOwnerFunctions',activityId:o.id,auto:true,createdAt:new Date().toISOString()};if(typeof writeArrayKey==='function'&&!writeArrayKey(CASH_LEDGER_KEY,[...ledger,row]))return;o.status='completed';o.completedAt=new Date().toISOString();saveActivities(d);if(typeof renderCashDashboard==='function')renderCashDashboard();if(typeof gcBankRender==='function')gcBankRender();logActivity(activityData(),'charter','Fretamento concluído',`${o.route} · lucro líquido ${moneyFmt(o.net)} creditado no Caixa.`,3);toast(`Lucro líquido de ${moneyFmt(o.net)} lançado no Caixa.`);
    }$id('gcCharterOfferList').innerHTML=renderCharters();renderOwnerActivities();}
  function currentChallenge(type){return activityData().activeChallenge[type]||null;}
  function renderCurrentChallenge(type){const c=currentChallenge(type);if(!c)return '<p class="empty-state-text">Gere uma nova rodada para começar.</p>';if(['dispatch','service','diagnosis','routeplan'].includes(type))return `<strong>${esc(c.title)}</strong><p>${esc(c.desc)}</p><div class="gc-owner-choice-grid">${c.choices.map((x,i)=>`<button type="button" data-challenge-choice="${type}|${i}" ${c.resolved?'disabled':''}>${esc(x[0])}</button>`).join('')}</div>`;if(type==='bid')return `<strong>${esc(c.title)}</strong><p>${esc(c.desc)}</p><form id="gcBidForm" class="gc-owner-mini-form"><label class="field"><span>Valor da proposta (R$)</span><input class="plain-input" name="bid" type="number" min="1" step="0.01" value="${Math.max(1,Math.round(c.budget*.95))}" required></label><button class="primary-button" type="submit">Avaliar proposta →</button></form>`;if(type==='used')return `<strong>${esc(c.title)}</strong><p>${esc(c.desc)}</p><div class="gc-owner-activity-actions"><button type="button" class="primary-button" data-used-choice="buy">A oferta parece boa</button><button type="button" class="secondary-action-button" data-used-choice="pass">Recusar negócio</button></div>`;if(type==='quiz')return `<strong>${esc(c.q)}</strong><div class="gc-owner-choice-grid">${c.a.map((x,i)=>`<button type="button" data-quiz-choice="${i}" ${c.resolved?'disabled':''}>${esc(x)}</button>`).join('')}</div>`;return '<p>Rodada não disponível.</p>';}
  function renderYardRound(){const c=currentChallenge('yard');if(!c)return '<p class="empty-state-text">Gere uma nova grade de chegadas para começar.</p>';if(c.resolved)return `<div class="gc-owner-result-feedback"><strong>${c.points>=0?'✅ Grade avaliada':'⚠️ Grade avaliada'}</strong><p>${esc(c.result||'Rodada concluída')} · ${c.points} pontos.</p></div><button type="button" class="secondary-action-button" id="gcYardNew">Nova grade →</button>`;return `<strong>${esc(c.title)}</strong><p>${esc(c.desc)}</p><form id="gcYardForm" class="gc-owner-mini-form gc-yard-form">${c.buses.map((b,i)=>`<label class="field"><span>${esc(b.prefix)} · chega ${b.arrival} min · ocupa ${b.dwell} min · ${esc(b.requirementLabel)}</span><select class="plain-input" name="bus${i}" required><option value="">Escolha a plataforma</option><option value="P1">Plataforma 1 — acessível / padrão</option><option value="P2">Plataforma 2 — padrão</option><option value="P3">Plataforma 3 — altura elevada / padrão</option></select></label>`).join('')}<button type="submit" class="primary-button">Conferir distribuição →</button></form><small>As plataformas devem permanecer livres durante todo o intervalo de permanência. Veículos de dois andares exigem a plataforma de altura elevada; veículos com embarque acessível devem usar a plataforma 1.</small>`;}
  function renderSchoolDeals(){const rows=activityData().schoolDeals.slice().reverse().slice(0,6);return rows.length?rows.map(o=>`<article class="gc-owner-deal-card"><div><span class="gc-apprentice-status ${o.status==='completed'?'authorized':o.status==='accepted'?'pending':'rejected'}">${o.status==='completed'?'Concluído':o.status==='accepted'?'Contrato vencido':o.status==='lost'?'Não selecionado':'Proposta enviada'}</span><h4>${esc(o.school)} · ${esc(o.route)}</h4><small>${o.students} alunos · ${o.days} dias letivos · ${o.km} km por sentido · proposta ${moneyFmt(o.quote||o.targetFare)}/aluno/dia</small><strong>Receita ${moneyFmt(o.gross)} · custos ${moneyFmt(o.cost)} · líquido ${moneyFmt(o.net)}</strong></div>${o.status==='available'?`<form data-school-deal="${esc(o.id)}"><label class="field"><span>Sua tarifa (R$/aluno/dia)</span><input class="plain-input" type="number" name="quote" min="0.01" max="500" step="0.01" value="${o.targetFare.toFixed(2)}" required></label><button type="submit" class="primary-button">Enviar proposta →</button></form>`:''}${o.status==='accepted'?`<button type="button" class="primary-button" data-school-complete="${esc(o.id)}">Executar mês e lançar lucro</button>`:''}</article>`).join(''):'<p class="empty-state-text">Nenhuma solicitação escolar recebida. Gere uma proposta para começar.</p>';}
  function renderAdDeals(){const rows=activityData().adDeals.slice().reverse().slice(0,6);return rows.length?rows.map(o=>`<article class="gc-owner-deal-card"><div><span class="gc-apprentice-status ${o.status==='completed'?'authorized':o.status==='accepted'?'pending':'rejected'}">${o.status==='completed'?'Campanha concluída':o.status==='accepted'?'Campanha contratada':o.status==='lost'?'Anunciante recusou':'Proposta enviada'}</span><h4>${esc(o.client)} · ${esc(o.packageLabel)}</h4><small>${o.buses} ônibus · ${o.days} dias · ${esc(o.route)}</small><strong>Receita ${moneyFmt(o.quote||0)} · custos ${moneyFmt(o.cost)} · líquido ${moneyFmt(o.net)}</strong></div>${o.status==='available'?`<form data-ads-deal="${esc(o.id)}"><label class="field"><span>Preço total da campanha (R$)</span><input class="plain-input" type="number" name="quote" min="0.01" max="100000" step="0.01" value="${o.targetPrice.toFixed(2)}" required></label><button type="submit" class="primary-button">Negociar campanha →</button></form>`:''}${o.status==='accepted'?`<button type="button" class="primary-button" data-ads-complete="${esc(o.id)}">Executar campanha e lançar lucro</button>`:''}</article>`).join(''):'<p class="empty-state-text">Nenhuma proposta publicitária recebida. Gere uma proposta para negociar.</p>';}
  function setChallenge(type,obj){const d=activityData();d.activeChallenge[type]=obj;saveActivities(d);}
  function createChallenge(type){if(!ownerCheck())return;
    if(type==='dispatch'){const c=dispatchCases[Math.floor(Math.random()*dispatchCases.length)];setChallenge(type,{...c,id:`${Date.now()}`});$id('gcDispatchCase').innerHTML=renderCurrentChallenge(type);}
    if(type==='service'){const c=serviceCases[Math.floor(Math.random()*serviceCases.length)];setChallenge(type,{...c,id:`${Date.now()}`});$id('gcServiceCase').innerHTML=renderCurrentChallenge(type);}
    if(type==='bid'){const budget=1400+Math.round(Math.random()*6200),route=routes[Math.floor(Math.random()*routes.length)];setChallenge(type,{id:`${Date.now()}`,title:'Solicitação de transporte corporativo',desc:`Cliente fictício precisa de serviço em ${route}. Orçamento de referência ${moneyFmt(budget)}; custos estimados do grupo ${moneyFmt(budget*.68)}.`,budget,cost:budget*.68,route});$id('gcBidCase').innerHTML=renderCurrentChallenge(type);}
    if(type==='used'){const models=['Marcopolo Torino OF-1721','Comil Campione 3.45 K440','Marcopolo Audace OF-1724','Caio Apache Vip IV'];const price=150000+Math.round(Math.random()*450000),repair=12000+Math.round(Math.random()*48000),market=price+repair+Math.round((Math.random()-.25)*150000);setChallenge(type,{id:`${Date.now()}`,title:models[Math.floor(Math.random()*models.length)],desc:`Oferta fictícia: preço pedido ${moneyFmt(price)}; preparação provável ${moneyFmt(repair)}; referência de mercado após preparação ${moneyFmt(market)}. Custo total estimado ${moneyFmt(price+repair)}.`,price,repair,market});$id('gcUsedCase').innerHTML=renderCurrentChallenge(type);}
    if(type==='quiz'){const q=quizQuestions[Math.floor(Math.random()*quizQuestions.length)];setChallenge(type,{...q,id:`${Date.now()}`});$id('gcQuizCase').innerHTML=renderCurrentChallenge(type);}
    if(type==='diagnosis'){const q=diagnosisCases[Math.floor(Math.random()*diagnosisCases.length)];setChallenge(type,{...q,id:`${Date.now()}`});$id('gcDiagnosisCase').innerHTML=renderCurrentChallenge(type);}
    if(type==='routeplan'){const q=routePlanCases[Math.floor(Math.random()*routePlanCases.length)];setChallenge(type,{...q,id:`${Date.now()}`});$id('gcRoutePlanCase').innerHTML=renderCurrentChallenge(type);}
  }
  function recordChoice(type,index){if(!ownerCheck())return;const c=currentChallenge(type);if(!c||c.resolved)return;const item=c.choices[index];if(!item)return;c.resolved=true;c.result=item[2];setChallenge(type,c);const d=activityData();if(type==='service')d.customerTrust=Math.max(0,Math.min(100,d.customerTrust+item[1]));saveActivities(d);const names={dispatch:'Desafio de despacho concluído',service:'Atendimento VIP resolvido',diagnosis:'Diagnóstico Express concluído',routeplan:'Planejamento de rota concluído'};logActivity(activityData(),type,names[type]||'Desafio concluído',`${item[2]}${type==='service'?` Satisfação: ${Math.round(activityData().customerTrust)}/100.`:''}`,item[1]);const targets={dispatch:['gcDispatchCase','gcDispatchNew'],service:['gcServiceCase','gcServiceNew'],diagnosis:['gcDiagnosisCase','gcDiagnosisNew'],routeplan:['gcRoutePlanCase','gcRoutePlanNew']},target=targets[type],el=target&&$id(target[0]);if(el)el.innerHTML=`<div class="gc-owner-result-feedback"><strong>${item[1]>=0?'✅ Decisão registrada':'⚠️ Decisão com impacto negativo'}</strong><p>${esc(item[2])}</p><b>${item[1]>0?'+':''}${item[1]} pontos</b></div><button type="button" class="secondary-action-button" id="${target[1]}">Nova rodada →</button>`;renderOwnerActivities();}
  function renderSupplierQuotes(){const quotes=activityData().activeChallenge.supplier?.quotes||[];return quotes.length?quotes.map(q=>`<article class="gc-owner-quote"><div><strong>${esc(q.name)}</strong><small>Preço base diesel simulado R$ 7,99/L · desconto ${q.discount}% · entrega ${q.days} dia(s) · confiabilidade ${q.reliability}/100</small><b>Economia estimada em 1.000 L: ${moneyFmt(7.99*1000*q.discount/100)}</b></div><button type="button" class="secondary-action-button" data-supplier-choice="${esc(q.id)}">Selecionar fornecedor</button></article>`).join(''):'<p class="empty-state-text">Peça novas cotações para comparar três fornecedores fictícios.</p>';}
  function generateSupplierQuotes(){if(!ownerCheck())return;const names=['Distribuidora Regional do Vale','Combustíveis Serra Verde','Rede Estrada Sul'],quotes=names.map((name,i)=>({id:`sup-${Date.now()}-${i}`,name,discount:2+Math.floor(Math.random()*8),days:1+Math.floor(Math.random()*5),reliability:78+Math.floor(Math.random()*21)}));const d=activityData();d.activeChallenge.supplier={quotes};saveActivities(d);$id('gcSupplierQuotes').innerHTML=renderSupplierQuotes();}
  function renderFleetSnapshot(){const fleet=typeof gcGarageVehicles==='function'?gcGarageVehicles():[],stateMap=typeof gcGarageState==='function'?gcGarageState():{},rows=fleet.map(v=>{const key=typeof gcGarageKey==='function'?gcGarageKey(v):`${v.company}|${v.prefix}`;return stateMap[key]||{key,company:v.company,prefix:v.prefix,model:v.model,yearEstimated:true,kmEstimated:true,uninitialized:true};});return rows.length?rows.slice(0,20).map(v=>`<article class="gc-owner-fleet-row"><div><strong>${esc(v.company)} · ${esc(v.prefix)} · ${esc(v.model)}</strong><small>${esc(v.chassis||'Chassi não informado')} · ${v.yearEstimated?'ano estimado':`ano ${v.year||'—'}`} · ${v.kmEstimated?'km estimado':`${Number(v.km||0).toLocaleString('pt-BR')} km`}</small></div><span class="gc-apprentice-status ${v.blocked?'rejected':gcGarageCondition(v)<40?'pending':'authorized'}">${v.blocked?'Bloqueado':`${gcGarageCondition(v)}%`}</span><button type="button" class="secondary-action-button" data-owner-open-bus="${esc(v.key)}">Ficha</button></article>`).join(''):'<p class="empty-state-text">Nenhum ônibus foi encontrado. Cadastre a frota na Área do Dono.</p>';}
  function runScale(){const form=$id('gcScaleForm');if(!form||!ownerCheck())return;const fd=new FormData(form),demand=Number(fd.get('demand')),capacity=Number(fd.get('capacity')),buses=Number(fd.get('buses')),interval=Number(fd.get('interval'));if(!(demand>0&&capacity>0&&buses>=0&&interval>0)){toast('Informe demanda, capacidade e intervalo válidos.');return;}const required=Math.ceil(demand/capacity),extra=Math.max(0,required-buses),load=demand/Math.max(1,buses*capacity)*100,wait=interval*(buses?Math.max(0,Math.ceil(required/buses)-1):0);$id('gcScaleResult').innerHTML=`<div class="gc-owner-result-feedback"><strong>${extra?`Faltam ${extra} ônibus para cobrir a capacidade estimada.`:'A frota disponível cobre a demanda informada.'}</strong><p>Necessidade teórica: ${required} ônibus · disponíveis: ${buses} · ocupação agregada estimada: ${Math.round(load)}% · espera adicional indicativa: ${wait} min.</p><small>Estimativa simplificada; não substitui dimensionamento por horários, tempo de ciclo, reserva técnica e legislação.</small></div>`;logActivity(activityData(),'scale','Planejamento de escala',`${demand} passageiros; ${required} ônibus recomendados; ${buses} disponíveis.`,extra?1:3);}
  function runBid(form){if(!ownerCheck())return;const c=currentChallenge('bid'),value=Number(new FormData(form).get('bid'));if(!c||!(value>0)){toast('Informe um valor de proposta válido.');return;}const margin=value-c.cost,marginPct=margin/value*100,prob=Math.max(5,Math.min(95,Math.round(80-Math.abs(value-c.budget)/c.budget*110+(marginPct<8?-12:marginPct>32?-15:8))));const success=Math.random()*100<prob;const msg=success?`Proposta aceita no cenário: margem estimada ${moneyFmt(margin)} (${Math.round(marginPct)}%).`:`Proposta não selecionada. Probabilidade estimada era ${prob}%; preço/custo não ficaram competitivos.`;$id('gcBidCase').innerHTML=`<div class="gc-owner-result-feedback"><strong>${success?'🏆 Contrato vencido (simulação)':'📉 Contrato não conquistado'}</strong><p>${esc(msg)}</p></div><button type="button" class="secondary-action-button" id="gcBidNew">Receber outra solicitação →</button>`;logActivity(activityData(),'bid','Leilão de contrato',msg,success?4:0);}
  function createYardRound(){if(!ownerCheck())return;const prefixes=['213','218','305','412','527','608','711','824'];const buses=Array.from({length:3},(_,i)=>{const mode=['standard','accessible','double'][Math.floor(Math.random()*3)],arrival=Math.floor(Math.random()*34),dwell=18+Math.floor(Math.random()*24);return {id:`yard-${Date.now()}-${i}`,prefix:prefixes[Math.floor(Math.random()*prefixes.length)],mode,arrival,dwell,requirement:mode==='accessible'?'P1':mode==='double'?'P3':'any',requirementLabel:mode==='accessible'?'elevador: plataforma 1':mode==='double'?'dois andares: plataforma 3':'veículo padrão'};});setChallenge('yard',{id:`yard-${Date.now()}`,title:'Pátio em horário de pico',desc:'Distribua os três ônibus sem sobrepor ocupação na mesma plataforma e respeite o requisito físico de cada veículo.',buses,resolved:false});const el=$id('gcYardCase');if(el)el.innerHTML=renderYardRound();}
  function submitYard(form){if(!ownerCheck())return;const c=currentChallenge('yard');if(!c||c.resolved)return;const fd=new FormData(form),assigned=c.buses.map((b,i)=>({bus:b,platform:String(fd.get(`bus${i}`)||'')}));if(assigned.some(x=>!x.platform)){toast('Escolha uma plataforma para cada ônibus.');return;}let points=0,notes=[];assigned.forEach(({bus,platform})=>{const compatible=bus.requirement==='any'||bus.requirement===platform;if(compatible){points+=3;notes.push(`${bus.prefix}: plataforma compatível.`);}else{points-=2;notes.push(`${bus.prefix}: plataforma incompatível com ${bus.requirementLabel}.`);}});let collisions=0;for(let i=0;i<assigned.length;i++)for(let j=i+1;j<assigned.length;j++){const a=assigned[i],b=assigned[j];if(a.platform!==b.platform)continue;const aEnd=a.bus.arrival+a.bus.dwell,bEnd=b.bus.arrival+b.bus.dwell;if(a.bus.arrival<bEnd&&b.bus.arrival<aEnd){collisions++;notes.push(`Conflito: ${a.bus.prefix} e ${b.bus.prefix} ocupam ${a.platform} em períodos sobrepostos.`);}}points-=collisions*3;if(!collisions)points+=4;points=Math.max(0,points);c.resolved=true;c.points=points;c.result=`${notes.join(' ')} ${collisions?'Foram encontrados '+collisions+' conflito(s).':'Nenhuma sobreposição de plataforma.'}`;setChallenge('yard',c);logActivity(activityData(),'yard','Quebra-cabeça do Terminal',`${c.result} Pontuação: ${points}.`,points>=10?4:points>=6?2:0);const el=$id('gcYardCase');if(el)el.innerHTML=renderYardRound();}
  function generateSchoolDeal(){
    if(!ownerCheck())return;
    const d=activityData(),day=today();
    if(d.schoolDeals.filter(x=>x.day===day).length>=4){toast('Limite diário de quatro solicitações escolares atingido.');return;}
    const schools=['Colégio Caminhos do Vale','Instituto Horizonte','Escola Parque das Águas','Centro Educacional Serra Azul','Colégio Integração Regional'];
    const school=schools[Math.floor(Math.random()*schools.length)],route=routes[Math.floor(Math.random()*routes.length)];
    const students=28+Math.floor(Math.random()*58),km=8+Math.floor(Math.random()*43),days=20;
    const roundKm=km*2,liters=roundKm*days/(2.45+Math.random()*.65),fuel=liters*7.99;
    const driver=155*days,monitor=115*days,maintenance=roundKm*days*.34;
    const cost=Number((fuel+driver+monitor+maintenance+(fuel+driver+monitor+maintenance)*.08).toFixed(2));
    const baseFare=14+Math.random()*11,breakEven=cost/(students*days);
    const targetFare=Number(Math.max(baseFare,breakEven*1.12).toFixed(2));
    const gross=Number((students*days*targetFare).toFixed(2)),net=Number((gross-cost).toFixed(2));
    const o={id:`school-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,day,school,route,students,km,days,targetFare,cost,gross,net,status:'available',createdAt:new Date().toISOString()};
    d.schoolDeals.push(o);saveActivities(d);const target=$id('gcSchoolOffers');if(target)target.innerHTML=renderSchoolDeals();
  }
  function submitSchoolQuote(form){if(!ownerCheck())return;const d=activityData(),id=form.dataset.schoolDeal,deal=d.schoolDeals.find(x=>x.id===id&&x.status==='available');if(!deal)return;const quote=Number(new FormData(form).get('quote'));if(!(quote>0&&quote<=500)){toast('Informe tarifa por aluno/dia entre R$ 0,01 e R$ 500,00.');return;}const gross=Number((deal.students*deal.days*quote).toFixed(2)),net=Number((gross-deal.cost).toFixed(2)),ratio=quote/deal.targetFare,prob=Math.max(2,Math.min(96,Math.round(92-Math.abs(ratio-1)*170-(ratio<.85?12:0))));const won=net>0&&Math.random()*100<prob;deal.quote=quote;deal.gross=gross;deal.net=net;deal.acceptanceChance=prob;deal.status=won?'accepted':'lost';deal.evaluatedAt=new Date().toISOString();saveActivities(d);const msg=won?`Contrato escolar conquistado. Tarifa ${moneyFmt(quote)}/aluno/dia; margem líquida simulada ${moneyFmt(net)}.`:`A proposta não foi selecionada${net<=0?' porque não cobria os custos estimados':` (chance estimada ${prob}%).`}`;logActivity(activityData(),'school','Proposta escolar avaliada',msg,won?4:0);const target=$id('gcSchoolOffers');if(target)target.innerHTML=renderSchoolDeals();}
  function completeSchoolDeal(id){if(!ownerCheck())return;const d=activityData(),o=d.schoolDeals.find(x=>x.id===id&&x.status==='accepted');if(!o)return;const net=Number(o.net)||0;if(net<=0){toast('O contrato não apresenta lucro líquido positivo; não pode gerar crédito no Caixa.');return;}const ledgerId=`owner-school-profit-${o.id}`,ledger=typeof cashLedger==='function'?cashLedger():readArrayKey(CASH_LEDGER_KEY);if(ledger.some(x=>x.id===ledgerId)){o.status='completed';o.completedAt=o.completedAt||new Date().toISOString();saveActivities(d);renderSchoolDealsIntoPage();toast('Este lucro já havia sido lançado; nenhuma duplicação foi criada.');return;}if(!window.confirm(`EXECUTAR CONTRATO ESCOLAR SIMULADO?\n\n${o.school} · ${o.route}\n${o.students} alunos · ${o.days} dias\nReceita: ${moneyFmt(o.gross)}\nCustos estimados: ${moneyFmt(o.cost)}\nLUCRO LÍQUIDO: ${moneyFmt(net)}\n\nO valor será creditado ao Caixa como resultado fictício. Estoque, frota e viagens reais não serão alterados.`))return;if(!postOwnerSimulationProfit(ledgerId,net,'Lucro líquido · contrato escolar fictício',`${o.school} · ${o.route} · ${o.students} alunos · receita ${moneyFmt(o.gross)} menos custos ${moneyFmt(o.cost)}`,'Cliente escolar fictício'))return;o.status='completed';o.completedAt=new Date().toISOString();saveActivities(d);logActivity(activityData(),'school','Contrato escolar concluído',`${o.school} · lucro líquido ${moneyFmt(net)} creditado no Caixa.`,5);const target=$id('gcSchoolOffers');if(target)target.innerHTML=renderSchoolDeals();toast(`Lucro simulado de ${moneyFmt(net)} creditado no Caixa.`);}
  function renderSchoolDealsIntoPage(){const target=$id('gcSchoolOffers');if(target)target.innerHTML=renderSchoolDeals();}
  function generateAdDeal(){
    if(!ownerCheck())return;
    const d=activityData(),day=today();
    if(d.adDeals.filter(x=>x.day===day).length>=5){toast('Limite diário de cinco propostas publicitárias atingido.');return;}
    const clients=['Mercado Vale Mais','Clínica Serra Saúde','Faculdade Horizonte','Supermercado Bom Caminho','Auto Peças Estradão','Rede de Farmácias Central'];
    const packages=[{id:'interior',label:'Mídia interna',rate:520,install:75},{id:'exterior',label:'Envelopamento parcial',rate:1450,install:420},{id:'digital',label:'Painel digital / QR',rate:390,install:55}];
    const pack=packages[Math.floor(Math.random()*packages.length)],buses=1+Math.floor(Math.random()*4),days=[7,15,30][Math.floor(Math.random()*3)];
    const route=routes[Math.floor(Math.random()*routes.length)],client=clients[Math.floor(Math.random()*clients.length)];
    const gross=Number((pack.rate*buses*days/30).toFixed(2));
    // Custo de produção parcial, operação, instalação e gestão; parâmetros do jogo, não cotações de mercado.
    const cost=Number((pack.install*buses*.35+(gross*.12)+buses*days*.8).toFixed(2));
    const targetPrice=Number((Math.max(gross*1.25,cost*1.18)).toFixed(2));
    const o={id:`ads-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,day,client,packageId:pack.id,packageLabel:pack.label,rate:pack.rate,install:pack.install,buses,days,route,gross,cost,targetPrice,quote:0,net:0,status:'available',createdAt:new Date().toISOString()};
    d.adDeals.push(o);saveActivities(d);const target=$id('gcAdsOffers');if(target)target.innerHTML=renderAdDeals();
  }
  function submitAdQuote(form){if(!ownerCheck())return;const d=activityData(),id=form.dataset.adsDeal,deal=d.adDeals.find(x=>x.id===id&&x.status==='available');if(!deal)return;const quote=Number(new FormData(form).get('quote'));if(!(quote>0&&quote<=100000)){toast('Informe um valor total de campanha válido.');return;}const net=Number((quote-deal.cost).toFixed(2)),ratio=quote/deal.targetPrice,prob=Math.max(2,Math.min(96,Math.round(92-Math.abs(ratio-1)*125-(ratio<.8?10:0))));const won=net>0&&Math.random()*100<prob;deal.quote=quote;deal.net=net;deal.acceptanceChance=prob;deal.status=won?'accepted':'lost';deal.evaluatedAt=new Date().toISOString();saveActivities(d);const msg=won?`Campanha contratada por ${moneyFmt(quote)}; custos ${moneyFmt(deal.cost)}; margem líquida ${moneyFmt(net)}.`:`O anunciante não aceitou${net<=0?' porque o valor não cobre os custos':` (chance estimada ${prob}%).`}`;logActivity(activityData(),'ads','Proposta de publicidade avaliada',msg,won?4:0);const target=$id('gcAdsOffers');if(target)target.innerHTML=renderAdDeals();}
  function completeAdDeal(id){if(!ownerCheck())return;const d=activityData(),o=d.adDeals.find(x=>x.id===id&&x.status==='accepted');if(!o)return;const net=Number(o.net)||0;if(net<=0){toast('A campanha não tem margem líquida positiva.');return;}const ledgerId=`owner-ads-profit-${o.id}`,ledger=typeof cashLedger==='function'?cashLedger():readArrayKey(CASH_LEDGER_KEY);if(ledger.some(x=>x.id===ledgerId)){o.status='completed';o.completedAt=o.completedAt||new Date().toISOString();saveActivities(d);const target=$id('gcAdsOffers');if(target)target.innerHTML=renderAdDeals();toast('Este lucro já havia sido lançado; não foi duplicado.');return;}if(!window.confirm(`CONCLUIR CAMPANHA PUBLICITÁRIA SIMULADA?\n\n${o.client} · ${o.packageLabel}\n${o.buses} ônibus · ${o.days} dias\nReceita: ${moneyFmt(o.quote)}\nCustos: ${moneyFmt(o.cost)}\nLUCRO LÍQUIDO: ${moneyFmt(net)}\n\nCrédito fictício no Caixa. Nenhuma alteração física será feita nos ônibus.`))return;if(!postOwnerSimulationProfit(ledgerId,net,'Lucro líquido · publicidade fictícia',`${o.client} · ${o.packageLabel} · ${o.buses} ônibus · ${o.days} dias · receita ${moneyFmt(o.quote)} menos custos ${moneyFmt(o.cost)}`,'Anunciante fictício'))return;o.status='completed';o.completedAt=new Date().toISOString();saveActivities(d);logActivity(activityData(),'ads','Campanha publicitária concluída',`${o.client} · lucro líquido ${moneyFmt(net)} creditado no Caixa.`,5);const target=$id('gcAdsOffers');if(target)target.innerHTML=renderAdDeals();toast(`Lucro simulado de ${moneyFmt(net)} creditado ao Caixa.`);}
  function postOwnerSimulationProfit(id,amount,category,description,payee){const ledger=typeof cashLedger==='function'?cashLedger():readArrayKey(CASH_LEDGER_KEY);if(ledger.some(x=>x.id===id)){toast('Este lançamento já existe no Caixa.');return false;}const row={id,date:today(),direction:'in',amount:Number(amount),category,description,payee,company:'Grupo Conect',source:'gcOwnerFunctions',auto:true,simulated:true,createdAt:new Date().toISOString()};if(typeof writeArrayKey!=='function'||!writeArrayKey(CASH_LEDGER_KEY,[...ledger,row])){toast('Não foi possível registrar no Caixa; nenhum contrato foi marcado como concluído.');return false;}if(typeof renderCashDashboard==='function')renderCashDashboard();if(typeof gcBankRender==='function')gcBankRender();return true;}
  function ownerActivityClick(event){
    const open=event.target.closest('[data-owner-activity-open]');if(open){activityWorkspace(open.dataset.ownerActivityOpen);return;}
    const accept=event.target.closest('[data-charter-accept]');if(accept){charterAction(accept.dataset.charterAccept,'accept');return;}
    const decline=event.target.closest('[data-charter-decline]');if(decline){charterAction(decline.dataset.charterDecline,'decline');return;}
    const complete=event.target.closest('[data-charter-complete]');if(complete){charterAction(complete.dataset.charterComplete,'complete');return;}
    const choice=event.target.closest('[data-challenge-choice]');if(choice){const [type,index]=choice.dataset.challengeChoice.split('|');recordChoice(type,Number(index));return;}
    const supplier=event.target.closest('[data-supplier-choice]');if(supplier){if(!ownerCheck())return;const d=activityData(),q=d.activeChallenge.supplier?.quotes?.find(x=>x.id===supplier.dataset.supplierChoice);if(!q)return;d.supplierBest={...q,selectedAt:new Date().toISOString()};saveActivities(d);logActivity(activityData(),'supplier','Fornecedor preferido selecionado',`${q.name} · desconto ${q.discount}%, prazo ${q.days} dias, confiabilidade ${q.reliability}/100. Cotação simulada; sem alteração de preço real.`,2);$id('gcSupplierQuotes').innerHTML=`<div class="gc-owner-result-feedback"><strong>Fornecedor selecionado: ${esc(q.name)}</strong><p>Economia estimada em 1.000 L: ${moneyFmt(7.99*1000*q.discount/100)}. A cotação foi salva como referência; confirme valores no sistema de combustível antes de comprar.</p></div>`;renderOwnerActivities();return;}
    const marketing=event.target.closest('[data-marketing]');if(marketing){if(!ownerCheck())return;const campaigns={digital:['Digital local',280,90,420],terminal:['Divulgação em terminal',520,170,680],regional:['Rádio regional',850,250,1040]},c=campaigns[marketing.dataset.marketing];if(!c)return;$id('gcMarketingResult').innerHTML=`<div class="gc-owner-result-feedback"><strong>${esc(c[0])} · retorno projetado ${moneyFmt(c[3]-c[1])}</strong><p>Orçamento ${moneyFmt(c[1])}; alcance estimado ${c[2]} pessoas; receita incremental estimada ${moneyFmt(c[3])}. Nenhum valor foi debitado ou creditado.</p></div>`;logActivity(activityData(),'marketing','Campanha avaliada',`${c[0]} · retorno projetado ${moneyFmt(c[3]-c[1])}.`,2);return;}
    const used=event.target.closest('[data-used-choice]');if(used){if(!ownerCheck())return;const c=currentChallenge('used');if(!c)return;const good=c.price+c.repair<c.market;const correct=(used.dataset.usedChoice==='buy')===good;const msg=correct?`Boa análise. ${good?'O preço total ficou abaixo da referência.':'Você evitou uma compra acima da referência.'}`:`A análise indicava ${good?'oportunidade de compra no cenário':'risco de pagar acima da referência'}.`;logActivity(activityData(),'used','Oferta de usado avaliada',msg,correct?3:-1);$id('gcUsedCase').innerHTML=`<div class="gc-owner-result-feedback"><strong>${correct?'✅ Decisão coerente':'⚠️ Decisão arriscada'}</strong><p>${esc(msg)} Custo total: ${moneyFmt(c.price+c.repair)} · valor de referência ${moneyFmt(c.market)}. Nenhum veículo foi adquirido.</p></div><button type="button" class="secondary-action-button" id="gcUsedNew">Analisar outra oferta →</button>`;return;}
    const quiz=event.target.closest('[data-quiz-choice]');if(quiz){if(!ownerCheck())return;const c=currentChallenge('quiz');if(!c||c.resolved)return;const idx=Number(quiz.dataset.quizChoice),correct=idx===c.correct;c.resolved=true;setChallenge('quiz',c);const msg=`${correct?'Resposta correta.':'Resposta incorreta.'} ${c.why}`;$id('gcQuizCase').innerHTML=`<div class="gc-owner-result-feedback"><strong>${correct?'✅ Correto!':'❌ Não foi dessa vez.'}</strong><p>${esc(msg)}</p></div><button type="button" class="secondary-action-button" id="gcQuizNew">Próxima pergunta →</button>`;logActivity(activityData(),'quiz','Quiz do Gestor',msg,correct?3:0);return;}
    const bus=event.target.closest('[data-owner-open-bus]');if(bus){if(typeof gcGarageOpen==='function'){gcGarageOpen();if(typeof gcGarageRenderDetail==='function')gcGarageRenderDetail(bus.dataset.ownerOpenBus);}return;}
  }
  $id('gcApprenticeOpenButton')?.addEventListener('click',openApprentice);
  $id('gcApprenticeClose')?.addEventListener('click',closeApprentice);
  $id('gcApprenticeScan')?.addEventListener('click',scanApprentice);
  $id('gcApprenticeFindings')?.addEventListener('click',event=>{const a=event.target.closest('[data-apprentice-approve]'),r=event.target.closest('[data-apprentice-reject]');if(a)approveFinding(a.dataset.apprenticeApprove);if(r)rejectFinding(r.dataset.apprenticeReject);});
  $id('gcApprenticeFindings')?.addEventListener('change',event=>{const input=event.target.closest('[data-apprentice-select]');if(!input)return;if(input.checked)selectedApprenticeFindings.add(input.dataset.apprenticeSelect);else selectedApprenticeFindings.delete(input.dataset.apprenticeSelect);const visible=Array.from($id('gcApprenticeFindings')?.querySelectorAll('[data-apprentice-select]')||[]).map(x=>({id:x.dataset.apprenticeSelect}));refreshApprenticeBulkbar(visible);});
  $id('gcApprenticeSelectAll')?.addEventListener('change',event=>{const inputs=Array.from($id('gcApprenticeFindings')?.querySelectorAll('[data-apprentice-select]')||[]);inputs.forEach(input=>{input.checked=event.target.checked;if(input.checked)selectedApprenticeFindings.add(input.dataset.apprenticeSelect);else selectedApprenticeFindings.delete(input.dataset.apprenticeSelect);});refreshApprenticeBulkbar(inputs.map(x=>({id:x.dataset.apprenticeSelect})));});
  $id('gcApprenticeBulkApprove')?.addEventListener('click',bulkApproveFindings);
  $id('gcApprenticeBulkReject')?.addEventListener('click',bulkRejectFindings);
  $id('gcApprenticeReports')?.addEventListener('click',event=>{const b=event.target.closest('[data-apprentice-report-download]');if(b)downloadApprenticeReport(b.dataset.apprenticeReportDownload);});
  $id('gcApprenticeHomeOpen')?.addEventListener('click',()=>{switchScreen('ownerAreaScreen');if(!ownerAllowed()){toast('Selecione Pablo na Área do Dono para acessar as recomendações.');return;}openApprentice();});
  $id('gcApprenticeTools')?.addEventListener('click',()=>{});
  document.querySelectorAll('[data-apprentice-tool]').forEach(b=>b.addEventListener('click',()=>showApprenticeTool(b.dataset.apprenticeTool)));
  $id('gcApprenticeToolClose')?.addEventListener('click',()=>{$id('gcApprenticeToolResult').hidden=true;});
  $id('gcApprenticeToolResult')?.addEventListener('click',event=>{if(event.target.closest('#gcApprenticeOpenGarage')){if(typeof gcGarageOpen==='function')gcGarageOpen();}if(event.target.closest('#gcApprenticeOpenPayroll')){if(typeof gcBankOpen==='function'){gcBankOpen();gcBankSetTab('payroll');}}});
  $id('gcOwnerActivityWorkspaceBody')?.addEventListener('submit',event=>{if(event.target.id==='gcScaleForm'){event.preventDefault();runScale();}else if(event.target.id==='gcBidForm'){event.preventDefault();runBid(event.target);}else if(event.target.id==='gcYardForm'){event.preventDefault();submitYard(event.target);}else if(event.target.matches('[data-school-deal]')){event.preventDefault();submitSchoolQuote(event.target);}else if(event.target.matches('[data-ads-deal]')){event.preventDefault();submitAdQuote(event.target);}});
  $id('gcOwnerActivityWorkspaceBody')?.addEventListener('click',event=>{
    if(event.target.closest('#gcCharterGenerate')){makeCharter();return;}
    if(event.target.closest('#gcDispatchNew')){createChallenge('dispatch');return;}
    if(event.target.closest('#gcServiceNew')){createChallenge('service');return;}
    if(event.target.closest('#gcBidNew')){createChallenge('bid');return;}
    if(event.target.closest('#gcUsedNew')){createChallenge('used');return;}
    if(event.target.closest('#gcQuizNew')){createChallenge('quiz');return;}
    if(event.target.closest('#gcSupplierGenerate')){generateSupplierQuotes();return;}
    if(event.target.closest('#gcYardNew')){createYardRound();return;}
    if(event.target.closest('#gcDiagnosisNew')){createChallenge('diagnosis');return;}
    if(event.target.closest('#gcRoutePlanNew')){createChallenge('routeplan');return;}
    if(event.target.closest('#gcSchoolGenerate')){generateSchoolDeal();return;}
    if(event.target.closest('#gcAdsGenerate')){generateAdDeal();return;}
    const schoolDone=event.target.closest('[data-school-complete]');if(schoolDone){completeSchoolDeal(schoolDone.dataset.schoolComplete);return;}
    const adsDone=event.target.closest('[data-ads-complete]');if(adsDone){completeAdDeal(adsDone.dataset.adsComplete);return;}
    if(event.target.closest('#gcOwnerOpenGarage')){if(typeof gcGarageOpen==='function')gcGarageOpen();return;}
  });
  $id('gcOwnerActivityClose')?.addEventListener('click',()=>{$id('gcOwnerActivityWorkspace').hidden=true;$id('gcOwnerActivityGrid').hidden=false;activeActivity='';});
  $id('ownerFunctionsScreen')?.addEventListener('click',ownerActivityClick);
  const originalSwitchScreen=typeof switchScreen==='function'?switchScreen:null;
  let lastAutomaticScan=0;
  function maybeAutomaticScan(){if(!ownerAllowed()||document.hidden)return;const nowMs=Date.now();if(nowMs-lastAutomaticScan<30000)return;lastAutomaticScan=nowMs;scanApprentice({silent:true});}
  if(originalSwitchScreen){switchScreen=function(screenId){originalSwitchScreen(screenId);if(screenId==='ownerFunctionsScreen')renderOwnerActivities();if(screenId==='ownerAreaScreen'){refreshApprenticeAlert();maybeAutomaticScan();}};}
  const originalActivateOwner=typeof activateOwnerArea==='function'?activateOwnerArea:null;
  if(originalActivateOwner){activateOwnerArea=function(){originalActivateOwner();if(ownerAllowed()){refreshApprenticeAlert();maybeAutomaticScan();}};}
  $id('ownerUserSelect')?.addEventListener('change',()=>{if(ownerAllowed())setTimeout(maybeAutomaticScan,250);});
  if($id('gcOwnerFunctionsStats'))renderOwnerActivities();
  if(ownerAllowed())refreshApprenticeAlert();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ownerAllowed())maybeAutomaticScan();});
  // Monitoriza o Visualizador a cada 30 s enquanto o site está visível e Pablo está selecionado.
  // O monitor é local: ao voltar de uma aba oculta, visibilitychange dispara nova leitura.
  setInterval(()=>{try{maybeAutomaticScan();}catch(e){console.warn('[Jovem Aprendiz] Monitor local:',e);}},30000);
  console.info('[Grupo Conect] Jovem Aprendiz e Funções Dono carregados.');
})();


/* =====================================================================
   GRUPO CONECT — Endurecimento final do Visualizador de Operação
   Correções aditivas: despacho com timer persistente, término de desvios,
   liberação segura após ocorrência e conferência dos turnos.
   Não substitui nem remove os módulos existentes.
   ===================================================================== */
(function gcVisualizerFinalReliabilityPatch(){
  if (window.__gcVisualizerFinalReliabilityPatch) return;
  window.__gcVisualizerFinalReliabilityPatch = true;

  const previousSync = syncOneOperationProgress;
  const previousRender = renderOperations;
  const previousBreakdownSwap = gcGarageHandleBreakdownSwap;
  const previousDriverForTrip = opDriverForTrip;

  const toMs = value => {
    if (value === null || value === undefined || value === '') return NaN;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const trafficMinutes = label => ({
    'Livre':22, 'Moderado':25, 'Intenso':32, 'Muito intenso':40
  }[String(label||'').trim()] || 25);
  const formatRemaining = (dispatch, now=Date.now()) => {
    const left = Math.max(0, Math.ceil((Number(dispatch?.arrivesAtMs||0)-now)/1000));
    return opFormatCountdown(left);
  };
  const currentOperations = () => {
    try { return typeof ownerOperations === 'function' ? ownerOperations() : []; }
    catch (_) { return []; }
  };

  function normalizeReplacementDispatch(op, now){
    const dispatch = op?.replacementDispatch;
    if (!dispatch || typeof dispatch !== 'object') return false;
    let changed = false;
    let startedAtMs = toMs(dispatch.startedAtMs);
    if (!Number.isFinite(startedAtMs)) startedAtMs = toMs(dispatch.startedAt);
    if (!Number.isFinite(startedAtMs)) startedAtMs = now;
    let duration = Number(dispatch.durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 240) duration = trafficMinutes(dispatch.trafficLabel);
    let arrivesAtMs = toMs(dispatch.arrivesAtMs);
    if (!Number.isFinite(arrivesAtMs)) arrivesAtMs = toMs(dispatch.arrivesAt);
    if (!Number.isFinite(arrivesAtMs) || arrivesAtMs < startedAtMs) arrivesAtMs = startedAtMs + duration*60000;
    if (Number(dispatch.startedAtMs) !== startedAtMs) { dispatch.startedAtMs = startedAtMs; changed = true; }
    if (Number(dispatch.arrivesAtMs) !== arrivesAtMs) { dispatch.arrivesAtMs = arrivesAtMs; changed = true; }
    if (Number(dispatch.durationMinutes) !== duration) { dispatch.durationMinutes = duration; changed = true; }
    const startedIso = new Date(startedAtMs).toISOString();
    const arrivesIso = new Date(arrivesAtMs).toISOString();
    if (dispatch.startedAt !== startedIso) { dispatch.startedAt = startedIso; changed = true; }
    if (dispatch.arrivesAt !== arrivesIso) { dispatch.arrivesAt = arrivesIso; changed = true; }
    if (!dispatch.replacementCompany) { dispatch.replacementCompany = op.vehicleCompany || op.company || ''; changed = true; }
    if (!dispatch.replacementPrefix) { dispatch.replacementPrefix = String(op.prefix||''); changed = true; }
    if (!dispatch.replacementModel) { dispatch.replacementModel = op.busModel || ''; changed = true; }
    if (!dispatch.trafficLabel) { dispatch.trafficLabel = 'Moderado'; changed = true; }
    if (op.status !== 'substituição em deslocamento') { op.status = 'substituição em deslocamento'; changed = true; }
    if (op.clockAnchorAt !== null) { op.clockAnchorAt = null; changed = true; }
    return changed;
  }

  function independentOperationBlock(op){
    if (!op) return {blocked:false,reason:''};
    if (op.replacementDispatch) return {blocked:true,kind:'dispatch',reason:'substituto ainda em deslocamento'};
    if (op.pendingVehicleSwap?.busAtTerminal) return {blocked:true,kind:'terminal',reason:'aguardando encontro com o ônibus reserva'};
    if (op.gcInspectionPaused) return {blocked:true,kind:'inspection',reason:'fiscalização reprovada; reinspeção pendente'};
    if (op.gcFuelPaused) return {blocked:true,kind:'fuel',reason:'abastecimento/ARLA 32 pendente'};

    const orders = typeof gcGarageOrders === 'function' ? gcGarageOrders() : [];
    if (op.gcUserMaintenanceHoldOrderId) {
      const held = orders.find(row=>row.id===op.gcUserMaintenanceHoldOrderId);
      if (held && !['Aprovada','Cancelada'].includes(held.status))
        return {blocked:true,kind:'workshop',reason:`ônibus retido pela OS ${held.number||''}`.trim()};
      delete op.gcUserMaintenanceHoldOrderId;
      delete op.gcMaintenancePreviousStatus;
      delete op.gcMaintenanceStoppedByOrder;
    }
    if (op.gcMaintenanceStoppedByOrder) {
      const held = orders.find(row=>row.id===op.gcUserMaintenanceHoldOrderId && !['Aprovada','Cancelada'].includes(row.status));
      if (held) return {blocked:true,kind:'workshop',reason:`ônibus retido pela OS ${held.number||''}`.trim()};
      delete op.gcMaintenanceStoppedByOrder;
    }

    const vehicle = {company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||'',chassis:op.chassis||''};
    const key = vehicle.company && vehicle.prefix && typeof gcGarageKey === 'function' ? gcGarageKey(vehicle) : '';
    const alerts = typeof gcGarageAlerts === 'function' ? gcGarageAlerts() : [];
    const openAlert = alerts.find(row=>!row.resolvedAt && (row.operationId===op.id || (key && row.vehicleKey===key)));
    if (openAlert) return {blocked:true,kind:'mechanical',reason:openAlert.reason||'pane mecânica ainda aberta'};

    const state = key && typeof gcGarageCurrentVehicle === 'function' ? gcGarageCurrentVehicle(vehicle) : null;
    if (state?.blocked) return {blocked:true,kind:'mechanical',reason:state.blockedReason||'ônibus retido pela oficina'};
    const openOrder = key && orders.find(row=>row.vehicleKey===key && !['Aprovada','Cancelada'].includes(row.status));
    if (openOrder) return {blocked:true,kind:'workshop',reason:`ordem de serviço ${openOrder.number||''} pendente`.trim()};

    // Alguns backups antigos mantinham apenas o ID da pane mesmo após sua baixa.
    // Só removemos esse marcador quando não existe alerta aberto nem retenção real.
    if (op.breakdownId) {
      const linked = alerts.some(row=>row.id===op.breakdownId && !row.resolvedAt);
      if (!linked && !state?.blocked) delete op.breakdownId;
    }
    return {blocked:false,reason:''};
  }

  function setBlockedOperationStatus(op, block, now){
    if (!block?.blocked) return false;
    if (op.status === 'pausada') { op.clockAnchorAt = null; return false; }
    const status = block.kind==='fuel' || block.kind==='workshop' ? 'parada técnica' : 'fora de operação';
    const changed = op.status !== status || op.clockAnchorAt !== null;
    op.status = status;
    op.clockAnchorAt = null;
    if (changed) op.lastEvent = `DESVIO ENCERRADO · itinerário normal disponível, mas a linha continua parada porque há outro bloqueio: ${block.reason}.`;
    return changed;
  }

  function incidentPlanFromHistory(record, op){
    const type = String(record?.type||'transito');
    const choices = INCIDENT_RESPONSES[type] || [];
    const response = String(record?.resolution||'');
    const index = Math.max(0, choices.indexOf(response));
    const minutesByType = {
      acidente:[20,45,30,60,90], obra:[40,15,20,10,15],
      mecanica:[25,45,25,20,60], transito:[20,30,15,10,25], clima:[45,60,15,35,30]
    };
    const minutes = Number(record?.durationMinutes) || (minutesByType[type]||[30])[Math.min(index,4)] || 30;
    const speed = Math.max(1,Number(op?.speedMultiplier)||1);
    const manual = type==='mecanica';
    return {type,response,index,minutes,manual,durationMs:minutes*60000/(manual?1:speed)};
  }

  function closeExpiredDetour(op, now, record, reason){
    if (record) {
      record.autoClosedAt = record.autoClosedAt || new Date(now).toISOString();
      record.autoClosedReason = record.autoClosedReason || reason || 'Prazo da decisão de desvio concluído';
      record.completedAt = record.completedAt || record.autoClosedAt;
    }
    if (op.gcIncidentActive?.effect==='detour') op.gcIncidentActive = null;
    if (op.status==='pausada') {
      op.clockAnchorAt = null;
      op.lastEvent = 'Desvio encerrado; a pausa manual da operação foi preservada.';
      return true;
    }
    const block = independentOperationBlock(op);
    if (block.blocked) {
      setBlockedOperationStatus(op,block,now);
      return true;
    }
    op.status = 'operando';
    op.clockAnchorAt = now;
    op.lastEvent = 'Desvio encerrado automaticamente; itinerário normal retomado.';
    return true;
  }

  function normalizeDetourAfterCoreSync(op, now){
    if (!op || op.status!=='operando com desvio') return false;
    const active = op.gcIncidentActive;
    if (active?.effect==='detour') {
      let endsAt = toMs(active.endsAtMs);
      if (!Number.isFinite(endsAt)) {
        const record = (op.incidentHistory||[]).find(row=>row.id===active.id) ||
          (op.incidentHistory||[]).slice().reverse().find(row=>row.type===active.type && row.resolution);
        const plan = incidentPlanFromHistory({...record,...active,resolution:active.response||record?.resolution},op);
        const start = toMs(active.startedAtMs) || toMs(active.startedAt) || toMs(record?.resolvedAt) || toMs(record?.occurredAt) || now;
        endsAt = start + plan.durationMs;
        active.startedAtMs = start;
        active.endsAtMs = endsAt;
        active.durationMinutes = plan.minutes;
      }
      if (now < endsAt) return false;
      const record = (op.incidentHistory||[]).find(row=>row.id===active.id);
      return closeExpiredDetour(op,now,record,'Prazo da decisão de desvio concluído');
    }

    const record = (op.incidentHistory||[]).slice().reverse().find(row=>
      row.type!=='mecanica' && row.resolution &&
      (row.operationalEffect==='detour' || /desvio/.test(norm(row.resolution))) && !row.userKeptStoppedAt
    );
    if (!record) return closeExpiredDetour(op,now,null,'Desvio sem ocorrência ativa encerrado');
    if (record.autoClosedAt) return closeExpiredDetour(op,now,record,'Desvio legado previamente concluído');

    const plan = incidentPlanFromHistory(record,op);
    const resolvedAt = toMs(record.resolvedAt) || toMs(record.occurredAt) || now;
    const endsAt = resolvedAt + plan.durationMs;
    if (now >= endsAt) return closeExpiredDetour(op,now,record,'Prazo de decisão legado concluído');
    // Recupera o relógio de versões antigas que guardavam somente o texto do desvio.
    op.gcIncidentActive = {
      id:record.id,type:plan.type,effect:'detour',response:plan.response,
      startedAtMs:resolvedAt,endsAtMs:endsAt,durationMinutes:plan.minutes,
      timeBasis:'simulado',manualRelease:false,resumeStatus:'operando'
    };
    return true;
  }

  function failReplacementDispatch(op, dispatch, now, reason){
    const old = dispatch.oldVehicle || {};
    op.lastReplacementDispatch = {...dispatch,failedAt:new Date(now).toISOString(),failureReason:reason};
    op.replacementDispatch = null;
    // Retorna a linha ao ônibus avariado para que o alerta original continue
    // oferecendo as opções de oficina ou uma nova substituição.
    if (old.prefix) {
      op.vehicleCompany = old.company || dispatch.oldVehicleCompany || op.company || op.vehicleCompany;
      op.prefix = String(old.prefix);
      op.busModel = old.model || op.busModel;
      op.chassis = old.chassis || op.chassis || '';
    }
    const hold=old.holdFlags||{};
    ['gcInspectionPaused','gcUserMaintenanceHoldOrderId','gcMaintenanceStoppedByOrder','gcFuelPaused'].forEach(key=>{
      if(hold[key])op[key]=hold[key];else delete op[key];
    });
    ['gcInspectionPreviousStatus','gcMaintenancePreviousStatus','gcFuelPreviousStatus'].forEach(key=>{
      if(hold[key])op[key]=hold[key];else delete op[key];
    });
    op.breakdownId = dispatch.alertId || op.breakdownId || '';
    op.status = 'fora de operação';
    op.clockAnchorAt = null;
    op.lastEvent = `Substituição não concluída: ${reason} O ônibus avariado voltou a ficar associado à operação; escolha outro reserva ou encaminhe-o à oficina.`;
    if (dispatch.alertId && typeof gcGarageAlerts==='function' && typeof gcGarageWrite==='function') {
      const alerts = gcGarageAlerts();
      const alert = alerts.find(row=>row.id===dispatch.alertId);
      if (alert) {
        alert.resolvedAt = '';
        alert.resolution = '';
        alert.operationId = op.id;
        if (old.company && old.prefix && typeof gcGarageKey==='function') alert.vehicleKey = gcGarageKey({company:old.company,prefix:old.prefix});
        gcGarageWrite(GC_GARAGE_ALERTS_KEY,alerts);
      }
    }
    return true;
  }

  // Valida a reserva novamente na chegada. Isso evita que um ônibus que recebeu
  // pane/OS ou foi escalado em outra linha durante o deslocamento seja liberado.
  syncOneOperationProgress = function(op, now=Date.now()){
    if (!op) return previousSync(op,now);
    let changed = false;
    if (op.replacementDispatch) {
      changed = normalizeReplacementDispatch(op,now) || changed;
      const dispatch = op.replacementDispatch;
      if (Number(dispatch.arrivesAtMs) <= now && typeof opSwapVehicleAvailability==='function') {
        const availability = opSwapVehicleAvailability(dispatch.replacementCompany,dispatch.replacementPrefix,op.id);
        if (!availability.ok) return failReplacementDispatch(op,dispatch,now,availability.reason);
      }
    }
    let coreChanged = false;
    try {
      coreChanged = previousSync(op,now);
    } catch (error) {
      console.error('[Grupo Conect] Falha ao sincronizar operação; aplicando recuperação segura.',error);
      changed = true;
      if (op.replacementDispatch) {
        normalizeReplacementDispatch(op,now);
      } else if (op.status==='operando com desvio') {
        const block = independentOperationBlock(op);
        if (block.blocked) setBlockedOperationStatus(op,block,now);
      }
    }
    changed = coreChanged || changed;
    if (op.replacementDispatch) {
      changed = normalizeReplacementDispatch(op,now) || changed;
      const dispatch = op.replacementDispatch;
      if (Number(dispatch.arrivesAtMs) <= now) {
        // Fallback defensivo: se uma versão anterior não finalizou o timer,
        // conclui a chegada sem zerar o histórico financeiro das viagens.
        const availability = typeof opSwapVehicleAvailability==='function'
          ? opSwapVehicleAvailability(dispatch.replacementCompany,dispatch.replacementPrefix,op.id)
          : {ok:true};
        if (!availability.ok) changed = failReplacementDispatch(op,dispatch,now,availability.reason) || changed;
        else {
          op.lastReplacementDispatch = {...dispatch,arrivedAt:new Date(now).toISOString()};
          op.replacementDispatch = null;
          op.status = 'operando';
          op.clockAnchorAt = now;
          op.breakdownId = '';
          op.gcFuelPreparedTrip = 0;
          op.garagePreTripEventId = dispatch.preTripEventId || op.garagePreTripEventId || '';
          op.lastEvent = `Ônibus substituto ${dispatch.replacementPrefix} chegou após ${dispatch.durationMinutes} min · trânsito ${String(dispatch.trafficLabel||'moderado').toLowerCase()}. Operação retomada normalmente.`;
          changed = true;
        }
      }
    } else if (op.status==='substituição em deslocamento') {
      // Não deixa uma linha presa em estado de deslocamento se um backup antigo
      // perdeu o objeto do despacho. Mantém parada e explica a inconsistência.
      const arrived = op.lastReplacementDispatch && (op.lastReplacementDispatch.arrivedAt || op.lastReplacementDispatch.failedAt);
      if (arrived) {
        op.status = op.lastReplacementDispatch.failedAt ? 'fora de operação' : 'operando';
        op.clockAnchorAt = op.status==='operando' ? now : null;
      } else {
        op.status = 'fora de operação';
        op.clockAnchorAt = null;
        op.lastEvent = 'Despacho de substituição sem temporizador recuperável. A linha ficou retida por segurança; revise a Garagem antes de liberar.';
      }
      changed = true;
    }

    // Um desvio vencido não pode continuar exibido indefinidamente, nem pode
    // transformar bloqueio mecânico/fiscal/financeiro em operação liberada.
    changed = normalizeDetourAfterCoreSync(op,now) || changed;
    if (op.status==='operando com desvio') {
      const block = independentOperationBlock(op);
      if (block.blocked) changed = setBlockedOperationStatus(op,block,now) || changed;
    }
    return changed;
  };

  // A camada original permanece responsável pelo dispatch. Esta proteção apenas
  // valida a disponibilidade real usando a mesma regra da troca programada.
  if (typeof previousBreakdownSwap === 'function') {
    gcGarageHandleBreakdownSwap = function(alertId){
      const alert = (typeof gcGarageAlerts==='function'?gcGarageAlerts():[]).find(row=>row.id===alertId && !row.resolvedAt);
      if (!alert) return previousBreakdownSwap(alertId);
      const select = document.querySelector(`[data-gc-breakdown-select="${CSS.escape(alertId)}"]`);
      const key = select?.value ? decodeURIComponent(select.value) : '';
      const candidate = typeof gcGarageVehicles==='function' ? gcGarageVehicles().find(v=>gcGarageKey(v)===key) : null;
      const operations = currentOperations();
      const op = operations.find(row=>row.id===alert.operationId);
      if (candidate && op && typeof opSwapVehicleAvailability==='function') {
        const check = opSwapVehicleAvailability(candidate.company,candidate.prefix,op.id);
        if (!check.ok) { showToast(`Não foi possível despachar o ônibus: ${check.reason}`); return; }
      }
      const oldVehicle = op ? {company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||'',chassis:op.chassis||''} : null;
      previousBreakdownSwap(alertId);
      const updated = op ? currentOperations().find(row=>row.id===op.id) : null;
      if (!updated?.replacementDispatch) return;
      const dispatch = updated.replacementDispatch;
      if (!dispatch.alertId) dispatch.alertId = alertId;
      if (oldVehicle) {
        dispatch.oldVehicle = {...(dispatch.oldVehicle||{}),...oldVehicle};
        dispatch.oldVehicleCompany = oldVehicle.company;
      }
      normalizeReplacementDispatch(updated,Date.now());
      writeArrayKey(OPERATION_KEY,currentOperations().map(row=>row.id===updated.id?updated:row));
      if (typeof renderOperations==='function') renderOperations();
      showToast(`Substituto ${dispatch.replacementPrefix} em deslocamento. Timer ativo: ${dispatch.durationMinutes} minutos (${dispatch.trafficLabel}). A linha só retoma após a chegada.`);
    };
  }

  // Turno é determinado pelo horário real da partida simulada. Não atribui,
  // silenciosamente, um motorista da manhã a uma viagem de outro turno.
  opDriverForTrip = function(op,tripIndex,startAbsOverride){
    const result = previousDriverForTrip(op,tripIndex,startAbsOverride);
    const assigned = String(op?.drivers?.[result.shift]||'').trim();
    return {...result,name:assigned || 'Motorista não definido'};
  };

  renderOperations = function(){
    previousRender();
    const list = document.querySelector('#operationList');
    if (!list) return;
    const rows = currentOperations();
    const cards = Array.from(list.querySelectorAll('.operation-card'));
    cards.forEach(card=>{
      const id = card.querySelector('[data-op-profit]')?.dataset.opProfit;
      const op = rows.find(row=>row.id===id);
      if (!op) return;
      const dispatch = op.replacementDispatch;
      if (dispatch) {
        const status = card.querySelector('.operation-status');
        if (status) { status.className='operation-status detour gc-replacement-status'; status.innerHTML='<i></i>SUBSTITUTO A CAMINHO'; }
        const heading = card.querySelector('.operation-live-heading strong');
        if (heading) heading.textContent='Ônibus reserva em deslocamento';
        const progress = card.querySelector('.operation-progress-track span');
        if (progress) progress.style.width='0%';
        const meta = card.querySelector('.operation-live-meta');
        if (meta) {
          const spans = meta.querySelectorAll('span');
          if (spans[0]) spans.innerHTML=`Substituto <b>${escapeHtml(dispatch.replacementPrefix)}</b> · ${escapeHtml(dispatch.replacementModel||'modelo não informado')}`;
          let counter = card.querySelector('[data-gc-replacement-countdown]');
          if (!counter) {
            const holder = spans[1] || document.createElement('span');
            if (!holder.parentNode) meta.appendChild(holder);
            counter = document.createElement('b');
            counter.dataset.gcReplacementCountdown = op.id;
            holder.textContent = 'Chegada em ';
            holder.appendChild(counter);
          }
          counter.dataset.gcReplacementCountdown = op.id;
          counter.textContent = formatRemaining(dispatch);
          if (spans[1]) spans[1].append(` · trânsito ${dispatch.trafficLabel||'moderado'}`);
        }
        let banner = card.querySelector('.gc-replacement-dispatch-banner');
        if (!banner) {
          banner = document.createElement('p');
          banner.className='gc-replacement-dispatch-banner';
          const top=card.querySelector('.operation-card-top');
          if (top) top.insertAdjacentElement('afterend',banner);
        }
        if (banner) {
          banner.innerHTML=`Ônibus anterior ${escapeHtml(dispatch.oldVehicle?.prefix||'—')} retirado de operação. Reserva <strong>${escapeHtml(dispatch.replacementPrefix)}</strong> a caminho · chegada em <b data-gc-replacement-countdown="${escapeHtml(op.id)}">${escapeHtml(formatRemaining(dispatch))}</b>. A operação será retomada quando o substituto chegar e for validado.`;
        }
        const toggle=card.querySelector('[data-op-toggle],[data-op-resume]');
        if (toggle) { toggle.disabled=true; toggle.textContent='Aguardando chegada do substituto'; }
      } else {
        // Caso a troca tenha terminado, remove qualquer contador/banner órfão.
        card.querySelectorAll('[data-gc-replacement-countdown],.gc-replacement-dispatch-banner').forEach(el=>{
          if (el.classList?.contains('gc-replacement-dispatch-banner')) el.remove();
          else el.removeAttribute('data-gc-replacement-countdown');
        });
      }
      if (op.gcIncidentActive && !op.gcIncidentActive.manualRelease) {
        let timer=card.querySelector('.operation-incident-timer');
        if (!timer) { timer=document.createElement('p');timer.className='operation-incident-timer';card.querySelector('.operation-live-stats')?.insertAdjacentElement('beforebegin',timer); }
        timer.dataset.gcIncidentCountdown=op.id;
        const left=toMs(op.gcIncidentActive.endsAtMs);
        timer.textContent=`${INCIDENT_LABELS[op.gcIncidentActive.type]||op.gcIncidentActive.type} · normalização: ${Number.isFinite(left)?opFormatCountdown(Math.max(0,(left-Date.now())/1000)):'aguardando atualização do prazo'}.`;
      }
    });
  };

  // Atualiza os contadores sem reconstruir todo o painel a cada segundo.
  setInterval(()=>{
    if(document.hidden)return;
    const nodes=document.querySelectorAll('[data-gc-replacement-countdown]');
    if(!nodes.length)return;
    const byId=new Map(currentOperations().map(row=>[row.id,row]));
    nodes.forEach(el=>{
      const op=byId.get(el.dataset.gcReplacementCountdown);
      if (op?.replacementDispatch) el.textContent=formatRemaining(op.replacementDispatch);
    });
  },1000);

  // Corrige o texto de referência do turno e expõe os limites para a auditoria.
  window.gcOperationShiftBoundaries = Object.freeze({morningStart:300,afternoonStart:720,nightStart:1080,nightEndsAt:300});
  console.info('[Grupo Conect] Endurecimento final do Visualizador carregado.');
})();


/* =====================================================================
   GRUPO CONECT — Recuperação de OS e retomada com veículo reserva
   Correções aditivas: associação por empresa/prefixo, liberação segura após
   aprovação da oficina e seletor de reserva acionado pelo botão Retomar.
   ===================================================================== */
(function gcWorkshopApprovalAndResumeReservePatch(){
  const normalizeText=value=>typeof norm==='function'?norm(value):String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const vehicleKeyOf=(company,prefix)=>typeof gcGarageKey==='function'?gcGarageKey({company,prefix}):`${normalizeText(company)}|${normalizeText(prefix)}`;
  const sameVehicle=(op,order)=>vehicleKeyOf(opVehicleCompany(op),op.prefix)===String(order.vehicleKey||vehicleKeyOf(order.company,order.prefix));
  const activeStatus=status=>!['Aprovada','Cancelada'].includes(String(status||''));

  // O aprovador original continua calculando peças, desgaste, histórico e Caixa.
  // Esta camada normaliza chaves legadas e reconcilia a OS com a operação vinculada.
  function companyRelated(a,b){
    const x=normalizeText(a),y=normalizeText(b);
    return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)));
  }
  function findFleetVehicleForOrder(order){
    const fleet=typeof gcGarageVehicles==='function'?gcGarageVehicles():[];
    const prefix=normalizeText(order?.prefix);
    if(!prefix)return null;
    const samePrefix=fleet.filter(v=>normalizeText(v.prefix)===prefix);
    let candidates=samePrefix.filter(v=>companyRelated(v.company,order.company));
    if(!candidates.length&&samePrefix.length===1)candidates=samePrefix;
    if(candidates.length>1&&order.model){
      const byModel=candidates.filter(v=>normalizeText(v.model)===normalizeText(order.model));
      if(byModel.length)candidates=byModel;
    }
    return candidates.length===1?candidates[0]:null;
  }
  function orderMatchesAlert(alert,order,key){
    if(!alert||!order)return false;
    if(String(order.breakdownId||'')&&alert.id===order.breakdownId)return true;
    if(key&&String(alert.vehicleKey||'')===key)return true;
    return normalizeText(alert.prefix)===normalizeText(order.prefix)&&companyRelated(alert.company,order.company);
  }
  function operationMatchesWorkshopOrder(op,order,alerts,vehicle){
    const linkedIds=new Set((alerts||[]).filter(a=>orderMatchesAlert(a,order,vehicle?gcGarageKey(vehicle):String(order.vehicleKey||''))).map(a=>a.id));
    const linkedOperationIds=new Set((alerts||[]).filter(a=>linkedIds.has(a.id)).flatMap(a=>[a.operationId,a.previousOperationId].filter(Boolean)));
    const samePrefix=normalizeText(op?.prefix)===normalizeText(order?.prefix);
    const sameCompany=companyRelated(opVehicleCompany(op),order?.company);
    const fleet=typeof gcGarageVehicles==='function'?gcGarageVehicles():[];
    const prefixUnique=fleet.filter(v=>normalizeText(v.prefix)===normalizeText(order?.prefix)).length===1;
    const currentVehicleMatches=samePrefix&&(sameCompany||prefixUnique);
    const last=op?.lastVehicleBeforeReplacement||{};
    const lastVehicleMatches=normalizeText(last.prefix)===normalizeText(order?.prefix)&&companyRelated(last.company,order?.company);
    return currentVehicleMatches||lastVehicleMatches||linkedOperationIds.has(op?.id)||linkedIds.has(op?.breakdownId)||op?.gcUserMaintenanceHoldOrderId===order?.id;
  }
  if(typeof gcGarageApproveOrder==='function'){
    const originalApprove=gcGarageApproveOrder;
    gcGarageApproveOrder=function(orderId){
      let beforeOrder=(typeof gcGarageOrders==='function'?gcGarageOrders():[]).find(x=>x.id===orderId);
      const beforeOps=typeof ownerOperations==='function'?ownerOperations().map(x=>({...x})):[];
      if(!beforeOrder||beforeOrder.status!=='Aguardando conferência')return;

      // Algumas versões antigas gravaram a chave da OS antes de normalizar o nome da empresa.
      // Canoniza pela frota real (prefixo + empresa/modelo) antes do aprovador consultar a ficha.
      const fleetVehicle=findFleetVehicleForOrder(beforeOrder);
      if(fleetVehicle){
        const canonicalKey=gcGarageKey(fleetVehicle),oldKey=String(beforeOrder.vehicleKey||'');
        const stateMap=typeof gcGarageState==='function'?gcGarageState():{};
        if(!stateMap[canonicalKey]){
          const legacyState=oldKey?stateMap[oldKey]:null;
          const currentState=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(fleetVehicle):null;
          const source=legacyState||currentState;
          if(source)stateMap[canonicalKey]={...source,key:canonicalKey,company:fleetVehicle.company,prefix:String(fleetVehicle.prefix),model:fleetVehicle.model,chassis:fleetVehicle.chassis||source.chassis||''};
        }
        beforeOrder.vehicleKey=canonicalKey;
        beforeOrder.company=fleetVehicle.company;
        beforeOrder.prefix=String(fleetVehicle.prefix);
        beforeOrder.model=fleetVehicle.model;
        const allOrders=typeof gcGarageOrders==='function'?gcGarageOrders():[];
        const target=allOrders.find(x=>x.id===orderId);
        if(target){target.vehicleKey=canonicalKey;target.company=fleetVehicle.company;target.prefix=String(fleetVehicle.prefix);target.model=fleetVehicle.model;gcGarageWrite(GC_GARAGE_ORDERS_KEY,allOrders);}
        if(stateMap[canonicalKey]&&typeof gcGarageWrite==='function')gcGarageWrite(GC_GARAGE_STATE_KEY,stateMap);
        const alertRows=typeof gcGarageAlerts==='function'?gcGarageAlerts():[];
        let normalizedAlerts=false;
        alertRows.forEach(a=>{
          if(normalizeText(a.prefix)===normalizeText(fleetVehicle.prefix)&&companyRelated(a.company,fleetVehicle.company)&&a.vehicleKey!==canonicalKey){a.vehicleKey=canonicalKey;normalizedAlerts=true;}
        });
        if(normalizedAlerts&&typeof gcGarageWrite==='function')gcGarageWrite(GC_GARAGE_ALERTS_KEY,alertRows);
      }

      originalApprove(orderId);
      const order=(typeof gcGarageOrders==='function'?gcGarageOrders():[]).find(x=>x.id===orderId);
      if(!order||order.status!=='Aprovada')return;
      const vehicle=findFleetVehicleForOrder(order)||null;
      const key=vehicle?gcGarageKey(vehicle):String(order.vehicleKey||vehicleKeyOf(order.company,order.prefix));
      const stateMap=typeof gcGarageState==='function'?gcGarageState():{};
      let vehicleState=stateMap[key]||(typeof gcGarageCurrentVehicle==='function'&&vehicle?gcGarageCurrentVehicle(vehicle):null);
      const def=typeof GC_GARAGE_SERVICES!=='undefined'?(GC_GARAGE_SERVICES[order.service]||GC_GARAGE_SERVICES['Inspeção geral']):{affects:[]};
      const covered=new Set([...(def.affects||[]),...(order.parts||[]).map(p=>p.key)]);
      let alerts=typeof gcGarageAlerts==='function'?gcGarageAlerts():[];
      let alertsChanged=false;
      const relatedAlerts=alerts.filter(a=>orderMatchesAlert(a,order,key));
      relatedAlerts.forEach(alert=>{
        if(alert.resolvedAt)return;
        const component=String(alert.componentKey||'');
        // Só baixa uma pane se o serviço/peça cobre o componente identificado e
        // a ficha mostra condição recuperada. Alertas antigos sem componente
        // podem ser encerrados após a conferência do proprietário.
        const healthOk=!component||(vehicleState&&typeof gcGarageComponentHealth==='function'&&gcGarageComponentHealth(vehicleState,component)>=40);
        const cleaningOnly=['Limpeza interna','Lavagem externa'].includes(String(order.service||''));
        const repaired=!cleaningOnly&&(!component||(covered.has(component)&&healthOk));
        if(repaired){alert.resolvedAt=order.approvedAt||new Date().toISOString();alert.resolution=`Reparo conferido pelo proprietário na OS ${order.number}`;alert.operationId='';alertsChanged=true;}
      });
      if(alertsChanged&&typeof gcGarageWrite==='function')gcGarageWrite(GC_GARAGE_ALERTS_KEY,alerts);
      const otherOrders=(typeof gcGarageOrders==='function'?gcGarageOrders():[]).filter(x=>x.id!==order.id&&normalizeText(x.prefix)===normalizeText(order.prefix)&&companyRelated(x.company,order.company)&&!['Aprovada','Cancelada'].includes(x.status));
      const activeAlerts=alerts.filter(a=>!a.resolvedAt&&orderMatchesAlert(a,order,key));
      if(vehicleState&&!otherOrders.length&&!activeAlerts.length){
        vehicleState.blocked=false;vehicleState.blockedReason='';
        stateMap[key]=vehicleState;
        if(typeof gcGarageWrite==='function')gcGarageWrite(GC_GARAGE_STATE_KEY,stateMap);
      }

      const rows=typeof ownerOperations==='function'?ownerOperations():[];
      let resumed=0,keptBlocked=0,blockedReason='';
      rows.forEach(op=>{
        if(!operationMatchesWorkshopOrder(op,order,alerts,vehicle))return;
        // Se a linha já usa um substituto, não se troca o veículo atual automaticamente
        // pelo que acabou de sair da oficina.
        if(op.replacementDispatch||op.pendingVehicleSwap){keptBlocked++;blockedReason='há uma substituição de veículo em andamento';return;}
        const prefixUnique=(typeof gcGarageVehicles==='function'?gcGarageVehicles():[]).filter(v=>normalizeText(v.prefix)===normalizeText(order.prefix)).length===1;
        const currentMatches=normalizeText(op.prefix)===normalizeText(order.prefix)&&(companyRelated(opVehicleCompany(op),order.company)||prefixUnique);
        if(!currentMatches)return;
        const wasHeldByThisOrder=op.gcUserMaintenanceHoldOrderId===order.id;
        const before=beforeOps.find(x=>x.id===op.id)||{};
        const previous=op.gcMaintenancePreviousStatus||before.gcMaintenancePreviousStatus||op.gcIncidentPreviousStatus||before.gcIncidentPreviousStatus||'';
        const manualPause=previous==='pausada'||(before.status==='pausada'&&!wasHeldByThisOrder&&!before.gcMaintenanceStoppedByOrder);
        if(otherOrders.length||activeAlerts.length||vehicleState?.blocked||op.gcInspectionPaused){
          keptBlocked++;blockedReason=activeAlerts[0]?.reason||otherOrders[0]?.number||vehicleState?.blockedReason||'fiscalização ou outra retenção ainda pendente';return;
        }
        delete op.gcUserMaintenanceHoldOrderId;delete op.gcMaintenancePreviousStatus;delete op.gcMaintenanceStoppedByOrder;
        // Corrige também cadastros antigos cuja empresa mudou de grafia.
        if(vehicle){op.vehicleCompany=vehicle.company;op.prefix=String(vehicle.prefix);op.busModel=vehicle.model;op.chassis=vehicle.chassis||op.chassis||'';}
        if(manualPause){op.status='pausada';op.clockAnchorAt=null;op.lastEvent=`OS ${order.number} aprovada; pausa manual preservada.`;return;}
        const eventText=String(op.lastEvent||before.lastEvent||'');
        const stopped=!operationIsRunning(op)||['parada técnica','fora de operação'].includes(String(op.status||''));
        const hasRepairLink=wasHeldByThisOrder||op.gcMaintenanceStoppedByOrder||before.gcMaintenanceStoppedByOrder||op.breakdownId||before.breakdownId||relatedAlerts.some(a=>a.id===before.breakdownId||a.id===op.breakdownId||a.operationId===op.id||a.previousOperationId===op.id)||/PANE MECÂNICA|falha mecânica|encaminhado à oficina|retido pela oficina|OS GC-/i.test(eventText)||Boolean(order.breakdownId);
        if(stopped&&hasRepairLink){
          op.breakdownId='';
          if(typeof window.gcAdminResumeOperation==='function'){
            const result=window.gcAdminResumeOperation(op,{source:'aprovação da OS',silent:true});
            if(result?.ok){resumed++;op.lastEvent=`Ônibus ${order.prefix} liberado após conferência da OS ${order.number} · ${order.service}. Operação retomada.`;}
            else{keptBlocked++;blockedReason=result?.message||'verificações de pré-partida ainda pendentes';}
          }else{op.status='operando';op.clockAnchorAt=Date.now();resumed++;}
        }
      });
      if(rows.length&&typeof writeArrayKey==='function')writeArrayKey(OPERATION_KEY,rows);
      if(typeof renderOperations==='function')renderOperations();
      if(typeof gcGarageRender==='function')gcGarageRender();
      if(typeof gcGarageRenderHomeAlert==='function')gcGarageRenderHomeAlert();
      if(resumed)showToast(`OS ${order.number} aprovada. ${resumed} operação(ões) do ${order.prefix} foram liberadas após a conferência.`);
      else if(keptBlocked&&blockedReason)showToast(`OS ${order.number} aprovada, mas a operação continua retida: ${blockedReason}.`);
      else showToast(`OS ${order.number} aprovada e ficha técnica atualizada. ${relatedAlerts.length?'Confira se não há outra pane vinculada ao ônibus.':'Não encontrei uma linha ativa atualmente vinculada a este veículo.'}`);
    };
  }

  function mechanicalResumeReason(op){
    if(!op)return '';
    if(op.replacementDispatch||op.pendingVehicleSwap)return '';
    // Uma ocorrência de via ainda ativa é um bloqueio da rota, não do veículo;
    // nesse caso, trocar o ônibus não pode liberar uma estrada interditada.
    if(op.gcIncidentActive?.effect==='stop'&&!op.gcIncidentActive.manualRelease&&Number(op.gcIncidentActive.endsAtMs)>Date.now())return '';
    const key=vehicleKeyOf(opVehicleCompany(op),op.prefix);
    const alerts=typeof gcGarageAlerts==='function'?gcGarageAlerts():[];
    const openAlert=alerts.find(a=>!a.resolvedAt&&(a.operationId===op.id||a.previousOperationId===op.id||a.vehicleKey===key));
    const orders=typeof gcGarageOrders==='function'?gcGarageOrders():[];
    const openOrder=orders.find(o=>String(o.vehicleKey||vehicleKeyOf(o.company,o.prefix))===key&&activeStatus(o.status));
    const state=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle({company:opVehicleCompany(op),prefix:op.prefix,model:op.busModel,chassis:op.chassis}):null;
    if(openAlert)return `pane mecânica: ${openAlert.reason||'ocorrência não resolvida'}`;
    if(openOrder)return `ônibus encaminhado à oficina pela OS ${openOrder.number||''} (${openOrder.status})`;
    if(state?.blocked)return `veículo retido: ${state.blockedReason||'restrição da oficina/fiscalização'}`;
    if(op.gcInspectionPaused)return 'veículo reprovado na fiscalização; é necessário substituí-lo até a liberação';
    if(op.gcUserMaintenanceHoldOrderId||op.gcMaintenanceStoppedByOrder)return 'ordem de serviço vinculada à operação';
    if(op.gcFuelPaused)return 'abastecimento do veículo original pendente';
    if(op.breakdownId)return 'marcador de pane mecânica ainda registrado';
    const status=String(op.status||'').toLowerCase();
    const event=String(op.lastEvent||'');
    // Qualquer linha efetivamente fora de operação/parada técnica pode pedir
    // substituto na retomada, mesmo que um registro antigo tenha perdido o ID da pane.
    // Pausa manual simples continua no fluxo normal e não força troca de veículo.
    if(['fora de operação','parada técnica'].includes(status))return `operação interrompida${event?`: ${event.slice(0,180)}`:''}; selecione um ônibus livre e compatível para retomar`;
    if(/pane|falha|avaria|mecânic|oficina|retid|defeito|quebra/i.test(event)&&status==='pausada')return `veículo indisponível: ${event.slice(0,180)}`;
    return '';
  }

  let resumeOverlay=null;
  function ensureResumeModalStyles(){
    if(document.getElementById('gc-resume-reserve-styles'))return;
    const style=document.createElement('style');style.id='gc-resume-reserve-styles';style.textContent=`
      .gc-resume-reserve-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,20,.76);backdrop-filter:blur(5px)}
      .gc-resume-reserve-card{width:min(100%,560px);max-height:90vh;overflow:auto;border:1px solid rgba(170,145,255,.32);border-radius:20px;padding:22px;background:linear-gradient(145deg,#17162d,#101827);color:#f5f3ff;box-shadow:0 24px 80px rgba(0,0,0,.48)}
      .gc-resume-reserve-card h3{margin:0 0 8px;font-size:1.2rem}.gc-resume-reserve-card p{color:#c7c2dc;line-height:1.5}.gc-resume-reserve-card label{display:block;margin:14px 0 6px;font-weight:700}.gc-resume-reserve-card select{width:100%;min-height:46px;border-radius:10px;padding:10px;background:#0d1424;color:#fff;border:1px solid #61558b}.gc-resume-reserve-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.gc-resume-reserve-actions button{flex:1;min-width:140px}.gc-resume-reserve-note{padding:10px 12px;border-radius:10px;background:rgba(126,91,220,.13);border:1px solid rgba(170,145,255,.2);font-size:.9rem}
      @media(max-width:480px){.gc-resume-reserve-card{padding:18px;border-radius:16px}.gc-resume-reserve-actions{flex-direction:column}.gc-resume-reserve-actions button{width:100%}}
    `;document.head.appendChild(style);
  }
  function getResumeReserveCandidates(op){
    return typeof window.gcGetOwnerReserveCandidates==='function'
      ? window.gcGetOwnerReserveCandidates(op)
      : [];
  }
  function closeResumeReserveModal(){if(resumeOverlay){resumeOverlay.remove();resumeOverlay=null;}}
  function startResumeReserveDispatch(opId,key){
    return typeof window.gcDispatchOwnerReserve==='function'
      ? window.gcDispatchOwnerReserve(opId,key,{source:'retomar-operacao'})
      : (showToast('O módulo de despacho de reserva não foi inicializado. Recarregue a página e tente novamente.'),false);
  }
  function openResumeReserveModal(op,reason){
    if(!assertOwner())return;
    const candidates=getResumeReserveCandidates(op);
    if(!candidates.length){showToast(`Não encontrei ônibus livre e compatível para substituir o prefixo ${op.prefix}. ${reason} Abra a Garagem para conferir a frota.`);if(typeof gcGarageOpen==='function'){gcGarageOpen();gcGarageSetTab('fleet');}return;}
    ensureResumeModalStyles();closeResumeReserveModal();
    const overlay=document.createElement('div');overlay.className='gc-resume-reserve-overlay';overlay.id='gcResumeReserveModal';
    const companies=[...new Set(candidates.map(x=>x.vehicle.company))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    overlay.innerHTML=`<section class="gc-resume-reserve-card" role="dialog" aria-modal="true" aria-labelledby="gcResumeReserveTitle"><h3 id="gcResumeReserveTitle">Retomar operação com veículo reserva</h3><p>A linha <b>${escapeHtml(op.line||'sem identificação')}</b> está parada por: ${escapeHtml(reason)}.</p><p>Selecione uma unidade livre. O ônibus seguirá até o terminal da linha e a operação será liberada após a chegada, com contagem regressiva persistente.</p><label for="gcResumeReserveCompany">Empresa</label><select id="gcResumeReserveCompany">${companies.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select><label for="gcResumeReserveVehicle">Ônibus disponível</label><select id="gcResumeReserveVehicle"></select><p class="gc-resume-reserve-note" id="gcResumeReserveInfo"></p><div class="gc-resume-reserve-actions"><button type="button" class="primary-button" id="gcResumeReserveSend">Enviar ônibus reserva</button><button type="button" class="secondary-action-button" id="gcResumeReserveCancel">Cancelar</button></div></section>`;
    document.body.appendChild(overlay);resumeOverlay=overlay;
    const companySelect=overlay.querySelector('#gcResumeReserveCompany'),busSelect=overlay.querySelector('#gcResumeReserveVehicle'),info=overlay.querySelector('#gcResumeReserveInfo');
    function fillBuses(){const current=candidates.filter(x=>x.vehicle.company===companySelect.value);busSelect.innerHTML=current.map(x=>`<option value="${escapeHtml(encodeURIComponent(x.key))}">${escapeHtml(x.vehicle.prefix)} · ${escapeHtml(x.vehicle.model)} · condição ${x.condition}%</option>`).join('');if(!current.length)busSelect.innerHTML='<option value="">Nenhum ônibus disponível nesta empresa</option>';const chosen=current[0];info.textContent=chosen?`Condição estimada ${chosen.condition}% · ${chosen.sameCompany?'mesma empresa da linha':'empresa parceira'} · sem vínculo operacional ou OS pendente.`:'Nenhum veículo livre nesta empresa. Selecione outra empresa.';}
    companySelect.addEventListener('change',fillBuses);fillBuses();
    overlay.querySelector('#gcResumeReserveCancel').addEventListener('click',closeResumeReserveModal);
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeResumeReserveModal();});
    overlay.querySelector('#gcResumeReserveSend').addEventListener('click',()=>{let selected='';try{selected=decodeURIComponent(busSelect.value||'');}catch(_){}if(!selected){info.textContent='Selecione uma unidade disponível.';return;}if(startResumeReserveDispatch(op.id,selected))closeResumeReserveModal();});
    overlay.querySelector('.gc-resume-reserve-card').addEventListener('keydown',e=>{if(e.key==='Escape')closeResumeReserveModal();});
  }

  // Intercepta apenas a retomada de linhas retidas por pane/OS/abastecimento.
  // Pausas manuais e ocorrências não mecânicas continuam usando o fluxo original.
  const operationList=document.querySelector('#operationList');
  operationList?.addEventListener('click',event=>{
    const button=event.target.closest('[data-op-toggle],[data-op-resume]');if(!button)return;
    const id=button.dataset.opToggle||button.dataset.opResume,op=(typeof ownerOperations==='function'?ownerOperations():[]).find(x=>x.id===id);if(!op||operationIsRunning(op))return;
    const reason=mechanicalResumeReason(op);if(!reason)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    openResumeReserveModal(op,reason);
  },true);
})();


/* =====================================================================
   GRUPO CONECT — Controle efetivo de substituição e relógio civil
   Corrige: troca bloqueada quando o veículo antigo está em OS, despacho
   sem timer, liberação após chegada e atribuição de turno pela hora real.
   Os bloqueios e históricos da oficina do veículo antigo são preservados.
   ===================================================================== */
(function installOwnerDirectedVehicleRecovery(){
  if (window.__gcOwnerDirectedVehicleRecovery) return;
  window.__gcOwnerDirectedVehicleRecovery = true;

  const normKey = value => String(value ?? '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const vehicleKey = (company,prefix) => typeof gcGarageKey==='function'
    ? gcGarageKey({company,prefix}) : `${normKey(company)}|${String(prefix||'').trim()}`;
  const activeOrderStatus = status => !['aprovada','cancelada'].includes(normKey(status));
  const realParts = (date=new Date()) => {
    const parts = new Intl.DateTimeFormat('pt-BR',{
      timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    }).formatToParts(date);
    const read = type => Number(parts.find(x=>x.type===type)?.value||0);
    return {hour:read('hour'),minute:read('minute'),second:read('second'),minuteOfDay:read('hour')*60+read('minute')};
  };
  const realShift = (now=new Date()) => {
    const p=realParts(now),m=p.minuteOfDay;
    return m>=300&&m<720?'morning':m>=720&&m<1080?'afternoon':'night';
  };
  const realShiftLabel = key => key==='morning'?'manhã':key==='afternoon'?'tarde':'noite';
  const realClockText = (op,now=new Date()) => {
    const p=realParts(now),shift=realShift(now),driver=String(op?.drivers?.[shift]||'Motorista não definido').trim()||'Motorista não definido';
    return `Hora real de Brasília ${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')} · turno ${realShiftLabel(shift)} · motorista: ${driver}`;
  };

  function getCurrentOperationRows(){return typeof ownerOperations==='function'?ownerOperations():[];}
  function getCurrentAlerts(){return typeof gcGarageAlerts==='function'?gcGarageAlerts():[];}
  function getCurrentOrders(){return typeof gcGarageOrders==='function'?gcGarageOrders():[];}
  function getFleet(){return typeof gcGarageVehicles==='function'?gcGarageVehicles():[];}
  function isVehicleAssignedElsewhere(company,prefix,opId){
    const key=vehicleKey(company,prefix);
    return getCurrentOperationRows().some(row=>{
      if(row.id===opId)return false;
      const current=vehicleKey(opVehicleCompany(row),row.prefix);
      if(current===key)return true;
      const pending=row.pendingVehicleSwap;
      if(pending&&vehicleKey(pending.replacementCompany,pending.replacementPrefix)===key)return true;
      const dispatch=row.replacementDispatch;
      if(dispatch&&vehicleKey(dispatch.replacementCompany||opVehicleCompany(row),dispatch.replacementPrefix)===key)return true;
      return false;
    });
  }
  function candidateStatus(vehicle,op){
    const key=vehicleKey(vehicle.company,vehicle.prefix);
    const currentKey=vehicleKey(opVehicleCompany(op),op.prefix);
    if(key===currentKey)return {ok:false,reason:'Este é o próprio ônibus que está sendo retirado da linha.'};
    if(isVehicleAssignedElsewhere(vehicle.company,vehicle.prefix,op.id))return {ok:false,reason:'Já está vinculado ou reservado em outra linha.'};
    const state=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(vehicle):null;
    if(!state)return {ok:false,reason:'Ficha mecânica não encontrada.'};
    if(state.blocked)return {ok:false,reason:state.blockedReason||'Retido pela oficina/fiscalização.'};
    if(getCurrentAlerts().some(a=>!a.resolvedAt&&a.vehicleKey===key))return {ok:false,reason:'Possui pane mecânica aberta.'};
    if(getCurrentOrders().some(o=>vehicleKey(o.company,o.prefix)===key&&activeOrderStatus(o.status)))return {ok:false,reason:'Possui ordem de serviço em andamento.'};
    const condition=typeof gcGarageCondition==='function'?Number(gcGarageCondition(state)):100;
    return {ok:true,vehicle,state,key,condition:Number.isFinite(condition)?condition:100};
  }
  function getReserveCandidates(op){
    const list=[];
    getFleet().forEach(vehicle=>{
      const status=candidateStatus(vehicle,op);
      if(status.ok)list.push({...status,sameCompany:normKey(vehicle.company)===normKey(opVehicleCompany(op))});
    });
    const base={model:op?.busModel||''};
    const family=typeof gcPartsVehicleFamily==='function'?gcPartsVehicleFamily(base):'';
    list.forEach(row=>{
      row.sameFamily=!family||typeof gcPartsVehicleFamily!=='function'||gcPartsVehicleFamily(row.vehicle)===family;
    });
    // Compatibilidade e empresa são critérios de preferência, não filtros absolutos:
    // o proprietário pode escolher outra unidade livre depois de ver o aviso.
    list.sort((a,b)=>(Number(b.sameFamily)-Number(a.sameFamily))||
      (Number(b.sameCompany)-Number(a.sameCompany))||b.condition-a.condition);
    return list;
  }
  window.gcGetOwnerReserveCandidates=getReserveCandidates;
  window.gcGetRealOperationClock=()=>{
    const now=new Date(),p=realParts(now),shift=realShift(now);
    return {time:`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`,shift,shiftLabel:realShiftLabel(shift),timeZone:'America/Sao_Paulo'};
  };

  // O ônibus antigo pode continuar na oficina: OS, alertas e estado mecânico
  // permanecem vinculados à chave antiga. Só se desassocia a operação da pane.
  window.gcDispatchOwnerReserve=function(opId,key,options={}){
    if(typeof assertOwner==='function'&&!assertOwner())return false;
    const rows=getCurrentOperationRows(),op=rows.find(x=>String(x.id)===String(opId));
    if(!op){showToast('A linha não foi localizada. Atualize o Visualizador e tente novamente.');return false;}
    if(op.replacementDispatch||op.pendingVehicleSwap){showToast('Já existe um ônibus reserva em deslocamento ou uma troca no terminal. Aguarde o timer atual.');return false;}
    if(op.gcIncidentActive?.effect==='stop'&&op.gcIncidentActive.type!=='mecanica'&&Number(op.gcIncidentActive.endsAtMs)>Date.now()){
      showToast('A via ainda está bloqueada por uma ocorrência de segurança. A troca de ônibus não libera uma estrada interditada ou trecho perigoso.');return false;
    }
    const candidate=getFleet().find(v=>vehicleKey(v.company,v.prefix)===String(key));
    if(!candidate){showToast('O ônibus selecionado não foi encontrado na frota. Atualize a Garagem.');return false;}
    const availability=candidateStatus(candidate,op);
    if(!availability.ok){showToast(`Não foi possível enviar o reserva: ${availability.reason}`);return false;}

    const now=Date.now(),traffic=typeof opSwapTrafficEstimate==='function'?opSwapTrafficEstimate():{label:'Moderado',minutes:25};
    const old={company:opVehicleCompany(op),prefix:String(op.prefix||''),model:op.busModel||'',chassis:op.chassis||'',holdFlags:{
      gcInspectionPaused:op.gcInspectionPaused===true,gcInspectionPreviousStatus:op.gcInspectionPreviousStatus||'',
      gcUserMaintenanceHoldOrderId:op.gcUserMaintenanceHoldOrderId||'',gcMaintenancePreviousStatus:op.gcMaintenancePreviousStatus||'',
      gcMaintenanceStoppedByOrder:op.gcMaintenanceStoppedByOrder===true,gcFuelPaused:op.gcFuelPaused===true,
      gcFuelPreviousStatus:op.gcFuelPreviousStatus||''
    }};
    const oldKey=vehicleKey(old.company,old.prefix),alertRows=getCurrentAlerts(),originalAlerts=JSON.stringify(alertRows);
    const linked=alertRows.filter(a=>!a.resolvedAt&&(a.operationId===op.id||a.previousOperationId===op.id||a.vehicleKey===oldKey));
    linked.forEach(a=>{
      a.previousOperationId=a.previousOperationId||op.id;
      a.operationId='';
      a.detachedAt=new Date(now).toISOString();
      a.resolutionNote=`Veículo ${old.prefix} retirado da linha ${op.line} por substituição autorizada. A pane continua aberta e a OS continua vinculada ao veículo antigo.`;
    });
    if(linked.length&&typeof gcGarageWrite==='function'&&!gcGarageWrite(GC_GARAGE_ALERTS_KEY,alertRows)){
      showToast('Não foi possível atualizar o vínculo do alerta. O despacho não foi realizado.');return false;
    }
    const preTripEventId=typeof gcGaragePreTripEvent==='function'
      ?gcGaragePreTripEvent(candidate,op.line,'substituição autorizada',`${op.id}-owner-reserve-${now}`):'';
    op.lastVehicleBeforeReplacement=old;
    op.vehicleCompany=candidate.company;op.prefix=String(candidate.prefix);op.busModel=candidate.model;op.chassis=candidate.chassis||'';
    op.replacementDispatch={
      id:`owner-reserve-${op.id}-${now}`,source:options.source||'troca-autorizada',startedAt:new Date(now).toISOString(),startedAtMs:now,
      arrivesAt:new Date(now+traffic.minutes*60000).toISOString(),arrivesAtMs:now+traffic.minutes*60000,
      durationMinutes:traffic.minutes,trafficLabel:traffic.label,oldVehicle:old,oldVehicleCompany:old.company,
      replacementCompany:candidate.company,replacementPrefix:String(candidate.prefix),replacementModel:candidate.model,
      preTripEventId,alertId:linked[0]?.id||'',ownerAuthorized:true
    };
    op.breakdownId='';
    // A retenção mecânica/fiscal do veículo que saiu da linha não pode continuar
    // bloqueando o reserva. O bloqueio real continua na ficha e na OS do veículo antigo.
    delete op.gcInspectionPaused;delete op.gcInspectionPreviousStatus;
    delete op.gcUserMaintenanceHoldOrderId;delete op.gcMaintenancePreviousStatus;delete op.gcMaintenanceStoppedByOrder;
    delete op.gcFuelPaused;delete op.gcFuelPreviousStatus;
    op.gcFuelPreparedTrip=0;
    if(op.gcIncidentActive?.type==='mecanica'||op.gcIncidentActive?.manualRelease){op.gcIncidentActive=null;delete op.gcIncidentPreviousStatus;}
    op.status='substituição em deslocamento';op.clockAnchorAt=null;
    op.lastEvent=`Substituição autorizada por Pablo: ônibus ${candidate.prefix} em deslocamento · trânsito ${traffic.label.toLowerCase()} · chegada em ${traffic.minutes} minutos. OS e pane do veículo ${old.prefix} permanecem na oficina.`;
    if(!writeArrayKey(OPERATION_KEY,rows)){
      if(linked.length&&typeof gcGarageWrite==='function')gcGarageWrite(GC_GARAGE_ALERTS_KEY,JSON.parse(originalAlerts));
      showToast('Falha ao salvar a operação. O alerta anterior foi restaurado e nenhum despacho foi confirmado.');return false;
    }
    if(typeof renderOperations==='function')renderOperations();
    if(typeof gcGarageRenderAlerts==='function')gcGarageRenderAlerts();
    if(typeof gcGarageRenderHomeAlert==='function')gcGarageRenderHomeAlert();
    showToast(`Substituto ${candidate.prefix} enviado. Timer de ${traffic.minutes} minutos (${traffic.label}). A operação será retomada quando o veículo chegar; o ônibus ${old.prefix} continua vinculado à manutenção.`);
    return true;
  };

  // Compatibilidade com a consulta antiga do Visualizador; não aplica um limite
  // arbitrário de 45% ao veículo de reserva. Bloqueios reais e OS ativa continuam.
  opSwapVehicleAvailability=function(company,prefix,operationId=''){
    const vehicle=getFleet().find(v=>normKey(v.company)===normKey(company)&&String(v.prefix)===String(prefix));
    if(!vehicle)return {ok:false,reason:'Ônibus não encontrado na frota.'};
    const key=vehicleKey(company,prefix);
    if(isVehicleAssignedElsewhere(company,prefix,operationId))return {ok:false,reason:'Ônibus já está escalado ou reservado em outra linha.'};
    const state=typeof gcGarageCurrentVehicle==='function'?gcGarageCurrentVehicle(vehicle):null;
    if(!state)return {ok:false,reason:'Ficha mecânica indisponível.'};
    if(state.blocked)return {ok:false,reason:`Ônibus retido: ${state.blockedReason||'restrição mecânica/fiscal'}.`};
    if(getCurrentAlerts().some(a=>!a.resolvedAt&&a.vehicleKey===key))return {ok:false,reason:'Ônibus possui pane mecânica aberta.'};
    if(getCurrentOrders().some(o=>vehicleKey(o.company,o.prefix)===key&&activeOrderStatus(o.status)))return {ok:false,reason:'Ônibus possui ordem de serviço ativa.'};
    return {ok:true,vehicle,state,key,condition:typeof gcGarageCondition==='function'?gcGarageCondition(state):100};
  };

  // Abre o seletor mesmo quando o ônibus que está saindo tem OS, alerta ou
  // retenção. Isso é exatamente o cenário de veículo parado aguardando conserto.
  const previousOpenSwap=opSwapOpenPanel;
  opSwapOpenPanel=function(op){
    if(!assertOwner())return;
    if(!op){showToast('Selecione uma linha válida.');return;}

    // Primeiro reconcilia timers antigos. Um timer vencido não pode deixar a
    // linha eternamente bloqueada só porque a tela não foi atualizada.
    if(op.replacementDispatch){
      const arrival=Number(op.replacementDispatch.arrivesAtMs||Date.parse(op.replacementDispatch.arrivesAt||''));
      if(Number.isFinite(arrival)&&arrival<=Date.now()&&typeof syncOperationRows==='function'){
        syncOperationRows(Date.now());
        op=getCurrentOperationRows().find(x=>String(x.id)===String(op.id))||op;
      }
      if(op.replacementDispatch){
        const left=Math.max(0,Math.ceil((Number(op.replacementDispatch.arrivesAtMs||arrival)-Date.now())/1000));
        if(typeof renderOperations==='function')renderOperations();
        showToast(`O substituto ${op.replacementDispatch.replacementPrefix||''} já está em deslocamento. Chegada estimada em ${typeof opFormatCountdown==='function'?opFormatCountdown(left):Math.ceil(left/60)+' min'}. Acompanhe o cronômetro no cartão da linha.`);
        return;
      }
    }

    const status=String(op.status||'').toLowerCase();
    const technicalStop=['parada técnica','fora de operação'].includes(status);
    // Uma troca antiga ao próximo terminal fica sem condição de concluir se a
    // linha acabou retida na oficina. Nesse caso, a nova ordem de Pablo substitui
    // o pedido antigo por despacho direto com timer; a reserva anterior é liberada.
    if(op.pendingVehicleSwap&&technicalStop&&!op.pendingVehicleSwap.busAtTerminal){
      const stale={...op.pendingVehicleSwap,cancelledAt:new Date().toISOString(),cancelReason:'Substituído por nova ordem direta do proprietário enquanto a linha estava parada tecnicamente.'};
      op.lastVehicleSwapFailure=stale;op.pendingVehicleSwap=null;
      op.lastEvent='Troca anterior ao terminal cancelada por decisão do proprietário; aguardando seleção de novo ônibus reserva.';
      writeArrayKey(OPERATION_KEY,getCurrentOperationRows().map(row=>row.id===op.id?op:row));
    }else if(op.pendingVehicleSwap){
      showToast(`Já existe uma troca programada para o ônibus ${op.pendingVehicleSwap.replacementPrefix||''}. O pedido será concluído no terminal de encontro; acompanhe o cronômetro no cartão.`);
      if(typeof renderOperations==='function')renderOperations();
      return;
    }

    const oldKey=vehicleKey(opVehicleCompany(op),op.prefix);
    const oldOrder=getCurrentOrders().find(o=>vehicleKey(o.company,o.prefix)===oldKey&&activeOrderStatus(o.status));
    const oldAlert=getCurrentAlerts().find(a=>!a.resolvedAt&&(a.operationId===op.id||a.vehicleKey===oldKey||a.previousOperationId===op.id));
    const vehicleHold=Boolean(oldOrder||oldAlert||op.gcUserMaintenanceHoldOrderId||op.gcMaintenanceStoppedByOrder||op.gcInspectionPaused||op.gcFuelPaused||op.breakdownId);
    const stopped=technicalStop||vehicleHold;
    // Pausa manual simples continua com a troca comum no próximo terminal.
    if(!stopped)return previousOpenSwap(op);
    if(op.gcIncidentActive?.effect==='stop'&&op.gcIncidentActive.type!=='mecanica'&&Number(op.gcIncidentActive.endsAtMs)>Date.now()){
      showToast('A via permanece bloqueada por uma ocorrência de segurança. Resolva a interdição antes de trocar o veículo.');return;
    }
    window.__gcOwnerForceSwapOperationId=op.id;
    currentVehicleSwapOperationId=op.id;
    $('#ovVehicleSwapTitle').textContent=`Retomar linha com substituto · ${op.company} / ${op.line}`;
    $('#ovVehicleSwapQuestion').textContent=`O ônibus ${opVehicleCompany(op)} · ${op.prefix} está parado${oldOrder?` pela OS ${oldOrder.number} (${oldOrder.status})`:oldAlert?' por pane mecânica':op.gcFuelPaused?' por falta de combustível/ARLA':op.gcInspectionPaused?' por retenção de fiscalização':''}. Escolha um ônibus livre. O veículo antigo continuará vinculado à oficina/pendência; o substituto receberá um timer real de chegada e assumirá a linha ao chegar.`;
    opSwapPopulateCompanies(op);
    $('#ovVehicleSwapPanel').hidden=false;
    $('#ovVehicleSwapPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
  };

  // Para paradas técnicas, a troca utiliza despacho direto com timer. Para linhas
  // que ainda estão rodando, permanece o mecanismo de encontro no próximo terminal.
  const confirmSwap=$('#ovConfirmVehicleSwap');
  confirmSwap?.addEventListener('click',event=>{
    const opId=window.__gcOwnerForceSwapOperationId;
    if(!opId||opId!==currentVehicleSwapOperationId)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const op=getCurrentOperationRows().find(x=>x.id===opId);
    if(!op){showToast('A linha não foi localizada; atualize o Visualizador.');return;}
    const raw=$('#ovSwapVehicle').value;
    if(!raw){showToast('Selecione um ônibus substituto.');return;}
    let selection;try{selection=JSON.parse(decodeURIComponent(raw));}catch(_){showToast('Seleção inválida. Escolha o ônibus novamente.');return;}
    const key=vehicleKey(selection.company,selection.prefix);
    if(window.gcDispatchOwnerReserve(opId,key,{source:'troca-do-visualizador'})){
      $('#ovVehicleSwapPanel').hidden=true;currentVehicleSwapOperationId=null;window.__gcOwnerForceSwapOperationId='';
    }
  },true);
  $('#ovCancelVehicleSwapPanel')?.addEventListener('click',()=>{window.__gcOwnerForceSwapOperationId='';},true);

  // O botão antigo da tela de alertas também usa o mesmo despachante com timer,
  // sem encerrar a pane nem a ordem de serviço do veículo que saiu da linha.
  gcGarageHandleBreakdownSwap=function(alertId){
    if(!assertOwner())return;
    const alert=getCurrentAlerts().find(x=>x.id===alertId&&!x.resolvedAt);
    const select=document.querySelector(`[data-gc-breakdown-select="${CSS.escape(String(alertId))}"]`);
    let key='';try{key=select?.value?decodeURIComponent(select.value):'';}catch(_){}
    if(!alert){showToast('A ocorrência já foi resolvida.');return;}
    const op=getCurrentOperationRows().find(x=>x.id===alert.operationId||x.id===alert.previousOperationId);
    if(!op){showToast('A ocorrência não está vinculada a uma linha ativa. A pane permanece registrada na Garagem.');return;}
    if(!key){showToast('Escolha um ônibus substituto livre.');return;}
    window.gcDispatchOwnerReserve(op.id,key,{source:'alerta-mecanico',alertId});
  };

  // Turno e motorista passam a depender da hora civil de Brasília, não do relógio
  // acelerado da simulação. A grade virtual continua controlando duração e lucro.
  const previousDriverForTrip=opDriverForTrip;
  opDriverForTrip=function(op,tripIndex,startAbsOverride){
    const scheduled=previousDriverForTrip(op,tripIndex,startAbsOverride);
    const shift=realShift(new Date());
    const name=String(op?.drivers?.[shift]||'Motorista não definido').trim()||'Motorista não definido';
    return {...scheduled,name,shift,realShift:true,realClock:window.gcGetRealOperationClock().time};
  };
  if(typeof gcDriverForOperationStart==='function'){
    gcDriverForOperationStart=function(op){const shift=realShift(new Date());return String(op?.drivers?.[shift]||'').trim();};
  }

  const previousRender=renderOperations;
  function addRealClockToOperationCards(){
    const cards=Array.from(document.querySelectorAll('#operationList .operation-card'));
    const rows=getCurrentOperationRows().slice().reverse();
    cards.forEach((card,index)=>{
      const op=rows[index];if(!op)return;
      let node=card.querySelector('[data-gc-real-operation-clock]');
      if(!node){node=document.createElement('small');node.className='gc-real-operation-clock';node.dataset.gcRealOperationClock=op.id;const title=card.querySelector('.operation-card-top > div');if(title)title.appendChild(node);}
      node.dataset.gcRealOperationClock=op.id;
      node.textContent=realClockText(op);
    });
  }
  renderOperations=function(){
    previousRender();
    addRealClockToOperationCards();
  };
  if(!document.getElementById('gc-real-operation-clock-style')){
    const style=document.createElement('style');style.id='gc-real-operation-clock-style';
    style.textContent='.gc-real-operation-clock{display:block!important;margin-top:6px;color:#c7b9ff!important;font-weight:700;font-size:.83rem;line-height:1.4}.gc-real-operation-clock::before{content:"◷ ";color:#a78bfa}';
    document.head.appendChild(style);
  }
  setInterval(()=>{
    if(document.hidden)return;
    const nodes=document.querySelectorAll('[data-gc-real-operation-clock]');
    if(!nodes.length)return;
    const byId=new Map(getCurrentOperationRows().map(op=>[String(op.id),op]));
    nodes.forEach(node=>{
      const op=byId.get(String(node.dataset.gcRealOperationClock));
      if(op)node.textContent=realClockText(op);
    });
  },1000);

  // Corrige as opções do seletor comum: lista apenas veículos realmente livres,
  // mas não esconde reserva apenas por uma condição estimada abaixo de 45%.
  opSwapPopulateVehicles=function(op){
    const company=$('#ovSwapCompany')?.value,select=$('#ovSwapVehicle'),preview=$('#ovSwapPreview');
    if(!select||!preview)return;
    if(!company){select.innerHTML='<option value="">Selecione primeiro a empresa</option>';preview.textContent='Selecione a empresa proprietária para consultar os ônibus disponíveis.';return;}
    const candidates=getReserveCandidates(op).filter(x=>normKey(x.vehicle.company)===normKey(company));
    select.innerHTML='<option value="">Selecione o ônibus substituto</option>'+candidates.map(x=>{
      const compat=x.sameFamily?'':' · categoria diferente — confira capacidade';
      const condition=x.condition<45?` · condição baixa ${Math.round(x.condition)}%`:` · condição ${Math.round(x.condition)}%`;
      const value=encodeURIComponent(JSON.stringify({company:x.vehicle.company,prefix:String(x.vehicle.prefix)}));
      return `<option value="${escapeHtml(value)}">${escapeHtml(x.vehicle.prefix)} · ${escapeHtml(x.vehicle.model||'modelo não informado')}${escapeHtml(condition+compat)}</option>`;
    }).join('');
    preview.textContent=candidates.length?`${candidates.length} ônibus livre(s). O sistema prioriza mesma categoria/empresa e melhor condição. A OS do veículo antigo não será encerrada; ele continuará na oficina.`:'Nenhum ônibus livre nesta empresa. Verifique se os veículos estão em outra linha, na oficina ou com pane aberta.';
  };

  console.info('[Grupo Conect] Recuperação por substituição e relógio real de Brasília ativados.');
})();


/* GRUPO CONECT — recuperação de despacho pendente legado
   Não apaga a OS do ônibus avariado. Apenas permite substituir um pedido de
   troca ao terminal que ficou incompatível com uma parada técnica posterior. */
(function gcOwnerDispatchRecoveryGuard(){
  // O loop de sincronização existente já processa os timers a cada segundo.
  // Esta proteção extra só força uma reconciliação ao voltar para a página,
  // evitando duplicar timers e trabalho de CPU em celulares.
  function reconcileArrivals(){
    try{
      if(document.hidden)return;
      const rows=ownerOperations();
      const due=rows.some(op=>op.replacementDispatch&&Number(op.replacementDispatch.arrivesAtMs||Date.parse(op.replacementDispatch.arrivesAt||''))<=Date.now());
      if(due&&typeof syncOperationRows==='function'){
        syncOperationRows(Date.now());
        if(typeof renderOperations==='function')renderOperations();
      }
    }catch(error){console.warn('[Grupo Conect] Reconciliação de chegada:',error);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reconcileArrivals();});
  window.addEventListener('focus',reconcileArrivals);
})();


/* MERCADO DE ÔNIBUS USADOS — módulo aditivo integrado à Frota, Garagem e Banco.
   Ofertas locais são dados de simulação; compras criam um único veículo e uma OS de inspeção. */
(function installUsedBusMarket(){
 const $id=id=>document.getElementById(id),STORE_KEY='grupoConect.usedBusMarket.v1';
 const listings=[
  {id:'used-caio-apache-2018',make:'Caio',model:'Apache Vip IV',chassis:'Mercedes-Benz OF-1721 Euro V',year:2018,km:482000,segment:'urbano',seats:40,standing:30,tank:300,engine:'OM 924 LA',fuel:'Diesel S10',condition:68,price:248000,prep:18500,city:'São Paulo/SP',notes:'Ar-condicionado, elevador, câmbio manual; desgaste moderado de salão e suspensão.'},
  {id:'used-torino-2015',make:'Marcopolo',model:'Torino 2014',chassis:'Volkswagen 17.230 OD',year:2015,km:635000,segment:'urbano',seats:39,standing:31,tank:300,engine:'MAN D08',fuel:'Diesel S10',condition:57,price:179000,prep:29500,city:'Belo Horizonte/MG',notes:'Pintura usada, pneus no meio da vida útil; exige revisão de freios e elétrica.'},
  {id:'used-paradiso-2017',make:'Marcopolo',model:'Paradiso 1200 G7',chassis:'Volvo B420R 6x2',year:2017,km:718000,segment:'rodoviario',seats:46,standing:0,tank:600,engine:'Volvo D13',fuel:'Diesel S10',condition:73,price:648000,prep:34000,city:'Curitiba/PR',notes:'Poltronas executivas, banheiro, ar-condicionado e bagageiro; revisão preventiva recomendada.'},
  {id:'used-mascarello-roma-2019',make:'Mascarello',model:'Roma R6',chassis:'Mercedes-Benz OF-1721',year:2019,km:392000,segment:'urbano',seats:39,standing:31,tank:300,engine:'OM 924 LA',fuel:'Diesel S10',condition:81,price:286000,prep:9500,city:'Campinas/SP',notes:'Conservação acima da média, acessibilidade e histórico de oficina declarado pelo anúncio fictício.'},
  {id:'used-volare-w9-2016',make:'Volare',model:'W9 Fly',chassis:'Volare / Agrale MA 9.2',year:2016,km:305000,segment:'micro',seats:27,standing:0,tank:150,engine:'Cummins ISF 3.8',fuel:'Diesel S10',condition:64,price:238000,prep:16000,city:'Juiz de Fora/MG',notes:'Micro-ônibus para serviço seletivo/escolar; verificar documentação e sistema de portas.'},
  {id:'used-comil-campione-2014',make:'Comil',model:'Campione 3.25',chassis:'Mercedes-Benz O-500 RSD',year:2014,km:884000,segment:'rodoviario',seats:44,standing:0,tank:600,engine:'OM 457 LA',fuel:'Diesel S10',condition:49,price:398000,prep:67500,city:'Porto Alegre/RS',notes:'Preço reduzido por alta quilometragem; inspeção profunda de motor, transmissão e pneus.'},
  {id:'used-busscar-elbuss-2017',make:'Busscar',model:'El Buss 320',chassis:'Volkswagen 17.230 OD',year:2017,km:517000,segment:'rodoviario',seats:42,standing:0,tank:300,engine:'MAN D08',fuel:'Diesel S10',condition:70,price:428000,prep:24500,city:'Florianópolis/SC',notes:'Configuração fretamento/intermunicipal, ar-condicionado e bagageiro.'}
 ];
 let selected=null;
 const sold=()=>{try{const rows=JSON.parse(localStorage.getItem(STORE_KEY)||'[]');return Array.isArray(rows)?rows:[];}catch(e){return [];}};
 const saveSold=rows=>{try{localStorage.setItem(STORE_KEY,JSON.stringify(rows));return true;}catch(e){showToast('Armazenamento insuficiente para salvar o histórico do mercado.');return false;}};
 const available=()=>{const done=new Set(sold().filter(x=>x.status==='adquirido').map(x=>x.listingId));return listings.filter(x=>!done.has(x.id));};
 function render(){
  const list=$id('usedMarketList');if(!list)return;
  const q=norm($id('usedMarketSearch')?.value||''),make=$id('usedMarketMake')?.value||'',segment=$id('usedMarketSegment')?.value||'',max=Number($id('usedMarketMaxPrice')?.value)||Infinity;
  const rows=available().filter(x=>(!make||x.make===make)&&(!segment||x.segment===segment)&&x.price<=max&&(!q||norm(`${x.make} ${x.model} ${x.chassis} ${x.city}`).includes(q)));
  $id('usedMarketSummary').innerHTML=`<strong>${rows.length} oferta(s) disponível(is)</strong><span>${available().length} no catálogo · ${sold().filter(x=>x.status==='adquirido').length} adquirida(s) neste navegador</span>`;
  list.innerHTML=rows.length?rows.map(x=>`<article class="used-bus-card"><div class="used-bus-top"><span class="doc-status-tag">${x.segment==='rodoviario'?'Rodoviário':x.segment==='urbano'?'Urbano':x.segment==='micro'?'Micro-ônibus':'Midi'}</span><span class="used-bus-condition">Conservação estimada ${x.condition}%</span></div><div><span class="eyebrow">${escapeHtml(x.make)} · ${x.year}</span><h3>${escapeHtml(x.model)}</h3><p>${escapeHtml(x.chassis)}</p></div><div class="used-bus-metrics"><div><span>Hodômetro</span><strong>${numberPt(x.km,0)} km</strong></div><div><span>Lotação cadastrada</span><strong>${x.seats+x.standing} posições</strong></div><div><span>Preparação estimada</span><strong>${money(x.prep)}</strong></div><div><span>Origem</span><strong>${escapeHtml(x.city)}</strong></div></div><div class="used-bus-bottom"><strong>${money(x.price)}</strong><button class="primary-button" type="button" data-used-select="${escapeHtml(x.id)}">Avaliar / adquirir</button></div><p class="tool-result-note">${escapeHtml(x.notes)}</p></article>`).join(''):'<div class="empty-state-text">Nenhuma oferta corresponde aos filtros atuais.</div>';
 }
 function calc(){
  const box=$id('usedMarketCalculation');if(!box||!selected)return;
  const prep=Math.max(0,Number($id('usedMarketPrepCost')?.value)||0),payment=$id('usedMarketPayment')?.value||'cash',downPct=Math.max(0,Math.min(100,Number($id('usedMarketDownPct')?.value)||0)),months=Math.max(1,Math.floor(Number($id('usedMarketMonths')?.value)||1)),rate=Math.max(0,Number($id('usedMarketRate')?.value)||0),total=selected.price+prep;
  const down=payment==='finance'?total*downPct/100:total,principal=Math.max(0,total-down),monthly=loanMonthlyPayment(principal,months,rate);
  box.innerHTML=`<div><span>Preço do ônibus</span><strong>${money(selected.price)}</strong></div><div><span>Preparação</span><strong>${money(prep)}</strong></div><div><span>Investimento total</span><strong>${money(total)}</strong></div><div><span>Entrada / à vista</span><strong>${money(down)}</strong></div><div><span>Saldo financiado</span><strong>${money(principal)}</strong></div><div><span>Parcela estimada</span><strong>${payment==='finance'?money(monthly):'—'}</strong></div>`;
 }
 function openPurchase(id){
  const item=available().find(x=>x.id===id);if(!item)return;selected=item;
  $id('usedMarketPurchase').hidden=false;$id('usedMarketPurchaseTitle').textContent=`${item.make} ${item.model} · ${item.year}`;$id('usedMarketPurchaseDescription').textContent=`${item.chassis} · ${numberPt(item.km,0)} km · condição estimada ${item.condition}% · ${money(item.price)}.`;
  $id('usedMarketPrepCost').value=String(item.prep);$id('usedMarketPrefix').value='';$id('usedMarketPayment').value='cash';$id('usedMarketDownPct').value='25';$id('usedMarketMonths').value='48';$id('usedMarketRate').value='1.29';$id('usedMarketPurchase').scrollIntoView({behavior:'smooth',block:'nearest'});calc();
 }
 function acquire(event){
  event.preventDefault();if(!assertOwner()||!selected)return;
  const company=$id('usedMarketCompany').value,prefix=$id('usedMarketPrefix').value.trim(),prep=Number($id('usedMarketPrepCost').value),payment=$id('usedMarketPayment').value,downPct=Number($id('usedMarketDownPct').value),months=Math.floor(Number($id('usedMarketMonths').value)),rate=Number($id('usedMarketRate').value),total=selected.price+prep;
  if(!prefix||!Number.isFinite(prep)||prep<0||!Number.isFinite(downPct)||downPct<0||downPct>100||!Number.isInteger(months)||months<1||months>120||!Number.isFinite(rate)||rate<0||rate>10){showToast('Confira prefixo, preparação e condições de financiamento.');return;}
  if(ownerFleet().some(v=>norm(v.company)===norm(company)&&norm(v.prefix)===norm(prefix))||financedBuses().some(v=>norm(v.company)===norm(company)&&norm(v.prefix)===norm(prefix))){showToast('Este prefixo já existe nessa empresa. Use uma identificação livre.');return;}
  const down=payment==='finance'?total*downPct/100:total,principal=Math.max(0,total-down),installment=payment==='finance'?loanMonthlyPayment(principal,months,rate):0;
  const balance=cashBreakdown().balance;if(down>balance+0.005){showToast(`Compra recusada: o Caixa disponível é ${money(balance)} e a entrada necessária é ${money(down)}.`);return;}
  if(!window.confirm(`Confirmar aquisição simulada?

${selected.make} ${selected.model} (${selected.year})
Empresa: ${company} · Prefixo: ${prefix}
Preço: ${money(selected.price)}
Preparação: ${money(prep)}
Entrada: ${money(down)}
${payment==='finance'?`${months} parcelas estimadas de ${money(installment)} (${rate}% a.m.)`: 'Compra à vista'}

O veículo será inserido na Frota e receberá uma OS bloqueante de inspeção inicial.`))return;
  const fleetBefore=ownerFleet(),finBefore=financedBuses(),ledgerBefore=cashLedger(),ordersBefore=typeof gcGarageOrders==='function'?gcGarageOrders():[],soldBefore=sold(),garageBefore=typeof gcGarageState==='function'?gcGarageState():{},agendaBefore=typeof readArrayKey==='function'?readArrayKey(GC_AGENDA_EVENTS_KEY):[],profilesBefore=typeof gcAgendaReadProfiles==='function'?gcAgendaReadProfiles():{};
  const vehicle={id:makeId(),company,prefix,model:`${selected.make} ${selected.model}`,chassis:selected.chassis,year:selected.year,km:selected.km,estimatedKm:selected.km,kmEstimated:false,yearEstimated:false,seats:selected.seats,standing:selected.standing,tank:selected.tank,capacity:selected.tank,engine:selected.engine,fuel:selected.fuel,bodyBuilder:selected.make,segment:selected.segment,type:selected.segment==='rodoviario'?'Rodoviário':selected.segment==='micro'?'Micro-ônibus':selected.segment==='midibus'?'Midi':'Urbano',conditionPct:selected.condition,isUsed:true,source:'used-market',usedListingId:selected.id,createdAt:new Date().toISOString(),preparationCost:prep,initialInspectionRequired:true};
  const ledgerRow={id:`used-market-purchase-${selected.id}-${vehicle.id}`,date:dateTodayLocal(),direction:'out',category:payment==='finance'?'Entrada de ônibus usado financiado':'Compra de ônibus usado',amount:down,description:`${selected.make} ${selected.model} · ${company} · prefixo ${prefix} · preparação ${money(prep)}`,createdAt:new Date().toISOString(),source:'usedBusPurchase',vehicleId:vehicle.id,reference:selected.id};
  const financeRow=payment==='finance'?{id:makeId(),company,model:vehicle.model,chassis:vehicle.chassis,year:vehicle.year,prefix,price:total,downPayment:down,principal,installmentCount:months,monthlyRate:rate,installmentAmount:installment,firstDueDate:addMonthsToISO(dateTodayLocal(),1),lateFinePct:2,lateInterestPct:1,paidCount:0,payments:[],createdAt:new Date().toISOString(),usedMarketListingId:selected.id,assetLiability:true}:null;
  try{
   if(!writeArrayKey(OWNER_FLEET_KEY,[...fleetBefore,vehicle]))throw new Error('Não foi possível gravar o veículo na Frota.');
   if(financeRow&&!writeArrayKey(FINANCED_BUSES_KEY,[...finBefore,financeRow]))throw new Error('Não foi possível gravar o financiamento.');
   if(down>0&&!writeArrayKey(CASH_LEDGER_KEY,[...ledgerBefore,ledgerRow]))throw new Error('Não foi possível lançar a entrada no Banco.');
   if(typeof gcGarageSyncVehicles==='function')gcGarageSyncVehicles();
   if(typeof gcGarageState==='function'&&typeof gcGarageWrite==='function'){
    const states=gcGarageState(),key=gcGarageKey(vehicle),technical=states[key];if(technical){technical.isNew=false;technical.year=vehicle.year;technical.yearEstimated=false;technical.km=vehicle.km;technical.estimatedKm=vehicle.km;technical.kmEstimated=false;const componentKeys=Object.keys(technical.components||{});componentKeys.forEach((component,index)=>{const variation=((index%5)-2)*3;technical.components[component]=Math.max(25,Math.min(96,selected.condition+variation));});technical.condition=gcGarageCondition(technical);states[key]=technical;if(!gcGarageWrite(GC_GARAGE_STATE_KEY,states))throw new Error('Não foi possível registrar a condição inicial na Garagem.');}
   }
   if(typeof gcGarageOrders==='function'&&typeof gcGarageWrite==='function'){
    const key=gcGarageKey(vehicle),order={id:makeId(),number:`GC-${String(ordersBefore.length+1).padStart(5,'0')}`,createdAt:new Date().toISOString(),company,prefix,model:vehicle.model,chassis:vehicle.chassis,vehicleKey:key,garage:'Garagem Central Grupo Conect · Inspeção inicial',service:'Inspeção pré-operacional',mechanicId:'',mechanicName:'Conferência inicial do proprietário',mechanicLevel:0,mechanicNames:['Conferência inicial do proprietário'],priority:'Alta',notes:'Inspeção inicial obrigatória de veículo adquirido no Mercado de Usados. Conferir documentação, freios, pneus, suspensão, motor, transmissão, sistema elétrico, limpeza e hodômetro.',estimatedHours:1.5,parts:[],partsCost:0,laborCost:0,progress:100,status:'Aguardando conferência',startedAt:new Date().toISOString(),workSummary:['Documentação e identificação','Freios e sistema pneumático','Pneus e rodas','Suspensão e direção','Motor, transmissão e vazamentos','Sistema elétrico e iluminação','Acessibilidade e portas','Limpeza e conservação'],revisionCount:0,initialUsedBusInspection:true};
    if(!gcGarageWrite(GC_GARAGE_ORDERS_KEY,[...ordersBefore,order]))throw new Error('Não foi possível criar a inspeção inicial na Garagem.');
    if(typeof gcAgendaSyncFleet==='function')gcAgendaSyncFleet();
    const agendaRow={id:`used-bus-inspection-${vehicle.id}`,date:dateTodayLocal(),type:'maintenance',title:'Inspeção inicial obrigatória · ônibus usado',time:'08:00',priority:'Urgente',vehicle:`${company} · ${prefix} · ${vehicle.model}`,company,prefix,vehicleKey:key,description:'Conferência de documentação, freios, pneus, suspensão, motor, transmissão, sistema elétrico, acessibilidade e conservação. O veículo permanece bloqueado até aprovação da OS na Garagem.',source:'used-bus-market',createdAt:new Date().toISOString()};
    if(!writeArrayKey(GC_AGENDA_EVENTS_KEY,[...agendaBefore,agendaRow]))throw new Error('Não foi possível registrar a inspeção na Agenda de Frota.');
   }
   const sales=[...soldBefore,{id:makeId(),listingId:selected.id,vehicleId:vehicle.id,company,prefix,price:selected.price,preparationCost:prep,totalCost:total,downPayment:down,financed:payment==='finance',status:'adquirido',acquiredAt:new Date().toISOString()}];
   if(!saveSold(sales))throw new Error('Não foi possível registrar o histórico da aquisição.');
   if(typeof renderOwnerFleet==='function')renderOwnerFleet();if(typeof refreshOperationChoices==='function')refreshOperationChoices();if(typeof gcBankRender==='function')gcBankRender();if(typeof gcGarageRender==='function'&&!$id('gcGaragePanel')?.hidden)gcGarageRender();if(typeof gcAgendaRender==='function'&&!$id('gcAgendaPanel')?.hidden)gcAgendaRender();
   selected=null;$id('usedMarketPurchase').hidden=true;$id('usedMarketPurchaseForm').reset();render();showToast('Ônibus usado adquirido, integrado à Frota e bloqueado até aprovação da inspeção inicial.');
  }catch(error){
   // Reversão compensatória: não deixar aquisição parcial nem crédito/débito órfão.
   try{localStorage.setItem(OWNER_FLEET_KEY,JSON.stringify(fleetBefore));localStorage.setItem(FINANCED_BUSES_KEY,JSON.stringify(finBefore));localStorage.setItem(CASH_LEDGER_KEY,JSON.stringify(ledgerBefore));localStorage.setItem(GC_GARAGE_ORDERS_KEY,JSON.stringify(ordersBefore));localStorage.setItem(GC_GARAGE_STATE_KEY,JSON.stringify(garageBefore));localStorage.setItem(GC_AGENDA_EVENTS_KEY,JSON.stringify(agendaBefore));localStorage.setItem(GC_AGENDA_PROFILES_KEY,JSON.stringify(profilesBefore));localStorage.setItem(STORE_KEY,JSON.stringify(soldBefore));}catch(rollback){console.error('[UsedMarket] rollback failed',rollback);}
   showToast(`Aquisição não concluída e reversão solicitada: ${error.message||'erro inesperado'}.`);
  }
 }
 function open(){if(!assertOwner())return;$id('gcBankPanel').hidden=true;$id('gcAgendaPanel').hidden=true;$id('gcGaragePanel').hidden=true;$id('gcFleetAdminPanel').hidden=true;$id('gcApprenticePanel').hidden=true;$id('onlineServicePanel').hidden=true;$id('zeroKmMarketPanel').hidden=true;$id('usedBusMarketPanel').hidden=false;render();$id('usedBusMarketPanel').scrollIntoView({behavior:'smooth',block:'start'});}
 $id('usedMarketOpenButton')?.addEventListener('click',open);$id('usedMarketCloseButton')?.addEventListener('click',()=>$id('usedBusMarketPanel').hidden=true);$id('usedMarketSearch')?.addEventListener('input',render);$id('usedMarketMake')?.addEventListener('change',render);$id('usedMarketSegment')?.addEventListener('change',render);$id('usedMarketMaxPrice')?.addEventListener('input',render);$id('usedMarketList')?.addEventListener('click',event=>{const button=event.target.closest('[data-used-select]');if(button)openPurchase(button.dataset.usedSelect);});$id('usedMarketPurchaseForm')?.addEventListener('submit',acquire);$id('usedMarketPurchaseForm')?.addEventListener('input',calc);$id('usedMarketCancelPurchase')?.addEventListener('click',()=>{$id('usedMarketPurchase').hidden=true;selected=null;});$id('usedMarketPayment')?.addEventListener('change',()=>{$id('usedMarketDownPct').disabled=$id('usedMarketPayment').value!=='finance';$id('usedMarketMonths').disabled=$id('usedMarketPayment').value!=='finance';$id('usedMarketRate').disabled=$id('usedMarketPayment').value!=='finance';calc();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$id('usedBusMarketPanel')&&!$id('usedBusMarketPanel').hidden)render();});
})();
