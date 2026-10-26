(() => {
  const API = '/api';
  let services = [];
  let clients = [];
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const money = n => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const dateBR = d => d ? new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR') : 'Não informada';
  const safe = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const slugStatus = s => ({'Aguardando retorno':'s-aguardando','Em andamento':'s-andamento','Finalizado':'s-finalizado'}[s]||'');
  async function request(path, options={}) {
    const res = await fetch(API+path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    if(!res.ok){let msg='Erro na operação';try{const x=await res.json();msg=x.error||msg}catch{}throw new Error(msg)}
    return res.status===204?null:res.json();
  }
  function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
  function openModal(id){$('#'+id).classList.add('open')} function closeModal(id){$('#'+id).classList.remove('open')}
  function go(page,title){$$('.page').forEach(x=>x.classList.remove('active'));$('#page-'+page).classList.add('active');$$('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('#topTitle').textContent=title;$('#quickAdd').style.display=page==='servicos'?'inline-flex':'none';$('#sidebar').classList.remove('open');renderAll()}
  $$('.nav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page,b.textContent.trim().replace(/^[^\s]+\s/,''))));
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
  $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
  $('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  function renderDashboard(){
    $('#kTotal').textContent=services.length;$('#kAndamento').textContent=services.filter(x=>x.status==='Em andamento').length;$('#kAguardando').textContent=services.filter(x=>x.status==='Aguardando retorno').length;
    $('#kValorAndamento').textContent=money(services.filter(x=>x.status==='Em andamento').reduce((a,x)=>a+Number(x.valor||0),0));
    $('#kValorFinalizado').textContent=money(services.filter(x=>x.status==='Finalizado').reduce((a,x)=>a+Number(x.valor||0),0));
    const statuses=[['Aguardando retorno','#eab308'],['Em andamento','#3b82f6'],['Finalizado','#8b5cf6']],max=Math.max(services.length,1);
    $('#statusBars').innerHTML=statuses.map(([s,c])=>{const n=services.filter(x=>x.status===s).length;return `<div class="status-row"><span>${s}</span><div class="bar"><span style="width:${n/max*100}%;background:${c}"></span></div><b>${n}</b></div>`}).join('');
    const upcoming=[...services].filter(x=>x.inicio).sort((a,b)=>String(a.inicio).localeCompare(String(b.inicio))).slice(0,4);$('#upcoming').innerHTML=upcoming.length?upcoming.map(x=>`<div class="up-item"><strong>${safe(x.cliente)}</strong><span>${dateBR(x.inicio)} • ${safe(x.tipo)}</span></div>`).join(''):'<div class="blank-panel">Nenhum serviço agendado.</div>';
  }
  function renderClients(){const q=$('#clientSearch').value.toLowerCase(),list=clients.filter(x=>[x.nome,x.telefone,x.endereco].join(' ').toLowerCase().includes(q));$('#clientRows').innerHTML=list.length?list.map(x=>`<tr><td><b>${safe(x.nome)}</b><br><small>${safe(x.email||'')}</small></td><td>${safe(x.telefone||'')}</td><td>${safe(x.endereco)}</td><td>${safe(x.tipo)}</td><td>${services.filter(s=>Number(s.cliente_id)===Number(x.id)).length}</td><td><div class="actions"><button class="btn btn-secondary btn-sm" onclick="editClient(${x.id})">Editar</button><button class="btn btn-danger btn-sm" onclick="deleteClient(${x.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>'}
  function renderServices(){const q=$('#serviceSearch').value.toLowerCase(),st=$('#statusFilter').value,list=services.filter(x=>[x.cliente,x.tipo,x.endereco].join(' ').toLowerCase().includes(q)&&(!st||x.status===st));$('#serviceRows').innerHTML=list.length?list.map(x=>`<tr><td>#${x.id}</td><td><b>${safe(x.cliente)}</b><br><small>${safe(x.tipo)}</small></td><td>${safe(x.imovel)}<br><small>${safe(x.endereco)}</small></td><td>${dateBR(x.inicio)}</td><td><span class="badge ${slugStatus(x.status)}">${safe(x.status)}</span></td><td class="money">${money(x.valor)}</td><td><div class="actions"><button class="btn btn-secondary btn-sm" onclick="editService(${x.id})">Editar</button><button class="btn btn-danger btn-sm" onclick="deleteService(${x.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum serviço encontrado.</td></tr>'}
  function renderAgenda(){const list=[...services].sort((a,b)=>String(a.inicio||'9999').localeCompare(String(b.inicio||'9999')));$('#agendaRows').innerHTML=list.length?list.map(x=>`<tr><td>${dateBR(x.inicio)}</td><td><b>${safe(x.cliente)}</b></td><td>${safe(x.tipo)}</td><td>${safe(x.endereco)}</td><td><span class="badge ${slugStatus(x.status)}">${safe(x.status)}</span></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Agenda vazia.</td></tr>'}
  function renderFinance(){const sum=f=>services.filter(f).reduce((a,x)=>a+Number(x.valor||0),0);$('#fTotal').textContent=money(sum(()=>true));$('#fExecucao').textContent=money(sum(x=>x.status==='Em andamento'));$('#fConcluido').textContent=money(sum(x=>x.status==='Finalizado'))}
  function renderAll(){renderDashboard();renderClients();renderServices();renderAgenda();renderFinance()}
  async function loadAll(){try{[clients,services]=await Promise.all([request('/clientes'),request('/servicos')]);renderAll()}catch(e){toast('Falha ao carregar: '+e.message)}}
  $('#clientSearch').addEventListener('input',renderClients);$('#serviceSearch').addEventListener('input',renderServices);$('#statusFilter').addEventListener('change',renderServices);
  function newService(){ $('#serviceForm').reset();$('#serviceId').value='';$('#serviceModalTitle').textContent='Novo Serviço';openModal('serviceModal') }
  $('#quickAdd').addEventListener('click',newService);$$('.add-service').forEach(b=>b.addEventListener('click',newService));
  $('#addClient').addEventListener('click',()=>{$('#clientForm').reset();$('#clientId').value='';$('#clientModalTitle').textContent='Novo Cliente';openModal('clientModal')});
  $('#serviceForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#serviceId').value,obj={cliente:$('#sCliente').value.trim(),telefone:$('#sTelefone').value.trim(),endereco:$('#sEndereco').value.trim(),imovel:$('#sImovel').value,tipo:$('#sTipo').value,inicio:$('#sInicio').value||null,fim:$('#sFim').value||null,valor:Number($('#sValor').value),status:$('#sStatus').value,orcamento:$('#sOrcamento').value.trim(),obs:$('#sObs').value.trim()};try{await request('/servicos'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal('serviceModal');await loadAll();toast('Serviço salvo com sucesso!')}catch(err){toast(err.message)}});
  $('#clientForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#clientId').value,obj={nome:$('#cNome').value.trim(),telefone:$('#cTelefone').value.trim(),endereco:$('#cEndereco').value.trim(),tipo:$('#cTipo').value,email:$('#cEmail').value.trim(),obs:$('#cObs').value.trim()};try{await request('/clientes'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal('clientModal');await loadAll();toast('Cliente salvo com sucesso!')}catch(err){toast(err.message)}});
  window.editService=id=>{const x=services.find(v=>Number(v.id)===Number(id));if(!x)return;$('#serviceId').value=x.id;$('#sCliente').value=x.cliente;$('#sTelefone').value=x.telefone||'';$('#sEndereco').value=x.endereco;$('#sImovel').value=x.imovel;$('#sTipo').value=x.tipo;$('#sInicio').value=x.inicio?String(x.inicio).slice(0,10):'';$('#sFim').value=x.fim?String(x.fim).slice(0,10):'';$('#sValor').value=x.valor;$('#sStatus').value=x.status;$('#sOrcamento').value=x.orcamento||'';$('#sObs').value=x.obs||'';$('#serviceModalTitle').textContent='Editar Serviço #'+x.id;openModal('serviceModal')};
  window.deleteService=async id=>{if(confirm('Deseja realmente excluir este serviço?'))try{await request('/servicos/'+id,{method:'DELETE'});await loadAll();toast('Serviço excluído.')}catch(e){toast(e.message)}};
  window.editClient=id=>{const x=clients.find(v=>Number(v.id)===Number(id));if(!x)return;$('#clientId').value=x.id;$('#cNome').value=x.nome;$('#cTelefone').value=x.telefone||'';$('#cEndereco').value=x.endereco;$('#cTipo').value=x.tipo;$('#cEmail').value=x.email||'';$('#cObs').value=x.obs||'';$('#clientModalTitle').textContent='Editar Cliente';openModal('clientModal')};
  window.deleteClient=async id=>{if(confirm('Deseja realmente excluir este cliente?'))try{await request('/clientes/'+id,{method:'DELETE'});await loadAll();toast('Cliente excluído.')}catch(e){toast(e.message)}};
  loadAll();
})();
