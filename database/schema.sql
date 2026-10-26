CREATE TABLE IF NOT EXISTS clientes (
  id BIGSERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  telefone VARCHAR(30),
  email VARCHAR(150),
  endereco TEXT NOT NULL,
  tipo_cliente VARCHAR(50) NOT NULL DEFAULT 'Pessoa física',
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS servicos (
  id BIGSERIAL PRIMARY KEY,
  cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
  nome_cliente VARCHAR(150) NOT NULL,
  telefone VARCHAR(30),
  endereco TEXT NOT NULL,
  tipo_imovel VARCHAR(50) NOT NULL,
  tipo_servico VARCHAR(100) NOT NULL,
  data_inicio DATE,
  data_conclusao_prevista DATE,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
  status VARCHAR(50) NOT NULL CHECK (status IN ('Aguardando retorno','Em andamento','Finalizado')),
  orcamento TEXT,
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
CREATE INDEX IF NOT EXISTS idx_servicos_status ON servicos(status);
CREATE INDEX IF NOT EXISTS idx_servicos_inicio ON servicos(data_inicio);
