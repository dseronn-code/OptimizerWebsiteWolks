import { createInterface } from 'node:readline/promises';
import { createUser } from '../auth/authService.js';
import { migrate } from '../db/migrate.js';
import { pool } from '../db/pool.js';

// Cria o primeiro administrador de forma interativa (a senha não fica em histórico de shell).
await migrate();
const rl = createInterface({ input: process.stdin, output: process.stdout });
const username = (await rl.question('Usuário: ')).trim();
const name = (await rl.question('Nome: ')).trim();
const password = await rl.question('Senha (mín. 10 caracteres, letras e números): ');
rl.close();
const u = await createUser({ username, name, password, role: 'admin' });
console.log(`Administrador criado: ${u.username}`);
await pool.end();
