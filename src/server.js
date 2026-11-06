require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao configurada.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10 });
const app = express();
const asyncRoute = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
if (!ADMIN_USER || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('ADMIN_USER, ADMIN_PASSWORD e JWT_SECRET devem ser configurados.');
  process.exit(1);
}
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(item => { const i=item.indexOf('='); return [decodeURIComponent(item.slice(0,i).trim()), decodeURIComponent(item.slice(i+1).trim())]; }));
const authRequired = (req,res,next) => {
  try { req.admin=jwt.verify(parseCookies(req).admin_token,JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Sessão expirada. Faça login novamente.'}); }
};
app.post('/api/auth/login', asyncRoute(async (req,res) => {
  const usuario=String(req.body.usuario||'').trim();
  const senha=String(req.body.senha||'');
  const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length && crypto.timingSafeEqual(x,y)};
  const validUser=safeEqual(usuario,ADMIN_USER);
  const validPassword=validUser && safeEqual(senha,ADMIN_PASSWORD);
  if(!validPassword) return res.status(401).json({error:'Usuário ou senha inválidos.'});
  const token=jwt.sign({usuario,role:'admin'},JWT_SECRET,{expiresIn:'8h'});
  res.setHeader('Set-Cookie',`admin_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=28800; SameSite=Strict${process.env.NODE_ENV==='production'?'; Secure':''}`);
  res.json({ok:true,usuario});
}));
app.get('/api/auth/me',(req,res)=>{try{const admin=jwt.verify(parseCookies(req).admin_token,JWT_SECRET);res.json({authenticated:true,usuario:admin.usuario});}catch{res.status(401).json({authenticated:false});}});
app.post('/api/auth/logout',(req,res)=>{res.setHeader('Set-Cookie',`admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${process.env.NODE_ENV==='production'?'; Secure':''}`);res.json({ok:true});});
app.use('/api/clientes',authRequired);
app.use('/api/servicos',authRequired);
  app.use('/api/orcamentos',authRequired);
  app.use('/api/terceiros',authRequired);
  app.use('/api/contratacoes-terceiros',authRequired);
app.use(express.static(path.join(__dirname, '..', 'public')));

async function ensureBudgetTable(){
  await pool.query(`CREATE TABLE IF NOT EXISTS orcamentos (
    id SERIAL PRIMARY KEY, cliente VARCHAR(180) NOT NULL, endereco TEXT NOT NULL,
    telefone VARCHAR(40), email VARCHAR(180) NOT NULL, tipo_servico VARCHAR(120) NOT NULL,
    local_pintura VARCHAR(120) NOT NULL, descricao TEXT, valor NUMERIC(12,2) NOT NULL CHECK(valor >= 0),
    condicao_pagamento TEXT, observacao TEXT, status VARCHAR(40) NOT NULL DEFAULT 'Em elaboração',
    data_orcamento DATE NOT NULL DEFAULT CURRENT_DATE, validade DATE, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS materiais JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS mao_obra NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS desconto NUMERIC(12,2) NOT NULL DEFAULT 0`);
}

  async function ensureThirdPartyTables(){
    await pool.query(`CREATE TABLE IF NOT EXISTS terceiros (id SERIAL PRIMARY KEY,nome VARCHAR(180) NOT NULL,cpf_cnpj VARCHAR(30),telefone VARCHAR(40),especialidade VARCHAR(120) NOT NULL,tipo_pix VARCHAR(30),chave_pix VARCHAR(180),observacoes TEXT,ativo BOOLEAN NOT NULL DEFAULT TRUE,criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS servico_terceiros (id SERIAL PRIMARY KEY,servico_id INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,terceiro_id INTEGER NOT NULL REFERENCES terceiros(id) ON DELETE RESTRICT,atividade TEXT NOT NULL,tipo_calculo VARCHAR(40) NOT NULL,quantidade NUMERIC(12,2) NOT NULL DEFAULT 1,valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,adicional NUMERIC(12,2) NOT NULL DEFAULT 0,desconto NUMERIC(12,2) NOT NULL DEFAULT 0,valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,data_inicio DATE,data_conclusao DATE,status_execucao VARCHAR(40) NOT NULL DEFAULT 'Aguardando execução',vencimento DATE,status_pagamento VARCHAR(40) NOT NULL DEFAULT 'Aguardando pagamento',data_pagamento DATE,forma_pagamento VARCHAR(40),transacao VARCHAR(180),comprovante_nome VARCHAR(255),comprovante_tipo VARCHAR(100),comprovante_base64 TEXT,observacoes TEXT,criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  }
  const required = (obj, fields) => fields.filter(f => obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '');

app.get('/api/health', asyncRoute(async (req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',database:'connected'});}));
app.get('/api/clientes', asyncRoute(async (req,res)=>{const {rows}=await pool.query(`SELECT id,nome,telefone,email,endereco,tipo_cliente AS tipo,observacoes AS obs,criado_em FROM clientes ORDER BY nome`);res.json(rows);}));
app.post('/api/clientes', asyncRoute(async (req,res)=>{const b=req.body,missing=required(b,['nome','endereco']);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});const {rows}=await pool.query(`INSERT INTO clientes(nome,telefone,email,endereco,tipo_cliente,observacoes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[b.nome,b.telefone||null,b.email||null,b.endereco,b.tipo||'Pessoa física',b.obs||null]);res.status(201).json(rows[0]);}));
app.put('/api/clientes/:id', asyncRoute(async (req,res)=>{const b=req.body,missing=required(b,['nome','endereco']);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});const r=await pool.query(`UPDATE clientes SET nome=$1,telefone=$2,email=$3,endereco=$4,tipo_cliente=$5,observacoes=$6,atualizado_em=NOW() WHERE id=$7`,[b.nome,b.telefone||null,b.email||null,b.endereco,b.tipo||'Pessoa física',b.obs||null,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Cliente nao encontrado'});res.json({ok:true});}));
app.delete('/api/clientes/:id', asyncRoute(async (req,res)=>{const r=await pool.query('DELETE FROM clientes WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Cliente nao encontrado'});res.status(204).end();}));

app.get('/api/servicos', asyncRoute(async (req,res)=>{const {rows}=await pool.query(`SELECT id,cliente_id,nome_cliente AS cliente,telefone,endereco,tipo_imovel AS imovel,tipo_servico AS tipo,data_inicio AS inicio,data_conclusao_prevista AS fim,valor_total AS valor,status,orcamento,observacoes AS obs,criado_em FROM servicos ORDER BY criado_em DESC`);res.json(rows);}));
app.get('/api/servicos/exportar.xlsx', asyncRoute(async (req,res)=>{
  const params=[]; const where=[];
  if(req.query.status){params.push(req.query.status);where.push(`status = $${params.length}`);}
  if(req.query.q){params.push(`%${req.query.q}%`);where.push(`(nome_cliente ILIKE $${params.length} OR tipo_servico ILIKE $${params.length} OR endereco ILIKE $${params.length})`);}
  const sql=`SELECT id,nome_cliente,telefone,endereco,tipo_imovel,tipo_servico,data_inicio,data_conclusao_prevista,valor_total,status,orcamento,observacoes,criado_em FROM servicos ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY criado_em DESC`;
  const {rows}=await pool.query(sql,params);
  const workbook=new ExcelJS.Workbook(); workbook.creator='Johnson Pintura'; workbook.created=new Date();
  const sheet=workbook.addWorksheet('Serviços',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[
    {header:'Código',key:'id',width:12},{header:'Cliente',key:'nome_cliente',width:28},{header:'Telefone',key:'telefone',width:18},
    {header:'Endereço',key:'endereco',width:38},{header:'Tipo de imóvel',key:'tipo_imovel',width:20},{header:'Tipo de serviço',key:'tipo_servico',width:24},
    {header:'Data de início',key:'data_inicio',width:17},{header:'Conclusão prevista',key:'data_conclusao_prevista',width:20},
    {header:'Valor total',key:'valor_total',width:16},{header:'Status',key:'status',width:22},{header:'Orçamento',key:'orcamento',width:35},
    {header:'Observações',key:'observacoes',width:35},{header:'Cadastrado em',key:'criado_em',width:20}
  ];
  rows.forEach(r=>sheet.addRow({...r,valor_total:Number(r.valor_total),data_inicio:r.data_inicio?new Date(r.data_inicio):null,data_conclusao_prevista:r.data_conclusao_prevista?new Date(r.data_conclusao_prevista):null,criado_em:r.criado_em?new Date(r.criado_em):null}));
  const header=sheet.getRow(1);header.font={bold:true,color:{argb:'FFFFFFFF'}};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17253A'}};header.alignment={vertical:'middle',horizontal:'center'};header.height=24;
  sheet.autoFilter={from:'A1',to:'M1'};sheet.getColumn('valor_total').numFmt='R$ #,##0.00';
  ['data_inicio','data_conclusao_prevista'].forEach(c=>sheet.getColumn(c).numFmt='dd/mm/yyyy');sheet.getColumn('criado_em').numFmt='dd/mm/yyyy hh:mm';
  sheet.eachRow((row,n)=>{if(n>1){row.alignment={vertical:'top',wrapText:true};if(n%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F6F9'}};}});
  const filename=`servicos-johnson-pintura-${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);res.end();
}));
async function saveService(req,res,update=false){const b=req.body,missing=required(b,['cliente','endereco','imovel','tipo','valor','status']);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});let clienteId=null;const found=await pool.query('SELECT id FROM clientes WHERE LOWER(nome)=LOWER($1) LIMIT 1',[b.cliente]);if(found.rows[0])clienteId=found.rows[0].id;else{const c=await pool.query(`INSERT INTO clientes(nome,telefone,endereco,tipo_cliente) VALUES($1,$2,$3,'Pessoa física') RETURNING id`,[b.cliente,b.telefone||null,b.endereco]);clienteId=c.rows[0].id;}
const vals=[clienteId,b.cliente,b.telefone||null,b.endereco,b.imovel,b.tipo,b.inicio||null,b.fim||null,Number(b.valor),b.status,b.orcamento||null,b.obs||null];
if(update){vals.push(req.params.id);const r=await pool.query(`UPDATE servicos SET cliente_id=$1,nome_cliente=$2,telefone=$3,endereco=$4,tipo_imovel=$5,tipo_servico=$6,data_inicio=$7,data_conclusao_prevista=$8,valor_total=$9,status=$10,orcamento=$11,observacoes=$12,atualizado_em=NOW() WHERE id=$13`,vals);if(!r.rowCount)return res.status(404).json({error:'Servico nao encontrado'});return res.json({ok:true});}
const {rows}=await pool.query(`INSERT INTO servicos(cliente_id,nome_cliente,telefone,endereco,tipo_imovel,tipo_servico,data_inicio,data_conclusao_prevista,valor_total,status,orcamento,observacoes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,vals);res.status(201).json(rows[0]);}
app.post('/api/servicos',asyncRoute((req,res)=>saveService(req,res,false)));
app.put('/api/servicos/:id',asyncRoute((req,res)=>saveService(req,res,true)));
app.delete('/api/servicos/:id',asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM servicos WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Servico nao encontrado'});res.status(204).end();}));

const budgetFields=['cliente','endereco','email','tipo_servico','local_pintura','valor','status','data_orcamento'];
app.get('/api/orcamentos',asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT * FROM orcamentos ORDER BY criado_em DESC');res.json(rows);}));
async function saveBudget(req,res,update=false){
  const b=req.body,missing=required(b,budgetFields);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});
  const allowed=['Em elaboração','Enviado','Aprovado','Recusado','Vencido'];if(!allowed.includes(b.status))return res.status(400).json({error:'Status do orçamento inválido.'});
  const materials=Array.isArray(b.materiais)?b.materiais.map(m=>({descricao:String(m.descricao||'').trim(),marca:String(m.marca||'').trim(),unidade:String(m.unidade||'Unidade').trim(),quantidade:Number(m.quantidade),valor_unitario:Number(m.valor_unitario)})).filter(m=>m.descricao):[];
  if(materials.some(m=>!Number.isFinite(m.quantidade)||m.quantidade<=0||!Number.isFinite(m.valor_unitario)||m.valor_unitario<0))return res.status(400).json({error:'Verifique a quantidade e o valor dos materiais.'});
  const labor=Number(b.mao_obra||0),discount=Number(b.desconto||0),materialTotal=materials.reduce((a,m)=>a+m.quantidade*m.valor_unitario,0),value=Math.max(0,materialTotal+labor-discount);
  if(!Number.isFinite(labor)||labor<0||!Number.isFinite(discount)||discount<0)return res.status(400).json({error:'Mão de obra ou desconto inválido.'});
  const vals=[b.cliente,b.endereco,b.telefone||null,b.email,b.tipo_servico,b.local_pintura,b.descricao||null,value,b.condicao_pagamento||null,b.observacao||null,b.status,b.data_orcamento,b.validade||null,JSON.stringify(materials),labor,discount];
  if(update){vals.push(req.params.id);const r=await pool.query(`UPDATE orcamentos SET cliente=$1,endereco=$2,telefone=$3,email=$4,tipo_servico=$5,local_pintura=$6,descricao=$7,valor=$8,condicao_pagamento=$9,observacao=$10,status=$11,data_orcamento=$12,validade=$13,materiais=$14::jsonb,mao_obra=$15,desconto=$16,atualizado_em=NOW() WHERE id=$17`,vals);if(!r.rowCount)return res.status(404).json({error:'Orçamento não encontrado.'});return res.json({ok:true});}
  const {rows}=await pool.query(`INSERT INTO orcamentos(cliente,endereco,telefone,email,tipo_servico,local_pintura,descricao,valor,condicao_pagamento,observacao,status,data_orcamento,validade,materiais,mao_obra,desconto) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) RETURNING id`,vals);res.status(201).json(rows[0]);
}
app.post('/api/orcamentos',asyncRoute((req,res)=>saveBudget(req,res)));
app.put('/api/orcamentos/:id',asyncRoute((req,res)=>saveBudget(req,res,true)));
app.delete('/api/orcamentos/:id',asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM orcamentos WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Orçamento não encontrado.'});res.status(204).end();}));
app.get('/api/orcamentos/:id/pdf',asyncRoute(async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM orcamentos WHERE id=$1',[req.params.id]);const o=rows[0];if(!o)return res.status(404).json({error:'Orçamento não encontrado.'});
  const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});const dt=v=>v?new Date(v).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'Não informada';
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="orcamento-johnson-${o.id}.pdf"`);
  const doc=new PDFDocument({size:'A4',margin:48,info:{Title:`Orçamento #${o.id} - Johnson Pinturas`,Author:'Johnson Pinturas'}});doc.pipe(res);
  doc.rect(0,0,595,105).fill('#17253A');doc.fillColor('#FFFFFF').fontSize(24).text('JOHNSON PINTURAS',48,35).fontSize(11).text('Orçamento de serviços de pintura',48,68);
  doc.fillColor('#17253A').fontSize(16).text(`ORÇAMENTO Nº ${o.id}`,48,132);doc.fontSize(10).fillColor('#475569').text(`Data: ${dt(o.data_orcamento)}   |   Validade: ${dt(o.validade)}   |   Status: ${o.status}`,48,158);
  doc.moveTo(48,184).lineTo(547,184).strokeColor('#CBD5E1').stroke();doc.fillColor('#17253A').fontSize(13).text('DADOS DO CLIENTE',48,202);
  doc.fontSize(10).fillColor('#334155').text(`Cliente: ${o.cliente}`,48,228).text(`Endereço: ${o.endereco}`,48,245,{width:499}).text(`Telefone: ${o.telefone||'Não informado'}`,48,276).text(`E-mail: ${o.email}`,285,276);
  doc.fillColor('#17253A').fontSize(13).text('DETALHES DO SERVIÇO',48,309);doc.fontSize(10).fillColor('#334155').text(`Tipo de serviço: ${o.tipo_servico}`,48,335).text(`Local da pintura: ${o.local_pintura}`,285,335).text('Descrição:',48,360).text(o.descricao||'Não informada.',48,377,{width:499});
  let y=Math.max(doc.y+20,430);const materials=Array.isArray(o.materiais)?o.materiais:[];
  if(materials.length){doc.fillColor('#17253A').fontSize(13).text('MATERIAIS',48,y);y+=22;doc.fontSize(9).fillColor('#475569').text('Material / Marca',48,y).text('Qtd.',330,y).text('Unitário',390,y).text('Total',475,y);y+=15;doc.moveTo(48,y).lineTo(547,y).strokeColor('#CBD5E1').stroke();y+=7;for(const m of materials){if(y>690){doc.addPage();y=55;}const total=Number(m.quantidade||0)*Number(m.valor_unitario||0);doc.fillColor('#334155').fontSize(9).text(`${m.descricao}${m.marca?' • '+m.marca:''}`,48,y,{width:270}).text(`${m.quantidade} ${m.unidade||''}`,330,y,{width:55}).text(brl(m.valor_unitario),390,y,{width:75}).text(brl(total),475,y,{width:72,align:'right'});y=Math.max(doc.y+8,y+18);}}
  const materialTotal=materials.reduce((a,m)=>a+Number(m.quantidade||0)*Number(m.valor_unitario||0),0);if(y>650){doc.addPage();y=55;}doc.roundedRect(48,y,499,86,8).fill('#F1F5F9');doc.fillColor('#475569').fontSize(9).text(`Materiais: ${brl(materialTotal)}`,65,y+12).text(`Mão de obra: ${brl(o.mao_obra)}`,65,y+29).text(`Desconto: ${brl(o.desconto)}`,285,y+29).fillColor('#15803D').fontSize(18).text(`TOTAL: ${brl(o.valor)}`,65,y+51);
  y+=105;doc.fillColor('#17253A').fontSize(12).text('Condição de pagamento',48,y).fontSize(10).fillColor('#334155').text(o.condicao_pagamento||'A combinar.',48,y+20,{width:499});y=doc.y+18;doc.fillColor('#17253A').fontSize(12).text('Observações',48,y).fontSize(10).fillColor('#334155').text(o.observacao||'Nenhuma observação adicional.',48,y+20,{width:499});
  doc.fontSize(9).fillColor('#64748B').text('Johnson Pinturas • Criado por Cristiane Sanchez da Silva de Jesus',48,780,{width:499,align:'center'});doc.end();
}));


  app.get('/api/terceiros',asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT * FROM terceiros ORDER BY ativo DESC,nome');res.json(rows);}));
  app.post('/api/terceiros',asyncRoute(async(req,res)=>{const b=req.body,missing=required(b,['nome','especialidade']);if(missing.length)return res.status(400).json({error:'Informe nome e especialidade.'});const {rows}=await pool.query(`INSERT INTO terceiros(nome,cpf_cnpj,telefone,especialidade,tipo_pix,chave_pix,observacoes,ativo) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[b.nome,b.cpf_cnpj||null,b.telefone||null,b.especialidade,b.tipo_pix||null,b.chave_pix||null,b.observacoes||null,b.ativo!==false]);res.status(201).json(rows[0]);}));
  app.put('/api/terceiros/:id',asyncRoute(async(req,res)=>{const b=req.body;const r=await pool.query(`UPDATE terceiros SET nome=$1,cpf_cnpj=$2,telefone=$3,especialidade=$4,tipo_pix=$5,chave_pix=$6,observacoes=$7,ativo=$8,atualizado_em=NOW() WHERE id=$9`,[b.nome,b.cpf_cnpj||null,b.telefone||null,b.especialidade,b.tipo_pix||null,b.chave_pix||null,b.observacoes||null,b.ativo!==false,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Profissional não encontrado.'});res.json({ok:true});}));
  app.delete('/api/terceiros/:id',asyncRoute(async(req,res)=>{try{const r=await pool.query('DELETE FROM terceiros WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Profissional não encontrado.'});res.status(204).end();}catch(e){if(e.code==='23503')return res.status(409).json({error:'Este profissional possui contratações. Marque-o como inativo.'});throw e;}}));
  const thirdJobSelect=`SELECT st.*,t.nome AS terceiro_nome,t.cpf_cnpj,t.telefone AS terceiro_telefone,t.especialidade,t.chave_pix,s.nome_cliente AS cliente,s.tipo_servico,s.valor_total AS servico_valor FROM servico_terceiros st JOIN terceiros t ON t.id=st.terceiro_id JOIN servicos s ON s.id=st.servico_id`;
  app.get('/api/contratacoes-terceiros',asyncRoute(async(req,res)=>{const {rows}=await pool.query(thirdJobSelect+' ORDER BY st.criado_em DESC');res.json(rows);}));
  function thirdJobValues(b){const serviceValue=Number(b.servico_valor||0),q=Number(b.quantidade||0),unit=Number(b.valor_unitario||0),add=Number(b.adicional||0),disc=Number(b.desconto||0);const base=b.tipo_calculo==='Percentual do serviço'?serviceValue*q/100:q*unit;return {total:Math.max(0,base+add-disc),q,unit,add,disc};}
  async function saveThirdJob(req,res,update=false){const b=req.body,missing=required(b,['servico_id','terceiro_id','atividade','tipo_calculo']);if(missing.length)return res.status(400).json({error:'Preencha profissional, serviço, atividade e contratação.'});const sr=await pool.query('SELECT valor_total FROM servicos WHERE id=$1',[b.servico_id]);if(!sr.rows[0])return res.status(400).json({error:'Serviço não encontrado.'});b.servico_valor=sr.rows[0].valor_total;const c=thirdJobValues(b);if(![c.q,c.unit,c.add,c.disc,c.total].every(Number.isFinite)||c.q<0||c.unit<0||c.add<0||c.disc<0)return res.status(400).json({error:'Valores da contratação inválidos.'});if(b.comprovante_base64&&String(b.comprovante_base64).length>950000)return res.status(400).json({error:'Comprovante acima do limite de 700 KB.'});const vals=[b.servico_id,b.terceiro_id,b.atividade,b.tipo_calculo,c.q,c.unit,c.add,c.disc,c.total,b.data_inicio||null,b.data_conclusao||null,b.status_execucao||'Aguardando execução',b.vencimento||null,b.status_pagamento||'Aguardando pagamento',b.data_pagamento||null,b.forma_pagamento||null,b.transacao||null,b.comprovante_nome||null,b.comprovante_tipo||null,b.comprovante_base64||null,b.observacoes||null];if(update){vals.push(req.params.id);const r=await pool.query(`UPDATE servico_terceiros SET servico_id=$1,terceiro_id=$2,atividade=$3,tipo_calculo=$4,quantidade=$5,valor_unitario=$6,adicional=$7,desconto=$8,valor_total=$9,data_inicio=$10,data_conclusao=$11,status_execucao=$12,vencimento=$13,status_pagamento=$14,data_pagamento=$15,forma_pagamento=$16,transacao=$17,comprovante_nome=COALESCE($18,comprovante_nome),comprovante_tipo=COALESCE($19,comprovante_tipo),comprovante_base64=COALESCE($20,comprovante_base64),observacoes=$21,atualizado_em=NOW() WHERE id=$22`,vals);if(!r.rowCount)return res.status(404).json({error:'Contratação não encontrada.'});return res.json({ok:true});}const {rows}=await pool.query(`INSERT INTO servico_terceiros(servico_id,terceiro_id,atividade,tipo_calculo,quantidade,valor_unitario,adicional,desconto,valor_total,data_inicio,data_conclusao,status_execucao,vencimento,status_pagamento,data_pagamento,forma_pagamento,transacao,comprovante_nome,comprovante_tipo,comprovante_base64,observacoes) VALUES(${vals.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,vals);res.status(201).json(rows[0]);}
  app.post('/api/contratacoes-terceiros',asyncRoute((req,res)=>saveThirdJob(req,res)));
  app.put('/api/contratacoes-terceiros/:id',asyncRoute((req,res)=>saveThirdJob(req,res,true)));
  app.delete('/api/contratacoes-terceiros/:id',asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM servico_terceiros WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Contratação não encontrada.'});res.status(204).end();}));
  app.get('/api/contratacoes-terceiros/:id/comprovante',asyncRoute(async(req,res)=>{const {rows}=await pool.query('SELECT comprovante_nome,comprovante_tipo,comprovante_base64 FROM servico_terceiros WHERE id=$1',[req.params.id]);const x=rows[0];if(!x||!x.comprovante_base64)return res.status(404).json({error:'Comprovante não encontrado.'});res.setHeader('Content-Type',x.comprovante_tipo||'application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="${String(x.comprovante_nome||'comprovante').replace(/"/g,'')}"`);res.end(Buffer.from(String(x.comprovante_base64).split(',').pop(),'base64'));}));
  app.get('/api/contratacoes-terceiros/:id/recibo.pdf',asyncRoute(async(req,res)=>{const {rows}=await pool.query(thirdJobSelect+' WHERE st.id=$1',[req.params.id]);const x=rows[0];if(!x)return res.status(404).json({error:'Contratação não encontrada.'});const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),dt=v=>v?new Date(v).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'Não informada';res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="recibo-terceiro-${x.id}.pdf"`);const doc=new PDFDocument({size:'A4',margin:55});doc.pipe(res);doc.rect(0,0,595,100).fill('#17253A');doc.fillColor('#fff').fontSize(24).text('JOHNSON PINTURAS',55,34).fontSize(11).text('Recibo de pagamento de profissional terceiro',55,67);doc.fillColor('#17253A').fontSize(18).text(`RECIBO Nº ${x.id}`,55,135,{align:'center'});doc.fontSize(11).fillColor('#334155').text(`Recebi da Johnson Pinturas a importância de ${brl(x.valor_total)}, referente à atividade “${x.atividade}”, vinculada ao serviço ${x.tipo_servico} do cliente ${x.cliente}.`,55,185,{width:485,align:'justify',lineGap:5});doc.moveDown(2).text(`Profissional: ${x.terceiro_nome}`).text(`CPF/CNPJ: ${x.cpf_cnpj||'Não informado'}`).text(`Período: ${dt(x.data_inicio)} a ${dt(x.data_conclusao)}`).text(`Forma de pagamento: ${x.forma_pagamento||'Não informada'}`).text(`Data do pagamento: ${dt(x.data_pagamento)}`).text(`Identificação da transação: ${x.transacao||'Não informada'}`);doc.text('________________________________________',105,575).text(x.terceiro_nome,105,595,{width:385,align:'center'}).text('Assinatura do profissional',105,612,{width:385,align:'center'});doc.fontSize(9).fillColor('#64748B').text('Johnson Pinturas • Criado por Cristiane Sanchez da Silva de Jesus',55,760,{width:485,align:'center'});doc.end();}));

  app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Erro interno. Verifique a conexao com o banco.'});});
const port=process.env.PORT||3000;
  Promise.all([ensureBudgetTable(),ensureThirdPartyTables()]).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Johnson Pinturas ativo na porta ${port}`))).catch(err=>{console.error('Falha ao preparar banco:',err);process.exit(1);});
