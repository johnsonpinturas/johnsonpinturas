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
  const value=Number(b.valor);if(!Number.isFinite(value)||value<0)return res.status(400).json({error:'Valor do orçamento inválido.'});
  const vals=[b.cliente,b.endereco,b.telefone||null,b.email,b.tipo_servico,b.local_pintura,b.descricao||null,value,b.condicao_pagamento||null,b.observacao||null,b.status,b.data_orcamento,b.validade||null];
  if(update){vals.push(req.params.id);const r=await pool.query(`UPDATE orcamentos SET cliente=$1,endereco=$2,telefone=$3,email=$4,tipo_servico=$5,local_pintura=$6,descricao=$7,valor=$8,condicao_pagamento=$9,observacao=$10,status=$11,data_orcamento=$12,validade=$13,atualizado_em=NOW() WHERE id=$14`,vals);if(!r.rowCount)return res.status(404).json({error:'Orçamento não encontrado.'});return res.json({ok:true});}
  const {rows}=await pool.query(`INSERT INTO orcamentos(cliente,endereco,telefone,email,tipo_servico,local_pintura,descricao,valor,condicao_pagamento,observacao,status,data_orcamento,validade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,vals);res.status(201).json(rows[0]);
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
  let y=Math.max(doc.y+20,440);doc.roundedRect(48,y,499,58,8).fill('#F1F5F9');doc.fillColor('#475569').fontSize(10).text('VALOR TOTAL DO SERVIÇO',65,y+13).fillColor('#15803D').fontSize(20).text(brl(o.valor),65,y+29);
  y+=82;doc.fillColor('#17253A').fontSize(12).text('Condição de pagamento',48,y).fontSize(10).fillColor('#334155').text(o.condicao_pagamento||'A combinar.',48,y+20,{width:499});y=doc.y+18;doc.fillColor('#17253A').fontSize(12).text('Observações',48,y).fontSize(10).fillColor('#334155').text(o.observacao||'Nenhuma observação adicional.',48,y+20,{width:499});
  doc.fontSize(9).fillColor('#64748B').text('Johnson Pinturas • Criado por Cristiane Sanchez da Silva de Jesus',48,780,{width:499,align:'center'});doc.end();
}));

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Erro interno. Verifique a conexao com o banco.'});});
const port=process.env.PORT||3000;
ensureBudgetTable().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Johnson Pinturas ativo na porta ${port}`))).catch(err=>{console.error('Falha ao preparar banco:',err);process.exit(1);});
