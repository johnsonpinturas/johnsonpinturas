require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao configurada.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10 });
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
const asyncRoute = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const required = (obj, fields) => fields.filter(f => obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '');

app.get('/api/health', asyncRoute(async (req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',database:'connected'});}));
app.get('/api/clientes', asyncRoute(async (req,res)=>{const {rows}=await pool.query(`SELECT id,nome,telefone,email,endereco,tipo_cliente AS tipo,observacoes AS obs,criado_em FROM clientes ORDER BY nome`);res.json(rows);}));
app.post('/api/clientes', asyncRoute(async (req,res)=>{const b=req.body,missing=required(b,['nome','endereco']);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});const {rows}=await pool.query(`INSERT INTO clientes(nome,telefone,email,endereco,tipo_cliente,observacoes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[b.nome,b.telefone||null,b.email||null,b.endereco,b.tipo||'Pessoa física',b.obs||null]);res.status(201).json(rows[0]);}));
app.put('/api/clientes/:id', asyncRoute(async (req,res)=>{const b=req.body,missing=required(b,['nome','endereco']);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});const r=await pool.query(`UPDATE clientes SET nome=$1,telefone=$2,email=$3,endereco=$4,tipo_cliente=$5,observacoes=$6,atualizado_em=NOW() WHERE id=$7`,[b.nome,b.telefone||null,b.email||null,b.endereco,b.tipo||'Pessoa física',b.obs||null,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Cliente nao encontrado'});res.json({ok:true});}));
app.delete('/api/clientes/:id', asyncRoute(async (req,res)=>{const r=await pool.query('DELETE FROM clientes WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Cliente nao encontrado'});res.status(204).end();}));

app.get('/api/servicos', asyncRoute(async (req,res)=>{const {rows}=await pool.query(`SELECT id,cliente_id,nome_cliente AS cliente,telefone,endereco,tipo_imovel AS imovel,tipo_servico AS tipo,data_inicio AS inicio,data_conclusao_prevista AS fim,valor_total AS valor,status,orcamento,observacoes AS obs,criado_em FROM servicos ORDER BY criado_em DESC`);res.json(rows);}));
async function saveService(req,res,update=false){const b=req.body,missing=required(b,['cliente','endereco','imovel','tipo','valor','status']);if(missing.length)return res.status(400).json({error:'Campos obrigatorios: '+missing.join(', ')});let clienteId=null;const found=await pool.query('SELECT id FROM clientes WHERE LOWER(nome)=LOWER($1) LIMIT 1',[b.cliente]);if(found.rows[0])clienteId=found.rows[0].id;else{const c=await pool.query(`INSERT INTO clientes(nome,telefone,endereco,tipo_cliente) VALUES($1,$2,$3,'Pessoa física') RETURNING id`,[b.cliente,b.telefone||null,b.endereco]);clienteId=c.rows[0].id;}
const vals=[clienteId,b.cliente,b.telefone||null,b.endereco,b.imovel,b.tipo,b.inicio||null,b.fim||null,Number(b.valor),b.status,b.orcamento||null,b.obs||null];
if(update){vals.push(req.params.id);const r=await pool.query(`UPDATE servicos SET cliente_id=$1,nome_cliente=$2,telefone=$3,endereco=$4,tipo_imovel=$5,tipo_servico=$6,data_inicio=$7,data_conclusao_prevista=$8,valor_total=$9,status=$10,orcamento=$11,observacoes=$12,atualizado_em=NOW() WHERE id=$13`,vals);if(!r.rowCount)return res.status(404).json({error:'Servico nao encontrado'});return res.json({ok:true});}
const {rows}=await pool.query(`INSERT INTO servicos(cliente_id,nome_cliente,telefone,endereco,tipo_imovel,tipo_servico,data_inicio,data_conclusao_prevista,valor_total,status,orcamento,observacoes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,vals);res.status(201).json(rows[0]);}
app.post('/api/servicos',asyncRoute((req,res)=>saveService(req,res,false)));
app.put('/api/servicos/:id',asyncRoute((req,res)=>saveService(req,res,true)));
app.delete('/api/servicos/:id',asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM servicos WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Servico nao encontrado'});res.status(204).end();}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Erro interno. Verifique a conexao com o banco.'});});
const port=process.env.PORT||3000;
app.listen(port,'0.0.0.0',()=>console.log(`Johnson Pinturas ativo na porta ${port}`));
