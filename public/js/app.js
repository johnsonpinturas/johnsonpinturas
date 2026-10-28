(() => {
  const API = '/api';
  let services = [];
  let clients = [];
  let budgets = [];
  let authenticated = false;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const money = n => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const dateBR = d => d ? new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR') : 'Não informada';
  const safe = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const slugStatus = s => ({'Aguardando retorno':'s-aguardando','Em andamento':'s-andamento','Finalizado':'s-finalizado'}[s]||'');
  async function request(path, options={}) {
    const res = await fetch(API+path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    if(res.status===401){showLogin('Sua sessão expirou. Faça login novamente.');throw new Error('Sessão expirada.')}
    if(!res.ok){let msg='Erro na operação';try{const x=await res.json();msg=x.error||msg}catch{}throw new Error(msg)}
    return res.status===204?null:res.json();
  }

  function showLogin(message=''){$('#loginScreen').hidden=false;$('#loginError').textContent=message;authenticated=false;setTimeout(()=>$('#loginUser').focus(),0)}
  function hideLogin(usuario){$('#loginScreen').hidden=true;$('#loginError').textContent='';$('#adminUser').textContent='Admin: '+usuario;authenticated=true}
  async function checkAuth(){try{const res=await fetch(API+'/auth/me');if(!res.ok)throw new Error();const data=await res.json();hideLogin(data.usuario);await loadAll()}catch{showLogin()}}
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('#loginButton');button.disabled=true;$('#loginError').textContent='';try{const res=await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:$('#loginUser').value.trim(),senha:$('#loginPassword').value})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Não foi possível entrar.');$('#loginPassword').value='';hideLogin(data.usuario);await loadAll()}catch(err){showLogin(err.message)}finally{button.disabled=false}});
  $('#logoutButton').addEventListener('click',async()=>{await fetch(API+'/auth/logout',{method:'POST'});services=[];clients=[];budgets=[];$('#loginForm').reset();showLogin('Sessão encerrada com segurança.')});

  function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
  function openModal(id){$('#'+id).classList.add('open')} function closeModal(id){$('#'+id).classList.remove('open')}
  function go(page,title){$$('.page').forEach(x=>x.classList.remove('active'));$('#page-'+page).classList.add('active');$$('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('#topTitle').textContent=['clientes','servicos'].includes(page)?'':title;$('#quickAdd').style.display=page==='servicos'?'inline-flex':'none';$('#sidebar').classList.remove('open');renderAll()}
  $$('.nav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page,b.textContent.trim().replace(/^[^\s]+\s/,''))));
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
  $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
  $('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  function getDashboardServices(){
    const start=$('#dashboardStartDate').value,end=$('#dashboardEndDate').value;
    return services.filter(x=>{const d=x.inicio?String(x.inicio).slice(0,10):'';return d&&(!start||d>=start)&&(!end||d<=end)});
  }
  function renderDashboard(){
    const list=getDashboardServices();
    $('#kTotal').textContent=list.length;$('#kAndamento').textContent=list.filter(x=>x.status==='Em andamento').length;$('#kAguardando').textContent=list.filter(x=>x.status==='Aguardando retorno').length;
    $('#kValorAndamento').textContent=money(list.filter(x=>x.status==='Em andamento').reduce((a,x)=>a+Number(x.valor||0),0));
    $('#kValorFinalizado').textContent=money(list.filter(x=>x.status==='Finalizado').reduce((a,x)=>a+Number(x.valor||0),0));
    const statuses=[['Aguardando retorno','#eab308'],['Em andamento','#3b82f6'],['Finalizado','#16a34a']],max=Math.max(list.length,1);
    $('#statusBars').innerHTML=statuses.map(([s,c])=>{const n=list.filter(x=>x.status===s).length;return `<div class="status-row"><span>${s}</span><div class="bar"><span style="width:${n/max*100}%;background:${c}"></span></div><b>${n}</b></div>`}).join('');
    const upcoming=[...list].filter(x=>x.inicio&&x.status!=='Finalizado').sort((a,b)=>String(a.inicio).localeCompare(String(b.inicio))).slice(0,4);$('#upcoming').innerHTML=upcoming.length?upcoming.map(x=>`<div class="up-item"><strong>${safe(x.cliente)}</strong><span>${dateBR(x.inicio)} • ${safe(x.tipo)}</span></div>`).join(''):'<div class="blank-panel">Nenhum serviço encontrado no período.</div>';
    const start=$('#dashboardStartDate').value,end=$('#dashboardEndDate').value;
    $('#dashboardFilterResult').textContent=start||end?`${list.length} serviço(s) no período selecionado`:'Exibindo todos os períodos';
    renderManagementTrafficLight(list);
  }
  function renderManagementTrafficLight(list){
    const today=new Date();today.setHours(0,0,0,0);const day=86400000;
    const active=list.filter(x=>x.status!=='Finalizado');
    const deadline=x=>x.fim?new Date(String(x.fim).slice(0,10)+'T00:00:00'):null;
    const days=x=>Math.round((deadline(x)-today)/day);
    const overdue=active.filter(x=>deadline(x)&&days(x)<0);
    const soon=active.filter(x=>deadline(x)&&days(x)>=0&&days(x)<=7);
    const onTime=active.filter(x=>deadline(x)&&days(x)>7);
    const noDate=active.filter(x=>!deadline(x));
    const finished=list.filter(x=>x.status==='Finalizado');
    $('#fAtrasados').textContent=overdue.length;$('#fVencem7').textContent=soon.length;$('#fNoPrazo').textContent=onTime.length;$('#fSemData').textContent=noDate.length;$('#fFinalizados').textContent=finished.length;
    const attention=[...overdue.map(x=>({x,level:0,label:'Atrasado',css:'deadline-overdue',detail:`${Math.abs(days(x))} dia(s) em atraso`})),...soon.map(x=>({x,level:1,label:'Atenção',css:'deadline-soon',detail:days(x)===0?'Vence hoje':`Vence em ${days(x)} dia(s)`})),...noDate.map(x=>({x,level:2,label:'Sem data',css:'deadline-nodate',detail:'Definir data de conclusão'}))].sort((a,b)=>a.level-b.level||(deadline(a.x)||new Date(8640000000000000))-(deadline(b.x)||new Date(8640000000000000)));
    $('#attentionSummary').textContent=attention.length?`${attention.length} serviço(s) exigem atenção`:'Nenhuma pendência no período';
    $('#attentionRows').innerHTML=attention.length?attention.map(a=>`<tr><td><span class="deadline ${a.css}">${a.label}</span></td><td><b>${safe(a.x.cliente)}</b><br><small>${safe(a.x.tipo)}</small></td><td>${dateBR(a.x.fim)}</td><td>${a.detail}</td><td><span class="badge ${slugStatus(a.x.status)}">${safe(a.x.status)}</span></td><td><button type="button" class="btn btn-secondary btn-sm" onclick="editService(${a.x.id})">Editar</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum serviço exige atenção no período selecionado.</td></tr>';
  }
  function renderClients(){const q=$('#clientSearch').value.toLowerCase(),list=clients.filter(x=>[x.nome,x.telefone,x.endereco].join(' ').toLowerCase().includes(q));$('#clientRows').innerHTML=list.length?list.map(x=>`<tr><td><b>${safe(x.nome)}</b><br><small>${safe(x.email||'')}</small></td><td>${safe(x.telefone||'')}</td><td>${safe(x.endereco)}</td><td>${safe(x.tipo)}</td><td>${services.filter(s=>Number(s.cliente_id)===Number(x.id)).length}</td><td><div class="actions"><button class="btn btn-secondary btn-sm" onclick="editClient(${x.id})">Editar</button><button class="btn btn-danger btn-sm" onclick="deleteClient(${x.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>'}
  function renderServices(){const q=$('#serviceSearch').value.toLowerCase(),st=$('#statusFilter').value,list=services.filter(x=>[x.cliente,x.tipo,x.endereco].join(' ').toLowerCase().includes(q)&&(!st||x.status===st));$('#serviceRows').innerHTML=list.length?list.map(x=>`<tr><td>#${x.id}</td><td><b>${safe(x.cliente)}</b><br><small>${safe(x.tipo)}</small></td><td>${safe(x.imovel)}<br><small>${safe(x.endereco)}</small></td><td>${dateBR(x.inicio)}</td><td><span class="badge ${slugStatus(x.status)}">${safe(x.status)}</span></td><td class="money">${money(x.valor)}</td><td><div class="actions"><button class="btn btn-secondary btn-sm" onclick="editService(${x.id})">Editar</button><button class="btn btn-danger btn-sm" onclick="deleteService(${x.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum serviço encontrado.</td></tr>'}
  const budgetStatusClass = status => ({'Em elaboração':'budget-draft','Enviado':'budget-sent','Aprovado':'budget-approved','Recusado':'budget-rejected','Vencido':'budget-expired'}[status]||'budget-draft');
  function renderBudgets(){
    const search=$('#budgetSearch'); if(!search)return;
    const q=search.value.toLowerCase(),st=$('#budgetStatusFilter').value;
    const list=budgets.filter(x=>[x.id,x.cliente,x.endereco,x.tipo_servico,x.local_pintura].join(' ').toLowerCase().includes(q)&&(!st||x.status===st));
    $('#oTotal').textContent=budgets.length;
    $('#oPendentes').textContent=budgets.filter(x=>['Em elaboração','Enviado'].includes(x.status)).length;
    $('#oAprovados').textContent=budgets.filter(x=>x.status==='Aprovado').length;
    $('#oValorAprovado').textContent=money(budgets.filter(x=>x.status==='Aprovado').reduce((a,x)=>a+Number(x.valor||0),0));
    $('#budgetRows').innerHTML=list.length?list.map(x=>`<tr><td>#${x.id}</td><td><b>${safe(x.cliente)}</b><br><small>${safe(x.email||'')}</small></td><td>${safe(x.tipo_servico)}<br><small>${safe(x.local_pintura)} • ${safe(x.endereco)}</small></td><td>${dateBR(x.data_orcamento)}</td><td>${dateBR(x.validade)}</td><td><span class="budget-status ${budgetStatusClass(x.status)}">${safe(x.status)}</span></td><td class="money">${money(x.valor)}</td><td><div class="budget-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="editBudget(${x.id})">Editar</button><button type="button" class="btn btn-secondary btn-sm" onclick="downloadBudgetPdf(${x.id})">PDF</button><button type="button" class="btn btn-secondary btn-sm" onclick="emailBudget(${x.id})">E-mail</button><button type="button" class="btn btn-danger btn-sm" onclick="deleteBudget(${x.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="8" class="empty">Nenhum orçamento encontrado.</td></tr>';
  }
  function renderAgenda(){const list=[...services].sort((a,b)=>String(a.inicio||'9999').localeCompare(String(b.inicio||'9999')));$('#agendaRows').innerHTML=list.length?list.map(x=>`<tr><td>${dateBR(x.inicio)}</td><td><b>${safe(x.cliente)}</b></td><td>${safe(x.tipo)}</td><td>${safe(x.endereco)}</td><td><span class="badge ${slugStatus(x.status)}">${safe(x.status)}</span></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Agenda vazia.</td></tr>'}
  function renderFinance(){const sumServices=f=>services.filter(f).reduce((a,x)=>a+Number(x.valor||0),0);const sumBudgets=f=>budgets.filter(f).reduce((a,x)=>a+Number(x.valor||0),0);$('#fTotal').textContent=money(sumBudgets(()=>true));$('#fAguardandoRetorno').textContent=money(sumBudgets(x=>['Em elaboração','Enviado'].includes(x.status)));$('#fExecucao').textContent=money(sumServices(x=>x.status==='Em andamento'));$('#fConcluido').textContent=money(sumServices(x=>x.status==='Finalizado'))}
  function renderAll(){renderDashboard();renderClients();renderServices();renderBudgets();renderAgenda();renderFinance()}
  async function loadAll(){try{[clients,services,budgets]=await Promise.all([request('/clientes'),request('/servicos'),request('/orcamentos')]);renderAll()}catch(e){toast('Falha ao carregar: '+e.message)}}
  $('#applyDashboardFilter').addEventListener('click',()=>{const start=$('#dashboardStartDate').value,end=$('#dashboardEndDate').value;if(start&&end&&start>end){toast('A Data início não pode ser maior que a Data fim.');return}renderDashboard()});
  $('#clearDashboardFilter').addEventListener('click',()=>{$('#dashboardStartDate').value='';$('#dashboardEndDate').value='';renderDashboard()});
  $('#clientSearch').addEventListener('input',renderClients);$('#serviceSearch').addEventListener('input',renderServices);$('#statusFilter').addEventListener('change',renderServices);$('#budgetSearch')?.addEventListener('input',renderBudgets);$('#budgetStatusFilter')?.addEventListener('change',renderBudgets);
  $('#exportExcel').addEventListener('click',()=>{const q=$('#serviceSearch').value.trim(),status=$('#statusFilter').value;const params=new URLSearchParams();if(q)params.set('q',q);if(status)params.set('status',status);window.location.href='/api/servicos/exportar.xlsx'+(params.toString()?'?'+params.toString():'');});
  function newService(){ $('#serviceForm').reset();$('#serviceId').value='';$('#serviceModalTitle').textContent='Novo Serviço';openModal('serviceModal') }
  $('#quickAdd').addEventListener('click',newService);$$('.add-service').forEach(b=>b.addEventListener('click',newService));
  $('#addClient').addEventListener('click',()=>{$('#clientForm').reset();$('#clientId').value='';$('#clientModalTitle').textContent='Novo Cliente';openModal('clientModal')});
  function newBudget(){
    $('#budgetForm').reset();$('#budgetId').value='';$('#budgetModalTitle').textContent='Novo Orçamento';
    const today=new Date(),valid=new Date();valid.setDate(valid.getDate()+15);
    $('#oData').value=today.toISOString().slice(0,10);$('#oValidade').value=valid.toISOString().slice(0,10);openModal('budgetModal');
  }
  $('#addBudget')?.addEventListener('click',newBudget);
  $('#budgetForm')?.addEventListener('submit',async e=>{
    e.preventDefault();const id=$('#budgetId').value;
    const obj={cliente:$('#oCliente').value.trim(),telefone:$('#oTelefone').value.trim(),endereco:$('#oEndereco').value.trim(),email:$('#oEmail').value.trim(),status:$('#oStatus').value,data_orcamento:$('#oData').value,validade:$('#oValidade').value||null,tipo_servico:$('#oTipoServico').value,local_pintura:$('#oLocalPintura').value,descricao:$('#oDescricao').value.trim(),valor:Number($('#oValor').value),condicao_pagamento:$('#oPagamento').value.trim(),observacao:$('#oObservacao').value.trim()};
    try{await request('/orcamentos'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal('budgetModal');await loadAll();toast('Orçamento salvo com sucesso!')}catch(err){toast(err.message)}
  });
  $('#serviceForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#serviceId').value,obj={cliente:$('#sCliente').value.trim(),telefone:$('#sTelefone').value.trim(),endereco:$('#sEndereco').value.trim(),imovel:$('#sImovel').value,tipo:$('#sTipo').value,inicio:$('#sInicio').value||null,fim:$('#sFim').value||null,valor:Number($('#sValor').value),status:$('#sStatus').value,orcamento:$('#sOrcamento').value.trim(),obs:$('#sObs').value.trim()};try{await request('/servicos'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal('serviceModal');await loadAll();toast('Serviço salvo com sucesso!')}catch(err){toast(err.message)}});
  $('#clientForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#clientId').value,obj={nome:$('#cNome').value.trim(),telefone:$('#cTelefone').value.trim(),endereco:$('#cEndereco').value.trim(),tipo:$('#cTipo').value,email:$('#cEmail').value.trim(),obs:$('#cObs').value.trim()};try{await request('/clientes'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal('clientModal');await loadAll();toast('Cliente salvo com sucesso!')}catch(err){toast(err.message)}});
  window.editService=id=>{const x=services.find(v=>Number(v.id)===Number(id));if(!x)return;$('#serviceId').value=x.id;$('#sCliente').value=x.cliente;$('#sTelefone').value=x.telefone||'';$('#sEndereco').value=x.endereco;$('#sImovel').value=x.imovel;$('#sTipo').value=x.tipo;$('#sInicio').value=x.inicio?String(x.inicio).slice(0,10):'';$('#sFim').value=x.fim?String(x.fim).slice(0,10):'';$('#sValor').value=x.valor;$('#sStatus').value=x.status;$('#sOrcamento').value=x.orcamento||'';$('#sObs').value=x.obs||'';$('#serviceModalTitle').textContent='Editar Serviço #'+x.id;openModal('serviceModal')};
  window.deleteService=async id=>{if(confirm('Deseja realmente excluir este serviço?'))try{await request('/servicos/'+id,{method:'DELETE'});await loadAll();toast('Serviço excluído.')}catch(e){toast(e.message)}};
  window.editClient=id=>{const x=clients.find(v=>Number(v.id)===Number(id));if(!x)return;$('#clientId').value=x.id;$('#cNome').value=x.nome;$('#cTelefone').value=x.telefone||'';$('#cEndereco').value=x.endereco;$('#cTipo').value=x.tipo;$('#cEmail').value=x.email||'';$('#cObs').value=x.obs||'';$('#clientModalTitle').textContent='Editar Cliente';openModal('clientModal')};
  window.editBudget=id=>{const x=budgets.find(v=>Number(v.id)===Number(id));if(!x)return;$('#budgetId').value=x.id;$('#oCliente').value=x.cliente||'';$('#oTelefone').value=x.telefone||'';$('#oEndereco').value=x.endereco||'';$('#oEmail').value=x.email||'';$('#oStatus').value=x.status||'Em elaboração';$('#oData').value=x.data_orcamento?String(x.data_orcamento).slice(0,10):'';$('#oValidade').value=x.validade?String(x.validade).slice(0,10):'';$('#oTipoServico').value=x.tipo_servico||'';$('#oLocalPintura').value=x.local_pintura||'';$('#oDescricao').value=x.descricao||'';$('#oValor').value=x.valor||0;$('#oPagamento').value=x.condicao_pagamento||'';$('#oObservacao').value=x.observacao||'';$('#budgetModalTitle').textContent='Editar Orçamento #'+x.id;openModal('budgetModal')};
  window.deleteBudget=async id=>{if(confirm('Deseja realmente excluir este orçamento?'))try{await request('/orcamentos/'+id,{method:'DELETE'});await loadAll();toast('Orçamento excluído.')}catch(e){toast(e.message)}};
  window.downloadBudgetPdf=id=>{window.open(API+'/orcamentos/'+id+'/pdf','_blank','noopener')};
  window.emailBudget=id=>{const x=budgets.find(v=>Number(v.id)===Number(id));if(!x)return;const subject=encodeURIComponent('Orçamento de pintura #'+x.id+' - Johnson Pinturas');const body=encodeURIComponent('Olá, '+x.cliente+'!\n\nSegue o orçamento de pintura solicitado.\n\nValor total: '+money(x.valor)+'\nValidade: '+dateBR(x.validade)+'\n\nAtenciosamente,\nJohnson Pinturas');window.location.href='mailto:'+encodeURIComponent(x.email||'')+'?subject='+subject+'&body='+body;toast('Anexe ao e-mail o PDF baixado do orçamento.')};
  window.deleteClient=async id=>{if(confirm('Deseja realmente excluir este cliente?'))try{await request('/clientes/'+id,{method:'DELETE'});await loadAll();toast('Cliente excluído.')}catch(e){toast(e.message)}};
  checkAuth();
})();
