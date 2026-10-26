# Johnson Pinturas - versão compartilhada

Aplicação Node.js com frontend, API Express e PostgreSQL no Neon.

## Implantação

1. Execute `database/schema.sql` no SQL Editor do Neon.
2. Copie a connection string do Neon.
3. No Render, crie um Web Service Node conectado a este repositório.
4. Use Build Command `npm install` e Start Command `npm start`.
5. Cadastre `DATABASE_URL` nas variáveis de ambiente.
6. Use Health Check Path `/api/health`.

As credenciais nunca devem ser adicionadas ao GitHub.
